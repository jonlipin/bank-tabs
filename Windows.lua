-- Bank Tabs
-- Windows: the move engine for the bag, bank and guild bank windows.
--
-- How a window is made movable here:
--   * a grip is laid over the strip at the top of the window, which is the only part that takes
--     the mouse, so nothing the window already has is covered;
--   * an overlay covering the whole window appears only while the drag modifier is held, so a
--     window whose title strip is busy can still be grabbed anywhere;
--   * the window is told to clamp itself to the screen while it is dragged, and the position is
--     clamped again when it is saved and when it is restored, so it can never end up out of reach;
--   * positions are stored in UIParent units, which survive a change of UI scale.
--
-- The game re-anchors its own windows whenever they are shown (bag windows get re-stacked every
-- time any bag opens, and the bank is placed by the UIPanel system). Every managed window is
-- therefore re-placed on show, on the next frame after that, and whenever the game re-stacks the
-- bags or positions its panels.
--
-- Only the windows listed here are ever touched. The world map is Map Tab's: it hooks the same
-- panel positioning, and each addon puts back only its own windows, so the two never fight.

local ADDON, ns = ...

local report = ns.report
local Windows = {}
ns.Windows = Windows

local entries = {}      -- every frame we have prepared, in the order they were found
local byFrame = {}      -- frame -> entry
local sweeps = 0

-- ------------------------------------------------------------------
-- Which window is which
-- ------------------------------------------------------------------

-- The reagent bag only exists on builds that carry it in Enum.BagIndex. Where it does not, bag 5
-- is the first bank bag instead, which is why this is probed rather than hardcoded.
local function ReagentBagIndex()
	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		local id = Enum.BagIndex.ReagentBag
		if type(id) == "number" then return id end
	end
	return nil
end

Windows.GROUPS = {
	{ key = "combined", label = "Combined bag window" },
	{ key = "bags", label = "Individual bag windows" },
	{ key = "reagent", label = "Reagent bag window" },
	{ key = "bank", label = "Bank window and bank bags" },
	{ key = "guildbank", label = "Guild bank window" },
}

-- Windows that always live under the same global name.
local NAMED = {
	{ name = "BankFrame", option = "bank", posKey = "bank", grip = "strip" },
	{ name = "GuildBankFrame", option = "guildbank", posKey = "guildbank", grip = "strip" },
	-- Only whole windows belong in this list. Panels that live inside another window, such as the
	-- bank's own tab panels, would be torn out of their parent if they were given a position of
	-- their own, so they are left alone and move with the window that holds them.
}

-- The bag windows are handed out by the game as it needs them, so the same frame can be bag 3 one
-- moment and a bank bag the next. Both the switch that governs it and the slot its position is
-- saved under are therefore worked out fresh every time it is shown.
local CONTAINER_NAMES = { "ContainerFrameCombinedBags" }
for i = 1, 17 do CONTAINER_NAMES[#CONTAINER_NAMES + 1] = "ContainerFrame" .. i end

local function ContainerOption(frame)
	if frame == _G.ContainerFrameCombinedBags then return "combined", "combined" end
	local id = frame.GetID and frame:GetID() or nil
	if type(id) ~= "number" then return nil end
	local reagent = ReagentBagIndex()
	if reagent and id == reagent then return "reagent", "bag" .. id end
	if id >= 0 and id <= 4 then return "bags", "bag" .. id end
	return "bank", "bag" .. id
end

-- ------------------------------------------------------------------
-- Screen geometry, all of it in UIParent units
-- ------------------------------------------------------------------

local function Ratio(frame)
	local own = frame:GetEffectiveScale() or 1
	if own == 0 then own = 1 end
	return (UIParent:GetEffectiveScale() or 1) / own
end

-- left, bottom, width, height of a frame measured in UIParent units, or nil before the frame has
-- been given an anchor the game can resolve.
local function Measure(frame)
	local left, bottom = frame:GetLeft(), frame:GetBottom()
	if not left or not bottom then return nil end
	local scale = 1 / Ratio(frame)
	return left * scale, bottom * scale, (frame:GetWidth() or 0) * scale, (frame:GetHeight() or 0) * scale
end
Windows.Measure = Measure

-- Keeps a window on screen. A window larger than the screen is held so that its edges stay
-- outside the screen rather than being pulled inside it, which is what the game does too.
local function ClampXY(x, y, w, h)
	local uw, uh = UIParent:GetWidth() or 0, UIParent:GetHeight() or 0
	if w <= uw then
		x = ns.Clamp(x, 0, uw - w)
	else
		x = ns.Clamp(x, uw - w, 0)
	end
	if h <= uh then
		y = ns.Clamp(y, 0, uh - h)
	else
		y = ns.Clamp(y, uh - h, 0)
	end
	return x, y
end
Windows.ClampXY = ClampXY

local function Place(frame, x, y)
	local _, _, w, h = Measure(frame)
	if not w then w, h = frame:GetWidth() or 0, frame:GetHeight() or 0 end
	x, y = ClampXY(x, y, w, h)
	local ratio = Ratio(frame)
	frame:ClearAllPoints()
	frame:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x * ratio, y * ratio)
	return x, y
end
Windows.Place = Place

-- ------------------------------------------------------------------
-- Saving and restoring
-- ------------------------------------------------------------------

local function PosKey(entry)
	if entry.dynamic then
		local _, key = ContainerOption(entry.frame)
		return key
	end
	return entry.def.posKey
end

local function OptionKey(entry)
	if entry.dynamic then
		local option = ContainerOption(entry.frame)
		return option
	end
	return entry.def.option
end
Windows.OptionKey = OptionKey

local function Save(entry)
	local key = PosKey(entry)
	if not key then return end
	local x, y, w, h = Measure(entry.frame)
	if not x then return end
	x, y = ClampXY(x, y, w, h)
	ns.db.positions[key] = { x = ns.Round(x, 1), y = ns.Round(y, 1) }
	Place(entry.frame, x, y)
	ns.MirrorToAccount()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
end

local function Reapply(entry)
	-- Never while the user has hold of the window: it would snap back under the cursor.
	if not entry.active or entry.moving or not entry.frame:IsShown() then return end
	local key = PosKey(entry)
	local pos = key and ns.db.positions[key]
	if not pos then return end
	Place(entry.frame, pos.x, pos.y)
end

-- Every managed window that is on screen, re-placed. Called after the game re-stacks the bags,
-- after it positions its panels, after a UI scale change and whenever the options change.
function Windows.ReapplyAll()
	for _, entry in ipairs(entries) do pcall(Reapply, entry) end
end

-- ------------------------------------------------------------------
-- The grip and the modifier overlay
-- ------------------------------------------------------------------

local MODIFIERS = {
	none = function() return false end,
	shift = function() return IsShiftKeyDown and IsShiftKeyDown() end,
	ctrl = function() return IsControlKeyDown and IsControlKeyDown() end,
	alt = function() return IsAltKeyDown and IsAltKeyDown() end,
}

function Windows.ModifierDown()
	local check = MODIFIERS[ns.db and ns.db.dragModifier or "none"]
	if not check then return false end
	local ok, down = pcall(check)
	return ok and down and true or false
end

local function StartDrag(entry)
	local frame = entry.frame
	if not frame:IsMovable() then return end
	frame:StartMoving()
	entry.moving = true
end

local function StopDrag(entry)
	local frame = entry.frame
	if not entry.moving then return end
	entry.moving = false
	frame:StopMovingOrSizing()
	Save(entry)
end

local function WireDrag(region, entry)
	region:EnableMouse(true)
	region:RegisterForDrag("LeftButton")
	region:SetScript("OnDragStart", function() StartDrag(entry) end)
	region:SetScript("OnDragStop", function() StopDrag(entry) end)
	-- A click that never reaches the drag threshold still has to let go of the window.
	region:SetScript("OnMouseUp", function() StopDrag(entry) end)
	region:SetScript("OnHide", function() StopDrag(entry) end)
end

local function BuildGrip(entry)
	local frame = entry.frame
	local def = entry.def or {}
	local grip = CreateFrame("Frame", nil, frame)
	grip.csOurs = true
	-- Above everything the window draws inside itself, or the window's own panels take the mouse
	-- before the grip ever sees it.
	ns.RaiseOver(grip, frame, 3)

	-- The strip along the top of the window. The right hand end is left alone for the close
	-- button, and a little is left at the left for a portrait where there is one.
	grip:SetPoint("TOPLEFT", frame, "TOPLEFT", def.gripLeft or 0, def.gripTop or 0)
	grip:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -(def.gripRight or 34), def.gripTop or 0)
	grip:SetHeight(def.gripHeight or 26)

	local art = grip:CreateTexture(nil, "OVERLAY")
	art:SetAllPoints()
	grip.art = art

	local hint = grip:CreateTexture(nil, "OVERLAY")
	hint:SetAllPoints()
	hint:SetColorTexture(0.35, 0.72, 1, 0.22)
	hint:Hide()
	-- The hover tint answers to the "show me where the drag strips are" switch, which is off by
	-- default. Highlighting on every pass of the mouse made a window header look like it was
	-- reacting to nothing.
	grip:SetScript("OnEnter", function() if ns.db.enabled and ns.db.showGrips then hint:Show() end end)
	grip:SetScript("OnLeave", function() hint:Hide() end)

	WireDrag(grip, entry)
	entry.grip = grip
	return grip
end

local function BuildOverlay(entry)
	local frame = entry.frame
	local overlay = CreateFrame("Frame", nil, frame)
	overlay.csOurs = true
	overlay:SetAllPoints(frame)
	ns.RaiseOver(overlay, frame, 5)
	-- The tint only shows when the user has asked to see the drag areas; the overlay itself works
	-- unseen. Lighting every window up on each press of alt was more distracting than helpful.
	local tint = overlay:CreateTexture(nil, "OVERLAY")
	tint:SetAllPoints()
	tint:SetColorTexture(0.35, 0.72, 1, 0.10)
	overlay.tint = tint
	overlay:Hide()
	WireDrag(overlay, entry)
	entry.overlay = overlay
	return overlay
end

-- The whole window overlay only takes the mouse while the drag modifier is held down, otherwise
-- it would swallow every click on the window underneath.
function Windows.UpdateOverlays()
	local down = ns.db and ns.db.enabled and Windows.ModifierDown()
	for _, entry in ipairs(entries) do
		if entry.overlay then
			local want = down and entry.active and entry.frame:IsShown() and true or false
			if entry.overlay.tint then entry.overlay.tint:SetAlpha(ns.db.showGrips and 1 or 0) end
			if want ~= (entry.overlay:IsShown() and true or false) then entry.overlay:SetShown(want) end
		end
	end
end

local function UpdateGripLook(entry)
	if not entry.grip then return end
	entry.grip:SetShown(entry.active and true or false)
	if ns.db.showGrips and entry.active then
		entry.grip.art:SetColorTexture(0.35, 0.72, 1, 0.14)
	else
		entry.grip.art:SetColorTexture(0, 0, 0, 0)
	end
end

-- ------------------------------------------------------------------
-- Attaching and detaching
-- ------------------------------------------------------------------

-- Panel windows are placed by the game's UIPanel system every time they are shown, which fights
-- with a saved position. Switching the layout attribute off takes the window out of that system;
-- the old value is kept so turning the option off puts it back.
local function SetPanelLayout(entry, enabled)
	local frame = entry.frame
	if not frame.SetAttribute then return end
	if not (UIPanelWindows and frame.GetName and UIPanelWindows[frame:GetName() or ""]) then return end
	if enabled then
		if entry.panelLayoutOff then
			pcall(frame.SetAttribute, frame, "UIPanelLayout-enabled", true)
			entry.panelLayoutOff = nil
		end
	elseif not entry.panelLayoutOff then
		local ok = pcall(frame.SetAttribute, frame, "UIPanelLayout-enabled", false)
		entry.panelLayoutOff = ok or nil
		report["panel layout " .. tostring(frame:GetName())] = ok and "taken out of the game's panel stack" or "could not be changed"
	end
end

local function RememberOriginalPoints(entry)
	if entry.originalPoints then return end
	local points = {}
	local count = entry.frame.GetNumPoints and entry.frame:GetNumPoints() or 0
	for i = 1, count do
		local point, relativeTo, relativePoint, x, y = entry.frame:GetPoint(i)
		points[#points + 1] = { point, relativeTo, relativePoint, x, y }
	end
	entry.originalPoints = points
end

local function RestoreOriginalPoints(entry)
	local points = entry.originalPoints
	if not points or #points == 0 then return false end
	entry.frame:ClearAllPoints()
	for _, p in ipairs(points) do
		pcall(entry.frame.SetPoint, entry.frame, p[1], p[2], p[3], p[4], p[5])
	end
	return true
end

local function Attach(entry)
	if entry.active then return end
	entry.active = true
	local frame = entry.frame

	RememberOriginalPoints(entry)
	pcall(frame.SetMovable, frame, true)
	pcall(frame.SetClampedToScreen, frame, true)
	if not entry.grip then BuildGrip(entry) end
	if not entry.overlay then BuildOverlay(entry) end
	SetPanelLayout(entry, false)

	if not entry.hooked then
		entry.hooked = true
		frame:HookScript("OnShow", function()
			if not entry.active then return end
			-- A window can grow new panels between one showing and the next (the bank's tab
			-- panels, say), so the grip climbs back on top each time.
			if entry.grip then ns.RaiseOver(entry.grip, frame, 3) end
			if entry.overlay then ns.RaiseOver(entry.overlay, frame, 5) end
			Reapply(entry)
			-- The game finishes placing a window after its OnShow has run, so the position is
			-- put back once more on the next frame.
			ns.After(0, function() Reapply(entry) end)
		end)

		-- A window that changes size is usually a window the game has just re-anchored. Reapply
		-- only does anything when the user has actually placed this window, so an untouched one
		-- is still left entirely to the game.
		frame:HookScript("OnSizeChanged", function()
			if not entry.active or entry.moving then return end
			Reapply(entry)
		end)
	end

	Reapply(entry)
	UpdateGripLook(entry)
end

local function Detach(entry)
	if not entry.active then return end
	entry.active = false
	if entry.grip then entry.grip:Hide() end
	if entry.overlay then entry.overlay:Hide() end
	SetPanelLayout(entry, true)
	RestoreOriginalPoints(entry)
	UpdateGripLook(entry)
end

-- ------------------------------------------------------------------
-- Finding windows
-- ------------------------------------------------------------------

local function Prepare(frame, def, dynamic)
	if byFrame[frame] then return byFrame[frame] end
	local entry = { frame = frame, def = def, dynamic = dynamic, active = false }
	entries[#entries + 1] = entry
	byFrame[frame] = entry
	return entry
end

-- Looks for every window this addon knows about. Load on demand panels such as the guild bank do
-- not exist until the game has needed them, so this runs again on every addon load and whenever a
-- bank or a bag is opened.
function Windows.Sweep(reason)
	sweeps = sweeps + 1
	local found = 0

	for _, def in ipairs(NAMED) do
		local frame = _G[def.name]
		if type(frame) == "table" and frame.GetObjectType and not byFrame[frame] then
			Prepare(frame, def, false)
			found = found + 1
		end
	end

	for _, name in ipairs(CONTAINER_NAMES) do
		local frame = _G[name]
		if type(frame) == "table" and frame.GetObjectType and not byFrame[frame] then
			Prepare(frame, { grip = "strip", gripRight = 34, gripHeight = 26 }, true)
			found = found + 1
		end
	end

	if found > 0 then
		report["windows found"] = #entries .. " (last find: " .. tostring(reason) .. ")"
		Windows.Apply()
	end
	return found
end

-- ------------------------------------------------------------------
-- Applying the current settings
-- ------------------------------------------------------------------

function Windows.Apply()
	if not ns.db then return end
	for _, entry in ipairs(entries) do
		local option = OptionKey(entry)
		local wanted = ns.db.enabled and option and ns.db.windows[option] and true or false
		if wanted then Attach(entry) else Detach(entry) end
		UpdateGripLook(entry)
	end
	Windows.UpdateOverlays()
end

-- Forgets every saved position and puts each window back where the game had it.
function Windows.ResetAll()
	ns.db.positions = {}
	for _, entry in ipairs(entries) do
		RestoreOriginalPoints(entry)
	end
	ns.MirrorToAccount()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
end

-- Forgets one window's position. `key` is an option key, so resetting "bags" clears all of them.
function Windows.ResetGroup(key)
	for _, entry in ipairs(entries) do
		if OptionKey(entry) == key then
			local posKey = PosKey(entry)
			if posKey then ns.db.positions[posKey] = nil end
			RestoreOriginalPoints(entry)
		end
	end
	ns.MirrorToAccount()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
end

-- How many windows in a group currently carry a saved position, for the options page.
function Windows.MovedCount(key)
	local count = 0
	for _, entry in ipairs(entries) do
		if OptionKey(entry) == key then
			local posKey = PosKey(entry)
			if posKey and ns.db.positions[posKey] then count = count + 1 end
		end
	end
	return count
end

-- ------------------------------------------------------------------
-- Helpers the other modules use
-- ------------------------------------------------------------------

function Windows.UpdateGrips()
	for _, entry in ipairs(entries) do pcall(UpdateGripLook, entry) end
end

-- Makes any region drag a window this module already manages.
function Windows.WireRegion(region, frame)
	local entry = byFrame[frame]
	if not entry then return false end
	region.csOurs = true
	WireDrag(region, entry)
	return true
end

function Windows.Ratio(frame)
	return Ratio(frame)
end

function Windows.Entry(frame)
	return byFrame[frame]
end

Windows.CONTAINER_NAMES = CONTAINER_NAMES
Windows.ContainerOption = ContainerOption

-- The clear stretches along the top edge of a window: the parts of the band that none of the
-- window's own mouse-enabled frames are sitting on. This is how the backpack's header finds room
-- for the icons without covering the buttons that live in it. Everything is in UIParent units.
function Windows.HeaderGaps(frame, band, minWidth)
	local left, bottom, width, height = Measure(frame)
	if not left or width <= 0 then return {} end
	local top = bottom + height
	local floor = top - (band or 28)

	local blockers = {}
	ns.WalkChildren(frame, function(child)
		local okShown, shown = pcall(child.IsShown, child)
		if okShown and not shown then return end
		local okMouse, mouse = pcall(child.IsMouseEnabled, child)
		if not (okMouse and mouse) then return end
		local cl, cb, cw, ch = Measure(child)
		if not cl or not cw or cw <= 0 then return end
		if cb + ch > floor and cb < top then blockers[#blockers + 1] = { cl, cl + cw } end
	end, 5, 500)

	table.sort(blockers, function(a, b) return a[1] < b[1] end)

	local merged = {}
	for _, span in ipairs(blockers) do
		local last = merged[#merged]
		if last and span[1] <= last[2] + 2 then
			last[2] = math.max(last[2], span[2])
		else
			merged[#merged + 1] = { span[1], span[2] }
		end
	end

	local gaps = {}
	local wanted = minWidth or 24
	local cursor = left
	local right = left + width
	for _, span in ipairs(merged) do
		local edge = math.min(span[1], right)
		if edge - cursor >= wanted then gaps[#gaps + 1] = { cursor, edge } end
		cursor = math.max(cursor, span[2])
	end
	if right - cursor >= wanted then gaps[#gaps + 1] = { cursor, right } end
	return gaps, top, floor
end

-- ------------------------------------------------------------------
-- Events
-- ------------------------------------------------------------------

function Windows.OnEvent(event)
	if event == "MODIFIER_STATE_CHANGED" then
		Windows.UpdateOverlays()

	elseif event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
		-- Positions are held in UIParent units, so a scale change only needs them re-clamped
		-- against the new screen size.
		Windows.ReapplyAll()

	elseif event == "BANKFRAME_OPENED" or event == "GUILDBANKFRAME_OPENED" or event == "BAG_OPEN" then
		Windows.Sweep(event)
		if ns.BagHeader and ns.BagHeader.Sweep then pcall(ns.BagHeader.Sweep) end
		Windows.ReapplyAll()
		ns.After(0, Windows.ReapplyAll)

	elseif event == "BAG_CLOSED" or event == "BANKFRAME_CLOSED" or event == "GUILDBANKFRAME_CLOSED" then
		ns.After(0, Windows.ReapplyAll)
	end
end

function Windows.Init()
	Windows.Sweep("init")

	-- The game re-stacks every open bag window whenever one opens or closes. This is the hook that
	-- puts the ones the user has moved back where they left them.
	--
	-- It matters that this runs STRAIGHT AWAY rather than on the next frame. hooksecurefunc runs
	-- as soon as the game's own function returns, which is still before anything is drawn, so the
	-- window is only ever painted where the user put it. Deferring it by a frame is what made a
	-- moved bag flicker through its default position on the way to its own.
	if type(_G.UpdateContainerFrameAnchors) == "function" and hooksecurefunc then
		local ok = pcall(hooksecurefunc, "UpdateContainerFrameAnchors", function()
			Windows.ReapplyAll()
			-- A backstop for any build that finishes the job after this returns.
			ns.After(0, Windows.ReapplyAll)
		end)
		report["bag anchor hook"] = ok and "ok" or "could not be hooked"
	else
		report["bag anchor hook"] = "UpdateContainerFrameAnchors is not on this client"
	end

	-- Some builds place a single bag through this one instead.
	if type(_G.ContainerFrame_SetPosition) == "function" and hooksecurefunc then
		pcall(hooksecurefunc, "ContainerFrame_SetPosition", function()
			Windows.ReapplyAll()
			ns.After(0, Windows.ReapplyAll)
		end)
	end

	-- The bank is a panel window, positioned by the game's UI panel system, which can run AFTER
	-- the window changes size and re-anchor it then. Hooking the positioning itself runs our
	-- re-place in the same frame, after every anchor the game sets, so nothing is ever drawn out
	-- of place. Map Tab hooks the same functions for the world map; each of us puts back only its
	-- own windows.
	local hooked = {}
	for _, name in ipairs({ "UpdateUIPanelPositions", "ShowUIPanel", "HideUIPanel" }) do
		if type(_G[name]) == "function" and hooksecurefunc then
			if pcall(hooksecurefunc, name, function() Windows.ReapplyAll() end) then hooked[#hooked + 1] = name end
		end
	end
	local delegate = _G.FramePositionDelegate
	if delegate and type(delegate.UpdateUIPanelPositions) == "function" and hooksecurefunc then
		if pcall(hooksecurefunc, delegate, "UpdateUIPanelPositions", function() Windows.ReapplyAll() end) then
			hooked[#hooked + 1] = "FramePositionDelegate"
		end
	end
	report["panel position hook"] = #hooked > 0 and table.concat(hooked, ", ") or "none of the panel functions are on this client"

	local reagent = ReagentBagIndex()
	report["reagent bag"] = reagent and ("bag " .. reagent) or "not on this client, bag 5 is treated as a bank bag"

	-- Late sweeps: load on demand panels and bag frames the game had not built yet.
	ns.After(2, function() Windows.Sweep("2s after login") end)
	ns.After(8, function() Windows.Sweep("8s after login") end)
end

-- Bank Tabs
-- Reagent bag: the reagent bag's slots shown inside the combined backpack.
--
-- With the bags combined the game still gives the reagent bag a window of its own, opened beside
-- the backpack. Behind a switch that is off by default, this puts its slots inside the backpack,
-- in rows of their own above the bags with a line between, the way the saved Bags window shows a
-- reagent bag.
--
-- The slots stay the game's own buttons. They are not copied and the game's bag code is not
-- changed, because an item button an addon builds or sets up cannot be trusted to use an item in
-- combat. Only where things sit is changed:
--   * the reagent bag's window is made a child of the backpack, so it is drawn over it and moves,
--     hides and scales with it; its frame, title, portrait and close button are faded out and
--     stop taking the mouse, and the empty shell stays where the game put it, so a window the
--     game stacks against it (the keyring) lands where it always did;
--   * its item buttons are anchored into rows of ten above the backpack's own, read like a page
--     with the short row on top, as the backpack's are;
--   * the backpack is made taller by those rows. The game sizes it from the bottom, so the room
--     opens between the search box and the first row of bags.
-- Everything is put back when the switch goes off, when either window closes, and when the game
-- lays the bag out again (and is then done over).
--
-- The game opens the reagent bag with the backpack when all bags are opened (the B key, a vendor,
-- the bank). The backpack opened on its own has no reagent bag open to show; this never opens a
-- bag itself, and closes one only by letting the reagent bag go with the backpack it sits in.

local ADDON, ns = ...

local report = ns.report
local Dock = {}
ns.ReagentDock = Dock

local REPORT = "reagent bag in the backpack"

-- The combined backpack's grid (ContainerFrame.lua: ten columns of 37 with 5 between, the first
-- button 4 above the money).
local COLS, CELL, GAP = 10, 37, 5
local PITCH = CELL + GAP
local FIRST_Y = 4
-- The room between the reagent rows and the bags, with the line through the middle of it.
local BREAK = 17

local held            -- the reagent bag's window while its slots are in the backpack
local kept = {}       -- its parent and scale before
local saved = {}      -- frame or region -> the alpha and mouse it had before it was faded
local spots = {}      -- item button -> where the game last put it
local moved = {}      -- the item buttons placed in the backpack
local base, added = nil, 0   -- the backpack's own height, and what is added to it
local busy, waiting = false, false
local hooked = {}
local rule

local function ReagentIndex()
	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		local id = Enum.BagIndex.ReagentBag
		if type(id) == "number" then return id end
	end
	return nil
end

local function Combined()
	local frame = _G.ContainerFrameCombinedBags
	if type(frame) == "table" and frame.IsShown and frame.SetHeight then return frame end
	return nil
end

local function GamepadUI()
	local util = _G.InputUtil
	if type(util) == "table" and type(util.IsGamepadUIEnabled) == "function" then
		local ok, on = pcall(util.IsGamepadUIEnabled)
		return ok and on and true or false
	end
	return false
end

function Dock.Wanted()
	return ns.db and ns.db.enabled and ns.db.reagentInBackpack and true or false
end

-- The window the move engine must leave alone: it is part of the backpack for now.
function Dock.Holds(frame)
	return held ~= nil and held == frame
end

-- What the backpack has to have for this to work, or the reason it cannot.
local function Unfit(combined)
	if type(combined.GetRows) ~= "function" or type(combined.UpdateFrameSize) ~= "function" then
		return "this client's combined backpack cannot be measured"
	end
	local money = combined.MoneyFrame
	if type(money) ~= "table" or not money.GetObjectType then return "this client's combined backpack has no money row to build on" end
	return nil
end

local function ReagentFrame()
	local id = ReagentIndex()
	if not id then return nil end
	local combined = _G.ContainerFrameCombinedBags
	for _, name in ipairs(ns.Windows.CONTAINER_NAMES or {}) do
		local frame = _G[name]
		if type(frame) == "table" and frame ~= combined and frame.IsShown and frame:IsShown()
			and frame.GetID and frame:GetID() == id and type(frame.Items) == "table" then
			return frame
		end
	end
	return nil
end

-- Its item buttons, last slot first, which is the order the game lays a bag out in.
local function Buttons(frame)
	local list = {}
	for _, button in ipairs(type(frame.Items) == "table" and frame.Items or {}) do
		if type(button) == "table" and button.SetPoint and button.GetID then list[#list + 1] = button end
	end
	table.sort(list, function(a, b) return (a:GetID() or 0) > (b:GetID() or 0) end)
	return list
end

local function PointsOf(region)
	local points = {}
	local count = region.GetNumPoints and region:GetNumPoints() or 0
	for i = 1, count do
		local point, relativeTo, relativePoint, x, y = region:GetPoint(i)
		points[#points + 1] = { point, relativeTo, relativePoint, x, y }
	end
	return points
end

local function SetPoints(region, points)
	if not points or #points == 0 then return end
	region:ClearAllPoints()
	for _, p in ipairs(points) do pcall(region.SetPoint, region, p[1], p[2], p[3], p[4], p[5]) end
end

-- In combat the game refuses a protected frame's SetPoint and SetParent to an addon. Bag windows
-- and their buttons are not protected, but a build where they were would only fill the chat with
-- blocked messages, so this waits for the fight to end there.
local function Locked(...)
	if not InCombatLockdown then return false end
	local ok, locked = pcall(InCombatLockdown)
	if not (ok and locked) then return false end
	for i = 1, select("#", ...) do
		local frame = select(i, ...)
		if type(frame) == "table" and frame.IsProtected then
			local got, protected = pcall(frame.IsProtected, frame)
			if got and protected then return true end
		end
	end
	return false
end

-- ------------------------------------------------------------------
-- Fading the reagent bag's own window away
-- ------------------------------------------------------------------

local function Was(object)
	local was = saved[object]
	if not was then
		was = {}
		saved[object] = was
	end
	return was
end

local function Fade(object)
	if not (object.GetAlpha and object.SetAlpha) then return end
	local ok, alpha = pcall(object.GetAlpha, object)
	if ok and type(alpha) == "number" and alpha > 0 then
		Was(object).alpha = alpha
		pcall(object.SetAlpha, object, 0)
	end
end

local function Quiet(frame, depth)
	if frame.IsMouseEnabled and frame.EnableMouse then
		local ok, on = pcall(frame.IsMouseEnabled, frame)
		if ok and on then
			Was(frame).mouse = true
			pcall(frame.EnableMouse, frame, false)
		end
	end
	if (depth or 0) <= 0 then return end
	for _, child in ipairs(ns.Children(frame)) do
		if type(child) == "table" then Quiet(child, depth - 1) end
	end
end

local function Regions(frame)
	local ok, list = pcall(function() return { frame:GetRegions() } end)
	if ok and type(list) == "table" then return list end
	return {}
end

-- Everything on the window that is not an item button. Done again each time, since the game
-- shows parts of a bag window (its filter icon, its portrait) as it updates it.
local function Strip(frame, buttons)
	local isItem = {}
	for _, button in ipairs(buttons) do isItem[button] = true end
	for _, child in ipairs(ns.Children(frame)) do
		-- A spare button waiting in the window's pool is hidden, and is an item button all the same.
		if type(child) == "table" and not isItem[child] and rawget(child, "GetBagID") == nil then
			Fade(child)
			Quiet(child, 3)
		end
	end
	for _, region in ipairs(Regions(frame)) do
		if type(region) == "table" then Fade(region) end
	end
	Quiet(frame, 0)
end

local function Unstrip()
	for object, was in pairs(saved) do
		if was.alpha then pcall(object.SetAlpha, object, was.alpha) end
		if was.mouse then pcall(object.EnableMouse, object, true) end
	end
	saved = {}
end

-- ------------------------------------------------------------------
-- Taking the reagent bag in, and letting it go
-- ------------------------------------------------------------------

local function HookFrame(frame)
	if hooked[frame] then return end
	hooked[frame] = true
	-- The game has just laid the bag out its own way: that is where its buttons go back to.
	if type(frame.UpdateItemLayout) == "function" and hooksecurefunc then
		pcall(hooksecurefunc, frame, "UpdateItemLayout", function()
			for _, button in ipairs(Buttons(frame)) do spots[button] = PointsOf(button) end
			Dock.Refresh()
		end)
	end
	if frame.HookScript then
		frame:HookScript("OnHide", function() Dock.Refresh() end)
	end
end

local function Rule(combined)
	if rule and rule:GetParent() == combined then return rule end
	rule = CreateFrame("Frame", nil, combined)
	rule.csOurs = true
	local line = rule:CreateTexture(nil, "ARTWORK")
	line:SetAllPoints()
	line:SetColorTexture(1, 1, 1, 0.16)
	rule.line = line
	rule:Hide()
	return rule
end

local function Release()
	local frame = held
	if not frame then return end
	held = nil
	local combined = Combined()

	-- The backpack closed with the reagent bag inside it. Hidden with its parent it is already
	-- off screen, so hiding it now runs nothing of the game's, and it is closed like the window
	-- it was part of rather than left to come back as a window on its own.
	if combined and not combined:IsShown() and frame:IsShown() and frame:GetParent() == combined then
		pcall(frame.Hide, frame)
	end

	Unstrip()
	for button in pairs(moved) do SetPoints(button, spots[button]) end
	moved = {}
	if kept.parent and frame:GetParent() ~= kept.parent then pcall(frame.SetParent, frame, kept.parent) end
	if kept.scale and frame:GetScale() ~= kept.scale then pcall(frame.SetScale, frame, kept.scale) end
	kept = {}

	if combined and base and added > 0 then combined:SetHeight(base) end
	added = 0
	if rule then rule:Hide() end

	-- The move engine has it back.
	if ns.Windows and ns.Windows.Apply then pcall(ns.Windows.Apply) end
end

local function Take(frame, combined, buttons, rows)
	if held ~= frame then
		held = frame
		kept = { parent = frame:GetParent(), scale = frame:GetScale() }
		HookFrame(frame)
		-- Out of the move engine before anything is changed: a reagent bag the user has placed
		-- has no place of its own while it is in the backpack.
		if ns.Windows and ns.Windows.Apply then pcall(ns.Windows.Apply) end
	end

	for _, button in ipairs(buttons) do
		if not spots[button] then spots[button] = PointsOf(button) end
	end

	Strip(frame, buttons)
	if frame:GetParent() ~= combined then frame:SetParent(combined) end
	-- The game scales every open bag window alike. Inside the backpack that scale is already
	-- the backpack's, and once more on top would shrink the slots.
	local scale = frame:GetScale()
	if type(scale) == "number" and scale ~= 1 then
		kept.scale = scale
		frame:SetScale(1)
	end

	local money = combined.MoneyFrame
	local lift = FIRST_Y + rows * PITCH - GAP + BREAK
	local now = {}
	for i, button in ipairs(buttons) do
		local at = i - 1
		button:ClearAllPoints()
		button:SetPoint("BOTTOMRIGHT", money, "TOPRIGHT", -(at % COLS) * PITCH, lift + math.floor(at / COLS) * PITCH)
		moved[button] = true
		now[button] = true
	end
	-- A button the bag no longer uses goes back to where the game had it.
	for button in pairs(moved) do
		if not now[button] then
			SetPoints(button, spots[button])
			moved[button] = nil
		end
	end

	local reagentRows = math.ceil(#buttons / COLS)
	local extra = reagentRows * PITCH - GAP + BREAK
	if not base then base = combined:GetHeight() - added end
	if math.abs(combined:GetHeight() - (base + extra)) > 0.01 then combined:SetHeight(base + extra) end
	added = extra

	local line = Rule(combined)
	line:ClearAllPoints()
	line:SetPoint("BOTTOMRIGHT", money, "TOPRIGHT", 0, FIRST_Y + rows * PITCH - GAP + math.floor(BREAK / 2))
	line:SetSize(COLS * PITCH - GAP, 1)
	line:Show()
	return reagentRows
end

local function Work()
	local combined = Combined()
	local why, frame, buttons

	if not Dock.Wanted() then
		why = "off"
	elseif not ReagentIndex() then
		why = "this client has no reagent bag"
	elseif not combined then
		why = "this client has no combined backpack"
	elseif Unfit(combined) then
		why = Unfit(combined)
	elseif GamepadUI() then
		why = "left to the game: its gamepad interface puts the reagent bag in the backpack itself"
	elseif ns.BagHeader and ns.BagHeader.EllesmereBags and ns.BagHeader.EllesmereBags() then
		why = "left alone: EllesmereUI's bag window is in use"
	elseif not combined:IsShown() then
		why = "on, waiting for the combined backpack to open"
	else
		frame = ReagentFrame()
		if frame then
			buttons = Buttons(frame)
			if #buttons == 0 then frame = nil end
		end
		if not frame then why = "on, waiting for the reagent bag to open with the backpack" end
	end

	if (frame or held) and Locked(combined, frame, held, buttons and buttons[1]) then
		waiting = true
		report[REPORT] = "waiting for combat to end"
		return
	end
	waiting = false

	if held and held ~= frame then Release() end
	if frame then
		local ok, rows = pcall(combined.GetRows, combined)
		if ok and type(rows) == "number" and rows >= 1 then
			local reagentRows = Take(frame, combined, buttons, rows)
			why = "in the combined backpack: " .. #buttons .. " slots in " .. reagentRows .. (reagentRows == 1 and " row" or " rows")
		else
			Release()
			why = "the combined backpack would not say how many rows it has"
		end
	end
	report[REPORT] = why
end

-- Puts the reagent bag in the backpack, or takes it out, to match the switch and what is open.
function Dock.Refresh()
	if busy then return end
	busy = true
	local ok, err = pcall(Work)
	busy = false
	if not ok then report[REPORT] = "failed: " .. tostring(err) end
end
Dock.Apply = Dock.Refresh

function Dock.OnEvent(event)
	if event == "PLAYER_REGEN_ENABLED" then
		if waiting then Dock.Refresh() end
	elseif event == "BAG_OPEN" or event == "BAG_CLOSED" or event == "BAG_UPDATE_DELAYED" then
		if Dock.Wanted() or held then
			Dock.Refresh()
			ns.After(0, Dock.Refresh)
		end
	end
end

local function HookCombined()
	local combined = Combined()
	if not combined or hooked[combined] then return end
	hooked[combined] = true
	-- The game has just sized the backpack for its own rows: that is the height to build on.
	if type(combined.UpdateFrameSize) == "function" and hooksecurefunc then
		pcall(hooksecurefunc, combined, "UpdateFrameSize", function()
			base, added = combined:GetHeight(), 0
			Dock.Refresh()
		end)
	end
	if combined.HookScript then
		combined:HookScript("OnShow", function() Dock.Refresh() end)
		combined:HookScript("OnHide", function() Dock.Refresh() end)
	end
end

function Dock.Init()
	HookCombined()
	-- The game re-stacks and re-scales every open bag window whenever one opens or closes, the
	-- reagent bag's among them. Straight after it, in the same frame, so nothing is drawn between.
	if type(_G.UpdateContainerFrameAnchors) == "function" and hooksecurefunc then
		pcall(hooksecurefunc, "UpdateContainerFrameAnchors", function() Dock.Refresh() end)
	end
	Dock.Refresh()
	ns.After(2, function()
		HookCombined()
		Dock.Refresh()
	end)
end

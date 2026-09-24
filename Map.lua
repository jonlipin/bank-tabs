-- Casement
-- Map: moving, resizing and scaling the world map.
--
-- Resizing is done by scaling the whole window rather than by stretching it. The world map on
-- this client is a canvas with its own layout, detail layers and pins, and stretching the frame
-- leaves all of that to be rebuilt by hand; scaling keeps every part of the map in proportion and
-- is what the corner grip and the percentage buttons both drive. That means the two controls are
-- two ways of setting the same number: drag the corner for a free size, click the buttons to land
-- on a round ten percent.
--
-- The grip and the button bar are children of the map, so they travel with it, and both are given
-- the inverse of the map's scale so that they stay the same size on screen at any zoom.

local ADDON, ns = ...

local report = ns.report
local Map = {}
ns.Map = Map

local map, grip, bar, label
local resizing = nil

local function MapFrame()
	if map then return map end
	local frame = _G.WorldMapFrame
	if type(frame) == "table" and frame.GetObjectType then map = frame end
	return map
end

local function IsMaximized()
	local frame = MapFrame()
	if not frame then return false end
	if frame.IsMaximized then
		local ok, value = pcall(frame.IsMaximized, frame)
		if ok then return value and true or false end
	end
	return frame.isMaximized and true or false
end

local function Percent()
	return math.floor((ns.db.map.scale or 1) * 100 + 0.5)
end

-- ------------------------------------------------------------------
-- Applying a scale
-- ------------------------------------------------------------------

-- Puts the map back where it was after a scale change. The saved position is held in UIParent
-- units, so it survives the scale change; this only has to re-place and re-clamp it.
local function Replace()
	local frame = MapFrame()
	if not frame then return end
	-- While the corner is being dragged the resize loop does the placing itself, one corner held
	-- still, so this stays out of the way.
	if resizing then return end
	local pos = ns.db.positions["worldmap"]
	if pos then
		ns.Windows.Place(frame, pos.x, pos.y)
	elseif frame:IsShown() then
		local x, y, w, h = ns.Windows.Measure(frame)
		if x then ns.Windows.Place(frame, x, y) end
	end
end

-- Keeps the grip and the bar the same size on screen whatever the map is scaled to.
local function CounterScale()
	local scale = ns.db.map.scale or 1
	if scale <= 0 then scale = 1 end
	local inverse = 1 / scale
	if grip then grip:SetScale(inverse) end
	if bar then bar:SetScale(inverse) end
end

function Map.SetScale(value, save)
	local db = ns.db.map
	value = ns.Clamp(ns.Round(value, 3), db.minScale, db.maxScale)
	db.scale = value
	local frame = MapFrame()
	if frame and not IsMaximized() then
		pcall(frame.SetScale, frame, value)
	end
	CounterScale()
	if label then label:SetText(Percent() .. "%") end
	Replace()
	if save ~= false then
		ns.MirrorToAccount()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
	end
end

-- The percentage buttons always land on a multiple of the step, so repeated clicks walk 90, 100,
-- 110 even when the corner drag left the map on 97.
function Map.Step(direction)
	local db = ns.db.map
	local step = db.step or 10
	local pct = Percent()
	local target
	if direction > 0 then
		target = math.floor((pct + 0.001) / step) * step + step
	else
		target = math.ceil((pct - 0.001) / step) * step - step
	end
	Map.SetScale(target / 100)
end

function Map.ResetSize()
	Map.SetScale(1)
end

-- ------------------------------------------------------------------
-- The corner grip
-- ------------------------------------------------------------------

-- The corner is drawn rather than textured. Several of the game's own grabber files do not render
-- on this client (the same is true of everything under Interface\Buttons), and three plain bars
-- are guaranteed to show up.
local function DrawGripBars(frame)
	for i = 1, 3 do
		local dash = frame:CreateTexture(nil, "OVERLAY")
		dash:SetColorTexture(0.85, 0.72, 0.35, 0.85)
		dash:SetSize(4 + (i - 1) * 5, 2)
		dash:SetPoint("BOTTOMRIGHT", -2, 1 + (i - 1) * 4)
	end
	report["map grip art"] = "drawn"
end

local function CursorInUIUnits()
	local x, y = GetCursorPosition()
	local scale = UIParent:GetEffectiveScale() or 1
	if scale == 0 then scale = 1 end
	return x / scale, y / scale
end

local function StopResize()
	if not resizing then return end
	grip:SetScript("OnUpdate", nil)
	resizing = nil
	ns.MirrorToAccount()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
	-- The position is only stored once the drag is over, so a resize cannot fill the saved
	-- variables with a hundred intermediate positions.
	local frame = MapFrame()
	if frame then
		local x, y, w, h = ns.Windows.Measure(frame)
		if x then
			x, y = ns.Windows.ClampXY(x, y, w, h)
			ns.db.positions["worldmap"] = { x = ns.Round(x, 1), y = ns.Round(y, 1) }
			ns.Windows.Place(frame, x, y)
		end
	end
end

local function OnResizeUpdate()
	if not resizing then return end
	local cx, cy = CursorInUIUnits()
	local dx, dy = cx - resizing.left, resizing.top - cy
	local distance = math.sqrt(dx * dx + dy * dy)
	if distance < 8 then distance = 8 end
	local scale = resizing.scale * (distance / resizing.distance)
	-- Holding shift while dragging snaps to the same ten percent grid the buttons use.
	if IsShiftKeyDown and IsShiftKeyDown() then
		local step = (ns.db.map.step or 10) / 100
		scale = math.floor(scale / step + 0.5) * step
	end
	Map.SetScale(scale, false)

	-- The corner being dragged moves, the opposite corner stays put.
	local frame = MapFrame()
	local _, _, w, h = ns.Windows.Measure(frame)
	if w then ns.Windows.Place(frame, resizing.left, resizing.top - h) end
end

local function StartResize()
	local frame = MapFrame()
	if not frame then return end
	local left, bottom, w, h = ns.Windows.Measure(frame)
	if not left then return end
	local cx, cy = CursorInUIUnits()
	local top = bottom + h
	local dx, dy = cx - left, top - cy
	local distance = math.sqrt(dx * dx + dy * dy)
	if distance < 8 then distance = 8 end
	resizing = { left = left, top = top, distance = distance, scale = ns.db.map.scale or 1 }
	grip:SetScript("OnUpdate", OnResizeUpdate)
end

local function BuildGrip()
	local frame = MapFrame()
	if not frame or grip then return end
	grip = CreateFrame("Frame", "CasementMapGrip", frame)
	grip:SetSize(20, 20)
	grip:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -2, 2)
	grip:SetFrameLevel(math.min((frame:GetFrameLevel() or 1) + 8, 9000))
	grip:EnableMouse(true)

	local hit = grip:CreateTexture(nil, "BACKGROUND")
	hit:SetAllPoints()
	hit:SetColorTexture(1, 1, 1, 0)
	DrawGripBars(grip)

	grip:SetScript("OnMouseDown", StartResize)
	grip:SetScript("OnMouseUp", StopResize)
	grip:SetScript("OnHide", StopResize)
	grip:SetScript("OnEnter", function()
		GameTooltip:SetOwner(grip, "ANCHOR_LEFT")
		GameTooltip:SetText("Resize the map", 1, 1, 1)
		GameTooltip:AddLine("Drag to scale the whole map. Hold shift to snap to "
			.. (ns.db.map.step or 10) .. " percent steps.", nil, nil, nil, true)
		GameTooltip:Show()
	end)
	grip:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

-- ------------------------------------------------------------------
-- The percentage bar
-- ------------------------------------------------------------------

local function SmallButton(parent, text, width, onClick, tooltip)
	local button
	local ok, made = pcall(CreateFrame, "Button", nil, parent, "UIPanelButtonTemplate")
	if ok and made then button = made else button = CreateFrame("Button", nil, parent) end
	if not button.GetFontString or not button:GetFontString() then
		local fs = button:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		fs:SetAllPoints()
		button:SetFontString(fs)
		local backing = button:CreateTexture(nil, "BACKGROUND")
		backing:SetAllPoints()
		backing:SetColorTexture(0, 0, 0, 0.6)
	end
	button:SetSize(width, 20)
	button:SetText(text)
	button:SetScript("OnClick", onClick)
	if tooltip then
		button:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_TOP")
			GameTooltip:SetText(tooltip, 1, 1, 1)
			GameTooltip:Show()
		end)
		button:SetScript("OnLeave", function() GameTooltip:Hide() end)
	end
	return button
end

local function BuildBar()
	local frame = MapFrame()
	if not frame or bar then return end
	bar = CreateFrame("Frame", "CasementMapScale", frame)
	bar:SetSize(150, 22)
	-- Hung just below the map so it can never cover anything the map itself draws.
	bar:SetPoint("TOPRIGHT", frame, "BOTTOMRIGHT", 0, -2)
	bar:SetFrameLevel(math.min((frame:GetFrameLevel() or 1) + 8, 9000))

	local backing = bar:CreateTexture(nil, "BACKGROUND")
	backing:SetAllPoints()
	backing:SetColorTexture(0, 0, 0, 0.45)

	local minus = SmallButton(bar, "-", 24, function() Map.Step(-1) end,
		"Smaller, in " .. (ns.db.map.step or 10) .. " percent steps")
	minus:SetPoint("LEFT", 3, 0)

	label = bar:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
	label:SetPoint("LEFT", minus, "RIGHT", 4, 0)
	label:SetWidth(44)
	label:SetJustifyH("CENTER")
	label:SetText(Percent() .. "%")

	local plus = SmallButton(bar, "+", 24, function() Map.Step(1) end,
		"Bigger, in " .. (ns.db.map.step or 10) .. " percent steps")
	plus:SetPoint("LEFT", label, "RIGHT", 4, 0)

	local reset = SmallButton(bar, "100%", 42, function() Map.ResetSize() end, "Back to the map's normal size")
	reset:SetPoint("LEFT", plus, "RIGHT", 4, 0)

	bar:SetWidth(3 + 24 + 4 + 44 + 4 + 24 + 4 + 42 + 4)
end

-- ------------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------------

function Map.Apply()
	local frame = MapFrame()
	if not frame then return end
	local db = ns.db
	local on = db.enabled and db.windows.worldmap and true or false

	if on then
		BuildGrip()
		BuildBar()
	end
	if grip then grip:SetShown(on and db.map.resizeGrip and not IsMaximized()) end
	if bar then bar:SetShown(on and db.map.scaleButtons and not IsMaximized()) end

	if on then
		Map.SetScale(db.map.scale, false)
	elseif (frame:GetScale() or 1) ~= 1 then
		-- With the feature switched off the map goes back to the size the game gives it.
		pcall(frame.SetScale, frame, 1)
		Replace()
	end
	if label then label:SetText(Percent() .. "%") end
end

function Map.OnEvent(event)
	if event == "UI_SCALE_CHANGED" or event == "DISPLAY_SIZE_CHANGED" then
		Replace()
	end
end

function Map.Init()
	local frame = MapFrame()
	if not frame then
		report["world map frame"] = "WorldMapFrame is not on this client"
		return
	end
	report["world map frame"] = "found"
	report["world map canvas"] = frame.ScrollContainer and "has a ScrollContainer" or "no ScrollContainer"
	report["world map maximized"] = IsMaximized() and "yes, scaling is left alone while it is" or "no"

	-- Hidden windows report no position, so the grip, the bar and the scale are only set up once
	-- the map has actually been shown.
	frame:HookScript("OnShow", function()
		pcall(Map.Apply)
		ns.After(0, function() pcall(Map.Apply) end)
	end)
end

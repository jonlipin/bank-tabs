-- Bank Tabs
-- Minimap: a button on the minimap rim.
--
-- Built by hand rather than through LibDBIcon, which this addon does not carry. It sits at a saved
-- angle and dragging it moves it around the rim. Left click opens the saved bank, right click
-- opens the options, shift and left click locks or unlocks the bag and bank windows.

local ADDON, ns = ...

local report = ns.report
local Minimap_ = {}
ns.Minimap = Minimap_

local button

-- Returns the angle in DEGREES, which is the trap here. The game adds its own global atan2 that
-- already answers in degrees, while math.atan2 answers in radians, so running math.deg over
-- whichever one happened to exist multiplies the angle by about fifty seven and sends the button
-- spinning round the rim. Each route is converted on its own terms.
local function AngleDegrees(y, x)
	if math.atan2 then
		report["minimap angle"] = report["minimap angle"] or "math.atan2, radians"
		return math.deg(math.atan2(y, x))
	end
	if atan2 then
		-- The game's own global, already in degrees.
		report["minimap angle"] = report["minimap angle"] or "the game's atan2, degrees"
		return atan2(y, x)
	end
	report["minimap angle"] = report["minimap angle"] or "math.atan, radians"
	return math.deg(math.atan(y, x))
end

local function Place()
	if not button then return end
	local angle = math.rad(ns.db.minimap.angle or 205)
	local radius = ((Minimap:GetWidth() or 140) / 2) + 6
	button:ClearAllPoints()
	button:SetPoint("CENTER", Minimap, "CENTER", math.cos(angle) * radius, math.sin(angle) * radius)
end

-- A bag first, the bank's coin and crate after it: the icons every client carries.
local ICONS = {
	"Interface\\Icons\\INV_Misc_Bag_10",
	"Interface\\Icons\\INV_Misc_Bag_08",
	"Interface\\Icons\\INV_Misc_Coin_01",
	"Interface\\Icons\\INV_Box_01",
	"Interface\\Cooldown\\ping4",
	"Interface\\Buttons\\WHITE8X8",
}

local function Icon()
	for _, path in ipairs(ICONS) do
		if ns.TextureExists(path) then
			report["minimap icon"] = path
			return path
		end
	end
	return "Interface\\Buttons\\WHITE8X8"
end

local function Tooltip(self)
	GameTooltip:SetOwner(self, "ANCHOR_LEFT")
	GameTooltip:SetText("Bank Tabs", 1, 1, 1)
	GameTooltip:AddLine(ns.db.enabled and "Bag and bank windows are unlocked" or "Bag and bank windows are locked",
		ns.db.enabled and 0.4 or 1, ns.db.enabled and 0.85 or 0.4, 0.4)

	local banks, bags, guilds = 0, 0, 0
	for _, entry in pairs(ns.vault.chars or {}) do
		if type(entry) == "table" then
			if entry.bank or entry.containers then banks = banks + 1 end
			if entry.bags then bags = bags + 1 end
		end
	end
	for _ in pairs(ns.vault.guilds or {}) do guilds = guilds + 1 end
	GameTooltip:AddLine(banks .. " saved bank" .. (banks == 1 and "" or "s") .. ", " .. bags .. " saved bag"
		.. (bags == 1 and "" or "s") .. ", " .. guilds .. " guild bank" .. (guilds == 1 and "" or "s"), 0.6, 0.85, 1)
	if ns.Vault and ns.Vault.Gold then
		local _, total = ns.Vault.Gold()
		GameTooltip:AddDoubleLine("Account gold", ns.Money(total), 1, 0.82, 0, 1, 1, 1)
	end

	GameTooltip:AddLine(" ")
	GameTooltip:AddLine("Left-click: the saved bank", 0.7, 0.7, 0.7)
	GameTooltip:AddLine("Right-click: the options", 0.7, 0.7, 0.7)
	GameTooltip:AddLine("Shift and left-click: lock or unlock the bag and bank windows", 0.7, 0.7, 0.7)
	GameTooltip:AddLine("Drag: move around the minimap", 0.7, 0.7, 0.7)
	GameTooltip:Show()
end

local function Build()
	button = CreateFrame("Button", "BankTabsMinimapButton", Minimap)
	button.csOurs = true
	button:SetSize(31, 31)
	button:SetFrameStrata("MEDIUM")
	button:SetFrameLevel((Minimap:GetFrameLevel() or 1) + 8)
	button:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	button:RegisterForDrag("LeftButton")
	button:SetHighlightTexture("Interface\\Minimap\\UI-Minimap-ZoomButton-Highlight")

	local backing = button:CreateTexture(nil, "BACKGROUND")
	backing:SetSize(20, 20)
	backing:SetPoint("TOPLEFT", 7, -5)
	backing:SetTexture("Interface\\Minimap\\UI-Minimap-Background")

	local icon = button:CreateTexture(nil, "ARTWORK")
	icon:SetSize(17, 17)
	icon:SetPoint("TOPLEFT", 8, -6)
	icon:SetTexture(Icon())

	local border = button:CreateTexture(nil, "OVERLAY")
	border:SetSize(53, 53)
	border:SetPoint("TOPLEFT")
	border:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")

	button:SetScript("OnClick", function(_, which)
		if which == "RightButton" then
			if ns.ToggleOptions then ns.ToggleOptions() end
		elseif IsShiftKeyDown and IsShiftKeyDown() then
			ns.db.enabled = not ns.db.enabled
			ns.Refresh()
			if ns.SyncOptions then pcall(ns.SyncOptions) end
			ns.Print("bag and bank windows are now " .. (ns.db.enabled and "unlocked" or "locked") .. ".")
		else
			if ns.VaultUI and ns.VaultUI.Toggle then ns.VaultUI.Toggle("bank") end
		end
	end)

	button:SetScript("OnDragStart", function(self)
		self:SetScript("OnUpdate", function()
			local mx, my = Minimap:GetCenter()
			local scale = Minimap:GetEffectiveScale()
			local cx, cy = GetCursorPosition()
			if not (mx and my and cx and cy and scale and scale ~= 0) then return end
			ns.db.minimap.angle = AngleDegrees(cy / scale - my, cx / scale - mx) % 360
			Place()
		end)
	end)
	button:SetScript("OnDragStop", function(self)
		self:SetScript("OnUpdate", nil)
		ns.MirrorToAccount()
	end)

	button:SetScript("OnEnter", Tooltip)
	button:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

function Minimap_.Apply()
	if not Minimap or not ns.db then return end
	if not button then
		-- Nothing is built until it is actually wanted, so turning it off costs nothing.
		if not ns.db.minimap.shown then return end
		local ok, err = pcall(Build)
		report["minimap button"] = ok and "ok" or ("failed: " .. tostring(err))
		if not ok then return end
	end
	button:SetShown(ns.db.minimap.shown)
	Place()
end

function Minimap_.Init()
	report["minimap frame"] = Minimap and "found" or "no Minimap on this client"
end

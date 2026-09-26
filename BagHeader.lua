-- Bank Tabs
-- BagHeader: the three icons in the backpack's header that open the saved bank, the saved bags
-- and the saved guild bank.
--
-- Where they go is worked out rather than guessed: the header band is measured for a stretch that
-- none of the game's own buttons are sitting on, and the widest clear stretch at the right hand
-- end wins. If the header is full, they sit just above the window instead. They are also raised
-- above the drag strip, which would otherwise swallow their clicks.

local ADDON, ns = ...

local report = ns.report
local BagHeader = {}
ns.BagHeader = BagHeader

local holders = {}
local hooked = {}

local BAND = 26
local ICON = 20
local ICON_GAP = 3

-- Each button tries the game's own atlas first and falls back to an icon file that every client
-- carries. The bag icon is the one the game's own bag button uses.
-- The fallback lists never share a file, so the three stay telling apart even with no atlas.
local BUTTONS = {
	{ key = "bank", mode = "bank", label = "Saved bank", atlas = "Banker",
		icons = { "Interface\\Icons\\INV_Misc_Coin_01", "Interface\\Icons\\INV_Misc_Coin_02" } },
	{ key = "bags", mode = "bags", label = "Saved bags",
		icons = { "Interface\\Icons\\INV_Misc_Bag_08", "Interface\\Icons\\INV_Misc_Bag_10" } },
	{ key = "guild", mode = "guild", label = "Saved guild bank", atlas = "GuildBanker",
		icons = { "Interface\\Icons\\INV_Box_01", "Interface\\Icons\\INV_Crate_01" } },
}

-- SetAtlas does not raise for a name the client lacks, so the atlas table is asked first.
local function HasAtlas(atlas)
	if not (C_Texture and C_Texture.GetAtlasInfo) then return false end
	local ok, info = pcall(C_Texture.GetAtlasInfo, atlas)
	return ok and info ~= nil
end

local function IsBackpack(frame)
	if frame == _G.ContainerFrameCombinedBags then return true end
	local id = frame.GetID and frame:GetID() or nil
	return id == 0
end

local function GuildRecord()
	local key = ns.Vault and ns.Vault.GuildKey and ns.Vault.GuildKey()
	if key and ns.vault.guilds[key] then return key, ns.vault.guilds[key] end
	for savedKey, record in pairs(ns.vault.guilds or {}) do return savedKey, record end
	return nil
end

local function Ago(record)
	if not record or type(record.time) ~= "number" then return "never checked" end
	local seconds = time() - record.time
	if seconds < 3600 then return math.max(1, math.floor(seconds / 60)) .. " minutes ago" end
	if seconds < 86400 then return math.floor(seconds / 3600) .. " hours ago" end
	return math.floor(seconds / 86400) .. " days ago"
end

local function CountItems(record, isGuild)
	if not record then return 0 end
	if not isGuild then return record.items or 0 end
	local total = 0
	for _, tab in pairs(record.tabs or {}) do total = total + #(tab.items or {}) end
	return total
end

-- What each button reports about itself when hovered.
local function Describe(spec)
	local entry = ns.Vault.CharRecord(ns.Who())
	if spec.key == "bank" then
		local record = entry and entry.bank
		if record then return CountItems(record) .. " items, checked " .. Ago(record), true end
		return "Nothing saved yet. Open your bank once.", false
	elseif spec.key == "bags" then
		local record = entry and entry.bags
		local others = #ns.Vault.Characters("bags")
		if record then
			return CountItems(record) .. " items, checked " .. Ago(record)
				.. (others > 1 and (", and " .. (others - 1) .. " other character" .. (others == 2 and "" or "s")) or ""), true
		end
		return "Read a few seconds after you log in.", false
	else
		local key, record = GuildRecord()
		if record then return key .. ": " .. CountItems(record, true) .. " items, checked " .. Ago(record), true end
		return "Nothing saved yet. Open the guild bank once.", false
	end
end

local function PaintIcon(texture, spec)
	if spec.atlas and HasAtlas(spec.atlas) and pcall(texture.SetAtlas, texture, spec.atlas) then
		report["bag icon " .. spec.key] = "atlas " .. spec.atlas
		return
	end
	for _, path in ipairs(spec.icons) do
		if ns.TextureExists(path) then
			texture:SetTexture(path)
			texture:SetTexCoord(0.07, 0.93, 0.07, 0.93)
			report["bag icon " .. spec.key] = path
			return
		end
	end
	texture:SetColorTexture(0.6, 0.5, 0.3, 0.9)
	report["bag icon " .. spec.key] = "painted (no art resolved)"
end

local function BuildHolder(frame)
	local holder = CreateFrame("Frame", nil, frame)
	holder.csOurs = true
	holder:SetSize(#BUTTONS * ICON + (#BUTTONS - 1) * ICON_GAP, ICON)
	holder.buttons = {}

	local x = 0
	for _, spec in ipairs(BUTTONS) do
		local button = CreateFrame("Button", nil, holder)
		button.csOurs = true
		button:SetSize(ICON, ICON)
		button:SetPoint("LEFT", x, 0)
		x = x + ICON + ICON_GAP

		local backing = button:CreateTexture(nil, "BACKGROUND")
		backing:SetPoint("TOPLEFT", -1, 1)
		backing:SetPoint("BOTTOMRIGHT", 1, -1)
		backing:SetColorTexture(0, 0, 0, 0.7)

		local icon = button:CreateTexture(nil, "ARTWORK")
		icon:SetAllPoints()
		PaintIcon(icon, spec)
		button.icon = icon

		local hover = button:CreateTexture(nil, "HIGHLIGHT")
		hover:SetAllPoints()
		hover:SetColorTexture(1, 1, 1, 0.2)

		button:SetScript("OnClick", function()
			if ns.VaultUI then ns.VaultUI.Show(spec.mode) end
		end)
		button:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
			GameTooltip:SetText(spec.label, 1, 1, 1)
			local detail, has = Describe(spec)
			GameTooltip:AddLine(detail, has and 0.7 or 0.8, has and 0.85 or 0.8, has and 1 or 0.8, true)
			GameTooltip:Show()
		end)
		button:SetScript("OnLeave", function() GameTooltip:Hide() end)
		holder.buttons[spec.key] = button
	end

	holders[frame] = holder
	return holder
end

-- Finds somewhere in the header this can sit without covering one of the game's own buttons.
local function PlaceHolder(frame, holder, width)
	local left, bottom, frameWidth = ns.Windows.Measure(frame)
	local ratio = ns.Windows.Ratio(frame)
	if left and frameWidth and frameWidth > 0 then
		local gaps = ns.Windows.HeaderGaps(frame, BAND, width + 8)
		-- The rightmost clear stretch, which on a bag window is the space before the close button.
		local pick = gaps[#gaps]
		if pick then
			holder:ClearAllPoints()
			local inset = (pick[2] - pick[1] - width) / 2
			holder:SetPoint("TOPLEFT", frame, "TOPLEFT", (pick[1] - left + inset) * ratio, -4 * ratio)
			report["bag buttons"] = "in the header"
			return true
		end
	end
	-- The header is full, so they go just above the window where nothing else is drawn.
	holder:ClearAllPoints()
	holder:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", 8, 2)
	report["bag buttons"] = "above the window (the header had no room)"
	return false
end

function BagHeader.Update(frame)
	if not frame or not ns.db then return end
	-- The money readout on a bag window shows every character's gold on hover.
	if IsBackpack(frame) then ns.HookMoneyFrame(frame, "bags") end

	-- The game hands its bag frames out as it needs them, so the frame that was the backpack last
	-- time can be bag 1 this time; a holder built on it then has to go away.
	local wanted = ns.db.enabled and ns.db.vault.bagButtons and IsBackpack(frame)
	local holder = holders[frame]

	if not wanted then
		if holder then holder:Hide() end
		return
	end
	if not holder then holder = BuildHolder(frame) end

	-- A button with nothing behind it is dimmed rather than hidden, so the row keeps its shape.
	for _, spec in ipairs(BUTTONS) do
		local _, has = Describe(spec)
		holder.buttons[spec.key].icon:SetAlpha(has and 1 or 0.4)
	end

	local width = holder:GetWidth() or 66
	if frame:IsShown() then PlaceHolder(frame, holder, width) end
	-- Above the drag strip, which covers this same band and would take the clicks otherwise.
	ns.RaiseOver(holder, frame, 6)
	local level = (holder:GetFrameLevel() or 1) + 1
	for _, button in pairs(holder.buttons) do pcall(button.SetFrameLevel, button, level) end
	holder:Show()
end

function BagHeader.Apply()
	for frame in pairs(holders) do pcall(BagHeader.Update, frame) end
	BagHeader.Sweep()
end

-- Hooks every bag window once, so the buttons appear whether or not that window is being moved.
function BagHeader.Sweep()
	-- The bank's money readout too, once the bank window exists.
	if _G.BankFrame then ns.HookMoneyFrame(_G.BankFrame, "bank") end
	for _, name in ipairs(ns.Windows.CONTAINER_NAMES or {}) do
		local frame = _G[name]
		if type(frame) == "table" and frame.HookScript and not hooked[frame] then
			hooked[frame] = true
			frame:HookScript("OnShow", function()
				pcall(BagHeader.Update, frame)
				ns.After(0, function() pcall(BagHeader.Update, frame) end)
			end)
			if frame:IsShown() then pcall(BagHeader.Update, frame) end
		end
	end
end

function BagHeader.Init()
	BagHeader.Sweep()
	ns.After(2, BagHeader.Sweep)
	ns.After(8, BagHeader.Sweep)
end

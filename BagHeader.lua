-- Bank Tabs
-- BagHeader: the Bank, Bags and Guild tabs hanging off the top of the real backpack, which open
-- the saved bank, the saved bags and the saved guild bank.
--
-- They are the character tabs' own kind, built by the same function (ns.CreateTab) and hung by
-- the same one (ns.HangTab): the spellbook's 43 by 37, its tab atlas with the chosen and glowing
-- states, the icon clipped to the tab's shape, a plain bevel where the atlas is missing. They sit
-- above the window's top edge, clear of the portrait, with their feet tucked behind its border one
-- level under the window, so they cover none of the backpack's own title, close button or
-- portrait, and never meet the drag strip, which lies inside the top bar. Being the backpack's
-- children, anchored to it, they go wherever it goes, in the same frame, and hide with it.
--
-- A tab wears its chosen state while its saved window is open, and is dimmed while there is
-- nothing saved for it to show.

local ADDON, ns = ...

local report = ns.report
local BagHeader = {}
ns.BagHeader = BagHeader

local sets = {}   -- frame -> { list = { tab, tab, tab }, byKey = { bank = tab, ... } }
local hooked = {}

-- Left to right. Each tries the game's own atlas first and falls back to an icon file that every
-- client carries; the bag icon is the one the game's own bag button uses. The fallback lists
-- never share a file, so the three stay telling apart even with no atlas.
local TABS = {
	{ key = "bank", label = "Saved bank", atlas = "Banker",
		icons = { "Interface\\Icons\\INV_Misc_Coin_01", "Interface\\Icons\\INV_Misc_Coin_02" } },
	{ key = "bags", label = "Saved bags",
		icons = { "Interface\\Icons\\INV_Misc_Bag_08", "Interface\\Icons\\INV_Misc_Bag_10" } },
	{ key = "guild", label = "Saved guild bank", atlas = "GuildBanker",
		icons = { "Interface\\Icons\\INV_Box_01", "Interface\\Icons\\INV_Crate_01" } },
}

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

local function Plural(n, word)
	return n .. " " .. word .. (n == 1 and "" or "s")
end

-- What each tab says about itself when hovered, and whether it has anything to show.
local function Describe(spec)
	if spec.key == "bank" then
		local mine = ns.Vault.CharRecord(ns.Who())
		mine = mine and mine.bank
		local others = #ns.Vault.Characters("bank") - (mine and 1 or 0)
		local text = mine and ("Yours: " .. CountItems(mine) .. " items, checked " .. Ago(mine) .. ".")
			or "Yours is not saved yet: open your bank once."
		if others > 0 then text = text .. " And " .. Plural(others, "other character") .. "." end
		return text, (mine or others > 0) and true or false
	elseif spec.key == "bags" then
		-- The saved bags are the other characters': this one's are the backpack in front of it.
		local others = ns.VaultUI and ns.VaultUI.Characters("bags") or {}
		if #others == 0 then
			return "No other characters saved yet. Log in on another character and its bags are saved a few seconds later.", false
		end
		if #others == 1 then
			return ns.ShortLabel(others[1].who) .. "'s bags, checked " .. Ago(others[1].entry.bags) .. ".", true
		end
		return Plural(#others, "other character") .. "' bags.", true
	else
		local key, record = GuildRecord()
		if record then return key .. ": " .. CountItems(record, true) .. " items, checked " .. Ago(record) .. ".", true end
		return "Nothing saved yet: open the guild bank once.", false
	end
end

local function PaintIcon(texture, spec)
	if spec.atlas and ns.HasAtlas(spec.atlas) and pcall(texture.SetAtlas, texture, spec.atlas) then
		report["backpack tab icon " .. spec.key] = "atlas " .. spec.atlas
		return
	end
	for _, path in ipairs(spec.icons) do
		if ns.TextureExists(path) then
			texture:SetTexture(path)
			texture:SetTexCoord(0.07, 0.93, 0.07, 0.93)
			report["backpack tab icon " .. spec.key] = path
			return
		end
	end
	texture:SetColorTexture(0.6, 0.5, 0.3, 0.9)
	report["backpack tab icon " .. spec.key] = "painted (no art resolved)"
end

local function BuildSet(frame)
	local set = { list = {}, byKey = {} }
	for index, spec in ipairs(TABS) do
		local tab = ns.CreateTab(frame)
		tab.csHeaderKind = spec.key
		PaintIcon(tab.icon, spec)
		tab:SetScript("OnClick", function(self)
			self:SetChecked(false)
			if ns.VaultUI then ns.VaultUI.Toggle(spec.key) end
		end)
		tab:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_TOP")
			GameTooltip:SetText(spec.label, 1, 1, 1)
			local detail, has = Describe(spec)
			GameTooltip:AddLine(detail, has and 0.7 or 0.8, has and 0.85 or 0.8, has and 1 or 0.8, true)
			GameTooltip:Show()
		end)
		tab:SetScript("OnLeave", function() GameTooltip:Hide() end)
		set.list[index] = tab
		set.byKey[spec.key] = tab
	end
	sets[frame] = set
	return set
end

-- Chosen while the saved window is open, dimmed while there is nothing saved for it.
local function Paint(set)
	for index, spec in ipairs(TABS) do
		local tab = set.list[index]
		local _, has = Describe(spec)
		tab:SetDimmed(not has)
		tab:SetChosen(ns.VaultUI and ns.VaultUI.IsShown(spec.key))
	end
end

function BagHeader.Update(frame)
	if not frame or not ns.db then return end
	-- The money readout on a bag window shows every character's gold on hover.
	if IsBackpack(frame) then ns.HookMoneyFrame(frame, "bags") end

	-- The game hands its bag frames out as it needs them, so the frame that was the backpack last
	-- time can be bag 1 this time; the tabs built on it then have to go away.
	local wanted = ns.db.enabled and ns.db.vault.bagButtons and IsBackpack(frame)
	local set = sets[frame]

	if not wanted then
		if set then for _, tab in ipairs(set.list) do tab:Hide() end end
		return
	end
	if not set then set = BuildSet(frame) end

	-- Hung again every time, so they stay one level under the window whatever level the game
	-- has raised it to.
	for index, tab in ipairs(set.list) do
		ns.HangTab(tab, frame, index - 1, 0)
		tab:Show()
	end
	Paint(set)
	report["backpack tabs"] = "above the top edge of " .. tostring(frame.GetName and frame:GetName() or "the backpack")
end

-- The chosen and dimmed states again, after a saved window opens or closes or a snapshot lands.
function BagHeader.Refresh()
	for _, set in pairs(sets) do
		if set.list[1] and set.list[1]:IsShown() then Paint(set) end
	end
end

function BagHeader.Apply()
	for frame in pairs(sets) do pcall(BagHeader.Update, frame) end
	BagHeader.Sweep()
end

-- The tabs on a bag window, keyed "bank", "bags" and "guild", or nil if it has none.
function BagHeader.Tabs(frame)
	return sets[frame] and sets[frame].byKey or nil
end

-- Hooks every bag window once, so the tabs appear whether or not that window is being moved.
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

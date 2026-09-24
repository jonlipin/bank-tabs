-- Casement
-- Vault: remembering what the bank and the guild bank hold.
--
-- A snapshot is taken whenever the window is open and something in it changes, and it is kept in
-- the account wide saved variables so that every character can look at every other character's
-- bank, and at any guild bank this account has opened.
--
-- Two things about this client shape the bank scan:
--  * the real bank storage is the CharacterBankTab containers. The legacy bank container (-1)
--    still reports slots but is a ghost, so it is skipped whenever a real tab exists.
--  * container ids move between builds, so the list of bank containers is worked out from
--    Enum.BagIndex at run time rather than being hardcoded.

local ADDON, ns = ...

local report = ns.report
local Vault = {}
ns.Vault = Vault

local MAX_GUILD_TAB_SLOTS = 98

-- ------------------------------------------------------------------
-- Container API, old and new
-- ------------------------------------------------------------------

local function NumSlots(bag)
	if C_Container and C_Container.GetContainerNumSlots then
		local ok, n = pcall(C_Container.GetContainerNumSlots, bag)
		if ok and type(n) == "number" then return n end
		return 0
	end
	if GetContainerNumSlots then
		local ok, n = pcall(GetContainerNumSlots, bag)
		if ok and type(n) == "number" then return n end
	end
	return 0
end

local function ItemName(link)
	if type(link) ~= "string" then return nil end
	local name = link:match("%[(.-)%]")
	if name and name ~= "" then return name end
	local getter = (C_Item and C_Item.GetItemInfo) or GetItemInfo
	if getter then
		local ok, itemName = pcall(getter, link)
		if ok and itemName then return itemName end
	end
	return nil
end
Vault.ItemName = ItemName

local function ContainerItem(bag, slot)
	if C_Container and C_Container.GetContainerItemInfo then
		local ok, info = pcall(C_Container.GetContainerItemInfo, bag, slot)
		if not ok or type(info) ~= "table" then return nil end
		return {
			slot = slot,
			icon = info.iconFileID,
			count = info.stackCount or 1,
			quality = info.quality,
			link = info.hyperlink,
			id = info.itemID,
			name = ItemName(info.hyperlink),
		}
	end
	if GetContainerItemInfo then
		local ok, icon, count, _, quality, _, _, link = pcall(GetContainerItemInfo, bag, slot)
		if not ok or not icon then return nil end
		return {
			slot = slot,
			icon = icon,
			count = count or 1,
			quality = quality,
			link = link,
			id = link and tonumber(tostring(link):match("item:(%d+)")) or nil,
			name = ItemName(link),
		}
	end
	return nil
end

-- ------------------------------------------------------------------
-- Which containers make up the bank
-- ------------------------------------------------------------------

local function PrettyBagName(name, id)
	local tab = name:match("^CharacterBankTab_?(%d+)$")
	if tab then return "Bank tab " .. tab end
	tab = name:match("^AccountBankTab_?(%d+)$")
	if tab then return "Account tab " .. tab end
	tab = name:match("^Bankbag_?(%d+)$") or name:match("^BankBag_?(%d+)$")
	if tab then return "Bank bag " .. tab end
	if name:lower() == "reagentbank" then return "Reagent bank" end
	if name:lower() == "bank" then return "Bank" end
	return name .. " (" .. id .. ")"
end

-- Every container that belongs to the bank, in a sensible order, with only the ones that actually
-- have slots right now.
function Vault.BankContainers()
	local candidates, seen = {}, {}
	local hasCharacterTab = false

	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		for name, id in pairs(Enum.BagIndex) do
			if type(name) == "string" and type(id) == "number" and name:lower():find("bank") then
				candidates[#candidates + 1] = { id = id, label = PrettyBagName(name, id), raw = name }
				if name:find("CharacterBankTab") and NumSlots(id) > 0 then hasCharacterTab = true end
			end
		end
	end

	if #candidates == 0 then
		-- No enum to read, so fall back to the container ids the classic client uses.
		candidates[#candidates + 1] = { id = -1, label = "Bank", raw = "Bank" }
		candidates[#candidates + 1] = { id = -3, label = "Reagent bank", raw = "Reagentbank" }
		for i = 5, 11 do
			candidates[#candidates + 1] = { id = i, label = "Bank bag " .. (i - 4), raw = "Bankbag" }
		end
	end

	table.sort(candidates, function(a, b)
		if a.id < 0 and b.id >= 0 then return true end
		if b.id < 0 and a.id >= 0 then return false end
		if a.id < 0 and b.id < 0 then return a.id > b.id end
		return a.id < b.id
	end)

	local out = {}
	for _, entry in ipairs(candidates) do
		-- The legacy bank container is a ghost once the real tabs exist: it reports slots but the
		-- client refuses every drop into it, so it has nothing worth saving.
		local ghost = hasCharacterTab and entry.id == -1
		local slots = NumSlots(entry.id)
		if slots > 0 and not ghost and not seen[entry.id] then
			seen[entry.id] = true
			out[#out + 1] = { id = entry.id, label = entry.label, slots = slots }
		end
	end
	return out
end

-- ------------------------------------------------------------------
-- Taking a bank snapshot
-- ------------------------------------------------------------------

local function BankIsOpen()
	local frame = _G.BankFrame
	if frame and frame.IsShown and frame:IsShown() then return true end
	return Vault.bankOpen and true or false
end
Vault.BankIsOpen = BankIsOpen

function Vault.SnapshotBank(reason)
	if not ns.vault then return nil end
	local containers = Vault.BankContainers()
	if #containers == 0 then
		report["bank scan"] = "no bank containers reported any slots"
		return nil
	end

	local record = {
		time = time(),
		reason = reason,
		money = GetMoney and GetMoney() or nil,
		containers = {},
		items = 0,
		slots = 0,
		free = 0,
	}

	for _, container in ipairs(containers) do
		local bucket = { id = container.id, label = container.label, slots = container.slots, items = {} }
		for slot = 1, container.slots do
			local item = ContainerItem(container.id, slot)
			if item then
				bucket.items[#bucket.items + 1] = item
				record.items = record.items + 1
			end
		end
		record.slots = record.slots + container.slots
		record.free = record.free + (container.slots - #bucket.items)
		record.containers[#record.containers + 1] = bucket
	end

	local who = ns.Who()
	if UnitClass then
		local ok, _, token = pcall(UnitClass, "player")
		if ok then record.class = token end
	end
	record.level = UnitLevel and UnitLevel("player") or nil

	ns.vault.chars[who] = record
	report["bank scan"] = record.items .. " items in " .. #record.containers .. " containers ("
		.. tostring(reason) .. ")"
	if ns.VaultUI and ns.VaultUI.Refresh then pcall(ns.VaultUI.Refresh) end
	return record
end

-- ------------------------------------------------------------------
-- Taking a guild bank snapshot
-- ------------------------------------------------------------------

local function GuildKey()
	if not GetGuildInfo then return nil end
	local ok, name = pcall(GetGuildInfo, "player")
	if not ok or not name or name == "" then return nil end
	local realm = GetRealmName and GetRealmName() or ""
	if realm ~= "" then return name .. " - " .. realm end
	return name
end
Vault.GuildKey = GuildKey

local function GuildBankIsOpen()
	local frame = _G.GuildBankFrame
	if frame and frame.IsShown and frame:IsShown() then return true end
	return Vault.guildOpen and true or false
end
Vault.GuildBankIsOpen = GuildBankIsOpen

local function ScanGuildTab(tab)
	if not GetGuildBankItemInfo then return nil end
	local info = { tab = tab, items = {} }
	if GetGuildBankTabInfo then
		local ok, name, icon, viewable = pcall(GetGuildBankTabInfo, tab)
		if ok then
			info.name = name
			info.icon = icon
			info.viewable = viewable
		end
	end
	if info.viewable == false then return info end

	for slot = 1, MAX_GUILD_TAB_SLOTS do
		local ok, texture, count, _, _, quality = pcall(GetGuildBankItemInfo, tab, slot)
		if ok and texture then
			local link
			if GetGuildBankItemLink then
				local gotLink, value = pcall(GetGuildBankItemLink, tab, slot)
				if gotLink then link = value end
			end
			info.items[#info.items + 1] = {
				slot = slot,
				icon = texture,
				count = count or 1,
				quality = quality,
				link = link,
				id = link and tonumber(tostring(link):match("item:(%d+)")) or nil,
				name = ItemName(link),
			}
		end
	end
	return info
end

-- The server only hands over one tab at a time and only after it has been asked for, so the walk
-- asks for each tab in turn and reads it a moment later. The tab the user was looking at is put
-- back at the end.
function Vault.SnapshotGuildBank(reason)
	if not ns.vault then return nil end
	local key = GuildKey()
	if not key then
		report["guild bank scan"] = "no guild"
		return nil
	end
	if not GetNumGuildBankTabs then
		report["guild bank scan"] = "the guild bank API is not on this client"
		return nil
	end

	local ok, tabs = pcall(GetNumGuildBankTabs)
	if not ok or not tabs or tabs == 0 then
		report["guild bank scan"] = "no tabs reported"
		return nil
	end

	local current
	if GetCurrentGuildBankTab then
		local gotTab, value = pcall(GetCurrentGuildBankTab)
		if gotTab then current = value end
	end

	local record = ns.vault.guilds[key] or {}
	record.time = time()
	record.reason = reason
	record.tabs = record.tabs or {}
	if GetGuildBankMoney then
		local gotMoney, money = pcall(GetGuildBankMoney)
		if gotMoney then record.money = money end
	end
	ns.vault.guilds[key] = record

	for tab = 1, tabs do
		local delay = 0.5 * (tab - 1)
		ns.After(delay, function()
			if QueryGuildBankTab then pcall(QueryGuildBankTab, tab) end
		end)
		ns.After(delay + 0.4, function()
			local info = ScanGuildTab(tab)
			if info then
				record.tabs[tab] = info
				record.items = 0
				for _, bucket in pairs(record.tabs) do record.items = record.items + #bucket.items end
				report["guild bank scan"] = record.items .. " items over " .. tabs .. " tabs (" .. tostring(reason) .. ")"
				if ns.VaultUI and ns.VaultUI.Refresh then pcall(ns.VaultUI.Refresh) end
			end
		end)
	end

	if current and SetCurrentGuildBankTab then
		ns.After(0.5 * tabs + 0.5, function() pcall(SetCurrentGuildBankTab, current) end)
	end
	return record
end

-- ------------------------------------------------------------------
-- Manual snapshots and housekeeping
-- ------------------------------------------------------------------

function Vault.SnapshotNow()
	local done = {}
	if BankIsOpen() then
		local record = Vault.SnapshotBank("asked for")
		if record then done[#done + 1] = record.items .. " items in the bank" end
	end
	if GuildBankIsOpen() then
		local record = Vault.SnapshotGuildBank("asked for")
		if record then done[#done + 1] = "the guild bank is being read tab by tab" end
	end
	if #done == 0 then
		return "nothing to save: open the bank or the guild bank first, then try again."
	end
	return "saved " .. table.concat(done, " and ") .. "."
end

function Vault.Forget(kind, key)
	if kind == "char" then
		ns.vault.chars[key] = nil
	elseif kind == "guild" then
		ns.vault.guilds[key] = nil
	end
	if ns.VaultUI and ns.VaultUI.Refresh then pcall(ns.VaultUI.Refresh) end
end

function Vault.Sources()
	local out = {}
	local me = ns.Who()
	for key, record in pairs(ns.vault.chars or {}) do
		out[#out + 1] = { kind = "char", key = key, label = key, record = record, mine = key == me }
	end
	for key, record in pairs(ns.vault.guilds or {}) do
		out[#out + 1] = { kind = "guild", key = key, label = key, record = record }
	end
	table.sort(out, function(a, b)
		if a.kind ~= b.kind then return a.kind == "char" end
		if a.mine ~= b.mine then return a.mine and true or false end
		return a.label < b.label
	end)
	return out
end

-- ------------------------------------------------------------------
-- Events
-- ------------------------------------------------------------------

-- Bank changes arrive one slot at a time, so the scan waits for the storm to pass.
local bankPending = false
local function QueueBankScan(reason)
	if bankPending or not BankIsOpen() then return end
	bankPending = true
	ns.After(0.4, function()
		bankPending = false
		if BankIsOpen() then Vault.SnapshotBank(reason) end
	end)
end

function Vault.OnEvent(event, ...)
	if event == "BANKFRAME_OPENED" then
		Vault.bankOpen = true
		if ns.db.vault.autoBank then
			-- The container sizes are not filled in the instant the window opens.
			ns.After(0.3, function() if BankIsOpen() then Vault.SnapshotBank("bank opened") end end)
		end

	elseif event == "BANKFRAME_CLOSED" then
		if ns.db.vault.autoBank and Vault.bankOpen then Vault.SnapshotBank("bank closed") end
		Vault.bankOpen = false

	elseif event == "PLAYERBANKSLOTS_CHANGED" or event == "PLAYERBANKBAGSLOTS_CHANGED"
		or event == "PLAYERREAGENTBANKSLOTS_CHANGED" then
		if ns.db.vault.autoBank then QueueBankScan("bank changed") end

	elseif event == "BAG_UPDATE_DELAYED" then
		if ns.db.vault.autoBank and BankIsOpen() then QueueBankScan("bags settled") end

	elseif event == "GUILDBANKFRAME_OPENED" then
		Vault.guildOpen = true
		if ns.db.vault.autoGuild then
			ns.After(0.5, function() if GuildBankIsOpen() then Vault.SnapshotGuildBank("guild bank opened") end end)
		end

	elseif event == "GUILDBANKFRAME_CLOSED" then
		Vault.guildOpen = false

	elseif event == "GUILDBANKBAGSLOTS_CHANGED" then
		if not (ns.db.vault.autoGuild and GuildBankIsOpen()) then return end
		-- Only the tab on screen is refreshed here; the full walk happens when the window opens.
		local tab
		if GetCurrentGuildBankTab then
			local ok, value = pcall(GetCurrentGuildBankTab)
			if ok then tab = value end
		end
		if not tab then return end
		local key = GuildKey()
		local record = key and ns.vault.guilds[key]
		if not record then return end
		local info = ScanGuildTab(tab)
		if info then
			record.tabs[tab] = info
			record.time = time()
			if ns.VaultUI and ns.VaultUI.Refresh then pcall(ns.VaultUI.Refresh) end
		end
	end
end

function Vault.Init()
	if not ns.db.vault.keepOtherCharacters then
		local me = ns.Who()
		for key in pairs(ns.vault.chars) do
			if key ~= me then ns.vault.chars[key] = nil end
		end
	end
	local chars, guilds = 0, 0
	for _ in pairs(ns.vault.chars) do chars = chars + 1 end
	for _ in pairs(ns.vault.guilds) do guilds = guilds + 1 end
	report["vault holds"] = chars .. " character banks, " .. guilds .. " guild banks"
	report["container api"] = (C_Container and C_Container.GetContainerItemInfo) and "C_Container"
		or (GetContainerItemInfo and "classic globals" or "none found")
	report["guild bank api"] = GetGuildBankItemInfo and "ok" or "not on this client"
end

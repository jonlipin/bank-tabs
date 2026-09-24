-- Casement
-- Vault: remembering what the bank, the bags and the guild bank hold.
--
-- Everything is kept in the account wide saved variables, one entry per character, so that any
-- character can look at any other's bank and bags, and at any guild bank this account has opened.
--
--   chars[who] = { class, level, bank = record, bags = record }
--   record     = { time, money, containers = { { id, label, slots, items = { {slot, id, ...} } } },
--                  bagSlots or equipped = the bags themselves, items, slots, free }
--
-- Every item is stored with the slot it sat in, so the vault window can draw it exactly where it
-- was rather than packing things together.
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
local NUM_BANK_BAG_SLOTS = 7
local NUM_BAGS = 4

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

local function ReagentBagIndex()
	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		local id = Enum.BagIndex.ReagentBag
		if type(id) == "number" then return id end
	end
	return nil
end

-- The inventory slot a container hangs off, which is how the bag item itself (its icon and link)
-- is found.
local function InventoryIDFor(bag)
	local getter = (C_Container and C_Container.ContainerIDToInventoryID) or ContainerIDToInventoryID
	if not getter then return nil end
	local ok, id = pcall(getter, bag)
	if ok and type(id) == "number" then return id end
	return nil
end

local function InventoryItem(inv)
	if not inv then return nil, nil end
	local icon, link
	if GetInventoryItemTexture then
		local ok, value = pcall(GetInventoryItemTexture, "player", inv)
		if ok then icon = value end
	end
	if GetInventoryItemLink then
		local ok, value = pcall(GetInventoryItemLink, "player", inv)
		if ok then link = value end
	end
	return icon, link
end

-- Reads one container into a bucket, every item keeping its slot number.
local function ScanContainer(id, label, slots)
	local bucket = { id = id, label = label, slots = slots, items = {} }
	for slot = 1, slots do
		local item = ContainerItem(id, slot)
		if item then bucket.items[#bucket.items + 1] = item end
	end
	return bucket
end

-- ------------------------------------------------------------------
-- The store
-- ------------------------------------------------------------------

-- 1.0.x kept the bank record itself under the character's name. That shape is lifted into the
-- `bank` field the first time it is seen, so nothing already saved is lost.
local function Migrate(who, entry)
	if type(entry) ~= "table" then return nil end
	if entry.containers and not entry.bank then
		local bank = entry
		entry = { class = bank.class, level = bank.level, bank = bank }
		bank.class, bank.level = nil, nil
		ns.vault.chars[who] = entry
	end
	return entry
end

function Vault.CharRecord(who, create)
	local entry = Migrate(who, ns.vault.chars[who])
	if not entry and create then
		entry = {}
		ns.vault.chars[who] = entry
	end
	return entry
end

local function StampCharacter(entry)
	if UnitClass then
		local ok, _, token = pcall(UnitClass, "player")
		if ok and token then entry.class = token end
	end
	if UnitLevel then
		local ok, level = pcall(UnitLevel, "player")
		if ok and type(level) == "number" then entry.level = level end
	end
end

local function Totals(record)
	record.items, record.slots, record.free = 0, 0, 0
	for _, bucket in ipairs(record.containers) do
		record.items = record.items + #bucket.items
		record.slots = record.slots + bucket.slots
		record.free = record.free + (bucket.slots - #bucket.items)
	end
end

-- Every character with something saved, this one first, then alphabetical.
function Vault.Characters(kind)
	local me = ns.Who()
	local out = {}
	for who, raw in pairs(ns.vault.chars or {}) do
		local entry = Migrate(who, raw)
		if entry and (not kind or entry[kind]) then
			out[#out + 1] = { who = who, entry = entry, mine = who == me }
		end
	end
	table.sort(out, function(a, b)
		if a.mine ~= b.mine then return a.mine end
		return a.who < b.who
	end)
	return out
end

-- ------------------------------------------------------------------
-- Which containers make up the bank
-- ------------------------------------------------------------------

-- When more than one enum name shares a container id, the more specific name wins the label, so
-- the same container is not "Bank bag 1" one login and "Bank tab 1" the next.
local NAME_PRIORITY = { CharacterBankTab = 4, Bank = 3, Reagentbank = 2, Bankbag = 1, BankBag = 1 }

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

local function NamePriority(name)
	for prefix, priority in pairs(NAME_PRIORITY) do
		if name:sub(1, #prefix) == prefix then return priority end
	end
	return 0
end

-- Every container that belongs to the bank, in a sensible order, with only the ones that actually
-- have slots right now.
function Vault.BankContainers()
	local byID = {}
	local hasCharacterTab = false

	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		for name, id in pairs(Enum.BagIndex) do
			if type(name) == "string" and type(id) == "number" and name:lower():find("bank") then
				local current = byID[id]
				if not current or NamePriority(name) > current.priority then
					byID[id] = { id = id, label = PrettyBagName(name, id), priority = NamePriority(name), raw = name }
				end
				if name:find("CharacterBankTab") and NumSlots(id) > 0 then hasCharacterTab = true end
			end
		end
	end

	local candidates = {}
	for _, entry in pairs(byID) do candidates[#candidates + 1] = entry end

	if #candidates == 0 then
		-- No enum to read, so fall back to the container ids the classic client uses.
		candidates[#candidates + 1] = { id = -1, label = "Bank" }
		candidates[#candidates + 1] = { id = -3, label = "Reagent bank" }
		for i = 5, 11 do candidates[#candidates + 1] = { id = i, label = "Bank bag " .. (i - 4) } end
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
		if slots > 0 and not ghost then
			out[#out + 1] = { id = entry.id, label = entry.label, slots = slots }
		end
	end
	return out
end

-- The seven Bag Slots along the bottom of the bank window: which are purchased, which hold a bag,
-- and which container each bag opens as.
local function BankBagSlots()
	local slots = {}
	local purchased
	if GetNumBankSlots then
		local ok, count = pcall(GetNumBankSlots)
		if ok and type(count) == "number" then purchased = count end
	end

	-- Any container that could be one of these bags, matched to its slot by the inventory id it
	-- hangs off. Going through the forward function avoids guessing at an offset. The bank's own
	-- tabs are never candidates, whatever inventory id the client answers for them, or a tab could
	-- be filed as a bag and the main grid would come up empty.
	local tabs = { [-1] = true, [-3] = true }
	if type(Enum) == "table" and type(Enum.BagIndex) == "table" then
		for name, id in pairs(Enum.BagIndex) do
			if type(name) == "string" and type(id) == "number"
				and (name:find("CharacterBankTab") or name:find("AccountBankTab") or name == "Bank" or name == "Reagentbank") then
				tabs[id] = true
			end
		end
	end
	local containersByInv = {}
	for id = 5, 17 do
		if not tabs[id] then
			local inv = InventoryIDFor(id)
			if inv then containersByInv[inv] = id end
		end
	end

	for i = 1, NUM_BANK_BAG_SLOTS do
		local inv
		if BankButtonIDToInvSlotID then
			local ok, value = pcall(BankButtonIDToInvSlotID, i, 1)
			if ok and type(value) == "number" then inv = value end
		end
		local icon, link = InventoryItem(inv)
		-- A container is only filed under a slot that actually holds a bag.
		local id = (icon and inv) and containersByInv[inv] or nil
		slots[i] = {
			inv = inv,
			icon = icon,
			link = link,
			id = id,
			slots = id and NumSlots(id) or 0,
			purchased = (purchased and i <= purchased) or icon ~= nil or false,
		}
	end
	slots.purchased = purchased
	return slots
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

	local record = { time = time(), reason = reason, money = GetMoney and GetMoney() or nil, containers = {} }
	for _, container in ipairs(containers) do
		record.containers[#record.containers + 1] = ScanContainer(container.id, container.label, container.slots)
	end
	record.bagSlots = BankBagSlots()
	Totals(record)

	local entry = Vault.CharRecord(ns.Who(), true)
	StampCharacter(entry)
	entry.bank = record

	report["bank scan"] = record.items .. " items in " .. #record.containers .. " containers ("
		.. tostring(reason) .. ")"
	if ns.VaultUI and ns.VaultUI.Refresh then pcall(ns.VaultUI.Refresh) end
	return record
end

-- ------------------------------------------------------------------
-- Taking a bags snapshot
-- ------------------------------------------------------------------

-- The bags are always to hand, so this runs at login, when they settle after a change, and at
-- logout, which is what lets another character look at what this one is carrying.
function Vault.SnapshotBags(reason)
	if not ns.vault then return nil end
	local record = { time = time(), reason = reason, money = GetMoney and GetMoney() or nil, containers = {}, equipped = {} }

	local ids = { 0 }
	for i = 1, NUM_BAGS do ids[#ids + 1] = i end
	local reagent = ReagentBagIndex()
	if reagent then ids[#ids + 1] = reagent end

	for _, id in ipairs(ids) do
		local slots = NumSlots(id)
		local label = (id == 0 and "Backpack") or (id == reagent and "Reagent bag") or ("Bag " .. id)
		if slots > 0 then
			record.containers[#record.containers + 1] = ScanContainer(id, label, slots)
		end
		if id ~= 0 then
			local icon, link = InventoryItem(InventoryIDFor(id))
			record.equipped[#record.equipped + 1] = { id = id, icon = icon, link = link, slots = slots, reagent = id == reagent }
		end
	end
	Totals(record)

	local entry = Vault.CharRecord(ns.Who(), true)
	StampCharacter(entry)
	entry.bags = record

	report["bags scan"] = record.items .. " items in " .. #record.containers .. " bags (" .. tostring(reason) .. ")"
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
	local bags = Vault.SnapshotBags("asked for")
	if bags then done[#done + 1] = bags.items .. " items in your bags" end
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

-- The bags change constantly in play, so their scan is held back a few seconds at a time.
local bagsPending = false
local function QueueBagsScan(reason)
	if bagsPending then return end
	bagsPending = true
	ns.After(3, function()
		bagsPending = false
		Vault.SnapshotBags(reason)
	end)
end

function Vault.OnEvent(event, ...)
	if event == "PLAYER_LOGIN" then
		ns.After(3, function() Vault.SnapshotBags("login") end)

	elseif event == "PLAYER_LOGOUT" then
		-- No timers run once this fires, so the bags are read on the spot.
		Vault.SnapshotBags("logout")

	elseif event == "BANKFRAME_OPENED" then
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
		QueueBagsScan("bags changed")

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
	for who, raw in pairs(ns.vault.chars) do Migrate(who, raw) end
	local chars, guilds = 0, 0
	for _ in pairs(ns.vault.chars) do chars = chars + 1 end
	for _ in pairs(ns.vault.guilds) do guilds = guilds + 1 end
	report["vault holds"] = chars .. " characters, " .. guilds .. " guild banks"
	report["container api"] = (C_Container and C_Container.GetContainerItemInfo) and "C_Container"
		or (GetContainerItemInfo and "classic globals" or "none found")
	report["guild bank api"] = GetGuildBankItemInfo and "ok" or "not on this client"
	report["bank bag slots api"] = BankButtonIDToInvSlotID and "BankButtonIDToInvSlotID" or "not on this client"
end

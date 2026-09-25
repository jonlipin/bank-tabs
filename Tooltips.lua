-- Casement
-- Tooltips: a few lines on every item tooltip saying which characters on this account have the
-- item and where, from the saved bank and bag snapshots, with the guild bank and an account total.
--
--   Vatik            bank 20, bags 5
--   Choham           bank 40
--   Night Owls       guild bank 12
--   Total            77
--
-- This character's bags are counted live (they change by the second); everything else is what
-- was saved the last time that bank or those bags were seen. The lookup runs off an index that is
-- rebuilt only when a snapshot changes, so hovering items costs nothing.
--
-- The modern tooltip pipeline (TooltipDataProcessor) is used where the client has it, which is
-- how Leatrix Plus adds its item id line on this client; the older OnTooltipSetItem script is the
-- fallback.

local ADDON, ns = ...

local report = ns.report
local Tooltips = {}
ns.Tooltips = Tooltips

local index = nil    -- itemID or "name:..." -> { chars = { [who] = { bank, bags } }, guilds = { [key] = n } }
local hooked = {}

-- ------------------------------------------------------------------
-- The index
-- ------------------------------------------------------------------

function Tooltips.Invalidate()
	index = nil
end

-- Every item is filed under its id and, separately, under its name, so a tooltip that only knows
-- the name (the game hands some over without a link) still finds it. A lookup uses one or the
-- other, never both, so nothing is counted twice.
local function Keys(item)
	local out = {}
	if type(item.id) == "number" then out[#out + 1] = item.id end
	if type(item.name) == "string" and item.name ~= "" then out[#out + 1] = "name:" .. item.name:lower() end
	return out
end

local function Slot(key)
	local slot = index[key]
	if not slot then
		slot = { chars = {}, guilds = {} }
		index[key] = slot
	end
	return slot
end

local function Build()
	index = {}
	for who in pairs(ns.vault.chars or {}) do
		local entry = ns.Vault.CharRecord(who)
		for _, kind in ipairs({ "bank", "bags" }) do
			local record = entry and entry[kind]
			for _, bucket in ipairs(record and record.containers or {}) do
				for _, item in ipairs(bucket.items or {}) do
					for _, key in ipairs(Keys(item)) do
						local slot = Slot(key)
						local counts = slot.chars[who] or { bank = 0, bags = 0 }
						slot.chars[who] = counts
						counts[kind] = counts[kind] + (item.count or 1)
					end
				end
			end
		end
	end
	for guildKey, record in pairs(ns.vault.guilds or {}) do
		for _, tab in pairs(record.tabs or {}) do
			for _, item in ipairs(tab.items or {}) do
				for _, key in ipairs(Keys(item)) do
					local slot = Slot(key)
					slot.guilds[guildKey] = (slot.guilds[guildKey] or 0) + (item.count or 1)
				end
			end
		end
	end
end

local function Lookup(id, name)
	if not index then Build() end
	local slot = id and index[id]
	if not slot and name then slot = index["name:" .. name:lower()] end
	return slot
end

-- ------------------------------------------------------------------
-- Reading the item off a tooltip
-- ------------------------------------------------------------------

local function ItemID(link)
	if type(link) ~= "string" then return nil end
	return tonumber(link:match("item:(%d+)"))
end

local function TooltipItem(tooltip, data)
	local id, name, link
	if type(data) == "table" and type(data.id) == "number" then id = data.id end
	if tooltip.GetItem then
		local ok, gotName, gotLink = pcall(tooltip.GetItem, tooltip)
		if ok then
			name, link = gotName, gotLink
			id = id or ItemID(link)
		end
	end
	if not name and id and C_Item and C_Item.GetItemInfo then
		local ok, gotName = pcall(C_Item.GetItemInfo, id)
		if ok then name = gotName end
	end
	return id, name, link
end

-- This character's bags, live, since a snapshot can be a few seconds behind.
local function LiveBags(id)
	local getter = (C_Item and C_Item.GetItemCount) or GetItemCount
	if not (getter and id) then return nil end
	local ok, count = pcall(getter, id, false)
	if ok and type(count) == "number" and not (issecretvalue and issecretvalue(count)) then return count end
	return nil
end

local MODIFIERS = {
	none = function() return true end,
	shift = function() return IsShiftKeyDown and IsShiftKeyDown() end,
	ctrl = function() return IsControlKeyDown and IsControlKeyDown() end,
	alt = function() return IsAltKeyDown and IsAltKeyDown() end,
}

local function Wanted()
	local db = ns.db and ns.db.tooltips
	if not (db and db.enabled) then return false end
	local check = MODIFIERS[db.modifier or "none"] or MODIFIERS.none
	local ok, down = pcall(check)
	return ok and down and true or false
end

local function ClassColor(who)
	local entry = ns.Vault.CharRecord(who)
	local colors = _G.RAID_CLASS_COLORS
	local color = entry and entry.class and colors and colors[entry.class]
	if color and color.r then return color.r, color.g, color.b end
	return 1, 0.82, 0
end

local function ShortName(who)
	return (tostring(who):gsub(" %- .*$", ""))
end

-- ------------------------------------------------------------------
-- Adding the lines
-- ------------------------------------------------------------------

local function AddLines(tooltip, id, name)
	local db = ns.db.tooltips
	local slot = Lookup(id, name)
	local me = ns.Who()
	local rows, total, places = {}, 0, 0

	-- Every character, this one first, with this one's bags counted live.
	local names = {}
	if slot then for who in pairs(slot.chars) do names[#names + 1] = who end end
	local live = LiveBags(id)
	if live and live > 0 and not (slot and slot.chars[me]) then names[#names + 1] = me end
	table.sort(names, function(a, b)
		if (a == me) ~= (b == me) then return a == me end
		return a < b
	end)

	for _, who in ipairs(names) do
		local counts = slot and slot.chars[who] or { bank = 0, bags = 0 }
		local bags = counts.bags
		if who == me and live then bags = live end
		local parts = {}
		if counts.bank > 0 then parts[#parts + 1] = "bank " .. counts.bank end
		if bags > 0 then parts[#parts + 1] = "bags " .. bags end
		if #parts > 0 then
			rows[#rows + 1] = { left = ns.ShortLabel(who), right = table.concat(parts, ", "), who = who }
			total = total + counts.bank + bags
			places = places + #parts
		end
	end

	if db.guild and slot then
		local keys = {}
		for guildKey in pairs(slot.guilds) do keys[#keys + 1] = guildKey end
		table.sort(keys)
		for _, guildKey in ipairs(keys) do
			local count = slot.guilds[guildKey]
			if count > 0 then
				rows[#rows + 1] = { left = ShortName(guildKey), right = "guild bank " .. count, guild = true }
				total = total + count
				places = places + 1
			end
		end
	end

	if #rows == 0 then return 0 end

	for _, row in ipairs(rows) do
		local r, g, b = 0.65, 0.85, 1
		if row.who then r, g, b = ClassColor(row.who) end
		tooltip:AddDoubleLine(row.left, row.right, r, g, b, 1, 1, 1)
	end
	if db.total and places > 1 then
		tooltip:AddDoubleLine("Total", tostring(total), 1, 0.82, 0, 1, 1, 1)
	end
	if tooltip.Show then pcall(tooltip.Show, tooltip) end
	return #rows
end

local function OnItem(tooltip, data)
	if not Wanted() then return end
	if not (tooltip and ns.vault) then return end
	local id, name = TooltipItem(tooltip, data)
	if not id and not name then return end
	-- The older script fires more than once per hover, so the same item is only written once
	-- until the tooltip is cleared.
	local stamp = tostring(id or name)
	if tooltip.csTooltipStamp == stamp then return end
	tooltip.csTooltipStamp = stamp
	AddLines(tooltip, id, name)
end
Tooltips.OnItem = OnItem

-- ------------------------------------------------------------------
-- Hooking in
-- ------------------------------------------------------------------

local function HookLegacy(tooltip, label)
	if not (tooltip and tooltip.HookScript) or hooked[tooltip] then return false end
	hooked[tooltip] = true
	local ok = pcall(tooltip.HookScript, tooltip, "OnTooltipSetItem", function(self) OnItem(self, nil) end)
	pcall(tooltip.HookScript, tooltip, "OnTooltipCleared", function(self) self.csTooltipStamp = nil end)
	return ok
end

function Tooltips.Init()
	if TooltipDataProcessor and TooltipDataProcessor.AddTooltipPostCall
		and type(Enum) == "table" and type(Enum.TooltipDataType) == "table" and Enum.TooltipDataType.Item ~= nil then
		local ok = pcall(TooltipDataProcessor.AddTooltipPostCall, Enum.TooltipDataType.Item, function(tooltip, data)
			OnItem(tooltip, data)
		end)
		if ok then
			-- The modern pipeline rebuilds the tooltip from scratch each time, so the stamp is
			-- cleared with it.
			for _, name in ipairs({ "GameTooltip", "ItemRefTooltip", "ShoppingTooltip1", "ShoppingTooltip2" }) do
				local tooltip = _G[name]
				if tooltip and tooltip.HookScript then
					pcall(tooltip.HookScript, tooltip, "OnTooltipCleared", function(self) self.csTooltipStamp = nil end)
				end
			end
			report["item tooltips"] = "TooltipDataProcessor"
			return
		end
	end
	local count = 0
	for _, name in ipairs({ "GameTooltip", "ItemRefTooltip", "ShoppingTooltip1", "ShoppingTooltip2" }) do
		if HookLegacy(_G[name], name) then count = count + 1 end
	end
	report["item tooltips"] = count > 0 and ("OnTooltipSetItem on " .. count .. " tooltips") or "no tooltip hook on this client"
end

function Tooltips.Apply()
	-- Nothing to rebuild: the switches are read on every hover.
end

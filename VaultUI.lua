-- Bank Tabs
-- VaultUI: every character's bank, bags and guild bank, drawn the way the game draws them, from
-- wherever you are.
--
-- These are replicas rather than lists. The saved bank has the same portrait-and-title frame as
-- the real one, the search box top right, the slots in the same grid with every empty slot drawn,
-- the Bag Slots row underneath and the money bottom right. The saved bags come as the combined
-- backpack does. The guild bank is seven columns of fourteen filled down each column, tabs down
-- the right hand side. Every item is drawn in the slot it was actually in when it was last seen,
-- never packed.
--
-- The three are separate windows (BankTabsBank, BankTabsBags, BankTabsGuild) that open and close
-- on their own and can all be open at once. Each keeps its own state: the character it shows, the
-- bank bag or guild tab it is on, its search, its cells and its character tabs. Each is built the
-- first time it is opened, can be dragged by its title, and remembers where it was left.
--
-- A row of tabs in the spellbook's style hangs off the top of the saved bank and the saved bags,
-- one per character, built by the same function as the backpack's own tabs (ns.CreateTab). The
-- saved bank has a tab for this character, first, so its own bank can be looked at from anywhere.
-- The saved bags never show this character: its bags are the real backpack in front of it.
--
-- Everything here reads the saved snapshots, never the live bank, so it works anywhere.

local ADDON, ns = ...

local report = ns.report
local VaultUI = {}
ns.VaultUI = VaultUI

local CELL, GAP = 37, 5
local PITCH = CELL + GAP
local BANK_COLS = 8
local BAGS_COLS = 10
local GUILD_COLS, GUILD_ROWS = 7, 14
local GUILD_SLOTS = GUILD_COLS * GUILD_ROWS
local NUM_BAG_SLOTS = 7
local BAG_CELL, BAG_PITCH = 30, 34
local TAB_SIZE, TAB_PITCH = 30, 36

local MARGIN_X, GRID_TOP = 20, 62
local BAG_ROW_H, FOOTER_H = 46, 36

-- How far apart two saved windows open when one opens beside another.
local BESIDE_GAP = 12

local KINDS = { "bank", "bags", "guild" }
local NAMES = { bank = "BankTabsBank", bags = "BankTabsBags", guild = "BankTabsGuild" }
-- Where each window's place is kept in the saved settings, next to the game windows' places.
local POS_KEYS = { bank = "savedBank", bags = "savedBags", guild = "savedGuild" }

local windows = {}  -- kind -> that window's state, once it has been opened
local order = {}    -- the kinds on screen, the one opened or brought forward last at the end
local lastKind = nil
local escSlot = nil -- the index in UISpecialFrames that names the front window

-- The grid geometry each shape is drawn with. The bank's is read off the real bank window when a
-- snapshot is taken (Vault.MeasureBankLayout), so the replica matches this client's bank exactly;
-- until one has been measured, the classic bank's numbers stand in: 37 pixel slots, 12 apart
-- across and 10 down, 48 in from the left edge. The other shapes use the plain grid.
local PLAIN = { cell = CELL, pitchX = PITCH, pitchY = PITCH, originX = MARGIN_X, originY = GRID_TOP }
local CLASSIC_BANK = { cell = 37, pitchX = 49, pitchY = 47, originX = 48, originY = 63, cols = 8,
	bagCell = 24, bagPitch = 38, bagOriginX = 145 }

local function BankGeometry(record)
	-- A record's own measurement, else the account's latest (the same client, the same window). One
	-- that is no grid is passed over: before 2.0.1 a measurement could come out one column wide,
	-- which drew the bank as a single column of items.
	local Plausible = ns.Vault and ns.Vault.PlausibleLayout
	if not Plausible then return CLASSIC_BANK end
	local layout = record and record.layout
	if not Plausible(layout) then layout = ns.vault and ns.vault.bankLayout end
	if Plausible(layout) then
		return {
			cell = layout.cell, pitchX = layout.pitchX, pitchY = layout.pitchY,
			originX = layout.originX, originY = layout.originY, cols = layout.cols or BANK_COLS,
			width = layout.width, height = layout.height,
			bagCell = layout.bagCell or CLASSIC_BANK.bagCell, bagPitch = layout.bagPitch or CLASSIC_BANK.bagPitch,
			bagOriginX = layout.bagOriginX or CLASSIC_BANK.bagOriginX, bagOriginY = layout.bagOriginY,
			bagCount = layout.bagCount,
		}
	end
	return CLASSIC_BANK
end

local CLASS_SHEET = "Interface\\Glues\\CharacterCreate\\UI-CharacterCreate-Classes"

local Refresh -- declared here, defined once the layouts are

-- ------------------------------------------------------------------
-- Small helpers
-- ------------------------------------------------------------------

local function Ago(stamp)
	if type(stamp) ~= "number" then return "never" end
	local seconds = time() - stamp
	if seconds < 90 then return "just now" end
	if seconds < 3600 then return math.floor(seconds / 60) .. " minutes ago" end
	if seconds < 86400 then return math.floor(seconds / 3600) .. " hours ago" end
	return math.floor(seconds / 86400) .. " days ago"
end

local function When(stamp)
	if type(stamp) ~= "number" then return "never checked" end
	local ok, text = pcall(date, "%d %b, %H:%M", stamp)
	if ok and text then return text .. " (" .. Ago(stamp) .. ")" end
	return Ago(stamp)
end

local function QualityColor(quality)
	if type(quality) ~= "number" then return 0.35, 0.35, 0.38 end
	local colors = _G.ITEM_QUALITY_COLORS
	local entry = colors and colors[quality]
	if entry and entry.r then return entry.r, entry.g, entry.b end
	if C_Item and C_Item.GetItemQualityColor then
		local ok, r, g, b = pcall(C_Item.GetItemQualityColor, quality)
		if ok and r then return r, g, b end
	end
	return 0.35, 0.35, 0.38
end

-- With a search in the box the real bank dims every slot that does not match, empty ones too.
local function Matches(W, item)
	if W.filter == "" then return true end
	if not item then return false end
	return (item.name or ""):lower():find(W.filter, 1, true) ~= nil
end

local function ClassLabel(token)
	if not token then return "" end
	local names = _G.LOCALIZED_CLASS_NAMES_MALE
	return (names and names[token]) or (token:sub(1, 1) .. token:sub(2):lower())
end

local function LiveClass()
	if not UnitClass then return nil end
	local ok, _, token = pcall(UnitClass, "player")
	if ok then return token end
	return nil
end

-- Paints a class icon into a texture: the character creation sheet where the client has it, the
-- single icon files otherwise, a bag as a last resort. With `crop`, a tab's icon is cut 7 percent
-- in from each edge of its cell, as item icons are: the sheet draws a bevelled frame round every
-- icon, which showed as a second border inside the tab's own frame (the user saw two layers of
-- border on the saved bank's character tabs). The round portrait keeps the whole cell.
local CLASS_CROP = 0.07
local function SetClassIcon(texture, token, crop)
	local coords = token and _G.CLASS_ICON_TCOORDS and _G.CLASS_ICON_TCOORDS[token]
	if coords and ns.TextureExists(CLASS_SHEET) then
		texture:SetTexture(CLASS_SHEET)
		if crop then
			local w, h = (coords[2] - coords[1]) * CLASS_CROP, (coords[4] - coords[3]) * CLASS_CROP
			texture:SetTexCoord(coords[1] + w, coords[2] - w, coords[3] + h, coords[4] - h)
		else
			texture:SetTexCoord(coords[1], coords[2], coords[3], coords[4])
		end
		return
	end
	texture:SetTexCoord(0.07, 0.93, 0.07, 0.93)
	if token then
		local single = "Interface\\Icons\\ClassIcon_" .. token:sub(1, 1) .. token:sub(2):lower()
		if ns.TextureExists(single) then
			texture:SetTexture(single)
			return
		end
	end
	texture:SetTexture("Interface\\Icons\\INV_Misc_Bag_08")
end

local function GuildRecord()
	local key = ns.Vault.GuildKey and ns.Vault.GuildKey()
	if key and ns.vault.guilds[key] then return ns.vault.guilds[key], key end
	for savedKey, record in pairs(ns.vault.guilds or {}) do return record, savedKey end
	return nil
end

-- The bank's main containers (the tabs) and its bags, told apart by the snapshot's Bag Slots row.
local function BankParts(record)
	local mains, bags = {}, {}
	if not record then return mains, bags end
	local bagIDs = {}
	for i, slot in ipairs(record.bagSlots or {}) do
		if slot.id then bagIDs[slot.id] = i end
	end
	for _, bucket in ipairs(record.containers or {}) do
		if bagIDs[bucket.id] then
			bags[bagIDs[bucket.id]] = bucket
		else
			mains[#mains + 1] = bucket
		end
	end
	return mains, bags
end

-- A character's last seen gold (this one's live), from the snapshot store.
local function GoldOf(who)
	local rows = ns.Vault.Gold()
	for _, row in ipairs(rows) do
		if row.who == who then return row.money end
	end
	return nil
end

-- ------------------------------------------------------------------
-- Who each window lists and shows
-- ------------------------------------------------------------------

-- The characters a window has a tab for, in order. The saved bank: every character with a bank
-- saved, this one first even before its bank has been seen. The saved bags: every other character
-- with bags saved, never this one. The guild bank has no character tabs.
function VaultUI.Characters(kind)
	local me = ns.Who()
	if kind == "bank" then
		local list = ns.Vault.Characters("bank")
		if not (list[1] and list[1].who == me) then
			local entry = ns.Vault.CharRecord(me) or { class = LiveClass() }
			table.insert(list, 1, { who = me, entry = entry, mine = true })
		end
		return list
	elseif kind == "bags" then
		local list = {}
		for _, source in ipairs(ns.Vault.Characters("bags")) do
			if source.who ~= me then list[#list + 1] = source end
		end
		return list
	end
	return {}
end

-- The character a window is showing. A choice that no longer has a tab (forgotten, or nothing
-- saved for this window) falls back: the bank to this character, the bags to the first other
-- character with bags saved, or to nobody.
local function Resolve(W)
	if W.kind == "guild" then
		local _, key = GuildRecord()
		return key
	end
	local list = VaultUI.Characters(W.kind)
	if W.who then
		for _, source in ipairs(list) do
			if source.who == W.who then return W.who end
		end
		W.who = nil
	end
	return list[1] and list[1].who or nil
end

local function CharEntry(W)
	return W.current and ns.Vault.CharRecord(W.current) or nil
end

-- ------------------------------------------------------------------
-- Keeping the windows in order
-- ------------------------------------------------------------------

local function IsOurName(name)
	return name == NAMES.bank or name == NAMES.bags or name == NAMES.guild
end

-- The game's Escape closes every window named in UISpecialFrames at once. To close the one opened
-- last first, as the game does with its own panels, one entry names whichever of these windows is
-- in front, and is pointed at the next one as that closes. The entry is only ever overwritten in
-- place, never added or removed while the game may be walking the list.
local function SyncEsc()
	local front = order[#order]
	if not front then
		report["saved windows"] = "none open"
		return
	end
	if not (escSlot and IsOurName(UISpecialFrames[escSlot])) then
		escSlot = nil
		for index, name in ipairs(UISpecialFrames) do
			if IsOurName(name) then escSlot = index break end
		end
	end
	if escSlot then
		UISpecialFrames[escSlot] = NAMES[front]
	else
		tinsert(UISpecialFrames, NAMES[front])
		escSlot = #UISpecialFrames
	end
	report["saved windows"] = "open: " .. table.concat(order, ", ") .. "; Escape closes " .. front
		.. " first (UISpecialFrames entry " .. escSlot .. ")"
end

local function Unlist(kind)
	for i = #order, 1, -1 do
		if order[i] == kind then table.remove(order, i) end
	end
end

-- Puts a window in front of the others: last in the order, raised, and the one Escape closes.
local function Front(W)
	Unlist(W.kind)
	if W.frame:IsShown() then order[#order + 1] = W.kind end
	lastKind = W.kind
	pcall(W.frame.Raise, W.frame)
	SyncEsc()
end

local function FrontKind()
	return order[#order]
end

-- ------------------------------------------------------------------
-- Where each window goes
-- ------------------------------------------------------------------

-- The window's size in UIParent units, and the room its character tabs need above it.
local function Size(W)
	local ratio = ns.Windows.Ratio(W.frame)
	return (W.frame:GetWidth() or 0) / ratio, (W.frame:GetHeight() or 0) / ratio, W.tabRoom or 0
end

-- Puts the window's top left corner at (left, top) in UIParent units, kept on screen with its
-- character tabs. Anchored by the top, so a window that changes size as characters are switched
-- keeps its title and tabs where they were.
local function PlaceAt(W, left, top)
	local frame = W.frame
	local w, h, room = Size(W)
	local x, y = ns.Windows.ClampXY(left, top - h, w, h + room)
	local ratio = ns.Windows.Ratio(frame)
	frame:ClearAllPoints()
	frame:SetPoint("TOPLEFT", UIParent, "BOTTOMLEFT", x * ratio, (y + h) * ratio)
	return x, y + h
end

local function SavePosition(W)
	local left, bottom, _, h = ns.Windows.Measure(W.frame)
	if not left then return end
	local x, top = PlaceAt(W, left, bottom + h)
	ns.db.positions[POS_KEYS[W.kind]] = { x = ns.Round(x, 1), top = ns.Round(top, 1) }
	ns.MirrorToAccount()
end

-- Where a window the user has never moved opens. Its home is where the single saved window always
-- opened, the middle of the screen. The bank goes home; so do the bags while the bank is not
-- showing; the guild bank opens beside whatever is open. The bags open beside the bank when it is
-- showing. Nothing already open is moved, and nothing opens on top of another of these windows:
-- a home spot another window already covers (the bags opened first sit there, say) sends the
-- window beside what is open instead, on whichever side fits.
local function DefaultPlace(W)
	local w, h, room = Size(W)
	local uw, uh = UIParent:GetWidth() or 0, UIParent:GetHeight() or 0
	local homeX, homeTop = (uw - w) / 2, (uh + h) / 2

	local open = {}
	local besideBank = W.kind == "bags" and windows.bank and windows.bank.frame:IsShown()
	if besideBank then open[1] = windows.bank end
	for i = #order, 1, -1 do
		local other = windows[order[i]]
		if other and other ~= W and other ~= open[1] and other.frame:IsShown() then open[#open + 1] = other end
	end
	if #open == 0 then return PlaceAt(W, homeX, homeTop) end

	local rects = {}
	for index, other in ipairs(open) do
		local l, b, ow, oh = ns.Windows.Measure(other.frame)
		if l then rects[#rects + 1] = { l = l, b = b, w = ow, h = oh, room = other.tabRoom or 0 } end
	end
	-- Whether the window, its character tabs included, would cover none of the open ones there.
	local function Clear(x, top)
		for _, r in ipairs(rects) do
			local overlapX = x < r.l + r.w and r.l < x + w
			local overlapY = top - h < r.b + r.h + r.room and r.b < top + room
			if overlapX and overlapY then return false end
		end
		return true
	end
	local function Fits(x, top)
		if x < 0 or x + w > uw or top - h < 0 or top + room > uh then return false end
		return Clear(x, top)
	end
	local homeClear = Clear(homeX, homeTop)
	if homeClear and W.kind ~= "guild" and not besideBank then return PlaceAt(W, homeX, homeTop) end
	for _, r in ipairs(rects) do
		local top = r.b + r.h
		if Fits(r.l + r.w + BESIDE_GAP, top) then return PlaceAt(W, r.l + r.w + BESIDE_GAP, top) end
		if Fits(r.l - BESIDE_GAP - w, top) then return PlaceAt(W, r.l - BESIDE_GAP - w, top) end
	end
	-- Nowhere clear beside them: home if that is clear, else beside the first one anyway, kept on
	-- screen.
	if homeClear then return PlaceAt(W, homeX, homeTop) end
	local r = rects[1]
	if r then return PlaceAt(W, r.l + r.w + BESIDE_GAP, r.b + r.h) end
	return PlaceAt(W, homeX, homeTop)
end

local function PlaceOnOpen(W)
	local pos = ns.db and ns.db.positions and ns.db.positions[POS_KEYS[W.kind]]
	if type(pos) == "table" and type(pos.x) == "number" and type(pos.top) == "number" then
		PlaceAt(W, pos.x, pos.top)
	else
		DefaultPlace(W)
	end
end

-- ------------------------------------------------------------------
-- Item cells
-- ------------------------------------------------------------------

local function CellTooltip(self)
	local item = self.csItem
	if not item then return end
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	local shown = false
	if item.link then
		shown = pcall(GameTooltip.SetHyperlink, GameTooltip, item.link)
	end
	if not shown then
		GameTooltip:SetText(item.name or ("Item " .. tostring(item.id or "?")), 1, 1, 1)
		GameTooltip:AddLine("This item is not in the client's cache, so only the saved name is known.",
			0.7, 0.7, 0.7, true)
	end
	if (item.count or 1) > 1 then GameTooltip:AddLine("Stack of " .. item.count, 0.6, 0.85, 1) end
	GameTooltip:Show()
end

-- SetAtlas does not raise for an atlas the client lacks (it just draws nothing), so the atlas
-- table is asked first and the plain fallbacks stand in wherever it says no.
local SLOT_ATLAS, GLOW_ATLAS = "bags-item-slot64", "bags-glow-white"

local function SlotBacking(frame)
	local backing = frame:CreateTexture(nil, "BACKGROUND")
	backing:SetAllPoints()
	if not (ns.HasAtlas(SLOT_ATLAS) and pcall(backing.SetAtlas, backing, SLOT_ATLAS)) then
		backing:SetColorTexture(0.1, 0.1, 0.12, 0.9)
	end
	return backing
end

local function NewCell(W, size)
	local cell = CreateFrame("Button", nil, W.frame)
	cell:SetSize(size, size)
	SlotBacking(cell)

	local icon = cell:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOPLEFT", 1, -1)
	icon:SetPoint("BOTTOMRIGHT", -1, 1)
	icon:Hide()
	cell.icon = icon

	-- The quality glow the game's own slots wear, tinted per quality and shown only for uncommon
	-- and better: common items have no border in the real bags and bank. Where the atlas is
	-- missing, a two pixel ring of four bars stands in.
	local border = cell:CreateTexture(nil, "OVERLAY")
	border:SetAllPoints()
	if ns.HasAtlas(GLOW_ATLAS) and pcall(border.SetAtlas, border, GLOW_ATLAS) then
		cell.borderIsGlow = true
	else
		cell.ring = {}
		for i = 1, 4 do cell.ring[i] = cell:CreateTexture(nil, "OVERLAY") end
		cell.ring[1]:SetPoint("TOPLEFT") cell.ring[1]:SetPoint("TOPRIGHT") cell.ring[1]:SetHeight(2)
		cell.ring[2]:SetPoint("BOTTOMLEFT") cell.ring[2]:SetPoint("BOTTOMRIGHT") cell.ring[2]:SetHeight(2)
		cell.ring[3]:SetPoint("TOPLEFT") cell.ring[3]:SetPoint("BOTTOMLEFT") cell.ring[3]:SetWidth(2)
		cell.ring[4]:SetPoint("TOPRIGHT") cell.ring[4]:SetPoint("BOTTOMRIGHT") cell.ring[4]:SetWidth(2)
	end
	border:Hide()
	cell.border = border

	local count = cell:CreateFontString(nil, "OVERLAY", "NumberFontNormal")
	count:SetPoint("BOTTOMRIGHT", -2, 2)
	cell.count = count

	cell:SetScript("OnEnter", CellTooltip)
	cell:SetScript("OnLeave", function() GameTooltip:Hide() end)
	cell:SetScript("OnClick", function(self)
		Front(W)
		-- Shift click drops the item link into whatever you are typing, the same as a real bag.
		if IsShiftKeyDown and IsShiftKeyDown() and self.csItem and self.csItem.link and ChatEdit_InsertLink then
			pcall(ChatEdit_InsertLink, self.csItem.link)
		end
	end)
	return cell
end

-- Paints a cell's border in a colour, or hides it. `cell.border` carries the shown state in both
-- the glow and the ring cases.
local function PaintBorder(cell, shown, r, g, b)
	if cell.borderIsGlow then
		cell.border:SetVertexColor(r, g, b)
	else
		for _, bar in ipairs(cell.ring or {}) do
			bar:SetColorTexture(r, g, b, 0.9)
			bar:SetShown(shown)
		end
	end
	cell.border:SetShown(shown)
end

local function SetQualityBorder(cell, quality)
	local r, g, b = QualityColor(quality)
	PaintBorder(cell, type(quality) == "number" and quality >= 2, r, g, b)
end

-- The blue outline that marks the tab or bag being looked at.
local function SetOutline(cell, on)
	PaintBorder(cell, on and true or false, 0.35, 0.72, 1)
end

local function SetCellItem(W, cell, item)
	cell.csItem = item
	if item then
		cell.icon:SetTexture(item.icon)
		cell.icon:Show()
		cell.count:SetText((item.count or 1) > 1 and item.count or "")
		SetQualityBorder(cell, item.quality)
	else
		cell.icon:Hide()
		cell.count:SetText("")
		SetQualityBorder(cell, nil)
	end
	-- The real bank dims what does not match the search rather than hiding it.
	cell:SetAlpha(Matches(W, item) and 1 or 0.25)
end

local function GetCell(W, index)
	local cell = W.cells[index]
	if not cell then
		cell = NewCell(W, CELL)
		W.cells[index] = cell
	end
	return cell
end

local function HideCellsFrom(W, index)
	for i = index, #W.cells do W.cells[i]:Hide() end
end

-- Places cell `index` at grid position (col, row), row 0 at the top, in the given geometry.
local function PlaceCell(W, index, col, row, item, geo)
	geo = geo or PLAIN
	local cell = GetCell(W, index)
	cell:SetSize(geo.cell, geo.cell)
	cell:ClearAllPoints()
	cell:SetPoint("TOPLEFT", W.frame, "TOPLEFT", geo.originX + col * geo.pitchX, -(geo.originY + row * geo.pitchY))
	SetCellItem(W, cell, item)
	cell:Show()
end

-- One container's slots from the top left, one per slot in the slot's own position. The guild
-- bank fills down each column first, the bank fills across each row first.
local function LayoutGrid(W, slots, cols, columnMajor, items, geo)
	local bySlot = {}
	for _, item in ipairs(items or {}) do bySlot[item.slot] = item end

	local rows = math.max(1, math.ceil(slots / cols))
	if columnMajor then rows = GUILD_ROWS end
	for i = 1, slots do
		local col, row
		if columnMajor then
			col = math.floor((i - 1) / rows)
			row = (i - 1) % rows
		else
			col = (i - 1) % cols
			row = math.floor((i - 1) / cols)
		end
		PlaceCell(W, i, col, row, bySlot[i], geo)
	end
	HideCellsFrom(W, slots + 1)
	return rows
end

-- ------------------------------------------------------------------
-- The Bag Slots row and the side tab column
-- ------------------------------------------------------------------

local function BagTooltip(self)
	local slot = self.csSlot
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	if slot and slot.link then
		if not pcall(GameTooltip.SetHyperlink, GameTooltip, slot.link) then
			GameTooltip:SetText("Bank bag", 1, 1, 1)
		end
		if (slot.slots or 0) > 0 then GameTooltip:AddLine("Click to look inside", 0.6, 0.85, 1) end
	elseif slot and slot.purchased then
		GameTooltip:SetText("Bag slot", 1, 1, 1)
		GameTooltip:AddLine("Purchased, nothing in it", 0.7, 0.7, 0.7)
	else
		GameTooltip:SetText("Bag slot", 1, 1, 1)
		GameTooltip:AddLine("Not purchased", 0.7, 0.7, 0.7)
	end
	GameTooltip:Show()
end

local function GetBagCell(W, index)
	local cell = W.bagCells[index]
	if not cell then
		cell = NewCell(W, BAG_CELL)
		cell:SetScript("OnEnter", BagTooltip)
		cell:SetScript("OnClick", function(self)
			Front(W)
			local slot = self.csSlot
			if slot and (slot.slots or 0) > 0 then
				-- Clicking the bag being looked at goes back to the tab that was showing before.
				W.viewingBag = (W.viewingBag ~= index) and index or nil
				Refresh(W)
			end
		end)
		W.bagCells[index] = cell
	end
	return cell
end

-- The Bag Slots row, at the measured place when there is one, else just under the grid. Returns
-- the bottom edge of the row.
local function LayoutBagRow(W, record, y, geo)
	geo = geo or CLASSIC_BANK
	local frame = W.frame
	local count = (record and record.bagSlots and #record.bagSlots > 0 and #record.bagSlots)
		or geo.bagCount or tonumber(_G.NUM_BANKBAGSLOTS) or NUM_BAG_SLOTS
	local size, pitch = geo.bagCell or BAG_CELL, geo.bagPitch or BAG_PITCH
	local x0 = geo.bagOriginX or (MARGIN_X + 82)
	local top = geo.bagOriginY or (y + 4)

	W.bagLabel:ClearAllPoints()
	W.bagLabel:SetPoint("RIGHT", frame, "TOPLEFT", x0 - 12, -(top + size / 2))
	W.bagLabel:Show()

	-- The thin rule the real bank draws between the grid and the Bag Slots.
	W.bagRule:ClearAllPoints()
	W.bagRule:SetPoint("TOPLEFT", frame, "TOPLEFT", geo.originX or MARGIN_X, -(top - 12))
	W.bagRule:SetWidth(math.max(60, (geo.cols or BANK_COLS) * geo.pitchX - (geo.pitchX - geo.cell)))
	W.bagRule:Show()

	for i = 1, count do
		local cell = GetBagCell(W, i)
		local slot = record and record.bagSlots and record.bagSlots[i]
		cell.csSlot = slot
		cell:SetSize(size, size)
		cell:ClearAllPoints()
		cell:SetPoint("TOPLEFT", frame, "TOPLEFT", x0 + (i - 1) * pitch, -top)
		if slot and slot.icon then
			cell.icon:SetTexture(slot.icon)
			cell.icon:Show()
			cell:SetAlpha(1)
		else
			cell.icon:Hide()
			cell:SetAlpha((slot and slot.purchased) and 1 or 0.45)
		end
		cell.count:SetText("")
		SetOutline(cell, W.viewingBag == i)
		cell:Show()
	end
	for i = count + 1, #W.bagCells do W.bagCells[i]:Hide() end
	return top + size
end

local function HideBagRow(W)
	W.bagLabel:Hide()
	W.bagRule:Hide()
	for _, cell in ipairs(W.bagCells) do cell:Hide() end
end

local function GetTabButton(W, index)
	local button = W.tabButtons[index]
	if not button then
		button = NewCell(W, TAB_SIZE)
		button:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_LEFT")
			GameTooltip:SetText(self.csLabel or ("Tab " .. index), 1, 1, 1)
			if self.csDetail then GameTooltip:AddLine(self.csDetail, 0.7, 0.85, 1) end
			GameTooltip:Show()
		end)
		button:SetScript("OnClick", function()
			Front(W)
			W.viewing = index
			W.viewingBag = nil
			Refresh(W)
		end)
		W.tabButtons[index] = button
	end
	return button
end

-- `tabs` is a list of { label, icon, detail }, laid down the right of a grid whose top is at
-- `top`. Returns how wide a column they needed.
local function LayoutTabs(W, tabs, x, top)
	top = top or GRID_TOP
	for index, tab in ipairs(tabs) do
		local button = GetTabButton(W, index)
		button.csLabel, button.csDetail = tab.label, tab.detail
		button.csItem = nil
		button:ClearAllPoints()
		button:SetPoint("TOPLEFT", W.frame, "TOPLEFT", x, -(top + (index - 1) * TAB_PITCH))
		if tab.icon then
			button.icon:SetTexture(tab.icon)
			button.icon:Show()
		else
			button.icon:Hide()
		end
		button.count:SetText("")
		SetOutline(button, (W.viewing or 1) == index)
		button:SetAlpha(1)
		button:Show()
	end
	for i = #tabs + 1, #W.tabButtons do W.tabButtons[i]:Hide() end
	return #tabs > 1 and (TAB_SIZE + 10) or 0
end

-- ------------------------------------------------------------------
-- The character tabs along the top, in the spellbook's style
-- ------------------------------------------------------------------

local function CharTabTooltip(self)
	local entry = self.csEntry or {}
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	GameTooltip:SetText(ns.ShortLabel(self.csWho or ""), 1, 1, 1)
	local line = {}
	if entry.level then line[#line + 1] = "Level " .. entry.level end
	if entry.class then line[#line + 1] = ClassLabel(entry.class) end
	if #line > 0 then GameTooltip:AddLine(table.concat(line, " "), 0.8, 0.8, 0.8) end
	if entry.realm and entry.realm ~= "" then GameTooltip:AddLine(entry.realm, 0.6, 0.6, 0.6) end
	if entry.bank then
		GameTooltip:AddLine("Bank: " .. (entry.bank.items or 0) .. " items, " .. Ago(entry.bank.time), 0.6, 0.85, 1)
	elseif self.csWho == ns.Who() then
		GameTooltip:AddLine("Bank: not saved yet", 0.6, 0.85, 1)
	end
	if entry.bags then
		GameTooltip:AddLine("Bags: " .. (entry.bags.items or 0) .. " items, " .. Ago(entry.bags.time), 0.6, 0.85, 1)
	end
	local gold = GoldOf(self.csWho)
	if gold then GameTooltip:AddDoubleLine("Gold", ns.Money(gold), 1, 0.82, 0, 1, 1, 1) end
	GameTooltip:Show()
end

local function NewCharTab(W, index)
	local tab = ns.CreateTab(W.frame)
	tab:SetScript("OnClick", function(self)
		self:SetChecked(false)
		Front(W)
		W.who = self.csWho
		W.viewing, W.viewingBag = nil, nil
		W.filter = ""
		if W.searchBox then W.searchBox:SetText("") W.searchBox:ClearFocus() end
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_ABILITY_PAGE_TURN then pcall(PlaySound, SOUNDKIT.IG_ABILITY_PAGE_TURN) end
		Refresh(W)
	end)
	tab:SetScript("OnEnter", CharTabTooltip)
	tab:SetScript("OnLeave", function() GameTooltip:Hide() end)
	W.charTabs[index] = tab
	return tab
end

-- One tab per character this window lists. Runs after the window has been sized, and wraps into
-- a second row rather than marching past the right edge once an account has more characters than
-- fit along the top.
local function LayoutCharTabs(W)
	local list = VaultUI.Characters(W.kind)
	local perRow = ns.TabsPerRow(W.frame)
	for index, source in ipairs(list) do
		local tab = W.charTabs[index] or NewCharTab(W, index)
		tab.csWho, tab.csEntry = source.who, source.entry
		ns.HangTab(tab, W.frame, (index - 1) % perRow, math.floor((index - 1) / perRow))
		SetClassIcon(tab.icon, source.entry and source.entry.class, true)
		tab:SetChosen(source.who == W.current)
		tab:Show()
	end
	for i = #list + 1, #W.charTabs do W.charTabs[i]:Hide() end
	local rows = #list > 0 and math.ceil(#list / perRow) or 0
	-- How far the top row stands above the window, by the one rule the backpack's tabs use too.
	W.tabRoom = ns.TabRowsHeight(rows)
	pcall(W.frame.SetClampRectInsets, W.frame, 0, 0, W.tabRoom, 0)
	return #list
end

-- ------------------------------------------------------------------
-- Laying out each shape
-- ------------------------------------------------------------------

-- Sizes the window round its contents, or to the measured size of the real window when the bank
-- was measured and nothing extra (a side column) has to fit.
local function SizeWindow(W, cols, rows, tabColumn, withBagRow, extraRows, geo, contentBottom)
	geo = geo or PLAIN
	local width, height
	if geo.width and geo.height and tabColumn == 0 then
		width, height = geo.width, geo.height
	else
		local gridWidth = cols * geo.pitchX - (geo.pitchX - geo.cell)
		width = geo.originX + gridWidth + tabColumn + geo.originX
		local bottom = contentBottom or (geo.originY + (rows + (extraRows or 0)) * geo.pitchY - (geo.pitchY - geo.cell))
		height = bottom + (withBagRow and 12 or 6) + FOOTER_H
	end
	W.frame:SetSize(math.max(width, 300), math.max(height, 200))
	if W.inset then
		W.inset:ClearAllPoints()
		W.inset:SetPoint("TOPLEFT", W.frame, "TOPLEFT", geo.originX - 8, -(geo.originY - 8))
		W.inset:SetPoint("BOTTOMRIGHT", W.frame, "BOTTOMRIGHT", -(geo.originX - 8), FOOTER_H - 4)
	end
end

-- The real bank shows nothing but the money down here, so that is all the replica shows. When
-- the snapshot was taken lives on the portrait's tooltip and on the character tabs instead.
local function Footer(W, record)
	W.moneyText:SetText(record and ns.Money(record.money) or "")
	-- The account's gold, small and grey in the bottom left, unless switched off.
	if ns.db.vault.showAccountGold and W.kind ~= "guild" then
		local _, total = ns.Vault.Gold()
		W.accountText:SetText("Account " .. ns.Money(total))
		W.accountText:Show()
	else
		W.accountText:Hide()
	end
end

-- Nothing to draw: the grid, the Bag Slots and the side tabs go, and a short line says why.
local function ShowNote(W, text)
	HideCellsFrom(W, 1)
	HideBagRow(W)
	LayoutTabs(W, {}, 0)
	W.divider:Hide()
	W.noteText:SetText(text)
	W.noteText:Show()
end

local function PortraitTooltip(W, self)
	local entry = CharEntry(W)
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	if W.kind == "guild" then
		local record, key = GuildRecord()
		GameTooltip:SetText(key and key:gsub(" %- .*$", "") or "Guild Bank", 1, 1, 1)
		GameTooltip:AddLine(record and ("Checked " .. When(record.time)) or "Not seen yet", 0.6, 0.85, 1)
		GameTooltip:Show()
		return
	end
	if not W.current then
		GameTooltip:SetText("Saved bags", 1, 1, 1)
		GameTooltip:AddLine("No other characters saved yet", 0.6, 0.85, 1)
		GameTooltip:Show()
		return
	end
	GameTooltip:SetText(ns.Label(W.current), 1, 1, 1)
	local line = {}
	if entry and entry.level then line[#line + 1] = "Level " .. entry.level end
	if entry and entry.class then line[#line + 1] = ClassLabel(entry.class) end
	if #line > 0 then GameTooltip:AddLine(table.concat(line, " "), 0.8, 0.8, 0.8) end
	local record = entry and (W.kind == "bags" and entry.bags or entry.bank)
	if record then
		GameTooltip:AddLine("Checked " .. When(record.time), 0.6, 0.85, 1)
	else
		GameTooltip:AddLine("Not seen yet", 0.6, 0.85, 1)
	end
	local gold = GoldOf(W.current)
	if gold then GameTooltip:AddDoubleLine("Gold", ns.Money(gold), 1, 0.82, 0, 1, 1, 1) end
	local _, total = ns.Vault.Gold()
	GameTooltip:AddDoubleLine("Account", ns.Money(total), 1, 0.82, 0, 1, 1, 1)
	GameTooltip:Show()
end

-- This character's own face on its bank and on the guild bank, a class icon for anyone else.
local function Portrait(W)
	local portrait = W.frame.csPortrait
	if not portrait then return end
	local me = ns.Who()
	if W.kind == "guild" or W.current == me then
		portrait:SetTexCoord(0, 1, 0, 1)
		if ns.SetPlayerPortrait(portrait) then return end
		SetClassIcon(portrait, LiveClass())
		return
	end
	local entry = CharEntry(W)
	SetClassIcon(portrait, entry and entry.class)
end

local function LayoutBank(W)
	local entry = CharEntry(W)
	local record = entry and entry.bank
	W.frame.csTitle:SetText(ns.ShortLabel(W.current) .. "'s Bank")
	local geo = BankGeometry(record)
	local cols = geo.cols or BANK_COLS

	if not record then
		-- Only ever this character: every other tab is there because its bank was saved.
		ShowNote(W, W.current == ns.Who() and "Visit a banker once and your bank is saved here."
			or "This character's bank has not been seen yet.")
		SizeWindow(W, cols, 6, 0, true, nil, geo, nil)
		Footer(W, nil)
		return
	end
	W.noteText:Hide()
	local mains, bags = BankParts(record)

	-- What the grid is showing: a bag that was clicked, or one of the main tabs. The two are kept
	-- in separate fields so a tab index can never be read as a bag index.
	local container
	if W.viewingBag and bags[W.viewingBag] then
		container = bags[W.viewingBag]
	else
		W.viewingBag = nil
		if type(W.viewing) == "number" and not mains[W.viewing] then W.viewing = nil end
		container = mains[W.viewing or 1]
	end

	local slots = container and container.slots or 48
	local rows = LayoutGrid(W, slots, cols, false, container and container.items or {}, geo)

	local tabs = {}
	if #mains > 1 then
		for index, bucket in ipairs(mains) do
			tabs[index] = { label = bucket.label, detail = #bucket.items .. " of " .. bucket.slots .. " used" }
		end
	end
	local tabColumn = LayoutTabs(W, tabs, geo.originX + cols * geo.pitchX + 4, geo.originY)

	local gridBottom = geo.originY + (rows - 1) * geo.pitchY + geo.cell
	-- Without a measured place for the Bag Slots they sit a clear gap under the grid, the rule
	-- between the two.
	local rowBottom = LayoutBagRow(W, record, gridBottom + 14, geo)
	W.divider:Hide()
	SizeWindow(W, cols, rows, tabColumn, true, nil, geo, rowBottom)
	Footer(W, record)
end

-- The bags as the combined backpack shows them: one grid, filled from the bottom right corner
-- upwards and leftwards, the backpack's first slot in the bottom right, each further bag stacked
-- above. A reagent bag gets its own small grid underneath, the same way round.
local function LayoutBags(W)
	if not W.current then
		W.frame.csTitle:SetText("Saved Bags")
		ShowNote(W, "No other characters saved yet. Log in on another character and its bags are saved a few seconds later.")
		SizeWindow(W, BAGS_COLS, 4, 0, false, nil, PLAIN)
		Footer(W, nil)
		return
	end
	local entry = CharEntry(W)
	local record = entry and entry.bags
	W.frame.csTitle:SetText(ns.ShortLabel(W.current) .. "'s Backpack")
	W.noteText:Hide()

	local ordinary, reagent = {}, nil
	for _, bucket in ipairs(record and record.containers or {}) do
		if bucket.label == "Reagent bag" then reagent = bucket else ordinary[#ordinary + 1] = bucket end
	end
	if #ordinary == 0 then ordinary[1] = { label = "Backpack", slots = 16, items = {} } end

	local function Fill(buckets, topRow, cellIndex)
		local sequence = {}
		for _, bucket in ipairs(buckets) do
			local bySlot = {}
			for _, item in ipairs(bucket.items or {}) do bySlot[item.slot] = item end
			for slot = 1, bucket.slots do sequence[#sequence + 1] = bySlot[slot] or false end
		end
		local total = #sequence
		local rows = math.max(1, math.ceil(total / BAGS_COLS))
		for k = 0, total - 1 do
			local col = BAGS_COLS - 1 - (k % BAGS_COLS)
			local rowFromBottom = math.floor(k / BAGS_COLS)
			local row = topRow + (rows - 1 - rowFromBottom)
			cellIndex = cellIndex + 1
			PlaceCell(W, cellIndex, col, row, sequence[k + 1] or nil, PLAIN)
		end
		return rows, cellIndex
	end

	local rows, used = Fill(ordinary, 0, 0)
	local extra = 0
	if reagent then
		-- A gap of half a row with a line through it, then the reagent bag.
		local reagentRows
		reagentRows, used = Fill({ reagent }, rows + 0.5, used)
		W.divider:ClearAllPoints()
		W.divider:SetPoint("TOPLEFT", W.frame, "TOPLEFT", MARGIN_X, -(GRID_TOP + rows * PITCH + 6))
		W.divider:SetWidth(BAGS_COLS * PITCH - GAP)
		W.divider:Show()
		extra = reagentRows + 0.5
	else
		W.divider:Hide()
	end
	HideCellsFrom(W, used + 1)

	LayoutTabs(W, {}, 0)
	HideBagRow(W)
	SizeWindow(W, BAGS_COLS, rows, 0, false, extra, PLAIN)
	Footer(W, record)
end

local function LayoutGuild(W)
	local record, key = GuildRecord()
	W.frame.csTitle:SetText(key and ("Guild Bank: " .. key:gsub(" %- .*$", "")) or "Guild Bank")

	local tabs, tabList = {}, {}
	if record then
		local keys = {}
		for index in pairs(record.tabs or {}) do keys[#keys + 1] = index end
		table.sort(keys)
		for _, index in ipairs(keys) do
			local tab = record.tabs[index]
			tabList[#tabList + 1] = tab
			tabs[#tabs + 1] = {
				label = (tab.name and tab.name ~= "" and tab.name) or ("Tab " .. index),
				icon = tab.icon,
				detail = tab.viewable == false and "Not viewable by this character" or (#(tab.items or {}) .. " items"),
			}
		end
	end
	if type(W.viewing) ~= "number" or not tabList[W.viewing] then W.viewing = 1 end
	local tab = tabList[W.viewing]

	local rows = LayoutGrid(W, GUILD_SLOTS, GUILD_COLS, true, tab and tab.items or {}, PLAIN)
	local tabColumn = LayoutTabs(W, tabs, MARGIN_X + GUILD_COLS * PITCH + 4)
	if #tabs == 1 then tabColumn = TAB_SIZE + 10 end
	HideBagRow(W)
	W.divider:Hide()
	SizeWindow(W, GUILD_COLS, rows, tabColumn, false, nil, PLAIN)
	Footer(W, record)

	if record and tab then
		W.noteText:Hide()
	else
		W.noteText:SetText("Open the guild bank once and it will be remembered here.")
		W.noteText:Show()
	end
end

Refresh = function(W)
	if not (W and W.frame and W.frame:IsShown()) then return end
	W.current = Resolve(W)
	Portrait(W)
	if W.kind == "guild" then
		LayoutGuild(W)
	elseif W.kind == "bags" then
		LayoutBags(W)
	else
		LayoutBank(W)
	end
	-- After the window has its final width, so the tabs know how many fit along the top.
	LayoutCharTabs(W)
end

-- ------------------------------------------------------------------
-- Building a window
-- ------------------------------------------------------------------

local function BuildSearchBox(W)
	local name = NAMES[W.kind] .. "Search"
	local parent = W.frame
	local box
	local ok, made = pcall(CreateFrame, "EditBox", name, parent, "SearchBoxTemplate")
	if ok and made then
		box = made
	else
		local fallbackOK, fallback = pcall(CreateFrame, "EditBox", name, parent, "InputBoxTemplate")
		box = (fallbackOK and fallback) or CreateFrame("EditBox", name, parent)
		box:SetAutoFocus(false)
		box:SetFontObject("ChatFontNormal")
		if not fallbackOK then
			local backing = box:CreateTexture(nil, "BACKGROUND")
			backing:SetAllPoints()
			backing:SetColorTexture(0, 0, 0, 0.5)
		end
	end
	report["search box"] = (ok and made) and "SearchBoxTemplate" or "plain edit box"
	box:SetSize(120, 20)
	box:SetScript("OnTextChanged", function(self)
		if self.Instructions then self.Instructions:SetShown((self:GetText() or "") == "") end
		W.filter = (self:GetText() or ""):lower()
		Refresh(W)
	end)
	box:SetScript("OnEscapePressed", function(self) self:SetText("") self:ClearFocus() end)
	return box
end

local function HeaderTabsChanged()
	if ns.BagHeader and ns.BagHeader.Refresh then pcall(ns.BagHeader.Refresh) end
end

local function Build(kind)
	if windows[kind] then return windows[kind] end
	local W = { kind = kind, cells = {}, bagCells = {}, tabButtons = {}, charTabs = {}, filter = "", tabRoom = 0 }
	windows[kind] = W

	local frame = ns.CreatePortraitPanel(NAMES[kind], "saved " .. kind)
	W.frame = frame
	frame.csKind = kind
	frame:SetSize(380, 420)
	frame:SetFrameStrata("HIGH")
	frame:Hide()
	frame.csTitle:SetText(kind == "guild" and "Guild Bank" or kind == "bags" and "Saved Bags" or "Bank")
	pcall(frame.SetToplevel, frame, true)
	-- The addon keeps the place itself, per character; the client's own layout cache stays out.
	pcall(frame.SetDontSavePosition, frame, true)

	-- Dragged by the title area (the panel's own background; everything inside it that takes the
	-- mouse is a slot or a control), kept on screen with its character tabs, remembered on letting
	-- go.
	frame:SetScript("OnDragStart", function(self)
		Front(W)
		if not self:IsMovable() then return end
		self:StartMoving()
		W.moving = true
	end)
	frame:SetScript("OnDragStop", function(self)
		if not W.moving then return end
		W.moving = false
		self:StopMovingOrSizing()
		SavePosition(W)
	end)
	frame:SetScript("OnMouseDown", function() Front(W) end)

	W.inset = frame.Inset
	if not W.inset then
		W.inset = CreateFrame("Frame", nil, frame)
		local plate = W.inset:CreateTexture(nil, "BACKGROUND")
		plate:SetAllPoints()
		plate:SetColorTexture(0, 0, 0, 0.45)
	end
	W.inset:SetFrameLevel(frame:GetFrameLevel() + 1)

	W.searchBox = BuildSearchBox(W)
	W.searchBox:SetPoint("TOPRIGHT", frame, "TOPRIGHT", -34, -30)

	W.bagLabel = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
	W.bagLabel:SetText("Bag Slots:")
	W.bagLabel:Hide()

	W.bagRule = frame:CreateTexture(nil, "ARTWORK")
	W.bagRule:SetColorTexture(1, 0.82, 0, 0.3)
	W.bagRule:SetHeight(1)
	W.bagRule:Hide()

	W.divider = frame:CreateTexture(nil, "ARTWORK")
	W.divider:SetColorTexture(1, 1, 1, 0.16)
	W.divider:SetHeight(1)
	W.divider:Hide()

	W.moneyText = frame:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	W.moneyText:SetPoint("BOTTOMRIGHT", frame, "BOTTOMRIGHT", -16, 12)
	W.moneyText:SetJustifyH("RIGHT")

	W.accountText = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	W.accountText:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", MARGIN_X, 14)
	W.accountText:SetJustifyH("LEFT")
	W.accountText:Hide()

	-- Hovering either money line lists every character's gold, as on the real windows.
	for _, text in ipairs({ W.moneyText, W.accountText }) do
		local hit = CreateFrame("Frame", nil, frame)
		hit:SetPoint("TOPLEFT", text, "TOPLEFT", -4, 4)
		hit:SetPoint("BOTTOMRIGHT", text, "BOTTOMRIGHT", 4, -4)
		hit:EnableMouse(true)
		hit:SetScript("OnEnter", function(self) ns.GoldTooltip(self) end)
		hit:SetScript("OnLeave", function() GameTooltip:Hide() end)
		hit.csMoneyHit = true
	end

	-- The portrait is a texture, so a small frame over it carries the tooltip.
	if frame.csPortrait then
		local hit = CreateFrame("Frame", nil, frame)
		hit:SetAllPoints(frame.csPortrait)
		hit:EnableMouse(true)
		hit:SetScript("OnEnter", function(self) PortraitTooltip(W, self) end)
		hit:SetScript("OnLeave", function() GameTooltip:Hide() end)
	end

	W.noteText = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
	W.noteText:SetPoint("CENTER", frame, "CENTER", 0, 20)
	W.noteText:SetWidth(280)
	W.noteText:SetWordWrap(true)
	W.noteText:Hide()

	frame:SetScript("OnShow", function()
		Refresh(W)
		-- Placed and put in front when it opens, not when it merely comes back into view with the
		-- whole interface (the interface hidden and shown again, Alt-Z or a cinematic, leaves the
		-- window itself open, where it was and where it stood among the others).
		if not W.placed then
			PlaceOnOpen(W)
			W.placed = true
			Front(W)
		end
		HeaderTabsChanged()
	end)
	frame:SetScript("OnHide", function(self)
		if W.moving then
			W.moving = false
			self:StopMovingOrSizing()
			SavePosition(W)
		end
		-- Hidden only along with the whole interface, it is still open: it keeps its place in the
		-- order Escape closes them in, and its tab stays chosen.
		if self:IsShown() then return end
		W.placed = false
		Unlist(kind)
		SyncEsc()
		HeaderTabsChanged()
	end)
	report["saved " .. kind .. " window"] = "ok, replica"
	return W
end

-- ------------------------------------------------------------------
-- What the rest of the addon calls
-- ------------------------------------------------------------------

local function Kind(kind)
	if kind == "bank" or kind == "bags" or kind == "guild" then return kind end
	return nil
end

-- Opens a saved window (`kind` is "bank", "bags" or "guild"), on `character` if one is named. One
-- that is already open is brought to the front, never closed.
function VaultUI.Show(kind, character)
	kind = Kind(kind) or "bank"
	local W = Build(kind)
	if character and kind ~= "guild" then
		W.who = character
		W.viewing, W.viewingBag = nil, nil
	end
	if W.frame:IsShown() then
		Front(W)
		Refresh(W)
	else
		-- A real open, whatever happened while the interface was hidden: placed and put in front.
		W.placed = false
		W.frame:Show()
	end
	return W.frame
end

function VaultUI.Hide(kind)
	local W = windows[Kind(kind) or ""]
	if W and W.frame:IsShown() then W.frame:Hide() end
end

-- Closes a saved window that is open and in front, opens (or brings forward) any other. With no
-- kind it is the window in front, else the one opened last, else the bank.
function VaultUI.Toggle(kind)
	kind = Kind(kind) or FrontKind() or lastKind or "bank"
	local W = windows[kind]
	if W and W.frame:IsShown() and FrontKind() == kind then
		W.frame:Hide()
		return false
	end
	VaultUI.Show(kind)
	return true
end

function VaultUI.IsShown(kind)
	local W = windows[Kind(kind) or ""]
	return (W and W.frame:IsShown()) and true or false
end

-- Redraws every saved window that is open, which is what a new snapshot asks for.
function VaultUI.Refresh()
	for _, kind in ipairs(KINDS) do
		local W = windows[kind]
		if W then Refresh(W) end
	end
end

-- The character a saved window shows (the bank, the bags), or the guild it shows (the guild bank).
-- The saved bags answer nil when no other character has bags saved.
function VaultUI.Selected(kind)
	kind = Kind(kind) or "bank"
	return Resolve(windows[kind] or { kind = kind })
end

-- The saved windows on screen, the one in front last.
function VaultUI.Open()
	local out = {}
	for index, kind in ipairs(order) do out[index] = kind end
	return out
end

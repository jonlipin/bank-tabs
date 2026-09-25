-- Casement
-- VaultUI: your bank and your bags, drawn the way the game draws them, from wherever you are.
--
-- These are replicas rather than lists. The bank has the same portrait-and-title frame as the
-- real one, the search box top right, the slots in the same grid with every empty slot drawn, the
-- Bag Slots row underneath and the money bottom right. The bags come as the combined backpack does.
-- The guild bank is seven columns of fourteen filled down each column, tabs down the right hand
-- side. Every item is drawn in the slot it was actually in when it was last seen, never packed.
--
-- A row of tabs in the spellbook's style hangs off the top of the window, one per character on
-- this account that has been saved, so any character's bank or bags can be looked at. The art is
-- the game's own spellbook tab atlas with the class icon in it, and a plain bevel where a client
-- does not carry that atlas.
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

-- The grid geometry each shape is drawn with. The bank's is read off the real bank window when a
-- snapshot is taken (Vault.MeasureBankLayout), so the replica matches this client's bank exactly;
-- until one has been measured, the classic bank's numbers stand in: 37 pixel slots, 12 apart
-- across and 10 down, 48 in from the left edge. The other shapes use the plain grid.
local PLAIN = { cell = CELL, pitchX = PITCH, pitchY = PITCH, originX = MARGIN_X, originY = GRID_TOP }
local CLASSIC_BANK = { cell = 37, pitchX = 49, pitchY = 47, originX = 48, originY = 63, cols = 8,
	bagCell = 24, bagPitch = 38, bagOriginX = 145 }

local function BankGeometry(record)
	-- A record's own measurement, else the account's latest (the same client, the same window).
	local layout = (record and record.layout) or (ns.vault and ns.vault.bankLayout)
	if layout and layout.cell and layout.pitchX and layout.pitchY and layout.originX and layout.originY then
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

-- The character tabs, sized as the spellbook's are.
local CTAB_W, CTAB_H, CTAB_GAP = 43, 37, 2
local CTAB_ART = {
	tab = "spellbook-Tab-Frame-C60",
	tabActive = "spellbook-Tab-Frame-Glow-C60",
	tabActiveGlow = "spellbook-Tab-Frame-glow-gradient-C60",
}
local CLASS_SHEET = "Interface\\Glues\\CharacterCreate\\UI-CharacterCreate-Classes"

local window, searchBox, moneyText, accountText, noteText, bagLabel, bagRule, inset, divider
local cells, bagCells, tabButtons, charTabs = {}, {}, {}, {}
local mode = "bank"    -- "bank", "bags" or "guild"
local who = nil        -- the character being looked at; nil means this one
local viewing = nil    -- nil for the first tab, else a main tab index (bank) or a guild tab index
local viewingBag = nil -- a Bag Slots index while a bank bag is being looked inside; wins over the tab
local filter = ""
local tabArt = nil     -- false once probed and missing

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
local function Matches(item)
	if filter == "" then return true end
	if not item then return false end
	return (item.name or ""):lower():find(filter, 1, true) ~= nil
end

local function Selected()
	return who or ns.Who()
end

local function CharEntry()
	return ns.Vault.CharRecord(Selected())
end

local function ClassLabel(token)
	if not token then return "" end
	local names = _G.LOCALIZED_CLASS_NAMES_MALE
	return (names and names[token]) or (token:sub(1, 1) .. token:sub(2):lower())
end

local function HasAtlas(atlas)
	if not (C_Texture and C_Texture.GetAtlasInfo) then return false end
	local ok, info = pcall(C_Texture.GetAtlasInfo, atlas)
	return ok and info ~= nil
end

-- Paints a class icon into a texture: the character creation sheet where the client has it, the
-- single icon files otherwise, a bag as a last resort.
local function SetClassIcon(texture, token)
	local coords = token and _G.CLASS_ICON_TCOORDS and _G.CLASS_ICON_TCOORDS[token]
	if coords and ns.TextureExists(CLASS_SHEET) then
		texture:SetTexture(CLASS_SHEET)
		texture:SetTexCoord(coords[1], coords[2], coords[3], coords[4])
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

local function SlotBacking(frame)
	local backing = frame:CreateTexture(nil, "BACKGROUND")
	backing:SetAllPoints()
	if not pcall(backing.SetAtlas, backing, "bags-item-slot64") then
		backing:SetColorTexture(0.1, 0.1, 0.12, 0.9)
	end
	return backing
end

local function NewCell(parent, size)
	local cell = CreateFrame("Button", nil, parent)
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
	if pcall(border.SetAtlas, border, "bags-glow-white") then
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

local function SetCellItem(cell, item)
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
	cell:SetAlpha(Matches(item) and 1 or 0.25)
end

local function GetCell(index)
	local cell = cells[index]
	if not cell then
		cell = NewCell(window, CELL)
		cells[index] = cell
	end
	return cell
end

local function HideCellsFrom(index)
	for i = index, #cells do cells[i]:Hide() end
end

-- Places cell `index` at grid position (col, row), row 0 at the top, in the given geometry.
local function PlaceCell(index, col, row, item, geo)
	geo = geo or PLAIN
	local cell = GetCell(index)
	cell:SetSize(geo.cell, geo.cell)
	cell:ClearAllPoints()
	cell:SetPoint("TOPLEFT", window, "TOPLEFT", geo.originX + col * geo.pitchX, -(geo.originY + row * geo.pitchY))
	SetCellItem(cell, item)
	cell:Show()
end

-- One container's slots from the top left, one per slot in the slot's own position. The guild
-- bank fills down each column first, the bank fills across each row first.
local function LayoutGrid(slots, cols, columnMajor, items, geo)
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
		PlaceCell(i, col, row, bySlot[i], geo)
	end
	HideCellsFrom(slots + 1)
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

local function GetBagCell(index)
	local cell = bagCells[index]
	if not cell then
		cell = NewCell(window, BAG_CELL)
		cell:SetScript("OnEnter", BagTooltip)
		cell:SetScript("OnClick", function(self)
			local slot = self.csSlot
			if slot and (slot.slots or 0) > 0 then
				-- Clicking the bag being looked at goes back to the tab that was showing before.
				viewingBag = (viewingBag ~= index) and index or nil
				VaultUI.Refresh()
			end
		end)
		bagCells[index] = cell
	end
	return cell
end

-- The Bag Slots row, at the measured place when there is one, else just under the grid. Returns
-- the bottom edge of the row.
local function LayoutBagRow(record, y, geo)
	geo = geo or CLASSIC_BANK
	local count = (record and record.bagSlots and #record.bagSlots > 0 and #record.bagSlots)
		or geo.bagCount or tonumber(_G.NUM_BANKBAGSLOTS) or NUM_BAG_SLOTS
	local size, pitch = geo.bagCell or BAG_CELL, geo.bagPitch or BAG_PITCH
	local x0 = geo.bagOriginX or (MARGIN_X + 82)
	local top = geo.bagOriginY or (y + 4)

	bagLabel:ClearAllPoints()
	bagLabel:SetPoint("RIGHT", window, "TOPLEFT", x0 - 12, -(top + size / 2))
	bagLabel:Show()

	-- The thin rule the real bank draws between the grid and the Bag Slots.
	bagRule:ClearAllPoints()
	bagRule:SetPoint("TOPLEFT", window, "TOPLEFT", geo.originX or MARGIN_X, -(top - 12))
	bagRule:SetWidth(math.max(60, (geo.cols or BANK_COLS) * geo.pitchX - (geo.pitchX - geo.cell)))
	bagRule:Show()

	for i = 1, count do
		local cell = GetBagCell(i)
		local slot = record and record.bagSlots and record.bagSlots[i]
		cell.csSlot = slot
		cell:SetSize(size, size)
		cell:ClearAllPoints()
		cell:SetPoint("TOPLEFT", window, "TOPLEFT", x0 + (i - 1) * pitch, -top)
		if slot and slot.icon then
			cell.icon:SetTexture(slot.icon)
			cell.icon:Show()
			cell:SetAlpha(1)
		else
			cell.icon:Hide()
			cell:SetAlpha((slot and slot.purchased) and 1 or 0.45)
		end
		cell.count:SetText("")
		SetOutline(cell, viewingBag == i)
		cell:Show()
	end
	for i = count + 1, #bagCells do bagCells[i]:Hide() end
	return top + size
end

local function HideBagRow()
	bagLabel:Hide()
	bagRule:Hide()
	for _, cell in ipairs(bagCells) do cell:Hide() end
end

local function GetTabButton(index)
	local button = tabButtons[index]
	if not button then
		button = NewCell(window, TAB_SIZE)
		button:SetScript("OnEnter", function(self)
			GameTooltip:SetOwner(self, "ANCHOR_LEFT")
			GameTooltip:SetText(self.csLabel or ("Tab " .. index), 1, 1, 1)
			if self.csDetail then GameTooltip:AddLine(self.csDetail, 0.7, 0.85, 1) end
			GameTooltip:Show()
		end)
		button:SetScript("OnClick", function()
			viewing = index
			viewingBag = nil
			VaultUI.Refresh()
		end)
		tabButtons[index] = button
	end
	return button
end

-- `tabs` is a list of { label, icon, detail }, laid down the right of a grid whose top is at
-- `top`. Returns how wide a column they needed.
local function LayoutTabs(tabs, x, top)
	top = top or GRID_TOP
	for index, tab in ipairs(tabs) do
		local button = GetTabButton(index)
		button.csLabel, button.csDetail = tab.label, tab.detail
		button.csItem = nil
		button:ClearAllPoints()
		button:SetPoint("TOPLEFT", window, "TOPLEFT", x, -(top + (index - 1) * TAB_PITCH))
		if tab.icon then
			button.icon:SetTexture(tab.icon)
			button.icon:Show()
		else
			button.icon:Hide()
		end
		button.count:SetText("")
		SetOutline(button, (viewing or 1) == index)
		button:SetAlpha(1)
		button:Show()
	end
	for i = #tabs + 1, #tabButtons do tabButtons[i]:Hide() end
	return #tabs > 1 and (TAB_SIZE + 10) or 0
end

-- ------------------------------------------------------------------
-- The character tabs along the top, in the spellbook's style
-- ------------------------------------------------------------------

local function TabArt()
	if tabArt ~= nil then return tabArt or nil end
	tabArt = false
	if HasAtlas(CTAB_ART.tab) then
		tabArt = { tab = CTAB_ART.tab }
		if HasAtlas(CTAB_ART.tabActive) then tabArt.tabActive = CTAB_ART.tabActive end
		if HasAtlas(CTAB_ART.tabActiveGlow) then tabArt.tabActiveGlow = CTAB_ART.tabActiveGlow end
		report["character tab art"] = "spellbook atlas"
	else
		report["character tab art"] = "plain bevel (no spellbook atlas on this client)"
	end
	return tabArt or nil
end

-- A character's last seen gold (this one's live), from the snapshot store.
local function GoldOf(who)
	local rows = ns.Vault.Gold()
	for _, row in ipairs(rows) do
		if row.who == who then return row.money end
	end
	return nil
end

local function CharTabTooltip(self)
	local entry = self.csEntry or {}
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	GameTooltip:SetText(ns.Label(self.csWho or ""), 1, 1, 1)
	local line = {}
	if entry.level then line[#line + 1] = "Level " .. entry.level end
	if entry.class then line[#line + 1] = ClassLabel(entry.class) end
	if #line > 0 then GameTooltip:AddLine(table.concat(line, " "), 0.8, 0.8, 0.8) end
	if entry.bank then
		GameTooltip:AddLine("Bank: " .. (entry.bank.items or 0) .. " items, " .. Ago(entry.bank.time), 0.6, 0.85, 1)
	end
	if entry.bags then
		GameTooltip:AddLine("Bags: " .. (entry.bags.items or 0) .. " items, " .. Ago(entry.bags.time), 0.6, 0.85, 1)
	end
	local gold = GoldOf(self.csWho)
	if gold then GameTooltip:AddDoubleLine("Gold", ns.Money(gold), 1, 0.82, 0, 1, 1, 1) end
	GameTooltip:Show()
end

-- Clips a tab's icon (and the dark plate under it) to the tab window's shape, rounded along the
-- top and flat along the bottom, which is what this mask atlas cuts. Without it the square icon
-- shows through the frame's open corners. The atlas's region is larger than its shape, so the
-- mask is drawn about a quarter larger than the texture it clips.
local TAB_MASK = "UI-HUD-ActionBar-IconFrame-Mask"
local MASK_OVER = 0.26

local function MaskTabTexture(tab, texture, size)
	if not (tab.CreateMaskTexture and HasAtlas(TAB_MASK)) then return false end
	local ok, mask = pcall(tab.CreateMaskTexture, tab)
	if not (ok and mask) then return false end
	if not pcall(mask.SetAtlas, mask, TAB_MASK) then return false end
	local w = size or (texture.GetWidth and texture:GetWidth()) or 0
	local h = size or (texture.GetHeight and texture:GetHeight()) or 0
	if not w or w <= 0 then w = 40 end
	if not h or h <= 0 then h = 40 end
	mask:ClearAllPoints()
	mask:SetPoint("TOPLEFT", texture, "TOPLEFT", -MASK_OVER * w, MASK_OVER * h)
	mask:SetPoint("BOTTOMRIGHT", texture, "BOTTOMRIGHT", MASK_OVER * w, -MASK_OVER * h)
	if texture.AddMaskTexture and pcall(texture.AddMaskTexture, texture, mask) then
		texture.csMask = mask
		return true
	end
	pcall(mask.Hide, mask)
	return false
end

local function NewCharTab(index)
	local tab = CreateFrame("CheckButton", nil, window)
	tab:SetSize(CTAB_W, CTAB_H)
	-- One level under the window, so the window's own border covers the tab's feet.
	tab:SetFrameLevel(math.max(0, (window:GetFrameLevel() or 1) - 1))

	local back = tab:CreateTexture(nil, "BACKGROUND")
	back:SetPoint("TOPLEFT", 4, -3)
	back:SetPoint("BOTTOMRIGHT", -4, 0)
	back:SetColorTexture(0.02, 0.02, 0.02, 1)

	local icon = tab:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOP", 0, -4)
	icon:SetSize(CTAB_W - 10, CTAB_W - 10)
	tab.icon = icon

	local masked = MaskTabTexture(tab, icon, CTAB_W - 10)
	MaskTabTexture(tab, back)
	report["character tab mask"] = masked and TAB_MASK or "none (the icon keeps its corners)"

	local art = TabArt()
	if art then
		tab.frameTex = tab:CreateTexture(nil, "OVERLAY")
		tab.frameTex:SetAllPoints()
		pcall(tab.frameTex.SetAtlas, tab.frameTex, art.tab)
		if art.tabActiveGlow then
			tab.glow = tab:CreateTexture(nil, "OVERLAY", nil, -1)
			tab.glow:SetPoint("TOPLEFT", 0, 1)
			tab.glow:SetPoint("BOTTOMRIGHT", 0, 0)
			pcall(tab.glow.SetAtlas, tab.glow, art.tabActiveGlow)
			tab.glow:Hide()
		end
	else
		-- Plain fallback: a dark bevel, gold when chosen.
		local okBevel, bevel = pcall(CreateFrame, "Frame", nil, tab, "BackdropTemplate")
		if okBevel and bevel and bevel.SetBackdrop then
			bevel:SetAllPoints()
			bevel:SetBackdrop({ edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 8 })
			bevel:SetBackdropBorderColor(0.45, 0.4, 0.33)
			bevel:EnableMouse(false)
			tab.bevel = bevel
		end
		local okSel, sel = pcall(CreateFrame, "Frame", nil, tab, "BackdropTemplate")
		if okSel and sel and sel.SetBackdrop then
			sel:SetAllPoints()
			sel:SetBackdrop({ edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border", edgeSize = 9 })
			sel:SetBackdropBorderColor(1, 0.85, 0.1)
			sel:SetFrameLevel(tab:GetFrameLevel() + 2)
			sel:EnableMouse(false)
			tab.sel = sel
		end
	end

	local hover = tab:CreateTexture(nil, "HIGHLIGHT")
	hover:SetAllPoints(icon)
	hover:SetColorTexture(1, 1, 1, 0.15)

	tab.SetChosen = function(self, on)
		local artNow = TabArt()
		if self.frameTex and artNow then
			pcall(self.frameTex.SetAtlas, self.frameTex, (on and artNow.tabActive) or artNow.tab)
		end
		if self.glow then self.glow:SetShown(on) end
		if self.sel then self.sel:SetShown(on) end
		if self.bevel then self.bevel:SetShown(not on) end
		self.icon:SetAlpha(on and 1 or 0.85)
	end

	tab:SetScript("OnClick", function(self)
		self:SetChecked(false)
		who = self.csWho
		viewing = nil
		if searchBox then searchBox:SetText("") searchBox:ClearFocus() end
		if PlaySound and SOUNDKIT and SOUNDKIT.IG_ABILITY_PAGE_TURN then pcall(PlaySound, SOUNDKIT.IG_ABILITY_PAGE_TURN) end
		VaultUI.Refresh()
	end)
	tab:SetScript("OnEnter", CharTabTooltip)
	tab:SetScript("OnLeave", function() GameTooltip:Hide() end)
	charTabs[index] = tab
	return tab
end

-- One tab per character with something saved for this mode, this character first. Runs after the
-- window has been sized, and wraps into a second row rather than marching past the right edge
-- once an account has more characters than fit along the top.
local function LayoutCharTabs()
	if mode == "guild" then
		for _, tab in ipairs(charTabs) do tab:Hide() end
		return 0
	end
	local list = ns.Vault.Characters(mode)
	local selected = Selected()
	local pitch = CTAB_W + CTAB_GAP
	local perRow = math.max(1, math.floor(((window:GetWidth() or 380) - 64 - 20) / pitch))
	for index, source in ipairs(list) do
		local tab = charTabs[index] or NewCharTab(index)
		tab.csWho, tab.csEntry = source.who, source.entry
		local row = math.floor((index - 1) / perRow)
		local col = (index - 1) % perRow
		tab:ClearAllPoints()
		-- Hanging off the top edge, clear of the portrait, feet tucked behind the border. A second
		-- row sits above the first.
		tab:SetPoint("BOTTOMLEFT", window, "TOPLEFT", 64 + col * pitch, -8 + row * (CTAB_H - 6))
		SetClassIcon(tab.icon, source.entry.class)
		tab:SetChosen(source.who == selected)
		tab:Show()
	end
	for i = #list + 1, #charTabs do charTabs[i]:Hide() end
	local rows = math.max(1, math.ceil(#list / perRow))
	pcall(window.SetClampRectInsets, window, 0, 0, rows * (CTAB_H - 6) + 8, 0)
	return #list
end

-- ------------------------------------------------------------------
-- Laying out each shape
-- ------------------------------------------------------------------

-- Sizes the window round its contents, or to the measured size of the real window when the bank
-- was measured and nothing extra (a side column) has to fit.
local function SizeWindow(cols, rows, tabColumn, withBagRow, extraRows, geo, contentBottom)
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
	window:SetSize(math.max(width, 300), math.max(height, 200))
	if inset then
		inset:ClearAllPoints()
		inset:SetPoint("TOPLEFT", window, "TOPLEFT", geo.originX - 8, -(geo.originY - 8))
		inset:SetPoint("BOTTOMRIGHT", window, "BOTTOMRIGHT", -(geo.originX - 8), FOOTER_H - 4)
	end
end

-- The real bank shows nothing but the money down here, so that is all the replica shows. When
-- the snapshot was taken lives on the portrait's tooltip and on the character tabs instead.
local function Footer(record)
	moneyText:SetText(record and ns.Money(record.money) or "")
	-- The account's gold, small and grey in the bottom left, unless switched off.
	if ns.db.vault.showAccountGold and mode ~= "guild" then
		local _, total = ns.Vault.Gold()
		accountText:SetText("Account " .. ns.Money(total))
		accountText:Show()
	else
		accountText:Hide()
	end
end

local function PortraitTooltip(self)
	local entry = CharEntry()
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	GameTooltip:SetText(ns.Label(Selected()), 1, 1, 1)
	local line = {}
	if entry and entry.level then line[#line + 1] = "Level " .. entry.level end
	if entry and entry.class then line[#line + 1] = ClassLabel(entry.class) end
	if #line > 0 then GameTooltip:AddLine(table.concat(line, " "), 0.8, 0.8, 0.8) end
	local record = entry and (mode == "bags" and entry.bags or entry.bank)
	if mode == "guild" then record = GuildRecord() end
	if record then
		GameTooltip:AddLine("Checked " .. When(record.time), 0.6, 0.85, 1)
	else
		GameTooltip:AddLine("Not seen yet", 0.6, 0.85, 1)
	end
	if mode ~= "guild" then
		local gold = GoldOf(Selected())
		if gold then GameTooltip:AddDoubleLine("Gold", ns.Money(gold), 1, 0.82, 0, 1, 1, 1) end
		local _, total = ns.Vault.Gold()
		GameTooltip:AddDoubleLine("Account", ns.Money(total), 1, 0.82, 0, 1, 1, 1)
	end
	GameTooltip:Show()
end

local function Portrait()
	if not window.csPortrait then return end
	local entry = CharEntry()
	if Selected() == ns.Who() then
		window.csPortrait:SetTexCoord(0, 1, 0, 1)
		if not ns.SetPlayerPortrait(window.csPortrait) then
			SetClassIcon(window.csPortrait, entry and entry.class)
		end
	else
		SetClassIcon(window.csPortrait, entry and entry.class)
	end
end

local function LayoutBank()
	local entry = CharEntry()
	local record = entry and entry.bank
	window.csTitle:SetText("Bank")
	local mains, bags = BankParts(record)

	-- What the grid is showing: a bag that was clicked, or one of the main tabs. The two are kept
	-- in separate variables so a tab index can never be read as a bag index.
	local container
	if viewingBag and bags[viewingBag] then
		container = bags[viewingBag]
	else
		viewingBag = nil
		if type(viewing) == "number" and not mains[viewing] then viewing = nil end
		container = mains[viewing or 1]
	end

	local geo = BankGeometry(record)
	local cols = geo.cols or BANK_COLS
	local slots = container and container.slots or 48
	local rows = LayoutGrid(slots, cols, false, container and container.items or {}, geo)

	local tabs = {}
	if #mains > 1 then
		for index, bucket in ipairs(mains) do
			tabs[index] = { label = bucket.label, detail = #bucket.items .. " of " .. bucket.slots .. " used" }
		end
	end
	local tabColumn = LayoutTabs(tabs, geo.originX + cols * geo.pitchX + 4, geo.originY)

	local gridBottom = geo.originY + (rows - 1) * geo.pitchY + geo.cell
	-- Without a measured place for the Bag Slots they sit a clear gap under the grid, the rule
	-- between the two.
	local rowBottom = LayoutBagRow(record, gridBottom + 14, geo)
	divider:Hide()
	SizeWindow(cols, rows, tabColumn, true, nil, geo, rowBottom)
	Footer(record)

	if record then
		noteText:Hide()
	else
		noteText:SetText(Selected() == ns.Who() and "Open your bank once and it will be remembered here."
			or "This character's bank has not been seen yet.")
		noteText:Show()
	end
end

-- The bags as the combined backpack shows them: one grid, filled from the bottom right corner
-- upwards and leftwards, the backpack's first slot in the bottom right, each further bag stacked
-- above. A reagent bag gets its own small grid underneath, the same way round.
local function LayoutBags()
	local entry = CharEntry()
	local record = entry and entry.bags
	window.csTitle:SetText("Combined Backpack")

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
			PlaceCell(cellIndex, col, row, sequence[k + 1] or nil, PLAIN)
		end
		return rows, cellIndex
	end

	local rows, used = Fill(ordinary, 0, 0)
	local extra = 0
	if reagent then
		-- A gap of half a row with a line through it, then the reagent bag.
		local reagentRows
		reagentRows, used = Fill({ reagent }, rows + 0.5, used)
		divider:ClearAllPoints()
		divider:SetPoint("TOPLEFT", window, "TOPLEFT", MARGIN_X, -(GRID_TOP + rows * PITCH + 6))
		divider:SetWidth(BAGS_COLS * PITCH - GAP)
		divider:Show()
		extra = reagentRows + 0.5
	else
		divider:Hide()
	end
	HideCellsFrom(used + 1)

	LayoutTabs({}, 0)
	HideBagRow()
	SizeWindow(BAGS_COLS, rows, 0, false, extra, PLAIN)
	Footer(record)

	if record then
		noteText:Hide()
	else
		noteText:SetText(Selected() == ns.Who() and "Your bags are read a few seconds after you log in."
			or "This character's bags have not been seen yet.")
		noteText:Show()
	end
end

local function LayoutGuild()
	local record, key = GuildRecord()
	window.csTitle:SetText(key and ("Guild Bank: " .. key:gsub(" %- .*$", "")) or "Guild Bank")

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
	if type(viewing) ~= "number" or not tabList[viewing] then viewing = 1 end
	local tab = tabList[viewing]

	local rows = LayoutGrid(GUILD_SLOTS, GUILD_COLS, true, tab and tab.items or {}, PLAIN)
	local tabColumn = LayoutTabs(tabs, MARGIN_X + GUILD_COLS * PITCH + 4)
	if #tabs == 1 then tabColumn = TAB_SIZE + 10 end
	HideBagRow()
	divider:Hide()
	SizeWindow(GUILD_COLS, rows, tabColumn, false, nil, PLAIN)
	Footer(record)

	if record and tab then
		noteText:Hide()
	else
		noteText:SetText("Open the guild bank once and it will be remembered here.")
		noteText:Show()
	end
end

function VaultUI.Refresh()
	if not window or not window:IsShown() then return end
	-- A character that has since been forgotten, or has nothing saved for this mode (a bank seen
	-- but bags never read, say), falls back to this one, so the window never opens on a character
	-- that has no tab in the row.
	if who and not ns.vault.chars[who] then who = nil end
	if who and mode ~= "guild" then
		local entry = ns.Vault.CharRecord(who)
		if not (entry and entry[mode]) then who = nil end
	end
	Portrait()
	if mode == "guild" then
		LayoutGuild()
	elseif mode == "bags" then
		LayoutBags()
	else
		LayoutBank()
	end
	-- After the window has its final width, so the tabs know how many fit along the top.
	LayoutCharTabs()
end

-- ------------------------------------------------------------------
-- Building the window
-- ------------------------------------------------------------------

local function BuildSearchBox(parent)
	local box
	local ok, made = pcall(CreateFrame, "EditBox", "CasementVaultSearch", parent, "SearchBoxTemplate")
	if ok and made then
		box = made
	else
		local fallbackOK, fallback = pcall(CreateFrame, "EditBox", "CasementVaultSearch", parent, "InputBoxTemplate")
		box = (fallbackOK and fallback) or CreateFrame("EditBox", "CasementVaultSearch", parent)
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
		filter = (self:GetText() or ""):lower()
		VaultUI.Refresh()
	end)
	box:SetScript("OnEscapePressed", function(self) self:SetText("") self:ClearFocus() end)
	return box
end

local function Build()
	if window then return end
	window = ns.CreatePortraitPanel("CasementVault", "vault")
	window:SetSize(380, 420)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:Hide()
	window.csTitle:SetText("Bank")
	-- The character tabs stand above the top edge, so the clamp leaves room for them.
	pcall(window.SetClampRectInsets, window, 0, 0, CTAB_H, 0)

	inset = window.Inset
	if not inset then
		inset = CreateFrame("Frame", nil, window)
		local plate = inset:CreateTexture(nil, "BACKGROUND")
		plate:SetAllPoints()
		plate:SetColorTexture(0, 0, 0, 0.45)
	end
	inset:SetFrameLevel(window:GetFrameLevel() + 1)

	searchBox = BuildSearchBox(window)
	searchBox:SetPoint("TOPRIGHT", window, "TOPRIGHT", -34, -30)

	bagLabel = window:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
	bagLabel:SetText("Bag Slots:")

	bagRule = window:CreateTexture(nil, "ARTWORK")
	bagRule:SetColorTexture(1, 0.82, 0, 0.3)
	bagRule:SetHeight(1)
	bagRule:Hide()

	divider = window:CreateTexture(nil, "ARTWORK")
	divider:SetColorTexture(1, 1, 1, 0.16)
	divider:SetHeight(1)
	divider:Hide()

	moneyText = window:CreateFontString(nil, "OVERLAY", "GameFontNormal")
	moneyText:SetPoint("BOTTOMRIGHT", window, "BOTTOMRIGHT", -16, 12)
	moneyText:SetJustifyH("RIGHT")

	accountText = window:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
	accountText:SetPoint("BOTTOMLEFT", window, "BOTTOMLEFT", MARGIN_X, 14)
	accountText:SetJustifyH("LEFT")
	accountText:Hide()

	-- Hovering either money line lists every character's gold, as on the real windows.
	for _, text in ipairs({ moneyText, accountText }) do
		local hit = CreateFrame("Frame", nil, window)
		hit:SetPoint("TOPLEFT", text, "TOPLEFT", -4, 4)
		hit:SetPoint("BOTTOMRIGHT", text, "BOTTOMRIGHT", 4, -4)
		hit:EnableMouse(true)
		hit:SetScript("OnEnter", function(self) ns.GoldTooltip(self) end)
		hit:SetScript("OnLeave", function() GameTooltip:Hide() end)
		hit.csMoneyHit = true
	end

	-- The portrait is a texture, so a small frame over it carries the tooltip.
	if window.csPortrait then
		local hit = CreateFrame("Frame", nil, window)
		hit:SetAllPoints(window.csPortrait)
		hit:EnableMouse(true)
		hit:SetScript("OnEnter", PortraitTooltip)
		hit:SetScript("OnLeave", function() GameTooltip:Hide() end)
	end

	noteText = window:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
	noteText:SetPoint("CENTER", window, "CENTER", 0, 20)
	noteText:SetWidth(280)
	noteText:SetWordWrap(true)
	noteText:Hide()

	window:SetScript("OnShow", function() VaultUI.Refresh() end)
	tinsert(UISpecialFrames, "CasementVault")
	report["vault window"] = "ok, replica"
end

-- `which` is "bank", "bags" or "guild". Anything else keeps whatever was showing last.
function VaultUI.Show(which, character)
	Build()
	if which == "bank" or which == "bags" or which == "guild" then
		if mode ~= which then viewing, viewingBag = nil, nil end
		mode = which
	end
	if character then who = character end
	window:Show()
	VaultUI.Refresh()
end

function VaultUI.Toggle(which)
	Build()
	if window:IsShown() and (not which or which == mode) then
		window:Hide()
		return
	end
	VaultUI.Show(which or mode)
end

function VaultUI.Mode()
	return mode
end

function VaultUI.Selected()
	return Selected()
end

-- Casement
-- VaultUI: the window that shows a saved bank or guild bank when you are nowhere near it.
--
-- Everything here reads the saved snapshot, never the live bank, so it works anywhere. Item
-- tooltips come from the stored item link where the client will still resolve one, and fall back
-- to the name that was saved with the item.

local ADDON, ns = ...

local report = ns.report
local VaultUI = {}
ns.VaultUI = VaultUI

local WIDTH, HEIGHT = 700, 520
local LIST_W = 168
local PANE_X = LIST_W + 28
local PANE_W = WIDTH - PANE_X - 18
local COLS, CELL = 12, 38

local window, listHolder, scroll, content, slider
local headerText, subText, searchBox, emptyText
local sourceButtons, cells, sectionLabels = {}, {}, {}
local selected, filter = nil, ""

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

-- The sections of the currently selected record: one per bank container or per guild bank tab.
local function Sections(source)
	local out = {}
	if not source then return out end
	local record = source.record
	if source.kind == "char" then
		for _, bucket in ipairs(record.containers or {}) do
			out[#out + 1] = { label = bucket.label, slots = bucket.slots, items = bucket.items }
		end
	else
		local tabs = record.tabs or {}
		local keys = {}
		for index in pairs(tabs) do keys[#keys + 1] = index end
		table.sort(keys)
		for _, index in ipairs(keys) do
			local tab = tabs[index]
			out[#out + 1] = {
				label = (tab.name and tab.name ~= "" and tab.name) or ("Tab " .. index),
				slots = 98,
				items = tab.items or {},
				unviewable = tab.viewable == false,
			}
		end
	end
	return out
end

local function Matches(item)
	if filter == "" then return true end
	local name = item.name or ""
	return name:lower():find(filter, 1, true) ~= nil
end

-- ------------------------------------------------------------------
-- Item cells
-- ------------------------------------------------------------------

local function CellTooltip(self)
	GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
	local item = self.csItem
	local shown = false
	if item.link then
		shown = pcall(GameTooltip.SetHyperlink, GameTooltip, item.link)
	end
	if not shown then
		GameTooltip:SetText(item.name or ("Item " .. tostring(item.id or "?")), 1, 1, 1)
		GameTooltip:AddLine("This item is not in the client's cache, so only the saved name is known.",
			0.7, 0.7, 0.7, true)
	end
	if (item.count or 1) > 1 then
		GameTooltip:AddLine("Stack of " .. item.count, 0.6, 0.85, 1)
	end
	GameTooltip:Show()
end

local function GetCell(index)
	local cell = cells[index]
	if cell then return cell end

	cell = CreateFrame("Button", nil, content)
	cell:SetSize(CELL - 2, CELL - 2)

	local backing = cell:CreateTexture(nil, "BACKGROUND")
	backing:SetAllPoints()
	if not pcall(backing.SetAtlas, backing, "bags-item-slot64") then
		backing:SetColorTexture(0.1, 0.1, 0.12, 0.9)
	end

	local border = cell:CreateTexture(nil, "BORDER")
	border:SetAllPoints()
	cell.border = border

	local icon = cell:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOPLEFT", 2, -2)
	icon:SetPoint("BOTTOMRIGHT", -2, 2)
	cell.icon = icon

	local count = cell:CreateFontString(nil, "OVERLAY", "NumberFontNormal")
	count:SetPoint("BOTTOMRIGHT", -2, 2)
	cell.count = count

	cell:SetScript("OnEnter", CellTooltip)
	cell:SetScript("OnLeave", function() GameTooltip:Hide() end)
	cell:SetScript("OnClick", function(self)
		-- Shift click drops the item link into whatever you are typing, the same as a real bag.
		if IsShiftKeyDown and IsShiftKeyDown() and self.csItem.link and ChatEdit_InsertLink then
			pcall(ChatEdit_InsertLink, self.csItem.link)
		end
	end)

	cells[index] = cell
	return cell
end

local function GetSectionLabel(index)
	local label = sectionLabels[index]
	if label then return label end
	label = content:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	label:SetJustifyH("LEFT")
	sectionLabels[index] = label
	return label
end

-- ------------------------------------------------------------------
-- Laying the grid out
-- ------------------------------------------------------------------

local function LayoutItems()
	local cellIndex, labelIndex, y = 0, 0, 4
	local sections = Sections(selected)
	local shown = 0

	for _, section in ipairs(sections) do
		local matching = {}
		for _, item in ipairs(section.items) do
			if Matches(item) then matching[#matching + 1] = item end
		end

		if #matching > 0 or (filter == "" and #section.items == 0) then
			labelIndex = labelIndex + 1
			local label = GetSectionLabel(labelIndex)
			local used = #section.items
			local text = section.label .. "   |cff909090" .. used .. " of " .. (section.slots or used) .. " used|r"
			if section.unviewable then text = section.label .. "   |cffcc6666not viewable by this character|r" end
			label:SetText(text)
			label:ClearAllPoints()
			label:SetPoint("TOPLEFT", content, "TOPLEFT", 2, -y)
			label:Show()
			y = y + 20

			local column = 0
			for _, item in ipairs(matching) do
				cellIndex = cellIndex + 1
				shown = shown + 1
				local cell = GetCell(cellIndex)
				cell.csItem = item
				cell.icon:SetTexture(item.icon)
				cell.count:SetText((item.count or 1) > 1 and item.count or "")
				local r, g, b = QualityColor(item.quality)
				cell.border:SetColorTexture(r, g, b, 0.85)
				cell:ClearAllPoints()
				cell:SetPoint("TOPLEFT", content, "TOPLEFT", 2 + column * CELL, -y)
				cell:Show()
				column = column + 1
				if column >= COLS then column = 0 y = y + CELL end
			end
			if column > 0 then y = y + CELL end
			y = y + 8
		end
	end

	for i = cellIndex + 1, #cells do cells[i]:Hide() end
	for i = labelIndex + 1, #sectionLabels do sectionLabels[i]:Hide() end

	content:SetHeight(math.max(y, 10))
	content:SetWidth(PANE_W - 22)

	-- The slider only has something to do once the grid is taller than the window.
	local visible = scroll:GetHeight() or 1
	local range = math.max(0, (y) - visible)
	slider:SetMinMaxValues(0, range)
	if (slider:GetValue() or 0) > range then slider:SetValue(range) end
	slider:SetShown(range > 0)

	return shown
end

-- ------------------------------------------------------------------
-- The source list
-- ------------------------------------------------------------------

local function SelectSource(source)
	selected = source
	VaultUI.Refresh()
end

local function BuildSourceList()
	local sources = ns.Vault.Sources()

	-- Keep the current choice if it is still there, otherwise take the first.
	if selected then
		local still
		for _, source in ipairs(sources) do
			if source.kind == selected.kind and source.key == selected.key then still = source end
		end
		selected = still
	end
	if not selected then selected = sources[1] end

	for _, button in ipairs(sourceButtons) do button:Hide() end

	local y = 0
	for index, source in ipairs(sources) do
		local button = sourceButtons[index]
		if not button then
			button = CreateFrame("Button", nil, listHolder)
			button:SetSize(LIST_W, 30)
			local highlight = button:CreateTexture(nil, "HIGHLIGHT")
			highlight:SetAllPoints()
			highlight:SetColorTexture(1, 1, 1, 0.08)
			local pick = button:CreateTexture(nil, "BACKGROUND")
			pick:SetAllPoints()
			pick:SetColorTexture(0.35, 0.72, 1, 0.16)
			pick:Hide()
			button.pick = pick
			local name = button:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
			name:SetPoint("TOPLEFT", 6, -4)
			name:SetJustifyH("LEFT")
			name:SetWidth(LIST_W - 12)
			button.nameText = name
			local detail = button:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
			detail:SetPoint("TOPLEFT", 6, -16)
			detail:SetJustifyH("LEFT")
			detail:SetWidth(LIST_W - 12)
			button.detailText = detail
			sourceButtons[index] = button
		end

		local record = source.record
		local items = record.items or 0
		if source.kind == "guild" then
			items = 0
			for _, tab in pairs(record.tabs or {}) do items = items + #(tab.items or {}) end
		end

		button.nameText:SetText((source.kind == "guild" and "|cffffd200<" .. source.label .. ">|r")
			or (source.mine and "|cff8fd3ff" .. source.label .. "|r" or source.label))
		button.detailText:SetText(items .. " items, " .. Ago(record.time))
		button.pick:SetShown(selected and source.kind == selected.kind and source.key == selected.key)
		button:SetPoint("TOPLEFT", listHolder, "TOPLEFT", 0, -y)
		button:SetScript("OnClick", function() SelectSource(source) end)
		button:Show()
		y = y + 32
	end

	return #sources
end

-- ------------------------------------------------------------------
-- Refresh
-- ------------------------------------------------------------------

function VaultUI.Refresh()
	if not window or not window:IsShown() then return end
	local count = BuildSourceList()

	if not selected then
		headerText:SetText("Nothing saved yet")
		subText:SetText("Walk up to your bank and open it once. Casement saves what is in it, and this window will show it from anywhere.")
		for _, cell in ipairs(cells) do cell:Hide() end
		for _, label in ipairs(sectionLabels) do label:Hide() end
		slider:Hide()
		emptyText:Hide()
		return
	end

	local record = selected.record
	local items = 0
	for _, section in ipairs(Sections(selected)) do items = items + #section.items end

	headerText:SetText(selected.kind == "guild" and ("Guild bank of " .. selected.label) or (selected.label .. "'s bank"))
	local money = record.money and (", " .. ns.Money(record.money)) or ""
	local free = record.free and (", " .. record.free .. " free slots") or ""
	subText:SetText("Last checked " .. When(record.time) .. ". " .. items .. " items" .. free .. money .. ".")

	local shown = LayoutItems()
	emptyText:SetShown(shown == 0 and items > 0)
	if shown == 0 and items > 0 then emptyText:SetText("Nothing here matches " .. (filter or "")) end
	return count
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
	box:SetSize(180, 20)
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
	window = ns.CreatePanel("CasementVault")
	window:SetSize(WIDTH, HEIGHT)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:Hide()
	window.csTitle:SetText("Casement Vault")

	local listTitle = window:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	listTitle:SetPoint("TOPLEFT", 18, -38)
	listTitle:SetText("|cffffd200Saved banks|r")

	listHolder = CreateFrame("Frame", nil, window)
	listHolder:SetPoint("TOPLEFT", 14, -56)
	listHolder:SetSize(LIST_W, HEIGHT - 110)

	local divider = window:CreateTexture(nil, "ARTWORK")
	divider:SetColorTexture(1, 1, 1, 0.12)
	divider:SetPoint("TOPLEFT", PANE_X - 12, -36)
	divider:SetSize(1, HEIGHT - 86)

	headerText = window:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	headerText:SetPoint("TOPLEFT", PANE_X, -38)
	headerText:SetJustifyH("LEFT")
	headerText:SetWidth(PANE_W)

	subText = window:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subText:SetPoint("TOPLEFT", PANE_X, -60)
	subText:SetJustifyH("LEFT")
	subText:SetWidth(PANE_W)
	subText:SetWordWrap(true)

	searchBox = BuildSearchBox(window)
	searchBox:SetPoint("TOPLEFT", PANE_X + 4, -88)

	scroll = CreateFrame("ScrollFrame", "CasementVaultScroll", window)
	scroll:SetPoint("TOPLEFT", PANE_X, -116)
	scroll:SetSize(PANE_W - 16, HEIGHT - 116 - 44)

	content = CreateFrame("Frame", nil, scroll)
	content:SetSize(PANE_W - 22, 10)
	scroll:SetScrollChild(content)

	emptyText = content:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	emptyText:SetPoint("TOPLEFT", 4, -4)
	emptyText:Hide()

	slider = CreateFrame("Slider", nil, window)
	slider:SetOrientation("VERTICAL")
	slider:SetPoint("TOPRIGHT", window, "TOPRIGHT", -12, -116)
	slider:SetSize(10, HEIGHT - 116 - 44)
	slider:SetMinMaxValues(0, 0)
	slider:SetValue(0)
	local track = slider:CreateTexture(nil, "BACKGROUND")
	track:SetAllPoints()
	track:SetColorTexture(1, 1, 1, 0.06)
	slider:SetThumbTexture("Interface\\Buttons\\WHITE8X8")
	local thumb = slider:GetThumbTexture()
	if thumb then
		thumb:SetSize(10, 40)
		-- Several of the game's slider textures do not render on this client, so the thumb is
		-- painted rather than textured.
		thumb:SetColorTexture(0.62, 0.62, 0.66, 0.9)
	end
	slider:SetScript("OnValueChanged", function(self, value) scroll:SetVerticalScroll(value) end)

	scroll:EnableMouseWheel(true)
	scroll:SetScript("OnMouseWheel", function(_, delta)
		local low, high = slider:GetMinMaxValues()
		local value = ns.Clamp((slider:GetValue() or 0) - delta * 40, low, high)
		slider:SetValue(value)
	end)

	local snapshot = ns.Button(window, "Snapshot now", 110, 22, function()
		ns.Print(ns.Vault.SnapshotNow())
		VaultUI.Refresh()
	end)
	snapshot:SetPoint("BOTTOMLEFT", 16, 14)
	ns.Tooltip(snapshot, "Snapshot now", "Saves what the open bank or guild bank holds. Both are saved on their own as well.")

	local forget = ns.Button(window, "Forget this one", 120, 22, function()
		if not selected then return end
		ns.Vault.Forget(selected.kind, selected.key)
		selected = nil
		VaultUI.Refresh()
	end)
	forget:SetPoint("LEFT", snapshot, "RIGHT", 8, 0)
	ns.Tooltip(forget, "Forget this one", "Removes the selected saved bank from the list.")

	local options = ns.Button(window, "Options", 80, 22, function()
		if ns.ToggleOptions then ns.ToggleOptions() end
	end)
	options:SetPoint("BOTTOMRIGHT", -16, 14)

	window:SetScript("OnShow", function() VaultUI.Refresh() end)
	tinsert(UISpecialFrames, "CasementVault")
	report["vault window"] = "ok"
end

function VaultUI.Toggle()
	Build()
	if window:IsShown() then window:Hide() else window:Show() end
end

function VaultUI.Show()
	Build()
	window:Show()
	VaultUI.Refresh()
end

-- Opens the vault straight at one saved bank, which is what the buttons on the bag window do.
function VaultUI.ShowSource(kind, key)
	Build()
	for _, source in ipairs(ns.Vault.Sources()) do
		if source.kind == kind and source.key == key then selected = source end
	end
	window:Show()
	VaultUI.Refresh()
end

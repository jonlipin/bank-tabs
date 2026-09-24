-- Casement
-- Options: one set of controls, shown either in the game's own options list
-- (Esc > Options > AddOns > Casement) or in a standalone window opened with "/casement window".
--
-- The page is registered as a CANVAS category and holds only this addon's own widgets. It
-- deliberately does not create Settings proxy settings: on this client those taint Blizzard code
-- paths and produce "secret number value" errors in unrelated frames. Registering a canvas
-- category and drawing into it is safe.

local ADDON, ns = ...

local report = ns.report

local CONTENT_W, CONTENT_H = 640, 540
local NAV_W = 146
local PANE_X = NAV_W + 14
local PANE_W = CONTENT_W - PANE_X - 14

local content, window, page
local pages, navButtons = {}, {}
local widgets = {}
local uniqueID = 0

local function NextName(prefix)
	uniqueID = uniqueID + 1
	return "Casement" .. prefix .. uniqueID
end

-- ------------------------------------------------------------------
-- Layout helper: a simple top down flow inside one page
-- ------------------------------------------------------------------

local function NewLayout(parent)
	return { parent = parent, y = 4 }
end

local function Place(layout, region, height, indent)
	region:ClearAllPoints()
	region:SetPoint("TOPLEFT", layout.parent, "TOPLEFT", indent or 0, -layout.y)
	layout.y = layout.y + height
end

-- ------------------------------------------------------------------
-- Widgets
-- ------------------------------------------------------------------

local function Header(layout, label)
	local fs = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	fs:SetText(label)
	Place(layout, fs, 20)
	local line = layout.parent:CreateTexture(nil, "ARTWORK")
	line:SetColorTexture(1, 0.82, 0, 0.35)
	line:SetSize(PANE_W, 1)
	Place(layout, line, 12)
end

local function Note(layout, label, indent, lines)
	local fs = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	fs:SetWidth(PANE_W - (indent or 0))
	fs:SetJustifyH("LEFT")
	fs:SetWordWrap(true)
	fs:SetText(label)
	-- GetStringHeight can report 0 before the first layout pass, so the caller says how many
	-- lines to budget for anything that wraps.
	local height = math.max((lines or 1) * 13, fs:GetStringHeight()) + 8
	Place(layout, fs, height, indent)
	return fs
end

local function Check(layout, label, tooltip, get, set, indent)
	local cb
	for _, template in ipairs({ "UICheckButtonTemplate", "ChatConfigCheckButtonTemplate" }) do
		local ok, made = pcall(CreateFrame, "CheckButton", NextName("Check"), layout.parent, template)
		if ok and made then cb = made break end
	end
	if not cb then
		cb = CreateFrame("CheckButton", NextName("Check"), layout.parent)
		cb:SetNormalTexture("Interface\\Buttons\\UI-CheckBox-Up")
		cb:SetPushedTexture("Interface\\Buttons\\UI-CheckBox-Down")
		cb:SetHighlightTexture("Interface\\Buttons\\UI-CheckBox-Highlight")
		cb:SetCheckedTexture("Interface\\Buttons\\UI-CheckBox-Check")
	end
	cb:SetSize(24, 24)

	local fs = cb.Text or cb.text or (cb.GetName and _G[cb:GetName() .. "Text"])
	if not fs then
		fs = cb:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
		fs:SetPoint("LEFT", cb, "RIGHT", 2, 0)
	end
	fs:SetText(label)
	fs:SetFontObject("GameFontHighlight")

	cb:SetScript("OnClick", function(self)
		set(self:GetChecked() and true or false)
		ns.Refresh()
		ns.SyncOptions()
	end)
	ns.Tooltip(cb, label, tooltip)

	Place(layout, cb, 26, indent)
	widgets[#widgets + 1] = { refresh = function() cb:SetChecked(get() and true or false) end }
	return cb
end

-- A switch with a Reset button sitting at the right hand end of its row, used for the window
-- switches so each one can be put back where the game had it on its own.
local function CheckWithReset(layout, label, tooltip, optionKey)
	local top = layout.y
	local cb = Check(layout, label, tooltip,
		function() return ns.db.windows[optionKey] end,
		function(value)
			ns.db.windows[optionKey] = value
			if not value then ns.Windows.ResetGroup(optionKey) end
		end)

	local reset = ns.Button(layout.parent, "Reset", 60, 20, function()
		ns.Windows.ResetGroup(optionKey)
		if optionKey == "worldmap" and ns.Map.ResetSize then ns.Map.ResetSize() end
		ns.Print("put " .. label:lower() .. " back where the game had it.")
		ns.SyncOptions()
	end)
	reset:SetPoint("TOPRIGHT", layout.parent, "TOPRIGHT", 0, -top - 2)
	ns.Tooltip(reset, "Reset", "Forgets where this window was left and hands it back to the game.")

	local count = layout.parent:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	count:SetPoint("RIGHT", reset, "LEFT", -6, 0)
	widgets[#widgets + 1] = { refresh = function()
		local moved = ns.Windows.MovedCount(optionKey)
		count:SetText(moved > 0 and (moved .. " moved") or "")
		reset:SetEnabled(moved > 0)
	end }
	return cb
end

local SLIDER_TEMPLATES = { "MinimalSliderTemplate", "UISliderTemplate", "OptionsSliderTemplate" }

local function Slider(layout, label, minV, maxV, step, get, set, format, tooltip, indent)
	local name = NextName("Slider")
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W - (indent or 0), 40)

	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)

	local value = holder:CreateFontString(nil, "ARTWORK", "GameFontNormalSmall")
	value:SetPoint("TOPRIGHT", 0, -1)

	local slider, used
	for _, template in ipairs(SLIDER_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Slider", name, holder, template)
		if ok and made then slider, used = made, template break end
	end
	if not slider then
		slider = CreateFrame("Slider", name, holder)
		slider:SetOrientation("HORIZONTAL")
		slider:SetThumbTexture("Interface\\Buttons\\WHITE8X8")
		local thumb = slider:GetThumbTexture()
		if thumb then thumb:SetSize(10, 18) thumb:SetColorTexture(0.62, 0.62, 0.66, 0.9) end
		used = "bare"
	end
	report["slider template"] = used

	-- OptionsSliderTemplate brings its own captions, we draw our own.
	for _, suffix in ipairs({ "Low", "High", "Text" }) do
		local extra = _G[name .. suffix]
		if extra then extra:SetText("") extra:Hide() end
	end

	slider:SetPoint("TOPLEFT", 2, -18)
	slider:SetSize(PANE_W - (indent or 0) - 6, 18)
	slider:SetMinMaxValues(minV, maxV)
	if slider.SetValueStep then slider:SetValueStep(step) end
	if slider.SetObeyStepOnDrag then pcall(slider.SetObeyStepOnDrag, slider, true) end

	local function Label(v) value:SetText(format and format(v) or tostring(v)) end

	slider:SetScript("OnValueChanged", function(self, v)
		v = math.floor(v / step + 0.5) * step
		Label(v)
		if self.csSyncing then return end
		set(v)
		ns.Refresh()
	end)
	ns.Tooltip(slider, label, tooltip)

	Place(layout, holder, 44, indent)
	widgets[#widgets + 1] = { refresh = function()
		local v = get()
		slider.csSyncing = true
		slider:SetValue(v)
		slider.csSyncing = false
		Label(v)
	end }
	return slider
end

local function Choice(layout, label, options, get, set, tooltip, indent)
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W - (indent or 0), 44)

	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)

	local buttons = {}
	local x = 0
	for index, option in ipairs(options) do
		local button = ns.Button(holder, option.label, 44, 21)
		local textWidth = button:GetFontString() and button:GetFontString():GetStringWidth() or 40
		button:SetWidth(math.max(44, textWidth + 18))
		button:SetPoint("TOPLEFT", x, -20)
		x = x + button:GetWidth() + 4
		button.csValue = option.value
		button:SetScript("OnClick", function(self)
			set(self.csValue)
			ns.Refresh()
			ns.SyncOptions()
		end)
		ns.Tooltip(button, label, option.tooltip or tooltip)
		buttons[index] = button
	end

	Place(layout, holder, 46, indent)
	widgets[#widgets + 1] = { refresh = function()
		local current = get()
		for _, button in ipairs(buttons) do
			if button.csValue == current then
				if button.LockHighlight then button:LockHighlight() end
				if button.SetNormalFontObject then pcall(button.SetNormalFontObject, button, "GameFontNormalSmall") end
			else
				if button.UnlockHighlight then button:UnlockHighlight() end
				if button.SetNormalFontObject then pcall(button.SetNormalFontObject, button, "GameFontDisableSmall") end
			end
		end
	end }
	return holder
end

local function ButtonRow(layout, buttons)
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(PANE_W, 24)
	local x = 0
	for _, spec in ipairs(buttons) do
		local button = ns.Button(holder, spec.label, spec.width or 130, 22, spec.onClick)
		button:SetPoint("LEFT", x, 0)
		x = x + button:GetWidth() + 6
		ns.Tooltip(button, spec.label, spec.tooltip)
		if spec.refresh then widgets[#widgets + 1] = { refresh = function() spec.refresh(button) end } end
	end
	Place(layout, holder, 30)
	return holder
end

-- ------------------------------------------------------------------
-- Pages
-- ------------------------------------------------------------------

local function BuildWindowsPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "Windows you can move")

	Check(layout, "Casement is on", "The master switch. With this off nothing is moved, resized or added to any window.",
		function() return ns.db.enabled end,
		function(value) ns.db.enabled = value end)

	Note(layout, "Each window below can be dragged by the strip along its top edge. The world map is dragged by the clear parts of its own top bar, and shows a small gold handle in its top left corner only if that bar has no room. No window can be dragged off screen.", 0, 4)

	for _, group in ipairs(ns.Windows.GROUPS) do
		CheckWithReset(layout, group.label, nil, group.key)
	end

	layout.y = layout.y + 6
	Choice(layout, "Hold this key to drag a window from anywhere", {
		{ value = "none", label = "Off" },
		{ value = "shift", label = "Shift" },
		{ value = "ctrl", label = "Ctrl" },
		{ value = "alt", label = "Alt" },
	}, function() return ns.db.dragModifier end,
		function(value) ns.db.dragModifier = value end,
		"While the key is held, a managed window can be grabbed anywhere on it, not just by its top strip.")

	Check(layout, "Show me where the drag strips are", "Paints a faint blue band over the part of each window that can be dragged.",
		function() return ns.db.showGrips end,
		function(value) ns.db.showGrips = value end)

	Check(layout, "Minimap button", "Left-click for these options, right-click for the saved bank contents, drag it round the rim.",
		function() return ns.db.minimap.shown end,
		function(value) ns.db.minimap.shown = value end)

	ButtonRow(layout, {
		{ label = "Reset every window", width = 150, onClick = function()
			ns.Windows.ResetAll()
			ns.Map.ResetSize()
			ns.Print("every window is back where the game had it.")
		end, tooltip = "Forgets every saved position and the map's size." },
	})
end

local function BuildMapPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "World map")

	Note(layout, "Everything this addon adds to the map lives in a tab under it, so nothing is laid over the map's own interface. Resizing scales the whole window, so the grip and the percentage buttons are two ways of setting the same number, and the map, its pins and its text stay in proportion.", 0, 5)

	Check(layout, "Drag the map by its top bar", "The clear stretches of the top bar move the map. The game's own buttons up there are measured and left alone.",
		function() return ns.db.map.topBarDrag end,
		function(value) ns.db.map.topBarDrag = value end)

	Check(layout, "Percentage buttons in the tab", "Minus, the current percentage, plus, and a button back to 100 percent.",
		function() return ns.db.map.scaleButtons end,
		function(value) ns.db.map.scaleButtons = value end)

	Check(layout, "Resize grip in the tab", "Drag it to scale the map. Hold shift while dragging to snap to the step below.",
		function() return ns.db.map.resizeGrip end,
		function(value) ns.db.map.resizeGrip = value end)

	Check(layout, "Always show the corner handle", "A small gold handle in the map's top left corner. It appears on its own if the top bar has no room to spare.",
		function() return ns.db.map.cornerHandle end,
		function(value) ns.db.map.cornerHandle = value end)

	Check(layout, "Coordinates in the tab", "Your position, at the left end of the tab, with a button that puts it into chat (or right-click for a box to copy it from). The tab grows to the left to make room.",
		function() return ns.db.map.coords end,
		function(value) ns.db.map.coords = value end)

	Check(layout, "Cursor coordinates too", "A second line under your position with where the mouse is pointing on the map.",
		function() return ns.db.map.coordsCursor end,
		function(value) ns.db.map.coordsCursor = value end, 24)

	Check(layout, "Draw the parts of the map you have not explored", "Paints the unexplored areas in with their real art. The addon can only draw an area it knows the art for: what is shipped with it, plus everything any character on this account has ever had revealed. /casement mapdata says how much of the open map that covers.",
		function() return ns.db.map.reveal end,
		function(value) ns.db.map.reveal = value end)

	Choice(layout, "Tint the areas you have not explored", {
		{ value = "none", label = "No tint" },
		{ value = "blue", label = "Blue" },
		{ value = "sepia", label = "Sepia" },
		{ value = "grey", label = "Grey" },
	}, function() return ns.db.map.revealTint end,
		function(value) ns.db.map.revealTint = value end,
		"So the drawn in areas can still be told from the ones you have actually been to.", 24)

	Slider(layout, "Map size", 50, 200, 5,
		function() return math.floor((ns.db.map.scale or 1) * 100 + 0.5) end,
		function(value) ns.Map.SetScale(value / 100, false) end,
		function(v) return v .. "%" end,
		"The same number the buttons and the corner grip set.")

	Slider(layout, "The buttons move in steps of", 5, 25, 5,
		function() return ns.db.map.step or 10 end,
		function(value) ns.db.map.step = value end,
		function(v) return v .. "%" end,
		"How far one click of the plus or minus button moves the size. Clicks always land on a round multiple of this.")

	Note(layout, "The map is only moved and scaled while it is in its windowed shape. A maximized map is left alone.", 0, 2)

	ButtonRow(layout, {
		{ label = "Back to 100%", width = 110, onClick = function() ns.Map.ResetSize() end },
		{ label = "Forget its position", width = 140, onClick = function()
			ns.Windows.ResetGroup("worldmap")
			ns.Print("the map is back where the game had it.")
		end },
	})
end

local function BuildVaultPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "Bank snapshots")

	Note(layout, "What your bank and your guild bank hold is saved every time you open them, and your bags a few seconds after you log in and whenever they settle. Every character on this account is remembered, and the vault window has a tab for each, so any character's bank or bags can be looked at from anywhere.", 0, 4)

	Check(layout, "Remember the bank when I open it", nil,
		function() return ns.db.vault.autoBank end,
		function(value) ns.db.vault.autoBank = value end)

	Check(layout, "Remember the guild bank when I open it", "The guild bank is read one tab at a time, which takes a couple of seconds and puts the tab you were looking at back when it is done.",
		function() return ns.db.vault.autoGuild end,
		function(value) ns.db.vault.autoGuild = value end)

	Check(layout, "Icons on the bag window", "Three icons in the header of your backpack: the saved bank, the saved bags and the saved guild bank. They go somewhere the game is not already using.",
		function() return ns.db.vault.bagButtons end,
		function(value) ns.db.vault.bagButtons = value end)

	local status = Note(layout, "", 0, 2)
	widgets[#widgets + 1] = { refresh = function()
		local chars, guilds = 0, 0
		for _ in pairs(ns.vault.chars or {}) do chars = chars + 1 end
		for _ in pairs(ns.vault.guilds or {}) do guilds = guilds + 1 end
		status:SetText("Saved right now: " .. chars .. " character" .. (chars == 1 and "" or "s")
			.. " and " .. guilds .. " guild bank" .. (guilds == 1 and "" or "s") .. ".")
	end }

	ButtonRow(layout, {
		{ label = "Saved bank", width = 100, onClick = function() ns.VaultUI.Show("bank") end,
			tooltip = "Also on /casement vault." },
		{ label = "Saved bags", width = 100, onClick = function() ns.VaultUI.Show("bags") end,
			tooltip = "Also on /casement bags." },
		{ label = "Guild bank", width = 100, onClick = function() ns.VaultUI.Show("guild") end,
			tooltip = "Also on /casement guild." },
		{ label = "Snapshot now", width = 130, onClick = function() ns.Print(ns.Vault.SnapshotNow()) end,
			tooltip = "Saves your bags, and the bank or guild bank if one is open in front of you." },
	})
end

local function BuildAboutPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "About Casement")

	Note(layout, "Casement version " .. ns.version .. ".", 0, 1)
	Note(layout, "Commands:", 0, 1)
	local lines = {
		"/casement opens these options",
		"/casement window opens them in a window of their own",
		"/casement vault, bags or guild open the saved bank, bags or guild bank",
		"/casement snapshot saves what is open in front of you",
		"/casement scale 120 sets the map size",
		"/casement lock or unlock turns every window switch off or on",
		"/casement minimap shows or hides the minimap button",
		"/casement reset puts every window back",
		"/casement debug prints what resolved on this client",
	}
	for _, line in ipairs(lines) do Note(layout, "|cffffff00" .. line .. "|r", 12, 1) end

	Note(layout, "If a window will not move, or the map controls are missing, run /casement debug and send the output along with the report. Every part of this addon probes the client first and says in there what it found.", 0, 4)

	ButtonRow(layout, {
		{ label = "Print the debug report", width = 170, onClick = function()
			SlashCmdList["CASEMENT"]("debug")
		end },
		{ label = "Reset all settings", width = 140, onClick = function() ns.ResetToDefaults() end },
	})
end

local PAGES = {
	{ key = "windows", label = "Windows", build = BuildWindowsPage },
	{ key = "map", label = "World map", build = BuildMapPage },
	{ key = "vault", label = "Bank snapshots", build = BuildVaultPage },
	{ key = "about", label = "About", build = BuildAboutPage },
}

local function ShowPage(key)
	for _, entry in ipairs(PAGES) do
		if pages[entry.key] then pages[entry.key]:SetShown(entry.key == key) end
		local button = navButtons[entry.key]
		if button then
			if entry.key == key then
				if button.LockHighlight then button:LockHighlight() end
			else
				if button.UnlockHighlight then button:UnlockHighlight() end
			end
		end
	end
	ns.SyncOptions()
end

-- ------------------------------------------------------------------
-- The shared content block
-- ------------------------------------------------------------------

local function BuildContent()
	if content then return end

	content = CreateFrame("Frame", "CasementOptions", UIParent)
	content:SetSize(CONTENT_W, CONTENT_H)

	local title = content:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	title:SetPoint("TOPLEFT", 0, 0)
	title:SetText("Casement")

	local subtitle = content:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)
	subtitle:SetText("Move and resize the game's own windows, and remember what your bank holds.")

	local nav = CreateFrame("Frame", nil, content)
	nav:SetPoint("TOPLEFT", 0, -44)
	nav:SetSize(NAV_W, CONTENT_H - 44)

	local navY = 0
	for _, entry in ipairs(PAGES) do
		local button = ns.Button(nav, entry.label, NAV_W - 8, 24, function() ShowPage(entry.key) end)
		button:SetPoint("TOPLEFT", 0, -navY)
		navButtons[entry.key] = button
		navY = navY + 28
	end

	local divider = content:CreateTexture(nil, "ARTWORK")
	divider:SetColorTexture(1, 1, 1, 0.12)
	divider:SetPoint("TOPLEFT", NAV_W, -44)
	divider:SetSize(1, CONTENT_H - 54)

	for _, entry in ipairs(PAGES) do
		local frame = CreateFrame("Frame", nil, content)
		frame:SetPoint("TOPLEFT", PANE_X, -44)
		frame:SetSize(PANE_W, CONTENT_H - 50)
		frame:Hide()
		pages[entry.key] = frame
		local ok, err = pcall(entry.build, frame)
		report["page " .. entry.key] = ok and "ok" or ("failed: " .. tostring(err))
	end

	ShowPage("windows")
	-- Stays out of sight until a host (the window or the options page) asks for it.
	content:Hide()
end

function ns.SyncOptions()
	if not content or not ns.db then return end
	for _, widget in ipairs(widgets) do pcall(widget.refresh) end
end

local function HostContent(host, x, y, scale)
	content:SetParent(host)
	content:ClearAllPoints()
	content:SetPoint("TOPLEFT", host, "TOPLEFT", x, y)
	content:SetScale(scale or 1)
	content:Show()
end

-- ------------------------------------------------------------------
-- Standalone window
-- ------------------------------------------------------------------

local function BuildWindow()
	if window then return end
	window = ns.CreatePanel("CasementWindow")
	window:SetSize(CONTENT_W + 32, CONTENT_H + 52)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:Hide()
	window.csTitle:SetText("Casement")

	window:SetScript("OnShow", function(self)
		HostContent(self, 18, -36, 1)
		ns.SyncOptions()
	end)

	tinsert(UISpecialFrames, "CasementWindow")
end

-- ------------------------------------------------------------------
-- The entry in Esc > Options > AddOns
-- ------------------------------------------------------------------

-- The category's ID, which is what Settings.OpenToCategory actually documents. Passing the
-- category itself is accepted by some builds and quietly ignored by others.
local function CategoryID()
	local category = ns.optionsCategory
	if not category then return nil end
	if category.GetID then
		local ok, id = pcall(category.GetID, category)
		if ok and id then return id end
	end
	return category.ID or category.id
end

local function PanelIsOpen()
	if SettingsPanel and SettingsPanel.IsShown then return SettingsPanel:IsShown() and true or false end
	return false
end

-- True once our page is actually on screen. Everything below is judged against this rather than
-- against whether a call raised an error, because the call that does nothing does not error.
local function PageIsOpen()
	if not page then return false end
	if page.IsVisible then return page:IsVisible() and true or false end
	return page:IsShown() and true or false
end

local function ShowPanel()
	if not SettingsPanel then return end
	if SettingsPanel.Open then
		if pcall(SettingsPanel.Open, SettingsPanel) then return end
	end
	if ShowUIPanel then pcall(ShowUIPanel, SettingsPanel) end
end

-- Settings.OpenToCategory NAVIGATES to a category, it does not necessarily open the window. With
-- the window shut it can quietly do nothing, which is why the first route opens the window itself
-- before navigating. Each route is tried in turn and judged on whether the page ended up visible.
local OPEN_ROUTES = {
	{
		name = "opening the window, then the category id",
		run = function()
			ShowPanel()
			local id = CategoryID()
			if id and Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, id) end
		end,
	},
	{
		name = "the category id",
		run = function()
			local id = CategoryID()
			if id and Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, id) end
		end,
	},
	{
		name = "the category itself",
		run = function()
			if Settings and Settings.OpenToCategory then pcall(Settings.OpenToCategory, ns.optionsCategory) end
		end,
	},
	{
		name = "the older interface options route",
		run = function()
			if InterfaceOptionsFrame_OpenToCategory and page then
				-- This one wants two goes at it to land on the right panel.
				pcall(InterfaceOptionsFrame_OpenToCategory, page)
				pcall(InterfaceOptionsFrame_OpenToCategory, page)
			end
		end,
	},
}

function ns.OpenBlizzardOptions()
	if not ns.optionsCategory then return false end
	local panelWasOpen = PanelIsOpen()

	for _, route in ipairs(OPEN_ROUTES) do
		route.run()
		if PageIsOpen() then
			report["open options"] = "ok, via " .. route.name
			return true
		end
	end

	if not panelWasOpen and PanelIsOpen() then
		if HideUIPanel then pcall(HideUIPanel, SettingsPanel) end
	end
	report["open options"] = "no route worked, using the addon's own window"
	return false
end

function ns.ToggleOptions(forceWindow)
	BuildContent()
	BuildWindow()

	if window:IsShown() then window:Hide() return end
	if PageIsOpen() then
		-- Closing the game's own panel from addon code is protected here, so the user closes it.
		return
	end

	if not forceWindow and ns.OpenBlizzardOptions() then return end
	window:Show()
end

local function BuildOptionsCategory()
	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		report["options category"] = "Settings API missing, use /casement window"
		return
	end

	page = CreateFrame("Frame")
	page:Hide()
	page.name = "Casement"
	-- The canvas mixin looks for these; ours have nothing to do because every control writes its
	-- value straight into the saved variables when it is used.
	page.OnCommit = function() end
	page.OnDefault = function() ns.ResetToDefaults() end
	page.OnRefresh = function() ns.SyncOptions() end

	local function Fit()
		local w, h = page:GetWidth() or 0, page:GetHeight() or 0
		if w <= 0 or h <= 0 then return end
		local scale = math.min(1, (w - 24) / CONTENT_W, (h - 24) / CONTENT_H)
		HostContent(page, 12, -12, scale)
	end

	page:SetScript("OnShow", function()
		if window and window:IsShown() then window:Hide() end
		Fit()
		ns.SyncOptions()
	end)
	page:SetScript("OnSizeChanged", function() if page:IsShown() then Fit() end end)

	local category = Settings.RegisterCanvasLayoutCategory(page, "Casement")
	Settings.RegisterAddOnCategory(category)
	ns.optionsCategory = category
	report["options category"] = "ok (canvas page)"
end

function ns.SetupOptions()
	BuildContent()
	BuildWindow()
	local ok, err = pcall(BuildOptionsCategory)
	if not ok then report["options category"] = "failed: " .. tostring(err) end
	ns.SyncOptions()
end

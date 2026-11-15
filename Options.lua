-- Bank Tabs
-- Options: one set of controls, shown in the game's own options list (Esc > Options > AddOns >
-- Bank Tabs) and in a standalone window opened with "/banktabs window". Each host has a copy of
-- its own, built from the same pages, so the window's copy can wear the window style
-- (BankTabs_Skins.lua) while the page in the game's options keeps the game's look, as every other
-- addon's page there does. Every control writes straight into the saved variables, and
-- ns.SyncOptions brings both copies up to date.
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

local window, page
local blocks = {}  -- each host's copy of the options: blocks.page (the game's options) and blocks.window
local widgets = {}
local uniqueID = 0

local function NextName(prefix)
	uniqueID = uniqueID + 1
	return "BankTabs" .. prefix .. uniqueID
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

-- A slider with its caption above and its value at the right hand end.
local SLIDER_W = 240
local SLIDER_TEMPLATES = { "MinimalSliderTemplate", "UISliderTemplate", "OptionsSliderTemplate" }

local function NewSlider(parent)
	for _, template in ipairs(SLIDER_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Slider", NextName("Slider"), parent, template)
		if ok and made and made.SetMinMaxValues then
			report["slider"] = template
			-- OptionsSliderTemplate carries captions of its own; this draws its own.
			for _, key in ipairs({ "Low", "High", "Text" }) do
				local part = made[key] or (made.GetName and _G[(made:GetName() or "") .. key])
				if type(part) == "table" and part.SetText then part:SetText("") end
			end
			return made
		end
		if ok and made then made:Hide() end
	end
	report["slider"] = "plain"
	local slider = CreateFrame("Slider", NextName("Slider"), parent)
	slider:SetOrientation("HORIZONTAL")
	local track = slider:CreateTexture(nil, "BACKGROUND")
	track:SetPoint("LEFT")
	track:SetPoint("RIGHT")
	track:SetHeight(6)
	track:SetColorTexture(0, 0, 0, 0.6)
	local thumb = slider:CreateTexture(nil, "ARTWORK")
	thumb:SetSize(10, 16)
	thumb:SetColorTexture(0.8, 0.8, 0.82, 1)
	slider:SetThumbTexture(thumb)
	return slider
end

local function Slider(layout, label, spec, indent)
	local holder = CreateFrame("Frame", nil, layout.parent)
	holder:SetSize(SLIDER_W + 4, 40)

	local caption = holder:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
	caption:SetPoint("TOPLEFT", 0, 0)
	caption:SetText(label)
	local value = holder:CreateFontString(nil, "ARTWORK", "GameFontNormal")
	value:SetPoint("TOPRIGHT", 0, 0)

	local slider = NewSlider(holder)
	slider:SetPoint("TOPLEFT", 2, -18)
	slider:SetSize(SLIDER_W, 16)
	slider:SetMinMaxValues(spec.min, spec.max)
	slider:SetValueStep(spec.step)
	if slider.SetObeyStepOnDrag then pcall(slider.SetObeyStepOnDrag, slider, true) end

	-- Setting the value from the saved one fires the same script, which must not write it back.
	local syncing = false
	local function ShowValue(v) value:SetText(spec.format and spec.format(v) or tostring(v)) end
	slider:SetScript("OnValueChanged", function(_, v)
		if syncing then return end
		v = math.floor(v / spec.step + 0.5) * spec.step
		v = math.max(spec.min, math.min(spec.max, v))
		if v ~= spec.get() then spec.set(v) end
		ShowValue(v)
	end)

	Place(layout, holder, 44, indent)
	widgets[#widgets + 1] = { refresh = function()
		syncing = true
		pcall(slider.SetValue, slider, spec.get())
		syncing = false
		ShowValue(spec.get())
	end }
	holder.slider, holder.caption, holder.value = slider, caption, value
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

	Check(layout, "Bank Tabs is on", "The master switch. With this off no bag, bank or guild bank window is moved and nothing is added to them.",
		function() return ns.db.enabled end,
		function(value) ns.db.enabled = value end)

	Note(layout, "Each window below can be dragged by the strip along its top edge, the close button left clear. No window can be dragged off screen, and each is remembered for this character. The world map is not moved by Bank Tabs: that is the separate addon Map Tab.", 0, 4)

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
		"While the key is held, a managed window can be grabbed anywhere on it, not just by its top strip. Nothing shows on screen unless the drag areas are switched on below.")

	Check(layout, "Show me where the drag strips are", "Paints a faint blue band over the part of each window that can be dragged.",
		function() return ns.db.showGrips end,
		function(value) ns.db.showGrips = value end)

	Check(layout, "Minimap button", "Left-click for the saved bank, right-click for these options, drag it round the rim.",
		function() return ns.db.minimap.shown end,
		function(value) ns.db.minimap.shown = value end)

	ButtonRow(layout, {
		{ label = "Reset every window", width = 150, onClick = function()
			ns.Windows.ResetAll()
			ns.Print("every bag and bank window is back where the game had it.")
		end, tooltip = "Forgets where every bag, bank and guild bank window was left." },
	})
end

local function BuildVaultPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "Bank snapshots")

	Note(layout, "What your bank and your guild bank hold is saved every time you open them, and your bags a few seconds after you log in and whenever they settle. Every character on this account is remembered. The saved bank, the saved bags and the saved guild bank are windows of their own that can be open together, with a tab per character, so any character's bank, or another character's bags, can be looked at from anywhere.", 0, 5)

	Check(layout, "Remember the bank when I open it", nil,
		function() return ns.db.vault.autoBank end,
		function(value) ns.db.vault.autoBank = value end)

	Check(layout, "Remember the guild bank when I open it", "The guild bank is read one tab at a time, which takes a couple of seconds and puts the tab you were looking at back when it is done.",
		function() return ns.db.vault.autoGuild end,
		function(value) ns.db.vault.autoGuild = value end)

	Check(layout, "Tabs above the backpack", "Three tabs along the top of your backpack, the same as the character tabs: the saved bank, the saved bags and the saved guild bank. A tab glows while its window is open, and is dimmed while there is nothing saved for it.",
		function() return ns.db.vault.bagButtons end,
		function(value) ns.db.vault.bagButtons = value end)

	Check(layout, "Account gold in the corner of the saved bank", "A small line in the bottom left of the saved bank and bags with every character's gold added up. /banktabs gold lists them one by one.",
		function() return ns.db.vault.showAccountGold end,
		function(value) ns.db.vault.showAccountGold = value end)

	Check(layout, "Every character's gold when hovering the money", "Hover the money on your bag window, the bank, or the saved bank, and a tooltip lists each character's gold and the total.",
		function() return ns.db.vault.moneyTooltip end,
		function(value) ns.db.vault.moneyTooltip = value end)

	Check(layout, "Item tooltips: who has it and where", "Lines on every item tooltip with each character that has the item, how many in their bank and bags, and the guild bank, from the snapshots. Your own bags are counted live.",
		function() return ns.db.tooltips.enabled end,
		function(value) ns.db.tooltips.enabled = value end)

	Check(layout, "Include the guild bank", nil,
		function() return ns.db.tooltips.guild end,
		function(value) ns.db.tooltips.guild = value end, 24)

	Check(layout, "Add an account total", "Only when the item is in more than one place.",
		function() return ns.db.tooltips.total end,
		function(value) ns.db.tooltips.total = value end, 24)

	Choice(layout, "Only while holding", {
		{ value = "none", label = "Always" },
		{ value = "shift", label = "Shift" },
		{ value = "ctrl", label = "Ctrl" },
		{ value = "alt", label = "Alt" },
	}, function() return ns.db.tooltips.modifier end,
		function(value) ns.db.tooltips.modifier = value end,
		"Keeps tooltips short until you ask.", 24)

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
			tooltip = "Also on /banktabs bank." },
		{ label = "Saved bags", width = 100, onClick = function() ns.VaultUI.Show("bags") end,
			tooltip = "Also on /banktabs bags." },
		{ label = "Guild bank", width = 100, onClick = function() ns.VaultUI.Show("guild") end,
			tooltip = "Also on /banktabs guild." },
		{ label = "Snapshot now", width = 130, onClick = function() ns.Print(ns.Vault.SnapshotNow()) end,
			tooltip = "Saves your bags, and the bank or guild bank if one is open in front of you." },
	})
end

-- The window style of Bank Tabs' own windows, from Styles.lua (shared with Jon's other addons).
local function BuildLookPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "Look")
	local Styles = ns.Styles
	if not Styles then
		Note(layout, "The window styles are not loaded on this client.", 0, 1)
		return
	end

	Note(layout, "How Bank Tabs' own windows are drawn: the saved bank, bags and guild bank with their slots and tabs, and the options window. The game's own windows keep their look, and so does this page in Esc > Options.", 0, 3)

	local styleButton = ns.Button(parent, "", 220, 22)
	Place(layout, styleButton, 28)
	styleButton:RegisterForClicks("LeftButtonUp", "RightButtonUp")
	styleButton:SetScript("OnClick", function(_, button)
		Styles.Try("style switch", Styles.Cycle, button == "RightButton" and -1 or 1)
		ns.SyncOptions()
	end)
	styleButton:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText("Window style", 1, 1, 1)
		for _, line in ipairs(Styles.HELP) do GameTooltip:AddLine(line, nil, nil, nil, true) end
		GameTooltip:AddLine("Left-click for the next style, right-click for the previous one.", 0.6, 0.6, 0.6, true)
		GameTooltip:Show()
	end)
	styleButton:SetScript("OnLeave", function() GameTooltip:Hide() end)
	styleButton.csStyleButton = true

	local note = Note(layout, "", 0, 2)
	layout.y = layout.y + 6

	local opacity = Slider(layout, "Dark background opacity", {
		min = 0, max = 100, step = 5,
		get = function() return math.floor((ns.db.darkAlpha or 0.92) * 100 + 0.5) end,
		set = function(v)
			ns.db.darkAlpha = v / 100
			Styles.SetDarkAlpha(ns.db.darkAlpha)
			ns.MirrorToAccount()
		end,
		format = function(v) return v .. "%" end,
	})
	opacity.slider:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText("Dark background opacity", 1, 1, 1)
		GameTooltip:AddLine("How much of the world shows through the Dark style's windows.", nil, nil, nil, true)
		if ns.db.style ~= "dark" then GameTooltip:AddLine("Applies to the Dark style only.", 1, 0.82, 0, true) end
		GameTooltip:Show()
	end)
	opacity.slider:SetScript("OnLeave", function() GameTooltip:Hide() end)
	opacity.slider.csOpacity = true

	widgets[#widgets + 1] = { refresh = function()
		styleButton:SetText("Window style: " .. Styles.Name(ns.db.style))
		note:SetText(Styles.Note())
		-- Grayed unless Dark is the chosen style.
		local dark = ns.db.style == "dark"
		if opacity.slider.SetEnabled then opacity.slider:SetEnabled(dark) end
		opacity.slider:SetAlpha(dark and 1 or 0.5)
		opacity.caption:SetFontObject(dark and "GameFontHighlight" or "GameFontDisable")
		opacity.value:SetFontObject(dark and "GameFontNormal" or "GameFontDisable")
	end }
end

-- Every character and guild bank Bank Tabs has saved, realm by realm, each with a Hide (or Show)
-- and a Delete button. Hidden, a character keeps what is saved but has no tab, no tooltip lines
-- and no share of the account's gold; deleted, everything saved for it is gone, which is the way
-- to be rid of a character that no longer exists. Delete asks for a second click. The switch at
-- the top leaves out every other realm at once. The character being played cannot be hidden or
-- deleted. The list is redrawn from Vault.Roster on every sync, into a pool of rows.
local ROW_H, LIST_H = 26, 372

local function SeenAgo(stamp)
	if type(stamp) ~= "number" then return nil end
	local seconds = time() - stamp
	if seconds < 3600 then return "under an hour ago" end
	if seconds < 86400 then return math.floor(seconds / 3600) .. " h ago" end
	return math.floor(seconds / 86400) .. " d ago"
end

local function ClassHex(token)
	local c = token and type(RAID_CLASS_COLORS) == "table" and RAID_CLASS_COLORS[token]
	if type(c) == "table" and type(c.r) == "number" then
		return string.format("|cff%02x%02x%02x", math.floor(c.r * 255 + 0.5), math.floor((c.g or 0) * 255 + 0.5), math.floor((c.b or 0) * 255 + 0.5))
	end
	return "|cffffffff"
end

local function BuildCharactersPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "Characters")
	Note(layout, "Everything Bank Tabs has saved. Hide keeps what is saved but takes the character off the tabs, the item tooltips and the gold total. Delete forgets it for good, which is how to clear out a character that no longer exists. Click Delete twice to confirm.", 0, 3)

	Check(layout, "Show characters and guild banks from other realms", "Off, only the realm you are playing on has tabs, tooltip lines and a share of the gold total. Nothing is deleted: the others come back when you switch this on or log in over there.",
		function() return ns.db.vault.otherRealms ~= false end,
		function(value)
			ns.db.vault.otherRealms = value and true or false
			ns.Vault.Changed()
		end)

	local scroll
	local okScroll, made = pcall(CreateFrame, "ScrollFrame", NextName("Roster"), parent, "UIPanelScrollFrameTemplate")
	if okScroll and made then scroll = made else scroll = CreateFrame("ScrollFrame", NextName("Roster"), parent) end
	scroll:SetSize(PANE_W - 26, LIST_H)
	Place(layout, scroll, LIST_H, 0)
	local child = CreateFrame("Frame", nil, scroll)
	child:SetSize(PANE_W - 26, ROW_H)
	scroll:SetScrollChild(child)
	if scroll.EnableMouseWheel then
		scroll:EnableMouseWheel(true)
		scroll:SetScript("OnMouseWheel", function(self, delta)
			local range = math.max(0, (child:GetHeight() or 0) - LIST_H)
			local at = (self.GetVerticalScroll and self:GetVerticalScroll()) or 0
			self:SetVerticalScroll(math.max(0, math.min(range, at - delta * ROW_H * 2)))
		end)
	end

	local rows, state = {}, {}
	parent.csRoster = { rows = rows, state = state, scroll = scroll, child = child }

	local Redraw

	local function Row(index)
		local row = rows[index]
		if row then return row end
		row = CreateFrame("Frame", nil, child)
		row:SetSize(PANE_W - 26, ROW_H)
		row:SetPoint("TOPLEFT", 0, -(index - 1) * ROW_H)
		row.text = row:CreateFontString(nil, "ARTWORK", "GameFontHighlight")
		row.text:SetPoint("LEFT", 4, 0)
		row.text:SetJustifyH("LEFT")
		row.delete = ns.Button(row, "Delete", 62, 20, function(self)
			local item = row.csItem
			if not item or item.mine then return end
			local id = item.kind .. ":" .. item.key
			if state.confirm == id and (GetTime() - (state.confirmAt or 0)) <= 4 then
				state.confirm = nil
				ns.Vault.Forget(item.kind, item.key)
				ns.Print("deleted what was saved for " .. item.label .. ".")
				ns.SyncOptions()
			else
				state.confirm, state.confirmAt = id, GetTime()
				ns.After(4.1, function() if state.confirm == id then state.confirm = nil ns.SyncOptions() end end)
				Redraw()
			end
		end)
		row.delete:SetPoint("RIGHT", -2, 0)
		row.hide = ns.Button(row, "Hide", 54, 20, function()
			local item = row.csItem
			if not item or item.mine then return end
			ns.Vault.SetHidden(item.kind, item.key, not item.hidden)
			ns.SyncOptions()
		end)
		row.hide:SetPoint("RIGHT", row.delete, "LEFT", -4, 0)
		row.text:SetPoint("RIGHT", row.hide, "LEFT", -6, 0)
		if row.text.SetWordWrap then row.text:SetWordWrap(false) end
		-- The window's copy wears the window style; rows made after it was drawn are dressed here.
		local content = parent:GetParent()
		if content and content.csStyled and ns.SkinOptionsPart then ns.SkinOptionsPart(row) end
		rows[index] = row
		return row
	end

	Redraw = function()
		local blocks = ns.Vault.Roster()
		local n = 0
		local function Line(item)
			n = n + 1
			local row = Row(n)
			row.csItem = item
			row.text:SetText(item.text)
			local buttons = item.kind ~= nil
			row.hide:SetShown(buttons)
			row.delete:SetShown(buttons)
			if buttons then
				row.hide:SetText(item.hidden and "Show" or "Hide")
				row.hide:SetEnabled(not item.mine)
				row.delete:SetEnabled(not item.mine)
				local confirming = state.confirm == (item.kind .. ":" .. item.key)
				row.delete:SetText(confirming and "Sure?" or "Delete")
			end
			row:SetAlpha((item.kind and not item.shown) and 0.55 or 1)
			row:Show()
		end
		for _, block in ipairs(blocks) do
			Line({ text = "|cffffd100" .. (block.realm or "Realm not saved") .. "|r" .. (block.here and "  |cff909090(this realm)|r" or "") })
			for _, c in ipairs(block.chars) do
				local entry = c.entry
				local bits = {}
				if entry.level then bits[#bits + 1] = tostring(entry.level) end
				local saved = {}
				if entry.bank then saved[#saved + 1] = "bank" end
				if entry.bags then saved[#saved + 1] = "bags" end
				local latest = math.max(entry.bank and entry.bank.time or 0, entry.bags and entry.bags.time or 0)
				local label = ns.ShortLabel(c.who)
				Line({ kind = "char", key = c.who, label = label, mine = c.mine, hidden = entry.hidden and true or false, shown = c.shown,
					text = "   " .. ClassHex(entry.class) .. label .. "|r  |cff909090" .. table.concat(bits, " ")
						.. (#saved > 0 and ("  " .. table.concat(saved, ", ")) or "  nothing saved")
						.. (c.mine and "  (playing now)" or (latest > 0 and ("  " .. SeenAgo(latest)) or ""))
						.. (entry.hidden and "  hidden" or "") .. "|r" })
			end
			for _, g in ipairs(block.guilds) do
				local name = (g.key:gsub(" %- .*$", ""))
				Line({ kind = "guild", key = g.key, label = name .. "'s guild bank", mine = false, hidden = g.record.hidden and true or false, shown = g.shown,
					text = "   Guild bank: " .. name .. "  |cff909090" .. (SeenAgo(g.record.time) or "")
						.. (g.record.hidden and "  hidden" or "") .. "|r" })
			end
		end
		for i = n + 1, #rows do rows[i]:Hide() end
		child:SetHeight(math.max(ROW_H, n * ROW_H))
		parent.csRoster.count = n
	end
	parent.csRoster.Redraw = Redraw
	widgets[#widgets + 1] = { refresh = Redraw }
end

local function BuildAboutPage(parent)
	local layout = NewLayout(parent)
	Header(layout, "About Bank Tabs")

	Note(layout, "Bank Tabs version " .. ns.version .. ". Until 2.0.0 it was called Casement, which also moved the world map; that part is now the separate addon Map Tab.", 0, 2)
	Note(layout, "Commands:", 0, 1)
	local lines = {
		"/banktabs opens these options",
		"/banktabs window opens them in a window of their own",
		"/banktabs bank, bags or guild open the saved bank, bags or guild bank, each a window of its own",
		"/banktabs snapshot saves what is open in front of you",
		"/banktabs gold lists every character's gold",
		"/banktabs characters hides or deletes saved characters",
		"/banktabs lock or unlock turns every window switch off or on",
		"/banktabs minimap shows or hides the minimap button",
		"/banktabs style auto, blizzard or dark picks the window style",
		"/banktabs reset puts every bag and bank window back",
		"/banktabs debug prints what resolved on this client",
	}
	for _, line in ipairs(lines) do Note(layout, "|cffffff00" .. line .. "|r", 12, 1) end
	Note(layout, "/btabs is the short form of all of these.", 0, 1)

	Note(layout, "If a window will not move, or a saved bank looks wrong, run /banktabs debug and send the output along with the report. Every part of this addon probes the client first and says in there what it found.", 0, 4)

	ButtonRow(layout, {
		{ label = "Print the debug report", width = 170, onClick = function()
			SlashCmdList["BANKTABS"]("debug")
		end },
		{ label = "Reset all settings", width = 140, onClick = function() ns.ResetToDefaults() end },
	})
end

local PAGES = {
	{ key = "windows", label = "Windows", build = BuildWindowsPage },
	{ key = "vault", label = "Bank snapshots", build = BuildVaultPage },
	{ key = "characters", label = "Characters", build = BuildCharactersPage },
	{ key = "look", label = "Look", build = BuildLookPage },
	{ key = "about", label = "About", build = BuildAboutPage },
}

local function ShowPage(block, key)
	for _, entry in ipairs(PAGES) do
		if block.csPages[entry.key] then block.csPages[entry.key]:SetShown(entry.key == key) end
		local button = block.csNav[entry.key]
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
-- A content block: one host's copy of every page
-- ------------------------------------------------------------------

local function BuildContent(name)
	local content = CreateFrame("Frame", name, UIParent)
	content:SetSize(CONTENT_W, CONTENT_H)
	content.csPages, content.csNav = {}, {}
	local pages, navButtons = content.csPages, content.csNav

	local title = content:CreateFontString(nil, "ARTWORK", "GameFontNormalLarge")
	title:SetPoint("TOPLEFT", 0, 0)
	title:SetText("Bank Tabs")

	local subtitle = content:CreateFontString(nil, "ARTWORK", "GameFontDisableSmall")
	subtitle:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -2)
	subtitle:SetText("Every character's bank, bags and guild bank from anywhere, and bag and bank windows you can move.")

	local nav = CreateFrame("Frame", nil, content)
	nav:SetPoint("TOPLEFT", 0, -44)
	nav:SetSize(NAV_W, CONTENT_H - 44)

	local navY = 0
	for _, entry in ipairs(PAGES) do
		local button = ns.Button(nav, entry.label, NAV_W - 8, 24, function() ShowPage(content, entry.key) end)
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

	ShowPage(content, "windows")
	-- Stays out of sight until its host (the window or the options page) asks for it.
	content:Hide()
	return content
end

-- The game's options page has its copy from the start; the window's is built when it first opens.
local function BuildPageContent()
	if not blocks.page then blocks.page = BuildContent("BankTabsOptions") end
	return blocks.page
end

-- The window's copy, if it has been built, for the window style to draw on.
function ns.OptionsWindowContent()
	return blocks.window
end

function ns.SyncOptions()
	if not next(blocks) or not ns.db then return end
	for _, widget in ipairs(widgets) do pcall(widget.refresh) end
end

local function HostContent(content, host, x, y, scale)
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
	window = ns.CreatePanel("BankTabsWindow")
	window:SetSize(CONTENT_W + 32, CONTENT_H + 52)
	window:SetPoint("CENTER")
	window:SetFrameStrata("HIGH")
	window:Hide()
	window.csTitle:SetText("Bank Tabs")

	window:SetScript("OnShow", function(self)
		if not blocks.window then
			blocks.window = BuildContent("BankTabsWindowOptions")
			if ns.SkinOptions then ns.SkinOptions(blocks.window) end
		end
		HostContent(blocks.window, self, 18, -36, 1)
		ns.SyncOptions()
	end)

	tinsert(UISpecialFrames, "BankTabsWindow")
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
	BuildPageContent()
	BuildWindow()

	if window:IsShown() then window:Hide() return end
	if PageIsOpen() then
		-- Closing the game's own panel from addon code is protected here, so the user closes it.
		return
	end

	if not forceWindow and ns.OpenBlizzardOptions() then return end
	window:Show()
end

-- Opens the options on one page: in the game's own options when that is where they are open, else
-- in Bank Tabs' own window, which opens from anywhere. `key` is a page key ("characters").
function ns.ShowOptionsPage(key)
	BuildPageContent()
	BuildWindow()
	if PageIsOpen() then
		ShowPage(blocks.page, key)
		return
	end
	if not window:IsShown() then window:Show() end
	if blocks.window then ShowPage(blocks.window, key) end
end

local function BuildOptionsCategory()
	if not (Settings and Settings.RegisterCanvasLayoutCategory and Settings.RegisterAddOnCategory) then
		report["options category"] = "Settings API missing, use /banktabs window"
		return
	end

	page = CreateFrame("Frame")
	page:Hide()
	page.name = "Bank Tabs"
	-- The canvas mixin looks for these; ours have nothing to do because every control writes its
	-- value straight into the saved variables when it is used.
	page.OnCommit = function() end
	page.OnDefault = function() ns.ResetToDefaults() end
	page.OnRefresh = function() ns.SyncOptions() end

	local function Fit()
		local w, h = page:GetWidth() or 0, page:GetHeight() or 0
		if w <= 0 or h <= 0 then return end
		local scale = math.min(1, (w - 24) / CONTENT_W, (h - 24) / CONTENT_H)
		HostContent(BuildPageContent(), page, 12, -12, scale)
	end

	page:SetScript("OnShow", function()
		if window and window:IsShown() then window:Hide() end
		Fit()
		ns.SyncOptions()
	end)
	page:SetScript("OnSizeChanged", function() if page:IsShown() then Fit() end end)

	local category = Settings.RegisterCanvasLayoutCategory(page, "Bank Tabs")
	Settings.RegisterAddOnCategory(category)
	ns.optionsCategory = category
	report["options category"] = "ok (canvas page)"
end

function ns.SetupOptions()
	BuildPageContent()
	BuildWindow()
	local ok, err = pcall(BuildOptionsCategory)
	if not ok then report["options category"] = "failed: " .. tostring(err) end
	ns.SyncOptions()
end

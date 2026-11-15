-- Bank Tabs
-- Bank Tabs' pieces in the window styles. Styles.lua does the choosing and the drawing (Blizzard,
-- Dark, or EllesmereUI's look, through its public skinning API); this file says what Bank Tabs has
-- to restyle: the saved bank, bags and guild bank with their slots and character tabs, and the
-- options window with its controls. With the Blizzard style nothing here draws anything.
--
-- The Bank, Bags and Guild tabs above the game's backpack and above EllesmereUI's own bag window
-- wear the style's tab look too (BagHeader.lua); without a style the backpack's keep the
-- spellbook's shape and EllesmereUI's get a flat look of Bank Tabs' own (ns.FlatTab). The game's
-- own windows are left alone, the backpack under those tabs included, and so are the drag strips,
-- the minimap button and the options page in Esc > Options > AddOns, whose contents keep the
-- game's look as every other addon's page does; the options window has a copy of its own
-- (Options.lua), and that copy is restyled.

local ADDON, ns = ...
local Styles = ns.Styles
local Try = Styles.Try

local function S() return Styles.S end

local function Fonts(...)
	for i = 1, select("#", ...) do
		local fs = select(i, ...)
		if type(fs) == "table" and fs.GetFont then S().Font(fs) end
	end
end

-- The close button sits on the style's title strip (EllesmereUI's is 25 pixels tall, Dark's 24)
-- and above any window border, which EllesmereUI lays over the whole window on a frame of its own
-- a few levels up. The title is centered on the same strip, where the portrait no longer pushes it
-- aside.
local function Chrome(frame)
	local close = frame.CloseButton or frame.csClose
	if type(close) == "table" then
		S().CloseButton(close)
		close:ClearAllPoints()
		close:SetPoint("CENTER", frame, "TOPRIGHT", -13, -12)
		ns.RaiseOver(close, frame, 1)
	end
	local title = frame.csTitle
	if type(title) == "table" and title.ClearAllPoints then
		Fonts(title)
		title:ClearAllPoints()
		title:SetPoint("CENTER", frame, "TOP", 0, -12)
	end
end

-- ---- pieces built later, as they are needed -----------------------------------------------

-- A slot, a Bag Slot or a side tab of a saved window: a dark square with the icon cropped square
-- and a 1 pixel edge, black for a common item or an empty slot. The quality glow gives way to a
-- square edge in the quality's color, and the blue outline of the tab being looked at uses the
-- same edge (the replica paints both through cell.ring).
function ns.SkinCell(cell)
	if not S() or cell.csStyled then return end
	cell.csStyled = true
	Try("saved slot", function()
		local backing = cell.backing
		if backing then
			backing:SetTexCoord(0, 1, 0, 1)
			backing:SetColorTexture(0, 0, 0, 0.45)
		end
		S().SquareIcon(cell.icon, cell)

		local ring = {}
		for i = 1, 4 do
			ring[i] = cell:CreateTexture(nil, "OVERLAY", nil, 7)
			ring[i]:Hide()
		end
		ring[1]:SetPoint("TOPLEFT") ring[1]:SetPoint("TOPRIGHT") ring[1]:SetHeight(1)
		ring[2]:SetPoint("BOTTOMLEFT") ring[2]:SetPoint("BOTTOMRIGHT") ring[2]:SetHeight(1)
		ring[3]:SetPoint("TOPLEFT") ring[3]:SetPoint("BOTTOMLEFT") ring[3]:SetWidth(1)
		ring[4]:SetPoint("TOPRIGHT") ring[4]:SetPoint("BOTTOMRIGHT") ring[4]:SetWidth(1)
		for _, bar in ipairs(cell.ring or {}) do bar:SetAlpha(0) end
		cell.ring = ring
		cell.borderIsGlow = nil
		if cell.border then cell.border:SetAlpha(0) end
		Fonts(cell.count)
	end)
end

-- Selected or not, in the style's tab look. EllesmereUI's older builds have no SetTabSelection;
-- there the tab's own isSelected field is read when the tab is drawn again.
local function Select(tab, on)
	if S().SetTabSelection then
		S().SetTabSelection(tab, on and true or false)
	else
		tab.isSelected = on and true or false
		S().Tab(tab)
	end
end

-- The icon fills the whole tab, its art cut to the tab's shape (wider than tall) rather than
-- stretched, under a 1 pixel edge drawn over its outermost pixels; the style's accent line along
-- the foot of the chosen tab lies over it. The tabs not chosen are a little dimmer and come up to
-- full brightness under the mouse, so the chosen one still reads at a glance.
local REST_ALPHA = 0.7

local function FillTab(tab)
	if tab.csFilled then return end
	tab.csFilled = true
	local icon = tab.icon
	icon:ClearAllPoints()
	icon:SetAllPoints(tab)
	icon.csAspect = ns.TAB.w / ns.TAB.rowStep
	local c = icon.csCoords or { 0, 1, 0, 1 }
	icon:SetTexCoord(c[1], c[2], c[3], c[4])
	tab.fillEdge = Styles.Outline(tab, tab, "OVERLAY", 0, 0, 0, 1, 0)
	tab.csRestAlpha = REST_ALPHA
	tab:HookScript("OnEnter", function(self) if not self.csDimmed then self.icon:SetAlpha(1) end end)
	tab:HookScript("OnLeave", function(self) self:SetChosen(self.csChosen) end)
end

-- A character or guild tab above a saved window, or a Bank, Bags or Guild tab above EllesmereUI's
-- own bag window or the game's backpack: the style's flat tab with its accent line under the
-- chosen one and the icon filling it (FillTab). It stands on the window's top edge rather than
-- tucked behind it (the line would be hidden), as tall as one row of tabs so a second row stands
-- clear of the first (ns.StandTab). Answers true once the tab wears the style's look, false while
-- no style is drawn; a flat tab of Bank Tabs' own (ns.FlatTab) gives way to it.
function ns.SkinCharTab(tab)
	if not S() then return false end
	if tab.csStyled then return true end
	tab.csStyled = true
	Try("tab", function()
		ns.StandTab(tab)
		for _, part in ipairs(tab.flatParts or {}) do part:SetAlpha(0) end
		S().Tab(tab)
		FillTab(tab)

		-- Dark's tab lightens under the mouse already; EllesmereUI's is given the same.
		if Styles.Applied() ~= "dark" then
			local hover = tab:CreateTexture(nil, "HIGHLIGHT")
			hover:SetAllPoints(tab)
			hover:SetColorTexture(1, 1, 1, 0.1)
		end

		local chosen = tab.SetChosen
		tab.SetChosen = function(self, on)
			chosen(self, on)
			Select(self, on)
		end
		Select(tab, tab.csChosen)
	end)
	return true
end

-- A saved window, once built (each is built the first time it opens).
function ns.SkinSavedWindow(W)
	if not S() or W.csStyled then return end
	W.csStyled = true
	local frame = W.frame
	Try("saved " .. tostring(W.kind) .. " window", function()
		-- Its character tabs stand on its edge, whatever else goes wrong here.
		frame.csTabLook = { tuck = 0, h = ns.TAB.rowStep }

		-- The rule over the Bag Slots and the reagent bag's divider are drawn on the window itself,
		-- where the style fades every texture (EllesmereUI each time it strips its windows again).
		-- They move to a frame of their own first, and the rule goes from gold to a light gray.
		local lines = CreateFrame("Frame", nil, frame)
		lines:SetAllPoints(frame)
		for _, line in ipairs({ W.bagRule, W.divider }) do
			if line and line.SetParent then line:SetParent(lines) end
		end
		if W.bagRule then W.bagRule:SetColorTexture(1, 1, 1, 0.16) end

		S().Shell(frame)
		-- The style's windows have no portrait. Its tooltip still answers on that corner.
		local container = frame.PortraitContainer
		if type(container) == "table" and container.SetAlpha then container:SetAlpha(0) end
		if frame.csPortrait and frame.csPortrait.SetAlpha then frame.csPortrait:SetAlpha(0) end
		if type(W.inset) == "table" then S().Inset(W.inset) end
		Chrome(frame)

		local box = W.searchBox
		if box then
			S().EditBox(box)
			-- The magnifying glass is the box's own art, which S.EditBox fades with the rest.
			if box.searchIcon and box.searchIcon.SetAlpha then box.searchIcon:SetAlpha(1) end
			Fonts(box.Instructions)
		end
		Fonts(W.bagLabel, W.moneyText, W.accountText, W.noteText)
	end)

	-- Anything this window built before the style was drawn.
	for _, list in ipairs({ W.cells, W.bagCells, W.tabButtons }) do
		for _, cell in ipairs(list or {}) do ns.SkinCell(cell) end
	end
	for _, tab in ipairs(W.charTabs or {}) do ns.SkinCharTab(tab) end
end

-- ---- the options ---------------------------------------------------------------------------

-- Every control and line of text in the options window's copy of the options. Button labels keep
-- the game's font, as EllesmereUI's own buttons do; the switches between choices keep their gold
-- and gray, which say which one is picked. The slider has no drawing call in either style and
-- keeps the game's art.
local function SkinControls(frame, depth)
	if depth > 8 then return end
	for _, region in ipairs({ frame:GetRegions() }) do
		if region.IsObjectType and region:IsObjectType("FontString") then Fonts(region) end
	end
	for _, child in ipairs({ frame:GetChildren() }) do
		local kind = child.GetObjectType and child:GetObjectType()
		if kind == "CheckButton" then
			Try("options switch", function()
				S().Checkbox(child)
				SkinControls(child, depth + 1)
			end)
		elseif kind == "Button" then
			Try("options button", function()
				S().Button(child)
				if child.csValue == nil then S().StateButtonLabel(child) end
			end)
		else
			SkinControls(child, depth + 1)
		end
	end
end

-- The options window's copy of the options, once built (the first time the window opens).
function ns.SkinOptions(content)
	if not S() or type(content) ~= "table" or content.csStyled then return end
	content.csStyled = true
	Try("options", function() SkinControls(content, 1) end)
end

-- Controls added to the options window's copy after it was dressed (the rows of the Characters page).
function ns.SkinOptionsPart(frame)
	if not S() or type(frame) ~= "table" then return end
	Try("options", function() SkinControls(frame, 1) end)
end

-- ---- everything that exists when a style is drawn -------------------------------------------

local function SkinAll()
	Try("options window", function()
		local window = BankTabsWindow
		if not window then return end
		S().Shell(window)
		Chrome(window)
	end)
	if ns.OptionsWindowContent then ns.SkinOptions(ns.OptionsWindowContent()) end

	-- Saved windows opened before the style was drawn, then a redraw so their tabs stand on the
	-- window's edge and their slots wear the square edges.
	local VaultUI = ns.VaultUI
	for _, W in pairs(VaultUI and VaultUI.windows or {}) do ns.SkinSavedWindow(W) end
	if VaultUI and VaultUI.Refresh then Try("redraw", VaultUI.Refresh) end

	-- The Bank, Bags and Guild tabs on the game's backpack and on EllesmereUI's bag window, if they
	-- were built before this: BagHeader puts them in the style's tab look and hangs them again.
	local BagHeader = ns.BagHeader
	if BagHeader and BagHeader.Apply then Try("backpack tabs", BagHeader.Apply) end
end

Styles.Setup({
	addon = ADDON,
	title = "Bank Tabs",
	db = function() return ns.db end,
	report = ns.report,
	accent = { 0.35, 0.72, 1 }, -- the blue the saved windows outline the tab being looked at in
	skin = SkinAll,
})

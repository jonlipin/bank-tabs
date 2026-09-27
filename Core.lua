-- Bank Tabs
-- Core: saved variables, defaults, the shared event frame and the slash commands.
--
-- Bank Tabs is the bag, bank and guild bank half of what was Casement until 2.0.0. The world map
-- tab, the coordinates and the fog reveal went to a separate addon, Map Tab. Import.lua carries
-- Casement's saved data over.
--
-- Client notes that shape this file:
--  * The Forever beta client has been seen to hand back a nil SavedVariables table on a fresh
--    login even when a valid file is on disk, so every character's settings are mirrored into an
--    account wide copy and adopted late at PLAYER_LOGIN.
--  * Anything that might not exist on this client is probed once and recorded in `report`, which
--    "/banktabs debug" prints. Nothing in this addon should ever hard error.
--  * Nothing here registers COMBAT_LOG_EVENT_UNFILTERED, loads a Blizzard_ addon or creates
--    Settings proxy objects. All three taint this client.

local ADDON, ns = ...

ns.version = "2.0.0"
ns.report = {}

local report = ns.report

local function Print(msg)
	DEFAULT_CHAT_FRAME:AddMessage("|cff8fd3ffBank Tabs|r " .. tostring(msg))
end
ns.Print = Print

-- ------------------------------------------------------------------
-- Defaults
-- ------------------------------------------------------------------

ns.defaults = {
	enabled = true,

	-- One switch per window family. Turning one off puts that window back under the game's own
	-- control and forgets where the addon had been putting it.
	windows = {
		combined = true,
		bags = true,
		reagent = true,
		bank = true,
		guildbank = true,
	},

	-- Hold this key and drag anywhere on a managed window to move it. "none" turns it off and
	-- leaves only the title strip working.
	dragModifier = "alt",

	-- Draw a faint outline over the strip of each window that can be dragged.
	showGrips = false,

	-- A button on the minimap rim. `angle` is degrees around it, kept when the user drags it.
	minimap = {
		shown = true,
		angle = 205,
	},

	vault = {
		autoBank = true,
		autoGuild = true,
		bagButtons = true,
		showAccountGold = true, -- the account's gold, small, in the replica's bottom left corner
		moneyTooltip = true,    -- hovering the money on a bag or bank window lists every character's gold
	},

	-- Lines on item tooltips: which characters have the item and where, from the snapshots.
	tooltips = {
		enabled = true,
		guild = true,
		total = true,
		modifier = "none", -- or shift, ctrl, alt: only add the lines while that key is held
	},

	-- Where each window was left, in UIParent units, keyed by window or by bag id.
	positions = {},
}

-- ------------------------------------------------------------------
-- Table helpers
-- ------------------------------------------------------------------

local function DeepCopy(src)
	local out = {}
	for k, v in pairs(src) do
		if type(v) == "table" then out[k] = DeepCopy(v) else out[k] = v end
	end
	return out
end
ns.DeepCopy = DeepCopy

-- Fills in anything the saved table is missing without touching what the user set.
local function FillDefaults(dst, src)
	for k, v in pairs(src) do
		if type(v) == "table" then
			if type(dst[k]) ~= "table" then dst[k] = {} end
			FillDefaults(dst[k], v)
		elseif dst[k] == nil then
			dst[k] = v
		end
	end
	return dst
end

local function CountKeys(t)
	local n = 0
	if type(t) == "table" then for _ in pairs(t) do n = n + 1 end end
	return n
end
ns.CountKeys = CountKeys

function ns.Round(value, places)
	local mult = 10 ^ (places or 0)
	return math.floor(value * mult + 0.5) / mult
end

function ns.Clamp(value, low, high)
	if value < low then return low end
	if value > high then return high end
	return value
end

-- A later timer than C_Timer on a client that somehow lacks it: the shared event frame runs the
-- queue in OnUpdate instead, so nothing in the addon has to care which one it got.
local pending = {}
function ns.After(delay, fn)
	if C_Timer and C_Timer.After then
		C_Timer.After(delay, function() pcall(fn) end)
		return
	end
	pending[#pending + 1] = { at = GetTime() + delay, fn = fn }
end

-- The name and realm as the client gives them right now.
function ns.NameKey()
	local name = UnitName and UnitName("player") or "player"
	local realm = GetRealmName and GetRealmName() or ""
	if realm ~= "" then return name .. " - " .. realm end
	return name
end

-- The key a character is stored under. The GUID never changes, whereas the name this client hands
-- back has been seen to vary ("Vatik" one login, "Vatik Voidpact" another), which split one
-- character's snapshots across two entries. Older entries keyed by name are folded in by the
-- vault the next time that character takes a snapshot.
function ns.Who()
	if UnitGUID then
		local ok, guid = pcall(UnitGUID, "player")
		if ok and type(guid) == "string" and guid ~= "" then return guid end
	end
	return ns.NameKey()
end

-- What to call a stored character: the name and realm saved with the entry, or the key itself
-- for an entry saved by name before Casement 1.2.1.
function ns.Label(who)
	local entry = ns.vault and ns.vault.chars and ns.vault.chars[who]
	if type(entry) == "table" and type(entry.name) == "string" then
		local realm = entry.realm
		return entry.name .. ((realm and realm ~= "") and (" - " .. realm) or "")
	end
	if who == ns.Who() then return ns.NameKey() end
	return tostring(who)
end

-- The character's name alone, no realm: what the character tabs' tooltips and the saved windows'
-- titles say. This character is named live when nothing has been saved for it yet, rather than by
-- its GUID.
function ns.ShortLabel(who)
	local entry = ns.vault and ns.vault.chars and ns.vault.chars[who]
	if type(entry) == "table" and type(entry.name) == "string" then return entry.name end
	if who == ns.Who() and UnitName then
		local ok, name = pcall(UnitName, "player")
		if ok and type(name) == "string" and name ~= "" then return name end
	end
	return (tostring(who):gsub(" %- .*$", ""))
end

-- ------------------------------------------------------------------
-- Saved variables
-- ------------------------------------------------------------------

local function MirrorToAccount()
	if not ns.db then return end
	BankTabsAccountDB = BankTabsAccountDB or {}
	BankTabsAccountDB.profile = DeepCopy(ns.db)
	BankTabsAccountDB.version = ns.version
end
ns.MirrorToAccount = MirrorToAccount

-- The client sometimes starts a session with a blank per character table even though the file on
-- disk is fine. When the character table looks untouched we adopt the account mirror.
local function LoadDB(phase)
	local fresh = CountKeys(BankTabsDB) == 0
	if fresh and type(BankTabsAccountDB) == "table" and type(BankTabsAccountDB.profile) == "table" then
		BankTabsDB = DeepCopy(BankTabsAccountDB.profile)
		-- Positions belong to the character that set them, not to whoever logged in first, and so
		-- does having had this character's old Casement settings brought over.
		BankTabsDB.positions = {}
		BankTabsDB.importedCasement = nil
		report["db " .. phase] = "adopted the account copy"
	else
		BankTabsDB = type(BankTabsDB) == "table" and BankTabsDB or {}
		report["db " .. phase] = fresh and "fresh (first run)" or "loaded from this character"
	end
	FillDefaults(BankTabsDB, ns.defaults)
	ns.db = BankTabsDB
	-- A table made this session holds nothing the user chose here yet, which the Casement import
	-- needs to know.
	ns.dbFresh = fresh

	BankTabsAccountDB = type(BankTabsAccountDB) == "table" and BankTabsAccountDB or {}
	BankTabsAccountDB.vault = type(BankTabsAccountDB.vault) == "table" and BankTabsAccountDB.vault or {}
	BankTabsAccountDB.vault.chars = BankTabsAccountDB.vault.chars or {}
	BankTabsAccountDB.vault.guilds = BankTabsAccountDB.vault.guilds or {}
	ns.vault = BankTabsAccountDB.vault

	MirrorToAccount()
end

function ns.ResetToDefaults()
	local vault = ns.vault
	local imported = ns.db and ns.db.importedCasement
	BankTabsDB = DeepCopy(ns.defaults)
	-- The Casement import has been done for this character whatever the settings are now.
	BankTabsDB.importedCasement = imported
	ns.db = BankTabsDB
	ns.vault = vault
	MirrorToAccount()
	if ns.Windows and ns.Windows.ResetAll then pcall(ns.Windows.ResetAll) end
	ns.Refresh()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
	Print("Settings reset to defaults. Saved banks and bags were kept.")
end

-- ------------------------------------------------------------------
-- Refresh fan out. Every setter in the options calls this.
-- ------------------------------------------------------------------

function ns.Refresh()
	MirrorToAccount()
	if ns.Windows and ns.Windows.Apply then pcall(ns.Windows.Apply) end
	if ns.Minimap and ns.Minimap.Apply then pcall(ns.Minimap.Apply) end
	if ns.BagHeader and ns.BagHeader.Apply then pcall(ns.BagHeader.Apply) end
end

-- Every character's gold and the total, as a tooltip on `owner`. Shown from the money on the
-- game's own bag and bank windows, from the replica's money, and from the minimap button.
function ns.GoldTooltip(owner)
	if not (ns.Vault and ns.Vault.Gold and GameTooltip) then return false end
	local rows, total = ns.Vault.Gold()
	GameTooltip:SetOwner(owner, "ANCHOR_RIGHT")
	GameTooltip:SetText("Gold across the account", 1, 1, 1)
	for _, row in ipairs(rows) do
		local entry = ns.Vault.CharRecord and ns.Vault.CharRecord(row.who)
		local colors = _G.RAID_CLASS_COLORS
		local color = entry and entry.class and colors and colors[entry.class]
		local r, g, b = 1, 0.82, 0
		if color and color.r then r, g, b = color.r, color.g, color.b end
		GameTooltip:AddDoubleLine(ns.ShortLabel(row.who) .. (row.mine and " (now)" or ""), ns.Money(row.money), r, g, b, 1, 1, 1)
	end
	if #rows > 1 then GameTooltip:AddDoubleLine("Total", ns.Money(total), 1, 0.82, 0, 1, 1, 1) end
	GameTooltip:Show()
	return true
end

-- Puts the gold tooltip on a window's money frame (the game's own coin readout). The frame and
-- the coin buttons inside it are hooked, since whichever is under the mouse takes the hover.
local moneyHooked = {}
function ns.HookMoneyFrame(frame, label)
	if not frame then return false end
	local money = frame.MoneyFrame
	if not money and frame.GetName then
		local name = frame:GetName()
		if name then money = _G[name .. "MoneyFrame"] end
	end
	if not money or moneyHooked[money] then return money ~= nil end
	moneyHooked[money] = true

	local function hook(region)
		if not (region and region.HookScript) then return end
		pcall(region.EnableMouse, region, true)
		pcall(region.HookScript, region, "OnEnter", function(self)
			if ns.db and ns.db.vault.moneyTooltip then ns.GoldTooltip(self) end
		end)
		pcall(region.HookScript, region, "OnLeave", function() GameTooltip:Hide() end)
	end
	hook(money)
	ns.WalkChildren(money, hook, 2, 30)
	report["money tooltip " .. tostring(label or "window")] = "hooked"
	return true
end

-- ------------------------------------------------------------------
-- Shared window art
--
-- Blizzard's FrameXML is not on disk on this client, so a template can only be tested by trying
-- it. Each candidate is created inside a pcall and checked for the parts it should have brought
-- with it, and whichever one worked is named in the debug report.
-- ------------------------------------------------------------------

local PANEL_TEMPLATES = {
	{ "DefaultPanelFlatTemplate", function(f) return f.NineSlice ~= nil end },
	{ "DefaultPanelTemplate", function(f) return f.NineSlice ~= nil end },
	{ "ButtonFrameTemplate", function(f) return f.NineSlice ~= nil or f.Inset ~= nil end },
	{ "BasicFrameTemplate" },
}

-- A frame wearing the game's own panel art: the border and the background, nothing else. Used for
-- the options window and as the fallback for the saved bank's portrait window.
function ns.CreatePanelFrame(name, parent, key)
	local panel, used
	for _, candidate in ipairs(PANEL_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Frame", name, parent or UIParent, candidate[1])
		if ok and made and (not candidate[2] or candidate[2](made)) then
			panel, used = made, candidate[1]
			break
		end
		if ok and made then made:Hide() end
	end
	if not panel then
		local ok, made = pcall(CreateFrame, "Frame", name, parent or UIParent, "BackdropTemplate")
		panel = (ok and made) or CreateFrame("Frame", name, parent or UIParent)
		used = "backdrop"
		if panel.SetBackdrop then
			panel:SetBackdrop({
				bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
				edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
				tile = true, tileSize = 16, edgeSize = 14,
				insets = { left = 3, right = 3, top = 3, bottom = 3 },
			})
			panel:SetBackdropColor(0.05, 0.05, 0.05, 0.94)
		else
			-- Nothing at all resolved, so the panel is painted by hand rather than left invisible.
			local backing = panel:CreateTexture(nil, "BACKGROUND")
			backing:SetAllPoints()
			backing:SetColorTexture(0.05, 0.05, 0.06, 0.94)
			for _, edge in ipairs({ { "TOPLEFT", "TOPRIGHT", 0, 1 }, { "BOTTOMLEFT", "BOTTOMRIGHT", 0, 1 },
				{ "TOPLEFT", "BOTTOMLEFT", 1, 0 }, { "TOPRIGHT", "BOTTOMRIGHT", 1, 0 } }) do
				local line = panel:CreateTexture(nil, "BORDER")
				line:SetColorTexture(0.75, 0.62, 0.32, 0.9)
				line:SetPoint(edge[1])
				line:SetPoint(edge[2])
				if edge[3] == 1 then line:SetWidth(1) else line:SetHeight(1) end
			end
		end
	end
	report[(key or "window") .. " panel"] = used

	if used == "ButtonFrameTemplate" then
		if ButtonFrameTemplate_HidePortrait then pcall(ButtonFrameTemplate_HidePortrait, panel) end
		if ButtonFrameTemplate_HideButtonBar then pcall(ButtonFrameTemplate_HideButtonBar, panel) end
		if panel.Inset then panel.Inset:Hide() end
	end
	panel.csTemplate = used
	return panel
end

-- A window with a portrait in its top left corner, the shape the bank and the bag windows have.
-- The portrait is kept rather than hidden, and the Inset (the dark plate the bank draws its slots
-- on) is kept too. Falls back to the plain window art where neither template resolves.
function ns.CreatePortraitPanel(name, key)
	local panel, used
	for _, candidate in ipairs({ "ButtonFrameTemplate", "PortraitFrameTemplate" }) do
		local ok, made = pcall(CreateFrame, "Frame", name, UIParent, candidate)
		if ok and made and (made.NineSlice or made.Inset or made.PortraitContainer or made.portrait) then
			panel, used = made, candidate
			break
		end
		if ok and made then made:Hide() end
	end
	if not panel then
		panel = ns.CreatePanelFrame(name, UIParent, key or "portrait window")
		used = panel.csTemplate
	end
	report[(key or "portrait window") .. " panel"] = used

	if used == "ButtonFrameTemplate" and ButtonFrameTemplate_HideButtonBar then
		pcall(ButtonFrameTemplate_HideButtonBar, panel)
	end

	local title = panel.TitleText or (panel.TitleContainer and panel.TitleContainer.TitleText)
	if not title then
		title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		title:SetPoint("TOP", 0, -6)
	end
	panel.csTitle = title
	panel.csTemplate = used

	-- The portrait texture, wherever this template keeps it.
	panel.csPortrait = (panel.PortraitContainer and panel.PortraitContainer.portrait) or panel.portrait
		or (panel.GetName and _G[(panel:GetName() or "") .. "Portrait"]) or nil

	if not panel.CloseButton then
		local ok, button = pcall(CreateFrame, "Button", nil, panel, "UIPanelCloseButton")
		if ok and button then button:SetPoint("TOPRIGHT", 1, 1) end
	end

	panel:SetMovable(true)
	panel:SetClampedToScreen(true)
	panel:EnableMouse(true)
	panel:RegisterForDrag("LeftButton")
	panel:SetScript("OnDragStart", panel.StartMoving)
	panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
	return panel
end

-- Paints the player's face into a portrait texture, by whichever route this client offers.
function ns.SetPlayerPortrait(texture)
	if not texture then return false end
	if SetPortraitTexture then
		if pcall(SetPortraitTexture, texture, "player") then return true end
	end
	if SetPortraitToUnit then
		if pcall(SetPortraitToUnit, texture, "player") then return true end
	end
	return false
end

function ns.CreatePanel(name)
	local panel = ns.CreatePanelFrame(name, UIParent, "window")
	local used = panel.csTemplate

	if used == "ButtonFrameTemplate" then
		if ButtonFrameTemplate_HidePortrait then pcall(ButtonFrameTemplate_HidePortrait, panel) end
		if ButtonFrameTemplate_HideButtonBar then pcall(ButtonFrameTemplate_HideButtonBar, panel) end
		if panel.Inset then panel.Inset:Hide() end
	end

	local title = panel.TitleText or (panel.TitleContainer and panel.TitleContainer.TitleText)
	if not title then
		title = panel:CreateFontString(nil, "OVERLAY", "GameFontNormal")
		title:SetPoint("TOP", 0, -6)
	end
	panel.csTitle = title

	if not panel.CloseButton then
		local ok, button = pcall(CreateFrame, "Button", nil, panel, "UIPanelCloseButton")
		if ok and button then button:SetPoint("TOPRIGHT", 1, 1) end
	end

	panel:SetMovable(true)
	panel:SetClampedToScreen(true)
	panel:EnableMouse(true)
	panel:RegisterForDrag("LeftButton")
	panel:SetScript("OnDragStart", panel.StartMoving)
	panel:SetScript("OnDragStop", panel.StopMovingOrSizing)
	return panel
end

-- ------------------------------------------------------------------
-- Getting on top of a Blizzard window
--
-- A grip laid over one of the game's windows has to win the mouse against everything that window
-- draws inside itself. With a window's own panels sitting above a grip that is merely a few
-- levels above the window, the grip is visible but unclickable. This walks the window, finds the
-- highest strata and level anything inside it uses, and puts our region above all of it.
--
-- Our own frames are marked so that repeated calls do not climb a level higher every time.
-- ------------------------------------------------------------------

local STRATA = { "BACKGROUND", "LOW", "MEDIUM", "HIGH", "DIALOG", "FULLSCREEN", "FULLSCREEN_DIALOG", "TOOLTIP" }
local STRATA_INDEX = {}
for index, name in ipairs(STRATA) do STRATA_INDEX[name] = index end

local function Children(frame)
	local ok, list = pcall(function() return { frame:GetChildren() } end)
	if ok and type(list) == "table" then return list end
	return {}
end
ns.Children = Children

-- Walks a window and calls `visit(child)` on everything inside it that is not one of ours.
function ns.WalkChildren(host, visit, maxDepth, budget)
	local seen = 0
	local limit = budget or 400
	local function walk(frame, depth)
		if depth > (maxDepth or 4) or seen > limit then return end
		for _, child in ipairs(Children(frame)) do
			seen = seen + 1
			if seen > limit then return end
			if not child.csOurs then
				visit(child)
				walk(child, depth + 1)
			end
		end
	end
	pcall(walk, host, 1)
	return seen
end

function ns.RaiseOver(region, host, extra)
	region.csOurs = true
	local hostStrata, bestLevel = 3, 1
	local okStrata, strata = pcall(host.GetFrameStrata, host)
	if okStrata and STRATA_INDEX[strata or ""] then hostStrata = STRATA_INDEX[strata] end
	local okLevel, level = pcall(host.GetFrameLevel, host)
	if okLevel and type(level) == "number" then bestLevel = level end
	local bestStrata = hostStrata

	ns.WalkChildren(host, function(child)
		local gotStrata, childStrata = pcall(child.GetFrameStrata, child)
		local gotLevel, childLevel = pcall(child.GetFrameLevel, child)
		-- A child whose strata cannot be read is in the same strata as the window holding it,
		-- which is what inheriting one means. Treating it as unknown would throw away its frame
		-- level and leave us underneath it.
		local s = (gotStrata and STRATA_INDEX[childStrata or ""]) or hostStrata
		local l = (gotLevel and type(childLevel) == "number") and childLevel or 0
		if s > bestStrata then
			bestStrata, bestLevel = s, l
		elseif s == bestStrata and l > bestLevel then
			bestLevel = l
		end
	end)

	local wanted = STRATA[math.min(bestStrata, #STRATA)]
	local wantedLevel = math.min(bestLevel + (extra or 3), 9999)
	pcall(region.SetFrameStrata, region, wanted)
	pcall(region.SetFrameLevel, region, wantedLevel)
	return wanted .. " " .. wantedLevel
end

function ns.TextureExists(path)
	if not GetFileIDFromPath then return true end
	local ok, id = pcall(GetFileIDFromPath, path)
	return ok and id ~= nil
end

-- SetAtlas does not raise for a name the client lacks, so the atlas table is asked instead.
function ns.HasAtlas(atlas)
	if not (C_Texture and C_Texture.GetAtlasInfo) then return false end
	local ok, info = pcall(C_Texture.GetAtlasInfo, atlas)
	return ok and info ~= nil
end

-- ------------------------------------------------------------------
-- Tabs in the spellbook's style
--
-- Every tab this addon hangs off a window comes from here: the character tabs above the saved
-- bank and bags, and the Bank, Bags and Guild tabs above the real backpack. One builder and one
-- placer, so the two kinds cannot drift apart: the spellbook's 43 by 37, the game's own spellbook
-- tab atlas with its chosen and glowing states, the icon clipped to the tab's shape, and a plain
-- bevel where a client does not carry the atlas.
-- ------------------------------------------------------------------

-- w, h: the tab. gap: between two tabs. start: how far in from the window's left edge the row
-- starts, clear of the portrait. right: what a row leaves free at the window's right hand end,
-- for the corner and its close button. tuck: how much of the tab's foot hides behind the window's
-- border. rowStep: how far a second row sits above the first.
-- icon, iconTop: the icon's size and how far down it starts (the dark plate behind it matches).
-- iconTop is 4 because the frame art's top border sits about 3.7 pixels down: from 2, the icon and
-- its plate showed as a dark strip above the frame (the user's screenshot). The icon's lower edge
-- runs under the window's border, where the tab's foot is tucked.
ns.TAB = { w = 43, h = 37, gap = 2, start = 64, right = 20, tuck = 8, rowStep = 31, icon = 36, iconTop = 4 }

-- How many tabs fit in one row along the top of `host`. The rest wrap into a row above rather
-- than march past the right hand edge, where they would hang off the window (and off the screen,
-- for a window pushed into a corner). Both kinds of tab wrap by this one rule.
function ns.TabsPerRow(host)
	local T = ns.TAB
	local width = host and host.GetWidth and host:GetWidth() or 0
	if type(width) ~= "number" or width <= 0 then width = 380 end
	return math.max(1, math.floor((width - T.start - T.right) / (T.w + T.gap)))
end

-- How far the top of the highest of `rows` rows of tabs stands above the window's top edge.
function ns.TabRowsHeight(rows)
	local T = ns.TAB
	if not rows or rows <= 0 then return 0 end
	return (rows - 1) * T.rowStep + T.h - T.tuck
end

local TAB_ART = {
	tab = "spellbook-Tab-Frame-C60",
	tabActive = "spellbook-Tab-Frame-Glow-C60",
	tabActiveGlow = "spellbook-Tab-Frame-glow-gradient-C60",
}
local tabArt = nil -- false once probed and missing

local function TabArt()
	if tabArt ~= nil then return tabArt or nil end
	tabArt = false
	if ns.HasAtlas(TAB_ART.tab) then
		tabArt = { tab = TAB_ART.tab }
		if ns.HasAtlas(TAB_ART.tabActive) then tabArt.tabActive = TAB_ART.tabActive end
		if ns.HasAtlas(TAB_ART.tabActiveGlow) then tabArt.tabActiveGlow = TAB_ART.tabActiveGlow end
		report["tab art"] = "spellbook atlas"
	else
		report["tab art"] = "plain bevel (no spellbook atlas on this client)"
	end
	return tabArt or nil
end

-- Clips a tab's icon (and the dark plate under it) to the tab window's shape, rounded along the
-- top and flat along the bottom, which is what this mask atlas cuts. Without it the square icon
-- shows through the frame's open corners. The atlas's region is larger than its shape, so the
-- mask is drawn about a quarter larger than the texture it clips.
local TAB_MASK = "UI-HUD-ActionBar-IconFrame-Mask"
local MASK_OVER = 0.26

local function MaskTabTexture(tab, texture, size)
	if not (tab.CreateMaskTexture and ns.HasAtlas(TAB_MASK)) then return false end
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

-- Hangs a tab off the top edge of `host`, in column `col` of row `row` (a second row sits above
-- the first): clear of the portrait, its feet tucked behind the window's border, and one level
-- under the window so that border covers them.
function ns.HangTab(tab, host, col, row)
	local T = ns.TAB
	tab:ClearAllPoints()
	tab:SetPoint("BOTTOMLEFT", host, "TOPLEFT", T.start + (col or 0) * (T.w + T.gap), -T.tuck + (row or 0) * T.rowStep)
	tab:SetFrameLevel(math.max(0, (host:GetFrameLevel() or 1) - 1))
end

-- A tab on `host`, with an `icon` texture for the caller to paint and the scripts left to the
-- caller. tab:SetChosen(on) wears the chosen state (the glowing frame); tab:SetDimmed(on) greys the
-- icon for a tab with nothing behind it.
function ns.CreateTab(host)
	local T = ns.TAB
	local tab = CreateFrame("CheckButton", nil, host)
	tab.csOurs = true
	tab.csTab = true
	tab:SetSize(T.w, T.h)
	tab:SetFrameLevel(math.max(0, (host:GetFrameLevel() or 1) - 1))

	-- The icon is 36 pixels square from 2 down, so its edges run under the frame art's border and
	-- no gap is left inside the frame's window. The dark plate behind it has exactly the icon's
	-- size, place and mask, so it only shows through an icon with see-through parts and never past
	-- the frame. (Inset 4 across and 3 down, as the spellbook's own numbers have it, the plate and
	-- icon stopped short of the frame's window; 1 pixel in, the plate stuck out past the frame art,
	-- which sits about 2.5 pixels inside the tab's box. The user saw both on the backpack's tabs.)
	local back = tab:CreateTexture(nil, "BACKGROUND")
	back:SetPoint("TOP", 0, -T.iconTop)
	back:SetSize(T.icon, T.icon)
	back:SetColorTexture(0.02, 0.02, 0.02, 1)
	tab.plate = back

	local icon = tab:CreateTexture(nil, "ARTWORK")
	icon:SetPoint("TOP", 0, -T.iconTop)
	icon:SetSize(T.icon, T.icon)
	tab.icon = icon

	local masked = MaskTabTexture(tab, icon, T.icon)
	MaskTabTexture(tab, back, T.icon)
	report["tab mask"] = masked and TAB_MASK or "none (the icon keeps its corners)"

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
			sel:Hide()
			tab.sel = sel
		end
	end

	local hover = tab:CreateTexture(nil, "HIGHLIGHT")
	hover:SetAllPoints(icon)
	hover:SetColorTexture(1, 1, 1, 0.15)

	tab.SetChosen = function(self, on)
		on = on and true or false
		self.csChosen = on
		local artNow = TabArt()
		if self.frameTex and artNow then
			pcall(self.frameTex.SetAtlas, self.frameTex, (on and artNow.tabActive) or artNow.tab)
		end
		if self.glow then self.glow:SetShown(on) end
		if self.sel then self.sel:SetShown(on) end
		if self.bevel then self.bevel:SetShown(not on) end
		self.icon:SetAlpha((self.csDimmed and 0.4) or (on and 1) or 0.85)
	end
	tab.SetDimmed = function(self, on)
		self.csDimmed = on and true or false
		self:SetChosen(self.csChosen)
	end
	tab:SetChosen(false)
	return tab
end

function ns.Tooltip(widget, title, body)
	if not title and not body then return end
	widget:SetScript("OnEnter", function(self)
		GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
		GameTooltip:SetText(title or "", 1, 1, 1)
		if body then GameTooltip:AddLine(body, nil, nil, nil, true) end
		GameTooltip:Show()
	end)
	widget:SetScript("OnLeave", function() GameTooltip:Hide() end)
end

-- A plain button that falls back to art of its own where the template is missing.
function ns.Button(parent, text, width, height, onClick)
	local button
	local ok, made = pcall(CreateFrame, "Button", nil, parent, "UIPanelButtonTemplate")
	if ok and made then button = made else button = CreateFrame("Button", nil, parent) end
	if not button.GetFontString or not button:GetFontString() then
		local backing = button:CreateTexture(nil, "BACKGROUND")
		backing:SetAllPoints()
		backing:SetColorTexture(0.18, 0.18, 0.2, 0.9)
		local fs = button:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
		fs:SetAllPoints()
		button:SetFontString(fs)
	end
	button:SetSize(width, height or 22)
	button:SetText(text)
	if onClick then button:SetScript("OnClick", onClick) end
	return button
end

function ns.Money(amount)
	if type(amount) ~= "number" then return "" end
	-- The modern stack keeps this under C_CurrencyInfo; older builds have the global.
	local modern = C_CurrencyInfo and C_CurrencyInfo.GetCoinTextureString
	if modern then
		local ok, text = pcall(modern, amount)
		if ok and text then return text end
	end
	if GetCoinTextureString then
		local ok, text = pcall(GetCoinTextureString, amount)
		if ok and text then return text end
	end
	local gold = math.floor(amount / 10000)
	local silver = math.floor((amount % 10000) / 100)
	local copper = amount % 100
	return gold .. "g " .. silver .. "s " .. copper .. "c"
end

-- ------------------------------------------------------------------
-- Event frame
-- ------------------------------------------------------------------

local frame = CreateFrame("Frame", "BankTabsFrame", UIParent)
ns.frame = frame

local EVENTS = {
	"ADDON_LOADED",
	"PLAYER_LOGIN",
	"PLAYER_LOGOUT",
	"UI_SCALE_CHANGED",
	"DISPLAY_SIZE_CHANGED",
	"MODIFIER_STATE_CHANGED",
	"BANKFRAME_OPENED",
	"BANKFRAME_CLOSED",
	"PLAYERBANKSLOTS_CHANGED",
	"PLAYERBANKBAGSLOTS_CHANGED",
	"PLAYERREAGENTBANKSLOTS_CHANGED",
	"BAG_UPDATE_DELAYED",
	"PLAYER_MONEY",
	"GUILDBANKFRAME_OPENED",
	"GUILDBANKFRAME_CLOSED",
	"GUILDBANKBAGSLOTS_CHANGED",
	"BAG_OPEN",
	"BAG_CLOSED",
}

-- Some of these do not exist on every build. RegisterEvent on an unknown event errors, so each
-- one goes through pcall and the tally lands in the debug report.
local registered, skipped = 0, {}
for _, event in ipairs(EVENTS) do
	if pcall(frame.RegisterEvent, frame, event) then
		registered = registered + 1
	else
		skipped[#skipped + 1] = event
	end
end
report["events"] = registered .. "/" .. #EVENTS .. " registered"
	.. (#skipped > 0 and (" (missing: " .. table.concat(skipped, ", ") .. ")") or "")

frame:SetScript("OnUpdate", function()
	if #pending == 0 then return end
	local now = GetTime()
	for i = #pending, 1, -1 do
		if pending[i].at <= now then
			local fn = pending[i].fn
			table.remove(pending, i)
			pcall(fn)
		end
	end
end)

local function Init()
	LoadDB("addon loaded")

	-- An old, whole Casement that may still run loads after this addon (the game goes in name
	-- order) and moves these same windows. Until PLAYER_LOGIN shows whether it did, the window
	-- engine takes nothing over: once it has taken a window (the bank out of the game's panel
	-- stack, say), letting go again cannot put back what the old addon would have left there.
	-- Nothing is on screen before login, so a clean install loses nothing by the wait either.
	if ns.Import and ns.Import.OldAddonMayRun then
		local ok, may = pcall(ns.Import.OldAddonMayRun)
		ns.holdWindows = (ok and may) or nil
	end

	if ns.Windows and ns.Windows.Init then
		local ok, err = pcall(ns.Windows.Init)
		report["windows"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Vault and ns.Vault.Init then
		local ok, err = pcall(ns.Vault.Init)
		report["vault"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.BagHeader and ns.BagHeader.Init then
		local ok, err = pcall(ns.BagHeader.Init)
		report["bag header"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Minimap and ns.Minimap.Init then
		local ok, err = pcall(ns.Minimap.Init)
		report["minimap"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Tooltips and ns.Tooltips.Init then
		local ok, err = pcall(ns.Tooltips.Init)
		report["tooltips"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.SetupOptions then
		local ok, err = pcall(ns.SetupOptions)
		report["options"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	ns.Refresh()
end

frame:SetScript("OnEvent", function(self, event, ...)
	if event == "ADDON_LOADED" then
		local name = ...
		if name == ADDON then
			Init()
		elseif ns.Windows and ns.Windows.Sweep then
			-- Blizzard_GuildBankUI and the other load on demand panels only exist once the game
			-- has needed them, so every addon that loads gets a second look for new windows.
			pcall(ns.Windows.Sweep, "addon " .. tostring(name))
		end
		return

	elseif event == "PLAYER_LOGIN" then
		-- Second chance at the saved table, see the note above LoadDB.
		if CountKeys(BankTabsDB) == 0 then LoadDB("player login") end
		-- Every addon has loaded by now, so an old Casement that is still running can be seen,
		-- and what it saved can be read before anything is placed this session.
		if ns.Import and ns.Import.Run then
			local ok, err = pcall(ns.Import.Run)
			if not ok then report["casement import"] = "failed: " .. tostring(err) end
		end
		-- Whether the old Casement is running is known now (ns.oldCasementRunning), so the window
		-- engine can go ahead or stand aside.
		ns.holdWindows = nil
		-- /casement and /cst, kept unadvertised for anyone with them in a macro from before 2.0.0,
		-- are only taken while the old Casement is not running: it answers to the same two, and
		-- the game's pick between two handlers of one command is arbitrary. The chat box reads
		-- these names when a command is typed, so setting them now is in time.
		SLASH_BANKTABS3 = (not ns.oldCasementRunning) and "/casement" or nil
		SLASH_BANKTABS4 = (not ns.oldCasementRunning) and "/cst" or nil
		ns.Refresh()
		if ns.Windows and ns.Windows.Sweep then pcall(ns.Windows.Sweep, "login") end
		if ns.SyncOptions then pcall(ns.SyncOptions) end

	elseif event == "PLAYER_LOGOUT" then
		if ns.Vault and ns.Vault.OnEvent then pcall(ns.Vault.OnEvent, event) end
		-- What the user changed in an old Casement that ran this session (see Import.Follow).
		if ns.Import and ns.Import.followFrom then
			local ok, err = pcall(ns.Import.Follow)
			if not ok then report["casement import"] = "failed at logout: " .. tostring(err) end
		end
		MirrorToAccount()
		return
	end

	if ns.Windows and ns.Windows.OnEvent then pcall(ns.Windows.OnEvent, event, ...) end
	if ns.Vault and ns.Vault.OnEvent then pcall(ns.Vault.OnEvent, event, ...) end
end)

-- ------------------------------------------------------------------
-- Slash commands
-- ------------------------------------------------------------------

local function PrintDebug()
	Print("version " .. ns.version .. ", debug report:")
	local keys = {}
	for k in pairs(report) do keys[#keys + 1] = k end
	table.sort(keys)
	for _, k in ipairs(keys) do
		DEFAULT_CHAT_FRAME:AddMessage("   |cffaaaaaa" .. k .. ":|r " .. tostring(report[k]))
	end
end

local function PrintHelp()
	Print("commands:")
	local lines = {
		"|cffffff00/banktabs|r opens the options",
		"|cffffff00/banktabs bank|r, |cffffff00bags|r or |cffffff00guild|r opens that saved window, or closes it when it is in front; they can be open together",
		"|cffffff00/banktabs snapshot|r saves your bags, and the bank or guild bank if one is open",
		"|cffffff00/banktabs gold|r lists every character's gold and the account total",
		"|cffffff00/banktabs reset|r puts every bag and bank window back where the game had it",
		"|cffffff00/banktabs lock|r or |cffffff00unlock|r turns every window switch off or on",
		"|cffffff00/banktabs grips|r outlines the part of each window you can drag",
		"|cffffff00/banktabs minimap|r shows or hides the minimap button",
		"|cffffff00/banktabs debug|r prints what resolved on this client",
	}
	for _, line in ipairs(lines) do DEFAULT_CHAT_FRAME:AddMessage("   " .. line) end
	DEFAULT_CHAT_FRAME:AddMessage("   |cffffff00/btabs|r is the short form. Options also live in Esc > Options > AddOns > Bank Tabs.")
end

-- /casement and /cst are added at PLAYER_LOGIN, once it is known the old Casement is not running.
SLASH_BANKTABS1 = "/banktabs"
SLASH_BANKTABS2 = "/btabs"
SlashCmdList["BANKTABS"] = function(msg)
	msg = (msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
	local cmd, rest = msg:match("^(%S*)%s*(.-)$")

	if cmd == "" then
		if ns.ToggleOptions then ns.ToggleOptions() else Print("The options are not built on this client, see /banktabs debug.") end

	elseif cmd == "debug" then
		PrintDebug()

	elseif cmd == "window" then
		if ns.ToggleOptions then ns.ToggleOptions(true) end

	elseif cmd == "vault" or cmd == "bank" or cmd == "bags" or cmd == "guild" then
		if not (ns.VaultUI and ns.VaultUI.Toggle) then Print("The saved windows are not built on this client.") return end
		-- Each is its own window. "vault" alone toggles the one in front, or the one opened last;
		-- "vault bags" and the like still work.
		local which = (cmd ~= "vault") and cmd or rest
		if which == "guildbank" then which = "guild" end
		if which ~= "bank" and which ~= "bags" and which ~= "guild" then which = nil end
		ns.VaultUI.Toggle(which)

	elseif cmd == "snapshot" then
		if not (ns.Vault and ns.Vault.SnapshotNow) then Print("Snapshots are not available on this client.") return end
		local what = ns.Vault.SnapshotNow()
		Print(what)

	elseif cmd == "reset" then
		if ns.Windows and ns.Windows.ResetAll then ns.Windows.ResetAll() end
		Print("every bag and bank window is back where the game had it.")

	elseif cmd == "lock" or cmd == "unlock" then
		local want = (cmd == "unlock")
		for key in pairs(ns.db.windows) do ns.db.windows[key] = want end
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("every bag and bank window is now " .. (want and "movable" or "locked") .. ".")

	elseif cmd == "gold" then
		local rows, total = ns.Vault.Gold()
		Print("gold across the account:")
		for _, row in ipairs(rows) do
			DEFAULT_CHAT_FRAME:AddMessage("   |cffffd200" .. ns.ShortLabel(row.who) .. "|r  " .. ns.Money(row.money)
				.. (row.mine and "  |cff909090(now)|r" or ""))
		end
		DEFAULT_CHAT_FRAME:AddMessage("   |cffffd200Total|r  " .. ns.Money(total))

	elseif cmd == "minimap" then
		local want = not ns.db.minimap.shown
		if rest == "on" then want = true elseif rest == "off" then want = false end
		ns.db.minimap.shown = want
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("minimap button " .. (want and "shown" or "hidden") .. ".")

	elseif cmd == "grips" then
		ns.db.showGrips = not ns.db.showGrips
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("drag strips are now " .. (ns.db.showGrips and "outlined" or "invisible") .. ".")

	elseif cmd == "scale" or cmd == "coords" or cmd == "mapdata" then
		-- The world map commands went with the world map to Map Tab.
		Print("the world map tab, coordinates and fog reveal are now a separate addon, Map Tab (/maptab).")

	else
		PrintHelp()
	end
end

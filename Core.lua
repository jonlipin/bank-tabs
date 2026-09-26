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
	return tostring(who)
end

function ns.ShortLabel(who)
	local entry = ns.vault and ns.vault.chars and ns.vault.chars[who]
	if type(entry) == "table" and type(entry.name) == "string" then return entry.name end
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
		report["bag header buttons"] = ok and "ok" or ("failed: " .. tostring(err))
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
		ns.Refresh()
		if ns.Windows and ns.Windows.Sweep then pcall(ns.Windows.Sweep, "login") end
		if ns.SyncOptions then pcall(ns.SyncOptions) end

	elseif event == "PLAYER_LOGOUT" then
		if ns.Vault and ns.Vault.OnEvent then pcall(ns.Vault.OnEvent, event) end
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
		"|cffffff00/banktabs bank|r opens the saved bank, |cffffff00/banktabs bags|r the saved bags, |cffffff00/banktabs guild|r the guild bank",
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

-- /casement and /cst are kept, unadvertised, for anyone with them in a macro from before 2.0.0.
SLASH_BANKTABS1 = "/banktabs"
SLASH_BANKTABS2 = "/btabs"
SLASH_BANKTABS3 = "/casement"
SLASH_BANKTABS4 = "/cst"
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
		if not (ns.VaultUI and ns.VaultUI.Toggle) then Print("The saved bank window is not built on this client.") return end
		-- "vault" alone opens whatever was showing last; "vault bags" and the like still work.
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

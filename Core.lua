-- Casement
-- Core: saved variables, defaults, the shared event frame and the slash commands.
--
-- Client notes that shape this file:
--  * The Forever beta client can hand back a nil SavedVariables table on a fresh login even when
--    a valid file is on disk, so every character's settings are mirrored into an account wide
--    copy and adopted late at PLAYER_LOGIN.
--  * Anything that might not exist on this client is probed once and recorded in `report`, which
--    "/casement debug" prints. Nothing in this addon should ever hard error.
--  * Nothing here registers COMBAT_LOG_EVENT_UNFILTERED, loads a Blizzard_ addon or creates
--    Settings proxy objects. All three taint this client.

local ADDON, ns = ...

ns.version = "1.0.0"
ns.report = {}

local report = ns.report

local function Print(msg)
	DEFAULT_CHAT_FRAME:AddMessage("|cff8fd3ffCasement|r " .. tostring(msg))
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
		worldmap = true,
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

	map = {
		resizeGrip = true,
		scaleButtons = true,
		scale = 1.0,
		step = 10, -- percent per click of the scale buttons
		minScale = 0.5,
		maxScale = 2.0,
	},

	vault = {
		autoBank = true,
		autoGuild = true,
		keepOtherCharacters = true,
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

function ns.Who()
	local name = UnitName and UnitName("player") or "player"
	local realm = GetRealmName and GetRealmName() or ""
	if realm ~= "" then return name .. " - " .. realm end
	return name
end

-- ------------------------------------------------------------------
-- Saved variables
-- ------------------------------------------------------------------

local function MirrorToAccount()
	if not ns.db then return end
	CasementAccountDB = CasementAccountDB or {}
	CasementAccountDB.profile = DeepCopy(ns.db)
	CasementAccountDB.version = ns.version
end
ns.MirrorToAccount = MirrorToAccount

-- The client sometimes starts a session with a blank per character table even though the file on
-- disk is fine. When the character table looks untouched we adopt the account mirror.
local function LoadDB(phase)
	local fresh = CountKeys(CasementDB) == 0
	if fresh and type(CasementAccountDB) == "table" and type(CasementAccountDB.profile) == "table" then
		CasementDB = DeepCopy(CasementAccountDB.profile)
		-- Positions belong to the character that set them, not to whoever logged in first.
		CasementDB.positions = {}
		report["db " .. phase] = "adopted the account copy"
	else
		CasementDB = type(CasementDB) == "table" and CasementDB or {}
		report["db " .. phase] = fresh and "fresh (first run)" or "loaded from this character"
	end
	FillDefaults(CasementDB, ns.defaults)
	ns.db = CasementDB

	CasementAccountDB = type(CasementAccountDB) == "table" and CasementAccountDB or {}
	CasementAccountDB.vault = type(CasementAccountDB.vault) == "table" and CasementAccountDB.vault or {}
	CasementAccountDB.vault.chars = CasementAccountDB.vault.chars or {}
	CasementAccountDB.vault.guilds = CasementAccountDB.vault.guilds or {}
	ns.vault = CasementAccountDB.vault

	MirrorToAccount()
end

function ns.ResetToDefaults()
	local vault = ns.vault
	CasementDB = DeepCopy(ns.defaults)
	ns.db = CasementDB
	ns.vault = vault
	MirrorToAccount()
	if ns.Windows and ns.Windows.ResetAll then pcall(ns.Windows.ResetAll) end
	ns.Refresh()
	if ns.SyncOptions then pcall(ns.SyncOptions) end
	Print("Settings reset to defaults. Saved bank snapshots were kept.")
end

-- ------------------------------------------------------------------
-- Refresh fan out. Every setter in the options calls this.
-- ------------------------------------------------------------------

function ns.Refresh()
	MirrorToAccount()
	if ns.Windows and ns.Windows.Apply then pcall(ns.Windows.Apply) end
	if ns.Map and ns.Map.Apply then pcall(ns.Map.Apply) end
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

function ns.CreatePanel(name)
	local panel, used
	for _, candidate in ipairs(PANEL_TEMPLATES) do
		local ok, made = pcall(CreateFrame, "Frame", name, UIParent, candidate[1])
		if ok and made and (not candidate[2] or candidate[2](made)) then
			panel, used = made, candidate[1]
			break
		end
		if ok and made then made:Hide() end
	end
	if not panel then
		local ok, made = pcall(CreateFrame, "Frame", name, UIParent, "BackdropTemplate")
		panel = (ok and made) or CreateFrame("Frame", name, UIParent)
		used = "backdrop"
		if panel.SetBackdrop then
			panel:SetBackdrop({
				bgFile = "Interface\\Tooltips\\UI-Tooltip-Background",
				edgeFile = "Interface\\Tooltips\\UI-Tooltip-Border",
				tile = true, tileSize = 16, edgeSize = 14,
				insets = { left = 3, right = 3, top = 3, bottom = 3 },
			})
			panel:SetBackdropColor(0.05, 0.05, 0.05, 0.94)
		end
	end
	report["window panel"] = used

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

local frame = CreateFrame("Frame", "CasementFrame", UIParent)
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
	if ns.Map and ns.Map.Init then
		local ok, err = pcall(ns.Map.Init)
		report["world map"] = ok and "ok" or ("failed: " .. tostring(err))
	end
	if ns.Vault and ns.Vault.Init then
		local ok, err = pcall(ns.Vault.Init)
		report["vault"] = ok and "ok" or ("failed: " .. tostring(err))
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
		if CountKeys(CasementDB) == 0 then LoadDB("player login") end
		ns.Refresh()
		if ns.Windows and ns.Windows.Sweep then pcall(ns.Windows.Sweep, "login") end
		if ns.SyncOptions then pcall(ns.SyncOptions) end

	elseif event == "PLAYER_LOGOUT" then
		MirrorToAccount()
		return
	end

	if ns.Windows and ns.Windows.OnEvent then pcall(ns.Windows.OnEvent, event, ...) end
	if ns.Map and ns.Map.OnEvent then pcall(ns.Map.OnEvent, event, ...) end
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
		"|cffffff00/casement|r opens the options",
		"|cffffff00/casement vault|r opens the saved bank and guild bank contents",
		"|cffffff00/casement snapshot|r saves what is on screen now",
		"|cffffff00/casement scale <50-200>|r sets the world map scale",
		"|cffffff00/casement reset|r puts every window back where the game had it",
		"|cffffff00/casement lock|r or |cffffff00unlock|r turns every window switch off or on",
		"|cffffff00/casement debug|r prints what resolved on this client",
	}
	for _, line in ipairs(lines) do DEFAULT_CHAT_FRAME:AddMessage("   " .. line) end
	DEFAULT_CHAT_FRAME:AddMessage("   Options also live in Esc > Options > AddOns > Casement.")
end

SLASH_CASEMENT1 = "/casement"
SLASH_CASEMENT2 = "/cst"
SlashCmdList["CASEMENT"] = function(msg)
	msg = (msg or ""):lower():gsub("^%s+", ""):gsub("%s+$", "")
	local cmd, rest = msg:match("^(%S*)%s*(.-)$")

	if cmd == "" then
		if ns.ToggleOptions then ns.ToggleOptions() else Print("The options are not built on this client, see /casement debug.") end

	elseif cmd == "debug" then
		PrintDebug()

	elseif cmd == "window" then
		if ns.ToggleOptions then ns.ToggleOptions(true) end

	elseif cmd == "vault" or cmd == "bank" then
		if ns.VaultUI and ns.VaultUI.Toggle then ns.VaultUI.Toggle() else Print("The vault window is not built on this client.") end

	elseif cmd == "snapshot" then
		if not (ns.Vault and ns.Vault.SnapshotNow) then Print("Snapshots are not available on this client.") return end
		local what = ns.Vault.SnapshotNow()
		Print(what)

	elseif cmd == "reset" then
		if ns.Windows and ns.Windows.ResetAll then ns.Windows.ResetAll() end
		if ns.Map and ns.Map.ResetSize then ns.Map.ResetSize() end
		Print("every window is back where the game had it.")

	elseif cmd == "lock" or cmd == "unlock" then
		local want = (cmd == "unlock")
		for key in pairs(ns.db.windows) do ns.db.windows[key] = want end
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("every window is now " .. (want and "movable" or "locked") .. ".")

	elseif cmd == "scale" then
		local value = tonumber(rest)
		if not value then Print("use /casement scale 50 to 200.") return end
		if value <= 5 then value = value * 100 end
		ns.db.map.scale = ns.Clamp(value / 100, ns.db.map.minScale, ns.db.map.maxScale)
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("world map scale " .. math.floor(ns.db.map.scale * 100 + 0.5) .. "%.")

	elseif cmd == "grips" then
		ns.db.showGrips = not ns.db.showGrips
		ns.Refresh()
		if ns.SyncOptions then pcall(ns.SyncOptions) end
		Print("drag strips are now " .. (ns.db.showGrips and "outlined" or "invisible") .. ".")

	else
		PrintHelp()
	end
end

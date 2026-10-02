// Offline harness for Bank Tabs: stubs the WoW API in fengari and walks the main paths.
//
//   node tests/banktabstest.js [addon dir] [--bare] [--verbose] [--noenum]
//
//   --bare    every UI template and atlas is missing, the way an unexpected client build would look
//   --noenum  no Enum.BagIndex, so the bank container list has to fall back to fixed ids
//
// The stub carries a small layout engine (points, anchors, scales) because much of what this addon
// does is geometry: clamping a window to the screen, putting a window back after the game has
// re-anchored it, and laying the saved bank out slot for slot where the real one has its slots.
//
// Three parts, each counted into the one result line:
//   * the main suite, one addon load on a clean install (no Casement anywhere);
//   * the Casement import, one fresh Lua state per case (the data holder present, the old addon
//     still running, nothing present, already imported, and the ways those can go wrong);
//   * the package files: the TOC, the data holder's TOC, .pkgmeta and the docs.
const fs = require('fs');
const path = require('path');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');

let DIR = process.argv.slice(2).find(a => !a.startsWith('--')) || path.resolve(__dirname, '..');
DIR = DIR.replace(/\\/g, '/');
if (!DIR.endsWith('/')) DIR += '/';
const files = ['Core.lua', 'Import.lua', 'Windows.lua', 'Minimap.lua', 'Vault.lua', 'VaultUI.lua', 'BagHeader.lua', 'Tooltips.lua', 'Options.lua'];

const stub = String.raw`
local VERBS = { "Set", "Get", "Is", "Create", "Register", "Enable", "Clear", "Hook", "Start", "Stop", "Has", "Num", "Add", "Unregister", "Disable", "Raise", "Lower", "Lock", "Unlock", "Show", "Hide", "Insert", "Toggle" }
local function isMethod(k)
  if type(k) ~= "string" then return false end
  for _, v in ipairs(VERBS) do if k:sub(1, #v) == v then return true end end
  return false
end

FRAMES = {}
TEXTURES = {}
FONTSTRINGS = {}
SCREEN_W, SCREEN_H = 1920, 1080

local FRACX = { LEFT = 0, RIGHT = 1, TOPLEFT = 0, BOTTOMLEFT = 0, TOPRIGHT = 1, BOTTOMRIGHT = 1, TOP = 0.5, BOTTOM = 0.5, CENTER = 0.5 }
local FRACY = { BOTTOM = 0, TOP = 1, BOTTOMLEFT = 0, BOTTOMRIGHT = 0, TOPLEFT = 1, TOPRIGHT = 1, LEFT = 0.5, RIGHT = 0.5, CENTER = 0.5 }

local function EffScale(f)
  local s = f.scale or 1
  local p, guard = f.parent, 0
  while p and guard < 20 do s = s * (p.scale or 1) p = p.parent guard = guard + 1 end
  return s
end

local resolving = {}
function ScreenRect(f)
  if f == nil then return 0, 0, SCREEN_W, SCREEN_H end
  if f == UIParent then return 0, 0, SCREEN_W, SCREEN_H end
  if resolving[f] then return 0, 0, 0, 0 end
  resolving[f] = true
  local eff = EffScale(f)
  local w, h = (f.w or 0) * eff, (f.h or 0) * eff
  local l, b = 0, 0
  if f.allPoints then
    l, b, w, h = ScreenRect(f.allPoints)
  elseif f.points and f.points[1] then
    local p = f.points[1]
    local rel = p[2] or f.parent or UIParent
    local rl, rb, rw, rh = ScreenRect(rel)
    local ax = rl + (FRACX[p[3]] or 0.5) * rw
    local ay = rb + (FRACY[p[3]] or 0.5) * rh
    local sx = ax + (p[4] or 0) * eff
    local sy = ay + (p[5] or 0) * eff
    l = sx - (FRACX[p[1]] or 0.5) * w
    b = sy - (FRACY[p[1]] or 0.5) * h
  end
  resolving[f] = nil
  return l, b, w, h
end

local unpack = unpack or table.unpack

local function obj(kind, template, name)
  local o = { shown = true, scripts = {}, w = 0, h = 0, scale = 1, kind = kind, template = template,
    name = name, points = {}, level = 1, id = 0, mouse = false, enabled = true, kids = {} }
  return setmetatable(o, { __index = function(t, k)
    -- Real child lists matter here: the addon walks a window's children to find the clear parts of
    -- its title bar, to work out what it has to sit above, and to measure the bank's slots.
    if k == "GetChildren" then return function(s) return unpack(s.kids or {}) end end
    if k == "GetNumChildren" then return function(s) return #(s.kids or {}) end end
    if k == "Show" then return function(s) local was = s.shown s.shown = true if not was and s.scripts.OnShow then s.scripts.OnShow(s) end end end
    if k == "Hide" then return function(s) local was = s.shown s.shown = false if was and s.scripts.OnHide then s.scripts.OnHide(s) end end end
    if k == "SetShown" then return function(s, v) if v then s:Show() else s:Hide() end end end
    if k == "IsShown" then return function(s) return s.shown end end
    -- Shown with every parent shown: a frame inside a hidden one still says it is shown.
    if k == "IsVisible" then return function(s)
      local f, guard = s, 0
      while f and guard < 30 do
        if not f.shown then return false end
        f, guard = f.parent, guard + 1
      end
      return true
    end end
    if k == "GetObjectType" then return function(s) return s.kind end end
    if k == "GetName" then return function(s) return s.name end end
    if k == "GetParent" then return function(s) return s.parent end end
    if k == "SetParent" then return function(s, p)
      if s.parent and s.parent.kids then
        for i, kid in ipairs(s.parent.kids) do if kid == s then table.remove(s.parent.kids, i) break end end
      end
      s.parent = p
      if p and p.kids then p.kids[#p.kids + 1] = s end
    end end
    if k == "SetID" then return function(s, v) s.id = v end end
    if k == "GetID" then return function(s) return s.id end end
    if k == "SetScript" then return function(s, e, f) s.scripts[e] = f end end
    if k == "GetScript" then return function(s, e) return s.scripts[e] end end
    if k == "HookScript" then return function(s, e, f) local old = s.scripts[e] s.scripts[e] = function(...) if old then old(...) end f(...) end end end
    if k == "SetSize" then return function(s, w, h) s.w, s.h = w, h end end
    if k == "SetWidth" then return function(s, w) s.w = w end end
    if k == "SetHeight" then return function(s, h) s.h = h end end
    if k == "GetWidth" then return function(s) return s.w end end
    if k == "GetHeight" then return function(s) return s.h end end
    if k == "GetSize" then return function(s) return s.w, s.h end end
    if k == "GetLeft" then return function(s) local l = ScreenRect(s) return l / EffScale(s) end end
    if k == "GetBottom" then return function(s) local _, b = ScreenRect(s) return b / EffScale(s) end end
    if k == "GetRight" then return function(s) local l, _, w = ScreenRect(s) return (l + w) / EffScale(s) end end
    if k == "GetTop" then return function(s) local _, b, _, h = ScreenRect(s) return (b + h) / EffScale(s) end end
    if k == "GetCenter" then return function(s) local l, b, w, h = ScreenRect(s) local e = EffScale(s) return (l + w / 2) / e, (b + h / 2) / e end end
    if k == "SetPoint" then return function(s, a1, a2, a3, a4, a5)
      local rel, relPoint, ox, oy
      if type(a2) == "number" then rel, relPoint, ox, oy = s.parent, a1, a2, a3
      elseif a2 == nil then rel, relPoint, ox, oy = s.parent, a1, 0, 0
      else rel, relPoint, ox, oy = a2, a3 or a1, a4 or 0, a5 or 0 end
      s.points[#s.points + 1] = { a1, rel, relPoint, ox, oy }
      SETPOINTS = SETPOINTS + 1
    end end
    if k == "GetPoint" then return function(s, i)
      local p = s.points[i or 1]
      if not p then return nil end
      return p[1], p[2], p[3], p[4], p[5]
    end end
    if k == "GetNumPoints" then return function(s) return #s.points end end
    if k == "ClearAllPoints" then return function(s) s.points = {} s.allPoints = nil end end
    if k == "SetAllPoints" then return function(s, other) s.allPoints = other or s.parent end end
    if k == "SetScale" then return function(s, v) if type(v) ~= "number" or v <= 0 then error("bad scale") end s.scale = v end end
    if k == "GetScale" then return function(s) return s.scale or 1 end end
    if k == "GetEffectiveScale" then return function(s) return EffScale(s) end end
    if k == "SetMovable" then return function(s, v) s.movable = v end end
    if k == "IsMovable" then return function(s) return s.movable end end
    if k == "SetClampedToScreen" then return function(s, v) s.clamped = v end end
    if k == "SetClampRectInsets" then return function(s, l, r, t, b) s.clampInsets = { l, r, t, b } end end
    if k == "GetClampRectInsets" then return function(s) local c = s.clampInsets or { 0, 0, 0, 0 } return c[1], c[2], c[3], c[4] end end
    if k == "StartMoving" then return function(s) if not s.movable then error("frame is not movable") end s.moving = true MOVING = s end end
    if k == "StopMovingOrSizing" then return function(s) s.moving = false MOVING = nil end end
    if k == "SetAttribute" then return function(s, key, v) s.attributes = s.attributes or {} s.attributes[key] = v end end
    if k == "GetAttribute" then return function(s, key) return s.attributes and s.attributes[key] end end
    if k == "SetFrameLevel" then return function(s, v) s.level = v end end
    if k == "GetFrameLevel" then return function(s) return s.level end end
    if k == "SetFrameStrata" then return function(s, v)
      local valid = { BACKGROUND = 1, LOW = 1, MEDIUM = 1, HIGH = 1, DIALOG = 1, FULLSCREEN = 1,
        FULLSCREEN_DIALOG = 1, TOOLTIP = 1 }
      if not valid[v] then error("bad strata " .. tostring(v)) end
      s.strata = v
    end end
    if k == "EnableMouse" then return function(s, v) s.mouse = v end end
    if k == "IsMouseEnabled" then return function(s) return s.mouse end end
    if k == "EnableMouseWheel" then return function(s, v) s.wheel = v end end
    if k == "RegisterForDrag" then return function(s, ...) s.dragButtons = { ... } end end
    if k == "RegisterForClicks" then return function() end end
    if k == "SetText" then return function(s, x) s.text = x end end
    if k == "GetText" then return function(s) return s.text end end
    if k == "SetFontObject" or k == "SetNormalFontObject" then return function(s, f) s.font = f end end
    if k == "GetStringWidth" then return function(s) return #tostring(s.text or "") * 6 end end
    if k == "GetStringHeight" then return function(s) return 12 end end
    if k == "SetChecked" then return function(s, v) s.checked = v end end
    if k == "GetChecked" then return function(s) return s.checked end end
    if k == "SetEnabled" then return function(s, v) s.enabled = v end end
    if k == "IsEnabled" then return function(s) return s.enabled end end
    if k == "SetValue" then return function(s, v)
      if s.minV and (v < s.minV - 0.001 or v > s.maxV + 0.001) then error("slider value out of range") end
      s.value = v
      if s.scripts.OnValueChanged then s.scripts.OnValueChanged(s, v) end
    end end
    if k == "GetValue" then return function(s) return s.value or 0 end end
    if k == "SetMinMaxValues" then return function(s, a, b) s.minV, s.maxV = a, b end end
    if k == "GetMinMaxValues" then return function(s) return s.minV or 0, s.maxV or 0 end end
    if k == "SetValueStep" then return function(s, v) s.step = v end end
    if k == "SetOrientation" then return function(s, v) s.orientation = v end end
    if k == "SetThumbTexture" then return function(s, v) s.thumb = obj("texture") s.thumb.parent = s s.thumb.texture = v end end
    if k == "GetThumbTexture" then return function(s) return s.thumb end end
    if k == "SetScrollChild" then return function(s, c) s.scrollChild = c c.parent = s end end
    if k == "SetVerticalScroll" then return function(s, v) s.scrollY = v end end
    if k == "GetVerticalScroll" then return function(s) return s.scrollY or 0 end end
    if k == "SetTexture" then return function(s, x) s.texture = x end end
    if k == "GetTexture" then return function(s) return s.texture end end
    -- As on the client, an atlas it lacks raises nothing: the texture just stays blank. Only the
    -- atlas table (C_Texture.GetAtlasInfo) can say whether one is there.
    if k == "SetAtlas" then return function(s, x) if BAD_ATLAS then s.atlas = nil return end s.atlas = x end end
    if k == "SetColorTexture" then return function(s, r, g, b, a) s.color = { r, g, b, a } s.texture = nil end end
    if k == "SetVertexColor" then return function(s, r, g, b) s.vertex = { r, g, b } end end
    if k == "SetTexCoord" then return function(s, a, b, c, d) s.texCoord = { a, b, c, d } end end
    if k == "GetTexCoord" then return function(s) return unpack(s.texCoord or { 0, 1, 0, 1 }) end end
    if k == "SetAlpha" then return function(s, x) s.alpha = x end end
    if k == "GetAlpha" then return function(s) return s.alpha or 1 end end
    if k == "SetJustifyH" or k == "SetJustifyV" or k == "SetWordWrap" then return function() end end
    if k == "SetAutoFocus" or k == "ClearFocus" or k == "SetFocus" then return function() end end
    if k == "SetFontString" then return function(s, f) s.fontString = f end end
    if k == "GetFontString" then return function(s) return s.fontString end end
    if k == "SetNormalTexture" then return function(s, v) s.art = v s.normalArt = v end end
    if k == "GetNormalTexture" then return function(s) return { GetTexture = function() return s.normalArt end } end end
    if k == "SetPushedTexture" or k == "SetHighlightTexture" or k == "SetCheckedTexture" then
      return function(s, v) s.art = v end
    end
    if k == "SetBackdrop" then return function(s, b) s.backdrop = b end end
    if k == "LockHighlight" then return function(s) s.highlighted = true end end
    if k == "UnlockHighlight" then return function(s) s.highlighted = false end end
    if k == "CreateTexture" then return function(s, n, layer, tmpl, sub)
      local r = obj("texture") r.parent = s r.layer = layer r.sub = sub TEXTURES[#TEXTURES + 1] = r return r
    end end
    if k == "CreateFontString" then return function(s, n, layer, font)
      local r = obj("fontstring") r.parent = s r.font = font FONTSTRINGS[#FONTSTRINGS + 1] = r return r
    end end
    if k:sub(1, 6) == "Create" then return function() return obj("region") end end
    if isMethod(k) then return function() end end
    return nil
  end })
end

BAD_TEMPLATES = BAD_TEMPLATES or {}
BAD_ATLAS = BAD_ATLAS or false
SETPOINTS = 0
function CreateFrame(kind, name, parent, template)
  if template and BAD_TEMPLATES[template] then error("Couldn't find inherited node " .. template) end
  local f = obj(kind, template, name)
  f.parent = parent
  if parent and parent.kids then parent.kids[#parent.kids + 1] = f end
  if template == "ButtonFrameTemplate" or template == "DefaultPanelFlatTemplate" or template == "DefaultPanelTemplate" then
    f.NineSlice = obj("Frame") f.TitleText = obj("fontstring") f.Inset = obj("Frame")
  end
  if template == "ButtonFrameTemplate" then
    -- The portrait the bank window has in its top left corner.
    f.PortraitContainer = { portrait = obj("texture") }
    f.PortraitContainer.portrait.parent = f
  end
  if template == "SearchBoxTemplate" then f.Instructions = obj("fontstring") end
  if template == "TooltipBackdropTemplate" or template == "BackdropTemplate" then f.SetBackdrop = function(s, b) s.backdrop = b end end
  if template == "UIPanelButtonTemplate" then f.fontString = obj("fontstring") end
  FRAMES[#FRAMES + 1] = f
  if name then _G[name] = f end
  return f
end

UIParent = obj("Frame") UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
WorldFrame = obj("Frame")
GameTooltip = obj("GameTooltip")
DEFAULT_CHAT_FRAME = { AddMessage = function(_, m) CHAT[#CHAT + 1] = m if VERBOSE then print(m) end end }
CHAT = {}
SlashCmdList = {} UISpecialFrames = {} tinsert = table.insert
-- Escape, as the game does it: every shown window named in UISpecialFrames is hidden, the list
-- walked with pairs, so an addon may only overwrite an entry while this runs.
function CloseSpecialWindows()
  local found
  for _, name in pairs(UISpecialFrames) do
    local f = _G[name]
    if f and f.IsShown and f:IsShown() then f:Hide() found = 1 end
  end
  return found
end
time = os.time
date = os.date

NOW = 1000
function GetTime() return NOW end

-- Timers. RunTimers advances the clock and fires anything due, repeatedly, so a callback that
-- schedules another timer is picked up in the same run.
TIMERS = {}
C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { at = NOW + (delay or 0), fn = fn } end }
function RunTimers(seconds)
  local target = NOW + (seconds or 0)
  for _ = 1, 400 do
    local soonest, index = nil, nil
    for i, t in ipairs(TIMERS) do
      if t.at <= target and (not soonest or t.at < soonest) then soonest, index = t.at, i end
    end
    if not index then break end
    local entry = table.remove(TIMERS, index)
    NOW = math.max(NOW, entry.at)
    local ok, err = pcall(entry.fn)
    if not ok then TIMER_ERRORS[#TIMER_ERRORS + 1] = tostring(err) end
  end
  NOW = target
end
TIMER_ERRORS = {}

function hooksecurefunc(name, fn)
  if type(name) == "table" then error("table form not stubbed") end
  local old = _G[name]
  if type(old) ~= "function" then error("no such function " .. tostring(name)) end
  _G[name] = function(...) local r = old(...) fn(...) return r end
  HOOKED[#HOOKED + 1] = name
end
HOOKED = {}

CURSOR = { 900, 600 }
function GetCursorPosition() return CURSOR[1], CURSOR[2] end

SHIFT, CTRL, ALT = false, false, false
function IsShiftKeyDown() return SHIFT end
function IsControlKeyDown() return CTRL end
function IsAltKeyDown() return ALT end

-- Every character on WoW Forever has a first name and a surname, and UnitName gives them as two
-- values. NAME_SHAPE switches to the other shapes the client has been seen to give.
NAME_SHAPE = "two"
function UnitName()
  if NAME_SHAPE == "whole" then return "Vatik Voidpact", "Voidpact" end
  if NAME_SHAPE == "unknown" then return "Unknown" end
  if NAME_SHAPE == "first" then return "Vatik" end
  return "Vatik", "Voidpact"
end
function GetRealmName() return "Voidpact" end
function UnitClass() return "Warlock", "WARLOCK" end
function UnitLevel() return 60 end
GUILD_NAME = "Night Owls"
-- In a guild whose name the client has not handed over yet, as early in a session.
GUILD_LOADING = false
function GetGuildInfo(unit) if GUILD_NAME == "" or GUILD_LOADING then return nil end return GUILD_NAME, "Officer", 1 end
function IsInGuild() return GUILD_NAME ~= "" end
function GetMoney() return 1234567 end
function GetCoinTextureString(v) return tostring(v) .. "c" end
function GetFileIDFromPath(p) return 12345 end
function ChatEdit_InsertLink(link) INSERTED = link end
ITEM_QUALITY_COLORS = { [1] = { r = 1, g = 1, b = 1 }, [2] = { r = 0.1, g = 1, b = 0.1 }, [3] = { r = 0.3, g = 0.4, b = 1 } }

UIPanelWindows = { BankFrame = { area = "left" }, GuildBankFrame = { area = "left" }, WorldMapFrame = { area = "full" } }
function ShowUIPanel(f) if f then f:Show() end end
function HideUIPanel(f) if f then f:Hide() end end

-- Secret values: a widget takes them, arithmetic on them is an error, exactly like the client.
SECRETS = setmetatable({}, { __mode = "k" })
function issecretvalue(v) return SECRETS[v] == true end
function MakeSecret() local t = {} SECRETS[t] = true return t end

-- ------------------------------------------------------------------
-- The addon list
-- ------------------------------------------------------------------

-- Only what a test puts in ADDONS exists. Every call is written down, in order, so a test can say
-- what was loaded, switched on or switched off, and in what order.
ADDONS = ADDONS or {}
ADDON_CALLS = {}
LOADED_BY_US = {}
ENABLE_STATE_ASKED = false -- the addon and the character the last enable state was asked for
local function addonCall(fn, name) ADDON_CALLS[#ADDON_CALLS + 1] = fn .. " " .. tostring(name) end
function EnableState(name, character)
  local a = ADDONS[name]
  if not a or not a.enabled then return 0 end
  if character == nil then return (a.offFor and next(a.offFor)) and 1 or 2 end
  return (a.offFor and a.offFor[character]) and 0 or 2
end
C_AddOns = {
  DoesAddOnExist = function(name) addonCall("DoesAddOnExist", name) return ADDONS[name] ~= nil end,
  GetAddOnInfo = function(name)
    addonCall("GetAddOnInfo", name)
    local a = ADDONS[name]
    if not a then return name, nil, nil, false, "MISSING" end
    local reason = (not a.enabled) and "DISABLED" or nil
    return name, a.title or name, a.notes, (a.enabled and not a.refuse) and true or false, reason or a.refuse
  end,
  IsAddOnLoaded = function(name) addonCall("IsAddOnLoaded", name) local a = ADDONS[name] return (a and a.loaded) or false, (a and a.loaded) or false end,
  IsAddOnLoadOnDemand = function(name) addonCall("IsAddOnLoadOnDemand", name) local a = ADDONS[name] return (a and a.lod) or false end,
  -- The modern argument order: the addon, then the character. An addon can be switched off for
  -- some characters only (offFor, by name): asked for one of those it answers 0, asked with no
  -- character it answers for the whole account, where 1 means on for some.
  GetAddOnEnableState = function(name, character)
    addonCall("GetAddOnEnableState", name)
    ENABLE_STATE_ASKED = { name, character }
    return EnableState(name, character)
  end,
  -- With no character, both switch it for every character.
  EnableAddOn = function(name) addonCall("EnableAddOn", name) if ADDONS[name] then ADDONS[name].enabled = true ADDONS[name].offFor = nil end end,
  DisableAddOn = function(name) addonCall("DisableAddOn", name) if ADDONS[name] then ADDONS[name].enabled = false end end,
  SaveAddOns = function() addonCall("SaveAddOns", nil) end,
  LoadAddOn = function(name)
    addonCall("LoadAddOn", name)
    LOADED_BY_US[#LOADED_BY_US + 1] = name
    local a = ADDONS[name]
    if not a then return false, "MISSING" end
    if not a.enabled or (a.offFor and a.offFor[UnitName("player")]) then return false, "DISABLED" end
    if a.refuse then return false, a.refuse end
    if a.loaded then return true end
    a.loaded = true
    -- The game reads an addon's saved variables in before telling anyone it has loaded.
    for key, value in pairs(a.saved or {}) do _G[key] = value end
    if ON_ADDON_LOADED then ON_ADDON_LOADED(name) end
    return true
  end,
}
if NO_ADDON_API then C_AddOns = nil end

-- ------------------------------------------------------------------
-- Bags, bank and guild bank
-- ------------------------------------------------------------------

NO_ENUM = NO_ENUM or false
if not NO_ENUM then
  -- WoW Forever's own list (Blizzard_APIDocumentationGenerated/BagIndexConstantsDocumentation.lua):
  -- nine character bank tabs from 6, nine account tabs from 15, and below zero the containers that
  -- hold the bags put in the Bag Slots (Characterbanktab, Accountbanktab) and the keyring.
  Enum = { BagIndex = {
    Accountbanktab = -3, Characterbanktab = -2, Keyring = -1,
    Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4, ReagentBag = 5,
  }, BankType = { Character = 0, Guild = 1, Account = 2 } }
  for i = 1, 9 do
    Enum.BagIndex["CharacterBankTab_" .. i] = 5 + i
    Enum.BagIndex["AccountBankTab_" .. i] = 14 + i
  end
  -- The bank's tabs: the main one and, bought with the first Bag Slot, tab 2. A Bag Slot is a bank
  -- tab on this client; the bag put in it gives the tab its slots.
  BANK_TABS_BOUGHT = 2
  C_Bank = {
    ShouldUsePlayerBagsInBank = function() return true end,
    FetchMaxNumBankTabs = function(bankType) return 9 end,
    FetchNumPurchasedBankTabs = function(bankType) return BANK_TABS_BOUGHT end,
    FetchPurchasedBankTabData = function(bankType)
      local out = {}
      for i = 1, BANK_TABS_BOUGHT do out[i] = { ID = 5 + i, bankType = bankType, name = "Tab " .. i, icon = 0 } end
      return out
    end,
  }
else
  Enum = {}
end

-- The legacy bank container still reports slots on this client even though nothing can be put in
-- it, which is exactly the trap the scan has to avoid.
-- Bags 0 to 4 are the carried bags, 5 is the reagent bag, 6 the real bank tab and 7 the one bank
-- bag that is equipped in the first Bag Slot.
-- Under the enum, 7 is bank tab 2, given its 16 slots by the bag in the first Bag Slot; under the
-- classic ids it is a 48 slot bank bag.
SLOTS = { [0] = 16, [1] = 16, [2] = 16, [3] = 14, [4] = 12, [5] = 12, [-1] = 32, [-3] = 0, [6] = 48, [7] = NO_ENUM and 48 or 16 }

function link(id, name) return "|cffffffff|Hitem:" .. id .. "::::::::60:::::::::|h[" .. name .. "]|h|r" end
BANK_ITEMS = {
  [6] = {
    [1] = { id = 2589, name = "Linen Cloth", count = 20, quality = 1 },
    [4] = { id = 2592, name = "Wool Cloth", count = 12, quality = 2 },
    [9] = { id = 12359, name = "Thorium Bar", count = 5, quality = 1 },
  },
  [7] = {
    [2] = { id = 13446, name = "Major Healing Potion", count = 5, quality = 1 },
  },
  [-1] = { [1] = { id = 4306, name = "Silk Cloth", count = 3, quality = 1 } },
  -- The bags in the Bag Slots, under the enum: the first Bag Slot's bag sits at slot 2, its tab's
  -- number, the way the game's own Bag Slot buttons read it.
  [-2] = { [2] = { id = 4500, name = "Traveler's Backpack", count = 1, quality = 1 } },
}
-- What the carried bags hold, in particular slots so the replica can be checked for drawing each
-- one where it sat.
BAG_ITEMS = {
  [0] = {
    [1] = { id = 6948, name = "Hearthstone", count = 1, quality = 1 },
    [16] = { id = 159, name = "Refreshing Spring Water", count = 5, quality = 1 },
  },
  [3] = { [7] = { id = 4306, name = "Silk Cloth", count = 8, quality = 1 } },
  [4] = { [12] = { id = 6265, name = "Soul Shard", count = 1, quality = 1 } },
}

local function ItemAt(bag, slot)
  local entry = BANK_ITEMS[bag] and BANK_ITEMS[bag][slot]
  if not entry then entry = BAG_ITEMS[bag] and BAG_ITEMS[bag][slot] end
  return entry
end

C_Container = {
  GetContainerNumSlots = function(bag) return SLOTS[bag] or 0 end,
  GetContainerItemInfo = function(bag, slot)
    local entry = ItemAt(bag, slot)
    if not entry then return nil end
    return { iconFileID = 100 + entry.id, stackCount = entry.count, quality = entry.quality,
      hyperlink = link(entry.id, entry.name), itemID = entry.id }
  end,
  -- The inventory slot a container hangs off: the carried bags sit at 20 to 24, the bank bag in
  -- the first Bag Slot at 68. Nothing else is a bag.
  ContainerIDToInventoryID = function(id)
    if id >= 1 and id <= 5 then return 19 + id end
    if id == 7 then return 68 end
    return nil
  end,
}

-- The seven Bag Slots of the bank window: slot i hangs off inventory 67 + i.
function BankButtonIDToInvSlotID(i, isBag) return 67 + i end
BANK_SLOTS_PURCHASED = 1
function GetNumBankSlots() return BANK_SLOTS_PURCHASED end

-- What is equipped where: the four carried bags, the reagent bag and one bank bag.
INVENTORY = {
  [20] = { icon = "Interface\\Icons\\INV_Misc_Bag_10", link = link(4500, "Traveler's Backpack") },
  [21] = { icon = "Interface\\Icons\\INV_Misc_Bag_11", link = link(4499, "Huge Brown Sack") },
  [22] = { icon = "Interface\\Icons\\INV_Misc_Bag_12", link = link(4496, "Small Brown Pouch") },
  [23] = { icon = "Interface\\Icons\\INV_Misc_Bag_09", link = link(4497, "Small Red Pouch") },
  [24] = { icon = "Interface\\Icons\\INV_Misc_Bag_07", link = link(4498, "Reagent Pouch") },
  [68] = { icon = "Interface\\Icons\\INV_Misc_Bag_08", link = link(4500, "Traveler's Backpack") },
}
function GetInventoryItemTexture(unit, inv) return INVENTORY[inv] and INVENTORY[inv].icon or nil end
function GetInventoryItemLink(unit, inv) return INVENTORY[inv] and INVENTORY[inv].link or nil end

-- Atlases this client is known to carry. A bare client carries none.
KNOWN_ATLASES = { ["bags-item-slot64"] = true, ["bags-glow-white"] = true, ["bankslot-icon-lock"] = true, ["UI-HUD-ActionBar-IconFrame-Mask"] = true, ["spellbook-Tab-Frame-C60"] = true,
  ["spellbook-Tab-Frame-Glow-C60"] = true, ["spellbook-Tab-Frame-glow-gradient-C60"] = true }
C_Texture = {
  GetAtlasInfo = function(name)
    if BARE or not KNOWN_ATLASES[name] then return nil end
    return { width = 64, height = 64, file = "atlas" }
  end,
}

CLASS_ICON_TCOORDS = {
  WARLOCK = { 0.5, 0.75, 0.25, 0.5 },
  WARRIOR = { 0, 0.25, 0, 0.25 },
}
LOCALIZED_CLASS_NAMES_MALE = { WARLOCK = "Warlock", WARRIOR = "Warrior", MAGE = "Mage" }
function SetPortraitTexture(tex, unit) tex.portraitOf = unit end
PLAYED = {}
function PlaySound(id) PLAYED[#PLAYED + 1] = id end
SOUNDKIT = { IG_ABILITY_PAGE_TURN = 1 }

GUILD_TABS = 3
GUILD_ITEMS = {
  [1] = { [1] = { id = 3371, name = "Crystal Vial", count = 20, quality = 1 },
          [7] = { id = 765, name = "Silverleaf", count = 40, quality = 1 } },
  [2] = { [3] = { id = 7910, name = "Star Ruby", count = 2, quality = 2 } },
  [3] = {},
}
QUERIED = {}
CURRENT_TAB = 2
function GetNumGuildBankTabs() return GUILD_TABS end
function GetGuildBankTabInfo(tab) return "Vault " .. tab, "icon" .. tab, tab ~= 3 end
function GetGuildBankItemInfo(tab, slot)
  local entry = GUILD_ITEMS[tab] and GUILD_ITEMS[tab][slot]
  if not entry then return nil end
  return 200 + entry.id, entry.count, false, false, entry.quality
end
function GetGuildBankItemLink(tab, slot)
  local entry = GUILD_ITEMS[tab] and GUILD_ITEMS[tab][slot]
  if not entry then return nil end
  return link(entry.id, entry.name)
end
function QueryGuildBankTab(tab) QUERIED[#QUERIED + 1] = tab end
function GetCurrentGuildBankTab() return CURRENT_TAB end
function SetCurrentGuildBankTab(tab) CURRENT_TAB = tab end
function GetGuildBankMoney() return 9876543 end

-- Tooltips: the modern pipeline hands item tooltips to registered post calls; the lines added
-- are recorded so they can be read back.
TOOLTIP_CALLBACKS = {}
Enum.TooltipDataType = { Item = 0 }
TooltipDataProcessor = {
  AddTooltipPostCall = function(kind, fn) TOOLTIP_CALLBACKS[kind] = fn end,
}
local function tooltipObj(name)
  local t = obj("GameTooltip", nil, name)
  t.csLines = {}
  rawset(t, "SetOwner", function(self) self.csLines = {} end)
  rawset(t, "AddLine", function(self, text) self.csLines[#self.csLines + 1] = { text } end)
  rawset(t, "AddDoubleLine", function(self, left, right) self.csLines[#self.csLines + 1] = { left, right } end)
  rawset(t, "GetItem", function(self) return self.csItemName, self.csItemLink end)
  _G[name] = t
  return t
end
GameTooltip = tooltipObj("GameTooltip")
ItemRefTooltip = tooltipObj("ItemRefTooltip")
ShoppingTooltip1 = tooltipObj("ShoppingTooltip1")
ShoppingTooltip2 = tooltipObj("ShoppingTooltip2")
RAID_CLASS_COLORS = { WARLOCK = { r = 0.53, g = 0.53, b = 0.93 }, WARRIOR = { r = 0.78, g = 0.61, b = 0.43 } }
-- What this character is carrying right now, by item id.
LIVE_COUNTS = {}
C_Item = C_Item or {}
ItemLocation = { CreateFromBagAndSlot = function(self, bag, slot) return { bag = bag, slot = slot } end }
C_Item.DoesItemExist = function(location) return ItemAt(location.bag, location.slot) ~= nil end
C_Item.GetItemIcon = function(location) local e = ItemAt(location.bag, location.slot) return e and (100 + e.id) or nil end
C_Item.GetItemLink = function(location) local e = ItemAt(location.bag, location.slot) return e and link(e.id, e.name) or nil end
C_Item.GetItemCount = function(id, includeBank) return LIVE_COUNTS[id] or 0 end

-- ------------------------------------------------------------------
-- The game's own windows
-- ------------------------------------------------------------------

-- The world map is Map Tab's. It is here so the suite can show Bank Tabs never touches it.
WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame:SetSize(700, 500)
WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
WorldMapFrame:Hide()

-- The game's panel positioning: it re-anchors a panel window to its own spot, and it can run
-- AFTER the window has changed size. A placed window has to be put back in the same frame.
PANEL_POSITIONINGS = 0
function UpdateUIPanelPositions(frame)
  PANEL_POSITIONINGS = PANEL_POSITIONINGS + 1
  if frame == WorldMapFrame then
    WorldMapFrame:ClearAllPoints()
    WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
  elseif frame == BankFrame then
    BankFrame:ClearAllPoints()
    BankFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 40, -120)
  end
end

Minimap = CreateFrame("Frame", "Minimap", UIParent)
Minimap:SetSize(140, 140)
Minimap:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -20, -20)

MOUSE_DOWN = false
function IsMouseButtonDown(which) return MOUSE_DOWN end

BankFrame = CreateFrame("Frame", "BankFrame", UIParent)
BankFrame:SetSize(400, 500)
BankFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 40, -120)
-- The real bank's slots, so the snapshot can measure the layout the replica copies: 48 slots on a
-- 50 by 47 pitch starting 48 in and 63 down, eight bag slots of 24 on a 38 pitch, and the buttons
-- that must be ignored (a square close button up top, a wide purchase button below).
BANK_SLOT_BUTTONS = {}
for i = 1, 48 do
  local b = CreateFrame("ItemButton", "BankFrameItem" .. i, BankFrame)
  b:SetSize(37, 37)
  b:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 48 + ((i - 1) % 8) * 50, -(63 + math.floor((i - 1) / 8) * 47))
  b:EnableMouse(true)
  BANK_SLOT_BUTTONS[i] = b
end
for i = 1, 8 do
  local b = CreateFrame("ItemButton", "BankFrameBag" .. i, BankFrame)
  b:SetSize(24, 24)
  b:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 145 + (i - 1) * 38, -359)
  b:EnableMouse(true)
end
BANK_CLOSE = CreateFrame("Button", nil, BankFrame)
BANK_CLOSE:SetSize(32, 32)
BANK_CLOSE:SetPoint("TOPRIGHT", BankFrame, "TOPRIGHT", -4, -4)
BANK_CLOSE:EnableMouse(true)
BANK_PURCHASE = CreateFrame("Button", nil, BankFrame)
BANK_PURCHASE:SetSize(120, 22)
BANK_PURCHASE:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 200, -410)
BANK_PURCHASE:EnableMouse(true)
-- The panel the slots belong to, with the page size the real one gets from its XML (88).
BankFrame.BankPanel = CreateFrame("Frame", nil, BankFrame)
BankFrame.BankPanel:SetAllPoints(BankFrame)
BankFrame.BankPanel.maximumTotalSlotsPerPage = 88
NUM_BANKBAGSLOTS = 8
function UnitGUID(unit) return "Player-70-0A1B2C3D" end
BankFrame:Hide()

for i = 1, 17 do
  local f = CreateFrame("Frame", "ContainerFrame" .. i, UIParent)
  f:SetSize(340, 400)
  f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20 - (i - 1) * 10, 100)
  f:SetID(i - 1)
  -- A close button in the header, so anything the addon puts up there has to work around it.
  local close = CreateFrame("Button", nil, f)
  close:SetSize(30, 26)
  close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -4, -2)
  close:EnableMouse(true)
  close:SetFrameLevel(4)
  f.testClose = close
  f:Hide()
end
ContainerFrameCombinedBags = CreateFrame("Frame", "ContainerFrameCombinedBags", UIParent)
ContainerFrameCombinedBags:SetSize(420, 600)
ContainerFrameCombinedBags:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20, 100)
ContainerFrameCombinedBags:Hide()

-- The money readouts on the game's own windows: a frame with the coin buttons inside it.
local function moneyFrame(parent, name)
  local m = CreateFrame("Frame", name, parent)
  m:SetSize(120, 16)
  m:SetPoint("BOTTOMRIGHT", parent, "BOTTOMRIGHT", -10, 10)
  local gold = CreateFrame("Button", nil, m)
  gold:SetSize(40, 16)
  gold:SetPoint("LEFT", m, "LEFT", 0, 0)
  m.gold = gold
  return m
end
ContainerFrame1.MoneyFrame = moneyFrame(ContainerFrame1, nil)
ContainerFrameCombinedBags.MoneyFrame = moneyFrame(ContainerFrameCombinedBags, nil)
moneyFrame(BankFrame, "BankFrameMoneyFrame")

-- The game re-stacks every open bag window through this one.
BLIZZ_RESTACKS = 0
function UpdateContainerFrameAnchors()
  BLIZZ_RESTACKS = BLIZZ_RESTACKS + 1
  local y = 100
  for i = 1, 17 do
    local f = _G["ContainerFrame" .. i]
    if f and f.shown then
      f:ClearAllPoints()
      f:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20, y)
      y = y + 40
    end
  end
end

-- ------------------------------------------------------------------
-- Settings
-- ------------------------------------------------------------------

CATEGORIES = {}
OPEN_NEEDS_PANEL = OPEN_NEEDS_PANEL ~= false
SettingsPanel = obj("Frame") SettingsPanel:Hide()
SettingsPanel.Open = function(self) self:Show() end
local nextCategoryID = 0
Settings = {
  RegisterCanvasLayoutCategory = function(frame, name)
    nextCategoryID = nextCategoryID + 1
    local c = { frame = frame, name = name, id = "category" .. nextCategoryID }
    c.GetID = function(self) return self.id end
    CATEGORIES[#CATEGORIES + 1] = c
    return c
  end,
  RegisterAddOnCategory = function(c) c.registered = true end,
  OpenToCategory = function(which)
    local cat
    for _, c in ipairs(CATEGORIES) do
      if c.id == which or c == which then cat = c end
    end
    if not cat then return end
    if OPEN_NEEDS_PANEL and not SettingsPanel:IsShown() then return end
    SettingsPanel:Show()
    cat.frame.w, cat.frame.h = 760, 620
    cat.frame:Show()
  end,
}
if NO_SETTINGS then Settings = nil end
`;

// Loaded into every Lua state after the stub: the counters, the loader and what the Casement
// import cases share.
const common = String.raw`
PASS, FAIL = 0, 0
function check(label, cond, extra)
  if cond then PASS = PASS + 1 else FAIL = FAIL + 1 print("FAIL: " .. (SCENARIO and (SCENARIO .. ": ") or "") .. label .. (extra and ("  [" .. tostring(extra) .. "]") or "")) end
end
function near(a, b, slack)
  if type(a) ~= "number" or type(b) ~= "number" then return false end
  return math.abs(a - b) <= (slack or 0.5)
end

function LoadBankTabs()
  local ns = {}
  for _, file in ipairs(FILES) do
    local chunk, err = load(SOURCES[file], "@" .. file)
    if not chunk then error("SYNTAX " .. tostring(err)) end
    chunk("BankTabs", ns)
  end
  NS = ns
  return ns
end

function fire(...) BankTabsFrame.scripts.OnEvent(BankTabsFrame, ...) end
-- An addon loaded on demand is announced to every addon, Bank Tabs included.
ON_ADDON_LOADED = function(name) if BankTabsFrame then fire("ADDON_LOADED", name) end end

function ChatWith(text)
  local n = 0
  for _, line in ipairs(CHAT) do if line:find(text, 1, true) then n = n + 1 end end
  return n
end
function ChatLine(text)
  for _, line in ipairs(CHAT) do if line:find(text, 1, true) then return line end end
  return nil
end
function CountCalls(what)
  local n = 0
  for _, c in ipairs(ADDON_CALLS) do if c == what then n = n + 1 end end
  return n
end
function Called(what) return CountCalls(what) > 0 end
function CallIndex(what)
  for i, c in ipairs(ADDON_CALLS) do if c == what then return i end end
  return nil
end

VATIK = "Player-70-0A1B2C3D"
CHOHAM_GUID = "Player-70-0E0F1011"

-- What Casement 1.2.3 left in its account file: this character, another one, one saved by 1.0.x
-- in the old shape, a guild bank and the measured bank layout, plus the map settings in the
-- account copy and the reveal's harvest, which are Map Tab's and must stay where they are.
function OldCasementAccount()
  return {
    version = "1.2.3",
    profile = {
      enabled = true, dragModifier = "ctrl", showGrips = false,
      windows = { worldmap = true, combined = true, bags = true, reagent = true, bank = true, guildbank = true },
      minimap = { shown = true, angle = 120 },
      map = { scale = 1.4, coords = true, reveal = true },
      vault = { autoBank = true, autoGuild = true, bagButtons = true, showAccountGold = true, moneyTooltip = true },
      tooltips = { enabled = true, guild = true, total = true, modifier = "alt" },
      positions = { worldmap = { x = 10, y = 20 } },
    },
    overlays = { [5] = { ["300:200:100:50"] = "111, 112" } },
    vault = {
      chars = {
        [VATIK] = { class = "WARLOCK", level = 60, name = "Vatik", realm = "Voidpact", guid = VATIK,
          bank = { time = 1000, reason = "bank closed", money = 50, items = 1, slots = 48, free = 47,
            containers = { { id = 6, label = "Bank tab 1", slots = 48, items = { { slot = 3, id = 2589, name = "Linen Cloth", count = 7, icon = 1 } } } } },
          bags = { time = 1000, reason = "logout", money = 50, items = 0, slots = 16, free = 16,
            containers = { { id = 0, label = "Backpack", slots = 16, items = {} } } } },
        [CHOHAM_GUID] = { class = "WARRIOR", level = 42, name = "Choham", realm = "Voidpact", guid = CHOHAM_GUID,
          bank = { time = 900, reason = "bank closed", money = 5500, items = 1, slots = 48, free = 47,
            containers = { { id = 6, label = "Bank tab 1", slots = 48, items = { { slot = 1, id = 2770, name = "Copper Ore", count = 20, icon = 2 } } } } } },
        ["Oldtoon - Voidpact"] = { time = 800, reason = "bank closed", money = 100, items = 1, slots = 48, free = 47, class = "MAGE", level = 30,
          containers = { { id = 6, label = "Bank tab 1", slots = 48, items = { { slot = 6, id = 2589, name = "Linen Cloth", count = 1, icon = 3 } } } } },
      },
      guilds = { ["Night Owls - Voidpact"] = { time = 1000, money = 100, tabs = { [1] = { name = "Vault 1", items = {
        { slot = 3, id = 2589, name = "Linen Cloth", count = 40, icon = 4 } } } } } },
      bankLayout = { cell = 37, pitchX = 50, pitchY = 47, originX = 48, originY = 63, cols = 8, width = 400, height = 500, slots = 48 },
    },
  }
end

-- What Casement 1.2.3 left in this character's file, the map's half included.
function OldCasementChar()
  return {
    enabled = true, dragModifier = "shift", showGrips = true,
    windows = { worldmap = false, combined = true, bags = true, reagent = false, bank = true, guildbank = false },
    minimap = { shown = false, angle = 33 },
    map = { scale = 1.7, step = 25, reveal = true, revealTint = "sepia" },
    vault = { autoBank = true, autoGuild = false, bagButtons = false, showAccountGold = false, moneyTooltip = true },
    tooltips = { enabled = true, guild = false, total = true, modifier = "shift" },
    positions = { worldmap = { x = 300, y = 200 }, bag0 = { x = 500, y = 300 }, bank = { x = 420, y = 260 }, combined = { x = 900, y = 100 } },
  }
end
`;

const driver = String.raw`
-- The globals that exist before Bank Tabs loads, so the suite can say what it added.
local GLOBALS_BEFORE = {}
for k in pairs(_G) do GLOBALS_BEFORE[k] = true end

local ns = LoadBankTabs()

-- Drags a window the way a player would: the game moves the frame, then the drag stop script runs.
local function DragTo(frame, region, x, y)
  region.scripts.OnDragStart(region)
  frame:ClearAllPoints()
  frame:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x, y)
  region.scripts.OnDragStop(region)
end

local function Overlaps(a, b)
  local al, ab, aw = ns.Windows.Measure(a)
  local bl, bb, bw = ns.Windows.Measure(b)
  if not al or not bl then return false end
  return al < bl + bw and bl < al + aw
end

-- ------------------------------------------------------------------
-- 1. Load
-- ------------------------------------------------------------------
BankTabsDB = {}
-- The account file already holds a character saved by Casement 1.0.x, in the old shape where the
-- bank record sat directly under the character's name. It has to come through the upgrade intact.
BankTabsAccountDB = { vault = { chars = {
  ["Oldtoon - Voidpact"] = { time = time() - 86400 * 3, reason = "bank closed", money = 100, items = 1, slots = 48, free = 47,
    class = "MAGE", level = 30,
    containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {
      { slot = 6, id = 2589, icon = 2689, count = 1, quality = 1, link = link(2589, "Linen Cloth"), name = "Linen Cloth" } } } } },
  -- The same character as the one logging in, saved by 1.0.2 under a name the client gave with a
  -- second word. It has to be folded into the GUID keyed entry when the next snapshot is taken.
  ["Vatik Voidpact - Voidpact"] = { class = "WARLOCK", level = 20,
    bank = { time = time() - 40000, reason = "bank closed", money = 5, items = 0, slots = 48, free = 48,
      containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {} } } } },
} } }
fire("ADDON_LOADED", "BankTabs")

check("db built", type(ns.db) == "table" and ns.db.windows ~= nil)
check("defaults filled in", ns.db.dragModifier == "alt" and ns.db.showGrips == false and ns.db.tooltips.modifier == "none")
check("vault tables built", type(ns.vault) == "table" and type(ns.vault.chars) == "table" and type(ns.vault.guilds) == "table")
check("the vault is the account file's own table", ns.vault == BankTabsAccountDB.vault)
check("the old setting that kept other characters is gone", ns.db.vault.keepOtherCharacters == nil)
check("the new defaults are in", ns.db.minimap.shown == true and ns.db.minimap.angle == 205 and ns.db.vault.bagButtons == true)
-- Two at load: the 1.0.x record and the name keyed copy of this character, which the first
-- snapshot folds in.
check("the report counts the saved characters", ns.report["vault holds"] == "2 characters, 0 guild banks", ns.report["vault holds"])
check("the bank bag slots API was found: the bank tabs on WoW Forever, the inventory slots on a classic client",
  ns.report["bank bag slots api"] == (NO_ENUM and "BankButtonIDToInvSlotID" or "bank tabs (C_Bank)"), ns.report["bank bag slots api"])
check("and the report says how the bank is laid out", ns.report["bank shape"] == (NO_ENUM and "one tab at a time" or "one grid of every bank tab"),
  ns.report["bank shape"])
check("windows module ok", ns.report["windows"] == "ok", ns.report["windows"])
check("vault module ok", ns.report["vault"] == "ok", ns.report["vault"])
check("options module ok", ns.report["options"] == "ok", ns.report["options"])
check("options category registered", ns.report["options category"] == "ok (canvas page)", ns.report["options category"])
check("category handed to the addon list", CATEGORIES[1] and CATEGORIES[1].registered == true)
for _, key in ipairs({ "windows", "vault", "about" }) do
  check("page " .. key .. " built", ns.report["page " .. key] == "ok", ns.report["page " .. key])
end
check("every event registered", ns.report["events"]:find("^%d+/%d+ registered$") ~= nil, ns.report["events"])
check("bag anchor hook taken", ns.report["bag anchor hook"] == "ok", ns.report["bag anchor hook"])
check("windows were found", (ns.report["windows found"] or ""):find("^%d+"), ns.report["windows found"])
-- No old Casement is installed, so nothing holds the window engine back until login.
check("with no old Casement installed the window engine does not wait for login", ns.holdWindows == nil
  and ns.report["window engine"] == nil, ns.report["window engine"])
-- The old Casement's /casement and /cst are only taken once login shows it is not running.
check("the old commands are not taken before login", SLASH_BANKTABS1 == "/banktabs" and SLASH_BANKTABS3 == nil and SLASH_BANKTABS4 == nil)

do -- scope: 1b. This is Bank Tabs, and only its half of Casement
check("the version is 2.1.0", ns.version == "2.1.0", ns.version)
check("the saved variables are Bank Tabs' own", ns.db == BankTabsDB and ns.vault == BankTabsAccountDB.vault
  and CasementDB == nil and CasementAccountDB == nil)
check("the event frame is Bank Tabs' own", BankTabsFrame ~= nil and CasementFrame == nil)
check("the options category is called Bank Tabs", CATEGORIES[1] and CATEGORIES[1].name == "Bank Tabs", CATEGORIES[1] and CATEGORIES[1].name)
check("there is no world map module", ns.Map == nil and ns.Reveal == nil and ns.report["world map"] == nil and ns.report["reveal"] == nil)
check("and no world map options page", ns.report["page map"] == nil)
check("the map's settings are not in the defaults", ns.db.map == nil and ns.db.windows.worldmap == nil and ns.defaults.map == nil)
local groups = {}
for _, group in ipairs(ns.Windows.GROUPS) do groups[#groups + 1] = group.key end
check("the window switches are the bag, bank and guild bank ones", table.concat(groups, ",") == "combined,bags,reagent,bank,guildbank", table.concat(groups, ","))
check("the map exploration event is not registered", ns.report["events"] == "18/18 registered", ns.report["events"])
end -- scope

-- ------------------------------------------------------------------
-- 2. The bank window: dragging it and keeping it on screen
-- ------------------------------------------------------------------
local bank = BankFrame
BankFrame:Show()
RunTimers(1)
check("the bank is movable", bank.movable == true)
check("the bank is clamped to the screen", bank.clamped == true)
check("the bank is taken out of the game's panel stack", bank.attributes and bank.attributes["UIPanelLayout-enabled"] == false)
check("and the report says so", ns.report["panel layout BankFrame"] == "taken out of the game's panel stack", ns.report["panel layout BankFrame"])

local bankGrip
for _, f in ipairs(FRAMES) do
  if f.parent == bank and f.dragButtons and f.h == 26 then bankGrip = f end
end
check("the bank got a drag strip along its top", bankGrip ~= nil)
check("the strip sits above everything in the window", bankGrip and bankGrip.level > BANK_SLOT_BUTTONS[1].level)

DragTo(bank, bankGrip, 300, 200)
check("bank position saved", ns.db.positions["bank"] ~= nil)
check("saved x is right", near(ns.db.positions["bank"].x, 300), ns.db.positions["bank"].x)
check("the bank actually sits there", near(bank:GetLeft(), 300), bank:GetLeft())

-- Off the left edge
DragTo(bank, bankGrip, -400, 200)
check("dragged off the left edge is pulled back", near(ns.db.positions["bank"].x, 0), ns.db.positions["bank"].x)
-- Off the right edge
DragTo(bank, bankGrip, 5000, 200)
check("dragged off the right edge is pulled back", near(ns.db.positions["bank"].x, SCREEN_W - 400), ns.db.positions["bank"].x)
-- Off the bottom
DragTo(bank, bankGrip, 300, -900)
check("dragged below the screen is pulled back", near(ns.db.positions["bank"].y, 0), ns.db.positions["bank"].y)
-- Off the top
DragTo(bank, bankGrip, 300, 4000)
check("dragged above the screen is pulled back", near(ns.db.positions["bank"].y, SCREEN_H - 500), ns.db.positions["bank"].y)
DragTo(bank, bankGrip, 300, 200)

-- The game hides and shows the bank again: our position has to win.
bank:Hide()
bank:ClearAllPoints()
bank:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
bank:Show()
RunTimers(1)
check("position survives the game re-placing the bank", near(bank:GetLeft(), 300), bank:GetLeft())

do -- scope: 2b. The game's panel positioning
-- The game re-anchors a panel window when it positions its panels, which can come after a size
-- change. A placed bank must be back in place the instant that finishes, with no frame drawn at
-- the game's spot.
check("the game's panel positioning was hooked", (ns.report["panel position hook"] or ""):find("UpdateUIPanelPositions") ~= nil, ns.report["panel position hook"])
DragTo(bank, bankGrip, 420, 260)
local savedX = ns.db.positions["bank"].x
check("the bank was placed", near(savedX, 420), savedX)
local before = PANEL_POSITIONINGS
UpdateUIPanelPositions(bank)
check("the game positioned the panel", PANEL_POSITIONINGS == before + 1)
check("the bank holds its place the instant the game positions it", near(ns.Windows.Measure(bank), savedX, 1), ns.Windows.Measure(bank))
RunTimers(1)
check("and a moment later", near(ns.Windows.Measure(bank), savedX, 1), ns.Windows.Measure(bank))
-- A size change, then the positioning, the order the game uses.
bank:SetSize(430, 500)
bank.scripts.OnSizeChanged(bank)
UpdateUIPanelPositions(bank)
check("a size change followed by the game's positioning leaves it in place", near(ns.Windows.Measure(bank), savedX, 1), ns.Windows.Measure(bank))
bank:SetSize(400, 500)
bank.scripts.OnSizeChanged(bank)
ShowUIPanel(bank)
check("showing it through the panel system leaves it in place too", near(ns.Windows.Measure(bank), savedX, 1), ns.Windows.Measure(bank))

-- A bank the user has never touched is still left entirely to the game.
ns.db.positions["bank"] = nil
UpdateUIPanelPositions(bank)
RunTimers(1)
check("an unplaced bank is left where the game puts it", near(ns.Windows.Measure(bank), 40, 1), ns.Windows.Measure(bank))
DragTo(bank, bankGrip, 420, 260)

-- A window the user is holding is never snapped back by the game's positioning.
bankGrip.scripts.OnDragStart(bankGrip)
bank:ClearAllPoints()
bank:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", 600, 300)
UpdateUIPanelPositions(bank)
check("the game's positioning is ignored while the bank is being dragged", near(ns.Windows.Measure(bank), 40, 1), ns.Windows.Measure(bank))
bankGrip.scripts.OnDragStop(bankGrip)
DragTo(bank, bankGrip, 420, 260)
end -- scope

do -- scope: 2c. The world map is left alone
-- Map Tab moves the world map and hooks the same panel positioning. Bank Tabs must never manage
-- the map, and nothing it does when it puts its own windows back may move the map.
local map = WorldMapFrame
map:Show()
RunTimers(1)
check("the world map is not one of Bank Tabs' windows", ns.Windows.Entry(map) == nil)
check("it was not made movable or clamped", map.movable == nil and map.clamped == nil)
local ours = 0
for _, f in ipairs(FRAMES) do if f.parent == map then ours = ours + 1 end end
check("nothing was laid on it", ours == 0, ours)
check("it is still in the game's panel stack", map.attributes == nil or map.attributes["UIPanelLayout-enabled"] == nil)
-- Map Tab puts the map somewhere; every way Bank Tabs puts its own windows back leaves it there.
map:ClearAllPoints()
map:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", 700, 300)
ns.Windows.ReapplyAll()
UpdateContainerFrameAnchors()
ShowUIPanel(bank)
fire("UI_SCALE_CHANGED")
fire("BAG_OPEN", 1)
RunTimers(1)
check("Bank Tabs putting its windows back never moves the map", near(map:GetLeft(), 700) and near(map:GetBottom(), 300), map:GetLeft())
UpdateUIPanelPositions(map)
RunTimers(1)
check("the game's positioning of the map is left to the game and Map Tab", near(map:GetLeft(), 20), map:GetLeft())
check("and no position is saved for it", ns.db.positions["worldmap"] == nil)
map:Hide()
end -- scope

do -- scope: 2d. The hover tint
-- The hover tint on a drag strip answers to the "show me where the drag strips are" switch, which
-- is off by default: a header must not light up under a passing mouse.
ns.db.showGrips = false
ns.Refresh()
local hintTex
for _, t in ipairs(TEXTURES) do
  if t.parent == bankGrip and t.color and t.color[1] == 0.35 and t.color[4] == 0.22 then hintTex = t end
end
check("a drag strip carries a hover tint", hintTex ~= nil)
bankGrip.scripts.OnEnter(bankGrip)
check("but hovering the header does not light it up by default", hintTex and hintTex.shown == false)
bankGrip.scripts.OnLeave(bankGrip)
ns.db.showGrips = true
ns.Refresh()
bankGrip.scripts.OnEnter(bankGrip)
check("it lights up once the drag areas are switched on", hintTex and hintTex.shown == true)
bankGrip.scripts.OnLeave(bankGrip)
ns.db.showGrips = false
ns.Refresh()
end -- scope

-- ------------------------------------------------------------------
-- 5. Switching a window off
-- ------------------------------------------------------------------
ns.db.windows.bank = false
ns.Refresh()
check("the strip goes away", bankGrip.shown == false)
check("the bank goes back where the game had it", near(bank:GetLeft(), 40), bank:GetLeft())
check("and back into the game's panel stack", bank.attributes["UIPanelLayout-enabled"] == true)
ns.db.windows.bank = true
ns.Refresh()
check("switching it back on restores the saved position", near(bank:GetLeft(), 420, 1), bank:GetLeft())
check("and takes it out of the panel stack again", bank.attributes["UIPanelLayout-enabled"] == false)
BankFrame:Hide()

-- ------------------------------------------------------------------
-- 6. Bag windows
-- ------------------------------------------------------------------
fire("BAG_OPEN", 1)
RunTimers(1)

local backpack = ContainerFrame1
backpack:Show()
RunTimers(0.1)
local bagGrip
for _, f in ipairs(FRAMES) do
  if f.parent == backpack and f.dragButtons and f.h == 26 then bagGrip = f end
end
check("a bag window gets a drag strip", bagGrip ~= nil)

DragTo(backpack, bagGrip, 500, 300)
check("bag position saved under its bag id", ns.db.positions["bag0"] ~= nil, ns.db.positions["bag0"])
check("bag sits where it was dropped", near(backpack:GetLeft(), 500), backpack:GetLeft())

-- The game re-stacks the bags. Ours has to go back, and it has to go back BEFORE the frame is
-- drawn: putting it off until the next tick is what made a moved bag flicker through its default
-- position on the way to the user's. Nothing is run between the game's call and this check.
UpdateContainerFrameAnchors()
check("a moved bag is put back in the same frame, with no flicker", near(backpack:GetLeft(), 500), backpack:GetLeft())
RunTimers(0.1)
check("and it is still there a frame later", near(backpack:GetLeft(), 500), backpack:GetLeft())

-- Showing a bag the game has just re-anchored must not leave it somewhere else either.
backpack:Hide()
backpack:ClearAllPoints()
backpack:SetPoint("BOTTOMRIGHT", UIParent, "BOTTOMRIGHT", -20, 100)
backpack:Show()
check("opening a moved bag puts it straight where the user left it", near(backpack:GetLeft(), 500), backpack:GetLeft())

-- Which switch governs which window
ContainerFrame7:SetID(6)
ContainerFrame6:SetID(5)
local function OptionOf(frame)
  return ns.Windows.OptionKey({ frame = frame, dynamic = true })
end
check("bag 0 belongs to the individual bags switch", OptionOf(ContainerFrame1) == "bags")
if NO_ENUM then
  -- Without Enum.BagIndex there is no way to tell a reagent bag from the first bank bag, and the
  -- classic numbering says bag 5 is a bank bag.
  check("with no enum, bag 5 counts as a bank bag", OptionOf(ContainerFrame6) == "bank", OptionOf(ContainerFrame6))
else
  check("bag 5 is the reagent bag here", OptionOf(ContainerFrame6) == "reagent", OptionOf(ContainerFrame6))
end
check("bag 6 belongs to the bank switch", OptionOf(ContainerFrame7) == "bank", OptionOf(ContainerFrame7))
check("the combined window has its own switch", OptionOf(ContainerFrameCombinedBags) == "combined")

-- Turning the individual bags off leaves the combined window alone.
ns.db.windows.bags = false
ns.Refresh()
check("switching individual bags off hides their strip", bagGrip.shown == false)
check("and puts the bag back", near(backpack:GetLeft(), SCREEN_W - 20 - 340), backpack:GetLeft())
ns.db.windows.bags = true
ns.Refresh()
check("switching them back on restores the position", near(backpack:GetLeft(), 500), backpack:GetLeft())

do -- scope: 6b. Wiring another region to drag a managed window
local handle = CreateFrame("Frame", nil, backpack)
check("any region can be wired to drag a managed window", ns.Windows.WireRegion(handle, backpack) == true and handle.dragButtons ~= nil)
check("but not one this addon does not manage", ns.Windows.WireRegion(CreateFrame("Frame", nil, UIParent), WorldMapFrame) == false)
DragTo(backpack, handle, 520, 310)
check("and dragging it moves and saves the window", near(ns.db.positions["bag0"].x, 520), ns.db.positions["bag0"].x)
DragTo(backpack, handle, 500, 300)
end -- scope

-- ------------------------------------------------------------------
-- 7. The drag anywhere modifier
-- ------------------------------------------------------------------
local overlay
for _, f in ipairs(FRAMES) do
  if f.parent == backpack and f.allPoints == backpack and f.dragButtons then overlay = f end
end
check("the backpack has a whole window drag overlay", overlay ~= nil)
check("the overlay is out of the way to begin with", overlay.shown == false)
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("holding alt brings the overlay up", overlay.shown == true)
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
check("letting go puts it away", overlay.shown == false)
ns.db.dragModifier = "none"
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("with the modifier off the overlay stays away", overlay.shown == false)
ns.db.dragModifier = "shift"
SHIFT = true
fire("MODIFIER_STATE_CHANGED", "LSHIFT", 1)
check("shift can be chosen instead", overlay.shown == true)
SHIFT = false
ALT = false
fire("MODIFIER_STATE_CHANGED", "LSHIFT", 0)
ns.db.dragModifier = "alt"

-- A window that is not on screen never gets an overlay to click on.
backpack:Hide()
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("a hidden window gets no overlay", overlay.shown == false)
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
backpack:Show()
RunTimers(0.1)

-- ------------------------------------------------------------------
-- 8. Screen size changes
-- ------------------------------------------------------------------
DragTo(backpack, bagGrip, 1500, 600)
SCREEN_W, SCREEN_H = 1024, 768
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("DISPLAY_SIZE_CHANGED")
check("a smaller screen pulls the bag back on to it", backpack:GetLeft() + 340 <= SCREEN_W + 0.5 and backpack:GetBottom() + 400 <= SCREEN_H + 0.5, backpack:GetLeft())
SCREEN_W, SCREEN_H = 1920, 1080
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("UI_SCALE_CHANGED")
DragTo(backpack, bagGrip, 500, 300)

-- ------------------------------------------------------------------
-- 9. The bank snapshot
-- ------------------------------------------------------------------
BankFrame:Show()
fire("BANKFRAME_OPENED")
RunTimers(1)

local me = ns.Who()
check("the character is keyed by GUID, which never changes", me == "Player-70-0A1B2C3D", me)
check("the name and realm are still to hand", ns.NameKey() == "Vatik - Voidpact", ns.NameKey())
-- The display name is the first name and the surname, the two values UnitName gives on this client.
check("and the entry carries them for display, surname and all", ns.Label(me) == "Vatik Voidpact - Voidpact"
  and ns.ShortLabel(me) == "Vatik Voidpact" and ns.vault.chars[me].name == "Vatik Voidpact", ns.Label(me))
-- The other shapes the client has been seen to give: the whole name as the first value, the first
-- name alone, and "Unknown" early in a session, which is no name at all.
do -- scope: the shapes of a name
  NAME_SHAPE = "whole"
  check("a name given whole is kept whole", ns.PlayerName() == "Vatik Voidpact", ns.PlayerName())
  NAME_SHAPE = "first"
  check("a first name alone is used as it is", ns.PlayerName() == "Vatik", ns.PlayerName())
  NAME_SHAPE = "unknown"
  check("Unknown is no name at all", ns.PlayerName() == nil)
  check("and the name last saved stands in", ns.ShortLabel(me) == "Vatik Voidpact", ns.ShortLabel(me))
  NAME_SHAPE = "two"
  -- The guild travels with the entry, so a guild's tab can name the characters in it.
  check("the character's guild is saved with it", ns.vault.chars[me].guild == "Night Owls - Voidpact", ns.vault.chars[me].guild)
  GUILD_LOADING = true
  ns.Vault.SnapshotBank("bank opened")
  check("a guild whose name the client has not handed over yet leaves the saved one alone", ns.vault.chars[me].guild == "Night Owls - Voidpact")
  GUILD_LOADING = false
  GUILD_NAME = ""
  ns.Vault.SnapshotBank("bank opened")
  check("a character in no guild at all loses it", ns.vault.chars[me].guild == nil)
  GUILD_NAME = "Night Owls"
  ns.Vault.SnapshotBank("bank opened")
  -- This character is named live: an entry saved by 2.0.1 kept the first name alone.
  ns.vault.chars[me].name = "Vatik"
  check("this character is named live, over a name saved without its surname", ns.ShortLabel(me) == "Vatik Voidpact", ns.ShortLabel(me))
  ns.vault.chars[me].name = "Vatik Voidpact"
end
-- The name this client gave before had a second word, which left a second entry. It has been
-- folded into this one and dropped.
check("the old name keyed entry was adopted", ns.vault.chars["Vatik Voidpact - Voidpact"] == nil)
check("and the report says so", (ns.report["legacy records adopted"] or ""):find("1 folded") ~= nil, ns.report["legacy records adopted"])
check("another character's name keyed entry is left alone", ns.vault.chars["Oldtoon - Voidpact"] ~= nil)

-- The layout measured off the real bank window.
local layout = ns.vault.chars[me].bank.layout
check("the bank's layout was measured", type(layout) == "table", ns.report["bank layout"])
check("eight columns of 37 pixel slots", layout and layout.cols == 8 and layout.cell == 37, layout and (layout.cols .. "x" .. layout.cell))
check("on the real pitch", layout and layout.pitchX == 50 and layout.pitchY == 47, layout and (layout.pitchX .. "x" .. layout.pitchY))
check("starting where the real grid starts", layout and layout.originX == 48 and layout.originY == 63)
check("the window's own size", layout and layout.width == 400 and layout.height == 500)
check("eight bag slots of 24 on a 38 pitch", layout and layout.bagCount == 8 and layout.bagCell == 24 and layout.bagPitch == 38, layout and layout.bagCount)
check("at their measured place", layout and layout.bagOriginX == 145 and layout.bagOriginY == 359)
check("the close and purchase buttons were not mistaken for slots", layout and layout.slots == 48, layout and layout.slots)

-- 2.0.0 took the topmost row of slot sized buttons for the grid's first row, so a single stray
-- button of a slot's size above the grid measured the bank one column wide, and every character's
-- saved bank was drawn as one column of items (a user saw exactly that). The grid is now the run of
-- full rows, and whatever else is that size is left out.
do -- scope: the measurement finds the grid whatever else is in the window
  local Measure = ns.Vault.MeasureBankLayout
  local function OnGrid(l)
    return l ~= nil and l.cols == 8 and l.cell == 37 and l.pitchX == 50 and l.pitchY == 47
      and l.originX == 48 and l.originY == 63 and l.slots == 48
  end
  local function Say(l)
    if not l then return tostring(ns.report["bank layout"]) end
    return l.cols .. " columns of " .. l.cell .. ", pitch " .. l.pitchX .. " by " .. l.pitchY .. " at " .. l.originX .. "," .. l.originY .. ", " .. l.slots .. " slots"
  end

  local stray = CreateFrame("Button", nil, BankFrame)
  stray:SetSize(37, 37)
  stray:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 300, -16)
  local l = Measure()
  check("a button of a slot's size above the grid no longer makes the bank one column wide", OnGrid(l), Say(l))
  check("the report says it was left out", (ns.report["bank layout"] or ""):find("1 other button of that size left out", 1, true) ~= nil,
    ns.report["bank layout"])
  stray:ClearAllPoints()
  stray:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 48 + 8 * 50, -63)
  l = Measure()
  check("nor does one in line with the first row", OnGrid(l), Say(l))
  stray:ClearAllPoints()
  stray:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 48, -(63 + 6 * 47 + 70))
  l = Measure()
  check("nor one below the grid, off its spacing", OnGrid(l), Say(l))
  stray:Hide()

  -- A hidden part of the window (an icon picker, say) holding more buttons of nearly a slot's size
  -- than the bank has slots: each says it is shown, but none of them is on screen.
  local picker = CreateFrame("Frame", nil, BankFrame)
  picker:SetSize(320, 320)
  picker:SetPoint("TOPLEFT", BankFrame, "TOPRIGHT", 40, 5)
  for i = 1, 64 do
    local b = CreateFrame("Button", nil, picker)
    b:SetSize(36, 36)
    b:SetPoint("TOPLEFT", picker, "TOPLEFT", ((i - 1) % 8) * 40, -math.floor((i - 1) / 8) * 40)
  end
  picker:Hide()
  l = Measure()
  check("buttons in a hidden part of the window are not measured", OnGrid(l), Say(l))

  -- WoW Forever makes the bank's slots only once the bank's contents have arrived, so the window
  -- can be caught with nothing in it of a slot's size but its Bag Slots (item buttons drawn at
  -- three quarters) and the sort button by the search box. 2.0.0 read those as a bank one column
  -- wide; now nothing is measured and the earlier measurement stands.
  for i = 1, 48 do BANK_SLOT_BUTTONS[i]:Hide() end
  for i = 1, 8 do _G["BankFrameBag" .. i]:Hide() end
  local small = {}
  for i = 1, 8 do
    local b = CreateFrame("ItemButton", nil, BankFrame)
    b:SetSize(37, 37)
    b:SetScale(0.75)
    b:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", (145 + (i - 1) * 37.5) / 0.75, -400 / 0.75)
    small[i] = b
  end
  local sort = CreateFrame("Button", nil, BankFrame)
  sort:SetSize(28, 26)
  sort:SetPoint("TOPRIGHT", BankFrame, "TOPRIGHT", -30, -30)
  l = Measure()
  check("a bank whose slots are not made yet is not measured", l == nil, Say(l))
  check("and the report says so", (ns.report["bank layout"] or ""):find("^not measured") ~= nil, ns.report["bank layout"])
  ns.Vault.SnapshotBank("bank opened")
  local kept = ns.vault.chars[me].bank.layout
  check("a snapshot taken then keeps the earlier measurement", OnGrid(kept), Say(kept))
  check("for the account too", OnGrid(ns.vault.bankLayout), Say(ns.vault.bankLayout))
  -- With nothing good saved either, the snapshot saves no layout rather than a bad one.
  local goodAccount = ns.vault.bankLayout
  ns.vault.chars[me].bank.layout = nil
  ns.vault.bankLayout = { cell = 37, cols = 1, rows = 7, slots = 49, pitchX = 49, pitchY = 47, originX = 300, originY = 16 }
  ns.Vault.SnapshotBank("bank opened")
  check("with nothing good saved, a snapshot then saves no layout rather than a bad one", ns.vault.chars[me].bank.layout == nil,
    Say(ns.vault.chars[me].bank.layout))
  ns.vault.bankLayout = goodAccount
  -- A page of a few slots beside the Bag Slots is no grid either, nor a block of slot sized buttons
  -- three across.
  for i = 1, 4 do BANK_SLOT_BUTTONS[i]:Show() end
  l = Measure()
  check("nor is a page of four slots", l == nil, Say(l))
  for i = 1, 4 do BANK_SLOT_BUTTONS[i]:Hide() end
  local block = {}
  for i = 1, 9 do
    local b = CreateFrame("Button", nil, BankFrame)
    b:SetSize(37, 37)
    b:SetPoint("TOPLEFT", BankFrame, "TOPLEFT", 60 + ((i - 1) % 3) * 45, -(80 + math.floor((i - 1) / 3) * 45))
    block[i] = b
  end
  l = Measure()
  check("nor three across", l == nil, Say(l))
  for i = 1, 9 do block[i]:Hide() end

  -- A layout saved one column wide by 2.0.0 claims more slots than the real grid (the stray counted
  -- as one); it must not keep a real measurement out.
  for i = 1, 8 do small[i]:Hide() end
  sort:Hide()
  for i = 1, 48 do BANK_SLOT_BUTTONS[i]:Show() end
  for i = 1, 8 do _G["BankFrameBag" .. i]:Show() end
  ns.vault.chars[me].bank.layout = { cell = 37, cols = 1, rows = 7, slots = 49, pitchX = 49, pitchY = 47, originX = 300, originY = 16,
    width = 400, height = 500 }
  ns.Vault.SnapshotBank("bank opened")
  kept = ns.vault.chars[me].bank.layout
  check("a layout saved one column wide does not keep a real measurement out", OnGrid(kept), Say(kept))
  check("which is the bank as first measured, Bag Slots and all", kept and kept.bagCount == 8 and kept.bagOriginY == 359
    and kept.width == 400 and kept.height == 500)
end
local entry = ns.vault.chars[me]
check("a character entry was made", entry ~= nil)
local record = entry and entry.bank
check("the bank record lives under .bank", record ~= nil and type(record.containers) == "table")
check("the character's class is stamped on the entry, not the record", entry and entry.class == "WARLOCK" and record and record.class == nil, entry and entry.class)
check("and the level", entry and entry.level == 60, entry and entry.level)
check("it saved the money too", record and record.money == 1234567)
check("the record says why it was taken", record and record.reason == "bank opened", record and record.reason)
check("the bags are not read just because the bank opened", entry and entry.bags == nil)

local function BucketByID(rec, id)
  for _, bucket in ipairs(rec and rec.containers or {}) do if bucket.id == id then return bucket end end
end

local labels = {}
for _, bucket in ipairs(record and record.containers or {}) do labels[#labels + 1] = bucket.label .. "=" .. bucket.id end
labels = table.concat(labels, ",")

-- What counts as the bank depends on whether this client carries Enum.BagIndex. With it, the real
-- storage is the character bank tabs and the legacy container is a ghost to be skipped; without
-- it, the classic ids are all there is to go on.
local EXPECT_ITEMS = NO_ENUM and 5 or 4
local EXPECT_FREE = NO_ENUM and ((32 - 1) + (12 - 0) + (48 - 3) + (48 - 1)) or ((48 - 3) + (16 - 1))
check("it counted every item", record and record.items == EXPECT_ITEMS, record and record.items)
check("it counted the free slots", record and record.free == EXPECT_FREE, record and record.free)

if NO_ENUM then
  check("the fallback finds the classic bank ids", #record.containers == 4, labels)
  check("the fallback names them readably", labels:find("Bank bag 1=5") ~= nil, labels)
  check("the fallback reads the legacy bank container", record.containers[1].items[1].name == "Silk Cloth",
    record.containers[1].items[1].name)
else
  check("the ghost bank container is skipped", labels:find("Bank=%-1") == nil, labels)
  check("the real bank tabs are in", #record.containers == 2, labels)
  check("tabs are named readably", record.containers[1].label == "Bank tab 1", record.containers[1].label)
  check("item names were saved", record.containers[1].items[1].name == "Linen Cloth", record.containers[1].items[1].name)
  check("item ids were saved", record.containers[1].items[1].id == 2589)
  check("stack counts were saved", record.containers[1].items[1].count == 20)
end

-- Every item is stored with the slot it sat in, which is what lets the window draw it there.
local tab6 = BucketByID(record, 6)
check("the real tab was read", tab6 ~= nil and tab6.slots == 48, labels)
check("every item keeps its slot number", tab6 and #tab6.items == 3 and tab6.items[1].slot == 1
  and tab6.items[2].slot == 4 and tab6.items[3].slot == 9, tab6 and tab6.items[3] and tab6.items[3].slot)
check("the item's icon was kept", tab6 and tab6.items[1].icon == 100 + 2589)

-- The Bag Slots row along the bottom of the bank window.
local bagSlots = record and record.bagSlots
check("the Bag Slots row was read, all eight of this client's slots", type(bagSlots) == "table" and #bagSlots == 8, bagSlots and #bagSlots)
check("it knows how many are purchased", bagSlots and bagSlots.purchased == 1, bagSlots and bagSlots.purchased)
-- On WoW Forever a Bag Slot is a bank tab: the first is tab 2, its bag read from the container
-- that holds the Bag Slots' bags. A classic client hangs it off an inventory slot.
local BAG1_ICON = NO_ENUM and INVENTORY[68].icon or (100 + 4500)
if NO_ENUM then
  check("the first bag slot hangs off the right inventory slot", bagSlots and bagSlots[1].inv == 68, bagSlots and bagSlots[1].inv)
else
  check("the first bag slot is bank tab 2", bagSlots and bagSlots.tabs == true and bagSlots[1].tab == 2, bagSlots and bagSlots[1].tab)
  check("the record says this client draws its bank as one grid", record and record.oneGrid == true)
end
check("the first bag slot is purchased and holds the bank bag", bagSlots and bagSlots[1].purchased == true
  and bagSlots[1].icon == BAG1_ICON, bagSlots and bagSlots[1].icon)
check("the bag slot names the container the bag opens as", bagSlots and bagSlots[1].id == 7, bagSlots and bagSlots[1].id)
check("and how many slots that bag has", bagSlots and bagSlots[1].slots == (NO_ENUM and 48 or 16), bagSlots and bagSlots[1].slots)
check("the bag's link was kept", bagSlots and bagSlots[1].link == INVENTORY[68].link)
check("an unbought slot is marked so", bagSlots and bagSlots[2].purchased == false, bagSlots and tostring(bagSlots[2].purchased))
check("an unbought slot holds no bag", bagSlots and bagSlots[7].id == nil and bagSlots[7].slots == 0)
check("the bank bag's items are in the record too", BucketByID(record, 7) ~= nil and #BucketByID(record, 7).items == 1)
check("the bank's page size was measured off the real window", record and record.layout and record.layout.perPage == 88,
  record and record.layout and record.layout.perPage)
if not NO_ENUM then
  -- The container holding the Bag Slots' bags is not part of the bank's contents, even with slots.
  SLOTS[-2] = 9
  local again = ns.Vault.SnapshotBank("bank opened")
  check("the container holding the Bag Slots' bags is never saved as a tab", again ~= nil and BucketByID(again, -2) == nil
    and #again.containers == 2, again and #again.containers)
  SLOTS[-2] = nil
  -- A client without bank tabs to read keeps its bank bags the classic way.
  local keep = C_Bank.FetchMaxNumBankTabs
  C_Bank.FetchMaxNumBankTabs = function() error("no bank tabs on this client") end
  check("with no bank tabs to read the classic reading takes over", ns.Vault.TabBagSlots() == nil)
  C_Bank.FetchMaxNumBankTabs = keep
end

-- A slot changing while the bank is open re-reads it, but only once the storm is over.
BANK_ITEMS[6][12] = { id = 8153, name = "Wildvine", count = 2, quality = 1 }
fire("PLAYERBANKSLOTS_CHANGED", 12)
fire("PLAYERBANKSLOTS_CHANGED", 12)
fire("PLAYERBANKSLOTS_CHANGED", 12)
check("the re-read waits for the storm to pass", ns.vault.chars[me].bank.items == EXPECT_ITEMS)
RunTimers(1)
check("a change while the bank is open is picked up", ns.vault.chars[me].bank.items == EXPECT_ITEMS + 1,
  ns.vault.chars[me].bank.items)
check("and the entry keeps its class through a re-read", ns.vault.chars[me].class == "WARLOCK")

-- The game hides the bank window before addons hear BANKFRAME_CLOSED, so the closing snapshot
-- cannot measure anything: it has to carry the earlier measurement forward, not drop it.
-- By then the client may have let go of its tab list and the bags in the Bag Slots too.
local savedTabs, savedBag = BANK_TABS_BOUGHT, BANK_ITEMS[-2]
if not NO_ENUM then BANK_TABS_BOUGHT, BANK_ITEMS[-2] = 0, nil end
BankFrame:Hide()
fire("BANKFRAME_CLOSED")
if not NO_ENUM then
  local closing = ns.vault.chars[me].bank.bagSlots
  check("a Bag Slot whose tab has slots counts as bought, with no tab list to say so", closing and closing[1].purchased == true
    and closing[1].slots == 16 and closing.purchased == 1, closing and tostring(closing[1].purchased))
  check("and keeps the bag it had when its icon cannot be read", closing and closing[1].icon == 100 + 4500
    and closing[1].link == link(4500, "Traveler's Backpack"), closing and tostring(closing[1].icon))
  check("an unbought slot stays unbought", closing and closing[2].purchased == false and closing[2].icon == nil)
  BANK_TABS_BOUGHT, BANK_ITEMS[-2] = savedTabs, savedBag
  -- Where the container read has nothing, the bag is read through its item location.
  local keepInfo = C_Container.GetContainerItemInfo
  C_Container.GetContainerItemInfo = function(bag, slot) if bag == -2 then return nil end return keepInfo(bag, slot) end
  local read = ns.Vault.TabBagSlots()
  check("the bag is read through its item location when the container read has nothing", read and read[1].icon == 100 + 4500
    and read[1].link == link(4500, "Traveler's Backpack"), read and tostring(read[1].icon))
  C_Container.GetContainerItemInfo = keepInfo
end
check("the bank is marked shut", ns.Vault.BankIsOpen() == false)
check("closing the bank takes a last snapshot", ns.vault.chars[me].bank.reason == "bank closed", ns.vault.chars[me].bank.reason)
local kept = ns.vault.chars[me].bank.layout
check("the closing snapshot keeps the measured layout", kept and kept.pitchX == 50 and kept.bagOriginY == 359, kept and kept.pitchX)
check("the measurement is kept for the account too", ns.vault.bankLayout and ns.vault.bankLayout.pitchX == 50)

-- A closed bank the client has already let go of reads as empty; that must not replace a real
-- snapshot.
local keepItems = ns.vault.chars[me].bank.items
-- Every container the scan can reach, the legacy one included (the classic fallback reads it).
local savedBank = { BANK_ITEMS[6], BANK_ITEMS[7], BANK_ITEMS[-1] }
BANK_ITEMS[6], BANK_ITEMS[7], BANK_ITEMS[-1] = {}, {}, {}
fire("BANKFRAME_OPENED")
BankFrame:Hide()
fire("BANKFRAME_CLOSED")
check("an empty read at closing does not replace the real snapshot", ns.vault.chars[me].bank.items == keepItems, ns.vault.chars[me].bank.items)
check("and the report says why", (ns.report["bank scan"] or ""):find("kept the earlier snapshot") ~= nil, ns.report["bank scan"])
BANK_ITEMS[6], BANK_ITEMS[7], BANK_ITEMS[-1] = savedBank[1], savedBank[2], savedBank[3]
RunTimers(1)
fire("PLAYERBANKSLOTS_CHANGED", 1)
RunTimers(1)
check("a change with the bank shut is ignored", ns.vault.chars[me].bank.reason == "bank closed")

-- ------------------------------------------------------------------
-- 9b. The bags snapshot
-- ------------------------------------------------------------------
fire("PLAYER_LOGIN")
check("the bags are read a moment after login, not on the spot", ns.vault.chars[me].bags == nil)

do -- scope: 9a. The Casement import on a clean install
-- No Casement anywhere: nothing is loaded, switched off or said. The flags say there was nothing
-- rather than that it was done, so a Casement folder that turns up later is still read.
check("a clean install finds no Casement", ns.report["casement addon"] == "not installed", ns.report["casement addon"])
check("and says it will look again", ns.report["casement import"] == "nothing to import: no Casement installed (looked for again at each login)",
  ns.report["casement import"])
check("the account and the character record that there was nothing", BankTabsAccountDB.importedCasement == "none"
  and BankTabsDB.importedCasement == "none", tostring(BankTabsAccountDB.importedCasement))
check("and no character is marked as imported", BankTabsAccountDB.importedChars == nil)
check("the old commands are taken now that the old Casement is known not to be running", SLASH_BANKTABS3 == "/casement"
  and SLASH_BANKTABS4 == "/cst")
check("nothing was loaded", #LOADED_BY_US == 0 and not Called("LoadAddOn Casement"))
check("nothing was switched on or off", not Called("DisableAddOn Casement") and not Called("EnableAddOn Casement"))
check("and nothing was said about Casement", ChatWith("Casement") == 0, ChatLine("Casement"))
check("the run says how it ended", ns.Import.lastRun == "nothing", ns.Import.lastRun)
end -- scope

RunTimers(4)
local bags = ns.vault.chars[me].bags
check("a bags snapshot was taken after login", bags ~= nil and bags.reason == "login", bags and bags.reason)
check("it counted every carried item", bags and bags.items == 4, bags and bags.items)
local EXPECT_BAGS = NO_ENUM and 5 or 6
check("it read every bag", bags and #bags.containers == EXPECT_BAGS, bags and #bags.containers)
check("the backpack comes first", bags and bags.containers[1].label == "Backpack" and bags.containers[1].slots == 16)
check("the other bags are named by number", bags and bags.containers[4].label == "Bag 3" and bags.containers[4].slots == 14)
if not NO_ENUM then
  check("the reagent bag is named", bags and bags.containers[6].label == "Reagent bag" and bags.containers[6].slots == 12)
end
check("items keep their slots in the bags too", bags and bags.containers[1].items[2].slot == 16 and bags.containers[4].items[1].slot == 7)
check("the bags record has its totals", bags and bags.slots == 16 + 16 + 16 + 14 + 12 + (NO_ENUM and 0 or 12) and bags.free == bags.slots - 4,
  bags and bags.slots)
check("the equipped bags were read", bags and #bags.equipped == (NO_ENUM and 4 or 5), bags and #bags.equipped)
check("the first equipped bag has its icon", bags and bags.equipped[1].icon == INVENTORY[20].icon, bags and tostring(bags.equipped[1].icon))
check("and its link and size", bags and bags.equipped[1].link == INVENTORY[20].link and bags.equipped[1].slots == 16)
check("and its container id", bags and bags.equipped[1].id == 1)
if not NO_ENUM then
  check("the reagent bag is flagged as one", bags and bags.equipped[5].reagent == true and bags.equipped[1].reagent == false)
end
check("the bags money was saved", bags and bags.money == 1234567)

-- A bag changing in play is read once things settle, not on every event.
BAG_ITEMS[1] = { [3] = { id = 2589, name = "Linen Cloth", count = 4, quality = 1 } }
fire("BAG_UPDATE_DELAYED")
fire("BAG_UPDATE_DELAYED")
fire("BAG_UPDATE_DELAYED")
check("a bag change is not read on the spot", ns.vault.chars[me].bags.items == 4)
RunTimers(4)
check("it is read once the bags settle", ns.vault.chars[me].bags.items == 5, ns.vault.chars[me].bags.items)
check("and the record says why", ns.vault.chars[me].bags.reason == "bags changed", ns.vault.chars[me].bags.reason)
check("the new item sits in its slot", ns.vault.chars[me].bags.containers[2].items[1].slot == 3)

-- Logging out reads them at once: no timer ever fires after PLAYER_LOGOUT.
BAG_ITEMS[2] = { [1] = { id = 2592, name = "Wool Cloth", count = 3, quality = 1 } }
local timersBefore = #TIMERS
fire("PLAYER_LOGOUT")
check("logging out reads the bags at once", ns.vault.chars[me].bags.items == 6, ns.vault.chars[me].bags.items)
check("without waiting on a timer", #TIMERS == timersBefore, #TIMERS - timersBefore)
check("and says so", ns.vault.chars[me].bags.reason == "logout")
check("the account copy was written at logout", BankTabsAccountDB.profile ~= nil)

-- This client empties its bag information by the time PLAYER_LOGOUT fires. The user saw another
-- character's saved bags come back empty with no gold. A read with no backpack, or a logout read
-- with fewer bag slots than the last snapshot, never replaces the good copy; a logout read of no
-- gold keeps the gold last seen; and PLAYER_MONEY keeps the saved purse current meanwhile.
do
  local good = ns.vault.chars[me].bags
  local keep = {}
  for k, v in pairs(SLOTS) do keep[k] = v end
  for k in pairs(SLOTS) do SLOTS[k] = 0 end
  fire("PLAYER_LOGOUT")
  check("a logout read with no backpack keeps the good snapshot", ns.vault.chars[me].bags == good and good.items == 6, ns.vault.chars[me].bags.items)
  check("and the report says why", (ns.report["bags scan"] or ""):find("no backpack", 1, true) ~= nil, ns.report["bags scan"])
  for k, v in pairs(keep) do SLOTS[k] = v end
  SLOTS[2] = 0
  fire("PLAYER_LOGOUT")
  check("a logout read with a bag already gone keeps it too", ns.vault.chars[me].bags == good, ns.report["bags scan"])
  check("and says so", (ns.report["bags scan"] or ""):find("fewer bag slots", 1, true) ~= nil, ns.report["bags scan"])
  SLOTS[2] = keep[2]
  local realMoney = GetMoney
  GetMoney = function() return 0 end
  fire("PLAYER_LOGOUT")
  check("a logout read of no gold keeps the gold last seen", ns.vault.chars[me].bags.money == 1234567 and ns.vault.chars[me].bags.items == 6,
    ns.vault.chars[me].bags.money)
  GetMoney = function() return 7654321 end
  fire("PLAYER_MONEY")
  check("the saved purse follows the gold as it changes", ns.vault.chars[me].bags.money == 7654321, ns.vault.chars[me].bags.money)
  GetMoney = realMoney
  fire("PLAYER_MONEY")
  check("and back", ns.vault.chars[me].bags.money == 1234567)
end

-- A character whose bags were saved empty by that logout read before this fix (the user saw
-- "Vatik's Backpack" empty and Vatik's gold as 0): a newer, empty bags record beside a good bank
-- record. Loading drops the empty record, so the gold falls back to the bank's copy. Added, loaded
-- and taken away again here so the rest of the walk keeps its three characters.
do
  local key = "Player-70-0E0E0E0E"
  ns.vault.chars[key] = { class = "WARLOCK", level = 20, name = "Emptytoon", realm = "Voidpact", guid = key,
    bank = { time = time() - 90000, reason = "bank closed", money = 39638, items = 1, slots = 48, free = 47,
      containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {
        { slot = 1, id = 2592, icon = 2, count = 3, quality = 1, link = link(2592, "Wool Cloth"), name = "Wool Cloth" } } } } },
    bags = { time = time() - 60, reason = "logout", money = 0, items = 0, slots = 0, free = 0, containers = {},
      equipped = { { id = 1, slots = 0 }, { id = 2, slots = 0 } } } }
  local goldBefore
  for _, row in ipairs(ns.Vault.Gold()) do if row.who == key then goldBefore = row.money end end
  check("before the repair, the empty logout record shows its gold as 0", goldBefore == 0, goldBefore)
  ns.Vault.Init()
  local empty = ns.vault.chars[key]
  check("an empty bags record saved at logout is dropped at load", empty ~= nil and empty.bags == nil and empty.bank ~= nil)
  check("the report counts it", ns.report["empty bag snapshots dropped"] == 1, ns.report["empty bag snapshots dropped"])
  local gold
  for _, row in ipairs(ns.Vault.Gold()) do if row.who == key then gold = row.money end end
  check("so its gold is its bank's copy, not 0", gold == 39638, gold)
  check("a good bags record is left alone", ns.vault.chars[me].bags ~= nil and ns.vault.chars[me].bags.items == 6)
  ns.vault.chars[key] = nil
  ns.report["empty bag snapshots dropped"] = nil
  ns.Vault.Changed()
end

-- ------------------------------------------------------------------
-- 9c. Records saved by Casement 1.0.x are lifted into the new shape
-- ------------------------------------------------------------------
local old = ns.vault.chars["Oldtoon - Voidpact"]
check("an old style record was lifted into .bank at load", old ~= nil and type(old.bank) == "table" and type(old.bank.containers) == "table")
check("its class came along to the entry", old and old.class == "MAGE", old and old.class)
check("the class is no longer on the bank record itself", old and old.bank and old.bank.class == nil)
check("the old item count is still there", old and old.bank and old.bank.items == 1, old and old.bank and old.bank.items)
check("the lifted entry has no containers of its own", old and old.containers == nil)
check("the old record's items kept their slots", old and old.bank and old.bank.containers[1].items[1].slot == 6)

-- A record that turns up later (another character's file merged in) is lifted the first time it
-- is asked for.
ns.vault.chars["Relic - Voidpact"] = { time = time(), items = 0, slots = 48, free = 48, class = "PRIEST", level = 12,
  containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {} } } }
local relic = ns.Vault.CharRecord("Relic - Voidpact")
check("CharRecord lifts a record it has not seen before", relic ~= nil and type(relic.bank) == "table"
  and type(relic.bank.containers) == "table" and relic.level == 12 and relic.class == "PRIEST")
check("and writes the lifted shape back to the store", ns.vault.chars["Relic - Voidpact"].bank ~= nil
  and ns.vault.chars["Relic - Voidpact"].containers == nil)
check("lifting twice changes nothing", ns.Vault.CharRecord("Relic - Voidpact") == relic)
ns.vault.chars["Relic - Voidpact"] = nil
check("CharRecord answers nil for a character never seen", ns.Vault.CharRecord("Nobody - Nowhere") == nil)
check("unless asked to make one", ns.Vault.CharRecord("Nobody - Nowhere", true) ~= nil and ns.vault.chars["Nobody - Nowhere"] ~= nil)
ns.vault.chars["Nobody - Nowhere"] = nil

-- ------------------------------------------------------------------
-- 10. The guild bank snapshot
-- ------------------------------------------------------------------
GuildBankFrame = CreateFrame("Frame", "GuildBankFrame", UIParent)
GuildBankFrame:SetSize(500, 600)
GuildBankFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 60, -80)
fire("ADDON_LOADED", "Blizzard_GuildBankUI")
GuildBankFrame:Show()
fire("GUILDBANKFRAME_OPENED")
RunTimers(5)

local GUILD_KEY = "Night Owls - Voidpact"
local guild = ns.vault.guilds[GUILD_KEY]
check("a guild bank snapshot was taken", guild ~= nil)
check("every tab was asked for", #QUERIED == 3, #QUERIED)
check("the tabs were read", guild and guild.tabs and guild.tabs[1] ~= nil)
check("tab one has its items", guild and #guild.tabs[1].items == 2, guild and #guild.tabs[1].items)
check("tab two has its items", guild and #guild.tabs[2].items == 1)
check("guild items keep their slots", guild and guild.tabs[1].items[2].slot == 7 and guild.tabs[2].items[1].slot == 3)
check("a tab this character cannot see is marked", guild and guild.tabs[3].viewable == false)
check("the tab names were saved", guild and guild.tabs[1].name == "Vault 1", guild and guild.tabs[1].name)
check("the tab icons were saved", guild and guild.tabs[1].icon == "icon1")
check("the guild money was saved", guild and guild.money == 9876543)
check("the tab the user was looking at was put back", CURRENT_TAB == 2, CURRENT_TAB)

-- A tab this character's rank cannot view comes back empty, which says nothing about what is in
-- it: what a character who could view it saved is kept, through the full walk and through a change
-- on that tab while it is on screen. Only its name and icon follow the game.
guild.tabs[3] = { tab = 3, name = "Officers", icon = "old", viewable = true,
  items = { { slot = 5, icon = 1, count = 3, id = 2589, name = "Linen Cloth" } } }
fire("GUILDBANKFRAME_OPENED")
RunTimers(5)
check("a tab this character cannot view keeps what another character saved in it", #guild.tabs[3].items == 1 and guild.tabs[3].items[1].id == 2589, #guild.tabs[3].items)
check("its name and icon still follow the game", guild.tabs[3].name == "Vault 3" and guild.tabs[3].icon == "icon3", guild.tabs[3].name)
check("and its items still count", guild.items == 4, guild.items)
CURRENT_TAB = 3
fire("GUILDBANKBAGSLOTS_CHANGED")
check("a change on that tab while it is on screen keeps them too", #guild.tabs[3].items == 1)
CURRENT_TAB = 2
check("a viewable tab is still replaced by what the game shows", #guild.tabs[1].items == 2 and #guild.tabs[2].items == 1)
-- Back to the state the rest of this walk expects: tab three seen by nobody.
guild.tabs[3] = { tab = 3, name = "Vault 3", icon = "icon3", viewable = false, items = {} }
guild.items = 3
ns.Vault.Changed()

-- The guild bank window is managed like any other window.
local guildGrip
for _, f in ipairs(FRAMES) do
  if f.parent == GuildBankFrame and f.dragButtons and f.h == 26 then guildGrip = f end
end
check("the guild bank window got a drag strip once it existed", guildGrip ~= nil)
DragTo(GuildBankFrame, guildGrip, 700, 260)
check("the guild bank position is saved", ns.db.positions["guildbank"] ~= nil)

fire("GUILDBANKFRAME_CLOSED")
GuildBankFrame:Hide()

-- ------------------------------------------------------------------
-- 11. The saved bank: a replica of the bank
-- ------------------------------------------------------------------
local CLASS_SHEET = "Interface\\Glues\\CharacterCreate\\UI-CharacterCreate-Classes"
local vault

-- The item cells the window is showing right now, in the order they were made, which is the
-- order the cell pool indexes them.
local function Cells(size)
  local out = {}
  for _, f in ipairs(FRAMES) do
    if f.kind == "Button" and f.parent == vault and f.icon and f.count and f.w == size and f.shown then out[#out + 1] = f end
  end
  return out
end
-- The plain grid (guild bank and bags), the bank grid as measured off the real window, and the
-- classic bank grid a record without a measurement falls back to.
local function GridXY(col, row) return 20 + col * 42, -(62 + row * 42) end
local function BankXY(col, row) return 48 + col * 50, -(63 + row * 47) end
local function CellAt(list, x, y)
  for _, c in ipairs(list) do
    local p = c.points[1]
    if p and p[2] == vault and p[1] == "TOPLEFT" and p[3] == "TOPLEFT" and near(p[4], x, 0.01) and near(p[5], y, 0.01) then return c end
  end
  return nil
end
local function CellWith(list, id)
  for _, c in ipairs(list) do if c.csItem and c.csItem.id == id then return c end end
  return nil
end
local function ItemCount(list)
  local n = 0
  for _, c in ipairs(list) do if c.csItem then n = n + 1 end end
  return n
end
local function TextOn(parent, text, prefix)
  for _, fs in ipairs(FONTSTRINGS) do
    if fs.parent == parent and fs.shown and type(fs.text) == "string" then
      if (prefix and fs.text:sub(1, #text) == text) or fs.text == text then return fs end
    end
  end
  return nil
end
local function CharTabs()
  local out = {}
  for _, f in ipairs(FRAMES) do
    if f.kind == "CheckButton" and f.parent == vault and f.shown then out[#out + 1] = f end
  end
  return out
end
local function SideTabs()
  local out = {}
  for _, c in ipairs(Cells(30)) do if c.csLabel then out[#out + 1] = c end end
  return out
end
-- The Bag Slots cells are the measured 24 pixels; a record without a measurement would draw them
-- at the classic 24 as well.
-- An unbought Bag Slot wears the real bank's padlock at full strength, or is dimmed where the
-- client has no padlock art.
local function Locked(cell)
  if not cell then return false end
  if cell.lock then return cell.lock.shown == true and cell:GetAlpha() == 1 end
  return cell:GetAlpha() == 0.45
end
local function BagRow()
  local out = {}
  for _, c in ipairs(Cells(24)) do if c.csLabel == nil then out[#out + 1] = c end end
  return out
end

-- The second character on this account, written the way a snapshot leaves it.
local CHOHAM = "Choham - Voidpact"
ns.vault.chars[CHOHAM] = {
  class = "WARRIOR", level = 42,
  bank = { time = time() - 7200, reason = "bank closed", money = 5500, items = 2, slots = 48, free = 46,
    containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {
      { slot = 1, id = 2770, icon = 2870, count = 20, quality = 1, link = link(2770, "Copper Ore"), name = "Copper Ore" },
      { slot = 5, id = 818, icon = 918, count = 3, quality = 1, link = link(818, "Tigerseye"), name = "Tigerseye" },
    } } },
    bagSlots = { purchased = 2,
      { inv = 68, purchased = true }, { inv = 69, purchased = true }, { inv = 70, purchased = false },
      { inv = 71, purchased = false }, { inv = 72, purchased = false }, { inv = 73, purchased = false }, { inv = 74, purchased = false } } },
  bags = { time = time() - 7200, reason = "logout", money = 5500, items = 1, slots = 16, free = 15,
    containers = { { id = 0, label = "Backpack", slots = 16, items = {
      { slot = 2, id = 6948, icon = 7048, count = 1, quality = 1, link = link(6948, "Hearthstone"), name = "Hearthstone" } } } },
    equipped = { { id = 1, icon = "Interface\\Icons\\INV_Misc_Bag_10", slots = 16, reagent = false } } },
}

-- The list of characters: this one first, then by name, and only those with the record asked for.
local list = ns.Vault.Characters("bank")
check("this character comes first in the list", list[1] and list[1].who == me and list[1].mine == true)
check("the others follow by name", list[2] and list[2].who == "Choham - Voidpact" and list[3] and list[3].who == "Oldtoon - Voidpact",
  list[2] and list[2].who)
check("only characters with bags saved are listed for bags", #ns.Vault.Characters("bags") == 2, #ns.Vault.Characters("bags"))
check("with no kind every character is listed", #ns.Vault.Characters() == 3, #ns.Vault.Characters())

local function Listed(name)
  local n = 0
  for _, v in pairs(UISpecialFrames) do if v == name then n = n + 1 end end
  return n
end

check("no saved window is built before it is first opened", BankTabsBank == nil and BankTabsBags == nil and BankTabsGuild == nil)
ns.VaultUI.Show("bank")
vault = BankTabsBank
check("the saved bank opened", vault ~= nil and vault.shown == true)
check("it wears a portrait window", (ns.report["saved bank panel"] or "") ~= "", ns.report["saved bank panel"])
check("the report calls it a replica", ns.report["saved bank window"] == "ok, replica", ns.report["saved bank window"])
check("the window is titled with the character's first name and surname: Vatik Voidpact's Bank", vault.csTitle
  and vault.csTitle.text == "Vatik Voidpact's Bank", vault.csTitle and vault.csTitle.text)
check("only the saved bank opened; the other two are not even built", ns.VaultUI.IsShown("bank") and not ns.VaultUI.IsShown("bags")
  and not ns.VaultUI.IsShown("guild") and BankTabsBags == nil and BankTabsGuild == nil)
check("looking at this character", ns.VaultUI.Selected("bank") == me, ns.VaultUI.Selected("bank"))
check("it closes on escape", Listed("BankTabsBank") == 1)

-- Without Enum the classic ids give three main containers, so the real tab has to be picked from
-- the side column first. With Enum there is one main tab and no column.
if NO_ENUM then
  local side = SideTabs()
  check("with the classic ids the bank has a side column of tabs", #side == 3, #side)
  local want
  for _, t in ipairs(side) do if t.csLabel == "Bank bag 2" then want = t end end
  check("the side column names the real tab", want ~= nil)
  check("the side tabs run down the right of the measured grid", side[1] and side[1].points[1][4] == 48 + 8 * 50 + 4
    and side[2] and side[2].points[1][5] == -(63 + 36), side[1] and (side[1].points[1][4] .. "," .. tostring(side[2] and side[2].points[1][5])))
  if want then want.scripts.OnClick(want) end
else
  check("one main tab means no side column", #SideTabs() == 0, #SideTabs())
end

-- On WoW Forever every bank tab is one grid, the bag's 16 slots after the main tab's 48, as the real
-- window lays them out; a classic client shows the one tab picked.
local GRID_CELLS = NO_ENUM and 48 or 64
local grid = Cells(37)
check("the bank is drawn slot for slot: " .. GRID_CELLS .. " cells", #grid == GRID_CELLS, #grid)
local placed = true
for i = 1, 48 do
  local x, y = BankXY((i - 1) % 8, math.floor((i - 1) / 8))
  if not CellAt(grid, x, y) then placed = false end
end
check("every cell sits where its slot index puts it, eight across", placed)
local ninth = CellAt(grid, BankXY(0, 1))
check("slot 9 is drawn in the ninth cell: second row, first column", ninth ~= nil and ninth.csItem ~= nil and ninth.csItem.id == 12359,
  ninth and ninth.csItem and ninth.csItem.name)
local first = CellAt(grid, BankXY(0, 0))
check("slot 1 is in the first cell", first and first.csItem and first.csItem.id == 2589)
local second = CellAt(grid, BankXY(1, 0))
check("slot 2 is empty: the items were not packed together", second and second.csItem == nil and second.icon.shown == false)
local fourth = CellAt(grid, BankXY(3, 0))
check("slot 4 is in the fourth cell", fourth and fourth.csItem and fourth.csItem.id == 2592)
check("the thorium is drawn once, where it sat", CellWith(grid, 12359) == ninth)
check("the wildvine picked up while the bank was open is in slot 12", CellAt(grid, BankXY(3, 1)) and CellAt(grid, BankXY(3, 1)).csItem
  and CellAt(grid, BankXY(3, 1)).csItem.id == 8153)

local emptyOK, itemOK, itemCount = true, true, 0
for _, c in ipairs(grid) do
  if c.csItem then
    itemCount = itemCount + 1
    if not c.icon.shown or c.icon.texture ~= c.csItem.icon then itemOK = false end
  elseif c.icon.shown then
    emptyOK = false
  end
end
check("every empty slot hides its icon", emptyOK)
check("every item cell shows its own icon", itemOK)
check("the grid holds exactly the saved items", itemCount == (NO_ENUM and 4 or 5), itemCount)
check("a stack shows its count", first and first.count.text == 20, first and tostring(first.count.text))
check("an empty cell shows no count", second and second.count.text == "", second and tostring(second.count.text))
-- Only uncommon and better wear the quality glow, as in the real bank: the wool (quality 2) does,
-- the linen (quality 1) and the empty slot do not.
check("an uncommon item wears the quality glow", fourth and fourth.border.shown == true)
check("a common item and an empty slot do not", first and first.border.shown == false and second.border.shown == false)
local backing
for _, t in ipairs(TEXTURES) do if t.parent == first and t.layer == "BACKGROUND" then backing = t end end
-- SetAtlas raises nothing for an atlas the client lacks, so only the atlas table can tell the
-- fallbacks to step in: a probe by pcall would leave a blank slot and no border at all.
if BARE then
  check("with no atlas the empty slot is painted", backing and backing.color ~= nil and backing.atlas == nil)
  check("and the quality border is the ring of bars", first and first.ring ~= nil and not first.borderIsGlow)
else
  check("empty slots wear the game's slot art", backing and backing.atlas == "bags-item-slot64" and backing.color == nil, backing and backing.atlas)
  check("the quality border is the game's own glow", first and first.borderIsGlow == true and first.ring == nil
    and first.border.atlas == "bags-glow-white")
end

-- A saved layout that is no grid (2.0.0 could measure a bank one column wide) is passed over for
-- the account's layout, and with that one bad too the classic bank's numbers stand in: either way
-- the bank is drawn eight across, never as one column of items.
do -- scope: the replica never draws a layout that is no grid
  local own, account = ns.vault.chars[me].bank.layout, ns.vault.bankLayout
  local ONE_COLUMN = { cell = 37, cols = 1, rows = 7, slots = 49, pitchX = 49, pitchY = 47, originX = 300, originY = 16, width = 400, height = 500 }
  local function EightAcross(pitchX)
    local cells = Cells(37)
    for i = 1, 48 do
      if not CellAt(cells, 48 + ((i - 1) % 8) * pitchX, -(63 + math.floor((i - 1) / 8) * 47)) then return false end
    end
    return #cells == GRID_CELLS
  end
  ns.vault.chars[me].bank.layout = ONE_COLUMN
  ns.VaultUI.Refresh()
  check("a saved layout one column wide is passed over for the account's", EightAcross(50))
  ns.vault.bankLayout = ONE_COLUMN
  ns.VaultUI.Refresh()
  check("with the account's no grid either, the classic bank's numbers stand in", EightAcross(49))
  ns.vault.chars[me].bank.layout, ns.vault.bankLayout = own, account
  ns.VaultUI.Refresh()
  check("and the measured layout is drawn again once it is back", EightAcross(50))
end

-- The Bag Slots row under the grid.
local bagRow = BagRow()
check("the Bag Slots row has this client's eight cells", #bagRow == 8, #bagRow)
-- The real bank grows a row's height for every row past six and keeps its Bag Slots as far from its
-- bottom edge: the one grid's eight rows put them two rows lower than the six measured.
local BAG_ROW_Y = NO_ENUM and -359 or -(359 + 2 * 47)
check("it sits where the real bank's Bag Slots sit", bagRow[1] and near(bagRow[1].points[1][4], 145) and near(bagRow[1].points[1][5], BAG_ROW_Y),
  bagRow[1] and bagRow[1].points[1][5])
check("the cells are the measured size, on the measured pitch, at the measured place", bagRow[1] and bagRow[1].w == 24
  and bagRow[1].points[1][4] == 145 and near(bagRow[1].points[1][5], BAG_ROW_Y) and bagRow[8].points[1][4] == 145 + 7 * 38)
if not NO_ENUM then
  check("the window grew two rows with the grid, as the real one does", near(vault.h, 500 + 2 * 47), vault.h)
end
check("the label says Bag Slots", TextOn(vault, "Bag Slots:") ~= nil)
check("the first bag slot shows the bank bag's icon", bagRow[1] and bagRow[1].icon.shown == true
  and bagRow[1].icon.texture == BAG1_ICON and bagRow[1]:GetAlpha() == 1 and not (bagRow[1].lock and bagRow[1].lock.shown))
local dimmed = true
for i = 2, 7 do
  if not bagRow[i] or not Locked(bagRow[i]) or bagRow[i].icon.shown or not bagRow[i].shown then dimmed = false end
  -- With the art on hand it is the padlock itself, not the dimmed stand in.
  if not BARE and not (bagRow[i] and bagRow[i].lock and bagRow[i].lock.atlas == "bankslot-icon-lock") then dimmed = false end
end
check(BARE and "the unbought slots are dimmed, not hidden" or "the unbought slots wear the real bank's padlock", dimmed)
check("the bag slot tooltips run", pcall(bagRow[1].scripts.OnEnter, bagRow[1]) and pcall(bagRow[8].scripts.OnEnter, bagRow[8]))

if NO_ENUM then
bagRow[1].scripts.OnClick(bagRow[1])
grid = Cells(37)
check("clicking the bag shows its 48 slots", #grid == 48, #grid)
local potion = CellAt(grid, BankXY(1, 0))
check("the potion sits in the bag's second slot", potion and potion.csItem and potion.csItem.id == 13446)
check("the tab's own items are gone from the grid", CellWith(grid, 2589) == nil)
check("the bag being looked at is outlined", bagRow[1].border.shown == true)
bagRow[8].scripts.OnClick(bagRow[8])
check("clicking an empty slot changes nothing", CellWith(Cells(37), 13446) ~= nil)
bagRow[1].scripts.OnClick(bagRow[1])
grid = Cells(37)
-- Back to the tab that was showing before the bag was opened, not to the first tab: the side tab
-- "Bank bag 2" (48 slots) had been clicked.
check("clicking the bag again goes back to the tab that was showing", CellWith(grid, 13446) == nil and #grid == 48, #grid)
check("and the outline goes", bagRow[1].border.shown == false)
else
-- One grid: the bag's slots are drawn after the main tab's already, its potion (its second slot) the
-- 50th cell, on the seventh row. Pointing at the bag lights its sixteen slots up, as the real bank
-- does, and clicking it changes nothing.
local potion = CellAt(grid, BankXY(1, 6))
check("the bag's slots follow the main tab's: its second slot is the 50th cell", potion and potion.csItem and potion.csItem.id == 13446)
local function LitCells(tab)
  local n = 0
  for _, c in ipairs(Cells(37)) do if c.csTab == tab and c.border.shown then n = n + 1 end end
  return n
end
bagRow[1].scripts.OnEnter(bagRow[1])
check("pointing at the bag lights up its sixteen slots", LitCells(7) == 16, LitCells(7))
check("and none of the main tab's but its quality glows", LitCells(6) == 1, LitCells(6))
local said = false
for _, l in ipairs(GameTooltip.csLines) do if l[1] == "Its 16 slots are lit up in the grid" then said = true end end
check("and its tooltip says so", said)
bagRow[1].scripts.OnLeave(bagRow[1])
check("leaving it puts them back", LitCells(7) == 0, LitCells(7))
bagRow[1].scripts.OnClick(bagRow[1])
check("clicking the bag leaves the grid as it is", #Cells(37) == 64 and CellWith(Cells(37), 2589) ~= nil and bagRow[1].border.shown == false)
bagRow[2].scripts.OnEnter(bagRow[2])
check("pointing at an unbought slot lights nothing", LitCells(7) == 0 and LitCells(6) == 1)
bagRow[2].scripts.OnLeave(bagRow[2])
end
if not NO_ENUM then
  -- More slots than a page holds: the real bank pages, 88 to a page, with a tab per page down the
  -- side. With a page of 24 the 64 slots make three pages: 24, 24 and the bag's 16.
  local layout = ns.vault.chars[me].bank.layout
  local keepPerPage = layout.perPage
  layout.perPage = 24
  ns.VaultUI.Refresh()
  local pageTabs = SideTabs()
  check("a bank larger than a page gets a tab per page down the side", #pageTabs == 3, #pageTabs)
  check("each named by its page, with the slots it holds", pageTabs[2] and pageTabs[2].csLabel == "Page 2"
    and pageTabs[2].csDetail == "Slots 25 to 48", pageTabs[2] and pageTabs[2].csDetail)
  check("wearing the real bank's page tab icons", pageTabs[1] and pageTabs[1].icon.texture == "Interface/ICONS/INV_SideTab_Bank_c60",
    pageTabs[1] and pageTabs[1].icon.texture)
  check("the first page shows its 24 slots, the first page's tab outlined", #Cells(37) == 24 and pageTabs[1].border.shown
    and not pageTabs[3].border.shown, #Cells(37))
  pageTabs[3].scripts.OnClick(pageTabs[3])
  local cells = Cells(37)
  local second = CellAt(cells, BankXY(1, 0))
  check("the last page shows the last 16 slots, the bag's", #cells == 16, #cells)
  check("its second slot first in line but one", second and second.csItem and second.csItem.id == 13446)
  check("and the last page's tab is the one outlined", pageTabs[3].border.shown and not pageTabs[1].border.shown)
  layout.perPage = keepPerPage
  ns.VaultUI.Refresh()
  check("back to one page, the side column goes and the grid is whole", #SideTabs() == 0 and #Cells(37) == 64, #Cells(37))

  -- A bank saved by 2.0.1 on this client: nothing said about its shape, and its Bag Slots read as
  -- inventory slots, every one unbought. It is drawn the way the client draws its bank now, as one
  -- grid, and its saved tab 2 shows the first Bag Slot was bought.
  local saved = ns.vault.chars[me].bank
  local old = ns.DeepCopy(saved)
  old.oneGrid = nil
  old.bagSlots = { purchased = 0 }
  for i = 1, 8 do old.bagSlots[i] = { inv = 67 + i, purchased = false, slots = 0 } end
  ns.vault.chars[me].bank = old
  ns.VaultUI.Refresh()
  local row = BagRow()
  check("a bank saved before 2.0.2 is drawn as one grid all the same", #Cells(37) == 64, #Cells(37))
  check("its first Bag Slot shows as bought, from the saved tab 2, the rest not", row[1] and not Locked(row[1]) and Locked(row[2]))
  row[1].scripts.OnEnter(row[1])
  local told = false
  for _, l in ipairs(GameTooltip.csLines) do if l[1] == "Purchased, 16 slots" then told = true end end
  check("its tooltip says how many slots its bag gave", told)
  local lit = 0
  for _, c in ipairs(Cells(37)) do if c.csTab == 7 and c.border.shown then lit = lit + 1 end end
  check("and pointing at it lights up those slots", lit == 16, lit)
  row[1].scripts.OnLeave(row[1])
  ns.vault.chars[me].bank = saved
  ns.VaultUI.Refresh()
end
if NO_ENUM then
  local want
  for _, t in ipairs(SideTabs()) do if t.csLabel == "Bank bag 2" then want = t end end
  if want then want.scripts.OnClick(want) end
end

-- The footer.
check("the money is written in the window", TextOn(vault, ns.Money(1234567)) ~= nil, ns.Money(1234567))
-- The real bank shows nothing else down there, so neither does the replica: when the snapshot was
-- taken is on the portrait's tooltip instead.
check("nothing but the money is written along the bottom", TextOn(vault, me .. ", checked", true) == nil
  and TextOn(vault, "Checked", true) == nil)
-- Without the portrait template (--bare) there is no portrait and nothing to hover.
if vault.csPortrait then
  local portraitHit
  for _, f in ipairs(FRAMES) do
    if f.parent == vault and f.allPoints == vault.csPortrait and f.scripts.OnEnter then portraitHit = f end
  end
  check("the portrait carries a tooltip", portraitHit ~= nil)
  check("and it runs", portraitHit and pcall(portraitHit.scripts.OnEnter, portraitHit))
else
  check("no portrait on this client, so no portrait tooltip", true)
end

-- Searching dims what does not match, exactly as the real bank does, rather than hiding it.
BankTabsBankSearch:SetText("wool")
BankTabsBankSearch.scripts.OnTextChanged(BankTabsBankSearch)
grid = Cells(37)
check("searching keeps every cell on screen", #grid == GRID_CELLS, #grid)
local wool = CellWith(grid, 2592)
check("the match stays bright", wool and wool:GetAlpha() == 1)
local linen = CellWith(grid, 2589)
check("a non-match is dimmed to a quarter, not hidden", linen and linen.shown and linen:GetAlpha() == 0.25, linen and linen:GetAlpha())
local dimCount = 0
for _, c in ipairs(grid) do if c.csItem and c:GetAlpha() == 0.25 then dimCount = dimCount + 1 end end
check("every other item is dimmed", dimCount == (NO_ENUM and 3 or 4), dimCount)
BankTabsBankSearch:SetText("WOOL")
BankTabsBankSearch.scripts.OnTextChanged(BankTabsBankSearch)
check("the search ignores case", CellWith(Cells(37), 2592):GetAlpha() == 1 and CellWith(Cells(37), 2589):GetAlpha() == 0.25)
BankTabsBankSearch:SetText("")
BankTabsBankSearch.scripts.OnTextChanged(BankTabsBankSearch)
local bright = true
for _, c in ipairs(Cells(37)) do if c:GetAlpha() ~= 1 then bright = false end end
check("clearing the search brightens everything", bright)
BankTabsBankSearch.scripts.OnEscapePressed(BankTabsBankSearch)

-- Shift-clicking an item drops its link into chat.
INSERTED = nil
SHIFT = true
first.scripts.OnClick(first)
SHIFT = false
check("shift-click links the item", INSERTED == first.csItem.link, INSERTED)
check("the item tooltip runs", pcall(first.scripts.OnEnter, first) and pcall(second.scripts.OnEnter, second))

-- ------------------------------------------------------------------
-- 11a. The guild bank replica: seven columns of fourteen, filled down each column
-- ------------------------------------------------------------------
ns.VaultUI.Show("guild")
vault = BankTabsGuild
check("the saved guild bank opens as a window of its own, the saved bank staying open", BankTabsGuild ~= nil and BankTabsGuild.shown == true
  and BankTabsBank.shown == true and BankTabsGuild ~= BankTabsBank)
check("it answers for the guild it shows", ns.VaultUI.Selected("guild") == "Night Owls - Voidpact", ns.VaultUI.Selected("guild"))
check("the title names the guild", vault.csTitle.text == "Guild Bank: Night Owls", vault.csTitle.text)
grid = Cells(37)
check("a guild tab is drawn as 98 cells", #grid == 98, #grid)
check("slot 1 is top left", grid[1] and grid[1].points[1][4] == 20 and grid[1].points[1][5] == -62)
check("slot 2 sits directly below slot 1", grid[2] and grid[2].points[1][4] == grid[1].points[1][4]
  and near(grid[2].points[1][5], grid[1].points[1][5] - 42), grid[2] and (grid[2].points[1][4] .. "," .. grid[2].points[1][5]))
check("slot 15 sits at the top of the second column", grid[15] and near(grid[15].points[1][4], 62) and near(grid[15].points[1][5], -62),
  grid[15] and (grid[15].points[1][4] .. "," .. grid[15].points[1][5]))
check("slot 14 is the foot of the first column", grid[14] and near(grid[14].points[1][4], 20) and near(grid[14].points[1][5], -(62 + 13 * 42)))
local vial = CellWith(grid, 3371)
check("the crystal vial in slot 1 is top left", vial ~= nil and vial == CellAt(grid, GridXY(0, 0)))
local leaf = CellWith(grid, 765)
check("the silverleaf in slot 7 is seven down the first column", leaf ~= nil and leaf == CellAt(grid, GridXY(0, 6)),
  leaf and (leaf.points[1][4] .. "," .. leaf.points[1][5]))
check("only the tab's items are drawn", ItemCount(grid) == 2, ItemCount(grid))

local side = SideTabs()
check("the guild tabs run down the right hand side", #side == 3 and near(side[1].points[1][4], 20 + 7 * 42 + 4)
  and near(side[2].points[1][5], -(62 + 36)) and near(side[3].points[1][5], -(62 + 72)), #side)
check("the tabs carry their names", side[1] and side[1].csLabel == "Vault 1" and side[3].csLabel == "Vault 3")
check("and their icons", side[1] and side[1].icon.texture == "icon1" and side[1].icon.shown)
check("the first tab is outlined as the one on show", side[1] and side[1].border.shown == true and side[2].border.shown == false)
check("a tab this character cannot see says so", side[3] and side[3].csDetail == "Not viewable by this character", side[3] and side[3].csDetail)
check("a tab that can be seen says how full it is", side[1] and side[1].csDetail == "2 items", side[1] and side[1].csDetail)
check("the guild tab tooltip runs", pcall(side[3].scripts.OnEnter, side[3]))
side[3].scripts.OnClick(side[3])
-- Nothing is known of a tab nobody who opened the guild bank could see into: a line says so, with
-- no empty slots drawn behind it (they were, and the line sat behind them).
check("looking at a tab nobody could see into says so, with no empty slots behind it", #Cells(37) == 0
  and TextOn(vault, "The character who last opened this guild bank could not see into this tab.") ~= nil, #Cells(37))
check("and it is the one outlined now", side[3].border.shown == true and side[1].border.shown == false)
side[2].scripts.OnClick(side[2])
local ruby = CellWith(Cells(37), 7910)
check("tab two shows the star ruby in slot 3, third down", ruby ~= nil and ruby == CellAt(Cells(37), GridXY(0, 2)))
check("and the line goes again", TextOn(vault, "The character who last opened this guild bank could not see into this tab.") == nil)
-- A tab per guild along the top, built and hung like the character tabs.
check("the guild bank has a tab per guild along the top, this character's guild on it", #CharTabs() == 1
  and CharTabs()[1].csWho == "Night Owls - Voidpact" and CharTabs()[1].csGuild == true, #CharTabs())
check("wearing the icon of its bank's first tab", CharTabs()[1] and CharTabs()[1].icon.texture == "icon1", CharTabs()[1] and CharTabs()[1].icon.texture)
check("chosen, as the guild on show", CharTabs()[1] and CharTabs()[1].csChosen == true)
do -- scope: several guilds on one account
  local function Said()
    local out = {}
    for _, l in ipairs(GameTooltip.csLines) do out[#out + 1] = tostring(l[1]) end
    return table.concat(out, " | ")
  end
  -- Another of the account's characters is in another guild, and saved its bank.
  ns.vault.guilds["Iron Circle - Voidpact"] = { time = time() - 3600, money = 4200, items = 1, tabs = {
    [1] = { name = "Ore", icon = "ironicon", viewable = true, items = {
      { slot = 2, id = 2770, icon = 2870, count = 10, quality = 1, link = link(2770, "Copper Ore"), name = "Copper Ore" } } } } }
  ns.vault.chars[CHOHAM].guild = "Iron Circle - Voidpact"
  ns.VaultUI.Refresh()
  local gtabs = CharTabs()
  check("each guild saved on the account gets a tab, this character's first, then by name", #gtabs == 2
    and gtabs[1].csWho == "Night Owls - Voidpact" and gtabs[2].csWho == "Iron Circle - Voidpact", #gtabs)
  check("still showing this character's guild", ns.VaultUI.Selected("guild") == "Night Owls - Voidpact"
    and gtabs[1].csChosen and not gtabs[2].csChosen)
  gtabs[2].scripts.OnEnter(gtabs[2])
  check("a guild's tab says which of the account's characters are in it", Said():find("Your character in it: Choham", 1, true) ~= nil, Said())
  check("and how full its bank was, and its gold", Said():find("Guild bank: 1 items", 1, true) ~= nil
    and Said():find("| Gold", 1, true) ~= nil, Said())
  gtabs[1].scripts.OnEnter(gtabs[1])
  check("this character is named in its own guild's", Said():find("Your character in it: Vatik Voidpact", 1, true) ~= nil, Said())
  gtabs[2].scripts.OnClick(gtabs[2])
  check("clicking a guild's tab shows its bank", ns.VaultUI.Selected("guild") == "Iron Circle - Voidpact"
    and vault.csTitle.text == "Guild Bank: Iron Circle", vault.csTitle.text)
  local ore = CellWith(Cells(37), 2770)
  check("with its items where they sat", ore ~= nil and ore == CellAt(Cells(37), GridXY(0, 1)))
  check("and its own gold", TextOn(vault, ns.Money(4200)) ~= nil)
  check("its tab chosen now, wearing its bank's first tab icon", CharTabs()[2].csChosen and not CharTabs()[1].csChosen
    and CharTabs()[2].icon.texture == "ironicon")

  -- A character whose guild bank has not been opened: its guild still comes first, asking to be
  -- opened, with no empty slots behind the line.
  GUILD_NAME = "Brand New"
  ns.VaultUI.Refresh()
  gtabs = CharTabs()
  check("a character's own guild gets the first tab before its bank is saved", #gtabs == 3 and gtabs[1].csWho == "Brand New - Voidpact", #gtabs)
  check("wearing a guild tabard until it is", gtabs[1].icon.texture == "Interface/Icons/INV_Shirt_GuildTabard_01", gtabs[1].icon.texture)
  gtabs[1].scripts.OnEnter(gtabs[1])
  check("its tab says its bank has not been opened", Said():find("Guild bank: not opened yet", 1, true) ~= nil, Said())
  gtabs[1].scripts.OnClick(gtabs[1])
  check("its bank asks to be opened", TextOn(vault, "Open the guild bank once and it will be remembered here.") ~= nil)
  check("with no empty slots drawn behind the line, and no tabs down the side", #Cells(37) == 0 and #SideTabs() == 0, #Cells(37))
  -- Opened, it showed no tabs (none bought, or none handed to this character): saved as such.
  local tabsBefore = GUILD_TABS
  GUILD_TABS = 0
  fire("GUILDBANKFRAME_OPENED")
  RunTimers(1)
  local brandNew = ns.vault.guilds["Brand New - Voidpact"]
  check("a guild bank that opened with no tabs is saved as such", brandNew ~= nil and brandNew.noTabs == true)
  ns.VaultUI.Refresh()
  check("and says so instead of asking to be opened", TextOn(vault, "This guild bank had no tabs to show when it was last opened.") ~= nil
    and TextOn(vault, "Open the guild bank once and it will be remembered here.") == nil and #Cells(37) == 0)
  -- Once it shows tabs, they replace the line.
  GUILD_TABS = tabsBefore
  fire("GUILDBANKFRAME_OPENED")
  RunTimers(3)
  check("once it shows tabs they replace the line", brandNew.noTabs == nil and brandNew.tabs[1] ~= nil)
  fire("GUILDBANKFRAME_CLOSED")
  GUILD_TABS = 0
  -- Tabs it once showed are never thrown away for a read of none.
  GUILD_NAME = "Night Owls"
  fire("GUILDBANKFRAME_OPENED")
  RunTimers(1)
  check("a read of no tabs keeps the tabs saved before", ns.vault.guilds["Night Owls - Voidpact"].noTabs == nil
    and ns.vault.guilds["Night Owls - Voidpact"].tabs[1] ~= nil)
  fire("GUILDBANKFRAME_CLOSED")
  GUILD_TABS = tabsBefore
  -- Out of any guild, the first guild bank saved by name.
  GUILD_NAME = ""
  ns.vault.guilds["Brand New - Voidpact"] = nil
  ns.VaultUI.Refresh()
  check("out of any guild, the first guild bank saved is shown by name", ns.VaultUI.Selected("guild") == "Iron Circle - Voidpact"
    and #CharTabs() == 2, ns.VaultUI.Selected("guild"))
  GUILD_NAME = "Night Owls"
  ns.VaultUI.Show("guild", "Night Owls - Voidpact")
  ns.VaultUI.Show("guild", "Iron Circle - Voidpact")
  check("Show can name the guild to look at", ns.VaultUI.Selected("guild") == "Iron Circle - Voidpact", ns.VaultUI.Selected("guild"))
  ns.vault.guilds["Iron Circle - Voidpact"] = nil
  ns.vault.chars[CHOHAM].guild = nil
  ns.VaultUI.Refresh()
  check("a guild forgotten falls back to this character's", ns.VaultUI.Selected("guild") == "Night Owls - Voidpact" and #CharTabs() == 1)
end
check("and no Bag Slots row", #BagRow() == 0 and TextOn(vault, "Bag Slots:") == nil)
check("the guild money is shown", TextOn(vault, ns.Money(9876543)) ~= nil)

-- ------------------------------------------------------------------
-- 11b. The bags replica: the combined backpack, read like a page with the short row on top
-- ------------------------------------------------------------------
ns.VaultUI.Show("bags")
vault = BankTabsBags
check("the saved bags open as a third window, the other two staying open", BankTabsBags ~= nil and BankTabsBags.shown == true
  and BankTabsBank.shown == true and BankTabsGuild.shown == true)
-- This character's bags are the real backpack in front of it, so the saved bags are the others'.
check("they open on the first other character with bags saved", ns.VaultUI.Selected("bags") == CHOHAM, ns.VaultUI.Selected("bags"))
check("titled with that character's name: Choham's Backpack", vault.csTitle.text == "Choham's Backpack", vault.csTitle.text)
check("with no tab for this character", #CharTabs() == 1 and CharTabs()[1].csWho == CHOHAM, #CharTabs())
ns.VaultUI.Show("bags", me)
check("and this character is never shown, even when asked for", ns.VaultUI.Selected("bags") == CHOHAM and vault.csTitle.text == "Choham's Backpack",
  ns.VaultUI.Selected("bags"))

-- The combined backpack's shape, on an alt carrying exactly this character's bags.
local OLDTOON = "Oldtoon - Voidpact"
ns.vault.chars[OLDTOON].bags = ns.DeepCopy(ns.vault.chars[me].bags)
ns.VaultUI.Show("bags", OLDTOON)
check("Show can name the character, and the title follows it: Oldtoon's Backpack", ns.VaultUI.Selected("bags") == OLDTOON
  and vault.csTitle.text == "Oldtoon's Backpack", vault.csTitle.text)
check("both other characters have a tab now, still not this one", #CharTabs() == 2 and CharTabs()[1].csWho == CHOHAM
  and CharTabs()[2].csWho == OLDTOON, #CharTabs())
grid = Cells(37)
local ORDINARY = 16 + 16 + 16 + 14 + 12
local EXPECT_CELLS = ORDINARY + (NO_ENUM and 0 or 12)
check("every carried slot is drawn", #grid == EXPECT_CELLS, #grid)
check("that is the sum of the bag sizes", #grid == ns.vault.chars[OLDTOON].bags.slots)
local hearth = CellWith(grid, 6948)
-- 74 slots, ten across: a short top row of four against the right edge, then seven full rows. The
-- real combined backpack starts on that short row: the user's Hearthstone, in backpack slot 1, sat
-- first in it. 2.0.1 and before drew the whole thing the other way round.
check("backpack slot 1 starts the short top row, against the right edge", hearth ~= nil and hearth == CellAt(grid, GridXY(6, 0)),
  hearth and (hearth.points[1][4] .. "," .. hearth.points[1][5]))
-- Nothing in the ordinary grid comes before it, reading like a page.
local cornerOK = true
local hx, hy = hearth and hearth.points[1][4], hearth and hearth.points[1][5]
for _, c in ipairs(grid) do
  local p = c.points[1]
  if hx and p[5] >= -(62 + 7 * 42) - 0.01 and (p[5] > hy + 0.01 or (near(p[5], hy, 0.01) and p[4] < hx - 0.01)) then cornerOK = false end
end
check("no ordinary cell comes before the backpack's first slot", cornerOK)
local water = CellWith(grid, 159)
check("backpack slot 16 is the second cell of the third row (four on the short row, ten on the next)", water ~= nil
  and water == CellAt(grid, GridXY(1, 2)), water and (water.points[1][4] .. "," .. water.points[1][5]))
local shard = CellWith(grid, 6265)
check("bag 4's last slot is the bottom right cell, the last of all", shard ~= nil and shard == CellAt(grid, GridXY(9, 7)),
  shard and (shard.points[1][4] .. "," .. shard.points[1][5]))
check("nothing sits left of the short top row", CellAt(grid, GridXY(5, 0)) == nil and CellAt(grid, GridXY(7, 0)) ~= nil)
check("the items picked up in play are drawn", CellWith(grid, 2589) ~= nil and CellWith(grid, 2592) ~= nil)
check("bags hold exactly the saved items", ItemCount(grid) == 6, ItemCount(grid))

local divider
for _, t in ipairs(TEXTURES) do if t.parent == vault and t.h == 1 and t.w and t.w > 100 then divider = t end end
if NO_ENUM then
  check("with no reagent bag there is no divider", divider == nil or divider.shown == false)
else
  check("a line divides the reagent bag from the rest", divider ~= nil and divider.shown == true
    and near(divider.points[1][5], -(62 + 8 * 42 + 6)), divider and divider.points[1] and divider.points[1][5])
  local lower, upper = 0, 0
  for _, c in ipairs(grid) do
    if near(c.points[1][5], -(62 + 9.5 * 42)) then lower = lower + 1 end
    if near(c.points[1][5], -(62 + 8.5 * 42)) then upper = upper + 1 end
  end
  check("the reagent bag has its own two rows under the line, filled from the bottom right", lower == 10 and upper == 2, lower .. "/" .. upper)
end
check("no Bag Slots row for the bags", #BagRow() == 0)
check("no side tabs for the bags", #SideTabs() == 0)
ns.vault.chars[OLDTOON].bags = nil
ns.VaultUI.Refresh()
check("a character whose bags are forgotten falls back to the first other one", ns.VaultUI.Selected("bags") == CHOHAM and #CharTabs() == 1,
  ns.VaultUI.Selected("bags"))

-- ------------------------------------------------------------------
-- 11c. The character tabs along the top
-- ------------------------------------------------------------------
ns.VaultUI.Show("bank")
vault = BankTabsBank
local ctabs = CharTabs()
check("three characters have a bank saved, so three tabs", #ctabs == 3, #ctabs)
local sized, hung = true, true
for i, t in ipairs(ctabs) do
  if t.w ~= 43 or t.h ~= 37 then sized = false end
  local p = t.points[1]
  if not (p and p[1] == "BOTTOMLEFT" and p[2] == vault and p[3] == "TOPLEFT" and near(p[4], 64 + (i - 1) * 45) and near(p[5], -8)) then hung = false end
end
check("the tabs are the spellbook's size", sized)
local sharedKind = true
for _, t in ipairs(ctabs) do if not t.csTab then sharedKind = false end end
check("and come from the shared tab builder", sharedKind)
check("they hang off the top edge of the window, in a row", hung)
check("the first is this character", ctabs[1] and ctabs[1].csWho == me, ctabs[1] and ctabs[1].csWho)
check("and is the chosen one", ctabs[1] and ctabs[1].icon:GetAlpha() == 1 and ctabs[2].icon:GetAlpha() == 0.85)
check("the second is the other character, by name", ctabs[2] ~= nil and ctabs[2].csWho == CHOHAM and ctabs[3] ~= nil and ctabs[3].csWho == "Oldtoon - Voidpact")
check("the tabs sit one level under the window", ctabs[1] and ctabs[1].level == math.max(0, vault.level - 1))
check("the class icon comes from the class sheet with that class's cell, cropped 7 percent in from each edge", ctabs[1] and ctabs[1].icon.texture == CLASS_SHEET
  and ctabs[1].icon.texCoord and near(ctabs[1].icon.texCoord[1], 0.5 + 0.0175, 0.0001) and near(ctabs[1].icon.texCoord[2], 0.75 - 0.0175, 0.0001)
  and near(ctabs[1].icon.texCoord[3], 0.25 + 0.0175, 0.0001) and near(ctabs[1].icon.texCoord[4], 0.5 - 0.0175, 0.0001),
  ctabs[1] and ctabs[1].icon.texCoord and table.concat(ctabs[1].icon.texCoord, ","))
-- The sheet draws a bevelled frame round each icon, which showed as a second border inside the
-- tab's frame (the user saw two layers of border). The crop cuts it off; the portrait keeps it.
check("so the sheet's own frame round the icon is cut off", ctabs[1] and ctabs[1].icon.texCoord and ctabs[1].icon.texCoord[1] > 0.5 and ctabs[1].icon.texCoord[2] < 0.75)
check("the warrior gets the warrior's corner of the sheet", ctabs[2] and ctabs[2].icon.texture == CLASS_SHEET and near(ctabs[2].icon.texCoord[2], 0.25 - 0.0175, 0.0001))
check("a class the sheet does not know falls back to a plain icon", ctabs[3] ~= nil and ctabs[3].icon.texture ~= CLASS_SHEET
  and (ctabs[3].icon.texture or ""):find("Interface") ~= nil, ctabs[3] and ctabs[3].icon.texture)
if BARE then
  check("with no spellbook atlas the tabs use a plain bevel", ns.report["tab art"] == "plain bevel (no spellbook atlas on this client)",
    ns.report["tab art"])
  check("and no atlas texture was made", ctabs[1].frameTex == nil)
else
  check("the tabs wear the spellbook atlas", ns.report["tab art"] == "spellbook atlas", ns.report["tab art"])
  check("the chosen tab wears the glowing frame, the rest the plain one", ctabs[1].frameTex and ctabs[1].frameTex.atlas == "spellbook-Tab-Frame-Glow-C60"
    and ctabs[2].frameTex.atlas == "spellbook-Tab-Frame-C60", ctabs[1].frameTex and ctabs[1].frameTex.atlas)
  check("the glow gradient shows only under the chosen tab", ctabs[1].glow and ctabs[1].glow.shown == true and ctabs[2].glow.shown == false)
end
check("the tab tooltip runs", ctabs[3] ~= nil and pcall(ctabs[1].scripts.OnEnter, ctabs[1]) and pcall(ctabs[3].scripts.OnEnter, ctabs[3]))

-- The class icon is clipped to the tab window's shape, so it cannot show through the frame's
-- open corners. Without the mask atlas (--bare) the icon keeps its corners and the report says so.
if BARE then
  check("with no mask atlas the tabs say so", (ns.report["tab mask"] or ""):find("none") ~= nil, ns.report["tab mask"])
else
  local tabMask = ctabs[1].icon.csMask
  check("the class icon wears the tab shaped mask", tabMask ~= nil and tabMask.atlas == "UI-HUD-ActionBar-IconFrame-Mask", tabMask and tabMask.atlas)
  check("drawn a quarter larger than the icon on every side", tabMask and tabMask.points[1] and near(tabMask.points[1][4], -0.26 * 36, 0.01)
    and near(tabMask.points[1][5], 0.26 * 36, 0.01) and tabMask.points[1][2] == ctabs[1].icon)
  local plateMask = ctabs[1].plate and ctabs[1].plate.csMask
  check("the dark plate wears the same mask as the icon, at the icon's size", plateMask ~= nil and plateMask.points[1]
    and near(plateMask.points[1][4], -0.26 * 36, 0.01) and near(plateMask.points[1][5], 0.26 * 36, 0.01) and plateMask.points[1][2] == ctabs[1].plate,
    plateMask and plateMask.points[1] and (plateMask.points[1][4] .. "," .. plateMask.points[1][5]))
  check("the report names the mask", ns.report["tab mask"] == "UI-HUD-ActionBar-IconFrame-Mask", ns.report["tab mask"])
end
check("the tab tooltip has something to say", GameTooltip ~= nil)

local played = #PLAYED
ctabs[2].scripts.OnClick(ctabs[2])
check("clicking a tab changes who is being looked at", ns.VaultUI.Selected("bank") == CHOHAM, ns.VaultUI.Selected("bank"))
check("and the title follows: Choham's Bank", vault.csTitle.text == "Choham's Bank", vault.csTitle.text)
grid = Cells(37)
check("the grid now shows that character's bank", ItemCount(grid) == 2, ItemCount(grid))
local c0, c4 = CellAt(grid, BankXY(0, 0)), CellAt(grid, BankXY(4, 0))
check("with their items where they sat", c0 and c0.csItem and c0.csItem.id == 2770 and c4 and c4.csItem and c4.csItem.id == 818)
check("the chosen tab moved", ctabs[2].icon:GetAlpha() == 1 and ctabs[1].icon:GetAlpha() == 0.85)
check("a page turned", #PLAYED == played + 1, #PLAYED - played)
check("the bag slots row follows the character", not Locked(BagRow()[2]) and BagRow()[2]:GetAlpha() == 1 and Locked(BagRow()[3]))
if not NO_ENUM then
  -- Six rows, as many as the bank was measured with: its Bag Slots and its height as measured.
  check("a six row grid keeps the Bag Slots and the height the bank was measured with", near(BagRow()[1].points[1][5], -359)
    and near(vault.h, 500), BagRow()[1].points[1][5] .. " / " .. tostring(vault.h))
end
check("the bottom edge still carries only the money", TextOn(vault, CHOHAM .. ", checked", true) == nil)
check("and shows their money", TextOn(vault, ns.Money(5500)) ~= nil)
if not BARE then
  local portrait = vault.PortraitContainer and vault.PortraitContainer.portrait
  check("the portrait shows their class rather than our face", portrait and portrait.texture == CLASS_SHEET and portrait.texCoord[2] == 0.25)
end

-- The saved bags are a window of their own: the bank's choice does not reach them.
vault = BankTabsBags
check("the saved bags keep their own character", ns.VaultUI.Selected("bags") == CHOHAM and vault.csTitle.text == "Choham's Backpack")
check("and list only the other characters with bags saved", #CharTabs() == 1 and CharTabs()[1].csWho == CHOHAM, #CharTabs())
check("with that character's grid", ItemCount(Cells(37)) == 1 and #Cells(37) == 16)
vault = BankTabsGuild
check("the guild bank keeps its own guild tab, not the bank's character", #CharTabs() == 1 and CharTabs()[1].csWho == "Night Owls - Voidpact")
vault = BankTabsBank
ns.VaultUI.Show("bank", me)
check("Show can name the character to look at", ns.VaultUI.Selected("bank") == me and vault.csTitle.text == "Vatik Voidpact's Bank")
check("and the grid is ours again", ItemCount(Cells(37)) == (NO_ENUM and 1 or 5))
if not BARE then
  local portrait = vault.PortraitContainer and vault.PortraitContainer.portrait
  check("our own face is back in the portrait", portrait and portrait.portraitOf == "player")
end
ctabs = CharTabs()
ctabs[3].scripts.OnClick(ctabs[3])
check("the old style record can be looked at", ns.VaultUI.Selected("bank") == "Oldtoon - Voidpact" and ItemCount(Cells(37)) == 1)
check("titled with the name kept in its key: Oldtoon's Bank", vault.csTitle.text == "Oldtoon's Bank", vault.csTitle.text)
check("with its item in its slot", CellAt(Cells(37), BankXY(5, 0)) and CellAt(Cells(37), BankXY(5, 0)).csItem ~= nil)
check("a record with no bag slots shows the whole row unbought", Locked(BagRow()[1]) and Locked(BagRow()[8]))

-- Forgetting the character being looked at falls back to this one.
local choham = ns.vault.chars[CHOHAM]
ctabs[2].scripts.OnClick(ctabs[2])
ns.Vault.Forget("char", CHOHAM)
check("a forgotten character falls back to this one", ns.VaultUI.Selected("bank") == me and #CharTabs() == 2, ns.VaultUI.Selected("bank"))
ns.vault.chars[CHOHAM] = choham
ns.VaultUI.Refresh()
check("and comes back when restored", #CharTabs() == 3)

do -- scope: 11c2. Three saved windows, open at once
local function HideAll() for _, kind in ipairs({ "bank", "bags", "guild" }) do ns.VaultUI.Hide(kind) end end
local function Rect(f) return ns.Windows.Measure(f) end
local function InFront() local open = ns.VaultUI.Open() return open[#open] end
local function Clear(al, aw, cl, cw) return al + aw <= cl + 0.5 or cl + cw <= al + 0.5 end
-- Drags a saved window by its title so its top left corner lands at (left, top).
local function DragWindow(f, left, top)
  f.scripts.OnDragStart(f)
  local _, _, _, h = ns.Windows.Measure(f)
  f:ClearAllPoints()
  f:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", left, top - h)
  f.scripts.OnDragStop(f)
end

HideAll()
check("closing them empties the list of open windows", #ns.VaultUI.Open() == 0 and not ns.VaultUI.IsShown("bank"))

-- A third character with bags, so the bags window has a choice to keep.
local RELIC = "Relic - Voidpact"
ns.vault.chars[RELIC] = { class = "PRIEST", level = 12, name = "Relic", realm = "Voidpact",
  bags = { time = time() - 600, reason = "logout", money = 70, items = 1, slots = 16, free = 15,
    containers = { { id = 0, label = "Backpack", slots = 16, items = {
      { slot = 1, id = 2589, icon = 2689, count = 3, quality = 1, link = link(2589, "Linen Cloth"), name = "Linen Cloth" } } } } } }
ns.VaultUI.Show("bank", OLDTOON)
ns.VaultUI.Show("bags", RELIC)
ns.VaultUI.Show("guild")
check("all three saved windows are open at once", BankTabsBank.shown and BankTabsBags.shown and BankTabsGuild.shown)
check("each on its own character", ns.VaultUI.Selected("bank") == OLDTOON and ns.VaultUI.Selected("bags") == RELIC
  and ns.VaultUI.Selected("guild") == GUILD_KEY)
check("and each title says whose it is", BankTabsBank.csTitle.text == "Oldtoon's Bank" and BankTabsBags.csTitle.text == "Relic's Backpack"
  and BankTabsGuild.csTitle.text == "Guild Bank: Night Owls")

-- A character tab on one window leaves the others alone.
vault = BankTabsBank
CharTabs()[2].scripts.OnClick(CharTabs()[2])
check("choosing a character on the bank leaves the bags where they were", ns.VaultUI.Selected("bank") == CHOHAM
  and ns.VaultUI.Selected("bags") == RELIC)
vault = BankTabsBags
CharTabs()[1].scripts.OnClick(CharTabs()[1])
check("and choosing one on the bags leaves the bank", ns.VaultUI.Selected("bags") == CHOHAM and ns.VaultUI.Selected("bank") == CHOHAM
  and BankTabsBags.csTitle.text == "Choham's Backpack")
CharTabs()[2].scripts.OnClick(CharTabs()[2])
check("the bags title follows their own choice", ns.VaultUI.Selected("bags") == RELIC and BankTabsBags.csTitle.text == "Relic's Backpack")

-- Each window has its own search.
BankTabsBankSearch:SetText("copper")
BankTabsBankSearch.scripts.OnTextChanged(BankTabsBankSearch)
vault = BankTabsBank
check("a search on the bank dims the bank", CellWith(Cells(37), 2770):GetAlpha() == 1 and CellWith(Cells(37), 818):GetAlpha() == 0.25)
vault = BankTabsBags
check("and leaves the bags bright", CellWith(Cells(37), 2589):GetAlpha() == 1)
BankTabsBagsSearch:SetText("wool")
BankTabsBagsSearch.scripts.OnTextChanged(BankTabsBagsSearch)
check("the bags search dims the bags", CellWith(Cells(37), 2589):GetAlpha() == 0.25)
-- Everything redrawn, as a snapshot would: each window still answers to its own search.
ns.VaultUI.Refresh()
check("the bags still answer to theirs after a redraw", CellWith(Cells(37), 2589):GetAlpha() == 0.25)
vault = BankTabsBank
check("and the bank keeps its own", BankTabsBankSearch:GetText() == "copper" and CellWith(Cells(37), 2770):GetAlpha() == 1
  and CellWith(Cells(37), 818):GetAlpha() == 0.25)
BankTabsBankSearch:SetText("") BankTabsBankSearch.scripts.OnTextChanged(BankTabsBankSearch)
BankTabsBagsSearch:SetText("") BankTabsBagsSearch.scripts.OnTextChanged(BankTabsBagsSearch)
ns.VaultUI.Hide("bags")
ns.VaultUI.Show("bags")
check("a window closed and opened again is still on the character it was left on", ns.VaultUI.Selected("bags") == RELIC)

-- A new snapshot redraws every window that is open.
table.insert(ns.vault.chars[CHOHAM].bank.containers[1].items,
  { slot = 10, id = 4306, icon = 4406, count = 2, quality = 1, link = link(4306, "Silk Cloth"), name = "Silk Cloth" })
table.insert(ns.vault.chars[RELIC].bags.containers[1].items,
  { slot = 2, id = 2592, icon = 2692, count = 1, quality = 1, link = link(2592, "Wool Cloth"), name = "Wool Cloth" })
ns.Vault.Changed()
vault = BankTabsBank
check("a new snapshot redraws the open bank", CellWith(Cells(37), 4306) ~= nil)
vault = BankTabsBags
check("and the open bags with it", CellWith(Cells(37), 2592) ~= nil)
table.remove(ns.vault.chars[CHOHAM].bank.containers[1].items)

-- Escape closes the one opened last first, as the game does with its own panels.
HideAll()
ns.VaultUI.Show("bank")
ns.VaultUI.Show("guild")
ns.VaultUI.Show("bags")
check("one entry names the saved window in front for Escape", Listed("BankTabsBags") == 1
  and Listed("BankTabsBank") + Listed("BankTabsGuild") == 0)
check("and the report says which are open and which goes first", (ns.report["saved windows"] or ""):find("^open: bank, guild, bags; Escape closes bags first") ~= nil,
  ns.report["saved windows"])
CloseSpecialWindows()
check("Escape closes the one opened last first", not BankTabsBags.shown and BankTabsGuild.shown and BankTabsBank.shown)
CloseSpecialWindows()
check("then the one before it", not BankTabsGuild.shown and BankTabsBank.shown)
CloseSpecialWindows()
check("then the first", not BankTabsBank.shown)
check("after which the report says none are open", ns.report["saved windows"] == "none open", ns.report["saved windows"])
ns.VaultUI.Show("bank")
ns.VaultUI.Show("guild")
ns.VaultUI.Show("bags")
ns.VaultUI.Show("bank")
check("opening a window that is already open brings it to the front instead of closing it", BankTabsBank.shown and InFront() == "bank")
CloseSpecialWindows()
check("so Escape closes it first", not BankTabsBank.shown and BankTabsBags.shown and BankTabsGuild.shown)
ns.VaultUI.Toggle("guild")
check("a toggle brings forward a window open behind another", BankTabsGuild.shown and InFront() == "guild")
ns.VaultUI.Toggle("guild")
check("and closes it once it is in front", not BankTabsGuild.shown and BankTabsBags.shown)
ns.VaultUI.Show("bank")
BankTabsBags.scripts.OnMouseDown(BankTabsBags)
check("clicking a window brings it to the front", InFront() == "bags")
ns.VaultUI.Toggle("bags")
check("so its toggle closes it", not BankTabsBags.shown and BankTabsBank.shown)

-- Where they open, and where they are left.
HideAll()
ns.db.positions.savedBank, ns.db.positions.savedBags, ns.db.positions.savedGuild = nil, nil, nil
ns.VaultUI.Show("bank", me)
local bl, bb, bw, bh = Rect(BankTabsBank)
check("until moved, the bank opens where the single window did, in the middle of the screen", near(bl + bw / 2, SCREEN_W / 2)
  and near(bb + bh / 2, SCREEN_H / 2), bl .. "," .. bb)
ns.VaultUI.Show("bags")
local gl, gb, gw, gh = Rect(BankTabsBags)
check("the bags open beside the bank, tops level", near(gl, bl + bw + 12) and near(gb + gh, bb + bh), gl .. "," .. (gb + gh))
check("opening them did not move the bank", near(Rect(BankTabsBank), bl) and near(select(2, Rect(BankTabsBank)), bb))
ns.VaultUI.Show("guild")
local ul, ub, uw, uh = Rect(BankTabsGuild)
check("the guild bank opens beside what is open, covering neither", Clear(ul, uw, bl, bw) and Clear(ul, uw, gl, gw)
  and ul >= -0.5 and ul + uw <= SCREEN_W + 0.5 and near(ub + uh, bb + bh), ul)
check("and moved neither", near(Rect(BankTabsBank), bl) and near(Rect(BankTabsBags), gl))
check("a window never moved saves no place", ns.db.positions.savedBank == nil and ns.db.positions.savedBags == nil
  and ns.db.positions.savedGuild == nil)
-- The whole interface hidden and shown again (the game's Alt-Z, or a cinematic): the windows stay
-- open, stay put, and keep their order, so Escape still closes the one brought forward last. The
-- game fires OnHide on each while it still counts as shown, then OnShow in an order of its own.
ns.VaultUI.Show("bank")
local orderBefore = table.concat(ns.VaultUI.Open(), ",")
for _, f in ipairs({ BankTabsBank, BankTabsBags, BankTabsGuild }) do f.scripts.OnHide(f) end
check("hidden with the interface they still count as open", table.concat(ns.VaultUI.Open(), ",") == orderBefore
  and ns.VaultUI.IsShown("bank") and ns.VaultUI.IsShown("bags") and ns.VaultUI.IsShown("guild"), table.concat(ns.VaultUI.Open(), ","))
for _, f in ipairs({ BankTabsGuild, BankTabsBags, BankTabsBank }) do f.scripts.OnShow(f) end
check("coming back into view with the interface moves none of them", near(Rect(BankTabsBank), bl) and near(Rect(BankTabsBags), gl)
  and near(Rect(BankTabsGuild), ul), tostring(Rect(BankTabsGuild)))
check("or changes their order: the bank, brought forward last, is still the one Escape closes first", orderBefore == "bags,guild,bank"
  and table.concat(ns.VaultUI.Open(), ",") == orderBefore and Listed("BankTabsBank") == 1
  and Listed("BankTabsBags") + Listed("BankTabsGuild") == 0, table.concat(ns.VaultUI.Open(), ","))

DragWindow(BankTabsBags, 100, 900)
local pos = ns.db.positions.savedBags
check("dragging a saved window by its title remembers where it was left", pos and near(pos.x, 100) and near(pos.top, 900),
  pos and (pos.x .. "," .. pos.top))
check("anchored by its top, so switching characters keeps the title and tabs in place", BankTabsBags.points[1]
  and BankTabsBags.points[1][1] == "TOPLEFT" and BankTabsBags.points[1][2] == UIParent)
check("in the saved settings, mirrored account wide", BankTabsAccountDB.profile.positions.savedBags ~= nil)
check("the other windows stay put and save nothing", ns.db.positions.savedBank == nil and near(Rect(BankTabsBank), bl))
ns.VaultUI.Hide("bags")
ns.VaultUI.Show("bags")
local l2, b2, w2, h2 = Rect(BankTabsBags)
check("closed and opened again, it comes back where it was left", near(l2, 100) and near(b2 + h2, 900), l2 .. "," .. (b2 + h2))
DragWindow(BankTabsBank, 600, 700)
check("each window remembers its own place", ns.db.positions.savedBank and near(ns.db.positions.savedBank.x, 600)
  and near(ns.db.positions.savedBags.x, 100))
DragWindow(BankTabsBags, 5000, 5000)
local l3, b3, w3, h3 = Rect(BankTabsBags)
-- Held exactly as far down as its tabs need: the top of the highest tab on the screen's top edge,
-- by the rule the backpack's tabs are clamped by (not a few pixels short of it).
vault = BankTabsBags
local tabTop = 0
for _, tab in ipairs(CharTabs()) do tabTop = math.max(tabTop, tab:GetTop()) end
check("dragged off the screen it is pulled back on, its character tabs included", near(l3 + w3, SCREEN_W) and near(tabTop, SCREEN_H),
  (l3 + w3) .. "," .. tabTop)
check("the room kept for its tabs is the backpack tabs' own rule", near(b3 + h3 + ns.TabRowsHeight(1), SCREEN_H)
  and near(select(3, BankTabsBags:GetClampRectInsets()), ns.TabRowsHeight(1)), select(3, BankTabsBags:GetClampRectInsets()))
DragWindow(BankTabsBags, 100, 900)

-- Nobody else saved: the bags show a line instead of a grid.
local chohamBags = ns.vault.chars[CHOHAM].bags
ns.vault.chars[CHOHAM].bags = nil
ns.vault.chars[RELIC] = nil
ns.Vault.Changed()
vault = BankTabsBags
check("with no other character saved the bags show nobody", ns.VaultUI.Selected("bags") == nil and #CharTabs() == 0)
check("and a short line instead of a grid", TextOn(vault, "No other characters saved yet.", true) ~= nil and #Cells(37) == 0)
check("under a plain title", vault.csTitle.text == "Saved Bags", vault.csTitle.text)
ns.vault.chars[CHOHAM].bags = chohamBags
ns.Vault.Changed()
check("the grid comes back once another character is saved", ns.VaultUI.Selected("bags") == CHOHAM and #Cells(37) == 16
  and TextOn(vault, "No other characters saved yet.", true) == nil)

-- This character's bank not saved yet: its tab is still first, with a line instead of a grid.
local myEntry = ns.vault.chars[me]
local myBank = myEntry.bank
myEntry.bank = nil
ns.VaultUI.Show("bank", me)
vault = BankTabsBank
check("the saved bank lists this character first before its bank is saved", CharTabs()[1] and CharTabs()[1].csWho == me
  and #CharTabs() == 3, #CharTabs())
check("and shows a short line for it instead of an empty grid", TextOn(vault, "Visit a banker once and your bank is saved here.") ~= nil
  and #Cells(37) == 0 and #BagRow() == 0)
check("under this character's name", vault.csTitle.text == "Vatik Voidpact's Bank", vault.csTitle.text)
ns.vault.chars[me] = nil
ns.VaultUI.Refresh()
check("a character with nothing saved at all still gets its tab, its class read live", CharTabs()[1] and CharTabs()[1].csWho == me
  and CharTabs()[1].icon.texture == CLASS_SHEET and near(CharTabs()[1].icon.texCoord[2], 0.75 - 0.0175, 0.0001))
check("and its name read live for the title", vault.csTitle.text == "Vatik Voidpact's Bank", vault.csTitle.text)
ns.vault.chars[me] = myEntry
myEntry.bank = myBank
ns.Vault.Changed()
check("the grid is back once the bank is saved", #Cells(37) > 0 and TextOn(vault, "Visit a banker once", true) == nil)

-- Where a window never moved opens, in the other orders. The bags opened with the bank shut go
-- home, to the middle of the screen, where the single window of before opened. The bank opened
-- after them cannot go home without covering them, so it opens beside them, and moves nothing.
HideAll()
ns.db.positions.savedBank, ns.db.positions.savedBags, ns.db.positions.savedGuild = nil, nil, nil
ns.VaultUI.Show("bags")
local sl, sb, sw, sh = Rect(BankTabsBags)
check("the bags opened with the bank shut go to the middle of the screen", near(sl + sw / 2, SCREEN_W / 2) and near(sb + sh / 2, SCREEN_H / 2),
  sl .. "," .. sb)
ns.VaultUI.Show("bank")
local kl, kb, kw, kh = Rect(BankTabsBank)
check("the bank opened after them opens beside them, tops level, covering nothing", Clear(kl, kw, sl, sw) and near(kb + kh, sb + sh)
  and kl >= -0.5 and kl + kw <= SCREEN_W + 0.5, kl .. "," .. (kb + kh))
check("and the bags did not move", near(Rect(BankTabsBags), sl) and near(select(2, Rect(BankTabsBags)), sb))
check("neither saves a place", ns.db.positions.savedBank == nil and ns.db.positions.savedBags == nil)
-- The guild bank alone goes home too; the bags opened then open beside it, not on top of it.
HideAll()
ns.VaultUI.Show("guild")
local ql, qb, qw, qh = Rect(BankTabsGuild)
check("the guild bank opened alone goes to the middle of the screen", near(ql + qw / 2, SCREEN_W / 2) and near(qb + qh / 2, SCREEN_H / 2), ql)
ns.VaultUI.Show("bags")
local sl2, sb2, sw2, sh2 = Rect(BankTabsBags)
check("the bags opened while only the guild bank shows open beside it, covering nothing", Clear(sl2, sw2, ql, qw) and near(sb2 + sh2, qb + qh)
  and near(Rect(BankTabsGuild), ql), sl2)
-- With the guild bank moved out of the way, the bags go home as before.
HideAll()
ns.db.positions.savedGuild = { x = 0, top = qh }
ns.VaultUI.Show("guild")
ns.VaultUI.Show("bags")
local sl3, sb3, sw3, sh3 = Rect(BankTabsBags)
local gl3, gb3, gw3, gh3 = Rect(BankTabsGuild)
check("with the guild bank moved clear of the middle, the bags still go there", near(sl3 + sw3 / 2, SCREEN_W / 2)
  and near(sb3 + sh3 / 2, SCREEN_H / 2) and near(gl3, 0) and near(gb3, 0), sl3 .. "," .. sb3 .. " / " .. gl3 .. "," .. gb3)
ns.db.positions.savedGuild = nil
HideAll()
end -- scope

-- ------------------------------------------------------------------
-- 11f. The minimap button
-- ------------------------------------------------------------------
local mm = BankTabsMinimapButton
check("the minimap button was built", mm ~= nil)
check("it sits on the minimap", mm and mm.parent == Minimap)
check("it is shown by default", mm and mm.shown == true)
check("it found an icon", (ns.report["minimap icon"] or ""):find("Interface"), ns.report["minimap icon"])
check("the icon is the treasure chest, not Stockpile's bag or the map", (ns.report["minimap icon"] or ""):find("Racial_Dwarf_FindTreasure", 1, true) ~= nil
  and (ns.report["minimap icon"] or ""):find("Bag") == nil and (ns.report["minimap icon"] or ""):find("Map") == nil, ns.report["minimap icon"])

-- Dragging it round the rim. The angle must stay in degrees: running math.deg over the game's own
-- atan2, which already answers in degrees, multiplies it by about fifty seven.
local mx, my = Minimap:GetCenter()
CURSOR = { mx, my + 200 }
mm.scripts.OnDragStart(mm)
mm.scripts.OnUpdate(mm)
check("dragging straight up puts it at the top of the rim", near(ns.db.minimap.angle, 90, 1), ns.db.minimap.angle)
CURSOR = { mx - 200, my }
mm.scripts.OnUpdate(mm)
check("dragging left puts it on the left of the rim", near(ns.db.minimap.angle, 180, 1), ns.db.minimap.angle)
mm.scripts.OnDragStop(mm)
check("the angle is saved", near(BankTabsAccountDB.profile.minimap.angle, 180, 1))

for _, kind in ipairs({ "bank", "bags", "guild" }) do ns.VaultUI.Hide(kind) end
mm.scripts.OnClick(mm, "LeftButton")
check("left-click opens the saved bank", BankTabsBank.shown == true and ns.VaultUI.IsShown("bank") and not ns.VaultUI.IsShown("bags"))
mm.scripts.OnClick(mm, "LeftButton")
check("and closes it again", BankTabsBank.shown == false)
ns.VaultUI.Show("bank")
ns.VaultUI.Show("bags")
mm.scripts.OnClick(mm, "LeftButton")
check("with the saved bags in front of it, left-click brings the bank forward instead", BankTabsBank.shown == true
  and ns.VaultUI.Open()[#ns.VaultUI.Open()] == "bank")
mm.scripts.OnClick(mm, "LeftButton")
ns.VaultUI.Hide("bags")
check("and closes it from the front", BankTabsBank.shown == false)
mm.scripts.OnClick(mm, "RightButton")
local optionsPage = CATEGORIES[1] and CATEGORIES[1].frame
check("right-click opens the options", (optionsPage and optionsPage.shown == true) or (BankTabsWindow and BankTabsWindow.shown == true))
check("and not the saved bank", BankTabsBank.shown == false)
if optionsPage then optionsPage:Hide() end
SettingsPanel:Hide()
if BankTabsWindow then BankTabsWindow:Hide() end

SHIFT = true
local wasEnabled = ns.db.enabled
mm.scripts.OnClick(mm, "LeftButton")
check("shift and left-click locks everything", ns.db.enabled ~= wasEnabled)
mm.scripts.OnClick(mm, "LeftButton")
SHIFT = false
check("and unlocks it again", ns.db.enabled == wasEnabled)
check("without opening the saved bank", BankTabsBank.shown == false)

GameTooltip:SetOwner(nil)
check("the minimap tooltip runs", pcall(mm.scripts.OnEnter, mm))
local saysLeft, saysRight = false, false
for _, l in ipairs(GameTooltip.csLines) do
  if l[1] == "Left-click: the saved bank" then saysLeft = true end
  if l[1] == "Right-click: the options" then saysRight = true end
end
check("and says what each click does", saysLeft and saysRight)

ns.db.minimap.shown = false
ns.Refresh()
check("the button can be switched off", mm.shown == false)
ns.db.minimap.shown = true
ns.Refresh()

-- ------------------------------------------------------------------
-- 11d. The Bank, Bags and Guild tabs above the backpack
-- ------------------------------------------------------------------
do -- scope: 11d
for _, kind in ipairs({ "bank", "bags", "guild" }) do ns.VaultUI.Hide(kind) end
backpack:Hide()
backpack:Show()
RunTimers(0.1)

local function HeaderTabs(frame)
  local out = {}
  for _, f in ipairs(FRAMES) do
    if f.parent == frame and f.csHeaderKind then out[#out + 1] = f end
  end
  return out
end
local function Alpha(tab) return tab.icon:GetAlpha() end
local htabs = HeaderTabs(backpack)
check("the backpack has three tabs", #htabs == 3, #htabs)
check("Bank, Bags and Guild, left to right", htabs[1] ~= nil and htabs[1].csHeaderKind == "bank" and htabs[2].csHeaderKind == "bags"
  and htabs[3].csHeaderKind == "guild")
local bankTab, bagsTab, guildTab = htabs[1], htabs[2], htabs[3]
check("they are the tabs BagHeader reports for the backpack", ns.BagHeader.Tabs(backpack) ~= nil and ns.BagHeader.Tabs(backpack).bank == bankTab
  and ns.BagHeader.Tabs(backpack).guild == guildTab)
check("all three are shown", bankTab.shown and bagsTab.shown and guildTab.shown)

-- The character tabs' own kind, from the same builder.
local same = true
for _, t in ipairs(htabs) do
  if not t.csTab or t.kind ~= "CheckButton" or t.w ~= 43 or t.h ~= 37 or type(t.SetChosen) ~= "function" then same = false end
end
check("they come from the character tabs' builder, at the spellbook's 43 by 37", same)
check("with the icon in the same place, at the same size", bankTab.icon.w == 36 and bankTab.icon.h == 36
  and bankTab.icon.points[1] and bankTab.icon.points[1][1] == "TOP" and bankTab.icon.points[1][5] == -4)
-- The user saw the dark plate first stop short of the frame's window (inset 4 across, 3 down),
-- then stick out past the frame art (1 pixel in; the art sits about 2.5 pixels inside the tab).
-- The plate now has exactly the icon's size, place and mask, on both kinds of tab, so it can only
-- show through an icon's see-through parts and never past the frame.
local function PlateMatchesIcon(t)
  local p, i = t.plate, t.icon
  if not (p and i and p.points and i.points and p.points[1] and i.points[1]) then return false end
  return #p.points == 1 and p.w == i.w and p.h == i.h and p.points[1][1] == i.points[1][1]
    and p.points[1][4] == i.points[1][4] and p.points[1][5] == i.points[1][5]
end
check("the backpack tab's dark plate has exactly the icon's size and place", PlateMatchesIcon(bankTab))
check("and so does a character tab's", ctabs and ctabs[1] and PlateMatchesIcon(ctabs[1]))
check("the plate is no wider than the icon, so it stays inside the frame art", bankTab.plate.w <= bankTab.icon.w and bankTab.plate.w <= 43 - 5)
check("the icon is wider than the old 33, so its edges run under the frame art", bankTab.icon.w > 43 - 8)
if BARE then
  check("with no spellbook atlas they go without it, as the character tabs do", bankTab.frameTex == nil and bankTab.glow == nil)
else
  check("they wear the same spellbook atlas", bankTab.frameTex and bankTab.frameTex.atlas == "spellbook-Tab-Frame-C60"
    and bankTab.glow ~= nil, bankTab.frameTex and bankTab.frameTex.atlas)
  check("with the icon clipped by the same mask", bankTab.icon.csMask ~= nil and bankTab.icon.csMask.atlas == "UI-HUD-ActionBar-IconFrame-Mask")
end
check("the icons found their art", (ns.report["backpack tab icon bank"] or ""):find("Interface") ~= nil, ns.report["backpack tab icon bank"])
-- The map symbols ("Banker", "GuildBanker") have see-through parts, and the dark plate showed
-- through them, so the Bank tab looked darker than the others. All three are full colour item icons.
check("all three backpack tabs use full colour item icons, not the see-through map symbols",
  (ns.report["backpack tab icon bank"] or ""):find("^Interface.Icons.") ~= nil
  and (ns.report["backpack tab icon bags"] or ""):find("^Interface.Icons.") ~= nil
  and (ns.report["backpack tab icon guild"] or ""):find("^Interface.Icons.") ~= nil,
  tostring(ns.report["backpack tab icon bank"]) .. " / " .. tostring(ns.report["backpack tab icon guild"]))

-- Hanging off the top edge, clear of the portrait, their feet behind the border.
local function Hung(frame, tabs)
  local fl, fb, fw, fh = ns.Windows.Measure(frame)
  local top = fb + fh
  for i, t in ipairs(tabs) do
    local tl, tb, tw, th = ns.Windows.Measure(t)
    if not (near(tl, fl + 64 + (i - 1) * 45) and near(tb, top - 8) and near(tb + th, top + 29)) then return false end
  end
  return #tabs == 3
end
check("they hang off the backpack's top edge, clear of the portrait, only their feet behind the border", Hung(backpack, htabs))
check("placed exactly as the character tabs are on a saved window", bankTab.points[1][1] == "BOTTOMLEFT" and bankTab.points[1][2] == backpack
  and bankTab.points[1][3] == "TOPLEFT" and near(bagsTab.points[1][4], 64 + 45) and near(bagsTab.points[1][5], -8))
local levels = true
for _, t in ipairs(htabs) do if t.level ~= math.max(0, backpack.level - 1) then levels = false end end
check("one level under the window, so its border covers their feet", levels)
check("under the close button and the drag strip, which keep their clicks", bankTab.level < backpack.testClose.level and bankTab.level < bagGrip.level)
local cl, _, cw = ns.Windows.Measure(backpack.testClose)
local clear = true
for _, t in ipairs(htabs) do
  local tl, _, tw = ns.Windows.Measure(t)
  if not (tl + tw <= cl + 0.5 or cl + cw <= tl + 0.5) then clear = false end
end
check("and clear of the close button along the top", clear)
check("they are the backpack's own children, so they hide with it", bankTab.parent == backpack and guildTab.parent == backpack)
check("the report says where they went", (ns.report["backpack tabs"] or ""):find("ContainerFrame1", 1, true) ~= nil, ns.report["backpack tabs"])

-- They go wherever the backpack goes, in the same frame.
DragTo(backpack, bagGrip, 700, 250)
check("dragging the backpack carries them along at once", Hung(backpack, htabs) and near(ns.Windows.Measure(bankTab), 700 + 64),
  ns.Windows.Measure(bankTab))
check("and the drag strip still works with them up", near(ns.db.positions["bag0"].x, 700), ns.db.positions["bag0"].x)
UpdateContainerFrameAnchors()
check("the game re-stacking the bags leaves them on the backpack", Hung(backpack, htabs) and near(ns.Windows.Measure(bankTab), 700 + 64))

-- Kept on screen with them: the tabs stand 29 above the backpack's top edge, so a backpack
-- dragged to the top of the screen has to stop that far short of it, or they could not be reached.
local function TabTop(tabs)
  local top = -math.huge
  for _, t in ipairs(tabs) do
    local _, tb, _, th = ns.Windows.Measure(t)
    if tb + th > top then top = tb + th end
  end
  return top
end
check("while the tabs are up, the game's own clamp on the backpack takes them in", backpack.clampInsets ~= nil
  and backpack.clampInsets[3] == 29 and backpack.clampInsets[1] == 0, backpack.clampInsets and backpack.clampInsets[3])
check("and the move engine keeps that room above it", near(ns.BagHeader.Room(backpack), 29) and near(ns.Windows.TopRoom(backpack), 29))
DragTo(backpack, bagGrip, 500, 5000)
check("dragged to the top of the screen, the backpack stops with its tabs still on screen", near(TabTop(htabs), SCREEN_H)
  and Hung(backpack, htabs), TabTop(htabs) .. " / " .. SCREEN_H)
check("and that is the place it saves", near(ns.db.positions["bag0"].y, SCREEN_H - 400 - 29), ns.db.positions["bag0"].y)
UpdateContainerFrameAnchors()
RunTimers(0.1)
check("the game re-stacking the bags puts it back there, tabs on screen", near(TabTop(htabs), SCREEN_H), TabTop(htabs))
ns.db.vault.bagButtons = false
ns.Refresh()
check("with the tabs switched off the clamp is as the game had it", backpack.clampInsets[3] == 0 and ns.BagHeader.Room(backpack) == 0)
DragTo(backpack, bagGrip, 500, 5000)
check("and the backpack itself can go right up to the top", near(select(2, ns.Windows.Measure(backpack)) + 400, SCREEN_H),
  select(2, ns.Windows.Measure(backpack)))
ns.db.vault.bagButtons = true
ns.Refresh()
check("switched back on, the tabs bring it back down far enough to show them", near(TabTop(htabs), SCREEN_H) and bankTab.shown,
  TabTop(htabs))

-- A backpack too narrow for the row (a separate backpack can be about 180 wide): the tabs wrap
-- into a second row, by the rule the character tabs wrap by, rather than hang past its right edge.
backpack:SetSize(178, 260)
backpack.scripts.OnSizeChanged(backpack)
RunTimers(0.1)
local nl, nb, nw, nh = ns.Windows.Measure(backpack)
local inside = true
for _, t in ipairs(htabs) do
  local tl, _, tw = ns.Windows.Measure(t)
  if tl < nl - 0.5 or tl + tw > nl + nw + 0.5 then inside = false end
end
check("on a narrow backpack no tab hangs past either edge", inside and bankTab.shown and guildTab.shown)
local function At(tab) local l, b = ns.Windows.Measure(tab) return l - nl, b - (nb + nh) end
local bx, by = At(bankTab)
local sx, sy = At(bagsTab)
local gx, gy = At(guildTab)
check("Bank and Bags share the first row, still clear of the portrait", near(bx, 64) and near(by, -8) and near(sx, 64 + 45) and near(sy, -8),
  bx .. "," .. by .. " " .. sx .. "," .. sy)
check("and Guild wraps into the row above, over the Bank tab", near(gx, 64) and near(gy, -8 + 31), gx .. "," .. gy)
check("the clamp takes in both rows", backpack.clampInsets[3] == 60 and near(ns.BagHeader.Room(backpack), 60), backpack.clampInsets[3])
check("the report says the window is narrow", (ns.report["backpack tabs"] or ""):find("in 2 rows", 1, true) ~= nil, ns.report["backpack tabs"])
DragTo(backpack, bagGrip, 500, 5000)
check("dragged to the top, both rows stay on screen", near(TabTop(htabs), SCREEN_H), TabTop(htabs))
backpack:SetSize(340, 400)
backpack.scripts.OnSizeChanged(backpack)
DragTo(backpack, bagGrip, 500, 300)
check("back at its width they are one row again", Hung(backpack, htabs) and backpack.clampInsets[3] == 29
  and (ns.report["backpack tabs"] or ""):find("in one row", 1, true) ~= nil, ns.report["backpack tabs"])

-- Bright while there is something to open, dimmed while there is not.
check("all three are bright: a bank, another character's bags and a guild bank are saved", Alpha(bankTab) == 0.85
  and Alpha(bagsTab) == 0.85 and Alpha(guildTab) == 0.85, Alpha(bankTab) .. "/" .. Alpha(bagsTab) .. "/" .. Alpha(guildTab))
local savedGuild = ns.vault.guilds[GUILD_KEY]
ns.vault.guilds[GUILD_KEY] = nil
ns.Vault.Changed()
check("the guild tab dims with no guild bank saved", Alpha(guildTab) == 0.4, Alpha(guildTab))
check("but stays on screen", guildTab.shown == true)
check("the others stay bright", Alpha(bankTab) == 0.85 and Alpha(bagsTab) == 0.85)
ns.vault.guilds[GUILD_KEY] = savedGuild
ns.Vault.Changed()
check("and brightens once one is saved", Alpha(guildTab) == 0.85)
local chohamBags = ns.vault.chars[CHOHAM].bags
ns.vault.chars[CHOHAM].bags = nil
ns.Vault.Changed()
check("the bags tab dims when no other character has bags saved, this one's own not counting", Alpha(bagsTab) == 0.4
  and ns.vault.chars[me].bags ~= nil, Alpha(bagsTab))
ns.vault.chars[CHOHAM].bags = chohamBags
ns.Vault.Changed()
check("and brightens again", Alpha(bagsTab) == 0.85)
local banks = {}
for who, entry in pairs(ns.vault.chars) do
  if type(entry) == "table" and entry.bank then banks[who] = entry.bank end
end
for who in pairs(banks) do ns.vault.chars[who].bank = nil end
ns.Vault.Changed()
check("the bank tab dims with no bank saved at all", Alpha(bankTab) == 0.4, Alpha(bankTab))
for who, record in pairs(banks) do ns.vault.chars[who].bank = record end
ns.Vault.Changed()
check("and brightens once there is one", Alpha(bankTab) == 0.85)
check("the tab tooltips run", pcall(bankTab.scripts.OnEnter, bankTab) and pcall(bagsTab.scripts.OnEnter, bagsTab)
  and pcall(guildTab.scripts.OnEnter, guildTab))
guildTab.scripts.OnLeave(guildTab)
-- With guild banks from more than one guild saved, the Guild tab speaks for this character's and
-- counts the others.
ns.vault.guilds["Iron Circle - Voidpact"] = { time = time(), items = 0, tabs = { [1] = { name = "Ore", items = {} } } }
guildTab.scripts.OnEnter(guildTab)
local guildLines = {}
for _, l in ipairs(GameTooltip.csLines) do guildLines[#guildLines + 1] = tostring(l[1]) end
guildLines = table.concat(guildLines, " | ")
check("the Guild tab speaks for this character's guild and counts the other guild banks", guildLines:find("^Night Owls %- Voidpact: ")
  and guildLines:find("And 1 other guild bank.", 1, true) ~= nil, guildLines)
guildTab.scripts.OnLeave(guildTab)
ns.vault.guilds["Iron Circle - Voidpact"] = nil

-- Chosen while the window is open, however it closes.
local function Chosen(tab)
  if Alpha(tab) ~= 1 then return false end
  if BARE then return true end
  return tab.frameTex.atlas == "spellbook-Tab-Frame-Glow-C60" and tab.glow.shown == true
end
bankTab.scripts.OnClick(bankTab)
check("clicking the Bank tab opens the saved bank", BankTabsBank.shown == true)
check("and the tab shows it chosen, glowing", Chosen(bankTab) and not Chosen(bagsTab) and not Chosen(guildTab))
check("it never stays checked the way a plain check box would", bankTab.checked == false)
bagsTab.scripts.OnClick(bagsTab)
check("the Bags tab opens the saved bags as well", BankTabsBags.shown == true and BankTabsBank.shown == true)
check("and both tabs are chosen", Chosen(bankTab) and Chosen(bagsTab))
CloseSpecialWindows()
check("Escape closes the bags, and their tab lets go", BankTabsBags.shown == false and not Chosen(bagsTab) and Chosen(bankTab))
BankTabsBank:Hide()
check("the bank's close button (a plain hide) lets go of the Bank tab", not Chosen(bankTab) and Alpha(bankTab) == 0.85)
guildTab.scripts.OnClick(guildTab)
check("the Guild tab opens the saved guild bank, chosen", BankTabsGuild.shown == true and Chosen(guildTab))
guildTab.scripts.OnClick(guildTab)
check("clicked again with it in front, it closes it and lets go", BankTabsGuild.shown == false and not Chosen(guildTab))
SlashCmdList["BANKTABS"]("bank")
check("opened any other way, the tab still shows it", Chosen(bankTab))
ns.VaultUI.Toggle("bank")
check("and closed by a toggle, lets go", BankTabsBank.shown == false and not Chosen(bankTab))

-- The switch in the options.
ns.db.vault.bagButtons = false
ns.Refresh()
check("the tabs can be switched off", not bankTab.shown and not bagsTab.shown and not guildTab.shown)
ns.db.vault.bagButtons = true
ns.Refresh()
check("and back on", bankTab.shown and bagsTab.shown and guildTab.shown)

-- The game hands its bag frames out as it needs them: one that is showing some other bag has none.
backpack:SetID(3)
backpack:Hide()
backpack:Show()
check("a pooled frame showing some other bag hides them", not bankTab.shown and not guildTab.shown)
check("and gives the frame its own clamp back", backpack.clampInsets[3] == 0 and ns.BagHeader.Room(backpack) == 0)
backpack:SetID(0)
backpack:Hide()
backpack:Show()
RunTimers(0.1)
check("and they come back when it is the backpack again", bankTab.shown and Hung(backpack, htabs) and backpack.clampInsets[3] == 29)

-- The combined bag window is a backpack too; an ordinary bag is not.
ContainerFrameCombinedBags:Show()
RunTimers(0.1)
local combined = HeaderTabs(ContainerFrameCombinedBags)
check("the combined bag window gets the tabs too", #combined == 3 and combined[1].shown and Hung(ContainerFrameCombinedBags, combined))
local combinedGrip
for _, f in ipairs(FRAMES) do
  if f.parent == ContainerFrameCombinedBags and f.dragButtons and f.h == 26 then combinedGrip = f end
end
DragTo(ContainerFrameCombinedBags, combinedGrip, 500, 5000)
check("dragged to the top of the screen, the combined bag keeps its tabs on screen too", near(TabTop(combined), SCREEN_H)
  and Hung(ContainerFrameCombinedBags, combined), TabTop(combined))
ns.Windows.ResetGroup("combined")
ContainerFrameCombinedBags:Hide()
ContainerFrame2:Show()
RunTimers(0.1)
check("an ordinary bag does not", #HeaderTabs(ContainerFrame2) == 0)
ContainerFrame2:Hide()
end -- scope

do -- scope: 11f. Item tooltips
-- ------------------------------------------------------------------
-- 11f. Item tooltips: who has it and where
-- ------------------------------------------------------------------
check("the tooltips took the modern pipeline", ns.report["item tooltips"] == "TooltipDataProcessor", ns.report["item tooltips"])
local onItem = TOOLTIP_CALLBACKS[0]
check("a post call was registered for items", type(onItem) == "function")

local function Hover(id, name, link)
  GameTooltip:SetOwner(nil)
  GameTooltip.csTooltipStamp = nil
  GameTooltip.csItemName, GameTooltip.csItemLink = name, link
  onItem(GameTooltip, { id = id })
  return GameTooltip.csLines
end
local function LineFor(lines, left)
  for _, l in ipairs(lines) do if l[1] == left then return l end end
  return nil
end

-- Linen Cloth: 20 in this character's bank (saved), 7 carried right now (live), 40 in the guild bank.
ns.vault.guilds["Night Owls - Voidpact"] = { time = time(), money = 100, tabs = { [1] = { name = "Vault 1", items = {
  { slot = 3, id = 2589, name = "Linen Cloth", count = 40, icon = 1 } } } } }
ns.Vault.Changed()
LIVE_COUNTS[2589] = 7
local lines = Hover(2589, "Linen Cloth")
local mine = LineFor(lines, "Vatik Voidpact")
check("this character's line names them without the realm", mine ~= nil, lines[1] and (lines[1][1] .. " / " .. tostring(lines[1][2])))
check("with the saved bank count and the live bag count", mine and mine[2] == "bank 20, bags 7", mine and mine[2])
check("this character comes first, by first name and surname", lines[1] and lines[1][1] == "Vatik Voidpact")
local guildLine = LineFor(lines, "Night Owls")
check("the guild bank has its own line", guildLine and guildLine[2] == "guild bank 40", guildLine and guildLine[2])
-- The total is the sum of every other line (another saved character may hold some too).
local totalLine = LineFor(lines, "Total")
local summed = 0
for _, l in ipairs(lines) do
  if l[1] ~= "Total" then for n in tostring(l[2]):gmatch("%d+") do summed = summed + tonumber(n) end end
end
check("the account total adds it all up", totalLine and tonumber(totalLine[2]) == summed and summed >= 67, totalLine and totalLine[2])
check("nothing about characters that do not have it", LineFor(lines, "Choham") == nil)

-- An item nobody has adds nothing.
lines = Hover(999999, "Nothing")
check("an item nobody has adds no lines", #lines == 0, #lines)

-- The same hover is not written twice, but a cleared tooltip is.
local firstCount = #Hover(2589, "Linen Cloth")
onItem(GameTooltip, { id = 2589 })
check("the lines are not repeated on a second call for the same item", #GameTooltip.csLines == firstCount, #GameTooltip.csLines .. " vs " .. firstCount)
GameTooltip.scripts.OnTooltipCleared(GameTooltip)
check("clearing the tooltip lets the next hover write again", GameTooltip.csTooltipStamp == nil)

-- Only the name is known: the index falls back to it.
lines = Hover(nil, "Linen Cloth")
check("an item known only by name is still found", LineFor(lines, "Vatik Voidpact") ~= nil)

-- The switches.
ns.db.tooltips.guild = false
lines = Hover(2589, "Linen Cloth")
check("the guild bank can be left out", LineFor(lines, "Night Owls") == nil and LineFor(lines, "Vatik Voidpact") ~= nil)
ns.db.tooltips.guild = true
ns.db.tooltips.total = false
lines = Hover(2589, "Linen Cloth")
check("the total can be left out", LineFor(lines, "Total") == nil)
ns.db.tooltips.total = true
ns.db.tooltips.modifier = "shift"
SHIFT = false
lines = Hover(2589, "Linen Cloth")
check("with a key chosen, nothing shows until it is held", #lines == 0, #lines)
SHIFT = true
lines = Hover(2589, "Linen Cloth")
check("and everything shows while it is", LineFor(lines, "Vatik Voidpact") ~= nil)
SHIFT = false
ns.db.tooltips.modifier = "none"
ns.db.tooltips.enabled = false
lines = Hover(2589, "Linen Cloth")
check("the whole feature can be switched off", #lines == 0, #lines)
ns.db.tooltips.enabled = true

-- A new snapshot changes the answer on the next hover.
ns.vault.guilds["Night Owls - Voidpact"].tabs[1].items[1].count = 41
ns.Vault.Changed()
lines = Hover(2589, "Linen Cloth")
check("a changed snapshot is reflected on the next hover", LineFor(lines, "Night Owls")[2] == "guild bank 41")
ns.vault.guilds["Night Owls - Voidpact"] = nil
ns.Vault.Changed()
LIVE_COUNTS[2589] = nil

-- ------------------------------------------------------------------
-- 11g. Gold across the account
-- ------------------------------------------------------------------
local goldRows, goldTotal = ns.Vault.Gold()
check("every character with a snapshot has a gold row", #goldRows >= 2, #goldRows)
check("this character comes first and is read live", goldRows[1].who == me and goldRows[1].money == 1234567 and goldRows[1].mine == true)
local choham
for _, row in ipairs(goldRows) do if row.who == CHOHAM then choham = row end end
check("another character's gold is their last seen", choham and choham.money == 5500, choham and choham.money)
local expectedTotal = 0
for _, row in ipairs(goldRows) do expectedTotal = expectedTotal + row.money end
check("the total is the sum", goldTotal == expectedTotal and goldTotal >= 1234567 + 5500, goldTotal)

SlashCmdList["BANKTABS"]("gold")
local sawChoham, sawTotal = false, false
for i = #CHAT - 6, #CHAT do
  local line = CHAT[i] or ""
  if line:find("Choham") then sawChoham = true end
  if line:find("Total") then sawTotal = true end
end
check("/banktabs gold lists each character and the total", sawChoham and sawTotal)

ns.VaultUI.Show("bank")
vault = BankTabsBank
check("the saved bank shows the account gold in its corner", TextOn(vault, "Account ", true) ~= nil)
ns.db.vault.showAccountGold = false
ns.VaultUI.Refresh()
check("which can be switched off", TextOn(vault, "Account ", true) == nil)
ns.db.vault.showAccountGold = true
ns.VaultUI.Refresh()
if vault.csPortrait then
  local portraitHit2
  for _, f in ipairs(FRAMES) do
    if f.parent == vault and f.allPoints == vault.csPortrait and f.scripts.OnEnter then portraitHit2 = f end
  end
  GameTooltip:SetOwner(nil)
  portraitHit2.scripts.OnEnter(portraitHit2)
  check("the portrait tooltip carries the account gold", LineFor(GameTooltip.csLines, "Account") ~= nil and LineFor(GameTooltip.csLines, "Gold") ~= nil)
end
local ctabsGold = CharTabs()
GameTooltip:SetOwner(nil)
ctabsGold[2].scripts.OnEnter(ctabsGold[2])
check("a character tab tooltip carries that character's gold", LineFor(GameTooltip.csLines, "Gold") ~= nil)
check("and is headed with the name alone, as the titles are", GameTooltip.text == "Choham", GameTooltip.text)
ns.VaultUI.Hide("bank")

-- ------------------------------------------------------------------
-- 11h. Hovering the money on the game's own windows
-- ------------------------------------------------------------------
backpack:Hide()
backpack:Show()
RunTimers(0.1)
local money = ContainerFrame1.MoneyFrame
check("the backpack's money readout was hooked", money.scripts.OnEnter ~= nil and money.mouse == true)
GameTooltip:SetOwner(nil)
money.scripts.OnEnter(money)
check("hovering it lists this character's gold, marked as now", LineFor(GameTooltip.csLines, "Vatik Voidpact (now)") ~= nil)
check("and the other characters'", LineFor(GameTooltip.csLines, "Choham") ~= nil)
check("and the total", LineFor(GameTooltip.csLines, "Total") ~= nil)
check("the coin button inside takes the hover too", money.gold.scripts.OnEnter ~= nil)
money.scripts.OnLeave(money)
check("the bank's money readout was hooked as well", BankFrameMoneyFrame.scripts.OnEnter ~= nil, ns.report["money tooltip bank"])
ns.db.vault.moneyTooltip = false
GameTooltip:SetOwner(nil)
money.scripts.OnEnter(money)
check("the money tooltip can be switched off", #GameTooltip.csLines == 0, #GameTooltip.csLines)
ns.db.vault.moneyTooltip = true

-- The replica's own money too.
ns.VaultUI.Show("bank")
vault = BankTabsBank
local moneyHit
for _, f in ipairs(FRAMES) do if f.parent == vault and f.csMoneyHit then moneyHit = f end end
check("the saved bank's money carries the same tooltip", moneyHit ~= nil)
GameTooltip:SetOwner(nil)
moneyHit.scripts.OnEnter(moneyHit)
check("and it lists the account", LineFor(GameTooltip.csLines, "Total") ~= nil)
ns.VaultUI.Hide("bank")

-- ------------------------------------------------------------------
-- 11i. The drag anywhere overlay stays unseen unless asked for
-- ------------------------------------------------------------------
backpack:Show()
RunTimers(0.1)
local bagOverlay
for _, f in ipairs(FRAMES) do
  if f.parent == backpack and f.allPoints == backpack and f.dragButtons and f.tint then bagOverlay = f end
end
check("the backpack's overlay carries a tint", bagOverlay ~= nil)
ns.db.showGrips = false
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("holding alt brings the overlay up", bagOverlay.shown == true)
check("but paints nothing by default", bagOverlay.tint.alpha == 0, bagOverlay.tint.alpha)
ns.db.showGrips = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("with the drag areas switched on the tint shows", bagOverlay.tint.alpha == 1)
ns.db.showGrips = false
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
check("letting go puts it away", bagOverlay.shown == false)

end -- scope

-- ------------------------------------------------------------------
-- 12. Slash commands
-- ------------------------------------------------------------------
local slash = SlashCmdList["BANKTABS"]
check("slash command registered", type(slash) == "function")
slash("lock")
local anyOn = false
for _, on in pairs(ns.db.windows) do if on then anyOn = true end end
check("/banktabs lock turns every window off", anyOn == false)
slash("unlock")
local allOn = true
for _, on in pairs(ns.db.windows) do if not on then allOn = false end end
check("/banktabs unlock turns them all back on", allOn == true)
slash("reset")
check("/banktabs reset forgets every position", next(ns.db.positions) == nil)
slash("snapshot")
check("/banktabs snapshot saves the bags, which are always to hand", CHAT[#CHAT]:find("items in your bags") ~= nil, CHAT[#CHAT])
check("and says how many", CHAT[#CHAT]:find("saved 6 items") ~= nil, CHAT[#CHAT])
slash("debug")
slash("grips")
check("/banktabs grips toggles the outlines", ns.db.showGrips == true)
slash("grips")
slash("vault")
slash("")
slash("nonsense")
check("nothing above threw", true)

do -- scope: 12b. The names people type
check("/banktabs and /btabs are the commands", SLASH_BANKTABS1 == "/banktabs" and SLASH_BANKTABS2 == "/btabs")
check("/casement and /cst still work for old macros", SLASH_BANKTABS3 == "/casement" and SLASH_BANKTABS4 == "/cst")
check("under Bank Tabs' own key, never Casement's or Map Tab's", SlashCmdList["CASEMENT"] == nil and SlashCmdList["MAPTAB"] == nil)
local helpStart = #CHAT
slash("help")
local mentionsOld, mentionsShort = false, false
for i = helpStart + 1, #CHAT do
  if CHAT[i]:find("/casement", 1, true) or CHAT[i]:find("/cst", 1, true) then mentionsOld = true end
  if CHAT[i]:find("/btabs", 1, true) then mentionsShort = true end
end
check("the help names the short form", mentionsShort)
check("and keeps the old names quiet", mentionsOld == false)
for _, kind in ipairs({ "bank", "bags", "guild" }) do ns.VaultUI.Hide(kind) end
slash("bank")
check("/banktabs bank opens the saved bank", BankTabsBank.shown == true and not BankTabsBags.shown and not BankTabsGuild.shown)
slash("bags")
check("/banktabs bags opens the saved bags as well, the bank staying open", BankTabsBags.shown == true and BankTabsBank.shown == true)
slash("guild")
check("/banktabs guild opens the guild bank too", BankTabsGuild.shown == true and BankTabsBags.shown == true and BankTabsBank.shown == true)
slash("guild")
check("and the same command again closes the one in front", BankTabsGuild.shown == false and BankTabsBags.shown == true)
slash("bank")
check("a command for a window behind another brings it forward rather than closing it", BankTabsBank.shown == true
  and ns.VaultUI.Open()[#ns.VaultUI.Open()] == "bank")
slash("vault")
check("/banktabs vault alone closes the one in front", BankTabsBank.shown == false and BankTabsBags.shown == true)
slash("vault guild")
check("and /banktabs vault guild still names one", BankTabsGuild.shown == true)
for _, kind in ipairs({ "bank", "bags", "guild" }) do ns.VaultUI.Hide(kind) end
slash("scale 140")
check("the old map commands say where the map went", CHAT[#CHAT]:find("Map Tab") ~= nil, CHAT[#CHAT])
check("and change nothing here", ns.db.map == nil)
slash("minimap off")
check("/banktabs minimap off hides the button", ns.db.minimap.shown == false and BankTabsMinimapButton.shown == false)
slash("minimap")
check("and /banktabs minimap brings it back", ns.db.minimap.shown == true and BankTabsMinimapButton.shown == true)
end -- scope

-- ------------------------------------------------------------------
-- 13. Options widgets
-- ------------------------------------------------------------------
ns.SyncOptions()
-- The vault's character tabs are CheckButtons too, and every item cell is a Button, so only the
-- widgets on the option pages are counted here.
local SAVED = { [BankTabsBank] = true, [BankTabsBags] = true, [BankTabsGuild] = true }
local optionChecks, optionButtons = 0, 0
for _, f in ipairs(FRAMES) do
  if not SAVED[f.parent] and (not f.parent or not SAVED[f.parent.parent]) then
    if f.kind == "CheckButton" and (f.name or ""):find("^BankTabsCheck") then optionChecks = optionChecks + 1 end
    if f.kind == "Button" and f.text ~= nil then optionButtons = optionButtons + 1 end
  end
end
check("the options page has its switches", optionChecks >= 16, optionChecks)
check("the options page has its buttons", optionButtons >= 13, optionButtons)
local vaultButtons = { ["Saved bank"] = false, ["Saved bags"] = false, ["Guild bank"] = false, ["Snapshot now"] = false }
for _, f in ipairs(FRAMES) do
  if f.kind == "Button" and vaultButtons[f.text] == false then vaultButtons[f.text] = true end
end
check("the vault page has its three window buttons", vaultButtons["Saved bank"] and vaultButtons["Saved bags"] and vaultButtons["Guild bank"])
check("and the snapshot button", vaultButtons["Snapshot now"])
local forgetButton = false
for _, f in ipairs(FRAMES) do if f.kind == "Button" and f.text == "Forget" then forgetButton = true end end
check("the old Forget button is gone", forgetButton == false)
local tabsLabel, iconsLabel = false, false
for _, fs in ipairs(FONTSTRINGS) do
  if fs.text == "Tabs above the backpack" then tabsLabel = true end
  if fs.text == "Icons on the bag window" then iconsLabel = true end
end
check("the backpack switch talks about tabs now", tabsLabel and not iconsLabel)

-- Clicking the master switch off turns everything off and back on again. The master is the
-- switch labelled as such, never the first CheckButton found, since the vault's character tabs
-- are CheckButtons as well.
local master
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" and not master then
    for _, fs in ipairs(FONTSTRINGS) do
      if fs.parent == f and fs.text == "Bank Tabs is on" then master = f end
    end
  end
end
check("the master switch is the one labelled so", master ~= nil and not SAVED[master.parent])
master:SetChecked(false)
master.scripts.OnClick(master)
check("the master switch writes through", ns.db.enabled == false)
master:SetChecked(true)
master.scripts.OnClick(master)
check("and back on", ns.db.enabled == true)

do -- scope: 13b. No map controls on the options
local mapWords = 0
for _, fs in ipairs(FONTSTRINGS) do
  local text = type(fs.text) == "string" and fs.text or ""
  if text == "Drag the map by its top bar" or text == "Map size" or text == "Coordinates in the tab"
    or text:find("parts of the map you have not explored", 1, true) then mapWords = mapWords + 1 end
end
check("none of the world map's switches are on the pages", mapWords == 0, mapWords)
local windowSwitches = 0
for _, group in ipairs(ns.Windows.GROUPS) do
  for _, fs in ipairs(FONTSTRINGS) do if fs.text == group.label then windowSwitches = windowSwitches + 1 end end
end
check("each bag, bank and guild bank window has its switch", windowSwitches == 5, windowSwitches)
end -- scope

-- ------------------------------------------------------------------
-- 14. Saved variables
-- ------------------------------------------------------------------
ns.db.dragModifier = "ctrl"
ns.MirrorToAccount()
check("settings are mirrored account wide", BankTabsAccountDB.profile.dragModifier == "ctrl")
check("the vault is stored account wide", BankTabsAccountDB.vault.chars[me] ~= nil)

local savedVault = BankTabsAccountDB.vault
BankTabsDB = {}
fire("PLAYER_LOGIN")
check("a blank character table adopts the account copy", ns.db.dragModifier == "ctrl", ns.db.dragModifier)
check("and the report says so", ns.report["db player login"] == "adopted the account copy", ns.report["db player login"])
check("positions are not inherited from another character", next(ns.db.positions) == nil)
check("the vault survived", ns.vault.chars[me] ~= nil)
-- The account copy carries this character's import flag, but a character adopting it has not
-- had its own Casement settings looked at, so it must ask again.
check("the adopted copy does not carry the import flag", ns.Import.lastRun == "nothing" and BankTabsDB.importedCasement == "none", ns.Import.lastRun)

ns.ResetToDefaults()
check("a reset keeps the saved banks", ns.vault.chars[me] ~= nil)
check("a reset puts the settings back", ns.db.dragModifier == "alt")
check("a reset keeps where the Casement import stands", ns.db.importedCasement == "none")

-- ------------------------------------------------------------------
-- 15. Nothing broke along the way
-- ------------------------------------------------------------------
check("no timer raised an error", #TIMER_ERRORS == 0, TIMER_ERRORS[1])
local failures = {}
for key, value in pairs(ns.report) do
  if type(value) == "string" and value:find("failed") then failures[#failures + 1] = key .. ": " .. value end
end
check("nothing in the report failed", #failures == 0, failures[1])
local chatErrors = 0
for _, line in ipairs(CHAT) do if line:find("failed") then chatErrors = chatErrors + 1 end end
check("no failures printed to chat", chatErrors == 0, chatErrors)
local blizzard = 0
for _, name in ipairs(LOADED_BY_US) do if tostring(name):find("^Blizzard_") then blizzard = blizzard + 1 end end
check("no Blizzard addon was loaded by us", blizzard == 0, blizzard)

do -- scope: 15b. Every global Bank Tabs made carries its name
-- Bank Tabs and Map Tab can be installed together, so nothing Bank Tabs puts in the global space
-- may be named for Casement or Map Tab, or for nothing at all.
local HARNESS = { GuildBankFrame = true, INSERTED = true, MOVING = true, NS = true }
local stray = {}
for k in pairs(_G) do
  if not GLOBALS_BEFORE[k] and not HARNESS[k] and type(k) == "string"
    and not k:find("^BankTabs") and not k:find("^SLASH_BANKTABS%d+$") then stray[#stray + 1] = k end
end
table.sort(stray)
check("every global Bank Tabs made is named for it", #stray == 0, table.concat(stray, ", "))
local named = 0
for _, key in ipairs({ "BankTabsFrame", "BankTabsOptions", "BankTabsWindow", "BankTabsMinimapButton", "BankTabsBank", "BankTabsBags",
  "BankTabsGuild", "BankTabsBankSearch", "BankTabsBagsSearch", "BankTabsGuildSearch" }) do
  if _G[key] ~= nil then named = named + 1 end
end
check("its frames are the BankTabs ones", named == 10, named)
check("the single saved window of before is gone, and its API with it", _G["BankTabsVault"] == nil and _G["BankTabsVaultSearch"] == nil
  and ns.VaultUI.Mode == nil)
end -- scope

MAIN_DONE = true
`;

// The Casement import. Each case is a fresh Lua state: the addon loads from nothing with the
// saved variables and the addon list the case sets up, the way a real login would.
const scenarios = [
{ name: 'A: the data holder is present', code: String.raw`
-- Casement was updated through the CurseForge app: its folder now holds only the data holder, a
-- load on demand TOC that declares Casement's saved variables. Bank Tabs is new on this account.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
check("nothing is read before every addon has loaded", CasementAccountDB == nil and not Called("LoadAddOn Casement"))
fire("PLAYER_LOGIN")
check("the data holder was loaded on demand", Called("LoadAddOn Casement") and ADDONS.Casement.loaded == true)
check("the report names what Casement is", ns.report["casement addon"] == "the data holder, switched on", ns.report["casement addon"])
local vatik = ns.vault.chars[VATIK]
check("this character's saved bank came over", vatik and vatik.bank and vatik.bank.containers[1].items[1].id == 2589)
check("and its bags", vatik and vatik.bags and vatik.bags.containers[1].label == "Backpack")
check("and the other character's", ns.vault.chars[CHOHAM_GUID] and ns.vault.chars[CHOHAM_GUID].bank.money == 5500)
check("the 1.0.x shaped record came over and is lifted on first look", ns.Vault.CharRecord("Oldtoon - Voidpact") ~= nil
  and ns.Vault.CharRecord("Oldtoon - Voidpact").bank ~= nil)
check("the guild bank came over", ns.vault.guilds["Night Owls - Voidpact"] ~= nil and ns.vault.guilds["Night Owls - Voidpact"].tabs[1].items[1].count == 40)
check("so did the measured bank layout", ns.vault.bankLayout and ns.vault.bankLayout.pitchX == 50)
check("the copies are Bank Tabs' own tables, not Casement's", ns.vault.chars[CHOHAM_GUID] ~= CasementAccountDB.vault.chars[CHOHAM_GUID]
  and ns.vault ~= CasementAccountDB.vault)
check("the report's count of saved characters includes them", ns.report["vault holds"] == "3 characters, 1 guild banks", ns.report["vault holds"])
check("the reveal's harvest stays behind for Map Tab", BankTabsAccountDB.overlays == nil and ns.vault.overlays == nil)
check("this character's window switches came over", ns.db.windows.reagent == false and ns.db.windows.guildbank == false
  and ns.db.windows.combined == true and ns.db.windows.bags == true)
check("and the drag key, the outlines and the minimap button", ns.db.dragModifier == "shift" and ns.db.showGrips == true
  and ns.db.minimap.shown == false and ns.db.minimap.angle == 33)
check("and the snapshot and tooltip switches", ns.db.vault.autoGuild == false and ns.db.vault.bagButtons == false
  and ns.db.vault.showAccountGold == false and ns.db.tooltips.guild == false and ns.db.tooltips.modifier == "shift")
check("the bag and bank window positions came over", ns.db.positions.bag0 and near(ns.db.positions.bag0.x, 500)
  and near(ns.db.positions.bank.x, 420) and near(ns.db.positions.combined.x, 900))
check("the world map's place, size and switch stay behind for Map Tab", ns.db.positions.worldmap == nil and ns.db.map == nil
  and ns.db.windows.worldmap == nil)
check("one chat line says so", ChatWith("brought over what Casement saved") == 1, ChatLine("Casement"))
local line = ChatLine("brought over what Casement saved") or ""
check("it counts what came over", line:find("3 characters' saved banks and bags", 1, true) and line:find("1 guild bank", 1, true)
  and line:find("your window settings", 1, true), line)
check("and names Map Tab as the new home of the world map tab", ChatWith("Map Tab") == 1 and line:find("Map Tab", 1, true))
check("the report records it", (ns.report["casement import"] or ""):find("^loaded on demand: 3 characters, 1 guild bank, %d+ settings$") ~= nil,
  ns.report["casement import"])
check("the account and this character are flagged", BankTabsAccountDB.importedCasement == true and BankTabsDB.importedCasement == true)
check("this character is marked in the account file too", BankTabsAccountDB.importedChars and BankTabsAccountDB.importedChars[VATIK] == true)
check("the data holder is left switched on", not Called("DisableAddOn Casement") and ADDONS.Casement.enabled == true)
check("nobody is told Casement is still running", ChatWith("replace Casement") == 0)
check("the run says how it ended", ns.Import.lastRun == "imported", ns.Import.lastRun)

-- What came over is used this session.
ContainerFrame1:Show()
RunTimers(0.1)
check("the imported bag position is used straight away", near(ContainerFrame1:GetLeft(), 500), ContainerFrame1:GetLeft())
local outlines
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" then
    for _, fs in ipairs(FONTSTRINGS) do if fs.parent == f and fs.text == "Show me where the drag strips are" then outlines = f end end
  end
end
check("the options show the imported settings", outlines and outlines.checked == true)

-- The same session logs in again (a /reload): nothing is done twice.
local chatBefore = #CHAT
CasementAccountDB.vault.chars[CHOHAM_GUID].bank.money = 1
check("a second login finishes at once", ns.Import.Run() == "done before")
fire("PLAYER_LOGIN")
check("and says nothing", #CHAT == chatBefore, #CHAT - chatBefore)
check("the data holder is not loaded twice", CountCalls("LoadAddOn Casement") == 1, CountCalls("LoadAddOn Casement"))
check("what was brought over is not replaced", ns.vault.chars[CHOHAM_GUID].bank.money == 5500)
check("no timer raised an error", #TIMER_ERRORS == 0, TIMER_ERRORS[1])
`},
{ name: 'A2: another character logs in later', code: String.raw`
-- The account was imported on Vatik. Choham logs in for the first time since: Bank Tabs has never
-- run on this character, so its table starts empty and adopts the account copy, and the data
-- holder is loaded once more for Choham's own Casement settings.
function UnitGUID() return CHOHAM_GUID end
function UnitName() return "Choham" end
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, version = "2.0.0",
  profile = { enabled = true, dragModifier = "ctrl", showGrips = false, importedCasement = true,
    windows = { combined = true, bags = true, reagent = true, bank = true, guildbank = true },
    minimap = { shown = true, angle = 205 }, positions = { bag0 = { x = 1, y = 1 } } },
  vault = { chars = { [CHOHAM_GUID] = { class = "WARRIOR", level = 43, name = "Choham", realm = "Voidpact",
    bank = { time = 5000, money = 7777, items = 0, slots = 48, free = 48, containers = { { id = 6, label = "Bank tab 1", slots = 48, items = {} } } } } },
    guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
check("the new character adopts the account copy", ns.report["db addon loaded"] == "adopted the account copy", ns.report["db addon loaded"])
check("without the other character's positions or import flag", next(BankTabsDB.positions) == nil and BankTabsDB.importedCasement == nil)
fire("PLAYER_LOGIN")
check("the data holder is loaded for this character's settings", Called("LoadAddOn Casement"))
check("this character's Casement settings win over the adopted copy", ns.db.dragModifier == "shift" and ns.db.minimap.angle == 33
  and ns.db.windows.guildbank == false, ns.db.dragModifier)
check("and its window positions come over", ns.db.positions.bank and near(ns.db.positions.bank.x, 420))
check("the account part is not run twice", ns.vault.chars["Oldtoon - Voidpact"] == nil and ns.vault.chars[VATIK] == nil)
check("a snapshot Bank Tabs already holds is kept", ns.vault.chars[CHOHAM_GUID].bank.money == 7777)
check("this character is flagged, here and in the account file", BankTabsDB.importedCasement == true
  and BankTabsAccountDB.importedChars and BankTabsAccountDB.importedChars[CHOHAM_GUID] == true)
check("nothing is said: the account's line was the first time", ChatWith("Casement") == 0, ChatLine("Casement"))
check("the report says it was this character only", (ns.report["casement import"] or ""):find("this character only", 1, true) ~= nil,
  ns.report["casement import"])
`},
{ name: 'A3: a character Casement never saw logs in later', code: String.raw`
-- The account was imported on Vatik, and Bank Tabs' own account copy carries what the user has
-- chosen in Bank Tabs since. Newbie was made after the split: Casement never ran on it, so it has
-- no CasementDB, and the only Casement settings left are Casement's older account copy. Those may
-- only fill in what is still at its default: the choices adopted from Bank Tabs stay.
function UnitGUID() return "Player-70-0BEEF000" end
function UnitName() return "Newbie" end
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount() } }
BankTabsAccountDB = { importedCasement = true, version = "2.0.0",
  profile = { enabled = true, dragModifier = "shift", showGrips = false, importedCasement = true,
    windows = { combined = true, bags = true, reagent = true, bank = true, guildbank = true },
    minimap = { shown = false, angle = 250 },
    tooltips = { enabled = true, guild = true, total = true, modifier = "none" },
    positions = { bag0 = { x = 1, y = 1 } } },
  vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
check("the new character adopts Bank Tabs' account copy", ns.report["db addon loaded"] == "adopted the account copy" and ns.dbFresh == true,
  ns.report["db addon loaded"])
fire("PLAYER_LOGIN")
check("the data holder is loaded for this character", Called("LoadAddOn Casement") and CasementDB == nil)
check("the choices adopted from Bank Tabs' account copy are kept", ns.db.dragModifier == "shift" and ns.db.minimap.shown == false
  and ns.db.minimap.angle == 250,
  tostring(ns.db.dragModifier) .. "/" .. tostring(ns.db.minimap.shown) .. "/" .. tostring(ns.db.minimap.angle))
check("a setting still at its default takes Casement's account copy", ns.db.tooltips.modifier == "alt", ns.db.tooltips.modifier)
check("no window positions come from an account copy", next(ns.db.positions) == nil)
check("the report counts the one setting, for this character only", (ns.report["casement import"] or ""):find(", 1 setting (this character only", 1, true) ~= nil,
  ns.report["casement import"])
check("this character is flagged", BankTabsDB.importedCasement == true)
check("and nothing is said", ChatWith("Casement") == 0, ChatLine("Casement"))
`},
{ name: 'B: the old Casement is still running', code: String.raw`
-- Bank Tabs was installed by hand next to Casement 1.2.3, which still loads. The game loads addons
-- in name order, so Casement's saved variables and event frame arrive after Bank Tabs has loaded.
ADDONS.Casement = { lod = false, enabled = true, loaded = true, title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
-- Whether the old addon will run is not known until login, so nothing is taken before then: a
-- window once taken cannot be handed back the way the old addon would have left it.
check("with an old Casement installed that may run, the window engine waits for login", ns.holdWindows == true
  and ns.Windows.Entry(BankFrame) ~= nil and ns.Windows.Entry(BankFrame).active == false
  and (ns.report["window engine"] or ""):find("^waiting for login") ~= nil, ns.report["window engine"])
check("so the bank is left in the game's panel stack", BankFrame.attributes == nil or BankFrame.attributes["UIPanelLayout-enabled"] == nil)
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
fire("ADDON_LOADED", "Casement")
fire("PLAYER_LOGIN")
check("what the running Casement holds is read straight from memory", not Called("LoadAddOn Casement")
  and (ns.report["casement import"] or ""):find("^read from memory") ~= nil, ns.report["casement import"])
check("every character's saved bank came over", ns.vault.chars[VATIK] ~= nil and ns.vault.chars[CHOHAM_GUID] ~= nil)
check("and this character's settings", ns.db.dragModifier == "shift" and ns.db.positions.bag0 ~= nil)
check("the report names what Casement is", ns.report["casement addon"] == "the old addon, running", ns.report["casement addon"])
check("the old Casement is switched off for the next session", Called("DisableAddOn Casement") and ADDONS.Casement.enabled == false)
check("and the addon list is saved", Called("SaveAddOns nil") and CallIndex("SaveAddOns nil") > CallIndex("DisableAddOn Casement"))
check("the user is told once", ChatWith("the two addons that replace Casement") == 1)
local line = ChatLine("replace Casement") or ""
check("naming both new addons and what each does", line:find("Bank Tabs", 1, true) and line:find("Map Tab", 1, true)
  and line:find("world map", 1, true), line)
check("and that it is off from the next login", line:find("switched off from your next login", 1, true), line)
check("and that until then it keeps the windows, Bank Tabs taking over after a reload", line:find("Until then it keeps the bag and bank windows", 1, true)
  and line:find("takes over after the reload", 1, true), line)
check("with Map Tab not installed, it says Map Tab is a separate download", line:find("Map Tab is a separate download", 1, true), line)
check("the import line leaves Map Tab to that notice", ChatWith("brought over what Casement saved") == 1 and ChatWith("Map Tab") == 1)
check("Map Tab can see it has been said", CASEMENT_REPLACED_NOTICE == "BankTabs")
check("the report records it", (ns.report["old casement"] or ""):find("^was running, switched off from the next session; Bank Tabs leaves") ~= nil
  and (ns.report["old casement"] or ""):find("separate download", 1, true) ~= nil, ns.report["old casement"])

-- For the rest of this session the old addon keeps its windows: two engines on one window fight.
-- This old addon had its bank switch off, so it left the bank in the game's panel stack, and so
-- must Bank Tabs.
local bankEntry = ns.Windows.Entry(BankFrame)
local bankGrip
for _, f in ipairs(FRAMES) do if f.parent == BankFrame and f.dragButtons and f.h == 26 then bankGrip = f end end
check("Bank Tabs leaves the bag and bank windows to the old addon until the next session", ns.oldCasementRunning == true and bankEntry ~= nil
  and bankEntry.active == false and ns.holdWindows == nil and (ns.report["window engine"] or ""):find("^standing aside") ~= nil, ns.report["window engine"])
check("it never took the bank: no drag strip, not made movable", (bankGrip == nil or bankGrip.shown == false) and BankFrame.movable == nil)
check("and never took it out of the game's panel stack", BankFrame.attributes == nil or BankFrame.attributes["UIPanelLayout-enabled"] == nil)
BankFrame:Show()
RunTimers(0.1)
check("a bank opened now is not grabbed", bankEntry.active == false and (bankGrip == nil or bankGrip.shown == false)
  and (BankFrame.attributes == nil or BankFrame.attributes["UIPanelLayout-enabled"] == nil))
BankFrame:Hide()
ContainerFrame1:Show()
RunTimers(0.1)
local tabs = ns.BagHeader.Tabs(ContainerFrame1)
check("the backpack tabs wait for the next session", tabs == nil or not tabs.bank.shown)
check("so does the minimap button", BankTabsMinimapButton == nil or BankTabsMinimapButton.shown == false)
GameTooltip:SetOwner(nil)
GameTooltip.csTooltipStamp = nil
GameTooltip.csItemName, GameTooltip.csItemLink = "Linen Cloth", nil
TOOLTIP_CALLBACKS[0](GameTooltip, { id = 2589 })
check("and the item tooltip lines", #GameTooltip.csLines == 0, #GameTooltip.csLines)
check("the saved windows still open", ns.VaultUI.Show("bank") ~= nil and ns.VaultUI.IsShown("bank"))
ns.VaultUI.Hide("bank")
ContainerFrame1:Hide()
-- The old addon answers to /casement and /cst as well, and the game's pick between two handlers
-- of one command is arbitrary, so this session they are left to it.
check("the old addon keeps /casement and /cst this session", SLASH_BANKTABS3 == nil and SLASH_BANKTABS4 == nil
  and SLASH_BANKTABS1 == "/banktabs" and SLASH_BANKTABS2 == "/btabs")
-- Updated to the data holder later, the Casement folder keeps this switch off, which is then not
-- the user's doing.
check("the account remembers the old Casement was switched off by the notice", BankTabsAccountDB.casementStoodDown == true)
check("and that this character's settings came over", BankTabsAccountDB.importedChars and BankTabsAccountDB.importedChars[VATIK] == true)

fire("PLAYER_LOGIN")
check("it is not said twice", ChatWith("replace Casement") == 1 and CountCalls("DisableAddOn Casement") == 1)
check("after a /reload with the old code still loaded, Bank Tabs still stands aside", ns.oldCasementRunning == true and bankEntry.active == false)
check("Casement's own tables are left as they were", CasementAccountDB.vault.chars[VATIK] ~= nil and CasementDB.dragModifier == "shift")
`},
{ name: 'B4: the old Casement is running, and Map Tab is installed', code: String.raw`
-- As B, with Map Tab installed as well but reaching PLAYER_LOGIN after Bank Tabs. Bank Tabs
-- speaks, and does not send the user off to download what they already have.
ADDONS.Casement = { lod = false, enabled = true, loaded = true, title = "Casement" }
ADDONS.MapTab = { lod = false, enabled = true, loaded = true, title = "Map Tab" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
fire("PLAYER_LOGIN")
local line = ChatLine("replace Casement") or ""
check("Bank Tabs tells the user", line ~= "" and line:find("takes over after the reload", 1, true) ~= nil, line)
check("without calling Map Tab a separate download", line:find("separate download", 1, true) == nil, line)
check("nor does the report", (ns.report["old casement"] or ""):find("separate download", 1, true) == nil, ns.report["old casement"])
`},
{ name: 'B2: Map Tab told the user first', code: String.raw`
-- Both new addons are installed next to the old Casement. Map Tab reached PLAYER_LOGIN first: it
-- set the shared flag, switched Casement off and told the user.
ADDONS.Casement = { lod = false, enabled = true, loaded = true, title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
CASEMENT_REPLACED_NOTICE = "MapTab"
ADDONS.Casement.enabled = false
fire("PLAYER_LOGIN")
check("Bank Tabs does not say it again", ChatWith("replace Casement") == 0)
check("or switch it off a second time", not Called("DisableAddOn Casement"))
check("the report says it was already done", (ns.report["old casement"] or ""):find("^running this session, already switched off for the next; Bank Tabs leaves") ~= nil,
  ns.report["old casement"])
check("and Bank Tabs still leaves the windows to the old addon this session", ns.oldCasementRunning == true
  and ns.Windows.Entry(BankFrame) and ns.Windows.Entry(BankFrame).active == false)
check("its own half is still brought over", ns.vault.chars[CHOHAM_GUID] ~= nil and BankTabsAccountDB.importedCasement == true)
check("and it remembers the old Casement was switched off by the notice, whoever gave it", BankTabsAccountDB.casementStoodDown == true)
check("and the import line names Map Tab, since Bank Tabs did not", ChatWith("brought over what Casement saved") == 1 and ChatWith("Map Tab") == 1)
`},
{ name: 'B3: Map Tab switched it off without the shared flag', code: String.raw`
-- Map Tab got there first but the flag it set is not one Bank Tabs knows. The old addon being
-- switched off already, while its code still runs, is enough to know the user has been told.
ADDONS.Casement = { lod = false, enabled = false, loaded = true, title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
fire("PLAYER_LOGIN")
check("Bank Tabs stays quiet", ChatWith("replace Casement") == 0)
check("and switches nothing", not Called("DisableAddOn Casement") and not Called("EnableAddOn Casement"))
check("but still brings its half over", ns.vault.chars[VATIK] ~= nil and BankTabsDB.importedCasement == true)
`},
{ name: 'B5: what the user changes in the running old Casement comes over at logout', code: String.raw`
-- As B. For the rest of the session the old addon keeps the windows, so the user moves the bank and
-- a bag in it, puts the combined bag back where the game had it, flips switches there, and changes
-- one setting in Bank Tabs. At logout (or a /reload) the old addon's later changes come over, but
-- never over what was changed in Bank Tabs meanwhile, and never the world map's.
ADDONS.Casement = { lod = false, enabled = true, loaded = true, title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
fire("PLAYER_LOGIN")
check("the bank's place came over at login, with the old addon running", ns.oldCasementRunning == true and ns.db.positions.bank
  and ns.db.positions.bank.x == 420 and ns.db.positions.combined ~= nil and ns.Import.followFrom ~= nil)
CasementDB.positions.bank = { x = 1000, y = 480 }
CasementDB.positions.bag1 = { x = 700, y = 200 }
CasementDB.positions.combined = nil
CasementDB.positions.worldmap = { x = 5, y = 5 }
CasementDB.minimap.shown = true
CasementDB.dragModifier = "ctrl"
CasementDB.windows.reagent = true
CasementDB.tooltips.modifier = "alt"
ns.db.tooltips.modifier = "ctrl"
fire("PLAYER_LOGOUT")
check("at logout, where the bank was moved to in the old Casement comes over", ns.db.positions.bank and ns.db.positions.bank.x == 1000
  and ns.db.positions.bank.y == 480)
check("and a bag placed there for the first time", ns.db.positions.bag1 and ns.db.positions.bag1.x == 700)
check("a window put back where the game had it there is forgotten here too", ns.db.positions.combined == nil)
check("the world map's place is still Map Tab's", ns.db.positions.worldmap == nil)
check("switches flipped there, and its drag key, come over", ns.db.minimap.shown == true and ns.db.windows.reagent == true and ns.db.dragModifier == "ctrl")
check("but not over a setting changed in Bank Tabs since login", ns.db.tooltips.modifier == "ctrl", ns.db.tooltips.modifier)
check("a setting nobody changed stays as it came over", ns.db.showGrips == true and ns.db.tooltips.guild == false and ns.db.positions.bag0.x == 500)
check("the account copy written at logout has the followed values", BankTabsAccountDB.profile.positions.bank.x == 1000 and BankTabsAccountDB.profile.minimap.shown == true)
check("the report says what was followed", (ns.report["casement import"] or ""):find("; at logout, 6 later changes followed from the old Casement", 1, true) ~= nil,
  ns.report["casement import"])
check("Casement's own tables are still only read", CasementDB.positions.bank.x == 1000 and CasementDB.tooltips.modifier == "alt")
check("nothing is said at logout", ChatWith("later change") == 0)
CasementDB.positions.bank = { x = 1, y = 1 }
fire("PLAYER_LOGOUT")
check("a second logout in the session follows nothing more", ns.db.positions.bank.x == 1000 and ns.Import.followFrom == nil)
`},
{ name: 'B6: the old Casement runs again on a character already brought over', code: String.raw`
-- The user switched the old Casement back on for a character whose settings came over at an
-- earlier login. Nothing is imported this session, so nothing is followed at logout either.
ADDONS.Casement = { lod = false, enabled = true, loaded = true, title = "Casement" }
BankTabsAccountDB = { importedCasement = true, vault = { chars = {}, guilds = {} } }
BankTabsDB = { importedCasement = true, positions = { bank = { x = 111, y = 222 } } }
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
CasementAccountDB = OldCasementAccount()
CasementDB = OldCasementChar()
CreateFrame("Frame", "CasementFrame", UIParent)
fire("PLAYER_LOGIN")
check("it still stands aside for the session", ns.oldCasementRunning == true and ns.Import.followFrom == nil)
CasementDB.positions.bank = { x = 1000, y = 480 }
fire("PLAYER_LOGOUT")
check("already brought over, the old Casement's later bank place is not followed", ns.db.positions.bank.x == 111, ns.db.positions.bank.x)
check("and the report says nothing about following", (ns.report["casement import"] or ""):find("at logout", 1, true) == nil, ns.report["casement import"])
`},
{ name: 'C: no addon API at all', code: String.raw`
-- A client without C_AddOns or the older globals: there is no way to ask about Casement, so the
-- import is a clean install's, and nothing errors.
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the addon API is really missing here", C_AddOns == nil and LoadAddOn == nil and GetAddOnInfo == nil)
check("Bank Tabs loads and logs in without it", ns.report["windows"] == "ok" and ns.report["options"] == "ok")
check("it finds no Casement", ns.report["casement addon"] == "not installed", ns.report["casement addon"])
check("and records that there was nothing", (ns.report["casement import"] or ""):find("^nothing to import: no Casement installed") ~= nil
  and BankTabsAccountDB.importedCasement == "none", ns.report["casement import"])
check("nothing is said", ChatWith("Casement") == 0)
`, pre: 'NO_ADDON_API=true\n' },
{ name: 'D: already imported', code: String.raw`
-- Both flags are set from an earlier login. The data holder is still there, but it is never
-- loaded again and nothing in it is read.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, vault = { chars = {}, guilds = {} } }
BankTabsDB = { importedCasement = true, dragModifier = "alt" }
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the data holder is not loaded", not Called("LoadAddOn Casement") and ADDONS.Casement.loaded == false)
check("nothing is brought over", next(ns.vault.chars) == nil and ns.db.dragModifier == "alt")
check("nothing is said", ChatWith("Casement") == 0)
check("the report says it was done before", ns.report["casement import"] == "already done" and ns.Import.lastRun == "done before", ns.report["casement import"])
`},
{ name: 'E: the data holder was switched off', code: String.raw`
-- The old Casement was switched off by Map Tab's notice in an earlier session, then updated to the
-- data holder, which kept that switched off state. It runs no code, so Bank Tabs switches it on
-- to read it rather than lose every saved bank.
ADDONS.Casement = { lod = true, enabled = false, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the data holder is switched on before it is loaded", Called("EnableAddOn Casement")
  and CallIndex("EnableAddOn Casement") < (CallIndex("LoadAddOn Casement") or 0))
check("and then read", ADDONS.Casement.loaded == true and ns.vault.chars[CHOHAM_GUID] ~= nil)
check("the report says why it was switched on", ns.report["casement data holder"] == "switched back on to be read", ns.report["casement data holder"])
check("everything is flagged", BankTabsAccountDB.importedCasement == true and BankTabsDB.importedCasement == true)
`},
{ name: 'E2: the data holder switched off after the saved banks came over', code: String.raw`
-- The account was imported on Vatik, with the data holder switched on. Since then the user has
-- switched "Casement (old data)" off in the AddOns list. Choham logs in for the first time: only
-- its window settings are left to bring over, which is no reason to switch the holder back on for
-- every character behind the user's back.
function UnitGUID() return CHOHAM_GUID end
function UnitName() return "Choham" end
ADDONS.Casement = { lod = true, enabled = false, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, version = "2.0.0", vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
fire("PLAYER_LOGIN")
check("the holder is not switched back on", not Called("EnableAddOn Casement") and ADDONS.Casement.enabled == false)
check("or loaded", not Called("LoadAddOn Casement") and CasementDB == nil)
check("nothing is said, at either login", ChatWith("Casement") == 0, ChatLine("Casement"))
check("the character's question is left open, for if the user switches it on again", BankTabsDB.importedCasement == nil)
check("the report says why", (ns.report["casement import"] or ""):find("^not done: the data holder is switched off") ~= nil, ns.report["casement import"])
check("the user is not marked as told", BankTabsAccountDB.casementUnreadableTold == nil)
check("the run says how it ended", ns.Import.lastRun == "not open", ns.Import.lastRun)
`},
{ name: 'E3: the data holder, left switched off by the notice', code: String.raw`
-- Case B happened on Vatik: Bank Tabs switched the old Casement off, for every character, and
-- brought the account over from memory. Casement was then updated to the data holder, which kept
-- that switched off state. Choham logs in for the first time since. The holder being off is the
-- notice's doing, not the user's, so it is switched back on to read Choham's own settings.
function UnitGUID() return CHOHAM_GUID end
function UnitName() return "Choham" end
ADDONS.Casement = { lod = true, enabled = false, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, casementStoodDown = true, importedChars = { [VATIK] = true }, version = "2.0.0",
  vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the holder is switched back on before it is loaded", Called("EnableAddOn Casement")
  and CallIndex("EnableAddOn Casement") < (CallIndex("LoadAddOn Casement") or 0) and ADDONS.Casement.enabled == true)
check("and this character's settings come over", ns.db.dragModifier == "shift" and ns.db.positions.bank ~= nil
  and near(ns.db.positions.bank.x, 420), ns.db.dragModifier)
check("this character is flagged, here and in the account file", BankTabsDB.importedCasement == true
  and BankTabsAccountDB.importedChars[CHOHAM_GUID] == true)
check("the mark is cleared once the holder has been read with the old addon gone", BankTabsAccountDB.casementStoodDown == nil)
check("the account part is not run twice", ns.vault.chars[VATIK] == nil)
check("and nothing is said", ChatWith("Casement") == 0, ChatLine("Casement"))
`},
{ name: 'E4: the data holder is switched off for this character only', code: String.raw`
-- Nothing has come over yet. The data holder is on for other characters but off for Vatik. Asked
-- with no character, the addon API answers for the whole account ("on for some"); asked for Vatik
-- it says off, so the holder is switched on before it is loaded, rather than the game refusing it.
ADDONS.Casement = { lod = true, enabled = true, offFor = { Vatik = true }, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the enable state is asked for this character, the addon first", ENABLE_STATE_ASKED and ENABLE_STATE_ASKED[1] == "Casement"
  and ENABLE_STATE_ASKED[2] == "Vatik", ENABLE_STATE_ASKED and tostring(ENABLE_STATE_ASKED[2]))
check("so the holder is switched on before it is loaded, and loaded once", Called("EnableAddOn Casement")
  and CallIndex("EnableAddOn Casement") < (CallIndex("LoadAddOn Casement") or 0) and CountCalls("LoadAddOn Casement") == 1)
check("and read", ADDONS.Casement.loaded == true and ns.vault.chars[CHOHAM_GUID] ~= nil and BankTabsAccountDB.importedCasement == true)
check("with no word about the game refusing it", ChatWith("could not open") == 0 and ChatWith("DISABLED") == 0, ChatLine("Casement"))
`},
{ name: 'E5: a client with only the older enable state function', code: String.raw`
-- No GetAddOnEnableState under C_AddOns, only the older global, which takes the character first.
-- The data holder is off for Vatik only.
C_AddOns.GetAddOnEnableState = nil
function GetAddOnEnableState(character, name)
  ENABLE_STATE_ASKED = { name, character }
  return EnableState(name, character)
end
ADDONS.Casement = { lod = true, enabled = true, offFor = { Vatik = true }, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the older function is asked with the character first", ENABLE_STATE_ASKED and ENABLE_STATE_ASKED[1] == "Casement"
  and ENABLE_STATE_ASKED[2] == "Vatik", ENABLE_STATE_ASKED and (tostring(ENABLE_STATE_ASKED[1]) .. "/" .. tostring(ENABLE_STATE_ASKED[2])))
check("so the holder is switched on before it is loaded, and read", Called("EnableAddOn Casement")
  and CallIndex("EnableAddOn Casement") < (CallIndex("LoadAddOn Casement") or 0) and CountCalls("LoadAddOn Casement") == 1
  and BankTabsAccountDB.importedCasement == true)
`},
{ name: 'E6: the game refuses the data holder as switched off', code: String.raw`
-- A client with no way to ask the enable state. The data holder is off for Vatik only, which only
-- LoadAddOn's refusal shows. Nothing has come over yet, so it is switched on and loaded again.
C_AddOns.GetAddOnEnableState = nil
ADDONS.Casement = { lod = true, enabled = true, offFor = { Vatik = true }, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the first load is refused, the holder switched on, and the second load works", CountCalls("LoadAddOn Casement") == 2
  and (CallIndex("EnableAddOn Casement") or 0) > CallIndex("LoadAddOn Casement") and ADDONS.Casement.loaded == true)
check("so everything comes over", ns.vault.chars[CHOHAM_GUID] ~= nil and BankTabsAccountDB.importedCasement == true
  and BankTabsDB.importedCasement == true)
check("and the user hears nothing about a refusal", ChatWith("could not open") == 0 and ChatWith("DISABLED") == 0, ChatLine("Casement"))
`},
{ name: 'E7: the same refusal once the account has come over', code: String.raw`
-- As E6, but the account came over at an earlier login and nothing says the old Casement was
-- switched off by the notice: the holder is off for Choham by the user's choice. It is left off,
-- without a word, as in E2.
function UnitGUID() return CHOHAM_GUID end
function UnitName() return "Choham" end
C_AddOns.GetAddOnEnableState = nil
ADDONS.Casement = { lod = true, enabled = true, offFor = { Choham = true }, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, version = "2.0.0", vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the refusal leaves the holder off", CountCalls("LoadAddOn Casement") == 1 and not Called("EnableAddOn Casement")
  and ADDONS.Casement.offFor.Choham == true)
check("without a word", ChatWith("Casement") == 0 and BankTabsAccountDB.casementUnreadableTold == nil, ChatLine("Casement"))
check("the report says why", (ns.report["casement import"] or ""):find("^not done: the data holder is switched off for this character") ~= nil,
  ns.report["casement import"])
check("the character's question is left open", BankTabsDB.importedCasement == nil)
`},
{ name: 'F: the old Casement is installed but switched off', code: String.raw`
-- The old addon itself (not the data holder) is there but switched off. Its files could only be
-- opened by running its code, so Bank Tabs asks the user rather than loading it, and tries again
-- at the next login.
ADDONS.Casement = { lod = false, enabled = false, loaded = false, title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the old code is never loaded or switched on", not Called("LoadAddOn Casement") and not Called("EnableAddOn Casement"))
check("the user is asked to switch it on for one login", ChatWith("switched off") == 1 and ChatWith("for one login") == 1, ChatLine("Casement"))
check("nothing is flagged, so the next login tries again", BankTabsAccountDB.importedCasement == nil and BankTabsDB.importedCasement == nil)
check("the report says why", ns.report["casement import"] == "not done: the old Casement is switched off", ns.report["casement import"])
check("the run says how it ended", ns.Import.lastRun == "not open", ns.Import.lastRun)
check("the account remembers the user was told", BankTabsAccountDB.casementUnreadableTold == true)
fire("PLAYER_LOGIN")
fire("PLAYER_LOGIN")
check("later logins try again without a word", ChatWith("for one login") == 1 and ChatWith("Casement") == 1, ChatWith("Casement"))
check("the report still gives the reason at each", (ns.report["casement import"] or ""):find("^not done: the old Casement is switched off")
  and (ns.report["casement import"] or ""):find("told at an earlier login", 1, true), ns.report["casement import"])
check("and nothing is flagged yet", BankTabsAccountDB.importedCasement == nil and BankTabsDB.importedCasement == nil)
`},
{ name: 'F2: another character after Bank Tabs switched the old Casement off', code: String.raw`
-- Case B happened on Vatik: everything came over and Bank Tabs switched the old Casement off, but
-- its old code is still in the Casement folder. Choham logs in for the first time since, and again,
-- and again. The user hears once why Choham's own Casement settings cannot be read, not every time.
function UnitGUID() return CHOHAM_GUID end
function UnitName() return "Choham" end
ADDONS.Casement = { lod = false, enabled = false, loaded = false, title = "Casement" }
BankTabsAccountDB = { importedCasement = true, version = "2.0.0", profile = { importedCasement = true },
  vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the first login says why, once", ChatWith("for one login") == 1, ChatLine("Casement"))
fire("PLAYER_LOGIN")
fire("PLAYER_LOGIN")
check("three logins, still one line", ChatWith("Casement") == 1, ChatWith("Casement"))
check("the old code is never loaded or switched on", not Called("LoadAddOn Casement") and not Called("EnableAddOn Casement"))
check("this character's question stays open", BankTabsDB.importedCasement == nil and BankTabsAccountDB.casementUnreadableTold == true)
check("the report gives the reason every time", (ns.report["casement import"] or ""):find("told at an earlier login", 1, true) ~= nil,
  ns.report["casement import"])
check("the old code is not running, so Bank Tabs has the windows", ns.oldCasementRunning == nil and ns.Windows.Entry(BankFrame) ~= nil
  and ns.Windows.Entry(BankFrame).active == true)
`},
{ name: 'F3: the old Casement is switched on but did not load', code: String.raw`
-- The old addon itself is switched on, but the game did not load it (out of date, say). It is not
-- switched off, so the user is not asked to switch it on: they hear that it did not load, and why.
ADDONS.Casement = { lod = false, enabled = true, loaded = false, refuse = "INTERFACE_VERSION", title = "Casement" }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
check("switched on, it may run, so the window engine waits for login", ns.holdWindows == true)
fire("PLAYER_LOGIN")
check("the report says it is on but did not load, and why",
  ns.report["casement import"] == "not done: the old Casement is switched on but did not load (INTERFACE_VERSION)", ns.report["casement import"])
check("the user hears the same, once", ChatWith("the old Casement is switched on but did not load (INTERFACE_VERSION)") == 1, ChatLine("Casement"))
check("and is not asked to switch it on", ChatWith("Switch it on") == 0 and ChatWith("is switched off") == 0, ChatLine("Casement"))
check("its code is never loaded or switched on or off", not Called("LoadAddOn Casement") and not Called("EnableAddOn Casement")
  and not Called("DisableAddOn Casement"))
check("nothing is flagged, so the next login tries again", BankTabsAccountDB.importedCasement == nil and BankTabsDB.importedCasement == nil)
check("it did not run, so Bank Tabs takes the windows at login", ns.oldCasementRunning == nil and ns.holdWindows == nil
  and ns.Windows.Entry(BankFrame) ~= nil and ns.Windows.Entry(BankFrame).active == true and ns.report["window engine"] == nil,
  ns.report["window engine"])
check("and the old commands", SLASH_BANKTABS3 == "/casement" and SLASH_BANKTABS4 == "/cst")
`},
{ name: 'G: settings already chosen in Bank Tabs are kept', code: String.raw`
-- An earlier login could not import (the data holder would not load), and the user has changed a
-- few things in Bank Tabs since. Now the import runs: nothing they chose may be overwritten.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { vault = { chars = { [VATIK] = { class = "WARLOCK", level = 60, name = "Vatik", realm = "Voidpact",
  bank = { time = 5000, money = 60, items = 1, slots = 48, free = 47,
    containers = { { id = 6, label = "Bank tab 1", slots = 48, items = { { slot = 1, id = 999, name = "Newer", count = 1 } } } } } } },
  guilds = {} } }
BankTabsDB = { dragModifier = "ctrl", positions = { bag0 = { x = 10, y = 10 } } }
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("a setting changed in Bank Tabs is kept", ns.db.dragModifier == "ctrl", ns.db.dragModifier)
check("a setting still at its default takes Casement's", ns.db.minimap.angle == 33 and ns.db.showGrips == true)
check("a position already set in Bank Tabs is kept", near(ns.db.positions.bag0.x, 10), ns.db.positions.bag0.x)
check("a position Bank Tabs lacks is filled in", ns.db.positions.bank and near(ns.db.positions.bank.x, 420))
check("a newer snapshot is not replaced by Casement's older one", ns.vault.chars[VATIK].bank.containers[1].items[1].id == 999)
check("a record Bank Tabs lacks is filled in", ns.vault.chars[VATIK].bags ~= nil)
check("a character Bank Tabs lacks is added", ns.vault.chars[CHOHAM_GUID] ~= nil)
`},
{ name: 'H: the data holder has nothing saved', code: String.raw`
-- The data holder is there but Casement never wrote a file (or the files were deleted): it loads,
-- nothing arrives, and there is nothing to say.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)", saved = {} }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("it is loaded", Called("LoadAddOn Casement"))
check("the report says there was nothing", (ns.report["casement import"] or ""):find("had nothing saved", 1, true) ~= nil, ns.report["casement import"])
check("the question is closed", BankTabsAccountDB.importedCasement == true and BankTabsDB.importedCasement == true)
check("and nothing is said", ChatWith("Casement") == 0)
`},
{ name: 'I: the data holder will not load', code: String.raw`
-- The game refuses to load the data holder (out of date, say). Nothing is flagged, the user hears
-- once why, and the next login tries again.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, refuse = "INTERFACE_VERSION", title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("it was tried", Called("LoadAddOn Casement"))
check("nothing is flagged", BankTabsAccountDB.importedCasement == nil and BankTabsDB.importedCasement == nil)
check("the user hears why", ChatWith("could not open what Casement saved") == 1 and ChatWith("INTERFACE_VERSION") == 1, ChatLine("Casement"))
check("the report records the game's reason", (ns.report["casement import"] or ""):find("INTERFACE_VERSION", 1, true) ~= nil, ns.report["casement import"])
fire("PLAYER_LOGIN")
check("the next login tries again", CountCalls("LoadAddOn Casement") == 2, CountCalls("LoadAddOn Casement"))
check("without saying it a second time", ChatWith("could not open what Casement saved") == 1, ChatWith("could not open what Casement saved"))
check("while the report still says why", (ns.report["casement import"] or ""):find("INTERFACE_VERSION", 1, true) ~= nil, ns.report["casement import"])
`},
{ name: 'J: Casement turns up after a clean install', code: String.raw`
-- Bank Tabs was installed without the Casement folder (a hand install that left it out, or a
-- package or update that did not bring the data holder). The first logins find nothing. The data
-- holder turns up before a later login: everything is brought over then, and nothing the user
-- chose in Bank Tabs meanwhile is overwritten.
BankTabsDB, BankTabsAccountDB = nil, nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
check("the first login finds nothing and says nothing", ns.Import.lastRun == "nothing" and ChatWith("Casement") == 0)
check("it records there was nothing, not that the import is done", BankTabsAccountDB.importedCasement == "none"
  and BankTabsDB.importedCasement == "none")
fire("PLAYER_LOGIN")
check("a login with still no Casement stays quiet", ns.Import.lastRun == "nothing" and ChatWith("Casement") == 0 and #LOADED_BY_US == 0)
-- Meanwhile the user picks a drag key in Bank Tabs. The next session reads this character's table
-- back from its file, so nothing in it counts as fresh.
ns.db.dragModifier = "ctrl"
ns.dbFresh = false
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
fire("PLAYER_LOGIN")
check("the data holder that turned up is loaded", Called("LoadAddOn Casement") and ADDONS.Casement.loaded == true)
check("every character's saved bank and the guild bank come over", ns.vault.chars[VATIK] ~= nil and ns.vault.chars[CHOHAM_GUID] ~= nil
  and ns.vault.guilds["Night Owls - Voidpact"] ~= nil)
check("the drag key chosen in Bank Tabs meanwhile is kept", ns.db.dragModifier == "ctrl", ns.db.dragModifier)
check("a setting still at its default takes this character's Casement one", ns.db.minimap.angle == 33 and ns.db.positions.bank ~= nil)
check("the one chat line is said now", ChatWith("brought over what Casement saved") == 1, ChatLine("Casement"))
check("and the question is closed for good", BankTabsAccountDB.importedCasement == true and BankTabsDB.importedCasement == true
  and ns.Import.lastRun == "imported", ns.Import.lastRun)
`},
{ name: 'K: a blank character table after the import', code: String.raw`
-- Vatik's settings came over at an earlier login, and Vatik has changed its drag key in Bank Tabs
-- since. This login the client hands back a blank character table (see LoadDB), so the account
-- copy is adopted without the character's flag. The account file's own mark says the import was
-- done for Vatik, so Casement's old settings are not put back over the newer ones.
ADDONS.Casement = { lod = true, enabled = true, loaded = false, title = "Casement (old data)",
  saved = { CasementAccountDB = OldCasementAccount(), CasementDB = OldCasementChar() } }
BankTabsAccountDB = { importedCasement = true, importedChars = { [VATIK] = true }, version = "2.0.0",
  profile = { enabled = true, dragModifier = "ctrl", showGrips = false, importedCasement = true,
    windows = { combined = true, bags = true, reagent = true, bank = true, guildbank = true },
    minimap = { shown = true, angle = 205 } },
  vault = { chars = {}, guilds = {} } }
BankTabsDB = nil
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
check("the blank table adopts the account copy, without the flag", ns.report["db addon loaded"] == "adopted the account copy"
  and ns.dbFresh == true and BankTabsDB.importedCasement == nil, ns.report["db addon loaded"])
fire("PLAYER_LOGIN")
check("the import is not run again", not Called("LoadAddOn Casement") and ns.Import.lastRun == "done before", ns.Import.lastRun)
check("so the drag key chosen in Bank Tabs is kept", ns.db.dragModifier == "ctrl" and ns.db.minimap.angle == 205
  and next(ns.db.positions) == nil, ns.db.dragModifier)
check("the character's flag is put back from the account file", BankTabsDB.importedCasement == true)
check("and the report says so", (ns.report["casement import"] or ""):find("flag put back", 1, true) ~= nil, ns.report["casement import"])
check("nothing is said", ChatWith("Casement") == 0, ChatLine("Casement"))
`},
{ name: 'L: bank layouts saved one column wide by 2.0.0', code: String.raw`
-- Bank Tabs 2.0.0 could measure a bank one column wide (a stray button of a slot's size above the
-- grid read as a first row of one, or the window measured before its slots were made), and every
-- character's saved bank was then drawn as a single column of items; a user saw exactly that.
-- Those layouts are dropped at load, so the saved banks are drawn from a good layout, or the
-- classic bank's numbers, until the bank is opened and measured again.
local function OneColumn()
  return { cell = 37, cols = 1, rows = 7, slots = 49, pitchX = 49, pitchY = 47, originX = 300, originY = 16, width = 400, height = 500,
    bagCount = 8, bagCell = 24, bagPitch = 38, bagOriginX = 145, bagOriginY = 359 }
end
local NOT_MADE_YET = { cell = 28, cols = 1, rows = 2, slots = 9, pitchX = 40, pitchY = 370, originX = 342, originY = 30, width = 400, height = 500 }
local GOOD = { cell = 37, cols = 8, rows = 6, slots = 48, pitchX = 50, pitchY = 47, originX = 48, originY = 63, width = 400, height = 500 }
local OLDTOON = "Player-70-0C0C0C0C"
local function Bank(layout)
  return { time = 1000, reason = "bank opened", money = 50, items = 1, slots = 48, free = 47, layout = layout,
    containers = { { id = 6, label = "Bank tab 1", slots = 48, items = { { slot = 3, id = 2589, name = "Linen Cloth", count = 7, icon = 1 } } } } }
end
BankTabsAccountDB = { importedCasement = true, version = "2.0.0", vault = { guilds = {}, bankLayout = OneColumn(), chars = {
  [VATIK] = { class = "WARLOCK", level = 60, name = "Vatik", realm = "Voidpact", guid = VATIK, bank = Bank(OneColumn()) },
  [CHOHAM_GUID] = { class = "WARRIOR", level = 42, name = "Choham", realm = "Voidpact", guid = CHOHAM_GUID, bank = Bank(NOT_MADE_YET) },
  [OLDTOON] = { class = "MAGE", level = 30, name = "Oldtoon", realm = "Voidpact", guid = OLDTOON, bank = Bank(GOOD) },
} } }
BankTabsDB = { importedCasement = true }
local ns = LoadBankTabs()
fire("ADDON_LOADED", "BankTabs")
fire("PLAYER_LOGIN")
local chars = ns.vault.chars
check("a layout one column wide is dropped", chars[VATIK].bank.layout == nil)
check("so is one measured before the bank's slots were made", chars[CHOHAM_GUID].bank.layout == nil)
check("and the account's own", ns.vault.bankLayout == nil)
check("a good layout is kept", chars[OLDTOON].bank.layout ~= nil and chars[OLDTOON].bank.layout.cols == 8)
check("the saved banks themselves are kept", chars[VATIK].bank.items == 1 and chars[CHOHAM_GUID].bank.items == 1
  and #chars[VATIK].bank.containers == 1)
check("the report counts what was dropped", ns.report["bank layouts dropped"] == "3 that were not a grid", ns.report["bank layouts dropped"])
check("the check passes the classic bank and the measured one, and nothing one column wide", ns.Vault.PlausibleLayout(GOOD)
  and ns.Vault.PlausibleLayout({ cell = 37, pitchX = 49, pitchY = 47, originX = 48, originY = 63, cols = 8 })
  and not ns.Vault.PlausibleLayout(OneColumn()) and not ns.Vault.PlausibleLayout(NOT_MADE_YET) and not ns.Vault.PlausibleLayout(nil)
  and not ns.Vault.PlausibleLayout({ cell = 37, pitchX = 0 / 0, pitchY = 47, originX = 48, originY = 63, cols = 8 }))
check("nor slots that overlap or lie absurdly far apart", not ns.Vault.PlausibleLayout({ cell = 37, pitchX = 20, pitchY = 47, originX = 48, originY = 63, cols = 8 })
  and not ns.Vault.PlausibleLayout({ cell = 37, pitchX = 50, pitchY = 370, originX = 48, originY = 63, cols = 8 }))

-- The saved bank is drawn eight across: on the classic bank's numbers for Vatik, whose layout went,
-- and on the measured one for Oldtoon, whose layout stood.
local function EightAcross(pitchX)
  local vault, cells = BankTabsBank, {}
  for _, f in ipairs(FRAMES) do
    if f.kind == "Button" and f.parent == vault and f.icon and f.count and f.w == 37 and f.shown then cells[#cells + 1] = f end
  end
  for i = 1, 48 do
    local x, y, found = 48 + ((i - 1) % 8) * pitchX, -(63 + math.floor((i - 1) / 8) * 47), false
    for _, c in ipairs(cells) do
      local p = c.points[1]
      if p and p[2] == vault and near(p[4], x, 0.01) and near(p[5], y, 0.01) then found = true break end
    end
    if not found then return false end
  end
  return #cells == 48
end
ns.VaultUI.Show("bank", VATIK)
check("Vatik's saved bank is eight across, on the classic bank's numbers", EightAcross(49))
ns.VaultUI.Show("bank", OLDTOON)
check("Oldtoon's on the layout it kept", EightAcross(50))

-- The bank opened: the window is measured again, and the measurement stands for the account.
BankFrame:Show()
fire("BANKFRAME_OPENED")
RunTimers(1)
local layout = chars[VATIK].bank.layout
check("opening the bank measures it again", layout ~= nil and layout.cols == 8 and layout.pitchX == 50 and layout.slots == 48,
  ns.report["bank layout"])
check("for the account too", ns.vault.bankLayout ~= nil and ns.vault.bankLayout.cols == 8)
check("no timer raised an error", #TIMER_ERRORS == 0, TIMER_ERRORS[1])
`},
];

// ------------------------------------------------------------------
// Running it
// ------------------------------------------------------------------

const sources = {};
for (const f of files) sources[f] = fs.readFileSync(DIR + f, 'utf8');

function run(L, code, name) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.log('LUA ERROR in ' + name + ': ' + lua.lua_tojsstring(L, -1)); process.exit(1);
  }
}
function number(L, name) {
  lua.lua_getglobal(L, to_luastring(name));
  const n = lua.lua_tonumber(L, -1);
  lua.lua_pop(L, 1);
  return n || 0;
}

const pre = (process.argv.includes('--bare')
  ? 'BARE=true\nBAD_ATLAS=true\nBAD_TEMPLATES={TooltipBackdropTemplate=true,UICheckButtonTemplate=true,ChatConfigCheckButtonTemplate=true,MinimalSliderTemplate=true,UISliderTemplate=true,OptionsSliderTemplate=true,UIPanelButtonTemplate=true,UIPanelCloseButton=true,DefaultPanelFlatTemplate=true,DefaultPanelTemplate=true,ButtonFrameTemplate=true,BasicFrameTemplate=true,BackdropTemplate=true,SearchBoxTemplate=true,InputBoxTemplate=true}\n'
  : '') + (process.argv.includes('--verbose') ? 'VERBOSE=true\n' : '')
  + (process.argv.includes('--noenum') ? 'NO_ENUM=true\n' : '');

function newState(extra, label) {
  const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
  lua.lua_newtable(L);
  for (const f of files) { lua.lua_pushstring(L, to_luastring(sources[f])); lua.lua_setfield(L, -2, to_luastring(f)); }
  lua.lua_setglobal(L, to_luastring('SOURCES'));
  lua.lua_newtable(L); files.forEach((f, i) => { lua.lua_pushstring(L, to_luastring(f)); lua.lua_rawseti(L, -2, i + 1); });
  lua.lua_setglobal(L, to_luastring('FILES'));
  if (label) { lua.lua_pushstring(L, to_luastring(label)); lua.lua_setglobal(L, to_luastring('SCENARIO')); }
  run(L, pre + (extra || '') + stub, 'stub');
  run(L, common, 'common');
  return L;
}

let pass = 0, fail = 0;
const parts = [];

// The main suite.
{
  const L = newState('', null);
  run(L, driver, 'driver');
  const p = number(L, 'PASS'), f = number(L, 'FAIL');
  pass += p; fail += f; parts.push('main ' + p);
}

// The Casement import cases.
{
  let p = 0, f = 0;
  for (const s of scenarios) {
    const L = newState(s.pre || '', s.name);
    run(L, s.code, s.name);
    p += number(L, 'PASS'); f += number(L, 'FAIL');
  }
  pass += p; fail += f; parts.push('import ' + p + ' in ' + scenarios.length + ' cases');
}

// The package files. Only where the repo is (an installed copy has no .pkgmeta or docs).
{
  let p = 0, f = 0;
  const check = (label, cond, extra) => {
    if (cond) p++; else { f++; console.log('FAIL: files: ' + label + (extra !== undefined ? '  [' + extra + ']' : '')); }
  };
  const read = (rel) => { try { return fs.readFileSync(DIR + rel, 'utf8'); } catch (e) { return null; } };
  const lines = (text) => (text || '').split(/\r?\n/);
  const field = (text, key) => { const m = (text || '').match(new RegExp('^## ' + key + ': *(.*?)\\s*$', 'm')); return m ? m[1] : null; };
  const codeLines = (text) => lines(text).map(l => l.trim()).filter(l => l !== '' && !l.startsWith('#'));

  const toc = read('BankTabs.toc');
  check('the TOC is BankTabs.toc', toc !== null);
  check('titled Bank Tabs', field(toc, 'Title') === 'Bank Tabs', field(toc, 'Title'));
  const version = (sources['Core.lua'].match(/ns\.version = "([^"]+)"/) || [])[1];
  check('its version is the addon\'s own, 2.1.0', field(toc, 'Version') === '2.1.0' && version === '2.1.0', field(toc, 'Version') + ' / ' + version);
  check('it saves BankTabsAccountDB and BankTabsDB', field(toc, 'SavedVariables') === 'BankTabsAccountDB'
    && field(toc, 'SavedVariablesPerCharacter') === 'BankTabsDB');
  check('its icon is the treasure chest from the game\'s icons (not Stockpile\'s bag), the path intact', /^Interface\\Icons\\Racial_Dwarf_FindTreasure$/.test(field(toc, 'IconTexture') || ''), field(toc, 'IconTexture'));
  check('the interface number is this client\'s', field(toc, 'Interface') === '16001');
  check('it lists exactly the files this harness loads, in order', codeLines(toc).join(',') === files.join(','), codeLines(toc).join(','));
  check('none of the map half ships', ['Map.lua', 'Reveal.lua', 'Data/MapOverlays.lua', 'tools/overlays-from-csv.js'].every(rel => read(rel) === null));

  // The saved windows' API: nothing still calls the single window of before, or calls one
  // window's function without saying which window.
  const oldCallers = files.filter(f => /VaultUI\.Mode\b|BankTabsVault\b|VaultUI\.(Show|Toggle|Hide|IsShown|Selected|Characters)\(\s*\)/.test(sources[f]));
  check('every caller of the old single window API is updated', oldCallers.length === 0, oldCallers.join(', '));
  check('the minimap, the backpack tabs, the slash commands and the options all go through it', /VaultUI\.Toggle\("bank"\)/.test(sources['Minimap.lua'])
    && /VaultUI\.Toggle\(spec\.key\)/.test(sources['BagHeader.lua']) && /VaultUI\.Toggle\(which\)/.test(sources['Core.lua'])
    && ['bank', 'bags', 'guild'].every(k => sources['Options.lua'].includes('VaultUI.Show("' + k + '")')));
  // Both kinds of tab from one builder and one placer, so they cannot drift apart.
  const tabUsers = ['VaultUI.lua', 'BagHeader.lua'];
  check('the character tabs and the backpack tabs come from the one builder and the one placer',
    tabUsers.every(f => /ns\.CreateTab\(/.test(sources[f]) && /ns\.HangTab\(/.test(sources[f])));
  check('and neither makes or dresses a tab of its own', tabUsers.every(f => !/CheckButton|spellbook-Tab|IconFrame-Mask/.test(sources[f])),
    tabUsers.filter(f => /CheckButton|spellbook-Tab|IconFrame-Mask/.test(sources[f])).join(', '));
  check('the builder is defined once, in Core', (sources['Core.lua'].match(/function ns\.CreateTab\(/g) || []).length === 1
    && files.filter(f => /function ns\.CreateTab\(|function ns\.HangTab\(/.test(sources[f])).join(',') === 'Core.lua');

  if (read('.pkgmeta') !== null) {
    const holder = read('Legacy/Casement/Casement.toc');
    check('the data holder is in the repo', holder !== null);
    check('it is the Casement folder\'s TOC for this client', field(holder, 'Interface') === '16001' && field(holder, 'Title') === 'Casement (old data)', field(holder, 'Title'));
    check('it loads only on demand', field(holder, 'LoadOnDemand') === '1');
    check('it declares Casement\'s saved variables', field(holder, 'SavedVariables') === 'CasementAccountDB'
      && field(holder, 'SavedVariablesPerCharacter') === 'CasementDB');
    check('it runs no code', codeLines(holder).length === 0, codeLines(holder).join(','));
    check('its notes say what it is and that it can go', /old/i.test(field(holder, 'Notes') || '') && /delete/i.test(field(holder, 'Notes') || ''), field(holder, 'Notes'));
    // Deleted after the first character, it would take every other character's Casement settings
    // with it, so the AddOns list says what the docs say.
    check('but only once both addons have loaded on every character', /Bank Tabs and Map Tab have loaded on every character you play/.test(field(holder, 'Notes') || ''),
      field(holder, 'Notes'));

    const pkg = read('.pkgmeta');
    check('the package is BankTabs', /^package-as: BankTabs\s*$/m.test(pkg));
    check('the data holder is moved to a top level Casement folder', /^move-folders:\s*\r?\n\s+BankTabs\/Legacy\/Casement: Casement\s*$/m.test(pkg));
    check('the tests stay out of the package', /^ignore:\s*\r?\n(\s+- .*\r?\n)*\s+- tests\s*$/m.test(pkg));
    check('the changelog is the release notes, as markdown', /manual-changelog:\s*\r?\n\s+filename: RELEASE-NOTES\.md\s*\r?\n\s+markup-type: markdown/m.test(pkg));

    // Compared with Windows line endings taken out, since a checkout may add them to either file.
    const changelog = (read('CHANGELOG.md') || '').replace(/\r\n/g, '\n');
    const notes = (read('RELEASE-NOTES.md') || '').replace(/\r\n/g, '\n');
    const top = changelog.split(/\r?\n(?=## )/).find(s => s.startsWith('## ')) || '';
    check('the changelog opens on 2.1.0', /^## 2\.1\.0 - /.test(top), top.slice(0, 30));
    check('the release notes are that section and nothing else', notes.replace(/\s+$/, '') === top.replace(/\s+$/, ''));

    // Every text file, docs and code: no em or en dashes, as the author asked.
    const texts = [];
    const walk = (rel) => {
      for (const name of fs.readdirSync(DIR + (rel || '.'))) {
        if (name === '.git' || name === 'node_modules') continue;
        const sub = rel ? rel + '/' + name : name;
        if (fs.statSync(DIR + sub).isDirectory()) walk(sub);
        else if (/\.(lua|md|toc|js|txt)$|^\.pkgmeta$|^\.gitignore$/.test(name)) texts.push(sub);
      }
    };
    walk('');
    // Figure dash to horizontal bar, built from char codes so this file holds none itself.
    const dashes = new RegExp('[' + String.fromCharCode(0x2012) + '-' + String.fromCharCode(0x2015) + ']');
    const dashed = texts.filter(rel => dashes.test(read(rel) || ''));
    check('no em or en dashes in any file', dashed.length === 0, dashed.join(', '));
  }
  pass += p; fail += f; parts.push('files ' + p);
}

console.log('(' + parts.join(', ') + ')');
console.log(`RESULT pass=${pass} fail=${fail}`);

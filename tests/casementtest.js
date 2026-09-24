// Offline harness for Casement: stubs the WoW API in fengari and walks the main paths.
//
//   node casementtest.js [addon dir] [--bare] [--verbose] [--noenum]
//
//   --bare    every UI template is missing, the way an unexpected client build would look
//   --noenum  no Enum.BagIndex, so the bank container list has to fall back to fixed ids
//
// The stub carries a small layout engine (points, anchors, scales) because almost everything this
// addon does is geometry: clamping a window to the screen, keeping a corner still while the map
// is scaled, and putting a window back after the game has re-anchored it.
const fs = require('fs');
const { lua, lauxlib, lualib, to_luastring } = require('fengari');
const DIR = (process.argv.slice(2).find(a => !a.startsWith('--')) || 'C:/Users/jonli/casement/');
const L = lauxlib.luaL_newstate(); lualib.luaL_openlibs(L);
const files = ['Core.lua', 'Windows.lua', 'Map.lua', 'Minimap.lua', 'Vault.lua', 'VaultUI.lua', 'BagHeader.lua', 'Options.lua'];

const stub = String.raw`
local VERBS = { "Set", "Get", "Is", "Create", "Register", "Enable", "Clear", "Hook", "Start", "Stop", "Has", "Num", "Add", "Unregister", "Disable", "Raise", "Lower", "Lock", "Unlock", "Show", "Hide", "Insert", "Toggle" }
local function isMethod(k)
  if type(k) ~= "string" then return false end
  for _, v in ipairs(VERBS) do if k:sub(1, #v) == v then return true end end
  return false
end

FRAMES = {}
TEXTURES = {}
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
    -- its title bar and to work out what it has to sit above.
    if k == "GetChildren" then return function(s) return unpack(s.kids or {}) end end
    if k == "GetNumChildren" then return function(s) return #(s.kids or {}) end end
    if k == "Show" then return function(s) local was = s.shown s.shown = true if not was and s.scripts.OnShow then s.scripts.OnShow(s) end end end
    if k == "Hide" then return function(s) local was = s.shown s.shown = false if was and s.scripts.OnHide then s.scripts.OnHide(s) end end end
    if k == "SetShown" then return function(s, v) if v then s:Show() else s:Hide() end end end
    if k == "IsShown" or k == "IsVisible" then return function(s) return s.shown end end
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
    if k == "SetAtlas" then return function(s, x) if BAD_ATLAS then error("no atlas " .. tostring(x)) end s.atlas = x end end
    if k == "SetColorTexture" then return function(s, r, g, b, a) s.color = { r, g, b, a } s.texture = nil end end
    if k == "SetVertexColor" then return function(s, r, g, b) s.vertex = { r, g, b } end end
    if k == "SetTexCoord" then return function() end end
    if k == "SetAlpha" then return function(s, x) s.alpha = x end end
    if k == "GetAlpha" then return function(s) return s.alpha or 1 end end
    if k == "SetJustifyH" or k == "SetJustifyV" or k == "SetWordWrap" then return function() end end
    if k == "SetAutoFocus" or k == "ClearFocus" or k == "SetFocus" then return function() end end
    if k == "SetFontString" then return function(s, f) s.fontString = f end end
    if k == "GetFontString" then return function(s) return s.fontString end end
    if k == "SetNormalTexture" or k == "SetPushedTexture" or k == "SetHighlightTexture" or k == "SetCheckedTexture" then
      return function(s, v) s.art = v end
    end
    if k == "SetBackdrop" then return function(s, b) s.backdrop = b end end
    if k == "LockHighlight" then return function(s) s.highlighted = true end end
    if k == "UnlockHighlight" then return function(s) s.highlighted = false end end
    if k == "CreateTexture" then return function(s, n, layer)
      local r = obj("texture") r.parent = s r.layer = layer TEXTURES[#TEXTURES + 1] = r return r
    end end
    if k == "CreateFontString" then return function(s, n, layer, font)
      local r = obj("fontstring") r.parent = s r.font = font return r
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

function UnitName() return "Vatik" end
function GetRealmName() return "Voidpact" end
function UnitClass() return "Warlock", "WARLOCK" end
function UnitLevel() return 60 end
GUILD_NAME = "Night Owls"
function GetGuildInfo(unit) if GUILD_NAME == "" then return nil end return GUILD_NAME, "Officer", 1 end
function GetMoney() return 1234567 end
function GetCoinTextureString(v) return tostring(v) .. "c" end
function GetFileIDFromPath(p) return 12345 end
function ChatEdit_InsertLink(link) INSERTED = link end
ITEM_QUALITY_COLORS = { [1] = { r = 1, g = 1, b = 1 }, [2] = { r = 0.1, g = 1, b = 0.1 }, [3] = { r = 0.3, g = 0.4, b = 1 } }

UIPanelWindows = { BankFrame = { area = "left" }, GuildBankFrame = { area = "left" } }
function ShowUIPanel(f) if f then f:Show() end end
function HideUIPanel(f) if f then f:Hide() end end

-- ------------------------------------------------------------------
-- Bags, bank and guild bank
-- ------------------------------------------------------------------

NO_ENUM = NO_ENUM or false
if not NO_ENUM then
  Enum = { BagIndex = {
    Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4, ReagentBag = 5,
    Bank = -1, Reagentbank = -3,
    CharacterBankTab_1 = 6, CharacterBankTab_2 = 7,
  } }
else
  Enum = {}
end

-- The legacy bank container still reports slots on this client even though nothing can be put in
-- it, which is exactly the trap the scan has to avoid.
SLOTS = { [0] = 20, [1] = 16, [2] = 16, [5] = 12, [-1] = 32, [-3] = 0, [6] = 48, [7] = 48 }

local function link(id, name) return "|cffffffff|Hitem:" .. id .. "::::::::60:::::::::|h[" .. name .. "]|h|r" end
BANK_ITEMS = {
  [6] = {
    [1] = { id = 2589, name = "Linen Cloth", count = 20, quality = 1 },
    [4] = { id = 2592, name = "Wool Cloth", count = 12, quality = 1 },
    [9] = { id = 12359, name = "Thorium Bar", count = 5, quality = 1 },
  },
  [7] = {
    [2] = { id = 13446, name = "Major Healing Potion", count = 5, quality = 1 },
  },
  [-1] = { [1] = { id = 4306, name = "Silk Cloth", count = 3, quality = 1 } },
}

C_Container = {
  GetContainerNumSlots = function(bag) return SLOTS[bag] or 0 end,
  GetContainerItemInfo = function(bag, slot)
    local entry = BANK_ITEMS[bag] and BANK_ITEMS[bag][slot]
    if not entry then return nil end
    return { iconFileID = 100 + entry.id, stackCount = entry.count, quality = entry.quality,
      hyperlink = link(entry.id, entry.name), itemID = entry.id }
  end,
}

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

-- ------------------------------------------------------------------
-- The game's own windows
-- ------------------------------------------------------------------

WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame:SetSize(700, 500)
WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
WorldMapFrame.ScrollContainer = CreateFrame("Frame", nil, WorldMapFrame)
WorldMapFrame:Hide()

-- The map's own top bar: a nav bar on the left and buttons on the right, both taking the mouse.
-- Anything the addon lays across the top bar has to leave these alone.
MAP_NAV = CreateFrame("Frame", "CasementTestMapNav", WorldMapFrame)
MAP_NAV:SetSize(220, 24)
MAP_NAV:SetPoint("TOPLEFT", WorldMapFrame, "TOPLEFT", 8, -2)
MAP_NAV:EnableMouse(true)
MAP_NAV:SetFrameLevel(4)

MAP_CLOSE = CreateFrame("Button", "CasementTestMapClose", WorldMapFrame)
MAP_CLOSE:SetSize(30, 26)
MAP_CLOSE:SetPoint("TOPRIGHT", WorldMapFrame, "TOPRIGHT", -4, -2)
MAP_CLOSE:EnableMouse(true)
MAP_CLOSE:SetFrameLevel(4)

-- The quest panel. This is the frame that broke the first version: it covers the right hand side
-- of the map, takes the mouse, and sits well above the map's own frame level, so a grip only a few
-- levels up from the map was visible but never received a click.
QuestMapFrame = CreateFrame("Frame", "QuestMapFrame", WorldMapFrame)
QuestMapFrame:SetSize(330, 500)
QuestMapFrame:SetPoint("TOPRIGHT", WorldMapFrame, "TOPRIGHT", 0, 0)
QuestMapFrame:EnableMouse(true)
QuestMapFrame:SetFrameLevel(20)
QUEST_SCROLL = CreateFrame("ScrollFrame", nil, QuestMapFrame)
QUEST_SCROLL:SetSize(330, 470)
QUEST_SCROLL:SetPoint("TOPLEFT", QuestMapFrame, "TOPLEFT", 0, 0)
QUEST_SCROLL:EnableMouse(true)
QUEST_SCROLL:SetFrameLevel(24)
QuestMapFrame:Hide()

-- Opening the quest panel widens the map, exactly as the real one does.
function OpenQuestPanel(open)
  if open then
    WorldMapFrame:SetSize(1030, 500)
    QuestMapFrame:Show()
  else
    WorldMapFrame:SetSize(700, 500)
    QuestMapFrame:Hide()
  end
  if WorldMapFrame.scripts.OnSizeChanged then WorldMapFrame.scripts.OnSizeChanged(WorldMapFrame) end
end

Minimap = CreateFrame("Frame", "Minimap", UIParent)
Minimap:SetSize(140, 140)
Minimap:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -20, -20)

MOUSE_DOWN = false
function IsMouseButtonDown(which) return MOUSE_DOWN end

BankFrame = CreateFrame("Frame", "BankFrame", UIParent)
BankFrame:SetSize(400, 500)
BankFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 40, -120)
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

const driver = String.raw`
local ns = {}
for _, file in ipairs(FILES) do
  local chunk, err = load(SOURCES[file], "@" .. file)
  if not chunk then error("SYNTAX " .. tostring(err)) end
  chunk("Casement", ns)
end
NS = ns

local PASS, FAIL = 0, 0
local function check(label, cond, extra)
  if cond then PASS = PASS + 1 else FAIL = FAIL + 1 print("FAIL: " .. label .. (extra and ("  [" .. tostring(extra) .. "]") or "")) end
end
local function near(a, b, slack)
  if type(a) ~= "number" or type(b) ~= "number" then return false end
  return math.abs(a - b) <= (slack or 0.5)
end

local ev = CasementFrame
local function fire(...) ev.scripts.OnEvent(ev, ...) end

-- Drags a window the way a player would: the game moves the frame, then the drag stop script runs.
local function DragTo(frame, region, x, y)
  region.scripts.OnDragStart(region)
  frame:ClearAllPoints()
  frame:SetPoint("BOTTOMLEFT", UIParent, "BOTTOMLEFT", x, y)
  region.scripts.OnDragStop(region)
end

-- ------------------------------------------------------------------
-- 1. Load
-- ------------------------------------------------------------------
CasementDB = {}
CasementAccountDB = nil
fire("ADDON_LOADED", "Casement")

check("db built", type(ns.db) == "table" and ns.db.windows ~= nil)
check("defaults filled in", ns.db.map.step == 10 and ns.db.dragModifier == "alt")
check("vault tables built", type(ns.vault) == "table" and type(ns.vault.chars) == "table")
check("windows module ok", ns.report["windows"] == "ok", ns.report["windows"])
check("map module ok", ns.report["world map"] == "ok", ns.report["world map"])
check("vault module ok", ns.report["vault"] == "ok", ns.report["vault"])
check("options module ok", ns.report["options"] == "ok", ns.report["options"])
check("options category registered", ns.report["options category"] == "ok (canvas page)", ns.report["options category"])
check("category handed to the addon list", CATEGORIES[1] and CATEGORIES[1].registered == true)
for _, key in ipairs({ "windows", "map", "vault", "about" }) do
  check("page " .. key .. " built", ns.report["page " .. key] == "ok", ns.report["page " .. key])
end
check("every event registered", ns.report["events"]:find("^%d+/%d+ registered$") ~= nil, ns.report["events"])
check("bag anchor hook taken", ns.report["bag anchor hook"] == "ok", ns.report["bag anchor hook"])
check("windows were found", (ns.report["windows found"] or ""):find("^%d+"), ns.report["windows found"])
check("no Blizzard addon was loaded by us", C_AddOns == nil or LOADED_BY_US == nil)

-- ------------------------------------------------------------------
-- 2. Moving the world map
-- ------------------------------------------------------------------
WorldMapFrame:Show()
RunTimers(1)

local map = WorldMapFrame
check("map is movable", map.movable == true)
check("map is clamped to the screen", map.clamped == true)

-- The corner handle still exists, but it only shows itself when the top bar has no room.
local grip
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.dragButtons and f.w == 22 and f.h == 22 then grip = f end
end
check("map has a corner handle built", grip ~= nil)
check("the handle stays out of the way while the top bar works", grip and grip.shown == false)

-- The draggable stretches of the top bar.
local function TopStrips()
  local out = {}
  for _, f in ipairs(FRAMES) do
    if f.parent == map and f.dragButtons and f.shown and f ~= grip and f.h ~= 22 then out[#out + 1] = f end
  end
  return out
end
local strips = TopStrips()
check("the top bar has a draggable stretch", #strips > 0, #strips)
check("the report says how many", (ns.report["map top bar"] or ""):find("stretches"), ns.report["map top bar"])

-- Nothing the addon laid on the top bar may cover one of the game's own controls.
local function Overlaps(a, b)
  local al, ab, aw = ns.Windows.Measure(a)
  local bl, bb, bw = ns.Windows.Measure(b)
  if not al or not bl then return false end
  return al < bl + bw and bl < al + aw
end
local covered = false
for _, strip in ipairs(strips) do
  if Overlaps(strip, MAP_NAV) or Overlaps(strip, MAP_CLOSE) then covered = true end
end
check("the top bar strips leave the game's own buttons clear", covered == false)

local strip1 = strips[1]
DragTo(map, strip1, 300, 200)
check("map position saved", ns.db.positions["worldmap"] ~= nil)
check("saved x is right", near(ns.db.positions["worldmap"].x, 300), ns.db.positions["worldmap"].x)
check("map actually sits there", near(map:GetLeft(), 300), map:GetLeft())

-- Off the left edge
DragTo(map, strip1, -400, 200)
check("dragged off the left edge is pulled back", near(ns.db.positions["worldmap"].x, 0), ns.db.positions["worldmap"].x)
-- Off the right edge
DragTo(map, strip1, 5000, 200)
check("dragged off the right edge is pulled back", near(ns.db.positions["worldmap"].x, SCREEN_W - 700), ns.db.positions["worldmap"].x)
-- Off the bottom
DragTo(map, strip1, 300, -900)
check("dragged below the screen is pulled back", near(ns.db.positions["worldmap"].y, 0), ns.db.positions["worldmap"].y)
-- Off the top
DragTo(map, strip1, 300, 4000)
check("dragged above the screen is pulled back", near(ns.db.positions["worldmap"].y, SCREEN_H - 500), ns.db.positions["worldmap"].y)
DragTo(map, strip1, 300, 200)

-- The game hides and shows the map again: our position has to win.
map:Hide()
map:ClearAllPoints()
map:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 0, 0)
map:Show()
RunTimers(1)
check("position survives the game re-placing the map", near(map:GetLeft(), 300), map:GetLeft())

-- ------------------------------------------------------------------
-- 3. Scaling the map
-- ------------------------------------------------------------------
ns.Map.SetScale(1.3)
check("scale applied to the frame", near(map:GetScale(), 1.3, 0.001), map:GetScale())
check("scale remembered", near(ns.db.map.scale, 1.3, 0.001))
-- GetLeft is in the frame own units, so a scaled frame is measured through the addon helper.
local ml = ns.Windows.Measure(map)
check("map stays put after scaling", near(ml, 300, 1), ml)

ns.Map.SetScale(9)
check("scale is capped at the maximum", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(0.05)
check("scale is capped at the minimum", near(ns.db.map.scale, 0.5, 0.001), ns.db.map.scale)

-- Snapping: from an odd number the buttons land on round tens.
ns.Map.SetScale(0.97)
ns.Map.Step(1)
check("plus snaps up to the next ten percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.Step(1)
check("plus again is one whole step", near(ns.db.map.scale, 1.1, 0.001), ns.db.map.scale)
ns.Map.Step(-1)
check("minus comes back", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(1.03)
ns.Map.Step(-1)
check("minus snaps down to the previous ten percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(0.5)
ns.Map.Step(-1)
check("minus cannot go under the minimum", near(ns.db.map.scale, 0.5, 0.001), ns.db.map.scale)
ns.Map.SetScale(2.0)
ns.Map.Step(1)
check("plus cannot go over the maximum", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)

ns.db.map.step = 25
ns.Map.SetScale(1.0)
ns.Map.Step(1)
check("a different step is obeyed", near(ns.db.map.scale, 1.25, 0.001), ns.db.map.scale)
ns.db.map.step = 10
ns.Map.ResetSize()
check("reset goes back to 100 percent", near(ns.db.map.scale, 1.0, 0.001))

-- The tab under the map holds everything the addon adds, and stays the same size on screen
-- whatever the map is scaled to.
local tab = CasementMapTab
check("the map tab was built", tab ~= nil)
check("the tab wears the game's panel art", (ns.report["map tab panel"] or "") ~= "", ns.report["map tab panel"])
check("the tab hangs off the map itself", tab and tab.parent == map)
check("the resize grip lives in the tab, not on the map", CasementMapGrip and CasementMapGrip.parent == tab)
ns.Map.SetScale(2.0)
check("the tab counters the map scale", near(tab:GetScale(), 0.5, 0.001), tab:GetScale())
ns.Map.SetScale(1.0)

-- ------------------------------------------------------------------
-- 4. Resizing by the corner
-- ------------------------------------------------------------------
ns.Windows.Place(map, 300, 200)
local mapGrip = CasementMapGrip
local before = ns.db.map.scale
MOUSE_DOWN = true
-- The grip starts 700 across and 500 down from the top left corner of the map.
CURSOR = { 1000, 700 }
mapGrip.scripts.OnMouseDown(mapGrip)
CURSOR = { 1150, 600 }
mapGrip.scripts.OnUpdate(mapGrip)
check("dragging the corner out makes the map bigger", ns.db.map.scale > before, ns.db.map.scale)
local ml2, mb2, mw2, mh2 = ns.Windows.Measure(map)
local topAfter = mb2 + mh2
check("the opposite corner stayed still", near(topAfter, 700, 2), topAfter)
CURSOR = { 950, 780 }
mapGrip.scripts.OnUpdate(mapGrip)
check("dragging the corner in makes it smaller", ns.db.map.scale < 1.2, ns.db.map.scale)
SHIFT = true
CURSOR = { 1120, 630 }
mapGrip.scripts.OnUpdate(mapGrip)
local pct = ns.db.map.scale * 100
check("holding shift snaps the drag to ten percent", near(pct % 10, 0, 0.01) or near(pct % 10, 10, 0.01), pct)
SHIFT = false
mapGrip.scripts.OnMouseUp(mapGrip)
check("the resize loop stops when the mouse is let go", mapGrip.scripts.OnUpdate == nil)
check("the position is saved once the drag is over", ns.db.positions["worldmap"] ~= nil)

-- The grip slides away from under the cursor as the map grows, so a mouse up on the grip itself
-- may never arrive. The loop watches the button instead.
CURSOR = { 1000, 700 }
MOUSE_DOWN = true
mapGrip.scripts.OnMouseDown(mapGrip)
CURSOR = { 1100, 640 }
mapGrip.scripts.OnUpdate(mapGrip)
check("the resize is running", mapGrip.scripts.OnUpdate ~= nil)
MOUSE_DOWN = false
mapGrip.scripts.OnUpdate(mapGrip)
check("letting go anywhere on screen ends the resize", mapGrip.scripts.OnUpdate == nil)
ns.Map.SetScale(1.0)

-- ------------------------------------------------------------------
-- 4b. The quest panel, which is what broke the first version
-- ------------------------------------------------------------------
OpenQuestPanel(true)
RunTimers(1)
check("the quest panel is above the map's own level", QUEST_SCROLL.level > map.level)
check("the tab climbs above the quest panel", tab.level > QUEST_SCROLL.level, tab.level .. " vs " .. QUEST_SCROLL.level)
check("the report names the layer it reached", (ns.report["map tab layer"] or ""):find("%d"), ns.report["map tab layer"])

local wideStrips = TopStrips()
check("the top bar still has somewhere to grab with the panel open", #wideStrips > 0, #wideStrips)
local clash = false
for _, s in ipairs(wideStrips) do
  if Overlaps(s, MAP_NAV) or Overlaps(s, MAP_CLOSE) or Overlaps(s, QuestMapFrame) then clash = true end
end
check("and it still avoids the panel and the buttons", clash == false)

-- Resizing has to work with the panel open, which is the bug that was reported.
local pressesBefore = ns.Map.gripPresses
local scaleBefore = ns.db.map.scale
local ql, qb, qw, qh = ns.Windows.Measure(map)
CURSOR = { ql + qw, qb }
MOUSE_DOWN = true
mapGrip.scripts.OnMouseDown(mapGrip)
check("the grip in the tab took the click with the panel open", ns.Map.gripPresses == pressesBefore + 1)
CURSOR = { ql + qw + 120, qb - 80 }
mapGrip.scripts.OnUpdate(mapGrip)
check("and the map resized", ns.db.map.scale > scaleBefore, ns.db.map.scale)
MOUSE_DOWN = false
mapGrip.scripts.OnUpdate(mapGrip)
ns.Map.SetScale(1.0)

OpenQuestPanel(false)
RunTimers(1)
check("closing the panel leaves the top bar working", #TopStrips() > 0)
local bar = tab

-- ------------------------------------------------------------------
-- 5. Switching a window off
-- ------------------------------------------------------------------
local originalLeft = 20
ns.db.windows.worldmap = false
ns.Refresh()
check("the handle goes away", grip.shown == false)
check("the map goes back where the game had it", near(map:GetLeft(), originalLeft), map:GetLeft())
check("the scale bar is hidden too", bar.shown == false)
check("the map is back to its normal size", near(map:GetScale(), 1, 0.001))
ns.db.windows.worldmap = true
ns.Refresh()
check("switching it back on restores the saved position", near(map:GetLeft(), 300, 1), map:GetLeft())

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
  for _, entry in ipairs({ frame }) do end
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

-- ------------------------------------------------------------------
-- 7. The drag anywhere modifier
-- ------------------------------------------------------------------
local overlay
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.allPoints == map and f.dragButtons then overlay = f end
end
check("the map has a whole window drag overlay", overlay ~= nil)
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
map:Hide()
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("a hidden window gets no overlay", overlay.shown == false)
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
map:Show()
RunTimers(0.1)

-- ------------------------------------------------------------------
-- 8. Screen size changes
-- ------------------------------------------------------------------
ns.Windows.Place(map, 1200, 500)
SCREEN_W, SCREEN_H = 1024, 768
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("DISPLAY_SIZE_CHANGED")
check("a smaller screen pulls the map back on to it", map:GetLeft() + 700 <= SCREEN_W + 0.5, map:GetLeft())
SCREEN_W, SCREEN_H = 1920, 1080
UIParent.w, UIParent.h = SCREEN_W, SCREEN_H
fire("UI_SCALE_CHANGED")

-- ------------------------------------------------------------------
-- 9. The bank snapshot
-- ------------------------------------------------------------------
BankFrame:Show()
fire("BANKFRAME_OPENED")
RunTimers(1)

local me = ns.Who()
check("the character is named the way the vault keys it", me == "Vatik - Voidpact", me)
local record = ns.vault.chars[me]
check("a bank snapshot was taken", record ~= nil)
check("it saved the money too", record and record.money == 1234567)

local labels = {}
for _, bucket in ipairs(record.containers) do labels[#labels + 1] = bucket.label .. "=" .. bucket.id end
labels = table.concat(labels, ",")

-- What counts as the bank depends on whether this client carries Enum.BagIndex. With it, the real
-- storage is the character bank tabs and the legacy container is a ghost to be skipped; without
-- it, the classic ids are all there is to go on.
local EXPECT_ITEMS = NO_ENUM and 5 or 4
local EXPECT_FREE = NO_ENUM and ((32 - 1) + (12 - 0) + (48 - 3) + (48 - 1)) or ((48 - 3) + (48 - 1))
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

-- A slot changing while the bank is open re-reads it, but only once the storm is over.
BANK_ITEMS[6][12] = { id = 8153, name = "Wildvine", count = 2, quality = 1 }
fire("PLAYERBANKSLOTS_CHANGED", 12)
fire("PLAYERBANKSLOTS_CHANGED", 12)
fire("PLAYERBANKSLOTS_CHANGED", 12)
RunTimers(1)
check("a change while the bank is open is picked up", ns.vault.chars[me].items == EXPECT_ITEMS + 1,
  ns.vault.chars[me].items)

fire("BANKFRAME_CLOSED")
BankFrame:Hide()
check("the bank is marked shut", ns.Vault.BankIsOpen() == false)

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

local guild = ns.vault.guilds["Night Owls - Voidpact"]
check("a guild bank snapshot was taken", guild ~= nil)
check("every tab was asked for", #QUERIED == 3, #QUERIED)
check("the tabs were read", guild and guild.tabs and guild.tabs[1] ~= nil)
check("tab one has its items", guild and #guild.tabs[1].items == 2, guild and #guild.tabs[1].items)
check("tab two has its items", guild and #guild.tabs[2].items == 1)
check("a tab this character cannot see is marked", guild and guild.tabs[3].viewable == false)
check("the tab names were saved", guild and guild.tabs[1].name == "Vault 1", guild and guild.tabs[1].name)
check("the guild money was saved", guild and guild.money == 9876543)
check("the tab the user was looking at was put back", CURRENT_TAB == 2, CURRENT_TAB)

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
-- 11. The vault window
-- ------------------------------------------------------------------
ns.VaultUI.Show()
check("the vault window opened", CasementVault ~= nil and CasementVault.shown == true)
local sources = ns.Vault.Sources()
check("both banks are in the list", #sources == 2, #sources)
check("this character comes first", sources[1].kind == "char" and sources[1].mine == true)

local visible = 0
for _, f in ipairs(FRAMES) do
  if f.kind == "Button" and f.csItem and f.shown then visible = visible + 1 end
end
check("the saved bank is drawn as item cells", visible == EXPECT_ITEMS + 1, visible)

CasementVaultSearch:SetText("wool")
CasementVaultSearch.scripts.OnTextChanged(CasementVaultSearch)
visible = 0
for _, f in ipairs(FRAMES) do
  if f.kind == "Button" and f.csItem and f.shown then visible = visible + 1 end
end
check("searching narrows it down", visible == 1, visible)
CasementVaultSearch:SetText("")
CasementVaultSearch.scripts.OnTextChanged(CasementVaultSearch)

-- Switching to the guild bank
for _, source in ipairs(sources) do
  if source.kind == "guild" then
    for _, f in ipairs(FRAMES) do
      if f.parent and f.nameText and f.scripts.OnClick and (f.nameText.text or ""):find("Night Owls") then
        f.scripts.OnClick(f)
      end
    end
  end
end
visible = 0
for _, f in ipairs(FRAMES) do
  if f.kind == "Button" and f.csItem and f.shown then visible = visible + 1 end
end
check("the guild bank draws its items too", visible == 3, visible)

ns.Vault.Forget("guild", "Night Owls - Voidpact")
check("a record can be forgotten", ns.vault.guilds["Night Owls - Voidpact"] == nil)
check("the list drops to one", #ns.Vault.Sources() == 1)

-- ------------------------------------------------------------------
-- 11b. The minimap button
-- ------------------------------------------------------------------
local mm = CasementMinimapButton
check("the minimap button was built", mm ~= nil)
check("it sits on the minimap", mm and mm.parent == Minimap)
check("it is shown by default", mm and mm.shown == true)
check("it found an icon", (ns.report["minimap icon"] or ""):find("Interface"), ns.report["minimap icon"])

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
check("the angle is saved", near(CasementAccountDB.profile.minimap.angle, 180, 1))

CasementVault:Hide()
mm.scripts.OnClick(mm, "RightButton")
check("right-click opens the saved banks", CasementVault.shown == true)
mm.scripts.OnClick(mm, "RightButton")
check("and closes them again", CasementVault.shown == false)

SHIFT = true
local wasEnabled = ns.db.enabled
mm.scripts.OnClick(mm, "LeftButton")
check("shift and left-click locks everything", ns.db.enabled ~= wasEnabled)
mm.scripts.OnClick(mm, "LeftButton")
SHIFT = false
check("and unlocks it again", ns.db.enabled == wasEnabled)

ns.db.minimap.shown = false
ns.Refresh()
check("the button can be switched off", mm.shown == false)
ns.db.minimap.shown = true
ns.Refresh()

-- ------------------------------------------------------------------
-- 11c. The bank buttons on the bag window
-- ------------------------------------------------------------------
backpack:Hide()
backpack:Show()
RunTimers(0.1)

local bankButton, guildButton
for _, f in ipairs(FRAMES) do
  if f.text == "Bank" and f.kind == "Button" then bankButton = f end
  if f.text == "Guild" and f.kind == "Button" then guildButton = f end
end
check("the backpack got a Bank button", bankButton ~= nil)
check("it is on the backpack", bankButton and bankButton.parent and bankButton.parent.parent == backpack)
check("it is shown", bankButton and bankButton.parent.shown == true)
check("the report says where it went", (ns.report["bag buttons"] or ""):find("header") or (ns.report["bag buttons"] or ""):find("above"), ns.report["bag buttons"])

-- It has to keep clear of the game's own close button in that header.
local holder = bankButton.parent
local hl, hb, hw = ns.Windows.Measure(holder)
local cl, cb, cw = ns.Windows.Measure(backpack.testClose)
check("the buttons keep clear of the game's close button", hl and cl and (hl + hw <= cl + 0.5 or cl + cw <= hl + 0.5),
  tostring(hl) .. "+" .. tostring(hw) .. " vs " .. tostring(cl))

-- With a guild bank saved there is a Guild button too, and it opens that record.
check("the Guild button only appears with a guild bank saved", guildButton == nil or guildButton.parent.guild.shown == false)
ns.vault.guilds["Night Owls - Voidpact"] = { time = time(), tabs = { [1] = { name = "Vault 1", items = {} } } }
ns.BagHeader.Update(backpack)
guildButton = holder.guild
check("the Guild button turns up once there is one", guildButton.shown == true)

CasementVault:Hide()
bankButton.scripts.OnClick(bankButton)
check("the Bank button opens the vault", CasementVault.shown == true)
guildButton.scripts.OnClick(guildButton)
check("the Guild button opens it at the guild bank", CasementVault.shown == true)
CasementVault:Hide()
ns.vault.guilds["Night Owls - Voidpact"] = nil

ns.db.vault.bagButtons = false
ns.Refresh()
check("the bag buttons can be switched off", holder.shown == false)
ns.db.vault.bagButtons = true
ns.Refresh()

-- ------------------------------------------------------------------
-- 11d. The corner handle comes back when the top bar has no room
-- ------------------------------------------------------------------
local hog = CreateFrame("Frame", nil, map)
hog:SetSize(700, 26)
hog:SetPoint("TOPLEFT", map, "TOPLEFT", 0, 0)
hog:EnableMouse(true)
hog:SetFrameLevel(6)
ns.Map.Apply()
check("a full top bar leaves no draggable stretches", ns.Map.stripCount == 0, ns.Map.stripCount)
check("so the corner handle shows itself instead", grip.shown == true)
hog:Hide()
ns.Map.Apply()
check("and goes away again once there is room", grip.shown == false)
check("the top bar is back", ns.Map.stripCount > 0)

ns.db.map.cornerHandle = true
ns.Refresh()
check("the handle can also be asked for outright", grip.shown == true)
ns.db.map.cornerHandle = false
ns.Refresh()

-- ------------------------------------------------------------------
-- 12. Slash commands
-- ------------------------------------------------------------------
local slash = SlashCmdList["CASEMENT"]
check("slash command registered", type(slash) == "function")
slash("scale 140")
check("/casement scale sets the size", near(ns.db.map.scale, 1.4, 0.001), ns.db.map.scale)
slash("scale 1.6")
check("/casement scale also takes a fraction", near(ns.db.map.scale, 1.6, 0.001), ns.db.map.scale)
slash("scale 500")
check("/casement scale is capped", near(ns.db.map.scale, 2.0, 0.001), ns.db.map.scale)
ns.Map.ResetSize()
slash("lock")
local anyOn = false
for _, on in pairs(ns.db.windows) do if on then anyOn = true end end
check("/casement lock turns every window off", anyOn == false)
slash("unlock")
local allOn = true
for _, on in pairs(ns.db.windows) do if not on then allOn = false end end
check("/casement unlock turns them all back on", allOn == true)
slash("reset")
check("/casement reset forgets every position", next(ns.db.positions) == nil)
slash("snapshot")
check("/casement snapshot says there is nothing open", CHAT[#CHAT]:find("nothing to save") ~= nil, CHAT[#CHAT])
slash("debug")
slash("grips")
check("/casement grips toggles the outlines", ns.db.showGrips == true)
slash("grips")
slash("vault")
slash("")
slash("nonsense")
check("nothing above threw", true)

-- ------------------------------------------------------------------
-- 13. Options widgets
-- ------------------------------------------------------------------
ns.SyncOptions()
local checks, buttons = 0, 0
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" then checks = checks + 1 end
  if f.kind == "Button" then buttons = buttons + 1 end
end
check("the options page has its switches", checks >= 11, checks)
check("the options page has its buttons", buttons >= 12, buttons)

-- Clicking the master switch off turns everything off and back on again.
local master
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" and not master then master = f end
end
master:SetChecked(false)
master.scripts.OnClick(master)
check("the master switch writes through", ns.db.enabled == false)
master:SetChecked(true)
master.scripts.OnClick(master)
check("and back on", ns.db.enabled == true)

-- ------------------------------------------------------------------
-- 14. Saved variables
-- ------------------------------------------------------------------
ns.db.map.scale = 1.2
ns.MirrorToAccount()
check("settings are mirrored account wide", CasementAccountDB.profile.map.scale == 1.2)
check("the vault is stored account wide", CasementAccountDB.vault.chars[me] ~= nil)

local savedVault = CasementAccountDB.vault
CasementDB = {}
fire("PLAYER_LOGIN")
check("a blank character table adopts the account copy", near(ns.db.map.scale, 1.2, 0.001), ns.db.map.scale)
check("and the report says so", ns.report["db player login"] == "adopted the account copy", ns.report["db player login"])
check("positions are not inherited from another character", next(ns.db.positions) == nil)
check("the vault survived", ns.vault.chars[me] ~= nil)

ns.ResetToDefaults()
check("a reset keeps the saved banks", ns.vault.chars[me] ~= nil)
check("a reset puts the settings back", near(ns.db.map.scale, 1.0, 0.001))

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

print(("RESULT pass=%d fail=%d"):format(PASS, FAIL))
`;

function run(code, name) {
  if (lauxlib.luaL_loadbuffer(L, to_luastring(code), null, to_luastring(name)) !== 0 || lua.lua_pcall(L, 0, 0, 0) !== 0) {
    console.log('LUA ERROR in ' + name + ': ' + lua.lua_tojsstring(L, -1)); process.exit(1);
  }
}
lua.lua_newtable(L);
for (const f of files) { lua.lua_pushstring(L, to_luastring(fs.readFileSync(DIR + f, 'utf8'))); lua.lua_setfield(L, -2, to_luastring(f)); }
lua.lua_setglobal(L, to_luastring('SOURCES'));
lua.lua_newtable(L); files.forEach((f, i) => { lua.lua_pushstring(L, to_luastring(f)); lua.lua_rawseti(L, -2, i + 1); });
lua.lua_setglobal(L, to_luastring('FILES'));

const pre = (process.argv.includes('--bare')
  ? 'BARE=true\nBAD_ATLAS=true\nBAD_TEMPLATES={TooltipBackdropTemplate=true,UICheckButtonTemplate=true,ChatConfigCheckButtonTemplate=true,MinimalSliderTemplate=true,UISliderTemplate=true,OptionsSliderTemplate=true,UIPanelButtonTemplate=true,UIPanelCloseButton=true,DefaultPanelFlatTemplate=true,DefaultPanelTemplate=true,ButtonFrameTemplate=true,BasicFrameTemplate=true,BackdropTemplate=true,SearchBoxTemplate=true,InputBoxTemplate=true}\n'
  : '') + (process.argv.includes('--verbose') ? 'VERBOSE=true\n' : '')
  + (process.argv.includes('--noenum') ? 'NO_ENUM=true\n' : '');
run(pre + stub, 'stub');
run(driver, 'driver');

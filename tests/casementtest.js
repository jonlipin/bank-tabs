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
const files = ['Core.lua', 'Windows.lua', 'Map.lua', 'Data/MapOverlays.lua', 'Reveal.lua', 'Minimap.lua', 'Vault.lua', 'VaultUI.lua', 'BagHeader.lua', 'Tooltips.lua', 'Options.lua'];

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
    -- One real tab, and the purchasable bank bag slots as their own containers. A container can
    -- only ever be one of the two, which is what the bag slot matching relies on.
    CharacterBankTab_1 = 6, BankBag_1 = 7, BankBag_2 = 8,
  } }
else
  Enum = {}
end

-- The legacy bank container still reports slots on this client even though nothing can be put in
-- it, which is exactly the trap the scan has to avoid.
-- Bags 0 to 4 are the carried bags, 5 is the reagent bag, 6 the real bank tab and 7 the one bank
-- bag that is equipped in the first Bag Slot.
SLOTS = { [0] = 16, [1] = 16, [2] = 16, [3] = 14, [4] = 12, [5] = 12, [-1] = 32, [-3] = 0, [6] = 48, [7] = 48 }

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
KNOWN_ATLASES = { ["bags-item-slot64"] = true, ["UI-HUD-ActionBar-IconFrame-Mask"] = true, ["spellbook-Tab-Frame-C60"] = true,
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

-- ------------------------------------------------------------------
-- The game's own windows
-- ------------------------------------------------------------------

WorldMapFrame = CreateFrame("Frame", "WorldMapFrame", UIParent)
WorldMapFrame:SetSize(700, 500)
WorldMapFrame:SetPoint("TOPLEFT", UIParent, "TOPLEFT", 20, -100)
WorldMapFrame.ScrollContainer = CreateFrame("Frame", nil, WorldMapFrame)
-- The canvas the map art is drawn on, at the art's native size, and the map ids around it.
WorldMapFrame.ScrollContainer.Child = CreateFrame("Frame", nil, WorldMapFrame.ScrollContainer)
WorldMapFrame.ScrollContainer.Child:SetSize(1002, 668)
WorldMapFrame.ScrollContainer.Child:SetPoint("TOPLEFT", WorldMapFrame.ScrollContainer, "TOPLEFT", 0, 0)
SHOWN_MAP = 1440
rawset(WorldMapFrame, "GetMapID", function() return SHOWN_MAP end)
CURSOR_NORM = { 0.123, 0.456 }
rawset(WorldMapFrame.ScrollContainer, "GetNormalizedCursorPosition", function()
  if not CURSOR_NORM then return nil end
  return CURSOR_NORM[1], CURSOR_NORM[2]
end)

-- Secret values: a widget takes them, arithmetic on them is an error, exactly like the client.
SECRETS = setmetatable({}, { __mode = "k" })
function issecretvalue(v) return SECRETS[v] == true end
function MakeSecret() local t = {} SECRETS[t] = true return t end

PLAYER_MAP = 1440
PLAYER_POS = { 0.452, 0.678 }
MAP_NAMES = { [1440] = "The Barrens", [1414] = "Kalimdor" }
MAP_ART = { [1440] = 5, [1414] = 12 }
C_Map = {
  GetBestMapForUnit = function() return PLAYER_MAP end,
  GetPlayerMapPosition = function(mapID, unit)
    if not PLAYER_POS then return nil end
    return { x = PLAYER_POS[1], y = PLAYER_POS[2], GetXY = function(self) return self.x, self.y end }
  end,
  GetMapArtID = function(mapID) return MAP_ART[mapID] end,
  GetMapInfo = function(mapID) if MAP_NAMES[mapID] then return { name = MAP_NAMES[mapID], mapID = mapID } end return nil end,
}

-- What the game hands over for explored areas, in the shape the real API uses.
EXPLORED = {
  [1440] = {
    { textureWidth = 300, textureHeight = 200, offsetX = 100, offsetY = 50, fileDataIDs = { 111, 112 } },
  },
}
C_MapExplorationInfo = {
  GetExploredMapTextures = function(mapID) return EXPLORED[mapID] end,
}

-- The chat line: either open (text goes in at the cursor) or shut (a fresh line is opened).
CHAT_EDIT = obj("EditBox")
CHAT_EDIT:Hide()
rawset(CHAT_EDIT, "Insert", function(self, text) self.inserted = (self.inserted or "") .. text end)
function ChatEdit_GetActiveWindow() return CHAT_EDIT end
OPENED_CHAT = nil
function ChatFrame_OpenChat(text) OPENED_CHAT = text end

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
C_Item.GetItemCount = function(id, includeBank) return LIVE_COUNTS[id] or 0 end
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
-- The account file already holds a character saved by 1.0.x, in the old shape where the bank
-- record sat directly under the character's name. It has to come through the upgrade intact.
CasementAccountDB = { vault = { chars = {
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
fire("ADDON_LOADED", "Casement")

check("db built", type(ns.db) == "table" and ns.db.windows ~= nil)
check("defaults filled in", ns.db.map.step == 10 and ns.db.dragModifier == "alt")
check("vault tables built", type(ns.vault) == "table" and type(ns.vault.chars) == "table" and type(ns.vault.guilds) == "table")
check("the vault is the account file's own table", ns.vault == CasementAccountDB.vault)
check("the old setting that kept other characters is gone", ns.db.vault.keepOtherCharacters == nil)
check("the new defaults are in", ns.db.minimap.shown == true and ns.db.minimap.angle == 205 and ns.db.map.topBarDrag == true
  and ns.db.map.cornerHandle == false and ns.db.vault.bagButtons == true)
-- Two at load: the 1.0.x record and the name keyed copy of this character, which the first
-- snapshot folds in.
check("the report counts the saved characters", ns.report["vault holds"] == "2 characters, 0 guild banks", ns.report["vault holds"])
check("the bank bag slots API was found", ns.report["bank bag slots api"] == "BankButtonIDToInvSlotID", ns.report["bank bag slots api"])
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

do -- scope: 4d. Coordinates in the tab
-- ------------------------------------------------------------------
-- 4d. Coordinates in the tab, and the copy button
-- ------------------------------------------------------------------
map:Show()
RunTimers(1)
local coordsPart = CasementMapCoords
local copyBtn = CasementMapCopy
check("the tab carries a coordinates part", coordsPart ~= nil and coordsPart.parent == tab)
check("and a copy button", copyBtn ~= nil and copyBtn.parent == tab)
check("coordinates are on by default and shown", ns.db.map.coords == true and coordsPart.shown == true)
check("the coordinates sit at the left end of the tab", coordsPart.points[1] and coordsPart.points[1][4] == 10, coordsPart.points[1] and coordsPart.points[1][4])
local minusBtn
for _, f in ipairs(FRAMES) do if f.parent == tab and f.text == "-" then minusBtn = f end end
check("the sizing controls sit to the right of them", minusBtn and minusBtn.points[1][4] > coordsPart.points[1][4] + coordsPart.w)
local wideTab = tab.w
ns.db.map.coords = false
ns.Refresh()
check("switching the coordinates off hides them", coordsPart.shown == false and copyBtn.shown == false)
check("and the tab shrinks back from the left", tab.w < wideTab, tab.w .. " vs " .. wideTab)
local minusX = minusBtn.points[1][4]
ns.db.map.coords = true
ns.Refresh()
check("switching them on grows the tab leftwards, the sizing end staying put", tab.w > minusX and minusBtn.points[1][4] > minusX)

-- The readout.
local function LineStarting(prefix)
  for _, fs in ipairs(FONTSTRINGS) do
    if fs.parent == coordsPart and type(fs.text) == "string" and fs.text:sub(1, #prefix) == prefix then return fs end
  end
  return nil
end
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("your position is printed as hundredths", LineStarting("You") and LineStarting("You").text == "You  45.2, 67.8", LineStarting("You") and LineStarting("You").text)
check("the cursor position too", LineStarting("Cursor") and LineStarting("Cursor").text == "Cursor  12.3, 45.6", LineStarting("Cursor") and LineStarting("Cursor").text)
CURSOR_NORM = nil
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("a cursor off the map shows dashes", LineStarting("Cursor").text == "Cursor  --")
CURSOR_NORM = { 0.123, 0.456 }
ns.db.map.coordsCursor = false
ns.Refresh()
coordsPart.scripts.OnUpdate(coordsPart, 1)
check("the cursor line can be switched off on its own", LineStarting("Cursor").shown == false)
ns.db.map.coordsCursor = true
ns.Refresh()

-- A position this client keeps secret is shown as unknown, never compared.
local realPos = PLAYER_POS
PLAYER_POS = { MakeSecret(), MakeSecret() }
local okSecret = pcall(coordsPart.scripts.OnUpdate, coordsPart, 1)
check("a secret position does not error", okSecret)
check("and is shown as unknown", LineStarting("You").text == "You  --", LineStarting("You").text)
PLAYER_POS = realPos
coordsPart.scripts.OnUpdate(coordsPart, 1)

-- The copy button.
check("the copy text names the zone first", ns.Map.PlayerCoordText() == "The Barrens 45.2, 67.8", ns.Map.PlayerCoordText())
CHAT_EDIT:Hide()
OPENED_CHAT = nil
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with no chat line open, the click opens one with the position in it", OPENED_CHAT == "The Barrens 45.2, 67.8", OPENED_CHAT)
CHAT_EDIT:Show()
CHAT_EDIT.inserted = nil
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with a chat line open, the click puts the position into it", CHAT_EDIT.inserted == "The Barrens 45.2, 67.8", CHAT_EDIT.inserted)
CHAT_EDIT:Hide()
copyBtn.scripts.OnClick(copyBtn, "RightButton")
check("right-click opens the copy box", CasementCopyBox ~= nil and CasementCopyBox.shown == true)
check("with the position in it", CasementCopyBox and CasementCopyBox.edit.text == "The Barrens 45.2, 67.8")
CasementCopyBox:Hide()
PLAYER_POS = nil
copyBtn.scripts.OnClick(copyBtn, "LeftButton")
check("with no position to give, the click says so instead", CHAT[#CHAT]:find("not available") ~= nil, CHAT[#CHAT])
PLAYER_POS = realPos
SlashCmdList["CASEMENT"]("coords")
check("/casement coords opens the copy box", CasementCopyBox.shown == true)
CasementCopyBox:Hide()

-- ------------------------------------------------------------------
-- 4e. Drawing the unexplored map
-- ------------------------------------------------------------------
local canvasChild = WorldMapFrame.ScrollContainer.Child
local function RevealTiles()
  local out = {}
  for _, t in ipairs(TEXTURES) do
    if t.parent == canvasChild and t.shown and t.texture then out[#out + 1] = t end
  end
  return out
end

check("the reveal found the exploration API", ns.report["map reveal api"] == "GetExploredMapTextures found", ns.report["map reveal api"])
check("the reveal is off by default", ns.db.map.reveal == false)

-- The shipped table, straight from the client's WorldMapOverlay and WorldMapOverlayTile tables.
local shippedMaps = 0
for _ in pairs(ns.Reveal.DATA) do shippedMaps = shippedMaps + 1 end
check("the shipped overlay table is present", shippedMaps >= 60, shippedMaps)
check("the report counts it", (ns.report["map reveal data"] or ""):find("^" .. shippedMaps .. " maps shipped") ~= nil, ns.report["map reveal data"])
-- Overlay 84 in the tables: map art 1244, 160 by 210 at 382,281, one tile, file 272826.
check("a known overlay is in it with its tile", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["160:210:382:281"] == "272826", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["160:210:382:281"])
-- Overlay 85: 315 wide, so two tiles across, in row-major order.
check("a two tile overlay lists its tiles left to right", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["315:256:101:247"] == "272806, 272812", ns.Reveal.DATA[1244] and ns.Reveal.DATA[1244]["315:256:101:247"])
-- Every entry in the table has exactly the tiles its size calls for.
local badShape = 0
for _, overlays in pairs(ns.Reveal.DATA) do
  for key, ids in pairs(overlays) do
    local w, h = key:match("^(%d+):(%d+):")
    local want = math.ceil(tonumber(w) / 256) * math.ceil(tonumber(h) / 256)
    local got = 0
    for _ in tostring(ids):gmatch("%d+") do got = got + 1 end
    if got ~= want then badShape = badShape + 1 end
  end
end
check("every shipped overlay has exactly the tiles its size needs", badShape == 0, badShape)
ns.Reveal.Refresh(true)
check("off, it draws nothing", #RevealTiles() == 0, #RevealTiles())

-- Shipped data for The Barrens' art: the explored overlay the game already draws, one it does
-- not, and one that spans two tiles.
ns.Reveal.DATA[5] = {
  ["300:200:100:50"] = "111, 112",
  ["120:80:600:300"] = "201",
  ["500:200:0:400"] = "301, 302",
}
ns.db.map.reveal = true
ns.db.map.revealTint = "blue"
ns.Refresh()
local tiles = RevealTiles()
check("on, it draws the overlays the game is not drawing", #tiles == 3, #tiles)
local function TileAt(x, y)
  for _, t in ipairs(tiles) do
    if t.points[1] and t.points[1][4] == x and t.points[1][5] == y then return t end
  end
  return nil
end
check("the explored overlay is left to the game", TileAt(100, -50) == nil)
local small = TileAt(600, -300)
check("a small overlay is one tile at its offset", small ~= nil and small.texture == 201)
check("sized to the overlay, not to the tile", small and small.w == 120 and small.h == 80)
check("showing only the used part of its file", small and small.texCoord and near(small.texCoord[2], 120 / 128, 0.001) and near(small.texCoord[4], 80 / 128, 0.001))
local first, second = TileAt(0, -400), TileAt(256, -400)
check("a wide overlay is cut into 256 pixel tiles", first ~= nil and second ~= nil)
check("the first tile is a full 256 wide", first and first.w == 256 and first.texture == 301)
check("the last tile is the remainder", second and second.w == 244 and second.h == 200 and second.texture == 302)
check("the last tile shows 244 of a 256 file", second and second.texCoord and near(second.texCoord[2], 244 / 256, 0.001))
check("the drawn in areas are tinted", small and small.vertex and near(small.vertex[1], 0.62, 0.001) and near(small.vertex[3], 1.0, 0.001))
check("the tiles sit under the game's own overlays", small and small.sub == -1)
check("the report says what was drawn", (ns.report["map reveal"] or ""):find("2 drawn") ~= nil, ns.report["map reveal"])

ns.db.map.revealTint = "none"
ns.Refresh()
small = TileAt(600, -300)
check("no tint leaves the art as it is", small and (small.vertex == nil or (near(small.vertex[1], 1, 0.001) and near(small.vertex[2], 1, 0.001))))

-- The harvest: what the game handed over is remembered account wide.
check("the explored overlay was harvested", CasementAccountDB.overlays and CasementAccountDB.overlays[5] and CasementAccountDB.overlays[5]["300:200:100:50"] == "111, 112")

-- Exploring an area takes it out of our drawing on the next update.
EXPLORED[1440][#EXPLORED[1440] + 1] = { textureWidth = 120, textureHeight = 80, offsetX = 600, offsetY = 300, fileDataIDs = { 201 } }
fire("MAP_EXPLORATION_UPDATED")
tiles = RevealTiles()
check("an area explored since is handed back to the game", TileAt(600, -300) == nil and #tiles == 2, #tiles)

-- An overlay only the harvest knows about (say, from another character) is drawn too.
CasementAccountDB.overlays[5]["64:64:900:600"] = "401"
ns.Reveal.Refresh(true)
tiles = RevealTiles()
check("harvested overlays are drawn like shipped ones", TileAt(900, -600) ~= nil and TileAt(900, -600).texture == 401)

check("the report describes the shown map", ns.Reveal.Describe():find("The Barrens") ~= nil, ns.Reveal.Describe())
local dumped = ns.Reveal.Dump()
check("the dump opens the copy box with the harvest as Lua", dumped == 1 and CasementCopyBox.shown == true and CasementCopyBox.edit.text:find('%[5%] = {') ~= nil)
check("with every harvested overlay in it", CasementCopyBox.edit.text:find('%["64:64:900:600"%] = "401"') ~= nil)
CasementCopyBox:Hide()
SlashCmdList["CASEMENT"]("mapdata")
check("/casement mapdata prints the report", CHAT[#CHAT]:find("The Barrens") ~= nil, CHAT[#CHAT])

-- Switching the world map feature off takes the reveal with it.
ns.db.windows.worldmap = false
ns.Refresh()
check("switching the map feature off clears the reveal", #RevealTiles() == 0)
ns.db.windows.worldmap = true
ns.db.map.reveal = false
ns.Reveal.DATA[5] = nil
ns.Refresh()

end -- scope

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
check("the character is keyed by GUID, which never changes", me == "Player-70-0A1B2C3D", me)
check("the name and realm are still to hand", ns.NameKey() == "Vatik - Voidpact", ns.NameKey())
check("and the entry carries them for display", ns.Label(me) == "Vatik - Voidpact" and ns.ShortLabel(me) == "Vatik", ns.Label(me))
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
check("the first bag slot hangs off the right inventory slot", bagSlots and bagSlots[1].inv == 68, bagSlots and bagSlots[1].inv)
check("the first bag slot is purchased and holds the bank bag", bagSlots and bagSlots[1].purchased == true
  and bagSlots[1].icon == INVENTORY[68].icon)
check("the bag slot names the container the bag opens as", bagSlots and bagSlots[1].id == 7, bagSlots and bagSlots[1].id)
check("and how many slots that bag has", bagSlots and bagSlots[1].slots == 48, bagSlots and bagSlots[1].slots)
check("the bag's link was kept", bagSlots and bagSlots[1].link == INVENTORY[68].link)
check("an unbought slot is marked so", bagSlots and bagSlots[2].purchased == false, bagSlots and tostring(bagSlots[2].purchased))
check("an unbought slot holds no bag", bagSlots and bagSlots[7].id == nil and bagSlots[7].slots == 0)
check("the bank bag's items are in the record too", BucketByID(record, 7) ~= nil and #BucketByID(record, 7).items == 1)

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
BankFrame:Hide()
fire("BANKFRAME_CLOSED")
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
check("the account copy was written at logout", CasementAccountDB.profile ~= nil)

-- ------------------------------------------------------------------
-- 9c. Records saved by 1.0.x are lifted into the new shape
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
-- 11. The vault window: a replica of the bank
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
local function ClassicXY(col, row) return 48 + col * 49, -(63 + row * 47) end
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

ns.VaultUI.Show("bank")
vault = CasementVault
check("the vault window opened", vault ~= nil and vault.shown == true)
check("it wears a portrait window", (ns.report["vault panel"] or "") ~= "", ns.report["vault panel"])
check("the report calls it a replica", ns.report["vault window"] == "ok, replica", ns.report["vault window"])
check("the window is titled like the bank", vault.csTitle and vault.csTitle.text == "Bank", vault.csTitle and vault.csTitle.text)
check("it opened in bank mode", ns.VaultUI.Mode() == "bank", ns.VaultUI.Mode())
check("looking at this character", ns.VaultUI.Selected() == me, ns.VaultUI.Selected())
check("it closes on escape", UISpecialFrames[#UISpecialFrames] == "CasementVault")

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

local grid = Cells(37)
check("the 48 slot tab is drawn as 48 cells", #grid == 48, #grid)
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
check("the grid holds exactly the tab's items", itemCount == 4, itemCount)
check("a stack shows its count", first and first.count.text == 20, first and tostring(first.count.text))
check("an empty cell shows no count", second and second.count.text == "", second and tostring(second.count.text))
-- Only uncommon and better wear the quality glow, as in the real bank: the wool (quality 2) does,
-- the linen (quality 1) and the empty slot do not.
check("an uncommon item wears the quality glow", fourth and fourth.border.shown == true)
check("a common item and an empty slot do not", first and first.border.shown == false and second.border.shown == false)
check("the glow is the game's own atlas or a ring, never a flat square", first and (first.borderIsGlow == true or first.ring ~= nil))

local backing
for _, t in ipairs(TEXTURES) do if t.parent == first and t.layer == "BACKGROUND" then backing = t end end
if BARE then
  check("with no atlas the empty slot is painted", backing and backing.color ~= nil)
else
  check("empty slots wear the game's slot art", backing and backing.atlas == "bags-item-slot64", backing and backing.atlas)
end

-- The Bag Slots row under the grid.
local bagRow = BagRow()
check("the Bag Slots row has this client's eight cells", #bagRow == 8, #bagRow)
check("it sits where the real bank's Bag Slots sit", bagRow[1] and near(bagRow[1].points[1][4], 145) and near(bagRow[1].points[1][5], -359),
  bagRow[1] and bagRow[1].points[1][5])
check("the cells are the measured size, on the measured pitch, at the measured place", bagRow[1] and bagRow[1].w == 24
  and bagRow[1].points[1][4] == 145 and bagRow[1].points[1][5] == -359 and bagRow[8].points[1][4] == 145 + 7 * 38)
check("the label says Bag Slots", TextOn(vault, "Bag Slots:") ~= nil)
check("the first bag slot shows the bank bag's icon", bagRow[1] and bagRow[1].icon.shown == true
  and bagRow[1].icon.texture == INVENTORY[68].icon and bagRow[1]:GetAlpha() == 1)
local dimmed = true
for i = 2, 7 do
  if not bagRow[i] or bagRow[i]:GetAlpha() ~= 0.45 or bagRow[i].icon.shown or not bagRow[i].shown then dimmed = false end
end
check("the unbought slots are dimmed, not hidden", dimmed)
check("the bag slot tooltips run", pcall(bagRow[1].scripts.OnEnter, bagRow[1]) and pcall(bagRow[8].scripts.OnEnter, bagRow[8]))

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
-- Back to the tab that was showing before the bag was opened, not to the first tab: under the
-- classic fallback the side tab "Bank bag 2" (48 slots) had been clicked, under the enum there
-- is only the one 48 slot tab.
check("clicking the bag again goes back to the tab that was showing", CellWith(grid, 13446) == nil and #grid == 48, #grid)
check("and the outline goes", bagRow[1].border.shown == false)
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
CasementVaultSearch:SetText("wool")
CasementVaultSearch.scripts.OnTextChanged(CasementVaultSearch)
grid = Cells(37)
check("searching keeps every cell on screen", #grid == 48, #grid)
local wool = CellWith(grid, 2592)
check("the match stays bright", wool and wool:GetAlpha() == 1)
local linen = CellWith(grid, 2589)
check("a non-match is dimmed to a quarter, not hidden", linen and linen.shown and linen:GetAlpha() == 0.25, linen and linen:GetAlpha())
local dimCount = 0
for _, c in ipairs(grid) do if c.csItem and c:GetAlpha() == 0.25 then dimCount = dimCount + 1 end end
check("every other item is dimmed", dimCount == 3, dimCount)
CasementVaultSearch:SetText("WOOL")
CasementVaultSearch.scripts.OnTextChanged(CasementVaultSearch)
check("the search ignores case", CellWith(Cells(37), 2592):GetAlpha() == 1 and CellWith(Cells(37), 2589):GetAlpha() == 0.25)
CasementVaultSearch:SetText("")
CasementVaultSearch.scripts.OnTextChanged(CasementVaultSearch)
local bright = true
for _, c in ipairs(Cells(37)) do if c:GetAlpha() ~= 1 then bright = false end end
check("clearing the search brightens everything", bright)
CasementVaultSearch.scripts.OnEscapePressed(CasementVaultSearch)

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
check("the window switches to guild mode", ns.VaultUI.Mode() == "guild")
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
check("looking at the unviewable tab shows an empty grid", #Cells(37) == 98 and ItemCount(Cells(37)) == 0)
check("and it is the one outlined now", side[3].border.shown == true and side[1].border.shown == false)
side[2].scripts.OnClick(side[2])
local ruby = CellWith(Cells(37), 7910)
check("tab two shows the star ruby in slot 3, third down", ruby ~= nil and ruby == CellAt(Cells(37), GridXY(0, 2)))
check("the character tabs are hidden in guild mode", #CharTabs() == 0, #CharTabs())
check("there is no Bag Slots row in guild mode", #BagRow() == 0 and TextOn(vault, "Bag Slots:") == nil)
check("the guild money is shown", TextOn(vault, ns.Money(9876543)) ~= nil)

-- ------------------------------------------------------------------
-- 11b. The bags replica: the combined backpack, filled from the bottom right
-- ------------------------------------------------------------------
ns.VaultUI.Show("bags")
check("the window switches to bags mode", ns.VaultUI.Mode() == "bags")
check("it is titled like the combined backpack", vault.csTitle.text == "Combined Backpack", vault.csTitle.text)
grid = Cells(37)
local ORDINARY = 16 + 16 + 16 + 14 + 12
local EXPECT_CELLS = ORDINARY + (NO_ENUM and 0 or 12)
check("every carried slot is drawn", #grid == EXPECT_CELLS, #grid)
check("that is the sum of the bag sizes", #grid == ns.vault.chars[me].bags.slots)
local hearth = CellWith(grid, 6948)
check("backpack slot 1 is the bottom right cell of the grid", hearth ~= nil and hearth == CellAt(grid, GridXY(9, 7)),
  hearth and (hearth.points[1][4] .. "," .. hearth.points[1][5]))
-- Nothing in the ordinary grid sits further right or further down than it.
local cornerOK = true
local hx, hy = hearth and hearth.points[1][4], hearth and hearth.points[1][5]
for _, c in ipairs(grid) do
  local p = c.points[1]
  if hx and p[5] >= -(62 + 7 * 42) - 0.01 and (p[4] > hx + 0.01 or p[5] < hy - 0.01) then cornerOK = false end
end
check("no ordinary cell is further right or lower than the backpack's first slot", cornerOK)
local water = CellWith(grid, 159)
check("backpack slot 16 is one row up, six from the right", water ~= nil and water == CellAt(grid, GridXY(4, 6)),
  water and (water.points[1][4] .. "," .. water.points[1][5]))
local shard = CellWith(grid, 6265)
check("bag 4's last slot is the top left most cell", shard ~= nil and shard == CellAt(grid, GridXY(6, 0)),
  shard and (shard.points[1][4] .. "," .. shard.points[1][5]))
check("nothing sits left of it on the top row", CellAt(grid, GridXY(5, 0)) == nil and CellAt(grid, GridXY(7, 0)) ~= nil)
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

-- ------------------------------------------------------------------
-- 11c. The character tabs along the top
-- ------------------------------------------------------------------
ns.VaultUI.Show("bank")
local ctabs = CharTabs()
check("three characters have a bank saved, so three tabs", #ctabs == 3, #ctabs)
local sized, hung = true, true
for i, t in ipairs(ctabs) do
  if t.w ~= 43 or t.h ~= 37 then sized = false end
  local p = t.points[1]
  if not (p and p[1] == "BOTTOMLEFT" and p[2] == vault and p[3] == "TOPLEFT" and near(p[4], 64 + (i - 1) * 45) and near(p[5], -8)) then hung = false end
end
check("the tabs are the spellbook's size", sized)
check("they hang off the top edge of the window, in a row", hung)
check("the first is this character", ctabs[1] and ctabs[1].csWho == me, ctabs[1] and ctabs[1].csWho)
check("and is the chosen one", ctabs[1] and ctabs[1].icon:GetAlpha() == 1 and ctabs[2].icon:GetAlpha() == 0.85)
check("the second is the other character, by name", ctabs[2] ~= nil and ctabs[2].csWho == CHOHAM and ctabs[3] ~= nil and ctabs[3].csWho == "Oldtoon - Voidpact")
check("the tabs sit one level under the window", ctabs[1] and ctabs[1].level == math.max(0, vault.level - 1))
check("the class icon comes from the class sheet with that class's coordinates", ctabs[1] and ctabs[1].icon.texture == CLASS_SHEET
  and ctabs[1].icon.texCoord and ctabs[1].icon.texCoord[1] == 0.5 and ctabs[1].icon.texCoord[2] == 0.75
  and ctabs[1].icon.texCoord[3] == 0.25 and ctabs[1].icon.texCoord[4] == 0.5)
check("the warrior gets the warrior's corner of the sheet", ctabs[2] and ctabs[2].icon.texture == CLASS_SHEET and ctabs[2].icon.texCoord[2] == 0.25)
check("a class the sheet does not know falls back to a plain icon", ctabs[3] ~= nil and ctabs[3].icon.texture ~= CLASS_SHEET
  and (ctabs[3].icon.texture or ""):find("Interface") ~= nil, ctabs[3] and ctabs[3].icon.texture)
if BARE then
  check("with no spellbook atlas the tabs use a plain bevel", ns.report["character tab art"] == "plain bevel (no spellbook atlas on this client)",
    ns.report["character tab art"])
  check("and no atlas texture was made", ctabs[1].frameTex == nil)
else
  check("the tabs wear the spellbook atlas", ns.report["character tab art"] == "spellbook atlas", ns.report["character tab art"])
  check("the chosen tab wears the glowing frame, the rest the plain one", ctabs[1].frameTex and ctabs[1].frameTex.atlas == "spellbook-Tab-Frame-Glow-C60"
    and ctabs[2].frameTex.atlas == "spellbook-Tab-Frame-C60", ctabs[1].frameTex and ctabs[1].frameTex.atlas)
  check("the glow gradient shows only under the chosen tab", ctabs[1].glow and ctabs[1].glow.shown == true and ctabs[2].glow.shown == false)
end
check("the tab tooltip runs", ctabs[3] ~= nil and pcall(ctabs[1].scripts.OnEnter, ctabs[1]) and pcall(ctabs[3].scripts.OnEnter, ctabs[3]))

-- The class icon is clipped to the tab window's shape, so it cannot show through the frame's
-- open corners. Without the mask atlas (--bare) the icon keeps its corners and the report says so.
if BARE then
  check("with no mask atlas the tabs say so", (ns.report["character tab mask"] or ""):find("none") ~= nil, ns.report["character tab mask"])
else
  local tabMask = ctabs[1].icon.csMask
  check("the class icon wears the tab shaped mask", tabMask ~= nil and tabMask.atlas == "UI-HUD-ActionBar-IconFrame-Mask", tabMask and tabMask.atlas)
  check("drawn a quarter larger than the icon on every side", tabMask and tabMask.points[1] and near(tabMask.points[1][4], -0.26 * 33, 0.01)
    and near(tabMask.points[1][5], 0.26 * 33, 0.01) and tabMask.points[1][2] == ctabs[1].icon)
  check("the report names the mask", ns.report["character tab mask"] == "UI-HUD-ActionBar-IconFrame-Mask", ns.report["character tab mask"])
end
check("the tab tooltip has something to say", GameTooltip ~= nil)

local played = #PLAYED
ctabs[2].scripts.OnClick(ctabs[2])
check("clicking a tab changes who is being looked at", ns.VaultUI.Selected() == CHOHAM, ns.VaultUI.Selected())
grid = Cells(37)
check("the grid now shows that character's bank", ItemCount(grid) == 2, ItemCount(grid))
local c0, c4 = CellAt(grid, BankXY(0, 0)), CellAt(grid, BankXY(4, 0))
check("with their items where they sat", c0 and c0.csItem and c0.csItem.id == 2770 and c4 and c4.csItem and c4.csItem.id == 818)
check("the chosen tab moved", ctabs[2].icon:GetAlpha() == 1 and ctabs[1].icon:GetAlpha() == 0.85)
check("a page turned", #PLAYED == played + 1, #PLAYED - played)
check("the bag slots row follows the character", BagRow()[2]:GetAlpha() == 1 and BagRow()[3]:GetAlpha() == 0.45)
check("the bottom edge still carries only the money", TextOn(vault, CHOHAM .. ", checked", true) == nil)
check("and shows their money", TextOn(vault, ns.Money(5500)) ~= nil)
if not BARE then
  local portrait = vault.PortraitContainer and vault.PortraitContainer.portrait
  check("the portrait shows their class rather than our face", portrait and portrait.texture == CLASS_SHEET and portrait.texCoord[2] == 0.25)
end

ns.VaultUI.Show("bags")
check("bags mode keeps the chosen character", ns.VaultUI.Selected() == CHOHAM)
check("only characters with bags saved get a tab in bags mode", #CharTabs() == 2, #CharTabs())
check("and the grid is theirs", ItemCount(Cells(37)) == 1 and #Cells(37) == 16)
ns.VaultUI.Show("guild")
check("guild mode hides the character tabs", #CharTabs() == 0)
ns.VaultUI.Show("bank", me)
check("Show can name the character to look at", ns.VaultUI.Selected() == me)
check("and the grid is ours again", ItemCount(Cells(37)) == (NO_ENUM and 1 or 4))
if not BARE then
  local portrait = vault.PortraitContainer and vault.PortraitContainer.portrait
  check("our own face is back in the portrait", portrait and portrait.portraitOf == "player")
end
ctabs = CharTabs()
ctabs[3].scripts.OnClick(ctabs[3])
check("the old style record can be looked at", ns.VaultUI.Selected() == "Oldtoon - Voidpact" and ItemCount(Cells(37)) == 1)
check("with its item in its slot", CellAt(Cells(37), BankXY(5, 0)) and CellAt(Cells(37), BankXY(5, 0)).csItem ~= nil)
check("a record with no bag slots dims the whole row", BagRow()[1]:GetAlpha() == 0.45)

-- Forgetting the character being looked at falls back to this one.
local choham = ns.vault.chars[CHOHAM]
ctabs[2].scripts.OnClick(ctabs[2])
ns.Vault.Forget("char", CHOHAM)
check("a forgotten character falls back to this one", ns.VaultUI.Selected() == me and #CharTabs() == 2, ns.VaultUI.Selected())
ns.vault.chars[CHOHAM] = choham
ns.VaultUI.Refresh()
check("and comes back when restored", #CharTabs() == 3)

-- ------------------------------------------------------------------
-- 11f. The minimap button
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
-- 11d. The three icons in the backpack's header
-- ------------------------------------------------------------------
CasementVault:Hide()
backpack:Hide()
backpack:Show()
RunTimers(0.1)

local function HolderOn(frame)
  for _, f in ipairs(FRAMES) do
    if f.parent == frame and f.kind == "Frame" and f.csOurs and f.buttons then return f end
  end
  return nil
end
local holder = HolderOn(backpack)
check("the backpack got a holder for the icons", holder ~= nil)
local icons = {}
for _, f in ipairs(FRAMES) do
  if holder and f.parent == holder and f.kind == "Button" then icons[#icons + 1] = f end
end
check("it holds exactly three buttons", #icons == 3, #icons)
local iconSize = true
for _, b in ipairs(icons) do if b.w ~= 20 or b.h ~= 20 or not b.shown then iconSize = false end end
check("each is a 20 pixel icon", iconSize)
check("the holder is as wide as its three icons", holder and holder.w == 3 * 20 + 2 * 3, holder and holder.w)
check("it is shown", holder and holder.shown == true)
check("the report says where it went", (ns.report["bag buttons"] or ""):find("header") or (ns.report["bag buttons"] or ""):find("above"),
  ns.report["bag buttons"])
check("the icons found their art", (ns.report["bag icon bank"] or ""):find("atlas") or (ns.report["bag icon bank"] or ""):find("Interface"),
  ns.report["bag icon bank"])
check("the holder sits above the drag strip", holder and holder.level > (bagGrip.level or 1), holder and holder.level)

-- It has to keep clear of the game's own close button in that header.
local hl, hb, hw = ns.Windows.Measure(holder)
local cl, cb, cw = ns.Windows.Measure(backpack.testClose)
check("the icons keep clear of the game's close button", hl and cl and (hl + hw <= cl + 0.5 or cl + cw <= hl + 0.5),
  tostring(hl) .. "+" .. tostring(hw) .. " vs " .. tostring(cl))
local ht = hb and (hb + (select(4, ns.Windows.Measure(holder)) or 0))
local bl, bb, bw, bh = ns.Windows.Measure(backpack)
check("and sits in the header band of the backpack", ht and bb and ht <= bb + bh + 0.5 and hb >= bb + bh - 26 - 0.5, ht)

local bankIcon, bagsIcon, guildIcon = holder.buttons.bank, holder.buttons.bags, holder.buttons.guild
check("the buttons are keyed by what they open", bankIcon ~= nil and bagsIcon ~= nil and guildIcon ~= nil)
check("the bank icon is bright: a bank is saved", bankIcon.icon:GetAlpha() == 1, bankIcon.icon:GetAlpha())
check("the bags icon is bright: bags are saved", bagsIcon.icon:GetAlpha() == 1, bagsIcon.icon:GetAlpha())
check("the guild icon is bright: a guild bank is saved", guildIcon.icon:GetAlpha() == 1, guildIcon.icon:GetAlpha())

-- With nothing saved an icon is dimmed rather than hidden, so the row keeps its shape.
local savedGuild = ns.vault.guilds[GUILD_KEY]
ns.vault.guilds[GUILD_KEY] = nil
ns.BagHeader.Update(backpack)
check("the guild icon dims with nothing saved", guildIcon.icon:GetAlpha() == 0.4, guildIcon.icon:GetAlpha())
check("but stays on screen", guildIcon.shown == true and holder.shown == true)
check("the others stay bright", bankIcon.icon:GetAlpha() == 1 and bagsIcon.icon:GetAlpha() == 1)
ns.vault.guilds[GUILD_KEY] = savedGuild
ns.BagHeader.Update(backpack)
check("and brightens once a guild bank is saved", guildIcon.icon:GetAlpha() == 1)
local savedBags = ns.vault.chars[me].bags
ns.vault.chars[me].bags = nil
ns.BagHeader.Update(backpack)
check("the bags icon dims when this character's bags are unknown", bagsIcon.icon:GetAlpha() == 0.4)
ns.vault.chars[me].bags = savedBags
ns.BagHeader.Update(backpack)
check("and brightens again", bagsIcon.icon:GetAlpha() == 1)

check("the icon tooltips run", pcall(bankIcon.scripts.OnEnter, bankIcon) and pcall(bagsIcon.scripts.OnEnter, bagsIcon)
  and pcall(guildIcon.scripts.OnEnter, guildIcon))
guildIcon.scripts.OnLeave(guildIcon)

CasementVault:Hide()
bankIcon.scripts.OnClick(bankIcon)
check("clicking the bank icon opens the vault at the bank", CasementVault.shown == true and ns.VaultUI.Mode() == "bank", ns.VaultUI.Mode())
bagsIcon.scripts.OnClick(bagsIcon)
check("the bags icon switches it to the bags", CasementVault.shown == true and ns.VaultUI.Mode() == "bags", ns.VaultUI.Mode())
guildIcon.scripts.OnClick(guildIcon)
check("the guild icon switches it to the guild bank", CasementVault.shown == true and ns.VaultUI.Mode() == "guild", ns.VaultUI.Mode())
CasementVault:Hide()

ns.db.vault.bagButtons = false
ns.Refresh()
check("the icons can be switched off", holder.shown == false)
ns.db.vault.bagButtons = true
ns.Refresh()
check("and back on", holder.shown == true)

-- The combined bag window is a backpack too; an ordinary bag is not.
ContainerFrameCombinedBags:Show()
RunTimers(0.1)
local combinedHolder = HolderOn(ContainerFrameCombinedBags)
check("the combined bag window gets the icons too", combinedHolder ~= nil and combinedHolder.shown == true)
ContainerFrameCombinedBags:Hide()
ContainerFrame2:Show()
RunTimers(0.1)
check("an ordinary bag does not", HolderOn(ContainerFrame2) == nil)
ContainerFrame2:Hide()

-- ------------------------------------------------------------------
-- 11e. The map tab's parts: the grip's art, the reset icon, double-click
-- ------------------------------------------------------------------
local mapTab = CasementMapTab
check("the resize grip is a button", mapGrip.kind == "Button")
check("it wears the chat frame's size grabber", (mapGrip.normalArt or ""):find("SizeGrabber") ~= nil, mapGrip.normalArt)
check("the report names that art", ns.report["map grip art"] == "chat frame grabber", ns.report["map grip art"])
check("the reset button wears an icon, even on a bare client", (ns.report["map reset icon"] or ""):find("Interface") ~= nil,
  ns.report["map reset icon"])
local resetButton = mapTab.parts and mapTab.parts.reset
check("the reset button is part of the tab", resetButton ~= nil and resetButton.parent == mapTab)
local resetIcon
for _, t in ipairs(TEXTURES) do if t.parent == resetButton and t.layer == "ARTWORK" then resetIcon = t end end
check("its icon is the map scroll", resetIcon and (resetIcon.texture or ""):find("INV_Misc_Map") ~= nil and resetIcon.shown,
  resetIcon and resetIcon.texture)
check("the icon is trimmed of its border", resetIcon and resetIcon.texCoord and resetIcon.texCoord[1] == 0.07)
ns.Map.SetScale(1.5)
resetButton.scripts.OnClick(resetButton)
check("clicking reset puts the map back to 100 percent", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
ns.Map.SetScale(1.5)
mapGrip.scripts.OnDoubleClick(mapGrip)
check("double-clicking the grip does the same", near(ns.db.map.scale, 1.0, 0.001), ns.db.map.scale)
check("and leaves no resize running", mapGrip.scripts.OnUpdate == nil)
check("the reset button's tooltip runs", pcall(resetButton.scripts.OnEnter, resetButton) and pcall(mapGrip.scripts.OnEnter, mapGrip))

-- The parts sit left to right in the order they are listed, and the tab is as wide as they need.
local order = { "minus", "label", "plus", "reset", "divider", "grip" }
local lastX, ordered, allShown = -1, true, true
for _, key in ipairs(order) do
  local part = mapTab.parts[key]
  local p = part and part.points[1]
  if not (part and part.shown and p and p[2] == mapTab and p[4] > lastX) then ordered = false end
  if part and not part.shown then allShown = false end
  if p then lastX = p[4] end
end
check("the tab's parts sit left to right in their listed order", ordered and allShown)
check("the tab is wide enough for all of them", mapTab.w >= lastX + 18)
ns.db.map.scaleButtons = false
ns.Refresh()
check("with the buttons off only the grip is left", mapTab.parts.minus.shown == false and mapTab.parts.grip.shown == true
  and mapTab.parts.divider.shown == false)
-- The coordinates block, when shown, still sits to the left of it.
local leftBlock = mapTab.parts.coords.shown and (mapTab.parts.coords.w + 4 + mapTab.parts.copy.w + 4 + mapTab.parts.divider2.w + 6) or 0
check("and the grip slides to the left", mapTab.parts.grip.points[1][4] == 10 + leftBlock, mapTab.parts.grip.points[1][4] .. " vs " .. (10 + leftBlock))
ns.db.map.scaleButtons = true
ns.Refresh()
check("switching the buttons back on brings them back", mapTab.parts.minus.shown == true and mapTab.parts.divider.shown == true)

-- ------------------------------------------------------------------
-- 11g. The corner handle comes back when the top bar has no room
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
local mine = LineFor(lines, "Vatik")
check("this character's line names them without the realm", mine ~= nil, lines[1] and (lines[1][1] .. " / " .. tostring(lines[1][2])))
check("with the saved bank count and the live bag count", mine and mine[2] == "bank 20, bags 7", mine and mine[2])
check("this character comes first", lines[1] and lines[1][1] == "Vatik")
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
check("an item known only by name is still found", LineFor(lines, "Vatik") ~= nil)

-- The switches.
ns.db.tooltips.guild = false
lines = Hover(2589, "Linen Cloth")
check("the guild bank can be left out", LineFor(lines, "Night Owls") == nil and LineFor(lines, "Vatik") ~= nil)
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
check("and everything shows while it is", LineFor(lines, "Vatik") ~= nil)
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

SlashCmdList["CASEMENT"]("gold")
local sawChoham, sawTotal = false, false
for i = #CHAT - 6, #CHAT do
  local line = CHAT[i] or ""
  if line:find("Choham") then sawChoham = true end
  if line:find("Total") then sawTotal = true end
end
check("/casement gold lists each character and the total", sawChoham and sawTotal)

ns.VaultUI.Show("bank")
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
CasementVault:Hide()

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
check("hovering it lists this character's gold, marked as now", LineFor(GameTooltip.csLines, "Vatik (now)") ~= nil)
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
local moneyHit
for _, f in ipairs(FRAMES) do if f.parent == vault and f.csMoneyHit then moneyHit = f end end
check("the saved bank's money carries the same tooltip", moneyHit ~= nil)
GameTooltip:SetOwner(nil)
moneyHit.scripts.OnEnter(moneyHit)
check("and it lists the account", LineFor(GameTooltip.csLines, "Total") ~= nil)
CasementVault:Hide()

-- ------------------------------------------------------------------
-- 11i. The drag anywhere overlay stays unseen unless asked for
-- ------------------------------------------------------------------
map:Show()
RunTimers(0.1)
local mapOverlay
for _, f in ipairs(FRAMES) do
  if f.parent == map and f.allPoints == map and f.dragButtons and f.tint then mapOverlay = f end
end
check("the map's overlay carries a tint", mapOverlay ~= nil)
ns.db.showGrips = false
ALT = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("holding alt brings the overlay up", mapOverlay.shown == true)
check("but paints nothing by default", mapOverlay.tint.alpha == 0, mapOverlay.tint.alpha)
ns.db.showGrips = true
fire("MODIFIER_STATE_CHANGED", "LALT", 1)
check("with the drag areas switched on the tint shows", mapOverlay.tint.alpha == 1)
ns.db.showGrips = false
ALT = false
fire("MODIFIER_STATE_CHANGED", "LALT", 0)
check("letting go puts it away", mapOverlay.shown == false)

end -- scope

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
check("/casement snapshot saves the bags, which are always to hand", CHAT[#CHAT]:find("items in your bags") ~= nil, CHAT[#CHAT])
check("and says how many", CHAT[#CHAT]:find("saved 6 items") ~= nil, CHAT[#CHAT])
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
-- The vault's character tabs are CheckButtons too, and every item cell is a Button, so only the
-- widgets on the option pages are counted here.
local optionChecks, optionButtons = 0, 0
for _, f in ipairs(FRAMES) do
  if f.parent ~= CasementVault and (not f.parent or f.parent.parent ~= CasementVault) then
    if f.kind == "CheckButton" and (f.name or ""):find("^CasementCheck") then optionChecks = optionChecks + 1 end
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

-- Clicking the master switch off turns everything off and back on again. The master is the
-- switch labelled as such, never the first CheckButton found, since the vault's character tabs
-- are CheckButtons as well.
local master
for _, f in ipairs(FRAMES) do
  if f.kind == "CheckButton" and not master then
    for _, fs in ipairs(FONTSTRINGS) do
      if fs.parent == f and fs.text == "Casement is on" then master = f end
    end
  end
end
check("the master switch is the one labelled so", master ~= nil and master.parent ~= CasementVault)
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

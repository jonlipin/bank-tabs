-- Casement
-- BagHeader: the buttons that put the saved bank one click away from your bags.
--
-- When snapshots are switched on, the backpack (and the combined bag window, where the client has
-- one) gets a Bank button and, if this account has ever opened one, a Guild button. Both open the
-- vault straight at that record.
--
-- Where they go is worked out rather than guessed: the header band is measured for a stretch that
-- none of the game's own buttons are sitting on, and the widest clear stretch at the right hand
-- end wins. If the header is full, they sit just above the window instead. They are also raised
-- above the drag strip, which would otherwise swallow their clicks.

local ADDON, ns = ...

local report = ns.report
local BagHeader = {}
ns.BagHeader = BagHeader

local holders = {}
local hooked = {}

local BAND = 26
local BUTTON_H = 18

local function IsBackpack(frame)
	if frame == _G.ContainerFrameCombinedBags then return true end
	local id = frame.GetID and frame:GetID() or nil
	return id == 0
end

local function GuildRecord()
	local key = ns.Vault and ns.Vault.GuildKey and ns.Vault.GuildKey()
	if key and ns.vault.guilds[key] then return key, ns.vault.guilds[key] end
	-- Not in a guild right now, but this account may still have one saved.
	for savedKey, record in pairs(ns.vault.guilds or {}) do
		return savedKey, record
	end
	return nil
end

local function Ago(record)
	if not record or type(record.time) ~= "number" then return "never checked" end
	local seconds = time() - record.time
	if seconds < 3600 then return math.max(1, math.floor(seconds / 60)) .. " minutes ago" end
	if seconds < 86400 then return math.floor(seconds / 3600) .. " hours ago" end
	return math.floor(seconds / 86400) .. " days ago"
end

local function CountItems(record, isGuild)
	if not record then return 0 end
	if not isGuild then return record.items or 0 end
	local total = 0
	for _, tab in pairs(record.tabs or {}) do total = total + #(tab.items or {}) end
	return total
end

local function BuildHolder(frame)
	local holder = CreateFrame("Frame", nil, frame)
	holder.csOurs = true
	holder:SetSize(90, BUTTON_H)

	holder.bank = ns.Button(holder, "Bank", 42, BUTTON_H, function()
		if ns.VaultUI then ns.VaultUI.ShowSource("char", ns.Who()) end
	end)
	holder.bank:SetPoint("LEFT", 0, 0)
	holder.bank.csOurs = true
	holder.bank:SetScript("OnEnter", function(self)
		local record = ns.vault.chars[ns.Who()]
		GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
		GameTooltip:SetText("Your saved bank", 1, 1, 1)
		if record then
			GameTooltip:AddLine(CountItems(record) .. " items, checked " .. Ago(record), 0.7, 0.85, 1)
		else
			GameTooltip:AddLine("Nothing saved yet. Open your bank once.", 0.8, 0.8, 0.8, true)
		end
		GameTooltip:Show()
	end)
	holder.bank:SetScript("OnLeave", function() GameTooltip:Hide() end)

	holder.guild = ns.Button(holder, "Guild", 44, BUTTON_H, function()
		local key = GuildRecord()
		if key and ns.VaultUI then ns.VaultUI.ShowSource("guild", key) end
	end)
	holder.guild:SetPoint("LEFT", holder.bank, "RIGHT", 4, 0)
	holder.guild.csOurs = true
	holder.guild:SetScript("OnEnter", function(self)
		local key, record = GuildRecord()
		GameTooltip:SetOwner(self, "ANCHOR_BOTTOM")
		GameTooltip:SetText(key and ("Guild bank of " .. key) or "Guild bank", 1, 1, 1)
		if record then
			GameTooltip:AddLine(CountItems(record, true) .. " items, checked " .. Ago(record), 0.7, 0.85, 1)
		end
		GameTooltip:Show()
	end)
	holder.guild:SetScript("OnLeave", function() GameTooltip:Hide() end)

	holders[frame] = holder
	return holder
end

-- Finds somewhere in the header this can sit without covering one of the game's own buttons.
local function PlaceHolder(frame, holder, width)
	local left, bottom, frameWidth = ns.Windows.Measure(frame)
	local ratio = ns.Windows.Ratio(frame)
	if left and frameWidth and frameWidth > 0 then
		local gaps = ns.Windows.HeaderGaps(frame, BAND, width + 8)
		-- The rightmost clear stretch, which on a bag window is the space before the close button.
		local pick = gaps[#gaps]
		if pick then
			holder:ClearAllPoints()
			local inset = (pick[2] - pick[1] - width) / 2
			holder:SetPoint("TOPLEFT", frame, "TOPLEFT", (pick[1] - left + inset) * ratio, -4 * ratio)
			report["bag buttons"] = "in the header"
			return true
		end
	end
	-- The header is full, so they go just above the window where nothing else is drawn.
	holder:ClearAllPoints()
	holder:SetPoint("BOTTOMLEFT", frame, "TOPLEFT", 8, 2)
	report["bag buttons"] = "above the window (the header had no room)"
	return false
end

function BagHeader.Update(frame)
	if not frame or not ns.db then return end
	if not IsBackpack(frame) then return end

	local wanted = ns.db.enabled and ns.db.vault.bagButtons
		and (ns.db.vault.autoBank or ns.db.vault.autoGuild or next(ns.vault.chars or {}) ~= nil)
	local holder = holders[frame]

	if not wanted then
		if holder then holder:Hide() end
		return
	end
	if not holder then holder = BuildHolder(frame) end

	local hasGuild = GuildRecord() ~= nil
	holder.guild:SetShown(hasGuild and true or false)
	local width = 42 + (hasGuild and (4 + 44) or 0)
	holder:SetWidth(width)

	if frame:IsShown() then PlaceHolder(frame, holder, width) end
	-- Above the drag strip, which covers this same band and would take the clicks otherwise.
	ns.RaiseOver(holder, frame, 6)
	if holder.bank then pcall(holder.bank.SetFrameLevel, holder.bank, (holder:GetFrameLevel() or 1) + 1) end
	if holder.guild then pcall(holder.guild.SetFrameLevel, holder.guild, (holder:GetFrameLevel() or 1) + 1) end
	holder:Show()
end

function BagHeader.Apply()
	for frame in pairs(holders) do pcall(BagHeader.Update, frame) end
	BagHeader.Sweep()
end

-- Hooks every bag window once, so the buttons appear whether or not that window is being moved.
function BagHeader.Sweep()
	for _, name in ipairs(ns.Windows.CONTAINER_NAMES or {}) do
		local frame = _G[name]
		if type(frame) == "table" and frame.HookScript and not hooked[frame] then
			hooked[frame] = true
			frame:HookScript("OnShow", function()
				pcall(BagHeader.Update, frame)
				ns.After(0, function() pcall(BagHeader.Update, frame) end)
			end)
			if frame:IsShown() then pcall(BagHeader.Update, frame) end
		end
	end
end

function BagHeader.Init()
	BagHeader.Sweep()
	ns.After(2, BagHeader.Sweep)
	ns.After(8, BagHeader.Sweep)
end

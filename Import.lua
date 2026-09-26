-- Bank Tabs
-- Import: bringing over what Casement saved, once, and standing the old Casement down.
--
-- Until 2.0.0 this addon was Casement, which also moved and resized the world map. It is now two
-- addons: Bank Tabs (this one) and Map Tab (the world map tab, the coordinates and the fog
-- reveal). The game names a SavedVariables file after its addon's folder, so the rename alone
-- would leave every character's saved bank, bags and window positions behind in Casement's files.
--
--  * The package carries a data only Casement folder (Legacy/Casement in the repo, moved to the
--    top level when packaged). Its TOC is load on demand, declares Casement's saved variables and
--    lists no code, so updating Casement swaps the old addon for something that only keeps its
--    files where they can be read.
--  * At PLAYER_LOGIN, after every addon has loaded, the account half (every character's saved
--    bank, bags and guild banks, and the measured bank layout) is copied once per account, and
--    this character's settings once per character. Only this addon's half is read: the map
--    settings and the reveal's harvest are Map Tab's. Nothing already set in Bank Tabs is
--    overwritten.
--  * If the OLD Casement is still installed and running, it is switched off from the next session
--    and the user is told once. Map Tab does the same thing; whichever of the two gets there first
--    speaks, and the other finds the old addon already switched off and stays quiet. For the rest
--    of that session Bank Tabs leaves the bag and bank windows, the backpack buttons, the minimap
--    button and the item tooltip lines to the old addon (ns.oldCasementRunning), since two of
--    each on the same windows fight.
--  * When Casement's files cannot be read yet, the user is told why once per account; the debug
--    report says it at every login, and every login tries again.

local ADDON, ns = ...

local report = ns.report
local Import = {}
ns.Import = Import

local OLD = "Casement"
Import.OLD = OLD

-- Set by whichever of Bank Tabs and Map Tab tells the user about the old Casement first, so the
-- other does not say it again this session.
local NOTICE = "CASEMENT_REPLACED_NOTICE"
Import.NOTICE = NOTICE

-- This addon's half of Casement's per character settings.
local SCALARS = { "enabled", "dragModifier", "showGrips" }
local WINDOW_KEYS = { "combined", "bags", "reagent", "bank", "guildbank" }
local GROUPS = { "minimap", "vault", "tooltips" }
-- Saved window positions that belong to Map Tab.
local NOT_OURS = { worldmap = true }
-- What a character entry carries besides its records.
local CHAR_FIELDS = { "class", "level", "name", "realm", "guid" }

-- ------------------------------------------------------------------
-- What the client says about the old addon
-- ------------------------------------------------------------------

-- The addon API moved under C_AddOns on the modern stack; older builds have the globals. Returns
-- pcall's answer, or false when the function is not on this client at all.
local function Call(name, ...)
	local fn = (type(C_AddOns) == "table" and C_AddOns[name]) or _G[name]
	if type(fn) ~= "function" then return false end
	return pcall(fn, ...)
end

-- Whether the old addon is switched on. A client that cannot say is taken to have it on, which at
-- worst means it is switched off a second time.
function Import.Enabled(reason)
	if reason == "DISABLED" then return false end
	local ok, state = Call("GetAddOnEnableState", OLD)
	if not (ok and type(state) == "number") then
		-- The older argument order: the character first.
		local who = UnitName and UnitName("player")
		ok, state = Call("GetAddOnEnableState", who, OLD)
	end
	if ok and type(state) == "number" then return state > 0 end
	return true
end

-- Whether Casement is there, whether it is the data only holder (load on demand) or the old
-- addon itself, whether it is loaded and switched on, and whether its code ran this session.
function Import.Probe()
	local info = { exists = false }
	-- The old addon's own event frame: its code ran this session, whatever the API says.
	info.running = type(_G.CasementFrame) == "table"

	local ok, name, _, _, loadable, reason = Call("GetAddOnInfo", OLD)
	if ok and name ~= nil and reason ~= "MISSING" then
		info.exists = true
		info.loadable = loadable and true or false
		info.reason = reason
	end
	local okExists, exists = Call("DoesAddOnExist", OLD)
	if okExists and type(exists) == "boolean" then info.exists = exists end
	if info.running then info.exists = true end
	if not info.exists then return info end

	local okLoaded, loaded = Call("IsAddOnLoaded", OLD)
	info.loaded = (okLoaded and loaded and true or false) or info.running
	local okLod, lod = Call("IsAddOnLoadOnDemand", OLD)
	info.lod = okLod and lod and true or false
	info.enabled = Import.Enabled(info.reason)
	return info
end

local function Describe(info)
	if not info.exists then return "not installed" end
	local kind = info.lod and "the data holder" or "the old addon"
	local state = info.running and "running" or (info.loaded and "loaded") or (info.enabled and "switched on") or "switched off"
	return kind .. ", " .. state
end

-- ------------------------------------------------------------------
-- Copying
-- ------------------------------------------------------------------

-- A record copied out of a Casement character entry. Casement 1.0.x kept the bank record itself
-- under the character's name; that shape is still read, the vault lifts it the first time it
-- is looked at.
local function RecordCopy(entry, kind)
	if type(entry[kind]) == "table" then return ns.DeepCopy(entry[kind]) end
	if kind == "bank" and type(entry.containers) == "table" then
		local copy = ns.DeepCopy(entry)
		for _, field in ipairs(CHAR_FIELDS) do copy[field] = nil end
		return copy
	end
	return nil
end

-- Every character's saved bank and bags, every guild bank and the measured bank layout. A
-- character or guild Bank Tabs already holds keeps what it has; only what it lacks is filled in,
-- so a snapshot taken since is never replaced by an older one.
local function ImportAccount(old, into)
	local src = type(old) == "table" and old.vault
	if type(src) ~= "table" then return 0, 0 end
	local chars, guilds = 0, 0

	for who, entry in pairs(type(src.chars) == "table" and src.chars or {}) do
		if type(entry) == "table" then
			local mine = into.chars[who]
			if mine == nil then
				into.chars[who] = ns.DeepCopy(entry)
				chars = chars + 1
			elseif type(mine) == "table" then
				local added = false
				for _, kind in ipairs({ "bank", "bags" }) do
					if mine[kind] == nil and not (kind == "bank" and mine.containers) then
						local record = RecordCopy(entry, kind)
						if record then mine[kind], added = record, true end
					end
				end
				for _, field in ipairs(CHAR_FIELDS) do
					if mine[field] == nil and entry[field] ~= nil then mine[field] = entry[field] end
				end
				if added then chars = chars + 1 end
			end
		end
	end

	for key, record in pairs(type(src.guilds) == "table" and src.guilds or {}) do
		if type(record) == "table" and into.guilds[key] == nil then
			into.guilds[key] = ns.DeepCopy(record)
			guilds = guilds + 1
		end
	end

	if into.bankLayout == nil and type(src.bankLayout) == "table" then
		into.bankLayout = ns.DeepCopy(src.bankLayout)
	end
	return chars, guilds
end

-- One setting, unless the user has already set it here. `fresh` says this character's Bank Tabs
-- table was made this session, so nothing in it is the user's own choice yet. Only keys Bank Tabs
-- has, holding the kind of value it uses, are ever copied.
local function Take(dst, defaults, key, value, fresh)
	if value == nil or type(value) == "table" then return 0 end
	local default = defaults[key]
	if default == nil or type(default) ~= type(value) then return 0 end
	if not fresh and dst[key] ~= default then return 0 end
	if dst[key] == value then return 0 end
	dst[key] = value
	return 1
end

-- This character's window switches, drag key, minimap button, snapshot and tooltip switches, and
-- where it left its bag, bank and guild bank windows. The world map's size and place are not
-- touched: they are Map Tab's.
local function ImportCharacter(old, db, fresh, withPositions)
	if type(old) ~= "table" then return 0 end
	local defaults, n = ns.defaults, 0
	for _, key in ipairs(SCALARS) do n = n + Take(db, defaults, key, old[key], fresh) end
	if type(old.windows) == "table" then
		for _, key in ipairs(WINDOW_KEYS) do
			n = n + Take(db.windows, defaults.windows, key, old.windows[key], fresh)
		end
	end
	for _, group in ipairs(GROUPS) do
		if type(old[group]) == "table" and type(db[group]) == "table" then
			for key, value in pairs(old[group]) do
				n = n + Take(db[group], defaults[group], key, value, fresh)
			end
		end
	end
	if withPositions and type(old.positions) == "table" then
		for key, pos in pairs(old.positions) do
			if type(key) == "string" and not NOT_OURS[key] and type(pos) == "table"
				and type(pos.x) == "number" and type(pos.y) == "number" and db.positions[key] == nil then
				db.positions[key] = { x = pos.x, y = pos.y }
				n = n + 1
			end
		end
	end
	return n
end

local function Plural(n, one, many)
	return n .. " " .. (n == 1 and one or many)
end

-- ------------------------------------------------------------------
-- Opening the old files and standing the old addon down
-- ------------------------------------------------------------------

-- Makes Casement's saved variables readable. They are already in memory when the old addon ran
-- this session or the data holder was loaded earlier; otherwise the data holder is loaded on
-- demand. Returns whether they can be read, a few words for the report, and whether a failure is
-- one the user chose and should not be told about.
local function Open(info, needAccount)
	if type(CasementAccountDB) == "table" or type(CasementDB) == "table" then return true, "read from memory" end
	if not info.exists then return false, "no Casement installed" end
	if info.loaded then return true, "loaded, but Casement had nothing saved" end
	if not info.lod then
		-- The old addon itself, switched off. Its code would have to run to open its files, and
		-- two engines on the same windows is worse than waiting for the user.
		return false, "the old Casement is switched off"
	end
	if not info.enabled then
		if not needAccount then
			-- The account's share was done at an earlier login (the holder switched on to be read
			-- if it had to be), so switching it off since was the user's doing. Only this
			-- character's window settings are left, which is not worth overruling them for, or
			-- switching it back on for every character; switched on again, it is read then.
			return false, "the data holder is switched off, and the account was done at an earlier login, so it is left off", true
		end
		-- The data holder, switched off (usually by an earlier session's notice, before Casement
		-- was updated). It runs no code, so switching it back on to read it is safe.
		local okEnable = Call("EnableAddOn", OLD)
		report["casement data holder"] = okEnable and "switched back on to be read" or "switched off and could not be switched on"
	end
	local ok, loaded, why = Call("LoadAddOn", OLD)
	if ok and loaded then
		if type(CasementAccountDB) == "table" or type(CasementDB) == "table" then return true, "loaded on demand" end
		return true, "loaded on demand, but Casement had nothing saved"
	end
	return false, "the game would not load it (" .. tostring(why or (ok and "refused") or "no LoadAddOn") .. ")"
end

-- Whether Map Tab, the other half, is installed.
local function MapTabInstalled()
	if type(_G.MapTabFrame) == "table" then return true end
	local ok, name, _, _, _, reason = Call("GetAddOnInfo", "MapTab")
	return (ok and name ~= nil and reason ~= "MISSING") and true or false
end

-- The old addon still running next to this one: switched off from the next session, and the user
-- told, once between Bank Tabs and Map Tab. Until then it keeps the windows (see the note at the
-- top), which the notice says, and a user who has only Bank Tabs so far is told Map Tab is a
-- separate download, since switching the old addon off takes the world map tab with it.
local ASIDE = "; Bank Tabs leaves the bag and bank windows, the backpack tabs, the minimap button and the item tooltip lines to it until the next session"

local function StandDown(info)
	if not info.running then return false end
	if _G[NOTICE] or not info.enabled then
		report["old casement"] = "running this session, already switched off for the next" .. ASIDE
		return false
	end
	_G[NOTICE] = ADDON
	local ok = Call("DisableAddOn", OLD)
	if ok then Call("SaveAddOns") end
	local mapTab = MapTabInstalled()
	report["old casement"] = (ok and "was running, switched off from the next session" or "was running, could not be switched off") .. ASIDE
		.. (mapTab and "" or "; told the user Map Tab is a separate download")
	ns.Print("is one of the two addons that replace Casement: Bank Tabs keeps the bags, bank and saved banks, and Map Tab the world map tab, coordinates and fog reveal."
		.. (ok and " The old Casement is switched off from your next login; type /reload to finish the switch now. Until then it keeps the bag and bank windows, and Bank Tabs takes over after the reload."
			or " Please switch the old Casement off in the AddOns list and /reload. Until then it keeps the bag and bank windows, and Bank Tabs leaves them to it.")
		.. (mapTab and "" or " Map Tab is a separate download: install it too to keep the world map tab, coordinates and fog reveal."))
	return true
end

-- ------------------------------------------------------------------
-- The run at login
-- ------------------------------------------------------------------

local function RunOnce()
	local account, db = BankTabsAccountDB, ns.db
	if type(account) ~= "table" or type(db) ~= "table" or type(ns.vault) ~= "table" then return end

	local info = Import.Probe()
	Import.last = info
	report["casement addon"] = Describe(info)
	-- The old addon's code ran this session: it keeps its windows until the next one.
	ns.oldCasementRunning = info.running or nil

	local needAccount = not account.importedCasement
	local needChar = not db.importedCasement
	if not needAccount and not needChar then
		StandDown(info)
		report["casement import"] = report["casement import"] or "already done"
		return "done before"
	end

	local open, how, quiet = Open(info, needAccount)
	local told = StandDown(info)

	if not open then
		report["casement import"] = "not done: " .. how
		if how == "no Casement installed" then
			-- A clean install: nothing will ever arrive, so the question is closed.
			account.importedCasement = true
			db.importedCasement = true
			report["casement import"] = "nothing to import: no Casement installed"
			return "nothing"
		end
		if quiet then return "not open" end
		-- Said once per account, the first time, so the user knows why and what to do. Every login
		-- after that tries again without a word, and the report gives the reason each time.
		if account.casementUnreadableTold then
			report["casement import"] = report["casement import"] .. " (the user was told at an earlier login)"
			return "not open"
		end
		account.casementUnreadableTold = true
		if how == "the old Casement is switched off" then
			ns.Print("cannot read what Casement saved while the old Casement is switched off. Switch it on in the AddOns list for one login and Bank Tabs brings everything over (and switches it off again).")
		else
			ns.Print("could not open what Casement saved: " .. how .. ". It tries again at each login.")
		end
		return "not open"
	end

	local hadData = type(CasementAccountDB) == "table" or type(CasementDB) == "table"
	local chars, guilds, settings = 0, 0, 0
	if needAccount then
		chars, guilds = ImportAccount(CasementAccountDB, ns.vault)
		account.importedCasement = true
	end
	if needChar then
		-- This character's own Casement settings, which replace a table made or adopted this
		-- session, since nothing in it is this character's own choice yet. Or else the account copy
		-- Casement itself would have handed a character it had never seen (without positions,
		-- which are per character): Bank Tabs' own account copy, which a character new to it has
		-- just adopted, is newer than that, so it only fills in what is still at its default.
		local source, withPositions, fresh = CasementDB, true, ns.dbFresh
		if ns.CountKeys(source) == 0 then
			source = type(CasementAccountDB) == "table" and CasementAccountDB.profile or nil
			withPositions, fresh = false, false
		end
		settings = ImportCharacter(source, db, fresh, withPositions)
		db.importedCasement = true
	end

	report["casement import"] = how .. ": " .. Plural(chars, "character", "characters") .. ", "
		.. Plural(guilds, "guild bank", "guild banks") .. ", " .. Plural(settings, "setting", "settings")
		.. (needAccount and "" or " (this character only; the account was done before)")

	if chars > 0 or guilds > 0 then
		if ns.Vault and ns.Vault.Init then pcall(ns.Vault.Init) end
		if ns.Vault and ns.Vault.Changed then pcall(ns.Vault.Changed) end
	end

	-- One line, the first time only.
	if needAccount and hadData then
		local parts = {}
		if chars > 0 then parts[#parts + 1] = Plural(chars, "character's saved bank and bags", "characters' saved banks and bags") end
		if guilds > 0 then parts[#parts + 1] = Plural(guilds, "guild bank", "guild banks") end
		if settings > 0 then parts[#parts + 1] = "your window settings" end
		local what
		if #parts == 0 then
			what = "found nothing in Casement's saved files that it needed to bring over."
		else
			local last = table.remove(parts)
			what = "brought over what Casement saved: " .. (#parts > 0 and (table.concat(parts, ", ") .. " and ") or "") .. last .. "."
		end
		if not told then
			what = what .. " The world map tab, coordinates and fog reveal are now a separate addon, Map Tab."
		end
		ns.Print(what)
	end
	return "imported"
end

-- Runs at every PLAYER_LOGIN; the flags make everything after the first time a quick look.
-- `lastRun` says how the last one ended: "imported", "done before", "nothing" or "not open".
function Import.Run()
	local result = RunOnce()
	Import.lastRun = result
	return result
end

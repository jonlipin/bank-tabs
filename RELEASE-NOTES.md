## 2.0.0 - 2026-09-26

**Casement is now two addons, and this one is Bank Tabs.** Casement did two unrelated jobs under a
name that described neither. From this release:

- **Bank Tabs** (this addon, the same project with the same history): dragging the combined bag,
  individual bag, reagent bag, bank and guild bank windows, never off screen and remembered per
  character; every character's bank, bags and guild bank saved and viewable from anywhere, drawn
  like the real windows, with a spellbook style tab per character; lines on item tooltips saying
  who has the item and where; every character's gold; the icons in the backpack's header; the
  minimap button.
- **Map Tab** (a new, separate download): moving and resizing the world map from the tab under it,
  your coordinates and the cursor's with a copy to chat button, and the optional drawing of the
  parts of the map you have not explored. Install it alongside Bank Tabs if you used any of that.

**Everything you had comes with you.** The game names an addon's saved settings after its folder,
so the new name alone would have left them behind. This release therefore also installs a small
`Casement` folder, listed as "Casement (old data)" in the AddOns list, which runs no code and only
keeps Casement's saved files where they can be read. At your first login Bank Tabs copies over
every character's saved bank, bags and guild banks and the measured bank layout, and chat says so
once. Each character's own window switches, drag key, window positions, minimap button, snapshot
and tooltip settings come over the first time that character logs in. Nothing already set in Bank
Tabs is overwritten, and a snapshot taken since is never replaced by an older one. The world map's
settings and the reveal's collected map data are left for Map Tab, which brings its own half over
the same way. Once both addons have loaded on every character you play, the Casement folder can be
deleted. `/banktabs debug` reports what was found and what came over.

**If the old Casement is still running** (for example Bank Tabs was unzipped next to Casement 1.2.3
rather than over it), Bank Tabs still brings everything over, switches the old Casement off from
your next login, and says so once in chat. Map Tab does the same, and only one of the two speaks.

**New names.** The commands are `/banktabs` and the short `/btabs`; `/casement` and `/cst` still
work for old macros. The options are under Esc > Options > AddOns > Bank Tabs. The map commands
(`scale`, `coords`, `mapdata`) now say that the map went to Map Tab.

**Changed: the minimap button.** Left-click opens the saved bank and right-click the options, the
other way round from Casement, since the saved bank is what it is for now. Shift and left-click
still locks or unlocks the bag and bank windows. Its icon, and the addon's icon in the AddOns list,
is a bag rather than the map.

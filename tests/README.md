# Offline harness

`banktabstest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because much of what
this addon does is geometry: clamping a window to the screen, putting a window back after the game
has re-anchored it, and laying the saved bank out slot for slot where the real one has its slots.

```
node tests/banktabstest.js [addon dir] [--bare] [--verbose] [--noenum]
```

Run it from the repo root; the addon dir defaults to the folder above `tests`.

- no flags: 867 checks against the normal client
- `--bare`: 858; every UI template and atlas is missing, so every fallback path runs. As on the
  client, `SetAtlas` raises nothing for a missing atlas, so only a real check of the atlas table
  lets a fallback step in.
- `--noenum`: 863; no `Enum.BagIndex`, so the bank scan falls back to the classic container ids
- `--verbose`: prints everything the addon puts in the chat frame

The result line adds up three parts, printed just above it:

- **main**: one load on a clean install (no Casement anywhere): the bag, bank and guild bank
  windows, the three snapshots, the bank layout measured off the real window (whatever else of a
  slot's size is in it: a stray button above, beside or below the grid, a hidden part of the
  window, WoW Forever's bank before its slots are made, a saved layout one column wide), the
  replicas (never drawn from a layout that is no grid), the three saved windows open at once (each on its
  own character with its own search, the Escape order and its surviving the interface being hidden
  and shown, where they open in each order and where they are left, kept on screen with their
  character tabs by the backpack tabs' rule, the saved bags leaving out the character
  being played, the saved bank's unsaved line), the tabs above the backpack (the shared tab
  builder, where they hang, following the backpack, kept on screen with it when it is dragged to
  the top, wrapping into two rows on a narrow backpack, chosen while their window is open, dimmed
  with nothing saved), tooltips, gold, the minimap button, the
  options, the slash commands and the saved variables. It also checks that the world map is never
  touched (Map Tab owns it) and that every global the addon makes is named for it. The stub's
  Escape walks `UISpecialFrames` with `pairs` and hides every shown window, as the game does.
- **import**: twenty seven cases, each in a fresh Lua state so each is a real first login. All but
  the last are the Casement import: the data holder present, another character later (with its own Casement settings,
  and one Casement never saw, whose Bank Tabs choices must stay), the old Casement still running
  (the window engine waiting for login and then leaving the windows and `/casement` to it for the
  session, what the user changes in it that session coming over at logout but not on a character
  already brought over; Map Tab installed or not; Map Tab having spoken first, with or without
  the shared flag), no addon API at all, already imported, the data holder switched off (before the saved banks
  came over, after, and by the notice rather than the user), switched off for this character only
  (asked by character on either form of the enable state, or shown only by the game refusing to
  load it), the old addon switched off (told once per account, however many logins or characters)
  or switched on but not loaded, settings already chosen in Bank Tabs, a data holder with nothing
  saved, one the game will not load, Casement turning up after a clean install, and a blank
  character table after the import. The last is bank layouts saved one column wide by 2.0.0: dropped
  at load, the saved banks drawn eight across without them, and the bank measured again when it
  opens.
- **files**: the TOC, the sources (no caller of the old single saved window left; both kinds of
  tab built and hung by the one pair of functions in Core), the data holder's TOC, `.pkgmeta`, the
  release notes against the changelog, and no em or en dashes anywhere. The repo only parts are
  skipped for an installed copy.

It needs `fengari` on the module path; the copy this was developed against is not checked in.

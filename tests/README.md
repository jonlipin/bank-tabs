# Offline harness

`banktabstest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because much of what
this addon does is geometry: clamping a window to the screen, putting a window back after the game
has re-anchored it, and laying the saved bank out slot for slot where the real one has its slots.

```
node tests/banktabstest.js [addon dir] [--bare] [--verbose] [--noenum]
```

Run it from the repo root; the addon dir defaults to the folder above `tests`.

- no flags: 673 checks against the normal client
- `--bare`: 665; every UI template is missing, so every fallback path runs
- `--noenum`: 669; no `Enum.BagIndex`, so the bank scan falls back to the classic container ids
- `--verbose`: prints everything the addon puts in the chat frame

The result line adds up three parts, printed just above it:

- **main**: one load on a clean install (no Casement anywhere): the bag, bank and guild bank
  windows, the three snapshots, the replicas, the three saved windows open at once (each on its
  own character with its own search, the Escape order, where they open and where they are left,
  the saved bags leaving out the character being played, the saved bank's unsaved line), the tabs
  above the backpack (the shared tab builder, where they hang, following the backpack, chosen
  while their window is open, dimmed with nothing saved), tooltips, gold, the minimap button, the
  options, the slash commands and the saved variables. It also checks that the world map is never
  touched (Map Tab owns it) and that every global the addon makes is named for it. The stub's
  Escape walks `UISpecialFrames` with `pairs` and hides every shown window, as the game does.
- **import**: the Casement import, twelve cases, each in a fresh Lua state so each is a real first
  login: the data holder present, another character later, the old Casement still running (and
  Map Tab having spoken first, with or without the shared flag), no addon API at all, already
  imported, the data holder switched off, the old addon switched off, settings already chosen in
  Bank Tabs, a data holder with nothing saved, and one the game will not load.
- **files**: the TOC, the sources (no caller of the old single saved window left; both kinds of
  tab built and hung by the one pair of functions in Core), the data holder's TOC, `.pkgmeta`, the
  release notes against the changelog, and no em or en dashes anywhere. The repo only parts are
  skipped for an installed copy.

It needs `fengari` on the module path; the copy this was developed against is not checked in.

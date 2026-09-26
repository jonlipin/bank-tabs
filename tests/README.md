# Offline harness

`banktabstest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because much of what
this addon does is geometry: clamping a window to the screen, putting a window back after the game
has re-anchored it, and laying the saved bank out slot for slot where the real one has its slots.

```
node tests/banktabstest.js [addon dir] [--bare] [--verbose] [--noenum]
```

Run it from the repo root; the addon dir defaults to the folder above `tests`.

- no flags: 580 checks against the normal client
- `--bare`: 573; every UI template is missing, so every fallback path runs
- `--noenum`: 576; no `Enum.BagIndex`, so the bank scan falls back to the classic container ids
- `--verbose`: prints everything the addon puts in the chat frame

The result line adds up three parts, printed just above it:

- **main**: one load on a clean install (no Casement anywhere): the bag, bank and guild bank
  windows, the three snapshots, the replicas, tooltips, gold, the backpack icons, the minimap
  button, the options, the slash commands and the saved variables. It also checks that the world
  map is never touched (Map Tab owns it) and that every global the addon makes is named for it.
- **import**: the Casement import, twelve cases, each in a fresh Lua state so each is a real first
  login: the data holder present, another character later, the old Casement still running (and
  Map Tab having spoken first, with or without the shared flag), no addon API at all, already
  imported, the data holder switched off, the old addon switched off, settings already chosen in
  Bank Tabs, a data holder with nothing saved, and one the game will not load.
- **files**: the TOC, the data holder's TOC, `.pkgmeta`, the release notes against the changelog,
  and no em or en dashes anywhere. The repo only parts are skipped for an installed copy.

It needs `fengari` on the module path; the copy this was developed against is not checked in.

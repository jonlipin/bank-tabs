# Offline harness

`banktabstest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because much of what
this addon does is geometry: clamping a window to the screen, putting a window back after the game
has re-anchored it, and laying the saved bank out slot for slot where the real one has its slots.

```
node tests/banktabstest.js [addon dir] [--bare] [--verbose] [--noenum] [--eui | --euibags] [--dark]
```

Run it from the repo root; the addon dir defaults to the folder above `tests`.

- no flags: 975 checks against the normal client, WoW Forever as its own interface code describes
  it: its real `Enum.BagIndex`, its bank tabs through `C_Bank` (a Bag Slot is a bank tab, its bag
  in the `Characterbanktab` container), the bank drawn as one grid of every tab, and `UnitName`
  giving a first name and a surname. The window style is Automatic with no EllesmereUI, so nothing
  is drawn until the Look page picks Dark, which is then drawn at once.
- `--bare`: 962; every UI template and atlas is missing, so every fallback path runs. As on the
  client, `SetAtlas` raises nothing for a missing atlas, so only a real check of the atlas table
  lets a fallback step in.
- `--noenum`: 950; a classic client: no `Enum.BagIndex` and no bank tabs, so the bank scan falls back
  to the classic container ids, the bank bags hang off inventory slots and the saved bank shows one
  tab or bag at a time
- `--dark` (or `DARK=1`): 1002; the player has chosen the Dark window style, drawn as the world comes
  up after the first login. Dark's own drawing calls write down what they were called on, as the
  EllesmereUI stand-in's do, and still draw: every saved window, slot, tab and options window
  control is checked as drawn, and so are the Bank, Bags and Guild tabs on the game's backpack
  (standing on its edge, the backpack itself untouched), each tab's icon filling it, cut to its
  shape under a 1 pixel edge, with the backdrop as opaque as the
  setting says and Dark's accent line under the chosen tab only, while the options page in the
  game's panel keeps the game's look.
- `--eui` (or `EUI=1`): 1007; a stand-in EllesmereUI whose skinning facade writes down every call
  per frame and calls the skin back at PLAYER_LOGIN, plus a stand-in for its Bags module's window
  (`EUI_MainBagFrame`): every saved window, slot, tab and options window control is checked as
  skinned, with no skin errors, and the Bank, Bags and Guild tabs hang on that window, follow it,
  wrap and switch.
- `--euibags`: 989; EllesmereUI and its Bags window with the Blizzard Skins+ module off, so the skin
  never runs: the saved windows keep the game's look, and the tabs on EllesmereUI's window are Bank
  Tabs' own flat ones until the Look page picks Dark, when they give way to Dark's tabs.
- The modes combine: `--bare` or `--noenum` with any of the others, and `--dark` with `--eui`
  (EllesmereUI running, Dark chosen over it) or `--euibags` (Dark's tabs on EllesmereUI's window).
- In every mode the Look page is gone through: the style button (left and right click, its
  tooltip), the opacity slider (grayed unless Dark is chosen, live on the Dark windows, in steps
  of 5), the reload prompt when leaving a drawn style and its going again on coming back,
  `/banktabs style`, and a reset. And in every mode the X of each of Bank Tabs' own windows is
  clicked in combat: the stub refuses `HideUIPanel` and `ShowUIPanel` there as the game does, and
  its close button template clicks through `HideUIPanel` as the game's does, so the X must hide the
  window itself, the way its tab does.
- `--verbose`: prints everything the addon puts in the chat frame

The result line adds up three parts, printed just above it:

- **main**: one load on a clean install (no Casement anywhere): the bag, bank and guild bank
  windows, the three snapshots, the bank layout measured off the real window (whatever else of a
  slot's size is in it: a stray button above, beside or below the grid, a hidden part of the
  window, WoW Forever's bank before its slots are made, a saved layout one column wide), the
  Bag Slots read as bank tabs (when the client has let go of its tab list and the bags' icons, and
  through the item location when the container read has nothing), the replicas (never drawn from
  a layout that is no grid; the bank as one grid with its pages, a bank saved by 2.0.1, the Bag
  Slots with their bags and padlocks and a bag lighting up its slots; the bags read like a page
  with the short row on top; the guild bank with a tab per guild, this character's first, and its
  lines with no empty slots behind them: not opened, no tabs, a tab nobody could see into), the
  names with their surnames and each character's guild, the three saved windows open at once (each on its
  own character with its own search, the Escape order and its surviving the interface being hidden
  and shown, where they open in each order and where they are left, kept on screen with their
  character tabs by the backpack tabs' rule, the saved bags leaving out the character
  being played, the saved bank's unsaved line), the tabs above the backpack (the shared tab
  builder, where they hang, following the backpack, kept on screen with it when it is dragged to
  the top, one row drawn smaller on the separate backpack and two rows on a narrow combined one,
  chosen while their window is open, dimmed
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
- **files**: the TOC, `Styles.lua` byte for byte the copy every addon carries (ShardGrid's installed
  one is the reference), the sources (no caller of the old single saved window left; both kinds of
  tab built and hung by the one pair of functions in Core), the data holder's TOC, `.pkgmeta`, the
  release notes against the changelog, and no em or en dashes anywhere. The repo only parts are
  skipped for an installed copy.

It needs `fengari` on the module path; the copy this was developed against is not checked in.

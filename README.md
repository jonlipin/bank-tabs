# Bank Tabs

Every character's bank, bags and guild bank, saved and shown from anywhere exactly as the real
windows draw them, with a spellbook style tab for each character. And the game's bag, bank and
guild bank windows made movable: drag them where you want them, and nothing can go off screen.

Bank Tabs is for the World of Warcraft Forever client (build 1.60.1). Everything is a switch in
**Esc > Options > AddOns > Bank Tabs**, or `/banktabs`.

Bank Tabs was called Casement until 2.0.0. Casement also moved and resized the world map; that part
is now its own addon, **Map Tab** (the world map tab, coordinates and the fog reveal). Updating
brings everything Casement saved over to Bank Tabs, see "Coming from Casement" below.

## What it does

**Your bank, bags and guild bank, from anywhere**

- Whatever your bank holds is saved every time you open it, and shown back to you as the bank
  window itself: the same portrait and title frame, the search box top right, the eight wide grid
  with every empty slot drawn, the Bag Slots row underneath, the money bottom right. Every item is
  in the slot it was actually in. Click a bank bag in the Bag Slots row to look inside it.
- Your bags are saved too, a few seconds after you log in and whenever they settle. The saved bags
  show your other characters' bags, as the combined backpack shows them; the character you are
  playing already has its real backpack in front of it.
- The guild bank is saved when you open it, one tab at a time, and shown in its own shape with its
  tabs down the side.
- Every character on the account is remembered. A row of tabs in the spellbook's style hangs off
  the top of the saved bank and the saved bags, one per character with their class icon. The saved
  bank's first tab is the character you are playing, so your own bank can be looked at from
  anywhere too. Each window is titled for the character on show: "Vatik's Bank", "Choham's
  Backpack".
- The saved bank, the saved bags and the saved guild bank are separate windows that can be open
  at the same time, each on its own character with its own search. Drag each by its title; it
  stays on screen and is remembered where you left it. Escape closes the one opened last first.
- Three tabs above your backpack, Bank, Bags and Guild, open the saved windows. They are the same
  tabs as the character tabs, glow while their window is open, and are dimmed while there is
  nothing saved for them. They hang off the top of the backpack, clear of its title, close button
  and portrait, and move with it. On a backpack too narrow for all three in a row, the Guild tab
  sits in a second row above, the way the character tabs wrap, and none hangs past its edge.
- Every item tooltip says who has it and where: a line per character with the count in their bank
  and bags, the guild bank, and an account total. Your own bags are counted live. Switch it off,
  or have it only while holding a key, in the options.
- `/banktabs gold` lists every character's gold and the account total, which also sits in the
  corner of the saved bank and on the minimap button's tooltip. Hovering the money on your bag
  window, the bank or the saved bank shows the same list.
- The saved bank lays itself out from measurements taken off the real bank window while it was
  open, so the slots sit exactly where the real ones do on this client.

**Bag, bank and guild bank windows you can move**

- Separate switches for the combined bag window, the individual bag windows, the reagent bag, the
  bank window with its bank bags, and the guild bank, each with its own Reset.
- Drag any of them by the strip along the top edge. The close button is left clear. The strip
  is invisible unless you switch on "show me where the drag strips are".
- Hold alt (or shift, or ctrl, or nothing, your choice) and you can drag a window from anywhere on
  it, which helps when its top edge is busy.
- Every window is remembered per character, and the game putting a bag window back in its stack,
  or placing the bank as it opens, does not undo your placing.
- No window can be dragged off screen. It is clamped while you drag it, when the position is
  saved, and again if you change your resolution or UI scale. The backpack is kept far enough
  below the top of the screen for its tabs to stay in reach.

**A minimap button**

Left-click for the saved bank, right-click for the options, shift and left-click to lock or unlock
the bag and bank windows, drag it around the rim. `/banktabs minimap` hides it.

## Commands

| Command | What it does |
| --- | --- |
| `/banktabs` | Opens the options |
| `/banktabs window` | Opens the options in a window of their own |
| `/banktabs bank` | Opens the saved bank, drawn like the bank window, or closes it when it is in front |
| `/banktabs bags` | Opens the saved bags (your other characters'), or closes them when in front |
| `/banktabs guild` | Opens the saved guild bank, or closes it when it is in front |
| `/banktabs snapshot` | Saves your bags, and the bank or guild bank if one is open |
| `/banktabs gold` | Lists every character's gold and the account total |
| `/banktabs lock` / `unlock` | Turns every window switch off or on |
| `/banktabs reset` | Puts every bag and bank window back where the game had it |
| `/banktabs grips` | Outlines the part of each window you can drag |
| `/banktabs minimap` | Shows or hides the minimap button |
| `/banktabs debug` | Prints what resolved on this client |

`/btabs` works as a short form of all of these. `/casement` and `/cst` still work too, for macros
written before 2.0.0, once the old Casement is no longer running.

## Coming from Casement

The game names an addon's saved settings after its folder, so the package also carries a small
`Casement` folder ("Casement (old data)" in the AddOns list). It runs no code; it only keeps
Casement's saved files where Bank Tabs and Map Tab can read them.

- At your first login Bank Tabs copies every character's saved bank, bags and guild banks, and the
  measured bank layout, and says so once in chat.
- Each character's window switches, drag key, window positions, minimap button, snapshot and
  tooltip settings come over the first time that character logs in.
- Nothing you have already set in Bank Tabs is overwritten, and a snapshot taken since is never
  replaced by an older one. The world map's settings are left for Map Tab.
- If the old Casement is still running next to Bank Tabs, it is switched off from your next login
  and chat says so once. Until then it keeps the bag and bank windows, the backpack buttons, the
  minimap button, the tooltip lines and the `/casement` command, so the two do not fight over
  them; after a `/reload` Bank Tabs takes over. Whatever you change in the old Casement until then
  (a bag or the bank moved, a switch flipped) comes over when you log out or reload, unless you
  changed the same setting in Bank Tabs meanwhile.
- If Casement's files cannot be read yet (the old Casement switched off, say), chat says why once
  and Bank Tabs tries again at each login. With no Casement folder at all nothing is said, and
  each login looks again in case one turns up later.
- Once Bank Tabs and Map Tab have both loaded on every character you play, the Casement folder can
  be deleted. Each Bank Tabs update puts it back, which does no harm. `/banktabs debug` shows what
  was found and what came over.

## Source and issues

https://github.com/jonlipin/casement

## If something does not work

Run `/banktabs debug` and send the output. Every part of the addon probes the client before it
uses it, and the report says what it found: which windows it located, which templates resolved,
whether the bag re-stacking hook took, what the bank scan saw, what the bank window measured, and
what came over from Casement.

## Building and testing

`tests/banktabstest.js` is an offline harness. It stubs the game API in fengari, including a small
layout engine for points, anchors and scales, and walks the addon's main paths: clamping and
dragging the bag and bank windows, putting them back after the game re-anchors them, the bag
switches, all three snapshots, the saved bank, bags and guild bank replicas slot by slot, the three
saved windows open together (their own characters and searches, Escape order, where they open and
are left), the tabs above the backpack, the tooltips, the gold, and the options. It also loads the
addon afresh for each way the Casement
import can meet a login (the data holder present, the old addon still running, nothing present,
already imported, and the ways those go wrong), and checks the package files.

```
node tests/banktabstest.js              # the normal client
node tests/banktabstest.js --bare       # every UI template missing
node tests/banktabstest.js --noenum     # no Enum.BagIndex, classic bank ids
```

It needs `fengari` on the module path. See `tests/README.md` for the counts.

## License

MIT.

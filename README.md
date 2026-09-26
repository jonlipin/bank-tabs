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
- Your bags are saved too, a few seconds after you log in and whenever they settle, and shown as
  the combined backpack shows them.
- The guild bank is saved when you open it, one tab at a time, and shown in its own shape with its
  tabs down the side.
- Every character on the account is remembered. A row of tabs in the spellbook's style hangs off
  the top of the window, one per character with their class icon, so any character's bank or bags
  can be looked at from anywhere.
- Three icons in your backpack's header open the saved bank, the saved bags and the saved guild
  bank. They sit in a part of the header the game is not already using.
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
  saved, and again if you change your resolution or UI scale.

**A minimap button**

Left-click for the saved bank, right-click for the options, shift and left-click to lock or unlock
the bag and bank windows, drag it around the rim. `/banktabs minimap` hides it.

## Commands

| Command | What it does |
| --- | --- |
| `/banktabs` | Opens the options |
| `/banktabs window` | Opens the options in a window of their own |
| `/banktabs bank` | Opens the saved bank, drawn like the bank window |
| `/banktabs bags` | Opens the saved bags |
| `/banktabs guild` | Opens the saved guild bank |
| `/banktabs snapshot` | Saves your bags, and the bank or guild bank if one is open |
| `/banktabs gold` | Lists every character's gold and the account total |
| `/banktabs lock` / `unlock` | Turns every window switch off or on |
| `/banktabs reset` | Puts every bag and bank window back where the game had it |
| `/banktabs grips` | Outlines the part of each window you can drag |
| `/banktabs minimap` | Shows or hides the minimap button |
| `/banktabs debug` | Prints what resolved on this client |

`/btabs` works as a short form of all of these. `/casement` and `/cst` still work too, for macros
written before 2.0.0.

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
  and chat says so once.
- Once Bank Tabs and Map Tab have both loaded on every character you play, the Casement folder can
  be deleted. `/banktabs debug` shows what was found and what came over.

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
switches, all three snapshots, the saved bank, bags and guild bank replicas slot by slot, the
tooltips, the gold, and the options. It also loads the addon afresh for each way the Casement
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

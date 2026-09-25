# Casement

Casement makes the game's own windows behave themselves. Move the world map and resize it, drag
your bags, your bank and your guild bank wherever you want them, and keep a snapshot of what your
bank holds so you can check it from the other side of the world.

Everything is a switch in **Esc > Options > AddOns > Casement**, or `/casement`.

## What it does

**The world map**

- Drag it by its top bar, anywhere along it. The game's own buttons up there are measured and left
  alone, so the bar is only draggable in the stretches nothing else is using.
- Everything the addon adds lives in a tab under the map, wearing the game's own panel art, so
  nothing is laid over the map's interface: minus, the current percentage, plus, a button back to
  100 percent, and the resize grip.
- Drag the grip to resize. Hold shift while you drag to snap to round steps. The buttons always
  land on a round multiple of the step, so repeated clicks walk 90, 100, 110 even if a drag left
  you on 97.
- Resizing scales the whole map rather than stretching the frame. Everything on it, the pins, the
  zone art and the text, keeps its proportions.
- A gold handle in the top left corner appears by itself if the top bar ever has no room to spare,
  and can be switched on permanently.
- Coordinates at the left end of the tab: your position and, on a second line, where the cursor
  is pointing on the map. A button next to them puts your position into chat with the zone name
  first ("The Barrens 45.2, 67.8"); right-click it for a box to copy the text out of with Ctrl+C.
- Optionally, the parts of the map you have not explored are drawn in with their real art, tinted
  blue, sepia or grey so they can still be told apart. The list of every map's overlays ships with
  the addon (`Data/MapOverlays.lua`, generated from the client's own map tables), and everything
  any character on this account is handed is remembered on top of it, so a patch that adds an
  area is picked up as soon as anyone sees it. `/casement mapdata` says how much of the open map
  is known.

**Bags, bank and guild bank**

- Separate switches for the combined bag window, the individual bag windows, the reagent bag, the
  bank window with its bank bags, and the guild bank.
- Drag any of them by the strip along the top edge. The close button is left clear. The strip
  is invisible unless you switch on "show me where the drag strips are".
- Hold alt (or shift, or ctrl, or nothing, your choice) and you can drag a window from anywhere on
  it, which helps when its top edge is busy.
- Every window is remembered per character, and the game putting a bag window back in its stack
  does not undo your placing.

**No window can be dragged off screen.** It is clamped while you drag it, when the position is
saved, and again if you change your resolution or UI scale.

**Bank snapshots, drawn like the bank**

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
- `/casement gold` lists every character's gold and the account total, which also sits in the
  corner of the saved bank and on the minimap button's tooltip.

**A minimap button**

Left-click for the options, right-click for the saved bank, shift and left-click to lock
or unlock every window, drag it around the rim. `/casement minimap` hides it.

## Commands

| Command | What it does |
| --- | --- |
| `/casement` | Opens the options |
| `/casement window` | Opens the options in a window of their own |
| `/casement vault` | Opens the saved bank, drawn like the bank window |
| `/casement bags` | Opens the saved bags |
| `/casement guild` | Opens the saved guild bank |
| `/casement snapshot` | Saves your bags, and the bank or guild bank if one is open |
| `/casement scale 120` | Sets the world map size |
| `/casement lock` / `unlock` | Turns every window switch off or on |
| `/casement minimap` | Shows or hides the minimap button |
| `/casement gold` | Lists every character's gold and the account total |
| `/casement coords` | Puts your coordinates in a box to copy |
| `/casement mapdata` | Reports how much of the shown map the reveal knows; `dump` opens all of it |
| `/casement reset` | Puts every window back where the game had it |
| `/casement grips` | Outlines the part of each window you can drag |
| `/casement debug` | Prints what resolved on this client |

`/cst` works as a short form of all of these.

## If something does not work

Run `/casement debug` and send the output. Every part of the addon probes the client before it
uses it, and the report says what it found: which windows it located, which templates resolved,
whether the bag re-stacking hook took, and what the bank scan saw.

## Building and testing

`tests/casementtest.js` is an offline harness. It stubs the game API in fengari, including a small
layout engine for points, anchors and scales, and walks the addon's main paths: clamping, dragging,
scaling, snapping, the bag switches, both snapshots and the vault window. It also builds a
stand in for the quest panel, so the layering that the resize grip needs is actually asserted
rather than assumed, and the bank, bags and guild bank replicas are checked slot by slot.

```
node tests/casementtest.js              # 474 checks
node tests/casementtest.js --bare       # every UI template missing
node tests/casementtest.js --noenum     # no Enum.BagIndex, classic bank ids
```

It needs `fengari` on the module path.

## License

MIT.

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

**Bags, bank and guild bank**

- Separate switches for the combined bag window, the individual bag windows, the reagent bag, the
  bank window with its bank bags, and the guild bank.
- Drag any of them by the strip along the top edge. The close button is left clear.
- Hold alt (or shift, or ctrl, or nothing, your choice) and you can drag a window from anywhere on
  it, which helps when its top edge is busy.
- Every window is remembered per character, and the game putting a bag window back in its stack
  does not undo your placing.

**No window can be dragged off screen.** It is clamped while you drag it, when the position is
saved, and again if you change your resolution or UI scale.

**Bank snapshots**

- Whatever your bank and your guild bank hold is saved every time you open them.
- `/casement vault` shows it from anywhere: every character on the account and every guild bank
  you have opened, with item tooltips, stack counts and a search box.
- Your backpack gets a Bank button, and a Guild button once there is a guild bank saved, both
  opening the vault straight at that record. They are placed in a part of the header the game is
  not already using.
- The guild bank is read one tab at a time, which takes a couple of seconds, and the tab you were
  looking at is put back when it is done.

**A minimap button**

Left-click for the options, right-click for the saved bank contents, shift and left-click to lock
or unlock every window, drag it around the rim. `/casement minimap` hides it.

## Commands

| Command | What it does |
| --- | --- |
| `/casement` | Opens the options |
| `/casement window` | Opens the options in a window of their own |
| `/casement vault` | Opens the saved bank contents |
| `/casement snapshot` | Saves whatever bank is open in front of you |
| `/casement scale 120` | Sets the world map size |
| `/casement lock` / `unlock` | Turns every window switch off or on |
| `/casement minimap` | Shows or hides the minimap button |
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
rather than assumed.

```
node tests/casementtest.js              # 176 checks
node tests/casementtest.js --bare       # every UI template missing
node tests/casementtest.js --noenum     # no Enum.BagIndex, classic bank ids
```

It needs `fengari` on the module path.

## License

MIT.

# Changelog

All notable changes to Casement are listed here. The newest release is at the top.

## 1.0.0 - 2026-09-24

First release.

**The world map**

- A drag handle in the top left corner moves the map. It sits clear of the game's own buttons
  along the top edge rather than covering them.
- A grip in the bottom right corner resizes it. Holding shift while dragging snaps to the step.
- A bar under the map with minus, the current percentage, plus, and a button back to 100 percent.
  The buttons always land on a round multiple of the step, which defaults to 10 percent.
- Resizing scales the whole window, so the map, its pins and its text keep their proportions.
- The grip and the bar are given the inverse of the map's scale, so they stay the same size on
  screen however large the map is.
- A maximized map is left alone.

**Bags, bank and guild bank**

- Separate switches for the combined bag window, the individual bag windows, the reagent bag, the
  bank and its bank bags, and the guild bank.
- Each window is dragged by the strip along its top edge, with the close button left clear.
- Hold alt, shift or ctrl (your choice, or none) to drag a window from anywhere on it.
- Bag positions are saved per bag rather than per frame, so a bag keeps its place even though the
  game hands out its windows in whatever order it likes.
- Moved bag windows are put back after the game re-stacks them.
- Panel windows are taken out of the game's panel stack while they are being managed, and handed
  back when the switch is turned off.

**Off screen**

- Every managed window is clamped while it is dragged, when its position is saved, and again when
  the resolution or the UI scale changes. A window larger than the screen is held at the edges
  rather than pulled inside them.

**Bank snapshots**

- The bank and the guild bank are saved every time they are opened, and while they are open.
- `/casement vault` shows them from anywhere: every character on the account and every guild bank
  the account has opened, with tooltips, stack counts, free slot counts, money and a search box.
- The guild bank is read one tab at a time and the tab you were looking at is put back afterwards.
- The legacy bank container is skipped when the real character bank tabs exist, because it reports
  slots on this client but holds nothing.
- Where the client has no Enum.BagIndex to read, the classic bank container ids are used instead.

**Options**

- A canvas page in Esc > Options > AddOns > Casement, with the same controls in a standalone
  window through `/casement window`. No Settings proxy objects are registered, because those taint
  this client.
- Per window Reset buttons, a Reset everything button, and `/casement debug` for a report of what
  resolved on this client.

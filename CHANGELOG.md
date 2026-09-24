# Changelog

All notable changes to Casement are listed here. The newest release is at the top.

## 1.0.1 - 2026-09-24

**Fixed: the map could not be resized while the quest panel was open.** The grip sat in the map's
bottom right corner, which is underneath the quest panel. It was still drawn, so it looked like it
should work, but the panel's own frames sit well above it and took every click. Two changes:

- Everything this addon adds to the map now lives in a tab that hangs under it, wearing the game's
  own panel art, rather than being laid inside the map's frame. The resize grip is in that tab
  alongside the percentage buttons, so it can never be covered by anything the map draws.
- Anything the addon does lay over one of the game's windows now walks that window first and puts
  itself above the highest strata and frame level it finds inside, rather than assuming a few
  levels up is enough. This is rechecked every time the window is shown or changes size, which is
  what happens when the quest panel opens.

**Fixed: a moved bag flickered through its default position when opened.** The position was being
restored on the next frame, after the game had already drawn the window where it wanted it. The
hook on the game's bag re-stacking now restores it in the same frame, before anything is drawn.

**The map is dragged by its top bar.** Anywhere along it: the band is measured against the game's
own controls up there and only the stretches nothing else is using take the mouse, so the zone
buttons, the maximize and the close button all still work. The corner handle is still there and
shows itself on its own if the top bar ever has no room, or permanently if you ask for it.

**A minimap button.** Left-click for the options, right-click for the saved bank contents, shift
and left-click to lock or unlock every window, drag it around the rim. `/casement minimap` and a
switch in the options hide it.

**Bank buttons on the bag window.** With snapshots on, your backpack gets a Bank button, and a
Guild button once there is a guild bank saved, each opening the vault straight at that record.
They are placed in a part of the header the game is not already using, and fall back to sitting
just above the window if the header is full.

Also in this release:

- The resize drag now watches the mouse button itself rather than waiting for a mouse up on the
  grip, which the grip may never see now that it slides away as the map grows.
- The map tab flips above the map if the map is sitting at the bottom of the screen.
- The tab uses the tooltip backdrop rather than the big window templates, whose metal border
  breaks below roughly 156 by 110.
- `/casement debug` reports how many draggable stretches the top bar gave up, what layer the tab
  reached, and how many times the resize grip has actually been pressed, so a grip that never
  receives a click can be told apart from one that receives it and does nothing.
- The offline harness grew to 176 checks and now builds a stand in for the quest panel, so the
  layering and the top bar measuring are tested rather than assumed.

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

## 2.4.0 - 2026-11-15

**New: the reagent bag inside the combined backpack.** With the bags combined, the game still
opens the reagent bag as a window of its own beside the backpack. A new switch on the Windows
page of the options, "Reagent bag inside the combined backpack", puts its slots in the backpack
instead: in rows of their own above the bags, with a line between, read left to right like the
rest. The backpack grows by those rows and the separate window is gone. It is off until you
switch it on.

- They are the same slots, not copies. Clicking, dragging, searching, sorting, cooldowns and
  tooltips all work as they did, in combat too.
- The reagent bag shows whenever the game opens it with the backpack, which is whenever all the
  bags are opened: the bag key, or a vendor or the bank opening them. Opening the backpack alone
  shows the backpack alone, as the game has it.
- Closing the backpack closes the reagent bag with it.
- It only applies to the combined backpack. With separate bags, with the gamepad interface (the
  game merges the reagent bag itself there) and with the bag window of EllesmereUI, nothing
  changes.

The reagent bag was already saved for every character: the saved Bags window shows it under
each character's bags, and item tooltips count what is in it.

1074 checks against the normal client, 1061 with every UI template missing and 1008 for a classic
client without `Enum.BagIndex`; 1101 with Dark chosen, 1065 with EllesmereUI and 1047 with
EllesmereUI's bag window and its skins off.

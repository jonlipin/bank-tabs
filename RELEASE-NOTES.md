## 2.0.1 - 2026-10-02

**Fixed: the saved bank could show every character's items in one long column instead of the
bank's grid.** Bank Tabs draws the saved bank from measurements of the real bank window, taken
while it is open: how many slots across, how far apart, and where the grid starts. It took the
topmost row of slot sized buttons in the window for the grid's first row, so one more button of
a slot's size above the grid, from another addon for example, was read as a bank one slot wide.
That measurement was then used for every character's saved bank, and a later, correct one could
not replace it, because it counted one slot more than the real grid. Measuring the window in the
moment before WoW Forever has made the bank's slots, with only the Bag Slots and the sort button
in it, could go the same way.

- The measurement now finds the grid itself: the longest run of full rows lying one under another
  at the same spacing. Other buttons of a slot's size are left out, and `/banktabs debug` says how
  many were.
- Only what is on screen is measured. A button inside a hidden part of the window no longer counts.
- A measurement that is not a grid (fewer than four columns, or slots overlapping or far apart) is
  not used, and the last good one stands.
- Layouts saved one column wide by earlier versions are dropped at login, and a saved layout is
  checked again before the saved bank is drawn with it. Until your bank is next opened and
  measured, the saved banks are drawn on the classic bank's grid, which is very close to this
  client's. The items in every saved bank are kept as they were.

867 checks against the normal client, 858 with every UI template missing and 863 without
`Enum.BagIndex`.

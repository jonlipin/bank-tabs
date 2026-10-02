## 2.0.2 - 2026-10-02

**Fixed: bank bags.** On WoW Forever a Bag Slot is a bank tab: buying a Bag Slot and putting a bag
in it adds the bag's slots to the bottom of the bank's own grid. Bank Tabs looked for those bags
the classic way, as inventory slots, and found none.

- The saved bank showed each bag as a tab of its own down the side, and the main grid without the
  bag's slots. It now draws the bank as the real window does: one grid, the main tab's slots first
  and each bag's after them, a page of 88 slots at a time with a tab per page.
- The Bag Slots row showed every slot as "Not purchased" with nothing in it. It now shows the bag
  in each bought slot and the real bank's padlock on the rest, and pointing at a bag lights up its
  slots in the grid.
- A bank saved before this release is drawn the new way straight away, its bought Bag Slots read
  from its saved tabs. The bags' icons come back the next time that character opens the bank.

**Fixed: the saved bags were upside down.** They were drawn from the bottom right corner up, a
guess at the combined backpack that the real one has now shown to be the wrong way round. They
now read like a page, left to right from the top, the backpack's first slot starting the top
row, which is the short one when the slots do not fill it.

**Characters are named by first name and surname**, as every character on WoW Forever has both:
"Vatik Voidpact's Bank" rather than "Vatik's Bank", the same on the character tabs, in the item
tooltip lines and in the gold list. Two characters can share a first name. A character saved by
an earlier version shows its surname after its next login.

The test harness now models WoW Forever's bank from the client's own interface code: its real
list of containers, its bank tabs and its Bag Slots. 895 checks against the normal client, 886
with every UI template missing and 870 for a classic client without `Enum.BagIndex`.

## 2.1.1 - 2026-10-03

**Fixed: with your bags separate, the backpack's tabs were stacked in two rows.** With the bags
not combined, the backpack is a window of its own 178 wide, too narrow for the Bank, Bags and
Guild tabs side by side beside its portrait, so the Guild tab was put in a row of its own above
the other two. They now stay in one row there, drawn a little smaller (about four fifths size)
to fit between the portrait and the right edge. The combined backpack is unchanged.

925 checks against the normal client, 916 with every UI template missing and 900 for a classic
client without `Enum.BagIndex`.

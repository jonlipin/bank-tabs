## 2.3.0 - 2026-11-15

**New: a Characters page, to hide or delete what is saved.** Until now a character stayed on the
tabs for good: one on a realm you no longer play, or one you deleted in game. The options have a
new Characters page listing everything Bank Tabs has saved, realm by realm, characters and guild
banks alike, each with two buttons:

- **Hide** takes it off the tabs, the item tooltips and the gold total, and keeps what is saved.
  Show brings it back.
- **Delete** forgets everything saved for it. Click it twice to confirm. This is the way to clear
  out a character that no longer exists; one that still does is saved again the next time you
  log in on it.

A switch at the top, "Show characters and guild banks from other realms", leaves out every other
realm at once without deleting anything. It is on by default, as before. The character you are
playing can be neither hidden nor deleted.

Open the page from the options, with `/banktabs characters`, or by right-clicking any character
tab on a saved window.

**Fixed: on a gamepad, the d-pad jumped out of the bags onto the tabs.** With a gamepad the game
steps through a bag window's buttons as a grid, and it counted the Bank, Bags and Guild tabs
above the backpack, and the drag strip across the window's top, as buttons of that grid. Moving
left or right through the middle of the bags landed on them. They now carry the mark the game
gives addons for exactly this, and the d-pad stays among the items. On a gamepad the tabs are
clicked with the cursor, or the saved windows opened with `/banktabs bank`, `bags` or `guild`.

1030 checks against the normal client, 1017 with every UI template missing and 1005 for a classic
client without `Enum.BagIndex`; 1057 with Dark chosen, 1062 with EllesmereUI and 1044 with
EllesmereUI's bag window and its skins off.

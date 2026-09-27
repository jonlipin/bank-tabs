## 2.0.0 - 2026-09-26

**Casement is now two addons, and this one is Bank Tabs.** Casement did two unrelated jobs under a
name that described neither. From this release:

- **Bank Tabs** (this addon, the same project with the same history): dragging the combined bag,
  individual bag, reagent bag, bank and guild bank windows, never off screen and remembered per
  character; every character's bank, bags and guild bank saved and viewable from anywhere, drawn
  like the real windows, with a spellbook style tab per character; lines on item tooltips saying
  who has the item and where; every character's gold; the tabs above the backpack; the minimap
  button.
- **Map Tab** (a new, separate download): moving and resizing the world map from the tab under it,
  your coordinates and the cursor's with a copy to chat button, and the optional drawing of the
  parts of the map you have not explored. Install it alongside Bank Tabs if you used any of that.

**Everything you had comes with you.** The game names an addon's saved settings after its folder,
so the new name alone would have left them behind. This release therefore also installs a small
`Casement` folder, listed as "Casement (old data)" in the AddOns list, which runs no code and only
keeps Casement's saved files where they can be read. At your first login Bank Tabs copies over
every character's saved bank, bags and guild banks and the measured bank layout, and chat says so
once. Each character's own window switches, drag key, window positions, minimap button, snapshot
and tooltip settings come over the first time that character logs in. Nothing already set in Bank
Tabs is overwritten, and a snapshot taken since is never replaced by an older one. The world map's
settings and the reveal's collected map data are left for Map Tab, which brings its own half over
the same way. If Casement's files cannot be read yet (the old Casement switched off, say), chat
says why once and Bank Tabs tries again at each login. With no Casement folder at all nothing is
said, and each login looks again in case one turns up later. Once both addons have loaded on every
character you play, the Casement folder can be deleted; each Bank Tabs update puts it back, which
does no harm. `/banktabs debug` reports what was found and what came over.

**If the old Casement is still running** (for example Bank Tabs was unzipped next to Casement 1.2.3
rather than over it), Bank Tabs still brings everything over, switches the old Casement off from
your next login, and says so once in chat. Until then the old Casement keeps the bag and bank
windows, the backpack buttons, the minimap button, the tooltip lines and the `/casement` command,
so the two do not fight over them; after a /reload Bank Tabs takes over. Whatever you change in
the old Casement until then (a bag or the bank moved, a switch flipped) comes over when you log out
or reload, unless you changed the same setting in Bank Tabs meanwhile. Map Tab does the same, and
only one of the two speaks.

**New names.** The commands are `/banktabs` and the short `/btabs`; `/casement` and `/cst` still
work for old macros once the old Casement is gone. The options are under Esc > Options > AddOns >
Bank Tabs. The map commands
(`scale`, `coords`, `mapdata`) now say that the map went to Map Tab.

**Changed: the minimap button.** Left-click opens the saved bank and right-click the options, the
other way round from Casement, since the saved bank is what it is for now. Shift and left-click
still locks or unlocks the bag and bank windows. Its icon, and the addon's icon in the AddOns list,
is a bag rather than the map.

**New: the saved bank, the saved bags and the saved guild bank are separate windows,** so they can
be open at the same time. Each opens and closes on its own, keeps its own character and its own
search, can be dragged by its title, stays on screen, and remembers where it was left. Until it
has been moved, the saved bank opens in the middle of the screen as the single window did, and so
do the saved bags unless the bank is showing, when they open beside it; the guild bank opens
beside whatever is open. None opens on top of another or moves it: with the middle taken, a window
opens beside what is there. Escape closes the one opened last
first. Opening a window that is already open brings it to the front; the tabs, the minimap button
and the slash commands close it when it is in front.

**Changed: the saved windows are named for the character.** The saved bank says "Vatik's Bank" and
the saved bags "Vatik's Backpack", and the title follows the character tab you choose. The guild
bank keeps its title.

**Changed: the saved bags show your other characters.** Your own bags are the real backpack in
front of you, so the saved bags have no tab for the character you are playing and open on the
first other character with bags saved. Until another character has been saved they say so in a
short line instead of drawing an empty grid. Item tooltips and gold still count every character.

**Changed: the saved bank has a tab for the character you are playing, first in the row,** so your
own bank can be looked at from anywhere. Until your bank has been saved, that tab shows a short
line asking you to visit a banker once.

**Changed: the backpack's header buttons are tabs.** The three small buttons over the backpack are
now tabs in exactly the style of the character tabs, built by the same code: the same size, the
spellbook tab art with its chosen glow, the same clipped icon. They hang off the top edge of the
backpack (the combined backpack, or the backpack's own window when bags are separate), clear of
its title, close button and portrait, and move with it. On a backpack too narrow for all three in
a row, the Guild tab sits in a second row above, the way the character tabs wrap. The backpack is
kept far enough below the top of the screen for its tabs to stay in reach. Left to right: Bank,
Bags, Guild. A tab glows while its saved window is open and is dimmed while there is nothing saved
for it; clicking one opens that window, or closes it when it is in front. The option is now called "Tabs above the
backpack".

**Fixed: other characters' saved bags came back empty, with no gold.** This client empties its
bag information by the time you log out, and the logout snapshot saved that empty read over the
good copy taken in play, gold included. Casement did the same, but it only showed once the saved
bags began showing your other characters. A read with no backpack, or a logout read with fewer
bag slots than the last snapshot, now never replaces what was saved; a logout read of no gold
keeps the gold last seen; and your gold is saved whenever it changes. A bags record already saved
empty is dropped when you log in, so that character's gold shows its bank's copy again until it
next logs in and its bags are saved properly.

**Fixed: opening the guild bank on a lower rank character wiped tabs it cannot view.** A tab
your rank cannot view came back empty and was saved over what a character who could view it had
saved, which also took those items out of the tooltip counts. It now keeps its saved contents.

**Changed: the minimap button is a treasure chest,** not the brown bag, which Stockpile also uses.
The tabs' dark fill now sits exactly behind the icon, inside the frame.

# Changelog

All notable changes to Bank Tabs are listed here. The newest release is at the top. Bank Tabs was
called Casement until 2.0.0, and the Casement releases follow the first section.

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

## 1.2.3 - 2026-09-24

**Fixed: toggling the map's quest log made a placed map jump to the game's spot for a frame and
back.** The game changes the map's width first (which Casement already caught) and then runs its
panel positioning, which re-anchored the map after that. Casement now hooks the game's panel
positioning itself, and the map's own layout methods, so a placed window is put back in the same
frame after every anchor the game sets and nothing is ever drawn out of place. The same hook
covers the bank window. A window the user is holding is never snapped back.

## 1.2.2 - 2026-09-24

**Fixed: the saved bank lost its measured layout the moment the real bank closed.** A last
snapshot is taken at closing, and by then the game has already hidden the bank window, so that
snapshot could measure nothing and wrote "unknown" over the good measurement, dropping the Bag
Slots row into the classic guess and squashing it. A measurement is now carried forward through
snapshots that cannot take one, a partial one never replaces a fuller one, and the freshest one is
kept for the account so other characters' saved banks use this client's real geometry too. A
closing read that comes back empty (the client can let go of the bank's contents at that point)
no longer replaces a real snapshot either.

**Fixed: the class icon on a character tab showed through the tab frame's corners.** It is now
clipped to the tab window's shape with the same mask the game uses for its own icon frames,
rounded along the top and flat along the bottom, drawn a quarter larger than the icon as that
atlas needs.

## 1.2.1 - 2026-09-24

**Fixed: the saved bank and bags framed every item in a fat border.** Only uncommon and better
wear a border in the real bank and bags, and the replica now follows that rule, using the game's
own quality glow tinted per quality. Common items sit clean in their slots.

**Fixed: the saved bank's slots were packed tighter than the real bank's.** The snapshot now
measures the real bank window while it is open (where the grid starts, how far apart the slots
are, the window's size, and the Bag Slots row) and the replica lays itself out from those numbers,
so it matches this client's bank exactly instead of a guess. This also picked up that this client's
bank has eight Bag Slots, not the classic seven. `/casement debug` prints what was measured; a bank
saved before this release uses the classic numbers until it is next opened.

**Fixed: one character showed up as two tabs.** The name this client hands back has been seen to
change between logins ("Vatik" one day, "Vatik Voidpact" another), which split one character's
snapshots across two entries. Characters are now keyed by their GUID, which never changes; the
display name travels with the entry, and an older entry saved under a matching name is folded in
the next time that character takes a snapshot.

**The drag anywhere overlay no longer lights the windows up.** Holding alt still lets you drag a
window from anywhere; nothing shows on screen unless "show me where the drag strips are" is on.

**Hover the money.** Hovering the money on your bag window, on the bank, or on the saved bank lists
every character's gold and the account total, marking the one you are on.

## 1.2.0 - 2026-09-24

**Item tooltips say who has it and where.** Every item tooltip gets a line per character on the
account that has the item, with how many are in their bank and their bags, a line for the guild
bank, and an account total when it is in more than one place. Your own bags are counted live;
everything else is what was saved the last time that bank or those bags were seen. The lookup runs
off an index that is rebuilt only when a snapshot changes, so hovering costs nothing. Switches in
the options: on or off, include the guild bank, add the total, and only while holding shift, ctrl
or alt to keep tooltips short until asked. Uses the game's modern tooltip pipeline, with the older
tooltip script as the fallback.

**Gold across the account.** `/casement gold` lists every character's gold (yours live, the rest
as last seen) and the total. The total sits small in the bottom left corner of the saved bank and
bags (switchable), and on the portrait tooltip; each character tab's tooltip shows that character's
gold; the minimap button's tooltip carries the total too.

## 1.1.1 - 2026-09-24

**The reveal now ships the full overlay table.** `Data/MapOverlays.lua`: 84 maps, 1,073 overlays,
1,739 tiles, generated by `tools/overlays-from-csv.js` from the game client's own `WorldMapOverlay`
and `WorldMapOverlayTile` tables for build 1.60.1.70009 (exported from wago.tools). With it the
reveal can draw every unexplored area of every map on this beta, not only the ones a character on
the account has already seen. The numbers describe Blizzard's map data; the textures themselves
are in the client, so nothing is shipped but the list. The harvest still runs underneath, so if a
patch adds an overlay the table lacks it is picked up as soon as anyone on the account sees it, and
`/casement mapdata` now says how many overlays of the open map are shipped versus harvested.

The converter cross-checks a pasted `/casement mapdata dump` against the table, so the shipped
numbers can be proven against what the client hands out.

## 1.1.0 - 2026-09-24

**Coordinates in the map tab.** Your position and, on a second line, where the cursor is pointing
on the map, both as hundredths of the map the way every coordinate addon prints them. They sit at
the left end of the tab, so switching them on grows the tab leftwards, away from the sizing
controls. A button next to them puts your position into the chat box with the zone name first
("The Barrens 45.2, 67.8"), into whatever you are already typing if a chat line is open;
right-click it for a box the text can be copied out of with Ctrl+C. `/casement coords` opens that
box too. Both lines are switches in the options.

**Drawing the parts of the map you have not explored.** Off by default. The game paints explored
areas over a blank base map from overlay art it only hands out for the areas you have been to, so
to draw the rest the addon needs its own list of every overlay a map has. Casement keeps two:
whatever is shipped with it, and a harvest of every overlay any character on this account has
ever been handed, kept account wide, so an alt sees what the main has explored. The drawn in areas
can be tinted (blue, sepia or grey) so they can still be told from the ones you have been to.
`/casement mapdata` says how much of the open map is known; `/casement mapdata dump` opens the
whole harvest in a copy box so it can be folded into the shipped data. The shipped list was empty
in this release; 1.1.1 filled it.

**A copy box** for anything the game will not put on the clipboard itself (a selected edit box
does reach it with Ctrl+C).

## 1.0.2 - 2026-09-24

**The snapshot window is now a replica of the bank.** Not a list any more: the same portrait and
title frame, the search box top right, the eight wide grid with every empty slot drawn, the Bag
Slots row underneath, the money bottom right. Every item is drawn in the slot it was actually in
when the bank was last open, never packed together. Click a bank bag in the Bag Slots row to look
inside it. The guild bank gets the same treatment in its own shape, seven columns of fourteen
filled down each column, with its tabs down the right hand side.

**Your bags are remembered too.** They are read a few seconds after you log in, whenever they
settle after a change, and on the way out at logout, and shown as the combined backpack shows
them: one grid filled from the bottom right corner, the backpack's first slot in that corner and
each further bag stacked above, a reagent bag in its own grid underneath.

**Every character on the account is remembered**, bank and bags, and a row of tabs in the
spellbook's style hangs off the top of the snapshot window, one per character with their class
icon in it, so any character's bank or bags can be looked at from anywhere.

**Three icons in the backpack's header** open the saved bank, the saved bags and the saved guild
bank. They sit in a clear stretch of the header, and one with nothing behind it yet is dimmed
rather than hidden. `/casement vault`, `/casement bags` and `/casement guild` do the same.

**The map tab.** Everything the addon adds to the map now lives in a tab hanging under it, wearing
the game's own panel art: minus, the current percentage, plus, a reset icon in place of the "100%"
text, and the resize grip wearing the chat window's own grabber. Nothing is laid on the map's
interface any more. Double-click the grip for 100 percent.

**Fixed: closing the quest log put the map back where the game wanted it.** The game re-anchors
the map as the log closes; a placed map is now put back in the same frame. A map that was never
moved is still left entirely to the game.

**Fixed: the header lit up under the mouse.** The hover tint on a drag strip now answers to the
"show me where the drag strips are" switch, which is off by default.

Also in this release:

- A saved bank from 1.0.0 or 1.0.1 is lifted into the new shape the first time it is seen.
- The "keep snapshots from my other characters" switch is gone, since other characters are the
  point now.
- `/casement debug` reports the bag slots API, the character tab art and the bag icon art that
  resolved.
- The offline harness now runs 397 checks. The slot positions, the column by column guild grid
  and the lifting of an old saved bank were each proven to fail when the code they cover is
  broken, so those are tested rather than assumed.

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

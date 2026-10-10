## 2.2.0 - 2026-10-10

**Window styles: a Dark look built in, and EllesmereUI's.** A new Look page in the options picks
how Bank Tabs' own windows are drawn: the saved bank, bags and guild bank with their slots and
tabs, and the options window.

- **Automatic**, the default, matches EllesmereUI when it is installed and keeps the game's look
  otherwise.
- **Blizzard** keeps the game's own window art.
- **Dark** is a flat dark style built into Bank Tabs that needs no other addon: dark backgrounds,
  a title strip, thin edges, flat buttons, square slots, and an item's quality shown as a colored
  edge round its slot.
- A **Dark background opacity** slider (0 to 100%, in steps of 5) sets how much of the world shows
  through the Dark windows, and they change as you drag it. It is grayed out unless Dark is
  chosen.
- `/banktabs style auto`, `blizzard` or `dark` picks a style from chat; `/banktabs style` on its
  own steps to the next one.
- Going from Blizzard to another style draws it at once. Leaving a drawn style takes a reload of
  the interface, and a small window offers one (Reload now or Later). It goes away again if you
  change your mind back.
- The game's own windows keep their look, the backpack included, and so does the Bank Tabs page in
  Esc > Options > AddOns, as every other addon's page there does. The options window
  (`/banktabs window`) wears the style.
- Resetting every setting puts the style back to Automatic. `/banktabs debug` has a "skin" line
  saying which look is in use, and why when it is not the one you expected.

**EllesmereUI support.** With EllesmereUI installed and its Blizzard Skins+ module on, Automatic
gives the saved windows, their slots and tabs and the options window EllesmereUI's look, its font
included. It can be switched off for Bank Tabs in EllesmereUI's own options, under Blizzard
Skins+ > Window Skins > Third-Party Addons (takes a reload). Without EllesmereUI nothing changes:
it is optional, not a requirement.

- **The Bank, Bags and Guild tabs on EllesmereUI's bag window.** EllesmereUI's Bags module
  replaces the game's bag windows with one window of its own. The three tabs now hang above that
  window's top edge, starting from its left corner, and go wherever it goes: in the style's flat
  tab look while a style is drawn, and in a flat dark look of Bank Tabs' own while none is.
- **The minimap button stays where a button collector puts it.** A collector such as EllesmereUI's
  can take the button off the minimap, and Bank Tabs no longer pulls it back onto the rim. On the
  minimap it still drags round the rim as before.

**The tabs in a window style.**

- The Bank, Bags and Guild tabs above the game's backpack wear the style's tab look too, like the
  saved windows' tabs: flat, standing on the backpack's top edge, with the accent line under the
  tab whose window is open. Under Dark they kept the spellbook's shape before. The backpack itself
  is left as the game draws it.
- A tab's icon fills the whole tab, cut to the tab's shape rather than stretched, under a thin
  edge.

**Fixed: the X on Bank Tabs' windows did nothing in combat.** In combat, the close button of the
saved bank, bags or guild bank, or of the options window, gave "Interface action blocked", while
the window's tab still closed it. The X now closes its window in combat too.

**Spelling.** The changelog and the code's notes now use American spelling (gray, color).

975 checks against the normal client, 962 with every UI template missing and 950 for a classic
client without `Enum.BagIndex`; 1002 with Dark chosen, 1007 with EllesmereUI and 989 with
EllesmereUI's bags but its skins off.

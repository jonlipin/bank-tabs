## 2.1.0 - 2026-10-02

**A tab per guild on the saved guild bank.** Every guild bank saved on your account now has a tab
of its own along the top of the saved guild bank, built like the character tabs: the guild of the
character you are playing first, even before its bank is saved, then the others by name. Hover a
guild's tab for when its bank was last seen, its gold and which of your characters are in it, and
click it to look at that guild bank. Bank Tabs now remembers which guild each character is in for
this. Until now the window showed only the guild of the character you were playing, or whichever
saved guild came first, with no way to switch. Item tooltips already gave every guild bank a line
of its own, and still do.

**Fixed: empty slots drawn over the saved guild bank's notes.** With nothing to show, the window
still drew its seven columns of empty slots, the note hidden behind them. The note now stands
alone and says why there is nothing to show:

- the guild bank has not been opened yet;
- it had no tabs to show when it was last opened (none bought, or none handed to that
  character), which is now saved instead of the window asking for it to be opened again;
- nobody who opened it could see into the tab on show.

The Guild tab above the backpack speaks for the guild the saved guild bank opens on and counts
the other guild banks saved.

923 checks against the normal client, 914 with every UI template missing and 898 for a classic
client without `Enum.BagIndex`.

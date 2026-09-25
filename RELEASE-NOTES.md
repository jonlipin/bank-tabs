## 1.2.3 - 2026-09-24

**Fixed: toggling the map's quest log made a placed map jump to the game's spot for a frame and
back.** The game changes the map's width first (which Casement already caught) and then runs its
panel positioning, which re-anchored the map after that. Casement now hooks the game's panel
positioning itself, and the map's own layout methods, so a placed window is put back in the same
frame after every anchor the game sets and nothing is ever drawn out of place. The same hook
covers the bank window. A window the user is holding is never snapped back.

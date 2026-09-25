# Offline harness

`casementtest.js` loads the addon into fengari with a stubbed WoW API and walks its main paths.
The stub carries a small layout engine (points, anchors, effective scales) because most of what
this addon does is geometry: clamping a window to the screen, holding one corner still while the
map is scaled, and putting a window back after the game has re-anchored it.

```
node casementtest.js [addon dir] [--bare] [--verbose] [--noenum]
```

- no flags: 447 checks against the normal client
- `--bare`: every UI template is missing, so every fallback path runs
- `--noenum`: no `Enum.BagIndex`, so the bank scan falls back to the classic container ids
- `--verbose`: prints everything the addon puts in the chat frame

It needs `fengari` on the module path. The copy this was developed against lives in
`C:\Users\jonli\AppData\Local\Temp\claude`.

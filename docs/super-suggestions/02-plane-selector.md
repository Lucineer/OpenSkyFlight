# 02 — Selectable planes

**The idea:** more than one aircraft. A small plane selector — tap or
swipe to switch between the Rafale and a few others (prop plane,
biplane, something fun). Purely cosmetic; flight behavior unchanged.

**Why it fits iPad:** choosing your plane is the most kid-legible
feature there is. On touch, a swipe-through hangar or a row of big
thumbnails beats any menu.

**Where it plugs in:** `js/aircraft/AircraftManager.js` loads one
`.gltf`. A selector module loads any `.glb` from a list, normalizes
scale via bounding box and forward orientation to match the Rafale's
convention. Free CC0 low-poly models exist (Kenney, Quaternius) — no
modeling required. Keep each model under ~2MB and low-poly; the iPad
will thank you. Compressed glTF (Draco) for the win.

**Status on our fork:** prototype in progress locally — we can show
screenshots when it's verified.

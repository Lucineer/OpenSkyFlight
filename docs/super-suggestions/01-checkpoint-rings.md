# 01 — Checkpoint rings + timer + score

**The idea:** make the existing waypoints visible as glowing rings in
the 3D sky, with a running timer and a score at the end. Rings + timer
+ score — the smallest possible step from tech demo to game.

**Why it fits iPad:** no keyboard needed. Rings are big touch-friendly
targets in the sky itself; the timer is a HUD badge; restart is one
tap. It works with the current flight model (constant-speed
flythrough) — no physics required, so it can't break the feel you
have now.

**Where it plugs in:** the waypoint spline machinery already exists
(`js/flightplan/FlightPlan.js` — CatmullRom, `getNextWaypointIndex`,
`getSplinePoints`). Nothing renders a waypoint in 3D today; rings hang
off that spline. New module, e.g. `js/game/GateRings.js`; the game tick
goes in `animate()` right after the aircraft state resolves. The
flight controller is never modified — the game only reads position.

**iPad specifics:** rings need to be visible at touch-typical viewing
distances; active-gate tinting (next ring glows, others dim) matters
more on a small screen. Personal bests can reuse the localStorage
pattern already in `BenchmarkComparator`.

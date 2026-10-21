# Sitka Real Sim — Detail Backlog

Playtest + comparative research pass, 2026-10-20/21. Sources: `js/runway/physics.js`
(probed in node across a full matrix — see Part 1), `main.js`, `scene.js`,
`aircraft.js`, `REAL-SIM.md`, plus genre knowledge (MSFS 2024, X-Plane Mobile,
Infinite Flight, GeoFS; racing speed sensation, sailing wind/water feel,
tycoon/career progression, survival tension, arcade juice). MiniMax was
consulted twice for a second opinion and returned empty replies both times,
so this backlog leans on direct probing + genre knowledge; re-run the
MiniMax pass if a dissenting ranking is wanted.

**How to use this file:** one item = one slice. Each item states what the
player feels, what to build, and how to verify it alone. Build in order
within each tier. Nothing here requires another item first unless stated.
iPad-first throughout: 44px+ targets, no hover, no new modal that blocks
the runway view, capped render cost.

---

## Part 1 — Physics stress-matrix findings (measured, not guessed)

Method: node harness importing `physics.js` directly. Takeoff matrix = all
4 aircraft × loads (empty, 0.35, 0.7, MTOW slider-equivalents) × wet/dry ×
winds (−20/−10/0/+5/+10/+20 kt) via `simulateTakeoff` (perfect policy: full
throttle, rotate at VR). Landing matrix = same aircraft/loads/wet/winds via
`step()` with the shipped landing spawn (final, 900 m alt, 9 km out, full
flaps, 72 m/s jets / 33 m/s C172, throttle 0.55) plus a glide/flare/brake
policy. Targeted probes: climb-after-liftoff, stall, stop distances,
rotation gate, spool, HUD math. Harness kept at `/tmp/matrix.mjs`,
`/tmp/probe2.mjs`, `/tmp/probe3.mjs` (ephemeral — re-create from the
descriptions below if a re-run is needed).

### Reference: takeoff liftoff distances at MTOW, wind 0 (perfect policy)

| Aircraft | Dry | Wet | % of 2,195 m strip (wet) |
|---|---|---|---|
| C172 | 167 m | 240 m | 10.9% |
| 737-700 | 797 m | 1,094 m | 49.8% |
| 737-800 | 1,035 m | 1,507 m | 68.7% |
| 737-900ER | 1,255 m | 1,900 m | 86.6% |

The shipped tuning bounds hold. The problems are elsewhere.

### F1 — LANDING SCENARIO CANNOT BE FINISHED BY FOLLOWING THE ON-SCREEN GUIDANCE (worst)

The shipped landing spawn (900 m alt, 9 km out, throttle 0.55, "hold Vref")
never lands under a guidance-following policy. Measured with a glide
(−3° pitch) + flare + brake/reverse policy on the 737-800 at MTOW, dry,
+5 kt: after 500 s the plane is **56.7 km past the start — ~45 km past the
runway end — still in `final` mode at 724 m altitude doing 227 kt**, with
no outcome and no feedback. Root cause: at 55% throttle the jet accelerates
past Vref until excess lift cancels the descent (it levels off near
230 kt); the −3° pitch then produces ~zero sink. The C172 is worse: on
final at spawn throttle it **climbs away** (900 m → 2,995 m over 500 s).
A landing IS possible only with an aggressive profile (idle + −8° pitch +
speedbrake), which touches down short of the threshold (see F2) — the
opposite of what the banners teach. Fix slice: retune the landing spawn
(lower altitude and/or closer distance for a true ~3° path, spawn throttle
≈0.26–0.30 so Vref is holdable, or spawn already configured on a stable
glide) AND add a missed-approach/fly-past outcome (see backlog item L1).
Verify: guidance-following policy lands on the strip; flying past the
field ends the attempt with a "missed approach" message, never an endless
`final`.

### F2 — LANDING SHORT IN THE WATER IS SILENTLY ACCEPTED AS A NORMAL LANDING

Aggressive idle descents touch down **before** the threshold — measured
−508 m and −148 m past the threshold (i.e., in Sitka Sound, since water
is at both ends and the causeway starts at the threshold) — and the game
treats them as ordinary landings: mode `roll`, brakes work, plane stops,
no splash, no fail message, and the LANDED score card can fire. The
touchdown branch never checks whether the touchdown point is over the
runway at all. Fix slice: if `touchdown.distM < 0` (short) or the plane
is over water at touchdown, splash/fail like an overrun. Verify: idle
−8° + speedbrake policy from 900 m now splashes instead of "landing."

### F3 — NO CRASH MODEL: A STALL DIVE INTO THE GROUND BECOMES A 258 KT "LANDING"

Stall probe (737-800, MTOW, 300 m, 145 kt, 30% throttle, 15° pitch): stalls
at 5.2 s, dives, hits the ground at **258 kt** — and the touchdown branch
converts it to mode `roll` with no crash, no damage, no message. Any
ground contact at any speed or sink rate is a "landing" today. Fix slice:
crash outcome when touchdown sink or speed exceeds limits (e.g. sink
> 6 m/s or speed > 1.3× touchdown speed), with a crash banner + reset.
Verify: the stall-dive probe ends in `crash`, not `roll`.

### F4 — RUDDER IS A DEAD CONTROL

`st.rudder` is written by the rudder hold-buttons and Q/E keys but is
**never read by `step()`** — grep confirms the only occurrence in
`physics.js` is the field declaration. The ◀ RUDDER / RUDDER ▶ buttons and
Q/E do nothing the player can feel. (Aileron works: roll → heading.
Trim works: pitch target. Rudder does not.) Fix slice: wire rudder into
the ground roll (nosewheel steering at low speed, weathervane resistance)
and into the air (coordinated turn / slip, heading nudge). Verify: holding
rudder on the roll visibly changes heading/lateral position; in the air
it changes turn coordination. Until then, the buttons are decoration —
either wire them or hide them.

### F5 — ROTATION GATE USES GROUND SPEED, NOT AIRSPEED (headwind doesn't help; tailwind rotates you into a stall)

`step()` allows rotation when ground speed `vMs >= 0.97 × VR`, but VR is an
airspeed. Consequences, all measured:
- Headwind barely shortens takeoff rolls (737-800 MTOW wet: 1,507 m at
  wind 0 → 1,504 m at +20 kt; should be ~15% shorter). The gate forces the
  plane to wait for ground-speed VR even though it could fly sooner.
- Tailwind lets you rotate BELOW stall speed: 737-900 MTOW, VR 144 kt,
  gate at 140 kt ground → **120 kt airspeed at a −20 kt tailwind, vs
  Vs 132 kt** — the plane pitches up into a regime where lift cannot
  carry it.
- 737-900 MTOW wet at −20 kt tailwind **overruns even with a perfect
  policy** (53.5 s, 157 kt ground speed, never lifts). At −10 kt it uses
  96.4% of the strip.
Fix slice: gate rotation (and the HUD's ROTATE call) on airspeed
(`airspeedMs`), not ground speed. Verify: +20 kt headwind shortens the
738 MTOW wet roll materially; −20 kt tailwind no longer permits rotation
below Vs (the plane either lifts later or the HUD warns).

### F6 — WET RUNWAY STOPS *SHORTER* THAN DRY (backwards lesson)

737-800 stopping from 136 kt with brake + reverse: **dry 512 m in
14.8 s; wet 440 m in 12.6 s**. Cause: braking force is `W × 0.35`
regardless of surface, while wet rolling resistance (μ 0.115 vs 0.02)
adds extra drag that *helps* stopping. The game currently teaches that
wet landings are easier. Fix slice: make braking surface-dependent
(e.g. dry 0.35, wet ~0.22) so wet landings run long, matching the wet
takeoff penalty. Verify: wet stop > dry stop at the same weight/speed.

### F7 — HUD "RUNWAY LEFT" LIES ON FINAL

`remainingFt()` = `runwayEndM − distM`. On the landing spawn (9 km out)
that reads **36,729 ft** — the distance to the far end of the runway,
shown under the label "RUNWAY LEFT." A player on final reads 36,729 ft
and thinks they have oceans of room; the real numbers are 29,528 ft to
the threshold + 7,200 ft of strip. Fix slice: on `final`, show distance
to threshold (and strip length after it), e.g. "THR 29,500 ft · RWY
7,200 ft"; switch to strip-remaining after touchdown. Verify: final
spawn HUD reads ≈29,500 ft to threshold, not 36,729.

### F8 — LANDING SPAWN STALLS OUTRIGHT IN TAILWIND (no warning)

Spawn airspeed vs stall speed at MTOW, full flaps: 737-900 at −10 kt
tailwind = 130 kt vs Vs 132 kt → **instant STALL flag on final**;
737-800 at −20 kt = 120 vs 126 → stall; C172 at −20 kt = 44 vs 48 →
stall. The scenario select offers these winds with no warning, and the
first thing the player sees is a stall banner 9 km out. Fix slice: clamp
or warn (landing spawn speed scales with weight/Vref, or the setup bar
refuses/warns tailwind > 10 kt on landing). Verify: no spawn in the
matrix starts stalled.

### F9 — FORGETTING THE GEAR STALLS THE HEAVY 737-900 AFTER LIFTOFF (untaught, but real)

Climb probe (MTOW, full throttle, 12° pitch, 60 s): 737-900 gear DOWN
stalls after liftoff (min speed 129 kt, max alt 616 m, stall flag set);
gear UP climbs clean to 749 m with no stall. The gear drag term (cd
+0.018) is exactly enough to tip the heavy stretch over the edge. This
is good simulation — gear discipline matters — but nothing teaches it:
no "GEAR UP" callout, no drag cue, no checklist. Fix slice: add a gear
callout + a subtle climb-rate cue (see backlog A5/G2); keep the physics.
Verify: gear-down heavy-900 climb shows the callout before the stall.

### F10 — SPOOL CHARGES WHILE THE BRAKES ARE SET (standing full-thrust launches)

`step()` updates spool before the `hold` early-return, so 5 s of throttle
on the brakes gives spool = 1.00 and an instant full-thrust launch on
release. Standing takeoffs are real, but it quietly bypasses the spool-lag
lesson the roll is supposed to teach. Fix slice (design call): either
keep it and teach it ("spool up on the brakes — real technique") or
freeze spool in `hold` until the brakes release. Verify per whichever
call is made. Low priority either way.

### F11 — FLAPS-0 AND 80% THROTTLE ARE GUARANTEED SWIMS AT MTOW WET (harsh, but teachable)

737-800/900 at MTOW wet: flaps 0 → overrun both; 80% throttle → overrun
both. Flaps 30 is slightly better than 15 (738: 1,446 m vs 1,507 m).
Rotation +5 s late on the 739 MTOW wet → overrun; +2 s late → 93.5% of
the strip. These are good teeth — the game should keep them and *teach*
them (pre-takeoff briefing: "flaps 15, full power, rotate at VR or swim")
rather than soften them. No physics change; a UI/teaching slice.

### F12 — SMALL MATH/UI NOTES (batch into one cleanup slice)

- Weight slider maps empty→MTOW linearly, so slider 0.85 on the 738 is
  73,375 kg = **92.9% of MTOW**, not 85%. The HUD shows exact kg (good),
  but the slider has no % label — either label it "payload/fuel" or show
  "% MTOW" honestly.
- `landed` mode is never assigned (only mentioned in comments); the
  LANDED card instead keys off `vMs < 1 && touchdown`. Works, but the
  dead mode string invites confusion — remove or use it.
- Takeoff "never rotate" case behaves correctly: 738 MTOW dry reaches
  191 kt and overruns without lifting — rotation is genuinely required.
  Keep.
- Climb performance is otherwise sane: MTOW jets climb to 600–880 m in
  60 s at 12° without stalling (except F9); C172 climbs fine.

---

## Part 2 — Comparative detail backlog (prioritized)

Tiers: P0 = fix before calling the sim complete (Part 1 findings as
slices). P1 = highest feel-per-effort, do next. P2 = systems that deepen
the sim. P3 = progression/world. P4 = polish. Effort: S = one focused
session, M = a few sessions, L = a project. "Verify" = how to check the
slice alone.

### P0 — Correctness fixes (from Part 1; do first)

1. **L1 — Landable landing scenario + missed-approach outcome** (M).
   Retune landing spawn (altitude/distance/throttle so a guided approach
   lands) and add a fly-past outcome: crossing the far end still in
   `final` = "MISSED APPROACH — go around" with reset. Fixes F1.
   Verify: guided policy lands; fly-past policy ends with the message.
2. **L2 — Short landings splash** (S). Touchdown before the threshold
   (over water) = splash/fail, same as overrun. Fixes F2.
   Verify: aggressive idle policy splashes instead of "landing."
3. **L3 — Crash outcome** (S). Touchdown beyond sink/speed limits, or
   ground contact in `air` mode at high sink/speed, = crash banner +
   reset, not silent `roll`. Fixes F3.
   Verify: stall-dive probe ends in `crash`.
4. **L4 — Working rudder** (S). Wire `st.rudder` into ground steering
   and coordinated flight. Fixes F4. (Do before any crosswind item.)
   Verify: rudder input visibly steers on the ground and in the air.
5. **L5 — Airspeed-based rotation gate** (S). Gate rotation + ROTATE
   call on airspeed, not ground speed. Fixes F5.
   Verify: headwind shortens rolls; tailwind can't rotate below Vs.
6. **L6 — Surface-dependent braking** (S). Wet braking < dry braking so
   wet landings run long. Fixes F6.
   Verify: wet stop distance > dry at same weight/speed.
7. **L7 — Honest HUD on final** (S). Distance-to-threshold on final,
   strip-remaining after touchdown; honest "% MTOW" on the load slider.
   Fixes F7 + F12.
   Verify: final spawn reads ≈29,500 ft to threshold.
8. **L8 — No stalled spawns** (S). Landing spawn speed scales with
   weight/Vref, or tailwind landing warns/refuses. Fixes F8.
   Verify: no matrix cell starts stalled.
9. **L9 — Gear callout** (S). "GEAR UP" callout + climb cue after
   liftoff; keep the gear-drag physics. Fixes F9 (teaching side).
   Verify: heavy-900 gear-down climb shows the callout pre-stall.

### P1 — Feel: audio, camera, juice (highest impact per effort)

10. **A1 — Engine sound that follows spool, with a second layer** (S).
    Today: one sawtooth hum, 45→100 Hz, gain 0.02→0.07. Add: pitch AND
    volume tied to spool with a spool-up whine (rising tone as N1
    climbs), a distinct reverse roar when reverse is held, and idle
    rumble at 0% (never dead silent on the runway — silence reads as
    broken). Racing-game rule: the engine IS the speedometer. Verify:
    spool 0→1 sweeps audibly; reverse has its own sound.
11. **A2 — Wind audio tied to airspeed** (S). Filtered-noise wind whose
    volume follows IAS — quiet on the runway, loud at 140 kt, screaming
    in a dive. Sailing-game rule: wind you hear is wind you respect.
    Verify: wind volume tracks IAS on takeoff and final.
12. **A3 — Touchdown thump + gear clunks + brake squeal** (S). A low
    thump on touchdown (scaled by sink rate), a clunk when gear moves,
    a soft squeal under heavy braking. These three sounds do more for
    "weight" than any visual. Verify: each fires exactly once per event.
13. **A4 — Stall buffet: shake + sound** (S). On `stalled`: camera shake
    + low rumble, growing with depth of stall. Today the stall banner
    appears but the world doesn't shudder. Survival-game rule: danger
    must be felt in the body, not just read. Verify: stall shakes the
    chase cam.
14. **C1 — Camera shake on the roll + FOV kick with speed** (S). Small
    shake scaled by ground speed and runway roughness (stronger when
    wet), plus a subtle FOV widen as speed builds (racing-game speed
    sensation). The runway texture already scrolls; shake + FOV sell
    velocity that a flat chase cam hides. Verify: 140 kt roll visibly
    shakes and widens vs 0 kt.
15. **C2 — Touchdown smoke + spray** (S). Puff particles at the wheels
    on touchdown (white smoke dry, grey spray wet), scaled by sink
    rate; a spray plume on a splash. Arcade juice: the landing's
    punctuation mark. Verify: touchdown spawns particles; splash
    spawns a plume.
16. **C3 — Wingflex + control-surface movement** (M). Wings bend
    slightly with load factor; flaps visibly extend, gear visibly
    retracts, spoilers rise. The models already expose gear groups;
    flap/gear animation makes the buttons feel connected to the plane.
    Verify: flap button moves a visible surface; gear button retracts
    the gear.
17. **C4 — Water that moves** (S). The Sound is a flat disc today.
    Animated normal ripple / slow wave scroll + whitecaps near the
    causeway gives speed reference at low altitude and sells "water at
    both ends" dread. Sailing-game rule: water must look alive or the
    hazard is abstract. Verify: water visibly moves from tower cam.
18. **C5 — Verify the nose cam** (S). Nose-cam position sits ~2 m
    behind the nose tip, i.e. inside the nose mesh (works today only by
    backface-culling luck). Move it just ahead of the nose or just
    behind the windshield and confirm the view is clean on all four
    aircraft. Verify: nose cam shows runway, not grey/white fill, on
    every plane.

### P2 — Systems that deepen the sim (each independently shippable)

19. **S1 — Crosswind model + gusts** (M). Requires L4 (rudder). Wind
    slider gains a crosswind component: lateral drift on the roll,
    weathervane tendency, gusts that spike the windsock and the HUD.
    Sitka is famously windy — this is the sim's home-field advantage.
    Verify: 15 kt crosswind visibly drifts the roll; rudder corrects it.
20. **S2 — ATC chatter window, menu-based** (M). Per the Phase 2 plan's
    direction: tap-to-talk menu ("request takeoff," "report final"),
    tower replies in text + optional voice, with clearances that gate
    the roll (taking off without clearance = a "violation" note, not a
    hard block — MSFS-style). Gives the runway start its social context.
    Verify: full exchange completes; clearance state shows in HUD.
21. **S3 — Checklist that matters** (M). Port the Phase 1 C172 checklist
    pattern into the runway page, but make items functional: gear pins,
    flaps set, trim set, brakes — each checklist item maps to a real
    control state, and skipping the "flaps" item leaves you with the
    F11 swim. A checklist that can be ignored is wallpaper; one that
    bites is a game. Verify: skipping flaps + MTOW wet = overrun, and
    the checklist says so afterward.
22. **S4 — Failures, rare and fair** (M). Small random-failure deck,
    telegraphed, never on the first three attempts: bird strike on
    rotation (one engine spools down, yaw kick — the real 2010 eagle
    strike), windshear gust on final, flat-spotted brake (longer stop).
    Each has a counter-play (abort, go around, reverse harder). Verify:
    each failure fires, is survivable with the right response, and is
    announced before it kills you.
23. **S5 — Weather as gameplay** (M). Rain/fog particles + visibility
    that actually changes (fog hides Edgecumbe and shortens the visible
    runway), rain streaks on the nose cam, wet-runway sheen. Weather
    today is a checkbox; make it a condition you fly in. Verify: fog
    setting hides the far threshold from tower cam; rain shows streaks.
24. **S6 — Bird flocks + wave-wash events** (S). Flocks cross the
    departure path on some takeoffs (visual + strike risk if flown
    through — ties to S4); storm waves occasionally wash over the
    causeway ends (visual + a "runway wet" auto-set + spray). Real
    Sitka hazards from REAL-SIM.md, as ambient life first, mechanics
    second. Verify: flocks appear on some departures; waves wash the
    ends on storm setting.
25. **S7 — Go-around button + pattern scoring** (M). Missed approach
    isn't a fail state, it's a maneuver: GO AROUND button (full power,
    gear/flaps sequence) + a scored full circuit (takeoff 29 → downwind
    → land 11) with marks for centerline, touchdown zone, sink rate,
    and stop distance. This is REAL-SIM.md build-order item 1, and it
    gives landing a reason to exist beyond one approach. Verify: a full
    circuit scores on all four marks.
26. **S8 — V-speed callouts + aural warnings** (S). "V1", "ROTATE",
    "GEAR UP", "SINK RATE", "PULL UP" as voice/text callouts at the
    right moments (MSFS/X-Plane standard). The HUD already computes the
    numbers; saying them makes them land. Verify: each callout fires at
    its trigger speed/state and never twice.

### P3 — Progression and world (keeps players coming back)

27. **P1 — Logbook + pilot rank** (M). Every takeoff/landing logs
    (aircraft, weight, wind, wet, result, strip used, touchdown zone)
    locally; rank titles unlock by totals (e.g. 10 clean landings →
    "Sound Pilot"). Tycoon rule: numbers that persist become a career.
    Verify: log survives reload; rank changes at the threshold.
28. **P2 — Mission set** (M). REAL-SIM.md missions as scored flights:
    Edgecumbe orbit, Sound tour, Juneau cross-country — each with a
    briefing, a route, and a score (time, smoothness, fuel). Missions
    reuse the circuit/scoring from S7. Verify: one mission completes
    with a score.
29. **P3 — New fleet, one tier at a time** (M each). E175 ("just fine"
    jet, forgiving), 757-200 at reduced load (the "barely" challenge
    tier Magnus asked for), Il-96 (legend unlock, story-gated). Rule
    from REAL-SIM.md: each plane must earn a performance tier, not a
    paint job — each ships with its own tuning-bound test. Verify: each
    new plane's matrix row differs meaningfully from the 737s'.
30. **P4 — Sitka life: boats, floatplanes, town lights** (M). Moving
    fishing boats in the Sound (future Jayhawk rescue targets), a
    floatplane or two at the dock, town lights at dusk. The world feels
    inhabited, and it seeds the Jayhawk crossover. Verify: boats move
    on the water; dusk lights appear.
31. **P5 — Time-of-day + dusk/dawn lighting** (S). The scene is one
    fixed noon today. A time control (morning/noon/dusk/night) with
    matching sky, sun, and town lights changes every flight's mood for
    almost no physics cost. Verify: dusk shows orange sky + town lights.

### P4 — Polish (do when the above is solid)

32. **P6 — Runway texture upgrades** (S). Displaced-threshold arrows,
    touchdown-zone stripes, rubber marks in the touchdown zone, wet
    sheen when the Wet box is checked. The strip is the star of this
    game; dress it. Verify: markings visible from tower cam at 500 m.
33. **P7 — Speedbrake + reverse effectiveness feedback** (S). HUD
    already shows SPDBRK/REVERSE states; add a deceleration readout
    ("DECEL 0.42 g") and a stop-distance predictor on final ("STOP IN
    ~500 m — FITS" / "— LONG"). Turns braking from a guess into a
    decision. Verify: predictor matches measured stop within 15%.
34. **P8 — Rejected-takeoff (RTO) trainer** (S). A scenario variant:
    engine failure called at V1−10 kt — abort correctly (brakes +
    reverse + spoilers) and stop on the strip, or overrun. The flip
    side of F11's "committed at V1" lesson. Verify: abort stops on
    strip; continuing past V1 with a dead engine overruns or stalls.
35. **P9 — Replay/ghost of your best landing** (M). Record the last
    circuit's path; replay a ghost plane beside you (the /fly/ REC
    pattern already exists in this codebase). Nothing teaches a groove
    like flying against your own best line. Verify: ghost replays a
    recorded landing.
36. **P10 — Haptics on iPad** (S). Tiny vibration on touchdown,
    rotation, stall buffet, and splash (navigator.vibrate, guarded).
    Touch-first juice that costs nothing on desktop. Verify: touchdown
    vibrates on a real iPad; no errors elsewhere.

---

## Appendix — What the matrix says is already good (don't break these)

- Tuning tiers hold: 739 MTOW wet 86.6% (bound ≥85%), 738 MTOW wet
  68.7% (bound <90%), C172 MTOW dry 7.6% (bound <25%).
- Rotation is genuinely required (never-rotate 738 MTOW dry reaches
  191 kt and overruns without lifting).
- Flaps matter enormously (flaps 0 = overrun at MTOW wet; flaps 30
  slightly beats 15) — keep this tooth.
- Late rotation is punished proportionally (+2 s → 93.5% strip on the
  739 MTOW wet; +5 s → overrun).
- Climb performance is sane for all four aircraft at MTOW (except the
  gear-down 739 case in F9, which is a feature with teaching missing).
- Stop distances are plausible magnitudes (738 from 136 kt: ~500 m
  with brake + reverse) — only the wet/dry ordering is wrong (F6).

## Suggested build order (first 10 slices)

L1 → L2 → L3 → L4 → L5 → L6 → L7 → L8 → A1 → C1. That sequence makes
the sim correct first (landings finish, water is water, crashes are
crashes, controls work, HUD tells the truth), then adds the two
highest-impact feel items (engine/wind sound, camera shake + FOV).
After that, S7 (circuit scoring) + S2 (ATC) give the sim its loop.

---

## Slice 1 shipped (2026-10-21, overnight) — L1/L2/L3

- Landing spawn retuned to a true 3° final: altitude = 9,000 m × tan(3°) ≈ 471 m,
  airspeed = level-flight speed at full flaps (new `levelSpeedMs` export),
  throttle 0.18. A faster spawn climbs away; a slower one stalls on spawn —
  both measured in node before locking.
- Outcomes now exist: guided approaches land (all four aircraft + tailwind
  case verified in `landing.test.js`, touchdowns 1630–1957 m — long but on
  the strip, gentle sinks); fly-past = MISSED APPROACH; gentle short =
  splash; stall dive and violent idle descent = crash (crash checked
  before splash: water at 7 m/s sink is concrete, not a ditching).
- Follow-up (not fixed here): touchdowns run long — the 100–600 m zone
  still wants approach-speed discipline (arrive at Vref, flare low).
  C172 final is long (9 km at ~30 m/s ≈ 5–6 min); consider a shorter
  final for the prop.

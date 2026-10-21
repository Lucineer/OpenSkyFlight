# Sitka Skies Pro — Real Sim direction (2026-10-20)

Magnus's direction: make the Sitka flight sim feel like Microsoft Flight
Simulator. You start on the runway, take off with all the controls, and fly
the planes that actually serve Sitka — the 737 first, plus other aircraft
whose runway performance is genuinely marginal at PASI. This doc supersedes
the Phase 2 plan's C172-only scope for the sim's flagship page; the Phase 1
checklist page (`index.html`) is untouched.

## Home airport

Sitka Rocky Gutierrez Airport (PASI), 57.0472° N, 135.3637° W.
Runway 11/29, water at both ends — an overrun means Sitka Sound, not grass.
That consequence is the sim's signature tension.

**Runway data (confirmed 2026-10-21, FAA via Wikipedia):** runway 11/29,
7,200 × 150 ft (2,195 × 46 m), asphalt; elevation 26 ft / 8 m AMSL;
57.04722° N, 135.36167° W, causeway off Japonski Island. The Phase 2
plan's 6,600 ft was stale — a 2010 source cited 6,500 ft; the runway was
extended since. The sim's `RUNWAY_M = 2195` is correct. True bearings are
119°/299° (designators 11/29 are the rounded shorthand the HUD uses).
Everything derives from the single constant in `js/runway/physics.js`.

## Slice 1 (shipped): runway start + takeoff + landing

Separate page `runway.html` — it never touches the stable sim or `/fly/`.

- **Scenarios:** Takeoff on runway 29 (depart west over the Sound, Edgecumbe
  dead ahead) and Landing on runway 11 (final over the water).
- **Start state:** sitting on the runway, parking brake set, engines at idle.
  No "already flying" spawn. The takeoff roll IS the game.
- **Full basic controls (touch + keyboard):** throttle, flaps (737 detents
  0/1/5/15/30), gear, speedbrake, parking brake, rudder, yoke (pitch/roll),
  trim, reverse thrust after touchdown, camera (chase / tower / nose).
- **Pre-takeoff planning (the sim lesson):** aircraft select, weight slider
  (payload + fuel), runway condition (dry / wet), wind (head / tail /
  crosswind). The HUD shows computed V1 / VR / V2 and live runway remaining
  in feet — amber, then red. This is what makes "barely" legible.
- **Energy model:** speed and altitude trade. Pull up without power and you
  sink; push over and you gain speed. Stall buffet + nose drop below Vs.
  Ground effect near the runway. Spool-up lag on the throttles.
- **Overrun = water.** Roll past the end still on the ground and you splash
  in the Sound, with a reset button. No soft fail.

## Fleet (slice 1) and runway-performance tiers

The 737 is the main plane around Sitka (Alaska flies them in daily). Tiers
are relative to PASI's runway — the same strip feels different per plane.

| Aircraft | Role | Runway feel |
|---|---|---|
| Cessna 172 Skyhawk | Trainer, contrast | Trivial. Off in a few hundred metres. |
| Boeing 737-700 | Alaska workhorse | Comfortable. The forgiving jet. |
| Boeing 737-800 | The main Sitka jet | Comfortable dry, honest when heavy + wet. |
| Boeing 737-900ER | The stretch | **Barely.** At high weight on a wet runway it eats nearly the whole strip. Rotate late and you're swimming. |

Tuning rule, verified by test (`js/runway/physics.test.js`): the 900 at
max weight on a wet runway must use ≥85% of the strip with perfect
technique (full throttle, flaps 15, rotate exactly at VR) — tight but
possible. The C172 at max weight must use <25%. If a tuning change breaks
either bound, the test fails and the change doesn't ship.

## Next fleet (grounded, not yet built)

- **Embraer E175** (Delta Connection seasonal) — "just fine" tier, a
  smaller jet that fits comfortably. Good second jet after the 737s.
- **Boeing 757-200 at reduced load** — the "barely works" challenge tier:
  marginal at 7,200 ft at weight. The plane Magnus asked for when he said
  "jets that it's just fine of runway for" — the 757 is the one that's
  *just* fine, and only when light.
- **Ilyushin Il-96 (legend unlock)** — a one-off Aeroflot widebody once
  flew Moscow–Sitka direct. Story plane, not a workhorse.

## Real Sitka hazards (gameplay backlog, all real)

- Storm waves washing onto the runway; exposed high-wind location.
- Bird flocks near the field — 2010: an Alaska 737-400 aborted takeoff
  after an eagle strike, stopping ~3,000 ft from the end.
- Lightning on final — Dec 2025: an Alaska 737-700 was struck on approach
  and landed safely. Future scenario material: bird-strike engine-out,
  wave-washed runway, crosswind gusts.

## What slice 1 deliberately leaves out

ATC window, missions, career/logbook, full weather (rain/fog particles),
wildlife, floatplane water ops, autopilot, FMC. Those are Phase 2/3 items
from the original plan and stay on that list. Engine sound is a tiny
WebAudio hum only — no continuous audio system yet.

## Build order after slice 1

1. Full circuit: takeoff 29 → downwind → land 11, with pattern scoring.
2. ATC window (menu-based, per the Phase 2 plan's Jev verdict).
3. Missions (Edgecumbe orbit, Sound tour, Juneau cross-country).
4. Weather as gameplay (Sitka rain/fog/wind affecting the roll).
5. More fleet: wheeled Beaver (short-field star), and whatever else
   Magnus asks for — each new plane must earn a performance tier, not
   just a paint job.

## Slice 1 shipped (2026-10-21, overnight) — landable landings

Landing scenario rebuilt: true 3° final (471 m at 9 km, level-flight
airspeed at full flaps, throttle 0.18), with real outcomes — guided
approaches land, fly-past = missed approach, gentle short = splash,
stall dive / violent descent = crash. Verified in node
(`js/runway/landing.test.js`); takeoff bounds unchanged.

# Hum ID — prototype

Magnus asked (2026-10-16, ~21:15 Sitka): "how to hum a song in and know what song it is — any ideas?"

This is the working answer: a one-page iPad app that records a hum, extracts the
pitch contour on-device, and matches it against a melody database.

## What's here

- `pitch.js` — the DSP core (browser global `HumPitch`, also node-compatible):
  downsample to 8kHz → autocorrelation pitch per 128ms frame → median smoothing →
  quantize to MIDI notes → interval sequence → DTW melody matching (tempo- and
  transposition-invariant; matches on both raw intervals and the distinct-pitch
  contour, since hummed repeated notes merge).
- `index.html` — the iPad UI: hold-to-hum button, live waveform, pitch-contour
  visualization, "play my hum" / "play what it heard", demo matching.
- `test-pitch.js` — node verification: synthesized melodies (vibrato + noise, at
  44.1kHz to exercise the downsampler). **8/8 passing 2026-10-17.**

## Verified facts (checked 2026-10-17)

- **ACRCloud has a real humming engine.** Their official docs
  (https://docs.acrcloud.com/get-started/tutorials/recognize-music) list the AVR
  project audio engine option **"Cover Song (humming) Identification: Detect
  covers/live performance or humming"** — same `/v1/identify` API, HMAC-signed,
  "Recorded Audio" source for mic input. This is the fastest path to matching
  *any* song.
- **Trial:** 14 days free after registration (per their docs). Paid pricing sits
  behind the console login — not verifiable without an account. One third-party
  blog claims a $9/mo tier; treat as unverified.
- **AudD does NOT do humming** — their API is fingerprint-based (recorded audio
  only), despite appearing on some "hum to search" listicles. Dead end for this.
- **Google Hum to Search has no public API; ShazamKit is recorded-audio only.**
  Both dead ends for building on (as already noted in chat).
- **Free test Magnus can do right now:** aha-music.com (ACRCloud-powered
  hum-to-search in the browser) — worth one iPad try to see if humming-ID
  works for his voice at all before any signup.

## Current limits (honest)

- Demo DB is 3 public-domain tunes (Twinkle, Mary, Ode to Joy). Real "any song"
  needs the ACRCloud step.
- Repeated hummed notes merge into one (no onset detection yet) — matching
  handles it, note display shows the merged version.
- Mic needs HTTPS + mic permission (fine on games.lucineer.com; `file://` may
  block getUserMedia on iPad).

## Suggested next steps (for the main agent)

1. Serve this dir over HTTPS and smoke-test in the desktop browser with a real
   mic (or have Magnus try it — it's fun).
2. If the demo delights: ask Magnus whether to sign up for the ACRCloud 14-day
   trial; the Worker-side hookup is small (record → POST 10s clip to
   `/v1/identify` with the humming project creds server-side, never in the
   browser — same vault pattern as the AISStream draft).
3. Deploy target when verified: `games.lucineer.com/tools/hum-id/` (agent-readable
   name per the standing naming rule). **Do not send Magnus a link until it is
   playtested working** (standing boundary).

## Test

```
cd ~/workspace/hum-id-poc && node test-pitch.js
```

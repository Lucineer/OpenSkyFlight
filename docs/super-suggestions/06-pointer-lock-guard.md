# 06 — Pointer-lock engine death (needs real-iPad testing)

**The problem:** in our test environment, clicking the viewport to
engage pointer-lock mouse steering eventually killed the WebGPU engine
("Initializing 3D engine…" loop, no recovery after 2–3 cycles). Mouse
steering itself works beautifully — one bank-left jolt and the plane
felt alive — but the engine didn't survive repeated engagement here.

**Why it needs you:** this may be specific to synthetic input in a
headless VM, or it may be a real context-loss bug. Only real hardware
can tell. If it reproduces on the iPad (or desktop Safari/Chrome),
the fix is a context-loss guard: listen for `webglcontextlost` /
WebGPU device loss, show a recoverable state, and reinitialize cleanly
instead of hanging on the boot overlay.

**Note:** touch steering (the stick + drag-look) is the iPad-primary
path and doesn't touch pointer lock — but desktop and mouse users hit
this, and a dead engine is the worst possible failure.

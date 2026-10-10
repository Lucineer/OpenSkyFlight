# 04 — Boot overlay: remove from accessibility tree

**The problem:** "Initializing 3D engine…" stays exposed to
assistive tech after boot. The `hidden` class sets `opacity: 0` only —
the overlay never leaves the accessibility tree.

**Why it fits iPad:** VoiceOver users on iPad will hear a loading
message for an app that's already running. One-line-class fix.

**Suggested fix location:** `css/main.css` `#boot-overlay.hidden` —
add `visibility: hidden` with a delayed transition
(`opacity 0.6s ease, visibility 0s 0.6s`) so the fade plays, then the
overlay drops out of the tree. Verify with an accessibility snapshot
after boot, and confirm the error path still surfaces failures.

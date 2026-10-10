# 03 — Control-panel drawer: make it findable

**The problem:** the panel trigger is an invisible 20px strip on the
right edge with no visual affordance, and the bottom of the strip sits
under the minimap (z-index), eating taps. The drawer also auto-closes
~30–60s after load and can't be reopened through the UI. Playtesters
read it as "stuck closed."

**Why it matters most on iPad:** on desktop there's a keyboard
workaround (focus the controls via Tab). On touch there is none — the
drawer is the *only* way to reach place search, coordinates, texture,
and atmosphere controls. If it can't be opened by a finger, those
features don't exist on iPad.

**Suggested fix location:** `css/main.css` `#panel-trigger` — add a
visible tab/handle and resolve the minimap overlap
(`#minimap-container` z-index 20 over the trigger's 19); consider
making tap-to-toggle primary instead of hover-with-300ms-auto-hide,
which is fragile under an imprecise finger. Details in our local
`BUG_NOTES.md` (diagnosis only — your code, your call).

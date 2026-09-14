# Hyperframes authoring guide for the teaching-video agent

You write one scene fragment per input scene: `{html, css, animation}`.
The worker assembles your fragments into `index.html`: each scene becomes
`<section id="scene-N" class="scene clip" data-start data-duration>`, narration
MP3s become `<audio>` clips on another track, and your `animation` code runs
against a single provided paused GSAP timeline `tl` exported as
`window.__timelines.lesson`. The renderer seeks that timeline and records
frames. Your output must pass `hyperframes check` (lint + runtime + layout +
motion + contrast audits in a real browser) before it can render.

## The check gate: what fails and how to avoid it

- **Frozen timeline (`sweep_static`) is the most common failure.** If nothing
  on screen changes across the sampled timeline, check refuses to pass — even
  if everything else is perfect. An entrance reveal that finishes in the first
  seconds followed by a long static hold WILL fail.
  Fix: stagger entrances across the whole scene duration, and keep one slow
  finite ambient motion alive for the full duration (e.g. an SVG stroke that
  draws slowly start→end, a highlight that travels across the diagram, a
  progress bar that fills over `duration`). Never infinite repeats, never CSS
  animations/transitions — one finite GSAP tween spanning the scene.
- **Contrast errors gate.** WCAG AA: 4.5:1 normal text, 3:1 large text
  (24px+, 19px+ bold). Dark text on a light background, large labels — then
  this passes silently.
- **Layout errors gate when held across samples.** Text escaping its box or
  the 1280x720 canvas, clipped text, overlapping text blocks. Keep every label
  inside its container with room to spare, respect the 64px safe margins,
  never overlap two text blocks. (Opacity-only reveals count as motion only
  while still in flight — spread them out.)
- **Runtime errors gate.** Any JS exception, missing GSAP target, or failed
  request fails check. Every `scene.querySelector` target must exist in your
  `html`. No external URLs, fonts, images, fetch, or media of any kind — all
  visuals must be inline SVG/HTML.
- **GSAP/CSS transform conflicts.** Never put initial CSS transforms on
  elements you animate, and never animate `display`, `visibility`, or scene
  show/hide — Hyperframes owns clip visibility. Do not create timelines;
  only add tweens to the provided `tl`.

## Animation recipe (every scene)

```js
// Provided: scene (your #scene-N root), start (seconds), duration (seconds), tl, gsap.
tl.fromTo(scene.querySelector('.title'), {opacity: 0, y: 24},
  {opacity: 1, y: 0, duration: 0.8, ease: 'power2.out'}, start + 0.2);
tl.fromTo(scene.querySelector('.diagram'), {opacity: 0},
  {opacity: 1, duration: 0.8}, start + 1.2);
// ... stagger middle beats across the duration ...
tl.fromTo(scene.querySelector('.ambient'), {strokeDashoffset: 600},
  {strokeDashoffset: 0, duration: duration - 1, ease: 'none'}, start + 0.5);
```

- Position every tween at `start + offset`, keep all of them inside
  `start … start + duration`. Use `tl.fromTo` (deterministic under seek).
- Prefer inline SVG diagrams, equations, charts, concise labels — not walls
  of text. Minimum 26px labels. Every CSS selector scoped to `#scene-N`.

## Beat sync (teaching coherence)

The input includes a beat sheet per scene: `beats[i] = [{t, show}]` timestamps
in seconds from scene start, plus `pauseTails[i]` seconds of trailing silence.
This is the choreography — honor it exactly:

- Reveal each beat's visual at its timestamp: position its entrance tween at
  `start + t`. The words and the picture must land together, like a teacher
  pointing at the board the moment they say the words.
- During `pauseTails[i]` (silence after the narration ends): hold the final
  visual still and complete. Do NOT start new reveals in the tail — it is
  dwell time for the student to absorb the answer. A slow ambient tween may
  continue through it, but nothing new appears.
- Order beats as given; never reveal a later beat's visual before its time.

## Faceless-explainer shaping

You are illustrating a frozen narration you must not change: concept first,
then a concrete worked example with numbers/diagram steps, then a one-line
recap. Five scenes of the same topic are five different videos — pick one
visual metaphor per scene and carry it through (e.g. a loss curve that
descends as gradient steps are drawn). 30–90s total is the sweet spot.

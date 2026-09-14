# DESIGN.md — Design Spec 

> **Nerdy-hack brand override:** sharp system,  brand = green `#2d6a4f` (hover `#24563f`, tint `#e7f2e9`) on white. Hairlines are green-tinted `#dfe5de`. Layout is full-bleed — sidebar pinned to the extreme left, no centered max-width container.

Goal: copy the **sharp, technical, blueprint-like** look — zero rounded corners, 1px hairline grid, one brand color, grotesk headings.

---

## 1. Philosophy in one paragraph

Everything is **flat, sharp, and gridded**. White background with light-blue hairlines forming columns and sections like an engineering drawing. No shadows except dropdowns and the dark code window. One brand blue does all the work (CTA, active states, drenched panels). Motion is fast, snappy, physical: `scale(.985)` press + arrow nudge. Type is tight-tracked Space Grotesk for headlines, DM Sans for UI, DM Mono for code/labels.

Copy this sentence for every new component: *"1px border, square corners, blue only for action, press scales to .985."*

---

## 2. Tokens (exact, extracted from their CSS)

### Color

```css
:root {
  --color-bg: #ffffff;            /* page */
  --color-bg-alt: #f4f8ff;        /* hover wash / alt row */
  --color-paper: #fafafa;         /* secondary button / pill bg */
  --color-paper-blue: #f6f8fc;
  --color-blue-paper: #f3f6fd;
  --color-blue-tint: #eaf2ff;     /* light blue hover wash */
  --color-blue: #0562ef;          /* THE brand blue — all CTAs, active dots, ticks */
  --color-blue-hover: #3782f2;    /* CTA hover */
  --color-blue-light: #1e78ff;

  --color-text: #0b1015;          /* near-black headlines / body */
  --color-text-muted: #0b101599;  /* 60% — subheads, descriptions */
  --color-text-dim: #888e94;      /* captions, gutter numbers */

  --color-border: #c5dbf2;        /* THE hairline — all section/card borders */
  --color-border-light: rgba(15, 46, 92, 0.055);  /* subtle inner borders */
  --color-border-strong: #9bc1ea;
  --color-border-dashed: #0b101529; /* dashed dividers, npx pill */

  --color-ink-code: #0b1015;      /* dark code window bg */
  --color-ink-code-bar: #13191f;
  --color-ink-code-line: #1f2933;
  --color-code-fg: #f5f9ff;

  --ease-out-strong: cubic-bezier(0.22, 1, 0.36, 1);
  --nav-height: 56px;
}
```

Usage rules:
- Page bg is **pure white**, not off-white. `bg-alt`/`paper` only for hover or secondary surfaces.
- `border` is **blue-tinted** (`#c5dbf2`), never neutral gray. This is what makes it feel like a blueprint.
- Blue at 4–25% opacity for washes: `bg-blue/[0.08]`, `border-blue/25`, `border-blue/20`.
- Dark section? Only two places: code window (`#0b1015`) and full-bleed blue drench (`var(--color-blue)` with white text).

### Typography

```css
--font-heading: "Space Grotesk", sans-serif;  /* headlines, ticker names, stats */
--font-body: "DM Sans", sans-serif;           /* everything UI */
--font-mono: "DM Mono", monospace;            /* code, eyebrows, labels */
```

Load via Google Fonts (they preload Space Grotesk + DM Sans):
```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

Scale (desktop → mobile):
| Use | Size / Weight / Tracking / Leading |
|---|---|
| Hero H1 | 56–64px, 500, `-0.04em`, 1.02 |
| Section H2 | 44px → 36px → 28px, 500, `-0.04em`, 1.05 |
| Card title | 38px → 32px → 26px, 500, `-0.035em`, 1.06 |
| Body / desc | 16px, 400, `-0.005em`, 1.65 (`text-wrap: pretty`) |
| Sub / secondary | 15px, 400, `-0.003em`, 1.55, `text-muted` |
| Nav link | 15px, 500, `-0.01em`, 1.4 |
| Button label | 14.5px, 500, `-0.005em` |
| Eyebrow | 11px mono or 10.5–11px body, 500, `+0.14em` to `+0.18em`, UPPERCASE, blue |
| Caption / ticker eyebrow | 13–14px, 400, `-0.005em`, muted |
| Code | 11px mono, 20px line-height |

Always `font-feature-settings: "cv09" on, "cv03" on, "cv04" on, "cv11" on` on heading/body/mono (their global rule).

### Radius — Sharp by default

```css
--radius: 0px; /* default everywhere */
```

- `border-radius: 0` on nav, buttons, cards, inputs, dropdowns.
- Exceptions only: 2px (tiny tab icons, status squares), 4–5px (stacked favicons, focus rings on ticker), 10px top-only on the dark code window (`border-radius: 10px 10px 0 0`), full-round only for traffic-light dots / 6px progress dots / ticker pulse dot.
- If in doubt: **square it**.

### Borders & dividers

- Default: `1px solid var(--color-border)`.
- Page frame: `.container-edge { border-left: 1px solid var(--color-border); border-right: 1px solid var(--color-border); }`
- Spine rows / FAQ: `border-top: 1px solid var(--color-border)`, last child also `border-bottom`.
- Dashed technical: `1px dashed var(--color-blue)` for benchmark cards, `1px dashed rgba(11,16,21,.2)` for copy-pills.
- Strong emphasis: `1px solid var(--color-blue)`.

### Layout

- Max width: `1232px` (`max-w-[1232px] mx-auto px-6`).
- Nav: `fixed top-0 h-[56px] border-b border-border bg-bg/95 backdrop-blur-sm`, inner matches 1232px container.
- Section header (sticky sub-nav): `position: sticky; top: calc(var(--nav-height) - 1px); border-bottom: 1px solid var(--color-border); background: var(--color-bg)`. On pin add `box-shadow: 0 1px color-mix(text 6%), 0 6px 16px -10px color-mix(text 18%)`.
- Vertical rhythm: headline blocks `padding: 56px 32px 48px`; two-col catalog `grid-template-columns: minmax(320px,34%) 1fr`; cards `padding: 40px 48px 44px` (mobile `28px 24px 32px`).
- Full-bleed strips: `width: 100vw; margin-left: 50%; transform: translate(-50%)`.

### Shadow (almost none)

```css
/* only these two */
--shadow-dropdown: 0 0 0 1px rgba(9,17,32,.05), 0 1px 2px rgba(9,17,32,.05), 0 12px 32px -12px rgba(5,34,91,.16);
--shadow-code: 0 32px 64px -24px #0b101547, 0 8px 16px -4px #0b10151a;
--shadow-cta: 0 1px 2px #0519502e, 0 8px 18px -8px #0562ef80; /* highlighted pricing CTA only */
```

### Motion

- Easing everywhere: `var(--ease-out-strong)` = `cubic-bezier(.22,1,.36,1)`.
- Durations: hover 180–250ms, card crossfade 500–700ms, hero stagger 520–780ms with `translateY(6–14px) → 0`.
- Press: `:active { transform: scale(.985) }` on **every** button/card/row.
- Arrow nudge on hover: `transform: translate(2–3px)`.
- Respect `prefers-reduced-motion: reduce` → disable all.

---

## 3. Components (copy these patterns)

### A. Navbar
```
fixed bar, bottom hairline. Left: logo mark + wordmark. Center: 6 text links (15px medium). Right: [Login ▾ ghost square] [Start building → blue split-button].
Dropdown panel: bg-white border-border, shadow-dropdown, zero radius. Item: icon in 32px bordered square (border-border bg-bg-alt) + 14px semibold title + 11px dim subtitle. Hover: bg-bg-alt, icon square border-blue/30 bg-blue/5, icon turns blue.
Mobile: hamburger toggles full-width panel, same hairlines.
```

### B. Buttons — the signature split-button
Primary = **two compartments, square, blue**:
```html
<a class="flex items-stretch h-11 w-full overflow-hidden bg-blue border border-blue text-white">
  <span class="flex flex-1 items-center justify-center px-5 text-[14.5px] font-medium border-r border-white/20">Start building</span>
  <span class="flex items-center justify-center w-11 arrow">→</span>
</a>
```
- `h-11 (44px)`, `hover:bg-blue-hover`, `active:scale(.985)`, arrow `translate(2px)` on hover, focus `outline: 2px solid blue; offset: 2px`.
- Secondary: same size, `bg-paper text-text border-border-light`, hover `bg-bg-alt border-text`.
- Small nav CTA: `h-10 px-5 border-border bg-[#fafafa]`.
- Tier CTA / free CTA: white bg, blue text, `border-blue`, hover `bg-blue-tint`.
- Inverse (on blue drench): white bg, blue text.

### C. Announcement chip + npx pill
- Chip: `inline-flex items-stretch border border-blue/25 bg-paper`, left cell `bg-blue/[0.08] border-r border-blue/20 px-2.5 py-[6px]` with pulsing `8px blue square` + `12.5px blue "New"` label, right cell `12.5px text` + tiny arrow.
- NPX pill: `h-9 font-mono text-[12.5px] text-muted bg-paper border: 1px dashed rgba(11,16,21,.2)`, hover solidifies border + text darkens. Copied state: `border: 1px solid #10b9818c; color: #047857` + clipboard→check icon morph.

### D. Cards & frames
- `surfaces-frame`: `border: 1px solid var(--color-border)` wrapping a grid of cards; internal dividers same hairline, zero gap.
- `surface-card`: square, `bg-bg` (light) or `bg-blue text-white` (drenched). Glyph: `22px square`, brand variant `bg-blue text-white`, inverse `bg-white text-blue`. Bottom CTA strip: full-width `padding: 16px; bg-blue text-white 14.5px medium` with arrow.
- `catalog-text-stage`: `bg-paper border-border`, padding above. Eyebrow blue uppercase inside.
- `bench-card`: `border: 1px dashed var(--color-blue)` + 4 corner ticks (`14px blue squares` absolutely positioned at corners).
- Pricing highlight: blue border + `shadow-cta`, pill badge flies in.

### E. Spine list (left selector) + stage (right)
Left rows: `grid-template-columns: 36px 1fr auto; padding: 18px 4px; border-top hairline`. Num `11px mono +0.14em 45% text`; title `16px -0.015em 60% text`. Active: num blue, title `text 500`, 6px blue square dot + 1px blue progress fill animates. Inactive hover → full text color.
Right stage: crossfade stack (`grid-template-areas: "stack"`, opacity/blur/scale transition 500–700ms).

### F. Dark code window
`max-w-[460px] bg-[#0b1015] rounded-t-[10px] shadow-code`. Titlebar `bg-[#13191f] border-b border-[#1F2933]` with 11px traffic dots (red/yellow/green) + centered `11px mono #6b7480` filename. Tabs row with active tab `bg-[#7cb7ff14] border-b-2 border-[#7CB7FF]`. Body `11px mono / 20px`, gutter `#3a4554`, syntax: kw `#7cb7ff`, fn `#ff9f5a`, str `#f5a88b`, class `#a0e0ff`, comment `#6b7480`.

### G. Textures
- Dot grid: `background-image: radial-gradient(circle, rgba(124,183,255,.35) 1px, transparent 1.4px); background-size: 16px 16px; mask: radial-gradient(ellipse 85% 75% at 50% 50%, #000 30%, transparent 100%)`.
- Blueprint plinth (behind illustrations): `background-color: blue; background-image: url(/plinth-grid.png), url(/halftone-cmyk.png); background-size: 100% 100%, cover; center`.
- Hero dots canvas: faint dotted field behind headline, `opacity .45` on mobile.

### H. Ticker
Eyebrow `14px muted`, viewport `max-w-[720px]` with edge fade mask (`--ticker-fade: 64px`, 28px mobile), track `gap: 28px; animation: 36s linear infinite`, wordmarks `22px` + names `22px Space Grotesk 500 -0.05em`.

---

## 4. Tailwind v4 drop-in for this repo (Next.js + `@import "tailwindcss"`)

Replace `app/globals.css` tokens with:

```css
@import "tailwindcss";

@theme {
  --color-bg: #ffffff;
  --color-bg-alt: #f4f8ff;
  --color-paper: #fafafa;
  --color-paper-blue: #f6f8fc;
  --color-blue-paper: #f3f6fd;
  --color-blue-tint: #eaf2ff;
  --color-blue: #0562ef;
  --color-blue-hover: #3782f2;
  --color-blue-light: #1e78ff;

  --color-text: #0b1015;
  --color-text-muted: #0b101599;
  --color-text-dim: #888e94;

  --color-border: #c5dbf2;
  --color-border-light: rgba(15, 46, 92, 0.055);
  --color-border-strong: #9bc1ea;
  --color-border-dashed: #0b101529;

  --font-heading: "Space Grotesk", sans-serif;
  --font-body: "DM Sans", sans-serif;
  --font-mono: "DM Mono", monospace;

  --ease-out-strong: cubic-bezier(0.22, 1, 0.36, 1);
}

body { background: var(--color-bg); color: var(--color-text); font-family: var(--font-body); -webkit-font-smoothing: antialiased; }
.font-heading, .font-body, .font-mono { font-feature-settings: "cv09" on, "cv03" on, "cv04" on, "cv11" on; }

/* sharp default */
*, ::before, ::after { border-radius: 0 !important; } /* then re-allow: .allow-round, code window, dots */
.container-edge { border-left: 1px solid var(--color-border); border-right: 1px solid var(--color-border); }
```

Then use classes exactly like them: `bg-bg text-text border-border font-body text-[15px]`, `bg-blue hover:bg-blue-hover`, `border-blue/25 bg-blue/[0.08]`, `max-w-[1232px]`, `h-11`, `tracking-[-0.04em]`.

Shadcn note (`components.json`, `style: new-york`, `cssVariables: false`): keep shadcn components but override `--radius` to `0` and map `primary` → `var(--color-blue)`, `border` → `var(--color-border)`.

---

## 5. Do / Don't checklist

- [ ] Zero radius unless dot / code-window-top / 2px micro-icon.
- [ ] Every section separated by `#c5dbf2` hairline; page gutter has left/right hairlines (container-edge).
- [ ] Headlines Space Grotesk 500, tracking `-0.035` to `-0.04em`, never bold.
- [ ] Only blue `#0562ef` for action; everything else black/white/hairline.
- [ ] Buttons 44px, split label+arrow, press `scale(.985)`.
- [ ] Eyebrows 11px uppercase `+0.14em` blue mono.
- [ ] Sticky section headers with hairline + pin shadow.
- [ ] One texture per viewport max (dots OR blueprint, never both).
- [ ] Focus-visible always `2px solid blue, 2–4px offset`.
- [ ] Mobile: type steps down one tier, padding `40px 20px 28px`, ticker fade 28px.

Apply to `nerdy-hack` first: nav → hero (chip + H1 + split CTA + npx pill) → logo ticker → sticky section header → spine+stage → drenched panel → code window → pricing → FAQ → footer.

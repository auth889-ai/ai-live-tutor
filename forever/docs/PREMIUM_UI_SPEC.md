# Premium UI Pass — Spec (research-backed, 2026-07-09)

Goal: elevate the current Pandio-blush look to genuinely premium WHILE KEEPING the warm
coral identity. Research: Stripe/Linear/Vercel principles, Josh Comeau shadow canon,
Klarna pink-as-premium, MasterClass player, Family (Benji Taylor) motion, 2026 trends.
Baseline to beat: Pandio landing (bg #fdf3f1, cards #fffcfa, coral #f47368).

## The 4 laws (from the research)

1. **Premium = restraint + one obsessive accent.** Neutrals do the work; coral is the
   highlight, NEVER the canvas. Every neutral is warm-tinted — no flat grey text,
   borders, or shadows anywhere (grey-on-pink is the #1 cheap tell).
2. **Deep ink is what keeps pink adult** (Klarna: pink + off-white + near-black
   #0B051D-class anchor). Espresso headings, never grey headlines, never coral small text.
3. **Depth = layered hue-matched shadows + luminance hierarchy** (cards are the
   brightest surface on a tinted field), single light source, inset top highlight.
4. **Serif/sans tension reads expensive**; rounded-sans-everywhere reads children's app.

## A. Palette tokens

| Token | Value | Use |
|---|---|---|
| --bg | #FBF1EE | page field (hair darker/less pink than current) |
| --surface | #FFFDFB (hero cards #FFFFFF) | cards = brightest thing on page |
| --surface-sunken | #F6E9E4 | wells, board mats, inputs, progress tracks |
| --border | #F1DED6 | default hairline |
| --border-strong | #E3C8BD | interactive emphasis |
| --ink | #33201B | headings (espresso, ~12:1 on bg) |
| --ink-body | #4A342E | body text |
| --ink-muted | #8A6F66 | secondary text (warm, never grey) |
| --coral | #F47368 | fills, large display, illustration ONLY (fails AA small) |
| --coral-deep | #C2453A | links, small icons, active states (≥4.5:1) |
| --coral-pressed | #A93A30 | :active |
| --amber | #C98B2D | ratings, streaks, premium badges (the grown-up sparkle) |
| --theater-bg / surface / ink | #221512 / #2E1E1A / #F7E9E3 | player dark surround (espresso-dark, not grey-dark) |

Focus ring: 2px #C2453A @40% outside a 2px bg gap. Replace EVERY grey in the codebase
with the warm equivalent.

## B. Typography (all next/font Google Fonts)

- **Display: Fraunces** variable — opsz 72–144 heroes, weight 560–620, SOFT 60–80
  (keeps friendliness), WONK 0, tracking −0.02em. Landing H1/H2, course titles,
  lesson titles, big numbers.
- **UI/body: Inter** 400/500/600, font-feature-settings "cv11","ss01". Everything
  interactive. Timers/tables: font-variant-numeric: tabular-nums.
- **Editorial accent: Newsreader italic** (opsz 16) — quotes, lesson intros,
  emphasized subtitle words.

## C. Depth recipe

```css
--shadow-hue: 14deg 45% 42%;             /* blush-hue-matched, desaturated */
--card-shadow:
  0 1px 2px hsl(var(--shadow-hue) / .06),
  0 2px 4px hsl(var(--shadow-hue) / .06),
  0 4px 8px hsl(var(--shadow-hue) / .05),
  inset 0 1px 0 rgba(255,255,255,.65);   /* top light = lit surface */
--card-shadow-lift:
  0 2px 3px hsl(var(--shadow-hue) / .07),
  0 6px 12px hsl(var(--shadow-hue) / .07),
  0 16px 32px hsl(var(--shadow-hue) / .06),
  inset 0 1px 0 rgba(255,255,255,.65);
```
- Hero warmth: `radial-gradient(120% 80% at 50% -10%, #FFE4DC 0%, transparent 60%)`
  over --bg (we already have a radial-warmth body gradient — retune to these values).
- Grain: inline SVG feTurbulence fractalNoise baseFrequency ~0.8, fixed overlay,
  3% opacity, mix-blend-mode soft-light — PAGE-level only, never on cards.
- Glass chrome (sticky header, player controls): rgba(255,252,250,.72) +
  backdrop-filter blur(14px) saturate(160%) + 1px rgba(227,200,189,.5) bottom border.
- Border OR strong shadow per element — both maxed reads heavy.

## D. Micro-interactions (gate all with prefers-reduced-motion)

--ease-out-soft: cubic-bezier(.22,1,.36,1); spring curves via CSS linear() generator.
1. Card hover: translateY(-2px) + shadow swap 300ms (animate a pseudo-element's opacity).
2. Button press: scale(.97) 120ms in, spring back 350ms; primary =
   linear-gradient(180deg,#F5837A,#EF6154) + inset top highlight.
3. Active syllabus scene: coral left rail that SLIDES between items.
4. Karaoke word: #FDE1DB pill + --coral-deep + 60ms 1px rise; past words settle to
   --ink-muted (no hard flicker).
5. Progress fill: 600ms ease-out on scene complete + one-time amber shimmer on chapter
   completion.
6. Lesson-complete check: SVG stroke-dashoffset draw-in 450ms w/ overshoot (the
   Family-style "mark the occasion" moment).
7. Dashboard cards: fade+rise 12px, 40ms stagger, first paint only.
8. Scrubber: 4px→8px grow on hover w/ spring; chapter ticks scale 1.4x near cursor.

## E. Application

**Landing/dashboard**: radial warmth + grain on page; #FFFFFF cards w/ layered warm
shadow + #F1DED6 1px border; H1 Fraunces espresso (NOT coral); coral only in one
gradient CTA + eyebrow labels (deep coral) + illustration; amber only on rating/streak
chips; section padding ~1.5x; course cards get inset image border
(inset 0 0 0 1px rgba(51,32,27,.06)), Fraunces title, thin coral progress on sunken track.

**Course player**: THEATER MODE — board sits on espresso-dark surround so the animated
board glows (MasterClass move in our hue); dark glass chrome rgba(34,21,18,.7)+blur;
sidebar: tabular numbers, sliding coral rail for active, amber check for complete;
scrub bar w/ scene tick markers, coral played-fill; subtitles on rgba(34,21,18,.55)
blurred pill, emphasis words Newsreader italic; Fraunces lesson title; minimal controls
(speed, captions, chapters, fullscreen).

**Remove (cheap tells)**: pure-grey text/shadow/border anywhere; single-layer
box-shadow 0 2px 8px rgba(0,0,0,.1); coral small text; equal radius everywhere
(use 20–24px cards / 10px buttons / 6px chips); default `ease` timing.

## Verify

Same loop as everything: apply → headless-Chrome screenshot vs Pandio baseline →
Read PNG → iterate. Do landing/dashboard first (one commit), player theater mode second.

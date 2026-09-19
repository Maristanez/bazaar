# B12 — The Gym: dot histogram + metric cards

Build spec for the bottom region of the Console (SPEC §4.4, §9.2, §9.3, §12). The reference render is `docs/design/gym-b12.html` — self-contained, real seed 42 data, four switchable states. Port it to React; every number and pixel below is the contract. Nothing here needs a visual judgement call.

**Sources of truth for the numbers**

| What | Where it comes from |
|---|---|
| Policy **B** (coloured dots, all card values) | `packages/gym/fixtures/seed42.json` verbatim — `floorPct: 25`, floor **$97.50** |
| Policy **A** (grey outline, "vs saved" deltas) | `runGym({...input, floorPct: 40})` from `packages/gym/src/test-data.ts`, same seed — a real run, floor **$109.20**. The fixture holds one policy, so A cannot come from it; the engine is deterministic (floorPct 25 reproduces the fixture byte-for-byte) |
| Losing state | `runGym({...input, floorPct: 50})`, floor **$117.00**, `profitVsBanner: -172660` |
| Dot placement | `settle(result, 500)` from `packages/gym/src/layout.ts`. **Do not re-derive.** The renderer maps its `{x, y, state, color}` to pixels and nothing else |

Money is cents in the data. Display: `$` + whole dollars when the value has no cents (`$149`, `$117`), else two decimals (`$97.50`, `$136.62`); negatives with a true minus `−$1,726.60`; thousands comma; `font-variant-numeric: tabular-nums` on every dollar figure and every count.

---

## 1. Form and why

A **dot histogram (unit chart)**: one 8px dot per shopper who bought, stacked in $5 bins of agreed price. Not a bar chart, because the dots *are* the shoppers — the persona colour, the click-a-dot transcript, the walked pile and the round animation (S9/S10) all need individual marks. The histogram of agreed prices is what the settled swarm looks like.

The chart answers one question — *where do the shoppers settle, and how many of them?* — and the six cards answer the second — *does it beat a 20% banner?* The chart is allowed to say no.

Rendering: plain SVG `<circle>` elements (300 + 300 hit targets is trivial). No chart library. Canvas is acceptable for S10's animation; keep the geometry identical.

## 2. Region and height budget (480px, 1440 page)

Panel: full Console width. At 1440 with 24px page gutters the panel is **1392 × 480**, `padding: 20px`, cream `#fdf3e3`, `border-radius: 16px`, `border: 2px solid #fff` (die-cut edge), `box-shadow: 0 0 0 1px rgba(47,22,4,.18), 4px 5px 0 rgba(0,0,0,.28)` on the teal ground.

Inner grid: `grid-template-columns: 908px 420px; column-gap: 24px; height: 440px`.

Left column rows (`row-gap: 8px`): **36** controls · **20** honesty label · **340** chart SVG · **28** persona legend = 440.
Right column rows (`row-gap: 12px`): **148** headline card · **270** grid of six cards (2 × 3, `204 × 82`, `gap: 12px`) = 430, 10px slack at the bottom.

Below 1392 the panel scrolls horizontally inside its own container; it is never reflowed (the Console is a desktop surface; SPEC §4.4).

## 3. Type

- Headings, buttons, the headline verdict: **Fredoka 600**. Section title "The Gym" 22px; Run the Gym 15px; verdict 18px (16px in the losing state).
- Everything else: **Satoshi** (fallback `system-ui`). Body 14/1.35. Card labels 11px, 600, uppercase, `letter-spacing: .06em`, ink at 55%. Card values 22px 700 tabular. Headline value 40px 700 tabular (34px losing). Axis ticks 11px ink 55%. Chip text 11.5px. Honesty label 13px, full ink — **not muted, not smaller than body-1**.
- Project rule wins over the dataviz default: dollar figures are tabular even at display size.

## 4. Tokens

```
teal #004c4c · sky #ccffff · coral #f3675a · sun #f6d809 · pink #ff598b · bark #2f1604 · cream #fdf3e3
ink = bark; ink-70 rgba(47,22,4,.70) · ink-55 .55 · ink-38 .38 · ink-18 .18 · ink-10 .10
paper = cream; paper-2 (cards, chips) #fff8ec
```

**Colour rules (SPEC §4.4, strict):** coral appears in exactly one place in this region — the losing headline card. Sun-yellow appears in exactly three — the thin-margin band wash, the "would have asked you" dots, and the "Would ask your approval" card. No delta, arrow, warning or persona ever uses either.

### Persona palette (validated)

| Persona | Token | Hex | Count in seed 42 |
|---|---|---|---|
| Bargain hunter | `--p-bargain` | `#22a04a` | 90 |
| Budgeted runner | `--p-budgeted` | `#2f6fdb` | 105 |
| Impatient | `--p-impatient` | `#a83280` | 45 |
| Loyal | `--p-loyal` | `#ff598b` (brand pink) | 30 |
| Lowballer | `--p-lowballer` | `#8f5e1e` | 30 |

`dataviz/scripts/validate_palette.js "#22a04a,#2f6fdb,#a83280,#ff598b,#8f5e1e" --mode light --surface "#fdf3e3" --pairs all` (all-pairs, because any two dots can touch in a stack):

- Lightness band PASS · Chroma floor PASS
- CVD separation PASS — worst pair `#8f5e1e ↔ #22a04a` ΔE **9.3** (deutan), target ≥ 8
- Normal-vision floor PASS — worst pair ΔE **19.2**, floor 15
- Contrast vs cream WARN — pink `#ff598b` is 2.71:1. Relief is mandatory and shipped: the legend names every colour with its count, the popover names the persona in text, and the table view (§12) lists every shopper.

Chosen by brute-force over ~1.1M candidates from hue families that harmonise with the brand; this is the top-scoring set that contains no coral-family hue (rust scored 10.7 but reads as "the red one" next to the losing card). Sun-yellow separates from every persona at ≥ 9.3, so a yellow dot in a stack never impersonates a persona. Colour follows the persona, never the filter: filtering dims, it never repaints.

## 5. Chart geometry (SVG 908 × 340)

```
W 908 · H 340
label band     y 0–24   (reference-line chips)
plot           y 28–300 (272px)
baseline       y 300    (1px solid ink-38, from plotL to plotR)
tick labels    y 316    · axis caption y 334
walked pile    x 6–102  (96px, 8 columns)
divider        x 112    (1.5px dashed 3 5, ink-38, round caps, y 28–304)
plotL          x 124    · binPx 50 · 15 bins · plotR 874
dot d 8 · gap 2 · pitch 10 · k = 3 sub-columns per bin · block 28px · blockPad 11px
```

**x-scale.** Domain = `result.bins`: `[7800, 8300, …, 14800]` — fifteen $5 bins anchored at cost ($78), last bin `[148, 153)` open-ended (bundles reach $150). `xOf(cents) = 124 + (cents − 7800) / 500 × 50`. Ticks at every bin edge, 1px × 4px, solid. Tick labels every edge: `$78`, then bare `83 … 148`, last `$153+`. Caption at plotL: "Agreed price · $5 bins from cost · last bin open (bundles can exceed list)". No vertical gridlines; no y-axis — the stack count label is the y value.

**Dot placement from `settle()`.** For a dot `{x, y, state, color}`:

- `state === "settled"`: `bin = (x − 7800) / 500`, `col = y % 3`, `row = floor(y / 3)`.
  `cx = 124 + bin·50 + 11 + 4 + col·10`, `cy = 300 − 4 − 1 − row·10`.
- `state === "walked"`: `col = y % 8`, `row = floor(y / 8)`.
  `cx = 6 + 4 + col·10`, `cy = 300 − 4 − 1 − row·10`.
- Fill: `color === "yellow"` → sun `#f6d809` with `stroke: bark 1px` (sun is 1.30:1 on cream; the stroke is the only reason it is visible). Otherwise the persona hex from the shopper record (`shoppers.find(id)`).
- Walked and `missed !== true` (9 lowballers with willingness below the floor): `fill-opacity: .35`. Missed dots (76) full colour.

Max stack in the fixture is 62 (bin $133) → 21 rows = 210px; policy A's 71 → 24 rows = 240px; plot is 272px. The wrap into three sub-columns is why 300 dots fit 480px at an 8px dot that never touches its neighbour. Row height is `pitch` — a row equals three shoppers, and the count label carries the exact value.

**Stack count labels.** Every non-empty B bin (and yellow-only bins) gets its count, 11px ink-55 tabular, centred on the bin at `y = 300 − rows·10 − 5`. This is the "value on the cap" rule; there is no y-axis to duplicate it.

**Policy A outline.** For each bin with `A.counts[i] > 0`: a path `M x,300 V top H x+32 V 300` with 2px rounded top corners, `x = 124 + i·50 + 9`, `top = 300 − ceil(count/3)·10`, `stroke: ink-38 1.5px`, no fill, drawn **under** the dots. Same unit scale as the dots, so a B stack that pokes above its A outline means more shoppers bought at that price under B. Legend for A/B lives in the controls row chips, not in the plot.

**Reference lines** (all identical style; identity is the label, colour stays reserved): 1.5px dashed `4 4`, bark at 70% opacity, `y 24 → 300`. Label chip in the top band: 11px 600 tabular, `#fff8ec` pill, 1px ink-38 border, 18px tall, centred on the line.

- `List $149` at 14900
- `20% banner $119.20` at 11920 (`round(list × 0.8)`)
- `Floor $97.50` at 9750 = `ceil(cost × (1 + floorPct/100))` for **B**. A's floor is not drawn — the outline already says where A closed.

Placement order List → Banner → Floor. If a chip's box (±4px) overlaps a placed chip, it drops to a second row (`y + 20`). This happens in the losing state (floor $117 vs banner $119.20); the second row sits at y 22–40, above the tallest possible stack.

**Thin-margin band.** `rect` from `xOf(7800)` to `xOf(floor_B)`, `y 28–300`, `fill: sun`, `fill-opacity: .12`. Two-line label at `(xOf(7800)+6, 42/56)`: "**thin margin**" (700) / "would have asked you" (500), 11px ink-70. The band widens as the slider rises; the yellow dots live inside it by construction (`settle()` bins them at their last offer, which is strictly between cost and floor).

**Walked pile.** Bottom-aligned at the baseline, 8 wide, wraps upward: 85 dots → 11 rows. Labels under it at the tick baseline: "**walked 85**" 12px 700, then "76 deals missed" 11px ink-70. The dashed divider separates the pile from the price axis so nobody reads the pile as a price.

## 6. Controls row (36px)

`The Gym` (Fredoka 22) · **Run the Gym** (teal fill, cream text, 2px bottom shadow) · round scrubber `R1 R2 R3 R4` (segmented pill, `#fff8ec`, 1.5px ink-38; selected segment bark fill / cream text; static on R4 until S10) · **Replay** (ghost, 1.5px ink-38) · spacer · chip `○ A saved · cost+40% · $109.20` (10px outlined swatch) · chip `● B slider · cost+25% · $97.50` (10px `--p-budgeted` swatch — any persona hue; it means "coloured dots") · chip `seed 42`.

Chips: 11.5px, ink-70, `#fff8ec`, 1px ink-18, pill. Wrap chip text in a single `<span>` — an inline-flex chip with `gap` puts a gap between every text node.

## 7. Honesty label (20px, permanent)

A small tilted sticker `SYNTHETIC` (Fredoka 11px uppercase, teal text, 1.5px teal border, white fill, `rotate(-2deg)`) then, 13px full-ink: *"300 synthetic shoppers — rule-based, seeded (seed 42). Results might differ from actual buyer behaviour."* Always rendered, never collapsed, not in a tooltip. `n` and `seed` come from `result`.

## 8. Persona legend as filter (28px)

`PERSONAS` eyebrow (11px uppercase ink-55) then one button per persona in the fixed order above: 10px swatch with a 2px cream halo · name · count (ink-55). Then a sixth button with a sun swatch (1px bark inset ring): `Would have asked you 20`.

- Click → isolate: that button `aria-pressed="true"`, 1.5px bark border, `#fff8ec` fill, bold; all other buttons at 45% opacity; a `show all` link appears at the right. Click again or `show all` → clear.
- Dots not in the selection: `opacity: .18` (180ms ease; none under reduced motion). Survivors keep their hue. Yellow dots are excluded from a persona isolation (they are lowballers, but their meaning is "owner decides") and are the only dots shown for the sixth button.
- The filter scopes the **dots only**. Cards are policy-level facts and do not recompute (SPEC §9.2 says the legend "doubles as a filter" for the chart; per-persona metrics would need numbers the run does not aggregate — see gaps).

## 9. Metric cards

All values are B; every small card carries an A comparison. Polarity is shown by **glyph + words**, never by red/green: improvement `▲`/`▼` in teal, regression in ink-70. "Better" is up for Bought, Average agreed price, Bundle uplift; down for Deals missed. Format: `▲ 16 pts  vs saved 49 pts`.

| # | Label | B value (seed 42, floor +25%) | A (floor +40%) | Delta line |
|---|---|---|---|---|
| 1 | Bought | **65%** (195 / 300) | 49% (146) | `▲ 16 pts vs saved 49 pts` |
| 2 | Average agreed price | **$136.62** | $143.53 | `▼ $6.91 vs saved $143.53` |
| 3 | Bundle uplift per order | **$3.58** | $6.03 | `▼ $2.45 vs saved $6.03` |
| 4 | Deals missed | **76** | 95 | `▼ 19 vs saved 95` (teal — fewer is better) |
| 5 | Would ask your approval | **20** | 50 | `not closed · saved 50` |
| 6 | Red-team | 20 attacks · 0 breaches | — | four layer chips `validate · engine · check · auditor` |

Small card: `204 × 82`, `#fff8ec`, 1px ink-18, radius 12, `padding: 10px 14px`, label → value (`margin-top: 4px`) → sub pinned to the bottom (`margin-top: auto`, nowrap, ellipsis).

Card 5 is the sanctioned sun: `background: #f6d809`, 1px `rgba(47,22,4,.35)` border, bark text (11.9:1). Its sub says "not closed" because SPEC §9.2 counts these as not closed.

Card 6 is not B12's data (the red-team is §7); the slot is designed so the region is complete. Values are the SPEC-required result; per-layer counts are not in the repo yet (no `infra/redteam-result.json`), so the chips carry names only.

### Headline card — Profit vs a 20% banner (420 × 148)

`padding: 12px 16px`, radius 12. Grid: eyebrow (11px 700 uppercase `.08em`) · value 40px · verdict Fredoka 18 · sub 11.5px tabular pinned bottom. A 40px glyph top-right.

**Winning** (`profitVsBanner ≥ 0`): teal fill, cream text, sky eyebrow, sub at 78% cream. Value `+$2,091.40`. Verdict "Haggling beats the banner at this floor." Sub: `B · floor cost+25% ($97.50) · A saved · cost+40%: +$136.40`. Glyph: sky circle-check.

**Losing** (`profitVsBanner < 0`, real run at floor +50%): coral `#f3675a` fill, **bark text** (5.58:1; cream on coral is only 2.77:1 so cream is never used here), `border: 2px dashed bark`. Value 34px `−$1,726.60`. Verdict 16px "Haggling loses to the banner at this floor." Sub `B · floor cost+50% ($117) · A saved · cost+40%: +$136.40`. Then a note above a dashed hairline, 11px 600, wrapping: "111 of 300 bought · 86 would have asked you. Lower the floor to find where it wins." Glyph: outlined bark warning triangle.

Why it reads as a warning and not an error: same layout, same eyebrow, same numbers-first hierarchy as the winning state; the dashed border and triangle are the trail-map vocabulary for "caution here", and the note tells the owner what to do next. Nothing is greyed, nothing says "failed".

In the losing state the **whole region** re-renders from the losing `GymResult` — chips, band, floor line, dots, pile, legend counts, all six cards. The reference page does exactly this.

## 10. Click-a-dot popover (S9 — slot designed now)

Anchor: the dot. Selected dot gets `stroke: bark 2px`; hover/focus gives `stroke: ink-55 2px` (the lift). Hit target is an invisible `r=12` circle (24px) drawn before each dot, `tabindex="0"`, Enter/Space selects, Escape clears.

Popover: `236px` wide, cream, `1.5px bark` border, radius 10, `padding: 10px 12px`, `box-shadow: 3px 3px 0 ink-38`, `rotate(-0.6deg)`, left-pointing tail at `top: 18px`. Position `left = min(cx + 16, 908 − 240)`, `top = clamp(4, cy − 26, 340 − height − 4)`; it never leaves the SVG box.

Contents for shopper **#15** (the reference's selected dot — real record):

```
● Budgeted runner  #15
would pay up to $129
ROUND   THEIR OFFER   OUR ASK
R1      $114          $149
R2      $119          $135
R3      $124          $127   ← bold: the round it closed
took the held price           bought at $127
```

Trade wording: `accepted` → "we accepted their offer" · `held` → "took the held price" · `bundle` → "took a bundle" · `final` → "took the final ask". Outcomes: "bought at $X" · "**walked** · deal missed" (when `missed`) · "**would have asked you**" (swatch turns sun with a bark ring). Values in ink; the persona swatch is the only coloured thing. Text goes in with `textContent`.

## 11. States

| State | What changes |
|---|---|
| Default | All dots full colour, no selection, winning headline, R4 active |
| One persona filtered (reference: Bargain hunter) | Other personas' dots and the yellow dots at 18%; Bargain chip pressed; `show all` visible; cards unchanged |
| One dot selected (#15) | Bark ring on the dot; popover; other dots unchanged; filter may coexist |
| Losing headline (floor +50%) | Coral headline; every other element re-rendered from the losing run (37% bought, avg $145.93, uplift $5.02, 94 missed, 86 would-ask; 103 walked; band to $117; Floor chip drops to row 2) |
| Hover a dot | ink-55 2px ring only |
| Reduced motion | no opacity transition |

## 12. Accessibility

- Legend always present; every dot's identity is reachable by text (legend, popover, table view).
- A **table view** twin is required by the dataviz skill: a "Table" toggle in the controls row swaps the SVG for a `<table>` of `id · persona · willingness · rounds · outcome · agreed · trade` from `result.shoppers`. Not drawn in the reference; it is a plain table.
- `role="img"` + `aria-label` on the SVG; buttons carry `aria-pressed`.
- Single theme by decision: the Console commits to teal ground / cream paper (SPEC §12); the page paints every colour explicitly and does not respond to dark mode.

## 13. What the owner's brief got wrong (fixture is the truth)

| Brief says | Fixture / engine says |
|---|---|
| 19 would have asked | **20** |
| +$2,081 profit vs banner | **+$2,091.40** |
| $136.56 average agreed | **$136.62** (13662¢) |
| Floor $98 | **$97.50** (`ceil(7800 × 1.25) = 9750`) |
| Banner price unstated | **$119.20** |
| Dots "from cost ($78) to list ($149)" | bins run **$78 → $153**; 17 bundle deals settle at $150, above list |
| Popover example R1 $105 / R2 $118 / R3 $131 → $127 | no such shopper; **#15** is the real one used |
| "Order-value uplift from bundles" | `aovUplift` is **358¢ = $3.58** — shown per order; see gaps |

## 14. Gaps and risks

**Things `settle()` does not give the renderer**

1. **Single-column stacks.** `settle()` returns one `y` index per bin and one for the whole pile; a 62-high stack at ≥ 8px cannot fit 272px, nor 85 walked dots. The renderer wraps (`col = y % k`) — a presentation mapping, not a re-layout. If the team would rather the wrap live in the pure package, that is a `layout.ts` change and out of B12's scope.
2. **No persona colour.** `color` is only `"persona" | "yellow"`; the renderer joins `shoppers` by `id` for persona, `missed` and the popover. Keep a `Map<id, GymShopper>`.
3. **No policy A geometry.** The outline is drawn from `A.counts` directly, not from `settle(A)`. Fine for a static outline; S10's animation needs only B.
4. **The walked pile has no "missed" split.** `missed` is on the shopper, so the 35% wash is the renderer's join too.

**SPEC §9.2 ambiguities and how they were resolved**

- *Reference-line colour.* SPEC lists the lines but no style. All three are one dashed bark style; colour stays reserved. Label collision handled by a second row.
- *Does the legend filter recompute the cards?* Resolved: no. Cards are A-vs-B facts about the run; `GymResult` has no per-persona aggregates and inventing them in the UI would let the chart claim something the engine did not compute.
- *Where A's floor line goes.* Not drawn; the outline shows where A closed and the chip shows A's floor value.
- *`aovUplift` unit.* Types say "order-value uplift from bundles"; the value is 358¢. Displayed as `$3.58` labelled "per order". If it is actually a total, only the label changes — confirm with the gym owner.
- *Sun on cream.* Sun-yellow is 1.30:1 on cream; the yellow dots need the 1px bark ring or they vanish. The band wash at 12% is fine because it carries a text label.
- *Policy A source.* The fixture holds one policy; A is the same engine at floorPct 40 and the losing state at 50. Both are deterministic real runs, not the fixture file. If the Console's saved policy on demo day is a different floor, everything re-renders from live runs anyway.

**Build risk inside the 2-hour budget**

- Fonts: Satoshi is not on Google Fonts; the reference falls back to `system-ui`. Fredoka loads from Google Fonts. Budget 10 minutes to wire Satoshi from Fontshare or accept the fallback.
- The popover clamping and the reference-label second row are the only two bits of layout logic beyond arithmetic; both are in the reference JS.
- The table view is unbuilt — 15 minutes.
- Chart width is fixed at 908 for 1440. If the Console's actual column widths differ, only `binPx` (`floor(plotWidth / 15)`) and `blockPad` change; keep `k = 3` and the 10px pitch.
- `impeccable` is not installed in this environment, so no polish pass was run against it; the dataviz skill's checks (form, colour validator, marks, hover, anti-patterns) were.

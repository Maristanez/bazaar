---
name: Trailhead Owner Console
description: An owner-only trail-map console for live pricing decisions and policy control.
colors:
  teal: "#004c4c"
  cream: "#fdf3e3"
  coral: "#f3675a"
  sky: "#ccffff"
  bark: "#2f1604"
  sun: "#f6d809"
  amber: "#e8d6b9"
typography:
  display:
    fontFamily: "Fredoka, sans-serif"
    fontSize: "1.6rem"
    fontWeight: 550
    lineHeight: "normal"
  body:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.5"
rounded:
  sm: "6px"
  md: "8px"
  lg: "14px"
  pill: "999px"
spacing:
  page: "24px"
  mobile-page: "12px"
components:
  button-primary:
    backgroundColor: "{colors.teal}"
    textColor: "{colors.cream}"
    rounded: "{rounded.md}"
    padding: "0.7rem 1.1rem"
  paper:
    backgroundColor: "{colors.cream}"
    rounded: "{rounded.lg}"
    padding: "24px"
---

# Design System: Trailhead Owner Console

## Overview

**Creative North Star: "The Trail Map Shopkeeper"**

The Console is an owner operating surface: a deep teal field holds cream paper panels, a dashed trail separates dense evidence, and a small die-cut sticker marks Trailhead Co. The page should feel practical at a glance while carrying the hand-drawn trail-map character from SPEC §12.

This is one page with a live feed, policy controls, owner decisions, and a reserved Gym area. Keep the owner’s next action visible and preserve the distinction between operational evidence and decision state.

**Key Characteristics:**

- Deep teal ground, cream paper panels, flat color, generous spacing.
- Dense two-second feed rows with tabular monetary figures.
- Coral and sun are semantic state colors, not decoration.

## Colors

The palette is trail-map teal and cream with restrained state accents.

### Primary

- **Deep trail teal** (`#004c4c`): page ground, primary controls, active switch, and primary text on light surfaces.
- **Sky wash** (`#ccffff`): fixture notice, light status text, selection, and top-bar focus treatment.

### Tertiary

- **Paused coral** (`#f3675a`): paused state and blocked rows only.
- **Decision sun** (`#f6d809`): pending owner approval card only.
- **Missing-stock amber** (`#e8d6b9`): missing `stocked_at` flag only; it must remain distinct from decision sun.

### Neutral

- **Paper cream** (`#fdf3e3`): panels, cards, sticker fill, and light text contrast.
- **Bark ink** (`#2f1604`): body text and dark control details.

### Named Rules

**The Semantic Accent Rule.** Coral/red means paused or blocked. Sun/yellow means the owner must decide. Missing-cost flags are coral; missing-stock-date flags are dull amber-brown. No accent is ornamental.

## Typography

**Display Font:** Fredoka (with `sans-serif` fallback)

**Body Font:** Satoshi (with `sans-serif` fallback)

**Character:** Fredoka gives the owner surface a rounded trail-marker voice; Satoshi keeps dense operational rows readable.

### Hierarchy

- **Display** (Fredoka, 550, `1.6rem`): Console title and primary page identity.
- **Headline** (Fredoka, 550, `1.5rem`): panel headings such as Live feed, Your policy, and The Gym.
- **Title** (Satoshi, 700): product names, policy labels, and decision emphasis.
- **Body** (Satoshi, 400, `1rem`, `1.5` line-height): explanatory copy and event reasoning.
- **Label** (Satoshi, 700, compact): status, surface chips, metadata, and controls.

All dollar figures use tabular numerals via `font-variant-numeric: tabular-nums`; money remains cents in contracts and is rendered as CAD dollars.

## Layout

The desktop Console uses a centered `1360px` maximum layout with `24px` page padding. The main content is a two-column grid: the live feed is approximately 55% (`1.22fr`) and policy/approvals occupy the remaining column, separated by `24px`. The top bar is sticky and keeps the PAUSE/Resume control in frame.

At `760px` and below, the columns become one column, the top bar wraps, page padding becomes `12px`, paper padding becomes `18px`, and the feed viewport reduces to `480px`. The live feed has a contained scroll area (`620px` desktop, `480px` mobile) so the page remains usable while the top bar stays available. The Gym placeholder follows the columns and retains a minimum height of `480px`.

## Elevation & Depth

Depth is a soft paper lift over the teal ground: cream panels use `0 8px 24px #002d2d33`; the sticky top bar uses `0 6px 18px #002d2d26`. Dividers are dashed rather than heavy borders. The sticker uses a thick white outline and a slight rotation.

## Shapes

Paper panels use a `14px` radius; controls use `8px`; pills and surface chips use fully rounded `999px` geometry. Inputs use a light paper background and a `1px` bark border. The sticker is a `42px` square with a `3px` white outline, `12px` corners, and a `-6deg` tilt.

## Components

### Buttons

- **Shape:** `8px` corners, minimum height `44px`, Satoshi bold.
- **Primary:** teal background with cream text and `0.7rem 1.1rem` padding.
- **Hover / Focus:** brightness lift on hover; a visible `3px` focus outline with `4px` offset. Top-bar focus uses sky.
- **PAUSE:** coral while live, changing to Resume when paused; always visible in the sticky top bar.
- **Secondary:** transparent with a teal border and teal text, used for Decline.

### Chips

- **Surface chip:** outlined, fully rounded, compact label for Storefront or ChatGPT.
- **Status pill:** outlined sky while live; coral fill and bark text while paused.

### Cards / Containers

- **Paper:** cream background, `14px` radius, soft paper shadow, and `24px` internal padding (`18px` on mobile).
- **Feed row:** compact, dashed top divider, offer/floor first, composed reasoning, menu, loud picked option, memory, surface, then quiet model/latency/cost metadata.
- **Approval card:** sun background and the only yellow surface; contains items, offer, profit in dollars and percent over cost, a 45-second bar, and Approve/Decline.
- **Gym:** empty `480px`-minimum paper placeholder with title, helper text, and disabled Run the Gym control until the Gym is implemented.

### Inputs / Fields

- **Style:** paper-colored fields with a `1px` bark border and `6px` radius; range slider spans the policy column.
- **Focus:** visible teal outline; use sky in the top bar.
- **Policy preview:** moving the slider or switch updates only the local preview. Adopt commits exactly once through the port.

### Navigation

There are no tabs. The sticky top bar identifies Trailhead Co., the Owner Console, current Deals live/Paused status, and the pause control. The login is a plain paper form with email and password; development may start already signed in.

### Live feed

The feed is the evidence surface shared by Storefront and ChatGPT. Blocked rows are coral and name exactly one layer: `validate`, `engine`, `check`, or `auditor`. Code-composed reasoning may expose owner-only facts here; those facts must not cross into shopper surfaces.

### Product flags

Missing cost is a coral row reading “missing cost — not open to offers.” Missing `stocked_at` is a dull amber row reading “no stock date — treated as new stock.” The colors and copy are semantic and must remain distinguishable from approval sun.

## Do's and Don'ts

### Do:

- **Do** keep the sticky PAUSE/Resume control large and in frame.
- **Do** use Satoshi for body text and Fredoka for headings, with the self-hosted files under `/fonts/`.
- **Do** preserve the feed reading order and keep the picked option visually loud.
- **Do** keep coral, sun, and dull amber tied to their specified state meanings.
- **Do** stack the feed, policy, approvals, and Gym cleanly below `760px`.

### Don't:

- **Don't** use coral/red for decoration, ordinary errors, or unblocked content.
- **Don't** use sun/yellow for highlights, icons, borders, or anything besides an owner decision.
- **Don't** treat dull amber missing-stock flags as approval state.
- **Don't** add tabs, a storefront redesign, or an implemented Gym chart to this Console surface.
- **Don't** send owner-only cost, floor, profit, menus, or reasoning into shopper components or shared shopper modules.

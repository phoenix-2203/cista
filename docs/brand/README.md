# Cista brand

| File | Use |
|---|---|
| `cista-wordmark.svg` | Wordmark on light backgrounds (ink `#16130f`) |
| `cista-wordmark-dark.svg` | Wordmark on dark backgrounds (cream `#f2ebe0`) |
| `cista-mark.svg` | App icon and favicon: a wax seal stamped with the serif *c* |

The wordmark is "cista" set in Instrument Serif, converted to outlines, with
the dot of the *i* replaced by a wax seal. *Cista* is Latin for a sealed
chest; the seal is the product's one idea: each payslip is sealed to the
person it belongs to. The app draws the same outlines from `apps/web/src/brand.ts`,
so the ink follows the light or dark theme.

## Colour (Oxblood)

| Token | Light | Dark |
|---|---|---|
| Paper | `#f4efe6` | `#0d0b0a` |
| Surface | `#fbf8f2` | `#171412` |
| Ink | `#16130f` | `#f2ebe0` |
| Muted ink | `#6b645a` | `#9a9086` |
| Rule | `#e2d9c9` | `#2c2522` |
| Seal (accent) | `#8e1b2c` | `#c9475a` |
| Wax gradient | `#c8485a` → `#9b1f31` → `#5e0f1b` | same |

One accent only: the seal colour is for the primary action, the italic word
in a headline and the wax. Everything else is ink on paper.

## Type

- **Instrument Serif**: headlines and the wordmark
- **Inter**: body text and controls
- **JetBrains Mono**: labels, hashes, addresses, amounts

All three are under the SIL Open Font License and are served from Cista's own
origin (no font CDN, so the strict CSP holds).

# Mosaic Card — Open Issues / Backlog

## Bugs

### Card height overflow in section view
Cards at the bottom slightly overflow outside the section view boundary in the actual HA section view (not the editor preview). The row height math in `_containerStyle()` is likely slightly off — `calc(var(--row-height) - (${rowGap}px - var(--row-gap)) + ${rowGap}px / ${rows})` needs review against HA's actual section row height formula.

### Mobile always 12 columns
The card always reports `columns: 12` from `getGridOptions()`. On HA section views with narrower viewports the grid is capped at 12 columns, but sub-card `column_start` / `columns` values designed for e.g. 24 columns will break. The `mobile` sub-key already exists in `CardGridOptions` but is not yet used at render time in `mosaic-card.ts`.

---

## Features

### Custom CSS — scoped stylesheet per card
Currently `custom_css` in `grid_options` appends raw CSS declarations to the wrapper's `style` attribute. A better UX would be a multiline text area where users can write full CSS rules. Scoping strategy:
- Generate a unique class per card (e.g. `mosaic-card-<index>` or a hash of the card config) and add it to the wrapper div
- Append the user's CSS wrapped in a `<style>` tag to the mosaic card's shadow root (or a container element), prefixed with `.mosaic-card-<id>` as the scope selector
- This allows targeting `ha-card`, inner elements, CSS custom properties, etc.

### Rethink layout modes
Current `mode: auto | manual` with `auto_flow: dense | row | column` is confusing. Proposed clearer modes:
- **grid** — default CSS grid with auto-placement (replaces `auto` + `dense`)
- **row** — cards have fixed height, flow left-to-right with wrapping (replaces `auto` + `row`)
- **column** — cards have fixed width, flow top-to-bottom (replaces `auto` + `column`)
- **free** — fully manual placement with explicit `column_start` / `row_start` (replaces `manual`)

The editor UI and `MosaicCardConfig` would need to be updated accordingly.

### `grid_options.rows` means two different things
For a top-level mosaic it is HA's Layout-tab card height. For a mosaic nested
inside another mosaic it is the *span in the parent's grid*, set by our own grid
picker. `effectiveRowCount()` currently treats both as "number of rows in my own
grid", which is right for the first and only coincidentally right for the second
(it happens to work when parent and child use the same subdivision). Nested
mosaics on the Home view show a one-row (22px) empty tail from this. Needs a
decision on whether a nested mosaic's inner row count should be independent of
its parent span.

### Auto mode still uses a fixed 8-row canvas under auto height
`maxUsedRow` only works in manual mode — auto-mode placement is decided by the
browser, so an auto-mode mosaic with auto height still declares 8 rows and can
show an empty tail. Fixing it probably means dropping `grid-template-rows`
entirely in that combination and letting `grid-auto-rows` create exactly the
rows needed.

---

## Done

- **Visibility support** — implemented as native HA `visibility` conditions per sub-card, using `hui-card` for evaluation and HA's own editor UI. Superseded the originally proposed static boolean.
- **New cards start tiny in the grid** — the editor owns the add path now and assigns mode-aware default `grid_options` in `defaultGridOptions()`.
- **Hide title field in the Cards section** — moot: the embedded vertical-stack editor is gone, replaced by `hui-card-picker` + `hui-card-element-editor` driven by the sidebar selection.
- **Card background / no more wrapper card** — the mosaic always renders an `ha-card`; `background: false` makes it transparent rather than removing it. Nesting a mosaic in `vertical-stack-in-card` purely to get a background (and to give card-mod something to target) is no longer needed.

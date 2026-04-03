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

### Visibility support
Consider adding a `visible` field (or `hidden`) to `CardGridOptions` so individual cards can be conditionally hidden (e.g. via template or static boolean). Unclear if HA template evaluation is feasible here; at minimum a static boolean toggle in the editor would be useful.

### New cards start tiny in the grid
Cards added via the card picker get no `grid_options`, so `_resolveGridOptions` in `mosaic-card.ts` falls back to `columns: 2, rows: 1`. Fix: in the `config-changed` handler on the stack editor (`mosaic-card-editor.ts`), detect cards at index `>= existingCards.length` (newly added) and assign default `grid_options`. Default: `{ columns: 4, rows: 2 }` for auto mode; `{ columns: 4, rows: 2, column_start: 1, row_start: 1 }` for manual mode.

### Hide title field in the Cards (card picker) section
The vertical-stack editor element we embed shows a "Title" input at the top. It should be hidden. Options:
- Inject `<style>` into the stack editor's shadow root after `getConfigElement()` returns
- Target `ha-textfield` or similar — inspect the exact element to find a stable selector
- CSS: `editor.shadowRoot.querySelector('ha-textfield')?.style.display = 'none'` (fragile but quick)

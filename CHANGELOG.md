# Changelog

## [0.4.0] - 2026-07-21

- Sub-cards now support **visibility conditions**, using Home Assistant's own condition editor and evaluation — the same UI as a native card's Visibility tab
- The editor now has **one card list**: selecting a card in the sidebar drives the position grid, its settings and its editor together, instead of a separate embedded stack editor with its own list
- Cards can be **added, reordered, duplicated and deleted** from the sidebar
- The mosaic can now draw **its own card background**, so it no longer needs to be nested inside another card to have one — with padding and custom CSS options
- Auto mode removed: placement is now **per card**, so a card with an explicit position is pinned and one without is auto-placed
- Fixed cards being **far too tall or too short** with automatic height
- Fixed the drag handles landing in the **wrong place** on cards with many rows

## [0.3.0] - 2026-07-19

- Added **Row subdivision** option (1×/2×/4×) for finer vertical sizing: 56px, 28px or 14px grid rows
- Editor preview now matches the card's real dashboard size and proportions
- Fixed cards (e.g. mushroom chips) rendering blank in the editor preview
- Editor preview is no longer accidentally interactive
- Resize handles no longer block move-dragging of small cards

## [0.2.2] - 2026-04-11

<!-- User-facing changes for the changelog. Delete this section for internal/CI-only changes. -->
-

## [0.2.1] - 2026-04-07

- Added README with installation instructions, configuration reference, and visual preview
- Added MIT LICENSE file
- Added HACS validation step to CI validate workflow

## [0.2.0] - 2026-04-04

- Added card picker UI for adding sub-cards directly in the mosaic editor
- Added sexy grid editor with live preview rendering
- Improved grid layout: single position grid for all cards

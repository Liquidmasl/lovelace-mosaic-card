# CLAUDE.md — Mosaic Card Knowledge Base

> Reference index for AI sessions. Ctrl+F friendly. Update when you learn something non-obvious.

---

## Project Overview

`lovelace-mosaic-card` is a custom Home Assistant Lovelace card that provides a mosaic layout for sub-cards. It is distributed as a single bundled JS file and installed via HACS or manually.

**Repo:** https://github.com/Liquidmasl/lovelace-mosaic-card
**Output artifact:** `mosaic-card.js` (single ES module, no dependencies at runtime)

---

## Repo Structure

```
src/
  mosaic-card.ts       # Main card — single source file
scripts/
  version.js           # Post-build script: stamps __VERSION__ into mosaic-card.js
.github/workflows/
  release.yml          # CI: builds on GitHub release publish, uploads mosaic-card.js as asset
rollup.config.mjs      # Build config: input src/mosaic-card.ts → output mosaic-card.js
tsconfig.json          # TypeScript strict config, ES2021 target
package.json           # npm scripts, devDeps (rollup, typescript, lit)
hacs.json              # HACS metadata: filename=mosaic-card.js, render_readme=true
```

---

## Build & Dev Workflow

```bash
npm ci                 # install deps
npm run build          # tsc + rollup → mosaic-card.js (minified, version stamped)
npm run watch          # rollup --watch (no minification in watch mode)
```

- Build output: `mosaic-card.js` in repo root (ES module, minified by terser in prod)
- Version token `__VERSION__` in source is replaced by `scripts/version.js` using `package.json` version
- Watch mode skips terser (`dev` flag in rollup.config.mjs: `!dev && terser(...)`)
- **To test in HA:** copy `mosaic-card.js` to HA `www/` folder, add as Lovelace resource, hard-refresh browser

---

## Card Registration

```typescript
// Decorator registers the element
@customElement("mosaic-card")
export class MosaicCard extends LitElement { ... }

// Manual registration with HA's card picker
const win = window as unknown as { customCards?: CustomCardEntry[] };
win.customCards = win.customCards ?? [];
win.customCards.push({ type: "mosaic-card", name: "Mosaic Card", description: "..." });
```

- `customElements.define` is handled by the `@customElement` LitElement decorator
- `window.customCards` push is what makes the card appear in the HA UI card picker

---

## Architecture & Code Patterns

- **LitElement** with `@customElement` decorator (TypeScript strict mode)
- Card config type: `MosaicCardConfig` interface (add new fields here)
- `setConfig(config)` — called by HA when card is added/configured
- `render()` — returns LitElement `TemplateResult`
- `getCardSize()` — returns `3` (tells HA how many grid rows the card occupies)
- `getStubConfig()` — returns minimal default config for card picker preview
- `hass` property typed as `Record<string, unknown>` (broaden as needed, HA types not vendored)
- TypeScript `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns` all enabled — compiler is strict

---

## Release Process

1. GitHub release published → triggers `release.yml`
2. CI runs `npm ci && npm run build`
3. `mosaic-card.js` uploaded as release asset
4. HACS picks up the asset via `hacs.json` (`filename: "mosaic-card.js"`)

---

## How-to Index

### Add a new config option
1. Add field to `MosaicCardConfig` interface in `src/mosaic-card.ts`
2. Use it in `render()` via `this._config.yourField`
3. Update `getStubConfig()` if it needs a default

### Add a card editor
- Create a new `@customElement("mosaic-card-editor")` class
- Implement `setConfig` / `configChanged` pattern
- Register: `(MosaicCard as any).getConfigElement = () => document.createElement("mosaic-card-editor")`

### Debug a build issue
- Run `npm run build` and check rollup/tsc errors
- TypeScript errors show file:line; fix them — strict mode means no implicit any
- If `mosaic-card.js` missing version: check `scripts/version.js` ran (it's part of `npm run build`)

---

## What to Update Here (Rule)

Every issue that produces non-obvious knowledge must add a section or bullet here before closing.
If you learned something about HA shadow DOM, test infra, selectors, or new code patterns — it goes in this file.

---

*Last updated: LQM-62 (initial knowledge base bootstrap)*

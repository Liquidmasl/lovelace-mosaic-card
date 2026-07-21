import { LitElement, html, css, CSSResultGroup, TemplateResult, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// ── Config interfaces ─────────────────────────────────────────────────────────

interface CardStyles {
  pointer_events?: string;
  overflow?: string;
  opacity?: number | string;
}

interface CardGridOptions {
  /** Column span (how many grid columns this card occupies) */
  columns?: number;
  /** Row span (how many grid rows this card occupies) */
  rows?: number;
  /** Manual mode only: explicit column start position (1-based) */
  column_start?: number;
  /** Manual mode only: explicit row start position (1-based) */
  row_start?: number;
  /** Manual mode only: z-index for overlay stacking */
  z_index?: number;
  /** Manual mode only: per-card CSS style overrides */
  styles?: CardStyles;
  /** Remove the sub-card's border (box-shadow + border-radius + border). */
  no_border?: boolean;
  /** Remove the sub-card's background. */
  no_background?: boolean;
  /** Extra CSS declarations applied to the card wrapper element. */
  custom_css?: string;
  /**
   * 12-column fallback layout used when the mosaic card is configured with
   * more than 12 columns. Mirrors the root fields but applies to narrower
   * viewports / HA section views that cap at 12 columns.
   */
  mobile?: {
    columns?: number;
    rows?: number;
    column_start?: number;
    row_start?: number;
  };
}

interface SubCardConfig {
  type: string;
  grid_options?: CardGridOptions;
  /**
   * Visibility conditions, identical in shape to HA's native card `visibility`.
   * Evaluated by hui-card — we never interpret them ourselves.
   */
  visibility?: unknown[];
  [key: string]: unknown;
}

export interface MosaicCardConfig {
  type: string;
  /**
   * Layout mode.
   * - "auto"   (default) — grid-auto-flow: dense, cards sized only
   * - "manual" — every card has explicit column_start + row_start
   */
  mode?: "auto" | "manual";
  /**
   * Number of equal-width columns in the grid.
   * Defaults to the mosaic card's own HA grid size (getGridOptions().columns = 12).
   */
  rows?: number;
  columns?: number;
  /** Gap between columns in px. Default 8. */
  column_gap?: number;
  /** Gap between rows in px. Default 8. */
  row_gap?: number;
  /**
   * Auto-flow mode. Only applies when mode = "auto".
   * Controls CSS grid-auto-flow. Default "dense".
   */
  auto_flow?: "dense" | "row" | "column";
  /**
   * Row subdivision factor. Splits the standard 56px HA row into finer units:
   * 1 → 56px rows, 2 → 28px rows, 4 → 14px rows. Default 1.
   */
  row_subdivision?: 1 | 2 | 4;
  /** Title displayed above the grid. */
  title?: string;
  /**
   * Whether the card is *visually* a card — background, border and shadow from
   * the theme. Default true. Setting it false makes the ha-card transparent and
   * borderless (for a mosaic nested inside another card); the ha-card element
   * itself is always rendered either way, so themes and card-mod always apply.
   */
  background?: boolean;
  /** Padding inside the card, in px. */
  card_padding?: number;
  /** Extra CSS declarations for the card, e.g. a gradient or custom radius. */
  card_css?: string;
  /** Strip card borders from sub-cards. Default true. */
  strip_borders?: boolean;
  cards?: SubCardConfig[];
  /**
   * Grid size options set by HA's section view Layout tab.
   * These are the values users configure when resizing the card in the UI.
   */
  grid_options?: HAGridOptions;
}

// ── HA type stubs ─────────────────────────────────────────────────────────────

interface HAGridOptions {
  columns?: number | string;
  rows?: number | string;
  min_columns?: number;
  min_rows?: number;
}

interface LovelaceSectionConfig {
  column_span?: number;
  [key: string]: unknown;
}

/**
 * HA's own `hui-card` wrapper element (src/panels/lovelace/cards/hui-card.ts).
 *
 * It is what HA's views and sections use to host a card, and it handles all of
 * the fiddly parts for us: creating the element (incl. error cards), `ll-rebuild`
 * / `ll-upgrade`, delivering hass *before* the element is attached, and — the
 * reason we use it — evaluating `config.visibility` via `checkConditionsMet()`
 * with live listeners for screen/time conditions. When conditions fail it sets
 * `display: none` + the `hidden` attribute on itself and detaches the child.
 */
interface HuiCardElement extends HTMLElement {
  config?: Record<string, unknown>;
  hass?: unknown;
  preview?: boolean;
  /** Builds the inner card element immediately instead of on first update. */
  load?(): void;
  getCardSize?(): number | Promise<number>;
  /** Grid options reported by the inner card itself (not from config). */
  getElementGridOptions?(): HAGridOptions;
}

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
  }
}

// ── Shared grid geometry ──────────────────────────────────────────────────────

/**
 * Last grid row occupied by any card, from its explicit placement. Only
 * meaningful in manual mode — in auto mode the browser decides placement, so
 * this returns 0 and `grid-auto-rows` covers any spill instead.
 */
function maxUsedRow(config: MosaicCardConfig): number {
  if ((config.mode ?? "auto") !== "manual") return 0;
  let max = 0;
  for (const card of config.cards ?? []) {
    const g = card.grid_options;
    if (!g) continue;
    const end = (g.row_start ?? 1) + (g.rows ?? 1) - 1;
    if (end > max) max = end;
  }
  return max;
}

/**
 * How many rows the grid actually renders.
 *
 * The editor's drag overlay MUST use this too: it divides the overlay into this
 * many bands, so if it disagrees with the card every handle lands in the wrong
 * place. That is why this lives here as a shared function rather than being
 * reimplemented on both sides.
 *
 * `grid_options.rows` is "auto" whenever HA sizes the card to its content, in
 * which case the declared count is only a starting point — cards placed past it
 * would otherwise land in content-sized implicit rows.
 */
export function effectiveRowCount(config: MosaicCardConfig): number {
  const used = maxUsedRow(config);

  // NOTE: grid_options.rows is deliberately NOT consulted. It belongs to HA and
  // is measured in HA rows (56px); ours are subdivided (56/row_subdivision).
  // Writing our count there made HA reserve 19*56px for a grid we drew at
  // 19*22px — ~790px of dead space per card. grid_options.rows now only affects
  // what HA reserves; the internal grid is ours alone.
  if (typeof config.rows === "number") return Math.max(config.rows, used);

  // Nothing declared: fit the content exactly. A fixed fallback here is what
  // left short cards padded with empty rows. (Auto *mode* placement is decided
  // by the browser, so `used` is 0 there and the fallback still applies.)
  return used > 0 ? used : 8;
}

// ── Component ─────────────────────────────────────────────────────────────────

@customElement("mosaic-card")
export class MosaicCard extends LitElement {
  @property({ attribute: false }) public hass?: unknown;
  @property({ attribute: false }) public sectionConfig?: LovelaceSectionConfig;
  /**
   * Set by HA (and by our editor's preview) while the dashboard is in edit mode.
   * Forwarded to every hui-card, which then ignores visibility conditions so
   * conditionally-hidden cards stay visible and editable.
   */
  @property({ attribute: false }) public preview = false;

  @state() private _config?: MosaicCardConfig;
  @state() private _cardElements: HuiCardElement[] = [];

  // ── Styles ──────────────────────────────────────────────────────────────────

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }

      .mosaic-grid {
        display: grid;
      }

      .mosaic-title {
        font-size: var(--ha-card-header-font-size, 1.24rem);
        font-weight: 500;
        padding: 8px 16px 4px;
        color: var(--primary-text-color);
      }

      /*
       * Each direct child of the grid acts as a card wrapper.
       * min-width / min-height prevent grid blowout when card content is wide.
       */
      .mosaic-grid > .card-wrapper {
        min-width: 0;
        min-height: 0;
        position: relative;
      }

      /*
       * hui-card sets the "hidden" attribute on itself when a card's visibility
       * conditions are not met. Collapse the wrapper too, so the cell is freed
       * for dense auto-flow instead of leaving a hole. Mirrors how HA's own
       * hui-grid-section hides cards.
       */
      .mosaic-grid > .card-wrapper:has(> hui-card[hidden]) {
        display: none;
      }

      /*
       * strip-borders: remove ha-card box-shadow and border-radius from sub-cards.
       */
      .mosaic-grid.strip-borders > .card-wrapper ::slotted(ha-card),
      .mosaic-grid.strip-borders > .card-wrapper ha-card {
        box-shadow: none !important;
        border-radius: 0 !important;
      }

    `;
  }

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  public setConfig(config: MosaicCardConfig): void {
    if (!config.cards || !Array.isArray(config.cards)) {
      // Accept configs with no cards yet (e.g., while editing)
      this._config = { ...config, cards: [] };
    } else {
      this._config = config;
    }

    // if (config.grid_options) {
    //   console.info("Mosaic card grid options from Layout tab:", config.grid_options);
    // }

    this._buildCardElements();
  }

  protected updated(changedProperties: PropertyValues): void {
    // hui-card is reactive on both — just forward and let it do the work.
    if (changedProperties.has("hass") && this.hass !== undefined) {
      for (const el of this._cardElements) el.hass = this.hass;
    }
    if (changedProperties.has("preview")) {
      for (const el of this._cardElements) el.preview = this.preview;
    }
  }

  // ── Card element creation ───────────────────────────────────────────────────

  private async _buildCardElements(): Promise<void> {
    const cards = this._config?.cards;
    if (!cards?.length) {
      this._cardElements = [];
      return;
    }

    // hui-card ships with the Lovelace frontend chunk, which is always loaded by
    // the time a custom card renders. Awaiting it costs nothing in practice and
    // guards against being instantiated outside a dashboard.
    if (!customElements.get("hui-card")) {
      await customElements.whenDefined("hui-card");
    }

    this._cardElements = cards.map((cardConfig) =>
      this._createCardElement(cardConfig),
    );
  }

  private _createCardElement(cardConfig: SubCardConfig): HuiCardElement {
    // Strip our own grid_options — hui-card would otherwise report them as the
    // card's grid options, and the sub-card has no use for them.
    const { grid_options: _stripped, ...subConfig } = cardConfig;
    const el = document.createElement("hui-card") as HuiCardElement;
    el.config = subConfig as Record<string, unknown>;
    el.preview = this.preview;
    if (this.hass !== undefined) el.hass = this.hass;
    // Build the inner element now so _resolveGridOptions can read its native
    // grid options during this render pass rather than one frame late.
    el.load?.();
    return el;
  }

  // ── Grid style helpers ──────────────────────────────────────────────────────

  /**
   * Resolve the effective CardGridOptions for a sub-card.
   * Priority: explicit grid_options in config → card's native getGridOptions().
   */
  private _resolveGridOptions(
    cardConfig: SubCardConfig,
    element: HuiCardElement,
  ): Required<Pick<CardGridOptions, "columns" | "rows">> & CardGridOptions {
    if (cardConfig.grid_options) {
      return {
        columns: 2,
        rows: 1,
        ...cardConfig.grid_options,
      };
    }

    // Fall back to the sub-card's own HA grid options (native defaults).
    // getElementGridOptions() asks the inner card only — getGridOptions() would
    // merge in config values we already handled above.
    const native = element.getElementGridOptions?.();
    return {
      columns: typeof native?.columns === "number" ? native.columns : 2,
      rows: typeof native?.rows === "number" ? native.rows : 1,
    };
  }

  /** Build the inline style string for the .mosaic-grid container. */
  private _containerStyle(): string {
    const cfg = this._config!;
    const mode = cfg.mode ?? "auto";
    // A card can be placed past the declared row count. CSS Grid then invents
    // *implicit* rows for it, and those are sized by content rather than by our
    // fixed row height — which is what makes an auto-height mosaic balloon.
    // effectiveRowCount extends the track list to cover what the cards use.
    const rows = effectiveRowCount(cfg);
    const colGap = cfg.column_gap ?? 8;
    const rowGap = cfg.row_gap ?? 8;

    // Use Layout tab's columns if available, otherwise fall back to config.columns or default
    let columns: number;
    const gridColumns = cfg.grid_options?.columns;
    if (typeof gridColumns === "number") {
      columns = gridColumns;
    } else if (typeof cfg.columns === "number") {
      columns = cfg.columns;
    } else {
      columns = 12;
    }

    // Row subdivision: split the standard 56px HA row into 2 or 4 finer units.
    const sub = cfg.row_subdivision === 2 || cfg.row_subdivision === 4 ? cfg.row_subdivision : 1;
    const baseRowHeight = 56 / sub;
    // Compensate for non-default gaps and distribute the missing trailing gap
    // across rows so the grid's total height stays aligned with HA's section grid.
    const rowSize = Math.max(0, baseRowHeight - (rowGap - 8) + rowGap / rows);

    const parts = [
      `grid-template-columns: repeat(${columns}, 1fr)`,
      `gap: ${rowGap}px ${colGap}px`,
      `grid-template-rows: repeat(${rows}, ${rowSize.toFixed(3)}px)`,
      // Belt and braces: auto-flow in "auto" mode can still spill past the
      // explicit tracks. Pin any implicit row to the same height so it can
      // never be content-sized.
      `grid-auto-rows: ${rowSize.toFixed(3)}px`,
    ];

    if (mode === "auto") {
      const autoFlow = cfg.auto_flow ?? "dense";
      parts.push(`grid-auto-flow: ${autoFlow}`);
    }

    return parts.join("; ");
  }

  /** Build the inline style string for a single card wrapper. */
  private _cardStyle(
    opts: ReturnType<typeof this._resolveGridOptions>,
    mode: "auto" | "manual",
  ): string {
    const colSpan = opts.columns ?? 2;
    const rowSpan = opts.rows ?? 1;
    const parts: string[] = [];

    if (mode === "auto") {
      parts.push(`grid-column: span ${colSpan}`);
      parts.push(`grid-row: span ${rowSpan}`);
    } else {
      const colStart = opts.column_start ?? 1;
      const rowStart = opts.row_start ?? 1;
      parts.push(`grid-column: ${colStart} / span ${colSpan}`);
      parts.push(`grid-row: ${rowStart} / span ${rowSpan}`);
      if (opts.z_index !== undefined) {
        parts.push(`z-index: ${opts.z_index}`);
      }
    }

    // Per-card style overrides (manual mode feature, but applied regardless)
    const s = opts.styles;
    if (s) {
      if (s.pointer_events !== undefined)
        parts.push(`pointer-events: ${s.pointer_events}`);
      if (s.overflow !== undefined) parts.push(`overflow: ${s.overflow}`);
      if (s.opacity !== undefined) parts.push(`opacity: ${s.opacity}`);
    }

    // CSS custom properties inherit through shadow DOM — the correct way to style ha-card internals.
    if (opts.no_border) {
      parts.push("--ha-card-box-shadow: none");
      parts.push("--ha-card-border-width: 0px");
      parts.push("--ha-card-border-radius: 0px");
    }
    if (opts.no_background) {
      parts.push("--ha-card-background: transparent");
    }
    if (opts.custom_css) parts.push(opts.custom_css);

    return parts.join("; ");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  protected render(): TemplateResult {
    if (!this._config) {
      return html``;
    }

    const mode = this._config.mode ?? "auto";
    const title = this._config.title;
    const stripBorders = this._config.strip_borders !== false;

    const content = html`
      ${title ? html`<div class="mosaic-title">${title}</div>` : ""}
      <div
        class="mosaic-grid ${stripBorders ? "strip-borders" : ""}"
        style=${this._containerStyle()}
      >
        ${this._cardElements.map((el, i) => {
          const cardConfig = this._config!.cards![i];
          const opts = this._resolveGridOptions(cardConfig, el);
          return html`
            <div class="card-wrapper" style=${this._cardStyle(opts, mode)}>
              ${el}
            </div>
          `;
        })}
      </div>
    `;

    // ha-card is ALWAYS rendered — it is the container every HA card uses, so
    // this is what makes themes and card-mod's `ha-card { … }` selector apply to
    // the mosaic like any other card. Hiding the background makes it
    // transparent rather than removing it; a conditional element would mean
    // card-mod silently working or not depending on an unrelated toggle.
    return html`
      <ha-card style=${this._cardStyleString()}>${content}</ha-card>
    `;
  }

  /** Inline declarations for the ha-card. Inline beats :host, so these win. */
  private _cardStyleString(): string {
    const parts: string[] = [];

    // Same approach as the per-sub-card no_border / no_background options:
    // neutralise via the theme's own custom properties instead of overriding
    // the rules, so anything the theme sets stays consistent.
    if (this._config?.background === false) {
      parts.push("--ha-card-background: transparent");
      parts.push("--ha-card-box-shadow: none");
      parts.push("--ha-card-border-width: 0px");
    }

    const padding = this._config?.card_padding;
    if (typeof padding === "number") parts.push(`padding: ${padding}px`);
    if (this._config?.card_css) parts.push(this._config.card_css);
    return parts.join("; ");
  }

  // ── HA card API ─────────────────────────────────────────────────────────────

  /**
   * Returns the sum of all child card sizes.
   * HA uses this for layout calculations in non-section views.
   */
  public getCardSize(): number {
    if (!this._cardElements.length) return 3;
    return this._cardElements.reduce((total, el) => {
      const size = el.getCardSize?.();
      return total + (typeof size === "number" ? size : 1);
    }, 0);
  }

  /**
   * Reports preferred grid size to HA's section view.
   * Default: full 12-column width, auto height, minimum 3 columns.
   */
  public getGridOptions(): HAGridOptions {
    return {
      columns: 12,
      rows: 'auto',
      min_columns: 3,
      min_rows: 2,
    };
  }

  static async getConfigElement(): Promise<HTMLElement> {
    await import("./mosaic-card-editor");
    return document.createElement("mosaic-card-editor");
  }

  static getStubConfig(): MosaicCardConfig {
    return {
      type: "custom:mosaic-card",
      mode: "auto",
      column_gap: 8,
      row_gap: 8,
      strip_borders: true,
      cards: [],
    };
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

window.customCards = window.customCards ?? [];
window.customCards.push({
  type: "mosaic-card",
  name: "Mosaic Card",
  description: "A mosaic CSS Grid layout card for Home Assistant",
});

console.info(
  "%c MOSAIC-CARD %c v__VERSION__ ",
  "color: white; background: #555; font-weight: bold;",
  "color: white; background: #007af5; font-weight: bold;",
);

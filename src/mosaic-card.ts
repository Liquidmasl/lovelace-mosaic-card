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
  [key: string]: unknown;
}

interface MosaicCardConfig {
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
  columns?: number;
  /**
   * Row height. "auto" (default) → minmax(min-content, auto).
   * A number is treated as pixels. A string is used verbatim.
   */
  row_height?: "auto" | number | string;
  /** Gap between columns in px. Default 8. */
  column_gap?: number;
  /** Gap between rows in px. Default 8. */
  row_gap?: number;
  /**
   * Auto-flow mode. Only applies when mode = "auto".
   * Controls CSS grid-auto-flow. Default "dense".
   */
  auto_flow?: "dense" | "row" | "column";
  /** Title displayed above the grid. */
  title?: string;
  /** Strip card borders from sub-cards. Default true. */
  strip_borders?: boolean;
  cards?: SubCardConfig[];
}

// ── HA type stubs ─────────────────────────────────────────────────────────────

interface HAGridOptions {
  columns?: number | string;
  rows?: number | string;
  min_columns?: number;
  min_rows?: number;
}

interface HACardElement extends HTMLElement {
  setConfig(config: Record<string, unknown>): void;
  hass?: unknown;
  getCardSize?(): number;
  getGridOptions?(): HAGridOptions;
}

interface CardHelpers {
  createCardElement(config: Record<string, unknown>): HACardElement;
}

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
}

declare global {
  interface Window {
    customCards?: CustomCardEntry[];
    loadCardHelpers?(): Promise<CardHelpers>;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

@customElement("mosaic-card")
export class MosaicCard extends LitElement {
  @property({ attribute: false }) public hass?: unknown;

  @state() private _config?: MosaicCardConfig;
  @state() private _cardElements: HACardElement[] = [];

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
    this._buildCardElements();
  }

  protected updated(changedProperties: PropertyValues): void {
    // Forward hass to all child card elements whenever it changes.
    if (changedProperties.has("hass") && this.hass !== undefined) {
      for (const el of this._cardElements) {
        el.hass = this.hass;
      }
    }
  }

  // ── Card element creation ───────────────────────────────────────────────────

  private async _buildCardElements(): Promise<void> {
    const cards = this._config?.cards;
    if (!cards?.length) {
      this._cardElements = [];
      return;
    }

    const helpers = await window.loadCardHelpers?.();
    if (!helpers) {
      console.error("mosaic-card: window.loadCardHelpers is not available");
      return;
    }

    const elements: HACardElement[] = cards.map((cardConfig) => {
      // Strip our own grid_options before passing config to the sub-card.
      const { grid_options: _stripped, ...subConfig } = cardConfig;
      const el = helpers.createCardElement(subConfig as Record<string, unknown>);
      if (this.hass !== undefined) {
        el.hass = this.hass;
      }
      return el;
    });

    this._cardElements = elements;
  }

  // ── Grid style helpers ──────────────────────────────────────────────────────

  /**
   * Resolve the effective CardGridOptions for a sub-card.
   * Priority: explicit grid_options in config → card's native getGridOptions().
   */
  private _resolveGridOptions(
    cardConfig: SubCardConfig,
    element: HACardElement,
  ): Required<Pick<CardGridOptions, "columns" | "rows">> & CardGridOptions {
    if (cardConfig.grid_options) {
      return {
        columns: 2,
        rows: 1,
        ...cardConfig.grid_options,
      };
    }

    // Fall back to the sub-card's own HA grid options (native defaults).
    const native = element.getGridOptions?.();
    return {
      columns: typeof native?.columns === "number" ? native.columns : 2,
      rows: typeof native?.rows === "number" ? native.rows : 1,
    };
  }

  /** Build the inline style string for the .mosaic-grid container. */
  private _containerStyle(): string {
    const cfg = this._config!;
    const mode = cfg.mode ?? "auto";
    const columns = cfg.columns ?? (this.getGridOptions().columns as number);
    const colGap = cfg.column_gap ?? 8;
    const rowGap = cfg.row_gap ?? 8;
    const rowHeight = cfg.row_height ?? "auto";

    const gridAutoRows =
      rowHeight === "auto"
        ? "minmax(min-content, auto)"
        : typeof rowHeight === "number"
          ? `${rowHeight}px`
          : String(rowHeight);

    const parts = [
      `grid-template-columns: repeat(${columns}, 1fr)`,
      `gap: ${rowGap}px ${colGap}px`,
      `grid-auto-rows: ${gridAutoRows}`,
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

    return html`
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
  }

  // ── HA card API ─────────────────────────────────────────────────────────────

  /**
   * Returns the sum of all child card sizes.
   * HA uses this for layout calculations in non-section views.
   */
  public getCardSize(): number {
    if (!this._cardElements.length) return 3;
    return this._cardElements.reduce(
      (total, el) => total + (el.getCardSize?.() ?? 1),
      0,
    );
  }

  /**
   * Reports preferred grid size to HA's section view.
   * Default: full 12-column width, auto height, minimum 3 columns.
   */
  public getGridOptions(): HAGridOptions {
    return {
      columns: 12,
      rows: "auto",
      min_columns: 3,
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
      columns: 4,
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

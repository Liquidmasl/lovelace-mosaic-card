import { LitElement, html, css, CSSResultGroup, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { GridSizeValue } from "./mosaic-grid-size-picker";
import "./mosaic-grid-size-picker";

// ── Config interfaces (mirrored from mosaic-card.ts) ─────────────────────────

interface CardStyles {
  pointer_events?: string;
  overflow?: string;
  opacity?: number | string;
}

interface CardGridOptions {
  columns?: number;
  rows?: number;
  column_start?: number;
  row_start?: number;
  z_index?: number;
  styles?: CardStyles;
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

interface HAGridOptions {
  columns?: number | "full";
  rows?: number;
}

interface MosaicCardConfig {
  type: string;
  mode?: "auto" | "manual";
  rows?: number;
  columns?: number;
  column_gap?: number;
  row_gap?: number;
  auto_flow?: "dense" | "row" | "column";
  title?: string;
  strip_borders?: boolean;
  cards?: SubCardConfig[];
  grid_options?: HAGridOptions;
}

// ── HA element stubs ──────────────────────────────────────────────────────────

interface HassObj {
  [key: string]: unknown;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read a nested value from an object by dot-separated path. */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** Return a shallow-copied object with the value at the given dot-path set. */
function deepSet(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const keys = path.split(".");
  if (keys.length === 1) {
    return { ...obj, [path]: value };
  }
  const [first, ...rest] = keys;
  const nested = (obj[first] ?? {}) as Record<string, unknown>;
  return {
    ...obj,
    [first]: deepSet(nested, rest.join("."), value),
  };
}

// ── Editor component ─────────────────────────────────────────────────────────

interface LovelaceSectionConfig {
  column_span?: number;
  [key: string]: unknown;
}

@customElement("mosaic-card-editor")
export class MosaicCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HassObj;
  @property({ attribute: false }) public sectionConfig?: LovelaceSectionConfig;

  @state() private _config?: MosaicCardConfig;
  @state() private _guiMode = true;
  @state() private _yamlValue = "";
  @state() private _selectedCardIndex = 0;

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  public setConfig(config: MosaicCardConfig): void {
    this._config = config;
    this._yamlValue = this._serializeYaml(config);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private _serializeYaml(config: MosaicCardConfig): string {
    // Simple YAML serialization using JSON as a fallback for the code editor.
    // HA's ha-code-editor will display this; power users can edit raw JSON/YAML.
    return JSON.stringify(config, null, 2);
  }

  private _fireConfigChanged(config: MosaicCardConfig): void {
    this._config = config;
    this._yamlValue = this._serializeYaml(config);
    const event = new CustomEvent("config-changed", {
      detail: { config },
      bubbles: true,
      composed: true,
    });
    this.dispatchEvent(event);
  }

  private _updateGridOptions(updates: Partial<HAGridOptions>): void {
    if (!this._config) return;
    this._fireConfigChanged({
      ...this._config,
      grid_options: { ...this._config.grid_options, ...updates },
    });
  }

  private _getInternalGridColumns(): number {
    const gridColumns = this._config?.grid_options?.columns;
    if (typeof gridColumns === "number") return gridColumns;
    return this._config?.columns ?? 12;
  }

  private _getInternalGridRows(): number {
    const gridRows = this._config?.grid_options?.rows;
    if (typeof gridRows === "number") return gridRows;
    return this._config?.rows ?? 4;
  }

  private _rowsChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const rows = (ev.detail as { value: number }).value;
    this._updateGridOptions({ rows });
  }

  private _valueChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const target = ev.target as HTMLElement & { configValue?: string };
    const key = target.configValue;
    if (!key || !this._config) return;

    const value = (ev.detail as { value: unknown }).value;
    const updated = deepSet(
      this._config as unknown as Record<string, unknown>,
      key,
      value,
    ) as unknown as MosaicCardConfig;
    this._fireConfigChanged(updated);
  }

  private _get(key: string): unknown {
    if (!this._config) return undefined;
    return deepGet(this._config as unknown as Record<string, unknown>, key);
  }

  // ── Card list management ─────────────────────────────────────────────────────

  private _moveCard(index: number, direction: -1 | 1): void {
    if (!this._config?.cards) return;
    const cards = [...this._config.cards];
    const target = index + direction;
    if (target < 0 || target >= cards.length) return;
    [cards[index], cards[target]] = [cards[target], cards[index]];
    this._fireConfigChanged({ ...this._config, cards });
  }

  private _deleteCard(index: number): void {
    if (!this._config?.cards) return;
    const cards = this._config.cards.filter((_, i) => i !== index);
    this._fireConfigChanged({ ...this._config, cards });
  }

  private _pickCard(ev: CustomEvent): void {
    const cardConfig = (ev.detail as { config: SubCardConfig }).config;
    if (!cardConfig || !this._config) return;
    const cards = [...(this._config.cards ?? []), cardConfig];
    this._fireConfigChanged({ ...this._config, cards });
  }

  // ── YAML mode ────────────────────────────────────────────────────────────────

  private _toggleGuiMode(): void {
    this._guiMode = !this._guiMode;
  }

  private _yamlChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const value = (ev.detail as { value: string }).value;
    this._yamlValue = value;
    try {
      const parsed = JSON.parse(value) as MosaicCardConfig;
      this._config = parsed;
      const event = new CustomEvent("config-changed", {
        detail: { config: parsed },
        bubbles: true,
        composed: true,
      });
      this.dispatchEvent(event);
    } catch {
      // Invalid JSON — don't fire config-changed; let user keep editing
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  protected render(): TemplateResult {
    if (!this._config) return html``;

    const mode = (this._get("mode") as string) ?? "auto";

    return html`
      <div class="header">
        <h3 class="title">Mosaic Card</h3>
        <ha-icon-button
          .label=${this._guiMode ? "Switch to YAML" : "Switch to GUI"}
          .path=${this._guiMode
            ? "M14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6Z"
            : "M3 5V3H21V5H3M3 19H21V21H3V19M13 9H3V15H13V9M21 9H15V11H21V9M21 13H15V15H21V13Z"}
          @click=${this._toggleGuiMode}
        ></ha-icon-button>
      </div>

      ${this._guiMode ? this._renderGui(mode) : this._renderYaml()}
    `;
  }

  private _renderYaml(): TemplateResult {
    return html`
      <ha-code-editor
        mode="yaml"
        .value=${this._yamlValue}
        @value-changed=${this._yamlChanged}
        autofocus
        autocomplete-entities
        autocomplete-icons
      ></ha-code-editor>
    `;
  }

  private _renderGui(mode: string): TemplateResult {
    return html`
      ${this._renderGridOptionsInfo()}
      ${this._renderModeAndGridSection(mode)}
      ${this._renderCardsSection()}
      ${this._renderAppearanceSection()}
    `;
  }

  // ── Section: Grid Options Info ──────────────────────────────────────────────

  private _renderGridOptionsInfo(): TemplateResult {
    const opts = this._config?.grid_options;
    if (!opts || (opts.columns === undefined && opts.rows === undefined)) return html``;

    const isFullWidth = opts.columns === "full";
    return html`
      <div class="info-banner ${isFullWidth ? "warning" : ""}">
        <div class="info-banner-title">
          <ha-icon icon="${isFullWidth ? "mdi:alert-outline" : "mdi:information-outline"}"></ha-icon>
          Card size in section view
        </div>
        <div class="info-banner-content">
          ${opts.columns !== undefined ? html`<span><strong>Columns:</strong> ${opts.columns}</span>` : nothing}
          ${opts.rows !== undefined ? html`<span><strong>Rows:</strong> ${opts.rows}</span>` : nothing}
        </div>
        ${isFullWidth
          ? html`<div class="info-banner-helper warning-text">
              ⚠️ "Full width" mode doesn't provide a numeric column count. Disable it in the Layout tab and set a specific column count for better control.
            </div>`
          : html`<div class="info-banner-helper">Set via the Layout tab above when this card is in a section view.</div>`}
      </div>
    `;
  }

  // ── Section: Mode + Grid ─────────────────────────────────────────────────────

  private _renderModeAndGridSection(mode: string): TemplateResult {
    return html`
      <div class="section">
        <div class="section-title">Layout</div>

        <div class="field">
          <label>Mode</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              select: {
                options: [
                  { value: "auto", label: "Auto" },
                  { value: "manual", label: "Manual" },
                ],
                mode: "list",
              },
            }}
            .value=${this._get("mode") ?? "auto"}
            .configValue=${"mode"}
            @value-changed=${this._valueChanged}
          ></ha-selector>
        </div>

        <div class="field">
          <label>Rows</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              number: {
                min: 1,
                max: 32,
                mode: "slider",
                step: 1,
              },
            }}
            .value=${this._getInternalGridRows()}
            @value-changed=${(e: CustomEvent) => this._rowsChanged(e)}
          ></ha-selector>
          <div class="helper-text">Number of rows in the mosaic grid</div>
        </div>

        <div class="field">
          <label>Column Gap (px)</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              number: {
                min: 0,
                max: 32,
                mode: "slider",
                step: 1,
                unit_of_measurement: "px",
              },
            }}
            .value=${this._get("column_gap") ?? 8}
            .configValue=${"column_gap"}
            @value-changed=${this._valueChanged}
          ></ha-selector>
        </div>

        <div class="field">
          <label>Row Gap (px)</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              number: {
                min: 0,
                max: 32,
                mode: "slider",
                step: 1,
                unit_of_measurement: "px",
              },
            }}
            .value=${this._get("row_gap") ?? 8}
            .configValue=${"row_gap"}
            @value-changed=${this._valueChanged}
          ></ha-selector>
        </div>

        ${mode === "auto"
          ? html`
              <div class="field">
                <label>Auto-flow Mode</label>
                <ha-selector
                  .hass=${this.hass}
                  .selector=${{
                    select: {
                      options: [
                        { value: "dense", label: "Dense" },
                        { value: "row", label: "Row" },
                        { value: "column", label: "Column" },
                      ],
                      mode: "list",
                    },
                  }}
                  .value=${this._get("auto_flow") ?? "dense"}
                  .configValue=${"auto_flow"}
                  @value-changed=${this._valueChanged}
                ></ha-selector>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  // ── Section: Cards ───────────────────────────────────────────────────────────

  private _renderCardsSection(): TemplateResult {
    const cards = (this._get("cards") as SubCardConfig[]) ?? [];
    const mode = (this._get("mode") as string) ?? "auto";
    const gridColumns = this._getInternalGridColumns();
    const gridRows = this._getInternalGridRows();
    const selected = Math.min(this._selectedCardIndex, cards.length - 1);
    const selectedCard = cards[selected];

    return html`
      <div class="section">
        <div class="section-title">Cards</div>

        <div class="card-list">
          ${cards.map((card, index) => this._renderCardRow(card, index, cards.length, index === selected))}
        </div>

        <div class="add-card">
          <hui-card-picker
            .hass=${this.hass}
            @config-changed=${this._pickCard}
          ></hui-card-picker>
        </div>

        ${selectedCard
          ? html`
              <div class="grid-picker-section">
                <div class="grid-picker-label">Grid layout for selected card</div>
                <mosaic-grid-size-picker
                  .mode=${mode as "auto" | "manual"}
                  .gridColumns=${gridColumns}
                  .gridRows=${gridRows}
                  .value=${(selectedCard.grid_options ?? {}) as GridSizeValue}
                  @value-changed=${(e: CustomEvent) => this._cardGridOptionsChanged(selected, e)}
                ></mosaic-grid-size-picker>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _cardGridOptionsChanged(index: number, e: CustomEvent): void {
    e.stopPropagation();
    const gridOptions = (e.detail as { value: GridSizeValue }).value;
    if (!this._config?.cards) return;
    const cards = [...this._config.cards];
    cards[index] = { ...cards[index], grid_options: gridOptions as CardGridOptions };
    this._fireConfigChanged({ ...this._config, cards });
  }

  private _renderCardRow(
    card: SubCardConfig,
    index: number,
    total: number,
    selected: boolean,
  ): TemplateResult {
    const cardType = card.type ?? "unknown";
    const displayName = cardType.replace(/^custom:/, "").replace(/-/g, " ");

    return html`
      <div
        class="card-row-container ${selected ? "selected" : ""}"
        @click=${() => { this._selectedCardIndex = index; }}
      >
        <div class="card-row">
          <div class="card-row-info">
            <div class="card-radio" aria-checked=${selected ? "true" : "false"}></div>
            <ha-icon icon="mdi:card-outline" class="card-icon"></ha-icon>
            <span class="card-name">${displayName}</span>
          </div>
          <div class="card-row-actions">
            <ha-icon-button
              .label=${"Move up"}
              .path=${"M7.41 15.41L12 10.83L16.59 15.41L18 14L12 8L6 14L7.41 15.41Z"}
              ?disabled=${index === 0}
              @click=${(e: Event) => { e.stopPropagation(); this._moveCard(index, -1); }}
            ></ha-icon-button>
            <ha-icon-button
              .label=${"Move down"}
              .path=${"M7.41 8.59L12 13.17L16.59 8.59L18 10L12 16L6 10L7.41 8.59Z"}
              ?disabled=${index === total - 1}
              @click=${(e: Event) => { e.stopPropagation(); this._moveCard(index, 1); }}
            ></ha-icon-button>
            <ha-icon-button
              .label=${"Delete card"}
              .path=${"M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"}
              @click=${(e: Event) => { e.stopPropagation(); this._deleteCard(index); }}
            ></ha-icon-button>
          </div>
        </div>
      </div>
    `;
  }

  // ── Section: Appearance ──────────────────────────────────────────────────────

  private _renderAppearanceSection(): TemplateResult {
    return html`
      <ha-expansion-panel
        .header=${"Appearance"}
        outlined
        class="appearance-section"
      >
        <div class="section-content">
          <div class="field">
            <label>Title</label>
            <ha-selector
              .hass=${this.hass}
              .selector=${{ text: { type: "text" } }}
              .value=${this._get("title") ?? ""}
              .configValue=${"title"}
              @value-changed=${this._valueChanged}
            ></ha-selector>
          </div>

          <div class="field">
            <label>Strip card borders</label>
            <ha-selector
              .hass=${this.hass}
              .selector=${{ boolean: {} }}
              .value=${this._get("strip_borders") ?? true}
              .configValue=${"strip_borders"}
              @value-changed=${this._valueChanged}
            ></ha-selector>
          </div>
        </div>
      </ha-expansion-panel>
    `;
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 0 8px;
      }

      .title {
        margin: 0;
        font-size: var(--mdc-typography-headline6-font-size, 1.25rem);
        font-weight: var(--mdc-typography-headline6-font-weight, 500);
      }

      .section {
        margin-bottom: 16px;
      }

      .section-title {
        font-size: var(--mdc-typography-subtitle1-font-size, 1rem);
        font-weight: 500;
        color: var(--primary-text-color);
        margin: 8px 0;
        padding-bottom: 4px;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
      }

      .field {
        margin-bottom: 12px;
      }

      .field label {
        display: block;
        font-size: 0.875rem;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }

      .helper-text {
        font-size: 0.75rem;
        color: var(--secondary-text-color);
        margin-top: 2px;
      }

      .card-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
      }

      .card-row-container {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: var(--card-background-color, #fff);
        overflow: hidden;
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
      }

      .card-row-container.selected {
        border-color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color, #fff));
      }

      .card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
      }

      .card-radio {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        border: 2px solid var(--divider-color, #bbb);
        flex-shrink: 0;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }

      .card-row-container.selected .card-radio {
        border-color: var(--primary-color);
        border-width: 5px;
      }

      .grid-picker-section {
        margin-top: 12px;
        padding: 12px;
        border: 1px solid var(--primary-color);
        border-radius: 4px;
        background: color-mix(in srgb, var(--primary-color) 5%, var(--card-background-color, #fff));
      }

      .grid-picker-label {
        font-size: 0.75rem;
        color: var(--primary-color);
        font-weight: 500;
        margin-bottom: 8px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .card-row-info {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 1;
        min-width: 0;
      }

      .card-icon {
        --mdc-icon-size: 20px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

      .card-name {
        font-size: 0.875rem;
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .card-row-actions {
        display: flex;
        align-items: center;
        gap: 0;
        flex-shrink: 0;
      }

      .card-row-actions ha-icon-button {
        --mdc-icon-button-size: 32px;
        --mdc-icon-size: 18px;
      }

      .add-card {
        margin-top: 8px;
      }

      .appearance-section {
        margin-bottom: 16px;
      }

      .section-content {
        padding: 8px 0;
      }

      ha-code-editor {
        display: block;
        border-radius: 4px;
        overflow: hidden;
      }

      .info-banner {
        background: color-mix(in srgb, var(--info-color, #03a9f4) 15%, transparent);
        border: 1px solid var(--info-color, #03a9f4);
        border-radius: 4px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .info-banner.warning {
        background: color-mix(in srgb, var(--warning-color, #ff9800) 15%, transparent);
        border: 1px solid var(--warning-color, #ff9800);
      }

      .info-banner-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 500;
        color: var(--primary-text-color);
        margin-bottom: 8px;
      }

      .info-banner-title ha-icon {
        --mdc-icon-size: 20px;
        color: var(--info-color, #03a9f4);
      }

      .info-banner.warning .info-banner-title ha-icon {
        color: var(--warning-color, #ff9800);
      }

      .info-banner-content {
        display: flex;
        gap: 16px;
        font-size: 0.875rem;
        margin-bottom: 4px;
      }

      .info-banner-helper {
        font-size: 0.75rem;
        color: var(--secondary-text-color);
        margin-top: 4px;
      }

      .info-banner-helper.warning-text {
        font-size: 0.8125rem;
        line-height: 1.4;
      }
    `;
  }
}

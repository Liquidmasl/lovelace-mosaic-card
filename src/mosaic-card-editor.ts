import { LitElement, html, css, CSSResultGroup, TemplateResult, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref, Ref } from "lit/directives/ref.js";
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
  no_border?: boolean;
  no_background?: boolean;
  custom_css?: string;
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
  @property({ attribute: false }) public lovelace?: unknown;
  @property({ attribute: false }) public sectionConfig?: LovelaceSectionConfig;

  @state() private _config?: MosaicCardConfig;
  @state() private _guiMode = true;
  @state() private _yamlValue = "";
  @state() private _selectedCardIndex = 0;
  @state() private _cardsEditorReady = false;

  private _previewRef: Ref<HTMLElement & { setConfig(c: unknown): void; hass: unknown }> = createRef();
  private _previewContainerRef: Ref<HTMLElement> = createRef();
  private _stackEditorContainerRef: Ref<HTMLElement> = createRef();
  private _stackEditor?: HTMLElement & { setConfig(c: unknown): void; hass?: unknown; lovelace?: unknown };
  private _lastEditorCards = "[]";
  private _resizeObserver?: ResizeObserver;
  @state() private _previewScale = 1;

  // ── Preview scaling ──────────────────────────────────────────────────────────

  // Each column is 24px wide (HA section view column width).
  private _naturalPreviewWidth(): number {
    const colGap = this._config?.column_gap ?? 8;
    const cols = this._getInternalGridColumns();
    return cols * 24 + (cols - 1) * colGap;
  }

  private _updatePreviewScale(): void {
    const container = this._previewContainerRef.value;
    if (!container) return;
    this._previewScale = Math.min(1, container.clientWidth / this._naturalPreviewWidth());
  }

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver(() => this._updatePreviewScale());
    // Re-initialize preview after DOM is ready. This handles both the initial mount
    // and reconnects after the user switches away from the Config tab and back —
    // in that case _config may have changed while the editor was out of the DOM,
    // and updated() won't re-fire because _config didn't change on reconnect.
    this.updateComplete.then(async () => {
      const container = this._previewContainerRef.value;
      if (container) {
        this._resizeObserver?.observe(container);
        this._updatePreviewScale();
      }
      const preview = this._previewRef.value;
      if (preview && this._config) {
        preview.setConfig(this._config);
        if (this.hass) preview.hass = this.hass;
      }
      // Load the vertical-stack card editor (same pattern as nested-lovelace-card).
      // We use the full stack editor element — it contains hui-cards-editor internally
      // and handles lovelace/hass forwarding to the card picker automatically.
      if (!this._stackEditor) {
        type VStackClass = { getConfigElement?(): Promise<HTMLElement & { setConfig(c: unknown): void; hass?: unknown; lovelace?: unknown }> };
        let cls = customElements.get("hui-vertical-stack-card") as VStackClass | undefined;
        if (!cls) {
          const helpers = await (window as unknown as { loadCardHelpers?(): Promise<{ createCardElement(c: Record<string, unknown>): unknown }> }).loadCardHelpers?.();
          if (helpers) {
            helpers.createCardElement({ type: "vertical-stack", cards: [] });
            await customElements.whenDefined("hui-vertical-stack-card");
            cls = customElements.get("hui-vertical-stack-card") as VStackClass | undefined;
          }
        }
        if (cls?.getConfigElement) {
          const editor = await cls.getConfigElement();
          editor.addEventListener("config-changed", (ev: Event) => {
            const custom = ev as CustomEvent;
            const cfg = (custom.detail as { config?: { type?: string; cards?: SubCardConfig[] } }).config;
            if (cfg?.type !== "custom:mosaic-card") return;
            custom.stopPropagation();
            const newCards = cfg.cards ?? [];
            const existingCards = this._config?.cards ?? [];
            const merged = newCards.map((nc, i) => {
              const g = existingCards[i]?.grid_options;
              return g ? { ...nc, grid_options: g } : nc;
            });
            this._lastEditorCards = JSON.stringify(newCards);
            this._fireConfigChanged({ ...this._config!, cards: merged });
          });
          this._stackEditor = editor;
          if (this.hass) this._stackEditor.hass = this.hass;
          if (this.lovelace) this._stackEditor.lovelace = this.lovelace;
          const cardsToSend = (this._config?.cards ?? []).map(({ grid_options: _g, ...rest }) => rest);
          this._lastEditorCards = JSON.stringify(cardsToSend);
          this._stackEditor.setConfig({ type: "custom:mosaic-card", cards: cardsToSend });
          this._cardsEditorReady = true;
          await this.updateComplete;
          const stackContainer = this._stackEditorContainerRef.value;
          if (stackContainer) stackContainer.appendChild(this._stackEditor);
        }
      } else {
        // Reconnect after tab switch: re-insert and sync state.
        if (this.hass) this._stackEditor.hass = this.hass;
        if (this.lovelace) this._stackEditor.lovelace = this.lovelace;
        const cardsToSend = (this._config?.cards ?? []).map(({ grid_options: _g, ...rest }) => rest);
        this._stackEditor.setConfig({ type: "custom:mosaic-card", cards: cardsToSend });
        await this.updateComplete;
        const stackContainer = this._stackEditorContainerRef.value;
        if (stackContainer && !stackContainer.contains(this._stackEditor)) {
          stackContainer.appendChild(this._stackEditor);
        }
      }
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
  }

  protected firstUpdated(): void {
    // firstUpdated only fires once — connectedCallback.updateComplete handles subsequent mounts.
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    if (changedProps.has("_config") && this._config) {
      // If column count shrank, clamp sub-cards that now extend outside the grid.
      const prevConfig = changedProps.get("_config") as MosaicCardConfig | undefined;
      const prevCols = prevConfig ? this._getGridColumnsFrom(prevConfig) : undefined;
      const newCols = this._getInternalGridColumns();
      if (prevCols !== undefined && newCols < prevCols) {
        this._clampCardsToColumns(newCols);
        // Don't return — still update preview and scale with the current config now.
      }

      const preview = this._previewRef.value;
      if (preview) {
        preview.setConfig(this._config);
      }
      // naturalWidth is a pure calculation so update scale immediately,
      // then again after layout to catch any container dimension changes.
      this._updatePreviewScale();
      requestAnimationFrame(() => this._updatePreviewScale());
    }

    if (changedProps.has("hass") && this.hass) {
      const preview = this._previewRef.value;
      if (preview) preview.hass = this.hass;
      if (this._stackEditor) this._stackEditor.hass = this.hass;
    }

    if (changedProps.has("lovelace") && this._stackEditor) {
      this._stackEditor.lovelace = this.lovelace;
    }

    if (changedProps.has("_config") && this._config && this._stackEditor) {
      const cardsToSend = (this._config.cards ?? []).map(({ grid_options: _g, ...rest }) => rest);
      const json = JSON.stringify(cardsToSend);
      if (json !== this._lastEditorCards) {
        this._lastEditorCards = json;
        this._stackEditor.setConfig({ type: "custom:mosaic-card", cards: cardsToSend });
      }
    }
  }

  private _getGridColumnsFrom(config: MosaicCardConfig): number {
    const c = config.grid_options?.columns;
    if (typeof c === "number") return c;
    return config.columns ?? 12;
  }

  private _clampCardsToColumns(newCols: number): void {
    if (!this._config) return;
    const cards = (this._config.cards ?? []).map((card) => {
      const g = card.grid_options as CardGridOptions | undefined;
      if (!g) return card;
      const colStart = Math.max(1, g.column_start ?? 1);
      const colSpan = Math.max(1, g.columns ?? 1);
      const clampedStart = Math.min(colStart, newCols);
      const clampedSpan = Math.min(colSpan, newCols - clampedStart + 1);
      if (clampedStart === colStart && clampedSpan === colSpan) return card;
      return { ...card, grid_options: { ...g, column_start: clampedStart, columns: clampedSpan } };
    });
    this._fireConfigChanged({ ...this._config, cards });
  }

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
    const newRows = (ev.detail as { value: number }).value;

    // Clamp all sub-cards so none extend beyond the new row count.
    const cards = (this._config?.cards ?? []).map((card) => {
      const g = card.grid_options as CardGridOptions | undefined;
      if (!g) return card;
      const rowStart = Math.max(1, g.row_start ?? 1);
      const rowSpan = Math.max(1, g.rows ?? 1);
      const clampedStart = Math.min(rowStart, newRows);
      const clampedSpan = Math.min(rowSpan, newRows - clampedStart + 1);
      if (clampedStart === rowStart && clampedSpan === rowSpan) return card;
      return { ...card, grid_options: { ...g, row_start: clampedStart, rows: clampedSpan } };
    });

    this._fireConfigChanged({
      ...this._config!,
      cards,
      grid_options: { ...this._config?.grid_options, rows: newRows },
    });
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
    const cards = (this._get("cards") as SubCardConfig[]) ?? [];
    const gridColumns = this._getInternalGridColumns();
    const gridRows = this._getInternalGridRows();
    const selected = Math.min(this._selectedCardIndex, cards.length - 1);
    const selectedCard = cards[selected];
    const naturalWidth = this._naturalPreviewWidth();
    const scale = this._previewScale;

    return html`
      <div class="preview-area">
        <div class="card-sidebar">
          ${cards.map((card, i) => this._renderSidebarItem(card, i, i === selected))}
        </div>
        <div class="preview-container" style="max-width: ${naturalWidth}px" ${ref(this._previewContainerRef)}>
          <mosaic-card
            ${ref(this._previewRef)}
            style="width: ${naturalWidth}px; zoom: ${scale};"
          ></mosaic-card>
          ${selectedCard ? html`
            <mosaic-grid-size-picker
              overlay
              .mode=${mode as "auto" | "manual"}
              .gridColumns=${gridColumns}
              .gridRows=${gridRows}
              .value=${(selectedCard.grid_options ?? {}) as GridSizeValue}
              @value-changed=${(e: CustomEvent) => {
                const gridOptions = (e.detail as { value: GridSizeValue }).value;
                const updated = [...cards];
                updated[selected] = { ...updated[selected], grid_options: gridOptions as CardGridOptions };
                this._fireConfigChanged({ ...this._config!, cards: updated });
              }}
            ></mosaic-grid-size-picker>
          ` : nothing}
        </div>
      </div>
      ${this._renderSelectedCardSettings()}
      ${this._renderGridOptionsInfo()}
      ${this._renderModeAndGridSection(mode)}
      ${this._renderCardsEditor()}
    `;
  }

  private _renderSidebarItem(card: SubCardConfig, index: number, selected: boolean): TemplateResult {
    const displayName = (card.type ?? "unknown").replace(/^custom:/, "").replace(/-/g, " ");
    return html`
      <div class="sidebar-item ${selected ? "selected" : ""}" @click=${() => { this._selectedCardIndex = index; }}>
        <div class="sidebar-item-main">
          <div class="card-radio" aria-checked=${selected ? "true" : "false"}></div>
          <span class="sidebar-item-name">${displayName}</span>
        </div>
      </div>
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

  // ── Section: Selected card settings ─────────────────────────────────────────

  private _renderSelectedCardSettings(): TemplateResult {
    const cards = (this._get("cards") as SubCardConfig[]) ?? [];
    if (!cards.length) return html``;
    const selected = Math.min(this._selectedCardIndex, cards.length - 1);
    const selectedCard = cards[selected];
    if (!selectedCard) return html``;
    const g = (selectedCard.grid_options ?? {}) as CardGridOptions;

    return html`
      <div class="section">
        <div class="section-title">Selected card</div>
        <div class="field inline-field">
          <label>Remove border</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ boolean: {} }}
            .value=${g.no_border ?? false}
            @value-changed=${(e: CustomEvent) => this._setCardGridOption(selected, "no_border", (e.detail as { value: boolean }).value)}
          ></ha-selector>
        </div>
        <div class="field inline-field">
          <label>Remove background</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ boolean: {} }}
            .value=${g.no_background ?? false}
            @value-changed=${(e: CustomEvent) => this._setCardGridOption(selected, "no_background", (e.detail as { value: boolean }).value)}
          ></ha-selector>
        </div>
        <div class="field">
          <label>Custom CSS</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{ text: { type: "text" } }}
            .value=${g.custom_css ?? ""}
            @value-changed=${(e: CustomEvent) => this._setCardGridOption(selected, "custom_css", (e.detail as { value: string }).value)}
          ></ha-selector>
          <div class="helper-text">CSS declarations on the card wrapper (e.g. <code>opacity: 0.7</code>)</div>
        </div>
      </div>
    `;
  }

  private _setCardGridOption(index: number, key: string, value: unknown): void {
    if (!this._config?.cards) return;
    const cards = [...this._config.cards];
    const g = { ...(cards[index].grid_options ?? {}), [key]: value } as CardGridOptions;
    if (value === false || value === "") delete (g as Record<string, unknown>)[key];
    cards[index] = { ...cards[index], grid_options: g };
    this._fireConfigChanged({ ...this._config, cards });
  }

  // ── Section: Cards editor ────────────────────────────────────────────────────

  private _renderCardsEditor(): TemplateResult {
    if (!this._cardsEditorReady) return html``;
    return html`
      <div class="section">
        <div class="section-title">Cards</div>
        <div ${ref(this._stackEditorContainerRef)}></div>
      </div>
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

      /* ── Preview area: sidebar + preview side by side ── */

      .preview-area {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-bottom: 16px;
      }

      .card-sidebar {
        width: 120px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .sidebar-item {
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: var(--card-background-color, #fff);
        cursor: pointer;
        transition: border-color 0.15s, background 0.15s;
        overflow: hidden;
      }

      .sidebar-item.selected {
        border-color: var(--primary-color);
        background: color-mix(in srgb, var(--primary-color) 8%, var(--card-background-color, #fff));
      }

      .sidebar-item-main {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 5px 6px;
      }

      .sidebar-item-name {
        font-size: 0.75rem;
        text-transform: capitalize;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        flex: 1;
        min-width: 0;
      }

      .card-radio {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        border: 2px solid var(--divider-color, #bbb);
        flex-shrink: 0;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }

      .sidebar-item.selected .card-radio {
        border-color: var(--primary-color);
        border-width: 4px;
      }

      /* ── Preview container ── */

      .inline-field {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .inline-field label {
        margin-bottom: 0;
      }

      .preview-container {
        position: relative;
        flex: 1;
        min-width: 0;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        overflow: hidden;
        background: var(--secondary-background-color, #f5f5f5);
      }

      .preview-container mosaic-card {
        pointer-events: none;
        display: block;
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

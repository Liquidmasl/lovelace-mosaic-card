import { LitElement, html, css, CSSResultGroup, TemplateResult, nothing, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { createRef, ref, Ref } from "lit/directives/ref.js";
import { keyed } from "lit/directives/keyed.js";
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
  /** Visibility conditions in HA's native card format — evaluated by hui-card. */
  visibility?: unknown[];
  [key: string]: unknown;
}

/**
 * Grid footprint given to a freshly picked card. Without it _resolveGridOptions
 * falls back to 2×1, which lands new cards as unreadable slivers.
 */
function defaultGridOptions(mode: string): CardGridOptions {
  const base: CardGridOptions = { columns: 4, rows: 2 };
  return mode === "manual" ? { ...base, column_start: 1, row_start: 1 } : base;
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
  row_subdivision?: 1 | 2 | 4;
  title?: string;
  strip_borders?: boolean;
  background?: boolean;
  background_padding?: number;
  background_css?: string;
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

/** Depth-first search for a selector across open shadow roots. */
function findInShadow(root: ParentNode, selector: string, depth = 0): Element | undefined {
  if (depth > 12) return undefined;
  const direct = root.querySelector(selector);
  if (direct) return direct;
  for (const el of root.querySelectorAll("*")) {
    const sr = (el as HTMLElement).shadowRoot;
    if (sr) {
      const found = findInShadow(sr, selector, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
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

const MDI = {
  up: "M7.41,15.41L12,10.83L16.59,15.41L18,14L12,8L6,14L7.41,15.41Z",
  down: "M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z",
  duplicate:
    "M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z",
  delete:
    "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
  code: "M14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6Z",
} as const;

declare global {
  interface Window {
    loadCardHelpers?(): Promise<{
      createCardElement(config: Record<string, unknown>): HTMLElement;
    }>;
  }
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
  /** Card picker replaces the card editor while adding. */
  @state() private _addingCard = false;
  @state() private _cardEditorReady = false;
  @state() private _pickerReady = false;
  /** GUI/YAML state of the embedded per-card editor, mirroring HA's stack editor. */
  @state() private _cardGuiMode = true;
  @state() private _cardGuiModeAvailable = true;
  /** Layout is collapsed by default — it's set once, then rarely touched. */
  @state() private _layoutExpanded = false;
  /**
   * When false (default) the preview runs in HA's preview mode: visibility
   * conditions are ignored so every card stays visible and positionable.
   * Toggling it on evaluates conditions live, showing the real current state.
   */
  @state() private _liveVisibility = false;

  private _previewRef: Ref<HTMLElement & { setConfig(c: unknown): void; hass: unknown }> = createRef();
  private _previewContainerRef: Ref<HTMLElement> = createRef();
  private _resizeObserver?: ResizeObserver;
  /**
   * Stable per-(index, length) keys for keyed() around hui-card-element-editor.
   * Without recreating that element on selection change it keeps the previously
   * selected card's internal state (config element, GUI/YAML mode, errors).
   */
  private _editorKeys = new Map<string, string>();
  private _pickerLoading = false;
  @state() private _previewScale = 1;

  // ── Preview scaling ──────────────────────────────────────────────────────────

  private _liveSection?: Element;

  /**
   * Width the card actually has on the dashboard: live section width × the
   * card's HA column span / 12. The dashboard stays rendered behind the edit
   * dialog, so a hui-grid-section is normally there to measure. Falls back to
   * 400px (typical section width) when none is found (e.g. masonry views).
   */
  private _naturalPreviewWidth(): number {
    if (!this._liveSection?.isConnected) {
      this._liveSection = findInShadow(document, "hui-grid-section");
    }
    const sectionW = this._liveSection?.getBoundingClientRect().width || 400;
    const haCols = this._config?.grid_options?.columns;
    const span = typeof haCols === "number" ? Math.min(12, Math.max(1, haCols)) : 12;
    return Math.round(sectionW * (span / 12));
  }

  private _updatePreviewScale(): void {
    const container = this._previewContainerRef.value;
    if (!container) return;
    this._previewScale = Math.min(1, container.clientWidth / this._naturalPreviewWidth());
    // The natural width follows the live section, which can resize without the
    // container changing (viewport resize, sidebar toggle) — watch it too.
    const section = this._liveSection;
    if (section && section !== this._observedSection && this._resizeObserver) {
      if (this._observedSection) this._resizeObserver.unobserve(this._observedSection);
      this._resizeObserver.observe(section);
      this._observedSection = section;
    }
  }

  private _observedContainer?: Element;
  private _observedSection?: Element;

  /**
   * Attach the ResizeObserver to the current preview container. The container
   * ref can still be null when connectedCallback's updateComplete resolves
   * (dialog lays out lazily), so this is re-checked on every updated() —
   * observe() also fires the callback once, which self-corrects a stale scale.
   */
  private _ensureContainerObserved(): void {
    const container = this._previewContainerRef.value;
    if (!container || this._observedContainer === container) return;
    this._resizeObserver ??= new ResizeObserver(() => this._updatePreviewScale());
    if (this._observedContainer) this._resizeObserver.unobserve(this._observedContainer);
    this._resizeObserver.observe(container);
    this._observedContainer = container;
  }

  /**
   * hui-card-element-editor ships in the same chunk as hui-dialog-edit-card,
   * and this editor only ever renders inside that dialog — so it is already
   * defined and this never actually waits.
   */
  private _ensureCardEditor(): void {
    if (this._cardEditorReady) return;
    if (customElements.get("hui-card-element-editor")) {
      this._cardEditorReady = true;
      return;
    }
    customElements.whenDefined("hui-card-element-editor").then(() => {
      this._cardEditorReady = true;
    });
  }

  /**
   * hui-card-picker is NOT in the edit-card chunk — it ships with the *create*
   * card dialog, so it is normally undefined here and whenDefined() alone would
   * wait forever. hui-stack-card-editor imports it, so instantiating the
   * vertical-stack config element pulls the chunk in; the element itself is
   * discarded, we only want the side effect of its imports being evaluated.
   * Deferred until the picker is actually needed so we don't pay for it on open.
   */
  private async _ensureCardPicker(): Promise<void> {
    if (this._pickerReady || this._pickerLoading) return;
    if (customElements.get("hui-card-picker")) {
      this._pickerReady = true;
      return;
    }
    this._pickerLoading = true;
    try {
      type StackClass = { getConfigElement?(): Promise<HTMLElement> };
      let cls = customElements.get("hui-vertical-stack-card") as StackClass | undefined;
      if (!cls) {
        const helpers = await window.loadCardHelpers?.();
        helpers?.createCardElement({ type: "vertical-stack", cards: [] });
        await customElements.whenDefined("hui-vertical-stack-card");
        cls = customElements.get("hui-vertical-stack-card") as StackClass | undefined;
      }
      await cls?.getConfigElement?.();
      await customElements.whenDefined("hui-card-picker");
      this._pickerReady = true;
    } finally {
      this._pickerLoading = false;
    }
  }

  // ── HA lifecycle ────────────────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    // Re-initialize preview after DOM is ready. This handles both the initial mount
    // and reconnects after the user switches away from the Config tab and back —
    // in that case _config may have changed while the editor was out of the DOM,
    // and updated() won't re-fire because _config didn't change on reconnect.
    this.updateComplete.then(() => {
      this._ensureContainerObserved();
      this._updatePreviewScale();
      this._ensureCardEditor();
      if (!this._cards.length) this._ensureCardPicker();
      const preview = this._previewRef.value;
      if (preview && this._config) {
        preview.setConfig(this._config);
        if (this.hass) preview.hass = this.hass;
      }
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this._resizeObserver?.disconnect();
    this._resizeObserver = undefined;
    this._observedContainer = undefined;
    this._observedSection = undefined;
  }

  protected firstUpdated(): void {
    // firstUpdated only fires once — connectedCallback.updateComplete handles subsequent mounts.
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);

    this._ensureContainerObserved();

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
    // Fallback must match mosaic-card's own default (8) or the picker overlay
    // and the preview underneath it disagree about row geometry.
    return this._config?.rows ?? 8;
  }

  private _getRowSubdivision(): number {
    const sub = this._config?.row_subdivision;
    return sub === 2 || sub === 4 ? sub : 1;
  }

  private _subdivisionChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const sub = Number((ev.detail as { value: string }).value);
    this._fireConfigChanged({
      ...this._config!,
      row_subdivision: (sub === 2 || sub === 4 ? sub : 1) as 1 | 2 | 4,
    });
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
      ${this._renderModeAndGridSection(mode)}
      <div class="group">
      ${this._renderVisibilityToggle(cards)}
      <div class="preview-area">
        <div class="card-sidebar">
          ${cards.map((card, i) => this._renderSidebarItem(card, i, i === selected && !this._addingCard))}
          <button
            class="sidebar-add ${this._addingCard ? "selected" : ""}"
            @click=${() => { this._addingCard = true; this._ensureCardPicker(); }}
          >
            + Add card
          </button>
        </div>
        <div class="preview-container" style="max-width: ${naturalWidth}px" ${ref(this._previewContainerRef)}>
          <mosaic-card
            inert
            ${ref(this._previewRef)}
            .preview=${!this._liveVisibility}
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
      </div>
      <div class="group">${this._renderCardsEditor()}</div>
    `;
  }

  /**
   * Only offered once at least one card has conditions — otherwise the toggle
   * would do nothing visible.
   */
  private _renderVisibilityToggle(cards: SubCardConfig[]): TemplateResult {
    if (!cards.some((c) => c.visibility?.length)) return html``;
    return html`
      <div class="preview-toolbar">
        <ha-formfield label="Preview current visibility">
          <ha-switch
            .checked=${this._liveVisibility}
            @change=${(e: Event) => {
              this._liveVisibility = (e.target as HTMLInputElement).checked;
            }}
          ></ha-switch>
        </ha-formfield>
        <span class="helper-text">
          ${this._liveVisibility
            ? "Cards whose conditions are not met are hidden, as on the dashboard."
            : "All cards shown regardless of their conditions."}
        </span>
      </div>
    `;
  }

  /**
   * Plain button rather than ha-icon-button: that element lays its inner button
   * out at a fixed 48px regardless of --mdc-icon-button-size, which overflows
   * the sidebar column and gets clipped. Sizing our own is simpler than
   * fighting it.
   */
  private _renderCardAction(
    label: string,
    path: string,
    disabled: boolean,
    onClick: () => void,
  ): TemplateResult {
    return html`
      <button
        class="card-action"
        title=${label}
        aria-label=${label}
        ?disabled=${disabled}
        @click=${onClick}
      >
        <ha-svg-icon .path=${path}></ha-svg-icon>
      </button>
    `;
  }

  private _cardDisplayName(card?: SubCardConfig): string {
    return (card?.type ?? "unknown").replace(/^custom:/, "").replace(/-/g, " ");
  }

  /**
   * Reordering and removing are operations on the card *list*, so they live on
   * the list — the sidebar — rather than in the card's settings panel. Shown
   * only on the selected item to keep the 120px column readable.
   */
  private _renderSidebarItem(card: SubCardConfig, index: number, selected: boolean): TemplateResult {
    const count = this._cards.length;
    return html`
      <div class="sidebar-item ${selected ? "selected" : ""}" @click=${() => this._selectCard(index)}>
        <div class="sidebar-item-main">
          <div class="card-radio" aria-checked=${selected ? "true" : "false"}></div>
          <span class="sidebar-item-name">${this._cardDisplayName(card)}</span>
          ${card.visibility?.length
            ? html`<ha-icon
                class="sidebar-item-badge"
                icon="mdi:eye-off-outline"
                title="Has visibility conditions"
              ></ha-icon>`
            : nothing}
        </div>
        ${selected
          ? html`
              <div class="sidebar-item-actions" @click=${(e: Event) => e.stopPropagation()}>
                ${this._renderCardAction("Move up", MDI.up, index === 0, () =>
                  this._moveCard(index, index - 1),
                )}
                ${this._renderCardAction("Move down", MDI.down, index === count - 1, () =>
                  this._moveCard(index, index + 1),
                )}
                ${this._renderCardAction("Duplicate", MDI.duplicate, false, () =>
                  this._duplicateCard(index),
                )}
                ${this._renderCardAction("Delete", MDI.delete, false, () =>
                  this._deleteCard(index),
                )}
              </div>
            `
          : nothing}
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
      <ha-expansion-panel
        outlined
        .header=${"Layout"}
        .secondary=${this._layoutSummary(mode)}
        .expanded=${this._layoutExpanded}
        @expanded-changed=${(e: CustomEvent) => {
          this._layoutExpanded = (e.detail as { expanded: boolean }).expanded;
        }}
      >
        <div class="section layout-section">
          ${this._renderGridOptionsInfo()}
          ${this._renderBackgroundFields()}

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
                max: 32 * this._getRowSubdivision(),
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
          <label>Row subdivision</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              select: {
                options: [
                  { value: "1", label: "1× (56 px rows)" },
                  { value: "2", label: "2× (28 px rows)" },
                  { value: "4", label: "4× (14 px rows)" },
                ],
                mode: "list",
              },
            }}
            .value=${String(this._getRowSubdivision())}
            @value-changed=${(e: CustomEvent) => this._subdivisionChanged(e)}
          ></ha-selector>
          <div class="helper-text">Splits the standard row into finer units for more precise vertical sizing</div>
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
      </ha-expansion-panel>
    `;
  }

  /**
   * Renders the grid inside an ha-card. The declarations from the CSS field go
   * inline on that ha-card, which beats the `:host` rule supplying the theme
   * defaults — so an empty field means "look like a normal themed card", and a
   * filled one overrides exactly what it mentions.
   */
  private _renderBackgroundFields(): TemplateResult {
    const on = this._get("background") === true;
    return html`
      <div class="field inline-field">
        <label>Background</label>
        <ha-switch
          .checked=${on}
          @change=${(e: Event) =>
            this._setValue("background", (e.target as HTMLInputElement).checked || undefined)}
        ></ha-switch>
      </div>
      <div class="helper-text spaced">
        Draws the mosaic on a real card, so it no longer needs to be nested in
        another card to have a background.
      </div>
      ${on
        ? html`
            <div class="field">
              <label>Padding (px)</label>
              <ha-selector
                .hass=${this.hass}
                .selector=${{ number: { min: 0, max: 48, mode: "slider", step: 1, unit_of_measurement: "px" } }}
                .value=${this._get("background_padding") ?? 0}
                .configValue=${"background_padding"}
                @value-changed=${this._valueChanged}
              ></ha-selector>
            </div>
            <div class="field">
              <label>Background CSS</label>
              <ha-selector
                .hass=${this.hass}
                .selector=${{ text: { type: "text", multiline: true } }}
                .value=${this._get("background_css") ?? ""}
                @value-changed=${(e: CustomEvent) =>
                  this._setValue("background_css", (e.detail as { value: string }).value || undefined)}
              ></ha-selector>
              <div class="helper-text">
                CSS declarations applied to the card, e.g.
                <code>border-radius: 20px; background: linear-gradient(...)</code>.
                Leave empty to use the theme's card style.
              </div>
            </div>
          `
        : nothing}
    `;
  }

  private _setValue(key: string, value: unknown): void {
    if (!this._config) return;
    const config: Record<string, unknown> = { ...this._config };
    if (value === undefined) delete config[key];
    else config[key] = value;
    this._fireConfigChanged(config as unknown as MosaicCardConfig);
  }

  /** One-line summary so the collapsed Layout panel still says something useful. */
  private _layoutSummary(mode: string): string {
    const cols = this._getInternalGridColumns();
    const rows = this._getInternalGridRows();
    const sub = this._getRowSubdivision();
    const parts = [
      mode === "auto" ? "Auto" : "Manual",
      `${cols}×${rows}`,
    ];
    if (sub !== 1) parts.push(`${sub}× rows`);
    return parts.join(" · ");
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
      <div class="card-quick-settings">
        <ha-formfield label="Remove border">
          <ha-switch
            .checked=${g.no_border ?? false}
            @change=${(e: Event) =>
              this._setCardGridOption(selected, "no_border", (e.target as HTMLInputElement).checked)}
          ></ha-switch>
        </ha-formfield>
        <ha-formfield label="Remove background">
          <ha-switch
            .checked=${g.no_background ?? false}
            @change=${(e: Event) =>
              this._setCardGridOption(selected, "no_background", (e.target as HTMLInputElement).checked)}
          ></ha-switch>
        </ha-formfield>
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
    `;
  }

  // ── Card list mutations ─────────────────────────────────────────────────────

  private get _cards(): SubCardConfig[] {
    return this._config?.cards ?? [];
  }

  private _commitCards(cards: SubCardConfig[]): void {
    this._fireConfigChanged({ ...this._config!, cards });
  }

  private _handleCardPicked(ev: CustomEvent): void {
    ev.stopPropagation();
    const picked = (ev.detail as { config: SubCardConfig }).config;
    const mode = (this._get("mode") as string) ?? "auto";
    const cards = [
      ...this._cards,
      { ...picked, grid_options: defaultGridOptions(mode) },
    ];
    this._addingCard = false;
    this._selectedCardIndex = cards.length - 1;
    this._cardGuiMode = true;
    this._cardGuiModeAvailable = true;
    this._commitCards(cards);
  }

  /**
   * Reorder carries the whole card object, so grid_options and visibility move
   * with the card rather than staying bound to the slot.
   */
  private _moveCard(from: number, to: number): void {
    const cards = [...this._cards];
    if (to < 0 || to >= cards.length) return;
    const [moved] = cards.splice(from, 1);
    cards.splice(to, 0, moved);
    this._selectedCardIndex = to;
    this._commitCards(cards);
  }

  private _duplicateCard(index: number): void {
    const cards = [...this._cards];
    cards.splice(index + 1, 0, structuredClone(cards[index]));
    this._selectedCardIndex = index + 1;
    this._commitCards(cards);
  }

  private _deleteCard(index: number): void {
    const cards = this._cards.filter((_, i) => i !== index);
    this._selectedCardIndex = Math.max(0, Math.min(index, cards.length - 1));
    this._commitCards(cards);
  }

  private _selectCard(index: number): void {
    if (this._selectedCardIndex === index && !this._addingCard) return;
    this._selectedCardIndex = index;
    this._addingCard = false;
    // A fresh editor element starts in GUI mode; keep our toolbar in sync.
    this._cardGuiMode = true;
    this._cardGuiModeAvailable = true;
  }

  /**
   * Keys must be stable per (index, length) so the editor is recreated when the
   * selection or the list shape changes, but not on every keystroke.
   */
  private _editorKey(index: number, length: number): string {
    const id = `${index}-${length}`;
    if (!this._editorKeys.has(id)) {
      this._editorKeys.set(id, Math.random().toString(36).slice(2));
    }
    return this._editorKeys.get(id)!;
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

  /**
   * The card editor, composed from the same two HA elements that HA's own stack
   * editor uses — hui-card-picker to add, hui-card-element-editor to edit —
   * but driven by the sidebar selection that also drives the position grid, so
   * there is a single card list instead of two competing ones.
   *
   * sectionConfig is deliberately NOT passed to the element editor: that would
   * add HA's Layout tab, which edits grid_options against a section grid and
   * would fight our own position picker.
   */
  private _renderCardsEditor(): TemplateResult {
    const cards = this._cards;
    const selected = Math.min(this._selectedCardIndex, cards.length - 1);
    const showPicker = this._addingCard || !cards.length;
    if (!showPicker && !this._cardEditorReady) return html``;

    return html`
      <div class="section">
        <div class="section-title">${showPicker ? "Add card" : "Card"}</div>
        ${showPicker
          ? html`
              ${cards.length
                ? html`<div class="card-editor-toolbar">
                    <ha-button @click=${() => { this._addingCard = false; }}>Cancel</ha-button>
                  </div>`
                : nothing}
              ${this._pickerReady
                ? html`<hui-card-picker
                    .hass=${this.hass}
                    .lovelace=${this.lovelace}
                    @config-changed=${this._handleCardPicked}
                  ></hui-card-picker>`
                : html`<div class="helper-text">Loading card picker…</div>`}
            `
          : html`
              <div class="card-editor-toolbar">
                <span class="card-editor-name">${this._cardDisplayName(cards[selected])}</span>
                <ha-icon-button
                  .label=${this._cardGuiMode ? "Edit as YAML" : "Edit in GUI"}
                  .disabled=${!this._cardGuiModeAvailable}
                  .path=${"M14.6 16.6L19.2 12L14.6 7.4L16 6L22 12L16 18L14.6 16.6M9.4 16.6L4.8 12L9.4 7.4L8 6L2 12L8 18L9.4 16.6Z"}
                  @click=${this._toggleCardMode}
                ></ha-icon-button>
              </div>
              ${keyed(
                this._editorKey(selected, cards.length),
                html`<hui-card-element-editor
                  .hass=${this.hass}
                  .lovelace=${this.lovelace}
                  .value=${cards[selected]}
                  show-visibility-tab
                  @config-changed=${this._handleCardConfigChanged}
                  @GUImode-changed=${this._handleCardGuiModeChanged}
                ></hui-card-element-editor>`,
              )}
            `}
      </div>
    `;
  }

  private _toggleCardMode(): void {
    const editor = this.shadowRoot?.querySelector("hui-card-element-editor") as
      | (HTMLElement & { toggleMode(): void })
      | null;
    editor?.toggleMode();
  }

  private _handleCardGuiModeChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const detail = ev.detail as { guiMode: boolean; guiModeAvailable: boolean };
    this._cardGuiMode = detail.guiMode;
    this._cardGuiModeAvailable = detail.guiModeAvailable;
  }

  private _handleCardConfigChanged(ev: CustomEvent): void {
    ev.stopPropagation();
    const detail = ev.detail as { config: SubCardConfig; guiModeAvailable?: boolean };
    const cards = [...this._cards];
    const index = Math.min(this._selectedCardIndex, cards.length - 1);
    if (index < 0) return;
    cards[index] = detail.config;
    if (detail.guiModeAvailable !== undefined) {
      this._cardGuiModeAvailable = detail.guiModeAvailable;
    }
    this._commitCards(cards);
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

      .helper-text.spaced {
        margin-bottom: 14px;
      }

      /*
       * Visual grouping: each group is one thing you work on — the grid and its
       * per-card visual tweaks, or the selected card's settings. The tint is
       * derived from the text colour so it adapts to light and dark themes
       * instead of assuming a background.
       */
      .group {
        background: color-mix(in srgb, var(--primary-text-color) 4%, transparent);
        border: 1px solid var(--divider-color, rgba(127, 127, 127, 0.2));
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 16px;
      }

      .group > .section:last-child,
      .group > .field:last-child {
        margin-bottom: 0;
      }

      ha-expansion-panel {
        display: block;
        margin-bottom: 16px;
      }

      .card-quick-settings {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 4px 20px;
        margin: 12px 0 16px;
      }

      /* ── Preview area: sidebar + preview side by side ── */

      .preview-toolbar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 4px 12px;
        margin-bottom: 8px;
      }

      .preview-toolbar .helper-text {
        margin-top: 0;
        flex: 1;
        min-width: 0;
      }

      .sidebar-add {
        border: 1px dashed var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: none;
        color: var(--secondary-text-color);
        font-size: 0.75rem;
        font-family: inherit;
        padding: 5px 6px;
        cursor: pointer;
      }

      .sidebar-add:hover,
      .sidebar-add.selected {
        border-color: var(--primary-color);
        color: var(--primary-color);
      }

      .card-editor-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        --mdc-icon-button-size: 36px;
      }

      .card-editor-toolbar .spacer {
        flex: 1;
      }

      .card-editor-name {
        font-size: 0.875rem;
        text-transform: capitalize;
        color: var(--secondary-text-color);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .sidebar-item-actions {
        display: flex;
        justify-content: space-around;
        gap: 2px;
        padding: 2px 4px 4px;
      }

      .card-action {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        padding: 0;
        border: none;
        border-radius: 4px;
        background: none;
        color: var(--secondary-text-color);
        cursor: pointer;
        --mdc-icon-size: 16px;
      }

      .card-action:hover:not([disabled]) {
        background: var(--divider-color, rgba(127, 127, 127, 0.25));
        color: var(--primary-text-color);
      }

      .card-action[disabled] {
        opacity: 0.35;
        cursor: default;
      }

      .layout-section {
        margin: 0;
      }

      .sidebar-item-badge {
        --mdc-icon-size: 14px;
        color: var(--secondary-text-color);
        flex-shrink: 0;
      }

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

import { LitElement, html, css, CSSResultGroup, TemplateResult, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

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
}

interface SubCardConfig {
  type: string;
  grid_options?: CardGridOptions;
  [key: string]: unknown;
}

interface MosaicCardConfig {
  type: string;
  mode?: "auto" | "manual";
  columns?: number;
  row_height?: "auto" | number | string;
  column_gap?: number;
  row_gap?: number;
  auto_flow?: "dense" | "row" | "column";
  title?: string;
  strip_borders?: boolean;
  cards?: SubCardConfig[];
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

@customElement("mosaic-card-editor")
export class MosaicCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HassObj;

  @state() private _config?: MosaicCardConfig;
  @state() private _guiMode = true;
  @state() private _yamlValue = "";

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
      ${this._renderModeAndGridSection(mode)}
      ${this._renderCardsSection()}
      ${this._renderAppearanceSection()}
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
          <label>Columns</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              number: {
                min: 1,
                max: 48,
                mode: "box",
                step: 1,
              },
            }}
            .value=${this._get("columns") ?? 4}
            .configValue=${"columns"}
            @value-changed=${this._valueChanged}
          ></ha-selector>
        </div>

        <div class="field">
          <label>Row Height</label>
          <ha-selector
            .hass=${this.hass}
            .selector=${{
              text: {
                type: "text",
              },
            }}
            .value=${this._get("row_height") ?? "auto"}
            .configValue=${"row_height"}
            @value-changed=${this._valueChanged}
          ></ha-selector>
          <div class="helper-text">Use "auto" or a CSS value like "100px"</div>
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

    return html`
      <div class="section">
        <div class="section-title">Cards</div>

        <div class="card-list">
          ${cards.map((card, index) => this._renderCardRow(card, index, cards.length))}
        </div>

        <div class="add-card">
          <hui-card-picker
            .hass=${this.hass}
            @config-changed=${this._pickCard}
          ></hui-card-picker>
        </div>
      </div>
    `;
  }

  private _renderCardRow(
    card: SubCardConfig,
    index: number,
    total: number,
  ): TemplateResult {
    const cardType = card.type ?? "unknown";
    const displayName = cardType.replace(/^custom:/, "").replace(/-/g, " ");

    return html`
      <div class="card-row">
        <div class="card-row-info">
          <ha-icon icon="mdi:card-outline" class="card-icon"></ha-icon>
          <span class="card-name">${displayName}</span>
        </div>
        <div class="card-row-actions">
          <ha-icon-button
            .label=${"Move up"}
            .path=${"M7.41 15.41L12 10.83L16.59 15.41L18 14L12 8L6 14L7.41 15.41Z"}
            ?disabled=${index === 0}
            @click=${() => this._moveCard(index, -1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${"Move down"}
            .path=${"M7.41 8.59L12 13.17L16.59 8.59L18 10L12 16L6 10L7.41 8.59Z"}
            ?disabled=${index === total - 1}
            @click=${() => this._moveCard(index, 1)}
          ></ha-icon-button>
          <ha-icon-button
            .label=${"Delete card"}
            .path=${"M19 6.41L17.59 5L12 10.59L6.41 5L5 6.41L10.59 12L5 17.59L6.41 19L12 13.41L17.59 19L19 17.59L13.41 12L19 6.41Z"}
            @click=${() => this._deleteCard(index)}
          ></ha-icon-button>
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

      .card-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: var(--card-background-color, #fff);
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
    `;
  }
}

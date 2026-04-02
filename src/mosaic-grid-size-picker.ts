import { LitElement, html, css, CSSResultGroup, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GridSizeValue {
  columns?: number;
  rows?: number;
  column_start?: number;
  row_start?: number;
  z_index?: number;
  styles?: { pointer_events?: string; overflow?: string; opacity?: number | string };
  /** 12-column fallback layout (used when parent mosaic card > 12 cols) */
  mobile?: {
    columns?: number;
    rows?: number;
    column_start?: number;
    row_start?: number;
  };
}

type DragType = "move" | "n" | "s" | "e" | "w";

interface DragState {
  type: DragType;
  startX: number;
  startY: number;
  origColumns: number;
  origRows: number;
  origColStart: number;
  origRowStart: number;
  cellWidth: number;
  cellHeight: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * A visual grid size + position picker for mosaic card sub-cards.
 *
 * Auto mode:  drag south/east edge handles to resize (columns/rows span).
 * Manual mode: drag body to move (column_start/row_start) + all four edge
 *              handles to resize from any side.
 *
 * When gridColumns > 12, a toggle shows a second "12-col fallback" view that
 * edits `value.mobile` instead of the root value.
 *
 * Emits `value-changed` with `detail.value: GridSizeValue` on every change.
 */
@customElement("mosaic-grid-size-picker")
export class MosaicGridSizePicker extends LitElement {
  /** Parent mosaic card layout mode. */
  @property({ type: String }) mode: "auto" | "manual" = "auto";

  /** Total columns in the parent mosaic card grid. */
  @property({ type: Number }) gridColumns = 12;

  /** Total rows in the parent mosaic card grid. */
  @property({ type: Number }) gridRows = 5;

  /** Overlay mode: transparent background, full height, no inputs. */
  @property({ type: Boolean }) overlay = false;

  /** Current grid_options for this sub-card. */
  @property({ attribute: false }) value: GridSizeValue = {};

  @state() private _show12ColView = false;
  @state() private _dragging = false;

  private _dragState: DragState | null = null;

  // ── Derived values ──────────────────────────────────────────────────────────

  private get _viewColumns(): number {
    return this._show12ColView ? 12 : this.gridColumns;
  }

  /** The part of `value` being edited in the current view. */
  private get _viewValue(): GridSizeValue {
    if (this._show12ColView) {
      return this.value.mobile ?? {};
    }
    return this.value;
  }

  private get _colSpan(): number {
    return Math.max(1, this._viewValue.columns ?? 2);
  }

  private get _rowSpan(): number {
    return Math.max(1, this._viewValue.rows ?? 1);
  }

  private get _colStart(): number {
    return this.mode === "manual" ? Math.max(1, this._viewValue.column_start ?? 1) : 1;
  }

  private get _rowStart(): number {
    return this.mode === "manual" ? Math.max(1, this._viewValue.row_start ?? 1) : 1;
  }

  /** How many rows to show in the picker visualization. */
  private get _pickerRows(): number {
    return this.gridRows;
  }

  // ── Event helpers ───────────────────────────────────────────────────────────

  private _fireChange(updates: Partial<GridSizeValue>): void {
    let newValue: GridSizeValue;
    if (this._show12ColView) {
      const existing = this.value.mobile ?? {};
      newValue = { ...this.value, mobile: { ...existing, ...updates } };
    } else {
      newValue = { ...this.value, ...updates };
    }
    this.dispatchEvent(
      new CustomEvent("value-changed", {
        detail: { value: newValue },
        bubbles: true,
        composed: true,
      }),
    );
  }

  // ── Drag / resize ───────────────────────────────────────────────────────────

  private _getEventPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    if ("touches" in e && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: (e as MouseEvent).clientX, y: (e as MouseEvent).clientY };
  }

  private _startDrag(e: MouseEvent | TouchEvent, type: DragType): void {
    e.preventDefault();
    e.stopPropagation();

    const viz = this.shadowRoot?.querySelector(".grid-viz") as HTMLElement | null;
    if (!viz) return;

    const rect = viz.getBoundingClientRect();
    const { x, y } = this._getEventPos(e);

    this._dragState = {
      type,
      startX: x,
      startY: y,
      origColumns: this._colSpan,
      origRows: this._rowSpan,
      origColStart: this._colStart,
      origRowStart: this._rowStart,
      cellWidth: rect.width / this._viewColumns,
      cellHeight: rect.height / this._pickerRows,
    };
    this._dragging = true;

    const onMove = (ev: Event) => this._onDragMove(ev as MouseEvent | TouchEvent);
    const onEnd = () => {
      this._dragging = false;
      this._dragState = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
  }

  private _onDragMove(e: MouseEvent | TouchEvent): void {
    if (!this._dragState) return;
    e.preventDefault();

    const ds = this._dragState;
    const { x, y } = this._getEventPos(e);
    const dx = Math.round((x - ds.startX) / ds.cellWidth);
    const dy = Math.round((y - ds.startY) / ds.cellHeight);
    const maxCols = this._viewColumns;
    const maxRows = this._pickerRows;

    const updates: Partial<GridSizeValue> = {};

    switch (ds.type) {
      case "move": {
        updates.column_start = Math.max(
          1,
          Math.min(maxCols - ds.origColumns + 1, ds.origColStart + dx),
        );
        updates.row_start = Math.max(1, ds.origRowStart + dy);
        break;
      }
      case "e": {
        updates.columns = Math.max(
          1,
          Math.min(maxCols - ds.origColStart + 1, ds.origColumns + dx),
        );
        break;
      }
      case "s": {
        updates.rows = Math.min(Math.max(1, ds.origRows + dy), maxRows);
        break;
      }
      case "w": {
        const newStart = Math.max(
          1,
          Math.min(maxCols - ds.origColumns + 1, ds.origColStart + dx),
        );
        updates.column_start = newStart;
        updates.columns = Math.max(1, ds.origColumns - (newStart - ds.origColStart));
        break;
      }
      case "n": {
        const newRowStart = Math.max(
          1,
          Math.min(maxRows - ds.origRows + 1, ds.origRowStart + dy),
        );
        updates.row_start = newRowStart;
        updates.rows = Math.max(1, ds.origRows - (newRowStart - ds.origRowStart));
        break;
      }
    }

    this._fireChange(updates);
  }

  // ── Number input handlers ───────────────────────────────────────────────────

  private _onInputChange(e: Event, key: string): void {
    const raw = (e.target as HTMLInputElement).value;
    const value = parseInt(raw, 10);
    if (!isNaN(value)) {
      this._fireChange({ [key]: value } as Partial<GridSizeValue>);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  protected render(): TemplateResult {
    const cols = this._viewColumns;
    const rows = this._pickerRows;
    const colSpan = this._colSpan;
    const rowSpan = this._rowSpan;
    const colStart = this._colStart;
    const rowStart = this._rowStart;
    const isManual = this.mode === "manual";
    const needsToggle = this.gridColumns > 12;

    // Rectangle position as percentages within the picker area
    const left = ((colStart - 1) / cols) * 100;
    const top = ((rowStart - 1) / rows) * 100;
    const width = (colSpan / cols) * 100;
    const height = (rowSpan / rows) * 100;

    // Grid lines via repeating gradients — computed in JS so the percentage step
    // can reference actual col/row counts without CSS calc limitations.
    const colStep = (100 / cols).toFixed(4);
    const rowStep = (100 / rows).toFixed(4);
    const lineColor = "var(--divider-color, rgba(0,0,0,.12))";
    const vizStyle = [
      `background-image:`,
      `  repeating-linear-gradient(to right,`,
      `    ${lineColor} 0, ${lineColor} 1px,`,
      `    transparent 1px, transparent ${colStep}%),`,
      `  repeating-linear-gradient(to bottom,`,
      `    ${lineColor} 0, ${lineColor} 1px,`,
      `    transparent 1px, transparent ${rowStep}%)`,
    ].join(" ");

    if (this.overlay) {
      return html`
        <div class="grid-viz overlay" style="${vizStyle}">
          <div
            class="card-rect${isManual ? " draggable" : ""}${this._dragging ? " dragging" : ""}"
            style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"
            @mousedown=${isManual ? (e: MouseEvent) => this._startDrag(e, "move") : undefined}
            @touchstart=${isManual ? (e: TouchEvent) => this._startDrag(e, "move") : undefined}
          >
            <div class="handle s"
              @mousedown=${(e: MouseEvent) => { e.stopPropagation(); this._startDrag(e, "s"); }}
              @touchstart=${(e: TouchEvent) => { e.stopPropagation(); this._startDrag(e, "s"); }}
            ></div>
            <div class="handle e"
              @mousedown=${(e: MouseEvent) => { e.stopPropagation(); this._startDrag(e, "e"); }}
              @touchstart=${(e: TouchEvent) => { e.stopPropagation(); this._startDrag(e, "e"); }}
            ></div>
            ${isManual ? html`
              <div class="handle n"
                @mousedown=${(e: MouseEvent) => { e.stopPropagation(); this._startDrag(e, "n"); }}
                @touchstart=${(e: TouchEvent) => { e.stopPropagation(); this._startDrag(e, "n"); }}
              ></div>
              <div class="handle w"
                @mousedown=${(e: MouseEvent) => { e.stopPropagation(); this._startDrag(e, "w"); }}
                @touchstart=${(e: TouchEvent) => { e.stopPropagation(); this._startDrag(e, "w"); }}
              ></div>
            ` : ""}
          </div>
        </div>
      `;
    }

    return html`
      ${needsToggle
        ? html`
            <div class="view-toggle">
              <button
                class="toggle-btn ${!this._show12ColView ? "active" : ""}"
                @click=${() => {
                  this._show12ColView = false;
                }}
              >
                Desktop (${this.gridColumns} cols)
              </button>
              <button
                class="toggle-btn ${this._show12ColView ? "active" : ""}"
                @click=${() => {
                  this._show12ColView = true;
                }}
              >
                Mobile (12 cols)
              </button>
            </div>
          `
        : ""}

      <div class="grid-viz" style="${vizStyle}">
        <div
          class="card-rect${isManual ? " draggable" : ""}${this._dragging ? " dragging" : ""}"
          style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"
          @mousedown=${isManual
            ? (e: MouseEvent) => this._startDrag(e, "move")
            : undefined}
          @touchstart=${isManual
            ? (e: TouchEvent) => this._startDrag(e, "move")
            : undefined}
        >
          <!-- South handle: always present (resize rows) -->
          <div
            class="handle s"
            @mousedown=${(e: MouseEvent) => {
              e.stopPropagation();
              this._startDrag(e, "s");
            }}
            @touchstart=${(e: TouchEvent) => {
              e.stopPropagation();
              this._startDrag(e, "s");
            }}
          ></div>

          <!-- East handle: always present (resize columns) -->
          <div
            class="handle e"
            @mousedown=${(e: MouseEvent) => {
              e.stopPropagation();
              this._startDrag(e, "e");
            }}
            @touchstart=${(e: TouchEvent) => {
              e.stopPropagation();
              this._startDrag(e, "e");
            }}
          ></div>

          ${isManual
            ? html`
                <!-- North handle: manual only (move row start) -->
                <div
                  class="handle n"
                  @mousedown=${(e: MouseEvent) => {
                    e.stopPropagation();
                    this._startDrag(e, "n");
                  }}
                  @touchstart=${(e: TouchEvent) => {
                    e.stopPropagation();
                    this._startDrag(e, "n");
                  }}
                ></div>

                <!-- West handle: manual only (move column start) -->
                <div
                  class="handle w"
                  @mousedown=${(e: MouseEvent) => {
                    e.stopPropagation();
                    this._startDrag(e, "w");
                  }}
                  @touchstart=${(e: TouchEvent) => {
                    e.stopPropagation();
                    this._startDrag(e, "w");
                  }}
                ></div>
              `
            : ""}
        </div>
      </div>

      <div class="inputs">
        ${isManual
          ? html`
              <label class="input-field">
                <span>Col start</span>
                <input
                  type="number"
                  min="1"
                  .value="${String(colStart)}"
                  @change=${(e: Event) => this._onInputChange(e, "column_start")}
                />
              </label>
            `
          : ""}

        <label class="input-field">
          <span>Width (cols)</span>
          <input
            type="number"
            min="1"
            .value="${String(colSpan)}"
            @change=${(e: Event) => this._onInputChange(e, "columns")}
          />
        </label>

        ${isManual
          ? html`
              <label class="input-field">
                <span>Row start</span>
                <input
                  type="number"
                  min="1"
                  .value="${String(rowStart)}"
                  @change=${(e: Event) => this._onInputChange(e, "row_start")}
                />
              </label>
            `
          : ""}

        <label class="input-field">
          <span>Height (rows)</span>
          <input
            type="number"
            min="1"
            .value="${String(rowSpan)}"
            @change=${(e: Event) => this._onInputChange(e, "rows")}
          />
        </label>
      </div>

      ${isManual && !this._show12ColView
        ? html`
            <label class="input-field z-index-field">
              <span>Z-index</span>
              <input
                type="number"
                .value="${String(this.value.z_index ?? 0)}"
                @change=${(e: Event) => this._onInputChange(e, "z_index")}
              />
            </label>
          `
        : ""}
    `;
  }

  // ── Styles ──────────────────────────────────────────────────────────────────

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
        padding: 8px 0;
      }

      .view-toggle {
        display: flex;
        gap: 4px;
        margin-bottom: 8px;
      }

      .toggle-btn {
        flex: 1;
        padding: 4px 8px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
        font-size: 0.75rem;
        color: var(--primary-text-color);
        font-family: inherit;
      }

      .toggle-btn.active {
        background: var(--primary-color, #007af5);
        color: var(--text-primary-color, #fff);
        border-color: var(--primary-color, #007af5);
      }

      /* Grid visualization area */
      .grid-viz {
        position: relative;
        width: 100%;
        height: 160px;
        background-color: var(--secondary-background-color, #f5f5f5);
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        overflow: hidden;
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }

      /* Overlay mode: transparent, fills parent, pointer-events only on handles */
      :host([overlay]) {
        position: absolute;
        inset: 0;
        padding: 0;
        pointer-events: none;
      }

      .grid-viz.overlay {
        height: 100%;
        background: transparent;
        border: none;
        border-radius: 0;
        pointer-events: none;
      }

      .grid-viz.overlay .card-rect {
        pointer-events: auto;
      }

      .grid-viz.overlay .handle {
        pointer-events: auto;
      }

      /* Highlighted card rectangle */
      .card-rect {
        position: absolute;
        background: color-mix(in srgb, var(--primary-color, #007af5) 40%, transparent);
        border: 2px solid var(--primary-color, #007af5);
        border-radius: 2px;
        box-sizing: border-box;
      }

      .card-rect.draggable {
        cursor: grab;
      }

      .card-rect.dragging {
        cursor: grabbing;
      }

      /* Edge drag handles */
      .handle {
        position: absolute;
        width: 14px;
        height: 14px;
        background: var(--card-background-color, #fff);
        border: 2px solid var(--primary-color, #007af5);
        border-radius: 50%;
        box-sizing: border-box;
        /* Minimum 44px touch target via padding trick */
        touch-action: none;
      }

      /* Increase touch target size without affecting visual size */
      .handle::before {
        content: "";
        position: absolute;
        top: -15px;
        left: -15px;
        right: -15px;
        bottom: -15px;
      }

      .handle.s {
        bottom: -7px;
        left: 50%;
        transform: translateX(-50%);
        cursor: s-resize;
      }

      .handle.n {
        top: -7px;
        left: 50%;
        transform: translateX(-50%);
        cursor: n-resize;
      }

      .handle.e {
        right: -7px;
        top: 50%;
        transform: translateY(-50%);
        cursor: e-resize;
      }

      .handle.w {
        left: -7px;
        top: 50%;
        transform: translateY(-50%);
        cursor: w-resize;
      }

      /* Numeric inputs below the visualization */
      .inputs {
        display: flex;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
      }

      .input-field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 72px;
      }

      .input-field span {
        font-size: 0.75rem;
        color: var(--secondary-text-color);
        white-space: nowrap;
      }

      .input-field input {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        font-size: 0.875rem;
        background: var(--card-background-color, #fff);
        color: var(--primary-text-color);
        box-sizing: border-box;
        font-family: inherit;
      }

      .input-field input:focus {
        outline: none;
        border-color: var(--primary-color, #007af5);
      }

      .z-index-field {
        margin-top: 8px;
        max-width: 120px;
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mosaic-grid-size-picker": MosaicGridSizePicker;
  }
}

import { LitElement, html, css, CSSResultGroup, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

interface MosaicCardConfig {
  type: string;
  title?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
}

@customElement("mosaic-card")
export class MosaicCard extends LitElement {
  @property({ attribute: false }) private _config?: MosaicCardConfig;
  @property({ attribute: false }) public hass?: Record<string, unknown>;

  static get styles(): CSSResultGroup {
    return css`
      :host {
        display: block;
      }
      ha-card {
        padding: 16px;
      }
    `;
  }

  public setConfig(config: MosaicCardConfig): void {
    this._config = config;
  }

  protected render(): TemplateResult {
    if (!this._config) {
      return html``;
    }

    return html`
      <ha-card .header=${this._config.title ?? ""}>
        <div class="card-content">
          Mosaic Card
        </div>
      </ha-card>
    `;
  }

  public getCardSize(): number {
    return 3;
  }

  static getStubConfig(): MosaicCardConfig {
    return { type: "custom:mosaic-card" };
  }
}

// Register the card with Home Assistant
const win = window as unknown as { customCards?: CustomCardEntry[] };
win.customCards = win.customCards ?? [];
win.customCards.push({
  type: "mosaic-card",
  name: "Mosaic Card",
  description: "A mosaic layout card for Home Assistant",
});

console.info(
  "%c MOSAIC-CARD %c v__VERSION__ ",
  "color: white; background: #555; font-weight: bold;",
  "color: white; background: #007af5; font-weight: bold;",
);

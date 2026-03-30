import { test, expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, "../.auth/user.json");

test.use({
  storageState: AUTH_FILE,
  viewport: { width: 1400, height: 900 },
});

/**
 * Wait for the mosaic-card editor to open and be visible inside hui-dialog-edit-card.
 * Returns true when the mosaic-card-editor is found in the dialog.
 */
async function openMosaicCardEditor(page: import("@playwright/test").Page) {
  // Navigate to edit mode on the Auto Mode view (has mosaic-card as first card)
  await page.goto("/lovelace/home?edit=1");
  await page.waitForURL((url) => url.search.includes("edit=1"), { timeout: 15_000 });
  await page.waitForSelector("hui-card-options", { state: "attached", timeout: 15_000 });

  // Wait for WebSocket to fully establish (required for card editor lazy-load)
  await page.waitForTimeout(8_000);

  // Click the Edit button on the first hui-card-options (the mosaic card)
  await page.locator("hui-card-options ha-button").first().click();

  // Wait for the dialog to appear in home-assistant.shadowRoot
  await page.waitForFunction(
    () => {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      return !!dialog?.shadowRoot?.querySelector("ha-dialog[open]");
    },
    { timeout: 15_000 },
  );

  // Give the editor element time to render inside the dialog
  await page.waitForTimeout(3_000);
}

test("mosaic-card-editor opens and shows layout section", async ({ page }) => {
  await openMosaicCardEditor(page);

  // Verify mosaic-card-editor is rendered inside the dialog
  const editorPresent = await page.evaluate(() => {
    const ha = document.querySelector("home-assistant");
    const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
    const elementEditor = dialog?.shadowRoot
      ?.querySelector("hui-card-element-editor")
      ?.shadowRoot?.querySelector("mosaic-card-editor");
    return !!elementEditor;
  });
  expect(editorPresent).toBe(true);

  await page.screenshot({
    path: "test/screenshots/mosaic-card-editor-open.png",
    fullPage: false,
  });
});

test("mosaic-card-editor layout section fields are visible", async ({ page }) => {
  await openMosaicCardEditor(page);

  // The editor uses ha-selector elements for each field.
  // Playwright locators pierce shadow DOM, so we can check for them directly.
  // The dialog content is accessible via locators.
  const sectionTitles = await page.evaluate(() => {
    function pierce(root: ParentNode, selector: string): Element[] {
      const results: Element[] = [];
      const found = Array.from(root.querySelectorAll(selector));
      results.push(...found);
      for (const child of root.querySelectorAll("*")) {
        const el = child as Element & { shadowRoot?: ShadowRoot };
        if (el.shadowRoot) {
          results.push(...pierce(el.shadowRoot, selector));
        }
      }
      return results;
    }

    const ha = document.querySelector("home-assistant");
    if (!ha?.shadowRoot) return [];
    const sectionEls = pierce(ha.shadowRoot, ".section-title");
    return sectionEls.map((el) => el.textContent?.trim() ?? "");
  });

  expect(sectionTitles).toContain("Layout");
  expect(sectionTitles).toContain("Cards");

  await page.screenshot({
    path: "test/screenshots/mosaic-card-editor-sections.png",
    fullPage: false,
  });
});

test("mosaic-card-editor shows auto-flow field only in auto mode", async ({ page }) => {
  await openMosaicCardEditor(page);

  // Verify auto-flow selector is present (default mode is "auto")
  const hasAutoFlow = await page.evaluate(() => {
    function pierce(root: ParentNode, selector: string): Element | null {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        const c = child as Element & { shadowRoot?: ShadowRoot };
        if (c.shadowRoot) {
          const found = pierce(c.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }

    function getEditorShadow(): ShadowRoot | null {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      const elementEditor = dialog?.shadowRoot?.querySelector("hui-card-element-editor");
      const mosEditor = elementEditor?.shadowRoot?.querySelector("mosaic-card-editor") as
        | (Element & { shadowRoot?: ShadowRoot })
        | null;
      return mosEditor?.shadowRoot ?? null;
    }

    const editorShadow = getEditorShadow();
    if (!editorShadow) return { editorFound: false, autoFlowVisible: false };

    // Find all ha-selector elements — check if there's a 'label' containing "Auto-flow"
    const labels = Array.from(editorShadow.querySelectorAll("label"));
    const autoFlowLabel = labels.find((l) => l.textContent?.includes("Auto-flow"));
    return {
      editorFound: true,
      autoFlowVisible: !!autoFlowLabel,
    };
  });

  expect(hasAutoFlow.editorFound).toBe(true);
  // In auto mode (default), auto-flow should be visible
  expect(hasAutoFlow.autoFlowVisible).toBe(true);

  await page.screenshot({
    path: "test/screenshots/mosaic-card-editor-auto-flow-visible.png",
    fullPage: false,
  });
});

test("mosaic-card-editor appearance section is present (ha-expansion-panel)", async ({
  page,
}) => {
  await openMosaicCardEditor(page);

  const hasAppearancePanel = await page.evaluate(() => {
    function getEditorShadow(): ShadowRoot | null {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      const elementEditor = dialog?.shadowRoot?.querySelector("hui-card-element-editor");
      const mosEditor = elementEditor?.shadowRoot?.querySelector("mosaic-card-editor") as
        | (Element & { shadowRoot?: ShadowRoot })
        | null;
      return mosEditor?.shadowRoot ?? null;
    }

    const editorShadow = getEditorShadow();
    if (!editorShadow) return false;

    const panel = editorShadow.querySelector("ha-expansion-panel");
    return !!panel;
  });

  expect(hasAppearancePanel).toBe(true);

  await page.screenshot({
    path: "test/screenshots/mosaic-card-editor-appearance-panel.png",
    fullPage: false,
  });
});

test("mosaic-card-editor GUI/YAML toggle switches to code editor", async ({ page }) => {
  await openMosaicCardEditor(page);

  // Find and click the GUI/YAML toggle icon button inside mosaic-card-editor
  const toggleClicked = await page.evaluate(() => {
    function getEditorShadow(): ShadowRoot | null {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      const elementEditor = dialog?.shadowRoot?.querySelector("hui-card-element-editor");
      const mosEditor = elementEditor?.shadowRoot?.querySelector("mosaic-card-editor") as
        | (Element & { shadowRoot?: ShadowRoot })
        | null;
      return mosEditor?.shadowRoot ?? null;
    }

    const editorShadow = getEditorShadow();
    if (!editorShadow) return false;

    const toggleBtn = editorShadow.querySelector(
      ".header ha-icon-button",
    ) as HTMLElement | null;
    if (!toggleBtn) return false;
    toggleBtn.click();
    return true;
  });

  expect(toggleClicked).toBe(true);

  // Wait a moment for the toggle animation
  await page.waitForTimeout(500);

  // Verify ha-code-editor is now shown
  const hasCodeEditor = await page.evaluate(() => {
    function getEditorShadow(): ShadowRoot | null {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      const elementEditor = dialog?.shadowRoot?.querySelector("hui-card-element-editor");
      const mosEditor = elementEditor?.shadowRoot?.querySelector("mosaic-card-editor") as
        | (Element & { shadowRoot?: ShadowRoot })
        | null;
      return mosEditor?.shadowRoot ?? null;
    }

    const editorShadow = getEditorShadow();
    if (!editorShadow) return false;
    return !!editorShadow.querySelector("ha-code-editor");
  });

  expect(hasCodeEditor).toBe(true);

  await page.screenshot({
    path: "test/screenshots/mosaic-card-editor-yaml-mode.png",
    fullPage: false,
  });
});

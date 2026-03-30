import { test, expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, "../.auth/user.json");

test.use({
  storageState: AUTH_FILE,
  viewport: { width: 1400, height: 900 },
});

async function waitForMosaicCards(page: import("@playwright/test").Page) {
  // Wait for the lovelace panel to render its cards.
  // mosaic-card is inside shadow DOM so it can't be found with querySelector;
  // instead we wait for hui-masonry-view (HA's card container) which is accessible.
  await page.waitForFunction(
    () => {
      const ha = document.querySelector("home-assistant");
      const main = ha?.shadowRoot?.querySelector("home-assistant-main");
      const partial = main?.shadowRoot?.querySelector("ha-panel-lovelace");
      const root = partial?.shadowRoot?.querySelector("hui-root");
      const view = root?.shadowRoot?.querySelector("hui-masonry-view");
      return !!view;
    },
    { timeout: 20_000 },
  );
  // Give async loadCardHelpers / sub-card rendering time to settle
  await page.waitForTimeout(4_000);
}

test("mosaic-card auto mode screenshot", async ({ page }) => {
  await page.goto("/lovelace/home");
  await expect(page.locator("ha-panel-lovelace")).toBeVisible({
    timeout: 20_000,
  });
  await waitForMosaicCards(page);

  await page.screenshot({
    path: "test/screenshots/mosaic-auto-mode.png",
    fullPage: true,
  });
});

test("mosaic-card manual mode screenshot", async ({ page }) => {
  await page.goto("/lovelace/manual");
  await expect(page.locator("ha-panel-lovelace")).toBeVisible({
    timeout: 20_000,
  });
  await waitForMosaicCards(page);

  await page.screenshot({
    path: "test/screenshots/mosaic-manual-mode.png",
    fullPage: true,
  });
});

test("mosaic-card custom spacing screenshot", async ({ page }) => {
  await page.goto("/lovelace/spacing");
  await expect(page.locator("ha-panel-lovelace")).toBeVisible({
    timeout: 20_000,
  });
  await waitForMosaicCards(page);

  await page.screenshot({
    path: "test/screenshots/mosaic-custom-spacing.png",
    fullPage: true,
  });
});

import { test, expect } from "@playwright/test";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, "../.auth/user.json");

test.use({
  storageState: AUTH_FILE,
});

test("HA dashboard loads", async ({ page }) => {
  await page.goto("/lovelace/home");

  // ha-panel-lovelace is the top-level HA dashboard panel
  await expect(page.locator("ha-panel-lovelace")).toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: "test/screenshots/dashboard-baseline.png",
    fullPage: false,
  });
});

test("HA edit mode activates", async ({ page }) => {
  // Navigate directly to edit mode via URL parameter
  await page.goto("/lovelace/home?edit=1");
  await page.waitForURL((url) => url.search.includes("edit=1"), { timeout: 15_000 });

  // Wait for hui-masonry-view to render with card options (edit mode adds hui-card-options)
  await page.waitForSelector("hui-card-options", { state: "attached", timeout: 15_000 });

  // Verify the "Add card" FAB is present (only exists in edit mode)
  const addCardFab = page.locator("ha-fab");
  await expect(addCardFab).toBeAttached({ timeout: 10_000 });

  await page.screenshot({
    path: "test/screenshots/edit-mode-baseline.png",
    fullPage: false,
  });
});

test("HA card editor opens for a stock card", async ({ page }) => {
  // Navigate to edit mode
  await page.goto("/lovelace/home?edit=1");
  await page.waitForURL((url) => url.search.includes("edit=1"), { timeout: 15_000 });
  await page.waitForSelector("hui-card-options", { state: "attached", timeout: 15_000 });

  // Wait for WebSocket to be fully established (required for card editor)
  // hui-dialog-edit-card is lazy-loaded and needs the WS connection
  await page.waitForTimeout(8_000);

  // Click the "Edit" button on the first card (inside hui-card-options shadow DOM)
  // Playwright pierces shadow DOM automatically for locator()
  await page.locator("hui-card-options ha-button").first().click();

  // Wait for the card editor dialog to open.
  // IMPORTANT: The dialog renders in home-assistant.shadowRoot (sibling of home-assistant-main),
  // NOT inside hui-root or hui-masonry-view. Use page.evaluate to check.
  await page.waitForFunction(
    () => {
      const ha = document.querySelector("home-assistant");
      const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
      return !!dialog?.shadowRoot?.querySelector("ha-dialog");
    },
    { timeout: 15_000 }
  );

  await page.screenshot({
    path: "test/screenshots/card-editor-open.png",
    fullPage: false,
  });
});

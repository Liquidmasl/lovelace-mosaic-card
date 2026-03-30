import { chromium, FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_FILE = path.join(__dirname, "../.auth/user.json");
const HA_URL = "http://localhost:18123";
const USERNAME = "test";
const PASSWORD = "test";

/**
 * Log in via HA's REST API and return the `hassTokens` JSON string
 * that HA's frontend expects in localStorage.
 *
 * HA login flow:
 * 1. POST /auth/login_flow → flow_id
 * 2. POST /auth/login_flow/{flow_id} with credentials → auth_code
 * 3. POST /auth/token with auth_code → access_token + refresh_token
 */
async function getHassTokens(): Promise<string> {
  const flowResp = await fetch(`${HA_URL}/auth/login_flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${HA_URL}/`,
      handler: ["homeassistant", null],
      redirect_uri: `${HA_URL}/?auth_callback=1`,
    }),
  });
  const flow = (await flowResp.json()) as { flow_id: string };

  const credResp = await fetch(`${HA_URL}/auth/login_flow/${flow.flow_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: USERNAME,
      password: PASSWORD,
      client_id: `${HA_URL}/`,
    }),
  });
  const cred = (await credResp.json()) as { result: string };

  const tokenResp = await fetch(`${HA_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      `grant_type=authorization_code` +
      `&code=${cred.result}` +
      `&client_id=${encodeURIComponent(`${HA_URL}/`)}`,
  });
  const t = (await tokenResp.json()) as {
    access_token: string;
    token_type: string;
    refresh_token: string;
    expires_in: number;
  };

  return JSON.stringify({
    access_token: t.access_token,
    token_type: t.token_type,
    refresh_token: t.refresh_token,
    expires_in: t.expires_in,
    hassUrl: HA_URL,
    clientId: `${HA_URL}/`,
    // HA expects a millisecond timestamp
    expires: Date.now() + t.expires_in * 1000,
  });
}

async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Wait for HA to be ready (up to 60s)
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const response = await page.goto(HA_URL, { timeout: 5_000 });
      if (response && response.status() < 500) {
        ready = true;
        break;
      }
    } catch {
      await page.waitForTimeout(2_000);
    }
  }
  if (!ready) {
    throw new Error(`Home Assistant at ${HA_URL} did not become ready in time`);
  }

  // Get tokens via REST API (avoids complex shadow DOM login form interaction)
  const hassTokens = await getHassTokens();

  // Use addInitScript so localStorage is set BEFORE HA's frontend JS reads it.
  // This ensures HA starts up already authenticated.
  await context.addInitScript((tokens) => {
    localStorage.setItem("hassTokens", tokens);
  }, hassTokens);

  // Navigate to HA; the init script has already set the tokens
  await page.goto(HA_URL, { waitUntil: "domcontentloaded" });

  // HA frontend reads hassTokens on startup and navigates to the dashboard
  await page.waitForURL((url) => url.pathname.startsWith("/lovelace"), { timeout: 30_000 });
  await page.waitForSelector("home-assistant", { state: "attached", timeout: 20_000 });

  // Save browser state (localStorage now contains hassTokens)
  await context.storageState({ path: AUTH_FILE });
  await browser.close();

  console.log("Global setup complete — hassTokens saved to", AUTH_FILE);
}

export default globalSetup;

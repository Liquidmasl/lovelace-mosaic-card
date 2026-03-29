/**
 * Quick screenshot script for taking a HA dashboard screenshot.
 * Uses --no-sandbox because we're running as root in a container.
 */
import { chromium } from "@playwright/test";

const HA_URL = "http://localhost:18123";
const USERNAME = "test";
const PASSWORD = "test";
const OUT = "test/screenshots/ha-dashboard.png";

async function getHassTokens() {
  const flowResp = await fetch(`${HA_URL}/auth/login_flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${HA_URL}/`,
      handler: ["homeassistant", null],
      redirect_uri: `${HA_URL}/?auth_callback=1`,
    }),
  });
  const flow = await flowResp.json();

  const credResp = await fetch(`${HA_URL}/auth/login_flow/${flow.flow_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, client_id: `${HA_URL}/` }),
  });
  const cred = await credResp.json();

  const tokenResp = await fetch(`${HA_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${cred.result}&client_id=${encodeURIComponent(`${HA_URL}/`)}`,
  });
  const t = await tokenResp.json();

  return JSON.stringify({
    access_token: t.access_token,
    token_type: t.token_type,
    refresh_token: t.refresh_token,
    expires_in: t.expires_in,
    hassUrl: HA_URL,
    clientId: `${HA_URL}/`,
    expires: Date.now() + t.expires_in * 1000,
  });
}

const hassTokens = await getHassTokens();
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await context.addInitScript((tokens) => {
  localStorage.setItem("hassTokens", tokens);
}, hassTokens);

const page = await context.newPage();
await page.goto(HA_URL, { waitUntil: "domcontentloaded" });
await page.waitForURL((url) => url.pathname.startsWith("/lovelace"), { timeout: 30_000 });
await page.waitForTimeout(3000); // let the dashboard render

await page.screenshot({ path: OUT, fullPage: false });
console.log("Screenshot saved to", OUT);
await browser.close();

#!/usr/bin/env node
/**
 * Creates a new long-lived HA API token for the test container and prints it.
 * Run this when test/fixtures/ha-config/.storage/auth has been wiped or regenerated.
 *
 * Usage:
 *   node scripts/create-ha-token.mjs
 *
 * After running:
 *   1. Copy the printed token into /root/global_mcps.json (HOMEASSISTANT_TOKEN)
 *   2. Commit the updated test/fixtures/ha-config/.storage/auth fixture
 *   3. Update .claude/test-infrastructure.md with the new token
 */

const HA_URL = "http://localhost:18123";
const USERNAME = "test";
const PASSWORD = "test";

async function getAccessToken() {
  const flowResp = await fetch(`${HA_URL}/auth/login_flow`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: `${HA_URL}/`,
      handler: ["homeassistant", null],
      redirect_uri: `${HA_URL}/?auth_callback=1`,
    }),
  });
  const { flow_id } = await flowResp.json();

  const credResp = await fetch(`${HA_URL}/auth/login_flow/${flow_id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD, client_id: `${HA_URL}/` }),
  });
  const { result: code } = await credResp.json();

  const tokenResp = await fetch(`${HA_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${code}&client_id=${encodeURIComponent(`${HA_URL}/`)}`,
  });
  const { access_token } = await tokenResp.json();
  return access_token;
}

async function createLongLivedToken(accessToken) {
  const { default: WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${HA_URL.replace("http", "ws")}/api/websocket`);
    let step = 0;
    ws.on("message", (data) => {
      const msg = JSON.parse(data);
      if (step === 0 && msg.type === "auth_required") {
        ws.send(JSON.stringify({ type: "auth", access_token: accessToken }));
        step = 1;
      } else if (step === 1 && msg.type === "auth_ok") {
        ws.send(JSON.stringify({
          id: 1,
          type: "auth/long_lived_access_token",
          client_name: "ha-mcp-test",
          lifespan: 3650,
        }));
        step = 2;
      } else if (step === 2 && msg.type === "result") {
        ws.close();
        if (msg.success) resolve(msg.result);
        else reject(new Error(JSON.stringify(msg.error)));
      }
    });
    ws.on("error", reject);
  });
}

const accessToken = await getAccessToken();
const longLivedToken = await createLongLivedToken(accessToken);

console.log("\nLong-lived token (expires in 10 years):");
console.log(longLivedToken);
console.log("\nNext steps:");
console.log("1. Update HOMEASSISTANT_TOKEN in /root/global_mcps.json");
console.log("2. Commit test/fixtures/ha-config/.storage/auth");
console.log("3. Update token in .claude/test-infrastructure.md");

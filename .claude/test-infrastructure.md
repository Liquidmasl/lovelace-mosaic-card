# Test Infrastructure Deep-Dive

## Container Setup

```bash
docker compose -f docker-compose.test.yml up -d --wait   # start (healthy when HA responds on port 18123)
docker compose -f docker-compose.test.yml down            # stop + remove
```

- **URL:** `http://localhost:18123`
- **Credentials:** `test` / `test`
- **Long-lived access token (expires 2037):**
  `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJiZDZlNjI5YjFiN2U0MzY0OTBjMmNlOTEyYjY2MjM3NyIsImlhdCI6MTc3NDgyOTcxNiwiZXhwIjoyMDkwMTg5NzE2fQ.mGhq8ycuNBtpJUa5VX5kPf52k44wCsaUiGOl2Fz9zTA`
- **Token is stable** because `test/fixtures/ha-config/.storage/auth` is committed — same user ID persists across container restarts. If the auth fixture is ever wiped, run `scripts/create-ha-token.mjs` to regenerate.

**Server networking quirk:** This server runs in a Proxmox LXC container that blocks Docker bridge networking (sysctl `net.ipv4.ip_unprivileged_port_start` permission denied). The compose file uses `network_mode: host` to work around this. HA is configured via `http.server_port: 18123` in `configuration.yaml` so the test URL remains `http://localhost:18123`.

**npm scripts:**
```bash
npm run test:e2e:up      # start container (waits for healthy)
npm run test:e2e:down    # stop container
npm run test:e2e:smoke   # up + run smoke.spec.ts + down
npm run test:e2e         # build + up + all tests + down
```

---

## Pre-seeded Fixtures (`test/fixtures/ha-config/`)

| File | Purpose |
|------|---------|
| `configuration.yaml` | HA config: demo integration, CORS open, port 18123 |
| `.storage/onboarding` | All 4 steps marked done → skips onboarding wizard |
| `.storage/auth` | Test User (owner, system-admin), Home Assistant Content (system-read-only), LLAT |
| `.storage/auth_provider.homeassistant` | bcrypt hash for username `test` / password `test` |
| `.storage/core.config` | Vienna location, metric, Europe/Vienna timezone |
| `.storage/lovelace` | Default dashboard: tile+tile+gauge+entities cards |

**Storage format (HA 2026.3.x):**
- `auth` version 1 (NOT 7); groups have only `id`+`name` (no `policy`); credentials use `data.username` not `auth_provider_user_id`
- `auth_provider.homeassistant` version 1; `users` is an array (not object); password is base64-encoded bcrypt

**Regenerating fixtures:** If HA changes storage format, boot without `.storage/` files, use the REST API onboarding flow (see below), copy generated `.storage/` files. See `test/fixtures/README.md`.

---

## Playwright Auth Pattern

HA uses localStorage `hassTokens` for frontend authentication. The standard approach:

```typescript
// In global-setup.ts or addInitScript
async function getHassTokens(haUrl: string): Promise<string> {
  // 1. Start login flow
  const flow = await (await fetch(`${haUrl}/auth/login_flow`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: `${haUrl}/`, handler: ["homeassistant", null], redirect_uri: `${haUrl}/?auth_callback=1` }),
  })).json() as { flow_id: string };

  // 2. Submit credentials
  const cred = await (await fetch(`${haUrl}/auth/login_flow/${flow.flow_id}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "test", password: "test", client_id: `${haUrl}/` }),
  })).json() as { result: string };

  // 3. Exchange for tokens
  const t = await (await fetch(`${haUrl}/auth/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=authorization_code&code=${cred.result}&client_id=${encodeURIComponent(`${haUrl}/`)}`,
  })).json() as { access_token: string; token_type: string; refresh_token: string; expires_in: number };

  return JSON.stringify({
    access_token: t.access_token, token_type: t.token_type, refresh_token: t.refresh_token,
    expires_in: t.expires_in, hassUrl: haUrl, clientId: `${haUrl}/`,
    expires: Date.now() + t.expires_in * 1000,  // millisecond timestamp
  });
}

// Inject before page load using addInitScript
await context.addInitScript((tokens) => {
  localStorage.setItem("hassTokens", tokens);
}, await getHassTokens(HA_URL));

// Navigate — HA reads hassTokens on startup, navigates to /lovelace/*
await page.goto(HA_URL, { waitUntil: "domcontentloaded" });
await page.waitForURL((url) => url.pathname.startsWith("/lovelace"), { timeout: 30_000 });
```

**Why `addInitScript` not `localStorage.setItem` after goto:**
If you inject after page load you must `reload()` with `waitUntil: "networkidle"`. The `addInitScript` approach sets the value before HA's JS reads it, avoiding the reload.

**Auth file saved by global-setup:** `test/.auth/user.json` (gitignored). Contains localStorage state with `hassTokens`. Reused by all tests via `storageState` in playwright config or test `use:`.

---

## HA DOM Structure (HA 2026.3.x)

### Main page shadow DOM chain

```
document
 └─ <home-assistant>                      custom element (shadow root)
      └─ <home-assistant-main>            custom element (shadow root)
           ├─ <ha-snowflakes>             (seasonal decoration)
           ├─ <ha-drawer>                 layout container (shadow root)
           │   └─ [shadow: aside (sidebar), div (content slot)]
           ├─ <ha-sidebar>               navigation sidebar (shadow root)
           └─ <ha-panel-lovelace>         dashboard panel (shadow root)
                └─ <hui-root>             root Lovelace element (shadow root)
                     ├─ <ha-menu-button>  hamburger nav (slot: navigationIcon)
                     ├─ <ha-dropdown>     overflow menu (slot: actionItems)
                     ├─ ha-icon-button[id="button-1"]  Search (tooltip: "Search Home Assistant")
                     ├─ ha-icon-button[id="button-2"]  Assist  (tooltip: "Assist (A)")
                     ├─ ha-icon-button[id="button-3"]  Edit    (tooltip: "Edit dashboard")
                     └─ <hui-masonry-view>              card grid (shadow root)
                          └─ <hui-card>                 each card
                               └─ <hui-tile-card> / <hui-entities-card> / etc.
```

**Note:** `ha-panel-lovelace` is a direct child of `home-assistant-main.shadowRoot` (querySelector pierces into `ha-drawer`'s slot).

### Auth page (different from main page)

```
document
 └─ <ha-authorize>     rendered at /auth/authorize URL (NOT <home-assistant>)
```

### Edit mode additions

When URL has `?edit=1`, `hui-masonry-view.shadowRoot` gains:
- `<hui-card-options>` wrapping each card
  - `.shadowRoot`: `<ha-button>` "Edit" + `<ha-icon-button>` position controls
- `<ha-fab>` "Add card" (bottom-right)

### Card editor dialog

Opened by: clicking `ha-button` "Edit" in `hui-card-options.shadowRoot`
**Important:** Wait 8+ seconds after page load for WebSocket to be fully established before clicking Edit, then wait 5+ seconds for the dialog to appear.

The dialog is NOT in the regular DOM — it appears in `home-assistant.shadowRoot`:

```
home-assistant.shadowRoot
 └─ <hui-dialog-edit-card>                card editor dialog (shadow root)
      └─ <ha-dialog open="">              actual dialog
           ├─ [headerTitle] "Tile card configuration"
           ├─ div.content
           │    ├─ div.element-editor
           │    │    └─ <hui-card-element-editor>  (shadow root)
           │    │         └─ <hui-tile-card-editor> / <hui-entities-card-editor> / etc.
           │    │              └─ .shadowRoot
           │    │                   ├─ <ha-form>          (GUI form fields)
           │    │                   └─ <ha-expansion-panel>
           │    └─ div.element-preview
           │         └─ <hui-card preview="">  (live card preview)
           └─ <ha-dialog-footer>
                ├─ <ha-button class="gui-mode-button">  "Show code editor"
                ├─ <ha-button> "Cancel"
                └─ <ha-button> "Save"
```

**Switch GUI ↔ YAML:** Click `ha-button.gui-mode-button` ("Show code editor" / "Show visual editor").

---

## Playwright Shadow DOM Helpers

### Pierce helper (synchronous, for `page.evaluate`)

```javascript
function pierce(root, selector) {
  const el = root.querySelector(selector);
  if (el) return el;
  for (const child of root.querySelectorAll("*")) {
    if (child.shadowRoot) {
      const found = pierce(child.shadowRoot, selector);
      if (found) return found;
    }
  }
  return null;
}

// Usage: pierce(document, "ha-form")
// Usage: pierce(someElement.shadowRoot, "input[name='entity']")
```

### Playwright locators pierce shadow DOM automatically

```typescript
// Playwright's locator() pierces shadow DOM by default:
await page.locator("hui-card-options ha-button").first().click();
await page.locator("input[name='username']").fill("test");
// No special syntax needed for shadow DOM in locator()
```

### Common selectors (verified working)

| What | Selector / Path |
|------|----------------|
| HA connected | `page.waitForSelector("home-assistant", { state: "attached" })` |
| Dashboard loaded | `page.waitForURL(url => url.pathname.startsWith("/lovelace"))` |
| Panel in view | `page.locator("ha-panel-lovelace")` |
| Auth page | `page.waitForSelector("ha-authorize", { state: "attached" })` |
| Edit button (toolbar) | `hui-root.shadowRoot > ha-icon-button#button-3` |
| Card edit button | `hui-card-options ha-button` (text: "Edit") |
| Card editor dialog | `home-assistant.shadowRoot > hui-dialog-edit-card` |
| GUI/YAML toggle | `hui-dialog-edit-card >> ha-button.gui-mode-button` |
| Add card FAB | `pierce(document, "ha-fab")` |

---

## Entering / Exiting Edit Mode

```typescript
// Enter edit mode
await page.keyboard.press("e");
// OR click the pencil button in hui-root toolbar

// Verify
await page.waitForURL(url => url.search.includes("edit=1"), { timeout: 5_000 });

// Exit edit mode
await page.locator("text=Done").click();
// OR navigate away
```

---

## Opening a Card Editor (in Playwright tests)

```typescript
// 1. Navigate to dashboard in edit mode
await page.goto("/lovelace/home?edit=1");
await page.waitForURL(url => url.pathname.startsWith("/lovelace"));

// 2. Wait for WebSocket to be established (critical — 8s minimum)
await page.waitForTimeout(8_000);  // or wait for a specific WS event

// 3. Click the "Edit" button on the first card
await page.locator("hui-card-options ha-button").first().click();

// 4. Wait for dialog to appear (also takes a few seconds)
await page.waitForTimeout(5_000);

// 5. Verify dialog is open — it's in home-assistant.shadowRoot, not regular DOM
const dialogOpen = await page.evaluate(() => {
  const ha = document.querySelector("home-assistant");
  const dialog = ha?.shadowRoot?.querySelector("hui-dialog-edit-card");
  return !!dialog?.shadowRoot?.querySelector("ha-dialog[open]");
});
```

---

## HA REST API (for test setup scripts)

```bash
# Health check
curl http://localhost:18123/api/            # {"message":"API running."}

# Login flow (returns access_token + refresh_token)
FLOW_ID=$(curl -s -XPOST http://localhost:18123/auth/login_flow \
  -H "Content-Type: application/json" \
  -d '{"client_id":"http://localhost:18123/","handler":["homeassistant",null],"redirect_uri":"http://localhost:18123/?auth_callback=1"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['flow_id'])")

CODE=$(curl -s -XPOST "http://localhost:18123/auth/login_flow/$FLOW_ID" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"test\",\"password\":\"test\",\"client_id\":\"http://localhost:18123/\"}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result'])")

TOKEN=$(curl -s -XPOST http://localhost:18123/auth/token \
  -d "grant_type=authorization_code&code=$CODE&client_id=http%3A%2F%2Flocalhost%3A18123%2F" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# List all states
curl -s http://localhost:18123/api/states -H "Authorization: Bearer $TOKEN"

# Create long-lived token (via WebSocket, not REST)
```

---

## Demo Entities (from `demo:` integration)

| Entity ID | Domain | State |
|-----------|--------|-------|
| `light.ceiling_lights` | light | on (71%) |
| `light.bed_light` | light | off |
| `light.kitchen_lights` | light | on |
| `light.living_room_rgbww_lights` | light | on |
| `light.entrance_color_white_lights` | light | on |
| `light.office_rgbw_lights` | light | on |
| `climate.hvac` | climate | cool (22°C) |
| `climate.heatpump` | climate | heat |
| `climate.ecobee` | climate | heat_cool |
| `sensor.outside_temperature` | sensor | 15.6°C |
| `sensor.outside_humidity` | sensor | 54% |
| `sensor.carbon_dioxide` | sensor | 54 |
| `sensor.power_consumption` | sensor | 100 |
| `binary_sensor.movement_backyard` | binary_sensor | on |
| `binary_sensor.basement_floor_wet` | binary_sensor | off |
| `media_player.living_room` | media_player | playing |
| `media_player.bedroom` | media_player | playing |
| `cover.hall_window` | cover | open |
| `cover.garage_door` | cover | closed |
| `fan.living_room_fan` | fan | off |
| `alarm_control_panel.security` | alarm | disarmed |

---

## HA Onboarding via REST API (for fixture regeneration)

```bash
# 1. Create first user
curl -XPOST http://localhost:18123/api/onboarding/users \
  -H "Content-Type: application/json" \
  -d '{"client_id":"http://localhost:18123/","name":"Test User","username":"test","password":"test","language":"en"}'
# → {"auth_code":"..."}

# 2. Exchange for tokens
TOKEN=$(curl -s -XPOST http://localhost:18123/auth/token \
  -d "grant_type=authorization_code&code=<auth_code>&client_id=http%3A%2F%2Flocalhost%3A18123%2F" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# 3. Complete remaining onboarding steps
curl -XPOST http://localhost:18123/api/onboarding/core_config \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"http://localhost:18123/"}'
curl -XPOST http://localhost:18123/api/onboarding/analytics ...
curl -XPOST http://localhost:18123/api/onboarding/integration ...
```

---

## Known Timing Issues / Quirks

- **WebSocket setup:** HA's WebSocket connects within ~3s of page load, but card editor features (lazy-loaded dialogs) need 8+ seconds total
- **Dialog location:** `hui-dialog-edit-card` is a sibling of `home-assistant-main` in `home-assistant.shadowRoot`, NOT nested under `hui-root`
- **Auth page vs main page:** `/auth/authorize` renders `<ha-authorize>`, main page renders `<home-assistant>` — different root selectors
- **Edit mode URL:** Adding `?edit=1` directly to the URL enters edit mode on load (no need to click the button)
- **`ha-panel-lovelace` not in `partial-panel-resolver`:** Despite the component name, `ha-panel-lovelace` is a direct child of `home-assistant-main.shadowRoot`, not inside `partial-panel-resolver.shadowRoot`

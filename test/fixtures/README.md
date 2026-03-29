# Test Fixtures

Pre-seeded Home Assistant configuration for the e2e test suite.

## Directory layout

```
ha-config/
  configuration.yaml          # HA config: demo integration, CORS enabled
  .storage/
    onboarding                # Marks onboarding as complete (skips wizard)
    auth                      # User accounts (Test User, owner)
    auth_provider.homeassistant  # Hashed credentials for username/password login
    core.config               # Timezone, location, unit system
    lovelace                  # Default Lovelace dashboard with stock cards
    lovelace.mosaic_test      # Named dashboard alias (same content)
```

## Credentials

| Field    | Value      |
|----------|------------|
| URL      | http://localhost:18123 |
| Username | `test`     |
| Password | `test`     |

## How the pre-seeded files were generated

The `.storage/` files were hand-crafted to match Home Assistant's internal storage schema:

- `onboarding`: Marks all five onboarding steps as complete so HA skips the wizard on first boot.
- `auth`: Contains a single owner user (`Test User`, UUID `a0000000-0000-4000-8000-000000000001`) with group membership in `system-users`. No refresh tokens — Playwright logs in fresh each run via the login form.
- `auth_provider.homeassistant`: Contains the bcrypt-hashed password for username `test` / password `test` (12 rounds, generated with Python `bcrypt`).
- `core.config`: Timezone `Europe/Vienna`, metric units, Vienna coordinates.
- `lovelace`: Default dashboard with tile cards (lights, climate), a gauge (temperature sensor), and an entities card. All entities come from the `demo:` integration.

## Regenerating fixtures

If the HA storage format changes across versions and fixtures stop working:

1. Remove the `.storage/` directory content (keep `configuration.yaml`).
2. Start the container: `docker compose -f docker-compose.test.yml up -d --wait`
3. Open `http://localhost:18123` in a browser and complete the onboarding wizard:
   - Create user: `test` / `test`
   - Location: any
   - Finish setup
4. In HA: Profile → Long-lived access tokens → Create token named `test-token`
5. Copy the `.storage/` files back to `test/fixtures/ha-config/.storage/`
6. Update the long-lived token in `test/e2e/global-setup.ts` if used

## Demo entities available

These entities are created by the `demo:` integration and are available in tests:

| Entity ID                        | Type    | Description            |
|----------------------------------|---------|------------------------|
| `light.ceiling_lights`           | light   | Dimmable ceiling light |
| `light.bed_light`                | light   | Bed lamp               |
| `light.kitchen_lights`           | light   | Kitchen lights         |
| `switch.decorative_lights`       | switch  | Decorative switch      |
| `climate.hvac`                   | climate | HVAC unit              |
| `sensor.outside_temperature`     | sensor  | Temperature (°C)       |
| `sensor.outside_humidity`        | sensor  | Humidity (%)           |
| `media_player.living_room`       | media   | Living room player     |
| `media_player.bedroom`           | media   | Bedroom player         |

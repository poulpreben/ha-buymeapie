# Buy Me a Pie for Home Assistant

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
[![](https://my.home-assistant.io/badges/config_flow_start.svg)](https://my.home-assistant.io/redirect/config_flow_start/?domain=buymeapie)

A Home Assistant custom integration for the [Buy Me a Pie](https://buymeapie.com) shopping list service. Syncs your shopping lists as todo entities with a custom Lovelace card featuring autocomplete from your item history.

## Features

- **Todo entities** for each Buy Me a Pie shopping list (Shopping list, Krea, Amazon, etc.)
- **Custom Lovelace card** with autocomplete from your 2000+ item history
- **Quantity parsing** matching the real app: `Mælk 2 l`, `Bread: 1 loaf`, or add multiple items with `Milk, Eggs, Bread`
- **Category colors** from Buy Me a Pie (29 color groups) shown in autocomplete suggestions
- **Voice control** via Home Assistant Assist: "Add milk to shopping list"
- **Optimistic UI** - items toggle and delete instantly
- Supports **light mode, dark mode**, and custom theme colors
- Optional **custom API endpoint** for self-hosted or mock servers

## Installation

### HACS (recommended)

[![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=poulpreben&repository=ha-buymeapie&category=integration)

Or manually:

1. Open HACS in Home Assistant
2. Go to **Integrations** > **Custom repositories**
3. Add this repository URL and select **Integration** as the category
4. Click **Download**
5. Restart Home Assistant

### Manual

1. Copy `custom_components/buymeapie/` to your Home Assistant `config/custom_components/` directory
2. Restart Home Assistant

## Configuration

1. Go to **Settings** > **Devices & Services** > **Add Integration**
2. Search for **Buy Me a Pie**
3. Enter your Buy Me a Pie **login** and **PIN** (4-digit)
4. Optionally set a custom API URL (for self-hosted mock servers)

## Lovelace Card

The card is automatically registered. Add it to any dashboard:

### Via UI
- Edit dashboard > Add Card > search "Buy Me a Pie"

### Via YAML
```yaml
type: custom:buymeapie-card
entity: todo.shopping_list
show_completed: true
```

### Card features
- **Autocomplete** - type to search your item history with category color dots and usage counts
- **Quantity support** - type `Mælk 2 l` or `Bread: 1 loaf` to set amounts
- **Multi-add** - type `Milk, Eggs, Bread` to add three items at once
- **Click to toggle** - click any item to check/uncheck it
- **Hover to delete** - hover over an item to reveal the delete button

## Development

### Prerequisites

- [Podman](https://podman.io/) (or Docker)
- [uv](https://docs.astral.sh/uv/)

### Quick start

```bash
# Dump your real Buy Me a Pie account data (optional, for realistic mock data)
uv run dump_account.py

# Start mock API + Home Assistant
podman compose up -d --build

# Home Assistant: http://localhost:8123
# Mock API: http://localhost:8080
```

### Mock API

The mock API server (`mock_server/`) implements the full Buy Me a Pie API with:
- Basic Auth (any login + 4-digit PIN)
- Seed data from `bmap_dump.json` (if present) or minimal fallback
- Soft-delete with item revival on re-add
- Autocomplete dictionary (unique items)

### Running tests

```bash
npx playwright install chromium
npx playwright test --config tests/e2e/playwright.config.js
```

## API

The integration uses the unofficial Buy Me a Pie API at `https://api.buymeapie.com`. See `openapi.json` for the full specification (reverse-engineered from the web app).

## License

MIT

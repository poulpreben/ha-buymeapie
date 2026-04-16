# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.0.0] - 2026-04-16

First release targeting the Home Assistant [Integration Quality Scale](https://developers.home-assistant.io/docs/core/integration-quality-scale/) Bronze tier.

### Added

- `quality_scale: bronze` declared in `manifest.json`.
- `DeviceInfo` on each todo entity so all shopping lists for an account are grouped under a single hub device in the device registry.
- Separate `unknown` config-flow error distinct from `cannot_connect`, with translations.
- GitHub Actions workflow running `hassfest` and `hacs/action` on push, PR and nightly schedule.
- README "Removal" section documenting how to cleanly uninstall the integration.

### Changed

- **Breaking (internal):** Coordinator is now stored on `ConfigEntry.runtime_data` instead of `hass.data[DOMAIN][entry_id]`. External code that reached into `hass.data["buymeapie"]` will break; use the typed `BuyMeAPieConfigEntry` alias from `coordinator.py` instead.
- Config entry title is now just the login (e.g. `user@example.com`) rather than `Buy Me a Pie (user@example.com)` — the brand name is already rendered by Home Assistant.
- Authentication failures surfaced by the coordinator now raise `ConfigEntryAuthFailed` instead of `UpdateFailed`, paving the way for a reauth flow in a future Silver-tier release.
- WebSocket commands resolve the coordinator via `hass.config_entries.async_entries(DOMAIN)` and check `ConfigEntryState.LOADED` rather than reading `hass.data`.

### Fixed

- Config-flow exception handling: the previous `except (aiohttp.ClientError, Exception)` tuple silently degraded every unexpected error into `cannot_connect`. Connection errors now map to `cannot_connect`; truly unexpected errors map to `unknown` and are logged via `_LOGGER.exception`.

[Unreleased]: https://github.com/poulpreben/ha-buymeapie/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/poulpreben/ha-buymeapie/releases/tag/v2.0.0

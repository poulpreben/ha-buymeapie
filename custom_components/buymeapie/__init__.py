"""The Buy Me a Pie integration."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BuyMeAPieApi
from .const import CONF_API_URL, CONF_LOGIN, CONF_PIN, DEFAULT_API_BASE_URL, DOMAIN
from .coordinator import BuyMeAPieCoordinator
from .websocket import async_register_commands

_LOGGER = logging.getLogger(__name__)

PLATFORMS: list[Platform] = [Platform.TODO]

CARD_VERSION = "1.2.0"
CARD_URL = f"/api/{DOMAIN}/buymeapie-card.js"
CARD_PATH = Path(__file__).parent / "buymeapie-card.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Buy Me a Pie component."""
    async_register_commands(hass)

    # Serve the Lovelace card JS file
    await hass.http.async_register_static_paths(
        [StaticPathConfig(url_path=CARD_URL, path=str(CARD_PATH), cache_headers=False)]
    )

    # Register as a Lovelace resource so cards load BEFORE rendering.
    # This eliminates the race condition that add_extra_js_url has.
    url = f"{CARD_URL}?v={CARD_VERSION}"
    await _register_lovelace_resource(hass, url)

    return True


async def _register_lovelace_resource(hass: HomeAssistant, url: str) -> None:
    """Register the card JS as a Lovelace resource."""
    try:
        # Access the lovelace resources collection
        lovelace = hass.data.get("lovelace")
        if lovelace is None:
            _LOGGER.debug("Lovelace not available, falling back to add_extra_js_url")
            _fallback_extra_js(hass, url)
            return

        resources = lovelace.resources
        if resources is None:
            _LOGGER.debug("Lovelace resources not available, falling back")
            _fallback_extra_js(hass, url)
            return

        # Ensure resources are loaded
        if not resources.loaded:
            await resources.async_load()
            resources.loaded = True

        # Check if already registered (by URL path, ignoring version query)
        base_url = CARD_URL
        existing = None
        for item in resources.async_items():
            if item.get("url", "").split("?")[0] == base_url:
                existing = item
                break

        if existing:
            # Update version if changed
            if existing.get("url") != url:
                await resources.async_update_item(
                    existing["id"], {"url": url, "res_type": "module"}
                )
                _LOGGER.debug("Updated Lovelace resource: %s", url)
        else:
            # Register new resource
            await resources.async_create_item({"res_type": "module", "url": url})
            _LOGGER.info("Registered Lovelace resource: %s", url)

    except Exception:
        _LOGGER.debug("Lovelace resource registration failed, falling back", exc_info=True)
        _fallback_extra_js(hass, url)


def _fallback_extra_js(hass: HomeAssistant, url: str) -> None:
    """Fallback: use add_extra_js_url if Lovelace resource registration fails."""
    from homeassistant.components.frontend import add_extra_js_url
    add_extra_js_url(hass, url)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Buy Me a Pie from a config entry."""
    session = async_get_clientsession(hass)
    api = BuyMeAPieApi(
        login=entry.data[CONF_LOGIN],
        pin=entry.data[CONF_PIN],
        session=session,
        api_url=entry.data.get(CONF_API_URL, DEFAULT_API_BASE_URL),
    )

    coordinator = BuyMeAPieCoordinator(hass, api)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = coordinator

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if unload_ok := await hass.config_entries.async_unload_platforms(
        entry, PLATFORMS
    ):
        hass.data[DOMAIN].pop(entry.entry_id)

    return unload_ok

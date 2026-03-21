"""The Buy Me a Pie integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BuyMeAPieApi
from .const import CONF_API_URL, CONF_LOGIN, CONF_PIN, DEFAULT_API_BASE_URL, DOMAIN
from .coordinator import BuyMeAPieCoordinator
from .websocket import async_register_commands

PLATFORMS: list[Platform] = [Platform.TODO]

CARD_URL = f"/api/{DOMAIN}/buymeapie-card.js"
CARD_PATH = Path(__file__).parent / "buymeapie-card.js"


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the Buy Me a Pie component."""
    # Register websocket commands (once, not per entry)
    async_register_commands(hass)

    # Serve the Lovelace card JS
    await hass.http.async_register_static_paths(
        [StaticPathConfig(url_path=CARD_URL, path=str(CARD_PATH), cache_headers=False)]
    )
    add_extra_js_url(hass, f"{CARD_URL}?v=1.1.1")

    return True


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

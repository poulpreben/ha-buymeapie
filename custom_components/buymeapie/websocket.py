"""WebSocket API for Buy Me a Pie integration."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN

if TYPE_CHECKING:
    from .coordinator import BuyMeAPieCoordinator


def async_register_commands(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, handle_autocomplete)
    websocket_api.async_register_command(hass, handle_categories)


def _get_coordinator(
    hass: HomeAssistant, entry_id: str
) -> BuyMeAPieCoordinator | None:
    """Resolve a loaded coordinator by entry_id, or the first loaded one."""
    if entry_id:
        entry = hass.config_entries.async_get_entry(entry_id)
        if entry is None or entry.state is not ConfigEntryState.LOADED:
            return None
        return entry.runtime_data
    for entry in hass.config_entries.async_entries(DOMAIN):
        if entry.state is ConfigEntryState.LOADED:
            return entry.runtime_data
    return None


@websocket_api.websocket_command(
    {
        vol.Required("type"): "buymeapie/autocomplete",
        vol.Optional("entry_id", default=""): str,
        vol.Optional("query", default=""): str,
        vol.Optional("limit", default=10): int,
    }
)
@callback
def handle_autocomplete(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return autocomplete suggestions from unique_items dictionary."""
    entry_id = msg.get("entry_id", "")
    query = msg["query"].lower().strip()
    limit = msg["limit"]

    coordinator = _get_coordinator(hass, entry_id)
    if coordinator is None:
        connection.send_result(msg["id"], [])
        return

    unique_items: dict[str, dict[str, Any]] = coordinator.data.get(
        "unique_items", {}
    )

    if not query:
        # Return most-used items when no query
        results = sorted(
            unique_items.values(),
            key=lambda x: x.get("use_count", 0),
            reverse=True,
        )[:limit]
    else:
        # Filter by prefix match, then substring match
        prefix = []
        substring = []
        for title_lower, item in unique_items.items():
            if title_lower.startswith(query):
                prefix.append(item)
            elif query in title_lower:
                substring.append(item)

        prefix.sort(key=lambda x: x.get("use_count", 0), reverse=True)
        substring.sort(key=lambda x: x.get("use_count", 0), reverse=True)
        results = (prefix + substring)[:limit]

    connection.send_result(
        msg["id"],
        [
            {
                "title": item.get("title", ""),
                "group_id": item.get("group_id", 0),
                "use_count": item.get("use_count", 0),
            }
            for item in results
        ],
    )


@websocket_api.websocket_command(
    {
        vol.Required("type"): "buymeapie/categories",
        vol.Optional("entry_id", default=""): str,
    }
)
@callback
def handle_categories(
    hass: HomeAssistant,
    connection: websocket_api.ActiveConnection,
    msg: dict[str, Any],
) -> None:
    """Return a title -> group_id map for all unique items."""
    entry_id = msg.get("entry_id", "")
    coordinator = _get_coordinator(hass, entry_id)
    if coordinator is None:
        connection.send_result(msg["id"], {})
        return

    unique_items: dict[str, dict[str, Any]] = coordinator.data.get(
        "unique_items", {}
    )
    # Return lowercase title -> group_id map
    result = {
        key: item.get("group_id", 0) for key, item in unique_items.items()
    }
    connection.send_result(msg["id"], result)

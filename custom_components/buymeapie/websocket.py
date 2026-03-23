"""WebSocket API for Buy Me a Pie integration."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


def async_register_commands(hass: HomeAssistant) -> None:
    """Register WebSocket commands."""
    websocket_api.async_register_command(hass, handle_autocomplete)
    websocket_api.async_register_command(hass, handle_categories)


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

    domain_data = hass.data.get(DOMAIN, {})
    if entry_id:
        coordinator = domain_data.get(entry_id)
    else:
        # Use the first available entry
        coordinator = next(iter(domain_data.values()), None)
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
    domain_data = hass.data.get(DOMAIN, {})
    if entry_id:
        coordinator = domain_data.get(entry_id)
    else:
        coordinator = next(iter(domain_data.values()), None)
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

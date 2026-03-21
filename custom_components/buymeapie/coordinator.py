"""DataUpdateCoordinator for Buy Me a Pie."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import BuyMeAPieApi, BuyMeAPieApiError, BuyMeAPieAuthError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)


class BuyMeAPieCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to fetch Buy Me a Pie lists and items."""

    def __init__(self, hass: HomeAssistant, api: BuyMeAPieApi) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch all lists and their items from the API."""
        try:
            lists = await self.api.get_lists()
        except BuyMeAPieAuthError as err:
            raise UpdateFailed(f"Authentication failed: {err}") from err
        except BuyMeAPieApiError as err:
            raise UpdateFailed(f"Error fetching lists: {err}") from err

        try:
            unique_items = await self.api.get_unique_items()
        except BuyMeAPieApiError as err:
            _LOGGER.warning("Error fetching unique items: %s", err)
            unique_items = []

        # Build lookup: title -> unique item data (case-insensitive)
        # Keep the entry with the highest use_count for each key
        # (the API may have duplicates like "Agurk" and "agurk")
        unique_lookup: dict[str, dict[str, Any]] = {}
        for item in unique_items:
            if item.get("deleted", False):
                continue
            key = item["title"].lower()
            existing = unique_lookup.get(key)
            if existing is None or item.get("use_count", 0) > existing.get("use_count", 0):
                unique_lookup[key] = item

        data: dict[str, Any] = {"lists": {}, "unique_items": unique_lookup}

        for shopping_list in lists:
            list_id = shopping_list["id"]
            try:
                items = await self.api.get_items(list_id)
            except BuyMeAPieApiError as err:
                _LOGGER.warning(
                    "Error fetching items for list %s: %s", list_id, err
                )
                items = []

            # Filter out soft-deleted items
            active_items = [
                item for item in items if not item.get("deleted", False)
            ]

            data["lists"][list_id] = {
                "info": shopping_list,
                "items": active_items,
            }

        return data

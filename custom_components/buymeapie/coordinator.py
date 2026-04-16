"""DataUpdateCoordinator for Buy Me a Pie."""

from __future__ import annotations

from datetime import timedelta
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import BuyMeAPieApi, BuyMeAPieApiError, BuyMeAPieAuthError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)

type BuyMeAPieConfigEntry = ConfigEntry[BuyMeAPieCoordinator]


class BuyMeAPieCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Coordinator to fetch Buy Me a Pie lists and items."""

    config_entry: BuyMeAPieConfigEntry

    def __init__(
        self,
        hass: HomeAssistant,
        config_entry: BuyMeAPieConfigEntry,
        api: BuyMeAPieApi,
    ) -> None:
        """Initialize the coordinator."""
        super().__init__(
            hass,
            _LOGGER,
            config_entry=config_entry,
            name=DOMAIN,
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.api = api

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch all lists and their items from the API."""
        try:
            lists = await self.api.get_lists()
        except BuyMeAPieAuthError as err:
            raise ConfigEntryAuthFailed(f"Authentication failed: {err}") from err
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

            # Filter out soft-deleted items, sort by updated_at descending
            active_items = sorted(
                (item for item in items if not item.get("deleted", False)),
                key=lambda x: x.get("updated_at", 0),
                reverse=True,
            )

            data["lists"][list_id] = {
                "info": shopping_list,
                "items": active_items,
            }

        return data

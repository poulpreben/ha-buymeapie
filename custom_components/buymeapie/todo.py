"""Todo platform for Buy Me a Pie integration."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import BuyMeAPieCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up Buy Me a Pie todo entities from a config entry."""
    coordinator: BuyMeAPieCoordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[BuyMeAPieTodoListEntity] = []
    for list_id, list_data in coordinator.data["lists"].items():
        entities.append(
            BuyMeAPieTodoListEntity(
                coordinator=coordinator,
                list_id=list_id,
                list_name=list_data["info"]["name"],
                entry_id=entry.entry_id,
            )
        )

    async_add_entities(entities)


class BuyMeAPieTodoListEntity(CoordinatorEntity[BuyMeAPieCoordinator], TodoListEntity):
    """A Buy Me a Pie shopping list as a Home Assistant todo entity."""

    _attr_has_entity_name = True
    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )

    def __init__(
        self,
        coordinator: BuyMeAPieCoordinator,
        list_id: str,
        list_name: str,
        entry_id: str,
    ) -> None:
        """Initialize the todo list entity."""
        super().__init__(coordinator)
        self._list_id = list_id
        self._attr_name = list_name
        self._attr_unique_id = f"{entry_id}_{list_id}"

    @property
    def todo_items(self) -> list[TodoItem] | None:
        """Return the todo items for this list."""
        if (
            self.coordinator.data is None
            or self._list_id not in self.coordinator.data.get("lists", {})
        ):
            return None

        items = self.coordinator.data["lists"][self._list_id]["items"]
        return [
            TodoItem(
                uid=item["id"],
                summary=item.get("title", ""),
                description=item.get("amount", ""),
                status=(
                    TodoItemStatus.COMPLETED
                    if item.get("is_purchased", False)
                    else TodoItemStatus.NEEDS_ACTION
                ),
            )
            for item in items
        ]

    async def async_create_todo_item(self, item: TodoItem) -> None:
        """Create a new todo item.

        Looks up the item title in the unique_items dictionary to
        auto-fill group_id (category) from previous usage.
        """
        title = item.summary or ""
        group_id: int | None = None
        unique_items = self.coordinator.data.get("unique_items", {})
        match = unique_items.get(title.lower())
        if match is not None:
            group_id = match.get("group_id")

        await self.coordinator.api.add_item(
            list_id=self._list_id,
            title=title,
            amount=item.description,
            group_id=group_id,
        )
        await self.coordinator.async_request_refresh()

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Update an existing todo item."""
        if item.uid is None:
            return

        is_purchased: bool | None = None
        if item.status is not None:
            is_purchased = item.status == TodoItemStatus.COMPLETED

        await self.coordinator.api.update_item(
            list_id=self._list_id,
            item_id=item.uid,
            title=item.summary,
            amount=item.description,
            is_purchased=is_purchased,
        )
        await self.coordinator.async_request_refresh()

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        """Delete todo items."""
        for uid in uids:
            await self.coordinator.api.delete_item(
                list_id=self._list_id,
                item_id=uid,
            )
        await self.coordinator.async_request_refresh()

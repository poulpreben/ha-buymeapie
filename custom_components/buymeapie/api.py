"""Async API client for Buy Me a Pie."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp

from .const import DEFAULT_API_BASE_URL

_LOGGER = logging.getLogger(__name__)


class BuyMeAPieApiError(Exception):
    """Base exception for API errors."""


class BuyMeAPieAuthError(BuyMeAPieApiError):
    """Authentication error."""


class BuyMeAPieApi:
    """Async API client for Buy Me a Pie shopping list service."""

    def __init__(
        self,
        login: str,
        pin: str,
        session: aiohttp.ClientSession,
        api_url: str = DEFAULT_API_BASE_URL,
    ) -> None:
        """Initialize the API client."""
        self._login = login
        self._pin = pin
        self._session = session
        self._auth = aiohttp.BasicAuth(login, pin)
        self._api_url = api_url.rstrip("/")

    async def _request(
        self,
        method: str,
        path: str,
        json_data: dict[str, Any] | None = None,
    ) -> Any:
        """Make an authenticated request to the API."""
        url = f"{self._api_url}{path}"
        headers = {"Content-Type": "application/json"}

        try:
            async with self._session.request(
                method,
                url,
                auth=self._auth,
                headers=headers,
                json=json_data,
            ) as resp:
                if resp.status == 401:
                    raise BuyMeAPieAuthError("Invalid credentials")
                resp.raise_for_status()
                if resp.status == 204:
                    return None
                return await resp.json()
        except aiohttp.ClientError as err:
            if isinstance(err, aiohttp.ClientResponseError) and err.status == 401:
                raise BuyMeAPieAuthError("Invalid credentials") from err
            raise BuyMeAPieApiError(f"API request failed: {err}") from err

    async def authenticate(self) -> dict[str, Any]:
        """Validate credentials. Returns user info on success."""
        return await self._request("GET", "/bauth")

    async def get_lists(self) -> list[dict[str, Any]]:
        """Get all shopping lists."""
        return await self._request("GET", "/lists")

    async def get_items(self, list_id: str) -> list[dict[str, Any]]:
        """Get all items in a list."""
        return await self._request("GET", f"/lists/{list_id}/items")

    async def get_unique_items(self) -> list[dict[str, Any]]:
        """Get all unique items (autocomplete dictionary)."""
        return await self._request("GET", "/unique_items")

    async def add_item(
        self,
        list_id: str,
        title: str,
        amount: str | None = None,
        group_id: int | None = None,
    ) -> dict[str, Any]:
        """Add an item to a list."""
        data: dict[str, Any] = {"title": title, "is_purchased": False}
        if amount:
            data["amount"] = amount
        if group_id is not None:
            data["group_id"] = group_id
        return await self._request("POST", f"/lists/{list_id}/items", json_data=data)

    async def update_item(
        self,
        list_id: str,
        item_id: str,
        title: str | None = None,
        amount: str | None = None,
        is_purchased: bool | None = None,
    ) -> dict[str, Any]:
        """Update an item in a list."""
        data: dict[str, Any] = {}
        if title is not None:
            data["title"] = title
        if amount is not None:
            data["amount"] = amount
        if is_purchased is not None:
            data["is_purchased"] = is_purchased
        return await self._request(
            "PUT", f"/lists/{list_id}/items/{item_id}", json_data=data
        )

    async def delete_item(self, list_id: str, item_id: str) -> None:
        """Delete an item from a list."""
        await self._request("DELETE", f"/lists/{list_id}/items/{item_id}")

"""Config flow for Buy Me a Pie integration."""

from __future__ import annotations

import logging
from typing import Any

import aiohttp
import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import BuyMeAPieApi, BuyMeAPieAuthError
from .const import CONF_API_URL, CONF_LOGIN, CONF_PIN, DEFAULT_API_BASE_URL, DOMAIN

_LOGGER = logging.getLogger(__name__)

STEP_USER_DATA_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_LOGIN): str,
        vol.Required(CONF_PIN): str,
        vol.Optional(CONF_API_URL, default=DEFAULT_API_BASE_URL): str,
    }
)


class BuyMeAPieConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Buy Me a Pie."""

    VERSION = 1

    async def async_step_user(
        self,
        user_input: dict[str, Any] | None = None,
    ) -> ConfigFlowResult:
        """Handle the initial step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            login = user_input[CONF_LOGIN]
            pin = user_input[CONF_PIN]
            api_url = user_input.get(CONF_API_URL, DEFAULT_API_BASE_URL)

            await self.async_set_unique_id(login)
            self._abort_if_unique_id_configured()

            session = async_get_clientsession(self.hass)
            api = BuyMeAPieApi(login, pin, session, api_url=api_url)

            try:
                await api.authenticate()
            except BuyMeAPieAuthError:
                errors["base"] = "invalid_auth"
            except (aiohttp.ClientError, Exception):
                _LOGGER.exception("Unexpected error during authentication")
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title=f"Buy Me a Pie ({login})",
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=STEP_USER_DATA_SCHEMA,
            errors=errors,
        )

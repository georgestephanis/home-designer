"""Config flow for Home Designer: one entry, nothing to configure."""
from __future__ import annotations

from typing import Any

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult

from .const import DOMAIN


class HomeDesignerConfigFlow(ConfigFlow, domain=DOMAIN):
    """Add Home Designer."""

    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="user")
        return self.async_create_entry(title="Home Designer", data={})

"""Home Designer: a floor-plan editor and dashboard card for Home Assistant.

The plan is one document kept in .storage/home_designer (so it's in Home Assistant's backups),
with the last few saved versions kept beside it in .storage/home_designer.history. The editor
is a sidebar panel for admins; the card, loaded on every frontend page, shows the plan live.
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

import voluptuous as vol

from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import (
    DOMAIN, FRONTEND_FILE, HISTORY_KEEP, MAX_DOC_BYTES, PANEL_ELEMENT, PANEL_URL, URL_BASE,
)

_LOGGER = logging.getLogger(__name__)
FRONTEND_DIR = Path(__file__).parent / "frontend"


class PlanStore:
    """The saved plan, its revision, and whoever's listening for new ones."""

    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, 1, DOMAIN)
        self._history: Store[dict[str, Any]] = Store(hass, 1, f"{DOMAIN}.history")
        self.data: dict[str, Any] = {"rev": 0, "doc": None}
        self._listeners: list[Callable[[dict[str, Any]], None]] = []

    async def async_load(self) -> None:
        if (data := await self._store.async_load()) is not None:
            self.data = data

    async def async_save(self, doc: dict[str, Any], user_id: str | None) -> int:
        if self.data.get("doc") is not None:
            old = await self._history.async_load() or {"versions": []}
            old["versions"] = ([self.data] + old["versions"])[:HISTORY_KEEP]
            await self._history.async_save(old)
        self.data = {"rev": self.data["rev"] + 1, "doc": doc,
                     "saved_at": dt_util.utcnow().isoformat(), "saved_by": user_id}
        await self._store.async_save(self.data)
        for listener in list(self._listeners):
            listener(self.data)
        return self.data["rev"]

    @callback
    def listen(self, listener: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)


def _public(data: dict[str, Any]) -> dict[str, Any]:
    return {"rev": data["rev"], "doc": data.get("doc"), "saved_at": data.get("saved_at")}


def _store(hass: HomeAssistant) -> PlanStore | None:
    return hass.data.get(DOMAIN, {}).get("store")


@websocket_api.websocket_command({vol.Required("type"): "home_designer/get"})
@callback
def ws_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if (store := _store(hass)) is None:
        connection.send_error(msg["id"], "not_loaded", "Home Designer isn't set up")
        return
    connection.send_result(msg["id"], _public(store.data))


@websocket_api.websocket_command({vol.Required("type"): "home_designer/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Sends the saved plan now, then again after every save."""
    if (store := _store(hass)) is None:
        connection.send_error(msg["id"], "not_loaded", "Home Designer isn't set up")
        return

    @callback
    def forward(data: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], _public(data)))

    connection.subscriptions[msg["id"]] = store.listen(forward)
    connection.send_result(msg["id"])
    forward(store.data)


@websocket_api.websocket_command({
    vol.Required("type"): "home_designer/save",
    vol.Required("doc"): dict,
    # The revision the editor started from; -1 replaces whatever is there.
    vol.Required("rev"): int,
})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_save(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    if (store := _store(hass)) is None:
        connection.send_error(msg["id"], "not_loaded", "Home Designer isn't set up")
        return
    doc = msg["doc"]
    if doc.get("app") != "home-designer" or not isinstance(doc.get("levels"), list):
        connection.send_error(msg["id"], "invalid_format", "That isn't a Home Designer plan")
        return
    if len(json.dumps(doc)) > MAX_DOC_BYTES:
        connection.send_error(msg["id"], "invalid_format", "That plan is too big to save")
        return
    if msg["rev"] != -1 and msg["rev"] != store.data["rev"]:
        connection.send_error(msg["id"], "conflict", "The plan was saved from somewhere else")
        return
    rev = await store.async_save(doc, connection.user.id if connection.user else None)
    connection.send_result(msg["id"], {"rev": rev})


def _version(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:10] if path.exists() else "0"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data.setdefault(DOMAIN, {})
    store = PlanStore(hass)
    await store.async_load()
    data["store"] = store

    if not data.get("registered"):
        # Static routes and websocket commands can't be removed again, so they're added once.
        await hass.http.async_register_static_paths([StaticPathConfig(URL_BASE, str(FRONTEND_DIR), False)])
        for command in (ws_get, ws_subscribe, ws_save):
            websocket_api.async_register_command(hass, command)
        data["registered"] = True

    version = await hass.async_add_executor_job(_version, FRONTEND_DIR / FRONTEND_FILE)
    url = f"{URL_BASE}/{FRONTEND_FILE}?v={version}"
    data["js_url"] = url
    # The card has to be defined on every page that might show a dashboard.
    frontend.add_extra_js_url(hass, url)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL,
        webcomponent_name=PANEL_ELEMENT,
        module_url=url,
        sidebar_title="Floor plan",
        sidebar_icon="mdi:floor-plan",
        require_admin=True,
        config={},
    )
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data = hass.data[DOMAIN]
    frontend.async_remove_panel(hass, PANEL_URL)
    if url := data.pop("js_url", None):
        frontend.remove_extra_js_url(hass, url)
    data.pop("store", None)
    return True

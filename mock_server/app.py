"""Mock API server for Buy Me a Pie, implementing the OpenAPI spec."""

from __future__ import annotations

import base64
import re
import time
import uuid
from typing import Any
from urllib.parse import unquote

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import Response

app = FastAPI(title="Buy Me a Pie Mock API", version="0.1.0")

# ---------------------------------------------------------------------------
# In-memory storage
# ---------------------------------------------------------------------------

users: dict[str, dict[str, Any]] = {
    "demo": {
        "login": "demo",
        "pin": "1234",
        "email": "demo@example.com",
        "subscription_status": "free",
    }
}

_now = int(time.time())

lists_db: dict[str, dict[str, Any]] = {
    "list-1": {
        "id": "list-1",
        "name": "Groceries",
        "emails": [],
        "items_purchased": 1,
        "items_not_purchased": 2,
        "created_at": _now - 86400,
        "type": "list",
        "source_url": "",
    },
    "list-2": {
        "id": "list-2",
        "name": "Hardware Store",
        "emails": [],
        "items_purchased": 0,
        "items_not_purchased": 2,
        "created_at": _now - 3600,
        "type": "list",
        "source_url": "",
    },
}

items_db: dict[str, list[dict[str, Any]]] = {
    "list-1": [
        {
            "id": "item-1",
            "title": "Milk",
            "amount": "1 gallon",
            "is_purchased": False,
            "group_id": 1,
            "updated_at": _now - 600,
            "created_at": _now - 86400,
            "deleted": False,
        },
        {
            "id": "item-2",
            "title": "Eggs",
            "amount": "12",
            "is_purchased": False,
            "group_id": 1,
            "updated_at": _now - 300,
            "created_at": _now - 86400,
            "deleted": False,
        },
        {
            "id": "item-3",
            "title": "Bread",
            "amount": "1 loaf",
            "is_purchased": True,
            "group_id": 2,
            "updated_at": _now - 100,
            "created_at": _now - 86400,
            "deleted": False,
        },
    ],
    "list-2": [
        {
            "id": "item-4",
            "title": "Screws",
            "amount": "box of 100",
            "is_purchased": False,
            "group_id": 0,
            "updated_at": _now - 1800,
            "created_at": _now - 3600,
            "deleted": False,
        },
        {
            "id": "item-5",
            "title": "Wood glue",
            "amount": "1 bottle",
            "is_purchased": False,
            "group_id": 0,
            "updated_at": _now - 1800,
            "created_at": _now - 3600,
            "deleted": False,
        },
    ],
}

unique_items_db: dict[str, dict[str, Any]] = {
    "Milk": {
        "title": "Milk",
        "group_id": 1,
        "use_count": 5,
        "permanent": False,
        "deleted": False,
        "last_use": _now - 600,
    },
    "Eggs": {
        "title": "Eggs",
        "group_id": 1,
        "use_count": 3,
        "permanent": False,
        "deleted": False,
        "last_use": _now - 300,
    },
    "Bread": {
        "title": "Bread",
        "group_id": 2,
        "use_count": 7,
        "permanent": False,
        "deleted": False,
        "last_use": _now - 100,
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _recount(list_id: str) -> None:
    """Recalculate purchased / not-purchased counts for a list."""
    lst = lists_db.get(list_id)
    if lst is None:
        return
    active = [i for i in items_db.get(list_id, []) if not i.get("deleted")]
    lst["items_purchased"] = sum(1 for i in active if i["is_purchased"])
    lst["items_not_purchased"] = sum(1 for i in active if not i["is_purchased"])


def _parse_basic_auth(request: Request) -> str:
    """Parse and validate Basic Auth header. Returns the login name."""
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Basic "):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        decoded = base64.b64decode(auth_header[6:]).decode()
        login, pin = decoded.split(":", 1)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc
    if not re.fullmatch(r"\d{4}", pin):
        raise HTTPException(status_code=401, detail="PIN must be 4 digits")
    # Auto-register unknown users for convenience
    if login not in users:
        users[login] = {
            "login": login,
            "pin": pin,
            "email": f"{login}@example.com",
            "subscription_status": "free",
        }
    return login


async def get_current_user(request: Request) -> str:
    """FastAPI dependency for Basic Auth."""
    return _parse_basic_auth(request)


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------


@app.get("/bauth")
async def login(login: str = Depends(get_current_user)) -> dict[str, Any]:
    return users[login]


@app.post("/v4.0/users", status_code=201)
async def register_user(request: Request) -> dict[str, Any]:
    data = await request.json()
    for field in ("login", "pin", "email"):
        if field not in data:
            raise HTTPException(status_code=422, detail=f"Missing field: {field}")
    if not re.fullmatch(r"\d{4}", data["pin"]):
        raise HTTPException(status_code=422, detail="PIN must be 4 digits")
    if data["login"] in users:
        raise HTTPException(status_code=422, detail="User already exists")
    user = {
        "login": data["login"],
        "pin": data["pin"],
        "email": data["email"],
        "subscription_status": data.get("subscription_status", "free"),
    }
    users[data["login"]] = user
    return user


@app.put("/v4.0/users")
async def update_user(
    request: Request, login: str = Depends(get_current_user)
) -> dict[str, Any]:
    data = await request.json()
    user = users[login]
    if "login" in data:
        user["login"] = data["login"]
    if "pin" in data:
        if not re.fullmatch(r"\d{4}", data["pin"]):
            raise HTTPException(status_code=422, detail="PIN must be 4 digits")
        user["pin"] = data["pin"]
    if "email" in data:
        user["email"] = data["email"]
    return user


@app.post("/v4.0/oauth2/code")
async def oauth_authorize(request: Request) -> dict[str, str]:
    data = await request.json()
    for field in ("username", "password", "client_id", "redirect_uri"):
        if field not in data:
            raise HTTPException(status_code=400, detail=f"Missing field: {field}")
    return {"access_code": str(uuid.uuid4())}


@app.post("/password_resets")
async def reset_password(request: Request) -> dict[str, str]:
    data = await request.json()
    if "email" not in data:
        raise HTTPException(status_code=400, detail="Missing email")
    return {"message": "Recovery email sent"}


# ---------------------------------------------------------------------------
# Lists endpoints
# ---------------------------------------------------------------------------


@app.get("/lists")
async def get_lists(login: str = Depends(get_current_user)) -> list[dict[str, Any]]:
    return list(lists_db.values())


@app.post("/lists", status_code=201)
async def create_list(
    request: Request, login: str = Depends(get_current_user)
) -> dict[str, Any]:
    data = await request.json()
    if "name" not in data:
        raise HTTPException(status_code=400, detail="Missing name")
    list_id = data.get("id") or str(uuid.uuid4())
    new_list: dict[str, Any] = {
        "id": list_id,
        "name": data["name"],
        "emails": [],
        "items_purchased": data.get("items_purchased", 0),
        "items_not_purchased": data.get("items_not_purchased", 0),
        "created_at": int(time.time()),
        "type": "list",
        "source_url": "",
    }
    lists_db[list_id] = new_list
    items_db.setdefault(list_id, [])
    return new_list


@app.put("/lists/{list_id}")
async def update_list(
    list_id: str, request: Request, login: str = Depends(get_current_user)
) -> dict[str, Any]:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    data = await request.json()
    lst = lists_db[list_id]
    if "name" in data:
        lst["name"] = data["name"]
    if "emails" in data:
        lst["emails"] = data["emails"]
    return lst


@app.delete("/lists/{list_id}", status_code=204)
async def delete_list(
    list_id: str, login: str = Depends(get_current_user)
) -> Response:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    del lists_db[list_id]
    items_db.pop(list_id, None)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Items endpoints
# ---------------------------------------------------------------------------


@app.get("/lists/{list_id}/items")
async def get_items(
    list_id: str, login: str = Depends(get_current_user)
) -> list[dict[str, Any]]:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    return items_db.get(list_id, [])


@app.post("/lists/{list_id}/items", status_code=201)
async def add_item(
    list_id: str, request: Request, login: str = Depends(get_current_user)
) -> dict[str, Any]:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    data = await request.json()
    if "title" not in data:
        raise HTTPException(status_code=400, detail="Missing title")
    ts = int(time.time())
    # Auto-fill group_id from unique_items dictionary if not provided
    group_id = data.get("group_id")
    if group_id is None:
        existing = unique_items_db.get(data["title"])
        group_id = existing["group_id"] if existing else 0
    # Revive a soft-deleted item with the same title instead of creating a duplicate
    revived = None
    for existing_item in items_db.get(list_id, []):
        if existing_item["title"] == data["title"] and existing_item.get("deleted"):
            existing_item["deleted"] = False
            existing_item["is_purchased"] = data.get("is_purchased", False)
            existing_item["amount"] = data.get("amount", existing_item.get("amount", ""))
            existing_item["group_id"] = group_id
            existing_item["updated_at"] = ts
            revived = existing_item
            break
    if revived:
        item = revived
    else:
        item = {
            "id": str(uuid.uuid4()),
            "title": data["title"],
            "amount": data.get("amount", ""),
            "is_purchased": data.get("is_purchased", False),
            "group_id": group_id,
            "updated_at": ts,
            "created_at": ts,
            "deleted": False,
        }
        items_db.setdefault(list_id, []).append(item)
    _recount(list_id)
    # Update unique items dictionary
    title = data["title"]
    if title in unique_items_db:
        unique_items_db[title]["use_count"] += 1
        unique_items_db[title]["last_use"] = ts
    else:
        unique_items_db[title] = {
            "title": title,
            "group_id": item["group_id"],
            "use_count": 1,
            "permanent": False,
            "deleted": False,
            "last_use": ts,
        }
    return item


@app.put("/lists/{list_id}/items/{item_id}")
async def update_item(
    list_id: str,
    item_id: str,
    request: Request,
    login: str = Depends(get_current_user),
) -> dict[str, Any]:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    for item in items_db.get(list_id, []):
        if item["id"] == item_id:
            data = await request.json()
            for key in ("title", "amount", "is_purchased", "group_id"):
                if key in data:
                    item[key] = data[key]
            item["updated_at"] = int(time.time())
            _recount(list_id)
            return item
    raise HTTPException(status_code=404, detail="Item not found")


@app.delete("/lists/{list_id}/items/{item_id}", status_code=204)
async def delete_item(
    list_id: str, item_id: str, login: str = Depends(get_current_user)
) -> Response:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    for item in items_db.get(list_id, []):
        if item["id"] == item_id:
            item["deleted"] = True
            item["updated_at"] = int(time.time())
            _recount(list_id)
            return Response(status_code=204)
    raise HTTPException(status_code=404, detail="Item not found")


# ---------------------------------------------------------------------------
# Changed items (incremental sync)
# ---------------------------------------------------------------------------


@app.get("/lists/{list_id}/changed_items/{timestamp}")
async def get_changed_items(
    list_id: str, timestamp: int, login: str = Depends(get_current_user)
) -> list[dict[str, Any]]:
    if list_id not in lists_db:
        raise HTTPException(status_code=404, detail="List not found")
    return [i for i in items_db.get(list_id, []) if i["updated_at"] > timestamp]


# ---------------------------------------------------------------------------
# Unique items (dictionary / autocomplete)
# ---------------------------------------------------------------------------


@app.get("/unique_items")
async def get_unique_items(
    login: str = Depends(get_current_user),
) -> list[dict[str, Any]]:
    return list(unique_items_db.values())


@app.put("/unique_items/{encoded_title:path}")
async def update_unique_item(
    encoded_title: str,
    request: Request,
    login: str = Depends(get_current_user),
) -> dict[str, Any]:
    title = unquote(encoded_title)
    if title not in unique_items_db:
        raise HTTPException(status_code=404, detail="Unique item not found")
    data = await request.json()
    for key in ("group_id", "permanent", "use_count"):
        if key in data:
            unique_items_db[title][key] = data[key]
    return unique_items_db[title]


@app.delete("/unique_items/{encoded_title:path}", status_code=204)
async def delete_unique_item(
    encoded_title: str, login: str = Depends(get_current_user)
) -> Response:
    title = unquote(encoded_title)
    if title not in unique_items_db:
        raise HTTPException(status_code=404, detail="Unique item not found")
    del unique_items_db[title]
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Restrictions & cache
# ---------------------------------------------------------------------------


@app.get("/restrictions")
async def get_restrictions(
    login: str = Depends(get_current_user),
) -> dict[str, int]:
    return {
        "maxListsCount": 3,
        "maxItemscount": 200,
        "sharedAccountsMaxNumber": 3,
    }


@app.put("/clear_cache")
async def clear_cache(
    login: str = Depends(get_current_user),
) -> dict[str, str]:
    return {"message": "Cache cleared"}

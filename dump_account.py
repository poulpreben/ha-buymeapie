#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["httpx"]
# ///
"""Dump all data from a Buy Me a Pie account to bmap_dump.json."""

import getpass
import json
import sys

import httpx

API = "https://api.buymeapie.com"


def main() -> None:
    login = input("Login: ")
    pin = getpass.getpass("PIN: ")
    auth = httpx.BasicAuth(login, pin)

    with httpx.Client(auth=auth, base_url=API) as client:
        r = client.get("/bauth")
        if r.status_code == 401:
            print("Invalid credentials.", file=sys.stderr)
            sys.exit(1)
        r.raise_for_status()
        print(f"Authenticated as {r.json().get('email', login)}")

        lists = client.get("/lists").json()
        print(f"Found {len(lists)} lists")

        items: dict[str, list] = {}
        for lst in lists:
            list_id = lst["id"]
            list_items = client.get(f"/lists/{list_id}/items").json()
            items[list_id] = list_items
            print(f"  {lst['name']}: {len(list_items)} items")

        unique_items = client.get("/unique_items").json()
        print(f"Found {len(unique_items)} unique items (autocomplete dictionary)")

    dump = {
        "lists": lists,
        "items": items,
        "unique_items": unique_items,
    }

    out = "bmap_dump.json"
    with open(out, "w") as f:
        json.dump(dump, f, indent=2, ensure_ascii=False)
    print(f"\nSaved to {out}")


if __name__ == "__main__":
    main()

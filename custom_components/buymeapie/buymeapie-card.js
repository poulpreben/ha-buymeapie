const CARD_VERSION = "1.4.0";

// Real Buy Me a Pie category colors from lists.css
const GROUP_COLORS = {
  0: "#b4bec6", 1: "#524DCF", 2: "#864F9E", 3: "#BA2E38",
  4: "#E57542", 5: "#FF5699", 6: "#75B35A", 7: "#26B0C7",
  8: "#C1C12F", 9: "#20A881", 10: "#8FAECD", 11: "#416362",
  12: "#F4B72F", 13: "#A19080", 14: "#931F54", 15: "#4CC9F5",
  16: "#FF2966", 17: "#C4B8CE", 18: "#9E5E59", 19: "#4F3C6D",
  20: "#5372C5", 21: "#A85271", 22: "#F57F03", 23: "#957D41",
  24: "#4F99AA", 25: "#FD9C69", 26: "#DE2B17", 27: "#797D88",
  28: "#B4CC8B",
};

class BuyMeAPieCard extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
    this._items = [];
    this._suggestions = [];
    this._showSuggestions = false;
    this._debounceTimer = null;
    this._initialized = false;
    this._cachedEntryId = null;
    this._inputValue = "";
    this._categories = {}; // title_lower -> group_id
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._hass && this._config.entity) this._loadItems();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;
    if (!this._config.entity) return;
    if (
      !oldHass ||
      !this._initialized ||
      oldHass.states[this._config.entity] !== hass.states[this._config.entity]
    ) {
      this._loadItems();
    }
  }

  async _loadItems() {
    if (!this._hass || !this._config.entity) return;
    const state = this._hass.states[this._config.entity];
    if (!state || state.state === "unavailable") {
      this._items = [];
      this._render();
      return;
    }
    try {
      const result = await this._hass.callService(
        "todo", "get_items", {},
        { entity_id: this._config.entity },
        undefined, true
      );
      this._items = result?.response?.[this._config.entity]?.items || [];
    } catch {
      this._items = [];
    }
    // Fetch categories if not cached yet
    if (Object.keys(this._categories).length === 0) {
      try {
        this._categories = await this._hass.callWS({ type: "buymeapie/categories" }) || {};
      } catch { /* ignore */ }
    }
    this._render();
  }

  async _fetchSuggestions(query) {
    if (!this._hass) return;
    try {
      const results = await this._hass.callWS({
        type: "buymeapie/autocomplete",
        query: query,
        limit: 8,
      });
      this._suggestions = results || [];
      this._showSuggestions = this._suggestions.length > 0;
      this._renderSuggestions();
    } catch {
      this._suggestions = [];
      this._showSuggestions = false;
    }
  }

  // entry_id is no longer needed — the websocket handler auto-selects
  async _resolveEntryId() {
    return "";
  }

  _gc(groupId) {
    return GROUP_COLORS[groupId] || GROUP_COLORS[0];
  }

  _itemGroupId(item) {
    return this._categories[(item.summary || "").toLowerCase()] || 0;
  }

  // Parse input matching bmap app's parser:
  //   Comma/semicolon = multiple items ("Milk, Bread" = 2 items)
  //   Whitespace or colon before number+unit = amount ("Milk 2 l", "Milk: 2 liters")
  _parseOne(s) {
    const trimmed = s.replace(/^[\s,;:.]+/, "").replace(/[\s,;:.]+$/, "");
    if (!trimmed) return null;
    const units = "g|gr|gm|gram|grams|kg|kilo|kilos|l|liter|liters|litre|litres|dl|ml|cl|oz|lb|lbs|pound|pounds|pint|pints|gallon|gallons|bottle|bottles|can|cans|pack|packs|pk|package|packages|box|boxes|bag|bags|jar|jars|tin|tins|piece|pieces|pc|pcs|stk|pakke|pakker|flaske|flasker|pose|poser|boks|bokser|bundt|portion|dåse|dåser|ds|spand|rulle|ruller|bdt|sæt";
    // Match: title (space or colon) number [unit]
    const re = new RegExp(
      `^(.+?)(?:\\s*:\\s*|\\s+)(\\d+(?:[,./]\\d+)?(?:\\s*(?:${units})\\.?)?)\\s*$`, "i"
    );
    const m = trimmed.match(re);
    if (m && m[1] && m[2]) {
      return { title: m[1].trim(), amount: m[2].trim() };
    }
    // Fallback: colon separator for freeform amounts ("Milk: large carton")
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > 0) {
      const title = trimmed.slice(0, colonIdx).trim();
      const amount = trimmed.slice(colonIdx + 1).trim();
      if (title && amount) return { title, amount };
    }
    return { title: trimmed, amount: "" };
  }

  _parseInput(raw) {
    if (!raw.trim()) return [];
    // Split by comma or semicolon (but not commas inside number+unit like "1,5 kg")
    const units = "g|gr|gm|gram|grams|kg|kilo|kilos|l|liter|liters|litre|litres|dl|ml|cl|oz|lb|lbs|stk|pakke|pakker|flaske|flasker|pose|poser|boks|bokser|piece|pieces|pc|pcs|pack|packs|bottle|bottles|can|cans|box|boxes|bag|bags|jar|jars|tin|tins|portion|bundt|dåse|dåser";
    const delimiterRe = new RegExp(
      `,(?!\\d+(?:${units})?(?:$|[,;\\s]))`, "gi"
    );
    const normalized = raw.replace(delimiterRe, ";");
    return normalized.split(";")
      .map((s) => this._parseOne(s))
      .filter(Boolean);
  }

  // Look up canonical title from unique_items (preserves original casing)
  async _canonicalTitle(title) {
    try {
      const results = await this._hass.callWS({
        type: "buymeapie/autocomplete",
        query: title,
        limit: 1,
      });
      if (results?.length && results[0].title.toLowerCase() === title.toLowerCase()) {
        return results[0].title;
      }
    } catch { /* ignore */ }
    return title;
  }

  async _addItem(raw) {
    const items = this._parseInput(raw);
    if (items.length === 0) return;
    const input = this.querySelector(".bmap-input");
    if (input) input.value = "";
    this._inputValue = "";
    this._suggestions = [];
    this._showSuggestions = false;

    // Optimistic: add all items to UI immediately
    for (const parsed of items) {
      this._items.push({
        uid: `_temp_${Date.now()}_${Math.random()}`,
        summary: parsed.title,
        description: parsed.amount || undefined,
        status: "needs_action",
        _new: true,
      });
    }
    this._render();

    // Fire all service calls concurrently
    await Promise.all(items.map(async (parsed) => {
      const title = await this._canonicalTitle(parsed.title);
      const data = { item: title };
      if (parsed.amount) data.description = parsed.amount;
      await this._hass.callService(
        "todo", "add_item", data,
        { entity_id: this._config.entity }
      );
    }));
  }

  async _toggleItem(uid, currentStatus) {
    const newStatus = currentStatus === "completed" ? "needs_action" : "completed";
    // Optimistic update: move item to end of array so it appears at top
    // of whichever section it moves to (completed is reversed)
    const idx = this._items.findIndex((i) => i.uid === uid);
    if (idx !== -1) {
      const item = this._items.splice(idx, 1)[0];
      item.status = newStatus;
      this._items.push(item);
      this._render();
    }
    await this._hass.callService(
      "todo", "update_item",
      { item: uid, status: newStatus },
      { entity_id: this._config.entity }
    );
  }

  async _deleteItem(uid) {
    // Optimistic update: remove item immediately from UI
    this._items = this._items.filter((i) => i.uid !== uid);
    this._render();
    await this._hass.callService(
      "todo", "remove_item",
      { item: uid },
      { entity_id: this._config.entity }
    );
  }

  // Get the text segment currently being typed (after the last comma)
  _currentSegment(value) {
    const parts = value.split(",");
    return parts[parts.length - 1].trimStart();
  }

  // Replace the current segment (after last comma) with a new value
  _replaceCurrentSegment(value, replacement) {
    const parts = value.split(",");
    parts[parts.length - 1] = (parts.length > 1 ? " " : "") + replacement;
    return parts.join(",");
  }

  _onInput(e) {
    this._inputValue = e.target.value;
    clearTimeout(this._debounceTimer);
    const segment = this._currentSegment(this._inputValue);
    if (segment.length >= 1) {
      this._debounceTimer = setTimeout(() => this._fetchSuggestions(segment), 150);
    } else {
      this._suggestions = [];
      this._showSuggestions = false;
      this._renderSuggestions();
    }
  }

  _onKeyDown(e) {
    if (e.key === "Tab" && this._suggestions.length > 0) {
      // Tab-complete: replace current segment with top suggestion
      e.preventDefault();
      const top = this._suggestions[0].title;
      const input = e.target;
      input.value = this._replaceCurrentSegment(input.value, top);
      this._inputValue = input.value;
      this._suggestions = [];
      this._showSuggestions = false;
      this._renderSuggestions();
    } else if (e.key === "Enter") {
      e.preventDefault();
      this._addItem(e.target.value);
    } else if (e.key === "Escape") {
      this._suggestions = [];
      this._showSuggestions = false;
      this._renderSuggestions();
    }
  }

  _onSuggestionClick(title) {
    // Replace the current segment with the clicked suggestion
    const input = this.querySelector(".bmap-input");
    if (input) {
      input.value = this._replaceCurrentSegment(input.value, title);
      this._inputValue = input.value;
      input.focus();
    }
    this._suggestions = [];
    this._showSuggestions = false;
    this._renderSuggestions();
  }

  _renderSuggestions() {
    const box = this.querySelector(".bmap-suggestions");
    if (!box) return;
    if (!this._showSuggestions || this._suggestions.length === 0) {
      box.innerHTML = "";
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    box.innerHTML = this._suggestions.map((s) => `
      <div class="bmap-suggestion" data-title="${this._escAttr(s.title)}">
        <span class="bmap-dot" style="background:${this._gc(s.group_id)}"></span>
        <span class="bmap-suggestion-title">${this._esc(s.title)}</span>
        <span class="bmap-suggestion-count">${s.use_count}x</span>
      </div>
    `).join("");
    box.querySelectorAll(".bmap-suggestion").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._onSuggestionClick(el.dataset.title);
      });
    });
  }

  _render() {
    this._initialized = true;
    if (!this._config.entity) {
      this.innerHTML = `<ha-card><div style="padding:24px;text-align:center;color:var(--secondary-text-color)">Select an entity in card settings</div></ha-card>`;
      return;
    }
    const entity = this._hass?.states[this._config.entity];
    const name = this._config.title || entity?.attributes?.friendly_name || "Shopping List";
    const sortBy = this._config.sort_by || "time"; // "time" or "category"
    const showCategories = this._config.show_categories !== false;

    // Reverse so newest items appear first (default)
    let needsAction = this._items
      .filter((i) => i.status === "needs_action")
      .reverse();
    let completed = this._items
      .filter((i) => i.status === "completed")
      .reverse();

    if (sortBy === "category") {
      const catSort = (a, b) => {
        const ga = this._itemGroupId(a);
        const gb = this._itemGroupId(b);
        if (ga !== gb) return ga - gb;
        return (a.summary || "").localeCompare(b.summary || "");
      };
      needsAction.sort(catSort);
      completed.sort(catSort);
    }

    const showCompleted = this._config.show_completed !== false;
    const maxItems = this._config.max_items || 0; // 0 = no limit

    this.innerHTML = `
      <ha-card>
        <style>
          /* ── Header: matches ha-card header pattern ── */
          .bmap-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
          }
          .bmap-header-icon {
            color: var(--primary-color);
            display: flex;
          }
          .bmap-header-icon svg {
            width: 24px;
            height: 24px;
          }
          .bmap-header-title {
            font-weight: 500;
            letter-spacing: .1px;
            color: var(--primary-text-color);
            flex: 1;
          }
          .bmap-header .count {
            font-size: 12px;
            font-weight: 500;
            color: var(--secondary-text-color);
            min-width: 20px;
            text-align: center;
          }

          /* ── Input: matches native todo input style ── */
          .bmap-input-row {
            position: relative;
            display: flex;
            align-items: center;
            padding: 0 16px;
            border-bottom: 1px solid var(--divider-color);
          }
          .bmap-input {
            flex: 1;
            padding: 12px 0;
            border: none;
            background: transparent;
            color: var(--primary-text-color);
            font-size: inherit;
            font-family: inherit;
            outline: none;
          }
          .bmap-input::placeholder {
            color: var(--secondary-text-color);
          }
          .bmap-add-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            margin: -8px -8px -8px 0;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: var(--primary-color);
            cursor: pointer;
            transition: background 0.15s;
          }
          .bmap-add-btn:hover {
            background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.1);
          }
          .bmap-add-btn svg {
            width: 24px;
            height: 24px;
          }

          /* ── Suggestions dropdown ── */
          .bmap-suggestions {
            display: none;
            position: absolute;
            left: 0;
            right: 0;
            top: 100%;
            background: var(--card-background-color, #fff);
            border: 1px solid var(--divider-color);
            border-top: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10;
            max-height: 280px;
            overflow-y: auto;
          }
          .bmap-suggestion {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            gap: 12px;
            transition: background 0.1s;
            border-bottom: 1px solid var(--divider-color);
          }
          .bmap-suggestion:last-child {
            border-bottom: none;
          }
          .bmap-suggestion:hover {
            background: var(--secondary-background-color);
          }
          .bmap-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .bmap-suggestion-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--primary-text-color);
          }
          .bmap-suggestion-count {
            font-size: 12px;
            color: var(--disabled-text-color, var(--secondary-text-color));
          }

          /* ── Item list: matches native todo list items ── */
          .bmap-items {
            padding: 0;
            overflow-y: auto;
          }
          .bmap-section-label {
            padding: 16px 16px 4px;
            font-size: 12px;
            font-weight: 500;
            color: var(--primary-text-color);
          }
          .bmap-item {
            display: flex;
            align-items: center;
            padding: 0 16px;
            min-height: 48px;
            gap: 16px;
            transition: background 0.1s;
            border-bottom: 1px solid var(--divider-color);
          }
          .bmap-item:last-child {
            border-bottom: none;
          }
          .bmap-item:hover {
            background: var(--secondary-background-color);
          }

          /* ── Category color band ── */
          .bmap-cat-band {
            width: 4px;
            align-self: stretch;
            border-radius: 0;
            flex-shrink: 0;
            margin-left: -16px;
          }
          .bmap-item:last-child .bmap-cat-band {
            border-bottom-left-radius: var(--ha-card-border-radius, 12px);
          }

          /* ── Checkbox: square with rounded corners like HA native ── */
          .bmap-checkbox {
            width: 18px;
            height: 18px;
            border-radius: 4px;
            border: 2px solid var(--secondary-text-color);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.15s;
            background: transparent;
            cursor: pointer;
          }
          .bmap-item.completed .bmap-checkbox {
            background: var(--primary-color);
            border-color: var(--primary-color);
          }
          .bmap-item.completed .bmap-checkbox::after {
            content: "";
            width: 4px;
            height: 8px;
            border: solid #fff;
            border-width: 0 2px 2px 0;
            transform: rotate(45deg);
            margin-top: -2px;
          }

          .bmap-item-title {
            flex: 1;
            min-width: 0;
            line-height: 48px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: var(--primary-text-color);
          }
          .bmap-item.completed .bmap-item-title {
            text-decoration: line-through;
            color: var(--secondary-text-color);
          }
          .bmap-item-amount {
            font-size: 12px;
            color: var(--secondary-text-color);
            white-space: nowrap;
            flex-shrink: 0;
          }

          /* ── Delete button: appears on hover ── */
          .bmap-delete {
            opacity: 0;
            transition: opacity 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border: none;
            border-radius: 50%;
            background: transparent;
            color: var(--secondary-text-color);
            cursor: pointer;
            margin: -6px -8px -6px 0;
          }
          .bmap-item:hover .bmap-delete { opacity: 1; }
          .bmap-delete:hover {
            background: rgba(var(--rgb-error-color, 219, 68, 55), 0.1);
            color: var(--error-color);
          }
          .bmap-delete svg {
            width: 20px;
            height: 20px;
          }

          /* ── Empty state ── */
          .bmap-empty {
            padding: 32px 16px;
            text-align: center;
            font-size: 14px;
            color: var(--secondary-text-color);
          }

          .bmap-more {
            padding: 8px 16px 12px;
            font-size: 12px;
            color: var(--secondary-text-color);
            text-align: center;
          }

          /* ── Flash animation for newly added items ── */
          @keyframes bmap-flash {
            0%   { background: rgba(var(--rgb-primary-color, 3, 169, 244), 0.25); }
            100% { background: transparent; }
          }
          .bmap-item.bmap-new {
            animation: bmap-flash 0.8s ease-out;
          }

          /* ── Divider between active/completed ── */
          .bmap-divider {
            height: 1px;
            margin: 0 16px;
            background: var(--divider-color);
          }
        </style>

        <div class="bmap-header">
          <span class="bmap-header-icon">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M17,18C15.89,18 15,18.89 15,20A2,2 0 0,0 17,22A2,2 0 0,0 19,20C19,18.89 18.1,18 17,18M1,2V4H3L6.6,11.59L5.25,14.04C5.09,14.32 5,14.65 5,15A2,2 0 0,0 7,17H19V15H7.42A0.25,0.25 0 0,1 7.17,14.75C7.17,14.7 7.18,14.66 7.2,14.63L8.1,13H15.55C16.3,13 16.96,12.59 17.3,11.97L20.88,5.5C20.95,5.34 21,5.17 21,5A1,1 0 0,0 20,4H5.21L4.27,2M7,18C5.89,18 5,18.89 5,20A2,2 0 0,0 7,22A2,2 0 0,0 9,20C9,18.89 8.1,18 7,18Z"/></svg>
          </span>
          <span class="bmap-header-title">${this._esc(name)}</span>
          <span class="count">${needsAction.length}</span>
        </div>

        <div class="bmap-input-row">
          <input
            class="bmap-input"
            type="text"
            placeholder="Add item"
            autocomplete="off"
            value="${this._escAttr(this._inputValue)}"
          />
          <button class="bmap-add-btn" title="Add item">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/></svg>
          </button>
          <div class="bmap-suggestions"></div>
        </div>

        <div class="bmap-items"${maxItems ? ` style="max-height:${maxItems * 49}px"` : ""}>
          ${needsAction.length === 0 && (!showCompleted || completed.length === 0) ? `
            <div class="bmap-empty">No items</div>
          ` : ""}

          ${needsAction.map((item) => this._renderItem(item, false)).join("")}

          ${showCompleted && completed.length > 0 ? `
            ${needsAction.length > 0 ? '<div class="bmap-divider"></div>' : ""}
            <div class="bmap-section-label">Completed (${completed.length})</div>
            ${completed.slice(0, 10).map((item) => this._renderItem(item, true)).join("")}
            ${completed.length > 10 ? `<div class="bmap-more">${completed.length - 10} more</div>` : ""}
          ` : ""}
        </div>
      </ha-card>
    `;

    // Bind events
    const input = this.querySelector(".bmap-input");
    if (input) {
      input.addEventListener("input", (e) => this._onInput(e));
      input.addEventListener("keydown", (e) => this._onKeyDown(e));
      input.addEventListener("focus", () => {
        if (this._inputValue.length >= 1) this._fetchSuggestions(this._inputValue);
      });
      input.addEventListener("blur", () => {
        setTimeout(() => {
          this._showSuggestions = false;
          this._renderSuggestions();
        }, 200);
      });
      if (this._inputValue) {
        input.setSelectionRange(this._inputValue.length, this._inputValue.length);
      }
    }

    const addBtn = this.querySelector(".bmap-add-btn");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        const val = this.querySelector(".bmap-input")?.value;
        if (val) this._addItem(val);
      });
    }

    // Delegate click on checkboxes only for toggling
    const itemsContainer = this.querySelector(".bmap-items");
    if (itemsContainer) {
      itemsContainer.addEventListener("click", (e) => {
        if (!e.target.closest(".bmap-checkbox")) return;
        const item = e.target.closest(".bmap-item");
        if (item && item.dataset.uid) {
          this._toggleItem(item.dataset.uid, item.dataset.status);
        }
      });
    }

    this.querySelectorAll(".bmap-delete").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteItem(el.dataset.uid);
      });
    });
  }

  _renderItem(item, isCompleted) {
    const cls = (isCompleted ? "bmap-item completed" : "bmap-item") + (item._new ? " bmap-new" : "");
    const desc = item.description
      ? `<span class="bmap-item-amount">${this._esc(item.description)}</span>`
      : "";
    const showCat = this._config.show_categories !== false;
    const groupId = this._itemGroupId(item);
    const band = showCat
      ? `<div class="bmap-cat-band" style="background:${this._gc(groupId)}"></div>`
      : "";
    return `
      <div class="${cls}" data-uid="${this._escAttr(item.uid)}" data-status="${item.status}">
        ${band}
        <div class="bmap-checkbox"></div>
        <div class="bmap-item-title">${this._esc(item.summary)}</div>
        ${desc}
        <button class="bmap-delete" data-uid="${this._escAttr(item.uid)}" title="Remove">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z"/></svg>
        </button>
      </div>
    `;
  }

  _esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  _escAttr(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  getCardSize() {
    return Math.max(3, (this._items?.length || 0) + 2);
  }

  static getConfigElement() {
    return document.createElement("buymeapie-card-editor");
  }

  static getStubConfig(hass) {
    const entities = Object.keys(hass.states).filter(
      (e) => e.startsWith("todo.") && hass.states[e].state !== "unavailable"
    );
    return { entity: entities[0] || "", show_completed: true, show_categories: true, sort_by: "time", max_items: 0 };
  }
}

// ── Config editor ──────────────────────────────────────────────────────

class BuyMeAPieCardEditor extends HTMLElement {
  constructor() {
    super();
    this._config = {};
    this._hass = null;
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._hass) this._render();
  }

  set hass(hass) {
    const needsRender = !this._hass;
    this._hass = hass;
    if (needsRender) this._render();
  }

  _render() {
    if (!this._hass) return;

    const entities = Object.keys(this._hass.states)
      .filter((e) => e.startsWith("todo.") && this._hass.states[e].state !== "unavailable")
      .sort();

    this.innerHTML = `
      <style>
        .bmap-editor { padding: 16px; display: flex; flex-direction: column; gap: 16px; }
        .bmap-editor label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 4px; color: var(--primary-text-color); }
        .bmap-editor select, .bmap-editor input[type=text] {
          width: 100%;
          box-sizing: border-box;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font-size: 14px;
          font-family: inherit;
        }
        .bmap-editor .row {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        .bmap-editor .row input[type=checkbox] {
          width: 18px;
          height: 18px;
          accent-color: var(--primary-color);
          cursor: pointer;
        }
        .bmap-editor .row span { font-size: 14px; color: var(--primary-text-color); }
        .bmap-editor input[type=number] {
          width: 80px;
          padding: 8px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color);
          background: var(--secondary-background-color);
          color: var(--primary-text-color);
          font-size: 14px;
          font-family: inherit;
        }
        .bmap-editor .field-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .bmap-editor .field-row label { margin-bottom: 0; }
        .bmap-editor .hint {
          font-size: 12px;
          color: var(--secondary-text-color);
          margin-top: -8px;
        }
      </style>
      <div class="bmap-editor">
        <div>
          <label>Shopping list</label>
          <select id="bmap-entity-select">
            ${!this._config.entity ? '<option value="" selected>Select a list...</option>' : ""}
            ${entities.map((e) => {
              const name = this._hass.states[e].attributes.friendly_name || e;
              const sel = e === this._config.entity ? "selected" : "";
              return `<option value="${e}" ${sel}>${name}</option>`;
            }).join("")}
          </select>
        </div>
        <div class="field-row">
          <label>Max visible items</label>
          <input type="number" id="bmap-max-items" min="0" max="50" value="${this._config.max_items || 0}" placeholder="0" />
        </div>
        <div class="hint">0 = no limit, shows all items. Set to e.g. 10 to enable scrolling.</div>
        <div>
          <label>Sort by</label>
          <select id="bmap-sort-by">
            <option value="time" ${(this._config.sort_by || "time") === "time" ? "selected" : ""}>Newest first</option>
            <option value="category" ${this._config.sort_by === "category" ? "selected" : ""}>Category + name</option>
          </select>
        </div>
        <label class="row">
          <input type="checkbox" id="bmap-show-categories" ${this._config.show_categories !== false ? "checked" : ""} />
          <span>Show category colors</span>
        </label>
        <label class="row">
          <input type="checkbox" id="bmap-show-completed" ${this._config.show_completed !== false ? "checked" : ""} />
          <span>Show completed items</span>
        </label>
      </div>
    `;

    this.querySelector("#bmap-entity-select").addEventListener("change", (e) => {
      this._config = { ...this._config, entity: e.target.value };
      this._dispatch();
    });
    this.querySelector("#bmap-max-items").addEventListener("change", (e) => {
      this._config = { ...this._config, max_items: parseInt(e.target.value) || 0 };
      this._dispatch();
    });
    this.querySelector("#bmap-sort-by").addEventListener("change", (e) => {
      this._config = { ...this._config, sort_by: e.target.value };
      this._dispatch();
    });
    this.querySelector("#bmap-show-categories").addEventListener("change", (e) => {
      this._config = { ...this._config, show_categories: e.target.checked };
      this._dispatch();
    });
    this.querySelector("#bmap-show-completed").addEventListener("change", (e) => {
      this._config = { ...this._config, show_completed: e.target.checked };
      this._dispatch();
    });
  }

  _dispatch() {
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: this._config } })
    );
  }
}

// Guard against double-registration (async import() can race)
if (!customElements.get("buymeapie-card")) {
  customElements.define("buymeapie-card", BuyMeAPieCard);
}
if (!customElements.get("buymeapie-card-editor")) {
  customElements.define("buymeapie-card-editor", BuyMeAPieCardEditor);
}

// Tell HA to re-render any cards that showed "Custom element doesn't exist"
// before our define() ran.
// Strategy: fire ll-rebuild immediately + delayed, and also watch for any
// error cards that appear later and rebuild those too.
const _rebuild = () => window.dispatchEvent(new Event("ll-rebuild"));
_rebuild();
setTimeout(_rebuild, 200);
setTimeout(_rebuild, 1000);
setTimeout(_rebuild, 3000);

// Also observe DOM for late-appearing error cards and force rebuild
if (typeof MutationObserver !== "undefined") {
  const _obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && n.textContent?.includes("buymeapie-card")) {
          _rebuild();
          return;
        }
      }
    }
  });
  _obs.observe(document.body, { childList: true, subtree: true });
  // Stop watching after 10s to avoid ongoing overhead
  setTimeout(() => _obs.disconnect(), 10000);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "buymeapie-card")) {
  window.customCards.push({
    type: "buymeapie-card",
    name: "Buy Me a Pie",
    description: "Shopping list with autocomplete from your Buy Me a Pie history",
    preview: false,
  });
}

console.info(
  `%c BUYMEAPIE %c v${CARD_VERSION} `,
  "background:#0095FF;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px",
  "background:var(--secondary-background-color,#f7f7f7);color:var(--primary-text-color,#1a1a1a);padding:2px 6px;border-radius:0 4px 4px 0"
);

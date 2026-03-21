const CARD_VERSION = "1.0.0";

// Category colors matching Buy Me a Pie app
const GROUP_COLORS = {
  0: "#9e9e9e", // uncategorized
  1: "#f44336", // red
  2: "#ff9800", // orange
  3: "#4caf50", // green
  4: "#2196f3", // blue
  5: "#9c27b0", // purple
  6: "#009688", // teal
  7: "#795548", // brown
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
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error("Please define an entity (a buymeapie todo entity)");
    }
    this._config = config;
    if (this._hass) this._render();
  }

  set hass(hass) {
    const oldHass = this._hass;
    this._hass = hass;

    if (!this._config.entity) return;

    // Only re-render if our entity changed
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

    try {
      const result = await this._hass.callService(
        "todo",
        "get_items",
        {},
        { entity_id: this._config.entity },
        undefined,
        true
      );
      this._items = result.response[this._config.entity]?.items || [];
    } catch {
      this._items = [];
    }
    this._render();
  }

  async _fetchSuggestions(query) {
    if (!this._hass) return;

    const entryId = this._getEntryId() || (await this._resolveEntryId());
    if (!entryId) return;

    try {
      const results = await this._hass.callWS({
        type: "buymeapie/autocomplete",
        entry_id: entryId,
        query: query,
        limit: 8,
      });
      this._suggestions = results || [];
      this._showSuggestions = this._suggestions.length > 0;
      this._render();
    } catch {
      this._suggestions = [];
      this._showSuggestions = false;
    }
  }

  async _resolveEntryId() {
    if (this._cachedEntryId) return this._cachedEntryId;
    try {
      const entries = await this._hass.callWS({ type: "config_entries/get" });
      const match = entries.find((e) => e.domain === "buymeapie");
      if (match) {
        this._cachedEntryId = match.entry_id;
        return match.entry_id;
      }
    } catch { /* ignore */ }
    return null;
  }

  _getEntryId() {
    return this._cachedEntryId || null;
  }

  _getGroupColor(groupId) {
    return GROUP_COLORS[groupId] || GROUP_COLORS[0];
  }

  async _addItem(title) {
    if (!title.trim()) return;

    await this._hass.callService(
      "todo",
      "add_item",
      { item: title.trim() },
      { entity_id: this._config.entity }
    );

    const input = this.querySelector(".bmap-input");
    if (input) input.value = "";
    this._suggestions = [];
    this._showSuggestions = false;
  }

  async _toggleItem(uid, currentStatus) {
    const newStatus =
      currentStatus === "completed" ? "needs_action" : "completed";

    await this._hass.callService(
      "todo",
      "update_item",
      { item: uid, status: newStatus },
      { entity_id: this._config.entity }
    );
  }

  async _deleteItem(uid) {
    await this._hass.callService(
      "todo",
      "remove_item",
      { item: uid },
      { entity_id: this._config.entity }
    );
  }

  _onInput(e) {
    const query = e.target.value;
    clearTimeout(this._debounceTimer);
    if (query.length >= 1) {
      this._debounceTimer = setTimeout(() => this._fetchSuggestions(query), 150);
    } else {
      this._suggestions = [];
      this._showSuggestions = false;
      this._render();
    }
  }

  _onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      this._addItem(e.target.value);
    } else if (e.key === "Escape") {
      this._suggestions = [];
      this._showSuggestions = false;
      this._render();
    }
  }

  _onSuggestionClick(title) {
    const input = this.querySelector(".bmap-input");
    if (input) input.value = title;
    this._suggestions = [];
    this._showSuggestions = false;
    this._addItem(title);
  }

  _render() {
    this._initialized = true;
    const entity = this._hass?.states[this._config.entity];
    const name = this._config.title || entity?.attributes?.friendly_name || "Shopping List";

    const needsAction = this._items.filter((i) => i.status === "needs_action");
    const completed = this._items.filter((i) => i.status === "completed");
    const showCompleted = this._config.show_completed !== false;

    this.innerHTML = `
      <ha-card>
        <style>
          .bmap-header {
            display: flex;
            align-items: center;
            padding: 12px 16px 0;
            font-size: 1.1em;
            font-weight: 500;
          }
          .bmap-header .count {
            margin-left: auto;
            font-size: 0.8em;
            opacity: 0.6;
          }
          .bmap-input-wrap {
            position: relative;
            padding: 12px 16px;
          }
          .bmap-input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px;
            border: 1px solid var(--divider-color, #e0e0e0);
            border-radius: 8px;
            background: var(--card-background-color, #fff);
            color: var(--primary-text-color, #212121);
            font-size: 1em;
            outline: none;
            transition: border-color 0.2s;
          }
          .bmap-input:focus {
            border-color: var(--primary-color, #03a9f4);
          }
          .bmap-input::placeholder {
            color: var(--secondary-text-color, #757575);
            opacity: 0.7;
          }
          .bmap-suggestions {
            position: absolute;
            left: 16px;
            right: 16px;
            top: 100%;
            margin-top: -8px;
            background: var(--card-background-color, #fff);
            border: 1px solid var(--divider-color, #e0e0e0);
            border-radius: 0 0 8px 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 10;
            max-height: 240px;
            overflow-y: auto;
          }
          .bmap-suggestion {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            cursor: pointer;
            gap: 10px;
            transition: background 0.15s;
          }
          .bmap-suggestion:hover {
            background: var(--secondary-background-color, #f5f5f5);
          }
          .bmap-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
            flex-shrink: 0;
          }
          .bmap-suggestion-title {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bmap-suggestion-count {
            font-size: 0.75em;
            opacity: 0.5;
          }
          .bmap-items {
            padding: 0 0 8px;
          }
          .bmap-item {
            display: flex;
            align-items: center;
            padding: 8px 16px;
            gap: 10px;
            cursor: pointer;
            transition: background 0.15s;
          }
          .bmap-item:hover {
            background: var(--secondary-background-color, #f5f5f5);
          }
          .bmap-checkbox {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid var(--divider-color, #bdbdbd);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          }
          .bmap-item.completed .bmap-checkbox {
            background: var(--primary-color, #03a9f4);
            border-color: var(--primary-color, #03a9f4);
          }
          .bmap-item.completed .bmap-checkbox::after {
            content: "\\2713";
            color: #fff;
            font-size: 14px;
          }
          .bmap-item-text {
            flex: 1;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bmap-item.completed .bmap-item-text {
            text-decoration: line-through;
            opacity: 0.5;
          }
          .bmap-item-desc {
            font-size: 0.8em;
            opacity: 0.6;
          }
          .bmap-delete {
            opacity: 0;
            transition: opacity 0.15s;
            background: none;
            border: none;
            color: var(--error-color, #f44336);
            cursor: pointer;
            padding: 4px;
            font-size: 1.1em;
            line-height: 1;
          }
          .bmap-item:hover .bmap-delete {
            opacity: 0.7;
          }
          .bmap-delete:hover {
            opacity: 1 !important;
          }
          .bmap-divider {
            padding: 6px 16px 4px;
            font-size: 0.75em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            opacity: 0.5;
            font-weight: 500;
          }
          .bmap-empty {
            padding: 24px 16px;
            text-align: center;
            opacity: 0.5;
          }
        </style>

        <div class="bmap-header">
          ${name}
          <span class="count">${needsAction.length} item${needsAction.length !== 1 ? "s" : ""}</span>
        </div>

        <div class="bmap-input-wrap">
          <input
            class="bmap-input"
            type="text"
            placeholder="Add item..."
            autocomplete="off"
          />
          ${this._showSuggestions ? `
            <div class="bmap-suggestions">
              ${this._suggestions.map((s) => `
                <div class="bmap-suggestion" data-title="${this._escAttr(s.title)}">
                  <span class="bmap-dot" style="background:${this._getGroupColor(s.group_id)}"></span>
                  <span class="bmap-suggestion-title">${this._esc(s.title)}</span>
                  <span class="bmap-suggestion-count">${s.use_count}x</span>
                </div>
              `).join("")}
            </div>
          ` : ""}
        </div>

        <div class="bmap-items">
          ${needsAction.length === 0 && (!showCompleted || completed.length === 0) ? `
            <div class="bmap-empty">No items</div>
          ` : ""}

          ${needsAction.map((item) => this._renderItem(item, false)).join("")}

          ${showCompleted && completed.length > 0 ? `
            <div class="bmap-divider">Completed (${completed.length})</div>
            ${completed.map((item) => this._renderItem(item, true)).join("")}
          ` : ""}
        </div>
      </ha-card>
    `;

    // Bind events
    const input = this.querySelector(".bmap-input");
    if (input) {
      input.addEventListener("input", (e) => this._onInput(e));
      input.addEventListener("keydown", (e) => this._onKeyDown(e));
      // Close suggestions on outside click
      input.addEventListener("blur", () => {
        setTimeout(() => {
          this._showSuggestions = false;
          this._render();
        }, 200);
      });
    }

    this.querySelectorAll(".bmap-suggestion").forEach((el) => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        this._onSuggestionClick(el.dataset.title);
      });
    });

    this.querySelectorAll(".bmap-checkbox-wrap").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._toggleItem(el.dataset.uid, el.dataset.status);
      });
    });

    this.querySelectorAll(".bmap-delete").forEach((el) => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        this._deleteItem(el.dataset.uid);
      });
    });
  }

  _renderItem(item, isCompleted) {
    const cls = isCompleted ? "bmap-item completed" : "bmap-item";
    const desc = item.description ? ` <span class="bmap-item-desc">${this._esc(item.description)}</span>` : "";
    return `
      <div class="${cls}">
        <div class="bmap-checkbox-wrap" data-uid="${this._escAttr(item.uid)}" data-status="${item.status}">
          <div class="bmap-checkbox"></div>
        </div>
        <span class="bmap-item-text">${this._esc(item.summary)}${desc}</span>
        <button class="bmap-delete" data-uid="${this._escAttr(item.uid)}" title="Delete">&times;</button>
      </div>
    `;
  }

  _esc(str) {
    const d = document.createElement("div");
    d.textContent = str || "";
    return d.innerHTML;
  }

  _escAttr(str) {
    return (str || "").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  getCardSize() {
    return Math.max(3, (this._items?.length || 0) + 2);
  }

  static getConfigElement() {
    return document.createElement("buymeapie-card-editor");
  }

  static getStubConfig() {
    return { entity: "", show_completed: true };
  }
}

// Simple config editor
class BuyMeAPieCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass) return;

    // Find buymeapie todo entities
    const entities = Object.keys(this._hass.states)
      .filter((e) => e.startsWith("todo.") && this._hass.states[e].state !== "unavailable")
      .sort();

    this.innerHTML = `
      <div style="padding: 16px;">
        <label style="display:block; margin-bottom:8px; font-weight:500;">Entity</label>
        <select class="bmap-entity" style="width:100%; padding:8px; border-radius:4px; border:1px solid var(--divider-color);">
          <option value="">Select a list...</option>
          ${entities.map((e) => `<option value="${e}" ${e === this._config.entity ? "selected" : ""}>${this._hass.states[e].attributes.friendly_name || e}</option>`).join("")}
        </select>
        <label style="display:flex; align-items:center; gap:8px; margin-top:12px;">
          <input type="checkbox" class="bmap-show-completed" ${this._config.show_completed !== false ? "checked" : ""} />
          Show completed items
        </label>
      </div>
    `;

    this.querySelector(".bmap-entity").addEventListener("change", (e) => {
      this._config = { ...this._config, entity: e.target.value };
      this._dispatch();
    });

    this.querySelector(".bmap-show-completed").addEventListener("change", (e) => {
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

customElements.define("buymeapie-card", BuyMeAPieCard);
customElements.define("buymeapie-card-editor", BuyMeAPieCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "buymeapie-card",
  name: "Buy Me a Pie",
  description: "Shopping list card with autocomplete from your Buy Me a Pie history",
  preview: false,
});

console.info(`%c BUYMEAPIE-CARD %c v${CARD_VERSION} `, "background:#4caf50;color:#fff;font-weight:bold", "background:#eee;color:#333");

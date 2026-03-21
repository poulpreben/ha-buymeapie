const CARD_VERSION = "1.0.2";

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

// Bag icon SVG (matches bmap logo style)
const BAG_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`;

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
      // result.response contains the items keyed by entity_id
      this._items = result?.response?.[this._config.entity]?.items || [];
    } catch {
      this._items = [];
    }
    this._render();
  }

  async _fetchSuggestions(query) {
    if (!this._hass) return;
    const entryId = this._cachedEntryId || (await this._resolveEntryId());
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
      this._renderSuggestions();
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

  _gc(groupId) {
    return GROUP_COLORS[groupId] || GROUP_COLORS[0];
  }

  async _addItem(title) {
    if (!title.trim()) return;
    const input = this.querySelector(".bmap-input");
    if (input) input.value = "";
    this._inputValue = "";
    this._suggestions = [];
    this._showSuggestions = false;
    await this._hass.callService(
      "todo", "add_item",
      { item: title.trim() },
      { entity_id: this._config.entity }
    );
  }

  async _toggleItem(uid, currentStatus) {
    const newStatus = currentStatus === "completed" ? "needs_action" : "completed";
    await this._hass.callService(
      "todo", "update_item",
      { item: uid, status: newStatus },
      { entity_id: this._config.entity }
    );
  }

  async _deleteItem(uid) {
    await this._hass.callService(
      "todo", "remove_item",
      { item: uid },
      { entity_id: this._config.entity }
    );
  }

  _onInput(e) {
    this._inputValue = e.target.value;
    clearTimeout(this._debounceTimer);
    if (this._inputValue.length >= 1) {
      this._debounceTimer = setTimeout(() => this._fetchSuggestions(this._inputValue), 150);
    } else {
      this._suggestions = [];
      this._showSuggestions = false;
      this._renderSuggestions();
    }
  }

  _onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      this._addItem(e.target.value);
    } else if (e.key === "Escape") {
      this._suggestions = [];
      this._showSuggestions = false;
      this._renderSuggestions();
    }
  }

  _onSuggestionClick(title) {
    this._suggestions = [];
    this._showSuggestions = false;
    this._addItem(title);
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
        <span class="bmap-suggestion-count">${s.use_count}×</span>
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
      this.innerHTML = `<ha-card><div style="padding:24px;text-align:center;opacity:0.5">Select an entity in card settings</div></ha-card>`;
      return;
    }
    const entity = this._hass?.states[this._config.entity];
    const name = this._config.title || entity?.attributes?.friendly_name || "Shopping List";
    const needsAction = this._items.filter((i) => i.status === "needs_action");
    const completed = this._items.filter((i) => i.status === "completed");
    const showCompleted = this._config.show_completed !== false;

    this.innerHTML = `
      <ha-card>
        <style>
          :host { --bmap-brand: #0095FF; }
          .bmap-header {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 16px 16px 4px;
          }
          .bmap-header-icon {
            color: var(--bmap-brand);
            flex-shrink: 0;
          }
          .bmap-header-title {
            font-size: 1.1em;
            font-weight: 500;
            flex: 1;
          }
          .bmap-header .count {
            font-size: 0.8em;
            color: var(--secondary-text-color, #75858e);
          }
          .bmap-input-wrap {
            position: relative;
            padding: 8px 16px 4px;
          }
          .bmap-input {
            width: 100%;
            box-sizing: border-box;
            padding: 10px 12px 10px 36px;
            border: 2px solid var(--divider-color, #CCDAE3);
            border-radius: 10px;
            background: var(--card-background-color, #fff);
            color: var(--primary-text-color, #1a1a1a);
            font-size: 1em;
            font-family: inherit;
            outline: none;
            transition: border-color 0.2s;
          }
          .bmap-input:focus {
            border-color: var(--bmap-brand);
          }
          .bmap-input::placeholder {
            color: var(--secondary-text-color, #75858e);
          }
          .bmap-input-icon {
            position: absolute;
            left: 28px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--secondary-text-color, #75858e);
            pointer-events: none;
            font-size: 1.1em;
          }
          .bmap-suggestions {
            display: none;
            position: absolute;
            left: 16px;
            right: 16px;
            top: calc(100% - 2px);
            background: var(--card-background-color, #fff);
            border: 2px solid var(--bmap-brand);
            border-top: 1px solid var(--divider-color, #e0e0e0);
            border-radius: 0 0 10px 10px;
            box-shadow: 0 6px 16px rgba(0,0,0,0.12);
            z-index: 10;
            max-height: 260px;
            overflow-y: auto;
          }
          .bmap-suggestion {
            display: flex;
            align-items: center;
            padding: 10px 12px;
            cursor: pointer;
            gap: 10px;
            transition: background 0.1s;
          }
          .bmap-suggestion:hover {
            background: var(--secondary-background-color, #F5F7FB);
          }
          .bmap-suggestion:last-child {
            border-radius: 0 0 8px 8px;
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
            color: var(--secondary-text-color, #75858e);
          }
          .bmap-items { padding: 4px 0 8px; }
          .bmap-item {
            display: flex;
            align-items: center;
            padding: 7px 16px;
            gap: 12px;
            cursor: pointer;
            transition: background 0.1s;
          }
          .bmap-item:hover {
            background: var(--secondary-background-color, #F5F7FB);
          }
          .bmap-checkbox {
            width: 22px;
            height: 22px;
            border-radius: 50%;
            border: 2px solid var(--divider-color, #CCDAE3);
            flex-shrink: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
          }
          .bmap-item.completed .bmap-checkbox {
            background: var(--bmap-brand);
            border-color: var(--bmap-brand);
          }
          .bmap-item.completed .bmap-checkbox::after {
            content: "\\2713";
            color: #fff;
            font-size: 13px;
            font-weight: bold;
          }
          .bmap-item-content {
            flex: 1;
            min-width: 0;
          }
          .bmap-item-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bmap-item.completed .bmap-item-title {
            text-decoration: line-through;
            color: var(--secondary-text-color, #75858e);
          }
          .bmap-item-desc {
            font-size: 0.8em;
            color: var(--secondary-text-color, #75858e);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .bmap-item-color {
            width: 4px;
            height: 24px;
            border-radius: 2px;
            flex-shrink: 0;
          }
          .bmap-delete {
            opacity: 0;
            transition: opacity 0.15s;
            background: none;
            border: none;
            color: var(--error-color, #BA2E38);
            cursor: pointer;
            padding: 4px 2px;
            font-size: 1.2em;
            line-height: 1;
          }
          .bmap-item:hover .bmap-delete { opacity: 0.6; }
          .bmap-delete:hover { opacity: 1 !important; }
          .bmap-wave {
            height: 6px;
            margin: 4px 16px;
            background: repeating-linear-gradient(
              90deg,
              var(--divider-color, #CCDAE3) 0px,
              var(--divider-color, #CCDAE3) 6px,
              transparent 6px,
              transparent 12px
            );
            border-radius: 3px;
            opacity: 0.5;
          }
          .bmap-section-label {
            padding: 4px 16px 2px;
            font-size: 0.75em;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--secondary-text-color, #75858e);
            font-weight: 500;
          }
          .bmap-empty {
            padding: 32px 16px;
            text-align: center;
            color: var(--secondary-text-color, #75858e);
          }
        </style>

        <div class="bmap-header">
          <span class="bmap-header-icon">${BAG_ICON}</span>
          <span class="bmap-header-title">${this._esc(name)}</span>
          <span class="count">${needsAction.length}</span>
        </div>

        <div class="bmap-input-wrap">
          <span class="bmap-input-icon">+</span>
          <input
            class="bmap-input"
            type="text"
            placeholder="Add item..."
            autocomplete="off"
            value="${this._escAttr(this._inputValue)}"
          />
          <div class="bmap-suggestions"></div>
        </div>

        <div class="bmap-items">
          ${needsAction.length === 0 && (!showCompleted || completed.length === 0) ? `
            <div class="bmap-empty">List is empty</div>
          ` : ""}
          ${needsAction.map((item) => this._renderItem(item, false)).join("")}
          ${showCompleted && completed.length > 0 ? `
            <div class="bmap-wave"></div>
            <div class="bmap-section-label">Purchased (${completed.length})</div>
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
      input.addEventListener("focus", () => {
        if (this._inputValue.length >= 1) this._fetchSuggestions(this._inputValue);
      });
      input.addEventListener("blur", () => {
        setTimeout(() => {
          this._showSuggestions = false;
          this._renderSuggestions();
        }, 200);
      });
      // Restore cursor position
      if (this._inputValue) {
        input.setSelectionRange(this._inputValue.length, this._inputValue.length);
      }
    }

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
    const desc = item.description
      ? `<div class="bmap-item-desc">${this._esc(item.description)}</div>`
      : "";
    return `
      <div class="${cls}">
        <div class="bmap-checkbox-wrap" data-uid="${this._escAttr(item.uid)}" data-status="${item.status}">
          <div class="bmap-checkbox"></div>
        </div>
        <div class="bmap-item-content">
          <div class="bmap-item-title">${this._esc(item.summary)}</div>
          ${desc}
        </div>
        <button class="bmap-delete" data-uid="${this._escAttr(item.uid)}" title="Delete">×</button>
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
    // Only offer buymeapie entities, not HA's built-in ones
    const entities = Object.keys(hass.states).filter(
      (e) => e.startsWith("todo.") && hass.states[e].state !== "unavailable"
    );
    return { entity: entities[0] || "", show_completed: true };
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
    this._hass = hass;
    this._render();
  }

  _render() {
    if (!this._hass) return;

    // Find all available todo entities
    const entities = Object.keys(this._hass.states)
      .filter((e) => e.startsWith("todo.") && this._hass.states[e].state !== "unavailable")
      .sort();

    this.innerHTML = `
      <style>
        .bmap-editor { padding: 16px; }
        .bmap-editor label { display: block; font-weight: 500; margin-bottom: 6px; color: var(--primary-text-color); }
        .bmap-editor select {
          width: 100%;
          padding: 10px 12px;
          border-radius: 8px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          font-size: 1em;
          font-family: inherit;
          appearance: auto;
        }
        .bmap-editor .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 16px;
          cursor: pointer;
        }
        .bmap-editor .checkbox-row input { width: 18px; height: 18px; cursor: pointer; }
      </style>
      <div class="bmap-editor">
        <label for="bmap-entity-select">Shopping list</label>
        <select id="bmap-entity-select">
          ${!this._config.entity ? '<option value="" selected>Select a list...</option>' : ""}
          ${entities.map((e) => {
            const name = this._hass.states[e].attributes.friendly_name || e;
            const sel = e === this._config.entity ? "selected" : "";
            return `<option value="${e}" ${sel}>${name}</option>`;
          }).join("")}
        </select>
        <label class="checkbox-row">
          <input type="checkbox" id="bmap-show-completed" ${this._config.show_completed !== false ? "checked" : ""} />
          Show purchased items
        </label>
      </div>
    `;

    this.querySelector("#bmap-entity-select").addEventListener("change", (e) => {
      this._config = { ...this._config, entity: e.target.value };
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

customElements.define("buymeapie-card", BuyMeAPieCard);
customElements.define("buymeapie-card-editor", BuyMeAPieCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "buymeapie-card",
  name: "Buy Me a Pie",
  description: "Shopping list card with autocomplete from your Buy Me a Pie item history",
  preview: false,
});

console.info(
  `%c 🛒 BUYMEAPIE %c v${CARD_VERSION} `,
  "background:#0095FF;color:#fff;font-weight:bold;padding:2px 6px;border-radius:4px 0 0 4px",
  "background:#f7f7f7;color:#1a1a1a;padding:2px 6px;border-radius:0 4px 4px 0"
);

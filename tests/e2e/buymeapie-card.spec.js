// @ts-check
const { test, expect } = require("@playwright/test");

const HA_URL = "http://localhost:8123";
const HA_USER = "preben";
const HA_PASS = "snotunge";
const DASHBOARD_URL = `${HA_URL}/dashboard-test/0`;

// Helper: login to HA and navigate to the test dashboard
async function loginAndNavigate(page) {
  await page.goto(HA_URL);
  // Wait for login form or dashboard
  const isLoggedIn = await page
    .getByText("Shopping list")
    .first()
    .isVisible()
    .catch(() => false);

  if (!isLoggedIn) {
    await page.waitForSelector('input[name="username"], [ref]', {
      timeout: 10000,
    });
    const loginField = page.getByRole("textbox", { name: "Username" });
    if (await loginField.isVisible().catch(() => false)) {
      await loginField.fill(HA_USER);
      await page.getByRole("textbox", { name: "Password" }).fill(HA_PASS);
      await page.getByRole("button", { name: "Log in" }).click();
      await page.waitForURL(/.*\/.*/, { timeout: 15000 });
    }
  }

  await page.goto(DASHBOARD_URL);
  await page.waitForLoadState("networkidle");
}

// Helper: wait for the buymeapie card to render with items
async function waitForCard(page) {
  await page.waitForFunction(
    () => {
      function findInShadow(root, selector) {
        const el = root.querySelector(selector);
        if (el) return el;
        for (const child of root.querySelectorAll("*")) {
          if (child.shadowRoot) {
            const found = findInShadow(child.shadowRoot, selector);
            if (found) return found;
          }
        }
        return null;
      }
      const card = findInShadow(document, "buymeapie-card");
      return card && card.querySelector(".bmap-item");
    },
    { timeout: 30000 }
  );
}

// Helper: get card DOM via shadow DOM traversal
async function getCardInfo(page) {
  return page.evaluate(() => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    if (!card) return null;
    const active = card.querySelectorAll(".bmap-item:not(.completed)");
    const completed = card.querySelectorAll(".bmap-item.completed");
    return {
      activeCount: active.length,
      completedCount: completed.length,
      activeItems: Array.from(active).map((el) => ({
        uid: el.dataset.uid,
        title: el.querySelector(".bmap-item-title")?.textContent?.trim(),
        desc: el.querySelector(".bmap-item-desc")?.textContent?.trim() || "",
      })),
      completedItems: Array.from(completed)
        .slice(0, 5)
        .map((el) => ({
          uid: el.dataset.uid,
          title: el.querySelector(".bmap-item-title")?.textContent?.trim(),
        })),
      hasInput: !!card.querySelector(".bmap-input"),
      hasAddBtn: !!card.querySelector(".bmap-add-btn"),
    };
  });
}

// Helper: interact with the card through shadow DOM
async function clickItemByTitle(page, title) {
  await page.evaluate((t) => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    const items = card.querySelectorAll(".bmap-item");
    for (const item of items) {
      if (item.querySelector(".bmap-item-title")?.textContent?.trim() === t) {
        item.click();
        return;
      }
    }
    throw new Error(`Item "${t}" not found`);
  }, title);
}

async function addItemViaInput(page, text) {
  await page.evaluate((t) => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    const input = card.querySelector(".bmap-input");
    input.value = t;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    );
  }, text);
}

async function deleteItemByTitle(page, title) {
  await page.evaluate((t) => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    const items = card.querySelectorAll(".bmap-item");
    for (const item of items) {
      if (item.querySelector(".bmap-item-title")?.textContent?.trim() === t) {
        const del = item.querySelector(".bmap-delete");
        if (del) {
          del.click();
          return;
        }
      }
    }
    throw new Error(`Item "${t}" not found for deletion`);
  }, title);
}

async function getSuggestions(page) {
  return page.evaluate(() => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    const box = card.querySelector(".bmap-suggestions");
    if (!box || box.style.display === "none") return [];
    return Array.from(box.querySelectorAll(".bmap-suggestion")).map((s) => ({
      title: s.querySelector(".bmap-suggestion-title")?.textContent?.trim(),
      count: s.querySelector(".bmap-suggestion-count")?.textContent?.trim(),
    }));
  });
}

async function typeInInput(page, text) {
  await page.evaluate((t) => {
    function findInShadow(root, selector) {
      const el = root.querySelector(selector);
      if (el) return el;
      for (const child of root.querySelectorAll("*")) {
        if (child.shadowRoot) {
          const found = findInShadow(child.shadowRoot, selector);
          if (found) return found;
        }
      }
      return null;
    }
    const card = findInShadow(document, "buymeapie-card");
    const input = card.querySelector(".bmap-input");
    input.value = t;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Buy Me a Pie Card", () => {
  test.beforeEach(async ({ page }) => {
    await loginAndNavigate(page);
    await waitForCard(page);
  });

  test("card renders with items", async ({ page }) => {
    const info = await getCardInfo(page);
    expect(info).not.toBeNull();
    expect(info.activeCount).toBeGreaterThan(0);
    expect(info.hasInput).toBe(true);
    expect(info.hasAddBtn).toBe(true);
  });

  test("toggle active item to completed", async ({ page }) => {
    const before = await getCardInfo(page);
    const firstItem = before.activeItems[0];

    await clickItemByTitle(page, firstItem.title);
    await page.waitForTimeout(2000);

    const after = await getCardInfo(page);
    expect(after.activeCount).toBe(before.activeCount - 1);
    // Item should now be in completed
    const titles = after.activeItems.map((i) => i.title);
    expect(titles).not.toContain(firstItem.title);
  });

  test("toggle completed item back to active", async ({ page }) => {
    const before = await getCardInfo(page);
    if (before.completedCount === 0) {
      test.skip();
      return;
    }
    const firstCompleted = before.completedItems[0];

    await clickItemByTitle(page, firstCompleted.title);
    await page.waitForTimeout(2000);

    const after = await getCardInfo(page);
    expect(after.activeCount).toBe(before.activeCount + 1);
    const titles = after.activeItems.map((i) => i.title);
    expect(titles).toContain(firstCompleted.title);
  });

  test("add item then toggle it", async ({ page }) => {
    const itemName = `E2E-Test-${Date.now()}`;

    await addItemViaInput(page, itemName);
    await page.waitForTimeout(2000);

    // Verify it was added
    const afterAdd = await getCardInfo(page);
    const addedTitles = afterAdd.activeItems.map((i) => i.title);
    expect(addedTitles).toContain(itemName);

    // Toggle it to completed
    await clickItemByTitle(page, itemName);
    await page.waitForTimeout(2000);

    const afterToggle = await getCardInfo(page);
    const activeTitles = afterToggle.activeItems.map((i) => i.title);
    expect(activeTitles).not.toContain(itemName);

    // Clean up - delete from completed
    await deleteItemByTitle(page, itemName);
  });

  test("add item with quantity", async ({ page }) => {
    const before = await getCardInfo(page);

    await addItemViaInput(page, "TestMælk 3 l");
    await page.waitForTimeout(2000);

    const after = await getCardInfo(page);
    const added = after.activeItems.find((i) => i.title === "TestMælk");
    expect(added).toBeDefined();
    expect(added.desc).toBe("3 l");

    // Clean up
    await deleteItemByTitle(page, "TestMælk");
  });

  test("add multiple items with comma", async ({ page }) => {
    const before = await getCardInfo(page);

    await addItemViaInput(page, "E2E-A, E2E-B, E2E-C");
    await page.waitForTimeout(3000);

    const after = await getCardInfo(page);
    const titles = after.activeItems.map((i) => i.title);
    expect(titles).toContain("E2E-A");
    expect(titles).toContain("E2E-B");
    expect(titles).toContain("E2E-C");

    // Clean up
    await deleteItemByTitle(page, "E2E-A");
    await page.waitForTimeout(1000);
    await deleteItemByTitle(page, "E2E-B");
    await page.waitForTimeout(1000);
    await deleteItemByTitle(page, "E2E-C");
  });

  test("autocomplete shows suggestions", async ({ page }) => {
    await typeInInput(page, "mælk");
    await page.waitForTimeout(500);

    const suggestions = await getSuggestions(page);
    expect(suggestions.length).toBeGreaterThan(0);
    // Should contain Mælk as a prefix match
    const titles = suggestions.map((s) => s.title.toLowerCase());
    expect(titles.some((t) => t.startsWith("mælk"))).toBe(true);
  });

  test("delete item", async ({ page }) => {
    // Add a temp item first
    const itemName = `E2E-Del-${Date.now()}`;
    await addItemViaInput(page, itemName);
    await page.waitForTimeout(2000);

    const before = await getCardInfo(page);
    expect(before.activeItems.map((i) => i.title)).toContain(itemName);

    await deleteItemByTitle(page, itemName);
    await page.waitForTimeout(2000);

    const after = await getCardInfo(page);
    expect(after.activeItems.map((i) => i.title)).not.toContain(itemName);
  });

  test("completed items limited to 10", async ({ page }) => {
    const info = await getCardInfo(page);
    // With 484+ completed items, only 10 should be rendered
    expect(info.completedCount).toBeLessThanOrEqual(10);
  });
});

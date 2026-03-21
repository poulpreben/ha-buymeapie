const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: ".",
  timeout: 60000,
  retries: 0,
  use: {
    baseURL: "http://localhost:8123",
    headless: true,
    viewport: { width: 1024, height: 840 },
  },
});

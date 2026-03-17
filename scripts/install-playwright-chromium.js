const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectRoot = process.cwd();
const browsersRoot = path.join(projectRoot, "node_modules", "playwright-core", ".local-browsers");

function hasChromiumInstalled() {
  try {
    if (!fs.existsSync(browsersRoot)) return false;
    const entries = fs.readdirSync(browsersRoot, { withFileTypes: true });
    return entries.some((entry) => entry.isDirectory() && entry.name.toLowerCase().startsWith("chromium-"));
  } catch {
    return false;
  }
}

if (hasChromiumInstalled()) {
  console.log("[playwright] Chromium already installed in local browsers path. Skipping install.");
  process.exit(0);
}

const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
console.log("[playwright] Installing Chromium into PLAYWRIGHT_BROWSERS_PATH=0 ...");

const result = spawnSync(cmd, ["playwright", "install", "chromium"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: "0",
  },
});

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);

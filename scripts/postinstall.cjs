const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function copyFiles(srcDir, destDir) {
  const destPath = path.join(__dirname, "..", destDir);
  fs.mkdirSync(destPath, { recursive: true });
  const files = fs.readdirSync(srcDir);
  for (const f of files) {
    try {
      fs.copyFileSync(path.join(srcDir, f), path.join(destPath, f));
    } catch (e) {
      console.error(`[opencode-memory] Failed to copy ${f}: ${e.message}`);
    }
  }
}

copyFiles("agent", "agent");
copyFiles("commands", "commands");

// Register dist/tui.js in the GLOBAL tui.json so the Fractal Memory sidebar box
// renders in every project. OpenCode only scans <project>/.opencode/tui.json and
// ~/.config/opencode/tui.json — a manifest inside this package is never discovered.
function registerGlobalTui() {
  try {
    const tuiEntry = require.resolve("./dist/tui.js");
    const globalDir = path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "opencode");
    const globalTui = path.join(globalDir, "tui.json");
    fs.mkdirSync(globalDir, { recursive: true });
    let json = {};
    try {
      if (fs.existsSync(globalTui)) json = JSON.parse(fs.readFileSync(globalTui, "utf8"));
    } catch (e) { /* corrupt file — start fresh */ }
    const plugins = new Set(Array.isArray(json.plugin) ? json.plugin : []);
    plugins.add(tuiEntry);
    if (!json.$schema) json.$schema = "https://opencode.ai/tui.json";
    json.plugin = [...plugins];
    fs.writeFileSync(globalTui, JSON.stringify(json, null, 2) + "\n");
    console.log(`[opencode-memory] TUI registered in ${globalTui}`);
  } catch (e) {
    console.error(`[opencode-memory] TUI registration skipped: ${e.message}`);
  }
}
registerGlobalTui();

if (process.env._BUN_LIBRARIES_PATH || process.argv[0].includes("bun")) {
  execSync("bun run scripts/download-models.ts", { stdio: "inherit" });
}

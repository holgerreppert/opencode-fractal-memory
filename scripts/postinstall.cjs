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
// OpenCode 2.x moved terminal client config to a single global cli.json, so both
// files are written.
function registerGlobalTui() {
  try {
    // Use npm spec "opencode-fractal-memory" (resolved via node_modules), not absolute path.
    // Absolute dist/tui.js entries cause duplicate boxes when both global + project configs merge.
    const expectedDist = require.resolve("./dist/tui.js");
    if (!require("fs").existsSync(expectedDist)) throw new Error("dist/tui.js missing");
    const tuiEntry = "opencode-fractal-memory";
    const globalDir = path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "opencode");
    fs.mkdirSync(globalDir, { recursive: true });
    for (const fileName of ["tui.json", "cli.json"]) {
      const globalTui = path.join(globalDir, fileName);
      let json = {};
      try {
        if (fs.existsSync(globalTui)) json = JSON.parse(fs.readFileSync(globalTui, "utf8"));
      } catch (e) { /* corrupt file — start fresh */ }
      // OpenCode 2.x has a single `plugins` key, so it carries the union of
      // both keys. This package's legacy absolute dist/tui.js entries are
      // dropped (duplicate sidebar boxes — npm specs and file paths are not
      // deduped); other packages' entries are left untouched.
      const others = [];
      for (const list of [json.plugin, json.plugins]) {
        for (const p of Array.isArray(list) ? list : []) {
          const s = String(p);
          if (s.includes(tuiEntry) && s.includes("dist/tui.js")) continue;
          if (s === tuiEntry) continue;
          if (!others.includes(s)) others.push(s);
        }
      }
      if (!json.$schema) json.$schema = fileName === "cli.json" ? "https://opencode.ai/cli.json" : "https://opencode.ai/tui.json";
      json.plugin = [tuiEntry, ...others];
      json.plugins = [tuiEntry, ...others];
      fs.writeFileSync(globalTui, JSON.stringify(json, null, 2) + "\n");
      console.log(`[opencode-memory] TUI registered in ${globalTui}`);
    }
  } catch (e) {
    console.error(`[opencode-memory] TUI registration skipped: ${e.message}`);
  }
}
registerGlobalTui();

if (process.env._BUN_LIBRARIES_PATH || process.argv[0].includes("bun")) {
  execSync("bun run scripts/download-models.ts", { stdio: "inherit" });
}

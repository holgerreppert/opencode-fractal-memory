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

// Register the npm spec in the OpenCode 2.x `plugins` key (server +
// terminal client). Legacy `tui.json` / `plugin` key writes are gone:
// OpenCode 2 resolves `exports["./tui"]` from the package spec itself.
function registerGlobalPlugin() {
  try {
    const pkgName = require(path.join(__dirname, "..", "package.json")).name;
    const globalDir = path.join(process.env.HOME || process.env.USERPROFILE || "", ".config", "opencode");
    fs.mkdirSync(globalDir, { recursive: true });
    for (const fileName of ["opencode.json", "cli.json"]) {
      const file = path.join(globalDir, fileName);
      let json = {};
      try {
        if (fs.existsSync(file)) json = JSON.parse(fs.readFileSync(file, "utf8"));
      } catch (e) { /* corrupt file — start fresh */ }
      // Keep other plugins; drop stale references to this package that are not
      // the bare spec (cache paths, shim dirs, absolute dist/*.js paths).
      const others = [];
      for (const p of Array.isArray(json.plugins) ? json.plugins : []) {
        const s = String(p);
        if (s !== pkgName && s.includes(pkgName)) continue;
        if (!others.includes(s)) others.push(s);
      }
      if (!json.$schema) json.$schema = fileName === "cli.json" ? "https://opencode.ai/cli.json" : "https://opencode.ai/config.json";
      json.plugins = [pkgName, ...others.filter((p) => p !== pkgName)];
      fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
      console.log(`[opencode-memory] Registered ${pkgName} in ${file}`);
    }
  } catch (e) {
    console.error(`[opencode-memory] Plugin registration skipped: ${e.message}`);
  }
}
registerGlobalPlugin();

if (process.env._BUN_LIBRARIES_PATH || process.argv[0].includes("bun")) {
  execSync("bun run scripts/download-models.ts", { stdio: "inherit" });
}

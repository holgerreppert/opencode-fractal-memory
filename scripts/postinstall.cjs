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

if (process.env._BUN_LIBRARIES_PATH || process.argv[0].includes("bun")) {
  execSync("bun run scripts/download-models.ts", { stdio: "inherit" });
}

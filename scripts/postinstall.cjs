const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const home = process.env.HOME || process.env.USERPROFILE;
const configDir = path.join(home, ".config", "opencode");

function copyFiles(srcDir, destDir) {
  const destPath = path.join(configDir, destDir);
  fs.mkdirSync(destPath, { recursive: true });
  try {
    const files = fs.readdirSync(srcDir);
    for (const f of files) {
      try {
        fs.copyFileSync(path.join(srcDir, f), path.join(destPath, f));
      } catch {}
    }
  } catch {}
}

copyFiles("agent", "agent");
copyFiles("commands", "commands");

try {
  execSync("bun run scripts/download-models.ts", { stdio: "inherit" });
} catch {
  console.log(
    "bun not available — models will download automatically on first plugin load",
  );
}

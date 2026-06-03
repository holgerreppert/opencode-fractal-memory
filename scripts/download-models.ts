import { ensureModels, ensureAgentFiles, ensureCommandFiles } from "../src/ensure-models";

async function main() {
  console.log("Checking embedding model files...");
  await ensureModels();
  console.log("Copying agent files...");
  await ensureAgentFiles();
  console.log("Copying command files...");
  await ensureCommandFiles();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Failed to download models:", err);
  process.exit(1);
});

import { ensureModels } from "../src/ensure-models";

async function main() {
  console.log("Checking embedding model files...");
  await ensureModels();
  console.log("Done. Embedding model ready at ~/.config/opencode/models/");
}

main().catch((err) => {
  console.error("Failed to download models:", err);
  process.exit(1);
});

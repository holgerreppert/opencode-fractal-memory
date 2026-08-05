import * as path from "node:path";
import { seedLocomoDatabase } from "./benchmark/seed-locomo";

const DEFAULT_OUT = "tests/dbs/locomo-seeded";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
  };
  return {
    dataset: get("--dataset", "scripts/benchmark/data/locomo10.json"),
    out: get("--out", DEFAULT_OUT),
    regenerate: args.includes("--regenerate-embeddings"),
  };
}

async function seed(): Promise<void> {
  const config = parseArgs();
  console.log(`Seeding LoCoMo database -> ${config.out} (dataset: ${config.dataset})`);

  const result = await seedLocomoDatabase(path.resolve(config.out), {
    dataset: config.dataset,
    regenerateEmbeddings: config.regenerate,
  });

  console.log(`\n=== Seed complete ===`);
  console.log(`  Turns:      ${result.turns}`);
  console.log(`  QA pairs:   ${result.qas}`);
  console.log(`  Database:   ${result.dbPath}`);
  console.log(`  QA file:    ${result.qaPath}`);
  console.log(`  Time:       ${(result.elapsedMs / 1000).toFixed(1)}s`);
}

seed().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});

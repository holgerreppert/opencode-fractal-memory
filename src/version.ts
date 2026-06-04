import { fileURLToPath } from "node:url";
import * as path from "node:path";
import * as fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf-8")) as { version: string };
export const VERSION = pkg.version;

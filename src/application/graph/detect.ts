import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".pyi",
  ".rs", ".go", ".java", ".rb", ".php",
  ".c", ".h", ".cpp", ".hpp", ".cc",
  ".cs", ".swift", ".kt", ".kts", ".scala",
  ".sh", ".bash", ".zsh",
  ".css", ".html", ".json", ".yaml", ".yml",
  ".md", ".sql", ".lua", ".dart", ".zig",
  ".ex", ".exs", ".hs", ".tf",
  ".proto", ".graphql", ".gql", ".toml",
  ".svelte", ".vue", ".astro",
]);

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "target",
  ".cache", ".next", ".svelte-kit", ".venv", "venv",
  "__pycache__", ".github", ".vscode", ".idea",
  "coverage", ".nyc_output", "tmp", "temp",
  "bower_components", "vendor", ".tox", ".eggs",
  "lib", "lib64", "bin", "obj",
  "management", "commands",
]);

function hasCodeExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot === -1) return false;
  return CODE_EXTENSIONS.has(filePath.slice(dot).toLowerCase());
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith(".");
}

export function findCodeFiles(root: string): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat: ReturnType<typeof statSync> | undefined;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        if (!shouldSkipDir(entry)) walk(fullPath);
      } else if (stat.isFile() && stat.size > 0 && stat.size < 1_000_000 && hasCodeExtension(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  return files.sort();
}

export { CODE_EXTENSIONS };

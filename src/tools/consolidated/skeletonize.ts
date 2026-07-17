import { tool } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { extractSkeleton } from "../../application/skeletonize";

export function createSkeletonizeTool() {
  const t = tool({
    description: `USE INSTEAD OF READING LARGE FILES — returns compact structure (imports + symbol signatures) at ~10% the token cost of a full read.

Supports 32 languages: TypeScript, JavaScript, Python, Rust, Go, Java, Ruby, PHP, C/C++, C#, Swift, Kotlin, Scala, Bash, CSS, HTML, JSON, YAML, Markdown, SQL, Lua, Perl, R, Dart, Zig, Elm, Clojure, Elixir, Haskell, OCaml, HCL, Protobuf, GraphQL, Sass, SCSS, Less, Dockerfile, Make, CMake, TOML.

Returns structure: imports (first 15) + all function/class/enum/interface/trait/struct declarations with line numbers and nesting depth.

TIP: For files >200 lines, skeletonize(path) first — then read specific sections with offset.`,
    args: {
      path: tool.schema.string().describe("Absolute path to the source file to skeletonize"),
    },
    async execute(args) {
      const path = args.path as string;
      if (!path) {
        return "Error: 'path' argument is required. Usage: skeletonize(path=\"/absolute/path/to/file.ts\")";
      }

      let content: string;
      try {
        content = await readFile(path, "utf-8");
      } catch {
        return `Error: Cannot read file at "${path}". File not found or permission denied.`;
      }

      try {
        const skeleton = extractSkeleton(path, content);
        if (!skeleton) {
          return `No skeleton produced for "${path}" — file may be too small (<100 chars), have no recognizable symbols, or use an unsupported language.`;
        }
        return skeleton;
      } catch (err) {
        return `Error generating skeleton: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

  return t;
}

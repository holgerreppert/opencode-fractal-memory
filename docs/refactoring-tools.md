# Command-line refactoring / code transformation tools (Top 10 languages) + OS availability

Notes:
- “Yes” means it’s commonly runnable on Linux/macOS/Windows via native builds or standard language runtimes (Java/Node/Python/.NET).
- “Mostly” means you may need a shell-specific setup (e.g., WSL for some clang workflows).

## Java
- **OpenRewrite** — **Yes** (Linux/macOS/Windows; typically via Java)
- **Error Prone** — **Yes** (Linux/macOS/Windows; used via Gradle/Maven)
- **JBang** — **Yes** (Linux/macOS/Windows; runs with a JVM)

## JavaScript / TypeScript
- **jscodeshift** — **Yes** (Linux/macOS/Windows; Node-based CLI)
- **babel-codemod** — **Yes** (Linux/macOS/Windows; Node-based CLI; installed as `codemod` binary)
- **sref** — **Yes** (Linux/macOS/Windows; `npm install -g structural-refactor` — IntelliJ-style rename/extract/move/inline via ts-morph + oxc, call graph, CJS→ESM, undo)
- **ts-morph** (as codemods you write/run) — **Yes** (Linux/macOS/Windows; Node-based)

## Python
- **emend** — **Yes** (Linux/macOS/Windows; via pip/uv — CLI, not library)
  - Pattern transforms: `emend replace 'print($X)' 'logger.info($X)' file.py --apply`
  - Structured edits: `emend edit file.py::func[returns] "int" --apply`
  - Symbol management: rename, move, copy, refs, dead code, call graph
  - Built-in MCP server: `emend mcp`
  - Dry-run by default; Rust backend (tree-sitter)
- **pyupgrade** — **Yes** (Linux/macOS/Windows; Python-based)
- **pyseam** — **Yes** (Linux/macOS/Windows; via uv/pip — semantic rename, refs, inline)

## Go
- **gofmt** — **Yes** (Linux/macOS/Windows)
- **goimports** — **Yes** (Linux/macOS/Windows)
- **gorename** — **Yes** (Linux/macOS/Windows)
- *(Optional)* **staticcheck** — **Yes** (Linux/macOS/Windows)

## C / C++
- **clang-tidy** — **Mostly** (Linux/macOS: yes; Windows: often via LLVM binaries/WSL; varies by toolchain)
- **clang-apply-replacements** — **Mostly** (same as above)
- **clang-format** — **Mostly** (Linux/macOS: yes; Windows: typically via LLVM binaries/WSL)

## C#
- **dotnet format** — **Yes** (Linux/macOS/Windows; .NET CLI)
- **Roslyn analyzers/code fixes** — **Yes** (Linux/macOS/Windows; via `dotnet` build/test)
- **csharpier** — **Yes** (Linux/macOS/Windows; runs via .NET/Node depending on package)

## Rust
- **rustfmt** — **Yes** (Linux/macOS/Windows)
- **cargo fix** — **Yes** (Linux/macOS/Windows)
- **clippy** (with `--fix` where applicable) — **Yes** (Linux/macOS/Windows)

## Ruby
- **rubocop** — **Yes** (Linux/macOS/Windows; Ruby gem)
- **standardrb** — **Yes** (Linux/macOS/Windows; Ruby gem)
- *(Optional)* **Sorbet tooling** — **Yes** (Linux/macOS/Windows; Ruby ecosystem varies by setup)

## PHP
- **rector** — **Yes** (Linux/macOS/Windows; PHP CLI)
- **php-cs-fixer** — **Yes** (Linux/macOS/Windows; PHP CLI)
- **psalm** (analysis + fix workflows when configured) — **Yes** (Linux/macOS/Windows; PHP CLI)

## Kotlin
- **ktlint** — **Yes** (Linux/macOS/Windows; commonly JVM-based CLI)
- *(Common approach)* **Gradle + detekt** — **Yes** (Linux/macOS/Windows; Gradle/JVM)
- *(Optional)* **OpenRewrite** — **Yes** (Linux/macOS/Windows; JVM-based)

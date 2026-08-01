export type OutputType = "build-log" | "dep-tree" | "log-stream" | "config-content" | "source-code" | "compiler-diagnostics" | "test-output" | "npm-install" | "coverage-log" | "raw-text";
export type OutputTypeResult = { type: OutputType; compressed: string } | null;

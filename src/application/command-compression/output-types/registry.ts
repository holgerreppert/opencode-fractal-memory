import type { OutputType, OutputTypeResult } from "./types";

export interface OutputTypeCompressor {
  readonly type: OutputType;
  readonly compress: (raw: string, maxLines: number) => OutputTypeResult;
}

import { compressSourceCode } from "./compressors/source-code";
import { compressBuildLog } from "./compressors/build-log";
import { compressDepTree } from "./compressors/dep-tree";
import { compressLogStream } from "./compressors/log-stream";
import { compressConfigContent } from "./compressors/config-content";
import { compressRawText } from "./compressors/raw-text";
import { compressCompilerDiagnostics } from "./compressors/compiler-diagnostics";
import { compressTestOutput } from "./compressors/test-output";
import { compressNpmInstall } from "./compressors/npm-install";
import { compressCoverageLog } from "./compressors/coverage-log";

export function createOutputTypeRegistry(): OutputTypeCompressor[] {
  return [
    { type: "build-log", compress: compressBuildLog },
    { type: "source-code", compress: compressSourceCode },
    { type: "compiler-diagnostics", compress: compressCompilerDiagnostics },
    { type: "test-output", compress: compressTestOutput },
    { type: "coverage-log", compress: compressCoverageLog },
    { type: "npm-install", compress: compressNpmInstall },
    { type: "dep-tree", compress: compressDepTree },
    { type: "log-stream", compress: compressLogStream },
    { type: "config-content", compress: compressConfigContent },
    { type: "raw-text", compress: compressRawText },
  ];
}

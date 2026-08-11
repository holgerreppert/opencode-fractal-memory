import type { OutputTypeResult } from "../types";

export function compressSourceCode(raw: string, _maxLines: number): OutputTypeResult {
  const lines = raw.split("\n");
  const imports: string[] = [];
  const signatures: string[] = [];
  const errors: string[] = [];
  const other: string[] = [];
  let totalLines = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trimStart();
    if (!trimmed) continue;
    if (trimmed.startsWith("```")) continue;

    if (/^(import |export |from ["']|use |package |#include|#import)/.test(trimmed) && !/^import\s+type/.test(trimmed)) {
      if (imports.length < 15) imports.push(trimmed);
      continue;
    }

    if ((/^(function |class |interface |type |enum |trait |impl |struct |pub |fn |def |async def)/.test(trimmed) ||
         /^(export (default )?(function|class|interface|type|enum|const|let|var))/.test(trimmed) ||
         /^(public|private|protected) (static )?(function|class|interface)/.test(trimmed) ||
         /^(const|let|var)\s+\w+\s*[:=]\s*(\(|[a-zA-Z])/.test(trimmed) ||
         /^(func |type |struct |interface )/.test(trimmed)) &&
        !signatures.some(s => s.includes(trimmed.slice(0, 40)))) {
      const sigEnd = trimmed.indexOf("{");
      const sig = sigEnd >= 0 ? trimmed.slice(0, sigEnd).trim() : trimmed;
      if (sig.length < 150) signatures.push(sig + "; // L" + (i + 1));
      continue;
    }

    if (/\b(ERROR|error|Error|FAIL|fail|Exception|exception)\b/.test(trimmed) &&
        /:\d+/.test(trimmed)) {
      errors.push(trimmed.slice(0, 200));
      continue;
    }

    other.push(trimmed.slice(0, 100));
  }

  const result: string[] = [];

  if (imports.length > 0) {
    result.push(`// imports (${imports.length})`);
    result.push(...imports);
  }

  if (signatures.length > 0) {
    result.push(`// signatures (${signatures.length})`);
    result.push(...signatures);
  }

  if (errors.length > 0) {
    result.push(`// errors (${errors.length})`);
    result.push(...errors.slice(0, 5));
    if (errors.length > 5) result.push(`// ... +${errors.length - 5} more error lines`);
  }

  if (result.length === 0) return null;

  const compressed = result.join("\n");
  if (compressed.length >= raw.length * 0.9) return null;
  if (compressed.length > 4000) {
    return {
      type: "source-code",
      compressed: `[source-code: ${totalLines}→${result.length} lines — imports ${imports.length}, signatures ${signatures.length}, errors ${errors.length}]\n${result.join("\n")}`,
    };
  }
  return { type: "source-code", compressed: `[source-code: ${totalLines}→${result.length} lines — imports ${imports.length}, signatures ${signatures.length}, errors ${errors.length}]\n${result.join("\n")}` };
}

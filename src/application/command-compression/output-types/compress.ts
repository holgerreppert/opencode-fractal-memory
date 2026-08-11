import { detectOutputType } from "./detect";
import { createOutputTypeRegistry } from "./registry";
import type { OutputType, OutputTypeResult } from "./types";

export function compressByType(raw: string, maxLines: number, explicitType?: OutputType): OutputTypeResult | null {
  if (!raw || raw.length < 80) return null;
  const type = explicitType ?? detectOutputType(raw);
  const compressor = createOutputTypeRegistry().find((c) => c.type === type);
  return compressor ? compressor.compress(raw, maxLines) : null;
}

import type { CompressConfig } from "./config";

export function tryDeltaCompression(
  deltaCache: Map<string, { raw: string; strategy: string }>,
  command: string,
  rawOutput: string,
  config: CompressConfig,
): { output: string; strategy: string } | null {
  const enabled = config.deltaCompressionEnabled ?? true;
  if (!enabled) return null;

  const minSimilarity = config.deltaMinSimilarity ?? 0.5;

  const fingerprint = command.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!fingerprint) return null;

  const cached = deltaCache.get(fingerprint);
  if (!cached) return null;

  const prevLines = cached.raw.split("\n");
  const currLines = rawOutput.split("\n");

  let prefixLen = 0;
  const minLen = Math.min(prevLines.length, currLines.length);
  while (prefixLen < minLen && prevLines[prefixLen] === currLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const maxPrefixSpace = minLen - prefixLen;
  while (suffixLen < maxPrefixSpace &&
         prevLines[prevLines.length - 1 - suffixLen] === currLines[currLines.length - 1 - suffixLen]) {
    suffixLen++;
  }

  const unchanged = prefixLen + suffixLen;
  const maxLen = Math.max(prevLines.length, currLines.length);
  const similarity = maxLen > 0 ? unchanged / maxLen : 1;

  if (similarity < minSimilarity) return null;

  if (prevLines.length === currLines.length && prefixLen === prevLines.length) {
    const result = `[Output unchanged since previous run — ${currLines.length} lines, previously "${cached.strategy}"]`;
    if (result !== rawOutput) {
      return { output: result, strategy: "delta" };
    }
    return null;
  }

  const addedCount = currLines.length - unchanged;
  const removedCount = prevLines.length - unchanged;

  const parts: string[] = [];
  parts.push(`[Δ ${Math.round(similarity * 100)}% similar — +${addedCount}, -${removedCount} since previous run — prev: ${cached.strategy}]`);

  if (prefixLen > 0) {
    const ctxBefore = Math.min(prefixLen, 4);
    parts.push(...currLines.slice(prefixLen - ctxBefore, prefixLen));
  }

  const changedCurr = currLines.slice(prefixLen, currLines.length - suffixLen);
  if (changedCurr.length <= 30) {
    parts.push(...changedCurr);
  } else {
    parts.push(...changedCurr.slice(0, 15));
    parts.push(`... ${changedCurr.length - 15} more lines ...`);
  }

  if (suffixLen > 0) {
    const ctxAfter = Math.min(suffixLen, 3);
    parts.push(...currLines.slice(currLines.length - suffixLen, currLines.length - suffixLen + ctxAfter));
  }

  const result = parts.join("\n");
  if (result !== rawOutput && result.length < rawOutput.length * 0.9) {
    return { output: result, strategy: "delta" };
  }
  return null;
}

export function updateDeltaCache(
  deltaCache: Map<string, { raw: string; strategy: string }>,
  command: string,
  rawOutput: string,
  strategy: string,
  maxSize: number = 50,
): void {
  const fingerprint = command.replace(/\s+/g, " ").trim().slice(0, 200);
  if (!fingerprint) return;
  if (deltaCache.size >= maxSize) {
    const firstKey = deltaCache.keys().next().value;
    if (firstKey) deltaCache.delete(firstKey);
  }
  deltaCache.set(fingerprint, { raw: rawOutput, strategy });
}

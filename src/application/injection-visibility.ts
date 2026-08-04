import type { MemConfig } from "../infrastructure/config/config";

export interface InjectionRecord {
  feature: string;
  detail: string;
  timestamp: number;
}

export interface InjectionVisibilityConfig {
  enabled: boolean;
  markers: boolean;
  digest: boolean;
}

export function getInjectionVisibilityConfig(config: MemConfig): InjectionVisibilityConfig {
  return {
    enabled: config.injectionVisibility?.enabled ?? true,
    markers: config.injectionVisibility?.markers ?? true,
    digest: config.injectionVisibility?.digest ?? true,
  };
}

/**
 * Build a visible marker for an injection surface. When markers are disabled
 * (config.injectionVisibility.markers=false) returns "" so callers can skip
 * inline decoration while still recording the injection.
 */
export function injectionMarker(config: MemConfig, feature: string, detail: string): string {
  const vis = getInjectionVisibilityConfig(config);
  if (!vis.enabled || !vis.markers) return "";
  return `[memory-plugin:${feature}] ${detail}`;
}

// ---------------------------------------------------------------------------
// Per-turn injection ledger. Handlers record every injection they perform;
// the digest handler (registered last in the messages.transform chain) drains
// the ledger and emits a single synthetic summary message per turn.
// ---------------------------------------------------------------------------

const turnLedger: InjectionRecord[] = [];

export function recordInjection(config: MemConfig, feature: string, detail: string): void {
  const vis = getInjectionVisibilityConfig(config);
  if (!vis.enabled || !vis.digest) return;
  turnLedger.push({ feature, detail, timestamp: Date.now() });
}

export function resetInjectionLedger(): void {
  turnLedger.length = 0;
}

export function drainInjectionLedger(): InjectionRecord[] {
  const drained = turnLedger.slice();
  turnLedger.length = 0;
  return drained;
}

export function peekInjectionLedger(): InjectionRecord[] {
  return turnLedger.slice();
}

/**
 * Build the per-turn digest text from ledger records. Groups by feature and
 * prints a compact single line per feature.
 */
export function buildInjectionDigest(records: InjectionRecord[]): string {
  if (records.length === 0) return "";

  const byFeature = new Map<string, string[]>();
  for (const r of records) {
    const list = byFeature.get(r.feature) ?? [];
    list.push(r.detail);
    byFeature.set(r.feature, list);
  }

  const lines: string[] = ["[memory-plugin:digest] injections this turn:"];
  for (const [feature, details] of byFeature) {
    const seen = new Set(details);
    const detailText = [...seen].slice(0, 5).map(d => ` ${d}`).join(";");
    const count = seen.size > 1 ? ` (${seen.size})` : "";
    lines.push(`  - ${feature}${count}:${detailText}`);
  }
  return lines.join("\n");
}

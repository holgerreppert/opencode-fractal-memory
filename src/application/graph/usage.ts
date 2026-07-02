import { writeGraphUsageLog, getSessionId } from "../../logging";

export interface GraphUsageStats {
  build: { count: number; lastBuild: string | null; fileCount?: number; symbolCount?: number; edgeCount?: number };
  search: { count: number; lastCall: string | null };
  path: { count: number; lastCall: string | null };
  explain: { count: number; lastCall: string | null };
  ruleInjections: { count: number; lastInjection: string | null };
  backgroundBuilds: { count: number; lastTrigger: string | null };
  exports: { count: number; lastExport: string | null };
}

const stats: GraphUsageStats = {
  build: { count: 0, lastBuild: null },
  search: { count: 0, lastCall: null },
  path: { count: 0, lastCall: null },
  explain: { count: 0, lastCall: null },
  ruleInjections: { count: 0, lastInjection: null },
  backgroundBuilds: { count: 0, lastTrigger: null },
  exports: { count: 0, lastExport: null },
};

function now(): string {
  return new Date().toISOString();
}

function logUsage(action: string, fields: Record<string, string | number>, source: string): void {
  try {
    const session = getSessionId();
    writeGraphUsageLog({ action, source, ...(session ? { session: session.slice(0, 8) } : {}), ...fields });
  } catch {
    // logging not available
  }
}

export function trackBuild(fileCount?: number, symbolCount?: number, edgeCount?: number, source = "unknown"): void {
  stats.build.count++;
  stats.build.lastBuild = now();
  if (fileCount !== undefined) stats.build.fileCount = fileCount;
  if (symbolCount !== undefined) stats.build.symbolCount = symbolCount;
  if (edgeCount !== undefined) stats.build.edgeCount = edgeCount;
  logUsage("build", { count: stats.build.count, files: fileCount ?? 0, symbols: symbolCount ?? 0 }, source);
}

export function trackSearch(source = "unknown"): void {
  stats.search.count++;
  stats.search.lastCall = now();
  logUsage("search", { count: stats.search.count }, source);
}

export function trackPath(source = "unknown"): void {
  stats.path.count++;
  stats.path.lastCall = now();
  logUsage("path", { count: stats.path.count }, source);
}

export function trackExplain(source = "unknown"): void {
  stats.explain.count++;
  stats.explain.lastCall = now();
  logUsage("explain", { count: stats.explain.count }, source);
}

export function trackRuleInjection(source = "unknown"): void {
  stats.ruleInjections.count++;
  stats.ruleInjections.lastInjection = now();
  logUsage("rule-injection", { count: stats.ruleInjections.count }, source);
}

export function trackBackgroundBuild(source = "unknown"): void {
  stats.backgroundBuilds.count++;
  stats.backgroundBuilds.lastTrigger = now();
  logUsage("background-build", { count: stats.backgroundBuilds.count }, source);
}

export function trackExport(source = "unknown"): void {
  stats.exports.count++;
  stats.exports.lastExport = now();
  logUsage("export", { count: stats.exports.count }, source);
}

export function getGraphUsageStats(): GraphUsageStats {
  return {
    build: { ...stats.build },
    search: { ...stats.search },
    path: { ...stats.path },
    explain: { ...stats.explain },
    ruleInjections: { ...stats.ruleInjections },
    backgroundBuilds: { ...stats.backgroundBuilds },
    exports: { ...stats.exports },
  };
}

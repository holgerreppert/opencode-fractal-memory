import type { CompressConfig } from "./config";
import { compressLs } from "./strategies/ls";
import { compressTestOutput } from "./strategies/test";
import { compressGrep } from "./strategies/grep";
import { compressGitStatus, compressGitLog, compressGitDiff, compressGitPush, compressGitCommit, compressGitAdd, compressGitPull } from "./strategies/git";
import { compressGeneric } from "./strategies/generic";

const TEST_PREFIX = /^(npm test|bun test|pnpm test|yarn test|vitest|jest|pytest|go test|cargo test)/;
const TRUNCATE_FAMILIES = /^(cat |head |tail |find |docker)/;
const RUN_PREFIX = /^(npm run|bun run|pnpm run|yarn)\s/;

export interface StrategyContext {
  cmd: string;
  raw: string;
  lines: string[];
  config: CompressConfig;
  keepMatches: number;
  keepNames: number;
  keepRows: number;
  exceedsTier3: boolean;
  essentialColumns?: string[] | undefined;
}

export interface CompressStrategy {
  readonly id: string;
  readonly matches: (prefix: string, ctx: StrategyContext) => boolean;
  readonly compress: (ctx: StrategyContext) => string | null;
}

function gitQuick(ctx: StrategyContext, fn: (raw: string) => string): string | null {
  return fn(ctx.raw);
}

export function createStrategyRegistry(): CompressStrategy[] {
  return [
    {
      id: "ls",
      matches: (prefix) => prefix.startsWith("ls") || prefix.startsWith("tree "),
      compress: (ctx) => compressLs(ctx.raw, ctx.keepNames),
    },
    {
      id: "test",
      matches: (prefix) => TEST_PREFIX.test(prefix),
      compress: (ctx) => compressTestOutput(ctx.raw),
    },
    {
      id: "grep",
      matches: (prefix) => /^(?:rg|grep)\s/.test(prefix),
      compress: (ctx) => compressGrep(ctx.raw, ctx.keepMatches),
    },
    {
      id: "git-status",
      matches: (prefix) => prefix.startsWith("git status"),
      compress: (ctx) => compressGitStatus(ctx.raw),
    },
    {
      id: "git-log",
      matches: (prefix) => prefix.startsWith("git log"),
      compress: (ctx) => compressGitLog(ctx.raw),
    },
    {
      id: "git-diff",
      matches: (prefix) => prefix.startsWith("git diff"),
      compress: (ctx) => compressGitDiff(ctx.raw),
    },
    {
      id: "git-quick",
      matches: (prefix) => /^git push\b/.test(prefix),
      compress: (ctx) => gitQuick(ctx, compressGitPush),
    },
    {
      id: "git-quick",
      matches: (prefix) => /^git commit\b/.test(prefix),
      compress: (ctx) => gitQuick(ctx, compressGitCommit),
    },
    {
      id: "git-quick",
      matches: (prefix) => /^git add\b/.test(prefix),
      compress: (ctx) => gitQuick(ctx, compressGitAdd),
    },
    {
      id: "git-quick",
      matches: (prefix) => /^git pull\b/.test(prefix),
      compress: (ctx) => compressGitPull(ctx.raw),
    },
    {
      id: "truncate",
      matches: (prefix) => TRUNCATE_FAMILIES.test(prefix) || RUN_PREFIX.test(prefix),
      compress: (ctx) => (ctx.exceedsTier3 ? compressGeneric(ctx.raw, ctx.config.maxLines) : null),
    },
  ];
}

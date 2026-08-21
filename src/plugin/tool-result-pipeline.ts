import { memLog } from "../logging"

export type ToolResult = {
  tool: string
  sessionID?: string | undefined
  args?: Record<string, unknown> | undefined
  output?: string | undefined
  title?: string | undefined
  metadata?: Record<string, unknown> | undefined
}

export type Annotation = {
  source: string
  message: string
}

export type LossClass = "lossless" | "structural-summary" | "semantic-summary" | "heuristic-truncate" | "externalized" | "passthrough"

export type TransformationRecord = {
  name: string
  priority: number
  applied: boolean
  durationMs: number
  rawSize: number
  newSize: number
  tokensSaved: number
  lossClass: LossClass
  error?: string
}

export type ToolResultContext = {
  raw: ToolResult
  current: ToolResult
  annotations: Annotation[]
  provenance: TransformationRecord[]
}

export interface ToolResultTransformer {
  name: string
  priority: number
  applies?: ((ctx: ToolResultContext) => boolean) | undefined
  transform: (ctx: ToolResultContext) => Promise<ToolResultContext>
}

function inferLossClass(name: string, rawSize: number, newSize: number): LossClass {
  if (rawSize === newSize) return "passthrough"
  if (name.includes("compression") || name.includes("compress")) {
    if (newSize < rawSize * 0.3) return "heuristic-truncate"
    return "structural-summary"
  }
  if (name.includes("re-read") || name.includes("cache")) return "lossless"
  if (name.includes("dedup") || name.includes("delta")) return "structural-summary"
  return "passthrough"
}

export async function runToolResultPipeline(
  raw: ToolResult,
  transformers: ToolResultTransformer[],
): Promise<ToolResultContext> {
  const sorted = [...transformers].sort((a, b) => a.priority - b.priority)
  let ctx: ToolResultContext = {
    raw: { ...raw },
    current: { ...raw },
    annotations: [],
    provenance: [],
  }

  for (const t of sorted) {
    const shouldApply = t.applies ? t.applies(ctx) : true
    if (!shouldApply) {
      ctx.provenance.push({
        name: t.name,
        priority: t.priority,
        applied: false,
        durationMs: 0,
        rawSize: (ctx.current.output ?? "").length,
        newSize: (ctx.current.output ?? "").length,
        tokensSaved: 0,
        lossClass: "passthrough",
      })
      continue
    }
    const beforeSize = (ctx.current.output ?? "").length
    const start = Date.now()
    try {
      ctx = await t.transform(ctx)
      const afterSize = (ctx.current.output ?? "").length
      const durationMs = Date.now() - start
      const tokensSaved = Math.max(0, Math.round((beforeSize - afterSize) / 4))
      const lossClass = inferLossClass(t.name, beforeSize, afterSize)
      const rec: TransformationRecord = {
        name: t.name,
        priority: t.priority,
        applied: true,
        durationMs,
        rawSize: beforeSize,
        newSize: afterSize,
        tokensSaved,
        lossClass,
      }
      ctx.provenance.push(rec)
      memLog("info", "pipeline", `transform ${t.name}`, {
        priority: t.priority,
        rawSize: beforeSize,
        newSize: afterSize,
        tokensSaved,
        lossClass,
        durationMs,
      })
    } catch (e) {
      const durationMs = Date.now() - start
      const rec: TransformationRecord = {
        name: t.name,
        priority: t.priority,
        applied: false,
        durationMs,
        rawSize: beforeSize,
        newSize: beforeSize,
        tokensSaved: 0,
        lossClass: "passthrough",
        error: e instanceof Error ? e.message : String(e),
      }
      ctx.provenance.push(rec)
      memLog("error", "pipeline", `transform ${t.name} failed`, { error: rec.error, durationMs })
    }
  }

  if (ctx.provenance.length > 0) {
    const totalSaved = ctx.provenance.reduce((s, r) => s + r.tokensSaved, 0)
    memLog("info", "pipeline", "pipeline complete", {
      tool: raw.tool,
      transforms: ctx.provenance.map((r) => `${r.name}:${r.applied ? "applied" : "skipped"}`).join(","),
      totalSaved,
      finalSize: (ctx.current.output ?? "").length,
    })
  }

  return ctx
}

export function wrapHookHandlerAsTransformer(
  name: string,
  priority: number,
  handler: { "tool.after"?: (input: unknown, output: unknown) => Promise<void> },
  applies?: (ctx: ToolResultContext) => boolean,
): ToolResultTransformer {
  return {
    name,
    priority,
    applies,
    transform: async (ctx) => {
      const input: Record<string, unknown> = {
        tool: ctx.current.tool,
        sessionID: ctx.current.sessionID,
        args: ctx.current.args,
      }
      const output: Record<string, unknown> = {
        output: ctx.current.output,
        title: ctx.current.title,
        metadata: ctx.current.metadata ? { ...ctx.current.metadata } : {},
      }
      const h = handler["tool.after"]
      if (h) await h(input, output)
      return {
        ...ctx,
        current: {
          ...ctx.current,
          output: output["output"] as string | undefined,
          title: output["title"] as string | undefined,
          metadata: output["metadata"] as Record<string, unknown> | undefined,
        },
      }
    },
  }
}

import type { Config } from "@opencode-ai/plugin";
import { memLog } from "../../logging";

interface AgentDef {
  description?: string;
  prompt?: string;
  mode?: string;
  permission?: Record<string, string>;
  model?: string;
}

const MEMORY_AGENT: AgentDef = {
  description: "Search and query the fractal memory system. Delegate memory lookups here to keep the main context focused.",
  mode: "subagent",
  permission: {
    read: "deny",
    edit: "deny",
    write: "deny",
    grep: "deny",
    glob: "deny",
    bash: "deny",
    websearch: "deny",
    webfetch: "deny",
    task: "deny",
    external_directory: "deny",
  },
};

const GRAPH_AGENT: AgentDef = {
  description: "Navigate the code dependency graph (callers, callees, imports, dependents). Delegate graph queries here to avoid polluting the main context.",
  mode: "subagent",
  permission: {
    read: "deny",
    edit: "deny",
    write: "deny",
    grep: "deny",
    glob: "deny",
    bash: "deny",
    websearch: "deny",
    webfetch: "deny",
    task: "deny",
    external_directory: "deny",
  },
};

export function createRegisterAgentsHandler() {
  return async (input: Config): Promise<void> => {
    try {
      const agents = (input as Record<string, unknown>).agent as Record<string, unknown> | undefined;
      if (!agents) {
        (input as Record<string, unknown>).agent = {};
      } else {
        if (!agents.memory) {
          agents.memory = MEMORY_AGENT;
          memLog("info", "register-agents", "Registered @memory subagent");
        }
        if (!agents.graph) {
          agents.graph = GRAPH_AGENT;
          memLog("info", "register-agents", "Registered @graph subagent");
        }
      }
    } catch (err) {
      memLog("error", "register-agents", "Failed to register agents", { error: String(err) });
    }
  };
}

// Re-export domain types for backward compat during migration.
// New code should import from "domain/ports/IMemoryStore".
export type {
  MemoryScope,
  MemoryNodeLevel,
  MemoryNode,
  MemoryNodeType,
  MemoryCategory,
  CreateNodeInput,
  FractalStats,
  FractalRetrievalResult,
  DrilldownResult,
  MemoryChunk,
  TemporalEdge,
  IMemoryStore as MemoryStore,
} from "../domain/ports/IMemoryStore";



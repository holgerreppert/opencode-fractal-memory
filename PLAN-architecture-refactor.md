# Architecture Refactor Plan

## Overview
Restructure the fractal-memory plugin from flat/module-soup to layered hexagonal architecture. 10 concerns, 4 phases, ~20 tasks. Each task leaves the system working.

## Architecture Decisions
1. **Hexagonal (Ports & Adapters)** — domain owns interfaces, infra implements them, application orchestrates
2. **Manual DI with composition root** — one file wires everything. No DI framework.
3. **Conservative approach** — file moves + re-exports first, behavior changes last
4. **Backward compat at every step** — old import paths re-export until all consumers migrate

## Dependency Graph
```
Phase 0: Renames (independent, any order)
  ├── hooks/ → application/
  ├── storage/compression/ → storage/memory-summarization/
  ├── hooks/compress-output/ → application/command-compression/

Phase 1: Domain Layer (foundation)
  ├── Create domain/ports/ with IMemoryStore interface
  └── Split into focused interfaces (INodeRepository, ISessionTracker, etc.)

Phase 2: Infrastructure (depends on Phase 1)
  ├── Move root modules into infrastructure/
  └── Split SqliteMemoryStore

Phase 3: Wiring (depends on Phase 1 + 2)
  ├── Composition root
  └── Handler DI + registry

Phase 4: Management (depends on Phase 1)
  └── Route through domain, not raw SQLite
```

## Task List

### Phase 0: Safe Renames (no behavior change)
- [ ] Task 0.1: Rename `src/hooks/` → `src/application/` + update imports
- [ ] Task 0.2: Rename `src/storage/compression/` → `src/storage/memory-summarization/` + update imports
- [ ] Task 0.3: Rename `src/hooks/compress-output/` → `src/application/command-compression/` + update imports
- [ ] Task 0.4: Extract `src/seed-nodes.ts` data to `data/seed-nodes.json`
- Checkpoint: build passes, tests pass

### Phase 1: Domain Layer
- [ ] Task 1.1: Create `src/domain/ports/` — extract IMemoryStore interface from storage/types.ts (convert type→interface)
- [ ] Task 1.2: Split into focused interfaces: INodeRepository, ISessionTracker, IInjectionStore, ICompressionStore, IMaintenanceStore
- [ ] Task 1.3: Migrate all ~100 consumers one-by-one to import from domain (re-export from old location)
- Checkpoint: build passes, tests pass

### Phase 2: Infrastructure Organization
- [ ] Task 2.1: Move root infrastructure modules into `infrastructure/llm/`, `infrastructure/vector/`, `infrastructure/config/`
- [ ] Task 2.2: Extract SqliteNodeRepository class implementing INodeRepository
- [ ] Task 2.3: Extract SqliteSessionTracker class implementing ISessionTracker
- [ ] Task 2.4: Extract SqliteInjectionStore class implementing IInjectionStore
- Checkpoint: build passes, tests pass

### Phase 3: Wiring
- [ ] Task 3.1: Create `composition-root.ts` — single file wiring all dependencies
- [ ] Task 3.2: Refactor handler pipeline — pluggable IHookHandler registry, constructor injection
- [ ] Task 3.3: Update plugin/init.ts, mcp/server.ts, management-server.ts to use composition root
- Checkpoint: build passes, tests pass, plugin loads

### Phase 4: Management Layer
- [ ] Task 4.1: Replace raw SQLite calls in management/ with IMemoryStore calls
- Checkpoint: management app works end-to-end

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Import path changes break plugin loading | High | Keep re-exports until fully migrated |
| Circular imports from interface extraction | Medium | Type-only imports, separate files |
| Dead THREE.js import in seed-nodes | Low | Remove it |
| Management app stops working | High | Test manually after Phase 4 |

## Open Questions
- Should management/helpers.ts be split into management/config.ts, management/backup.ts, management/formatting.ts?
- Should the composition root be in `src/` or `src/plugin/`?

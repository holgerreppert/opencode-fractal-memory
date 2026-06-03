export interface SeedNode {
  label: string;
  tag: string | null;
  content: string;
  summary?: string;
  type?: string;
  metadata?: Record<string, unknown>;
}

export const SEED_NODES: SeedNode[] = [
  // Rule nodes (auto-injected)
  {
    label: "rule:mandatory:memory",
    tag: "rule:mandatory",
    content: `## Memory Tool Mandatory Rules
tag: rule:mandatory

### Rules
- search before get | get only verified labels
- replace needs re-read first (content can change)
- edit: read file first | write for new files
- error → error node | solved → mark + add to rules

### Auto-Learned
- Review tool arguments and ensure correct format
- Avoid memory_drilldown with vague queries - use memory_search first
- Re-read file before replace to ensure content is current
- Verify node exists before memory_delete
- Use ripgrep (rg) for direct code search instead of slow tools with timeouts`,
  },
  {
    label: "rule:standard",
    tag: "rule:standard",
    content: `## Memory Tool Standard Rules
tag: rule:standard

### Workflow
- search → get → set chain
- verify after confirming something works`,
  },
  {
    label: "rule:suggestion",
    tag: "rule:suggestion",
    content: `## Memory Tool Suggestions
tag: rule:suggestion

### Optimization
- llm_compress before compressing
- extract_patterns quarterly
- higher bm25 (0.6-0.8) for exact | lower (0.2-0.4) for semantic`,
  },
  {
    label: "rule:mandatory:core",
    tag: "rule:mandatory",
    content: `## Behavioral Rules Injection System
tag: rule:mandatory

### How to Use This System
When you discover an error or better approach:
1. Distill the correct usage pattern
2. Add it to the appropriate rules node
3. The rule gets injected next cycle

### 3 Tag Levels
- rule:mandatory - Always injected, always enforced
- rule:standard - Injected, suggested
- rule:suggestion - Injected, optional`,
  },
  {
    label: "rule:mandatory:agent-pull",
    tag: "rule:mandatory",
    content: `## Agent-Pull Memory Rule
tag: rule:mandatory

### When to Search Memory
- Before starting a complex task (3+ steps)
- When user asks about past decisions
- When working on a file/module you've worked on before
- When user says "remember", "previously", "before"
- When you're unsure about a convention
- When you see errors you've seen before
- When choosing between approaches

### How to Search
1. Call memory_search with keywords from your reasoning
2. Check results - if >50% match, use memory_drilldown for details
3. Reference memory in your response with file:line format

### Decision Flow
User request → Check memory → Verify codebase → Act
Only skip memory search for trivial tasks (<2 steps)`,
  },
  {
    label: "rule:mandatory:tools",
    tag: "rule:mandatory",
    content: `## Tool-Specific Behavioral Rules
tag: rule:mandatory

### edit tool
- ALWAYS read file first with read tool
- NEVER edit non-existent files - use write for new files
- Provide exact oldString (copy from read output)

### write tool
- ALWAYS verify file doesn't exist first
- NEVER write to existing files without reading them

### bash tool
- ALWAYS quote paths with spaces
- NEVER use destructive commands without explicit user request
- NEVER skip hooks (--no-verify, --no-gpg-sign)

### memory_drilldown
- ALWAYS use memory_search first to find relevant nodes
- NEVER drilldown with vague queries
- Use memory_drilldown(id) with specific node IDs from search results

### memory_replace
- ALWAYS re-read node with memory_get immediately before replacing
- NEVER use cached content - content may change between operations`,
  },
  // Seed nodes (on-demand, not injected)
  {
    label: "memory-quick-start",
    tag: null,
    content: `## Memory Quick Start Guide

### First: Search Before Coding
Before starting any task, check memory:
- memory_search('relevant topic')
- memory_drilldown_query('what do I know about X?')

### Store These
- Architecture decisions (why we chose X)
- Bug workarounds
- User preferences
- Project conventions

### Don't Store
- Verbose logs
- Code snippets (already in codebase)
- Tool output dumps

### Memory-First Workflow
BEFORE: Search memory for context
DURING: Store decisions/patterns as you discover
AFTER: Summarize key decisions

### Token Budget
Keep memory lean. Use memory_check_context if approaching limits.`,
  },
  {
    label: "memory-philosophy",
    tag: null,
    content: `## Memory Philosophy

Memory isn't about having information. It's about becoming better.

### What to Store
- Decisions: "We chose X because Y"
- Lessons: "Package Y needs --legacy-peer-deps"
- Preferences: "User prefers concise responses"
- Failures: "Compressed too aggressively"

### The Core Insight
Every node should make future-you smarter, not just more knowledgeable.

### Anti-Patterns
- memory_list dumps everything (expensive)
- Storing everything (token debt)
- Never compressing (node bloat)`,
  },
  {
    label: "persona",
    tag: null,
    content: `## Persona

You are a helpful, concise AI coding assistant.

### Communication Style
- Be brief and to the point
- Answer directly without preamble
- Use short sentences
- Avoid unnecessary elaboration

### When to Elaborate
- Only when asked for detail
- When user seems stuck
- When explaining complex concepts`,
  },
  {
    label: "human",
    tag: null,
    content: `## Human

The user is a developer working on their local machine.

### Preferences
- Prefers concise responses
- Direct communication style
- Wants working code, not lengthy explanations
- May ask clarifying questions

### Working Context
- Uses Bun as runtime and package manager
- OpenCode as AI coding assistant
- Plugin development experience`,
  },
  // Skill nodes (activated when relevant)
  {
    label: "skill:debug-workflow",
    tag: null,
    type: "skill",
    summary: "Systematic debugging workflow: reproduce, isolate, fix, verify. Use when debugging errors, fixing bugs, or investigating unexpected behavior.",
    metadata: { triggers: ["debug", "bug", "error", "fix", "crash", "broken", "not working", "investigate"] },
    content: `## Debug Workflow Skill

### When to Use
- User reports an error or bug
- Something is not working as expected
- Need to investigate unexpected behavior

### Procedure
1. **Reproduce**: Run the failing command or operation to see the exact error
2. **Isolate**: Identify the smallest reproducible case
3. **Read context**: Check relevant source files, logs, and recent changes
4. **Hypothesize**: Form a theory about the root cause
5. **Fix**: Make the minimal change to address the root cause
6. **Verify**: Run tests or the original operation to confirm the fix works
7. **Explain**: Tell the user what was wrong and how it was fixed

### Rules
- Never guess — always verify with actual output
- Check logs before changing code
- Make minimal diffs — don't refactor while debugging
- If stuck after 3 attempts, ask the user for more context`,
  },
  {
    label: "skill:write-tests",
    tag: null,
    type: "skill",
    summary: "Write comprehensive tests: unit, integration, edge cases. Use when asked to add tests, improve test coverage, or write test suites.",
    metadata: { triggers: ["test", "tests", "coverage", "spec", "assert", "unit test", "integration test"] },
    content: `## Write Tests Skill

### When to Use
- User asks to write tests for code
- Need to improve test coverage
- Adding tests for a new feature

### Procedure
1. **Find existing tests**: Look at the test directory structure and patterns
2. **Identify framework**: Check package.json for test runner (vitest, jest, etc.)
3. **Study patterns**: Read existing test files for conventions
4. **Write tests**: Cover happy path, edge cases, and error cases
5. **Run tests**: Verify all tests pass
6. **Check coverage**: Ensure meaningful coverage of the target code

### Rules
- Match existing test style and conventions exactly
- Test behavior, not implementation details
- Include at least one edge case per test file
- Never skip tests without a clear reason
- Run the test suite before declaring done`,
  },
  {
    label: "skill:refactor-component",
    tag: null,
    type: "skill",
    summary: "Safe refactoring: preserve behavior, improve structure, verify with tests. Use when restructuring code, renaming, extracting functions, or modernizing patterns.",
    metadata: { triggers: ["refactor", "restructure", "rename", "extract", "modernize", "clean up", "improve structure"] },
    content: `## Refactor Component Skill

### When to Use
- User asks to refactor or restructure code
- Need to rename, extract, or reorganize
- Modernizing outdated patterns

### Procedure
1. **Understand current behavior**: Read the code and any tests
2. **Define the goal**: What should the refactored code look like?
3. **Check for tests**: If none exist, write characterization tests first
4. **Refactor in small steps**: One change at a time, verify after each
5. **Run tests**: After each step, confirm behavior is preserved
6. **Review the diff**: Ensure the change is clean and focused

### Rules
- Never change behavior during a refactor
- Small, incremental changes only
- Tests must pass after every step
- If tests don't exist, write them first
- Keep the diff focused — don't mix refactoring with feature work`,
  },
  {
    label: "skill:refactoring-expert",
    tag: null,
    type: "skill",
    summary: "Systematic code refactoring following Martin Fowler's catalog: characterization tests, Red-Green-Refactor, incremental transformation. Covers SOLID compliance, DRY cleanup, code smell detection, complexity reduction, design patterns, functional programming.",
    metadata: { triggers: ["refactor", "SOLID", "DRY", "code smell", "technical debt", "legacy code", "extract method", "design pattern", "characterization test", "clean code", "functional programming"] },
    content: `## Refactoring Expert

## Purpose
Improve code quality and reduce technical debt through systematic refactoring following Martin Fowler's catalog, functional programming best practices, and industry standards.

## Triggers
Activate when working on:
- Code complexity reduction and technical debt elimination
- SOLID principles implementation and design pattern application
- Code quality improvement and maintainability enhancement
- Legacy code modernization and anti-pattern removal
- Test-driven refactoring and behavior preservation
- Characterization testing and safety nets
- Functional programming transformations (imperative to functional)
- Higher-order functions, composition, currying, and immutability
- Side effect elimination and pure function extraction

## Behavioral Mindset
Simplify relentlessly. Preserve behavior religiously. Measure everything.
Every refactoring must be: small and safe, tested immediately, measurably better.

## Focus Areas
- **Code Simplification**: Cyclomatic complexity reduction, readability improvement, function size optimization
- **Technical Debt Reduction**: Intentional and unintentional debt, DRY violations, code smells, anti-pattern elimination
- **Pattern Application**: SOLID principles, Gang of Four patterns, Fowler's refactorings, functional transformations
- **Safe Transformation**: Behavior preservation, automated tests, characterization tests, incremental changes

## Refactoring Protocol

### Phase 1: Assessment
- Measure baseline metrics (complexity, duplication, coupling)
- Identify code smells using 5-category taxonomy
- Detect SOLID violations and anti-patterns
- Prioritize high-impact, low-risk refactorings (80/20 rule)

### Phase 2: Safety Net Establishment
- Verify existing tests cover target code
- Add characterization tests if coverage insufficient
- Establish behavior baseline before changes

### Phase 3: Red-Green-Refactor Cycle
- **Red**: Write failing test defining desired behavior
- **Green**: Write minimal code to pass test
- **Refactor**: Improve design without changing behavior
- Run full test suite after each micro-step

### Phase 4: Pattern Application
- Apply SOLID principles systematically
- Choose appropriate paradigm (OOP / Functional)
- Introduce design patterns where appropriate

### Phase 5: Validation
- Measure post-refactoring metrics (compare to baseline)
- Verify behavior preservation through full test suite
- Review readability and maintainability gains

## Code Smells: 5 Categories
1. **Bloaters**: Long Method, Large Class, Long Parameter List, Primitive Obsession, Data Clumps
2. **Object-Orientation Abusers**: Switch Statements, Temporary Field, Refused Bequest
3. **Change Preventers**: Divergent Change, Shotgun Surgery, Parallel Inheritance
4. **Dispensables**: Comments (excessive), Duplicate Code, Dead Code, Lazy Class, Speculative Generality
5. **Couplers**: Feature Envy, Inappropriate Intimacy, Message Chains, Middle Man`,
  },
  {
    label: "skill:threejs-skills",
    tag: null,
    type: "skill",
    summary: "Create 3D scenes, interactive experiences, and visual effects using Three.js. Use when user requests 3D graphics, WebGL experiences, 3D visualizations, animations, or interactive 3D elements.",
    metadata: { triggers: ["3d", "three.js", "webgl", "rendering", "animation", "visualization", "scene", "mesh", "camera", "3d visualization"] },
    content: `## Three.js Skills
Systematically create high-quality 3D scenes and interactive experiences using Three.js best practices.

## When to Use
- Requests 3D visualizations or graphics
- Wants interactive 3D experiences
- Needs WebGL or canvas-based rendering
- Asks for animations, particles, or visual effects
- Wants to visualize data in 3D space

## Core Setup Pattern
### 1. Essential Three.js Imports
Always use the correct CDN version (r128):
\`\`\`javascript
import * as THREE from "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
\`\`\`

### 2. Scene Initialization
\`\`\`javascript
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);
\`\`\`

### 3. Animation Loop
\`\`\`javascript
function animate() {
  requestAnimationFrame(animate);
  mesh.rotation.x += 0.01;
  mesh.rotation.y += 0.01;
  renderer.render(scene, camera);
}
animate();
\`\`\`

## Common Patterns
- Scene -> Camera -> Renderer initialization
- Geometry + Material = Mesh pattern
- requestAnimationFrame for continuous rendering
- Ambient + Directional lights for lit materials
- Window resize handler for responsiveness
- Raycaster for mouse interaction

## Best Practices
- Reuse geometries/materials for performance
- Set antialias: true on renderer
- Dispose resources on removal
- Use fog for atmospheric depth (FogExp2)
- Enable shadows for realism
- Prefer InstancedMesh for many identical objects
- Use GSAP for timeline-based animations`,
  },
  {
    label: "skill:customize-opencode",
    tag: null,
    type: "skill",
    summary: "Use ONLY when the user is editing or creating opencode's own configuration: opencode.json, opencode.jsonc, files under .opencode/, or files under ~/.config/opencode/. Also use when creating or fixing opencode agents, subagents, skills, plugins, MCP servers, or permission rules. Do not use for the user's own application code, or for any project that is not configuring opencode itself.",
    metadata: { triggers: ["opencode config", "agent", "skill", "plugin", "MCP", "permission", ".opencode"] },
    content: `## customize-opencode

You are able to use the Svelte MCP server, where you have access to comprehensive Svelte 5 and SvelteKit documentation.

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a structured list with titles, use_cases, and paths.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or multiple sections.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions.

### 4. playground-link

Generates a Svelte Playground link with the provided code.`,
  },
  {
    label: "skill:svelte-code-writer",
    tag: null,
    type: "skill",
    summary: "CLI tools for Svelte 5 documentation lookup and code analysis. MUST be used whenever creating, editing or analyzing any Svelte component (.svelte) or Svelte module (.svelte.ts/.svelte.js). If possible, this skill should be executed within the svelte-file-editor agent for optimal results.",
    metadata: { triggers: ["svelte", "component", "svelte 5", "runes", "sveltekit"] },
    content: `## Svelte 5 Code Writer

## CLI Tools

You have access to @sveltejs/mcp CLI for Svelte-specific assistance. Use these commands via npx:

### List Documentation Sections

npx @sveltejs/mcp list-sections

Lists all available Svelte 5 and SvelteKit documentation sections with titles and paths.

### Get Documentation

npx @sveltejs/mcp get-documentation "<section1>,<section2>,..."

Retrieves full documentation for specified sections.

### Svelte Autofixer

npx @sveltejs/mcp svelte-autofixer "<code_or_path>" [options]

Analyzes Svelte code and suggests fixes for common issues.

Options: --async, --svelte-version (4 or 5)

## Workflow

1. Uncertain about syntax? Run list-sections then get-documentation for relevant topics
2. Reviewing/debugging? Run svelte-autofixer on the code to detect issues
3. Always validate - Run svelte-autofixer before finalizing any Svelte component`,
  },
  {
    label: "skill:svelte-core-bestpractices",
    tag: null,
    type: "skill",
    summary: "Guidance on writing fast, robust, modern Svelte code. Load this skill whenever in a Svelte project and asked to write/edit or analyze a Svelte component or module. Covers reactivity, event handling, styling, integration with libraries and more.",
    metadata: { triggers: ["svelte", "reactivity", "$state", "$derived", "$effect", "$props", "svelte best practices", "runes", "snippet", "event handler"] },
    content: `## svelte-core-bestpractices

## $state

Only use the $state rune for variables that should be reactive. Objects and arrays are made deeply reactive. Use $state.raw for large objects that are only ever reassigned.

## $derived

To compute something from state, use $derived rather than $effect. Deriveds are writable.

## $effect

Effects are an escape hatch and should mostly be avoided. Do not update state inside effects.

## $props

Treat props as though they will change. Values that depend on props should use $derived.

## Events

Any element attribute starting with on is treated as an event listener.

## Snippets

Use {#snippet ...} and {@render ...} for reusable markup instead of <slot>.

## Each blocks

Prefer keyed each blocks for better performance.

## Styling

Use CSS custom properties for parent-to-child styling. Use :global for library overrides.

## Context

Use createContext rather than setContext and getContext for type safety.

## Avoid legacy features

Always use runes mode for new code:
- $state instead of implicit reactivity
- $derived and $effect instead of $:
- $props instead of export let
- onclick={...} instead of on:click={...}
- {#snippet ...} and {@render ...} instead of <slot>
- classes with $state fields instead of stores`,
  },
  // Playbook nodes (sticky, type: "playbook", steps in metadata)
  {
    label: "playbook:debug-workflow",
    tag: null,
    type: "playbook",
    summary: "Systematic debugging: reproduce, isolate, fix, verify. Use when debugging errors or investigating unexpected behavior.",
    metadata: {
      steps: [
        { toolName: "bash", description: "Reproduce the error — run the failing command", params: {}, critical: true },
        { toolName: "read", description: "Read relevant source files and logs", params: {}, critical: false },
        { toolName: "bash", description: "Run any diagnostic commands to gather context", params: {}, critical: false },
        { toolName: "edit", description: "Apply the minimal fix", params: {}, critical: true },
        { toolName: "bash", description: "Verify the fix works", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["debug", "bug", "error", "fix", "crash", "broken"] }],
      tags: ["debugging", "workflow"],
      executionCount: 0,
    },
    content: `## Debug Workflow Playbook

Systematic debugging workflow for resolving errors and unexpected behavior.

### Steps
1. Reproduce the error by running the failing command
2. Read relevant source files, logs, and recent changes
3. Run diagnostics to gather context about the failure
4. Apply the minimal fix to address the root cause
5. Verify the fix by re-running the original operation

### Rules
- Never guess — always verify with actual output
- Make minimal diffs — don't refactor while debugging
- If stuck after 3 attempts, ask the user for more context`,
  },
  {
    label: "playbook:write-tests",
    tag: null,
    type: "playbook",
    summary: "Write comprehensive tests: unit, integration, edge cases. Use when asked to add tests or improve coverage.",
    metadata: {
      steps: [
        { toolName: "read", description: "Find existing tests and study patterns", params: {}, critical: false },
        { toolName: "read", description: "Read the source code being tested", params: {}, critical: true },
        { toolName: "edit", description: "Write tests covering happy path + edge cases", params: {}, critical: true },
        { toolName: "bash", description: "Run the test suite to verify", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["test", "tests", "coverage", "spec"] }],
      tags: ["testing", "workflow"],
      executionCount: 0,
    },
    content: `## Write Tests Playbook

Write comprehensive tests matching existing project conventions.

### Steps
1. Find existing tests and study naming/structure patterns
2. Read the source code to understand behavior
3. Write tests covering happy path, edge cases, and error cases
4. Run the test suite and verify all tests pass

### Rules
- Match existing test style exactly
- Test behavior, not implementation`,
  },
  {
    label: "playbook:refactor-component",
    tag: null,
    type: "playbook",
    summary: "Safe refactoring: preserve behavior, improve structure, verify. Use when restructuring code or modernizing patterns.",
    metadata: {
      steps: [
        { toolName: "read", description: "Understand current code and tests", params: {}, critical: true },
        { toolName: "bash", description: "Run existing tests to establish baseline", params: {}, critical: false },
        { toolName: "edit", description: "Refactor in small incremental steps", params: {}, critical: true },
        { toolName: "bash", description: "Run tests after each step to verify", params: {}, critical: true },
        { toolName: "bash", description: "Review the final diff for cleanliness", params: {}, critical: false },
      ],
      triggers: [{ type: "task_keyword", keywords: ["refactor", "restructure", "extract", "clean up"] }],
      tags: ["refactoring", "workflow"],
      executionCount: 0,
    },
    content: `## Refactor Component Playbook

Safe behavior-preserving refactoring.

### Steps
1. Read the code and any tests thoroughly
2. Run tests to establish a passing baseline
3. Refactor one small change at a time
4. Run tests after each step (behavior preserved?)
5. Review the final diff — clean and focused?

### Rules
- Never change behavior during a refactor
- Small, incremental changes only
- Write characterization tests first if none exist`,
  },
  {
    label: "playbook:code-review",
    tag: null,
    type: "playbook",
    summary: "Systematic code review: correctness, structure, security, style. Use when reviewing PRs or code changes.",
    metadata: {
      steps: [
        { toolName: "read", description: "Read the entire diff — understand what changed", params: {}, critical: true },
        { toolName: "bash", description: "Check that tests exist and pass for the changed code", params: {}, critical: false },
        { toolName: "read", description: "Review for error handling, edge cases, and security", params: {}, critical: true },
        { toolName: "edit", description: "Suggest improvements — never rewrite without discussion", params: {}, critical: false },
      ],
      triggers: [{ type: "task_keyword", keywords: ["review", "PR", "pull request", "code review"] }],
      tags: ["review", "workflow"],
      executionCount: 0,
    },
    content: `## Code Review Playbook

Systematic code review checklist.

### Steps
1. Read the full diff to understand what changed and why
2. Verify tests cover the changes and pass
3. Check for error handling, edge cases, and security issues
4. Suggest focused improvements

### Key Checks
- Correctness: Does the code do what it intends?
- Structure: Is it well-organized and maintainable?
- Security: Any injection vectors or exposed secrets?
- Style: Follows project conventions?`,
  },
  {
    label: "playbook:security-audit",
    tag: null,
    type: "playbook",
    summary: "Security audit checklist: input validation, auth, secrets, deps. Use when deploying to production or reviewing security.",
    metadata: {
      steps: [
        { toolName: "read", description: "Check for hardcoded secrets and credentials", params: {}, critical: true },
        { toolName: "read", description: "Review input validation on all user-facing endpoints", params: {}, critical: true },
        { toolName: "read", description: "Review authentication and authorization logic", params: {}, critical: true },
        { toolName: "bash", description: "Check for known vulnerable dependencies", params: {}, critical: false },
        { toolName: "bash", description: "Verify env/config files are not committed", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["security", "audit", "deploy", "production"] }],
      tags: ["security", "workflow"],
      executionCount: 0,
    },
    content: `## Security Audit Playbook

Pre-deployment security checklist.

### Steps
1. Scan for hardcoded secrets, tokens, passwords
2. Verify input validation on all user-facing paths
3. Review authentication and authorization logic
4. Check dependencies for known vulnerabilities
5. Ensure .env and config files aren't committed

### Critical Rule
- Flag any hardcoded credential immediately — never commit`,
  },
  {
    label: "playbook:plan-feature",
    tag: null,
    type: "playbook",
    summary: "Structure new feature development: spec, breakdown, implement, verify. Use when starting a new feature or significant change.",
    metadata: {
      steps: [
        { toolName: "task", description: "Clarify requirements — ask questions about scope and constraints", params: {}, critical: true },
        { toolName: "read", description: "Explore the existing codebase for patterns and integration points", params: {}, critical: false },
        { toolName: "edit", description: "Write a spec or plan before coding", params: {}, critical: false },
        { toolName: "edit", description: "Implement in thin vertical slices", params: {}, critical: true },
        { toolName: "bash", description: "Test each slice before moving to the next", params: {}, critical: true },
      ],
      triggers: [{ type: "task_keyword", keywords: ["feature", "implement", "plan", "new", "design"] }],
      tags: ["planning", "workflow"],
      executionCount: 0,
    },
    content: `## Plan Feature Playbook

Structured feature development from spec to implementation.

### Steps
1. Clarify requirements with the user (scope, constraints, acceptance criteria)
2. Explore relevant parts of the existing codebase
3. Write a structured plan or specification
4. Implement in thin vertical slices
5. Test each slice before moving on

### Rules
- Understand the problem before proposing solutions
- Small, verifiable increments
- Test early, test often`,
  },
  {
    label: "rule:standard:playbook-creation",
    tag: "rule:standard",
    content: `## Playbook Creation Rule
tag: rule:standard

### When to Propose a Playbook
- You notice the user performing the same multi-step workflow 2+ times
- A task involves 4+ steps that could be standardized
- You find yourself repeating a sequence of tools

### How to Propose
Use memory_set to create the playbook:
\`memory_set(label="playbook:<short-name>", content="<description>", type="playbook", sticky=true, metadata={ steps: [{ toolName, description, params: {}, critical: true/false }], triggers: [...], tags: [...] })\`

### Format
- Label: \`playbook:<short-hyphenated-name>\`
- Type: \`"playbook"\`
- Sticky: \`true\`
- Steps in \`metadata.steps\` array
- Triggers in \`metadata.triggers\` (keyword or tool_sequence patterns)
- Content: human-readable description of the workflow`,
  },
  {
    label: "skill:security-review",
    tag: null,
    type: "skill",
    summary: "Security review checklist: input validation, auth, secrets, dependencies. Use when reviewing code for security issues or before deploying.",
    metadata: { triggers: ["security", "vulnerability", "auth", "secret", "token", "password", "review", "deploy"] },
    content: `## Security Review Skill

### When to Use
- Reviewing code for security issues
- Before deploying to production
- User mentions security concerns

### Checklist
1. **Input validation**: All user inputs are validated/sanitized
2. **Authentication**: Protected routes require auth
3. **Authorization**: Users can only access their own data
4. **Secrets**: No hardcoded secrets, tokens, or passwords
5. **Dependencies**: No known vulnerable packages
6. **Error handling**: Errors don't leak sensitive information
7. **Rate limiting**: Public endpoints have rate limiting
8. **CORS**: Proper CORS configuration
9. **SQL injection**: Parameterized queries only
10. **XSS**: Output is properly escaped

### Rules
- Flag any hardcoded credentials immediately
- Never commit .env files
- Use parameterized queries for all database operations
- Validate all user input on the server side`,
  },
];

export async function ensureRuleNodes(store: { getNodeByLabel: (scope: string, label: string) => Promise<any>; createNode: (args: any) => Promise<void> }): Promise<void> {
  for (const seed of SEED_NODES) {
    try {
      await store.getNodeByLabel("global", seed.label);
    } catch {
      await store.createNode({
        scope: "global",
        label: seed.label,
        content: seed.content,
        summary: seed.summary ?? null,
        type: seed.type ?? "note",
        level: 0,
        parentIds: null,
        embedding: null,
        importance: 1,
        metadata: seed.metadata ?? null,
        sticky: seed.type === "playbook" ? true : undefined,
      });
    }
  }
}

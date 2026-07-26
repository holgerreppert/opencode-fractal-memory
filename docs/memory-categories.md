# Top 20 Memory Categories for a Coding Agent

A good “memory categories” design for coding agents is usually a mix of (1) *what kind of information* it is, and (2) *how it should be used* later (retrieve to code, retrieve to debug, retrieve to respect constraints, etc.). Below is a practical set of categories that work well for software engineering tasks.

## Top 20 memory categories for a coding agent

1. **User goals & success criteria**
   - What the user is trying to achieve; what “done” means.

2. **Project overview / product context**
   - Big-picture purpose, scope, stakeholders, user persona, constraints.

3. **System architecture & component map**
   - Services/modules, boundaries, major flows.

4. **Tech stack & version constraints**
   - Languages, frameworks, toolchain versions, platform constraints.

5. **Codebase map (files/modules/assets)**
   - Where things live; how folders relate; entry points.

6. **API surface & contracts**
   - Endpoints, request/response shapes, schemas, auth rules, error codes.

7. **Data model / persistence knowledge**
   - Tables/entities, migrations, indexes, relationships, retention rules.

8. **Business rules**
   - Domain logic invariants, eligibility rules, pricing rules, etc.

9. **AuthN/AuthZ & security rules**
   - Permission model, roles, secrets handling, threat assumptions.

10. **Coding standards & conventions**
   - Formatting, lint rules, naming conventions, architectural style.

11. **Testing strategy & test assets**
   - Unit/integration/e2e expectations; how tests are structured; fixtures.

12. **Build & run instructions**
   - How to compile/run locally and in CI; environment variables.

13. **Debugging history (root causes & fixes)**
   - What broke, why it broke, what fixed it, and what didn’t.

14. **Known limitations / open issues**
   - What is not implemented, known bugs, technical debt.

15. **Performance constraints & hotspots**
   - Latency/throughput targets, caching assumptions, bottleneck notes.

16. **Observability & operational knowledge**
   - Logging conventions, metrics, tracing, dashboards, alert triggers.

17. **Reusable snippets / patterns**
   - Proven code patterns, helper utilities, common implementations.

18. **Dependencies & external integrations**
   - Third-party APIs, SDK quirks, webhooks, rate limits, retry logic.

19. **Migration history & compatibility notes**
   - How behavior changed over time; deprecations; backward compatibility.

20. **User preferences & interaction constraints**
   - Preferred style of explanations, response length, “always ask before…”, etc.

## Optional follow-ups (if you’re designing the memory system)

- Propose a memory *schema* (fields per category, confidence, timestamp, source)
- Decide which categories should be “episodic” vs “persistent”
- Define retrieval strategies (e.g., editing a model → prioritize categories 7/8/9; debugging → prioritize 13/14/16)

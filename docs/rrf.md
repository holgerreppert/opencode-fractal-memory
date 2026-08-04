Anonymisiert von DuckDuckGo. Keine Datenspeicherung für diesen Chat. Kein KI-Training. Mehr erfahren

combining rrf bm25 cosine and so on

A common way is to fuse the rankings, not the raw scores.

    RRF (Reciprocal Rank Fusion): best simple default
    RRF(d)=∑i1k+ri(d)RRF(d)=∑i​k+ri​(d)1​ where ri(d)ri​(d) is the rank of document dd in retriever ii, and kk is usually 60-ish.

    Weighted score fusion: if you want to combine BM25 and cosine directly
    s(d)=w1⋅norm(BM25)+w2⋅norm(cosine)s(d)=w1​⋅norm(BM25)+w2​⋅norm(cosine) Normalize first; BM25 and cosine are on different scales.

    Best practice: use BM25 + dense cosine + RRF as a strong hybrid baseline. If you have more signals, add them the same way.

    If tuning matters:
        BM25 good for exact terms
        cosine good for semantic match
        RRF robust when score scales differ

If you want, I can give you a Python example for hybrid retrieval with BM25 + embeddings + RRF.

what else is worth considering better search results 

A few high-impact additions:

    Query expansion: synonyms, abbreviations, entity aliases
    Phrase boosts: favor exact multi-word matches
    Field weighting: title > headings > body > metadata
    Metadata filters: date, language, author, category
    Re-ranking: use a cross-encoder or LLM reranker on top 20–100 results
    Deduplication: remove near-duplicates and boilerplate pages
    Freshness boost: for time-sensitive queries
    Popularity/authority signals: links, clicks, domain quality
    Personalization: only if appropriate and privacy-safe
    Click feedback loops: learn from successful/failed searches
    Facet-aware retrieval: handle filters like brand, size, location
    Misspelling tolerance: fuzzy matching and typo correction

If you’re building a hybrid system, the usual best stack is: BM25 + dense retrieval + RRF + reranker.

<related_search_terms>
{"suggestions":[{"suggestion":"hybrid search ranking BM25 dense retrieval reranking", "score":0.97},{"suggestion":"reciprocal rank fusion search relevance improvement", "score":0.94},{"suggestion":"search relevance tuning exact match phrase boost field weighting", "score":0.88}]}
</related_search_terms>

it's a memory from a coding agent. 

For a coding agent memory, also consider:

    Recency decay: newer memories matter more
    Task-scoped memory: separate project, repo, branch, and session context
    Code-aware chunking: split by symbol, file, function, class
    Dependency links: connect related files, imports, tests, errors
    Embedding + lexical hybrid: semantic recall plus exact token match
    Failure memory: remember bugs, rejected fixes, and gotchas
    Preference memory: style, framework choices, naming conventions
    Source ranking: prioritize recent user instructions and repo truth over old guesses
    Conflict handling: detect stale or contradictory memories
    Summary layers: short rolling summaries plus detailed raw facts




    User preferences — language, frameworks, style, verbosity, testing habits, refactor tolerance
Project goals — what the system is trying to achieve, priority features, non-goals
Repo facts — structure, entrypoints, modules, build/test commands, deployment flow
Architecture decisions — chosen patterns, boundaries, tradeoffs, why alternatives were rejected
Conventions — naming, folder layout, linting, formatting, code review norms
Constraints — backward-compat rules, version pinning, no-new-deps rules, security/perf limits
Known bugs — root cause, symptoms, affected files, current status
Failed attempts — what was tried and why it failed, so the agent doesn’t repeat it
Fix patterns — recurring solutions that work in this repo
Test knowledge — flaky tests, slow tests, required test commands, coverage gaps
Environment/setup — local setup quirks, CI differences, secrets handling, required services
Tooling behavior — MCP/tool quirks, agent command preferences, IDE/runtime limitations
Task state — current goal, progress, blockers, TODOs, next step
Episodic events — important sessions, decisions made, merges, incidents, rollbacks
Cross-file dependencies — files/classes/functions that tend to change together
Domain knowledge — business rules, entities, terminology, invariants
Ownership/scope — which memory applies to one branch, repo, user, or team
Freshness/versioning — timestamps and superseded memories
# memory_rate

Mark a memory node as helpful (or not) and optionally adjust its usefulness score.

## Usage

```
memory_rate { id?: string, label?: string, scope?: "global" | "project", helpful?: boolean, usefulness_score?: number }
```

## Arguments

| Arg | Type | Required | Description |
|-----|------|-----------|-------------|
| `id` | string | No* | Memory node ID (mutually exclusive with label) |
| `label` | string | No* | Memory node label (mutually exclusive with id) |
| `scope` | "global" \| "project" | No | Scope of the node (default: "project") |
| `helpful` | boolean | No | If true, increments timesHelpful counter |
| `usefulness_score` | number (0-5) | No | Rate how helpful this memory was |

*Must provide either `id` or `label`

## Examples

Rate a memory as helpful with score 4:
```
memory_rate { label: "rule:mandatory:memory", helpful: true, usefulness_score: 4 }
```

Mark a node as not helpful:
```
memory_rate { id: "abc123", helpful: false }
```

Just update the usefulness score without incrementing counter:
```
memory_rate { label: "my-project-config", usefulness_score: 5 }
```

## How it works

The usefulness tracking system measures how valuable each memory node is to the agent:

- **usefulness_score**: Self-reported rating (0-5) of how useful the memory was
- **timesHelpful**: Counter incremented each time the agent marks memory as helpful
- **timesUsed**: Automatically incremented each time memory is returned in search

These scores influence future retrieval rankings - memories rated more useful will be returned higher in search results.

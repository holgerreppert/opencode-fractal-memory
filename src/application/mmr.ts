export interface MMREntry {
  id: string;
  label: string;
  content: string;
  score: number;
  type?: string | null | undefined;
  level?: number | undefined;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < len; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    na += (a[i] ?? 0) * (a[i] ?? 0);
    nb += (b[i] ?? 0) * (b[i] ?? 0);
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function tokenOverlap(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let intersection = 0;
  for (const t of tokensA) if (tokensB.has(t)) intersection++;
  return intersection / Math.min(tokensA.size, tokensB.size);
}

export function selectMMR(
  candidates: MMREntry[],
  embeddings: Map<string, number[]>,
  K: number,
  lambda = 0.5,
): MMREntry[] {
  if (candidates.length <= K) return [...candidates];

  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const selected: MMREntry[] = [];
  const remaining = [...sorted];

  // Pick first by raw score
  const first = remaining.shift();
  if (!first) return selected;
  selected.push(first);

  while (selected.length < K && remaining.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i]!;

      // Redundancy: max similarity to any selected
      let maxSim = 0;
      for (const s of selected) {
        const embC = embeddings.get(c.id);
        const embS = embeddings.get(s.id);
        let sim = 0;
        if (embC && embS) {
          sim = cosineSimilarity(embC, embS);
        } else {
          sim = tokenOverlap(c.content, s.content);
        }
        if (sim > maxSim) maxSim = sim;
      }

      // Type/level penalty: penalize if same type or level already selected
      let typePenalty = 0;
      let levelPenalty = 0;
      for (const s of selected) {
        if (c.type && s.type && c.type === s.type) typePenalty += 0.1;
        if (c.level !== undefined && s.level !== undefined && c.level === s.level) levelPenalty += 0.05;
      }

      const mmrScore = lambda * c.score - (1 - lambda) * maxSim - typePenalty - levelPenalty;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    if (bestIdx >= 0) {
      selected.push(remaining.splice(bestIdx, 1)[0]!);
    } else {
      break;
    }
  }

  return selected;
}

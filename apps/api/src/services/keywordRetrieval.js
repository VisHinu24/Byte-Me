/**
 * Keyword retrieval — BM25-style ranking of candidate items against a query.
 *
 * This is the substrate the Retrieval agent uses to focus the brief on the
 * patient's stated concern. At hackathon scale (≤30 memories + ≤20 conditions
 * per patient), BM25 is faster and equally good as embeddings. The interface
 * here is shaped so production can swap in Voyage AI / Atlas Vector Search
 * behind `rankByQuery({ candidates, query })` without changes to callers.
 *
 * No deps — fully local, deterministic, debuggable.
 */

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','at','by','is','was','are','be','been','being',
  'has','had','have','this','that','these','those','it','its','as','from','into','about','than','then','if',
  'so','but','no','not','do','does','did','can','could','should','would','may','might','will','shall','i',
  'me','my','we','our','us','you','your','they','their','he','she','him','her','his','hers','one','two',
]);

// Tiny clinical synonym table — expands query terms with related concepts.
const SYNONYMS = {
  // Cardiac
  'chest': ['cardiac', 'heart', 'mi', 'angina'],
  'pain': ['ache', 'discomfort', 'sore'],
  'shortness': ['dyspnea', 'breathless', 'sob'],
  'breath': ['breathing', 'dyspnea', 'respir'],
  'heart': ['cardiac', 'mi', 'cardiovascular', 'cv'],
  'palpitation': ['arrhythmia', 'tachycardia', 'cardiac'],
  // Diabetes / endocrine
  'sugar': ['glucose', 'diabetes', 'dm', 'hba1c', 'a1c', 'hyperglycemia'],
  'diabetes': ['dm', 'glucose', 'a1c', 'hba1c', 'metformin', 'insulin'],
  'thirsty': ['polydipsia', 'glucose', 'diabetes'],
  // Renal
  'urine': ['urinary', 'renal', 'kidney', 'creatinine'],
  'kidney': ['renal', 'creatinine', 'gfr'],
  // Pulm / asthma
  'cough': ['respiratory', 'pulm', 'asthma', 'copd'],
  'wheeze': ['asthma', 'bronchospasm', 'pulm'],
  'asthma': ['wheeze', 'bronchodilator', 'inhaler', 'pulm'],
  // Allergy
  'rash': ['allergy', 'hives', 'urticaria', 'dermatitis'],
  'hives': ['urticaria', 'allergy'],
  'allergy': ['allergic', 'reaction', 'intolerance'],
  // Pressure
  'pressure': ['bp', 'hypertension', 'htn'],
  'hypertension': ['bp', 'htn', 'pressure'],
  'fever': ['febrile', 'temperature', 'pyrexia', 'infection'],
  'infection': ['bacterial', 'viral', 'antibiotic', 'fever'],
};

/**
 * Tokenize a string: lowercase, split on non-alpha, drop stopwords + tokens
 * shorter than 3 chars (except a few we whitelist like a1c, bp, mi).
 */
const SHORT_KEEP = new Set(['a1c', 'bp', 'mi', 'cv', 'dm', 'sob', 'er', 'icu']);

export function tokenize(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t) && (t.length >= 3 || SHORT_KEEP.has(t)))
    .map(stem);
}

/** Minimal Porter-lite stemmer — drops common English suffixes. */
function stem(word) {
  return word
    .replace(/(ing|edly|ed|ly|s|es|er|est|tion|sion|ity|ies)$/, '')
    .replace(/(.)(.+?)(\1)$/, (_, a, b, c) => a + b + c); // collapse trailing dups
}

/** Expand a token list with synonyms (single-hop). */
export function expandSynonyms(tokens) {
  const out = new Set(tokens);
  for (const t of tokens) {
    const syns = SYNONYMS[t];
    if (syns) for (const s of syns) out.add(stem(s));
  }
  return [...out];
}

/**
 * BM25 scoring across a corpus.
 *
 * @param {{id:string, text:string}[]} candidates
 * @param {string} query
 * @returns {{id:string, score:number, matches:string[]}[]} sorted desc by score
 */
export function rankByQuery({ candidates, query }) {
  if (!query || !candidates?.length) {
    return (candidates ?? []).map((c) => ({ id: c.id, score: 0, matches: [] }));
  }

  const queryTokens = expandSynonyms(tokenize(query));
  if (!queryTokens.length) return candidates.map((c) => ({ id: c.id, score: 0, matches: [] }));

  // Document tokens
  const docs = candidates.map((c) => ({
    id: c.id,
    raw: c,
    tokens: tokenize(c.text ?? ''),
  }));

  const N = docs.length;
  const avgDl = docs.reduce((a, d) => a + d.tokens.length, 0) / Math.max(N, 1);

  // Document frequency per term
  const df = new Map();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }

  // BM25 params
  const k1 = 1.5;
  const b = 0.75;

  const scored = docs.map((d) => {
    let score = 0;
    const matches = new Set();
    const tf = new Map();
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);

    for (const qt of queryTokens) {
      const f = tf.get(qt) ?? 0;
      if (f === 0) continue;
      matches.add(qt);
      const n = df.get(qt) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      const dl = d.tokens.length;
      const tfNorm = (f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgDl)));
      score += idf * tfNorm;
    }

    return { id: d.id, score, matches: [...matches], raw: d.raw };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Convenience: rank a heterogeneous bundle of clinical items, returning
 * the top-K most relevant overall.
 */
export function rankClinicalContext({ items, query, topK = 8 }) {
  // Build a parallel id -> original-item map so we can attach _relevance
  // back onto the actual clinical item the caller passed in.
  const byId = new Map();
  const candidates = items.map((it, i) => {
    const id = it.cite?.id ?? it.id ?? `idx-${i}`;
    byId.set(id, it);
    return { id, text: clinicalText(it) };
  });
  const ranked = rankByQuery({ candidates, query });
  return ranked
    .filter((r) => r.score > 0)
    .slice(0, topK)
    .map((r) => ({ ...byId.get(r.id), _relevance: { score: Number(r.score.toFixed(3)), matches: r.matches } }));
}

/** Extract searchable text from a clinical item (memory / condition / etc). */
function clinicalText(item) {
  const parts = [];
  if (item.label) parts.push(item.label);
  if (item.title) parts.push(item.title);
  if (item.summary) parts.push(item.summary);
  if (item.tags) parts.push(item.tags.join(' '));
  if (item.severity) parts.push(item.severity);
  if (item.dose) parts.push(item.dose);
  if (item.reason) parts.push(item.reason);
  if (item.type) parts.push(item.type);
  if (item.substance) parts.push(item.substance);
  if (item.manifestation) parts.push(item.manifestation.join(' '));
  return parts.filter(Boolean).join(' ');
}

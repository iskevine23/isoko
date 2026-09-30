import { normalizeText } from "../text";

/**
 * TF-IDF over character n-grams inside word boundaries (scikit-learn's
 * `TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4))`).
 * The vocabulary and IDF weights are fitted on the reference catalog, so
 * n-grams shared by many names (" ib", "ma") count less than distinctive ones.
 */

export type SparseVector = Map<string, number>;

function ngrams(text: string, min = 2, max = 4): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of normalizeText(text).split(" ")) {
    if (!token) continue;
    const padded = ` ${token} `;
    for (let n = min; n <= max; n++) {
      for (let i = 0; i + n <= padded.length; i++) {
        const gram = padded.slice(i, i + n);
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export class CharNgramTfidf {
  private readonly idf = new Map<string, number>();
  private readonly cache = new Map<string, SparseVector>();
  readonly documents: number;

  constructor(corpus: string[]) {
    const df = new Map<string, number>();
    const docs = [...new Set(corpus.map((d) => normalizeText(d)).filter(Boolean))];
    for (const doc of docs) {
      for (const gram of ngrams(doc).keys()) df.set(gram, (df.get(gram) ?? 0) + 1);
    }
    this.documents = docs.length;
    df.forEach((count, gram) => this.idf.set(gram, Math.log((1 + docs.length) / (1 + count)) + 1));
  }

  get vocabularySize(): number {
    return this.idf.size;
  }

  transform(text: string): SparseVector {
    const key = normalizeText(text);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const vec: SparseVector = new Map();
    let norm = 0;
    ngrams(key).forEach((tf, gram) => {
      const idf = this.idf.get(gram);
      if (idf === undefined) return;
      const w = (1 + Math.log(tf)) * idf;
      vec.set(gram, w);
      norm += w * w;
    });
    norm = Math.sqrt(norm) || 1;
    vec.forEach((w, gram) => vec.set(gram, w / norm));
    this.cache.set(key, vec);
    return vec;
  }
}

export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  small.forEach((w, gram) => {
    const other = large.get(gram);
    if (other !== undefined) dot += w * other;
  });
  return dot;
}

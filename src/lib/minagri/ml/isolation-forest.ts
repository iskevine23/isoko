import { mulberry32 } from "../stats";

/**
 * Isolation Forest (Liu, Ting & Zhou, ICDM 2008), equivalent to
 * scikit-learn's IsolationForest(n_estimators, max_samples).fit / score_samples.
 * Anomaly score s(x) = 2^(-E[h(x)] / c(ψ)); values near 1 are easy to isolate.
 *
 * Trees are stored in pre-order as flat number arrays so a fitted model can be
 * saved to JSON and reloaded for scoring:
 *   internal node → [feature, split, indexOfRightChild]  (left child follows)
 *   leaf          → [-(size + 1)]
 */

export interface IsolationForestModel {
  nFeatures: number;
  subsampleSize: number;
  trees: number[][];
}

export interface FitOptions {
  trees?: number;
  subsampleSize?: number;
  seed?: number;
}

/** Average path length of an unsuccessful search in a BST of n points. */
export function cFactor(n: number): number {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - (2 * (n - 1)) / n;
}

function round(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

function grow(out: number[], indices: number[], height: number, maxHeight: number, X: number[][], rng: () => number) {
  const n = indices.length;
  const dims = X[0]?.length ?? 0;
  if (height < maxHeight && n > 1 && dims > 0) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const attr = Math.floor(rng() * dims);
      let min = Infinity;
      let max = -Infinity;
      for (const i of indices) {
        const v = X[i]![attr]!;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!(max > min)) continue;
      const split = round(min + rng() * (max - min));
      const left: number[] = [];
      const right: number[] = [];
      for (const i of indices) (X[i]![attr]! < split ? left : right).push(i);
      if (!left.length || !right.length) continue;
      const at = out.length;
      out.push(attr, split, 0);
      grow(out, left, height + 1, maxHeight, X, rng);
      out[at + 2] = out.length;
      grow(out, right, height + 1, maxHeight, X, rng);
      return;
    }
  }
  out.push(-(n + 1));
}

function sample(n: number, k: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  const m = Math.min(k, n);
  for (let i = 0; i < m; i++) {
    const j = i + Math.floor(rng() * (n - i));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, m);
}

export function fitIsolationForest(X: number[][], options: FitOptions = {}): IsolationForestModel {
  const n = X.length;
  const psi = Math.max(2, Math.min(options.subsampleSize ?? 256, n));
  const maxHeight = Math.ceil(Math.log2(psi));
  const rng = mulberry32(options.seed ?? 42);
  const trees: number[][] = [];
  for (let t = 0; t < (options.trees ?? 100); t++) {
    const out: number[] = [];
    grow(out, sample(n, psi, rng), 0, maxHeight, X, rng);
    trees.push(out);
  }
  return { nFeatures: X[0]?.length ?? 0, subsampleSize: psi, trees };
}

function pathLength(tree: number[], x: number[]): number {
  let p = 0;
  let depth = 0;
  for (;;) {
    const v = tree[p]!;
    if (v < 0) return depth + cFactor(-v - 1);
    p = x[v]! < tree[p + 1]! ? p + 3 : tree[p + 2]!;
    depth += 1;
  }
}

export function scoreIsolationForest(model: IsolationForestModel, X: number[][]): number[] {
  const norm = cFactor(model.subsampleSize) || 1;
  return X.map((x) => {
    let total = 0;
    for (const tree of model.trees) total += pathLength(tree, x);
    return 2 ** (-total / model.trees.length / norm);
  });
}

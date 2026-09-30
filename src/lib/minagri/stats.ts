export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

export function mean(values: number[]): number {
  if (!values.length) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export interface RobustStats {
  n: number;
  median: number;
  mad: number;
  q1: number;
  q3: number;
  iqr: number;
  lowerFence: number;
  upperFence: number;
}

export function robustStats(values: number[]): RobustStats {
  const s = [...values].sort((a, b) => a - b);
  const med = quantile(s, 0.5);
  const mad = quantile(
    s.map((v) => Math.abs(v - med)).sort((a, b) => a - b),
    0.5,
  );
  const q1 = quantile(s, 0.25);
  const q3 = quantile(s, 0.75);
  const iqr = q3 - q1;
  return {
    n: s.length,
    median: med,
    mad,
    q1,
    q3,
    iqr,
    lowerFence: q1 - 1.5 * iqr,
    upperFence: q3 + 1.5 * iqr,
  };
}

/** Modified z-score (Iglewicz & Hoaglin). */
export function robustZ(value: number, stats: RobustStats): number {
  if (!stats.mad) {
    const scale = Math.max(stats.iqr / 1.349, 1e-9);
    return (0.6745 * (value - stats.median)) / scale;
  }
  return (0.6745 * (value - stats.median)) / stats.mad;
}

export function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/** deterministic PRNG so the demo dataset is reproducible */
export function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal, safe RFC4180-ish CSV parser (no dependencies). */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

const DELIMITERS = [",", ";", "\t", "|"] as const;

/** Picks the delimiter that splits the first lines into the most consistent columns. */
export function sniffDelimiter(text: string): string {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n?|\n/)
    .filter((l) => l.trim())
    .slice(0, 10);
  let best: string = ",";
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => l.split(d).length - 1);
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = first * consistent;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

export function matrixToTable(matrix: string[][]): ParsedCsv {
  const errors: string[] = [];
  const nonEmpty = matrix.filter((r) => r.some((c) => String(c ?? "").trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], errors: ["The file is empty."] };
  const headerIndex = nonEmpty.findIndex(
    (r) => r.filter((c) => String(c ?? "").trim() !== "").length >= 2,
  );
  const start = headerIndex < 0 ? 0 : headerIndex;
  const seen = new Map<string, number>();
  const headers = nonEmpty[start].map((h, i) => {
    const base = String(h ?? "").trim() || `Column ${i + 1}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base} (${n + 1})` : base;
  });
  const rows: Record<string, string>[] = [];
  for (let i = start + 1; i < nonEmpty.length; i++) {
    const cells = nonEmpty[i];
    if (cells.length > headers.length) {
      errors.push(
        `Row ${i + 1} has ${cells.length} values but ${headers.length} columns were expected.`,
      );
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = String(cells[idx] ?? "").trim();
    });
    rows.push(obj);
  }
  return { headers, rows, errors };
}

export function parseCsv(text: string, delimiter = sniffDelimiter(text)): ParsedCsv {
  const errors: string[] = [];
  const clean = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const table: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      table.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    table.push(row);
  }

  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [], errors: ["The file is empty."] };

  const headers = nonEmpty[0].map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < nonEmpty.length; i++) {
    const cells = nonEmpty[i];
    if (cells.length !== headers.length) {
      errors.push(
        `Row ${i + 1} has ${cells.length} values but ${headers.length} columns were expected.`,
      );
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (cells[idx] ?? "").trim();
    });
    rows.push(obj);
  }
  return { headers, rows, errors };
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const esc = (v: string | number | null) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(esc).join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
}

export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

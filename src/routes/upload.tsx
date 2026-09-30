import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileSpreadsheet, UploadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { AppShell } from "@/components/AppShell";
import { pageTitle } from "@/lib/brand";
import { DraftBanner } from "@/components/minagri/DraftBanner";
import { Button } from "@/components/ui/button";
import { SearchSelect } from "@/components/ui/search-select";
import { downloadFile } from "@/lib/minagri/csv";
import { startDraft } from "@/lib/minagri/draft";
import {
  ACCEPTED_FILES,
  applyMapping,
  channelFromName,
  FIELDS,
  FORMAT_LABEL,
  mergeTables,
  missingRequired,
  readDataFile,
  suggestMapping,
  type ColumnMapping,
  type DataTable,
} from "@/lib/minagri/ingest";
import { analyzePreferApi } from "@/lib/minagri/ai-api";
import { parseCsv } from "@/lib/minagri/csv";
import { generateTestCsv, type AnalysisProgress } from "@/lib/minagri/pipeline";
import type { AnalysisResult, DatasetSource } from "@/lib/minagri/types";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: pageTitle("Upload") },
      {
        name: "description",
        content:
          "Upload agricultural market prices in any common data format and analyse them automatically.",
      },
      { property: "og:title", content: pageTitle("Upload") },
      {
        property: "og:description",
        content:
          "Upload agricultural market prices in any common data format and analyse them automatically.",
      },
    ],
  }),
  component: UploadPage,
});

interface PendingMapping {
  table: DataTable;
  name: string;
  mapping: ColumnMapping;
  channel: string;
}

const CHANNEL_OPTIONS = [
  { value: "", label: "Not in file" },
  { value: "farmgate", label: "All rows are farm gate" },
  { value: "wholesale", label: "All rows are wholesale" },
  { value: "retail", label: "All rows are retail" },
];

function UploadPage() {
  const nav = useNavigate();
  const [drag, setDrag] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<AnalysisProgress | null>(null);
  const [runName, setRunName] = useState("");
  const [pending, setPending] = useState<PendingMapping | null>(null);
  const [error, setError] = useState("");
  const [technical, setTechnical] = useState("");
  const [showTech, setShowTech] = useState(false);

  function reset() {
    setError("");
    setTechnical("");
    setShowTech(false);
    setPending(null);
  }

  function fail(message: string) {
    setTechnical(message);
    setError("We couldn't process this dataset.");
  }

  async function analyse(
    build: () => Promise<AnalysisResult>,
    info: { format: string; notes: string[] } | null,
    name: string,
  ) {
    setRunning(true);
    setRunName(name);
    await new Promise((r) => setTimeout(r, 40));
    try {
      const res = await build();
      if (!res.records.length)
        throw new Error(res.parseErrors.join(" ") || "The file did not contain any data rows.");
      setProgress({
        stage: "Opening the validation table",
        done: res.records.length,
        total: res.records.length,
        percent: 100,
      });
      await new Promise((r) => setTimeout(r, 60));
      startDraft(res);
      toast.success(`${res.records.length.toLocaleString()} rows processed`, {
        description:
          [
            info?.format,
            res.engine === "python-api" ? "Models: Python AI API" : "Models: in-browser",
            ...(info?.notes ?? []),
          ]
            .filter(Boolean)
            .join(" · ") || undefined,
      });
      void nav({ to: "/validate" });
    } catch (e) {
      fail(e instanceof Error ? e.message : "Unknown error");
    } finally {
      stop();
    }
  }

  async function runModels(
    headers: string[],
    rows: Record<string, string>[],
    name: string,
    source: DatasetSource,
    errors: string[],
  ): Promise<AnalysisResult> {
    const { result, notice } = await analyzePreferApi(
      headers,
      rows,
      name,
      source,
      errors,
      setProgress,
    );
    if (notice) toast.warning(notice);
    return result;
  }

  function analyseTable(table: DataTable, name: string) {
    return analyse(
      () => runModels(table.headers, table.rows, name, "upload", table.errors),
      { format: table.format, notes: table.notes },
      name,
    );
  }

  function stop() {
    setRunning(false);
    setProgress(null);
  }

  async function takeFiles(files: File[]) {
    if (!files.length) return;
    reset();
    setRunning(true);
    setRunName(files.length === 1 ? files[0].name : `${files.length} files`);
    setProgress({ stage: "Reading the file", done: 0, total: 0, percent: null });
    await new Promise((r) => setTimeout(r, 40));
    const prepared: { table: DataTable; name: string }[] = [];
    const incomplete: string[] = [];
    try {
      for (const file of files) {
        const table = await readDataFile(file);
        if (!table.rows.length)
          throw new Error(`${file.name}: ${table.errors[0] ?? "no data rows were found."}`);
        const mapping = suggestMapping(table);
        const channel = mapping.channel ? null : channelFromName(file.name);
        const missing = missingRequired(mapping);
        if (files.length === 1 && (missing.length || (!mapping.channel && !channel))) {
          setPending({ table, name: file.name, mapping, channel: channel ?? "" });
          stop();
          return;
        }
        if (missing.length)
          incomplete.push(`${file.name} has no ${missing.join(", ").toLowerCase()} column`);
        else prepared.push({ table: applyMapping(table, mapping, channel), name: file.name });
      }
    } catch (e) {
      stop();
      fail(e instanceof Error ? e.message : "Unknown error");
      return;
    }
    if (incomplete.length) {
      stop();
      fail(`${incomplete.join(". ")}. Upload that file on its own to choose the columns.`);
      return;
    }
    const name =
      files.length === 1
        ? files[0].name
        : `${files.length} files — ${files.map((f) => f.name).join(", ")}`;
    await analyseTable(mergeTables(prepared), name);
  }

  function confirmMapping() {
    if (!pending) return;
    const table = applyMapping(
      pending.table,
      pending.mapping,
      pending.mapping.channel ? null : pending.channel || null,
    );
    setPending(null);
    void analyseTable(table, pending.name);
  }

  const pendingMissing = pending ? missingRequired(pending.mapping) : [];
  const columnOptions = pending
    ? [
        { value: "", label: "Not in file" },
        ...pending.table.headers.map((h) => {
          const sample = pending.table.rows.find((r) => r[h])?.[h];
          return { value: h, label: h, hint: sample ? `e.g. ${sample.slice(0, 24)}` : undefined };
        }),
      ]
    : [];

  return (
    <AppShell
      kicker="Data"
      title="Upload agricultural data"
      subtitle="Drop market prices in any common format. Columns are detected and cleaned here; name matching and anomaly models run on the Python AI API, with in-browser models as a fallback."
    >
      <div className="mx-auto max-w-3xl">
        {running ? (
          <UploadProgress name={runName} progress={progress} />
        ) : (
          <>
            <DraftBanner className="mb-4" note="A new upload replaces it." />
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void takeFiles(Array.from(e.dataTransfer.files ?? []));
              }}
              className={`flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed px-6 py-16 text-center transition ${
                drag
                  ? "border-agri bg-soft"
                  : "border-border bg-card hover:border-agri hover:bg-soft/60"
              }`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-[7px] bg-soft text-primary">
                <UploadCloud className="h-7 w-7" aria-hidden />
              </span>
              <span className="mt-4 text-xl font-semibold">
                Drop your data files here or choose files.
              </span>
              <span className="mt-2 max-w-md text-sm text-muted-foreground">
                Select several files at once to combine farm-gate, wholesale, and retail exports.
              </span>
              <span className="mt-5 inline-flex h-10 items-center rounded-[7px] bg-primary px-5 text-sm font-medium text-primary-foreground">
                Choose files
              </span>
              <span className="mt-4 text-xs font-medium tracking-wide text-muted-foreground">
                {FORMAT_LABEL}
              </span>
              <input
                type="file"
                multiple
                accept={ACCEPTED_FILES}
                className="sr-only"
                onChange={(e) => {
                  void takeFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  const csv = parseCsv(generateTestCsv());
                  void analyse(
                    () =>
                      runModels(
                        csv.headers,
                        csv.rows,
                        "Test file with injected errors",
                        "synthetic-test",
                        csv.errors,
                      ),
                    { format: "CSV", notes: [] },
                    "Test file with injected errors",
                  );
                }}
              >
                Run with test data
              </Button>
              <Button
                variant="ghost"
                onClick={() => downloadFile("e-biciro-sample.csv", generateTestCsv(), "text/csv")}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden />
                Download sample CSV
              </Button>
            </div>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              PDFs, Word documents, and images are not read. Export their tables to Excel, CSV, or
              JSON. Rows are sent only to the e-biciro AI API configured for this workspace.
            </p>

            {pending && (
              <section
                className="mt-8 rounded-lg border bg-card p-5 shadow-sm"
                aria-labelledby="mapping-title"
              >
                <h2 id="mapping-title" className="text-section-title">
                  Match the columns
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {pending.name} ({pending.table.format},{" "}
                  {pending.table.rows.length.toLocaleString()} rows).{" "}
                  {pendingMissing.length
                    ? "Some required columns could not be identified from their names and values. Choose them below."
                    : "The file has no price type column. Choose the price type for every row, or continue without it."}
                </p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {FIELDS.map((field) => (
                    <div key={field.key} className="grid gap-1.5 text-sm">
                      <span className="font-medium" aria-hidden>
                        {field.label}
                        {field.required && <span className="text-destructive"> *</span>}
                      </span>
                      <SearchSelect
                        aria-label={`${field.label} column`}
                        value={pending.mapping[field.key] ?? ""}
                        onChange={(value) =>
                          setPending({
                            ...pending,
                            mapping: { ...pending.mapping, [field.key]: value || null },
                          })
                        }
                        options={columnOptions}
                        placeholder="Not in file"
                        searchPlaceholder="Search columns…"
                      />
                      {field.key === "channel" && !pending.mapping.channel && (
                        <SearchSelect
                          aria-label="Price type for every row"
                          value={pending.channel}
                          onChange={(value) => setPending({ ...pending, channel: value })}
                          options={CHANNEL_OPTIONS}
                          searchPlaceholder="Search price type…"
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Button onClick={confirmMapping} disabled={pendingMissing.length > 0}>
                    Analyse dataset
                  </Button>
                  <Button variant="ghost" onClick={() => setPending(null)}>
                    Cancel
                  </Button>
                  {pendingMissing.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      Still needed: {pendingMissing.join(", ")}
                    </span>
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {error && (
          <div
            className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5 text-red-900"
            role="alert"
          >
            <h2 className="text-lg font-semibold">{error}</h2>
            <p className="mt-2 text-sm">Possible causes:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              <li>The file is a document or image rather than a data table</li>
              <li>Market, commodity, or price columns are missing</li>
              <li>Invalid or empty data</li>
            </ul>
            <button
              type="button"
              className="mt-3 text-sm font-semibold underline"
              onClick={() => setShowTech((v) => !v)}
            >
              {showTech ? "Hide technical details" : "View technical details"}
            </button>
            {showTech && technical && (
              <pre className="mt-2 whitespace-pre-wrap text-xs">{technical}</pre>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

function orbFor(stage = ""): OrbState {
  if (/^Reading/.test(stage)) return "searching";
  if (/^Cleaning/.test(stage)) return "connecting";
  if (/duplicate/i.test(stage)) return "weaving";
  if (/peer|Isolation|Python/i.test(stage)) return "solving";
  return "composing";
}

const formatElapsed = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function UploadProgress({ name, progress }: { name: string; progress: AnalysisProgress | null }) {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const percent = progress?.percent == null ? null : Math.min(100, Math.round(progress.percent));
  const total = progress?.total ?? 0;
  const done = Math.min(progress?.done ?? 0, total);
  const remaining = total - done;
  const elapsed = formatElapsed(Math.floor((now - started) / 1000));

  return (
    <section
      className="page-rise flex flex-col items-center rounded-lg border-2 border-dashed border-agri/40 bg-card px-6 py-14 text-center"
      aria-labelledby="upload-progress-title"
    >
      <ThinkingOrb
        state={orbFor(progress?.stage)}
        size={64}
        theme="light"
        color="#0b4a2e"
        aria-hidden
      />
      <h2 id="upload-progress-title" className="mt-5 max-w-full truncate text-xl font-semibold">
        Analysing {name || "your data"}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
        {progress?.stage ?? "Starting"}…
      </p>

      <div className="mt-6 w-full max-w-md">
        <div
          className="relative h-2.5 overflow-hidden rounded-full bg-secondary"
          role="progressbar"
          aria-label="Analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
          aria-valuetext={
            total
              ? `${done.toLocaleString()} of ${total.toLocaleString()} rows processed`
              : undefined
          }
        >
          {percent == null ? (
            <div className="progress-indeterminate absolute inset-y-0 left-0 w-2/5 rounded-full bg-primary" />
          ) : (
            <div
              className="progress-sheen relative h-full overflow-hidden rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${Math.max(percent, 2)}%` }}
            />
          )}
        </div>

        <div className="mt-2 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
          <span>
            {total > 0 && percent != null ? (
              <>
                <strong className="font-semibold text-foreground">{done.toLocaleString()}</strong>{" "}
                of {total.toLocaleString()} rows processed
              </>
            ) : total > 0 ? (
              `${total.toLocaleString()} rows sent`
            ) : (
              "Reading rows"
            )}
          </span>
          <span className="font-semibold text-foreground">
            {percent == null ? elapsed : `${percent}%`}
          </span>
        </div>
        {total > 0 && percent != null && (
          <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-muted-foreground">
            <span>
              {remaining > 0
                ? `${remaining.toLocaleString()} rows remaining`
                : "All rows processed · finishing checks"}
            </span>
            <span>Elapsed {elapsed}</span>
          </div>
        )}
      </div>

      <p className="mt-6 max-w-md text-xs text-muted-foreground">
        The validation table opens as soon as the models finish.
      </p>
    </section>
  );
}

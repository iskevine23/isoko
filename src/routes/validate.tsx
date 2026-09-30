import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { memo, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";
import { AppShell, SeverityBadge } from "@/components/AppShell";
import { pageTitle } from "@/lib/brand";
import { EmptyState } from "@/components/minagri/visuals";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/search-select";
import { analyzePreferApi } from "@/lib/minagri/ai-api";
import { CHANNEL_LABEL, COMMODITIES, MARKETS, VALID_UNITS } from "@/lib/minagri/catalog";
import {
  canKeep,
  confirmAllSuggestions,
  confirmSuggestions,
  deleteRows,
  discardDraft,
  displayValue,
  draftSummary,
  draftTable,
  EDITABLE_FIELDS,
  editCell,
  editCells,
  getDraft,
  hydrateDraft,
  isBlocking,
  issueFields,
  keepIssues,
  publishDraft,
  rawValue,
  recheckAll,
  rowState,
  saveDraft,
  useDraft,
  type DraftRow,
  type EditableField,
  type RowState,
} from "@/lib/minagri/draft";
import type { Issue } from "@/lib/minagri/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/validate")({
  head: () => ({
    meta: [
      { title: pageTitle("Validate") },
      {
        name: "description",
        content:
          "Review every uploaded row, fix or delete problems, confirm AI corrections, then upload.",
      },
      { property: "og:title", content: pageTitle("Validate") },
      {
        property: "og:description",
        content:
          "Review every uploaded row, fix or delete problems, confirm AI corrections, then upload.",
      },
    ],
  }),
  component: ValidatePage,
});

const PAGE = 50;
const HIGH_CONFIDENCE = 0.9;
const FILTERS = [
  { key: "attention", label: "Needs attention" },
  { key: "error", label: "Errors" },
  { key: "warning", label: "Warnings" },
  { key: "ai", label: "AI suggestions" },
  { key: "valid", label: "Valid" },
  { key: "all", label: "All rows" },
] as const;
type Filter = (typeof FILTERS)[number]["key"];

const FIELD_LABEL = Object.fromEntries(EDITABLE_FIELDS.map((f) => [f.key, f.label])) as Record<
  EditableField,
  string
>;
const CELL_OPTIONS: Partial<Record<EditableField, SearchSelectOption[]>> = {
  market: MARKETS.map((m) => ({ value: m.name, label: m.name, hint: m.district })),
  commodity: COMMODITIES.map((c) => ({
    value: c.name,
    label: c.name,
    hint: c.local && c.local !== c.name ? c.local : undefined,
  })),
  unit: VALID_UNITS.map((u) => ({ value: u, label: u })),
  channel: Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label })),
};

function ValidatePage() {
  const nav = useNavigate();
  const draft = useDraft();
  const [filter, setFilter] = useState<Filter>("attention");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => hydrateDraft(), []);

  useEffect(() => {
    if (!draft?.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft?.dirty]);

  const summary = useMemo(() => (draft ? draftSummary(draft) : null), [draft]);

  const groups = useMemo(
    () => (draft && summary ? buildGroups(draft.rows, summary.byRow) : []),
    [draft, summary],
  );
  const hasUntyped = groups.some((g) => g.untyped);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      attention: 0,
      error: 0,
      warning: 0,
      ai: 0,
      valid: 0,
      all: 0,
    };
    for (const g of groups) {
      c.all += 1;
      c[g.state] += 1;
      if (g.state !== "valid") c.attention += 1;
      if (g.issues.some((i) => i.suggestion)) c.ai += 1;
    }
    return c;
  }, [groups]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups.filter((g) => {
      const pass =
        filter === "all" ||
        (filter === "attention" && g.state !== "valid") ||
        (filter === "ai" && g.issues.some((i) => i.suggestion)) ||
        filter === g.state;
      if (!pass) return false;
      if (!q) return true;
      const lead = g.members[0];
      return [
        lead.record.market,
        lead.record.commodity,
        lead.record.date,
        rawValue(lead, "market"),
        rawValue(lead, "commodity"),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [groups, filter, query]);

  useEffect(() => setPage(0), [filter, query]);

  if (!draft || !summary) {
    return (
      <AppShell
        kicker="Data"
        title="Validate data"
        subtitle="Uploaded rows open here for review before they join the trusted dataset."
      >
        <EmptyState
          title="No dataset waiting for validation"
          body="Upload a file. After the models process it, every row opens here so you can fix, delete, or confirm it."
          action={
            <Button asChild>
              <Link to="/upload">Upload dataset</Link>
            </Button>
          }
        />
      </AppShell>
    );
  }

  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = visible.slice(current * PAGE, current * PAGE + PAGE);
  const highConfidence = draft.issues.filter(
    (i) => i.status === "open" && i.suggestion && i.confidence >= HIGH_CONFIDENCE,
  ).length;
  const ready = summary.rows
    ? Math.round(((summary.rows - summary.errors) / summary.rows) * 100)
    : 0;
  const corrections = draft.edits.filter((e) => e.via !== "delete").length;

  const onSave = async () => {
    if (await saveDraft()) toast.success("Draft saved on this computer");
    else toast.error("The draft could not be saved. Browser storage may be full.");
  };

  const onRecheck = async () => {
    const current = getDraft();
    if (!current) return;
    setBusy(true);
    try {
      const table = draftTable(current);
      const { result, notice } = await analyzePreferApi(
        table.headers,
        table.rows,
        current.name,
        current.source,
        current.parseErrors,
      );
      recheckAll(result);
      if (notice) toast.warning(notice);
      toast.success(
        `All checks re-run on the current rows (${result.engine === "python-api" ? "Python AI API" : "in-browser models"})`,
      );
    } finally {
      setBusy(false);
    }
  };

  const onPublish = () => {
    const result = publishDraft();
    if (!result) return;
    toast.success(`${result.records.length.toLocaleString()} rows uploaded to the trusted dataset`);
    void nav({ to: "/" });
  };

  return (
    <AppShell
      fit
      title="Validate uploaded data"
      subtitle={`${draft.name} · ${groups.length.toLocaleString()} rows · ${summary.rows.toLocaleString()} prices`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground" aria-live="polite">
            {draft.dirty
              ? "Unsaved changes"
              : draft.savedAt
                ? `Draft saved ${new Date(draft.savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                : ""}
          </span>
          <Button variant="outline" onClick={() => void onSave()}>
            <Save className="h-4 w-4" aria-hidden />
            Save draft
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={summary.errors > 0 || summary.rows === 0}>
                <UploadCloud className="h-4 w-4" aria-hidden />
                Upload {summary.rows.toLocaleString()} prices
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Upload validated data?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2 text-sm">
                    <p>
                      {summary.rows.toLocaleString()} prices will replace the trusted dataset used
                      by the dashboard and exports.
                    </p>
                    <ul className="list-disc pl-5">
                      <li>{corrections.toLocaleString()} corrections are recorded in lineage.</li>
                      <li>{draft.deleted.toLocaleString()} rows were deleted.</li>
                      {summary.warnings > 0 && (
                        <li>
                          {summary.warnings.toLocaleString()} rows with warnings stay in Review for
                          follow-up.
                        </li>
                      )}
                    </ul>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep validating</AlertDialogCancel>
                <AlertDialogAction onClick={onPublish}>Upload</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex flex-wrap items-center gap-0.5 rounded-[9px] bg-secondary p-1"
          role="tablist"
          aria-label="Filter rows"
        >
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium transition-colors",
                filter === f.key
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.key !== "all" && f.key !== "attention" && (
                <span className={cn("h-1.5 w-1.5 rounded-full", FILTER_DOT[f.key])} aria-hidden />
              )}
              {f.label}
              <span className="tabular-nums text-xs text-muted-foreground">
                {counts[f.key].toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        <label className="relative ml-auto w-full sm:w-64">
          <span className="sr-only">Search rows</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search market, commodity, date"
            className="h-9 w-full rounded-[7px] border border-input bg-card pl-9 pr-3 text-sm focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <div className="flex items-center gap-2" aria-label={`${ready}% ready to upload`}>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-agri transition-all"
              style={{ width: `${ready}%` }}
            />
          </div>
          <span className="font-semibold tabular-nums">{ready}% ready</span>
        </div>
        {summary.errors > 0 ? (
          <span className="text-destructive">
            Fix or delete {summary.errors.toLocaleString()} error{" "}
            {summary.errors === 1 ? "row" : "rows"} to enable upload
          </span>
        ) : (
          <span className="text-success">No errors, ready to upload</span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {highConfidence > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-info hover:text-info"
              onClick={() => {
                confirmAllSuggestions(HIGH_CONFIDENCE);
                toast.success(`${highConfidence} AI corrections confirmed`);
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Confirm {highConfidence} AI ≥ {Math.round(HIGH_CONFIDENCE * 100)}%
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => void onRecheck()}
            disabled={busy}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} aria-hidden />
            {busy ? "Re-running" : "Re-run checks"}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Discard
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
                <AlertDialogDescription>
                  All corrections and deletions for {draft.name} are removed. The trusted dataset is
                  not changed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    discardDraft();
                    void nav({ to: "/upload" });
                  }}
                >
                  Discard
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="mt-3 overflow-hidden rounded-lg bg-card lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        {shown.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <Check className="mx-auto h-8 w-8 text-success" aria-hidden />
            <p className="mt-3 font-semibold">
              {filter === "attention" && !query
                ? "Every row is ready to upload"
                : "No rows match this view"}
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
            >
              Show all rows
            </Button>
          </div>
        ) : (
          <div className="overflow-auto max-lg:max-h-[calc(100dvh-16rem)] lg:min-h-0 lg:flex-1">
            <table className="w-full min-w-[1040px] border-separate border-spacing-0 text-sm">
              <thead className="sticky top-0 z-20 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr className="[&>th]:border-b [&>th]:border-border [&>th]:bg-card [&>th]:px-2 [&>th]:py-2.5">
                  <th className="w-8">
                    <span className="sr-only">Details</span>
                  </th>
                  <th className="w-16">Row</th>
                  {SHARED.map((f) => (
                    <th key={f}>{FIELD_LABEL[f]}</th>
                  ))}
                  {CHANNELS.map((c) => (
                    <th key={c} className="text-right">
                      {CHANNEL_LABEL[c]} <span className="font-normal normal-case">RWF</span>
                    </th>
                  ))}
                  {hasUntyped && <th className="text-right">No price type</th>}
                  <th className="min-w-[300px]">AI finding</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((group) => (
                  <ValidationRow
                    key={group.id}
                    group={group}
                    showUntyped={hasUntyped}
                    expanded={expanded === group.id}
                    onToggle={() => setExpanded((v) => (v === group.id ? null : group.id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {visible.length > PAGE && (
          <div className="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              {(current * PAGE + 1).toLocaleString()}–
              {Math.min(visible.length, (current + 1) * PAGE).toLocaleString()} of{" "}
              {visible.length.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={current === 0}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={current >= pages - 1}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

const FILTER_DOT: Partial<Record<Filter, string>> = {
  error: "bg-destructive",
  warning: "bg-warning",
  ai: "bg-info",
  valid: "bg-success",
};

const STATE_STYLE: Record<RowState, { row: string; edge: string; dot: string; label: string }> = {
  error: {
    row: "bg-[#fef6f6]",
    edge: "shadow-[inset_3px_0_0_0_#DC2626]",
    dot: "bg-destructive",
    label: "Error",
  },
  warning: {
    row: "bg-[#fffaee]",
    edge: "shadow-[inset_3px_0_0_0_#F59E0B]",
    dot: "bg-warning",
    label: "Warning",
  },
  valid: { row: "bg-card", edge: "", dot: "bg-success", label: "Valid" },
};

const formatSuggestion = (issue: Issue) =>
  issue.suggestion?.field === "price"
    ? `${Number(issue.suggestion.value).toLocaleString()} RWF`
    : String(issue.suggestion?.value ?? "");

type Channel = "farmgate" | "wholesale" | "retail";
const CHANNELS: Channel[] = ["farmgate", "wholesale", "retail"];
const SHARED: EditableField[] = ["date", "market", "commodity", "unit"];

/** One table row: the farm-gate, wholesale, and retail observations for a date, market, commodity, and unit. */
interface PriceGroup {
  id: string;
  rowNumber: number;
  members: DraftRow[];
  byChannel: Partial<Record<Channel, DraftRow>>;
  untyped?: DraftRow;
  issuesOf: Map<string, Issue[]>;
  issues: Issue[];
  state: RowState;
}

function buildGroups(rows: DraftRow[], byRow: Map<string, Issue[]>): PriceGroup[] {
  const groups: PriceGroup[] = [];
  const open = new Map<string, PriceGroup>();
  for (const row of rows) {
    const issues = byRow.get(row.id) ?? [];
    const channel = row.record.channel as Channel | "";
    const key = SHARED.map((f) => displayValue(row, f, issues).trim().toLowerCase()).join("|");
    let group = channel ? open.get(key) : undefined;
    if (!group || (channel && group.byChannel[channel])) {
      group = {
        id: row.id,
        rowNumber: row.record.rowNumber,
        members: [],
        byChannel: {},
        issuesOf: new Map(),
        issues: [],
        state: "valid",
      };
      groups.push(group);
      if (channel) open.set(key, group);
    }
    group.members.push(row);
    group.issuesOf.set(row.id, issues);
    group.issues.push(...issues);
    group.rowNumber = Math.min(group.rowNumber, row.record.rowNumber);
    if (channel) group.byChannel[channel] = row;
    else group.untyped = row;
  }
  for (const g of groups) g.state = rowState(g.issues);
  return groups;
}

/** A finding shown once per table row, even when every price in the row carries it. */
interface GroupFinding {
  issue: Issue;
  ids: string[];
  channel?: Channel;
}

function groupFindings(group: PriceGroup): GroupFinding[] {
  const merged = new Map<string, GroupFinding>();
  const out: GroupFinding[] = [];
  for (const row of group.members) {
    const channel = (row.record.channel || undefined) as Channel | undefined;
    for (const issue of group.issuesOf.get(row.id) ?? []) {
      const fields = issueFields(issue);
      const shared = fields.length > 0 && fields.every((f) => SHARED.includes(f));
      if (!shared) {
        out.push({ issue, ids: [issue.id], channel });
        continue;
      }
      const key = [issue.type, issue.title, issue.suggestion?.field, issue.suggestion?.value].join(
        "|",
      );
      const hit = merged.get(key);
      if (hit) hit.ids.push(issue.id);
      else {
        const finding = { issue, ids: [issue.id] };
        merged.set(key, finding);
        out.push(finding);
      }
    }
  }
  return out.sort(
    (a, b) =>
      Number(!!b.issue.suggestion) - Number(!!a.issue.suggestion) ||
      Number(isBlocking(b.issue)) - Number(isBlocking(a.issue)),
  );
}

const findingField = (f: GroupFinding) => {
  const field = f.issue.suggestion?.field as EditableField | undefined;
  if (field === "price" && f.channel) return `${CHANNEL_LABEL[f.channel]} price`;
  return field ? (FIELD_LABEL[field] ?? String(field)) : "";
};
const findingTitle = (f: GroupFinding) =>
  f.channel ? `${CHANNEL_LABEL[f.channel]}: ${f.issue.title}` : f.issue.title;

const ValidationRow = memo(function ValidationRow({
  group,
  showUntyped,
  expanded,
  onToggle,
}: {
  group: PriceGroup;
  showUntyped: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const style = STATE_STYLE[group.state];
  const findings = groupFindings(group);
  const lead = findings[0];
  const edited = group.members.some((m) => m.edited);
  const ids = group.members.map((m) => m.id);
  const issuesFor = (row: DraftRow) => group.issuesOf.get(row.id) ?? [];
  const columns = 3 + SHARED.length + CHANNELS.length + Number(showUntyped);

  return (
    <>
      <tr className={cn("group align-top [&>td]:border-b [&>td]:border-border/60", style.row)}>
        <td className={cn("w-8 py-1.5 pl-1.5 pr-0", style.edge)}>
          {(findings.length > 0 || group.members.length > 1) && (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={expanded ? "Hide findings" : "Show findings"}
              className="grid h-7 w-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          )}
        </td>
        <td className="px-2 py-3">
          <span
            className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground"
            title={edited ? `${style.label} · edited` : style.label}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", style.dot)} aria-hidden />
            <span className="sr-only">{style.label}, row</span>
            {group.rowNumber}
            {edited && <span className="text-[10px] font-semibold text-info">✎</span>}
          </span>
        </td>
        {SHARED.map((f) => (
          <td key={f} className="px-0.5 py-1">
            <EditCell
              rows={group.members}
              field={f}
              issues={group.issues}
              label={`${FIELD_LABEL[f]}, row ${group.rowNumber}`}
            />
          </td>
        ))}
        {CHANNELS.map((c) => {
          const member = group.byChannel[c];
          return (
            <td key={c} className="px-0.5 py-1">
              {member ? (
                <EditCell
                  rows={[member]}
                  field="price"
                  issues={issuesFor(member)}
                  label={`${CHANNEL_LABEL[c]} price, row ${group.rowNumber}`}
                />
              ) : (
                <div
                  className="h-8 px-2 text-right text-sm leading-8 text-muted-foreground/50"
                  title={`No ${CHANNEL_LABEL[c].toLowerCase()} price in the upload`}
                >
                  —
                </div>
              )}
            </td>
          );
        })}
        {showUntyped && (
          <td className="px-0.5 py-1">
            {group.untyped && (
              <div className="flex gap-1">
                <EditCell
                  rows={[group.untyped]}
                  field="channel"
                  issues={issuesFor(group.untyped)}
                  label={`Price type, row ${group.rowNumber}`}
                />
                <EditCell
                  rows={[group.untyped]}
                  field="price"
                  issues={issuesFor(group.untyped)}
                  label={`Price, row ${group.rowNumber}`}
                />
              </div>
            )}
          </td>
        )}
        <td className="px-2 py-1.5">
          <div className="flex min-h-9 items-center gap-2">
            <div className="min-w-0 flex-1">
              {lead ? (
                <Finding finding={lead} more={findings.length - 1} onMore={onToggle} />
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                  <Check className="h-3.5 w-3.5 text-success" aria-hidden /> No findings
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                deleteRows(ids);
                toast(
                  ids.length > 1
                    ? `Row ${group.rowNumber} deleted (${ids.length} prices)`
                    : `Row ${group.rowNumber} deleted`,
                );
              }}
              aria-label={`Delete row ${group.rowNumber}`}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-60 transition hover:bg-red-50 hover:text-destructive hover:opacity-100 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (findings.length > 0 || group.members.length > 1) && (
        <tr className={cn("[&>td]:border-b [&>td]:border-border/60", style.row)}>
          <td colSpan={columns} className={cn("px-4 pb-4 pt-2", style.edge)}>
            {group.members.length > 1 && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-foreground">Delete one price only:</span>
                {group.members.map((m) => {
                  const name = m.record.channel ? CHANNEL_LABEL[m.record.channel] : "Untyped";
                  return (
                    <Button
                      key={m.id}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        deleteRows([m.id]);
                        toast(`${name} price deleted from row ${group.rowNumber}`);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> {name}
                    </Button>
                  );
                })}
              </div>
            )}
            <ul className="grid gap-3 lg:grid-cols-2">
              {findings.map((finding) => {
                const { issue } = finding;
                return (
                  <li key={issue.id} className="rounded-lg border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge s={issue.severity} />
                      <span className="text-xs text-muted-foreground">
                        {Math.round(issue.confidence * 100)}% confidence · {issue.method}
                        {finding.ids.length > 1 && ` · applies to ${finding.ids.length} prices`}
                      </span>
                    </div>
                    <p className="mt-2 font-semibold">{findingTitle(finding)}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{issue.explanation}</p>
                    {issue.evidence.length > 0 && (
                      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {issue.evidence.slice(0, 4).map((e) => (
                          <div key={`${e.label}-${e.value}`}>
                            <dt className="inline text-muted-foreground">{e.label}: </dt>
                            <dd className="inline font-medium">{e.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <IssueActions finding={finding} />
                      {!issue.suggestion && !canKeep(issue) && (
                        <span className="text-xs text-muted-foreground">
                          Edit the highlighted cell or delete the row.
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
});

function IssueActions({ finding }: { finding: GroupFinding }) {
  const { issue, ids } = finding;
  return (
    <>
      {issue.suggestion && (
        <Button size="sm" className="h-8" onClick={() => confirmSuggestions(ids)}>
          <Check className="h-3.5 w-3.5" aria-hidden />
          Use {formatSuggestion(issue)}
        </Button>
      )}
      {canKeep(issue) && (
        <Button size="sm" variant="outline" className="h-8" onClick={() => keepIssues(ids)}>
          Keep as reported
        </Button>
      )}
    </>
  );
}

function Finding({
  finding,
  more,
  onMore,
}: {
  finding: GroupFinding;
  more: number;
  onMore: () => void;
}) {
  const { issue, ids } = finding;
  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 flex-1 text-xs leading-snug" title={findingTitle(finding)}>
        {issue.suggestion ? (
          <p className="truncate">
            <Sparkles className="mr-1 inline h-3 w-3 text-info" aria-label="AI suggestion" />
            <span className="text-muted-foreground">{findingField(finding)}:</span>{" "}
            <strong>{formatSuggestion(issue)}</strong>
            <span className="text-muted-foreground"> · {Math.round(issue.confidence * 100)}%</span>
          </p>
        ) : (
          <p
            className={cn(
              "truncate font-medium",
              isBlocking(issue) ? "text-red-700" : "text-amber-800",
            )}
          >
            {findingTitle(finding)}
          </p>
        )}
        {more > 0 && (
          <button
            type="button"
            onClick={onMore}
            className="text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          >
            +{more} more
          </button>
        )}
      </div>
      {issue.suggestion && (
        <Button
          size="sm"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => confirmSuggestions(ids)}
        >
          <Check className="h-3.5 w-3.5" aria-hidden /> Confirm
        </Button>
      )}
      {canKeep(issue) && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-xs"
          onClick={() => keepIssues(ids)}
        >
          Keep
        </Button>
      )}
    </div>
  );
}

const cellBase =
  "h-8 w-full min-w-0 rounded-md border px-2 text-sm transition-colors focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring/40 focus:border-primary";

function EditCell({
  rows,
  field,
  issues,
  label,
}: {
  rows: DraftRow[];
  field: EditableField;
  issues: Issue[];
  label: string;
}) {
  const row = rows[0];
  const save = (next: string) =>
    rows.length > 1
      ? editCells(
          rows.map((r) => r.id),
          field,
          next,
        )
      : editCell(row.id, field, next);
  const value = displayValue(row, field, issues);
  const cellIssues = issues.filter((i) => issueFields(i).includes(field));
  const tone = cellIssues.some(isBlocking)
    ? "border-red-300 bg-red-50 text-red-900"
    : cellIssues.length
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-transparent bg-transparent hover:border-input";
  const original = rawValue(row, field);
  const bare = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const cleaned =
    (field === "market" || field === "commodity") &&
    original !== "" &&
    value !== "" &&
    bare(original) !== bare(value);
  const reformatted = !cleaned && original !== "" && original.trim() !== value;
  const title =
    [...cellIssues.map((i) => i.title), reformatted ? `Uploaded as “${original}”` : ""]
      .filter(Boolean)
      .join("\n") || undefined;

  const choices = CELL_OPTIONS[field];
  if (choices) {
    const current = field === "channel" ? row.record.channel : value;
    return (
      <div>
        <SearchSelect
          aria-label={label}
          aria-invalid={cellIssues.some(isBlocking) || undefined}
          title={title}
          value={current}
          onChange={(next) => {
            if (next !== current) save(next);
          }}
          options={choices}
          allowCustom={field !== "channel"}
          placeholder={field === "channel" && original ? `“${original}”` : "Not set"}
          searchPlaceholder={`Search ${FIELD_LABEL[field].toLowerCase()}…`}
          className={cn(
            cellBase,
            tone,
            "rounded-md",
            field === "unit"
              ? "min-w-[76px]"
              : field === "channel"
                ? "min-w-[118px]"
                : "min-w-[140px]",
          )}
          contentClassName="min-w-[260px]"
        />
        {cleaned && (
          <div
            className="mt-0.5 truncate px-2 text-[11px] text-muted-foreground"
            title={`Uploaded as “${original}”`}
          >
            from “{original}”
          </div>
        )}
      </div>
    );
  }

  const commitValue = (input: HTMLInputElement) => {
    if (input.value.trim() !== value) save(input.value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      e.currentTarget.value = value;
      e.currentTarget.blur();
    }
  };

  return (
    <div>
      <input
        key={`${row.id}-${field}-${value}`}
        aria-label={label}
        aria-invalid={cellIssues.some(isBlocking) || undefined}
        title={title}
        defaultValue={value}
        placeholder={field === "price" ? "No data" : field === "date" ? "YYYY-MM-DD" : "Empty"}
        inputMode={field === "price" ? "decimal" : undefined}
        onBlur={(e) => commitValue(e.currentTarget)}
        onKeyDown={onKeyDown}
        className={cn(
          cellBase,
          tone,
          field === "price" ? "min-w-[96px] text-right tabular-nums" : "min-w-[120px]",
        )}
      />
      {cleaned && (
        <div
          className="mt-0.5 truncate px-2 text-[11px] text-muted-foreground"
          title={`Uploaded as “${original}”`}
        >
          from “{original}”
        </div>
      )}
    </div>
  );
}

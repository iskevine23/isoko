export type PriceChannel = "farmgate" | "wholesale" | "retail";

export interface RawRow {
  __row: number;
  [key: string]: string | number;
}

export interface FieldTrace {
  original: string;
  normalized: string;
  rule: string;
}

export interface RecordIssueRef {
  issueId: string;
}

export interface DataRecord {
  id: string;
  rowNumber: number;
  date: string; // ISO yyyy-mm-dd
  province: string;
  district: string;
  market: string;
  commodity: string;
  unit: string;
  channel: PriceChannel | "";
  price: number | null;
  currency: string;
  trace: Record<string, FieldTrace>;
  raw: Record<string, string>;
  /** set when a reviewer corrected the record */
  corrected?: boolean;
}

export type IssueType =
  | "MISSING_VALUE"
  | "INVALID_PRICE"
  | "INVALID_DATE"
  | "UNKNOWN_ENTITY"
  | "ENTITY_MATCH"
  | "EXACT_DUPLICATE"
  | "PROBABLE_DUPLICATE"
  | "POSSIBLE_DUPLICATE"
  | "PRICE_ANOMALY"
  | "LADDER_VIOLATION"
  | "UNIT_INCONSISTENCY";

export type Severity = "critical" | "high" | "medium" | "low";

export type IssueStatus = "open" | "accepted" | "corrected" | "ignored";

export interface Evidence {
  label: string;
  value: string;
}

export interface Issue {
  id: string;
  recordId: string;
  type: IssueType;
  category: "anomaly" | "conflict" | "duplicate" | "match" | "completeness";
  severity: Severity;
  confidence: number; // 0..1
  title: string;
  explanation: string;
  evidence: Evidence[];
  recommendation: string;
  method: string;
  /** suggested replacement value for the affected field */
  suggestion?: { field: keyof DataRecord; value: string | number };
  status: IssueStatus;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface ColumnProfile {
  name: string;
  type: "numeric" | "categorical" | "date";
  missing: number;
  unique: number;
  sample: string[];
  min?: number;
  max?: number;
  mean?: number;
}

export interface Profile {
  rows: number;
  columns: number;
  columnProfiles: ColumnProfile[];
  missingCells: number;
  duplicateRows: number;
  commodities: number;
  markets: number;
  provinces: string[];
  districts: number;
  dateCoverage: { from: string; to: string; days: number };
  channelCounts: Record<string, number>;
}

export interface QualityScore {
  total: number;
  completeness: number;
  consistency: number;
  uniqueness: number;
  validity: number;
  aiConfidence: number;
  formula: string;
  details: { label: string; value: string }[];
}

export interface Coverage {
  reportingMarkets: number;
  totalMarkets: number;
  provinces: {
    name: string;
    markets: number;
    reporting: number;
    observations: number;
  }[];
  missingProvinces: string[];
}

export interface LineageEntry {
  id: string;
  stage: string;
  recordId: string;
  field: string;
  before: string;
  after: string;
  rule: string;
  confidence: number;
  timestamp: string;
  actor: "system" | "reviewer";
}

export interface MlModelReport {
  applied: boolean;
  /** "trained" = saved model from npm run ml:train, "refit" = fitted on this file. */
  origin: "trained" | "refit" | "none";
  trainedOn: string;
  trainedAt: string;
  recordsScored: number;
  trees: number;
  subsample: number;
  threshold: number;
  flagged: number;
  corroborated: number;
  newIssues: number;
  note: string;
}

export interface EntityModelReport {
  /** Names that were uncertain enough for the TF-IDF character model. */
  rowsCompared: number;
  note: string;
}

export type DatasetSource = "esoko-snapshot" | "upload" | "synthetic-test";

export interface MlSummary {
  isolationForest: MlModelReport;
  entityEmbeddings: EntityModelReport;
}

export interface AnalysisResult {
  datasetName: string;
  analyzedAt: string;
  source: DatasetSource;
  /** Where the matching and anomaly models ran: the Flask AI API or the in-browser fallback. */
  engine: "python-api" | "browser";
  /** True only for the synthetic test file with injected errors. */
  isDemo: boolean;
  records: DataRecord[];
  issues: Issue[];
  profile: Profile;
  coverage: Coverage;
  lineage: LineageEntry[];
  parseErrors: string[];
  ml: MlSummary;
}

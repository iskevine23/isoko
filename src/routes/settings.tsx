import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell, Panel } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { AI_API_URL, checkAiApi, type AiApiHealth } from "@/lib/minagri/ai-api";
import { REGISTRY_NOTES } from "@/lib/minagri/catalog";
import { SOURCE_LABEL } from "@/lib/minagri/pipeline";
import { reloadSnapshot, useAnalysis } from "@/lib/minagri/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — MINAGRI Data Intelligence" },
      {
        name: "description",
        content: "Dataset session and how MINAGRI Data Intelligence processes files.",
      },
      { property: "og:title", content: "Settings — MINAGRI Data Intelligence" },
      {
        property: "og:description",
        content: "Dataset session and how MINAGRI Data Intelligence processes files.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { result, score } = useAnalysis();
  const [health, setHealth] = useState<AiApiHealth | null | undefined>(undefined);
  const probe = useCallback(() => {
    setHealth(undefined);
    void checkAiApi().then(setHealth);
  }, []);
  useEffect(probe, [probe]);
  return (
    <AppShell
      kicker="Session"
      title="Settings"
      subtitle="This workspace keeps the active dataset in your browser. Raw rows stay available in lineage even after a correction."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Active dataset">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Name</dt>
              <dd className="font-medium">{result.datasetName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Analysed</dt>
              <dd className="font-medium">{new Date(result.analyzedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Source</dt>
              <dd className="font-medium">{SOURCE_LABEL[result.source]}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Models used</dt>
              <dd className="font-medium">
                {result.engine === "python-api" ? "Python AI API (Flask)" : "In-browser models"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Quality score</dt>
              <dd className="font-medium">{score.total}/100</dd>
            </div>
          </dl>
          <Button className="mt-5" variant="outline" onClick={() => reloadSnapshot()}>
            Reload e-Soko snapshot
          </Button>
        </Panel>
        <Panel title="Python AI API">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="font-medium">{AI_API_URL}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">
                {health === undefined
                  ? "Checking…"
                  : health === null
                    ? "Not reachable. Uploads use the in-browser models."
                    : health.status === "ok"
                      ? "Online"
                      : `Online without a price model: ${health.priceModel.error ?? "not trained"}`}
              </dd>
            </div>
            {health && (
              <>
                <div>
                  <dt className="text-muted-foreground">Anomaly engine</dt>
                  <dd className="font-medium">
                    {health.priceModel.loaded
                      ? `Isolation Forest, ${health.priceModel.trees} trees, review line ${health.priceModel.threshold}, trained ${new Date(health.priceModel.trainedAt ?? "").toLocaleString()}`
                      : "No trained model"}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Matching engine</dt>
                  <dd className="font-medium">RapidFuzz + {health.matching.backend}</dd>
                </div>
              </>
            )}
          </dl>
          <Button className="mt-5" variant="outline" onClick={probe}>
            Check again
          </Button>
        </Panel>
        <Panel title="How analysis works">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              Files are read and cleaned in the browser. The rows are then sent to the Python AI API
              for name matching and anomaly detection; if it is offline, the same checks run in the
              browser.
            </li>
            <li>
              Names are matched to the e-Soko commodity catalog and market registry. Uncertain
              matches wait for a person.
            </li>
            <li>
              Commodity and market names use exact lookup, then RapidFuzz. When RapidFuzz is
              uncertain, a multilingual Sentence Transformer gives a second opinion. Thresholds are
              calibrated so names outside the catalog are reported as unknown, not guessed.
            </li>
            <li>Unusual prices use a robust peer comparison inside each commodity and channel.</li>
            <li>
              An Isolation Forest trained on the real e-Soko snapshot then scores price, market,
              province, and the farm–wholesale–retail ladder together. It only adds a finding when
              that combination is unusual.
            </li>
            <li>Farm gate, wholesale, and retail are checked against the expected price ladder.</li>
            <li>
              Accept, correct, or ignore a finding in Review Center. The quality score updates from
              those decisions.
            </li>
          </ul>
        </Panel>
        <Panel title="e-Soko registry notes" className="lg:col-span-2">
          <p className="text-sm text-muted-foreground">
            Found while loading the catalog. Where a market&apos;s province conflicts with its
            district, the district is used.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {REGISTRY_NOTES.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}

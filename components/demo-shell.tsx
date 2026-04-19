"use client";

import Link from "next/link";
import { useEffect, useDeferredValue, useState, useTransition } from "react";
import {
  ArrowRight,
  Download,
  RefreshCw,
  Shield,
  Sparkles,
  Target,
  Workflow,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  AddSection,
  ComparisonRow,
  DemoMode,
  DemoOverview,
  DemoResult,
  DemoRuntime,
  PresentationPhase,
  StoredAuditRecord,
} from "@/lib/types";

type DemoShellProps = {
  addSections: AddSection[];
  comparisonRows: ComparisonRow[];
  defaultSourceNotes: string;
  phases: PresentationPhase[];
  scenarios: string[];
};

type ChoiceCardProps = {
  active: boolean;
  description: string;
  onClick: () => void;
  title: string;
};

type MetricCardProps = {
  description: string;
  label: string;
  value: string;
};

type ResultPanel = "summary" | "flow" | "guards" | "cost" | "audit";

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value < 1 ? 4 : 2,
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function countSourceNotes(notes: string) {
  const matches = notes.match(/^##\s+/gm);

  if (matches?.length) {
    return matches.length;
  }

  return notes.trim() ? 1 : 0;
}

function decisionLabel(value: DemoResult["decision"]) {
  switch (value) {
    case "answer":
      return "Answer";
    case "answer_with_redaction":
      return "Answer with redaction";
    case "review":
      return "Needs review";
    case "block":
      return "Blocked";
    default:
      return value;
  }
}

function runtimeLabel(value: DemoRuntime) {
  return value === "openai" ? "OpenAI polished answer" : "Built-in answer";
}

function decisionVariant(value: DemoResult["decision"]): BadgeProps["variant"] {
  switch (value) {
    case "answer":
      return "success";
    case "answer_with_redaction":
      return "warning";
    case "review":
      return "secondary";
    case "block":
      return "destructive";
    default:
      return "outline";
  }
}

function statusVariant(value: boolean): BadgeProps["variant"] {
  return value ? "success" : "destructive";
}

function guardVariant(value: DemoResult["guardrails"]["input"]["status"]): BadgeProps["variant"] {
  switch (value) {
    case "allow":
      return "success";
    case "redact":
      return "warning";
    case "block":
      return "destructive";
    default:
      return "outline";
  }
}

function pipelineDotClass(status: DemoResult["pipeline"][number]["status"]) {
  switch (status) {
    case "completed":
      return "bg-emerald-500 ring-4 ring-emerald-100";
    case "warning":
      return "bg-amber-500 ring-4 ring-amber-100";
    case "blocked":
      return "bg-red-500 ring-4 ring-red-100";
    default:
      return "bg-primary ring-4 ring-primary/10";
  }
}

function pipelineBadgeVariant(status: DemoResult["pipeline"][number]["status"]): BadgeProps["variant"] {
  switch (status) {
    case "completed":
      return "success";
    case "warning":
      return "warning";
    case "blocked":
      return "destructive";
    default:
      return "outline";
  }
}

function formatDelta(value: number) {
  const absolute = formatMoney(Math.abs(value));

  if (value === 0) {
    return "On benchmark";
  }

  return value > 0 ? `${absolute} above` : `${absolute} below`;
}

function downloadTextFile(name: string, contents: string) {
  const blob = new Blob([contents], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function ChoiceCard({ active, description, onClick, title }: ChoiceCardProps) {
  return (
    <button
      className={cn(
        buttonVariants({ size: "lg", variant: active ? "secondary" : "outline" }),
        "h-auto flex-1 flex-col items-start gap-1 rounded-2xl px-4 py-4 text-left whitespace-normal",
      )}
      onClick={onClick}
      type="button"
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-xs leading-5 text-muted-foreground">{description}</span>
    </button>
  );
}

function MetricCard({ description, label, value }: MetricCardProps) {
  return (
    <Card className="border-border/70 bg-muted/25 shadow-none">
      <CardContent className="space-y-2 p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function DemoShell({
  addSections,
  comparisonRows,
  defaultSourceNotes,
  phases,
  scenarios,
}: DemoShellProps) {
  const [question, setQuestion] = useState(scenarios[0] ?? "");
  const [sourceNotes, setSourceNotes] = useState(defaultSourceNotes);
  const [mode, setMode] = useState<DemoMode>("chain");
  const [runtime, setRuntime] = useState<DemoRuntime>("local");
  const [result, setResult] = useState<DemoResult | null>(null);
  const [recent, setRecent] = useState<StoredAuditRecord[]>([]);
  const [overview, setOverview] = useState<DemoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [openaiConfigured, setOpenaiConfigured] = useState(false);
  const [openaiModel, setOpenaiModel] = useState("gpt-4.1-mini");
  const [activePanel, setActivePanel] = useState<ResultPanel>("summary");
  const [showSourceNotes, setShowSourceNotes] = useState(false);
  const [, startTransition] = useTransition();

  const deferredQuestion = useDeferredValue(question);
  const deferredSourceNotes = useDeferredValue(sourceNotes);

  useEffect(() => {
    void refreshAppState();
  }, []);

  async function refreshAppState() {
    setIsRefreshing(true);

    try {
      const response = await fetch("/api/demo");
      const payload = (await response.json()) as {
        recent?: StoredAuditRecord[];
        overview?: DemoOverview;
        openai?: {
          configured?: boolean;
          model?: string;
        };
      };

      setRecent(payload.recent ?? []);
      setOverview(payload.overview ?? null);
      setOpenaiConfigured(Boolean(payload.openai?.configured));
      setOpenaiModel(payload.openai?.model ?? "gpt-4.1-mini");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function runDemo(nextMode: DemoMode) {
    if (!question.trim()) {
      setError("Add a question before running the demo.");
      return;
    }

    if (!sourceNotes.trim()) {
      setError("Add at least one source note before running the demo.");
      return;
    }

    setMode(nextMode);
    setError(null);
    setIsRunning(true);

    try {
      const response = await fetch("/api/demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          mode: nextMode,
          runtime,
          sourceNotes,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        overview?: DemoOverview;
        recent?: StoredAuditRecord[];
        result?: DemoResult;
      };

      if (!response.ok || !payload.result) {
        throw new Error(payload.error ?? "The demo request failed.");
      }

      startTransition(() => {
        setResult(payload.result ?? null);
        setOverview(payload.overview ?? null);
        setActivePanel("summary");
      });

      setRecent(payload.recent ?? []);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "Unexpected error.";
      setError(message);
    } finally {
      setIsRunning(false);
    }
  }

  function exportCsv() {
    if (!result) {
      return;
    }

    const rows = [
      ["mode", "node", "status", "tokens", "subtotal", "decision", "timestamp"].join(","),
      ...result.pipeline.map((node) =>
        [
          result.mode,
          node.label,
          node.status,
          String(node.estimatedTokens),
          String(node.estimatedCost.toFixed(4)),
          result.decision,
          result.generatedAt,
        ].join(","),
      ),
    ];

    downloadTextFile(`${result.mode}-cost-breakdown.csv`, rows.join("\n"));
  }

  function applyScenario(nextQuestion: string) {
    setQuestion(nextQuestion);
    setError(null);
  }

  const sourceCount = countSourceNotes(deferredSourceNotes);
  const activeEvaluation = overview?.evaluations[mode] ?? null;
  const chainDelta = overview ? overview.evaluations.chain.averagePer1000 - overview.slideEstimate.chainPer1000 : 0;
  const graphDelta = overview ? overview.evaluations.graph.averagePer1000 - overview.slideEstimate.graphPer1000 : 0;

  const modeDescription =
    mode === "chain"
      ? "Loader -> splitter -> Pinecone -> RetrievalQA."
      : "The same retrieval core, now wrapped in visible governance nodes.";

  const summaryMetrics = result
    ? [
        {
          label: "Decision",
          value: decisionLabel(result.decision),
          description: result.route,
        },
        {
          label: "Cost per 1,000",
          value: formatMoney(result.cost.per1000),
          description: `Estimated latency: ${result.cost.latencyMs} ms`,
        },
        {
          label: "Sources",
          value: String(result.provenance.length),
          description: result.usedSampleNotes ? "Sample corpus" : "Custom source notes",
        },
        {
          label: "Guardrails",
          value: result.guardrails.canaryTriggered ? "Canary blocked" : result.guardrails.status,
          description: `Input ${result.guardrails.input.status} | Output ${result.guardrails.output.status}`,
        },
      ]
    : null;

  const panelButtons: Array<{ id: ResultPanel; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "flow", label: "Flow" },
    { id: "guards", label: "Guards" },
    { id: "cost", label: "Cost" },
    { id: "audit", label: "Audit" },
  ];

  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader current="workbench" />

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="border-border/70 bg-card/95">
            <CardContent className="space-y-8 p-8 sm:p-10">
              <div className="space-y-4">
                <Badge className="w-fit rounded-full" variant="outline">
                  Cleaner live demo
                </Badge>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                  One control panel, one result panel, one easy story.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                  The layout is now built to keep the output obvious. Run the question on the left,
                  read the answer on the right, then switch between summary, flow, guardrails, cost,
                  and audit views without scrolling through a long wall of cards.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                {phases.map((phase) => (
                  <Card className="border-border/70 bg-muted/20 shadow-none" key={phase.phase}>
                    <CardContent className="space-y-3 p-4">
                      <Badge className="w-fit rounded-full" variant="secondary">
                        {phase.phase}
                      </Badge>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold">{phase.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{phase.deliverable}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant="secondary">
                Start here
              </Badge>
              <CardTitle className="text-2xl">Best live path</CardTitle>
              <CardDescription className="text-sm leading-6">
                Keep the first demo pass simple and predictable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                "Run the first RAG question with the chain.",
                "Switch to the graph for the governance question.",
                "Use the canary drill to prove the block path.",
                "Open the cost or audit view only when the audience asks.",
              ].map((item, index) => (
                <div className="flex items-start gap-3 rounded-2xl border border-border/70 bg-muted/20 p-4" key={item}>
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <p className="text-sm leading-6 text-muted-foreground">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
          <div className="space-y-6">
            <Card className="border-border/70 bg-card/95">
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge className="w-fit rounded-full" variant="outline">
                      Control panel
                    </Badge>
                    <CardTitle className="mt-3 text-2xl">Set up the run</CardTitle>
                    <CardDescription className="mt-2 text-sm leading-6">
                      Keep the setup small: choose the path, choose the runtime, choose the
                      question, then run it.
                    </CardDescription>
                  </div>
                  <Badge className="rounded-full" variant="secondary">
                    {sourceCount} source note{sourceCount === 1 ? "" : "s"}
                  </Badge>
                </div>
              </CardHeader>

              <CardContent className="space-y-6">
                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Architecture</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <ChoiceCard
                      active={mode === "chain"}
                      description="Best for the minimal RAG path."
                      onClick={() => setMode("chain")}
                      title="LangChain RAG"
                    />
                    <ChoiceCard
                      active={mode === "graph"}
                      description="Best for visible governance and routing."
                      onClick={() => setMode("graph")}
                      title="LangGraph flow"
                    />
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{modeDescription}</p>
                </div>

                <div className="space-y-3">
                  <p className="text-sm font-medium text-foreground">Answer style</p>
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <ChoiceCard
                      active={runtime === "local"}
                      description="Stable and easy to rehearse"
                      onClick={() => setRuntime("local")}
                      title="Built-in answer"
                    />
                    <ChoiceCard
                      active={runtime === "openai"}
                      description={openaiConfigured ? openaiModel : "Falls back if no key is set"}
                      onClick={() => setRuntime("openai")}
                      title="OpenAI polished answer"
                    />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Presentation questions</p>
                    <Badge className="rounded-full" variant="outline">
                      {scenarios.length} samples
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {scenarios.map((scenario) => (
                      <button
                        className={cn(
                          "rounded-2xl border px-4 py-3 text-left text-sm leading-6 transition-colors",
                          question === scenario
                            ? "border-primary/20 bg-primary/5 text-foreground"
                            : "border-border bg-background hover:bg-muted/30",
                        )}
                        key={scenario}
                        onClick={() => applyScenario(scenario)}
                        type="button"
                      >
                        {scenario}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-medium text-foreground" htmlFor="question">
                    Question
                  </label>
                  <Textarea
                    className="min-h-32 text-sm leading-6"
                    id="question"
                    onChange={(event) => setQuestion(event.target.value)}
                    rows={4}
                    value={question}
                  />
                  <p className="text-sm text-muted-foreground">
                    Preview: {deferredQuestion ? "Ready to run." : "Add a question to continue."}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Source notes</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Hidden by default so the main demo stays clean.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => setShowSourceNotes((value) => !value)} size="sm" variant="outline">
                        {showSourceNotes ? "Hide notes" : "Show notes"}
                      </Button>
                      <Button onClick={() => setSourceNotes(defaultSourceNotes)} size="sm" variant="outline">
                        Reset
                      </Button>
                    </div>
                  </div>

                  {showSourceNotes ? (
                    <Textarea
                      className="min-h-[260px] font-mono text-[13px] leading-6"
                      id="sourceNotes"
                      onChange={(event) => setSourceNotes(event.target.value)}
                      rows={12}
                      value={sourceNotes}
                    />
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border bg-muted/15 px-4 py-4 text-sm text-muted-foreground">
                      Source notes are tucked away to keep the demo focused. Open them only when you
                      want to show the underlying corpus.
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button
                    className="rounded-full sm:flex-1"
                    disabled={isRunning}
                    onClick={() => runDemo("chain")}
                    size="lg"
                  >
                    {isRunning && mode === "chain" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Running chain...
                      </>
                    ) : (
                      "Run LangChain RAG"
                    )}
                  </Button>
                  <Button
                    className="rounded-full sm:flex-1"
                    disabled={isRunning}
                    onClick={() => runDemo("graph")}
                    size="lg"
                    variant="secondary"
                  >
                    {isRunning && mode === "graph" ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Running graph...
                      </>
                    ) : (
                      "Run LangGraph flow"
                    )}
                  </Button>
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-card/95">
              <CardHeader>
                <Badge className="w-fit rounded-full" variant="outline">
                  Quick shortcuts
                </Badge>
                <CardTitle className="text-2xl">Phase 3 buttons</CardTitle>
                <CardDescription className="text-sm leading-6">
                  These make it easy to jump straight to the most useful live moments.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  <Button className="justify-start rounded-2xl" onClick={() => applyScenario(scenarios[0] ?? "")} variant="outline">
                    Use safe RAG question
                  </Button>
                  <Button className="justify-start rounded-2xl" onClick={() => applyScenario(scenarios[2] ?? "")} variant="outline">
                    <Shield className="h-4 w-4" />
                    Load API key block
                  </Button>
                  <Button className="justify-start rounded-2xl" onClick={() => applyScenario(scenarios[3] ?? "")} variant="outline">
                    <Target className="h-4 w-4" />
                    Load canary drill
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <MetricCard
                    description="Built-in evaluation suite"
                    label="Chain accuracy"
                    value={overview ? `${overview.evaluations.chain.accuracy}%` : "--"}
                  />
                  <MetricCard
                    description="Built-in evaluation suite"
                    label="Graph accuracy"
                    value={overview ? `${overview.evaluations.graph.accuracy}%` : "--"}
                  />
                </div>

                <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
                  <p className="text-sm font-medium text-foreground">
                    OpenAI status: {openaiConfigured ? "ready" : "optional"}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {openaiConfigured
                      ? `Server-side model: ${openaiModel}`
                      : "The demo still works cleanly without a key. The key only changes the answer wording."}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <Card className="border-border/70 bg-card/95">
              <CardHeader className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Badge className="w-fit rounded-full" variant="outline">
                      Result panel
                    </Badge>
                    <CardTitle className="mt-3 text-2xl">
                      {result ? "Read the latest run" : "Run a demo to populate the output"}
                    </CardTitle>
                    <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                      The output is intentionally grouped into one clean panel so the answer is never
                      buried under the supporting detail.
                    </CardDescription>
                  </div>

                  {result ? (
                    <div className="flex flex-wrap gap-2">
                      <Badge className="rounded-full" variant={result.mode === "chain" ? "outline" : "secondary"}>
                        {result.mode === "chain" ? "LangChain RAG" : "LangGraph flow"}
                      </Badge>
                      <Badge className="rounded-full" variant={decisionVariant(result.decision)}>
                        {decisionLabel(result.decision)}
                      </Badge>
                      <Badge className="rounded-full" variant="outline">
                        {runtimeLabel(result.runtime)}
                      </Badge>
                    </div>
                  ) : null}
                </div>
              </CardHeader>

              <CardContent>
                {result ? (
                  <div className="space-y-6">
                    <Card className="border-border/70 bg-primary text-primary-foreground shadow-none">
                      <CardHeader className="pb-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <CardTitle className="text-2xl">Answer</CardTitle>
                            <CardDescription className="mt-2 text-sm leading-6 text-primary-foreground/75">
                              This is the part you should read first in the live demo.
                            </CardDescription>
                          </div>
                          <Badge className="rounded-full border-primary-foreground/15 bg-primary-foreground/10 text-primary-foreground">
                            {formatTime(result.generatedAt)}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm leading-7 text-primary-foreground/90 sm:text-base">{result.answer}</p>
                      </CardContent>
                    </Card>

                    {summaryMetrics ? (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {summaryMetrics.map((metric) => (
                          <MetricCard
                            description={metric.description}
                            key={metric.label}
                            label={metric.label}
                            value={metric.value}
                          />
                        ))}
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      {panelButtons.map((panel) => (
                        <Button
                          className="rounded-full"
                          key={panel.id}
                          onClick={() => setActivePanel(panel.id)}
                          size="sm"
                          variant={activePanel === panel.id ? "secondary" : "outline"}
                        >
                          {panel.label}
                        </Button>
                      ))}
                      <div className="ml-auto">
                        <Button className="rounded-full" onClick={exportCsv} size="sm" variant="outline">
                          <Download className="h-4 w-4" />
                          Export CSV
                        </Button>
                      </div>
                    </div>

                    {activePanel === "summary" ? (
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                        <div className="space-y-6">
                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <CardTitle className="text-lg">Why this answer makes sense</CardTitle>
                              <CardDescription className="text-sm leading-6">
                                Use these points as your short talk track.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {result.takeaways.map((takeaway) => (
                                <div
                                  className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-muted-foreground"
                                  key={takeaway}
                                >
                                  {takeaway}
                                </div>
                              ))}
                            </CardContent>
                          </Card>

                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <CardTitle className="text-lg">Speaker tip</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="rounded-2xl border border-border/70 bg-background px-4 py-4 text-sm leading-7 text-muted-foreground">
                                {result.speakerTip}
                              </div>
                            </CardContent>
                          </Card>
                        </div>

                        <div className="space-y-6">
                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <CardTitle className="text-lg">Supporting sources</CardTitle>
                              <CardDescription className="text-sm leading-6">
                                These are the chunks that justified the output.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {result.provenance.length === 0 ? (
                                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                                  No strong source chunk matched the question.
                                </div>
                              ) : (
                                result.provenance.map((item) => (
                                  <Card className="border-border/70 bg-background shadow-none" key={item.id}>
                                    <CardContent className="space-y-3 p-4">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                                        <Badge className="rounded-full" variant="outline">
                                          Score {item.score}
                                        </Badge>
                                      </div>
                                      <p className="text-sm leading-6 text-muted-foreground">{item.excerpt}</p>
                                      <p className="text-xs leading-5 text-muted-foreground">{item.source}</p>
                                    </CardContent>
                                  </Card>
                                ))
                              )}
                            </CardContent>
                          </Card>

                          {result.graphState ? (
                            <Card className="border-border/70 bg-muted/20 shadow-none">
                              <CardHeader>
                                <CardTitle className="text-lg">Graph state</CardTitle>
                                <CardDescription className="text-sm leading-6">
                                  This is the typed state snapshot that makes the graph path easy to explain.
                                </CardDescription>
                              </CardHeader>
                              <CardContent className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">INPUT_SCREEN</p>
                                  <p className="mt-2 text-sm leading-6">{result.graphState.inputScreen}</p>
                                </div>
                                <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Decision</p>
                                  <p className="mt-2 text-sm leading-6">{decisionLabel(result.graphState.decision)}</p>
                                </div>
                                <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 md:col-span-2">
                                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">AUDIT_LOG fields</p>
                                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{result.graphState.auditLogFields.join(", ")}</p>
                                </div>
                              </CardContent>
                            </Card>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {activePanel === "flow" ? (
                      <Card className="border-border/70 bg-muted/20 shadow-none">
                        <CardHeader>
                          <CardTitle className="text-lg">Workflow nodes</CardTitle>
                          <CardDescription className="text-sm leading-6">
                            This is the cleanest view for explaining how the request moved through the system.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {result.pipeline.map((node) => (
                            <div className="flex gap-4" key={node.id}>
                              <div className="flex flex-col items-center">
                                <span className={cn("mt-2 h-2.5 w-2.5 rounded-full", pipelineDotClass(node.status))} />
                                <span className="mt-2 h-full w-px bg-border last:hidden" />
                              </div>
                              <div className="flex-1 space-y-2 pb-4">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-medium text-foreground">{node.label}</p>
                                  <Badge className="rounded-full" variant={pipelineBadgeVariant(node.status)}>
                                    {node.status}
                                  </Badge>
                                </div>
                                <p className="text-sm leading-6 text-muted-foreground">{node.description}</p>
                                {node.output ? (
                                  <div className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-muted-foreground">
                                    {node.output}
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </CardContent>
                      </Card>
                    ) : null}

                    {activePanel === "guards" ? (
                      <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2">
                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <div className="flex items-center justify-between gap-3">
                                <CardTitle className="text-lg">InputGuard</CardTitle>
                                <Badge className="rounded-full" variant={guardVariant(result.guardrails.input.status)}>
                                  {result.guardrails.input.status}
                                </Badge>
                              </div>
                              <CardDescription className="text-sm leading-6">
                                Runs before retrieval and routing.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {result.guardrails.input.reasons.map((reason) => (
                                <div
                                  className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-muted-foreground"
                                  key={reason}
                                >
                                  {reason}
                                </div>
                              ))}
                            </CardContent>
                          </Card>

                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <div className="flex items-center justify-between gap-3">
                                <CardTitle className="text-lg">OutputGuard</CardTitle>
                                <Badge className="rounded-full" variant={guardVariant(result.guardrails.output.status)}>
                                  {result.guardrails.output.status}
                                </Badge>
                              </div>
                              <CardDescription className="text-sm leading-6">
                                Runs after the draft answer and can still stop release.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {result.guardrails.output.reasons.map((reason) => (
                                <div
                                  className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-muted-foreground"
                                  key={reason}
                                >
                                  {reason}
                                </div>
                              ))}
                            </CardContent>
                          </Card>
                        </div>

                        <Card
                          className={cn(
                            "shadow-none",
                            result.guardrails.canaryTriggered
                              ? "border-amber-200 bg-amber-50"
                              : "border-border/70 bg-muted/20",
                          )}
                        >
                          <CardContent className="flex items-start gap-4 p-5">
                            <span
                              className={cn(
                                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                                result.guardrails.canaryTriggered ? "bg-amber-100 text-amber-700" : "bg-background text-foreground",
                              )}
                            >
                              <Sparkles className="h-4 w-4" />
                            </span>
                            <div className="space-y-2">
                              <p className="text-sm font-semibold">
                                {result.guardrails.canaryTriggered
                                  ? "Canary leak blocked before release"
                                  : "No canary leak detected in this run"}
                              </p>
                              <p className="text-sm leading-6 text-muted-foreground">
                                {result.guardrails.canaryTriggered
                                  ? "This is the cleanest proof point for the guardrail story: retrieval found the sensitive text, but release still stopped."
                                  : "Load the canary drill question when you want to prove the release block path."}
                              </p>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    ) : null}

                    {activePanel === "cost" ? (
                      <div className="space-y-6">
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                          <MetricCard
                            description={overview?.slideEstimate.note ?? "Presentation benchmark"}
                            label="Chain benchmark"
                            value={overview ? formatMoney(overview.slideEstimate.chainPer1000) : "--"}
                          />
                          <MetricCard
                            description={overview?.slideEstimate.note ?? "Presentation benchmark"}
                            label="Graph benchmark"
                            value={overview ? formatMoney(overview.slideEstimate.graphPer1000) : "--"}
                          />
                          <MetricCard
                            description="Average suite delta versus the benchmark"
                            label="Chain delta"
                            value={overview ? formatDelta(chainDelta) : "--"}
                          />
                          <MetricCard
                            description="Average suite delta versus the benchmark"
                            label="Graph delta"
                            value={overview ? formatDelta(graphDelta) : "--"}
                          />
                        </div>

                        <Card className="border-border/70 bg-muted/20 shadow-none">
                          <CardHeader>
                            <CardTitle className="text-lg">Node-level token cost</CardTitle>
                            <CardDescription className="text-sm leading-6">
                              Each node reports an estimated token load so the cost story is easy to justify.
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="rounded-2xl border border-border/70 bg-background">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead>Node</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Tokens</TableHead>
                                    <TableHead>Subtotal</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {result.pipeline.map((node) => (
                                    <TableRow key={node.id}>
                                      <TableCell className="font-medium">{node.label}</TableCell>
                                      <TableCell>
                                        <Badge className="rounded-full" variant={pipelineBadgeVariant(node.status)}>
                                          {node.status}
                                        </Badge>
                                      </TableCell>
                                      <TableCell>{node.estimatedTokens}</TableCell>
                                      <TableCell>{formatMoney(node.estimatedCost)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </CardContent>
                        </Card>

                        <div className="space-y-3">
                          {result.cost.assumptions.map((assumption) => (
                            <p className="text-sm leading-6 text-muted-foreground" key={assumption}>
                              {assumption}
                            </p>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {activePanel === "audit" ? (
                      <div className="grid gap-6 xl:grid-cols-2">
                        <Card className="border-border/70 bg-muted/20 shadow-none">
                          <CardHeader>
                            <CardTitle className="text-lg">Run audit</CardTitle>
                            <CardDescription className="text-sm leading-6">
                              This is the record from the current run.
                            </CardDescription>
                          </CardHeader>
                          <CardContent className="space-y-4">
                            {result.audit.map((item, index) => (
                              <div
                                className={cn(
                                  "space-y-1 border-b border-border/70 pb-4",
                                  index === result.audit.length - 1 ? "border-b-0 pb-0" : "",
                                )}
                                key={`${item.timestamp}-${index}`}
                              >
                                <p className="text-sm font-medium text-foreground">{item.stage}</p>
                                <p className="text-sm leading-6 text-muted-foreground">{item.detail}</p>
                                <p className="text-xs text-muted-foreground">{formatTime(item.timestamp)}</p>
                              </div>
                            ))}
                          </CardContent>
                        </Card>

                        <Card className="border-border/70 bg-muted/20 shadow-none">
                          <CardHeader>
                            <div className="flex items-center justify-between gap-3">
                              <div>
                                <CardTitle className="text-lg">Recent runs</CardTitle>
                                <CardDescription className="text-sm leading-6">
                                  Use this when you want to prove the site is writing history.
                                </CardDescription>
                              </div>
                              <Button onClick={() => void refreshAppState()} size="sm" variant="outline">
                                <RefreshCw className={cn("h-4 w-4", isRefreshing ? "animate-spin" : "")} />
                                Refresh
                              </Button>
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {recent.length === 0 ? (
                              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                                Run the demo once and the audit history will appear here.
                              </div>
                            ) : (
                              recent.map((record) => (
                                <Card className="border-border/70 bg-background shadow-none" key={record.id}>
                                  <CardContent className="space-y-3 p-4">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <Badge className="rounded-full" variant={record.decision === "block" ? "destructive" : "secondary"}>
                                        {decisionLabel(record.decision)}
                                      </Badge>
                                      <p className="text-xs text-muted-foreground">{formatTime(record.createdAt)}</p>
                                    </div>
                                    <p className="text-sm font-medium leading-6">{record.question}</p>
                                    <p className="text-xs leading-5 text-muted-foreground">
                                      {record.mode === "chain" ? "LangChain RAG" : "LangGraph flow"} |{" "}
                                      {runtimeLabel(record.runtime)}
                                    </p>
                                  </CardContent>
                                </Card>
                              ))
                            )}
                          </CardContent>
                        </Card>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Card className="border-dashed border-border bg-muted/15 shadow-none">
                    <CardContent className="flex min-h-[540px] flex-col items-center justify-center gap-5 p-8 text-center">
                      <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-background text-foreground">
                        <Workflow className="h-5 w-5" />
                      </span>
                      <div className="max-w-xl space-y-3">
                        <h3 className="text-2xl font-semibold tracking-tight">
                          Run the first question and keep your attention on this panel.
                        </h3>
                        <p className="text-sm leading-7 text-muted-foreground sm:text-base">
                          The right side is now the single place where the answer, the reasoning
                          path, the guardrails, the cost, and the audit views all live.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant="outline">
                Phase 1 scorecard
              </Badge>
              <CardTitle className="text-2xl">Fire the 10 test questions and check the answers</CardTitle>
              <CardDescription className="text-sm leading-6">
                This stays below the main workspace so it is available when you need it, but it does
                not compete with the answer panel.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activeEvaluation ? (
                <div className="rounded-2xl border border-border/70">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Question</TableHead>
                        <TableHead>Expected</TableHead>
                        <TableHead>Actual</TableHead>
                        <TableHead>Result</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeEvaluation.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="max-w-[360px] align-top">
                            <div className="space-y-1">
                              <p className="font-medium">{item.question}</p>
                              <p className="text-xs leading-5 text-muted-foreground">{item.note}</p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">{decisionLabel(item.expectedDecision)}</TableCell>
                          <TableCell className="align-top">
                            <div className="space-y-1">
                              <p>{decisionLabel(item.actualDecision)}</p>
                              <p className="text-xs text-muted-foreground">{item.topSource ?? "No source"}</p>
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge className="rounded-full" variant={statusVariant(item.pass)}>
                              {item.pass ? "Pass" : "Fail"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                  Loading the built-in evaluation suite.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <Badge className="w-fit rounded-full" variant="outline">
                    Phase 5 close
                  </Badge>
                  <CardTitle className="mt-3 text-2xl">Architecture Decision Document</CardTitle>
                  <CardDescription className="mt-2 text-sm leading-6">
                    Keep the ending short: what we chose, what we rejected, and why.
                  </CardDescription>
                </div>
                <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }), "rounded-full")} href="/add">
                  Open full ADD
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                {addSections.map((section) => (
                  <Card className="border-border/70 bg-muted/20 shadow-none" key={section.heading}>
                    <CardContent className="space-y-3 p-5">
                      <Badge
                        className="w-fit rounded-full"
                        variant={
                          section.verdict === "chosen"
                            ? "success"
                            : section.verdict === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {section.heading}
                      </Badge>
                      <p className="text-sm leading-6 text-muted-foreground">{section.body}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Separator />

              <div className="rounded-2xl border border-border/70">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Dimension</TableHead>
                      <TableHead>LangChain RAG</TableHead>
                      <TableHead>LangGraph flow</TableHead>
                      <TableHead>Recommendation</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparisonRows.map((row) => (
                      <TableRow key={row.dimension}>
                        <TableCell className="font-medium">{row.dimension}</TableCell>
                        <TableCell className="text-muted-foreground">{row.chain}</TableCell>
                        <TableCell className="text-muted-foreground">{row.graph}</TableCell>
                        <TableCell className="text-muted-foreground">{row.recommendation}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

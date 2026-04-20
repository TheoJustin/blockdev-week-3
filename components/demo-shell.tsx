"use client";

import { useCallback, useDeferredValue, useEffect, useState, useTransition } from "react";
import { Download, RefreshCw, Sparkles, Workflow } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  DemoMode,
  DemoOverview,
  DemoResult,
  DemoRuntime,
  PresentationPhase,
  StoredAuditRecord,
} from "@/lib/types";

type DemoShellProps = {
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
  steps?: string[];
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

function formatRouteSteps(route: string) {
  return route
    .split("->")
    .map((step) => step.trim())
    .filter(Boolean);
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
  return value === "openai" ? "Live backend" : "Local fallback";
}

function costSummaryValue(cost: DemoResult["cost"]) {
  if (cost.costKind === "none") {
    return "Not billed";
  }

  return formatMoney(cost.per1000);
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

function MetricCard({ description, label, steps, value }: MetricCardProps) {
  return (
    <Card className="border-border/70 bg-muted/25 shadow-none">
      <CardContent className="space-y-2 p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="text-sm leading-6 text-muted-foreground break-words">{description}</p>
        {steps && steps.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {steps.map((step, index) => (
              <div className="flex min-w-0 items-center gap-2" key={`${label}-${step}-${index}`}>
                <span className="rounded-full border border-border/70 bg-background px-3 py-1 text-xs font-medium text-foreground break-all">
                  {step}
                </span>
                {index < steps.length - 1 ? (
                  <span className="text-xs text-muted-foreground" aria-hidden="true">
                    →
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function DemoShell({
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
  const [didChooseRuntime, setDidChooseRuntime] = useState(false);
  const [, startTransition] = useTransition();

  const deferredQuestion = useDeferredValue(question);
  const deferredSourceNotes = useDeferredValue(sourceNotes);

  const refreshAppState = useCallback(async (nextRuntime?: DemoRuntime, nextSourceNotes?: string) => {
    setIsRefreshing(true);

    try {
      const params = new URLSearchParams();

      if (nextRuntime) {
        params.set("runtime", nextRuntime);
      }

      if (nextSourceNotes?.trim()) {
        params.set("sourceNotes", nextSourceNotes);
      }

      const response = await fetch(params.size > 0 ? `/api/demo?${params.toString()}` : "/api/demo");
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

      if (payload.openai?.configured && !didChooseRuntime) {
        setRuntime("openai");
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [didChooseRuntime]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshAppState();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refreshAppState]);

  useEffect(() => {
    if (overview?.status !== "running") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void refreshAppState(runtime, sourceNotes);
    }, 4000);

    return () => window.clearTimeout(timeoutId);
  }, [overview?.status, refreshAppState, runtime, sourceNotes]);

  async function runDemo(nextMode: DemoMode) {
    if (!question.trim()) {
      setError("Add a question before running the workflow.");
      return;
    }

    if (!sourceNotes.trim()) {
      setError("Add at least one source note before running the workflow.");
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
        throw new Error(payload.error ?? "The workflow request failed.");
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
      [
        "mode",
        "component",
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "rate_per_million",
        "subtotal",
        "cost_kind",
        "latency_ms",
        "decision",
        "timestamp",
      ].join(","),
      ...(result.cost.breakdown.length > 0
        ? result.cost.breakdown
        : [
            {
              nodeId: "LOCAL_RUNTIME",
              label: result.runtime === "local" ? "Local runtime" : "No billed model call",
              tokens: 0,
              inputTokens: 0,
              outputTokens: 0,
              ratePerMillion: 0,
              subtotal: result.cost.perInteraction,
            },
          ]).map((item) =>
        [
          result.mode,
          item.label,
          String(item.inputTokens ?? 0),
          String(item.outputTokens ?? 0),
          String(item.tokens),
          String(item.ratePerMillion),
          String(item.subtotal.toFixed(6)),
          result.cost.costKind,
          String(result.cost.latencyMs),
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
  const chainDelta =
    overview?.evaluations.chain ? overview.evaluations.chain.averagePer1000 - overview.slideEstimate.chainPer1000 : 0;
  const graphDelta =
    overview?.evaluations.graph ? overview.evaluations.graph.averagePer1000 - overview.slideEstimate.graphPer1000 : 0;
  const overviewUsesLiveBackend = overview?.source === "live";
  const overviewNote = overview?.notes[0] ?? null;

  const modeDescription =
    mode === "chain"
      ? "Minimal retrieval path: Loader -> splitter -> Pinecone -> RetrievalQA."
      : "The same retrieval path with explicit INPUT_SCREEN, provenance, and AUDIT_LOG nodes.";

  const summaryMetrics = result
    ? [
        {
          label: "Decision",
          value: decisionLabel(result.decision),
          description: result.route.includes("->") ? "Execution route" : result.route,
          steps: result.route.includes("->") ? formatRouteSteps(result.route) : undefined,
        },
        {
          label: result.cost.costKind === "actual" ? "Actual cost per 1,000" : "Model cost",
          value: costSummaryValue(result.cost),
          description: `${result.cost.latencyKind === "measured" ? "Measured" : "Estimated"} latency: ${result.cost.latencyMs} ms`,
        },
        {
          label: "Sources",
          value: String(result.provenance.length),
          description: result.usedSampleNotes ? "Reference corpus" : "Custom source notes",
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
                  Workflow workspace
                </Badge>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                  Run the workflow and inspect the output in one place.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                  Use the left panel to choose the architecture, runtime, and question. Use the
                  right panel to review the answer, source provenance, guardrails, cost, and audit
                  trail without hunting through a long page.
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
                Workflow overview
              </Badge>
              <CardTitle className="text-2xl">Typical run order</CardTitle>
              <CardDescription className="text-sm leading-6">
                Follow the same path an operator would use to inspect a run.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                "Choose the architecture you want to inspect.",
                "Pick local or OpenAI response generation.",
                "Select a saved question or write your own.",
                "Run the workflow and review answer, sources, and audit data.",
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
                    <CardTitle className="mt-3 text-2xl">Configure the run</CardTitle>
                    <CardDescription className="mt-2 text-sm leading-6">
                      Choose an architecture, choose a runtime, select a question, and run the
                      selected workflow.
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
                      description="Minimal retrieval pipeline."
                      onClick={() => setMode("chain")}
                      title="LangChain RAG"
                    />
                    <ChoiceCard
                      active={mode === "graph"}
                      description="Retrieval pipeline with explicit governance nodes."
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
                      description="Runs the local fallback workflow with simulated cost."
                      onClick={() => {
                        setDidChooseRuntime(true);
                        setRuntime("local");
                      }}
                      title="Local response"
                    />
                    <ChoiceCard
                      active={runtime === "openai"}
                      description={openaiConfigured ? `Real LangChain / LangGraph with ${openaiModel}` : "Requires OPENAI_API_KEY"}
                      onClick={() => {
                        setDidChooseRuntime(true);
                        setRuntime("openai");
                      }}
                      title="OpenAI response"
                    />
                  </div>
                  <div className="rounded-2xl border border-border/70 bg-muted/20 px-4 py-4">
                    <p className="text-sm font-medium text-foreground">
                      Runtime status: {openaiConfigured ? "OpenAI available" : "Local-only mode"}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {openaiConfigured
                        ? `Server model: ${openaiModel}. OpenAI mode runs the real LangChain or LangGraph backend.`
                        : "The app still works without OPENAI_API_KEY by using the local fallback workflow instead."}
                    </p>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-foreground">Saved questions</p>
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
                        Optional reference corpus used for retrieval and provenance.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={() => setShowSourceNotes((value) => !value)} size="sm" variant="outline">
                        {showSourceNotes ? "Hide corpus" : "Show corpus"}
                      </Button>
                      <Button onClick={() => setSourceNotes(defaultSourceNotes)} size="sm" variant="outline">
                        Reset corpus
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
                      Source notes stay hidden until you need to inspect or edit the retrieval
                      corpus.
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    className="rounded-full"
                    disabled={isRunning}
                    onClick={() => runDemo(mode)}
                    size="lg"
                  >
                    {isRunning ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Running workflow...
                      </>
                    ) : (
                      `Run ${mode === "chain" ? "LangChain" : "LangGraph"} workflow`
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
                      {result ? "Latest output" : "Run the workflow to generate output"}
                    </CardTitle>
                    <CardDescription className="mt-2 max-w-2xl text-sm leading-6">
                      The answer, evidence, controls, and audit trail stay together in one place.
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
                      <Badge className="rounded-full" variant="outline">
                        {result.implementation.engine === "langgraph"
                          ? "Real LangGraph"
                          : result.implementation.engine === "langchain"
                            ? "Real LangChain"
                            : "Simulated engine"}
                      </Badge>
                      <Badge className="rounded-full" variant="outline">
                        {result.implementation.vectorStore === "pinecone"
                          ? "Pinecone"
                          : result.implementation.vectorStore === "in_memory"
                            ? "In-memory index"
                            : "Simulated retrieval"}
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
                              Primary response returned by the workflow.
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
                              <CardTitle className="text-lg">Answer summary</CardTitle>
                              <CardDescription className="text-sm leading-6">
                                Short explanation of the route, evidence, and decision.
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
                              <CardTitle className="text-lg">Operator note</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <div className="rounded-2xl border border-border/70 bg-background px-4 py-4 text-sm leading-7 text-muted-foreground">
                                {result.speakerTip.replace(/^Talk track:\s*/i, "")}
                              </div>
                            </CardContent>
                          </Card>

                          <Card className="border-border/70 bg-muted/20 shadow-none">
                            <CardHeader>
                              <CardTitle className="text-lg">Runtime status</CardTitle>
                              <CardDescription className="text-sm leading-6">
                                This tells you exactly what was real in the run.
                              </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              {result.implementation.notes.map((note) => (
                                <div
                                  className="rounded-2xl border border-border/70 bg-background px-4 py-3 text-sm leading-6 text-muted-foreground"
                                  key={note}
                                >
                                  {note}
                                </div>
                              ))}
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
                              Inspect how the request moved through the system step by step.
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
                                  ? "The system retrieved the sensitive text, but release still stopped before the response left the workflow."
                                  : "Use the canary scenario when you want to confirm that release is blocked even if retrieval succeeds."}
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
                            description="Presentation deck estimate"
                            label="Chain estimate"
                            value={overview ? formatMoney(overview.slideEstimate.chainPer1000) : "--"}
                          />
                          <MetricCard
                            description="Presentation deck estimate"
                            label="Graph estimate"
                            value={overview ? formatMoney(overview.slideEstimate.graphPer1000) : "--"}
                          />
                          <MetricCard
                            description={overviewUsesLiveBackend ? "Live suite delta versus the deck estimate" : "Local fallback delta versus the deck estimate"}
                            label="Chain delta"
                            value={overview?.evaluations.chain ? formatDelta(chainDelta) : "--"}
                          />
                          <MetricCard
                            description={overviewUsesLiveBackend ? "Live suite delta versus the deck estimate" : "Local fallback delta versus the deck estimate"}
                            label="Graph delta"
                            value={overview?.evaluations.graph ? formatDelta(graphDelta) : "--"}
                          />
                        </div>

                        <Card className="border-border/70 bg-muted/20 shadow-none">
                          <CardHeader>
                            <CardTitle className="text-lg">Billable components</CardTitle>
                            <CardDescription className="text-sm leading-6">
                              {result.cost.costKind === "actual"
                                ? "This table shows the billable embedding and model calls from the current run."
                                : result.cost.costKind === "none"
                                  ? "This run did not make a billable external model call."
                                  : "Pricing is still simulated because the current model does not have configured live rates."}
                            </CardDescription>
                          </CardHeader>
                          <CardContent>
                            {result.cost.breakdown.length > 0 ? (
                              <div className="rounded-2xl border border-border/70 bg-background">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Component</TableHead>
                                      <TableHead>Input</TableHead>
                                      <TableHead>Output</TableHead>
                                      <TableHead>Total</TableHead>
                                      <TableHead>Subtotal</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {result.cost.breakdown.map((item) => (
                                      <TableRow key={item.nodeId}>
                                        <TableCell className="font-medium">{item.label}</TableCell>
                                        <TableCell>{item.inputTokens ?? "--"}</TableCell>
                                        <TableCell>{item.outputTokens ?? "--"}</TableCell>
                                        <TableCell>{item.tokens}</TableCell>
                                        <TableCell>{formatMoney(item.subtotal)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-sm text-muted-foreground">
                                {result.runtime === "local"
                                  ? "Local mode uses the fallback workflow, so there is no external model bill for this run."
                                  : "This run did not produce a billable OpenAI usage record."}
                              </div>
                            )}
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
                                  Review the recent run history written by the audit trail.
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
                                Run the workflow once and the audit history will appear here.
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

        <section className="grid gap-6">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant={overviewUsesLiveBackend ? "secondary" : "outline"}>
                Phase 1 scorecard
              </Badge>
              <CardTitle className="text-2xl">Fire the 10 test questions and check the answers</CardTitle>
              <CardDescription className="text-sm leading-6">
                {overview?.status === "running"
                  ? "The live evaluation suite is running in the background. The table updates automatically when it finishes."
                  : "Keep the evaluation table below the main workspace so the primary run stays easy to follow."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {overviewNote ? (
                <div className="mb-4 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm leading-6 text-muted-foreground">
                  {overviewNote}
                </div>
              ) : null}

              {activeEvaluation ? (
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
                    <MetricCard
                      description={overviewUsesLiveBackend ? "Measured pass rate from the live suite" : "Pass rate from the local fallback suite"}
                      label="Accuracy"
                      value={`${activeEvaluation.accuracy}%`}
                    />
                    <MetricCard
                      description="Average cost per 1,000 questions in this suite"
                      label="Average cost"
                      value={formatMoney(activeEvaluation.averagePer1000)}
                    />
                    <MetricCard
                      description="Average latency across the evaluation questions"
                      label="Average latency"
                      value={`${activeEvaluation.averageLatencyMs} ms`}
                    />
                  </div>

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
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
                  {overview?.status === "error"
                    ? overview.notes.join(" ")
                    : overview?.status === "running"
                      ? "Running the live evaluation suite now."
                      : "Loading the evaluation suite."}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

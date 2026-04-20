import { NextResponse } from "next/server";
import { appendAuditRecord, readRecentAuditRecords } from "@/lib/audit-store";
import { buildDemoOverview, runChainDemo, runGraphDemo } from "@/lib/demo-engine";
import { getLiveOverviewSnapshot, liveRuntimeStatus, runLiveDemo } from "@/lib/live-runtime";
import { applyObservedRunMetrics } from "@/lib/runtime-cost";
import type { DemoMode, DemoRuntime } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const runtimeParam = searchParams.get("runtime");
  const sourceNotes = searchParams.get("sourceNotes") ?? "";
  const runtimeStatus = liveRuntimeStatus();
  const selectedRuntime =
    runtimeParam === "local" || runtimeParam === "openai"
      ? runtimeParam
      : runtimeStatus.configured
        ? "openai"
        : "local";
  const recent = await readRecentAuditRecords();

  return NextResponse.json({
    recent,
    openai: runtimeStatus,
    overview:
      selectedRuntime === "openai" && runtimeStatus.configured
        ? getLiveOverviewSnapshot(sourceNotes)
        : buildDemoOverview(sourceNotes),
  });
}

export async function POST(request: Request) {
  const startedAt = performance.now();

  try {
    const body = (await request.json()) as {
      question?: string;
      mode?: DemoMode;
      runtime?: DemoRuntime;
      sourceNotes?: string;
    };

    const question = body.question?.trim();
    const mode = body.mode ?? "chain";
    const runtime = body.runtime ?? "local";
    const sourceNotes = body.sourceNotes ?? "";

    if (!question) {
      return NextResponse.json({ error: "Question is required." }, { status: 400 });
    }

    const rawResult =
      runtime === "openai"
        ? await runLiveDemo(mode, question, sourceNotes)
        : mode === "graph"
          ? runGraphDemo(question, sourceNotes, runtime)
          : runChainDemo(question, sourceNotes, runtime);
    const result = applyObservedRunMetrics(rawResult, performance.now() - startedAt);
    const auditRecord = await appendAuditRecord(result);
    const recent = await readRecentAuditRecords();

    return NextResponse.json({
      result,
      auditRecord,
      recent,
      overview: runtime === "openai" ? getLiveOverviewSnapshot(sourceNotes) : buildDemoOverview(sourceNotes),
    });
  } catch {
    return NextResponse.json({ error: "Unable to run the demo flow." }, { status: 500 });
  }
}

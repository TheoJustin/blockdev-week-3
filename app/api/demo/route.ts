import { NextResponse } from "next/server";
import { appendAuditRecord, readRecentAuditRecords } from "@/lib/audit-store";
import { buildDemoOverview, runChainDemo, runGraphDemo } from "@/lib/demo-engine";
import { addOpenAIExplanation, openAIStatus } from "@/lib/openai-explainer";
import type { DemoMode, DemoRuntime } from "@/lib/types";

export async function GET() {
  const recent = await readRecentAuditRecords();
  return NextResponse.json({
    recent,
    openai: openAIStatus(),
    overview: buildDemoOverview(),
  });
}

export async function POST(request: Request) {
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

    const baseResult =
      mode === "graph"
        ? runGraphDemo(question, sourceNotes, runtime)
        : runChainDemo(question, sourceNotes, runtime);

    const result = runtime === "openai" ? await addOpenAIExplanation(baseResult) : baseResult;
    const auditRecord = await appendAuditRecord(result);
    const recent = await readRecentAuditRecords();

    return NextResponse.json({
      result,
      auditRecord,
      recent,
      overview: buildDemoOverview(sourceNotes),
    });
  } catch {
    return NextResponse.json({ error: "Unable to run the demo flow." }, { status: 500 });
  }
}

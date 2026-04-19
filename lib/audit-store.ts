import { promises as fs } from "node:fs";
import path from "node:path";
import type { DemoResult, StoredAuditRecord } from "@/lib/types";

const auditDirectory = path.join(process.cwd(), "data");
const auditFile = path.join(auditDirectory, "audit-log.jsonl");

async function ensureAuditPath() {
  await fs.mkdir(auditDirectory, { recursive: true });
}

export async function appendAuditRecord(result: DemoResult) {
  await ensureAuditPath();

  const record: StoredAuditRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    mode: result.mode,
    runtime: result.runtime,
    question: result.question,
    decision: result.decision,
    guardrailStatus: result.guardrails.status,
    sourceCount: result.sourceCount,
    usedSampleNotes: result.usedSampleNotes,
    sources: result.provenance.map((item) => item.title),
  };

  await fs.appendFile(auditFile, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export async function readRecentAuditRecords(limit = 6) {
  try {
    const content = await fs.readFile(auditFile, "utf8");
    return content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parsed = JSON.parse(line) as Partial<StoredAuditRecord>;

        return {
          id: parsed.id ?? crypto.randomUUID(),
          createdAt: parsed.createdAt ?? new Date().toISOString(),
          mode: parsed.mode ?? "chain",
          runtime: parsed.runtime ?? "local",
          question: parsed.question ?? "Unknown question",
          decision: parsed.decision ?? "review",
          guardrailStatus: parsed.guardrailStatus ?? "allow",
          sourceCount: parsed.sourceCount ?? parsed.sources?.length ?? 0,
          usedSampleNotes: parsed.usedSampleNotes ?? false,
          sources: parsed.sources ?? [],
        } satisfies StoredAuditRecord;
      })
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

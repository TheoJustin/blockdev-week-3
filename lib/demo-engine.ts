import { evaluationQuestions, sampleKnowledgeBase, sampleSourceNotes, slideEstimate } from "@/lib/demo-data";
import type {
  AuditEvent,
  CostEstimate,
  CostLineItem,
  Decision,
  DemoMode,
  DemoOverview,
  DemoResult,
  DemoRuntime,
  EvalCase,
  EvaluationReport,
  GraphState,
  GuardCheck,
  GuardrailResult,
  KnowledgeChunk,
  KnowledgeDocument,
  PipelineNode,
  ProvenanceItem,
  Sensitivity,
} from "@/lib/types";

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "can",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "of",
  "on",
  "or",
  "our",
  "should",
  "the",
  "to",
  "we",
  "what",
  "when",
  "with",
]);

const inputPricePerMillion = 3;
const retrievalStepPricePerMillion = 0.1;

function normalizeBlock(text: string) {
  return text.trim().replace(/\r/g, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
}

function normalizeQuestion(question: string) {
  return question.trim().replace(/\s+/g, " ");
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token));
}

function tokenCount(text: string) {
  return Math.max(24, Math.round(tokenize(text).length * 1.5));
}

function shortSummary(body: string) {
  const firstSentence = body.split(/(?<=[.!?])\s+/)[0] ?? body;
  return firstSentence.trim().slice(0, 180);
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function inferSensitivity(text: string): Sensitivity {
  if (/(api key|password|secret|canary|token|customer data|personal data)/i.test(text)) {
    return "sensitive";
  }

  if (/(audit|review|approval|policy|internal|graph)/i.test(text)) {
    return "team";
  }

  return "open";
}

function uniqueTags(title: string, body: string) {
  const counts = new Map<string, number>();

  for (const token of tokenize(`${title} ${body}`)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([token]) => token);
}

function makeDocument(title: string, body: string, index: number): KnowledgeDocument {
  const cleanTitle = title.trim() || `Note ${index + 1}`;
  const cleanBody = body.trim();

  return {
    id: `${slugify(cleanTitle) || `note-${index + 1}`}-${index + 1}`,
    title: cleanTitle,
    source: `notes/${index + 1}.md`,
    sensitivity: inferSensitivity(`${cleanTitle}\n${cleanBody}`),
    tags: uniqueTags(cleanTitle, cleanBody),
    summary: shortSummary(cleanBody),
    body: cleanBody,
  };
}

function parseSourceNotes(sourceNotes?: string) {
  const normalized = normalizeBlock(sourceNotes ?? "");
  const usesSample = !normalized || normalized === normalizeBlock(sampleSourceNotes);

  if (usesSample) {
    return {
      documents: sampleKnowledgeBase,
      usedSampleNotes: true,
    };
  }

  const headingMatches = [...normalized.matchAll(/^##\s+(.+)$/gm)];

  if (headingMatches.length === 0) {
    return {
      documents: [makeDocument("Pasted notes", normalized, 0)],
      usedSampleNotes: false,
    };
  }

  const documents = headingMatches
    .map((match, index) => {
      const title = match[1] ?? `Note ${index + 1}`;
      const start = match.index ?? 0;
      const bodyStart = start + match[0].length;
      const end = headingMatches[index + 1]?.index ?? normalized.length;
      const body = normalized.slice(bodyStart, end).trim();

      return makeDocument(title, body, index);
    })
    .filter((document) => document.body);

  return {
    documents: documents.length > 0 ? documents : [makeDocument("Pasted notes", normalized, 0)],
    usedSampleNotes: false,
  };
}

function splitDocuments(documents: KnowledgeDocument[]) {
  return documents.flatMap((document) => {
    const sentences = document.body.split(/(?<=[.!?])\s+/).filter(Boolean);
    const chunks: KnowledgeChunk[] = [];

    for (let index = 0; index < sentences.length; index += 2) {
      const body = sentences.slice(index, index + 2).join(" ").trim();

      if (!body) {
        continue;
      }

      chunks.push({
        id: `${document.id}-chunk-${chunks.length + 1}`,
        documentId: document.id,
        title: document.title,
        source: document.source,
        sensitivity: document.sensitivity,
        tags: document.tags,
        chunkIndex: chunks.length,
        body,
        summary: shortSummary(body),
      });
    }

    return chunks.length > 0
      ? chunks
      : [
          {
            id: `${document.id}-chunk-1`,
            documentId: document.id,
            title: document.title,
            source: document.source,
            sensitivity: document.sensitivity,
            tags: document.tags,
            chunkIndex: 0,
            body: document.body,
            summary: document.summary,
          },
        ];
  });
}

function scoreChunk(question: string, chunk: KnowledgeChunk) {
  const queryTokens = tokenize(question);
  const chunkTokens = new Set(tokenize([chunk.title, chunk.summary, chunk.body, chunk.tags.join(" ")].join(" ")));

  let score = 0;

  for (const token of queryTokens) {
    if (chunkTokens.has(token)) {
      score += 3;
    }
  }

  if (/(langchain|rag|retrievalqa)/i.test(question) && /(langchain|rag|retrievalqa)/i.test(chunk.body)) {
    score += 5;
  }

  if (/(pinecone|split|chunk)/i.test(question) && /(pinecone|split|chunk)/i.test(chunk.body)) {
    score += 5;
  }

  if (/(langgraph|input_screen|audit_log|provenance)/i.test(question) && /(langgraph|input_screen|audit_log|provenance)/i.test(chunk.body)) {
    score += 6;
  }

  if (/(exception|override|review)/i.test(question) && /(exception|override|review)/i.test(chunk.body)) {
    score += 6;
  }

  if (/(canary|leak)/i.test(question) && /(canary|leak)/i.test(chunk.body)) {
    score += 7;
  }

  if (/(api key|secret|password)/i.test(question) && /(api key|secret|password)/i.test(chunk.body)) {
    score += 8;
  }

  return score;
}

function excerptFromChunk(chunk: KnowledgeChunk, question: string) {
  const queryTokens = tokenize(question);
  const sentences = chunk.body.split(/(?<=[.!?])\s+/);

  const bestSentence =
    sentences.find((sentence) => queryTokens.some((token) => sentence.toLowerCase().includes(token))) ?? chunk.summary;

  return bestSentence.trim();
}

function retrieveChunks(question: string, chunks: KnowledgeChunk[]) {
  return chunks
    .map((chunk) => ({
      id: chunk.id,
      title: chunk.title,
      source: chunk.source,
      sensitivity: chunk.sensitivity,
      tags: chunk.tags,
      score: scoreChunk(question, chunk),
      excerpt: excerptFromChunk(chunk, question),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 3);
}

function redactSensitiveText(question: string) {
  return question
    .replace(/\b\d{3}-?\d{2}-?\d{4}\b/g, "[REDACTED-SSN]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED-EMAIL]");
}

function inputGuard(question: string): GuardCheck {
  const reasons: string[] = [];
  const redactions: string[] = [];
  const triggeredRules: string[] = [];

  const asksForSensitiveData =
    /(show|share|reveal|give|display).*(api key|password|secret|session token|recovery code)/i.test(question) ||
    /(customer|user|account).*(api key|password|secret|session token|recovery code)/i.test(question);

  const containsRawPii =
    /\b\d{3}-?\d{2}-?\d{4}\b/.test(question) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(question);

  const asksForException = /(override|exception|bypass|ignore the rule|approve anyway)/i.test(question);

  if (asksForSensitiveData) {
    reasons.push("The request asks for a raw secret or sensitive customer data.");
    triggeredRules.push("sensitive_data_request");
  }

  if (containsRawPii) {
    reasons.push("The request contains raw personal data that should be redacted.");
    redactions.push("Redact personal data before saving or forwarding this request.");
    triggeredRules.push("pii_redaction");
  }

  if (asksForException) {
    reasons.push("The request asks for a policy exception and should route to review.");
    triggeredRules.push("human_review");
  }

  if (asksForSensitiveData) {
    return {
      name: "InputGuard",
      status: "block",
      reasons,
      redactions,
      triggeredRules,
      checkedText: question,
    };
  }

  if (containsRawPii) {
    return {
      name: "InputGuard",
      status: "redact",
      reasons,
      redactions,
      triggeredRules,
      checkedText: redactSensitiveText(question),
    };
  }

  return {
    name: "InputGuard",
    status: "allow",
    reasons: reasons.length > 0 ? reasons : ["No prompt-level privacy violation was detected."],
    redactions,
    triggeredRules,
    checkedText: question,
  };
}

function outputGuard(answer: string): GuardCheck {
  const reasons: string[] = [];
  const redactions: string[] = [];
  const triggeredRules: string[] = [];

  const hasCanary = /CANARY-LEAK-9X4Q/i.test(answer);
  const hasRawSecret = /\b(sk|pk|tok|key)_[a-z0-9_-]{8,}\b/i.test(answer);

  if (hasCanary) {
    reasons.push("The draft contains the canary leak string and must not be released.");
    triggeredRules.push("canary_leak");
  }

  if (hasRawSecret) {
    reasons.push("The draft appears to contain a raw credential-like value.");
    redactions.push("Remove the credential before release.");
    triggeredRules.push("credential_output");
  }

  if (hasCanary || hasRawSecret) {
    return {
      name: "OutputGuard",
      status: "block",
      reasons,
      redactions,
      triggeredRules,
      checkedText: answer,
    };
  }

  return {
    name: "OutputGuard",
    status: "allow",
    reasons: ["No release-time secret or canary leak was detected."],
    redactions,
    triggeredRules,
    checkedText: answer,
  };
}

function event(stage: string, detail: string): AuditEvent {
  return {
    stage,
    detail,
    timestamp: new Date().toISOString(),
  };
}

function lineItem(nodeId: string, label: string, tokens: number, ratePerMillion: number): CostLineItem {
  return {
    nodeId,
    label,
    tokens,
    ratePerMillion,
    subtotal: Number(((tokens / 1_000_000) * ratePerMillion).toFixed(4)),
  };
}

function sumCost(items: CostLineItem[]) {
  return items.reduce((total, item) => total + item.subtotal, 0);
}

function strongestSourceLine(provenance: ProvenanceItem[]) {
  if (provenance.length === 0) {
    return "No strong supporting chunk was found for this question.";
  }

  const topSource = provenance[0];
  return `The clearest supporting note is "${topSource.title}". It says: ${topSource.excerpt}`;
}

function buildDraftAnswer(mode: DemoMode, decision: Decision, provenance: ProvenanceItem[], question: string) {
  if (decision === "block") {
    return "This request should be blocked because it asks for protected data or fails a release guard.";
  }

  if (decision === "review") {
    return "This request should go to human review because it asks for an exception or the evidence is too weak for an automatic answer.";
  }

  if (mode === "chain") {
    return `The minimal LangChain path works here: load the notes, split them into chunks, index them in Pinecone, and use RetrievalQA to answer from the best matches. ${strongestSourceLine(provenance)}`;
  }

  if (/(which architecture did the add choose|what did it reject)/i.test(question)) {
    return `The ADD chooses a hybrid architecture: LangChain RAG for low-risk retrieval questions and LangGraph for higher-risk governance flows. It rejects a graph-only approach for every interaction because that adds unnecessary complexity. ${strongestSourceLine(provenance)}`;
  }

  return `The LangGraph version keeps the same retrieval core but adds explicit governance nodes. INPUT_SCREEN checks the request, provenance stays in state, DECIDE_ROUTE chooses the outcome, and AUDIT_LOG records what happened. ${strongestSourceLine(provenance)}`;
}

function buildTakeaways(mode: DemoMode, decision: Decision, guardrails: GuardrailResult) {
  const common = [
    "The same source pack powers both architectures, so the comparison stays fair.",
    "Sources and guardrails stay visible, which makes the demo easier to defend.",
  ];

  if (decision === "block") {
    return [
      "The system is more trustworthy because it blocks unsafe behavior before release.",
      "The canary drill proves the output guard is doing real work, not just decorative logging.",
      ...common,
    ];
  }

  if (mode === "chain") {
    return [
      "Phase 1 is intentionally small so the audience can understand RAG from scratch.",
      "Loader, splitter, Pinecone, and RetrievalQA are enough for routine grounded questions.",
      guardrails.status === "allow"
        ? "Guardrails still wrap the chain, but they do not need a full graph for low-risk requests."
        : "Even the simple chain benefits from the same guardrails and audit format.",
      ...common,
    ];
  }

  return [
    "Phase 2 reuses the same retrieval core instead of rebuilding the whole system.",
    "The graph makes INPUT_SCREEN, provenance, and AUDIT_LOG visible product steps.",
    decision === "review"
      ? "Routing to review is now an explicit branch, not hidden helper logic."
      : "The graph pays extra cost so governance decisions are visible and inspectable.",
    ...common,
  ];
}

function buildSpeakerTip(mode: DemoMode, decision: Decision, canaryScenario: boolean) {
  if (canaryScenario) {
    return "Talk track: the model found the canary, but OutputGuard blocked the release, which is exactly what we want in production.";
  }

  if (decision === "block") {
    return "Talk track: a production assistant is useful because it refuses unsafe requests, not because it answers everything.";
  }

  if (decision === "review") {
    return "Talk track: the graph earns its keep when the product needs an explicit review branch.";
  }

  return mode === "chain"
    ? "Talk track: Phase 1 is the smallest believable RAG system you can explain in one minute."
    : "Talk track: Phase 2 keeps the same retrieval engine but makes governance visible in state.";
}

function nodeStatusFromDecision(decision: Decision) {
  if (decision === "block") {
    return "blocked" as const;
  }

  if (decision === "review") {
    return "warning" as const;
  }

  return "completed" as const;
}

function pipelineNode(
  id: string,
  label: string,
  kind: PipelineNode["kind"],
  status: PipelineNode["status"],
  description: string,
  tokens: number,
  ratePerMillion: number,
  output?: string,
): PipelineNode {
  return {
    id,
    label,
    kind,
    status,
    description,
    output,
    estimatedTokens: tokens,
    estimatedCost: Number(((tokens / 1_000_000) * ratePerMillion).toFixed(4)),
  };
}

function buildCostEstimate(nodes: PipelineNode[], mode: DemoMode, decision: Decision): CostEstimate {
  const breakdown = nodes.map((node) =>
    lineItem(
      node.id,
      node.label,
      node.estimatedTokens,
      node.kind === "retrieval" || node.kind === "storage" || node.kind === "audit"
        ? retrievalStepPricePerMillion
        : inputPricePerMillion,
    ),
  );

  const perInteraction = Number(sumCost(breakdown).toFixed(4));

  return {
    perInteraction,
    per1000: Number((perInteraction * 1000).toFixed(2)),
    latencyMs: mode === "chain" ? 1100 + nodes.length * 65 : (decision === "block" ? 1450 : 1900) + nodes.length * 75,
    breakdown,
    assumptions: [
      "These are teaching estimates, not vendor invoices.",
      "The chain model treats retrieval and answer generation as the main cost centers.",
      mode === "chain"
        ? "The chain stays cheaper because it has fewer explicit decision nodes."
        : "The graph costs more because screening, provenance, and audit are explicit nodes.",
    ],
  };
}

function buildChainPipeline(
  documents: KnowledgeDocument[],
  chunks: KnowledgeChunk[],
  provenance: ProvenanceItem[],
  input: GuardCheck,
  output: GuardCheck,
  decision: Decision,
  answer: string,
) {
  const questionTokens = tokenCount(input.checkedText);
  const contextTokens = provenance.reduce((total, item) => total + tokenCount(item.excerpt), 0);

  return [
    pipelineNode(
      "INPUT_GUARD",
      "InputGuard",
      "governance",
      input.status === "block" ? "blocked" : input.status === "redact" ? "warning" : "completed",
      "Screen the request for secrets, raw personal data, and risky exception language.",
      questionTokens + 40,
      inputPricePerMillion,
      input.reasons.join(" "),
    ),
    pipelineNode(
      "DOC_LOADER",
      "Loader",
      "input",
      "completed",
      "Load the support corpus and policy notes for the retrieval path.",
      Math.max(60, documents.length * 28),
      retrievalStepPricePerMillion,
      `${documents.length} source documents loaded.`,
    ),
    pipelineNode(
      "TEXT_SPLITTER",
      "Splitter",
      "retrieval",
      "completed",
      "Split long notes into smaller chunks so retrieval stays grounded.",
      Math.max(48, chunks.length * 18),
      retrievalStepPricePerMillion,
      `${chunks.length} chunks created.`,
    ),
    pipelineNode(
      "PINECONE_INDEX",
      "Pinecone",
      "storage",
      "completed",
      "Store the chunks in the vector index used for retrieval.",
      Math.max(72, chunks.length * 30),
      retrievalStepPricePerMillion,
      `${chunks.length} chunks indexed.`,
    ),
    pipelineNode(
      "RETRIEVAL_QA",
      "RetrievalQA",
      "reasoning",
      provenance.length > 0 ? nodeStatusFromDecision(decision) : "warning",
      "Retrieve the best chunks and write one grounded answer from them.",
      questionTokens + contextTokens + 210,
      inputPricePerMillion,
      answer,
    ),
    pipelineNode(
      "OUTPUT_GUARD",
      "OutputGuard",
      "output",
      output.status === "block" ? "blocked" : "completed",
      "Inspect the draft before release and block canary or secret leakage.",
      tokenCount(answer) + 60,
      inputPricePerMillion,
      output.reasons.join(" "),
    ),
    pipelineNode(
      "AUDIT_LOG",
      "Audit Log",
      "audit",
      "completed",
      "Save the question, sources, decision, and timing for later review.",
      84,
      retrievalStepPricePerMillion,
      "Run metadata saved.",
    ),
  ];
}

function buildGraphPipeline(
  documents: KnowledgeDocument[],
  chunks: KnowledgeChunk[],
  provenance: ProvenanceItem[],
  input: GuardCheck,
  output: GuardCheck,
  decision: Decision,
  answer: string,
) {
  const questionTokens = tokenCount(input.checkedText);
  const contextTokens = provenance.reduce((total, item) => total + tokenCount(item.excerpt), 0);

  return [
    pipelineNode(
      "INPUT_SCREEN",
      "INPUT_SCREEN",
      "governance",
      input.status === "block" ? "blocked" : input.status === "redact" ? "warning" : "completed",
      "Start the graph with a typed state object and screen the request before retrieval.",
      questionTokens + 55,
      inputPricePerMillion,
      input.reasons.join(" "),
    ),
    pipelineNode(
      "DOC_LOADER",
      "DOC_LOADER",
      "input",
      "completed",
      "Load the same support corpus used by the chain version.",
      Math.max(60, documents.length * 28),
      retrievalStepPricePerMillion,
      `${documents.length} source documents loaded.`,
    ),
    pipelineNode(
      "TEXT_SPLITTER",
      "TEXT_SPLITTER",
      "retrieval",
      "completed",
      "Split documents into chunks before vector lookup.",
      Math.max(48, chunks.length * 18),
      retrievalStepPricePerMillion,
      `${chunks.length} chunks created.`,
    ),
    pipelineNode(
      "PINECONE_INDEX",
      "PINECONE_INDEX",
      "storage",
      "completed",
      "Reuse the vector index for graph retrieval.",
      Math.max(72, chunks.length * 30),
      retrievalStepPricePerMillion,
      `${chunks.length} chunks indexed.`,
    ),
    pipelineNode(
      "RETRIEVE_CONTEXT",
      "RETRIEVE_CONTEXT",
      "retrieval",
      provenance.length > 0 ? "completed" : "warning",
      "Pull the best evidence package for the current question.",
      questionTokens + contextTokens + 110,
      inputPricePerMillion,
      provenance.length > 0 ? provenance.map((item) => item.title).join(", ") : "No strong evidence package found.",
    ),
    pipelineNode(
      "PROVENANCE_ATTACH",
      "PROVENANCE_ATTACH",
      "provenance",
      provenance.length > 0 ? "completed" : "warning",
      "Attach the supporting notes directly to graph state before deciding.",
      Math.max(60, provenance.length * 32),
      inputPricePerMillion,
      provenance.length > 0 ? `${provenance.length} evidence chunks attached.` : "No provenance attached.",
    ),
    pipelineNode(
      "DECIDE_ROUTE",
      "DECIDE_ROUTE",
      "governance",
      nodeStatusFromDecision(decision),
      "Choose answer, review, redact, or block from explicit state.",
      questionTokens + 130,
      inputPricePerMillion,
      decision === "review" ? "Sent to review." : decision === "block" ? "Blocked." : "Approved to continue.",
    ),
    pipelineNode(
      "DRAFT_ANSWER",
      "DRAFT_ANSWER",
      "reasoning",
      decision === "block" ? "blocked" : decision === "review" ? "warning" : "completed",
      "Draft the grounded answer after the route decision is known.",
      questionTokens + contextTokens + 240,
      inputPricePerMillion,
      answer,
    ),
    pipelineNode(
      "OUTPUT_GUARD",
      "OUTPUT_GUARD",
      "output",
      output.status === "block" ? "blocked" : "completed",
      "Inspect the draft for canary leaks or credential-like output before release.",
      tokenCount(answer) + 75,
      inputPricePerMillion,
      output.reasons.join(" "),
    ),
    pipelineNode(
      "AUDIT_LOG",
      "AUDIT_LOG",
      "audit",
      "completed",
      "Persist the run trail from typed state so the team can review it later.",
      96,
      retrievalStepPricePerMillion,
      "Typed state snapshot saved.",
    ),
  ];
}

function mergeGuardrails(input: GuardCheck, output: GuardCheck): GuardrailResult {
  const status = input.status === "block" || output.status === "block" ? "block" : input.status === "redact" ? "redact" : "allow";

  return {
    status,
    reasons: [...input.reasons, ...output.reasons],
    redactions: [...input.redactions, ...output.redactions],
    piiDetected: input.triggeredRules.includes("pii_redaction"),
    requestedSensitiveData: input.triggeredRules.includes("sensitive_data_request"),
    canaryTriggered: output.triggeredRules.includes("canary_leak"),
    input,
    output,
  };
}

function buildGraphState(
  question: string,
  safeQuestion: string,
  input: GuardCheck,
  provenance: ProvenanceItem[],
  decision: Decision,
): GraphState {
  return {
    stateType: "Typed state object (the TypeScript equivalent of a TypedDict-style graph state)",
    question,
    safeQuestion,
    inputScreen: input.status,
    retrievedSources: provenance.map((item) => item.title),
    provenanceAttached: provenance.length > 0,
    decision,
    auditLogFields: ["question", "mode", "decision", "sources", "guardrails", "latency", "timestamp"],
  };
}

function prepareBase(question: string, sourceNotes?: string) {
  const normalizedQuestion = normalizeQuestion(question);
  const { documents, usedSampleNotes } = parseSourceNotes(sourceNotes);
  const chunks = splitDocuments(documents);
  const input = inputGuard(normalizedQuestion);
  const safeQuestion = input.status === "redact" ? redactSensitiveText(normalizedQuestion) : normalizedQuestion;
  const provenance = retrieveChunks(safeQuestion, chunks);
  const asksForException = input.triggeredRules.includes("human_review");
  const canaryScenario = /canary leak|exact string.*canary|canary.*string/i.test(normalizedQuestion);

  return {
    documents,
    chunks,
    input,
    normalizedQuestion,
    provenance,
    safeQuestion,
    asksForException,
    canaryScenario,
    usedSampleNotes,
  };
}

function finalizeResult(
  mode: DemoMode,
  runtime: DemoRuntime,
  question: string,
  normalizedQuestion: string,
  answer: string,
  decision: Decision,
  route: string,
  documents: KnowledgeDocument[],
  chunks: KnowledgeChunk[],
  provenance: ProvenanceItem[],
  input: GuardCheck,
  usedSampleNotes: boolean,
  canaryScenario: boolean,
): DemoResult {
  const output = outputGuard(answer);
  const finalDecision = output.status === "block" ? "block" : decision;
  const finalRoute = output.status === "block" ? "Blocked by OutputGuard" : route;
  const finalAnswer =
    output.status === "block"
      ? "The draft was stopped before release because OutputGuard detected sensitive output. In this demo that usually means the canary leak drill worked as intended."
      : answer;

  const pipeline =
    mode === "chain"
      ? buildChainPipeline(documents, chunks, provenance, input, output, finalDecision, finalAnswer)
      : buildGraphPipeline(documents, chunks, provenance, input, output, finalDecision, finalAnswer);

  const cost = buildCostEstimate(pipeline, mode, finalDecision);
  const guardrails = mergeGuardrails(input, output);

  return {
    mode,
    runtime,
    question,
    normalizedQuestion,
    answer: finalAnswer,
    decision: finalDecision,
    route: finalRoute,
    guardrails,
    provenance,
    audit: [
      event(mode === "graph" ? "INPUT_SCREEN" : "InputGuard", "Screened the request before release."),
      event("RETRIEVE_CONTEXT", `Matched ${provenance.length} supporting chunks.`),
      event("OUTPUT_GUARD", output.status === "block" ? "Blocked the draft before release." : "Approved the draft for release."),
      event(mode === "graph" ? "AUDIT_LOG" : "Audit Log", "Saved the run summary."),
    ],
    pipeline,
    cost,
    takeaways: buildTakeaways(mode, finalDecision, guardrails),
    speakerTip: buildSpeakerTip(mode, finalDecision, canaryScenario),
    sourceCount: documents.length,
    usedSampleNotes,
    generatedAt: new Date().toISOString(),
    canaryScenario,
    graphState: mode === "graph" ? buildGraphState(question, normalizedQuestion, input, provenance, finalDecision) : null,
  };
}

export function runChainDemo(question: string, sourceNotes?: string, runtime: DemoRuntime = "local"): DemoResult {
  const { documents, chunks, input, provenance, safeQuestion, asksForException, canaryScenario, usedSampleNotes } =
    prepareBase(question, sourceNotes);

  let decision: Decision = "answer";
  let route = "Loader -> Splitter -> Pinecone -> RetrievalQA";

  if (input.status === "block") {
    decision = "block";
    route = "Blocked by InputGuard";
  } else if (asksForException) {
    decision = "review";
    route = "Stopped for policy review";
  } else if (input.status === "redact") {
    decision = "answer_with_redaction";
    route = "Redacted prompt before answer";
  } else if (provenance.length === 0) {
    decision = "review";
    route = "Stopped because retrieval evidence was weak";
  }

  const answer = buildDraftAnswer("chain", decision, provenance, safeQuestion);

  return finalizeResult(
    "chain",
    runtime,
    question,
    safeQuestion,
    answer,
    decision,
    route,
    documents,
    chunks,
    provenance,
    input,
    usedSampleNotes,
    canaryScenario,
  );
}

export function runGraphDemo(question: string, sourceNotes?: string, runtime: DemoRuntime = "local"): DemoResult {
  const { documents, chunks, input, provenance, safeQuestion, asksForException, canaryScenario, usedSampleNotes } =
    prepareBase(question, sourceNotes);

  const lowEvidence = provenance.length === 0 || provenance[0]?.score < 5;

  let decision: Decision = "answer";
  let route = "INPUT_SCREEN -> RETRIEVE_CONTEXT -> PROVENANCE_ATTACH -> DECIDE_ROUTE -> AUDIT_LOG";

  if (input.status === "block") {
    decision = "block";
    route = "Blocked by INPUT_SCREEN";
  } else if (asksForException || lowEvidence) {
    decision = "review";
    route = "Sent to review by DECIDE_ROUTE";
  } else if (input.status === "redact") {
    decision = "answer_with_redaction";
    route = "Approved with redaction";
  }

  const answer = buildDraftAnswer("graph", decision, provenance, safeQuestion);

  return finalizeResult(
    "graph",
    runtime,
    question,
    safeQuestion,
    answer,
    decision,
    route,
    documents,
    chunks,
    provenance,
    input,
    usedSampleNotes,
    canaryScenario,
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function runSingleEval(mode: DemoMode, test: EvalCase, sourceNotes?: string) {
  const result = mode === "chain" ? runChainDemo(test.question, sourceNotes) : runGraphDemo(test.question, sourceNotes);
  const haystack = [result.answer, result.route, ...result.provenance.map((item) => `${item.title} ${item.excerpt}`)].join(" ");
  const matchedKeywords =
    test.expectedKeywords?.filter((keyword) => new RegExp(escapeRegex(keyword), "i").test(haystack)) ?? [];

  const sourcePass = test.expectedSource
    ? result.provenance.some((item) => item.title.toLowerCase().includes(test.expectedSource!.toLowerCase()))
    : true;
  const keywordPass = test.expectedKeywords ? matchedKeywords.length >= Math.min(1, test.expectedKeywords.length) : true;
  const decisionPass = result.decision === test.expectedDecision;

  return {
    id: test.id,
    question: test.question,
    note: test.note,
    expectedDecision: test.expectedDecision,
    actualDecision: result.decision,
    pass: decisionPass && sourcePass && keywordPass,
    topSource: result.provenance[0]?.title,
    matchedKeywords,
    per1000: result.cost.per1000,
    latencyMs: result.cost.latencyMs,
  };
}

export function runEvaluationSuite(mode: DemoMode, sourceNotes?: string): EvaluationReport {
  const items = evaluationQuestions.map((test) => runSingleEval(mode, test, sourceNotes));
  const passed = items.filter((item) => item.pass).length;
  const total = items.length;
  const averagePer1000 = Number((items.reduce((sum, item) => sum + item.per1000, 0) / total).toFixed(2));
  const averageLatencyMs = Math.round(items.reduce((sum, item) => sum + item.latencyMs, 0) / total);

  return {
    mode,
    total,
    passed,
    accuracy: Number(((passed / total) * 100).toFixed(1)),
    averagePer1000,
    averageLatencyMs,
    items,
  };
}

export function buildDemoOverview(sourceNotes?: string): DemoOverview {
  return {
    evaluations: {
      chain: runEvaluationSuite("chain", sourceNotes),
      graph: runEvaluationSuite("graph", sourceNotes),
    },
    slideEstimate,
  };
}

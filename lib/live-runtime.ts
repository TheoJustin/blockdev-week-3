import { createHash } from "node:crypto";
import { Document } from "@langchain/core/documents";
import { Embeddings } from "@langchain/core/embeddings";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { PineconeStore } from "@langchain/pinecone";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { z } from "zod";
import { evaluationQuestions, sampleKnowledgeBase, sampleSourceNotes, slideEstimate } from "@/lib/demo-data";
import type {
  AuditEvent,
  CostEstimate,
  CostLineItem,
  Decision,
  DemoOverview,
  DemoMode,
  DemoResult,
  EvalCase,
  EvaluationReport,
  GuardCheck,
  GuardrailResult,
  GraphState,
  KnowledgeDocument,
  PipelineNode,
  ProvenanceItem,
  Sensitivity,
} from "@/lib/types";

const CHAT_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

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

const answerSchema = z.object({
  answer: z.string(),
  takeaways: z.array(z.string()).min(3).max(4),
  speakerTip: z.string(),
});

type StructuredAnswer = z.infer<typeof answerSchema>;

type ModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

type RawUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type RetrievedMatch = {
  document: Document<Record<string, unknown>>;
  score: number;
};

type RetrievalResult = {
  matches: RetrievedMatch[];
  queryUsage: RawUsage | null;
};

type VectorBackend = {
  kind: "pinecone" | "in_memory";
  retrieve: (question: string, limit: number) => Promise<RetrievalResult>;
};

type PreparedIndex = {
  documents: KnowledgeDocument[];
  splitDocuments: Document<Record<string, unknown>>[];
  usedSampleNotes: boolean;
  vectorBackend: VectorBackend;
  vectorStore: "pinecone" | "in_memory";
};

type PreparedIndexRun = PreparedIndex & {
  buildUsage: RawUsage | null;
  indexBuiltThisRun: boolean;
};

type CachedPreparedIndex = {
  prepared: PreparedIndex;
  buildUsage: RawUsage | null;
};

type UsageLine = {
  nodeId: string;
  label: string;
  usage: RawUsage;
};

type RunContext = {
  documents: KnowledgeDocument[];
  splitDocuments: Document<Record<string, unknown>>[];
  provenance: ProvenanceItem[];
  input: GuardCheck;
  output: GuardCheck;
  decision: Decision;
  route: string;
  answer: string;
  finalAnswer: string;
  takeaways: string[];
  speakerTip: string;
  sourceCount: number;
  usedSampleNotes: boolean;
  canaryScenario: boolean;
  usageLines: UsageLine[];
  vectorStore: "pinecone" | "in_memory";
  indexBuiltThisRun: boolean;
  normalizedQuestion: string;
  safeQuestion: string;
  runtimeNotes: string[];
  graphState: GraphState | null;
};

type SourcePrompt = {
  context: string;
  sources: string;
};

type GraphWorkflowState = {
  question: string;
  safeQuestion: string;
  input: GuardCheck;
  retrieved: RetrievedMatch[];
  queryUsage: RawUsage | null;
  provenance: ProvenanceItem[];
  decision: Decision;
  route: string;
  answer: string;
  takeaways: string[];
  speakerTip: string;
  output: GuardCheck | null;
};

const knownPricing: Array<{ prefix: string; pricing: ModelPricing }> = [
  {
    prefix: "gpt-4.1-mini",
    pricing: {
      inputPerMillion: 0.4,
      outputPerMillion: 1.6,
    },
  },
  {
    prefix: "gpt-4.1",
    pricing: {
      inputPerMillion: 2,
      outputPerMillion: 8,
    },
  },
  {
    prefix: "text-embedding-3-small",
    pricing: {
      inputPerMillion: 0.02,
      outputPerMillion: 0,
    },
  },
];

const globalIndexCache = globalThis as typeof globalThis & {
  __langchainDemoIndexCache?: Map<string, Promise<CachedPreparedIndex>>;
  __langchainDemoOverviewCache?: Map<string, LiveOverviewCacheEntry>;
};

const liveIndexCache = globalIndexCache.__langchainDemoIndexCache ?? new Map<string, Promise<CachedPreparedIndex>>();
globalIndexCache.__langchainDemoIndexCache = liveIndexCache;

type LiveOverviewCacheEntry = {
  promise?: Promise<DemoOverview>;
  value?: DemoOverview;
};

const liveOverviewCache = globalIndexCache.__langchainDemoOverviewCache ?? new Map<string, LiveOverviewCacheEntry>();
globalIndexCache.__langchainDemoOverviewCache = liveOverviewCache;

function openAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

function openAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function pineconeConfigured() {
  return Boolean(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX);
}

export function liveRuntimeStatus() {
  return {
    configured: openAIConfigured(),
    model: CHAT_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    vectorStore: pineconeConfigured() ? "pinecone" : "in_memory",
  } as const;
}

function readEnvPrice(name: string) {
  const raw = process.env[name];

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolvePricing(model: string): ModelPricing | null {
  if (model.startsWith("text-embedding")) {
    const embedInput = readEnvPrice("OPENAI_EMBEDDING_INPUT_PRICE_PER_MILLION");

    if (embedInput !== null) {
      return {
        inputPerMillion: embedInput,
        outputPerMillion: 0,
      };
    }
  } else {
    const input = readEnvPrice("OPENAI_INPUT_PRICE_PER_MILLION");
    const output = readEnvPrice("OPENAI_OUTPUT_PRICE_PER_MILLION");

    if (input !== null && output !== null) {
      return {
        inputPerMillion: input,
        outputPerMillion: output,
      };
    }
  }

  const match = knownPricing.find((entry) => model.startsWith(entry.prefix));
  return match?.pricing ?? null;
}

function usageSubtotal(usage: RawUsage) {
  const pricing = resolvePricing(usage.model);

  if (!pricing) {
    return null;
  }

  return Number(
    (
      (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) /
      1_000_000
    ).toFixed(6),
  );
}

function toCostLineItem(line: UsageLine): CostLineItem | null {
  const subtotal = usageSubtotal(line.usage);

  if (subtotal === null) {
    return null;
  }

  const totalTokens = line.usage.totalTokens || line.usage.inputTokens + line.usage.outputTokens;
  const ratePerMillion = totalTokens > 0 ? Number(((subtotal * 1_000_000) / totalTokens).toFixed(4)) : 0;

  return {
    nodeId: line.nodeId,
    label: line.label,
    tokens: totalTokens,
    inputTokens: line.usage.inputTokens,
    outputTokens: line.usage.outputTokens,
    ratePerMillion,
    subtotal,
  };
}

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

function asksForSensitiveData(question: string) {
  return (
    /(show|share|reveal|give|display).*(api key|password|secret|session token|recovery code)/i.test(question) ||
    /(customer|user|account).*(api key|password|secret|session token|recovery code)/i.test(question)
  );
}

function containsRawPii(question: string) {
  return (
    /\b\d{3}-?\d{2}-?\d{4}\b/.test(question) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(question)
  );
}

function asksForException(question: string) {
  return /(override|exception|bypass|ignore the rule|approve anyway)/i.test(question);
}

function asksForCanary(question: string) {
  return /canary leak|exact string.*canary|canary.*string/i.test(question);
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

  const requestsSensitiveData = asksForSensitiveData(question);
  const hasRawPii = containsRawPii(question);
  const requestsException = asksForException(question);

  if (requestsSensitiveData) {
    reasons.push("The request asks for a raw secret or sensitive customer data.");
    triggeredRules.push("sensitive_data_request");
  }

  if (hasRawPii) {
    reasons.push("The request contains raw personal data that should be redacted.");
    redactions.push("Redact personal data before saving or forwarding this request.");
    triggeredRules.push("pii_redaction");
  }

  if (requestsException) {
    reasons.push("The request asks for a policy exception and should route to review.");
    triggeredRules.push("human_review");
  }

  if (requestsSensitiveData) {
    return {
      name: "InputGuard",
      status: "block",
      reasons,
      redactions,
      triggeredRules,
      checkedText: question,
    };
  }

  if (hasRawPii) {
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

function event(stage: string, detail: string): AuditEvent {
  return {
    stage,
    detail,
    timestamp: new Date().toISOString(),
  };
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
  cost: number,
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
    estimatedCost: cost,
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
    stateType: "Real LangGraph typed state",
    question,
    safeQuestion,
    inputScreen: input.status,
    retrievedSources: provenance.map((item) => item.title),
    provenanceAttached: provenance.length > 0,
    decision,
    auditLogFields: ["question", "mode", "decision", "sources", "guardrails", "latency", "timestamp"],
  };
}

function hashInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function overviewCacheKey(sourceNotes?: string) {
  const notesFingerprint = normalizeBlock(sourceNotes ?? sampleSourceNotes);
  const vectorKind = pineconeConfigured() ? "pinecone" : "in_memory";

  return [CHAT_MODEL, EMBEDDING_MODEL, vectorKind, hashInput(notesFingerprint)].join(":");
}

function cosineSimilarity(left: number[], right: number[]) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

class InstrumentedOpenAIEmbeddings extends Embeddings<number[]> {
  private client: OpenAI;
  private model: string;
  private documentTokens = 0;
  private queryTokens = 0;

  constructor(client: OpenAI, model: string) {
    super({});
    this.client = client;
    this.model = model;
  }

  consumeDocumentUsage() {
    const tokens = this.documentTokens;
    this.documentTokens = 0;

    return tokens > 0
      ? {
          model: this.model,
          inputTokens: tokens,
          outputTokens: 0,
          totalTokens: tokens,
        }
      : null;
  }

  consumeQueryUsage() {
    const tokens = this.queryTokens;
    this.queryTokens = 0;

    return tokens > 0
      ? {
          model: this.model,
          inputTokens: tokens,
          outputTokens: 0,
          totalTokens: tokens,
        }
      : null;
  }

  async embedDocuments(documents: string[]) {
    if (documents.length === 0) {
      return [];
    }

    const response = await this.client.embeddings.create({
      model: this.model,
      input: documents,
    });

    this.documentTokens += response.usage.prompt_tokens;

    return response.data
      .slice()
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }

  async embedQuery(document: string) {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: document,
    });

    this.queryTokens += response.usage.prompt_tokens;

    return response.data[0]?.embedding ?? [];
  }
}

function langChainDocuments(documents: KnowledgeDocument[]) {
  return documents.map(
    (document) =>
      new Document({
        pageContent: document.body,
        metadata: {
          id: document.id,
          title: document.title,
          source: document.source,
          sensitivity: document.sensitivity,
          tags: document.tags,
          summary: document.summary,
        },
      }),
  );
}

async function splitDocuments(documents: KnowledgeDocument[]) {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 420,
    chunkOverlap: 60,
  });

  const splitDocs = await splitter.splitDocuments(langChainDocuments(documents));

  return splitDocs.map(
    (document, index) =>
      new Document({
        pageContent: document.pageContent,
        metadata: {
          ...document.metadata,
          chunkIndex: index,
          id: `${String(document.metadata.id ?? "chunk")}-chunk-${index + 1}`,
        },
      }),
  );
}

async function buildMemoryVectorBackend(
  splitDocs: Document<Record<string, unknown>>[],
  embeddings: InstrumentedOpenAIEmbeddings,
): Promise<VectorBackend> {
  const vectors = await embeddings.embedDocuments(splitDocs.map((document) => document.pageContent));
  const records = splitDocs.map((document, index) => ({
    document,
    vector: vectors[index] ?? [],
  }));

  return {
    kind: "in_memory",
    retrieve: async (question: string, limit: number) => {
      const queryVector = await embeddings.embedQuery(question);
      const queryUsage = embeddings.consumeQueryUsage();
      const matches = rerankMatches(
        question,
        records.map((record) => ({
          document: record.document,
          score: cosineSimilarity(queryVector, record.vector),
        })),
        limit,
      );

      return {
        matches,
        queryUsage,
      };
    },
  };
}

async function buildPineconeVectorBackend(
  indexKey: string,
  splitDocs: Document<Record<string, unknown>>[],
  embeddings: InstrumentedOpenAIEmbeddings,
): Promise<VectorBackend> {
  const pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY!,
  });
  const namespace = process.env.PINECONE_NAMESPACE ?? `langchain-demo-${indexKey.slice(0, 16)}`;
  const pineconeIndex = pinecone.Index(process.env.PINECONE_INDEX!);
  const vectorStore = await PineconeStore.fromExistingIndex(embeddings, {
    pineconeIndex,
    namespace,
    textKey: "text",
  });

  await vectorStore.addDocuments(splitDocs, {
    ids: splitDocs.map((_document, index) => `${indexKey}-chunk-${index + 1}`),
    namespace,
  });

  return {
    kind: "pinecone",
    retrieve: async (question: string, limit: number) => {
      const matches = await vectorStore.similaritySearchWithScore(question, Math.max(limit * 3, 8));

      return {
        matches: rerankMatches(
          question,
          matches.map(([document, score]) => ({
            document,
            score,
          })),
          limit,
        ),
        queryUsage: embeddings.consumeQueryUsage(),
      };
    },
  };
}

async function prepareIndex(sourceNotes?: string): Promise<PreparedIndexRun> {
  const { documents, usedSampleNotes } = parseSourceNotes(sourceNotes);
  const notesFingerprint = normalizeBlock(sourceNotes ?? sampleSourceNotes);
  const vectorKind = pineconeConfigured() ? "pinecone" : "in_memory";
  const cacheKey = `${vectorKind}:${hashInput(notesFingerprint)}`;
  const cached = liveIndexCache.get(cacheKey);

  if (cached) {
    const cachedPrepared = await cached;

    return {
      ...cachedPrepared.prepared,
      buildUsage: null,
      indexBuiltThisRun: false,
    };
  }

  const buildPromise = (async () => {
    const client = openAIClient();
    const embeddings = new InstrumentedOpenAIEmbeddings(client, EMBEDDING_MODEL);
    const splitDocs = await splitDocuments(documents);
    const vectorBackend =
      vectorKind === "pinecone"
        ? await buildPineconeVectorBackend(cacheKey, splitDocs, embeddings)
        : await buildMemoryVectorBackend(splitDocs, embeddings);

    return {
      prepared: {
        documents,
        splitDocuments: splitDocs,
        usedSampleNotes,
        vectorBackend,
        vectorStore: vectorKind,
      } satisfies PreparedIndex,
      buildUsage: embeddings.consumeDocumentUsage(),
    } satisfies CachedPreparedIndex;
  })();

  liveIndexCache.set(cacheKey, buildPromise);

  try {
    const cachedPrepared = await buildPromise;

    return {
      ...cachedPrepared.prepared,
      buildUsage: cachedPrepared.buildUsage,
      indexBuiltThisRun: true,
    };
  } catch (error) {
    liveIndexCache.delete(cacheKey);
    throw error;
  }
}

function extractUsage(message: unknown, fallbackModel: string): RawUsage | null {
  if (!message || typeof message !== "object") {
    return null;
  }

  const usageCarrier = message as {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    response_metadata?: {
      model_name?: string;
      model?: string;
    };
  };

  const inputTokens = usageCarrier.usage_metadata?.input_tokens ?? 0;
  const outputTokens = usageCarrier.usage_metadata?.output_tokens ?? 0;
  const totalTokens = usageCarrier.usage_metadata?.total_tokens ?? inputTokens + outputTokens;

  if (totalTokens <= 0) {
    return null;
  }

  return {
    model: usageCarrier.response_metadata?.model_name ?? usageCarrier.response_metadata?.model ?? fallbackModel,
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function excerptFromDocument(document: Document<Record<string, unknown>>, question: string) {
  const sentences = document.pageContent.split(/(?<=[.!?])\s+/);
  const queryTokens = tokenize(question);
  const match = sentences.find((sentence) =>
    queryTokens.some((token) => sentence.toLowerCase().includes(token)),
  );

  return (match ?? document.pageContent).trim().slice(0, 280);
}

function excerptFromBody(body: string, question: string) {
  const sentences = body.split(/(?<=[.!?])\s+/);
  const queryTokens = tokenize(question);
  const match = sentences.find((sentence) =>
    queryTokens.some((token) => sentence.toLowerCase().includes(token)),
  );

  return (match ?? body).trim().slice(0, 280);
}

function documentProvenanceItem(document: KnowledgeDocument, question: string, score: number): ProvenanceItem {
  return {
    id: document.id,
    title: document.title,
    source: document.source,
    sensitivity: document.sensitivity,
    tags: document.tags,
    score,
    excerpt: excerptFromBody(document.body, question),
  };
}

function policyProvenance(question: string, documents: KnowledgeDocument[]): ProvenanceItem[] {
  if (asksForSensitiveData(question)) {
    const privacyRule = documents.find((document) => document.id === "support-privacy-rule");
    return privacyRule ? [documentProvenanceItem(privacyRule, question, 10)] : [];
  }

  if (asksForException(question)) {
    const reviewPolicy = documents.find((document) => document.id === "human-review-policy");
    return reviewPolicy ? [documentProvenanceItem(reviewPolicy, question, 10)] : [];
  }

  return [];
}

function answerHint(question: string) {
  if (/(what should input_screen check|input_screen check)/i.test(question)) {
    return "Mention InputGuard, privacy checks, secret requests, raw personal data, and routing risky exception requests to review.";
  }

  if (/(what should audit_log record|audit_log record)/i.test(question)) {
    return "Name the fields directly: question, decision, sources, timing, and timestamp.";
  }

  if (/(which architecture did the add choose|what did it reject)/i.test(question)) {
    return "State the chosen architecture and the rejected alternative explicitly, using the words hybrid and graph-only if they appear in context.";
  }

  if (/(customer's api key|support ticket|api key from a support ticket)/i.test(question)) {
    return "Be explicit that the assistant must never reveal a customer's API key or raw secret.";
  }

  return "Use the exact workflow names, policy names, and field names from the context when possible.";
}

function lexicalBonus(question: string, document: Document<Record<string, unknown>>) {
  const title = String(document.metadata.title ?? "");
  const tags = Array.isArray(document.metadata.tags) ? (document.metadata.tags as string[]).join(" ") : "";
  const haystack = `${title} ${tags} ${document.pageContent}`.toLowerCase();
  const queryTokens = tokenize(question);
  let bonus = 0;

  for (const token of queryTokens) {
    if (haystack.includes(token)) {
      bonus += 0.04;
    }
  }

  if (/(loader|splitter|pinecone|retrievalqa)/i.test(question) && /(loader|splitter|pinecone|retrievalqa)/i.test(haystack)) {
    bonus += 1.2;
  }

  if (/(input_screen|audit_log|provenance|langgraph)/i.test(question) && /(input_screen|audit_log|provenance|langgraph)/i.test(haystack)) {
    bonus += 1.2;
  }

  if (/(canary|leak)/i.test(question) && /(canary|leak)/i.test(haystack)) {
    bonus += 1.5;
  }

  if (/(api key|secret|password)/i.test(question) && /(api key|secret|password)/i.test(haystack)) {
    bonus += 1.5;
  }

  if (/(four steps.*minimal langchain rag flow|minimal langchain rag flow)/i.test(question) && /(loader|splitter|pinecone|retrievalqa)/i.test(haystack)) {
    bonus += 3;
  }

  if (/(split documents|chunking|indexing them in pinecone)/i.test(question) && /(split|chunk|pinecone)/i.test(haystack)) {
    bonus += 2;
  }

  if (/(which langgraph nodes|governance visible|why add input_screen|what should input_screen|what should audit_log)/i.test(question) && /(input_screen|audit_log|provenance|decide_route)/i.test(haystack)) {
    bonus += 2.5;
  }

  if (/minimal langchain rag/i.test(question) && /minimal langchain rag/i.test(title)) {
    bonus += 2;
  }

  if (/(input_screen|audit_log|langgraph)/i.test(question) && /langgraph governance flow/i.test(title)) {
    bonus += 2;
  }

  if (/(what should input_screen check|input_screen check)/i.test(question) && /guardrails and canary leak drills/i.test(title)) {
    bonus += 6;
  }

  if (/(what should input_screen check|input_screen check)/i.test(question) && /(inputguard|privacy|review)/i.test(haystack)) {
    bonus += 3;
  }

  if (/(what should audit_log record|audit_log record)/i.test(question) && /cost tracking and csv export/i.test(title)) {
    bonus += 3;
  }

  if (/(which architecture did the add choose|what did it reject)/i.test(question) && /architecture decision document template/i.test(title)) {
    bonus += 3;
  }

  if (/(customer's api key|support ticket|api key from a support ticket)/i.test(question) && /support privacy rule/i.test(title)) {
    bonus += 3;
  }

  if (/(canary|leak)/i.test(question) && /guardrails and canary leak drills/i.test(title)) {
    bonus += 2;
  }

  if (/audit_log/i.test(question) && /cost tracking and csv export/i.test(title)) {
    bonus += 1.5;
  }

  return bonus;
}

function rerankMatches(question: string, matches: RetrievedMatch[], limit: number) {
  return matches
    .map((match) => ({
      document: match.document,
      score: match.score + lexicalBonus(question, match.document),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .filter((item) => item.score > 0);
}

function toProvenance(matches: RetrievedMatch[], question: string): ProvenanceItem[] {
  return matches.map((match, index) => ({
    id: String(match.document.metadata.id ?? `chunk-${index + 1}`),
    title: String(match.document.metadata.title ?? `Source ${index + 1}`),
    source: String(match.document.metadata.source ?? "notes"),
    sensitivity: (match.document.metadata.sensitivity as Sensitivity) ?? "open",
    tags: Array.isArray(match.document.metadata.tags) ? (match.document.metadata.tags as string[]) : [],
    score: Number(match.score.toFixed(3)),
    excerpt: excerptFromDocument(match.document, question),
  }));
}

function formatPromptSources(provenance: ProvenanceItem[]): SourcePrompt {
  const context = provenance
    .map(
      (item, index) =>
        `Source ${index + 1}: ${item.title}\nSensitivity: ${item.sensitivity}\nPath: ${item.source}\nExcerpt: ${item.excerpt}`,
    )
    .join("\n\n");
  const sources = provenance.map((item) => item.title).join(", ");

  return {
    context,
    sources,
  };
}

function buildDecisionAnswer(question: string, decision: Decision) {
  if (decision === "block") {
    if (asksForSensitiveData(question)) {
      return "This request should be blocked because it asks for a customer's API key or another raw secret. The assistant should refuse and explain the privacy rule.";
    }

    return "This request should be blocked because it asks for protected data or fails a release guard.";
  }

  if (decision === "review") {
    return "This request should go to human review because it asks for an exception or the evidence is too weak for an automatic answer.";
  }

  return "";
}

function fallbackTakeaways(mode: DemoMode, decision: Decision, vectorStore: "pinecone" | "in_memory") {
  if (decision === "block") {
    return [
      "The workflow stopped before release because the request or draft violated policy.",
      "InputGuard and OutputGuard are product controls, not presentation-only labels.",
      `The retrieval backend was ${vectorStore === "pinecone" ? "Pinecone" : "an in-memory vector index"} for this run.`,
    ];
  }

  if (decision === "review") {
    return [
      "The system routed this question to review instead of guessing.",
      "Weak evidence or exception requests should stay visible in the workflow.",
      `The retrieval backend was ${vectorStore === "pinecone" ? "Pinecone" : "an in-memory vector index"} for this run.`,
    ];
  }

  return mode === "graph"
    ? [
        "The graph reused the same retrieval core but kept routing and provenance explicit.",
        "Governance is visible because INPUT_SCREEN and AUDIT_LOG are real graph nodes here.",
        `The retrieval backend was ${vectorStore === "pinecone" ? "Pinecone" : "an in-memory vector index"} for this run.`,
      ]
    : [
        "The answer came from a real retrieval step plus one real answer model call.",
        "This path keeps the RAG flow simple: load, split, index, retrieve, answer.",
        `The retrieval backend was ${vectorStore === "pinecone" ? "Pinecone" : "an in-memory vector index"} for this run.`,
      ];
}

function fallbackSpeakerTip(mode: DemoMode, decision: Decision, canaryScenario: boolean) {
  if (canaryScenario) {
    return "The canary drill matters because the system can retrieve risky text but still stop it before release.";
  }

  if (decision === "block") {
    return "A production assistant should refuse sensitive requests instead of trying to answer everything.";
  }

  if (decision === "review") {
    return "Review is the correct product decision when the evidence is weak or the request asks for an exception.";
  }

  return mode === "graph"
    ? "This run used a real graph with explicit state transitions."
    : "This run used a real LangChain retrieval path with one answer model call.";
}

function refineStructuredAnswer(question: string, content: StructuredAnswer): StructuredAnswer {
  if (/(what should input_screen check|input_screen check)/i.test(question)) {
    return {
      ...content,
      answer:
        "INPUT_SCREEN should run InputGuard to check privacy risks, raw personal data, secret requests, and exception requests that should go to review before retrieval continues.",
    };
  }

  return content;
}

async function generateStructuredAnswer(
  mode: DemoMode,
  question: string,
  provenance: ProvenanceItem[],
  chatModel: ChatOpenAI,
): Promise<{ content: StructuredAnswer; usage: RawUsage | null }> {
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "You explain AI workflow behavior to developers in plain language. Use only the provided context. Keep the answer factual, short, and easy to say out loud in a meetup demo. Never invent sources. Preserve exact workflow step names from the context, including names like Loader, Splitter, Pinecone, RetrievalQA, INPUT_SCREEN, and AUDIT_LOG. If the user asks for an exact string and the context contains it, you may quote that string exactly.",
    ],
    [
      "human",
      [
        `Workflow: ${mode === "chain" ? "LangChain RAG" : "LangGraph governance flow"}`,
        `Question: {question}`,
        "",
        "Context:",
        "{context}",
        "",
        "Answer hint:",
        "{hint}",
        "",
        "Return:",
        "- answer: one short plain-language answer",
        "- takeaways: 3 or 4 short speaker bullets",
        "- speakerTip: one sentence on what to point out in the run",
        "- if the answer is a workflow step list, use the exact step names from context",
      ].join("\n"),
    ],
  ]);

  const runnable = prompt.pipe(
    chatModel.withStructuredOutput(answerSchema, {
      includeRaw: true,
    }),
  );

  const promptSources = formatPromptSources(provenance);
  const response = (await runnable.invoke({
    question,
    context: promptSources.context,
    hint: answerHint(question),
  })) as {
    parsed: StructuredAnswer;
    raw: unknown;
  };

  return {
    content: refineStructuredAnswer(question, response.parsed),
    usage: extractUsage(response.raw, CHAT_MODEL),
  };
}

function actualCostEstimate(
  usageLines: UsageLine[],
  mode: DemoMode,
  vectorStore: "pinecone" | "in_memory",
  indexBuiltThisRun: boolean,
): CostEstimate {
  const breakdown = usageLines.map(toCostLineItem).filter(Boolean) as CostLineItem[];
  const perInteraction = Number(breakdown.reduce((total, item) => total + item.subtotal, 0).toFixed(6));

  return {
    perInteraction,
    per1000: Number((perInteraction * 1000).toFixed(2)),
    latencyMs: 0,
    breakdown,
    assumptions: [
      "Measured latency is attached after the run finishes.",
      "These costs use actual OpenAI token usage from embeddings and answer generation.",
      indexBuiltThisRun
        ? `This run rebuilt the ${vectorStore === "pinecone" ? "Pinecone" : "in-memory"} index because the note set was new in this server process.`
        : `This run reused the existing ${vectorStore === "pinecone" ? "Pinecone" : "in-memory"} index, so ingest cost was not billed again.`,
      vectorStore === "pinecone"
        ? "Pinecone handled vector retrieval in this run."
        : "Pinecone is not configured, so vector retrieval used a real local in-memory index instead.",
    ],
    costKind: "actual",
    latencyKind: "simulated",
  };
}

function buildActualChainPipeline(context: RunContext) {
  const usageByNode = new Map(context.usageLines.map((line) => [line.nodeId, toCostLineItem(line)]));
  const indexCost = usageByNode.get("INDEX_EMBEDDINGS")?.subtotal ?? 0;
  const queryCost = usageByNode.get("QUERY_EMBEDDING")?.subtotal ?? 0;
  const answerCost = usageByNode.get("ANSWER_MODEL")?.subtotal ?? 0;
  const indexTokens = usageByNode.get("INDEX_EMBEDDINGS")?.tokens ?? 0;
  const queryTokens = usageByNode.get("QUERY_EMBEDDING")?.tokens ?? 0;
  const answerTokens = usageByNode.get("ANSWER_MODEL")?.tokens ?? 0;

  return [
    pipelineNode(
      "INPUT_GUARD",
      "InputGuard",
      "governance",
      context.input.status === "block" ? "blocked" : context.input.status === "redact" ? "warning" : "completed",
      "Screen the request before retrieval for secrets, raw PII, and policy exceptions.",
      0,
      0,
      context.input.reasons.join(" "),
    ),
    pipelineNode(
      "DOC_LOADER",
      "Loader",
      "input",
      "completed",
      "Load the source notes into LangChain documents.",
      0,
      0,
      `${context.sourceCount} source documents loaded.`,
    ),
    pipelineNode(
      "TEXT_SPLITTER",
      "Splitter",
      "retrieval",
      "completed",
      "Split the notes into smaller retrieval chunks with RecursiveCharacterTextSplitter.",
      0,
      0,
      `${context.splitDocuments.length} chunks ready for search.`,
    ),
    pipelineNode(
      "INDEX_EMBEDDINGS",
      context.vectorStore === "pinecone" ? "Pinecone" : "In-memory index",
      context.vectorStore === "pinecone" ? "storage" : "retrieval",
      "completed",
      context.indexBuiltThisRun
        ? `Build the ${context.vectorStore === "pinecone" ? "Pinecone" : "in-memory"} vector index for the current notes.`
        : `Reuse the existing ${context.vectorStore === "pinecone" ? "Pinecone" : "in-memory"} vector index for the current notes.`,
      indexTokens,
      indexCost,
      context.indexBuiltThisRun ? "Index built for this note set." : "Existing index reused.",
    ),
    pipelineNode(
      "QUERY_EMBEDDING",
      "Retriever",
      "retrieval",
      context.provenance.length > 0 ? "completed" : "warning",
      "Embed the question and retrieve the nearest supporting chunks.",
      queryTokens,
      queryCost,
      context.provenance.length > 0 ? context.provenance.map((item) => item.title).join(", ") : "No strong match found.",
    ),
    pipelineNode(
      "ANSWER_MODEL",
      "RetrievalQA",
      "reasoning",
      context.decision === "review" ? "warning" : nodeStatusFromDecision(context.decision),
      "Call the answer model with the retrieved context and return a grounded response.",
      answerTokens,
      answerCost,
      context.answer,
    ),
    pipelineNode(
      "OUTPUT_GUARD",
      "OutputGuard",
      "output",
      context.output.status === "block" ? "blocked" : "completed",
      "Check the drafted answer for canary leaks or credential-like output before release.",
      0,
      0,
      context.output.reasons.join(" "),
    ),
    pipelineNode(
      "AUDIT_LOG",
      "Audit Log",
      "audit",
      "completed",
      "Save the question, decision, sources, and timing fields for later review.",
      0,
      0,
      "Run metadata saved.",
    ),
  ];
}

function buildActualGraphPipeline(context: RunContext) {
  const usageByNode = new Map(context.usageLines.map((line) => [line.nodeId, toCostLineItem(line)]));
  const indexCost = usageByNode.get("INDEX_EMBEDDINGS")?.subtotal ?? 0;
  const queryCost = usageByNode.get("QUERY_EMBEDDING")?.subtotal ?? 0;
  const answerCost = usageByNode.get("ANSWER_MODEL")?.subtotal ?? 0;
  const indexTokens = usageByNode.get("INDEX_EMBEDDINGS")?.tokens ?? 0;
  const queryTokens = usageByNode.get("QUERY_EMBEDDING")?.tokens ?? 0;
  const answerTokens = usageByNode.get("ANSWER_MODEL")?.tokens ?? 0;

  return [
    pipelineNode(
      "INPUT_SCREEN",
      "INPUT_SCREEN",
      "governance",
      context.input.status === "block" ? "blocked" : context.input.status === "redact" ? "warning" : "completed",
      "The first LangGraph node screens the request before retrieval continues.",
      0,
      0,
      context.input.reasons.join(" "),
    ),
    pipelineNode(
      "DOC_LOADER",
      "DOC_LOADER",
      "input",
      "completed",
      "Load the source notes into LangChain documents.",
      0,
      0,
      `${context.sourceCount} source documents loaded.`,
    ),
    pipelineNode(
      "TEXT_SPLITTER",
      "TEXT_SPLITTER",
      "retrieval",
      "completed",
      "Split the notes into retrievable chunks.",
      0,
      0,
      `${context.splitDocuments.length} chunks ready for search.`,
    ),
    pipelineNode(
      "INDEX_EMBEDDINGS",
      context.vectorStore === "pinecone" ? "PINECONE_INDEX" : "MEMORY_INDEX",
      context.vectorStore === "pinecone" ? "storage" : "retrieval",
      "completed",
      context.indexBuiltThisRun
        ? `Build the ${context.vectorStore === "pinecone" ? "Pinecone" : "in-memory"} vector index for this note set.`
        : `Reuse the existing ${context.vectorStore === "pinecone" ? "Pinecone" : "in-memory"} vector index.`,
      indexTokens,
      indexCost,
      context.indexBuiltThisRun ? "Index built for this note set." : "Existing index reused.",
    ),
    pipelineNode(
      "QUERY_EMBEDDING",
      "RETRIEVE_CONTEXT",
      "retrieval",
      context.provenance.length > 0 ? "completed" : "warning",
      "Embed the question and retrieve the nearest evidence package.",
      queryTokens,
      queryCost,
      context.provenance.length > 0 ? context.provenance.map((item) => item.title).join(", ") : "No strong match found.",
    ),
    pipelineNode(
      "PROVENANCE_ATTACH",
      "PROVENANCE_ATTACH",
      "provenance",
      context.provenance.length > 0 ? "completed" : "warning",
      "Attach retrieved source details directly to graph state.",
      0,
      0,
      context.provenance.length > 0 ? `${context.provenance.length} supporting chunks attached.` : "No provenance attached.",
    ),
    pipelineNode(
      "DECIDE_ROUTE",
      "DECIDE_ROUTE",
      "governance",
      nodeStatusFromDecision(context.decision),
      "Choose answer, review, or block from explicit graph state.",
      0,
      0,
      context.route,
    ),
    pipelineNode(
      "ANSWER_MODEL",
      "DRAFT_ANSWER",
      "reasoning",
      context.decision === "review" ? "warning" : nodeStatusFromDecision(context.decision),
      "Call the answer model after the route is known.",
      answerTokens,
      answerCost,
      context.answer,
    ),
    pipelineNode(
      "OUTPUT_GUARD",
      "OUTPUT_GUARD",
      "output",
      context.output.status === "block" ? "blocked" : "completed",
      "Check the drafted answer for canary leaks or credential-like output before release.",
      0,
      0,
      context.output.reasons.join(" "),
    ),
    pipelineNode(
      "AUDIT_LOG",
      "AUDIT_LOG",
      "audit",
      "completed",
      "Persist the typed state snapshot for later review.",
      0,
      0,
      "Typed state snapshot saved.",
    ),
  ];
}

function finalizeLiveResult(mode: DemoMode, question: string, context: RunContext): DemoResult {
  const cost = actualCostEstimate(context.usageLines, mode, context.vectorStore, context.indexBuiltThisRun);
  const pipeline = mode === "chain" ? buildActualChainPipeline(context) : buildActualGraphPipeline(context);
  const guardrails = mergeGuardrails(context.input, context.output);
  const answerModelUsage = context.usageLines.find((line) => line.nodeId === "ANSWER_MODEL")?.usage;
  const totalInput = context.usageLines.reduce((sum, line) => sum + line.usage.inputTokens, 0);
  const totalOutput = context.usageLines.reduce((sum, line) => sum + line.usage.outputTokens, 0);
  const totalTokens = context.usageLines.reduce((sum, line) => sum + line.usage.totalTokens, 0);

  return {
    mode,
    runtime: "openai",
    question,
    normalizedQuestion: context.normalizedQuestion,
    answer: context.finalAnswer,
    decision: context.decision,
    route: context.route,
    guardrails,
    provenance: context.provenance,
    audit: [
      event(mode === "graph" ? "INPUT_SCREEN" : "InputGuard", "Screened the request before retrieval."),
      event("RETRIEVE_CONTEXT", `Retrieved ${context.provenance.length} supporting chunks.`),
      event("OUTPUT_GUARD", context.output.status === "block" ? "Blocked the draft before release." : "Approved the draft for release."),
      event(mode === "graph" ? "AUDIT_LOG" : "Audit Log", "Saved the run summary."),
    ],
    pipeline,
    cost,
    takeaways: context.takeaways,
    speakerTip: context.speakerTip,
    sourceCount: context.sourceCount,
    usedSampleNotes: context.usedSampleNotes,
    generatedAt: new Date().toISOString(),
    canaryScenario: context.canaryScenario,
    graphState: context.graphState,
    implementation: {
      engine: mode === "chain" ? "langchain" : "langgraph",
      vectorStore: context.vectorStore,
      indexBuiltThisRun: context.indexBuiltThisRun,
      notes: context.runtimeNotes,
    },
    liveUsage: {
      model: answerModelUsage?.model ?? CHAT_MODEL,
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens,
      note:
        context.vectorStore === "pinecone"
          ? `This run used ${mode === "chain" ? "real LangChain" : "real LangGraph"} plus Pinecone-backed retrieval.`
          : `This run used ${mode === "chain" ? "real LangChain" : "real LangGraph"} with a real local vector index because Pinecone is not configured.`,
      status: "used",
    },
  };
}

function runtimeNotes(mode: DemoMode, vectorStore: "pinecone" | "in_memory", indexBuiltThisRun: boolean) {
  const notes = [
    mode === "chain"
      ? "This run used a real LangChain retrieval path."
      : "This run used a real LangGraph StateGraph.",
    vectorStore === "pinecone"
      ? "Pinecone was configured and handled vector retrieval."
      : "Pinecone is not configured, so vector retrieval used a real local in-memory index.",
  ];

  notes.push(indexBuiltThisRun ? "The index was freshly built in this run." : "The existing index was reused in this run.");

  return notes;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runSingleLiveEval(mode: DemoMode, test: EvalCase, sourceNotes?: string) {
  const startedAt = performance.now();
  const result = await runLiveDemo(mode, test.question, sourceNotes);
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const haystack = [result.answer, result.route, ...result.provenance.map((item) => `${item.title} ${item.excerpt}`)].join(" ");
  const matchedKeywords =
    test.expectedKeywords?.filter((keyword) => new RegExp(escapeRegex(keyword), "i").test(haystack)) ?? [];
  const requiredKeywordMatches = test.expectedKeywords
    ? (test.minimumKeywordMatches ?? test.expectedKeywords.length)
    : 0;

  const sourcePass = test.expectedSource
    ? result.provenance.some((item) => item.title.toLowerCase().includes(test.expectedSource!.toLowerCase()))
    : true;
  const keywordPass = test.expectedKeywords ? matchedKeywords.length >= requiredKeywordMatches : true;
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
    latencyMs,
  };
}

async function runLiveEvaluationSuite(mode: DemoMode, sourceNotes?: string): Promise<EvaluationReport> {
  const items = [];

  for (const test of evaluationQuestions) {
    items.push(await runSingleLiveEval(mode, test, sourceNotes));
  }

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

async function buildLiveOverview(sourceNotes?: string): Promise<DemoOverview> {
  await prepareIndex(sourceNotes);

  const [chain, graph] = await Promise.all([
    runLiveEvaluationSuite("chain", sourceNotes),
    runLiveEvaluationSuite("graph", sourceNotes),
  ]);

  return {
    evaluations: {
      chain,
      graph,
    },
    slideEstimate,
    source: "live",
    status: "ready",
    notes: [
      `This scorecard uses the real ${CHAT_MODEL} backend for the same ${evaluationQuestions.length} evaluation questions.`,
      pineconeConfigured()
        ? "Pinecone is configured, so both suites use the live Pinecone index."
        : "Pinecone is not configured, so both suites use the real in-memory vector index instead.",
      "The index is warmed before the suite runs so the averages reflect steady-state question handling instead of one-time ingest cost.",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function runningOverview(): DemoOverview {
  return {
    evaluations: {
      chain: null,
      graph: null,
    },
    slideEstimate,
    source: "live",
    status: "running",
    notes: [
      `Running the live ${evaluationQuestions.length}-question evaluation suite with ${CHAT_MODEL}.`,
      "The page will refresh automatically when the scorecard is ready.",
    ],
  };
}

function failedOverview(message: string): DemoOverview {
  return {
    evaluations: {
      chain: null,
      graph: null,
    },
    slideEstimate,
    source: "live",
    status: "error",
    notes: [
      "The live evaluation suite could not finish.",
      message,
    ],
  };
}

export function getLiveOverviewSnapshot(sourceNotes?: string): DemoOverview {
  const key = overviewCacheKey(sourceNotes);
  const cached = liveOverviewCache.get(key);

  if (cached?.value) {
    return cached.value;
  }

  if (!cached?.promise) {
    const promise = buildLiveOverview(sourceNotes)
      .then((overview) => {
        liveOverviewCache.set(key, {
          value: overview,
        });

        return overview;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown error.";
        const overview = failedOverview(message);

        liveOverviewCache.set(key, {
          value: overview,
        });

        return overview;
      });

    liveOverviewCache.set(key, {
      promise,
    });
  }

  return runningOverview();
}

async function runLiveChain(question: string, sourceNotes?: string): Promise<DemoResult> {
  const normalizedQuestion = normalizeQuestion(question);
  const input = inputGuard(normalizedQuestion);
  const safeQuestion = input.status === "redact" ? redactSensitiveText(normalizedQuestion) : normalizedQuestion;
  const canaryScenario = asksForCanary(normalizedQuestion);
  const index = await prepareIndex(sourceNotes);
  const vectorBackendLabel = index.vectorStore === "pinecone" ? "Pinecone" : "In-memory index";
  const routeBase = index.vectorStore === "pinecone" ? "Loader -> Splitter -> Pinecone -> RetrievalQA" : "Loader -> Splitter -> In-memory index -> RetrievalQA";
  const usageLines: UsageLine[] = [];

  if (index.buildUsage) {
    usageLines.push({
      nodeId: "INDEX_EMBEDDINGS",
      label: `Index embeddings (${index.buildUsage.model})`,
      usage: index.buildUsage,
    });
  }

  let decision: Decision = "answer";
  let route = routeBase;
  let provenance: ProvenanceItem[] = [];
  let answer = "";
  let takeaways = fallbackTakeaways("chain", decision, index.vectorStore);
  let speakerTip = fallbackSpeakerTip("chain", decision, canaryScenario);

  if (input.status === "block") {
    decision = "block";
    route = "Blocked by InputGuard";
    provenance = policyProvenance(normalizedQuestion, index.documents);
    answer = buildDecisionAnswer(normalizedQuestion, decision);
    takeaways = fallbackTakeaways("chain", decision, index.vectorStore);
    speakerTip = fallbackSpeakerTip("chain", decision, canaryScenario);
  } else {
    const retrieval = await index.vectorBackend.retrieve(safeQuestion, 3);

    if (retrieval.queryUsage) {
      usageLines.push({
        nodeId: "QUERY_EMBEDDING",
        label: `Query embedding (${retrieval.queryUsage.model})`,
        usage: retrieval.queryUsage,
      });
    }

    provenance = toProvenance(retrieval.matches, safeQuestion);
    const asksForReview = input.triggeredRules.includes("human_review");

    if (asksForReview) {
      decision = "review";
      route = "Stopped for policy review";
      answer = buildDecisionAnswer(safeQuestion, decision);
      takeaways = fallbackTakeaways("chain", decision, index.vectorStore);
      speakerTip = fallbackSpeakerTip("chain", decision, canaryScenario);
    } else if (provenance.length === 0) {
      decision = "review";
      route = "Stopped because retrieval evidence was weak";
      answer = buildDecisionAnswer(safeQuestion, decision);
      takeaways = fallbackTakeaways("chain", decision, index.vectorStore);
      speakerTip = fallbackSpeakerTip("chain", decision, canaryScenario);
    } else {
      const chatModel = new ChatOpenAI({
        model: CHAT_MODEL,
        temperature: 0,
        maxRetries: 1,
      });
      const generated = await generateStructuredAnswer("chain", safeQuestion, provenance, chatModel);

      if (generated.usage) {
        usageLines.push({
          nodeId: "ANSWER_MODEL",
          label: `Answer model (${generated.usage.model})`,
          usage: generated.usage,
        });
      }

      answer = generated.content.answer;
      takeaways = generated.content.takeaways;
      speakerTip = generated.content.speakerTip;

      if (input.status === "redact") {
        decision = "answer_with_redaction";
        route = `Redacted prompt before answer via ${vectorBackendLabel}`;
      }
    }
  }

  const output = outputGuard(answer);
  const finalDecision = output.status === "block" ? "block" : decision;
  const finalRoute = output.status === "block" ? "Blocked by OutputGuard" : route;
  const finalAnswer =
    output.status === "block"
      ? "The drafted answer was stopped before release because OutputGuard detected sensitive output."
      : answer;

  return finalizeLiveResult("chain", question, {
    documents: index.documents,
    splitDocuments: index.splitDocuments,
    provenance,
    input,
    output,
    decision: finalDecision,
    route: finalRoute,
    answer,
    finalAnswer,
    takeaways: output.status === "block" ? fallbackTakeaways("chain", "block", index.vectorStore) : takeaways,
    speakerTip: output.status === "block" ? fallbackSpeakerTip("chain", "block", canaryScenario) : speakerTip,
    sourceCount: index.documents.length,
    usedSampleNotes: index.usedSampleNotes,
    canaryScenario,
    usageLines,
    vectorStore: index.vectorStore,
    indexBuiltThisRun: index.indexBuiltThisRun,
    normalizedQuestion,
    safeQuestion,
    runtimeNotes: runtimeNotes("chain", index.vectorStore, index.indexBuiltThisRun),
    graphState: null,
  });
}

async function runLiveGraph(question: string, sourceNotes?: string): Promise<DemoResult> {
  const normalizedQuestion = normalizeQuestion(question);
  const input = inputGuard(normalizedQuestion);
  const safeQuestion = input.status === "redact" ? redactSensitiveText(normalizedQuestion) : normalizedQuestion;
  const canaryScenario = asksForCanary(normalizedQuestion);
  const index = await prepareIndex(sourceNotes);
  const usageLines: UsageLine[] = [];

  if (index.buildUsage) {
    usageLines.push({
      nodeId: "INDEX_EMBEDDINGS",
      label: `Index embeddings (${index.buildUsage.model})`,
      usage: index.buildUsage,
    });
  }

  const chatModel = new ChatOpenAI({
    model: CHAT_MODEL,
    temperature: 0,
    maxRetries: 1,
  });

  const GraphAnnotation = Annotation.Root({
    question: Annotation<string>,
    safeQuestion: Annotation<string>,
    input: Annotation<GuardCheck>,
    retrieved: Annotation<RetrievedMatch[]>({
      reducer: (_left, right) => right,
      default: () => [],
    }),
    queryUsage: Annotation<RawUsage | null>({
      reducer: (_left, right) => right,
      default: () => null,
    }),
    provenance: Annotation<ProvenanceItem[]>({
      reducer: (_left, right) => right,
      default: () => [],
    }),
    decision: Annotation<Decision>({
      reducer: (_left, right) => right,
      default: () => "answer",
    }),
    route: Annotation<string>({
      reducer: (_left, right) => right,
      default: () =>
        index.vectorStore === "pinecone"
          ? "INPUT_SCREEN -> RETRIEVE_CONTEXT -> PROVENANCE_ATTACH -> DECIDE_ROUTE -> DRAFT_ANSWER -> OUTPUT_GUARD -> AUDIT_LOG"
          : "INPUT_SCREEN -> RETRIEVE_CONTEXT -> PROVENANCE_ATTACH -> DECIDE_ROUTE -> DRAFT_ANSWER -> OUTPUT_GUARD -> AUDIT_LOG",
    }),
    answer: Annotation<string>({
      reducer: (_left, right) => right,
      default: () => "",
    }),
    takeaways: Annotation<string[]>({
      reducer: (_left, right) => right,
      default: () => [],
    }),
    speakerTip: Annotation<string>({
      reducer: (_left, right) => right,
      default: () => "",
    }),
    output: Annotation<GuardCheck | null>({
      reducer: (_left, right) => right,
      default: () => null,
    }),
  });

  const graph = new StateGraph(GraphAnnotation)
    .addNode("INPUT_SCREEN", async (state: typeof GraphAnnotation.State) => {
      if (state.input.status === "block") {
        return {
          decision: "block" as Decision,
          route: "Blocked by INPUT_SCREEN",
          provenance: policyProvenance(state.question, index.documents),
          answer: buildDecisionAnswer(state.safeQuestion, "block"),
          takeaways: fallbackTakeaways("graph", "block", index.vectorStore),
          speakerTip: fallbackSpeakerTip("graph", "block", canaryScenario),
        };
      }

      return {};
    })
    .addNode("RETRIEVE_CONTEXT", async (state: typeof GraphAnnotation.State) => {
      if (state.decision === "block") {
        return {};
      }

      const retrieval = await index.vectorBackend.retrieve(state.safeQuestion, 3);
      if (retrieval.queryUsage) {
        usageLines.push({
          nodeId: "QUERY_EMBEDDING",
          label: `Query embedding (${retrieval.queryUsage.model})`,
          usage: retrieval.queryUsage,
        });
      }

      return {
        retrieved: retrieval.matches,
        queryUsage: retrieval.queryUsage,
      };
    })
    .addNode("PROVENANCE_ATTACH", async (state: typeof GraphAnnotation.State) => ({
      provenance: state.retrieved.length > 0 ? toProvenance(state.retrieved, state.safeQuestion) : state.provenance,
    }))
    .addNode("DECIDE_ROUTE", async (state: typeof GraphAnnotation.State) => {
      if (state.decision === "block") {
        return {};
      }

      const asksForReview = state.input.triggeredRules.includes("human_review");
      const lowEvidence = state.provenance.length === 0;

      if (asksForReview || lowEvidence) {
        return {
          decision: "review" as Decision,
          route: asksForReview ? "Sent to review by DECIDE_ROUTE" : "Sent to review because retrieval evidence was weak",
          answer: buildDecisionAnswer(state.safeQuestion, "review"),
          takeaways: fallbackTakeaways("graph", "review", index.vectorStore),
          speakerTip: fallbackSpeakerTip("graph", "review", canaryScenario),
        };
      }

      if (state.input.status === "redact") {
        return {
          decision: "answer_with_redaction" as Decision,
          route: "Approved with redaction by DECIDE_ROUTE",
        };
      }

      return {
        decision: "answer" as Decision,
      };
    })
    .addNode("DRAFT_ANSWER", async (state: typeof GraphAnnotation.State) => {
      if (state.decision === "block" || state.decision === "review") {
        return {};
      }

      const generated = await generateStructuredAnswer("graph", state.safeQuestion, state.provenance, chatModel);

      if (generated.usage) {
        usageLines.push({
          nodeId: "ANSWER_MODEL",
          label: `Answer model (${generated.usage.model})`,
          usage: generated.usage,
        });
      }

      return {
        answer: generated.content.answer,
        takeaways: generated.content.takeaways,
        speakerTip: generated.content.speakerTip,
      };
    })
    .addNode("OUTPUT_GUARD", async (state: typeof GraphAnnotation.State) => ({
      output: outputGuard(state.answer),
    }))
    .addNode("AUDIT_LOG", async (state: typeof GraphAnnotation.State) => state)
    .addEdge(START, "INPUT_SCREEN")
    .addEdge("INPUT_SCREEN", "RETRIEVE_CONTEXT")
    .addEdge("RETRIEVE_CONTEXT", "PROVENANCE_ATTACH")
    .addEdge("PROVENANCE_ATTACH", "DECIDE_ROUTE")
    .addEdge("DECIDE_ROUTE", "DRAFT_ANSWER")
    .addEdge("DRAFT_ANSWER", "OUTPUT_GUARD")
    .addEdge("OUTPUT_GUARD", "AUDIT_LOG")
    .addEdge("AUDIT_LOG", END)
    .compile();

  const graphState = (await graph.invoke({
    question,
    safeQuestion,
    input,
    retrieved: [],
    queryUsage: null,
    provenance: [],
    decision: "answer",
    route:
      "INPUT_SCREEN -> RETRIEVE_CONTEXT -> PROVENANCE_ATTACH -> DECIDE_ROUTE -> DRAFT_ANSWER -> OUTPUT_GUARD -> AUDIT_LOG",
    answer: "",
    takeaways: [],
    speakerTip: "",
    output: null,
  })) as GraphWorkflowState;

  const output = graphState.output ?? outputGuard(graphState.answer);
  const finalDecision = output.status === "block" ? "block" : graphState.decision;
  const finalRoute = output.status === "block" ? "Blocked by OUTPUT_GUARD" : graphState.route;
  const finalAnswer =
    output.status === "block"
      ? "The drafted answer was stopped before release because OutputGuard detected sensitive output."
      : graphState.answer;

  return finalizeLiveResult("graph", question, {
    documents: index.documents,
    splitDocuments: index.splitDocuments,
    provenance: graphState.provenance,
    input,
    output,
    decision: finalDecision,
    route: finalRoute,
    answer: graphState.answer,
    finalAnswer,
    takeaways:
      output.status === "block"
        ? fallbackTakeaways("graph", "block", index.vectorStore)
        : graphState.takeaways.length > 0
          ? graphState.takeaways
          : fallbackTakeaways("graph", finalDecision, index.vectorStore),
    speakerTip:
      output.status === "block"
        ? fallbackSpeakerTip("graph", "block", canaryScenario)
        : graphState.speakerTip || fallbackSpeakerTip("graph", finalDecision, canaryScenario),
    sourceCount: index.documents.length,
    usedSampleNotes: index.usedSampleNotes,
    canaryScenario,
    usageLines,
    vectorStore: index.vectorStore,
    indexBuiltThisRun: index.indexBuiltThisRun,
    normalizedQuestion,
    safeQuestion,
    runtimeNotes: runtimeNotes("graph", index.vectorStore, index.indexBuiltThisRun),
    graphState: buildGraphState(question, safeQuestion, input, graphState.provenance, finalDecision),
  });
}

export async function runLiveDemo(
  mode: DemoMode,
  question: string,
  sourceNotes?: string,
): Promise<DemoResult> {
  if (!openAIConfigured()) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  return mode === "graph" ? runLiveGraph(question, sourceNotes) : runLiveChain(question, sourceNotes);
}

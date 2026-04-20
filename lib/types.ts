export type DemoMode = "chain" | "graph";
export type DemoRuntime = "local" | "openai";
export type Sensitivity = "open" | "team" | "sensitive";
export type GuardrailStatus = "allow" | "redact" | "block";
export type Decision = "answer" | "answer_with_redaction" | "review" | "block";

export type KnowledgeDocument = {
  id: string;
  title: string;
  source: string;
  sensitivity: Sensitivity;
  tags: string[];
  summary: string;
  body: string;
};

export type KnowledgeChunk = {
  id: string;
  documentId: string;
  title: string;
  source: string;
  sensitivity: Sensitivity;
  tags: string[];
  chunkIndex: number;
  body: string;
  summary: string;
};

export type ProvenanceItem = {
  id: string;
  title: string;
  source: string;
  sensitivity: Sensitivity;
  tags: string[];
  score: number;
  excerpt: string;
};

export type GuardCheck = {
  name: "InputGuard" | "OutputGuard";
  status: GuardrailStatus;
  reasons: string[];
  redactions: string[];
  triggeredRules: string[];
  checkedText: string;
};

export type GuardrailResult = {
  status: GuardrailStatus;
  reasons: string[];
  redactions: string[];
  piiDetected: boolean;
  requestedSensitiveData: boolean;
  canaryTriggered: boolean;
  input: GuardCheck;
  output: GuardCheck;
};

export type AuditEvent = {
  stage: string;
  detail: string;
  timestamp: string;
};

export type PipelineNode = {
  id: string;
  label: string;
  kind: "input" | "retrieval" | "provenance" | "governance" | "reasoning" | "audit" | "output" | "storage";
  status: "completed" | "warning" | "blocked";
  description: string;
  output?: string;
  estimatedTokens: number;
  estimatedCost: number;
};

export type CostLineItem = {
  nodeId: string;
  label: string;
  tokens: number;
  ratePerMillion: number;
  subtotal: number;
  inputTokens?: number;
  outputTokens?: number;
};

export type CostEstimate = {
  perInteraction: number;
  per1000: number;
  latencyMs: number;
  breakdown: CostLineItem[];
  assumptions: string[];
  costKind: "actual" | "simulated" | "none";
  latencyKind: "measured" | "simulated";
};

export type LiveUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  note: string;
  status: "used" | "not_configured" | "fallback";
};

export type ImplementationStatus = {
  engine: "simulated" | "langchain" | "langgraph";
  vectorStore: "simulated" | "pinecone" | "in_memory";
  indexBuiltThisRun: boolean;
  notes: string[];
};

export type GraphState = {
  stateType: string;
  question: string;
  safeQuestion: string;
  inputScreen: GuardrailStatus;
  retrievedSources: string[];
  provenanceAttached: boolean;
  decision: Decision;
  auditLogFields: string[];
};

export type DemoResult = {
  mode: DemoMode;
  runtime: DemoRuntime;
  question: string;
  normalizedQuestion: string;
  answer: string;
  decision: Decision;
  route: string;
  guardrails: GuardrailResult;
  provenance: ProvenanceItem[];
  audit: AuditEvent[];
  pipeline: PipelineNode[];
  cost: CostEstimate;
  takeaways: string[];
  speakerTip: string;
  sourceCount: number;
  usedSampleNotes: boolean;
  generatedAt: string;
  canaryScenario: boolean;
  graphState: GraphState | null;
  implementation: ImplementationStatus;
  liveUsage?: LiveUsage;
};

export type ComparisonRow = {
  dimension: string;
  chain: string;
  graph: string;
  recommendation: string;
};

export type AddSection = {
  heading: string;
  body: string;
  verdict?: "chosen" | "rejected" | "neutral";
};

export type PresentationPhase = {
  phase: string;
  title: string;
  summary: string;
  deliverable: string;
};

export type EvalCase = {
  id: string;
  question: string;
  note: string;
  expectedDecision: Decision;
  expectedSource?: string;
  expectedKeywords?: string[];
  minimumKeywordMatches?: number;
};

export type EvalRun = {
  id: string;
  question: string;
  note: string;
  expectedDecision: Decision;
  actualDecision: Decision;
  pass: boolean;
  topSource?: string;
  matchedKeywords: string[];
  per1000: number;
  latencyMs: number;
};

export type EvaluationReport = {
  mode: DemoMode;
  total: number;
  passed: number;
  accuracy: number;
  averagePer1000: number;
  averageLatencyMs: number;
  items: EvalRun[];
};

export type SlideEstimate = {
  chainPer1000: number;
  graphPer1000: number;
  note: string;
};

export type OverviewSource = "live" | "simulated";
export type OverviewStatus = "ready" | "running" | "error";

export type DemoOverview = {
  evaluations: {
    chain: EvaluationReport | null;
    graph: EvaluationReport | null;
  };
  slideEstimate: SlideEstimate;
  source: OverviewSource;
  status: OverviewStatus;
  notes: string[];
  updatedAt?: string;
};

export type StoredAuditRecord = {
  id: string;
  createdAt: string;
  mode: DemoMode;
  runtime: DemoRuntime;
  question: string;
  decision: Decision;
  guardrailStatus: GuardrailStatus;
  sourceCount: number;
  usedSampleNotes: boolean;
  sources: string[];
  latencyMs?: number;
  perInteractionCost?: number;
};

import type { CostEstimate, CostLineItem, DemoResult } from "@/lib/types";

type OpenAIModelPricing = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const knownOpenAIPricing: Array<{ prefix: string; pricing: OpenAIModelPricing }> = [
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
];

function readEnvPrice(name: string) {
  const raw = process.env[name];

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function resolveOpenAIModelPricing(model: string): OpenAIModelPricing | null {
  const envInput = readEnvPrice("OPENAI_INPUT_PRICE_PER_MILLION");
  const envOutput = readEnvPrice("OPENAI_OUTPUT_PRICE_PER_MILLION");

  if (envInput !== null && envOutput !== null) {
    return {
      inputPerMillion: envInput,
      outputPerMillion: envOutput,
    };
  }

  const match = knownOpenAIPricing.find((entry) => model.startsWith(entry.prefix));
  return match?.pricing ?? null;
}

function makeMeasuredCost(base: CostEstimate, overrides: Partial<CostEstimate>): CostEstimate {
  return {
    ...base,
    ...overrides,
    latencyKind: "measured",
  };
}

function averageRatePerMillion(tokens: number, subtotal: number) {
  if (tokens <= 0) {
    return 0;
  }

  return Number(((subtotal * 1_000_000) / tokens).toFixed(4));
}

function actualOpenAIBreakdown(result: DemoResult, perInteraction: number): CostLineItem[] {
  const usage = result.liveUsage;

  if (!usage || usage.status !== "used") {
    return [];
  }

  return [
    {
      nodeId: "OPENAI_EXPLAINER",
      label: `OpenAI usage (${usage.model})`,
      tokens: usage.totalTokens,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      ratePerMillion: averageRatePerMillion(usage.totalTokens, perInteraction),
      subtotal: perInteraction,
    },
  ];
}

export function applyObservedRunMetrics(result: DemoResult, latencyMs: number): DemoResult {
  const measuredLatency = Math.max(1, Math.round(latencyMs));

  if (result.cost.costKind === "actual") {
    return {
      ...result,
      cost: makeMeasuredCost(result.cost, {
        latencyMs: measuredLatency,
      }),
    };
  }

  if (result.runtime !== "openai") {
    return {
      ...result,
      cost: makeMeasuredCost(result.cost, {
        perInteraction: 0,
        per1000: 0,
          latencyMs: measuredLatency,
          breakdown: [],
          costKind: "none",
          assumptions: [
            "Measured end-to-end latency from request start to response.",
            "Local mode does not make a billable model API call, so external model cost is $0.00 in this run.",
            "The benchmark cards below compare this run against the presentation deck estimate.",
          ],
        }),
    };
  }

  const usage = result.liveUsage;

  if (usage?.status === "used") {
    const pricing = resolveOpenAIModelPricing(usage.model);

    if (!pricing) {
      return {
        ...result,
        cost: makeMeasuredCost(result.cost, {
          latencyMs: measuredLatency,
          costKind: "simulated",
          assumptions: [
            "Measured end-to-end latency from request start to response.",
            `Actual token usage was captured for ${usage.model}, but pricing is not configured for this model.`,
            "Set OPENAI_INPUT_PRICE_PER_MILLION and OPENAI_OUTPUT_PRICE_PER_MILLION to calculate billed cost exactly.",
          ],
        }),
      };
    }

    const perInteraction = Number(
      (
        (usage.inputTokens * pricing.inputPerMillion + usage.outputTokens * pricing.outputPerMillion) /
        1_000_000
      ).toFixed(6),
    );

    return {
      ...result,
      cost: makeMeasuredCost(result.cost, {
        perInteraction,
        per1000: Number((perInteraction * 1000).toFixed(2)),
        latencyMs: measuredLatency,
        breakdown: actualOpenAIBreakdown(result, perInteraction),
        costKind: "actual",
        assumptions: [
          "Measured end-to-end latency from request start to response.",
          `Billed cost is based on the actual OpenAI token usage returned by ${usage.model}.`,
          "Only the external model usage is billed in this fallback path. Retrieval, routing, and guards still run as local code.",
        ],
      }),
    };
  }

  return {
    ...result,
    cost: makeMeasuredCost(result.cost, {
      perInteraction: 0,
      per1000: 0,
      latencyMs: measuredLatency,
      breakdown: [],
      costKind: "none",
      assumptions: [
        "Measured end-to-end latency from request start to response.",
        usage?.status === "not_configured"
          ? "OPENAI mode was selected, but OPENAI_API_KEY is not configured, so no billable model call ran."
          : "The OpenAI call fell back to the local workflow, so no billable model call ran in this request.",
        "The benchmark cards below compare this run against the presentation deck estimate.",
      ],
    }),
  };
}

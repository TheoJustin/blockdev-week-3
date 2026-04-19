import OpenAI from "openai";
import type { DemoResult, LiveUsage } from "@/lib/types";

const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";

const explanationSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "takeaways", "speakerTip"],
  properties: {
    answer: {
      type: "string",
      description: "A short plain-language explanation of why this pattern fits the question.",
    },
    takeaways: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: {
        type: "string",
      },
      description: "Short plain-language points the speaker can use while presenting the result.",
    },
    speakerTip: {
      type: "string",
      description: "A one-sentence operator note explaining what to notice in the result.",
    },
  },
} as const;

function configured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function usageNote(status: LiveUsage["status"], note: string, usage?: Partial<LiveUsage>): LiveUsage {
  return {
    model: usage?.model ?? DEFAULT_OPENAI_MODEL,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    note,
    status,
  };
}

function extractStructuredText(response: OpenAI.Responses.Response) {
  for (const output of response.output) {
    if (output.type !== "message") {
      continue;
    }

    for (const item of output.content) {
      if (item.type === "refusal") {
        throw new Error(item.refusal);
      }

      if (item.type === "output_text") {
        return item.text;
      }
    }
  }

  throw new Error("No message text was returned.");
}

export function openAIStatus() {
  return {
    configured: configured(),
    model: DEFAULT_OPENAI_MODEL,
  };
}

export async function addOpenAIExplanation(baseResult: DemoResult): Promise<DemoResult> {
  if (!configured()) {
    return {
      ...baseResult,
      runtime: "openai",
      liveUsage: usageNote("not_configured", "OPENAI_API_KEY is not set, so the app used the built-in explainer."),
    };
  }

  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const response = await client.responses.create({
      model: DEFAULT_OPENAI_MODEL,
      store: false,
      max_output_tokens: 350,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text:
                "You explain AI architecture to developers in plain language. Keep answers concrete, short, and easy to understand. Do not invent sources. Use simple wording.",
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                `Pattern: ${baseResult.mode}`,
                `Question: ${baseResult.question}`,
                `Current decision: ${baseResult.decision}`,
                `Current route: ${baseResult.route}`,
                `Safety status: ${baseResult.guardrails.status}`,
                `Safety reasons: ${baseResult.guardrails.reasons.join(" | ")}`,
                `Top sources:`,
                ...baseResult.provenance.map(
                  (item, index) =>
                    `${index + 1}. ${item.title} (${item.sensitivity}) -> ${item.excerpt}`,
                ),
                `Fallback answer: ${baseResult.answer}`,
                "Return a short answer, 3 or 4 short takeaways, and one operator note.",
              ].join("\n"),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "demo_explanation",
          strict: true,
          schema: explanationSchema,
        } as never,
      },
    });

    const rawText = extractStructuredText(response);
    const parsed = JSON.parse(rawText) as {
      answer?: string;
      takeaways?: string[];
      speakerTip?: string;
    };

    return {
      ...baseResult,
      runtime: "openai",
      answer: parsed.answer?.trim() || baseResult.answer,
      takeaways:
        parsed.takeaways?.map((item) => item.trim()).filter(Boolean).slice(0, 4) || baseResult.takeaways,
      speakerTip: parsed.speakerTip?.trim() || baseResult.speakerTip,
      liveUsage: usageNote("used", `OpenAI wrote the final explanation using ${DEFAULT_OPENAI_MODEL}.`, {
        model: response.model,
        inputTokens: response.usage?.input_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      }),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The OpenAI call failed.";

    return {
      ...baseResult,
      runtime: "openai",
      liveUsage: usageNote("fallback", `The OpenAI call failed, so the app fell back to the built-in explainer. ${message}`),
    };
  }
}

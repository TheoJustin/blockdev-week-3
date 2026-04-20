# LangChain + LangGraph Demo

A Next.js teaching site that follows the presentation flow directly:

1. Build a minimal LangChain RAG path.
2. Port the same retrieval core into a LangGraph-style workflow.
3. Apply `InputGuard` and `OutputGuard`, including a canary leak drill.
4. Track per-node cost and export CSV.
5. Close with a six-section Architecture Decision Document.

The example product is a developer support assistant. It answers grounded product questions, blocks unsafe requests, and logs the reasoning trail so the audience can see why the system answered, reviewed, or blocked.

## Routes

- `/` is the guide and presentation map.
- `/workbench` is the live demo.
- `/add` is the final Architecture Decision Document.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Optional OpenAI setup

Create a local env file and add your key:

```bash
cp .env.example .env.local
```

Then fill in:

```bash
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4.1-mini
```

If `OPENAI_API_KEY` is missing, the site falls back to the local workflow automatically.
If `PINECONE_API_KEY` and `PINECONE_INDEX` are missing, live mode still works by using a real in-memory vector index.

## What makes the site useful for the talk

1. The questions, source notes, and architecture copy all match the presentation phases.
2. The same source corpus powers both the chain and graph flows, so the comparison stays fair.
3. The workbench includes a built-in 10-question evaluation suite.
4. Guardrails are visible as `InputGuard` and `OutputGuard`, including a canary leak test.
5. Cost is tracked per node and can be exported as CSV from the UI.
6. The ADD already follows a six-section structure with a chosen and rejected architecture.

## Project shape

- `app/page.tsx` explains the five presentation phases.
- `components/demo-shell.tsx` is the main phase-based workbench UI.
- `app/api/demo/route.ts` serves the live result, evaluation overview, and audit history.
- `lib/demo-engine.ts` runs the local LangChain-style and LangGraph-style flows.
- `lib/live-runtime.ts` runs the real LangChain and LangGraph workflows, live evaluation suite, and retrieval backends.
- `lib/demo-data.ts` contains the source notes, phase content, evaluation suite, and ADD text.
- `docs/architecture-decision-document.md` contains the written ADD.

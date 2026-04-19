# Architecture Decision Document

## 1. Context
We need a public demo for a developer support assistant that can answer grounded product questions, show how governance works, and stay easy to explain live. The site must mirror the presentation itself, not just describe the ideas abstractly.

## 2. Goals
- keep the first version simple enough to explain in one pass
- make provenance, privacy checks, and audit behavior visible
- compare cost and control between a straight retrieval flow and a graph-based flow
- end with a production-ready architecture decision instead of a vague conclusion

## 3. Options
### Option A: Chain only
Good:
- fastest to build
- cheapest to run
- easiest introduction to RAG

Bad:
- governance logic gets hidden in helper code
- harder to show review and audit steps clearly
- weaker fit for risky support requests

### Option B: Graph only
Good:
- governance is explicit from the start
- provenance and review fit naturally into the workflow
- easier to explain why the system answered, reviewed, or blocked

Bad:
- adds overhead to routine questions
- increases cost and latency everywhere
- makes the simple part of the story harder than it needs to be

### Option C: Hybrid
Good:
- keeps low-risk retrieval simple
- makes risky flows auditable and explicit
- lets both paths share one corpus, one guardrail policy, and one audit format

Bad:
- two orchestration patterns to maintain
- requires teams to choose the right path per use case

## 4. Decision
Choose the hybrid architecture. Use LangChain RAG for low-risk retrieval questions that only need loader, splitter, Pinecone, and RetrievalQA. Use a LangGraph-style flow when the product needs explicit `INPUT_SCREEN`, provenance, routing, `OUTPUT_GUARD`, or `AUDIT_LOG` nodes.

## 5. Rejected Alternative
Reject graph-only for every interaction. It gives maximum control, but it adds unnecessary complexity and extra cost to the routine documentation questions that a simple retrieval chain can already answer well.

## 6. Rollout and Metrics
1. Start with the minimal LangChain RAG path and run the 10-question evaluation suite.
2. Port the same retrieval core into the LangGraph-style flow with explicit governance nodes.
3. Apply `InputGuard` and `OutputGuard`, then confirm the canary leak drill blocks release.
4. Track per-node token estimates, export CSV, and compare totals against the presentation benchmark.
5. Expand graph orchestration only where the measured governance value is worth the extra cost.

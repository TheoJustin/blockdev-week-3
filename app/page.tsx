import Link from "next/link";
import { ArrowRight, FileText, Shield, Target, Workflow } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { demoScenarios, evaluationQuestions, presentationPhases } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

const quickStory = [
  "The use case is a developer support assistant with real docs, policies, and audit needs.",
  "Phase 1 starts with the smallest believable LangChain RAG system.",
  "Phase 2 ports the same retrieval core into a LangGraph-style governance flow.",
  "Phase 3 proves the guardrails by blocking a secret request and a canary leak drill.",
  "Phase 4 makes cost visible with per-node token estimates and CSV export.",
  "Phase 5 ends with a six-section Architecture Decision Document.",
];

const demoHighlights = [
  {
    title: "Real questions",
    description: "The sample prompts come from the talk itself, so the audience sees the same language on the site and in the presentation.",
    icon: Target,
  },
  {
    title: "Real controls",
    description: "The workbench shows provenance, input screening, output screening, audit logging, and cost in one place.",
    icon: Shield,
  },
  {
    title: "Real close",
    description: "The ADD page turns the demo into a defendable architecture decision instead of ending on a vague opinion.",
    icon: FileText,
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader current="home" />

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_360px]">
          <Card className="border-border/70 bg-card/95">
            <CardContent className="flex flex-col gap-8 p-8 sm:p-10">
              <div className="space-y-5">
                <Badge className="w-fit rounded-full" variant="outline">
                  LangChain & LangGraph in production GenAI systems
                </Badge>
                <div className="space-y-4">
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                    A real demo site that follows the presentation phase by phase.
                  </h1>
                  <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                    This site is built for explaining one concrete story: start with a minimal
                    LangChain RAG system, port it to a LangGraph-style governed flow, prove the
                    guardrails, compare cost, and finish with a clear architecture decision.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link className={cn(buttonVariants({ size: "lg" }), "rounded-full")} href="/workbench">
                  Open the live demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  className={cn(buttonVariants({ size: "lg", variant: "outline" }), "rounded-full")}
                  href="/add"
                >
                  Read the ADD
                </Link>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {demoHighlights.map((item) => {
                  const Icon = item.icon;

                  return (
                    <Card className="border-border/70 bg-muted/30 shadow-none" key={item.title}>
                      <CardContent className="flex h-full flex-col gap-4 p-5">
                        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-background text-foreground">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="space-y-2">
                          <p className="text-sm font-semibold tracking-tight">{item.title}</p>
                          <p className="text-sm leading-6 text-muted-foreground">{item.description}</p>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card className="border-border/70 bg-card/95">
              <CardHeader>
                <Badge className="w-fit rounded-full" variant="secondary">
                  Real use case
                </Badge>
                <CardTitle className="text-2xl">Developer support assistant</CardTitle>
                <CardDescription className="text-sm leading-6">
                  The assistant answers grounded product questions, routes risky requests to review,
                  and never releases secrets or canary test strings.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">
                    Safe question
                  </p>
                  <p className="text-sm font-medium leading-6 text-emerald-950">{demoScenarios[0]}</p>
                </div>
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-amber-700">
                    Guardrail question
                  </p>
                  <p className="text-sm font-medium leading-6 text-amber-950">{demoScenarios[3]}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/70 bg-primary text-primary-foreground">
              <CardContent className="space-y-4 p-6">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary-foreground/10">
                  <Workflow className="h-4 w-4" />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium uppercase tracking-[0.18em] text-primary-foreground/70">
                    Why this format works
                  </p>
                  <h2 className="text-2xl font-semibold tracking-tight">
                    One corpus, two architectures, one decision.
                  </h2>
                </div>
                <p className="text-sm leading-6 text-primary-foreground/80">
                  That is the whole story of the talk, and the site now keeps that same story from
                  the landing page all the way to the closing ADD.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant="outline">
                Presentation map
              </Badge>
              <CardTitle className="text-2xl">The five phases the audience will see</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                The site is structured around the actual presentation instead of a generic AI app layout.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {presentationPhases.map((phase) => (
                <Card className="border-border/70 bg-muted/25 shadow-none" key={phase.phase}>
                  <CardContent className="space-y-3 p-5">
                    <Badge className="w-fit rounded-full" variant="secondary">
                      {phase.phase}
                    </Badge>
                    <div className="space-y-2">
                      <p className="text-sm font-semibold">{phase.title}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{phase.summary}</p>
                    </div>
                    <p className="text-xs leading-5 text-muted-foreground">{phase.deliverable}</p>
                  </CardContent>
                </Card>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant="outline">
                Suggested walkthrough
              </Badge>
              <CardTitle className="text-2xl">A simple talk track that matches the product</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                If you want a clean live flow, this order will keep the story easy to follow.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {quickStory.map((item, index) => (
                <div className="flex gap-4 rounded-2xl border border-border/70 bg-muted/30 p-4" key={item}>
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-background text-sm font-semibold text-foreground">
                    {index + 1}
                  </div>
                  <p className="pt-1 text-sm leading-6 text-muted-foreground">{item}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/95">
            <CardHeader>
              <Badge className="w-fit rounded-full" variant="secondary">
                Test suite
              </Badge>
              <CardTitle className="text-2xl">{evaluationQuestions.length} built-in evaluation prompts</CardTitle>
              <CardDescription className="text-sm leading-6">
                The workbench already includes the same test logic used for the Phase 1 check.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {evaluationQuestions.slice(0, 4).map((item) => (
                <div className="rounded-2xl border border-border/70 bg-muted/25 p-4" key={item.id}>
                  <p className="text-sm font-medium leading-6">{item.question}</p>
                </div>
              ))}
              <Link
                className={cn(buttonVariants({ size: "lg", variant: "outline" }), "w-full rounded-full")}
                href="/workbench"
              >
                Open the demo
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}

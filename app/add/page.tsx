import Link from "next/link";
import { ArrowRight, FileText } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addSections, architectureChoices } from "@/lib/demo-data";
import { cn } from "@/lib/utils";

export default function AddPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <SiteHeader current="add" />

        <Card className="border-border/70 bg-card/95">
          <CardContent className="grid gap-6 p-8 sm:p-10 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              <Badge className="w-fit rounded-full" variant="outline">
                Architecture Decision Document
              </Badge>
              <div className="space-y-4">
                <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                  Choose the hybrid architecture: LangChain RAG first, LangGraph for governed flows.
                </h1>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                  This page is the close of the demo. It records the actual decision, the rejected
                  alternative, and the rollout logic in the same six-section structure used in the
                  presentation.
                </p>
              </div>
            </div>

            <Card className="border-border/70 bg-muted/35 shadow-none">
              <CardContent className="flex h-full flex-col justify-between gap-6 p-6">
                <div className="space-y-4">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-background text-foreground">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="space-y-2">
                    <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Best use
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Use this page right after the cost comparison to make the architecture choice feel grounded.
                    </p>
                  </div>
                </div>

                <Link
                  className={cn(buttonVariants({ size: "lg" }), "w-full rounded-full")}
                  href="/workbench"
                >
                  Open the demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </CardContent>
            </Card>
          </CardContent>
        </Card>

        <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {addSections.map((section) => (
            <Card className="border-border/70 bg-card/95" key={section.heading}>
              <CardHeader>
                <Badge
                  className="w-fit rounded-full"
                  variant={
                    section.verdict === "chosen"
                      ? "success"
                      : section.verdict === "rejected"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {section.heading}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-2">
                <CardTitle className="text-xl">{section.heading}</CardTitle>
                <CardDescription className="text-sm leading-6">{section.body}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <Card className="border-border/70 bg-card/95">
          <CardHeader>
            <Badge className="w-fit rounded-full" variant="outline">
              Decision summary
            </Badge>
            <CardTitle className="text-2xl">What changes when you move from LangChain to LangGraph</CardTitle>
            <CardDescription className="max-w-3xl text-sm leading-6">
              This is the short table version of the ADD. It is useful when you need a quick
              architecture close without replaying the live workbench.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimension</TableHead>
                  <TableHead>LangChain RAG</TableHead>
                  <TableHead>LangGraph flow</TableHead>
                  <TableHead>Recommendation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {architectureChoices.map((row) => (
                  <TableRow key={row.dimension}>
                    <TableCell className="font-medium">{row.dimension}</TableCell>
                    <TableCell className="text-muted-foreground">{row.chain}</TableCell>
                    <TableCell className="text-muted-foreground">{row.graph}</TableCell>
                    <TableCell className="text-muted-foreground">{row.recommendation}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LangChain + LangGraph Workbench",
  description:
    "A Next.js workflow reference app that shows LangChain RAG, LangGraph governance, guardrails, cost tracking, and architecture decisions with a developer support use case.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LangChain + LangGraph Demo",
  description:
    "A Next.js demo site that follows a LangChain and LangGraph presentation phase by phase with a real developer support use case.",
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

import Link from "next/link";
import { Workflow } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SiteHeaderProps = {
  current: "home" | "workbench" | "add";
};

const navigation = [
  { href: "/", label: "Guide", value: "home" },
  { href: "/workbench", label: "Demo", value: "workbench" },
  { href: "/add", label: "ADD", value: "add" },
] as const;

export function SiteHeader({ current }: SiteHeaderProps) {
  return (
    <header className="sticky top-4 z-20">
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/85 px-4 py-3 shadow-sm backdrop-blur">
        <Link className="inline-flex items-center gap-3" href="/">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Workflow className="h-4 w-4" />
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight">LangChain + LangGraph Demo</span>
            <span className="text-xs text-muted-foreground">Phase-by-phase teaching site</span>
          </span>
        </Link>

        <nav className="flex flex-wrap items-center gap-2" aria-label="Primary">
          {navigation.map((item) => (
            <Link
              className={cn(
                buttonVariants({
                  size: "sm",
                  variant: item.value === current ? "secondary" : "ghost",
                }),
                "rounded-full",
              )}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

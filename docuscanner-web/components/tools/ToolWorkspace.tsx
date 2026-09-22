"use client";

// The page body for one tool: heading, a short instruction, the login gate (only
// for tools that ask for a free account) and the tool itself. The editor and the
// compressors are loaded on demand, so the Tools hub stays light.

import dynamic from "next/dynamic";
import { useEffect } from "react";
import Link from "next/link";
import { Hint } from "@/components/guidance/Hint";
import { ToolGate } from "@/components/tools/ToolGate";
import { getUserPlan, isFeatureAvailable } from "@/utils/features/plans";
import { trackToolOpened } from "@/utils/analytics/events";
import { useAuth } from "@/components/auth/AuthProvider";
import type { ToolDef } from "@/utils/tools/registry";

const ScannerWorkspace = dynamic(() => import("@/components/scanner/ScannerWorkspace").then((m) => m.ScannerWorkspace), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>,
});

const CompressTool = dynamic(() => import("@/components/tools/CompressTool").then((m) => m.CompressTool), {
  ssr: false,
  loading: () => <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading…</p>,
});

// `heading` lets the page override the H1 with the fuller, search-intent-matching
// wording from utils/seo/landing.ts (e.g. "Compress PDF online" rather than the Tools
// menu's short "Compress PDF") without ToolWorkspace itself needing to know about SEO
// copy. The Tools-menu breadcrumb keeps `tool.title`, which is the right length for it.
export function ToolWorkspace({ tool, heading }: { tool: ToolDef; heading?: string }) {
  const { user } = useAuth();
  const available = isFeatureAvailable(tool.feature, getUserPlan(user));

  useEffect(() => {
    void trackToolOpened(tool.id);
  }, [tool.id]);

  return (
    <div className="space-y-4">
      <nav aria-label="Breadcrumb" className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href="/tools" className="inline-flex min-h-11 min-w-11 items-center justify-center hover:underline">
          Tools
        </Link>
        <span aria-hidden> / </span>
        <span>{tool.title}</span>
      </nav>
      <div>
        <h1 className="page-title">{heading ?? tool.title}</h1>
        <p className="muted mt-1 text-sm">{tool.body}</p>
      </div>

      {!available ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This tool isn&apos;t available right now.</p>
      ) : (
        <ToolGate tool={tool}>
          {tool.kind === "editor" ? (
            <>
              <Hint id={`tool-${tool.id}`}>{tool.guide}</Hint>
              <ScannerWorkspace intent={{ tool: tool.editor.tool, signatureTab: tool.editor.signatureTab, guide: tool.guide }} />
            </>
          ) : (
            <CompressTool kind={tool.compress} />
          )}
        </ToolGate>
      )}
    </div>
  );
}

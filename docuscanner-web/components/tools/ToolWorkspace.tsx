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
import { PageTip } from "@/components/guidance/PageTip";
import type { PageTipId } from "@/components/guidance/pageTips";

// The Help tips page tip for a tool (editor tools have the scanner's own step-by-step tips instead).
function pageTipFor(tool: ToolDef): PageTipId | null {
  if (tool.kind === "compress") return tool.compress === "pdf" ? "page-compress-pdf" : tool.compress === "image" ? "page-compress-image" : "page-compress-office";
  if (tool.kind === "protect") return tool.focus === "pdf" ? "page-protect-pdf" : null;
  if (tool.kind === "image-edit") return "page-edit-image";
  return null;
}

// While a tool's code loads, its place is held at about the height of the tool's empty
// state (measured at phone and desktop widths), so the explanation under it doesn't jump
// down when the tool appears. A one-line placeholder caused a layout shift (CLS 0.14-0.34)
// on every tool page.
const Loading = ({ className }: { className: string }) => (
  <p role="status" className={`text-sm text-zinc-500 dark:text-zinc-400 ${className}`}>
    Loading…
  </p>
);

const ScannerWorkspace = dynamic(() => import("@/components/scanner/ScannerWorkspace").then((m) => m.ScannerWorkspace), {
  ssr: false,
  loading: () => <Loading className="min-h-[482px] sm:min-h-[422px]" />,
});

const CompressTool = dynamic(() => import("@/components/tools/CompressTool").then((m) => m.CompressTool), {
  ssr: false,
  loading: () => <Loading className="min-h-[224px] sm:min-h-[204px]" />,
});

const ImageEditTool = dynamic(() => import("@/components/tools/ImageEditTool").then((m) => m.ImageEditTool), {
  ssr: false,
  loading: () => <Loading className="min-h-[264px] sm:min-h-[204px]" />,
});

const ProtectTool = dynamic(() => import("@/components/tools/ProtectTool").then((m) => m.ProtectTool), {
  ssr: false,
  loading: () => <Loading className="min-h-[290px] sm:min-h-[250px]" />,
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

      {available && pageTipFor(tool) && <PageTip id={pageTipFor(tool)!} />}

      {!available ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">This tool isn&apos;t available right now.</p>
      ) : (
        <ToolGate tool={tool}>
          {tool.kind === "editor" ? (
            <>
              <Hint id={`tool-${tool.id}`}>{tool.guide}</Hint>
              <ScannerWorkspace intent={{ tool: tool.editor.tool, signatureTab: tool.editor.signatureTab, guide: tool.guide }} />
            </>
          ) : tool.kind === "image-edit" ? (
            <ImageEditTool />
          ) : tool.kind === "protect" ? (
            <ProtectTool focus={tool.focus} />
          ) : (
            // Compress PDF's empty state is a line taller than the other compressors'.
            <div className={tool.compress === "pdf" ? "min-h-[264px] sm:min-h-[224px]" : undefined}>
              <CompressTool kind={tool.compress} />
            </div>
          )}
        </ToolGate>
      )}
    </div>
  );
}

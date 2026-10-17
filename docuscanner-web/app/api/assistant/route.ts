// "Ask FreePDFScanner" help assistant. All the logic, limits and the model call live in
// utils/assistant/server.ts; this file only wires them to the environment. The model key
// (ANTHROPIC_API_KEY) is read here, on the server, and never leaves it.

import { configFromEnv, handleGet, handlePost, type Deps } from "@/utils/assistant/server";

export const runtime = "nodejs";

function deps(): Deps {
  return { config: configFromEnv(process.env), fetchImpl: fetch, now: Date.now };
}

export async function GET() {
  return handleGet(deps());
}

export async function POST(request: Request) {
  return handlePost(request, deps());
}

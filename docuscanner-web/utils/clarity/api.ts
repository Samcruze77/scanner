// Microsoft Clarity Data Export API -- pure request/response handling.
//
// Documented limits (Microsoft Learn, "Clarity Data Export API"):
//   * GET https://www.clarity.ms/export-data/api/v1/project-live-insights
//   * numOfDays is 1, 2 or 3: only the LAST 24/48/72 hours are available, so
//     Clarity cannot answer an arbitrary historical date range.
//   * at most 3 dimensions per request (dimension1..dimension3)
//   * at most 10 requests per project per day; max 1,000 rows, no paging
//   * dimensions: Browser, Device, Country/Region, OS, Source, Medium,
//     Campaign, Channel, URL. There is NO state or city dimension in the API,
//     so Clarity data here is at country level only.
//
// The response schema is not asserted field by field: every numeric/text
// field Clarity returns for a metric is kept under `<Metric>.<field>`, and
// nothing is invented. A few well-known fields get short aliases only when
// they are actually present (see ALIASES).

export const CLARITY_DIMENSIONS = [
  { value: "Country/Region", key: "country", label: "Country / Region" },
  { value: "Device", key: "device", label: "Device" },
  { value: "Browser", key: "browser", label: "Browser" },
  { value: "OS", key: "os", label: "Operating system" },
  { value: "Source", key: "traffic_source", label: "Traffic source" },
  { value: "Medium", key: "medium", label: "Medium" },
  { value: "Campaign", key: "utm_campaign", label: "Campaign (UTM)" },
  { value: "Channel", key: "channel", label: "Channel" },
  { value: "URL", key: "url", label: "URL" },
] as const;

export type ClarityDimension = (typeof CLARITY_DIMENSIONS)[number]["value"];
export const CLARITY_DAYS = [1, 2, 3] as const;
export const MAX_CLARITY_DIMENSIONS = 3;
export const CLARITY_ENDPOINT = "https://www.clarity.ms/export-data/api/v1/project-live-insights";

export interface ClarityRequest {
  numOfDays: 1 | 2 | 3;
  dimensions: ClarityDimension[];
}

// Validates and normalizes user input; never passes an unknown dimension on.
export function parseClarityRequest(params: URLSearchParams): ClarityRequest | { error: string } {
  const days = Number(params.get("clarity_days") ?? "3");
  if (!(CLARITY_DAYS as readonly number[]).includes(days)) return { error: "clarity_days must be 1, 2 or 3 (Clarity only exposes the last 72 hours)" };
  const raw = (params.get("clarity_dimensions") ?? "Country/Region").split(",").map((s) => s.trim()).filter(Boolean);
  const dimensions: ClarityDimension[] = [];
  for (const value of raw) {
    const known = CLARITY_DIMENSIONS.find((d) => d.value.toLowerCase() === value.toLowerCase());
    if (!known) return { error: `Unsupported Clarity dimension "${value}"` };
    if (!dimensions.includes(known.value)) dimensions.push(known.value);
  }
  if (dimensions.length === 0 || dimensions.length > MAX_CLARITY_DIMENSIONS) return { error: `Choose 1 to ${MAX_CLARITY_DIMENSIONS} Clarity dimensions` };
  return { numOfDays: days as 1 | 2 | 3, dimensions };
}

export function buildClarityUrl(req: ClarityRequest): string {
  const url = new URL(CLARITY_ENDPOINT);
  url.searchParams.set("numOfDays", String(req.numOfDays));
  req.dimensions.forEach((d, i) => url.searchParams.set(`dimension${i + 1}`, d));
  return url.toString();
}

// Response keys Clarity uses for each dimension (matched case-insensitively).
const DIMENSION_KEYS: Record<ClarityDimension, string[]> = {
  "Country/Region": ["country", "countryregion", "country/region", "region"],
  Device: ["device"],
  Browser: ["browser"],
  OS: ["os"],
  Source: ["source"],
  Medium: ["medium"],
  Campaign: ["campaign"],
  Channel: ["channel"],
  URL: ["url"],
};

const ALIASES: Record<string, string> = {
  "Traffic.totalSessionCount": "sessions",
  "Traffic.distantUserCount": "users",
  "EngagementTime.totalTime": "engagement_time",
};

export interface ClarityRow {
  // Dimension values by canonical report key (country, device, ...).
  dimensions: Record<string, string | null>;
  // Metric fields as returned: "<Metric>.<field>" -> value.
  metrics: Record<string, string | number | null>;
}

function scalar(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return value.trim() !== "" && Number.isFinite(n) ? n : value;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return null; // nested structures are not flattened blindly
}

// Pivots Clarity's per-metric blocks into one row per dimension combination.
export function normalizeClarityResponse(body: unknown, dimensions: ClarityDimension[]): ClarityRow[] {
  if (!Array.isArray(body)) return [];
  const rows = new Map<string, ClarityRow>();
  for (const block of body as { metricName?: unknown; information?: unknown }[]) {
    const metric = typeof block?.metricName === "string" ? block.metricName : null;
    if (!metric || !Array.isArray(block.information)) continue;
    for (const info of block.information as Record<string, unknown>[]) {
      if (!info || typeof info !== "object") continue;
      const dims: Record<string, string | null> = {};
      const used = new Set<string>();
      for (const d of dimensions) {
        const spec = CLARITY_DIMENSIONS.find((x) => x.value === d)!;
        const field = Object.keys(info).find((k) => DIMENSION_KEYS[d].includes(k.toLowerCase()));
        if (field) used.add(field);
        const v = field ? info[field] : null;
        dims[spec.key] = typeof v === "string" && v.trim() ? v : null;
      }
      const id = dimensions.map((d) => dims[CLARITY_DIMENSIONS.find((x) => x.value === d)!.key] ?? "").join("\u0001");
      let row = rows.get(id);
      if (!row) {
        row = { dimensions: dims, metrics: {} };
        rows.set(id, row);
      }
      for (const [field, value] of Object.entries(info)) {
        if (used.has(field)) continue;
        const cell = scalar(value);
        if (cell !== null) row.metrics[`${metric}.${field}`] = cell;
      }
    }
  }
  return [...rows.values()].sort((a, b) => JSON.stringify(a.dimensions).localeCompare(JSON.stringify(b.dimensions)));
}

export function aliasFor(metricColumn: string): string | null {
  return ALIASES[metricColumn] ?? null;
}

export function windowFor(numOfDays: number, now: Date = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (numOfDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

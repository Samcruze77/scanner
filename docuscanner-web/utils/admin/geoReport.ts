// The Geography report and the report-preview summary. Both are computed from
// the SAME filtered record stream the raw export walks (exportPaging.ts), so
// the preview totals, the aggregated report and the raw files can never
// disagree about which records are in scope. Pure: no I/O.
//
// Only metrics the analytics schema really has are produced:
//   visitors  = distinct visitor_id   (analytics events only; ad events carry none)
//   sessions  = distinct session_id   (events and ad events)
//   events / page_views / conversions from analytics_events.event_name
//   ad_impressions / ad_clicks from ad_events.event_type

import type { ExportRecord } from "../../supabase/functions/_shared/exportRows.ts";

export const GEO_REPORT_FIELDS = [
  "date",
  "country_code",
  "country",
  "state_province",
  "state_province_name",
  "city_town",
  "county_district_lga",
  "neighborhood_suburb",
  "postal_code",
  "location_source",
  "device_type",
  "browser",
  "visitors",
  "sessions",
  "events",
  "page_views",
  "ad_impressions",
  "ad_clicks",
  "conversions",
  "first_event_at",
  "last_event_at",
] as const;

export type GeoReportRow = Record<(typeof GEO_REPORT_FIELDS)[number], string | number | null>;

interface Group {
  key: Record<string, string | null>;
  visitors: Set<string>;
  sessions: Set<string>;
  events: number;
  pageViews: number;
  impressions: number;
  clicks: number;
  conversions: number;
  hasEvents: boolean;
  hasAds: boolean;
  first: string;
  last: string;
}

const KEY_FIELDS = ["country_code", "state_province", "city_town", "county_district_lga", "neighborhood_suburb", "postal_code", "location_source", "device_type", "browser"] as const;

export class GeoReportBuilder {
  private groups = new Map<string, Group>();

  add(record: ExportRecord) {
    const occurred = String(record.occurred_at ?? "");
    const date = occurred.slice(0, 10);
    const key: Record<string, string | null> = { date };
    for (const f of KEY_FIELDS) key[f] = (record[f] as string | null) ?? null;
    const id = [date, ...KEY_FIELDS.map((f) => key[f] ?? "")].join("\u0001");
    let g = this.groups.get(id);
    if (!g) {
      g = { key, visitors: new Set(), sessions: new Set(), events: 0, pageViews: 0, impressions: 0, clicks: 0, conversions: 0, hasEvents: false, hasAds: false, first: occurred, last: occurred };
      this.groups.set(id, g);
    }
    if (record.visitor_id) g.visitors.add(String(record.visitor_id));
    if (record.session_id) g.sessions.add(String(record.session_id));
    if (record.record_type === "analytics_event") {
      g.hasEvents = true;
      g.events += 1;
      if (record.event_name === "page_view") g.pageViews += 1;
      g.conversions += Number(record.conversions ?? 0);
    } else {
      g.hasAds = true;
      g.impressions += Number(record.impressions ?? 0);
      g.clicks += Number(record.clicks ?? 0);
    }
    if (occurred < g.first) g.first = occurred;
    if (occurred > g.last) g.last = occurred;
  }

  // Deterministic order: date, then the geography path, then device/browser.
  rows(): GeoReportRow[] {
    return [...this.groups.values()]
      .sort((a, b) => {
        for (const f of ["date", ...KEY_FIELDS]) {
          const x = a.key[f] ?? "";
          const y = b.key[f] ?? "";
          if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
      })
      .map((g) => ({
        date: g.key.date,
        country_code: g.key.country_code,
        country: null, // display names are added by the caller from the codes
        state_province: g.key.state_province,
        state_province_name: null,
        city_town: g.key.city_town,
        county_district_lga: g.key.county_district_lga,
        neighborhood_suburb: g.key.neighborhood_suburb,
        postal_code: g.key.postal_code,
        location_source: g.key.location_source,
        device_type: g.key.device_type,
        browser: g.key.browser,
        // Empty (not 0) where the source has no such measurement.
        visitors: g.hasEvents ? g.visitors.size : null,
        sessions: g.sessions.size || (g.hasEvents || g.hasAds ? 0 : null),
        events: g.hasEvents ? g.events : null,
        page_views: g.hasEvents ? g.pageViews : null,
        ad_impressions: g.hasAds ? g.impressions : null,
        ad_clicks: g.hasAds ? g.clicks : null,
        conversions: g.hasEvents ? g.conversions : null,
        first_event_at: g.first,
        last_event_at: g.last,
      }));
  }
}

export interface ReportSummary {
  records: number;
  event_records: number;
  ad_records: number;
  // Present only when the dataset that measures them is part of the report.
  visitors: number | null;
  sessions: number | null;
  page_views: number | null;
  conversions: number | null;
  ad_impressions: number | null;
  ad_clicks: number | null;
  first_record_at: string | null;
  last_record_at: string | null;
}

export class SummaryBuilder {
  private visitors = new Set<string>();
  private sessions = new Set<string>();
  private s = { records: 0, events: 0, ads: 0, pageViews: 0, conversions: 0, impressions: 0, clicks: 0 };
  private first: string | null = null;
  private last: string | null = null;

  add(record: ExportRecord) {
    this.s.records += 1;
    if (record.visitor_id) this.visitors.add(String(record.visitor_id));
    if (record.session_id) this.sessions.add(String(record.session_id));
    if (record.record_type === "analytics_event") {
      this.s.events += 1;
      if (record.event_name === "page_view") this.s.pageViews += 1;
      this.s.conversions += Number(record.conversions ?? 0);
    } else {
      this.s.ads += 1;
      this.s.impressions += Number(record.impressions ?? 0);
      this.s.clicks += Number(record.clicks ?? 0);
    }
    const at = String(record.occurred_at ?? "");
    if (at && (!this.first || at < this.first)) this.first = at;
    if (at && (!this.last || at > this.last)) this.last = at;
  }

  // `datasets` says which datasets the report covers, so a metric is reported
  // only if its source is in scope (never a misleading zero).
  result(datasets: ("events" | "ads")[]): ReportSummary {
    const events = datasets.includes("events");
    const ads = datasets.includes("ads");
    return {
      records: this.s.records,
      event_records: this.s.events,
      ad_records: this.s.ads,
      visitors: events ? this.visitors.size : null,
      sessions: this.sessions.size,
      page_views: events ? this.s.pageViews : null,
      conversions: events ? this.s.conversions : null,
      ad_impressions: ads ? this.s.impressions : null,
      ad_clicks: ads ? this.s.clicks : null,
      first_record_at: this.first,
      last_record_at: this.last,
    };
  }
}

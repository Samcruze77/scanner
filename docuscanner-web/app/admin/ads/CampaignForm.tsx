"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createCampaignBrowser, updateCampaignBrowser } from "@/utils/admin/ads.browser";
import type { AdCampaign, AdCreative, CampaignFormFields } from "@/utils/admin/ads";
import { AD_SLOTS, TARGETABLE_PATHS } from "@/utils/admin/targetablePaths";
import { getCountryOptions, getRegionsForCountries } from "@/utils/admin/geoData";
import { countryFlag, countryName } from "@/utils/admin/location";

const DAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const EMBED_HOST_ALLOWLIST = ["youtube.com", "youtube-nocookie.com", "vimeo.com"];

function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtDateShort(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function emptyCreative(): AdCreative {
  return {
    slot_code: "bottom",
    device_variant: "all",
    asset_url: "",
    click_url: "",
    alt_text: "",
    title: "",
    description: "",
    cta_text: "",
    width: null,
    height: null,
    is_active: true,
    destination_type: "link",
    embed_url: null,
  };
}

export function CampaignForm({ existing, creatives: existingCreatives }: { existing?: AdCampaign; creatives?: AdCreative[] }) {
  const router = useRouter();
  const [name, setName] = useState(existing?.name ?? "");
  const [advertiserName, setAdvertiserName] = useState(existing?.advertiser_name ?? "");
  const [startsAt, setStartsAt] = useState(toLocalInput(existing?.starts_at) || toLocalInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(toLocalInput(existing?.ends_at));
  const [timezone, setTimezone] = useState(existing?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [targetCountries, setTargetCountries] = useState<string[]>(existing?.target_countries ?? []);
  const [targetRegions, setTargetRegions] = useState<string[]>(existing?.target_regions ?? []);
  const [countryFilter, setCountryFilter] = useState("");
  const [customRegion, setCustomRegion] = useState("");
  const [targetPaths, setTargetPaths] = useState<string[]>(existing?.target_paths ?? []);
  const [targetDevices, setTargetDevices] = useState<string[]>(existing?.target_devices ?? []);
  const [priority, setPriority] = useState(existing?.priority ?? 5);
  const [frequencyCap, setFrequencyCap] = useState<string>(existing?.frequency_cap_per_session?.toString() ?? "");
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(existing?.days_of_week ?? []);
  const [startTime, setStartTime] = useState(existing?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(existing?.end_time?.slice(0, 5) ?? "");
  const [creatives, setCreatives] = useState<AdCreative[]>(existingCreatives && existingCreatives.length > 0 ? existingCreatives : [emptyCreative()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const countryOptions = useMemo(() => getCountryOptions(), []);
  const filteredCountries = useMemo(() => {
    const q = countryFilter.trim().toLowerCase();
    if (!q) return countryOptions;
    return countryOptions.filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
  }, [countryOptions, countryFilter]);
  const curatedRegions = useMemo(() => getRegionsForCountries(targetCountries).filter((r) => !targetRegions.includes(r)), [targetCountries, targetRegions]);

  function toggle(list: string[], value: string, setList: (v: string[]) => void) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }
  function toggleDay(value: number) {
    setDaysOfWeek((d) => (d.includes(value) ? d.filter((v) => v !== value) : [...d, value]));
  }

  function updateCreative(index: number, patch: Partial<AdCreative>) {
    setCreatives((list) => list.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  // Plain-language summary of exactly where this campaign will run, so the
  // targeting configuration is legible before activation rather than just a
  // pile of filters.
  const targetingSummary = useMemo(() => {
    const parts: string[] = [];
    if (targetCountries.length === 0) {
      parts.push("Worldwide");
    } else {
      const countryLabel = targetCountries.map((code) => `${countryFlag(code) ?? ""} ${countryName(code) ?? code}`.trim()).join(", ");
      parts.push(targetRegions.length > 0 ? `${countryLabel} → ${targetRegions.join(", ")}` : countryLabel);
    }
    parts.push(targetDevices.length > 0 ? targetDevices.join(" + ") : "All devices");
    parts.push(
      targetPaths.length > 0
        ? targetPaths.map((p) => TARGETABLE_PATHS.find((t) => t.path === p)?.label ?? p).join(" + ")
        : "Entire site",
    );
    if (startsAt && endsAt) parts.push(`${fmtDateShort(new Date(startsAt).toISOString())}–${fmtDateShort(new Date(endsAt).toISOString())}`);
    return parts.join(" · ");
  }, [targetCountries, targetRegions, targetDevices, targetPaths, startsAt, endsAt]);

  async function submit() {
    setError(null);
    if (!startsAt || !endsAt) {
      setError("Start and end dates are required.");
      return;
    }
    const fields: CampaignFormFields = {
      name,
      advertiser_name: advertiserName,
      starts_at: new Date(startsAt).toISOString(),
      ends_at: new Date(endsAt).toISOString(),
      timezone,
      target_countries: targetCountries,
      target_regions: targetRegions,
      target_paths: targetPaths,
      target_devices: targetDevices,
      priority: Number(priority) || 5,
      frequency_cap_per_session: frequencyCap ? Number(frequencyCap) : null,
      days_of_week: daysOfWeek.length > 0 ? daysOfWeek : null,
      start_time: startTime || null,
      end_time: endTime || null,
      creatives,
    };

    setSaving(true);
    try {
      if (existing) {
        await updateCampaignBrowser(existing.id, fields);
        router.push(`/admin/ads/${existing.id}`);
      } else {
        const res = await createCampaignBrowser(fields);
        router.push(`/admin/ads/${res.campaign_id}`);
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save campaign");
    } finally {
      setSaving(false);
    }
  }

  const invalidEmbed = creatives.some((c) => c.destination_type === "embed" && !c.embed_url);

  return (
    <div className="max-w-3xl space-y-6">
      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
        <span className="font-medium">Targeting: </span>
        {targetingSummary}
      </div>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Campaign name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Advertiser</span>
            <input value={advertiserName} onChange={(e) => setAdvertiserName(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Schedule</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Start</span>
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">End</span>
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Timezone (IANA name)</span>
            <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-400">Optional recurring day/time restriction, in the timezone above. Leave blank for every day, all day.</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <button
              key={d.value}
              type="button"
              onClick={() => toggleDay(d.value)}
              className={`rounded-md border px-2 py-1 text-xs ${daysOfWeek.includes(d.value) ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-black" : "border-zinc-200 dark:border-zinc-800"}`}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-64">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">From</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">To</span>
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Targeting</h2>
        <div>
          <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">Pages (none selected = entire site)</p>
          <div className="grid max-h-48 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-zinc-100 p-2 text-sm dark:border-zinc-900 sm:grid-cols-3">
            {TARGETABLE_PATHS.map((p) => (
              <label key={p.path} className="flex items-center gap-1.5">
                <input type="checkbox" checked={targetPaths.includes(p.path)} onChange={() => toggle(targetPaths, p.path, setTargetPaths)} />
                {p.label}
              </label>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">Devices (none selected = all devices)</p>
          <div className="flex gap-3">
            {["desktop", "tablet", "mobile"].map((d) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={targetDevices.includes(d)} onChange={() => toggle(targetDevices, d, setTargetDevices)} />
                {d}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm text-zinc-500 dark:text-zinc-400">
            Location: worldwide, or one or more countries (regions optional). Select countries below to narrow to specific regions/states.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <input
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.target.value)}
                placeholder="Search countries…"
                className="mb-1 w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
              />
              <div className="max-h-40 overflow-y-auto rounded-md border border-zinc-100 p-1 dark:border-zinc-900">
                {filteredCountries.slice(0, 200).map((c) => (
                  <label key={c.code} className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900">
                    <input
                      type="checkbox"
                      checked={targetCountries.includes(c.code)}
                      onChange={() => toggle(targetCountries, c.code, setTargetCountries)}
                    />
                    {countryFlag(c.code)} {c.name}
                  </label>
                ))}
              </div>
              {targetCountries.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Selected: {targetCountries.map((c) => `${countryFlag(c)} ${countryName(c)}`).join(", ")}
                </p>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                Regions (blank = all regions within the selected countries)
              </p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {targetRegions.map((r) => (
                  <span key={r} className="flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-900">
                    {r}
                    <button type="button" onClick={() => setTargetRegions((list) => list.filter((x) => x !== r))} className="text-zinc-500 hover:text-red-600">
                      ×
                    </button>
                  </span>
                ))}
                {targetRegions.length === 0 && <span className="text-xs text-zinc-400">All regions</span>}
              </div>
              {curatedRegions.length > 0 && (
                <select
                  value=""
                  onChange={(e) => e.target.value && setTargetRegions((list) => [...list, e.target.value])}
                  className="mb-2 w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
                >
                  <option value="">Add a region for the selected countries…</option>
                  {curatedRegions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              )}
              <div className="flex gap-1.5">
                <input
                  value={customRegion}
                  onChange={(e) => setCustomRegion(e.target.value)}
                  placeholder="Other region (free text)"
                  className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
                />
                <button
                  type="button"
                  onClick={() => {
                    const value = customRegion.trim();
                    if (value && !targetRegions.includes(value)) setTargetRegions((list) => [...list, value]);
                    setCustomRegion("");
                  }}
                  className="rounded-md border border-zinc-200 px-2 py-1 text-xs dark:border-zinc-800"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold">Rotation &amp; frequency</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          When multiple active campaigns are eligible for the same slot, one is chosen by weighted-random selection using priority as
          the weight -- higher priority is proportionally more likely, but never guaranteed, so no single campaign monopolizes a slot.
        </p>
        <div className="grid grid-cols-2 gap-3 sm:w-96">
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Priority (0–100)</span>
            <input type="number" min={0} max={100} value={priority} onChange={(e) => setPriority(Number(e.target.value))} className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-zinc-500 dark:text-zinc-400">Max impressions/session</span>
            <input type="number" min={1} value={frequencyCap} onChange={(e) => setFrequencyCap(e.target.value)} placeholder="Unlimited" className="w-full rounded-md border border-zinc-200 px-2 py-1.5 dark:border-zinc-800 dark:bg-black" />
          </label>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Creatives</h2>
          <button type="button" onClick={() => setCreatives((c) => [...c, emptyCreative()])} className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
            + Add creative
          </button>
        </div>
        {creatives.map((c, i) => (
          <div key={i} className="space-y-2 rounded-md border border-zinc-100 p-3 dark:border-zinc-900">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Slot</span>
                <select value={c.slot_code} onChange={(e) => updateCreative(i, { slot_code: e.target.value as AdCreative["slot_code"] })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black">
                  {AD_SLOTS.map((s) => (
                    <option key={s.code} value={s.code}>{s.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Device variant</span>
                <select value={c.device_variant} onChange={(e) => updateCreative(i, { device_variant: e.target.value as AdCreative["device_variant"] })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black">
                  <option value="all">All devices</option>
                  <option value="desktop">Desktop only</option>
                  <option value="mobile">Mobile only</option>
                </select>
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Width (px)</span>
                <input type="number" value={c.width ?? ""} onChange={(e) => updateCreative(i, { width: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Height (px)</span>
                <input type="number" value={c.height ?? ""} onChange={(e) => updateCreative(i, { height: e.target.value ? Number(e.target.value) : null })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
            </div>
            <label className="block text-xs">
              <span className="mb-1 block text-zinc-500">Image URL (https, required)</span>
              <input value={c.asset_url} onChange={(e) => updateCreative(i, { asset_url: e.target.value })} placeholder="https://…" className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
            </label>

            <div>
              <span className="mb-1 block text-xs text-zinc-500">Destination</span>
              <div className="mb-2 flex gap-3">
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="radio" name={`dest-${i}`} checked={c.destination_type === "link"} onChange={() => updateCreative(i, { destination_type: "link", embed_url: null })} />
                  Website / social link
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="radio" name={`dest-${i}`} checked={c.destination_type === "embed"} onChange={() => updateCreative(i, { destination_type: "embed" })} />
                  Supported embed (YouTube, Vimeo)
                </label>
              </div>
              <label className="block text-xs">
                <span className="mb-1 block text-zinc-500">
                  {c.destination_type === "embed" ? "Fallback link (used if the embed can't load)" : "Destination URL (https, required) — website or social profile"}
                </span>
                <input value={c.click_url} onChange={(e) => updateCreative(i, { click_url: e.target.value })} placeholder="https://www.facebook.com/yourpage" className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
              {c.destination_type === "embed" && (
                <label className="mt-2 block text-xs">
                  <span className="mb-1 block text-zinc-500">Embed URL — must be a YouTube or Vimeo https link</span>
                  <input
                    value={c.embed_url ?? ""}
                    onChange={(e) => updateCreative(i, { embed_url: e.target.value })}
                    placeholder="https://www.youtube.com/embed/…"
                    className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black"
                  />
                  {c.embed_url && !EMBED_HOST_ALLOWLIST.some((h) => c.embed_url?.includes(h)) && (
                    <p className="mt-1 text-red-600 dark:text-red-400">Not a supported embed host ({EMBED_HOST_ALLOWLIST.join(", ")}).</p>
                  )}
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Title</span>
                <input value={c.title ?? ""} onChange={(e) => updateCreative(i, { title: e.target.value })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">CTA text</span>
                <input value={c.cta_text ?? ""} onChange={(e) => updateCreative(i, { cta_text: e.target.value })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
              <label className="text-xs">
                <span className="mb-1 block text-zinc-500">Alt text</span>
                <input value={c.alt_text ?? ""} onChange={(e) => updateCreative(i, { alt_text: e.target.value })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
              </label>
            </div>
            <label className="block text-xs">
              <span className="mb-1 block text-zinc-500">Short description</span>
              <input value={c.description ?? ""} onChange={(e) => updateCreative(i, { description: e.target.value })} className="w-full rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-black" />
            </label>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={c.is_active} onChange={(e) => updateCreative(i, { is_active: e.target.checked })} />
                Active
              </label>
              {creatives.length > 1 && (
                <button type="button" onClick={() => setCreatives((list) => list.filter((_, idx) => idx !== i))} className="text-xs text-red-600 hover:underline dark:text-red-400">
                  Remove
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={saving || !name || !advertiserName || invalidEmbed || creatives.some((c) => !c.asset_url || !c.click_url)}
          onClick={submit}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-black"
        >
          {saving ? "Saving…" : existing ? "Save changes" : "Create campaign (as draft)"}
        </button>
      </div>
    </div>
  );
}

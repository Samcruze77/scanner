"use client";

// Reference browser for administrative units: Country -> State / FCT -> LGAs / Area
// Councils. Deliberately separate from the analytics hierarchy above it: these are
// places that exist, not places visitors were seen. Same data at every width --
// stacked cards on phones, a table from `md`.

import { useMemo, useState } from "react";
import { UNIT_TYPE_LABEL, findUnits, type AdminUnitsDataset } from "@/utils/admin/adminUnits";
import { selectClass } from "@/components/admin/GeoSelectors";

const PAGE = 50;

export function AdminUnitsBrowser({ data }: { data: AdminUnitsDataset | null }) {
  const [stateCode, setStateCode] = useState("");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const results = useMemo(() => (data ? findUnits(data, stateCode, search) : []), [data, stateCode, search]);
  const state = data?.states.find((s) => s.code === stateCode);
  const shown = results.slice(0, limit);
  const term = search.trim();

  return (
    <section aria-label="Administrative units" className="rounded-lg border border-zinc-200 bg-surface dark:border-zinc-800">
      <div className="space-y-3 border-b border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <p className="text-sm font-medium">Administrative units (reference)</p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            State → Local Government Area (FCT: Area Council). A reference list of places, separate from the visitor data
            above: visitor location comes from the IP address and does not identify an LGA.
          </p>
        </div>
        {!data ? (
          <p role="alert" className="text-sm text-red-600">
            Couldn&apos;t load the administrative-unit dataset.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <select aria-label="Country" value="NG" disabled className={selectClass}>
              <option value="NG">Nigeria</option>
            </select>
            <select
              aria-label="State or FCT"
              value={stateCode}
              onChange={(e) => {
                setStateCode(e.target.value);
                setLimit(PAGE);
              }}
              className={selectClass}
            >
              <option value="">All states and FCT ({data.states.length})</option>
              {data.states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.type === "federal_capital_territory" ? "Federal Capital Territory (FCT)" : s.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              aria-label="Search LGAs and Area Councils"
              placeholder="Search LGAs / Area Councils…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setLimit(PAGE);
              }}
              className={`${selectClass} sm:w-64`}
            />
          </div>
        )}
      </div>

      {data && (
        <>
          <p aria-live="polite" data-testid="unit-count" className="px-4 pt-3 text-xs text-zinc-500 dark:text-zinc-400">
            {results.length === 0
              ? "No matching LGAs or Area Councils."
              : `${results.length} ${results.length === 1 ? "unit" : "units"} in ${state ? state.name : "Nigeria"}${term ? ` matching "${term}"` : ""}${
                  results.length > shown.length ? ` (showing ${shown.length})` : ""
                }`}
          </p>
          {shown.length > 0 && (
            <>
              <ul className="divide-y divide-zinc-100 p-2 dark:divide-zinc-900 md:hidden">
                {shown.map((u) => (
                  <li key={u.code} className="px-2 py-2 text-sm">
                    <p className="font-medium">{u.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {UNIT_TYPE_LABEL[u.type]} · {u.stateName} · Nigeria · {u.code}
                    </p>
                  </li>
                ))}
              </ul>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Type</th>
                      <th className="px-4 py-2 font-medium">State / FCT</th>
                      <th className="px-4 py-2 font-medium">Country</th>
                      <th className="px-4 py-2 font-medium">Code</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((u) => (
                      <tr key={u.code} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                        <td className="px-4 py-2 font-medium">{u.name}</td>
                        <td className="px-4 py-2">{UNIT_TYPE_LABEL[u.type]}</td>
                        <td className="px-4 py-2">{u.stateName}</td>
                        <td className="px-4 py-2">Nigeria</td>
                        <td className="px-4 py-2 tabular-nums text-zinc-500">{u.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {results.length > shown.length && (
            <div className="p-3">
              <button type="button" onClick={() => setLimit((n) => n + PAGE)} className="min-h-10 text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                Show {Math.min(PAGE, results.length - shown.length)} more
              </button>
            </div>
          )}
          <p className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-900 dark:text-zinc-400">
            Source: {data.meta.originalSource} via OCHA HDX ({data.meta.license}); retrieved {data.meta.retrieved}. Only
            Nigeria is loaded.
          </p>
        </>
      )}
    </section>
  );
}

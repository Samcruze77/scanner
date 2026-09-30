"use client";

// The five dependent Country -> State / Province -> City / Town -> County /
// District / LGA -> Neighborhood / Suburb selectors, shared by the Geography
// page and the Export page's filters. Options come only from the nodes passed
// in (real data), and each level is limited to what exists under the
// ancestors already chosen.

import { LEVELS, nodeLabel, nodesUnder, selectNode, type LevelNodes, type Selection } from "@/utils/admin/geoLevels";

export const selectClass =
  "rounded-md border border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800 dark:bg-black disabled:opacity-50 min-w-0 max-w-full";

export function GeoSelectors({
  nodes,
  selection,
  onChange,
  className = "",
}: {
  nodes: LevelNodes;
  selection: Selection;
  onChange: (next: Selection) => void;
  className?: string;
}) {
  return (
    <>
      {LEVELS.map((level) => {
        const options = nodesUnder(nodes, selection, level.field)
          .filter((row) => !(level.field === "country" && row.key === "Unknown"))
          // The same value can exist under different parents; ancestors are
          // already constrained above, so de-duplicate by value.
          .filter((row, i, all) => all.findIndex((r) => r.key === row.key) === i)
          .sort((a, b) => nodeLabel(level.field, a).localeCompare(nodeLabel(level.field, b)));
        const chosen = selection[level.field];
        // A value arriving from a shared URL may not be in the current data;
        // keep it visible rather than silently dropping the filter.
        const missing = chosen && !options.some((r) => r.key === chosen);
        return (
          <select
            key={level.field}
            aria-label={level.label}
            value={chosen ?? ""}
            onChange={(e) => onChange(selectNode(selection, level.field, options.find((r) => r.key === e.target.value) ?? null))}
            disabled={options.length === 0 && !chosen}
            className={`${selectClass} ${className}`}
          >
            <option value="">
              {options.length === 0 && !chosen ? `${level.label}: not available` : `All ${level.plural}`}
            </option>
            {missing && <option value={chosen!}>{chosen}</option>}
            {options.map((row) => (
              <option key={row.key} value={row.key}>
                {nodeLabel(level.field, row)}
              </option>
            ))}
          </select>
        );
      })}
    </>
  );
}

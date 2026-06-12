import { useMemo, useState } from "react";
import type { ScanResult, ScannedComponent } from "../../../src/scan.js";
import { COMPONENT_FILTERS, type ComponentFilter, filterComponents, footgunCount } from "../derive";
import { Badge, FootgunTags, PropsTypingBadge, componentHref, filterHref } from "../ui";

/** A sortable column of the Component table. */
type SortKey = "name" | "deprecated" | "propsTyping" | "footguns" | "tests";

/** The per-column comparators, ascending. */
const COMPARATORS: Record<SortKey, (a: ScannedComponent, b: ScannedComponent) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  deprecated: (a, b) => Number(b.deprecated) - Number(a.deprecated),
  propsTyping: (a, b) => a.propsTyping.localeCompare(b.propsTyping),
  footguns: (a, b) => footgunCount(b) - footgunCount(a),
  tests: (a, b) => a.tests.total - b.tests.total,
};

/**
 * The Component table: the minimal v1 column set (name, deprecated, props
 * typing, footguns, tests), narrowed by the route's named filter and a local
 * name query, sorted by any column. Default order is alphabetical — the Scan
 * result made visible.
 *
 * @param props - The Scan result, the route filter, and the initial query.
 * @returns The view element.
 */
export function ComponentsTable({
  scan,
  filter,
  initialQuery,
}: {
  scan: ScanResult;
  filter: ComponentFilter | null;
  initialQuery: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });

  const rows = useMemo(
    () =>
      filterComponents(scan.components, filter, query).toSorted(
        (a, b) => COMPARATORS[sort.key](a, b) * (sort.desc ? -1 : 1),
      ),
    [scan.components, filter, query, sort],
  );

  const toggleSort = (key: SortKey): void =>
    setSort((current) => ({ key, desc: current.key === key && !current.desc }));

  return (
    <main>
      <div className="controls">
        <input
          type="search"
          placeholder="Filter by name…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <a className={filter === null ? "chip active" : "chip"} href={filterHref(null)}>
          all
        </a>
        {COMPONENT_FILTERS.map((known) => (
          <a
            key={known}
            className={filter === known ? "chip active" : "chip"}
            href={filterHref(known)}
          >
            {known}
          </a>
        ))}
      </div>

      <table>
        <thead>
          <tr>
            <SortableHeader label="Component" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Status" sortKey="deprecated" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Props" sortKey="propsTyping" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Footguns" sortKey="footguns" sort={sort} onSort={toggleSort} />
            <SortableHeader label="Tests" sortKey="tests" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {rows.map((component) => (
            <tr key={component.name}>
              <td>
                <a href={componentHref(component.name)}>{component.name}</a>
                <span className="path">{component.path}</span>
              </td>
              <td>
                {component.deprecated ? (
                  <Badge tone="amber">deprecated</Badge>
                ) : (
                  <span style={{ color: "var(--faint)" }}>—</span>
                )}
              </td>
              <td>
                <PropsTypingBadge value={component.propsTyping} />
              </td>
              <td>
                <FootgunTags component={component} />
              </td>
              <td className="num">{component.tests.total}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">
                No Component matches.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}

/**
 * Renders one sortable column header with its direction arrow.
 *
 * @param props - The label, the column key, the current sort, and the toggle.
 * @returns The header cell element.
 */
function SortableHeader({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
  onSort: (key: SortKey) => void;
}) {
  const arrow = sort.key === sortKey ? (sort.desc ? " ▼" : " ▲") : "";

  return (
    <th aria-sort={sort.key === sortKey ? (sort.desc ? "descending" : "ascending") : "none"}>
      <button type="button" className="sort-button" onClick={() => onSort(sortKey)}>
        {label}
        {arrow}
      </button>
    </th>
  );
}

import type { ReactNode } from "react";
import type { ScannedComponent } from "../../src/scan.js";
import type { ComponentFilter } from "./derive";

/**
 * Wraps content in a link when an `href` is given, in a plain div otherwise —
 * the shared shell of every clickable-or-static readout.
 *
 * @param props - The optional link target, the class, and the content.
 * @returns The anchor or div element.
 */
function MaybeLink({
  href,
  className,
  children,
}: {
  href?: string;
  className: string;
  children: ReactNode;
}) {
  return href ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * Renders a small uppercase status badge.
 *
 * @param props - The badge tone and content.
 * @returns The badge element.
 */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "amber" | "red" | "accent";
  children: ReactNode;
}) {
  return <span className={tone === "neutral" ? "badge" : `badge ${tone}`}>{children}</span>;
}

/**
 * Renders one Overview stat card — a labelled instrument readout, optionally
 * linking into the pre-filtered Component table.
 *
 * @param props - The card label, value, optional sub-line, link, and tone.
 * @returns The card element.
 */
export function StatCard({
  label,
  value,
  sub,
  href,
  debt = false,
}: {
  label: string;
  value: number;
  sub?: string;
  href?: string;
  debt?: boolean;
}) {
  const className = ["card", debt && value > 0 ? "debt" : "", value === 0 ? "quiet" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <MaybeLink className={className} href={href}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub ? <span className="sub">{sub}</span> : null}
    </MaybeLink>
  );
}

/** The three boolean footgun Indicators, with table-cell labels. */
export const FOOTGUNS = [
  { key: "memoWithChildren", label: "memo", title: "Memo with children — memoization is inert" },
  {
    key: "nestedComponentDefinition",
    label: "nest",
    title: "Nested component definition — remounts a subtree on every render",
  },
  {
    key: "forwardRefWithoutRef",
    label: "ref",
    title: "ForwardRef without ref — the consumer's ref is silently dropped",
  },
] as const;

/**
 * Renders a Component's footgun Indicators as compact red tags — one per
 * carried footgun, nothing when the Component is clean.
 *
 * @param props - The Component to read the three booleans from.
 * @returns The tag list element, or a muted dash when clean.
 */
export function FootgunTags({ component }: { component: ScannedComponent }) {
  const carried = FOOTGUNS.filter((footgun) => component[footgun.key]);

  if (carried.length === 0) return <span className="faint">—</span>;

  return (
    <span className="tags">
      {carried.map((footgun) => (
        <span key={footgun.key} className="badge red" title={footgun.title}>
          {footgun.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Renders a Props typing value with a tone matching its severity: `typed` is
 * quiet, `untyped` is a defect, `unanalyzed` is a caveat.
 *
 * @param props - The Props typing value.
 * @returns The badge element.
 */
export function PropsTypingBadge({ value }: { value: ScannedComponent["propsTyping"] }) {
  const tone = value === "untyped" ? "red" : value === "unanalyzed" ? "amber" : "neutral";
  return <Badge tone={tone}>{value}</Badge>;
}

/**
 * Renders one coverage gauge as a phosphor ring — the share of Components
 * carrying at least one of something. The stroke takes the instrument's
 * severity tones: accent at 80%+, amber at 50%+, red below.
 *
 * @param props - The gauge label, sub-line, and coverage slice.
 * @returns The ring element.
 */
export function CoverageRing({
  label,
  sub,
  covered,
  total,
  pct,
}: {
  label: string;
  sub: string;
  covered: number;
  total: number;
  pct: number;
}) {
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const tone = pct >= 80 ? "var(--accent)" : pct >= 50 ? "var(--amber)" : "var(--red)";

  return (
    <div className="ring">
      <svg viewBox="0 0 64 64" role="img" aria-label={`${label}: ${pct}%`}>
        <circle cx="32" cy="32" r={radius} fill="none" stroke="var(--line)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="36" textAnchor="middle" className="ring-pct" fill={tone}>
          {pct}%
        </text>
      </svg>
      <div>
        <span className="ring-label">{label}</span>
        <span className="ring-sub">
          {covered} / {total} {sub}
        </span>
      </div>
    </div>
  );
}

/**
 * Renders one "needs attention" row: a labelled count over a proportional
 * track, optionally linking into the pre-filtered Component table. The fill
 * is red — every row here is debt — and a zero row renders quiet.
 *
 * @param props - The row label, the count, the scan total, and the link.
 * @returns The row element.
 */
export function AttentionBar({
  label,
  count,
  total,
  href,
}: {
  label: string;
  count: number;
  total: number;
  href?: string;
}) {
  const pct = total === 0 ? 0 : (count / total) * 100;

  return (
    <MaybeLink className="bar" href={href}>
      <span className="bar-head">
        <span className="bar-label">{label}</span>
        <span className={count > 0 ? "bar-count" : "bar-count quiet"}>{count}</span>
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${pct}%` }} />
      </span>
    </MaybeLink>
  );
}

/**
 * Formats an ISO timestamp as its absolute date part. Absolute, not relative:
 * a "3 weeks ago" would change with the day the page is read, while the
 * artifact itself is deterministic.
 *
 * @param iso - The ISO 8601 timestamp.
 * @returns The `YYYY-MM-DD` date.
 */
export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Builds the hash link of a Component page.
 *
 * @param name - The Component name.
 * @returns The hash href.
 */
export function componentHref(name: string): string {
  return `#/components/${encodeURIComponent(name)}`;
}

/**
 * Builds the hash link of the Component table, optionally pre-filtered — the
 * construction mirror of the filter parsing in the router, so views never
 * hand-assemble filter URLs.
 *
 * @param filter - The named filter, or `null` for the unfiltered table.
 * @returns The hash href.
 */
export function filterHref(filter: ComponentFilter | null): string {
  return filter === null ? "#/components" : `#/components?filter=${filter}`;
}

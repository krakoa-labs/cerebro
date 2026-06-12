import { useMemo } from "react";
import type { ScanResult, ScannedComponent } from "../../../src/scan.js";
import { deriveFanIn, newestActivity } from "../derive";
import { Badge, FOOTGUNS, PropsTypingBadge, componentHref, formatDate } from "../ui";

/**
 * A Component page: the full Component record — header facts, footgun
 * findings, tests and stories, Code Connect connections, the dependency
 * neighborhood (fan-out, derived fan-in, external packages), and the raw
 * Activity log. Gated sections are absent, not zeroed, mirroring the Scan
 * result's omitted fields.
 *
 * @param props - The Scan result and the routed Component name.
 * @returns The view element.
 */
export function ComponentPage({ scan, name }: { scan: ScanResult; name: string }) {
  const fanInByName = useMemo(() => deriveFanIn(scan.components), [scan.components]);
  const component = scan.components.find((candidate) => candidate.name === name);

  if (!component) {
    return (
      <main>
        <div className="empty-state">
          <div className="title">UNKNOWN COMPONENT</div>
          <p>
            No Component named <code>{name}</code> in this scan.{" "}
            <a href="#/components">Back to the table.</a>
          </p>
        </div>
      </main>
    );
  }

  const fanIn = fanInByName[component.name] ?? [];
  const figmaUrl = component.figmaConnections?.find((connection) => connection.url)?.url;
  const lastActivity = newestActivity(component);

  return (
    <main>
      <nav className="breadcrumb">
        <a href="#/components">Components</a>
        <span>/</span>
        <span>{component.name}</span>
      </nav>

      <div className="component-head">
        <h1>{component.name}</h1>
        {component.deprecated && <Badge tone="amber">deprecated</Badge>}
        <Badge>{component.exportShape}</Badge>
        <Badge>{component.definitionKind}</Badge>
        <PropsTypingBadge value={component.propsTyping} />
        {figmaUrl && (
          <span className="head-actions">
            <a className="action" href={figmaUrl} target="_blank" rel="noreferrer">
              Open in Figma ↗
            </a>
          </span>
        )}
      </div>
      <p className="component-path">{component.path}</p>

      <div className="glance">
        <GlanceStat value={String(component.tests.total)} label="tests" />
        {component.stories && (
          <GlanceStat value={String(component.stories.total)} label="stories" />
        )}
        {component.figmaConnections && (
          <GlanceStat value={String(component.figmaConnections.length)} label="connections" />
        )}
        {component.dependsOn && (
          <GlanceStat value={String(component.dependsOn.length)} label="depends on" />
        )}
        <GlanceStat value={String(fanIn.length)} label="imported by" />
        {lastActivity && <GlanceStat value={formatDate(lastActivity)} label="last activity" />}
      </div>

      <h2 className="section-label">Findings</h2>
      <Findings component={component} />

      <h2 className="section-label">Tests{component.stories ? " & stories" : ""}</h2>
      <dl className="kv">
        <dt>Tests</dt>
        <dd>
          {component.tests.total}
          {component.tests.skipped > 0 && ` (${component.tests.skipped} skipped)`}
          {component.tests.only > 0 && ` (${component.tests.only} only)`}
        </dd>
        {component.stories && (
          <>
            <dt>Stories</dt>
            <dd>
              {component.stories.total}
              {component.stories.total > 0 &&
                ` — csf1 ${component.stories.csf1} · csf2 ${component.stories.csf2} · csf3 ${component.stories.csf3} · other ${component.stories.other}`}
            </dd>
          </>
        )}
      </dl>

      {component.figmaConnections && (
        <>
          <h2 className="section-label">Code Connect connections</h2>
          {component.figmaConnections.length === 0 ? (
            <div className="all-clear">No figma.connect() call found for this Component.</div>
          ) : (
            <dl className="kv">
              {component.figmaConnections.map((connection, index) => (
                <Connection
                  key={`${connection.url ?? "unresolved"}-${index}`}
                  url={connection.url}
                  variant={connection.variant}
                />
              ))}
            </dl>
          )}
        </>
      )}

      <h2 className="section-label">Dependencies</h2>
      <dl className="kv">
        <dt>Depends on</dt>
        <dd>
          <NameLinks names={component.dependsOn} fallback="none" />
        </dd>
        <dt>Imported by</dt>
        <dd>
          <NameLinks names={fanIn} fallback="nothing in this design system" />
        </dd>
        <dt>External</dt>
        <dd>
          {component.externalDependencies === undefined ? (
            <span className="faint">unavailable</span>
          ) : component.externalDependencies.length === 0 ? (
            <span className="faint">none</span>
          ) : (
            <span className="tags">
              {component.externalDependencies.map((pkg) => (
                <Badge key={pkg}>{pkg}</Badge>
              ))}
            </span>
          )}
        </dd>
      </dl>

      {component.activityLog && (
        <>
          <h2 className="section-label">Activity log</h2>
          {component.activityLog.length === 0 ? (
            <div className="all-clear">No commit touches this Component's scope.</div>
          ) : (
            <ol className="timeline">
              {component.activityLog.map((entry) => (
                <li key={entry.sha}>
                  <span className="timeline-subject">{entry.subject}</span>
                  <span className="timeline-meta">
                    {formatDate(entry.committedAt)} · {entry.authorName} ·{" "}
                    <code>{entry.sha.slice(0, 7)}</code>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </main>
  );
}

/**
 * Renders one big-number readout of the at-a-glance strip.
 *
 * @param props - The value and its label.
 * @returns The readout element.
 */
function GlanceStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="glance-stat">
      <span className="glance-value">{value}</span>
      <span className="glance-label">{label}</span>
    </div>
  );
}

/**
 * Renders a Component's footgun Indicators as actionable findings — each
 * stated with the construct and its consequence — or a single all-clear line.
 *
 * @param props - The Component.
 * @returns The findings element.
 */
function Findings({ component }: { component: ScannedComponent }) {
  const carried = FOOTGUNS.filter((footgun) => component[footgun.key]);

  if (carried.length === 0) {
    return <div className="all-clear">No footgun indicator on this Component.</div>;
  }

  return (
    <div className="findings">
      {carried.map((footgun) => {
        const [what = "", why = ""] = footgun.title.split(" — ");
        return (
          <div key={footgun.key} className="finding">
            <span className="what">{what}</span>
            <span className="why">{why}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Renders one Code Connect connection row: a link to the Figma node, or a
 * visibly broken entry when the URL could not be resolved.
 *
 * @param props - The connection's URL and optional variant map.
 * @returns The definition pair elements.
 */
function Connection({
  url,
  variant,
}: {
  url: string | null;
  variant?: Record<string, string | boolean | number>;
}) {
  const variantLabel = variant
    ? Object.entries(variant)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(" ")
    : "default";

  return (
    <>
      <dt>{variantLabel}</dt>
      <dd>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {url}
          </a>
        ) : (
          <Badge tone="red">unresolved url</Badge>
        )}
      </dd>
    </>
  );
}

/**
 * Renders a list of Component names as links to their pages, or a muted
 * fallback when the list is empty.
 *
 * @param props - The names and the empty fallback text.
 * @returns The links element.
 */
function NameLinks({ names, fallback }: { names: string[] | undefined; fallback: string }) {
  if (names === undefined) return <span className="faint">unavailable</span>;
  if (names.length === 0) return <span className="faint">{fallback}</span>;

  return (
    <span className="tags">
      {names.map((name) => (
        <a key={name} href={componentHref(name)}>
          {name}
        </a>
      ))}
    </span>
  );
}

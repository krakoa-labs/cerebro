import { useSyncExternalStore } from "react";
import { COMPONENT_FILTERS, type ComponentFilter } from "./derive";

/** A parsed Dashboard route — one of the three views. */
export type Route =
  | { kind: "overview" }
  | { kind: "components"; filter: ComponentFilter | null; query: string }
  | { kind: "component"; name: string };

/**
 * Parses a `location.hash` into a Route. Hash routing keeps the Dashboard
 * working when opened from `file://` as well as hosted (ADR-0019). Unknown
 * routes and unknown filter values degrade quietly — to the Overview and to
 * no filter — rather than erroring.
 *
 * @param hash - The raw hash, with or without its leading `#`.
 * @returns The parsed route.
 */
export function parseHash(hash: string): Route {
  const [path = "", search = ""] = hash.replace(/^#\/?/, "").split("?");
  const segments = path.split("/").filter((segment) => segment !== "");

  if (segments[0] === "components" && segments.length === 2 && segments[1] !== undefined) {
    return { kind: "component", name: decodeURIComponent(segments[1]) };
  }

  if (segments[0] === "components" && segments.length === 1) {
    const params = new URLSearchParams(search);
    const rawFilter = params.get("filter");
    const filter = COMPONENT_FILTERS.find((known) => known === rawFilter) ?? null;
    return { kind: "components", filter, query: params.get("q") ?? "" };
  }

  return { kind: "overview" };
}

/**
 * Subscribes a component to `hashchange` events.
 *
 * @param onChange - Called when the hash changes.
 * @returns The unsubscribe function.
 */
function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * Reads the current hash route reactively: re-renders the calling component
 * whenever `location.hash` changes.
 *
 * @returns The current route.
 */
export function useHashRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseHash(hash);
}

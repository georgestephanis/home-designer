// Where the editor keeps its plan. On its own it works with files and a browser draft; inside
// Home Assistant (src/ha/) a Host keeps the plan in Home Assistant and supplies live entities.
import { useMemo, useSyncExternalStore } from "react";
import type { Doc, Obj } from "./model";
import type { States } from "./render";

export interface EntityInfo { id: string; name: string; state: string }

export interface Saved { doc: Doc | null; rev: number }

export interface Host {
  /** Shown in the UI, e.g. "Home Assistant". */
  name: string;
  /** Saves over revision `rev` and returns the new revision; rejects with a Conflict if it moved on. */
  save(doc: Doc, rev: number): Promise<number>;
  /** Calls back with the saved plan straight away, then again each time it's saved from anywhere. */
  watch(cb: (s: Saved) => void): () => void;
  entities(): EntityInfo[];
  state(id: string): string | undefined;
  /** Calls back whenever any entity's state may have changed. */
  subscribe(cb: () => void): () => void;
  /** Phone layout: the host's sidebar is hidden and needs a button. */
  narrow?: boolean;
  toggleMenu?(): void;
}

export class Conflict extends Error {}

export const boundEntities = (objs: Obj[]) =>
  [...new Set(objs.flatMap((o) => ("entity" in o && o.entity ? [o.entity] : [])))].sort();

const none = () => () => {};

/** The states of the given entities. Re-renders only when one of them changes. */
export function useStates(host: Host | undefined, ids: string[]): States | undefined {
  const key = useSyncExternalStore(host?.subscribe ?? none,
    () => (host ? ids.map((id) => `${id}=${host.state(id) ?? ""}`).join("\n") : ""));
  return useMemo(() => {
    if (!host) return undefined;
    const out: States = {};
    for (const line of key ? key.split("\n") : []) {
      const i = line.indexOf("=");
      out[line.slice(0, i)] = line.slice(i + 1) || undefined;
    }
    return out;
  }, [key, host]);
}

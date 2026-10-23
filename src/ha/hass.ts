// The bits of Home Assistant's frontend this uses: the `hass` object it hands to panels and
// cards, and the plan kept by the home_designer integration (custom_components/home_designer).
import { Conflict, type Host, type Saved } from "../host";
import type { Doc } from "../model";

export interface HassEntity { entity_id: string; state: string; last_updated: string; attributes: Record<string, unknown> }

export interface Hass {
  states: Record<string, HassEntity>;
  themes?: { darkMode?: boolean };
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  callService(domain: string, service: string, data?: Record<string, unknown>): Promise<unknown>;
  connection: {
    subscribeMessage<T>(cb: (msg: T) => void, msg: Record<string, unknown>): Promise<() => Promise<void>>;
  };
}

export const entityName = (s: HassEntity | undefined, id: string) =>
  (s?.attributes.friendly_name as string | undefined) ?? id;

/** Fires one of the frontend's own events (more-info, the sidebar toggle) from inside a card. */
export function fire(from: EventTarget, type: string, detail: unknown = {}) {
  from.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

/**
 * One subscription to the saved plan per page, shared by every card and the editor on it.
 * The latest plan is replayed to each new listener.
 */
const plans = new WeakMap<object, { last: Saved | null; cbs: Set<(s: Saved) => void>; ready: Promise<unknown> }>();

export function watchPlan(hass: Hass, cb: (s: Saved) => void): () => void {
  const key = hass.connection;
  let p = plans.get(key);
  if (!p) {
    const entry = { last: null as Saved | null, cbs: new Set<(s: Saved) => void>(), ready: Promise.resolve() as Promise<unknown> };
    entry.ready = hass.connection.subscribeMessage<Saved>((msg) => {
      entry.last = { doc: msg.doc as Doc | null, rev: msg.rev };
      for (const f of entry.cbs) f(entry.last);
    }, { type: "home_designer/subscribe" }).catch((err) => console.error("home-designer: can't load the plan", err));
    plans.set(key, entry);
    p = entry;
  }
  p.cbs.add(cb);
  if (p.last) cb(p.last);
  return () => { p!.cbs.delete(cb); };
}

/** The editor's Host, backed by whichever `hass` object the panel was last handed. */
export class HassHost implements Host {
  name = "Home Assistant";
  narrow = false;
  private listeners = new Set<() => void>();

  constructor(private getHass: () => Hass, private el: HTMLElement) {}

  /** Called by the panel whenever Home Assistant hands it a new `hass`. */
  changed() { for (const f of this.listeners) f(); }

  save = async (doc: Doc, rev: number) => {
    try {
      return (await this.getHass().callWS<{ rev: number }>({ type: "home_designer/save", doc, rev })).rev;
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e.code === "conflict") throw new Conflict(e.message);
      throw new Error(e.message ?? String(err));
    }
  };

  watch = (cb: (s: Saved) => void) => watchPlan(this.getHass(), cb);

  entities = () => Object.values(this.getHass().states).map((s) =>
    ({ id: s.entity_id, name: entityName(s, s.entity_id), state: s.state }));

  state = (id: string) => this.getHass().states[id]?.state;

  subscribe = (cb: () => void) => { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; };

  toggleMenu = () => fire(this.el, "hass-toggle-menu");
}

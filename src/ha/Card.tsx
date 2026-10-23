// The dashboard card: the saved plan, one floor at a time, with a live Home Assistant icon on
// each placed entity. Tap a light or switch to toggle it, or anything else (or hold) for details.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { LevelArt, entityAt } from "../render";
import { docBounds } from "../geometry";
import type { Doc, Obj } from "../model";
import { boundEntities } from "../host";
import { entityName, fire, watchPlan, type Hass, type HassEntity } from "./hass";

export interface CardConfig {
  type: string;
  title?: string;
  /** Show only this floor (by id, e.g. "floor1"), with no floor tabs. */
  level?: string;
  /** The floor shown first; the default is "floor1" if there is one, else the first. */
  default_level?: string;
}

/** Hands the card the latest `hass`, re-rendering only when a placed entity changes. */
export interface HassSource { hass: () => Hass; subscribe: (cb: () => void) => () => void }

const TOGGLES = ["light", "switch", "fan", "input_boolean"];

export function PlanCard({ config, src }: { config: CardConfig; src: HassSource }) {
  const [doc, setDoc] = useState<Doc | null | undefined>(undefined);
  useEffect(() => watchPlan(src.hass(), (s) => setDoc(s.doc)), [src]);
  const levels = doc?.levels ?? [];
  const pick = config.level ?? config.default_level;
  const [chosen, setChosen] = useState<string | null>(null);
  const level = levels.find((l) => l.id === (config.level ?? chosen)) ??
    levels.find((l) => l.id === pick) ?? levels.find((l) => l.id === "floor1") ?? levels[0];

  // Every floor framed the same, so switching floors doesn't shift the house around.
  const vb = useMemo(() => {
    const b = docBounds(config.level && level ? [level] : levels);
    const pad = 1.5;
    return { x: b.x0 - pad, y: b.y0 - pad, w: b.x1 - b.x0 + pad * 2, h: b.y1 - b.y0 + pad * 2 };
  }, [levels, level, config.level]);

  const ids = useMemo(() => (level ? boundEntities(level.objects) : []), [level]);
  const key = useSyncExternalStore(src.subscribe, () => {
    const st = src.hass().states;
    return ids.map((id) => `${id}=${st[id]?.state ?? ""}@${st[id]?.last_updated ?? ""}`).join("\n");
  });
  const states = useMemo(() => {
    const st = src.hass().states;
    return Object.fromEntries(ids.map((id) => [id, st[id]?.state]));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const [badges, setBadges] = useState(() => !!customElements.get("state-badge"));
  useEffect(() => { if (!badges) customElements.whenDefined("state-badge").then(() => setBadges(true)); }, [badges]);

  if (doc === undefined) return <ha-card><div className="hd-msg">Loading the floor plan…</div></ha-card>;
  if (!doc || !level) {
    return <ha-card header={config.title}><div className="hd-msg">No floor plan yet. Draw one on the Floor plan page in the sidebar.</div></ha-card>;
  }
  const placed = level.objects.filter((o) => entityAt(o));

  return (
    <ha-card header={config.title}>
      {!config.level && levels.length > 1 && (
        <div className="hd-tabs" role="tablist">
          {levels.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={l.id === level.id}
              className={l.id === level.id ? "on" : ""} onClick={() => setChosen(l.id)}>{l.title}</button>
          ))}
        </div>
      )}
      {/* As wide as the card, but no taller than the window, so a whole floor fits on screen. */}
      <div className="hd-plan" style={{ aspectRatio: `${vb.w} / ${vb.h}`, width: `min(100%, calc((100vh - 140px) * ${(vb.w / vb.h).toFixed(4)}))` }}>
        <svg className="hd-art" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={`${doc.name}: ${level.title}`}>
          <LevelArt level={level} wall={doc.wall} states={states} hideBound />
        </svg>
        {placed.map((o) => (
          <Badge key={o.id} o={o} left={((entityAt(o)![0] - vb.x) / vb.w) * 100} top={((entityAt(o)![1] - vb.y) / vb.h) * 100}
            hass={src.hass()} stamp={states[(o as { entity: string }).entity]} badges={badges} />
        ))}
      </div>
    </ha-card>
  );
}

/** One placed entity: Home Assistant's own state badge, coloured by state, at its spot on the plan. */
function Badge({ o, left, top, hass, stamp, badges }: { o: Obj; left: number; top: number; hass: Hass; stamp?: string; badges: boolean }) {
  const id = (o as { entity: string }).entity;
  const ent: HassEntity | undefined = hass.states[id];
  const ref = useRef<HTMLElement & { hass?: Hass; stateObj?: HassEntity; stateColor?: boolean }>(null);
  const held = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !ent) return;
    el.hass = hass; el.stateObj = ent; el.stateColor = true;
  });

  const domain = id.split(".")[0];
  const label = `${entityName(ent, id)}: ${ent ? ent.state : "not found"}`;
  const tap = () => {
    if (held.current === -1) { held.current = null; return; }
    if (ent && TOGGLES.includes(domain)) hass.callService("homeassistant", "toggle", { entity_id: id });
    else fire(ref.current ?? document.body, "hass-more-info", { entityId: id });
  };
  const down = () => {
    held.current = window.setTimeout(() => { held.current = -1; fire(ref.current ?? document.body, "hass-more-info", { entityId: id }); }, 500);
  };
  const cancel = () => { if (held.current && held.current > 0) clearTimeout(held.current); if (held.current !== -1) held.current = null; };

  return (
    <button type="button" className={`hd-badge${ent ? "" : " missing"}${stamp === "on" ? " on" : ""}`} style={{ left: `${left}%`, top: `${top}%` }}
      title={label} aria-label={label} onClick={tap} onPointerDown={down} onPointerUp={cancel} onPointerLeave={cancel}
      onContextMenu={(e) => { e.preventDefault(); fire(e.currentTarget, "hass-more-info", { entityId: id }); }}>
      {badges && ent ? <state-badge ref={ref} /> : <span ref={ref} className="hd-dot" />}
    </button>
  );
}

export const CARD_STYLE = `
:host{display:block}
ha-card{overflow:hidden}
.hd-msg{padding:16px;color:var(--secondary-text-color)}
.hd-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:8px 12px 0}
.hd-tabs button{font:inherit;font-size:14px;color:var(--secondary-text-color);background:none;border:0;border-bottom:2px solid transparent;
  padding:6px 10px;cursor:pointer}
.hd-tabs button.on{color:var(--primary-text-color);border-bottom-color:var(--primary-color);font-weight:500}
.hd-plan{position:relative;margin:0 auto}
.hd-plan>svg{position:absolute;inset:0;width:100%;height:100%;display:block}
.hd-badge{position:absolute;transform:translate(-50%,-50%);width:36px;height:36px;padding:0;border:0;border-radius:50%;
  background:color-mix(in srgb,var(--card-background-color,#fff) 75%,transparent);cursor:pointer;display:grid;place-items:center;
  -webkit-tap-highlight-color:transparent}
.hd-badge:focus-visible{outline:2px solid var(--primary-color)}
.hd-badge state-badge{width:36px;height:36px;line-height:36px;--mdc-icon-size:22px;pointer-events:none}
.hd-dot{width:14px;height:14px;border-radius:50%;background:var(--disabled-color,#999)}
.hd-badge.on .hd-dot{background:var(--state-light-active-color,#facc15)}
.hd-badge.missing{opacity:.5}
`;

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "ha-card": { header?: string; children?: React.ReactNode };
      "state-badge": { ref?: React.Ref<HTMLElement> };
    }
  }
}

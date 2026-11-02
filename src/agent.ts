// window.homeDesigner: a small, stable console API so an AI agent in the browser (or a person at
// the console) can read and change the plan without clicking the canvas. Every edit goes through
// the editor's undo history; `batch` makes a run of edits one undo step. The App supplies a
// Bridge; everything here is plain functions over the Doc, so it's testable without React.
import { CATALOG } from "./catalog";
import { bbox, polyArea, roomAt } from "./geometry";
import {
  ITEM_KINDS, MARK_KINDS, MARK_WIDTH, POINT_KINDS, ROOM_KINDS, WALLED, uid,
  type Doc, type Item, type Level, type Mark, type MarkKind, type Obj, type Point, type Room, type Vec,
} from "./model";
import { docToSvg } from "./svgio";
import { AGENT_GUIDE } from "./agent-guide";
import type { EntityInfo } from "./host";

export const API_VERSION = 1;

/** What the App lends the API. `doc()` must return the latest plan, including edits not yet rendered. */
export interface Bridge {
  doc(): Doc;
  commit(next: Doc): void;
  undo(): void;
  redo(): void;
  level(): string;
  setLevel(id: string): void;
  load(text: string, name: string): void;
  /** Present only inside Home Assistant. */
  save?(): Promise<void>;
  entities?(): EntityInfo[];
}

export type Side = "n" | "e" | "s" | "w";
export type Spot = "center" | Side | "ne" | "nw" | "se" | "sw";
export interface Where { level?: string }
export interface Query { label?: string | RegExp; type?: Obj["type"]; kind?: string; level?: string; entity?: string }

export class AgentError extends Error { name = "HomeDesignerError"; }
const fail = (msg: string): never => { throw new AgentError(msg); };
const copy = <T>(v: T): T => structuredClone(v);
const num = (v: unknown, what: string) => (typeof v === "number" && Number.isFinite(v) ? v : fail(`${what} must be a number of feet, got ${JSON.stringify(v)}`));
const oneOf = <T extends string>(v: unknown, list: readonly T[], what: string): T =>
  (list as readonly unknown[]).includes(v) ? v as T : fail(`unknown ${what} ${JSON.stringify(v)}; ${what} is one of: ${list.join(", ")}`);
const ID_PREFIX: Record<Obj["type"], string> = { room: "room", item: "item", mark: "mark", point: "pt", dim: "dim", text: "text" };

/** The fields each object type may have; anything else is refused, so a typo can't slip in. */
const FIELDS: Record<Obj["type"], readonly string[]> = {
  room: ["kind", "points"],
  item: ["kind", "shape", "cx", "cy", "w", "h", "rot", "glyph", "entity"],
  mark: ["kind", "a", "b", "hinge", "swing"],
  point: ["kind", "x", "y", "entity", "aim", "range"],
  dim: ["a", "b", "offset"],
  text: ["x", "y", "size"],
};

/** Checks a whole object against the model, filling defaults, and throws on anything off. */
export function validate(o: Partial<Obj> & { type?: string }): Obj {
  if (!o || typeof o !== "object") fail("expected an object");
  const type = oneOf(o.type, ["room", "item", "mark", "point", "dim", "text"] as const, "type");
  const allowed = ["id", "type", "label", ...FIELDS[type]];
  const extra = Object.keys(o).filter((k) => !allowed.includes(k) && (o as Record<string, unknown>)[k] !== undefined);
  if (extra.length) fail(`a ${type} has no field${extra.length > 1 ? "s" : ""} ${extra.map((k) => JSON.stringify(k)).join(", ")}; its fields are: ${allowed.join(", ")}`);
  const base = { ...o, id: o.id ?? uid(ID_PREFIX[type]), label: o.label ?? "" } as Obj;
  if (typeof base.label !== "string") fail("label must be a string");
  const vec = (v: unknown, what: string): Vec =>
    Array.isArray(v) && v.length === 2 ? [num(v[0], `${what}[0]`), num(v[1], `${what}[1]`)] : fail(`${what} must be [x, y] in feet`);
  switch (base.type) {
    case "room":
      oneOf(base.kind, ROOM_KINDS, "room kind");
      if (!Array.isArray(base.points) || base.points.length < 3) fail("room.points needs at least 3 [x, y] corners");
      base.points = base.points.map((p, i) => vec(p, `points[${i}]`));
      break;
    case "item":
      base.kind = oneOf(base.kind ?? "furniture", ITEM_KINDS, "item kind");
      base.shape = oneOf(base.shape ?? "rect", ["rect", "ellipse"] as const, "shape");
      for (const k of ["cx", "cy", "w", "h"] as const) num(base[k], `item.${k}`);
      if (base.w <= 0 || base.h <= 0) fail("item.w and item.h must be above 0");
      base.rot = base.rot === undefined ? 0 : num(base.rot, "item.rot");
      break;
    case "mark":
      oneOf(base.kind, MARK_KINDS, "mark kind");
      base.a = vec(base.a, "mark.a"); base.b = vec(base.b, "mark.b");
      break;
    case "point":
      base.kind = oneOf(base.kind ?? "device", POINT_KINDS, "point kind");
      num(base.x, "point.x"); num(base.y, "point.y");
      break;
    case "dim":
      base.a = vec(base.a, "dim.a"); base.b = vec(base.b, "dim.b");
      base.offset = base.offset === undefined ? 1 : num(base.offset, "dim.offset");
      break;
    case "text":
      num(base.x, "text.x"); num(base.y, "text.y");
      base.size = base.size === undefined ? 1 : num(base.size, "text.size");
      break;
  }
  return base;
}

function levelOf(doc: Doc, id: string | undefined, current: string): Level {
  const want = id ?? current;
  return doc.levels.find((l) => l.id === want || l.title === want)
    ?? fail(`no level ${JSON.stringify(want)}; levels are: ${doc.levels.map((l) => `${l.id} ("${l.title}")`).join(", ")}`);
}

/** Where an object is: its level and index. */
function locate(doc: Doc, id: string): { level: Level; index: number } {
  for (const level of doc.levels) {
    const index = level.objects.findIndex((o) => o.id === id);
    if (index >= 0) return { level, index };
  }
  return fail(`no object with id ${JSON.stringify(id)}; use find() to look one up`);
}

const withLevel = (doc: Doc, levelId: string, objects: Obj[]): Doc =>
  ({ ...doc, levels: doc.levels.map((l) => (l.id === levelId ? { ...l, objects } : l)) });

/** A room on a level by id or label (case-insensitive). */
function roomBy(level: Level, ref: string): Room {
  const rooms = level.objects.filter((o): o is Room => o.type === "room");
  const hit = rooms.find((r) => r.id === ref) ?? rooms.filter((r) => r.label.toLowerCase() === ref.toLowerCase());
  if (!Array.isArray(hit)) return hit;
  if (hit.length === 1) return hit[0];
  return fail(hit.length
    ? `${hit.length} rooms are labelled "${ref}" on ${level.id}; pass one's id: ${hit.map((r) => r.id).join(", ")}`
    : `no room "${ref}" on ${level.id}; rooms are: ${rooms.map((r) => r.label || r.id).join(", ")}`);
}

/** A spot inside a room's bounding box, `inset` feet in from the named walls. */
export function spotIn(r: Room, spot: Spot = "center", inset = 1.5): Vec {
  const b = bbox(r.points);
  const x = spot.includes("w") ? b.x0 + inset : spot.includes("e") ? b.x1 - inset : (b.x0 + b.x1) / 2;
  const y = spot.startsWith("n") ? b.y0 + inset : spot.startsWith("s") ? b.y1 - inset : (b.y0 + b.y1) / 2;
  return [x, y];
}

/**
 * A door/window on one side of a room: `at` feet from the side's north or west end to the
 * mark's centre (default: centred), `width` feet wide. A door opens into the room.
 */
export function markOnSide(r: Room, kind: MarkKind, side: Side, at?: number, width = MARK_WIDTH[kind]): Omit<Mark, "id"> {
  const b = bbox(r.points);
  const vertical = side === "e" || side === "w";
  const lo = vertical ? b.y0 : b.x0, hi = vertical ? b.y1 : b.x1;
  if (width > hi - lo) fail(`a ${width}' ${kind} doesn't fit on the ${side} side of "${r.label}" (${(hi - lo).toFixed(2)}' long)`);
  const c = Math.max(lo + width / 2, Math.min(hi - width / 2, at === undefined ? (lo + hi) / 2 : lo + at));
  const fixed = { n: b.y0, s: b.y1, w: b.x0, e: b.x1 }[side];
  let a: Vec = vertical ? [fixed, c - width / 2] : [c - width / 2, fixed];
  let e: Vec = vertical ? [fixed, c + width / 2] : [c + width / 2, fixed];
  if (kind !== "door") return { type: "mark", kind, label: "", a, b: e };
  // Swing 1 opens to the left of a→b; order the ends so that's into the room.
  const inside = spotIn(r);
  const n: Vec = [e[1] - a[1], -(e[0] - a[0])];
  const m: Vec = [(a[0] + e[0]) / 2, (a[1] + e[1]) / 2];
  if ((inside[0] - m[0]) * n[0] + (inside[1] - m[1]) * n[1] < 0) [a, e] = [e, a];
  return { type: "mark", kind, label: "", a, b: e, hinge: "a", swing: 1 };
}

function moveTo(o: Obj, p: Vec): Obj {
  switch (o.type) {
    case "item": return { ...o, cx: p[0], cy: p[1] };
    case "point": case "text": return { ...o, x: p[0], y: p[1] };
    default: return fail(`place() moves items, points and notes; ${o.id} is a ${o.type}`);
  }
}

export function createAgentApi(bridge: Bridge) {
  // Inside batch() edits collect here and are committed once at the end.
  let pending: Doc | null = null;
  const cur = () => pending ?? bridge.doc();
  const apply = (next: Doc) => { if (pending) pending = next; else bridge.commit(next); };
  const lvl = (id?: string) => levelOf(cur(), id, bridge.level());

  const insert = (o: Obj, level?: string): Obj => {
    const v = validate(o);
    const doc = cur(), L = levelOf(doc, level, bridge.level());
    if (doc.levels.some((l) => l.objects.some((x) => x.id === v.id))) fail(`id ${v.id} is already used`);
    apply(withLevel(doc, L.id, [...L.objects, v]));
    return copy(v);
  };

  const api = {
    version: API_VERSION,
    schema: {
      units: "feet; x grows east, y grows south (north is up); angles in degrees clockwise",
      roomKinds: ROOM_KINDS, walledRoomKinds: WALLED, itemKinds: ITEM_KINDS, markKinds: MARK_KINDS, pointKinds: POINT_KINDS,
      markWidths: MARK_WIDTH,
      catalog: CATALOG.map(({ id, name, group, w, h, glyph, point }) =>
        ({ id, name, group, ...(w && h ? { w: +(w / 12).toFixed(3), h: +(h / 12).toFixed(3) } : {}), glyph, point })),
    },

    /** The agent guide (also on the page). Logs it and returns it. */
    help(): string { console.log(AGENT_GUIDE); return AGENT_GUIDE; },

    // ---- Reading --------------------------------------------------------------------------
    doc: (): Doc => copy(cur()),
    levels: () => cur().levels.map((l) => ({
      id: l.id, title: l.title, current: l.id === bridge.level(),
      rooms: l.objects.filter((o): o is Room => o.type === "room").map((r) => {
        const b = bbox(r.points);
        return { id: r.id, label: r.label, kind: r.kind, x: b.x0, y: b.y0, w: +(b.x1 - b.x0).toFixed(3), h: +(b.y1 - b.y0).toFixed(3), area: +polyArea(r.points).toFixed(1) };
      }),
      counts: l.objects.reduce<Record<string, number>>((c, o) => ({ ...c, [o.type]: (c[o.type] ?? 0) + 1 }), {}),
    })),
    find(q: Query = {}): (Obj & { level: string })[] {
      const levels = q.level ? [lvl(q.level)] : cur().levels;
      const match = (o: Obj) => (!q.type || o.type === q.type)
        && (!q.kind || ("kind" in o && o.kind === q.kind))
        && (!q.entity || ("entity" in o && o.entity === q.entity))
        && (q.label === undefined || (q.label instanceof RegExp ? q.label.test(o.label) : o.label.toLowerCase() === q.label.toLowerCase()));
      return levels.flatMap((l) => l.objects.filter(match).map((o) => ({ ...copy(o), level: l.id })));
    },
    get(id: string): Obj & { level: string } { const { level, index } = locate(cur(), id); return { ...copy(level.objects[index]), level: level.id }; },
    /** The smallest room at (x, y). */
    at(x: number, y: number, level?: string): Room | null { const r = roomAt(lvl(level).objects, [num(x, "x"), num(y, "y")]); return r ? copy(r) : null; },
    /** The level shown, or switch to another (by id or title). */
    level(id?: string): string { if (id !== undefined) bridge.setLevel(lvl(id).id); return id !== undefined ? lvl(id).id : bridge.level(); },

    // ---- Editing (each call is one undo step, or part of a batch) ---------------------------
    add: (o: Partial<Obj> & { type: Obj["type"] }, where: Where = {}): Obj => insert(o as Obj, where.level),
    update(id: string, patch: Partial<Obj>): Obj {
      if ("id" in patch && patch.id !== id) fail("update() can't change an id");
      const doc = cur(), { level, index } = locate(doc, id);
      if (patch.type !== undefined && patch.type !== level.objects[index].type) fail("update() can't change an object's type");
      const next = validate({ ...level.objects[index], ...patch } as Obj);
      apply(withLevel(doc, level.id, level.objects.map((o, i) => (i === index ? next : o))));
      return copy(next);
    },
    remove(ids: string | string[]): number {
      const list = Array.isArray(ids) ? ids : [ids];
      let doc = cur();
      for (const id of list) {
        const { level } = locate(doc, id);
        doc = withLevel(doc, level.id, level.objects.filter((o) => o.id !== id));
      }
      apply(doc);
      return list.length;
    },
    undo(): void { if (pending) fail("can't undo inside batch()"); bridge.undo(); },
    redo(): void { if (pending) fail("can't redo inside batch()"); bridge.redo(); },

    // ---- Helpers, so callers needn't do the geometry ---------------------------------------
    /** A rectangular room, x/y its north-west corner. */
    addRoom({ label, kind = "room", x, y, w, h, level }: { label: string; kind?: Room["kind"]; x: number; y: number; w: number; h: number; level?: string }): Room {
      num(x, "x"); num(y, "y");
      if (num(w, "w") <= 0 || num(h, "h") <= 0) fail("w and h must be above 0");
      return insert({ id: uid("room"), type: "room", kind, label, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }, level) as Room;
    },
    /**
     * A closet in a corner or along a side of a room (it gets its own walls). `w` runs east–west,
     * `h` north–south.
     */
    addCloset({ room, spot = "ne", w, h, label = "Closet", level }: { room: string; spot?: Exclude<Spot, "center">; w: number; h: number; label?: string; level?: string }): Room {
      const r = roomBy(lvl(level), room), b = bbox(r.points);
      if (num(w, "w") > b.x1 - b.x0 || num(h, "h") > b.y1 - b.y0) fail(`a ${w}'×${h}' closet doesn't fit in "${r.label}"`);
      const x = spot.includes("w") ? b.x0 : spot.includes("e") ? b.x1 - w : (b.x0 + b.x1 - w) / 2;
      const y = spot.startsWith("n") ? b.y0 : spot.startsWith("s") ? b.y1 - h : (b.y0 + b.y1 - h) / 2;
      return insert({ id: uid("room"), type: "room", kind: "closet", label, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] }, lvl(level).id) as Room;
    },
    /** A door, window or opening on one side of a room. `at`: feet from that side's north/west end to the centre. */
    addOnWall(kind: MarkKind, { room, side, at, width, label = "", level }: { room: string; side: Side; at?: number; width?: number; label?: string; level?: string }): Mark {
      oneOf(kind, MARK_KINDS, "mark kind"); oneOf(side, ["n", "e", "s", "w"] as const, "side");
      const r = roomBy(lvl(level), room);
      return insert({ ...markOnSide(r, kind, side, at, width), label, id: uid("mark") } as Mark, lvl(level).id) as Mark;
    },
    /** Furniture or a fixture, from the catalogue (sizes filled in) or given w/h in feet, placed in a room. */
    addItem({ catalog, room, spot = "center", cx, cy, ...rest }: { catalog?: string; room?: string; spot?: Spot; cx?: number; cy?: number; level?: string } & Partial<Omit<Item, "id" | "type">>): Item {
      const level = lvl(rest.level as string | undefined);
      delete (rest as { level?: string }).level;
      const entry = catalog === undefined ? null : CATALOG.find((c) => c.id === catalog || c.name.toLowerCase() === catalog.toLowerCase())
        ?? fail(`no catalogue entry ${JSON.stringify(catalog)}; see homeDesigner.schema.catalog`);
      if (entry?.point) fail(`"${entry.name}" is a point; use addPoint({ kind: "${entry.point}" })`);
      const [x, y] = room ? spotIn(roomBy(level, room), spot, Math.max(rest.w ?? (entry?.w ?? 24) / 12, rest.h ?? (entry?.h ?? 24) / 12) / 2 + 0.25)
        : [num(cx, "cx"), num(cy, "cy")];
      return insert({
        type: "item", kind: entry?.kind ?? "furniture", shape: entry?.shape ?? "rect", label: entry?.name ?? "", glyph: entry?.glyph,
        w: entry?.w ? entry.w / 12 : undefined, h: entry?.h ? entry.h / 12 : undefined, rot: 0, ...rest, cx: x, cy: y,
      } as Item, level.id) as Item;
    },
    /** A sensor, device, AP… in a room (or at x/y), optionally bound to a Home Assistant entity. */
    addPoint({ kind = "device", label = "", room, spot = "center", x, y, entity, level }: { kind?: Point["kind"]; label?: string; room?: string; spot?: Spot; x?: number; y?: number; entity?: string; level?: string }): Point {
      const L = lvl(level);
      const [px, py] = room ? spotIn(roomBy(L, room), spot) : [num(x, "x"), num(y, "y")];
      return insert({ type: "point", kind, label, x: px, y: py, ...(entity ? { entity } : {}) } as Point, L.id) as Point;
    },
    /** Moves an item, point or note into a room (on its level). */
    place(id: string, { room, spot = "center" }: { room: string; spot?: Spot }): Obj {
      const doc = cur(), { level, index } = locate(doc, id);
      const o = moveTo(level.objects[index], spotIn(roomBy(level, room), spot));
      apply(withLevel(doc, level.id, level.objects.map((x, i) => (i === index ? o : x))));
      return copy(o);
    },
    /** Wall thickness for the whole plan, in feet (0.5 is 6"). */
    setWall(thickness: number): number {
      if (num(thickness, "thickness") <= 0 || thickness > 3) fail("wall thickness must be above 0 and at most 3 feet");
      apply({ ...cur(), wall: thickness });
      return thickness;
    },
    rename(name: string): string { apply({ ...cur(), name: String(name) }); return String(name); },

    // ---- Files and Home Assistant ------------------------------------------------------------
    exportSvg: (levelIds?: string[]): string => docToSvg(cur(), levelIds),
    /** Opens a plan from SVG or JSON text, replacing this one (as Open does). */
    load(text: string, name = "plan.svg"): void { if (pending) fail("can't load inside batch()"); bridge.load(text, name); },
    /** Saves to Home Assistant (only there). */
    async save(): Promise<void> {
      if (!bridge.save) fail("save() works inside Home Assistant; here, use exportSvg() or the Save button");
      if (pending) fail("can't save inside batch(); save after it returns");
      try { await bridge.save!(); } catch (err) {
        throw err instanceof AgentError ? err : new AgentError(`couldn't save to Home Assistant: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    /** Home Assistant entities, optionally filtered by id/name substring or domain ("binary_sensor."). */
    entities(filter?: string): EntityInfo[] {
      if (!bridge.entities) fail("entities() works inside Home Assistant");
      const f = filter?.toLowerCase();
      return bridge.entities!().filter((e) => !f || e.id.toLowerCase().includes(f) || e.name.toLowerCase().includes(f));
    },
  };
  /** Runs fn with the API; all its edits become one undo step, and none apply if it throws. */
  function batch<T>(fn: (a: typeof api) => T): T {
    if (pending) return fn(api);
    pending = bridge.doc();
    try {
      const out = fn(api);
      if (out instanceof Promise) fail("batch() takes a synchronous function");
      const next = pending;
      pending = null;
      if (next !== bridge.doc()) bridge.commit(next);
      return out;
    } finally { pending = null; }
  }
  return Object.assign(api, { batch });
}

export type AgentApi = ReturnType<typeof createAgentApi>;

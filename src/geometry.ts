import { WALLED, type Item, type Mark, type Obj, type Room, type Vec, type MarkKind } from "./model";

export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);
export const dist = (a: Vec, b: Vec) => len(sub(a, b));
export const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const rad = (deg: number) => (deg * Math.PI) / 180;

export interface Box { x0: number; y0: number; x1: number; y1: number }

export function bbox(points: Vec[]): Box {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function rotate(p: Vec, deg: number): Vec {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** World point -> the item's own frame (centred, unrotated), and back. */
export const toLocal = (it: Item, p: Vec): Vec => rotate([p[0] - it.cx, p[1] - it.cy], -it.rot);
export const fromLocal = (it: Item, p: Vec): Vec => add(rotate(p, it.rot), [it.cx, it.cy]);

/** Corners clockwise from the top-left, in world coordinates. */
export function itemCorners(it: Item): Vec[] {
  const w = it.w / 2, h = it.h / 2;
  return ([[-w, -h], [w, -h], [w, h], [-w, h]] as Vec[]).map((p) => fromLocal(it, p));
}

export function objPoints(o: Obj): Vec[] {
  switch (o.type) {
    case "room": return o.points;
    case "item": return itemCorners(o);
    case "mark": case "dim": return [o.a, o.b];
    case "point": case "text": return [[o.x, o.y]];
  }
}

export function polyArea(points: Vec[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    s += x0 * y1 - x1 * y0;
  }
  return Math.abs(s) / 2;
}

export function pointInPoly(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p, and how far along (0..1). */
export function project(p: Vec, a: Vec, b: Vec): { pt: Vec; t: number } {
  const ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2)) : 0;
  return { pt: add(a, mul(ab, t)), t };
}

/** Distance from `o` along unit direction `d` to the first edge of `poly`, or null. */
export function rayToPoly(o: Vec, d: Vec, poly: Vec[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = sub(b, a), den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-9) continue;
    const ao = sub(a, o);
    const t = (ao[0] * e[1] - ao[1] * e[0]) / den, u = (ao[0] * d[1] - ao[1] * d[0]) / den;
    if (t > 1e-6 && u >= -1e-9 && u <= 1 + 1e-9 && (best == null || t < best)) best = t;
  }
  return best;
}

export function walledRooms(objs: Obj[]): Room[] {
  return objs.filter((o): o is Room => o.type === "room" && WALLED.includes(o.kind));
}

/** The smallest walled (or outside) room containing p. */
export function roomAt(objs: Obj[], p: Vec): Room | null {
  const rooms = objs.filter((o): o is Room => o.type === "room" && o.kind !== "labelonly" && pointInPoly(p, o.points));
  rooms.sort((a, b) => polyArea(a.points) - polyArea(b.points));
  return rooms[0] ?? null;
}

/**
 * Snap a door/window mark lying on a wall to that wall's centre line (gen.py's wall_span).
 * Returns the snapped endpoints and the wall thickness, or null to draw the mark as given.
 */
export function wallSpan(objs: Obj[], wall: number, kind: MarkKind, a: Vec, b: Vec): { a: Vec; b: Vec; t: number } | null {
  const rooms = walledRooms(objs).filter((r) => r.kind !== "stairs").map((r) => bbox(r.points));
  const tol = wall + 0.15;
  const vertical = Math.abs(a[0] - b[0]) < 1e-6;
  if (!vertical && Math.abs(a[1] - b[1]) > 1e-6) return null;
  const c = vertical ? a[0] : a[1];
  const [lo, hi] = vertical ? [Math.min(a[1], b[1]), Math.max(a[1], b[1])] : [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  let nearLo: number | null = null, nearHi: number | null = null;
  for (const r of rooms) {
    const [a0, a1, b0, b1] = vertical ? [r.x0, r.x1, r.y0, r.y1] : [r.y0, r.y1, r.x0, r.x1];
    if (b0 >= hi || b1 <= lo) continue;
    if (c - tol <= a1 && a1 <= c + 0.05) nearLo = nearLo == null ? a1 : Math.max(nearLo, a1);
    if (c - 0.05 <= a0 && a0 <= c + tol) nearHi = nearHi == null ? a0 : Math.min(nearHi, a0);
  }
  let lo2: number, hi2: number;
  if (nearLo != null && nearHi != null && nearHi > nearLo) [lo2, hi2] = [nearLo, nearHi];
  else if (kind === "opening" || kind === "slider" || kind === "step") return null;
  else if (nearLo != null) [lo2, hi2] = [nearLo, nearLo + wall];
  else if (nearHi != null) [lo2, hi2] = [nearHi - wall, nearHi];
  else return null;
  const m = (lo2 + hi2) / 2;
  return vertical
    ? { a: [m, a[1]], b: [m, b[1]], t: hi2 - lo2 }
    : { a: [a[0], m], b: [b[0], m], t: hi2 - lo2 };
}

/**
 * Put a freshly drawn mark onto the nearest walled-room edge: the line becomes axis-aligned and
 * lies on that room's face, which is how marks are stored (wallSpan centres them when drawn).
 */
export function snapMarkToWall(objs: Obj[], a: Vec, b: Vec, maxDist: number): { a: Vec; b: Vec } | null {
  const m = mid(a, b);
  let best: { d: number; a: Vec; b: Vec } | null = null;
  for (const r of walledRooms(objs)) {
    const box = bbox(r.points);
    const edges: [boolean, number][] = [[true, box.x0], [true, box.x1], [false, box.y0], [false, box.y1]];
    for (const [vertical, c] of edges) {
      const [lo, hi] = vertical ? [box.y0, box.y1] : [box.x0, box.x1];
      const along = vertical ? m[1] : m[0];
      if (along < lo - 0.5 || along > hi + 0.5) continue;
      const d = Math.abs((vertical ? m[0] : m[1]) - c);
      if (d > maxDist || (best && d >= best.d)) continue;
      const clamp = (v: number) => Math.max(lo, Math.min(hi, v));
      best = vertical
        ? { d, a: [c, clamp(a[1])], b: [c, clamp(b[1])] }
        : { d, a: [clamp(a[0]), c], b: [clamp(b[0]), c] };
    }
  }
  return best && dist(best.a, best.b) > 0.05 ? { a: best.a, b: best.b } : null;
}

/** The walled-room faces a mark can sit on: each room's bounding-box sides. */
function wallFaces(objs: Obj[]) {
  return walledRooms(objs).flatMap((r) => {
    const box = bbox(r.points);
    const inside: Vec = [(box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2];
    return ([[true, box.x0], [true, box.x1], [false, box.y0], [false, box.y1]] as [boolean, number][]).map(([vertical, c]) => ({
      vertical, c, lo: vertical ? box.y0 : box.x0, hi: vertical ? box.y1 : box.x1, inside,
    }));
  });
}

/**
 * Put a mark `len` feet wide, centred as near `c` as fits, on the closest wall face within
 * `maxDist`. Returns its ends (a at the north or west end) and a point inside the face's room.
 */
export function placeOnWall(objs: Obj[], c: Vec, len: number, maxDist: number): { a: Vec; b: Vec; vertical: boolean; inside: Vec } | null {
  let best: { d: number; a: Vec; b: Vec; vertical: boolean; inside: Vec } | null = null;
  for (const f of wallFaces(objs)) {
    const along = f.vertical ? c[1] : c[0];
    if (along < f.lo - 0.5 || along > f.hi + 0.5) continue;
    const d = Math.abs((f.vertical ? c[0] : c[1]) - f.c);
    if (d > maxDist || (best && d >= best.d)) continue;
    const L = Math.min(len, f.hi - f.lo);
    const m = Math.max(f.lo + L / 2, Math.min(f.hi - L / 2, along));
    best = f.vertical
      ? { d, a: [f.c, m - L / 2], b: [f.c, m + L / 2], vertical: true, inside: f.inside }
      : { d, a: [m - L / 2, f.c], b: [m + L / 2, f.c], vertical: false, inside: f.inside };
  }
  return best && dist(best.a, best.b) > 0.05 ? best : null;
}

/** Order a→b so a door's swing side (the left of a→b for swing 1) faces `inside`. */
function facing<T extends { a: Vec; b: Vec }>(m: T, swing: number, inside: Vec): T {
  const L = dist(m.a, m.b) || 1;
  const n: Vec = [(m.b[1] - m.a[1]) / L, -(m.b[0] - m.a[0]) / L];
  const c = mid(m.a, m.b);
  return ((inside[0] - c[0]) * n[0] + (inside[1] - c[1]) * n[1]) * swing >= 0 ? m : { ...m, a: m.b, b: m.a };
}

/** A new mark placed with a click: a door is hinged at one end and opens into the room it's in. */
export function newMarkOnWall(objs: Obj[], kind: MarkKind, c: Vec, len: number, maxDist: number) {
  const s = placeOnWall(objs, c, len, maxDist);
  if (!s) return null;
  return kind === "door" ? { ...facing({ a: s.a, b: s.b }, 1, s.inside), hinge: "a" as const, swing: 1 as const } : { a: s.a, b: s.b };
}

/**
 * Drag a mark so its middle is at `c`: it slides along whatever wall is nearest, keeping its
 * width. Moved to a different wall, a door that opened into its room opens into the new wall's
 * room (and one that opened out still opens out); along the same wall it keeps its swing.
 */
export function moveMarkTo(objs: Obj[], m: Mark, c: Vec, maxDist: number): Mark | null {
  const L = dist(m.a, m.b);
  const s = placeOnWall(objs, c, L, maxDist);
  if (!s) return null;
  const wasVertical = Math.abs(m.a[0] - m.b[0]) < Math.abs(m.a[1] - m.b[1]);
  const line = (q: Vec, vertical: boolean) => (vertical ? q[0] : q[1]);
  // The same wall, give or take its thickness: a door on a shared wall may hop between faces.
  if (s.vertical === wasVertical && Math.abs(line(s.a, s.vertical) - line(m.a, wasVertical)) < 1.5) {
    const forward = wasVertical ? m.b[1] >= m.a[1] : m.b[0] >= m.a[0];
    return forward ? { ...m, a: s.a, b: s.b } : { ...m, a: s.b, b: s.a };
  }
  const from = placeOnWall(objs, mid(m.a, m.b), L, 0.5);
  const inward = !from || facing(m, m.swing ?? 1, from.inside) === m;
  return facing({ ...m, a: s.a, b: s.b }, (m.swing ?? 1) * (inward ? 1 : -1), s.inside);
}

/**
 * A hinged door's leaf drawn open at 90°: the hinge, where the free edge sits shut, and where it
 * swings to. `t` is the wall thickness, so the leaf starts at the wall's face.
 */
export function doorLeaf(m: Mark, a: Vec = m.a, b: Vec = m.b, t = 0): { hinge: Vec; shut: Vec; open: Vec } | null {
  if (m.kind !== "door" || !m.hinge) return null;
  const L = dist(a, b);
  if (L < 0.05) return null;
  const k = m.swing ?? 1;
  const n: Vec = [((b[1] - a[1]) / L) * k, (-(b[0] - a[0]) / L) * k];
  const off = mul(n, t / 2);
  const hinge = add(m.hinge === "a" ? a : b, off), shut = add(m.hinge === "a" ? b : a, off);
  return { hinge, shut, open: add(hinge, mul(n, L)) };
}

/** The next of a door's four hinge/swing combinations, turning it a quarter at a time. */
export function turnDoor(m: Mark, back = false): Mark {
  const order: [Mark["hinge"], 1 | -1][] = [["a", 1], ["b", 1], ["b", -1], ["a", -1]];
  const i = m.hinge ? order.findIndex(([h, s]) => h === m.hinge && s === (m.swing ?? 1)) : -1;
  const [hinge, swing] = i < 0 ? order[0] : order[(i + (back ? 3 : 1)) % 4];
  return { ...m, hinge, swing };
}

export function docBounds(levels: { objects: Obj[] }[]): Box {
  const pts = levels.flatMap((l) => l.objects.flatMap(objPoints));
  if (!pts.length) return { x0: -5, y0: -5, x1: 30, y1: 25 };
  return bbox(pts);
}

/** Snap v to a multiple of step. */
export const snap = (v: number, step: number) => Math.round(v / step) * step;

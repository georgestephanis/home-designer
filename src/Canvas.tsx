// The drawing surface: pan/zoom, selection, dragging, resizing, rotating, drawing rooms,
// doors/windows and dimension lines, and live measurements while you work.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  translate, uid,
  type Dim, type Doc, type Item, type Level, type Mark, type MarkKind, type Obj, type Point, type Room, type Vec,
} from "./model";
import {
  add, bbox, dist, fromLocal, itemCorners, mid, objPoints, polyArea, rayToPoly, rotate, roomAt, snap,
  snapMarkToWall, toLocal, walledRooms,
} from "./geometry";
import { ART_STYLE, Compass, DimLine, LevelArt, type States } from "./render";
import { fmtArea, fmtLen } from "./units";

export type Tool = "select" | "room" | "measure" | "opening" | "text";

export interface View { cx: number; cy: number; scale: number } // scale = px per foot

export interface CanvasProps {
  doc: Doc;
  level: Level;
  below: Level | null;
  tool: Tool;
  markKind: MarkKind;
  selection: string[];
  snapStep: number;
  snapOn: boolean;
  showGrid: boolean;
  showSizes: boolean;
  lockStructure: boolean;
  view: View;
  setView: (v: View | ((v: View) => View)) => void;
  setSelection: (ids: string[]) => void;
  setTool: (t: Tool) => void;
  commit: (fn: (d: Doc) => Doc) => void;
  live: (fn: (d: Doc) => Doc) => void;
  settle: (base: Doc) => void;
  onDropCatalog: (entryId: string, at: Vec) => void;
  toast: (msg: string) => void;
  /** Live entity states, when the plan lives in Home Assistant. */
  states?: States;
}

type Drag =
  | { mode: "pan"; sx: number; sy: number; view: View }
  | { mode: "move"; start: Vec; base: Doc; ids: string[]; moved: boolean }
  | { mode: "vertex"; base: Doc; id: string; index: number }
  | { mode: "edge"; base: Doc; id: string; index: number; start: Vec }
  | { mode: "resize"; base: Doc; id: string; corner: Vec }
  | { mode: "rotate"; base: Doc; id: string }
  | { mode: "end"; base: Doc; id: string; which: "a" | "b" }
  | { mode: "offset"; base: Doc; id: string }
  | { mode: "aim"; base: Doc; id: string }
  | { mode: "draw-rect"; start: Vec; cur: Vec }
  | { mode: "draw-line"; start: Vec; cur: Vec }
  | { mode: "marquee"; start: Vec; cur: Vec; add: boolean };

const STRUCTURE = new Set(["room", "mark"]);
const isStructure = (o: Obj) => STRUCTURE.has(o.type) || (o.type === "item" && o.kind !== "furniture");

export function Canvas(p: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [hover, setHover] = useState<Vec | null>(null);
  const [poly, setPoly] = useState<Vec[] | null>(null); // a room being drawn click by click
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; view: View; mid: { x: number; y: number } } | null>(null);
  const objs = p.level.objects;

  const setD = (d: Drag | null) => { dragRef.current = d; setDrag(d); };

  useLayoutEffect(() => {
    const el = svgRef.current!;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { cx, cy, scale } = p.view;
  const vb = { x: cx - size.w / 2 / scale, y: cy - size.h / 2 / scale, w: size.w / scale, h: size.h / scale };
  const px = 1 / scale; // one screen pixel, in feet

  const toWorld = useCallback((e: { clientX: number; clientY: number }): Vec => {
    const r = svgRef.current!.getBoundingClientRect();
    return [cx + (e.clientX - r.left - r.width / 2) / scale, cy + (e.clientY - r.top - r.height / 2) / scale];
  }, [cx, cy, scale]);

  // Every corner and endpoint on the level, for snapping measurements and rooms to.
  const vertices = useMemo(() => objs.flatMap((o) => (o.type === "text" ? [] : objPoints(o))), [objs]);

  const snapPt = useCallback((q: Vec, e: { altKey: boolean }, toVertices = false): Vec => {
    if (toVertices && !e.altKey) {
      let best: Vec | null = null, bd = 9 / scale;
      for (const v of vertices) { const d = dist(v, q); if (d < bd) { bd = d; best = v; } }
      if (best) return best;
    }
    if (!p.snapOn || e.altKey) return q;
    return [snap(q[0], p.snapStep), snap(q[1], p.snapStep)];
  }, [vertices, scale, p.snapOn, p.snapStep]);

  // ---- Zoom -------------------------------------------------------------------------------
  const zoomAt = useCallback((factor: number, sx: number, sy: number) => {
    p.setView((v) => {
      const r = svgRef.current!.getBoundingClientRect();
      const ox = sx - r.left - r.width / 2, oy = sy - r.top - r.height / 2;
      const scale2 = Math.max(2, Math.min(400, v.scale * factor));
      const wx = v.cx + ox / v.scale, wy = v.cy + oy / v.scale;
      return { scale: scale2, cx: wx - ox / scale2, cy: wy - oy / scale2 };
    });
  }, [p.setView]);

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.shiftKey && e.deltaX === 0) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      } else {
        p.setView((v) => ({ ...v, cx: v.cx + (e.shiftKey ? e.deltaY : e.deltaX) / v.scale, cy: v.cy + (e.shiftKey ? 0 : e.deltaY) / v.scale }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt, p.setView]);

  // ---- Pointer handling -------------------------------------------------------------------
  const objById = useCallback((id: string) => objs.find((o) => o.id === id), [objs]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), view: p.view, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      const d = dragRef.current;
      if (d && "base" in d) p.live(() => d.base);
      setD(null);
      return;
    }
    if (e.button === 1 || (e.button === 0 && e.nativeEvent.getModifierState?.("Space"))) {
      setD({ mode: "pan", sx: e.clientX, sy: e.clientY, view: p.view });
      return;
    }
    if (e.button !== 0) return;
    const w = toWorld(e);
    const target = e.target as Element;
    const handle = target.closest<SVGElement>("[data-handle]");

    if (handle) {
      const [kind, id, extra] = handle.dataset.handle!.split("|");
      const base = p.doc;
      if (kind === "vertex") setD({ mode: "vertex", base, id, index: +extra });
      else if (kind === "edge") setD({ mode: "edge", base, id, index: +extra, start: w });
      else if (kind === "resize") {
        const it = objById(id) as Item;
        const [sxn, syn] = extra.split(",").map(Number);
        setD({ mode: "resize", base, id, corner: [-sxn * it.w / 2, -syn * it.h / 2] });
      } else if (kind === "rotate") setD({ mode: "rotate", base, id });
      else if (kind === "end") setD({ mode: "end", base, id, which: extra as "a" | "b" });
      else if (kind === "offset") setD({ mode: "offset", base, id });
      else if (kind === "aim") setD({ mode: "aim", base, id });
      return;
    }

    if (p.tool === "room") {
      const s = snapPt(w, e, true);
      if (poly) {
        if (poly.length >= 3 && dist(s, poly[0]) < 10 / scale) finishPoly(poly);
        else setPoly([...poly, orthoLock(poly[poly.length - 1], s, e.shiftKey)]);
        return;
      }
      setD({ mode: "draw-rect", start: s, cur: s });
      return;
    }
    if (p.tool === "measure" || p.tool === "opening") {
      const s = snapPt(w, e, p.tool === "measure");
      setD({ mode: "draw-line", start: s, cur: s });
      return;
    }
    if (p.tool === "text") {
      const s = snapPt(w, e);
      const t = { id: uid("text"), type: "text" as const, label: "Note", x: s[0], y: s[1], size: 0.667 };
      p.commit((d) => addObj(d, p.level.id, t));
      p.setSelection([t.id]);
      p.setTool("select");
      return;
    }

    // Select tool.
    const hit = target.closest<SVGElement>("[data-id]");
    const id = hit?.dataset.id;
    const o = id ? objById(id) : undefined;
    if (o && !(p.lockStructure && isStructure(o))) {
      const already = p.selection.includes(o.id);
      let sel = p.selection;
      if (e.shiftKey || e.metaKey || e.ctrlKey) sel = already ? sel.filter((x) => x !== o.id) : [...sel, o.id];
      else if (!already) sel = [o.id];
      p.setSelection(sel);
      // A room is big, so it only moves when it was already selected; otherwise the drag pans.
      if (o.type === "room" && !already && !e.shiftKey) {
        setD({ mode: "pan", sx: e.clientX, sy: e.clientY, view: p.view });
        return;
      }
      if (sel.includes(o.id)) setD({ mode: "move", start: w, base: p.doc, ids: sel, moved: false });
      return;
    }
    if (e.shiftKey) {
      setD({ mode: "marquee", start: w, cur: w, add: true });
      return;
    }
    p.setSelection([]);
    setD({ mode: "pan", sx: e.clientX, sy: e.clientY, view: p.view });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const pv = pinch.current.view, r = svgRef.current!.getBoundingClientRect();
      const scale2 = Math.max(2, Math.min(400, pv.scale * (d / pinch.current.d)));
      const o0 = { x: pinch.current.mid.x - r.left - r.width / 2, y: pinch.current.mid.y - r.top - r.height / 2 };
      const o1 = { x: m.x - r.left - r.width / 2, y: m.y - r.top - r.height / 2 };
      const wx = pv.cx + o0.x / pv.scale, wy = pv.cy + o0.y / pv.scale;
      p.setView({ scale: scale2, cx: wx - o1.x / scale2, cy: wy - o1.y / scale2 });
      return;
    }
    const w = toWorld(e);
    setHover(w);
    const d = dragRef.current;
    if (!d) return;
    switch (d.mode) {
      case "pan":
        p.setView({ ...d.view, cx: d.view.cx - (e.clientX - d.sx) / d.view.scale, cy: d.view.cy - (e.clientY - d.sy) / d.view.scale });
        return;
      case "draw-rect": case "draw-line": {
        const s = snapPt(w, e, true);
        setD({ ...d, cur: d.mode === "draw-line" || e.shiftKey ? orthoLock(d.start, s, e.shiftKey) : s });
        return;
      }
      case "marquee": setD({ ...d, cur: w }); return;
      case "move": {
        let dx = w[0] - d.start[0], dy = w[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dy) * scale < 3) return;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        const baseLevel = d.base.levels.find((l) => l.id === p.level.id)!;
        const moving = baseLevel.objects.filter((o) => d.ids.includes(o.id));
        [dx, dy] = snapMove(moving, baseLevel.objects, dx, dy, p.snapOn && !e.altKey ? p.snapStep : 0, 7 / scale);
        setD({ ...d, moved: true });
        p.live(() => mapObjs(d.base, p.level.id, d.ids, (o) => translate(o, dx, dy)));
        return;
      }
      case "vertex": {
        const s = snapPt(w, e, true);
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const r = o as Room;
          const pts = r.points.slice();
          let q = s;
          if (e.shiftKey) {
            const prev = pts[(d.index - 1 + pts.length) % pts.length];
            q = orthoLock(prev, s, true);
          }
          pts[d.index] = q;
          return { ...r, points: pts };
        }));
        return;
      }
      case "edge": {
        // Drag an edge sideways: both its endpoints move along the edge's normal.
        const r0 = d.base.levels.find((l) => l.id === p.level.id)!.objects.find((o) => o.id === d.id) as Room;
        const i = d.index, j = (i + 1) % r0.points.length;
        const a = r0.points[i], b = r0.points[j];
        const L = dist(a, b) || 1;
        const n: Vec = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L];
        let k = (w[0] - d.start[0]) * n[0] + (w[1] - d.start[1]) * n[1];
        if (p.snapOn && !e.altKey) k = snap(k, p.snapStep);
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const pts = (o as Room).points.slice();
          pts[i] = add(a, [n[0] * k, n[1] * k]);
          pts[j] = add(b, [n[0] * k, n[1] * k]);
          return { ...(o as Room), points: pts };
        }));
        return;
      }
      case "resize": {
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const it = o as Item;
          let q = toLocal(it, w);
          const step = p.snapOn && !e.altKey ? p.snapStep : 0;
          const sx = Math.sign(-d.corner[0]) || 1, sy = Math.sign(-d.corner[1]) || 1;
          let nw = Math.max(step || 1 / 12, (q[0] - d.corner[0]) * sx);
          let nh = Math.max(step || 1 / 12, (q[1] - d.corner[1]) * sy);
          if (step) { nw = Math.max(step, snap(nw, step)); nh = Math.max(step, snap(nh, step)); }
          if (e.shiftKey) { const k = Math.max(nw / it.w, nh / it.h); nw = it.w * k; nh = it.h * k; }
          q = [d.corner[0] + nw * sx, d.corner[1] + nh * sy];
          const c = fromLocal(it, mid(d.corner, q));
          return { ...it, w: nw, h: nh, cx: c[0], cy: c[1] };
        }));
        return;
      }
      case "rotate": {
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const it = o as Item;
          let deg = (Math.atan2(w[1] - it.cy, w[0] - it.cx) * 180) / Math.PI + 90;
          deg = e.altKey ? Math.round(deg) : snap(deg, e.shiftKey ? 45 : 15);
          return { ...it, rot: ((deg % 360) + 540) % 360 - 180 };
        }));
        return;
      }
      case "end": {
        const s = snapPt(w, e, true);
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const m = o as Mark | Dim;
          const other = d.which === "a" ? m.b : m.a;
          let q = s;
          if (m.type === "mark") {
            // Keep a door or window on its wall: slide along the line it already lies on.
            const L = dist(m.a, m.b) || 1;
            const u: Vec = [(m.b[0] - m.a[0]) / L, (m.b[1] - m.a[1]) / L];
            const t = (s[0] - other[0]) * u[0] + (s[1] - other[1]) * u[1];
            q = add(other, [u[0] * t, u[1] * t]);
          } else if (e.shiftKey) q = orthoLock(other, s, true);
          return d.which === "a" ? { ...m, a: q } : { ...m, b: q };
        }));
        return;
      }
      case "offset": {
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const m = o as Dim;
          const L = dist(m.a, m.b) || 1;
          const n: Vec = [(m.b[1] - m.a[1]) / L, -(m.b[0] - m.a[0]) / L];
          let k = (w[0] - m.a[0]) * n[0] + (w[1] - m.a[1]) * n[1];
          if (p.snapOn && !e.altKey) k = snap(k, Math.min(p.snapStep, 0.25));
          return { ...m, offset: k };
        }));
        return;
      }
      case "aim": {
        p.live(() => mapObjs(d.base, p.level.id, [d.id], (o) => {
          const pt = o as Point;
          let deg = (Math.atan2(w[1] - pt.y, w[0] - pt.x) * 180) / Math.PI;
          if (!e.altKey) deg = snap(deg, 5);
          return { ...pt, aim: deg, range: Math.max(1, snap(dist([pt.x, pt.y], w), 0.5)) };
        }));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      return;
    }
    const d = dragRef.current;
    setD(null);
    if (!d) return;
    if ("base" in d) { p.settle(d.base); return; }
    if (d.mode === "draw-rect") {
      const [a, b] = [d.start, d.cur];
      if (Math.abs(a[0] - b[0]) * scale < 4 && Math.abs(a[1] - b[1]) * scale < 4) {
        setPoly([a]); // a click, not a drag: start a room point by point
        return;
      }
      const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
      finishPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
    if (d.mode === "draw-line") {
      if (dist(d.start, d.cur) < 0.1) return;
      if (p.tool === "measure") {
        const dim: Dim = { id: uid("dim"), type: "dim", label: "", a: d.start, b: d.cur, offset: 0 };
        p.commit((doc) => addObj(doc, p.level.id, dim));
        p.setSelection([dim.id]);
      } else {
        const s = snapMarkToWall(objs, d.start, d.cur, 1.5);
        if (!s) { p.toast("Draw doors and windows along a wall."); return; }
        const m: Mark = { id: uid("mark"), type: "mark", kind: p.markKind, label: "", a: s.a, b: s.b };
        p.commit((doc) => addObj(doc, p.level.id, m));
        p.setSelection([m.id]);
      }
    }
    if (d.mode === "marquee") {
      const b = { x0: Math.min(d.start[0], d.cur[0]), x1: Math.max(d.start[0], d.cur[0]), y0: Math.min(d.start[1], d.cur[1]), y1: Math.max(d.start[1], d.cur[1]) };
      const inside = objs.filter((o) => !(p.lockStructure && isStructure(o)) && objPoints(o).every(([x, y]) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1));
      p.setSelection([...new Set([...p.selection, ...inside.map((o) => o.id)])]);
    }
  };

  const finishPoly = (pts: Vec[]) => {
    setPoly(null);
    if (pts.length < 3 || polyArea(pts) < 0.25) return;
    const r: Room = { id: uid("room"), type: "room", kind: "room", label: "Room", points: pts };
    p.commit((doc) => addObj(doc, p.level.id, r));
    p.setSelection([r.id]);
  };

  // Enter/Escape for the point-by-point room.
  useEffect(() => {
    if (!poly) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); setPoly(null); }
      if (e.key === "Enter") { e.stopPropagation(); finishPoly(poly); }
      if (e.key === "Backspace") { e.stopPropagation(); e.preventDefault(); setPoly(poly.length > 1 ? poly.slice(0, -1) : null); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => { if (p.tool !== "room") setPoly(null); }, [p.tool]);

  // ---- Drop furniture from the catalog ----------------------------------------------------
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-hd-catalog")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  };
  const onDrop = (e: React.DragEvent) => {
    const id = e.dataTransfer.getData("application/x-hd-catalog");
    if (!id) return;
    e.preventDefault();
    e.stopPropagation();
    p.onDropCatalog(id, snapPt(toWorld(e), e));
  };

  // ---- Overlays ---------------------------------------------------------------------------
  const sel = objs.filter((o) => p.selection.includes(o.id));
  const single = sel.length === 1 ? sel[0] : null;
  const H = 6 * px; // handle radius

  const overlays: ReactNode[] = [];
  for (const o of sel) {
    if (o.type === "item") overlays.push(<polygon key={`s-${o.id}`} className="sel-outline" points={itemCorners(o).map((q) => q.join(",")).join(" ")} />);
    if (o.type === "room") overlays.push(<polygon key={`s-${o.id}`} className="sel-outline room" points={o.points.map((q) => q.join(",")).join(" ")} />);
    if (o.type === "mark" || o.type === "dim") overlays.push(<line key={`s-${o.id}`} className="sel-outline" x1={o.a[0]} y1={o.a[1]} x2={o.b[0]} y2={o.b[1]} />);
    if (o.type === "point" || o.type === "text") overlays.push(<circle key={`s-${o.id}`} className="sel-outline" cx={o.x} cy={o.y} r={12 * px} />);
  }

  const measures: ReactNode[] = [];
  const dimSize = Math.max(0.3, 12 * px);
  if (single?.type === "room") {
    const pts = single.points;
    const ccw = signedArea(pts) < 0;
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length];
      if (dist(a, b) < 0.2) return;
      // Inside the room: the left of a→b for a clockwise polygon in y-down screen space.
      measures.push(<DimLine key={`e${i}`} className="dim live" a={a} b={b} offset={(ccw ? 1 : -1) * 16 * px} size={dimSize} />);
      overlays.push(<line key={`eh${i}`} className="edge-handle" data-handle={`edge|${single.id}|${i}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ strokeWidth: 10 * px }} />);
    });
    pts.forEach((q, i) => overlays.push(<rect key={`v${i}`} className="handle" data-handle={`vertex|${single.id}|${i}`} x={q[0] - H} y={q[1] - H} width={2 * H} height={2 * H} />));
  }
  if (single?.type === "item") {
    const it = single;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const q = fromLocal(it, [sx * it.w / 2, sy * it.h / 2]);
      overlays.push(<rect key={`r${sx}${sy}`} className="handle" data-handle={`resize|${it.id}|${sx},${sy}`}
        x={q[0] - H} y={q[1] - H} width={2 * H} height={2 * H} transform={`rotate(${it.rot} ${q[0]} ${q[1]})`} />);
    }
    const top = fromLocal(it, [0, -it.h / 2]), knob = fromLocal(it, [0, -it.h / 2 - 26 * px]);
    overlays.push(<line key="rl" className="sel-outline" x1={top[0]} y1={top[1]} x2={knob[0]} y2={knob[1]} />);
    overlays.push(<circle key="rk" className="handle round" data-handle={`rotate|${it.id}`} cx={knob[0]} cy={knob[1]} r={H * 1.1} />);
    // Clearance to the walls of whatever room it sits in.
    const room = roomAt(objs.filter((o) => o.id !== it.id), [it.cx, it.cy]);
    if (room) {
      const dirs: [Vec, Vec][] = [[[0, -it.h / 2], [0, -1]], [[it.w / 2, 0], [1, 0]], [[0, it.h / 2], [0, 1]], [[-it.w / 2, 0], [-1, 0]]];
      dirs.forEach(([o, dvec], i) => {
        const from = fromLocal(it, o), dir = rotate(dvec, it.rot);
        const t = rayToPoly(from, dir, room.points);
        if (t != null && t > 0.04 && t < 40) {
          measures.push(<DimLine key={`c${i}`} className="dim clear" a={from} b={add(from, [dir[0] * t, dir[1] * t])} offset={0} size={dimSize} />);
        }
      });
    }
    measures.push(<text key="sz" className="live-size" x={it.cx} y={it.cy + Math.max(it.w, it.h) / 2 + 30 * px} fontSize={dimSize}>
      {fmtLen(it.w)} × {fmtLen(it.h)}</text>);
  }
  if (single?.type === "mark" || single?.type === "dim") {
    for (const which of ["a", "b"] as const) {
      const q = single[which];
      overlays.push(<circle key={which} className="handle round" data-handle={`end|${single.id}|${which}`} cx={q[0]} cy={q[1]} r={H} />);
    }
    if (single.type === "mark") measures.push(<DimLine key="ml" className="dim live" a={single.a} b={single.b} offset={-22 * px} size={dimSize} />);
    if (single.type === "dim") {
      const L = dist(single.a, single.b) || 1;
      const n: Vec = [(single.b[1] - single.a[1]) / L, -(single.b[0] - single.a[0]) / L];
      const m = add(mid(single.a, single.b), [n[0] * single.offset, n[1] * single.offset]);
      overlays.push(<rect key="off" className="handle" data-handle={`offset|${single.id}`} x={m[0] - H} y={m[1] - H} width={2 * H} height={2 * H} transform={`rotate(45 ${m[0]} ${m[1]})`} />);
    }
  }
  if (single?.type === "point" && single.kind === "sensor") {
    const a = ((single.aim ?? -90) * Math.PI) / 180, r = single.range ?? 6;
    const q: Vec = [single.x + r * Math.cos(a), single.y + r * Math.sin(a)];
    overlays.push(<circle key="aim" className="handle round" data-handle={`aim|${single.id}`} cx={q[0]} cy={q[1]} r={H} />);
  }

  // In-progress drawing.
  const ghost: ReactNode[] = [];
  if (drag?.mode === "draw-rect") {
    const [a, b] = [drag.start, drag.cur];
    const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), w = Math.abs(a[0] - b[0]), hh = Math.abs(a[1] - b[1]);
    ghost.push(<rect key="gr" className="ghost" x={x0} y={y0} width={w} height={hh} />);
    if (w > 0.1) ghost.push(<DimLine key="gw" className="dim live" a={[x0, y0]} b={[x0 + w, y0]} offset={16 * px} size={dimSize} />);
    if (hh > 0.1) ghost.push(<DimLine key="gh" className="dim live" a={[x0, y0 + hh]} b={[x0, y0]} offset={16 * px} size={dimSize} />);
    if (w > 0.5 && hh > 0.5) ghost.push(<text key="ga" className="live-size" x={x0 + w / 2} y={y0 + hh / 2} fontSize={dimSize}>{fmtArea(w * hh)}</text>);
  }
  if (drag?.mode === "draw-line") {
    if (p.tool === "measure") ghost.push(<DimLine key="gl" className="dim live" a={drag.start} b={drag.cur} offset={0} size={dimSize} />);
    else {
      const s = snapMarkToWall(objs, drag.start, drag.cur, 1.5);
      const a = s?.a ?? drag.start, b = s?.b ?? drag.cur;
      ghost.push(<line key="gl2" className={`ghost-line${s ? "" : " bad"}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={{ strokeWidth: 8 * px }} />);
      ghost.push(<DimLine key="gd" className="dim live" a={a} b={b} offset={-22 * px} size={dimSize} />);
    }
  }
  if (drag?.mode === "marquee") {
    const [a, b] = [drag.start, drag.cur];
    ghost.push(<rect key="mq" className="marquee" x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(a[0] - b[0])} height={Math.abs(a[1] - b[1])} />);
  }
  if (poly) {
    const end = hover ? orthoLock(poly[poly.length - 1], snapPt(hover, { altKey: false }, true), false) : poly[poly.length - 1];
    const pts = [...poly, end];
    ghost.push(<polyline key="pp" className="ghost" points={pts.map((q) => q.join(",")).join(" ")} />);
    poly.forEach((q, i) => ghost.push(<circle key={`pp${i}`} className="handle round" cx={q[0]} cy={q[1]} r={H * (i === 0 ? 1.3 : 0.8)} />));
    ghost.push(<DimLine key="pd" className="dim live" a={poly[poly.length - 1]} b={end} offset={16 * px} size={dimSize} />);
  }

  // Room sizes, as a second line under each room's name.
  const sizes: ReactNode[] = [];
  if (p.showSizes) {
    for (const r of objs) {
      if (r.type !== "room" || r.kind === "labelonly" || r.kind === "outside") continue;
      const b = bbox(r.points);
      const w = b.x1 - b.x0, hh = b.y1 - b.y0;
      if (w < 3 || hh < 2.5) continue;
      const rect = r.points.length === 4 && Math.abs(polyArea(r.points) - w * hh) < 0.01;
      const fs = Math.min(0.5, (w - 0.3) / 7.5);
      sizes.push(<text key={r.id} className="room-size" x={(b.x0 + b.x1) / 2} y={(b.y0 + b.y1) / 2 + (r.kind === "room" ? 1.05 : 0.8)} fontSize={fs}>
        {rect ? `${fmtLen(w)} × ${fmtLen(hh)}` : fmtArea(polyArea(r.points))}</text>);
    }
  }

  // Grid.
  const grid: ReactNode[] = [];
  if (p.showGrid) {
    const minor = p.snapStep * scale >= 7 ? p.snapStep : scale >= 7 ? 1 : 5;
    const gx0 = Math.floor(vb.x / minor) * minor, gy0 = Math.floor(vb.y / minor) * minor;
    const nx = Math.ceil(vb.w / minor) + 1, ny = Math.ceil(vb.h / minor) + 1;
    if (nx < 600 && ny < 600) {
      let dMinor = "", dMajor = "";
      for (let i = 0; i <= nx; i++) {
        const x = gx0 + i * minor;
        const s = `M${x},${vb.y}V${vb.y + vb.h}`;
        if (Math.abs(x / 5 - Math.round(x / 5)) < 1e-6) dMajor += s; else dMinor += s;
      }
      for (let i = 0; i <= ny; i++) {
        const y = gy0 + i * minor;
        const s = `M${vb.x},${y}H${vb.x + vb.w}`;
        if (Math.abs(y / 5 - Math.round(y / 5)) < 1e-6) dMajor += s; else dMinor += s;
      }
      grid.push(<path key="gm" className="grid minor" d={dMinor} style={{ strokeWidth: px }} />);
      grid.push(<path key="gM" className="grid major" d={dMajor} style={{ strokeWidth: px }} />);
    }
  }

  const cursor = drag?.mode === "pan" ? "grabbing" : p.tool === "select" ? "default" : "crosshair";

  return (
    <svg
      ref={svgRef}
      className="canvas hd-art"
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      style={{ cursor, ["--px" as string]: px }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => {
        if (poly) { finishPoly(poly); return; }
        const h = (e.target as Element).closest<SVGElement>("[data-handle]")?.dataset.handle;
        if (h?.startsWith("edge|")) {
          // Double-click an edge of the selected room to add a corner there.
          const [, id, i] = h.split("|");
          const w = snapPt(toWorld(e), e);
          p.commit((d) => mapObjs(d, p.level.id, [id], (o) => {
            const pts = (o as Room).points.slice();
            pts.splice(+i + 1, 0, w);
            return { ...(o as Room), points: pts };
          }));
        }
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      aria-label={`${p.level.title} plan`}
    >
      <style>{ART_STYLE}</style>
      <rect className="bg" x={vb.x} y={vb.y} width={vb.w} height={vb.h} />
      {grid}
      {p.below && <g className="below" style={{ pointerEvents: "none" }}><LevelArt level={p.below} wall={p.doc.wall} /></g>}
      <g className={p.lockStructure ? "locked" : ""}><LevelArt level={p.level} wall={p.doc.wall} states={p.states} /></g>
      <g className="sizes" style={{ pointerEvents: "none" }}>{sizes}</g>
      <g className="measures" style={{ pointerEvents: "none" }}>{measures}</g>
      <g className="overlays">{overlays}</g>
      <g className="ghosts" style={{ pointerEvents: "none" }}>{ghost}</g>
      <Compass x={vb.x + vb.w - 34 * px} y={vb.y + 40 * px} size={34 * px} />
      <ScaleBar vb={vb} px={px} />
    </svg>
  );
}

function ScaleBar({ vb, px }: { vb: { x: number; y: number; w: number; h: number }; px: number }) {
  // A bar about 100 px long, rounded to a tidy length.
  const target = 100 * px;
  const steps = [0.5, 1, 2, 5, 10, 20, 50, 100];
  const L = steps.find((s) => s >= target * 0.6) ?? 100;
  const x = vb.x + 20 * px, y = vb.y + vb.h - 22 * px;
  return (
    <g className="scalebar" style={{ pointerEvents: "none" }}>
      <path d={`M${x},${y - 5 * px}V${y}H${x + L}V${y - 5 * px}`} style={{ strokeWidth: 1.5 * px }} />
      <text x={x + L / 2} y={y - 9 * px} fontSize={11 * px}>{fmtLen(L)}</text>
    </g>
  );
}

function signedArea(pts: Vec[]) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
}

/** With lock on, keep b level or plumb with a. */
function orthoLock(a: Vec, b: Vec, lock: boolean): Vec {
  if (!lock) return b;
  return Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]];
}

export function addObj(d: Doc, levelId: string, o: Obj): Doc {
  return { ...d, levels: d.levels.map((l) => (l.id === levelId ? { ...l, objects: [...l.objects, o] } : l)) };
}

export function mapObjs(d: Doc, levelId: string, ids: string[], fn: (o: Obj) => Obj): Doc {
  const set = new Set(ids);
  return { ...d, levels: d.levels.map((l) => (l.id === levelId ? { ...l, objects: l.objects.map((o) => (set.has(o.id) ? fn(o) : o)) } : l)) };
}

/**
 * The move to apply for a drag of (dx, dy): snapped to the grid, except that a lone
 * square-on item's sides also stick to nearby room walls (within `near` feet).
 */
function snapMove(moving: Obj[], all: Obj[], dx: number, dy: number, step: number, near: number): [number, number] {
  let sx = step ? snap(dx, step) : dx, sy = step ? snap(dy, step) : dy;
  if (moving.length !== 1 || moving[0].type !== "item") return [sx, sy];
  const it = moving[0];
  const q = ((it.rot % 90) + 90) % 90;
  if (q > 0.5 && q < 89.5) return [sx, sy];
  const b = bbox(itemCorners(it));
  const xs: number[] = [], ys: number[] = [];
  for (const r of walledRooms(all)) {
    const rb = bbox(r.points);
    xs.push(rb.x0, rb.x1);
    ys.push(rb.y0, rb.y1);
  }
  const stick = (lo: number, hi: number, d: number, lines: number[]) => {
    let best: number | null = null;
    for (const c of lines) for (const e of [lo, hi]) {
      const k = c - e;
      if (Math.abs(k - d) < near && (best == null || Math.abs(k - d) < Math.abs(best - d))) best = k;
    }
    return best;
  };
  const wx = stick(b.x0, b.x1, dx, xs), wy = stick(b.y0, b.y1, dy, ys);
  if (wx != null) sx = wx;
  if (wy != null) sy = wy;
  return [sx, sy];
}

export const _test = { snapMove, orthoLock };

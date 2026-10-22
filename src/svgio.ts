// Saving and loading. A saved SVG is a normal drawing (all floors side by side) with the whole
// project embedded as JSON in <metadata>, so it reopens exactly. Plain SVGs, including the ones
// gen.py writes, are imported best-effort from their shapes.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isDoc, ITEM_KINDS, MARK_KINDS, ROOM_KINDS, uid,
  type Doc, type Item, type ItemKind, type Level, type MarkKind, type Obj, type Point, type PointKind, type Room, type RoomKind, type Vec,
} from "./model";
import { bbox, dist, docBounds, mid, pointInPoly, polyArea } from "./geometry";
import { ART_STYLE, Compass, LevelArt, PX_PER_FT } from "./render";

const META_ID = "home-designer-doc";
const cdata = (s: string) => `<![CDATA[${s.replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

/** The project as an SVG: the chosen levels side by side, the full document in <metadata>. */
export function docToSvg(doc: Doc, levelIds?: string[]): string {
  const levels = doc.levels.filter((l) => !levelIds || levelIds.includes(l.id));
  const b = docBounds(levels);
  const pad = 2, gap = 6, titleH = 2.2;
  const pw = b.x1 - b.x0 + pad * 2;
  const W = levels.length * pw + (levels.length - 1) * gap;
  const H = b.y1 - b.y0 + pad * 2 + titleH;
  const vx = b.x0 - pad, vy = b.y0 - pad - titleH;
  const panels = levels.map((l, i) => {
    const dx = i * (pw + gap);
    return h("g", { key: l.id, transform: `translate(${dx} 0)` },
      h("text", { className: "title", x: vx + 0.4, y: vy + 1.4, fontSize: 1.1 }, l.title),
      h(Compass, { x: vx + pw - 1.1, y: vy + 1.6 }),
      h(LevelArt, { level: l, wall: doc.wall }));
  });
  const svg = h("svg", {
    xmlns: "http://www.w3.org/2000/svg", className: "hd-art",
    viewBox: `${r3(vx)} ${r3(vy)} ${r3(W)} ${r3(H)}`,
    width: Math.round(W * PX_PER_FT), height: Math.round(H * PX_PER_FT),
    role: "img", "aria-label": doc.name,
  },
    h("metadata", { id: META_ID, dangerouslySetInnerHTML: { __html: cdata(JSON.stringify(doc)) } }),
    h("style", { dangerouslySetInnerHTML: { __html: cdata(ART_STYLE) } }),
    h("rect", { className: "bg", x: vx, y: vy, width: W, height: H }),
    ...panels);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(svg)}\n`;
}

const r3 = (v: number) => +v.toFixed(3);

export interface Loaded { doc: Doc; note?: string }

export function parseFile(text: string, name: string): Loaded {
  const t = text.trimStart();
  if (name.toLowerCase().endsWith(".json") || t.startsWith("{")) {
    const d = JSON.parse(t);
    if (!isDoc(d)) throw new Error("That JSON file isn't a Home Designer project.");
    return { doc: d };
  }
  const dom = new DOMParser().parseFromString(text, "image/svg+xml");
  if (dom.querySelector("parsererror")) throw new Error("That file isn't valid SVG.");
  const meta = dom.getElementById(META_ID);
  if (meta?.textContent) {
    const d = JSON.parse(meta.textContent);
    if (isDoc(d)) return { doc: d };
  }
  return importShapes(dom, name);
}

// ---------------------------------------------------------------------------------------------
// Importing a plain SVG.

const nums = (s: string | null) => (s ?? "").trim().split(/[\s,]+/).filter(Boolean).map(Number);
const pairs = (a: number[]): Vec[] => {
  const out: Vec[] = [];
  for (let i = 0; i + 1 < a.length; i += 2) out.push([a[i], a[i + 1]]);
  return out;
};
const num = (el: Element, attr: string) => parseFloat(el.getAttribute(attr) ?? "0") || 0;

function shapePoints(el: Element): Vec[] | null {
  const tag = el.localName;
  if (tag === "polygon" || tag === "polyline") return pairs(nums(el.getAttribute("points")));
  if (tag === "rect") {
    const x = num(el, "x"), y = num(el, "y"), w = num(el, "width"), hh = num(el, "height");
    if (!w || !hh || el.getAttribute("width")?.endsWith("%")) return null;
    return [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
  }
  return null;
}

/** A 4-point polygon as centre, size and rotation. */
function fitRect(p: Vec[]): Pick<Item, "cx" | "cy" | "w" | "h" | "rot"> {
  const [p0, p1, , p3] = p;
  return {
    cx: (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4, cy: (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4,
    w: dist(p0, p1), h: dist(p0, p3), rot: (Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180) / Math.PI,
  };
}

const POINT_CLASSES: PointKind[] = ["device", "ap", "lora"];

function importShapes(dom: Document, name: string): Loaded {
  const root = dom.documentElement;
  const genLevels = [...root.querySelectorAll("g.level")];
  const isGen = genLevels.length > 0;
  const groups = isGen ? genLevels : [root];

  // gen.py draws at 30 px per foot. Anything else: guess a scale that makes the drawing ~40 ft
  // wide, and say so.
  let scale = PX_PER_FT;
  if (!isGen) {
    const all = [...root.querySelectorAll("polygon,polyline,rect")].map(shapePoints).filter(Boolean).flat() as Vec[];
    if (all.length) {
      const b = bbox(all);
      scale = Math.max(1e-6, (b.x1 - b.x0) / 40);
    }
  }
  const S = (p: Vec): Vec => [p[0] / scale, p[1] / scale];

  const levels: Level[] = groups.map((g, i) => {
    const objs: Obj[] = [];
    const id = g.getAttribute("data-level") || (groups.length > 1 ? `level${i + 1}` : "imported");
    const rooms: Room[] = [];
    const texts: { cls: string[]; x: number; y: number; text: string }[] = [];

    for (const el of g.querySelectorAll("*")) {
      const cls = [...el.classList];
      const tag = el.localName;
      if (cls.includes("wall") || cls.includes("tread") || cls.includes("bg") || el.closest("defs,metadata,style")) continue;
      if (tag === "text") {
        const x = num(el, "x") / scale, y = num(el, "y") / scale;
        if (el.textContent?.trim()) texts.push({ cls, x, y, text: el.textContent.trim() });
        continue;
      }
      if (tag === "line" && cls.includes("mark")) {
        const kind = cls.find((c) => MARK_KINDS.includes(c as MarkKind)) as MarkKind | undefined;
        if (!kind) continue;
        objs.push({ id: uid("mark"), type: "mark", kind, label: "",
          a: S([num(el, "x1"), num(el, "y1")]), b: S([num(el, "x2"), num(el, "y2")]) });
        continue;
      }
      if (tag === "circle") {
        const kind = cls.find((c) => POINT_CLASSES.includes(c as PointKind)) as PointKind | undefined;
        const c = S([num(el, "cx"), num(el, "cy")]);
        if (kind) objs.push({ id: uid("pt"), type: "point", kind, label: "", x: c[0], y: c[1] });
        else if (cls.includes("sensor")) {
          const fov = g.querySelector("path.fov");
          const n = fov ? nums((fov.getAttribute("d") ?? "").replace(/[MLAZ]/gi, " ")) : [];
          let aim = -90, range = 6;
          if (n.length >= 11) {
            const w0 = S([n[2], n[3]]), w1 = S([n[9], n[10]]), m = mid(w0, w1);
            aim = (Math.atan2(m[1] - c[1], m[0] - c[0]) * 180) / Math.PI;
            range = n[4] / scale;
          }
          objs.push({ id: uid("pt"), type: "point", kind: "sensor", label: "", x: c[0], y: c[1], aim, range });
        }
        continue;
      }
      if (tag === "rect" && cls.includes("thermo")) {
        const c = S([num(el, "x") + num(el, "width") / 2, num(el, "y") + num(el, "height") / 2]);
        objs.push({ id: uid("pt"), type: "point", kind: "thermo", label: "", x: c[0], y: c[1] });
        continue;
      }
      const pts = shapePoints(el);
      if (!pts || pts.length < 3) continue;
      const world = pts.map(S);
      const itemKind = cls.find((c) => ITEM_KINDS.includes(c as ItemKind)) as ItemKind | undefined;
      if (itemKind && world.length === 4) {
        objs.push({ id: uid("item"), type: "item", kind: itemKind, shape: "rect", label: "", ...fitRect(world) });
        continue;
      }
      if (cls.includes("fov") || cls.includes("compass")) continue;
      const kind = (cls.find((c) => c !== "room" && ROOM_KINDS.includes(c as RoomKind)) ??
        (isGen && !cls.includes("room") ? null : "room")) as RoomKind | null;
      if (!kind) continue;
      const room: Room = { id: uid("room"), type: "room", kind, label: "", points: world };
      rooms.push(room);
      objs.push(room);
    }

    // Labels: room names go to the smallest unnamed room under them; notes to the nearest
    // unnamed item, mark or point; anything left becomes free text.
    for (const t of texts) {
      const p: Vec = [t.x, t.y];
      if (t.cls.includes("label")) {
        const under = rooms.filter((r) => !r.label && pointInPoly(p, r.points))
          .sort((a, b) => polyArea(a.points) - polyArea(b.points))[0];
        if (under) { under.label = t.text; continue; }
      } else if (t.cls.includes("note")) {
        const near = nearestUnlabelled(objs, p, t.cls);
        if (near) { near.label = t.text; continue; }
        if (isGen) continue; // gen.py's street and compass notes
      }
      objs.push({ id: uid("text"), type: "text", label: t.text, x: t.x, y: t.y, size: 0.667 });
    }
    return { id, title: titleFor(id, g, name), objects: objs };
  });

  const note = isGen
    ? "Imported from a plain plan SVG. Coordinates were rounded to the nearest 0.4″ when it was drawn."
    : "Imported a plain SVG. Its scale is a guess (about 40′ wide): draw a dimension over a known length and use “Rescale floor” to fix it.";
  return {
    doc: { app: "home-designer", version: 1, name: name.replace(/\.svg$/i, ""), wall: 1, levels },
    note,
  };
}

const LEVEL_TITLES: Record<string, string> = {
  basement: "Basement", floor1: "First floor", floor2: "Second floor", attic: "Attics",
};

function titleFor(id: string, g: Element, file: string): string {
  return LEVEL_TITLES[id] ?? g.getAttribute("aria-label") ?? file.replace(/\.svg$/i, "");
}

function nearestUnlabelled(objs: Obj[], p: Vec, cls: string[]): Item | Point | { label: string } | null {
  let best: { o: Obj; d: number } | null = null;
  const consider = (o: Obj, at: Vec, max: number) => {
    const d = dist(at, p);
    if (d <= max && (!best || d < best.d)) best = { o, d };
  };
  for (const o of objs) {
    if (o.label) continue;
    if (o.type === "point") {
      if (cls.includes("sensor-label") !== (o.kind === "sensor")) continue;
      consider(o, [o.x + 0.4, o.y + (o.kind === "sensor" ? 0.6 : 0.2)], 1.2);
    } else if (!cls.includes("device-label") && !cls.includes("sensor-label")) {
      if (o.type === "item") consider(o, [o.cx, o.cy - 0.4], 1.5);
      if (o.type === "mark") consider(o, mid(o.a, o.b), 1.5);
    }
  }
  return (best as { o: Obj } | null)?.o as Item | Point | null;
}

/** Scale every object on a level by k around `origin` (e.g. to calibrate an import). */
export function scaleLevel(level: Level, k: number, origin: Vec): Level {
  const s = (p: Vec): Vec => [origin[0] + (p[0] - origin[0]) * k, origin[1] + (p[1] - origin[1]) * k];
  return {
    ...level,
    objects: level.objects.map((o): Obj => {
      switch (o.type) {
        case "room": return { ...o, points: o.points.map(s) };
        case "item": { const [cx, cy] = s([o.cx, o.cy]); return { ...o, cx, cy, w: o.w * k, h: o.h * k }; }
        case "mark": case "dim": return { ...o, a: s(o.a), b: s(o.b) };
        case "point": { const [x, y] = s([o.x, o.y]); return { ...o, x, y, range: o.range && o.range * k }; }
        case "text": { const [x, y] = s([o.x, o.y]); return { ...o, x, y }; }
      }
    }),
  };
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type { Point };

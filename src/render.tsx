// Draws a level. Used both by the editor canvas and by SVG export, so a saved file looks like
// the editor. All sizes are in feet (the SVG user unit); exports scale 1 ft = 30 px.
import type { ReactNode } from "react";
import { WALLED, type Dim, type Item, type Level, type Mark, type Obj, type Point, type Room, type Text, type Vec } from "./model";
import { bbox, dist, doorLeaf, mid, rad, roomAt, wallSpan } from "./geometry";
import { fmtLen } from "./units";

export const PX_PER_FT = 30;

export const DARK = `--bg:#15171a;--ink:#e6e8eb;--muted:#9aa3ad;--line:#a8b3c2;--room:#1d2126;--hall:#232a33;--stairs:#2b3038;
--wall:#7b8796;--attic:#2a2620;--wet:#16324a;--closet:#262a30;--fixture:#3b4350;--furn:#2a2f37;--accent:#fb923c;
--window:#38bdf8;--fov:rgba(251,146,60,.12);--dim:#93c5fd;--stone:#78716c`;

/** The plan's palette and classes, scoped to `.hd-art` so it can sit inside the app page. */
export const ART_STYLE = `
.hd-art{--bg:#fbfaf7;--ink:#1f2328;--muted:#6b7280;--line:#334155;--room:#ffffff;--hall:#eef2f7;--stairs:#e5e7eb;
--wall:#475569;--attic:#f5efe6;--wet:#e0f2fe;--closet:#f3f4f6;--fixture:#cbd5e1;--furn:#eef1f5;--accent:#c2410c;
--window:#0284c7;--fov:rgba(194,65,12,.10);--dim:#1d4ed8;--stone:#57534e}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]) .hd-art{${DARK}}}
:root[data-theme="dark"] .hd-art{${DARK}}
.hd-art .bg{fill:var(--bg)}
.hd-art .wall{fill:var(--wall)}
.hd-art .room{stroke:var(--line);stroke-width:.034;stroke-opacity:.35;stroke-linejoin:round}
.hd-art .room.room{fill:var(--room)} .hd-art .room.hall{fill:var(--hall)} .hd-art .room.stairs{fill:var(--stairs)}
.hd-art .room.wet{fill:var(--wet)} .hd-art .room.closet{fill:var(--closet)} .hd-art .room.attic{fill:var(--attic)}
.hd-art .room.outside{fill:none;stroke-width:.067;stroke-dasharray:.27 .2}
.hd-art .room.labelonly{fill:none;stroke:none}
.hd-art .tread{stroke:var(--line);stroke-width:.034;opacity:.45}
.hd-art .fixture{fill:var(--fixture)} .hd-art .stone{fill:var(--stone)} .hd-art .baseboard{fill:#dc2626}
.hd-art .chimney{fill:var(--line);fill-opacity:.45;stroke:var(--line);stroke-width:.067}
.hd-art .cage{fill:none;stroke:var(--accent);stroke-width:.067;stroke-dasharray:.13 .13}
.hd-art .furniture{fill:var(--furn);stroke:var(--line);stroke-width:.04;stroke-opacity:.8}
.hd-art .glyph{fill:none;stroke:var(--line);stroke-width:.03;stroke-opacity:.6}
.hd-art .glyph.solid{fill:var(--line);fill-opacity:.12}
.hd-art .rug{fill:var(--furn);fill-opacity:.5;stroke:var(--line);stroke-width:.03;stroke-dasharray:.2 .12;stroke-opacity:.5}
.hd-art text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
.hd-art .label{font-weight:600;fill:var(--ink);text-anchor:middle;dominant-baseline:middle}
.hd-art .label.minor{font-weight:500}
.hd-art .note{font-weight:500;fill:var(--muted);text-anchor:middle;dominant-baseline:middle}
.hd-art .note.start{text-anchor:start} .hd-art .note.end{text-anchor:end} .hd-art .note.ink{fill:var(--ink)}
.hd-art .mark{stroke-width:.3;stroke-linecap:butt;fill:none}
.hd-art .mark.door{stroke:var(--accent)} .hd-art .leaf{stroke:var(--accent);stroke-width:.07;stroke-linecap:round;fill:none}
.hd-art .swing{stroke:var(--accent);stroke-width:.035;stroke-opacity:.6;stroke-dasharray:.15 .1;fill:none} .hd-art .mark.garage{stroke:var(--accent);stroke-width:.4}
.hd-art .mark.blocked{stroke:var(--muted);stroke-dasharray:.27 .17} .hd-art .mark.opening{stroke:var(--hall);stroke-width:.37}
.hd-art .mark.window{stroke:var(--window);stroke-width:.23}
.hd-art .mark.window-blocked{stroke:var(--muted);stroke-width:.23;stroke-dasharray:.07 .1}
.hd-art .mark.window-maybe{stroke:var(--window);stroke-width:.23;stroke-dasharray:.17 .13}
.hd-art .mark.slider{stroke:var(--muted);stroke-width:.13;stroke-dasharray:.33 .1}
.hd-art .mark.step{stroke:var(--line);stroke-width:.1;stroke-dasharray:.1 .1}
.hd-art .device{fill:var(--bg);stroke:var(--ink);stroke-width:.083}
.hd-art .ap{fill:#7c3aed;stroke:var(--bg);stroke-width:.083} .hd-art .lora{fill:#16a34a;stroke:var(--bg);stroke-width:.083}
.hd-art .thermo{fill:#d97706;stroke:var(--bg);stroke-width:.067}
.hd-art .sensor{fill:var(--accent)} .hd-art .fov{fill:var(--fov);stroke:var(--accent);stroke-width:.067;stroke-dasharray:.2 .2}
.hd-art .dim line{stroke:var(--dim);stroke-width:.04} .hd-art .dim text{fill:var(--dim);font-weight:600;text-anchor:middle;dominant-baseline:middle;paint-order:stroke;stroke:var(--bg);stroke-linejoin:round}
.hd-art .free{fill:var(--ink);font-weight:500;text-anchor:middle;dominant-baseline:middle}
.hd-art .title{fill:var(--ink);font-weight:700}
.hd-art .glow{fill:#facc15;pointer-events:none}
.hd-art .bound{fill:none;stroke:var(--accent);stroke-width:.06}
.hd-art .device.on{fill:#facc15;stroke:#a16207}
`;

/** Home Assistant states for the entities placed on the plan, by entity id. */
export type States = Record<string, string | undefined>;

/** Where a placed entity sits on the plan. */
export function entityAt(o: Obj): Vec | null {
  if (!("entity" in o) || !o.entity) return null;
  return o.type === "point" ? [o.x, o.y] : o.type === "item" ? [o.cx, o.cy] : null;
}

/**
 * Rooms lit by a light that's on, with how many are on in each. A light lights the smallest
 * room it sits in, so moving it on the plan moves the glow too.
 */
export function litRooms(objs: Obj[], states: States): { room: Room; n: number }[] {
  const lit = new Map<Room, number>();
  for (const o of objs) {
    const at = entityAt(o);
    const id = "entity" in o ? o.entity : undefined;
    if (!at || !id?.startsWith("light.") || states[id] !== "on") continue;
    const r = roomAt(objs, at);
    if (r) lit.set(r, (lit.get(r) ?? 0) + 1);
  }
  return [...lit].map(([room, n]) => ({ room, n }));
}

const LABEL_W = 0.58; // average glyph width / font size, as gen.py estimates it

function roomLabel(text: string, points: Vec[], kind: string, id?: string): ReactNode {
  const b = bbox(points);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const base = kind === "room" || kind === "outside" ? 1 : 0.667;
  const w = b.x1 - b.x0 - 0.33, h = b.y1 - b.y0 - 0.33;
  const fit = (span: number) => span / (LABEL_W * Math.max(1, text.length));
  const cls = `label${kind === "room" || kind === "outside" ? "" : " minor"}`;
  if (fit(w) < 0.43 && h > w) {
    return <text key={`l-${id}`} className={cls} x={cx} y={cy} fontSize={Math.min(base, fit(h))}
      transform={`rotate(-90 ${cx} ${cy})`}>{text}</text>;
  }
  return <text key={`l-${id}`} className={cls} x={cx} y={cy} fontSize={Math.max(0.2, Math.min(base, fit(w)))}>{text}</text>;
}

const ptsAttr = (pts: Vec[]) => pts.map((p) => `${+p[0].toFixed(3)},${+p[1].toFixed(3)}`).join(" ");

function RoomShape({ r }: { r: Room }) {
  const treads: ReactNode[] = [];
  if (r.kind === "stairs") {
    const b = bbox(r.points);
    const vertical = b.y1 - b.y0 >= b.x1 - b.x0;
    const span = vertical ? b.y1 - b.y0 : b.x1 - b.x0;
    const n = Math.floor(span / 0.8);
    for (let i = 1; i < n; i++) {
      const t = (vertical ? b.y0 : b.x0) + (i * span) / n;
      treads.push(vertical
        ? <line key={i} className="tread" x1={b.x0} y1={t} x2={b.x1} y2={t} />
        : <line key={i} className="tread" x1={t} y1={b.y0} x2={t} y2={b.y1} />);
    }
  }
  return (
    <g data-id={r.id}>
      <polygon className={`room ${r.kind}`} points={ptsAttr(r.points)} />
      {treads}
    </g>
  );
}

// --- Furniture glyphs, drawn in the item's own frame (centred, head/back at the top). ---
const SHAPED = new Set(["toilet", "ldesk", "sectional"]);

function glyph(it: Item): ReactNode {
  const w = it.w, h = it.h, x0 = -w / 2, y0 = -h / 2;
  const r = Math.min(w, h);
  switch (it.glyph) {
    case "bed": {
      const ph = Math.min(0.9, h * 0.14), pw = w > 4 ? (w - 0.6) / 2 : w - 0.4;
      const pillows = w > 4 ? [x0 + 0.2, x0 + 0.4 + pw] : [x0 + 0.2];
      return <>
        {pillows.map((px, i) => <rect key={i} className="glyph solid" x={px} y={y0 + 0.2} width={pw} height={ph} rx={0.15} />)}
        <line className="glyph" x1={x0} y1={y0 + h * 0.3} x2={x0 + w} y2={y0 + h * 0.3} />
        <path className="glyph" d={`M${x0 + w * 0.55},${y0 + h * 0.3} L${x0 + w},${y0 + h * 0.48}`} />
      </>;
    }
    case "sofa": case "sectional": {
      const back = Math.min(0.8, h * 0.25), arm = Math.min(0.6, w * 0.14);
      return <>
        <rect className="glyph solid" x={x0} y={y0} width={w} height={back} />
        {it.glyph === "sectional"
          ? <rect className="glyph solid" x={x0} y={y0} width={back} height={h} />
          : <>
              <rect className="glyph solid" x={x0} y={y0} width={arm} height={h} />
              <rect className="glyph solid" x={x0 + w - arm} y={y0} width={arm} height={h} />
            </>}
      </>;
    }
    case "chair": return it.shape === "ellipse"
      ? <path className="glyph solid" d={`M${-w * 0.42},${-h * 0.25} A${w / 2},${h / 2} 0 0 1 ${w * 0.42},${-h * 0.25} Z`} />
      : <rect className="glyph solid" x={x0} y={y0} width={w} height={Math.min(0.3, h * 0.2)} />;
    case "tv": return <rect className="glyph solid" x={x0 + w * 0.1} y={y0 + h * 0.15} width={w * 0.8} height={Math.min(0.25, h * 0.25)} />;
    case "shelf": return <>{[1, 2].map((i) => <line key={i} className="glyph" x1={x0 + (w * i) / 3} y1={y0} x2={x0 + (w * i) / 3} y2={y0 + h} />)}</>;
    case "drawers": return <>
      <line className="glyph" x1={x0} y1={y0 + h * 0.5} x2={x0 + w} y2={y0 + h * 0.5} />
      <line className="glyph" x1={0} y1={y0 + h * 0.5} x2={0} y2={y0 + h} />
    </>;
    case "plant": return <>
      <circle className="glyph" r={r * 0.28} />
      <circle className="glyph" cx={r * 0.12} cy={-r * 0.12} r={r * 0.14} />
    </>;
    case "fridge": return <>
      <line className="glyph" x1={x0} y1={y0 + h * 0.85} x2={x0 + w} y2={y0 + h * 0.85} />
      <line className="glyph" x1={0} y1={y0 + h * 0.85} x2={0} y2={y0 + h} />
    </>;
    case "stove": return <>
      {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) =>
        <circle key={i} className="glyph" cx={sx * w * 0.24} cy={sy * h * 0.22 + h * 0.06} r={r * 0.15} />)}
    </>;
    case "sink": return <ellipse className="glyph" cy={h * 0.08} rx={w * 0.32} ry={h * 0.3} />;
    case "tub": return <rect className="glyph" x={x0 + 0.25} y={y0 + 0.25} width={w - 0.5} height={h - 0.5} rx={Math.min(w, h) * 0.3} />;
    case "shower": return <>
      <line className="glyph" x1={x0} y1={y0} x2={x0 + w} y2={y0 + h} />
      <line className="glyph" x1={x0 + w} y1={y0} x2={x0} y2={y0 + h} />
      <circle className="glyph solid" r={r * 0.06} />
    </>;
    case "washer": return <circle className="glyph" cy={h * 0.06} r={r * 0.33} />;
    case "toilet": return <>
      <rect className="furniture" x={x0} y={y0} width={w} height={h * 0.3} rx={0.06} />
      <ellipse className="furniture" cy={y0 + h * 0.3 + (h * 0.7) / 2} rx={w * 0.42} ry={h * 0.35} />
    </>;
    case "ldesk": {
      const d = Math.min(2.5, w / 2, h / 2);
      return <path className="furniture" d={`M${x0},${y0} H${x0 + w} V${y0 + d} H${x0 + d} V${y0 + h} H${x0} Z`} />;
    }
    default: return null;
  }
}

function ItemShape({ it }: { it: Item }) {
  const cls = it.glyph === "rug" ? "rug" : it.kind;
  const base = SHAPED.has(it.glyph ?? "") ? null
    : it.shape === "ellipse"
      ? <ellipse className={cls} rx={it.w / 2} ry={it.h / 2} />
      : <rect className={cls} x={-it.w / 2} y={-it.h / 2} width={it.w} height={it.h} rx={it.kind === "furniture" ? 0.06 : 0} />;
  return (
    <g data-id={it.id} transform={`translate(${+it.cx.toFixed(3)} ${+it.cy.toFixed(3)}) rotate(${+it.rot.toFixed(2)})`}>
      {base}
      {it.kind === "furniture" && glyph(it)}
    </g>
  );
}

function itemLabel(it: Item): ReactNode {
  if (!it.label || it.kind === "stone" || it.kind === "baseboard") return null;
  const c = Math.abs(Math.cos(rad(it.rot))), s = Math.abs(Math.sin(rad(it.rot)));
  const bw = it.w * c + it.h * s, bh = it.w * s + it.h * c;
  const size = Math.min(0.55, (bw - 0.2) / (LABEL_W * it.label.length));
  if (size < 0.22) {
    if (bh < bw || size < 0.12) return null;
  }
  const dy = it.kind === "furniture" && it.glyph === "bed" ? bh * 0.15 : 0;
  return <text key={`il-${it.id}`} className="note ink" x={it.cx} y={it.cy + dy} fontSize={Math.max(0.22, size)} opacity={0.8}>{it.label}</text>;
}

const MARK_FRAC: Record<string, number> = { opening: 1, slider: 0.5, step: 0.5 };

function markShape(m: Mark, objs: Level["objects"], wall: number): ReactNode {
  const s = wallSpan(objs, wall, m.kind, m.a, m.b);
  let a = m.a, b = m.b, t = 0, style: React.CSSProperties | undefined;
  if (s) {
    a = s.a; b = s.b; t = s.t;
    const w = Math.max(0.1, s.t * (MARK_FRAC[m.kind] ?? 0.55) + (m.kind === "opening" ? 0.067 : 0));
    style = { strokeWidth: w };
  }
  return (
    <g data-id={m.id} key={m.id}>
      <line className={`mark ${m.kind}`} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} style={style} />
      {doorSwing(m, a, b, t)}
      {/* A fat transparent line so thin marks are easy to grab in the editor. */}
      <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="transparent" strokeWidth={0.6} className="hit" />
    </g>
  );
}

/** A hinged door's leaf, open at 90°, and the arc its free edge sweeps. */
function doorSwing(m: Mark, a: Vec, b: Vec, t: number): ReactNode {
  const leaf = doorLeaf(m, a, b, t);
  if (!leaf) return null;
  const { hinge: h, shut, open } = leaf;
  const r = dist(h, shut);
  const cw = (shut[0] - h[0]) * (open[1] - h[1]) - (shut[1] - h[1]) * (open[0] - h[0]) > 0 ? 1 : 0;
  return (
    <>
      <path className="swing" d={`M${shut[0]},${shut[1]} A${r},${r} 0 0 ${cw} ${open[0]},${open[1]}`} />
      <line className="leaf" x1={h[0]} y1={h[1]} x2={open[0]} y2={open[1]} />
    </>
  );
}

function markLabel(m: Mark): ReactNode {
  if (!m.label) return null;
  const vertical = Math.abs(m.a[0] - m.b[0]) < Math.abs(m.a[1] - m.b[1]);
  const c = mid(m.a, m.b);
  return <text key={`ml-${m.id}`} className={`note${vertical ? " end" : ""}`} x={c[0] + (vertical ? -0.47 : 0)}
    y={c[1] - (vertical ? 0 : 0.42)} fontSize={0.667}>{m.label}</text>;
}

function PointShape({ p, states }: { p: Point; states?: States }) {
  let body: ReactNode;
  const on = p.entity && states?.[p.entity] === "on";
  if (p.kind === "thermo") body = <rect className="thermo" x={p.x - 0.27} y={p.y - 0.27} width={0.53} height={0.53} rx={0.1} />;
  else if (p.kind === "sensor") {
    const aim = rad(p.aim ?? -90), r = p.range ?? 6, half = 1.05;
    const w1: Vec = [p.x + r * Math.cos(aim - half), p.y + r * Math.sin(aim - half)];
    const w2: Vec = [p.x + r * Math.cos(aim + half), p.y + r * Math.sin(aim + half)];
    body = <>
      <path className="fov" d={`M${p.x},${p.y} L${w1[0]},${w1[1]} A${r},${r} 0 0 1 ${w2[0]},${w2[1]} Z`} />
      <circle className="sensor" cx={p.x} cy={p.y} r={0.3} />
    </>;
  } else body = <circle className={`${p.kind}${on ? " on" : ""}`} cx={p.x} cy={p.y} r={p.kind === "device" ? 0.233 : 0.3} />;
  return <g data-id={p.id}>{body}{p.entity && states && <circle className="bound" cx={p.x} cy={p.y} r={0.45} />}</g>;
}

function pointLabel(p: Point): ReactNode {
  if (!p.label) return null;
  if (p.kind === "sensor") {
    return <text key={`pl-${p.id}`} className="note start" x={p.x + 0.47} y={p.y + 0.6} fontSize={0.667}
      style={{ fill: "var(--accent)" }}>{p.label}</text>;
  }
  return <text key={`pl-${p.id}`} className="note start ink" x={p.x + 0.4} y={p.y} fontSize={0.667}>{p.label}</text>;
}

/** A dimension line. `size` is the text height in feet. */
export function DimLine({ a, b, offset, label, size = 0.55, id, className = "dim" }: {
  a: Vec; b: Vec; offset: number; label?: string; size?: number; id?: string; className?: string;
}) {
  const L = dist(a, b);
  if (L < 1e-6) return null;
  const u: Vec = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n: Vec = [u[1], -u[0]];
  const pa: Vec = [a[0] + n[0] * offset, a[1] + n[1] * offset];
  const pb: Vec = [b[0] + n[0] * offset, b[1] + n[1] * offset];
  const ext = Math.sign(offset || 1) * size * 0.35;
  const tick = size * 0.35;
  const t = (p: Vec) => `M${p[0] - (u[0] + n[0]) * tick},${p[1] - (u[1] + n[1]) * tick} L${p[0] + (u[0] + n[0]) * tick},${p[1] + (u[1] + n[1]) * tick}`;
  let ang = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  if (ang > 90.01 || ang < -89.99) ang += 180;
  const c = mid(pa, pb);
  const side = Math.sign(offset || 1) * size * 0.75;
  const tx = c[0] + n[0] * side, ty = c[1] + n[1] * side;
  const text = label || fmtLen(L);
  return (
    <g className={className} data-id={id}>
      {Math.abs(offset) > 0.01 && <>
        <line x1={a[0]} y1={a[1]} x2={pa[0] + n[0] * ext} y2={pa[1] + n[1] * ext} style={{ strokeOpacity: 0.5 }} />
        <line x1={b[0]} y1={b[1]} x2={pb[0] + n[0] * ext} y2={pb[1] + n[1] * ext} style={{ strokeOpacity: 0.5 }} />
      </>}
      <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} />
      <path d={`${t(pa)} ${t(pb)}`} style={{ stroke: "var(--dim)", strokeWidth: size * 0.09 }} />
      <line x1={pa[0]} y1={pa[1]} x2={pb[0]} y2={pb[1]} stroke="transparent" strokeWidth={size} className="hit" />
      <text x={tx} y={ty} fontSize={size} transform={`rotate(${ang} ${tx} ${ty})`} style={{ strokeWidth: size * 0.3 }}>{text}</text>
    </g>
  );
}

/**
 * One level of the plan. With `states`, rooms glow while their lights are on and placed
 * entities are ringed; `hideBound` leaves placed entities out entirely, for a dashboard card
 * that draws its own live icons over them.
 */
export function LevelArt({ level, wall, states, hideBound }: { level: Level; wall: number; states?: States; hideBound?: boolean }) {
  const objs = level.objects;
  const rooms = objs.filter((o): o is Room => o.type === "room");
  const items = objs.filter((o): o is Item => o.type === "item");
  // Rugs go under the other furniture, and structure (stone, chimneys) over fixtures.
  const order = (it: Item) => (it.glyph === "rug" ? 0 : it.kind === "furniture" ? 2 : it.kind === "fixture" ? 1 : 3);
  items.sort((x, y) => order(x) - order(y));
  const labels: ReactNode[] = [];

  // Walls: each walled room outlined with a stroke twice the wall thickness and painted under
  // the rooms, so the gaps between rooms read as interior walls and the outer band as the shell.
  // On a rectangle this is gen.py's grown bounding box; other shapes get walls that follow them.
  const walled = rooms.filter((r) => WALLED.includes(r.kind));

  for (const r of rooms) if (r.label) labels.push(roomLabel(r.label, r.points, r.kind === "labelonly" ? "hall" : r.kind, r.id));
  for (const it of items) labels.push(itemLabel(it));
  const marks = objs.filter((o): o is Mark => o.type === "mark");
  for (const m of marks) labels.push(markLabel(m));
  const points = objs.filter((o): o is Point => o.type === "point" && !(hideBound && o.entity));
  for (const p of points) labels.push(pointLabel(p));
  // Two lights on in a room each add a fainter layer, so the room is brighter with both on.
  const glows = states ? litRooms(objs, states) : [];

  return (
    <g className="level" data-level={level.id}>
      {walled.map((r) => <polygon key={`w-${r.id}`} className="wall" points={ptsAttr(r.points)}
        style={{ stroke: "var(--wall)", strokeWidth: wall * 2, strokeLinejoin: "miter", strokeMiterlimit: 20 }} />)}
      {rooms.map((r) => <RoomShape key={r.id} r={r} />)}
      {glows.map(({ room, n }) => <polygon key={`g-${room.id}`} className="glow" points={ptsAttr(room.points)}
        style={{ fillOpacity: 1 - (1 - 0.35 / Math.sqrt(n)) ** n }} />)}
      {items.map((it) => <ItemShape key={it.id} it={it} />)}
      {marks.map((m) => markShape(m, objs, wall))}
      {points.map((p) => <PointShape key={p.id} p={p} states={states} />)}
      <g className="labels" style={{ pointerEvents: "none" }}>{labels}</g>
      {objs.filter((o): o is Dim => o.type === "dim").map((d) =>
        <DimLine key={d.id} id={d.id} a={d.a} b={d.b} offset={d.offset} label={d.label} />)}
      {objs.filter((o): o is Text => o.type === "text").map((t) =>
        <text key={t.id} data-id={t.id} className="free" x={t.x} y={t.y} fontSize={t.size}>{t.label}</text>)}
    </g>
  );
}

export function Compass({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${size})`}>
      <path d="M0,-0.87 L0.27,0 L0,-0.2 L-0.27,0 Z" style={{ fill: "var(--muted)" }} />
      <text y={0.75} fontSize={0.67} className="note" style={{ fontWeight: 700 }}>N</text>
    </g>
  );
}


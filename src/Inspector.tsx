// The right-hand panel for the selection: names, kinds, and exact measurements typed in
// feet and inches.
import { useEffect, useState } from "react";
import {
  ITEM_KINDS, KIND_LABEL, MARK_KINDS, POINT_KINDS, ROOM_KINDS,
  type Dim, type Item, type Mark, type Obj, type Point, type Room, type Text, type Vec,
} from "./model";
import { bbox, dist, polyArea, turnDoor } from "./geometry";
import { fmtArea, fmtLen, parseLen } from "./units";
import type { EntityInfo } from "./host";
import type { States } from "./render";

interface Props {
  selected: Obj[];
  onChange: (id: string, fn: (o: Obj) => Obj) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onFront: () => void;
  onBack: () => void;
  /** Home Assistant's entities, to place on the plan (only inside Home Assistant). */
  entities?: () => EntityInfo[];
  states?: States;
}

/** A length field: shows 12′ 6″, accepts most ways of typing a length, commits on Enter/blur. */
export function LengthInput({ id, label, value, onCommit, min }: {
  id: string; label: string; value: number; onCommit: (ft: number) => void; min?: number;
}) {
  const [text, setText] = useState(fmtLen(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(fmtLen(value)); setBad(false); }, [value]);
  const commit = () => {
    const v = parseLen(text);
    if (v == null || (min != null && v < min)) { setBad(true); return; }
    setBad(false);
    if (Math.abs(v - value) > 1e-9) onCommit(v);
    else setText(fmtLen(value));
  };
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} className={bad ? "bad" : ""} value={text} inputMode="text" spellCheck={false}
        onChange={(e) => setText(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); (e.target as HTMLInputElement).select(); }
          if (e.key === "Escape") { setText(fmtLen(value)); setBad(false); (e.target as HTMLInputElement).blur(); }
          e.stopPropagation();
        }}
        aria-invalid={bad} title="e.g. 12' 6&quot;, 6 1/2&quot;, 3.5, 1.2m" />
    </label>
  );
}

function NumberInput({ id, label, value, onCommit, suffix }: {
  id: string; label: string; value: number; onCommit: (v: number) => void; suffix?: string;
}) {
  const [text, setText] = useState(String(+value.toFixed(1)));
  useEffect(() => setText(String(+value.toFixed(1))), [value]);
  const commit = () => { const v = parseFloat(text); if (Number.isFinite(v) && v !== value) onCommit(v); else setText(String(+value.toFixed(1))); };
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <span className="with-suffix">
        <input id={id} value={text} inputMode="decimal" onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); e.stopPropagation(); }} />
        {suffix && <em>{suffix}</em>}
      </span>
    </label>
  );
}

function TextInput({ id, label, value, onCommit, placeholder }: {
  id: string; label: string; value: string; onCommit: (v: string) => void; placeholder?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input id={id} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
        onKeyDown={(e) => { if (e.key === "Enter") onCommit(text); e.stopPropagation(); }} />
    </label>
  );
}

function KindSelect<K extends string>({ id, value, kinds, onCommit }: { id: string; value: K; kinds: K[]; onCommit: (k: K) => void }) {
  return (
    <label className="field" htmlFor={id}>
      <span>Kind</span>
      <select id={id} value={value} onChange={(e) => onCommit(e.target.value as K)}>
        {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>)}
      </select>
    </label>
  );
}

/**
 * Set the length of edge i of a room. On a square-cornered room the whole far side moves
 * (every corner level with the edge's end), so rectangles stay rectangles.
 */
export function setEdgeLength(r: Room, i: number, L: number): Room {
  const pts = r.points.map((q) => [...q] as Vec);
  const a = pts[i], j = (i + 1) % pts.length, b = pts[j];
  const cur = dist(a, b);
  if (cur < 1e-9) return r;
  const u: Vec = [(b[0] - a[0]) / cur, (b[1] - a[1]) / cur];
  const d = L - cur;
  const axis: 0 | 1 | null = Math.abs(u[0]) > 0.9999 ? 0 : Math.abs(u[1]) > 0.9999 ? 1 : null;
  if (axis == null) {
    pts[j] = [a[0] + u[0] * L, a[1] + u[1] * L];
    return { ...r, points: pts };
  }
  const end = b[axis], shift = u[axis] * d;
  // Move every corner on the far side of the edge's end (inclusive), so the room stretches.
  const far = (v: number) => (u[axis] > 0 ? v >= end - 1e-6 : v <= end + 1e-6);
  return { ...r, points: pts.map((q) => (far(q[axis]) ? (axis === 0 ? [q[0] + shift, q[1]] : [q[0], q[1] + shift]) as Vec : q)) };
}

export function Inspector({ selected, onChange, onDelete, onDuplicate, onFront, onBack, entities, states }: Props) {
  if (!selected.length) {
    return (
      <div className="inspector empty">
        <p className="hint">Select something to see and type in its measurements.</p>
        <ul className="tips">
          <li><kbd>Drag</kbd> furniture in from the <b>Add</b> tab, or click to drop it in the middle.</li>
          <li><b>Room</b> tool: drag a rectangle, or click corner by corner. Close it on the first corner or press <kbd>Enter</kbd>.</li>
          <li><b>Measure</b> tool: drag between two points to leave a dimension line. It snaps to corners.</li>
          <li><kbd>Shift</kbd> keeps lines straight and adds to the selection. <kbd>Alt</kbd> turns snapping off.</li>
          <li>Fields take <code>12' 6"</code>, <code>6 1/2"</code>, <code>3.5</code> (feet) or <code>1.2m</code>.</li>
        </ul>
      </div>
    );
  }
  if (selected.length > 1) {
    return (
      <div className="inspector">
        <h2>{selected.length} selected</h2>
        <Actions onDelete={onDelete} onDuplicate={onDuplicate} />
      </div>
    );
  }
  const o = selected[0];
  const set = (fn: (o: Obj) => Obj) => onChange(o.id, fn);
  const k = o.id;
  return (
    <div className="inspector">
      <h2>{titleOf(o)}</h2>
      {o.type === "room" && <RoomFields r={o} set={set} k={k} />}
      {o.type === "item" && <ItemFields it={o} set={set} k={k} />}
      {o.type === "mark" && <MarkFields m={o} set={set} k={k} />}
      {o.type === "point" && <PointFields pt={o} set={set} k={k} />}
      {o.type === "dim" && <DimFields d={o} set={set} k={k} />}
      {o.type === "text" && <TextFields t={o} set={set} k={k} />}
      {entities && (o.type === "point" || o.type === "item") &&
        <EntityField k={k} value={o.entity ?? ""} entities={entities} state={o.entity ? states?.[o.entity] : undefined}
          onCommit={(v) => set((x) => ({ ...x, entity: v || undefined }) as Obj)} />}
      <Actions onDelete={onDelete} onDuplicate={onDuplicate} onFront={onFront} onBack={onBack} />
    </div>
  );
}

function titleOf(o: Obj) {
  if (o.type === "dim") return "Dimension";
  if (o.type === "text") return "Note";
  return KIND_LABEL[o.kind] ?? o.kind;
}

function Actions({ onDelete, onDuplicate, onFront, onBack }: { onDelete: () => void; onDuplicate: () => void; onFront?: () => void; onBack?: () => void }) {
  return (
    <div className="actions">
      <button type="button" onClick={onDuplicate} title="Duplicate (Ctrl+D)">Duplicate</button>
      {onFront && <button type="button" onClick={onFront} title="Bring to front">To front</button>}
      {onBack && <button type="button" onClick={onBack} title="Send to back">To back</button>}
      <button type="button" className="danger" onClick={onDelete} title="Delete (Del)">Delete</button>
    </div>
  );
}

type SetFn = (fn: (o: Obj) => Obj) => void;

function RoomFields({ r, set, k }: { r: Room; set: SetFn; k: string }) {
  const b = bbox(r.points);
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  const isRect = r.points.length === 4 && Math.abs(polyArea(r.points) - w * h) < 1e-6;
  const upd = (fn: (r: Room) => Room) => set((o) => fn(o as Room));
  const stretch = (axis: 0 | 1, L: number) => upd((r) => {
    const bb = bbox(r.points), lo = axis === 0 ? bb.x0 : bb.y0, cur = axis === 0 ? bb.x1 - bb.x0 : bb.y1 - bb.y0;
    if (cur < 1e-9) return r;
    return { ...r, points: r.points.map((q) => (axis === 0 ? [lo + ((q[0] - lo) * L) / cur, q[1]] : [q[0], lo + ((q[1] - lo) * L) / cur]) as Vec) };
  });
  return (
    <>
      <TextInput id={`${k}-label`} label="Name" value={r.label} onCommit={(v) => upd((r) => ({ ...r, label: v }))} />
      <KindSelect id={`${k}-kind`} value={r.kind} kinds={ROOM_KINDS} onCommit={(v) => upd((r) => ({ ...r, kind: v }))} />
      <div className="row2">
        <LengthInput id={`${k}-w`} label={isRect ? "Width (E–W)" : "Overall E–W"} value={w} min={0.1} onCommit={(v) => stretch(0, v)} />
        <LengthInput id={`${k}-h`} label={isRect ? "Depth (N–S)" : "Overall N–S"} value={h} min={0.1} onCommit={(v) => stretch(1, v)} />
      </div>
      <div className="row2">
        <LengthInput id={`${k}-x`} label="West wall at" value={b.x0} onCommit={(v) => upd((r) => ({ ...r, points: r.points.map((q) => [q[0] + v - b.x0, q[1]] as Vec) }))} />
        <LengthInput id={`${k}-y`} label="North wall at" value={b.y0} onCommit={(v) => upd((r) => ({ ...r, points: r.points.map((q) => [q[0], q[1] + v - b.y0] as Vec) }))} />
      </div>
      <p className="readout">{fmtArea(polyArea(r.points))} inside · {r.points.length} corners</p>
      {!isRect && (
        <details className="edges" open>
          <summary>Walls, corner to corner</summary>
          {r.points.map((a, i) => {
            const bb = r.points[(i + 1) % r.points.length];
            return <LengthInput key={i} id={`${k}-e${i}`} label={`${i + 1} → ${(i + 1) % r.points.length + 1} ${heading(a, bb)}`}
              value={dist(a, bb)} min={0.05} onCommit={(v) => upd((r) => setEdgeLength(r, i, v))} />;
          })}
          <p className="hint small">Double-click a wall on the plan to add a corner. Drag a wall to move it.</p>
        </details>
      )}
    </>
  );
}

function heading(a: Vec, b: Vec) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-6) return dy > 0 ? "S" : "N";
  if (Math.abs(dy) < 1e-6) return dx > 0 ? "E" : "W";
  return "";
}

function ItemFields({ it, set, k }: { it: Item; set: SetFn; k: string }) {
  const upd = (fn: (i: Item) => Item) => set((o) => fn(o as Item));
  return (
    <>
      <TextInput id={`${k}-label`} label="Name" value={it.label} onCommit={(v) => upd((i) => ({ ...i, label: v }))} />
      <KindSelect id={`${k}-kind`} value={it.kind} kinds={ITEM_KINDS} onCommit={(v) => upd((i) => ({ ...i, kind: v }))} />
      <div className="row2">
        <LengthInput id={`${k}-w`} label="Width" value={it.w} min={0.02} onCommit={(v) => upd((i) => ({ ...i, w: v }))} />
        <LengthInput id={`${k}-h`} label="Depth" value={it.h} min={0.02} onCommit={(v) => upd((i) => ({ ...i, h: v }))} />
      </div>
      <div className="row2">
        <LengthInput id={`${k}-x`} label="Centre E–W" value={it.cx} onCommit={(v) => upd((i) => ({ ...i, cx: v }))} />
        <LengthInput id={`${k}-y`} label="Centre N–S" value={it.cy} onCommit={(v) => upd((i) => ({ ...i, cy: v }))} />
      </div>
      <div className="row2">
        <NumberInput id={`${k}-rot`} label="Rotation" value={it.rot} suffix="°" onCommit={(v) => upd((i) => ({ ...i, rot: ((v % 360) + 540) % 360 - 180 }))} />
        <label className="field" htmlFor={`${k}-shape`}>
          <span>Shape</span>
          <select id={`${k}-shape`} value={it.shape} onChange={(e) => upd((i) => ({ ...i, shape: e.target.value as Item["shape"] }))}>
            <option value="rect">Rectangle</option>
            <option value="ellipse">Oval</option>
          </select>
        </label>
      </div>
      <div className="actions tight">
        <button type="button" onClick={() => upd((i) => ({ ...i, rot: ((i.rot + 90 + 540) % 360) - 180 }))} title="Rotate 90° (R)">Rotate 90°</button>
        <button type="button" onClick={() => upd((i) => ({ ...i, w: i.h, h: i.w }))}>Swap width/depth</button>
      </div>
      <p className="readout">{fmtArea(it.w * it.h)} footprint. The dimension lines show the gap to each wall.</p>
    </>
  );
}

function MarkFields({ m, set, k }: { m: Mark; set: SetFn; k: string }) {
  const upd = (fn: (m: Mark) => Mark) => set((o) => fn(o as Mark));
  const L = dist(m.a, m.b);
  const u: Vec = L ? [(m.b[0] - m.a[0]) / L, (m.b[1] - m.a[1]) / L] : [1, 0];
  const vertical = Math.abs(u[1]) > Math.abs(u[0]);
  const start = vertical ? Math.min(m.a[1], m.b[1]) : Math.min(m.a[0], m.b[0]);
  return (
    <>
      <KindSelect id={`${k}-kind`} value={m.kind} kinds={MARK_KINDS}
        onCommit={(v) => upd((m) => (v === "door" && !m.hinge ? { ...m, kind: v, hinge: "a", swing: 1 } : { ...m, kind: v }))} />
      <TextInput id={`${k}-label`} label="Label" value={m.label} placeholder="optional" onCommit={(v) => upd((m) => ({ ...m, label: v }))} />
      <div className="row2">
        <LengthInput id={`${k}-len`} label="Width" value={L} min={0.05} onCommit={(v) => upd((m) => {
          const c: Vec = [(m.a[0] + m.b[0]) / 2, (m.a[1] + m.b[1]) / 2];
          return { ...m, a: [c[0] - (u[0] * v) / 2, c[1] - (u[1] * v) / 2], b: [c[0] + (u[0] * v) / 2, c[1] + (u[1] * v) / 2] };
        })} />
        <LengthInput id={`${k}-at`} label={vertical ? "North end at" : "West end at"} value={start} onCommit={(v) => upd((m) => {
          const d = v - start;
          return vertical ? { ...m, a: [m.a[0], m.a[1] + d], b: [m.b[0], m.b[1] + d] } : { ...m, a: [m.a[0] + d, m.a[1]], b: [m.b[0] + d, m.b[1]] };
        })} />
      </div>
      {m.kind === "door" && (
        <>
          <label className="field" htmlFor={`${k}-hinge`}>
            <span>Hinge</span>
            <select id={`${k}-hinge`} value={m.hinge ? hingeSide(m, m.hinge) : ""}
              onChange={(e) => upd((m) => {
                const v = e.target.value;
                if (!v) return { ...m, hinge: undefined, swing: undefined };
                return { ...m, hinge: hingeSide(m, "a") === v ? "a" : "b", swing: m.swing ?? 1 };
              })}>
              <option value="">None (no swing drawn)</option>
              <option value={vertical ? "north" : "west"}>{vertical ? "North" : "West"} end</option>
              <option value={vertical ? "south" : "east"}>{vertical ? "South" : "East"} end</option>
            </select>
          </label>
          {m.hinge && (
            <div className="actions tight">
              <button type="button" onClick={() => upd((m) => ({ ...m, hinge: m.hinge === "a" ? "b" : "a" }))}>Flip hinge</button>
              <button type="button" onClick={() => upd((m) => ({ ...m, swing: (m.swing ?? 1) === 1 ? -1 : 1 }))}>Flip swing</button>
              <button type="button" onClick={() => upd((m) => turnDoor(m))} title="Turn (R)">Turn</button>
            </div>
          )}
          {m.hinge && <p className="readout">Opens to the {swingSide(m)}, hinged at the {hingeSide(m, m.hinge)} end.</p>}
        </>
      )}
      <p className="hint small">Drag it along its wall or onto another one, or drag either end to resize it. Width changes keep it centred.
        {m.kind === "door" ? " R turns a door through its four hinge and swing positions." : ""}</p>
    </>
  );
}

/** Which compass end of its wall a door's end is at. */
function hingeSide(m: Mark, end: "a" | "b") {
  const [p, q] = end === "a" ? [m.a, m.b] : [m.b, m.a];
  const vertical = Math.abs(m.a[0] - m.b[0]) < Math.abs(m.a[1] - m.b[1]);
  return vertical ? (p[1] < q[1] ? "north" : "south") : (p[0] < q[0] ? "west" : "east");
}

/** Which way a door opens: the compass side of its wall its leaf swings into. */
function swingSide(m: Mark) {
  const k = m.swing ?? 1;
  const n = [(m.b[1] - m.a[1]) * k, -(m.b[0] - m.a[0]) * k];
  return Math.abs(n[0]) > Math.abs(n[1]) ? (n[0] > 0 ? "east" : "west") : (n[1] > 0 ? "south" : "north");
}

function PointFields({ pt, set, k }: { pt: Point; set: SetFn; k: string }) {
  const upd = (fn: (p: Point) => Point) => set((o) => fn(o as Point));
  return (
    <>
      <TextInput id={`${k}-label`} label="Label" value={pt.label} onCommit={(v) => upd((p) => ({ ...p, label: v }))} />
      <KindSelect id={`${k}-kind`} value={pt.kind} kinds={POINT_KINDS} onCommit={(v) => upd((p) => ({ ...p, kind: v, ...(v === "sensor" ? { aim: p.aim ?? -90, range: p.range ?? 6 } : {}) }))} />
      <div className="row2">
        <LengthInput id={`${k}-x`} label="E–W" value={pt.x} onCommit={(v) => upd((p) => ({ ...p, x: v }))} />
        <LengthInput id={`${k}-y`} label="N–S" value={pt.y} onCommit={(v) => upd((p) => ({ ...p, y: v }))} />
      </div>
      {pt.kind === "sensor" && (
        <div className="row2">
          <NumberInput id={`${k}-aim`} label="Aim (0° = east)" value={pt.aim ?? -90} suffix="°" onCommit={(v) => upd((p) => ({ ...p, aim: v }))} />
          <LengthInput id={`${k}-range`} label="Range" value={pt.range ?? 6} min={0.5} onCommit={(v) => upd((p) => ({ ...p, range: v }))} />
        </div>
      )}
    </>
  );
}

function DimFields({ d, set, k }: { d: Dim; set: SetFn; k: string }) {
  const upd = (fn: (d: Dim) => Dim) => set((o) => fn(o as Dim));
  const L = dist(d.a, d.b);
  return (
    <>
      <LengthInput id={`${k}-len`} label="Length" value={L} min={0.02} onCommit={(v) => upd((d) => {
        const u: Vec = [(d.b[0] - d.a[0]) / L, (d.b[1] - d.a[1]) / L];
        return { ...d, b: [d.a[0] + u[0] * v, d.a[1] + u[1] * v] };
      })} />
      <TextInput id={`${k}-label`} label="Label" value={d.label} placeholder={fmtLen(L)} onCommit={(v) => upd((d) => ({ ...d, label: v }))} />
      <LengthInput id={`${k}-off`} label="Offset" value={d.offset} onCommit={(v) => upd((d) => ({ ...d, offset: v }))} />
      <p className="hint small">Typing a length moves the second end. Leave the label blank to show the measured length.</p>
    </>
  );
}

function TextFields({ t, set, k }: { t: Text; set: SetFn; k: string }) {
  const upd = (fn: (t: Text) => Text) => set((o) => fn(o as Text));
  return (
    <>
      <TextInput id={`${k}-label`} label="Text" value={t.label} onCommit={(v) => upd((t) => ({ ...t, label: v }))} />
      <LengthInput id={`${k}-size`} label="Text height" value={t.size} min={0.1} onCommit={(v) => upd((t) => ({ ...t, size: v }))} />
    </>
  );
}

/**
 * Which Home Assistant entity sits here. Lights glow in the room they're placed in, and the
 * dashboard card shows a live icon you can tap. The list is filled in when the field is used.
 */
function EntityField({ k, value, entities, state, onCommit }: {
  k: string; value: string; entities: () => EntityInfo[]; state?: string; onCommit: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  const [list, setList] = useState<EntityInfo[]>([]);
  useEffect(() => setText(value), [value]);
  const fill = () => { if (!list.length) setList(entities().sort((a, b) => a.id.localeCompare(b.id))); };
  const commit = () => { const v = text.trim(); if (v !== value) onCommit(v); };
  const known = !value || list.length === 0 || list.some((e) => e.id === value);
  return (
    <>
      <label className="field" htmlFor={`${k}-entity`}>
        <span>Home Assistant entity</span>
        <input id={`${k}-entity`} list={`${k}-entities`} value={text} placeholder="e.g. light.sofa_light" spellCheck={false}
          onFocus={fill} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); e.stopPropagation(); }} />
        <datalist id={`${k}-entities`}>
          {list.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </datalist>
      </label>
      {value && <p className="readout">{known ? `Now ${state ?? "unknown"}.` : "Home Assistant has no entity by that name."}</p>}
      <p className="hint small">Lights glow in the room they sit in while they're on. On the dashboard card, tap it to toggle it or see details.</p>
    </>
  );
}

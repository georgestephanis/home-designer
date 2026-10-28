// Printing: one floor per page, every page at the same scale with the plan in the same place,
// so the sheets line up when flipped and measurements can be taken off them with a ruler. Each
// page leaves room for notes made on site.
import { useEffect, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Doc } from "./model";
import { docBounds } from "./geometry";
import { ART_STYLE, Compass, LevelArt } from "./render";

export const PAPERS = {
  letter: { name: "Letter (8½ × 11 in)", w: 8.5, h: 11 },
  legal: { name: "Legal (8½ × 14 in)", w: 8.5, h: 14 },
  tabloid: { name: "Tabloid (11 × 17 in)", w: 11, h: 17 },
  a4: { name: "A4", w: 8.27, h: 11.69 },
  a3: { name: "A3", w: 11.69, h: 16.54 },
};
export type Paper = keyof typeof PAPERS;

export const defaultPaper = (): Paper => (/^en-(US|CA)|^es-(MX|US)|^fr-CA/i.test(navigator.language) ? "letter" : "a4");

/** Architects' scales, in inches of paper per foot, largest first. */
const SCALES: [number, string][] = [
  [1 / 2, "½″"], [3 / 8, "⅜″"], [1 / 4, "¼″"], [3 / 16, "3⁄16″"],
  [1 / 8, "⅛″"], [3 / 32, "3⁄32″"], [1 / 16, "1⁄16″"], [1 / 32, "1⁄32″"],
];

// Page furniture, in inches.
const MARGIN = 0.4, HEADER = 0.55, FOOTER = 0.45, GAP = 0.2, NOTES_SIDE = 2.4, NOTES_BELOW = 1.8, PAD_FT = 1;

export interface PrintOptions { paper: Paper; levelIds: string[]; notes: boolean; grid: boolean }

export interface Layout {
  pageW: number; pageH: number;
  /** Inches of paper per foot. */
  scale: number;
  label: string;
  notes: "side" | "below" | null;
  /** The plan's extent in feet, shared by every page. */
  box: { x: number; y: number; w: number; h: number };
}

/**
 * The page size, orientation and largest standard scale that fit every chosen floor. All floors
 * share one box (the union of their extents), so a wall sits at the same spot on every sheet.
 */
export function printLayout(doc: Doc, o: PrintOptions): Layout {
  const levels = doc.levels.filter((l) => o.levelIds.includes(l.id));
  const b = docBounds(levels.length ? levels : doc.levels);
  const box = { x: b.x0 - PAD_FT, y: b.y0 - PAD_FT, w: b.x1 - b.x0 + PAD_FT * 2, h: b.y1 - b.y0 + PAD_FT * 2 };
  const p = PAPERS[o.paper];
  let best: Omit<Layout, "label" | "box"> | null = null;
  for (const [pageW, pageH] of [[p.w, p.h], [p.h, p.w]]) {
    for (const notes of o.notes ? (["below", "side"] as const) : [null]) {
      const w = pageW - MARGIN * 2 - (notes === "side" ? NOTES_SIDE + GAP : 0);
      const h = pageH - MARGIN * 2 - HEADER - FOOTER - (notes === "below" ? NOTES_BELOW + GAP : 0);
      const scale = Math.min(w / box.w, h / box.h);
      if (!best || scale > best.scale + 1e-9) best = { pageW, pageH, scale, notes };
    }
  }
  const fit = best!.scale;
  const std = SCALES.find(([s]) => s <= fit + 1e-9);
  const scale = std ? std[0] : fit;
  const label = std ? `${std[1]} = 1′-0″ (1:${Math.round(12 / scale)})` : `1:${Math.round(12 / scale)}`;
  return { ...best!, scale, label, box };
}

/** A scale bar about 2 inches long, in round feet. */
function ScaleBar({ scale }: { scale: number }) {
  const ft = [1, 2, 4, 5, 10, 20, 25, 50, 100].find((n) => n * scale >= 1.6) ?? 100;
  const steps = ft <= 5 ? ft : 5;
  const w = ft * scale;
  return (
    <svg className="bar" width={`${w + 0.5}in`} height="0.32in" viewBox={`-0.05 -0.05 ${w + 0.5} 0.32`}>
      {Array.from({ length: steps }, (_, i) => (
        <rect key={i} x={(i * w) / steps} y={0} width={w / steps} height={0.07} className={i % 2 ? "" : "fill"} />
      ))}
      {[0, ft].map((n) => <text key={n} x={(n / ft) * w} y={0.24}>{n}′</text>)}
    </svg>
  );
}

function Sheet({ doc, l, i, n, layout, o, date }: {
  doc: Doc; l: Doc["levels"][number]; i: number; n: number; layout: Layout; o: PrintOptions; date: string;
}) {
  const { box, scale } = layout;
  const lines = [];
  if (o.grid) {
    for (let x = Math.ceil(box.x); x <= box.x + box.w; x++) lines.push(<line key={`x${x}`} x1={x} y1={box.y} x2={x} y2={box.y + box.h} className={x % 5 ? "" : "major"} />);
    for (let y = Math.ceil(box.y); y <= box.y + box.h; y++) lines.push(<line key={`y${y}`} x1={box.x} y1={y} x2={box.x + box.w} y2={y} className={y % 5 ? "" : "major"} />);
  }
  return (
    <section className={`sheet notes-${layout.notes ?? "none"}`}>
      <header>
        <div><div className="doc">{doc.name}</div><h1>{l.title}</h1></div>
        <svg className="compass hd-art" viewBox="-0.6 -1 1.2 2" width="0.21in" height="0.35in"><Compass x={0} y={0} /></svg>
      </header>
      <div className="plan">
        <svg className="hd-art" width={`${box.w * scale}in`} height={`${box.h * scale}in`} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}>
          <LevelArt level={l} wall={doc.wall} />
          {o.grid && <g className="print-grid" style={{ strokeWidth: 0.006 / scale }}>{lines}</g>}
        </svg>
      </div>
      {layout.notes && <div className="notes"><span>Notes</span><div className="ruled" /></div>}
      <footer>
        <ScaleBar scale={scale} />
        <span>Scale {layout.label}{o.grid ? " · grid 1′" : ""}</span>
        <span className="spacer" />
        <span>Printed {date}</span>
        <span>Page {i + 1} of {n}</span>
      </footer>
    </section>
  );
}

/** A complete HTML page with one sheet per chosen floor. */
export function printHtml(doc: Doc, o: PrintOptions): string {
  const layout = printLayout(doc, o);
  const levels = doc.levels.filter((l) => o.levelIds.includes(l.id));
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const { pageW: W, pageH: H } = layout;
  const css = `${ART_STYLE}
@page { size: ${W}in ${H}in; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; background: #fff; color: #1f2328; font: 9pt system-ui, -apple-system, "Segoe UI", sans-serif; }
.sheet { width: ${W}in; height: ${H}in; padding: ${MARGIN}in; display: grid; gap: ${GAP}in 0; overflow: hidden; break-after: page; page-break-after: always;
  grid-template: "head head" ${HEADER - GAP}in "plan plan" 1fr "foot foot" ${FOOTER - GAP}in / 1fr; }
.sheet:last-child { break-after: auto; page-break-after: auto; }
.sheet.notes-below { grid-template: "head" ${HEADER - GAP}in "plan" 1fr "notes" ${NOTES_BELOW}in "foot" ${FOOTER - GAP}in / 1fr; }
.sheet.notes-side { grid-template: "head head" ${HEADER - GAP}in "plan notes" 1fr "foot foot" ${FOOTER - GAP}in / 1fr ${NOTES_SIDE}in; column-gap: ${GAP}in; }
header { grid-area: head; display: flex; justify-content: space-between; align-items: center; border-bottom: 1.5pt solid #1f2328; }
header .doc { font-size: 8pt; color: #6b7280; text-transform: uppercase; letter-spacing: .05em; }
h1 { margin: 0; font-size: 15pt; line-height: 1.1; }
.compass { flex: none; }
.plan { grid-area: plan; display: flex; align-items: center; justify-content: center; min-height: 0; }
.plan svg { display: block; flex: none; }
.print-grid line { stroke: #1f2328; stroke-opacity: .07; }
.print-grid line.major { stroke-opacity: .16; }
.notes { grid-area: notes; border: 0.75pt solid #9ca3af; border-radius: 3pt; padding: 3pt 6pt; display: flex; flex-direction: column; min-height: 0; }
.notes .ruled { flex: 1; background: linear-gradient(to bottom, transparent calc(100% - 0.5pt), #c4c9d0 0) 0 0 / 100% 0.28in repeat; }
.notes span { font-size: 8pt; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
footer { grid-area: foot; display: flex; align-items: center; gap: 12pt; font-size: 8pt; color: #4b5563; border-top: 0.75pt solid #d1d5db; }
footer .spacer { flex: 1; }
.bar rect { fill: #fff; stroke: #1f2328; stroke-width: .01; } .bar rect.fill { fill: #1f2328; }
.bar text { font-size: .11px; fill: #1f2328; text-anchor: middle; }
@media screen { body { background: #888; } .sheet { background: #fff; margin: 0.25in auto; } }
`;
  const body = levels.map((l, i) => <Sheet key={l.id} doc={doc} l={l} i={i} n={levels.length} layout={layout} o={o} date={date} />);
  return `<!doctype html><html lang="en" data-theme="light"><head><meta charset="utf-8"><title>${esc(doc.name)}</title><style>${css}</style></head><body>${renderToStaticMarkup(<>{body}</>)}</body></html>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Print an HTML page through a hidden frame, so only the sheets print (not the editor, or Home Assistant around it). */
export function printPage(html: string) {
  const f = document.createElement("iframe");
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0";
  f.onload = () => {
    const w = f.contentWindow!;
    let gone = false;
    const done = () => { if (!gone) { gone = true; f.remove(); } };
    w.addEventListener("afterprint", () => setTimeout(done, 100));
    w.focus();
    w.print();
    setTimeout(done, 60_000); // Some browsers never say printing is over.
  };
  f.srcdoc = html;
  document.body.append(f);
}

export function PrintDialog({ doc, paper, onPaper, onClose, currentLevel }: {
  doc: Doc; paper: Paper; onPaper: (p: Paper) => void; onClose: () => void; currentLevel: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [levelIds, setLevelIds] = useState(() => doc.levels.filter((l) => l.objects.length || l.id === currentLevel).map((l) => l.id));
  const [notes, setNotes] = useState(true);
  const [grid, setGrid] = useState(true);
  useEffect(() => { ref.current?.showModal(); }, []);
  const o: PrintOptions = { paper, levelIds: doc.levels.filter((l) => levelIds.includes(l.id)).map((l) => l.id), notes, grid };
  const layout = printLayout(doc, o);
  const go = () => { printPage(printHtml(doc, o)); onClose(); };
  return (
    <dialog ref={ref} className="print-dialog" onClose={onClose} onKeyDown={(e) => e.stopPropagation()} aria-labelledby="print-title">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <h2 id="print-title">Print floors</h2>
        <p className="hint small">One floor per page, all at the same scale and lined up, so you can flip between them and measure off the paper.</p>
        <fieldset>
          <legend>Floors</legend>
          {doc.levels.map((l) => (
            <label key={l.id}><input type="checkbox" checked={levelIds.includes(l.id)}
              onChange={(e) => setLevelIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))} /> {l.title}</label>
          ))}
        </fieldset>
        <label className="field"><span>Paper</span>
          <select value={paper} onChange={(e) => onPaper(e.target.value as Paper)}>
            {Object.entries(PAPERS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
        </label>
        <label><input type="checkbox" checked={notes} onChange={(e) => setNotes(e.target.checked)} /> Space for notes on each page</label>
        <label><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> 1′ grid over the plan</label>
        <p className="readout">
          {o.levelIds.length} {o.levelIds.length === 1 ? "page" : "pages"}, {layout.pageW > layout.pageH ? "landscape" : "portrait"}, at {layout.label}.
          {" "}Print at 100% (“Actual size”) to keep the scale true; the scale bar stays right either way.
        </p>
        <div className="actions tight">
          <button type="submit" className="primary" disabled={!o.levelIds.length}>Print…</button>
          <button type="button" onClick={() => ref.current?.close()}>Cancel</button>
        </div>
      </form>
    </dialog>
  );
}

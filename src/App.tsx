import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, addObj, mapObjs, type Tool, type View } from "./Canvas";
import { Inspector } from "./Inspector";
import { CATALOG, GROUPS, type CatalogEntry } from "./catalog";
import { useHistory } from "./history";
import { MARK_KINDS, KIND_LABEL, blankDoc, isDoc, translate, uid, type Doc, type Item, type MarkKind, type Obj, type Point, type Vec } from "./model";
import { docBounds, polyArea, turnDoor } from "./geometry";
import { docToSvg, download, parseFile, scaleLevel } from "./svgio";
import { SNAP_STEPS, fmtArea, parseLen } from "./units";
import { Conflict, boundEntities, useStates, type Host } from "./host";
import { PAPERS, PrintDialog, defaultPaper, type Paper } from "./print";
import sample from "./samples/sample.json";

const DRAFT_KEY = "home-designer:draft";
const PREFS_KEY = "home-designer:prefs";
const HOST_DRAFT_KEY = "home-designer:host-draft";

const load = <T,>(key: string): T | null => {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : null; } catch { return null; }
};
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* private mode */ } };

const sampleDoc = () => structuredClone(sample) as unknown as Doc;

interface Prefs { snapStep: number; snapOn: boolean; showGrid: boolean; showSizes: boolean; showBelow: boolean; paper: Paper }
const DEFAULT_PREFS: Prefs = { snapStep: 1 / 12, snapOn: true, showGrid: true, showSizes: true, showBelow: false, paper: defaultPaper() };

type FileHandle = { name: string; createWritable?: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }> };
type PickerWindow = Window & {
  showOpenFilePicker?: (o: unknown) => Promise<(FileHandle & { getFile: () => Promise<File> })[]>;
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
};
const FILE_TYPES = [{ description: "Home Designer SVG", accept: { "image/svg+xml": [".svg"] } }];

const TOOLS: { id: Tool; name: string; key: string; icon: string }[] = [
  { id: "select", name: "Select & move", key: "V", icon: "M5 3l14 8-6 2-2 6z" },
  { id: "room", name: "Room", key: "B", icon: "M4 4h16v16H4z M4 12h7 M11 4v16" },
  { id: "opening", name: "Door / window", key: "W", icon: "M4 20V4h9v16 M4 20h16 M13 4a9 9 0 0 1 7 16" },
  { id: "measure", name: "Measure", key: "M", icon: "M3 17L17 3l4 4L7 21z M7 13l2 2 M10 10l2 2 M13 7l2 2" },
  { id: "text", name: "Note", key: "T", icon: "M5 5h14 M12 5v14 M9 19h6" },
];

export default function App({ host }: { host?: Host }) {
  const draft = useMemo(() => (host ? null : load<{ doc: Doc; name: string }>(DRAFT_KEY)), [host]);
  const hist = useHistory<Doc>(() => (host ? blankDoc() : draft && isDoc(draft.doc) ? draft.doc : sampleDoc()));
  const { doc, commit, live, settle, undo, redo, reset } = hist;
  const [fileName, setFileName] = useState(draft?.name ?? "sample-house.svg");
  const [levelId, setLevelId] = useState(() => doc.levels.find((l) => l.id === "floor1")?.id ?? doc.levels[0].id);
  const [selection, setSelection] = useState<string[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [markKind, setMarkKind] = useState<MarkKind>("window");
  const [prefs, setPrefs] = useState<Prefs>(() => {
    const p = { ...DEFAULT_PREFS, ...load<Prefs>(PREFS_KEY) };
    return Object.hasOwn(PAPERS, p.paper) ? p : { ...p, paper: DEFAULT_PREFS.paper };
  });
  const [printing, setPrinting] = useState(false);
  const [lockStructure, setLock] = useState(false);
  const [panel, setPanel] = useState<"inspect" | "add">("add");
  const [view, setView] = useState<View>({ cx: 10, cy: 20, scale: 14 });
  const [toastMsg, setToast] = useState<string | null>(null);
  const handle = useRef<FileHandle | null>(null);
  const clip = useRef<Obj[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // With a host: the plan as last saved there (the editor is clean while showing exactly that).
  const [saved, setSaved] = useState<Doc | null>(null);
  const [saving, setSaving] = useState(false);
  const rev = useRef(-1);
  const savingRef = useRef(false);
  const dirty = !!host && !!saved && doc !== saved;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const level = doc.levels.find((l) => l.id === levelId) ?? doc.levels[0];
  const li = doc.levels.indexOf(level);
  const below = prefs.showBelow && li > 0 ? doc.levels[li - 1] : null;
  const selected = level.objects.filter((o) => selection.includes(o.id));

  const toast = useCallback((m: string) => { setToast(m); }, []);
  useEffect(() => { if (!toastMsg) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toastMsg]);

  // Keep a draft in this browser so a refresh doesn't lose work. With a host, only unsaved
  // changes are kept, with the revision they were made on.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!host) save(DRAFT_KEY, { doc, name: fileName });
      else if (saved) save(HOST_DRAFT_KEY, dirty ? { rev: rev.current, doc } : null);
    }, 400);
    return () => clearTimeout(t);
  }, [doc, fileName, host, saved, dirty]);
  useEffect(() => save(PREFS_KEY, prefs), [prefs]);
  useEffect(() => { if (!doc.levels.some((l) => l.id === levelId)) setLevelId(doc.levels[0].id); }, [doc, levelId]);
  useEffect(() => { if (selection.length) setPanel("inspect"); }, [selection]);

  // A fit asked for before the canvas has a size (it's still loading, or the page around it is
  // still laying out) waits for it.
  const pendingFit = useRef<[Doc, string] | null>(null);
  const fit = useCallback((d: Doc = doc, lid: string = levelId) => {
    const el = stage.current?.querySelector<SVGSVGElement>(".canvas");
    if (!el || el.clientWidth < 50 || el.clientHeight < 50) { pendingFit.current = [d, lid]; return; }
    pendingFit.current = null;
    const lv = d.levels.find((l) => l.id === lid) ?? d.levels[0];
    const b = docBounds(lv.objects.length ? [lv] : d.levels);
    const w = el.clientWidth, h = el.clientHeight;
    const scale = Math.max(2, Math.min(80, Math.min((w - 60) / (b.x1 - b.x0 + 2), (h - 60) / (b.y1 - b.y0 + 2))));
    setView({ cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, scale });
  }, [doc, levelId]);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  useEffect(() => {
    const el = stage.current?.querySelector<SVGSVGElement>(".canvas");
    if (!el) return;
    const ro = new ResizeObserver(() => { if (pendingFit.current) fitRef.current(...pendingFit.current); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [saved]);
  // Fit once the layout has settled (two frames: the canvas sizes itself from the grid).
  const fitSoon = (d?: Doc, lid?: string) => requestAnimationFrame(() => requestAnimationFrame(() => fitRef.current(d, lid)));
  useEffect(() => { if (!host) fitSoon(); root.current?.focus({ preventScroll: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The host's plan: the first one opens (or a draft of unsaved changes made on it); later ones
  // are saves from elsewhere, taken as they come unless there are changes here to keep.
  useEffect(() => {
    if (!host) return;
    return host.watch(({ doc: d, rev: r }) => {
      if (r === rev.current || savingRef.current) return;
      const first = rev.current < 0;
      rev.current = r;
      const base = d && isDoc(d) ? d : blankDoc();
      if (first) {
        const kept = load<{ rev: number; doc: Doc }>(HOST_DRAFT_KEY);
        const restore = kept && kept.rev === r && isDoc(kept.doc) && JSON.stringify(kept.doc) !== JSON.stringify(base);
        reset(restore ? kept.doc : base);
        setSaved(base);
        const lid = base.levels.find((l) => l.id === "floor1")?.id ?? base.levels[0].id;
        setLevelId(lid);
        fitSoon(base, lid);
        if (restore) toast("Restored your unsaved changes.");
        else if (!d) toast(`No plan in ${host.name} yet. Draw one, or open a file from More, then Save.`);
        return;
      }
      if (dirtyRef.current) { toast(`The plan was saved from somewhere else. Saving now will ask before replacing it.`); return; }
      reset(base);
      setSaved(base);
      toast("Updated with changes saved from somewhere else.");
    });
  }, [host]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveToHost = async () => {
    if (!host || saving) return;
    setSaving(true);
    savingRef.current = true;
    try {
      try {
        rev.current = await host.save(doc, rev.current);
      } catch (err) {
        if (!(err instanceof Conflict)) throw err;
        if (!confirm("The plan was saved from somewhere else since you opened it. Replace that version with yours?")) return;
        rev.current = await host.save(doc, -1);
      }
      setSaved(doc);
      toast(`Saved to ${host.name}.`);
    } catch (err) {
      toast(`Couldn't save: ${(err as Error).message}`);
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const switchLevel = (id: string) => { setLevelId(id); setSelection([]); };

  // ---- Files ------------------------------------------------------------------------------
  const openText = (text: string, name: string) => {
    try {
      const { doc: d, note } = parseFile(text, name);
      reset(d);
      setFileName(name.replace(/\.json$/i, ".svg"));
      const lid = d.levels.find((l) => l.id === "floor1")?.id ?? d.levels[0].id;
      setLevelId(lid);
      setSelection([]);
      fitSoon(d, lid);
      toast(note ?? `Opened ${name}.`);
    } catch (err) {
      toast(`Couldn't open ${name}: ${(err as Error).message}`);
    }
  };

  const open = async () => {
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [h] = await w.showOpenFilePicker({ types: [{ description: "Plans", accept: { "image/svg+xml": [".svg"], "application/json": [".json"] } }] });
        const f = await h.getFile();
        handle.current = f.name.endsWith(".svg") ? h : null;
        openText(await f.text(), f.name);
      } catch { /* cancelled */ }
      return;
    }
    fileInput.current?.click();
  };

  const saveAs = async (as = false) => {
    const svg = docToSvg(doc);
    const w = window as PickerWindow;
    try {
      if (!as && handle.current?.createWritable) {
        const out = await handle.current.createWritable();
        await out.write(svg); await out.close();
        toast(`Saved ${handle.current.name}.`);
        return;
      }
      if (w.showSaveFilePicker) {
        const h = await w.showSaveFilePicker({ suggestedName: fileName, types: FILE_TYPES });
        const out = await h.createWritable!();
        await out.write(svg); await out.close();
        handle.current = h; setFileName(h.name);
        toast(`Saved ${h.name}.`);
        return;
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
    }
    download(fileName, svg, "image/svg+xml");
    toast(`Downloaded ${fileName}.`);
  };

  const exportLevel = () => {
    const name = `${fileName.replace(/\.svg$/i, "")}-${level.id}.svg`;
    download(name, docToSvg(doc, [level.id]), "image/svg+xml");
    toast(`Downloaded ${name}.`);
  };

  const newDoc = () => {
    if (!confirm(host ? `Start a new, empty plan? Nothing changes in ${host.name} until you Save.` : "Start a new, empty plan? Unsaved changes to this one will be lost (the draft is replaced).")) return;
    const d = blankDoc();
    reset(d); handle.current = null; setFileName("new-home.svg"); setLevelId(d.levels[0].id); setSelection([]);
    setView({ cx: 15, cy: 12, scale: 20 });
  };

  const loadSample = () => {
    if (!confirm(host ? `Open the sample house? Nothing changes in ${host.name} until you Save.` : "Open the sample house? Unsaved changes to this plan will be lost.")) return;
    const d = sampleDoc();
    reset(d); handle.current = null; setFileName("sample-house.svg");
    setLevelId("floor1"); setSelection([]); fitSoon(d, "floor1");
  };

  // Open files dropped anywhere on the window.
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = async (e: DragEvent) => {
      const f = e.dataTransfer?.files?.[0];
      if (!f) return;
      e.preventDefault();
      handle.current = null;
      openText(await f.text(), f.name);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => { window.removeEventListener("dragover", over); window.removeEventListener("drop", drop); };
  });

  // ---- Editing ----------------------------------------------------------------------------
  const centre = (): Vec => [view.cx, view.cy];

  const addFromCatalog = (entry: CatalogEntry, at: Vec = centre()) => {
    let o: Obj;
    if (entry.point) {
      const p: Point = { id: uid("pt"), type: "point", kind: entry.point, label: entry.name, x: at[0], y: at[1] };
      if (entry.point === "sensor") Object.assign(p, { aim: -90, range: 6 });
      o = p;
    } else {
      const it: Item = {
        id: uid("item"), type: "item", kind: entry.kind ?? "furniture", shape: entry.shape ?? "rect",
        label: entry.name, glyph: entry.glyph, cx: at[0], cy: at[1], w: entry.w! / 12, h: entry.h! / 12, rot: 0,
      };
      o = it;
    }
    commit((d) => addObj(d, level.id, o));
    setSelection([o.id]);
    setTool("select");
  };

  const del = useCallback(() => {
    if (!selection.length) return;
    commit((d) => ({ ...d, levels: d.levels.map((l) => (l.id === levelId ? { ...l, objects: l.objects.filter((o) => !selection.includes(o.id)) } : l)) }));
    setSelection([]);
  }, [selection, levelId, commit]);

  const paste = useCallback((objs: Obj[], offset = 1) => {
    if (!objs.length) return;
    const copies = objs.map((o) => ({ ...translate(structuredClone(o), offset, offset), id: uid(o.type) }) as Obj);
    commit((d) => ({ ...d, levels: d.levels.map((l) => (l.id === levelId ? { ...l, objects: [...l.objects, ...copies] } : l)) }));
    setSelection(copies.map((c) => c.id));
  }, [levelId, commit]);

  const restack = (front: boolean) => commit((d) => ({
    ...d, levels: d.levels.map((l) => {
      if (l.id !== levelId) return l;
      const sel = l.objects.filter((o) => selection.includes(o.id)), rest = l.objects.filter((o) => !selection.includes(o.id));
      return { ...l, objects: front ? [...rest, ...sel] : [...sel, ...rest] };
    }),
  }));

  // ---- Floors -----------------------------------------------------------------------------
  const addLevel = () => {
    const title = prompt("Name the new floor:", "New floor");
    if (!title) return;
    const id = uid("level");
    commit((d) => { const levels = d.levels.slice(); levels.splice(li + 1, 0, { id, title, objects: [] }); return { ...d, levels }; });
    switchLevel(id);
  };
  const renameLevel = () => {
    const title = prompt("Rename this floor:", level.title);
    if (title) commit((d) => ({ ...d, levels: d.levels.map((l) => (l.id === level.id ? { ...l, title } : l)) }));
  };
  const duplicateLevel = () => {
    const id = uid("level");
    const copy = { id, title: `${level.title} copy`, objects: level.objects.map((o) => ({ ...structuredClone(o), id: uid(o.type) }) as Obj) };
    commit((d) => { const levels = d.levels.slice(); levels.splice(li + 1, 0, copy); return { ...d, levels }; });
    switchLevel(id);
  };
  const deleteLevel = () => {
    if (doc.levels.length < 2 || !confirm(`Delete “${level.title}” and everything on it?`)) return;
    commit((d) => ({ ...d, levels: d.levels.filter((l) => l.id !== level.id) }));
    switchLevel(doc.levels[li === 0 ? 1 : li - 1].id);
  };
  const moveLevel = (dir: -1 | 1) => commit((d) => {
    const levels = d.levels.slice(), j = li + dir;
    if (j < 0 || j >= levels.length) return d;
    [levels[li], levels[j]] = [levels[j], levels[li]];
    return { ...d, levels };
  });
  const rescale = () => {
    const dim = selected.find((o) => o.type === "dim");
    if (!dim || dim.type !== "dim") { toast("Select a dimension line over something whose real length you know, then rescale."); return; }
    const cur = Math.hypot(dim.b[0] - dim.a[0], dim.b[1] - dim.a[1]);
    const ans = prompt(`That line measures ${cur.toFixed(2)} ft on the plan. How long is it really? (e.g. 12' 6")`);
    if (!ans) return;
    const real = parseLen(ans);
    if (!real) { toast("Couldn't read that length."); return; }
    commit((d) => ({ ...d, levels: d.levels.map((l) => (l.id === level.id ? scaleLevel(l, real / cur, dim.a) : l)) }));
    toast(`Scaled ${level.title} by ${(real / cur).toFixed(3)}×.`);
  };

  // ---- Keyboard ---------------------------------------------------------------------------
  // Shortcuts are handled on the app itself, not the window, so inside Home Assistant they
  // don't also set off its own one-letter shortcuts.
  const onKey = (e: React.KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const used = () => e.stopPropagation();
      if (t.closest("input,select,textarea,[contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod && k === "s") { e.preventDefault(); used(); if (host && !e.shiftKey) saveToHost(); else saveAs(e.shiftKey); return; }
      if (mod && k === "o") { e.preventDefault(); open(); return; }
      if (mod && k === "p") { e.preventDefault(); used(); setPrinting(true); return; }
      if (mod && k === "a") { e.preventDefault(); setSelection(level.objects.filter((o) => !(lockStructure && (o.type === "room" || o.type === "mark"))).map((o) => o.id)); return; }
      if (mod && k === "c") { clip.current = structuredClone(selected); return; }
      if (mod && k === "x") { clip.current = structuredClone(selected); del(); return; }
      if (mod && k === "v") { e.preventDefault(); paste(clip.current); return; }
      if (mod && k === "d") { e.preventDefault(); paste(selected); return; }
      if (mod) return;
      if (k === "delete" || k === "backspace") { used(); e.preventDefault(); del(); return; }
      if (k === "escape") { used(); setSelection([]); setTool("select"); return; }
      if (k === "r" && selected.length) {
        used();
        commit((d) => mapObjs(d, levelId, selection, (o) => (o.type === "item" ? { ...o, rot: ((o.rot + (e.shiftKey ? -90 : 90) + 540) % 360) - 180 }
          : o.type === "mark" && o.kind === "door" ? turnDoor(o, e.shiftKey) : o)));
        return;
      }
      if (k.startsWith("arrow") && selected.length) {
        e.preventDefault(); used();
        const step = (prefs.snapOn ? prefs.snapStep : 1 / 12) * (e.shiftKey ? 12 : 1);
        const [dx, dy] = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[k] as Vec;
        commit((d) => mapObjs(d, levelId, selection, (o) => translate(o, dx, dy)));
        return;
      }
      if (k === "f") { used(); fit(); return; }
      if (k === "g") { used(); setPrefs((p) => ({ ...p, showGrid: !p.showGrid })); return; }
      const t2 = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t2) { used(); setTool(t2.id); }
  };

  const states = useStates(host, useMemo(() => boundEntities(level.objects), [level]));

  const roomsArea = useMemo(() => level.objects.reduce((s, o) =>
    s + (o.type === "room" && ["room", "hall", "wet", "closet"].includes(o.kind) ? polyArea(o.points) : 0), 0), [level]);

  if (host && !saved) return <div className="app loading">Loading the plan from {host.name}…{toastMsg && <div className="toast" role="status">{toastMsg}</div>}</div>;

  const menuItems = <>
    {host
      ? <>
          <button type="button" onClick={open}>Open a file…</button>
          <button type="button" onClick={() => saveAs(true)}>Download as SVG…</button>
        </>
      : <button type="button" onClick={() => saveAs(true)}>Save as…</button>}
    <button type="button" onClick={exportLevel}>Export this floor only</button>
    <button type="button" onClick={() => download(fileName.replace(/\.svg$/i, ".json"), JSON.stringify(doc, null, 1), "application/json")}>Download project JSON</button>
    <hr />
    <button type="button" onClick={newDoc}>New empty plan</button>
    <button type="button" onClick={loadSample}>Open the sample house</button>
  </>;

  return (
    <div className="app" ref={root} tabIndex={-1} onKeyDown={onKey}
      onPointerDownCapture={(e) => { if (!(e.target as Element).closest("input,select,textarea,button,summary")) root.current?.focus({ preventScroll: true }); }}>
      <header className="topbar">
        {host?.narrow && host.toggleMenu && (
          <button type="button" className="icon" onClick={host.toggleMenu} aria-label="Open the sidebar">
            <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16" /></svg></button>
        )}
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="3" width="26" height="26" rx="3" /><path d="M6 6h11v20H6zM19 6h7v9h-7zM19 17h7v9h-7z" /></svg>
          <input id="doc-name" className="doc-name" value={doc.name} aria-label="Plan name"
            onChange={(e) => live((d) => ({ ...d, name: e.target.value }))} onBlur={() => commit((d) => d)}
            onKeyDown={(e) => e.stopPropagation()} />
        </div>
        <div className="file-actions">
          {host
            ? <>
                <span className={`save-state${dirty ? " dirty" : ""}`} role="status">{saving ? "Saving…" : dirty ? "Unsaved changes" : "Saved"}</span>
                <button type="button" className="primary" onClick={saveToHost} disabled={saving || !dirty} title={`Save to ${host.name} (Ctrl+S)`}>Save</button>
              </>
            : <>
                <button type="button" onClick={open} title="Open an SVG or JSON plan (Ctrl+O)">Open</button>
                <button type="button" className="primary" onClick={() => saveAs(false)} title="Save as SVG (Ctrl+S)">Save</button>
              </>}
          <button type="button" onClick={() => setPrinting(true)} title="Print one floor per page, at one scale (Ctrl+P)">Print</button>
          <details className="menu">
            <summary aria-label="More file actions">More</summary>
            <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).open = false}>
              {menuItems}
            </div>
          </details>
          <input ref={fileInput} type="file" accept=".svg,.json,image/svg+xml,application/json" hidden id="file-input"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) { handle.current = null; openText(await f.text(), f.name); } e.target.value = ""; }} />
        </div>
        <div className="history">
          <button type="button" onClick={undo} disabled={!hist.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <svg viewBox="0 0 24 24"><path d="M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2" /></svg></button>
          <button type="button" onClick={redo} disabled={!hist.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <svg viewBox="0 0 24 24"><path d="M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h2" /></svg></button>
        </div>
      </header>

      <nav className="tools" aria-label="Tools">
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? "on" : ""} onClick={() => setTool(t.id)}
            title={`${t.name} (${t.key})`} aria-pressed={tool === t.id}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
            <span>{t.name}</span>
          </button>
        ))}
        {tool === "opening" && (
          <select id="mark-kind" aria-label="What to draw" value={markKind} onChange={(e) => setMarkKind(e.target.value as MarkKind)}>
            {MARK_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        )}
      </nav>

      <main className="stage" ref={stage}>
        <div className="levels">
          <div className="level-tabs" role="tablist" aria-label="Floors">
            {doc.levels.map((l) => (
              <button key={l.id} role="tab" type="button" aria-selected={l.id === level.id} className={l.id === level.id ? "on" : ""}
                onClick={() => switchLevel(l.id)} onDoubleClick={renameLevel}>{l.title}</button>
            ))}
          </div>
          <details className="menu">
            <summary aria-label="Floor actions">⋯</summary>
            <div className="menu-list" onClick={(e) => (e.currentTarget.parentElement as HTMLDetailsElement).open = false}>
              <button type="button" onClick={addLevel}>Add a floor above this one</button>
              <button type="button" onClick={renameLevel}>Rename “{level.title}”</button>
              <button type="button" onClick={duplicateLevel}>Duplicate this floor</button>
              <button type="button" onClick={() => moveLevel(-1)} disabled={li === 0}>Move down</button>
              <button type="button" onClick={() => moveLevel(1)} disabled={li === doc.levels.length - 1}>Move up</button>
              <button type="button" onClick={rescale}>Rescale floor from a dimension…</button>
              <hr />
              <button type="button" className="danger" onClick={deleteLevel} disabled={doc.levels.length < 2}>Delete this floor</button>
            </div>
          </details>
        </div>
        <Canvas
          doc={doc} level={level} below={below} tool={tool} markKind={markKind} selection={selection}
          snapStep={prefs.snapStep} snapOn={prefs.snapOn} showGrid={prefs.showGrid} showSizes={prefs.showSizes}
          lockStructure={lockStructure} view={view} setView={setView} setSelection={setSelection} setTool={setTool}
          commit={commit} live={live} settle={settle} toast={toast} states={states}
          onDropCatalog={(id, at) => { const e = CATALOG.find((c) => c.id === id); if (e) addFromCatalog(e, at); }}
        />
        <div className="viewbar">
          <label htmlFor="snap-on"><input id="snap-on" type="checkbox" checked={prefs.snapOn} onChange={(e) => setPrefs({ ...prefs, snapOn: e.target.checked })} /> Snap</label>
          <select id="snap-step" aria-label="Snap step" value={prefs.snapStep} disabled={!prefs.snapOn}
            onChange={(e) => setPrefs({ ...prefs, snapStep: +e.target.value })}>
            {SNAP_STEPS.map((s) => <option key={s.label} value={s.ft}>{s.label}</option>)}
          </select>
          <label htmlFor="show-grid"><input id="show-grid" type="checkbox" checked={prefs.showGrid} onChange={(e) => setPrefs({ ...prefs, showGrid: e.target.checked })} /> Grid</label>
          <label htmlFor="show-sizes"><input id="show-sizes" type="checkbox" checked={prefs.showSizes} onChange={(e) => setPrefs({ ...prefs, showSizes: e.target.checked })} /> Room sizes</label>
          <label htmlFor="show-below" title="Show the floor below, faded, for lining things up"><input id="show-below" type="checkbox" checked={prefs.showBelow} disabled={li === 0} onChange={(e) => setPrefs({ ...prefs, showBelow: e.target.checked })} /> Floor below</label>
          <label htmlFor="lock" title="Lock rooms, walls, doors and windows so only furniture moves"><input id="lock" type="checkbox" checked={lockStructure} onChange={(e) => setLock(e.target.checked)} /> Lock rooms</label>
          <span className="spacer" />
          <span className="area" title="Rooms, halls, baths and closets on this floor, measured inside the walls">{fmtArea(roomsArea)}</span>
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.max(2, v.scale / 1.25) }))} aria-label="Zoom out">−</button>
          <button type="button" onClick={() => fit()} title="Fit to screen (F)">Fit</button>
          <button type="button" onClick={() => setView((v) => ({ ...v, scale: Math.min(400, v.scale * 1.25) }))} aria-label="Zoom in">+</button>
        </div>
        {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
      </main>

      <aside className="side">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={panel === "add"} className={panel === "add" ? "on" : ""} onClick={() => setPanel("add")}>Add</button>
          <button type="button" role="tab" aria-selected={panel === "inspect"} className={panel === "inspect" ? "on" : ""} onClick={() => setPanel("inspect")}>
            Selection{selection.length ? ` (${selection.length})` : ""}</button>
        </div>
        {panel === "inspect"
          ? <Inspector selected={selected} entities={host?.entities} states={states}
              onChange={(id, fn) => commit((d) => mapObjs(d, levelId, [id], fn))}
              onDelete={del} onDuplicate={() => paste(selected)} onFront={() => restack(true)} onBack={() => restack(false)} />
          : <CatalogPanel onAdd={(e) => addFromCatalog(e)} />}
      </aside>
      {printing && <PrintDialog doc={doc} currentLevel={level.id} paper={prefs.paper}
        onPaper={(paper) => setPrefs((p) => ({ ...p, paper }))} onClose={() => setPrinting(false)} />}
    </div>
  );
}

function CatalogPanel({ onAdd }: { onAdd: (e: CatalogEntry) => void }) {
  const [q, setQ] = useState("");
  const hits = CATALOG.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="catalog">
      <input id="catalog-search" type="search" placeholder="Find furniture…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      {GROUPS.map((g) => {
        const items = hits.filter((c) => c.group === g);
        if (!items.length) return null;
        return (
          <section key={g}>
            <h3>{g}</h3>
            <div className="grid">
              {items.map((c) => (
                <button key={c.id} type="button" draggable className="cat"
                  onDragStart={(e) => { e.dataTransfer.setData("application/x-hd-catalog", c.id); e.dataTransfer.effectAllowed = "copy"; }}
                  onClick={() => onAdd(c)} title={c.w ? `${c.name}: ${c.w}″ × ${c.h}″. Click to add, or drag onto the plan.` : `${c.name}. Click to add, or drag onto the plan.`}>
                  <CatIcon c={c} />
                  <span className="name">{c.name}</span>
                  {c.w && <span className="size">{c.w}″×{c.h}″</span>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CatIcon({ c }: { c: CatalogEntry }) {
  if (c.point) return <svg viewBox="-1 -1 2 2" className="caticon hd-art"><circle r={0.45} className={c.point === "thermo" ? "thermo" : c.point} /></svg>;
  const w = c.w!, h = c.h!, s = 1.7 / Math.max(w, h);
  return (
    <svg viewBox="-1 -1 2 2" className="caticon">
      {c.shape === "ellipse" ? <ellipse rx={(w * s) / 2} ry={(h * s) / 2} /> : <rect x={(-w * s) / 2} y={(-h * s) / 2} width={w * s} height={h * s} rx={0.04} />}
    </svg>
  );
}


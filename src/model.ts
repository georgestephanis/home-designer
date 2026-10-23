// The document: levels of objects, all coordinates in feet, y growing southward (north is up).

export type Vec = [number, number];

export type RoomKind = "room" | "hall" | "stairs" | "wet" | "closet" | "attic" | "outside" | "labelonly";
export type ItemKind = "furniture" | "fixture" | "chimney" | "stone" | "baseboard" | "cage";
export type MarkKind =
  | "window" | "window-blocked" | "window-maybe" | "door" | "garage" | "blocked" | "opening" | "slider" | "step";
export type PointKind = "device" | "ap" | "lora" | "thermo" | "sensor";

export interface Room { id: string; type: "room"; kind: RoomKind; label: string; points: Vec[] }
/** A rectangle or ellipse centred on (cx, cy), w×h before rotating `rot` degrees clockwise. */
export interface Item {
  id: string; type: "item"; kind: ItemKind; shape: "rect" | "ellipse"; label: string;
  cx: number; cy: number; w: number; h: number; rot: number; glyph?: string;
  /** A Home Assistant entity shown here (e.g. "light.sofa"), when the plan lives in Home Assistant. */
  entity?: string;
}
/** A door, window or opening along a wall, from a to b. */
export interface Mark { id: string; type: "mark"; kind: MarkKind; label: string; a: Vec; b: Vec }
export interface Point {
  id: string; type: "point"; kind: PointKind; label: string; x: number; y: number;
  aim?: number; range?: number; entity?: string;
}
/** A dimension line from a to b, drawn `offset` feet to the left of a→b. */
export interface Dim { id: string; type: "dim"; label: string; a: Vec; b: Vec; offset: number }
export interface Text { id: string; type: "text"; label: string; x: number; y: number; size: number }

export type Obj = Room | Item | Mark | Point | Dim | Text;
export type ObjType = Obj["type"];

export interface Level { id: string; title: string; objects: Obj[] }
export interface Doc { app: "home-designer"; version: 1; name: string; wall: number; levels: Level[] }

export const ROOM_KINDS: RoomKind[] = ["room", "hall", "stairs", "wet", "closet", "attic", "outside", "labelonly"];
export const ITEM_KINDS: ItemKind[] = ["furniture", "fixture", "chimney", "stone", "baseboard", "cage"];
export const MARK_KINDS: MarkKind[] = [
  "window", "window-blocked", "window-maybe", "door", "garage", "blocked", "opening", "slider", "step",
];
export const POINT_KINDS: PointKind[] = ["device", "ap", "lora", "thermo", "sensor"];

/** Rooms that get a wall band drawn around them. */
export const WALLED: RoomKind[] = ["room", "hall", "wet", "closet", "stairs", "attic"];

export const KIND_LABEL: Record<string, string> = {
  room: "Room", hall: "Hall", stairs: "Stairs", wet: "Bath / wet", closet: "Closet", attic: "Attic",
  outside: "Outside", labelonly: "Label area",
  furniture: "Furniture", fixture: "Fixture", chimney: "Chimney", stone: "Stone wall", baseboard: "Baseboard",
  cage: "Outline",
  window: "Window", "window-blocked": "Blocked window", "window-maybe": "Possible window", door: "Door",
  garage: "Garage door", blocked: "Blocked door", opening: "Opening", slider: "Sliding door", step: "Step",
  device: "Device", ap: "Wi-Fi AP", lora: "LoRa", thermo: "Thermostat", sensor: "Sensor",
};

let counter = 0;
export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function blankDoc(): Doc {
  return {
    app: "home-designer", version: 1, name: "Untitled home", wall: 1,
    levels: [{ id: "floor1", title: "First floor", objects: [] }],
  };
}

export function isDoc(d: unknown): d is Doc {
  const x = d as Doc;
  return !!x && x.app === "home-designer" && Array.isArray(x.levels) &&
    x.levels.every((l) => l && typeof l.id === "string" && Array.isArray(l.objects));
}

export function mapLevel(doc: Doc, levelId: string, fn: (objs: Obj[]) => Obj[]): Doc {
  return { ...doc, levels: doc.levels.map((l) => (l.id === levelId ? { ...l, objects: fn(l.objects) } : l)) };
}

export function updateObjs(doc: Doc, levelId: string, ids: string[], fn: (o: Obj) => Obj): Doc {
  const set = new Set(ids);
  return mapLevel(doc, levelId, (objs) => objs.map((o) => (set.has(o.id) ? fn(o) : o)));
}

/** Move an object by (dx, dy). */
export function translate(o: Obj, dx: number, dy: number): Obj {
  const add = (p: Vec): Vec => [p[0] + dx, p[1] + dy];
  switch (o.type) {
    case "room": return { ...o, points: o.points.map(add) };
    case "item": return { ...o, cx: o.cx + dx, cy: o.cy + dy };
    case "mark": case "dim": return { ...o, a: add(o.a), b: add(o.b) };
    case "point": case "text": return { ...o, x: o.x + dx, y: o.y + dy };
  }
}

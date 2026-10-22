import type { ItemKind, PointKind } from "./model";

// Common sizes, in inches (w = side to side, h = front to back; the head of a bed is at the top).
export interface CatalogEntry {
  id: string; name: string; group: string;
  w?: number; h?: number; shape?: "rect" | "ellipse"; glyph?: string; kind?: ItemKind;
  point?: PointKind;
}

export const CATALOG: CatalogEntry[] = [
  { id: "bed-king", name: "King bed", group: "Bedroom", w: 76, h: 80, glyph: "bed" },
  { id: "bed-queen", name: "Queen bed", group: "Bedroom", w: 60, h: 80, glyph: "bed" },
  { id: "bed-full", name: "Full bed", group: "Bedroom", w: 54, h: 75, glyph: "bed" },
  { id: "bed-twin", name: "Twin bed", group: "Bedroom", w: 38, h: 75, glyph: "bed" },
  { id: "nightstand", name: "Nightstand", group: "Bedroom", w: 22, h: 18 },
  { id: "dresser", name: "Dresser", group: "Bedroom", w: 60, h: 20, glyph: "drawers" },
  { id: "wardrobe", name: "Wardrobe", group: "Bedroom", w: 40, h: 24, glyph: "drawers" },

  { id: "sofa", name: "Sofa", group: "Living", w: 84, h: 36, glyph: "sofa" },
  { id: "loveseat", name: "Loveseat", group: "Living", w: 60, h: 36, glyph: "sofa" },
  { id: "sectional", name: "Sectional", group: "Living", w: 110, h: 84, glyph: "sectional" },
  { id: "armchair", name: "Armchair", group: "Living", w: 32, h: 34, glyph: "sofa" },
  { id: "coffee-table", name: "Coffee table", group: "Living", w: 48, h: 24 },
  { id: "tv-stand", name: "TV stand", group: "Living", w: 60, h: 18, glyph: "tv" },
  { id: "bookshelf", name: "Bookshelf", group: "Living", w: 36, h: 12, glyph: "shelf" },
  { id: "rug-5x8", name: "Rug 5×8", group: "Living", w: 96, h: 60, glyph: "rug" },
  { id: "plant", name: "Plant", group: "Living", w: 18, h: 18, shape: "ellipse", glyph: "plant" },

  { id: "desk", name: "Desk", group: "Office & craft", w: 60, h: 30, glyph: "desk" },
  { id: "desk-l", name: "L desk", group: "Office & craft", w: 66, h: 60, glyph: "ldesk" },
  { id: "office-chair", name: "Office chair", group: "Office & craft", w: 26, h: 26, shape: "ellipse", glyph: "chair" },
  { id: "rack", name: "Server rack", group: "Office & craft", w: 24, h: 36, glyph: "drawers" },
  { id: "workbench", name: "Workbench", group: "Office & craft", w: 72, h: 30 },
  { id: "laser", name: "Laser cutter", group: "Office & craft", w: 40, h: 28 },

  { id: "dining-table", name: "Dining table", group: "Kitchen & dining", w: 72, h: 36, glyph: "table" },
  { id: "round-table", name: "Round table", group: "Kitchen & dining", w: 48, h: 48, shape: "ellipse", glyph: "table" },
  { id: "chair", name: "Chair", group: "Kitchen & dining", w: 18, h: 20, glyph: "chair" },
  { id: "fridge", name: "Fridge", group: "Kitchen & dining", w: 36, h: 30, glyph: "fridge" },
  { id: "stove", name: "Stove", group: "Kitchen & dining", w: 30, h: 26, glyph: "stove" },
  { id: "counter", name: "Counter run", group: "Kitchen & dining", w: 96, h: 24 },
  { id: "kitchen-sink", name: "Sink", group: "Kitchen & dining", w: 33, h: 22, glyph: "sink" },

  { id: "toilet", name: "Toilet", group: "Bath & laundry", w: 20, h: 28, glyph: "toilet" },
  { id: "vanity", name: "Vanity", group: "Bath & laundry", w: 30, h: 21, glyph: "sink" },
  { id: "tub", name: "Bathtub", group: "Bath & laundry", w: 60, h: 30, glyph: "tub" },
  { id: "shower", name: "Shower", group: "Bath & laundry", w: 36, h: 36, glyph: "shower" },
  { id: "washer", name: "Washer", group: "Bath & laundry", w: 27, h: 30, glyph: "washer" },
  { id: "dryer", name: "Dryer", group: "Bath & laundry", w: 27, h: 30, glyph: "washer" },
  { id: "freezer", name: "Upright freezer", group: "Bath & laundry", w: 28, h: 30, glyph: "fridge" },

  { id: "pt-light", name: "Light", group: "Devices", point: "device" },
  { id: "pt-ap", name: "Wi-Fi AP", group: "Devices", point: "ap" },
  { id: "pt-thermo", name: "Thermostat", group: "Devices", point: "thermo" },
  { id: "pt-sensor", name: "mmWave sensor", group: "Devices", point: "sensor" },
  { id: "pt-lora", name: "LoRa node", group: "Devices", point: "lora" },

  { id: "chimney", name: "Chimney", group: "Structure", w: 36, h: 24, kind: "chimney" },
  { id: "column", name: "Post", group: "Structure", w: 6, h: 6, kind: "chimney" },
  { id: "fixture", name: "Box", group: "Structure", w: 24, h: 24, kind: "fixture" },
];

export const GROUPS = [...new Set(CATALOG.map((c) => c.group))];

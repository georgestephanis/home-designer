import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import sample from "../samples/sample.json";
import type { Doc, Item, Mark, Point, Room } from "../model";
import { docToSvg, parseFile, scaleLevel } from "../svgio";

const doc = sample as unknown as Doc;

describe("SVG save and load", () => {
  it("round-trips a project exactly through the saved SVG", () => {
    const svg = docToSvg(doc);
    expect(svg).toMatch(/^<\?xml/);
    expect(new DOMParser().parseFromString(svg, "image/svg+xml").querySelector("parsererror")).toBeNull();
    expect(parseFile(svg, "house.svg").doc).toEqual(doc);
  });

  it("survives labels with XML-special characters and ]]>", () => {
    const d: Doc = structuredClone(doc);
    d.name = `Tom & Jerry's <house> ]]> "quoted"`;
    expect(parseFile(docToSvg(d), "x.svg").doc.name).toBe(d.name);
  });

  it("exports a single floor", () => {
    const svg = docToSvg(doc, ["floor2"]);
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(dom.querySelectorAll("g.level")).toHaveLength(1);
  });

  it("opens project JSON", () => {
    expect(parseFile(JSON.stringify(doc), "house.json").doc).toEqual(doc);
  });

  it("rejects things that aren't plans", () => {
    expect(() => parseFile("{\"a\":1}", "x.json")).toThrow();
    expect(() => parseFile("<svg", "x.svg")).toThrow();
  });
});

describe("importing a plain gen.py SVG", () => {
  const text = readFileSync(join(__dirname, "gen-floor2.svg.txt"), "utf8");
  const { doc: d, note } = parseFile(text, "floor2.svg");
  const lv = d.levels[0];
  const by = <T,>(t: string) => lv.objects.filter((o) => o.type === t) as T[];

  it("finds the level and reads it in feet", () => {
    expect(note).toBeTruthy();
    expect(d.levels).toHaveLength(1);
    expect(lv.id).toBe("floor2");
    expect(lv.title).toBe("Second floor");
  });
  it("brings in named rooms at the right size", () => {
    const rooms = by<Room>("room");
    const bed2 = rooms.find((r) => r.label === "Bedroom 2")!;
    expect(bed2).toBeTruthy();
    const xs = bed2.points.map((p) => p[0]), ys = bed2.points.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(8 + 2 / 12, 1); // 8′ 2″ × 10′ 8″
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10 + 8 / 12, 1);
    expect(rooms.some((r) => r.label === "Main bedroom")).toBe(true);
  });
  it("brings in windows, doors, furniture and devices", () => {
    expect(by<Mark>("mark").filter((m) => m.kind === "window").length).toBeGreaterThan(3);
    expect(by<Item>("item").some((i) => i.label === "King bed")).toBe(true);
    expect(by<Point>("point").some((p) => p.kind === "thermo")).toBe(true);
  });
});

describe("scaleLevel", () => {
  it("scales around a point", () => {
    const lv = scaleLevel(doc.levels[1], 2, [0, 0]);
    const r0 = doc.levels[1].objects[0] as Room, r1 = lv.objects[0] as Room;
    expect(r1.points[1][0]).toBeCloseTo(r0.points[1][0] * 2);
  });
});

import { describe, expect, it } from "vitest";
import { printHtml, printLayout, type PrintOptions } from "../print";
import type { Doc, Room } from "../model";

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room =>
  ({ id, type: "room", kind: "room", label: id, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const doc = (...levels: Room[][]): Doc => ({
  app: "home-designer", version: 1, name: "Test", wall: 0.5,
  levels: levels.map((objects, i) => ({ id: `l${i}`, title: `Floor ${i}`, objects })),
});
const opts = (o: Partial<PrintOptions> = {}): PrintOptions => ({ paper: "letter", levelIds: ["l0", "l1"], notes: true, grid: true, ...o });

describe("print layout", () => {
  it("shares one box across floors, covering every chosen floor", () => {
    const d = doc([room("a", 0, 0, 30, 20)], [room("b", 10, 5, 50, 15)]);
    const { box } = printLayout(d, opts());
    expect(box.x).toBeLessThanOrEqual(0);
    expect(box.y).toBeLessThanOrEqual(0);
    expect(box.x + box.w).toBeGreaterThanOrEqual(50);
    expect(box.y + box.h).toBeGreaterThanOrEqual(20);
  });

  it("only sizes for the chosen floors", () => {
    const d = doc([room("a", 0, 0, 30, 20)], [room("b", 0, 0, 200, 20)]);
    const one = printLayout(d, opts({ levelIds: ["l0"] }));
    const both = printLayout(d, opts());
    expect(one.box.w).toBeLessThan(both.box.w);
    expect(one.scale).toBeGreaterThan(both.scale);
  });

  it("picks a standard scale the plan fits at", () => {
    const d = doc([room("a", 0, 0, 40, 30)]);
    for (const notes of [true, false]) {
      const l = printLayout(d, opts({ levelIds: ["l0"], notes }));
      expect(l.label).toMatch(/= 1′-0″/);
      const w = l.pageW - 0.8 - (l.notes === "side" ? 2.6 : 0);
      const h = l.pageH - 0.8 - 1 - (l.notes === "below" ? 2 : 0);
      expect(l.box.w * l.scale).toBeLessThanOrEqual(w + 1e-9);
      expect(l.box.h * l.scale).toBeLessThanOrEqual(h + 1e-9);
    }
  });

  it("turns the page and puts notes where they cost the plan least", () => {
    const wide = printLayout(doc([room("a", 0, 0, 60, 20)]), opts({ levelIds: ["l0"] }));
    expect(wide.pageW).toBeGreaterThan(wide.pageH);
    expect(wide.notes).toBe("below");
    const tall = printLayout(doc([room("a", 0, 0, 20, 60)]), opts({ levelIds: ["l0"] }));
    expect(tall.pageH).toBeGreaterThan(tall.pageW);
    expect(tall.notes).toBe("side");
    const square = printLayout(doc([room("a", 0, 0, 30, 30)]), opts({ levelIds: ["l0"], paper: "tabloid" }));
    expect(square.notes).not.toBeNull();
  });

  it("leaves notes out when asked", () => {
    expect(printLayout(doc([room("a", 0, 0, 30, 20)]), opts({ levelIds: ["l0"], notes: false })).notes).toBeNull();
  });

  it("prints one sheet per chosen floor, in floor order, at the same size", () => {
    const d = doc([room("a", 0, 0, 30, 20)], [room("b", 0, 0, 10, 10)], [room("c", 0, 0, 5, 5)]);
    const html = printHtml(d, opts({ levelIds: ["l2", "l0"] }));
    expect(html.match(/<section class="sheet/g)).toHaveLength(2);
    expect(html.indexOf("Floor 0")).toBeLessThan(html.indexOf("Floor 2"));
    expect(html).not.toContain("Floor 1");
    const sizes = [...html.matchAll(/<svg class="hd-art" width="([\d.]+in)" height="([\d.]+in)"/g)].map((m) => m[1] + m[2]);
    expect(sizes).toHaveLength(2);
    expect(new Set(sizes).size).toBe(1);
  });
});

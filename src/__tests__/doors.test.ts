import { describe, expect, it } from "vitest";
import { doorLeaf, moveMarkTo, newMarkOnWall, turnDoor } from "../geometry";
import type { Mark, Room } from "../model";

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room =>
  ({ id, type: "room", kind: "room", label: id, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
const objs = [room("a", 0, 0, 10, 10)];
const door = (s: Omit<Mark, "id" | "type" | "kind" | "label">): Mark => ({ id: "d", type: "mark", kind: "door", label: "", ...s });

describe("doors", () => {
  it("places a clicked door on the nearest wall, opening into the room", () => {
    const s = newMarkOnWall(objs, "door", [5, 0.4], 3, 1.5)!;
    expect([s.a, s.b].map((p) => p[1])).toEqual([0, 0]);
    expect(Math.abs(s.a[0] - s.b[0])).toBeCloseTo(3);
    const leaf = doorLeaf(door(s))!;
    expect(leaf.open[1]).toBeGreaterThan(0); // swings south, into the room
  });

  it("keeps a clicked door inside the wall's length", () => {
    const s = newMarkOnWall(objs, "door", [9.8, 0], 3, 1.5)!;
    expect(Math.max(s.a[0], s.b[0])).toBeCloseTo(10);
  });

  it("misses when nowhere near a wall", () => {
    expect(newMarkOnWall(objs, "door", [5, 5], 3, 1.5)).toBeNull();
  });

  it("drags a door onto another wall and turns it to open into the room", () => {
    const d = door({ ...newMarkOnWall(objs, "door", [5, 0], 3, 1.5)! });
    const moved = moveMarkTo(objs, d, [0.2, 5], 1.5)!;
    expect(moved.a[0]).toBe(0);
    expect(moved.b[0]).toBe(0);
    expect(Math.abs(moved.a[1] - moved.b[1])).toBeCloseTo(3);
    expect(doorLeaf(moved)!.open[0]).toBeGreaterThan(0); // swings east, into the room
  });

  it("keeps a door opening into its room when dragged to the opposite wall", () => {
    const d = door({ ...newMarkOnWall(objs, "door", [5, 0], 3, 1.5)! });
    const moved = moveMarkTo(objs, d, [5, 9.8], 1.5)!;
    expect(moved.a[1]).toBe(10);
    expect(doorLeaf(moved)!.open[1]).toBeLessThan(10); // swings north, into the room
    const out = moveMarkTo(objs, { ...d, swing: -1 }, [5, 9.8], 1.5)!;
    expect(doorLeaf(out)!.open[1]).toBeGreaterThan(10); // one that opened out still does
  });

  it("keeps its swing sliding along a wall shared by two rooms", () => {
    const two = [room("a", 0, 0, 10, 10), room("b", 10 + 5 / 12, 0, 20, 10)];
    const d = door({ ...newMarkOnWall(two, "door", [9.9, 5], 3, 1.5)! });
    const open0 = doorLeaf(d)!.open[0] < 10;
    for (const x of [10.3, 10.1, 10.4]) {
      const moved = moveMarkTo(two, d, [x, 3], 1.5)!;
      expect(doorLeaf(moved)!.open[0] < 10).toBe(open0);
    }
  });

  it("turns through all four hinge and swing positions and back", () => {
    let d = door({ a: [0, 0], b: [3, 0], hinge: "a", swing: 1 });
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) { seen.add(`${d.hinge}${d.swing}`); d = turnDoor(d); }
    expect(seen.size).toBe(4);
    expect([d.hinge, d.swing]).toEqual(["a", 1]);
    expect(turnDoor(turnDoor(d), true)).toMatchObject({ hinge: d.hinge, swing: d.swing });
  });

  it("draws no swing for a door without a hinge", () => {
    expect(doorLeaf(door({ a: [0, 0], b: [3, 0] }))).toBeNull();
  });
});

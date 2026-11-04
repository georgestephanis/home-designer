import { describe, expect, it } from "vitest";
import { closetHost, pointInPoly, polyArea, rayToPoly, snapMarkToWall, wallSpan } from "../geometry";
import { setEdgeLength } from "../Inspector";
import type { Room } from "../model";

const room = (id: string, x0: number, y0: number, x1: number, y1: number): Room =>
  ({ id, type: "room", kind: "room", label: id, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });

// Two rooms with a 5″ wall between them at x = 10 .. 10.4167.
const A = room("a", 0, 0, 10, 10), B = room("b", 10 + 5 / 12, 0, 20, 10);

describe("wallSpan", () => {
  it("centres a door between two rooms on the shared wall", () => {
    const s = wallSpan([A, B], 1, "door", [10, 3], [10, 6])!;
    expect(s.a[0]).toBeCloseTo(10 + 2.5 / 12);
    expect(s.t).toBeCloseTo(5 / 12);
  });
  it("centres a window on an outside wall using the wall thickness", () => {
    const s = wallSpan([A, B], 1, "window", [3, 0], [6, 0])!;
    expect(s.a[1]).toBeCloseTo(-0.5);
    expect(s.t).toBeCloseTo(1);
  });
  it("leaves an opening off a wall alone", () => {
    expect(wallSpan([A], 1, "opening", [3, 5], [6, 5])).toBeNull();
  });
});

describe("snapMarkToWall", () => {
  it("moves a roughly drawn window onto the nearest room face", () => {
    const s = snapMarkToWall([A], [2, 0.4], [5, -0.3], 1.5)!;
    expect(s.a).toEqual([2, 0]);
    expect(s.b).toEqual([5, 0]);
  });
  it("refuses a line drawn in the middle of a room", () => {
    expect(snapMarkToWall([A], [3, 5], [6, 5], 1.5)).toBeNull();
  });
});

describe("polygons", () => {
  it("area and containment", () => {
    expect(polyArea(A.points)).toBe(100);
    expect(pointInPoly([5, 5], A.points)).toBe(true);
    expect(pointInPoly([15, 5], A.points)).toBe(false);
  });
  it("rays find the wall", () => {
    expect(rayToPoly([5, 5], [1, 0], A.points)).toBeCloseTo(5);
    expect(rayToPoly([5, 5], [0, -1], A.points)).toBeCloseTo(5);
  });
});

describe("setEdgeLength", () => {
  it("stretches a rectangle by moving its far side", () => {
    const r = setEdgeLength(A, 0, 12.5); // top edge, west to east
    expect(r.points).toEqual([[0, 0], [12.5, 0], [12.5, 10], [0, 10]]);
  });
  it("works going against the axis", () => {
    const r = setEdgeLength(A, 3, 14); // west edge, running north from (0,10) to (0,0)
    expect(r.points).toEqual([[0, -4], [10, -4], [10, 10], [0, 10]]);
  });
  it("keeps an L-shaped room square", () => {
    const L: Room = { ...A, points: [[0, 0], [10, 0], [10, 5], [6, 5], [6, 10], [0, 10]] };
    const r = setEdgeLength(L, 0, 12);
    expect(r.points).toEqual([[0, 0], [12, 0], [12, 5], [6, 5], [6, 10], [0, 10]]);
  });
});

describe("closetHost", () => {
  const rect = (id: string, kind: Room["kind"], x0: number, y0: number, x1: number, y1: number): Room =>
    ({ id, type: "room", kind, label: id, points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]] });
  const bed = rect("bed", "room", 0, 0, 14, 12);
  const inside = rect("in", "closet", 0, 9, 4, 12);
  const apart = rect("apart", "closet", 14.5, 0, 18, 4);

  it("finds the room a closet was drawn inside", () => {
    expect(closetHost(inside, [bed, inside, apart])?.id).toBe("bed");
  });

  it("finds the host of an L-shaped closet whose bounding-box centre is outside the room", () => {
    // An L-shaped room, with an L-shaped closet tucked into its inside corner. The closet's
    // bounding-box centre, (11, 6), falls in the part of the box the room doesn't cover.
    const room: Room = { id: "room", type: "room", kind: "room", label: "room",
      points: [[0, 0], [16, 0], [16, 4], [8, 4], [8, 12], [0, 12]] };
    const ell: Room = { id: "ell", type: "room", kind: "closet", label: "ell",
      points: [[6, 2], [16, 2], [16, 4], [8, 4], [8, 10], [6, 10]] };
    expect(closetHost(ell, [room, ell])?.id).toBe("room");
  });

  it("leaves a closet that is its own room, and anything that isn't a closet, alone", () => {
    expect(closetHost(apart, [bed, inside, apart])).toBeNull();
    expect(closetHost(rect("r", "room", 1, 1, 3, 3), [bed])).toBeNull();
  });
});

import { fixIds, type Doc } from "../model";
describe("fixIds", () => {
  it("gives repeated ids fresh ones and leaves clean plans alone", () => {
    const pt = (id: string, x: number) => ({ id, type: "point" as const, kind: "sensor" as const, label: "", x, y: 0 });
    const doc: Doc = { app: "home-designer", version: 1, name: "t", wall: 1,
      levels: [{ id: "l", title: "L", objects: [pt("a", 0), pt("a", 1), pt("a", 2), pt("b", 3)] }] };
    const out = fixIds(doc);
    const ids = out.levels[0].objects.map((o) => o.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids[0]).toBe("a");
    expect(ids[3]).toBe("b");
    expect(fixIds(out)).toBe(out);
  });
});

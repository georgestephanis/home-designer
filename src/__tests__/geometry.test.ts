import { describe, expect, it } from "vitest";
import { pointInPoly, polyArea, rayToPoly, snapMarkToWall, wallSpan } from "../geometry";
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

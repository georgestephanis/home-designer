import { describe, expect, it } from "vitest";
import { AgentError, createAgentApi, markOnSide, type Bridge } from "../agent";
import { roomAt } from "../geometry";
import { blankDoc, type Doc, type Room } from "../model";

/** A Bridge over a plain undo stack, like the App's useHistory. */
function harness(start: Doc = blankDoc()) {
  const past: Doc[] = [], future: Doc[] = [];
  let doc = start, level = start.levels[0].id, commits = 0;
  const bridge: Bridge = {
    doc: () => doc,
    commit: (next) => { past.push(doc); future.length = 0; doc = next; commits++; },
    undo: () => { if (past.length) { future.unshift(doc); doc = past.pop()!; } },
    redo: () => { if (future.length) { past.push(doc); doc = future.shift()!; } },
    level: () => level,
    setLevel: (id) => { level = id; },
    load: () => {},
  };
  return { api: createAgentApi(bridge), doc: () => doc, commits: () => commits };
}

describe("homeDesigner API", () => {
  it("adds a room, a closet with its own walls, and a door that opens inward, undoably", () => {
    const h = harness();
    const bed = h.api.addRoom({ label: "Bedroom", x: 20, y: 0, w: 12, h: 10 });
    const closet = h.api.addCloset({ room: "bedroom", spot: "ne", w: 4, h: 2 });
    expect(closet.points).toEqual([[28, 0], [32, 0], [32, 2], [28, 2]]);
    expect(closet.kind).toBe("closet");
    expect(roomAt(h.doc().levels[0].objects.filter((o) => o.id !== closet.id), [30, 1])?.id).toBe(bed.id);

    const door = h.api.addOnWall("door", { room: "Bedroom", side: "s", at: 3 });
    expect([door.a, door.b].map((p) => p[1])).toEqual([10, 10]);
    expect(Math.min(door.a[0], door.b[0])).toBeCloseTo(21.5);
    // Swing 1 opens to the left of a→b: on the south wall, left must point north (into the room).
    const n = [door.b[1] - door.a[1], -(door.b[0] - door.a[0])];
    expect(n[1]).toBeLessThan(0);

    expect(h.commits()).toBe(3);
    h.api.undo();
    expect(h.api.find({ type: "mark" })).toHaveLength(0);
    h.api.redo();
    expect(h.api.find({ type: "mark" })).toHaveLength(1);
  });

  it("makes a batch one undo step, and applies none of it if it throws", () => {
    const h = harness();
    h.api.batch((hd) => {
      hd.addRoom({ label: "Kitchen", x: 0, y: 0, w: 10, h: 10 });
      hd.addOnWall("window", { room: "Kitchen", side: "e" });
      hd.addItem({ catalog: "Fridge", room: "Kitchen", spot: "nw" });
    });
    expect(h.commits()).toBe(1);
    expect(h.api.levels()[0].counts).toEqual({ room: 1, mark: 1, item: 1 });

    expect(() => h.api.batch((hd) => {
      hd.addRoom({ label: "Den", x: 20, y: 0, w: 10, h: 10 });
      hd.addOnWall("door", { room: "Nowhere", side: "n" });
    })).toThrow(/no room "Nowhere"/);
    expect(h.commits()).toBe(1);
    expect(h.api.find({ label: "Den" })).toHaveLength(0);
  });

  it("places catalogue furniture at its real size, inside the room", () => {
    const h = harness();
    h.api.addRoom({ label: "Bedroom", x: 0, y: 0, w: 12, h: 12 });
    const bed = h.api.addItem({ catalog: "queen bed", room: "Bedroom", spot: "w" });
    expect([bed.w, bed.h]).toEqual([5, 80 / 12]);
    expect(bed.cx - bed.w / 2).toBeGreaterThanOrEqual(0);
  });

  it("binds points to entities, finds them, and moves them between rooms", () => {
    const h = harness();
    h.api.addRoom({ label: "Hall", x: 0, y: 0, w: 4, h: 10 });
    h.api.addRoom({ label: "Den", x: 5, y: 0, w: 10, h: 10 });
    const p = h.api.addPoint({ kind: "sensor", label: "Motion", room: "Hall", entity: "binary_sensor.hall" });
    expect(h.api.find({ entity: "binary_sensor.hall" }).map((o) => o.id)).toEqual([p.id]);
    h.api.place(p.id, { room: "Den", spot: "se" });
    expect(h.api.at(...([(h.api.get(p.id) as typeof p).x, (h.api.get(p.id) as typeof p).y] as [number, number]))?.label).toBe("Den");
  });

  it("explains bad input instead of half-applying it", () => {
    const h = harness();
    expect(() => h.api.addRoom({ label: "X", kind: "bedroom" as never, x: 0, y: 0, w: 1, h: 1 })).toThrow(/room kind is one of: room, hall/);
    expect(() => h.api.update("nope", { label: "x" })).toThrow(AgentError);
    const r = h.api.addRoom({ label: "Den", x: 0, y: 0, w: 10, h: 10 });
    expect(() => h.api.update(r.id, { type: "item" } as never)).toThrow(/can't change an object's type/);
    expect(() => h.api.addOnWall("garage", { room: "Den", side: "n", width: 12 })).toThrow(/doesn't fit/);
    expect(() => h.api.setWall(0)).toThrow();
    expect(() => h.api.level("attic")).toThrow(/levels are: floor1/);
    expect(() => h.api.entities()).toThrow(/inside Home Assistant/);
    expect(h.commits()).toBe(1);
  });

  it("hands out copies, so changing a result doesn't change the plan", () => {
    const h = harness();
    const r = h.api.addRoom({ label: "Den", x: 0, y: 0, w: 10, h: 10 });
    r.points[0][0] = 99;
    (h.api.doc().levels[0].objects[0] as Room).label = "Changed";
    expect(h.api.get(r.id)).toMatchObject({ label: "Den", points: [[0, 0], [10, 0], [10, 10], [0, 10]] });
  });

  it("sets the wall thickness and exports an SVG that carries the plan", () => {
    const h = harness();
    h.api.setWall(0.5);
    h.api.addRoom({ label: "Den", x: 0, y: 0, w: 10, h: 10 });
    expect(h.doc().wall).toBe(0.5);
    expect(h.api.exportSvg()).toContain('"label":"Den"');
  });
});

describe("markOnSide", () => {
  const room: Room = { id: "r", type: "room", kind: "room", label: "R", points: [[0, 0], [10, 0], [10, 8], [0, 8]] };
  it("centres by default and clamps to the wall", () => {
    expect(markOnSide(room, "window", "w")).toMatchObject({ a: [0, 2.5], b: [0, 5.5] });
    expect(markOnSide(room, "window", "n", 0.2)).toMatchObject({ a: [0, 0], b: [3, 0] });
  });
});

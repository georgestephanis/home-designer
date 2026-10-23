import { describe, expect, it } from "vitest";
import { litRooms } from "../render";
import { boundEntities } from "../host";
import type { Obj } from "../model";

const room = (id: string, x0: number, x1: number): Obj =>
  ({ id, type: "room", kind: "room", label: id, points: [[x0, 0], [x1, 0], [x1, 10], [x0, 10]] });
const light = (id: string, x: number, entity?: string): Obj =>
  ({ id, type: "point", kind: "device", label: id, x, y: 5, entity });

describe("litRooms", () => {
  const objs = [room("a", 0, 10), room("b", 10, 20), light("l1", 3, "light.one"), light("l2", 7, "light.two"),
    light("l3", 15, "light.three"), light("s", 16, "switch.fan"), light("x", 30, "light.outside")];

  it("lights the room each light that's on sits in, counting them", () => {
    const lit = litRooms(objs, { "light.one": "on", "light.two": "on", "light.three": "off" });
    expect(lit.map((l) => [l.room.id, l.n])).toEqual([["a", 2]]);
  });

  it("ignores switches and lights outside every room", () => {
    expect(litRooms(objs, { "switch.fan": "on", "light.outside": "on" })).toEqual([]);
  });

  it("follows a light that's moved into another room", () => {
    const moved = objs.map((o) => (o.id === "l3" ? { ...o, x: 5 } : o));
    expect(litRooms(moved, { "light.three": "on" }).map((l) => l.room.id)).toEqual(["a"]);
  });

  it("lists each placed entity once", () => {
    expect(boundEntities([...objs, light("dup", 4, "light.one"), light("none", 4)]))
      .toEqual(["light.one", "light.outside", "light.three", "light.two", "switch.fan"]);
  });
});

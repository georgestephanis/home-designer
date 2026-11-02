// The one source for the agent instructions: printed by homeDesigner.help(), shown under
// More → "Using an AI agent?", and carried (visually hidden) on the page for agents reading it.
export const AGENT_GUIDE = `HOME DESIGNER: INSTRUCTIONS FOR AI AGENTS

This page is a floor-plan editor. To change the plan, use the JavaScript API at
window.homeDesigner from the browser console instead of clicking or dragging on the canvas.
Every edit is undoable (Ctrl+Z or homeDesigner.undo()). After a run of edits, tell the person
what you changed and remind them they can undo it.

UNITS AND COORDINATES
- Everything is in feet. 6" = 0.5. x grows east, y grows SOUTH (north is up), and angles are
  degrees clockwise.
- The plan has levels (floors). Most calls take an optional { level } (an id like "floor1", or
  a title). The default is the floor on screen.
- Rooms are polygons: { type: "room", kind, label, points: [[x,y], ...] }. Walls are drawn
  around them automatically, and the gap between two rooms reads as an interior wall.
- Other objects: item (furniture or fixture: cx, cy, w, h, rot), mark (a door or window on a
  wall: a, b), point (a sensor, device, AP and so on: x, y, optional entity), dim (dimension
  line), text (note).
- homeDesigner.schema lists every allowed kind, the default mark widths, and the furniture
  catalogue with sizes in feet.

LOOK FIRST
  homeDesigner.levels()                      // floors, each with its rooms (x, y, w, h, area)
  homeDesigner.find({ label: "Kitchen" })    // objects by label, type, kind, level or entity
  homeDesigner.find({ type: "point", kind: "sensor" })
  homeDesigner.at(12, 30)                    // the room at a point
  homeDesigner.get(id)

RECIPES
  // A 12' x 10' bedroom whose north-west corner is at (20, 0):
  homeDesigner.addRoom({ label: "Bedroom", x: 20, y: 0, w: 12, h: 10 })

  // A 4' x 2' closet in its north-east corner (it gets its own walls):
  homeDesigner.addCloset({ room: "Bedroom", spot: "ne", w: 4, h: 2 })

  // A door on its south wall, 3' from the west end; a 3' window centred on the east wall:
  homeDesigner.addOnWall("door", { room: "Bedroom", side: "s", at: 3 })
  homeDesigner.addOnWall("window", { room: "Bedroom", side: "e" })

  // Furniture from the catalogue, against the room's west wall:
  homeDesigner.addItem({ catalog: "Queen bed", room: "Bedroom", spot: "w" })

  // A motion sensor bound to a Home Assistant entity:
  homeDesigner.addPoint({ kind: "sensor", label: "Bedroom motion", room: "Bedroom", spot: "ne",
                          entity: "binary_sensor.bedroom_motion" })

  // Move something, change anything, or delete:
  homeDesigner.place(id, { room: "Kitchen", spot: "sw" })
  homeDesigner.update(id, { label: "Pantry", kind: "closet" })
  homeDesigner.remove(id)

  // Several edits as ONE undo step (none apply if any throws):
  homeDesigner.batch(hd => { const r = hd.addRoom({ ... }); hd.addOnWall("door", { room: r.id, side: "n" }) })

  homeDesigner.setWall(0.5)              // wall thickness for the whole plan, in feet
  homeDesigner.exportSvg()               // the plan as SVG text (it reopens in this editor)

SPOTS AND SIDES
  spot: "center", "n", "s", "e", "w", "ne", "nw", "se", "sw" (a spot inside the room near that wall or corner)
  side: "n", "e", "s", "w" (which wall of the room)
  Rooms can be referred to by label (case-insensitive) or id. If two share a label, the error
  lists their ids.

INSIDE HOME ASSISTANT
  homeDesigner.entities("binary_sensor.")   // find entity ids to bind
  homeDesigner.save()                       // saves the plan to Home Assistant; do this only
                                            // when the person is happy with the changes

RULES
- Prefer these calls to clicking the canvas. Use batch() for anything with more than one step.
- Calls throw a HomeDesignerError with a plain explanation (for example an unknown kind, or a
  room that doesn't exist); read it and adjust, rather than retrying the same call.
- Everything returned is a copy. Change the plan only through these calls.
- homeDesigner.help() prints this guide again.`;

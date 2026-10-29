# Home Designer

A floor-plan editor that runs entirely in the browser. Draw rooms, doors and windows to real
measurements, drag furniture around, measure anything, and save the result as an SVG you can open
again later, or view in any browser or vector editor. Nothing is uploaded anywhere.

![Floor plan editor](docs/screenshot.png)

## What it does

- **Rooms:** drag out a rectangle, or click corner by corner for any shape. Type exact sizes
  (`12' 6"`, `6 1/2"`, `3.5`, `1.2m`) or drag a wall or corner. Walls are drawn around the rooms
  automatically. Turn on **Room sizes** to label every room with its dimensions.
- **Doors and windows:** click a wall to drop one at a standard width (a 3′ door, a 6′ slider…),
  or drag along the wall for an exact width. Drag them along the wall or onto another wall, drag
  either end to resize, or type a width and position.
- **Door swings:** a door is drawn with its leaf and swing arc, opening into the room it was put
  in. Choose the hinge end and use **Flip hinge** / **Flip swing**, or press <kbd>R</kbd> to step
  through all four ways it can hang. Set the hinge to *None* for a plain door line.
- **Furniture:** about forty common pieces at standard sizes (beds, sofas, desks, kitchen and bath
  fixtures, appliances). Click or drag one in, then move, resize or rotate it. While a piece is
  selected, dimension lines show the gap to each wall, and its sides stick to walls as you drag.
- **Measurements:** the **Measure** tool leaves dimension lines that snap to corners. Selecting a
  room shows the length of every wall.
- **Floors:** any number of levels, with a faded **Floor below** overlay for lining up stairs
  and windows between floors.
- **Devices:** lights, Wi-Fi APs, thermostats, and presence sensors with an adjustable field of
  view, for planning smart-home coverage.
- **Files:**
  - **Save** writes an SVG with the whole project embedded, so it reopens exactly as it was
    left. In Chrome and Edge it saves straight back to the file you opened.
  - **Open** takes those SVGs, project `.json` files, or plain SVG floor plans; imported shapes
    become rooms. Dropping a file on the window opens it too.
  - Your work is kept as a draft in this browser between visits.
- **Print:** one floor per page, every page at the same standard scale (¼″ = 1′, ⅛″ = 1′…) with
  the plan in the same spot, so you can flip between floors and measure off the paper. Each page
  has a scale bar, a north arrow, an optional 1′ grid and a ruled box for notes taken on site.
  Pick the paper and the floors; the orientation and scale are chosen to fit. Print at 100%.

Shortcuts: <kbd>V</kbd> select, <kbd>B</kbd> room, <kbd>W</kbd> door/window, <kbd>M</kbd> measure,
<kbd>T</kbd> note, <kbd>R</kbd> rotate 90° (or turn a door), <kbd>F</kbd> fit, <kbd>G</kbd> grid, arrows nudge
(<kbd>Shift</kbd> for a foot), <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd>, <kbd>Ctrl</kbd>+<kbd>D</kbd>
duplicate, <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd>, <kbd>Ctrl</kbd>+<kbd>S</kbd> save, <kbd>Ctrl</kbd>+<kbd>P</kbd> print.
<kbd>Shift</kbd> keeps lines straight and adds to the selection, and <kbd>Alt</kbd> turns off snapping.

## In Home Assistant

The same editor also runs inside Home Assistant as an integration (`custom_components/home_designer`).
The plan is kept in Home Assistant, so it's included in its backups. You can place any of your
entities on it, then show it on a dashboard where everything is live.

- **Floor plan** in the sidebar (admins only) is the editor. Select a device or a piece of
  furniture and choose its **Home Assistant entity**. **Save** stores the plan in Home
  Assistant, and every open dashboard updates straight away. The last 20 saved versions are kept
  in `.storage/home_designer.history`.
- **The Floor plan card** (`custom:home-designer-card`) shows the plan with floor tabs. Each
  placed entity gets Home Assistant's own state icon:
  - Tap a light, switch or fan to toggle it.
  - Tap anything else, or press and hold, to see its details.
  - A room glows while a light inside it is on, so moving a light on the plan moves its glow.

  ```yaml
  type: custom:home-designer-card
  default_level: floor1   # floor to open on (optional)
  # level: floor2         # show only this floor, with no tabs
  # title: House
  ```

  It suits a **Panel** view, which gives one card the whole page.

**Install:**
1. Copy `custom_components/home_designer` into your Home Assistant's `custom_components` folder,
   or add this repository to HACS as a custom integration repository.
2. Restart Home Assistant.
3. Add **Home Designer** under Settings → Devices & services.

The built frontend (`custom_components/home_designer/frontend/home-designer.js`) is committed,
so no build step is needed. After changing anything in `src/`, rebuild it with
`npm run build:ha`.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (units, geometry, doors, SVG save/load/import)
npm run build      # static site in dist/
npm run build:ha   # the Home Assistant panel and card, into custom_components/home_designer/frontend/
```

The build is a plain static site with relative paths, so `dist/` can be served from any folder or
static host.

## How it's put together

| File | What it does |
|---|---|
| `src/model.ts` | The document: levels of rooms, items, marks (doors/windows), points, dimensions and notes, all in feet |
| `src/render.tsx` | Draws a level. Shared by the editor and SVG export, so a saved file looks like the editor |
| `src/Canvas.tsx` | Pan/zoom, selection, dragging, resizing, rotating, drawing and live measurements |
| `src/Inspector.tsx` | The selection panel, with feet-and-inches fields |
| `src/svgio.ts` | Save to SVG (project embedded in `<metadata>`), open SVG/JSON, import plain SVGs |
| `src/units.ts` | Parsing and formatting lengths |
| `src/catalog.ts` | Furniture sizes |
| `src/samples/sample.json` | The sample house it opens with |
| `src/host.ts` | What the editor needs from a host that keeps the plan (Home Assistant) instead of files |
| `src/ha/` | The Home Assistant build: the panel element, the dashboard card, and the websocket calls |
| `custom_components/home_designer/` | The Home Assistant integration: stores the plan, serves the frontend, adds the panel |

Coordinates are in feet with north up and y growing southward. Rooms are stored by their inside
faces, and wall thickness is drawn outward from them.

## License

[GPL-3.0-or-later](LICENSE). Copyright © 2026 George Stephanis.

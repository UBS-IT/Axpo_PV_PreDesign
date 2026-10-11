# Notes for the design session (APP UI-UX DESIGN)

Written on 2026-10-11 by the session that built the ribbon workspace of PV Predesign from the design system
(`APP UI-UX DESIGN/design-system`, artifact D3MDZTYvmucJaXkXn4qULa). The design files belong to the design session:
this note asks, it changes nothing there.

1. **Icons of the drawing tools.** The set has `polygon` but no point, line, rectangle, circle or freehand icon. The
   app draws its own in the same 1.6 stroke (`app/js/areas.js`, `TOOL_SVG`): a point with four ticks, a polyline with
   vertex dots, a rounded rectangle, a circle with its centre, a freehand squiggle. Adopting them in the set (or
   drawing better ones) would let the app use the sprite like everywhere else.
2. **The tick of the active tab** is a text glyph in the kit; the app draws it in CSS. A small icon would match the
   rest.
3. **StatusBar README**: it says the CRS select changes the display only and the exports keep the system of Report.
   In the app the select is the system of the exports (decision of phase 1B, 2026-10-10): one system for what the
   designer reads and what leaves the app. The README could say either is possible, or follow the app.
4. **Search placeholder** of the mockup: «Search a place, parcel or object…». The app searches the objects of the
   project with Ctrl K (top centre) and addresses or coordinates with a separate magnifier top right (Nominatim);
   parcels are the Geoportale's job. The mockup could show the two boxes.
5. **No menu component** in the kit: the app's category menu, search results and right-click menu («Zoom to» on a
   row of the Layers panel) reuse the list of the category menu (`.catlist` in `app/css/shell.css`). A Menu /
   Listbox component would give them one look.
6. **3D overlays**: the Workspace mockup does not show the 3D mode. In the app the 3D card takes the top left corner,
   the scene's controls sit to its right and the Daylight widget is inside the card; the 2D / 3D chips stay alone top
   right. A 3D state in the mockup would fix the pattern.
7. **Messages (Toast)**: the app shows them at the bottom left of the map, each with a ×, because the bottom right
   holds the basemap stack. The Toast card could show the × and the corner.

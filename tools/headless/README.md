# Headless test runner

Runs every browser test page in headless Chromium (Playwright) and prints the results — also on machines whose
network policy blocks `js.arcgis.com` (e.g. a cloud session): the ArcGIS Maps SDK 4.34 is bundled from npm
(`build.mjs`) and served in its place (`page.mjs`). The other libraries are part of the app (`app/vendor`).

It also builds those vendored libraries: `npm run vendor` writes JSZip, togeojson, shpjs, geotiff, jsPDF and sql.js (with its .wasm) into
`app/vendor/` as minified ES modules of the versions in `package-lock.json`, with `versions.json` and the licenses.
The output is deterministic and CI fails if it differs from the committed files. To update a library: change its
version in `package.json`, `npm install`, `npm run vendor`, run the tests, commit `app/vendor` with the lock file.

```
cd tools/headless
npm install          # @arcgis/core 4.34, the libraries, esbuild
npm run vendor       # only after changing a library version: rewrites app/vendor
npm run build        # bundles into dist/ (rebuild after adding an SDK module to app/js/sdk.js)
npm test             # all pages, or: node run.mjs /tests/terrain.html
```

Playwright comes from a global install (`npm i -g playwright`) or a local one. `VERBOSE=1` prints the note of every
test, not only the failures.

Known limit: a MapView does not start with the npm bundle (its 2D workers do not come up), so the page of the app
itself must be checked in a real browser. `tests/ui.html` mounts the real panels on a stand-in view instead.

The SceneView of step 4b does run: `tests/scene3d.html` is opened with software WebGL (SwiftShader, which the SDK
refuses by default; `openPage(…, { softwareWebGL: true })` lifts that). `node snap3d.mjs <folder>` saves screenshots of
that scene, to look at it without a browser.

`make_terrain_fixture.mjs` writes the synthetic GeoTIFF of the terrain tests (`tests/fixtures/it_dtm_plane.tif`).

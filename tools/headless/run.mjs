// Runs the browser test pages headless (Chromium through Playwright) and prints the results.
// The ArcGIS Maps SDK comes from the local bundle of build.mjs (see page.mjs), so the tests also run on machines whose
// network policy blocks js.arcgis.com. Usage: node run.mjs [page ...] (default: every page).
// While a page runs, its progress is printed once a minute (the status line of the page and the tests already done);
// when a page times out, the tests it finished, the test it was in and its last console messages are printed, so that
// a red run says where the page stopped instead of only «timed out». A page also fails on an uncaught error of the
// browser (release gate P1 of CLAUDE.md, phase 6 of the ribbon plan); console.error messages are printed, not counted
// (the maps of Esri log network noise on the runners).
import { openPage, shutdown } from './page.mjs';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['/tests/', '/tests/modules.html', '/tests/sdk.html', '/tests/import.html', '/tests/terrain.html', '/tests/infra.html', '/tests/view3d.html', '/tests/ui.html', '/tests/scene3d.html'];
const wait = ms => new Promise(r => setTimeout(r, ms));
// the status line of the page and the tests it has finished (scene3d.html publishes them as they come: __progress)
const progressOf = page => page.evaluate(() => ({
  sum: (document.getElementById('sum')?.textContent || '').trim().slice(0, 200),
  done: (window.__results || window.__progress || []).map(r => `${r.ok ? 'PASS' : 'FAIL'} ${r.name}`),
})).catch(e => ({ sum: `(page not readable: ${e.message})`, done: [] }));

let failed = 0;
for (const pg of pages) {
  const { page, errors, log, close } = await openPage(pg, { softwareWebGL: /scene3d/.test(pg) });
  // the real SceneView drawn by the software WebGL of the runner takes minutes and varies with the machine: the
  // same budget as snap3d.mjs (it timed out at 4 minutes on one of two runs of the same commit, 2026-10-02)
  const budget = /scene3d/.test(pg) ? 600000 : 240000, t0 = Date.now();
  let done = false, lastBeat = t0;
  while (!done && Date.now() - t0 < budget) {
    done = await page.evaluate(() => !!window.__results || /passed/.test(document.getElementById('sum')?.textContent || '')).catch(() => false);
    if (done) break;
    if (Date.now() - lastBeat >= 60000) {   // a heartbeat once a minute
      lastBeat = Date.now();
      const p = await progressOf(page);
      console.log(`  … ${pg} at ${Math.round((Date.now() - t0) / 1000)} s: «${p.sum}», ${p.done.length} test(s) done${p.done.length ? ` (last: ${p.done.at(-1)})` : ''}`);
    }
    await wait(1000);
  }
  if (done) {
    const rows = await page.$$eval('#out tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    const sum = (await page.textContent('#sum')).trim();
    console.log(`${pg}: ${sum} (${Math.round((Date.now() - t0) / 1000)} s)`);
    for (const r of rows) if (!r.startsWith('PASS') || process.env.VERBOSE) console.log('   ', r);
    if (!/^(\d+) \/ \1 passed/.test(sum)) failed++;
  } else {
    const p = await progressOf(page);
    console.log(`${pg}: timed out after ${budget / 1000} s, at «${p.sum}» with ${p.done.length} test(s) done`);
    for (const d of p.done) console.log('    done:', d);
    console.log('    last console messages:');
    for (const l of log.slice(-20)) console.log('     ', l);
    failed++;
  }
  for (const e of errors) console.log('    page error:', e);
  const uncaught = errors.filter(e => !e.startsWith('console: '));
  if (uncaught.length) { console.log(`    ${uncaught.length} uncaught error(s): the page fails`); failed++; }
  await close();
}
await shutdown();
process.exit(failed ? 1 : 0);

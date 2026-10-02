// Runs the browser test pages headless (Chromium through Playwright) and prints the results.
// The ArcGIS Maps SDK comes from the local bundle of build.mjs (see page.mjs), so the tests also run on machines whose
// network policy blocks js.arcgis.com. Usage: node run.mjs [page ...] (default: every page).
import { openPage, shutdown } from './page.mjs';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['/tests/', '/tests/modules.html', '/tests/sdk.html', '/tests/import.html', '/tests/terrain.html', '/tests/infra.html', '/tests/view3d.html', '/tests/ui.html', '/tests/scene3d.html'];
let failed = 0;
for (const pg of pages) {
  const { page, errors, close } = await openPage(pg, { softwareWebGL: /scene3d/.test(pg) });
  try {
    // the real SceneView drawn by the software WebGL of the runner takes minutes and varies with the machine: the
    // same budget as snap3d.mjs (it timed out at 4 minutes on one of two runs of the same commit, 2026-10-02)
    await page.waitForFunction(() => window.__results || /passed/.test(document.getElementById('sum')?.textContent || ''), null, { timeout: /scene3d/.test(pg) ? 600000 : 240000 });
    const rows = await page.$$eval('#out tr', trs => trs.map(t => t.innerText.replace(/\s+/g, ' ').trim()));
    const sum = (await page.textContent('#sum')).trim();
    console.log(`${pg}: ${sum}`);
    for (const r of rows) if (!r.startsWith('PASS') || process.env.VERBOSE) console.log('   ', r);
    if (!/^(\d+) \/ \1 passed/.test(sum)) failed++;
  } catch { console.log(`${pg}: timed out`); failed++; }
  for (const e of errors) console.log('    page error:', e);
  await close();
}
await shutdown();
process.exit(failed ? 1 : 0);

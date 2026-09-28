// Runs the browser test pages headless (Chromium through Playwright) and prints the results.
// CDN libraries come from the local bundles of build.mjs (see page.mjs), so the tests also run on machines whose
// network policy blocks js.arcgis.com / cdn.jsdelivr.net. Usage: node run.mjs [page ...] (default: every page).
import { openPage, shutdown } from './page.mjs';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['/tests/', '/tests/modules.html', '/tests/sdk.html', '/tests/import.html', '/tests/terrain.html', '/tests/infra.html', '/tests/ui.html'];
let failed = 0;
for (const pg of pages) {
  const { page, errors, close } = await openPage(pg);
  try {
    await page.waitForFunction(() => window.__results || /passed/.test(document.getElementById('sum')?.textContent || ''), null, { timeout: 240000 });
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

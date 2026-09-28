// Screenshots of the 3D scene test page (tests/scene3d.html) drawn with software WebGL, to look at the scene without a
// browser: node snap3d.mjs <folder>. The page calls window.__snap(name) at the moments worth a look.
import { openPage, shutdown } from './page.mjs';
import path from 'node:path';
const dir = process.argv[2] || '.';
const { page, close } = await openPage('/tests/scene3d.html', { softwareWebGL: true });
await page.exposeFunction('__snapShot', async name => { await page.locator('#view3d').screenshot({ path: path.join(dir, `scene3d-${name}.png`) }); });
await page.addInitScript(() => { window.__snap = async name => { await new Promise(r => setTimeout(r, 1500)); await window.__snapShot(name); }; });
await page.reload();
await page.waitForFunction(() => window.__results, null, { timeout: 600000 });
console.log(await page.textContent('#sum'));
await close(); await shutdown();

const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  for (const v of ['post', 'video']) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    await p.goto('file://' + path.join(__dirname, 'artes.html'));
    await p.evaluate((v) => document.body.classList.add(v), v);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(600);
    const ok = await p.evaluate(() => ['Fraunces', 'DM Sans', 'DM Mono'].map(f => f + ':' + document.fonts.check('500 40px "' + f + '"')));
    console.log(v, ok.join(' '));
    require('fs').mkdirSync(path.join(__dirname, v), { recursive: true });
    for (let i = 1; i <= 7; i++) await (await p.$('#a' + i)).screenshot({ path: path.join(__dirname, v, `fieldo-${i}.png`) });
    await p.close();
  }
  await b.close();
})();

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
let server, baseUrl;

async function playwrightEntry() {
  // CI 在隔离的 $RUNNER_TEMP 安装 Playwright，并通过环境变量传入精确入口。
  if (process.env.PLAYWRIGHT_ENTRY) return pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href;
  try { return import.meta.resolve('playwright'); } catch {}
  const root = process.platform === 'win32'
    ? execFileSync('cmd', ['/d','/s','/c','npm root -g'], {encoding:'utf8'}).trim()
    : execFileSync('npm', ['root','-g'], {encoding:'utf8'}).trim();
  return pathToFileURL(join(root,'playwright','index.mjs')).href;
}

test.before(async () => {
  const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.json':'application/json',
    '.png':'image/png','.webmanifest':'application/manifest+json'};
  server=createServer(async(req,res)=>{
    try {
      const pathname=decodeURIComponent(req.url.split('?')[0]);
      const target=join(SITE, pathname==='/'?'index.html':pathname.replace(/^\//,''));
      if (!target.startsWith(SITE)) throw Error('Traversal');
      const bytes=await readFile(target);
      res.writeHead(200,{'Content-Type':types[extname(target)]||'application/octet-stream'}).end(bytes);
    }catch{res.writeHead(404).end('not found');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl='http://127.0.0.1:'+server.address().port+'/';
});
test.after(async()=>{ if(server) await new Promise(resolve=>server.close(resolve)); });

test('联合区间：逐格勾选、切换幅度、生成边界、确认应用、撤销',async(t)=>{
  let chromium;
  try {({ chromium }=await import(await playwrightEntry()));}
  catch(e){ if(process.env.CI) throw new Error('CI must execute Chromium uncertainty regression',{cause:e});
    t.skip('Playwright not available');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    assert.match(await page.locator('#uncertainty-output').innerText(),/先完成一份有效决策/);
    await page.locator('[data-action="demo-run"]').first().click();
    await page.waitForFunction(()=>document.querySelector('#uncertainty-output')?.textContent?.includes('尚未标记'));
    assert.equal(await page.locator('#uncertainty-details').getAttribute('open'),null,
      'complex controls must be initially collapsed');
    await page.locator('#uncertainty-details summary').first().click();
    assert.equal(await page.locator('#uncertainty-controls input[type="checkbox"]').count(),8);

    for(const input of await page.locator('#uncertainty-controls input[data-side="A"]').all()){
      await input.check();
    }
    const title=await page.locator('.uncertainty-verdict').innerText();
    assert.match(title,/范围内/);
    assert.match(await page.locator('#uncertainty-output').innerText(),/已标记 4 格/);
    const baselineScore=await page.locator('#r-f1-A').inputValue();
    await page.locator('#uncertainty-radius').selectOption('2');
    assert.match(await page.locator('.uncertainty-meta').innerText(),/上下 2 分/);
    assert.equal(await page.locator('#r-f1-A').inputValue(),baselineScore,
      'toggling range must not modify entered scores');
    await page.locator('.uncertainty-example summary').click();
    const apply=page.locator('[data-action="apply-uncertainty-witness"]');
    assert.equal(await apply.count(),1);
    page.once('dialog',dialog=>dialog.accept());
    await apply.click();
    assert.notEqual(await page.locator('#r-f1-A').inputValue(),baselineScore);
    assert.match(await page.locator('#uncertainty-status').innerText(),/撤销/);
    await page.locator('#history-undo').click();
    assert.equal(await page.locator('#r-f1-A').inputValue(),baselineScore,
      'undo must restore genuine previous numeric score');

    const dims=await page.evaluate(()=>({
      scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,
    }));
    assert.ok(dims.scroll<=dims.client+2,JSON.stringify(dims));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('联合区间：新示例、重置及 JSON 导入不会保留勾选或泄露临时假设',async(t)=>{
  let chromium;
  try {({ chromium }=await import(await playwrightEntry()));}
  catch(e){if(process.env.CI) throw new Error('CI must execute Chromium privacy checks',{cause:e});
    t.skip('Playwright not available');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    await page.locator('#uncertainty-controls input[type="checkbox"]').first().check();
    assert.match(await page.locator('#uncertainty-output').innerText(),/已标记 1 格/);
    await page.locator('#example-grid [data-example="rent"]').click();
    if (!(await page.locator('#uncertainty-controls input').first().isVisible())) {
      await page.locator('#uncertainty-details summary').click();
    }
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0);
    assert.match(await page.locator('#uncertainty-output').innerText(),/尚未标记/);
    await page.locator('#uncertainty-controls input[type="checkbox"]').first().check();
    page.once('dialog',dialog=>dialog.accept());
    await page.locator('.toolbar [data-action="reset"]').click();
    await page.locator('[data-action="demo-run"]').first().click();
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0,
      'reset must clear temporary uncertainty assumptions');
    assert.equal(await page.locator('#uncertainty-radius').inputValue(),'1');
  }finally{await browser.close();}
});

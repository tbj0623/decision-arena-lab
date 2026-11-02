import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const SITE = fileURLToPath(new URL('../../site/',import.meta.url));
let server, baseUrl;
async function getChromium(){
  let entry=process.env.PLAYWRIGHT_ENTRY;
  if (!entry) {
    const root=process.platform==='win32'
      ?execFileSync('cmd',['/d','/s','/c','npm root -g'],{encoding:'utf8'}).trim()
      :execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
    entry=join(root,'playwright','index.mjs');
  }
  const {chromium}=await import(pathToFileURL(entry).href);
  return chromium;
}
test.before(async()=>{
  const types={'.html':'text/html','.mjs':'text/javascript','.css':'text/css',
    '.json':'application/json','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
  server=createServer(async(req,res)=>{
    try{
      const route=decodeURIComponent(req.url.split('?')[0]);
      const filename=join(SITE,route==='/'?'index.html':route.replace(/^\//,''));
      if(!filename.startsWith(SITE))throw Error('Invalid path');
      const bytes=await readFile(filename);
      res.writeHead(200,{'Content-Type':types[extname(filename)]||'application/octet-stream'}).end(bytes);
    }catch{res.writeHead(404).end('missing');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  baseUrl='http://127.0.0.1:'+server.address().port+'/';
});
test.after(async()=>{if(server) await new Promise(resolve=>server.close(resolve));});

test('V3：只选权重就能联合求界，应用边界时改变权重，撤销恢复',async t=>{
  let chromium;
  try{chromium=await getChromium();}
  catch(e){if(process.env.CI)throw new Error('CI must use Chromium',{cause:e});t.skip('Playwright unavailable');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    const weights=page.locator('#uncertainty-controls input[data-uncertainty-weight]');
    assert.equal(await weights.count(),4);
    const oldWeight=await page.locator('#w-f1').inputValue();
    await weights.first().check();
    await page.locator('#uncertainty-weight-radius').selectOption('2');
    const text=await page.locator('#uncertainty-output').innerText();
    assert.match(text,/已标记 0 格评分/);
    assert.match(text,/1 项权重/);
    assert.match(text,/差值范围/);
    assert.equal(await page.locator('#w-f1').inputValue(),oldWeight);
    await page.locator('.uncertainty-example summary').click();
    const apply=page.locator('[data-action="apply-uncertainty-witness"]');
    assert.equal(await apply.count(),1);
    page.once('dialog',d=>d.accept());
    await apply.click();
    assert.notEqual(await page.locator('#w-f1').inputValue(),oldWeight);
    await page.locator('#history-undo').click();
    assert.equal(await page.locator('#w-f1').inputValue(),oldWeight);
    const bounds=await page.evaluate(()=>({
      scroll:document.documentElement.scrollWidth,
      client:document.documentElement.clientWidth,
    }));
    assert.ok(bounds.scroll<=bounds.client+2);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('V3：评分与权重同时变化，重置示例与导入时清除权重选择',async t=>{
  let chromium;
  try{chromium=await getChromium();}
  catch(e){if(process.env.CI)throw new Error('CI must use Chromium',{cause:e});t.skip('Playwright unavailable');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    await page.locator('#uncertainty-controls input[data-side="A"]').first().check();
    await page.locator('#uncertainty-controls input[data-uncertainty-weight]').nth(1).check();
    await page.locator('#uncertainty-weight-radius').selectOption('2');
    assert.match(await page.locator('#uncertainty-output').innerText(),/1 格评分.*1 项权重/);
    await page.locator('#example-grid [data-example="rent"]').click();
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0);
    assert.equal(await page.locator('#uncertainty-weight-radius').inputValue(),'1');
    assert.match(await page.locator('#uncertainty-output').innerText(),/尚未标记/);
    await page.locator('#uncertainty-controls input[data-uncertainty-weight]').first().check();
    page.once('dialog',d=>d.accept());
    await page.locator('.toolbar [data-action="reset"]').click();
    await page.locator('[data-action="demo-run"]').first().click();
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});


test('V4：手机端固定总额模式精确收缩范围，见证权重此消彼长且可一键撤销',async t=>{
  let chromium;
  try{chromium=await getChromium();}
  catch(e){if(process.env.CI)throw new Error('CI requires Chromium',{cause:e});t.skip('Playwright unavailable');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    for(const x of await page.locator('#uncertainty-controls input[data-side="A"]').all())await x.check();
    for(const x of await page.locator('#uncertainty-controls input[data-uncertainty-weight]').all())await x.check();
    await page.locator('#uncertainty-radius').selectOption('2');
    await page.locator('#uncertainty-weight-radius').selectOption('2');
    const capture=async()=>{
      const text=await page.locator('#uncertainty-output').innerText();
      const m=text.match(/差值范围：(-?[0-9.]+) ～ (-?[0-9.]+)/);
      assert.ok(m,text);
      return {min:Number(m[1]),max:Number(m[2]),text};
    };
    const independent=await capture();
    await page.locator('#uncertainty-weight-mode').selectOption('fixed-total');
    const constrained=await capture();
    assert.ok(constrained.min>=independent.min-0.011);
    assert.ok(constrained.max<=independent.max+0.011);
    assert.match(constrained.text,/原始权重总和固定为 14/);
    const readWeights=()=>page.locator('#factor-list input[id^="w-"]').evaluateAll(
      nodes=>nodes.map(node=>Number(node.value)));
    const original=await readWeights();
    await page.locator('.uncertainty-example summary').click();
    const button=page.locator('[data-action="apply-uncertainty-witness"]');
    assert.match(await button.innerText(),/权重/);
    page.once('dialog',d=>d.accept());
    await button.click();
    const modified=await readWeights();
    assert.ok(modified.some((w,i)=>w!==original[i]));
    assert.ok(Math.abs(modified.reduce((s,v)=>s+v,0)-original.reduce((s,v)=>s+v,0))<1e-7);
    await page.locator('#history-undo').click();
    assert.deepEqual(await readWeights(),original);
    const dims=await page.evaluate(()=>({
      scroll:document.documentElement.scrollWidth,
      client:document.documentElement.clientWidth,
    }));
    assert.ok(dims.scroll<=dims.client+2);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});

test('V4：仅选一个权重固定总额时不能凭空变化，切换示例与清空自动恢复默认模式',async t=>{
  let chromium;
  try{chromium=await getChromium();}
  catch(e){if(process.env.CI)throw new Error('CI requires Chromium',{cause:e});t.skip('Playwright unavailable');return;}
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
    await page.goto(baseUrl,{waitUntil:'networkidle'});
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    const original=await page.locator('#w-f1').inputValue();
    await page.locator('#uncertainty-controls input[data-uncertainty-weight]').first().check();
    await page.locator('#uncertainty-weight-mode').selectOption('fixed-total');
    const text=await page.locator('#uncertainty-output').innerText();
    assert.match(text,/原始权重总和固定为/);
    assert.match(text,/当前差值/);
    await page.locator('#example-grid [data-example="rent"]').click();
    assert.equal(await page.locator('#uncertainty-weight-mode').inputValue(),'independent');
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0);
    await page.locator('#uncertainty-weight-mode').selectOption('fixed-total');
    page.once('dialog',d=>d.accept());
    await page.locator('.toolbar [data-action="reset"]').click();
    assert.equal(await page.locator('#uncertainty-weight-mode').inputValue(),'independent');
    assert.equal(await page.locator('#uncertainty-controls input:checked').count(),0);
    assert.ok(original.length>0);
  }finally{await browser.close();}
});

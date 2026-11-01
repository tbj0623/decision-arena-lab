import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SITE = join(ROOT, 'site');
let verifiedZipBytes = null;

function zipEntries(bytes) {
  const eocd=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  assert.ok(eocd>=0,'ZIP must have end central directory');
  const n=bytes.readUInt16LE(eocd+10);
  let offset=bytes.readUInt32LE(eocd+16);
  const names=new Set();
  for(let i=0;i<n;i++){
    assert.equal(bytes.readUInt32LE(offset),0x02014b50,'ZIP central directory header');
    const nameLen=bytes.readUInt16LE(offset+28);
    const extraLen=bytes.readUInt16LE(offset+30);
    const commentLen=bytes.readUInt16LE(offset+32);
    const name=bytes.subarray(offset+46,offset+46+nameLen).toString('utf8');
    assert.ok(!names.has(name),'ZIP duplicate entry '+name);
    names.add(name);
    offset+=46+nameLen+extraLen+commentLen;
  }
  return names;
}

async function* modules(folder) {
  for(const entry of await readdir(folder,{withFileTypes:true})){
    const file=join(folder,entry.name);
    if(entry.isDirectory()) yield* modules(file);
    else if(entry.isFile()&&extname(file)==='.mjs') yield file;
  }
}

test('正式 ZIP 包含网站真实引用的每个本地 ES module，不会漏掉原实验模块',async()=>{
  execFileSync(process.execPath,['scripts/make-release.mjs'],{
    cwd:ROOT,timeout:60_000,windowsHide:true,
  });
  const bytes=await readFile(join(ROOT,'dist','decision-arena-release.zip'));
  verifiedZipBytes = bytes;
  const names=zipEntries(bytes);
  assert.ok(names.size>=50);
  assert.ok(names.has('site/app.mjs'));
  assert.ok(names.has('site/features/uncertainty-workbench.mjs'));
  assert.ok(names.has('site/features/interval.mjs'),
    'V2.0 区间工作台依赖的核心 interval.mjs 必须包含在发行包内');
  for await(const file of modules(SITE)){
    const rel=relative(ROOT,file).split('\\').join('/');
    assert.ok(names.has(rel), 'production module missing in release ZIP: '+rel);
    const source=await readFile(file,'utf8');
    // 这里审查静态 import/export 和字面量 import()；动态计算 URL 应由单独测试验证。
    for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([.][^'"]+)['"]/g)){
      const target=resolve(dirname(file),match[1]);
      const dep=relative(ROOT,target).split('\\').join('/');
      assert.ok(dep.startsWith('site/'),'site dependency must remain inside static site: '+dep);
      assert.ok(names.has(dep), 'release ZIP is missing imported dependency: '+rel+' -> '+dep);
    }
  }
});


function zipFiles(bytes) {
  const eocd=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  if(eocd<0) throw new Error('No ZIP directory');
  const n=bytes.readUInt16LE(eocd+10);
  let offset=bytes.readUInt32LE(eocd+16);
  const files=new Map();
  for(let i=0;i<n;i++){
    const size=bytes.readUInt32LE(offset+24);
    const nameLen=bytes.readUInt16LE(offset+28);
    const extraLen=bytes.readUInt16LE(offset+30);
    const commentLen=bytes.readUInt16LE(offset+32);
    const compression=bytes.readUInt16LE(offset+10);
    assert.equal(compression,0,'release ZIP currently uses STORE');
    const name=bytes.subarray(offset+46,offset+46+nameLen).toString('utf8');
    const local=bytes.readUInt32LE(offset+42);
    assert.equal(bytes.readUInt32LE(local),0x04034b50);
    const start=local+30+bytes.readUInt16LE(local+26)+bytes.readUInt16LE(local+28);
    files.set(name,bytes.subarray(start,start+size));
    offset+=46+nameLen+extraLen+commentLen;
  }
  return files;
}

async function playwrightRuntime(){
  if(process.env.PLAYWRIGHT_ENTRY) return import(pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href);
  try { return await import('playwright'); } catch {}
  const root=process.platform==='win32'
    ? execFileSync('cmd',['/d','/s','/c','npm root -g'],{encoding:'utf8'}).trim()
    : execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  return import(pathToFileURL(join(root,'playwright','index.mjs')).href);
}

test('从官方 ZIP 内存直接启动网站：新工作台与撤销可在干净浏览器运行',async(t)=>{
  assert.ok(verifiedZipBytes,'first test must build release archive');
  let chromium;
  try {({chromium}=await playwrightRuntime());}
  catch(error){if(process.env.CI) throw new Error('Browser missing in CI',{cause:error});
    t.skip('Playwright not installed locally');return;}
  const files=zipFiles(verifiedZipBytes);
  const mime={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png',
    '.json':'application/json','.webmanifest':'application/manifest+json'};
  const server=createServer((req,res)=>{
    const requestPath=decodeURIComponent(req.url.split('?')[0]);
    const key='site/'+(requestPath==='/'?'index.html':requestPath.replace(/^\//,''));
    const data=files.get(key);
    if(!data){res.writeHead(404).end('not found: '+key);return;}
    res.writeHead(200,{'Content-Type':mime[extname(key)]||'application/octet-stream'}).end(data);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch();
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce'});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const res=await page.goto('http://127.0.0.1:'+server.address().port+'/',{
      waitUntil:'networkidle',
    });
    assert.equal(res.status(),200);
    await page.locator('[data-action="demo-run"]').first().click();
    await page.locator('#uncertainty-details summary').click();
    await page.locator('#uncertainty-controls input[data-side="A"]').first().check();
    assert.match(await page.locator('#uncertainty-output').innerText(),/已标记 1 格/);
    assert.deepEqual(errors,[],'standalone ZIP site must have no JS errors or missing imports');
  }finally{
    if(browser) await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
});

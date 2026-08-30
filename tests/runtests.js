const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  const errs=[];
  pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await pg.goto('file://'+TARGET, {waitUntil:'load'});
  await pg.waitForTimeout(1500);
  const out = await pg.evaluate(() => {
    if(typeof ns==='undefined') return {fatal:'ns undefined'};
    if(!ns.content) return {fatal:'ns.content missing (boot failed?)'};
    const r = ns.selftest.run(false);
    return { pass:r.pass, total:r.total,
             fails:r.results.filter(x=>!x.ok).map(x=>x.name+' :: '+x.detail),
             names:r.results.map(x=>(x.ok?'PASS ':'FAIL ')+x.name) };
  });
  console.log(JSON.stringify(out.fatal||{pass:out.pass,total:out.total},null,0));
  if(out.fails) out.fails.forEach(f=>console.log('  ❌ '+f));
  if(errs.length) console.log('--- page errors ---\n'+errs.slice(0,10).join('\n'));
  await b.close();
})();

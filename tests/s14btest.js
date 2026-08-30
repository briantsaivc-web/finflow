const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'});
  await pg.waitForTimeout(1200);
  const out = await pg.evaluate(() => {
    const ui=ns.ui, E=ns.engine;
    const R=[]; const ok=(n,c,d)=>R.push({n,ok:!!c,d:d||''});
    ui.startCore(9001, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"],
      [0,1,2].map(i=>({name:"P"+i,isNPC:i>0,personality:"NPC_SAFE",
        professionId:ns.content.professions[i].id, dreamCardId:ns.content.dreams[i].id})), {noRules:true});
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.render();

    // 1) 盤面上不該再出現「發薪」格
    const svgTxt=document.getElementById('boardSvg').textContent;
    ok('盤面已無發薪格', svgTxt.indexOf('發薪')<0, '盤面文字：'+svgTxt.replace(/\s+/g,'').slice(0,80));
    const BL=E.board(ui.S,false);
    ok('引擎盤面格數不變', BL.length===ns.content.boardLayout.length, BL.length+' 格');
    const kinds={}; BL.filter(x=>x.wasPayday).forEach(x=>kinds[x.type]=(kinds[x.type]||0)+1);
    ok('釋出格分散到多種類型', Object.keys(kinds).length>=3, JSON.stringify(kinds));

    // 2) 倒數徽章
    const tb=document.getElementById('turnLabel');
    ok('回合徽章顯示 /99', /\/\s*99/.test(tb.textContent), tb.textContent);
    ok('離上限還遠時不亮倒數', !tb.classList.contains('endingSoon'), tb.className);
    ui.S.turnNumber=94; ui.render();
    const tb2=document.getElementById('turnLabel');
    ok('剩 5 輪時亮倒數', tb2.classList.contains('endingSoon') && /剩 5/.test(tb2.textContent), tb2.textContent);

    // 3) 每輪固定發薪：真的在回合開頭發
    const S2=ui.S, p0=S2.players[0];
    ok('開局第一輪就已發薪', p0.stats.paydays>=1, '發薪 '+p0.stats.paydays+' 次');

    // 4) 時間到 → 戰報出現「再延長」鈕
    ui.S.turnNumber=ui.S.config.maxTurns+1;
    E.finishByRanking(ui.S); E.syncPhase(ui.S);
    ui._reported=false;
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.showReport();
    const btns=Array.from(document.querySelectorAll('#overlays button')).map(x=>x.textContent);
    const ext=Array.from(document.querySelectorAll('#overlays button')).filter(x=>/再延長/.test(x.textContent))[0];
    ok('戰報有「再延長」鈕', !!ext, btns.join(' | '));

    // 5) 按下去真的續攤，且戰報收掉
    if(ext){
      ext.click();
      ok('續攤後遊戲重新進行中', !ui.S.over, 'over='+ui.S.over+' phase='+ui.S.phase);
      ok('續攤後上限往後推', ui.S.config.maxTurns>100, '上限 '+ui.S.config.maxTurns);
      ok('續攤後戰報已收掉', !Array.from(document.querySelectorAll('#overlays .overlay')).some(o=>/戰報|排名|名次/.test(o.textContent)),
         Array.from(document.querySelectorAll('#overlays .overlay')).map(o=>o.textContent.replace(/\s+/g,'').slice(0,60)).join(' ‖ ') || '無殘留');
      ok('續攤後輪次沒有被重設', ui.S.turnNumber>=100, '第 '+ui.S.turnNumber+' 輪');
    }

    // 6) 圓夢結束的局不給續攤鈕
    ui.S.over=true; ui.S.overReason="DREAM"; ui.S.winner=0;
    ui._reported=false; document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.showReport();
    const ext2=Array.from(document.querySelectorAll('#overlays button')).filter(x=>/再延長/.test(x.textContent))[0];
    ok('圓夢結束不給續攤鈕', !ext2, ext2?'仍出現':'正確缺席');
    return R;
  });
  out.forEach(r=>console.log((r.ok?'OK  ':'FAIL')+' '+r.n+(r.d?'  '+r.d:'')));
  console.log(errs.length?('--- page errors ---\n'+errs.slice(0,8).join('\n')):'--- no page errors ---');
  console.log('RESULT '+out.filter(r=>r.ok).length+'/'+out.length);
  await b.close();
})();

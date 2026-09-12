const { chromium } = require('playwright');
const path = require('path');
const TARGET = path.resolve(__dirname, '..', 'index.html');
const SIZES=[[1024,768],[1180,820],[1280,720],[1366,768],[1440,900],[1920,1080]];
(async () => {
  const b = await chromium.launch();
  let pass=0, fail=0;
  for(const [W,H] of SIZES){
    const pg = await b.newPage({viewport:{width:W,height:H}});
    const errs=[]; pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
    await pg.goto('file://'+TARGET, {waitUntil:'load'});
    await pg.waitForTimeout(500);
    const r = await pg.evaluate(async () => {
      const ui=ns.ui, E=ns.engine;
      const baseCfg=ns.buildConfig(ns.configRegistry);
      const cfg = ns.util.clone(baseCfg); cfg.ipoLottery=1;
      ui.startCore(4242, cfg, ["M1","M2","M3","M4","M6","M8"],
        [{name:"我",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
         {name:"A",isNPC:true,npcPersonality:"NPC_SAFE",personality:"NPC_SAFE",professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[1].id},
         {name:"B",isNPC:true,npcPersonality:"NPC_LEVER",personality:"NPC_LEVER",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[2].id},
         {name:"C",isNPC:true,npcPersonality:"NPC_VC",personality:"NPC_VC",professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[3].id}],
        {noRules:true});
      const S=ui.S;
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      S.activePlayerIdx=1; S.phase="ROLL"; S.turnResolved=false;   // 電腦(P1)的回合
      E.openIpo(S, S.players[1]);
      E.syncPhase(S);
      ui.render();
      window.scrollTo(9999,9999); const sx=window.scrollX, sy=window.scrollY; window.scrollTo(0,0);
      const c=document.getElementById('center');
      const rect=c.getBoundingClientRect();
      const btns=[...c.querySelectorAll('button')].map(b=>b.textContent.trim());
      return {
        phase:S.phase,
        hasCard:/新股|IPO|申購/.test(c.textContent),
        hasThink:/思考中/.test(c.textContent)||/思考中/.test(document.getElementById('boardCenter').textContent),
        scrollX:sx>0, scrollY:sy>0,
        cardWithinViewport: rect.bottom<=window.innerHeight+2 && rect.right<=window.innerWidth+2 && rect.x>=-2,
        btnCount:btns.length, btns:btns
      };
    });
    const tag=W+'x'+H+' ';
    const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+tag+m+'  實得='+JSON.stringify(r)); } };
    A(errs.length===0, '無 page error: '+errs.join('|'));
    A(r.phase==='DECISION', 'phase 應為 DECISION');
    A(r.hasCard, '#center 應顯示 IPO 決策卡');
    A(!r.hasThink, '不該同時出現「思考中」字樣（renderCenter 判斷順序錯誤的症狀）');
    A(!r.scrollX, '不該出現水平捲軸');
    A(!r.scrollY, '不該出現垂直捲軸');
    A(r.btnCount>=3, '決策卡應該有至少 3 個按鈕（申購小資／申購股王／都不要）');
    A(r.cardWithinViewport, '決策卡應該完整落在可視範圍內，不破版');
    console.log('OK-ish '+tag+JSON.stringify(r));
    await pg.close();
  }
  console.log('=== 六種解析度：pass='+pass+' fail='+fail+' ===');
  await b.close();
})();

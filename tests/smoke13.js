// V11.1 煙霧測試：理賠明細卡、幸福感明細視窗
const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch(); let fail=0;
  for(const [w,h] of [[1920,1080],[1366,768],[1180,820]]){
    const ctx=await browser.newContext({viewport:{width:w,height:h}});
    const page=await ctx.newPage();
    const errs=[];
    page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
    await page.goto('file://'+process.cwd()+'/index.html');
    await page.waitForTimeout(450);
    await page.evaluate(()=>{
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      ns.ui.start({npcs:3,preset:'STANDARD',modules:['M1','M2','M3','M4','M6'],professionId:'PRO_ENGINEER',
        dreamCardId:ns.content.dreams[2].id,seed:3131},{d:3,v:2,a:2,m:['M1','M2','M3','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.phase='ROLL'; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null;
      ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:5000,label:'x'}],{eduTags:['setup']});
      p.mallBoughtThisTurn=0; E.apply(S,{type:'MALL_BUY',playerId:0,payload:{itemId:'ML_INS1'}},{mutate:true});
      p.mallBoughtThisTurn=0; E.apply(S,{type:'MALL_BUY',playerId:0,payload:{itemId:'ML_HEA1'}},{mutate:true});
      S.phase='ROLL'; S.decisionQueue=[]; S.pendingDecision=null; ns.ui.render();
    });

    // 有保險＋健身的理賠明細
    const ins=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      E.presentCard(S,p,ns.content.byId['OL_D03']); E.syncPhase(S); ns.ui.render();
      const t=document.getElementById('center').innerText;
      const nums=(t.match(/[\d,]{4,}/g)||[]);
      const d=S.decisionQueue.filter(x=>x.kind==='ACK')[0];
      const cl=d&&d.claim;
      const fmt=v=>ns.util.money(v);
      return {box:/理賠明細/.test(t), orig:/①\s*原價/.test(t), health:/健康折抵/.test(t),
        claim:/醫療＋意外險理賠/.test(t), net:/實際支付/.test(t), saved:/合計省下/.test(t),
        prep:/未雨綢繆/.test(t),
        origNum:cl?t.includes(fmt(cl.gross)):false,
        netNum:cl?t.includes(fmt(cl.net)):false,
        savedNum:cl?t.includes(fmt(cl.saved)):false,
        mathOk:cl?Math.abs((cl.gross-cl.saved)-cl.net)<0.02:false};
    });
    await page.screenshot({path:`s13_claim_${w}x${h}.png`});

    // 無保險對照
    const bare=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      p.flags.insured=false; delete p.flags.fitUntil; delete p.flags.checkedUntil;
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      E.presentCard(S,p,ns.content.byId['OL_H02']); E.syncPhase(S); ns.ui.render();
      const t=document.getElementById('center').innerText;
      return {full:/全額自付/.test(t), could:/如果當初有投保/.test(t), prep:/未雨綢繆/.test(t)};
    });

    // 幸福感明細：三個入口都能開
    const wb=await page.evaluate(()=>{
      const S=ns.ui.S; S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      S.players[0].childrenCount=1; S.players[0].dreamProgress=2; ns.ui.render();
      const entries=[...document.querySelectorAll('#sheet .wbClick')];
      const res={entryCount:entries.length};
      entries[0].click();
      let ov=[...document.querySelectorAll('.overlay')].pop();
      let t=ov?ov.innerText:'';
      res.open=/幸福感明細/.test(t);
      res.family=/家庭/.test(t)&&/小孩 1 位/.test(t);
      res.virtue=/品格四軸/.test(t);
      res.dream=/夢想進度/.test(t)&&/已完成 2/.test(t);
      res.life=/生活享受/.test(t);
      res.mall=/商城正向活動/.test(t);
      res.total=/合計/.test(t);
      res.tip=/還可以從這些地方補/.test(t);
      // 加總正確
      const p=S.players[0];
      res.totalNum=t.includes(ns.engine.wellbeing(S,p)+' ／ '+ns.engine.winWellbeingMin(S));
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return res;
    });
    await page.screenshot({path:`s13_wb_${w}x${h}.png`});

    const checks={claimBox:ins.box, claimOrig:ins.orig, claimHealth:ins.health, claimClaim:ins.claim,
      claimNet:ins.net, claimSaved:ins.saved, claimPrep:ins.prep,
      claimOrigNum:ins.origNum, claimNetNum:ins.netNum, claimSavedNum:ins.savedNum, claimMath:ins.mathOk,
      bareFull:bare.full, bareCould:bare.could, barePrep:bare.prep,
      wbEntries:wb.entryCount>=2, wbOpen:wb.open, wbFamily:wb.family, wbVirtue:wb.virtue,
      wbDream:wb.dream, wbLife:wb.life, wbMall:wb.mall, wbTotal:wb.total, wbTotalNum:wb.totalNum, wbTip:wb.tip,
      noErrors:errs.length===0};
    const bad=Object.entries(checks).filter(([k,v])=>!v);
    console.log(`=== ${w}x${h} ===`); console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', ')); }
    if(errs.length) console.log('  errors:', errs.slice(0,4));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE13 FAIL（${fail}）`:'\nSMOKE13 全部通過');
  process.exit(fail?1:0);
})();

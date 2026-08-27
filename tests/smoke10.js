// 九期煙霧測試：浮動利率顯示、貸款卡資訊、還款記帳、黑天鵝、夢想圈分區、全服公告
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
      ns.ui.start({npcs:3,preset:'STANDARD',modules:['M1','M2','M4','M6'],professionId:'PRO_ENGINEER',
        dreamCardId:ns.content.dreams[0].id,seed:909},{d:3,v:2,a:2,m:['M1','M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove()); ns.ui.render();
    });

    // ①③ 貸款卡：浮動說明＋原始金額／起貸輪／已還期數
    const loan=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine; const p=S.players[0];
      S.phase='ROLL'; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null;
      const id=E.addLiability(S,p,'CONSUMER','測試信貸',800,S.macro.baseRate+0.03,undefined,null,true);
      const l=p.liabilities.filter(x=>x.instanceId===id)[0];
      l.periodsPaid=7;
      ns.ui.render(); ns.ui.showLiability(l);
      const t=[...document.querySelectorAll('.overlay')].pop().innerText;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return {floating:l.isFloating, spreadOk:Math.abs(l.rateSpread-0.03)<0.0002,
        hasOrig:t.includes('原始貸款金額'), hasStart:/第 \d+ 輪起貸/.test(t),
        hasPeriods:/已還期數[\s\S]*7 期/.test(t), hasFloatTxt:t.includes('浮動＝基準')};
    });

    // ④ 還款 → 記帳題目
    const bk=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine; const p=S.players[0];
      S.config.automationLevel=2; S.turnResolved=true; S.bookkeeping=null;
      S.decisionQueue=[];S.pendingDecision=null; E.syncPhase(S);
      if(S.bookkeeping) S.bookkeeping.tasks.forEach(t=>t.done=true);
      E.syncPhase(S);
      ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:3000,label:'x'}],{eduTags:['setup']});
      const l=p.liabilities[p.liabilities.length-1];
      const cash0=p.cash, prin0=l.principal;
      const r=E.apply(S,{type:'REPAY_LOAN',playerId:0,payload:{liabilityId:l.instanceId,amount:100}});
      const S2=r.state,p2=S2.players[0];
      const l2=p2.liabilities.filter(x=>x.instanceId===l.instanceId)[0];
      const tasks=S2.bookkeeping?S2.bookkeeping.tasks:[];
      return {cashDown:Math.abs((cash0-p2.cash)-100)<0.02,
        debtDown:Math.abs((prin0-(l2?l2.principal:0))-100)<0.02,
        hasTask:tasks.some(t=>t.account==='LIABILITY'&&Math.abs(t.amount+100)<0.02),
        phase:S2.phase==='BOOKKEEPING'};
    });

    // ② 年度物價
    const infl=await page.evaluate(()=>{
      const midTxt=document.getElementById('infoDyn').innerText;
      const S=ns.ui.S;
      S.macro.inflation=0.02; S.macro.sinceInflation=11;
      const q=S.players[0]; const exp0=q.derived.totalExpenses;
      ns.modules.onRoundEnd(S);
      return {countdownShown:midTxt.includes('下次物價調整'),
        applied:S.players[0].derived.totalExpenses>exp0, reset:S.macro.sinceInflation===0};
    });

    // ⑦ 全服公告
    const bc=await page.evaluate(()=>{
      ns.ui.broadcast('測試公告','測試副標','good',4000);
      const el=document.querySelector('#bcast .bc');
      const r=el?el.getBoundingClientRect():null;
      const ok={shown:!!el, onTop:r?r.top<120:false, txt:el?el.innerText.includes('測試公告'):false};
      if(el) el.click();
      ok.dismissed=!document.querySelector('#bcast .bc');
      return ok;
    });

    // ⑤ 黑天鵝保證出現
    const shock=await page.evaluate(()=>{
      const E=ns.engine;
      const S=ns.engine.newGame({seed:4321,config:JSON.parse(JSON.stringify(ns.ui.S.config)),
        modules:['M1','M2','M4'],players:[{name:'A',isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
        {name:'B',isNPC:true,personality:'NPC_SAFE',professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[1].id}]});
      E.beginTurn(S);
      let forecast=false, hit=false;
      S.macro.stage='RECOVERY';
      for(let t=1;t<=45;t++){
        S.turnNumber=t; S.macro.stage=(S.macro.stage==='RECESSION'||S.macro.stage==='DEPRESSION')?'RECOVERY':S.macro.stage;
        ns.engine._events=[];
        ns.modules.onRoundEnd(S);
        ns.engine._events.forEach(e=>{ if(e.type==='SHOCK_FORECAST') forecast=true; if(e.type==='SHOCK_HIT') hit=true; });
        if(hit) break;
      }
      return {forecast, hit};
    });

    // ⑥ 夢想圈分區：底板存在、外圈棋子貼齊、外圈高亮
    const board=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine;
      [0,1].forEach((i,k)=>{const q=S.players[i];
        ns.ledger.post(S,q,'補被動',[{account:'INCOME_PASSIVE',delta:q.derived.totalExpenses+200,label:'x'}],{eduTags:['setup']});
        E.checkFreedom(S,q); E.enterOuterCircle(S,q); q.outerPos=[2,6][k];});
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';S.activePlayerIdx=0;
      ns.ui.render();
      const layout=ns.content.boardLayoutOuter.length;
      const cells=[]; for(let i=0;i<layout;i++) cells.push(ns.ui.rectPos(i,layout,204,84,260,580));
      const pawns=[...document.querySelectorAll('#boardSvg circle.pawn')].map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy')}))
        .filter(pt=>pt.y>460);
      const map=pawns.map(pt=>{let bi=-1,bd=1e9; cells.forEach((c,i)=>{const d=Math.hypot(pt.x-c.x,pt.y-c.y); if(d<bd){bd=d;bi=i;}}); return {cell:bi,d:Math.round(bd)};});
      const cellsSet=map.map(m=>m.cell).sort((a,b)=>a-b);
      return {panel: !!document.querySelector('#boardSvg rect[fill="url(#dreamBg)"]'),
        divider: document.querySelector('#boardSvg line')!==null,
        pawnsOnCells: map.every(m=>m.d<=16), cellsMatch: JSON.stringify(cellsSet)===JSON.stringify([2,6]),
        outerHighlight: [...document.querySelectorAll('#boardSvg g.sp-cell.here')].length>=2};
    });
    await page.screenshot({path:`s10_${w}x${h}.png`});

    const checks={loanFloating:loan.floating, loanSpread:loan.spreadOk, loanOrig:loan.hasOrig,
      loanStart:loan.hasStart, loanPeriods:loan.hasPeriods, loanFloatTxt:loan.hasFloatTxt,
      repayCash:bk.cashDown, repayDebt:bk.debtDown, repayTask:bk.hasTask, repayPhase:bk.phase,
      inflCountdown:infl.countdownShown, inflApplied:infl.applied, inflReset:infl.reset,
      bcShown:bc.shown, bcTop:bc.onTop, bcTxt:bc.txt, bcDismiss:bc.dismissed,
      shockForecast:shock.forecast, shockHit:shock.hit,
      dreamPanel:board.panel, dreamDivider:board.divider, dreamPawns:board.pawnsOnCells,
      dreamCells:board.cellsMatch, dreamHighlight:board.outerHighlight,
      noErrors:errs.length===0};
    const bad=Object.entries(checks).filter(([k,v])=>!v);
    console.log(`=== ${w}x${h} ===`); console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', ')); }
    if(errs.length) console.log('  errors:', errs.slice(0,4));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE10 FAIL（${fail}）`:'\nSMOKE10 全部通過');
  process.exit(fail?1:0);
})();

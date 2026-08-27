// 七期煙霧測試：自動骰暫停、設定鈕、系統訊息5則+醒目、頂列精簡、結束遊戲、夢想圈配色、品格數字、補繳文案、細項標頭
const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  const page=await (await browser.newContext({viewport:{width:1366,height:768}})).newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await page.goto('file://'+process.cwd()+'/index.html');
  await page.waitForTimeout(500);

  // 開局（保留開場說明 overlay 不關）→ 等 5 秒，驗證自動骰「不會」在說明開啟時觸發
  await page.evaluate(()=>{
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
    const C=ns.content;
    ns.ui.start({npcs:2,preset:'STANDARD',modules:['M1','M2','M4','M6'],
      professionId:'PRO_ENGINEER',dreamCardId:C.dreams[0].id,seed:888},{d:3,v:2,a:2,m:['M1','M2','M4','M6']});
    // ui.start 內會開 showRules(true) → overlay 應存在
  });
  await page.waitForTimeout(5200);
  const pausedCheck=await page.evaluate(()=>({
    overlayOpen: document.querySelectorAll('.overlay').length>0,
    stillRollPhase: ns.ui.S.phase==='ROLL',
    actions: ns.ui.S.actionLog.length
  }));

  // 關閉說明 → 應恢復倒數並在 ~4 秒內自動骰
  await page.evaluate(()=>{ document.querySelectorAll('.overlay').forEach(o=>o.remove()); ns.ui.render(); });
  await page.waitForTimeout(4500);
  const resumed=await page.evaluate(()=>({rolled: ns.ui.S.actionLog.some(a=>a.type==='ROLL_DICE')}));

  // 設定鈕（等 CSS transition 完成再驗）
  // 先清掉自動骰後可能彈出的決策視窗，否則點擊會被 modal 攔截（harness 前置，非產品行為）
  await page.evaluate(()=>{ document.querySelectorAll('.overlay').forEach(o=>o.remove());
    const S=ns.ui.S; S.decisionQueue=[]; S.pendingDecision=null; S.phase='READY_END'; ns.ui.render(); });
  await page.click('#btnDev');
  await page.waitForTimeout(450);
  const devOpen=await page.evaluate(()=>{
    const p=document.getElementById('devpanel');
    return p.classList.contains('on') && getComputedStyle(p).transform==='none' &&
      document.getElementById('devbody').children.length>0;
  });
  await page.click('#devClose');
  await page.waitForTimeout(450);
  const devClosed=await page.evaluate(()=>!document.getElementById('devpanel').classList.contains('on'));
  const dev={opens:devOpen, closed:devClosed};

  // 頂列：turnBadge 與 ticker 不存在
  const top=await page.evaluate(()=>({
    noBadge: !document.getElementById('turnBadge'),
    noTicker: !document.getElementById('ticker')
  }));

  // 系統訊息：≤5 則、最新一則 .new、含擲骰訊息
  const sys=await page.evaluate(()=>{
    const lns=[...document.querySelectorAll('#sysLog .ln')];
    return {count:lns.length, first:lns[0]?lns[0].className:'', anyDice:lns.some(l=>/擲 \d 點 → /.test(l.textContent)),
      newFirst: lns[0]&&lns[0].classList.contains('new')};
  });

  // 品格數字在幸福感後、無星等區塊
  const virtue=await page.evaluate(()=>{
    const t=document.getElementById('sheet').innerText;
    return {numeric:/品格 情緒 \d/.test(t), noStars:!t.includes('☆')};
  });

  // 細項標頭
  const heads=await page.evaluate(()=>{
    const S=ns.ui.S,E=ns.engine,p=S.players[0];
    // 造一筆資產與既有學貸即有負債
    const id=ns.util.uid(S,'A');
    p.assets.push({instanceId:id,cardId:'X',kind:'REALESTATE',name:'測試房',units:1,costBasis:300,marketValue:300,monthlyIncome:6,linkedLiabilityId:null,flags:{}});
    ns.ledger.post(S,p,'建檔',[{account:'ASSET',delta:300,refId:id,label:'測試房'},{account:'INCOME_PASSIVE',delta:6,refId:id,label:'租金'}],{eduTags:['setup']});
    ns.ui.render();
    const t=document.getElementById('sheet').innerText;
    return {aHead:t.includes('現值')&&t.includes('月現金流'), lHead:t.includes('餘額')&&t.includes('月付')};
  });

  // 夢想圈鮮明配色（多種顏色 stroke）
  const outerColors=await page.evaluate(()=>{
    const cols=new Set([...document.querySelectorAll('#boardSvg rect')].map(r=>r.getAttribute('stroke')).filter(c=>c&&c.startsWith('#')));
    return {distinct:cols.size};
  });

  // 補繳保證金文案：margin 融資 + 手動還款 → ledger summary
  const topup=await page.evaluate(()=>{
    const S=ns.ui.S,E=ns.engine; let p=S.players[0];
    S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
    ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:3000,label:'x'}],{eduTags:['setup']});
    const sym=ns.content.stockDefs[0].symbol;
    E.apply(S,{type:'TRADE_STOCK',playerId:0,payload:{symbol:sym,side:'buy',units:5,margin:true}},{mutate:true});
    S.phase='ROLL';
    const lot=p.assets.filter(a=>a.flags&&a.flags.margin)[0];
    const loan=p.liabilities.filter(l=>l.instanceId===lot.linkedLiabilityId)[0];
    E.apply(S,{type:'REPAY_LOAN',playerId:0,payload:{liabilityId:loan.instanceId,amount:10}},{mutate:true});
    const last=p.ledger[p.ledger.length-1];
    return {label:last.summary, ok:last.summary.startsWith('補繳保證金')};
  });

  // 結束遊戲：按鈕文字＋確認→復盤
  const endg=await page.evaluate(()=>{
    const b=document.getElementById('btnEnd');
    const txt=b.textContent;
    b.click();
    const ov=[...document.querySelectorAll('.overlay')].pop();
    const confirmBtn=[...ov.querySelectorAll('button')].find(x=>x.textContent.includes('確定結束遊戲'));
    confirmBtn.click();
    return {txt, over:ns.ui.S.over===true, winner:ns.ui.S.winner};
  });
  await page.waitForTimeout(400);
  await page.screenshot({path:'s8_final.png'});

  const checks={
    pausedWhileRulesOpen: pausedCheck.overlayOpen && pausedCheck.actions===0,
    resumedAfterClose: resumed.rolled,
    devOpens: dev.opens, devCloses: dev.closed,
    noBadge: top.noBadge, noTicker: top.noTicker,
    sysMax5: sys.count<=5 && sys.count>0, sysNewestHighlight: sys.newFirst, sysDiceMsg: sys.anyDice,
    virtueNumeric: virtue.numeric, virtueNoStars: virtue.noStars,
    assetHead: heads.aHead, liabHead: heads.lHead,
    outerColorsDistinct: outerColors.distinct>=4,
    topupLabel: topup.ok,
    endBtnLabel: endg.txt.includes('結束遊戲'), endGameWorks: endg.over,
    noErrors: errs.length===0
  };
  const bad=Object.entries(checks).filter(([k,v])=>!v);
  console.log(JSON.stringify(checks,null,1));
  if(errs.length) console.log('errors:',errs.slice(0,5));
  console.log(bad.length?('SMOKE8 FAIL: '+bad.map(b=>b[0]).join(', ')):'SMOKE8 全部通過');
  await browser.close();
  process.exit(bad.length?1:0);
})();

const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1180,height:820}});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await page.goto('file://'+process.cwd()+'/index.html');
  await page.waitForTimeout(500);
  await page.evaluate(()=>{
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
    const C=ns.content;
    ns.ui.start({npcs:2,preset:'STANDARD',modules:['M1','M2','M4','M6'],
      professionId:'PRO_ENGINEER',dreamCardId:C.dreams[2].id,seed:31},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
  });
  await page.waitForTimeout(300);
  // 1) 進外圈＋重返職場按鈕
  const outer=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine, p=S.players[0];
    ns.ledger.post(S,p,'補',[{account:'INCOME_PASSIVE',delta:p.derived.totalExpenses+30,label:'x'}],{eduTags:['setup']});
    ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:2000,label:'x'}],{eduTags:['setup']});
    E.enterOuterCircle(S,p); S.config.outerLifeChance=1; ns.ui.render();
    const sheet=document.getElementById('sheet').innerText;
    return {stage:p.playerStage, hasReturnBtn:/重返職場/.test(sheet)};
  });
  console.log('外圈＋按鈕:',JSON.stringify(outer));
  // 2) 非本命聖地 → 誘惑卡 modal（幸福感行）
  const life=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine, p=S.players[0];
    const d=S.decks.OUTER_LIFE; d.draw=d.draw.filter(x=>x!=='OL_L01'); d.draw.unshift('OL_L01');
    const dream=ns.content.byId[p.dreamCardId];
    const sp=ns.content.boardLayoutOuter.filter(x=>x.type==='SITE'&&x.category!==dream.category)[0];
    S.decisionQueue=[]; E.landing(S,p,sp); E.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    return {modal:c.classList.contains('on'), title:/頭等艙/.test(c.innerText), joy:/幸福感/.test(c.innerText)};
  });
  console.log('誘惑卡:',JSON.stringify(life));
  await page.screenshot({path:'s5_life.png'});
  // 3) 購點 modal → 買
  const buy=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine, p=S.players[0];
    S.decisionQueue=[]; S.pendingDecision=null; p.boughtProgressThisTurn=false;
    E.offerDreamProgress(S,p); E.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    const has=/買下一段/.test(c.innerText);
    const prog0=p.dreamProgress;
    const b=[...c.querySelectorAll('button')].find(x=>/買下一段/.test(x.textContent));
    if(b) b.click();
    // spendGuard 可能彈確認
    const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
    if(ov){ const go=[...ov.querySelectorAll('button')].find(x=>/仍要|繼續|確定/.test(x.textContent)); if(go) go.click(); }
    return {panel:has, bought: ns.ui.S.players[0].dreamProgress===prog0+1,
      text:document.getElementById('center').innerText.slice(0,60)};
  });
  console.log('購點:',JSON.stringify(buy));
  // 4) 現金危機 → 自救 modal → 選跌回
  const crisis=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine, p=S.players[0];
    const id=ns.util.uid(S,'A');
    p.assets.push({instanceId:id,cardId:'X',kind:'REALESTATE',name:'危機測試屋',units:1,
      costBasis:600,marketValue:600,monthlyIncome:12,linkedLiabilityId:null,flags:{}});
    ns.ledger.post(S,p,'建檔',[{account:'ASSET',delta:600,refId:id,label:'危機測試屋'},
      {account:'INCOME_PASSIVE',delta:12,refId:id,label:'租金'}],{eduTags:['setup']});
    ns.ledger.post(S,p,'爆負',[{account:'CASH',delta:-(p.cash+300),label:'x'}],{eduTags:['setup']});
    S.decisionQueue=[]; E.enterBankruptcy(S,p); E.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    const shows=/現金告急/.test(c.innerText) && /急售/.test(c.innerText) && /跌回內圈/.test(c.innerText);
    return {rescueModal:shows, text:c.innerText.replace(/\n+/g,' | ').slice(0,200)};
  });
  console.log('危機 modal:',JSON.stringify(crisis));
  await page.screenshot({path:'s5_crisis.png'});
  const fall=await page.evaluate(()=>{
    const c=document.getElementById('center');
    const b=[...c.querySelectorAll('button')].find(x=>/跌回內圈/.test(x.textContent));
    b.click();
    const p=ns.ui.S.players[0];
    return {stage:p.playerStage, salary:p.derived.salaryIncome, retired:p.retiredSalary,
      ninety: Math.abs(p.derived.salaryIncome-ns.util.r2(p.retiredSalary*0.9))<0.02,
      progKept:p.dreamProgress};
  });
  console.log('跌落結果:',JSON.stringify(fall));
  if(errs.length) console.log('❌ JS 錯誤:\n'+errs.slice(0,10).join('\n')); else console.log('✅ 無 JS 錯誤');
  await browser.close();
})();

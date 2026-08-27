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
      professionId:'PRO_ENGINEER',dreamCardId:C.dreams[0].id,seed:777},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
  });
  await page.waitForTimeout(300);

  // 盲盒：拉高幸福感 → 結束回合觸發
  const bl=await page.evaluate(()=>{
    const S=ns.ui.S, p=S.players[0];
    p.dreamProgress=12; S.turnResolved=true; S.decisionQueue=[]; S.pendingDecision=null;
    ns.engine.syncPhase(S); ns.ui.render();
    ns.ui.dispatch({type:'END_TURN',playerId:0,payload:null});
    const d=ns.ui.S.pendingDecision;
    const c=document.getElementById('center');
    return {kind:d&&d.kind, prize:d&&d.prize, modal:c.classList.contains('on'),
            hasOpenBtn: !!/打開/.test(c.innerText)};
  });
  console.log('盲盒觸發:',JSON.stringify(bl));
  await page.screenshot({path:'s2_blessing.png'});
  // 按「打開」
  const opened=await page.evaluate(()=>{
    const c=document.getElementById('center');
    const b=[...c.querySelectorAll('button')].find(x=>/打開/.test(x.textContent));
    if(!b) return 'no-btn'; b.click();
    return {text:c.innerText.replace(/\n+/g,' | ').slice(0,140)};
  });
  console.log('開盒後:',JSON.stringify(opened));
  await page.screenshot({path:'s2_blessing_open.png'});
  await page.evaluate(()=>{
    const c=document.getElementById('center');
    const b=[...c.querySelectorAll('button')].find(x=>/我知道了/.test(x.textContent));
    if(b) b.click();
  });
  await page.waitForTimeout(200);

  // 信用評級變動：強制降到 C 並重評
  const cr=await page.evaluate(()=>{
    const S=ns.ui.S, p=S.players[0];
    p.creditFlags={usedRescue:true,everBankrupt:true,cashWentNegative:true};
    const before=p.creditRating;
    ns.engine._events.length=0;
    ns.engine.runCreditReview(S);
    const evs=ns.engine._events.slice();
    ns.ui.handleEvents(evs); ns.ui.render();
    const fb=document.getElementById('finBoard').innerText;
    return {before, after:S.players[0].creditRating, ev:evs.map(e=>e.type),
      finCredit: fb.split('我的信用')[1] ? fb.split('我的信用')[1].split('股市')[0].replace(/\n+/g,' | ').trim() : '(none)'};
  });
  console.log('評級降級:',JSON.stringify(cr));

  // 空租／修繕：建一筆房產強制觸發，看動態列與資產明細
  const ops=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine, p=S.players[0];
    const aid=ns.util.uid(S,'A');
    p.assets.push({instanceId:aid,cardId:'X',kind:'REALESTATE',name:'煙霧測試套房',units:1,
      costBasis:1000,marketValue:1000,monthlyIncome:20,linkedLiabilityId:null,flags:{}});
    ns.ledger.post(S,p,'測試建檔',[{account:'ASSET',delta:1000,refId:aid,label:'煙霧測試套房'},
      {account:'INCOME_PASSIVE',delta:20,refId:aid,label:'淨租金'}],{eduTags:['setup']});
    S.macro.stage='RECESSION';
    S.config.repairChancePerPayday=1; S.config.vacancyChance_RECESSION=1;
    ns.engine._events.length=0;
    E.opsRisk(S,p); ns.ledger.recompute(p);
    const evs=ns.engine._events.slice();
    ns.ui.handleEvents(evs); ns.ui.render();
    const a=p.assets.find(x=>x.instanceId===aid);
    ns.ui.showDetails(p);
    const ov=document.querySelector('#overlays .overlay');
    const txt=ov?ov.innerText:'';
    const vac=/空租至第/.test(txt);
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    return {ev:evs.map(e=>e.type), vacantUntil:a.vacantUntilTurn, income:a.monthlyIncome,
            detailShowsVacancy:vac,
            dyn:document.getElementById('pawns').innerText.split('\n').slice(0,5).join(' | ')};
  });
  console.log('營運風險:',JSON.stringify(ops));
  await page.screenshot({path:'s2_ops.png'});

  // 破產流程 modal
  const bk=await page.evaluate(()=>{
    const S=ns.ui.S, p=S.players[0];
    ns.ledger.post(S,p,'煙霧測試：抽乾現金',[{account:'CASH',delta:-(p.cash+50),label:'測試'}],{eduTags:['setup']});
    ns.engine.enterBankruptcy(S,p); ns.engine.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    return {phase:S.phase, modal:c.classList.contains('on'), text:c.innerText.replace(/\n+/g,' | ').slice(0,120)};
  });
  console.log('破產 modal:',JSON.stringify(bk));
  await page.screenshot({path:'s2_bankrupt.png'});
  if(errs.length) console.log('❌ JS 錯誤:\n'+errs.slice(0,15).join('\n')); else console.log('✅ 無 JS 錯誤');
  await browser.close();
})();

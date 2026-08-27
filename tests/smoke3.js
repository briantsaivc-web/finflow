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
    ns.ui.start({npcs:3,preset:'STANDARD',modules:['M1','M2','M4','M6'],
      professionId:'PRO_ENGINEER',dreamCardId:C.dreams[0].id,seed:424},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
  });
  await page.waitForTimeout(300);
  // 1) BUY 決策卡：確認「發起拍賣／找人合資」按鈕存在
  const buy=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine;
    const CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==='REALESTATE')[0];
    S.players.slice(1).forEach(pl=>ns.ledger.post(S,pl,'補現金',[{account:'CASH',delta:500,label:'x'}],{eduTags:['setup']}));
    E.pushDecision(S,S.players[0],{kind:'BUY',cardId:CARD.id});
    E.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    return {modal:c.classList.contains('on'),
      hasAuction:/發起拍賣/.test(c.innerText), hasJv:/找人合資/.test(c.innerText),
      hasOldTransfer:/轉讓這個機會/.test(c.innerText), cardId:CARD.id};
  });
  console.log('BUY 決策卡:',JSON.stringify(buy));
  await page.screenshot({path:'s3_buy.png'});
  // 2) 點「發起拍賣」→ 結果 modal
  await page.evaluate(()=>{
    const c=document.getElementById('center');
    const b=[...c.querySelectorAll('button')].find(x=>/發起拍賣/.test(x.textContent));
    b.click();
  });
  await page.waitForTimeout(300);
  const auc=await page.evaluate(()=>{
    const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
    return {resultModal: ov?/拍賣結果/.test(ov.innerText):false,
      text: ov?ov.innerText.replace(/\n+/g,' | ').slice(0,220):'(none)',
      decisionGone: !ns.ui.S.pendingDecision || ns.ui.S.pendingDecision.kind!=='BUY'};
  });
  console.log('拍賣結果:',JSON.stringify(auc));
  await page.screenshot({path:'s3_auction.png'});
  await page.evaluate(()=>{ document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove()); });
  // 3) 再抽一張 → 開 JV modal → 提出 50/50
  const jv=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine;
    const CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==='REALESTATE')[1]
             ||ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==='REALESTATE')[0];
    ns.ledger.post(S,S.players[0],'補現金',[{account:'CASH',delta:1000,label:'x'}],{eduTags:['setup']});
    S.decisionQueue=[]; E.pushDecision(S,S.players[0],{kind:'BUY',cardId:CARD.id});
    E.syncPhase(S); ns.ui.render();
    const c=document.getElementById('center');
    const b=[...c.querySelectorAll('button')].find(x=>/找人合資/.test(x.textContent));
    if(!b) return 'no-jv-btn';
    b.click();
    const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
    return {panel: ov?/找人合資/.test(ov.innerText):false,
      hasSlider: !!ov.querySelector('input[type=range]'),
      text: ov.innerText.replace(/\n+/g,' | ').slice(0,180)};
  });
  console.log('JV 面板:',JSON.stringify(jv));
  await page.screenshot({path:'s3_jv.png'});
  const jv2=await page.evaluate(()=>{
    const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
    const go=[...ov.querySelectorAll('button')].find(x=>/提出合資/.test(x.textContent));
    go.click();
    const S=ns.ui.S;
    const a=S.players[0].assets.filter(x=>x.jvGroupId)[0];
    return {formed: !!a, name:a&&a.name,
      partnerHas: S.players.slice(1).some(pl=>pl.assets.some(x=>x.jvGroupId)),
      dyn: document.getElementById('pawns').innerText.split('\n').filter(l=>/合資/.test(l))[0]||'(no line)'};
  });
  console.log('JV 成立:',JSON.stringify(jv2));
  await page.screenshot({path:'s3_jv_done.png'});
  if(errs.length) console.log('❌ JS 錯誤:\n'+errs.slice(0,10).join('\n')); else console.log('✅ 無 JS 錯誤');
  await browser.close();
})();

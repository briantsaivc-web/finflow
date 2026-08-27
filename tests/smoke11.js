// V10 煙霧測試：商城、轉介、獲利提示、卡片多樣化
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
        dreamCardId:ns.content.dreams[0].id,seed:1010},{d:3,v:2,a:2,m:['M1','M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const S=ns.ui.S; S.phase='ROLL'; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null;
      ns.ledger.post(S,S.players[0],'補現金',[{account:'CASH',delta:3000,label:'x'}],{eduTags:['setup']});
      ns.ui.render();
    });

    // ④ 商城：開啟、分組、購買
    const mall=await page.evaluate(()=>{
      const btn=document.getElementById('btnMall');
      const enabled=!btn.disabled;
      btn.click();
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const groups=[...ov.querySelectorAll('.mallGroup')].map(g=>g.textContent);
      const items=[...ov.querySelectorAll('.mallItem')];
      const hasIns=ov.innerText.includes('醫療＋意外險');
      const hasContest=ov.innerText.includes('擲骰決定獎金');
      // 買一張包紅包
      const red=items.find(b=>b.innerText.includes('包紅包'));
      const before={joy:ns.ui.S.players[0].stats.mallJoy, cash:ns.ui.S.players[0].cash};
      if(red && !red.disabled) red.click();
      return {enabled, groupCount:groups.length, groups, itemCount:items.length, hasIns, hasContest, before};
    });
    await page.waitForTimeout(300);
    const bought=await page.evaluate(()=>{
      // spendGuard 可能跳確認窗
      const ov=[...document.querySelectorAll('.overlay')];
      if(ov.length){ const b=[...ov[ov.length-1].querySelectorAll('button')].find(x=>/確定|繼續|買/.test(x.textContent)); if(b) b.click(); }
      const p=ns.ui.S.players[0];
      return {joy:p.stats.mallJoy, filial:p.virtues?p.virtues.FILIAL:0, count:Object.keys(p.mallBought||{}).length,
        limitHit:document.getElementById('btnMall').disabled};
    });
    await page.evaluate(()=>document.querySelectorAll('.overlay').forEach(o=>o.remove()));

    // 保險購買 + 個人面板徽章
    const ins=await page.evaluate(()=>{
      const S=ns.ui.S; S.players[0].mallBoughtThisTurn=0; S.phase='ROLL';
      const r=ns.engine.apply(S,{type:'MALL_BUY',playerId:0,payload:{itemId:'ML_INS1'}});
      ns.ui.S=r.state; ns.ui.handleEvents(r.events); ns.ui.render();
      return {insured:ns.ui.S.players[0].flags.insured===true,
        badge:document.getElementById('sheet').innerText.includes('醫療意外險')};
    });

    // ① 轉介：推 BUY 決策 → 應出現轉介鈕
    const refer=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';S.activePlayerIdx=0;
      E.pushDecision(S,p,{kind:'BUY',cardId:'OPS_BZ1'}); E.syncPhase(S); ns.ui.render();
      const txt=document.getElementById('center').innerText;
      const hasBtn=/轉介給他人（收介紹費/.test(txt);
      const fee=E.referralFee(S,ns.content.byId['OPS_BZ1']);
      // 開啟轉介面板
      const b=[...document.querySelectorAll('#center button')].find(x=>x.textContent.includes('轉介給他人'));
      if(b) b.click();
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const panel=ov?ov.innerText:'';
      const targets=ov?[...ov.querySelectorAll('button')].filter(x=>x.textContent.includes('轉介給')).length:0;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return {hasBtn, fee, panelOk:/介紹費/.test(panel), targets};
    });

    // ② 獲利提示卡
    const gain=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';S.activePlayerIdx=0;
      const sym=ns.content.stockDefs[0].symbol;
      E.apply(S,{type:'TRADE_STOCK',playerId:0,payload:{symbol:sym,side:'buy',units:8}},{mutate:true});
      S.stockPrices[sym]=ns.util.r2(S.stockPrices[sym]*2.3); E.revalueStocks(S);
      S.decisionQueue=[];S.pendingDecision=null;
      ns.modules.registry.M1.onRoundEnd(S); E.syncPhase(S); ns.ui.render();
      const txt=document.getElementById('center').innerText;
      const ok={card:/帳上獲利/.test(txt), sellAll:/全部停利/.test(txt), hold:/繼續持有/.test(txt),
        half:/賣一半/.test(txt)};
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return ok;
    });

    // ③ 卡片多樣化：小額牌堆三類各 10 張、無重複 id
    const deck=await page.evaluate(()=>{
      const sm=ns.content.cards.OPPORTUNITY_SMALL||[], lg=ns.content.cards.OPPORTUNITY_LARGE||[];
      const k=x=>sm.filter(c=>c.kind===x).length;
      const ids=new Set(sm.concat(lg).map(c=>c.id));
      const titles=new Set(sm.concat(lg).map(c=>c.title));
      return {small:sm.length, large:lg.length, bz:k('BUSINESS'), re:k('REALESTATE'), st:k('STOCK'),
        uniqueIds:ids.size===sm.length+lg.length, uniqueTitles:titles.size===sm.length+lg.length,
        contentErrors:(ns.content.errors||[]).length};
    });
    await page.screenshot({path:`s11_${w}x${h}.png`});

    const checks={mallEnabled:mall.enabled, mallGroups:mall.groupCount>=5, mallItems:mall.itemCount>=12,
      mallInsurance:mall.hasIns, mallContest:mall.hasContest,
      mallJoyUp:bought.joy>mall.before.joy, mallVirtue:bought.filial>=1, mallLimit:bought.limitHit,
      insBought:ins.insured, insBadge:ins.badge,
      referBtn:refer.hasBtn, referFee:refer.fee>0, referPanel:refer.panelOk, referTargets:refer.targets>=2,
      gainCard:gain.card, gainSell:gain.sellAll, gainHold:gain.hold,
      deckSmall:deck.small>=28, deckBalanced:deck.bz===deck.re && deck.re===deck.st,
      deckUniqueIds:deck.uniqueIds, deckUniqueTitles:deck.uniqueTitles, contentClean:deck.contentErrors===0,
      noErrors:errs.length===0};
    const bad=Object.entries(checks).filter(([k,v])=>!v);
    console.log(`=== ${w}x${h} ===`); console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', ')); }
    if(errs.length) console.log('  errors:', errs.slice(0,4));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE11 FAIL（${fail}）`:'\nSMOKE11 全部通過');
  process.exit(fail?1:0);
})();

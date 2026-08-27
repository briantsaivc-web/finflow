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
      professionId:'PRO_ENGINEER',dreamCardId:C.dreams[0].id,seed:99},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
    document.querySelectorAll('.overlay').forEach(o=>o.remove());
  });
  await page.waitForTimeout(300);
  // 1) 開 P2P 面板（經交易面板頁籤）
  const panel=await page.evaluate(()=>{
    ns.ui.showP2PPanel();
    const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
    return {open:/民間借貸/.test(ov.innerText), sliders:ov.querySelectorAll('input[type=range]').length,
      text:ov.innerText.replace(/\n+/g,' | ').slice(0,200)};
  });
  console.log('P2P 面板:',JSON.stringify(panel));
  await page.screenshot({path:'s4_p2p_panel.png'});
  // 2) 我要借款：向穩健阿姨（NPC SAFE、有錢）借 → 依動態下限設定利率 → 提出
  const borrow=await page.evaluate(()=>{
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const S=ns.ui.S, E=ns.engine;
    // 補 NPC 現金讓放款條件成立
    ns.ledger.post(S,S.players[1],'補現金',[{account:'CASH',delta:1000,label:'x'}],{eduTags:['setup']});
    const minR=E.p2pMinRate(S,S.players[0]);
    ns.ui.dispatch({type:'PROPOSE_P2P',playerId:0,
      payload:{lenderId:1,borrowerId:0,amount:300,annualRate:minR,termMonths:24}});
    const me=ns.ui.S.players[0];
    const l=me.liabilities.filter(x=>x.kind==='P2P')[0];
    const fb=document.getElementById('finBoard').innerText;
    return {formed:!!l, principal:l&&l.principal, pay:l&&l.monthlyPayment,
      finShows:/欠/.test(fb), fbLine:(fb.split('\n').filter(x=>/欠/.test(x))[0]||'')};
  });
  console.log('借款成立:',JSON.stringify(borrow));
  await page.screenshot({path:'s4_p2p_formed.png'});
  // 3) 跑一輪 onRoundEnd 對轉，確認雙邊現金流與動態列
  const round=await page.evaluate(()=>{
    const S=ns.ui.S, E=ns.engine;
    const a0=S.players[0].cash, b0=S.players[1].cash;
    ns.engine._events.length=0;
    E.p2pRoundEnd(S);
    ns.ledger.recompute(S.players[0]); ns.ledger.recompute(S.players[1]);
    ns.ui.handleEvents(ns.engine._events.slice()); ns.ui.render();
    return {aDelta:Math.round((S.players[0].cash-a0)*100)/100,
            bDelta:Math.round((S.players[1].cash-b0)*100)/100,
            ev:ns.engine._events.map(e=>e.type)};
  });
  console.log('一輪對轉:',JSON.stringify(round));
  // 4) 放款方向拒絕路徑：對「額度未滿」的 NPC 放款 → 應被婉拒（toast，不 crash）
  const rej=await page.evaluate(()=>{
    ns.ui.dispatch({type:'PROPOSE_P2P',playerId:0,
      payload:{lenderId:0,borrowerId:2,amount:100,annualRate:0.12,termMonths:24}});
    return {stillNoLoan: !ns.ui.S.players[0].assets.some(a=>a.kind==='P2P_LOAN')};
  });
  console.log('放款遭拒:',JSON.stringify(rej));
  if(errs.length) console.log('❌ JS 錯誤:\n'+errs.slice(0,10).join('\n')); else console.log('✅ 無 JS 錯誤');
  await browser.close();
})();

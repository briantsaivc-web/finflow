// 六期煙霧測試：多解析度適配、自動骰、頭像、放棄抽卡、pickGrid、融資分倉列、說明書連結、版本資訊
const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  let fail=0;
  for(const [w,h] of [[1920,1080],[1366,768],[1180,820]]){
    const ctx=await browser.newContext({viewport:{width:w,height:h}});
    const page=await ctx.newPage();
    const errs=[];
    page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
    await page.goto('file://'+process.cwd()+'/index.html');
    await page.waitForTimeout(500);

    // 設定畫面版本字樣
    const setupVer=await page.evaluate(()=>document.body.innerText.includes(ns.BUILD.ver));
    // 開局
    await page.evaluate(()=>{
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const C=ns.content;
      ns.ui.start({npcs:2,preset:'STANDARD',modules:['M1','M2','M4','M6'],
        professionId:'PRO_ENGINEER',dreamCardId:C.dreams[0].id,seed:777},{d:3,v:2,a:2,m:['M1','M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      ns.ui.render();
    });
    await page.waitForTimeout(400);

    const base=await page.evaluate(()=>{
      const btn=document.querySelector('#boardCenter .bigbtn');
      const pawnEmojis=[...document.querySelectorAll('#boardSvg text')].filter(t=>/\p{Extended_Pictographic}/u.test(t.textContent)).length;
      const stripAvatar=[...document.querySelectorAll('.pcol')].some(c=>/\p{Extended_Pictographic}/u.test(c.textContent));
      const sysHdr=[...document.querySelectorAll('#finBoard b,#finBoard .gold,#infoDyn *')].map(x=>x.textContent).join(' ');
      const fs=parseFloat(getComputedStyle(document.body).fontSize);
      return {
        hscroll: document.body.scrollWidth > document.documentElement.clientWidth+2,
        rollLabel: btn?btn.textContent:null,
        pawnEmojis, stripAvatar,
        verInSys: sysHdr.includes(ns.BUILD.ver),
        bodyFont: fs,
        zoom: getComputedStyle(document.body).zoom||'1'
      };
    });
    // 自動骰：等 4 秒應該已自動擲出（phase 離開 ROLL）
    await page.waitForTimeout(4200);
    const afterAuto=await page.evaluate(()=>({phase:ns.ui.S.phase, turn:ns.ui.S.turnNumber, actions:ns.ui.S.actionLog.length}));

    // 強制 CHOOSE_DECK：檢查「這次先不抽」
    const deck=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;
      E.pushDecision(S,p,{kind:'CHOOSE_DECK'}); E.syncPhase(S); ns.ui.render();
      const txt=document.getElementById('center').innerText;
      return {skip:txt.includes('這次先不抽')};
    });
    // 按下放棄
    const skipRes=await page.evaluate(()=>{
      const btns=[...document.querySelectorAll('#center button')];
      const b=btns.find(x=>x.textContent.includes('這次先不抽'));
      if(b) b.click();
      return {phase:ns.ui.S.phase, passed:ns.ui.S.players[0].stats.passedOpps};
    });

    // 強制 PICK_OPP：pickGrid 左右排列不需捲動
    const pick=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      const two=E.drawTwo(S,'OPPORTUNITY_SMALL',c=>E.cardUsable(S,p,c));
      E.pushDecision(S,p,{kind:'PICK_OPP',cardIds:two.map(c=>c.id),deckId:'OPPORTUNITY_SMALL'});
      E.syncPhase(S); ns.ui.render();
      const g=document.querySelector('#center .pickGrid');
      if(!g) return {grid:false};
      const kids=[...g.children].map(k=>k.getBoundingClientRect());
      const card=document.querySelector('#center > *');
      const cr=card.getBoundingClientRect();
      return {grid:true, sideBySide: kids.length>=2 && Math.abs(kids[0].y-kids[1].y)<5,
        noScroll: card.scrollHeight<=card.clientHeight+2,
        fits: cr.y>=0 && cr.y+cr.height<=window.innerHeight+1};
    });
    await page.screenshot({path:`s7_pick_${w}x${h}.png`});

    // 融資分倉：買現股+融資，檢查右欄庫存列與股市 modal
    const margin=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine;
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      let p=S.players[0];
      ns.ledger.post(S,p,'測試補現金',[{account:'CASH',delta:3000,label:'x'}],{eduTags:['setup']});
      const sym=ns.content.stockDefs[0].symbol;
      E.apply(S,{type:'TRADE_STOCK',playerId:0,payload:{symbol:sym,side:'buy',units:5}},{mutate:true});
      S.phase='ROLL';
      E.apply(S,{type:'TRADE_STOCK',playerId:0,payload:{symbol:sym,side:'buy',units:5,margin:true}},{mutate:true});
      S.phase='ROLL'; ns.ui.render();
      const sheet=document.getElementById('sheet').innerText;
      ns.ui.showStockMarket();
      const mkt=[...document.querySelectorAll('.overlay')].pop().innerText;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return {sheetMargin: sheet.includes('融資'), sheetRate: sheet.includes('維持率'),
        mktCash: mkt.includes('現股'), mktMargin: mkt.includes('融資')&&mkt.includes('維持率'), mktClose: mkt.includes('平倉')};
    });

    // 說明書連結與版本（showRules）
    const rules=await page.evaluate(()=>{
      ns.ui.showRules(false);
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const links=[...ov.querySelectorAll('a')].map(a=>a.getAttribute('href'));
      const ok={quick:links.includes('FinFlow_快速上手指南.pdf'), full:links.includes('FinFlow_完整規則手冊.pdf'),
        ver: ov.innerText.includes(ns.BUILD.ver)};
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return ok;
    });
    await page.screenshot({path:`s7_main_${w}x${h}.png`});

    const checks={
      setupVer, ...base,
      autoRolled: afterAuto.phase!=='ROLL'||afterAuto.actions>0,
      deckSkipBtn: deck.skip, skipWorked: skipRes.passed>=1,
      pickGrid: pick.grid, pickSideBySide: pick.sideBySide, pickNoScroll: pick.noScroll, pickFits: pick.fits,
      ...margin, ...rules,
      noErrors: errs.length===0
    };
    const GOODFALSE=new Set(["hscroll"]);
    const bad=Object.entries(checks).filter(([k,v])=>GOODFALSE.has(k)?v!==false:(v===false||v===null||v===0));
    console.log(`=== ${w}x${h} ===`);
    console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', ')); }
    if(errs.length) console.log('  errors:', errs.slice(0,5));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE7 FAIL（${fail} 個解析度有問題）`:'\nSMOKE7 全部通過');
  process.exit(fail?1:0);
})();

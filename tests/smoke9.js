// 八期煙霧測試：資產一致、灰化、訊息格式、新局重置、地圖跟隨、頂列併入、交易所、信用移位、去重
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

    // ⑥ 頂列併入操作區
    await page.evaluate(()=>{
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      ns.ui.start({npcs:3,preset:'STANDARD',modules:['M2','M4','M6'],professionId:'PRO_ENGINEER',
        dreamCardId:ns.content.dreams[0].id,seed:31337},{d:2,v:2,a:2,m:['M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove()); ns.ui.render();
    });
    const layout=await page.evaluate(()=>({
      noTopbar: !document.getElementById('topbar'),
      iconsInOps: !!document.querySelector('#opsBox #opsIcons #btnDev') &&
                  !!document.querySelector('#opsBox #opsIcons #btnHelp') &&
                  !!document.querySelector('#opsBox #opsIcons #btnSim'),
      hscroll: document.body.scrollWidth > document.documentElement.clientWidth+2
    }));

    // ② 未開啟功能灰化（本局未開 M1）
    const grey=await page.evaluate(()=>{
      const b=document.getElementById('btnStockOp');
      return {disabled:b.disabled, hasReason:/未開啟股市/.test(b.title),
        greyStyle: parseFloat(getComputedStyle(b).opacity)<0.6};
    });

    // ⑦ 交易所：NPC 回合按下要有提示、不得靜默
    const exch=await page.evaluate(()=>{
      const S=ns.ui.S; S.activePlayerIdx=1; ns.ui.render();
      const disabledOnNpc=document.getElementById('btnExchange').disabled;
      ns.ui.showTradePanel();                       // 防守路徑：直接呼叫也要有提示
      const toasted=document.getElementById('toast').textContent.indexOf('自己的回合')>=0;
      S.activePlayerIdx=0; S.phase='ROLL'; ns.ui.render();
      ns.ui.showTradePanel();
      const opens=document.querySelectorAll('.overlay').length>0;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return {disabledOnNpc, toasted, opens};
    });

    // ① 資產一致：只持有股票時，右欄資產細項也要看得到（合計列）
    const asset=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine; let p=S.players[0];
      S.enabledModules.push('M1'); S.config.depthLevel=3;
      S.phase='ROLL'; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null;
      ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:3000,label:'x'}],{eduTags:['setup']});
      const sym=ns.content.stockDefs[0].symbol;
      E.apply(S,{type:'TRADE_STOCK',playerId:0,payload:{symbol:sym,side:'buy',units:6}},{mutate:true});
      S.phase='ROLL'; ns.ui.render();
      const sheetTxt=document.getElementById('sheet').innerText;
      ns.ui.showDetails(S.players[0]);
      const modalTxt=[...document.querySelectorAll('.overlay')].pop().innerText;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const stockName=ns.engine.stockName(S,sym);
      return {sheetHasStock: sheetTxt.includes('股票合計'),
        sheetNoEmptyAsset: !/資產細項\s*（無）/.test(sheetTxt.replace(/\n/g,'')),
        modalHasStock: modalTxt.includes(stockName)};
    });

    // ⑧ 信用移到個人面板
    const credit=await page.evaluate(()=>({
      inSheet: document.getElementById('sheet').innerText.includes('尚可借'),
      notInMid: !document.getElementById('infoDyn').innerText.includes('尚可借')
    }));

    // ③⑤ 訊息格式與地圖跟隨
    const play=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine;
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';S.activePlayerIdx=0;
      const r=E.apply(S,{type:'ROLL_DICE',playerId:0,payload:null});
      ns.ui.S=r.state; ns.ui.handleEvents(r.events); ns.ui.render();
      const feed=ns.ui.feed.map(f=>f.msg);
      // NPC 進夢想圈後移動
      const S2=ns.ui.S, q=S2.players[2];
      ns.ledger.post(S2,q,'補被動',[{account:'INCOME_PASSIVE',delta:q.derived.totalExpenses+100,label:'x'}],{eduTags:['setup']});
      E.checkFreedom(S2,q); E.enterOuterCircle(S2,q); E.doMove(S2,q,5);
      S2.decisionQueue=[];S2.pendingDecision=null;S2.phase='ROLL';S2.activePlayerIdx=0;
      ns.ui.render();
      const cells=[...document.querySelectorAll('#boardSvg g')].filter(g=>g.getAttribute('opacity'));
      const pawns=[...document.querySelectorAll('#boardSvg circle.pawn')]
        .map(c=>({x:+c.getAttribute('cx'),y:+c.getAttribute('cy')}));
      const outerPawns=pawns.filter(pt=>pt.y>430);
      let minD=999;
      cells.forEach(g=>{const rc=g.querySelector('rect');
        const cx=+rc.getAttribute('x')+ +rc.getAttribute('width')/2, cy=+rc.getAttribute('y')+ +rc.getAttribute('height')/2;
        outerPawns.forEach(pt=>{const d=Math.hypot(pt.x-cx,pt.y-cy); if(d<minD) minD=d;});});
      return {diceFormat: feed.some(m=>/擲 \d 點 → /.test(m)),
        outerPawn: outerPawns.length===1, pawnOnCell: minD<=14, minD:Math.round(minD)};
    });

    // 全部 › 完整日誌
    const fullLog=await page.evaluate(()=>{
      ns.ui.showFullLog();
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const ok=ov.innerText.includes('系統訊息（完整）');
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return ok;
    });

    // ④ 新局重置
    const restart=await page.evaluate(()=>{
      ns.ui.start({npcs:2,preset:'STANDARD',modules:['M1','M2','M4','M6'],professionId:'PRO_NURSE',
        dreamCardId:ns.content.dreams[1].id,seed:4242},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove()); ns.ui.render();
      return {feedEmpty: ns.ui.feed.length===0, lastActEmpty: Object.keys(ns.ui.lastAct).length===0,
        viewReset: ns.ui.viewPlayerId===null, turn: ns.ui.S.turnNumber};
    });
    await page.screenshot({path:`s9_${w}x${h}.png`});

    const checks={...layout, stockGrey:grey.disabled, greyReason:grey.hasReason, greyStyle:grey.greyStyle,
      exchDisabledOnNpc:exch.disabledOnNpc, exchToast:exch.toasted, exchOpens:exch.opens,
      assetSheetStock:asset.sheetHasStock, assetNoEmpty:asset.sheetNoEmptyAsset, assetModal:asset.modalHasStock,
      creditInSheet:credit.inSheet, creditNotInMid:credit.notInMid,
      diceFormat:play.diceFormat, outerPawn:play.outerPawn, pawnOnCell:play.pawnOnCell,
      fullLog, feedReset:restart.feedEmpty, lastActReset:restart.lastActEmpty, viewReset:restart.viewReset,
      noErrors: errs.length===0};
    const GOODFALSE=new Set(['hscroll','creditNotInMid','assetNoEmpty','feedReset','lastActReset','viewReset']);
    const bad=Object.entries(checks).filter(([k,v])=>{
      if(k==='hscroll') return v!==false;
      return v===false||v===null;
    });
    console.log(`=== ${w}x${h} ===`); console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', '), 'minD=',play.minD); }
    if(errs.length) console.log('  errors:', errs.slice(0,4));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE9 FAIL（${fail}）`:'\nSMOKE9 全部通過');
  process.exit(fail?1:0);
})();

// V11 煙霧測試：破產流程、獲勝雙條件、夢想里程碑
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
        dreamCardId:ns.content.dreams[2].id,seed:1111},{d:3,v:2,a:2,m:['M1','M2','M3','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const S=ns.ui.S; S.phase='ROLL'; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null;
      ns.ui.render();
    });

    // ① 破產卡：還差多少、標記夠用、紓困、P2P
    const bank=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      function add(val,inc,nm){ const id=ns.util.uid(S,'A');
        p.assets.push({instanceId:id,cardId:'X',kind:'REALESTATE',name:nm,units:1,costBasis:val,
          marketValue:val,monthlyIncome:inc,linkedLiabilityId:null,flags:{}});
        ns.ledger.post(S,p,'建檔',[{account:'ASSET',delta:val,refId:id,label:nm},
          {account:'INCOME_PASSIVE',delta:inc,refId:id,label:'租金'}],{eduTags:['setup']}); return id; }
      add(900,9,'大房'); add(200,2,'小房');
      ns.ledger.post(S,p,'設現金',[{account:'CASH',delta:-(p.cash+100),label:'x'}],{eduTags:['setup']});
      E.enterBankruptcy(S,p); E.syncPhase(S); ns.ui.render();
      const t=document.getElementById('center').innerText;
      const btns=[...document.querySelectorAll('#center button')].map(b=>b.textContent);
      return {needShown:/還差/.test(t), noSellAll:/不必全部賣光/.test(t),
        enoughMark:/賣這一筆就夠了/.test(t),
        rescue:btns.some(b=>/紓困/.test(b)), p2p:btns.some(b=>/P2P/.test(b)),
        firstIsSmall:/急售：小房/.test(btns[0]||'')};
    });

    // 賣光資產後仍有紓困／P2P（舊版會直接判出局）
    const lastResort=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      p.assets=[]; 
      ns.ledger.post(S,p,'設現金',[{account:'CASH',delta:-(p.cash+80),label:'x'}],{eduTags:['setup']});
      E.enterBankruptcy(S,p); E.checkRescued(S,p); E.syncPhase(S); ns.ui.render();
      const btns=[...document.querySelectorAll('#center button')].map(b=>b.textContent);
      return {notOut:!p.bankrupt, stillBankruptcyPhase:S.phase==='BANKRUPTCY',
        rescue:btns.some(b=>/紓困/.test(b)), p2p:btns.some(b=>/P2P/.test(b)),
        cap:E.rescueCap(S,p)};
    });
    // P2P 面板在破產程序中可開且預設借款模式
    const p2pPanel=await page.evaluate(()=>{
      ns.ui.showP2PPanel(true);
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const ok=ov? /民間借貸/.test(ov.innerText) : false;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return ok;
    });

    // ② 獲勝雙條件顯示
    const win=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';
      ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:9000,label:'x'}],{eduTags:['setup']});
      ns.ledger.post(S,p,'補被動',[{account:'INCOME_PASSIVE',delta:p.derived.totalExpenses+300,label:'x'}],{eduTags:['setup']});
      E.checkFreedom(S,p); E.enterOuterCircle(S,p);
      p.dreamProgress=S.config.dreamCost; p.stats.mallJoy=0; p.childrenCount=0;
      ['TEMPER','PRUDENCE','PARENTING','FILIAL'].forEach(a=>p.virtues[a]=0);
      ns.ui.render();
      const t=document.getElementById('sheet').innerText;
      return {row:/獲勝條件/.test(t), both:/夢想/.test(t)&&/幸福感/.test(t),
        hint:/夢想已集滿，但幸福感還差/.test(t), need:E.winWellbeingMin(S),
        notWon:S.over!==true};
    });

    // ③ 夢想里程碑：進度事件與公告帶出具體內容
    const dream=await page.evaluate(()=>{
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      p.dreamProgress=0; p.boughtProgressThisTurn=false; S.over=false;
      const dr=ns.content.byId[p.dreamCardId];
      E._events=[]; E.buyDreamProgress(S,p);
      const evs=E._events.slice();
      ns.ui.handleEvents(evs);
      const bc=document.querySelector('#bcast .bc');
      const bcTxt=bc?bc.innerText:'';
      const feed=ns.ui.feed.map(f=>f.msg).join(' | ');
      document.querySelectorAll('#bcast .bc').forEach(x=>x.remove());
      return {milestone:dr.milestones[0], inBroadcast:bcTxt.includes(dr.milestones[0]),
        inFeed:feed.includes(dr.milestones[0]), dreamNamed:bcTxt.includes(dr.name),
        allDreamsHaveMs:ns.content.dreams.every(d=>d.milestones&&d.milestones.length>=5)};
    });
    await page.screenshot({path:`s12_${w}x${h}.png`});

    const checks={bankNeed:bank.needShown, bankNoSellAll:bank.noSellAll, bankEnoughMark:bank.enoughMark,
      bankRescue:bank.rescue, bankP2P:bank.p2p, bankSortSmallest:bank.firstIsSmall,
      lastNotOut:lastResort.notOut, lastRescueBtn:lastResort.rescue, lastP2PBtn:lastResort.p2p,
      lastCapPositive:lastResort.cap>0, p2pPanelOpens:p2pPanel,
      winRow:win.row, winBoth:win.both, winHint:win.hint, winGate:win.notWon, winNeed:win.need===10,
      msInBroadcast:dream.inBroadcast, msInFeed:dream.inFeed, msDreamNamed:dream.dreamNamed,
      msAllDreams:dream.allDreamsHaveMs,
      noErrors:errs.length===0};
    const bad=Object.entries(checks).filter(([k,v])=>!v);
    console.log(`=== ${w}x${h} ===`); console.log(JSON.stringify(checks));
    if(bad.length){ fail++; console.log('  ✗ FAIL:', bad.map(b=>b[0]).join(', ')); }
    if(errs.length) console.log('  errors:', errs.slice(0,4));
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE12 FAIL（${fail}）`:'\nSMOKE12 全部通過');
  process.exit(fail?1:0);
})();

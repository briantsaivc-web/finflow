const { chromium } = require('playwright');
/* S39 多玩家集資（Brian 裁示：做；一輪內湊不滿就流標）
     發起人在 BUY 決策上設自己的持份、剩餘廣播；真人（含非回合）與電腦都可認購，先到先得；
     湊滿即成交（每人一份獨立資產，持份等比例、尾差歸發起人）；
     發起人下一次回合開始前沒湊滿 → 電腦先補位，仍不足就流標，機會回到發起人手上。
   用法（repo 根目錄）： node tests/s39test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    const MODS=["M1","M2","M3","M4","M6","M8"];
    // 兩個真人＋兩台電腦，才驗得到「非回合認購」與「電腦補位」
    const four=["我","小美","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>=2,
      personality:["","","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||3900, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const card=id=>ns.content.byId[id];
    const cashTo=(S,p,v)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:util.r2(v-p.cash),label:"x"}],{eduTags:["setup"]});
    const rejWhy=r=>(r.events||[]).filter(e=>e.type==="ACTION_REJECTED").map(e=>e.reason).pop();
    // 把一張大額卡塞成 0 號的 BUY 決策
    const openBuy=(S,p,cid)=>{ S.decisionQueue=[]; S.pendingDecision=null; S.activePlayerIdx=p.id; S.turnResolved=true;
      E.pushDecision(S,p,{kind:"BUY",cardId:cid}); S.pendingDecision=S.decisionQueue[0]; S.phase="DECISION"; };
    const BIG="OPL_RE1";   // 台中七期兩房：price 12000、頭期 15%

    step("發起：BUY 決策上按「發起集資」→ 決策消失、pendingSyndicate 掛起、發起人回合可以繼續",()=>{
      const S=fresh(3901), p=S.players[0]; cashTo(S,p,1500);
      openBuy(S,p,BIG);
      const bad=E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.1}},{mutate:true});
      A(bad.rejected && rejWhy(bad)==="BAD_SHARE","低於最低持份應被拒，實得 "+rejWhy(bad));
      const r=E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      A(!r.rejected,"發起應成功，實得 "+rejWhy(r));
      A(S.pendingSyndicate && S.pendingSyndicate.fromId===0 && S.pendingSyndicate.shares[0]===0.4,"應掛起 pendingSyndicate");
      A(!S.decisionQueue.some(d=>d.kind==="BUY"),"BUY 決策應被收掉（機會先擱著）");
      A(Math.abs(E.syndicateRemaining(S.pendingSyndicate)-0.6)<1e-9,"剩餘應為 60%");
      A(r.events.some(e=>e.type==="SYNDICATE_OPENED"),"要發 SYNDICATE_OPENED");
      const again=E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      A(again.rejected,"同時只能有一場集資");
      return "自己 40%、開放 60%";
    });
    step("認購：另一位真人在非回合認購 30%；持份越界、發起人自己認購、重複認購都被拒",()=>{
      const S=fresh(3902), p=S.players[0], q=S.players[1]; cashTo(S,p,1500); cashTo(S,q,1500);
      openBuy(S,p,BIG);
      A(!E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true}).rejected,"發起");
      // 現在還是 0 號的回合：1 號非回合認購
      const r1=E.apply(S,{type:"JOIN_SYNDICATE",playerId:1,payload:{share:0.3}},{mutate:true});
      A(!r1.rejected,"非回合認購應放行，實得 "+rejWhy(r1));
      A(S.pendingSyndicate.shares[1]===0.3 && Math.abs(E.syndicateRemaining(S.pendingSyndicate)-0.3)<1e-9,"剩 30%");
      const r2=E.apply(S,{type:"JOIN_SYNDICATE",playerId:1,payload:{share:0.1}},{mutate:true});
      A(r2.rejected && rejWhy(r2)==="ALREADY_IN","同一人不能認購第二次");
      const r3=E.apply(S,{type:"JOIN_SYNDICATE",playerId:0,payload:{share:0.1}},{mutate:true});
      A(r3.rejected,"發起人不能自己認購");
      const S2=fresh(3902), p2=S2.players[0], q2=S2.players[1]; cashTo(S2,p2,1500); cashTo(S2,q2,1500); openBuy(S2,p2,BIG);
      E.apply(S2,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      const r4=E.apply(S2,{type:"JOIN_SYNDICATE",playerId:1,payload:{share:0.7}},{mutate:true});
      A(r4.rejected && rejWhy(r4)==="BAD_SHARE","超過剩餘持份應被拒");
      return "30% 認購成功；重複／自購／越界被拒";
    });
    step("湊滿即成交：三方持份 40／30／30，每人一份資產，價格與月租拆分加總等於卡面（尾差歸發起人）",()=>{
      const S=fresh(3903), p=S.players[0], q=S.players[1], n=S.players[2];
      [p,q,n].forEach(x=>cashTo(S,x,2000));
      openBuy(S,p,BIG);
      E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      E.apply(S,{type:"JOIN_SYNDICATE",playerId:1,payload:{share:0.3}},{mutate:true});
      // 電腦也可以由引擎直接補位（這裡用引擎函式模擬「電腦認購 30%」）
      const rN=E.apply(S,{type:"JOIN_SYNDICATE",playerId:2,payload:{share:0.3}},{mutate:true});
      A(!rN.rejected,"第三人認購應成功，實得 "+rejWhy(rN));
      A(!S.pendingSyndicate,"湊滿應立即成交、清掉 pending");
      A(rN.events.some(e=>e.type==="SYNDICATE_FORMED"),"要發 SYNDICATE_FORMED");
      const pl=card(BIG).payload;
      const own=[p,q,n].map(x=>x.assets.filter(a=>a.cardId===BIG && a.syndicate)[0]);
      A(own.every(Boolean),"三人都要拿到自己那一份");
      const sumPrice=own.reduce((t,a)=>t+a.costBasis,0);
      A(Math.abs(sumPrice-pl.price)<0.01,"三份價格加總應等於卡面 "+pl.price+"，實得 "+sumPrice);
      const sumInc=own.reduce((t,a)=>t+a.monthlyIncome,0);
      const fullInc=util.r2(pl.monthlyRent*S.config.assetIncomeMult-pl.monthlyCost);
      A(Math.abs(sumInc-fullInc)<0.05,"三份月現金流加總應等於整筆 "+fullInc+"，實得 "+sumInc);
      A(own[0].sharePct===0.4 && own[1].sharePct===0.3 && own[2].sharePct===0.3 && own.every(a=>a.jvGroupId===own[0].jvGroupId),"持份與同一個 jvGroupId");
      A(/持份 40%/.test(own[0].name),"資產名稱要帶持份");
      return "價格 "+sumPrice+"＝卡面；月現金流 "+sumInc+"＝整筆";
    });
    step("一輪內沒湊滿：發起人下一次回合開始時電腦先補位，補得滿就成交",()=>{
      const S=fresh(3904,{npcSkillCap:0}), p=S.players[0]; cashTo(S,p,2000);
      // 兩台電腦給足現金，讓它們補得起 60%
      cashTo(S,S.players[2],3000); cashTo(S,S.players[3],3000);   // 現金要走分錄（recompute 會從帳上重算）
      openBuy(S,p,BIG);
      E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      const opened=S.turnNumber;
      // 模擬過了一輪：輪到發起人、輪次 +1
      S.turnNumber=opened+1; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null; S.turnResolved=false; S.phase="ROLL";
      const evs=[]; const o=E.ev; E.ev=(t,d)=>{ const r=o(t,d); evs.push(t); return r; };
      E.beginTurn(S); E.ev=o;
      A(!S.pendingSyndicate,"結算後應清掉 pending");
      A(evs.indexOf("SYNDICATE_FORMED")>=0,"電腦補位後應成交，實得事件 "+evs.filter(t=>/SYNDICATE/.test(t)).join(","));
      const mine=p.assets.filter(a=>a.cardId===BIG)[0];
      A(mine && mine.sharePct===0.4,"發起人拿到 40%");
      const npcShare=S.players.slice(2).reduce((t,x)=>t+x.assets.filter(a=>a.cardId===BIG).reduce((u,a)=>u+a.sharePct,0),0);
      A(Math.abs(npcShare-0.6)<1e-9,"電腦合計補 60%，實得 "+npcShare);
      return "電腦補位 "+npcShare*100+"% → 成交";
    });
    step("流標：電腦也出不起 → 流標，機會回到發起人手上（重新出現 BUY 決策）",()=>{
      const S=fresh(3905), p=S.players[0]; cashTo(S,p,2000);
      cashTo(S,S.players[2],5); cashTo(S,S.players[3],5);
      openBuy(S,p,BIG);
      E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      S.turnNumber++; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null; S.turnResolved=false; S.phase="ROLL";
      const evs=[]; const o=E.ev; E.ev=(t,d)=>{ const r=o(t,d); evs.push(r); return r; };
      E.beginTurn(S); E.ev=o;
      const failed=evs.filter(e=>e.type==="SYNDICATE_FAILED")[0];
      A(failed && failed.reason==="unfilled","應流標（unfilled），實得 "+JSON.stringify(failed));
      A(!S.pendingSyndicate,"流標後清掉 pending");
      A(S.decisionQueue.some(d=>d.kind==="BUY" && d.cardId===BIG && d.fromSyndicate),"機會要回到發起人手上（BUY 決策重新出現）");
      A(p.assets.filter(a=>a.cardId===BIG).length===0,"流標不該產生任何資產");
      return "流標 → BUY 決策回到 0 號";
    });
    step("婉拒：記在 declined，介面不再提醒；結算時電腦仍可補位",()=>{
      const S=fresh(3906), p=S.players[0], q=S.players[1]; cashTo(S,p,2000); cashTo(S,q,2000);
      openBuy(S,p,BIG);
      E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      const r=E.apply(S,{type:"DECLINE_SYNDICATE",playerId:1,payload:null},{mutate:true});
      A(!r.rejected && S.pendingSyndicate.declined[1]===1,"婉拒應記錄");
      const savedMp=ui.mp; ui.mp={mode:true, seat:1};
      try{ close(); ui.showSyndicateOffer(S.pendingSyndicate); A(!document.querySelector('#overlays .overlay'),"婉拒後不該再彈面板"); }
      finally{ ui.mp=savedMp; }
      return "declined[1]=1、面板不再彈";
    });
    step("介面：BUY 決策卡有「發起集資」；發起面板與認購面板開得起來",()=>{
      const S=fresh(3907), p=S.players[0], q=S.players[1]; cashTo(S,p,2000); cashTo(S,q,2000);
      const btns=ui.oppDealBtns(card(BIG));
      A(btns.some(b=>/發起集資/.test(b.textContent)),"處置按鈕應有「發起集資」");
      close(); ui.showSyndicatePanel(card(BIG));
      const ov=document.querySelector('#overlays .overlay');
      A(ov && /發起集資/.test(ov.textContent) && /流標/.test(ov.textContent),"發起面板要說明流標規則");
      A(ov.querySelector('input[type=range]'),"要有持份滑桿");
      close();
      openBuy(S,p,BIG);
      E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
      const savedMp2=ui.mp; ui.mp={mode:true, seat:1};
      try{
        close(); ui.showSyndicateOffer(S.pendingSyndicate);
        const ov2=document.querySelector('#overlays .overlay');
        A(ov2 && /發起集資/.test(ov2.textContent) && /還剩/.test(ov2.textContent),"認購面板要開得起來並寫剩多少");
        const rng=ov2.querySelector('input[type=range]'); A(rng && +rng.max===60,"滑桿上限應為剩餘 60%，實得 "+(rng&&rng.max));
        close();
        ui.render();
        A(/集資進行中/.test(document.getElementById('infoM')?document.getElementById('infoM').textContent:document.body.textContent),"交易所要列出進行中的集資");
      } finally { ui.mp=savedMp2; }
      return "按鈕、發起面板、認購面板、交易所列示";
    });
    step("決定論：同種子同動作序列（含集資）重放一致",()=>{
      const run=()=>{ const S=fresh(3908), p=S.players[0], q=S.players[1]; cashTo(S,p,2000); cashTo(S,q,2000);
        cashTo(S,S.players[2],3000);
        openBuy(S,p,BIG);
        E.apply(S,{type:"PROPOSE_SYNDICATE",playerId:0,payload:{cardId:BIG,myShare:0.4}},{mutate:true});
        E.apply(S,{type:"JOIN_SYNDICATE",playerId:1,payload:{share:0.2}},{mutate:true});
        S.turnNumber++; S.activePlayerIdx=0; S.decisionQueue=[]; S.pendingDecision=null; S.turnResolved=false; S.phase="ROLL";
        E.beginTurn(S);
        return JSON.stringify(S.players.map(x=>[x.cash, x.assets.map(a=>[a.cardId,a.sharePct,a.costBasis])]))+"|"+S.rngState; };
      const a=run(), b=run();
      A(a===b,"兩次結果應一致");
      return "一致";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;
  if(errs.length) errs.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

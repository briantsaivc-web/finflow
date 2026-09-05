const { chromium } = require('playwright');
/* S42：Gemini 除錯報告覆驗後的五項修復（Brian 2026-09-06 定案，A 案）
     ① 非回合真人破產不再當場推決策（會被白名單擋成死結），先記在身上、輪到他再推；
        外圈跌落（FREEFALL_RESCUE）同一紀律；電腦玩家與當前玩家行為不變
     ② REPAY_LOAN／TAKE_LOAN 金額必須是有限正數（NaN／undefined 不再污染現金）
     ③ BUY_DREAM_PROGRESS 先驗資再 accept，不留無效紀錄
     ④ makePlayer 壞職業代號退回第一個職業並發 PROFESSION_FALLBACK，不白屏
     ⑤ 房產 LTV 分母除零防禦（靜態一行，這裡只驗不產 NaN）
   用法（repo 根目錄）： node tests/s42test.js */
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
    const MODS=["M1","M2","M3","M4","M6","M8","M9"];
    const pros=ns.content.professions;
    const three=(h1)=>[{name:"我",isNPC:false,personality:"",professionId:pros[0].id,dreamCardId:ns.content.dreams[0].id},
      {name:"友",isNPC:!h1,personality:h1?"":"NPC_SAFE",professionId:pros[4].id,dreamCardId:ns.content.dreams[1].id},
      {name:"電腦",isNPC:true,personality:"NPC_SAFE",professionId:pros[8].id,dreamCardId:ns.content.dreams[2].id}];
    const fresh=(seed,ov,h1)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||4200, c, MODS, three(h1===undefined?true:h1), {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const rej=(r)=>{ const e=(r.events||[]).filter(x=>x.type==="ACTION_REJECTED")[0]; return r.rejected?(e?e.reason:"?"):null; };
    const ap=(S,a)=>E.apply(S,a,{mutate:true});
    const house=(p,id)=>{ p.assets.push({instanceId:id,cardId:null,kind:"REALESTATE",name:"測試房",units:1,costBasis:500,marketValue:500,monthlyIncome:5,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(ui.S,p,"測試建倉",[{account:"ASSET",delta:500,refId:id,label:"x"}],{}); };
    const futFor=(S,p,lotsN)=>{ const fd=ns.content.futuresDefs[0]; const price=E.futPrice(S,fd);
      const margin=util.r2(E.futContractValue(S,fd)*lotsN*E.futMarginPct(S,fd));
      p.assets.push({instanceId:"F_"+p.id,cardId:null,kind:"FUTURES",name:fd.name+"（多）",symbol:fd.symbol,side:"long",lots:lotsN,units:lotsN,
        entryPrice:price,lastPrice:price,costBasis:margin,marketValue:margin,monthlyIncome:0,ownCash:margin,linkedLiabilityId:null,flags:{futures:true}});
      ns.ledger.post(S,p,"測試建倉",[{account:"ASSET",delta:margin,refId:"F_"+p.id,label:"x"}],{});
      return {fd,margin}; };

    /* ---------- ① 非回合真人破產遞延 ---------- */
    step("①-1 期貨強平打到非回合真人：不推決策、記 pendingBankruptcy、當前玩家照常擲骰",()=>{
      const S=fresh(4201,{futAutoTopUp:0}); A(S.activePlayerIdx===0,"應輪到 P0");
      const p1=S.players[1]; A(!p1.isNPC,"P1 應為真人");
      const {fd,margin}=futFor(S,p1,2); p1.cash=util.r2(margin*0.3);
      const u0=E.stockPrice(S,fd.underlying); S.stockPrices[fd.underlying]=util.r2(u0*0.8);
      E.tickFutures(S); E.syncPhase(S);
      A(p1.cash<0,"P1 現金應為負，實得 "+p1.cash);
      A(S.phase!=="BANKRUPTCY","階段不該是 BANKRUPTCY，實得 "+S.phase);
      A(p1.pendingBankruptcy===true,"P1 應記 pendingBankruptcy");
      A(!S.decisionQueue.some(d=>d.kind==="BANKRUPTCY"),"不該有破產決策在佇列");
      const r=ap(S,{type:"ROLL_DICE",playerId:0,payload:null}); A(!r.rejected,"P0 擲骰應通過，實得 "+rej(r));
      return "P1 cash "+p1.cash+"，phase "+S.phase; });
    step("①-2 輪到他自己：推破產決策、當事人急售能通過並脫離",()=>{
      const S=fresh(4202,{futAutoTopUp:0,fixedPayday:0}); const p1=S.players[1];
      house(p1,"H1"); p1.cash=-300; E.enterBankruptcy(S,p1);
      A(p1.pendingBankruptcy===true,"非回合應遞延");
      S.activePlayerIdx=1; S.turnResolved=false; E.beginTurn(S);
      A(p1.pendingBankruptcy===undefined,"旗標應清除");
      A(S.phase==="BANKRUPTCY","輪到他應進破產程序，實得 "+S.phase);
      A(S.pendingDecision && S.pendingDecision.playerId===1,"決策擁有者應為 P1");
      const r=ap(S,{type:"SELL_ASSET",playerId:1,payload:{assetId:"H1"}}); A(!r.rejected,"當事人急售應通過，實得 "+rej(r));
      A(p1.cash>=0,"急售後應回正，實得 "+p1.cash);
      A(S.phase!=="BANKRUPTCY","應脫離破產，實得 "+S.phase);
      return "cash "+p1.cash+"，phase "+S.phase; });
    step("①-3 輪到他之前已回正：不推破產",()=>{
      const S=fresh(4203,{fixedPayday:0}); const p1=S.players[1];
      p1.cash=-20; E.enterBankruptcy(S,p1); A(p1.pendingBankruptcy===true,"應遞延");
      p1.cash=50;  // 期間別人還他 P2P 之類
      S.activePlayerIdx=1; S.turnResolved=false; E.beginTurn(S);
      A(p1.pendingBankruptcy===undefined,"旗標應清除"); A(S.phase!=="BANKRUPTCY","已回正不該進破產，實得 "+S.phase);
      return "phase "+S.phase; });
    step("①-4 外圈非回合真人：同樣遞延，輪到他推 FREEFALL_RESCUE",()=>{
      const S=fresh(4204,{fixedPayday:0}); const p1=S.players[1];
      p1.playerStage="OUTER"; house(p1,"H2"); p1.cash=-300; E.enterBankruptcy(S,p1);
      A(p1.pendingBankruptcy===true,"外圈非回合應遞延"); A(!S.decisionQueue.some(d=>d.kind==="FREEFALL_RESCUE"),"不該當場推跌落決策");
      S.activePlayerIdx=1; S.turnResolved=false; E.beginTurn(S);
      A(S.decisionQueue.some(d=>d.kind==="FREEFALL_RESCUE" && d.playerId===1),"輪到他應推 FREEFALL_RESCUE");
      A(S.phase==="DECISION","階段應為 DECISION，實得 "+S.phase);
      return "phase "+S.phase; });
    step("①-5 當前玩家自己破產：行為不變，當場進破產",()=>{
      const S=fresh(4205); const p0=S.players[0]; house(p0,"H3"); p0.cash=-100; E.enterBankruptcy(S,p0); E.syncPhase(S);
      A(!p0.pendingBankruptcy,"當前玩家不遞延"); A(S.phase==="BANKRUPTCY","應當場進破產，實得 "+S.phase);
      return "phase "+S.phase; });
    step("①-6 電腦玩家非回合：行為不變，走 npcRescue 不遞延",()=>{
      const S=fresh(4206,null,false); const p1=S.players[1]; A(p1.isNPC,"P1 應為電腦");
      house(p1,"H4"); p1.cash=-100; E.enterBankruptcy(S,p1);
      A(!p1.pendingBankruptcy,"電腦不遞延"); A(p1.cash>=0 || p1.bankrupt,"電腦應當場急售回正或出局，cash "+p1.cash);
      return "cash "+p1.cash; });

    /* ---------- ② 金額防禦 ---------- */
    step("② TAKE_LOAN：NaN／undefined／字串／負數／Infinity／null 全部 BAD_AMOUNT 且現金不變",()=>{
      const S=fresh(4207); const p0=S.players[0]; const c0=p0.cash; const bad=[NaN,undefined,"50","abc",-5,Infinity,null,0];
      bad.forEach(v=>{ const r=ap(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:v}}); A(r.rejected && rej(r)==="BAD_AMOUNT","amount="+String(v)+" 應 BAD_AMOUNT，實得 "+rej(r)); });
      const r2=ap(S,{type:"TAKE_LOAN",playerId:0,payload:null}); A(rej(r2)==="BAD_AMOUNT","payload null 應 BAD_AMOUNT");
      A(p0.cash===c0 && isFinite(p0.cash),"現金應不變且有限，實得 "+p0.cash);
      const ok=ap(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:100}}); A(!ok.rejected,"正常借款應通過，實得 "+rej(ok));
      A(p0.cash===util.r2(c0+100),"借 100 後現金應 +100");
      const big=ap(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:1e9}}); A(!big.rejected || rej(big)==="NO_CAPACITY","超額仍走原本封頂／NO_CAPACITY，實得 "+rej(big));
      return "cash "+p0.cash; });
    step("② REPAY_LOAN：同一套防禦；正常還款仍可",()=>{
      const S=fresh(4208); const p0=S.players[0];
      ap(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:100}}); const l=p0.liabilities[p0.liabilities.length-1]; const c0=p0.cash, pr=l.principal;
      [NaN,undefined,"abc",-1,Infinity,0].forEach(v=>{ const r=ap(S,{type:"REPAY_LOAN",playerId:0,payload:{liabilityId:l.instanceId,amount:v}}); A(rej(r)==="BAD_AMOUNT","amount="+String(v)+" 應 BAD_AMOUNT，實得 "+rej(r)); });
      A(p0.cash===c0 && l.principal===pr,"現金與本金應不變");
      const ok=ap(S,{type:"REPAY_LOAN",playerId:0,payload:{liabilityId:l.instanceId,amount:30}}); A(!ok.rejected,"正常還款應通過，實得 "+rej(ok));
      A(isFinite(p0.cash) && p0.cash===util.r2(c0-30),"還 30 後現金應 −30");
      return "cash "+p0.cash+"，principal "+l.principal; });

    /* ---------- ③ 購點驗資 ---------- */
    step("③ BUY_DREAM_PROGRESS：現金不足 NO_CASH、actionLog 不增；有錢照買",()=>{
      const S=fresh(4209); const p0=S.players[0]; p0.playerStage="OUTER"; p0.cash=0; E.syncPhase(S);
      const n0=S.actionLog.length; const r=ap(S,{type:"BUY_DREAM_PROGRESS",playerId:0,payload:null});
      A(rej(r)==="NO_CASH","應 NO_CASH，實得 "+rej(r)); A(S.actionLog.length===n0,"不該留紀錄");
      p0.cash=util.r2(E.dreamProgressPrice(S,p0)+1); const ok=ap(S,{type:"BUY_DREAM_PROGRESS",playerId:0,payload:null});
      A(!ok.rejected && p0.dreamProgress===1,"有錢應買到 1 點，實得 "+rej(ok)+" progress "+p0.dreamProgress);
      return "progress "+p0.dreamProgress; });

    /* ---------- ④ 壞職業代號 ---------- */
    step("④ makePlayer：壞職業代號不拋錯、退回第一個職業、發 PROFESSION_FALLBACK",()=>{
      E._events=[];
      const S=E.newGame({seed:1,config:util.clone(cfg),modules:["M1"],players:[{name:"X",professionId:"PRO_NOPE"},{name:"Y",professionId:pros[1].id}]});
      A(S.players[0].professionId===pros[0].id,"應退回 "+pros[0].id+"，實得 "+S.players[0].professionId);
      A(S.players[1].professionId===pros[1].id,"正常玩家不受影響");
      const ev=E._events.filter(e=>e.type==="PROFESSION_FALLBACK")[0]; A(ev && ev.badId==="PRO_NOPE" && ev.playerId===0,"應有 PROFESSION_FALLBACK 事件");
      return "fallback → "+S.players[0].professionId; });

    /* ---------- ⑤ LTV 分母 ---------- */
    step("⑤ 房產 price=0 的卡走貸款買：不產 NaN（靜態一行的煙霧測試）",()=>{
      const S=fresh(4210); const p0=S.players[0];
      const src=ns.content.byId[Object.keys(ns.content.byId).filter(k=>ns.content.byId[k].kind==="REALESTATE")[0]];
      const fake=util.clone(src); fake.id="RE_ZERO_TEST"; fake.payload=Object.assign({},fake.payload,{price:0,downPayment:0}); ns.content.byId[fake.id]=fake;
      try{
        E.pushDecision(S,p0,{kind:"BUY",cardId:fake.id}); E.syncPhase(S);
        const r=ap(S,{type:"DECIDE",playerId:0,payload:{decisionId:S.pendingDecision.decisionId,optionId:"loan",params:{}}});
        A(isFinite(p0.cash),"現金應有限，實得 "+p0.cash);
        p0.assets.forEach(a=>A(isFinite(a.marketValue)&&isFinite(a.monthlyIncome),"資產欄位不該 NaN"));
        p0.liabilities.forEach(l=>A(isFinite(l.principal)&&isFinite(l.monthlyPayment),"負債欄位不該 NaN"));
        return "cash "+p0.cash+(r.rejected?"（決策被拒 "+rej(r)+"，但無 NaN）":"");
      } finally { delete ns.content.byId[fake.id]; }
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

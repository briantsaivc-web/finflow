const { chromium } = require('playwright');
/* S43：ChatGPT 四項 QA 發現的修復（Brian 2026-09-07 定案）
     QA-001 非法／缺失 playerId 不再回退成當前玩家（BAD_PLAYER）
     QA-002 動作信封驗證：缺 payload／缺必填欄位一律 BAD_PAYLOAD，不再 TypeError（含進入決策狀態後的 DECIDE／CHOOSE_DECK 等）
     QA-003 CONFIG_PATCH 依 registry 驗 type／finite／min／max／options → BAD_VALUE，不 clamp
     QA-004 電腦 LIFESTYLE／CULTIVATE 改純雜湊：存檔 log 重放後 auxRngState 逐位元一致、續玩不分岔、npc.nextAction 冪等
   用法（repo 根目錄）： node tests/s43test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,npc=ns.npc,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const cfg=ns.buildConfig(ns.configRegistry); const MODS=["M1","M2","M3","M4","M6","M8"]; const pros=ns.content.professions;
    const mk=(seed,allNpc)=>{ const S=E.newGame({seed:seed,config:util.clone(cfg),modules:MODS,players:[0,1,2,3].map(i=>({name:'P'+i,isNPC:allNpc||i>0,personality:['NPC_SAFE','NPC_SAFE','NPC_LEVER','NPC_VC'][i],professionId:pros[i*4].id,dreamCardId:ns.content.dreams[i].id}))}); E.beginTurn(S); return S; };
    const rej=r=>{ const e=(r.events||[]).filter(x=>x.type==="ACTION_REJECTED")[0]; return r.rejected?(e?e.reason:"?"):null; };
    const ap=(S,a)=>E.apply(S,a,{mutate:true});
    const noThrow=(S,a)=>{ try{ return {r:ap(S,a)}; }catch(e){ return {threw:e.message}; } };

    step("QA-001 非法 playerId 一律 BAD_PLAYER，不再變成當前玩家",()=>{
      for(const pid of [999999,-1,undefined,null,'0',1.5,NaN]){ const S=mk(1); const r=ap(S,{type:"ROLL_DICE",playerId:pid,payload:null});
        A(rej(r)==="BAD_PLAYER","playerId="+String(pid)+" 應 BAD_PLAYER，實得 "+rej(r)); A(S.actionLog.length===0,"不該留紀錄"); }
      return "7 種壞值全擋"; });
    step("QA-001 合法座位行為不變：當前玩家可擲、非當前 NOT_YOUR_TURN、非回合白名單仍放行",()=>{
      const S=mk(1); A(!ap(S,{type:"ROLL_DICE",playerId:0,payload:null}).rejected,"P0 擲骰應通過");
      const S2=mk(1); A(rej(ap(S2,{type:"ROLL_DICE",playerId:2,payload:null}))==="NOT_YOUR_TURN","P2 擲骰應 NOT_YOUR_TURN");
      const S3=mk(1); const r=ap(S3,{type:"SET_DCA",playerId:2,payload:{symbol:"STK_ETF",amount:0}}); A(rej(r)!=="BAD_PLAYER" && rej(r)!=="NOT_YOUR_TURN","非回合自管動作仍應進到 case，實得 "+rej(r));
      return "OK"; });
    step("QA-001 action 不是物件／type 不是字串 → BAD_ACTION",()=>{
      const S=mk(1); A(rej(ap(S,null))==="BAD_ACTION","null"); A(rej(ap(S,{playerId:0}))==="BAD_ACTION","無 type"); A(rej(ap(S,{type:42,playerId:0}))==="BAD_ACTION","type 數字");
      A(rej(ap(S,{type:"NOPE_X",playerId:0,payload:{}}))==="UNKNOWN_ACTION","未知 type 仍 UNKNOWN_ACTION"); return "OK"; });

    step("QA-002 開局狀態：schema 動作缺 payload → BAD_PAYLOAD，不 throw",()=>{
      const types=Object.keys(E.PAYLOAD_SCHEMA); let n=0;
      for(const t of types){ for(const pl of [undefined,null,{},[]]){ const S=mk(7); const o=noThrow(S,{type:t,playerId:0,payload:pl}); A(!o.threw,t+" payload="+JSON.stringify(pl)+" throw: "+o.threw); A(rej(o.r)==="BAD_PAYLOAD",t+" payload="+JSON.stringify(pl)+" 應 BAD_PAYLOAD，實得 "+rej(o.r)); n++; } }
      return types.length+" 種動作 × 4 種壞 payload ＝ "+n+" 次全擋"; });
    step("QA-002 可選 payload 的動作仍接受 null（ROLL_DICE／END_TURN 等舊紀錄相容）",()=>{
      const S=mk(1); A(!ap(S,{type:"ROLL_DICE",playerId:0,payload:null}).rejected,"ROLL_DICE null"); const S2=mk(1); A(!ap(S2,{type:"ROLL_DICE",playerId:0}).rejected,"ROLL_DICE 無 payload");
      Object.keys(E.PAYLOAD_OPTIONAL).forEach(t=>A(!E.PAYLOAD_SCHEMA[t],t+" 不該同時在兩張表")); return Object.keys(E.PAYLOAD_OPTIONAL).length+" 種可選"; });
    step("QA-002 進入狀態後：DECISION 階段 DECIDE／CHOOSE_DECK 缺欄位 → BAD_PAYLOAD 不 throw；正常 DECIDE 照過",()=>{
      // 用全電腦局推進到第一個 DECISION
      const S=mk(11,true); let g=0; while(!S.pendingDecision && !S.over && g++<400){ let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}; if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId; const r=ap(S,a); if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}); }
      A(S.pendingDecision,"應該推進到有決策的狀態"); const d=S.pendingDecision, owner=d.playerId;
      for(const pl of [undefined,null,{},{optionId:"buy"}]){ const C=util.clone(S); const o=noThrow(C,{type:"DECIDE",playerId:owner,payload:pl}); A(!o.threw,"DECIDE "+JSON.stringify(pl)+" throw "+o.threw); A(rej(o.r)==="BAD_PAYLOAD","DECIDE "+JSON.stringify(pl)+" 應 BAD_PAYLOAD，實得 "+rej(o.r)); }
      const C2=util.clone(S); const o2=noThrow(C2,{type:"CHOOSE_DECK",playerId:owner,payload:{}}); A(!o2.threw && rej(o2.r)==="BAD_PAYLOAD","CHOOSE_DECK {} 應 BAD_PAYLOAD");
      const C3=util.clone(S); const good=npc.nextAction(C3); if(good&&good.type==="DECIDE"){ good.payload.decisionId=d.decisionId; A(!ap(C3,good).rejected,"電腦的正常 DECIDE 應通過"); }
      return "決策 "+d.kind; });
    step("QA-002 隨局面推進大量注入壞 payload：0 次 throw",()=>{
      const S=mk(23,true); let g=0, n=0, thr=0; const types=Object.keys(E.PAYLOAD_SCHEMA).concat(["PLACE_BID","START_SKILL","PROPOSE_P2P","TAKE_LOAN"]);
      while(!S.over && g++<300){ if(g%30===0){ for(const t of types){ for(const pl of [undefined,null,{}]){ const C=util.clone(S); n++; const o=noThrow(C,{type:t,playerId:E.activePlayer(C).id,payload:pl}); if(o.threw) thr++; } } }
        let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}; if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId; const r=ap(S,a); if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}); }
      A(thr===0,"throw "+thr+"/"+n); return n+" 次注入、0 throw、局面到第 "+S.turnNumber+" 輪"; });

    step("QA-003 CONFIG_PATCH：超出 registry 範圍／型別錯／選項外 → BAD_VALUE，設定不變",()=>{
      const bad=[["maxTurns",-1],["maxTurns",1e9],["maxTurns",NaN],["maxTurns",Infinity],["maxTurns","99"],["fixedPayday",999],["marginRatio",-10],["delistMode","nonsense"]];
      for(const [k,v] of bad){ const S=mk(3); const before=S.config[k]; const r=ap(S,{type:"CONFIG_PATCH",playerId:0,payload:{key:k,value:v}}); A(rej(r)==="BAD_VALUE",k+"="+String(v)+" 應 BAD_VALUE，實得 "+rej(r)); A(S.config[k]===before,k+" 不該被改"); A(S.actionLog.length===0,"不留紀錄"); }
      return bad.length+" 組全擋"; });
    step("QA-003 合法值照過；未知 key 仍 NO_SUCH_PARAM",()=>{
      const S=mk(3); A(!ap(S,{type:"CONFIG_PATCH",playerId:0,payload:{key:"maxTurns",value:120}}).rejected && S.config.maxTurns===120,"maxTurns=120");
      A(!ap(S,{type:"CONFIG_PATCH",playerId:0,payload:{key:"delistMode",value:"fixed"}}).rejected && S.config.delistMode==="fixed","delistMode=fixed");
      A(rej(ap(S,{type:"CONFIG_PATCH",playerId:0,payload:{key:"noSuchKey",value:1}}))==="NO_SUCH_PARAM","未知 key");
      const p=E.configParam("maxTurns"); A(p && p.min===20 && p.max===200,"configParam 應讀到 registry"); return "OK"; });

    step("QA-004 存檔 log 重放：三個種子 30 輪後全狀態（含 auxRngState）逐位元一致，續玩 10 輪動作序列一致",()=>{
      const playTo=(seed,turns)=>{ const S=mk(seed,true); let g=0; while(!S.over && S.turnNumber<turns && g++<4000){ let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}; if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId; const r=ap(S,a); if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}); } return S; };
      const cont=(S,to)=>{ let g=0; const acts=[]; while(!S.over && S.turnNumber<to && g++<2000){ let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}; if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId; acts.push(a.type+":"+(a.payload&&a.payload.optionId||"")); const r=ap(S,a); if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}); } return acts; };
      let out=[];
      for(const seed of [1,42,777]){ const Aa=playTo(seed,30); const save={seed:seed,config:Aa.config,modules:Aa.enabledModules,players:ns.seedPlayers(Aa),actionLog:Aa.actionLog};
        const Bb=ns.replay(save); A(Bb.auxRngState===Aa.auxRngState,"seed "+seed+" auxRngState 應一致："+Aa.auxRngState+" vs "+Bb.auxRngState);
        A(JSON.stringify(Aa)===JSON.stringify(Bb),"seed "+seed+" 全狀態應逐位元一致");
        const ca=cont(Aa,Aa.turnNumber+10), cb=cont(Bb,Bb.turnNumber+10); A(JSON.stringify(ca)===JSON.stringify(cb),"seed "+seed+" 續玩應一致"); out.push(seed+":"+Aa.actionLog.length+"筆"); }
      return out.join(" "); });
    step("QA-004 npc.nextAction 冪等且不碰 auxRngState（LIFESTYLE／CULTIVATE 決策）",()=>{
      let found=0, checked=0;
      for(const seed of [5,9,13,21,34]){ const S=mk(seed,true); let g=0;
        while(!S.over && g++<600){ if(S.pendingDecision && (S.pendingDecision.kind==="LIFESTYLE"||S.pendingDecision.kind==="CULTIVATE") && S.players[S.pendingDecision.playerId].isNPC){ found++;
            const aux0=S.auxRngState, a1=npc.nextAction(S), a2=npc.nextAction(S); checked++;
            A(S.auxRngState===aux0,"nextAction 不該推進 auxRngState"); A(JSON.stringify(a1)===JSON.stringify(a2),"同一決策兩次回答應相同："+JSON.stringify(a1)+" vs "+JSON.stringify(a2)); }
          let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}; if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId; const r=ap(S,a); if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null}); } }
      A(found>0,"五個種子裡應至少遇到一次 LIFESTYLE／CULTIVATE"); return "遇到 "+found+" 次，全部冪等"; });
    step("QA-004 stableRoll 純函式：同輸入同輸出、落在 [0,1)、不同 decisionId 結果不同",()=>{
      const S=mk(1); const p=S.players[0]; const d1={decisionId:"d_1",kind:"LIFESTYLE",cardId:"X"}, d2={decisionId:"d_2",kind:"LIFESTYLE",cardId:"X"};
      const a=npc.stableRoll(S,p,d1), b=npc.stableRoll(S,p,d1), c=npc.stableRoll(S,p,d2); A(a===b && a>=0 && a<1 && a!==c,"a="+a+" b="+b+" c="+c); return "a="+a.toFixed(4)+" c="+c.toFixed(4); });
    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;
  if(errs.length) errs.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

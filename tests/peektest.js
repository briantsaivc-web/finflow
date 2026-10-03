/* 看盤面（ui.peekBoard）：決策卡蓋住畫面時，可以暫時收起來看清楚背景的利率、景氣、股價。
   驗收條件：
   1. 決策卡上有「👁 看盤面」
   2. 按下後決策卡與遮罩收起、底部出現「回到決定」，背景（總經資訊、股市）沒被任何東西蓋住
   3. 看盤面期間背景只能看：點人生商城不會開視窗、不會產生任何動作
   4. 按「回到決定」回到同一張決策卡
   5. 決策被解掉（或換了一張）時自動離開看盤面，不會把下一張決策藏起來
   6. 整個過程 actionLog 不變（純介面狀態）
   用法：node tests/peektest.js [index.html 路徑] [截圖資料夾（可省略）]
*/
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const SHOTS = process.argv[3] ? __path.resolve(process.argv[3]) : null;

(async()=>{
  const b=await chromium.launch();
  let pass=0, fail=0;
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };
  const errs=[];

  for(const vp of [{width:1440,height:900,tag:'pc'},{width:1180,height:820,tag:'ipad'}]){
    const pg=await b.newPage({viewport:{width:vp.width,height:vp.height}});
    pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
    await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(800);

    // 用電腦玩家的決策邏輯推進，直到真人遇到一張「買／不買」類的決策卡
    const got=await pg.evaluate(()=>{
      const ui=ns.ui, E=ns.engine;
      ui.startCore(4701, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"],
        ["A","B"].map((n,i)=>({name:n,isNPC:false,
          professionId:ns.content.professions[i*5].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
      const clr=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove()); clr();
      for(let g=0; g<5000 && !ui.S.over; g++){
        const S=ui.S, d=S.pendingDecision;
        if(S.phase==="DECISION" && d && d.playerId===ui.myId() && S.turnNumber>3
           && ["STOCK","BUY","REALESTATE","BUSINESS"].includes(d.kind)){ ui.render(); clr(); return d.kind; }
        const act=E.activePlayer(S), w=act.isNPC;
        act.isNPC=true; act.npcPersonality=act.npcPersonality||"NPC_SAFE";
        let a=ns.npc.nextAction(S); act.isNPC=w;
        if(!a) a={type:"END_TURN",playerId:act.id,payload:null};
        if(a.type==="DECIDE" && S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
        if(S.phase==="BOOKKEEPING" && S.bookkeeping){ const bk=S.bookkeeping, i=bk.tasks.findIndex(t=>!t.done);
          if(i>=0) a={type:"CLASSIFY_ENTRY",playerId:bk.playerId,payload:{taskIdx:i,quadrant:ns.ledger.QUADRANT[bk.tasks[i].account]}}; }
        let res=E.apply(S,a);
        if(res.rejected) res=E.apply(S,{type:"END_TURN",playerId:act.id,payload:null});
        if(res.rejected) break;
        ui.S=res.state; ui.handleEvents(res.events); try{ ui.render(); }catch(e){} clr();
      }
      return null;
    });
    A(!!got, vp.tag+' 應推進到一張真人的決策卡');
    if(!got){ await pg.close(); continue; }
    await pg.waitForTimeout(300);
    await pg.evaluate(()=>{ document.querySelectorAll('#overlays .overlay,#bcast > *,#toast > *').forEach(o=>o.remove()); });
    const log0=await pg.evaluate(()=>ns.ui.S.actionLog.length);
    const dec0=await pg.evaluate(()=>ns.ui.S.pendingDecision.decisionId);

    // 1. 有按鈕
    const btn=await pg.$('#center .peekRow button');
    A(!!btn, vp.tag+' '+got+'：決策卡上應有「看盤面」');
    if(!btn){ await pg.close(); continue; }

    // 2. 收起決策卡，背景看得到
    await btn.click();
    const s1=await pg.evaluate(()=>{
      const c=document.getElementById('center'), bar=document.getElementById('peekBar');
      const visibleAt=(el)=>{ if(!el) return false; const r=el.getBoundingClientRect(); if(!r.width||!r.height) return false;
        const h=document.elementFromPoint(r.left+Math.min(20,r.width/2), r.top+Math.min(12,r.height/2)); return !!h && el.contains(h); };
      return { centerHidden: getComputedStyle(c).display==='none', bar: !!bar && getComputedStyle(bar).display!=='none',
               infoL: visibleAt(document.getElementById('infoL')), infoM: visibleAt(document.getElementById('infoM')) };
    });
    A(s1.centerHidden, vp.tag+' 看盤面時決策卡與遮罩應收起');
    A(s1.bar, vp.tag+' 看盤面時應出現「回到決定」');
    A(s1.infoL, vp.tag+' 看盤面時左欄總經資訊應沒被蓋住');
    A(s1.infoM, vp.tag+' 看盤面時股市區應沒被蓋住');
    if(SHOTS) await pg.screenshot({path:__path.join(SHOTS,'peek_'+vp.tag+'.png')});

    // 3. 背景只能看
    await pg.click('#btnMall',{force:true});
    const s2=await pg.evaluate(()=>({ov:document.querySelectorAll('#overlays .overlay').length, log:ns.ui.S.actionLog.length}));
    A(s2.ov===0, vp.tag+' 看盤面時點人生商城不應開視窗');
    A(s2.log===log0, vp.tag+' 看盤面時點背景不應產生動作');

    // 重繪（例如別人的動作進來）不應把看盤面打斷
    await pg.evaluate(()=>ns.ui.render());
    A(await pg.evaluate(()=>document.body.classList.contains('peek')), vp.tag+' 同一張決策重繪時應維持看盤面');

    // 4. 回到決定
    await pg.click('#peekBar button');
    const s3=await pg.evaluate(()=>({ shown: getComputedStyle(document.getElementById('center')).display!=='none',
      bar: !!document.getElementById('peekBar'), dec: ns.ui.S.pendingDecision && ns.ui.S.pendingDecision.decisionId }));
    A(s3.shown && !s3.bar, vp.tag+' 按「回到決定」應回到決策卡');
    A(s3.dec===dec0, vp.tag+' 回來的應是同一張決策');
    A(await pg.evaluate(()=>ns.ui.S.actionLog.length)===log0, vp.tag+' 看盤面來回不應產生任何動作');

    // 5. 看盤面中決策被解掉 → 自動離開
    await pg.click('#center .peekRow button');
    await pg.evaluate(()=>{ const d=ns.ui.S.pendingDecision;
      ns.ui.dispatch({type:"DECIDE",playerId:d.playerId,payload:{decisionId:d.decisionId,optionId:"skip",params:{}}}); });
    await pg.waitForTimeout(200);
    const s4=await pg.evaluate(()=>({ peek: document.body.classList.contains('peek'), bar: !!document.getElementById('peekBar') }));
    A(!s4.peek && !s4.bar, vp.tag+' 決策解掉後應自動離開看盤面');
    await pg.close();
  }

  A(errs.length===0, '頁面錯誤：'+errs.join(' | '));
  console.log(JSON.stringify({pass, total:pass+fail}));
  await b.close();
  process.exit(fail?1:0);
})();

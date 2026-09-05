const { chromium } = require('playwright');
/* S41 多人局：任何一台出事，其他人都玩得下去（Brian 2026-09-05 真人局卡死）
     A 修根因＋診斷：mpFullResync 帶 mp:true（自救不再把這台踢出房間）；破口那一筆進系統訊息、存本機；
                    同一筆重放後仍被拒 → 攤開（不無限重放）
     B 房主離線 30 秒 → 在線且座位最小的真人裝置自動接任
     C 離線／輪到他卻 90 秒沒動作的座位，別人可以按「請電腦代打」；本人回來 PLAYER_RETURN 接回
     D 發起人離席時合資取消要有事件（不再靜默）
   用法（repo 根目錄）： node tests/s41test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const http=require('http'), fs=require('fs');
(async () => {
  const srv=http.createServer((q,r)=>{ r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); r.end(fs.readFileSync(TARGET)); }).listen(0);
  const port=srv.address().port;
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:800}});
  const errs=[];
  const mk=async()=>{ const p=await ctx.newPage(); p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    await p.goto('http://127.0.0.1:'+port+'/'); await p.waitForTimeout(900); return p; };
  const A=await mk(), B=await mk(), C=await mk();
  const log=[]; let fail=0;
  const say=(ok,n,d='')=>{ log.push((ok?'OK   ':'FAIL ')+n+(d?'  '+d:'')); if(!ok) fail++; };
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  /* ---------- 建房、入房、開局（沿用 mp2 的路徑） ---------- */
  const code=await A.evaluate(async ()=>{
    const ui=ns.ui; ui.mpCreate('local');
    const ov=[...document.querySelectorAll('.overlay')].pop();
    [...ov.querySelectorAll('button')].filter(b=>b.textContent==='3 人')[0].click();
    const ov2=[...document.querySelectorAll('.overlay')].pop();
    [...ov2.querySelectorAll('button')].filter(b=>b.textContent==='系統隨機')[0].click();
    const ov3=[...document.querySelectorAll('.overlay')].pop();
    [...ov3.querySelectorAll('button')].filter(b=>/^建立/.test(b.textContent))[0].click();
    for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,100));
      const lb=document.getElementById('mpLobby');
      if(lb){ const m=lb.textContent.match(/房號\s*(\d+)/); if(m) return m[1]; } }
    return null;
  });
  say(!!code,'建房','房號='+code);
  for(const [pg,nm] of [[B,'小美'],[C,'阿強']]){
    const joined=await pg.evaluate(async ({code,nm})=>{
      const ui=ns.ui; ui.mpJoinPrompt('local');
      const ov=[...document.querySelectorAll('.overlay')].pop();
      ov.querySelector('input').value=code;
      [...ov.querySelectorAll('button')].filter(b=>/^加入/.test(b.textContent))[0].click();
      for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,100));
        const lb=document.getElementById('mpLobby');
        if(lb){ const ni=lb.querySelector('input'); if(ni){ ni.value=nm; ni.onchange&&ni.onchange(); }
          const rb=[...lb.querySelectorAll('button')].filter(b=>/我準備好了/.test(b.textContent))[0];
          if(rb){ rb.click(); return true; } } }
      return false;
    },{code,nm});
    say(joined,nm+' 入房並準備');
  }
  await A.waitForTimeout(600);
  const started=await A.evaluate(async ()=>{
    const lb=document.getElementById('mpLobby');
    const rb=[...lb.querySelectorAll('button')].filter(b=>/我準備好了/.test(b.textContent))[0]; if(rb) rb.click();
    await new Promise(r=>setTimeout(r,400));
    const gb=[...document.getElementById('mpLobby').querySelectorAll('button')].filter(b=>/開局（房主）/.test(b.textContent))[0];
    if(!gb||gb.disabled) return {ok:false};
    gb.click();
    for(let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,150)); if(ns.ui.S && ns.ui.mp.mode) return {ok:true, host:ns.ui.mp.host, seat:ns.ui.mp.seat}; }
    return {ok:false};
  });
  say(started.ok && started.host && started.seat===0,'房主開局，A＝座位 0＝房主',JSON.stringify(started));
  await B.waitForTimeout(1500); await C.waitForTimeout(1500);
  const overlaysOff=async pg=>pg.evaluate(()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove()));
  for(const pg of [A,B,C]) await overlaysOff(pg);
  const st=async pg=>pg.evaluate(()=>({mode:ns.ui.mp.mode, seat:ns.ui.mp.seat, host:ns.ui.mp.host, uid:ns.ui.mp.uid,
    turn:ns.ui.S&&ns.ui.S.turnNumber, logLen:ns.ui.S&&ns.ui.S.actionLog.length, over:ns.ui.S&&ns.ui.S.over,
    active:ns.ui.S&&ns.ui.S.activePlayerIdx, npc:ns.ui.S&&ns.ui.S.players.map(p=>p.isNPC), left:ns.ui.S&&ns.ui.S.players.map(p=>!!(p.flags&&p.flags.leftHuman))}));
  say((await st(B)).seat===1 && (await st(C)).seat===2,'B＝座位 1、C＝座位 2');

  /* ---------- A：自救不掉出房間 ---------- */
  // 讓 B 的本機狀態分岔（S.over=true → 下一筆重放被拒 GAME_OVER）→ A 擲骰 → B 自救
  await B.evaluate(()=>{ ns.ui.S.over=true; ns.ui.feed=ns.ui.feed||[]; });
  await A.evaluate(()=>{ ns.ui.dispatch({type:"ROLL_DICE",playerId:0,payload:null}); });
  await sleep(1500); await overlaysOff(B);
  const bAfter=await B.evaluate(()=>({mode:ns.ui.mp.mode, seat:ns.ui.mp.seat, over:ns.ui.S.over, logLen:ns.ui.S.actionLog.length,
     diag:ns.ui.mp.lastDesync, ls:localStorage.getItem("finflow.mp.lastDesync"),
     feed:(ns.ui.feed||[]).map(f=>f.msg).filter(m=>/同步破口/.test(m)).length,
     dots:document.querySelectorAll('#pawns .nm').length>0 && /🟢|🔴/.test(document.getElementById('pawns').textContent)}));
  const aAfter=await st(A);
  say(bAfter.mode===true && bAfter.seat===1,'A-1 重放被拒後全量自救，B 仍在房間（mp.mode 仍為 true、座位不變）',JSON.stringify({mode:bAfter.mode,seat:bAfter.seat}));
  say(bAfter.over===false && bAfter.logLen===aAfter.logLen,'A-2 自救後 B 的狀態追上房間紀錄',JSON.stringify({over:bAfter.over,B:bAfter.logLen,A:aAfter.logLen}));
  say(bAfter.diag && bAfter.diag.reason==="GAME_OVER" && bAfter.diag.type==="ROLL_DICE" && !!bAfter.ls,'A-3 破口那一筆有診斷（原因／型別）且存本機',JSON.stringify(bAfter.diag));
  say(bAfter.feed>=1,'A-4 系統訊息看得到「同步破口」');
  say(bAfter.dots,'A-5 自救後玩家卡仍有上線燈（＝仍是多人模式的畫面）');
  // 同一筆再被拒（狀態真的分岔）→ 不無限重放、攤開來講
  const loopGuard=await B.evaluate(async ()=>{
    const ui=ns.ui; let stuck=0; const orig=ui.showStuck; ui.showStuck=function(){ stuck++; };
    let resyncs=0; const origR=ui.mpFullResync;
    // 讓「重放後仍被拒」成立：把房間紀錄多塞一筆在任何狀態都會被拒的動作（座位 2 在非自己回合買點）
    const S=ui.S;
    const badEntry={seq:S.actionLog.length, playerId:2, type:"BUY_DREAM_PROGRESS", payload:null, uid:"x", ts:Date.now()};
    ui.mp._resyncSeq=badEntry.seq;           // 模擬「這一筆已經自救過一次」
    // 直接走 mpApplyEntry 的路徑：透過 adapter 回聲
    ui.mp.adapter.appendAction(badEntry.seq, badEntry);
    await new Promise(r=>setTimeout(r,600));
    ui.showStuck=orig;
    return {stuck, mode:ui.mp.mode};
  });
  say(loopGuard.stuck===1 && loopGuard.mode===true,'A-6 同一筆重放後仍被拒 → 攤開（showStuck 一次），不無限重放、不掉出房間',JSON.stringify(loopGuard));
  // 清掉那筆壞紀錄，讓後面的測試走得下去（三端都重新同步）
  await A.evaluate(()=>{ const k="finflow.mproom."+ns.ui.mp.code; const room=JSON.parse(localStorage.getItem(k)); room.log=room.log.filter(e=>!(e.uid==="x")); localStorage.setItem(k,JSON.stringify(room)); });
  for(const pg of [A,B,C]) await pg.evaluate(()=>{ ns.ui.mp._resyncSeq=null; ns.ui.mpFullResync(); });
  await sleep(1200); for(const pg of [A,B,C]) await overlaysOff(pg);
  const lens=[await st(A),await st(B),await st(C)].map(x=>x.logLen);
  say(lens[0]===lens[1] && lens[1]===lens[2] && lens[0]>0,'（清理）三端重新同步後紀錄長度一致',lens.join('/'));

  /* ---------- C-idle：輪到 A 卻久未動作 → 別人可以替他交電腦 ---------- */
  const active0=await A.evaluate(()=>ns.ui.S.activePlayerIdx);
  const idleWhy=await C.evaluate(()=>{ ns.ui.mp._lastActTs=Date.now()-100000; return {why:ns.ui.mpForceLeaveWhy(ns.ui.S.activePlayerIdx), other:ns.ui.mpForceLeaveWhy(1), self:ns.ui.mpForceLeaveWhy(2)}; });
  say(idleWhy.why==="idle" && idleWhy.other===null && idleWhy.self===null,'C-1 輪到的人 90 秒沒動作＝可交電腦；沒輪到的在線座位不行；自己不行',JSON.stringify(idleWhy));
  const idleBtn=await C.evaluate(()=>{ ns.ui.renderPlayerCards(); const btns=[...document.querySelectorAll('#pawns .mpForce')]; return {n:btns.length, title:btns[0]&&btns[0].title}; });
  say(idleBtn.n===1 && /沒有動作/.test(idleBtn.title||''),'C-2 C 的畫面上只有輪到的那一格長出「請電腦代打」',JSON.stringify(idleBtn));
  await C.evaluate(()=>{ ns.ui.mp._lastActTs=Date.now(); ns.ui.renderPlayerCards(); });   // 復原，不真的按

  /* ---------- B：房主離線 → B 接任 ---------- */
  await A.evaluate(()=>{ clearInterval(ns.ui.mp._hb); ns.ui.mp._hb=null; ns.ui.mp.adapter.setPresence(ns.ui.mp.uid,{lastSeen:Date.now()-60000}); });
  await sleep(400);
  const claimB=await B.evaluate(()=>({online:ns.ui.mpOnline(ns.ui.mp.seatUid[0]), claimed:ns.ui.mpCheckHost()}));
  const claimC=await C.evaluate(()=>({claimed:ns.ui.mpCheckHost()}));
  await sleep(800);
  const hosts=[await st(A),await st(B),await st(C)].map(x=>x.host);
  const claimedB=await B.evaluate(()=>!!ns.ui.mp._claimAt), claimedC=await C.evaluate(()=>!!ns.ui.mp._claimAt);
  say(claimB.online===false && claimedB && !claimedC && claimC.claimed===false,'B-1 房主離線 30 秒：座位最小的在線裝置（B）接任（心跳一到就自動），C 不搶',JSON.stringify({claimB,claimedB,claimedC,claimC}));
  say(hosts[1]===true && hosts[0]===false && hosts[2]===false,'B-2 meta 回聲後只有 B 是房主',hosts.join('/'));
  const bFeed=await B.evaluate(()=>(ns.ui.feed||[]).map(f=>f.msg).filter(m=>/接任房主/.test(m)).length);
  say(bFeed>=1,'B-3 B 的系統訊息寫了接任房主');

  /* ---------- C-offline：A 離線 → B 替他交電腦；A 回來接回 ---------- */
  const offWhy=await B.evaluate(()=>ns.ui.mpForceLeaveWhy(0));
  say(offWhy==="offline",'C-3 A 離線 → B 看到座位 0 可交電腦（offline）',String(offWhy));
  const clicked=await B.evaluate(async ()=>{ ns.ui.renderPlayerCards(); const fb=document.querySelector('#pawns .mpForce'); if(!fb) return {btn:false}; fb.click(); await new Promise(r=>setTimeout(r,800)); return {btn:true}; });
  const after=[await st(A),await st(B),await st(C)];
  say(clicked.btn && after.every(x=>x.npc[0]===true && x.left[0]===true),'C-4 按下後三端都看到座位 0 轉電腦代打（leftHuman）',JSON.stringify(after.map(x=>[x.npc[0],x.left[0]])));
  const cFeed=await C.evaluate(()=>(ns.ui.feed||[]).map(f=>f.msg).filter(m=>/交給電腦代打/.test(m)).length);
  say(cFeed>=1,'C-5 C 的訊息欄寫了「座位交給電腦代打」（forcedBy）');
  // 不該能替在線的人交電腦：B 對 C 送 PLAYER_LEAVE 應被 mpMayAct 擋下
  const refuse=await B.evaluate(async ()=>{ const why=ns.ui.mpForceLeaveWhy(2); ns.ui.dispatch({type:"PLAYER_LEAVE",playerId:2,payload:{forcedBy:1,why:"offline"}}); await new Promise(r=>setTimeout(r,500));
    return {why, leaves:ns.ui.S.actionLog.filter(e=>e.type==="PLAYER_LEAVE" && e.playerId===2).length, npc2:ns.ui.S.players[2].isNPC}; });
  say(refuse.why===null && refuse.leaves===0 && refuse.npc2===false,'C-6 在線的座位不能被別人交電腦（mpMayAct 擋下）',JSON.stringify(refuse));
  // 遊戲在 B（新房主）手上推得動：等幾秒看 actionLog 有沒有前進（座位 0 現在是電腦）
  const before=(await st(B)).logLen; let afterLen=before, dbg=null;
  for(let i=0;i<16 && afterLen<=before;i++){ await sleep(500); afterLen=(await st(B)).logLen; }
  if(afterLen<=before) dbg=await B.evaluate(()=>({host:ns.ui.mp.host, active:ns.ui.S.activePlayerIdx, npc:ns.ui.S.players[ns.ui.S.activePlayerIdx].isNPC, phase:ns.ui.S.phase,
     pd:ns.ui.S.pendingDecision&&{k:ns.ui.S.pendingDecision.kind,p:ns.ui.S.pendingDecision.playerId}, wait:ns.engine.waitingOnHumans(ns.ui.S), stall:ns.ui.mp._stall, rep:ns.ui.mp.replaying}));
  say(afterLen>before,'C-7 新房主代跑：座位 0 變電腦後紀錄繼續前進',before+'→'+afterLen+(dbg?' '+JSON.stringify(dbg):''));
  // A 回來
  await A.evaluate(()=>{ ns.ui.mp.adapter.setPresence(ns.ui.mp.uid,{lastSeen:Date.now()}); ns.ui.dispatch({type:"PLAYER_RETURN",playerId:0,payload:null}); });
  await sleep(1000);
  const back=[await st(A),await st(B),await st(C)];
  say(back.every(x=>x.npc[0]===false && x.left[0]===false),'C-8 A 送 PLAYER_RETURN 後三端都看到座位 0 回到真人',JSON.stringify(back.map(x=>x.npc[0])));

  /* ---------- D：發起人離席，合資取消要有事件 ---------- */
  const dEv=await A.evaluate(()=>{
    const E=ns.engine, util=ns.util, cfg=ns.buildConfig(ns.configRegistry);
    const players=["甲","乙","丙"].map((n,i)=>({name:n,isNPC:false,professionId:ns.content.professions[i*4].id,dreamCardId:ns.content.dreams[i].id}));
    const S=E.newGame({seed:4101,config:cfg,modules:["M1","M2","M3","M4","M6","M8"],players});
    E.beginTurn(S);
    S.pendingJV={cardId:"OPS_BZ1",title:"測試合資",fromId:1,myShare:0.5,targetId:2,declined:null};
    const r=E.apply(S,{type:"PLAYER_LEAVE",playerId:1,payload:null},{mutate:true});
    const ev=(r.events||[]).filter(e=>e.type==="JV_REJECTED")[0];
    return {rejected:r.rejected, pj:S.pendingJV, ev:ev&&{reason:ev.reason,fromId:ev.fromId,title:ev.title}};
  });
  say(!dEv.rejected && dEv.pj===null && dEv.ev && dEv.ev.reason==="left" && dEv.ev.fromId===1,'D-1 發起人離席清掉合資時發 JV_REJECTED(left)，不再靜默',JSON.stringify(dEv));

  log.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+[...new Set(errs)].slice(0,8).join('\n')) : '--- no page errors ---');
  console.log(JSON.stringify({pass:log.length-fail,fail,pageErrors:errs.length}));
  await b.close(); srv.close();
  process.exit(fail||errs.length?1:0);
})();

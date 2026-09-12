const { chromium } = require('playwright');
const path = require('path');
const TARGET = path.resolve(__dirname, '..', 'index.html');
const http=require('http'), fs=require('fs');
(async () => {
  const file=TARGET;
  const srv=http.createServer((q,r)=>{ r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    r.end(fs.readFileSync(file)); }).listen(0);
  const port=srv.address().port;
  const b=await chromium.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:800}});
  const errs=[];
  const mk=async()=>{ const p=await ctx.newPage(); p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    await p.goto('http://127.0.0.1:'+port+'/'); await p.waitForTimeout(900); return p; };
  const A=await mk(), B=await mk();
  const log=[];
  const say=(ok,n,d='')=>log.push((ok?'OK   ':'FAIL ')+n+(d?'  '+d:''));

  // A 建房：4 人局，系統隨機職業
  const code=await A.evaluate(async ()=>{
    const ui=ns.ui;
    ui.mpCreate('local');
    const ov=[...document.querySelectorAll('.overlay')].pop();
    [...ov.querySelectorAll('button')].filter(b=>b.textContent==='4 人')[0].click();
    const ov2=[...document.querySelectorAll('.overlay')].pop();
    [...ov2.querySelectorAll('button')].filter(b=>b.textContent==='系統隨機')[0].click();
    const ov3=[...document.querySelectorAll('.overlay')].pop();
    [...ov3.querySelectorAll('button')].filter(b=>/^建立/.test(b.textContent))[0].click();
    for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,100));
      const lb=document.getElementById('mpLobby');
      if(lb){ const m=lb.textContent.match(/房號\s*(\d+)/); if(m) return m[1]; } }
    return null;
  });
  say(!!code && /^\d{4}$/.test(code), '建房成功（4人局）且房號為 4 碼', '房號='+code);

  const joined=await B.evaluate(async ({code,nm})=>{
    const ui=ns.ui; ui.mpJoinPrompt('local');
    const ov=[...document.querySelectorAll('.overlay')].pop();
    const inp=ov.querySelector('input'); inp.value=code;
    [...ov.querySelectorAll('button')].filter(b=>/^加入/.test(b.textContent))[0].click();
    for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,100));
      const lb=document.getElementById('mpLobby');
      if(lb){ const ni=lb.querySelector('input'); if(ni){ ni.value=nm; ni.onchange&&ni.onchange(); }
        const rb=[...lb.querySelectorAll('button')].filter(b=>/我準備好了/.test(b.textContent))[0];
        if(rb){ rb.click(); return true; } } }
    return false;
  }, {code, nm:'小美'});
  say(joined, '小美用 4 碼房號入房並按下準備');
  await A.waitForTimeout(600);

  const started=await A.evaluate(async ()=>{
    const lb=document.getElementById('mpLobby');
    const rb=[...lb.querySelectorAll('button')].filter(b=>/我準備好了/.test(b.textContent))[0];
    if(rb) rb.click();
    await new Promise(r=>setTimeout(r,400));
    const lb2=document.getElementById('mpLobby');
    const gb=[...lb2.querySelectorAll('button')].filter(b=>/開局（房主）/.test(b.textContent))[0];
    if(!gb || gb.disabled) return {ok:false, why:'開局鈕 '+(gb?'停用':'不存在')};
    gb.click();
    for(let i=0;i<60;i++){ await new Promise(r=>setTimeout(r,150));
      if(ns.ui.S && ns.ui.mp.mode) return {ok:true, seat:ns.ui.mp.seat,
        players:ns.ui.S.players.map(p=>({id:p.id,name:p.name,isNPC:p.isNPC}))}; }
    return {ok:false, why:'開局後沒進到遊戲'};
  });
  say(started.ok, '房主開局（4人：2真人+2電腦補位）', JSON.stringify(started));
  await B.waitForTimeout(1200);

  say(started.players && started.players.length===4 &&
      !started.players[0].isNPC && !started.players[1].isNPC &&
      started.players[2].isNPC && started.players[3].isNPC,
      '座位配置符合預期：P0/P1真人、P2/P3電腦補位', JSON.stringify(started.players));

  // 兩端各自「本地一致地」強制 IPO 到期並由電腦(P2)觸發開盤——
  // 模擬 E.openIpo 這個已通過 lockstep 風險評估（純 forEach、無隨機）的廣播結果在兩端各自到達的樣子。
  const doOpen = async (pg)=> pg.evaluate(()=>{
    const ui=ns.ui, E=ns.engine;
    const S=ui.S;
    if(!S.ipo) S.ipo={schedule:[S.turnNumber],fired:[false],seq:0,pending:null,history:[]};
    else { S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false]; }
    E.openIpo(S, S.players[2]);
    E.syncPhase(S);
    return { pendingDecision:S.pendingDecision, queue:S.decisionQueue.map(d=>({kind:d.kind,playerId:d.playerId,decisionId:d.decisionId})) };
  });
  const rA = await doOpen(A);
  const rB = await doOpen(B);
  say(JSON.stringify(rA.queue)===JSON.stringify(rB.queue), '兩端 decisionQueue 內容逐位元一致（座位、種類、decisionId 都相同）', JSON.stringify(rA.queue));
  say(rA.queue.filter(d=>d.kind==='IPO_ANNOUNCE').length===2 &&
      rA.queue.some(d=>d.playerId===0) && rA.queue.some(d=>d.playerId===1),
      '電腦(P2)觸發後，P0、P1 兩位真人各收到一筆 IPO_ANNOUNCE，P2/P3 電腦沒有', '');

  // A（P0，此刻是 pendingDecision 擁有者）render 之後應該看到自己真正的決策卡（modal，在 #center）
  const viewA = await A.evaluate(()=>{ ns.ui.render(); const t=document.getElementById('center').textContent; return t.slice(0,200); });
  say(/新股|IPO|申購/.test(viewA), 'A（P0，目前佇列最前面的擁有者）畫面顯示自己真正的 IPO 決策卡（modal）', viewA.slice(0,60));

  // B（P1）此刻不是佇列最前面的擁有者：多人專屬的 renderCenter 覆寫層（src/network/syncAdapter.js:930-956）
  // 會顯示非阻塞的「⏳ 等待 P0 做決定中」placeholder（不是 P0 的實際卡片內容，避免真人看到別人的財務決策卡），
  // 這是 T-91（v2.20.0 既有修復）就有的既定設計，不在 T-004 S3 的修改範圍內。
  const viewB = await B.evaluate(()=>{ ns.ui.render();
    const bc=document.getElementById('boardCenter').textContent;
    const c=document.getElementById('center').textContent;
    return {boardCenter:bc.slice(0,150), center:c.slice(0,150)};
  });
  say(/⏳ 等待/.test(viewB.boardCenter) && viewB.center==='',
      'B（P1，非目前佇列最前面者）畫面顯示「等待 P0」placeholder，不會誤顯示 P0 的實際決策卡內容（多人專屬設計，未受 T-004 影響）',
      JSON.stringify(viewB));

  // A（P0，真正擁有者）解卡：透過真實按鈕點擊，走真正的 mp 廣播路徑（ui.dispatch → mpSend → appendAction → 所有端 onAction）
  const aDecide = await A.evaluate(async ()=>{
    const ui=ns.ui, S=ui.S;
    const btns=[...document.querySelectorAll('#center button')];
    const declineBtn = btns.find(b=>/都不要/.test(b.textContent));
    if(!declineBtn) return {found:false};
    declineBtn.click();
    await new Promise(r=>setTimeout(r,500));
    return {found:true, queue:ui.S.decisionQueue.map(d=>({kind:d.kind,playerId:d.playerId})), pending:ui.S.pendingDecision};
  });
  say(aDecide.found && aDecide.queue.filter(d=>d.playerId===0).length===0, 'A（P0）真的點擊按鈕解卡成功，自己的卡從佇列移除', JSON.stringify(aDecide));

  // 等待 B 端透過廣播（onAction）同步收到 A 的解卡動作，並自動重繪
  await B.waitForTimeout(800);
  const bAfterSync = await B.evaluate(()=>{
    const ui=ns.ui, S=ui.S;
    return { queue:S.decisionQueue.map(d=>({kind:d.kind,playerId:d.playerId})), pending:S.pendingDecision, actionLogLen:S.actionLog.length,
             centerNow:document.getElementById('center').textContent.slice(0,150) };
  });
  say(bAfterSync.queue.filter(d=>d.playerId===0).length===0 && bAfterSync.pending && bAfterSync.pending.playerId===1,
      'B 端透過多人廣播同步收到 A 解卡的結果（B 自己完全沒動作），pendingDecision 換到 P1 自己的卡', JSON.stringify(bAfterSync));
  say(/新股|IPO|申購/.test(bAfterSync.centerNow),
      '輪到 B 自己的決策之後，B 的畫面自動從「等待中」切換成自己真正的 IPO 決策卡（modal）',
      bAfterSync.centerNow.slice(0,60));

  // B（P1，現在才是擁有者）用真實按鈕解掉自己的卡
  const bDecide = await B.evaluate(async ()=>{
    const ui=ns.ui;
    ui.render();
    const btns=[...document.querySelectorAll('#center button')];
    const declineBtn = btns.find(b=>/都不要/.test(b.textContent));
    if(!declineBtn) return {found:false, html:document.getElementById('center').textContent.slice(0,150)};
    declineBtn.click();
    await new Promise(r=>setTimeout(r,500));
    return {found:true, queue:ui.S.decisionQueue.map(d=>({kind:d.kind,playerId:d.playerId})), phase:ui.S.phase};
  });
  say(bDecide.found && bDecide.queue.length===0, 'B（P1）解掉自己的卡成功，佇列清空、遊戲繼續（phase='+ (bDecide.phase||'?') +'）', JSON.stringify(bDecide));

  await A.waitForTimeout(500);
  const aAfterB = await A.evaluate(()=> ({ queueLen:ns.ui.S.decisionQueue.length, phase:ns.ui.S.phase }));
  say(aAfterB.queueLen===0, 'A 端也透過廣播同步看到佇列清空（兩端狀態一致，遊戲能繼續往下走）', JSON.stringify(aAfterB));

  log.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+[...new Set(errs)].slice(0,8).join('\n')) : '--- no page errors ---');
  await b.close(); srv.close();
})();

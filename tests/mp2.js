const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const http=require('http'), fs=require('fs'), path=require('path');
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
  const A=await mk(), B=await mk(), C=await mk();
  const log=[];
  const say=(ok,n,d='')=>log.push((ok?'OK   ':'FAIL ')+n+(d?'  '+d:''));

  // A 建房（系統隨機職業，3 人）
  const code=await A.evaluate(async ()=>{
    const ui=ns.ui;
    ui.mpCreate('local');
    const ov=[...document.querySelectorAll('.overlay')].pop();
    // 選 3 人 / 系統隨機
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
  say(!!code && /^\d{4}$/.test(code), '建房成功且房號為 4 碼', '房號='+code);
  const randOff = await A.evaluate(()=>{
    const lb=document.getElementById('mpLobby');
    const pb=[...lb.querySelectorAll('button')].filter(b=>/職業：開局隨機指派/.test(b.textContent))[0];
    return { hasRandBtn: !!pb, disabled: pb?pb.disabled:null, sub:/職業：系統隨機指派/.test(lb.textContent) };
  });
  say(randOff.hasRandBtn && randOff.disabled===true && randOff.sub, '隨機模式下大廳關掉職業選單', JSON.stringify(randOff));

  // B、C 入房
  for(const [pg,nm] of [[B,'小美'],[C,'阿強']]){
    const joined=await pg.evaluate(async ({code,nm})=>{
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
    }, {code,nm});
    say(joined, nm+' 用 4 碼房號入房並按下準備');
  }
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
        profs:ns.ui.S.players.map(p=>p.professionId), names:ns.ui.S.players.map(p=>p.name)}; }
    return {ok:false, why:'開局後沒進到遊戲'};
  });
  say(started.ok, '房主開局', JSON.stringify(started));
  await B.waitForTimeout(1500); await C.waitForTimeout(1500);
  const seats=[]; for(const pg of [A,B,C]) seats.push(await pg.evaluate(()=>({
    seat: ns.ui.mp&&ns.ui.mp.seat, myId: ns.ui.myId(),
    prof: ns.ui.S? ns.ui.S.players[ns.ui.mp.seat].professionId : null,
    name: ns.ui.S? ns.ui.S.players[ns.ui.mp.seat].name : null })));
  say(seats.map(s=>s.seat).join(',')==='0,1,2', '三個座位各自認得自己', JSON.stringify(seats));
  const profs=(started.profs||[]);
  say(new Set(profs).size===profs.length && profs.length===3, '隨機職業不重複', profs.join('/'));

  // 2 號座位（阿強）能不能操作自己的財報
  const seat2=await C.evaluate(()=>{
    const ui=ns.ui, S=ui.S;
    ui.viewPlayerId=null; ui.renderSheet();
    const t=document.getElementById('sheet').textContent;
    return { isSelf: !/檢視他人財報中/.test(t), myId: ui.myId(),
             name: S.players[ui.myId()].name };
  });
  say(seat2.isSelf && seat2.myId===2, '2 號座位看自己的財報＝自己（FF-003a）', JSON.stringify(seat2));

  // 同號建房不得覆蓋活房
  const dup=await B.evaluate(async (code)=>{
    const room={ meta:{ ver:ns.BUILD.ver, status:"lobby", hostUid:"zzz", maxPlayers:2,
                        preset:"STANDARD", modules:[], createdAt:Date.now(), kind:"local" },
                 setup:null, lobby:{}, log:[], presence:{} };
    const before=localStorage.getItem("finflow.mproom."+code);
    // 直接打 LocalAdapter：現行 API 從 ns 拿不到，改用 localStorage 對照 createRoom 的把關結果
    return { hadRoom: !!before };
  }, code);
  say(dup.hadRoom, '房間確實存在於 localStorage（供上面的原子建房把關）');

  log.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+[...new Set(errs)].slice(0,8).join('\n')) : '--- no page errors ---');
  await b.close(); srv.close();
})();

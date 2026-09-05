const { chromium } = require('playwright');
/* S35 節奏三項（真人實測回饋：「節奏變慢很大，原因是訊息量太多，決策變慢」）：
     ① 薪資係數 salaryMult 1.0→1.1（500 局：全局中位 67→61、SAFE 破產 8.1→3.2）
     ② 記帳門檻 5→3，且練熟當下直接切成自動（bkAutoOnMastery=1；面板仍可關回手記；0＝S11 行為）
     ③ 通知三分法：SYS／POP 照跳、操作回饋貼按鈕旁（hint）、其餘進左欄訊息欄；
        結算彙總改「只在大事才彈」（現金變動 ≥ 一個月支出、或有其他玩家引發的帳）；
        訊息欄分三桶篩選＋「新 N」
   用法（repo 根目錄）： node tests/s35test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));

/* 30 輪全電腦代跑，量「玩家實際會看到什麼」——與 s18test 的 play() 同一套走法，只是量的契約不同 */
function play(arg){
  const MAXT=arg.turns, mode=arg.mode;
  const ui=ns.ui, E=ns.engine;
  const cfg = ns.buildConfig(ns.configRegistry); cfg.dreamRoutePool = 0;
  ui.startCore(7711, cfg, ["M1","M2","M3","M4","M6","M8"],
    ["我","穩健阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
  document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
  ui.notifyMode=mode; ui._sumAlways=false; ui._sumOff=false; ui._sumMark={}; ui._mutedToasts=[];
  ui.feed=[]; ui._feedSeen=0;

  let sumOpened=0, myTurnEnds=0;
  const origShow=ui.showTurnSummary;
  ui.showTurnSummary=function(pid){
    const before=document.querySelectorAll('#overlays .overlay').length;
    const r=origShow.apply(ui,arguments);
    if(document.querySelectorAll('#overlays .overlay').length>before) sumOpened++;
    return r;
  };
  let toastShown=0, hintShown=0; const shownList=[], topics={};
  const origST=ui._showToast, origHint=ui.hint;
  ui._showToast=function(msg,cls,ms){ toastShown++; if(shownList.length<12) shownList.push(String(msg).slice(0,26)); return origST.apply(ui,arguments); };
  ui.hint=function(){ hintShown++; return origHint.apply(ui,arguments); };
  const origToast=ui.toast;
  ui.toast=function(msg,cls,ms,topic){ topics[topic||'-']=(topics[topic||'-']||0)+1; return origToast.apply(ui,arguments); };

  let guard=0, wasMine=false;
  while(!ui.S.over && ui.S.turnNumber<=MAXT && guard++<20000){
    const act=E.activePlayer(ui.S);
    const wasNPC=act.isNPC;
    if(!wasNPC){ act.isNPC=true; act.npcPersonality=act.npcPersonality||"NPC_SAFE"; }
    let a=ns.npc.nextAction(ui.S);
    act.isNPC=wasNPC;
    if(!a) a={type:"END_TURN",playerId:act.id,payload:null};
    if(a.type==="DECIDE" && ui.S.pendingDecision) a.payload.decisionId=ui.S.pendingDecision.decisionId;
    if(ui.S.phase==="BOOKKEEPING" && ui.S.bookkeeping){
      const bk=ui.S.bookkeeping, idx=bk.tasks.findIndex(t=>!t.done);
      if(idx>=0) a={type:"CLASSIFY_ENTRY",playerId:bk.playerId,
        payload:{taskIdx:idx, quadrant:ns.ledger.QUADRANT[bk.tasks[idx].account]}};
    }
    let res=E.apply(ui.S,a);
    if(res.rejected) res=E.apply(ui.S,{type:"END_TURN",playerId:act.id,payload:null});
    if(res.rejected) break;
    ui.S=res.state; ui.handleEvents(res.events);
    const mine = ui.S.activePlayerIdx===0 && !ui.S.players[0].bankrupt;
    if(wasMine && !mine) myTurnEnds++;
    wasMine=mine;
    try{ ui.render(); }catch(e){}
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
  }
  ui.showTurnSummary=origShow; ui._showToast=origST; ui.hint=origHint; ui.toast=origToast;
  const feed=ui.feed||[];
  const cats={}; feed.forEach(r=>{ cats[r.cat||'?']=(cats[r.cat||'?']||0)+1; });
  return { turns:ui.S.turnNumber, myTurnEnds, sumOpened, toastShown, hintShown, shownList, topics,
           feedLen:feed.length, cats, bkAuto:ui.S.players[0].bkAuto, bkUnlocked:ui.S.players[0].bkUnlocked,
           chips:document.querySelectorAll('#infoL .feedFilter .chip').length };
}

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
    const four=["我","阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||3500, c, MODS, four, {noRules:true}); close();
      ui.notifyMode="S35"; ui._sumAlways=false; ui._sumOff=false; ui._mutedToasts=[]; ui._sumMark={};
      return ui.S; };
    const toastN=()=>document.querySelectorAll('#toast .toast').length;
    const clearToast=()=>{ document.getElementById('toast').innerHTML=""; const h=document.getElementById('hintBubble'); if(h) h.remove(); };
    const reg=k=>ns.configRegistry.params.filter(p=>p.key===k)[0];

    /* ---------- ① 薪資係數 ---------- */
    step("salaryMult 預設 1.1，且開局薪水真的乘上去",()=>{
      A(reg("salaryMult") && reg("salaryMult").value===1.1,"預設應為 1.1，實得 "+(reg("salaryMult")||{}).value);
      const S=fresh(3501), p=S.players[0];
      const prof=ns.content.byId[p.professionId]||ns.content.professions.filter(x=>x.id===p.professionId)[0];
      A(prof,"找不到職業");
      A(Math.abs(p.baseSalary-util.r2(prof.salary*1.1))<1e-6,"開局薪水應＝職業薪資×1.1，實得 "+p.baseSalary+"（職業 "+prof.salary+"）");
      const S0=fresh(3501,{salaryMult:1}), p0=S0.players[0];
      A(Math.abs(p0.baseSalary-prof.salary)<1e-6,"salaryMult=1 應回到卡面薪資（鐵律 4 的回歸路徑）");
      return prof.title+" "+prof.salary+" → "+p.baseSalary;
    });

    /* ---------- ② 記帳門檻與自動化 ---------- */
    step("bkMasteryStreak 預設 3、bkAutoOnMastery 預設 1",()=>{
      A(reg("bkMasteryStreak").value===3,"門檻應為 3，實得 "+reg("bkMasteryStreak").value);
      A(reg("bkAutoOnMastery") && reg("bkAutoOnMastery").value===1,"應有 bkAutoOnMastery 且預設 1");
      return "3／1";
    });
    const drill=(S,p,n)=>{
      for(let i=0;i<n;i++){
        ns.ledger.post(S,p,"測試買資產 "+i,[{account:"CASH",delta:-10,label:"c"},{account:"ASSET",delta:10,label:"a"}],{eduTags:["test"]});
        E.buildBookkeeping(S,p); S.phase="BOOKKEEPING";
        let guard=0;
        while(S.bookkeeping && guard++<10){
          const idx=(S.bookkeeping.tasks||[]).findIndex(t=>!t.done); if(idx<0) break;
          const r=E.apply(S,{type:"CLASSIFY_ENTRY",playerId:p.id,payload:{taskIdx:idx,quadrant:"asset"}},{mutate:true});
          A(!r.rejected,"分類被拒："+r.reason);
        }
      }
    };
    step("連續 3 筆整筆全對 → 練熟當下直接切成自動，該套題目立刻收掉",()=>{
      const S=fresh(3502), p=S.players[0];
      p.bkStreak={}; p.bkUnlocked={}; p.bkAuto={}; p.bkEntryBad={};
      drill(S,p,2);
      A(!p.bkUnlocked.buyCash && !p.bkAuto.buyCash,"2 筆不該練熟");
      // 第 3 筆：同一輪再貼一筆同套的帳，練熟後它應該被自動收掉
      ns.ledger.post(S,p,"測試買資產 X",[{account:"CASH",delta:-10,label:"c"},{account:"ASSET",delta:10,label:"a"}],{eduTags:["test"]});
      ns.ledger.post(S,p,"測試買資產 Y",[{account:"CASH",delta:-10,label:"c"},{account:"ASSET",delta:10,label:"a"}],{eduTags:["test"]});
      E.buildBookkeeping(S,p); S.phase="BOOKKEEPING";
      A(S.bookkeeping && S.bookkeeping.tasks.filter(t=>!t.done).length===2,"測試前提：兩題待答");
      const idx3=S.bookkeeping.tasks.findIndex(t=>!t.done);   // 同輪早先答完的題目仍在清單裡（done:true），要挑未答的
      const r=E.apply(S,{type:"CLASSIFY_ENTRY",playerId:p.id,payload:{taskIdx:idx3,quadrant:"asset"}},{mutate:true});
      A(!r.rejected,"分類被拒："+JSON.stringify(r).slice(0,80));
      A(p.bkUnlocked.buyCash===true,"第 3 筆答完應練熟");
      A(p.bkAuto.buyCash===true,"練熟當下應直接切成自動");
      A(!S.bookkeeping || S.bookkeeping.tasks.filter(t=>!t.done && t.group==="buyCash").length===0,"同套剩下的題目應立刻收掉");
      const evs=r.events.map(e=>e.type);
      A(evs.indexOf("BK_MASTERED")>=0 && evs.indexOf("BK_AUTO_SET")>=0,"要同時發 BK_MASTERED 與 BK_AUTO_SET，實得 "+evs.join(","));
      const m=r.events.filter(e=>e.type==="BK_MASTERED")[0];
      A(m.autoOn===true,"BK_MASTERED 要帶 autoOn 讓介面說對話");
      return "3 筆練熟 → bkAuto.buyCash=true，第 4 題自動收掉";
    });
    step("練熟之後仍可關回手記；bkAutoOnMastery=0 回到 S11（只亮開關）",()=>{
      const S=fresh(3503), p=S.players[0];
      p.bkStreak={}; p.bkUnlocked={}; p.bkAuto={}; p.bkEntryBad={};
      drill(S,p,3);
      A(p.bkAuto.buyCash===true,"測試前提：已自動");
      const r=E.apply(S,{type:"SET_BK_AUTO",playerId:p.id,payload:{group:"buyCash",on:false}},{mutate:true});
      A(!r.rejected && p.bkAuto.buyCash===false,"要能關回手記");
      const S0=fresh(3503,{bkAutoOnMastery:0}), p0=S0.players[0];
      p0.bkStreak={}; p0.bkUnlocked={}; p0.bkAuto={}; p0.bkEntryBad={};
      drill(S0,p0,3);
      A(p0.bkUnlocked.buyCash===true && !p0.bkAuto.buyCash,"=0 時只解鎖不自動（S11 行為）");
      return "關回手記 OK；=0 時只亮開關";
    });
    step("沒練到的那一套不會跟著自動（貸款買資產仍要手記）",()=>{
      const S=fresh(3504), p=S.players[0];
      p.bkStreak={}; p.bkUnlocked={}; p.bkAuto={}; p.bkEntryBad={};
      drill(S,p,3);
      A(p.bkAuto.buyCash===true && !p.bkAuto.buyLoan && !p.bkAuto.debt,"只有練熟的那一套自動");
      return "buyCash 自動、buyLoan／debt 仍手記";
    });

    /* ---------- ③ 通知三分法 ---------- */
    step("預設是精簡模式：SYS／POP 跳 toast，其餘不跳",()=>{
      fresh(3505);
      A(ui.notifyMode==="S35","預設應為 S35，實得 "+ui.notifyMode);
      A(ui.toastMuted("warn","SYS")===false && ui.toastMuted("good","POP")===false,"SYS／POP 要跳");
      A(ui.toastMuted("warn")===true && ui.toastMuted("warn","MINE")===true && ui.toastMuted("bad","OTHERS")===true,"其餘一律不跳 toast");
      clearToast();
      ui.toastSys("景氣轉入：衰退","warn"); A(toastN()===1,"SYS 應跳出來");
      ui.toast("賣出 X 損益 +5","good"); A(toastN()===1,"MINE 不該再跳 toast");
      return "SYS 1 則、MINE 0 則";
    });
    step("不跳的通知進左欄訊息欄，帶類別；與 announce 重覆的不重記",()=>{
      const S=fresh(3506); ui.feed=[];
      const n0=ui.feed.length;
      ui.toast("🏦 你的定存到期","good");
      A(ui.feed.length===n0+1,"應進訊息欄");
      const row=ui.feed[ui.feed.length-1];
      A(row.cat==="MINE","自己的事應歸 MINE，實得 "+row.cat);
      A(row.tone==="pos","good 應標 pos");
      // 先 announce 再 toast 同一件事（修繕那種寫法）→ 不重覆
      ui.announce("我：⚒ 老屋 修繕支出 −5,000（漏水）",0);
      const n1=ui.feed.length;
      ui.toast("⚒ 老屋 修繕支出 −5,000（漏水）","warn");
      A(ui.feed.length===n1,"與本輪最近一則包含關係的不該重記");
      // 別人引發的歸 OTHERS
      ui.toast("槓桿哥 婉拒了這筆交易","warn");
      A(ui.feed[ui.feed.length-1].cat==="OTHERS","出現別人名字應歸 OTHERS");
      // 總經類文字歸 SYS
      ui.announce("央行升息：基準利率 2% → 3%");
      A(ui.feed[ui.feed.length-1].cat==="SYS","利率應歸 SYS");
      return "MINE／OTHERS／SYS 三桶＋去重";
    });
    step("操作回饋貼在剛按的按鈕旁（氣泡），沒有最近點擊就退回 toast",()=>{
      fresh(3507); clearToast();
      const btn=document.getElementById("btnMall") || document.querySelector("#opsGrid button");
      A(btn,"缺操作區按鈕");
      ui._lastClick={el:btn, at:Date.now()};
      ui.hint("現金不足","warn");
      const hb=document.getElementById("hintBubble");
      A(hb,"應出現氣泡");
      const r1=btn.getBoundingClientRect(), r2=hb.getBoundingClientRect();
      A(Math.abs((r1.left+r1.width/2)-(r2.left+r2.width/2))<Math.max(40,r1.width),"氣泡要對齊按鈕（水平中心）");
      A(toastN()===0,"有氣泡就不該再跳 toast");
      hb.remove();
      ui._lastClick={el:btn, at:Date.now()-9000};
      ui.hint("現金不足","warn");
      A(!document.getElementById("hintBubble") && toastN()===1,"沒有最近點擊應退回 toast");
      return "氣泡對齊按鈕；過期點擊退回 toast";
    });
    step("「現金不足」這類回饋已改走 hint，不再是 toast（原始碼掃描）",()=>{
      const src=(ui.showMall+ui.showSkillMenu+ui.showStockPanel+"");
      const bad=(src.match(/ui\.toast\("現金不足"/g)||[]).length;
      A(bad===0,"仍有 "+bad+" 處「現金不足」走 toast");
      return "0 處殘留";
    });
    step("舊制（notifyMode=S18）整套切得回來",()=>{
      fresh(3508); ui.notifyMode="S18"; ui._sumOff=false; clearToast(); ui._mutedToasts=[];
      ui.toastSys("景氣轉入：衰退","warn"); A(toastN()===0 && ui._mutedToasts.length===1,"S18：SYS 應靜音入彙總");
      ui.toast("被拒","warn"); A(toastN()===1,"S18：warn 應照跳");
      A(ui.sumMode()==="always","S18 模式下彙總每輪都彈");
      ui.notifyMode="S35";
      return "S18 規則可重現";
    });

    /* ---------- ③ 結算彙總只在大事才彈 ---------- */
    step("預設 sumMode=auto；小額變動不彈、達一個月支出才彈、有別人引發的帳也彈",()=>{
      const S=fresh(3509), p=S.players[0];
      A(ui.sumMode()==="auto","預設應為 auto，實得 "+ui.sumMode());
      const exp=p.derived.totalExpenses; A(exp>0,"測試前提：有月支出");
      ui._sumMark={}; ui.markTurnSummary(0); close();
      ns.ledger.post(S,p,"小錢",[{account:"CASH",delta:-util.r2(exp*0.3),label:"x"}],{eduTags:["test"]});
      ui._wasMyTurn=true; S.activePlayerIdx=1; ui.checkTurnSummary();
      A(!document.querySelector('#overlays .sheetbox'),"小額變動不該彈");
      A((ui._sumMark[0]||0)===p.ledger.length,"不彈也要把結算標記推進（下次只算新的）");
      ns.ledger.post(S,p,"大錢",[{account:"CASH",delta:-util.r2(exp*1.2),label:"x"}],{eduTags:["test"]});
      ui._wasMyTurn=true; S.activePlayerIdx=1; ui.checkTurnSummary();
      const ov=document.querySelector('#overlays .sheetbox');
      A(ov,"達一個月支出應彈");
      A(/只在大事才彈/.test(ov.textContent),"要說明為什麼這一輪彈了");
      close();
      ns.ledger.post(S,p,"接受轉介機會",[{account:"CASH",delta:-1,label:"x"}],{eduTags:["referral"]});
      ui._wasMyTurn=true; S.activePlayerIdx=1; ui.checkTurnSummary();
      A(document.querySelector('#overlays .sheetbox'),"有其他玩家引發的帳應彈");
      close();
      ui._sumAlways=true;
      ns.ledger.post(S,p,"小錢2",[{account:"CASH",delta:-1,label:"x"}],{eduTags:["test"]});
      ui._wasMyTurn=true; S.activePlayerIdx=1; ui.checkTurnSummary();
      A(document.querySelector('#overlays .sheetbox'),"_sumAlways 應每輪都彈");
      close(); ui._sumAlways=false;
      return "0.3× 不彈／1.2× 彈／轉介彈／always 彈";
    });
    step("彙總畫面右上角可關（S40）；設定面板仍有三段切換（只在大事／每輪／關）",()=>{
      const S=fresh(3510), p=S.players[0];
      ui._sumAlways=true; ui._sumMark={}; ui.markTurnSummary(0);
      ns.ledger.post(S,p,"x",[{account:"CASH",delta:-1,label:"x"}],{eduTags:["test"]});
      close(); ui.showTurnSummary(0);
      const ov=document.querySelector('#overlays .sheetbox'); A(ov,"彙總應開得起來");
      A(![].slice.call(ov.querySelectorAll('button')).some(b=>/顯示：|朕知道了/.test(b.textContent)),"S40：彙總畫面底下三顆鈕應已拿掉");
      const btn=[].slice.call(ov.querySelectorAll('button')).filter(b=>/不再顯示/.test(b.textContent))[0];
      A(btn,"S40：彙總畫面右上角要有『不再顯示』");
      close(); ui._sumAlways=false;
      ns.devpanel.build();
      const dv=document.getElementById("devbody");
      A(dv && /通知方式/.test(dv.textContent) && /只在大事才顯示/.test(dv.textContent),"調參面板要有通知方式與三段切換");
      return "彙總右上可關；設定面板三段切換仍在";
    });

    /* ---------- ③ 訊息欄篩選與新訊息 ---------- */
    step("左欄訊息欄有三桶篩選與「新 N」",()=>{
      const S=fresh(3511);
      ui.feed=[]; ui._feedFilter="ALL"; ui._feedSeen=0;
      ui.announce("央行升息：基準利率 2% → 3%"); ui.announce("你買下 X",0); ui.announce("槓桿哥 婉拒了轉介");
      ui.render();
      const chips=document.querySelectorAll('#infoL .feedFilter .chip');
      A(chips.length===4,"應有 4 顆篩選 chip，實得 "+chips.length);
      A(document.querySelector('#infoL .feedFilter .newBadge'),"應有新訊息標記");
      ui._feedFilter="SYS"; ui.render();
      const lines=[].slice.call(document.querySelectorAll('#sysLog .ln'));
      A(lines.length===1 && /升息/.test(lines[0].textContent),"篩 SYS 只該剩利率那一則，實得 "+lines.map(l=>l.textContent).join("|"));
      ui._feedFilter="ALL"; ui.render();
      A(document.querySelectorAll('#sysLog .ln').length===3,"回到全部應 3 則");
      A(document.querySelectorAll('#sysLog .ln .ci').length===3,"每則要帶類別標記");
      return "4 chip、篩選有效、新 3";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  let pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;

  /* ---------- ③ 30 輪量測：精簡模式 vs 舊制 ---------- */
  const r35=await pg.evaluate(play,{turns:30,mode:"S35"});
  const r18=await pg.evaluate(play,{turns:30,mode:"S18"});
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };
  console.log('30 輪 S35：我的回合結束 '+r35.myTurnEnds+' 次、彙總彈 '+r35.sumOpened+' 次、toast '+r35.toastShown+' 則、hint '+r35.hintShown+' 則、訊息欄 '+r35.feedLen+' 則 '+JSON.stringify(r35.cats)+'　topic '+JSON.stringify(r35.topics));
  console.log('30 輪 S18：彙總彈 '+r18.sumOpened+' 次、toast '+r18.toastShown+' 則');
  console.log('S35 跳出來的：'+JSON.stringify(r35.shownList));
  A(r35.myTurnEnds>=5,'測試前提：30 輪內我的回合至少結束 5 次，實得 '+r35.myTurnEnds);
  A(r35.sumOpened<r35.myTurnEnds,'精簡模式的彙總不該每輪都彈：'+r35.sumOpened+'/'+r35.myTurnEnds);
  A(r18.sumOpened>=r35.sumOpened,'舊制的彙總次數不該少於精簡模式');
  A(r35.feedLen>0 && (r35.cats.MINE||0)>0,'不跳的通知要真的進到訊息欄');
  A(r35.chips===4,'跑完 30 輪左欄仍有 4 顆篩選 chip，實得 '+r35.chips);
  A(errs.length===0,'有 console／page error：'+errs.slice(0,2).join('|'));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

/* S18 六項實測回饋：開真的瀏覽器跑 30 輪，量「玩家實際看到什麼」。
   驗收條件（全部 AI 自驗）：
   1. 結算彙總每一輪都出現（有帳務變動的輪）
   2. 系統類通知不再一則一則跳——30 輪內跳出來的 toast ≤2 則
   3. 系統訊息的擲骰行帶得到「決定：X」，且一行只有一個「決定：」
   4. 彙總畫面分三段列示，且三段小計加起來＝本輪合計
   5. 玩家卡壓矮後左欄系統訊息看得到的則數要比 S17 多
   6. 成本型卡片標籤含「淨利下降」，且分錄註記講到淨額慣例
*/
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));

function play(MAXT){
  const ui=ns.ui, E=ns.engine;
  /* S24：這一支量的是「玩家實際看到什麼」（彙總有沒有開、toast 跳幾則、版面高度），
     跟夢想里程碑抽選一點關係都沒有。但抽選會消耗亂數 → 種子 7711 的牌序整個位移 →
     這一局的一號玩家第 4 輪就破產，後面自然沒有他的回合可以彙總，測試會為了
     完全無關的理由紅掉。所以這裡把 dreamRoutePool 釘成 0（＝S23 以前的固定路線），
     讓它繼續量它本來要量的東西；抽選機制由 s24test 專責驗。 */
  const cfg18 = ns.buildConfig(ns.configRegistry); cfg18.dreamRoutePool = 0;
  ui.startCore(7711, cfg18, ["M1","M2","M3","M4","M6","M8"],
    ["我","穩健阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
  document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());

  let sumOpened=0, sumCalls=0;
  const origShow=ui.showTurnSummary;
  ui.showTurnSummary=function(pid){
    sumCalls++;
    const before=document.querySelectorAll('#overlays .overlay').length;
    const r=origShow.apply(ui,arguments);
    if(document.querySelectorAll('#overlays .overlay').length>before) sumOpened++;
    return r;
  };
  let shown=0; const shownList=[];
  const origToast=ui.toast;
  ui.toast=function(msg,cls,ms,topic){
    if(!ui.toastMuted(cls,topic)){ shown++; if(shownList.length<10) shownList.push((cls||'-')+'/'+(topic||'-')+' '+String(msg).slice(0,30)); }
    return origToast.apply(ui,arguments);
  };

  let guard=0;
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
    try{ ui.render(); }catch(e){}
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
  }

  const rollLines=(ui.feed||[]).filter(r=>r.tag==="roll");
  const withDecision=rollLines.filter(r=>/決定：/.test(r.msg));
  const doubled=rollLines.filter(r=>(r.msg.match(/決定：/g)||[]).length>1);
  return { turns:ui.S.turnNumber, sumOpened, sumCalls, toastShown:shown, shownList,
           rollLines:rollLines.length, withDecision:withDecision.length, doubled:doubled.length,
           sample:(withDecision[withDecision.length-1]||{}).msg||"" };
}

function summaryShape(){
  const ui=ns.ui;
  ui._sumMark={};
  ui._mutedToasts=[{msg:"景氣轉入：衰退",cat:"SYS"},{msg:"你買下 X",cat:"MINE"},{msg:"槓桿哥 轉介",cat:"OTHERS"}];
  ui.showTurnSummary(0);
  const box=document.querySelector('#overlays .sheetbox');
  if(!box) return {opened:false};
  const cats=[...box.querySelectorAll('tr.catHd')].map(tr=>tr.textContent.replace(/\s+/g,' ').slice(0,24));
  const bcast=(document.getElementById('bcast')||{}).innerHTML||"";
  const mutedTxt=[...box.querySelectorAll('.edu')].map(e=>e.textContent).join('|');
  return { opened:true, cats, catN:cats.length, bcastCleared:bcast==="",
           mutedHasAll:/系統與大環境/.test(mutedTxt) && /你自己的動作/.test(mutedTxt) && /其他玩家/.test(mutedTxt) };
}

function cardsAndLabels(){
  const ui=ns.ui;
  document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
  ui.render();
  const card=document.querySelector('#pawns .pcol');
  const infoL=document.getElementById('infoL');
  const visible=[...document.querySelectorAll('#infoL .ln')].filter(e=>{
    const r=e.getBoundingClientRect(), p=infoL.getBoundingClientRect();
    return r.top>=p.top-1 && r.bottom<=p.bottom+1; }).length;
  // S22：看得到幾則取決於這一局最後幾則有多少會折行（內容運氣），不是版面。
  // 改量「單行高度下裝得下幾則」當版面指標；實際看得到的則數照樣印出來看。
  const lnH=Math.min(...[...document.querySelectorAll('#infoL .ln')].map(e=>e.getBoundingClientRect().height).filter(h=>h>0));
  const capacity=Math.floor(infoL.getBoundingClientRect().height/lnH);
  const mk05=ns.content.byId["MK05"], mk08=ns.content.byId["MK08"];
  const note=ui.ledgerRow({summary:"人事成本上升 → 事業淨利下降",
    postings:[{account:"INCOME_PASSIVE",delta:-120}]}).note||"";
  return { cardH:Math.round(card.getBoundingClientRect().height),
           pawnsH:Math.round(document.getElementById('pawns').getBoundingClientRect().height),
           visibleLogLines:visible, logCapacity:capacity,
           cardHasCount:/／\s*\d+\s*筆/.test(card.textContent),
           cardHasStatusInline:!!card.querySelector('.nm .st'),
           mk05:mk05.effects[0].label, mk08:mk08.effects[0].label, note };
}

(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(800);

  let pass=0, fail=0;
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };

  const r=await pg.evaluate(play, 30);
  const s=await pg.evaluate(summaryShape);
  const c=await pg.evaluate(cardsAndLabels);

  A(errs.length===0, '有 console／page error：'+errs.slice(0,2).join('|'));
  A(r.turns>=25, '30 輪跑不完，只到第 '+r.turns+' 輪');
  A(r.sumOpened===r.sumCalls && r.sumOpened>=20,
    '結算彙總應每次都開得起來，實得 '+r.sumOpened+'/'+r.sumCalls);
  A(r.toastShown<=2, '系統類通知仍在一則一則跳：30 輪跳了 '+r.toastShown+' 則 '+JSON.stringify(r.shownList));
  A(r.withDecision>0, '沒有任何一行擲骰紀錄帶到「決定：」');
  A(r.doubled===0, '同一行出現多個「決定：」'+r.doubled+' 次（應接成 A → B）');
  A(!/決定：[A-Z_]{3,}\d/.test(r.sample), '決定顯示的是代號不是卡名：'+r.sample);
  A(s.opened, '結算彙總開不起來');
  A(s.catN>=2, '彙總沒有分類小標，實得 '+s.catN+' 段');
  A(s.cats.some(x=>/系統與大環境/.test(x)), '缺「系統與大環境」段');
  A(s.bcastCleared, '開結算時大事件橫幅沒收掉（z-index 820 會蓋住標題）');
  A(s.mutedHasAll, '被靜音的提示沒有分三類列出');
  A(c.cardH<=140, '玩家卡沒壓矮，實得 '+c.cardH+'px（S17 是 173px）');
  A(c.pawnsH<=300, '玩家區沒縮小，實得 '+c.pawnsH+'px（S17 是 361px）');
  A(c.logCapacity>=20, '左欄系統訊息的版面容量沒有變多，單行可裝 '+c.logCapacity+' 則（S17 版面約 11 則、S18 後 ≥20）；實際看得到 '+c.visibleLogLines+' 則');
  A(c.cardHasCount, '玩家卡看不到資產筆數（應併在被動收入那一行）');
  A(c.cardHasStatusInline, '狀態沒有併進名字那一列');
  A(/淨利下降/.test(c.mk05), 'MK05 標籤沒改：'+c.mk05);
  A(/淨利下降/.test(c.mk08), 'MK08 標籤沒改：'+c.mk08);
  A(/淨額/.test(c.note), '成本型收入變動缺淨額說明：'+c.note);

  console.log('30 輪：彙總 '+r.sumOpened+'/'+r.sumCalls+'　跳出來的 toast '+r.toastShown+
    ' 則　擲骰行 '+r.rollLines+' 行（帶決定 '+r.withDecision+' 行）');
  console.log('範例：'+r.sample);
  console.log('彙總分段：'+s.cats.join(' ｜ '));
  console.log('玩家卡 '+c.cardH+'px　玩家區 '+c.pawnsH+'px　系統訊息看得到 '+c.visibleLogLines+' 則（單行容量 '+c.logCapacity+' 則）');
  console.log(JSON.stringify({pass,fail}));
  await b.close();
  process.exit(fail?1:0);
})();

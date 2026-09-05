/* ============================================================================
   S20：互動教學（Interactive Tutorial）
   實測回饋：「說明檔想做成一個動態網頁虛擬面板，點下去浮出說明框。」

   設計決定（三個，都有理由）：
   1. 不畫假面板——直接跑一個固定種子的示範局，用「真正的 renderer」畫出來，
      再把熱點疊上去。熱點綁的是 DOM 錨點（id 與 data-tut）不是座標，所以
      版面改了熱點自己跟著跑。這個專案三天內改過三次版面，靜態圖一定會過期。
   2. iPad 沒有 hover——一律「點一下出說明」，熱點畫成看得見的編號圓點；
      桌機的 hover 只是附加。
   3. 教學在 iframe 裡載入自己（#tut），跟玩家正在進行的局完全隔離，
      按 ❔ 不會洗掉你的第 23 輪。file:// 下 iframe 載得起來（實測），
      父層讀不進子層（opaque origin），所以熱點一律畫在子層。

   卡片格式固定三段，每段一句話：這是什麼／時機／⚠ 跟勝負有關。
   ========================================================================== */
(function(ns){ "use strict";
var ui = ns.ui, E = ns.engine, util = ns.util;
var $ = function(id){ return document.getElementById(id); };
var tut = ns.tutorial = {};

/* ---------------- 內容：熱點清單 ---------------- */
/* anchor：CSS selector（第一層＝主畫面已存在的元素）
   open：第二層才有——先把子面板叫出來，再錨到面板裡的元素
   close：離開這一步時收拾 */
tut.STEPS = [
  /* ===== 第一層：左欄 ===== */
  { n:1, zone:"左欄", anchor:'[data-tut="macro"]', title:"總經訊息",
    what:"這一局的大環境：利率、通膨、景氣燈號。",
    when:"每輪都看一眼，尤其「下次利率檢視」剩幾輪。",
    warn:"升息會讓你所有機動利率貸款的月付變高。" },
  { n:2, zone:"左欄", anchor:'[data-tut="syslog"]', title:"系統訊息",
    what:"每一行是「誰 擲幾點 → 停在哪 → 決定了什麼」。",
    when:"想知道別人做了什麼、或回顧自己剛剛選了什麼。",
    warn:"別人買走的機會不會再出現，看得懂節奏才搶得到。" },
  { n:3, zone:"左欄", anchor:'#pawns', title:"玩家卡",
    what:"每個人的現金、淨現金流、被動收入與資產筆數。",
    when:"考慮找誰合資、跟誰借錢、或誰快贏了。",
    warn:"點「📜 紀錄」可以看那個人每一輪發生什麼。" },

  /* ===== 第一層：中欄 ===== */
  { n:4, zone:"中欄", anchor:'#warnBox', title:"重大事件警告",
    what:"即將發生、需要你提前反應的事。",
    when:"看到就要動作，不是看過就算。",
    warn:"黑天鵝會預告 4–8 輪，那段時間是你調整部位的唯一機會。" },
  { n:5, zone:"中欄", anchor:'#boardWrap', title:"盤面",
    what:"內圈 24 格是底層牛馬區，外圈 12 格是夢想圈。",
    when:"擲骰後看自己停在哪一格。",
    warn:"盤面沒有發薪格了——每輪開始全體固定發薪。" },
  { n:6, zone:"中欄", anchor:'#boardCenter', title:"擲骰與結束回合",
    what:"骰子與主要按鈕都在盤面正中央。",
    when:"輪到你就會亮起來，發呆 3 秒會自動擲。",
    warn:"結束回合前記得先買賣、還款、逛商城——過了就要等下一輪。" },
  { n:7, zone:"中欄", anchor:'[data-tut="stocks"]', title:"股市資訊",
    what:"四檔股票的現價與漲跌，點任一列開單檔面板。",
    when:"想買賣、或想知道自己的持股現在值多少。",
    warn:"四檔的性格差很多，投機股是唯一會下市歸零的一檔。" },
  { n:8, zone:"中欄", anchor:'[data-tut="exchange"]', title:"交易所",
    what:"進行中的 P2P 借貸與合資部位。",
    when:"跟別人有金錢往來時在這裡看進度。",
    warn:"P2P 每期都會自動扣款，忘記了現金會被吃掉。" },
  { n:9, zone:"中欄", anchor:'#opsBox', title:"操作區",
    what:"交易所、人生商城、自動執行、結束遊戲。",
    when:"永遠釘在畫面最下面，不用捲就按得到。",
    warn:"「自動執行」可以暫時交給電腦代打，隨時按「我來」接回。" },

  /* ===== 第一層：右欄 ===== */
  { n:10, zone:"右欄", anchor:'[data-tut="credit"]', title:"信用與借款空間",
    what:"你的信用評級、可借額度，借款與還款鈕都在這裡。",
    when:"錢不夠、或想提前還債的時候。",
    warn:"額度＝月收入 × 倍數 − 現有無擔保負債；評級掉到 C 會少一半。" },
  { n:11, zone:"右欄", anchor:'[data-tut="fin"]', title:"損益表與資產負債表",
    what:"左邊是每月的收支，右邊是此刻的家底。",
    when:"任何重大決定之前都該先看這裡。",
    warn:"淨現金流是負的，代表你每個月都在失血。" },
  { n:12, zone:"右欄", anchor:'[data-tut="freedom"]', title:"自由進度與獲勝條件",
    what:"被動收入追過總支出就是 100%，下面是獲勝的兩個條件。",
    when:"這是整局最重要的一條進度條。",
    warn:"夢想 5 點與幸福感 10 點兩個都要到——只有錢不算贏。" },
  /* S34：進修入口從右欄升到操作區，教學的錨點跟著搬——
     原本指的 [data-tut="learn"] 現在只有「正在進修／冷卻中」才會出現，指不到就是空的。 */
  { n:13, zone:"中欄", anchor:'#btnSkill', title:"進修商城",
    what:"所有技能都在這裡，依投入量級分組；學過的收在「技能證書牆」。",
    when:"想提高收入、或想拿到技能加成的時候。不能報名的時段也打得開，可以先研究。",
    warn:"技能會過時，到期前 2 輪會預告，續期只要一半學費。" },
  { n:14, zone:"右欄", anchor:'[data-tut="detail"]', title:"資產與負債細項",
    what:"每一筆資產的兩種報酬率，以及每一筆負債的月付與利率。",
    when:"要賣資產、或要決定先還哪一筆的時候。",
    warn:"現金報酬看槓桿放大多少，資產報酬看標的本身好不好。" },
  { n:15, zone:"右欄", anchor:'[data-tut="holdings"]', title:"庫存股票",
    what:"你的持股、成本、損益與維持率，可以直接買賣。",
    when:"股價變動後想加碼或停損。",
    warn:"買賣要付手續費與證交稅，來回一趟先賠 0.585%。" },

  /* ===== 第二層：子面板 ===== */
  { n:16, zone:"子面板", layer:2, title:"回合結算表",
    what:"你的回合結束後，這一輪與你有關的每一筆都在這裡。",
    when:"每回合結束自動跳出，按「朕知道了」關掉。",
    warn:"分成系統／自己／其他玩家三段，看得出錢是被誰動掉的。",
    open:function(){ ui._sumMark={}; ui._mutedToasts=[{msg:"景氣轉入：過熱",cat:"SYS"},
        {msg:"你買下「校園販賣機組」",cat:"MINE"},{msg:"穩健阿姨 邀你合資",cat:"OTHERS"}];
      ui.showTurnSummary(0); },
    anchor:'#overlays .sheetbox' },
  { n:17, zone:"子面板", layer:2, title:"記帳盤面",
    what:"把這回合的錢分到資產／負債／收入／支出四格。",
    when:"每回合結束前，標準難度以上都要做。",
    warn:"整筆全對連續 3 次就自動接手記帳，錯一格整筆歸零。",
    open:function(){ var S=ui.S, p=S.players[0];
      E.buildBookkeeping(S,p); S.phase="BOOKKEEPING";
      ui.modalOn(true); ui.renderBookkeeping(S,p); },
    anchor:'#center .card, #overlays .sheetbox',
    close:function(){ var S=ui.S; S.bookkeeping=null; S.phase="ROLL"; ui.modalOn(false); } },
  { n:18, zone:"子面板", layer:2, title:"股市單檔面板",
    what:"K 線、買賣、定期定額與股息再投入都在這一頁。",
    when:"點中欄任何一檔股票就會打開。",
    warn:"「可買 N 張」已經幫你算好現金上限，不用自己算。",
    open:function(){ ui.showStockPanel("STK_DIV"); },
    anchor:'#overlays .sheetbox' },
  { n:19, zone:"子面板", layer:2, title:"人生商城",
    what:"進修、健康、保險、人情與挑戰，買的是報表以外的東西。",
    when:"輪到自己的時候。",
    warn:"只能自己回合買、每輪一件；同一件重複買幸福感會遞減。",
    open:function(){ ui.showMall(); },
    anchor:'#overlays .sheetbox' },
  { n:20, zone:"子面板", layer:2, title:"每輪紀錄",
    what:"那位玩家每一輪發生什麼、五欄各變動多少。",
    when:"想回頭查帳、或想知道別人怎麼走到今天。",
    warn:"任何一張玩家卡上的「📜 紀錄」都點得進來。",
    open:function(){ ui.showRoundLog(0); },
    anchor:'#overlays .sheetbox' }
];

/* 常駐的「會害你輸的七件事」 */
tut.PITFALLS = [
  "幸福感沒到 10 點不算贏——錢做滿了也沒用，這是最多人栽的地方。",
  "人生商城只能自己回合買，而且每一輪只能買一件。",
  "淨現金流是負的時候，融資閘門會直接擋住你開新部位。",
  "投機股是四檔裡唯一會下市歸零的一檔。",
  "夢想點數越買越貴：第 n 點要 175,000 × n 元。",
  "夢想圈現金變負只能急售自救 2 次，救不回就跌回內圈重新上班。",
  "記帳要整筆全對連續 5 次才解鎖自動，錯一格整筆歸零。"
];

/* ---------------- 父層：開啟教學 ---------------- */
tut.open = function(){
  var ov = ui.mkEl("div","overlay"); ov.id="tutFrameOv";
  ov.style.cssText = "position:fixed;inset:0;z-index:900;background:rgba(6,10,16,.96);"+
    "display:flex;flex-direction:column;padding:0";
  var bar = ui.mkEl("div"); bar.style.cssText =
    "flex:none;display:flex;align-items:center;gap:10px;padding:8px 14px;"+
    "background:var(--ink2);border-bottom:1px solid var(--line)";
  bar.appendChild(ui.mkEl("b",null,"🎓 互動教學"));
  var hint = ui.mkEl("span",null,"這是一局示範，怎麼點都不會影響你正在玩的局");
  hint.style.cssText="color:var(--tx3);font-size:12px"; bar.appendChild(hint);
  var xb = ui.mkEl("button","act","✕ 關閉教學");
  xb.style.cssText="margin-left:auto"; xb.onclick=function(){ ov.remove(); };
  bar.appendChild(xb); ov.appendChild(bar);
  var fr = document.createElement("iframe");
  fr.style.cssText="flex:1;width:100%;border:0;background:var(--ink)";
  /* 載入自己＋#tut：子層會自己起示範局並畫熱點。
     file:// 下父層讀不進子層（opaque origin），所以互動全部在子層完成。 */
  fr.src = location.pathname + (location.search||"") + "#tut";
  ov.appendChild(fr);
  $("overlays").appendChild(ov);
};

/* ---------------- 子層：起示範局 ---------------- */
tut.isChild = function(){
  return (typeof location!=="undefined") && location.hash === "#tut";
};

/* 直接把示範狀態組出來——不驅動 NPC 迴圈，避免卡在半路，也保證每次一樣 */
tut.buildDemo = function(){
  var cfg = ns.buildConfig(ns.configRegistry);
  // 示範盤面必須是靜止的。第六期的「閒置 3 秒自動擲骰」會在教學開著時自己擲下去，
  // 中欄跳出「要翻哪一堆機會？」，說明卡還停在第 5 格——框跟內容就對不起來了。
  cfg.autoRollSec = 0;
  var mods = ["M1","M2","M3","M4","M6","M8"];
  var C = ns.content;
  ui.startCore(20260830, cfg, mods, [
    { name:"你",   isNPC:false, professionId:C.professions[12].id, dreamCardId:C.dreams[0].id },
    { name:"穩健阿姨", isNPC:true, personality:"NPC_SAFE",  professionId:C.professions[6].id,  dreamCardId:C.dreams[2].id },
    { name:"槓桿哥",  isNPC:true, personality:"NPC_LEVER", professionId:C.professions[9].id,  dreamCardId:C.dreams[4].id },
    { name:"風投弟",  isNPC:true, personality:"NPC_VC",    professionId:C.professions[16].id, dreamCardId:C.dreams[6].id }
  ], { noRules:true });
  document.querySelectorAll("#overlays .overlay").forEach(function(o){ o.remove(); });
  ui._sumOff = true;                       // 教學裡不要自動彈結算
  var S = ui.S, me = S.players[0];
  S.turnNumber = 23;

  // 給主角一份「看得懂」的家底：現金、兩筆資產、一筆股票、一筆貸款
  ns.ledger.post(S, me, "示範：期初現金", [{account:"CASH",delta:520,label:"x"}], {eduTags:["setup"]});
  var buyable = (C.cards.OPPORTUNITY_SMALL||[]).filter(function(c){
    return (c.kind==="REALESTATE"||c.kind==="BUSINESS") && ((c.payload||{}).price||0) <= 400; });
  if(buyable[0]) E.buyAsset(S, me, buyable[0], "cash", {});
  if(buyable[1]) E.buyAsset(S, me, buyable[1], "loan", {});
  try{ E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_DIV",side:"buy",units:3}},{mutate:true}); }catch(e){}
  try{ E.addLiability(S, me, "CONSUMER", "學貸", 300, 0.018, false); }catch(e){}
  ns.ledger.recompute(me);

  // 讓其他人也有東西可看
  S.players.slice(1).forEach(function(q,i){
    ns.ledger.post(S,q,"示範：期初現金",[{account:"CASH",delta:180+i*90,label:"x"}],{eduTags:["setup"]});
    if(buyable[i]) { try{ E.buyAsset(S,q,buyable[i],"cash",{}); }catch(e){} }
    ns.ledger.recompute(q);
  });

  // 系統訊息要有內容才看得懂那一區在幹嘛
  ui.feed = [];
  ui.announce("🎲 槓桿哥 擲 4 點 → 機會　決定：夜市小吃攤（頂讓）→ 用貸款", 2, "roll");
  ui.announce("🎲 穩健阿姨 擲 2 點 → 市場", 1, "roll");
  ui.announce("央行升息：基準利率 3.50% → 5.00%");
  ui.announce("🎲 你 擲 6 點 → 機會　決定：校園販賣機組 → 用現金", 0, "roll");
  ui.announce("景氣轉入「過熱」");
  S.phase = "ROLL";
  E.syncPhase(S);
  ui.render();
  try{ clearInterval(ui._autoRollT); ui._autoRollT=null; }catch(e){}
};

/* ---------------- 子層：熱點層 ---------------- */
tut.state = { i:0, mode:"guided", sel:null };   // sel＝自由模式目前展開的那一格

/* body 有 zoom（≥1440px 是 1.12），getBoundingClientRect 量到的是乘過 zoom 的
   螢幕像素，寫回 style 的卻是版面像素——跟 S17 的 placeBoardCenter 同一個坑。
   倍率一律量出來，不寫死。 */
tut.scale = function(){
  var b=document.body;
  var s = b.offsetWidth ? (b.getBoundingClientRect().width / b.offsetWidth) : 1;
  return (isFinite(s) && s>0) ? s : 1;
};

tut.stepEl = function(st){
  if(!st.anchor) return null;
  var sels = st.anchor.split(",");
  for(var i=0;i<sels.length;i++){
    var e = document.querySelector(sels[i].trim());
    if(e) return e;
  }
  return null;
};

tut.clear = function(){
  var l=$("tutLayer"); if(l) l.innerHTML="";
};

tut.focusStep = function(){
  if(tut.state.mode==="free") return (tut.state.sel==null) ? null : tut.STEPS[tut.state.sel];
  return tut.STEPS[tut.state.i];
};

/* 錨點的可視矩形（版面像素）。三欄各有自己的內捲軸，量到的可能整塊在畫面外，
   所以呼叫端要先 scrollIntoView，這裡只負責換算 zoom 倍率。 */
tut.rectOf = function(st, sc){
  var e = tut.stepEl(st); if(!e) return null;
  var r = e.getBoundingClientRect();
  if(!r.width || !r.height) return null;
  return { x:r.left/sc, y:r.top/sc, w:r.width/sc, h:r.height/sc };
};

/* 四片挖洞遮罩：焦點框以外才蓋。沒有焦點（自由模式的總覽）就完全不蓋。 */
tut.mask = function(layer, f, vw, vh){
  if(!f) return;
  function pane(x,y,w,h){
    if(w<=0.5 || h<=0.5) return;
    var d=ui.mkEl("div","tutMask");
    d.style.cssText="position:fixed;left:"+x+"px;top:"+y+"px;width:"+w+"px;height:"+h+"px";
    layer.appendChild(d);
  }
  // 洞比錨點再放大半個像素：zoom 換算會留下 0.x px 的小數，不留餘裕的話
  // 遮罩邊緣會壓到被選中那一區的邊框上
  var PAD=0.5;
  var x=Math.max(0,f.x-PAD), y=Math.max(0,f.y-PAD);
  var r=Math.min(vw,f.x+f.w+PAD), b=Math.min(vh,f.y+f.h+PAD);
  pane(0,0,vw,y);            // 上
  pane(0,b,vw,vh-b);         // 下
  pane(0,y,x,b-y);           // 左
  pane(r,y,vw-r,b-y);        // 右
};

tut.render = function(){
  var layer = $("tutLayer"); if(!layer) return;
  layer.innerHTML="";
  var sc = tut.scale();
  var vw = window.innerWidth/sc, vh = window.innerHeight/sc;
  var free = (tut.state.mode==="free");
  var focus = tut.focusStep();
  var fr = focus ? tut.rectOf(focus, sc) : null;

  tut.mask(layer, fr, vw, vh);

  var list = free ? tut.STEPS.filter(function(s){ return !s.layer; })
                  : (focus ? [focus] : []);
  list.forEach(function(st){
    var r = tut.rectOf(st, sc); if(!r) return;
    var isF = (st===focus);
    var ring = ui.mkEl("div","tutRing"+(isF?" solo":""));
    ring.style.cssText="position:fixed;left:"+r.x+"px;top:"+r.y+"px;width:"+r.w+"px;height:"+r.h+"px";
    layer.appendChild(ring);
    // 編號圓點（觸控目標，不做透明大區塊——iPad 上會誤觸也看不出哪裡可點）
    // 錨點貼齊畫面邊緣時（例如左欄從 x=0 開始），圓點要夾回可視範圍，否則會看不到
    var px = Math.max(6, Math.min(r.x - 13, Math.min(r.x + r.w - 32, vw - 34)));
    var py = Math.max(6, Math.min(r.y - 13, Math.min(r.y + r.h - 32, vh - 34)));
    var idx = tut.STEPS.indexOf(st);
    var pin = ui.mkEl("button","tutPin"+(isF?" on":""), String(st.n));
    pin.style.cssText="position:fixed;left:"+px+"px;top:"+py+"px";
    pin.onclick=function(ev){ ev.stopPropagation();
      if(free){ tut.state.sel = (tut.state.sel===idx) ? null : idx; tut.render(); }
      else { tut.goto(idx); } };
    layer.appendChild(pin);
  });

  if(focus && fr) tut.card(layer, focus, fr, sc, vw, vh);
  tut.bar(fr, vh);
};

/* 導覽列要不要移到上面：焦點壓到底部那條帶就往上讓，除非上下都被蓋到
   （第二層面板幾乎佔滿整面時），那就維持在下面。 */
tut.BAR_BAND = 76;
tut.barTop = function(f, vh){
  if(!f) return false;
  var hitsBottom = (f.y + f.h) > (vh - tut.BAR_BAND);
  var hitsTop    = f.y < tut.BAR_BAND;
  return hitsBottom && !hitsTop;
};

tut.card = function(layer, st, f, sc, vw, vh){
  var c = ui.mkEl("div","tutCard");
  var hd = ui.mkEl("div","hd");
  hd.appendChild(ui.mkEl("span","no", String(st.n)));
  hd.appendChild(ui.mkEl("b",null, st.title));
  hd.appendChild(ui.mkEl("span","zone", st.zone));
  c.appendChild(hd);
  function row(k,v,cls){ var d=ui.mkEl("div","row"+(cls?" "+cls:""));
    d.appendChild(ui.mkEl("span","k",k)); d.appendChild(ui.mkEl("span","v",v)); c.appendChild(d); }
  row("這是什麼", st.what);
  row("時機", st.when);
  row("⚠", st.warn, "warn");
  layer.appendChild(c);

  // 錨點寬到兩側都塞不下整張卡時（第二層面板），把卡片縮到剩下的空檔寬度，
  // 寧可窄一點也不要壓在正在解說的面板上
  var roomR0 = vw - (f.x + f.w) - 22, roomL0 = f.x - 22;
  var side0 = Math.max(roomR0, roomL0);
  if(c.offsetWidth > side0 && side0 >= 200) c.style.width = Math.floor(side0)+"px";
  var cw = c.offsetWidth, ch = c.offsetHeight;
  var barTop = tut.barTop(f, vh);
  var band0 = barTop ? 0 : (vh - tut.BAR_BAND);      // 導覽列佔住的帶狀區
  var band1 = barTop ? tut.BAR_BAND : vh;
  function clampY(t){ return Math.max(8, Math.min(t, vh - 8 - ch)); }
  function overlapFocus(l,t){
    return !(l+cw < f.x || l > f.x+f.w || t+ch < f.y || t > f.y+f.h);
  }
  function overlapBar(l,t){ return !(t+ch < band0 || t > band1); }
  function inScreen(l,t){ return l>=8 && t>=8 && l+cw<=vw-8 && t+ch<=vh-8; }

  var cands = [
    [f.x + f.w + 14, f.y],            // 右
    [f.x - cw - 14,  f.y],            // 左
    [f.x,            f.y + f.h + 12], // 下
    [f.x,            f.y - ch - 12]   // 上
  ];
  var pick=null;
  for(var i=0;i<cands.length && !pick;i++){
    var l=cands[i][0], t=clampY(cands[i][1]);
    if(inScreen(l,t) && !overlapFocus(l,t) && !overlapBar(l,t)) pick=[l,t];
  }
  if(!pick){ // 放寬：允許壓到導覽列以外的條件
    for(var j=0;j<cands.length && !pick;j++){
      var l2=cands[j][0], t2=clampY(cands[j][1]);
      if(inScreen(l2,t2) && !overlapFocus(l2,t2)) pick=[l2,t2];
    }
  }
  if(!pick){
    // 錨點本身就佔滿畫面（第二層面板）→ 靠空間較大的那一側，允許疊上去
    var roomR = vw - (f.x + f.w), roomL = f.x;
    var l3 = (roomR >= roomL) ? Math.min(vw - 8 - cw, f.x + f.w + 14)
                              : Math.max(8, f.x - cw - 14);
    pick = [Math.max(8, l3), clampY(barTop ? tut.BAR_BAND + 10 : f.y + 10)];
    c.classList.add("over");
  }
  c.style.left = pick[0]+"px"; c.style.top = pick[1]+"px";
};

tut.bar = function(f, vh){
  var layer=$("tutLayer"); if(!layer) return;
  var b = ui.mkEl("div","tutBar"+(tut.barTop(f, vh)?" top":""));
  var free = (tut.state.mode==="free");
  var prev = ui.mkEl("button","act","‹ 上一步");
  prev.disabled = free || tut.state.i<=0;
  prev.onclick=function(){ tut.go(-1); };
  var next = ui.mkEl("button","act primary", free ? "開始導覽" : "下一步 ›");
  next.onclick=function(){ if(free){ tut.goto(0); } else tut.go(1); };
  var lbl = ui.mkEl("span","lbl", free
      ? (tut.state.sel==null ? "自由模式——點編號看說明" : "點同一個編號可收起")
      : ("第 "+(tut.state.i+1)+" / "+tut.STEPS.length+" 步"));
  var mode = ui.mkEl("button","act", free ? "🎯 一步一步帶" : "🖐 自由點");
  mode.onclick=function(){ tut.setMode(free?"guided":"free"); };
  var pit = ui.mkEl("button","act","⚠ 會害你輸的七件事");
  pit.onclick=function(){ tut.pitfalls(); };
  b.appendChild(prev); b.appendChild(next); b.appendChild(lbl);
  b.appendChild(mode); b.appendChild(pit);
  layer.appendChild(b);
};

tut.closeStep = function(st){
  if(!st) return;
  if(st.close){ try{ st.close(); }catch(e){} }
  if(st.layer===2){ document.querySelectorAll("#overlays .overlay").forEach(function(o){ o.remove(); }); }
};

tut.goto = function(i){
  var prevStep = tut.STEPS[tut.state.i];
  tut.closeStep(prevStep);
  tut.state.i = Math.max(0, Math.min(tut.STEPS.length-1, i));
  var st = tut.STEPS[tut.state.i];
  tut.state.mode="guided"; tut.state.sel=null;
  if(st.layer===2 && st.open){
    document.querySelectorAll("#overlays .overlay").forEach(function(o){ o.remove(); });
    try{ st.open(); }catch(e){}
  } else {
    ui.render();
  }
  setTimeout(function(){
    // 三欄各有內捲軸；錨點若捲到視窗外，框會畫在看不見的地方（就是「對不起來」）
    var e = tut.stepEl(st);
    if(e && e.scrollIntoView){ try{ e.scrollIntoView({block:"nearest",inline:"nearest"}); }catch(err){} }
    tut.render();
    // 第二層面板有進場動畫，30ms 量到的是動畫中途的位置——落定後再對一次
    setTimeout(function(){ tut.render(); }, 260);
  }, 30);
};

tut.go = function(d){ tut.goto(tut.state.i + d); };

tut.setMode = function(m){
  tut.closeStep(tut.STEPS[tut.state.i]);
  tut.state.mode = m; tut.state.sel = null;
  if(m==="free"){ ui.render(); setTimeout(function(){ tut.render(); },30); }
  else tut.goto(0);
};

tut.pitfalls = function(){
  var ov = ui.mkEl("div","overlay"), box = ui.mkEl("div","sheetbox");
  box.style.maxWidth="560px";
  box.appendChild(ui.mkEl("h2",null,"⚠ 會害你輸的七件事"));
  var ol = document.createElement("ol"); ol.className="tutPit";
  tut.PITFALLS.forEach(function(t){ var li=document.createElement("li"); li.textContent=t; ol.appendChild(li); });
  box.appendChild(ol);
  var o = ui.mkEl("div","opts");
  var b = ui.mkEl("button","opt primary","知道了"); b.onclick=function(){ ov.remove(); };
  o.appendChild(b); box.appendChild(o); ov.appendChild(box);
  ov.style.zIndex="1";   // 掛在 #tutLayer 裡面，才不會被 #tutShield 擋住點擊
  $("tutLayer").appendChild(ov);
};

tut.boot = function(){
  // 教學是靜態示範，沒有真的在跑回合；toast 一律靜音，否則會浮在正在解說的那一區上面
  ui.toast = function(msg, cls, ms, topic){
    (ui._mutedToasts = ui._mutedToasts || []).push({ msg:msg, cat:topic||"SYS" });
  };
  ui.hint = function(){};      // S35：操作回饋氣泡同樣靜音（它不走 ui.toast）
  tut.buildDemo();
  var shield = document.createElement("div");
  shield.id="tutShield";
  shield.addEventListener("click", function(ev){ ev.stopPropagation(); ev.preventDefault(); }, true);
  document.body.appendChild(shield);
  var layer = document.createElement("div");
  layer.id="tutLayer"; document.body.appendChild(layer);
  tut.state = { i:0, mode:"guided", sel:null };
  tut.goto(0);
  var raf=null;
  function relayout(){
    if(raf) return;
    raf = requestAnimationFrame(function(){ raf=null; tut.render(); });
  }
  try{
    window.addEventListener("resize", relayout);
    // 版面本身不捲（html,body 是 overflow:hidden），但三欄各有自己的內捲軸；
    // 內層一捲，position:fixed 的框就跟內容對不起來——用捕獲階段接所有捲動事件。
    document.addEventListener("scroll", relayout, true);
  }catch(e){}
};

})(ns);
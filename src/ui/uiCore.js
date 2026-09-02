(function(ns){
"use strict";
var util=ns.util, ledger=ns.ledger, E=ns.engine;
var ui = ns.ui = { S:null, busy:false, sel:{} };
var $ = function(id){ return document.getElementById(id); };
// 只允許這組「純排版」標籤（可帶 class），其餘一律當純文字。
// 交替分支的首字元互斥（[^<] vs <），不會回溯爆炸。
var SAFE_MARKUP=/^(?:[^<]|<\/?(?:b|i|u|br|em|small|strong|span)(?:\s+class=(?:'[\w\- ]*'|"[\w\- ]*"))?\s*\/?>)*$/;
ui.isSafeMarkup = function(s){
  return typeof s==="string" && s.indexOf("<")>=0 && SAFE_MARKUP.test(s);
};
var el = function(tag, cls, txt){ var e=document.createElement(tag); if(cls)e.className=cls;
  if(txt!==undefined){
    // 曾有四處把 <b>／<br> 直接塞進 el()，因為走 textContent 而讓玩家看到字面標籤。
    // 這裡統一收斂：排版標籤照排版走，其他一律純文字（script/on* 一概不給機會）。
    if(ui.isSafeMarkup(txt)) e.innerHTML=txt; else e.textContent=txt;
  }
  return e; };
// S10：整個檔案只能有這一份 el 實作。
// 過去三個區塊各寫各的，只有這一份會處理 <b>/<br>，另外兩份直接 textContent，
// 於是借款視窗與規則說明就把標籤原樣印出來。掛到 ui 上，另外兩個區塊改為引用。
ui.mkEl = el;
var T = ui.t = function(k, fallback){ var s=ns.content.strings[k];
  return s===undefined ? (fallback!==undefined?fallback:k) : s; };
var term = ui.term = function(key){ var lv=ui.S?ui.S.config.depthLevel:2;
  return T("term."+key+"."+lv, T("term."+key+".2", key)); };
var M = util.money;
// 幸福感（心情價值）：衡量「錢買到的生活品質」，不影響勝負，只呈現
// 幸福感計算已搬進引擎 E.wellbeing（純函式、可重放）；UI 僅代理
ui.wellbeing = function(p){ return E.wellbeing(ui.S, p); };

/* ===================== S18：通知分三類 =====================================
   S16 的規則是「good 靜音、warn 照跳」。實測 30 輪量下來，第 6 輪之後跳出來的
   warn 幾乎全是廣播資訊——景氣轉入 ×5、央行升降息 ×5、政策事件、停走 ×3——
   於是玩家的感受是「前幾輪有彙總，後面又變回一則一則跳」。彙總本身沒有壞
   （27/30 輪都有開），錯的是分類：warn 這個維度分的是「好消息／壞消息」，
   不是「要不要你現在動手」。

   S18 改成用 topic 分：
     SYS    系統類——景氣、利率、政策、天災、停走、發薪：全場都收到，你不必當下做什麼
     MINE   自己動作類——你主動買賣借還進修的結果
     OTHERS 其他玩家引發——轉介、合資、拍賣、P2P、廣播
   靜音規則變成「看 topic 不看 cls」：SYS 一律收進彙總；MINE／OTHERS 裡真的需要
   你當下反應的（被拒、追繳、出價、邀約）才跳 toast。                          */
ui.CAT = { SYS:"SYS", MINE:"MINE", OTHERS:"OTHERS" };
ui.CAT_NAME = { SYS:"🌐 系統與大環境", MINE:"🙋 你自己的動作", OTHERS:"👥 其他玩家引發" };
ui.CAT_ORDER = ["SYS","MINE","OTHERS"];

/* 分錄歸類：分錄本身沒記「誰造成的」，這裡用 eduTags＋摘要關鍵字推斷。
   純呈現用——分錯只是列在別的段落，不影響任何數字。 */
ui.SYS_TAGS = { inflation:1, rate:1, event:1, "event-end":1, payday:1, layoff:1,
                opex:1, recurring:1, freefall:1, family:1 };
ui.SYS_RE  = /景氣|利率|升息|降息|政策|天災|颱風|地震|通膨|物價|停走|發薪|薪資調|失業|系統警報|衝擊|下市|終止上市|寒冬/;
ui.OTHERS_RE = /轉介|合資|拍賣|得標|出價|轉讓|廣播|P2P|借給|借自|放款給|向.{0,6}借/;
ui.entryCat = function(e, meId){
  var tags=e.eduTags||[], i;
  for(i=0;i<tags.length;i++){ if(tags[i]==="referral") return "OTHERS"; }
  var sum=String(e.summary||"");
  if(ui.OTHERS_RE.test(sum)) return "OTHERS";
  // 摘要裡出現「別人的名字」＝多半是別人引發的
  var S=ui.S;
  if(S && S.players){
    for(i=0;i<S.players.length;i++){
      if(i===meId) continue;
      var nm=S.players[i] && S.players[i].name;
      if(nm && nm.length>=1 && sum.indexOf(nm)>=0) return "OTHERS";
    }
  }
  for(i=0;i<tags.length;i++){ if(ui.SYS_TAGS[tags[i]]) return "SYS"; }
  if(ui.SYS_RE.test(sum)) return "SYS";
  return "MINE";
};

ui.toastMuted = function(cls, topic){
  if(!ui.turnSummaryOn || !ui.turnSummaryOn()) return false;
  if(topic==="SYS") return true;            // 廣播資訊：一律收進彙總，不再一則一則跳
  if(cls==="warn") return false;            // 需要你當下處理的（被拒、追繳、出價、邀約）照跳
  return true;
};
ui.toast = function(msg, cls, ms, topic){
  if(ui.toastMuted(cls, topic)){
    (ui._mutedToasts=ui._mutedToasts||[]).push({ msg:msg, cat:topic||"SYS" });
    return;
  }
  var t=el("div","toast"+(cls?" "+cls:""),msg); $("toast").appendChild(t);
  setTimeout(function(){ t.style.opacity=0; setTimeout(function(){ t.remove(); },300); }, ms||2200);
};
// 系統類通知的捷徑：訊息一定進彙總，不會打斷當下操作
ui.toastSys = function(msg, cls, ms){ return ui.toast(msg, cls, ms, "SYS"); };

/* M12：難度預設表（單機／多人共用同一份，決定論要求） */
ns.PRESETS = { NOVICE:{d:1,v:1,a:1,m:[]}, STANDARD:{d:2,v:2,a:2,m:["M1","M2","M4","M6","M8"]},
  ADVANCED:{d:3,v:3,a:2,m:["M1","M2","M3","M4","M6","M8"]}, HARDCORE:{d:3,v:3,a:3,m:["M1","M2","M3","M4","M6","M8"]},
  SANDBOX:{d:2,v:2,a:2,m:["M1","M2","M3","M4","M6","M8"]} };
ns.PRESET_NAMES = { NOVICE:"新手", STANDARD:"標準", ADVANCED:"進階", HARDCORE:"硬核", SANDBOX:"沙盒" };

/* ===================== M12：本機玩家（多人時為自己的座位） ===================== */
ui.myId = function(){ return (ui.mp && ui.mp.mode) ? ui.mp.seat : 0; };
ui.myP  = function(S){ return (S||ui.S).players[ui.myId()]; };
ui.isMyTurn = function(S){ S=S||ui.S; return S.activePlayerIdx===ui.myId(); };

/* ============================== 開局畫面 ================================= */
ui.showSetup = function(){
  var C=ns.content, ov=el("div","overlay"), box=el("div","sheetbox");
  ov.appendChild(box);
  box.appendChild(el("h2",null,T("setup.title")));
  if(ns.BUILD){ var vv=el("div",null,"FinFlow "+ns.BUILD.ver+"（"+ns.BUILD.date+"）");
    vv.style.cssText="color:var(--tx3);font-size:12.5px;margin:-4px 0 4px"; box.appendChild(vv); }
  box.appendChild(el("div","sub",T("setup.sub")));
  var howto=el("button","act","📖 先看如何獲勝"); howto.style.marginBottom="6px";
  howto.onclick=function(){ ui.showRules(false); };
  box.appendChild(howto);
  if(ui.mpMenu){ var mpBtn=el("button","act","🌐 多人連線（各自用自己的裝置）"); mpBtn.style.marginBottom="6px"; mpBtn.style.marginLeft="8px";
    mpBtn.onclick=function(){ ov.remove(); ui.mpMenu(); };
    box.appendChild(mpBtn); }
  var cfg = { npcs:2, preset:"STANDARD", modules:["M1","M2","M4","M6","M8"],
    professionId:"PRO_ENGINEER", dreamCardId:C.dreams[0].id, seed:(Math.random()*1e9)|0 };
  var PRESETS = ns.PRESETS;

  var body=el("div"); box.appendChild(body);
  function rerender(){ body.innerHTML=""; renderBody(); }
  function hd(txt){ var s=el("h4",null,txt); s.style.cssText="margin:14px 0 6px;color:var(--tx3);font-size:11.5px;letter-spacing:.16em"; return s; }
  function renderBody(){
    body.appendChild(hd(T("setup.players")));
    var w1=el("div","tabs"); [0,1,2,3].forEach(function(n){ var b=el("button","tab"+(cfg.npcs===n?" on":""),n+" 位");
      b.onclick=function(){ cfg.npcs=n; rerender(); }; w1.appendChild(b); }); body.appendChild(w1);

    body.appendChild(hd(T("setup.preset")));
    var w2=el("div","grid"); w2.style.gridTemplateColumns="repeat(auto-fit,minmax(160px,1fr))";
    Object.keys(PRESETS).forEach(function(k){
      var b=el("button","pick"+(cfg.preset===k?" on":""));
      b.appendChild(el("div","t",T("preset."+k))); b.appendChild(el("div","d",T("preset."+k+".d")));
      b.onclick=function(){ cfg.preset=k; cfg.modules=PRESETS[k].m.slice(); rerender(); }; w2.appendChild(b);
    }); body.appendChild(w2);

    body.appendChild(hd(T("setup.modules")));
    var w3=el("div","grid"); w3.style.gridTemplateColumns="repeat(auto-fit,minmax(180px,1fr))";
    ["M1","M2","M3","M4","M6","M8"].forEach(function(m){
      var on=cfg.modules.indexOf(m)>=0, b=el("button","pick"+(on?" on":""));
      b.appendChild(el("div","t",T("mod."+m))); b.appendChild(el("div","d",T("mod."+m+".d")));
      b.onclick=function(){ var i=cfg.modules.indexOf(m); if(i>=0) cfg.modules.splice(i,1); else cfg.modules.push(m);
        cfg.preset="SANDBOX"; rerender(); }; w3.appendChild(b);
    }); body.appendChild(w3);

    body.appendChild(hd(T("setup.profession")));
    var rndRow=el("div"); rndRow.style.cssText="margin:0 0 8px";
    var rndBtn=el("button","act","🎲 隨機職業（多人對戰更公平）");
    rndBtn.onclick=function(){ var pool=C.professions.filter(function(p){ return !p.moduleReq||cfg.modules.indexOf(p.moduleReq)>=0; });
      cfg.professionId=pool[(Math.random()*pool.length)|0].id;
      var dpool=C.dreams; cfg.dreamCardId=dpool[(Math.random()*dpool.length)|0].id; rerender(); };
    rndRow.appendChild(rndBtn); body.appendChild(rndRow);
    var groups={}; C.professions.forEach(function(p){ (groups[p.group]=groups[p.group]||[]).push(p); });
    var w4=el("div","grid"); w4.style.gridTemplateColumns="repeat(auto-fit,minmax(215px,1fr))";
    Object.keys(groups).forEach(function(g){ groups[g].forEach(function(p){
      if(p.moduleReq && cfg.modules.indexOf(p.moduleReq)<0) return;
      var b=el("button","pick"+(cfg.professionId===p.id?" on":""));
      var surplus=p.salary-p.baseExpenses, nw=p.startingCash-(p.startingLiabilities||[]).reduce(function(a,l){return a+l.principal;},0);
      b.appendChild(el("div","t",g+"｜"+p.name));
      var d=el("div","d"); d.innerHTML="月薪 <b class='num'>"+M(p.salary)+"</b>　支出 <b class='num'>"+M(p.baseExpenses)+
        "</b>　月盈餘 <b class='num "+(surplus>0?"pos":"neg")+"'>"+M(surplus)+"</b><br>起始淨值 <b class='num "+(nw<0?"neg":"")+"'>"+M(nw)+
        "</b>"+(p.salaryVolatility?"　〰 波動 ±"+Math.round(p.salaryVolatility*100)+"%":"")+"<br>"+(p.note||"");
      b.appendChild(d);
      b.onclick=function(){ cfg.professionId=p.id; rerender(); }; w4.appendChild(b); }); });
    body.appendChild(w4);

    body.appendChild(hd(T("setup.dream")));
    var w5=el("div","grid"); w5.style.gridTemplateColumns="repeat(auto-fit,minmax(200px,1fr))";
    C.dreams.forEach(function(d){ var b=el("button","pick"+(cfg.dreamCardId===d.id?" on":""));
      b.appendChild(el("div","t",d.name)); b.appendChild(el("div","d",d.flavor));
      b.onclick=function(){ cfg.dreamCardId=d.id; rerender(); }; w5.appendChild(b); });
    body.appendChild(w5);

    var foot=el("div","setupFoot");   // 常駐底部，避免內容太長時捲不到開局鈕
    var sd=el("input"); sd.type="number"; sd.value=cfg.seed; sd.style.cssText="background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:9px 11px;width:150px;font-family:var(--mono)";
    sd.oninput=function(){ cfg.seed=parseInt(sd.value||"0",10)||0; };
    var lbl=el("span",null,T("setup.seed")); lbl.style.color="var(--tx2)"; lbl.style.fontSize="13px";
    var go=el("button","bigbtn",T("setup.start"));
    go.id="btnStartGame";
    go.onclick=function(){ ov.remove(); ui.start(cfg,PRESETS[cfg.preset]); };
    foot.appendChild(lbl); foot.appendChild(sd); var sp=el("div"); sp.style.flex="1"; foot.appendChild(sp); foot.appendChild(go);
    body.appendChild(foot);
  }
  rerender();
  $("overlays").appendChild(ov);
};

// M12：難度預設 → config（單機與多人共用，決定論要求兩邊算法一字不差）
ui.buildGameConfig = function(preset){
  var config = ns.buildConfig(ns.configRegistry);
  Object.keys(ui.configOverrides||{}).forEach(function(k){ config[k]=ui.configOverrides[k]; });
  config.depthLevel=preset.d; config.volatilityLevel=preset.v; config.automationLevel=preset.a;
  config.oppDualChoice = preset.d>=2 ? 1 : 0;   // §2.3：僅標準難度以上開啟機會二選一
  config.lifeDualChoice = preset.d>=2 ? 1 : 0;  // 人生二選一與機會二選一同進退
  config.stockVolatilityMult = preset.v===1?0:(preset.v===3?2:1);
  config.macroTransitionProb = preset.v===1?0:(preset.v===3?1.8:1);
  config.eventCardRate = preset.v===1?0.5:(preset.v===3?1.5:1);
  return config;
};
// M12：共用開局核心（players 由呼叫端決定：單機＝你+NPC；多人＝大廳座位表）
ui.startCore = function(seed, config, modules, players, opts){
  opts=opts||{};
  // 八期：開新局務必清空上一局的殘留（否則系統訊息會混入上一局的輪次）
  ui.feed=[]; ui.lastAct={}; ui.viewPlayerId=null; ui._lastRoll={};
  if(ui._autoRollT){ clearInterval(ui._autoRollT); ui._autoRollT=null; }
  ui.S = E.newGame({ seed:seed, config:config, modules:modules, players:players });
  E.beginTurn(ui.S);
  $("app").classList.remove("hide");
  ui.render(); ui.tick();
  if(!opts.noRules) ui.showRules(true);
};
ui.start = function(cfg, preset){
  var config = ui.buildGameConfig(preset);
  var players=[{ name:"你", isNPC:false, professionId:cfg.professionId, dreamCardId:cfg.dreamCardId }];
  var pers=ns.content.personalities, dreams=ns.content.dreams;
  var pool=ns.content.professions.filter(function(p){ return (!p.moduleReq||cfg.modules.indexOf(p.moduleReq)>=0) && p.id!==cfg.professionId; });
  for(var i=0;i<cfg.npcs;i++){
    var per=pers[i%pers.length];
    players.push({ name:per.name+(i>=pers.length?"②":""), isNPC:true, personality:per.id,
      professionId: pool[(i*5+3)%pool.length].id, dreamCardId: dreams[(i+1)%dreams.length].id });
  }
  ui.startCore(cfg.seed, config, cfg.modules, players);
};

/* ================================ 渲染 ================================== */
ui.render = function(){
  var S=ui.S; if(!S) return;
  ui.renderTop(); ui.renderBoard(); ui.renderFinBoard(); ui.renderSheet();
  ui.renderCenter(); ui.renderPlayerCards();
  if(ui.placeBoardCenter) ui.placeBoardCenter();   // S17：整輪版面都畫完後才對位中央那疊
  if(ui.checkTurnSummary) ui.checkTurnSummary();   // S16：我的回合剛結束 → 彈出結算彙總
};

var STAGE_NAME={RECOVERY:"復甦",BOOM:"過熱",RECESSION:"衰退",DEPRESSION:"蕭條"};
ui.renderTop = function(){
  // 七期：頂列僅剩圖示鈕（輪次與事件改由中欄「系統訊息」承載）；保留 hook 供舊元素相容
  var S=ui.S;
  // 未預期發現（S14b）：#turnBadge 這顆元素在 S14a 版面重整時就已從 DOM 移除，
  // 這段自那時起是死碼（靠 if(tb) 靜默跳過）。輪次現在顯示在右欄「系統訊息」的 tnl，
  // 倒數提示改掛在那裡（見 ui.renderSheet）。這行留著只是防止舊版面殘存時報錯。
  var tb=$("turnBadge"); if(tb) tb.textContent="第 "+S.turnNumber+" / "+S.config.maxTurns+" 輪";
};

var CELL_COLOR={PAYDAY:"var(--pay)",OPPORTUNITY:"var(--opp)",LIFESTYLE:"var(--life)",
  MARKET:"var(--mkt)",LIFE_EVENT:"var(--evt)",LAYOFF:"var(--lay)",
  OPAYDAY:"var(--pay)",SITE:"var(--mkt)",OEVENT:"var(--evt)"};
var CELL_LABEL={PAYDAY:"發薪",OPPORTUNITY:"機會",LIFESTYLE:"生活",MARKET:"市場",
  LIFE_EVENT:"人生",LAYOFF:"失業",OPAYDAY:"現金流",OEVENT:"風雲",
  TASTE:"饗食",SUMMIT:"山海",VOYAGE:"旅行",LEGACY:"傳承"};

ui.ringPos = function(i,n,rx,ry){ var a=-Math.PI/2 + i*2*Math.PI/n;
  return { x:380+rx*Math.cos(a), y:350+ry*Math.sin(a) }; };
// 矩形環佈局：沿矩形四邊平均分佈（左上角起、順時針）—— 比橢圓省空間、不切邊
ui.rectPos = function(i,n,hw,hh,cx,cy){
  var W=2*hw, H=2*hh, P=2*(W+H), d=(i/n)*P, x, y;
  if(d < W){ x=cx-hw+d; y=cy-hh; }
  else if(d < W+H){ x=cx+hw; y=cy-hh+(d-W); }
  else if(d < 2*W+H){ x=cx+hw-(d-W-H); y=cy+hh; }
  else { x=cx-hw; y=cy+hh-(d-2*W-H); }
  return { x:x, y:y };
};

ui.renderBoard = function(){
  var S=ui.S, svg=$("boardSvg"), C=ns.content;
  /* S14a-2：改成「格子網格環」——n 格排成 cols×rows 的矩形框，每格等大、間距一致。
     舊的 rectPos 是沿矩形周長平均分佈，格子會落在不整齊的位置、四角看起來也擠。
     這裡只改視覺排法，格子索引、內容、棋子邏輯完全沒動。 */
  var VW=520, VH=405;
  var IN ={x:10, y:8,   w:500, h:274, gap:6};    // 內圈（底層牛馬區）
  var OUT={x:22, y:308, w:476, h:86,  gap:6};    // 夢想圈
  var BL=E.board(S,false), BLO=E.board(S,true);      // S14b：本局實際盤面（可能已換掉發薪格）
  var ig=ui.ringGeom(BL.length, IN, 1.9);
  var og=ui.ringGeom(BLO?BLO.length:0, OUT, null, true);
  var out="";

  out+='<defs><linearGradient id="dreamBg" x1="0" y1="0" x2="0" y2="1">'+
       '<stop offset="0" stop-color="#2A1F45" stop-opacity="0.55"/>'+
       '<stop offset="1" stop-color="#123047" stop-opacity="0.55"/></linearGradient></defs>';
  out+='<line x1="30" y1="292" x2="490" y2="292" stroke="#2E4462" stroke-width="1" stroke-dasharray="6 6"/>';
  out+='<rect x="12" y="288" width="496" height="112" rx="16" fill="url(#dreamBg)" '+
       'stroke="#5A4A86" stroke-opacity="0.7" stroke-width="1.5"/>';

  function cellRect(g, i, extraCls, fill, stroke, sw, label, labCol){
    var p=g.at(i);
    return '<g class="sp-cell'+(extraCls||"")+'">'+
      '<rect x="'+p.x.toFixed(1)+'" y="'+p.y.toFixed(1)+'" width="'+g.cw.toFixed(1)+'" height="'+g.ch.toFixed(1)+'" rx="9" '+
      'fill="'+fill+'" stroke="'+stroke+'" stroke-width="'+sw+'"/>'+
      '<text class="sp-label" x="'+p.cx.toFixed(1)+'" y="'+(p.cy+5).toFixed(1)+'" text-anchor="middle" fill="'+labCol+'">'+label+'</text></g>';
  }

  /* 內圈 */
  BL.forEach(function(sp,i){
    var c=CELL_COLOR[sp.type];
    var here=S.players.some(function(pl){ return !pl.bankrupt && pl.playerStage==="INNER" && pl.position===i; });
    out+=cellRect(ig, i, here?" here":"", c, c, here?2.2:1.1, CELL_LABEL[sp.type], c)
         .replace('fill="'+c+'"','fill="'+c+'" fill-opacity="'+(sp.type==="PAYDAY"?0.30:0.16)+'"')
         .replace('stroke="'+c+'"','stroke="'+c+'" stroke-opacity="'+(here?0.95:0.6)+'"');
  });

  /* 夢想圈 */
  if(BLO){
    var anyOuter=S.players.some(function(pl){return pl.playerStage==="OUTER";});
    var OUTER_COLOR={TASTE:"#FF7A9E",SUMMIT:"#4CC9F0",VOYAGE:"#B07CF7",LEGACY:"#F9C74F",
                     OPAYDAY:"#3DDC97",OEVENT:"#FF9E4F"};
    out+='<text x="'+(VW/2)+'" y="303" text-anchor="middle" fill="#C9B6FF" font-size="12.5" letter-spacing="6" font-weight="700">夢 想 圈</text>';
    BLO.forEach(function(sp,i){
      var hereO=S.players.some(function(pl){ return !pl.bankrupt && pl.playerStage==="OUTER" && pl.outerPos===i; });
      var lab = sp.type==="SITE"?CELL_LABEL[sp.category]:CELL_LABEL[sp.type];
      var c = sp.type==="SITE" ? (OUTER_COLOR[sp.category]||"#F9C74F") : (OUTER_COLOR[sp.type]||"#F9C74F");
      var p=og.at(i);
      out+='<g class="sp-cell'+(hereO?" here":"")+'" opacity="'+(anyOuter?1:0.62)+'">'+
        '<rect x="'+p.x.toFixed(1)+'" y="'+p.y.toFixed(1)+'" width="'+og.cw.toFixed(1)+'" height="'+og.ch.toFixed(1)+'" rx="9" '+
        'fill="'+c+'" fill-opacity="'+(hereO?0.45:0.26)+'" stroke="'+c+'" stroke-opacity="0.95" stroke-width="'+(hereO?2.4:1.4)+'"/>'+
        '<text class="sp-label" x="'+p.cx.toFixed(1)+'" y="'+(p.cy+5).toFixed(1)+'" text-anchor="middle" fill="'+c+'">'+lab+'</text></g>';
    });
  }

  /* 棋子：同一格的人左右錯開 */
  var slot={}, slotN={};
  S.players.forEach(function(pl){
    if(pl.bankrupt) return;
    var k=(pl.playerStage==="OUTER"?"O":"I")+(pl.playerStage==="OUTER"?pl.outerPos:pl.position);
    slot[pl.id]=(slotN[k]||0); slotN[k]=(slotN[k]||0)+1;
  });
  S.players.forEach(function(pl,idx){
    if(pl.bankrupt) return;
    var outerP=pl.playerStage==="OUTER";
    var g=outerP?og:ig, cellIdx=outerP?pl.outerPos:pl.position;
    if(!g || !g.n) return;
    var bp=g.at(cellIdx);
    var key=(outerP?"O":"I")+cellIdx, cnt=slotN[key]||1;
    // 棋子坐在格子上緣（夢想圈坐下緣），依同格人數縮小；格名在正中央，不會被蓋掉
    var rad = cnt>=4 ? 7.5 : (cnt>=3 ? 8.5 : 10);
    var spread=Math.min(18, g.cw/(cnt+0.35));
    var off=(slot[pl.id]-(cnt-1)/2)*spread;
    var px=bp.cx+off, py=outerP ? (bp.y+g.ch-rad-1) : (bp.y+rad+1);
    var col=ui.playerColor(pl);
    out+='<circle class="pawn" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="'+rad+'" fill="#131D2B" stroke="'+col+'" stroke-width="2.2"/>'+
         '<text class="pawn" x="'+px.toFixed(1)+'" y="'+(py+rad*0.42).toFixed(1)+'" text-anchor="middle" font-size="'+(rad*1.18).toFixed(0)+'">'+ui.avatar(pl)+'</text>';
    // S14a-2：進了夢想圈的人要讓全桌一眼看到——棋子加金色光環＋🕊 標記
    if(outerP){
      out+='<circle cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="'+(rad+4).toFixed(1)+'" fill="none" stroke="#F2C14E" stroke-width="1.6" opacity="0.9"/>'+
           '<text x="'+(px+rad+1).toFixed(1)+'" y="'+(py-rad+1).toFixed(1)+'" font-size="10">🕊</text>';
    }
    if(idx===S.activePlayerIdx)
      out+='<circle class="pawn-ring" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="'+(rad+5).toFixed(1)+'" stroke="'+col+'" opacity="0.8"/>';
  });

  /* 中央：區名 ＋ 一句話。
     S17：盤面縮進中欄後，內圈的洞變矮，原本壓在洞上緣的兩行字會被
     擲骰鈕蓋住。改成把字釘在洞的「下緣」，再把上半留給 #boardCenter，
     並輸出一個看不見的 #boardHole 當定位錨（見 ui.placeBoardCenter）。 */
  var holeX = IN.x + ig.cw + ig.gap;
  var holeT = IN.y + ig.ch + ig.gap;
  var holeW = IN.w - 2*(ig.cw + ig.gap);
  var holeH = IN.h - 2*(ig.ch + ig.gap);
  var textB = holeT + holeH;                 // 洞的下緣
  out+='<rect id="boardHole" x="'+holeX.toFixed(1)+'" y="'+holeT.toFixed(1)+'" width="'+holeW.toFixed(1)+
       '" height="'+Math.max(0,holeH-BC_TEXT_H).toFixed(1)+'" fill="none" stroke="none" pointer-events="none"/>';
  out+='<text x="'+(VW/2)+'" y="'+(textB-19).toFixed(1)+'" text-anchor="middle" fill="#5C7291" font-size="13.5" letter-spacing="5" font-weight="700">底層牛馬區</text>';
  out+='<text x="'+(VW/2)+'" y="'+(textB-3).toFixed(1)+'" text-anchor="middle" fill="#46586F" font-size="11">被動收入蓋過支出才走得出去</text>';
  svg.setAttribute("viewBox","0 0 "+VW+" "+VH);
  svg.innerHTML=out;
  ui.placeBoardCenter();
};

/* S17：#boardCenter 疊在 SVG 上，但 SVG 是 preserveAspectRatio 置中縮放的，
   用百分比定位會隨解析度飄掉、壓到格子或中央文字。改成量 #boardHole 的
   實際螢幕矩形，把中央那疊釘進洞裡。純視覺，不碰引擎。 */
var BC_TEXT_H = 40;   // 洞下緣保留給「底層牛馬區」兩行字的高度（viewBox 單位）
ui.placeBoardCenter = function(){
  var bc=$("boardCenter"), hole=$("boardHole"), wrap=$("boardWrap");
  if(!bc || !hole || !wrap) return;
  var h=hole.getBoundingClientRect(), w=wrap.getBoundingClientRect();
  if(!h.width || !h.height) return;
  /* 未預期發現（S17）：body 有 zoom（≥1440px 是 1.12），getBoundingClientRect 量到的是
     「乘過 zoom」的螢幕像素，但寫回 style 的 left/top/width 是「還沒乘 zoom」的版面像素。
     直接搬會整個放大 12%、位置也偏掉。這裡用 wrap 的 rect ÷ offsetWidth 把倍率量出來除回去，
     不要寫死 1.12——縮放級距有四段（0.9/1/1.12/1.28/1.5）。 */
  var sc = wrap.offsetWidth ? (w.width / wrap.offsetWidth) : 1;
  if(!isFinite(sc) || sc<=0) sc=1;
  bc.style.left   = ((h.left - w.left)/sc).toFixed(1)+"px";
  bc.style.top    = ((h.top  - w.top )/sc).toFixed(1)+"px";
  bc.style.width  = (h.width /sc).toFixed(1)+"px";
  bc.style.height = (h.height/sc).toFixed(1)+"px";
  bc.style.transform = "none";
  bc.style.maxWidth  = "none";
};
/* 視窗大小變了，SVG 的縮放比例跟著變，中央那疊要重新對位 */
try{ window.addEventListener("resize", function(){ try{ ui.placeBoardCenter(); }catch(e){} }); }catch(e){}

/* S14a-2：把 n 格排成一個 cols×rows 的矩形框（沿邊順時針，左上角起）。
   必須滿足 n === 2*cols + 2*rows − 4；rows=2 時就是上下兩排。 */
ui.ringGeom = function(n, box, targetAspect, forceTwoRows){
  if(!n) return { n:0, at:function(){ return {x:0,y:0,cx:0,cy:0}; } };
  var best=null;
  if(forceTwoRows && n%2===0 && n/2>=3) best={cols:n/2, rows:2};
  if(!best){
    for(var rows=2; rows<=9; rows++){
      var cols=(n+4)/2-rows;
      if(cols<2 || cols!==Math.round(cols)) continue;
      if(2*cols+2*rows-4!==n) continue;
      var score=Math.abs(cols/rows-(targetAspect||1.9));
      if(!best || score<best.score) best={cols:cols, rows:rows, score:score};
    }
  }
  if(!best) best={cols:Math.ceil(n/2), rows:2};
  var cols=best.cols, rows=best.rows, gap=box.gap;
  var cw=(box.w-(cols-1)*gap)/cols, ch=(box.h-(rows-1)*gap)/rows;
  return {
    n:n, cols:cols, rows:rows, cw:cw, ch:ch, gap:gap, x:box.x, y:box.y,
    at:function(i){
      var k=((i%n)+n)%n, top=cols, right=Math.max(0,rows-2), bottom=cols, c, r;
      if(k<top){ r=0; c=k; }
      else if(k<top+right){ r=1+(k-top); c=cols-1; }
      else if(k<top+right+bottom){ r=rows-1; c=cols-1-(k-top-right); }
      else { c=0; r=rows-2-(k-top-right-bottom); }
      var x=box.x+c*(cw+gap), y=box.y+r*(ch+gap);
      return { x:x, y:y, cx:x+cw/2, cy:y+ch/2, col:c, row:r };
    }
  };
};

/* 六期：職業頭像（emoji）——盤面棋子與玩家動作列共用 */
var PROF_EMOJI={PRO_CLERK:"🏪",PRO_FARMER:"🧑‍🌾",PRO_TECHOP:"🔧",PRO_DELIVERY:"🛵",PRO_MKT:"📣",
  PRO_AUDITOR:"🧮",PRO_NURSE:"💉",PRO_CIVIL:"🏛️",PRO_BANKER:"🏦",PRO_PLUMBER:"🪛",
  PRO_DATA:"📊",PRO_ECOM:"📦",PRO_ENGINEER:"💻",PRO_FOOD:"🍜",PRO_SALES:"🤝",
  PRO_PM:"📋",PRO_SEMI:"🔬",PRO_CONSULT:"💼",PRO_FOUNDER:"🚀",PRO_DOCTOR:"🩺"};
ui.avatar = function(p){ return PROF_EMOJI[p.retiredProfessionId||p.professionId]||"🙂"; };
// 八期：格子名稱（供系統訊息「擲 N 點 → 人生」使用）
ui.cellLabel = function(outer, idx){
  var C=ns.content, board = outer ? C.boardLayoutOuter : C.boardLayout;
  var sp = board && board[idx]; if(!sp) return "";
  return (sp.type==="SITE" ? CELL_LABEL[sp.category] : CELL_LABEL[sp.type]) || sp.type;
};
ui.playerColor = function(p){ return p.isNPC?ns.content.personalityById[p.npcPersonality].color:"#F2C14E"; };

/* M7 信用評級顯示 helper（p8 亦透過 ui.* 使用） */
ui.creditSpreadPct = function(S,p){ return util.pct(E.creditSpread(S,p),1); };
ui.creditDesc = function(S,p){
  var r=p.creditRating||"B", sp=E.creditSpread(S,p), dbr=E.cfg(S,"dbr_"+r);
  if(dbr===undefined) dbr=E.cfg(S,"dbrMultiple");
  return { rating:r, spread:sp, dbr:dbr,
    label:{A:"優良",B:"普通",C:"不良"}[r]||"普通",
    rateTxt:(sp>0?"＋":(sp<0?"−":"±"))+util.pct(Math.abs(sp),1) };
};
ui.creditBadge = function(S,p,withRate){
  var d=ui.creditDesc(S,p);
  var b=el("span","crb "+d.rating, "信用 "+d.rating+(withRate?("　利率 "+d.rateTxt):""));
  b.title="信用評級 "+d.rating+"（"+d.label+"）：新貸款利率 "+d.rateTxt+"、額度上限 "+d.dbr+"× 月收入";
  return b;
};

/* 方案丙：玩家動作列——每人一欄（狀態／動作），點欄切換右側狀態區 */
ui.renderPlayerCards = function(){
  var S=ui.S, w=$("pawns"); w.innerHTML="";
  // S14a：標題列（人數）——玩家區現在是一整塊，需要一個抬頭
  var hd=$("pawnsHd");
  if(hd){
    hd.innerHTML="";
    hd.appendChild(el("b",null,"玩　家"));
    var alive=S.players.filter(function(x){return !x.bankrupt;}).length;
    hd.appendChild(el("span","sub", S.players.length+" 人（在局 "+alive+"）・點卡片看完整財報"));
  }
  S.players.forEach(function(p,i){
    var c=el("button","pcol"+(i===S.activePlayerIdx?" active":"")+(p.bankrupt?" out":"")
              +(p.id===ui.myId()?" mine":"")+(p.playerStage==="OUTER"?" outer":""));
    var nm=el("div","nm");
    var av=el("span",null,ui.avatar(p));
    av.style.cssText="font-size:15px;flex:none;line-height:1;border-bottom:2px solid "+ui.playerColor(p)+";padding-bottom:1px";
    nm.appendChild(av);
    nm.appendChild(el("span",null,p.name));
    // S14a-2：進了夢想圈是全桌都該知道的事——用一個亮眼的徽章，不只是名字後面一隻鳥
    if(p.playerStage==="OUTER"){
      var fb=el("span",null,"🕊 自由圈");
      fb.style.cssText="font-size:10px;padding:0 5px;border-radius:4px;flex:none;"+
        "color:#1A1206;background:linear-gradient(180deg,var(--gold),#D9A72F);font-weight:800";
      fb.title="已達成財務自由並辭職，正在夢想圈追夢";
      nm.appendChild(fb);
    }
    nm.appendChild(ui.creditBadge(S,p,false));
    if(ui.viewPlayerId===p.id) nm.appendChild(el("span",null,"👁"));
    /* S18：狀態併進名字那一列。實測量過——玩家卡一張 173px、兩排吃掉左欄 361px，
       系統訊息只剩 509px 卻要放 527px 的內容，所以永遠在捲。改欄數沒用（2 欄與 3 欄
       在 4 人局都是 2 排、高度一模一樣），真正要做的是把卡片壓矮：
       6 行 → 3 行（狀態上收、被動收入與資產筆數併列、每輪紀錄併進幸福感那一列）。 */
    var stTxt = p.bankrupt ? "破產出局"
      : (p.skippedTurns>0 ? "停走 "+p.skippedTurns+" 輪"
      : (i===S.activePlayerIdx ? (p.isNPC?"思考中…":(p.id===ui.myId()?"你的回合":"行動中")) : "等待"));
    var stEl=el("span","st",stTxt); nm.appendChild(stEl);
    c.appendChild(nm);
    // S14a（決定 C）：拿掉「近況」——系統訊息與每輪紀錄都看得到，卡上留給看得懂財務體質的數字。
    var d=p.derived||{}, kvw=el("div","pkv");
    function kv(k,v,cls){ kvw.appendChild(el("div","k",k)); kvw.appendChild(el("div","v"+(cls?" "+cls:""),v)); }
    kv("現金", M(p.cash), p.cash<0?"neg":(p.id===ui.myId()?"gold":""));
    var ncf=d.netCashflow||0;
    kv("淨現金流", (ncf>=0?"+":"")+M(ncf), ncf>=0?"pos":"neg");
    // 被動收入與資產筆數併成一行：兩個都是「資產這邊的體質」，分兩行只是佔高度
    var nAsset=(p.assets?p.assets.length:0);
    kvw.appendChild(el("div","k","被動收入"));
    var pv=el("div","v"+((d.passiveIncome||0)>0?" pos":""));
    pv.innerHTML=M(d.passiveIncome||0)+" <span class='sub2'>／"+nAsset+" 筆</span>";
    kvw.appendChild(pv);
    c.appendChild(kvw);
    // 幸福感、夢想、每輪紀錄併一列
    var du=el("div","pdual");
    var wb=el("span","pink"); wb.innerHTML="♥ <b>"+ui.wellbeing(p)+"／"+(E.cfg(S,"winWellbeingMin")||10)+"</b>";
    var dr=el("span");
    dr.innerHTML=(p.playerStage==="OUTER"?"<span style='color:var(--gold)'>🕊 圓夢 </span>":"夢想 ")+
      "<b"+(p.playerStage==="OUTER"?" style='color:var(--gold)'":"")+">"+(p.dreamProgress||0)+"／"+S.config.dreamCost+"</b>";
    du.appendChild(wb); du.appendChild(dr);
    // 每輪紀錄：用 span 而非 button（按鈕不能巢狀），並攔下事件不讓它觸發卡片本身的切換。
    var logRow=el("span","lgrow","📜 紀錄 ›");
    logRow.title="看這位玩家每一輪遇到什麼、影響多少";
    (function(pid){ logRow.onclick=function(ev){
      if(ev){ ev.stopPropagation(); if(ev.preventDefault) ev.preventDefault(); }
      ui.showRoundLog(pid); }; })(p.id);
    du.appendChild(logRow);
    c.appendChild(du);
    (function(pid){ c.onclick=function(){
      ui.viewPlayerId=(ui.viewPlayerId===pid?null:pid); ui.renderSheet(); ui.renderPlayerCards(); }; })(p.id);
    w.appendChild(c);
  });
  // 八期：功能未開啟或此刻不可用 → 直接灰化並在 title 說明原因，不再點下去才吐 toast
  var myTurn = S.activePlayerIdx===ui.myId() && (S.phase==="ROLL"||S.phase==="READY_END") && !S.over;
  var me0=S.players[ui.myId()];
  function gate(id, ok, why){ var b=$(id); if(!b) return; b.disabled=!ok; b.title = ok ? "" : why; }
  gate("btnEnd", !S.over, "遊戲已結束");
  var bRep=$("btnReport"); if(bRep) bRep.style.display = S.over ? "" : "none";   // V4：復盤只在終局後出現，避免誤會成「毀棋」
  // S14a：借款鈕移到右欄個人資訊區、股市交易改成點中欄股市列開單檔面板，這裡不再有這兩顆。
  gate("btnExchange", myTurn && S.players.filter(function(x){return x.id!==ui.myId() && !x.bankrupt;}).length>0 && !me0.bankrupt,
    "現在不是你的操作時機（交易與借貸只能在自己回合進行）");
  var mallPer=E.cfg(S,"mallPerTurn"); if(mallPer===undefined) mallPer=1;
  var mallLeft=mallPer-(me0.mallBoughtThisTurn||0);
  // S14a：商城改成隨時可以打開研究（實測時大家很需要在別人回合先看清楚有什麼可買）。
  // 能不能真的買，由面板內的每一張商品自己把關；引擎的 MALL_BUY 守門完全沒動。
  gate("btnMall", mallPer>0, "本局未開啟人生商城");
  var bm=$("btnMall");
  if(bm && mallPer>0 && !(myTurn && mallLeft>0 && !me0.bankrupt))
    bm.title = me0.bankrupt ? "破產程序中" : (mallLeft<=0 ? "本回合的商城額度已用完（仍可先看）" : "現在不是你的操作時機（仍可先看）");
};
ui.renderBottom = function(){ ui.renderPlayerCards(); };

/* 方案丙中欄：總經訊息／股市資訊／系統訊息（事件log）／交易所 */
var LAMP={BOOM:["#E5484D","紅燈・過熱"],RECOVERY:["#35C4A8","綠燈・復甦"],
          RECESSION:["#F2C14E","黃藍燈・衰退"],DEPRESSION:["#4C8DFF","藍燈・低迷"]};
ui.renderFinBoard = function(){
  // S17：#infoDyn 已拆成 #infoL（左欄）／#infoM（中欄）／#warnBox（中欄頂）。
  // b 保留當作後備容器：舊版面殘存時仍能運作，新版面下它是 null。
  var S=ui.S, b=$("infoDyn");
  if(!$("infoL") && !b) return;
  if(b) b.innerHTML="";
  /* S17：三欄重整——總經與系統訊息搬到左欄（#infoL），股市與交易所留在中欄（#infoM），
     重大事件警告獨立到中欄最上面（#warnBox），操作區釘在中欄最下面。
     渲染邏輯不動，只改「這一段畫到哪個容器」。 */
  var bL=$("infoL"), bM=$("infoM"), bW=$("warnBox");
  if(bL) bL.innerHTML=""; if(bM) bM.innerHTML=""; if(bW) bW.innerHTML="";
  var me=S.players[ui.myId()], m=S.macro;
  /* S20：多帶一個 tut 標記，讓互動教學可以穩定錨定到這一塊（不影響版面） */
  function secIn(host,title,tut){ var d=el("div","fbSec"); d.appendChild(el("h4",null,title));
    if(tut) d.setAttribute("data-tut",tut);
    var h=host||bM||bL||b; if(h) h.appendChild(d); return d; }
  function sec(title,tut){ return secIn(bM||b, title, tut); }
  function kv(host,k,v,cls){ var g=host.__g;
    if(!g){ g=el("div","fbGrid"); host.appendChild(g); host.__g=g; }
    g.appendChild(el("div","k",k)); g.appendChild(el("div","v num"+(cls?" "+cls:""),v)); }

  // 總經訊息
  var s1=secIn(bL,"總經訊息","macro");
  kv(s1,"基準利率", util.pct(m.baseRate,2));
  kv(s1,"目標利率", util.pct(m.targetRate,2), m.targetRate>m.baseRate?"neg":(m.targetRate<m.baseRate?"pos":""));
  kv(s1,"通膨率", util.pct(m.inflation,2), m.inflation>0?"neg":"");
  var every=S.config.rateReviewTurns||6, left=Math.max(0, every-(m.sinceReview||0));
  kv(s1,"下次利率檢視", left+" 輪後", left<=1?"gold":"");
  var infT=E.cfg(S,"inflationTurns"); if(infT===undefined) infT=12;
  if(infT>0){ var li=Math.max(0, infT-(m.sinceInflation||0));
    kv(s1,"下次物價調整", li+" 輪後", li<=1?"gold":""); }
  if(s1.__g) s1.__g.className="fbGrid two";     // S14a-2：總經一排兩欄
  var lampRow=el("div"); lampRow.style.cssText="margin-top:5px;font-size:var(--fs-xs)";
  var lp=LAMP[S.enabledModules.indexOf("M4")>=0?m.stage:"RECOVERY"]||LAMP.RECOVERY;
  var lamp=el("span","lamp"); lamp.style.background=lp[0];
  lampRow.appendChild(el("span",null,"景氣燈號　")); lampRow.appendChild(lamp);
  lampRow.appendChild(el("span",null,lp[1]+"　（"+(m.turnsInStage||0)+" 輪）"));
  s1.appendChild(lampRow);
  if(S.pendingShock){
    var rd=Math.max(0,S.pendingShock.turn-S.turnNumber);
    var sk=el("div","fbWarn"); sk.style.cssText="margin-top:4px;font-size:var(--fs-xs);line-height:1.4";
    sk.textContent="⚠ "+S.pendingShock.desc+"　"+rd+" 輪後衝擊"; s1.appendChild(sk);
  }
  var vc=E.cfg(S,"vacancyChance_"+m.stage);
  if(vc>0){ var vd=el("div"); vd.style.cssText="margin-top:3px;font-size:var(--fs-xs);color:var(--neg)";
    vd.textContent="🏚 空租風險 "+util.pct(vc,0); s1.appendChild(vd); }
  // S14a：重大事件警告——只播「從現有狀態就推得出來」的事，不預測、不編造。
  var warns=[];
  if(left<=2 && Math.abs(m.targetRate-m.baseRate)>1e-9)
    warns.push((m.targetRate>m.baseRate?"升息":"降息")+"在即："+left+" 輪後利率檢視，目標 "+util.pct(m.targetRate,2)+
               "（浮動貸款的月付會跟著動）");
  if(li!==undefined && li<=2 && m.inflation>0)
    warns.push("物價調整在即："+li+" 輪後全體支出隨通膨 "+util.pct(m.inflation,2)+" 上調");
  var evNear=(S.activeGlobalEvents||[]).filter(function(e){
    return e.label && e.until!==undefined && (e.until-S.turnNumber)<=1 && (e.kind==="PARAM"||e.kind==="SPACE_MULT"); });
  if(evNear.length) warns.push("政策效果即將結束："+evNear.map(function(e){return e.label;}).join("、"));
  // S17：警告改放中欄最上面。沒有事件時保留同高度的空白帶，盤面位置才不會跳動。
  if(bW){
    if(warns.length){
      var wb0=el("div","wbox");
      wb0.innerHTML="⚠ <b>重大事件警告</b><br>"+warns.join("<br>");
      bW.appendChild(wb0);
    } else {
      bW.appendChild(el("div","wempty","目前沒有重大事件"));
    }
  }

  // 股市資訊
  if(S.enabledModules.indexOf("M1")>=0){
    var s2=sec("股市資訊","stocks");
    ns.content.stockDefs.forEach(function(def){
      var price=E.stockPrice(S,def);
      var hist=(S.stockHistory&&S.stockHistory[def.symbol])||[def.face];
      var scB=E.stockChange(S,def), chg=scB.chg, chgP=scB.pct;
      var recent=chg;
      var r=el("div","fbRow");
      // 名稱會被截成 4 個字，分類（成長／高股息／ETF／投機）就看不見了——
      // 玩家因此分不清哪一檔本來就該大起大落。補一個短標籤。
      var shortNm=E.stockName(S,def.symbol).replace(/（.*）| ETF/,"").slice(0,4);
      var TAGS={STK_TECH:"成長",STK_DIV:"配息",STK_ETF:"ETF",STK_SPEC:"投機"};
      var TAGC={STK_TECH:"var(--gold)",STK_DIV:"var(--pos)",STK_ETF:"var(--tx2)",STK_SPEC:"var(--neg)"};
      var nmW=el("span","nm");
      nmW.appendChild(el("span",null,shortNm));
      var tg=el("span",null,TAGS[def.symbol]||"");
      tg.style.cssText="margin-left:4px;font-size:10px;opacity:.85;color:"+(TAGC[def.symbol]||"var(--tx3)");
      nmW.appendChild(tg);
      r.appendChild(nmW);
      r.appendChild(el("span","px num",M(price)));
      r.appendChild(el("span","ch "+(chg>=0?"pos":"neg"),(chg>=0?"▲":"▼")+util.pct(Math.abs(chgP),1)));
      var sp=el("span","spark"); sp.innerHTML=ui.miniSpark(hist, recent>=0); r.appendChild(sp);
      r.onclick=function(){ ui.showStockPanel(def.symbol); };   // S14a：點該檔直接開單檔面板（交易入口從操作區搬到這裡）
      s2.appendChild(r);
    });
  }

  // 系統訊息（事件 log）
  var s3=secIn(bL,"系統訊息","syslog");
  var tn=el("div"); tn.style.cssText="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px";
  // S14b：99 輪是預設終點但可以續攤。剩 10 輪內把倒數標出來，別讓桌上被結算殺個措手不及。
  var leftT = S.config.maxTurns - S.turnNumber, soonT = (leftT<=10 && leftT>=0 && !S.over);
  var tnl=el("b",null,"第 "+S.turnNumber+" / "+S.config.maxTurns+" 輪"+(soonT?"（剩 "+leftT+"）":""));
  tnl.id="turnLabel";
  if(soonT){
    tnl.classList.add("endingSoon");
    tnl.title="再 "+leftT+" 輪就到上限；到期還沒人自由的話，可以在結算畫面按「再延長」接著打";
  }
  var ver=el("span",null,(ns.BUILD?ns.BUILD.ver+"・"+ns.BUILD.date:""));
  ver.style.cssText="font-size:12px;color:var(--tx3)";
  // 八期：只留最新 5 則，完整流水改由「全部 ›」開視窗查看（與版本同一行，省空間）
  var right=el("div"); right.style.cssText="display:flex;align-items:baseline;gap:8px";
  var all=el("span",null,"全部 ›"); all.style.cssText="color:var(--gold);font-size:12px;cursor:pointer";
  all.onclick=function(){ ui.showFullLog(); };
  right.appendChild(ver); right.appendChild(all);
  tn.appendChild(tnl); tn.appendChild(right); s3.appendChild(tn);
  var log=el("div"); log.id="sysLog";
  // S17：系統訊息搬到左欄後版位變大，能顯示的則數跟著提高（原本擠在中欄只放得下 5 則）
  var feedN = $("infoL") ? 14 : 5;
  var feed=(ui.feed||[]).slice(-feedN).reverse();   // 最新在上
  if(!feed.length) log.appendChild(el("div","ln","（遊戲開始）"));
  feed.forEach(function(fd,i){
    var ln=el("div","ln"+(i===0?" new":""));    // 最新一則醒目
    ln.appendChild(el("span","tn","第"+fd.turn+"輪"));
    ln.appendChild(el("span",null,fd.msg));
    log.appendChild(ln);
  });
  s3.appendChild(log);

  // 交易所（僅全場交易部位；信用／額度屬個人資訊，八期已移至右欄個人面板）
  var s4=sec("交易所","exchange");
  var myP2PDebts=me.liabilities.filter(function(l){return l.kind==="P2P";});
  var myP2PLoans=me.assets.filter(function(a){return a.kind==="P2P_LOAN";});
  var myJV=me.assets.filter(function(a){return a.jvGroupId;});
  var any=false;
  var pw=el("div"); pw.style.cssText="font-size:var(--fs-xs);line-height:1.5";
  myP2PDebts.forEach(function(l){ any=true;
    pw.appendChild(el("div","neg","↘ P2P 欠 "+(S.players[l.counterpartyId]?S.players[l.counterpartyId].name:"?")+" "+M(l.principal))); });
  myP2PLoans.forEach(function(a){ any=true;
    pw.appendChild(el("div","pos","↗ P2P 借出 "+(S.players[a.counterpartyId]?S.players[a.counterpartyId].name:"?")+" 餘 "+M(a.marketValue))); });
  // S12：原本只印一個數量，看不出跟誰合資了什麼。資料裡本來就有 jvGroupId 與 sharePct。
  myJV.forEach(function(a){ any=true;
    var mates=[];
    S.players.forEach(function(op){
      if(op.id===me.id) return;
      (op.assets||[]).forEach(function(x){
        if(x.jvGroupId===a.jvGroupId)
          mates.push(op.name+" "+util.pct(x.sharePct||0,0)); });
    });
    var line=el("div");
    line.innerHTML="🤝 <b>"+a.name+"</b>　你 "+util.pct(a.sharePct||0,0)+
      (mates.length?("　·　"+mates.join("、")):"　·　（對方持份已轉出）")+
      "<br><span style='color:var(--tx3)'>市值 "+M(a.marketValue||0)+
      "　月現金流 "+M(a.monthlyIncome||0)+"</span>";
    pw.appendChild(line);
  });
  // S15：懸置中的邀約原本在這裡完全看不到——而那正是會讓整局停下來的狀態。
  var wq2=E.waitingOnHumans(S);
  if(wq2 && wq2.waiting && wq2.waiting.length){
    any=true;
    var KN2={AUCTION:"密封出價",REFERRAL:"轉介",JV:"合資",TRADE:"轉讓"};
    var wl=el("div","gold");
    wl.textContent="⏳ "+(KN2[wq2.kind]||wq2.kind)+"進行中"+(wq2.title?("："+wq2.title):"")+
      "　等待 "+wq2.waiting.map(function(id){return (S.players[id]&&S.players[id].name)||("玩家"+id);}).join("、");
    pw.appendChild(wl);
  }
  if(!any) pw.appendChild(el("div",null,"（沒有進行中的 P2P／合資）"));
  s4.appendChild(pw);
};
/* ====================== V10：人生商城 ====================== */
ui.mallItems = function(){ return (ns.content.cards && ns.content.cards.MALL) || []; };
ui.showMall = function(){
  var S=ui.S, p=S.players[ui.myId()];
  var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
  if(per<=0){ ui.toast("本局未開啟人生商城","warn",3000); return; }
  // S14a-2：逛商城與下手都不影響別人，開放在別人的回合也能做。
  // 輪到自己時仍受階段規則（先擲完骰、處理完決策與記帳）——引擎那邊是同一條規則。
  var myTurn = S.activePlayerIdx===ui.myId();
  /* S19：實測回饋——「人生商城似乎可以在別人的輪次購買（應該只能看不能買），
     且同一輪不應該可以買兩次」。引擎那邊已經用 mallOffTurnBuy 擋住；
     這裡把畫面對齊：別人的回合照樣打得開（可以先研究），但買鈕停用並說明原因。 */
  var offTurnOk = E.offTurnSelfOk ? E.offTurnSelfOk(S,"MALL_BUY") : true;
  var canAct = !p.bankrupt && !S.over &&
               (myTurn ? (S.phase==="ROLL" || S.phase==="READY_END") : offTurnOk);
  var left = Math.max(0, per-(p.mallBoughtThisTurn||0));
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="720px";
  var hd=el("div"); hd.style.cssText="display:flex;justify-content:space-between;align-items:baseline";
  hd.appendChild(el("h2",null,"🛍 人生商城"));
  hd.appendChild(el("b","gold","現金 "+M(p.cash)+"　本輪可買 "+left+" 項"+
    (myTurn ? "" : (offTurnOk ? "（不必等自己的回合）" : "（現在只能看——買東西要等自己的回合）"))));
  box.appendChild(hd);
  box.appendChild(el("div","sub","花錢買的不只是東西——進修、健康、保險、人情與挑戰，都會回到你的生活與帳本上。"+
    "同一件事重複做，幸福感會遞減（第二次剩一半、之後歸零），而且要隔幾輪才能再來一次。"+
    (canAct?"":"　（"+(p.bankrupt?"破產程序中":"先把手上的決策或記帳處理完")+"）")));

  // 目前生效中的狀態
  var st=[]; 
  if(p.flags && p.flags.insured) st.push("🛡 醫療＋意外險投保中（保費 "+M(p.flags.insurancePremium||0)+"／月）");
  if(p.flags && p.flags.fitUntil!==undefined && S.turnNumber<=p.flags.fitUntil) st.push("🏋 健身中（至第 "+p.flags.fitUntil+" 輪）");
  if(p.flags && p.flags.checkedUntil!==undefined && S.turnNumber<=p.flags.checkedUntil) st.push("🩺 健檢有效（至第 "+p.flags.checkedUntil+" 輪）");
  if(p.flags && p.flags.propInsured) st.push("🏠 住宅火險投保中（年繳 "+M(p.flags.propPremium||0)+"，第 "+(p.flags.propRenewAt||0)+" 輪自動續約）");
  if(p.flags && p.flags.network) st.push("🎓 人脈已解鎖（可抽特殊機會）");
  if(st.length){
    var stRow=el("div","flavor"); stRow.style.cssText="margin-bottom:6px;color:var(--pos)";
    stRow.textContent="生效中："+st.join("　");
    box.appendChild(stRow);
    if(p.flags.insured && canAct){
      var cb=el("button","mini","解約醫療＋意外險");
      cb.onclick=function(){ ov.remove(); ui.dispatch({type:"MALL_CANCEL_INSURANCE",playerId:ui.myId(),payload:null}); };
      box.appendChild(cb);
    }
    if(p.flags.propInsured && canAct){
      var cb2=el("button","mini","解約住宅火險（停止自動續約）");
      cb2.onclick=function(){ ov.remove(); ui.dispatch({type:"MALL_CANCEL_PROPERTY",playerId:ui.myId(),payload:null}); };
      box.appendChild(cb2);
    }
  }

  var items=ui.mallItems(), groups=[];
  items.forEach(function(it){ if(groups.indexOf(it.group)<0) groups.push(it.group); });
  groups.forEach(function(g){
    box.appendChild(el("div","mallGroup",g));
    var grid=el("div","mallGrid");
    items.filter(function(it){ return it.group===g; }).forEach(function(it){
      var pl=it.payload||{};
      var b=el("button","mallItem");
      var owned = (pl.insurance && p.flags && p.flags.insured)
               || (pl.propertyInsurance && p.flags && p.flags.propInsured);
      var active = E.mallStillActive(S,p,it);                       // 年約還在效期內
      var usedUp = it.oncePerGame && p.mallBought && p.mallBought[it.id];
      if(owned || active) b.className+=" mallOn";
      b.appendChild(el("div","ic",pl.icon||it.icon||"🛍"));
      b.appendChild(el("div","tt",it.title));
      b.appendChild(el("div","fl",it.flavor||""));
      var price=[];
      var itCost = E.mallCost(S,it,p);
      if(pl.costSalaryMult){
        price.push("一次 "+M(itCost)+"（月薪 "+pl.costSalaryMult+" 倍）");
      } else {
        if(pl.annualPremium) price.push("年繳 "+M(pl.annualPremium));
        if(pl.cost) price.push("一次 "+M(pl.cost));
      }
      if(pl.recurringMonthly) price.push("每月 "+M(pl.recurringMonthly));
      if(!price.length) price.push("免費");
      var boughtN = (p.mallBought && p.mallBought[it.id]) || 0;
      var cdLeftM = E.mallCooldownLeft(S,p,it);
      var joyNow  = E.mallJoyFor(S,p,it);
      var extra=[];
      // S13.1 §2：重複購買的幸福感會遞減——把「這一次實際能拿到多少」直接寫在卡上，
      // 不要讓玩家以為可以靠同一張卡無限刷幸福感。
      if(pl.joy){
        extra.push(boughtN>0 ? ("幸福感 +"+joyNow+"（原 +"+pl.joy+"，第 "+(boughtN+1)+" 次）")
                             : ("幸福感 +"+pl.joy));
      }
      if(pl.virtue) extra.push("品格 "+T("virtue."+pl.virtue)+" +1");
      if(pl.skipTurns) extra.push("停走 "+pl.skipTurns+" 輪");
      if(pl.chance!==undefined) extra.push("成功機率 "+Math.round(pl.chance*100)+"%");
      if(pl.contest) extra.push("擲骰決定獎金");
      if(pl.note) extra.push(pl.note);
      b.appendChild(el("div","pr",price.join("　")));
      if(extra.length){ var ex=el("div","fl",extra.join("　·　")); ex.style.marginTop="3px"; b.appendChild(ex); }
      var why="";
      // S19：別人的回合只能看不能買，理由要說清楚，不要跟「決策沒處理完」混在一起
      if(!canAct) why = p.bankrupt ? "破產程序中"
                     : (!myTurn && !offTurnOk ? "現在是別人的回合——可以先看，買東西要等輪到你"
                     : "先把手上的決策或記帳處理完");
      else if(left<=0) why="這一輪的商城額度已用完（每輪 "+per+" 次）";
      else if(owned) why="已投保，不需重複購買";
      else if(active) why="年約還在效期內（至第 "+p.flags[pl.flag+"Until"]+" 輪），到期會問你要不要續約";
      else if(usedUp) why="本局限購一次，已經買過了";
      else if(cdLeftM>0) why="剛買過，再過 "+cdLeftM+" 輪才能重複購買";
      else if(pl.reqChild && !(p.childrenCount>0)) why="還沒有小孩";
      else if(itCost>p.cash) why="現金不足";
      b.disabled=!!why; b.title=why||(it.eduNote||"");
      b.onclick=function(){
        var after=util.r2(p.cash-(pl.cost||0));
        ui.spendGuard(after, function(){
          ov.remove(); ui.dispatch({type:"MALL_BUY",playerId:ui.myId(),payload:{itemId:it.id}});
        });
      };
      grid.appendChild(b);
    });
    box.appendChild(grid);
  });
  var o=el("div","opts"); o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ====================== V10：機會轉介（收介紹費） ====================== */
ui.showReferPanel = function(cd){
  var S=ui.S, me=S.players[ui.myId()];
  var fee=E.referralFee(S,cd);
  var others=S.players.filter(function(x){return x.id!==me.id && !x.bankrupt;});
  if(!others.length || fee<=0) return;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="460px";
  box.appendChild(el("h2",null,"轉介這個機會"));
  var fl=el("div","flavor");   // V4：改 innerHTML——原本 textContent 會把標籤印成怪字
  fl.innerHTML="自己吃不下的案子，可以介紹給別人做，收一筆介紹費——這是仲介與掮客的日常。"+
    "<br>「"+cd.title+"」月現金流 "+M(E.oppIncome(S,cd))+"，介紹費＝"+
    (E.cfg(S,"referralFeeMonths")||1.5)+" 個月現金流＝<b class='gold'>"+M(fee)+"</b>。";
  box.appendChild(fl);
  box.appendChild(ui.oppFacts(S, cd, me));
  box.appendChild(el("div","sub","真人會在自己的畫面親自回應；電腦會評估現金水位與案子價值，可能婉拒（婉拒就沒有介紹費）。"));
  var o=el("div","opts");
  o.appendChild(optBtn("📢 轉介給所有人（先接受先成交）","真人優先，全婉拒才輪詢電腦",function(){
    ov.remove();
    ui.dispatch({type:"REFER_OPP",playerId:ui.myId(),payload:{cardId:cd.id, targetId:null}});
  },true));
  others.forEach(function(t){
    o.appendChild(optBtn("轉介給 "+t.name, "現金 "+M(t.cash)+"　被動 "+M(t.derived.passiveIncome)+"／月", function(){
      ov.remove();
      ui.dispatch({type:"REFER_OPP",playerId:ui.myId(),payload:{cardId:cd.id, targetId:t.id}});
    }));
  });
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// 九期：全服公告（重大事件）——橫幅由上方滑入，數秒後自動收；可點擊立即關閉
ui.broadcast = function(title, sub, tone, ms){
  var host=$("bcast"); if(!host) return;
  var bc=el("div","bc"+(tone==="warn"?" warn":""));
  bc.appendChild(el("div","ttl",title));
  if(sub) bc.appendChild(el("div","sub",sub));
  host.innerHTML="";
  host.appendChild(bc);
  var kill=function(){ if(bc.parentNode) bc.parentNode.removeChild(bc); };
  bc.onclick=kill;
  clearTimeout(ui._bcT);
  ui._bcT=setTimeout(kill, ms||5200);
};

// 八期：完整系統訊息（最多 40 則）
ui.showFullLog = function(){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"系統訊息（完整）"));
  box.appendChild(el("div","sub","最近 "+(ui.feed||[]).length+" 則，最新在上"));
  var wrap=el("div"); wrap.style.cssText="max-height:52vh;overflow-y:auto;font-size:13px;line-height:1.6";
  var fd=(ui.feed||[]).slice().reverse();
  if(!fd.length) wrap.appendChild(el("div","flavor","（還沒有事件）"));
  fd.forEach(function(f,i){
    var ln=el("div"); ln.style.cssText="padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.06)"+
      (i===0?";color:var(--gold);font-weight:600":";color:var(--tx2)");
    ln.appendChild(el("span",null,"第"+f.turn+"輪　")).style.color="var(--tx3)";
    ln.appendChild(el("span",null,f.msg));
    wrap.appendChild(ln);
  });
  box.appendChild(wrap);
  var o=el("div","opts"); o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// 24px 迷你走勢
ui.miniSpark = function(hist, up){
  if(!hist || hist.length<2) return "";
  var W=52,H=24,mn=Math.min.apply(null,hist),mx=Math.max.apply(null,hist),rng=(mx-mn)||1;
  var pts=hist.map(function(v,i){ var x=i*(W/(hist.length-1)), y=H-2-((v-mn)/rng)*(H-4);
    return x.toFixed(1)+","+y.toFixed(1); }).join(" ");
  return "<svg width='"+W+"' height='"+H+"' style='display:block'><polyline points='"+pts+
    "' fill='none' stroke='"+(up?"#35C4A8":"#F0803C")+"' stroke-width='1.5'/></svg>";
};

ui.renderSheet = function(){
  var S=ui.S;
  var p=(ui.viewPlayerId!==null && ui.viewPlayerId!==undefined && S.players[ui.viewPlayerId]) || S.players[ui.myId()];
  var d=p.derived, box=$("sheet");
  box.innerHTML="";
  // S13.1 FF-003：多人時「我」是 ui.myId()，不是固定的 0 號座位。
  // 舊寫法讓 seat>=1 的玩家看自己的財報時 isMe=false → 辭職進自由圈／進修／賣資產／還款全部停用。
  var isMe = p.id===ui.myId();
  var canAct = isMe && S.activePlayerIdx===ui.myId() && (S.phase==="ROLL"||S.phase==="READY_END") && !p.bankrupt;
  // S14a-2：只影響自己的動作（提前還本、定期定額）不必等回合；
  // 會牽動別人的（買賣資產、借款、交易所）仍然只能在自己的回合做。
  var myTurnNow = S.activePlayerIdx===ui.myId();
  var canSelf = isMe && !p.bankrupt && !S.over && (!myTurnNow || S.phase==="ROLL" || S.phase==="READY_END");

  /* 玩家資訊 */
  var head=el("div","sec"); head.setAttribute("data-tut","credit");   // S20：互動教學錨點
  var h=el("div"); h.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:6px";
  h.appendChild(el("b",null,p.name+"　"+ns.content.professionById[p.professionId].name+(p.playerStage==="OUTER"?"（已辭職）":"")));
  var st=el("span",null,p.playerStage==="OUTER"?"🕊 自由圈":"");
  st.style.cssText="color:var(--gold);font-size:13px"; h.appendChild(st);
  head.appendChild(h);
  if(!isMe){ var vw=el("div",null,"👁 檢視他人財報中——再點一次玩家欄切回自己");
    vw.style.cssText="color:var(--tx3);font-size:13px;margin-top:2px"; head.appendChild(vw); }
  var crLine=el("div"); crLine.style.cssText="margin-top:4px;font-size:13px;color:var(--tx3);display:flex;align-items:center;gap:6px;flex-wrap:wrap";
  crLine.appendChild(ui.creditBadge(S,p,true));
  var crd=ui.creditDesc(S,p);
  var room=E.creditCapacity(S,p);
  crLine.appendChild(el("span",null,"額度 "+crd.dbr+"× 月收入"));
  var roomS=el("span",null,"借款空間 "+M(room)); roomS.style.cssText="color:var(--gold);font-family:var(--mono)";
  crLine.appendChild(roomS);
  // S14a：借款鈕從中欄操作區搬到這裡——它本來就是「個人信用」的一部分，放在額度旁邊才讀得懂
  if(isMe){
    var btnWrap=el("span"); btnWrap.style.cssText="margin-left:auto;display:flex;gap:5px;flex:none";
    var lb=el("button","mini gold","借款");
    lb.disabled = !(canAct && E.canUseLoan(S) && room>=1);
    lb.title = !E.canUseLoan(S) ? "本局難度未開放貸款（新手難度只能用現金）"
             : (room<1 ? "已無可用額度" : (canAct?"":"現在不是你的操作時機"));
    lb.onclick=function(){ ui.showLoanDialog(); };
    btnWrap.appendChild(lb);
    var rb0=el("button","mini","還款");
    rb0.disabled = !(canSelf && p.liabilities.filter(function(x){return x.kind!=="P2P";}).length>0);
    rb0.title = rb0.disabled ? "沒有可提前清償的貸款，或手上還有決策／記帳沒處理完"
                             : "選一筆貸款提前還本（不必等自己的回合）";
    rb0.onclick=function(){ ui.showRepayPicker(p); };
    btnWrap.appendChild(rb0);
    crLine.appendChild(btnWrap);
  }
  head.appendChild(crLine);
  var dream=ns.content.byId[p.dreamCardId];
  if(dream){ var dm=el("div",null,"夢想："+dream.name+"　"+p.dreamProgress+"／"+S.config.dreamCost+" 點");
    dm.style.cssText="color:var(--tx3);font-size:13px;margin-top:3px"; head.appendChild(dm); }
  var wb=el("div");
  wb.style.cssText="font-size:13px;margin-top:3px";
  var wbs=el("span","wbClick","幸福感 ♥ "+ui.wellbeing(p)); wbs.style.color="#E8709B";
  wbs.title="點擊看幸福感／品格／夢想的積累明細";
  wbs.onclick=function(){ ui.showWellbeingDetail(p); };
  wb.appendChild(wbs);
  // 七期：品格改數字、緊跟幸福感之後（原獨立星等區塊移除）
  if(S.enabledModules.indexOf("M6")>=0 && p.virtues){
    var vshort={TEMPER:"情緒",PRUDENCE:"守法",PARENTING:"教養",FILIAL:"孝親"};
    var vtxt=["TEMPER","PRUDENCE","PARENTING","FILIAL"].map(function(ax){
      return vshort[ax]+" "+(p.virtues[ax]||0); }).join("・");
    var vsp=el("span","wbClick","　品格 "+vtxt); vsp.style.color="var(--gold)";
    vsp.title="品格四軸（滿級 "+S.config.virtueMaxLevel+"）：點擊看完整積累明細";
    vsp.onclick=function(){ ui.showWellbeingDetail(p); };
    wb.appendChild(vsp);
  }
  // V10：保險與健康狀態
  var badges=[];
  if(p.flags && p.flags.insured) badges.push("🛡 醫療意外險");
  if(p.flags && p.flags.fitUntil!==undefined && S.turnNumber<=p.flags.fitUntil) badges.push("🏋 健身中");
  if(p.flags && p.flags.checkedUntil!==undefined && S.turnNumber<=p.flags.checkedUntil) badges.push("🩺 健檢有效");
  if(badges.length){ var bsp=el("span",null,"　"+badges.join("・")); bsp.style.color="var(--pos)"; wb.appendChild(bsp); }
  head.appendChild(wb);
  var btnRow=el("div"); btnRow.style.cssText="display:flex;gap:8px;margin-top:7px";
  var bDet=el("button","act","收支明細"); bDet.style.flex="1"; bDet.style.padding="8px";
  bDet.onclick=function(){ ui.showDetails(p); };
  btnRow.appendChild(bDet);
  head.appendChild(btnRow);
  box.appendChild(head);

  /* 損益表｜資產負債表（並排） */
  var fin=el("div","sec"); fin.setAttribute("data-tut","fin");        // S20：互動教學錨點
  var g=el("div","twoCol");
  function miniTable(title, rows){
    var dv=el("div");
    dv.appendChild(el("h4",null,title)).style.cssText="margin:0 0 4px;font-size:var(--fs-xs);letter-spacing:.12em;color:var(--tx3)";
    rows.forEach(function(r){
      var row=el("div","row"+(r.total?" total":"")); row.style.fontSize="11px";
      row.appendChild(el("span","lbl",r.l));
      row.appendChild(el("span","val num"+(r.cls?" "+r.cls:""),M(r.v)));
      dv.appendChild(row);
    });
    return dv;
  }
  g.appendChild(miniTable(T("sheet.is"),[
    {l:"主動收入", v:d.salaryIncome},
    {l:"被動收入", v:d.passiveIncome, cls:d.passiveIncome>0?"pos":""},
    {l:"總支出", v:-d.totalExpenses, cls:"neg"},
    {l:"淨現金流", v:d.netCashflow, cls:d.netCashflow>=0?"pos":"neg", total:true}
  ]));
  g.appendChild(miniTable(T("sheet.bs"),[
    {l:"現金", v:p.cash, cls:p.cash<0?"neg":""},
    {l:"資產", v:d.totalAssets},
    {l:"負債", v:-d.totalLiabilities, cls:"neg"},
    {l:"淨值", v:d.netWorth, cls:d.netWorth>=0?"":"neg", total:true}
  ]));
  fin.appendChild(g); box.appendChild(fin);

  /* 自由／圓夢進度條 */
  var fr=el("div","freedom"); fr.setAttribute("data-tut","freedom");  // S20：互動教學錨點
  var ratio=Math.min(1, ledger.freedomRatio(p));
  var t1=el("div"); t1.style.cssText="display:flex;justify-content:space-between;font-size:12px";
  t1.appendChild(el("b",null,p.playerStage==="OUTER"?"圓夢進度":T("sheet.freedom")));
  t1.appendChild(el("b","gold", p.playerStage==="OUTER" ? (p.dreamProgress+" / "+S.config.dreamCost+" 點") : util.pct(ratio,0)));
  fr.appendChild(t1);
  var bar=el("div","bar"), fill=el("i");
  fill.style.width=(p.playerStage==="OUTER" ? (p.dreamProgress/S.config.dreamCost*100) : ratio*100)+"%";
  bar.appendChild(fill); fr.appendChild(bar);
  var cap=el("div","cap");
  if(p.playerStage==="OUTER"){
    var narr = dream ? Math.round(p.dreamProgress*dream.narrativeTotal/S.config.dreamCost)+" / "+dream.narrativeTotal+" "+dream.narrativeUnit : "";
    cap.appendChild(el("span",null,narr));
    cap.appendChild(el("span",null,"下一段 "+M(S.config.dreamProgressBasePrice*(p.dreamProgress+1))));
  } else {
    cap.appendChild(el("span",null,term("PASSIVE_INCOME")+" "+M(d.passiveIncome)));
    cap.appendChild(el("span",null,"目標 "+M(d.totalExpenses)));
  }
  fr.appendChild(cap);
  // V11：獲勝＝夢想集滿 ＋ 幸福感達門檻，兩個條件都要看得到
  var needW=E.winWellbeingMin(S);
  if(needW>0){
    var haveW=ui.wellbeing(p), okD=p.dreamProgress>=S.config.dreamCost, okW=haveW>=needW;
    var wl=el("div"); wl.style.cssText="display:flex;justify-content:space-between;font-size:13px;margin-top:5px;padding-top:5px;border-top:1px dashed var(--line2)";
    wl.appendChild(el("b",null,"獲勝條件"));
    var wr=el("span");
    wr.innerHTML="夢想 <b class='"+(okD?"pos":"")+"'>"+p.dreamProgress+"／"+S.config.dreamCost+"</b>"+
      "　＋　幸福感 <b class='"+(okW?"pos":"neg")+"'>"+haveW+"／"+needW+"</b>";
    wr.className="wbClick"; wr.style.cursor="pointer";
    wr.title="點擊看幸福感／品格／夢想的積累明細";
    wr.onclick=function(){ ui.showWellbeingDetail(p); };
    wl.appendChild(wr); fr.appendChild(wl);
    if(okD && !okW){
      var hint=el("div",null,"夢想已集滿，但幸福感還差 "+(needW-haveW)+" 點——去商城做點對生活與家人有意義的事吧。");
      hint.style.cssText="font-size:12.5px;color:var(--gold);margin-top:3px;line-height:1.4";
      fr.appendChild(hint);
    }
  }
  box.appendChild(fr);

  /* 數位資產：爬坡進度與長尾收入 */
  if(E.digitalOn(S) && (p.digitalAssets||[]).some(function(x){ return !x.dead; })){
    var dsec=el("div","sec");
    var dhd=el("div"); dhd.style.cssText="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px";
    dhd.appendChild(el("b",null,"數位資產"));
    var totD=0; (p.digitalAssets||[]).forEach(function(x){ if(!x.dead) totD+=x.monthlyIncome||0; });
    dhd.appendChild(el("b","gold","長尾 +"+M(util.r2(totD))+"／月"));
    dsec.appendChild(dhd);
    (p.digitalAssets||[]).forEach(function(dg){
      if(dg.dead) return;
      var row=el("div"); row.style.cssText="margin-bottom:5px";
      var t1=el("div"); t1.style.cssText="display:flex;justify-content:space-between;font-size:12.5px";
      t1.appendChild(el("span",null,(p.tending===dg.id?"🎬 ":"⏸ ")+dg.name));
      if(dg.tier===null){
        t1.appendChild(el("b","gold", dg.progress+" / "+dg.threshold+" 輪"));
        row.appendChild(t1);
        var bar=el("div","bar"), fill=el("i");
        fill.style.width=Math.min(100, dg.progress/Math.max(1,dg.threshold)*100)+"%";
        bar.appendChild(fill); row.appendChild(bar);
      } else {
        var fade = dg.monthlyIncome < dg.takeoffIncome;
        t1.appendChild(el("b",(fade?"neg":"pos"),"+"+M(dg.monthlyIncome)+"／月"+(fade?"（衰減中）":"")));
        row.appendChild(t1);
      }
      if(isMe && canAct){
        var btns=el("div"); btns.style.cssText="display:flex;gap:6px;margin-top:3px";
        if(p.tending!==dg.id){
          var bt=el("button","mini", dg.tier===null?"投入時間顧它":"重新經營（止跌）");
          if(p.learning){ bt.disabled=true; bt.title="你正在進修，時間排不開"; }
          bt.onclick=(function(id){ return function(){
            ui.dispatch({type:"TEND_DIGITAL",playerId:ui.myId(),payload:{digitalId:id}}); }; })(dg.id);
          btns.appendChild(bt);
        } else {
          var bs=el("button","mini","先放著（會開始掉）");
          bs.onclick=function(){ ui.dispatch({type:"TEND_DIGITAL",playerId:ui.myId(),payload:{digitalId:null}}); };
          btns.appendChild(bs);
        }
        row.appendChild(btns);
      }
      dsec.appendChild(row);
    });
    if(p.learning) dsec.appendChild(el("div","flavor","進修中不能同時經營——時間只有一份。"));
    box.appendChild(dsec);
  }

  /* 副業：主動收入，不計入自由率 */
  if(p.sideJob){
    var sjB=el("div","sec");
    var sjT=el("div"); sjT.style.cssText="display:flex;justify-content:space-between;font-size:12px";
    sjT.appendChild(el("b",null,"副業："+p.sideJob.label));
    sjT.appendChild(el("b","gold","淨 +"+M(util.r2(p.sideJob.income-p.sideJob.cost))+"／月"));
    sjB.appendChild(sjT);
    sjB.appendChild(el("div","flavor","收入 +"+M(p.sideJob.income)+"、成本 −"+M(p.sideJob.cost)+
      "　這是主動收入，不計入自由率。"));
    box.appendChild(sjB);
  }

  /* 人生二選一：身上還擱著一件事 */
  if(p.deferredLifeId){
    var dfC = ns.content.byId[p.deferredLifeId];
    var dfB = el("div","sec");
    var dfT = el("div"); dfT.style.cssText="font-size:12px;margin-bottom:3px";
    dfT.appendChild(el("b",null,"還擱著一件事"));
    dfB.appendChild(dfT);
    dfB.appendChild(el("div","flavor","「"+(dfC?dfC.title:"?")+"」——下次踩到人生格時會先找上你。"));
    box.appendChild(dfB);
  }

  /* M8 S1：學習與準備 */
  if(S.enabledModules.indexOf("M8")>=0 && !p.bankrupt){
    var nSk = E.cfg(S,"skillPerGame"); if(nSk===undefined) nSk = 12;
    if(nSk > 0){
      var ls = el("div","sec"); ls.setAttribute("data-tut","learn");  // S20：互動教學錨點
      var lt = el("div"); lt.style.cssText="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px";
      lt.appendChild(el("b",null,"學習與準備"));
      var nSkills = Object.keys(p.skills||{}).length;
      lt.appendChild(el("b","gold", nSkills+" 項技能"));
      ls.appendChild(lt);
      if(p.learning){
        var lcd = ns.content.byId[p.learning.skillId];
        var tot = Math.max(1, p.learning.endTurn - p.learning.startTurn);
        var don = Math.max(0, Math.min(tot, S.turnNumber - p.learning.startTurn));
        var lrow = el("div"); lrow.style.cssText="display:flex;justify-content:space-between;font-size:12.5px";
        lrow.appendChild(el("span",null,"📚 "+(lcd?lcd.title:"?")));
        lrow.appendChild(el("b","gold", don+" / "+tot+" 輪"));
        ls.appendChild(lrow);
        var lbar = el("div","bar"), lfill = el("i");
        lfill.style.width = (don/tot*100)+"%"; lbar.appendChild(lfill); ls.appendChild(lbar);
        if(isMe && canAct){
          var pctA = E.cfg(S,"abandonRefundPct"); if(pctA===undefined) pctA = 0.3;
          var ab = el("button","mini","放棄學習（退回 "+M(util.r2((p.learning.paidCost||0)*pctA))+"）");
          ab.style.marginTop="4px";
          ab.onclick = function(){ ui.showAbandonSkill(p); };
          ls.appendChild(ab);
        }
      } else if(isMe){
        var cdLeft = Math.max(0, (p.skillCooldownUntil||0) - S.turnNumber);
        if(cdLeft > 0){
          ls.appendChild(el("div","flavor","剛學完，休息 "+cdLeft+" 輪後可以再開始"));
        } else if(canAct){
          var sb = el("button","act","📖 進修（自己找資源）");
          sb.style.width="100%"; sb.onclick = function(){ ui.showSkillMenu(p); };
          ls.appendChild(sb);
        }
      }
      if(nSkills > 0){
        var slist = el("div","flavor"); slist.style.marginTop="4px";
        slist.textContent = "已具備："+Object.keys(p.skills).map(function(sid){
          var sc = ns.content.byId[sid];
          var rc0=p.skills[sid];
          var warnLeft = rc0.decayPendingUntil ? Math.max(0, rc0.decayPendingUntil - S.turnNumber) : 0;
          return (sc?sc.title:sid) + (rc0.decayed ? "（已過時，可半價更新）"
                 : (rc0.decayPendingUntil ? "（"+warnLeft+" 輪後過時）" : ""));
        }).join("、");
        ls.appendChild(slist);
      }
      box.appendChild(ls);
    }
  }

  /* 畢業／重返（僅本人） */
  if(isMe && p.playerStage==="OUTER" && !p.bankrupt){
    var rs=el("div","sec");
    var mult2=E.cfg(S,"returnSalaryMult"); if(mult2===undefined) mult2=0.9;
    var rb2=el("button","act","🔙 重返職場（薪資 "+Math.round(mult2*100)+"%・停走 1 輪・進度保留）");
    rb2.style.width="100%"; rb2.disabled=!canAct;
    rb2.onclick=function(){
      var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="420px";
      bx.appendChild(el("h2",null,"自願重返職場？"));
      bx.appendChild(el("div","flavor","薪資恢復為離職時的 "+Math.round(mult2*100)+"%、夢想維持費停扣、停走 1 輪。夢想進度 "+p.dreamProgress+"／"+S.config.dreamCost+" 會保留。"));
      var oo=el("div","opts");
      oo.appendChild(ui.optBtn("確定重返","先退一步，把引擎修好再來",function(){ ov.remove(); ui.dispatch({type:"RETURN_TO_WORK",playerId:ui.myId(),payload:null}); }));
      oo.appendChild(ui.optBtn(T("act.close"),null,function(){ ov.remove(); }));
      bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
    };
    rs.appendChild(rb2); box.appendChild(rs);
  }
  if(isMe && p.playerStage==="INNER" && p.financiallyFree){
    var gs=el("div","sec"); gs.style.background="rgba(53,196,168,.08)";
    var upk=dream?E.cfg(S,"dreamUpkeepMonthly"):0;
    var proj=util.r2(d.passiveIncome-d.totalExpenses-upk);
    gs.appendChild(el("div","gold","🎉 已財務自由　進外圈後月現金流 "+(proj>=0?"+":"")+M(proj)));
    var gb=el("button","bigbtn","辭職進入自由圈"); gb.style.cssText="width:100%;padding:10px;margin-top:6px;font-size:15px";
    gb.disabled=!canAct;
    gb.onclick=function(){ ui.dispatch({type:"GRADUATE_NOW",playerId:ui.myId(),payload:null}); };
    gs.appendChild(gb); box.appendChild(gs);
  }

  /* 資產細項｜負債細項（行內 賣／還） */
  // S14a（決定 D/E）：資產與負債各自佔滿整欄（右欄整欄用捲的），欄位補到看得懂投資好壞的程度
  var det=el("div","sec"); det.setAttribute("data-tut","detail");     // S20：互動教學錨點
  var dg=el("div");
  var aCol=el("div");
  var aHd=el("div"); aHd.style.cssText="display:flex;align-items:baseline;gap:8px";
  aHd.appendChild(el("h4",null,"資產細項")).style.cssText="margin:0 0 3px;font-size:var(--fs-xs);letter-spacing:.1em;color:var(--tx3)";
  var nonStock=p.assets.filter(function(a){ return a.kind!=="STOCK"; });
  var aCnt=el("span",null,(p.assets.length)+" 筆"); aCnt.style.cssText="margin-left:auto;font-size:11px;color:var(--tx3)";
  aHd.appendChild(aCnt); aCol.appendChild(aHd);
  var at=el("table","dtb ret");
  at.innerHTML='<colgroup><col class="c-nm"><col class="c-n"><col class="c-n">'+
               '<col class="c-y"><col class="c-y"><col class="c-own"><col class="c-op"></colgroup>';
  if(nonStock.length){ var ah=el("tr");
    ["名稱","現值","月現金流","現金報酬","資產報酬","自備／成本",""].forEach(function(hh){ ah.appendChild(el("th",null,hh)); });
    at.appendChild(ah); }
  var hasStockAsset=p.assets.some(function(a){ return a.kind==="STOCK"; });
  if(!nonStock.length && !hasStockAsset) aCol.appendChild(el("div",null,"（無）")).style.cssText="font-size:13px;color:var(--tx3)";
  nonStock.forEach(function(a){
    var tr=el("tr");
    var td1=el("td"); var nmS=el("span",null,a.name); nmS.style.cursor="pointer"; nmS.title="點擊看操作";
    nmS.onclick=function(){ if(a.kind==="P2P_LOAN"){ ui.toast("P2P 債權每輪自動回收本息","warn"); return; } ui.showAsset(a); };
    td1.appendChild(nmS); tr.appendChild(td1);
    tr.appendChild(el("td","num",M(a.marketValue)));
    var td3=el("td","num "+(a.monthlyIncome>=0?"pos":"neg"),(a.monthlyIncome>=0?"+":"")+M(a.monthlyIncome));
    tr.appendChild(td3);
    // S14a：兩種報酬率並列——同一筆資產，槓桿看現金報酬、標的體質看資產報酬
    var rr=E.assetReturns(p,a);
    var fmtY=function(v){ return v===null ? "—" : util.pct(v,1); };
    var clsY=function(v){ return v===null ? "" : (v>=0?"pos":"neg"); };
    tr.appendChild(el("td","num "+clsY(rr.cashYield), fmtY(rr.cashYield)));
    tr.appendChild(el("td","num "+clsY(rr.assetYield), fmtY(rr.assetYield)));
    var tdOwn=el("td","num"); tdOwn.style.fontSize="11px";
    tdOwn.innerHTML=M(rr.ownCash)+"<br><span style='color:var(--tx3)'>"+M(a.costBasis||0)+"</span>";
    tdOwn.title="上：當初拿出來的自備現金　下：取得成本";
    tr.appendChild(tdOwn);
    var td4=el("td");
    if(isMe && a.kind!=="P2P_LOAN"){
      var sb=el("button","mini","賣"); sb.disabled=!canAct;
      sb.onclick=function(){
        var mult=E.sellMult(S,a), est=util.r2(a.marketValue*mult);
        var lk=p.liabilities.filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
        var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="400px";
        bx.appendChild(el("h2",null,"賣出「"+a.name+"」？"));
        bx.appendChild(el("div","flavor","約可得 "+M(est)+(lk?"（將先清償連結貸款 "+M(lk.principal)+"）":"")+"，月現金流 "+(a.monthlyIncome>=0?"−":"+")+M(Math.abs(a.monthlyIncome))+"。"));
        var oo=el("div","opts");
        oo.appendChild(ui.optBtn("確定賣出",null,function(){ ov.remove();
          ui.dispatch({type:"SELL_ASSET",playerId:ui.myId(),payload:{assetId:a.instanceId}}); },true));
        oo.appendChild(ui.optBtn(T("act.close"),null,function(){ ov.remove(); }));
        bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
      };
      td4.appendChild(sb);
    }
    tr.appendChild(td4); at.appendChild(tr);
  });
  // 八期：股票在下方「庫存股票」逐檔操作，這裡補一列合計，避免與「收支與資產明細」不一致
  var stockAssets=p.assets.filter(function(a){ return a.kind==="STOCK"; });
  if(stockAssets.length){
    var sv=0, si=0, su=0;
    stockAssets.forEach(function(a){ sv+=a.marketValue; si+=a.monthlyIncome||0; su+=a.units||0; });
    var str=el("tr");
    var std1=el("td"); var sspan=el("span",null,"📈 股票合計（"+stockAssets.length+" 筆／"+su+" 張）");
    sspan.style.color="var(--tx2)"; std1.appendChild(sspan); str.appendChild(std1);
    str.appendChild(el("td","num",M(util.r2(sv))));
    str.appendChild(el("td","num "+(si>=0?"pos":"neg"),(si>=0?"+":"")+M(util.r2(si))));
    var sOwn=0, sCost=0;
    stockAssets.forEach(function(a){ sOwn+=E.assetOwnCash(p,a); sCost+=(a.costBasis||0); });
    var sYr=util.r2(si*12);
    str.appendChild(el("td","num "+(sYr>=0?"pos":"neg"), sOwn>0?util.pct(sYr/sOwn,1):"—"));
    str.appendChild(el("td","num "+(sYr>=0?"pos":"neg"), sv>0?util.pct(sYr/sv,1):"—"));
    var stdO=el("td","num"); stdO.style.fontSize="11px";
    stdO.innerHTML=M(util.r2(sOwn))+"<br><span style='color:var(--tx3)'>"+M(util.r2(sCost))+"</span>";
    str.appendChild(stdO);
    var std4=el("td"); var sgo=el("span",null,"↓"); sgo.title="逐檔買賣請見下方「庫存股票」";
    sgo.style.cssText="color:var(--tx3);font-size:12px"; std4.appendChild(sgo); str.appendChild(std4);
    at.appendChild(str);
    if(!nonStock.length){ // 只有股票時，先前會顯示「（無）」造成不一致
      var ah2=el("tr"); ["名稱","現值","月現金流","現金報酬","資產報酬","自備／成本",""].forEach(function(hh){ ah2.appendChild(el("th",null,hh)); });
      at.insertBefore(ah2, at.firstChild);
    }
  }
  aCol.appendChild(at);
  if(p.assets.length){
    var anote=el("div",null,"現金報酬 ＝ 年現金流 ÷ 自備現金（看槓桿放大了多少）　·　資產報酬 ＝ 年現金流 ÷ 現值（看標的本身好不好）");
    anote.style.cssText="font-size:10.5px;color:var(--tx3);margin-top:3px;line-height:1.5";
    aCol.appendChild(anote);
  }
  dg.appendChild(aCol);
  var lCol=el("div"); lCol.style.marginTop="10px";
  var lHd=el("div"); lHd.style.cssText="display:flex;align-items:baseline;gap:8px";
  lHd.appendChild(el("h4",null,"負債細項")).style.cssText="margin:0 0 3px;font-size:var(--fs-xs);letter-spacing:.1em;color:var(--tx3)";
  var lCnt=el("span",null,p.liabilities.length+" 筆"); lCnt.style.cssText="margin-left:auto;font-size:11px;color:var(--tx3)";
  lHd.appendChild(lCnt); lCol.appendChild(lHd);
  var lt=el("table","dtb ret");
  lt.innerHTML='<colgroup><col class="c-nm"><col class="c-n"><col class="c-n">'+
               '<col class="c-y"><col class="c-own"><col class="c-op"></colgroup>';
  if(p.liabilities.length){ var lh=el("tr");
    ["名稱","餘額","月付","利率","原始貸款",""].forEach(function(hh){ lh.appendChild(el("th",null,hh)); });
    lt.appendChild(lh); }
  if(!p.liabilities.length) lCol.appendChild(el("div",null,"（無）")).style.cssText="font-size:13px;color:var(--tx3)";
  p.liabilities.forEach(function(l){
    var tr=el("tr");
    var td1=el("td"); var nmL=el("span",null,l.name); nmL.style.cursor="pointer"; nmL.title="點擊看操作";
    nmL.onclick=function(){ ui.showLiability(l); };
    td1.appendChild(nmL); tr.appendChild(td1);
    tr.appendChild(el("td","num neg",M(l.principal)));
    tr.appendChild(el("td","num neg","−"+M(l.monthlyPayment)));
    tr.appendChild(el("td","num",util.pct(l.annualRate,2)+(l.isFloating?"":" 固")));
    tr.appendChild(el("td","num",M(l.originalPrincipal!==undefined?l.originalPrincipal:l.principal)));
    var td4=el("td");
    if(isMe && l.kind!=="P2P"){
      var rbtn=el("button","mini","還"); rbtn.disabled=!canSelf;   // S14a-2：提前還本不必等回合
      rbtn.onclick=function(){ ui.showLiability(l); };
      td4.appendChild(rbtn);
    }
    tr.appendChild(td4); lt.appendChild(tr);
  });
  lCol.appendChild(lt); dg.appendChild(lCol);
  det.appendChild(dg); box.appendChild(det);

  /* 庫存股票（行內買賣） */
  if(S.enabledModules.indexOf("M1")>=0){
    var stx=el("div","sec"); stx.setAttribute("data-tut","holdings"); // S20：互動教學錨點
    var sh=el("div"); sh.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:8px";
    sh.appendChild(el("h4",null,"庫存股票"));
    // S14a：整戶維持率（融資部位市值總和 ÷ 融資餘額總和）——單列維持率仍在最後一欄
    var mvSum=0, mdSum=0;
    p.assets.forEach(function(a){ if(a.kind==="STOCK" && a.flags && a.flags.margin){
      mvSum+=a.marketValue||0;
      var ml=(p.liabilities||[]).filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
      if(ml) mdSum+=ml.principal||0; } });
    if(mdSum>0){
      var whole=mvSum/mdSum, nearW=whole<S.config.marginCallLevel*1.15;
      var wsp=el("span",null,"整戶維持率 "+Math.round(whole*100)+"%");
      wsp.style.cssText="margin-left:auto;font-size:11px;font-family:var(--mono);color:"+(nearW?"var(--neg)":"var(--pos)");
      sh.appendChild(wsp);
    }
    var more=el("span",null,"進階下單（融資）›"); more.style.cssText="color:var(--gold);font-size:10.5px;cursor:pointer";
    if(mdSum<=0) more.style.marginLeft="auto";
    more.onclick=function(){ ui.showStockMarket(); }; sh.appendChild(more);
    stx.appendChild(sh);
    var tb=el("table","dtb stk");
    tb.innerHTML='<colgroup><col class="c-nm"><col class="c-px"><col class="c-px"><col class="c-u">'+
                 '<col class="c-pl"><col class="c-pl"><col class="c-op"><col class="c-mr"></colgroup>';
    var hdr=el("tr");
    ["股票","現價","成本","張","損益","損益%","", "維持率"].forEach(function(hh){ hdr.appendChild(el("th",null,hh)); });
    tb.appendChild(hdr);
    var qtyMap={};   // DOM 存區域 map（§1.9-1）
    ns.content.stockDefs.forEach(function(def){
      var price=E.stockPrice(S,def);
      var cashPos=p.assets.filter(function(a){return a.kind==="STOCK"&&a.symbol===def.symbol&&!(a.flags&&a.flags.margin);})[0];
      // 現股列
      var tr=el("tr");
      var nmTd=el("td"); var nmSpan=el("span",null,E.stockName(S,def.symbol).replace(/（.*）| ETF/,""));
      nmSpan.style.cursor="pointer"; nmSpan.title="點開單檔面板：K 線大圖與買賣";
      nmSpan.onclick=function(ev){ if(ev) ev.stopPropagation(); ui.showStockPanel(def.symbol); };
      nmTd.appendChild(nmSpan); tr.appendChild(nmTd);
      tr.appendChild(el("td","num",M(price)));
      var unitCost = cashPos && cashPos.units>0 ? util.r2(cashPos.costBasis/cashPos.units) : null;
      tr.appendChild(el("td","num", unitCost!==null?M(unitCost):"—"));
      tr.appendChild(el("td","num",cashPos?String(cashPos.units):"0"));
      var plAbs = cashPos ? util.r2(cashPos.marketValue-cashPos.costBasis) : 0;
      tr.appendChild(el("td","num "+(plAbs>=0?"pos":"neg"), cashPos?((plAbs>=0?"+":"")+M(plAbs)):"—"));
      var plPct = cashPos&&cashPos.costBasis>0 ? (cashPos.marketValue-cashPos.costBasis)/cashPos.costBasis : 0;
      tr.appendChild(el("td","num "+(plPct>=0?"pos":"neg"), cashPos?((plPct>=0?"+":"")+util.pct(plPct,1)):"—"));
      var tdOp=el("td");
      if(isMe){
        var q=el("input","qty"); q.type="number"; q.min=1; q.value=1; qtyMap[def.symbol]=q;
        var bb=el("button","mini gold","買"), sb2=el("button","mini","賣"), ab=el("button","mini","全賣");
        bb.disabled=sb2.disabled=ab.disabled=!canAct;
        if(!cashPos){ sb2.disabled=ab.disabled=true; }
        bb.onclick=function(){ var u=Math.max(1,(+q.value|0));
          ui.spendGuard(util.r2(p.cash-price*u), function(){
            ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:def.symbol,side:"buy",units:u,margin:false}}); }); };
        sb2.onclick=function(){ var u=Math.max(1,(+q.value|0));
          ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:def.symbol,side:"sell",units:Math.min(u,cashPos?cashPos.units:0)}}); };
        ab.onclick=function(){ ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:def.symbol,side:"sell",units:cashPos.units}}); };
        tdOp.appendChild(q); tdOp.appendChild(bb); tdOp.appendChild(sb2); tdOp.appendChild(ab);
      } else tdOp.appendChild(el("span","num",cashPos?M(cashPos.marketValue):""));
      tr.appendChild(tdOp);
      tr.appendChild(el("td","num","—"));   // 現股無維持率
      tb.appendChild(tr);
      // 融資部位：各自一列（獨立維持率＋平倉）
      p.assets.filter(function(a){return a.kind==="STOCK"&&a.symbol===def.symbol&&a.flags&&a.flags.margin;})
        .forEach(function(mp){
          var mtr=el("tr");
          mtr.appendChild(el("td",null,"└ 融資"));
          mtr.appendChild(el("td","num",""));
          mtr.appendChild(el("td","num", mp.units>0?M(util.r2(mp.costBasis/mp.units)):""));
          mtr.appendChild(el("td","num",String(mp.units)));
          var mplAbs=util.r2(mp.marketValue-mp.costBasis);
          mtr.appendChild(el("td","num "+(mplAbs>=0?"pos":"neg"),(mplAbs>=0?"+":"")+M(mplAbs)));
          var mpl = mp.costBasis>0 ? (mp.marketValue-mp.costBasis)/mp.costBasis : 0;
          mtr.appendChild(el("td","num "+(mpl>=0?"pos":"neg"),(mpl>=0?"+":"")+util.pct(mpl,1)));
          var mOp=el("td");
          if(isMe){
            var cb=el("button","mini","平倉"); cb.disabled=!canAct;
            cb.onclick=function(){
              var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="400px";
              bx.appendChild(el("h2",null,"融資平倉？"));
              bx.appendChild(el("div","flavor","整筆賣出 "+mp.units+" 張（市值 "+M(mp.marketValue)+"），價金優先清償融資餘額。"));
              var oo=el("div","opts");
              oo.appendChild(ui.optBtn("確定平倉",null,function(){ ov.remove();
                ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:def.symbol,side:"sell",assetId:mp.instanceId}}); },true));
              oo.appendChild(ui.optBtn(T("act.close"),null,function(){ ov.remove(); }));
              bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
            };
            mOp.appendChild(cb);
          } else mOp.appendChild(el("span","num",M(mp.marketValue)));
          mtr.appendChild(mOp);
          var mLoan=p.liabilities.filter(function(l){return l.instanceId===mp.linkedLiabilityId;})[0];
          var mtxt="—";
          if(mLoan && mLoan.principal>0.01){
            var mr=mp.marketValue/mLoan.principal, near=mr<S.config.marginCallLevel*1.15;
            mtxt=Math.round(mr*100)+"%"+(near?"⚠":"");
          }
          mtr.appendChild(el("td","num"+(mtxt.indexOf("⚠")>=0?" neg":""),mtxt));
          tb.appendChild(mtr);
        });
    });
    stx.appendChild(tb); box.appendChild(stx);
  }

  /* 品格已於七期改為數字，併入上方玩家資訊列（幸福感之後） */
};

/* ============================ 中央互動區 ================================ */
// 決策 modal 開關（#center 已是 fixed 全螢幕；空的時候不可蓋住畫面）
ui.modalOn = function(on){ var c=$("center"); c.classList.toggle("on", !!on); };
ui.renderCenter = function(){
  var S=ui.S, c=$("center"), bc=$("boardCenter"), tray=$("bkTray");
  if(ui._autoRollT){ clearInterval(ui._autoRollT); ui._autoRollT=null; }   // 重繪即重置自動骰計時
  c.innerHTML=""; bc.innerHTML=""; ui.modalOn(false);
  tray.classList.add("hide"); tray.innerHTML="";
  if(S.over){ ui.showReport(); return; }
  var p=E.activePlayer(S);

  // S15：先問「現在到底在等誰」。等真人出價／回應時不能寫成「電腦思考中」——
  // 那正是這次 NPC 卡住的表象：畫面說在思考，其實是在等某個人按鈕。
  var wq = E.waitingOnHumans(S);
  if(wq && wq.waiting && wq.waiting.length){
    var KN={AUCTION:"密封出價",REFERRAL:"轉介邀約",JV:"合資邀約",TRADE:"轉讓報價"};
    var wbox=el("div","npcThink");
    var names=wq.waiting.map(function(id){ return (S.players[id]&&S.players[id].name)||("玩家"+id); });
    wbox.appendChild(el("b",null,"⏳ 等待 "+names.join("、")+" 回應"+(KN[wq.kind]?("（"+KN[wq.kind]+"）"):"")));
    if(wq.title) wbox.appendChild(el("div",null,wq.title));
    var mine = wq.waiting.indexOf(ui.myId())>=0;
    wbox.appendChild(el("div",null, mine ? "輪到你回應——按下面的按鈕打開"
                                          : "遊戲會等他們決定後再繼續"));
    if(mine){
      var rb=el("button","opt"); rb.style.marginTop="8px";
      rb.textContent="開啟回應視窗";
      rb.onclick=function(){
        if(wq.kind==="AUCTION" && ui.showBidPanel) ui.showBidPanel(S.pendingAuction);
        else if(wq.kind==="REFERRAL" && ui.showReferralOffer) ui.showReferralOffer(S.pendingReferral);
        else if(wq.kind==="JV" && ui.showJVOffer) ui.showJVOffer(S.pendingJV);
        else if(wq.kind==="TRADE" && ui.showTradeOffer) ui.showTradeOffer(S.pendingTrade);
      };
      wbox.appendChild(rb);
    }
    bc.appendChild(wbox); return;
  }

  // NPC 思考中：留在盤面中央，不擋畫面
  if(p.isNPC){
    var think=el("div","npcThink");
    think.appendChild(el("b",null,p.name+" 思考中…"));
    var per=ns.content.personalityById[p.npcPersonality];
    think.appendChild(el("div",null,per.name+"　現金 "+M(p.cash)+"　被動 "+M(p.derived.passiveIncome)));
    bc.appendChild(think); return;
  }

  // 決策卡／記帳：置中 modal
  if(S.phase==="DECISION" || S.phase==="BANKRUPTCY"){
    // S15d：決策卡的主體必須是決策的擁有者，不是當前回合玩家。
    // 多人局裡決策可能屬於別人（例如 STOCK_GAIN 停利提示在 onRoundEnd 對所有真人發），
    // 沿用當前玩家會讓 carrie 的裝置拿 Brian 的數字在畫她的卡。
    var dOwn = S.pendingDecision;
    var dp = (dOwn && dOwn.playerId!==undefined && dOwn.playerId!==null && S.players[dOwn.playerId])
             ? S.players[dOwn.playerId] : p;
    ui.modalOn(true); ui.decisionCard(S,dp,dOwn); return;
  }
  if(S.phase==="BOOKKEEPING"){ ui.modalOn(true); ui.renderBookkeeping(S,p); return; }

  // 擲骰／結束回合：盤面中央
  if(S.phase==="ROLL"){
    var d=el("div","num"); d.id="dice"; d.textContent="🎲";
    var b=el("button","bigbtn",T("act.roll")); b.onclick=function(){ ui.rollDice(); };
    bc.appendChild(d); bc.appendChild(b);
    // 六期：閒置 3 秒自動擲骰（任何操作會重繪並重新計時；0 = 關閉）
    // 七期：任何視窗開啟時（說明、借款、股市、調參、薪資單⋯⋯）暫停倒數，關閉後重新滿額起算
    var ars=E.cfg(S,"autoRollSec"); if(ars===undefined) ars=3;
    if(ars>0 && !p.isNPC){
      var left=ars;
      var busyUI=function(){
        return ($("overlays")&&$("overlays").children.length>0) ||
               $("center").classList.contains("on") ||
               ($("devpanel")&&$("devpanel").classList.contains("on")) ||
               ui.busy;
      };
      b.textContent=T("act.roll")+(busyUI()?"":"（"+left+"）");
      ui._autoRollT=setInterval(function(){
        if(busyUI()){ left=ars; b.textContent=T("act.roll"); return; }
        left--;
        if(left<=0){ clearInterval(ui._autoRollT); ui._autoRollT=null; ui.rollDice(); }
        else b.textContent=T("act.roll")+"（"+left+"）";
      },1000);
    }
    return;
  }
  if(S.phase==="READY_END"){
    var done=el("div","npcThink");
    done.appendChild(el("b",null,"這回合處理完了"));
    done.appendChild(el("div",null,"可檢視財報或操作部位，然後結束回合"));
    var b2=el("button","bigbtn",T("act.end")); b2.onclick=function(){ ui.dispatch({type:"END_TURN",playerId:ui.myId(),payload:null}); };
    bc.appendChild(done); bc.appendChild(b2); return;
  }
};

function cardFace(card){
  var wrap=el("div");
  wrap.appendChild(el("h3",null,card.title||card.name));
  if(card.scamWarning){
    var me = ui.S && ui.S.players[ui.myId()];
    var hasLaw = me && E.hasSkill && (E.hasSkill(me, "SKL_LAW") || E.hasSkill(me, "SKL_GOV_LEGAL"));
    var hasAudit = me && E.hasSkill && (E.hasSkill(me, "SKL_BOOK") || E.hasSkill(me, "SKL_CPA_AUDIT"));
    if(hasLaw){
      var wL=el("div","scam-warn");
      wL.style.cssText="background:rgba(240,128,60,.18);color:#F0803C;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;margin:6px 0;border:1px solid rgba(240,128,60,.4);";
      wL.textContent="⚠️ 法律審查警訊：境外無主管機關核備，無實質履約保證，跨國追償難度極高！";
      wrap.appendChild(wL);
    }
    if(hasAudit){
      var wA=el("div","scam-audit");
      wA.style.cssText="background:rgba(255,90,95,.2);color:#FF5A5F;padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;margin:6px 0;border:1px solid rgba(255,90,95,.4);";
      wA.textContent="🚨 財務審計警報：交叉比對現金流不足以支撐高額配息，極高機率為後金補前金之龐氏資金盤！";
      wrap.appendChild(wA);
    }
  }
  if(card.flavor) wrap.appendChild(el("div","flavor",card.flavor));
  return wrap;
}
function eduBox(card){ if(card && card.eduNote){ var e=el("div","edu",card.eduNote); return e; } return null; }
// S13.1 §3：轉介／合資的「被邀請方」以前只看得到標題與一句話，
// 要判斷接不接受卻沒有數字。這裡把買方看得到的同一份數據攤開。
// share：只出一部分（合資）時，用來把入手與現金流按比例縮放；不傳＝全額。
ui.oppFacts = function(S, card, viewer, share){
  var k = (share===undefined || share===null) ? 1 : share;
  var c = E.oppCompare(S, card, viewer);
  var pl = card.payload||{};
  var wrap = el("div","sec"); wrap.style.marginTop="8px";
  var t = el("table","dtb");
  function row(label, val, cls){
    var tr=el("tr");
    tr.appendChild(el("td",null,label)).style.color="var(--tx3)";
    tr.appendChild(el("td","num"+(cls?" "+cls:""), val));
    t.appendChild(tr);
  }
  var KIND={REALESTATE:"不動產",BUSINESS:"事業",STOCK:"股票",STARTUP:"新創"};
  row("類型", KIND[card.kind]||card.kind);
  if(pl.price!==undefined) row("標的總價", M(util.r2(pl.price*k)));
  if(pl.monthlyRent!==undefined) row("月租金（毛）", M(util.r2(pl.monthlyRent*k)));
  if(pl.monthlyCost) row("每月管理維護", "−"+M(util.r2(pl.monthlyCost*k)));
  if(pl.monthlyProfit!==undefined) row("月營業利潤", M(util.r2(pl.monthlyProfit*k)));
  if(pl.investAmount!==undefined) row("投資金額", M(util.r2(pl.investAmount*k)));
  if(pl.equityPct!==undefined) row("取得股權", Math.round(pl.equityPct*100*k)+"%");
  row("你要拿出的現金", M(util.r2(c.entry*k)), "neg");
  row("月現金流（已扣貸款月付）", (c.income>=0?"+":"")+M(util.r2(c.income*k)), c.income>=0?"pos":"neg");
  row("年化現金報酬率", util.pct(c.yield,1), c.yield>=0?"pos":"neg");
  if(c.note) row("備註", c.note);
  if(c.disclosed){
    row("風險調整後月現金流", (c.netIncome>=0?"+":"")+M(util.r2(c.netIncome*k)), c.netIncome>=0?"pos":"neg");
    row("風險調整後年化", util.pct(c.netYield,1), c.netYield>=0?"pos":"neg");
  }
  wrap.appendChild(t);
  if(c.disclosed && c.riskNote)
    wrap.appendChild(el("div","flavor","📖 記帳技能揭露："+c.riskNote));
  else
    wrap.appendChild(el("div","flavor","以上為帳面數字。空租、修繕與景氣波動不在裡面——有「看懂財報」的技能才看得到風險調整後的版本。"));
  return wrap;
};
function optBtn(label, sub, fn, rec){
  var b=el("button","opt"+(rec?" rec":"")); b.appendChild(el("div",null,label));
  if(sub){ var s=el("small",null,sub); b.appendChild(s); } b.onclick=fn; return b;
}
ui.optBtn = optBtn;
// 低現金破產風險警告：若此花費後現金低於一個月開銷，先跳警告再讓玩家決定
ui.spendGuard = function(cashAfter, onProceed){
  var S=ui.S, p=S.players[ui.myId()], buffer=p.derived.totalExpenses||0;
  // 防禦：算不出有效數字時不得把 NaN 端到玩家面前，直接放行並記錄（鐵律一）
  if(typeof cashAfter!=="number" || !isFinite(cashAfter)){
    if(window&&window.console) console.warn("spendGuard: cashAfter 非有限數,已略過警告", cashAfter);
    onProceed(); return;
  }
  if(cashAfter>=buffer || cashAfter<0){ onProceed(); return; } // 足夠緩衝、或本就會被前置擋下→直接進行
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,"⚠ 現金水位偏低"));
  var msg=el("div","flavor");
  msg.innerHTML="此操作後現金只剩 <b class='num neg'>"+M(cashAfter)+"</b>，低於一個月開銷（"+M(buffer)+"）。<br>"+
    "萬一接著遇到失業、重大支出或利率上升，可能繳不出貸款月付而破產。留一點緊急預備金比較安全。";
  box.appendChild(msg);
  var o=el("div","opts");
  o.appendChild(optBtn("我了解風險，仍要進行",null,function(){ ov.remove(); onProceed(); }));
  o.appendChild(optBtn("取消","保留現金比較安全",function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};
// 融資開倉警告：說明槓桿風險與斷頭規則，確認後才下單
ui.marginGuard = function(def, onProceed){
  var S=ui.S;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="460px";
  box.appendChild(el("h2",null,"⚠ 融資＝借錢投資，風險會放大"));
  var kv=el("div","kv");
  kv.innerHTML="<div class='k'>此標的波動度</div><div class='v num'>"+util.pct(def.vol,1)+"／輪</div>"+
    "<div class='k'>自備比例</div><div class='v num'>"+util.pct(S.config.marginRatio,0)+"（其餘向券商融資）</div>"+
    "<div class='k'>斷頭維持率</div><div class='v num neg'>"+Math.round(S.config.marginCallLevel*100)+"%（市值÷融資餘額）</div>";
  box.appendChild(kv);
  box.appendChild(el("div","flavor","股價下跌時，維持率跌破 "+Math.round(S.config.marginCallLevel*100)+
    "% 會收到追繳通知；一輪內未補繳保證金或減倉，券商將強制賣出、虧損立刻實現。槓桿讓漲跌都放大——確定要用融資？"));
  var o=el("div","opts");
  o.appendChild(optBtn("我了解風險，用融資買進",null,function(){ ov.remove(); onProceed(); }));
  o.appendChild(optBtn("取消","改用現股比較穩",function(){ ov.remove(); },true));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};
// 融資追繳通知：跌破維持率，選擇補繳或自行處理（一輪寬限）
ui.showMarginWarning = function(e){
  var S=ui.S, p=S.players[e.playerId]; if(!p||p.isNPC) return;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="480px";
  box.appendChild(el("h2",null,"🔔 融資追繳通知（Margin Call）"));
  var kv=el("div","kv");
  kv.innerHTML="<div class='k'>部位</div><div class='v'>"+e.name+"</div>"+
    "<div class='k'>市值</div><div class='v num'>"+M(e.marketValue)+"</div>"+
    "<div class='k'>融資餘額</div><div class='v num'>"+M(e.principal)+"</div>"+
    "<div class='k'>目前維持率</div><div class='v num neg'>"+Math.round(e.ratio*100)+"%（低於 "+Math.round(S.config.marginCallLevel*100)+"%）</div>"+
    "<div class='k'>補繳金額</div><div class='v num'>"+M(e.needed)+"（回補到 "+Math.round((S.config.marginRestoreLevel||1.66)*100)+"%）</div>";
  box.appendChild(kv);
  box.appendChild(el("div","flavor","券商通知：請於下一輪結算前補繳保證金（償還部分融資）或自行賣出減倉；否則將被強制斷頭平倉、虧損實現。"));
  var o=el("div","opts");
  var afford = p.cash >= e.needed;
  var bTop=optBtn("立即補繳 "+M(e.needed), afford?"償還部分融資，維持率回到安全區":"現金不足（你有 "+M(p.cash)+"）",
    function(){ if(!afford){ ui.toast("現金不足，考慮賣出部分持股","warn"); return; }
      ov.remove(); ui.dispatch({type:"TOP_UP_MARGIN",playerId:e.playerId,payload:{liabilityId:e.liabilityId}}); }, afford);
  if(!afford){ bTop.style.opacity=".55"; }
  o.appendChild(bTop);
  o.appendChild(optBtn("先不補","我會自行減倉；下輪結算前未處理將被強制平倉",function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};
// 斷頭教室：任何玩家被強制平倉時，全體都看到完整過程（教學）
ui.showMarginCallLesson = function(e){
  var S=ui.S, who=(e.playerId===ui.myId()?"你":(S.players[e.playerId]?S.players[e.playerId].name:"某玩家"));
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="500px";
  box.appendChild(el("h2",null,"💥 斷頭教室："+who+"的「"+e.name+"」被強制平倉"));
  var steps=el("div"); steps.style.cssText="display:flex;flex-direction:column;gap:7px;margin:8px 0";
  [["①","用融資買進：自備一半、向券商借 "+M(e.principal)+"（成本 "+M(e.costBasis)+"）"],
   ["②","股價下跌，市值只剩 "+M(e.marketValue)],
   ["③","維持率＝市值÷融資餘額＝ "+Math.round(e.ratio*100)+"%，跌破斷頭線 "+Math.round(S.config.marginCallLevel*100)+"%"],
   ["④","追繳通知後未補足保證金"],
   ["⑤","券商強制賣出，價金優先清償融資，實現虧損 "+M(Math.abs(e.loss))]
  ].forEach(function(s){ var r=el("div"); r.style.cssText="display:flex;gap:8px;font-size:13px";
    r.appendChild(el("b",null,s[0])); r.appendChild(el("span",null,s[1])); steps.appendChild(r); });
  box.appendChild(steps);
  box.appendChild(el("div","flavor","💡 槓桿讓虧損加倍：自備一半時，股價跌 20%＝本金虧 40%。用融資務必控制部位大小、預留補繳現金，別讓市場替你決定出場時間。"));
  var o=el("div","opts"); o.appendChild(optBtn("我知道了",null,function(){ ov.remove(); },true));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};
// M8 S1：學習相關事件的即時提示
ui.handleSkillEvents = function(evs){
  (evs||[]).forEach(function(e){
    if(e.type==="SKILL_STARTED" && e.playerId===ui.myId())
      ui.toast("📚 開始學習「"+e.title+"」，"+(e.endTurn-ui.S.turnNumber)+" 輪後學成","info");
    else if(e.type==="SKILL_COMPLETED")
      ui.toast((e.playerId===ui.myId()?"🎓 你學會了「":"🎓 "+(ui.S.players[e.playerId]||{}).name+" 學會了「")+e.title+"」","pos",3200);
    else if(e.type==="SKILL_ABANDONED" && e.playerId===ui.myId())
      ui.toast("放棄「"+e.title+"」，沉沒成本 "+M(e.sunk),"warn");
  });
};

// 把選項說明中的「金錢情境」數字（千元）轉成元顯示，避開 ×倍數、回合數、品格值
ui.yuanizeSub = function(sub){
  if(!sub) return sub;
  return sub.replace(/(投入|每月支出|花費|支出|收|需|花)\s*([+-]?\d+)/g, function(m, pre, num){
    var sign = num.charAt(0)==="+" ? "+" : "";
    return pre+" "+sign+M(parseInt(num,10));
  });
};

/* 六期：把 DSL 效果翻成白話，附在選項下——卡面沒講清楚的，按鈕講清楚 */
ui.effectSummary = function(effects){
  if(!effects || !effects.length) return "";
  var out=[];
  effects.forEach(function(ef){
    var who = ef.target==="all"?"全體 ":(ef.target==="others"?"其他玩家 ":"");
    switch(ef.op){
      case "CASH_DELTA": out.push(who+"現金 "+(ef.amount>=0?"+":"−")+M(Math.abs(ef.amount))); break;
      case "ADD_RECURRING_EXPENSE": out.push(who+"每月支出 +"+M(ef.amount)+(ef.durationTurns?"（"+ef.durationTurns+" 輪）":"（永久）")); break;
      case "SALARY_MULT": { var pc=Math.round((ef.factor-1)*100);
        out.push(who+"薪資 "+(pc>=0?"+":"")+pc+"%"); break; }
      case "ASSET_VALUE_MULT": out.push((ef.filter&&ef.filter.kind?({REALESTATE:"房產",STOCK:"股票",BUSINESS:"事業",STARTUP:"新創"}[ef.filter.kind]||"資產"):"資產")+"估值 ×"+ef.factor); break;
      case "ASSET_INCOME_MULT": out.push((ef.filter&&ef.filter.kind?({REALESTATE:"租金",BUSINESS:"分紅"}[ef.filter.kind]||"資產收入"):"資產收入")+" ×"+ef.factor+(ef.durationTurns?"（"+ef.durationTurns+" 輪）":"")); break;
      case "SKIP_TURNS": out.push("停走 "+(ef.turns||1)+" 回合"); break;
      case "ADD_CHILD": out.push("家庭新成員（每月養育支出增加）"); break;
      case "GRANT_VIRTUE": out.push("品格 +"+(ef.amount||1)); break;
      case "GRANT_JOY": out.push("幸福感 +"+(ef.amount||1)); break;
      case "DIVIDEND_BONUS": out.push("配息加發 ×"+ef.mult+(ef.durationTurns?"（"+ef.durationTurns+" 輪）":"")); break;
      case "STOCK_PRICE_SET": out.push("股價變動"); break;
      case "GRANT_SKILL": { var gs=ns.content.byId[ef.skillId];
        out.push("直接取得技能：「"+(gs?gs.title:ef.skillId)+"」"); break; }
      case "DECAY_SKILL": { var ds=ef.skillId?ns.content.byId[ef.skillId]:null;
        out.push((ds?("「"+ds.title+"」"):"相關技能")+"即將過時（需進修更新）"); break; }
      case "DELAY_LEARNING": out.push("學習進度延後 "+(ef.turns===undefined?1:ef.turns)+" 輪"); break;
    }
  });
  return out.join("、");
};
ui.optSub = function(op){   // 內容 sub＋自動效果摘要（避免重複：sub 已含金額者仍附一行完整效果）
  var base = ui.yuanizeSub(op.sub)||"";
  var es = ui.effectSummary(op.effects);
  if(!es) return base;
  return base ? base+"　▸ "+es : "▸ "+es;
};

ui.decisionCard = function(S,p,d){
  var c=$("center"), card=el("div","card"), decId=d.decisionId;
  function decide(optionId, params){ ui.dispatch({type:"DECIDE",playerId:ui.myId(),payload:{decisionId:decId,optionId:optionId,params:params||{}}}); }

  // 每張決策卡都要看得到現金——不知道自己有多少錢，就沒辦法判斷這筆該不該買。
  // PICK_OPP / CHOOSE_DECK 自己已有更完整的現金說明，不重複顯示。
  if(d.kind!=="PICK_OPP" && d.kind!=="CHOOSE_DECK"){
    var dv=p.derived;
    var bar=el("div"); bar.className="cashbar";
    bar.innerHTML = "💰 現金 <b class='num'>"+M(p.cash)+"</b>"
      + "　月結餘 <b class='num "+(dv.netCashflow>=0?"pos":"neg")+"'>"
      + (dv.netCashflow>=0?"+":"")+M(dv.netCashflow)+"</b>"
      + "　每月支出 <b class='num'>"+M(dv.totalExpenses)+"</b>";
    card.appendChild(bar);
  }

  // 獨立董事審計預警與請辭抉擇
  if(d.kind==="RESIGN_DIRECTORSHIP"){
    card.appendChild(el("h3",null,d.title||"⚠️ 審計警訊：假帳弊案即將爆發！"));
    card.appendChild(el("div","flavor",d.text||"查核本季財務報告發現異常關係人鉅額借貸且憑證不全，公司即將爆發弊案！"));
    var oR=el("div","opts");
    oR.appendChild(optBtn("💡 立即請辭獨立董事","及時停損，免除後續民事連帶賠償與官司",function(){ decide("resign"); },true));
    oR.appendChild(optBtn("⚠️ 抱持僥倖，繼續留任","繼續領取本期車馬費，但下輪 100% 承受弊案賠償與停走",function(){ decide("stay"); },false));
    card.appendChild(oR); c.appendChild(card); return;
  }

  // V3：商城比賽——親自擲骰
  if(d.kind==="CONTEST_ROLL"){
    var itc=ns.content.byId[d.itemId], plc=(itc&&itc.payload)||{};
    card.appendChild(el("h3",null,"🎲 "+(itc?itc.title:"比賽")+"——換你上場！"));
    card.appendChild(el("div","flavor","報名費已繳，成績看你的骰子。擲出越大點數，名次越好。"));
    if(plc.contest){
      var kvC=el("div","kv");
      plc.contest.forEach(function(t){
        kvC.appendChild(el("div","k","擲出 ≥ "+t.min+" 點"));
        kvC.appendChild(el("div","v num"+(t.prize>0?" pos":""), t.label+(t.prize>0?("　+"+M(t.prize)):"")));
      });
      card.appendChild(kvC);
    }
    var oC=el("div","opts");
    var bRoll=el("button","bigbtn","🎲 擲骰！");
    bRoll.onclick=function(){
      bRoll.disabled=true;
      var faces=["⚀","⚁","⚂","⚃","⚄","⚅"], k=0;
      var spin=setInterval(function(){ bRoll.textContent=faces[(k++)%6]+" 骰動中…"; }, 80);
      setTimeout(function(){ clearInterval(spin); decide("roll"); }, 520);   // V4：0.5 秒動畫後才開結果
    };
    oC.appendChild(bRoll);
    card.appendChild(oC); c.appendChild(card); return;
  }

  // V10：帳上獲利提示——停利／減碼／續抱
  if(d.kind==="STOCK_GAIN"){
    var ga=p.assets.filter(function(x){return x.instanceId===d.assetId;})[0];
    if(!ga){ decide("hold"); return; }
    var gain=util.r2(ga.marketValue-ga.costBasis);
    card.appendChild(el("h3",null,"📈 帳上獲利 +"+Math.round(d.gain)+"%"));
    card.appendChild(el("div","flavor","「"+ga.name+"」的市值已經是成本的 "+util.r2(ga.marketValue/ga.costBasis)+" 倍。"));
    var kv=el("div","kv");
    function r(k,v,c){ kv.appendChild(el("div","k",k)); kv.appendChild(el("div","v num"+(c?" "+c:""),v)); }
    r("持有","× "+ga.units+" 張");
    r("成本",M(ga.costBasis));
    r("市值",M(ga.marketValue),"pos");
    r("未實現損益","+"+M(gain),"pos");
    card.appendChild(kv);
    card.appendChild(el("div","flavor","帳上的獲利不是你的錢，賣掉才是。但賣太早也可能錯過後面的漲幅——"+
      "重點不是猜高點，而是<b>事先想好在什麼條件下要下車</b>。"));
    var o=el("div","opts");
    o.appendChild(optBtn("全部停利（賣出 "+ga.units+" 張）","把帳上獲利變成現金",function(){ decide("sell_all"); },true));
    if(!ga.linkedLiabilityId && ga.units>1)
      o.appendChild(optBtn("賣一半，留一半","先取回本金，讓剩下的續抱",function(){ decide("sell_half"); }));
    o.appendChild(optBtn("繼續持有","看好後續，願意承受回檔",function(){ decide("hold"); }));
    card.appendChild(o); c.appendChild(card); return;
  }

  if(d.kind==="CHOOSE_DECK"){
    card.appendChild(el("h3",null,T("deck.pick")));
    // 估算各牌堆的「最低進場自備」範圍，避免進去才發現買不起
    function deckEntry(deckId){
      var cards=(ns.content.cards[deckId]||[]).filter(function(cc){ return E.cardUsable(S,p,cc); });
      var mins=[]; 
      cards.forEach(function(cc){ var pl=cc.payload||{}, need;
        if(cc.kind==="REALESTATE"){ var ltv=Math.min(1-(pl.downPayment/pl.price), E.effMaxLTV(S)); need=util.r2(pl.price*(1-ltv)); }
        else if(cc.kind==="STOCK"){ need=S.stockPrices[pl.symbol]||pl.offerPrice; }
        else if(cc.kind==="BUSINESS"){ need=Math.max(0, pl.price-(E.canUseLoan(S)?E.creditCapacity(S,p):0)); }
        else if(cc.kind==="STARTUP"){ need=pl.investAmount; }
        else return;
        mins.push(need); });
      if(!mins.length) return null;
      mins.sort(function(a,b){return a-b;});
      return {min:mins[0], max:mins[mins.length-1]};
    }
    var eS=deckEntry("OPPORTUNITY_SMALL"), eL=deckEntry("OPPORTUNITY_LARGE");
    var cashLine=el("div","flavor");
    cashLine.innerHTML="你的現金 <b style='color:#FF8A8E;font-size:1.15em;font-weight:800'>"+M(p.cash)+"</b>　（下列為最低自備門檻，含可用貸款／信貸後的自備額）";
    card.appendChild(cashLine);
    var o=el("div","opts");
    var subS=T("deck.small.d")+(eS?"　｜自備門檻約 "+M(eS.min)+"–"+M(eS.max):"");
    var subL=T("deck.large.d")+(eL?"　｜自備門檻約 "+M(eL.min)+"–"+M(eL.max)+(eL.min>p.cash?"（可能買不起，需先累積）":""):"");
    o.appendChild(optBtn(T("deck.small"), subS, function(){ ui.dispatch({type:"CHOOSE_DECK",playerId:ui.myId(),payload:{deckId:"OPPORTUNITY_SMALL"}}); }, !eS||eS.min<=p.cash));
    o.appendChild(optBtn(T("deck.large"), subL, function(){ ui.dispatch({type:"CHOOSE_DECK",playerId:ui.myId(),payload:{deckId:"OPPORTUNITY_LARGE"}}); }));
    // 第三扇門：特殊機會——有人脈才打得開，沒有的話只看得到一個問號
    if(E.cfg(S,"specialOppEnabled")){
      if(E.hasNetwork(S,p)){
        var eP=deckEntry("OPPORTUNITY_SPECIAL");
        var subP="別人不會看到的案子——同學、學長、教授手上的機會"
                 +(eP?"　｜自備門檻約 "+M(eP.min)+"–"+M(eP.max):"");
        o.appendChild(optBtn("🎓 特殊機會（人脈）", subP,
          function(){ ui.dispatch({type:"CHOOSE_DECK",playerId:ui.myId(),payload:{deckId:"OPPORTUNITY_SPECIAL"}}); },
          !eP||eP.min<=p.cash));
      } else {
        // S10：原本整顆按鈕 opacity 0.45，看起來像壞掉的列。
        // 改成保留金色虛線框、問號放大——「你還打不開」跟「這裡沒東西」是兩回事。
        var lockBtn=optBtn("","",function(){},false);
        lockBtn.className="opt locked";
        lockBtn.disabled=true;
        lockBtn.title="這扇門你還打不開——去修 EMBA 或海外留學就會亮起來";
        lockBtn.innerHTML="";
        lockBtn.appendChild(el("span","qm","❓ ？ ？ ？"));
        lockBtn.appendChild(el("small",null,"有些機會不是靠錢，是靠你認識誰。修 EMBA 或海外留學就能打開這扇門。"));
        o.appendChild(lockBtn);
      }
    }
    o.appendChild(optBtn("這次先不抽","現金太緊或想守成時，跳過也是策略",function(){ ui.dispatch({type:"CHOOSE_DECK",playerId:ui.myId(),payload:{deckId:"NONE"}}); }));
    card.appendChild(o); c.appendChild(card); return;
  }

  // §2.4 幸福感盲盒：蓋牌 →「打開」→ 揭曉
  if(d.kind==="BLESSING"){
    var PZ={ VIRTUE:{ico:"🌱",name:T("bless.VIRTUE")}, DREAM:{ico:"✨",name:T("bless.DREAM")},
             GUARDIAN:{ico:"🤝",name:T("bless.GUARDIAN")}, JOY:{ico:"🍰",name:T("bless.JOY")},
             CASH:{ico:"🧧",name:T("bless.CASH")}, NONE:{ico:"🎁",name:"—"} };
    var VN={TEMPER:T("virtue.TEMPER"),PRUDENCE:T("virtue.PRUDENCE"),PARENTING:T("virtue.PARENTING"),FILIAL:T("virtue.FILIAL")};
    card.appendChild(el("h3",null,"🎁 "+T("bless.title")));
    card.appendChild(el("div","flavor",T("bless.sub")+"　你的幸福感 ♥ "+(d.wellbeing||E.wellbeing(S,p))));
    var stage=el("div"); stage.style.cssText="text-align:center;padding:14px 0";
    var boxIco=el("div"); boxIco.style.cssText="font-size:52px;line-height:1.1"; boxIco.textContent="🎁";
    stage.appendChild(boxIco);
    var revealTxt=el("div"); revealTxt.style.cssText="margin-top:8px;font-size:14px;color:var(--tx2)";
    revealTxt.textContent="裡面是什麼？";
    stage.appendChild(revealTxt);
    card.appendChild(stage);
    var oB=el("div","opts");
    var opened=false;
    var openBtn=el("button","opt"); openBtn.textContent=T("bless.open");
    var ackBtn=optBtn("我知道了",null,function(){ decide("ok"); },true);
    ackBtn.style.display="none";
    openBtn.onclick=function(){
      if(opened) return; opened=true;
      var pz=PZ[d.prize]||PZ.NONE;
      boxIco.textContent=pz.ico;
      var det=d.detail||"";
      if(d.prize==="VIRTUE" && VN[det]) det=VN[det]+" +1";
      if(d.prize==="CASH") det="現金 +"+det;
      revealTxt.innerHTML="<b style=\'color:var(--gold);font-size:16px\'>"+pz.name+"</b><br>"+det;
      openBtn.style.display="none"; ackBtn.style.display="";
      var eduB=el("div","edu",T("bless.edu")); card.insertBefore(eduB, oB);
    };
    oB.appendChild(openBtn); oB.appendChild(ackBtn);
    card.appendChild(oB); c.appendChild(card); return;
  }

  // §2.3 機會二選一：兩欄並排比較
  if(d.kind==="PICK_OPP"){
    card.className+=" wide";
    card.appendChild(el("h3",null,"兩個機會，選一個"));
    var cashLine2=el("div","flavor");
    cashLine2.innerHTML="真實投資是「比較兩個 deal」：看報酬率、看進場門檻、也看風險屬性。你的現金 <b style='color:#FF8A8E;font-size:1.15em;font-weight:800'>"+M(p.cash)+"</b>　（沒選的那張直接進棄牌堆）";
    card.appendChild(cashLine2);
    var grid=el("div","pickGrid");
    var KIND={REALESTATE:"不動產",STOCK:"股票",BUSINESS:"事業",STARTUP:"新創股權"};
    (d.cardIds||[]).forEach(function(id){
      var cc=ns.content.byId[id]; if(!cc) return;
      var col=el("div"); col.style.cssText="border:1px solid var(--line);"+
        "border-radius:var(--r);padding:10px;background:var(--panel2);display:flex;flex-direction:column;gap:6px;min-width:0";
      var ttl=el("div"); ttl.style.cssText="font-weight:700;font-size:14px";
      ttl.textContent=cc.title; col.appendChild(ttl);
      var tag=el("div"); tag.style.cssText="font-size:11px;color:var(--tx3);letter-spacing:.1em";
      tag.textContent=(KIND[cc.kind]||cc.kind)+(cc.payload&&cc.payload.volatileProfit?"・獲利波動":"");
      col.appendChild(tag);
      var fv=cc.flavor||cc.eduNote||"";
      if(fv){ var fvd=el("div","flavor",String(fv).split("。")[0]+"。"); fvd.style.margin="0"; col.appendChild(fvd); }
      var cmp=E.oppCompare(S,cc,p), ent=cmp.entry, inc=cmp.income, yld=cmp.yield;
      var kv=el("div","kv");
      kv.appendChild(el("div","k","買入門檻（自備）")); kv.appendChild(el("div","v num"+(ent>p.cash?" neg":""),M(ent)));
      kv.appendChild(el("div","k","月現金流")); kv.appendChild(el("div","v num"+(inc>0?" pos":(inc<0?" neg":"")),(inc>0?"+":"")+M(inc)));
      kv.appendChild(el("div","k","年化現金報酬率")); kv.appendChild(el("div","v num"+(yld>0?" pos":(yld<0?" neg":"")),util.pct(yld,1)));
      col.appendChild(kv);
      if(cmp.disclosed){
        kv.appendChild(el("div","k","風險調整後月現金流"));
        kv.appendChild(el("div","v num"+(cmp.netIncome>0?" pos":(cmp.netIncome<0?" neg":"")),
                          (cmp.netIncome>0?"+":"")+M(cmp.netIncome)));
        kv.appendChild(el("div","k","風險調整後年化"));
        kv.appendChild(el("div","v num"+(cmp.netYield>0?" pos":(cmp.netYield<0?" neg":"")),
                          util.pct(cmp.netYield,1)));
      }
      if(cmp.note){ var nt=el("div","flavor",cmp.note); nt.style.cssText="margin:0;font-size:10.5px;color:var(--tx3)"; col.appendChild(nt); }
      if(cmp.disclosed && cmp.riskNote){
        var rn=el("div","flavor","📒 看得懂帳的人才會注意到："+cmp.riskNote);
        rn.style.cssText="margin:0;font-size:10.5px;color:var(--gold)"; col.appendChild(rn); }
      var b=el("button","opt"); b.textContent="選這個";
      if(ent>p.cash){ var warn=el("div","flavor","現金不足入手門檻，可能只能貸款或跳過"); warn.style.margin="0"; col.appendChild(warn); }
      (function(cid){ b.onclick=function(){ decide(cid); }; })(id);
      col.appendChild(b);
      grid.appendChild(col);
    });
    card.appendChild(grid);
    var o0=el("div","opts");
    o0.appendChild(optBtn("兩個都不要","兩張都進棄牌堆，這一格什麼都不做",function(){ decide("none"); }));
    card.appendChild(o0);
    c.appendChild(card); return;
  }

  if(d.kind==="START_DIGITAL"){
    var dgc=ns.content.byId[d.cardId], pdg=(dgc&&dgc.payload)||{};
    card.appendChild(cardFace(dgc)); var ebD=eduBox(dgc); if(ebD) card.appendChild(ebD);
    var kvD=el("div","kv");
    kvD.appendChild(el("div","k","建置成本")); kvD.appendChild(el("div","v num neg","−"+M(pdg.cost||0)));
    if(pdg.monthlyCost){ kvD.appendChild(el("div","k","每月維護")); kvD.appendChild(el("div","v num neg","−"+M(pdg.monthlyCost))); }
    var odD=E.digitalOdds(S,p,dgc);
    kvD.appendChild(el("div","k","要投入幾輪才會有結果"));
    kvD.appendChild(el("div","v num",odD.threshold+" 輪（要連續顧）"));
    kvD.appendChild(el("div","k","做起來的話，每月大約"));
    kvD.appendChild(el("div","v num pos","+"+M(pdg.baseIncome||0)+" 上下"));
    card.appendChild(kvD);
    // S9：像理賠明細那樣，把「有沒有這門手藝」的差別攤開來給玩家看
    var skD = dgc.requires ? ns.content.byId[dgc.requires] : null;
    var skN = skD ? skD.title : "這門手藝";
    var cmpD=el("div","claimBox");
    cmpD.appendChild(el("div","ttl", odD.pro
      ? "✅ 你會「"+skN+"」——這是你的本行"
      : "⚠️ 你不會「"+skN+"」——外行人也做得起來，只是難得多"));
    var tbl=el("div","kv");
    tbl.appendChild(el("div","k","爬坡輪數"));
    tbl.appendChild(el("div","v num", odD.pro
      ? odD.proThreshold+" 輪（外行人要 "+odD.amateurThreshold+" 輪）"
      : odD.amateurThreshold+" 輪（本行只要 "+odD.proThreshold+" 輪）"));
    tbl.appendChild(el("div","k","爆紅機率"));
    tbl.appendChild(el("div","v num", odD.pro
      ? util.pct(odD.proHit,0)+"（外行人只有 "+util.pct(odD.amateurHit,0)+"）"
      : util.pct(odD.amateurHit,0)+"（本行有 "+util.pct(odD.proHit,0)+"）"));
    tbl.appendChild(el("div","k","做白工機率"));
    tbl.appendChild(el("div","v num", odD.pro
      ? util.pct(odD.proFlop,0)+"（外行人 "+util.pct(odD.amateurFlop,0)+"）"
      : util.pct(odD.amateurFlop,0)+"（本行 "+util.pct(odD.proFlop,0)+"）"));
    cmpD.appendChild(tbl);
    card.appendChild(cmpD);
    card.appendChild(el("div","flavor",
      "<b class='gold'>做得起來不保證，做多大更不保證</b>——但不投入就一定不會有。"+
      "投入期間不能同時進修（時間只有一份），停下來的內容會開始掉。"));
    var oD=el("div","opts");
    var costD=util.r2(pdg.cost||0);
    var poorD = p.cash<costD;
    if(!p.learning && !poorD){
      oD.appendChild(optBtn("開始經營","投入 "+M(costD)+"，之後每輪要花時間顧",function(){ decide("start"); }, true));
    } else if(p.learning && !poorD){
      // S13：正在進修時不再只是「做不了」。技能隨時可以重修，這張卡錯過就沒了——
      // 但學費不退、進度歸零，代價要當著玩家的面講清楚。
      var lcD=ns.content.byId[p.learning.skillId];
      var pctD=E.cfg(S,"abandonRefundPct"); if(pctD===undefined) pctD=0.3;
      var paidD=p.learning.paidCost||0;
      var backD=util.r2(paidD*pctD), sunkD=util.r2(paidD-backD);
      var goneD=S.turnNumber-p.learning.startTurn;
      oD.appendChild(optBtn("放棄進修，接這個",
        "中斷「"+(lcD?lcD.title:"目前的課")+"」（已投入 "+goneD+" 輪、學費 "+M(paidD)+
        "，退回 "+M(backD)+"、沉沒 "+M(sunkD)+"），再投入 "+M(costD)+" 開始經營",
        function(){ decide("dropStudy"); }));
      oD.appendChild(el("div","edu",
        "技能隨時可以重修，這張卡錯過就沒了——但沉沒的學費不會回來。"+
        "「該不該停損既有投入去換更好的機會」，本身就是一道題。"));
    } else {
      var dbD=optBtn("開始經營","",function(){},false); dbD.disabled=true; dbD.title="現金不足";
      oD.appendChild(dbD); oD.appendChild(el("div","flavor","現金不足（需 "+M(costD)+"）"));
    }
    oD.appendChild(optBtn("這次先不做","把時間留給別的事",function(){ decide("skip"); }));
    card.appendChild(oD); c.appendChild(card); return;
  }

  if(d.kind==="DIGITAL_RESULT"){
    var dgR=(p.digitalAssets||[]).filter(function(x){ return x.id===d.digitalId; })[0];
    var TIER={FLOP:{t:"做起來了，但只有一點點",e:"🌱",n:"有人看，但沒有很多人。這不是失敗，是大多數內容的樣子。"},
              OK:{t:"穩穩地跑起來了",e:"📈",n:"不會讓你一夜致富，但它每個月都會出現在你的帳上。"},
              HIT:{t:"爆了",e:"🚀",n:"演算法選中了你。享受它，但別把它當成常態——下一個不一定會這樣。"}};
    var tR=TIER[d.tier]||TIER.OK;
    card.appendChild(el("h3",null,tR.e+" "+tR.t));
    if(dgR && dgR.pro===false && d.tier==="HIT")
      card.appendChild(el("div","edu","你不是這行出身，卻紅了——這種事會發生，但別把它當成可以複製的策略。"));
    if(dgR && dgR.pro===false && d.tier==="FLOP")
      card.appendChild(el("div","edu","外行人做白工的機率本來就高得多。這不是你不夠努力，是你在跟本來就會的人搶同一批觀眾。"));
    card.appendChild(el("div","flavor","「"+(dgR?dgR.name:"你的內容")+"」累積到門檻了，結果揭曉。"));
    var kvR=el("div","kv");
    kvR.appendChild(el("div","k","每月長尾收入"));
    kvR.appendChild(el("div","v num pos","+"+M(d.income||0)));
    if(dgR){ kvR.appendChild(el("div","k","投入了")); kvR.appendChild(el("div","v num",(S.turnNumber-dgR.startedAt)+" 輪")); }
    card.appendChild(kvR);
    card.appendChild(el("div","edu",tR.n+"　停更會衰減——長尾屬於持續的人，不屬於做過的人。"));
    var oR=el("div","opts");
    oR.appendChild(optBtn("知道了",null,function(){ decide("ok"); }, true));
    card.appendChild(oR); c.appendChild(card); return;
  }

  if(d.kind==="DELIST_WARN"){
    var dfW=ns.content.stockBySymbol[d.symbol];
    var myLots=p.assets.filter(function(a){ return a.kind==="STOCK" && a.symbol===d.symbol; });
    var mvW=util.sum(myLots,function(a){ return a.marketValue||0; });
    var cbW=util.sum(myLots,function(a){ return a.costBasis||0; });
    var marg=myLots.some(function(a){ return a.linkedLiabilityId; });
    card.appendChild(el("h3",null,"⚠️ 償債能力警示："+E.stockName(S,d.symbol)));
    card.appendChild(el("div","flavor",
      "交易所發出警示：這檔股票已跌破門檻，且景氣處於蕭條。"+
      "<b class='gold'>若在第 "+d.until+" 輪前情況沒有改善，將終止上市——持股歸零。</b>"));
    var kvW=el("div","kv");
    kvW.appendChild(el("div","k","你的持股市值")); kvW.appendChild(el("div","v num",M(util.r2(mvW))));
    kvW.appendChild(el("div","k","當初投入")); kvW.appendChild(el("div","v num",M(util.r2(cbW))));
    kvW.appendChild(el("div","k","現在停損拿得回"));
    kvW.appendChild(el("div","v num"+(mvW>0?" pos":""),M(util.r2(mvW))));
    kvW.appendChild(el("div","k","若下市"));
    kvW.appendChild(el("div","v num neg","0"+(marg?"（但融資的債還在）":"")));
    card.appendChild(kvW);
    card.appendChild(el("div","edu",
      "撈底的人常說「都跌成這樣了還能跌到哪」——能，可以跌到歸零。"+
      (marg?"　你這筆有融資：下市後股票沒了，借的錢仍要還。":"")));
    var oW=el("div","opts");
    oW.appendChild(optBtn("停損賣出","現在認賠 "+M(util.r2(cbW-mvW))+"，換回 "+M(util.r2(mvW)),
      function(){ decide("sell"); }, true));
    oW.appendChild(optBtn("續抱，賭它撐過去","可能全部歸零，也可能等到景氣翻身",function(){ decide("hold"); }));
    card.appendChild(oW); c.appendChild(card); return;
  }

  if(d.kind==="RENEW_MALL"){
    var itU=ns.content.byId[d.itemId], plU=(itU&&itU.payload)||{};
    card.appendChild(el("h3",null,"年約到期了"));
    card.appendChild(el("div","flavor","「"+(itU?itU.title:"?")+"」的效期已經過了。"+
      "不續約不會怎樣——直到你需要它的那一天。"));
    if(itU && itU.eduNote){ var ebU=el("div","edu",itU.eduNote); card.appendChild(ebU); }
    var kvU=el("div","kv");
    var costU=itU?E.mallCost(S,itU):0;
    kvU.appendChild(el("div","k","續約費用")); kvU.appendChild(el("div","v num neg","−"+M(costU)));
    if(plU.recurringMonthly){ kvU.appendChild(el("div","k","每月")); kvU.appendChild(el("div","v num neg","−"+M(plU.recurringMonthly))); }
    if(plU.flagTurns){ kvU.appendChild(el("div","k","可再撐")); kvU.appendChild(el("div","v num",plU.flagTurns+" 輪")); }
    card.appendChild(kvU);
    var oU=el("div","opts");
    if(costU>p.cash){
      var dbU=optBtn("續約","現金不足",function(){},false); dbU.disabled=true;
      oU.appendChild(dbU);
      oU.appendChild(el("div","flavor","現金不足以續約——保障就是在這種時候斷掉的。"));
    } else {
      oU.appendChild(optBtn("續約","再買一次，效期重新計算",function(){ decide("renew"); }, true));
    }
    oU.appendChild(optBtn("先停掉","省下這筆錢，風險自己扛",function(){ decide("stop"); }));
    card.appendChild(oU); c.appendChild(card); return;
  }

  if(d.kind==="SECOND_CAREER"){
    var cdC=ns.content.byId[d.cardId], scC=(cdC&&cdC.secondCareer)||{};
    var profC=ns.content.professionById[scC.professionId];
    var oldProfC=ns.content.professionById[p.professionId];
    card.className+=" wide";
    card.appendChild(el("h3",null,"第二專長學成了——要怎麼用？"));
    card.appendChild(el("div","flavor","「"+(cdC?cdC.title:"?")+"」結業。"+
      "<b class='gold'>轉職是整個換掉，兼副業是兩邊都要顧</b>——沒有兩全其美的選項。"));
    var gridC=el("div","pickGrid");

    // 轉職
    var colA=el("div"); colA.style.cssText="border:1px solid var(--line);border-radius:var(--r);"+
      "padding:10px;background:var(--panel2);display:flex;flex-direction:column;gap:6px;min-width:0";
    var ttA=el("div"); ttA.style.cssText="font-weight:700;font-size:14px";
    ttA.textContent="轉職："+(profC?profC.name:"?"); colA.appendChild(ttA);
    var newSalC=profC?util.r2(profC.salary*S.config.salaryMult):0;
    var newExpC=profC?util.r2(profC.baseExpenses*S.config.expenseMult):0;
    var oldBaseExpC=oldProfC?util.r2(oldProfC.baseExpenses*S.config.expenseMult):0;
    var kvA=el("div","kv");
    kvA.appendChild(el("div","k","薪資"));
    kvA.appendChild(el("div","v num",M(p.derived.salaryIncome)+" → "+M(newSalC)));
    kvA.appendChild(el("div","k","生活支出"));
    kvA.appendChild(el("div","v num",M(oldBaseExpC)+" → "+M(newExpC)));
    var dNetC=util.r2((newSalC-newExpC)-(p.derived.salaryIncome-oldBaseExpC));
    kvA.appendChild(el("div","k","每月淨變動"));
    kvA.appendChild(el("div","v num"+(dNetC>0?" pos":(dNetC<0?" neg":"")),(dNetC>0?"+":"")+M(dNetC)));
    colA.appendChild(kvA);
    colA.appendChild(el("div","flavor","原本的職涯加薪不會跟著走，副業也會一併結束。"));
    var bA=el("button","opt"); bA.textContent="轉職";
    if(p.playerStage!=="INNER"){ bA.disabled=true; bA.title="已經在自由圈，不需要再轉職"; }
    bA.onclick=function(){ decide("switch"); };
    colA.appendChild(bA); gridC.appendChild(colA);

    // 兼副業
    var colB=el("div"); colB.style.cssText=colA.style.cssText;
    var ttB=el("div"); ttB.style.cssText="font-weight:700;font-size:14px";
    ttB.textContent="兼副業："+(scC.sideLabel||"接案"); colB.appendChild(ttB);
    var kvB=el("div","kv");
    kvB.appendChild(el("div","k","每月副業收入")); kvB.appendChild(el("div","v num pos","+"+M(scC.sideIncome||0)));
    kvB.appendChild(el("div","k","每月時間與器材成本")); kvB.appendChild(el("div","v num neg","−"+M(scC.sideCost||0)));
    kvB.appendChild(el("div","k","每月淨增加"));
    kvB.appendChild(el("div","v num pos","+"+M(util.r2((scC.sideIncome||0)-(scC.sideCost||0)))));
    colB.appendChild(kvB);
    colB.appendChild(el("div","flavor","副業是<b>主動收入</b>——不計入自由率，停走或辭職就沒了。"));
    var bB=el("button","opt"); bB.textContent="兼副業";
    bB.onclick=function(){ decide("side"); };
    colB.appendChild(bB); gridC.appendChild(colB);

    card.appendChild(gridC);
    var oC=el("div","opts");
    oC.appendChild(optBtn("先放著","學都學了，但現在不動——留著等更好的時機",function(){ decide("keep"); }));
    card.appendChild(oC);
    c.appendChild(card); return;
  }

  if(d.kind==="PICK_LIFE"){
    card.className+=" wide";
    card.appendChild(el("h3",null,"兩件事同時找上你"));
    card.appendChild(el("div","flavor",
      "你只能先處理一件——<b class='gold'>另一件下次踩到人生格時還是會找上你</b>。"+
      "你選的是順序，不是逃避；有準備的人才有得選，下面標出你接不接得住。"));
    var gridL=el("div","pickGrid");
    var KINDL={LIFE_EVENT:"人生事件",SKILL_GATE:"書到用時",SKILL:"進修機會",
               TAPESTRY:"人生百態",SELF_INVEST:"自我投資",CHOICE:"抉擇",PROFESSION_EVENT:"職涯事件"};
    (d.cardIds||[]).forEach(function(id){
      var cc=ns.content.byId[id]; if(!cc) return;
      var col=el("div"); col.style.cssText="border:1px solid var(--line);border-radius:var(--r);"+
        "padding:10px;background:var(--panel2);display:flex;flex-direction:column;gap:6px;min-width:0";
      var ttl=el("div"); ttl.style.cssText="font-weight:700;font-size:14px";
      ttl.textContent=cc.title; col.appendChild(ttl);
      var tg=el("div"); tg.style.cssText="font-size:11px;color:var(--tx3);letter-spacing:.1em";
      tg.textContent=KINDL[cc.kind]||cc.kind; col.appendChild(tg);
      var fv=cc.flavor||cc.eduNote||"";
      if(fv){ var fvd=el("div","flavor",String(fv).split("。")[0]+"。"); fvd.style.margin="0"; col.appendChild(fvd); }
      if(cc.kind==="SKILL_GATE" && cc.skillBranch){
        var req=cc.skillBranch.requires||"";
        var reqName = req.indexOf("family:")===0 ? "「"+req.slice(7)+"」這一類的準備"
                    : "「"+((ns.content.byId[req]||{}).title||req)+"」";
        var have=E.hasSkill(p,req);
        var rq=el("div"); rq.style.cssText="font-size:12px;font-weight:700;margin-top:2px;"+
          "color:"+(have?"var(--pos)":"var(--neg)");
        rq.textContent=(have?"✅ 你接得住：已具備 ":"⚠️ 你沒有準備：需要 ")+reqName;
        col.appendChild(rq);
      } else if(cc.kind==="SKILL"){
        var pr=E.skillPrice(S,cc,true,p);
        var sk=el("div","flavor"); sk.style.cssText="margin:0;font-size:12px;color:var(--gold)";
        sk.textContent="學費 "+M(pr)+"・"+E.skillTurns(S,p,cc)+" 輪"; col.appendChild(sk);
      } else {
        var es=ui.effectSummary(cc.effects);
        if(es){ var esd=el("div","flavor",es); esd.style.cssText="margin:0;font-size:12px;color:var(--tx2)";
          col.appendChild(esd); }
      }
      var bL=el("button","opt"); bL.textContent="面對這件事";
      (function(cid){ bL.onclick=function(){ decide(cid); }; })(id);
      col.appendChild(bL);
      gridL.appendChild(col);
    });
    card.appendChild(gridL);
    c.appendChild(card); return;
  }

  var cd = d.cardId ? ns.content.byId[d.cardId] : null;

  if(d.kind==="BUY"){
    card.appendChild(cardFace(cd)); var eb=eduBox(cd); if(eb) card.appendChild(eb);
    if(cd.kind==="REALESTATE") return ui.buyRealEstate(S,p,d,cd,card,c,decide);
    if(cd.kind==="STOCK") return ui.buyStock(S,p,d,cd,card,c,decide);
    if(cd.kind==="BUSINESS"||cd.kind==="STARTUP") return ui.buySimple(S,p,d,cd,card,c,decide);
  }

  if(d.kind==="LIFESTYLE"){
    card.appendChild(cardFace(cd)); var eb2=eduBox(cd); if(eb2) card.appendChild(eb2);
    var pl=cd.payload||{}, kv=el("div","kv");
    if(pl.cost){ kv.appendChild(el("div","k","一次性支出")); kv.appendChild(el("div","v num neg","−"+M(pl.cost))); }
    if(pl.recurringMonthly){ kv.appendChild(el("div","k","每月增加支出")); kv.appendChild(el("div","v num neg","−"+M(pl.recurringMonthly))); }
    kv.appendChild(el("div","k","幸福感")); kv.appendChild(el("div","v num pos","＋"+((pl.joy)||1)));
    card.appendChild(kv);
    var o=el("div","opts");
    o.appendChild(optBtn("買下去","滿足當下，但要進你的支出表",function(){ ui.spendGuard(util.r2(p.cash-(pl.cost||0)), function(){ decide("buy"); }); }));
    o.appendChild(optBtn(T("virtue.skip"),"把錢留給會生錢的資產",function(){ decide("skip"); }, true));
    card.appendChild(o); c.appendChild(card); return;
  }

  if(d.kind==="SKILL_RESULT"){
    var sb=cd.skillBranch, br=d.have?sb.have:sb.miss;
    var reqCard = (sb.requires||"").indexOf("family:")===0 ? null : ns.content.byId[sb.requires];
    var reqName = reqCard ? reqCard.title : (sb.requires||"").replace("family:","");
    card.appendChild(cardFace(cd));
    // 有沒有準備，用顏色與標頭一眼分開
    var badge=el("div"); badge.style.cssText="margin:6px 0;padding:7px 10px;border-radius:8px;font-size:13.5px;line-height:1.5;"
      + (d.have ? "background:rgba(53,196,168,.13);border-left:3px solid var(--pos)"
                : "background:rgba(255,255,255,.05);border-left:3px solid var(--tx3);color:var(--tx2)");
    badge.innerHTML = d.have
      ? "🎓 <b>你學過「"+reqName+"」——今天派上用場了。</b>"
      : "🔒 <b>這個機會需要："+reqName+"</b>　你沒有，只能看著它過去。";
    card.appendChild(badge);
    var nar=el("div","flavor"); nar.textContent=br.narrative||""; card.appendChild(nar);
    if(d.gap && d.gap!==0){
      var gp=el("div","edu");
      gp.textContent = d.have
        ? "💡 因為有這項準備，這次比沒準備多留住了 "+M(Math.abs(d.gap))+"。"
        : "💡 如果當初學過「"+reqName+"」，這次的差別是 "+M(Math.abs(d.gap))+"。";
      card.appendChild(gp);
    } else if(!d.have){
      var gp2=el("div","edu");
      gp2.textContent="💡 這次沒有金錢損失——錯過的是機會本身。";
      card.appendChild(gp2);
    }
    var ebG=eduBox(cd); if(ebG) card.appendChild(ebG);
    var oG=el("div","opts"); oG.appendChild(optBtn(T("act.continue"),null,function(){ decide("ok"); }, true));
    card.appendChild(oG); c.appendChild(card); return;
  }

  if(d.kind==="LEARN_SKILL"){
    card.appendChild(cardFace(cd)); var ebL=eduBox(cd); if(ebL) card.appendChild(ebL);
    if(cd.hint){ var hb=el("div","flavor"); hb.style.color="var(--gold)";
      hb.textContent="💡 "+cd.hint; card.appendChild(hb); }
    var priceL=E.skillPrice(S,cd,true,p), isRfL=E.skillIsRefresh(p,cd);
    var kvL=el("div","kv");
    kvL.appendChild(el("div","k",isRfL?"進修更新學費（底子還在）":"學費（含折扣）"));
    kvL.appendChild(el("div","v num neg","−"+M(priceL)));
    if(cd.recurringMonthly){ kvL.appendChild(el("div","k","學習期間每月")); kvL.appendChild(el("div","v num neg","−"+M(cd.recurringMonthly))); }
    kvL.appendChild(el("div","k","需要時間"));
    kvL.appendChild(el("div","v num",E.skillTurns(S,p,cd)+" 輪"));
    card.appendChild(kvL);
    var oL=el("div","opts");
    var busyL = !!p.learning, richL = p.cash>=priceL, coolL = S.turnNumber < (p.skillCooldownUntil||0);
    var whyL = busyL ? "你正在學「"+((ns.content.byId[p.learning.skillId]||{}).title||"別的")+"」，同時只能學一項"
             : coolL ? "剛學完，還在休息中"
             : (!richL ? "現金不足" : "");
    if(whyL){
      var dbL=optBtn("學不了","",function(){},false); dbL.disabled=true; dbL.title=whyL;
      oL.appendChild(dbL);
      oL.appendChild(el("div","flavor",whyL));
    } else {
      oL.appendChild(optBtn(isRfL?"進修更新":"報名學習",
        "投入 "+M(priceL)+"、"+E.skillTurns(S,p,cd)+" 輪後"+(isRfL?"重新生效":"學成"),
        function(){ decide("learn"); }, true));
    }
    oL.appendChild(optBtn("這次不學","把錢和時間留著",function(){ decide("skip"); }));
    card.appendChild(oL); c.appendChild(card); return;
  }

  if(d.kind==="CULTIVATE"){
    card.appendChild(cardFace(cd)); var eb3=eduBox(cd); if(eb3) card.appendChild(eb3);
    var pl2=cd.payload||{};
    card.appendChild(el("div","flavor","品格軸："+T("virtue."+cd.virtueAxis)));
    var kv2=el("div","kv");
    if(pl2.cost){ kv2.appendChild(el("div","k","投資成本")); kv2.appendChild(el("div","v num neg","−"+M(pl2.cost))); }
    if(pl2.recurringMonthly){ kv2.appendChild(el("div","k","每月")); kv2.appendChild(el("div","v num neg","−"+M(pl2.recurringMonthly))); }
    card.appendChild(kv2);
    var o2=el("div","opts");
    o2.appendChild(optBtn(T("virtue.invest"),"提升「"+T("virtue."+cd.virtueAxis)+"」，未來考驗更從容",function(){ decide("invest"); }, true));
    o2.appendChild(optBtn(T("virtue.skip"),"省下這筆錢",function(){ decide("skip"); }));
    card.appendChild(o2); c.appendChild(card); return;
  }

  if(d.kind==="TRIAL_RESULT"){
    var b=cd.virtueBranch, above=d.above, br=above?b.above:b.below;
    card.appendChild(cardFace(cd));
    card.appendChild(el("div","flavor",br.narrative));
    var axName=T("virtue."+b.axis), lvNow=(p.virtues&&p.virtues[b.axis])||0, need=b.threshold;
    if(above){
      var savedA=Math.max(0,(d.belowCost||0)-(d.aboveCost||0)), gotA=d.missed||0;
      card.appendChild(el("div","edu", T("virtue.above")+"："+
        (savedA>0 && gotA>0 ? ("你在「"+axName+"」的投資，讓你少付了 "+M(savedA)+"，還多拿到 "+M(gotA))
         : savedA>0 ? ("你在「"+axName+"」的投資，讓你少付了 "+M(savedA))
         : gotA>0 ? ("你在「"+axName+"」的投資，替你帶來了 "+M(gotA)+" 的幫助")
         : ("你在「"+axName+"」的投資，讓這件事沒有變成問題"))));
    } else {
      // S12：考驗卡有兩種寫法，過去只有一套「代價是 X」的模板，
      // 套到獎勵型（沒品格＝沒拿到好處，而不是被罰錢）就變成四行全是 0，看起來像壞掉。
      var missed=d.missed||0, payNow=d.belowCost||0;
      var head = payNow>0
        ? (T("virtue.below")+"：這次的代價是 "+M(payNow)+(missed>0?("，還錯過了 "+M(missed)):""))
        : (missed>0 ? ("錯過了：這次你少拿到 "+M(missed))
                    : (T("virtue.below")+"：這次沒有直接損失，但你也沒得到任何幫助"));
      card.appendChild(el("div","edu", head));
      var cmp=el("div","kv"); cmp.style.marginTop="6px";
      cmp.appendChild(el("div","k","你現在的「"+axName+"」"));
      cmp.appendChild(el("div","v num neg", lvNow+" 級（這張卡要 "+need+" 級）"));
      if(payNow>0){
        cmp.appendChild(el("div","k","實際付出"));
        cmp.appendChild(el("div","v num neg","−"+M(payNow)));
      }
      if(missed>0){
        cmp.appendChild(el("div","k","沒拿到的幫助"));
        cmp.appendChild(el("div","v num neg","−"+M(missed)+"（本來可以省下的）"));
      }
      cmp.appendChild(el("div","k","若「"+axName+"」有 "+need+" 級"));
      var ifTxt = payNow>0
        ? (d.aboveCost>0 ? ("只付 "+M(d.aboveCost)) : "完全避開這筆支出")
        : (missed>0 ? ("拿到 "+M(missed)+" 的幫助") : "會有不一樣的走法");
      cmp.appendChild(el("div","v num pos", ifTxt));
      var gap=Math.max(0,(payNow-(d.aboveCost||0)))+missed;
      cmp.appendChild(el("div","k","這次的差距"));
      cmp.appendChild(el("div","v num pos", gap>0 ? ("相差 "+M(gap)) : "—"));
      card.appendChild(cmp);
      card.appendChild(el("div","flavor", payNow>0
        ? ("品格不是道德分數，是<b class='gold'>遇到事情時的緩衝</b>——跟保險一樣，"+
           "平常看不出差別，出事那天才知道。")
        : ("品格不只在出事時擋一下，<b class='gold'>平時還會替你帶來別人願意伸的手</b>——"+
           "這種幫助不會寫在帳上，但你確實少付了那些錢。")));
    }
    var o3=el("div","opts"); o3.appendChild(optBtn(T("act.continue"),null,function(){ decide("ok"); }));
    card.appendChild(o3); c.appendChild(card); return;
  }

  if(d.kind==="PROFESSION_EVENT"){
    card.appendChild(cardFace(cd)); var eb4=eduBox(cd); if(eb4) card.appendChild(eb4);
    var o4=el("div","opts");
    cd.decision.options.forEach(function(op,i){ o4.appendChild(optBtn(op.label, ui.optSub(op), function(){ decide(i); }, i===0)); });
    card.appendChild(o4); c.appendChild(card); return;
  }

  if(d.kind==="SELF_INVEST"){
    card.appendChild(cardFace(cd)); var ebS=eduBox(cd); if(ebS) card.appendChild(ebS);
    card.appendChild(el("div","flavor","翻轉人生的機會——投資自己，長期改變你的收入或支出結構。"));
    var oS=el("div","opts");
    cd.decision.options.forEach(function(op,i){
      var afford = !op.cost || op.cost<=p.cash;
      var sub = ui.optSub(op) + (op.cost&&!afford?"（現金不足，需 "+M(op.cost)+"）":"");
      var b=optBtn(op.label, sub, function(){ if(!afford){ ui.toast("現金不足","warn"); return; } decide(i); }, i===0&&afford);
      if(!afford){ b.disabled=true; b.style.opacity=".5"; }
      oS.appendChild(b);
    });
    card.appendChild(oS); c.appendChild(card); return;
  }

  if(d.kind==="CHOICE"){
    card.appendChild(cardFace(cd)); var ebC=eduBox(cd); if(ebC) card.appendChild(ebC);
    var oC=el("div","opts");
    cd.decision.options.forEach(function(op,i){
      var afford = !op.cost || op.cost<=p.cash;
      var sub = ui.optSub(op) + (op.cost&&!afford?"（現金不足，需 "+M(op.cost)+"）":"");
      var b=optBtn(op.label, sub, function(){ if(!afford){ ui.toast("現金不足","warn"); return; } decide(i); }, i===0&&afford);
      if(!afford){ b.disabled=true; b.style.opacity=".5"; }
      oC.appendChild(b);
    });
    card.appendChild(oC); c.appendChild(card); return;
  }

  if(d.kind==="FOLLOW_ON"){
    card.appendChild(el("h3",null,term("DILUTION")+"：新一輪募資"));
    var as=p.assets.filter(function(x){return x.instanceId===d.assetId;})[0];
    card.appendChild(el("div","flavor",(as?as.name:"新創")+" 開了新一輪，投前估值 "+M(d.pre)+"，募 "+M(d.raise)+"。"));
    card.appendChild(el("div","edu","跟投維持你的股比；不跟投則股份會被稀釋。"));
    var o5=el("div","opts");
    o5.appendChild(optBtn("跟投 "+M(d.invest),"維持 "+util.pct(d.equity,1)+" 股權",function(){ decide("follow"); }, true));
    o5.appendChild(optBtn("不跟投","股權稀釋為 "+util.pct(d.equity*d.pre/d.post,1),function(){ decide("pass"); }));
    card.appendChild(o5); c.appendChild(card); return;
  }

  if(d.kind==="GRADUATE"){
    card.appendChild(el("h3",null,T("free.title")));
    card.appendChild(el("div","flavor",T("free.desc")));
    var pv=el("div","preview"); pv.innerHTML=T("free.calc")+"：<b class='num "+(d.projected>=0?"pos":"neg")+"'>"+(d.projected>=0?"+":"")+M(d.projected)+"</b>／月（已扣夢想維持費 "+M(d.upkeep)+"）";
    card.appendChild(pv);
    var o6=el("div","opts");
    o6.appendChild(optBtn(T("free.go"),"辭掉工作，開始在自由圈追夢",function(){ decide("go"); }, d.projected>=0));
    o6.appendChild(optBtn(T("free.stay"),"留在內圈，繼續擴大被動收入",function(){ decide("stay"); }));
    card.appendChild(o6); c.appendChild(card); return;
  }

  if(d.kind==="BUY_PROGRESS"){
    var dream=ns.content.byId[p.dreamCardId];
    var need=S.config.dreamCost, have=p.dreamProgress;
    card.appendChild(el("h3",null,T("outer.buy")));
    card.appendChild(el("div","flavor","用自由圈的現金流，把「"+(dream?dream.name:"夢想")+"」往前推一步。目前進度 "+have+"／"+need+"（每回合限買 1 點，越後面越貴）。"));
    var o7=el("div","opts");
    o7.appendChild(optBtn("買下一段（"+M(d.price)+"）","夢想進度 +1"+(have+1>=need?"　🎉 這一段就圓夢了":""),function(){
      ui.spendGuard(util.r2(p.cash-d.price), function(){ decide("buy"); }); }, true));
    o7.appendChild(optBtn("這回合先不買","保留現金，之後再推進",function(){ decide("skip"); }));
    card.appendChild(o7); c.appendChild(card); return;
  }

  if(d.kind==="FREEFALL_RESCUE"){
    var mult=E.cfg(S,"returnSalaryMult"); if(mult===undefined) mult=0.9;
    card.appendChild(el("h3",null,"⚠ 自由圈現金告急"));
    card.appendChild(el("div","flavor","現金 "+M(p.cash)+"。急售資產把現金救回正數（第 "+(d.warnings+1)+"／"+d.cap+" 次自救機會），或是承認這次準備不夠——跌回內圈重新累積。"));
    card.appendChild(el("div","edu","跌回內圈：恢復上班（薪資為離職時的 "+Math.round(mult*100)+"%）、夢想維持費停扣、停走 1 輪；夢想進度完整保留，之後可以再畢業。"));
    var needF=util.r2(-p.cash);
    card.appendChild(el("edu","edu","現金為負 "+M(p.cash)+"，<b class='gold'>還差 "+M(needF)+"</b> 才能回正。"+
      "下面列的是<b>實際入袋</b>——貸款買的資產要先清償，拿回來的可能比市價少很多。"));
    var oF=el("div","opts");
    ui.sellOptions(S,p,needF,S.config.fireSaleRatio).forEach(function(row){
      oF.appendChild(optBtn("急售："+row.a.name, row.sub, function(){ decide(row.a.instanceId); }, row.enough));
    });
    oF.appendChild(optBtn("跌回內圈，重新來過","保留夢想進度，回內圈上班存錢",function(){ decide("fall"); }));
    card.appendChild(oF); c.appendChild(card); return;
  }

  if(d.kind==="BANKRUPTCY"){
    var need=util.r2(-p.cash), fm=S.config.fireSaleRatio;
    card.appendChild(el("h3",null,T("bank.title")));
    card.appendChild(el("div","flavor",T("bank.desc")));
    card.appendChild(el("div","edu","現金為負 "+M(p.cash)+"，<b class='gold'>還差 "+M(need)+"</b> 才能回正。"+
      "急售是按市價 "+Math.round(fm*100)+"% 認賠——<b>只要補得上缺口就好，不必全部賣光</b>。<br>"+
      "下面列的是<b>實際入袋</b>：貸款買的資產要先清償，可能一毛都拿不到，還會留下轉成信貸的餘債。"));
    var o8=el("div","opts");
    ui.sellOptions(S,p,need,fm).forEach(function(row){
      o8.appendChild(optBtn("急售："+row.a.name, row.sub, function(){
        ui.dispatch({type:"SELL_ASSET",playerId:ui.myId(),payload:{assetId:row.a.instanceId}}); }, row.enough));
    });
    // 紓困貸款：資產賣光、淨值為負時，仍以月收入為基準保留最後額度
    var cap=E.rescueCap(S,p);
    if(cap>1) o8.appendChild(optBtn(T("bank.rescue")+"（"+M(cap)+"）",
      "年利率 "+util.pct(E.rRate(S.macro.baseRate+E.cfg(S,"rescueLoanSpread")),1)+
      "　額度＝淨值或月收入孰高　會在信用留下永久紀錄",
      function(){ ui.dispatch({type:"TAKE_LOAN",playerId:ui.myId(),payload:{amount:Math.min(cap,Math.max(need,cap))}}); }));
    // P2P 民間借貸：銀行不借了，還有人可能肯借
    if(E.p2pAvailable(S,p) && S.enabledModules.indexOf("M3")>=0)
      o8.appendChild(optBtn("向其他玩家借錢（P2P）","銀行不借了，還有民間管道——代價是更高的利率",
        function(){ ui.showP2PPanel(true); }));
    o8.appendChild(optBtn(T("bank.out"),"退出這一局",function(){ decide("declare"); }));
    card.appendChild(o8); c.appendChild(card); return;
  }

  if(d.kind==="SELL_OFFER"){
    card.appendChild(cardFace(cd)); var ebO=eduBox(cd); if(ebO) card.appendChild(ebO);
    var mult=d.priceMult||1.3;
    card.appendChild(el("div","flavor","有人開高價（約 "+util.pct(mult-1,0)+" 溢價）要收購你的物件。高點出場是紀律，不是運氣。"));
    var elig=p.assets.filter(function(a){ return (!d.filter||!d.filter.kind||d.filter.kind===a.kind); });
    var oO=el("div","opts");
    elig.forEach(function(a){
      var offer=util.r2(a.marketValue*mult);
      var pl=util.r2(offer-a.costBasis);
      oO.appendChild(optBtn("賣出："+a.name+"　"+M(offer),
        "市值 "+M(a.marketValue)+" → 溢價 "+M(offer)+"　損益 "+(pl>=0?"+":"")+M(pl),
        function(){ decide(a.instanceId); }, pl>=0));
    });
    oO.appendChild(optBtn("先不賣","留著繼續收租、等更好的時機",function(){ decide("decline"); }));
    card.appendChild(oO); c.appendChild(card); return;
  }

  // ACK 類（市場卡、人生事件、聖地、失業結果）
  card.appendChild(cardFace(cd||{title:"事件"}));
  if(cd){ var eb5=eduBox(cd); if(eb5) card.appendChild(eb5); }
  // V11.1：醫療／意外事件的理賠明細——原價、折抵、理賠、實際支付、省下多少
  if(d.claim && d.claim.gross>0) card.appendChild(ui.claimBox(S,d.claim));
  if(d.impact && d.impact.length){
    var acc={INCOME_ACTIVE:"主動收入",INCOME_PASSIVE:"被動收入",EXPENSE:"支出",ASSET:"資產市值",LIABILITY:"負債",CASH:"現金"};
    var wrap=el("div"); wrap.style.marginTop="8px";
    var tgl=el("button","act","查看對你的實際影響"); tgl.style.width="100%";
    var body=el("div"); body.style.display="none"; body.style.marginTop="8px";
    var kv=el("div","kv");
    d.impact.forEach(function(it){
      kv.appendChild(el("div","k",(acc[it.account]||it.account)+"｜"+it.label.split("｜").pop()));
      kv.appendChild(el("div","v num "+(it.delta>=0?"pos":"neg"),(it.delta>=0?"+":"")+M(it.delta)));
    });
    body.appendChild(kv);
    tgl.onclick=function(){ body.style.display = body.style.display==="none"?"block":"none"; };
    wrap.appendChild(tgl); wrap.appendChild(body); card.appendChild(wrap);
  } else if(cd && cd.effects){
    var lines=cd.effects.map(function(e){ return ui.describeEffect(e); }).filter(Boolean);
    if(lines.length){ var ul=el("div","kv"); lines.forEach(function(t){ ul.appendChild(el("div","k",t)); ul.appendChild(el("div","v","")); }); card.appendChild(ul); }
  }
  if(d.layoff){
    // S15：受僱／自營／創辦人各有自己的說法（引擎已依 employmentType 帶進來）
    card.appendChild(el("h3",null, d.layoff.title || T("layoff.title")));
    card.appendChild(el("div","flavor","支付 "+M(d.layoff.cost)+"，並停走 "+d.layoff.skip+" 回合。"));
    if(d.layoff.note) card.appendChild(el("div","edu", d.layoff.note));
  }
  if(d.site){ card.appendChild(el("div","edu",T("outer.site"))); }
  var o9=el("div","opts"); o9.appendChild(optBtn(T("act.continue"),null,function(){ decide("ok"); }));
  card.appendChild(o9); c.appendChild(card);
};

// V11.1：幸福感／品格／夢想的積累明細——點右欄的幸福感或獲勝條件就會開
// M8 S1：主動進修選單（只列本局抽樣到的技能）
ui.showSkillMenu = function(p){
  var S=ui.S;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"📖 進修（自己找資源）"));
  box.appendChild(el("div","flavor","自己報名的課全額付費，還要多花時間找資源——但你想學什麼由自己決定。同時只能學一項。"));
  var inSample={}; (S.skillSample||[]).forEach(function(id){ inSample[id]=1; });
  var pool=(S.skillSample||[]).map(function(id){ return ns.content.byId[id]; })
    .filter(function(c){ return c && !(p.skills[c.id] && !p.skills[c.id].decayed); });
  // 這一局沒開的課也要列出來——不然玩家想學財務卻找不到，會以為是壞掉了
  var offSample=(ns.content.cards.SKILL||[]).filter(function(c){
    return c && !inSample[c.id] && !(p.skills[c.id] && !p.skills[c.id].decayed);
  }).sort(function(a,b){ return (a.cost||0)-(b.cost||0) || (a.id<b.id?-1:1); });
  if(!pool.length){
    box.appendChild(el("div","edu","這一局沒有更多可學的技能了。"));
  } else {
    var extraT=E.cfg(S,"skillActiveExtraTurns"); if(extraT===undefined) extraT=1;
    var grid=el("div"); grid.style.cssText="display:flex;flex-direction:column;gap:6px;margin-top:8px";
    pool.forEach(function(sc){
      var price=E.skillPrice(S,sc,false,p), afford=p.cash>=price;
      var isRf=E.skillIsRefresh(p,sc);
      var b=el("button","opt");
      b.style.cssText="text-align:left;padding:9px 11px";
      var t=el("div"); t.style.cssText="display:flex;justify-content:space-between;gap:8px";
      t.appendChild(el("b",null,sc.title));
      t.appendChild(el("span","num"+(afford?"":" neg"),
        M(price)+"・"+(E.skillTurns(S,p,sc)+extraT)+" 輪"+(isRf?"（更新）":"")));
      b.appendChild(t);
      if(sc.hint){ var h=el("div","fl"); h.style.cssText="font-size:12px;color:var(--tx2);margin-top:2px";
        h.textContent=sc.hint; b.appendChild(h); }
      if(sc.recurringMonthly){ var rr=el("div","fl"); rr.style.cssText="font-size:12px;color:var(--neg)";
        rr.textContent="學習期間每月 −"+M(sc.recurringMonthly); b.appendChild(rr); }
      b.disabled=!afford;
      if(!afford) b.title="現金不足";
      b.onclick=function(){ ov.remove(); ui.dispatch({type:"START_SKILL",playerId:ui.myId(),payload:{skillId:sc.id}}); };
      grid.appendChild(b);
    });
    box.appendChild(grid);
  }
  if(offSample.length){
    var offHd=el("div","flavor");
    offHd.style.cssText="margin-top:12px;color:var(--tx3);font-size:12px";
    offHd.textContent="這一局沒有開的課（"+offSample.length+" 門）——每局的技能牌是抽樣的，"+
      "想學的不一定開得成，這本身就是現實的一部分。";
    box.appendChild(offHd);
    var offGrid=el("div"); offGrid.style.cssText="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px";
    offSample.forEach(function(sc){
      var chip=el("div");
      chip.style.cssText="border:1px dashed var(--line);border-radius:var(--r);padding:5px 8px;"+
        "font-size:12px;color:var(--tx3);opacity:.65";
      chip.textContent=sc.title+"（本局沒開）";
      chip.title=(sc.hint||"")+"　學費 "+M(sc.cost||0);
      offGrid.appendChild(chip);
    });
    box.appendChild(offGrid);
  }
  var o=el("div","opts"); o.style.marginTop="10px";
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};


/* ============ S16：一筆分錄 → 五欄變化（現金／資產／負債／收入／支出） ============
   依實測回饋的 Excel 格式。每輪紀錄、回合結算彙總、戰報三個畫面共用這一份，
   避免同一個算式寫成三份而漂移（S3b／S10 的教訓）。
   收入 = 主動 + 被動（都是每月流量）；支出 = EXPENSE（每月流量）。
   現金／資產／負債是存量的當次變動。                                            */
ui.LEDGER_COLS = [
  { key:"cash",   name:"現金", cls:"money" },
  { key:"asset",  name:"資產", cls:"money" },
  { key:"liab",   name:"負債", cls:"money", invert:true },   // 負債增加對玩家是壞事
  { key:"income", name:"收入", cls:"flow"  },
  { key:"expense",name:"支出", cls:"flow", invert:true }
];
ui.ledgerRow = function(e){
  var r={ summary:e.summary||"", src:(e.srcTitle&&e.srcTitle!==e.summary)?e.srcTitle:"",
          cash:0, asset:0, liab:0, income:0, expense:0, entryId:e.entryId };
  (e.postings||[]).forEach(function(q){
    switch(q.account){
      case "CASH":            r.cash    += q.delta; break;
      case "ASSET":           r.asset   += q.delta; break;
      case "LIABILITY":       r.liab    += q.delta; break;
      case "INCOME_ACTIVE":
      case "INCOME_PASSIVE":  r.income  += q.delta; break;
      case "EXPENSE":         r.expense += q.delta; break;
    }
  });
  ["cash","asset","liab","income","expense"].forEach(function(k){ r[k]=util.r2(r[k]); });
  /* S16：實測回饋——「賣股票時資產減少、現金增加，損益的表示似乎有問題」。
     算式其實是對的（摘要的損益＝實際入袋−成本基礎），難讀的是兩欄對不起來：
     賣出時 資產 −884、現金 +880，差的 3.9 是手續費與證交稅，而兩個數字都不是損益。
     這裡把費稅單獨挑出來寫一行，讓人不必自己對帳。 */
  var fees=[];
  (e.postings||[]).forEach(function(q){
    if(q.account==="CASH" && /手續費|交易稅|規費/.test(q.label||""))
      fees.push(q.label+" "+M(Math.abs(q.delta)));
  });
  if(fees.length) r.note="含 "+fees.join("、");
  // 資產處分：把「現金 − 資產」的差額講明白（差額＝費稅，不是算錯）
  if(r.asset<0 && r.cash>0){
    var gap=util.r2(r.cash+r.asset);
    if(Math.abs(gap)>0.005)
      r.note=(r.note?r.note+"　·　":"")+"現金與資產差 "+M(Math.abs(gap))+"＝交易成本";
  }
  /* S18：實測回饋——「人力成本上升卻記到收入下降，怪怪的」。
     帳沒有記錯：這個遊戲所有資產存的都是「淨額」（房地產存 租金−成本 的淨租金、
     事業存 monthlyProfit），全遊戲沒有把資產的營運成本拆成獨立支出行。
     所以成本上升就是淨利下降，記在收入欄是對的——難讀的是摘要看起來像一筆支出。
     這裡在成本型的收入變動上補一句，把因果講完。 */
  if(r.income<0 && !r.cash && !r.asset && !r.expense &&
     /成本|抽成|費用|工資|薪資|租金上漲|管銷/.test(r.summary))
    r.note=(r.note?r.note+"　·　":"")+"資產收入記的是淨額（收入−營運成本），所以成本上升會直接扣在收入這一欄";
  return r;
};
// 一組分錄的合計（用於「本輪總結」那一列）
ui.ledgerTotals = function(entries){
  var t={cash:0,asset:0,liab:0,income:0,expense:0};
  (entries||[]).forEach(function(e){
    var r=ui.ledgerRow(e);
    t.cash+=r.cash; t.asset+=r.asset; t.liab+=r.liab; t.income+=r.income; t.expense+=r.expense; });
  Object.keys(t).forEach(function(k){ t[k]=util.r2(t[k]); });
  return t;
};
// 五欄的表頭與資料列（共用，確保三個畫面長得一樣）
ui.ledgerHead = function(){
  return "<tr><th>發生了什麼</th><th>來源</th>"+
    ui.LEDGER_COLS.map(function(c){ return "<th class='num'>"+c.name+"</th>"; }).join("")+"</tr>";
};
ui.ledgerCells = function(r){
  return ui.LEDGER_COLS.map(function(c){
    var v=r[c.key];
    if(!v) return "<td class='num' style='color:var(--tx3)'>—</td>";
    // 負債／支出增加是壞事，用相反的顏色標
    var good = c.invert ? (v<0) : (v>0);
    return "<td class='num "+(good?"pos":"neg")+"'>"+(v>=0?"+":"")+M(v)+"</td>";
  }).join("");
};

/* ===================== S16：回合結算彙總畫面 =============================
   實測回饋：「每輪完成所有異動，再彈一個畫面，代替現在很多小通知；
   給玩家按『朕知道了』關掉，或 N 秒後自動關掉。」
   資料一律來自 p.ledger（與每輪紀錄同一份），不新增遊戲狀態、不影響重放與決定論。
   覆蓋範圍是「上次結算之後的所有分錄」——所以在別人回合發生在你身上的事
   （非回合動作、總經全體事件、P2P 期款）不會漏掉。                          */
ui.turnSummaryOn = function(){ return ui._sumOff!==true; };
ui._sumMark = {};                    // 每位玩家已結算到的 ledger 索引
ui._sumAutoSec = 0;                  // 0＝只手動關；>0＝N 秒後自動關（本機偏好，不進遊戲狀態）

ui.markTurnSummary = function(pid){
  var S=ui.S; if(!S) return;
  var p=S.players[pid]; if(!p) return;
  ui._sumMark[pid]=(p.ledger||[]).length;
};

ui.showTurnSummary = function(pid){
  var S=ui.S; if(!S) return;
  var p=S.players[pid]; if(!p) return;
  var from=ui._sumMark[pid]||0;
  var rows=(p.ledger||[]).slice(from).filter(function(e){
    return !(e.eduTags||[]).some(function(g){ return g==="bookkeeping"; });
  });
  ui.markTurnSummary(pid);
  if(!rows.length) return;                       // 這一輪對你沒有任何帳務變動就不打擾

  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="760px";
  var hd=el("div","panelTop");
  hd.appendChild(el("h2",null,"🧾 第 "+S.turnNumber+" 輪　你的結算"));
  var xb=el("button","act","✕ 關閉"); xb.onclick=function(){ close(); };
  hd.appendChild(xb); box.appendChild(hd);

  var tot=ui.ledgerTotals(rows);
  var sub=el("div","sub");
  sub.innerHTML="現金淨變動 <b class='num "+(tot.cash>=0?"pos":"neg")+"'>"+
    (tot.cash>=0?"+":"")+M(tot.cash)+"</b>　·　這一輪與你有關的每一筆都在下面（含別人回合發生在你身上的）。";
  box.appendChild(sub);

  /* S18：分三類列示——系統與大環境／你自己的動作／其他玩家引發。
     實測回饋：「事件彙整應該有幾類，可分別列式」。歸類只影響列在哪一段，
     數字與合計都不受影響（合計仍是整輪所有分錄）。 */
  var buckets={SYS:[],MINE:[],OTHERS:[]};
  rows.forEach(function(e){ (buckets[ui.entryCat(e,pid)]||buckets.MINE).push(e); });

  var tb=el("table","tb"); tb.style.marginTop="6px";
  tb.innerHTML=ui.ledgerHead();
  ui.CAT_ORDER.forEach(function(cat){
    var list=buckets[cat]; if(!list.length) return;
    var sub=ui.ledgerTotals(list);
    var hr=el("tr","catHd");
    hr.innerHTML="<td colspan='2'>"+ui.CAT_NAME[cat]+"　<span class='cnt'>"+list.length+" 筆</span></td>"+
                 ui.ledgerCells(sub);
    tb.appendChild(hr);
    list.forEach(function(e){
      var r=ui.ledgerRow(e), tr=el("tr");
      tr.innerHTML="<td>"+r.summary+
        (r.note?("<br><span style='color:var(--tx3);font-size:11px'>"+r.note+"</span>"):"")+"</td>"+
        "<td style='color:var(--tx3);font-size:11.5px'>"+r.src+"</td>"+ui.ledgerCells(r);
      tb.appendChild(tr);
    });
  });
  var trT=el("tr"); trT.style.cssText="border-top:1px solid var(--line2);font-weight:600";
  trT.innerHTML="<td>本輪合計</td><td></td>"+ui.ledgerCells(tot);
  tb.appendChild(trT);
  box.appendChild(tb);

  // 目前水位（結算後）
  var d=p.derived, kv=el("div","kv"); kv.style.cssText="margin-top:10px;grid-template-columns:1fr auto 1fr auto";
  function r2(k,v,c){ kv.appendChild(el("div","k",k)); kv.appendChild(el("div","v num"+(c?" "+c:""),v)); }
  r2("現金", M(p.cash), p.cash>=0?"pos":"neg");
  r2("淨值", M(d.netWorth), d.netWorth>=0?"pos":"neg");
  r2("被動收入", M(d.passiveIncome), "pos");
  r2("淨現金流", M(d.netCashflow), d.netCashflow>=0?"pos":"neg");
  box.appendChild(kv);

  var timer=null, left=ui._sumAutoSec;
  var okBtn=el("button","opt primary");
  function label(){ okBtn.textContent = left>0 ? ("朕知道了（"+left+"）") : "朕知道了"; }
  function close(){ if(timer) clearInterval(timer); timer=null; ov.remove(); }
  label();
  okBtn.onclick=close;

  var o=el("div","opts"); o.appendChild(okBtn);
  // 自動關閉：本機偏好，切換不影響遊戲狀態與決定論
  var auto=el("button","opt");
  function autoLabel(){ auto.textContent = ui._sumAutoSec>0 ? ("自動關閉："+ui._sumAutoSec+" 秒（點擊改）") : "自動關閉：關（點擊開）"; }
  autoLabel();
  auto.onclick=function(){
    var STEPS=[0,2,3,5,10];
    ui._sumAutoSec = STEPS[(STEPS.indexOf(ui._sumAutoSec)+1)%STEPS.length];
    try{ localStorage.setItem("finflow.sumAutoSec", String(ui._sumAutoSec)); }catch(e){}
    autoLabel();
    if(timer){ clearInterval(timer); timer=null; }
    left=ui._sumAutoSec; label();
    if(left>0) start();
  };
  o.appendChild(auto);
  var off=el("button","opt");
  off.textContent="不要再顯示結算畫面";
  off.title="關掉後改回原本的小通知；設定面板可以再打開";
  off.onclick=function(){ ui._sumOff=true;
    try{ localStorage.setItem("finflow.sumOff","1"); }catch(e){}
    ui.toast("已關閉回合結算畫面","good"); close(); };
  o.appendChild(off);
  box.appendChild(o);

  // 被靜音的小通知列在最後，一則都不漏——同樣分三類
  var mts=(ui._mutedToasts||[]).slice(-24);
  if(mts.length){
    var mb={SYS:[],MINE:[],OTHERS:[]};
    mts.forEach(function(x){
      // 相容：S18 之前存的是字串，之後存的是 {msg,cat}
      if(typeof x==="string") mb.SYS.push(x); else (mb[x.cat]||mb.SYS).push(x.msg);
    });
    var mt=el("div","edu"); mt.style.marginTop="8px";
    var html=[];
    ui.CAT_ORDER.forEach(function(cat){
      if(!mb[cat].length) return;
      html.push("<b>"+ui.CAT_NAME[cat]+"</b>　"+mb[cat].join("　·　"));
    });
    mt.innerHTML="這一輪的提示<br>"+html.join("<br>");
    box.appendChild(mt);
  }
  ui._mutedToasts=[];

  function start(){ timer=setInterval(function(){ left--; label(); if(left<=0) close(); }, 1000); }
  if(left>0) start();
  /* S18：大事件橫幅 #bcast 的 z-index 是 820、overlay 是 700，會蓋在結算畫面標題上。
     結算畫面本來就把那則訊息收在裡面（也在系統訊息裡），開結算時把橫幅收掉即可。 */
  var bh=$("bcast"); if(bh) bh.innerHTML="";
  ov.appendChild(box); $("overlays").appendChild(ov);
};

// 觸發：我的回合剛結束（在 ui.render 尾端偵測「剛剛還是我的回合，現在不是了」）
ui.checkTurnSummary = function(){
  var S=ui.S; if(!S || S.over) return;
  var me=ui.myId();
  var isMine = (S.activePlayerIdx===me) && !S.players[me].isNPC;
  if(ui._wasMyTurn && !isMine && ui.turnSummaryOn()) ui.showTurnSummary(me);
  ui._wasMyTurn = isMine;
};
// S7：每輪紀錄——把「這一輪發生了什麼、對我的影響是多少」攤在同一頁。
// 資料全部來自 p.ledger（分錄本來就帶 turnNumber）與 p.history（每輪水位快照），
// 不新增任何遊戲狀態，也不影響重放。
ui.showRoundLog = function(pid){
  var S=ui.S, p=S.players[pid]; if(!p) return;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="720px";
  // S12：這個面板可能有幾十輪，關閉鈕在最底下等於要一路捲到最後才關得掉。
  var hdRL=el("div","panelTop");
  hdRL.appendChild(el("h2",null,"📜 "+p.name+" 的每輪紀錄"));
  var xRL=el("button","act","✕ 關閉"); xRL.onclick=function(){ ov.remove(); };
  hdRL.appendChild(xRL);
  box.appendChild(hdRL);
  box.appendChild(el("div","sub","每一輪遇到什麼、帳上怎麼動。五欄分別是現金／資產／負債／收入／支出的變化（收入與支出是每月流量）。最近的在最上面。"));

  // 依輪次分組
  var byTurn={}, turns=[];
  (p.ledger||[]).forEach(function(e){
    var t=e.turnNumber;
    if(!byTurn[t]){ byTurn[t]=[]; turns.push(t); }
    byTurn[t].push(e);
  });
  turns.sort(function(a,b){ return b-a; });          // 最近的在最上面
  if(!turns.length){ box.appendChild(el("div","edu","還沒有任何紀錄。")); }

  var hist={}; (p.history||[]).forEach(function(h){ hist[h.turn]=h; });
  var SKIP=["bookkeeping"];                          // 記帳作答之類的雜訊不列
  turns.forEach(function(t){
    var rows=byTurn[t].filter(function(e){
      return !(e.eduTags||[]).some(function(g){ return SKIP.indexOf(g)>=0; });
    });
    if(!rows.length) return;
    var cashSum=0;
    rows.forEach(function(e){ (e.postings||[]).forEach(function(q){
      if(q.account==="CASH") cashSum+=q.delta; }); });
    cashSum=util.r2(cashSum);

    var sec=el("div","sec"); sec.style.marginTop="8px";
    var hd=el("div"); hd.style.cssText="display:flex;justify-content:space-between;align-items:baseline;font-size:13px";
    hd.appendChild(el("b",null,"第 "+t+" 輪"));
    var hh=hist[t];
    var right=el("span"); right.style.cssText="font-size:12px;color:var(--tx2)";
    right.innerHTML="現金淨變動 <b class='num "+(cashSum>=0?"pos":"neg")+"'>"+
      (cashSum>=0?"+":"")+M(cashSum)+"</b>"+
      (hh? "　被動 "+M(hh.passive)+"／支出 "+M(hh.expense) : "");
    hd.appendChild(right);
    sec.appendChild(hd);

    // S16：改成 Excel 的五欄格式——現金／資產／負債／收入／支出，方便學習與對帳
    var tb=el("table","tb"); tb.style.marginTop="4px";
    tb.innerHTML=ui.ledgerHead();
    rows.forEach(function(e){
      var r=ui.ledgerRow(e);
      var tr=el("tr");
      tr.innerHTML="<td>"+r.summary+
        (r.note?("<br><span style='color:var(--tx3);font-size:11px'>"+r.note+"</span>"):"")+"</td>"+
        "<td style='color:var(--tx3);font-size:11.5px'>"+r.src+"</td>"+ui.ledgerCells(r);
      tb.appendChild(tr);
    });
    // 本輪合計
    var tot=ui.ledgerTotals(rows), trT=el("tr");
    trT.style.cssText="border-top:1px solid var(--line2);font-weight:600";
    trT.innerHTML="<td>本輪合計</td><td></td>"+ui.ledgerCells(tot);
    tb.appendChild(trT);
    sec.appendChild(tb);
    box.appendChild(sec);
  });

  var o=el("div","opts"); o.style.marginTop="10px";
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// M8 S1：放棄學習確認（把沉沒成本講明白）
ui.showAbandonSkill = function(p){
  var S=ui.S; if(!p.learning) return;
  var sc=ns.content.byId[p.learning.skillId];
  var pct=E.cfg(S,"abandonRefundPct"); if(pct===undefined) pct=0.3;
  var refund=util.r2((p.learning.paidCost||0)*pct);
  var sunk=util.r2((p.learning.paidCost||0)-refund);
  var spent=S.turnNumber-p.learning.startTurn;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,"放棄「"+(sc?sc.title:"?")+"」？"));
  box.appendChild(el("div","flavor","你已經投入 "+spent+" 輪與 "+M(p.learning.paidCost||0)+"。"));
  var kv2=el("div","kv");
  kv2.appendChild(el("div","k","退回")); kv2.appendChild(el("div","v num pos","+"+M(refund)));
  kv2.appendChild(el("div","k","收不回來（沉沒成本）")); kv2.appendChild(el("div","v num neg","−"+M(sunk)));
  kv2.appendChild(el("div","k","已花掉的時間")); kv2.appendChild(el("div","v num neg",spent+" 輪"));
  box.appendChild(kv2);
  box.appendChild(el("div","edu","💡 已經投入的時間與金錢要不回來了——決定要不要繼續，只看「從現在起划不划算」，別讓沉沒成本綁架你。"));
  var o=el("div","opts");
  o.appendChild(optBtn("確定放棄","把時間留給別的機會",function(){ ov.remove(); ui.dispatch({type:"ABANDON_SKILL",playerId:ui.myId(),payload:null}); }));
  o.appendChild(optBtn("繼續學完",null,function(){ ov.remove(); },true));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.showWellbeingDetail = function(p){
  var S=ui.S; p=p||S.players[ui.myId()];
  var need=E.winWellbeingMin(S), have=ui.wellbeing(p);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  var hd=el("div"); hd.style.cssText="display:flex;justify-content:space-between;align-items:baseline";
  hd.appendChild(el("h2",null,"♥ 幸福感明細"));
  hd.appendChild(el("b",(have>=need?"pos":"neg"),have+" ／ "+need+" 點"));
  box.appendChild(hd);
  box.appendChild(el("div","sub",p.name+"　幸福感是獲勝的第二個條件——它記錄的是「錢以外」你把人生過成什麼樣子。"));

  var tb=el("table","wbTb");
  var th=el("tr"); ["來源","內容","點數"].forEach(function(h,i){
    var e=el("th",null,h); if(i===2) e.style.textAlign="right"; th.appendChild(e); }); tb.appendChild(th);
  function row(src,detail,pts,cls){
    var tr=el("tr");
    tr.appendChild(el("td",null,src));
    var d2=el("td",null,detail); d2.style.color="var(--tx3)"; d2.style.fontSize="12.5px"; tr.appendChild(d2);
    tr.appendChild(el("td","num"+(cls?" "+cls:""), (pts>0?"+":"")+pts));
    tb.appendChild(tr); return tr;
  }
  var kids=p.childrenCount||0;
  row("👶 家庭","小孩 "+kids+" 位 × 3 點", kids*3, kids?"pos":"");
  var vsum=0, vtxt=[];
  if(S.enabledModules.indexOf("M6")>=0 && p.virtues){
    ["TEMPER","PRUDENCE","PARENTING","FILIAL"].forEach(function(ax){
      var v=p.virtues[ax]||0; vsum+=v; vtxt.push(T("virtue."+ax)+" "+v); });
    row("⭐ 品格四軸", vtxt.join("・"), vsum, vsum?"pos":"");
  }
  row("✨ 夢想進度","已完成 "+(p.dreamProgress||0)+" ／ "+S.config.dreamCost+" 點", (p.dreamProgress||0), p.dreamProgress?"pos":"");
  var ob=(p.stats&&p.stats.optionalBought)||0;
  row("🎁 生活享受","買下的享受型消費 "+ob+" 次", ob, ob?"pos":"");
  var mj=(p.stats&&p.stats.mallJoy)||0;
  var mcount=p.mallBought?Object.keys(p.mallBought).length:0;
  row("🛍 商城正向活動","進修／健康／人情／比賽 "+mcount+" 項", mj, mj?"pos":"");
  var tot=el("tr");
  tot.appendChild(el("td",null,"合計"));
  tot.appendChild(el("td",null, have>=need?"已達門檻":"還差 "+(need-have)+" 點"));
  tot.appendChild(el("td","num "+(have>=need?"pos":"neg"), have+" ／ "+need));
  tot.className="tot"; tb.appendChild(tot);
  box.appendChild(tb);

  // 還能從哪裡補
  if(have<need){
    var tip=el("div","edu"); tip.style.marginTop="10px";
    tip.innerHTML="<b>還可以從這些地方補：</b><br>"+
      "・<b>人生商城</b>：包紅包＋1、孝親金＋2、公益捐款＋2、孩子的才藝課＋2、健身房＋2、健檢＋1、比賽＋1～2<br>"+
      "・<b>品格修養卡</b>（人生格）：四軸各最高 "+(S.config.virtueMaxLevel||3)+" 級，每級 +1<br>"+
      "・<b>夢想進度</b>：每 1 點同時 +1 幸福感<br>"+
      "・<b>生活享受</b>：偶爾對自己好一點，也算數";
    box.appendChild(tip);
  }
  var st=[];
  if(p.flags && p.flags.insured) st.push("🛡 醫療＋意外險投保中");
  if(p.flags && p.flags.fitUntil!==undefined && S.turnNumber<=p.flags.fitUntil) st.push("🏋 健身中（至第 "+p.flags.fitUntil+" 輪）");
  if(p.flags && p.flags.checkedUntil!==undefined && S.turnNumber<=p.flags.checkedUntil) st.push("🩺 健檢有效（至第 "+p.flags.checkedUntil+" 輪）");
  if(p.flags && p.flags.propInsured) st.push("🏠 住宅火險投保中（年繳 "+M(p.flags.propPremium||0)+"，第 "+(p.flags.propRenewAt||0)+" 輪自動續約）");
  if(p.flags && p.flags.network) st.push("🎓 人脈已解鎖（可抽特殊機會）");
  if(st.length){ var sr=el("div","flavor"); sr.style.color="var(--pos)"; sr.textContent="目前生效中："+st.join("　"); box.appendChild(sr); }

  var o=el("div","opts"); o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V11.1：理賠明細卡——把「有沒有事先準備」的差別攤在同一張表上
ui.claimBox = function(S,cl){
  var box=el("div","claimBox");
  var hasSave = cl.saved>0;
  box.appendChild(el("div","ttl", hasSave?"🛡 這筆醫療支出的理賠明細":"⚠ 這筆醫療支出，你全額自付"));
  var tb=el("table","claimTb");
  function row(k,v,cls,strong){
    var tr=el("tr");
    var td1=el("td",null,k); if(strong) td1.style.fontWeight="700";
    var td2=el("td","num"+(cls?" "+cls:"")); td2.textContent=v; if(strong) td2.style.fontWeight="700";
    tr.appendChild(td1); tr.appendChild(td2); tb.appendChild(tr); return tr;
  }
  row("① 原價（帳單金額）", M(cl.gross), "neg");
  if(cl.healthSaved>0) row("② 健康折抵（健身／健檢 −"+Math.round(cl.healthPct*100)+"%）", "−"+M(cl.healthSaved), "pos");
  if(cl.claim>0)       row((cl.healthSaved>0?"③":"②")+" 醫療＋意外險理賠（"+Math.round(cl.claimPct*100)+"%）", "−"+M(cl.claim), "pos");
  var r=row((cl.healthSaved>0&&cl.claim>0)?"④ 實際支付":(hasSave?"③ 實際支付":"② 實際支付"), M(cl.net), "neg", true);
  r.className="tot";
  if(hasSave) row("　　合計省下", M(cl.saved), "pos", true);
  box.appendChild(tb);
  var note=el("div","note");
  if(hasSave){
    note.innerHTML="這 <b>"+M(cl.saved)+"</b> 不是運氣，是你<b>在出事之前</b>就付出去的保費與健身費換來的。"+
      "<br><b>未雨綢繆的意思就是這個：</b>風險發生的那一天，你能做的事已經在很久以前做完了。";
  } else {
    note.innerHTML="這次沒有保險可以分攤——全額 <b>"+M(cl.gross)+"</b> 由現金承擔。"+
      (cl.wouldClaim>0?("<br>如果當初有投保醫療＋意外險，這一筆可以理賠 <b class='pos'>"+M(cl.wouldClaim)+"</b>，你只要付 "+M(util.r2(cl.net-cl.wouldClaim))+"。"):"")+
      "<br><b>未雨綢繆的意思就是這個：</b>保險要在還用不到的時候買，等用得到的時候就來不及了。";
  }
  box.appendChild(note);
  return box;
};

ui.describeEffect = function(e){
  switch(e.op){
    case "CASH_DELTA": return (e.label||"現金")+"："+(e.amount>=0?"+":"")+M(e.amount);
    case "SALARY_MULT": return "薪資 ×"+e.factor;
    case "ADD_CHILD": return "家庭成員 +1（養育支出增加）";
    case "SKIP_TURNS": return "停走 "+(e.n||1)+" 回合";
    case "ASSET_VALUE_MULT": return "資產估值 ×"+e.factor;
    case "ASSET_INCOME_MULT": return "資產收入 ×"+e.factor;
    default: return null;
  }
};

/* ------------------------- 買入面板（含即時預覽） ----------------------- */
ui.buyRealEstate = function(S,p,d,cd,card,c,decide){
  var pl=cd.payload, im=S.config.assetIncomeMult;
  var net=util.r2(pl.monthlyRent*im - pl.monthlyCost);
  var allowLoan = d.allowLoan && E.canUseLoan(S);
  var state={ mode: allowLoan?"loan":"cash", ltv: allowLoan?Math.min(1-pl.downPayment/pl.price, d.maxLTV):0 };
  var kv=el("div","kv");
  var grossYield = pl.price>0 ? net*12/pl.price : 0;
  kv.innerHTML="<div class='k'>總價</div><div class='v num'>"+M(pl.price)+"</div>"+
    "<div class='k'>月租金（×係數 "+im+"）</div><div class='v num pos'>+"+M(pl.monthlyRent*im)+"</div>"+
    "<div class='k'>持有成本</div><div class='v num neg'>−"+M(pl.monthlyCost)+"</div>"+
    "<div class='k'>年化租金報酬率</div><div class='v num "+(grossYield>=0.04?"pos":"")+"'>"+util.pct(grossYield,1)+"</div>";
  card.appendChild(kv);
  var modeRow=el("div","tabs");
  var tCash=el("button","tab"+(state.mode==="cash"?" on":""),T("dec.buyCash"));
  var tLoan=el("button","tab"+(state.mode==="loan"?" on":""),T("dec.buyLoan"));
  if(allowLoan){ modeRow.appendChild(tCash); modeRow.appendChild(tLoan); card.appendChild(modeRow); }
  var slid=el("div","slider");
  var rng=el("input"); rng.type="range"; rng.min=0; rng.max=Math.round(d.maxLTV*100); rng.step=5; rng.value=Math.round(state.ltv*100);
  var slLbl=el("div"); slLbl.style.cssText="font-size:12px;color:var(--tx2)";
  slid.appendChild(slLbl); slid.appendChild(rng);
  var pv=el("div","preview");
  function refresh(){
    var loan = state.mode==="loan" ? util.r2(pl.price*state.ltv) : 0;
    var down = util.r2(pl.price-loan);
    var rate = S.macro.baseRate+E.cfg(S,"mortgageSpread");
    var interest = util.r2(loan*rate/12);
    var cf = util.r2(net-interest);
    var coc = down>0 ? cf*12/down : 0;
    slLbl.textContent = term("LTV")+"：貸 "+Math.round(state.ltv*100)+"%（"+M(loan)+"）　自備 "+M(down);
    tCash.className="tab"+(state.mode==="cash"?" on":""); tLoan.className="tab"+(state.mode==="loan"?" on":"");
    slid.style.display = state.mode==="loan"?"block":"none";
    pv.innerHTML="自備款 <b class='num'>"+M(down)+"</b>"+(loan>0?"　貸款利息 <b class='num neg'>−"+M(interest)+"/月</b>":"")+
      "<br>買下後每月淨現金流：<b class='num "+(cf>=0?"pos":"neg")+"'>"+(cf>=0?"+":"")+M(cf)+"</b>"+
      "　自備報酬率 <b class='num "+(coc>=0?"pos":"neg")+"'>"+util.pct(coc,1)+"</b>"+
      (down>p.cash?"<br><span class='neg'>現金不足（需 "+M(down)+"，你有 "+M(p.cash)+"）</span>":"");
    ui._buy={ mode:state.mode, down:down, params: state.mode==="loan"?{ltv:state.ltv}:{} , afford:down<=p.cash };
  }
  rng.oninput=function(){ state.ltv=(+rng.value)/100; refresh(); };
  tCash.onclick=function(){ state.mode="cash"; refresh(); };
  tLoan.onclick=function(){ state.mode="loan"; refresh(); };
  card.appendChild(slid); card.appendChild(pv);
  refresh();
  var o=el("div","opts");
  var buy=optBtn("買下去",null,function(){ if(!ui._buy.afford){ ui.toast("現金不足","warn"); return; }
    ui.spendGuard(util.r2(p.cash-ui._buy.down), function(){ decide(ui._buy.mode==="loan"?"loan":"cash", ui._buy.params); }); }, net>0);
  o.appendChild(buy);
  ui.oppDealBtns(cd).forEach(function(b){ o.appendChild(b); });
  o.appendChild(optBtn(T("act.skip"),"放棄這個機會",function(){ decide("skip"); }));
  card.appendChild(o); c.appendChild(card);
};

ui.buyStock = function(S,p,d,cd,card,c,decide){
  var def=ns.content.stockBySymbol[cd.payload.symbol], price=S.stockPrices[def.symbol]||cd.payload.offerPrice;
  var nmeRow=el("div","flavor","標的：<b>"+E.stockName(S,def.symbol)+"</b>（現價 "+M(price)+" / 張）"); card.appendChild(nmeRow);
  var maxU=Math.max(1, Math.floor(p.cash/price));
  var state={units:Math.min(maxU, Math.max(1, Math.floor(maxU/3))), margin:false};
  var kv=el("div","kv");
  kv.innerHTML="<div class='k'>現價</div><div class='v num'>"+M(price)+" / 張</div>"+
    "<div class='k'>目前月殖利率</div><div class='v num "+(E.stockYield(S,def)>=def.dividendYieldMonthly?"pos":"")+"'>"+util.pct(E.stockYield(S,def),2)+"</div>"+
    "<div class='k'>波動度</div><div class='v num'>"+util.pct(def.vol,1)+"</div>";
  card.appendChild(kv);
  var slid=el("div","slider"), rng=el("input"); rng.type="range"; rng.min=1; rng.max=Math.max(1,maxU); rng.step=1; rng.value=state.units;
  var lbl=el("div"); lbl.style.cssText="font-size:12px;color:var(--tx2)"; slid.appendChild(lbl); slid.appendChild(rng);
  var marginRow=null;
  if(E.canUseAdvanced(S) && S.enabledModules.indexOf("M1")>=0){
    marginRow=el("div","tabs"); var t0=el("button","tab on","現股"); var t1=el("button","tab","融資");
    t0.onclick=function(){ state.margin=false; refresh(); }; t1.onclick=function(){ state.margin=true; refresh(); };
    marginRow._t0=t0; marginRow._t1=t1; marginRow.appendChild(t0); marginRow.appendChild(t1); card.appendChild(marginRow);
  }
  var pv=el("div","preview");
  function refresh(){
    // 融資模式：自備 = 現價 × 保證金比率，故同樣現金可買更多張
    var perUnitOwn = state.margin ? price*S.config.marginRatio : price;
    var maxNow = Math.max(1, Math.floor(p.cash/perUnitOwn));
    if(+rng.max!==maxNow){ rng.max=maxNow; if(state.units>maxNow){ state.units=maxNow; rng.value=maxNow; } }
    var total=util.r2(price*state.units), own=state.margin?util.r2(total*S.config.marginRatio):total;
    var div=util.r2(state.units*E.stockPerShareDiv(def));
    lbl.textContent=T("dec.units")+"："+state.units+" 張　投入 "+M(total)+"　（上限 "+maxNow+" 張）";
    if(marginRow){ marginRow._t0.className="tab"+(state.margin?"":" on"); marginRow._t1.className="tab"+(state.margin?" on":""); }
    pv.innerHTML="需現金 <b class='num'>"+M(own)+"</b>"+(state.margin?"（其餘融資 "+M(total-own)+"）":"")+
      (div?"<br>月配息 <b class='num pos'>+"+M(div)+"</b>　目前殖利率 "+util.pct(E.stockYield(S,def),2):"<br>此檔為成長股，不配息，賺價差")+
      (own>p.cash?"<br><span class='neg'>現金不足</span>":"");
    ui._buy={ margin:state.margin, units:state.units, own:own, afford:own<=p.cash };
  }
  rng.oninput=function(){ state.units=+rng.value; refresh(); };
  card.appendChild(slid); card.appendChild(pv); refresh();
  var o=el("div","opts");
  o.appendChild(optBtn("買進",null,function(){ if(!ui._buy.afford){ ui.toast("現金不足","warn"); return; }
    var goS=function(){ ui.spendGuard(util.r2(p.cash-ui._buy.own), function(){ decide(ui._buy.margin?"margin":"cash",{units:ui._buy.units}); }); };
    if(ui._buy.margin) ui.marginGuard(def, goS); else goS(); }));
  o.appendChild(optBtn(T("act.skip"),null,function(){ decide("skip"); }));
  card.appendChild(o); c.appendChild(card);
};

ui.buySimple = function(S,p,d,cd,card,c,decide){
  var pl=cd.payload, im=E.incomeMultFor(S,cd.kind);
  var cost = cd.kind==="STARTUP"?pl.investAmount:pl.price;
  var income = cd.kind==="STARTUP"?0:util.r2(pl.monthlyProfit*im);
  var kv=el("div","kv");
  var yieldB = (cd.kind!=="STARTUP" && cost>0) ? income*12/cost : 0;
  kv.innerHTML="<div class='k'>"+(cd.kind==="STARTUP"?"投資金額":"買入價金")+"</div><div class='v num'>"+M(cost)+"</div>"+
    (cd.kind==="STARTUP"?"<div class='k'>取得股權</div><div class='v num'>"+util.pct(pl.equityPct,1)+"</div>":
      "<div class='k'>月分紅（×係數 "+im+"）</div><div class='v num pos'>+"+M(income)+"</div>"+
      "<div class='k'>年化報酬率</div><div class='v num "+(yieldB>=0.04?"pos":"")+"'>"+util.pct(yieldB,1)+"</div>");
  card.appendChild(kv);

  var allowCredit = cd.kind==="BUSINESS" && d.allowCredit && E.canUseLoan(S);
  var creditCap = allowCredit ? (d.creditCap||0) : 0;
  var state={ mode:"cash", loan:0 };
  var modeRow=null, slid=null, rng=null, slLbl=null;
  if(allowCredit){
    modeRow=el("div","tabs");
    var tC=el("button","tab on","全額現金"); var tL=el("button","tab","信貸買入");
    modeRow._tC=tC; modeRow._tL=tL; modeRow.appendChild(tC); modeRow.appendChild(tL); card.appendChild(modeRow);
    slid=el("div","slider"); rng=el("input"); rng.type="range"; rng.min=0;
    rng.max=Math.round(Math.min(creditCap,cost)); rng.step=Math.max(1,Math.round(Math.min(creditCap,cost)/20)); rng.value=Math.round(Math.min(creditCap,Math.max(0,cost-p.cash)));
    slLbl=el("div"); slLbl.style.cssText="font-size:12px;color:var(--tx2)"; slid.appendChild(slLbl); slid.appendChild(rng);
    card.appendChild(slid);
    state.loan=+rng.value;
    tC.onclick=function(){ state.mode="cash"; refresh(); };
    tL.onclick=function(){ state.mode="loan"; refresh(); };
    rng.oninput=function(){ state.loan=+rng.value; refresh(); };
  }
  var pv=el("div","preview");
  function refresh(){
    if(cd.kind==="STARTUP"){ pv.innerHTML="新創股權沒有月現金流，賺的是未來被收購或上市的價差。"
        +(cost>p.cash?"<br><span class='neg'>現金不足（需 "+M(cost)+"）</span>":"");
      ui._buy={mode:"cash",params:{},down:cost,afford:cost<=p.cash}; return; }   // down 不可省略：spendGuard 要用它算操作後現金
    var loan = state.mode==="loan" ? Math.min(state.loan, creditCap, cost) : 0;
    var down = util.r2(cost-loan);
    var crate = S.macro.baseRate+E.cfg(S,"creditSpread");
    var interest = util.r2(loan*crate/12);
    var cf = util.r2(income-interest);
    if(modeRow){ modeRow._tC.className="tab"+(state.mode==="cash"?" on":""); modeRow._tL.className="tab"+(state.mode==="loan"?" on":"");
      slid.style.display=state.mode==="loan"?"block":"none";
      slLbl.textContent="信貸額度上限 "+M(Math.min(creditCap,cost))+"　貸 "+M(loan)+"　自備 "+M(down); }
    pv.innerHTML="自備款 <b class='num'>"+M(down)+"</b>"+(loan>0?"　信貸利息 <b class='num neg'>−"+M(interest)+"/月</b>":"")+
      "<br>買下後每月淨現金流：<b class='num "+(cf>=0?"pos":"neg")+"'>"+(cf>=0?"+":"")+M(cf)+"</b>"+
      (down>p.cash?"<br><span class='neg'>現金不足（需 "+M(down)+"，你有 "+M(p.cash)+"）</span>":"")+
      (allowCredit&&state.mode==="cash"&&cost>p.cash?"<br><span class='num'>現金不夠？可切換「信貸買入」，額度依你的收入</span>":"");
    ui._buy={ mode:state.mode==="loan"&&loan>0?"loan":"cash", params:state.mode==="loan"&&loan>0?{loan:loan}:{}, down:down, afford:down<=p.cash };
  }
  card.appendChild(pv); refresh();
  var o=el("div","opts");
  o.appendChild(optBtn("買下去",null,function(){ if(!ui._buy.afford){ ui.toast("現金不足","warn"); return; }
    ui.spendGuard(util.r2(p.cash-ui._buy.down), function(){ decide(ui._buy.mode,ui._buy.params); }); }, income>0));
  ui.oppDealBtns(cd).forEach(function(b){ o.appendChild(b); });
  o.appendChild(optBtn(T("act.skip"),null,function(){ decide("skip"); }));
  card.appendChild(o); c.appendChild(card);
};

/* --------------------------- 記帳（點選分類） --------------------------- */
ui.renderBookkeeping = function(S,p){
  var c=$("center"), tray=$("bkTray");
  tray.classList.add("hide"); tray.innerHTML="";
  var card=el("div","card");
  card.appendChild(el("h3",null,T("bk.title")));
  card.appendChild(el("div","flavor","把每一筆變動點進正確的欄位——直接點該筆後面的按鈕即可。"));
  var tasks=S.bookkeeping.tasks;
  // V2：台股慣例——資產／收入＝紅（好事），負債／支出＝綠
  var QUAD=[["asset","資產","bkR"],["liab","負債","bkG"],["income","收入","bkR"],["expense","支出","bkG"]];
  var remain=0;
  var listWrap=el("div"); listWrap.style.cssText="display:flex;flex-direction:column;gap:8px;margin:6px 0";
  tasks.forEach(function(t,i){
    if(t.done) return; remain++;
    var row=el("div","sec"); row.style.cssText="padding:9px 10px";
    var top=el("div"); top.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:8px";
    top.appendChild(el("span",null,t.label));
    top.appendChild(el("span","num "+(t.amount>=0?"pos":"neg"),(t.amount>=0?"+":"")+M(t.amount)));
    row.appendChild(top);
    if(t.hint){ var hn=el("div","flavor",t.hint); hn.style.cssText="font-size:11px;margin:3px 0 0"; row.appendChild(hn); }
    var btns=el("div"); btns.style.cssText="display:flex;gap:6px;margin-top:8px";
    QUAD.forEach(function(q){
      var b=el("button","act "+q[2],q[1]); b.style.flex="1"; b.style.padding="9px 0";
      b.onclick=function(){ ui.dispatch({type:"CLASSIFY_ENTRY",playerId:ui.myId(),payload:{taskIdx:i,quadrant:q[0]}}); };
      btns.appendChild(b);
    });
    row.appendChild(btns);
    listWrap.appendChild(row);
  });
  card.appendChild(listWrap);
  var pr=el("div","flavor"); pr.style.marginTop="4px";
  pr.textContent = "還有 "+remain+" 筆要分類（分對分錯都會告訴你正解）";
  card.appendChild(pr);
  card.appendChild(ui.bkAutoBox(S,p));
  c.appendChild(card);
};

// S11：自動記帳開關——選項一直都在，只是還沒練熟之前是鎖著的（會顯示還差幾次）。
// 刻意不做成「達標時跳出來問你要不要開」：那會變成每次打斷，而且錯過就沒了。
ui.bkAutoBox = function(S,p){
  var thr=E.cfg(S,"bkMasteryStreak"); if(thr===undefined) thr=5;
  var box=el("div","claimBox"); box.style.marginTop="10px";
  if(thr<=0){ box.appendChild(el("div","ttl","自動記帳"));
    box.appendChild(el("div","note","本局關閉了熟練度機制（bkMasteryStreak=0）。")); return box; }
  box.appendChild(el("div","ttl","⚙️ 自動記帳（一套一套練熟，練熟的那一套就不用再手記）"));
  box.appendChild(el("div","note",
    "同一筆帳要<b class='gold'>整組分對</b>才算一次——錯一格整筆重來。"+
    "連續 "+thr+" 次就解鎖那一套，開不開由你決定。"+
    "<br>下面依<b class='gold'>實際出現頻率</b>由高到低排（900 局模擬統計）——先練最上面那一套，最快脫離手記。"));
  var grid=el("div"); grid.style.cssText="display:flex;flex-direction:column;gap:7px;margin-top:8px";
  E.BK_GROUPS.forEach(function(g){
    var streak=(p.bkStreak&&p.bkStreak[g.key])||0;
    var unlocked=!!(p.bkUnlocked&&p.bkUnlocked[g.key]);
    var on=!!(p.bkAuto&&p.bkAuto[g.key]);
    var row=el("div","sec"); row.style.cssText="padding:8px 10px";
    var top=el("div"); top.style.cssText="display:flex;align-items:center;gap:8px";
    var lab=el("div"); lab.style.flex="1";
    // S14a-2：把「這一套多常遇到」寫在旁邊——玩家才知道先練哪一套划算
    var freqTxt = g.tier ? (g.tier+"（約 "+Math.round((g.share||0)*100)+"% 的帳）") : "";
    lab.innerHTML="<b>"+g.name+"</b>　<span style='font-size:11.5px;color:var(--tx3)'>"+g.accs+"</span>"+
      (freqTxt?"　<span style='font-size:11px;color:var(--gold);opacity:.85'>"+freqTxt+"</span>":"")+
      "<br><span style='font-size:12px;color:"+(unlocked?"var(--gold)":"var(--tx3)")+"'>"+
      (unlocked ? "已練熟" : "整筆全對 "+streak+" / "+thr+"（錯一格歸零）")+"</span>";
    top.appendChild(lab);
    var b=el("button","act");
    if(!unlocked){
      b.textContent="🔒 未解鎖"; b.disabled=true;
      b.title="這一套再連續整筆答對 "+Math.max(0,thr-streak)+" 次就會亮起來";
      b.style.opacity="0.6";
    } else {
      b.textContent = on ? "✅ 自動中" : "改成自動";
      b.className = "act"+(on?" primary":"");
      b.title = on ? "點此改回手記" : "這一套以後由系統直接記";
      b.onclick=(function(k,nowOn){ return function(){
        ui.dispatch({type:"SET_BK_AUTO",playerId:ui.myId(),payload:{group:k,on:!nowOn}}); }; })(g.key,on);
    }
    b.style.minWidth="118px";
    top.appendChild(b);
    row.appendChild(top);
    row.appendChild(el("div","flavor",g.hint));
    grid.appendChild(row);
  });
  box.appendChild(grid);
  box.appendChild(el("div","note",
    "自動之後這一套的帳還是照記，只是不用你分類了。想重新練手隨時可以改回來——"+
    "報表上的「分類正確率」也會繼續只算你自己分的那些。"));
  return box;
};

ui.makeDraggable = function(pc, idx, zones){
  var startX,startY,ghost,moved;
  function down(e){
    e.preventDefault();
    var pt=e.touches?e.touches[0]:e; startX=pt.clientX; startY=pt.clientY; moved=false; ghost=null;
    document.addEventListener("mousemove",move); document.addEventListener("mouseup",up);
    document.addEventListener("touchmove",move,{passive:false}); document.addEventListener("touchend",up);
  }
  function ensureGhost(){
    if(ghost) return;
    ghost=pc.cloneNode(true); ghost.className="pcard drag";
    var r=pc.getBoundingClientRect();
    ghost.style.left=r.left+"px"; ghost.style.top=r.top+"px"; ghost.style.width=r.width+"px";
    document.body.appendChild(ghost); pc.style.opacity=0.3;
  }
  function move(e){
    if(e.cancelable) e.preventDefault();
    var pt=e.touches?e.touches[0]:e, dx=pt.clientX-startX, dy=pt.clientY-startY;
    if(!moved && Math.abs(dx)+Math.abs(dy)>6) moved=true;
    if(!moved) return;
    ensureGhost();
    ghost.style.transform="translate("+dx+"px,"+dy+"px) scale(1.05)";
    zones.querySelectorAll("[data-zone]").forEach(function(z){ var r=z.getBoundingClientRect();
      z.classList.toggle("dropzone", pt.clientX>=r.left&&pt.clientX<=r.right&&pt.clientY>=r.top&&pt.clientY<=r.bottom); });
  }
  function up(e){
    document.removeEventListener("mousemove",move); document.removeEventListener("mouseup",up);
    document.removeEventListener("touchmove",move); document.removeEventListener("touchend",up);
    var pt=e.changedTouches?e.changedTouches[0]:e, hit=null;
    zones.querySelectorAll("[data-zone]").forEach(function(z){ var r=z.getBoundingClientRect();
      if(pt.clientX>=r.left&&pt.clientX<=r.right&&pt.clientY>=r.top&&pt.clientY<=r.bottom) hit=z.dataset.zone;
      z.classList.remove("dropzone"); });
    if(ghost){ ghost.remove(); ghost=null; } pc.style.opacity=1;
    if(moved){ if(hit) ui.dispatch({type:"CLASSIFY_ENTRY",playerId:ui.myId(),payload:{taskIdx:idx,quadrant:hit}}); }
    else { ui._bkSel = (ui._bkSel===idx ? null : idx); ui.render(); }
  }
  pc.addEventListener("mousedown",down); pc.addEventListener("touchstart",down,{passive:false});
};

/* ----------------------------- 詳情面板 -------------------------------- */
ui.showAsset = function(a){
  var S=ui.S, p=S.players[ui.myId()];
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,a.name));
  var lk=p.liabilities.filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
  var kv=el("div","kv");
  kv.innerHTML="<div class='k'>成本</div><div class='v num'>"+M(a.costBasis)+"</div>"+
    "<div class='k'>市值</div><div class='v num'>"+M(a.marketValue)+"</div>"+
    "<div class='k'>月現金流</div><div class='v num "+(a.monthlyIncome>=0?"pos":"neg")+"'>"+(a.monthlyIncome>=0?"+":"")+M(a.monthlyIncome)+"</div>"+
    (lk?"<div class='k'>連結貸款</div><div class='v num neg'>"+M(lk.principal)+"</div>":"")+
    (a.equityPct?"<div class='k'>股權</div><div class='v num'>"+util.pct(a.equityPct,1)+"</div>":"");
  box.appendChild(kv);
  var canSell = S.activePlayerIdx===ui.myId() && (S.phase==="ROLL"||S.phase==="READY_END");
  var mult=E.sellMult(S,a), sellNet=util.r2(a.marketValue*mult-(lk?lk.principal:0));
  var o=el("div","opts");
  if(canSell){
    o.appendChild(optBtn(T("act.sell")+"（約可拿回 "+M(sellNet)+"）", mult!==1?"目前出場係數 ×"+mult:null, function(){
      ov.remove(); ui.dispatch({type:"SELL_ASSET",playerId:ui.myId(),payload:{assetId:a.instanceId}}); }));
    if(a.kind==="REALESTATE" && E.canUseAdvanced(S) && lk)
      o.appendChild(optBtn(T("act.cashout"),"景氣過熱且增值時，把增值部分借出來",function(){
        ov.remove(); ui.dispatch({type:"CASHOUT_REFI",playerId:ui.myId(),payload:{assetId:a.instanceId}}); }));
  }
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.showLiability = function(l){
  var S=ui.S, p=S.players[ui.myId()];
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,l.name));
  var kv=el("div","kv");
  var isMargin = l.kind==="MARGIN" || !l.termMonths;
  var inGrace = l.studentLoan && !l.amortStarted;
  var interest = util.r2(l.principal*l.annualRate/12);
  var principalPart = util.r2(l.monthlyPayment - interest);
  var orig = l.originalPrincipal!==undefined ? l.originalPrincipal : l.principal;
  var paid = l.periodsPaid||0;
  var repaidPct = orig>0 ? Math.max(0,Math.min(1,(orig-l.principal)/orig)) : 0;
  var termTxt = l.termMonths ? ("／共 "+l.termMonths+" 期") : "";
  kv.innerHTML="<div class='k'>原始貸款金額</div><div class='v num'>"+M(orig)+
      "<span style='color:var(--tx3);font-size:12px'>（第 "+(l.startTurn||0)+" 輪起貸）</span></div>"+
    "<div class='k'>本金餘額</div><div class='v num'>"+M(l.principal)+
      "<span style='color:var(--tx3);font-size:12px'>（已還本金 "+util.pct(repaidPct,0)+"）</span></div>"+
    "<div class='k'>已還期數</div><div class='v num'>"+paid+" 期"+termTxt+"</div>"+
    "<div class='k'>年利率</div><div class='v num'>"+util.pct(l.annualRate,2)+
      (l.isFloating?("（浮動＝基準 "+util.pct(S.macro.baseRate,2)+" ＋加碼 "+util.pct(E.rRate((l.rateSpread===undefined?0:l.rateSpread)+E.creditSpread(S,p)),2)+"）"):"（固定）")+"</div>"+
    "<div class='k'>還款方式</div><div class='v'>"+(isMargin?"只付息（賣出時清償本金）":(inGrace?"學貸寬限期（暫不還）":"本利攤還・"+Math.round(l.termMonths/12)+" 年"))+"</div>"+
    "<div class='k'>每月月付</div><div class='v num neg'>−"+M(l.monthlyPayment)+"</div>"+
    (isMargin||inGrace?"":"<div class='k'>　其中利息／本金</div><div class='v num'>−"+M(interest)+" ／ −"+M(principalPart)+"</div>");
  box.appendChild(kv);
  if(!isMargin && !inGrace) box.appendChild(el("div","flavor","每月月付固定，本金部分逐月降低餘額、累積你的資產淨值。"));
  if(l.isFloating) box.appendChild(el("div","flavor","機動（浮動）利率：央行每 "+(S.config.rateReviewTurns||6)+" 輪檢視基準利率，升息時你的月付會跟著變高——這就是「基準＋加碼」的真實成本。"));
  if(inGrace) box.appendChild(el("div","flavor","畢業後第 "+l.graceUntilTurn+" 輪起，開始分 "+Math.round(l.termMonths/12)+" 年本息攤還。"));
  var myTurnL = S.activePlayerIdx===ui.myId();
  var canAct = myTurnL && (S.phase==="ROLL"||S.phase==="READY_END");
  // S14a-2：提前還本只影響自己 → 非回合也能做；轉貸會改利率結構，維持回合限定。
  var canRepay = !p.bankrupt && !S.over && (!myTurnL || S.phase==="ROLL" || S.phase==="READY_END");
  var o=el("div","opts");
  if(l.kind==="P2P") box.appendChild(el("div","flavor","民間借貸按期攤還給對方（本金＋利息），不提供銀行式提前還本。"));
  if(canRepay && l.kind!=="P2P"){
    var repayAmt=Math.min(p.cash, l.principal);
    if(repayAmt>0) o.appendChild(optBtn(T("act.repay")+"（"+M(repayAmt)+"）",
      "用現金降低本金與利息"+(myTurnL?"":"（不必等自己的回合）"),function(){
      ov.remove(); ui.dispatch({type:"REPAY_LOAN",playerId:ui.myId(),payload:{liabilityId:l.instanceId,amount:repayAmt}}); }));
    if(canAct && l.kind==="MORTGAGE" && E.canUseAdvanced(S)){
      var fee=util.r2(l.principal*E.cfg(S,"refiFee"));
      o.appendChild(optBtn(T("act.refi")+"（手續費 "+M(fee)+"）","鎖定目前利率為固定",function(){
        ov.remove(); ui.dispatch({type:"REFINANCE",playerId:ui.myId(),payload:{liabilityId:l.instanceId}}); }));
    }
  }
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ---------------------- 收支／資產／負債 明細 ------------------------- */
ui.showDetails = function(p){
  var S=ui.S; p=p||S.players[ui.myId()];
  // 依 label 彙總目前的收入與支出組成
  var inc={}, exp={};
  p.ledger.forEach(function(en){ en.postings.forEach(function(q){
    if(q.account==="INCOME_ACTIVE"||q.account==="INCOME_PASSIVE"){ inc[q.label]=(inc[q.label]||0)+q.delta; }
    if(q.account==="EXPENSE"){ exp[q.label]=(exp[q.label]||0)+q.delta; }
  }); });
  function rows(obj, sign){ var ks=Object.keys(obj).filter(function(k){return Math.abs(obj[k])>=0.5;})
      .sort(function(a,b){return Math.abs(obj[b])-Math.abs(obj[a]);});
    return ks.map(function(k){ return "<tr><td>"+k+"</td><td class='num "+(sign*obj[k]>=0?"pos":"neg")+"'>"+
      (obj[k]>=0?"+":"")+M(obj[k])+"</td></tr>"; }).join(""); }
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="640px";
  box.appendChild(el("h2",null,"收支與資產明細"));
  box.appendChild(el("div","sub",p.name+"　每月數字（元）"));
  var wrap=el("div"); wrap.style.cssText="display:grid;grid-template-columns:1fr 1fr;gap:16px";
  function panel(title,html){ var d=el("div"); d.innerHTML="<h4 style='color:var(--tx3);letter-spacing:.14em;font-size:12px;margin:0 0 6px'>"+title+"</h4>"+
    "<table class='tb' style='width:100%'>"+html+"</table>"; return d; }
  wrap.appendChild(panel("收入明細", rows(inc,1)||"<tr><td>—</td><td></td></tr>"));
  wrap.appendChild(panel("支出明細", rows(exp,-1)||"<tr><td>—</td><td></td></tr>"));
  // 資產／負債改為可點擊列（開啟賣出／增貸、還款／轉貸）
  function actPanel(title, items, render, onclick){
    var d=el("div");
    d.appendChild(el("h4",null,title)).style.cssText="color:var(--tx3);letter-spacing:.14em;font-size:12px;margin:0 0 6px";
    if(!items.length){ d.appendChild(el("div","flavor","—")); return d; }
    var tb=el("table","tb"); tb.style.width="100%";
    items.forEach(function(it){ var tr=el("tr"); tr.innerHTML=render(it);
      tr.style.cursor="pointer"; tr.title="點擊操作";
      tr.onclick=function(){ ov.remove(); onclick(it); }; tb.appendChild(tr); });
    d.appendChild(tb);
    var hint=el("div","flavor","👆 點任一列可操作"); hint.style.fontSize="11px"; d.appendChild(hint);
    return d;
  }
  wrap.appendChild(actPanel("資產明細（點擊可賣出／增貸）", p.assets, function(a){
    var vac = a.vacantUntilTurn!==undefined
      ? " <span class='neg' style='font-size:11px'>🏚 空租至第 "+a.vacantUntilTurn+" 輪（原租金 "+M(a.vacantIncome||0)+"）</span>" : "";
    return "<td>"+a.name+(a.units>1?" ×"+a.units:"")+vac+"</td><td class='num'>"+M(a.marketValue)+
      "</td><td class='num "+(a.monthlyIncome>=0?"pos":"neg")+"'>"+(a.monthlyIncome>=0?"+":"")+M(a.monthlyIncome)+"/月</td>";
  }, function(a){ if(a.kind==="P2P_LOAN"){ ui.toast("P2P 債權每輪自動回收本息，不可出售或增貸","warn",3500); return; } ui.showAsset(a); }));
  wrap.appendChild(actPanel("負債明細（點擊可還款／轉貸）", p.liabilities, function(l){
    return "<td>"+l.name+"</td><td class='num neg'>"+M(l.principal)+
      "</td><td class='num neg'>−"+M(l.monthlyPayment)+"/月　"+util.pct(l.annualRate,2)+"</td>";
  }, function(l){ ui.showLiability(l); }));
  box.appendChild(wrap);
  var o=el("div","opts"); o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ------------------------------ 玩家間交易 ------------------------------ */
/* §3.1/§3.2：機會處置按鈕——買下／發起拍賣／找人合資／跳過 */
ui.oppDealBtns = function(cd){
  var S=ui.S, me=S.players[S.activePlayerIdx], out=[];
  var others=S.players.filter(function(x){return x.id!==me.id && !x.bankrupt;});
  if(!others.length) return out;
  if(E.oppIncome(S,cd)<=0) return out;   // 股票／新創無月現金流，NPC 估值必為 0：不提供拍賣/合資，避免死路
  out.push(optBtn("發起拍賣","所有玩家密封出價一輪，最高價得標，價金歸你",function(){
    ui.dispatch({type:"START_OPP_AUCTION",playerId:S.activePlayerIdx,payload:{cardId:cd.id}});
  }));
  if(ui.showJvPanel) out.push(optBtn("找人合資","選一位夥伴按出資比共同持有，各自持份獨立",function(){ ui.showJvPanel(cd); }));
  // V10：吃不下就轉介出去，收 1–2 個月現金流的介紹費
  var fee=E.referralFee(S,cd);
  if(fee>0) out.push(optBtn("轉介給他人（收介紹費 "+M(fee)+"）",
    "自己不買，把案子介紹給別人做，收一筆介紹費",function(){ ui.showReferPanel(cd); }));
  return out;
};
// §3.2 合資 modal：選夥伴＋出資比滑桿＋雙方分攤試算
ui.showJvPanel = function(cd){
  var S=ui.S, me=S.players[S.activePlayerIdx];
  var others=S.players.filter(function(x){return x.id!==me.id && !x.bankrupt;});
  if(!others.length) return;
  var minS=E.cfg(S,"jvMinShare"); if(minS===undefined) minS=0.2;
  var myShare=0.5, target=others[0];
  var entry=E.oppEntry(S,cd), inc=E.oppIncome(S,cd);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="480px";
  box.appendChild(el("h2",null,"找人合資：「"+cd.title+"」"));
  box.appendChild(el("div","flavor","出資比＝股權比；成立後是兩筆獨立資產，各自負擔貸款、各自承受修繕與空租，也可各自轉賣（少數持份通常得折價——這正是課題）。"));
  var tWrap=el("div"); tWrap.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0";
  var tBtns={};   // DOM 存區域 map，不掛 state（§1.9-1）
  var ALLJ={ id:null, name:"所有人", isNPC:false };
  // S13.1 §3：要找誰合資，得先看得到對方的現金水位與被動收入
  others.forEach(function(o2){
    var b=el("button","act");
    b.innerHTML="<b>"+o2.name+(o2.isNPC?"（電腦）":"")+"</b><br>"+
      "<span style='font-size:11.5px;color:var(--tx3)'>現金 "+M(o2.cash)+"　被動 "+M(o2.derived.passiveIncome)+"／月</span>";
    b.style.textAlign="left";
    b.onclick=function(){ target=o2; refresh(); }; tBtns[o2.id]=b; tWrap.appendChild(b); });
  var bAllJ=el("button","act","📢 所有人（先答應先合資）");
  bAllJ.onclick=function(){ target=ALLJ; refresh(); }; tBtns["ALL"]=bAllJ; tWrap.appendChild(bAllJ);
  box.appendChild(el("div",null,"合資夥伴")); box.appendChild(tWrap);
  var slid=el("div","slider"), rng=el("input"); rng.type="range";
  // V4：出資比受自身現金限制——只有 100 元不能拉 1000 元的股份
  var shareCap=Math.min(1-minS, Math.floor((me.cash/Math.max(1,entry))*10)/10);
  var canJV = shareCap >= minS-1e-9;
  rng.min=Math.round(minS*100); rng.max=Math.round(Math.max(minS,(canJV?shareCap:minS))*100); rng.step=10;
  rng.value=Math.min(50, Math.round((canJV?shareCap:minS)*100));
  myShare=(+rng.value)/100;
  var lbl=el("div"); lbl.style.cssText="font-size:12px;color:var(--tx2)";
  slid.appendChild(lbl); slid.appendChild(rng); box.appendChild(slid);
  if(!canJV) box.appendChild(el("div","flavor","⚠ 你的現金連最低出資比（"+Math.round(minS*100)+"%＝"+M(util.r2(entry*minS))+"）都出不起——先累積現金再來合資。"));
  var pv=el("div","preview"); box.appendChild(pv);
  var o=el("div","opts");
  var goBtn=optBtn("提出合資","",function(){
    if(!canJV){ ui.toast("現金不足最低出資比，無法提出合資","warn"); return; }
    ov.remove();
    ui.dispatch({type:"PROPOSE_JV",playerId:S.activePlayerIdx,
      payload:{cardId:cd.id, partnerId:target.id, myShare:myShare}}); },true);
  function refresh(){
    others.forEach(function(o2){ tBtns[o2.id].className="act"+(o2===target?" on":""); });
    tBtns["ALL"].className="act"+(target===ALLJ?" on":"");
    lbl.textContent="你的出資比 "+Math.round(myShare*100)+"%（夥伴 "+Math.round((1-myShare)*100)+"%）";
    var myE=util.r2(entry*myShare), pE=util.r2(entry-myE);
    var myI=util.r2(inc*myShare), pI=util.r2(inc-myI);
    pv.innerHTML="你出 <b class='num"+(myE>me.cash?" neg":"")+"'>"+M(myE)+"</b>（月現金流約 <b class='num pos'>+"+M(myI)+"</b>）"+
      "<br>"+(target===ALLJ?"對方":target.name)+" 出 <b class='num"+
        ((target!==ALLJ && target.cash<pE)?" neg":"")+"'>"+M(pE)+"</b>（月現金流約 +"+M(pI)+"）"+
        ((target!==ALLJ) ? ("　<span style='color:var(--tx3)'>對方現金 "+M(target.cash)+
          (target.cash<pE?"　⚠ 可能出不起":"")+"</span>") : "")+
      "<br><span style='color:var(--tx3)'>"+(target===ALLJ?"廣播：真人先答應先合資；沒人要才輪詢電腦"
        :(target.isNPC?"電腦會評估自身現金水位後決定接不接受":"對方畫面會跳出邀約，由對方親自決定"))+"</span>";
    var sm=goBtn.querySelector("small"); if(sm) sm.textContent="向 "+target.name+" 提出 "+Math.round(myShare*100)+"/"+Math.round((1-myShare)*100)+" 合資";
  }
  rng.oninput=function(){ myShare=(+rng.value)/100; refresh(); }; refresh();
  o.appendChild(goBtn);
  o.appendChild(optBtn(T("act.close"),"回到原本的買/跳過",function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// 拍賣結果 modal：逐家亮出出價 → 宣布得標者與價金
ui.showAuctionResult = function(e){
  var S=ui.S, ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="460px";
  box.appendChild(el("h2",null,"🔨 拍賣結果：「"+e.title+"」"));
  var tb=el("table","tb"); tb.style.width="100%";
  tb.innerHTML="<tr><th>玩家</th><th>出價</th></tr>";
  (e.bids||[]).forEach(function(b){
    var pl=S.players[b.playerId], tr=el("tr");
    var isWin=(e.winnerId===b.playerId);
    tr.innerHTML="<td>"+pl.name+(isWin?" 🏆":"")+"</td><td class='num "+(b.amount>0?(isWin?"gold":""):"")+"'>"+
      (b.amount>0?M(b.amount):"不出價")+"</td>";
    tb.appendChild(tr);
  });
  box.appendChild(tb);
  if(e.winnerId!==null && e.winnerId!==undefined){
    var wn=S.players[e.winnerId];
    box.appendChild(el("div","edu",wn.name+" 以 "+M(e.price)+" 拍下「"+e.title+"」並自行出資接手；價金 "+M(e.price)+" 歸抽卡人 "+S.players[e.sellerId].name+"。你的機會有價——放掉它之前，先讓市場出個價。"));
  } else {
    box.appendChild(el("div","edu","流標：沒有人出價（或都買不起）。機會回到你手上，可以買下或跳過。"));
  }
  var o=el("div","opts"); o.appendChild(optBtn("我知道了",null,function(){ ov.remove(); },true));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};


/* §4 P2P 借貸面板：放款／借款、對象、金額、利率滑桿、月付試算 */
ui.showP2PPanel = function(rescueMode){
  var S=ui.S, me=S.players[ui.myId()];
  // V11：破產程序中也可開（強制借款模式），這是資產賣光後的最後手段
  var inBankruptcy = S.phase==="BANKRUPTCY";
  if(!inBankruptcy && (S.activePlayerIdx!==ui.myId() || (S.phase!=="ROLL" && S.phase!=="READY_END"))){
    ui.toast("交易與借貸只能在你自己的回合進行","warn",3000); return; }
  if(me.bankrupt){ ui.toast("你已破產出局","warn"); return; }
  var others=S.players.filter(function(x){ return x.id!==me.id && !x.bankrupt; });
  if(!others.length){ ui.toast("沒有可交易的對象","warn"); return; }
  var maxR=E.cfg(S,"p2pMaxRate"); if(maxR===undefined) maxR=0.18;
  var term=E.cfg(S,"p2pDefaultTerm"); if(term===undefined) term=24;
  var st={ mode:(inBankruptcy||rescueMode)?"borrow":"lend", target:others[0],
           amount:Math.max(100, inBankruptcy?Math.ceil(-me.cash):100),
           rate:E.rRate(S.macro.baseRate+0.06) };
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  var tabRow=el("div","tabs"); tabRow.style.marginBottom="8px";
  var tabA=el("button","tab","轉讓資產"), tabL=el("button","tab on","借貸（P2P）");
  tabRow.appendChild(tabA); tabRow.appendChild(tabL); box.appendChild(tabRow);
  tabA.onclick=function(){ ov.remove(); ui.showTradePanel(); };
  box.appendChild(el("h2",null,"民間借貸（P2P）"));
  box.appendChild(el("div","sub","銀行不借了，還有人肯借你——代價是更高的利率。每輪結算一期（"+term+" 期）。真人親自回應；電腦依現金水位與信用評級決定。"));
  // V4：進行中的民間借貸一覽（誰借誰、多少錢、什麼利率）
  (function(){
    var rows=[];
    S.players.forEach(function(bw){
      (bw.liabilities||[]).forEach(function(l){
        if(l.kind!=="P2P") return;
        var ln=S.players[l.counterpartyId];
        rows.push((ln?ln.name:"?")+" → "+bw.name+"　餘額 "+M(l.principal)+"　年利率 "+util.pct(l.annualRate,1)+"　月付 "+M(l.monthlyPayment));
      });
    });
    var secP=el("div","sec"); secP.style.cssText="padding:8px 10px;margin:6px 0";
    secP.appendChild(el("b",null,"進行中的民間借貸"));
    if(rows.length) rows.forEach(function(r){ var d=el("div",null,r); d.style.cssText="font-size:12.5px;color:var(--tx2);margin-top:3px"; secP.appendChild(d); });
    else secP.appendChild(el("div",null,"（目前沒有任何一筆）")).style.cssText="font-size:12.5px;color:var(--tx3);margin-top:3px";
    box.appendChild(secP);
  })();
  var mWrap=el("div","tabs");
  var mLend=el("button","tab","我要放款"), mBorrow=el("button","tab","我要借款");
  mWrap.appendChild(mLend); mWrap.appendChild(mBorrow); box.appendChild(mWrap);
  mLend.onclick=function(){ st.mode="lend"; refresh(); };
  mBorrow.onclick=function(){ st.mode="borrow"; refresh(); };
  box.appendChild(el("div",null,"對象"));
  var tWrap=el("div"); tWrap.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0";
  var tBtns={};
  var ALLP={ id:null, name:"所有人", isNPC:false, cash:0 };   // V3：廣播借款（僅借款模式）
  others.forEach(function(o2){ var b=el("button","act",o2.name+(o2.isNPC?"（電腦）":""));
    b.onclick=function(){ st.target=o2; refresh(); }; tBtns[o2.id]=b; tWrap.appendChild(b); });
  var bAllP=el("button","act","📢 所有人（先答應先成交）");
  bAllP.onclick=function(){ st.target=ALLP; refresh(); }; tBtns["ALL"]=bAllP; tWrap.appendChild(bAllP);
  box.appendChild(tWrap);
  var slidA=el("div","slider"), rngA=el("input"); rngA.type="range"; rngA.min=10; rngA.step=10;
  var lblA=el("div"); lblA.style.cssText="font-size:12px;color:var(--tx2)";
  slidA.appendChild(lblA); slidA.appendChild(rngA); box.appendChild(slidA);
  var slidR=el("div","slider"), rngR=el("input"); rngR.type="range";
  rngR.min=Math.round((S.macro.baseRate+0.01)*1000); rngR.max=Math.round(maxR*1000); rngR.step=5;
  var lblR=el("div"); lblR.style.cssText="font-size:12px;color:var(--tx2)";
  slidR.appendChild(lblR); slidR.appendChild(rngR); box.appendChild(slidR);
  var pv=el("div","preview"); box.appendChild(pv);
  var o=el("div","opts");
  var goBtn=optBtn("提出","",function(){
    var lenderId = st.mode==="lend" ? me.id : st.target.id;
    var borrowerId = st.mode==="lend" ? st.target.id : me.id;
    ov.remove();
    ui.dispatch({type:"PROPOSE_P2P",playerId:me.id,
      payload:{lenderId:lenderId, borrowerId:borrowerId, amount:st.amount, annualRate:st.rate, termMonths:term}});
  },true);
  function refresh(){
    mLend.className="tab"+(st.mode==="lend"?" on":""); mBorrow.className="tab"+(st.mode==="borrow"?" on":"");
    others.forEach(function(o2){ tBtns[o2.id].className="act"+(o2===st.target?" on":""); });
    tBtns["ALL"].className="act"+(st.target===ALLP?" on":"");
    tBtns["ALL"].textContent = st.mode==="lend" ? "📢 所有人（先答應先借到）" : "📢 所有人（先答應先成交）";
    var maxOther=0; others.forEach(function(o2){ if(o2.cash>maxOther) maxOther=o2.cash; });
    var capA = st.mode==="lend" ? Math.max(10,Math.floor(me.cash))
             : (st.target===ALLP ? Math.max(10,Math.floor(maxOther*0.5))   // V4：廣播借款上限＝他人現金最大值的 50%
                                 : Math.max(10,Math.floor(st.target.cash)));
    rngA.max=capA; if(st.amount>capA) st.amount=capA; rngA.value=st.amount;
    rngR.value=Math.round(st.rate*1000);
    var pay=E.pmt(st.amount, st.rate, term);
    var borrower = st.mode==="lend" ? st.target : me;
    var minR=E.p2pMinRate(S,borrower);
    lblA.textContent=(st.mode==="lend"?"放款":"借款")+"金額 "+M(st.amount)+(st.mode==="lend"?"（你的現金 "+M(me.cash)+"）":(st.target===ALLP?"（廣播上限＝他人現金最大值的一半）":"（對方現金 "+M(st.target.cash)+"）"));
    lblR.textContent="年利率 "+util.pct(st.rate,1)+"（上限 "+util.pct(maxR,0)+"）";
    var bankHint="";
    if(st.mode==="borrow" && E.canUseLoan(S) && E.creditCapacity(S,me)>=1)
      bankHint="<br><span style='color:var(--gold)'>💡 你的銀行額度還沒用完，銀行利率通常更低——可先用「貸款」；當然，民間借貸隨時可談。</span>";
    var humanHint = st.target.isNPC ? "" :
      "<br><span style='color:var(--tx3)'>對方是真人：邀約會跳到對方畫面，由對方按下接受才成立</span>";
    pv.innerHTML="每輪一期，共 "+term+" 期　月付 <b class='num'>"+M(pay)+"</b>"+
      "<br>借款人 "+borrower.name+" 信用 "+(borrower.creditRating||"B")+
      "；電腦放款人要求利率 ≥ <b class='num'>"+util.pct(minR,1)+"</b>"+
      (st.mode==="lend"&&st.target.isNPC?"<br><span style='color:var(--tx3)'>電腦借款人只在銀行額度用罄時才向民間借</span>":"")+
      bankHint+humanHint;
    var sm=goBtn.querySelector("small");
    if(sm) sm.textContent=(st.mode==="lend"?"放款給 ":"向 ")+st.target.name+(st.mode==="lend"?"":" 借款")+"　"+M(st.amount)+"／"+util.pct(st.rate,1);
  }
  rngA.oninput=function(){ st.amount=+rngA.value; refresh(); };
  rngR.oninput=function(){ st.rate=E.rRate((+rngR.value)/1000); refresh(); };
  refresh();
  o.appendChild(goBtn);
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.showTradePanel = function(){
  var S=ui.S, me=S.players[ui.myId()];
  // 八期：原本用 activePlayerIdx，NPC 回合按下會靜默無反應（看起來像壞掉）
  // V1：寫死 0 → ui.myId()，多人時非 0 號座位才開得了面板
  if(S.activePlayerIdx!==ui.myId() || (S.phase!=="ROLL" && S.phase!=="READY_END")){
    ui.toast("交易與借貸只能在你自己的回合進行","warn",3000); return; }
  if(me.bankrupt){ ui.toast("你已破產出局","warn"); return; }
  var sellable=me.assets.filter(function(a){ return !a.linkedLiabilityId && a.kind!=="P2P_LOAN"; });   // §4：債權不可轉讓
  var others=S.players.filter(function(x){ return x.id!==me.id && !x.bankrupt; });
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  var tabRow=el("div","tabs"); tabRow.style.marginBottom="8px";
  var tabA=el("button","tab on","轉讓資產"), tabL=el("button","tab","借貸（P2P）");
  tabRow.appendChild(tabA); tabRow.appendChild(tabL); box.appendChild(tabRow);
  tabL.onclick=function(){ ov.remove(); ui.showP2PPanel(); };
  box.appendChild(el("h2",null,"轉讓資產給其他玩家"));
  box.appendChild(el("div","sub","把手上會生錢的資產開價賣給對手；對方（含電腦）會出價、還價或拒絕。有貸款的資產須先還清才能轉讓。"));
  if(!sellable.length){ box.appendChild(el("div","flavor","你目前沒有可轉讓的資產（有貸款的不能轉讓）。"));
    var b0=el("button","opt",T("act.close")); b0.onclick=function(){ ov.remove(); }; box.appendChild(b0);
    ov.appendChild(box); $("overlays").appendChild(ov); return; }
  var ALL={ id:null, name:"所有人", isNPC:false };   // V1：廣播報價（先搶先贏）
  var st={ asset:sellable[0], target:others[0], price:sellable[0]?sellable[0].marketValue:0 };
  // 選資產
  box.appendChild(el("h4",null,"要轉讓的資產"));
  var aWrap=el("div"); aWrap.style.cssText="display:flex;flex-direction:column;gap:6px;margin:6px 0";
  var aBtns={}, oBtns={};  // DOM 只存區域 map，絕不掛到 state（會污染 structuredClone）
  sellable.forEach(function(a){
    var r=el("button","act"); r.style.cssText="text-align:left;padding:9px 11px";
    r.innerHTML="<b>"+a.name+"</b>　市值 "+M(a.marketValue)+"　月現金流 "+(a.monthlyIncome>=0?"+":"")+M(a.monthlyIncome);
    r.onclick=function(){ st.asset=a; st.price=a.marketValue; refresh(); };
    aBtns[a.instanceId]=r; aWrap.appendChild(r);
  });
  box.appendChild(aWrap);
  // 選對象
  box.appendChild(el("div",null,"賣給誰"));
  var tWrap=el("div"); tWrap.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0";
  others.forEach(function(o){ var b=el("button","act",o.name+(o.isNPC?"（電腦）":"")); b.onclick=function(){ st.target=o; refresh(); }; oBtns[o.id]=b; tWrap.appendChild(b); });
  var bAll=el("button","act","📢 廣播給所有人");
  bAll.onclick=function(){ st.target=ALL; refresh(); }; oBtns["ALL"]=bAll; tWrap.appendChild(bAll);
  box.appendChild(tWrap);
  // 開價
  var slid=el("div","slider"), rng=el("input"); rng.type="range"; rng.min=0; rng.step=1;
  var lbl=el("div"); lbl.style.cssText="font-size:12px;color:var(--tx2)"; slid.appendChild(lbl); slid.appendChild(rng);
  box.appendChild(slid);
  var pv=el("div","preview"); box.appendChild(pv);
  function refresh(){
    sellable.forEach(function(a){ aBtns[a.instanceId].className="act"+(a===st.asset?" on":""); });
    others.forEach(function(o){ oBtns[o.id].className="act"+(o===st.target?" on":""); });
    oBtns["ALL"].className="act"+(st.target===ALL?" on":"");
    rng.max=Math.max(1, Math.round(st.asset.marketValue*2)); if(st.price>rng.max) st.price=rng.max; rng.value=st.price;
    lbl.textContent="開價："+M(st.price)+"（市值 "+M(st.asset.marketValue)+"）";
    var pl=util.r2(st.price-st.asset.costBasis);
    pv.innerHTML="你將收到現金 <b class='num pos'>"+M(st.price)+"</b>，交出月現金流 <b class='num neg'>"+M(st.asset.monthlyIncome)+"</b>"+
      "<br>相對成本損益 <b class='num "+(pl>=0?"pos":"neg")+"'>"+(pl>=0?"+":"")+M(pl)+"</b>"+
      (st.target===ALL?"<br><span style='color:var(--tx3)'>📢 廣播：真人玩家先搶先贏；沒人接手才輪詢電腦，全婉拒就流標</span>":"");
  }
  rng.oninput=function(){ st.price=+rng.value; refresh(); };
  refresh();
  var o=el("div","opts");
  o.appendChild(optBtn("提出報價","把 "+st.asset.name+" 開價賣出",function(){
    ov.remove();
    ui.dispatch({type:"PROPOSE_TRADE",playerId:ui.myId(),payload:{sellerId:me.id,buyerId:st.target.id,assetId:st.asset.instanceId,price:st.price}});
  },true));
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// 對手還價 → 你決定接受或不賣
ui.showCounter = function(pt){
  if(!pt || pt.status!=="counter") return;
  var S=ui.S, buyer=S.players[pt.buyerId];
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,buyer.name+" 還價"));
  box.appendChild(el("div","flavor","你開價 "+M(pt.askPrice)+"，"+buyer.name+"（電腦）願意用 "+M(pt.counterPrice)+" 收購「"+pt.name+"」。"));
  var o=el("div","opts");
  o.appendChild(optBtn("接受 "+M(pt.counterPrice),"成交並轉讓",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:pt.sellerId,payload:{accept:true}}); },true));
  o.appendChild(optBtn("不賣","保留這筆資產",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:pt.sellerId,payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// 預留：多人同機時，人類玩家收到轉讓報價
ui.showTradeOffer = function(pt){
  if(!pt || pt.status!=="await_human") return;
  var S=ui.S, seller=S.players[pt.sellerId], buyer=S.players[pt.buyerId];
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,seller.name+" 想賣你一項資產"));
  box.appendChild(el("div","flavor",seller.name+" 開價 "+M(pt.askPrice)+" 要把「"+pt.name+"」賣給 "+buyer.name+"。你的現金 "+M(buyer.cash)+"。"));
  var o=el("div","opts");
  o.appendChild(optBtn("買下 "+M(pt.askPrice),"接受並受讓",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:pt.buyerId,payload:{accept:true,price:pt.askPrice}}); }, buyer.cash>=pt.askPrice));
  o.appendChild(optBtn("拒絕",null,function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:pt.buyerId,payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V1：廣播報價視窗——每個有資格的真人都會看到，先搶先贏
ui.showOpenOffer = function(pt){
  if(!pt || pt.status!=="open" || !ui.S) return;
  var S=ui.S, me=S.players[ui.myId()], seller=S.players[pt.sellerId];
  if(!me || me.id===pt.sellerId || me.bankrupt) return;
  if(pt.declined && pt.declined[me.id]) return;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,"📢 "+seller.name+" 廣播出售資產"));
  box.appendChild(el("div","flavor","「"+pt.name+"」開價 "+M(pt.askPrice)+"，賣給最先出手的人。你的現金 "+M(me.cash)+"。"));
  var o=el("div","opts");
  o.appendChild(optBtn("買下 "+M(pt.askPrice),"先搶先贏",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:ui.myId(),payload:{accept:true}}); }, me.cash>=pt.askPrice));
  o.appendChild(optBtn("不買","讓給別人或電腦",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_TRADE",playerId:ui.myId(),payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V1：P2P 邀約視窗——只在被邀的那位玩家畫面出現
ui.showP2POffer = function(pq){
  if(!pq || !ui.S) return;
  var S=ui.S, me=S.players[ui.myId()];
  if(!me) return;
  if(pq.openLend){
    // V4 廣播放款：任何真人（非放款人、未婉拒）都會看到
    if(me.isNPC || me.id===pq.lenderId || me.bankrupt) return;
    if(pq.declined && pq.declined[me.id]) return;
    var lnO=S.players[pq.lenderId], payL=E.pmt(pq.amount,pq.rate,pq.term);
    var ovL=el("div","overlay"), boxL=el("div","sheetbox"); boxL.style.maxWidth="480px";
    boxL.appendChild(el("h2",null,"💸 "+lnO.name+" 想放款（問所有人）"));
    boxL.appendChild(el("div","flavor","金額 "+M(pq.amount)+"　年利率 "+util.pct(pq.rate,1)+"　"+pq.term+" 期　每輪月付 "+M(payL)+
      "。第一位答應的人借到；全婉拒就輪詢電腦。"));
    if(E.canUseLoan(S) && E.creditCapacity(S,me)>=1)
      boxL.appendChild(el("div","flavor","💡 提醒：你的銀行額度還沒用完，銀行利率通常更低。當然，願意就成交。"));
    var oL=el("div","opts");
    oL.appendChild(optBtn("我要借","現金 +"+M(pq.amount)+"，之後每輪還 "+M(payL),function(){ ovL.remove();
      ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:true}}); },true));
    oL.appendChild(optBtn("不需要","讓給別人或電腦",function(){ ovL.remove();
      ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:false}}); }));
    boxL.appendChild(oL); ovL.appendChild(boxL); $("overlays").appendChild(ovL);
    return;
  }
  if(pq.open){
    // V3 廣播借款：任何真人（非借款人、未婉拒）都會看到
    if(me.isNPC || me.id===pq.borrowerId || me.bankrupt) return;
    if(pq.declined && pq.declined[me.id]) return;
    var bwO=S.players[pq.borrowerId], payO=E.pmt(pq.amount,pq.rate,pq.term);
    var ovO=el("div","overlay"), boxO=el("div","sheetbox"); boxO.style.maxWidth="480px";
    boxO.appendChild(el("h2",null,"💸 "+bwO.name+" 想借一筆錢（問所有人）"));
    boxO.appendChild(el("div","flavor","金額 "+M(pq.amount)+"　年利率 "+util.pct(pq.rate,1)+"　"+pq.term+" 期　每輪收回 "+M(payO)+
      "（含利息，屬被動收入）。第一位答應的人成交；全婉拒就輪詢電腦。你的現金 "+M(me.cash)+"。"));
    var oO=el("div","opts");
    oO.appendChild(optBtn("我來放款","賺利息，也承擔對方違約的風險",function(){ ovO.remove();
      ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:true}}); }, me.cash>=pq.amount));
    oO.appendChild(optBtn("不放款","讓給別人或電腦",function(){ ovO.remove();
      ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:false}}); }));
    boxO.appendChild(oO); ovO.appendChild(boxO); $("overlays").appendChild(ovO);
    return;
  }
  if(pq.targetId!==me.id) return;
  var ln=S.players[pq.lenderId], bw=S.players[pq.borrowerId];
  var iAmBorrower = pq.borrowerId===me.id;
  var pay=E.pmt(pq.amount, pq.rate, pq.term);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="480px";
  box.appendChild(el("h2",null, iAmBorrower ? ("💸 "+ln.name+" 想借你一筆錢") : ("💸 "+bw.name+" 想向你借錢")));
  box.appendChild(el("div","flavor","金額 "+M(pq.amount)+"　年利率 "+util.pct(pq.rate,1)+"　"+pq.term+" 期　每輪月付 "+M(pay)+
    (iAmBorrower ? "" : "　·　你的現金 "+M(me.cash))));
  if(iAmBorrower && E.canUseLoan(S) && E.creditCapacity(S,me)>=1)
    box.appendChild(el("div","flavor","💡 提醒：你的銀行額度還沒用完，銀行利率通常更低。當然，願意就成交。"));
  var o=el("div","opts");
  o.appendChild(optBtn("接受","成立借貸並開始按期還款",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:true}}); },
    iAmBorrower || me.cash>=pq.amount));
  o.appendChild(optBtn("婉拒",null,function(){ ov.remove();
    ui.dispatch({type:"RESPOND_P2P",playerId:ui.myId(),payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V2：真人密封出價——每位真人親自出價（看得到完整卡片，資訊與賣方對等）
ui.showBidPanel = function(pa){
  if(!pa || !ui.S) return;
  var S=ui.S, me=S.players[ui.myId()];
  if(!me || pa.waiting.indexOf(me.id)<0) return;
  var card=ns.content.byId[pa.cardId], seller=S.players[pa.sellerId];
  var entry=E.oppEntry(S,card), inc=E.oppIncome(S,card);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"🔨 密封出價"));
  box.appendChild(el("div","sub",seller.name+" 把這張機會拿出來拍賣。得標者自己出資買下（入手約 "+M(entry)+"、月現金流約 "+M(inc)+"），另把「出價」當價金付給 "+seller.name+"。出價互相看不到，全員出完才開標，最高價得標。你的現金 "+M(me.cash)+"。"));
  box.appendChild(cardFace(card));
  var st={bid:0};
  var slid=el("div","slider"), rng=el("input"); rng.type="range"; rng.min=0; rng.step=10;
  rng.max=Math.max(0,Math.floor(me.cash));
  var lbl=el("div"); lbl.style.cssText="font-size:12px;color:var(--tx2)";
  slid.appendChild(lbl); slid.appendChild(rng); box.appendChild(slid);
  function refresh(){ rng.value=st.bid; lbl.textContent="出價："+M(st.bid)+(st.bid===0?"（0＝棄標）":""); }
  rng.oninput=function(){ st.bid=+rng.value; refresh(); }; refresh();
  var o=el("div","opts");
  o.appendChild(optBtn("送出出價","密封投標，開標前保密",function(){ ov.remove();
    ui.dispatch({type:"PLACE_BID",playerId:ui.myId(),payload:{amount:st.bid}}); },true));
  o.appendChild(optBtn("棄標","不參與這次拍賣",function(){ ov.remove();
    ui.dispatch({type:"PLACE_BID",playerId:ui.myId(),payload:{amount:0}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V2：轉介邀約——被轉介的真人看完整卡片後親自接受或婉拒
ui.showReferralOffer = function(pf){
  if(!pf || !ui.S) return;
  var S=ui.S, me=S.players[ui.myId()];
  if(!me) return;
  if(pf.open){ if(me.isNPC || me.id===pf.fromId || me.bankrupt) return;
    if(pf.declined && pf.declined[me.id]) return; }
  else if(pf.toId!==me.id) return;
  var card=ns.content.byId[pf.cardId], frm=S.players[pf.fromId];
  var entry=E.oppEntry(S,card), inc=E.oppIncome(S,card);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"🤝 "+frm.name+" 想把這個機會轉介給"+(pf.open?"所有人（先接受先成交）":"你")));
  box.appendChild(el("div","sub","接受＝你自己出資買下（入手約 "+M(entry)+"、月現金流約 "+M(inc)+"），另付 "+frm.name+" 介紹費 "+M(pf.fee)+"。你的現金 "+M(me.cash)+"。"));
  box.appendChild(cardFace(card));
  box.appendChild(ui.oppFacts(S, card, me));          // S13.1 §3：判斷要不要接，得先看得到數字
  var feeLine=el("div","flavor");
  feeLine.innerHTML="加上介紹費後，你這一筆實際要付出 <b class='num neg'>"+M(util.r2(entry+pf.fee))+
    "</b>（入手 "+M(entry)+" ＋ 介紹費 "+M(pf.fee)+"）；你的現金 <b class='num"+
    (me.cash<entry+pf.fee?" neg":" pos")+"'>"+M(me.cash)+"</b>。";
  box.appendChild(feeLine);
  var fbRef=ui.offerFundingBox(S, me, util.r2(entry+pf.fee));
  if(fbRef) box.appendChild(fbRef);
  if(eduBox(card)) box.appendChild(eduBox(card));
  var o=el("div","opts");
  o.appendChild(optBtn("接受（買下並付介紹費 "+M(pf.fee)+"）","現金不足或買不成則不成交、不收費",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_REFERRAL",playerId:ui.myId(),payload:{accept:true}}); },true));
  o.appendChild(optBtn("婉拒","把機會還給市場",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_REFERRAL",playerId:ui.myId(),payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

// V3：合資邀約——被邀的真人（或廣播搶答）親自決定

/* S15：邀約收方的借款入口。實測回饋——現金不夠但還有額度，卻沒地方借，交易就此告吹。
   引擎端已用 E.OFF_TURN_CONDITIONAL 有條件開放 TAKE_LOAN（只有你身上掛著待回應的邀約時才准）。 */
ui.offerFundingBox = function(S, me, needCash){
  var gap = util.r2(needCash - me.cash);
  if(gap<=0) return null;
  var box=el("div"); box.style.cssText="margin-top:8px;border:1px solid rgba(242,193,78,.45);"+
    "background:rgba(242,193,78,.10);border-radius:8px;padding:8px 10px";
  var cap = E.creditCapacity(S, me);
  var head=el("div");
  box.appendChild(head);
  if(cap<=0){
    head.innerHTML="⚠ 你的現金 <b>"+M(me.cash)+"</b>，這一份要 <b>"+M(needCash)+
      "</b>——<b class='gold'>還差 "+M(gap)+"</b>";
    box.appendChild(el("div","edu","目前沒有可動用的信用額度（額度＝月收入 × DBR 倍數 − 現有無擔保負債）。"));
    return box;
  }
  var info=el("div"); info.style.cssText="margin-top:4px;font-size:var(--fs-xs);color:var(--tx2)";
  var b=el("button","opt"); b.style.marginTop="6px";
  b.title="借來的錢會變成信用貸款，之後每月要還——這一筆划不划算，看的是資產報酬有沒有高過利率";
  /* S19：這顆鈕原本把 take 算好存在 closure 裡、按完不重畫、而且不管引擎接不接受
     都直接跳「已借入」。實測連線局的死結就是這樣來的——借過一次之後額度歸零，
     玩家看到「已借入」以為沒生效又按，第三次就觸發假的「卡住了」面板。
     改成每次按之前重算、按完重畫、成敗照實回報。 */
  function calc(){
    var meNow=ui.S.players[ui.myId()]||me;
    var capNow=E.creditCapacity(ui.S, meNow);
    var gapNow=util.r2(needCash - meNow.cash);
    return { me:meNow, cap:capNow, gap:gapNow, take:util.r2(Math.max(0, Math.min(capNow, gapNow))) };
  }
  function paint(){
    var c=calc();
    head.innerHTML="⚠ 你的現金 <b>"+M(c.me.cash)+"</b>，這一份要 <b>"+M(needCash)+
      "</b>——"+(c.gap>0?("<b class='gold'>還差 "+M(c.gap)+"</b>"):"<b class='pos'>現金已經夠了</b>");
    var enough = c.take>=c.gap-0.001;
    info.innerHTML="可用信用額度 <b>"+M(c.cap)+"</b>　·　年利率約 "+
      util.pct(E.rRate(ui.S.macro.baseRate+E.cfg(ui.S,"creditSpread")),2)+
      ((c.gap>0 && !enough)?"　·　<span class='neg'>借滿也還差 "+M(util.r2(c.gap-c.take))+"</span>":"");
    b.textContent = c.take>0 ? ("借 "+M(c.take)+" 補上缺口") : "沒有可動用的額度";
    b.disabled = !(c.take>0);
  }
  b.onclick=function(){
    var c=calc();
    if(c.take<=0){ ui.toast("目前沒有可動用的信用額度","warn",3000); paint(); return; }
    var before=(ui.S.players[ui.myId()]||{}).cash;
    ui.dispatch({type:"TAKE_LOAN",playerId:ui.myId(),payload:{amount:c.take}});
    var after=(ui.S.players[ui.myId()]||{}).cash;
    // 只有現金真的變了才說借到了——引擎拒絕時 dispatch 不會改狀態
    if(after>before) ui.toast("已借入 "+M(util.r2(after-before))+"，現金 "+M(after),"good",3000,"MINE");
    paint();
  };
  box.appendChild(info);
  box.appendChild(b);
  paint();
  box.appendChild(el("div","edu","借錢參加是槓桿：報酬率高過借款利率才划算，低了就是替銀行打工。"));
  return box;
};

ui.showJVOffer = function(pj){
  if(!pj || !ui.S) return;
  var S=ui.S, me=S.players[ui.myId()];
  if(!me || me.isNPC || me.bankrupt) return;
  if(pj.targetId!==null && pj.targetId!==undefined){ if(pj.targetId!==me.id) return; }
  else { if(me.id===pj.fromId) return; if(pj.declined && pj.declined[me.id]) return; }
  var frm=S.players[pj.fromId], card=ns.content.byId[pj.cardId];
  var entry=E.oppEntry(S,card), inc=E.oppIncome(S,card);
  var yourShare=util.r2(1-pj.myShare);
  var yourEntry=util.r2(entry*yourShare), yourInc=util.r2(inc*yourShare);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"🤝 "+frm.name+" 邀你合資"+(pj.targetId===null?"（問所有人，先答應先合資）":"")));
  box.appendChild(el("div","sub","出資比＝股權比："+frm.name+" 出 "+Math.round(pj.myShare*100)+"%、你出 "+Math.round(yourShare*100)+"%"+
    "（你的出資約 "+M(yourEntry)+"、月現金流約 +"+M(yourInc)+"）。成立後是兩筆獨立資產，各自負擔貸款。你的現金 "+M(me.cash)+"。"));
  box.appendChild(cardFace(card));
  // S13.1 §3：數字按你的股權比縮放後攤開，才有得判斷
  box.appendChild(ui.oppFacts(S, card, me, yourShare));
  var fbJV=ui.offerFundingBox(S, me, yourEntry);
  if(fbJV) box.appendChild(fbJV);
  if(eduBox(card)) box.appendChild(eduBox(card));
  var o=el("div","opts");
  o.appendChild(optBtn("接受合資（出 "+M(yourEntry)+"）","依你的預設融資買入自己那份",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_JV",playerId:ui.myId(),payload:{accept:true}}); },true));
  o.appendChild(optBtn("婉拒","不參與這一筆",function(){ ov.remove();
    ui.dispatch({type:"RESPOND_JV",playerId:ui.myId(),payload:{accept:false}}); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ------------------------------ 股市面板 ------------------------------- */

/* ==================== S14a：單檔股票面板（點中欄股市列或庫存股票名稱開啟） ====================
   版型依 Brian 的 Excel：標題（價／較上期／殖利率）→ K 線大圖（含 X／Y 軸）→
   一列 { 張數 N ｜ 現股買進(可買 X 張) ｜ 融資買進(可買 Y 張) ｜ 賣出／全賣 } → 定期定額（先給建議金額）→ 股息再投入。
   非自己回合時整個面板照樣打得開，只是操作鈕停用並寫明原因（決定：瀏覽全開）。 */
ui.stockChartSVG = function(S, def, opts){
  opts=opts||{};
  var hist=(S.stockHistory&&S.stockHistory[def.symbol])||[];
  var cur=E.stockPrice(S,def);
  var data=hist.slice(-12);
  // S16：下市後價格就是 0，線要誠實掉到底——原本 `||def.face` 讓它反而往上噴到面額，
  // 畫面同時寫著「已下市，只剩壁紙」與一個更高的價格，自相矛盾。
  if(!data.length || data[data.length-1]!==cur) data=data.concat([cur]);
  if(data.length<2) data=[cur,cur];
  var W=680,H=250, L=74,R=16,Tp=14,B=34;
  var pw=W-L-R, ph=H-Tp-B;
  var mn=Math.min.apply(null,data), mx=Math.max.apply(null,data);
  if(opts.costLine>0){ mn=Math.min(mn,opts.costLine); mx=Math.max(mx,opts.costLine); }
  var pad=(mx-mn)*0.12 || Math.max(1,mx*0.05);
  mn=Math.max(0,mn-pad); mx=mx+pad;
  var rng=(mx-mn)||1;
  var X=function(i){ return L + (data.length<2?0:i*(pw/(data.length-1))); };
  var Y=function(v){ return Tp + ph - ((v-mn)/rng)*ph; };
  var out='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block">';
  // Y 軸格線與價格刻度（5 條）
  for(var g=0; g<=4; g++){
    var vy=mn+rng*g/4, y=Y(vy);
    out+='<line x1="'+L+'" y1="'+y.toFixed(1)+'" x2="'+(W-R)+'" y2="'+y.toFixed(1)+'" stroke="#1C2942"/>';
    out+='<text x="'+(L-6)+'" y="'+(y+3.5).toFixed(1)+'" text-anchor="end" font-size="10" fill="#6D7C96" font-family="var(--mono)">'+util.money(util.r2(vy))+'</text>';
  }
  // 面積 + 折線
  var up = data[data.length-1] >= data[0];
  var col = up ? "#35C4A8" : "#F0803C";
  var pts=data.map(function(v,i){ return X(i).toFixed(1)+","+Y(v).toFixed(1); }).join(" ");
  out+='<polygon points="'+X(0).toFixed(1)+','+(Tp+ph)+' '+pts+' '+X(data.length-1).toFixed(1)+','+(Tp+ph)+'" fill="'+col+'" fill-opacity="0.10"/>';
  out+='<polyline points="'+pts+'" fill="none" stroke="'+col+'" stroke-width="2"/>';
  data.forEach(function(v,i){ out+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(v).toFixed(1)+'" r="2.4" fill="'+col+'"/>'; });
  // 你的持有成本線
  if(opts.costLine>0){
    var cy=Y(opts.costLine);
    out+='<line x1="'+L+'" y1="'+cy.toFixed(1)+'" x2="'+(W-R)+'" y2="'+cy.toFixed(1)+'" stroke="#F2C14E" stroke-width="1" stroke-dasharray="5 4" opacity="0.9"/>';
    out+='<text x="'+(W-R)+'" y="'+(cy-5).toFixed(1)+'" text-anchor="end" font-size="10" fill="#F2C14E" font-family="var(--mono)">你的成本 '+util.money(util.r2(opts.costLine))+'</text>';
  }
  // X 軸（輪次）
  out+='<line x1="'+L+'" y1="'+(Tp+ph)+'" x2="'+(W-R)+'" y2="'+(Tp+ph)+'" stroke="#2A3B58"/>';
  var firstTurn = Math.max(1, S.turnNumber-(data.length-1));
  data.forEach(function(v,i){
    if(data.length>7 && i%2!==0 && i!==data.length-1) return;
    out+='<text x="'+X(i).toFixed(1)+'" y="'+(Tp+ph+15)+'" text-anchor="middle" font-size="10" fill="#6D7C96" font-family="var(--mono)">'+(firstTurn+i)+'</text>';
  });
  out+='<text x="'+(L+pw/2)+'" y="'+(H-3)+'" text-anchor="middle" font-size="10" fill="#6D7C96">輪 次</text>';
  out+='<text x="12" y="'+(Tp+ph/2)+'" text-anchor="middle" font-size="10" fill="#6D7C96" transform="rotate(-90 12 '+(Tp+ph/2)+')">股 價</text>';
  out+='</svg>';
  return out;
};

ui.showStockPanel = function(focusSymbol){
  var S=ui.S; if(!S) return;
  if(S.enabledModules.indexOf("M1")<0){ ui.toast("本局未開啟股市模組（開局時可勾選）","warn",3000); return; }
  var p=S.players[ui.myId()];
  var reopen=function(){ ui.showStockPanel(focusSymbol); };
  var myTurnS = S.activePlayerIdx===ui.myId();
  var canTrade = !p.bankrupt && myTurnS && (S.phase==="ROLL"||S.phase==="READY_END");
  var whyNot = p.bankrupt ? "破產程序中不能交易" : "現在不是你的操作時機——可以先研究，輪到你再下單";
  // S14a-2：定期定額與股息再投入是「設定」，發薪日才執行、不佔回合動作 → 非回合也能改。
  var canSet = !p.bankrupt && !S.over && (!myTurnS || S.phase==="ROLL" || S.phase==="READY_END");
  var whySet = p.bankrupt ? "破產程序中" : "先把手上的決策或記帳處理完";

  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="760px";
  var hd=el("div"); hd.style.cssText="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap";
  hd.appendChild(el("h2",null,"股市"));
  var mvAll=0, mdAll=0;
  p.assets.forEach(function(a2){ if(a2.kind==="STOCK" && a2.flags && a2.flags.margin){
    mvAll+=a2.marketValue||0;
    var ml0=(p.liabilities||[]).filter(function(x){return x.instanceId===a2.linkedLiabilityId;})[0];
    if(ml0) mdAll+=ml0.principal||0; } });
  var cashB=el("b","gold","可用現金 "+M(p.cash)); cashB.style.marginLeft="auto"; hd.appendChild(cashB);
  if(mdAll>0){
    var wr=mvAll/mdAll, nearW=wr<S.config.marginCallLevel*1.15;
    var ws=el("b",nearW?"neg":"pos","整戶維持率 "+Math.round(wr*100)+"%"); hd.appendChild(ws);
  }
  box.appendChild(hd);
  box.appendChild(el("div","sub", canTrade
    ? "全部標的列在同一頁，直接往下捲就好——不用一檔一檔點進去。"
    : "👁 "+whyNot+"；定期定額與股息再投入是設定，現在就可以改。"));

  var list=el("div");
  ns.content.stockDefs.forEach(function(def){
    var symbol=def.symbol;
    var delisted = !!(S.delisted && S.delisted[symbol]);
    var price=E.stockPrice(S,def);
    var sc=E.stockChange(S,def), chg=sc.chg, chgP=sc.pct;
    var cashPos=p.assets.filter(function(a2){return a2.kind==="STOCK"&&a2.symbol===symbol&&!(a2.flags&&a2.flags.margin);})[0];
    var mLots=p.assets.filter(function(a2){return a2.kind==="STOCK"&&a2.symbol===symbol&&a2.flags&&a2.flags.margin;});
    var canMargin = E.canUseAdvanced(S) && !delisted;
    // S15b：可買張數要把手續費算進去，否則按下去才發現錢不夠
    var feeR0 = E.cfg(S,"stockFeeRate")||0;
    var maxCash = price>0 ? Math.floor(p.cash/(price*(1+feeR0))) : 0;
    var maxMargin = (canMargin && price>0)
      ? Math.floor(p.cash/(price*(S.config.marginRatio+feeR0))) : 0;
    var marginBlock = E.marginBlockReason ? E.marginBlockReason(S,p) : null;
    var unitCost = (cashPos && cashPos.units>0) ? util.r2(cashPos.costBasis/cashPos.units) : 0;

    var sec=el("div","sec"); sec.style.cssText="padding:12px 4px";
    if(focusSymbol===symbol) sec.id="stkFocus";

    /* 標題列 */
    var th=el("div"); th.style.cssText="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap";
    th.appendChild(el("b",null,E.stockName(S,symbol))).style.fontSize="15.5px";
    var TAGS={STK_TECH:"成長",STK_DIV:"配息",STK_ETF:"ETF",STK_SPEC:"投機"};
    if(TAGS[symbol]){ var tg=el("span",null,TAGS[symbol]);
      tg.style.cssText="font-size:11px;color:var(--tx3);border:1px solid var(--line2);border-radius:5px;padding:0 6px";
      th.appendChild(tg); }
    var px=el("b","num",M(price)+" / 張"); px.style.cssText="margin-left:auto;font-size:17px"; th.appendChild(px);
    th.appendChild(el("span","num "+(chg>=0?"pos":"neg"),(chg>=0?"▲":"▼")+util.pct(Math.abs(chgP),1)+"（較上期）"));
    sec.appendChild(th);
    sec.appendChild(el("div",null,"殖利率 "+util.pct(E.stockYield(S,def),2)+"／月"+
      (delisted?"　·　⚠ 已下市，只剩壁紙":"")+
      (cashPos?("　·　現股 "+cashPos.units+" 張・成本 "+M(unitCost)+"／張・未實現 "+
        ((cashPos.marketValue-cashPos.costBasis)>=0?"+":"")+M(util.r2(cashPos.marketValue-cashPos.costBasis))):"　·　未持有")))
      .style.cssText="font-size:12px;color:var(--tx2);margin-top:2px";

    /* S15：個股說明——玩家看到「星火小型股（投機）」六個字，不知道它為什麼會那樣動。
       大方向（對景氣多敏感）＋小波動（股性）各講一句。 */
    if(def.profile){
      var pf=el("div");
      pf.style.cssText="margin-top:6px;border-left:3px solid var(--line2);padding:4px 0 4px 8px;"+
        "font-size:var(--fs-xs);color:var(--tx2);line-height:1.55";
      pf.innerHTML=def.profile+(def.macroNote?("<br><span style='color:var(--tx3)'>景氣連動："+def.macroNote+"</span>"):"");
      sec.appendChild(pf);
    }

    /* K 線 */
    var ch=el("div"); ch.style.margin="6px 0 2px";
    ch.innerHTML=ui.stockChartSVG(S, def, {costLine:unitCost});
    sec.appendChild(ch);

    /* 交易列：六種操作各自一個顏色 */
    var row=el("div"); row.style.cssText="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:4px";
    row.appendChild(el("span",null,"張數")).style.fontSize="12.5px";
    var qty=el("input"); qty.type="number"; qty.min=1; qty.step=1;
    qty.value=Math.max(1, Math.min(maxCash||1, Math.floor((maxCash||1)/3))||1);
    qty.style.cssText="width:72px;background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:6px;font-family:var(--mono)";
    row.appendChild(qty);
    function getU(){ return Math.max(1, Math.floor(+qty.value||1)); }
    function hint(txt){ var h=el("span",null,txt); h.style.cssText="color:var(--tx3);font-size:11px"; return h; }

    // S15b：把來回成本講在按鈕旁邊——玩家要看得見「這一趟先賠掉多少」
    var rt = E.stockRoundTripRate ? E.stockRoundTripRate(S,def) : 0;
    if(rt>0){
      var cst=el("div");
      cst.style.cssText="font-size:11px;color:var(--tx3);margin:2px 0 4px";
      var feePct=util.pct(E.cfg(S,"stockFeeRate")||0,4);
      var taxPct=util.pct((def.taxRate!==undefined&&def.taxRate!==null)?def.taxRate:(E.cfg(S,"stockTaxRate")||0),3);
      cst.innerHTML="交易成本：手續費 "+feePct+"（買賣各一次）＋證交稅 "+taxPct+"（賣出）"+
        "　·　一買一賣先賠 <b class='neg'>"+util.pct(rt,3)+"</b>"+
        (def.taxRate!==undefined&&def.taxRate!==null?"　·　ETF 證交稅較低":"");
      sec.appendChild(cst);
    }

    var bCash=el("button","act buyCash","現股買進");
    bCash.disabled = !canTrade || delisted || maxCash<1;
    bCash.title = delisted ? "已下市，不能再買" : (!canTrade ? whyNot : (maxCash<1?"現金不足一張":""));
    bCash.onclick=function(){
      var u=Math.min(getU(), maxCash);
      if(u<1){ ui.toast("現金不足","warn"); return; }
      ui.spendGuard(util.r2(p.cash-price*u*(1+feeR0)), function(){ ov.remove();
        ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:symbol,side:"buy",units:u,margin:false}}); });
    };
    row.appendChild(bCash); row.appendChild(hint("可買 "+maxCash+" 張"));

    if(canMargin){
      var bMar=el("button","act buyMargin","融資買進");
      bMar.disabled = !canTrade || maxMargin<1 || !!marginBlock;
      bMar.title = marginBlock ? (E.MARGIN_BLOCK_TEXT[marginBlock]||"目前不能融資")
                 : (!canTrade ? whyNot : (maxMargin<1?"自備款不足一張":"自備 "+util.pct(S.config.marginRatio,0)+"，其餘向券商借"));
      bMar.onclick=function(){
        var u=Math.min(getU(), maxMargin);
        if(u<1){ ui.toast("自備款不足","warn"); return; }
        ui.marginGuard(def, function(){
          ui.spendGuard(util.r2(p.cash-price*u*(S.config.marginRatio+feeR0)), function(){ ov.remove();
            ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:symbol,side:"buy",units:u,margin:true}}); });
        });
      };
      row.appendChild(bMar);
      row.appendChild(hint(marginBlock ? "🔒 "+(E.MARGIN_BLOCK_TEXT[marginBlock]||"暫不開放")
                                       : ("可買 "+maxMargin+" 張")));
    }

    if(cashPos){
      var bSell=el("button","act sellSome","賣出");
      bSell.disabled=!canTrade; bSell.title=canTrade?"賣掉「張數」格裡那麼多張":whyNot;
      bSell.onclick=function(){ var u=Math.min(getU(), cashPos.units); ov.remove();
        ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:symbol,side:"sell",units:u}}); };
      var bAll=el("button","act sellAll","全賣（"+cashPos.units+" 張）");
      bAll.disabled=!canTrade; bAll.title=canTrade?"整筆出清":whyNot;
      bAll.onclick=function(){ ov.remove();
        ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:symbol,side:"sell",units:cashPos.units}}); };
      row.appendChild(bSell); row.appendChild(bAll);
    }
    sec.appendChild(row);

    /* 融資部位 */
    mLots.forEach(function(lot){
      var mrow=el("div"); mrow.style.cssText="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:6px;font-size:12.5px;color:var(--tx2)";
      var ml = lot.linkedLiabilityId ? p.liabilities.filter(function(x){return x.instanceId===lot.linkedLiabilityId;})[0] : null;
      var pl2=util.r2(lot.marketValue-lot.costBasis);
      var t="└ 融資 "+lot.units+" 張　市值 "+M(lot.marketValue)+"　損益 <span class='"+(pl2>=0?"pos":"neg")+"'>"+(pl2>=0?"+":"")+M(pl2)+"</span>";
      if(ml){ var mr=lot.marketValue/Math.max(0.01,ml.principal), near=mr<S.config.marginCallLevel*1.15;
        t+="　借 "+M(ml.principal)+"　維持率 <b class='"+(near?"neg":"pos")+"'>"+Math.round(mr*100)+"%</b>"+
           (near?"（接近斷頭 "+Math.round(S.config.marginCallLevel*100)+"%）":""); }
      var sp=el("span"); sp.innerHTML=t; mrow.appendChild(sp);
      var cl=el("button","act sellAll","平倉"); cl.disabled=!canTrade; cl.title=canTrade?"":whyNot;
      cl.style.cssText="margin-left:auto;padding:5px 10px;min-height:0;font-size:12px";
      cl.onclick=function(){ ov.remove();
        ui.dispatch({type:"TRADE_STOCK",playerId:ui.myId(),payload:{symbol:symbol,side:"sell",units:lot.units,assetId:lot.instanceId}}); };
      mrow.appendChild(cl);
      sec.appendChild(mrow);
    });

    /* 定期定額 ＋ 股息再投入 */
    if(E.autoInvestOn(S) && !delisted){
      var minD=E.cfg(S,"dcaMinAmount"); if(!(minD>0)) minD=5;
      var plans={}; (p.dcaPlans||[]).forEach(function(x){ plans[x.symbol]=x; });
      var plan=plans[symbol];
      var arow=el("div"); arow.style.cssText="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px;"+
        "padding-top:7px;border-top:1px dashed var(--line);font-size:12.5px";
      arow.appendChild(el("span",null,"🔁 每月扣"));
      var amt=el("input"); amt.type="number"; amt.min=0; amt.step=1;
      var suggest=Math.max(minD, Math.round((p.derived.salaryIncome||0)/10));
      amt.value = plan ? plan.amount : suggest;
      amt.style.cssText="width:80px;background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:6px;font-family:var(--mono)";
      arow.appendChild(amt);
      arow.appendChild(hint("建議 "+suggest+"（＝"+M(suggest)+"，月主動收入的 1/10）"));
      var setB=el("button","act dca", plan?"更新扣款":"開始扣款");
      setB.disabled=!canSet; setB.title=canSet?"每次發薪自動買，不佔回合動作（不必等自己的回合）":whySet;
      setB.onclick=function(){
        var v=Math.max(0, Math.round(+amt.value||0));
        if(v>0 && v<minD){ ui.toast("每月最低 "+M(minD),"warn"); return; }
        ui.dispatch({type:"SET_DCA",playerId:ui.myId(),payload:{symbol:symbol,amount:v}});
        ov.remove(); reopen();
      };
      arow.appendChild(setB);
      if(plan){
        var stopB=el("button","act sellSome","停扣"); stopB.disabled=!canSet; stopB.title=canSet?"":whySet;
        stopB.onclick=function(){ ui.dispatch({type:"SET_DCA",playerId:ui.myId(),payload:{symbol:symbol,amount:0}}); ov.remove(); reopen(); };
        arow.appendChild(stopB);
      }
      if(def.dividendYieldMonthly>0){
        var reOn=!!(p.divReinvest&&p.divReinvest[symbol]);
        var lots=p.assets.filter(function(a2){ return a2.kind==="STOCK"&&a2.symbol===symbol&&!(a2.flags&&a2.flags.margin); });
        var myDiv=util.r2(util.sum(lots,function(a2){ return a2.monthlyIncome||0; }));
        var rb2=el("button","act divRe", reOn?"✅ 股息再投入中":"股息再投入");
        rb2.disabled=!canSet;
        rb2.title=canSet?(myDiv>0?("你目前每月配息 "+M(myDiv)+"，開啟後自動加碼同一檔"):"目前沒有持股，配息 0"):whySet;
        rb2.onclick=function(){ ui.dispatch({type:"SET_DIV_REINVEST",playerId:ui.myId(),payload:{symbol:symbol,on:!reOn}});
          ov.remove(); reopen(); };
        arow.appendChild(rb2);
      }
      sec.appendChild(arow);
    }
    list.appendChild(sec);
  });
  box.appendChild(list);
  box.appendChild(el("div","note",
    "定期定額用固定金額買，價格低時自然買到比較多張——不會買在最低點，也不會把身家壓在最高點；"+
    "現金不足的那一期直接跳過，不會替你借錢。股息再投入是把每月配息拿去加碼同一檔，複利這樣長出來，"+
    "但風險也越押越重在同一個標的上。融資是借錢買股：賺賠都放大，跌破維持率會被強制平倉。"));

  var o=el("div","opts"); o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
  // 從某一檔點進來時，捲到那一檔（其餘照樣在同一頁，往下捲就看得到）
  if(focusSymbol){ var f=box.querySelector("#stkFocus");
    if(f && f.scrollIntoView) setTimeout(function(){ try{ f.scrollIntoView({block:"start"}); }catch(e){} }, 30); }
};

// S14a-2：股市只剩一個面板（全部標的列在同一頁），這個名字保留給既有呼叫點。
ui.showStockMarket = function(){ ui.showStockPanel(null); };


})(ns);
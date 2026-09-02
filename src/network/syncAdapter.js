/* ============================================================================
   M12 多人連線（第一期）：SyncAdapter＋房間大廳＋lockstep 同步
   - 同步的不是狀態，是動作：seq 序動作紀錄，各端重放（引擎決定論保證一致）
   - LocalAdapter：同一瀏覽器多分頁（BroadcastChannel＋localStorage）＝自動測試與同機示範
   - FirebaseAdapter：跨裝置正式通道（動態載入 SDK；未設定金鑰時自動隱藏）
   - 本期範圍：建房／入房／大廳選角／回合同步／重連；轉讓還價已跨裝置；
     拍賣、P2P、合資、轉介對「真人」暫由系統自動評估（M12-B 開放真人親答）
   ============================================================================ */
(function(ns){
"use strict";
var util=ns.util, E=ns.engine, ui=ns.ui;
var $=function(id){ return document.getElementById(id); };
var el=ui.mkEl;   // S10：不再自己寫一份（原本這份不處理 <b>/<br>，借款視窗的字面標籤就是這樣來的）
var T=ui.t, M=util.money, optBtn=ui.optBtn;
var HAS_BC = (typeof BroadcastChannel!=="undefined");   // Node 測試環境防護

ui.mp = { mode:false, seat:0, code:null, uid:null, host:false, adapter:null,
          replaying:false, presence:{}, setup:null, lobby:{}, meta:null,
          _hb:null, _pending:[], seatUid:{} };

function myUid(){
  // sessionStorage＝每個視窗一個身分：同機雙視窗才不會撞成同一位玩家；
  // 重連時由 mpRejoin 用 localStorage 記下的上一局 uid 覆寫回來認回座位。
  try{ var u=sessionStorage.getItem("finflow.mp.uid");
    if(!u){ u="u"+Math.random().toString(36).slice(2,10)+Date.now().toString(36);
      sessionStorage.setItem("finflow.mp.uid",u); }
    return u;
  }catch(e){ if(!myUid._u) myUid._u="u"+((Math.random()*1e9)|0); return myUid._u; }
}
// S13.1 FF-004：2 碼只有 100 個房號，10 間活房同時在線時新房撞號機率就到 10%，
// 撞上又不是原子建房 → 靜默蓋掉別人的房間。改 4 碼把碰撞降兩個數量級，仍然好口頭傳。
var ROOM_CODE_LEN = 4;
var ROOM_TTL_MS = 24*3600*1000;     // 房間視為過期的時間（過期房才可被回收）
function genCode(){
  var n=(Math.random()*Math.pow(10,ROOM_CODE_LEN))|0;
  return (new Array(ROOM_CODE_LEN+1).join("0")+n).slice(-ROOM_CODE_LEN);
}
function isRoomExpired(room){
  return !room || !room.meta || (now()-(room.meta.createdAt||0)) >= ROOM_TTL_MS;
}
// S13.1：房號規則要能被自測驗到（純函式，不動任何狀態）
ns.mpDebug = { ROOM_CODE_LEN:ROOM_CODE_LEN, ROOM_TTL_MS:ROOM_TTL_MS,
               genCode:function(){ return genCode(); },
               isRoomExpired:function(r){ return isRoomExpired(r); } };
function now(){ return Date.now(); }

/* ========================= LocalAdapter（同瀏覽器） ========================= */
// 房間存 localStorage；分頁間用 BroadcastChannel 通知。僅供測試與同機示範。
function LocalAdapter(){
  var self={kind:"local"}, bc=null, code=null, cbs={action:[],lobby:[],meta:[],presence:[]};
  function key(c){ return "finflow.mproom."+c; }
  function read(c){ try{ var r=localStorage.getItem(key(c)); return r?JSON.parse(r):null; }catch(e){ return null; } }
  function write(c,room){ localStorage.setItem(key(c), JSON.stringify(room)); }
  function post(msg){ if(bc) bc.postMessage(msg); handle(msg); }         // 自我回聲（與 Firebase 行為一致）
  function handle(msg){
    if(msg.t==="action") cbs.action.forEach(function(cb){ cb(msg.entry); });
    if(msg.t==="lobby")  cbs.lobby.forEach(function(cb){ cb(msg.lobby); });
    if(msg.t==="meta")   cbs.meta.forEach(function(cb){ cb(msg.meta); });
    if(msg.t==="presence") cbs.presence.forEach(function(cb){ cb(msg.presence); });
  }
  self.open=function(c){
    code=c;
    if(HAS_BC){ bc=new BroadcastChannel("finflow.mp."+c); bc.onmessage=function(ev){ handle(ev.data); }; }
  };
  // S13.1 FF-004：同步 read→check→write，房號被活房占住就拒絕（不再靜默蓋掉）
  self.createRoom=function(c, room){
    var cur=read(c);
    if(cur && !isRoomExpired(cur)) return Promise.resolve(false);
    self.open(c); write(c, room); return Promise.resolve(true); };
  self.readRoom=function(c){ return Promise.resolve(read(c)); };
  self.writeLobby=function(uid, data){
    var room=read(code); if(!room) return Promise.resolve(false);
    if(data===null) delete room.lobby[uid]; else room.lobby[uid]=data;
    write(code,room); post({t:"lobby",lobby:room.lobby}); return Promise.resolve(true);
  };
  self.writeMeta=function(patch){
    var room=read(code); if(!room) return Promise.resolve(false);
    Object.keys(patch).forEach(function(k){ room.meta[k]=patch[k]; });
    write(code,room); post({t:"meta",meta:room.meta}); return Promise.resolve(true);
  };
  self.writeSetup=function(setup){
    var room=read(code); if(!room) return Promise.resolve(false);
    room.setup=setup; write(code,room); return Promise.resolve(true);
  };
  self.appendAction=function(seq, entry){
    var room=read(code); if(!room) return Promise.resolve("noroom");
    if(room.log.length!==seq) return Promise.resolve("conflict");
    room.log.push(entry); write(code,room);
    post({t:"action",entry:entry});
    return Promise.resolve("ok");
  };
  self.readLog=function(){ var room=read(code); return Promise.resolve(room?room.log:[]); };
  self.setPresence=function(uid, data){
    var room=read(code); if(!room) return;
    room.presence[uid]=data; write(code,room); post({t:"presence",presence:room.presence});
  };
  self.onAction=function(cb){ cbs.action.push(cb); };
  self.onLobby=function(cb){ cbs.lobby.push(cb); };
  self.onMeta=function(cb){ cbs.meta.push(cb); };
  self.onPresence=function(cb){ cbs.presence.push(cb); };
  self.close=function(){ if(bc) bc.close(); bc=null; };
  return self;
}

/* ========================= FirebaseAdapter（跨裝置） ========================= */
// 動態載入 Firebase 模組化 SDK；金鑰貼在「連線設定」後存 localStorage。
// 沙盒無法連 Firebase（網路白名單），此 adapter 的實連驗證＝Brian 本機真機（規格 §9.8–9）。
function getFbConfig(){
  try{ var r=localStorage.getItem("finflow.firebaseConfig"); return r?JSON.parse(r):null; }catch(e){ return null; }
}
function FirebaseAdapter(){
  var self={kind:"firebase"}, fb=null, db=null, code=null, refs=null;
  var SDK="https://www.gstatic.com/firebasejs/12.1.0/";
  function load(){
    if(fb) return Promise.resolve(fb);
    return Promise.all([
      import(SDK+"firebase-app.js"), import(SDK+"firebase-database.js"), import(SDK+"firebase-auth.js")
    ]).then(function(mods){
      var appM=mods[0], dbM=mods[1], authM=mods[2];
      var app=appM.initializeApp(getFbConfig());
      return authM.signInAnonymously(authM.getAuth(app)).then(function(){
        fb={app:app, dbM:dbM}; db=dbM.getDatabase(app); return fb;
      });
    });
  }
  function R(path){ return fb.dbM.ref(db, "rooms/"+code+(path?("/"+path):"")); }
  self.open=function(c){ code=c; return load(); };
  // S13.1 FF-004：建房必須是原子的。舊寫法 read→check→set 中間會被插隊，set 又是直接覆蓋，
  // 兩組人同時建到同一個房號時後者會把前者的 lobby / log 整個清掉（靜默資料遺失）。
  // 改用 runTransaction：只有房號空著或該房已過期才寫得進去，committed 才算建房成功。
  self.createRoom=function(c, room){ code=c;
    return load().then(function(){
      return fb.dbM.runTransaction(R(""), function(cur){
        if(cur===null || cur===undefined) return room;
        var age = Date.now()-((cur.meta&&cur.meta.createdAt)||0);
        return (age>=ROOM_TTL_MS) ? room : undefined;     // 活房 → abort
      }).then(function(res){ return !!res.committed; });
    }); };
  self.readRoom=function(c){ code=c;
    return load().then(function(){ return fb.dbM.get(R("")).then(function(s){ return s.val(); }); }); };
  self.writeLobby=function(uid,data){
    return fb.dbM.set(fb.dbM.ref(db,"rooms/"+code+"/lobby/"+uid), data).then(function(){ return true; }); };
  self.writeMeta=function(patch){ return fb.dbM.update(R("meta"), patch).then(function(){ return true; }); };
  self.writeSetup=function(setup){ return fb.dbM.set(R("setup"), setup).then(function(){ return true; }); };
  self.appendAction=function(seq, entry){
    return fb.dbM.runTransaction(fb.dbM.ref(db,"rooms/"+code+"/log/"+seq), function(cur){
      return cur===null ? entry : undefined;    // 已被占位 → abort
    }).then(function(res){ return res.committed ? "ok" : "conflict"; });
  };
  self.readLog=function(){
    return fb.dbM.get(R("log")).then(function(s){ var v=s.val()||{};
      var out=[]; Object.keys(v).forEach(function(k){ out[parseInt(k,10)]=v[k]; }); return out.filter(Boolean); }); };
  self.setPresence=function(uid,data){
    var r=fb.dbM.ref(db,"rooms/"+code+"/presence/"+uid);
    fb.dbM.set(r,data);
    try{ fb.dbM.onDisconnect(r).update({lastSeen:0}); }catch(e){}
  };
  self.onAction=function(cb){
    fb.dbM.onChildAdded(R("log"), function(snap){ cb(snap.val()); }); };
  self.onLobby=function(cb){
    fb.dbM.onValue(R("lobby"), function(snap){ cb(snap.val()||{}); }); };
  self.onMeta=function(cb){
    fb.dbM.onValue(R("meta"), function(snap){ cb(snap.val()); }); };
  self.onPresence=function(cb){
    fb.dbM.onValue(R("presence"), function(snap){ cb(snap.val()||{}); }); };
  self.close=function(){};
  return self;
}

function makeAdapter(kind){ return kind==="firebase" ? FirebaseAdapter() : LocalAdapter(); }

/* ============================== 多人選單 ============================== */
ui.mpMenu = function(){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"🌐 多人連線"));
  var hasFb=!!getFbConfig();
  box.appendChild(el("div","sub","每個人用自己的裝置（iPad／電腦／手機）加入同一局。"+
    (hasFb?"　連線金鑰已設定 ✅":"　尚未設定連線金鑰——同一台電腦可先用「同機測試」，跨裝置需先完成連線設定。")));
  var o=el("div","opts");
  function mode(){ return hasFb ? "firebase" : "local"; }
  // S15c：房號早在 S13.1 就改成 4 碼，這兩行文案是舊的殘留；同時把「沒設金鑰時
  // 建房其實只會開同機房」講白，免得房主以為別人連得進來（實測回報的困惑點）。
  o.appendChild(optBtn(hasFb?"建立房間（跨裝置）":"建立房間（目前僅同機）",
    hasFb?"你當房主，取得 4 碼房號給大家，各自用自己的裝置加入"
         :"⚠ 尚未設定連線金鑰——現在建的房只有這台瀏覽器連得進來。要跨裝置請先做下面的「連線設定」",
    function(){ ov.remove(); ui.mpCreate(mode()); }, hasFb));
  o.appendChild(optBtn("加入房間","輸入朋友給你的 4 碼房號",function(){ ov.remove(); ui.mpJoinPrompt(mode()); }));
  o.appendChild(optBtn("重新連線上一局", "斷線或重開頁面後回到進行中的房間", function(){ ov.remove(); ui.mpRejoin(); }));
  o.appendChild(optBtn("同機測試（雙視窗）","同一瀏覽器開兩個視窗互連——展示與測試用",function(){ ov.remove(); ui.mpCreate("local"); }));
  o.appendChild(optBtn("⚙ 連線設定（Firebase 金鑰）", hasFb?"已設定，可查看或更換":"貼上 Firebase 控制台的 firebaseConfig 即完成", function(){ ov.remove(); ui.mpConfig(); }));
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); if(!ui.S) ui.showSetup(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.mpConfig = function(){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="620px";
  box.appendChild(el("h2",null,"連線設定"));
  box.appendChild(el("div","sub","一次性設定（約 10 分鐘）：console.firebase.google.com 建立專案 → 開 Realtime Database 與匿名登入 → 把「專案設定」頁的 firebaseConfig 物件貼進下面。設定存在這台裝置的瀏覽器裡。詳見交付附的《Firebase 設定指南》。"));
  var ta=el("textarea"); ta.style.cssText="width:100%;height:150px;background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:10px;font-family:var(--mono);font-size:12.5px";
  ta.placeholder='{ "apiKey":"...", "authDomain":"...", "databaseURL":"https://xxx.firebasedatabase.app", "projectId":"...", "appId":"..." }';
  var cur=getFbConfig(); if(cur) ta.value=JSON.stringify(cur,null,1);
  box.appendChild(ta);
  var o=el("div","opts");
  o.appendChild(optBtn("儲存","驗證格式後存入本機",function(){
    var txt=ta.value.trim();
    // 允許直接貼 JS 物件寫法（controller 給的格式帶識別字鍵名）
    try{
      var js=txt.replace(/^\s*(const|var|let)\s+\w+\s*=\s*/,"").replace(/;\s*$/,"")
                .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g,'$1"$2":').replace(/'/g,'"');
      var cfg=JSON.parse(js);
      if(!cfg.databaseURL || !cfg.apiKey) throw new Error("缺 databaseURL 或 apiKey");
      localStorage.setItem("finflow.firebaseConfig", JSON.stringify(cfg));
      ov.remove(); ui.toast("連線金鑰已儲存 ✅","good"); ui.mpMenu();
    }catch(e){ ui.toast("格式不對："+e.message,"warn",4500); }
  },true));
  o.appendChild(optBtn("清除設定",null,function(){ localStorage.removeItem("finflow.firebaseConfig"); ov.remove(); ui.mpMenu(); }));
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); ui.mpMenu(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ============================== 建房／入房 ============================== */
ui.mpCreate = function(kind){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"建立房間"));
  box.appendChild(el("div","sub",(kind==="local"?"同機測試模式：房號只在這台瀏覽器有效。":"跨裝置模式：把房號告訴大家即可加入。")));
  var st={max:4, preset:"STANDARD", profMode:"pick"};
  var body=el("div"); box.appendChild(body);
  function render(){
    body.innerHTML="";
    body.appendChild(el("h4",null,"人數上限（真人不足由電腦補位）")).style.cssText="margin:10px 0 6px;color:var(--tx3);font-size:13px";
    var w=el("div","tabs"); [2,3,4,5,6].forEach(function(nn){
      var b=el("button","tab"+(st.max===nn?" on":""), nn+" 人");
      b.onclick=function(){ st.max=nn; render(); }; w.appendChild(b); });
    body.appendChild(w);
    body.appendChild(el("h4",null,"難度")).style.cssText="margin:10px 0 6px;color:var(--tx3);font-size:13px";
    var w2=el("div","tabs");
    ["NOVICE","STANDARD","ADVANCED","HARDCORE"].forEach(function(k){
      var b=el("button","tab"+(st.preset===k?" on":""), ns.PRESET_NAMES[k]);
      b.onclick=function(){ st.preset=k; render(); }; w2.appendChild(b); });
    body.appendChild(w2);
    // S13.1 §1：職業由房主決定要自選還是隨機——朋友局隨意，教學局要公平起跑就用隨機
    body.appendChild(el("h4",null,"職業指派")).style.cssText="margin:10px 0 6px;color:var(--tx3);font-size:13px";
    var w3=el("div","tabs");
    [["pick","玩家自選"],["random","系統隨機"]].forEach(function(pr){
      var b=el("button","tab"+(st.profMode===pr[0]?" on":""), pr[1]);
      b.onclick=function(){ st.profMode=pr[0]; render(); }; w3.appendChild(b); });
    body.appendChild(w3);
    body.appendChild(el("div","flavor", st.profMode==="random"
      ? "所有人（含電腦）的職業在開局那一刻隨機指派，且不重複——起跑點由抽籤決定，比較接近真實人生。"
      : "每個人在大廳自己挑職業，可以和別人重複。夢想一律自選，不受此設定影響。"));
  }
  render();
  var o=el("div","opts");
  o.appendChild(optBtn("建立","產生房號並進入大廳",function(){
    ov.remove();
    var uid=myUid();
    var room={ meta:{ ver:ns.BUILD.ver, status:"lobby", hostUid:uid, maxPlayers:st.max,
                      preset:st.preset, profMode:st.profMode,
                      modules:ns.PRESETS[st.preset].m, createdAt:now(), kind:kind },
               setup:null, lobby:{}, log:[], presence:{} };
    var ad=makeAdapter(kind);
    // S13.1 FF-004：占位由 createRoom 的原子交易決定，這裡只負責換號重試。
    // 先 readRoom 只是為了少發一次寫入，真正的把關在 createRoom（committed 才算數）。
    (function tryCode(n){
      if(n>30){ ui.toast("找不到可用房號，請稍後再試","warn",5000); ui.mpMenu(); return; }
      var code=genCode();
      Promise.resolve(ad.readRoom(code)).then(function(exist){
        if(exist && !isRoomExpired(exist)){ tryCode(n+1); return; }
        room.meta.createdAt=now();
        return Promise.resolve(ad.createRoom(code, room)).then(function(okCreated){
          if(okCreated===false){ tryCode(n+1); return; }   // 被別人搶先占走 → 換一個號
          mpEnterLobby(ad, code, uid, room.meta);
        });
      }).catch(function(e){ ui.toast("建房失敗："+(e&&e.message||e),"warn",5000); ui.mpMenu(); });
    })(0);
  },true));
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); ui.mpMenu(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.mpJoinPrompt = function(kind){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,"加入房間"));
  var inp=el("input"); inp.style.cssText="width:100%;background:var(--ink);border:1px solid var(--line2);border-radius:10px;color:var(--tx);padding:12px;font-size:22px;letter-spacing:.3em;text-align:center;font-family:var(--mono);text-transform:uppercase";
  inp.maxLength=ROOM_CODE_LEN; inp.placeholder="房號 "+ROOM_CODE_LEN+" 碼"; inp.inputMode="numeric";
  box.appendChild(inp);
  var o=el("div","opts");
  o.appendChild(optBtn("加入",null,function(){
    var code=(inp.value||"").trim();
    if(!(new RegExp("^\\d{"+ROOM_CODE_LEN+"}$")).test(code)){ ui.toast("房號是 "+ROOM_CODE_LEN+" 碼數字","warn"); return; }
    ov.remove(); ui.mpJoin(kind, code);
  },true));
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); ui.mpMenu(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
  setTimeout(function(){ inp.focus(); },50);
};

ui.mpJoin = function(kind, code){
  var uid=myUid(), ad=makeAdapter(kind);
  Promise.resolve(ad.readRoom(code)).then(function(room){
    // 同機測試模式找不到房 → 也試跨裝置（反之亦然），讓入房不用管模式
    if(!room && kind==="local" && getFbConfig()){
      var ad2=makeAdapter("firebase");
      return Promise.resolve(ad2.readRoom(code)).then(function(r2){ if(r2){ ad=ad2; } return r2; });
    }
    return room;
  }).then(function(room){
    if(!room){ ui.toast("找不到這個房間（房號打錯，或房主用的是另一種連線模式）","warn",5000); ui.mpMenu(); return; }
    if(room.meta.ver!==ns.BUILD.ver){
      ui.toast("版本不符（房間 "+room.meta.ver+"／你 "+ns.BUILD.ver+"）——請重新整理頁面取得最新版","warn",6500); ui.mpMenu(); return; }
    if(room.meta.status==="playing"){
      var mine=(room.setup&&room.setup.players||[]).some(function(pl){ return pl.uid===uid; });
      if(mine){ mpResume(ad, code, uid, room); return; }
      ui.toast("這一局已開打（觀戰模式將在後續版本提供）","warn",5000); ui.mpMenu(); return;
    }
    var humans=Object.keys(room.lobby||{}).length;
    if(humans>=room.meta.maxPlayers && !(room.lobby||{})[uid]){
      ui.toast("房間已滿（"+room.meta.maxPlayers+" 人）","warn"); ui.mpMenu(); return; }
    ad.open(code);
    mpEnterLobby(ad, code, uid, room.meta);
  }).catch(function(e){ ui.toast("入房失敗："+(e&&e.message||e),"warn",5000); ui.mpMenu(); });
};

ui.mpRejoin = function(){
  var last=null;
  try{ last=JSON.parse(localStorage.getItem("finflow.mp.last")||"null"); }catch(e){}
  if(!last||!last.code){ ui.toast("沒有可重連的房間紀錄","warn"); ui.mpMenu(); return; }
  if(last.uid){ try{ sessionStorage.setItem("finflow.mp.uid", last.uid); }catch(e){} }  // 認回上一局的座位
  ui.mpJoin(last.kind||"local", last.code);
};

/* ================================ 大廳 ================================ */
function mpEnterLobby(ad, code, uid, meta){
  ui.mp.adapter=ad; ui.mp.code=code; ui.mp.uid=uid; ui.mp.meta=meta;
  ui.mp.host=(meta.hostUid===uid);
  try{ localStorage.setItem("finflow.mp.last", JSON.stringify({code:code, kind:ad.kind, uid:uid})); }catch(e){}
  var my={ name: ui.mp.host?"玩家1":"玩家", professionId:"PRO_ENGINEER",
           dreamCardId:ns.content.dreams[0].id, ready:false, ts:now() };
  try{ var saved=JSON.parse(localStorage.getItem("finflow.mp.profile")||"null");
    if(saved){ my.name=saved.name||my.name; my.professionId=saved.professionId||my.professionId;
               my.dreamCardId=saved.dreamCardId||my.dreamCardId; } }catch(e){}
  ad.writeLobby(uid, my);
  ad.setPresence(uid, {lastSeen:now()});
  clearInterval(ui.mp._hb);
  ui.mp._hb=setInterval(function(){ ad.setPresence(uid,{lastSeen:now()}); }, 10000);

  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="720px";
  ov.id="mpLobby";
  var hd=el("div"); hd.style.cssText="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap";
  hd.appendChild(el("h2",null,"大廳"));
  var codeEl=el("b","gold","房號 "+code); codeEl.style.cssText="font-size:26px;letter-spacing:.25em;font-family:var(--mono)";
  hd.appendChild(codeEl); box.appendChild(hd);
  var randProf = (meta.profMode==="random");
  box.appendChild(el("div","sub",(ad.kind==="local"?"同機測試模式（房號只在這台瀏覽器有效）":"把房號念給大家，各自輸入即可加入")+
    "　·　難度："+ns.PRESET_NAMES[meta.preset]+"　·　上限 "+meta.maxPlayers+" 人（真人不足由電腦補位）"+
    "　·　職業："+(randProf?"系統隨機指派":"玩家自選")));
  var listEl=el("div"); box.appendChild(listEl);
  var meEl=el("div"); box.appendChild(meEl);
  var footEl=el("div","opts"); box.appendChild(footEl);
  ov.appendChild(box); $("overlays").appendChild(ov);

  var lobby={};
  function renderMe(){
    meEl.innerHTML="";
    meEl.appendChild(el("h4",null,"你的角色")).style.cssText="margin:12px 0 6px;color:var(--tx3);font-size:13px;letter-spacing:.14em";
    var row=el("div"); row.style.cssText="display:flex;gap:8px;flex-wrap:wrap;align-items:center";
    var nameI=el("input"); nameI.value=my.name; nameI.maxLength=8;
    nameI.style.cssText="width:120px;background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:9px";
    // V2：職業／夢想改成大按鈕選單——自由選、可重複，朋友局隨意
    function push(){ my.ts=my.ts||now(); ad.writeLobby(uid,my);
      try{ localStorage.setItem("finflow.mp.profile", JSON.stringify({name:my.name,professionId:my.professionId,dreamCardId:my.dreamCardId})); }catch(e){} }
    var curProf=ns.content.professionById[my.professionId];
    var curDream=ns.content.byId[my.dreamCardId];
    var profB=el("button","act", randProf ? "🎲 職業：開局隨機指派"
                                          : ("💼 "+(curProf?curProf.name:"選職業")+" ▾"));
    if(randProf){ profB.disabled=true; profB.title="本局由房主設定為系統隨機指派職業"; }
    var drB=el("button","act","🌈 "+(curDream?curDream.name:"選夢想")+" ▾");
    profB.onclick=function(){
      var ov2=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="620px";
      bx.appendChild(el("h2",null,"選職業"));
      bx.appendChild(el("div","sub","自由選、可以和別人重複——朋友局隨意，不是比賽。"));
      var groups={}; ns.content.professions.forEach(function(pf){ (groups[pf.group]=groups[pf.group]||[]).push(pf); });
      Object.keys(groups).forEach(function(g){
        bx.appendChild(el("h4",null,g)).style.cssText="margin:10px 0 4px;color:var(--tx3);font-size:12.5px;letter-spacing:.12em";
        var w=el("div"); w.style.cssText="display:flex;gap:6px;flex-wrap:wrap";
        groups[g].forEach(function(pf){
          var b=el("button","pick"+(pf.id===my.professionId?" on":""));
          b.style.cssText="text-align:left;padding:8px 11px";
          b.innerHTML="<b>"+pf.name+"</b><br><span style='font-size:11.5px;color:var(--tx3)'>月薪 "+M(pf.salary)+"／支出 "+M(pf.baseExpenses)+"</span>";
          b.onclick=function(){ my.professionId=pf.id; my.ready=false; push(); ov2.remove(); renderMe(); };
          w.appendChild(b); });
        bx.appendChild(w);
      });
      var oc=el("div","opts"); oc.appendChild(optBtn(T("act.close"),null,function(){ ov2.remove(); }));
      bx.appendChild(oc); ov2.appendChild(bx); $("overlays").appendChild(ov2);
    };
    drB.onclick=function(){
      var ov3=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="560px";
      bx.appendChild(el("h2",null,"選夢想"));
      bx.appendChild(el("div","sub","走上自由圈之後要去完成的事——可以和別人一樣。"));
      var w=el("div"); w.style.cssText="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";
      ns.content.dreams.forEach(function(d){
        var b=el("button","pick"+(d.id===my.dreamCardId?" on":""), d.name);
        b.onclick=function(){ my.dreamCardId=d.id; my.ready=false; push(); ov3.remove(); renderMe(); };
        w.appendChild(b); });
      bx.appendChild(w);
      var oc=el("div","opts"); oc.appendChild(optBtn(T("act.close"),null,function(){ ov3.remove(); }));
      bx.appendChild(oc); ov3.appendChild(bx); $("overlays").appendChild(ov3);
    };
    var readyB=el("button","act"+(my.ready?" on":" primary"), my.ready?"✅ 已準備（點擊取消）":"✋ 我準備好了！");
    readyB.style.cssText="padding:14px 26px;font-size:17px;font-weight:800;flex:1;min-width:200px";   // V4：加大加鮮明
    nameI.onchange=function(){ my.name=(nameI.value||"玩家").trim()||"玩家"; my.ready=false; push(); };
    readyB.onclick=function(){ my.ready=!my.ready; push(); renderMe(); };
    row.appendChild(el("span",null,"名字")); row.appendChild(nameI);
    row.appendChild(profB);
    row.appendChild(drB);
    row.appendChild(readyB);
    meEl.appendChild(row);
  }
  function renderList(){
    listEl.innerHTML="";
    listEl.appendChild(el("h4",null,"玩家")).style.cssText="margin:12px 0 6px;color:var(--tx3);font-size:13px;letter-spacing:.14em";
    var uids=Object.keys(lobby).sort(function(a,b){ return (lobby[a].ts||0)-(lobby[b].ts||0); });
    uids.forEach(function(u,i){
      var L=lobby[u], r=el("div");
      r.style.cssText="display:flex;gap:10px;align-items:center;padding:6px 4px;border-bottom:1px solid var(--line)";
      r.appendChild(el("b",null,(i+1)+". "+L.name+(u===meta.hostUid?"（房主）":"")+(u===uid?"（你）":"")));
      var pf=ns.content.professionById[L.professionId];
      r.appendChild(el("span",null,(randProf?"🎲 隨機職業":(pf?pf.name:"—"))+"・"+((ns.content.byId[L.dreamCardId]||{}).name||"—"))).style.cssText="color:var(--tx3);font-size:13px";
      r.appendChild(el("span",L.ready?"pos":"", L.ready?"✅ 準備完成":"…選角中")).style.marginLeft="auto";
      listEl.appendChild(r);
    });
    var fill=meta.maxPlayers-uids.length;
    if(fill>0) listEl.appendChild(el("div",null,"（開局時將補入 "+fill+" 位電腦玩家）")).style.cssText="color:var(--tx3);font-size:13px;padding:6px 4px";
    renderFoot(uids);
  }
  function renderFoot(uids){
    footEl.innerHTML="";
    if(ui.mp.host){
      var allReady=uids.length>=1 && uids.every(function(u){ return lobby[u].ready; });
      var manyOk = uids.length>=1;   // 允許 1 真人＋NPC（測試方便）；正式對戰自然多人
      footEl.appendChild(optBtn("🚀 開局（房主）", allReady?"全員準備完成":"等待全員按下「準備」",
        function(){ mpHostStart(ad, meta, lobby); }, allReady&&manyOk));
    } else {
      footEl.appendChild(el("div","flavor","等待房主開局…"));
    }
    footEl.appendChild(optBtn("離開房間",null,function(){
      ad.writeLobby(uid,null); clearInterval(ui.mp._hb); ad.close();
      ov.remove(); ui.mp.adapter=null; ui.mpMenu();
    }));
  }
  var started=false;
  ad.onLobby(function(lb){ lobby=lb||{}; renderList(); });
  ad.onMeta(function(m){
    if(m && m.status==="playing" && !started){
      started=true;
      // 房主寫好 setup 才會切 playing → 讀 setup 開局
      Promise.resolve(ad.readRoom(code)).then(function(room){
        if(!room||!room.setup){ setTimeout(function(){ ad.readRoom(code).then(function(r2){ if(r2&&r2.setup){ ov.remove(); mpBeginGame(ad, code, uid, r2.setup); } }); },400); return; }
        ov.remove(); mpBeginGame(ad, code, uid, room.setup);
      });
    }
  });
  Promise.resolve(ad.readRoom(code)).then(function(room){ if(room){ lobby=room.lobby||{}; renderList(); } });
  renderMe();
}

/* ============================ 房主開局 ============================ */
function mpHostStart(ad, meta, lobby){
  var uids=Object.keys(lobby).sort(function(a,b){ return (lobby[a].ts||0)-(lobby[b].ts||0); });
  var seed=(Math.random()*1e9)|0;
  var players=uids.map(function(u){ var L=lobby[u];
    return { name:L.name, isNPC:false, professionId:L.professionId, dreamCardId:L.dreamCardId, uid:u }; });
  var pers=ns.content.personalities, dreams=ns.content.dreams;
  // S13.1 §1：房主選「系統隨機」時，真人的職業在這裡一次抽定（不重複），
  // 結果完整寫進 setup，各端只讀不重算——與 NPC 補位一樣維持決定論。
  if(meta.profMode==="random"){
    var bag={ rngState: seed>>>0 };
    var shuffled=util.shuffle(bag, ns.content.professions.map(function(pf){ return pf.id; }));
    players.forEach(function(pl,i){ pl.professionId = shuffled[i % shuffled.length]; });
  }
  // 電腦補位（決定論：由 setup 完整記錄，各端不重算）
  var taken=players.map(function(p){ return p.professionId; });
  var pool=ns.content.professions.filter(function(p){ return taken.indexOf(p.id)<0; });
  var npcN=0;
  for(var i=players.length;i<meta.maxPlayers;i++){
    var per=pers[npcN%pers.length];
    var pf = pool.length ? pool.splice((npcN*5+3)%pool.length,1)[0] : ns.content.professions[npcN%ns.content.professions.length];
    players.push({ name:per.name+(Math.floor(npcN/pers.length)>0?"②":""),
      isNPC:true, personality:per.id,
      professionId: pf.id, dreamCardId: dreams[(npcN+1)%dreams.length].id });
    npcN++;
  }
  var config=ui.buildGameConfig(ns.PRESETS[meta.preset]);
  var setup={ seed:seed, config:config, modules:meta.modules, players:players,
              profMode:meta.profMode||"pick", startedAt:now() };
  Promise.resolve(ad.writeSetup(setup)).then(function(){ return ad.writeMeta({status:"playing"}); });
  // 自己也由 onMeta 回呼開局（與其他端走同一路徑）
}

/* ============================ 進入遊戲／重連 ============================ */
function mpBeginGame(ad, code, uid, setup){
  var seat=-1;
  setup.players.forEach(function(pl,i){ if(pl.uid===uid) seat=i; });
  if(seat<0){ ui.toast("你不在這一局的座位表上","warn"); return; }
  ui.mp.mode=true; ui.mp.seat=seat; ui.mp.setup=setup;
  ui.mp.host=(ui.mp.meta&&ui.mp.meta.hostUid===uid);
  ui.mp.seatUid={}; setup.players.forEach(function(pl,i){ if(pl.uid) ui.mp.seatUid[i]=pl.uid; });
  ui.mp.replaying=true;
  ui.startCore(setup.seed, util.clone(setup.config), setup.modules, setup.players.map(function(pl){
    return { name:pl.name, isNPC:pl.isNPC, personality:pl.personality, professionId:pl.professionId, dreamCardId:pl.dreamCardId };
  }), {noRules:false});
  // 追上既有動作（重連時）
  Promise.resolve(ad.readLog()).then(function(log){
    (log||[]).forEach(function(entry){ mpApplyEntry(entry); });
    ui.mp.replaying=false;
    ui.render(); mpAfter();
    if((log||[]).length) ui.toast("已同步至第 "+ui.S.turnNumber+" 輪","good");
    // V3：我離席過（座位變電腦代打）→ 回來自動接手
    var meP=ui.S && ui.S.players[ui.mp.seat];
    if(meP && meP.isNPC && meP.flags && meP.flags.leftHuman)
      setTimeout(function(){ mpSend({type:"PLAYER_RETURN",playerId:ui.mp.seat,payload:null}); }, 300);
  });
  ad.onAction(function(entry){ mpOnAction(entry); });
  ad.onPresence(function(p){ ui.mp.presence=p||{}; if(ui.S) ui.renderPlayerCards(); });
  ad.onMeta(function(m){
    if(!m) return;
    var wasHost=ui.mp.host;
    ui.mp.meta=m; ui.mp.host=(m.hostUid===ui.mp.uid);
    if(ui.S && !ui.mp.replaying){ ui.renderPlayerCards();
      if(!wasHost && ui.mp.host){ ui.toast("👑 你接任房主：電腦玩家改由你的裝置代跑","good",4500); mpAfter(); } }
  });
}

function mpResume(ad, code, uid, room){
  ui.mp.adapter=ad; ui.mp.code=code; ui.mp.uid=uid; ui.mp.meta=room.meta;
  try{ localStorage.setItem("finflow.mp.last", JSON.stringify({code:code, kind:ad.kind, uid:uid})); }catch(e){}
  ad.open(code);
  ad.setPresence(uid,{lastSeen:now()});
  clearInterval(ui.mp._hb);
  ui.mp._hb=setInterval(function(){ ad.setPresence(uid,{lastSeen:now()}); },10000);
  mpBeginGame(ad, code, uid, room.setup);
}

/* ============================ Lockstep 核心 ============================ */
function mpApplyEntry(entry){
  var S=ui.S;
  if(!S || !entry) return;
  if(entry.seq < S.actionLog.length) return;                       // 已套用
  if(entry.seq > S.actionLog.length){ ui.mp._pending[entry.seq]=entry; return; }  // 之後補
  var res=E.apply(S, {type:entry.type, playerId:entry.playerId, payload:entry.payload});
  if(res.rejected){
    // 決定論破口（理論上不會發生）：全量重放自救
    console.error("MP desync on seq",entry.seq,entry.type);
    mpFullResync(); return;
  }
  ui.S=res.state;
  ui.handleEvents(res.events);   // replaying 時 toast／公告已由包裝器靜音
  var nx;
  while((nx=ui.mp._pending[ui.S.actionLog.length])){ ui.mp._pending[ui.S.actionLog.length]=undefined; mpApplyEntry(nx); }
}
function mpOnAction(entry){
  mpApplyEntry(entry);
  if(!ui.mp.replaying){ ui.render(); ui.save(); mpAfter(); }
}
function mpFullResync(){
  var ad=ui.mp.adapter, setup=ui.mp.setup;
  ui.mp.replaying=true;
  ui.startCore(setup.seed, util.clone(setup.config), setup.modules, setup.players.map(function(pl){
    return { name:pl.name, isNPC:pl.isNPC, personality:pl.personality, professionId:pl.professionId, dreamCardId:pl.dreamCardId };
  }), {noRules:true});
  Promise.resolve(ad.readLog()).then(function(log){
    (log||[]).forEach(function(e2){ mpApplyEntry(e2); });
    ui.mp.replaying=false; ui.render(); mpAfter();
  });
}

// 誰可以送出這個動作
function mpMayAct(action){
  var S=ui.S, p=S.players[action.playerId];
  if(!p) return false;
  if(action.type==="CONFIG_PATCH") return ui.mp.host;              // 參數：多人局僅房主（開局前）
  if(action.type==="PLAYER_RETURN") return action.playerId===ui.mp.seat;   // 只有原座位主人能接回
  if(p.isNPC) return ui.mp.host;                                   // NPC 由房主代跑
  return action.playerId===ui.mp.seat;                             // 真人只能動自己的
}

/* S19：被拒原因翻成人話。玩家看到「NO_CAPACITY」只會更慌。 */
ui.REJECT_TEXT = {
  NO_CAPACITY:"信用額度不足，借不到這個金額（額度＝月收入 × 倍數 − 現有無擔保負債）",
  NOT_YOUR_TURN:"這個動作只能在自己的回合做",
  NOT_YOUR_DECISION:"這是別人要回答的決定",
  MALL_LIMIT:"這一輪的商城購買次數已經用完",
  MALL_COOLDOWN:"該商城項目仍在冷卻中，暫時無法再次購買",
  PREREQUISITE_REQUIRED:"這是高階技能，要先學會它的先修技能",
  ADV_LOCKED:"進階金融還沒解鎖：要累計持股滿一定輪數，或學會〈衍生性商品與槓桿〉",
  NO_M9:"本局沒有開啟「進階金融」模組（進階難度以上才有）",
  FUT_LOT_LIMIT:"超過你的信用評級能開的口數上限",
  OPPOSITE_POSITION:"同一個標的不能同時作多與放空——要換方向請先平倉",
  NO_POSITION:"找不到這個部位（可能已經平倉或被強制平倉）",
  NO_CRYPTO:"本局沒有開啟虛擬貨幣",
  NO_MARGIN_ASSET:"這個標的不能融資——沒有券商會拿一個單輪能動 ±50%、又沒有盈餘的東西當擔保品",
  NO_MODULE:"本局沒有開啟這個標的所需的模組",
  DEPTH_LOCKED:"本局難度沒有開放這個功能",
  MUST_ROLL:"要先擲骰才能結束回合",
  DELISTED:"這檔已經下市，不能買進",
  BOOKKEEPING_INCOMPLETE:"還有記帳題目沒做完",
  IN_FREEFALL:"現金是負的，先把洞補起來再說",
  CREDIT_C:"信用評級 C，暫時不開放這個動作",
  NEGATIVE_CASHFLOW:"淨現金流是負的，融資閘門擋下了這一步"
};
function mpSend(action, opts){
  var S=ui.S;
  var auto = !!(opts && opts.auto);        // S19：只有自動流程（電腦代跑）的連續被拒才算「卡住」
  // 本地試跑：被拒就不上傳（log 內永遠只有可重放的動作）
  var trial=E.apply(S, action);
  if(trial.rejected){
    // S15d：這裡原本只丟一句 toast 就結束，電腦玩家的迴圈（mpAfter）因此永遠不會再被叫起——
    // 實測回報「看到『這動作不能』就掛了」正是這個。改成把被拒的原因攤開，並提供出路。
    var rj=(trial.events||[]).filter(function(e){return e.type==="ACTION_REJECTED";}).slice(-1)[0];
    var why=(rj&&rj.reason)||"";
    var human=ui.REJECT_TEXT[why];
    ui.toast(human || (T("toast.rejected")+(why?("（"+why+"）"):"")), "warn", 4500, "MINE");
    /* S19：原本玩家自己按的動作被拒三次就跳「卡住了——這是程式的問題」。
       實測合資邀約那顆借款鈕重按就會中——那不是卡住，是額度真的不夠。
       只有電腦代跑的迴圈連續推不動才是真的卡住。
       S21：電腦代跑在 READY_END 被拒（例如商城冷卻）就直接補 END_TURN，回合不會停在那裡。 */
    if(auto){
      if(S.phase==="READY_END"){
        setTimeout(function(){
          mpSend({ type:"END_TURN", playerId:action.playerId, payload:null }, { auto:true });
        }, 150);
        return;
      }
      ui.mp._rejects=(ui.mp._rejects||0)+1;
      if(ui.mp._rejects>=3 && ui.showStuck){ ui.mp._rejects=0; ui.showStuck(new Error("多人局動作連續被拒："+(why||"?"))); }
    }
    return;
  }
  ui.mp._rejects=0;
  var entry={ seq:S.actionLog.length, playerId:action.playerId, type:action.type,
              payload:action.payload||null, uid:ui.mp.uid, ts:now() };
  Promise.resolve(ui.mp.adapter.appendAction(entry.seq, entry)).then(function(r){
    if(r==="conflict"){
      // 有人先寫（極罕見）：補齊後放棄本次，讓玩家看到最新狀態再操作
      Promise.resolve(ui.mp.adapter.readLog()).then(function(log){
        (log||[]).forEach(function(e2){ mpApplyEntry(e2); });
        ui.render(); ui.toast("狀態已更新，請再操作一次","warn");
      });
    }
    // ok：等 onAction 回聲套用（各端一致的唯一路徑）
  }).catch(function(e){ ui.toast("連線寫入失敗："+(e&&e.message||e),"warn",5000); });
}

/* ---- NPC 由房主代跑 ---- */
function mpAfter(){
  var S=ui.S;
  if(!S || S.over || !ui.mp.host || ui.mp.replaying) return;
  /* S15d：多人局把 ui.tick 換成了這支函式，所以 S15a 加在 ui.tick 上的卡住偵測
     在多人局完全沒有生效——這次真實連線局掛住就是掛在這裡。把同一套防護補上：
     等真人回應時安靜停下、狀態沒前進就攤開來講。 */
  var wOn = E.waitingOnHumans(S);
  if(wOn && wOn.waiting && wOn.waiting.length){ ui.mp._stall=0; return; }
  // 待決事項屬於某個真人時，該由他的裝置回答，房主不代跑
  var pd=S.pendingDecision;
  if(pd && pd.playerId!==undefined && pd.playerId!==null && !S.players[pd.playerId].isNPC){
    ui.mp._stall=0; return;
  }
  var p=E.activePlayer(S);
  if(!p.isNPC) return;
  clearTimeout(ui.mp._npcT);
  ui.mp._npcT=setTimeout(function(){
    var S2=ui.S; if(!S2||S2.over) return;
    var pp=E.activePlayer(S2); if(!pp.isNPC) return;
    var sigBefore = ui.tickSig ? ui.tickSig() : null;
    var a=ns.npc.nextAction(S2);
    if(!a) a={type:"END_TURN", playerId:pp.id, payload:null};
    if(a.type==="DECIDE" && S2.pendingDecision) a.payload.decisionId=S2.pendingDecision.decisionId;
    mpSend(a, {auto:true});
    // 送出後給回聲一點時間；若狀態完全沒動，累計並在超過上限時攤開狀態
    setTimeout(function(){
      if(!ui.S || ui.S.over || !ui.mp.mode) return;
      if(ui.tickSig && ui.tickSig()===sigBefore){
        ui.mp._stall=(ui.mp._stall||0)+1;
        if(ui.mp._stall>=(ui.TICK_STALL_LIMIT||8)){ ui.mp._stall=0; if(ui.showStuck) ui.showStuck(null); }
        else mpAfter();
      } else ui.mp._stall=0;
    }, 1200);
  }, Math.max(80, S.config.npcTurnMs/3));
}

/* ---- V3：離開本局（交給電腦代打；房主自動交棒） ---- */
ui.mpLeaveGame = function(){
  var S=ui.S; if(!S || !ui.mp.mode) return;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="480px";
  box.appendChild(el("h2",null,"🚪 離開這一局？"));
  var others=S.players.filter(function(x){ return !x.isNPC && x.id!==ui.mp.seat && !x.bankrupt; });
  box.appendChild(el("div","sub","你的座位會交給電腦代打，遊戲繼續。之後隨時可用「多人連線 → 重新連線上一局」回來接手。"+
    (ui.mp.host ? (others.length?"　你是房主：離開後房主自動交棒給 "+others[0].name+"。"
                               :"　你是房主且沒有其他真人：這局會暫停保留，任何人重新連線即可續玩。") : "")));
  var o=el("div","opts");
  o.appendChild(optBtn("確定離開","座位交給電腦，回到開局畫面",function(){
    ov.remove();
    ui.dispatch({type:"PLAYER_LEAVE",playerId:ui.mp.seat,payload:null});
    var nextUid=null;
    if(ui.mp.host && others.length) nextUid=ui.mp.seatUid[others[0].id]||null;
    setTimeout(function(){
      if(nextUid && ui.mp.adapter) ui.mp.adapter.writeMeta({hostUid:nextUid});
      setTimeout(function(){ try{ location.reload(); }catch(e){} }, 400);
    }, 600);
  },true));
  o.appendChild(optBtn(T("act.close"),"繼續玩",function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ======================= 既有 UI 的多人包裝 ======================= */
// 1) dispatch：多人時走 mpSend
var origDispatch=ui.dispatch;
ui.dispatch=function(action){
  if(!ui.mp.mode) return origDispatch(action);
  if(!ui.S || ui.busy) return;
  if(!mpMayAct(action)){ ui.toast("現在不是你能操作的對象","warn"); return; }
  mpSend(action);
};
// 2) NPC 迴圈：多人時由 mpAfter 接手（僅房主）
var origTick=ui.tick;
ui.tick=function(){ if(ui.mp.mode){ mpAfter(); return; } return origTick(); };
// 3) 存檔：多人局狀態以房間紀錄為準，本機只記房號
var origSave=ui.save;
ui.save=function(){ if(ui.mp.mode){ return; } return origSave(); };
// 4) 重放靜音：補放歷史動作時不彈提示與公告
["toast","broadcast","showPayslip","showMarginWarning","showAuctionResult","showMarginCallLesson","showOpenOffer","showP2POffer","showBidPanel","showReferralOffer","showJVOffer"]
.forEach(function(fn){ var orig=ui[fn];
  if(orig) ui[fn]=function(){ if(ui.mp.mode&&ui.mp.replaying) return; return orig.apply(ui,arguments); }; });
// 5) 轉讓視窗只在當事人裝置彈出（勾心鬥角要面對面談，遊戲只記結果）
var origOffer=ui.showTradeOffer;
ui.showTradeOffer=function(pt){
  if(ui.mp.mode){ if(ui.mp.replaying) return; if(!pt||pt.buyerId!==ui.myId()) return; }
  return origOffer(pt); };
var origCounter=ui.showCounter;
ui.showCounter=function(pt){
  if(ui.mp.mode){ if(ui.mp.replaying) return; if(!pt||pt.sellerId!==ui.myId()) return; }
  return origCounter(pt); };
// 6) 他人回合／他人決策 → 等待畫面；另掛「待回應」提示條（跨裝置報價與邀約不漏接）
function mpPendingBar(){
  var S=ui.S; if(!S) return;
  var bc=$("boardCenter"); if(!bc) return;
  var mk=function(txt,label,fn){
    var bar=el("div","npcThink"); bar.style.cursor="pointer";
    bar.appendChild(el("b",null,txt));
    bar.appendChild(el("div",null,label));
    bar.onclick=fn; bc.appendChild(bar);
  };
  var pt=S.pendingTrade, me=ui.myId();
  if(pt){
    if(pt.status==="await_human" && pt.buyerId===me)
      mk("💰 "+S.players[pt.sellerId].name+" 開價賣你「"+pt.name+"」","點這裡回應（接受或拒絕）",function(){ ui.showTradeOffer(pt); });
    else if(pt.status==="counter" && pt.sellerId===me)
      mk("💰 "+S.players[pt.buyerId].name+" 對「"+pt.name+"」還價","點這裡回應（成交或不賣）",function(){ ui.showCounter(pt); });
    else if(pt.status==="open" && !S.players[me].bankrupt && pt.sellerId!==me && !(pt.declined&&pt.declined[me]))
      mk("📢 "+S.players[pt.sellerId].name+" 廣播出售「"+pt.name+"」","開價 "+M(pt.askPrice)+"　點這裡搶購或婉拒",function(){ ui.showOpenOffer(pt); });
    else if((pt.status==="open"||pt.status==="await_human") && pt.sellerId===me)
      mk("⏳ 你的報價「"+pt.name+"」等待回應中","點這裡可取消報價",function(){ ui.dispatch({type:"CLEAR_TRADE",playerId:me,payload:null}); ui.toast("已取消報價","warn"); });
  }
  var pq=S.pendingP2P;
  if(pq && !pq.open){
    if(pq.targetId===me)
      mk("💸 有一筆借貸邀約等你回應","點這裡查看（接受或婉拒）",function(){ ui.showP2POffer(pq); });
    else if(pq.byId===me)
      mk("⏳ 借貸邀約已送出","等待 "+S.players[pq.targetId].name+" 回應…",null);
  }
  var pa=S.pendingAuction;
  if(pa){
    if(pa.waiting.indexOf(me)>=0)
      mk("🔨 「"+pa.title+"」拍賣等你出價","點這裡密封出價（0＝棄標）",function(){ ui.showBidPanel(pa); });
    else if(pa.sellerId===me)
      mk("⏳ 拍賣進行中：「"+pa.title+"」","還差 "+pa.waiting.length+" 位玩家出價…",null);
    else
      mk("🔨 拍賣進行中：「"+pa.title+"」","你已出價或不在本場，等待開標…",null);
  }
  var pf=S.pendingReferral;
  if(pf && !pf.open){
    if(pf.toId===me)
      mk("🤝 "+S.players[pf.fromId].name+" 轉介機會給你","點這裡查看卡片並回應",function(){ ui.showReferralOffer(pf); });
    else if(pf.fromId===me)
      mk("⏳ 轉介邀約已送出","等待 "+S.players[pf.toId].name+" 回應…",null);
  }
  var pj=S.pendingJV;
  if(pj){
    var meP2=S.players[me];
    if(pj.fromId===me)
      mk("⏳ 合資邀約已送出：「"+pj.title+"」","等待"+(pj.targetId===null?"任何一位真人":S.players[pj.targetId].name)+"回應…",null);
    else if((pj.targetId===me) || (pj.targetId===null && !meP2.isNPC && !meP2.bankrupt && !(pj.declined&&pj.declined[me])))
      mk("🤝 "+S.players[pj.fromId].name+" 邀你合資「"+pj.title+"」","點這裡查看並回應",function(){ ui.showJVOffer(pj); });
  }
  if(pq && pq.open){
    var meP3=S.players[me];
    if(pq.borrowerId===me)
      mk("⏳ 借款需求已廣播","等待放款人回應…",null);
    else if(!meP3.isNPC && !meP3.bankrupt && !(pq.declined&&pq.declined[me]))
      mk("💸 "+S.players[pq.borrowerId].name+" 廣播借款 "+M(pq.amount),"點這裡決定要不要放款",function(){ ui.showP2POffer(pq); });
  }
  if(pq && pq.openLend){
    var meP4=S.players[me];
    if(pq.lenderId===me)
      mk("⏳ 放款需求已廣播","等待借款人回應…",null);
    else if(!meP4.isNPC && !meP4.bankrupt && !(pq.declined&&pq.declined[me]))
      mk("💸 "+S.players[pq.lenderId].name+" 廣播放款 "+M(pq.amount),"點這裡決定要不要借",function(){ ui.showP2POffer(pq); });
  }
  if(pf && pf.open){
    var meP5=S.players[me];
    if(pf.fromId===me)
      mk("⏳ 轉介已廣播：「"+pf.title+"」","等待有人接手…",null);
    else if(!meP5.isNPC && !meP5.bankrupt && !(pf.declined&&pf.declined[me]))
      mk("🤝 "+S.players[pf.fromId].name+" 廣播轉介「"+pf.title+"」","點這裡查看卡片並回應",function(){ ui.showReferralOffer(pf); });
  }
}
var origCenter=ui.renderCenter;
ui.renderCenter=function(){
  if(!ui.mp.mode || !ui.S) return origCenter();
  var S=ui.S;
  if(S.over) return origCenter();
  var active=E.activePlayer(S);
  var mineTurn;
  if(S.phase==="BOOKKEEPING") mineTurn = S.bookkeeping && S.bookkeeping.playerId===ui.myId();
  else if(S.pendingDecision)  mineTurn = S.pendingDecision.playerId===ui.myId();
  else                        mineTurn = S.activePlayerIdx===ui.myId();
  // 轉讓等待回應：提案者看得到等待條（回應者由 showTradeOffer 彈窗）
  if(active.isNPC && !S.pendingDecision){ var r1=origCenter(); mpPendingBar(); return r1; }   // NPC 思考卡照舊
  if(mineTurn){ var r2=origCenter(); mpPendingBar(); return r2; }
  // 等待他人
  var c=$("center"), bc=$("boardCenter"), tray=$("bkTray");
  if(ui._autoRollT){ clearInterval(ui._autoRollT); ui._autoRollT=null; }
  c.innerHTML=""; bc.innerHTML=""; ui.modalOn(false);
  if(tray){ tray.classList.add("hide"); tray.innerHTML=""; }
  var who = S.phase==="BOOKKEEPING" ? S.players[S.bookkeeping.playerId]
          : S.pendingDecision ? S.players[S.pendingDecision.playerId] : active;
  var doing = S.phase==="BOOKKEEPING" ? "記帳中" : S.pendingDecision ? "做決定中" : (S.phase==="ROLL"?"準備擲骰":"處理回合");
  var wait=el("div","npcThink");
  wait.appendChild(el("b",null,"⏳ 等待 "+who.name));
  wait.appendChild(el("div",null,doing+"…　你可以先看財報、規劃下一步"));
  bc.appendChild(wait);
  mpPendingBar();
};
// 7) 玩家列加上線燈（依 setup 座位→uid），多人局結束遊戲鈕僅房主
var origCards=ui.renderPlayerCards;
ui.renderPlayerCards=function(){
  origCards();
  if(!ui.mp.mode || !ui.S) return;
  var seatUid=ui.mp.seatUid||{}, presence=ui.mp.presence||{};   // S13.1：尚未就緒時不得讓整片 render 掛掉
  var cols=$("pawns") ? $("pawns").children : [];
  for(var i=0;i<cols.length;i++){
    var u=seatUid[i];
    if(!u) continue;   // NPC
    var pr=presence[u];
    var on = pr && (now()-(pr.lastSeen||0) < 30000);
    var nm=cols[i].querySelector(".nm");
    if(nm){ var dot=el("span",null,on?"🟢":"🔴"); dot.style.fontSize="9px"; nm.insertBefore(dot, nm.firstChild); }
  }
  var be=$("btnEnd");
  if(be && ui.S.over){ be.disabled=true; }
  else if(be){
    if(!ui.mp.host){
      be.disabled=false; be.textContent="🚪 離開本局"; be.title="離開後座位交給電腦代打，可重新連線回來接手";
      be.onclick=function(){ ui.mpLeaveGame(); };
    } else {
      be.textContent=T("act.end");
      be.onclick=function(){
        var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="460px";
        bx.appendChild(el("h2",null,"要怎麼離場？"));
        var oo=el("div","opts");
        oo.appendChild(optBtn("🏁 結束遊戲（全員結算排名）","整局結束，大家看結果",function(){ ov.remove();
          ui.dispatch({type:"END_GAME",playerId:ui.mp.seat,payload:null}); }));
        oo.appendChild(optBtn("🚪 只有我離開（電腦代打）","遊戲繼續，房主交棒",function(){ ov.remove(); ui.mpLeaveGame(); }));
        oo.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
        bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
      };
    }
  }
  var bd=$("btnDev");
  if(bd){ bd.disabled=true; bd.title="多人局鎖定參數（決定論要求全員一致）"; }
};
// 8) 多人局：拍賣／合資／轉介對真人暫由系統自動評估（M12-B 開放真人親答）——提示語
// V3：拍賣、合資、轉介、轉讓、P2P 全數真人親答——不再需要「系統代答」註記


})(ns);
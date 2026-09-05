/* ============================================================================
   FinFlow 財商沙盒 — 引擎層（純函數，零 DOM 依賴）
   鐵律一：引擎不讀寫 DOM、不使用 Date.now() / 未播種的 Math.random()
   鐵律二：所有數值來自內容包與 CONFIG
   鐵律三：每一筆金錢變動都產生 LedgerEntry
   ============================================================================ */
var ns = (function(){
"use strict";
var ns = {};

/* ------------------------------ ns.util ---------------------------------- */
var util = ns.util = {
  clone: function(o){ return typeof structuredClone==="function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)); },
  r2: function(n){ return Math.round(n*100)/100; },
  // mulberry32：32-bit seeded PRNG。所有遊戲隨機都經由 state.rngState 推進
  rand: function(S){ var t = S.rngState += 0x6D2B79F5; t = Math.imul(t ^ t>>>15, t|1);
    t ^= t + Math.imul(t ^ t>>>7, t|61); return ((t ^ t>>>14) >>> 0) / 4294967296; },
  // NPC 專用亂數串流：不污染引擎 rngState，確保 actionLog 重放一致（T-01）
  randAux: function(S){ var t = S.auxRngState = (S.auxRngState + 0x9E3779B9)>>>0;
    t = Math.imul(t ^ t>>>16, 0x21F0AAAD); t = Math.imul(t ^ t>>>15, 0x735A2D97);
    return ((t ^ t>>>15) >>> 0) / 4294967296; },
  randInt: function(S,a,b){ return a + Math.floor(util.rand(S)*(b-a+1)); },
  gauss: function(S){ var u=1-util.rand(S), v=util.rand(S);
    return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); },
  shuffle: function(S,arr){ var a=arr.slice(); for(var i=a.length-1;i>0;i--){
    var j=Math.floor(util.rand(S)*(i+1)); var t=a[i];a[i]=a[j];a[j]=t; } return a; },
  pick: function(S,arr){ return arr[Math.floor(util.rand(S)*arr.length)]; },
  money: function(n){ var v=Math.round(n*1000); var s=Math.abs(v).toLocaleString("en-US");
    return (v<0?"−":"")+s; },
  pct: function(n,d){ return (n*100).toFixed(d===undefined?1:d)+"%"; },
  sum: function(a,f){ var s=0; for(var i=0;i<a.length;i++) s+=f(a[i],i); return s; },
  uid: function(S,p){ S.uidSeq=(S.uidSeq||0)+1; return p+"_"+S.uidSeq; }
};

/* ----------------------------- ns.ledger --------------------------------- */
/* 財報唯一真值來源：所有數字都由 postings 推導。
   存量科目：CASH / ASSET / LIABILITY（累加 = 當前餘額）
   流量科目：INCOME_ACTIVE / INCOME_PASSIVE / EXPENSE（累加 = 當前每月流量） */
var ledger = ns.ledger = {
  ACCOUNTS: ["CASH","ASSET","LIABILITY","INCOME_ACTIVE","INCOME_PASSIVE","EXPENSE"],
  QUADRANT: { ASSET:"asset", LIABILITY:"liab", INCOME_ACTIVE:"income", INCOME_PASSIVE:"income", EXPENSE:"expense" },

  post: function(S, p, summary, postings, opts){
    opts = opts||{};
    var entry = { entryId: util.uid(S,"e"), turnNumber: S.turnNumber, playerId: p.id,
      sourceAction: S.actionLog.length, summary: summary,
      postings: postings.filter(function(x){ return x.delta !== 0; }).map(function(x){
        return { account:x.account, delta:util.r2(x.delta), refId:x.refId||null, label:x.label }; }),
      eduTags: opts.eduTags||[], detail: opts.detail||null, kind: opts.kind||"TX",
      // 每輪紀錄要能回答「這筆錢是哪件事造成的」——效果的 label 常常只寫結果（如「修繕與停業損失」），
      // 看不出來源是哪張卡（強震／強颱）。這裡把來源標題一起留下。
      srcTitle: opts.srcTitle||null };
    if(!entry.postings.length && !entry.detail) return null;
    entry = ns.modules.beforeLedgerPost(S, p, entry);
    if(!entry) return null;
    p.ledger.push(entry);
    ledger.recompute(p);
    return entry;
  },

  recompute: function(p){
    var d = { salaryIncome:0, passiveIncome:0, totalExpenses:0, netCashflow:0,
              totalAssets:0, totalLiabilities:0, netWorth:0 }, cash=0;
    for(var i=0;i<p.ledger.length;i++){ var ps=p.ledger[i].postings;
      for(var j=0;j<ps.length;j++){ var q=ps[j];
        switch(q.account){
          case "CASH": cash+=q.delta; break;
          case "ASSET": d.totalAssets+=q.delta; break;
          case "LIABILITY": d.totalLiabilities+=q.delta; break;
          case "INCOME_ACTIVE": d.salaryIncome+=q.delta; break;
          case "INCOME_PASSIVE": d.passiveIncome+=q.delta; break;
          case "EXPENSE": d.totalExpenses+=q.delta; break;
        } } }
    d.salaryIncome=util.r2(d.salaryIncome); d.passiveIncome=util.r2(d.passiveIncome);
    d.totalExpenses=util.r2(d.totalExpenses); d.totalAssets=util.r2(d.totalAssets);
    d.totalLiabilities=util.r2(d.totalLiabilities);
    d.netCashflow=util.r2(d.salaryIncome+d.passiveIncome-d.totalExpenses);
    d.netWorth=util.r2(cash+d.totalAssets-d.totalLiabilities);
    p.cash=util.r2(cash); p.derived=d;
    if(p.cash<0 && p.creditFlags) p.creditFlags.cashWentNegative=true;   // M7：本檢視期內曾現金為負
    return d;
  },

  freedomRatio: function(p){ var d=p.derived;
    return d.totalExpenses<=0 ? 1 : Math.max(0, d.passiveIncome/d.totalExpenses); }
};

/* ----------------------------- ns.engine --------------------------------- */
var E = ns.engine = {};
E.VERSION = 1;
ns.BUILD = { ver:"v2.46.0-S38", date:"2026-09-05" };   // 顯示於系統訊息與開局畫面
E._events = [];
E.ev = function(t,d){ d=d||{}; d.type=t; E._events.push(d); return d; };

/* --- CONFIG 讀取：base 值 + 進行中事件覆寫（高 priority 優先，同級取最後生效） --- */
E.cfg = function(S, key){
  var best=null;
  for(var i=0;i<S.activeGlobalEvents.length;i++){ var ev=S.activeGlobalEvents[i];
    if(ev.param===key){ if(!best || ev.priority>best.priority || (ev.priority===best.priority && ev.seq>best.seq)) best=ev; } }
  return best ? best.value : S.config[key];
};
E.effMaxLTV = function(S, card){
  var liq = S.enabledModules.indexOf("M4")>=0 ? S.macro.liquidity : 1;
  var ceil = E.cfg(S,"maxLTVCeiling"); if(ceil===undefined) ceil=0.85;
  /* S37：大額／特殊機會的「大戶成數」——銀行對大標的與有人脈的客戶給得比較鬆（台灣實務也成立）。
     bigDealLtvBonus 同時墊高硬上限與景氣後的成數，否則卡面 15% 自備款在復甦期會被 0.8 壓回 20%，等於白改。
     沒帶 card（舊呼叫端）＝一般成數，行為不變。 */
  var bonus = 0;
  if(card && (card.deck==="OPPORTUNITY_LARGE" || card.deck==="OPPORTUNITY_SPECIAL")){
    bonus = E.cfg(S,"bigDealLtvBonus"); if(bonus===undefined || !isFinite(bonus)) bonus=0.05;
  }
  return Math.max(0.3, Math.min(ceil+bonus, E.cfg(S,"maxLTV") * liq + bonus));
};
// 本利攤還月付額（等額本息）
E.pmt = function(P, annualRate, months){
  P=P||0; if(months<=0) return util.r2(P);
  var r=annualRate/12;
  if(r<1e-9) return util.r2(P/months);
  return util.r2(P * r / (1 - Math.pow(1+r, -months)));
};
// 各類貸款年限（月）：融資只付息(0)，房貸 20 年，學貸 2 年，其餘信貸 7 年
E.loanTerm = function(S, kind, isStudent){
  if(kind==="MARGIN") return 0;
  if(isStudent){ var st=E.cfg(S,"studentTermMonths"); return st===undefined?24:st; }
  if(kind==="MORTGAGE"){ var mt=E.cfg(S,"mortgageTermMonths"); return mt===undefined?240:mt; }
  var ct=E.cfg(S,"creditTermMonths"); return ct===undefined?84:ct;
};
E.isStudentLoan = function(name){ return /學貸/.test(name||"") && !/留學/.test(name||""); };
// 重算某貸款的月付（餘額/利率/年限變動時）；回傳 EXPENSE 變動量
E.repriceLoan = function(l){
  if(l.studentLoan && !l.amortStarted){ return 0; } // 學貸寬限期不重算
  var newPay = l.termMonths>0 ? E.pmt(l.principal, l.annualRate, l.termMonths) : util.r2(l.principal*l.annualRate/12);
  var d = util.r2(newPay - l.monthlyPayment);
  l.monthlyPayment = newPay;
  return d;
};
// 信用額度：無擔保負債不得超過月收入的 dbrMultiple 倍（台灣 DBR 22 倍規範）
E.creditCapacity = function(S, p){
  var unsecured = 0;
  p.liabilities.forEach(function(l){ if(l.kind==="CONSUMER"||l.kind==="CREDIT") unsecured += l.principal; });
  var dbr = E.cfg(S,"dbr_"+(p.creditRating||"B"));
  if(dbr===undefined) dbr = E.cfg(S,"dbrMultiple");
  if(dbr===undefined) dbr=22;
  var cap = p.derived.salaryIncome * dbr - unsecured;
  return util.r2(Math.max(0, cap));
};

/* --- 建局 --- */
E.newGame = function(opts){
  var C = ns.content, S = {
    schemaVersion:1, engineVersion:E.VERSION, seed:opts.seed>>>0, rngState:opts.seed>>>0,
    auxRngState:(opts.seed^0x5F3759DF)>>>0,
    config: opts.config, enabledModules: opts.modules.slice(),
    turnNumber:1, phase:"ROLL", activePlayerIdx:0, players:[], macro:null,
    decks:{}, activeGlobalEvents:[], eventSeq:0, actionLog:[], decisionQueue:[],
    pendingDecision:null, winner:null, uidSeq:0, log:[], bookkeeping:null, pendingTrade:null, pendingP2P:null, pendingAuction:null, pendingReferral:null, pendingJV:null, pendingShock:null,
    stockPrices:{}, dividendBonus:{}, spaceMult:{}, tapestrySample:[], over:false
  };
  S.macro = { stage:"RECOVERY", baseRate:S.config.rate_RECOVERY, targetRate:S.config.rate_RECOVERY,
              inflation:S.config.infl_RECOVERY, sinceReview:0,
              liquidity:S.config.liq_RECOVERY, turnsInStage:0 };
  E.buildBoards(S);      // S14b：依 fixedPayday 決定本局盤面（存進 S，重放與存檔都跟著走）
  // S10：開盤價不再固定等於面額。原本每局都從 face 開始，玩家玩久了就知道
  // 「面額」在哪，也就等於知道地板在哪（clampPrice 的上下限都是以 face 計），
  // 於是「跌到 −90% 應該離底部不遠」變成可以背的規律。改成每局在面額上下隨機開盤。
  // spread=0 時完全不取用亂數 → 與基線逐位元一致（鐵律二）。
  var openSpread=E.cfg(S,"stockOpenSpread"); if(!isFinite(openSpread)||openSpread<0) openSpread=0;
  C.stockDefs.forEach(function(s){
    var px=s.face;
    if(openSpread>0){
      var f=1 + (util.rand(S)*2-1)*openSpread;
      px=E.clampPrice(S, s, s.face*f);
    }
    S.stockPrices[s.symbol]=px;
  });
  S.stockHistory={}; C.stockDefs.forEach(function(s){ S.stockHistory[s.symbol]=[S.stockPrices[s.symbol]]; });
  S.delistWatch={}; S.delisted={};   // S7b：下市警示與已下市名單（重放會重建，但必須先初始化）
  // 每局隨機化股票顯示名（保留類型後綴），破除玩家記名規律；用種子決定、可重放
  var NAMEPOOL={
    STK_TECH:["晶宇","翔昱","宏鏵","凌通創","鈺群","博晟","泰擎","昇陽微"],
    STK_DIV:["台興","中鼎民生","華欣","國樺","富穩","力鴻","誠信","日盛豐"],
    STK_ETF:["寶島大盤","台灣精選","福爾摩沙","全市場","高股息旗艦","中型100"],
    STK_SPEC:["星火","飆雲","逐日","躍馬","狂潮","閃燄","黑天鵝"]
  };
  var SUFFIX={STK_TECH:"科技（成長股）",STK_DIV:"電信（高股息）",STK_ETF:" ETF",STK_SPEC:"小型股（投機）"};
  S.stockNames={};
  C.stockDefs.forEach(function(s, i){
    var pool=NAMEPOOL[s.symbol]||[s.name.replace(/（.*）| ETF/,"")];
    var h=(S.seed>>>0);
    for(var k=0;k<s.symbol.length;k++) h=(h*31 + s.symbol.charCodeAt(k))>>>0;
    h=(h ^ (h>>>13))>>>0; h=(h*1274126177)>>>0; h=(h ^ (h>>>16))>>>0;
    var base=pool[h % pool.length];
    S.stockNames[s.symbol]=base+(SUFFIX[s.symbol]||"");
  });

  opts.players.forEach(function(pd,idx){ S.players.push(E.makePlayer(S, idx, pd)); });
  E.buildDecks(S);
  // S24：抽出本局每個夢想的里程碑路線。池子剛好 dreamCost 條時不取用亂數（相容鐵律）。
  if(E.rollDreamRoutes) E.rollDreamRoutes(S);
  ns.modules.onGameSetup(S);
  return S;
};

E.makePlayer = function(S, idx, pd){
  var prof = ns.content.professionById[pd.professionId];
  var p = { id:idx, name:pd.name, isNPC:!!pd.isNPC, npcPersonality:pd.personality||null,
    professionId:prof.id, retiredProfessionId:null, position:0, cash:0, ledger:[],
    assets:[], liabilities:[], derived:{}, childrenCount:0, bankrupt:false,
    financiallyFree:false, freeAtTurn:null, skippedTurns:0, skipReason:null,
    creditRating:"B", creditFlags:{usedRescue:false, everBankrupt:false, cashWentNegative:false},
    blessingHWM:0, flags:{},
    // S11：記帳熟練度——每個象限各自累積「連續答對」，達門檻就解鎖該類別的自動記帳開關。
    // bkStreak 會因答錯歸零，bkUnlocked 一旦解鎖就永久保留（學會了就是學會了）；
    // bkAuto 是玩家自己開的，預設全部關著——解鎖不等於自動開啟。
    // S35：bkAutoOnMastery=1（預設）時練熟的當下就切成自動；面板仍可關回手記。
    // S13：熟練度的單位從「四個象限」改成「六套交易類型」。
    // 理由：玩家練的其實不是「認得資產這個字」，而是「現金買資產這件事整組怎麼記」。
    // 一套要整筆分錄全部答對才算一次，連續達標才激活——半套會的人不該拿到自動化。
    bkStreak:{}, bkUnlocked:{}, bkAuto:{}, bkEntryBad:{},
    // S11：定期定額與股息再投入（只有真人會設定；carry 是「還沒湊滿一張的預算」，不是真的現金）
    dcaPlans:[], divReinvest:{},
    baseSalary:0, salaryVolatility:prof.salaryVolatility||0,
    playerStage:"INNER", dreamCardId:pd.dreamCardId||null, dreamProgress:0, outerPos:0,
    dreamLog:[],                 // S31：夢想相簿——每一點是第幾輪拿到的、那句話、那張圖
    graduatedAtTurn:null, freefallWarnings:0, dreamBuyCount:0, boughtProgressThisTurn:false, atDreamSite:false,
    virtues:{TEMPER:0,PRUDENCE:0,PARENTING:0,FILIAL:0}, virtueSpendTotal:0, virtueSavedTotal:0,
    professionEventDone:{}, stats:{ bkRight:0, bkWrong:0, passedOpps:0, optionalSeen:0,
      optionalBought:0, maxLeverage:0, auditPass:0, auditFail:0, paydays:0, freeProgress:0, paidProgress:0,
      mallJoy:0, mallCount:0, referrals:0, referralFees:0,
      // M8 S1：學習與準備
      skillsLearned:0, skillsUsed:0, skillsAbandoned:0, skillsDecayed:0,
      skillMissed:0, skillSpendTotal:0, skillSavedTotal:0, skillJoy:0,
      // S5 數位資產（徽章要讀，必須先初始化，否則重放時 undefined 會混進判定）
      digitalStarted:0, digitalTakeoff:0, digitalDead:0,
      digitalFLOP:0, digitalOK:0, digitalHIT:0,
      // S4
      careerSwitched:0, sideJobs:0, propClaimTotal:0, lifeDeferred:0, freefalls:0 },
    mallBought:{}, mallLastBuy:{}, mallBoughtThisTurn:0, contestWon:{},   // S38：拿過獎金的比賽
    // M8 S1：技能狀態（必須在此初始化，否則 actionLog 重放時 undefined 會炸）
    skills:{}, learning:null, digitalAssets:[], tending:null, skillCooldownUntil:0,
    deferredLifeId:null, sideJob:null, pendingDelistWarn:null,
    // 重放種子：開局職業。轉職會改寫 professionId，存檔若存當下值，重放會從第一輪就歪掉。
    initialProfessionId: prof.id,
    history:[] };

  var cm = S.config.startingCashMult, sm = S.config.salaryMult, em = S.config.expenseMult;
  var salary = util.r2(prof.salary*sm), expenses = util.r2(prof.baseExpenses*em);
  p.baseSalary = salary;
  var post = [ {account:"CASH", delta:util.r2(prof.startingCash*cm), label:"起始現金"},
               {account:"INCOME_ACTIVE", delta:salary, label:"薪資"},
               {account:"EXPENSE", delta:expenses, label:"生活支出"} ];
  (prof.startingLiabilities||[]).forEach(function(l){
    var id = util.uid(S,"L");
    var rate = l.isFloating ? (S.macro.baseRate + (l.rateSpread||S.config.mortgageSpread)) : l.annualRate;
    var isStu = E.isStudentLoan(l.name);
    var term = E.loanTerm(S, l.kind, isStu);
    var pay = term>0 ? E.pmt(l.principal, rate, term) : util.r2(l.principal*rate/12);
    // 九期：開局負債也走浮動（含就學貸款＝機動利率），並記錄原始金額／起始輪／已還期數
    var floatDef = (S.config.floatingByDefault===undefined) ? 1 : S.config.floatingByDefault;
    var lo = { instanceId:id, kind:l.kind, name:l.name, principal:l.principal,
      annualRate:rate, isFloating: floatDef ? true : !!l.isFloating,
      rateSpread: (l.rateSpread!==undefined ? l.rateSpread : S.config.mortgageSpread),
      termMonths:term, monthlyPayment:pay, collateralAssetId:null, flags:{},
      originalPrincipal:l.principal, startTurn:0, periodsPaid:0 };
    if(isStu){ lo.studentLoan=true; lo.graceUntilTurn=(S.config.studentGraceTurns===undefined?24:S.config.studentGraceTurns);
      lo.amortStarted=false; lo.monthlyPayment=0; pay=0; } // 寬限期不還
    p.liabilities.push(lo);
    post.push({account:"LIABILITY", delta:l.principal, refId:id, label:l.name});
    post.push({account:"EXPENSE", delta:pay, refId:id, label:l.name+(pay>0?(term>0?" 月付":"利息"):" 寬限期")});
  });
  (prof.startingAssets||[]).forEach(function(a){
    var id = util.uid(S,"A");
    p.assets.push({ instanceId:id, cardId:a.cardId, kind:a.kind, name:a.name, units:1,
      costBasis:a.costBasis, marketValue:a.marketValue, monthlyIncome:a.monthlyIncome||0,
      equityPct:a.equityPct, postMoney:a.postMoney, linkedLiabilityId:null, flags:a.flags||{} });
    post.push({account:"ASSET", delta:a.marketValue, refId:id, label:a.name});
  });
  p.ledger.push({ entryId:util.uid(S,"e"), turnNumber:0, playerId:idx, sourceAction:-1,
    summary:"開局："+prof.name, postings:post, eduTags:["setup"], detail:null, kind:"SETUP" });
  ledger.recompute(p);
  return p;
};

/* --- 牌堆 --- */
// 特殊機會的入場資格：有海外留學或 EMBA 帶來的人脈（不是有錢就進得去）
E.hasNetwork = function(S, p){
  if(!E.cfg(S,"specialOppEnabled")) return false;
  return !!(p && p.flags && p.flags.network);
};

E.buildDecks = function(S){
  var C = ns.content, mods = S.enabledModules;
  function ok(c){ return !c.moduleReq || mods.indexOf(c.moduleReq)>=0; }
  // M8 鐵律二:skillPerGame=0 必須把整個學習系統關到「與基線逐位元一致」,
  // 所以 M8 內容(含 S3 的干擾卡/內訓卡/產業變革卡)一律先過這道閘。
  var nSk0 = E.cfg(S,"skillPerGame"); if(nSk0===undefined) nSk0 = 12;
  var m8on = mods.indexOf("M8")>=0 && nSk0>0;
  var deckList = ["OPPORTUNITY_SMALL","OPPORTUNITY_LARGE","LIFESTYLE","MARKET","LIFE_EVENT","OUTER_LIFE"];
  if(E.cfg(S,"specialOppEnabled")) deckList.splice(2,0,"OPPORTUNITY_SPECIAL");
  deckList.forEach(function(d){
    var pool = (C.cards[d]||[]).filter(ok);
    if(!m8on) pool = pool.filter(function(c){ return c.moduleReq!=="M8"; });
    // S15c：中階大買賣整批可關。實測顯示原本的大買賣門檻 960–5200，而內圈玩家現金中位
    // 只有 287——付得起最便宜那張的時點只有 12.9%，等於「大買賣」這一層形同虛設。
    // 這批卡把門檻補在 600–1200，設計上是「一個人吃力、湊起來就吃得下」。
    // 留開關是為了證明「除了多這幾張卡以外，引擎一個位元都沒動」（鐵律二的回歸網）。
    if(!E.cfg(S,"midTierOpps")) pool = pool.filter(function(c){ return !c.tierS15c; });
    // S9：健身房原本有四個入口（誘惑 LS02／商城 ML_HEA1／M6 兩張日常），
    // 其中誘惑版花更多錢（8＋每月3×24≈80）卻只給幸福感 +1，商城版（12＋每月3）
    // 反而多給幸福感 +2 與 fit 旗標（醫療意外 −30%）——嚴格劣化又同名，玩家會誤以為是同一件事。
    // 這裡把誘惑版拿掉，只留商城一個入口。留一個開關可以還原，
    // 是為了證明「除了少這張卡以外，引擎一個位元都沒動」（鐵律二的回歸網）。
    if(d==="LIFESTYLE" && !E.cfg(S,"lifestyleGymCard"))
      pool = pool.filter(function(c){ return c.id!=="LS02"; });
    // M8:SKILL_GATE 一律不走基礎 pool,只能經下方 M8 區塊抽樣進場
    // (否則會重複進牌堆,且 skillPerGame=0 關不掉)
    if(d==="LIFE_EVENT") pool = pool.filter(function(c){ return c.kind!=="SKILL_GATE"; });
    if(d==="LIFE_EVENT"){
      // 自我投資卡每局只抽樣少量，其餘全留；避免稀釋品格卡
      var si = pool.filter(function(c){ return c.kind==="SELF_INVEST"; });
      var rest = pool.filter(function(c){ return c.kind!=="SELF_INVEST"; });
      var n = S.config.selfInvestPerGame!==undefined ? S.config.selfInvestPerGame : 5;
      si = util.shuffle(S, si).slice(0, n);
      pool = rest.concat(si);
    }
    S.decks[d] = { draw: util.shuffle(S,pool.map(function(c){return c.id;})), discard: [] };
  });
  // 職業專屬事件注入 LIFE_EVENT
  var inject = [];
  S.players.forEach(function(p){
    var prof = ns.content.professionById[p.professionId];
    (prof.professionEvents||[]).forEach(function(eid){
      for(var k=0;k<S.config.professionEventCopies;k++) inject.push(eid);
    });
  });
  // M6：人生百態抽樣（修養卡保證排在同軸考驗卡之前）
  if(mods.indexOf("M6")>=0){
    var tap = (C.cards.LIFE_TAPESTRY||[]);
    var byKind = function(k){ return tap.filter(function(c){ return c.subKind===k; }); };
    var cult = util.shuffle(S,byKind("CULTIVATE")).slice(0,S.config.tapestryCultivatePerGame);
    var tri  = util.shuffle(S,byKind("TRIAL")).slice(0,S.config.tapestryTrialPerGame);
    var dly  = util.shuffle(S,byKind("DAILY")).slice(0,S.config.tapestryDailyPerGame);
    S.tapestrySample = cult.concat(tri).concat(dly).map(function(c){return c.id;});
    var le = S.decks.LIFE_EVENT.draw.concat(cult.map(function(c){return c.id;}),
                                            tri.map(function(c){return c.id;}), inject);
    le = util.shuffle(S,le);
    if(S.config.trialFrontloadGuard){
      ["TEMPER","PRUDENCE","PARENTING","FILIAL"].forEach(function(ax){
        var iC=-1,iT=-1;
        for(var i=0;i<le.length;i++){ var c=ns.content.byId[le[i]]; if(!c||c.kind!=="TAPESTRY") continue;
          if(c.virtueAxis!==ax) continue;
          if(iC<0 && c.subKind==="CULTIVATE") iC=i;
          if(iT<0 && c.subKind==="TRIAL") iT=i; }
        if(iC>=0 && iT>=0 && iT<iC){ var t=le[iT]; le[iT]=le[iC]; le[iC]=t; }
      });
    }
    S.decks.LIFE_EVENT.draw = le;
    S.decks.LIFESTYLE.draw = util.shuffle(S, S.decks.LIFESTYLE.draw.concat(dly.map(function(c){return c.id;})));
  } else if(inject.length){
    S.decks.LIFE_EVENT.draw = util.shuffle(S, S.decks.LIFE_EVENT.draw.concat(inject));
  }
  // M8：技能卡與技能情境卡抽樣（與 M6 同模式）。位置固定，不可依模組啟用順序而變。
  S.skillSample = []; S.digitalSample = [];
  if(mods.indexOf("M8")>=0){
    var nSkill = E.cfg(S,"skillPerGame"); if(nSkill===undefined) nSkill = 12;
    if(nSkill > 0){
      var poolSk = (C.cards.SKILL||[]).filter(ok);
      S.skillSample = util.shuffle(S, poolSk).slice(0, nSkill).map(function(c){ return c.id; });
      // S22：階梯技能——抽到高階卡就把它的先修一起帶進本局，否則那張高階永遠學不到。
      // 只補進（不替換），排序固定，不多消耗亂數。
      S.skillSample.slice().forEach(function(sid){
        var sc = ns.content.byId[sid];
        if(sc && sc.requiresSkill && S.skillSample.indexOf(sc.requiresSkill)<0 && ns.content.byId[sc.requiresSkill])
          S.skillSample.push(sc.requiresSkill);
      });
      var nGate = E.cfg(S,"skillGatePerGame"); if(nGate===undefined) nGate = 8;
      // 公平性:只抽「對應技能本局有進場」的情境——玩家至少要有機會準備，
      // 錯失才是他的選擇，而不是牌堆沒給他機會。
      var famIn = {};
      S.skillSample.forEach(function(sid){
        var sc = ns.content.byId[sid]; if(sc && sc.family) famIn[sc.family] = 1; });
      var inSample = {};
      S.skillSample.forEach(function(sid){ inSample[sid] = 1; });
      var gates = util.shuffle(S, (C.cards.LIFE_EVENT||[])
                    .filter(function(c){
                      if(c.kind!=="SKILL_GATE" || !ok(c)) return false;
                      var rq = (c.skillBranch && c.skillBranch.requires) || "";
                      return rq.indexOf("family:")===0 ? !!famIn[rq.slice(7)] : !!inSample[rq];
                    })
                    .map(function(c){ return c.id; })).slice(0, nGate);
      // S5：數位資產卡也洗進人生事件牌堆
      // S9：不再依技能過濾——人人可做，技能只影響爬坡輪數與起飛分佈
      var digs = [];
      var nDig = E.cfg(S,"digitalPerGame"); if(nDig===undefined) nDig = 4;
      if(nDig > 0){
        digs = util.shuffle(S, (C.cards.DIGITAL||[]).filter(ok))
                 .slice(0, nDig).map(function(c){ return c.id; });
        S.digitalSample = digs;
      } else { S.digitalSample = []; }
      /* S37：技能卡不再洗進人生牌堆（skillCardsInLifeDeck=0，預設）。
         S32 技能全開之後，這 18 張跟進修商城重複（差別只有七折學費），留在牌堆裡只剩稀釋作用——
         95 張裡占 19%，把數位資產（6 張）壓到 6%。拿掉之後牌堆 77 張。
         skillSample 本身留著（商城與 SKILL_GATE 抽樣都靠它）；翻轉人生卡（SELF_INVEST）仍在牌堆，
         那才是「公司送訓七折」的正當路徑。=1 回到 S36 以前的行為。 */
      var skInDeck = E.cfg(S,"skillCardsInLifeDeck"); if(skInDeck===undefined) skInDeck = 0;
      S.decks.LIFE_EVENT.draw = util.shuffle(S,
        S.decks.LIFE_EVENT.draw.concat(skInDeck ? S.skillSample : [], gates, digs));
    }
  }
  if(mods.indexOf("M4")>=0){
    // 鐵律三:MACRO_EVENT 過去沒過 ok() 濾網(當時沒有帶 moduleReq 的總經卡);
    // S3 起有 M8 專屬的產業變革卡,這裡必須一起把關,否則關閉開關會失效。
    var me = (C.cards.MACRO_EVENT||[]).filter(ok)
               .filter(function(c){ return m8on || c.moduleReq!=="M8"; });
    S.decks.MACRO_EVENT = { draw: util.shuffle(S, me.map(function(c){return c.id;})), discard: [] };
  }
};

E.drawCard = function(S, deckId, filterFn){
  var d = S.decks[deckId]; if(!d) return null;
  for(var guard=0; guard<200; guard++){
    if(!d.draw.length){ if(!d.discard.length) return null;
      d.draw = util.shuffle(S, d.discard); d.discard = []; }
    var id = d.draw.shift(); var card = ns.content.byId[id];
    if(!card){ continue; }
    if(filterFn && !filterFn(card)){ d.discard.push(id); continue; }
    d.discard.push(id); return card;
  }
  return null;
};

// §2.3 機會二選一：抽 2 張（同一牌堆）；牌堆不足時退化為單張
// 兩張都用主流 RNG 連抽；未選的那張已在棄牌堆（drawCard 抽出即入棄牌堆）
E.drawTwo = function(S, deckId, filterFn){
  var c1 = E.drawCard(S, deckId, filterFn);
  if(!c1) return [];
  var d = S.decks[deckId];
  var i1 = d.discard.lastIndexOf(c1.id);
  if(i1>=0) d.discard.splice(i1,1);          // 暫時取出，避免重洗時抽到同一張
  var c2 = E.drawCard(S, deckId, filterFn);
  d.discard.push(c1.id);                      // 第一張放回棄牌堆
  return (c2 && c2.id!==c1.id) ? [c1,c2] : [c1];
};
// 機會卡的「可比較」數據：入手現金、該筆資金下的實際月現金流、年化現金報酬率
// 註：E.oppIncome / E.oppEntry 只涵蓋 REALESTATE / BUSINESS（第二期拍賣估值沿用，不動），
//     二選一要能比較股票與新創，故另立此函式；REALESTATE 以預設貸款成數計，扣掉房貸月付才是真現金流。
E.oppCompare = function(S, card, viewer){
  var pl=card.payload||{}, im=S.config.assetIncomeMult;
  var entry=0, income=0, note="";
  if(card.kind==="REALESTATE"){
    var ltv = E.canUseLoan(S) ? Math.min(1-(pl.downPayment||0)/(pl.price||1), E.effMaxLTV(S,card)) : 0;
    if(!(ltv>0)) ltv=0;
    var loan=util.r2((pl.price||0)*ltv);
    entry=util.r2((pl.price||0)-loan);
    var rate=E.rRate(S.macro.baseRate+E.cfg(S,"mortgageSpread"));
    var pay=loan>0 ? E.pmt(loan, rate, E.loanTerm(S,"MORTGAGE",false)) : 0;
    income=util.r2((pl.monthlyRent||0)*im-(pl.monthlyCost||0)-pay);
    note = loan>0 ? ("含房貸 "+util.pct(ltv,0)+"成、月付已扣") : "全額現金";
  } else if(card.kind==="BUSINESS"){
    entry=util.r2(pl.price||0);
    income=util.r2((pl.monthlyProfit||0)*E.incomeMultFor(S,"BUSINESS"));
    note="全額現金（景氣係數會影響分紅）";
  } else if(card.kind==="STOCK"){
    var def=ns.content.stockBySymbol[pl.symbol];
    entry=util.r2(E.isDelisted(S,pl.symbol) ? 0 : (E.stockPrice(S,pl.symbol)||pl.offerPrice||0));
    /* S23a：原本寫 entry×月配息率（拿現價當面額用），與引擎實際入帳的數字對不上——
       實際入帳走的是「面額 × 配息率」。改走與買進、每輪重算同一個入口。
       這個修正掛在 stockDivRestock 開關後面：關掉＝連同這個既有缺陷一起回到 S22，
       否則「開關全關要能重現基線」這條會斷（NPC 的二選一會讀 oppCompare）。 */
    var drOn = E.cfg(S,"stockDivRestock"); if(drOn===undefined) drOn = 1;
    income = def ? (drOn ? util.r2(E.stockDivPerUnit(S,def)) : util.r2(entry*def.dividendYieldMonthly)) : 0;
    note = (def && def.dividendYieldMonthly>0) ? "以 1 張計；主要靠價差" : "不配息，靠價差";
  } else if(card.kind==="STARTUP"){
    entry=util.r2(pl.investAmount||0);
    income=0;
    note="無月現金流，賭退出價差";
  }
  var yr = entry>0 ? income*12/entry : 0;
  var out = { entry:entry, income:income, yield:yr, note:note, disclosed:false };
  // M8 S3：記帳與看財報——帳面數字之外還有空租、修繕與獲利波動。
  // 有技能的人（含 NPC）看得到風險調整後的數字；沒技能的人只看得到毛數字。
  // 註：income/yield 本身刻意不動，才不會讓沒技能的人也被動享受到這份資訊。
  if(viewer && E.hasSkill && E.hasSkill(viewer,"SKL_BOOK")){
    var drag = 0, risks = [];
    if(card.kind==="REALESTATE"){
      var stg = S.macro ? S.macro.stage : "RECOVERY";
      var vcD = E.cfg(S,"vacancyChance_"+stg); if(vcD===undefined) vcD = 0;
      var rcD = E.cfg(S,"repairChancePerPayday"); if(rcD===undefined) rcD = 0;
      var rmn = E.cfg(S,"repairCostMonthsMin"), rmx = E.cfg(S,"repairCostMonthsMax");
      if(rmn===undefined) rmn = 1; if(rmx===undefined) rmx = 3;
      var vmn = E.cfg(S,"vacancyTurnsMin"), vmx = E.cfg(S,"vacancyTurnsMax");
      if(vmn===undefined) vmn = 1; if(vmx===undefined) vmx = 2;
      var rentB = util.r2((pl.monthlyRent||0)*im);
      var expRepair = util.r2(rcD * rentB * (rmn+rmx)/2);
      var expVac    = util.r2(vcD * rentB * (vmn+vmx)/2);
      drag = util.r2(expRepair + expVac);
      if(expRepair>0) risks.push("修繕期望每月 −"+expRepair);
      if(expVac>0) risks.push("空租期望每月 −"+expVac);
    }
    if(pl.volatileProfit) risks.push("分紅會隨景氣大幅波動，這個數字不是保證");
    if(card.kind==="STARTUP") risks.push("沒有月現金流，全押在退出價差上");
    out.disclosed = true;
    out.riskDrag  = drag;
    out.netIncome = util.r2(income - drag);
    out.netYield  = entry>0 ? out.netIncome*12/entry : 0;
    out.riskNote  = risks.join("；");
  }
  return out;
};
E.oppYield = function(S, card){ return E.oppCompare(S,card).yield; };

/* ================= §2.4 幸福感盲盒（幸福感搬進引擎，可重放） ================ */
// 幸福感＝家庭×3 ＋ 品格總和 ＋ 圓夢進度 ＋ 生活享受次數（純函式，UI 呼叫此版）
E.wellbeing = function(S, p){
  var v=0;
  v += (p.childrenCount||0)*3;
  if(p.virtues){ for(var k in p.virtues) v += p.virtues[k]; }
  v += (p.dreamProgress||0);
  v += ((p.stats && p.stats.optionalBought)||0);
  v += ((p.stats && p.stats.mallJoy)||0);          // V10：商城的正向活動
  v += ((p.stats && p.stats.skillJoy)||0);         // M8 S2：技能帶來的正向經驗
  return v;
};

// V10：健康狀態（健身房年約／高階健檢）在有效期內折抵醫療意外支出
E.healthDiscount = function(S, p){
  if(!p.flags) return 0;
  var t=S.turnNumber, on=false;
  if(p.flags.fitUntil!==undefined && t<=p.flags.fitUntil) on=true;
  if(p.flags.checkedUntil!==undefined && t<=p.flags.checkedUntil) on=true;
  if(!on) return 0;
  var d=E.cfg(S,"healthDiscountPct"); if(d===undefined) d=0.3;
  return d;
};
/* S26：法律知識（法律常識／公司法規與合規治理）——意外賠償類支出懂得談判與求償，
   實際損失比較小。與健康折抵同一個形狀：查得到技能就回折抵比例，查不到回 0。 */
E.legalDiscount = function(S, p){
  if(!E.hasSkill) return 0;
  if(!(E.hasSkill(p,"SKL_LAW") || E.hasSkill(p,"SKL_GOV_LEGAL"))) return 0;
  var d=E.cfg(S,"legalSkillDiscountPct"); if(d===undefined) d=0.5;
  return d;
};
/* S26：決策選項的「這次要付多少」。
   costSalaryMult 依當下月薪計價（與人生商城 E.mallCost 同語意、同回退規則）；
   沒有薪水的人（自由圈／失業）回退到寫死的 cost，才不會「沒收入反而付最貴」。 */
E.optionCost = function(S, p, op){
  if(!op) return 0;
  if(op.costSalaryMult && p && p.derived && p.derived.salaryIncome > 0)
    return util.r2(p.derived.salaryIncome * op.costSalaryMult);
  return op.cost || 0;
};
/* S26：選項層級的先修技能鎖。
   只在「這一局真的學得到那張技能」時才鎖——技能卡若掛在沒啟用的模組底下（例如 SKL_BOOK 需要 M8），
   照鎖會讓那個選項永遠選不了，整張卡變成只剩「暫時不」的廢卡。 */
E.optionLocked = function(S, p, op){
  var need = op && op.requiresSkill;
  if(!need) return false;
  var sk = (ns.content && ns.content.byId) ? ns.content.byId[need] : null;
  if(sk && sk.moduleReq && (S.enabledModules||[]).indexOf(sk.moduleReq) < 0) return false;
  return !(E.hasSkill && E.hasSkill(p, need));
};
/* S26：效果金額也能依月薪計價（salaryMult，負數＝省下來的錢）。
   規則與 optionCost 一致：沒有薪水就回退到寫死的 amount。 */
E.effAmount = function(t, ef){
  if(ef.salaryMult && t && t.derived && t.derived.salaryIncome > 0)
    return util.r2(t.derived.salaryIncome * ef.salaryMult);
  return ef.amount;
};
/* S27：機率型決策選項。
   命名沿用人生商城既有的 chance / onWin / onLose（那組原本只有 MALL_BUY 走得到），
   讓卡片作者不必學第二套語彙。亂數一律走 util.rand(S)：種子化、可重放（鐵律 1）。
   語意：chance 是「onWin 發生的機率」；選項本身的 effects 先結算（押注／借出去的錢），
   再依擲骰結果套用 onWin 或 onLose 的 effects。 */
E.resolveOptionOutcome = function(S, p, op, label){
  if(!op || op.chance===undefined) return null;
  var win = util.rand(S) < op.chance;
  var br = win ? op.onWin : op.onLose;
  var res = { win:win, chance:op.chance,
              label:(br && br.label) || (win ? "結果：成了" : "結果：沒成"),
              narrative:(br && br.narrative) || "" };
  if(br && br.effects && br.effects.length) E.applyEffects(S,p,br.effects,label);
  E.ev("OPTION_GAMBLE",{playerId:p.id, title:label, win:win, chance:op.chance,
                        label:res.label, narrative:res.narrative});
  return res;
};
// 加權抽獎（主流 RNG；累積機率第一個命中即 break——工程書 §1.9-5）
E.blessingPool = function(S){
  return [
    {key:"VIRTUE",   w:E.cfg(S,"blessingW_VIRTUE")},
    {key:"DREAM",    w:E.cfg(S,"blessingW_DREAM")},
    {key:"GUARDIAN", w:E.cfg(S,"blessingW_GUARDIAN")},
    {key:"JOY",      w:E.cfg(S,"blessingW_JOY")},
    {key:"CASH",     w:E.cfg(S,"blessingW_CASH")}
  ].filter(function(x){ return x.w>0; });
};
// 抽一次並立即結算效果，回傳 {prize, detail}
E.drawBlessing = function(S, p){
  var pool=E.blessingPool(S), tot=0;
  pool.forEach(function(x){ tot+=x.w; });
  if(tot<=0) return {prize:"NONE", detail:"獎池為空"};
  var r=util.rand(S)*tot, acc=0, key=pool[pool.length-1].key;
  for(var i=0;i<pool.length;i++){ acc+=pool[i].w; if(r<acc){ key=pool[i].key; break; } }
  var detail="";
  if(key==="VIRTUE"){
    var cap=E.cfg(S,"virtueMaxLevel"); if(cap===undefined) cap=3;
    var axes=["TEMPER","PRUDENCE","PARENTING","FILIAL"].filter(function(a){ return (p.virtues[a]||0)<cap; });
    if(axes.length){
      var ax=axes[Math.floor(util.rand(S)*axes.length)];
      p.virtues[ax]=(p.virtues[ax]||0)+1;
      detail=ax; E.ev("VIRTUE_UP",{playerId:p.id, axis:ax, level:p.virtues[ax]});
    } else { key="JOY"; }                                  // 品格已滿 → 退為小確幸
  }
  if(key==="DREAM"){
    p.dreamProgress=(p.dreamProgress||0)+1;
    detail="夢想進度 +1（現為 "+p.dreamProgress+"）";
    /* S37 修錯（Brian 實測：5／5 圓夢但相簿第五張沒蓋章）：
       盲盒的「圓夢靈感」是第三條拿進度的路，S31 做相簿時只接了踩聖地與購點兩條，
       這裡一直沒寫 dreamLog，也沒發 DREAM_PROGRESS——所以相簿少一張、全服公告也沒播。
       補上同一套：寫相簿（paid=false）、發事件；圓夢判定交給呼叫端既有的 checkDreamWin／recheckDreamWin。 */
    if(E.logDreamPoint) E.logDreamPoint(S,p,p.dreamProgress,false,"blessing");
    E.ev("DREAM_PROGRESS",{playerId:p.id, progress:p.dreamProgress, paid:false, source:"blessing",
      milestone:E.dreamMilestone?E.dreamMilestone(S,p,p.dreamProgress):"",
      milestoneImg:E.dreamMilestoneImg?E.dreamMilestoneImg(S,p,p.dreamProgress):null});
  } else if(key==="GUARDIAN"){
    if(!p.flags) p.flags={};
    p.flags.guardian=true;
    detail="下一張負面人生事件費用減免 "+Math.round(E.cfg(S,"guardianDiscount")*100)+"%";
  } else if(key==="JOY"){
    p.stats.optionalBought=(p.stats.optionalBought||0)+2;   // 幸福感 +2，不佔支出
    if(!detail) detail="幸福感 +2，且不進支出表";
  } else if(key==="CASH"){
    var lo=E.cfg(S,"blessingCashMin"), hi=E.cfg(S,"blessingCashMax");
    if(lo===undefined) lo=50; if(hi===undefined) hi=150;
    var amt=E.randInt(S, lo, hi);
    ledger.post(S,p,"幸福感的回報：小額紅包",[{account:"CASH",delta:amt,label:"紅包"}],{eduTags:["blessing"]});
    detail=util.money(amt);
  }
  E.ev("BLESSING_DRAWN",{playerId:p.id, prize:key, detail:detail});
  return {prize:key, detail:detail};
};
// endTurn 前檢查：幸福感高水位每跨過 blessingStep 的倍數得一抽（HWM 只增不減）
E.checkBlessing = function(S, p){
  if(p.bankrupt) return false;
  var step=E.cfg(S,"blessingStep"); if(!(step>0)) return false;
  var wb=E.wellbeing(S,p), hwm=p.blessingHWM||0;
  if(wb<=hwm) return false;                                  // 沒創新高：不可能跨新檔位
  var cross = Math.floor(wb/step) > Math.floor(hwm/step);
  p.blessingHWM = wb;                                        // 高水位永遠只往上
  if(!cross) return false;
  var got=E.drawBlessing(S,p);
  E.pushDecision(S,p,{kind:"BLESSING", prize:got.prize, detail:got.detail, wellbeing:wb});
  return true;
};

/* --- 玩家可用性判定 --- */
E.canUseLoan = function(S){ return S.config.depthLevel>=2 && S.enabledModules.indexOf("M2")>=0; };
E.canUseAdvanced = function(S){ return S.config.depthLevel>=3; };
E.activePlayer = function(S){ return S.players[S.activePlayerIdx]; };
E.alive = function(S){ return S.players.filter(function(p){ return !p.bankrupt; }); };

/* --------------------------- 效果 DSL 執行器 ------------------------------ */
// S13.1 NEW-02：總體事件的效果正規化——玩家級的 op 沒標 target 一律視為 all。
E.MACRO_PLAYER_OPS = ["CASH_DELTA","ASSET_INCOME_MULT","ASSET_VALUE_MULT","ADD_RECURRING_EXPENSE",
                      "SKIP_TURNS","GRANT_JOY","GRANT_VIRTUE"];
E.macroEffects = function(card){
  return (card.effects||[]).map(function(ef){
    if(ef.target || E.MACRO_PLAYER_OPS.indexOf(ef.op)<0) return ef;
    var c={}; for(var k in ef) c[k]=ef[k]; c.target="all"; return c;
  });
};
E.applyEffects = function(S, p, effects, label, opts){
  if(!effects) return;
  opts = opts||{};
  var rate = S.config.eventCardRate;
  effects.forEach(function(ef){
    // S12：標了 since 的效果屬於某一次內容修正，該開關關掉時整條略過。
    // 這是為了讓「關掉全部開關＝回到基線」這條回歸網在改內容之後仍然成立。
    if(ef.since && E.cfg(S, ef.since)===0) return;
    var targets = ef.target==="all" ? E.alive(S)
                : ef.target==="others" ? E.alive(S).filter(function(x){return x.id!==p.id;})
                : [p];
    switch(ef.op){
      case "CASH_DELTA":
        targets.forEach(function(t){
          if(ef.filter && !t.assets.some(function(a){return a.kind===ef.filter.kind;})) return;
          var amt0 = E.effAmount(t, ef);                       // S26：salaryMult 依月薪計價，沒有就用寫死的 amount
          var amt = util.r2(amt0 * (amt0<0 ? rate : 1));
          /* S37（Brian：「減免一定要讓玩家有感」）：這一筆每一段折抵都記下來寫進分錄——
             原價、誰替你省了多少、沒準備的話本來可以省多少。分錄長什麼樣，每輪紀錄／彙總／訊息欄就長什麼樣。 */
          var relief = { gross:util.r2(-amt), saved:[], missed:[] };
          // §2.4 貴人相助：負面人生事件費用減免一次（觸發後清旗標）
          if(amt<0 && opts.lifeEvent && t.flags && t.flags.guardian){
            var disc=E.cfg(S,"guardianDiscount"); if(disc===undefined) disc=0.5;
            var saved=util.r2(-amt*disc);
            amt=util.r2(amt*(1-disc));
            t.flags.guardian=false;
            relief.saved.push({kind:"guardian", label:"貴人相助", amount:saved});
            E.ev("GUARDIAN_USED",{playerId:t.id, saved:saved, label:ef.label||label});
          }
          // V10：健康狀態（健身房／健檢）先折抵，再由醫療意外險理賠
          // V11.1：把每一段折抵記下來，讓事件卡可以列出「原價／折抵／理賠／實付／省下」
          var gross0=amt, hSaved=0, claim=0, wouldClaim=0;
          // 住宅火險：天災類現金損失理賠（卡片以 propertyClaim:true 標記，與醫療險互不重疊）
          if(amt<0 && ef.propertyClaim){
            var pcE = E.cfg(S,"propertyClaimPct"); if(pcE===undefined) pcE = 0.5;
            var claimP = util.r2(-amt*pcE);
            if(t.flags && t.flags.propInsured){
              if(claimP>0){
                amt = util.r2(amt+claimP);
                t.stats.propClaimTotal = util.r2((t.stats.propClaimTotal||0)+claimP);
                relief.saved.push({kind:"propertyClaim", label:"產險理賠", amount:claimP});
                E.ev("PROPERTY_CLAIM",{playerId:t.id, claim:claimP, where:"disaster", label:ef.label||label});
              }
            } else if(claimP>0){
              relief.missed.push({kind:"propertyClaim", label:"若有產險", amount:claimP});   // S37：沒保的人也要看到
            }
          }
          /* S26：法律知識折抵——賠償／和解類支出，懂法的人談得下來。
             掛在效果的 legalClaim 旗標上（不是整張卡），才不會連同一張卡的醫療費也一起打折。 */
          if(amt<0 && ef.legalClaim){
            var ld=E.legalDiscount(S,t);
            if(ld>0){
              var lSaved=util.r2(-amt*ld);
              if(lSaved>0){ amt=util.r2(amt+lSaved);
                relief.saved.push({kind:"legal", label:"懂法律", amount:lSaved});
                E.ev("LEGAL_DISCOUNT",{playerId:t.id, saved:lSaved, label:ef.label||label}); }
            } else {
              var ldDef=E.cfg(S,"legalSkillDiscountPct"); if(ldDef===undefined) ldDef=0.5;
              var lWould=util.r2(-amt*ldDef);
              if(lWould>0) relief.missed.push({kind:"legal", label:"若有法律常識", amount:lWould});
            }
          }
          /* S27：綜所稅的列舉扣除——寫法完全比照上面的 legalClaim。
             三個來源可疊加：會計／記帳技能（懂得列舉）、慈善捐款收據、保單保費。
             總折抵夾在 taxClaimMaxPct，避免疊到接近免稅。 */
          if(amt<0 && ef.taxClaim){
            var tr=0;
            if(E.hasSkill && (E.hasSkill(t,"SKL_BOOK")||E.hasSkill(t,"SKL_CPA_AUDIT"))){
              var tv=E.cfg(S,"taxSkillDiscountPct"); tr+=(tv===undefined?0.3:tv); }
            if(t.flags && t.flags.donor){
              var tdv=E.cfg(S,"taxDonorDiscountPct"); tr+=(tdv===undefined?0.1:tdv); }
            if(t.flags && t.flags.insured){
              var tiv=E.cfg(S,"taxInsuredDiscountPct"); tr+=(tiv===undefined?0.1:tiv); }
            var tmax=E.cfg(S,"taxClaimMaxPct"); if(tmax===undefined) tmax=0.5;
            if(tr>tmax) tr=tmax;
            if(tr>0){
              var tSaved=util.r2(-amt*tr);
              if(tSaved>0){ amt=util.r2(amt+tSaved);
                relief.saved.push({kind:"tax", label:"列舉扣除 "+Math.round(tr*100)+"%", amount:tSaved});
                E.ev("TAX_DEDUCTION",{playerId:t.id, saved:tSaved, pct:tr, label:ef.label||label}); }
            } else {
              var tvDef=E.cfg(S,"taxSkillDiscountPct"); if(tvDef===undefined) tvDef=0.3;
              var tWould=util.r2(-amt*tvDef);
              if(tWould>0) relief.missed.push({kind:"tax", label:"若懂記帳可列舉", amount:tWould});
            }
          }
          /* S26：醫療鏈只吃「不是產險那一筆」的效果。
             LE12／LE13 這種把修車與醫療合在一起的卡已拆成兩筆效果：
             修車那筆走 propertyClaim（產險＋法律），醫療那筆走這裡（健康＋醫療險），
             各折各的，不再對同一筆金額疊三層。 */
          if(amt<0 && opts.insurable && !ef.propertyClaim){
            var hd=E.healthDiscount(S,t);
            if(hd>0){ hSaved=util.r2(-amt*hd); amt=util.r2(amt*(1-hd));
              relief.saved.push({kind:"health", label:"平時有健身／健檢", amount:hSaved});
              E.ev("HEALTH_DISCOUNT",{playerId:t.id, saved:hSaved, label:ef.label||label}); }
            var cp=E.cfg(S,"insuranceClaimPct"); if(cp===undefined) cp=0.6;
            if(t.flags && t.flags.insured){
              claim=util.r2(-amt*cp);
              if(claim>0){ amt=util.r2(amt+claim);
                relief.saved.push({kind:"insurance", label:"醫療意外險理賠", amount:claim});
                E.ev("INSURANCE_CLAIM",{playerId:t.id, claim:claim, label:ef.label||label}); }
            } else {
              wouldClaim=util.r2(-amt*cp);      // 沒保險：記下「本來可以省下多少」當對照
              if(wouldClaim>0) relief.missed.push({kind:"insurance", label:"若有醫療意外險", amount:wouldClaim});
            }
            if(opts.claimOut) opts.claimOut.push({
              playerId:t.id, label:ef.label||label,
              gross:util.r2(-gross0), healthSaved:hSaved, claim:claim,
              net:util.r2(-amt), wouldClaim:wouldClaim,
              insured:!!(t.flags&&t.flags.insured), healthOn:E.healthDiscount(S,t)>0,
              claimPct:cp, healthPct:E.healthDiscount(S,t)
            });
          }
          relief.net=util.r2(-amt);
          var hasRelief = amt<0 && (relief.saved.length || relief.missed.length);
          if(hasRelief){
            var sv=0; relief.saved.forEach(function(x){ sv+=x.amount; }); relief.savedTotal=util.r2(sv);
            relief.label=ef.label||label;
            E.ev("RELIEF_SUMMARY",{playerId:t.id, label:ef.label||label, gross:relief.gross, net:relief.net,
                                    saved:relief.saved, missed:relief.missed, savedTotal:relief.savedTotal});
            if(opts.reliefOut) opts.reliefOut.push({ playerId:t.id, label:relief.label, gross:relief.gross, net:relief.net,
                                                     saved:relief.saved, missed:relief.missed, savedTotal:relief.savedTotal });
          }
          ledger.post(S,t, ef.label||label, [{account:"CASH",delta:amt,label:ef.label||label}],
            {eduTags:["event"], srcTitle:label, detail: hasRelief ? {relief:relief} : null});
        }); break;
      case "SKIP_TURNS":   // v0.2：重大傷病等事件的停走（通用 DSL op）
        // S13.1 §7：原本 switch 裡有兩個同名 case，第二個是死碼，於是寫 {"n":2} 的卡會被
        // 靜默降成停走 1 輪。這裡合併成一個，turns / n 兩種寫法都接受，並記下停走原因。
        targets.forEach(function(t){
          var nSkip = (ef.turns!==undefined ? ef.turns : (ef.n!==undefined ? ef.n : 1));
          t.skippedTurns += nSkip;
          t.skipReason = ef.label || label || "人生事件";
          E.ev("TURNS_SKIPPED",{playerId:t.id, turns:nSkip, label:t.skipReason}); });
        break;
      case "ADD_RECURRING_EXPENSE":
        targets.forEach(function(t){
          var amt = util.r2(E.effAmount(t, ef));               // S26：salaryMult 依月薪計價（負數＝每月省下）
          ledger.post(S,t, ef.label||label, [{account:"EXPENSE",delta:amt,label:ef.label||label}], {eduTags:["recurring"]});
          if(ef.durationTurns) S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"EXPENSE_REVERT",
            playerId:t.id, amount:amt, until:S.turnNumber+ef.durationTurns, label:ef.label||label, priority:0, param:null });
        }); break;
      /* S26：讓卡片效果也能點亮玩家旗標——原本只有「在人生商城買東西」做得到，
         所以「自我投資健康」點不亮健康折抵、「公司送你去念 MBA」也解鎖不了人脈。
         期限型（ef.turns）寫 flags[<flag>Until]，語意與商城的 flag/flagTurns 相同，
         但刻意不寫 <flag>Item：這不是年約，沒有月費、到期也不該跳續約詢問
         （到期迴圈查不到 Item 會自動略過，見 applyAction 的旗標到期處理）。 */
      case "SET_FLAG":
        targets.forEach(function(t){
          var fg = ef.flag; if(!fg) return;
          if(!t.flags) t.flags = {};
          if(ef.turns){
            var until = S.turnNumber + ef.turns;
            if(!(t.flags[fg+"Until"] >= until)) t.flags[fg+"Until"] = until;   // 只延長、不縮短既有效期
            t.flags[fg+"Asked"] = 0;
            E.ev("FLAG_SET",{playerId:t.id, flag:fg, until:t.flags[fg+"Until"], label:ef.label||label});
          } else {
            if(t.flags[fg]) return;                                            // 已經有了就不重複觸發
            t.flags[fg] = true;
            // 一律發 FLAG_SET（介面統一在這裡出提示）。商城購買那條路徑另有自己的
            // NETWORK_UNLOCKED 與 notes，不在這裡重發，避免同一件事跳兩次。
            E.ev("FLAG_SET",{playerId:t.id, flag:fg, title:label, label:ef.label||label});
          }
        }); break;
      /* S27：失業效果 op。實際邏輯在 E.triggerLayoff（原本寫死在棋盤格 LAYOFF 裡，
         這一版抽成函式，行為不變），所以卡片與棋盤格共用同一份敘事與同一組參數。 */
      case "LAYOFF":
        targets.forEach(function(t){
          if(E.triggerLayoff) E.triggerLayoff(S, t, { title:ef.title, note:ef.note });
        }); break;
      case "SALARY_MULT":
        targets.forEach(function(t){
          var delta = util.r2(t.derived.salaryIncome*(ef.factor-1)); if(!delta) return;
          t.baseSalary = util.r2(t.baseSalary*ef.factor);
          ledger.post(S,t, ef.label||label, [{account:"INCOME_ACTIVE",delta:delta,label:ef.label||label}], {eduTags:["career"]});
        }); break;
      case "ASSET_VALUE_MULT":
        targets.forEach(function(t){ t.assets.forEach(function(a){
          if(ef.filter && ef.filter.kind && a.kind!==ef.filter.kind) return;
          var nv = util.r2(a.marketValue*ef.factor), d = util.r2(nv-a.marketValue); if(!d) return;
          a.marketValue = nv;
          ledger.post(S,t, ef.label||label, [{account:"ASSET",delta:d,refId:a.instanceId,label:a.name+" 估值變動"}], {eduTags:["valuation"]});
        }); }); break;
      case "ASSET_INCOME_MULT":
        targets.forEach(function(t){ t.assets.forEach(function(a){
          if(ef.filter && ef.filter.kind && a.kind!==ef.filter.kind) return;
          var ni = util.r2(a.monthlyIncome*ef.factor), d = util.r2(ni-a.monthlyIncome); if(!d) return;
          a.monthlyIncome = ni;
          ledger.post(S,t, ef.label||label, [{account:"INCOME_PASSIVE",delta:d,refId:a.instanceId,label:a.name+" 收入變動"}], {eduTags:["cashflow"]});
          if(ef.durationTurns) S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"INCOME_REVERT",
            playerId:t.id, assetId:a.instanceId, amount:util.r2(-d), until:S.turnNumber+ef.durationTurns,
            label:ef.label||label, priority:0, param:null });
        }); }); break;
      case "OFFER_SELL_WINDOW":
        S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"SELL_WINDOW", filter:ef.filter,
          priceMult:ef.priceMult, until:S.turnNumber+2, label:ef.label||label, priority:0, param:null });
        break;
      case "SET_PARAM":
        S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"PARAM", param:ef.param, value:ef.value,
          until:S.turnNumber+(ef.durationTurns||4), label:ef.label||label, priority:ef.priority||0 });
        if(ef.param==="mortgageSpread"||ef.param==="maxLTV") E.repriceFloating(S);
        break;
      case "ADD_CHILD":
        targets.forEach(function(t){
          if(t.childrenCount >= S.config.childExpenseCap) return;
          t.childrenCount++;
          var c = util.r2(ns.content.professionById[t.professionId].perChildExpense*S.config.expenseMult);
          ledger.post(S,t,"養育支出增加",[{account:"EXPENSE",delta:c,label:"養育支出"}],{eduTags:["family"]});
        }); break;
      case "STOCK_PRICE_SET":
        if(S.stockPrices[ef.symbol]!==undefined){
          var def = ns.content.stockBySymbol[ef.symbol];
          S.stockPrices[ef.symbol] = E.clampPrice(S, def, S.stockPrices[ef.symbol]*ef.mult);
          E.revalueStocks(S);
        } break;
      /* S23c：交易所倒閉——放在交易所的幣歸零，冷錢包免疫。
         分錄與通知排隊全在 E.cryptoExchangeFail 裡；沒開迷因幣的局是 no-op。
         注意 STOCK_PRICE_SET 對 CRY_MEME 也照樣有效（監管禁令 ×0.5 走那條）。 */
      case "CRYPTO_EXCHANGE_FAIL":
        E.cryptoExchangeFail(S, ef.label||label); break;
      case "DIVIDEND_BONUS":
        S.dividendBonus[ef.symbol] = ef.mult;
        S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"DIV_BONUS", symbol:ef.symbol,
          until:S.turnNumber+1, label:ef.label||label, priority:0, param:null });
        break;
      case "SPACE_EFFECT_MULT":
        S.spaceMult[ef.spaceType] = ef.factor;
        S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"SPACE_MULT", spaceType:ef.spaceType,
          until:S.turnNumber+(ef.durationTurns||4), label:ef.label||label, priority:0, param:null });
        break;
      case "GRANT_JOY":     // M8 S2：技能帶來的正向人生經驗（計入幸福感）
        targets.forEach(function(t){
          t.stats.skillJoy = (t.stats.skillJoy||0) + (ef.amount||1);
        }); break;
      case "GRANT_VIRTUE":
        targets.forEach(function(t){
          var mx=S.config.virtueMaxLevel;
          var nv=(t.virtues[ef.axis]||0)+ef.delta;
          t.virtues[ef.axis]=Math.max(0, Math.min(mx, nv));
        }); break;
      case "GRANT_DECISION":
        E.pushDecision(S, p, { kind:ef.decisionKind, params:ef.params||{} }); break;
      // S22：延後引爆的效果——現在拿到好處、N 輪後帳單才來（人頭帳戶、借名貸款這類「定時炸彈」）。
      // 到期在 onRoundEnd 對該玩家套用 effects（一般 op 都可用），並記一個事件讓介面播報。
      case "DELAYED_EFFECTS":
        targets.forEach(function(t){
          S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"DELAYED_FX", playerId:t.id,
            effects:ef.effects||[], label:ef.label||label, until:S.turnNumber+(ef.turns||2),
            insurable:!!ef.insurable,          // S27：延後引爆的醫療類支出也吃得到健康折抵與醫療險理賠
            priority:0, param:null });
        }); break;

      /* ---------- M8 S3 ---------- */
      case "GRANT_SKILL":   // 別人給你的機會（公司內訓、家傳手藝）——不必自己出時間
        targets.forEach(function(t){
          var gsc = ns.content.byId[ef.skillId];
          if(!gsc || gsc.kind!=="SKILL") return;                 // 防禦：內容缺失不得炸
          if(t.skills[ef.skillId] && !t.skills[ef.skillId].decayed) return;   // 已會就不重複給
          var wasDecayed = !!(t.skills[ef.skillId] && t.skills[ef.skillId].decayed);
          t.skills[ef.skillId] = { learnedAt:S.turnNumber, decayed:false,
                                   refreshedAt: wasDecayed ? S.turnNumber : null };
          t.stats.skillsLearned = (t.stats.skillsLearned||0) + 1;
          E.ev("SKILL_GRANTED",{ playerId:t.id, skillId:ef.skillId, title:gsc.title,
                                 refreshed:wasDecayed, label:ef.label||label });
        }); break;

      case "DECAY_SKILL":   // 產業變革：先預告，幾輪後才真的過時（給玩家時間去進修更新）
        var warnD = ef.warnTurns;
        if(warnD===undefined) warnD = E.cfg(S,"skillDecayWarnTurns");
        if(warnD===undefined) warnD = 2;
        targets.forEach(function(t){
          Object.keys(t.skills||{}).forEach(function(sid){
            var dsc = ns.content.byId[sid]; if(!dsc) return;
            if(!dsc.decayable) return;                            // 只有「會過時」的技能會被點名
            if(ef.skillId && sid!==ef.skillId) return;
            if(ef.family && dsc.family!==ef.family) return;
            // S22：AI 系統架構——科技類技能在產業變革事件中不過時（跟得上變革的人）
            if(dsc.family==="TECH" && E.hasSkill(t, "SKL_AI_ARCH")) return;
            var rec = t.skills[sid];
            if(rec.decayed || rec.decayPendingUntil) return;       // 已過時／已在預告中
            rec.decayPendingUntil = S.turnNumber + warnD;
            S.activeGlobalEvents.push({ seq:++S.eventSeq, kind:"SKILL_DECAY_PENDING",
              playerId:t.id, skillId:sid, until:S.turnNumber+warnD,
              label:ef.label||label, priority:0, param:null });
            E.ev("SKILL_DECAY_WARNED",{ playerId:t.id, skillId:sid, title:dsc.title,
                                        turns:warnD, label:ef.label||label });
          });
        }); break;

      case "DELAY_LEARNING":  // 加班／照顧家人：進度被吃掉，學費照付
        targets.forEach(function(t){
          if(!t.learning) return;
          var dl = ef.turns; if(dl===undefined) dl = 1;
          t.learning.endTurn = t.learning.endTurn + dl;
          t.learning.interrupted = (t.learning.interrupted||0) + 1;
          t.stats.skillInterrupted = (t.stats.skillInterrupted||0) + 1;
          var lsc = ns.content.byId[t.learning.skillId];
          E.ev("SKILL_INTERRUPTED",{ playerId:t.id, skillId:t.learning.skillId,
                                     title:lsc?lsc.title:"", turns:dl, label:ef.label||label });
        }); break;
    }
  });
};

// S8：系統性衝擊的個股倍率。原本黑天鵝對每檔股票一律砍同一個百分比，
// 導致高股息與 ETF 跟投機股跌一樣多——「穩定的股票也會超大波動」就是這麼來的，
// 而且讓「分散風險」這一課完全失效。改成以波動度為基準換算倍率。
E.stockBeta = function(S, def){
  if(def && isFinite(def.shockBeta)) return def.shockBeta;        // 內容可覆寫
  var ref=E.cfg(S,"shockBetaRef"); if(!(ref>0)) ref=0.06;
  var lo=E.cfg(S,"shockBetaMin");  if(!(lo>0)) lo=0.4;
  var hi=E.cfg(S,"shockBetaMax");  if(!(hi>0)) hi=1.8;
  var v=E.stockVol(S,def)||ref;     // S15b：一律走 E.stockVol，開關關掉時衝擊倍率也要跟著回到舊值
  return Math.max(lo, Math.min(hi, v/ref));
};

/* S15b：本局實際採用的波動度。開關關掉就回到 S15a 的數值（鐵律：關掉全部開關＝重現基線）。
   注意 E.stockBeta（黑天鵝衝擊倍率）也吃 vol，所以必須一律走這個入口，不能直接讀 def.vol。 */
E.stockVol = function(S, def){
  if(!def) return 0;
  var on=E.cfg(S,"stockVolS15bOn");
  if(on===undefined) on=1;
  if(!on && def.volPreS15b!==undefined && isFinite(def.volPreS15b)) return def.volPreS15b;
  return def.vol;
};
/* S15b：個股對景氣的敏感度。關閉開關時一律回傳 1＝四檔一視同仁（舊模型，鐵律） */
E.stockMacroBeta = function(S, def){
  if(!E.cfg(S,"stockMacroBetaOn")) return 1;
  var b = def.macroBeta;
  return (b===undefined || b===null || !isFinite(b)) ? 1 : b;
};
/* S15b：單輪漲跌幅熔斷。只削常態漂移，不套用在黑天鵝／重大事件上。
   關閉開關或個股沒設 maxMove 時原樣回傳（鐵律） */
E.capMove = function(S, def, chg){
  if(!E.cfg(S,"stockMaxMoveOn")) return chg;
  var m = def.maxMove;
  if(m===undefined || m===null || !isFinite(m) || m<=0) return chg;
  if(chg >  m) return  m;
  if(chg < -m) return -m;
  return chg;
};
/* ===================== S15b：交易成本 =====================================
   實測回饋：玩家把股票當當沖在玩，尤其快絕望時借錢＋融資賭一把。三個條件疊在一起——
   投機股月波動 16%、融資五成自備、而買賣**完全零成本**。前兩項在別處處理，
   這裡補上第三項：照台灣實務收手續費與證交稅。
   費率查證（2026-08-29）：券商手續費 0.1425%，買賣各收一次；證券交易稅 0.3%，
   只在賣出時課徵；ETF 的證交稅為 0.1%（以個股的 taxRate 覆寫）。
   來回總成本約 0.585%（ETF 約 0.385%）。金額不大，但它堵住零成本空轉，
   而且每一筆交易都在教真實成本。全部走 config，設 0 即完全回到舊行為（鐵律）。 */
/* S15b：融資紀律閘門。實測回饋——玩家快絕望時會「借錢＋融資」賭一把。
   問題不在玩家不理性，而在規則讓「賭一把」變成落後者的最優解；這裡把最後那一段
   放大器關掉：現金流已經為負、或信用已經 C 級的人，不該再開槓桿。
   真實世界也是這樣——券商不會讓一個現金流為負、信用不良的人做融資。
   只擋融資買股，不擋紓困貸款與 P2P（那是求生管道，不是放大器）。
   回傳 null＝可以融資；否則回傳擋下的理由。 */
E.marginBlockReason = function(S, p){
  if(!E.cfg(S,"marginDisciplineGate")) return null;
  if(!p) return null;
  if(p.bankrupt) return "BANKRUPT";
  if(S.phase==="BANKRUPTCY") return "IN_BANKRUPTCY";
  if(p.playerStage==="OUTER" && p.cash<0) return "IN_FREEFALL";
  if((p.creditRating||"B")==="C") return "CREDIT_C";
  if(p.derived && p.derived.netCashflow<0) return "NEGATIVE_CASHFLOW";
  return null;
};
E.MARGIN_BLOCK_TEXT = {
  BANKRUPT:"破產程序中不能融資",
  IN_BANKRUPTCY:"破產程序中不能融資",
  IN_FREEFALL:"自由圈現金告急，先把現金救回正數",
  CREDIT_C:"信用評級 C——券商不會讓信用不良的人開槓桿",
  NEGATIVE_CASHFLOW:"你的淨現金流是負的——先把每月收支轉正，再談槓桿"
};
E.stockFee = function(S, amount){
  var r=E.cfg(S,"stockFeeRate");
  if(r===undefined || !(r>0) || !(amount>0)) return 0;
  return util.r2(amount*r);
};
E.stockTax = function(S, def, amount){
  var r = (def && def.taxRate!==undefined && def.taxRate!==null && isFinite(def.taxRate))
          ? def.taxRate : E.cfg(S,"stockTaxRate");
  if(r===undefined || !(r>0) || !(amount>0)) return 0;
  return util.r2(amount*r);
};
// 買進要準備的現金＝自備款＋手續費
E.stockBuyCost = function(S, def, total, ownCash){
  var fee=E.stockFee(S,total);
  return { fee:fee, cash:util.r2((ownCash===undefined?total:ownCash)+fee) };
};
// 賣出實際入袋＝價款 − 手續費 − 證交稅
E.stockSellNet = function(S, def, proceeds){
  var fee=E.stockFee(S,proceeds), tax=E.stockTax(S,def,proceeds);
  return { fee:fee, tax:tax, net:util.r2(proceeds-fee-tax) };
};
// 一買一賣的來回成本率——UI 用來提醒「這一趟先賠掉多少」
E.stockRoundTripRate = function(S, def){
  var f=E.cfg(S,"stockFeeRate")||0;
  var t=(def && def.taxRate!==undefined && def.taxRate!==null && isFinite(def.taxRate))
        ? def.taxRate : (E.cfg(S,"stockTaxRate")||0);
  return f*2+t;      // 費率不能過 util.r2——那是給金額用的（四捨五入到小數兩位，0.00585 會變成 0.01）
};
/* S23a：地板可依個股覆寫。高股息股的地板原本與投機股共用 0.1（＝跌到面額一成），
   配上「面額固定配息」就變成年化 58% 的印鈔機；把它的地板拉到 0.4，價格不會再掉到
   那個荒謬的區間。開關關掉＝回到全域單一地板（鐵律 4）。 */
E.stockFloorMult = function(S, def){
  var on = E.cfg(S,"stockPerSymbolFloor"); if(on===undefined) on = 1;
  if(on && def && def.floorMult!==undefined && isFinite(def.floorMult)) return def.floorMult;
  return S.config.stockFloorMult;
};
E.clampPrice = function(S, def, v){
  return util.r2(Math.min(def.face*S.config.stockCapMult, Math.max(def.face*E.stockFloorMult(S,def), v)));
};

/* ============== S23a.1：被動收入是哪些東西堆出來的 ==============
   「被動收入 1,479,030」看得到總數卻看不出組成——是租金、事業分紅、股息，
   還是數位長尾？分不出來就沒辦法判斷「我的現金流體質是不是太偏一邊」。
   分類直接走 p.assets 的 kind（帳本記的是總額，分類要從資產這邊來），
   合計對不上時把差額掛在「其他」，確保每一列加起來就是 derived.passiveIncome。 */
E.PASSIVE_KINDS = [
  { key:"REALESTATE", label:"租金",     icon:"🏠" },
  { key:"BUSINESS",   label:"事業分紅", icon:"🏪" },
  { key:"STOCK",      label:"股息",     icon:"📈" },
  { key:"DIGITAL",    label:"數位長尾", icon:"💻" },
  { key:"P2P_LOAN",   label:"P2P 利息", icon:"🤝" },
  { key:"STARTUP",    label:"新創",     icon:"🚀" }
];
E.passiveBreakdown = function(S, p){
  var by={}, total=0;
  (p.assets||[]).forEach(function(a){
    var inc = a.monthlyIncome||0;
    if(!inc) return;
    var k = a.kind || "OTHER";
    by[k] = util.r2((by[k]||0) + inc);
    total = util.r2(total + inc);
  });
  var rows = E.PASSIVE_KINDS.filter(function(x){ return by[x.key]; })
    .map(function(x){ return { key:x.key, label:x.label, icon:x.icon, amount:by[x.key],
                               count:(p.assets||[]).filter(function(a){ return a.kind===x.key && a.monthlyIncome; }).length }; });
  // 已知 kind 以外的（含未來新增的資產類型）：合併成一列，不讓它憑空消失
  var known={}; E.PASSIVE_KINDS.forEach(function(x){ known[x.key]=1; });
  var otherAmt=0, otherN=0;
  Object.keys(by).forEach(function(k){ if(!known[k]){ otherAmt=util.r2(otherAmt+by[k]); otherN++; } });
  if(otherAmt) rows.push({ key:"OTHER", label:"其他", icon:"•", amount:otherAmt, count:otherN });
  // 帳本總額與資產明細的差額（例如事件直接加減 INCOME_PASSIVE 而沒掛在某筆資產上）
  var booked = (p.derived && p.derived.passiveIncome) || 0;
  var resid = util.r2(booked - total);
  if(Math.abs(resid) >= 0.01) rows.push({ key:"ADJ", label:"其他調整", icon:"·", amount:resid, count:0 });
  rows.sort(function(a,b){ return b.amount-a.amount; });
  return { rows:rows, total:booked };
};

/* 股價變動後，重估所有玩家的股票資產（產生分錄） */
// 每局股票顯示名（開局隨機化）
E.stockName = function(S, sym){
  return (S.stockNames && S.stockNames[sym]) || (ns.content.stockBySymbol[sym] && ns.content.stockBySymbol[sym].name) || sym;
};

E.revalueStocks = function(S){
  S.players.forEach(function(p){ var agg=0; p.assets.forEach(function(a){
    if(a.kind!=="STOCK") return;
    var nv = util.r2(S.stockPrices[a.symbol]*a.units), d = util.r2(nv-a.marketValue);
    if(!d) return; a.marketValue = nv; agg += d;
    ledger.post(S,p,E.stockName(S,a.symbol)+" 股價變動",[{account:"ASSET",delta:d,refId:a.instanceId,label:"市值變動"}],{eduTags:["valuation"]});
    // 股息為每股固定（依面值），不隨價格調整 → 價格跌，殖利率反而上升（更真實）
  });
  if(Math.abs(agg)>=0.5) E.ev("HOLDINGS_REVALUED",{playerId:p.id, delta:util.r2(agg)}); });
};
/* ==================== S23a：每張月股息 ====================
   S22 以前：股息＝面額 × 月配息率，買進時算一次就定死，價格再怎麼跌都不變。
   實測（Brian 第 87–91 輪的每輪紀錄）暴露的漏洞：高股息股跌到面額 16% 時，
   殖利率變成月 2.4%＝年化 29%，定期定額＋股息再投入滾成印鈔機（被動收入 148 萬／月）。
   現實裡股價跌成那樣，公司盈餘早就撐不住配息了。

   S23a 改成每輪重算，兩道閘門：
     殖利率上限  每張股息不得超過「現價 × stockYieldCapMonthly(1.5%)」→ 年化 18% 封頂
                 （刻意留在 18%：房地產隨手就有 50%，壓太低沒人想玩這個機制）
     景氣係數    復甦 1.0／過熱 1.1／衰退 0.8／蕭條 0.5——景氣差，配息跟著砍
   價格在面額 27% 以上時上限咬不到，正常區間的手感與 S22 完全一樣。         */
E.stockDivPerUnit = function(S, def){
  if(!def) return 0;
  var base = def.face * def.dividendYieldMonthly;
  if(!(base>0)) return 0;
  var on = E.cfg(S,"stockDivRestock"); if(on===undefined) on = 1;
  if(!on) return base;                                // 開關關掉＝S22 行為（面額固定）
  var price = E.stockPrice(S, def);
  var capR = E.cfg(S,"stockYieldCapMonthly"); if(capR===undefined) capR = 0.015;
  var v = (capR>0 && price>0) ? Math.min(base, price*capR) : base;
  var stage = (S.macro && S.macro.stage) || "RECOVERY";
  var mm = E.cfg(S,"divMult_"+stage);
  if(mm===undefined || !isFinite(mm)) mm = 1;
  return v*mm;
};
/* 註：這裡刻意【不】過 util.r2——它是「每一張」的金額，會再乘上張數。
   先四捨五入到分再乘，100 張的 ETF 就會差 0.2（實測：0.132→0.13）。
   與 E.stockRoundTripRate 同一個道理：單價與費率留原值，金額在最後一步才收斂。 */
// 這張股票現在為什麼配這麼多／這麼少——介面用（不影響計算）
E.stockDivReason = function(S, def){
  if(!def || !(def.dividendYieldMonthly>0)) return "";
  var on = E.cfg(S,"stockDivRestock"); if(on===undefined) on = 1;
  if(!on) return "";
  var base = def.face*def.dividendYieldMonthly, price = E.stockPrice(S,def);
  var capR = E.cfg(S,"stockYieldCapMonthly"); if(capR===undefined) capR = 0.015;
  var stage = (S.macro && S.macro.stage) || "RECOVERY";
  var mm = E.cfg(S,"divMult_"+stage); if(mm===undefined || !isFinite(mm)) mm = 1;
  var out=[];
  if(capR>0 && price>0 && price*capR < base) out.push("殖利率上限 "+util.pct(capR,1)+"／月");
  if(mm!==1) out.push("景氣係數 ×"+mm);
  return out.join("、");
};
// 每股月配息（S23a 起改走 E.stockDivPerUnit；這個入口保留給只有 def 沒有 S 的呼叫端）
E.stockPerShareDiv = function(def){ return util.r2(def.face*def.dividendYieldMonthly); };
/* 每輪重算所有玩家手上股票的月股息。股價變動之後、下市判定之前跑。
   差額走 INCOME_PASSIVE 分錄，玩家在每輪紀錄裡看得到「配息被砍」這件事。 */
E.restockDividends = function(S){
  var on = E.cfg(S,"stockDivRestock"); if(on===undefined) on = 1;
  if(!on) return;
  S.players.forEach(function(p){
    if(p.bankrupt) return;
    p.assets.forEach(function(a){
      if(a.kind!=="STOCK") return;
      var def = ns.content.stockBySymbol[a.symbol];
      if(!def || !(def.dividendYieldMonthly>0)) return;
      var want = util.r2(a.units * E.stockDivPerUnit(S,def));
      var d = util.r2(want - (a.monthlyIncome||0));
      if(!d) return;
      a.monthlyIncome = want;
      var why = E.stockDivReason(S,def);
      ledger.post(S, p, E.stockName(S,a.symbol)+" 股息調整"+(why?("（"+why+"）"):""),
        [{account:"INCOME_PASSIVE", delta:d, refId:a.instanceId, label:"每張月股息 "+util.money(E.stockDivPerUnit(S,def))}],
        {eduTags:["dividend","valuation"]});
    });
  });
};
/* S16：股價的唯一存取入口。
   實測回報：畫面寫「已下市，只剩壁紙」，價格卻顯示 12,000／張，線圖還往上噴。
   根因是全檔 9 處寫成 `S.stockPrices[x] || def.face`——下市價是 **0**，在 JS 裡是 falsy，
   於是一律被換成面額。面額只該在「還沒開盤、價格是 undefined」時當退路，
   絕不能拿來蓋掉一個真實存在的 0。 */
E.stockPrice = function(S, symOrDef){
  var def = (typeof symOrDef==="string") ? ns.content.stockBySymbol[symOrDef] : symOrDef;
  if(!def) return 0;
  var v = S.stockPrices ? S.stockPrices[def.symbol] : undefined;
  if(v===undefined || v===null || !isFinite(v)) return def.face;   // 尚未開盤才回面額
  return v;                                                        // 0 就是 0（已下市）
};
E.isDelisted = function(S, symOrDef){
  var def = (typeof symOrDef==="string") ? ns.content.stockBySymbol[symOrDef] : symOrDef;
  return !!(def && S.delisted && S.delisted[def.symbol]);
};
E.stockYield = function(S, def){ var pr=E.stockPrice(S,def); return pr>0 ? E.stockDivPerUnit(S,def)/pr : 0; };
// 與「上一期」比較的漲跌（不是與面額比）。
// 用面額當基準會洩漏地板：看到 −90% 就等於知道離 stockFloorMult 不遠了，
// 玩家可以據此推測底部。期間變化不帶這個資訊。
E.stockChange = function(S, def){
  var price = S.stockPrices[def.symbol];
  if(price===undefined || !isFinite(price)) price = def.face;
  var hist = (S.stockHistory && S.stockHistory[def.symbol]) || [];
  var prev = hist.length>=2 ? hist[hist.length-2] : price;
  if(!isFinite(prev) || prev<=0) prev = price;
  var chg = util.r2(price - prev);
  return { price:price, prev:prev, chg:chg, pct:(prev>0 ? chg/prev : 0) };
};

/* 浮動利率重算（基準利率或加碼變動時） */
// 依目前基準利率重定價所有浮動貸款
E.rRate = function(x){ return Math.round(x*1e4)/1e4; };  // 利率取 4 位小數（util.r2 太粗）
E.repriceFloating = function(S){
  S.players.forEach(function(p){ p.liabilities.forEach(function(l){
    if(!l.isFloating) return;
    // 九期：房貸沿用政策可調的房貸加碼；其餘貸款用自己承作時的商品加碼
    var nr = E.rRate(S.macro.baseRate + (l.kind==="MORTGAGE" ? E.cfg(S,"mortgageSpread")
                     : (l.rateSpread!==undefined ? l.rateSpread : E.cfg(S,"mortgageSpread")))
                     + E.creditSpread(S,p));
    if(nr===l.annualRate) return;
    l.annualRate=nr;
    var d = E.repriceLoan(l);
    if(d) ledger.post(S,p,"利率調整："+l.name,[{account:"EXPENSE",delta:d,refId:l.instanceId,label:l.name+" 月付調整"}],{eduTags:["rate"]});
  }); });
};
// 央行利率檢視：每 rateReviewTurns 輪，基準利率逐步趨近目標，並回報各玩家影響數
E.reviewRate = function(S){
  var m=S.macro, old=m.baseRate;
  var diff=m.targetRate-old;
  var step=Math.max(-S.config.rateStepMax, Math.min(S.config.rateStepMax, diff));
  var nw=E.rRate(old+step);
  var changed=Math.abs(nw-old)>=0.0005;
  var before={};
  S.players.forEach(function(p){ var s=0; p.liabilities.forEach(function(l){ if(l.isFloating) s+=l.monthlyPayment; }); before[p.id]=util.r2(s); });
  m.baseRate=nw;
  if(changed) E.repriceFloating(S);
  var impacts=[];
  S.players.forEach(function(p){ if(p.bankrupt) return;
    var s=0; p.liabilities.forEach(function(l){ if(l.isFloating) s+=l.monthlyPayment; });
    impacts.push({playerId:p.id, delta:util.r2(s-before[p.id])}); });
  E.ev("RATE_REVIEW",{oldRate:old, newRate:nw, changed:changed, impacts:impacts});
  if(E.cfg(S,"creditReviewWithRate")) E.runCreditReview(S);
};

/* ===================== M7 信用評級（台灣聯徵分數概念） ===================== */
// 該玩家目前評級對新貸款的利率加碼
E.creditSpread = function(S, p){
  var v = E.cfg(S, "creditSpread_"+(p && p.creditRating ? p.creditRating : "B"));
  return v===undefined ? 0 : v;
};
// 評分並回傳 {rating, reasons[]}；純函式，不改 state
E.reviewCredit = function(S, p){
  var d = p.derived || {}, reasons = [], score = 2;
  var totalAsset = Math.max(1, util.r2((p.cash||0) + (d.totalAssets||0)));
  var ratio = (d.totalLiabilities||0) / totalAsset;
  if(ratio > 0.75){ score -= 2; reasons.push("負債比過高"); }
  else if(ratio >= 0.5){ score -= 1; reasons.push("負債比偏高"); }
  else if(ratio < 0.3){ score += 1; reasons.push("負債比健康"); }
  var cf = p.creditFlags || {};
  if(cf.usedRescue){ score -= 2; reasons.push("曾動用紓困"); }
  if(cf.everBankrupt){ score -= 3; reasons.push("曾破產"); }
  if(cf.cashWentNegative){ score -= 1; reasons.push("本期現金為負"); }
  if((d.passiveIncome||0) >= (d.totalExpenses||0) && (d.totalExpenses||0) > 0){ score += 1; reasons.push("被動收入已覆蓋支出"); }
  var rating = score >= 3 ? "A" : (score >= 0 ? "B" : "C");
  return { rating:rating, reasons:reasons, score:score };
};
// 對全體玩家重評，變動時發事件；每次評完清除「本期」旗標
E.runCreditReview = function(S){
  S.players.forEach(function(p){
    if(p.bankrupt) return;
    if(!p.creditFlags) p.creditFlags={usedRescue:false, everBankrupt:false, cashWentNegative:false};
    var r = E.reviewCredit(S,p), from = p.creditRating||"B";
    p.creditRating = r.rating;
    p.creditFlags.cashWentNegative = false;   // 本檢視期旗標歸零
    if(from !== r.rating){
      E.repriceFloating(S);                    // 加碼變動 → 浮動貸款同步重定價
      E.ev("CREDIT_RATING_CHANGED",{playerId:p.id, from:from, to:r.rating, reasons:r.reasons});
    }
  });
};
/* 擷取一段效果對「本人」造成的實際帳務影響（比對套用前後新增分錄） */
E.captureImpact = function(S, p, fn){
  var before = p.ledger.length;
  fn();
  var impact = [];
  for(var i=before; i<p.ledger.length; i++){
    p.ledger[i].postings.forEach(function(q){
      impact.push({ label:p.ledger[i].summary+"｜"+q.label, account:q.account, delta:q.delta });
    });
  }
  return impact;
};

E.pushDecision = function(S, p, d){
  d.decisionId = util.uid(S,"d"); d.playerId = p.id;
  d = ns.modules.decorateDecision(S, p, d);
  S.decisionQueue.push(d);
};
E.syncPhase = function(S){
  if(S.over){ S.phase="GAME_OVER"; S.pendingDecision=null; return; }
  S.pendingDecision = S.decisionQueue.length ? S.decisionQueue[0] : null;
  if(S.pendingDecision){ S.phase = S.pendingDecision.kind==="BANKRUPTCY" ? "BANKRUPTCY" : "DECISION"; return; }
  // 九期：回合中後續自主動作（還款／買賣／借款）也要納入記帳，否則帳目對不起來
  if(E.refreshBookkeeping) E.refreshBookkeeping(S);
  if(S.bookkeeping && S.bookkeeping.tasks.some(function(t){return !t.done;})){ S.phase="BOOKKEEPING"; return; }
  S.phase = S.turnResolved ? "READY_END" : "ROLL";
};
return ns; })();
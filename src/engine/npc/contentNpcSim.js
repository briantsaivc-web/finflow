(function(ns){
"use strict";
var util=ns.util, ledger=ns.ledger, E=ns.engine;

/* ============================ 內容載入與索引 ============================= */
ns.loadContent = function(readJson){
  var base = readJson("content-base"), packs=[base];
  // 鐵律三：新增內容包時，這份清單與 selftest_run.js / verify_*.js / build_finflow_xlsx.py 必須同步
  ["m1","m2","m3","m4","m6","outer","v10","mall","skill","special"].forEach(function(m){ var j=readJson("content-mod-"+m); if(j) packs.push(j); });
  var C = { cards:{}, professions:base.professions, boardLayout:base.boardLayout,
            boardLayoutOuter:base.boardLayoutOuter, stockDefs:base.stockDefs,
            futuresDefs:base.futuresDefs||[],                      // S23b：M9 期貨合約定義
            /* S23c：迷因幣。刻意【不】併進 stockDefs——那份陣列被開盤價、M1 逐輪報價、
               下市判定等一大堆迴圈直接走訪，多一檔就多消耗亂數，「開關全關要能重現基線」
               （鐵律 4）當場就斷。改成獨立陣列，只有 M9 開啟時才由 E.cryptoDefs 併進來。 */
            cryptoDefs:base.cryptoDefs||[],
            personalities:base.personalities, strings:base.strings, byId:{},
            professionById:{}, stockBySymbol:{}, futBySymbol:{}, personalityById:{}, errors:[] };
  packs.forEach(function(pk){ Object.keys(pk.cards||{}).forEach(function(deck){
    C.cards[deck] = (C.cards[deck]||[]).concat(pk.cards[deck]); }); });
  Object.keys(C.cards).forEach(function(d){ C.cards[d].forEach(function(c){
    if(C.byId[c.id]) C.errors.push("重複的卡牌 id："+c.id);
    C.byId[c.id]=c; }); });
  (base.cards.DREAM||[]).forEach(function(d){ C.byId[d.id]=d; });
  C.professions.forEach(function(p){ C.professionById[p.id]=p; C.byId[p.id]=p; });
  C.stockDefs.forEach(function(s){ C.stockBySymbol[s.symbol]=s; });
  C.futuresDefs.forEach(function(f){ C.futBySymbol[f.symbol]=f; C.byId[f.symbol]=f; });
  /* 索引可以全域建（查得到不代表玩得到）——能不能交易由 E.stockTradable 一個入口把關。 */
  C.cryptoDefs.forEach(function(c){ C.stockBySymbol[c.symbol]=c; C.byId[c.symbol]=c; });
  C.personalities.forEach(function(x){ C.personalityById[x.id]=x; });
  C.dreams = base.cards.DREAM||[];
  var req = { professions:["id","name","salary","baseExpenses","startingCash"] };
  C.professions.forEach(function(p){ req.professions.forEach(function(k){
    if(p[k]===undefined) C.errors.push("職業 "+(p.id||"?")+" 缺少欄位 "+k); }); });
  Object.keys(C.cards).forEach(function(d){ C.cards[d].forEach(function(c){
    if(!c.id||!c.kind) C.errors.push("卡牌缺少 id 或 kind："+JSON.stringify(c).slice(0,40)); }); });
  if(!C.boardLayout || C.boardLayout.length<8) C.errors.push("盤面格數不足");
  // S13.1 NEW-02 守門：總體事件牌堆裡，任何玩家級的效果都必須明寫 target，
  // 否則會靜默退化成「只打一號座位」。這條讓同類內容錯誤在開機時就被擋下來。
  var MPO=["CASH_DELTA","ASSET_INCOME_MULT","ASSET_VALUE_MULT","ADD_RECURRING_EXPENSE",
           "SKIP_TURNS","GRANT_JOY","GRANT_VIRTUE"];
  (C.cards.MACRO_EVENT||[]).forEach(function(c){
    (c.effects||[]).forEach(function(ef){
      if(MPO.indexOf(ef.op)>=0 && !ef.target)
        C.errors.push("總體事件 "+c.id+" 的 "+ef.op+" 未標 target（需為 all／others／self）");
    });
  });
  ns.content = C; return C;
};
ns.buildConfig = function(reg){
  var c={}; reg.params.forEach(function(p){ c[p.key]=p.value; }); return c;
};

/* =============================== 模組系統 =============================== */
var M = ns.modules = { registry:{}, order:["M1","M2","M3","M4","M6","M8","M9"] };
M.active = function(S){ return M.order.filter(function(m){ return S.enabledModules.indexOf(m)>=0 && M.registry[m]; })
                        .map(function(m){ return M.registry[m]; }); };
function fanout(name){ return function(S,a,b,c){
  M.active(S).forEach(function(mod){ if(mod[name]) mod[name](S,a,b,c); }); }; }
M.onGameSetup=fanout("onGameSetup"); M.onTurnStart=fanout("onTurnStart");
M.onDiceRolled=fanout("onDiceRolled"); M.onPayday=fanout("onPayday");
M.onTurnEnd=fanout("onTurnEnd"); M.onRoundEnd=fanout("onRoundEnd");
M.onStageTransition=fanout("onStageTransition"); M.onMacroTransition=fanout("onMacroTransition");
M.onLanded = function(S,p,space){ var handled=false;
  M.active(S).forEach(function(m){ if(m.onLanded && m.onLanded(S,p,space)) handled=true; }); return handled; };
M.decorateDecision = function(S,p,d){
  M.active(S).forEach(function(m){ if(m.decorateDecision) d=m.decorateDecision(S,p,d)||d; }); return d; };
M.beforeLedgerPost = function(S,p,e){
  var mods=M.active(S); for(var i=0;i<mods.length;i++){ if(mods[i].beforeLedgerPost){
    e=mods[i].beforeLedgerPost(S,p,e); if(!e) return null; } } return e; };

/* --------- M1 股市引擎 --------- */
M.registry.M1 = {
  onRoundEnd:function(S){
    var mult=S.config.stockVolatilityMult*(S.config.volatilityLevel===1?0:1);
    var drift=S.config["drift_"+S.macro.stage];
    ns.content.stockDefs.forEach(function(def){
      if(S.delisted && S.delisted[def.symbol]) return;   // 已下市：不再報價、不再消耗亂數
      var pr=S.stockPrices[def.symbol];
      /* S15b 四層股價：
           大環境  drift[景氣] × 個股景氣敏感度 macroBeta
           個股股性 driftBonus（長期偏移）＋ 各自的 vol
           隨機性  vol × gauss
           熔斷    單輪削到 ±maxMove——只管常態漂移；黑天鵝與重大事件是「外部事件」層，
                   本來就該能一次打穿，不受這條限制。
         實測動機：投機股原本 21.9% 的輪次單月變動超過 ±20%、6.5% 超過 ±30%，
         尾巴到 +76%／−74%，玩家因此把它當吃角子老虎在賭。 */
      var beta = E.stockMacroBeta(S,def);
      var chg=drift*beta+(def.driftBonus||0)+E.stockVol(S,def)*mult*util.gauss(S);
      chg = E.capMove(S,def,chg);
      S.stockPrices[def.symbol]=E.clampPrice(S,def,pr*(1+chg));
      if(!S.stockHistory) S.stockHistory={};
      var h=S.stockHistory[def.symbol]||(S.stockHistory[def.symbol]=[def.face]);
      h.push(S.stockPrices[def.symbol]); if(h.length>12) h.shift();
    });
    E.revalueStocks(S);
    E.restockDividends(S);  // S23a：價格更新後重算每張股息（殖利率上限＋景氣係數）
    E.tickDelist(S);        // S7b：價格更新後才判斷下市（警示→緩衝→歸零）
    // V10：帳上獲利達門檻 → 提示玩家停利或續抱（每個部位只提示一次）
    var gp=E.cfg(S,"stockGainAlertPct");
    if(gp===undefined) gp=1;
    if(gp>0){
      S.players.forEach(function(p){
        if(p.isNPC || p.bankrupt) return;
        p.assets.forEach(function(a){
          if(a.kind!=="STOCK" || !(a.costBasis>0)) return;
          a.flags=a.flags||{};
          if(a.flags.gainAlerted) return;
          var g=(a.marketValue-a.costBasis)/a.costBasis;
          if(g < gp) return;
          a.flags.gainAlerted=true;
          E.pushDecision(S,p,{kind:"STOCK_GAIN", assetId:a.instanceId, gain:util.r2(g*100)});
          E.ev("STOCK_GAIN_ALERT",{playerId:p.id, name:a.name, gainPct:util.r2(g*100),
            marketValue:a.marketValue, costBasis:a.costBasis});
        });
      });
    }
    S.players.forEach(function(p){
      p.liabilities.slice().forEach(function(l){
        if(l.kind!=="MARGIN") return;
        var a=p.assets.filter(function(x){return x.instanceId===l.collateralAssetId;})[0];
        if(!a){ return; }
        var ratio=a.marketValue/Math.max(0.01,l.principal);
        if(ratio >= S.config.marginCallLevel){ if(l.flags.marginWarned) delete l.flags.marginWarned; return; }
        var restore=S.config.marginRestoreLevel||1.66;
        var need=util.r2(Math.max(0, l.principal - a.marketValue/restore));
        if(!l.flags.marginWarned){
          // 第一次跌破：追繳通知，寬限至下次結算
          l.flags.marginWarned = S.turnNumber;
          E.ev("MARGIN_WARNING",{playerId:p.id, name:a.name, liabilityId:l.instanceId,
            ratio:ratio, needed:need, marketValue:a.marketValue, principal:l.principal});
          if(p.isNPC && need>0){ // NPC：付得起就補繳保證金
            var w=ns.content.personalityById[p.npcPersonality].weights;
            var reserve=w.cashReserveFloor*p.derived.totalExpenses*0.5;
            if(p.cash-need>=reserve){
              E.repay(S,p,l,Math.min(need,l.principal));
              delete l.flags.marginWarned;
              E.ev("MARGIN_TOPUP",{playerId:p.id, name:a.name, amount:need});
            }
          }
          return;
        }
        // 寬限期過仍未回補 → 強制斷頭（帶完整教學數據）
        var mv=a.marketValue, loanP=l.principal, basis=a.costBasis, nm=a.name;
        E.sellAsset(S,p,a,1);
        var still=p.liabilities.filter(function(x){return x.instanceId===l.instanceId;})[0];
        if(still && p.cash>0){ E.repay(S,p,still,Math.min(p.cash,still.principal)); }
        E.ev("MARGIN_CALL",{playerId:p.id, name:nm, ratio:ratio,
          marketValue:mv, principal:loanP, costBasis:basis, loss:util.r2(mv-basis)});
      });
    });
  },
  onPayday:function(S,p){
    p.assets.forEach(function(a){
      if(a.kind!=="STOCK") return;
      var bonus=S.dividendBonus[a.symbol];
      if(bonus && a.monthlyIncome>0){
        var extra=util.r2(a.monthlyIncome*(bonus-1));
        if(extra) ledger.post(S,p,a.name+" 配息加發",[{account:"CASH",delta:extra,label:"額外配息"}],{eduTags:["dividend"]});
      }
    });
  }
};

/* --------- M2 房產槓桿 --------- */
M.registry.M2 = {
  decorateDecision:function(S,p,d){
    if(d.kind==="BUY"){ var c=ns.content.byId[d.cardId];
      if(c && c.kind==="REALESTATE" && S.config.depthLevel>=2){ d.allowLoan=true; d.maxLTV=E.effMaxLTV(S); }
      if(c && c.kind==="BUSINESS" && S.config.depthLevel>=2){ d.allowCredit=true; d.creditCap=E.creditCapacity(S,p); } }
    return d; }
};

/* ===================== S7b：新創寒冬（估值下修＋陣亡） =====================
   景氣轉差時，新創先被砍估值（down round），再有一部分直接關門。
   教學點：沒有現金流的資產在寒冬裡最脆弱——它的價值完全靠別人願意出多少錢。 */
E.startupWinter = function(S, to){
  if(!E.cfg(S,"startupCrashEnabled")) return;
  if(S.enabledModules.indexOf("M3")<0) return;
  if(to!=="RECESSION" && to!=="DEPRESSION") return;
  var mult = to==="DEPRESSION" ? E.cfg(S,"startupDownDepression") : E.cfg(S,"startupDownRecession");
  if(mult===undefined) mult = (to==="DEPRESSION" ? 0.45 : 0.7);
  var deathP = E.cfg(S,"startupCrashDeathPct"); if(deathP===undefined) deathP = 0.2;
  S.players.forEach(function(p){
    if(p.bankrupt) return;
    p.assets.slice().forEach(function(a){
      if(a.kind!=="STARTUP") return;
      // 先擲陣亡（用主流 RNG，會寫進狀態）
      if(util.rand(S) < deathP){
        ledger.post(S,p,"新創撐不過寒冬："+a.name,
          [{account:"ASSET",delta:util.r2(-(a.marketValue||0)),refId:a.instanceId,label:"股權歸零"}],
          {eduTags:["startup","loss"], srcTitle:"景氣轉為"+(to==="DEPRESSION"?"蕭條":"衰退")});
        p.assets=p.assets.filter(function(x){ return x.instanceId!==a.instanceId; });
        p.stats.startupWinterDead=(p.stats.startupWinterDead||0)+1;
        E.ev("STARTUP_WINTER_DEAD",{playerId:p.id, name:a.name, stage:to});
        return;
      }
      // 活下來的砍估值
      var nv=util.r2((a.marketValue||0)*mult), dv=util.r2(nv-(a.marketValue||0));
      a.postMoney=util.r2((a.postMoney||0)*mult);
      if(dv){
        a.marketValue=nv;
        ledger.post(S,p,"新創估值下修："+a.name,
          [{account:"ASSET",delta:dv,refId:a.instanceId,label:"down round"}],
          {eduTags:["startup","valuation"], srcTitle:"景氣轉為"+(to==="DEPRESSION"?"蕭條":"衰退")});
        p.stats.startupDownRounds=(p.stats.startupDownRounds||0)+1;
        E.ev("STARTUP_DOWNROUND",{playerId:p.id, name:a.name, mult:mult, delta:dv, stage:to});
      }
    });
  });
};

/* --------- M3 創業與股權 --------- */
M.registry.M3 = {
  onPayday:function(S,p){
    p.assets.slice().forEach(function(a){
      if(a.kind!=="STARTUP") return;
      if(util.rand(S) > S.config.startupEventRate) return;
      var r=util.rand(S), pg=S.config.suP_GROWTH, pf=S.config.suP_FLAT, pd=S.config.suP_DEAD;
      if(r<pg){
        var post0=a.postMoney, raise=util.r2(post0*0.25), pre=util.r2(post0*S.config.startupStepUp), post=util.r2(pre+raise);
        if(p.isNPC){
          var w=ns.content.personalityById[p.npcPersonality].weights;
          var inv=util.r2(raise*a.equityPct);
          if(w.startupAppetite>0.5 && p.cash>inv*1.5){
            // S13.1 NEW-01：同 resolveDecision 的 FOLLOW_ON——出資只走 CASH，持股價值由「估值更新」一次調到位。
            ledger.post(S,p,"跟投："+a.name,[{account:"CASH",delta:-inv,label:"跟投出資"}],{eduTags:["startup"]});
            a.costBasis=util.r2(a.costBasis+inv);
          } else { a.equityPct=util.r2(a.equityPct*pre/post*10000)/10000; }
          a.postMoney=post;
          var nv=util.r2(post*a.equityPct), dv=util.r2(nv-a.marketValue);
          if(dv) ledger.post(S,p,a.name+" 估值更新",[{account:"ASSET",delta:dv,refId:a.instanceId,label:"新一輪估值"}],{eduTags:["startup"]});
          a.marketValue=nv;
        } else {
          E.pushDecision(S,p,{ kind:"FOLLOW_ON", assetId:a.instanceId, pre:pre, raise:raise, post:post,
            invest:util.r2(raise*a.equityPct), equity:a.equityPct });
        }
      } else if(r<pg+pf){ /* 停滯 */ }
      else if(r<pg+pf+pd){
        ledger.post(S,p,"新創倒閉："+a.name,[{account:"ASSET",delta:-a.marketValue,refId:a.instanceId,label:"資產減損"}],{eduTags:["startup","loss"]});
        p.assets=p.assets.filter(function(x){return x.instanceId!==a.instanceId;});
        E.ev("STARTUP_DEAD",{playerId:p.id, name:a.name});
      } else {
        var ex = S.enabledModules.indexOf("M4")>=0 ? ({RECOVERY:1.0,BOOM:1.5,RECESSION:0.7,DEPRESSION:0.4})[S.macro.stage] : 1.0;
        var cash=util.r2(a.postMoney*a.equityPct*ex);
        ledger.post(S,p,"新創被收購："+a.name,[{account:"CASH",delta:cash,label:"退出價款"},
          {account:"ASSET",delta:-a.marketValue,refId:a.instanceId,label:"股權出售"}],{eduTags:["startup","exit"]});
        p.assets=p.assets.filter(function(x){return x.instanceId!==a.instanceId;});
        E.ev("STARTUP_EXIT",{playerId:p.id, name:a.name, cash:cash});
      }
    });
  }
};

/* --------- M4 總經循環 --------- */
var MX = { RECOVERY:{RECOVERY:.75,BOOM:.20,RECESSION:.05,DEPRESSION:0},
           BOOM:{RECOVERY:.05,BOOM:.70,RECESSION:.22,DEPRESSION:.03},
           RECESSION:{RECOVERY:.15,BOOM:.05,RECESSION:.65,DEPRESSION:.15},
           DEPRESSION:{RECOVERY:.30,BOOM:0,RECESSION:.10,DEPRESSION:.60} };
M.registry.M4 = {
  matrix:MX,
  sample:function(S, from, r){
    var row=MX[from], k=S.config.macroTransitionProb, stay=row[from], adj={};
    Object.keys(row).forEach(function(s){ adj[s]= s===from ? Math.max(0,1-(1-stay)*k) : row[s]*k; });
    var keys=Object.keys(adj), tot=keys.reduce(function(a,s){return a+adj[s];},0), acc=0;
    for(var i=0;i<keys.length;i++){ acc+=adj[keys[i]]/tot; if(r<acc) return keys[i]; }
    return from;
  },
  // 九期：年度物價調整——每 inflationTurns 輪依當時景氣的通膨率，一次調整生活支出與租金
  applyInflation:function(S){
    var m=S.macro, r=m.inflation;
    if(!r) return;
    S.players.forEach(function(p){
      if(p.bankrupt) return;
      var base=util.r2(ns.content.professionById[p.professionId].baseExpenses*S.config.expenseMult);
      var d=util.r2(base*r);
      if(d) ledger.post(S,p,"年度物價調整（通膨 "+util.pct(r,1)+"）",
        [{account:"EXPENSE",delta:d,label:"生活成本調整"}],{eduTags:["inflation"]});
      p.assets.forEach(function(a){ if(a.kind!=="REALESTATE") return;
        // 空租中：只調整契約租金（暫存值），不產生分錄——避免恢復出租時租金倒退
        if(a.vacantUntilTurn!==undefined && a.vacantIncome!==undefined){
          var dv=util.r2(a.vacantIncome*r);
          if(dv) a.vacantIncome=util.r2(a.vacantIncome+dv);
          return;
        }
        var dr=util.r2(a.monthlyIncome*r);
        if(dr){ a.monthlyIncome=util.r2(a.monthlyIncome+dr);
          ledger.post(S,p,"租金調整："+a.name,
            [{account:"INCOME_PASSIVE",delta:dr,refId:a.instanceId,label:"租金調整"}],{eduTags:["inflation"]}); } });
    });
    E.ev("INFLATION_APPLIED",{stage:m.stage, rate:r, turn:S.turnNumber});
  },
  onRoundEnd:function(S){
    var m=S.macro; m.turnsInStage++;
    // 央行利率檢視（每 rateReviewTurns 輪）
    m.sinceReview=(m.sinceReview||0)+1;
    if(m.sinceReview>=S.config.rateReviewTurns){ m.sinceReview=0; E.reviewRate(S); }
    // 九期：年度物價調整（每 inflationTurns 輪＝一年）
    var infT=E.cfg(S,"inflationTurns"); if(infT===undefined) infT=12;
    m.sinceInflation=(m.sinceInflation||0)+1;
    if(infT>0 && m.sinceInflation>=infT){ m.sinceInflation=0; M.registry.M4.applyInflation(S); }
    // 黑天鵝：系統性衝擊，預告數輪後才發生
    if(S.pendingShock){
      if(S.turnNumber >= S.pendingShock.turn){
        var sh=S.pendingShock; S.pendingShock=null;
        if(m.stage!==sh.toStage) M.registry.M4.transition(S, m.stage, sh.toStage);
        if(S.enabledModules.indexOf("M1")>=0){
          ns.content.stockDefs.forEach(function(dfn){
            var dropB=util.r2(Math.min(0.95, S.config.shockStockDrop*E.stockBeta(S,dfn)));
            S.stockPrices[dfn.symbol]=E.clampPrice(S,dfn, S.stockPrices[dfn.symbol]*(1-dropB));
            var h=S.stockHistory&&S.stockHistory[dfn.symbol]; if(h){ h.push(S.stockPrices[dfn.symbol]); if(h.length>12)h.shift(); }
          });
          E.revalueStocks(S);
        }
        E.ev("SHOCK_HIT",{desc:sh.desc, toStage:sh.toStage});
        return;
      } else {
        E.ev("SHOCK_COUNTDOWN",{desc:S.pendingShock.desc, rounds:S.pendingShock.turn-S.turnNumber, toStage:S.pendingShock.toStage});
      }
    } else if(S.config.volatilityLevel!==1 && S.turnNumber>=4 && S.turnNumber < S.config.maxTurns-6
              && (m.stage==="RECOVERY"||m.stage==="BOOM")
              && ( (function(){ // C1：任一玩家在夢想圈(外圈)時,黑天鵝機率乘上 outerShockMult
                   var ch=S.config.shockChancePerRound;
                   var osm=E.cfg(S,"outerShockMult"); if(osm===undefined) osm=2;
                   if(E.alive(S).some(function(x){return x.playerStage==="OUTER";})) ch=Math.min(0.5, ch*osm);
                   return util.rand(S) < ch; })()
                   // 九期：到保證輪次仍未出現過系統性衝擊 → 必定預告一次，確保這堂課一定上得到
                   || ( S.config.shockChancePerRound>0 && S.config.shockGuaranteeTurn>0
                        && !S.shockSeen && S.turnNumber>=S.config.shockGuaranteeTurn ) )){
      S.shockSeen=true;
      var delay=S.config.shockMinDelay + Math.floor(util.rand(S)*(S.config.shockMaxDelay-S.config.shockMinDelay+1));
      var TYPES=[["地緣政治動盪，恐衝擊全球市場","DEPRESSION"],["央行升息風暴，資金面轉緊","RECESSION"],
                 ["科技泡沫出現破裂跡象","RECESSION"],["全球供應鏈斷裂危機","DEPRESSION"],
                 ["金融風暴席捲全球，市場信心崩潰","DEPRESSION"],["亞洲金融危機重演，外資急速撤離","RECESSION"],
                 ["次貸違約連環爆，信用市場凍結","DEPRESSION"],["銀行體系大舉抽銀根，資金鏈斷裂","RECESSION"]];
      var t=TYPES[Math.floor(util.rand(S)*TYPES.length)];
      S.pendingShock={turn:S.turnNumber+delay, desc:t[0], toStage:t[1]};
      E.ev("SHOCK_FORECAST",{desc:t[0], rounds:delay, toStage:t[1]});
    }
    if(m.turnsInStage < S.config.minTurnsInStage) return;
    if(S.config.volatilityLevel===1) return;
    var next=M.registry.M4.sample(S, m.stage, util.rand(S));
    if(next!==m.stage){ M.registry.M4.transition(S,m.stage,next); }
  },
  transition:function(S,from,to){
    var m=S.macro; m.stage=to; m.turnsInStage=0;
    m.targetRate=S.config["rate_"+to]; m.inflation=S.config["infl_"+to]; m.liquidity=S.config["liq_"+to];
    // 基準利率不在此立刻變動，改由每 rateReviewTurns 輪的央行檢視逐步趨近 m.targetRate
    // 九期：物價不再「每次景氣換檔就跳一次」，改為每 inflationTurns 輪（預設 12 輪＝一年）調一次
    // §2.2 C：企業景氣係數——每筆 BUSINESS 依新階段重算月收入，post 差額（無漂移）
    var mFrom=E.bizMult(S,from), mTo=E.bizMult(S,to);
    S.players.forEach(function(p){
      if(p.bankrupt) return;
      p.assets.forEach(function(a){
        if(a.kind!=="BUSINESS") return;
        if(a.baseMonthlyIncome===undefined) a.baseMonthlyIncome=util.r2((a.monthlyIncome||0)/mFrom); // 舊資產：以 from 階段還原
        var ni=util.r2(a.baseMonthlyIncome*mTo), d=util.r2(ni-(a.monthlyIncome||0));
        if(!d) return;
        a.monthlyIncome=ni;
        ledger.post(S,p,"景氣調整："+a.name,
          [{account:"INCOME_PASSIVE",delta:d,refId:a.instanceId,label:a.name+" 景氣調整"}],{eduTags:["cashflow"]});
        E.ev("BIZ_CYCLE_ADJ",{playerId:p.id, assetId:a.instanceId, assetName:a.name, delta:d, from:from, to:to});
      });
    });
    E.startupWinter(S, to);        // S7b：寒冬裡先死的是還沒有現金流的公司
    E.ev("MACRO_TRANSITION",{from:from,to:to});
    M.onMacroTransition(S,from,to);
    if(util.rand(S) < S.config.policyEventProb){
      // S23a：台灣真實案例事件（博達、太電、解盲、雙卡）一局各只來一次——
      // 同一局連炸兩次同一件事既不真實，也會把股市打到與平衡設計無關的地方。
      var card=E.drawCard(S,"MACRO_EVENT",function(c){
        if(c.oncePerGame && S.macroDone && S.macroDone[c.id]) return false;
        return !c.stages || c.stages.indexOf(to)>=0; });
      if(card){
        if(card.oncePerGame){ S.macroDone=S.macroDone||{}; S.macroDone[card.id]=1; }
        // S13.1 NEW-02：總體事件依定義就是全體事件。內容若漏標 target，
        // applyEffects 會退化成 targets=[p]（＝players[0]），變成只有一號座位吃到景氣紅利。
        // 這裡把玩家級的 op 強制視為 all；不改動原始卡物件（避免污染 ns.content.byId）。
        E.applyEffects(S, S.players[0], E.macroEffects(card), card.title);
        E.ev("POLICY_EVENT",{cardId:card.id, title:card.title, disaster:!!card.disaster}); }
    }
  }
};

/* --------- M6 品格帳本（內容驅動，僅需登錄以載入牌堆） --------- */
M.registry.M6 = {};

/* --------- M8 學習與準備（S1 骨架） --------- */
// 學費計價：被動（抽到卡）享折扣，主動（自己找）全額
// M8 S3：底子還在——已過時的技能重學，學費與時間都打折
E.skillIsRefresh = function(p, card){
  return !!(p && card && p.skills && p.skills[card.id] && p.skills[card.id].decayed);
};
E.skillPrice = function(S, card, passive, p){
  if(!card) return 0;
  var disc = E.cfg(S,"skillPassiveDiscount");
  if(disc===undefined) disc = 0.7;
  var v = (card.cost||0) * (passive ? disc : 1);
  if(E.skillIsRefresh(p, card)){
    var rf = E.cfg(S,"skillRefreshCostPct"); if(rf===undefined) rf = 0.5;
    v = v * rf;
  }
  return util.r2(v);
};
// 學習所需輪數（不含主動進修的額外輪數）
E.skillTurns = function(S, p, card){
  var t = (card && card.turns) || 1;
  if(E.skillIsRefresh(p, card)){
    var rt = E.cfg(S,"skillRefreshTurnPct"); if(rt===undefined) rt = 0.5;
    t = Math.max(1, Math.ceil(t * rt));
  }
  return t;
};

// 完成一項學習後的休息輪數
E.skillCooldown = function(S, card){
  var k = (card && card.tier==="SMALL") ? "skillCooldownSmall"
        : (card && card.tier==="LARGE") ? "skillCooldownLarge" : "skillCooldownMid";
  var v = E.cfg(S,k);
  return (v===undefined) ? 2 : v;
};

// 是否持有可用技能（過時的不算）。requires 支援 "family:XXX" 家族比對。
E.hasSkill = function(p, req){
  if(!req || !p || !p.skills) return false;
  if(req.indexOf("family:")===0){
    var fam = req.slice(7), okF = false;
    Object.keys(p.skills).forEach(function(sid){
      if(p.skills[sid].decayed) return;
      var c = ns.content.byId[sid];
      if(c && c.family===fam) okF = true;
    });
    return okF;
  }
  var s = p.skills[req];
  return !!(s && !s.decayed);
};

// 開始學習（被動抽卡與主動進修共用）
// EXPENSE 語意：每月學費在此 +rm 一次，學成/放棄時 −rm 沖回。
// 絕不可在 onPayday 每輪重複 post，那會讓支出水位疊加且永不歸還。
E.startLearning = function(S, p, card, passive){
  if(!card) return;
  // 時間只有一份：開始學習就等於放掉正在經營的內容（爬坡會停在原地，起飛的會開始衰減）
  if(p.tending){
    E.ev("DIGITAL_PAUSED",{playerId:p.id, digitalId:p.tending, why:"開始學習"});
    p.tending = null;
  }
  var isRefresh = E.skillIsRefresh(p, card);
  var price = E.skillPrice(S, card, passive, p);
  var extra = 0;
  if(!passive){ extra = E.cfg(S,"skillActiveExtraTurns"); if(extra===undefined) extra = 1; }
  var post = [];
  if(price > 0) post.push({account:"CASH", delta:-price, label:"學費："+card.title});
  var rm = (card.recurringMonthly||0);
  if(rm > 0) post.push({account:"EXPENSE", delta:util.r2(rm), label:card.title+"（每月學費）"});
  if(post.length) ledger.post(S,p,"開始學習："+card.title,post,{eduTags:["learning"]});
  p.stats.skillSpendTotal = util.r2((p.stats.skillSpendTotal||0) + price);
  p.learning = { skillId:card.id, startTurn:S.turnNumber,
                 endTurn:S.turnNumber + E.skillTurns(S, p, card) + extra,
                 paidCost:price, interrupted:0, refresh:isRefresh };
  E.ev("SKILL_STARTED",{ playerId:p.id, skillId:card.id, title:card.title,
                         price:price, endTurn:p.learning.endTurn, passive:!!passive });
  if(p.cash < 0) E.enterBankruptcy(S,p);
};

// 每次發薪檢查學習是否完成（每月學費不在此入帳，見上方註解）
E.tickLearning = function(S, p){
  var L = p.learning;
  if(!L) return;
  var card = ns.content.byId[L.skillId];
  if(!card){ p.learning = null; return; }        // 防禦：內容缺失不得炸
  if(S.turnNumber < L.endTurn) return;           // 還沒學完

  var rm = (card.recurringMonthly||0);
  if(rm > 0){
    ledger.post(S,p,"進修結束："+card.title,
      [{account:"EXPENSE", delta:util.r2(-rm), label:card.title+" 月費終止"}],
      {eduTags:["learning"]});
  }
  p.skills[L.skillId] = { learnedAt:S.turnNumber, decayed:false,
                          refreshedAt: L.refresh ? S.turnNumber : null };
  if(L.skillId==="SKL_CARPENTRY") E.applyCarpentry(S,p);   // 學成當下，手上的房子就受惠
  p.stats.skillsLearned = (p.stats.skillsLearned||0) + 1;
  p.skillCooldownUntil = S.turnNumber + E.skillCooldown(S, card);
  p.learning = null;
  E.ev("SKILL_COMPLETED",{ playerId:p.id, skillId:card.id, title:card.title });
  // 第二專長學成 → 轉職或兼副業，二選一（做了選擇就承擔後果）
  if(card.secondCareer) E.pushDecision(S,p,{ kind:"SECOND_CAREER", cardId:card.id });
};

/* ===================== S5：數位資產（第四類資產） =====================
   與既有三類的差異：用時間造、有爬坡期、成敗不確定、停更會衰減。
   刻意不放進 p.assets——爬坡期沒有穩定收入，混進去會污染自由度計算；
   起飛後才鏡射一筆到 p.assets，讓 passiveIncome 吃得到。            */

E.digitalIncomeMult = function(S){
  var m=E.cfg(S,"digitalIncomeMult");
  return (isFinite(m) && m>0) ? m : 1;
};
E.digitalLiveCount = function(p){
  return (p.digitalAssets||[]).filter(function(d){ return !d.dead; }).length;
};
E.digitalSlots = function(S){
  var n=E.cfg(S,"digitalConcurrent");
  return (isFinite(n) && n>0) ? n : 1;
};
E.digitalOn = function(S){
  if(S.enabledModules.indexOf("M8")<0) return false;
  var n=E.cfg(S,"digitalPerGame"); if(n===undefined) n=3;
  return n>0;
};

// 開始經營：扣建置成本、每月維護費進支出水位、佔用「經營中」的時間槽
// S9：有沒有那門手藝，決定「爬多久」與「紅得起來的機率」，但不決定「能不能做」
E.digitalPro = function(S, p, card){
  if(E.hasSkill(p, "SKL_AI_ARCH")) return true;   // S22：AI 系統架構——任何數位資產都算「有手藝」
  return !!(card && card.requires && E.hasSkill(p, card.requires));
};
// 回傳這張卡對這個玩家的實際參數（UI 的對照表與引擎共用同一份計算，才不會對不上）
E.digitalOdds = function(S, p, card){
  var pl=(card&&card.payload)||{};
  var base=Math.max(1, pl.threshold||4);
  var pro=E.digitalPro(S,p,card);
  var dPro=E.cfg(S,"digitalProThresholdDelta");     if(dPro===undefined) dPro=-1;
  var dAm =E.cfg(S,"digitalAmateurThresholdDelta"); if(dAm===undefined)  dAm=2;
  var flopP=E.cfg(S,"digitalFlopPct");         if(flopP===undefined) flopP=0.45;
  var hitP =E.cfg(S,"digitalHitPct");          if(hitP===undefined)  hitP=0.15;
  var flopA=E.cfg(S,"digitalAmateurFlopPct");  if(flopA===undefined) flopA=0.6;
  var hitA =E.cfg(S,"digitalAmateurHitPct");   if(hitA===undefined)  hitA=0.05;
  return { pro:pro,
           threshold: Math.max(1, base + (pro?dPro:dAm)),
           flop: pro?flopP:flopA,
           hit:  pro?hitP:hitA,
           proThreshold: Math.max(1, base+dPro), amateurThreshold: Math.max(1, base+dAm),
           proFlop:flopP, proHit:hitP, amateurFlop:flopA, amateurHit:hitA };
};

E.startDigital = function(S, p, card){
  var pl=card.payload||{};
  var cost=util.r2(pl.cost||0), mc=util.r2(pl.monthlyCost||0);
  var post=[];
  if(cost>0) post.push({account:"CASH", delta:-cost, label:"建置："+card.title});
  if(mc>0)   post.push({account:"EXPENSE", delta:mc, label:card.title+"（每月維護）"});
  if(post.length) ledger.post(S,p,"開始經營："+card.title,post,{eduTags:["digital"]});
  var odds=E.digitalOdds(S,p,card);
  var d={ id:util.uid(S,"D"), cardId:card.id, name:card.title,
          progress:0, threshold:odds.threshold,
          pro:odds.pro, flopPct:odds.flop, hitPct:odds.hit,
          tier:null, baseIncome:util.r2((pl.baseIncome||0)*E.digitalIncomeMult(S)), monthlyCost:mc,
          takeoffIncome:0, monthlyIncome:0, startedAt:S.turnNumber,
          lastTendTurn:S.turnNumber, assetInstanceId:null, dead:false };
  p.digitalAssets.push(d);
  // S13：可以同時開好幾攤（digitalConcurrent），但「顧」還是一次只能顧一個。
  // 放寬的是「開得了幾攤」，不是「不用顧」——顧不到的照樣爬不動、照樣衰減。
  p.tending = d.id;
  p.stats.digitalStarted=(p.stats.digitalStarted||0)+1;
  if(odds.pro) p.stats.digitalPro=(p.stats.digitalPro||0)+1;
  else         p.stats.digitalAmateur=(p.stats.digitalAmateur||0)+1;
  E.ev("DIGITAL_STARTED",{playerId:p.id, id:d.id, cardId:card.id, title:card.title,
                          cost:cost, threshold:d.threshold, pro:!!odds.pro});
  if(p.cash<0) E.enterBankruptcy(S,p);
};

// 把起飛後的收入鏡射進 p.assets（讓自由度計算吃得到），或同步/移除
E.syncDigitalAsset = function(S, p, d){
  var cur = d.assetInstanceId
    ? p.assets.filter(function(a){ return a.instanceId===d.assetInstanceId; })[0] : null;
  var inc = util.r2(d.monthlyIncome||0);
  if(inc<=0){
    if(cur){
      p.assets = p.assets.filter(function(a){ return a.instanceId!==cur.instanceId; });
      ledger.post(S,p,"數位資產歸零："+d.name,
        [{account:"INCOME_PASSIVE",delta:util.r2(-(cur.monthlyIncome||0)),refId:cur.instanceId,label:d.name+" 收入停止"},
         {account:"ASSET",delta:util.r2(-(cur.marketValue||0)),refId:cur.instanceId,label:d.name}],
        {eduTags:["digital"]});
      d.assetInstanceId=null;
    }
    return;
  }
  var mv = util.r2(inc*12);               // 估值＝年收入（數位資產沒有二手市場，僅供淨值呈現）
  if(!cur){
    var id=util.uid(S,"A");
    p.assets.push({ instanceId:id, cardId:d.cardId, kind:"DIGITAL", name:d.name, units:1,
      costBasis:0, marketValue:mv, monthlyIncome:inc, linkedLiabilityId:null, flags:{digital:d.id} });
    ledger.post(S,p,"數位資產起飛："+d.name,
      [{account:"ASSET",delta:mv,refId:id,label:d.name},
       {account:"INCOME_PASSIVE",delta:inc,refId:id,label:d.name+" 長尾收入"}],
      {eduTags:["digital","passive-income"]});
    d.assetInstanceId=id;
    return;
  }
  var dInc=util.r2(inc-(cur.monthlyIncome||0)), dMv=util.r2(mv-(cur.marketValue||0));
  if(dInc===0 && dMv===0) return;
  var post=[];
  if(dMv!==0)  post.push({account:"ASSET",delta:dMv,refId:cur.instanceId,label:d.name});
  if(dInc!==0) post.push({account:"INCOME_PASSIVE",delta:dInc,refId:cur.instanceId,label:d.name+" 收入調整"});
  cur.monthlyIncome=inc; cur.marketValue=mv;
  if(post.length) ledger.post(S,p,(dInc<0?"數位資產衰減：":"數位資產回升：")+d.name,post,{eduTags:["digital"]});
};

// 每次發薪推進一次：爬坡 → 起飛擲骰 → 停更衰減 / 重新經營回升
E.tickDigital = function(S, p){
  if(p.bankrupt) return;
  if(!E.digitalOn(S)) return;
  var list=p.digitalAssets||[];
  for(var i=0;i<list.length;i++){
    var d=list[i];
    if(!d || d.dead) continue;
    var tending = (p.tending===d.id);
    if(tending) d.lastTendTurn=S.turnNumber;

    if(d.tier===null){
      // 爬坡期：只有持續投入才會前進；停下來就原地不動（不倒退，但也不會自己長大）
      if(!tending) continue;
      d.progress++;
      if(d.progress < d.threshold){
        E.ev("DIGITAL_PROGRESS",{playerId:p.id, id:d.id, title:d.name,
                                 progress:d.progress, threshold:d.threshold});
        continue;
      }
      // 起飛擲骰：累積決定「會不會起來」，機率決定「起多高」
      // S9：機率取自這筆資產開張時鎖定的值（舊存檔沒有這兩欄 → 退回全域設定，行為與 S8 相同）
      var flop=isFinite(d.flopPct)? d.flopPct : E.cfg(S,"digitalFlopPct");
      if(flop===undefined || !isFinite(flop)) flop=0.45;
      var hit =isFinite(d.hitPct) ? d.hitPct  : E.cfg(S,"digitalHitPct");
      if(hit===undefined || !isFinite(hit))  hit=0.15;
      var fm=E.cfg(S,"digitalFlopMult"); if(fm===undefined) fm=0.3;
      var hm=E.cfg(S,"digitalHitMult");  if(hm===undefined) hm=3;
      var r=util.rand(S);                  // 會寫進狀態 → 用主流 RNG
      var tier, mult;
      if(r < flop){ tier="FLOP"; mult=fm; }
      else if(r < flop+Math.max(0,1-flop-hit)){ tier="OK"; mult=1; }
      else { tier="HIT"; mult=hm; }
      d.tier=tier;
      d.takeoffIncome=util.r2((d.baseIncome||0)*mult);
      d.monthlyIncome=d.takeoffIncome;
      p.stats.digitalTakeoff=(p.stats.digitalTakeoff||0)+1;
      p.stats["digital"+tier]=(p.stats["digital"+tier]||0)+1;
      E.syncDigitalAsset(S,p,d);
      E.pushDecision(S,p,{ kind:"DIGITAL_RESULT", digitalId:d.id, cardId:d.cardId,
                           tier:tier, income:d.monthlyIncome });
      E.ev("DIGITAL_TAKEOFF",{playerId:p.id, id:d.id, title:d.name, tier:tier,
                              income:d.monthlyIncome});
      continue;
    }

    // S12：外圈（已辭職圓夢）的數位資產不再衰減。
    // enterOuterCircle 的註解本來就寫著「長尾收入保留，這正是它與副業的差別」，
    // 但這裡照樣每輪 ×0.85 一路衰減到歸零——程式行為與自己的註解相反，這是缺陷。
    // 作品做出來就在那裡；停止投入的懲罰屬於還在內圈的人。
    if(p.playerStage==="OUTER" && d.tier!==null) continue;

    // 已起飛：停更衰減，重新經營則慢慢回升（回得來，但比當初慢得多）
    if(!tending){
      var dr=E.cfg(S,"digitalDecayRate"); if(dr===undefined) dr=0.85;
      var deadPct=E.cfg(S,"digitalDeadPct"); if(deadPct===undefined) deadPct=0.15;
      d.monthlyIncome=util.r2((d.monthlyIncome||0)*dr);
      if(d.monthlyIncome <= util.r2((d.takeoffIncome||0)*deadPct)){
        d.monthlyIncome=0; d.dead=true;
        E.syncDigitalAsset(S,p,d);
        // 停更也要停維護費，否則會留下一筆孤兒支出
        if(d.monthlyCost>0) ledger.post(S,p,"停止經營："+d.name,
          [{account:"EXPENSE",delta:util.r2(-d.monthlyCost),label:d.name+" 維護費終止"}],
          {eduTags:["digital"]});
        p.stats.digitalDead=(p.stats.digitalDead||0)+1;
        E.ev("DIGITAL_DEAD",{playerId:p.id, id:d.id, title:d.name});
      } else {
        E.syncDigitalAsset(S,p,d);
        E.ev("DIGITAL_DECAY",{playerId:p.id, id:d.id, title:d.name, income:d.monthlyIncome});
      }
    } else if(d.monthlyIncome < d.takeoffIncome){
      var rr=E.cfg(S,"digitalRecoverRate"); if(rr===undefined) rr=1.06;
      d.monthlyIncome=util.r2(Math.min(d.takeoffIncome, (d.monthlyIncome||0)*rr));
      E.syncDigitalAsset(S,p,d);
    }
  }
};

// 收掉一個數位資產（辭職圓夢、主動關閉）
E.dropDigital = function(S, p, d, why){
  if(!d || d.dead) return;
  d.dead=true; d.monthlyIncome=0;
  E.syncDigitalAsset(S,p,d);
  if(d.monthlyCost>0) ledger.post(S,p,"收掉數位資產："+d.name+"（"+why+"）",
    [{account:"EXPENSE",delta:util.r2(-d.monthlyCost),label:d.name+" 維護費終止"}],
    {eduTags:["digital"]});
  if(p.tending===d.id) p.tending=null;
  E.ev("DIGITAL_CLOSED",{playerId:p.id, id:d.id, title:d.name, why:why});
};

M.registry.M8 = {
  onPayday: function(S, p){
    if(p.bankrupt) return;
    E.tickLearning(S, p);                      // 學習進度
    if(E.tickDigital) E.tickDigital(S, p);     // 數位資產（S4 才實作，此處防呆）
  }
};

/* --------- M9 進階金融（S23b：期貨；S23c 再加虛擬貨幣） ---------
   獨立成模組而不是掛在 M1 底下，是因為後面還要放匯率、債券這些同一層的東西；
   而且教學局與新手／標準難度要能整包關掉，鐵律 4 的基線比對才守得住。      */
M.registry.M9 = {
  /* S23c：迷因幣的開盤價、名稱、歷史與幣圈起始狀態都在這裡建。
     刻意不放進 E.newGame 的開盤價迴圈——那個迴圈每檔消耗一次亂數，
     多一檔就會把所有非 M9 局的亂數序列整個推移（鐵律 4 當場斷）。 */
  onGameSetup:function(S){
    var defs = E.cryptoDefs(S); if(!defs.length) return;
    S.cryptoCycle = "RANGE";                       // 每局都從盤整開始（不抽，省一次亂數）
    var spread = E.cfg(S,"stockOpenSpread"); if(!isFinite(spread)||spread<0) spread=0;
    defs.forEach(function(d){
      var px = d.face;
      if(spread>0) px = E.clampPrice(S, d, d.face*(1 + (util.rand(S)*2-1)*spread));
      S.stockPrices[d.symbol] = px;
      S.stockHistory[d.symbol] = [px];
      S.stockNames[d.symbol] = d.name;             // 幣不換名：名字本身就是它的迷因
    });
  },
  onRoundEnd:function(S){
    E.tickHoldTurns(S);        // 解鎖進度：任一檔股票累計持有幾輪
    E.tickFutures(S);          // 期貨逐輪結算（在 M1 更新完股價之後——M9 排在 order 最後）
    // S23c：幣圈循環 → 幣價 → 重評價 → 歸零判定，順序與 M1 對股票做的完全一致
    E.tickCryptoCycle(S);
    E.tickCryptoPrice(S);
    if(E.cryptoDefs(S).length){
      E.revalueStocks(S);
      E.tickDelist(S, E.cryptoDefs(S));
    }
  }
};

/* ================================ NPC =================================== */
var npc = ns.npc = {};

npc.canBuyMall = function(S, p, it){
  if(!it || it.kind!=="MALL") return false;
  if(S.phase!=="ROLL" && S.phase!=="READY_END") return false;
  if(p.bankrupt) return false;
  var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
  if(per<=0 || (p.mallBoughtThisTurn||0)>=per) return false;
  if(it.oncePerGame && p.mallBought && p.mallBought[it.id]) return false;
  if(E.mallStillActive(S,p,it)) return false;
  if(E.mallCooldownLeft(S,p,it)>0) return false;
  if(!E.mallAffordable(S,p,it)) return false;
  if(it.payload && it.payload.reqChild && !(p.childrenCount>0)) return false;
  if(it.payload && it.payload.insurance && p.flags && p.flags.insured) return false;
  if(it.payload && it.payload.propertyInsurance && p.flags && p.flags.propInsured) return false;
  return true;
};

npc._rawNextAction = function(S){
  var p=E.activePlayer(S); if(!p.isNPC) return null;
  var d=S.pendingDecision;
  if(d){
    if(d.kind==="CHOOSE_DECK"){
      var w=ns.content.personalityById[p.npcPersonality].weights;
      // 有人脈又有錢就先看特殊機會——那是花大錢買來的入場券，沒理由不用
      if(E.hasNetwork(S,p) && p.cash > 4000 && (ns.content.cards.OPPORTUNITY_SPECIAL||[]).length)
        return { type:"CHOOSE_DECK", playerId:p.id, payload:{ deckId:"OPPORTUNITY_SPECIAL" } };
      var big = p.cash > 2500 && w.cashflowPerCost>0.7;
      return { type:"CHOOSE_DECK", playerId:p.id, payload:{ deckId: big?"OPPORTUNITY_LARGE":"OPPORTUNITY_SMALL" } };
    }
    return npc.decide(S,p,d);
  }
  if(S.phase==="BANKRUPTCY") return { type:"DECIDE", playerId:p.id, payload:{decisionId:"?", optionId:"declare"} };
  if(S.phase==="ROLL") return { type:"ROLL_DICE", playerId:p.id, payload:null };
  // v0.2：購點改由落地後的 BUY_PROGRESS 決策統一處理（npc.decide）
  // M7：評級 C 的槓桿型 NPC 優先還款去槓桿（放寬還款門檻），直到回 B
  if(S.phase==="READY_END"){
    // S5：時間槽空著就先去顧內容——爬坡中的東西停下來就永遠不會起飛
    var td = npc.digitalToTend(S,p);
    if(td) return td;
    var sl = npc.skillToLearn(S,p);      // M8:先看要不要進修（時間是最稀缺的資源）
    if(sl) return sl;
    var nc = npc.networkCourse(S,p);     // S4:再看買不買得起那張入場券
    if(nc) return nc;
    var ps = npc.protectSelf(S,p);       // S4:保險與健康——先把尾端風險換掉
    if(ps) return ps;
    var st = npc.stockTrade(S,p);        // S8:股票（停利優先於買進）
    if(st) return st;
    var mb = npc.mallForWellbeing(S,p);
    if(mb) return mb;
    var dl = npc.deleverage(S,p);
    if(dl) return dl;
    return { type:"END_TURN", playerId:p.id, payload:null };
  }
  return null;
};

/* S22：S21 原版在這裡把每個動作先 E.apply(…,{mutate:false}) 乾跑一次，等於每一步都
   structuredClone 整個局面——模擬器從 58ms/局 變成 3,465ms/局（慢 60 倍），1000 局閘門要跑一小時。
   死結的真正修法是 npc.canBuyMall 那組前置檢查（上面），加上介面層 mpSend 被拒時自動補 END_TURN；
   拿掉乾跑後 300 局 0 死結、每局回合數與乾跑版完全一致。 */
npc.nextAction = npc._rawNextAction;

// V11：幸福感是獲勝條件之一 —— NPC 在夢想接近完成、但幸福感不足時，
// 會去商城買「人情品格」類（便宜、確定性效果，不含擲骰與薪資機率），與人類玩家同一套規則。
// M8:NPC 主動進修——決定論評估,不使用 RNG(避免污染主流序列)
// 人生卡的「損益概估」——純函式、不用 RNG，只給 NPC 二選一用。
// 刻意粗略：這是「哪個比較不痛」的判斷，不是估值模型。
E.lifeCardScore = function(S, p, card){
  var rate = S.config.eventCardRate;
  var exp = Math.max(1, p.derived.totalExpenses);
  function sc(effs){
    var v=0;
    (effs||[]).forEach(function(ef){
      switch(ef.op){
        case "CASH_DELTA": { var a=ef.amount||0; v += a * (a<0 ? rate : 1); break; }
        case "ADD_RECURRING_EXPENSE": v -= (ef.amount||0) * (ef.durationTurns||6); break;
        case "SKIP_TURNS": v -= (ef.turns||1) * exp; break;
        case "ADD_CHILD": v -= exp; break;
        case "SALARY_MULT": v += ((ef.factor||1)-1) * p.derived.salaryIncome * (ef.durationTurns||4); break;
        case "ASSET_INCOME_MULT": v += ((ef.factor||1)-1) * p.derived.passiveIncome * (ef.durationTurns||4); break;
        case "GRANT_JOY": v += (ef.amount||1) * 2; break;
        case "GRANT_VIRTUE": v += (ef.delta||0) * 2; break;
        case "DELAY_LEARNING": v -= exp; break;
        case "DECAY_SKILL": v -= exp * 2; break;
        case "GRANT_SKILL": v += exp * 2; break;
      }
    });
    return v;
  }
  if(card.kind==="SKILL_GATE" && card.skillBranch){
    var b=card.skillBranch;
    var br = E.hasSkill(p, b.requires) ? b.have : b.miss;
    return sc(br && br.effects);
  }
  if(card.kind==="SKILL") return -E.skillPrice(S, card, true, p);   // 學費是成本，機會本身中性
  return sc(card.effects);
};

// 時間槽該給誰：爬坡中的優先（停下來就不會起飛），其次是衰減中的（止血）。
// 決定論：以 id 穩定排序，不使用 RNG。
npc.digitalToTend = function(S,p){
  if(!E.digitalOn(S)) return null;
  if(p.bankrupt || p.learning) return null;
  if(p.playerStage!=="INNER") return null;
  var live=(p.digitalAssets||[]).filter(function(d){ return !d.dead; });
  if(!live.length) return null;
  if(p.tending && live.some(function(d){ return d.id===p.tending; })) return null;  // 已經在顧了
  var climbing=live.filter(function(d){ return d.tier===null; })
                   .sort(function(a,b){ return (b.progress-a.progress) || (a.id<b.id?-1:1); });
  var decaying=live.filter(function(d){ return d.tier!==null && d.monthlyIncome<d.takeoffIncome; })
                   .sort(function(a,b){ return (b.monthlyIncome-a.monthlyIncome) || (a.id<b.id?-1:1); });
  var pick=climbing[0]||decaying[0];
  if(!pick) return null;
  return { type:"TEND_DIGITAL", playerId:p.id, payload:{ digitalId: pick.id } };
};

npc.skillToLearn = function(S,p){
  if(S.enabledModules.indexOf("M8")<0) return null;
  var n = E.cfg(S,"skillPerGame"); if(n===undefined) n=12;
  if(n<=0) return null;
  if(p.bankrupt || p.learning) return null;
  if(S.turnNumber < (p.skillCooldownUntil||0)) return null;
  if(p.playerStage!=="INNER") return null;              // 外圈專心圓夢，不再進修
  // 正在把一個內容推上坡時，不為了學新技能把它丟下（丟下就前功盡棄）
  if(p.tending){
    var td0=(p.digitalAssets||[]).filter(function(x){ return x.id===p.tending; })[0];
    if(td0 && !td0.dead && td0.tier===null) return null;
  }
  var cap = E.cfg(S,"npcSkillCap"); if(cap===undefined) cap = 3;
  // M8 S3：只算「還有效」的技能——已過時的不該永久佔住名額，
  // 否則電腦玩家一旦被產業變革掃到，就再也不會回頭去進修更新。
  var effN = Object.keys(p.skills||{}).filter(function(sid){ return !p.skills[sid].decayed; }).length;
  if(effN >= cap) return null;
  var w = ns.content.personalityById[p.npcPersonality].weights;
  var floor = (w.cashReserveFloor||3) * Math.max(1, p.derived.totalExpenses);
  var pool = (S.skillSample||[]).map(function(id){ return ns.content.byId[id]; })
    .filter(function(sc){
      if(!sc || sc.kind!=="SKILL") return false;
      if(p.skills[sc.id] && !p.skills[sc.id].decayed) return false;
      return p.cash - E.skillPrice(S,sc,false,p) >= floor;   // 不動用保留水位
    })
    .sort(function(a,b){
      var ca=(a.cost||0), cb=(b.cost||0);
      if(ca!==cb) return ca-cb;                            // 先學便宜的
      var ta=(a.turns||0), tb=(b.turns||0);
      if(ta!==tb) return ta-tb;                            // 同價先學快的
      return a.id<b.id?-1:1;                               // 決定論穩定排序
    });
  if(!pool.length) return null;
  return { type:"START_SKILL", playerId:p.id, payload:{ skillId: pool[0].id } };
};

// 高階課程（海外留學／EMBA）：現金遠超過保留水位時才考慮——這是重押，不是零用錢
npc.networkCourse = function(S,p){
  if(!E.cfg(S,"specialOppEnabled")) return null;
  if(p.bankrupt || p.playerStage!=="INNER") return null;
  if(p.flags && p.flags.network) return null;
  var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
  if(per<=0 || (p.mallBoughtThisTurn||0)>=per) return null;
  var w=ns.content.personalityById[p.npcPersonality].weights;
  var floor=(w.cashReserveFloor||3)*Math.max(1,p.derived.totalExpenses);
  // 「已經站穩」才值得投資人脈：被動收入已能覆蓋四成支出。
  // （用 oppCompare.entry 當門檻是錯的——那是不計貸款的全額，NPC 的現金高水位永遠到不了。）
  if(p.derived.passiveIncome < p.derived.totalExpenses*0.4) return null;
  var pool=(ns.content.cards.MALL||[]).filter(function(it){
    var pl=it.payload||{};
    if(!pl.network) return false;
    if(!npc.canBuyMall(S,p,it)) return false;
    return p.cash - E.mallCost(S,it,p) - (pl.annualPremium||0) >= floor;
  }).sort(function(a,b){
    var ca=E.mallCost(S,a,p), cb=E.mallCost(S,b,p);
    if(ca!==cb) return ca-cb;                 // 先買便宜的那張入場券
    return a.id<b.id?-1:1;                    // 決定論穩定排序
  });
  if(!pool.length) return null;
  return { type:"MALL_BUY", playerId:p.id, payload:{ itemId: pool[0].id } };
};

// 保險與健康：現金遠高於保留水位時才買——這是「用小錢換掉尾端風險」，不是有錢就亂花。
// 同時這也讓模擬真的走得到產險理賠、年約到期詢問這些路徑（否則等於沒被測到）。
npc.protectSelf = function(S,p){
  if(!E.cfg(S,"npcProtection")) return null;    // 關掉即回到 S3b 之前的 NPC 行為
  if(p.bankrupt || p.playerStage!=="INNER") return null;
  var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
  if(per<=0 || (p.mallBoughtThisTurn||0)>=per) return null;
  var wP=ns.content.personalityById[p.npcPersonality].weights;
  var floorP=(wP.cashReserveFloor||3)*Math.max(1,p.derived.totalExpenses);
  var hasRE=p.assets.some(function(a){ return a.kind==="REALESTATE"; });
  // 有餘裕＝被動收入已能覆蓋支出。保險是風險移轉（站穩前就該有），
  // 健身房與健檢是消費（有餘裕才買）——這個分野本身就是要教的事。
  var comfy = p.derived.passiveIncome >= p.derived.totalExpenses;
  // 風險偏好決定投保行為：保守型才買月繳醫療險（月費會永久壓在自由率的分母上），
  // 產險則是只要有房就該保（年繳、金額小、對應的是賠不起的損失）。
  var riskAverse = (wP.cashReserveFloor||3) >= 3;
  var want=[];
  (ns.content.cards.MALL||[]).forEach(function(it){
    if(!npc.canBuyMall(S,p,it)) return;
    var pl=it.payload||{};
    if(pl.insurance){ if(riskAverse && !(p.flags&&p.flags.insured)) want.push(it); return; }
    if(pl.propertyInsurance){ if(hasRE && !(p.flags&&p.flags.propInsured)) want.push(it); return; }
    if(pl.flag && comfy){ if(!E.mallStillActive(S,p,it)) want.push(it); return; }
  });
  want = want.filter(function(it){
    var pl=it.payload||{};
    // 月費會永久壓在自由率的分母上：買了會讓自己跨不過自由門檻的，就不買。
    // （原本用 passive>=expenses 當「有餘裕」的判準是個陷阱——那正好就是自由門檻本身，
    //   一買下去的月費馬上把自己踢回門檻以下。）
    var rmW = pl.recurringMonthly||0;
    if(rmW>0 && p.derived.passiveIncome < p.derived.totalExpenses + rmW) return false;
    return p.cash - E.mallCost(S,it,p) - (pl.annualPremium||0) >= floorP * 3;   // 要很有餘裕才買
  }).sort(function(a,b){
    var ca=E.mallCost(S,a,p), cb=E.mallCost(S,b,p);
    if(ca!==cb) return ca-cb;
    return a.id<b.id?-1:1;                        // 決定論穩定排序
  });
  if(!want.length) return null;
  return { type:"MALL_BUY", playerId:p.id, payload:{ itemId: want[0].id } };
};

// S8：電腦玩家買賣股票。
// 背景：股票卡在 v2.3.1 被移出機會牌堆後，股市只剩「股市面板」這個真人專屬入口，
// 電腦玩家從此一張股票都沒買過——M1 對他們形同虛設，所有平衡數據也只反映房產＋事業。
// 這裡補上決定論的買賣規則（不使用 RNG，性格決定偏好的風險等級）。
npc.stockTrade = function(S,p){
  if(S.enabledModules.indexOf("M1")<0) return null;
  if(!E.cfg(S,"npcTradesStocks")) return null;
  if(p.bankrupt || p.playerStage!=="INNER") return null;
  var w=ns.content.personalityById[p.npcPersonality].weights;
  var floor=(w.cashReserveFloor||3)*Math.max(1,p.derived.totalExpenses);

  // 1) 先看要不要停利——帳上的獲利不是你的錢，賣掉才是
  var tp=E.cfg(S,"npcTakeProfitPct"); if(!(tp>0)) tp=0.5;
  var win=p.assets.filter(function(a){
    return a.kind==="STOCK" && !(a.flags&&a.flags.margin) && a.costBasis>0
        && (a.marketValue-a.costBasis)/a.costBasis >= tp;
  }).sort(function(a,b){ return (b.marketValue-b.costBasis)-(a.marketValue-a.costBasis)
                              || (a.instanceId<b.instanceId?-1:1); });
  if(win.length) return { type:"TRADE_STOCK", playerId:p.id,
    payload:{ symbol:win[0].symbol, side:"sell", units:win[0].units } };

  // 2) 再看要不要買。性格決定偏好的風險等級：
  //    保守型挑波動最低的，投機型挑波動最高的（決定論，不用 RNG）
  var budgetPct=E.cfg(S,"npcStockBudgetPct"); if(!(budgetPct>0)) budgetPct=0.3;
  var spare=p.cash-floor;
  if(spare<=0) return null;
  var budget=util.r2(spare*budgetPct);
  var pool=ns.content.stockDefs.filter(function(d){
    if(S.delisted && S.delisted[d.symbol]) return false;
    if(S.delistWatch && S.delistWatch[d.symbol]) return false;   // 警示中的不接刀
    var pr=S.stockPrices[d.symbol];
    return isFinite(pr) && pr>0 && pr<=budget;
  }).sort(function(a,b){ return E.stockVol(S,a)-E.stockVol(S,b) || (a.symbol<b.symbol?-1:1); });   // S15b：同一入口
  if(!pool.length) return null;
  var appetite=w.capitalGainAppetite||0;
  var idx = appetite>=0.8 ? pool.length-1 : (appetite>=0.5 ? Math.floor((pool.length-1)/2) : 0);
  var pick=pool[idx];
  // 已經持有同一檔就不再加碼（避免整局都押同一張）
  if(p.assets.some(function(a){ return a.kind==="STOCK" && a.symbol===pick.symbol; })) return null;
  var units=Math.floor(budget/S.stockPrices[pick.symbol]);
  if(units<1) return null;
  return { type:"TRADE_STOCK", playerId:p.id,
           payload:{ symbol:pick.symbol, side:"buy", units:units, margin:false } };
};

npc.mallForWellbeing = function(S,p){
  var need=E.winWellbeingMin(S); if(need<=0) return null;
  var have=E.wellbeing(S,p); if(have>=need) return null;
  // 只有走到外圈（開始追夢）且夢想已過半才值得為幸福感花錢
  if(p.playerStage!=="OUTER") return null;
  if(p.dreamProgress < Math.ceil(S.config.dreamCost/2)) return null;
  var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
  if(per<=0 || (p.mallBoughtThisTurn||0)>=per) return null;
  var w=ns.content.personalityById[p.npcPersonality].weights;
  var floor=w.cashReserveFloor*p.derived.totalExpenses;
  var items=(ns.content.cards.MALL||[]).filter(function(it){
    if(it.group!=="人情品格") return false;
    var pl=it.payload||{};
    if((pl.joy||0)<=0) return false;
    if(!npc.canBuyMall(S,p,it)) return false;
    return p.cash-(pl.cost||0) >= floor;      // 不動用到保留水位以下
  }).sort(function(a,b){
    var ja=(a.payload.joy||0), jb=(b.payload.joy||0);
    if(jb!==ja) return jb-ja;                                    // 幸福感高的優先
    var ca=(a.payload.cost||0), cb=(b.payload.cost||0);
    if(ca!==cb) return ca-cb;                                    // 同幸福感取便宜的
    return a.id<b.id?-1:1;                                       // 決定論穩定排序
  });
  if(!items.length) return null;
  return { type:"MALL_BUY", playerId:p.id, payload:{ itemId: items[0].id } };
};

// 回傳一筆 REPAY_LOAN 動作或 null；每回合最多一筆，且不動用到保留水位以下
npc.deleverage = function(S,p){
  if(p.creditRating!=="C") return null;
  if(p.npcPersonality!=="NPC_LEVER" && p.npcPersonality!=="NPC_VC") return null;
  var w=ns.content.personalityById[p.npcPersonality].weights;
  // 去槓桿模式：保留水位放寬為平時的一半
  var floor = w.cashReserveFloor * p.derived.totalExpenses * 0.5;
  var spare = util.r2(p.cash - floor);
  if(spare < 1) return null;
  // 先還無擔保／只付息的高利率貸款
  var cand = p.liabilities.filter(function(l){ return l.principal>1 && !l.studentLoan; })
    .sort(function(a,b){
      var ka=(a.kind==="MARGIN"||a.kind==="CONSUMER"||a.kind==="CREDIT")?0:1;
      var kb=(b.kind==="MARGIN"||b.kind==="CONSUMER"||b.kind==="CREDIT")?0:1;
      if(ka!==kb) return ka-kb;
      if(b.annualRate!==a.annualRate) return b.annualRate-a.annualRate;
      return a.instanceId<b.instanceId?-1:1;   // 決定論穩定排序
    })[0];
  if(!cand) return null;
  var amt = util.r2(Math.min(spare, cand.principal));
  if(amt < 1) return null;
  return { type:"REPAY_LOAN", playerId:p.id, payload:{ liabilityId:cand.instanceId, amount:amt } };
};

npc.decide = function(S,p,d){
  var w=ns.content.personalityById[p.npcPersonality].weights;
  var A=function(opt,params){ return { type:"DECIDE", playerId:p.id,
    payload:{ decisionId:d.decisionId, optionId:opt, params:params||{} } }; };
  switch(d.kind){
    // S21/S22：獨立董事——收到審計警訊一律跳船（決定論基準行為）；
    // 邀請則看性格：保守派接 A（穩領六輪）、槓桿派接 B、創投派敢接 C。
    case "RESIGN_DIRECTORSHIP": return A("resign");
    case "APPOINT_DIRECTOR": {
      var ap=w.capitalGainAppetite||0;
      return A("appoint", { company: ap>=1 ? "C" : (ap>=0.5 ? "B" : "A") });
    }
    case "ACK": case "TRIAL_RESULT": case "BLESSING": case "SKILL_RESULT": return A("ok");   // 盲盒自動開盒

    // M8 S1：NPC 學習判斷——決定論評估（付得起且現金留有水位），刻意不使用 RNG
    case "LEARN_SKILL": {
      var skC = ns.content.byId[d.cardId];
      if(!skC) return A("skip");
      if(p.learning) return A("skip");
      if(S.turnNumber < (p.skillCooldownUntil||0)) return A("skip");
      if(p.skills[skC.id] && !p.skills[skC.id].decayed) return A("skip");
      var priceC = E.skillPrice(S,skC,true);
      var floorS = (w.cashReserveFloor||3) * Math.max(1, p.derived.totalExpenses);
      if(p.cash - priceC < floorS) return A("skip");
      return A("learn"); }
    case "CONTEST_ROLL": return A("roll");   // V3：比賽擲骰（NPC 或離席代打直接擲）
    case "LIFESTYLE": {
      var lc=ns.content.byId[d.cardId], lcost=(lc&&lc.payload&&lc.payload.cost)||0;
      // v0.2：買不起不硬買（現金付完至少留半個月支出）；誘惑失足由人格機率決定
      var canPay = p.cash-lcost >= 0.5*p.derived.totalExpenses;
      return A((canPay && util.randAux(S)<w.optionalLifestyleBuyProb) ? "buy" : "skip"); }
    case "CULTIVATE": {
      var c=ns.content.byId[d.cardId], cost=(c.payload&&c.payload.cost)||0;
      var afford = p.cash-cost > w.cashReserveFloor*p.derived.totalExpenses*0.5;
      return A((afford && util.randAux(S)<w.cultivateVirtueProb) ? "invest" : "skip"); }
    case "PROFESSION_EVENT": {
      var pc=ns.content.byId[d.cardId];
      var wantExam = pc.id==="PE_CPA_EXAM" && p.cash>200;
      return A(wantExam?0:1); }
    case "SELF_INVEST": {
      var sc=ns.content.byId[d.cardId], op0=sc.decision.options[0], cost=op0.cost||0;
      var boostsSalary = op0.effects.some(function(e){return e.op==="SALARY_MULT";});
      var afford = p.cash-cost > w.cashReserveFloor*p.derived.totalExpenses;
      // 薪資提升長期划算，多數性格願投資；降支出型也划算
      return A(afford ? 0 : 1); }
    case "CHOICE": {
      var ch=ns.content.byId[d.cardId], o0=ch.decision.options[0], c0=o0.cost||0;
      var cheapest=0, cheapCost=1e9;
      ch.decision.options.forEach(function(op,i){ var c=op.cost||0; if(c<cheapCost){cheapCost=c;cheapest=i;} });
      var okFirst = p.cash-c0 > w.cashReserveFloor*p.derived.totalExpenses;
      return A(okFirst ? 0 : cheapest); }
    case "FOLLOW_ON":
      return A((w.startupAppetite>0.5 && p.cash>d.invest*1.5) ? "follow" : "pass");
    case "GRADUATE": return A("go");
    case "BUY_PROGRESS": {
      // v0.2：現金底線之上才買（npcCashFloorOuter × 月支出）
      var floorO=(E.cfg(S,"npcCashFloorOuter")!==undefined?E.cfg(S,"npcCashFloorOuter"):3)*p.derived.totalExpenses;
      return A((p.cash-(d.price||0) >= floorO) ? "buy" : "skip"); }
    case "BANKRUPTCY": return A("declare");
    case "FREEFALL_RESCUE": return A("fall");   // 防禦：NPC 危機已在引擎側自動處理，不應到這
    case "BUY": return npc.scoreBuy(S,p,d,w,A);
    // S7b：下市警示——電腦玩家一律停損（決定論）。
    // 這不是最佳解，而是「看到警示就處理」的基準行為，讓真人有得比較。
    /* S7b／S23a：下市警示——電腦玩家的基準行為。
       固定模式（必倒）一律停損；機率模式看風險等級：中以上一律賣，
       低風險只有保守派會賣（其餘性格願意賭它撐過去）。這不是最佳解，
       而是讓真人有得比較的一條基準線。 */
    /* S23b：電腦玩家不主動碰進階金融（Brian 定案：先不碰，指紋最乾淨）。
       但萬一有部位（例如未來開放後的存檔），追繳一律當場平倉——不賭。 */
    case "FUT_MARGIN_CALL": return A("close");
    case "DELIST_WARN": {
      var lvlW = d.level;
      if(!lvlW) return A("sell");
      if(lvlW==="低" && (w.cashReserveFloor||3) < 4) return A("keep");
      return A("sell"); }

    // 數位資產：付得起、且時間槽空著就做——這是把時間換成長尾的唯一途徑
    case "START_DIGITAL": {
      var dgN=ns.content.byId[d.cardId];
      if(!dgN || p.learning) return A("skip");
      var cN=util.r2((dgN.payload||{}).cost||0);
      var floorD=(w.cashReserveFloor||3)*Math.max(1,p.derived.totalExpenses);
      if(p.cash - cN < floorD) return A("skip");
      return A("start"); }

    case "DIGITAL_RESULT": return A("ok");

    // 年約到期：留得住保留水位才續約（決定論）
    case "RENEW_MALL": {
      var itN = ns.content.byId[d.itemId];
      if(!itN) return A("stop");
      var costN = E.mallCost(S,itN,p);
      var floorN = (w.cashReserveFloor||3) * Math.max(1, p.derived.totalExpenses);
      var rmN = (itN.payload||{}).recurringMonthly||0;
      // 續約也是消費：月費若會讓自己跨不過自由門檻就不續；現金也要留得住兩倍保留水位
      if(rmN>0 && p.derived.passiveIncome < p.derived.totalExpenses + rmN) return A("stop");
      return A(p.cash - costN >= floorN * 2 ? "renew" : "stop"); }

    // 第二專長：算得出來比較好才轉職，否則兼副業（決定論，不用 RNG）
    case "SECOND_CAREER": {
      var cS = ns.content.byId[d.cardId];
      var scN = cS && cS.secondCareer;
      if(!scN) return A("keep");
      var profN = ns.content.professionById[scN.professionId];
      var gainSwitch = -Infinity;
      if(profN && p.playerStage==="INNER"){
        var oldProfN = ns.content.professionById[p.professionId];
        var newNet = util.r2(profN.salary*S.config.salaryMult - profN.baseExpenses*S.config.expenseMult);
        var oldNet = util.r2((oldProfN?oldProfN.salary:0)*S.config.salaryMult
                           - (oldProfN?oldProfN.baseExpenses:0)*S.config.expenseMult);
        gainSwitch = util.r2(newNet - oldNet);
      }
      var gainSide = util.r2((scN.sideIncome||0) - (scN.sideCost||0));
      if(gainSwitch > gainSide && gainSwitch > 0) return A("switch");
      return A(gainSide > 0 ? "side" : "keep"); }

    // 人生二選一：挑「比較不痛」的那件面對（決定論；同分取先抽到的那張）
    case "PICK_LIFE": {
      var idsL=d.cardIds||[];
      if(!idsL.length) return A("none");
      var bestL=idsL[0], bestV=-Infinity;
      idsL.forEach(function(id){
        var cL=ns.content.byId[id]; if(!cL) return;
        var vL=E.lifeCardScore(S,p,cL);
        if(vL>bestV){ bestV=vL; bestL=id; }
      });
      return A(bestL); }

    // §2.3 二選一：對兩張各算 報酬率／門檻 分數，取高分（決定論，不用 RNG）
    case "PICK_OPP": {
      var ids=d.cardIds||[];
      if(!ids.length) return A("none");
      var bestId=ids[0], bestSc=-1e9;
      ids.forEach(function(id){
        var c=ns.content.byId[id]; if(!c) return;
        // 用 oppCompare（涵蓋股票／新創）而非 oppIncome/oppEntry——後者對 STOCK/STARTUP 一律回 0，
        // 會讓 NPC 對股票卡完全盲目。公式仍是工程書指定的 income/entry。
        // M8 S3：會看財報的人（含 NPC）用風險調整後的現金流來比較
        var cmp=E.oppCompare(S,c,p), ent=cmp.entry;
        var inc=cmp.disclosed ? cmp.netIncome : cmp.income;
        var sc=inc/Math.max(1,ent);
        if(p.cash<ent) sc*=0.2;                                   // 付不起入手門檻
        sc *= (w.cashflowPerCost||1);                             // LEVER 偏好高報酬率
        // SAFE（高 cashReserveFloor）偏好低門檻
        sc -= (w.cashReserveFloor||0) * (ent/Math.max(1,p.derived.totalExpenses)) * 0.0005;
        if(sc>bestSc){ bestSc=sc; bestId=id; }
      });
      return A(bestId); }
  }
  return A("skip");
};

npc.scoreBuy = function(S,p,d,w,A){
  var c=ns.content.byId[d.cardId], D=p.derived, floor=w.cashReserveFloor*D.totalExpenses;
  var best={score:-1e9, opt:"skip", params:{}};
  // S22：吸金盤——看得懂帳或懂法、天性保守（cashReserveFloor ≥ 4）、或已經被騙過一次的電腦玩家直接拒絕；
  // 其他人照報酬率評分（會上當，這正是要教的）
  if(c && c.payload && c.payload.isScam
     && ((w.cashReserveFloor||0)>=4 || (p.stats.scamCrashed||0)>0
         || E.hasSkill(p,"SKL_BOOK")||E.hasSkill(p,"SKL_CPA_AUDIT")||E.hasSkill(p,"SKL_LAW")||E.hasSkill(p,"SKL_GOV_LEGAL")))
    return A("skip");
  function consider(opt, cost, cfDelta, ltv, gain, params){
    if(cost>p.cash) return;
    var s=0;
    s += w.cashflowPerCost * (cfDelta*12) / Math.max(1,cost) * 100;
    s += w.capitalGainAppetite * gain;
    var after=p.cash-cost;
    if(after<floor) s -= Math.min(45, (floor-after)/Math.max(1,floor)*28);
    if(after<0.5*D.totalExpenses) s -= 60;
    if(ltv>w.maxLtvTolerance) s -= 100;
    if(cfDelta<=0 && gain<=0) s -= 30;
    if(s>best.score) best={score:s, opt:opt, params:params||{}};
  }
  if(c.kind==="REALESTATE"){
    var pl=c.payload, net=util.r2(pl.monthlyRent*S.config.assetIncomeMult-pl.monthlyCost);
    if(d.allowLoan){
      var ltv=Math.min(1-pl.downPayment/pl.price, d.maxLTV, w.maxLtvTolerance);
      var loan=pl.price*ltv, down=util.r2(pl.price-loan);
      var rate=S.macro.baseRate+E.cfg(S,"mortgageSpread");
      consider("loan", down, util.r2(net-loan*rate/12), ltv, 0.5, {ltv:ltv});
    }
    consider("cash", pl.price, net, 0, 0.3);
  } else if(c.kind==="STOCK"){
    var def=ns.content.stockBySymbol[c.payload.symbol], price=S.stockPrices[def.symbol]||c.payload.offerPrice;
    var units=Math.max(1, Math.floor(Math.min(p.cash*0.35, 900)/price));
    if(units>=1) consider("cash", util.r2(price*units), util.r2(units*E.stockDivPerUnit(S,def)),   // S23a：與引擎同一個入口
      0, E.stockVol(S,def)*30*w.capitalGainAppetite, {units:units});   // S15b：電腦玩家的評分也走同一個入口
  } else if(c.kind==="BUSINESS"){
    consider("cash", c.payload.price, util.r2(c.payload.monthlyProfit*E.incomeMultFor(S,"BUSINESS")), 0, 0.2);
  } else if(c.kind==="STARTUP"){
    if(w.startupAppetite>0.2) consider("cash", c.payload.investAmount, 0, 0, w.startupAppetite*40);
  }
  return best.score>0 ? A(best.opt,best.params) : A("skip");
};

/* NPC 自動脫困 */
E.npcRescue = function(S,p){
  var guard=0;
  while(p.cash<0 && guard++<30){
    var sellable=p.assets.filter(function(a){ return a.kind!=="P2P_LOAN"; });   // §4：債權不可急售變現
    if(!sellable.length) break;
    var need=-p.cash, fmult=S.config.fireSaleRatio;
    // V11：先找「單賣一筆就夠、且犧牲現金流最少」的資產；沒有才賣最大的一筆逼近缺口
    var enough=sellable.filter(function(a){ return util.r2(a.marketValue*fmult) >= need; })
      .sort(function(a,b){ return a.monthlyIncome-b.monthlyIncome || a.marketValue-b.marketValue; })[0];
    var pick = enough || sellable.slice().sort(function(a,b){ return b.marketValue-a.marketValue; })[0];
    E.sellAsset(S,p,pick,fmult);
  }
  if(p.cash<0){
    var cap=E.rescueCap(S,p);
    if(cap>1){ if(p.creditFlags) p.creditFlags.usedRescue=true;   // M7：NPC 動用紓困同樣留下信用瑕疵
      E.addLiability(S,p,"CONSUMER","紓困貸款",cap,S.macro.baseRate+E.cfg(S,"rescueLoanSpread"),false);
      ledger.post(S,p,"紓困貸款撥款",[{account:"CASH",delta:cap,label:"貸款撥款"}],{eduTags:["debt"]}); }
  }
  if(p.cash<0) E.declareBankrupt(S,p); else { p.skippedTurns+=1; p.skipReason="走完破產程序，重整一輪"; }
};

/* ============================== 模擬器 ================================== */
ns.sim = {
  MAX_ACTIONS: 6000,
  // S13.1 FF-001：摘要一律由原始樣本算，且全檔只有這一份 median / percentile 定義。
  // 中位數與百分位不是線性統計量，不能把各批摘要平均起來當全樣本摘要。
  stats: {
    median: function(a){ if(!a || !a.length) return null;
      var b=a.slice().sort(function(x,y){return x-y;}); return b[Math.floor(b.length/2)]; },
    percentile: function(a,q){ if(!a || !a.length) return null;
      var b=a.slice().sort(function(x,y){return x-y;});
      return b[Math.min(b.length-1, Math.floor(b.length*q))]; },
    emptyBucket: function(){ return { n:0, bankrupt:0, free:[], nw:[] }; },
    mergeBucket: function(dst, src){
      dst.n += src.n; dst.bankrupt += src.bankrupt;
      dst.free = dst.free.concat(src.free); dst.nw = dst.nw.concat(src.nw);
      return dst; },
    summarize: function(key, b){
      var st=ns.sim.stats;
      return { personality:key, games:b.n,
        freeRate: b.free.length/Math.max(1,b.n),
        medianFreeTurn: st.median(b.free),
        p10: st.percentile(b.free,0.1), p90: st.percentile(b.free,0.9),
        bankruptRate: b.bankrupt/Math.max(1,b.n),
        medianNetWorth: st.median(b.nw) }; }
  },
  playOne: function(cfg, modules, seed, lineup){
    var players = lineup.map(function(per,i){
      return { name:"P"+i, isNPC:true, personality:per,
        professionId: ns.sim.pickProfession(i, modules, seed),
        dreamCardId: ns.content.dreams[i % ns.content.dreams.length].id };
    });
    var S = E.newGame({ seed:seed, config:util.clone(cfg), modules:modules, players:players });
    E.beginTurn(S);
    var guard=0, bad=null;
    while(!S.over && guard++ < ns.sim.MAX_ACTIONS){
      var a = npc.nextAction(S);
      if(!a){
        var res=E.apply(S,{type:"END_TURN",playerId:E.activePlayer(S).id},{mutate:true});
        if(res.rejected){ bad="END_TURN_REJECTED:"+(res.reason||"?"); break; } else S=res.state; continue; }
      if(a.type==="DECIDE" && S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
      var r=E.apply(S,a,{mutate:true});
      if(r.rejected){ var r2=E.apply(S,{type:"END_TURN",playerId:E.activePlayer(S).id},{mutate:true});
        if(r2.rejected){ bad="END_TURN_REJECTED_AFTER_"+a.type+":"+(r2.reason||"?"); break; } S=r2.state; } else S=r.state;
    }
    // S13.1 FF-002：卡死／被拒中斷的局不能默默混進平衡統計裡當一筆正常樣本。
    if(!bad && guard>=ns.sim.MAX_ACTIONS && !S.over) bad="ACTION_GUARD_EXCEEDED";
    S.simStatus = bad
      ? { valid:false, reason:bad, actions:guard, seed:seed, turnNumber:S.turnNumber,
          phase:S.phase, activePlayerIdx:S.activePlayerIdx,
          decisionQueueLength:(S.decisionQueue||[]).length, actionLogLength:(S.actionLog||[]).length }
      : { valid:true, reason:null, actions:guard, seed:seed };
    return S;
  },
  pickProfession: function(i, modules, seed){
    var list = ns.content.professions.filter(function(p){ return !p.moduleReq || modules.indexOf(p.moduleReq)>=0; });
    // 跨薪資帶均勻取樣，避免整桌都落在同一收入層而扭曲平衡數據
    var stride = list.length/4;
    return list[Math.floor(i*stride + ((seed||0)+i*7)%Math.max(1,Math.floor(stride)))%list.length].id;
  },
  run: function(o){
    var games=o.games||200, seedBase=o.seedBase||1, lineup=o.lineup||["NPC_SAFE","NPC_LEVER","NPC_VC","NPC_SAFE"];
    var rows=[], byPer={};
    // v0.2 平衡指標：外圈耗時／跌落率／免費點占比／四類公平性
    var ox={ dur:[], byCat:{}, grads:0, freefalls:0, freeP:0, paidP:0,
      done:function(){
        var med=function(a){ if(!a.length) return null; var b=a.slice().sort(function(x,y){return x-y;}); return b[Math.floor(b.length/2)]; };
        var catMed={}; Object.keys(ox.byCat).forEach(function(k){ catMed[k]=med(ox.byCat[k]); });
        return { outerMedian:med(ox.dur), outerP90:(function(){ if(!ox.dur.length) return null;
            var b=ox.dur.slice().sort(function(x,y){return x-y;}); return b[Math.min(b.length-1,Math.floor(b.length*0.9))]; })(),
          wins:ox.dur.length, grads:ox.grads,
          freefallRate: ox.grads? ox.freefalls/ox.grads : 0,
          freeShare: (ox.freeP+ox.paidP)? ox.freeP/(ox.freeP+ox.paidP) : 0,
          catMedian:catMed };
      } };
    var invalid=[];
    lineup.forEach(function(p){ byPer[p]=ns.sim.stats.emptyBucket(); });
    for(var g=0; g<games; g++){
      var S=ns.sim.playOne(o.config, o.modules, (seedBase+g*7919)>>>0, lineup);
      // S13.1 FF-002：異常局另冊處理，不進平衡統計的分母
      if(S.simStatus && !S.simStatus.valid){ invalid.push(S.simStatus); continue; }
      S.players.forEach(function(p){
        var b=byPer[p.npcPersonality]; b.n++;
        if(p.bankrupt) b.bankrupt++;
        if(p.freeAtTurn) b.free.push(p.freeAtTurn);
        b.nw.push(p.derived.netWorth);
        if(p.graduatedAtTurn!==null && p.graduatedAtTurn!==undefined){
          ox.grads++;
          ox.freefalls += (p.stats.freefalls||0);
          ox.freeP += (p.stats.freeProgress||0); ox.paidP += (p.stats.paidProgress||0);
          if(S.winner===p.id && p.dreamProgress>=S.config.dreamCost){
            var du=S.turnNumber-p.graduatedAtTurn;
            ox.dur.push(du);
            var cat=(ns.content.byId[p.dreamCardId]||{}).category||"?";
            (ox.byCat[cat]=ox.byCat[cat]||[]).push(du);
          }
        }
      });
      rows.push({ seed:S.seed, turns:S.turnNumber, winner:S.winner,
        free:S.players.map(function(p){return p.freeAtTurn||"";}).join("|"),
        nw:S.players.map(function(p){return Math.round(p.derived.netWorth);}).join("|") });
    }
    var summary=Object.keys(byPer).map(function(k){ return ns.sim.stats.summarize(k, byPer[k]); });
    // raw：讓呼叫端能把多批樣本合併後「一次算」摘要（批次統計的唯一正確作法）
    return { summary:summary, rows:rows, games:games, outerStats:ox.done(),
             raw:byPer, invalid:invalid, validGames:games-invalid.length };
  }
};

})(ns);
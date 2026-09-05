(function(ns){
"use strict";
var util=ns.util, ledger=ns.ledger, E=ns.engine;

/* ========================== 唯一入口：applyAction ========================= */

/* S15：受僱／自營／創辦人——同一格「失業」對三種人不是同一件事。
   型別寫在內容包的 professions（鐵律二），沒標的一律當受僱。 */
E.employmentType = function(S, p){
  var pr = ns.content.professionById[p.professionId];
  return (pr && pr.employmentType) || "EMPLOYEE";
};
E.LAYOFF_FLAVOR = {
  EMPLOYEE:{ title:"失業", ledger:"失業：支付生活開銷", label:"失業期間支出",
             skip:"失業，正在找下一份工作",
             note:"沒有收入的日子照樣要過。緊急預備金存的就是這幾個月。" },
  SELF:{ title:"接不到案", ledger:"沒有生意：支付生活開銷", label:"空窗期支出",
         skip:"接不到案，正在找下一個客戶",
         note:"自營沒有資遣費，也沒有雇主幫你墊。收入斷得比受僱更直接。" },
  FOUNDER:{ title:"公司斷炊", ledger:"公司斷炊：自己扛生活開銷", label:"斷炊期間支出",
            skip:"公司斷炊，全力在救公司",
            note:"創辦人不會被資遣——但公司沒錢時，第一個停薪的就是自己。" }
};
/* S27：把原本寫死在棋盤格 case "LAYOFF" 裡的邏輯抽成函式，行為完全不變
   （成本＝1 個月總支出 × layoffPayMonths、停走 layoffSkipTurns 輪，敘事依 employmentType 換）。
   抽出來的目的：卡片效果 op "LAYOFF" 也能觸發同一件事，敘事與參數只維護一份。 */
E.triggerLayoff = function(S, p, opts){
  opts = opts || {};
  var mult = (opts.mult!==undefined) ? opts.mult : ((S.spaceMult && S.spaceMult["LAYOFF"]) || 1);
  var cost = util.r2(p.derived.totalExpenses*S.config.layoffPayMonths*mult);
  var et = E.employmentType(S,p), fl = E.LAYOFF_FLAVOR[et] || E.LAYOFF_FLAVOR.EMPLOYEE;
  var skip = Math.round(S.config.layoffSkipTurns*mult);
  var title = opts.title || fl.title, note = opts.note || fl.note;
  ledger.post(S,p,fl.ledger,[{account:"CASH",delta:-cost,label:fl.label}],{eduTags:["layoff"]});
  p.skippedTurns += skip;
  p.skipReason = fl.skip;
  E.ev("LAYOFF",{playerId:p.id, cost:cost, skip:p.skippedTurns, employmentType:et,
                 title:title, note:note});
  E.pushDecision(S,p,{kind:"ACK", layoff:{cost:cost, skip:skip,
                 employmentType:et, title:title, note:note}});
  if(p.cash<0) E.enterBankruptcy(S,p);
  return { cost:cost, skip:skip, employmentType:et };
};
/* S15：BUY 決策的鎖——只鎖「把這張卡拿出去拍賣／轉介／合資的那個人」的「那一張卡」。
   回傳 null 表示可以解鎖決策。這是 UI 判斷「現在到底在等誰」的單一真相來源，
   npc 迴圈與等待畫面都讀它，不再各寫一份。 */
E.buyLockReason = function(S, d){
  if(!d || d.kind!=="BUY") return null;
  var who = (d.playerId!==undefined && d.playerId!==null) ? d.playerId : null;
  if(S.pendingAuction && S.pendingAuction.cardId===d.cardId
     && (who===null || S.pendingAuction.sellerId===who)) return "AUCTION_PENDING";
  if(S.pendingReferral && S.pendingReferral.cardId===d.cardId
     && (who===null || S.pendingReferral.fromId===who)) return "REFERRAL_PENDING";
  if(S.pendingJV && S.pendingJV.cardId===d.cardId
     && (who===null || S.pendingJV.fromId===who)) return "JV_PENDING";
  return null;
};
// 現在整局到底在等誰？回傳 {kind, waiting:[playerId], title} 或 null。
E.waitingOnHumans = function(S){
  if(S.pendingAuction) return { kind:"AUCTION", title:S.pendingAuction.title,
    waiting:(S.pendingAuction.waiting||[]).slice() };
  if(S.pendingReferral) return { kind:"REFERRAL", title:S.pendingReferral.title,
    waiting:S.players.filter(function(x){
      var pr=S.pendingReferral;
      if(x.isNPC||x.bankrupt||x.id===pr.fromId) return false;
      if(pr.toId!==null && pr.toId!==undefined) return x.id===pr.toId;
      return !(pr.declined&&pr.declined[x.id]);
    }).map(function(x){return x.id;}) };
  if(S.pendingJV) return { kind:"JV", title:S.pendingJV.title,
    waiting:S.players.filter(function(x){
      var pj=S.pendingJV;
      if(x.isNPC||x.bankrupt||x.id===pj.fromId) return false;
      if(pj.targetId!==null && pj.targetId!==undefined) return x.id===pj.targetId;
      return !(pj.declined&&pj.declined[x.id]);
    }).map(function(x){return x.id;}) };
  if(S.pendingTrade && S.pendingTrade.status==="await_human")
    return { kind:"TRADE", title:S.pendingTrade.name, waiting:[S.pendingTrade.buyerId] };
  return null;
};

/* S14a-2／S14b：非當前玩家的動作白名單（提到 E 上供 selftest 與多人層直接檢查）
     · OFF_TURN_SELF：只影響自己、且內部已改成指向 actor 的動作
     · OFF_TURN_RESPOND：本來就由別人回應／自行處理的互動，內部已用 action.playerId */
/* S19：MALL_BUY 從固定白名單改成「看開關」。
   S14a 當初把逛商城開放到非回合，實測回饋是「別人的輪次應該只能看不能買」——
   而且非回合買會繞過每回合上限（見 E.endTurn 只重置當前玩家的計數）。
   開關 mallOffTurnBuy 開回 1 就是 S14a～S18 的行為，基線可完整重現。 */
E.OFF_TURN_SELF_BASE = { REPAY_LOAN:1, SET_DCA:1, SET_DIV_REINVEST:1 };
E.OFF_TURN_SELF = { REPAY_LOAN:1, SET_DCA:1, SET_DIV_REINVEST:1, MALL_BUY:1 };  // 相容：靜態檢查用
E.offTurnSelfOk = function(S, type){
  if(E.OFF_TURN_SELF_BASE[type]) return true;
  if(type==="MALL_BUY"){ var on=E.cfg(S,"mallOffTurnBuy"); return on===undefined ? false : !!on; }
  return false;
};
E.OFF_TURN_RESPOND = { RESPOND_TRADE:1, RESPOND_REFERRAL:1, RESPOND_P2P:1, RESPOND_JV:1,
                       JOIN_SYNDICATE:1, DECLINE_SYNDICATE:1,
                       PLACE_BID:1, PROPOSE_P2P:1, TOP_UP_MARGIN:1,
                       PLAYER_LEAVE:1, PLAYER_RETURN:1, END_GAME:1, EXTEND_GAME:1,
                       CONFIG_PATCH:1, CLEAR_TRADE:1 };
E.OFF_TURN_RESPOND_KEYS = function(){ return Object.keys(E.OFF_TURN_RESPOND); };
/* S15：有條件開放的非回合動作。
   實測回饋：收到合資／轉介邀約時現金不夠，但明明還有借款額度——沒有借款入口，
   交易就此告吹。可是「別人的回合也能隨便借錢」是另一個洞，所以不無條件開放：
   只有在「有一筆等你回應的邀約懸置中」時，TAKE_LOAN 才放行。 */
E.OFF_TURN_CONDITIONAL = {
  TAKE_LOAN: function(S, actor){
    var w = E.waitingOnHumans(S);
    return !!(w && w.waiting && w.waiting.indexOf(actor.id)>=0);
  },
  /* S15d：決策的擁有者永遠答得了自己的決策，不管輪到誰。
     實測（多人連線真實局）回報：畫面停在「等待 carrie 做決定中」，carrie 一按就跳
     「這個動作現在不能做」，整局掛死。根因是 DECIDE 不在任何白名單裡——
     只要有一筆決策被排給非當前玩家，三條路同時堵死：
       · 擁有者送 DECIDE → NOT_YOUR_TURN
       · 當前玩家擲骰    → WRONG_PHASE（階段是 DECISION）
       · 當前玩家結束回合 → PENDING_DECISION
     這條規則把第一條路打開，死結才有出口。 */
  DECIDE: function(S, actor){
    var d = S.pendingDecision;
    return !!(d && d.playerId!==undefined && d.playerId!==null && d.playerId===actor.id);
  }
};
E.OFF_TURN_CONDITIONAL_KEYS = function(){ return Object.keys(E.OFF_TURN_CONDITIONAL); };
E.OFF_TURN_SELF_KEYS = function(){ return Object.keys(E.OFF_TURN_SELF); };

// S25d 修復：放棄進修的實際效果抽成獨立函式，供「主動放棄」(ABANDON_SKILL，
// 自己一筆 actionLog) 與「START_DIGITAL 的 dropStudy 選項」(合併在同一筆 DECIDE
// 裡) 共用。呼叫端要自己先確認 p.learning 存在——這裡只做效果，不做守門、不呼叫
// accept()，因為它從來不是一個獨立可被分派的動作。
// 重要：先前 dropStudy 分支是整套呼叫 E.apply(S,{type:"ABANDON_SKILL",...},
// {mutate:true})，這條路徑內部的 accept() 會在同一個 DECIDE 動作裡於
// S.actionLog 多推一筆「憑空」的紀錄——本機重放看不出異狀，但多人連線只有
// DECIDE 這一筆真正經過 mpSend 上傳，本機 actionLog.length 卻多算了一筆，
// 從此之後這個玩家送出的每一個動作算出來的 seq 都對不上共用日誌，
// mpSend 的 conflict 分支永遠觸發——實測回報「放棄進修接數位資產之後，
// 之後任何操作都卡在『狀態已更新，請再操作一次』」，根因就在這裡。
E.applyAbandonSkill = function(S, p){
  var ac = ns.content.byId[p.learning.skillId];
  var pct = E.cfg(S,"abandonRefundPct"); if(pct===undefined) pct = 0.3;
  var refund = util.r2((p.learning.paidCost||0) * pct);
  var apost = [];
  if(refund > 0) apost.push({account:"CASH", delta:refund, label:"退回部分學費"});
  var arm = ac ? (ac.recurringMonthly||0) : 0;
  if(arm > 0) apost.push({account:"EXPENSE", delta:util.r2(-arm), label:(ac?ac.title:"")+" 月費終止"});
  if(apost.length) ledger.post(S,p,"放棄學習："+(ac?ac.title:"?"),apost,{eduTags:["learning","sunk-cost"]});
  p.stats.skillsAbandoned = (p.stats.skillsAbandoned||0) + 1;
  E.ev("SKILL_ABANDONED",{ playerId:p.id, skillId:p.learning.skillId,
                           title:(ac?ac.title:""), refund:refund,
                           sunk:util.r2((p.learning.paidCost||0)-refund),
                           turnsSpent:S.turnNumber-p.learning.startTurn });
  p.learning = null;
};

E.apply = function(state, action, opts){
  opts = opts||{};
  var S = opts.mutate ? state : util.clone(state);
  E._events = [];
  var ev = E.ev;
  var p = E.activePlayer(S);
  // S14a-2：p 一直都是「當前輪到的玩家」。開放非回合動作之後，
  // 還款／定期定額／商城這類動作必須明確指向「送出動作的那個人」，
  // 否則會變成幫當前玩家還款、幫他買東西（原本靠 UI 擋住，是一顆沒爆的地雷）。
  var actor = S.players[action.playerId] !== undefined ? S.players[action.playerId] : p;
  var isMyTurnAction = (actor === p);

  function reject(why){ ev("ACTION_REJECTED",{reason:why}); return { state:S, events:E._events, rejected:true }; }
  function accept(){ S.actionLog.push({ seq:S.actionLog.length, playerId:action.playerId,
      type:action.type, payload:action.payload||null }); }

  // S14b：時間到才結束的局可以當場續攤，所以 EXTEND_GAME 要能穿過這道門；
  // 圓夢或全員破產結束的局不行——那是真的分出勝負了，由下面的 case 再擋一次。
  if(S.over && action.type!=="CONFIG_PATCH" && action.type!=="EXTEND_GAME") return reject("GAME_OVER");

  /* S14a-2：非當前玩家能做什麼，必須是白名單。
     舊碼所有 case 都直接用 p（＝當前輪到的玩家），非當前玩家送進來的動作
     會變成「幫當前玩家操作」——原本只靠 UI 與 mpMayAct 擋住，是一顆沒爆的地雷。
     這裡把它變成引擎層的規則：
       · OFF_TURN_SELF：只影響自己、且已改成指向 actor 的動作（實測要求開放）
       · OFF_TURN_RESPOND：本來就要由別人回應／自行處理的互動，內部已用 action.playerId
       · 其餘一律只能由當前玩家送出。 */
  // 白名單提到 E 上，讓 selftest 與多人層可以直接檢查，不必去 parse 函式原始碼
  var OFF_TURN_RESPOND = E.OFF_TURN_RESPOND;
  var OFF_TURN_SELF = { };   // S19：改由 E.offTurnSelfOk(S,type) 判斷（MALL_BUY 看開關）
  var condFn = E.OFF_TURN_CONDITIONAL[action.type];
  if(!isMyTurnAction && condFn && condFn(S, actor)){ /* 條件成立：放行 */ }
  else if(!isMyTurnAction && !E.offTurnSelfOk(S,action.type) && !OFF_TURN_RESPOND[action.type])
    return reject("NOT_YOUR_TURN");

  switch(action.type){

  case "CONFIG_PATCH": {
    var k=action.payload.key, v=action.payload.value;
    if(!(k in S.config)) return reject("NO_SUCH_PARAM");
    accept(); S.config[k]=v;
    if(k==="mortgageSpread") E.repriceFloating(S);
    ev("CONFIG_PATCHED",{key:k,value:v});
    break; }

  case "ROLL_DICE": {
    if(S.phase!=="ROLL") return reject("WRONG_PHASE");
    if(p.bankrupt) return reject("BANKRUPT");
    accept();
    var roll = util.randInt(S,1,6);
    ns.modules.onDiceRolled(S,p,roll);
    ev("DICE_ROLLED",{playerId:p.id, roll:roll});
    E.doMove(S,p,roll);
    break; }

  case "CHOOSE_DECK": {
    var d0=S.pendingDecision;
    if(!d0 || d0.kind!=="CHOOSE_DECK") return reject("WRONG_PHASE");
    // 特殊機會：沒有人脈就不該打得開這扇門（引擎把關；UI 灰化只是提示）
    // 必須擋在 accept() 之前，否則決策已被 shift、玩家會白白失去這一次機會
    if((action.payload||{}).deckId==="OPPORTUNITY_SPECIAL" && !E.hasNetwork(S,p))
      return reject("NO_NETWORK");
    accept(); S.decisionQueue.shift();
    var deckId0 = action.payload.deckId;
    if(deckId0==="NONE"){                      // 六期：第一層即可放棄，不抽卡
      p.stats.passedOpps=(p.stats.passedOpps||0)+1;
      E.ev("OPP_PICKED",{playerId:p.id, cardId:null, cardIds:[]});
      E.afterResolve(S,p);
      break;
    }
    var usable0 = function(c){ return E.cardUsable(S,p,c); };
    if(E.cfg(S,"oppDualChoice")){
      var two = E.drawTwo(S, deckId0, usable0);
      if(two.length===2){
        ev("OPP_DUAL_DRAWN",{playerId:p.id, cardIds:[two[0].id,two[1].id], deckId:deckId0});
        E.pushDecision(S,p,{ kind:"PICK_OPP", cardIds:[two[0].id,two[1].id], deckId:deckId0 });
      } else if(two.length===1){
        E.presentCard(S,p,two[0]);            // 牌堆剩 1 張：退化為現行單張流程
      }
    } else {
      var card = E.drawCard(S, deckId0, usable0);
      if(card){ E.presentCard(S,p,card); }
    }
    E.afterResolve(S,p);
    break; }

  case "DECIDE": {
    var d=S.pendingDecision;
    if(!d) return reject("NO_DECISION");
    if(d.decisionId!==action.payload.decisionId) return reject("STALE_DECISION");
    /* S15 修死結：這三道守衛原本是「有拍賣／轉介／合資懸置中，就不准解 BUY 決策」，
       但它攔的是**任何玩家的任何 BUY**，而懸置的邀約只牽涉**一張卡、一個發起人**。
       後果：邀約在等真人回應期間，換到電腦玩家的回合、他踩到機會格抽到 BUY——
       DECIDE 被拒（XXX_PENDING）、END_TURN 也被拒（PENDING_DECISION），
       兩條路都堵死，ui.tick 就永遠停在「思考中…」。（已實測三種懸置皆可重現。）
       改法兩層：
         1) 只攔**同一張卡**——那才是原本要防的「同一張卡既拿去拍賣又自己買」。
         2) 就算攔到了也**不再 reject**，改成當作「這次跳過」把決策消化掉。
            引擎任何時候都必須至少有一個動作走得通，不能出現全拒的狀態。 */
    // 鎖只該套在「把這張卡拿出去的那個人」身上，而且只鎖那一張卡（T-31 的原意：
    // 抽卡人不能一邊拍賣一邊自己先把決策收掉）。原版少了這兩個條件，變成
    // 任何玩家的任何 BUY 都被攔——邀約等真人回應期間換到電腦玩家的回合、
    // 他踩到機會格抽到 BUY，DECIDE 與 END_TURN 就雙雙被拒，永遠停在「思考中…」。
    /* S15d：決策的主體必須是「這筆決策的擁有者」，不是當前回合玩家。
       原碼一律用 p（＝當前玩家），造成兩個問題：
         (1) 擁有者不是當前玩家時，效果會套到錯的人頭上（實測可重現）；
         (2) 配合上面的白名單缺口，整局會死結。 */
    var dOwner = (d.playerId!==undefined && d.playerId!==null && S.players[d.playerId])
                 ? S.players[d.playerId] : p;
    if(d.playerId!==undefined && d.playerId!==null && action.playerId!==d.playerId)
      return reject("NOT_YOUR_DECISION");        // 不准代答別人的決策
    var lock = E.buyLockReason(S, d);
    if(lock) return reject(lock);
    accept(); S.decisionQueue.shift();
    E.resolveDecision(S,dOwner,d,action.payload.optionId,action.payload.params||{});
    /* S18：系統訊息要看得到「決定了什麼」。E.ev 只往事件陣列丟東西、不碰 S，
       所以純輸出、不影響重放與平衡。選項的文字由 UI 端從內容包查（引擎不碰文案）。 */
    E.ev("DECISION_RESOLVED",{ playerId:dOwner.id, kind:d.kind, cardId:d.cardId||null,
                               optionId:action.payload.optionId, title:d.title||null });
    E.afterResolve(S,dOwner);
    break; }

  case "SET_BK_AUTO": {
    // S11：玩家自己切換某一象限的自動記帳。沒解鎖不給開；關掉隨時可以。
    var qA=action.payload.quadrant || action.payload.group, onA=!!action.payload.on;
    if(!E.BK_GROUPS.some(function(g){ return g.key===qA; })) return reject("BAD_GROUP");
    if(onA && !(p.bkUnlocked && p.bkUnlocked[qA])) return reject("NOT_UNLOCKED");
    accept();
    p.bkAuto[qA]=onA;
    ev("BK_AUTO_SET",{playerId:p.id, group:qA, groupName:E.bkGroupName(qA), on:onA});
    E.buildBookkeeping(S,p);      // 立刻套用：開了就把該類別的題目收掉，關了就補回來
    E.syncPhase(S);
    break; }

  case "CLASSIFY_ENTRY": {
    if(!S.bookkeeping) return reject("NO_BOOKKEEPING");
    var t = S.bookkeeping.tasks[action.payload.taskIdx];
    if(!t || t.done) return reject("BAD_TASK");
    accept();
    var trueQ = ledger.QUADRANT[t.account];
    var grpT = t.group || null;
    var thr=E.cfg(S,"bkMasteryStreak"); if(thr===undefined) thr=5;
    p.bkEntryBad = p.bkEntryBad || {};
    if(trueQ===action.payload.quadrant){
      t.done=true; p.stats.bkRight++;
      // S13：熟練度以「整筆分錄」計。同一筆裡只要錯過一格，這一筆就不算——
      // 記帳的重點是一組帳要整組對得起來，半套會的人不該拿到自動化。
      if(thr>0 && grpT){
        var restT=(S.bookkeeping.tasks||[]).filter(function(x){
          return x.entryId===t.entryId && !x.done; });
        if(!restT.length){                                  // 這一筆全部答完了
          if(p.bkEntryBad[t.entryId]){
            delete p.bkEntryBad[t.entryId];                  // 中間錯過 → 已在答錯時歸零
          } else {
            p.bkStreak[grpT]=(p.bkStreak[grpT]||0)+1;
            ev("BK_ENTRY_OK",{playerId:p.id, group:grpT, streak:p.bkStreak[grpT]});
            if(p.bkStreak[grpT]>=thr && !p.bkUnlocked[grpT]){
              p.bkUnlocked[grpT]=true;
              /* S35：練熟的當下直接切成自動（bkAutoOnMastery=1，預設）。
                 S11 的「解鎖不等於自動開啟」是要把選擇權留給玩家；真人實測回饋是
                 記帳題太多拖慢決策，所以把預設翻過來——面板上的開關留著，想再練的人
                 自己關回手記。0＝回到 S11 行為。事件順序：先 MASTERED 再 AUTO_SET，
                 介面用同一則通知講兩件事。 */
              var autoOn = E.cfg(S,"bkAutoOnMastery"); if(autoOn===undefined) autoOn=1;
              if(autoOn) p.bkAuto[grpT]=true;
              ev("BK_MASTERED",{playerId:p.id, group:grpT, groupName:E.bkGroupName(grpT),
                                streak:p.bkStreak[grpT], autoOn:!!autoOn});
              if(autoOn){
                ev("BK_AUTO_SET",{playerId:p.id, group:grpT, groupName:E.bkGroupName(grpT), on:true, byMastery:true});
                E.buildBookkeeping(S,p);      // 這一套剩下的題目立刻收掉（與 SET_BK_AUTO 同一條路）
              }
            }
          }
        }
      }
      ev("CLASSIFY_OK",{taskIdx:action.payload.taskIdx});
      E.clearOffTurnIfDone(S,p,t.entryId);
    } else {
      p.stats.bkWrong++;
      // 答錯：這一套的連續紀錄歸零，而且這一筆整筆作廢（後面答對也不補回來）
      if(grpT) p.bkStreak[grpT]=0;
      p.bkEntryBad[t.entryId]=1;
      ev("CLASSIFY_BAD",{taskIdx:action.payload.taskIdx, hint:t.hint});
      E.clearOffTurnIfDone(S,p,t.entryId);
      if(S.config.misclassifyPenalty>0)
        ledger.post(S,p,"分類錯誤罰款",[{account:"CASH",delta:-S.config.misclassifyPenalty,label:"罰款"}],{eduTags:["bookkeeping"]});
    }
    E.syncPhase(S);
    break; }

  case "SUBMIT_MANUAL_BOOKS": {
    var da=S.pendingDecision;
    if(!da || da.kind!=="AUDIT") return reject("NO_AUDIT");
    accept(); S.decisionQueue.shift();
    var ansv=action.payload.answers, tol=S.config.auditTolerance, dv=p.derived;
    var truth={active:dv.salaryIncome, passive:dv.passiveIncome, expense:dv.totalExpenses, net:dv.netCashflow};
    var ok=["active","passive","expense","net"].every(function(k){ return Math.abs((ansv[k]||0)-truth[k])<=tol; });
    if(ok){ p.stats.auditPass++; ev("AUDIT_PASSED",{truth:truth}); }
    else { p.stats.auditFail++;
      var cut = util.r2(da.netAmount*(1-S.config.auditPenaltyRatio));
      if(cut>0) ledger.post(S,p,"稽核未通過扣減",[{account:"CASH",delta:-cut,label:"稽核扣減"}],{eduTags:["bookkeeping"]});
      ev("AUDIT_FAILED",{truth:truth, answers:ansv, cut:cut});
    }
    E.afterResolve(S,p);
    break; }

  case "SELL_ASSET": {
    if(p.bankrupt) return reject("BANKRUPT");
    if(S.phase!=="ROLL" && S.phase!=="READY_END" && S.phase!=="BANKRUPTCY") return reject("WRONG_PHASE");
    var a = p.assets.filter(function(x){return x.instanceId===action.payload.assetId;})[0];
    if(!a) return reject("NO_ASSET");
    accept();
    E.sellAsset(S,p,a, S.phase==="BANKRUPTCY" ? S.config.fireSaleRatio : E.sellMult(S,a));
    if(S.phase==="BANKRUPTCY") E.checkRescued(S,p); else E.syncPhase(S);
    break; }

  case "SET_DCA": {
    // S11：新增／修改／取消定期定額（amount<=0 視為取消）
    if(!E.autoInvestOn(S)) return reject("AUTO_INVEST_OFF");
    var symD=action.payload.symbol;
    if(!ns.content.stockBySymbol[symD]) return reject("NO_SYMBOL");
    var amtD=util.r2(action.payload.amount||0);
    var minD=E.cfg(S,"dcaMinAmount"); if(!(minD>0)) minD=5;
    if(amtD>0 && amtD<minD) return reject("BELOW_MIN");
    if(!actor || actor.bankrupt) return reject("BAD_PLAYER");
    accept();
    var p = actor;                                       // S14a-2：定期定額是自己的設定，開放非回合
    p.dcaPlans=p.dcaPlans||[];
    var idxD=-1;
    p.dcaPlans.forEach(function(x,i){ if(x.symbol===symD) idxD=i; });
    if(amtD<=0){ if(idxD>=0){ p.dcaPlans.splice(idxD,1); ev("DCA_CANCELLED",{playerId:p.id,symbol:symD}); } }
    else if(idxD>=0){ p.dcaPlans[idxD].amount=amtD; p.dcaPlans[idxD].paused=false;
      ev("DCA_SET",{playerId:p.id,symbol:symD,amount:amtD}); }
    else { p.dcaPlans.push({symbol:symD, amount:amtD, carry:0, units:0, spent:0, periods:0, missed:0, paused:false});
      ev("DCA_SET",{playerId:p.id,symbol:symD,amount:amtD}); }
    break; }

  case "SET_DIV_REINVEST": {
    if(!E.autoInvestOn(S)) return reject("AUTO_INVEST_OFF");
    var symR=action.payload.symbol;
    var defR=ns.content.stockBySymbol[symR];
    if(!defR) return reject("NO_SYMBOL");
    if(!(defR.dividendYieldMonthly>0)) return reject("NO_DIVIDEND");   // 不配息的股票沒有再投入可言
    if(!actor || actor.bankrupt) return reject("BAD_PLAYER");
    accept();
    var p = actor;                                       // S14a-2：股息再投入是自己的設定，開放非回合
    p.divReinvest=p.divReinvest||{};
    p.divReinvest[symR]=!!action.payload.on;
    ev("DIV_REINVEST_SET",{playerId:p.id,symbol:symR,on:!!action.payload.on});
    break; }

  /* S23b：期貨。與股票同一組相位守門（自己的回合才能開平倉），
     所有前置檢查都在引擎層——介面反灰只是提示，不能當把關。 */
  case "FUT_OPEN": {
    if(p.bankrupt) return reject("BANKRUPT");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(!E.m9On(S)) return reject("NO_M9");
    if(!E.advancedUnlocked(S,p)) return reject("ADV_LOCKED");
    var fs=action.payload.symbol, fdef=E.futDef(fs);
    if(!fdef) return reject("NO_SYMBOL");
    if(E.isDelisted(S,fdef.underlying)) return reject("DELISTED");
    var fside=action.payload.side==="short" ? "short" : "long";
    var flots=Math.max(1,Math.floor(action.payload.lots||1));
    var cvOne=E.futContractValue(S,fdef);
    if(!(cvOne>0)) return reject("NO_PRICE");
    // 同一標的不能多空同時持有——要換方向先平倉（避免自己跟自己對鎖）
    var opp=E.futPositions(p).filter(function(x){ return x.symbol===fs && x.side!==fside; })[0];
    if(opp) return reject("OPPOSITE_POSITION");
    var maxL=E.futMaxLots(S,p);
    if(E.futLotsHeld(p,null)+flots > maxL) return reject("FUT_LOT_LIMIT");
    var needMargin=util.r2(cvOne*flots*E.futMarginPct(S,fdef));
    var feeO=E.futFee(S,flots);
    if(p.cash < util.r2(needMargin+feeO)) return reject("NO_CASH");
    accept();
    var same=E.futPositions(p).filter(function(x){ return x.symbol===fs && x.side===fside; })[0];
    var fid = same ? same.instanceId : util.uid(S,"A");
    if(same){
      // 加碼：保證金與口數累加，開倉價用加權平均（結算看的是 lastPrice，這裡只是顯示用）
      var totLots=same.lots+flots;
      same.entryPrice=util.r2((same.entryPrice*same.lots + E.futPrice(S,fdef)*flots)/totLots);
      same.lots=totLots;
      same.marketValue=util.r2(same.marketValue+needMargin);
      same.costBasis=util.r2((same.costBasis||0)+needMargin);
    } else {
      p.assets.push({ instanceId:fid, cardId:null, kind:"FUTURES", name:fdef.name+"（"+(fside==="short"?"空":"多")+"）",
        symbol:fs, side:fside, lots:flots, units:flots,
        entryPrice:E.futPrice(S,fdef), lastPrice:E.futPrice(S,fdef),
        costBasis:needMargin, marketValue:needMargin, monthlyIncome:0,
        ownCash:needMargin, linkedLiabilityId:null, flags:{futures:true} });
    }
    var postF=[{account:"CASH",delta:-needMargin,label:"期貨原始保證金"},
               {account:"ASSET",delta:needMargin,refId:fid,label:fdef.name+" 保證金"}];
    if(feeO) postF.push({account:"CASH",delta:-feeO,label:"期貨手續費（每口 "+util.money(E.cfg(S,"futFeePerLot"))+"）"});
    ledger.post(S,p,(fside==="short"?"放空":"作多")+"期貨："+fdef.name+" "+flots+" 口（合約值 "+util.money(util.r2(cvOne*flots))+"）",
      postF,{eduTags:["futures","leverage"],
             detail:{lots:flots, side:fside, contractValue:util.r2(cvOne*flots), margin:needMargin, fee:feeO}});
    p.stats.futOpened=(p.stats.futOpened||0)+1;
    ev("FUT_OPENED",{playerId:p.id, symbol:fs, side:fside, lots:flots, margin:needMargin, fee:feeO});
    if(p.cash<0) E.enterBankruptcy(S,p);
    break; }

  case "FUT_CLOSE": {
    if(p.bankrupt) return reject("BANKRUPT");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(!E.m9On(S)) return reject("NO_M9");
    var caF=E.futPositions(p).filter(function(x){ return x.instanceId===action.payload.instanceId; })[0];
    if(!caF) return reject("NO_POSITION");
    accept();
    E.futClose(S,p,caF,{});
    break; }

  case "FUT_TOPUP": {
    if(p.bankrupt) return reject("BANKRUPT");
    if(!E.m9On(S)) return reject("NO_M9");
    var taF=E.futPositions(p).filter(function(x){ return x.instanceId===action.payload.instanceId; })[0];
    if(!taF) return reject("NO_POSITION");
    var amtF=util.r2(action.payload.amount||0);
    if(!(amtF>0)) return reject("BAD_AMOUNT");
    if(p.cash<amtF) return reject("NO_CASH");
    accept();
    taF.marketValue=util.r2(taF.marketValue+amtF);
    taF.costBasis=util.r2((taF.costBasis||0)+amtF);
    ledger.post(S,p,"補繳保證金："+taF.name,
      [{account:"CASH",delta:-amtF,label:"補繳保證金"},
       {account:"ASSET",delta:amtF,refId:taF.instanceId,label:"保證金餘額"}],
      {eduTags:["futures"]});
    ev("FUT_TOPPED_UP",{playerId:p.id, instanceId:taF.instanceId, amount:amtF});
    break; }

  case "TRADE_STOCK": {
    if(p.bankrupt) return reject("BANKRUPT");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(S.enabledModules.indexOf("M1")<0) return reject("NO_M1");
    var sym=action.payload.symbol, side=action.payload.side, units=Math.max(1,Math.floor(action.payload.units||1));
    var def=ns.content.stockBySymbol[sym]; if(!def) return reject("NO_SYMBOL");
    // S16：已下市＝壁紙，不能再交易。原本沒有這道檢查，加上 `||def.face` 的退路，
    // 玩家可以用面額買進一檔已經歸零的股票，而且帳上還記成有價值的資產。
    if(E.isDelisted(S,def) && side==="buy") return reject("DELISTED");
    /* S23c：進階標的（迷因幣）的解鎖閘門。賣出一律放行——已經買到手的東西
       不能因為關掉開關就變成賣不掉的壁紙（那會讓帳掛在身上永遠出不來）。 */
    if(side==="buy"){
      var tr = E.stockTradable(S, p, def);
      if(tr) return reject(tr);
    }
    var price=E.stockPrice(S,def);
    if(side==="buy" && !(price>0)) return reject("NO_PRICE");
    // 六期：現股與融資分倉
    var ex=p.assets.filter(function(x){return x.kind==="STOCK"&&x.symbol===sym&&!(x.flags&&x.flags.margin);})[0];
    if(side==="buy"){
      var margin = action.payload.margin && E.canUseAdvanced(S) && S.enabledModules.indexOf("M1")>=0;
      // S23c：迷因幣不能融資。沒有券商會拿一個沒有盈餘、單輪能動 ±50% 的東西當擔保品；
      // 遊戲設計上也不該讓「歸零機率兩倍」的標的再疊一層槓桿。
      if(margin && def.noMargin) return reject("NO_MARGIN_ASSET");
      // S15b：紀律閘門擋在引擎層（UI 灰化只是提示，不能當把關）
      if(margin){
        var mb = E.marginBlockReason(S, p);
        if(mb) return reject("MARGIN_BLOCKED_"+mb);
      }
      var total=util.r2(price*units);
      var ownCash = margin ? util.r2(total*S.config.marginRatio) : total;
      var bc = E.stockBuyCost(S, def, total, ownCash);      // S15b：自備款＋手續費
      if(p.cash<bc.cash) return reject("NO_CASH");
      accept();
      var div=util.r2(units*E.stockDivPerUnit(S,def));      // S23a：股息走統一入口（含殖利率上限與景氣係數）
      var mergeTo = margin ? null : ex;                       // 融資一律獨立部位
      var aid=mergeTo?mergeTo.instanceId:util.uid(S,"A");
      if(mergeTo){ mergeTo.units+=units; mergeTo.costBasis=util.r2(mergeTo.costBasis+total);
        mergeTo.marketValue=util.r2(mergeTo.marketValue+total);
        mergeTo.monthlyIncome=util.r2(mergeTo.monthlyIncome+div); }
      else { p.assets.push({instanceId:aid,cardId:null,kind:"STOCK",
        name:E.stockName(S,sym)+(margin?"（融資）":""),symbol:sym,units:units,
        costBasis:total,marketValue:total,monthlyIncome:div,linkedLiabilityId:null,
        flags:(margin?{margin:true}:{})}); }
      var pb=[{account:"CASH",delta:-ownCash,label:margin?"融資自備款":"買進股票"},{account:"ASSET",delta:total,refId:aid,label:E.stockName(S,sym)}];
      if(bc.fee) pb.push({account:"CASH",delta:-bc.fee,label:"券商手續費"});   // S15b
      if(div) pb.push({account:"INCOME_PASSIVE",delta:div,refId:aid,label:E.stockName(S,sym)+" 股息"});
      if(margin){
        var mAmt=util.r2(total-ownCash), mrate=E.rRate(S.macro.baseRate+E.cfg(S,"marginSpread"));
        var mid=E.addLiability(S,p,"MARGIN","融資："+E.stockName(S,sym),mAmt,mrate,false,aid,true);
        var theAsset=p.assets.filter(function(x){return x.instanceId===aid;})[0]; if(theAsset) theAsset.linkedLiabilityId=mid;
        pb.push({account:"LIABILITY",delta:mAmt,refId:mid,label:"融資餘額"});
        pb.push({account:"EXPENSE",delta:util.r2(mAmt*mrate/12),refId:mid,label:"融資利息"});
      }
      ledger.post(S,p,(margin?"融資買進：":"股市買進：")+E.stockName(S,sym)+" ×"+units,pb,{eduTags:margin?["leverage","equity"]:["equity"]});
      E.ev("ASSET_BOUGHT",{playerId:p.id,cardId:null,name:E.stockName(S,sym)});
    } else {
      // 賣出目標：payload.assetId 指定部位（融資整筆平倉）；未指定則賣現股
      if(action.payload.assetId){
        var tgt=p.assets.filter(function(x){return x.instanceId===action.payload.assetId&&x.kind==="STOCK";})[0];
        if(!tgt) return reject("NO_HOLDING");
        accept(); E.sellAsset(S,p,tgt,1); E.syncPhase(S); break;
      }
      if(!ex) return reject("NO_HOLDING");
      units=Math.min(units,ex.units); accept();
      var proceeds=util.r2(price*units), frac=units/ex.units;
      var sn=E.stockSellNet(S, def, proceeds);              // S15b：手續費＋證交稅
      var basisOut=util.r2(ex.costBasis*frac), incOut=util.r2(ex.monthlyIncome*frac);
      var pl=util.r2(sn.net-basisOut);                      // 損益以實際入袋計，這才是真的賺賠
      ex.units-=units; ex.costBasis=util.r2(ex.costBasis-basisOut);
      ex.marketValue=util.r2(price*ex.units); ex.monthlyIncome=util.r2(ex.monthlyIncome-incOut);
      var sb=[{account:"CASH",delta:proceeds,label:"賣出價款"},
        {account:"ASSET",delta:-proceeds,refId:ex.instanceId,label:E.stockName(S,sym)+" 減碼"}];
      if(sn.fee) sb.push({account:"CASH",delta:-sn.fee,label:"券商手續費"});   // S15b
      if(sn.tax) sb.push({account:"CASH",delta:-sn.tax,label:"證券交易稅"});   // S15b
      if(incOut) sb.push({account:"INCOME_PASSIVE",delta:-incOut,refId:ex.instanceId,label:E.stockName(S,sym)+" 股息減少"});
      ledger.post(S,p,"股市賣出："+E.stockName(S,sym)+" ×"+units+"（損益 "+(pl>=0?"+":"")+util.money(pl)+"）",sb,{eduTags:["exit"]});
      if(pl>0) p.stats.takeProfit=(p.stats.takeProfit||0)+1;   // 賣在賺的價位＝落袋為安
      if(ex.units<=0) p.assets=p.assets.filter(function(x){return x.instanceId!==ex.instanceId;});
      E.ev("ASSET_SOLD",{playerId:p.id,name:E.stockName(S,sym),pl:pl});
    }
    E.syncPhase(S);
    break; }

  case "PROPOSE_TRADE": {
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    var bcast = action.payload.buyerId===null || action.payload.buyerId===undefined;   // V1：廣播給所有人
    var seller=S.players[action.payload.sellerId], buyer=bcast?null:S.players[action.payload.buyerId];
    if(!seller || (!bcast && (!buyer||seller.id===buyer.id))) return reject("BAD_PARTIES");
    if(seller.bankrupt || (buyer&&buyer.bankrupt)) return reject("BANKRUPT");
    var as=seller.assets.filter(function(x){return x.instanceId===action.payload.assetId;})[0];
    if(!as) return reject("NO_ASSET");
    if(as.linkedLiabilityId) return reject("MORTGAGED");
    var ask=Math.max(0, Math.round(action.payload.price));
    accept();
    if(bcast){
      // 廣播：真人優先（各自畫面跳報價、先搶先贏）；沒有真人或全數婉拒時輪詢電腦
      var bHumans=S.players.filter(function(x){ return !x.isNPC && x.id!==seller.id && !x.bankrupt; });
      if(bHumans.length){
        S.pendingTrade={status:"open",sellerId:seller.id,assetId:as.instanceId,askPrice:ask,name:as.name,declined:{}};
        E.ev("TRADE_BROADCAST",{sellerId:seller.id,name:as.name,ask:ask});
      } else {
        E.resolveOpenTradeNPC(S,seller,as,ask);
      }
    } else if(buyer.isNPC){
      var resp=E.aiTradeResponse(S,buyer,as,ask);
      if(resp.action==="accept"){ E.executeTrade(S,seller,buyer,as,ask); S.pendingTrade=null; }
      else if(resp.action==="counter"){ S.pendingTrade={status:"counter",sellerId:seller.id,buyerId:buyer.id,assetId:as.instanceId,askPrice:ask,counterPrice:resp.price,name:as.name};
        E.ev("TRADE_COUNTER",{sellerId:seller.id,buyerId:buyer.id,name:as.name,ask:ask,counter:resp.price}); }
      else { S.pendingTrade=null; E.ev("TRADE_REJECTED",{buyerId:buyer.id,name:as.name}); }
    } else {
      S.pendingTrade={status:"await_human",sellerId:seller.id,buyerId:buyer.id,assetId:as.instanceId,askPrice:ask,name:as.name};
      E.ev("TRADE_OFFERED",{sellerId:seller.id,buyerId:buyer.id,name:as.name,ask:ask});
    }
    E.syncPhase(S);
    break; }

  case "RESPOND_TRADE": {
    var pt=S.pendingTrade; if(!pt) return reject("NO_TRADE");
    if(pt.status==="open"){
      // V1 廣播報價：任何真人（非賣方、未婉拒）都可搶下或婉拒
      var rp=S.players[action.playerId];
      if(!rp || rp.isNPC || rp.id===pt.sellerId || rp.bankrupt) return reject("BAD_PARTY");
      if(pt.declined[rp.id]) return reject("ALREADY_DECLINED");
      accept();
      var sO=S.players[pt.sellerId];
      var aO=sO.assets.filter(function(x){return x.instanceId===pt.assetId;})[0];
      if(action.payload.accept && aO && rp.cash>=pt.askPrice){
        E.executeTrade(S,sO,rp,aO,pt.askPrice); S.pendingTrade=null;
      } else {
        pt.declined[rp.id]=1;
        var still=S.players.filter(function(x){ return !x.isNPC && x.id!==pt.sellerId && !x.bankrupt && !pt.declined[x.id]; });
        if(!still.length){
          S.pendingTrade=null;
          if(aO) E.resolveOpenTradeNPC(S,sO,aO,pt.askPrice);
          else E.ev("TRADE_REJECTED",{buyerId:null,name:pt.name});
        }
      }
      E.syncPhase(S);
      break;
    }
    // 指定對象：只有當事人能回應（買方回報價、賣方回還價）
    var expect = pt.status==="counter" ? pt.sellerId : pt.buyerId;
    if(action.playerId!==expect) return reject("NOT_TARGET");
    accept();
    if(action.payload.accept && (pt.status==="counter"||pt.status==="await_human")){
      var s2=S.players[pt.sellerId], b2=S.players[pt.buyerId];
      var a2=s2.assets.filter(function(x){return x.instanceId===pt.assetId;})[0];
      var px=pt.status==="counter"?pt.counterPrice:(action.payload.price!==undefined?action.payload.price:pt.askPrice);
      if(a2 && b2.cash>=px) E.executeTrade(S,s2,b2,a2,px);
      else E.ev("TRADE_REJECTED",{buyerId:pt.buyerId,name:pt.name});
    } else {
      E.ev("TRADE_REJECTED",{buyerId:pt.buyerId,name:pt.name});
    }
    S.pendingTrade=null; E.syncPhase(S);
    break; }

  case "CLEAR_TRADE": { accept(); S.pendingTrade=null; break; }

  /* §3.1：機會轉讓已拆除；以下為機會拍賣（密封投標一輪制） */
  case "REFER_OPP": {
    // V10：小機會自己吃不下 → 轉介給別人，收一筆介紹費（行規：1–2 個月現金流）
    var dR=S.pendingDecision;
    if(!dR || dR.kind!=="BUY" || dR.playerId!==p.id) return reject("NO_OPP");
    if(action.payload && action.payload.cardId && action.payload.cardId!==dR.cardId) return reject("STALE_CARD");
    var rCard=ns.content.byId[dR.cardId]; if(!rCard) return reject("NO_CARD");
    var refOpen = action.payload.targetId===null || action.payload.targetId===undefined;   // V4：轉介廣播
    var tgt = refOpen ? null : S.players[action.payload.targetId];
    if(!refOpen && (!tgt || tgt.id===p.id || tgt.bankrupt)) return reject("BAD_TARGET");
    var fee=E.referralFee(S,rCard);
    if(fee<=0) return reject("NO_FEE");
    if(S.pendingReferral) return reject("REFERRAL_PENDING");
    accept();
    if(refOpen){
      // 廣播：真人優先（先接受先成交）；沒有真人或全婉拒 → 輪詢電腦
      var humansR=S.players.filter(function(h){ return !h.isNPC && h.id!==p.id && !h.bankrupt; });
      if(humansR.length){
        S.pendingReferral={ open:true, fromId:p.id, toId:null, cardId:rCard.id, title:rCard.title, fee:fee, declined:{} };
        E.ev("REFERRAL_OFFERED",{open:true, fromId:p.id, toId:null, cardId:rCard.id, title:rCard.title,
          fee:fee, entry:E.oppEntry(S,rCard), income:E.oppIncome(S,rCard)});
        break;
      }
      var settledR=E.referPollNPC(S,p,rCard,fee);
      if(!settledR) E.ev("REFERRAL_REJECTED",{fromId:p.id, toId:null, title:rCard.title, fee:fee});
      p.stats.passedOpps++;
      S.decisionQueue.shift(); E.syncPhase(S);
      break;
    }
    if(!tgt.isNPC){
      // V2：真人對象 → 邀約掛起，對方親自接受或婉拒（不再由系統代答）
      S.pendingReferral={fromId:p.id, toId:tgt.id, cardId:rCard.id, title:rCard.title, fee:fee};
      E.ev("REFERRAL_OFFERED",{fromId:p.id, toId:tgt.id, cardId:rCard.id, title:rCard.title,
        fee:fee, entry:E.oppEntry(S,rCard), income:E.oppIncome(S,rCard)});
      break;
    }
    var accepted=E.npcAcceptReferral(S,tgt,rCard,fee);
    if(accepted) accepted=E.execReferral(S,p,tgt,rCard,fee);
    if(!accepted) E.ev("REFERRAL_REJECTED",{fromId:p.id, toId:tgt.id, title:rCard.title, fee:fee});
    p.stats.passedOpps++;
    S.decisionQueue.shift(); E.syncPhase(S);
    break; }

  case "RESPOND_REFERRAL": {
    // V2：被轉介的真人親自回應；V4：廣播搶答
    var pf=S.pendingReferral; if(!pf) return reject("NO_REFERRAL");
    if(pf.open){
      var rr=S.players[action.playerId];
      if(!rr || rr.isNPC || rr.id===pf.fromId || rr.bankrupt) return reject("BAD_PARTY");
      if(pf.declined[rr.id]) return reject("ALREADY_DECLINED");
      var frmO=S.players[pf.fromId], rcO=ns.content.byId[pf.cardId];
      accept();
      var okO=false;
      if(action.payload.accept && !frmO.bankrupt) okO=E.execReferral(S,frmO,rr,rcO,pf.fee);
      if(okO){
        frmO.stats.passedOpps++;
        S.pendingReferral=null;
        S.decisionQueue.shift(); E.syncPhase(S);
        break;
      }
      pf.declined[rr.id]=1;   // 婉拒或買不起 → 記一票，等其他人
      var stillR=S.players.filter(function(h){ return !h.isNPC && h.id!==pf.fromId && !h.bankrupt && !pf.declined[h.id]; });
      if(!stillR.length){
        S.pendingReferral=null;
        var settled2=E.referPollNPC(S,frmO,rcO,pf.fee);
        if(!settled2) E.ev("REFERRAL_REJECTED",{fromId:pf.fromId, toId:null, title:pf.title, fee:pf.fee});
        frmO.stats.passedOpps++;
        S.decisionQueue.shift(); E.syncPhase(S);
      }
      break;
    }
    if(action.playerId!==pf.toId) return reject("NOT_TARGET");
    var frm=S.players[pf.fromId], tgt2=S.players[pf.toId];
    var rc2=ns.content.byId[pf.cardId]; if(!rc2) return reject("NO_CARD");
    accept();
    var ok2=false;
    if(action.payload.accept && !frm.bankrupt && !tgt2.bankrupt)
      ok2=E.execReferral(S,frm,tgt2,rc2,pf.fee);
    if(!ok2) E.ev("REFERRAL_REJECTED",{fromId:pf.fromId, toId:pf.toId, title:pf.title,
      fee:pf.fee, humanSaidNo:!!(action.payload&&!action.payload.accept)});
    frm.stats.passedOpps++;
    S.pendingReferral=null;
    S.decisionQueue.shift(); E.syncPhase(S);
    break; }

  case "MALL_BUY": {
    // V10：人生商城——花錢買正向活動（進修／健康／保險／人情／比賽）
    // S14a-2：實測時大家很需要在別人的回合先研究並下手，所以非回合放行；
    //         輪到自己時仍受原本的階段規則（要先擲完骰、處理完決策與記帳）。
    if(!actor) return reject("BAD_PLAYER");
    var p = actor;
    if(isMyTurnAction && S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(p.bankrupt) return reject("BANKRUPT");
    var per=E.cfg(S,"mallPerTurn"); if(per===undefined) per=1;
    if(per<=0) return reject("MALL_OFF");
    if((p.mallBoughtThisTurn||0)>=per) return reject("MALL_LIMIT");
    var it=ns.content.byId[action.payload.itemId];
    if(!it || it.kind!=="MALL") return reject("NO_ITEM");
    if(!E.mallAffordable(S,p,it)) return reject("NO_CASH");
    if(it.payload.reqChild && !(p.childrenCount>0)) return reject("NO_CHILD");
    if(it.payload.insurance && p.flags && p.flags.insured) return reject("ALREADY_INSURED");
    if(it.payload.propertyInsurance && p.flags && p.flags.propInsured) return reject("ALREADY_INSURED");
    if(it.oncePerGame && p.mallBought && p.mallBought[it.id]) return reject("ONCE_ONLY");
    // S38（Brian）：比賽拿過獎金就不能再刷同一場——獎金不是提款機
    if(it.payload.contest && p.contestWon && p.contestWon[it.id]) return reject("CONTEST_WON");
    // 效期內不得重複購買（健身房年約／健檢）——UI 灰化只是提示，這裡才是把關
    if(E.mallStillActive(S,p,it)) return reject("STILL_ACTIVE");
    // S13.1 §2：同一項商品的重購冷卻（幸福感遞減之外的第二道）
    if(E.mallCooldownLeft(S,p,it)>0) return reject("MALL_COOLDOWN");
    accept();
    E.mallApply(S,p,it);
    E.syncPhase(S);
    break; }

  case "MALL_CANCEL_PROPERTY": {
    // 年繳已付不退——這正是「自動續約」要教的事：停掉的是下一次，不是這一次
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(!p.flags || !p.flags.propInsured) return reject("NOT_INSURED");
    accept();
    p.flags.propInsured=false; p.flags.propPremium=0; p.flags.propRenewAt=undefined;
    E.ev("PROPERTY_CANCELLED",{playerId:p.id});
    break; }

  case "MALL_CANCEL_INSURANCE": {
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(!p.flags || !p.flags.insured) return reject("NOT_INSURED");
    accept();
    var prem=p.flags.insurancePremium||0;
    p.flags.insured=false; p.flags.insurancePremium=0;
    if(prem) ledger.post(S,p,"解約：醫療＋意外險",
      [{account:"EXPENSE",delta:-prem,label:"保費終止"}],{eduTags:["insurance"]});
    E.ev("INSURANCE_CANCELLED",{playerId:p.id, premium:prem});
    break; }

  /* ==================== M8 S1：學習與準備 ==================== */
  case "START_SKILL": {                       // 主動進修：全額學費 + 額外輪數
    var sk = ns.content.byId[(action.payload||{}).skillId];
    if(!sk || sk.kind!=="SKILL") return reject("NO_SKILL");
    var n0 = E.cfg(S,"skillPerGame"); if(n0===undefined) n0 = 12;
    if(n0 <= 0) return reject("M8_OFF");                              // 關閉開關
    if(S.enabledModules.indexOf("M8") < 0) return reject("M8_OFF");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(p.bankrupt) return reject("BANKRUPT");
    /* S30：外圈不再進修。原本引擎沒擋，但 npc.skillToLearn 擋了——真人學得到、電腦學不到，
       兩邊行為不一致。外圈抽不到 SELF_INVEST、數位資產、獨董邀請，語彙一路都是「專心圓夢」；
       而且這個遊戲的主題就是「準備要在事前做」，補在結算的時候不該還來得及。 */
    if(p.playerStage!=="INNER") return reject("NOT_INNER");
    if((S.skillSample||[]).indexOf(sk.id) < 0) return reject("NOT_AVAILABLE");
    if(sk.requiresSkill && (!p.skills || !p.skills[sk.requiresSkill] || p.skills[sk.requiresSkill].decayed))
      return reject("PREREQUISITE_REQUIRED");
    if(p.learning) return reject("ALREADY_LEARNING");
    if(p.skills[sk.id] && !p.skills[sk.id].decayed) return reject("ALREADY_KNOWN");
    if(S.turnNumber < (p.skillCooldownUntil||0)) return reject("COOLDOWN");
    if(p.cash < E.skillPrice(S,sk,false,p)) return reject("NO_CASH");
    accept();
    E.startLearning(S,p,sk,false);
    E.syncPhase(S);
    break; }

  // S5：切換／停止經營——時間槽一次只給一個
  case "TEND_DIGITAL": {
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(p.bankrupt) return reject("BANKRUPT");
    if(!E.digitalOn(S)) return reject("DIGITAL_OFF");
    // S30：外圈已起飛的長尾本來就不衰減，不需要顧；還沒起飛的在辭職時已經收掉了。
    if(p.playerStage!=="INNER") return reject("NOT_INNER");
    var tid=(action.payload||{}).digitalId || null;
    if(tid!==null){
      if(p.learning) return reject("LEARNING");             // 學習中沒有時間經營
      var tgt=(p.digitalAssets||[]).filter(function(x){ return x.id===tid && !x.dead; })[0];
      if(!tgt) return reject("NO_DIGITAL");
    }
    accept();
    p.tending = tid;
    E.ev("DIGITAL_TENDING",{playerId:p.id, digitalId:tid});
    E.syncPhase(S);
    break; }

  /* S30：請一個人／外包——起飛之後才開放。
     這是一人公司真正的轉折點：你是在經營一份工作，還是在經營一個資產？ */
  case "STAFF_DIGITAL": {
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    if(p.bankrupt) return reject("BANKRUPT");
    if(!E.digitalOn(S)) return reject("DIGITAL_OFF");
    if(p.playerStage!=="INNER") return reject("NOT_INNER");
    var sdId=(action.payload||{}).digitalId;
    var sdOn=!!(action.payload||{}).on;
    var sdD=(p.digitalAssets||[]).filter(function(x){ return x.id===sdId && !x.dead; })[0];
    if(!sdD) return reject("NO_ASSET");
    if(sdD.tier===null) return reject("NOT_TAKEN_OFF");
    if(sdOn && !sdD.staffed && p.cash < E.digitalStaffCost(S,p)) return reject("NO_CASH");
    accept();
    E.setDigitalStaff(S,p,sdD,sdOn);
    E.syncPhase(S);
    break; }

  case "CLOSE_DIGITAL": {
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    var cid=(action.payload||{}).digitalId;
    var tgtC=(p.digitalAssets||[]).filter(function(x){ return x.id===cid && !x.dead; })[0];
    if(!tgtC) return reject("NO_DIGITAL");
    accept();
    E.dropDigital(S,p,tgtC,"主動收掉");
    E.syncPhase(S);
    break; }

  case "ABANDON_SKILL": {                     // 中途放棄：沉沒成本的一課
    if(!p.learning) return reject("NOT_LEARNING");
    accept();
    E.applyAbandonSkill(S,p);
    E.syncPhase(S);
    break; }

  case "START_OPP_AUCTION": {
    var dA=S.pendingDecision;
    if(!dA || dA.kind!=="BUY" || dA.playerId!==p.id) return reject("NO_OPP");
    if(action.payload && action.payload.cardId && action.payload.cardId!==dA.cardId) return reject("STALE_CARD");
    var aCard=ns.content.byId[dA.cardId]; if(!aCard) return reject("NO_CARD");
    if(S.pendingAuction) return reject("AUCTION_PENDING");
    accept();
    E.ev("AUCTION_STARTED",{cardId:aCard.id, title:aCard.title, sellerId:p.id});
    // 1) 電腦出價立即算（決定論）；真人出價 V2 起親自密封投標（PLACE_BID）
    var bids=[], waiting=[];
    S.players.forEach(function(pl){
      if(pl.bankrupt || pl.id===p.id) return;
      if(pl.isNPC) bids.push({playerId:pl.id, amount:E.npcAuctionBid(S,pl,aCard)});
      else waiting.push(pl.id);
    });
    if(waiting.length){
      S.pendingAuction={cardId:aCard.id, title:aCard.title, sellerId:p.id, bids:bids, waiting:waiting};
    } else {
      E.resolveOppAuction(S, p, aCard, bids);
    }
    break; }

  case "PLACE_BID": {
    // V2：真人密封出價（0＝棄標）。全員出完價才開標。
    var pa=S.pendingAuction; if(!pa) return reject("NO_AUCTION");
    if(pa.waiting.indexOf(action.playerId)<0) return reject("NOT_BIDDER");
    var bidder=S.players[action.playerId];   // 注意：p 是回合玩家（賣方），出價人要用 action.playerId
    var bidAmt=Math.max(0, Math.round((action.payload&&action.payload.amount)||0));
    if(bidAmt>bidder.cash) return reject("BID_OVER_CASH");
    accept();
    pa.bids.push({playerId:action.playerId, amount:bidAmt});
    pa.waiting=pa.waiting.filter(function(x){ return x!==action.playerId; });
    E.ev("BID_PLACED",{playerId:action.playerId, remaining:pa.waiting.length, title:pa.title});
    if(!pa.waiting.length){
      var paCard=ns.content.byId[pa.cardId], paSeller=S.players[pa.sellerId];
      S.pendingAuction=null;
      E.resolveOppAuction(S, paSeller, paCard, pa.bids);
    }
    break; }

  /* ======================= §4 P2P 借貸提案（人類發起、NPC 應答） ======================= */
  case "PROPOSE_P2P": {
    var pp=action.payload||{};
    var openBorrow = pp.lenderId===null || pp.lenderId===undefined;      // V3：廣播借款（我要借，問所有人）
    var openLend   = pp.borrowerId===null || pp.borrowerId===undefined;  // V4：廣播放款（我要放款，誰要借）
    if(openBorrow && openLend) return reject("BAD_PARTY");
    var borrower = openLend ? null : S.players[pp.borrowerId];
    var lender   = openBorrow ? null : S.players[pp.lenderId];
    if(!openLend && (!borrower || borrower.bankrupt)) return reject("BAD_PARTY");
    if(!openBorrow && (!lender || lender.bankrupt)) return reject("BAD_PARTY");
    if(lender && borrower && lender.id===borrower.id) return reject("BAD_PARTY");
    if(openBorrow){ if(action.playerId!==borrower.id) return reject("NOT_PARTY"); }
    else if(openLend){ if(action.playerId!==lender.id) return reject("NOT_PARTY"); }
    else { if(action.playerId!==lender.id && action.playerId!==borrower.id) return reject("NOT_PARTY"); }
    var amt=util.r2(pp.amount||0); if(amt<=0) return reject("BAD_AMOUNT");
    var rate=E.rRate(pp.annualRate||0);
    var maxR=E.cfg(S,"p2pMaxRate"); if(maxR===undefined) maxR=0.18;
    if(!(rate>0 && rate<=maxR+1e-9)) return reject("BAD_RATE");
    var term=pp.termMonths|0; if(!(term>0)){ term=E.cfg(S,"p2pDefaultTerm"); if(term===undefined) term=24; }
    if(!openBorrow && lender.cash<amt) return reject("NO_CASH");
    if(openBorrow){
      // V4：向所有人借款的上限＝在場他人現金最大值的 50%
      var maxCash=0;
      S.players.forEach(function(h){ if(h.id!==borrower.id && !h.bankrupt && h.cash>maxCash) maxCash=h.cash; });
      if(amt > util.r2(maxCash*0.5)+0.01) return reject("OVER_BROADCAST_CAP");
    }
    if(S.pendingP2P) return reject("P2P_PENDING");
    accept();
    if(openBorrow){
      // 真人優先（各自畫面跳邀約、先答應先成交）；沒有真人或全婉拒 → 輪詢電腦放款人
      var humansP=S.players.filter(function(h){ return !h.isNPC && h.id!==borrower.id && !h.bankrupt; });
      if(humansP.length){
        S.pendingP2P={ open:true, lenderId:null, borrowerId:borrower.id, amount:amt, rate:rate, term:term,
                       byId:action.playerId, targetId:null, declined:{} };
        E.ev("P2P_OFFERED",{open:true, lenderId:null, borrowerId:borrower.id, amount:amt, rate:rate,
          term:term, byId:action.playerId, targetId:null});
      } else {
        E.p2pPollNPC(S, borrower, amt, rate, term);
      }
      E.syncPhase(S);
      break;
    }
    if(openLend){
      // V4：廣播放款——真人優先（先答應先借到）；沒有真人或全婉拒 → 輪詢電腦借款人
      var humansL=S.players.filter(function(h){ return !h.isNPC && h.id!==lender.id && !h.bankrupt; });
      if(humansL.length){
        S.pendingP2P={ openLend:true, lenderId:lender.id, borrowerId:null, amount:amt, rate:rate, term:term,
                       byId:action.playerId, targetId:null, declined:{} };
        E.ev("P2P_OFFERED",{openLend:true, lenderId:lender.id, borrowerId:null, amount:amt, rate:rate,
          term:term, byId:action.playerId, targetId:null});
      } else {
        E.p2pPollNPCBorrowers(S, lender, amt, rate, term);
      }
      E.syncPhase(S);
      break;
    }
    var other = (action.playerId===lender.id) ? borrower : lender;
    if(!other.isNPC){
      // V1：對手是真人 → 送出邀約，由對方親自決定（跨裝置時在對方畫面跳出）
      S.pendingP2P={ lenderId:lender.id, borrowerId:borrower.id, amount:amt, rate:rate, term:term,
                     byId:action.playerId, targetId:other.id };
      E.ev("P2P_OFFERED",{lenderId:lender.id, borrowerId:borrower.id, amount:amt, rate:rate,
        term:term, byId:action.playerId, targetId:other.id});
      E.syncPhase(S);
      break;
    }
    var ok;
    if(other.id===lender.id){
      // 對方是放款人：cash − amount ≥ reserve×倍數 且 rate ≥ 動態下限
      var wL = other.isNPC ? ns.content.personalityById[other.npcPersonality].weights : {cashReserveFloor:3};
      var rm=E.cfg(S,"p2pLenderReserveMult"); if(rm===undefined) rm=1.5;
      ok = (other.cash-amt >= wL.cashReserveFloor*other.derived.totalExpenses*rm)
           && (rate >= E.p2pMinRate(S,borrower)-1e-9);
    } else {
      // 對方是借款人：銀行 DBR 已滿（信用額度用罄）且利率不超過上限
      ok = (E.creditCapacity(S,other) < 1) && (rate <= maxR+1e-9);
    }
    if(!ok){
      E.ev("P2P_REJECTED",{lenderId:lender.id, borrowerId:borrower.id, amount:amt, rate:rate,
        byId:other.id, minRate:E.p2pMinRate(S,borrower)});
      break;
    }
    E.formP2P(S,lender,borrower,amt,rate,term);
    E.syncPhase(S);
    break; }

  case "RESPOND_P2P": {
    var pq=S.pendingP2P; if(!pq) return reject("NO_P2P");
    if(pq.openLend){
      // V4 廣播放款：任何真人（非放款人、未婉拒）都可借入或婉拒
      var rb=S.players[action.playerId];
      if(!rb || rb.isNPC || rb.id===pq.lenderId || rb.bankrupt) return reject("BAD_PARTY");
      if(pq.declined[rb.id]) return reject("ALREADY_DECLINED");
      accept();
      var lnL=S.players[pq.lenderId];
      if(action.payload.accept && lnL.cash>=pq.amount && !lnL.bankrupt){
        S.pendingP2P=null;
        E.formP2P(S, lnL, rb, pq.amount, pq.rate, pq.term);
      } else {
        pq.declined[rb.id]=1;
        var stillL=S.players.filter(function(h){ return !h.isNPC && h.id!==pq.lenderId && !h.bankrupt && !pq.declined[h.id]; });
        if(!stillL.length){
          S.pendingP2P=null;
          E.p2pPollNPCBorrowers(S, lnL, pq.amount, pq.rate, pq.term);
        }
      }
      E.syncPhase(S);
      break;
    }
    if(pq.open){
      // V3 廣播借款：任何真人（非借款人、未婉拒）都可放款或婉拒
      var rl=S.players[action.playerId];
      if(!rl || rl.isNPC || rl.id===pq.borrowerId || rl.bankrupt) return reject("BAD_PARTY");
      if(pq.declined[rl.id]) return reject("ALREADY_DECLINED");
      accept();
      var bw2=S.players[pq.borrowerId];
      if(action.payload.accept && rl.cash>=pq.amount && !bw2.bankrupt){
        S.pendingP2P=null;
        E.formP2P(S, rl, bw2, pq.amount, pq.rate, pq.term);
      } else {
        pq.declined[rl.id]=1;
        var stillP=S.players.filter(function(h){ return !h.isNPC && h.id!==pq.borrowerId && !h.bankrupt && !pq.declined[h.id]; });
        if(!stillP.length){
          S.pendingP2P=null;
          E.p2pPollNPC(S, bw2, pq.amount, pq.rate, pq.term);
        }
      }
      E.syncPhase(S);
      break;
    }
    if(action.playerId!==pq.targetId) return reject("NOT_TARGET");
    accept();
    var lnR=S.players[pq.lenderId], bwR=S.players[pq.borrowerId];
    if(action.payload.accept && !lnR.bankrupt && !bwR.bankrupt && lnR.cash>=pq.amount){
      E.formP2P(S,lnR,bwR,pq.amount,pq.rate,pq.term);
    } else {
      E.ev("P2P_REJECTED",{lenderId:pq.lenderId, borrowerId:pq.borrowerId, amount:pq.amount,
        rate:pq.rate, byId:pq.targetId, minRate:E.p2pMinRate(S,bwR), humanSaidNo:true});
    }
    S.pendingP2P=null;
    E.syncPhase(S);
    break; }

  /* ===================== §3.2 合資 JV（出資比＝股權比） ===================== */
  case "PROPOSE_JV": {
    var dJ=S.pendingDecision;
    if(!dJ || dJ.kind!=="BUY" || dJ.playerId!==p.id) return reject("NO_OPP");
    if(action.payload.cardId && action.payload.cardId!==dJ.cardId) return reject("STALE_CARD");
    var jCard=ns.content.byId[dJ.cardId]; if(!jCard) return reject("NO_CARD");
    if(jCard.kind!=="REALESTATE" && jCard.kind!=="BUSINESS") return reject("BAD_KIND");
    var jvOpen = action.payload.partnerId===null || action.payload.partnerId===undefined;   // V3：廣播合資
    var partner = jvOpen ? null : S.players[action.payload.partnerId];
    if(!jvOpen && (!partner || partner.bankrupt || partner.id===p.id)) return reject("BAD_PARTNER");
    var minS=E.cfg(S,"jvMinShare"); if(minS===undefined) minS=0.2;
    var myShare=util.r2(action.payload.myShare);
    if(!(myShare>=minS-1e-9 && myShare<=1-minS+1e-9)) return reject("BAD_SHARE");
    if(S.pendingJV) return reject("JV_PENDING");
    accept();
    if(!jvOpen && partner.isNPC){
      // NPC 夥伴：沿用水位規則自動評估（電腦不亂投）
      if(!E.jvNpcWilling(S,partner,jCard,myShare)){
        E.ev("JV_REJECTED",{cardId:jCard.id, title:jCard.title, partnerId:partner.id, reason:"partner"});
        break;                                        // BUY 決策保留
      }
      var whyN=E.execJV(S,p,partner,jCard,myShare);
      if(whyN) E.ev("JV_REJECTED",{cardId:jCard.id, title:jCard.title, partnerId:partner.id, reason:whyN});
      break;
    }
    if(!jvOpen){
      // V3：真人夥伴 → 邀約掛起，由對方親自決定（不再用水位規則替真人拒絕）
      S.pendingJV={ cardId:jCard.id, title:jCard.title, fromId:p.id, myShare:myShare,
                    targetId:partner.id, declined:null };
      E.ev("JV_OFFERED",{cardId:jCard.id, title:jCard.title, fromId:p.id, targetId:partner.id,
        myShare:myShare, entry:E.oppEntry(S,jCard), income:E.oppIncome(S,jCard)});
      break;
    }
    // 廣播：真人優先（先答應先合資）；沒有真人或全婉拒 → 輪詢電腦
    var humansJ=S.players.filter(function(h){ return !h.isNPC && h.id!==p.id && !h.bankrupt; });
    if(humansJ.length){
      S.pendingJV={ cardId:jCard.id, title:jCard.title, fromId:p.id, myShare:myShare,
                    targetId:null, declined:{} };
      E.ev("JV_OFFERED",{cardId:jCard.id, title:jCard.title, fromId:p.id, targetId:null,
        myShare:myShare, entry:E.oppEntry(S,jCard), income:E.oppIncome(S,jCard)});
    } else {
      E.jvPollNPC(S,p,jCard,myShare);
    }
    break; }

  case "RESPOND_JV": {
    // V3：被邀合資的真人親自回應（指定對象或廣播搶答）
    var pj=S.pendingJV; if(!pj) return reject("NO_JV");
    var frmJ=S.players[pj.fromId], cardJ=ns.content.byId[pj.cardId];
    if(!frmJ || !cardJ) return reject("NO_CARD");
    if(pj.targetId!==null && pj.targetId!==undefined){
      if(action.playerId!==pj.targetId) return reject("NOT_TARGET");
      accept();
      if(action.payload.accept){
        var whyT=E.execJV(S,frmJ,S.players[action.playerId],cardJ,pj.myShare);
        if(whyT) E.ev("JV_REJECTED",{cardId:pj.cardId, title:pj.title, partnerId:action.playerId, reason:whyT});
      } else {
        E.ev("JV_REJECTED",{cardId:pj.cardId, title:pj.title, partnerId:action.playerId,
          reason:"partner", humanSaidNo:true});
      }
      S.pendingJV=null; E.syncPhase(S); break;
    }
    var rpJ=S.players[action.playerId];
    if(!rpJ || rpJ.isNPC || rpJ.id===pj.fromId || rpJ.bankrupt) return reject("BAD_PARTY");
    if(pj.declined[rpJ.id]) return reject("ALREADY_DECLINED");
    accept();
    var settled=false;
    if(action.payload.accept){
      var whyO=E.execJV(S,frmJ,rpJ,cardJ,pj.myShare);
      if(!whyO) settled=true;
      else E.ev("JV_CANT",{playerId:rpJ.id, title:pj.title, reason:whyO});   // 想合但出不起 → 視同婉拒
    }
    if(settled){ S.pendingJV=null; }
    else {
      pj.declined[rpJ.id]=1;
      var stillJ=S.players.filter(function(h){ return !h.isNPC && h.id!==pj.fromId && !h.bankrupt && !pj.declined[h.id]; });
      if(!stillJ.length){ S.pendingJV=null; E.jvPollNPC(S,frmJ,cardJ,pj.myShare); }
    }
    E.syncPhase(S);
    break; }


  /* ===================== S39：多玩家集資（Brian 裁示：一輪內湊不滿就流標） =====================
     發起人在 BUY 決策上設自己的持份，剩餘持份廣播；真人（含非回合）與電腦都可認購，先到先得，
     湊滿即成交；發起人下一次回合開始前還沒湊滿 → 流標，機會回到發起人手上（可自己買或放棄）。
     每人一份獨立資產（持份等比例，與雙人合資同一套 jvGroupId／sharePct）。 */
  case "PROPOSE_SYNDICATE": {
    var dS=S.pendingDecision;
    if(!dS || dS.kind!=="BUY" || dS.playerId!==p.id) return reject("NO_OPP");
    if(action.payload.cardId && action.payload.cardId!==dS.cardId) return reject("STALE_CARD");
    var sCard=ns.content.byId[dS.cardId]; if(!sCard) return reject("NO_CARD");
    if(sCard.kind!=="REALESTATE" && sCard.kind!=="BUSINESS") return reject("BAD_KIND");
    if(!(E.oppIncome(S,sCard)>0)) return reject("BAD_KIND");
    if(S.pendingSyndicate) return reject("SYNDICATE_PENDING");
    if(S.pendingJV && S.pendingJV.cardId===sCard.id) return reject("JV_PENDING");
    var minSS=E.cfg(S,"jvMinShare"); if(minSS===undefined) minSS=0.2;
    var myS=util.r2(action.payload.myShare);
    if(!(myS>=minSS-1e-9 && myS<=1-minSS+1e-9)) return reject("BAD_SHARE");
    if(p.cash < E.syndicateNeed(S,p,sCard,myS)) return reject("NO_CASH");
    accept();
    S.decisionQueue.shift();
    var shares={}; shares[p.id]=myS;
    S.pendingSyndicate={ id:util.uid(S,"SY"), cardId:sCard.id, title:sCard.title, fromId:p.id,
      openedTurn:S.turnNumber, minShare:minSS, shares:shares, declined:{},
      entry:E.oppEntry(S,sCard), income:E.oppIncome(S,sCard) };
    E.ev("SYNDICATE_OPENED",{id:S.pendingSyndicate.id, cardId:sCard.id, title:sCard.title, fromId:p.id,
      myShare:myS, remaining:util.r2(1-myS), entry:S.pendingSyndicate.entry, income:S.pendingSyndicate.income,
      minShare:minSS});
    E.afterResolve(S,p);
    break; }

  case "JOIN_SYNDICATE": {
    var ps=S.pendingSyndicate; if(!ps) return reject("NO_SYNDICATE");
    var jp=S.players[action.playerId];
    if(!jp || jp.bankrupt || jp.playerStage!=="INNER") return reject("BAD_PARTY");
    if(jp.id===ps.fromId || ps.shares[jp.id]!==undefined) return reject("ALREADY_IN");
    var remJ=E.syndicateRemaining(ps);
    if(remJ<=1e-9) return reject("FULL");
    var shJ=util.r2(action.payload.share);
    var floorJ=Math.min(ps.minShare, remJ);
    if(!(shJ>=floorJ-1e-9 && shJ<=remJ+1e-9)) return reject("BAD_SHARE");
    if(shJ>remJ) shJ=remJ;
    var cardJ2=ns.content.byId[ps.cardId]; if(!cardJ2) return reject("NO_CARD");
    if(jp.cash < E.syndicateNeed(S,jp,cardJ2,shJ)) return reject("NO_CASH");
    accept();
    ps.shares[jp.id]=shJ; delete ps.declined[jp.id];
    E.ev("SYNDICATE_JOINED",{id:ps.id, cardId:ps.cardId, title:ps.title, playerId:jp.id, share:shJ,
      remaining:E.syndicateRemaining(ps)});
    if(E.syndicateRemaining(ps)<=1e-9) E.settleSyndicate(S,"filled");
    E.syncPhase(S);
    break; }

  case "DECLINE_SYNDICATE": {
    var ps2=S.pendingSyndicate; if(!ps2) return reject("NO_SYNDICATE");
    var dp2=S.players[action.playerId]; if(!dp2) return reject("BAD_PARTY");
    if(dp2.id===ps2.fromId || ps2.shares[dp2.id]!==undefined) return reject("ALREADY_IN");
    accept();
    ps2.declined[dp2.id]=1;
    E.ev("SYNDICATE_DECLINED",{id:ps2.id, title:ps2.title, playerId:dp2.id});
    E.syncPhase(S);
    break; }

  case "END_GAME": {
    // 七期：玩家可隨時結束遊戲；V3：多人局房主可能不是 0 號座——任何真人皆可（UI 只給房主）
    var pe=S.players[action.playerId];
    if(!pe || pe.isNPC) return reject("BAD_PLAYER");
    accept(); E.finishByRanking(S,"MANUAL"); E.syncPhase(S); break; }

  case "EXTEND_GAME": {
    // S14b：99 輪到期還沒人自由時，桌上常常還想再打一段。延長 = 把回合上限往後推，
    // 局內狀態一律不動（不退錢、不重算、不清紀錄），所以延長前後的帳是連續的。
    var px=S.players[action.playerId];
    if(!px || px.isNPC) return reject("BAD_PLAYER");
    if(S.over && S.overReason!=="MAX_TURNS") return reject("GAME_ALREADY_DECIDED");
    var addT = action.payload && isFinite(action.payload.turns)
      ? Math.round(action.payload.turns) : Math.round(E.cfg(S,"extendTurns")||20);
    if(!(addT>0)) return reject("BAD_TURNS");
    var capT = 400;   // 硬上限：避免手滑或惡意輸入把局面推成無限長
    var newMax = Math.min(capT, (S.config.maxTurns||0) + addT);
    if(newMax<=S.config.maxTurns) return reject("AT_MAX");
    accept();
    var wasOver = !!S.over;
    S.config.maxTurns = newMax;
    S.extendCount = (S.extendCount||0)+1;
    ev("GAME_EXTENDED",{playerId:px.id, addedTurns:addT, maxTurns:newMax,
                        resumed:wasOver, extendCount:S.extendCount});
    if(wasOver){
      // 復盤續打：清掉「時間到排名」留下的結局標記，回到當時那一輪的開頭。
      S.over=false; S.winner=null; S.overReason=null;
      E.beginTurn(S);
    }
    E.syncPhase(S); break; }

  case "PLAYER_LEAVE": {
    // V3：真人離席 → 座位交給電腦代打；懸置中等他回應的互動以「婉拒／棄標」決定論代答
    var lp=S.players[action.playerId];
    if(!lp || lp.isNPC || lp.bankrupt) return reject("BAD_PLAYER");
    accept();
    lp.isNPC=true; lp.npcPersonality=lp.npcPersonality||"NPC_SAFE";
    lp.flags=lp.flags||{}; lp.flags.leftHuman=true;
    if(S.bookkeeping && S.bookkeeping.playerId===lp.id) S.bookkeeping=null;
    var ptL=S.pendingTrade;
    if(ptL){
      if(ptL.status==="await_human" && ptL.buyerId===lp.id){
        S.pendingTrade=null; E.ev("TRADE_REJECTED",{buyerId:lp.id,name:ptL.name});
      } else if(ptL.status==="counter" && ptL.sellerId===lp.id){
        S.pendingTrade=null; E.ev("TRADE_REJECTED",{buyerId:ptL.buyerId,name:ptL.name});
      } else if(ptL.status==="open"){
        if(ptL.sellerId===lp.id){ S.pendingTrade=null; }
        else {
          ptL.declined[lp.id]=1;
          var stillT=S.players.filter(function(h){ return !h.isNPC && h.id!==ptL.sellerId && !h.bankrupt && !ptL.declined[h.id]; });
          if(!stillT.length){
            var sT=S.players[ptL.sellerId], aT=sT.assets.filter(function(x){return x.instanceId===ptL.assetId;})[0];
            S.pendingTrade=null;
            if(aT) E.resolveOpenTradeNPC(S,sT,aT,ptL.askPrice);
          }
        }
      } else if(ptL.sellerId===lp.id){ S.pendingTrade=null; }
    }
    var pqL=S.pendingP2P;
    if(pqL){
      if(pqL.openLend){
        if(pqL.lenderId===lp.id){ S.pendingP2P=null; }
        else if(!pqL.declined[lp.id]){
          pqL.declined[lp.id]=1;
          var stillL2=S.players.filter(function(h){ return !h.isNPC && h.id!==pqL.lenderId && !h.bankrupt && !pqL.declined[h.id]; });
          if(!stillL2.length){ var lnL2=S.players[pqL.lenderId]; S.pendingP2P=null;
            E.p2pPollNPCBorrowers(S,lnL2,pqL.amount,pqL.rate,pqL.term); }
        }
      } else if(pqL.open){
        if(pqL.borrowerId===lp.id){ S.pendingP2P=null; }
        else {
          pqL.declined[lp.id]=1;
          var stillP2=S.players.filter(function(h){ return !h.isNPC && h.id!==pqL.borrowerId && !h.bankrupt && !pqL.declined[h.id]; });
          if(!stillP2.length){ var bwL=S.players[pqL.borrowerId]; S.pendingP2P=null;
            E.p2pPollNPC(S,bwL,pqL.amount,pqL.rate,pqL.term); }
        }
      } else if(pqL.targetId===lp.id || pqL.byId===lp.id){
        S.pendingP2P=null;
        E.ev("P2P_REJECTED",{lenderId:pqL.lenderId, borrowerId:pqL.borrowerId, amount:pqL.amount,
          rate:pqL.rate, byId:lp.id, minRate:E.p2pMinRate(S,S.players[pqL.borrowerId]), humanSaidNo:true});
      }
    }
    var paL=S.pendingAuction;
    if(paL && paL.waiting.indexOf(lp.id)>=0){
      paL.bids.push({playerId:lp.id, amount:0});
      paL.waiting=paL.waiting.filter(function(x){ return x!==lp.id; });
      if(!paL.waiting.length){
        var cardL=ns.content.byId[paL.cardId], sellerL=S.players[paL.sellerId];
        S.pendingAuction=null;
        E.resolveOppAuction(S, sellerL, cardL, paL.bids);
      }
    }
    var pfL=S.pendingReferral;
    if(pfL){
      if(pfL.open){
        if(pfL.fromId===lp.id){
          S.pendingReferral=null; S.decisionQueue.shift(); lp.stats.passedOpps++;
        } else if(!pfL.declined[lp.id]){
          pfL.declined[lp.id]=1;
          var stillR2=S.players.filter(function(h){ return !h.isNPC && h.id!==pfL.fromId && !h.bankrupt && !pfL.declined[h.id]; });
          if(!stillR2.length){
            var frmR2=S.players[pfL.fromId], rcR2=ns.content.byId[pfL.cardId];
            S.pendingReferral=null;
            var settled3=E.referPollNPC(S,frmR2,rcR2,pfL.fee);
            if(!settled3) E.ev("REFERRAL_REJECTED",{fromId:pfL.fromId, toId:null, title:pfL.title, fee:pfL.fee});
            frmR2.stats.passedOpps++;
            S.decisionQueue.shift();
          }
        }
      } else if(pfL.toId===lp.id || pfL.fromId===lp.id){
        var frmL=S.players[pfL.fromId];
        E.ev("REFERRAL_REJECTED",{fromId:pfL.fromId, toId:pfL.toId, title:pfL.title, fee:pfL.fee, humanSaidNo:true});
        frmL.stats.passedOpps++;
        S.pendingReferral=null;
        S.decisionQueue.shift();
      }
    }
    var pjL=S.pendingJV;
    if(pjL){
      if(pjL.fromId===lp.id){
        // S41（Brian：「合資不見了、log 看不出來」）：這條原本靜默清掉——現在發事件進訊息欄
        S.pendingJV=null;
        E.ev("JV_REJECTED",{cardId:pjL.cardId, title:pjL.title, partnerId:null, reason:"left", fromId:lp.id});
      }
      else if(pjL.targetId===lp.id){
        S.pendingJV=null;
        E.ev("JV_REJECTED",{cardId:pjL.cardId, title:pjL.title, partnerId:lp.id, reason:"partner", humanSaidNo:true});
      } else if(pjL.targetId===null && pjL.declined && !pjL.declined[lp.id]){
        pjL.declined[lp.id]=1;
        var stillJ2=S.players.filter(function(h){ return !h.isNPC && h.id!==pjL.fromId && !h.bankrupt && !pjL.declined[h.id]; });
        if(!stillJ2.length){ var frmJ2=S.players[pjL.fromId], cardJ2=ns.content.byId[pjL.cardId];
          S.pendingJV=null; E.jvPollNPC(S,frmJ2,cardJ2,pjL.myShare); }
      }
    }
    E.ev("PLAYER_LEFT",{playerId:lp.id, forcedBy:(action.payload && action.payload.forcedBy!==undefined && action.payload.forcedBy!==null) ? action.payload.forcedBy : null,
                        why:(action.payload && action.payload.why) || null});   // S41：別人替離線／久未動作的座位交電腦代打
    E.syncPhase(S);
    break; }

  case "PLAYER_RETURN": {
    // V3：離席的真人回來接手（只有原座位主人能認回——多人層以 uid 把關）
    var rp0=S.players[action.playerId];
    if(!rp0 || !rp0.isNPC || !(rp0.flags && rp0.flags.leftHuman)) return reject("BAD_PLAYER");
    accept();
    rp0.isNPC=false; delete rp0.flags.leftHuman;
    E.ev("PLAYER_RETURNED",{playerId:rp0.id});
    E.syncPhase(S);
    break; }

  case "TOP_UP_MARGIN": {
    var pT=S.players[action.playerId]; if(!pT||pT.bankrupt) return reject("BAD_PLAYER");
    var lT=pT.liabilities.filter(function(x){return x.instanceId===action.payload.liabilityId;})[0];
    if(!lT || lT.kind!=="MARGIN") return reject("NO_LOAN");
    var aT=pT.assets.filter(function(x){return x.instanceId===lT.collateralAssetId;})[0];
    if(!aT) return reject("NO_ASSET");
    var restoreT=S.config.marginRestoreLevel||1.66;
    var needT=util.r2(Math.max(0, lT.principal - aT.marketValue/restoreT));
    if(needT<=0.01){ accept(); if(lT.flags) delete lT.flags.marginWarned; break; }
    if(pT.cash < needT) return reject("NO_CASH");
    accept();
    E.repay(S,pT,lT,Math.min(needT,lT.principal));
    var lT2=pT.liabilities.filter(function(x){return x.instanceId===action.payload.liabilityId;})[0];
    if(lT2 && lT2.flags) delete lT2.flags.marginWarned;
    E.ev("MARGIN_TOPUP",{playerId:pT.id, name:aT.name, amount:needT});
    break; }

  case "REPAY_LOAN": {
    // S14a-2：提前還本不影響任何人，開放在別人的回合也能做（實測回饋）。
    if(!actor || actor.bankrupt) return reject("BAD_PLAYER");
    var l = actor.liabilities.filter(function(x){return x.instanceId===action.payload.liabilityId;})[0];
    if(!l) return reject("NO_LIABILITY");
    if(l.kind==="P2P") return reject("P2P_NO_PREPAY");   // V3：民間借貸按期攤還給對方，不走銀行提前還本
    var amt = Math.min(action.payload.amount, l.principal, actor.cash);
    if(amt<=0) return reject("NO_CASH");
    accept(); E.repay(S,actor,l,amt);
    if(!isMyTurnAction) E.markOffTurnLedger(actor);      // 非回合做的帳，輪到自己時仍要記
    E.syncPhase(S);
    break; }

  case "TAKE_LOAN": {
    // S15：這個 case 原本整段用 p（＝當前回合玩家）。開放「收到邀約時借款」之後，
    // 借款人可能不是當前玩家——沿用 p 會把錢撥給別人。一律改指向 actor。
    var lp = actor;
    if(!E.canUseLoan(S) && S.phase!=="BANKRUPTCY") return reject("DEPTH_LOCKED");
    var isRescue = (S.phase==="BANKRUPTCY" && lp===p);   // 紓困只在自己的破產程序中
    var cap = isRescue ? E.rescueCap(S,lp) : E.creditCapacity(S,lp);
    var amt2 = Math.min(action.payload.amount, cap);
    if(amt2<=0) return reject("NO_CAPACITY");
    accept();
    var lname = isRescue ? "紓困貸款" : "信用貸款";
    if(isRescue && lp.creditFlags) lp.creditFlags.usedRescue=true;   // M7：動用紓困＝永久信用瑕疵
    var lspread = isRescue ? E.cfg(S,"rescueLoanSpread") : E.cfg(S,"creditSpread");
    E.addLiability(S,lp,"CONSUMER",lname,amt2, S.macro.baseRate+lspread, false);
    ledger.post(S,lp,lname+"撥款",[{account:"CASH",delta:amt2,label:"貸款撥款"}],{eduTags:["debt"]});
    if(lp!==p) E.markOffTurnLedger(lp);   // 非回合做的帳，輪到自己時照樣要記
    if(isRescue) E.checkRescued(S,lp); else E.syncPhase(S);
    break; }

  case "REFINANCE": {
    if(!E.canUseAdvanced(S)) return reject("DEPTH_LOCKED");
    var l2 = p.liabilities.filter(function(x){return x.instanceId===action.payload.liabilityId;})[0];
    if(!l2 || l2.kind!=="MORTGAGE") return reject("NO_LIABILITY");
    var fee = util.r2(l2.principal*E.cfg(S,"refiFee"));
    if(p.cash<fee) return reject("NO_CASH");
    accept();
    var nr = E.rRate(S.macro.baseRate+E.cfg(S,"mortgageSpread")+E.creditSpread(S,p));
    l2.annualRate=nr; l2.isFloating=false;
    var dd = E.repriceLoan(l2);
    ledger.post(S,p,"轉貸："+l2.name,[{account:"CASH",delta:-fee,label:"轉貸手續費"},
      {account:"EXPENSE",delta:dd,refId:l2.instanceId,label:l2.name+" 月付調整"}],{eduTags:["refi"]});
    ev("REFINANCED",{liabilityId:l2.instanceId, rate:nr});
    E.syncPhase(S);
    break; }

  case "CASHOUT_REFI": {
    if(!E.canUseAdvanced(S)) return reject("DEPTH_LOCKED");
    var a2 = p.assets.filter(function(x){return x.instanceId===action.payload.assetId;})[0];
    if(!a2 || a2.kind!=="REALESTATE") return reject("NO_ASSET");
    if(S.enabledModules.indexOf("M4")>=0 && S.macro.stage!=="BOOM") return reject("NOT_BOOM");
    if(a2.marketValue<=a2.costBasis) return reject("NO_GAIN");
    var lk = p.liabilities.filter(function(x){return x.instanceId===a2.linkedLiabilityId;})[0];
    var room = util.r2(a2.marketValue*E.cfg(S,"cashoutLTV") - (lk?lk.principal:0));
    if(room<=0) return reject("NO_ROOM");
    accept();
    if(lk){ var addP=room;
      lk.principal=util.r2(lk.principal+addP);
      var d2=E.repriceLoan(lk);
      ledger.post(S,p,"增貸套現："+a2.name,[{account:"CASH",delta:addP,label:"增貸撥款"},
        {account:"LIABILITY",delta:addP,refId:lk.instanceId,label:lk.name},
        {account:"EXPENSE",delta:d2,refId:lk.instanceId,label:lk.name+" 月付調整"}],{eduTags:["leverage","cashout"]});
    } else { E.addLiability(S,p,"MORTGAGE",a2.name+" 抵押貸款",room, S.macro.baseRate+E.cfg(S,"mortgageSpread"), true, a2.instanceId);
      ledger.post(S,p,"增貸套現："+a2.name,[{account:"CASH",delta:room,label:"增貸撥款"}],{eduTags:["leverage","cashout"]}); }
    ev("CASHED_OUT",{amount:room});
    E.syncPhase(S);
    break; }

  case "BUY_DREAM_PROGRESS": {
    if(p.playerStage!=="OUTER") return reject("NOT_OUTER");
    if(p.boughtProgressThisTurn) return reject("ALREADY_BOUGHT");   // v0.2：每回合限購 1 點
    if(E.freeProgressThisTurn(S,p)) return reject("FREE_THIS_TURN"); // S40：踩到聖地那一輪不再賣
    accept();
    E.buyDreamProgress(S,p);
    E.syncPhase(S);
    break; }

  case "RETURN_TO_WORK": {
    if(p.playerStage!=="OUTER") return reject("NOT_OUTER");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    accept(); E.freefall(S,p,{voluntary:true}); E.syncPhase(S);
    break; }

  case "GRADUATE_NOW": {
    if(p.playerStage!=="INNER") return reject("NOT_INNER");
    if(!(p.derived.passiveIncome >= p.derived.totalExpenses && p.derived.totalExpenses>0)) return reject("NOT_FREE");
    if(S.phase!=="ROLL" && S.phase!=="READY_END") return reject("WRONG_PHASE");
    accept(); E.enterOuterCircle(S,p); E.syncPhase(S);
    break; }

  case "END_TURN": {
    if(S.phase==="BANKRUPTCY") return reject("IN_BANKRUPTCY");
    if(S.pendingDecision) return reject("PENDING_DECISION");
    if(S.bookkeeping && S.bookkeeping.tasks.some(function(t){return !t.done;})) return reject("BOOKKEEPING_INCOMPLETE");
    if(!S.turnResolved) return reject("MUST_ROLL");
    accept();
    if(E.checkBlessing(S,p)) break;   // §2.4：有盲盒待開 → 先進決策，本回合稍後再結束
    E.endTurn(S);
    break; }

  default: return reject("UNKNOWN_ACTION");
  }

  E.syncPhase(S);
  return { state:S, events:E._events };
};

/* ============================== 移動與發薪 =============================== */
/* S14b：每輪固定發薪。
   舊制是「走過幾個發薪格就發幾次薪」——平均每回合 0.875 次，而且會因為骰運忽多忽少。
   改成每個人每回合開始固定結算一次，節奏穩定；發薪格因此沒有存在的必要，
   空出來的格子配給 機會／人生／市場／生活（Brian 的實測要求）。
   fixedPayday=0 就整套回到舊制，盤面也原封不動（鐵律二：關掉開關＝回到基線）。 */
E.fixedPaydayOn = function(S){ var v=E.cfg(S,"fixedPayday"); return v===undefined ? 0 : v; };
// 第 k 個發薪格換成什麼——依序取用。這樣挑是為了：每一類都變多、且不與左右鄰格同型。
// 換完的分佈：機會 8、生活 5、人生 5、市場 5、失業 1（原本：發薪 6、機會 7、生活 3、人生 4、市場 3、失業 1）
E.PAYDAY_REPLACE = ["MARKET","OPPORTUNITY","MARKET","LIFESTYLE","LIFESTYLE","LIFE_EVENT"];
E.buildBoards = function(S){
  delete S.boardLayout; delete S.boardLayoutOuter;
  if(!E.fixedPaydayOn(S)) return;                       // 舊制：完全沿用內容包的盤面
  var k=0;
  S.boardLayout = ns.content.boardLayout.map(function(sp){
    if(sp.type!=="PAYDAY") return sp;
    var c={}; for(var key in sp) c[key]=sp[key];
    c.type = E.PAYDAY_REPLACE[k % E.PAYDAY_REPLACE.length]; k++;
    c.wasPayday = true;                                  // 留痕：這格原本是發薪格
    return c;
  });
  if(ns.content.boardLayoutOuter){
    S.boardLayoutOuter = ns.content.boardLayoutOuter.map(function(sp){
      if(sp.type!=="OPAYDAY") return sp;
      var c={}; for(var key in sp) c[key]=sp[key];
      c.type="OEVENT"; c.wasPayday=true;                 // 夢想圈的「現金流」格同理換成「風雲」
      return c;
    });
  }
};
// 本局實際使用的盤面（固定發薪時是換過發薪格的版本）
E.board = function(S, outer){
  return outer ? (S.boardLayoutOuter || ns.content.boardLayoutOuter)
               : (S.boardLayout || ns.content.boardLayout);
};
E.doMove = function(S,p,roll){
  p.atDreamSite=false;
  var outer = p.playerStage==="OUTER";
  var board = E.board(S, outer);
  var n = board.length, pos = outer ? p.outerPos : p.position, paydays=0, path=[];
  var crossPay = !E.fixedPaydayOn(S);          // S14b：固定發薪時，跨越不再發薪
  for(var i=1;i<=roll;i++){
    var np = (pos+i)%n; path.push(np);
    var t = board[np].type;
    if(crossPay && (t==="PAYDAY"||t==="OPAYDAY")) paydays++;
  }
  var dest = (pos+roll)%n;
  if(outer) p.outerPos=dest; else p.position=dest;
  E.ev("MOVED",{playerId:p.id, from:pos, to:dest, path:path, outer:outer});

  for(var k=0;k<paydays;k++){ if(S.over||p.bankrupt) break; E.payday(S,p); }
  if(S.phase==="BANKRUPTCY"||S.over){ S.turnResolved=true; return; }

  E.landing(S,p,board[dest]);
  E.offerDreamProgress(S,p);   // v0.2：外圈每回合一次購點機會（任何格）
  E.afterResolve(S,p);
};

// 每月本金攤還：月付＝EXPENSE（已含利息+本金），此處把本金部分從餘額扣掉
E.amortize = function(S, p){
  if(p.bankrupt) return;
  p.liabilities.slice().forEach(function(l){
    if(l.kind==="MARGIN" || !l.termMonths) return;          // 融資只付息、不攤還
    if(l.kind==="P2P") return;                               // §4：P2P 金流在 onRoundEnd 對轉，不走銀行攤還
    if(l.studentLoan){
      if(S.turnNumber < (l.graceUntilTurn||0)) return;      // 學貸寬限期不還
      if(!l.amortStarted){                                   // 寬限期結束 → 啟動本利攤還
        l.amortStarted=true;
        var pmt0=E.pmt(l.principal, l.annualRate, l.termMonths);
        ledger.post(S,p,"學貸開始本利攤還："+l.name,
          [{account:"EXPENSE",delta:util.r2(pmt0-l.monthlyPayment),refId:l.instanceId,label:l.name+" 月付啟動"}],{eduTags:["cashflow"]});
        l.monthlyPayment=pmt0;
        E.ev("STUDENT_LOAN_START",{playerId:p.id, name:l.name, payment:pmt0});
      }
    }
    var interest=util.r2(l.principal*l.annualRate/12);
    var principalPortion=util.r2(l.monthlyPayment-interest);
    l.periodsPaid=(l.periodsPaid||0)+1;                      // 九期：已還期數（貸款卡顯示用）
    if(principalPortion<=0) return;                          // 極端：月付不足以攤本
    if(principalPortion >= l.principal-0.5){                 // 本期結清
      ledger.post(S,p,l.name+" 貸款結清",
        [{account:"LIABILITY",delta:-l.principal,refId:l.instanceId,label:l.name+" 攤還結清"},
         {account:"EXPENSE",delta:-l.monthlyPayment,refId:l.instanceId,label:l.name+" 月付終止"}],{eduTags:["cashflow"]});
      p.liabilities=p.liabilities.filter(function(x){return x.instanceId!==l.instanceId;});
      E.unlinkLiability(p, l.instanceId);       // S13.1 NEW-03：攤還到結清也要解除資產連結
    } else {
      l.principal=util.r2(l.principal-principalPortion);
      ledger.post(S,p,l.name+" 每月攤還本金",
        [{account:"LIABILITY",delta:-principalPortion,refId:l.instanceId,label:l.name+" 攤還本金"}],{eduTags:["cashflow"]});
    }
  });
};

/* ================== §2.2 C 營運風險：修繕／空租／企業景氣係數 ============== */
// 企業景氣係數
E.bizMult = function(S, stage){
  var v = E.cfg(S, "bizMult_"+stage);
  return (v===undefined || !(v>0)) ? 1 : v;
};
// 房產的「契約租金」：空租中取暫存值，否則取當前收入
E.rentBasis = function(a){
  return (a.vacantUntilTurn!==undefined && a.vacantIncome!==undefined) ? a.vacantIncome : (a.monthlyIncome||0);
};
// 均勻整數 [lo,hi]（主流 RNG，重放安全）
E.randInt = function(S, lo, hi){
  lo=Math.round(lo); hi=Math.round(hi); if(hi<lo) hi=lo;
  return lo + Math.floor(util.rand(S)*(hi-lo+1));
};
// 每次發薪後對每筆房產擲骰：先結束到期空租 → 修繕 → 新空租
E.opsRisk = function(S, p){
  if(p.bankrupt) return;
  var stage = S.macro ? S.macro.stage : "RECOVERY";
  var vChance = E.cfg(S, "vacancyChance_"+stage); if(vChance===undefined) vChance=0;
  // S7b：木作與居家修繕——物件維持得好，空窗期短得多。
  // 只縮放機率、不改變 RNG 呼叫次數（與水電技能同一個紀律）。
  if(E.hasSkill && E.hasSkill(p,"SKL_CARPENTRY")){
    var cvm=E.cfg(S,"carpentryVacancyMult"); if(cvm===undefined) cvm=0.5;
    vChance = vChance*cvm;
  }
  var rChance = E.cfg(S, "repairChancePerPayday"); if(rChance===undefined) rChance=0;
  var rMin = E.cfg(S,"repairCostMonthsMin"), rMax = E.cfg(S,"repairCostMonthsMax");
  if(rMin===undefined) rMin=1; if(rMax===undefined) rMax=3;
  var vMin = E.cfg(S,"vacancyTurnsMin"), vMax = E.cfg(S,"vacancyTurnsMax");
  if(vMin===undefined) vMin=1; if(vMax===undefined) vMax=2;

  p.assets.slice().forEach(function(a){
    if(a.kind!=="REALESTATE") return;
    // 1) 空租到期 → 恢復出租
    if(a.vacantUntilTurn!==undefined && a.vacantUntilTurn<=S.turnNumber){
      var back = a.vacantIncome||0;
      a.monthlyIncome = util.r2(back);
      delete a.vacantUntilTurn; delete a.vacantIncome;
      if(back) ledger.post(S,p,"恢復出租："+a.name,
        [{account:"INCOME_PASSIVE",delta:util.r2(back),refId:a.instanceId,label:a.name+" 租金恢復"}],{eduTags:["cashflow"]});
      E.ev("VACANCY_END",{playerId:p.id, assetId:a.instanceId, assetName:a.name, income:util.r2(back)});
    }
    var rent = E.rentBasis(a);
    // 2) 修繕（空租中仍可能發生——雪上加霜，工程書 §2.2 邊界）
    if(rent>0 && util.rand(S) < rChance){
      var months = E.randInt(S, rMin, rMax);
      var cost = util.r2(rent*months);
      /* M8 S3：基礎水電——自己拆開來修。
         S28（Brian 裁示）：原本是「修繕費折半」，等於把一個換燈泡等級的技能，
         做成房產投資的成本優化器——量級完全不對（500 局累計折抵 22,541，全場最高）。
         改成固定折抵一筆「自己動手省下的師傅工錢」，日常 DIY 該是什麼量級就是什麼量級。
         注意：折扣只動金額、不動 RNG 呼叫順序，關閉 M8 時序列與基線一致。 */
      if(E.hasSkill && E.hasSkill(p,"SKL_PLUMB")){
        var flat = E.cfg(S,"skillPlumbSaveFlat"); if(flat===undefined) flat = 2;
        var savedH = util.r2(Math.min(cost, flat));
        cost = util.r2(cost - savedH);
        if(savedH>0){
          p.stats.skillSavedTotal = util.r2((p.stats.skillSavedTotal||0) + savedH);
          p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
          E.ev("SKILL_APPLIED",{ playerId:p.id, skillId:"SKL_PLUMB", title:"基礎水電",
                                 saved:savedH, where:"repair", assetName:a.name });
        }
      }
      // 住宅火險：修繕支出理賠（在水電技能折扣之後——先自己省，剩下的才由保險分擔）
      if(p.flags && p.flags.propInsured){
        var pc = E.cfg(S,"propertyClaimPct"); if(pc===undefined) pc = 0.5;
        var claimR = util.r2(cost*pc);
        if(claimR>0){
          cost = util.r2(cost-claimR);
          p.stats.propClaimTotal = util.r2((p.stats.propClaimTotal||0)+claimR);
          E.ev("PROPERTY_CLAIM",{playerId:p.id, claim:claimR, where:"repair", assetName:a.name});
        }
      }
      var flavor = "ops.repair."+E.randInt(S,0,7);
      if(cost>0){
        ledger.post(S,p,"修繕支出："+a.name,
          [{account:"CASH",delta:-cost,label:a.name+" 修繕"}],{eduTags:["opex"]});
        E.ev("REPAIR_EVENT",{playerId:p.id, assetId:a.instanceId, assetName:a.name,
                             cost:cost, months:months, flavorKey:flavor});
      }
    }
    // 3) 空租（僅衰退／蕭條，且未在空租中）
    if(a.vacantUntilTurn===undefined && vChance>0 && util.rand(S) < vChance){
      var turns = E.randInt(S, vMin, vMax);
      var cur = a.monthlyIncome||0;
      a.vacantIncome = util.r2(cur);
      a.vacantUntilTurn = S.turnNumber + turns;
      a.monthlyIncome = 0;
      if(cur) ledger.post(S,p,"空租："+a.name,
        [{account:"INCOME_PASSIVE",delta:util.r2(-cur),refId:a.instanceId,label:a.name+" 租金中斷"}],{eduTags:["cashflow"]});
      E.ev("VACANCY_START",{playerId:p.id, assetId:a.instanceId, assetName:a.name,
                            turns:turns, income:util.r2(cur), untilTurn:a.vacantUntilTurn});
    }
  });
};

E.payday = function(S,p){
  var d=p.derived, vol=0, volLabel=null;
  var salary = d.salaryIncome;
  if(p.playerStage==="OUTER"){ salary = 0; }
  else if(p.salaryVolatility>0 && salary>0){
    var amp = p.salaryVolatility*S.config.volatilityGlobalMult;
    vol = (util.rand(S)*2-1)*amp;
    volLabel = vol>=0 ? "pay.vol.up" : "pay.vol.down";
    salary = util.r2(salary*(1+vol));
  }
  var net = util.r2(salary + d.passiveIncome - d.totalExpenses);
  var detail = { salary:salary, baseSalary:d.salaryIncome, vol:vol, volLabel:volLabel,
                 passive:d.passiveIncome, expense:d.totalExpenses, net:net,
                 // S23a.1：被動收入拆成租金／事業／股息／數位長尾／P2P，每輪紀錄與薪資單都看得到組成
                 passiveRows:(E.passiveBreakdown ? E.passiveBreakdown(S,p).rows : null),
                 stage:S.macro.stage, turn:S.turnNumber };
  p.stats.paydays++;
  var settleLabel = salary>0 ? "發薪日結算" : "現金流結算（被動收入）";
  ledger.post(S,p,settleLabel,[{account:"CASH",delta:net,label:salary>0?"本月結餘":"本月被動現金流"}],
    {eduTags:["payday"], detail:detail, kind:"PAYDAY"});
  E.amortize(S,p);
  E.opsRisk(S,p);
  ledger.recompute(p);
  p.history.push({ turn:S.turnNumber, nw:p.derived.netWorth, passive:p.derived.passiveIncome,
                   expense:p.derived.totalExpenses, cash:p.cash });
  E.ev("PAYDAY_EXECUTED",{playerId:p.id, detail:detail});
  ns.modules.onPayday(S,p);
  // S11：配息已在上面隨結算進了現金，這裡才輪到自動扣款與再投入（順序不可對調，
  // 否則會用「還沒入帳的股息」去買股票）
  if(E.tickAutoInvest) E.tickAutoInvest(S,p);

  if(S.config.automationLevel===3 && !p.isNPC){
    E.pushDecision(S,p,{ kind:"AUDIT", netAmount:Math.max(0,net) });
  }
  if(p.cash<0) E.enterBankruptcy(S,p);
  else E.checkFreedom(S,p);
};

/* ============================== 格子解析 ================================= */
E.landing = function(S,p,space){
  var t=space.type;
  E.ev("LANDED",{playerId:p.id, space:t});
  if(ns.modules.onLanded(S,p,space)) return;
  switch(t){
    case "PAYDAY": case "OPAYDAY": break;
    case "OPPORTUNITY":
      E.pushDecision(S,p,{ kind:"CHOOSE_DECK" }); break;
    case "LIFESTYLE": {
      var c = E.drawCard(S,"LIFESTYLE",function(c){return E.cardUsable(S,p,c);});
      if(c) E.presentCard(S,p,c); break; }
    case "MARKET": {
      var m = E.drawCard(S,"MARKET",function(c){return E.cardUsable(S,p,c);});
      if(m){ E.ev("CARD_DRAWN",{card:m.id});
        var impM=E.captureImpact(S,p,function(){ E.applyEffects(S,p,m.effects,m.title); });
        var sw=(m.effects||[]).filter(function(e){return e.op==="OFFER_SELL_WINDOW";})[0];
        var eligible = sw ? p.assets.filter(function(a){ return (!sw.filter||!sw.filter.kind||sw.filter.kind===a.kind); }) : [];
        if(sw && eligible.length && !p.isNPC)
          E.pushDecision(S,p,{kind:"SELL_OFFER", cardId:m.id, priceMult:sw.priceMult||1.3, filter:sw.filter});
        else
          E.pushDecision(S,p,{kind:"ACK", cardId:m.id, impact:impM});
      } break; }
    case "LIFE_EVENT": {
      var usableL = function(c){ return E.cardUsable(S,p,c); };
      // 上次擱著的那件事，這次直接找上門——你選的是順序，不是逃避。
      if(p.deferredLifeId){
        var defC = ns.content.byId[p.deferredLifeId];
        p.deferredLifeId = null;
        if(defC && usableL(defC)){
          E.ev("LIFE_DEFERRED_HIT",{playerId:p.id, cardId:defC.id, title:defC.title});
          E.presentCard(S,p,defC);
          break;
        }
        // 已經不適用（例如那張技能你早就學會了）→ 照常抽牌，不硬塞
      }
      if(E.cfg(S,"lifeDualChoice")){
        var twoL = E.drawTwo(S,"LIFE_EVENT",usableL);
        if(twoL.length===2){
          E.ev("LIFE_DUAL_DRAWN",{playerId:p.id, cardIds:[twoL[0].id,twoL[1].id]});
          E.pushDecision(S,p,{ kind:"PICK_LIFE", cardIds:[twoL[0].id,twoL[1].id] });
        } else if(twoL.length===1){
          E.presentCard(S,p,twoL[0]);          // 牌堆只剩 1 張：退化為單張流程
        }
      } else {
        var e = E.drawCard(S,"LIFE_EVENT",usableL);
        if(e) E.presentCard(S,p,e);
      }
      break; }
    case "LAYOFF": {
      // S15：自營者與創辦人被「資遣」還要「找下一份工作」不通，依職業型別換敘事。
      // S27：邏輯抽成 E.triggerLayoff，棋盤格與卡片效果共用同一份；行為與參數完全不變。
      E.triggerLayoff(S,p);
      break; }
    case "SITE": {
      var dream = ns.content.byId[p.dreamCardId];
      if(!dream || dream.category!==space.category){
        // v0.2 §2：非本命聖地＝在別人的夢想景點觀光——依機率抽「自由人生」卡（事件密度旋鈕）
        var olc=E.cfg(S,"outerLifeChance"); if(olc===undefined) olc=0.55;
        if(util.rand(S) < olc){
          var ol = E.drawCard(S,"OUTER_LIFE",function(c){ return E.cardUsable(S,p,c); });
          if(ol) E.presentCard(S,p,ol);
        }
        break;
      }
      if(dream && dream.category===space.category){
        p.atDreamSite = true;
        p.freeProgressTurn = S.turnNumber;      // S40（Brian）：踩到聖地免費 +1 的那一輪，不能再用錢買——同一輪不得兩點
        p.dreamProgress++; p.stats.freeProgress++;
        E.logDreamPoint(S,p,p.dreamProgress,false);  // S31：寫進夢想相簿
        E.ev("DREAM_PROGRESS",{playerId:p.id, progress:p.dreamProgress, paid:false,
          milestone:E.dreamMilestone(S,p,p.dreamProgress),
          milestoneImg:E.dreamMilestoneImg(S,p,p.dreamProgress),   // S24：全服公告要配圖
          dreamName:(dream?dream.name:"")});
        E.checkDreamWin(S,p);
        if(!S.over && !p.isNPC) E.pushDecision(S,p,{kind:"ACK", site:{category:space.category}});
        // 購點機會改由 doMove 尾端的 offerDreamProgress 統一供應（免費+1 後仍可再購 1）
      }
      break; }
    case "OEVENT": {
      var oe = E.drawCard(S,"MARKET",function(c){return E.cardUsable(S,p,c);});
      if(oe){ var impO=E.captureImpact(S,p,function(){ E.applyEffects(S,p,oe.effects,oe.title); });
        E.pushDecision(S,p,{kind:"ACK", cardId:oe.id, impact:impO}); }
      break; }
  }
};

E.cardUsable = function(S,p,c){
  if(c.moduleReq && S.enabledModules.indexOf(c.moduleReq)<0) return false;
  if(c.requiresChild && p.childrenCount<=0) return false;
  // S12：這一版新掛的閘門用另一個欄位，才能單獨還原去驗證引擎沒被誤動；
  // 本來就有的 requiresChild 是既有行為，不受這個開關影響。
  if(c.requiresChildSinceS12 && p.childrenCount<=0 && E.cfg(S,"contentFixS12")!==0) return false;
  if(c.kind==="PROFESSION_EVENT"){
    if(c.forProfession!==p.professionId) return false;
    if(c.oncePerLife && p.professionEventDone[c.id]) return false;
  }
  if(c.kind==="SELF_INVEST"){
    if(p.playerStage!=="INNER") return false;
    if(c.oncePerLife && p.professionEventDone[c.id]) return false;
  }
  if(c.kind==="CHOICE" && c.oncePerLife && p.professionEventDone[c.id]) return false;
  // M8 S1：已學會（且未過時）或正在學的技能卡不再出現
  if(c.kind==="SKILL" && ((p.skills && p.skills[c.id] && !p.skills[c.id].decayed)
     || (p.learning && p.learning.skillId===c.id))) return false;
  // M8 S2：情境卡有最早出現輪次——先給玩家準備的時間，機會才來。
  // （被濾掉的卡會進棄牌堆，重洗後於中後期照常出現，不會消失。）
  if(c.kind==="SKILL_GATE"){
    var minT = E.cfg(S,"skillGateMinTurn"); if(minT===undefined) minT = 12;
    if(S.turnNumber < minT) return false;
  }
  // M8 S3：學習干擾卡——沒在學習就沒有東西可以被打斷（抽到即進棄牌堆，之後仍會回來）
  if(c.requiresLearning && !p.learning) return false;
  // S9：數位資產改成「人人可做」——原本要有指定技能才抽得到，三重閘門疊起來
  // 導致 60 局 180 人次只開張 10 個（5.6%），等於這個系統多數玩家一輩子看不到。
  // 技能不再是門票，而是加成：有手藝爬得快、也比較容易紅；沒手藝照樣可以做，
  // 只是多半在做白工——這正是想教的事。閘門改在 E.startDigital 的參數裡。
  if(c.kind==="DIGITAL"){
    if(!E.digitalOn(S)) return false;
    if(p.playerStage!=="INNER") return false;             // 外圈專心圓夢
    var dupD=(p.digitalAssets||[]).some(function(x){ return x.cardId===c.id && !x.dead; });
    if(dupD) return false;
    // S13：同時經營的攤數有上限——開太多攤只會每一攤都顧不到
    if(E.digitalLiveCount(p) >= E.digitalSlots(S)) return false;
  }
  // M8 S3：已經會的技能就不必再送一次（否則玩家白付教材費卻什麼也沒得到）
  if(c.requiresNotSkill && E.hasSkill(p, c.requiresNotSkill)) return false;
  // S22：階梯技能——先修沒學會，高階卡抽到也學不了，直接跳過（進棄牌堆，之後仍會回來）
  if(c.kind==="SKILL" && c.requiresSkill && !E.hasSkill(p, c.requiresSkill)) return false;
  // S22：獨立董事邀請等「要有資格才會找上門」的卡：列出的技能至少會一項
  if(c.requiresAnySkill && !c.requiresAnySkill.some(function(sid){ return E.hasSkill(p, sid); })) return false;
  /* S27：身分門檻。有些卡在敘事上只對某種受僱型態成立——「跟老闆談加薪」對自營者與
     創辦人不通，「公司發你選擇權」對創辦人更荒謬。E.employmentType 早在 S15 就有，
     這裡只是把它接成抽牌條件；沒寫這個欄位的卡完全不受影響。
     公平性配套：擋掉一張成長機會，就要在另一邊補一張等價的（SI_NEGO ↔ SI_REPRICE）。 */
  if(c.requiresEmploymentType && c.requiresEmploymentType.indexOf(E.employmentType(S,p)) < 0) return false;
  if(c.kind==="SPECIAL" && c.payload && c.payload.decisionKind==="APPOINT_DIRECTOR"
     && (p.directorship || p.playerStage!=="INNER")) return false;   // 同時只能兼一席；外圈不接
  if(c.kind==="TAPESTRY" && c.virtueAxis==="PARENTING" && p.childrenCount<=0) return false;
  if(c.kind==="LIFE_EVENT" && c.effects && c.effects.some(function(e){return e.op==="ADD_CHILD";})
     && p.childrenCount>=S.config.childExpenseCap) return false;
  if(c.kind==="STARTUP" && S.enabledModules.indexOf("M3")<0) return false;
  // S7b：已下市的股票不會再有人賣給你
  if(c.kind==="STOCK" && S.delisted && S.delisted[(c.payload||{}).symbol]) return false;
  // S22：吸金盤每張一局只找上門一次——被騙過（或拒絕過）的同一個局，不會再遇到同一個介紹人
  if(c.payload && c.payload.isScam && p.scamSeen && p.scamSeen[c.id]) return false;
  return true;
};

/* 把卡牌變成決策或直接執行 */
E.presentCard = function(S,p,card){
  E.ev("CARD_DRAWN",{card:card.id});
  switch(card.kind){
    case "REALESTATE": case "STOCK": case "BUSINESS": case "STARTUP":
      if(card.payload && card.payload.isScam){ p.scamSeen=p.scamSeen||{}; p.scamSeen[card.id]=1; }   // S22
      E.pushDecision(S,p,{ kind:"BUY", cardId:card.id }); break;
    case "LIFESTYLE":
      if(card.payload.optional){ p.stats.optionalSeen++;
        E.pushDecision(S,p,{ kind:"LIFESTYLE", cardId:card.id }); }
      else { var impLS=E.captureImpact(S,p,function(){ E.payLifestyle(S,p,card); });
        E.pushDecision(S,p,{kind:"ACK", cardId:card.id, impact:impLS}); }
      break;
    case "LIFE_EVENT":
      var insurableL=(card.tags||[]).indexOf("insurable")>=0;
      var claimsL=[], reliefsL=[];
      var impL=E.captureImpact(S,p,function(){
        E.applyEffects(S,p,card.effects,card.title,{lifeEvent:true, insurable:insurableL, claimOut:claimsL, reliefOut:reliefsL}); });
      // V11.1：把理賠明細掛到 ACK 卡上（原價／折抵／理賠／實付）
      var ackL={kind:"ACK", cardId:card.id, impact:impL};
      var sumL=E.summarizeClaims(claimsL, p.id);
      if(sumL) ackL.claim=sumL;
      // S37：四條鏈（產險／法律／報稅／醫療＋健康）的減免與「沒準備本可省」都掛上卡面
      var myRel=reliefsL.filter(function(x){ return x.playerId===p.id; });
      if(myRel.length) ackL.reliefs=myRel;
      E.pushDecision(S,p,ackL);
      if(p.cash<0) E.enterBankruptcy(S,p);
      break;
    case "DIGITAL":
      E.pushDecision(S,p,{ kind:"START_DIGITAL", cardId:card.id }); break;
    case "PROFESSION_EVENT":
      p.professionEventDone[card.id]=true;
      if(card.decision) E.pushDecision(S,p,{ kind:"PROFESSION_EVENT", cardId:card.id });
      else { E.applyEffects(S,p,card.effects,card.title); E.pushDecision(S,p,{kind:"ACK", cardId:card.id}); }
      break;
    case "SELF_INVEST":
      p.professionEventDone[card.id]=true;
      E.pushDecision(S,p,{ kind:"SELF_INVEST", cardId:card.id });
      break;
    case "CHOICE":
      if(card.oncePerLife) p.professionEventDone[card.id]=true;   // C1：讓 CHOICE 的 oncePerLife 真正生效
      E.pushDecision(S,p,{ kind:"CHOICE", cardId:card.id });
      break;
    case "SPECIAL":                                   // S22：payload.decisionKind 指定要開哪種決策
      if(card.payload && card.payload.decisionKind)
        E.pushDecision(S,p,{ kind:card.payload.decisionKind, cardId:card.id });
      else E.pushDecision(S,p,{ kind:"ACK", cardId:card.id });
      break;
    case "SKILL":                                     // M8 S1：抽到技能卡 → 要不要學
      E.pushDecision(S,p,{ kind:"LEARN_SKILL", cardId:card.id });
      break;
    case "SKILL_GATE":                                // M8 S2：機會來了，看你準備過沒有
      E.resolveSkillGate(S,p,card);
      break;
    case "TAPESTRY":
      if(card.subKind==="CULTIVATE") E.pushDecision(S,p,{ kind:"CULTIVATE", cardId:card.id });
      else if(card.subKind==="TRIAL") E.resolveTrial(S,p,card);
      else {
        if(card.payload && card.payload.optional){ p.stats.optionalSeen++;
          E.pushDecision(S,p,{ kind:"LIFESTYLE", cardId:card.id }); }
        else { var impD=E.captureImpact(S,p,function(){ E.payLifestyle(S,p,card); });
          E.pushDecision(S,p,{kind:"ACK", cardId:card.id, impact:impD}); } }
      break;
    default:
      E.pushDecision(S,p,{kind:"ACK", cardId:card.id});
  }
};

E.payLifestyle = function(S,p,card){
  var pl=card.payload||{}, post=[];
  var cost = util.r2((pl.cost||0)*S.config.eventCardRate);
  /* S33：基礎水電的兌現點補回「自住」這一邊。
     S28 之後 SKL_PLUMB 只在房產修繕時折抵（applyAction 的 tickAssets），
     於是沒買房的玩家學了等於什麼都沒有——但 Brian 當初要的本來就是
     「換燈泡、簡單耗材更換，省下叫師傅的工錢」，那是自住不是收租。
     卡片用 payload.diyRepair 自己表態，引擎不猜；量級走 skillPlumbHomeSave。 */
  if(cost>0 && pl.diyRepair && E.hasSkill && E.hasSkill(p,"SKL_PLUMB")){
    var homeSave = E.cfg(S,"skillPlumbHomeSave"); if(homeSave===undefined) homeSave = 10;
    var savedL = util.r2(Math.min(cost, homeSave));
    if(savedL>0){
      cost = util.r2(cost - savedL);
      p.stats.skillSavedTotal = util.r2((p.stats.skillSavedTotal||0) + savedL);
      p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
      E.ev("SKILL_APPLIED",{ playerId:p.id, skillId:"SKL_PLUMB", title:"基礎水電",
                             saved:savedL, where:"home", assetName:card.title });
    }
  }
  if(cost) post.push({account:"CASH",delta:-cost,label:card.title});
  if(pl.recurringMonthly) post.push({account:"EXPENSE",delta:util.r2(pl.recurringMonthly),label:card.title+"（每月）"});
  if(post.length) ledger.post(S,p,card.title,post,{eduTags:["lifestyle"]});
  if(p.cash<0) E.enterBankruptcy(S,p);
};

/* M8 S2：技能情境——有沒有準備，決定你接不接得住這個機會 */
E.resolveSkillGate = function(S, p, card){
  var b = card.skillBranch;
  if(!b){ E.pushDecision(S,p,{kind:"ACK", cardId:card.id}); return; }
  var have = E.hasSkill(p, b.requires);
  var br = have ? b.have : b.miss;
  /* 兩個分支的價差＝這張卡因為「有沒有準備」而產生的差額。
     S28：原本只算 CASH_DELTA，於是用薪資倍率兌現的三張（駕照、外語、程式）算出來
     永遠是 0——而 SKE_AILAYOFF 的薪資擺盪其實是全牌堆最重的一筆。
     薪資倍率折算成「月薪差 × 折算輪數」，讓 skillSavedTotal 這個給玩家看的數字誠實。 */
  var salHorizon = E.cfg(S,"skillGateSalaryHorizon"); if(salHorizon===undefined) salHorizon = 24;
  var valueOf = function(x){
    var v = 0;
    (((x&&x.effects)||[])).forEach(function(e){
      if(e.op==="CASH_DELTA") v += (e.amount||0);
      else if(e.op==="SALARY_MULT") v += (p.derived.salaryIncome||0)*((e.factor||1)-1)*salHorizon;
    });
    return v;
  };
  var gap = util.r2(valueOf(b.have) - valueOf(b.miss));
  if(have){
    p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
    if(gap > 0) p.stats.skillSavedTotal = util.r2((p.stats.skillSavedTotal||0) + gap);
  } else {
    p.stats.skillMissed = (p.stats.skillMissed||0) + 1;
  }
  var imp = E.captureImpact(S,p,function(){
    E.applyEffects(S,p,(br&&br.effects)||[],card.title,{lifeEvent:true});
  });
  E.ev("SKILL_GATE_RESOLVED",{ playerId:p.id, cardId:card.id, title:card.title,
                               have:have, requires:b.requires, gap:gap });
  E.pushDecision(S,p,{ kind:"SKILL_RESULT", cardId:card.id, have:have, gap:gap, impact:imp });
  if(p.cash < 0) E.enterBankruptcy(S,p);
};

/* 品格考驗：依品格等級分岔 */
E.resolveTrial = function(S,p,card){
  var b=card.virtueBranch, above;
  if(S.enabledModules.indexOf("M6")>=0){
    var lv=p.virtues[b.axis]||0; above = lv>=b.threshold;
  } else {
    // v0.2：品格帳本未開啟時退化為固定機率（主流 RNG，重放安全）
    var resist=E.cfg(S,"outerTrialResist"); if(resist===undefined) resist=0.35;
    above = util.rand(S) < resist;
  }
  var br = above ? b.above : b.below;
  var cost=function(x){ return util.sum((x.effects||[]).filter(function(e){return e.op==="CASH_DELTA";}),
    function(e){ return Math.abs(e.amount); }); };
  // S12：考驗卡其實有兩種寫法，過去只算得出其中一種。
  //   懲罰型（脾氣／審慎／教養）：沒品格 → below 直接扣錢，cost() 抓得到。
  //   獎勵型（孝親多數）：有品格 → above 給一筆「每月省 N，共 D 輪」的好處，
  //                       沒品格就只是沒拿到——cost() 兩邊都算 0，
  //                       畫面於是印出「代價 0／省下 0」四行全零，看起來像壞掉。
  // 這裡把 ADD_RECURRING_EXPENSE 的負值（＝省錢）換算成一次性金額，讓兩種卡都講得出話。
  var benefit=function(x){
    return util.sum((x.effects||[]).filter(function(e){
        return e.op==="ADD_RECURRING_EXPENSE" && (e.amount||0)<0; }),
      function(e){ return Math.abs(e.amount)*Math.max(1, e.durationTurns||1); });
  };
  // 品格替你省下的錢：懲罰型算「少賠多少」，獎勵型算「多拿多少」——兩者都是品格的價值
  if(above) p.virtueSavedTotal = util.r2(p.virtueSavedTotal
      + Math.max(0, cost(b.below)-cost(b.above))
      + Math.max(0, benefit(b.above)-benefit(b.below)));
  E.applyEffects(S,p,br.effects,card.title);
  E.ev("TRIAL_RESOLVED",{playerId:p.id, cardId:card.id, above:above});
  var aboveGain=benefit(b.above), belowGain=benefit(b.below);
  var missed=Math.max(0, aboveGain-belowGain);
  E.pushDecision(S,p,{ kind:"TRIAL_RESULT", cardId:card.id, above:above,
    aboveCost:cost(b.above), belowCost:cost(b.below),
    aboveGain:aboveGain, belowGain:belowGain, missed:missed,
    // 兩種卡型：有代價差就是懲罰型，只有好處差就是獎勵型（可能兩者都有）
    trialKind:(cost(b.below)>cost(b.above) ? (missed>0?"BOTH":"PENALTY") : (missed>0?"REWARD":"FLAT")) });
  if(p.cash<0) E.enterBankruptcy(S,p);
};

/* ============================== 決策解析 ================================= */
E.resolveDecision = function(S,p,d,optionId,params){
  switch(d.kind){
    /* S22：獨立董事——審計預警後的請辭抉擇。
       S21 原版把「請辭」記成一筆 delta 0 的分錄；ledger.post 會把 0 金額的分錄整筆丟掉，
       徽章又是靠掃分錄摘要判定，等於永遠拿不到。改成寫 stats 旗標。 */
    case "RESIGN_DIRECTORSHIP": {
      if(optionId==="resign" && p.directorship){
        p.directorship.resigned = true;
        p.stats.directorResigned = (p.stats.directorResigned||0) + 1;
        E.ev("DIRECTOR_RESIGNED", { playerId:p.id, company:p.directorship.title });
      } else if(p.directorship){
        E.ev("DIRECTOR_STAYED", { playerId:p.id, company:p.directorship.title });
      }
      break;
    }
    case "APPOINT_DIRECTOR": {
      if(optionId==="appoint"){
        var comp = (params && params.company) || "A";
        var sel = E.DIRECTOR_COMPANIES[comp] || E.DIRECTOR_COMPANIES.A;
        /* S27：就任時先擲一次「這一任會不會爆」，會爆的再擲時間。
           沒寫 crashChance 的公司（或舊存檔）沿用原本「有 crashMin 就一定爆」的判定。 */
        var willCrash = (sel.crashChance!==undefined) ? (util.rand(S) < sel.crashChance) : !!sel.crashMin;
        var crashAt = (willCrash && sel.crashMax) ? S.turnNumber + util.randInt(S, sel.crashMin, sel.crashMax) : null;
        p.directorship = {
          companyType: comp, title: sel.title, monthlyIncome: sel.income,
          hasInsurance: sel.hasInsurance, crashTurn: crashAt, fineAmount: sel.fineAmount,
          termTurnsLeft: sel.term, termTurns: sel.term, warned: false, resigned: false,
          /* S33：記帳級的預警是機率制。骰子在就任當下就擲、無條件擲一次，
             不放在「爆雷前一輪且剛好是記帳級」的分支裡——分支式消耗亂數會讓
             同一顆種子因為玩家技能不同而整條序列位移（鐵律三）。 */
          auditRoll: util.rand(S)
        };
        p.stats.directorAppointed = (p.stats.directorAppointed||0) + 1;
        E.ev("DIRECTOR_APPOINTED", { playerId:p.id, company:sel.title, income:sel.income });
        ledger.post(S, p, "就任獨立董事："+sel.title,
          [{ account:"CASH", delta:sel.income, label:"就任當期車馬費" }], { eduTags:["directorship","passive-income"] });
      } else {
        p.stats.directorDeclined = (p.stats.directorDeclined||0) + 1;
      }
      break;
    }
    /* S23b：期貨追繳——補到原始保證金水位，或當場平倉認賠。
       不補也不平就等於選擇「賭下一輪」，餘額燒完會被強制平倉（tickFutures）。 */
    case "FUT_MARGIN_CALL": {
      var aMC = E.futPositions(p).filter(function(x){ return x.instanceId===d.instanceId; })[0];
      if(!aMC) break;
      if(optionId==="close"){ E.futClose(S,p,aMC,{}); break; }
      if(optionId==="topup"){
        var defMC = E.futDef(aMC.symbol);
        var wantMC = util.r2(E.futContractValue(S,defMC)*(aMC.lots||0)*E.futMarginPct(S,defMC));
        var addMC = util.r2(Math.max(0, wantMC - (aMC.marketValue||0)));
        if(addMC>0 && p.cash>=addMC){
          aMC.marketValue=util.r2(aMC.marketValue+addMC);
          aMC.costBasis=util.r2((aMC.costBasis||0)+addMC);
          ledger.post(S,p,"補繳保證金："+aMC.name,
            [{account:"CASH",delta:-addMC,label:"補繳至原始保證金"},
             {account:"ASSET",delta:addMC,refId:aMC.instanceId,label:"保證金餘額"}],
            {eduTags:["futures"]});
          E.ev("FUT_TOPPED_UP",{playerId:p.id, instanceId:aMC.instanceId, amount:addMC});
          if(p.cash<0) E.enterBankruptcy(S,p);
        } else if(addMC>0){
          E.futClose(S,p,aMC,{});          // 補不出來就只能平倉
        }
        break;
      }
      break;   // hold：什麼都不做，賭下一輪
    }
    case "ACK": case "TRIAL_RESULT": case "BLESSING": case "SKILL_RESULT":
    case "DIGITAL_RESULT": {       // 起飛結果已於 tickDigital 結算；S30 起順便問「要不要請人」
      if(optionId!=="staff") break;
      var drD=(p.digitalAssets||[]).filter(function(x){ return x.id===d.digitalId && !x.dead; })[0];
      if(!drD || drD.tier===null) break;
      if(p.playerStage!=="INNER") break;
      if(p.cash < E.digitalStaffCost(S,p)) break;      // 請不起就是請不起
      E.setDigitalStaff(S,p,drD,true);
      break; }

    // S7b：下市警示——現在停損，還是賭它撐過去
    case "DELIST_WARN": {
      if(optionId!=="sell") break;
      p.assets.slice().forEach(function(a){
        if(a.kind!=="STOCK" || a.symbol!==d.symbol) return;
        E.sellAsset(S,p,a,1,{ summary:"警示後停損："+a.name, eduTags:["exit","stop-loss"] });
      });
      p.stats.stopLoss=(p.stats.stopLoss||0)+1;
      if(p.cash<0) E.enterBankruptcy(S,p);
      break; }

    // S5：要不要投入時間去做這個內容——時間是唯一真正稀缺的東西
    case "START_DIGITAL": {
      var dgC = ns.content.byId[d.cardId];
      if(!dgC) break;
      if(optionId!=="start" && optionId!=="dropStudy") break;
      if(!E.digitalOn(S)) break;
      // S13：實測回饋——機會卡錯過就沒了，技能隨時可以重修。
      // 所以給一個「放棄目前進修、接這個」的選項，但沉沒成本要玩家自己承擔。
      if(optionId==="dropStudy"){
        if(!p.learning) break;                               // 沒在進修就沒有東西可以放棄
        // S25d：直接呼叫效果函式，不再整套 E.apply(ABANDON_SKILL)——那樣會在
        // 同一筆 DECIDE 裡對 S.actionLog 多推一筆「憑空」的紀錄，多人連線會
        // 永久對不上共用日誌（見 E.applyAbandonSkill 上方註解）。
        E.applyAbandonSkill(S,p);
      }
      if(p.learning) break;                                  // 還在學習中就沒有時間再開一攤
      if(p.cash < util.r2((dgC.payload||{}).cost||0)) break;
      E.startDigital(S,p,dgC);
      break; }   // BLESSING 效果已於抽獎時結算，此處純確認

    // M8 S1：被動路徑——抽到技能卡，決定學或不學（學費享折扣）
    case "LEARN_SKILL": {
      var lc = ns.content.byId[d.cardId];
      if(optionId==="learn" && lc && !p.learning
         && !(lc.requiresSkill && !E.hasSkill(p, lc.requiresSkill))   // S22：階梯技能先修
         && !(p.skills[lc.id] && !p.skills[lc.id].decayed)
         && S.turnNumber >= (p.skillCooldownUntil||0)
         && p.cash >= E.skillPrice(S,lc,true)){
        E.startLearning(S,p,lc,true);
      }
      break; }

    // §2.3 機會二選一：選 1 張走現有 presentCard；未選的已在棄牌堆
    case "PICK_OPP": {
      var ids = d.cardIds||[];
      if(optionId==="none" || ids.indexOf(optionId)<0){
        p.stats.passedOpps = (p.stats.passedOpps||0) + 2;
        E.ev("OPP_PICKED",{playerId:p.id, cardId:null, cardIds:ids});
        break;
      }
      var pickCard = ns.content.byId[optionId];
      if(!pickCard){ E.ev("OPP_PICKED",{playerId:p.id, cardId:null, cardIds:ids}); break; }
      p.stats.passedOpps = (p.stats.passedOpps||0) + 1;   // 未選的那張＝放掉的機會
      E.ev("OPP_PICKED",{playerId:p.id, cardId:optionId, cardIds:ids});
      E.presentCard(S,p,pickCard);
      break; }

    // 人生二選一：只能選一件面對，沒有「兩件都不要」——人生不給這個選項
    // 年約到期：續約或就此停掉（沒有第三條路——效期已經過了）
    case "RENEW_MALL": {
      var itR = ns.content.byId[d.itemId];
      if(!itR || optionId!=="renew"){
        E.ev("MALL_RENEW_DECLINED",{playerId:p.id, itemId:d.itemId});
        break;
      }
      if(!E.mallAffordable(S,p,itR)){
        E.ev("MALL_RENEW_FAILED",{playerId:p.id, itemId:itR.id, reason:"NO_CASH"});
        break;
      }
      E.mallApply(S,p,itR);                    // 續約＝重買一次（旗標會重新計時）
      p.flags[d.flag+"Asked"] = 0;             // 下一次到期時可以再問
      E.ev("MALL_RENEWED",{playerId:p.id, itemId:itR.id, title:itR.title});
      if(p.cash<0) E.enterBankruptcy(S,p);
      break; }

    // 第二專長學成：轉職，還是兼副業——做了選擇就承擔後果
    case "SECOND_CAREER": {
      var scCard = ns.content.byId[d.cardId];
      var sc = scCard && scCard.secondCareer;
      if(!sc){ break; }
      var newProf = ns.content.professionById[sc.professionId];
      if(optionId==="switch" && newProf && p.playerStage==="INNER"){
        var oldSal = p.derived.salaryIncome, oldExp = p.derived.totalExpenses;
        // 先把現有副業收掉（轉職之後那份副業不再成立）
        E.dropSideJob(S,p,"轉職");
        var nsSal = util.r2(newProf.salary*S.config.salaryMult);
        var nsExp = util.r2(newProf.baseExpenses*S.config.expenseMult);
        var oldProf = ns.content.professionById[p.professionId];
        var oldBaseExp = util.r2((oldProf?oldProf.baseExpenses:0)*S.config.expenseMult);
        ledger.post(S,p,"轉職：改做「"+newProf.name+"」",
          [{account:"INCOME_ACTIVE",delta:util.r2(nsSal-p.derived.salaryIncome),label:"新職薪資"},
           {account:"EXPENSE",delta:util.r2(nsExp-oldBaseExp),label:"生活支出調整"}],
          {eduTags:["career"]});
        p.professionId = newProf.id;
        p.baseSalary = nsSal;
        p.salaryVolatility = newProf.salaryVolatility||0;
        p.stats.careerSwitched = (p.stats.careerSwitched||0) + 1;
        E.ev("CAREER_SWITCHED",{playerId:p.id, to:newProf.id, toName:newProf.name,
              fromSalary:oldSal, toSalary:nsSal, fromExpense:oldExp, toExpense:p.derived.totalExpenses});
      } else if(optionId==="side" && p.playerStage==="INNER"){
        // 只有內圈能開副業：已經辭職圓夢的人再開副業，等於辭職沒辭乾淨
        E.dropSideJob(S,p,"換副業");           // 同時只做一份副業
        var inc = util.r2(sc.sideIncome||0), cst = util.r2(sc.sideCost||0);
        ledger.post(S,p,"開始兼副業："+(sc.sideLabel||scCard.title),
          [{account:"INCOME_ACTIVE",delta:inc,label:(sc.sideLabel||"副業")+"（主動收入）"},
           {account:"EXPENSE",delta:cst,label:(sc.sideLabel||"副業")+" 時間與器材成本"}],
          {eduTags:["career","side-job"]});
        p.sideJob = { skillId:scCard.id, income:inc, cost:cst, label:(sc.sideLabel||scCard.title),
                      startedAt:S.turnNumber };
        p.stats.sideJobs = (p.stats.sideJobs||0) + 1;
        E.ev("SIDE_JOB_STARTED",{playerId:p.id, skillId:scCard.id,
              label:p.sideJob.label, income:inc, cost:cst});
      } else {
        E.ev("SECOND_CAREER_KEPT",{playerId:p.id, cardId:d.cardId});   // 學了先放著，也是一種選擇
      }
      break; }

    case "PICK_LIFE": {
      var idsL = d.cardIds||[];
      var pickL = ns.content.byId[optionId];
      if(!pickL || idsL.indexOf(optionId)<0) pickL = ns.content.byId[idsL[0]];   // 防禦：無效選項取第一張
      if(!pickL) break;
      // 沒選的那件記在身上，下次踩人生格時先還這筆帳
      var otherL = null;
      for(var iL=0; iL<idsL.length; iL++){ if(idsL[iL]!==pickL.id){ otherL=idsL[iL]; break; } }
      p.deferredLifeId = otherL;
      if(otherL) p.stats.lifeDeferred = (p.stats.lifeDeferred||0) + 1;
      E.ev("LIFE_PICKED",{playerId:p.id, cardId:pickL.id, cardIds:idsL, deferred:otherL});
      E.presentCard(S,p,pickL);
      break; }

    // V10：帳上獲利提示——停利、減碼或續抱（教「紙上富貴不是錢」）
    case "STOCK_GAIN": {
      var ga=p.assets.filter(function(x){return x.instanceId===d.assetId;})[0];
      if(!ga){ break; }
      if(optionId==="sell_all"){
        E.sellAsset(S,p,ga,1);                       // 整筆停利（融資部位會先清償融資）
        p.stats.takeProfit=(p.stats.takeProfit||0)+1;
      } else if(optionId==="sell_half" && !ga.linkedLiabilityId && ga.units>1){
        var half=Math.floor(ga.units/2);
        var price=S.stockPrices[ga.symbol]||0;
        var proceeds=util.r2(price*half), frac=half/ga.units;
        var basisOut=util.r2(ga.costBasis*frac), incOut=util.r2(ga.monthlyIncome*frac);
        var plH=util.r2(proceeds-basisOut);
        ga.units-=half; ga.costBasis=util.r2(ga.costBasis-basisOut);
        ga.marketValue=util.r2(price*ga.units); ga.monthlyIncome=util.r2(ga.monthlyIncome-incOut);
        var pb=[{account:"CASH",delta:proceeds,label:"停利價款"},
                {account:"ASSET",delta:-proceeds,refId:ga.instanceId,label:ga.name+" 減碼"}];
        if(incOut) pb.push({account:"INCOME_PASSIVE",delta:-incOut,refId:ga.instanceId,label:ga.name+" 股息減少"});
        ledger.post(S,p,"停利減碼："+ga.name+" ×"+half+"（損益 "+(plH>=0?"+":"")+util.money(plH)+"）",pb,{eduTags:["exit"]});
        p.stats.takeProfit=(p.stats.takeProfit||0)+1;
        E.ev("ASSET_SOLD",{playerId:p.id, name:ga.name+"（減碼）", pl:plH});
      } else {
        p.stats.holdOn=(p.stats.holdOn||0)+1;        // 續抱
      }
      break; }

    case "CONTEST_ROLL": {
      var itc=ns.content.byId[d.itemId], plc=(itc&&itc.payload)||{};
      if(plc.contest){
        var rollC=util.randInt(S,1,6), tierC=null;
        for(var ci=0;ci<plc.contest.length;ci++){ if(rollC>=plc.contest[ci].min){ tierC=plc.contest[ci]; break; } }
        if(!tierC) tierC=plc.contest[plc.contest.length-1];
        if(tierC.prize>0){
          ledger.post(S,p,itc.title+"："+tierC.label,
            [{account:"CASH",delta:util.r2(tierC.prize),label:"競賽獎金"}],{eduTags:["mall"]});
          p.contestWon = p.contestWon||{}; p.contestWon[itc.id]=true;   // S38：拿過獎金的比賽本局不能再報
        }
        E.ev("CONTEST_RESULT",{playerId:p.id, itemId:itc.id, title:itc.title,
          roll:rollC, label:tierC.label, prize:tierC.prize||0});
      }
      break; }

    case "LIFESTYLE": {
      var c=ns.content.byId[d.cardId];
      if(optionId==="buy"){ p.stats.optionalBought += ((c.payload&&c.payload.joy)||1); E.payLifestyle(S,p,c);
        if(p.cash<0) E.enterBankruptcy(S,p); }
      break; }

    case "CULTIVATE": {
      var cc=ns.content.byId[d.cardId];
      if(optionId==="invest"){
        var pl=cc.payload||{}, post=[];
        if(pl.cost) post.push({account:"CASH",delta:-pl.cost,label:cc.title});
        if(pl.recurringMonthly) post.push({account:"EXPENSE",delta:pl.recurringMonthly,label:cc.title+"（每月）"});
        if(post.length) ledger.post(S,p,cc.title,post,{eduTags:["virtue"]});
        p.virtueSpendTotal = util.r2(p.virtueSpendTotal + (pl.cost||0) + (pl.recurringMonthly||0));
        E.applyEffects(S,p,cc.effects,cc.title);
        E.ev("VIRTUE_UP",{playerId:p.id, axis:cc.virtueAxis, level:p.virtues[cc.virtueAxis]});
      }
      break; }

    case "PROFESSION_EVENT": {
      var pc=ns.content.byId[d.cardId], op=pc.decision.options[optionId|0];
      if(op) E.applyEffects(S,p,op.effects,pc.title);
      break; }

    case "SELF_INVEST": {
      var sc=ns.content.byId[d.cardId], sop=sc.decision.options[optionId|0];
      if(sop && sop.effects.length){
        // S26：選項層級的先修技能——沒學會就選不了（介面會把這個選項鎖住並標「先修」，
        // 這裡是最後一道守門，擋掉直接送 action 的路徑）。
        if(E.optionLocked(S,p,sop)) break;
        var sCost = E.optionCost(S,p,sop);        // S26：支援 costSalaryMult 依月薪計價
        if(sCost && p.cash<sCost){ break; }       // 買不起則視同不投資
        E.applyEffects(S,p,sop.effects,sc.title);
        E.resolveOptionOutcome(S,p,sop,sc.title);   // S27：機率型選項（沒寫 chance 就是 no-op）
        if(p.cash<0) E.enterBankruptcy(S,p);
      }
      break; }

    case "SELL_OFFER": {
      if(optionId==="decline") break;
      var so=p.assets.filter(function(x){return x.instanceId===optionId;})[0];
      if(so){ E.sellAsset(S,p,so, E.sellMult(S,so)); // sellMult 已含 SELL_WINDOW 溢價
        var more=p.assets.filter(function(x){ return (!d.filter||!d.filter.kind||d.filter.kind===x.kind); });
        if(more.length && !p.isNPC) E.pushDecision(S,p,{kind:"SELL_OFFER", cardId:d.cardId, priceMult:d.priceMult, filter:d.filter});
      }
      break; }

    case "CHOICE": {
      var cc=ns.content.byId[d.cardId], cop=cc.decision.options[optionId|0];
      if(cop){
        // S26：與 SELF_INVEST 同一套規則——先修技能未達的選項不生效，成本支援依月薪計價。
        if(E.optionLocked(S,p,cop)) break;
        var cCost = E.optionCost(S,p,cop);
        if(cCost && p.cash<cCost){ break; }
        E.applyEffects(S,p,cop.effects,cc.title);
        E.resolveOptionOutcome(S,p,cop,cc.title);   // S27：機率型選項（沒寫 chance 就是 no-op）
        if(p.cash<0) E.enterBankruptcy(S,p);
      }
      break; }

    case "BUY": {
      var card=ns.content.byId[d.cardId];
      if(optionId==="skip"){ p.stats.passedOpps++;
        if(card && card.payload && card.payload.isScam) p.stats.scamPassed=(p.stats.scamPassed||0)+1;   // S22：徽章「鋼鐵避險王」
        break; }
      E.buyAsset(S,p,card,optionId,params);
      break; }

    case "FOLLOW_ON": {
      var as=p.assets.filter(function(x){return x.instanceId===d.assetId;})[0];
      if(!as) break;
      var pre=d.pre, raise=d.raise, post=d.post;
      if(optionId==="follow" && p.cash>=util.r2(raise*as.equityPct)){
        var inv=util.r2(raise*as.equityPct);
        // S13.1 NEW-01：跟投出資只走 CASH。持股價值一律由下方「估值更新」以 post×equityPct 一次調到位；
        // 這裡若再記一筆 ASSET，會與那一筆重複入帳（倒閉沖銷只沖 marketValue，沖不掉這筆），造成淨值永久虛增。
        ledger.post(S,p,"跟投："+as.name,[{account:"CASH",delta:-inv,label:"跟投出資"}],{eduTags:["startup","dilution"]});
        as.costBasis=util.r2(as.costBasis+inv);
      } else {
        as.equityPct = util.r2(as.equityPct*pre/post*10000)/10000;
      }
      as.postMoney=post;
      var nv=util.r2(post*as.equityPct), dv=util.r2(nv-as.marketValue);
      if(dv){ as.marketValue=nv;
        ledger.post(S,p,as.name+" 估值更新",[{account:"ASSET",delta:dv,refId:as.instanceId,label:"新一輪估值"}],{eduTags:["startup"]}); }
      break; }

    case "BUY_PROGRESS": {
      if(optionId==="buy") E.buyDreamProgress(S,p);
      break; }

    case "GRADUATE": {
      if(optionId==="go") E.enterOuterCircle(S,p);
      break; }

    case "BANKRUPTCY": {
      if(optionId==="declare"){ E.declareBankrupt(S,p); }
      break; }

    case "FREEFALL_RESCUE": {
      if(optionId==="fall"){ E.freefall(S,p); break; }
      var ra=p.assets.filter(function(x){ return x.instanceId===optionId && x.kind!=="P2P_LOAN"; })[0];
      if(!ra){ E.freefall(S,p); break; }                       // 防禦：選項失效即跌落
      E.sellAsset(S,p,ra,S.config.fireSaleRatio);
      if(p.cash>=0){
        p.freefallWarnings++;
        E.ev("FREEFALL_AVERTED",{playerId:p.id, warnings:p.freefallWarnings,
          cap:(E.cfg(S,"freefallWarningCap")!==undefined?E.cfg(S,"freefallWarningCap"):2)});
      } else if(p.assets.some(function(x){return x.kind!=="P2P_LOAN";})){
        E.pushDecision(S,p,{ kind:"FREEFALL_RESCUE", warnings:p.freefallWarnings,
          cap:(E.cfg(S,"freefallWarningCap")!==undefined?E.cfg(S,"freefallWarningCap"):2) });
      } else E.freefall(S,p);
      break; }
  }
};

/* ============================== 交易 ==================================== */
// C2：事業與不動產現金流係數脫鉤——BUSINESS 用 bizIncomeMult(缺省回退 assetIncomeMult)
E.incomeMultFor = function(S, kind){
  if(kind==="BUSINESS"){ var v=E.cfg(S,"bizIncomeMult"); if(v!==undefined && v>0) return v; }
  return S.config.assetIncomeMult;
};
E.buyAsset = function(S,p,card,optionId,params){
  var pl=card.payload, id=util.uid(S,"A"), post=[], name=card.title;
  var im = S.config.assetIncomeMult;

  if(card.kind==="REALESTATE"){
    var useLoan = optionId==="loan" && E.canUseLoan(S);
    var ltv = useLoan ? Math.min(params.ltv!==undefined?params.ltv:(1-pl.downPayment/pl.price), E.effMaxLTV(S,card)) : 0;
    var loan = util.r2(pl.price*ltv), down = util.r2(pl.price-loan);
    if(p.cash<down) return;
    var rent=util.r2((pl.monthlyRent||0)*im), cost=util.r2(pl.monthlyCost||0);   // V4：缺欄位防 NaN
    p.assets.push({ instanceId:id, cardId:card.id, kind:"REALESTATE", name:name, units:1,
      costBasis:pl.price, marketValue:pl.price, monthlyIncome:util.r2(rent-cost),
      ownCash:down,                        // S14a：自備現金（純紀錄，供「現金報酬率」用，不參與任何計算）
      linkedLiabilityId:null, exitMultipliers:pl.exitMultipliers, flags:{} });
    post.push({account:"CASH",delta:-down,label:"自備款"});
    post.push({account:"ASSET",delta:pl.price,refId:id,label:name});
    post.push({account:"INCOME_PASSIVE",delta:util.r2(rent-cost),refId:id,label:name+" 淨租金"});
    if(loan>0){
      var rate = E.rRate(S.macro.baseRate+E.cfg(S,"mortgageSpread"));
      var lid = E.addLiability(S,p,"MORTGAGE",name+" 房貸",loan,rate,true,id,true);
      p.assets[p.assets.length-1].linkedLiabilityId=lid;
      var mLoanO=p.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      post.push({account:"LIABILITY",delta:loan,refId:lid,label:name+" 房貸"});
      post.push({account:"EXPENSE",delta:mLoanO.monthlyPayment,refId:lid,label:name+" 房貸月付"});
    }
    ledger.post(S,p,(loan>0?"貸款買入：":"現金買入：")+name,post,{eduTags:loan>0?["leverage","passive-income"]:["passive-income"]});

  } else if(card.kind==="STOCK"){
    if(E.isDelisted(S,pl.symbol)) return;          // S16：卡還在手上時才下市——不能再成交
    var price = E.stockPrice(S,pl.symbol) || pl.offerPrice;
    var units = Math.max(1, Math.floor(params.units||1));
    var total = util.r2(price*units);
    var margin = optionId==="margin" && E.canUseAdvanced(S) && S.enabledModules.indexOf("M1")>=0;
    var ownCash = margin ? util.r2(total*S.config.marginRatio) : total;
    if(p.cash<ownCash) return;
    var def = ns.content.stockBySymbol[pl.symbol];
    // 六期：現股與融資分倉——融資買進一律獨立部位（各自維持率），現股只與現股合併
    var ex = margin ? null : p.assets.filter(function(x){return x.kind==="STOCK"&&x.symbol===pl.symbol&&!(x.flags&&x.flags.margin);})[0];
    var div = util.r2(units*E.stockDivPerUnit(S,def));      // S23a：同上
    if(ex){ ex.units+=units; ex.costBasis=util.r2(ex.costBasis+total); ex.marketValue=util.r2(ex.marketValue+total);
      ex.monthlyIncome=util.r2(ex.monthlyIncome+div); id=ex.instanceId;
      ex.ownCash=util.r2((ex.ownCash!==undefined?ex.ownCash:ex.costBasis-total)+ownCash); }   // S14a：加碼也累加自備現金
    else { p.assets.push({ instanceId:id, cardId:card.id, kind:"STOCK",
      name:E.stockName(S,pl.symbol)+(margin?"（融資）":""), symbol:pl.symbol,
      units:units, costBasis:total, marketValue:total, monthlyIncome:div,
      ownCash:ownCash,                     // S14a：自備現金（純紀錄）
      linkedLiabilityId:null, flags:(margin?{margin:true}:{}) }); }
    post.push({account:"CASH",delta:-ownCash,label:"買進股票"});
    post.push({account:"ASSET",delta:total,refId:id,label:E.stockName(S,pl.symbol)});
    if(div) post.push({account:"INCOME_PASSIVE",delta:div,refId:id,label:E.stockName(S,pl.symbol)+" 股息"});
    if(margin){ var mrate=E.rRate(S.macro.baseRate+E.cfg(S,"marginSpread")), mAmt=util.r2(total-ownCash);
      var mid=E.addLiability(S,p,"MARGIN","融資："+E.stockName(S,pl.symbol),mAmt,mrate,false,id,true);
      var mAsset=p.assets.filter(function(x){return x.instanceId===id;})[0]; if(mAsset) mAsset.linkedLiabilityId=mid;
      post.push({account:"LIABILITY",delta:mAmt,refId:mid,label:"融資餘額"});
      post.push({account:"EXPENSE",delta:util.r2(mAmt*mrate/12),refId:mid,label:"融資利息"}); }
    ledger.post(S,p,(margin?"融資買進：":"買進：")+E.stockName(S,pl.symbol)+" ×"+units,post,{eduTags:margin?["leverage","equity"]:["equity"]});

  } else if(card.kind==="BUSINESS"){
    var useCredit = optionId==="loan" && E.canUseLoan(S);
    var cap = useCredit ? E.creditCapacity(S,p) : 0;
    var loanB = useCredit ? Math.min(params.loan!==undefined?params.loan:Math.max(0,pl.price-p.cash), cap, pl.price) : 0;
    loanB = util.r2(Math.max(0,loanB));
    var downB = util.r2(pl.price-loanB);
    if(p.cash<downB) return;
    var profit=util.r2(pl.monthlyProfit*E.incomeMultFor(S,"BUSINESS"));   // C2：事業獨立係數
    p.assets.push({ instanceId:id, cardId:card.id, kind:"BUSINESS", name:name, units:1,
      costBasis:pl.price, marketValue:pl.price, monthlyIncome:profit,
      baseMonthlyIncome:util.r2(profit/E.bizMult(S,S.macro.stage)),   // C：景氣係數還原後的基準
      ownCash:downB,                       // S14a：自備現金（純紀錄）
      volatileProfit:!!pl.volatileProfit, linkedLiabilityId:null, flags:{} });
    var postB=[{account:"CASH",delta:-downB,label:loanB>0?"自備價金":"買入價金"},
      {account:"ASSET",delta:pl.price,refId:id,label:name},
      {account:"INCOME_PASSIVE",delta:profit,refId:id,label:name+" 月分紅"}];
    if(loanB>0){
      var crate=E.rRate(S.macro.baseRate+E.cfg(S,"creditSpread"));
      var cid=E.addLiability(S,p,"CONSUMER","企業信用貸款："+name,loanB,crate,false,null,true);
      var cLoanO=p.liabilities.filter(function(x){return x.instanceId===cid;})[0];
      postB.push({account:"LIABILITY",delta:loanB,refId:cid,label:"企業信用貸款"});
      postB.push({account:"EXPENSE",delta:cLoanO.monthlyPayment,refId:cid,label:name+" 貸款月付"});
    }
    ledger.post(S,p,(loanB>0?"貸款買下事業：":"買下事業：")+name,postB,{eduTags:loanB>0?["business","leverage","passive-income"]:["business","passive-income"]});
    // S22：偽裝成事業的吸金盤——先照常配息，到期資金鏈斷裂整筆歸零（見 E.tickScamInvestments）
    if(pl.isScam){
      p.scamInvestments = p.scamInvestments||[];
      p.scamInvestments.push({ instanceId:id, cardId:card.id, title:name,
        crashTurn: S.turnNumber + (pl.scamDelayTurns||3) });
      p.stats.scamBought = (p.stats.scamBought||0) + 1;
    }

  } else if(card.kind==="STARTUP"){
    var invAmt = util.r2(pl.investAmount||0);                 // 缺欄位防禦（鐵律一）
    if(p.cash<invAmt) return;
    p.assets.push({ instanceId:id, cardId:card.id, kind:"STARTUP", name:name, units:1,
      costBasis:invAmt, marketValue:invAmt, monthlyIncome:0, ownCash:invAmt,   // S14a：自備現金（純紀錄）
      equityPct:(pl.equityPct||0), postMoney:(pl.postMoney||0), linkedLiabilityId:null, flags:{} });
    ledger.post(S,p,"投資新創："+name,[{account:"CASH",delta:-invAmt,label:"投資款"},
      {account:"ASSET",delta:invAmt,refId:id,label:name+"（股權）"}],{eduTags:["startup"]});
  }
  if(E.applyCarpentry) E.applyCarpentry(S,p);   // S7b：新買的房子也吃得到木工加成（冪等）
  E.trackLeverage(p);
  E.ev("ASSET_BOUGHT",{playerId:p.id, cardId:card.id});
};

E.addLiability = function(S,p,kind,name,principal,rate,floating,collateral,silent){
  var id=util.uid(S,"L");
  var isStu = E.isStudentLoan(name);
  var term = E.loanTerm(S, kind, isStu);
  // 九期：台灣的貸款絕大多數是「基準＋加碼」的機動利率——除非明確關閉，一律浮動
  var floatDefault = E.cfg(S,"floatingByDefault"); if(floatDefault===undefined) floatDefault=1;
  var isFloat = floatDefault ? (floating!==false) : !!floating;
  // 商品加碼＝承作時的利率減去當下基準（日後基準變動時據此重算）
  var spread = E.rRate(rate - S.macro.baseRate);
  if(!(spread>=0)) spread=E.cfg(S,"mortgageSpread");
  // M7：新貸款利率＝基準＋商品加碼＋信用評級加碼（利率一律 4 位小數）
  rate = E.rRate(rate + E.creditSpread(S,p));
  var pay = term>0 ? E.pmt(principal, rate, term) : util.r2(principal*rate/12);
  var l={ instanceId:id, kind:kind, name:name, principal:util.r2(principal),
    annualRate:rate, isFloating:isFloat, rateSpread:spread,
    termMonths:term, monthlyPayment:pay, collateralAssetId:collateral||null, flags:{},
    originalPrincipal:util.r2(principal), startTurn:S.turnNumber, periodsPaid:0 };
  if(isStu){ l.studentLoan=true; l.graceUntilTurn=(S.config.studentGraceTurns===undefined?24:S.config.studentGraceTurns);
    l.amortStarted=false; l.monthlyPayment=0; pay=0; }
  p.liabilities.push(l);
  if(!silent) ledger.post(S,p,"新增負債："+name,[{account:"LIABILITY",delta:util.r2(principal),refId:id,label:name},
    {account:"EXPENSE",delta:pay,refId:id,label:name+(term>0?" 月付":"利息")}],{eduTags:["debt"]});
  return id;
};

// S13.1 NEW-03（未預期發現）：負債被移除時，指著它的資產必須同時解除連結。
// 否則房貸繳清後 a.linkedLiabilityId 仍指向一筆已不存在的負債，該資產會被
// PROPOSE_TRADE（reject MORTGAGED）、廣播轉讓 sellable、sell_half 等處永久判定為「還在抵押中」。
E.unlinkLiability = function(p, lid){
  if(!lid) return;
  (p.assets||[]).forEach(function(a){ if(a.linkedLiabilityId===lid) a.linkedLiabilityId=null; });
};
E.repay = function(S,p,l,amt){
  var newP=util.r2(l.principal-amt);
  var post=[{account:"CASH",delta:-amt,label:"還本"},{account:"LIABILITY",delta:-amt,refId:l.instanceId,label:l.name}];
  l.principal=newP;
  if(newP<=0.01){ post.push({account:"EXPENSE",delta:-l.monthlyPayment,refId:l.instanceId,label:l.name+" 月付終止"}); }
  else if(!l.termMonths){ // 只付息貸款（融資）：還本後利息同步下降
    var dI=E.repriceLoan(l); if(dI) post.push({account:"EXPENSE",delta:dI,refId:l.instanceId,label:l.name+" 利息調整"});
  }
  // 七期：融資類償還改叫「補繳保證金」，避免與一般貸款「提前還本」混淆
  ledger.post(S,p,(l.kind==="MARGIN"?"補繳保證金：":"提前還本：")+l.name,post,{eduTags:["debt"]});
  if(newP<=0.01){
    p.liabilities=p.liabilities.filter(function(x){return x.instanceId!==l.instanceId;});
    E.unlinkLiability(p, l.instanceId);         // S13.1 NEW-03
  }
};

E.sellMult = function(S,a){
  var w = S.activeGlobalEvents.filter(function(e){ return e.kind==="SELL_WINDOW" &&
    (!e.filter || !e.filter.kind || e.filter.kind===a.kind); })[0];
  if(w) return w.priceMult;
  if(a.kind==="REALESTATE" && a.exitMultipliers && S.enabledModules.indexOf("M4")>=0)
    return a.exitMultipliers[S.macro.stage]||1;
  return 1;
};

/* S15：賣掉這一筆到底拿得到多少現金——不動任何狀態的預覽。
   實測回報的缺陷：破產畫面用「急售毛額」判斷夠不夠，但貸款買的資產要先清償，
   實際入袋是 毛額 − 清償，可能是 0。反例（已實跑）：缺 500、市值 1000、房貸 800，
   畫面寫「約可拿回 800　✅ 賣這一筆就夠了」，實際入袋 0，還少了每月租金。
   決策表與 sellAsset 一律共用這支函式，避免同一算式寫成兩份而漂移。 */
E.sellPreview = function(S, p, a, mult){
  var gross = util.r2((a.marketValue||0)*mult);
  var lk = (p.liabilities||[]).filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
  var out = { gross:gross, payoff:0, netCash:gross, residualDebt:0,
              monthlyPayFreed:0, monthlyPayAfter:0, incomeLoss:util.r2(a.monthlyIncome||0),
              cashflowDelta:0, hasLoan:!!lk };
  if(lk){
    var pay = Math.min(gross, lk.principal), rest = util.r2(lk.principal-pay);
    out.payoff = util.r2(pay);
    out.netCash = util.r2(gross-pay);
    out.residualDebt = rest>0.01 ? rest : 0;
    if(rest>0.01){
      // 餘債轉信貸並重新攤還——月付會變，而且通常變高（年限縮短）
      var clone = { principal:rest, annualRate:lk.annualRate, monthlyPayment:lk.monthlyPayment,
                    termMonths:E.loanTerm(S,"CONSUMER",false),
                    studentLoan:lk.studentLoan, amortStarted:lk.amortStarted };
      var d = E.repriceLoan(clone);
      out.monthlyPayAfter = util.r2(clone.monthlyPayment);
      out.monthlyPayFreed = util.r2(-d);            // 負值＝月付反而變重
    } else {
      out.monthlyPayFreed = util.r2(lk.monthlyPayment||0);
    }
  }
  // 賣掉之後每月現金流的淨變化：少收租金、但省下（或多付）貸款月付
  out.cashflowDelta = util.r2(out.monthlyPayFreed - out.incomeLoss);
  return out;
};

E.sellAsset = function(S,p,a,mult,opts){
  opts = opts||{};
  var gross = util.r2(a.marketValue*mult);
  var post=[{account:"ASSET",delta:-a.marketValue,refId:a.instanceId,label:a.name+" 出售"}];
  if(a.monthlyIncome) post.push({account:"INCOME_PASSIVE",delta:-a.monthlyIncome,refId:a.instanceId,label:a.name+" 收入終止"});
  var cash=gross;
  var lk = p.liabilities.filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
  if(lk){
    var pay=Math.min(gross, lk.principal), rest=util.r2(lk.principal-pay);
    cash=util.r2(gross-pay);
    post.push({account:"LIABILITY",delta:-pay,refId:lk.instanceId,label:"清償"+lk.name});
    if(rest>0.01){
      lk.principal=rest; lk.kind="CONSUMER"; lk.collateralAssetId=null; lk.isFloating=false;
      lk.termMonths=E.loanTerm(S,"CONSUMER",false);
      var d=E.repriceLoan(lk);
      post.push({account:"EXPENSE",delta:d,refId:lk.instanceId,label:lk.name+" 月付調整"});
    } else {
      post.push({account:"EXPENSE",delta:-lk.monthlyPayment,refId:lk.instanceId,label:lk.name+" 月付終止"});
      p.liabilities=p.liabilities.filter(function(x){return x.instanceId!==lk.instanceId;});
      E.unlinkLiability(p, lk.instanceId);      // S13.1 NEW-03
    }
  }
  post.push({account:"CASH",delta:cash,label:"出售價款"});
  var pl = util.r2(gross-a.costBasis);
  var sum = opts.summary || ("賣出："+a.name+"（損益 "+(pl>=0?"+":"")+util.money(pl)+"）");
  ledger.post(S,p,sum,post,{eduTags:opts.eduTags||["exit"]});
  p.assets=p.assets.filter(function(x){return x.instanceId!==a.instanceId;});
  // S25c 修復：數位資產賣出後要回頭切斷 p.digitalAssets 的來源狀態機，否則
  // E.tickDigital 下次發薪日會發現 p.assets 裡的鏡射不見了、以為是「新起飛」
  // 又生一筆回來（資產、被動收入、維護費全部原樣復活）。用 E.dropDigital 收尾，
  // 順便把維護費停掉、時間槽讓出，跟主動「收掉」數位資產走同一套結算路徑。
  if(a.kind==="DIGITAL" && a.flags && a.flags.digital){
    var dgSold=(p.digitalAssets||[]).filter(function(x){ return x.id===a.flags.digital && !x.dead; })[0];
    if(dgSold) E.dropDigital(S,p,dgSold,"賣出數位資產");
  }
  E.ev(opts.evName||"ASSET_SOLD",{playerId:p.id, name:a.name, pl:pl});
};

/* ===================== S7b：投機股下市（先警告再下市） =====================
   撈底不是穩賺——最壞的情況是歸零，而且融資的債不會跟著消失。
   流程：跌破門檻且景氣踏入蕭條 → 警示（持股者跳卡，可停損）→
        緩衝輪數後條件仍成立 → 下市歸零；期間價格回來或景氣改善則解除警示。  */
// 下市警示在【自己的回合開始】才跳卡，不在回合結束推給別人（見 tickDelist 的說明）
E.tickDelistWarn = function(S, p){
  var w = p.pendingDelistWarn;
  if(!w) return;
  p.pendingDelistWarn = null;
  if(p.bankrupt) return;
  if(S.delisted && S.delisted[w.symbol]) return;                  // 已經來不及了
  if(!(S.delistWatch && S.delistWatch[w.symbol])) return;          // 警示已解除
  if(!p.assets.some(function(a){ return a.kind==="STOCK" && a.symbol===w.symbol; })) return;  // 已經賣掉了
  E.pushDecision(S,p,{ kind:"DELIST_WARN", symbol:w.symbol, until:w.until,
                       hazard:w.hazard, level:w.level });   // S23a：機率模式帶風險等級
};

E.delistOn = function(S){
  if(!E.cfg(S,"delistEnabled")) return false;
  return S.enabledModules.indexOf("M1")>=0;
};
E.delistHazardMode = function(S){ return E.cfg(S,"delistMode")!=="fixed"; };   // 預設 hazard

/* S23a：每局暗抽一個「跌到多深才算進入危險區」的門檻。
   S22 是固定的面額 20%，玩家玩兩局就背起來了（實測回饋：「跌到 1200 就知道要倒」）。
   改成開局在 delistDdMin~delistDdMax 之間抽一次、整局不變、種子決定（重放仍決定論），
   玩家只知道大概範圍，不知道這一局的確切數字。                              */
E.delistThresholdFor = function(S, def){
  if(!def) return 1;
  S.delistThreshold = S.delistThreshold || {};
  if(S.delistThreshold[def.symbol]===undefined){
    var lo=E.cfg(S,"delistDdMin"); if(lo===undefined) lo=0.75;
    var hi=E.cfg(S,"delistDdMax"); if(hi===undefined) hi=0.90;
    S.delistThreshold[def.symbol] = util.r2(lo + util.rand(S)*(hi-lo));
  }
  return S.delistThreshold[def.symbol];
};
// 這檔股票「這一輪」的倒閉機率（0＝安全）。純函式：只讀狀態不改狀態（門檻的暗抽除外）。
E.delistHazard = function(S, def){
  if(!E.delistOn(S) || !def) return 0;
  var mult = (def.delistHazardMult!==undefined && isFinite(def.delistHazardMult))
             ? def.delistHazardMult : (def.delistable ? 1 : 0);
  if(!(mult>0)) return 0;                                  // 不會倒的股票（ETF、高股息）
  if(S.delisted && S.delisted[def.symbol]) return 0;
  var stage = S.enabledModules.indexOf("M4")>=0 ? (S.macro&&S.macro.stage) : null;
  var base = 0;
  if(stage==="RECESSION"){ base=E.cfg(S,"delistHazardRecession"); if(base===undefined) base=0.08; }
  else if(stage==="DEPRESSION"){ base=E.cfg(S,"delistHazardDepression"); if(base===undefined) base=0.25; }
  if(!(base>0)) return 0;                                  // 景氣好的時候撐得住，跌再深也不會倒
  var price = S.stockPrices[def.symbol];
  if(!isFinite(price) || !(def.face>0)) return 0;
  var dd = 1 - price/def.face;                             // 從面額算起的跌幅
  if(dd < E.delistThresholdFor(S,def)) return 0;           // 還沒進危險區
  if(dd >= 0.90) base *= 2;                                // 跌破九成：風險加倍
  var w = (S.delistWatch||{})[def.symbol];
  var streak = w ? (w.streak||1) : 1;                      // 在危險區撐越久越危險
  var per = E.cfg(S,"delistHazardPerTurn"); if(per===undefined) per=0.03;
  return Math.max(0, Math.min(0.9, util.r2((base + per*(streak-1)) * mult)));
};
E.delistRiskLevel = function(h){ return h<=0 ? null : (h<0.1 ? "低" : (h<0.25 ? "中" : "高")); };
// 這檔股票現在符合「快下市」的條件嗎（純判斷，不改狀態）
E.delistRisk = function(S, def){
  if(!E.delistOn(S)) return false;
  if(E.delistHazardMode(S)) return E.delistHazard(S,def) > 0;
  if(!def.delistable) return false;              // 只有投機股會走到下市
  if(S.delisted && S.delisted[def.symbol]) return false;
  var stage = S.enabledModules.indexOf("M4")>=0 ? (S.macro&&S.macro.stage) : null;
  if(stage !== "DEPRESSION") return false;              // 只有蕭條期才會走到下市
  var ratio = E.cfg(S,"delistPriceRatio"); if(ratio===undefined) ratio=0.2;
  var price = S.stockPrices[def.symbol];
  if(!isFinite(price)) return false;
  return price <= util.r2(def.face*ratio);
};

/* S23c：defs 可指定要判定哪一批（迷因幣的報價在 M9 才更新，所以它的歸零判定也要
   跟在 M9 後面跑，不能跟股票一起在 M1 判）。不傳＝維持原行為，只判 stockDefs。 */
E.tickDelist = function(S, defs){
  if(!E.delistOn(S)) return;
  S.delistWatch = S.delistWatch||{}; S.delisted = S.delisted||{};
  var warnT = E.cfg(S,"delistWarnTurns"); if(warnT===undefined) warnT=2;
  var hazMode = E.delistHazardMode(S);
  (defs || ns.content.stockDefs).forEach(function(def){
    var sym=def.symbol;
    if(S.delisted[sym]) return;
    var w = S.delistWatch[sym];
    /* S23a 機率制：進危險區先給一輪緩衝（只警示不擲），之後每輪擲一次。
       撐過去不代表安全，撐越久機率越高；景氣回來或價格漲回去就解除。 */
    if(hazMode){
      var haz = E.delistHazard(S, def);
      if(!haz){
        if(w){ delete S.delistWatch[sym];
          S.players.forEach(function(pl){
            if(pl.pendingDelistWarn && pl.pendingDelistWarn.symbol===sym) pl.pendingDelistWarn=null; });
          E.ev("DELIST_CLEARED",{symbol:sym, name:E.stockName(S,sym)}); }
        return;
      }
      var lvl = E.delistRiskLevel(haz);
      if(!w){
        S.delistWatch[sym] = { since:S.turnNumber, streak:1, hazard:haz, level:lvl };
        E.ev("DELIST_WARNED",{symbol:sym, name:E.stockName(S,sym), price:S.stockPrices[sym],
                              hazard:haz, level:lvl});
        E.markDelistWarn(S, sym, {symbol:sym, hazard:haz, level:lvl});
        return;                                    // delistGraceTurns：第一輪只警示，不擲
      }
      var prevLvl = w.level;
      w.streak = (w.streak||1)+1; w.hazard = haz; w.level = lvl;
      if(lvl!==prevLvl){                           // 風險等級變了才重跳卡，不要每輪都吵
        E.ev("DELIST_RISK_CHANGED",{symbol:sym, name:E.stockName(S,sym), hazard:haz, level:lvl, from:prevLvl});
        E.markDelistWarn(S, sym, {symbol:sym, hazard:haz, level:lvl});
      }
      if(util.rand(S) >= haz) return;              // 這一輪撐過去了
      E.doDelist(S, def);
      return;
    }
    var risky = E.delistRisk(S, def);
    if(!w){
      if(!risky) return;
      S.delistWatch[sym] = { since:S.turnNumber, until:S.turnNumber+warnT };
      E.ev("DELIST_WARNED",{symbol:sym, name:E.stockName(S,sym),
                            price:S.stockPrices[sym], until:S.turnNumber+warnT});
      // 持股的人要親眼看到，但【不能在這裡推決策】——
      // tickDelist 跑在回合結束，此時的「當前玩家」不一定是持股者。
      // 引擎的不變式是「待決策一定屬於當前玩家」：ui.tick 只驅動當前玩家，
      // 而畫面等的是決策的擁有者；兩者不一致時就沒有人會去動它 → 整局死當。
      // 所以先記在玩家身上，等輪到他自己時（E.beginTurn）再跳卡。
      S.players.forEach(function(pl){
        if(pl.bankrupt) return;
        if(!pl.assets.some(function(a){ return a.kind==="STOCK" && a.symbol===sym; })) return;
        pl.pendingDelistWarn = { symbol:sym, until:S.turnNumber+warnT };
      });
      return;
    }
    if(!risky){                                        // 價格回來或景氣改善 → 解除
      delete S.delistWatch[sym];
      S.players.forEach(function(pl){
        if(pl.pendingDelistWarn && pl.pendingDelistWarn.symbol===sym) pl.pendingDelistWarn=null; });
      E.ev("DELIST_CLEARED",{symbol:sym, name:E.stockName(S,sym)});
      return;
    }
    if(S.turnNumber < w.until) return;                 // 還在緩衝期
    E.doDelist(S, def);
  });
};

// 警示要跳給持股者看，但【不能在這裡推決策】——tickDelist 跑在回合結束，
// 此時的「當前玩家」不一定是持股者。引擎的不變式是「待決策一定屬於當前玩家」：
// ui.tick 只驅動當前玩家，而畫面等的是決策的擁有者；兩者不一致就沒人會去動它 → 整局死當。
// 所以先記在玩家身上，等輪到他自己時（E.beginTurn → E.tickDelistWarn）再跳卡。
E.markDelistWarn = function(S, sym, info){
  S.players.forEach(function(pl){
    if(pl.bankrupt) return;
    if(!pl.assets.some(function(a){ return a.kind==="STOCK" && a.symbol===sym && !(a.flags&&a.flags.wallpaper); })) return;
    pl.pendingDelistWarn = info;
  });
};

/* 真的下市：持股歸零、留一張市值 0 的壁紙當紀錄。融資的債不會跟著消失
   ——sellAsset(…,0) 會把它轉成信貸留在身上（S23a 機率制沿用同一條路）。 */
E.doDelist = function(S, def){
  var sym = def.symbol;
    // 下市：持股歸零。融資的債不會消失——sellAsset(…,0) 會把它轉成信貸留在身上。
    S.delisted[sym]=true; delete S.delistWatch[sym];
    S.stockPrices[sym]=0;
    S.players.forEach(function(pl){
      if(pl.pendingDelistWarn && pl.pendingDelistWarn.symbol===sym) pl.pendingDelistWarn=null; });
    S.players.forEach(function(p){
      if(p.bankrupt) return;
      p.assets.slice().forEach(function(a){
        if(a.kind!=="STOCK" || a.symbol!==sym) return;
        var basis=a.costBasis;
        E.sellAsset(S,p,a,0,{ summary:"下市歸零："+a.name+"（投入 "+util.money(basis)+" 全數認賠）",
                              eduTags:["exit","loss","delist"], evName:"DELIST_LOSS" });
        // S12：實測回饋——原本 sellAsset 會把部位整個從資產負債表移除，
        // 玩家連「我在這檔上賠了多少」都看不到了。改成留一張市值 0 的壁紙：
        // 帳上金額全部是 0（不影響淨值與被動收入），但買進成本留著當紀錄。
        p.assets.push({ instanceId:util.uid(S,"A"), cardId:a.cardId, kind:"STOCK",
          name:a.name+"（已下市）", symbol:sym, units:a.units,
          costBasis:basis, marketValue:0, monthlyIncome:0,
          linkedLiabilityId:null, flags:{ delisted:true, wallpaper:true,
                                          delistedAt:S.turnNumber, lostAmount:basis } });
      });
      if(p.cash<0) E.enterBankruptcy(S,p);
    });
    var holders=S.players.filter(function(pl){
      return (pl.assets||[]).some(function(a){ return a.flags && a.flags.wallpaper && a.symbol===sym
                                                      && a.flags.delistedAt===S.turnNumber; }); });
    E.ev("DELISTED",{symbol:sym, name:E.stockName(S,sym),
                     holderIds:holders.map(function(x){ return x.id; }),
                     holderNames:holders.map(function(x){ return x.name; }),
                     totalLost:util.r2(util.sum(holders,function(pl){
                       return util.sum(pl.assets.filter(function(a){
                         return a.flags && a.flags.wallpaper && a.symbol===sym
                                && a.flags.delistedAt===S.turnNumber; }),
                         function(a){ return a.flags.lostAmount||0; }); }))});
};


/* ==================== S23b：M9 進階金融 ====================
   兩個東西：解鎖（誰有資格下場）與期貨（第一個上場的商品）。
   設計原則沿用整套遊戲的規矩：所有數字掛 config、亂數走 util.rand(S)、
   決策一律推給「決策的擁有者」在他自己的回合處理（S15d 的死結教訓）。   */

E.m9On = function(S){
  if(S.enabledModules.indexOf("M9")<0) return false;
  var v = E.cfg(S,"advancedMarketsEnabled");
  return v===undefined ? true : !!v;
};
/* 解鎖條件（Brian 定案）：學會〈衍生性商品與槓桿〉，**或**任一檔股票【累計】持有滿 N 輪。
   累計而非連續——中途賣掉再買回來，前面累積的經驗不該歸零。 */
E.tickHoldTurns = function(S){
  S.players.forEach(function(p){
    if(p.bankrupt) return;
    var holds = (p.assets||[]).some(function(a){
      return a.kind==="STOCK" && (a.units>0) && !(a.flags && a.flags.wallpaper); });
    if(holds) p.stockHoldTurns = (p.stockHoldTurns||0) + 1;
  });
};
E.advUnlockNeed = function(S){
  var n = E.cfg(S,"advUnlockHoldTurns"); return n===undefined ? 12 : n;
};
E.advancedUnlocked = function(S, p){
  if(!E.m9On(S) || !p) return false;
  if(E.hasSkill && E.hasSkill(p,"SKL_DERIV")) return true;
  return (p.stockHoldTurns||0) >= E.advUnlockNeed(S);
};
// 還差什麼才解得開——介面用（反灰時要說得出原因）
E.advLockReason = function(S, p){
  if(!E.m9On(S)) return "本局沒有開啟「M9 進階金融」模組";
  if(E.advancedUnlocked(S,p)) return null;
  var left = Math.max(0, E.advUnlockNeed(S) - (p.stockHoldTurns||0));
  return "還差 "+left+" 輪持股經驗（已累計 "+(p.stockHoldTurns||0)+" 輪），或學會〈衍生性商品與槓桿〉";
};

/* ------------------------------ 期貨 ------------------------------
   一口的合約值 ＝ 標的現價 × 契約乘數；開倉只付 marginPct（原始保證金），
   之後每輪依標的漲跌把損益直接加減在保證金餘額上（逐日結算的遊戲版）。
   做多做空都可以——這是「進階」的意義：方向判斷錯的代價一樣被放大。 */
E.futDef = function(sym){ return ns.content.futBySymbol ? ns.content.futBySymbol[sym] : null; };
/* S23b.1：期貨有自己的報價，不會等於現貨。
   真實市場的期貨相對現貨有「基差」（折價／溢價）——市場看多就溢價、看空就折價。
   這裡每輪重抽一次基差（±basisMax，預設 1%），期貨價 ＝ 現貨 × (1＋基差)。
   結算走期貨價而不是現貨價，所以基差本身也會影響損益——這正是期貨與現貨的差別。 */
/* 純讀取，【不得】在這裡抽亂數——介面每次重繪都會呼叫它，
   若在這裡消耗 util.rand(S)，亂數序列就會被「玩家看了幾次畫面」影響，
   重放就對不起來（實測：重放在第 2 輪就與原局分歧）。抽基差只在 tickFutures 裡做。 */
E.futBasis = function(S, def){
  if(!def || !S.futBasis) return 0;
  var v = S.futBasis[def.symbol];
  return (v===undefined || !isFinite(v)) ? 0 : v;
};
E.rollFutBasis = function(S, def){
  if(!def) return;
  S.futBasis = S.futBasis || {};
  var mx = E.cfg(S,"futBasisMax"); if(mx===undefined) mx = 0.01;
  S.futBasis[def.symbol] = util.r2((util.rand(S)*2-1) * mx * 1000)/1000;   // 保留到千分位
};
E.futPrice = function(S, def){
  if(!def) return 0;
  var u = E.stockPrice(S, def.underlying);
  if(!(u>0)) return 0;
  return util.r2(u * (1 + E.futBasis(S,def)));
};
E.futContractValue = function(S, def){
  if(!def) return 0;
  var mult = def.multiplier || 1;
  return util.r2(E.futPrice(S,def) * mult);
};
E.futMarginPct = function(S, def){
  var v = E.cfg(S,"futMarginPct");
  if(v===undefined || !isFinite(v)) v = (def && def.marginPct) || 0.1;
  return v;
};
// 維持保證金比例：學過衍生性商品的人門檻較寬（懂結算規則的人不用被抓那麼緊）
E.futMaintPct = function(S, def, p){
  var k = (p && E.hasSkill && E.hasSkill(p,"SKL_DERIV")) ? "futMaintPctSkilled" : "futMaintPct";
  var v = E.cfg(S,k);
  if(v===undefined || !isFinite(v)) v = (def && def.maintPct) || 0.05;
  return v;
};
E.futFee = function(S, lots){
  var f = E.cfg(S,"futFeePerLot"); if(f===undefined) f = 0.3;
  return util.r2(f * Math.max(0, lots));
};
// 口數上限依信用評級——槓桿不是誰都能開一樣多
E.futMaxLots = function(S, p){
  var g = (p && p.creditRating) || "B";
  var v = E.cfg(S,"futMaxLots_"+g);
  if(v===undefined || !isFinite(v)) v = 3;
  return v;
};
E.futPositions = function(p){
  return (p.assets||[]).filter(function(a){ return a.kind==="FUTURES"; });
};
E.futLotsHeld = function(p, sym){
  return E.futPositions(p).filter(function(a){ return !sym || a.symbol===sym; })
    .reduce(function(n,a){ return n + (a.lots||0); }, 0);
};
// 這個部位現在的維持率狀態
E.futStatus = function(S, a, p){
  var def = E.futDef(a.symbol);
  var cv = util.r2(E.futContractValue(S,def) * (a.lots||0));
  var need = util.r2(cv * E.futMaintPct(S,def,p));
  return { contractValue:cv, maintNeed:need, margin:util.r2(a.marketValue||0),
           ratio: need>0 ? util.r2((a.marketValue||0)/need) : 0,
           call: (a.marketValue||0) < need };
};

/* 逐輪結算：標的漲跌 × 契約乘數 × 口數 × 方向，直接加減保證金餘額。
   餘額 ≤ 0 → 強制平倉，超額虧損轉信貸（與融資斷頭同一套規矩：債不會憑空消失）。
   餘額低於維持保證金 → 記在玩家身上，等他自己的回合再跳追繳卡（S15d 的死結教訓）。 */
E.tickFutures = function(S){
  if(!E.m9On(S)) return;
  // 先重抽這一輪的基差（折溢價），再用新的期貨價結算
  (ns.content.futuresDefs||[]).forEach(function(fd){ E.rollFutBasis(S, fd); });
  S.players.forEach(function(p){
    if(p.bankrupt) return;
    E.futPositions(p).slice().forEach(function(a){
      var def = E.futDef(a.symbol); if(!def) return;
      var now = E.futPrice(S, def);
      var prev = (a.lastPrice!==undefined && isFinite(a.lastPrice)) ? a.lastPrice : a.entryPrice;
      var dir = a.side==="short" ? -1 : 1;
      var pnl = util.r2((now - prev) * (def.multiplier||1) * (a.lots||0) * dir);
      a.lastPrice = now;
      if(pnl){
        a.marketValue = util.r2((a.marketValue||0) + pnl);
        ledger.post(S, p, "期貨逐輪結算："+def.name+"（"+(a.side==="short"?"空":"多")+" "+a.lots+" 口）",
          [{account:"ASSET", delta:pnl, refId:a.instanceId,
            label:"期貨報價 "+util.money(prev)+" → "+util.money(now)+
                  "（現貨 "+util.money(E.stockPrice(S,def.underlying))+"、"+
                  (E.futBasis(S,def)>=0?"溢價":"折價")+" "+util.pct(Math.abs(E.futBasis(S,def)),1)+"）"}],
          {eduTags:["futures","leverage"], detail:{from:prev, to:now, lots:a.lots, side:a.side, pnl:pnl}});
      }
      var st = E.futStatus(S,a,p);
      /* S23b.1（Brian 定案）：保證金燒光時，只要現金補得起就【自動補倉】，不要直接強平。
         現實裡券商也是先通知補繳，補得出來就不會斷頭；直接砍倉對玩家太粗暴。
         補倉順序：先試著補回原始保證金；補不到就補到剛好活著的維持水位；
         連維持水位都補不出來，才強制平倉。 */
      if(a.marketValue <= 0 || st.call){
        var autoOn = E.cfg(S,"futAutoTopUp"); if(autoOn===undefined) autoOn = 1;
        if(autoOn && a.marketValue <= 0){
          var wantFull = util.r2(st.contractValue * E.futMarginPct(S,def));
          var needFull = util.r2(wantFull - a.marketValue);
          var needLive = util.r2(st.maintNeed - a.marketValue);
          var add = (p.cash >= needFull) ? needFull : ((p.cash >= needLive) ? needLive : 0);
          if(add > 0){
            a.marketValue = util.r2(a.marketValue + add);
            a.costBasis = util.r2((a.costBasis||0) + add);
            p.stats.futAutoTopUp = (p.stats.futAutoTopUp||0) + 1;
            ledger.post(S, p, "自動補繳保證金："+def.name+"（避免被強制平倉）",
              [{account:"CASH", delta:-add, label:"自動補繳"},
               {account:"ASSET", delta:add, refId:a.instanceId, label:"保證金餘額"}],
              {eduTags:["futures","margin-call"]});
            E.ev("FUT_AUTO_TOPUP",{playerId:p.id, instanceId:a.instanceId, amount:add,
                                   full:(add===needFull)});
            E.queueFutNotice(p, { title:"💸 自動補繳保證金："+def.name,
              text:"保證金已經見底，系統從你的現金自動補了 "+util.money(add)+
                   (add===needFull?"（補回原始保證金）":"（只補到勉強活著的維持水位）")+
                   "。部位保住了，但錢是真的出去了——想停損請到股市面板平倉。" });
            st = E.futStatus(S,a,p);
          }
        }
        if(a.marketValue <= 0){                     // 補不出來 → 只能強制平倉
          E.futForceClose(S,p,a);
          return;
        }
      }
      if(st.call){ p.pendingFutCall = { instanceId:a.instanceId, symbol:a.symbol,
                                        need:util.r2(st.maintNeed - st.margin), ratio:st.ratio }; }
    });
  });
};
// 自己的回合開始才跳追繳卡（決策一定要屬於當前玩家）
E.tickFutCall = function(S, p){
  // 先倒出上一輪結算時累積的通知（自動補繳／強制平倉）
  var nts = p.pendingFutNotices || [];
  p.pendingFutNotices = [];
  if(!p.bankrupt) nts.forEach(function(n){ E.pushDecision(S,p,{ kind:"ACK", title:n.title, text:n.text }); });
  var w = p.pendingFutCall; if(!w) return;
  p.pendingFutCall = null;
  if(p.bankrupt) return;
  var a = E.futPositions(p).filter(function(x){ return x.instanceId===w.instanceId; })[0];
  if(!a) return;                                     // 已經平掉了
  var st = E.futStatus(S,a,p);
  if(!st.call) return;                               // 價格回來了，追繳解除
  E.pushDecision(S,p,{ kind:"FUT_MARGIN_CALL", instanceId:a.instanceId, symbol:a.symbol,
                       need:util.r2(st.maintNeed - st.margin), margin:st.margin,
                       maintNeed:st.maintNeed, ratio:st.ratio });
};
// 平倉：退回保證金餘額減手續費。強平時餘額可能是負的 → 差額轉信貸。
E.futClose = function(S, p, a, opts){
  opts = opts||{};
  var def = E.futDef(a.symbol) || { name:a.name, multiplier:1 };
  var bal = util.r2(a.marketValue||0);
  var fee = opts.noFee ? 0 : E.futFee(S, a.lots||0);
  var post = [{account:"ASSET", delta:-bal, refId:a.instanceId, label:def.name+" 保證金結清"}];
  var back = util.r2(bal - fee);
  if(back > 0) post.push({account:"CASH", delta:back, label:"退回保證金"});
  else if(back < 0) post.push({account:"CASH", delta:back, label:"平倉超額虧損"});
  var pl = util.r2(bal - (a.costBasis||0));
  ledger.post(S, p, (opts.forced?"強制平倉：":"平倉：")+def.name+"（"+(a.side==="short"?"空":"多")+" "+a.lots+" 口，損益 "+
              (pl>=0?"+":"")+util.money(pl)+"）", post,
              {eduTags:["futures","exit"], detail:{lots:a.lots, side:a.side, pl:pl, fee:fee}});
  p.assets = p.assets.filter(function(x){ return x.instanceId!==a.instanceId; });
  p.stats.futClosed = (p.stats.futClosed||0) + 1;
  if(pl<0) p.stats.futLossTotal = util.r2((p.stats.futLossTotal||0) + Math.abs(pl));
  E.ev(opts.forced?"FUT_FORCE_CLOSED":"FUT_CLOSED",
       {playerId:p.id, symbol:a.symbol, lots:a.lots, side:a.side, pl:pl, fee:fee});
  if(p.cash<0) E.enterBankruptcy(S,p);
};
E.futForceClose = function(S, p, a){
  var short = util.r2(-(a.marketValue||0));          // 保證金穿價的部分
  E.futClose(S,p,a,{forced:true, noFee:true});
  if(short > 0){
    // 穿價：券商先墊，轉成信貸留在身上（與融資斷頭同一條路）
    var rate = E.rRate(S.macro.baseRate + E.cfg(S,"creditSpread"));
    E.addLiability(S,p,"CONSUMER","期貨穿價欠款",short,rate,false,null,true);
    E.ev("FUT_SHORTFALL",{playerId:p.id, amount:short});
  }
  E.queueFutNotice(p, { title:"💥 期貨強制平倉",
    text:"保證金燒完了，部位已被強制平倉。"+(short>0?("穿價的 "+util.money(short)+" 轉成信用貸款留在你身上——槓桿賠掉的不只是本金。"):"") });
};

/* S23b.1：期貨的通知卡不能在回合結束當場推。
   tickFutures 跑在【回合結束】，此時的「當前玩家」不一定是這個部位的主人；
   引擎的不變式是「待決策一定屬於當前玩家」，推錯人就整局死當（S15d 踩過一次）。
   所以先排隊，等輪到他自己（E.beginTurn → E.tickFutCall）再跳。 */
E.queueFutNotice = function(p, notice){
  p.pendingFutNotices = p.pendingFutNotices || [];
  if(p.pendingFutNotices.length < 4) p.pendingFutNotices.push(notice);   // 防呆：不無限累積
};

/* ======================= S23c：M9 迷因幣（狗狗星幣） =======================
   與期貨最大的不同：迷因幣走的是【現行的股票機制】——同一套買賣、同一套四層股價
   模型、同一套下市（歸零）機率制。所以這裡沒有第二套交易程式碼，只有三件它自己的事：
   ①幣圈循環（獨立於景氣的三態機）②託管風險（交易所倒閉 vs 冷錢包）③不能融資。

   為什麼不把它塞進 stockDefs：那份陣列被開盤價迴圈、M1 逐輪報價、下市判定直接走訪，
   多一檔就多消耗亂數，鐵律 4（開關全關要能逐位元重現基線）當場就斷。 */
E.cryptoOn = function(S){
  if(!E.m9On(S)) return false;
  var v = E.cfg(S,"cryptoOn");
  return v===undefined ? true : !!v;
};
// 本局實際存在的幣種；M9 沒開就是空陣列（所有迴圈自然跳過，不碰亂數）
E.cryptoDefs = function(S){
  return E.cryptoOn(S) ? (ns.content.cryptoDefs||[]) : [];
};
E.isCrypto = function(def){ return !!(def && def.custody); };
E.cryptoDef = function(sym){
  return (ns.content.cryptoDefs||[]).filter(function(d){ return d.symbol===sym; })[0] || null;
};
/* 能不能交易這個標的——一個入口。介面反灰只是提示，把關在引擎。
   回傳 null＝可以；否則回傳拒絕碼。 */
E.stockTradable = function(S, p, def){
  if(!def) return "NO_SYMBOL";
  if(!def.moduleReq) return null;                        // 一般股票：一律可交易
  if(def.moduleReq==="M9"){
    if(!E.m9On(S)) return "NO_M9";
    if(E.isCrypto(def) && !E.cryptoOn(S)) return "NO_CRYPTO";
    if(!E.advancedUnlocked(S,p)) return "ADV_LOCKED";     // 與期貨同一道解鎖閘門
    return null;
  }
  return S.enabledModules.indexOf(def.moduleReq)>=0 ? null : "NO_MODULE";
};

/* ---- 幣圈循環：獨立於景氣的三態機 ---- */
E.CRYPTO_STAGES = ["MANIA","RANGE","WINTER"];
E.CRYPTO_STAGE_TEXT = { MANIA:"狂熱", RANGE:"盤整", WINTER:"寒冬" };
E.CRYPTO_STAGE_ICON = { MANIA:"🚀", RANGE:"😐", WINTER:"🧊" };
E.cryptoStage = function(S){ return S.cryptoCycle || "RANGE"; };
E.cryptoDrift = function(S){
  var v = E.cfg(S,"cryptoDrift_"+E.cryptoStage(S));
  return isFinite(v) ? v : 0;
};
/* 每輪擲一次是否換狀態；要換的時候在另外兩態之間再擲一次。
   刻意與景氣完全脫鉤——這正是這一節要教的事：幣圈的多空與實體經濟沒有必然關係。 */
E.tickCryptoCycle = function(S){
  if(!E.cryptoOn(S)) return;
  var pr = E.cfg(S,"cryptoCycleSwitchProb"); if(!isFinite(pr)) pr = 0.15;
  if(util.rand(S) >= pr) return;
  var cur = E.cryptoStage(S);
  var others = E.CRYPTO_STAGES.filter(function(x){ return x!==cur; });
  var nx = others[Math.min(others.length-1, Math.floor(util.rand(S)*others.length))];
  if(nx===cur) return;
  S.cryptoCycle = nx;
  E.ev("CRYPTO_CYCLE_CHANGED",{ from:cur, to:nx,
    fromText:E.CRYPTO_STAGE_TEXT[cur], toText:E.CRYPTO_STAGE_TEXT[nx] });
};
/* 逐輪報價：與 M1 完全同一套四層模型，只是多疊一層幣圈漂移。
   刻意複製而不是把 M1 那段抽成共用函式——M1 那段是鐵律 4 的比對基準，一個字都不能動。 */
E.tickCryptoPrice = function(S){
  var defs = E.cryptoDefs(S); if(!defs.length) return;
  var mult = S.config.stockVolatilityMult*(S.config.volatilityLevel===1?0:1);
  var drift = S.config["drift_"+S.macro.stage];
  var cyc = E.cryptoDrift(S);
  defs.forEach(function(def){
    if(S.delisted && S.delisted[def.symbol]) return;      // 已歸零：不再報價、不再消耗亂數
    var pr = S.stockPrices[def.symbol];
    if(!isFinite(pr)) return;
    var chg = drift*E.stockMacroBeta(S,def) + (def.driftBonus||0) + cyc
            + E.stockVol(S,def)*mult*util.gauss(S);
    chg = E.capMove(S,def,chg);
    S.stockPrices[def.symbol] = E.clampPrice(S,def,pr*(1+chg));
    if(!S.stockHistory) S.stockHistory={};
    var h = (S.stockHistory[def.symbol] || (S.stockHistory[def.symbol]=[def.face]));
    h.push(S.stockPrices[def.symbol]); if(h.length>12) h.shift();
  });
};

/* ---- 託管：交易所 vs 冷錢包 ---- */
E.cryptoCustody = function(S, p){ return (p && p.flags && p.flags.cryptoCold) ? "cold" : "exchange"; };
E.cryptoCustodyText = function(S, p){
  return E.cryptoCustody(S,p)==="cold" ? "冷錢包（自己保管）" : "交易所（平台保管）";
};
E.cryptoHoldings = function(p, sym){
  return (p.assets||[]).filter(function(a){ return a.kind==="STOCK" && a.symbol===sym; });
};
/* 交易所倒閉：放在交易所的幣直接歸零，冷錢包免疫。
   直接把資產打成 0 並記一筆分錄——帳一定要平，不能只改 marketValue。 */
E.cryptoExchangeFail = function(S, label){
  var defs = E.cryptoDefs(S); if(!defs.length) return 0;
  var hit = 0;
  defs.forEach(function(def){
    S.players.forEach(function(p){
      if(p.bankrupt) return;
      if(E.cryptoCustody(S,p)==="cold") return;           // 冷錢包免疫——這就是那筆錢在買的東西
      var lost = 0;
      E.cryptoHoldings(p, def.symbol).forEach(function(a){
        var mv = util.r2(a.marketValue||0);
        if(mv<=0) return;
        lost = util.r2(lost + mv);
        ledger.post(S, p, "交易所倒閉："+E.stockName(S,def.symbol)+" 資產歸零",
          [{account:"ASSET", delta:-mv, refId:a.instanceId, label:def.name+" 歸零"}],
          {eduTags:["crypto","custody","loss"], detail:{symbol:def.symbol, units:a.units, lost:mv}});
        a.marketValue = 0; a.units = 0;
        a.flags = a.flags||{}; a.flags.wiped = true;
      });
      p.assets = p.assets.filter(function(a){ return !(a.flags && a.flags.wiped); });
      if(lost>0){
        hit++;
        p.stats.cryptoWiped = util.r2((p.stats.cryptoWiped||0) + lost);
        E.ev("CRYPTO_EXCHANGE_LOSS",{ playerId:p.id, symbol:def.symbol, amount:lost, label:label||"" });
        /* 與期貨同一條紀律：這裡跑在事件結算，當前玩家不一定是他 →【排隊】不推卡 */
        E.queueFutNotice(p, { title:"🏦 交易所倒閉：幣不見了",
          text:"你放在交易所的 "+E.stockName(S,def.symbol)+" 價值 "+util.money(lost)+" 全數歸零。"+
               "「Not your keys, not your coins」——放在平台上的幣，帳上是平台的負債，不是你的資產。"+
               "人生商城的〈硬體冷錢包〉可以免疫這件事。" });
        if(p.cash<0) E.enterBankruptcy(S,p);
      }
    });
  });
  return hit;
};

/* ---------------------- 玩家間資產轉讓（含 AI 議價） ---------------------- */
// M8 S3：談判與溝通——買方在成交當下爭到折讓；賣方同額減收，帳上金額守恆。
// 刻意不動 npcAuctionBid 的出價金額（那裡消耗 randAux），以免改變得標者與重放結果。
E.negotiatedPrice = function(S, buyer, price){
  price = util.r2(price);
  if(!(E.hasSkill && E.hasSkill(buyer,"SKL_NEGO"))) return price;
  var d = E.cfg(S,"skillNegoDiscount"); if(d===undefined) d = 0.1;
  var np = util.r2(price*(1-d)), savedN = util.r2(price-np);
  if(savedN>0){
    buyer.stats.skillSavedTotal = util.r2((buyer.stats.skillSavedTotal||0) + savedN);
    buyer.stats.skillsUsed = (buyer.stats.skillsUsed||0) + 1;
    E.ev("SKILL_APPLIED",{ playerId:buyer.id, skillId:"SKL_NEGO", title:"談判與溝通",
                           saved:savedN, where:"trade", from:price, to:np });
  }
  return np;
};

E.executeTrade = function(S, seller, buyer, a, price){
  price = E.negotiatedPrice(S, buyer, price);
  var mv=a.marketValue, inc=a.monthlyIncome||0;
  seller.assets = seller.assets.filter(function(x){return x.instanceId!==a.instanceId;});
  var sPost=[{account:"CASH",delta:price,label:"轉讓價金"},
    {account:"ASSET",delta:-mv,refId:a.instanceId,label:a.name}];
  if(inc) sPost.push({account:"INCOME_PASSIVE",delta:-inc,refId:a.instanceId,label:a.name+" 收入轉出"});
  ledger.post(S,seller,"轉讓「"+a.name+"」給 "+buyer.name,sPost,{eduTags:["exit","trade"]});
  var nid=util.uid(S,"A");
  buyer.assets.push({ instanceId:nid, cardId:a.cardId, kind:a.kind, name:a.name, symbol:a.symbol,
    units:a.units, costBasis:price, marketValue:mv, monthlyIncome:inc,
    volatileProfit:a.volatileProfit, linkedLiabilityId:null, flags:{} });
  var bPost=[{account:"CASH",delta:-price,label:"受讓價金"},
    {account:"ASSET",delta:mv,refId:nid,label:a.name}];
  if(inc) bPost.push({account:"INCOME_PASSIVE",delta:inc,refId:nid,label:a.name+" 收入轉入"});
  ledger.post(S,buyer,"受讓「"+a.name+"」自 "+seller.name,bPost,{eduTags:["trade","passive-income"]});
  E.ev("TRADE_DONE",{sellerId:seller.id, buyerId:buyer.id, name:a.name, price:price});
  E.trackLeverage(seller); E.trackLeverage(buyer);
};
// AI 對「有人要把資產賣給我」的回應：接受 / 還價 / 拒絕（純函式、可重放）
// 拍賣結算（V2 抽出）：最高價得標，同價取座位序小者；buyAsset 失敗遞補次高，全滅＝流標
E.resolveOppAuction = function(S, seller, aCard, bids){
  var ranked=bids.filter(function(b){return b.amount>0;})
    .sort(function(a,b){ return b.amount-a.amount || a.playerId-b.playerId; });
  var winner=null, price=0;
  for(var bi=0; bi<ranked.length; bi++){
    var cand=S.players[ranked[bi].playerId];
    var before=cand.ledger.length;
    var defOpt=E.oppDefaultOption(S,cand,aCard);
    E.buyAsset(S,cand,aCard,defOpt.optionId,defOpt.params);
    if(cand.ledger.length>before){ winner=cand; price=ranked[bi].amount; break; }
  }
  if(winner){
    price = E.negotiatedPrice(S, winner, price);   // M8 S3：得標後的最後一輪議價（不影響得標者）
    ledger.post(S,winner,"拍賣得標價金：「"+aCard.title+"」",
      [{account:"CASH",delta:-price,label:"價金付給 "+seller.name}],{eduTags:["trade"]});
    ledger.post(S,seller,"機會拍賣成交：「"+aCard.title+"」",
      [{account:"CASH",delta:price,label:"得標價金（"+winner.name+"）"}],{eduTags:["trade"]});
    seller.stats.passedOpps++;
    S.decisionQueue.shift();
    E.ev("AUCTION_RESULT",{winnerId:winner.id, bids:bids, price:price,
                           cardId:aCard.id, title:aCard.title, sellerId:seller.id});
    E.afterResolve(S,seller);
  } else {
    E.ev("AUCTION_RESULT",{winnerId:null, bids:bids, price:0,
                           cardId:aCard.id, title:aCard.title, sellerId:seller.id});
  }
};

// V1 廣播轉讓的電腦輪詢：依座位序問每個 NPC，第一個願意照開價收的成交；全婉拒＝流標
E.resolveOpenTradeNPC = function(S, seller, a, ask){
  var npcs=S.players.filter(function(x){ return x.isNPC && x.id!==seller.id && !x.bankrupt; });
  for(var i=0;i<npcs.length;i++){
    var resp=E.aiTradeResponse(S,npcs[i],a,ask);
    if(resp.action==="accept" && npcs[i].cash>=ask){
      E.executeTrade(S,seller,npcs[i],a,ask); S.pendingTrade=null; return true; }
  }
  S.pendingTrade=null;
  E.ev("TRADE_REJECTED",{buyerId:null,name:a.name});
  return false;
};

E.aiTradeResponse = function(S, buyer, a, ask){
  var inc=a.monthlyIncome||0;
  var w=ns.content.personalityById[buyer.npcPersonality].weights;
  if(inc<=0 && a.kind!=="STOCK") return {action:"reject"};      // 不買不會生錢的東西
  var reqYield = w.startupAppetite>0.6?0.14:(w.cashReserveFloor>=6?0.09:0.11);
  var incomeVal = inc>0 ? inc*12/reqYield : a.marketValue*0.6;
  var fair = util.r2(Math.min(incomeVal, a.marketValue*1.05));
  var reserve = w.cashReserveFloor*buyer.derived.totalExpenses;
  var canAsk = buyer.cash - ask >= reserve;
  var canFair = buyer.cash - fair >= reserve;
  if(ask<=fair && canAsk) return {action:"accept"};
  if(fair<ask && canFair && fair>0) return {action:"counter", price:fair};
  return {action:"reject"};
};

/* -------------------- 機會轉讓（買不起的機會賣給別人） -------------------- */
E.oppIncome = function(S, card){
  var pl=card.payload||{};
  if(card.kind==="REALESTATE") return util.r2((pl.monthlyRent||0)*S.config.assetIncomeMult-(pl.monthlyCost||0));
  if(card.kind==="BUSINESS") return util.r2((pl.monthlyProfit||0)*E.incomeMultFor(S,"BUSINESS"));
  return 0;
};
E.oppEntry = function(S, card){ var pl=card.payload||{};
  if(card.kind==="REALESTATE") return pl.downPayment||pl.price||0;
  return pl.price||pl.investAmount||0;
};
/* ===================== §3.1 機會拍賣（密封投標一輪制） ===================== */
// 該玩家對此機會卡的預設融資方式（拍賣得標／JV 各自買入共用）
E.oppDefaultOption = function(S, pl, card){
  if(card.kind==="REALESTATE") return { optionId: E.canUseLoan(S)?"loan":"cash", params:{} };
  if(card.kind==="BUSINESS"){
    var price=(card.payload&&card.payload.price)||0;
    if(pl.cash>=price) return { optionId:"cash", params:{} };
    return { optionId: E.canUseLoan(S)?"loan":"cash", params:{} };
  }
  if(card.kind==="STOCK") return { optionId:"cash", params:{units:1} };
  return { optionId:"cash", params:{} };
};
// 密封出價（決定論；NPC 用 auxRngState 加噪音；人類非當事玩家沿用穩健規則——本作僅一位人類玩家，
// 熱座出價 modal 留待多人版，規格「單人局全 NPC 即時完成」為現行路徑）
/* ===================== V10 §1 轉介費（介紹人抽成） ===================== */
E.referralFee = function(S, card){
  var mo=E.cfg(S,"referralFeeMonths"); if(mo===undefined) mo=1.5;
  return util.r2(E.oppIncome(S,card)*mo);
};
// 受讓人是否接受：付得起（自備＋介紹費，且不破水位）且這筆機會對他的價值高於介紹費
// V4：轉介廣播輪詢電腦——依座位序找第一位「評估後願意且買得成」的 NPC
E.referPollNPC = function(S, frm, card, fee){
  var npcs=S.players.filter(function(x){ return x.isNPC && x.id!==frm.id && !x.bankrupt; });
  for(var i=0;i<npcs.length;i++){
    if(!E.npcAcceptReferral(S,npcs[i],card,fee)) continue;
    if(E.execReferral(S,frm,npcs[i],card,fee)) return true;
  }
  return false;
};

// V2 抽出：受讓人買下＋介紹費對轉（買不成或現金不足＝不成交、不收費）
E.execReferral = function(S, frm, tgt, card, fee){
  var before=tgt.ledger.length;
  var defR=E.oppDefaultOption(S,tgt,card);
  E.buyAsset(S,tgt,card,defR.optionId,defR.params);
  if(tgt.ledger.length>before && tgt.cash>=fee){
    ledger.post(S,tgt,"支付介紹費："+card.title,
      [{account:"CASH",delta:-fee,label:"介紹費（"+frm.name+"）"}],{eduTags:["referral"]});
    ledger.post(S,frm,"收取介紹費："+card.title,
      [{account:"CASH",delta:fee,label:"介紹費（"+tgt.name+"）"}],{eduTags:["referral"]});
    E.ev("REFERRAL_DONE",{fromId:frm.id, toId:tgt.id, cardId:card.id, title:card.title, fee:fee});
    return true;
  }
  return false;
};

E.npcAcceptReferral = function(S, tgt, card, fee){
  var entry=E.oppEntry(S,card);
  var w = tgt.isNPC ? ns.content.personalityById[tgt.npcPersonality].weights : {cashReserveFloor:2};
  var reserve=w.cashReserveFloor*tgt.derived.totalExpenses;
  if(tgt.cash - entry - fee < reserve) return false;
  var willing=E.npcAuctionBid(S,tgt,card);     // 內含一次 randAux（決定論）
  return willing > fee;
};

/* ===================== V10 §4 人生商城 ===================== */
// 商品的「這次要付多少」。年繳型（產險）的保費也是成本——
// 原本只算 payload.cost，導致產險顯示「免費」，而且 mallAffordable 也跟著繞過檢查。
E.mallCost = function(S, it, p){
  var pl=(it&&it.payload)||{};
  // S21c：依月薪計價（安太座）。S22：沒有薪水（自由圈／失業）就回退到固定 cost——
  // 原版回退用 65，比全部職業的月薪都高，等於沒薪水的人反而付最貴。
  var base = (pl.costSalaryMult && p && p.derived && p.derived.salaryIncome > 0)
    ? util.r2(p.derived.salaryIncome * pl.costSalaryMult)
    : (pl.cost || 0);
  return util.r2(base + (pl.annualPremium||0));
};
/* ===================== S7b：木作與居家修繕 =====================
   自己裝修 → 租金 +8%、空租機率減半。與水電的「省修繕費」刻意不重疊：
   水電治的是「壞掉要花錢」，木工治的是「租得掉、租得好」。
   實作用資產上的 carpentry 旗標保證只加成一次（學技能與新買房都會呼叫，冪等）。 */
E.applyCarpentry = function(S, p){
  if(!E.hasSkill(p,"SKL_CARPENTRY")) return;
  var save=E.cfg(S,"carpentrySavePerHouse"); if(save===undefined) save=1;
  if(!(save>0)) return;
  p.assets.forEach(function(a){
    if(a.kind!=="REALESTATE") return;
    a.flags=a.flags||{};
    if(a.flags.carpentry) return;                       // 冪等：學技能與新買房都會呼叫
    a.flags.carpentry=true;
    ledger.post(S,p,"自己動手維護："+a.name,
      [{account:"EXPENSE",delta:-save,label:a.name+" 自己維護，每月省下"}],
      {eduTags:["cashflow"], srcTitle:"木作與居家修繕"});
    p.stats.skillSavedTotal = util.r2((p.stats.skillSavedTotal||0) + save);
    p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
    E.ev("CARPENTRY_APPLIED",{playerId:p.id, assetName:a.name, delta:save});
    E.ev("SKILL_APPLIED",{ playerId:p.id, skillId:"SKL_CARPENTRY", title:"木作與居家修繕",
                           saved:save, where:"upkeep", assetName:a.name });
  });
};

// 這件商品現在還在效期內嗎（健身房年約、健檢……）——UI 與引擎共用同一份判斷
// S13.1 §2：同一項商品重複購買的幸福感邊際遞減。
// 真實世界的體驗消費也是這樣——第一次的滿足感最高，第十次同一件事幾乎沒有增量。
// 這條同時堵住「找一張 CP 值最高的卡無限重刷幸福感 → 灌盲盒與圓夢門檻」的破口。
// S14a：資產細項的兩種報酬率（純顯示用，不影響任何遊戲數值）
//  現金報酬（Cash-on-Cash）＝ 月現金流×12 ÷ 自備現金　→ 看得出槓桿把報酬放大多少
//  資產報酬             ＝ 月現金流×12 ÷ 現值      → 看得出這個標的本身好不好
// 舊存檔沒有 ownCash：用「成本 − 該筆貸款的原始金額」回推；再不行就以成本當自備。
E.assetOwnCash = function(p, a){
  if(a.ownCash!==undefined && a.ownCash!==null && isFinite(a.ownCash)) return a.ownCash;
  var base = a.costBasis||0;
  if(a.linkedLiabilityId){
    var l=(p.liabilities||[]).filter(function(x){return x.instanceId===a.linkedLiabilityId;})[0];
    if(l){ var orig = (l.originalPrincipal!==undefined ? l.originalPrincipal : l.principal)||0;
      return util.r2(Math.max(0, base-orig)); }
  }
  return base;
};
E.assetReturns = function(p, a){
  var yr = util.r2((a.monthlyIncome||0)*12);
  var own = E.assetOwnCash(p,a), mv = a.marketValue||0;
  return { yearIncome:yr,
           ownCash: own,
           cashYield: own>0 ? yr/own : null,     // null＝分母為 0，顯示成 —，不編一個數字出來
           assetYield: mv>0 ? yr/mv : null };
};
E.mallJoyFor = function(S, p, it){
  var base=((it&&it.payload)||{}).joy||0;
  if(!base) return 0;
  var n=(p.mallBought && p.mallBought[it.id]) || 0;     // 之前已買過幾次
  if(n<=0) return base;
  var dec=E.cfg(S,"mallRepeatJoyDecay"); if(dec===undefined) dec=0.5;
  return Math.max(0, Math.floor(base*Math.pow(dec, n)));
};
// 同一項商品的重購冷卻：回傳還要等幾輪（0＝現在就能買）
E.mallCooldownLeft = function(S, p, it){
  var cd=E.cfg(S,"mallRepeatCooldown"); if(cd===undefined) cd=3;
  if(cd<=0) return 0;
  var last=(p.mallLastBuy && p.mallLastBuy[it.id]);
  if(last===undefined || last===null) return 0;
  return Math.max(0, cd-(S.turnNumber-last));
};
/* S38：一件商品點亮的品格軸（0～N 個）。virtues 陣列優先，否則退回單軸 virtue。 */
E.mallVirtues = function(it){
  var pl=(it&&it.payload)||{};
  if(Array.isArray(pl.virtues)) return pl.virtues.slice();
  return pl.virtue ? [pl.virtue] : [];
};
/* S38：商城同一類內依「總價」排序——一次費用（含月薪倍數、年繳保費）＋ 12 個月的月費。
   純呈現用；引擎與電腦決策都不吃這個順序。 */
E.mallSortKey = function(S, it, p){
  var pl=(it&&it.payload)||{};
  var once = E.mallCost(S,it,p);
  var monthly = (pl.recurringMonthly||0)*12;
  return once + Math.max(0, monthly);
};
E.mallStillActive = function(S, p, it){
  var pl=(it&&it.payload)||{};
  if(!pl.flag || !p.flags) return false;
  var until = p.flags[pl.flag+"Until"];
  return until!==undefined && S.turnNumber <= until;
};
E.mallAffordable = function(S, p, it){
  var c=E.mallCost(S,it,p);
  return p.cash >= c;
};
E.mallApply = function(S, p, it){
  var pl=it.payload||{}, post=[], notes=[];
  var cost=E.mallCost(S,it,p);   // 已含年繳保費，不可在此重複加
  if(cost>0) post.push({account:"CASH",delta:-cost,label:it.title});
  if(pl.recurringMonthly){
    post.push({account:"EXPENSE",delta:util.r2(pl.recurringMonthly),label:it.title+" 每月"});
    // S38：負數＝每月省下（好市多會員）——支出水位往下走
    notes.push(pl.recurringMonthly>0 ? ("每月 +"+util.money(pl.recurringMonthly)) : ("每月省 "+util.money(-pl.recurringMonthly)));
  }
  if(post.length) ledger.post(S,p,"商城："+it.title,post,{eduTags:["mall"]});

  // S13.1 §2：幸福感必須在計次「之前」算，否則第一次就被當成重複購買
  var gainJoy = E.mallJoyFor(S,p,it);
  p.mallBought = p.mallBought||{}; p.mallBought[it.id]=(p.mallBought[it.id]||0)+1;
  p.mallLastBuy = p.mallLastBuy||{}; p.mallLastBuy[it.id]=S.turnNumber;
  p.mallBoughtThisTurn=(p.mallBoughtThisTurn||0)+1;
  p.stats.mallJoy=(p.stats.mallJoy||0)+gainJoy;
  if((pl.joy||0)>0 && gainJoy<(pl.joy||0))
    notes.push("重複購買：幸福感 +"+gainJoy+"（原 +"+pl.joy+"）");
  p.flags = p.flags||{};

  // 品格（S38：可一次點多軸——payload.virtues:[...]；單軸的 payload.virtue 照舊）
  if(S.enabledModules.indexOf("M6")>=0){
    var axesM = E.mallVirtues(it);
    var max=S.config.virtueMaxLevel||3;
    axesM.forEach(function(ax){
      if(p.virtues[ax]<max){ p.virtues[ax]++; notes.push("品格 "+ax+" +1"); }
    });
  }
  // 保險
  if(pl.insurance){
    p.flags.insured=true; p.flags.insurancePremium=util.r2(pl.recurringMonthly||0);
    notes.push("已投保");
  }
  // 健康狀態旗標（有效期）
  // 泛用化：p.flags[<flag>Until]，行為與原本的 fitUntil / checkedUntil 完全相同
  if(pl.flag){
    var dfT = (pl.flag==="fit") ? 24 : 12;
    p.flags[pl.flag+"Until"] = S.turnNumber+(pl.flagTurns||dfT);
    p.flags[pl.flag+"Item"]     = it.id;       // 到期時要問「要不要續約這一項」
    p.flags[pl.flag+"Asked"]    = 0;
    p.flags[pl.flag+"FeeEnded"] = 0;           // 這一期的月費還在扣
  }
  // S23c：永久旗標（不會到期、不用續約）——目前用在硬體冷錢包
  if(pl.permaFlag && !p.flags[pl.permaFlag]){
    p.flags[pl.permaFlag] = true;
    if(pl.permaNote) notes.push(pl.permaNote);
    E.ev("PERMA_FLAG_SET",{playerId:p.id, flag:pl.permaFlag, itemId:it.id, title:it.title});
  }
  // 人脈：海外留學／EMBA 解鎖特殊機會牌堆
  if(pl.network && !p.flags.network){
    p.flags.network = true;
    notes.push("解鎖特殊機會");
    E.ev("NETWORK_UNLOCKED",{playerId:p.id, itemId:it.id, title:it.title});
  }
  // 產險：年繳、下次自動續約時間
  if(pl.propertyInsurance){
    var rt = E.cfg(S,"propertyRenewTurns"); if(rt===undefined) rt = 12;
    p.flags.propInsured = true;
    p.flags.propPremium = util.r2(pl.annualPremium||0);
    p.flags.propRenewAt = S.turnNumber + rt;
    notes.push("產險生效（年繳、自動續約）");
  }
  // 停走
  if(pl.skipTurns){ p.skippedTurns=(p.skippedTurns||0)+pl.skipTurns; p.skipReason=it.title; }

  // 進修：機率決定是否加薪
  var outcome=null;
  if(pl.chance!==undefined){
    var win = util.rand(S) < pl.chance;
    if(win && pl.onWin && pl.onWin.salaryMult){
      var base=p.derived.salaryIncome;
      var d=util.r2(base*(pl.onWin.salaryMult-1));
      if(d) ledger.post(S,p,pl.onWin.label||(it.title+" 見效"),
        [{account:"INCOME_ACTIVE",delta:d,label:pl.onWin.label||it.title}],{eduTags:["career"]});
      outcome={win:true, text:(pl.onWin.label||"見效")+"　薪資 +"+util.money(d)};
    } else {
      outcome={win:false, text:pl.onLose||"這次沒有直接回報"};
    }
  }
  // 比賽：V3 起改由玩家親自擲骰——先報名（付費），再跳出擲骰決策
  if(pl.contest){
    E.pushDecision(S,p,{ kind:"CONTEST_ROLL", itemId:it.id });
    outcome={pending:true, text:"報名完成——輪到你擲骰！"};
  }
  E.ev("MALL_BOUGHT",{playerId:p.id, itemId:it.id, title:it.title, icon:pl.icon||it.icon||"🛍",
    cost:cost, notes:notes, outcome:outcome, joy:pl.joy||0});
  if(p.cash<0) E.enterBankruptcy(S,p);
};

E.npcAuctionBid = function(S, pl, card){
  var per = pl.isNPC ? pl.npcPersonality.replace("NPC_","") : "SAFE";
  var mult = E.cfg(S,"auctionNpcMult_"+per); if(mult===undefined) mult=2;
  var w = pl.isNPC ? ns.content.personalityById[pl.npcPersonality].weights : {cashReserveFloor:3};
  var inc=E.oppIncome(S,card), entry=E.oppEntry(S,card);
  var reserve=w.cashReserveFloor*pl.derived.totalExpenses;
  var willing=Math.min(inc*mult, pl.cash-entry-reserve);
  willing=util.r2(Math.max(0,willing));
  if(willing<=0){ return 0; }
  var span=E.cfg(S,"auctionNoiseSpan"); if(span===undefined) span=0.3;
  var r=util.randAux(S);   // 每位有意願的出價者恰消耗一次 aux（棄標不消耗）——決定論
  return util.r2(willing*(1-span/2+span*r));
};

E.trackLeverage = function(p){
  var d=p.derived, eq=Math.max(1, d.netWorth);
  p.stats.maxLeverage = Math.max(p.stats.maxLeverage, util.r2((d.totalAssets)/eq));
};

/* ============================ 破產與勝利 ================================= */
E.enterBankruptcy = function(S,p){
  if(p.playerStage==="OUTER"){ E.outerCrisis(S,p); return; }   // v0.2：外圈先走跌落程序，不直接破產
  if(p.isNPC){ E.npcRescue(S,p); return; }
  S.decisionQueue = S.decisionQueue.filter(function(d){ return d.kind!=="ACK"; });
  E.pushDecision(S,p,{ kind:"BANKRUPTCY" });
  E.ev("BANKRUPTCY_ENTERED",{playerId:p.id});
};
// V11：紓困額度＝max(淨值×倍數, 月收入×月數)——資產賣光、淨值為負時仍以所得為基準保留最後一條路
E.rescueCap = function(S,p){
  var byNW = Math.max(0,p.derived.netWorth)*E.cfg(S,"rescueLoanNetWorthCap");
  var mo = E.cfg(S,"rescueIncomeMonths"); if(mo===undefined) mo=3;
  var byInc = Math.max(0,p.derived.salaryIncome)*mo;
  var used=0; p.liabilities.forEach(function(l){ if(l.name==="紓困貸款") used+=l.principal; });
  return util.r2(Math.max(0, Math.max(byNW,byInc)-used));
};
// V11：還有沒有人可以借你錢（P2P 是最後手段）
E.p2pAvailable = function(S,p){
  return S.players.some(function(x){ return x.id!==p.id && !x.bankrupt && x.cash>0; });
};
E.checkRescued = function(S,p){
  if(p.cash>=0){
    S.decisionQueue = S.decisionQueue.filter(function(d){ return d.kind!=="BANKRUPTCY"; });
    p.skippedTurns += 1; p.skipReason="剛脫離破產程序，重整一輪";
    E.ev("BANKRUPTCY_ESCAPED",{playerId:p.id});
  } else if(!p.assets.length && E.rescueCap(S,p)<1 && !E.p2pAvailable(S,p)){
    // 沒有資產、沒有紓困額度、也沒有人能借你錢 → 才真的出局
    E.declareBankrupt(S,p);
  }
};
E.declareBankrupt = function(S,p){
  E.p2pLiquidate(S,p);                                  // §4：P2P 受償／打銷（在出局前結清）
  p.bankrupt=true;
  if(p.creditFlags) p.creditFlags.everBankrupt=true;   // M7：破產永久記錄
  S.decisionQueue = S.decisionQueue.filter(function(d){ return d.playerId!==p.id; });
  E.ev("BANKRUPT",{playerId:p.id});
  if(E.alive(S).length<=0){ S.over=true; S.winner=null; S.overReason="ALL_BANKRUPT"; E.ev("GAME_OVER",{reason:"ALL_BANKRUPT"}); }
};

E.checkFreedom = function(S,p){
  if(p.playerStage!=="INNER" || p.bankrupt) return;
  var free = p.derived.passiveIncome >= p.derived.totalExpenses && p.derived.totalExpenses>0;
  if(!free){ p.financiallyFree=false; return; }
  var first = !p.financiallyFree;
  if(first){ p.financiallyFree=true; p.freeAtTurn=p.freeAtTurn||S.turnNumber;
    E.ev("FREEDOM_REACHED",{playerId:p.id, turn:S.turnNumber}); }
  if(p.isNPC){
    var dream = ns.content.byId[p.dreamCardId];
    var upkeep = dream ? E.cfg(S,"dreamUpkeepMonthly") : 0;
    var projected = util.r2(p.derived.passiveIncome - p.derived.totalExpenses - upkeep);
    var w = ns.content.personalityById[p.npcPersonality].weights;
    var buf = S.config.npcGraduateBuffer * (w.cashReserveFloor>=6?2:(w.cashReserveFloor<=1.5?0.5:1));
    // v0.2：外圈有柴米油鹽與傷病詐騙——NPC 畢業除了月盈餘，還要求現金墊（買點與扛事件用）
    var cushion = (E.cfg(S,"npcGraduateCashMonths")!==undefined?E.cfg(S,"npcGraduateCashMonths"):6) * p.derived.totalExpenses;
    if(projected>=buf && p.cash>=cushion) E.enterOuterCircle(S,p);
  }
  // 人類玩家：不再每輪彈窗，改由側欄常駐按鈕（GRADUATE_NOW）自行決定進入時機
};

// 副業收掉（轉職、換副業、辭職圓夢時共用）——收入與時間成本要一起消失，否則帳會爛掉
E.dropSideJob = function(S, p, why){
  var sj = p.sideJob;
  if(!sj) return;
  ledger.post(S,p,"結束副業："+sj.label+"（"+why+"）",
    [{account:"INCOME_ACTIVE",delta:util.r2(-sj.income),label:sj.label+" 收入結束"},
     {account:"EXPENSE",delta:util.r2(-sj.cost),label:sj.label+" 成本結束"}],
    {eduTags:["career","side-job"]});
  E.ev("SIDE_JOB_ENDED",{playerId:p.id, label:sj.label, why:why});
  p.sideJob = null;
};

E.enterOuterCircle = function(S,p){
  p.playerStage="OUTER"; p.retiredProfessionId=p.professionId; p.graduatedAtTurn=S.turnNumber;
  p.retiredSalary=p.derived.salaryIncome;   // v0.2：跌回時以「離職時薪資」為基準打折（含生涯加薪）
  p.outerPos=0; p.freefallWarnings=0;
  E.dropSideJob(S,p,"辭職圓夢");   // 副業的時間成本必須一起停，否則進外圈後會憑空多一筆支出
  // 數位資產同理：維護費必須跟著停，收入也不再屬於「工作」——但長尾收入保留，
  // 這正是它與副業的差別（做出來的東西會繼續替你賺錢）。這裡只停維護、不停收入。
  (p.digitalAssets||[]).slice().forEach(function(dg){
    if(dg.dead) return;
    // S30：還沒起飛的東西，辭職就沒了——跟副業同一個道理，做到一半的不會自己長出來。
    // （原本外圈仍可繼續推爬坡，與「外圈專心圓夢」的設計語彙不一致。）
    if(dg.tier===null){ E.dropDigital(S,p,dg,"辭職圓夢"); return; }
    /* S30：維護費與外包費是「暫停」不是「歸零」。原本直接把 monthlyCost 設成 0，
       跌回內圈時沒有任何地方還原 → 畢業再自願跌回，長尾維護費就永久消失了。 */
    var pausedM=util.r2(dg.monthlyCost||0), pausedS=util.r2(dg.staffed?(dg.staffCost||0):0);
    if(pausedM>0 || pausedS>0){
      var postD=[];
      if(pausedM>0) postD.push({account:"EXPENSE",delta:-pausedM,label:dg.name+" 維護費終止"});
      if(pausedS>0) postD.push({account:"EXPENSE",delta:-pausedS,label:dg.name+" 外包終止"});
      ledger.post(S,p,"辭職圓夢：停止投入「"+dg.name+"」",postD,{eduTags:["digital"]});
    }
    dg.pausedCost={ monthly:pausedM, staff:pausedS };
    dg.monthlyCost=0;
    if(dg.staffed){ dg.staffed=false; dg.staffCost=0; }
  });
  p.tending=null;
  var post=[{account:"INCOME_ACTIVE",delta:-p.derived.salaryIncome,label:"辭去工作"}];
  var upkeep=E.cfg(S,"dreamUpkeepMonthly");
  if(upkeep) post.push({account:"EXPENSE",delta:upkeep,label:"夢想維持費"});
  ledger.post(S,p,"辭職圓夢，進入自由圈",post,{eduTags:["freedom"]});
  ns.modules.onStageTransition(S,p,"INNER","OUTER");
  E.ev("ENTER_OUTER",{playerId:p.id});
};

/* v0.2 §3：跌回內圈——自願（重返職場）與非自願（現金撐不住）效果一致：
   薪資＝離職時薪資 × returnSalaryMult（0.9，不複利）、停走 1 輪、維持費停扣、夢想進度保留 */
E.freefall = function(S,p,opts){
  opts=opts||{};
  var mult=E.cfg(S,"returnSalaryMult"); if(mult===undefined) mult=0.9;
  var base = p.retiredSalary!==undefined ? p.retiredSalary
           : util.r2(ns.content.professionById[p.retiredProfessionId||p.professionId].salary*S.config.salaryMult);
  var newSalary = util.r2(base*mult);
  p.playerStage="INNER"; p.freefallWarnings=0;
  var post=[{account:"INCOME_ACTIVE",delta:newSalary,label:opts.voluntary?"重返職場":"跌回內圈復職"},
            {account:"EXPENSE",delta:-E.cfg(S,"dreamUpkeepMonthly"),label:"夢想維持費暫停"}];
  p.baseSalary=newSalary;
  ledger.post(S,p,(opts.voluntary?"自願重返職場":"現金撐不住，跌回內圈")+"（薪資 "+Math.round(mult*100)+"%）",
    post,{eduTags:["freefall"]});
  p.skippedTurns+=1; p.financiallyFree=false;
  p.skipReason=(opts.voluntary?"自願重返職場，交接一輪":"現金撐不住跌回內圈，重整一輪");
  p.stats.freefalls=(p.stats.freefalls||0)+1;
  /* S30：回到內圈就要重新扛起長尾的維護費與外包月薪——辭職時是「暫停」不是「一筆勾銷」。
     原本沒有這一段，於是「畢業→自願跌回」等於永久免除維護費。 */
  (p.digitalAssets||[]).forEach(function(dg){
    if(dg.dead || !dg.pausedCost) return;
    var pc=dg.pausedCost, postR=[];
    if(pc.monthly>0){ dg.monthlyCost=pc.monthly;
      postR.push({account:"EXPENSE",delta:pc.monthly,label:dg.name+" 維護費恢復"}); }
    if(pc.staff>0){ dg.staffed=true; dg.staffCost=pc.staff;
      postR.push({account:"EXPENSE",delta:pc.staff,label:dg.name+" 外包恢復"}); }
    if(postR.length) ledger.post(S,p,"重回內圈：「"+dg.name+"」恢復投入",postR,{eduTags:["digital"]});
    dg.pausedCost=null;
  });
  ns.modules.onStageTransition(S,p,"OUTER","INNER");
  E.ev("FREEFALL",{playerId:p.id, voluntary:!!opts.voluntary, salary:newSalary,
                   progressKept:p.dreamProgress});
  if(p.cash<0) E.enterBankruptcy(S,p);   // 跌回後連薪水都救不了 → 正常（內圈）破產程序
};

/* v0.2 §3：外圈現金危機——先自救（急售、上限 cap 次），救不動才跌落 */
E.outerCrisis = function(S,p){
  if(p.bankrupt || p.playerStage!=="OUTER") return;
  var cap=E.cfg(S,"freefallWarningCap"); if(cap===undefined) cap=2;
  if(p.freefallWarnings>=cap){ E.freefall(S,p); return; }   // 自救額度用完：直接跌落
  var sellable=p.assets.filter(function(a){ return a.kind!=="P2P_LOAN"; });
  if(!sellable.length){ E.freefall(S,p); return; }
  if(p.isNPC){
    var guard=0;
    while(p.cash<0 && guard++<30){
      var worst=p.assets.filter(function(a){ return a.kind!=="P2P_LOAN"; })
        .sort(function(a,b){ return a.monthlyIncome-b.monthlyIncome; })[0];
      if(!worst) break;
      E.sellAsset(S,p,worst,S.config.fireSaleRatio);
    }
    if(p.cash>=0){ p.freefallWarnings++; E.ev("FREEFALL_AVERTED",{playerId:p.id, warnings:p.freefallWarnings, cap:cap}); }
    else E.freefall(S,p);
    return;
  }
  S.decisionQueue = S.decisionQueue.filter(function(d){ return d.kind!=="ACK" && d.kind!=="FREEFALL_RESCUE"; });
  E.pushDecision(S,p,{ kind:"FREEFALL_RESCUE", warnings:p.freefallWarnings, cap:cap });
};

// V11.1：把同一張卡的多筆醫療／意外支出彙總成一份理賠明細
E.summarizeClaims = function(list, playerId){
  if(!list || !list.length) return null;
  var mine=list.filter(function(x){ return x.playerId===playerId; });
  if(!mine.length) return null;
  var out={gross:0, healthSaved:0, claim:0, net:0, wouldClaim:0,
           insured:mine[0].insured, healthOn:mine[0].healthOn,
           claimPct:mine[0].claimPct, healthPct:mine[0].healthPct};
  mine.forEach(function(x){
    out.gross=util.r2(out.gross+x.gross);
    out.healthSaved=util.r2(out.healthSaved+x.healthSaved);
    out.claim=util.r2(out.claim+x.claim);
    out.net=util.r2(out.net+x.net);
    out.wouldClaim=util.r2(out.wouldClaim+x.wouldClaim);
  });
  out.saved=util.r2(out.healthSaved+out.claim);
  return out;
};

/* ===================== S24：夢想里程碑（抽選、圖片、相容） =====================
   V11 起「夢想的第 n 點」對應一個具體成就（爬玉山、帛琉潛水⋯⋯），原本是寫死的
   「第 n 點 → milestones[n-1]」，所以同一個夢想每一局跑的路線一模一樣，玩久了會膩。

   S24 改成：每個夢想備一池里程碑（目標 20 條），開局**抽 dreamCost 條**當本局的路線。
   ⚠️ 相容鐵律：池子只有剛好 dreamCost 條（＝現行的 8×5 資料）時，**原序照用且完全
   不取用亂數**——否則所有既有局的牌序都會偏掉，「開關全關要能重現基線」當場就斷。 */

// 里程碑可以是字串（舊）或 {t, img}（新）——兩種並存，資料可以分批換。
E.msText = function(m){ return (m && typeof m==="object") ? (m.t||m.text||"") : (m||""); };
E.msImg  = function(m){ return (m && typeof m==="object") ? (m.img||null) : null; };

/* 開局為每個夢想抽出本局的路線，存進 S.dreamRoutes[dreamId]＝里程碑索引陣列。
   存索引而不是存內容：存檔小、重放穩，日後換掉某一條的文案也不會讓舊存檔對不上位置。 */
E.rollDreamRoutes = function(S){
  var need = S.config.dreamCost || 5;
  S.dreamRoutes = {};
  /* 開關（鐵律 2）：關掉＝取池子的前 need 條、完全不取用亂數，行為與 S23 之前一字不差。
     必須有這個開關——池子從 5 條變 20 條之後，抽選會消耗亂數，
     「開關全關要能逐位元重現基線」的比對就得靠它才做得下去。 */
  var poolOn = E.cfg(S,"dreamRoutePool");
  if(poolOn===undefined) poolOn = 1;
  (ns.content.dreams||[]).forEach(function(dr){
    var pool = dr.milestones||[];
    if(!poolOn || pool.length <= need){
      // 開關關掉、或池子不夠抽 → 取前 need 條原序照用，且【不取用亂數】（相容鐵律）
      S.dreamRoutes[dr.id] = pool.slice(0, need).map(function(_,i){ return i; });
      return;
    }
    /* 最後一條釘住＝本局的收尾。池子的第 20 條多半就是那個「完成」的節點
       （干卓萬山收官、登陸南極半島、學校營運到收支平衡、基金會不靠創辦人也能運作），
       不釘的話「集滿 5 點」那一刻可能講的是中途某一段，情緒收不起來。 */
    var pinFinale = E.cfg(S,"dreamRoutePinFinale");
    if(pinFinale===undefined) pinFinale = 1;
    var last = pool.length-1;
    var idx = pool.map(function(_,i){ return i; });
    var picked = pinFinale && need>=2
      ? util.shuffle(S, idx.slice(0,last)).slice(0, need-1).concat([last])
      : util.shuffle(S, idx).slice(0, need);
    /* 抽完再依原順序排：里程碑本身有敘事順序（第一顆星 → 圓滿二十顆），
       打亂順序會讓「第 5 點」講出比「第 1 點」更早的事。抽的是【哪五條】，不是順序。 */
    S.dreamRoutes[dr.id] = picked.sort(function(a,b){ return a-b; });
  });
};
// 本局這個夢想的第 n 條里程碑（原始物件，可能是字串或 {t,img}）
E.dreamMilestoneRaw = function(S,p,n){
  var dr=ns.content.byId[p.dreamCardId];
  if(!dr || !dr.milestones || !dr.milestones.length) return null;
  var route = (S.dreamRoutes && S.dreamRoutes[dr.id]) || null;
  if(route && route.length){
    var k = Math.max(1, Math.min(route.length, n)) - 1;
    return dr.milestones[route[k]] || null;
  }
  // 沒有抽過（舊存檔、或內容缺失）→ 退回 V11 的寫死對應，畫面不會空掉
  var i=Math.max(1,Math.min(dr.milestones.length,n))-1;
  return dr.milestones[i]||null;
};
// 相容入口：既有呼叫端拿到的仍然是純文字
E.dreamMilestone = function(S,p,n){ return E.msText(E.dreamMilestoneRaw(S,p,n)); };
/* 這一點的圖檔名（相對於 assets/dreams/）。沒有就回 null——
   介面拿到 null 就走純文字，與 S23 之前完全一樣。 */
E.dreamMilestoneImg = function(S,p,n){ return E.msImg(E.dreamMilestoneRaw(S,p,n)); };

/* S31：把這一點記進夢想相簿。相簿要有時間軸才有紀念價值——
   「第 34 輪，你站上了南湖大山」比單純一張圖強得多。
   郵戳位置（stampPos）與濃印旗標（stampBold）在里程碑資料上，離線算好，執行期不分析圖片。 */
E.logDreamPoint = function(S, p, n, paid, source){
  var raw = E.dreamMilestoneRaw(S,p,n) || {};
  if(!p.dreamLog) p.dreamLog = [];
  p.dreamLog.push({ n:n, turn:S.turnNumber, ms:E.msText(raw)||"", img:E.msImg(raw)||null,
                    pos:raw.stampPos||"tr", bold:!!raw.stampBold, paid:!!paid,
                    source: source || (paid ? "paid" : "shrine") });   // S37：blessing＝幸福盲盒
};

/* v0.2 §1：購點（每回合限 1 點、價格 base×n、限現金） */
/* S28：圓夢路上的技能兌現（各一次，Brian 裁示）。
   ① 水上類夢想（帆船、潛點）＋ 水域安全技能（游泳／CPR）：抵減一次進度費用——
      會游泳的人自己下水，省掉一整套教練與保全的錢。
   ② 旅遊類夢想（travel／outdoor）＋ 攝影：幸福感加碼一次——同一趟旅程，
      帶得回來的東西不一樣。
   兩者都只作用一次（旗標控管），不做成每次都吃得到的永久折扣。 */
E.dreamSkillPerk = function(S, p, price, commit){
  var dream = ns.content.byId[p.dreamCardId] || {};
  var tags = dream.tags || [];
  var out = { discount:0, joy:0 };
  if(!p.flags) p.flags = {};
  if(tags.indexOf("water")>=0 && !p.flags.dreamWaterPerk && E.hasSkill && E.hasSkill(p,"family:SAFETY")){
    var pct = E.cfg(S,"dreamSkillDiscountPct"); if(pct===undefined) pct = 0.5;
    out.discount = util.r2(price*pct);
  }
  if((tags.indexOf("travel")>=0 || tags.indexOf("outdoor")>=0)
     && !p.flags.dreamPhotoPerk && E.hasSkill && E.hasSkill(p,"SKL_PHOTO")){
    var jy = E.cfg(S,"dreamPhotoJoy"); if(jy===undefined) jy = 2;
    out.joy = jy;
  }
  if(!commit) return out;                       // 試算：只回傳金額，不落旗標、不發事件
  if(out.discount>0){
    p.flags.dreamWaterPerk = true;
    p.stats.skillSavedTotal = util.r2((p.stats.skillSavedTotal||0) + out.discount);
    p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
    var sid = E.hasSkill(p,"SKL_SWIM") ? "SKL_SWIM" : "SKL_CPR";   // 標實際持有的那一張
    var sc0 = ns.content.byId[sid] || {};
    E.ev("SKILL_APPLIED",{ playerId:p.id, skillId:sid, title:sc0.title||"水域安全",
                           saved:out.discount, where:"dream", assetName:dream.name||"" });
  }
  if(out.joy>0){
    p.flags.dreamPhotoPerk = true;
    p.stats.skillJoy = (p.stats.skillJoy||0) + out.joy;
    p.stats.skillsUsed = (p.stats.skillsUsed||0) + 1;
    E.ev("SKILL_APPLIED",{ playerId:p.id, skillId:"SKL_PHOTO", title:"攝影",
                           joy:out.joy, where:"dream", assetName:dream.name||"" });
  }
  return out;
};
/* 這一段進度「實際要付多少」——介面詢價與引擎扣款共用同一份，才不會出現
   卡面寫一個價、帳上扣另一個價。 */
E.dreamProgressPrice = function(S,p){
  var base = util.r2(S.config.dreamProgressBasePrice*(p.dreamProgress+1));
  var peek = E.dreamSkillPerk(S,p,base,false);
  return util.r2(base - peek.discount);
};

E.buyDreamProgress = function(S,p){
  var base = util.r2(S.config.dreamProgressBasePrice*(p.dreamProgress+1));
  var peek = E.dreamSkillPerk(S,p,base,false);
  var price = util.r2(base - peek.discount);
  if(p.cash<price || p.boughtProgressThisTurn) return false;
  if(E.freeProgressThisTurn(S,p)) return false;   // S40：踩到聖地那一輪不賣（決策路徑與直呼都擋）
  E.dreamSkillPerk(S,p,base,true);            // 確定買得起才動用一次性加成
  p.dreamProgress++; p.dreamBuyCount++; p.stats.paidProgress++;
  p.boughtProgressThisTurn=true;
  E.logDreamPoint(S,p,p.dreamProgress,true);        // S31：寫進夢想相簿
  ledger.post(S,p,"投入圓夢：買下一段進度",[{account:"CASH",delta:-price,label:"圓夢支出"}],{eduTags:["dream"]});
  E.ev("DREAM_PROGRESS",{playerId:p.id, progress:p.dreamProgress, paid:true,
    milestone:E.dreamMilestone(S,p,p.dreamProgress),
    milestoneImg:E.dreamMilestoneImg(S,p,p.dreamProgress),         // S24：全服公告要配圖
    dreamName:(ns.content.byId[p.dreamCardId]||{}).name||""});
  E.checkDreamWin(S,p);
  return true;
};
// 落地處理完畢後統一詢問（任何外圈格；本命聖地免費+1 後仍可再購 1＝幸運雙倍）
/* S40（Brian）：v0.2 的「本命聖地免費 +1 後同回合仍可再購 1＝幸運雙倍」拿掉——
   踩到聖地那一輪不能再用錢買，一輪最多一點。dreamFreeThenBuy=1 回到 v0.2 行為。 */
E.freeProgressThisTurn = function(S,p){
  var on=E.cfg(S,"dreamFreeThenBuy"); if(on===undefined) on=0;
  if(on) return false;
  return p.freeProgressTurn===S.turnNumber;
};
E.offerDreamProgress = function(S,p){
  if(S.over || p.bankrupt || p.playerStage!=="OUTER") return;
  if(p.boughtProgressThisTurn) return;
  if(E.freeProgressThisTurn(S,p)) return;          // S40：這一輪已經免費拿到一點
  if(p.dreamProgress >= S.config.dreamCost) return;
  var price = E.dreamProgressPrice(S,p);       // S28：含技能一次性折抵，與扣款同一份
  if(p.cash < price) return;
  E.pushDecision(S,p,{kind:"BUY_PROGRESS", price:price});
};

// V11：圓夢獲勝＝夢想集滿 ＋ 幸福感達門檻（錢與夢都到位，人生才算圓滿）
E.winWellbeingMin = function(S){
  var w=E.cfg(S,"winWellbeingMin"); return (w===undefined)?10:w;
};
E.checkDreamWin = function(S,p){
  if(p.dreamProgress < S.config.dreamCost) return;
  var need=E.winWellbeingMin(S), have=E.wellbeing(S,p);
  if(have < need){
    if(!p.flags) p.flags={};
    if(!p.flags.dreamPending){
      p.flags.dreamPending=true;
      E.ev("DREAM_PENDING",{playerId:p.id, wellbeing:have, need:need});
    }
    return;
  }
  S.over=true; S.winner=p.id; S.overReason="DREAM";
  E.ev("GAME_OVER",{reason:"DREAM", playerId:p.id});
};
// 幸福感事後補到門檻也要能獲勝：每回合開始檢查一次
E.recheckDreamWin = function(S){
  S.players.forEach(function(p){
    if(p.bankrupt || S.over) return;
    if(p.dreamProgress >= S.config.dreamCost) E.checkDreamWin(S,p);
  });
};

/* ===================== S11：定期定額與股息再投入 =========================
   兩者共用一個「預算 → 買得起幾張 → 剩下的留到下期」的機制。
   carry 不是現金，是「還沒湊滿一張的預算」——現金只在真的買進時才動，
   所以帳上不會多出一筆沒人管的錢。這也剛好把定期定額的重點演出來：
   同樣的金額，價格低的時候買到比較多張。                                   */

E.autoInvestOn = function(S){
  if(S.enabledModules.indexOf("M1")<0) return false;
  var v=E.cfg(S,"autoInvestEnabled");
  return v===undefined ? true : !!v;
};

// 用一筆預算去買某檔股票，回傳實際買了幾張與花掉多少（買不起就買 0 張）
E.autoBuyUnits = function(S, p, sym, budget, why, opts){
  var def=ns.content.stockBySymbol[sym]; if(!def) return {units:0, spent:0};
  if(S.delisted && S.delisted[sym]) return {units:0, spent:0, dead:true};
  var price=E.stockPrice(S,def);
  if(!(price>0)) return {units:0, spent:0};
  // S15b（X4）：自動扣款也要付手續費，否則自動化變成免手續費的套利。
  // 預算要能同時蓋住股款與手續費，所以每張的實際單價是 price×(1+費率)。
  var feeR=E.cfg(S,"stockFeeRate")||0;
  var perUnit=price*(1+feeR);
  var units=Math.floor(Math.min(budget, p.cash)/perUnit);
  if(units<1) return {units:0, spent:0};
  var total=util.r2(price*units);
  var feeA=E.stockFee(S,total);
  var div=util.r2(units*E.stockDivPerUnit(S,def));        // S23a：同上
  var ex=p.assets.filter(function(x){ return x.kind==="STOCK"&&x.symbol===sym&&!(x.flags&&x.flags.margin); })[0];
  var aid = ex ? ex.instanceId : util.uid(S,"A");
  if(ex){ ex.units+=units; ex.costBasis=util.r2(ex.costBasis+total);
          ex.marketValue=util.r2(ex.marketValue+total);
          ex.monthlyIncome=util.r2(ex.monthlyIncome+div); }
  else { p.assets.push({instanceId:aid, cardId:null, kind:"STOCK", name:E.stockName(S,sym),
          symbol:sym, units:units, costBasis:total, marketValue:total, monthlyIncome:div,
          linkedLiabilityId:null, flags:{}}); }
  var post=[{account:"CASH",delta:-total,label:why},
            {account:"ASSET",delta:total,refId:aid,label:E.stockName(S,sym)}];
  if(feeA) post.push({account:"CASH",delta:-feeA,label:"券商手續費"});
  if(div) post.push({account:"INCOME_PASSIVE",delta:div,refId:aid,label:E.stockName(S,sym)+" 股息"});
  /* S23a：摘要要說清楚錢從哪來。原本只寫「股息再投入：〇〇 ×164」，
     玩家看到現金又被扣一次會以為重複扣款——把本期股息與手續費寫進摘要。 */
  // 累積張數：這一檔現在總共抱了幾張（含這次買的；融資倉另計，不混在一起）
  var heldNow = util.sum(p.assets.filter(function(a){
    return a.kind==="STOCK" && a.symbol===sym && !(a.flags&&a.flags.margin) && !(a.flags&&a.flags.wallpaper); }),
    function(a){ return a.units||0; });
  var sumTxt = why+"："+E.stockName(S,sym)+" ×"+units+"（累積 "+heldNow+" 張）";
  if(opts && opts.dividend>0)
    sumTxt = why+"：本期股息 "+util.money(opts.dividend)+" → 買 "+E.stockName(S,sym)+" "+units+" 張（累積 "+heldNow+" 張）";
  ledger.post(S,p,sumTxt,post,{eduTags:["equity","auto-invest"],
    detail:{ units:units, price:price, fee:feeA, dividend:(opts&&opts.dividend)||0, held:heldNow }});
  // spent 含手續費——carry（還沒湊滿一張的預算）要從實際花掉的金額算起
  return {units:units, spent:util.r2(total+feeA), price:price, fee:feeA};
};

E.tickAutoInvest = function(S, p){
  if(p.bankrupt || !E.autoInvestOn(S)) return;

  // (1) 定期定額：每次發薪照設定金額扣款買進
  (p.dcaPlans||[]).forEach(function(pl){
    if(!pl || pl.paused) return;
    if(S.delisted && S.delisted[pl.symbol]){ pl.paused=true;
      E.ev("DCA_STOPPED",{playerId:p.id, symbol:pl.symbol, why:"已下市"}); return; }
    var budget=util.r2((pl.carry||0) + pl.amount);
    if(p.cash < budget){
      // 現金不足就跳過這一期——扣不出來的定期定額不會自己變成負債，但也不會補扣
      pl.missed=(pl.missed||0)+1; pl.carry=0;
      E.ev("DCA_SKIPPED",{playerId:p.id, symbol:pl.symbol, need:budget, cash:p.cash});
      return;
    }
    var r=E.autoBuyUnits(S,p,pl.symbol,budget,"定期定額扣款");
    pl.carry=util.r2(budget - r.spent);
    pl.units=(pl.units||0)+r.units; pl.spent=util.r2((pl.spent||0)+r.spent);
    pl.periods=(pl.periods||0)+1;
    if(r.units>0) E.ev("DCA_BOUGHT",{playerId:p.id, symbol:pl.symbol, units:r.units,
                                     spent:r.spent, price:r.price, carry:pl.carry});
  });

  // (2) 股息再投入：配息已隨發薪結算進現金，這裡把同額再買回同一檔
  var re=p.divReinvest||{};
  Object.keys(re).forEach(function(sym){
    if(!re[sym]) return;
    if(S.delisted && S.delisted[sym]) return;
    var lots=p.assets.filter(function(a){ return a.kind==="STOCK"&&a.symbol===sym&&!(a.flags&&a.flags.margin); });
    if(!lots.length) return;
    var div=util.r2(util.sum(lots,function(a){ return a.monthlyIncome||0; }));
    if(!(div>0)) return;
    p.divCarry=p.divCarry||{};
    var budget=util.r2((p.divCarry[sym]||0) + div);
    if(p.cash < budget){ p.divCarry[sym]=0; return; }
    var r2=E.autoBuyUnits(S,p,sym,budget,"股息再投入",{dividend:div});
    p.divCarry[sym]=util.r2(budget - r2.spent);
    if(r2.units>0) E.ev("DIV_REINVESTED",{playerId:p.id, symbol:sym, units:r2.units,
                                          spent:r2.spent, dividend:div});
  });
};

/* ================== S13：記帳的六套交易類型 ==========================
   分套的依據是「這筆分錄長什麼樣」，不是卡片來源——因為玩家要練的是
   「這一組帳怎麼記」，而同一種帳可能來自很多張不同的卡。                */
/* S14a-2：排序改成「實際最常遇到的排最上面」。
   依據＝跑 900 局模擬（3 組模組／陣容）統計會出題的分錄共 56,813 筆，各套的佔比：
     現金買資產 51.8%｜消費與誘惑 18.4%｜資產變現 12.1%｜收入類 9.1%｜貸款買資產 7.3%｜借款與償債 1.3%
   注意 share 是「整筆出現的頻率」（也就是決定你多快能連五次答對、解鎖那一套），
   不是題目數的佔比——貸款買資產每次會出到 4 格，題目數佔 16.9%，屬於「少見但每次很重」。 */
E.BK_GROUPS = [
  { key:"buyCash",  name:"現金買資產",  accs:"資產＋現金",  share:0.518, tier:"最常遇到",
    hint:"錢變成東西：現金減少、資產增加，淨值不變" },
  { key:"spend",    name:"消費與誘惑",  accs:"支出＋現金",  share:0.184, tier:"很常遇到",
    hint:"花掉就沒了：不會留下任何可以再賺錢的東西" },
  { key:"realize",  name:"資產變現",    accs:"資產＋現金＋收入", share:0.121, tier:"常遇到",
    hint:"賣掉東西：資產減少、現金增加，那筆收入也跟著停" },
  { key:"income",   name:"收入類",      accs:"收入＋現金",  share:0.091, tier:"偶爾",
    hint:"錢進來：分清楚是靠時間換的，還是資產自己長的" },
  { key:"buyLoan",  name:"貸款買資產",  accs:"資產＋負債＋支出", share:0.073, tier:"少見但每次題目最多",
    hint:"借錢買的東西：資產與負債同時長大，還多一筆利息支出" },
  { key:"debt",     name:"借款與償債",  accs:"負債＋現金＋支出", share:0.013, tier:"最少遇到",
    hint:"純粹的錢與債：沒有東西進出，只有負債水位在動" }
];
E.bkGroupOf = function(entry){
  if(!entry || !entry.postings) return null;
  var has={}, assetDelta=0;
  entry.postings.forEach(function(q){
    has[q.account]=true;
    if(q.account==="ASSET") assetDelta+=q.delta;
  });
  var A=has.ASSET, L=has.LIABILITY, I=(has.INCOME_ACTIVE||has.INCOME_PASSIVE), Ex=has.EXPENSE;
  if(A && assetDelta<0) return "realize";       // 資產減少＝賣出／變現（含下市歸零）
  if(A && L)            return "buyLoan";
  if(A)                 return "buyCash";
  if(L)                 return "debt";
  if(Ex && !I)          return "spend";
  if(I)                 return "income";
  return null;                                   // 歸不到任何一套：照樣要作答，但不計入熟練度
};
E.bkGroupName = function(key){
  for(var i=0;i<E.BK_GROUPS.length;i++) if(E.BK_GROUPS[i].key===key) return E.BK_GROUPS[i].name;
  return "其他";
};

/* ============================ 回合收尾 ================================== */
E.afterResolve = function(S,p){
  // S15d：turnResolved 與 bookkeeping 都是「當前回合玩家」的狀態。
  // 非當前玩家答完自己的決策時不能動它們——否則當前玩家會變成「不用擲骰就能結束回合」，
  // 或是被掛上別人的記帳題而結束不了回合。
  var act = E.activePlayer(S);
  if(p===act) S.turnResolved = true;
  if(S.decisionQueue.length || S.over) { E.syncPhase(S); return; }
  if(p===act) E.buildBookkeeping(S,act);
  E.syncPhase(S);
};

// 九期修正：原本只在骰完落點時建一次，之後在 READY_END 做的還款／買賣／借款
// 都不會產生記帳題目 → 玩家看到「錢扣了、負債卻沒動」。改為可重建（保留已答對的題目）。
// S14a-2：非回合做的動作（還款／商城）會在別人的回合產生分錄。
// 記帳題本來只掃「本輪」的分錄，那些帳會整批漏掉——尤其「借款與償債」本來就是最少見的一套。
// 這裡標記起來，輪到自己時照樣出題；答完（整筆處理過）就清掉，不會一直重複問。
// 一筆分錄的所有題目都處理過了 → 清掉 offTurn，下一輪不再問
E.clearOffTurnIfDone = function(S,p,entryId){
  if(!S.bookkeeping) return;
  var rest=(S.bookkeeping.tasks||[]).filter(function(x){ return x.entryId===entryId && !x.done; });
  if(rest.length>1) return;        // 還有別格沒答（當下這一格尚未標 done）
  var en=(p.ledger||[]).filter(function(e){ return e.entryId===entryId; })[0];
  if(en && en.offTurn) delete en.offTurn;
};
E.markOffTurnLedger = function(p){
  if(!p || !p.ledger || !p.ledger.length) return;
  var en=p.ledger[p.ledger.length-1];
  if(en) en.offTurn=true;
};
E.buildBookkeeping = function(S,p){
  if(p.isNPC || S.config.automationLevel!==2){ S.bookkeeping=null; return; }
  var DENY = ["valuation","dividend","event-end","inflation","rate","cashflow","bookkeeping"];
  var doneMap={};
  if(S.bookkeeping && S.bookkeeping.turn===S.turnNumber && S.bookkeeping.playerId===p.id){
    S.bookkeeping.tasks.forEach(function(t){ if(t.done && t.key) doneMap[t.key]=true; });
  }
  var tasks=[];
  p.ledger.forEach(function(en){
    if(en.playerId!==p.id) return;
    // 本輪的帳，或是在別人回合做的、還沒記過的帳（S14a-2）
    if(en.turnNumber!==S.turnNumber && !en.offTurn) return;
    if(en.kind==="PAYDAY"||en.kind==="SETUP") return;
    // 只讓玩家分類「自己主動決策」產生的分錄；股價／股息／事件回復等被動變動不列入
    if(en.eduTags && en.eduTags.some(function(t){ return DENY.indexOf(t)>=0; })) return;
    // S13：整筆分錄屬於某一套交易類型；該套已設為自動就整筆不出題
    var grp=E.bkGroupOf(en);
    if(grp && p.bkAuto && p.bkAuto[grp]) return;
    en.postings.forEach(function(q,qi){
      if(q.account==="CASH") return;
      var key=en.entryId+"#"+qi;
      tasks.push({ key:key, label:en.summary+" — "+q.label, amount:q.delta, account:q.account,
        entryId:en.entryId, group:grp,
        hint:ns.content.byId[en.cardId||""]&&ns.content.byId[en.cardId].eduNote || null,
        done:!!doneMap[key] });
    });
  });
  S.bookkeeping = tasks.length ? { tasks:tasks, turn:S.turnNumber, playerId:p.id } : null;
};

// 九期：回合中（READY_END）任何會記帳的自主動作之後，補上對應的記帳題目
E.refreshBookkeeping = function(S){
  var p=E.activePlayer(S);
  if(!p || p.isNPC || S.over) return;
  if(!S.turnResolved) return;                 // 尚未擲骰落點：由 afterResolve 統一建立
  if(S.decisionQueue.length || S.pendingDecision) return;
  E.buildBookkeeping(S,p);
};

E.endTurn = function(S){
  var p=E.activePlayer(S);
  ns.modules.onTurnEnd(S,p);
  S.bookkeeping=null; S.turnResolved=false; p.boughtProgressThisTurn=false;
  // S19：改由 E.onRoundEnd 統一每輪歸零全員；開關關掉時退回舊的「回合結束只重置自己」
  if(E.cfg(S,"mallResetPerRound")===0) p.mallBoughtThisTurn=0;

  var guard=0, n=S.players.length;
  do { S.activePlayerIdx=(S.activePlayerIdx+1)%n;
       if(S.activePlayerIdx===0){ S.turnNumber++; E.onRoundEnd(S); }
       guard++;
  } while(S.players[S.activePlayerIdx].bankrupt && guard<n*3 && !S.over);

  if(S.over){ E.syncPhase(S); return; }
  if(S.turnNumber>S.config.maxTurns){ E.finishByRanking(S); return; }
  E.beginTurn(S);
};

E.beginTurn = function(S){
  var p=E.activePlayer(S);
  E.recheckDreamWin(S);              // V11：幸福感事後補到門檻也算圓夢
  if(S.over) return;
  ns.modules.onTurnStart(S,p);
  /* S39：集資的期限＝發起人下一次回合開始（一輪）。輪到發起人就結算；
     發起人已經不在（破產／自由圈）而輪次又過了一整輪，也在任何人的回合開始結算，不讓它掛著。 */
  if(S.pendingSyndicate){
    var psT=S.pendingSyndicate;
    var fromT=S.players[psT.fromId];
    var due = (p.id===psT.fromId && S.turnNumber>psT.openedTurn)
           || (!fromT || fromT.bankrupt || fromT.playerStage!=="INNER") && S.turnNumber>psT.openedTurn+1;
    if(due) E.settleSyndicate(S,"due");
  }
  if(p.skippedTurns>0){
    p.skippedTurns--;
    // S13.1 §7：只丟一句「這回合停走」看不出為什麼。把原因與還剩幾輪一起帶給 UI。
    var skR = p.skipReason || null;
    if(p.skippedTurns<=0) p.skipReason=null;
    E.ev("TURN_SKIPPED",{playerId:p.id, reason:skR, remaining:p.skippedTurns});
    S.turnResolved=true; return E.endTurn(S); }
  // S14b：每輪固定發薪——回合一開始就結算，玩家拿到錢再決定怎麼用。
  // 停走的回合不發（上面那段已經 return），破產或遊戲結束就停手。
  if(E.fixedPaydayOn(S) && !p.bankrupt){
    E.payday(S,p);
    if(S.over){ E.syncPhase(S); return; }
    // S14b 修正：發薪當場把人壓垮時，破產可能「已成定局」（電腦玩家走 npcRescue 失敗、
    // 或外圈跌落直接判定），此時沒有任何待決事項可以推進，回合卻停在 ROLL——
    // 該玩家擲不了骰（BANKRUPT）也結束不了回合（MUST_ROLL），整局就卡死在這裡。
    // 舊制發薪發生在移動途中，由回合既有流程收尾，所以碰不到這個洞。
    if(p.bankrupt){ S.turnResolved=true; return E.endTurn(S); }
    // 破產決策還在玩家手上（真人要選變賣／借款／宣告）：停下來等他決定。
    if((S.decisionQueue||[]).some(function(d){ return d.kind==="BANKRUPTCY"; })){ E.syncPhase(S); return; }
  }
  E.tickRenewals(S,p);               // 產險自動續約、健檢／健身年約到期詢問
  E.tickDelistWarn(S,p);             // S7b：下市警示在自己的回合才跳卡
  E.tickFutCall(S,p);                // S23b：期貨追繳（在自己的回合才跳卡）
  E.tickDirectorship(S,p);           // S21/S22：獨立董事車馬費、審計警訊與弊案結算
  E.tickScamInvestments(S,p);        // S21/S22：偽裝高息投資到期引爆
  // S22：上面兩個結算可能把人打到現金負——電腦玩家走 npcRescue 失敗就地破產、真人則排入破產決策。
  // 與 S14b 發薪那段同一個洞：破產已成定局卻停在 ROLL，誰都推不動。這裡照同一套收尾。
  if(p.bankrupt){ S.turnResolved=true; return E.endTurn(S); }
  if((S.decisionQueue||[]).some(function(d){ return d.kind==="BANKRUPTCY"; })){ E.syncPhase(S); return; }
  E.ev("TURN_START",{playerId:p.id, turn:S.turnNumber});
};

// 年約類的到期處理：產險自動續約（扣得起就續），其餘到期時主動問玩家
E.tickRenewals = function(S, p){
  if(p.bankrupt) return;
  p.flags = p.flags || {};
  // 1) 產險：年繳自動續約——方便到你會忘記它一直在扣錢
  if(p.flags.propInsured && p.flags.propRenewAt!==undefined && S.turnNumber >= p.flags.propRenewAt){
    var prem = util.r2(p.flags.propPremium||0);
    var rt = E.cfg(S,"propertyRenewTurns"); if(rt===undefined) rt = 12;
    if(p.cash >= prem){
      if(prem>0) ledger.post(S,p,"住宅火險自動續約",
        [{account:"CASH",delta:-prem,label:"年繳保費（自動續約）"}],{eduTags:["insurance"]});
      p.flags.propRenewAt = S.turnNumber + rt;
      E.ev("PROPERTY_RENEWED",{playerId:p.id, premium:prem, nextAt:p.flags.propRenewAt});
    } else {
      p.flags.propInsured = false; p.flags.propPremium = 0; p.flags.propRenewAt = undefined;
      E.ev("PROPERTY_LAPSED",{playerId:p.id, premium:prem});   // 繳不出保費＝保障斷在最需要的時候
    }
  }
  // 2) 健檢／健身年約：到期時問一次要不要續約（問過就不再打擾）
  ["fit","checked"].forEach(function(fg){
    var until = p.flags[fg+"Until"];
    if(until===undefined) return;
    if(S.turnNumber <= until) return;                 // 還在效期內
    var itId = p.flags[fg+"Item"];
    var it = itId ? ns.content.byId[itId] : null;
    // 既有缺陷修正：年約的月費原本是「永久支出」，效期過了還一直扣，續約還會疊加。
    // 年約到期＝月費也該停（與 M8 學習期間月費的沖回語意一致）。
    if(it && !p.flags[fg+"FeeEnded"]){
      var rmF = (it.payload||{}).recurringMonthly||0;
      p.flags[fg+"FeeEnded"] = 1;
      if(rmF>0) ledger.post(S,p,"年約到期："+it.title,
        [{account:"EXPENSE",delta:util.r2(-rmF),label:it.title+" 月費終止"}],{eduTags:["mall"]});
    }
    if(p.flags[fg+"Asked"]) return;                   // 已經問過
    if(!it || !it.renewable){ p.flags[fg+"Asked"]=1; return; }
    p.flags[fg+"Asked"] = 1;
    E.pushDecision(S,p,{ kind:"RENEW_MALL", itemId:it.id, flag:fg });
    E.ev("MALL_EXPIRED",{playerId:p.id, itemId:it.id, title:it.title, flag:fg});
  });
};

E.onRoundEnd = function(S){
  /* S19：商城次數上限原本只在 E.endTurn 重置「當前回合玩家」。
     非回合買開放之後，同一輪可以買兩次——先在別人的回合買一次、自己的回合結束時被重置、
     再到下一位的回合買第二次（實測第 2 輪 Brian 就買了兩件）。
     改成每一輪結束把全員歸零，語意才真的是「同一輪只能買 mallPerTurn 次」。 */
  if(E.cfg(S,"mallResetPerRound")!==0)
    S.players.forEach(function(pl){ pl.mallBoughtThisTurn=0; });
  var keep=[];
  S.activeGlobalEvents.forEach(function(e){
    if(e.until>S.turnNumber){ keep.push(e); return; }
    if(e.kind==="EXPENSE_REVERT"){ var pl=S.players[e.playerId];
      if(pl) ledger.post(S,pl,"事件結束："+e.label,[{account:"EXPENSE",delta:-e.amount,label:e.label}],{eduTags:["event-end"]}); }
    if(e.kind==="INCOME_REVERT"){ var pl2=S.players[e.playerId];
      if(pl2){ var a=pl2.assets.filter(function(x){return x.instanceId===e.assetId;})[0];
        if(a){ a.monthlyIncome=util.r2(a.monthlyIncome+e.amount);
          ledger.post(S,pl2,"事件結束："+e.label,[{account:"INCOME_PASSIVE",delta:e.amount,refId:a.instanceId,label:e.label}],{eduTags:["event-end"]}); } } }
    if(e.kind==="DELAYED_FX"){ var plX=S.players[e.playerId];      // S22：定時炸彈到期
      if(plX && !plX.bankrupt){
        // S27：只帶 insurable，刻意不帶 lifeEvent——「貴人相助」是用來減免倒楣事的，
        // 不該拿來幫人頭帳戶那種自找的定時炸彈打折。
        E.applyEffects(S,plX,e.effects,e.label,{insurable:!!e.insurable});
        // S27：把代價一起帶進事件，介面才播得出「賠了多少、停幾輪」——這是要讓全桌都看到的教材，
        // 不能只有當事人在帳上看到一筆莫名其妙的支出。
        var dCost=0, dSkip=0;
        (e.effects||[]).forEach(function(x){
          if(x.op==="CASH_DELTA" && x.amount<0) dCost=util.r2(dCost-x.amount);
          if(x.op==="SKIP_TURNS") dSkip+=(x.turns!==undefined?x.turns:(x.n!==undefined?x.n:1));
        });
        E.ev("DELAYED_EFFECT_FIRED",{playerId:plX.id, label:e.label, cost:dCost, skip:dSkip});
        if(plX.cash<0) E.enterBankruptcy(S,plX);
      } }
    if(e.kind==="DIV_BONUS") delete S.dividendBonus[e.symbol];
    if(e.kind==="SPACE_MULT") delete S.spaceMult[e.spaceType];
    if(e.kind==="PARAM"){ E.ev("EVENT_EXPIRED",{label:e.label, param:e.param}); }
    // M8 S3：預告到期——這時候技能才真的過時（此前玩家都還有機會去進修更新）
    if(e.kind==="SKILL_DECAY_PENDING"){ var plD=S.players[e.playerId];
      var recD = plD && plD.skills ? plD.skills[e.skillId] : null;
      if(recD && !recD.decayed){
        recD.decayed = true;
        delete recD.decayPendingUntil;
        plD.stats.skillsDecayed = (plD.stats.skillsDecayed||0) + 1;
        var scD = ns.content.byId[e.skillId];
        E.ev("SKILL_DECAYED",{ playerId:plD.id, skillId:e.skillId,
                               title:scD?scD.title:e.skillId, label:e.label });
      } else if(recD){ delete recD.decayPendingUntil; }   // 期間內已更新過 → 預告作廢
    }
  });
  var had=S.activeGlobalEvents.length; S.activeGlobalEvents=keep;
  if(had!==keep.length) E.repriceFloating(S);
  E.p2pRoundEnd(S);          // §4：P2P 每輪一期，雙邊對轉
  ns.modules.onRoundEnd(S);
};

/* ===================== §4 P2P 民間借貸（onRoundEnd 對轉模型） =====================
   模型（工程書指定「後者」）：P2P 不進 borrower EXPENSE、也不進 lender INCOME_PASSIVE 水位；
   每輪一期於 onRoundEnd 直接對轉現金：borrower CASH−PMT／lender CASH＋PMT、
   borrower LIABILITY−本金份、lender ASSET−本金份（差額＝利息，反映為 lender 淨值增加）。
   推論（刻意）：P2P 期款不影響雙方自由率（passiveIncome/totalExpenses 水位不動）。 */
E.p2pMinRate = function(S, borrower){
  var sp=E.cfg(S,"p2pLendSpread"); if(sp===undefined) sp=0.04;
  var rc=E.cfg(S,"p2pRiskSpreadC"); if(rc===undefined) rc=0.03;
  return E.rRate(S.macro.baseRate + sp + (borrower.creditRating==="C"?rc:0));
};
// V3：NPC 合資意願（水位規則——只給電腦用；真人由自己決定）
E.jvNpcWilling = function(S, partner, jCard, myShare){
  var inc=E.oppIncome(S,jCard), entry=E.oppEntry(S,jCard);
  var wJ=ns.content.personalityById[partner.npcPersonality].weights;
  var pReserve=wJ.cashReserveFloor*partner.derived.totalExpenses;
  var pEntry=util.r2(entry*(1-myShare));
  return inc>0 && partner.cash - pEntry >= pReserve;
};

// V3 抽出：合資執行（先驗後買、比例分割、兩筆獨立資產）；回傳 null＝成立，否則失敗原因
E.execJV = function(S, p, partner, jCard, myShare){
  var inc=E.oppIncome(S,jCard), entry=E.oppEntry(S,jCard);
  if(!(inc>0)) return "income";
  var myEntry=util.r2(entry*myShare);
  if(p.cash - myEntry < 0) return "self";
  function splitVal(v){ v=v||0; var pv=util.r2(v*(1-myShare)); return {partner:pv, mine:util.r2(v-pv)}; }
  var pl0=jCard.payload, mineP={}, partP={};
  if(jCard.kind==="REALESTATE"){
    ["price","downPayment","monthlyRent","monthlyCost"].forEach(function(k){
      var sp=splitVal(pl0[k]); mineP[k]=sp.mine; partP[k]=sp.partner; });
    ["mortgageRate","isFloating","exitMultipliers"].forEach(function(k){ mineP[k]=pl0[k]; partP[k]=pl0[k]; });
  } else {
    ["price","monthlyProfit"].forEach(function(k){
      var sp=splitVal(pl0[k]); mineP[k]=sp.mine; partP[k]=sp.partner; });
    if(pl0.volatileProfit){ mineP.volatileProfit=true; partP.volatileProfit=true; }
  }
  var cardMine={id:jCard.id, kind:jCard.kind, title:jCard.title, payload:mineP};
  var cardPart={id:jCard.id, kind:jCard.kind, title:jCard.title, payload:partP};
  function needOf(pl2, cd2){
    var o=E.oppDefaultOption(S,pl2,cd2), pp=cd2.payload;
    if(cd2.kind==="REALESTATE" && o.optionId==="loan"){
      var ltv=Math.min(1-(pp.downPayment||0)/Math.max(1,pp.price), E.effMaxLTV(S,jCard));
      if(!(ltv>0)) ltv=0;
      return { need: util.r2(pp.price-util.r2(pp.price*ltv)), opt:o };
    }
    if(cd2.kind==="BUSINESS" && o.optionId==="loan"){
      var cap=E.creditCapacity(S,pl2);
      var loanB=util.r2(Math.max(0,Math.min(Math.max(0,pp.price-pl2.cash), cap, pp.price)));
      return { need: util.r2(pp.price-loanB), opt:o };
    }
    return { need: pp.price, opt:o };
  }
  var nMine=needOf(p,cardMine), nPart=needOf(partner,cardPart);
  if(p.cash<nMine.need || partner.cash<nPart.need) return "afford";
  var jvId=util.uid(S,"JV");
  function jvBuy(pl2, cd2, share, opt){
    var before=pl2.assets.length;
    E.buyAsset(S,pl2,cd2,opt.optionId,opt.params);
    if(pl2.assets.length<=before) return null;
    var a=pl2.assets[pl2.assets.length-1];
    a.name = jCard.title+"（持份 "+Math.round(share*100)+"%）";
    a.jvGroupId=jvId; a.sharePct=share;
    return a;
  }
  var aPart=jvBuy(partner,cardPart,util.r2(1-myShare),nPart.opt);
  var aMine=jvBuy(p,cardMine,myShare,nMine.opt);
  if(!aPart || !aMine) return "buy-fail";
  p.stats.passedOpps++;
  S.decisionQueue.shift();
  E.ev("JV_FORMED",{cardId:jCard.id, title:jCard.title, aId:p.id, bId:partner.id,
                    aShare:myShare, jvGroupId:jvId});
  E.afterResolve(S,p);
  return null;
};

// V3：廣播合資輪詢電腦——依座位序找第一位「水位夠且能出資」的 NPC；全滅＝沒人合資
E.jvPollNPC = function(S, p, jCard, myShare){
  var npcs=S.players.filter(function(x){ return x.isNPC && x.id!==p.id && !x.bankrupt; });
  for(var i=0;i<npcs.length;i++){
    if(!E.jvNpcWilling(S,npcs[i],jCard,myShare)) continue;
    var why=E.execJV(S,p,npcs[i],jCard,myShare);
    if(!why) return true;
  }
  E.ev("JV_REJECTED",{cardId:jCard.id, title:jCard.title, partnerId:null, reason:"nobody"});
  return false;
};


/* ===================== S39：集資的引擎函式 ===================== */
// 這一份持份要付多少現金（依各人的預設買法：不動產走貸款、事業現金不夠才信貸）
E.syndicateNeed = function(S, who, card, share){
  var pl0=card.payload||{}, sub={};
  if(card.kind==="REALESTATE"){
    ["price","downPayment","monthlyRent","monthlyCost"].forEach(function(k){ sub[k]=util.r2((pl0[k]||0)*share); });
    ["mortgageRate","isFloating","exitMultipliers"].forEach(function(k){ sub[k]=pl0[k]; });
  } else {
    ["price","monthlyProfit"].forEach(function(k){ sub[k]=util.r2((pl0[k]||0)*share); });
  }
  var cd={id:card.id, kind:card.kind, title:card.title, deck:card.deck, payload:sub};
  var o=E.oppDefaultOption(S,who,cd), pp=cd.payload;
  if(cd.kind==="REALESTATE" && o.optionId==="loan"){
    var ltv=Math.min(1-(pp.downPayment||0)/Math.max(1,pp.price), E.effMaxLTV(S,card));
    if(!(ltv>0)) ltv=0;
    return util.r2(pp.price-util.r2(pp.price*ltv));
  }
  if(cd.kind==="BUSINESS" && o.optionId==="loan"){
    var cap=E.creditCapacity(S,who);
    var loanB=util.r2(Math.max(0,Math.min(Math.max(0,pp.price-who.cash), cap, pp.price)));
    return util.r2(pp.price-loanB);
  }
  return pp.price;
};
E.syndicateRemaining = function(ps){
  var t=0; Object.keys(ps.shares||{}).forEach(function(k){ t+=ps.shares[k]; });
  return util.r2(Math.max(0, 1-t));
};
// 電腦認購：座位序輪詢，每位在「出完不跌破保留水位」的前提下拿走它出得起的最大持份（0.1 為一格，至少最低持份）
E.syndicatePollNPC = function(S, ps){
  var card=ns.content.byId[ps.cardId]; if(!card) return;
  var npcs=S.players.filter(function(x){ return x.isNPC && !x.bankrupt && x.playerStage==="INNER"
                                         && x.id!==ps.fromId && ps.shares[x.id]===undefined; });
  for(var i=0;i<npcs.length;i++){
    var rem=E.syndicateRemaining(ps); if(rem<=1e-9) break;
    var q=npcs[i], w=ns.content.personalityById[q.npcPersonality].weights;
    var reserve=w.cashReserveFloor*q.derived.totalExpenses;
    var floorQ=Math.min(ps.minShare, rem), take=0;
    for(var sh=Math.floor(rem*10)/10; sh>=floorQ-1e-9; sh=util.r2(sh-0.1)){
      var need=E.syndicateNeed(S,q,card,sh);
      if(q.cash-need >= reserve){ take=sh; break; }
    }
    if(take<=0 && floorQ<0.1){ var needF=E.syndicateNeed(S,q,card,floorQ); if(q.cash-needF>=reserve) take=floorQ; }
    if(take>0){
      if(take>rem) take=rem;
      ps.shares[q.id]=util.r2(take);
      E.ev("SYNDICATE_JOINED",{id:ps.id, cardId:ps.cardId, title:ps.title, playerId:q.id, share:ps.shares[q.id],
        remaining:E.syndicateRemaining(ps), npc:true});
    }
  }
};
// 成交：每位參與者各買一份（持份等比例；尾差歸發起人）。回傳 null＝成立，否則失敗原因
E.execSyndicate = function(S, ps){
  var card=ns.content.byId[ps.cardId]; if(!card) return "card";
  var ids=Object.keys(ps.shares).map(Number).sort(function(a,b){ return a-b; });
  var pl0=card.payload||{}, keys = card.kind==="REALESTATE" ? ["price","downPayment","monthlyRent","monthlyCost"] : ["price","monthlyProfit"];
  var parts={}, used={}; keys.forEach(function(k){ used[k]=0; });
  ids.forEach(function(pid){
    var sub={};
    if(pid===ps.fromId){ keys.forEach(function(k){ sub[k]=null; }); }   // 發起人拿尾差，最後算
    else keys.forEach(function(k){ sub[k]=util.r2((pl0[k]||0)*ps.shares[pid]); used[k]=util.r2(used[k]+sub[k]); });
    parts[pid]=sub;
  });
  keys.forEach(function(k){ parts[ps.fromId][k]=util.r2((pl0[k]||0)-used[k]); });
  var cards={}, opts={};
  for(var i=0;i<ids.length;i++){
    var pid=ids[i], who=S.players[pid];
    if(!who || who.bankrupt) return "party";
    var sub=parts[pid];
    if(card.kind==="REALESTATE"){ ["mortgageRate","isFloating","exitMultipliers"].forEach(function(k){ sub[k]=pl0[k]; }); }
    else if(pl0.volatileProfit) sub.volatileProfit=true;
    cards[pid]={id:card.id, kind:card.kind, title:card.title, deck:card.deck, payload:sub};
    opts[pid]=E.oppDefaultOption(S,who,cards[pid]);
    if(who.cash < E.syndicateNeed(S,who,card,ps.shares[pid])) return "afford:"+pid;
  }
  var jvId=util.uid(S,"JV"), members=[];
  for(var j=0;j<ids.length;j++){
    var pid2=ids[j], who2=S.players[pid2], before=who2.assets.length;
    E.buyAsset(S,who2,cards[pid2],opts[pid2].optionId,opts[pid2].params);
    if(who2.assets.length<=before) return "buy-fail:"+pid2;
    var a=who2.assets[who2.assets.length-1];
    a.name=card.title+"（持份 "+Math.round(ps.shares[pid2]*100)+"%）";
    a.jvGroupId=jvId; a.sharePct=ps.shares[pid2]; a.syndicate=true;
    members.push({id:pid2, share:ps.shares[pid2]});
  }
  var fromP=S.players[ps.fromId]; if(fromP) fromP.stats.syndicatesLed=(fromP.stats.syndicatesLed||0)+1;
  E.ev("SYNDICATE_FORMED",{id:ps.id, cardId:card.id, title:card.title, fromId:ps.fromId, members:members, jvGroupId:jvId});
  return null;
};
// 結算：先讓電腦補位，湊滿就成交；否則流標——機會回到發起人手上（重新給 BUY 決策）
E.settleSyndicate = function(S, why){
  var ps=S.pendingSyndicate; if(!ps) return;
  if(E.syndicateRemaining(ps)>1e-9) E.syndicatePollNPC(S,ps);
  var fromP=S.players[ps.fromId];
  S.pendingSyndicate=null;
  var rem=E.syndicateRemaining(ps);
  if(rem<=1e-9){
    var err=E.execSyndicate(S,ps);
    if(!err) return;
    E.ev("SYNDICATE_FAILED",{id:ps.id, cardId:ps.cardId, title:ps.title, fromId:ps.fromId, reason:err, remaining:rem});
  } else {
    E.ev("SYNDICATE_FAILED",{id:ps.id, cardId:ps.cardId, title:ps.title, fromId:ps.fromId, reason:"unfilled", remaining:rem,
      joined:Object.keys(ps.shares).length-1});
  }
  // 機會回到發起人手上：只在他還在內圈、還沒破產、且正是他的回合開始時才重新給決策
  if(fromP && !fromP.bankrupt && fromP.playerStage==="INNER" && S.activePlayerIdx===fromP.id && !S.over){
    E.pushDecision(S,fromP,{ kind:"BUY", cardId:ps.cardId, fromSyndicate:true });
  }
};

// V3：廣播借款輪詢電腦放款人——水位夠且利率達其動態下限的第一位 NPC 放款；全滅＝沒人肯借
E.p2pPollNPC = function(S, borrower, amt, rate, term){
  var rm=E.cfg(S,"p2pLenderReserveMult"); if(rm===undefined) rm=1.5;
  var minR=E.p2pMinRate(S,borrower);
  var npcs=S.players.filter(function(x){ return x.isNPC && x.id!==borrower.id && !x.bankrupt; });
  for(var i=0;i<npcs.length;i++){
    var cand=npcs[i], w=ns.content.personalityById[cand.npcPersonality].weights;
    if(cand.cash>=amt && cand.cash-amt >= w.cashReserveFloor*cand.derived.totalExpenses*rm
       && rate >= minR-1e-9){
      E.formP2P(S, cand, borrower, amt, rate, term);
      return true;
    }
  }
  E.ev("P2P_REJECTED",{lenderId:null, borrowerId:borrower.id, amount:amt, rate:rate,
    byId:null, minRate:minR, openNobody:true});
  return false;
};

// V4：廣播放款輪詢電腦借款人——只有「銀行額度已用罄」的 NPC 會接受民間資金
E.p2pPollNPCBorrowers = function(S, lender, amt, rate, term){
  var npcs=S.players.filter(function(x){ return x.isNPC && x.id!==lender.id && !x.bankrupt; });
  for(var i=0;i<npcs.length;i++){
    if(E.creditCapacity(S,npcs[i]) < 1 && lender.cash>=amt){
      E.formP2P(S, lender, npcs[i], amt, rate, term);
      return true;
    }
  }
  E.ev("P2P_REJECTED",{lenderId:lender.id, borrowerId:null, amount:amt, rate:rate,
    byId:null, minRate:0, openNobodyBorrow:true});
  return false;
};

E.formP2P = function(S, lender, borrower, amount, rate, term){
  amount=util.r2(amount); rate=E.rRate(rate);
  var pay=E.pmt(amount, rate, term);
  var lid=util.uid(S,"L");
  borrower.liabilities.push({ instanceId:lid, kind:"P2P", name:"民間借貸（"+lender.name+"）",
    principal:amount, annualRate:rate, isFloating:false, rateSpread:0,
    termMonths:term, monthlyPayment:pay, collateralAssetId:null,
    counterpartyId:lender.id, flags:{} });
  ledger.post(S,borrower,"民間借貸成立（放款人："+lender.name+"）",
    [{account:"LIABILITY",delta:amount,refId:lid,label:"民間借貸"},
     {account:"CASH",delta:amount,label:"借款撥入"},
     {account:"EXPENSE",delta:pay,refId:lid,label:"民間借貸月付"}],{eduTags:["debt"]});
  var aid=util.uid(S,"A");
  var interest0=util.r2(amount*rate/12);   // V3：利息屬被動收入——債權掛「當期利息」為月收入流
  lender.assets.push({ instanceId:aid, kind:"P2P_LOAN", name:"P2P 債權（"+borrower.name+"）",
    units:1, costBasis:amount, marketValue:amount, monthlyIncome:interest0,
    counterpartyId:borrower.id, p2pRef:lid, linkedLiabilityId:null, flags:{} });
  ledger.post(S,lender,"民間放款（借款人："+borrower.name+"）",
    [{account:"CASH",delta:-amount,label:"放款"},
     {account:"ASSET",delta:amount,refId:aid,label:"P2P 債權"},
     {account:"INCOME_PASSIVE",delta:interest0,refId:aid,label:"P2P 利息（月）"}],{eduTags:["trade","passive-income"]});
  E.ev("P2P_FORMED",{lenderId:lender.id, borrowerId:borrower.id,
    amount:amount, rate:rate, term:term, payment:pay});
  return lid;
};
// 每輪一期：借款人所有 P2P 依成立順序結算（座位序×負債序＝決定論）
E.p2pRoundEnd = function(S){
  S.players.forEach(function(b){
    if(b.bankrupt) return;
    b.liabilities.slice().forEach(function(l){
      if(l.kind!=="P2P") return;
      var lender=S.players[l.counterpartyId]; if(!lender) return;
      var interest=util.r2(l.principal*l.annualRate/12);
      var principalPortion=util.r2(l.monthlyPayment-interest);
      if(principalPortion<=0) principalPortion=util.r2(Math.min(l.principal,1));
      var closing = principalPortion >= l.principal-0.5;
      if(closing) principalPortion=l.principal;
      var pay=util.r2(principalPortion+interest);
      if(b.cash < pay){                                     // 違約一期：記次、傷信用、本期不轉
        l.flags.lateCount=(l.flags.lateCount||0)+1;
        if(b.creditFlags) b.creditFlags.cashWentNegative=true;
        E.ev("P2P_LATE",{lenderId:lender.id, borrowerId:b.id, payment:pay, cash:b.cash, lateCount:l.flags.lateCount});
        return;
      }
      var postB2=[{account:"CASH",delta:-pay,label:"期款（本金 "+util.money(principalPortion)+"＋利息 "+util.money(interest)+"）"},
         {account:"LIABILITY",delta:-principalPortion,refId:l.instanceId,label:"民間借貸攤還本金"}];
      if(closing) postB2.push({account:"EXPENSE",delta:-l.monthlyPayment,refId:l.instanceId,label:"民間借貸月付終止"});
      ledger.post(S,b,"P2P 期款（付 "+lender.name+"：本金 "+util.money(principalPortion)+"＋利息 "+util.money(interest)+"）",
        postB2,{eduTags:["cashflow"], detail:{interest:interest, principal:principalPortion}});
      var a=lender.assets.filter(function(x){return x.kind==="P2P_LOAN" && x.p2pRef===l.instanceId;})[0];
      var newInt = closing ? 0 : util.r2(util.r2(l.principal-principalPortion)*l.annualRate/12);
      var postL2=[{account:"CASH",delta:pay,label:"回收（本金 "+util.money(principalPortion)+"＋利息 "+util.money(interest)+"）"},
         {account:"ASSET",delta:-principalPortion,refId:a?a.instanceId:null,label:"債權本金回收"}];
      var incAdj = a ? util.r2(newInt-(a.monthlyIncome||0)) : 0;
      if(incAdj) postL2.push({account:"INCOME_PASSIVE",delta:incAdj,refId:a.instanceId,label:closing?"P2P 利息終止":"P2P 利息隨本金遞減"});
      ledger.post(S,lender,"P2P 期款入帳（收 "+b.name+"：本金 "+util.money(principalPortion)+"＋利息 "+util.money(interest)+"）",
        postL2,{eduTags:["cashflow"], detail:{interest:interest, principal:principalPortion}});
      if(a){ a.marketValue=util.r2(a.marketValue-principalPortion); a.monthlyIncome=newInt; }
      l.principal=util.r2(l.principal-principalPortion);
      E.ev("P2P_PAYMENT",{lenderId:lender.id, borrowerId:b.id, payment:pay,
        interest:interest, principalPortion:principalPortion,
        remaining:l.principal, closed:closing});
      if(closing || l.principal<=0.01){
        b.liabilities=b.liabilities.filter(function(x){return x.instanceId!==l.instanceId;});
        if(a) lender.assets=lender.assets.filter(function(x){return x.instanceId!==a.instanceId;});
      }
    });
  });
};
// 破產清算（§4 順位末端）：擔保債與銀行債依既有流程；P2P 以「剩餘現金按本金比例」受償，
// 不足部分放款人打銷（ASSET 減損）；借款人債務同步消滅。
E.p2pLiquidate = function(S, b){
  var debts=b.liabilities.filter(function(l){return l.kind==="P2P";});
  if(!debts.length) return;
  var total=0; debts.forEach(function(l){ total+=l.principal; });
  var avail=util.r2(Math.max(0, Math.min(b.cash, total)));
  var paidAcc=0;
  debts.forEach(function(l,i){
    var lender=S.players[l.counterpartyId];
    var recover = (i===debts.length-1) ? util.r2(avail-paidAcc)
                : util.r2(avail*l.principal/Math.max(0.01,total));
    if(recover>l.principal) recover=l.principal;
    paidAcc=util.r2(paidAcc+recover);
    var lost=util.r2(l.principal-recover);
    var postB=[{account:"LIABILITY",delta:-l.principal,refId:l.instanceId,label:"破產清算：民間借貸消滅"},
               {account:"EXPENSE",delta:-l.monthlyPayment,refId:l.instanceId,label:"民間借貸月付終止"}];
    if(recover>0) postB.unshift({account:"CASH",delta:-recover,label:"破產清算：按比例清償"});
    ledger.post(S,b,"破產清算：P2P 債務（"+(lender?lender.name:"?")+"）",postB,{eduTags:["cashflow"]});
    if(lender){
      var a=lender.assets.filter(function(x){return x.kind==="P2P_LOAN" && x.p2pRef===l.instanceId;})[0];
      var postL=[{account:"ASSET",delta:-l.principal,refId:a?a.instanceId:null,label:"債權打銷"}];
      if(a && (a.monthlyIncome||0)) postL.push({account:"INCOME_PASSIVE",delta:-a.monthlyIncome,refId:a.instanceId,label:"P2P 利息終止"});
      if(recover>0) postL.unshift({account:"CASH",delta:recover,label:"破產受償"});
      ledger.post(S,lender,"借款人破產：P2P 債權處置（"+b.name+"）",postL,{eduTags:["cashflow"]});
      if(a) lender.assets=lender.assets.filter(function(x){return x.instanceId!==a.instanceId;});
      E.ev("P2P_DEFAULT",{lenderId:lender.id, borrowerId:b.id, lost:lost, recovered:recover});
    }
    b.liabilities=b.liabilities.filter(function(x){return x.instanceId!==l.instanceId;});
  });
};

E.finishByRanking = function(S, reason){
  S.over=true; S.overReason=reason||"MAX_TURNS";
  var rank=S.players.filter(function(p){return !p.bankrupt;}).sort(function(a,b){
    if(a.playerStage!==b.playerStage) return a.playerStage==="OUTER"?-1:1;
    if(a.playerStage==="OUTER" && b.playerStage==="OUTER") return b.dreamProgress-a.dreamProgress;
    return b.derived.netWorth-a.derived.netWorth; });
  S.winner = rank.length?rank[0].id:null;
  E.ev("GAME_OVER",{reason:reason||"MAX_TURNS", playerId:S.winner});
};

/* ==================== S21/S22：獨立董監事與偽裝投資機制 ====================
   單位提醒：全遊戲金額以「千元」計（月薪 30–42）。S21 原版把車馬費寫成 8000–25000、
   賠償 40000–200000，是把千元當成元；S22 全部換回遊戲量級。
   公司表放在引擎，介面與 NPC 都從這裡讀，數字只維護一份。 */
/* S27 三項調整（Brian 2026-09-04 裁示）：
   1. 任期 6 → 12 輪。一輪＝一個月，原本 6 輪只有半年；現實的獨立董事一任三年，
      12 輪（一年）是在「擬真」與「一局的長度」之間取的折衷。
   2. 爆雷改機率制。原本 B／C 是「註定會爆、只有時間隨機」，B 之所以有約三分之一躲得掉，
      純粹是爆雷時間可能落在 6 輪任期之外——那是任期長度的副作用，不是設計。
      改成就任時先擲一次 crashChance 決定「這一任會不會爆」，會爆的再擲時間，
      沒爆的局玩家真的賺得到，風險溢酬才成立。
   3. A 的車馬費 8 → 5：任期加倍，總額從 48 變 60，維持「最穩但最少」的定位。 */
E.DIRECTOR_COMPANIES = {
  A: { title:"大型績優權值股", income:5,  term:12, hasInsurance:true,  crashChance:0,   crashMin:0, crashMax:0, fineAmount:0,
       risk:"低", note:"治理健全、有 D&O 責任險；車馬費最少，但一年任期可以安穩領完。" },
  B: { title:"成長型科技新創板", income:15, term:12, hasInsurance:true,  crashChance:0.5, crashMin:4, crashMax:10, fineAmount:120,
       risk:"中", note:"有 D&O 責任險（承擔八成）；成長故事漂亮，但帳有沒有做過，任期內未必看得出來。" },
  C: { title:"爭議家族小型股", income:25, term:12, hasInsurance:false, crashChance:0.8, crashMin:3, crashMax:8,  fineAmount:200,
       risk:"高", note:"沒有責任險；車馬費最高，關係人交易也最多——弊案幾乎是時間問題。" }
};
/* 能在爆雷前看出假帳的技能（S21 用 SKL_BOOK／SKL_CPA_AUDIT；法律線只擋賠償，看不出帳）。

   S33 分級：原本是 `SKL_CPA_AUDIT || SKL_BOOK`，而 SKL_BOOK 正是 SKL_CPA_AUDIT 的先修——
   等於任何報得了名的人早就有全部能力，那張 45 塊、學 3 輪的高階卡獨佔價值是零。
   改成兩級：記帳看得懂帳，但查弊案是另一回事，只有一定機率看得出來（directorAuditWarnPctBasic）；
   高階審計是專業查核，必中。這樣先修仍然有用，高階才有理由存在。 */
E.directorAuditLevel = function(p){
  if(E.hasSkill(p,"SKL_CPA_AUDIT")) return 2;   // 專業查核：必定預警
  if(E.hasSkill(p,"SKL_BOOK"))      return 1;   // 看得懂帳：機率預警
  return 0;
};
E.directorAuditSkill = function(p){ return E.directorAuditLevel(p) > 0; };
E.directorLegalShield = function(p){ return E.hasSkill(p,"SKL_GOV_LEGAL"); };
/* 高風險席次「接得下」的判定。S33 一度用它把 B／C 兩個席次鎖住，但實測後拿掉了：
   鎖住之後電腦玩家全部退回 A，300 局裡爆雷 0 次、審計預警 0 次——整條弊案劇情死掉，
   而且「不懂帳卻去當獨董、最後賠 200」正是這張卡要教的事，鎖住等於把課本身刪掉。
   函式保留成一個可查詢的能力判定（介面用來寫提示），但不再當成擋牌。 */
E.directorHighRiskOk = function(p){
  return E.directorAuditLevel(p) >= 2 || E.directorLegalShield(p);
};

E.tickDirectorship = function(S, p){
  if(!p.directorship || p.bankrupt) return;
  var d = p.directorship;
  var crashSoon = d.crashTurn!==null && d.crashTurn!==undefined && !d.resigned;

  // 1) 弊案引爆（先於車馬費：爆雷那一輪沒有錢領）
  if(crashSoon && S.turnNumber >= d.crashTurn && d.termTurnsLeft > 0){
    var fine = d.fineAmount||0;
    var shield = E.directorLegalShield(p);
    var own = shield ? 0 : (d.hasInsurance ? util.r2(fine*0.2) : fine);
    var why = shield ? "（合規治理專業：舉證已盡善良管理人注意義務，免除連帶賠償）"
            : d.hasInsurance ? "（D&O 責任險承擔八成）" : "（無責任險，全額自負）";
    var imp = E.captureImpact(S,p,function(){
      if(own>0) ledger.post(S,p,"獨立董事連帶賠償："+d.title+why,
        [{ account:"CASH", delta:-own, label:"弊案連帶民事賠償" }], { eduTags:["directorship","liability"] });
    });
    var skip = shield ? 1 : (d.hasInsurance ? 1 : 2);
    p.skippedTurns = (p.skippedTurns||0) + skip; p.skipReason = "應訴假帳掏空訴訟";
    p.stats.skillJoy = (p.stats.skillJoy||0) - (own>0 ? (d.hasInsurance ? 2 : 5) : 1);
    p.stats.directorCrashed = (p.stats.directorCrashed||0) + 1;
    E.ev("DIRECTOR_CRASH", { playerId:p.id, company:d.title, fine:own, insured:d.hasInsurance, shield:shield, skip:skip });
    E.pushDecision(S,p,{ kind:"ACK", title:"💥 弊案爆發："+d.title,
      text:"檢調搜索公司，董事會全員列為被告。"+why+" 你將停走 "+skip+" 輪應訴。", impact:imp });
    p.directorship = null;
    if(p.cash<0) E.enterBankruptcy(S,p);
    return;
  }

  // 2) 已請辭：等到原本會爆的那一輪，揭曉「你躲過了」
  if(d.resigned){
    if(d.crashTurn===null || S.turnNumber >= d.crashTurn){   // crashTurn 為 null 時立即結案（請辭只由審計警訊觸發，警訊只在排定爆雷的局出現）
      E.ev("DIRECTOR_CRASH_AVOIDED", { playerId:p.id, company:d.title });
      E.pushDecision(S,p,{ kind:"ACK", title:"🚢 你跳船了："+d.title+" 弊案爆發",
        text:"前董事會成員全數遭起訴，只有及時辭任、留下查核紀錄的你全身而退。" });
      p.directorship = null;
    }
    return;
  }

  // 3) 車馬費（每輪一次）
  d.termTurnsLeft -= 1;
  ledger.post(S,p,"獨立董事車馬費："+d.title,
    [{ account:"CASH", delta:d.monthlyIncome, label:"車馬費收入" }], { eduTags:["directorship","cashflow"] });

  // 4) 爆雷前一輪的審計預警——只有看得懂帳的人收得到
  if(crashSoon && S.turnNumber === d.crashTurn-1 && !d.warned && d.termTurnsLeft > 0){
    var lvl = E.directorAuditLevel(p);
    var basicPct = E.cfg(S,"directorAuditWarnPctBasic"); if(basicPct===undefined) basicPct = 0.4;
    var willWarn = (lvl>=2) || (lvl===1 && (d.auditRoll!==undefined ? d.auditRoll : 0) < basicPct);
    if(willWarn){
      d.warned = true;
      E.pushDecision(S,p,{ kind:"RESIGN_DIRECTORSHIP", company:d.title,
        title:"⚠️ 審計警訊："+d.title+" 的帳不對",
        text:"你在查核本季財務報告時，發現異常關係人鉅額借貸且憑證不全——假帳弊案就在眼前。是否立即請辭？" });
      E.ev("DIRECTOR_AUDIT_WARNING", { playerId:p.id, company:d.title });
    }
  }

  // 5) 任期屆滿順利卸任
  if(d.termTurnsLeft <= 0){
    var mx = S.config.virtueMaxLevel||3;
    p.virtues = p.virtues||{};
    if((p.virtues.PRUDENCE||0) < mx){ p.virtues.PRUDENCE=(p.virtues.PRUDENCE||0)+1;
      E.ev("VIRTUE_UP",{playerId:p.id, axis:"PRUDENCE", level:p.virtues.PRUDENCE}); }
    p.stats.skillJoy = (p.stats.skillJoy||0) + 2;
    p.stats.directorCompleted = (p.stats.directorCompleted||0) + 1;
    E.ev("DIRECTOR_TERM_COMPLETE", { playerId:p.id, company:d.title });
    E.pushDecision(S,p,{ kind:"ACK", title:"🎓 獨立董事任期圓滿："+d.title,
      text:(d.termTurns||12)+" 輪（一年）任期平安落幕，聲譽與人脈都留下了（謹慎修養 +1、幸福感 +2）。" });
    p.directorship = null;
  }
};

/* 偽裝成事業的吸金盤：買進時已照一般事業入帳（配息走 INCOME_PASSIVE），
   到期那一輪在自己的回合開始整筆歸零——用 sellAsset(mult 0) 走正規出售路徑，
   資產分錄與 marketValue 才對得起來（鐵律三），連帶的信貸也照規矩留下。 */
E.tickScamInvestments = function(S, p){
  if(!p.scamInvestments || !p.scamInvestments.length || p.bankrupt) return;
  var keep=[];
  p.scamInvestments.forEach(function(inv){
    if(S.turnNumber < inv.crashTurn){ keep.push(inv); return; }
    var a = p.assets.filter(function(x){ return x.instanceId===inv.instanceId; })[0];
    if(!a) return;                                    // 已經自己賣掉了——逃過一劫
    var card = ns.content.byId[inv.cardId], pl = (card&&card.payload)||{};
    var fee = Math.min(p.cash, pl.scamLegalFee!==undefined ? pl.scamLegalFee : 5);
    var imp = E.captureImpact(S,p,function(){
      E.sellAsset(S,p,a,0,{ summary:"資金鏈斷裂："+inv.title+" 歸零（負責人潛逃）",
        evName:"SCAM_INVESTMENT_CRASH", eduTags:["scam","exit"] });
      if(fee>0) ledger.post(S,p,"追討訴訟費："+inv.title,
        [{ account:"CASH", delta:-fee, label:"集體訴訟與律師費" }], { eduTags:["scam"] });
    });
    p.stats.skillJoy = (p.stats.skillJoy||0) - 3;
    p.stats.scamCrashed = (p.stats.scamCrashed||0) + 1;
    E.pushDecision(S,p,{ kind:"ACK", cardId:inv.cardId,
      title:"💥 爆雷："+inv.title, text:"檢調查出是後金補前金的資金盤，負責人已出境。你的本金整筆歸零。", impact:imp });
    if(p.cash<0) E.enterBankruptcy(S,p);
  });
  p.scamInvestments = keep;
};

})(ns);

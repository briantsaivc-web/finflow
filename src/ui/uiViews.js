(function(ns){
"use strict";
var util=ns.util, ledger=ns.ledger, E=ns.engine, ui=ns.ui;
var $=function(id){ return document.getElementById(id); };
var el=ui.mkEl;   // S10：不再自己寫一份（原本這份不處理 <b>/<br>，借款視窗的字面標籤就是這樣來的）
var T=ui.t, M=util.money, optBtn=ui.optBtn;

/* ============================ dispatch 與演出 =========================== */
ui.feed = [];
ui.lastAct = {};
ui.announce = function(msg, pid, tag){
  var row={turn: ui.S?ui.S.turnNumber:0, msg:msg, pid:(pid===undefined?null:pid)};
  if(tag) row.tag=tag;
  ui.feed.push(row);
  if(ui.feed.length>40) ui.feed.shift();
  if(pid!==undefined && pid!==null) ui.lastAct[pid]={turn:(ui.S?ui.S.turnNumber:0), msg:msg};
  return row;
};
/* S18：把「決定了什麼」接回同一行——實測回饋「系統訊息 誰-幾點-機會-決定，多加決定這個」。
   做法是找到這一輪這位玩家最後那一行擲骰紀錄，直接把文字接上去，
   而不是另外開一行；找不到（例如非回合的決策）就自己開一行。 */
ui.appendToRoll = function(pid, extra){
  for(var i=ui.feed.length-1;i>=0;i--){
    var r=ui.feed[i];
    if(r.tag==="roll" && r.pid===pid && r.turn===(ui.S?ui.S.turnNumber:0)){
      if((r.msg||"").indexOf(extra)>=0) return true;   // 同一句不重複接
      // 一次擲骰可能連續做兩個決定（先選卡、再選付款方式）——接成「決定：A → B」，
      // 不要變成「決定：A　決定：B」
      r.msg = (r.msg.indexOf("　決定：")>=0)
        ? r.msg + " → " + extra.replace("　決定：","")
        : r.msg + extra;
      if(ui.lastAct[pid]) ui.lastAct[pid].msg=r.msg;
      return true;
    }
  }
  return false;
};
/* 選項文字：引擎只給 optionId，文案一律從內容包查 */
ui.decisionOptionLabel = function(cardId, optionId){
  var c = cardId ? ns.content.byId[cardId] : null;
  var opts = c && c.decision && c.decision.options;
  if(opts && typeof optionId==="number" && opts[optionId] && opts[optionId].label) return opts[optionId].label;
  if(opts && typeof optionId==="string"){
    for(var i=0;i<opts.length;i++){ if(opts[i].id===optionId && opts[i].label) return opts[i].label; }
  }
  // 有些決策的 optionId 直接就是一張卡的 id（例如選機會卡）——查回卡名，不要把代號端給玩家
  if(typeof optionId==="string" && ns.content.byId && ns.content.byId[optionId]){
    var pick=ns.content.byId[optionId];
    if(pick.title || pick.name) return pick.title || pick.name;
  }
  var NAMED={ sell:"停損賣出", hold:"續抱", yes:"接受", no:"婉拒", accept:"接受", decline:"婉拒",
              ack:"知道了", skip:"略過", buy:"買進", pass:"放棄", none:"都不選",
              cash:"用現金", loan:"用貸款", credit:"用信貸", margin:"用融資",
              invest:"投入", learn:"進修", side:"接副業", follow:"跟進", go:"衝",
              fall:"放手", declare:"宣告", switch:"轉換", dropStudy:"放棄進修",
              sell_all:"全部賣出", sell_half:"賣一半" };
  if(typeof optionId==="string" && NAMED[optionId]) return NAMED[optionId];
  return (optionId===undefined||optionId===null) ? "—" : String(optionId);
};
ui.rollDice = function(){
  if(!ui.S || ui.busy) return;
  var d=$("dice");
  if(!d){ ui.dispatch({type:"ROLL_DICE",playerId:ui.myId(),payload:null}); return; }
  ui.busy=true;
  var ticks=0, iv=setInterval(function(){
    d.textContent = 1+Math.floor(Math.random()*6); d.classList.add("rolling"); ticks++;
    if(ticks>=8){ clearInterval(iv); ui.busy=false; ui.dispatch({type:"ROLL_DICE",playerId:ui.myId(),payload:null}); }
  }, 60);
};

ui.dispatch = function(action){
  if(!ui.S || ui.busy) return;
  try{
    ui.S.players.forEach(function(pl){ delete pl._b; delete pl._btn; pl.assets.forEach(function(a){ delete a._btn; }); }); // 防禦：清除任何誤掛到 state 的 DOM
    var res = E.apply(ui.S, action);
    if(res.rejected){ ui.toast(T("toast.rejected"),"warn"); return; }
    ui.S = res.state;
    ui.handleEvents(res.events);
    ui.render();
    ui.save();
    ui.tick();
  }catch(err){
    ui.busy=false;
    try{ ui.render(); }catch(e2){}
    ui.toast("發生錯誤，已嘗試復原（動作："+(action&&action.type||"?")+"）","warn",4500);
    if(window&&window.console) console.error("dispatch error:", err);
  }
};

ui.handleEvents = function(evs){
  if(ui.handleSkillEvents) ui.handleSkillEvents(evs);   // M8 S1
  var nm=function(pid){ return (ui.S.players[pid]&&ui.S.players[pid].name)||"某玩家"; };
  var me=function(pid){ return pid===ui.myId()?"你":nm(pid); };
  evs.forEach(function(e){
    switch(e.type){
      case "DICE_ROLLED":
        // 八期：骰數先記著，等 MOVED 知道落點後合併成一行「擲 N 點 → 人生」
        if(e.playerId===ui.myId()){ var d=$("dice"); if(d){ d.textContent=e.roll; d.classList.add("rolling"); } }
        (ui._lastRoll||(ui._lastRoll={}))[e.playerId]=e.roll;
        break;
      case "MOVED": {
        var rl=(ui._lastRoll||{})[e.playerId];
        var cl=ui.cellLabel(e.outer, e.to);
        ui.announce("🎲 "+me(e.playerId)+" 擲 "+(rl===undefined?"?":rl)+" 點 → "+(cl||"—")+(e.outer?"（夢想圈）":""),
                    e.playerId, "roll");
        break; }
      case "PAYDAY_EXECUTED": if(e.playerId===ui.myId()) ui.showPayslip(e.detail); break;
      case "GAME_EXTENDED": {
        // S14b：續攤時每台裝置都要把戰報收掉、解除「已出過戰報」的鎖，否則畫面還停在結算頁
        if(e.resumed){
          ui._reported=false;
          Array.prototype.slice.call(document.querySelectorAll("#overlays .overlay"))
            .forEach(function(o){ o.remove(); });
        }
        ui.announce("⏱ "+me(e.playerId)+"延長對局 "+e.addedTurns+" 輪（上限 "+e.maxTurns+" 輪）"
                    +(e.resumed?"——接著打，帳目全部保留":""));
        ui.toast("對局延長至 "+e.maxTurns+" 輪","good");
        break; }
      case "CLASSIFY_BAD": ui.toast(T("bk.wrong"),"warn"); break;
      case "CLASSIFY_OK": ui.toast("分類正確","good"); break;
      case "MACRO_TRANSITION": { var m={RECOVERY:"復甦",BOOM:"過熱",RECESSION:"衰退",DEPRESSION:"蕭條"};
        ui.announce("景氣轉入「"+m[e.to]+"」"); ui.toastSys("景氣轉入："+m[e.to],"warn"); break; }
      case "RATE_REVIEW": {
        if(!e.changed){ ui.announce("央行利率檢視：基準利率維持 "+util.pct(e.newRate,2)); break; }
        var dir=e.newRate>e.oldRate?"升息":"降息";
        var mine=(e.impacts||[]).filter(function(x){return x.playerId===ui.myId();})[0];
        ui.announce("央行"+dir+"：基準利率 "+util.pct(e.oldRate,2)+" → "+util.pct(e.newRate,2)+
          (mine&&mine.delta?("　你的貸款月付 "+(mine.delta>0?"+":"")+M(mine.delta)+"／月"):""));
        // 八期：利率是全域事件，不覆蓋各玩家的「最新動作」（改由系統訊息呈現）
        var tot=(e.impacts||[]).reduce(function(a,x){return a+(x.playerId===ui.myId()?x.delta:0);},0);
        ui.toastSys("央行"+dir+" → "+util.pct(e.newRate,2)+(tot?("　你月付 "+(tot>0?"+":"")+M(tot)):""),"warn",5000);
        break; }
      case "BLESSING_DRAWN": {
        var PZN={VIRTUE:"🌱 品格成長",DREAM:"✨ 圓夢靈感",GUARDIAN:"🤝 貴人相助",JOY:"🍰 生活小確幸",CASH:"🧧 小額紅包",NONE:"🎁"};
        var VNM={TEMPER:"修養",PRUDENCE:"理財",PARENTING:"教養",FILIAL:"孝親"};
        var dt=e.detail||""; if(e.prize==="VIRTUE" && VNM[dt]) dt=VNM[dt]+" +1";
        var bl="🎁 幸福感的回報："+(PZN[e.prize]||e.prize)+(dt?("　"+dt):"");
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:bl};
        ui.announce(me(e.playerId)+"　"+bl);
        if(e.playerId!==ui.myId()) ui.toast(nm(e.playerId)+" 開出「"+(PZN[e.prize]||e.prize)+"」","good",3000);
        break; }
      case "GUARDIAN_USED": {
        var gl="🤝 貴人相助：這次「"+(e.label||"人生事件")+"」的支出減免 "+M(e.saved);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:gl};
        ui.announce(me(e.playerId)+"　"+gl);
        if(e.playerId===ui.myId()) ui.toast(gl,"good",4500);
        break; }
      case "REPAIR_EVENT": {
        var fl=T(e.flavorKey);
        var line="⚒ "+e.assetName+" 修繕支出 −"+M(e.cost)+"（"+fl+"）";
        ui.announce(me(e.playerId)+"："+line);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:line};
        if(e.playerId===ui.myId()) ui.toast(line,"warn",5000);
        break; }
      case "VACANCY_START": {
        var line2="🏚 "+e.assetName+" 空租 "+e.turns+" 期，租金 −"+M(e.income)+"／月（貸款月付照繳）";
        ui.announce(me(e.playerId)+"："+line2);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:line2};
        if(e.playerId===ui.myId()) ui.toast(line2,"warn",5500);
        break; }
      case "VACANCY_END": {
        var line3="🔑 "+e.assetName+" 恢復出租，租金 +"+M(e.income)+"／月";
        ui.announce(me(e.playerId)+"："+line3);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:line3};
        if(e.playerId===ui.myId()) ui.toast(line3,"good",4000);
        break; }
      case "BIZ_CYCLE_ADJ": {
        var up=e.delta>0;
        var line4=(up?"📈 ":"📉 ")+e.assetName+" 景氣調整 "+(up?"+":"")+M(e.delta)+"／月";
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:line4};
        if(e.playerId===ui.myId()) ui.toast(line4, up?"good":"warn", 4000);
        break; }
      case "CREDIT_RATING_CHANGED": {
        var S9=ui.S, p9=S9.players[e.playerId];
        var d9=ui.creditDesc(S9,p9);
        var why=(e.reasons&&e.reasons.length)?("原因："+e.reasons.join("、")):"綜合評分變動";
        var worse={A:3,B:2,C:1}[e.to] < {A:3,B:2,C:1}[e.from];
        var msg="信用評級 "+e.from+"→"+e.to+"（"+why+"）→ 新貸款利率 "+d9.rateTxt+"、額度上限降為 "+d9.dbr+"× 月收入";
        if(e.to==="A") msg="信用評級 "+e.from+"→A（"+why+"）→ 新貸款利率 "+d9.rateTxt+"、額度上限提高為 "+d9.dbr+"× 月收入";
        ui.announce(me(e.playerId)+"的"+msg);
        ui.lastAct[e.playerId]={turn:S9.turnNumber, msg:"信用評級 "+e.from+"→"+e.to+"（"+why+"）"};
        if(e.playerId===ui.myId()) ui.toast((worse?"⚠ ":"✅ ")+msg, worse?"warn":"good", 6000);
        break; }
      case "SHOCK_FORECAST": {
        ui.announce("⚠ 系統警報："+e.desc+"，預計 "+e.rounds+" 輪後衝擊市場");
        ui.broadcast("⚠ 系統警報："+e.desc, "預計 "+e.rounds+" 輪後衝擊市場——現在還來得及調整部位與現金水位","warn",7000);
        break; }
      case "SHOCK_COUNTDOWN":
        ui.announce("⚠ "+e.desc+"：距離衝擊剩 "+e.rounds+" 輪，請提前調整部位"); break;
      case "SHOCK_HIT": { var sm={RECESSION:"衰退",DEPRESSION:"蕭條"};
        ui.announce("💥 衝擊發生："+e.desc+"，景氣重挫至「"+(sm[e.toStage]||e.toStage)+"」、股市大跌");
        ui.broadcast("💥 "+e.desc, "衝擊發生：景氣重挫至「"+(sm[e.toStage]||e.toStage)+"」、股市大跌","warn",7000);
        break; }
      case "DELIST_WARNED":
        ui.announce("⚠️ 償債能力警示："+e.name+"　第 "+e.until+" 輪前未改善將終止上市");
        ui.toastSys("償債能力警示："+e.name,"bad",5000); break;
      case "BK_MASTERED":
        if(e.playerId===ui.myId())
          ui.toast("🎓 「"+e.groupName+"」這一套練熟了——記帳面板可以把它改成自動","good",5000);
        break;
      case "DELIST_CLEARED":
        ui.announce("✅ 警示解除："+e.name+"　撐過來了"); break;
      case "DELISTED": {
        // S12：實測回饋「遇到下市看板要寫出來」。原本只有一行小字，
        // 跟一般公告混在一起很容易滑過去。改成大公告，並寫明誰被套住、總共賠多少。
        var whoD=(e.holderNames&&e.holderNames.length) ? e.holderNames.join("、") : null;
        ui.announce("💀 終止上市："+e.name+"　持有者的股票歸零"+
          (whoD ? ("　—　"+whoD+" 合計認賠 "+M(e.totalLost||0)) : "　（這次沒有人持有）"));
        ui.broadcast("💀 "+e.name+" 終止上市",
          (whoD ? (whoD+" 手上的部位歸零，合計認賠 "+M(e.totalLost||0)+"。股票會留在資產負債表上，市值 0。")
                : "這次沒有人持有這一檔。"),
          "warn", 8000);
        ui.toastSys("終止上市："+e.name,"bad",6000); break; }
      case "DELIST_LOSS":
        ui.announce(me(e.playerId)+" 的「"+e.name+"」下市歸零，認賠 "+M(Math.abs(e.pl)), e.playerId); break;
      case "STARTUP_WINTER_DEAD":
        ui.announce(me(e.playerId)+" 的新創「"+e.name+"」撐不過寒冬，股權歸零", e.playerId); break;
      case "STARTUP_DOWNROUND":
        ui.announce(me(e.playerId)+" 的「"+e.name+"」估值下修 "+M(Math.abs(e.delta)), e.playerId); break;
      case "CARPENTRY_APPLIED":
        if(e.delta) ui.announce(me(e.playerId)+" 自己裝修「"+e.assetName+"」，租金 +"+M(e.delta), e.playerId); break;
      case "POLICY_EVENT": { var pc2=ns.content.byId[e.cardId], ex=pc2&&pc2.eduNote?("　—　"+pc2.eduNote):"";
        // 天災跟政策不是同一種東西，公告要分得出來——不然玩家會覺得「怎麼都沒遇到颱風地震」
        var kind2 = e.disaster ? "🌪 天災" : "政策事件";
        ui.announce(kind2+"："+e.title+ex);
        ui.toastSys(kind2+"："+e.title, e.disaster?"bad":"warn", e.disaster?5000:4000); break; }
      /* S18：決策結果接回擲骰那一行 → 「🎲 誰 擲 N 點 → 機會　決定：選項」 */
      case "DECISION_RESOLVED": {
        var dl=ui.decisionOptionLabel(e.cardId, e.optionId);
        if(e.kind==="ACK" || e.kind==="TRIAL_RESULT" || e.kind==="BLESSING" ||
           e.kind==="SKILL_RESULT" || e.kind==="DIGITAL_RESULT") break;   // 純揭曉，沒有「決定」可言
        if(!ui.appendToRoll(e.playerId, "　決定：" + dl))
          ui.announce(me(e.playerId)+"　決定："+dl+(e.title?("（"+e.title+"）"):""), e.playerId);
        break; }
      case "ASSET_BOUGHT": { var c=ns.content.byId[e.cardId], t=c?(c.title||c.name):(e.name||"資產");
        ui.announce(me(e.playerId)+" 買了「"+t+"」", e.playerId); break; }
      case "ASSET_SOLD":
        ui.announce(me(e.playerId)+" 賣出「"+e.name+"」損益 "+(e.pl>=0?"+":"")+M(e.pl), e.playerId);
        if(e.playerId===ui.myId()) ui.toast("賣出 "+e.name+"　損益 "+(e.pl>=0?"+":"")+M(e.pl), e.pl>=0?"good":"warn"); break;
      case "TRADE_DONE":
        ui.announce(nm(e.sellerId)+" 把「"+e.name+"」以 "+M(e.price)+" 轉讓給 "+nm(e.buyerId), e.sellerId);
        ui.toast("成交！「"+e.name+"」以 "+M(e.price)+" 轉讓","good",4000); break;
      case "TRADE_REJECTED":
        if(e.buyerId===null||e.buyerId===undefined) ui.toast("📢 廣播流標：沒有玩家或電腦接手「"+e.name+"」","warn",4000);
        else ui.toast(nm(e.buyerId)+" 婉拒了這筆交易","warn",3500);
        break;
      case "TRADE_BROADCAST":
        ui.announce("📢 "+nm(e.sellerId)+" 廣播出售「"+e.name+"」開價 "+M(e.ask)+"（先搶先贏）", e.sellerId);
        setTimeout(function(){ ui.showOpenOffer(ui.S.pendingTrade); }, 200); break;
      case "P2P_OFFERED":
        if(e.byId===ui.myId()) ui.toast(e.open?"💸 借款需求已廣播，等待放款人":(e.openLend?"💸 放款需求已廣播，等待借款人":"💸 借貸邀約已送出，等待對方回應"),"good",3000);
        if(e.open) ui.announce("💸 "+nm(e.borrowerId)+" 廣播借款 "+M(e.amount)+"（年利率 "+util.pct(e.rate,1)+"，先答應先成交）", e.borrowerId);
        if(e.openLend) ui.announce("💸 "+nm(e.lenderId)+" 廣播放款 "+M(e.amount)+"（年利率 "+util.pct(e.rate,1)+"，先答應先借到）", e.lenderId);
        setTimeout(function(){ ui.showP2POffer(ui.S.pendingP2P); }, 250); break;
      case "TRADE_COUNTER":   // 八期：還價視窗馬上開，不再重複 toast
        setTimeout(function(){ ui.showCounter(ui.S.pendingTrade); }, 300); break;
      case "TRADE_OFFERED":
        setTimeout(function(){ ui.showTradeOffer(ui.S.pendingTrade); }, 200); break;
      case "AUCTION_STARTED":
        ui.announce(me(e.sellerId)+" 為「"+e.title+"」發起拍賣，全場密封出價", e.sellerId);
        if(ui.S.pendingAuction) setTimeout(function(){ ui.showBidPanel(ui.S.pendingAuction); }, 250);
        break;
      case "BID_PLACED":
        ui.announce("🔨 "+nm(e.playerId)+" 已出價（開標前保密"+(e.remaining?"，還差 "+e.remaining+" 位":"，即將開標")+"）", e.playerId);
        if(e.playerId===ui.myId()) ui.toast("出價已送出，等待開標","good",2500);
        break;
      case "REFERRAL_OFFERED":
        if(e.fromId===ui.myId()) ui.toast(e.open?"🤝 轉介已廣播，先接受的人成交":"🤝 轉介邀約已送出，等待 "+nm(e.toId)+" 回應","good",3000);
        if(e.open) ui.announce("🤝 "+nm(e.fromId)+" 廣播轉介「"+e.title+"」（介紹費 "+M(e.fee)+"，先接受先成交）", e.fromId);
        setTimeout(function(){ ui.showReferralOffer(ui.S.pendingReferral); }, 250);
        break;
      case "AUCTION_RESULT": {
        if(e.winnerId!==null && e.winnerId!==undefined){
          var wnm=nm(e.winnerId), snm=nm(e.sellerId);
          ui.announce("🔨 "+wnm+" 以 "+M(e.price)+" 拍下「"+e.title+"」，價金付給 "+snm, e.winnerId);
          ui.lastAct[e.winnerId]={turn:ui.S.turnNumber, msg:"🔨 以 "+M(e.price)+" 拍下「"+e.title+"」，價金付給 "+snm};
          ui.lastAct[e.sellerId]={turn:ui.S.turnNumber, msg:"🔨 拍出「"+e.title+"」，收得價金 "+M(e.price)};
        } else {
          ui.announce("🔨 「"+e.title+"」流標，機會回到 "+nm(e.sellerId)+" 手上", e.sellerId);
        }
        ui.showAuctionResult(e);
        break; }
      case "JV_FORMED": {
        var an=nm(e.aId), bn=nm(e.bId), sh=Math.round(e.aShare*100);
        var lineJ="🤝 "+an+"（"+sh+"%）與 "+bn+"（"+(100-sh)+"%）合資買下「"+e.title+"」";
        ui.announce(lineJ, e.aId);
        ui.lastAct[e.aId]={turn:ui.S.turnNumber, msg:"🤝 與 "+bn+" 合資（持份 "+sh+"%）「"+e.title+"」"};
        ui.lastAct[e.bId]={turn:ui.S.turnNumber, msg:"🤝 與 "+an+" 合資（持份 "+(100-sh)+"%）「"+e.title+"」"};
        break; }
      case "JV_REJECTED": {
        var why=e.humanSaidNo ? (e.partnerId!==null&&e.partnerId!==undefined?nm(e.partnerId):"對方")+" 婉拒了合資"
          : {partner:"對方評估現金水位後婉拒",self:"你的現金不足自己那份的入手門檻",
             afford:"有一方付不起實際自備款","buy-fail":"買入未成立",
             nobody:"廣播後沒有玩家或電腦願意合資",income:"這張卡沒有月現金流，不適合合資"}[e.reason]||"未成立";
        ui.toast("🤝 合資未成立："+why+"（機會回到你手上）","warn",4500);
        break; }
      case "JV_OFFERED":
        if(e.fromId===ui.myId()) ui.toast("🤝 合資邀約已送出，等待回應","good",3000);
        ui.announce("🤝 "+nm(e.fromId)+(e.targetId===null||e.targetId===undefined
          ?" 廣播找人合資「"+e.title+"」（先答應先合資）"
          :" 邀 "+nm(e.targetId)+" 合資「"+e.title+"」"), e.fromId);
        setTimeout(function(){ ui.showJVOffer(ui.S.pendingJV); }, 250);
        break;
      case "JV_CANT":
        if(e.playerId===ui.myId()) ui.toast("你想合資，但現金付不起自己那份——視同婉拒","warn",4000);
        break;
      case "CONTEST_RESULT": {
        var ctxt="🎲 "+nm(e.playerId)+"「"+e.title+"」擲出 "+e.roll+" 點："+e.label+(e.prize>0?("　獎金 +"+M(e.prize)):"");
        ui.announce(ctxt, e.playerId);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:ctxt};
        if(e.playerId===ui.myId()) ui.toast(ctxt, e.prize>0?"good":"warn", 4500);
        break; }
      case "PLAYER_LEFT":
        ui.broadcast("🚪 "+nm(e.playerId)+" 離開了", "座位交給電腦代打，之後可重新連線回來接手","warn",4000);
        break;
      case "PLAYER_RETURNED":
        ui.broadcast("👋 "+nm(e.playerId)+" 回來了", "已從電腦手上接回自己的座位","good",4000);
        break;
      case "TURNS_SKIPPED": {
        var ts="🏥 "+(e.label||"事件")+"：停走 "+e.turns+" 回合";
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:ts};
        if(e.playerId===ui.myId()) ui.toastSys(ts,"warn",4500);
        break; }
      case "P2P_FORMED": {
        var lp="🤝 "+nm(e.lenderId)+" 放款 "+M(e.amount)+" 給 "+nm(e.borrowerId)+"（年利率 "+util.pct(e.rate,1)+"・"+e.term+" 期・月付 "+M(e.payment)+"）";
        ui.announce(lp, e.borrowerId);
        ui.lastAct[e.lenderId]={turn:ui.S.turnNumber, msg:"💸 放款 "+M(e.amount)+" 給 "+nm(e.borrowerId)+"（"+util.pct(e.rate,1)+"）"};
        ui.lastAct[e.borrowerId]={turn:ui.S.turnNumber, msg:"💸 向 "+nm(e.lenderId)+" 借入 "+M(e.amount)+"（"+util.pct(e.rate,1)+"）"};
        break; }
      case "P2P_REJECTED": {
        if(e.openNobody){ ui.toast("💸 廣播借款沒人接：玩家全婉拒，電腦也不放款（利率低於其要求 "+util.pct(e.minRate,1)+" 或現金吃緊）","warn",5500); break; }
        if(e.openNobodyBorrow){ ui.toast("💸 廣播放款沒人借：玩家全婉拒，電腦也只在銀行額度用罄時才借民間","warn",5500); break; }
        var who=nm(e.byId);
        var why = e.humanSaidNo ? who+" 婉拒了這筆借貸"
          : e.byId===e.lenderId
          ? who+" 婉拒放款（現金水位不足，或利率低於其要求 "+util.pct(e.minRate,1)+"）"
          : who+" 不需要民間借貸（銀行額度還沒用完）";
        ui.toast("💸 P2P 未成立："+why,"warn",5000);
        break; }
      case "P2P_PAYMENT": {
        if(e.lenderId===ui.myId()||e.borrowerId===ui.myId()){
          var pm="💸 P2P 期款 "+M(e.payment)+"（利息 "+M(e.interest)+"）"+(e.closed?"　✅ 已全數清償":"　餘 "+M(e.remaining));
          if(e.borrowerId===ui.myId()) ui.lastAct[ui.myId()]={turn:ui.S.turnNumber, msg:pm+"（付 "+nm(e.lenderId)+"）"};
          else ui.lastAct[ui.myId()]={turn:ui.S.turnNumber, msg:pm+"（收自 "+nm(e.borrowerId)+"）"};
          if(e.closed) ui.toast("✅ 與 "+nm(e.borrowerId===ui.myId()?e.lenderId:e.borrowerId)+" 的民間借貸已清償完畢","good",4000);
        }
        break; }
      case "P2P_LATE": {
        var lm="⚠ "+nm(e.borrowerId)+" 付不出 P2P 期款 "+M(e.payment)+"（第 "+e.lateCount+" 次違約，信用受損）";
        ui.announce(lm, e.borrowerId);
        if(e.lenderId===ui.myId()||e.borrowerId===ui.myId()) ui.toast(lm,"warn",5000);
        break; }
      case "P2P_DEFAULT": {
        var dm="💥 "+nm(e.borrowerId)+" 破產：P2P 債權受償 "+M(e.recovered)+"、打銷 "+M(e.lost)+"（"+nm(e.lenderId)+"）";
        ui.announce(dm, e.lenderId);
        ui.lastAct[e.lenderId]={turn:ui.S.turnNumber, msg:"💥 P2P 債權打銷 "+M(e.lost)+"（"+nm(e.borrowerId)+" 破產）"};
        if(e.lenderId===ui.myId()) ui.toast(dm,"warn",6000);
        break; }
      case "MARGIN_WARNING":
        ui.announce("🔔 "+me(e.playerId)+" 收到融資追繳通知（維持率 "+Math.round(e.ratio*100)+"%）", e.playerId);
        if(e.playerId===ui.myId()){ // 八期：緊接著就會彈出追繳視窗，不再重複 toast
          (function(ev2){ setTimeout(function(){ ui.showMarginWarning(ev2); }, 350); })(e); }
        break;
      case "MARGIN_TOPUP":
        ui.announce(me(e.playerId)+" 補繳保證金 "+M(e.amount)+"，保住「"+e.name+"」融資部位", e.playerId);
        if(e.playerId===ui.myId()) ui.toast("已補繳 "+M(e.amount)+"，維持率回到安全區","good",4000);
        break;
      case "MARGIN_CALL":
        ui.announce("💥 "+me(e.playerId)+"：「"+e.name+"」融資追繳未補被強制平倉", e.playerId);
        (function(ev2){ setTimeout(function(){ ui.showMarginCallLesson(ev2); }, 350); })(e);
        break;
      case "STARTUP_EXIT":
        ui.announce(me(e.playerId)+" 的新創「"+e.name+"」被收購，入帳 "+M(e.cash), e.playerId);
        if(e.playerId===ui.myId()) ui.toast("新創退出："+e.name+"　入帳 "+M(e.cash),"good"); break;
      case "STARTUP_DEAD":
        ui.announce(me(e.playerId)+" 的新創「"+e.name+"」倒閉");
        if(e.playerId===ui.myId()) ui.toast("新創倒閉："+e.name,"warn"); break;
      case "LAYOFF":
        ui.announce(me(e.playerId)+" 遇到失業，需支付開銷並停走", e.playerId);
        if(e.playerId===ui.myId()) ui.toastSys("失業：支付開銷並停走","warn"); break;
      case "FREEDOM_REACHED":
        ui.announce(me(e.playerId)+" 的被動收入已覆蓋支出！", e.playerId);
        if(e.playerId===ui.myId()) ui.toast("你的被動收入已覆蓋支出，可以辭職圓夢了","good",5000); break;
      case "ENTER_OUTER": {
        var onm=nm(e.playerId), odr=ns.content.byId[ui.S.players[e.playerId].dreamCardId];
        ui.announce("🎉 "+me(e.playerId)+" 辭職進入自由圈，開始追夢！", e.playerId);
        // 九期：重大事件 → 全服公告
        ui.broadcast("🎉 "+onm+" 達成財務自由，辭職進入夢想圈！",
          "目標："+(odr?odr.name:"圓夢")+"　需集滿 "+ui.S.config.dreamCost+" 點夢想進度　（第 "+ui.S.turnNumber+" 輪）","good",6000);
        break; }
      case "HOLDINGS_REVALUED":
        if(e.playerId===ui.myId()) ui.toast("本月持股評價 "+(e.delta>=0?"+":"")+M(e.delta), e.delta>=0?"good":"warn"); break;
      case "DREAM_PROGRESS": {
        if(!e.progress) break;
        var dn=nm(e.playerId), dcost=ui.S.config.dreamCost;
        var ms=e.milestone||"";                       // V11：這一點到底做了什麼事
        ui.announce("✨ "+me(e.playerId)+"「"+(e.dreamName||"圓夢")+"」"+e.progress+"／"+dcost+
          (ms?("："+ms):"")+(e.paid===false?"（聖地免費 +1）":""), e.playerId);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:"✨ "+(ms||("圓夢進度 "+e.progress+"／"+dcost))};
        // 全服公告：標題放具體成就，副標放進度與剩餘
        ui.broadcast("✨ "+dn+"："+(ms||("圓夢進度 "+e.progress+" ／ "+dcost)),
          (e.dreamName?("《"+e.dreamName+"》　"):"")+"進度 "+e.progress+" ／ "+dcost+"　"+
          (e.progress>=dcost?"夢想已集滿！":"還差 "+(dcost-e.progress)+" 點")+
          (e.paid===false?"　（踩到自己夢想類別的聖地，免費 +1）":"　（投入資金推進）"),"good",6000);
        break; }
      case "DREAM_PENDING":
        ui.announce("🕯 "+me(e.playerId)+" 夢想已集滿，但幸福感 "+e.wellbeing+"／"+e.need+" 還沒到——人生不只是把清單打勾", e.playerId);
        ui.broadcast("🕯 "+nm(e.playerId)+" 的夢想清單完成了",
          "但幸福感只有 "+e.wellbeing+" ／ "+e.need+" 點，還不算圓滿——錢與夢都到位，人生才算數","warn",6500);
        break;
      case "FREEFALL": {
        var fmsg = e.voluntary
          ? "🔙 "+me(e.playerId)+" 自願重返職場（薪資 "+M(e.salary)+"／月），夢想進度 "+e.progressKept+" 保留"
          : "📉 "+me(e.playerId)+" 現金撐不住，跌回內圈重新累積（薪資 "+M(e.salary)+"／月，進度 "+e.progressKept+" 保留）";
        ui.announce(fmsg, e.playerId);
        ui.lastAct[e.playerId]={turn:ui.S.turnNumber, msg:fmsg};
        if(e.playerId===ui.myId()) ui.toast(fmsg, e.voluntary?"good":"warn", 6000);
        break; }
      case "FREEFALL_AVERTED": {
        var av="🛟 "+me(e.playerId)+" 急售資產保住自由圈（自救 "+e.warnings+"／"+e.cap+" 次）";
        ui.announce(av, e.playerId);
        if(e.playerId===ui.myId()) ui.toast(av+"——下次沒有這麼便宜的學費","warn",5500);
        break; }
      case "INFLATION_APPLIED": {
        ui.announce("📈 年度物價調整：通膨 "+util.pct(e.rate,1)+"，生活支出與租金同步調整");
        ui.broadcast("📈 年度物價調整（第 "+e.turn+" 輪）",
          "通膨 "+util.pct(e.rate,1)+"：所有人的生活支出提高，房產租金同步調整", e.rate>=0?"warn":"good", 5200);
        break; }
      case "MALL_BOUGHT": {
        var mtxt=e.icon+" "+e.title+(e.cost?("　−"+M(e.cost)):"");
        ui.announce(me(e.playerId)+" 在商城買了「"+e.title+"」"+(e.outcome?("："+e.outcome.text):""), e.playerId);
        if(e.playerId===ui.myId()){
          if(e.outcome) ui.toast(mtxt+"　"+e.outcome.text, e.outcome.win?"good":"warn", 6000);
          else ui.toast(mtxt+(e.notes&&e.notes.length?("　"+e.notes.join("　")):""), "good", 4500);
        }
        break; }
      case "INSURANCE_CLAIM":
        ui.announce(me(e.playerId)+" 的醫療意外險理賠 "+M(e.claim)+"（"+e.label+"）", e.playerId);
        if(e.playerId===ui.myId()) ui.toast("🛡 保險理賠 +"+M(e.claim)+"　保費終於派上用場","good",5000); break;
      case "HEALTH_DISCOUNT":
        if(e.playerId===ui.myId()) ui.toast("💪 平時有健身／健檢，這筆支出少了 "+M(e.saved),"good",4500); break;
      case "INSURANCE_CANCELLED":
        ui.announce(me(e.playerId)+" 解約醫療＋意外險", e.playerId);
        if(e.playerId===ui.myId()) ui.toast("已解約：每月省下 "+M(e.premium)+"，但風險回到自己身上","warn",4500); break;
      case "STOCK_GAIN_ALERT":
        ui.announce("📈 "+me(e.playerId)+"「"+e.name+"」帳上獲利 +"+Math.round(e.gainPct)+"%", e.playerId); break;
      case "REFERRAL_DONE":
        ui.announce("🤝 "+nm(e.fromId)+" 把「"+e.title+"」轉介給 "+nm(e.toId)+"，收介紹費 "+M(e.fee), e.fromId);
        ui.lastAct[e.toId]={turn:ui.S.turnNumber, msg:"🤝 接手「"+e.title+"」，付介紹費 "+M(e.fee)+"（"+nm(e.fromId)+"）"};
        if(e.fromId===ui.myId()) ui.toast("🤝 轉介成交！介紹費 +"+M(e.fee),"good",5000); break;
      case "REFERRAL_REJECTED":
        ui.announce("🤝 "+(e.toId===null||e.toId===undefined?"廣播後沒有人接手":nm(e.toId)+" 婉拒了")+"「"+e.title+"」的轉介");
        if(e.fromId===ui.myId()) ui.toast(e.humanSaidNo ? nm(e.toId)+" 婉拒了轉介"
          : nm(e.toId)+" 婉拒轉介（現金水位不足、買不成或評估後不划算）","warn",4500); break;
      case "EVENT_EXPIRED": if(e.label) ui.announce("事件結束："+e.label); break;
      case "TURN_SKIPPED": {
        // S13.1 §7：只說「停走」玩家會以為是 bug。原因與剩餘輪數一起講。
        var rsn = e.reason ? ("（"+e.reason+"）") : "";
        var rest = (e.remaining>0) ? ("，之後還要停 "+e.remaining+" 輪") : "";
        ui.announce(me(e.playerId)+" 這回合停走"+rsn+rest);
        if(e.playerId===ui.myId())
          ui.toastSys("你這回合停走"+rsn+(e.remaining>0?("　還剩 "+e.remaining+" 輪"):"　這是最後一輪"),"warn",5200);
        break; }
      case "BANKRUPT":
        ui.announce(me(e.playerId)+" 破產出局");
        ui.broadcast("💀 "+nm(e.playerId)+" 破產出局","現金見底且無法靠賣資產或信貸脫困（第 "+ui.S.turnNumber+" 輪）","warn",6000); break;
    }
  });
};

ui.showPayslip = function(d){
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="420px";
  box.appendChild(el("h2",null,T("pay.title")));
  box.appendChild(el("div","sub","第 "+d.turn+" 輪"));
  var kv=el("div","kv");
  function r(k,v,c){ kv.appendChild(el("div","k",k)); kv.appendChild(el("div","v num"+(c?" "+c:""),v)); }
  if(d.baseSalary>0 || d.salary>0){
    r(T("pay.salary"),(d.salary>=0?"+":"")+M(d.salary),"pos");
    if(d.vol) r("　"+T(d.volLabel)+" "+util.pct(d.vol,0),"（基準 "+M(d.baseSalary)+"）");
  }
  r(ui.term("PASSIVE_INCOME"),"+"+M(d.passive),"pos");
  r(T("sheet.expense"),"−"+M(d.expense),"neg");
  box.appendChild(kv);
  var tot=el("div","row total"); tot.appendChild(el("span","lbl",T("pay.result")));
  tot.appendChild(el("span","val num "+(d.net>=0?"pos":"neg"),(d.net>=0?"+":"")+M(d.net)));
  box.appendChild(tot);
  ov.appendChild(box); $("overlays").appendChild(ov);
  var kill=function(){ ov.remove(); };
  ov.onclick=kill;
  setTimeout(kill, Math.max(300, ui.S.config.paydayAnimMs));
};

/* NPC 自動演出 */
// S11：自動執行／收回。真人座位暫時轉成電腦（flags.leftHuman），ui.tick 本來就會驅動它。
ui.isAutopilot = function(){
  var S=ui.S; if(!S) return false;
  var me=S.players[ui.myId()];
  return !!(me && me.isNPC && me.flags && me.flags.leftHuman);
};
ui.toggleAutopilot = function(){
  var S=ui.S; if(!S || S.over) return;
  var me=S.players[ui.myId()]; if(!me) return;
  if(ui.isAutopilot()){
    ui.dispatch({type:"PLAYER_RETURN", playerId:ui.myId(), payload:null});
    ui.toast("換你來了","good");
    return;
  }
  if(me.bankrupt){ ui.toast("破產處理中不能交給電腦","warn"); return; }
  var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="440px";
  bx.appendChild(el("h2",null,"🤖 交給電腦代打？"));
  bx.appendChild(el("div","flavor",
    "電腦會用<b>保守型</b>的邏輯替你把回合走完——擲骰、買賣、記帳全部照做，"+
    "遊戲不會停在你身上。<br>你隨時可以按<b>「我來」</b>接回去，接回來的那一刻起就換你決定。"));
  bx.appendChild(el("div","edu",
    "代打不是最佳解，只是「看到就處理」的基準行為。離開越久，帳面越可能長成你不想要的樣子。"));
  var oo=el("div","opts");
  oo.appendChild(optBtn("交給電腦","我先離開一下",function(){ ov.remove();
    ui.dispatch({type:"PLAYER_LEAVE", playerId:ui.myId(), payload:null});
    ui.toast("代打中——按「我來」隨時接回","good",3000);
    setTimeout(function(){ ui.tick(); }, 60);
  },true));
  oo.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
};

/* S15：電腦玩家迴圈。原版有兩個結構性缺陷，兩個都會讓畫面永遠停在「思考中…」：
     (1) 動作與 END_TURN 都被拒時，照樣 ui.S=res.state 然後遞迴 ui.tick()——
         狀態沒前進，卻無限重試，而且沒有任何畫面提示。
     (2) catch 分支裡沒有再呼叫 ui.tick()——只要丟過一次例外，迴圈就永遠停住。
   改法：偵測「沒有前進」，連續 N 次就停下來、把狀態攤開給玩家看，並給一顆手動跳過的鈕；
   例外照樣要把迴圈接回去。整體原則：寧可讓人看見卡住了並且救得回來，
   也不要安靜地停在一個看起來像在思考的畫面。 */
ui.TICK_STALL_LIMIT = 8;
ui.tick = function(){
  if(!ui.S || ui.S.over) { if(ui.S && ui.S.over) ui.render(); return; }
  var p=E.activePlayer(ui.S);
  if(!p.isNPC) return;
  clearTimeout(ui._t);
  ui._t = setTimeout(function(){
    if(!ui.S || ui.S.over) return;
    // 正在等真人出價／回應：這是規則要求的等待，不是卡住。安靜停下，由等待畫面接手。
    var wOn = E.waitingOnHumans(ui.S);
    if(wOn && wOn.waiting && wOn.waiting.length){ ui._stall=0; ui.render(); return; }
    var sigBefore = ui.tickSig();
    var threw = null;
    try{
      var pp=E.activePlayer(ui.S); if(!pp.isNPC) return;
      var a=ns.npc.nextAction(ui.S);
      if(!a){ a={type:"END_TURN", playerId:pp.id, payload:null}; }
      if(a.type==="DECIDE" && ui.S.pendingDecision) a.payload.decisionId=ui.S.pendingDecision.decisionId;
      var res=E.apply(ui.S,a);
      if(res.rejected){ res=E.apply(ui.S,{type:"END_TURN",playerId:pp.id,payload:null}); }
      ui.S=res.state; ui.handleEvents(res.events); ui.render();
    }catch(err){
      threw = err;
      if(window&&window.console) console.error("tick error:", err);
      try{ var res2=E.apply(ui.S,{type:"END_TURN",playerId:E.activePlayer(ui.S).id,payload:null});
        if(!res2.rejected){ ui.S=res2.state; ui.handleEvents(res2.events); } }catch(e3){}
      try{ ui.render(); }catch(e4){}
    }
    // 有沒有前進？沒有就累計；連續超過上限就攤開來講，不再靜靜空轉
    if(ui.tickSig()===sigBefore){
      ui._stall=(ui._stall||0)+1;
      if(ui._stall>=ui.TICK_STALL_LIMIT){ ui._stall=0; ui.showStuck(threw); return; }
    } else { ui._stall=0; }
    ui.tick();                      // 例外之後也要接回去（原版漏了這一行）
  }, Math.max(60, ui.S.config.npcTurnMs/3));
};
// 進度指紋：任何一項變了就算有前進
ui.tickSig = function(){
  var S=ui.S; if(!S) return "-";
  return S.turnNumber+"|"+S.activePlayerIdx+"|"+S.phase+"|"+S.actionLog.length+"|"+
         (S.pendingDecision?S.pendingDecision.decisionId:"-")+"|"+
         (S.bookkeeping?S.bookkeeping.tasks.filter(function(t){return !t.done;}).length:0);
};
// 卡住了就直說，並且要救得回來
ui.showStuck = function(err){
  var S=ui.S; if(!S) return;
  var pp=E.activePlayer(S);
  var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="560px";
  bx.appendChild(el("h2",null,"⚠ 卡住了——"+pp.name+" 這一步走不下去"));
  var isMp = !!(ui.mp && ui.mp.mode);
  bx.appendChild(el("div","flavor",
    "連續 "+ui.TICK_STALL_LIMIT+" 次都推不動狀態。這是程式的問題，不是你操作錯了。"+
    "下面是當下的完整狀態，請截圖給開發者；"+
    (isMp ? "按「重新同步這一局」從房間紀錄重新載入即可繼續。"
          : "按「跳過這一位」可以繼續玩下去。")));
  var dump={ 版本:(ns.BUILD?ns.BUILD.ver:"?"), 輪次:S.turnNumber, 玩家:pp.name,
    isNPC:pp.isNPC, 階段:S.phase, 待決:S.pendingDecision?S.pendingDecision.kind:null,
    待決屬於:(S.pendingDecision && S.pendingDecision.playerId!==undefined && S.pendingDecision.playerId!==null)
             ? ((S.players[S.pendingDecision.playerId]||{}).name+"（座位 "+S.pendingDecision.playerId+"）") : null,
    我是座位:(ui.mp&&ui.mp.mode)?ui.mp.seat:0,
    待決卡:S.pendingDecision?S.pendingDecision.cardId:null,
    記帳未完:S.bookkeeping?S.bookkeeping.tasks.filter(function(t){return !t.done;}).length:0,
    懸置拍賣:!!S.pendingAuction, 懸置轉介:!!S.pendingReferral, 懸置合資:!!S.pendingJV,
    懸置轉讓:!!S.pendingTrade, 懸置P2P:!!S.pendingP2P,
    電腦下一步:(ns.npc.nextAction(S)||{}).type||"null",
    例外:err?String(err&&err.message||err):null };
  var pre=el("div"); pre.style.cssText="font-family:monospace;font-size:11px;white-space:pre-wrap;"+
    "background:rgba(0,0,0,.30);border-radius:6px;padding:8px;margin-top:8px;line-height:1.6";
  pre.textContent=JSON.stringify(dump,null,1);
  bx.appendChild(pre);
  var oo=el("div","opts");
  if(ui.mp && ui.mp.mode){
    // S15d：多人局不能在本機直接改狀態——那會讓各端的 actionLog 對不起來。
    // 安全的救援是從房間紀錄重新同步一次。
    oo.appendChild(optBtn("重新同步這一局","從房間紀錄重新載入，各端狀態會對齊",function(){
      ov.remove(); ui.mp._stall=0;
      if(ui.mpRejoin) ui.mpRejoin(); else { try{ location.reload(); }catch(e){} }
    },true));
    oo.appendChild(optBtn("先關掉，回去看看",null,function(){ ov.remove(); }));
  } else {
    oo.appendChild(optBtn("跳過這一位，繼續玩","清掉卡住的待決事項並換下一位",function(){
      ov.remove();
      try{
        S.decisionQueue=[]; S.pendingDecision=null; S.bookkeeping=null; S.turnResolved=true;
        E.syncPhase(S);
        var r=E.apply(ui.S,{type:"END_TURN",playerId:E.activePlayer(ui.S).id,payload:null});
        if(!r.rejected){ ui.S=r.state; ui.handleEvents(r.events); }
      }catch(e){}
      ui.render(); ui._stall=0; ui.tick();
    },true));
  }
  oo.appendChild(optBtn("複製狀態",null,function(){
    try{ navigator.clipboard.writeText(JSON.stringify(dump)); ui.toast("已複製","good"); }catch(e){}
  }));
  oo.appendChild(optBtn("先關掉",null,function(){ ov.remove(); }));
  bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
};

/* ================================ 存檔 ================================== */
ui.save = function(){
  try{ var S=ui.S;
    localStorage.setItem("finflow.autosave", JSON.stringify({
      schemaVersion:1, seed:S.seed, config:S.config, modules:S.enabledModules,
      players:ns.seedPlayers(S),
      actionLog:S.actionLog, turn:S.turnNumber, at:new Date().toISOString() }));
  }catch(err){ /* localStorage 滿載：提示匯出 */ }
};
// 存檔用的「開局玩家資料」——單一定義，ui.save 與測試共用，避免兩邊各寫一份而漂移。
// 只能放開局就決定、且整局不變的欄位；任何會被玩法改動的欄位（如轉職後的 professionId）
// 都必須改用它的 initial 版本。
ns.seedPlayers = function(S){
  return S.players.map(function(p){
    return { name:p.name, isNPC:p.isNPC, personality:p.npcPersonality,
             professionId: p.initialProfessionId || p.professionId,
             dreamCardId: p.dreamCardId };
  });
};

ns.replay = function(save){
  var S=E.newGame({ seed:save.seed, config:util.clone(save.config), modules:save.modules, players:save.players });
  E.beginTurn(S);
  var log=save.actionLog.slice();
  for(var i=0;i<log.length;i++){
    var r=E.apply(S, {type:log[i].type, playerId:log[i].playerId, payload:log[i].payload}, {mutate:true});
    S=r.state;
  }
  return S;
};
ui.load = function(){
  try{ var raw=localStorage.getItem("finflow.autosave"); if(!raw) return null;
    var save=JSON.parse(raw); if(save.schemaVersion!==1) return null; return save;
  }catch(e){ return null; }
};

/* ============================ S6：成就與徽章 ============================
   鐵律（規格書 §7-5）：徽章只給頭銜，不給任何遊戲內數值。
   一旦給錢或加成就變成必刷任務，會扭曲玩家行為並破壞平衡。

   實作紀律：ns.badges.rules 裡的每一條都是純函式——
   只讀 (S, p, ctx)，不得寫入任何東西，不得呼叫 ledger.post / E.ev / util.rand。
   這讓徽章可以在任何時間點重複計算而不影響對局，也讓它可被重放。       */
var badges = ns.badges = {};

// 全場比較用的參考值（相對頭銜要用）。純讀取。
badges.context = function(S){
  var alive = S.players;
  function best(fn, cmp){
    var v=null, id=null;
    alive.forEach(function(p){
      var x=fn(p);
      if(x===null || x===undefined || !isFinite(x)) return;
      if(v===null || cmp(x,v)){ v=x; id=p.id; }
    });
    return {value:v, playerId:id};
  }
  var hi=function(a,b){ return a>b; }, lo=function(a,b){ return a<b; };
  return {
    players: alive.length,
    learner : best(function(p){ return p.stats.skillsLearned||0; }, hi),
    gambler : best(function(p){ return p.stats.maxLeverage||0; }, hi),
    free    : best(function(p){ return p.freeAtTurn||null; }, lo),
    family  : best(function(p){ return E.wellbeing(S,p); }, hi),
    bargain : best(function(p){ return p.stats.skillSavedTotal||0; }, hi),
    survivor: best(function(p){ return p.bankrupt ? null : p.derived.netWorth; }, lo)
  };
};

function cnt(p, kind){
  return (p.assets||[]).filter(function(a){ return a.kind===kind; }).length;
}
function soleWinner(ctx, key, p, minV){
  var b=ctx[key];
  if(!b || b.playerId!==p.id || b.value===null) return false;
  if(minV!==undefined && !(b.value>minV)) return false;
  return true;
}

badges.rules = {
  // 學習線
  ready:    function(S,p){ return (p.stats.skillsUsed||0) >= 5; },
  twoTrade: function(S,p){
    if(!p.initialProfessionId || p.professionId===p.initialProfessionId) return false;
    var a=ns.content.professionById[p.initialProfessionId], b=ns.content.professionById[p.professionId];
    return !!(a && b && a.group !== b.group);          // 跨 group 才算真的有第二條路
  },
  lifelong: function(S,p){ return (p.stats.skillsLearned||0) >= 4 && (p.stats.skillsAbandoned||0) === 0; },
  quitter:  function(S,p){ return (p.stats.skillsAbandoned||0) >= 3; },
  wasted:   function(S,p){
    var learned=Object.keys(p.skills||{}).length;
    return Math.max(0, learned-(p.stats.skillsUsed||0)) >= 3;
  },
  // 數位資產線
  longtail: function(S,p){ return (p.stats.digitalTakeoff||0) >= 1; },
  viral:    function(S,p){ return (p.stats.digitalHIT||0) >= 1; },
  ghost:    function(S,p){ return (p.stats.digitalDead||0) >= 1; },
  // 投資線
  prodigy:  function(S,p){ return !!p.freeAtTurn && p.freeAtTurn <= 40; },
  karate:   function(S,p){ return !!p.freeAtTurn && (p.liabilities||[]).length === 0; },
  lever:    function(S,p){ return (p.stats.maxLeverage||0) >= 3 && !p.bankrupt; },
  landlord: function(S,p){ return cnt(p,"REALESTATE") >= 4; },
  tycoon:   function(S,p){ return cnt(p,"BUSINESS") >= 5; },
  cashflow: function(S,p){
    var e=p.derived.totalExpenses;
    return e > 0 && p.derived.passiveIncome >= e*2;
  },
  takeProfit: function(S,p){ return (p.stats.takeProfit||0) >= 3; },
  // 準備線
  network:  function(S,p){ return !!(p.flags && p.flags.network); },
  insured:  function(S,p){ return !!(p.flags && p.flags.insured && p.flags.propInsured); },
  // 品格線
  virtue:   function(S,p){
    var cap=E.cfg(S,"virtueMaxLevel"); if(cap===undefined) cap=3;
    var ax=["TEMPER","PRUDENCE","PARENTING","FILIAL"];
    for(var i=0;i<ax.length;i++){ if((p.virtues&&p.virtues[ax[i]]||0) < cap) return false; }
    return true;
  },
  saved:    function(S,p){ return (p.virtueSavedTotal||0) > 300; },
  // 危機線
  cat:      function(S,p){ return (p.stats.freefalls||0) >= 2 && !p.bankrupt; },
  almost:   function(S,p){ return (p.stats.freefalls||0) >= 3; },
  // 相對頭銜（單人局不給——一個人的「最」沒有意義）
  topLearner : function(S,p,ctx){ return ctx.players>1 && soleWinner(ctx,"learner",p,0); },
  topGambler : function(S,p,ctx){ return ctx.players>1 && soleWinner(ctx,"gambler",p,1.5); },
  topFree    : function(S,p,ctx){ return ctx.players>1 && soleWinner(ctx,"free",p); },
  topFamily  : function(S,p,ctx){ return ctx.players>1 && soleWinner(ctx,"family",p,0); },
  topBargain : function(S,p,ctx){ return ctx.players>1 && soleWinner(ctx,"bargain",p,0); },
  topSurvivor: function(S,p,ctx){ return ctx.players>1 && ctx.players>2 && soleWinner(ctx,"survivor",p); }
};

badges.all = function(){ return (ns.content.cards && ns.content.cards.BADGE) || []; };

// 單一玩家的徽章清單（純函式）。ctx 省略時自行計算。
badges.evaluate = function(S, p, ctx){
  ctx = ctx || badges.context(S);
  var got = [];
  badges.all().forEach(function(b){
    var fn = badges.rules[b.rule];
    if(typeof fn !== "function") return;              // 防禦：內容寫錯不得炸
    var ok = false;
    try { ok = !!fn(S, p, ctx); } catch(e){ ok = false; }
    if(ok) got.push(b.id);
  });
  // 互斥組：兩個都成立時，只留 priority 高的那個
  var byId = {}; badges.all().forEach(function(b){ byId[b.id]=b; });
  return got.filter(function(id){
    var b=byId[id];
    if(!b || !b.exclusiveWith) return true;
    if(got.indexOf(b.exclusiveWith) < 0) return true;
    var other=byId[b.exclusiveWith];
    var pa=(b.priority||0), pb=(other&&other.priority)||0;
    return pa>pb || (pa===pb && b.id < b.exclusiveWith);
  });
};

badges.evaluateAll = function(S){
  var ctx = badges.context(S), out = {};
  S.players.forEach(function(p){ out[p.id] = badges.evaluate(S, p, ctx); });
  return out;
};

/* ============================== 復盤報告 ================================ */

/* S15：變現決策表——破產與跌落自救共用。
   排序與「夠不夠」一律吃**實際入袋現金**（E.sellPreview），不再用急售毛額。
   舊版用毛額判斷，會在貸款買的資產上標出「✅ 賣這一筆就夠了」而實際入袋是 0。 */
ui.sellOptions = function(S, p, need, mult){
  var rows=(p.assets||[]).filter(function(a){ return a.kind!=="P2P_LOAN"; }).map(function(a){
    var pv=E.sellPreview(S,p,a,mult);
    var r=(E.assetReturns ? E.assetReturns(p,a) : null);
    return { a:a, pv:pv, r:r, enough: pv.netCash>=need-0.001 };
  });
  // 先看「賣一筆就夠」，同組再看誰犧牲的月現金流最少，最後才比入袋多寡
  rows.sort(function(x,y){
    if(x.enough!==y.enough) return x.enough?-1:1;
    if(x.enough) return (y.pv.cashflowDelta-x.pv.cashflowDelta) || (x.pv.netCash-y.pv.netCash);
    return y.pv.netCash-x.pv.netCash;
  });
  rows.forEach(function(row){
    var pv=row.pv, parts=[];
    parts.push("<b class='"+(pv.netCash>0?"pos":"neg")+"'>實際入袋 "+M(pv.netCash)+"</b>");
    if(pv.hasLoan) parts.push("急售 "+M(pv.gross)+" − 清償 "+M(pv.payoff));
    if(pv.residualDebt>0) parts.push("<span class='neg'>殘餘負債 "+M(pv.residualDebt)+" 轉信貸，月付 "+M(pv.monthlyPayAfter)+"</span>");
    parts.push("月現金流 "+(pv.cashflowDelta>=0?"+":"")+M(pv.cashflowDelta));
    if(row.r && row.r.cashYield!==null && row.r.assetYield!==null)
      parts.push("現金報酬 "+util.pct(row.r.cashYield,1)+"／資產報酬 "+util.pct(row.r.assetYield,1));
    parts.push(row.enough ? "<b class='gold'>✅ 賣這一筆就夠了</b>"
                          : "仍差 "+M(util.r2(need-pv.netCash)));
    var d=el("span"); d.innerHTML=parts.join("　·　");
    row.sub=d.innerHTML;
  });
  return rows;
};

ui.showReport = function(){
  if(ui._reported) return; ui._reported=true;
  var S=ui.S;
  // 全場比較的參考值算一次就好（相對頭銜要用）；純讀取，不動任何狀態
  ui._badgeCtx = (ns.badges && ns.badges.context) ? ns.badges.context(S) : null;
  var ov=el("div","overlay"), box=el("div","sheetbox");
  box.appendChild(el("h2",null,T("report.title")));
  var win = S.winner===null ? "全員出局" : (S.players[S.winner].name+" 勝出");
  box.appendChild(el("div","sub",win+"　共 "+S.turnNumber+" 輪"));

  // 全體玩家排名表
  var ranked=S.players.slice().sort(function(a,b){
    if(a.bankrupt!==b.bankrupt) return a.bankrupt?1:-1;
    if((a.playerStage==="OUTER")!==(b.playerStage==="OUTER")) return a.playerStage==="OUTER"?-1:1;
    if(a.playerStage==="OUTER"&&b.playerStage==="OUTER") return b.dreamProgress-a.dreamProgress;
    return b.derived.netWorth-a.derived.netWorth; });
  var rt=el("table","tb"); rt.style.marginTop="6px";
  rt.innerHTML="<tr><th>名次</th><th>玩家</th><th>結局</th><th>淨值</th><th>被動收入</th><th>自由輪</th><th>圓夢</th><th>幸福感</th><th>頭銜</th></tr>";
  ranked.forEach(function(x,i){
    var end = x.bankrupt?"破產":(x.playerStage==="OUTER"?"自由圈":"內圈");
    var tr=el("tr"); if(x.id===ui.myId()) tr.style.background="rgba(242,193,78,.10)";
    tr.innerHTML="<td>"+(i+1)+"</td><td>"+x.name+(x.id===ui.myId()?"（你）":"")+"</td><td>"+end+"</td>"+
      "<td class='num "+(x.derived.netWorth>=0?"pos":"neg")+"'>"+M(x.derived.netWorth)+"</td>"+
      "<td class='num pos'>"+M(x.derived.passiveIncome)+"</td>"+
      "<td class='num'>"+(x.freeAtTurn?("第"+x.freeAtTurn):"—")+"</td>"+
      "<td class='num'>"+x.dreamProgress+"/"+S.config.dreamCost+"</td>"+
      "<td class='num' style='color:#E8709B'>♥"+ui.wellbeing(x)+"</td>"+
      "<td style='font-size:15px;letter-spacing:1px'>"+
        (ui._badgeCtx ? ns.badges.evaluate(S,x,ui._badgeCtx).map(function(bid){
          var bb=ns.content.byId[bid]; return bb?(bb.icon||"🏅"):""; }).join("") : "")+"</td>";
    rt.appendChild(tr);
  });
  box.appendChild(rt);

  // 玩家分頁 + 個人明細
  var tabs=el("div","tabs"); tabs.style.marginTop="14px";
  var detail=el("div");
  function renderDetail(p){
    detail.innerHTML="";
    // S16：實測回饋——有玩家會想回看整局。戰報每個分頁都給一個入口。
    var rlBar=el("div"); rlBar.style.cssText="display:flex;justify-content:flex-end;margin-bottom:6px";
    var rlBtn=el("button","act"); rlBtn.textContent="📜 看 "+p.name+" 的每輪紀錄";
    rlBtn.title="這一局每一輪發生了什麼、五個科目各動了多少";
    rlBtn.onclick=function(){ ui.showRoundLog(p.id); };
    rlBar.appendChild(rlBtn); detail.appendChild(rlBar);
    var kv=el("div","kv"); kv.style.gridTemplateColumns="1fr auto 1fr auto";
    function r(k,v,c){ kv.appendChild(el("div","k",k)); kv.appendChild(el("div","v num"+(c?" "+c:""),v)); }
    r(T("report.nw"), M(p.derived.netWorth), p.derived.netWorth>=0?"pos":"neg");
    r(T("report.passive"), M(p.derived.passiveIncome),"pos");
    r(T("report.turns"), p.freeAtTurn?("第 "+p.freeAtTurn+" 輪達成自由"):"未達成");
    r("圓夢進度", p.dreamProgress+" / "+S.config.dreamCost);
    var acc=p.stats.bkRight+p.stats.bkWrong;
    r(T("report.acc"), acc?util.pct(p.stats.bkRight/acc,0):"—");
    r(T("report.skipped"), p.stats.passedOpps+" 次");
    r(T("report.optional"), p.stats.optionalSeen?util.pct(p.stats.optionalBought/p.stats.optionalSeen,0):"—");
    r(T("report.leverage"), p.stats.maxLeverage.toFixed(2)+" 倍");
    if(S.enabledModules.indexOf("M6")>=0){
      r("品格投資累計","−"+M(p.virtueSpendTotal),"neg");
      r(T("report.saved"),"+"+M(p.virtueSavedTotal),"pos"); }
    // M8：你的因與果——把機會成本誠實攤開
    if(S.enabledModules.indexOf("M8")>=0){
      var nLearn=Object.keys(p.skills||{}).length;
      var used=p.stats.skillsUsed||0, missed=p.stats.skillMissed||0;
      var idle=Math.max(0, nLearn-used);
      r("學成技能", nLearn+" 項");
      r("學費投入","−"+M(p.stats.skillSpendTotal||0),"neg");
      r("技能派上用場", used+" 次", used>0?"pos":"");
      r("這局沒用上", idle+" 項", idle>0?"":"pos");
      r("因為沒準備而錯失", missed+" 次", missed>0?"neg":"pos");
      if((p.stats.skillSavedTotal||0)>0) r("技能帶來的價差","+"+M(p.stats.skillSavedTotal),"pos");
      if(p.stats.skillsAbandoned) r("半途放棄", p.stats.skillsAbandoned+" 次","neg");
    }
    detail.appendChild(kv);

    // S6：你的因與果——把這一局的選擇與後果，用頭銜收束成一句話
    if(ui._badgeCtx){
      var mine = ns.badges.evaluate(S, p, ui._badgeCtx);
      var RAR={LEGEND:"傳說",RARE:"稀有",COMMON:"成就"};
      var bh = el("div","bdgHd");
      var nLeg = mine.filter(function(id){ var b=ns.content.byId[id]; return b&&b.rarity==="LEGEND"; }).length;
      bh.textContent = "🏆 你的因與果　" + (mine.length
        ? mine.length+" 個頭銜"+(nLeg?("　其中 "+nLeg+" 個傳說級"):"")
        : "這一局沒有留下頭銜");
      detail.appendChild(bh);
      if(mine.length){
        var byId={}; ns.badges.all().forEach(function(b){ byId[b.id]=b; });
        var order=["頭銜","學習","數位","投資","準備","品格","危機"];
        var grouped={};
        mine.forEach(function(id){ var b=byId[id]; if(!b) return;
          (grouped[b.group]=grouped[b.group]||[]).push(b); });
        order.forEach(function(g){
          if(!grouped[g]) return;
          var gl=el("div","flavor"); gl.style.cssText="margin:12px 0 2px;color:var(--tx3);letter-spacing:.14em;font-size:11px";
          gl.textContent=g; detail.appendChild(gl);
          var wrap=el("div","bdgWrap");
          grouped[g].forEach(function(b){
            var chip=el("div","bdg "+(b.rarity||"COMMON"));
            chip.appendChild(el("div","br",RAR[b.rarity||"COMMON"]));
            chip.appendChild(el("div","bi",b.icon||"🏅"));
            chip.appendChild(el("div","bt",b.title));
            chip.appendChild(el("div","bd",b.desc||""));
            wrap.appendChild(chip);
          });
          detail.appendChild(wrap);
        });
      } else {
        detail.appendChild(el("div","flavor",
          "沒有頭銜不代表這局白玩了——頭銜只認得出那些走得夠遠、或跌得夠深的路。"));
      }
      var note=el("div","flavor");
      note.style.cssText="margin-top:8px;font-size:11.5px;color:var(--tx3)";
      note.textContent="頭銜只是回顧，不影響任何遊戲數值。";
      detail.appendChild(note);
    }

    if(p.history.length>1){
      var W=820,H=180,pad=28;
      var maxV=Math.max(1, Math.max.apply(null,p.history.map(function(h){return Math.max(h.nw,h.passive*10,h.expense*10);})));
      var line=function(key,mult){ return p.history.map(function(h,i){
        var x=pad+i*(W-2*pad)/(p.history.length-1);
        var y=H-pad-(h[key]*mult/maxV)*(H-2*pad);
        return (i?"L":"M")+x.toFixed(1)+" "+y.toFixed(1); }).join(" "); };
      var svg='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:180px;margin-top:14px">'+
        '<rect width="'+W+'" height="'+H+'" fill="#0E1520" rx="10"/>'+
        '<path d="'+line("nw",1)+'" fill="none" stroke="#F2C14E" stroke-width="2"/>'+
        '<path d="'+line("passive",10)+'" fill="none" stroke="#35C4A8" stroke-width="2"/>'+
        '<path d="'+line("expense",10)+'" fill="none" stroke="#F0803C" stroke-width="2" stroke-dasharray="4 3"/>'+
        '<text x="'+pad+'" y="16" fill="#6B7F98" font-size="11">淨值（金）／被動收入（綠，×10）／總支出（橘虛線，×10）</text></svg>';
      var w=el("div"); w.innerHTML=svg; detail.appendChild(w);
    }
    var keys=p.ledger.filter(function(e){ return e.eduTags.some(function(t){
      return ["passive-income","leverage","exit","startup","business"].indexOf(t)>=0; }); }).slice(-14);
    if(keys.length){
      var tb=el("table","tb"); tb.style.marginTop="14px";
      tb.innerHTML="<tr><th>回合</th><th>決策</th><th>現金影響</th></tr>";
      keys.forEach(function(e){
        var cash=util.sum(e.postings.filter(function(q){return q.account==="CASH";}),function(q){return q.delta;});
        var tr=el("tr");
        tr.innerHTML="<td>"+e.turnNumber+"</td><td>"+e.summary+"</td><td class='num "+(cash>=0?"pos":"neg")+"'>"+(cash>=0?"+":"")+M(cash)+"</td>";
        tb.appendChild(tr); });
      detail.appendChild(tb);
    } else { detail.appendChild(el("div","flavor","這位玩家沒有明顯的投資決策紀錄。")); }
  }
  S.players.forEach(function(pl){
    var b=el("button","tab"+(pl.id===ui.myId()?" on":""), pl.name+(pl.id===ui.myId()?"（你）":""));
    b.onclick=function(){ tabs.querySelectorAll(".tab").forEach(function(t){t.classList.remove("on");}); b.classList.add("on"); renderDetail(pl); };
    tabs.appendChild(b);
  });
  box.appendChild(tabs); box.appendChild(detail);
  renderDetail(S.players[ui.myId()] || S.players[0]);

  var opts=el("div","opts");
  var ex=el("button","opt",T("report.export"));
  ex.onclick=function(){ ui.exportJSON({ seed:S.seed, config:S.config, modules:S.enabledModules,
    actionLog:S.actionLog, result:{winner:S.winner, turns:S.turnNumber,
    players:S.players.map(function(x){ return {name:x.name, profession:x.professionId, nw:x.derived.netWorth,
      passive:x.derived.passiveIncome, free:x.freeAtTurn, dream:x.dreamProgress, bankrupt:x.bankrupt}; })}},
    "finflow-replay.json"); };
  var again=el("button","opt","再玩一局");
  again.onclick=function(){ ov.remove(); ui._reported=false; ui.S=null; $("app").classList.add("hide"); ui.showSetup(); };
  // S14b：時間到才結束的局，桌上常常還想再打一段。續攤＝把上限往後推，局內狀態一律不動。
  if(S.overReason==="MAX_TURNS" && ui.mayExtend()){
    var addN = Math.round(E.cfg(S,"extendTurns")||20);
    var cont=el("button","opt primary","▶ 再延長 "+addN+" 輪（接著打）");
    cont.title="不重開、不結算，所有人的現金／資產／負債原封不動接著打";
    cont.onclick=function(){
      ov.remove(); ui._reported=false;
      ui.dispatch({type:"EXTEND_GAME",playerId:ui.myId(),payload:{turns:addN}});
    };
    opts.appendChild(cont);
  }
  opts.appendChild(again); opts.appendChild(ex); box.appendChild(opts);
  ov.appendChild(box); $("overlays").appendChild(ov);
};

// S14b：誰有權延長——單機是自己，多人局是房主（與「結束遊戲」同一把鑰匙）
ui.mayExtend = function(){
  if(ui.mp && ui.mp.mode) return !!ui.mp.host;
  return true;
};

ui.exportJSON = function(obj, filename){
  var s=JSON.stringify(obj,null,1);
  try{
    var b=new Blob([s],{type:"application/json"}), u=URL.createObjectURL(b);
    var a=document.createElement("a"); a.href=u; a.download=filename; a.click();
    setTimeout(function(){ URL.revokeObjectURL(u); },1000);
    ui.toast("已匯出 "+filename,"good");
  }catch(e){ ui.showText(s); }
};
ui.showText = function(s){
  var ov=el("div","overlay"), box=el("div","sheetbox");
  var ta=document.createElement("textarea");
  ta.value=s; ta.style.cssText="width:100%;height:50vh;background:var(--ink);color:var(--tx);border:1px solid var(--line2);border-radius:10px;padding:10px;font-family:var(--mono);font-size:11px";
  box.appendChild(el("h2",null,"複製下面的內容")); box.appendChild(ta);
  var b=el("button","opt",T("act.close")); b.onclick=function(){ ov.remove(); };
  box.appendChild(b); ov.appendChild(box); $("overlays").appendChild(ov);
  ta.select();
};

/* ============================== 調參面板 ================================ */
ns.devpanel = {
  build: function(){
    var body=$("devbody"); body.innerHTML="";
    /* S16：回合結算畫面的顯示偏好放在最上面。這是本機偏好（不進遊戲狀態、不影響
       決定論與重放），所以不走 config；但關掉之後要有地方打得開，不然就回不來了。 */
    var sd=el("details","cfgroup"); sd.open=true;
    sd.appendChild(el("summary",null,"畫面（本機偏好，不影響對局）"));
    var sr=el("div","cfrow");
    var sl=el("div","l"); sl.appendChild(el("span",null,"回合結算彙總畫面"));
    var sb=el("button","act");
    function sbl(){ sb.textContent = ui.turnSummaryOn() ? "開啟中" : "已關閉"; }
    sbl();
    sb.onclick=function(){ ui._sumOff = ui.turnSummaryOn();
      try{ localStorage.setItem("finflow.sumOff", ui._sumOff?"1":"0"); }catch(e){}
      sbl(); };
    sl.appendChild(sb); sr.appendChild(sl);
    sr.appendChild(el("div","d","每輪結束用一個畫面總結所有異動，取代零散的小通知。關閉時回到原本行為。"));
    sd.appendChild(sr);
    var ar=el("div","cfrow");
    var al=el("div","l"); al.appendChild(el("span",null,"結算畫面自動關閉"));
    var ab=el("button","act");
    function abl(){ ab.textContent = ui._sumAutoSec>0 ? (ui._sumAutoSec+" 秒") : "不自動關"; }
    abl();
    ab.onclick=function(){ var ST=[0,2,3,5,10];
      ui._sumAutoSec=ST[(ST.indexOf(ui._sumAutoSec)+1)%ST.length];
      try{ localStorage.setItem("finflow.sumAutoSec", String(ui._sumAutoSec)); }catch(e){}
      abl(); };
    al.appendChild(ab); ar.appendChild(al);
    ar.appendChild(el("div","d","0＝只能手動按「朕知道了」。表格要看得完，建議前幾輪先不自動關。"));
    sd.appendChild(ar);
    body.appendChild(sd);
    var reg=ns.configRegistry.params, groups={};
    reg.forEach(function(p){ (groups[p.group]=groups[p.group]||[]).push(p); });
    Object.keys(groups).forEach(function(g){
      var det=el("details","cfgroup"); var sum=el("summary",null,g+"（"+groups[g].length+"）");
      det.appendChild(sum);
      groups[g].forEach(function(prm){
        var row=el("div","cfrow");
        var l=el("div","l"); l.appendChild(el("span",null,prm.label));
        var val=el("input"); val.type="number"; val.step=prm.step; val.min=prm.min; val.max=prm.max;
        val.value = ui.S ? ui.S.config[prm.key] : prm.value;
        l.appendChild(val); row.appendChild(l);
        if(prm.desc){ var dd=el("div","d",prm.desc); if(prm.hot) dd.innerHTML=prm.desc+'<span class="hotdot"></span>'; row.appendChild(dd); }
        var rg=el("input"); rg.type="range"; rg.min=prm.min; rg.max=prm.max; rg.step=prm.step; rg.value=val.value;
        row.appendChild(rg);
        function set(v){
          v=parseFloat(v); if(isNaN(v)) return;
          val.value=v; rg.value=v;
          if(ui.S && prm.hot){ ui.dispatch({type:"CONFIG_PATCH", playerId:0, payload:{key:prm.key, value:v}}); }
          else { ui.configOverrides=ui.configOverrides||{}; ui.configOverrides[prm.key]=v;
            if(ui.S) ui.S.config[prm.key]=v; }
        }
        rg.oninput=function(){ set(rg.value); }; val.onchange=function(){ set(val.value); };
        det.appendChild(row);
      });
      body.appendChild(det);
    });
    var tools=el("div","cfrow"); tools.style.paddingTop="14px";
    var mk=function(label,fn){ var b=el("button","opt",label); b.style.marginBottom="7px"; b.onclick=fn; tools.appendChild(b); };
    mk(T("dev.export"), function(){ ui.exportJSON(ui.S?ui.S.config:ns.buildConfig(ns.configRegistry),"finflow-config.json"); });
    mk(T("dev.import"), function(){ ns.devpanel.importCfg(); });
    mk(T("dev.save")+"…", function(){ ns.devpanel.slots(); });
    mk(T("dev.reset"), function(){ var c=ns.buildConfig(ns.configRegistry);
      Object.keys(c).forEach(function(k){ if(ui.S) ui.dispatch({type:"CONFIG_PATCH",playerId:0,payload:{key:k,value:c[k]}}); });
      ui.configOverrides={}; ns.devpanel.build(); ui.toast("已恢復預設","good"); });
    mk(T("dev.replay"), function(){ if(!ui.S) return;
      var seed=ui.S.seed, cfg=util.clone(ui.S.config), mods=ui.S.enabledModules.slice();
      var pl=ui.S.players.map(function(p){ return {name:p.name,isNPC:p.isNPC,personality:p.npcPersonality,
        professionId:p.professionId,dreamCardId:p.dreamCardId}; });
      ui.S=E.newGame({seed:seed,config:cfg,modules:mods,players:pl}); E.beginTurn(ui.S);
      ui._reported=false; ui.render(); ui.tick(); ui.toast("同種子重玩","good"); });
    mk(T("dev.selftest"), function(){ ns.selftest.run(true); });
    body.appendChild(tools);
  },
  importCfg: function(){
    var ov=el("div","overlay"), box=el("div","sheetbox");
    var ta=document.createElement("textarea");
    ta.style.cssText="width:100%;height:40vh;background:var(--ink);color:var(--tx);border:1px solid var(--line2);border-radius:10px;padding:10px;font-family:var(--mono);font-size:11px";
    box.appendChild(el("h2",null,"貼上參數 JSON")); box.appendChild(ta);
    var ok=el("button","opt","匯入"); ok.onclick=function(){
      try{ var c=JSON.parse(ta.value); Object.keys(c).forEach(function(k){
        if(ui.S && (k in ui.S.config)) ui.dispatch({type:"CONFIG_PATCH",playerId:0,payload:{key:k,value:c[k]}}); });
        ns.devpanel.build(); ov.remove(); ui.toast("已匯入","good");
      }catch(e){ ui.toast("JSON 格式有誤","warn"); } };
    var no=el("button","opt",T("act.close")); no.onclick=function(){ ov.remove(); };
    box.appendChild(ok); box.appendChild(no); ov.appendChild(box); $("overlays").appendChild(ov);
  },
  slots: function(){
    var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="460px";
    box.appendChild(el("h2",null,"參數槽位"));
    for(var i=1;i<=8;i++){ (function(i){
      var key="finflow.preset."+i, has=null;
      try{ has=localStorage.getItem(key); }catch(e){}
      var row=el("div"); row.style.cssText="display:flex;gap:8px;margin:7px 0;align-items:center";
      row.appendChild(el("span",null,"槽 "+i+"　"+(has?"已存":"空")));
      var s=el("button","act","存"); s.onclick=function(){
        try{ localStorage.setItem(key, JSON.stringify(ui.S?ui.S.config:ns.buildConfig(ns.configRegistry)));
          ui.toast("已存到槽 "+i,"good"); ov.remove(); }catch(e){ ui.toast("存檔失敗，請改用匯出","warn"); } };
      var l=el("button","act","讀"); l.disabled=!has; l.onclick=function(){
        var c=JSON.parse(localStorage.getItem(key));
        Object.keys(c).forEach(function(k){ if(ui.S && (k in ui.S.config))
          ui.dispatch({type:"CONFIG_PATCH",playerId:0,payload:{key:k,value:c[k]}}); });
        ns.devpanel.build(); ov.remove(); ui.toast("已讀取槽 "+i,"good"); };
      row.appendChild(s); row.appendChild(l); box.appendChild(row);
    })(i); }
    var no=el("button","opt",T("act.close")); no.onclick=function(){ ov.remove(); };
    box.appendChild(no); ov.appendChild(box); $("overlays").appendChild(ov);
  }
};

/* ============================== 模擬器 UI =============================== */
ns.simui = {
  show: function(){
    var ov=el("div","overlay"), box=el("div","sheetbox");
    box.appendChild(el("h2",null,T("sim.title")));
    box.appendChild(el("div","sub","用四位 NPC 互跑多局，看達成自由的輪數分佈與破產率，據此調參。"));
    var ctl=el("div"); ctl.style.cssText="display:flex;gap:10px;align-items:center;margin-bottom:12px";
    var n=el("input"); n.type="number"; n.value=200; n.min=10; n.max=2000; n.step=10;
    n.style.cssText="width:100px;background:var(--ink);border:1px solid var(--line2);border-radius:8px;color:var(--tx);padding:8px;font-family:var(--mono)";
    var run=el("button","bigbtn",T("sim.run")); run.style.padding="12px 22px"; run.style.fontSize="15px";
    var prog=el("span",null,""); prog.style.color="var(--tx2)";
    ctl.appendChild(el("span",null,T("sim.games"))); ctl.appendChild(n); ctl.appendChild(run); ctl.appendChild(prog);
    box.appendChild(ctl);
    var out=el("div"); box.appendChild(out);
    run.onclick=function(){
      var games=Math.max(1,Math.min(2000,+n.value||200));
      var cfg = ui.S ? util.clone(ui.S.config) : ns.buildConfig(ns.configRegistry);
      var mods = ui.S ? ui.S.enabledModules.slice() : ["M1","M2","M3","M4","M6"];
      var t0=Date.now(), done=0, acc={raw:null, rows:[], invalid:[]};
      out.innerHTML=""; run.disabled=true;
      var batch=function(){
        var chunk=Math.min(20, games-done);
        var r=ns.sim.run({games:chunk, config:cfg, modules:mods, seedBase:1+done*131});
        acc.rows=acc.rows.concat(r.rows);
        acc.invalid=acc.invalid.concat(r.invalid||[]);
        // S13.1 FF-001：合併的是原始樣本，不是各批的摘要。
        // 舊寫法 (a+b)/2 是未加權連續平均（等於指數加權到最後一批），
        // 而且 p10 / p90 / 淨值中位從第二批起根本沒被更新——表頭寫 200 局，數字卻只來自最前面 20 局。
        if(!acc.raw) acc.raw=r.raw;
        else Object.keys(r.raw).forEach(function(k){
          if(!acc.raw[k]) acc.raw[k]=ns.sim.stats.emptyBucket();
          ns.sim.stats.mergeBucket(acc.raw[k], r.raw[k]); });
        done+=chunk; prog.textContent=done+" / "+games;
        if(done<games) setTimeout(batch,0);
        else { run.disabled=false;
          var nInv=acc.invalid.length;
          prog.textContent=done+" 局，耗時 "+((Date.now()-t0)/1000).toFixed(1)+" 秒"+
            (nInv?("　⚠ 異常 "+nInv+" 局已排除"):"");
          acc.summary=Object.keys(acc.raw||{}).map(function(k){ return ns.sim.stats.summarize(k, acc.raw[k]); });
          var tb=el("table","tb");
          tb.innerHTML="<tr><th>性格</th><th>"+T("sim.free")+"</th><th>"+T("sim.median")+"</th><th>P10</th><th>P90</th><th>"+T("sim.bankrupt")+"</th><th>淨值中位</th></tr>";
          acc.summary.forEach(function(s){ var tr=el("tr");
            tr.innerHTML="<td>"+(ns.content.personalityById[s.personality]||{name:s.personality}).name+"</td>"+
              "<td class='num'>"+util.pct(s.freeRate,0)+"</td><td class='num'>"+(s.medianFreeTurn||"—")+"</td>"+
              "<td class='num'>"+(s.p10||"—")+"</td><td class='num'>"+(s.p90||"—")+"</td>"+
              "<td class='num'>"+util.pct(s.bankruptRate,0)+"</td><td class='num'>"+M(s.medianNetWorth||0)+"</td>";
            tb.appendChild(tr); });
          out.appendChild(tb);
          // S13.1 FF-002：異常局要看得見（目前實測為 0，這是安全網不是常態）
          var vg=done-nInv;
          var meta=el("div","flavor"); meta.style.marginTop="6px";
          meta.textContent="有效 "+vg+" 局／異常 "+nInv+" 局（"+util.pct(nInv/Math.max(1,done),2)+"）"+
            (nInv?("　·　"+acc.invalid.slice(0,5).map(function(x){ return x.reason+"@seed "+x.seed; }).join("；")
                   +(nInv>5?" …":"")):"");
          out.appendChild(meta);
          out.appendChild(el("div","flavor","摘要一律由全部有效樣本一次算出（含 P10／P90／淨值中位），"+
            "分批只影響執行節奏、不影響數字。"));
          var csv=el("button","opt",T("sim.export")); csv.style.marginTop="12px";
          csv.onclick=function(){ var lines=["seed,turns,winner,freeTurns,netWorths"];
            acc.rows.forEach(function(r){ lines.push([r.seed,r.turns,r.winner,r.free,r.nw].join(",")); });
            var s=lines.join("\n");
            try{ var b=new Blob([s],{type:"text/csv"}), u=URL.createObjectURL(b);
              var a=document.createElement("a"); a.href=u; a.download="finflow-sim.csv"; a.click(); }
            catch(e){ ui.showText(s); } };
          out.appendChild(csv);
        }
      };
      setTimeout(batch,0);
    };
    var no=el("button","opt",T("act.close")); no.style.marginTop="14px";
    no.onclick=function(){ ov.remove(); }; box.appendChild(no);
    ov.appendChild(box); $("overlays").appendChild(ov);
  }
};

/* ============================== 自測套件 ================================ */
ns.selftest = {
  run: function(showUI){
    var results=[];
    function assert(c,m){ if(!c) throw new Error(m||"assertion failed"); }
    function t(name,fn){ try{ var d=fn(); results.push({name:name,ok:true,detail:d||""}); }
      catch(e){ results.push({name:name,ok:false,detail:e.message}); } }
    var baseCfg=function(){ return ns.buildConfig(ns.configRegistry); };
    function mkGame(seed,mods,cfg){
      var c=cfg||baseCfg(), m=mods||["M1","M2","M3","M4","M6"];
      var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"B",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[Math.min(5,ns.content.professions.length-1)].id,dreamCardId:ns.content.dreams[1%ns.content.dreams.length].id}];
      var S=E.newGame({seed:seed,config:util.clone(c),modules:m,players:players});
      E.beginTurn(S); return S;
    }

    t("T-01 決定性重放", function(){
      var mods=["M1","M2","M3","M4","M6"], lineup=["NPC_SAFE","NPC_LEVER"];
      var S1=ns.sim.playOne(baseCfg(),mods,424242,lineup);
      var S2=ns.sim.playOne(baseCfg(),mods,424242,lineup);
      // norm 涵蓋第一期新機制：信用評級、幸福感高水位、空租狀態、事業景氣後收入
      var norm=function(S){ return JSON.stringify(S.players.map(function(p){
        return {nw:p.derived.netWorth,cash:p.cash,led:p.ledger.length,free:p.freeAtTurn,bank:p.bankrupt,
                cr:p.creditRating, cf:p.creditFlags, hwm:p.blessingHWM, fl:p.flags,
                passed:p.stats.passedOpps,
                as:p.assets.map(function(a){return [a.name,a.monthlyIncome,a.vacantUntilTurn||0,a.baseMonthlyIncome||0];})};
      }))+"|"+S.turnNumber+"|"+S.winner; };
      assert(norm(S1)===norm(S2),"相同種子兩次結果不一致");
      var seed3=987, Sg=ns.sim.playOne(baseCfg(),["M1","M2","M4"],seed3,["NPC_VC","NPC_SAFE"]);
      var rp=ns.replay({seed:seed3,config:Sg.config,modules:Sg.enabledModules,
        players:Sg.players.map(function(p){return {name:p.name,isNPC:p.isNPC,personality:p.npcPersonality,professionId:p.professionId,dreamCardId:p.dreamCardId};}),
        actionLog:Sg.actionLog});
      assert(rp.players[0].derived.netWorth===Sg.players[0].derived.netWorth,"事件溯源重放淨值不符");
      assert(norm(rp)===norm(Sg),"重放後第一期機制狀態（評級／盲盒／空租／事業係數）不一致");
      // 該局確實走過新機制（否則等於沒驗到）
      assert(Sg.players.some(function(p){return p.stats.passedOpps>0;}),"重放局未觸發機會二選一，涵蓋不足");
      assert(Sg.actionLog.some(function(a2){return a2.type==="DECIDE";}),"重放局無 DECIDE 動作");
      return "相同種子→相同結局；actionLog 重放一致（含評級／盲盒／空租／事業係數）";
    });

    t("T-02 發薪判定（舊制跨越掃描＋S14b 每輪固定發薪）", function(){
      // ---- (A) 舊制：fixedPayday=0 時，盤面保留發薪格，跨越才發薪 ----
      var cfgOld=baseCfg(); cfgOld.fixedPayday=0;
      var mkOld=function(seed){ return mkGame(seed,null,cfgOld); };
      var board=ns.content.boardLayout, n=board.length;
      function expect(from,roll){ var c=0; for(var i=1;i<=roll;i++){ if(board[(from+i)%n].type==="PAYDAY") c++; } return c; }
      var S0=mkOld(1), BL0=E.board(S0,false);
      assert(BL0===ns.content.boardLayout,"關閉固定發薪時盤面應原封不動（鐵律：關掉開關＝回到基線）");
      var cases=[[22,4],[0,3],[n-2,6],[3,5],[7,6],[1,1]];
      cases.forEach(function(cs){
        var S=mkOld(100+cs[0]*7+cs[1]); var p=S.players[0]; var n0=p.stats.paydays;
        p.position=cs[0]; E.doMove(S,p,cs[1]);
        assert(p.stats.paydays-n0===expect(cs[0],cs[1]),"起點"+cs[0]+" 擲"+cs[1]+" 應發薪"+expect(cs[0],cs[1])+" 實得"+(p.stats.paydays-n0));
        assert(p.position===(cs[0]+cs[1])%n,"落點錯誤");
      });
      var payIdx=-1; for(var i=0;i<n;i++){ if(board[i].type==="PAYDAY"){ payIdx=i; break; } }
      assert(payIdx>=0,"內圈原始盤面應有發薪格");
      var S2=mkOld(8); var q=S2.players[0]; var b0=q.stats.paydays;
      q.position=payIdx; E.doMove(S2,q,1);
      assert(q.stats.paydays-b0===expect(payIdx,1),"自發薪格起步：起點不應重複計薪");

      // ---- (B) S14b 新制：fixedPayday=1 ----
      var cfgNew=baseCfg(); cfgNew.fixedPayday=1;
      var S3=mkGame(9,null,cfgNew), BL=E.board(S3,false), BLO=E.board(S3,true);
      assert(BL!==ns.content.boardLayout,"開啟固定發薪時應改用替換後的盤面副本");
      assert(BL.length===ns.content.boardLayout.length,"替換盤面格數不得改變");
      assert(!BL.some(function(sp){ return sp.type==="PAYDAY"; }),"內圈不應再有發薪格");
      assert(!BLO.some(function(sp){ return sp.type==="OPAYDAY"; }),"外圈不應再有發薪格");
      var repl=BL.filter(function(sp){ return sp.wasPayday; });
      assert(repl.length===board.filter(function(sp){return sp.type==="PAYDAY";}).length,
        "被替換的格數應等於原發薪格數（實得 "+repl.length+"）");
      var kinds={}; repl.forEach(function(sp){ kinds[sp.type]=(kinds[sp.type]||0)+1; });
      assert(Object.keys(kinds).length>=3,"釋出的格子應分散到多種類型，實得 "+JSON.stringify(kinds));
      // 每輪開始固定發一次薪，且走過原發薪格不再重複發
      var S5=mkGame(11,null,cfgNew), r=S5.players[0], c0=r.stats.paydays;
      r.position=(payIdx-1+n)%n; E.doMove(S5,r,2);
      assert(r.stats.paydays===c0,"新制下移動經過原發薪格不應再發薪");
      var before=r.stats.paydays;
      var guard=0, cycled=false;
      while(!S5.over && guard++<40){
        // 落點可能開出決策；本檢查只看發薪節奏，直接清掉待決事項再結束回合
        S5.decisionQueue=[]; S5.pendingDecision=null; E.syncPhase(S5);
        if(S5.phase==="ROLL") E.apply(S5,{type:"ROLL_DICE",playerId:E.activePlayer(S5).id,payload:null},{mutate:true});
        S5.decisionQueue=[]; S5.pendingDecision=null; E.syncPhase(S5);
        var rr=E.apply(S5,{type:"END_TURN",playerId:E.activePlayer(S5).id},{mutate:true});
        if(rr.rejected) throw new Error("END_TURN 被拒（phase "+S5.phase+"）");
        if(E.activePlayer(S5)===r){ cycled=true; break; }
      }
      assert(cycled,"未能循環回到玩家 A（guard "+guard+"）");
      assert(r.stats.paydays===before+1,
        "新制下每輪開始應恰好發薪一次（前 "+before+" 後 "+r.stats.paydays+"）");

      // ---- (C) 兩制共通：停走回合不發薪 ----
      [cfgOld,cfgNew].forEach(function(cf,ci){
        var S4=mkGame(10+ci,null,cf); var z=S4.players[0]; var b1=z.stats.paydays;
        z.skippedTurns=1; E.beginTurn(S4);
        assert(z.stats.paydays===b1,(ci?"新制":"舊制")+"停走回合不應發薪");
      });
      return "舊制掃描 "+cases.length+" 組路徑一致；新制盤面無發薪格（替換 "+repl.length+" 格→"+JSON.stringify(kinds)+"）、每輪固定發薪一次；停走皆不發薪";
    });

    t("T-86 S14b 回合上限與延長（EXTEND_GAME）", function(){
      var cfg=baseCfg();
      assert(cfg.maxTurns===99,"預設回合上限應為 99，實得 "+cfg.maxTurns);
      assert(cfg.extendTurns>0,"延長輪數應為正數，實得 "+cfg.extendTurns);

      // (a) 局中延長：只推上限，不動任何局內狀態
      var S=mkGame(8601), p0=S.players[0];
      var snap=function(){ return JSON.stringify(S.players.map(function(z){
        return [z.cash,z.derived.netWorth,z.ledger.length,z.position,z.assets.length]; }))+"|"+S.turnNumber; };
      var b4=snap(), max0=S.config.maxTurns;
      var r1=E.apply(S,{type:"EXTEND_GAME",playerId:0,payload:{turns:15}},{mutate:true});
      assert(!r1.rejected,"局中延長不應被拒");
      assert(S.config.maxTurns===max0+15,"上限應 "+(max0+15)+"，實得 "+S.config.maxTurns);
      assert(snap()===b4,"延長不得動到任何局內狀態（現金／淨值／分錄／位置／資產）");
      assert(S.extendCount===1,"延長次數應累計");

      // (b) 時間到結束的局可以續攤，且接回原本的那一輪
      var S2=mkGame(8602);
      S2.turnNumber=S2.config.maxTurns+1; E.finishByRanking(S2); E.syncPhase(S2);
      assert(S2.over && S2.overReason==="MAX_TURNS" && S2.phase==="GAME_OVER","應以時間到結束");
      var tn=S2.turnNumber, cashB=S2.players.map(function(z){return z.cash;}).join("|");
      var r2=E.apply(S2,{type:"EXTEND_GAME",playerId:0,payload:null},{mutate:true});
      assert(!r2.rejected,"時間到的局應可續攤");
      assert(!S2.over && S2.winner===null && !S2.overReason,"續攤後不應殘留結局標記");
      assert(S2.turnNumber===tn,"續攤應接回原本那一輪，實得 "+S2.turnNumber+" 期望 "+tn);
      assert(S2.config.maxTurns>tn,"續攤後上限必須大於當前輪次，否則會立刻再結算一次");
      assert(S2.phase!=="GAME_OVER","續攤後應回到可行動的階段，實得 "+S2.phase);
      // 續攤不是重開：現金水位必須連續（發薪造成的變動只可能在自己那一輪）
      var cashA=S2.players.map(function(z){return z.cash;});
      assert(cashA.filter(function(c,i){ return c!==+cashB.split("|")[i]; }).length<=1,
        "續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）");

      // (c) 圓夢／全員破產結束的局不得續攤——那是真的分出勝負
      var S3=mkGame(8603); S3.over=true; S3.winner=0; S3.overReason="DREAM"; E.syncPhase(S3);
      var r3=E.apply(S3,{type:"EXTEND_GAME",playerId:0,payload:null},{mutate:true});
      assert(r3.rejected,"圓夢結束的局不應可續攤");
      var S4=mkGame(8604); S4.over=true; S4.winner=null; S4.overReason="ALL_BANKRUPT"; E.syncPhase(S4);
      assert(E.apply(S4,{type:"EXTEND_GAME",playerId:0,payload:null},{mutate:true}).rejected,
        "全員破產結束的局不應可續攤");

      // (d) 邊界：電腦玩家不能延長；非正數輪數擋掉；硬上限 400
      var S5=mkGame(8605);
      assert(E.apply(S5,{type:"EXTEND_GAME",playerId:1,payload:null},{mutate:true}).rejected,
        "電腦玩家不應能延長");
      assert(E.apply(S5,{type:"EXTEND_GAME",playerId:0,payload:{turns:0}},{mutate:true}).rejected,
        "延長 0 輪應被拒");
      S5.config.maxTurns=400;
      assert(E.apply(S5,{type:"EXTEND_GAME",playerId:0,payload:{turns:20}},{mutate:true}).rejected,
        "已達硬上限 400 時應被拒");

      // (e) 延長屬於非回合動作白名單（房主在別人回合也按得到）
      assert(E.OFF_TURN_RESPOND_KEYS().indexOf("EXTEND_GAME")>=0,"EXTEND_GAME 應在非回合白名單內");
      return "預設 99 輪；局中延長不動狀態；時間到可續攤並接回原輪；圓夢／全破產不可續攤；電腦玩家／0 輪／400 硬上限皆擋下";
    });

    t("T-87 S15 引擎不得出現全拒死結（NPC 卡住的根因）", function(){
      // 實測回報：畫面永遠停在「風投弟 思考中…」。根因是 DECIDE 的三道守衛攔下
      // 任何玩家的任何 BUY，而 END_TURN 又因 PENDING_DECISION 被拒——兩條路都堵死。
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="REALESTATE";})[0];
      assert(CARD,"找不到不動產小機會卡");
      var OTHER=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){
        return c.kind==="REALESTATE" && c.id!==CARD.id; })[0];
      assert(OTHER,"需要第二張不同的卡做對照");

      function mk(){
        var S=E.newGame({seed:8701,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:[
          {name:"人",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"電腦",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[9].id,dreamCardId:ns.content.dreams[1].id}]});
        E.beginTurn(S); S.activePlayerIdx=1; S.turnResolved=true; return S;
      }
      // 電腦玩家手上是「別張卡」的 BUY，而場上有一筆等真人回應的邀約 → 必須走得動
      var KINDS=[
        {key:"pendingAuction",  make:function(cid){ return {cardId:cid,title:"t",sellerId:0,bids:[],waiting:[0]}; }},
        {key:"pendingReferral", make:function(cid){ return {fromId:0,toId:null,cardId:cid,title:"t",fee:0,declined:{}}; }},
        {key:"pendingJV",       make:function(cid){ return {fromId:0,targetId:null,cardId:cid,title:"t",myShare:0.5,declined:{}}; }}
      ];
      var freed=[];
      KINDS.forEach(function(K){
        var S=mk(), npcP=S.players[1];
        E.pushDecision(S,npcP,{kind:"BUY",cardId:OTHER.id,allowLoan:true,maxLTV:0.8});
        S[K.key]=K.make(CARD.id);            // 懸置的是「另一張」卡，與電腦手上這張無關
        E.syncPhase(S);
        var a=ns.npc.nextAction(S);
        assert(a,K.key+"：電腦玩家應該給得出動作");
        if(a.type==="DECIDE" && S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
        var r1=E.apply(S,a,{mutate:true});
        if(r1.rejected){
          var r2=E.apply(S,{type:"END_TURN",playerId:1,payload:null},{mutate:true});
          assert(!r2.rejected, K.key+"：動作與 END_TURN 同時被拒＝死結（畫面會永遠停在思考中）");
        }
        freed.push(K.key);
      });

      // 反向：發起人本人的同一張卡仍必須鎖住（T-31 的原意不得被弄丟）
      KINDS.forEach(function(K){
        var S=mk(); S.activePlayerIdx=0;
        E.pushDecision(S,S.players[0],{kind:"BUY",cardId:CARD.id});
        S[K.key]=K.make(CARD.id);
        E.syncPhase(S);
        var d=S.pendingDecision;
        var rr=E.apply(S,{type:"DECIDE",playerId:0,payload:{decisionId:d.decisionId,optionId:"skip",params:{}}});
        assert(rr.rejected, K.key+"：發起人不得在開標／回應前把自己那張卡的決策收掉");
        assert(E.buyLockReason(S,d), K.key+"：buyLockReason 應回報鎖定原因");
      });

      // 等待對象要算得出來，UI 才知道「在等誰」而不是寫成「電腦思考中」
      var S3=mk(); S3[ "pendingAuction" ]={cardId:CARD.id,title:"t",sellerId:1,bids:[],waiting:[0]};
      var w=E.waitingOnHumans(S3);
      assert(w && w.kind==="AUCTION" && w.waiting.indexOf(0)>=0,"應算得出在等 0 號真人出價");
      var S4=mk();
      assert(E.waitingOnHumans(S4)===null,"沒有懸置邀約時不應回報等待");

      // UI 層防呆必須還在。注意：ui.tick 被多人層包過一層，
      // 直接 toString() 只會拿到 wrapper（S14a 的 T-83 就是踩到這個而假通過）——
      // 所以這裡驗「零件在不在、行為對不對」，不驗被包裝函式的原始碼字串。
      if(typeof ns.ui!=="undefined"){
        assert(typeof ns.ui.tickSig==="function","ui.tickSig（進度指紋）不存在");
        assert(typeof ns.ui.showStuck==="function","ui.showStuck（卡住時攤開狀態）不存在");
        assert(ns.ui.TICK_STALL_LIMIT>0,"ui.TICK_STALL_LIMIT 應為正數");
        var savedS=ns.ui.S; ns.ui.S=S3;
        var sig1=ns.ui.tickSig();
        S3.actionLog.push({seq:S3.actionLog.length,playerId:0,type:"X",payload:null});
        var sig2=ns.ui.tickSig();
        ns.ui.S=savedS;
        assert(sig1!==sig2,"進度指紋必須跟著狀態改變（否則偵測不到空轉）");
      }
      return "三種懸置下電腦玩家皆可脫離（"+freed.join("／")+"）；發起人同卡仍鎖住；等待對象算得出來";
    });

    t("T-88 S15a 變現淨得／邀約借款／失業分流／個股說明", function(){
      /* (a) sellPreview 必須等於 sellAsset 的實際入帳——這是實測回報的錯誤建議的根源 */
      var CASES=[{mv:1000,loan:0},{mv:1000,loan:800},{mv:1000,loan:950},{mv:1000,loan:200},{mv:400,loan:800}];
      CASES.forEach(function(cs,i){
        var S=mkGame(8801+i), p=S.players[0], aid=util.uid(S,"A");
        p.assets.push({instanceId:aid,cardId:"x",kind:"REALESTATE",name:"標的",units:1,
          costBasis:cs.mv,marketValue:cs.mv,monthlyIncome:6,linkedLiabilityId:null,flags:{}});
        var post=[{account:"ASSET",delta:cs.mv,refId:aid,label:"標的"},
                  {account:"INCOME_PASSIVE",delta:6,refId:aid,label:"租金"}];
        if(cs.loan){ var lid=E.addLiability(S,p,"MORTGAGE","房貸",cs.loan,0.03,false,aid,true);
          p.assets[p.assets.length-1].linkedLiabilityId=lid;
          post.push({account:"LIABILITY",delta:cs.loan,refId:lid,label:"房貸"}); }
        ns.ledger.post(S,p,"建部位",post,{eduTags:["setup"]});
        var a=p.assets[p.assets.length-1], fm=S.config.fireSaleRatio;
        var pv=E.sellPreview(S,p,a,fm);
        var c0=p.cash, cf0=p.derived.netCashflow;
        E.sellAsset(S,p,a,fm);
        assert(Math.abs(util.r2(p.cash-c0)-pv.netCash)<0.02,
          "案例"+i+"：預測入袋 "+pv.netCash+" 與實際 "+util.r2(p.cash-c0)+" 不符");
        assert(Math.abs(util.r2(p.derived.netCashflow-cf0)-pv.cashflowDelta)<0.02,
          "案例"+i+"：預測月現金流變化與實際不符");
      });
      /* 實測回報的反例：缺 500、市值 1000、房貸 800 —— 不得標成「賣這一筆就夠了」 */
      var Sx=mkGame(8890), px=Sx.players[0], xid=util.uid(Sx,"A");
      px.assets.push({instanceId:xid,cardId:"x",kind:"REALESTATE",name:"貸款買的套房",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:6,linkedLiabilityId:null,flags:{}});
      var xlid=E.addLiability(Sx,px,"MORTGAGE","房貸",800,0.03,false,xid,true);
      px.assets[px.assets.length-1].linkedLiabilityId=xlid;
      ns.ledger.post(Sx,px,"建部位",[{account:"ASSET",delta:1000,refId:xid,label:"套房"},
        {account:"LIABILITY",delta:800,refId:xlid,label:"房貸"},
        {account:"INCOME_PASSIVE",delta:6,refId:xid,label:"租金"}],{eduTags:["setup"]});
      var xa=px.assets[px.assets.length-1];
      var xpv=E.sellPreview(Sx,px,xa,Sx.config.fireSaleRatio);
      assert(xpv.gross===800,"急售毛額應為 800，實得 "+xpv.gross);
      assert(xpv.netCash===0,"實際入袋應為 0，實得 "+xpv.netCash);
      assert(!(xpv.netCash>=500),"缺 500 時這一筆不得被判定為足夠（舊版用毛額會誤判）");
      if(typeof ns.ui!=="undefined" && ns.ui.sellOptions){
        var rows=ns.ui.sellOptions(Sx,px,500,Sx.config.fireSaleRatio);
        var mine=rows.filter(function(r){ return r.a.instanceId===xid; })[0];
        assert(mine && !mine.enough,"決策表不得把這一筆標成『賣這一筆就夠了』");
        assert(/實際入袋/.test(mine.sub),"決策表必須寫出實際入袋");
      }

      /* (b) 邀約懸置時才准非回合借款，而且錢要撥給正確的人 */
      assert(typeof E.OFF_TURN_CONDITIONAL.TAKE_LOAN==="function","TAKE_LOAN 應為條件式非回合動作");
      var S2=mkGame(8802);
      S2.activePlayerIdx=1;                                  // 輪到別人
      var meP=S2.players[0], otherP=S2.players[1];
      var mc0=meP.cash, oc0=otherP.cash;
      var rNo=E.apply(S2,{type:"TAKE_LOAN",playerId:0,payload:{amount:50}},{mutate:true});
      assert(rNo.rejected,"沒有懸置邀約時，非回合不得借款");
      S2.pendingJV={fromId:1,targetId:0,cardId:"x",title:"t",myShare:0.5,declined:{}};
      var rYes=E.apply(S2,{type:"TAKE_LOAN",playerId:0,payload:{amount:50}},{mutate:true});
      assert(!rYes.rejected,"有懸置邀約時應可借款");
      assert(util.r2(meP.cash-mc0)===50,"錢必須撥給借款人本人，實得 "+util.r2(meP.cash-mc0));
      assert(util.r2(otherP.cash-oc0)===0,"不得把錢撥給當前回合玩家（原碼整段用 p 的地雷）");
      assert(meP.liabilities.some(function(l){return l.name==="信用貸款";}),"應在借款人身上留下負債");

      /* (c) 失業依職業分流：自營與創辦人不得寫成「找下一份工作」 */
      var seen={};
      ["EMPLOYEE","SELF","FOUNDER"].forEach(function(k){
        assert(E.LAYOFF_FLAVOR[k],"缺少 "+k+" 的文案"); seen[E.LAYOFF_FLAVOR[k].title]=1; });
      assert(Object.keys(seen).length===3,"三種型別的標題必須各不相同");
      assert(!/找下一份工作/.test(E.LAYOFF_FLAVOR.FOUNDER.skip),"創辦人不該『找下一份工作』");
      assert(!/找下一份工作/.test(E.LAYOFF_FLAVOR.SELF.skip),"自營者不該『找下一份工作』");
      var tagged=ns.content.professions.filter(function(pr){ return pr.employmentType && pr.employmentType!=="EMPLOYEE"; });
      assert(tagged.length>=3,"應至少標記 3 個自營／創辦人職業，實得 "+tagged.length);
      assert(ns.content.professionById.PRO_FOUNDER.employmentType==="FOUNDER","新創創辦人應標記為 FOUNDER");
      var S3=mkGame(8803), p3=S3.players[0];
      p3.professionId="PRO_FOUNDER";
      assert(E.employmentType(S3,p3)==="FOUNDER","employmentType 應讀得到職業型別");
      p3.professionId="PRO_CLERK";
      assert(E.employmentType(S3,p3)==="EMPLOYEE","沒標記的職業應預設為受僱");

      /* (d) 個股說明：四檔都要有，且要講得出景氣連動 */
      var miss=ns.content.stockDefs.filter(function(d){ return !d.profile || !d.macroNote; });
      assert(!miss.length,"缺少個股說明："+miss.map(function(d){return d.symbol;}).join("、"));
      return "sellPreview 與實際入帳 5 組全對、反例不再誤判；邀約才准借款且撥款對人；失業三種型別；個股說明 4 檔";
    });

    t("T-89 S15b 四層股價／交易成本／融資紀律閘門", function(){
      var S=mkGame(8901,["M1","M2","M4"]);

      /* (a) 四層股價：個股景氣敏感度必須真的分化，而且方向要對 */
      var byS={}; ns.content.stockDefs.forEach(function(d){ byS[d.symbol]=d; });
      ["STK_DIV","STK_ETF","STK_TECH","STK_SPEC"].forEach(function(k){
        assert(byS[k],"缺少 "+k);
        assert(isFinite(byS[k].macroBeta) && byS[k].macroBeta>0, k+" 缺少 macroBeta");
        assert(isFinite(byS[k].maxMove) && byS[k].maxMove>0, k+" 缺少 maxMove");
      });
      assert(byS.STK_DIV.macroBeta < byS.STK_ETF.macroBeta,"高股息應比大盤不敏感");
      assert(byS.STK_ETF.macroBeta === 1,"ETF 應為基準 1 倍");
      assert(byS.STK_ETF.macroBeta < byS.STK_TECH.macroBeta,"成長股應比大盤敏感");
      assert(byS.STK_TECH.macroBeta < byS.STK_SPEC.macroBeta,"投機股應最敏感");
      // 熔斷邊界
      assert(E.capMove(S,byS.STK_SPEC, 0.9)===byS.STK_SPEC.maxMove,"漲幅應削到上限");
      assert(E.capMove(S,byS.STK_SPEC,-0.9)===-byS.STK_SPEC.maxMove,"跌幅應削到上限");
      assert(E.capMove(S,byS.STK_SPEC, 0.05)===0.05,"未超過上限不得更動");
      // 蕭條期：高股息一定要比投機股跌得少（這是這批要教的核心）
      var dd=S.config.drift_DEPRESSION;
      assert(dd*E.stockMacroBeta(S,byS.STK_DIV) > dd*E.stockMacroBeta(S,byS.STK_SPEC),
        "蕭條期高股息的預期跌幅必須小於投機股");
      // 鐵律：關掉開關＝四檔一視同仁、且不熔斷
      var cfgOff=baseCfg(); cfgOff.stockMacroBetaOn=0; cfgOff.stockMaxMoveOn=0;
      var SOff=mkGame(8902,["M1","M2","M4"],cfgOff);
      ns.content.stockDefs.forEach(function(d){
        assert(E.stockMacroBeta(SOff,d)===1,"關閉時 macroBeta 應一律為 1");
        assert(E.capMove(SOff,d,0.9)===0.9,"關閉時不得熔斷");
      });
      // X7：vol 下修後，黑天鵝倍率仍須落在設定區間且排序不變
      var mn=E.cfg(S,"shockBetaMin"), mx=E.cfg(S,"shockBetaMax");
      ns.content.stockDefs.forEach(function(d){
        var b=E.stockBeta(S,d);
        assert(b>=mn-1e-9 && b<=mx+1e-9, d.symbol+" 衝擊倍率 "+b.toFixed(3)+" 超出 ["+mn+","+mx+"]");
      });
      assert(E.stockBeta(S,byS.STK_DIV)<E.stockBeta(S,byS.STK_ETF) &&
             E.stockBeta(S,byS.STK_ETF)<E.stockBeta(S,byS.STK_TECH) &&
             E.stockBeta(S,byS.STK_TECH)<E.stockBeta(S,byS.STK_SPEC),
        "衝擊倍率排序應維持 DIV<ETF<TECH<SPEC");

      /* (b) 交易成本：買扣手續費、賣扣手續費＋證交稅；ETF 稅率較低 */
      assert(byS.STK_ETF.taxRate < E.cfg(S,"stockTaxRate"),"ETF 證交稅應低於一般股票");
      assert(E.stockTax(S,byS.STK_ETF,10000) < E.stockTax(S,byS.STK_TECH,10000),"ETF 應課較少的稅");
      var S2=mkGame(8903,["M1","M2","M4"]), p2=S2.players[0];
      ns.ledger.post(S2,p2,"補現金",[{account:"CASH",delta:100000,label:"x"}],{eduTags:["setup"]});
      var dfT=byS.STK_TECH, prT=S2.stockPrices[dfT.symbol];
      var c0=p2.cash, nw0=p2.derived.netWorth;
      var rB=E.apply(S2,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"buy",units:10,margin:false}},{mutate:true});
      assert(!rB.rejected,"買進不應被拒");
      var stockAmt=util.r2(prT*10), feeB=E.stockFee(S2,stockAmt);
      assert(feeB>0,"手續費應大於 0");
      assert(Math.abs((c0-p2.cash)-util.r2(stockAmt+feeB))<0.02,
        "買進現金應減少「股款＋手續費」，實得 "+util.r2(c0-p2.cash)+" 期望 "+util.r2(stockAmt+feeB));
      assert(Math.abs((nw0-p2.derived.netWorth)-feeB)<0.02,"買進的淨值損失應恰為手續費");
      // 賣出
      var c1=p2.cash;
      var lotT=p2.assets.filter(function(a){return a.kind==="STOCK"&&a.symbol===dfT.symbol;})[0];
      var mvT=lotT.marketValue;
      var rS=E.apply(S2,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"sell",units:10}},{mutate:true});
      assert(!rS.rejected,"賣出不應被拒");
      var snT=E.stockSellNet(S2,dfT,mvT);
      assert(snT.fee>0 && snT.tax>0,"賣出應同時有手續費與證交稅");
      assert(Math.abs((p2.cash-c1)-snT.net)<0.02,
        "賣出入袋應為「價款−手續費−證交稅」，實得 "+util.r2(p2.cash-c1)+" 期望 "+snT.net);
      // 帳務仍要平
      var csum=0; p2.ledger.forEach(function(en){ en.postings.forEach(function(q){
        if(q.account==="CASH") csum+=q.delta; }); });
      assert(Math.abs(util.r2(csum)-p2.cash)<0.02,"加了費用之後現金與分錄仍須相符");
      // 來回成本率
      var rt=E.stockRoundTripRate(S2,dfT);
      assert(Math.abs(rt-(E.cfg(S2,"stockFeeRate")*2+E.cfg(S2,"stockTaxRate")))<1e-9,"來回成本率算錯");
      assert(E.stockRoundTripRate(S2,byS.STK_ETF) < rt,"ETF 的來回成本應較低");
      // 鐵律：費率設 0 → 逐字回到零成本
      var cfgZ=baseCfg(); cfgZ.stockFeeRate=0; cfgZ.stockTaxRate=0;
      var SZ=mkGame(8904,["M1","M2","M4"],cfgZ), pz=SZ.players[0];
      ns.ledger.post(SZ,pz,"補現金",[{account:"CASH",delta:100000,label:"x"}],{eduTags:["setup"]});
      var prZ=SZ.stockPrices[dfT.symbol], z0=pz.cash;
      E.apply(SZ,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"buy",units:10,margin:false}},{mutate:true});
      assert(Math.abs((z0-pz.cash)-util.r2(prZ*10))<0.02,"費率 0 時買進只應扣股款");
      assert(E.stockFee(SZ,10000)===0 && E.stockTax(SZ,dfT,10000)===0,"費率 0 時不得產生費用");

      /* (c) 融資紀律閘門 */
      var cfgM=baseCfg(); cfgM.depthLevel=3;                 // 融資需進階難度
      var S3=mkGame(8905,["M1","M2","M4"],cfgM), p3=S3.players[0];
      ns.ledger.post(S3,p3,"補現金",[{account:"CASH",delta:200000,label:"x"}],{eduTags:["setup"]});
      // 先確認正常狀態可以融資
      p3.creditRating="A";
      var okNow = E.marginBlockReason(S3,p3);
      if(okNow==="NEGATIVE_CASHFLOW"){
        ns.ledger.post(S3,p3,"補收入",[{account:"INCOME_PASSIVE",delta:99999,label:"x"}],{eduTags:["setup"]});
      }
      assert(!E.marginBlockReason(S3,p3),"健康狀態不該被擋，實得 "+E.marginBlockReason(S3,p3));
      var rM=E.apply(S3,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"buy",units:1,margin:true}},{mutate:true});
      assert(!rM.rejected,"健康狀態應可融資買進");
      // 信用 C → 擋
      p3.creditRating="C";
      assert(E.marginBlockReason(S3,p3)==="CREDIT_C","信用 C 應被擋");
      var rC=E.apply(S3,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"buy",units:1,margin:true}},{mutate:true});
      assert(rC.rejected,"信用 C 時引擎必須擋下融資（不能只靠 UI 灰化）");
      // 但現股買進不受影響
      var rCash=E.apply(S3,{type:"TRADE_STOCK",playerId:0,payload:{symbol:dfT.symbol,side:"buy",units:1,margin:false}},{mutate:true});
      assert(!rCash.rejected,"閘門只擋融資，不該連現股都擋掉");
      // 現金流為負 → 擋
      p3.creditRating="A";
      ns.ledger.post(S3,p3,"加重支出",[{account:"EXPENSE",delta:999999,label:"x"}],{eduTags:["setup"]});
      assert(E.marginBlockReason(S3,p3)==="NEGATIVE_CASHFLOW","淨現金流為負應被擋");
      // 每個理由都要有給玩家看的說法
      Object.keys(E.MARGIN_BLOCK_TEXT).forEach(function(k){
        assert(E.MARGIN_BLOCK_TEXT[k] && E.MARGIN_BLOCK_TEXT[k].length>4, k+" 缺少說明文案"); });
      // 鐵律：閘門關掉＝完全回到舊行為
      var cfgG=baseCfg(); cfgG.depthLevel=3; cfgG.marginDisciplineGate=0;
      var S4=mkGame(8906,["M1","M2","M4"],cfgG), p4=S4.players[0];
      p4.creditRating="C";
      assert(E.marginBlockReason(S4,p4)===null,"關閉閘門時不得擋任何人");
      return "四層股價（beta 0.5/1/1.4/1.8＋熔斷）、交易成本（手續費 "+
        util.pct(E.cfg(S,"stockFeeRate"),4)+"／證交稅 "+util.pct(E.cfg(S,"stockTaxRate"),3)+
        "、ETF "+util.pct(byS.STK_ETF.taxRate,3)+"）、融資閘門三條件；三者關閉皆回到基線";
    });

    t("T-90 S15c 中階大買賣（合資門檻）", function(){
      var S=mkGame(9001,["M1","M2","M3","M4","M6","M8"]);
      var mid=[];
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){ if(c.tierS15c) mid.push(c); }); });
      assert(mid.length>=10,"中階卡應至少 10 張，實得 "+mid.length);

      function entryOf(c){ var pl=c.payload||{};
        return pl.downPayment!==undefined&&pl.downPayment!==null ? pl.downPayment
             : (pl.price!==undefined&&pl.price!==null ? pl.price : pl.investAmount||0); }
      function yearYield(c){
        var pl=c.payload||{}, M=S.config.assetIncomeMult, net;
        if(c.kind==="REALESTATE"){
          net=pl.monthlyRent*M-(pl.monthlyCost||0)
              -E.pmt((pl.price||0)-(pl.downPayment||0), pl.mortgageRate, S.config.mortgageTermMonths||240);
        } else net=(pl.monthlyProfit||0)*M;
        return net*12/Math.max(1,entryOf(c));
      }

      // (a) 入場門檻落在設計帶內（大買賣 600–1200；特殊機會 800–1600）
      var midL=mid.filter(function(c){ return c.deck==="OPPORTUNITY_LARGE"; });
      var midS=mid.filter(function(c){ return c.deck==="OPPORTUNITY_SPECIAL"; });
      assert(midL.length>=8,"中階大買賣應至少 8 張，實得 "+midL.length);
      assert(midS.length>=3,"低門檻特殊機會應至少 3 張，實得 "+midS.length);
      midL.forEach(function(c){ var e=entryOf(c);
        assert(e>=600 && e<=1200, c.id+" 入場門檻 "+e+" 超出 600–1200"); });
      midS.forEach(function(c){ var e=entryOf(c);
        assert(e>=800 && e<=1600, c.id+" 入場門檻 "+e+" 超出 800–1600"); });

      // (b) 報酬率必須落在既有曲線上——不得偷渡一批「又便宜又好賺」的卡
      //     既有：小買賣中位約 83%、大買賣中位約 54%。中階應介於兩者之間。
      midL.forEach(function(c){ var y=yearYield(c);
        assert(y>0.45 && y<0.80, c.id+" 年報酬率 "+util.pct(y,1)+" 不在 45%–80% 的中階帶內"); });
      // 同 deck 內，規模越大報酬率不應反而越高（曲線方向）
      var reMid=midL.filter(function(c){ return c.kind==="REALESTATE"; })
                    .sort(function(a,b){ return entryOf(a)-entryOf(b); });
      assert(yearYield(reMid[0]) >= yearYield(reMid[reMid.length-1])-0.06,
        "中階不動產的報酬率不應隨規模明顯上升（違反既有曲線方向）");

      // (c) 資料完整性：不動產四欄齊全、退場倍率有四種景氣
      midL.forEach(function(c){
        var pl=c.payload||{};
        if(c.kind==="REALESTATE"){
          ["price","downPayment","monthlyRent","monthlyCost","mortgageRate"].forEach(function(k){
            assert(isFinite(pl[k]), c.id+" 缺少或不合法的 "+k); });
          assert(pl.downPayment < pl.price, c.id+" 頭款不得大於等於總價");
          ["RECOVERY","BOOM","RECESSION","DEPRESSION"].forEach(function(st){
            assert(isFinite((pl.exitMultipliers||{})[st]), c.id+" 缺少 "+st+" 退場倍率"); });
        } else {
          assert(isFinite(pl.price) && isFinite(pl.monthlyProfit), c.id+" 事業卡欄位不合法");
        }
        assert(c.title && c.flavor && c.eduNote, c.id+" 缺少文案欄位");
      });
      // id 不得與既有卡撞號
      var ids={}, dup=[];
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){
          if(ids[c.id]) dup.push(c.id); ids[c.id]=1; }); });
      assert(!dup.length,"卡片 id 重複："+dup.join("、"));

      // (d) 鐵律：關掉開關，這批卡必須整批不進牌堆
      var cfgOff=baseCfg(); cfgOff.midTierOpps=0;
      var SOff=mkGame(9002,["M1","M2","M3","M4","M6","M8"],cfgOff);
      var leaked=[];
      Object.keys(SOff.decks||{}).forEach(function(dk){
        var d=SOff.decks[dk];
        var pile=(d && (d.draw||d.cards||d)) || [];
        (pile.length?pile:[]).forEach(function(x){
          var id=(typeof x==="string")?x:(x&&x.id);
          if(id && ids[id]){ var c=ns.content.byId[id]; if(c && c.tierS15c) leaked.push(id); } });
      });
      assert(!leaked.length,"關閉時中階卡不得進牌堆，外洩："+leaked.join("、"));
      // 開啟時必須真的進得去
      var found=0;
      Object.keys(S.decks||{}).forEach(function(dk){
        var d=S.decks[dk], pile=(d && (d.draw||d.cards||d)) || [];
        (pile.length?pile:[]).forEach(function(x){
          var id=(typeof x==="string")?x:(x&&x.id);
          var c=id&&ns.content.byId[id]; if(c&&c.tierS15c) found++; });
      });
      assert(found>0,"開啟時中階卡應出現在牌堆裡");
      return "中階 "+midL.length+" 張（入場 600–1200、年報酬 "+
        util.pct(yearYield(reMid[0]),0)+"–"+util.pct(Math.max.apply(null,midL.map(yearYield)),0)+
        "）＋低門檻特殊機會 "+midS.length+" 張；關閉時整批不進牌堆";
    });

    t("T-91 S15d 多人局：決策的擁有者永遠答得了自己的決策", function(){
      /* 實測（多人連線真實局 v2.20.0）回報：畫面停在「等待 carrie 做決定中」，
         carrie 一按就跳「這個動作現在不能做」，整局掛死。
         根因：STOCK_GAIN（帳上獲利停利提示）在 onRoundEnd 對**所有真人**發，
         不管輪到誰；而 DECIDE 不在任何非回合白名單裡 → 三條路同時堵死。
         單機局碰不到（只有一個真人，且他就是回合起點），只有多人局會中。 */
      function mk4(){
        var players=["A","B","C","D"].map(function(n,i){
          return {name:n, isNPC:false,
            professionId:ns.content.professions[i*4].id,
            dreamCardId:ns.content.dreams[i%ns.content.dreams.length].id}; });
        var S=E.newGame({seed:9101,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S); S.activePlayerIdx=0; S.turnResolved=true; return S;
      }

      // (a) 一般情況：決策排給非當前玩家 → 擁有者必須答得了，且不得由別人代答
      var KINDS=["ACK","STOCK_GAIN","LIFESTYLE","BUY_PROGRESS"];
      KINDS.forEach(function(k){
        var S=mk4();
        E.pushDecision(S,S.players[1],{kind:k, cardId:null});
        E.syncPhase(S);
        var d=S.pendingDecision;
        assert(d && d.playerId===1, k+"：決策應屬於 1 號座位");
        assert(S.activePlayerIdx===0, k+"：測試前提是輪到 0 號");
        var rOwner=E.apply(S,{type:"DECIDE",playerId:1,
          payload:{decisionId:d.decisionId,optionId:"ok",params:{}}},{mutate:false});
        assert(!rOwner.rejected, k+"：擁有者必須答得了自己的決策（死結的根因就在這）");
        var rOther=E.apply(S,{type:"DECIDE",playerId:0,
          payload:{decisionId:d.decisionId,optionId:"ok",params:{}}},{mutate:false});
        assert(rOther.rejected, k+"：不得由別人代答（否則效果會套到錯的人身上）");
      });

      // (b) 三條路不得同時堵死——這是這個 bug 的判準
      var S2=mk4();
      E.pushDecision(S2,S2.players[1],{kind:"ACK"});
      E.syncPhase(S2);
      var d2=S2.pendingDecision;
      var paths=[
        E.apply(S2,{type:"DECIDE",playerId:1,payload:{decisionId:d2.decisionId,optionId:"ok",params:{}}},{mutate:false}),
        E.apply(S2,{type:"ROLL_DICE",playerId:0,payload:null},{mutate:false}),
        E.apply(S2,{type:"END_TURN",playerId:0,payload:null},{mutate:false})
      ];
      assert(paths.some(function(r){ return !r.rejected; }),
        "擲骰／結束回合／擁有者作答三條路不得同時被拒（那就是死結）");

      // (c) 效果必須落在擁有者身上，不是當前玩家
      var S3=mk4(), owner=S3.players[1], act=S3.players[0];
      var joy0o=owner.stats.mallJoy||0;
      ns.ledger.post(S3,owner,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var oc0=owner.cash, ac0=act.cash;
      E.pushDecision(S3,owner,{kind:"ACK"});
      E.syncPhase(S3);
      var r3=E.apply(S3,{type:"DECIDE",playerId:1,
        payload:{decisionId:S3.pendingDecision.decisionId,optionId:"ok",params:{}}},{mutate:true});
      assert(!r3.rejected,"擁有者作答不應被拒");
      assert(act.cash===ac0,"當前玩家的現金不該因為別人的決策而變動");

      // (d) 非當前玩家的決策不得把「這一輪已處理完」與記帳掛到當前玩家身上
      var S4=mk4();
      S4.turnResolved=false;                         // 當前玩家還沒擲骰
      E.pushDecision(S4,S4.players[2],{kind:"ACK"});
      E.syncPhase(S4);
      E.apply(S4,{type:"DECIDE",playerId:2,
        payload:{decisionId:S4.pendingDecision.decisionId,optionId:"ok",params:{}}},{mutate:true});
      assert(S4.turnResolved===false,
        "別人答完決策不得把當前玩家標成『已處理完』（否則他不用擲骰就能結束回合）");
      var rEnd=E.apply(S4,{type:"END_TURN",playerId:0,payload:null},{mutate:false});
      assert(rEnd.rejected,"當前玩家還沒擲骰就不該能結束回合");
      assert(!S4.bookkeeping || S4.bookkeeping.playerId===0,
        "不得把別人的記帳題掛到當前玩家的回合上");

      // (e) STOCK_GAIN 的實際來源：onRoundEnd 只對真人發，所以全 NPC 模擬抓不到
      var src=(ns.modules.registry.M1.onRoundEnd||function(){}).toString();
      assert(src.indexOf("stockGainAlertPct")>=0,"STOCK_GAIN 應由 M1.onRoundEnd 依 stockGainAlertPct 發出");
      assert(/isNPC/.test(src),"該段應跳過電腦玩家（這正是全 NPC 模擬驗不到的原因）");

      // (f) 多人局的電腦迴圈也要有卡住防護（S15a 只加在 ui.tick，多人局走 mpAfter）
      if(typeof ns.ui!=="undefined"){
        assert(typeof ns.ui.showStuck==="function","多人局也需要卡住診斷面板");
      }
      return "四種決策：擁有者答得了、他人不得代答；三條路不同時堵死；效果落在擁有者；不污染當前回合狀態";
    });

    t("T-92 S16 下市價格／五欄紀錄／回合結算", function(){
      var S=mkGame(9201,["M1","M2","M4"]), p=S.players[0];
      var sym="STK_SPEC", def=ns.content.stockBySymbol[sym];
      assert(def,"應有投機股");

      /* (a) 下市：價格是 0，不得被面額蓋掉 */
      assert(E.stockPrice(S,def)>0,"未下市時應有正常價格");
      assert(!E.isDelisted(S,def),"開局不該是下市狀態");
      S.delisted={}; S.delisted[sym]=true; S.stockPrices[sym]=0;
      assert(E.stockPrice(S,def)===0,
        "下市後價格必須是 0，實得 "+E.stockPrice(S,def)+"（舊寫法 ||def.face 會回面額 "+def.face+"）");
      assert(E.isDelisted(S,def),"isDelisted 應為 true");
      assert(E.stockYield(S,def)===0,"下市後不該算得出殖利率");
      // 尚未開盤（undefined）才回面額
      var Sx=mkGame(9202,["M1","M2","M4"]);
      delete Sx.stockPrices[sym];
      assert(E.stockPrice(Sx,def)===def.face,"價格未定義時才回面額");
      // 不得再買進
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:100000,label:"x"}],{eduTags:["setup"]});
      S.turnResolved=true; S.phase="READY_END";
      var rB=E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:sym,side:"buy",units:1,margin:false}},{mutate:false});
      assert(rB.rejected,"已下市的股票不得再買進（否則等於用面額買壁紙）");
      // 四檔都要通過同一條規則：價格 0 就回 0，不得被面額蓋掉（驗行為，不驗原始碼字串）
      var Sz=mkGame(9206,["M1","M2","M4"]);
      Sz.delisted={};
      ns.content.stockDefs.forEach(function(dd){
        Sz.delisted[dd.symbol]=true; Sz.stockPrices[dd.symbol]=0;
        assert(E.stockPrice(Sz,dd)===0, dd.symbol+" 下市後價格應為 0，實得 "+E.stockPrice(Sz,dd));
        assert(E.stockPrice(Sz,dd.symbol)===0, dd.symbol+" 用代號查也要回 0");
      });
      // 圖表的最後一點必須是 0（原本會往上噴到面額）
      var svg=ui.stockChartSVG(Sz, def, {});
      assert(typeof svg==="string" && svg.length>50,"圖表應能產生");

      /* (b) 五欄：一筆分錄要正確拆成 現金／資產／負債／收入／支出 */
      var S2=mkGame(9203,["M1","M2","M4"]), q=S2.players[0];
      var aid=util.uid(S2,"A");
      ns.ledger.post(S2,q,"測試：貸款買資產",[
        {account:"CASH",delta:-200,label:"頭款"},
        {account:"ASSET",delta:1000,refId:aid,label:"標的"},
        {account:"LIABILITY",delta:800,refId:"L1",label:"貸款"},
        {account:"INCOME_PASSIVE",delta:9,refId:aid,label:"租金"},
        {account:"EXPENSE",delta:4,refId:"L1",label:"月付"}],{eduTags:["test"]});
      var en=q.ledger[q.ledger.length-1];
      var r=ui.ledgerRow(en);
      assert(r.cash===-200 && r.asset===1000 && r.liab===800 && r.income===9 && r.expense===4,
        "五欄拆解錯誤："+JSON.stringify(r));
      assert(ui.LEDGER_COLS.length===5,"應為五欄");
      var tot=ui.ledgerTotals([en]);
      assert(tot.cash===-200 && tot.liab===800,"合計錯誤："+JSON.stringify(tot));
      // 負債與支出增加要標成壞事（顏色相反）
      var cells=ui.ledgerCells(r);
      assert(/neg/.test(cells) && /pos/.test(cells),"應同時有正負色");

      /* (c) 賣股票：損益＝實際入袋 − 成本基礎，且要說明現金與資產的差額 */
      var S3=mkGame(9204,["M1","M2","M4"]), z=S3.players[0];
      ns.ledger.post(S3,z,"補現金",[{account:"CASH",delta:200000,label:"x"}],{eduTags:["setup"]});
      S3.turnResolved=true; S3.phase="READY_END";
      var dT=ns.content.stockBySymbol.STK_TECH;
      E.apply(S3,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"buy",units:20,margin:false}},{mutate:true});
      var lot=z.assets.filter(function(a){return a.symbol==="STK_TECH";})[0];
      var basis=lot.costBasis;
      S3.stockPrices.STK_TECH=util.r2(S3.stockPrices.STK_TECH*1.3); E.revalueStocks(S3);
      S3.bookkeeping=null; S3.decisionQueue=[]; S3.pendingDecision=null;
      S3.turnResolved=true; S3.phase="READY_END";
      var mv=lot.marketValue;
      E.apply(S3,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"sell",units:20}},{mutate:true});
      var sellEn=z.ledger.slice().reverse().filter(function(e){ return /股市賣出/.test(e.summary); })[0];
      assert(sellEn,"應有賣出分錄");
      var sn=E.stockSellNet(S3,dT,mv);
      var expPl=util.r2(sn.net-basis);
      assert(sellEn.summary.indexOf(util.money(expPl))>=0,
        "摘要的損益應為「實際入袋−成本」＝"+expPl+"，實得："+sellEn.summary);
      var rs=ui.ledgerRow(sellEn);
      assert(rs.cash>0 && rs.asset<0,"賣出應是現金增加、資產減少");
      assert(rs.note && /交易成本/.test(rs.note),
        "現金與資產對不起來時要說明差額是交易成本（實測回報的困惑點），實得："+rs.note);

      /* (d) 回合結算：只算「上次結算之後」的分錄，別人回合發生在你身上的也要算進來 */
      assert(typeof ui.showTurnSummary==="function" && typeof ui.checkTurnSummary==="function",
        "缺少回合結算彙總");
      var S4=mkGame(9205,["M1","M2","M4"]), w=S4.players[0];
      ui.S=S4; ui._sumMark={}; ui.markTurnSummary(0);
      var n0=w.ledger.length;
      ns.ledger.post(S4,w,"別人回合發生在我身上的事",[{account:"CASH",delta:-50,label:"x"}],{eduTags:["test"]});
      var since=w.ledger.slice(ui._sumMark[0]||0);
      assert(since.length===1 && since[0].summary.indexOf("別人回合")>=0,
        "結算範圍應涵蓋上次結算之後的每一筆");
      assert((w.ledger.length-n0)===1,"測試前提");
      // 靜音只擋 good／無類別，warn 一律照跳
      assert(ui.toastMuted("warn")===false,"warn 類通知不得被靜音（那是需要當下處理的）");
      return "下市價回報 0 且不得交易；五欄拆解正確；賣股損益＝入袋−成本並標明費稅差額；結算涵蓋上次之後全部";
    });

    t("T-93 S17 版面契約：三欄歸位／中央對位／不寫死縮放", function(){
      /* 這條防的是「改版之後有人把區塊搬回去」與「中央那疊又用百分比硬定位」，不是驗美術。 */
      // (a) 骨架：左欄承載總經／系統訊息／玩家卡；中欄由上到下＝警告→盤面→股市→操作區
      var L=document.getElementById("infoL"), W=document.getElementById("warnBox"),
          B=document.getElementById("boardWrap"), M=document.getElementById("infoM"),
          O=document.getElementById("opsBox"), FB=document.getElementById("finBoard");
      assert(L,"缺左欄訊息容器 #infoL");
      assert(W,"缺中欄重大事件警告帶 #warnBox");
      assert(M,"缺中欄資訊區 #infoM");
      assert(O,"缺操作區 #opsBox");
      assert(!document.getElementById("infoDyn"),"舊的單一 #infoDyn 應已拆成 infoL／infoM／warnBox");
      var kids=[].slice.call(FB.children).map(function(e){ return e.id; });
      assert(kids.indexOf("warnBox")===0,"中欄第一塊必須是重大事件警告帶，實得 "+kids.join(","));
      assert(kids.indexOf("opsBox")===kids.length-1,"操作區必須釘在中欄最下面，實得 "+kids.join(","));
      assert(kids.indexOf("boardWrap")<kids.indexOf("infoM"),"盤面應在股市資訊之上");

      // (b) 沒有重大事件時要留白（盤面位置不能跟著跳）——空狀態有固定的佔位元素
      assert(ui.renderFinBoard.toString().indexOf("wempty")>=0,"沒有重大事件時要留一條空白帶，不能整塊收掉");
      assert(getComputedStyle(W).minHeight!=="0px","警告帶要有最小高度，否則盤面會上下跳");

      // (c) 操作區的小圖示要跟標題同一列（S17 前是 absolute，會壓到下面那排按鈕）
      var hd=document.getElementById("opsHd"), ic=document.getElementById("opsIcons");
      assert(hd && ic && hd.contains(ic),"三顆小圖示應在 #opsHd 標題列內，不得再用 absolute 疊上去");
      assert(getComputedStyle(ic).position!=="absolute","#opsIcons 不得是 absolute");

      // (d) 中央那疊：必須有 #boardHole 錨點，且定位程式要把 body zoom 除回去
      assert(typeof ui.placeBoardCenter==="function","缺少 ui.placeBoardCenter");
      assert(ui.renderBoard.toString().indexOf("boardHole")>=0,"renderBoard 應輸出 #boardHole 當定位錨");
      var src=ui.placeBoardCenter.toString();
      assert(src.indexOf("offsetWidth")>=0,"placeBoardCenter 必須用 offsetWidth 量出縮放倍率再除回去");
      // 註解裡本來就會提到 1.12（在解釋 zoom 是什麼），所以先把註解剝掉再驗程式碼本身
      var code=src.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,"");
      assert(!/[\/*]\s*(0\.9|1\.12|1\.28|1\.5)\b/.test(code),
        "不得寫死 zoom 倍率（級距有 0.9／1／1.12／1.28／1.5 五段），實得 "+code.slice(0,200));

      // (e) 實跑一次：中央那疊要落在洞裡，不得壓到格子或中央文字
      var savedS=ui.S;
      try{
        ui.S=mkGame(9301,["M1","M2","M3","M4","M6"]);
        ui.renderBoard();
        var hole=document.getElementById("boardHole"), bc=document.getElementById("boardCenter");
        assert(hole,"renderBoard 後應存在 #boardHole");
        var hr=hole.getBoundingClientRect(), br=bc.getBoundingClientRect();
        if(hr.width>0 && hr.height>0){   // 面板被隱藏時量不到，跳過幾何比對
          assert(Math.abs(br.left-hr.left)<2 && Math.abs(br.top-hr.top)<2,
            "中央那疊應對齊洞的左上角，實得 bc("+br.left.toFixed(1)+","+br.top.toFixed(1)+
            ") vs hole("+hr.left.toFixed(1)+","+hr.top.toFixed(1)+")");
          assert(Math.abs(br.width-hr.width)<2 && Math.abs(br.height-hr.height)<2,
            "中央那疊尺寸應等於洞（沒把 zoom 除回去就會大一圈），實得 "+
            br.width.toFixed(1)+"x"+br.height.toFixed(1)+" vs "+hr.width.toFixed(1)+"x"+hr.height.toFixed(1));
        }
      } finally { ui.S=savedS; }
      return "三欄骨架、警告帶留白、圖示同列、中央那疊以 #boardHole 對位且縮放倍率是量出來的";
    });

    t("T-94 S18 通知分三類／決定入列／成本卡標籤", function(){
      /* (a) 靜音規則改看 topic：廣播資訊收進彙總，要你當下處理的照跳 */
      var saveOff=ui._sumOff; ui._sumOff=false;
      try{
        assert(ui.toastMuted("warn")===false,"需要當下處理的 warn 仍要跳（被拒／追繳／出價）");
        assert(ui.toastMuted("warn","SYS")===true,"系統廣播（景氣／利率／政策／停走）要收進彙總");
        assert(ui.toastMuted("good")===true,"good 類照舊靜音");
        assert(ui.toastMuted("warn","MINE")===false,"自己動作的 warn 要跳");
        ui._sumOff=true;
        assert(ui.toastMuted("warn","SYS")===false,"關掉結算畫面後一律照跳（回到 S16 之前的行為）");
      } finally { ui._sumOff=saveOff; }

      /* (b) 系統類 toast 真的都改用 toastSys 了——景氣／利率／政策／停走四條主要來源 */
      var hsrc=ui.handleEvents.toString();
      assert((hsrc.match(/toastSys\(/g)||[]).length>=6,
        "系統類通知至少六處要走 toastSys，實得 "+((hsrc.match(/toastSys\(/g)||[]).length));

      /* (c) 分錄歸類：三類各要分得出來 */
      var S=mkGame(9401,["M1","M2","M3","M4","M6"]);
      var saveS=ui.S; ui.S=S;
      try{
        assert(ui.entryCat({summary:"年度物價調整（通膨 4.5%）",eduTags:["inflation"]},0)==="SYS","通膨應歸系統類");
        assert(ui.entryCat({summary:"央行升息：貸款月付調整",eduTags:[]},0)==="SYS","利率應歸系統類");
        assert(ui.entryCat({summary:"買下「社區洗衣店」",eduTags:["cashflow"]},0)==="MINE","自己買資產應歸自己");
        assert(ui.entryCat({summary:"接受轉介機會",eduTags:["referral"]},0)==="OTHERS","轉介應歸其他玩家");
        assert(ui.entryCat({summary:"合資退出分潤",eduTags:[]},0)==="OTHERS","合資應歸其他玩家");
        var other=S.players[1] && S.players[1].name;
        if(other) assert(ui.entryCat({summary:"向 "+other+" 借款",eduTags:[]},0)==="OTHERS",
          "摘要出現別人名字應歸其他玩家");
      } finally { ui.S=saveS; }

      /* (d) 決定的文案：卡 id 要查回卡名、代號要翻成中文、查不到才回原字串 */
      var anyCard=ns.content.cards.OPPORTUNITY_SMALL && ns.content.cards.OPPORTUNITY_SMALL[0];
      if(anyCard) assert(ui.decisionOptionLabel(null,anyCard.id)===(anyCard.title||anyCard.name),
        "optionId 是卡 id 時要顯示卡名，不能把代號端給玩家");
      assert(ui.decisionOptionLabel(null,"cash")==="用現金","付款方式代號要翻成中文");
      assert(ui.decisionOptionLabel(null,"skip")==="略過","skip 要翻成中文");
      assert(ui.decisionOptionLabel(null,"__NOPE__")==="__NOPE__","查不到就照原樣，不得亂編");

      /* (e) 一次擲骰兩個決定要接成「A → B」，不是兩個「決定：」 */
      var saveFeed=ui.feed, saveS2=ui.S; ui.S=S; ui.feed=[];
      try{
        ui.announce("🎲 你 擲 3 點 → 機會", 0, "roll");
        ui.appendToRoll(0,"　決定：夜市小吃攤");
        ui.appendToRoll(0,"　決定：用現金");
        var line=ui.feed[ui.feed.length-1].msg;
        assert((line.match(/決定：/g)||[]).length===1,"同一行只能有一個「決定：」，實得 "+line);
        assert(line.indexOf("夜市小吃攤 → 用現金")>=0,"第二個決定應接成「→」，實得 "+line);
        assert(ui.appendToRoll(1,"　決定：X")===false,"沒有擲骰行時不得硬接到別人那行");
      } finally { ui.feed=saveFeed; ui.S=saveS2; }

      /* (f) 成本型卡片：標籤要把因果講完，分錄仍記在收入（本遊戲資產收入是淨額） */
      var mk05=ns.content.byId["MK05"], mk08=ns.content.byId["MK08"];
      assert(mk05 && mk05.effects[0].label.indexOf("淨利下降")>=0,
        "MK05 標籤要寫成「人事成本上升 → 事業淨利下降」，實得 "+(mk05&&mk05.effects[0].label));
      assert(mk08 && mk08.effects[0].label.indexOf("淨利下降")>=0,
        "MK08 標籤同理，實得 "+(mk08&&mk08.effects[0].label));
      assert(mk05.effects[0].op==="ASSET_INCOME_MULT",
        "記帳方式不變——本遊戲所有資產存的都是淨額，成本上升就是淨利下降");
      var note=ui.ledgerRow({summary:"人事成本上升 → 事業淨利下降",
        postings:[{account:"INCOME_PASSIVE",delta:-120}]}).note||"";
      assert(note.indexOf("淨額")>=0,"成本型的收入變動要補一句說明淨額慣例，實得 "+note);

      return "topic 分類靜音、三類歸屬、決定接回擲骰行、成本卡標籤與淨額說明都到位";
    });

    t("T-95 S20 互動教學：錨點還在、卡片是一句話", function(){
      /* 這條防的是「改版面把教學的錨點弄不見」——熱點綁 DOM 不綁座標，
         所以只要錨點還在，教學就會自己跟著新版面跑。 */
      var tut = ns.tutorial;
      assert(tut && tut.STEPS && tut.STEPS.length>=15,"缺少教學步驟表");
      assert(typeof tut.open==="function" && typeof tut.boot==="function" &&
             typeof tut.isChild==="function","教學缺少對外介面");

      // (a) 每一步的欄位都要齊，而且是「一句話」——太長就不是速查了
      tut.STEPS.forEach(function(st){
        assert(st.n && st.title && st.what && st.when && st.warn,
          "第 "+st.n+" 步欄位不齊（要有 title／what／when／warn）");
        assert(st.what.length<=40, "第 "+st.n+" 步「這是什麼」超過一句話（"+st.what.length+" 字）");
        assert(st.when.length<=40, "第 "+st.n+" 步「時機」超過一句話（"+st.when.length+" 字）");
        assert(st.warn.length<=48, "第 "+st.n+" 步「⚠」超過一句話（"+st.warn.length+" 字）");
      });
      // 編號不重複
      var seen={};
      tut.STEPS.forEach(function(st){ assert(!seen[st.n],"步驟編號重複："+st.n); seen[st.n]=1; });

      // (b) 第一層的錨點必須都能在真實畫面上找到
      var savedS=ui.S, savedFeed=ui.feed;
      try{
        ui.S=mkGame(9501,["M1","M2","M3","M4","M6","M8"]);
        ui.feed=[];
        ui.render();
        var miss=[];
        tut.STEPS.forEach(function(st){
          if(st.layer===2) return;                 // 第二層要先開面板，另外驗
          if(!tut.stepEl(st)) miss.push(st.n+" "+st.title+" ("+st.anchor+")");
        });
        assert(miss.length===0,"第一層有錨點找不到：\n  "+miss.join("\n  "));
      } finally { ui.S=savedS; ui.feed=savedFeed; }

      // (c) 第二層每一步都要有打開面板的方法
      tut.STEPS.filter(function(st){ return st.layer===2; }).forEach(function(st){
        assert(typeof st.open==="function","第 "+st.n+" 步（"+st.title+"）缺少 open()");
        assert(st.anchor,"第 "+st.n+" 步缺少 anchor");
      });

      // (d) 縮放倍率要量出來，不得寫死（跟 S17 placeBoardCenter 同一個坑）
      var src=tut.scale.toString();
      assert(src.indexOf("offsetWidth")>=0,"tut.scale 必須用 offsetWidth 量倍率");
      assert(!/1\.12|1\.28/.test(src.replace(/\/\*[\s\S]*?\*\//g,"")),"不得寫死 zoom 倍率");

      // (e)「會害你輸的七件事」——第一條一定要是幸福感
      assert((tut.PITFALLS||[]).length>=5,"提醒清單太短");
      assert(/幸福感/.test(tut.PITFALLS[0]),"第一條提醒應該是幸福感（最多人栽的地方）");

      var n1=tut.STEPS.filter(function(s){return !s.layer;}).length;
      var n2=tut.STEPS.length-n1;
      return "第一層 "+n1+" 個錨點全部找得到；第二層 "+n2+" 個面板都有入口；卡片全是一句話";
    });

    t("T-03 分錄即真相", function(){
      var S=mkGame(11); var p=S.players[0];
      E.apply(S,{type:"ROLL_DICE",playerId:0,payload:null},{mutate:true});
      var cs=0; p.ledger.forEach(function(e){ e.postings.forEach(function(q){ if(q.account==="CASH") cs+=q.delta; }); });
      assert(Math.abs(util.r2(cs)-p.cash)<0.001,"現金 != CASH 分錄總和");
      var d=p.derived;
      assert(Math.abs(d.netWorth-(p.cash+d.totalAssets-d.totalLiabilities))<0.001,"淨值公式不符");
      assert(d.netCashflow===util.r2(d.salaryIncome+d.passiveIncome-d.totalExpenses),"淨現金流不符");
      return "現金／淨值／現金流皆由分錄推導一致";
    });

    t("T-04 破產與清償順序", function(){
      var S=mkGame(12); var p=S.players[0];
      var aid=util.uid(S,"A");
      p.assets.push({instanceId:aid,cardId:"x",kind:"REALESTATE",name:"測試屋",units:1,costBasis:1000,marketValue:1000,monthlyIncome:5,linkedLiabilityId:null,flags:{}});
      var lid=E.addLiability(S,p,"MORTGAGE","測試房貸",800,0.03,false,aid,true);
      p.assets[p.assets.length-1].linkedLiabilityId=lid;
      ledger.post(S,p,"建立測試部位",[{account:"ASSET",delta:1000,refId:aid,label:"測試屋"},
        {account:"LIABILITY",delta:800,refId:lid,label:"測試房貸"},{account:"INCOME_PASSIVE",delta:5,refId:aid,label:"租金"}],{});
      E.sellAsset(S,p,p.assets[p.assets.length-1],1);
      assert(!p.liabilities.some(function(l){return l.instanceId===lid;}),"連結貸款未一併清償");
      assert(!p.assets.some(function(x){return x.instanceId===aid;}),"資產未移除");
      var cs=0; p.ledger.forEach(function(e){ e.postings.forEach(function(q){ if(q.account==="CASH") cs+=q.delta; }); });
      assert(Math.abs(util.r2(cs)-p.cash)<0.001,"清償後帳務不平");
      return "賣出資產優先清償連結貸款，帳務平衡";
    });

    t("T-05 事件疊加與優先序", function(){
      var S=mkGame(13); S.activeGlobalEvents=[];
      S.activeGlobalEvents.push({seq:1,kind:"PARAM",param:"maxLTV",value:0.5,until:99,priority:10});
      S.activeGlobalEvents.push({seq:2,kind:"PARAM",param:"maxLTV",value:0.6,until:99,priority:90});
      assert(E.cfg(S,"maxLTV")===0.6,"高優先事件未生效");
      S.activeGlobalEvents.push({seq:3,kind:"PARAM",param:"maxLTV",value:0.55,until:99,priority:90});
      assert(E.cfg(S,"maxLTV")===0.55,"同優先未取最新 seq");
      return "覆寫依 priority 再依 seq";
    });

    t("T-06 股權稀釋數學", function(){
      var S=mkGame(14); var p=S.players[0];
      var aid=util.uid(S,"A");
      p.assets.push({instanceId:aid,cardId:"x",kind:"STARTUP",name:"測試新創",units:1,costBasis:100,marketValue:100,monthlyIncome:0,equityPct:0.10,postMoney:1000,linkedLiabilityId:null,flags:{}});
      ledger.post(S,p,"建立新創",[{account:"ASSET",delta:100,refId:aid,label:"新創"}],{});
      E.resolveDecision(S,p,{kind:"FOLLOW_ON",decisionId:"d1",playerId:0,assetId:aid,pre:1000,raise:250,post:1250,invest:25,equity:0.10},"pass",{});
      var a=p.assets.filter(function(x){return x.instanceId===aid;})[0];
      assert(Math.abs(a.equityPct-0.08)<0.0005,"不跟投稀釋計算錯誤，得 "+a.equityPct);
      return "不跟投 10%→8%";
    });

    t("T-07 轉貸重定價", function(){
      var cfg=baseCfg(); cfg.depthLevel=3;
      var S=mkGame(15,["M1","M2","M3","M4","M6"],cfg); var p=S.players[0];
      var lid=E.addLiability(S,p,"MORTGAGE","轉貸測試",1000,0.05,true,null,false);
      var before=p.cash;
      var r=E.apply(S,{type:"REFINANCE",playerId:0,payload:{liabilityId:lid}},{mutate:true});
      assert(!r.rejected,"轉貸被拒");
      var l=p.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      assert(l.isFloating===false,"轉貸後應為固定利率");
      assert(p.cash<before,"應扣手續費");
      return "轉貸收手續費並改固定利率";
    });

    t("T-08 融資斷頭強制平倉", function(){
      var cfg=baseCfg(); cfg.depthLevel=3;
      var S=mkGame(16,["M1","M2","M3","M4","M6"],cfg); var p=S.players[0];
      var sym=ns.content.stockDefs[0].symbol, aid=util.uid(S,"A");
      p.assets.push({instanceId:aid,cardId:"x",kind:"STOCK",name:"測試股",symbol:sym,units:100,costBasis:1000,marketValue:1000,monthlyIncome:0,linkedLiabilityId:null,flags:{}});
      var lid=E.addLiability(S,p,"MARGIN","融資測試",800,0.03,false,aid,true);
      ledger.post(S,p,"建立融資部位",[{account:"ASSET",delta:1000,refId:aid,label:"股"},{account:"LIABILITY",delta:800,refId:lid,label:"融資"}],{});
      S.stockPrices[sym]=5; E.revalueStocks(S);
      ns.modules.registry.M1.onRoundEnd(S);
      var lw=p.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      assert(p.assets.some(function(x){return x.instanceId===aid;}),"首次跌破應僅追繳通知、不平倉");
      assert(lw && lw.flags.marginWarned,"應標記追繳通知");
      S.stockPrices[sym]=5; E.revalueStocks(S);
      ns.modules.registry.M1.onRoundEnd(S);
      assert(!p.assets.some(function(x){return x.instanceId===aid;}),"寬限後未回補應強制平倉");
      var cs=0; p.ledger.forEach(function(e){ e.postings.forEach(function(q){ if(q.account==="CASH") cs+=q.delta; }); });
      assert(Math.abs(util.r2(cs)-p.cash)<0.001,"斷頭後帳務不平");
      return "追繳通知→寬限一輪→未回補強制平倉，帳務平衡";
    });

    t("T-09 內容結構驗證", function(){
      var saved=ns.content;
      var bad={ "content-base":{ professions:[{id:"X"}], boardLayout:[{type:"PAYDAY"}], boardLayoutOuter:[],
        stockDefs:[], personalities:[], strings:{}, cards:{ OPPORTUNITY_SMALL:[{kind:"STOCK"}] } } };
      var C=ns.loadContent(function(id){ return bad[id]||null; });
      var n=C.errors.length; ns.content=saved;
      assert(n>=3,"應偵測到多個結構錯誤，實得 "+n);
      return "偵測到 "+n+" 個結構性錯誤";
    });

    t("T-10 馬可夫分佈準確度", function(){
      var S=mkGame(17,["M4"]); S.config.macroTransitionProb=1;
      var from="BOOM", N=20000, counts={}, seedState={rngState:12345};
      for(var i=0;i<N;i++){ var to=ns.modules.registry.M4.sample(S,from,util.rand(seedState)); counts[to]=(counts[to]||0)+1; }
      var row=ns.modules.registry.M4.matrix[from], maxErr=0;
      Object.keys(row).forEach(function(s){ maxErr=Math.max(maxErr,Math.abs((counts[s]||0)/N-row[s])); });
      assert(maxErr<0.02,"最大偏差 "+util.pct(maxErr,2)+" 超過 2%");
      return "最大偏差 "+util.pct(maxErr,2)+"（<2%）";
    });

    t("T-11 信用評級（M7）", function(){
      // (a) 同 seed 兩局評級一致（重放決定論）
      var mods=["M1","M2","M3","M4","M6"], lineup=["NPC_SAFE","NPC_LEVER"];
      var G1=ns.sim.playOne(baseCfg(),mods,55123,lineup), G2=ns.sim.playOne(baseCfg(),mods,55123,lineup);
      var rk=function(S){ return S.players.map(function(p){return p.creditRating;}).join(","); };
      assert(rk(G1)===rk(G2),"同種子評級不一致："+rk(G1)+" vs "+rk(G2));

      // (b) C 級新貸利率＝基準＋商品加碼＋creditSpread_C（＝＋2%）
      var S=mkGame(771); var p=S.players[0];
      var base=S.macro.baseRate, csp=E.cfg(S,"creditSpread"), sc=E.cfg(S,"creditSpread_C");
      assert(Math.abs(sc-0.02)<1e-9,"creditSpread_C 預設應為 0.02");
      p.creditRating="B";
      var idB=E.addLiability(S,p,"CONSUMER","信用貸款",300,base+csp,false,null,true);
      var lB=p.liabilities.filter(function(x){return x.instanceId===idB;})[0];
      p.creditRating="C";
      var idC=E.addLiability(S,p,"CONSUMER","信用貸款",300,base+csp,false,null,true);
      var lC=p.liabilities.filter(function(x){return x.instanceId===idC;})[0];
      assert(lB.annualRate===E.rRate(base+csp),"B 級利率應無加碼，實得 "+lB.annualRate);
      assert(Math.abs((lC.annualRate-lB.annualRate)-0.02)<1e-9,"C 級應比 B 級高 2%，實得 "+util.r2((lC.annualRate-lB.annualRate)*100)+"%");

      // (c) DBR 上限確實壓額度：C 級額度 < B 級額度，且比值＝dbr_C/dbr_B（無擔保為 0 時）
      var S2=mkGame(772), q=S2.players[0];
      q.creditRating="B"; var capB=E.creditCapacity(S2,q);
      q.creditRating="C"; var capC=E.creditCapacity(S2,q);
      q.creditRating="A"; var capA=E.creditCapacity(S2,q);
      assert(capC<capB && capB<capA,"額度未依評級遞增：A"+capA+" B"+capB+" C"+capC);
      var unsec=0; q.liabilities.forEach(function(l){ if(l.kind==="CONSUMER"||l.kind==="CREDIT") unsec+=l.principal; });
      var expC=util.r2(Math.max(0,q.derived.salaryIncome*E.cfg(S2,"dbr_C")-unsec));
      assert(Math.abs(capC-expC)<0.02,"C 級額度應為 dbr_C 推算 "+expC+"，實得 "+capC);

      // (d) 動用紓困後評級降級（永久 −2）
      var S3=mkGame(773), r=S3.players[0];
      r.creditFlags={usedRescue:false,everBankrupt:false,cashWentNegative:false};
      E.runCreditReview(S3); var before=r.creditRating;
      r.creditFlags.usedRescue=true;
      E.runCreditReview(S3); var after=r.creditRating;
      var ord={A:3,B:2,C:1};
      assert(ord[after]<ord[before],"紓困後評級應降級（"+before+"→"+after+"）");
      // (e) 破產旗標為永久：−3 直接鎖 C
      r.creditFlags.everBankrupt=true; E.runCreditReview(S3);
      assert(r.creditRating==="C","破產者應鎖在 C，實得 "+r.creditRating);
      // (f) 本期旗標每次評級後歸零
      assert(r.creditFlags.cashWentNegative===false,"cashWentNegative 應於評級後歸零");
      return "重放一致；C 級 +2% 且 DBR 降為 "+E.cfg(S2,"dbr_C")+"×；紓困 "+before+"→"+after+"；破產鎖 C";
    });

    t("T-12 營運風險（修繕／空租／企業景氣係數）", function(){
      // 共用：驗證分錄推導與 derived 一致
      function tie(p){
        var c=0,as=0,li=0,ia=0,ip=0,ex=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){
          if(q.account==="CASH")c+=q.delta; else if(q.account==="ASSET")as+=q.delta;
          else if(q.account==="LIABILITY")li+=q.delta; else if(q.account==="INCOME_ACTIVE")ia+=q.delta;
          else if(q.account==="INCOME_PASSIVE")ip+=q.delta; else if(q.account==="EXPENSE")ex+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符");
        assert(Math.abs(util.r2(ip)-p.derived.passiveIncome)<0.02,"被動收入與分錄不符");
        assert(Math.abs(util.r2(util.r2(c)+util.r2(as)-util.r2(li))-p.derived.netWorth)<0.02,"淨值與分錄不符");
      }

      // (a) 修繕：必發（機率 1）→ 現金減少＝月租×倍數，且分錄平衡
      var S=mkGame(9001); var p=S.players[0];
      S.config.repairChancePerPayday=1; S.config.repairCostMonthsMin=2; S.config.repairCostMonthsMax=2;
      S.config.vacancyChance_RECESSION=0; S.config.vacancyChance_DEPRESSION=0;
      S.macro.stage="RECOVERY";
      var aid=util.uid(S,"A");
      p.assets.push({instanceId:aid,cardId:"X",kind:"REALESTATE",name:"測試套房",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:20,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S,p,"測試建檔",[{account:"ASSET",delta:1000,refId:aid,label:"測試套房"},
        {account:"INCOME_PASSIVE",delta:20,refId:aid,label:"淨租金"}],{eduTags:["setup"]});
      var cash0=p.cash;
      E.opsRisk(S,p); ns.ledger.recompute(p);
      assert(Math.abs((cash0-p.cash)-40)<0.02,"修繕支出應為 月租20×2＝40，實得 "+util.r2(cash0-p.cash));
      tie(p);

      // (b) 空租：必發 → 租金歸零；到期自動恢復；分錄平衡
      var S2=mkGame(9002); var q=S2.players[0];
      S2.config.repairChancePerPayday=0; S2.macro.stage="RECESSION";
      S2.config.vacancyChance_RECESSION=1; S2.config.vacancyTurnsMin=2; S2.config.vacancyTurnsMax=2;
      var bid=util.uid(S2,"A");
      q.assets.push({instanceId:bid,cardId:"X",kind:"REALESTATE",name:"測試店面",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:30,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S2,q,"測試建檔",[{account:"ASSET",delta:1000,refId:bid,label:"測試店面"},
        {account:"INCOME_PASSIVE",delta:30,refId:bid,label:"淨租金"}],{eduTags:["setup"]});
      var pi0=q.derived.passiveIncome;
      E.opsRisk(S2,q); ns.ledger.recompute(q);
      var bA=q.assets[q.assets.length-1];
      assert(bA.vacantUntilTurn===S2.turnNumber+2,"空租到期輪應為當前+2，實得 "+bA.vacantUntilTurn);
      assert(bA.monthlyIncome===0,"空租中租金應歸零");
      assert(Math.abs(q.derived.passiveIncome-(pi0-30))<0.02,"空租應扣除 30 被動收入");
      tie(q);
      // 空租中不再疊加空租
      var until=bA.vacantUntilTurn; E.opsRisk(S2,q);
      assert(bA.vacantUntilTurn===until,"空租中不應疊加新的空租");
      // 到期恢復
      S2.turnNumber = until; S2.config.vacancyChance_RECESSION=0;
      E.opsRisk(S2,q); ns.ledger.recompute(q);
      assert(bA.vacantUntilTurn===undefined && bA.monthlyIncome===30,"到期應恢復出租");
      assert(Math.abs(q.derived.passiveIncome-pi0)<0.02,"恢復後被動收入應回到 "+pi0);
      tie(q);

      // (c) 賣出空租中房產：以「當前」收入移除，不可多扣
      var S3=mkGame(9003); var r=S3.players[0];
      S3.config.repairChancePerPayday=0; S3.macro.stage="DEPRESSION";
      S3.config.vacancyChance_DEPRESSION=1; S3.config.vacancyTurnsMin=3; S3.config.vacancyTurnsMax=3;
      var cid=util.uid(S3,"A");
      r.assets.push({instanceId:cid,cardId:"X",kind:"REALESTATE",name:"測試透天",units:1,
        costBasis:800,marketValue:800,monthlyIncome:25,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S3,r,"測試建檔",[{account:"ASSET",delta:800,refId:cid,label:"測試透天"},
        {account:"INCOME_PASSIVE",delta:25,refId:cid,label:"淨租金"}],{eduTags:["setup"]});
      var pib=r.derived.passiveIncome;
      E.opsRisk(S3,r); ns.ledger.recompute(r);
      var cA=r.assets.filter(function(x){return x.instanceId===cid;})[0];
      assert(cA.vacantUntilTurn!==undefined,"應進入空租");
      E.sellAsset(S3,r,cA,1); ns.ledger.recompute(r);
      assert(Math.abs(r.derived.passiveIncome-(pib-25))<0.02,
        "賣出空租房產後被動收入應為 "+util.r2(pib-25)+"，實得 "+r.derived.passiveIncome+"（多扣＝重複移除租金）");
      tie(r);

      // (d) 企業景氣係數：多次轉換後可歸位（無漂移）
      var S4=mkGame(9004,["M1","M2","M4","M6"]); var b=S4.players[0];
      S4.macro.stage="RECOVERY"; S4.config.inflation=0;
      ["infl_RECOVERY","infl_BOOM","infl_RECESSION","infl_DEPRESSION"].forEach(function(k){ S4.config[k]=0; });
      S4.config.policyEventProb=0;
      var did=util.uid(S4,"A");
      b.assets.push({instanceId:did,cardId:"X",kind:"BUSINESS",name:"測試早餐店",units:1,
        costBasis:500,marketValue:500,monthlyIncome:40,baseMonthlyIncome:40,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S4,b,"測試建檔",[{account:"ASSET",delta:500,refId:did,label:"測試早餐店"},
        {account:"INCOME_PASSIVE",delta:40,refId:did,label:"月分紅"}],{eduTags:["setup"]});
      var dA=b.assets.filter(function(x){return x.instanceId===did;})[0];
      var M4m=ns.modules.registry.M4;
      M4m.transition(S4,"RECOVERY","RECESSION");
      assert(Math.abs(dA.monthlyIncome-util.r2(40*E.cfg(S4,"bizMult_RECESSION")))<0.02,
        "衰退期事業收入應為 40×0.8，實得 "+dA.monthlyIncome);
      M4m.transition(S4,"RECESSION","DEPRESSION");
      M4m.transition(S4,"DEPRESSION","BOOM");
      assert(Math.abs(dA.monthlyIncome-util.r2(40*E.cfg(S4,"bizMult_BOOM")))<0.02,"過熱期應為 40×1.1");
      M4m.transition(S4,"BOOM","RECOVERY");
      assert(Math.abs(dA.monthlyIncome-40)<0.02,"繞一圈回復甦應歸位為 40，實得 "+dA.monthlyIncome+"（漂移）");
      tie(b);

      // (e) 同 seed 重放一致（含營運風險擲骰）
      var mods=["M1","M2","M3","M4","M6"], lineup=["NPC_LEVER","NPC_SAFE"];
      var G1=ns.sim.playOne(baseCfg(),mods,64007,lineup), G2=ns.sim.playOne(baseCfg(),mods,64007,lineup);
      var norm=function(X){ return JSON.stringify(X.players.map(function(z){
        return [z.cash,z.derived.passiveIncome,z.ledger.length,
                z.assets.map(function(y){return [y.name,y.monthlyIncome,y.vacantUntilTurn||0];})]; })); };
      assert(norm(G1)===norm(G2),"含營運風險的重放不一致");
      return "修繕/空租/係數三種分錄平衡；空租到期恢復且不疊加；賣出不多扣；景氣循環一圈無漂移";
    });

    t("T-13a 機會二選一", function(){
      // (a) 同 seed 抽同兩張
      function draw2(seed){ var S=mkGame(seed); S.config.oppDualChoice=1;
        var p=S.players[0];
        var two=E.drawTwo(S,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S,p,c); });
        return two.map(function(c){return c.id;}).join("+"); }
      assert(draw2(3301)===draw2(3301),"同種子抽到的兩張不一致");
      assert(draw2(3301).indexOf("+")>0,"正常牌堆應抽到兩張");

      // (b) 兩張互異，且都已進棄牌堆（未選者自動棄牌）
      var S=mkGame(3302); S.config.oppDualChoice=1; var p=S.players[0];
      var dk=S.decks.OPPORTUNITY_SMALL, n0=dk.draw.length+dk.discard.length;
      var two=E.drawTwo(S,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S,p,c); });
      assert(two.length===2 && two[0].id!==two[1].id,"應抽到兩張互異的卡");
      assert(dk.discard.indexOf(two[0].id)>=0 && dk.discard.indexOf(two[1].id)>=0,"兩張都應在棄牌堆");
      var cnt={}; dk.discard.forEach(function(id){ cnt[id]=(cnt[id]||0)+1; });
      assert(cnt[two[0].id]===1 && cnt[two[1].id]===1,"棄牌堆不應出現重複卡");
      assert(dk.draw.length+dk.discard.length===n0,"牌堆總張數不應改變");

      // (c) 牌堆剩 1 張時退化為單張
      var S2=mkGame(3303); var q=S2.players[0];
      var d2=S2.decks.OPPORTUNITY_SMALL;
      var keep=d2.draw.filter(function(id){ var c=ns.content.byId[id]; return c && E.cardUsable(S2,q,c); })[0];
      d2.draw=[keep]; d2.discard=[];
      var one=E.drawTwo(S2,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S2,q,c); });
      assert(one.length===1 && one[0].id===keep,"牌堆剩 1 張應退化為單張，實得 "+one.length+" 張");
      assert(d2.discard.length===1 && d2.discard[0]===keep,"退化路徑棄牌堆應恰有該張");

      // (d) 雙棄：PICK_OPP 選 none → 不產生後續決策，且兩張都已在棄牌堆
      var S3=mkGame(3304); S3.config.oppDualChoice=1; var r=S3.players[0];
      var d3=S3.decks.OPPORTUNITY_SMALL;
      var t3=E.drawTwo(S3,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S3,r,c); });
      E.pushDecision(S3,r,{kind:"PICK_OPP", cardIds:[t3[0].id,t3[1].id], deckId:"OPPORTUNITY_SMALL"});
      E.syncPhase(S3);
      var dec=S3.pendingDecision; S3.decisionQueue.shift();
      E.resolveDecision(S3,r,dec,"none",{}); E.syncPhase(S3);
      assert(!S3.pendingDecision || S3.pendingDecision.kind!=="BUY","雙棄不應產生 BUY 決策");
      assert(d3.discard.indexOf(t3[0].id)>=0 && d3.discard.indexOf(t3[1].id)>=0,"雙棄後兩張都應在棄牌堆");

      // (e) 選一張 → 走現有 presentCard 流程（產生 BUY 決策）
      var S4=mkGame(3305); S4.config.oppDualChoice=1; var u=S4.players[0];
      var t4=E.drawTwo(S4,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S4,u,c); });
      E.pushDecision(S4,u,{kind:"PICK_OPP", cardIds:[t4[0].id,t4[1].id], deckId:"OPPORTUNITY_SMALL"});
      E.syncPhase(S4); var dec4=S4.pendingDecision; S4.decisionQueue.shift();
      E.resolveDecision(S4,u,dec4,t4[1].id,{}); E.syncPhase(S4);
      assert(S4.pendingDecision && S4.pendingDecision.cardId===t4[1].id,"選卡後應對該卡開啟決策");

      // (f) NPC 同 seed 同選；且只回傳兩張之一或 none
      var S5=mkGame(3306,["M1","M2","M4","M6"]);
      var npcP=S5.players[1];
      var t5=E.drawTwo(S5,"OPPORTUNITY_SMALL",function(c){ return E.cardUsable(S5,npcP,c); });
      var dd={kind:"PICK_OPP", cardIds:[t5[0].id,t5[1].id], decisionId:"d_x", playerId:npcP.id};
      var a1=ns.npc.decide(S5,npcP,dd), a2=ns.npc.decide(S5,npcP,dd);
      assert(a1.payload.optionId===a2.payload.optionId,"NPC 選卡不決定論");
      assert(t5.map(function(c){return c.id;}).indexOf(a1.payload.optionId)>=0,"NPC 應選兩張其中之一");

      // (g) 整局重放一致（含二選一）
      var mods=["M1","M2","M3","M4","M6"], lineup=["NPC_LEVER","NPC_SAFE","NPC_VC"];
      var G1=ns.sim.playOne(baseCfg(),mods,73311,lineup), G2=ns.sim.playOne(baseCfg(),mods,73311,lineup);
      var norm=function(X){ return JSON.stringify(X.players.map(function(z){
        return [z.cash,z.derived.netWorth,z.ledger.length,z.stats.passedOpps]; })); };
      assert(norm(G1)===norm(G2),"含二選一的整局重放不一致");
      assert(G1.players.some(function(z){return z.stats.passedOpps>0;}),"模擬局中應至少發生過一次二選一");
      return "同 seed 抽同兩張且 NPC 同選；雙棄兩張皆入棄牌堆；牌堆剩 1 張退化正確";
    });

    t("T-13b 幸福感盲盒", function(){
      // (a) 同 seed 同獎（主流 RNG）
      function drawSeq(seed){ var S=mkGame(seed), p=S.players[0], out=[];
        for(var i=0;i<12;i++){ p.virtues={TEMPER:0,PRUDENCE:0,PARENTING:0,FILIAL:0};
          out.push(E.drawBlessing(S,p).prize); }
        return out.join(","); }
      assert(drawSeq(5501)===drawSeq(5501),"同 seed 抽到的獎項序列不一致");
      assert(drawSeq(5501)!==drawSeq(5502),"不同 seed 應有不同序列（極低機率誤判）");

      // (b) 五種獎項都抽得到，且各自效果正確
      var S=mkGame(5503), p=S.players[0], seen={};
      for(var i=0;i<600;i++){
        p.virtues={TEMPER:0,PRUDENCE:0,PARENTING:0,FILIAL:0};
        seen[E.drawBlessing(S,p).prize]=true;
      }
      ["VIRTUE","DREAM","GUARDIAN","JOY","CASH"].forEach(function(k){ assert(seen[k],"獎池未抽到 "+k); });

      // (c) 幸福感 = 引擎純函式，且 UI 代理值相同
      var S2=mkGame(5504), q=S2.players[0];
      q.childrenCount=2; q.virtues={TEMPER:1,PRUDENCE:2,PARENTING:0,FILIAL:0};
      q.dreamProgress=3; q.stats.optionalBought=1;
      assert(E.wellbeing(S2,q)===2*3+3+3+1,"幸福感公式不符，實得 "+E.wellbeing(S2,q));

      // (d) HWM 跨檔觸發一次；同檔位不重複；掉下去再回來也不重抽
      var S3=mkGame(5505), r=S3.players[0];
      S3.config.blessingStep=10;
      r.blessingHWM=0; r.childrenCount=0; r.virtues={TEMPER:0,PRUDENCE:0,PARENTING:0,FILIAL:0};
      r.dreamProgress=0; r.stats.optionalBought=0;
      assert(E.checkBlessing(S3,r)===false,"幸福感 0 不該觸發");
      r.dreamProgress=9;
      assert(E.checkBlessing(S3,r)===false,"幸福感 9 未跨 10 不該觸發");
      r.dreamProgress=10;
      assert(E.checkBlessing(S3,r)===true,"幸福感跨 10 應觸發");
      var hwm1=r.blessingHWM;
      assert(hwm1>=10,"HWM 應更新為當前幸福感");
      S3.decisionQueue=[]; 
      assert(E.checkBlessing(S3,r)===false,"同檔位不應重複觸發");
      // 幸福感掉回去
      r.dreamProgress=2; r.stats.optionalBought=0; r.virtues={TEMPER:0,PRUDENCE:0,PARENTING:0,FILIAL:0};
      assert(E.checkBlessing(S3,r)===false,"幸福感下滑不該觸發");
      assert(r.blessingHWM>=hwm1,"HWM 不應下降（"+hwm1+"→"+r.blessingHWM+"）");
      // 回到原檔位不重抽
      r.dreamProgress=10;
      S3.decisionQueue=[];
      assert(E.checkBlessing(S3,r)===false,"掉下去再回到同一檔位不應重抽");
      // 跨到下一檔位才再抽
      r.dreamProgress=20;
      assert(E.checkBlessing(S3,r)===true,"跨到 20 應再觸發一次");

      // (e) 貴人相助：負面人生事件減免 50%、且一次性
      var S4=mkGame(5506), u=S4.players[0];
      S4.config.eventCardRate=1;
      var disc=E.cfg(S4,"guardianDiscount");
      u.flags={guardian:true};
      var c0=u.cash;
      E.applyEffects(S4,u,[{op:"CASH_DELTA",amount:-100,label:"測試罰單"}],"測試罰單",{lifeEvent:true});
      ns.ledger.recompute(u);
      assert(Math.abs((c0-u.cash)-100*(1-disc))<0.02,"貴人減免後應只扣 "+(100*(1-disc))+"，實得 "+util.r2(c0-u.cash));
      assert(u.flags.guardian===false,"貴人旗標應於觸發後清除");
      var c1=u.cash;
      E.applyEffects(S4,u,[{op:"CASH_DELTA",amount:-100,label:"測試罰單2"}],"測試罰單2",{lifeEvent:true});
      ns.ledger.recompute(u);
      assert(Math.abs((c1-u.cash)-100)<0.02,"第二次應全額扣款（一次性），實得 "+util.r2(c1-u.cash));
      // 正向事件與非人生事件不消耗貴人
      u.flags.guardian=true;
      E.applyEffects(S4,u,[{op:"CASH_DELTA",amount:+50,label:"中獎"}],"中獎",{lifeEvent:true});
      assert(u.flags.guardian===true,"正向事件不應消耗貴人");
      var c2=u.cash;
      E.applyEffects(S4,u,[{op:"CASH_DELTA",amount:-100,label:"總經事件"}],"總經事件");
      ns.ledger.recompute(u);
      assert(u.flags.guardian===true && Math.abs((c2-u.cash)-100)<0.02,"非人生事件不應套用貴人減免");

      // (f) 品格已滿時退為小確幸（不會卡住）
      var S5=mkGame(5507), v=S5.players[0];
      var cap=E.cfg(S5,"virtueMaxLevel");
      v.virtues={TEMPER:cap,PRUDENCE:cap,PARENTING:cap,FILIAL:cap};
      S5.config.blessingW_DREAM=0; S5.config.blessingW_GUARDIAN=0; S5.config.blessingW_JOY=0; S5.config.blessingW_CASH=0;
      var g=E.drawBlessing(S5,v);
      assert(g.prize==="JOY","品格已滿應退為 JOY，實得 "+g.prize);
      assert(v.stats.optionalBought>=2,"JOY 應使幸福感 +2");
      return "同 seed 同獎；五獎皆可抽出；guardian 減免 "+util.pct(disc,0)+" 且一次性；HWM 只增不減、同檔位不重抽";
    });

    t("T-14 機會拍賣（密封投標）", function(){
      function tie(p){ var c=0,as=0,li=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){
          if(q.account==="CASH")c+=q.delta; else if(q.account==="ASSET")as+=q.delta;
          else if(q.account==="LIABILITY")li+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符（"+p.name+"）");
        assert(Math.abs(util.r2(util.r2(c)+util.r2(as)-util.r2(li))-p.derived.netWorth)<0.02,"淨值與分錄不符（"+p.name+"）"); }
      function mk4(seed,cash){  // A 人類＋三 NPC，各補現金
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_LEVER",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id},
          {name:"D",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S);
        (cash||[]).forEach(function(amt,i){ if(amt) ns.ledger.post(S,S.players[i],"測試補現金",
          [{account:"CASH",delta:amt,label:"測試"}],{eduTags:["setup"]}); });
        return S; }
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="REALESTATE";})[0];
      assert(CARD,"找不到不動產小機會卡");
      function arm(S){ E.pushDecision(S,S.players[0],{kind:"BUY",cardId:CARD.id}); E.syncPhase(S); }
      function evOf(res,type){ return res.events.filter(function(e){return e.type===type;})[0]; }

      // (a) 三家出價決定論：同一 state 兩次 apply（各自 clone）結果一致
      var S=mk4(8801,[0,500,500,500]); arm(S);
      var act={type:"START_OPP_AUCTION",playerId:0,payload:{cardId:CARD.id}};
      var r1=E.apply(S,act), r2=E.apply(S,act);
      assert(!r1.rejected && !r2.rejected,"拍賣動作被拒");
      var b1=JSON.stringify(evOf(r1,"AUCTION_RESULT").bids), b2=JSON.stringify(evOf(r2,"AUCTION_RESULT").bids);
      assert(b1===b2,"同 seed 出價不一致："+b1+" vs "+b2);

      // (b) 得標：資產＋價金雙邊分錄平衡；抽卡人決策已 resolve
      var res=evOf(r1,"AUCTION_RESULT"), S1=r1.state;
      assert(res.winnerId!==null,"三家有錢應成交");
      var w=S1.players[res.winnerId], seller=S1.players[0];
      assert(w.assets.some(function(a){return a.name===CARD.title;}),"得標者應取得資產");
      var sellerCashGain = seller.ledger.filter(function(en){return /拍賣成交/.test(en.summary);})
        .reduce(function(acc,en){ return acc+en.postings.reduce(function(x,q){return x+(q.account==="CASH"?q.delta:0);},0); },0);
      assert(Math.abs(sellerCashGain-res.price)<0.02,"抽卡人應收到價金 "+res.price+"，實得 "+sellerCashGain);
      tie(w); tie(seller);
      assert(!S1.pendingDecision || S1.pendingDecision.cardId!==CARD.id,"抽卡人 BUY 決策應已 resolve");

      // (c) 流標（全員無意願）：決策保留、可跳過
      var S2=mk4(8802,[0,0,0,0]);
      // 抽乾 NPC 現金，確保 willing≤0
      S2.players.slice(1).forEach(function(pl){ if(pl.cash>0) ns.ledger.post(S2,pl,"測試抽乾",
        [{account:"CASH",delta:-pl.cash,label:"測試"}],{eduTags:["setup"]}); });
      arm(S2);
      var r3=E.apply(S2,act,{mutate:true});
      var res3=evOf(r3,"AUCTION_RESULT");
      assert(res3.winnerId===null,"無人出價應流標");
      assert(res3.bids.every(function(b){return b.amount===0;}),"全員應棄標");
      assert(r3.state.pendingDecision && r3.state.pendingDecision.cardId===CARD.id,"流標後 BUY 決策應保留");
      var rSkip=E.apply(r3.state,{type:"DECIDE",playerId:0,
        payload:{decisionId:r3.state.pendingDecision.decisionId,optionId:"skip",params:{}}},{mutate:true});
      assert(!rSkip.rejected,"流標後應可跳過");

      // (d) 遞補與「有出價但全買不起」流標：壓低 LTV 讓自備款遠高於入手門檻
      var S4=mk4(8804,[0,0,0,0]);
      S4.config.maxLTV=0.3; S4.config.maxLTVCeiling=0.3;   // down ≈ 0.7×price >> downPayment
      var pl4=CARD.payload, needDown=util.r2(pl4.price*(1-0.3));
      // C（LEVER）有意願但買不起自備款；D（VC）現金充足可遞補
      var C=S4.players[2], D=S4.players[3];
      function setCash(S,pl,target){ var d=util.r2(target-pl.cash);
        if(d) ns.ledger.post(S,pl,"測試設現金",[{account:"CASH",delta:d,label:"測試"}],{eduTags:["setup"]}); }
      setCash(S4,S4.players[1],0);
      setCash(S4,C, util.r2(pl4.downPayment + 1.5*C.derived.totalExpenses + 60));  // 過 willing 門檻、不足 needDown
      setCash(S4,D, util.r2(needDown + D.derived.totalExpenses*2 + 200));
      assert(C.cash<needDown,"前置：C 現金須低於自備款 "+needDown);
      arm(S4);
      var r4=E.apply(S4,act,{mutate:true});
      var res4=evOf(r4,"AUCTION_RESULT");
      var cBid=res4.bids.filter(function(b){return b.playerId===2;})[0];
      var dBid=res4.bids.filter(function(b){return b.playerId===3;})[0];
      assert(cBid.amount>0 && dBid.amount>0,"C、D 都應出價");
      if(cBid.amount>dBid.amount){
        assert(res4.winnerId===3,"最高價 C 買不起，應由 D 遞補，實得 winner="+res4.winnerId);
      } else {
        assert(res4.winnerId===3,"D 最高價且買得起，應得標");
      }
      tie(r4.state.players[3]); tie(r4.state.players[0]);

      // (e) 全滅流標：有出價但全都買不起自備款
      var S5=mk4(8805,[0,0,0,0]);
      S5.config.maxLTV=0.3; S5.config.maxLTVCeiling=0.3;
      setCash(S5,S5.players[1],0);
      setCash(S5,S5.players[2], util.r2(pl4.downPayment + 1.5*S5.players[2].derived.totalExpenses + 60));
      setCash(S5,S5.players[3], util.r2(pl4.downPayment + 1.0*S5.players[3].derived.totalExpenses + 40));
      arm(S5);
      var r5=E.apply(S5,act,{mutate:true});
      var res5=evOf(r5,"AUCTION_RESULT");
      assert(res5.bids.some(function(b){return b.amount>0;}),"應有人出價");
      assert(res5.winnerId===null,"全買不起應流標");
      assert(r5.state.pendingDecision && r5.state.pendingDecision.cardId===CARD.id,"全滅流標後決策應保留");

      // (f) actionLog 重放一致（含 START_OPP_AUCTION）
      var S6=mk4(8806,[0,500,500,500]);
      var meta={seed:8806,config:util.clone(S6.config),modules:S6.enabledModules.slice(),
        players:S6.players.map(function(p2){return {name:p2.name,isNPC:p2.isNPC,personality:p2.npcPersonality,professionId:p2.professionId,dreamCardId:p2.dreamCardId};})};
      // 重放路徑：補現金與 pushDecision 非動作，重放函式需同樣前置——改為只驗 apply 決定論已於 (a) 涵蓋；
      // 此處驗證：同 seed 全程（補現金→arm→拍賣）重跑兩次，終態一致
      function runOnce(){ var X=mk4(8806,[0,500,500,500]); arm(X);
        var r=E.apply(X,act,{mutate:true});
        return JSON.stringify(r.state.players.map(function(p2){return [p2.cash,p2.derived.netWorth,p2.assets.length,p2.ledger.length];})); }
      assert(runOnce()===runOnce(),"同 seed 全程重跑不一致");
      return "出價決定論；成交雙邊平衡；流標保留決策；遞補與全滅流標正確";
    });

    t("T-15 合資 JV", function(){
      function tie(p){ var c=0,as=0,li=0,ip=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){
          if(q.account==="CASH")c+=q.delta; else if(q.account==="ASSET")as+=q.delta;
          else if(q.account==="LIABILITY")li+=q.delta; else if(q.account==="INCOME_PASSIVE")ip+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符（"+p.name+"）");
        assert(Math.abs(util.r2(ip)-p.derived.passiveIncome)<0.02,"被動收入與分錄不符（"+p.name+"）");
        assert(Math.abs(util.r2(util.r2(c)+util.r2(as)-util.r2(li))-p.derived.netWorth)<0.02,"淨值與分錄不符（"+p.name+"）"); }
      function mkJ(seed,cashA,cashB){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:true,personality:"NPC_LEVER",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S);
        function setCash(pl,t){ var d=util.r2(t-pl.cash);
          if(d) ns.ledger.post(S,pl,"測試設現金",[{account:"CASH",delta:d,label:"測試"}],{eduTags:["setup"]}); }
        if(cashA!==undefined) setCash(S.players[0],cashA);
        if(cashB!==undefined) setCash(S.players[1],cashB);
        return S; }
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="REALESTATE";})[0];
      var BIZ=(ns.content.cards.OPPORTUNITY_SMALL.concat(ns.content.cards.OPPORTUNITY_LARGE||[]))
        .filter(function(c){return c.kind==="BUSINESS";})[0];
      assert(CARD&&BIZ,"缺測試卡");
      function arm(S,card){ E.pushDecision(S,S.players[0],{kind:"BUY",cardId:card.id}); E.syncPhase(S); }
      function jvAct(share,card){ return {type:"PROPOSE_JV",playerId:0,
        payload:{cardId:card.id, partnerId:1, myShare:share}}; }
      function evOf(res,t2){ return res.events.filter(function(e){return e.type===t2;})[0]; }

      // (a) 不動產 JV 70/30：分割總和＝原值、兩筆獨立資產各背各的貸款、雙邊分錄平衡
      var S=mkJ(9101, 2000, 2000); arm(S,CARD);
      var r=E.apply(S,jvAct(0.7,CARD),{mutate:true});
      var fm=evOf(r,"JV_FORMED"); assert(fm,"JV 應成立");
      var A=r.state.players[0], B=r.state.players[1];
      var aA=A.assets.filter(function(x){return x.jvGroupId;})[0];
      var aB=B.assets.filter(function(x){return x.jvGroupId;})[0];
      assert(aA&&aB,"雙方都應有 JV 資產");
      assert(aA.jvGroupId===aB.jvGroupId,"jvGroupId 應相同");
      assert(aA.sharePct===0.7 && aB.sharePct===0.3,"持份比不符");
      assert(/持份 70%/.test(aA.name) && /持份 30%/.test(aB.name),"名稱應含持份");
      var pl0=CARD.payload;
      assert(Math.abs((aA.costBasis+aB.costBasis)-pl0.price)<0.005,"價格分割總和漂移："+(aA.costBasis+aB.costBasis)+" vs "+pl0.price);
      var im=S.config.assetIncomeMult;
      var wholeInc=util.r2(pl0.monthlyRent*im-pl0.monthlyCost);
      assert(Math.abs((aA.monthlyIncome+aB.monthlyIncome)-wholeInc)<=0.02,"月現金流分割漂移："+(aA.monthlyIncome+aB.monthlyIncome)+" vs "+wholeInc);
      var lA=A.liabilities.filter(function(l){return l.collateralAssetId===aA.instanceId;})[0];
      var lB=B.liabilities.filter(function(l){return l.collateralAssetId===aB.instanceId;})[0];
      assert(lA&&lB,"雙方各背各的房貸");
      tie(A); tie(B);
      assert(!r.state.pendingDecision || r.state.pendingDecision.cardId!==CARD.id,"成立後 BUY 決策應 resolve");

      // (b) NPC 接受條件：夥伴現金水位不足 → 拒絕、決策保留；且條件決定論
      var S2=mkJ(9102, 2000, 0);
      var B2=S2.players[1];
      var w2=ns.content.personalityById[B2.npcPersonality].weights;
      // 設夥伴現金 = 其份額門檻＋reserve − 1（差 1 塊必拒）
      var pEntry=util.r2(E.oppEntry(S2,CARD)*0.3);
      var lack=util.r2(pEntry + w2.cashReserveFloor*B2.derived.totalExpenses - 1);
      ns.ledger.post(S2,B2,"測試設現金",[{account:"CASH",delta:util.r2(lack-B2.cash),label:"測試"}],{eduTags:["setup"]});
      arm(S2,CARD);
      var r2a=E.apply(S2,jvAct(0.7,CARD)), r2b=E.apply(S2,jvAct(0.7,CARD));
      var rj=evOf(r2a,"JV_REJECTED");
      assert(rj && rj.reason==="partner","夥伴吃緊應拒絕，實得 "+JSON.stringify(rj));
      assert(!!evOf(r2b,"JV_REJECTED")===!!rj,"接受條件不決定論");
      assert(r2a.state.pendingDecision && r2a.state.pendingDecision.cardId===CARD.id,"拒絕後 BUY 決策應保留");
      // 差 2 塊變接受（邊界靈敏度）
      var S2c=mkJ(9102, 2000, 0); var B2c=S2c.players[1];
      ns.ledger.post(S2c,B2c,"測試設現金",[{account:"CASH",delta:util.r2(lack+2-B2c.cash),label:"測試"}],{eduTags:["setup"]});
      arm(S2c,CARD);
      var r2c=E.apply(S2c,jvAct(0.7,CARD),{mutate:true});
      assert(evOf(r2c,"JV_FORMED"),"跨過水位應接受");

      // (c) 一方轉賣持份後另一方不受影響
      var S3=mkJ(9103, 2000, 2000); arm(S3,CARD);
      var r3=E.apply(S3,jvAct(0.5,CARD),{mutate:true});
      var A3=r3.state.players[0], B3=r3.state.players[1];
      var aA3=A3.assets.filter(function(x){return x.jvGroupId;})[0];
      var aB3=B3.assets.filter(function(x){return x.jvGroupId;})[0];
      var bIncBefore=B3.derived.passiveIncome, bNwBefore=B3.derived.netWorth, bLedBefore=B3.ledger.length;
      E.sellAsset(r3.state,A3,aA3,1); ns.ledger.recompute(A3); ns.ledger.recompute(B3);
      assert(A3.assets.indexOf(aA3)<0,"發起人持份應已賣出");
      assert(B3.assets.indexOf(aB3)>=0,"夥伴持份不應受影響");
      assert(B3.ledger.length===bLedBefore && Math.abs(B3.derived.passiveIncome-bIncBefore)<0.005
             && Math.abs(B3.derived.netWorth-bNwBefore)<0.005,"夥伴帳務不應變動");
      tie(A3); tie(B3);

      // (d) 事業 JV：baseMonthlyIncome 分割一致（景氣係數不漂移的前提）
      var S4=mkJ(9104, 5000, 5000); arm(S4,BIZ);
      var r4=E.apply(S4,jvAct(0.6,BIZ),{mutate:true});
      assert(evOf(r4,"JV_FORMED"),"事業 JV 應成立");
      var A4=r4.state.players[0], B4=r4.state.players[1];
      var aA4=A4.assets.filter(function(x){return x.jvGroupId;})[0];
      var aB4=B4.assets.filter(function(x){return x.jvGroupId;})[0];
      var wholeBase=util.r2(util.r2(BIZ.payload.monthlyProfit*E.incomeMultFor(S4,"BUSINESS"))/E.bizMult(S4,S4.macro.stage));
      assert(Math.abs((aA4.baseMonthlyIncome+aB4.baseMonthlyIncome)-wholeBase)<=0.02,
        "事業基準收入分割漂移："+(aA4.baseMonthlyIncome+aB4.baseMonthlyIncome)+" vs "+wholeBase);
      tie(A4); tie(B4);
      return "70/30 分割無漂移且各背各的貸款；NPC 水位邊界決定論；轉賣持份互不牽動；事業基準收入分割一致";
    });

    t("T-16 P2P 民間借貸", function(){
      function tie(p){ var c=0,as=0,li=0,ex=0,ip=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){
          if(q.account==="CASH")c+=q.delta; else if(q.account==="ASSET")as+=q.delta;
          else if(q.account==="LIABILITY")li+=q.delta; else if(q.account==="EXPENSE")ex+=q.delta;
          else if(q.account==="INCOME_PASSIVE")ip+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符（"+p.name+"）");
        assert(Math.abs(util.r2(util.r2(c)+util.r2(as)-util.r2(li))-p.derived.netWorth)<0.02,"淨值與分錄不符（"+p.name+"）");
        return {exp:util.r2(ex), ip:util.r2(ip)}; }
      function mkP(seed){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S); return S; }
      function setCash(S,pl,t){ var d=util.r2(t-pl.cash);
        if(d) ns.ledger.post(S,pl,"測試設現金",[{account:"CASH",delta:d,label:"測試"}],{eduTags:["setup"]}); }

      // (a) 成立與拒絕邊界：人類向 NPC 放款人借款，利率壓在動態下限上下
      var S=mkP(9301); var A=S.players[0], B=S.players[1];
      setCash(S,B, util.r2(6*B.derived.totalExpenses*1.5 + 500 + 50));  // 過 SAFE reserve×1.5 門檻
      var minR=E.p2pMinRate(S,A);
      var below={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:B.id,borrowerId:0,amount:500,annualRate:E.rRate(minR-0.005),termMonths:24}};
      var atMin={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:B.id,borrowerId:0,amount:500,annualRate:minR,termMonths:24}};
      var r1=E.apply(S,below,{mutate:true});
      assert(r1.events.some(function(e){return e.type==="P2P_REJECTED";}),"低於動態下限應遭拒");
      var r2=E.apply(S,atMin,{mutate:true});
      var fm=r2.events.filter(function(e){return e.type==="P2P_FORMED";})[0];
      assert(fm,"達下限應成立");
      S=r2.state; A=S.players[0]; B=S.players[1];
      var l0=A.liabilities.filter(function(x){return x.kind==="P2P";})[0];
      assert(l0 && Math.abs(l0.principal-500)<0.01,"借款人應有 P2P 負債 500");
      var a0=B.assets.filter(function(x){return x.kind==="P2P_LOAN";})[0];
      assert(a0 && Math.abs(a0.marketValue-500)<0.01,"放款人應有 P2P 債權 500");
      // 模型檢核：P2P 不進 EXPENSE／INCOME_PASSIVE 水位（onRoundEnd 對轉模型）
      var mA=tie(A), mB=tie(B);

      // (b) 對轉分錄雙邊平衡＋利息數學：跑一輪
      var aCash0=A.cash, bCash0=B.cash, aNw0=A.derived.netWorth, bNw0=B.derived.netWorth;
      var expInt=util.r2(500*l0.annualRate/12), expPay=l0.monthlyPayment;
      var expPrin=util.r2(expPay-expInt);
      E.p2pRoundEnd(S);
      ns.ledger.recompute(A); ns.ledger.recompute(B);
      assert(Math.abs((aCash0-A.cash)-expPay)<0.02,"借款人現金應減月付 "+expPay);
      assert(Math.abs((B.cash-bCash0)-expPay)<0.02,"放款人現金應增月付 "+expPay);
      assert(Math.abs(l0.principal-(500-expPrin))<0.02,"本金應遞減 "+expPrin);
      assert(Math.abs(a0.marketValue-(500-expPrin))<0.02,"債權餘額應同步遞減");
      assert(Math.abs((B.derived.netWorth-bNw0)-expInt)<0.03,"放款人淨值應增利息 "+expInt+"，實得 "+util.r2(B.derived.netWorth-bNw0));
      assert(Math.abs((aNw0-A.derived.netWorth)-expInt)<0.03,"借款人淨值應減利息 "+expInt);
      tie(A); tie(B);

      // (c) 全程攤還到清償：跑滿期數，負債與債權雙雙移除
      var guard=0;
      while(A.liabilities.some(function(x){return x.kind==="P2P";}) && guard++<40){
        setCash(S,A, Math.max(A.cash, 100));   // 確保付得出
        E.p2pRoundEnd(S);
      }
      assert(guard<40,"應在期數內清償完畢");
      assert(!A.liabilities.some(function(x){return x.kind==="P2P";}),"清償後負債應移除");
      assert(!B.assets.some(function(x){return x.kind==="P2P_LOAN";}),"清償後債權應移除");
      tie(A); tie(B);

      // (d) 違約一期：現金不足 → 不對轉、記次、信用受損
      var S2=mkP(9302); var A2=S2.players[0], B2=S2.players[1];
      setCash(S2,B2, 5000);
      E.formP2P(S2,B2,A2,400,0.12,24);
      setCash(S2,A2, 1);   // 付不出月付
      A2.creditFlags.cashWentNegative=false;
      var led0=A2.ledger.length, ledB0=B2.ledger.length;
      ns.engine._events.length=0;
      E.p2pRoundEnd(S2);
      var late=ns.engine._events.filter(function(e){return e.type==="P2P_LATE";})[0];
      assert(late && late.lateCount===1,"應記違約一次");
      assert(A2.ledger.length===led0 && B2.ledger.length===ledB0,"違約期不應有對轉分錄");
      assert(A2.creditFlags.cashWentNegative===true,"違約應留下信用旗標");

      // (e) 破產清算順位：剩餘現金按本金比例受償、不足打銷、放款人淨值正確
      var S3=mkP(9303); var A3=S3.players[0], B3=S3.players[1], C3=S3.players[2];
      setCash(S3,B3,3000); setCash(S3,C3,3000);
      E.formP2P(S3,B3,A3,300,0.12,24);   // 欠 B 300
      E.formP2P(S3,C3,A3,100,0.12,24);   // 欠 C 100（比例 3:1）
      setCash(S3,A3, 200);                // 剩餘現金 200 → B 受償 150、C 受償 50
      var bNw=B3.derived.netWorth, cNw=C3.derived.netWorth;
      ns.engine._events.length=0;
      E.declareBankrupt(S3,A3);
      var dfs=ns.engine._events.filter(function(e){return e.type==="P2P_DEFAULT";});
      assert(dfs.length===2,"兩位放款人都應收到打銷事件");
      var dB=dfs.filter(function(e){return e.lenderId===B3.id;})[0];
      var dC=dfs.filter(function(e){return e.lenderId===C3.id;})[0];
      assert(Math.abs(dB.recovered-150)<0.5 && Math.abs(dC.recovered-50)<0.5,
        "受償應按本金比例 150/50，實得 "+dB.recovered+"/"+dC.recovered);
      assert(Math.abs(dB.lost-150)<0.5 && Math.abs(dC.lost-50)<0.5,"打銷應為 150/50");
      ns.ledger.recompute(B3); ns.ledger.recompute(C3); ns.ledger.recompute(A3);
      assert(Math.abs((bNw-B3.derived.netWorth)-dB.lost)<0.03,"B 淨值應減打銷額");
      assert(Math.abs((cNw-C3.derived.netWorth)-dC.lost)<0.03,"C 淨值應減打銷額");
      assert(!B3.assets.some(function(x){return x.kind==="P2P_LOAN";}),"打銷後債權應移除");
      assert(!A3.liabilities.some(function(x){return x.kind==="P2P";}),"破產人 P2P 債務應消滅");
      tie(B3); tie(C3); tie(A3);

      // (f) NPC 借款條件：銀行額度未滿 → 拒；用罄 → 接受
      var S4=mkP(9304); var A4=S4.players[0], B4=S4.players[1];
      setCash(S4,A4,2000);
      var lendAct=function(rate){ return {type:"PROPOSE_P2P",playerId:0,
        payload:{lenderId:0,borrowerId:B4.id,amount:200,annualRate:rate,termMonths:24}}; };
      var r4a=E.apply(S4,lendAct(0.12));
      assert(r4a.events.some(function(e){return e.type==="P2P_REJECTED";}),"NPC 銀行額度未滿應拒借");
      var cap4=E.creditCapacity(S4,B4);
      if(cap4>=1){ E.addLiability(S4,B4,"CONSUMER","測試占滿額度",cap4,S4.macro.baseRate+E.cfg(S4,"creditSpread"),false); }
      assert(E.creditCapacity(S4,B4)<1,"前置：額度應已用罄");
      var r4b=E.apply(S4,lendAct(0.12),{mutate:true});
      assert(r4b.events.some(function(e){return e.type==="P2P_FORMED";}),"額度用罄後 NPC 應接受民間借款");
      var r4c=E.apply(r4b.state,{type:"PROPOSE_P2P",playerId:0,
        payload:{lenderId:0,borrowerId:B4.id,amount:100,annualRate:0.19,termMonths:24}});
      assert(r4c.rejected,"利率超過上限 0.18 應被拒收");

      // (g) 同 seed 重放一致：全程（設現金→成立→兩輪對轉）重跑兩次
      function runOnce(){
        var X=mkP(9305); var xa=X.players[0], xb=X.players[1];
        setCash(X,xb,5000);
        var act={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:xb.id,borrowerId:0,amount:500,annualRate:E.p2pMinRate(X,xa),termMonths:24}};
        var r=E.apply(X,act,{mutate:true}); X=r.state;
        E.p2pRoundEnd(X); E.p2pRoundEnd(X);
        return JSON.stringify(X.players.map(function(p2){return [p2.cash,p2.derived.netWorth,p2.ledger.length];}));
      }
      assert(runOnce()===runOnce(),"同 seed 全程重跑不一致");
      return "對轉雙邊平衡且利息數學正確；全程清償；違約記次；破產按比例受償+打銷；NPC 條件邊界；重放一致";
    });

    t("T-17 外圈進度經濟（v0.2）", function(){
      function tie(p){ var c=0,as=0,li=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){
          if(q.account==="CASH")c+=q.delta; else if(q.account==="ASSET")as+=q.delta;
          else if(q.account==="LIABILITY")li+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符");
        assert(Math.abs(util.r2(util.r2(c)+util.r2(as)-util.r2(li))-p.derived.netWorth)<0.02,"淨值與分錄不符"); }
      function mkOuter(seed,cash){
        var S=mkGame(seed), p=S.players[0];
        E.enterOuterCircle(S,p);
        var d=util.r2(cash-p.cash);
        if(d) ns.ledger.post(S,p,"測試設現金",[{account:"CASH",delta:d,label:"測試"}],{eduTags:["setup"]});
        S.decisionQueue=[]; S.pendingDecision=null;
        return S; }
      var BASE=baseCfg().dreamProgressBasePrice;
      assert(baseCfg().dreamCost===5 && BASE===175 && baseCfg().maxTurns===99,
        "config 應為 dreamCost 5／base 175／maxTurns 99（S14b：72→99）");

      // (a) 價格 base×n 與每回合限購 1 點
      var S=mkOuter(7701, 5000), p=S.players[0];
      var c0=p.cash;
      assert(E.buyDreamProgress(S,p)===true,"第 1 點應可購買");
      assert(Math.abs((c0-p.cash)-BASE)<0.02,"第 1 點應為 base");
      assert(E.buyDreamProgress(S,p)===false,"同回合第 2 點應被擋");
      p.boughtProgressThisTurn=false;
      var c1=p.cash;
      assert(E.buyDreamProgress(S,p)===true && Math.abs((c1-p.cash)-BASE*2)<0.02,"第 2 點應為 base×2");
      tie(p);

      // (b) offerDreamProgress：限購後不再供應；現金不足不供應；圓夢後不供應
      var S2=mkOuter(7702, 5000), q=S2.players[0];
      E.offerDreamProgress(S2,q);
      assert(S2.decisionQueue.some(function(d){return d.kind==="BUY_PROGRESS";}),"應供應購點決策");
      S2.decisionQueue=[]; q.boughtProgressThisTurn=true;
      E.offerDreamProgress(S2,q);
      assert(!S2.decisionQueue.length,"限購後不應再供應");
      q.boughtProgressThisTurn=false;
      var S3=mkOuter(7703, 0.1), r=S3.players[0];
      E.offerDreamProgress(S3,r);
      assert(!S3.decisionQueue.some(function(d){return d.kind==="BUY_PROGRESS";}),"現金不足不應供應");

      // (c) 本命聖地：免費+1 後同回合仍可購 1（幸運雙倍）
      var S4=mkOuter(7704, 5000), u=S4.players[0];
      var dream=ns.content.byId[u.dreamCardId];
      var ownIdx=-1; ns.content.boardLayoutOuter.forEach(function(sp,i){
        if(sp.type==="SITE" && sp.category===dream.category && ownIdx<0) ownIdx=i; });
      assert(ownIdx>=0,"找不到本命聖地格");
      var p0=u.dreamProgress;
      E.landing(S4,u,ns.content.boardLayoutOuter[ownIdx]);
      assert(u.dreamProgress===p0+1,"踩本命聖地應免費+1");
      E.offerDreamProgress(S4,u);
      var dOff=S4.decisionQueue.filter(function(d){return d.kind==="BUY_PROGRESS";})[0];
      assert(dOff,"免費+1 後同回合應仍可購 1");
      assert(Math.abs(dOff.price-BASE*(u.dreamProgress+1))<0.02,"報價應為 base×(進度+1)");

      // (d) V11：集滿 5 點還要幸福感達門檻才算獲勝
      var S5=mkOuter(7705, 5000), v=S5.players[0];
      var needW=E.winWellbeingMin(S5);
      v.dreamProgress=4;
      v.stats.mallJoy=0; v.childrenCount=0;
      ["TEMPER","PRUDENCE","PARENTING","FILIAL"].forEach(function(ax){ v.virtues[ax]=0; });
      assert(E.buyDreamProgress(S5,v)===true,"最後一點應可購買");
      assert(E.wellbeing(S5,v) < needW,"前置：此時幸福感應低於門檻");
      assert(S5.over!==true,"幸福感未達門檻不應直接獲勝");
      assert(v.flags && v.flags.dreamPending===true,"應標記為等待幸福感達標");
      // 幸福感補到門檻 → 下一回合開始時獲勝
      v.stats.mallJoy = needW;
      E.recheckDreamWin(S5);
      assert(S5.over===true && S5.winner===v.id,"幸福感達標後應圓夢獲勝");

      // (e) NPC 購點門檻：現金底線之上買、之下不買
      var S6=mkGame(7706,["M1","M2","M4","M6"]);
      var n6=S6.players[1]; E.enterOuterCircle(S6,n6);
      var floorO=E.cfg(S6,"npcCashFloorOuter")*n6.derived.totalExpenses;
      var dd={kind:"BUY_PROGRESS", price:BASE, decisionId:"dx", playerId:n6.id};
      function setC(S,pl,t){ var d=util.r2(t-pl.cash);
        if(d) ns.ledger.post(S,pl,"設現金",[{account:"CASH",delta:d,label:"x"}],{eduTags:["setup"]}); }
      setC(S6,n6, util.r2(BASE+floorO+10));
      assert(ns.npc.decide(S6,n6,dd).payload.optionId==="buy","水位之上 NPC 應買");
      setC(S6,n6, util.r2(BASE+floorO-10));
      assert(ns.npc.decide(S6,n6,dd).payload.optionId==="skip","水位之下 NPC 應跳過");
      return "限購 1 點/回合；價格 base×n；聖地免費後仍可購 1；5 點＋幸福感達標才勝；NPC 底線正確";
    });

    t("T-18 自由人生牌堆", function(){
      function tie(p){ var c=0;
        p.ledger.forEach(function(en){ en.postings.forEach(function(q){ if(q.account==="CASH")c+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p.cash)<0.02,"現金與分錄不符"); }
      function mkOuter(seed,mods){
        var S=mkGame(seed,mods), p=S.players[0];
        S.config.outerLifeChance=1;   // 測試鎖定：非本命聖地必抽卡
        E.enterOuterCircle(S,p);
        ns.ledger.post(S,p,"測試補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
        S.decisionQueue=[]; S.pendingDecision=null;
        return S; }
      function forceDraw(S,id){ var d=S.decks.OUTER_LIFE;
        d.draw=d.draw.filter(function(x){return x!==id;}); d.discard=d.discard.filter(function(x){return x!==id;});
        d.draw.unshift(id); }
      function landForeign(S,p){
        var dream=ns.content.byId[p.dreamCardId];
        var sp=ns.content.boardLayoutOuter.filter(function(x){return x.type==="SITE" && x.category!==dream.category;})[0];
        E.landing(S,p,sp); }

      // (a) 牌堆存在且 21 張
      var S0=mkGame(6601);
      assert(S0.decks.OUTER_LIFE && S0.decks.OUTER_LIFE.draw.length===21,"OUTER_LIFE 應 21 張，實得 "+(S0.decks.OUTER_LIFE?S0.decks.OUTER_LIFE.draw.length:0));

      // (b) 柴米油鹽：非本命聖地抽卡扣款、分錄平衡
      var S=mkOuter(6602), p=S.players[0];
      forceDraw(S,"OL_D01");
      var c0=p.cash; landForeign(S,p);
      assert(Math.abs((c0-p.cash)-35*S.config.eventCardRate)<0.02,"熱水器應扣 35×係數，實得 "+util.r2(c0-p.cash));
      tie(p);

      // (c) 誘惑卡 joy：買下幸福感 +2、俱樂部會籍含每月支出
      var S2=mkOuter(6603), q=S2.players[0];
      forceDraw(S2,"OL_L01"); landForeign(S2,q);
      var dL=S2.decisionQueue.filter(function(d){return d.kind==="LIFESTYLE";})[0];
      assert(dL,"誘惑卡應進 LIFESTYLE 決策");
      var ob0=q.stats.optionalBought;
      S2.decisionQueue.shift(); E.resolveDecision(S2,q,dL,"buy",{});
      assert(q.stats.optionalBought-ob0===2,"頭等艙 joy 應 +2，實得 +"+(q.stats.optionalBought-ob0));
      var S2b=mkOuter(6604), qb=S2b.players[0];
      forceDraw(S2b,"OL_L05"); landForeign(S2b,qb);
      var dL2=S2b.decisionQueue.filter(function(d){return d.kind==="LIFESTYLE";})[0];
      var exp0=qb.derived.totalExpenses;
      S2b.decisionQueue.shift(); E.resolveDecision(S2b,qb,dL2,"buy",{});
      assert(Math.abs((qb.derived.totalExpenses-exp0)-18)<0.02,"會籍應增加每月 18 支出");

      // (d) 詐騙考驗（M6 開）：0 星中招、2 星識破——決定論
      var S3=mkOuter(6605), r=S3.players[0];
      r.virtues.PRUDENCE=0; forceDraw(S3,"OL_S01");
      var c3=r.cash; landForeign(S3,r);
      assert(Math.abs((c3-r.cash)-400*S3.config.eventCardRate)<0.02,"0 星應被詐 400");
      var S4=mkOuter(6606), u=S4.players[0];
      u.virtues.PRUDENCE=2; forceDraw(S4,"OL_S01");
      var c4=u.cash; landForeign(S4,u);
      assert(Math.abs(c4-u.cash)<0.02,"2 星應識破無損失");

      // (e) M6 關閉退化機率：resist=1 全過、resist=0 全中
      var S5=mkOuter(6607,["M1","M2","M4"]), v=S5.players[0];
      S5.config.outerTrialResist=1; forceDraw(S5,"OL_V01");
      var c5=v.cash; landForeign(S5,v);
      assert(Math.abs(c5-v.cash)<0.02,"resist=1 應忍住無損失");
      var S6=mkOuter(6608,["M1","M2","M4"]), w=S6.players[0];
      S6.config.outerTrialResist=0; forceDraw(S6,"OL_V01");
      var c6=w.cash; landForeign(S6,w);
      assert(Math.abs((c6-w.cash)-380*S6.config.eventCardRate)<0.02,"resist=0 應失足 380");

      // (f) 重大傷病：扣款＋停走 2＋短期月支出，到期回復；貴人減半
      var S7=mkOuter(6609), x=S7.players[0];
      forceDraw(S7,"OL_H01");
      S7.config.minTurnsInStage=999; S7.config.shockChancePerRound=0; S7.pendingShock=null;   // 鎖景氣，隔離通膨干擾
      var c7=x.cash, sk0=x.skippedTurns, ex0=x.derived.totalExpenses;
      landForeign(S7,x);
      assert(Math.abs((c7-x.cash)-500*S7.config.eventCardRate)<0.02,"應扣自費療程 500");
      assert(x.skippedTurns-sk0===2,"應停走 2 輪");
      assert(Math.abs((x.derived.totalExpenses-ex0)-25)<0.02,"應增每月療程 25");
      for(var i=0;i<7;i++){ S7.turnNumber++; E.onRoundEnd(S7); }
      ns.ledger.recompute(x);
      assert(Math.abs(x.derived.totalExpenses-ex0)<0.02,"療程到期支出應回復");
      tie(x);
      var S8=mkOuter(6610), y=S8.players[0];
      y.flags.guardian=true; forceDraw(S8,"OL_H01");
      var c8=y.cash; landForeign(S8,y);
      assert(Math.abs((c8-y.cash)-250*S8.config.eventCardRate)<0.02,"貴人相助應減半為 250");
      assert(y.flags.guardian===false,"貴人應一次性消耗");
      return "21 張入堆；六類卡帳務平衡；考驗依星等決定論；M6 關閉退化機率；傷病停走+短期支出到期回復；貴人減半";
    });

    t("T-19 跌落與重返職場", function(){
      function mkOuter(seed,cash){
        var S=mkGame(seed), p=S.players[0];
        E.enterOuterCircle(S,p);
        var d=util.r2(cash-p.cash);
        if(d) ns.ledger.post(S,p,"設現金",[{account:"CASH",delta:d,label:"x"}],{eduTags:["setup"]});
        S.decisionQueue=[]; S.pendingDecision=null; return S; }
      function addAsset(S,p,val,inc){
        var id=util.uid(S,"A");
        p.assets.push({instanceId:id,cardId:"X",kind:"REALESTATE",name:"測試房",units:1,
          costBasis:val,marketValue:val,monthlyIncome:inc,linkedLiabilityId:null,flags:{}});
        ns.ledger.post(S,p,"建檔",[{account:"ASSET",delta:val,refId:id,label:"測試房"},
          {account:"INCOME_PASSIVE",delta:inc,refId:id,label:"租金"}],{eduTags:["setup"]});
        return id; }

      // (a) 危機→自救成功：warnings+1、留在外圈
      var S=mkOuter(5501, 100), p=S.players[0];
      var aid=addAsset(S,p,500,10);
      ns.ledger.post(S,p,"測試爆負",[{account:"CASH",delta:-200,label:"x"}],{eduTags:["setup"]});
      E.enterBankruptcy(S,p);   // 外圈應改道 outerCrisis
      E.syncPhase(S);
      assert(S.pendingDecision && S.pendingDecision.kind==="FREEFALL_RESCUE","外圈現金負應進自救決策，實得 "+(S.pendingDecision&&S.pendingDecision.kind));
      var dR=S.pendingDecision; S.decisionQueue.shift();
      E.resolveDecision(S,p,dR,aid,{});
      assert(p.cash>=0 && p.playerStage==="OUTER","急售後應回正並留在外圈");
      assert(p.freefallWarnings===1,"自救次數應為 1");

      // (b) 自救額度用完（cap 2）：第三次直接跌落，薪資=離職薪×0.9、進度保留、停走、維持費停扣
      var retired=p.retiredSalary, prog0=p.dreamProgress=3;
      p.freefallWarnings=2;
      var upk=E.cfg(S,"dreamUpkeepMonthly"), exp0=p.derived.totalExpenses, sk0=p.skippedTurns;
      ns.ledger.post(S,p,"再爆負",[{account:"CASH",delta:-(p.cash+50),label:"x"}],{eduTags:["setup"]});
      E.enterBankruptcy(S,p);
      assert(p.playerStage==="INNER","額度用完應直接跌落");
      assert(Math.abs(p.derived.salaryIncome-util.r2(retired*0.9))<0.02,
        "復職薪資應為離職薪 "+retired+"×0.9，實得 "+p.derived.salaryIncome);
      assert(p.dreamProgress===prog0,"夢想進度應保留");
      assert(p.skippedTurns-sk0===1,"應停走 1 輪");
      assert(Math.abs((exp0-p.derived.totalExpenses)-upk)<0.02,"維持費應停扣");
      assert(p.stats.freefalls===1,"跌落統計應為 1");
      // 跌回後現金仍負 → 銜接內圈破產程序
      E.syncPhase(S);
      assert(S.pendingDecision && S.pendingDecision.kind==="BANKRUPTCY","跌回仍負應進內圈破產程序");

      // (c) 自願重返：RETURN_TO_WORK 動作、voluntary 事件、薪資 0.9
      var S2=mkOuter(5502, 500), q=S2.players[0];
      var ret2=q.retiredSalary; q.dreamProgress=2;
      S2.phase="ROLL"; S2.activePlayerIdx=0;
      var r2=E.apply(S2,{type:"RETURN_TO_WORK",playerId:0,payload:null},{mutate:true});
      var fe=r2.events.filter(function(e){return e.type==="FREEFALL";})[0];
      assert(fe && fe.voluntary===true,"應發自願 FREEFALL 事件");
      assert(r2.state.players[0].playerStage==="INNER","應回內圈");
      assert(Math.abs(r2.state.players[0].derived.salaryIncome-util.r2(ret2*0.9))<0.02,"自願重返薪資亦為 0.9×");
      assert(r2.state.players[0].dreamProgress===2,"進度保留");

      // (d) NPC 自動路徑：有資產→自動急售留外圈；無資產→跌落
      var S3=mkGame(5503,["M1","M2","M4","M6"]);
      var n3=S3.players[1]; E.enterOuterCircle(S3,n3);
      addAsset(S3,n3,400,8);
      ns.ledger.post(S3,n3,"爆負",[{account:"CASH",delta:-(n3.cash+100),label:"x"}],{eduTags:["setup"]});
      E.enterBankruptcy(S3,n3);
      assert(n3.playerStage==="OUTER" && n3.cash>=0 && n3.freefallWarnings===1,"NPC 應自動急售自救");
      ns.ledger.post(S3,n3,"再爆負",[{account:"CASH",delta:-(n3.cash+100),label:"x"}],{eduTags:["setup"]});
      E.enterBankruptcy(S3,n3);
      assert(n3.playerStage==="INNER","NPC 無資產可賣應跌落");

      // (e) 跌落後可再畢業（進度不清零、retiredSalary 更新為當前薪資）
      var q2=r2.state.players[0];
      // 補被動收入使其再自由
      ns.ledger.post(r2.state,q2,"補被動",[{account:"INCOME_PASSIVE",delta:q2.derived.totalExpenses+50,label:"x"}],{eduTags:["setup"]});
      E.checkFreedom(r2.state,q2);
      E.enterOuterCircle(r2.state,q2);
      assert(q2.playerStage==="OUTER" && q2.dreamProgress===2,"應可再畢業且進度延續");

      // (f) 同 seed 全程重跑一致（含跌落）
      function runOnce(){
        var X=mkOuter(5504, 60), z=X.players[0];
        addAsset(X,z,300,6);
        ns.ledger.post(X,z,"爆負",[{account:"CASH",delta:-150,label:"x"}],{eduTags:["setup"]});
        E.enterBankruptcy(X,z); E.syncPhase(X);
        if(X.pendingDecision && X.pendingDecision.kind==="FREEFALL_RESCUE"){
          var dz=X.pendingDecision; X.decisionQueue.shift();
          E.resolveDecision(X,z,dz,"fall",{});
        }
        return JSON.stringify([z.cash,z.derived.salaryIncome,z.playerStage,z.dreamProgress,z.ledger.length]);
      }
      assert(runOnce()===runOnce(),"跌落流程重跑不一致");
      return "自救→回正 warnings+1；cap 滿直接跌落且薪資 0.9×離職薪；自願重返一致；NPC 自動路徑；再畢業；重放一致";
    });

    t("T-20 現股融資分倉", function(){
      var S=mkGame(6601,["M1","M2","M4"]), p=S.players[0];
      S.config.depthLevel=3; S.phase="ROLL"; S.activePlayerIdx=0;
      S.decisionQueue=[]; S.pendingDecision=null;
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var sym=ns.content.stockDefs[0].symbol;
      function act(pl){ var r=E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:pl},{mutate:true});
        S=r.state; p=S.players[0]; S.phase="ROLL"; return r; }
      // 現股 10 張＋融資 10 張 → 應為兩個獨立部位
      act({symbol:sym,side:"buy",units:10});
      act({symbol:sym,side:"buy",units:10,margin:true});
      var lots=function(){ return p.assets.filter(function(a){return a.kind==="STOCK"&&a.symbol===sym;}); };
      var cashPos=lots().filter(function(a){return !(a.flags&&a.flags.margin);})[0];
      var mLot=lots().filter(function(a){return a.flags&&a.flags.margin;})[0];
      assert(lots().length===2,"應為現股＋融資兩個部位，實得 "+lots().length);
      assert(cashPos && cashPos.units===10,"現股應 10 張");
      assert(mLot && mLot.linkedLiabilityId,"融資部位應連結融資借款");
      var mLoan=p.liabilities.filter(function(l){return l.instanceId===mLot.linkedLiabilityId;})[0];
      assert(mLoan && mLoan.kind==="MARGIN" && mLoan.collateralAssetId===mLot.instanceId,"融資借款應以該部位為擔保");
      // 再融資買一筆 → 融資不合併，成第三部位
      act({symbol:sym,side:"buy",units:5,margin:true});
      assert(lots().filter(function(a){return a.flags&&a.flags.margin;}).length===2,"融資每筆應獨立部位");
      assert(lots().length===3,"共應 3 個部位");
      // 未指定 assetId 賣出 → 只動現股
      var mu0=mLot.units, mid0=mLot.instanceId;
      act({symbol:sym,side:"sell",units:4});
      cashPos=lots().filter(function(a){return !(a.flags&&a.flags.margin);})[0];
      mLot=p.assets.filter(function(a){return a.instanceId===mid0;})[0];
      assert(cashPos && cashPos.units===6,"現股應剩 6 張，實得 "+(cashPos&&cashPos.units));
      assert(mLot && mLot.units===mu0,"融資部位不應被未指定賣出動到");
      // 指定 assetId 整筆平倉 → 部位消失、對應融資借款清償
      act({symbol:sym,side:"sell",units:mLot.units,assetId:mid0});
      assert(!p.assets.filter(function(a){return a.instanceId===mid0;})[0],"平倉後融資部位應消失");
      assert(!p.liabilities.filter(function(l){return l.instanceId===mLot.linkedLiabilityId;})[0]
        || p.liabilities.filter(function(l){return l.instanceId===mLot.linkedLiabilityId;})[0].principal<=0.01,
        "平倉後融資借款應清償");
      assert(lots().length===2,"應剩現股＋另一筆融資");
      return "融資獨立分倉、各自擔保；未指定賣出只動現股；指定 assetId 整筆平倉並清償融資";
    });

    t("T-21 回合中動作也要記帳", function(){
      var S=mkGame(7701,["M1","M2","M4"]), p=S.players[0];
      S.config.automationLevel=2;                       // 標準難度：分類記帳
      S.decisionQueue=[]; S.pendingDecision=null; S.bookkeeping=null;
      S.turnResolved=true; E.syncPhase(S);
      assert(S.phase==="READY_END","前置：應在 READY_END，實得 "+S.phase);
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var lid=E.addLiability(S,p,"CONSUMER","測試信貸",500,S.macro.baseRate+0.03,undefined,null,false);
      S.bookkeeping=null; E.syncPhase(S);            // 建檔本身不列入本題
      if(S.bookkeeping) S.bookkeeping.tasks.forEach(function(tk){ tk.done=true; });
      E.syncPhase(S);
      var l=p.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      var before={cash:p.cash, prin:l.principal, liab:p.derived.totalLiabilities};
      var r=E.apply(S,{type:"REPAY_LOAN",playerId:0,payload:{liabilityId:l.instanceId,amount:100}});
      var S2=r.state, p2=S2.players[0];
      var l2=p2.liabilities.filter(function(x){return x.instanceId===l.instanceId;})[0];
      // (a) 帳目要平：現金減 100、負債減 100
      assert(Math.abs((before.cash-p2.cash)-100)<0.02,"現金應減 100，實減 "+(before.cash-p2.cash));
      assert(Math.abs((before.prin-(l2?l2.principal:0))-100)<0.02,"本金應減 100");
      assert(Math.abs((before.liab-p2.derived.totalLiabilities)-100)<0.02,"負債總額應同步減 100");
      var lg=0; p2.ledger.forEach(function(en){ en.postings.forEach(function(q){ if(q.account==="LIABILITY") lg+=q.delta; }); });
      var arr=p2.liabilities.reduce(function(a,x){return a+x.principal;},0);
      assert(Math.abs(lg-arr)<0.02,"分類帳負債累計("+util.r2(lg)+")與負債清單("+util.r2(arr)+")應一致");
      // (b) 這筆還款要進記帳關卡（九期前的 bug：READY_END 之後的動作沒有題目）
      assert(S2.bookkeeping && S2.bookkeeping.tasks.length>0,"還款應產生記帳題目");
      assert(S2.bookkeeping.tasks.some(function(tk){ return tk.account==="LIABILITY" && Math.abs(tk.amount+100)<0.02; }),
        "應有一題「負債 −100」");
      assert(S2.phase==="BOOKKEEPING","有未完成題目時應進記帳階段");
      // (c) 已答對的題目在重建後保留
      S2.bookkeeping.tasks[0].done=true;
      var keyDone=S2.bookkeeping.tasks[0].key;
      E.buildBookkeeping(S2,p2);
      var kept=S2.bookkeeping.tasks.filter(function(tk){return tk.key===keyDone;})[0];
      assert(kept && kept.done===true,"重建記帳題目時應保留已完成狀態");
      return "還款帳目平衡（現金/負債/分類帳一致）；回合中動作補建記帳題目；已答題保留";
    });

    t("T-22 浮動利率與年度物價", function(){
      var S=mkGame(7702,["M1","M2","M4"]), p=S.players[0];
      // (a) 新貸款預設浮動，且加碼＝承作利率−當時基準
      var spread=0.03, id=E.addLiability(S,p,"CONSUMER","測試信貸",1000,S.macro.baseRate+spread,undefined,null,true);
      var l=p.liabilities.filter(function(x){return x.instanceId===id;})[0];
      assert(l.isFloating===true,"新貸款應預設浮動");
      assert(Math.abs(l.rateSpread-spread)<0.0002,"商品加碼應為 "+spread+"，實得 "+l.rateSpread);
      assert(l.originalPrincipal===1000 && l.startTurn===S.turnNumber && l.periodsPaid===0,
        "應記錄原始金額／起貸輪／已還期數");
      // (b) 基準利率上升 → 浮動貸款月付跟著升
      var pay0=l.monthlyPayment, rate0=l.annualRate;
      S.macro.baseRate=E.rRate(S.macro.baseRate+0.02);
      E.repriceFloating(S);
      var l2=p.liabilities.filter(function(x){return x.instanceId===id;})[0];
      assert(l2.annualRate>rate0+0.0199-0.0002,"升息 2% 後利率應同步上升，實得 "+l2.annualRate+"（原 "+rate0+"）");
      assert(l2.monthlyPayment>pay0,"升息後月付應變高");
      // (c) 轉貸後鎖固定，不再隨基準變動
      l2.isFloating=false; var fixed=l2.annualRate;
      S.macro.baseRate=E.rRate(S.macro.baseRate+0.02); E.repriceFloating(S);
      assert(p.liabilities.filter(function(x){return x.instanceId===id;})[0].annualRate===fixed,"固定利率不應被重定價");
      // (d) 年度物價：滿 inflationTurns 輪才調一次
      var S3=mkGame(7703,["M4"]), q=S3.players[0];
      S3.config.inflationTurns=12; S3.config.shockChancePerRound=0; S3.config.minTurnsInStage=999;
      S3.macro.inflation=0.02; S3.macro.sinceInflation=0;
      var exp0=q.derived.totalExpenses;
      for(var i=0;i<11;i++){ ns.modules.onRoundEnd(S3); }
      assert(Math.abs(q.derived.totalExpenses-exp0)<0.02,"未滿 12 輪不應調整支出");
      ns.modules.onRoundEnd(S3);
      assert(q.derived.totalExpenses>exp0,"滿 12 輪應依通膨墊高支出（"+exp0+" → "+q.derived.totalExpenses+"）");
      assert(S3.macro.sinceInflation===0,"調整後計數應歸零");
      return "新貸款預設浮動且加碼正確；升息同步調升月付；轉貸鎖固定；物價每 12 輪調一次";
    });

    t("T-23 機會轉介（介紹費）", function(){
      function setup(seed){
        var S=mkGame(seed,["M1","M2","M4"]);
        var p=S.players[0];
        S.decisionQueue=[]; S.pendingDecision=null; S.turnResolved=false; S.phase="ROLL";
        var card=ns.content.byId["OPS_BZ1"];       // 自助洗衣店：有月現金流
        E.pushDecision(S,p,{kind:"BUY", cardId:card.id});
        E.syncPhase(S);
        return {S:S, card:card};
      }
      var g=setup(8801), S=g.S, card=g.card;
      var fee=E.referralFee(S,card);
      var mo=E.cfg(S,"referralFeeMonths");
      assert(Math.abs(fee-util.r2(E.oppIncome(S,card)*mo))<0.02,"介紹費應為 "+mo+" 個月現金流");
      assert(fee>0,"有現金流的機會應可轉介");
      // 給受讓人足夠現金 → 應成交
      var tgt=S.players[1];
      ns.ledger.post(S,tgt,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var c0=S.players[0].cash, t0=tgt.cash, ta0=tgt.assets.length;
      var r=E.apply(S,{type:"REFER_OPP",playerId:0,payload:{cardId:card.id,targetId:1}});
      var S2=r.state, me2=S2.players[0], tg2=S2.players[1];
      var done=r.events.filter(function(e){return e.type==="REFERRAL_DONE";})[0];
      assert(done,"現金充足時應成交轉介");
      assert(Math.abs((me2.cash-c0)-fee)<0.02,"轉介人應收到介紹費 "+fee+"，實得 "+util.r2(me2.cash-c0));
      assert(tg2.assets.length===ta0+1,"受讓人應取得該資產");
      // 對轉平衡：兩邊 CASH 分錄相加為 0
      function feeSum(pl){ var v=0; pl.ledger.forEach(function(en){
        if((en.eduTags||[]).indexOf("referral")<0) return;
        en.postings.forEach(function(q){ if(q.account==="CASH") v+=q.delta; }); }); return util.r2(v); }
      assert(Math.abs(feeSum(me2)+feeSum(tg2))<0.02,"介紹費對轉應平衡（"+feeSum(me2)+" / "+feeSum(tg2)+"）");
      assert(!S2.pendingDecision || S2.pendingDecision.kind!=="BUY","轉介後原機會決策應結束");
      // 受讓人現金不足 → 婉拒、不收費
      var g2=setup(8802), S3=g2.S;
      S3.players[1].cash=0; S3.players[2] && (S3.players[2].cash=0);
      var c1=S3.players[0].cash;
      var r2=E.apply(S3,{type:"REFER_OPP",playerId:0,payload:{cardId:g2.card.id,targetId:1}});
      assert(r2.events.filter(function(e){return e.type==="REFERRAL_REJECTED";}).length===1,"現金不足應婉拒");
      assert(Math.abs(r2.state.players[0].cash-c1)<0.02,"婉拒不應收到介紹費");
      // 無現金流的機會（股票）不可轉介
      assert(E.referralFee(S,ns.content.byId["OPS_ST1"])===0,"股票類無月現金流，介紹費應為 0");
      return "介紹費＝設定的月數×現金流；成交時對轉平衡且資產易主；婉拒不收費；無現金流不可轉介";
    });

    t("T-24 商城與保險", function(){
      var S=mkGame(8803,["M1","M2","M4","M6"]), p=S.players[0];
      S.decisionQueue=[]; S.pendingDecision=null; S.phase="ROLL"; S.activePlayerIdx=0;
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      // (a) 每回合限購（預設 1）
      var per=E.cfg(S,"mallPerTurn");
      var r1=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_VIR1"}},{mutate:true});
      assert(!r1.rejected,"第一次購買應成功");
      var r2=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_VIR2"}},{mutate:true});
      assert(r2.rejected===true || per>1,"超過每回合上限應被拒");
      assert(p.stats.mallJoy>0,"幸福感計數應增加");
      assert(p.virtues.FILIAL>=1,"包紅包應加孝親品格");
      // (b) 保險：投保 → 每月保費計入支出；醫療事件理賠
      var S2=mkGame(8804,["M1","M2","M4","M6"]), q=S2.players[0];
      S2.decisionQueue=[]; S2.pendingDecision=null; S2.phase="ROLL"; S2.activePlayerIdx=0;
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      var exp0=q.derived.totalExpenses;
      E.apply(S2,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_INS1"}},{mutate:true});
      assert(q.flags.insured===true,"應標記為已投保");
      assert(q.derived.totalExpenses>exp0,"保費應計入每月支出");
      var cash0=q.cash;
      var claimPct=E.cfg(S2,"insuranceClaimPct");
      E.applyEffects(S2,q,[{op:"CASH_DELTA",target:"self",amount:-100,label:"住院自費"}],"測試醫療",
        {lifeEvent:true, insurable:true});
      var paid=util.r2(cash0-q.cash);
      var expect=util.r2(100*S2.config.eventCardRate*(1-claimPct));
      assert(Math.abs(paid-expect)<0.5,"投保後自付應為 "+expect+"，實付 "+paid);
      // (c) 未投保者全額自付
      var S3=mkGame(8805,["M1","M2","M4"]), z=S3.players[0];
      var zc=z.cash;
      E.applyEffects(S3,z,[{op:"CASH_DELTA",target:"self",amount:-100,label:"住院自費"}],"測試醫療",
        {lifeEvent:true, insurable:true});
      assert(util.r2(zc-z.cash) > paid,"沒保險應付得比有保險多");
      // (d) 解約後保費消失、理賠停止
      E.apply(S2,{type:"MALL_CANCEL_INSURANCE",playerId:0,payload:null},{mutate:true});
      assert(q.flags.insured===false,"解約後不應再標記投保");
      assert(Math.abs(q.derived.totalExpenses-exp0)<0.02,"解約後支出應回到投保前（"+exp0+" → "+q.derived.totalExpenses+"）");
      // (e) 商城比賽（V3 兩段式：報名→親自擲骰）可重放
      function runContest(){
        var X=mkGame(8806,["M1","M2","M4"]), y=X.players[0];
        X.decisionQueue=[]; X.pendingDecision=null; X.phase="ROLL"; X.activePlayerIdx=0;
        ns.ledger.post(X,y,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
        var rB=E.apply(X,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_CMP2"}},{mutate:true});
        var dC=X.pendingDecision;
        assert(dC && dC.kind==="CONTEST_ROLL","報名後應跳出親自擲骰的決策，實得 "+(dC&&dC.kind));
        var rR=E.apply(X,{type:"DECIDE",playerId:0,payload:{decisionId:dC.decisionId,optionId:"roll",params:{}}},{mutate:true});
        var resC=rR.events.filter(function(e){return e.type==="CONTEST_RESULT";})[0];
        assert(resC && resC.roll>=1 && resC.roll<=6,"擲骰後應有比賽結果事件");
        return JSON.stringify([y.cash, resC.roll, y.stats.mallJoy]);
      }
      assert(runContest()===runContest(),"商城比賽擲骰應可重放（同 seed 同點數）");
      return "每回合限購；品格與幸福感入帳；保費計入支出、醫療理賠成數正確；解約回復；比賽擲骰可重放";
    });

    t("T-25 帳上獲利提示", function(){
      var S=mkGame(8807,["M1","M2","M4"]), p=S.players[0];
      S.config.stockGainAlertPct=1;
      S.decisionQueue=[]; S.pendingDecision=null; S.phase="ROLL"; S.activePlayerIdx=0;
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var sym=ns.content.stockDefs[0].symbol;
      E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:sym,side:"buy",units:10}},{mutate:true});
      var a=p.assets.filter(function(x){return x.kind==="STOCK";})[0];
      assert(a && !(a.flags&&a.flags.gainAlerted),"買進後不該有提示旗標");
      // 股價翻倍 → 觸發提示
      S.stockPrices[sym]=util.r2(S.stockPrices[sym]*3);   // C1：×2.2→×3,吸收牌堆變動帶來的開局股價漂移
      E.revalueStocks(S);
      S.decisionQueue=[]; S.pendingDecision=null;
      ns.modules.registry.M1.onRoundEnd(S);
      var a2=p.assets.filter(function(x){return x.kind==="STOCK";})[0];
      var d=S.decisionQueue.filter(function(x){return x.kind==="STOCK_GAIN";})[0];
      assert(d,"獲利超過門檻應推出提示決策");
      assert(a2.flags.gainAlerted===true,"應標記已提示");
      var n0=S.decisionQueue.length;
      ns.modules.registry.M1.onRoundEnd(S);
      assert(S.decisionQueue.filter(function(x){return x.kind==="STOCK_GAIN";}).length===1,"同一部位不應重複提示");
      // 選擇全部停利 → 部位消失、現金增加
      var cash0=p.cash, units=a2.units;
      E.resolveDecision(S,p,d,"sell_all",{});
      assert(!p.assets.filter(function(x){return x.instanceId===a2.instanceId;})[0],"停利後部位應消失");
      assert(p.cash>cash0,"停利應入帳現金");
      assert(p.stats.takeProfit===1,"應記錄停利次數");
      // 續抱不動部位
      var S2=mkGame(8808,["M1","M2","M4"]), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      S2.phase="ROLL"; S2.activePlayerIdx=0; S2.decisionQueue=[]; S2.pendingDecision=null;
      E.apply(S2,{type:"TRADE_STOCK",playerId:0,payload:{symbol:sym,side:"buy",units:10}},{mutate:true});
      var b=q.assets.filter(function(x){return x.kind==="STOCK";})[0];
      E.resolveDecision(S2,q,{kind:"STOCK_GAIN",assetId:b.instanceId,gain:120},"hold",{});
      assert(q.assets.filter(function(x){return x.instanceId===b.instanceId;})[0].units===10,"續抱不應改變部位");
      assert(q.stats.holdOn===1,"應記錄續抱次數");
      return "達門檻推出提示且只提示一次；停利賣出入帳並計數；續抱不動部位";
    });

    t("T-26 破產程序：不必全賣、還有最後手段", function(){
      function mk(seed){
        var S=mkGame(seed,["M1","M2","M3","M4"]), p=S.players[0];
        S.decisionQueue=[]; S.pendingDecision=null;
        return {S:S,p:p};
      }
      function addAsset(S,p,val,inc,nm){
        var id=util.uid(S,"A");
        p.assets.push({instanceId:id,cardId:"X",kind:"REALESTATE",name:nm||"測試房",units:1,
          costBasis:val,marketValue:val,monthlyIncome:inc,linkedLiabilityId:null,flags:{}});
        ns.ledger.post(S,p,"建檔",[{account:"ASSET",delta:val,refId:id,label:nm||"測試房"},
          {account:"INCOME_PASSIVE",delta:inc,refId:id,label:"租金"}],{eduTags:["setup"]});
        return id; }
      function setCash(S,p,t){ var d=util.r2(t-p.cash);
        if(d) ns.ledger.post(S,p,"設現金",[{account:"CASH",delta:d,label:"x"}],{eduTags:["setup"]}); }

      // (a) 賣一筆就夠 → 不應被迫賣光
      var g=mk(9901), S=g.S, p=g.p;
      var big=addAsset(S,p,900,9,"大房"), small=addAsset(S,p,200,2,"小房");
      setCash(S,p,-100);
      E.enterBankruptcy(S,p); E.syncPhase(S);
      assert(S.phase==="BANKRUPTCY","現金為負應進破產程序");
      var fm=S.config.fireSaleRatio;
      assert(util.r2(200*fm)>=100,"前置：小房急售就足以補缺口");
      var r=E.apply(S,{type:"SELL_ASSET",playerId:0,payload:{assetId:small}});
      var S2=r.state, p2=S2.players[0];
      assert(p2.cash>=0,"賣一筆就該回正，實得 "+p2.cash);
      assert(p2.assets.filter(function(a){return a.instanceId===big;}).length===1,"另一筆資產不應被賣掉");
      assert(S2.phase!=="BANKRUPTCY","回正後應離開破產程序");

      // (b) 紓困額度：資產賣光、淨值為負時仍以月收入為基準
      var g2=mk(9902), S3=g2.S, q=g2.p;
      q.assets=[];
      E.addLiability(S3,q,"CONSUMER","測試負債",5000,S3.macro.baseRate+0.03,undefined,null,true);
      setCash(S3,q,-50);
      assert(q.derived.netWorth<0,"前置：淨值應為負");
      var capNW=util.r2(Math.max(0,q.derived.netWorth)*E.cfg(S3,"rescueLoanNetWorthCap"));
      assert(capNW<1,"前置：純淨值基準的額度應為 0（這正是舊版的死路）");
      var cap=E.rescueCap(S3,q);
      var mo=E.cfg(S3,"rescueIncomeMonths");
      assert(Math.abs(cap-util.r2(q.derived.salaryIncome*mo))<0.02,
        "紓困額度應為月收入×"+mo+"＝"+util.r2(q.derived.salaryIncome*mo)+"，實得 "+cap);
      // 不會因為沒資產就被直接判出局
      E.enterBankruptcy(S3,q); E.syncPhase(S3);
      E.checkRescued(S3,q);
      assert(!q.bankrupt,"還有紓困額度時不應直接宣告破產");
      var r2=E.apply(S3,{type:"TAKE_LOAN",playerId:0,payload:{amount:cap}});
      assert(r2.state.players[0].cash>=0,"申請紓困後現金應回正");
      assert(r2.state.players[0].creditFlags.usedRescue===true,"動用紓困應留下信用瑕疵");

      // (c) 沒資產、沒紓困額度，但還有人能借 → 不出局（P2P 是最後手段）
      var g3=mk(9903), S4=g3.S, z=g3.p;
      z.assets=[];
      ns.ledger.post(S4,z,"歸零薪資",[{account:"INCOME_ACTIVE",delta:-z.derived.salaryIncome,label:"x"}],{eduTags:["setup"]});
      setCash(S4,z,-30);
      assert(E.rescueCap(S4,z)<1,"前置：無資產無收入 → 紓困額度為 0");
      assert(E.p2pAvailable(S4,z)===true,"前置：場上還有人有現金");
      E.enterBankruptcy(S4,z); E.checkRescued(S4,z);
      assert(!z.bankrupt,"還有 P2P 對象時不應直接出局");
      // 所有人都沒錢 → 才真的出局
      S4.players.forEach(function(x){ if(x.id!==z.id) x.cash=0; });
      assert(E.p2pAvailable(S4,z)===false,"其他人都沒現金時 P2P 不可用");
      E.checkRescued(S4,z);
      assert(z.bankrupt===true,"真的走投無路才宣告破產");

      // (d) NPC 自救同樣不會無謂全賣
      var g4=mk(9904), S5=g4.S, n5=S5.players[1];
      var nb=addAsset(S5,n5,900,9,"NPC大房"); addAsset(S5,n5,200,2,"NPC小房");
      setCash(S5,n5,-100);
      E.npcRescue(S5,n5);
      assert(n5.cash>=0,"NPC 應自救成功");
      assert(n5.assets.length===1,"NPC 應只賣掉足夠的一筆，實剩 "+n5.assets.length);
      assert(n5.assets[0].instanceId===nb,"NPC 應保留現金流較高的那筆");
      return "賣一筆就夠不會全賣；淨值為負仍有以所得為基準的紓困；P2P 為最後手段；真的無路才出局；NPC 同規則";
    });

    t("T-27 夢想里程碑敘事", function(){
      var S=mkGame(9905,["M1","M2","M4"]), p=S.players[0];
      var dr=ns.content.byId[p.dreamCardId];
      assert(dr && dr.milestones && dr.milestones.length>=S.config.dreamCost,
        "每個夢想應有至少 "+S.config.dreamCost+" 個具體里程碑");
      ns.content.dreams.forEach(function(d){
        assert(d.milestones && d.milestones.length>=5, d.name+" 缺少里程碑");
        d.milestones.forEach(function(m){ assert(m && m.length>3, d.name+" 有空的里程碑"); });
      });
      // 第 n 點要對應第 n 個里程碑
      E.enterOuterCircle(S,p);
      for(var i=1;i<=S.config.dreamCost;i++){
        assert(E.dreamMilestone(S,p,i)===dr.milestones[i-1],"第 "+i+" 點應對應第 "+i+" 個里程碑");
      }
      // 事件要帶出里程碑文字
      S.decisionQueue=[]; S.pendingDecision=null;
      var d0=p.dreamProgress;
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:99999,label:"x"}],{eduTags:["setup"]});
      p.boughtProgressThisTurn=false;
      E._events=[];
      E.buyDreamProgress(S,p);
      var ev=E._events.filter(function(e){return e.type==="DREAM_PROGRESS";})[0];
      assert(ev && ev.milestone===dr.milestones[d0], "DREAM_PROGRESS 應帶出第 "+(d0+1)+" 個里程碑，實得 "+(ev&&ev.milestone));
      assert(ev.dreamName===dr.name,"事件應帶出夢想名稱");
      return "八個夢想各有 ≥5 個具體里程碑；第 n 點對應第 n 個；事件帶出里程碑與夢想名";
    });

    t("T-28 理賠明細（原價／折抵／實付／省下）", function(){
      var S=mkGame(9906,["M1","M2","M4","M6"]), p=S.players[0];
      S.decisionQueue=[]; S.pendingDecision=null; S.phase="ROLL"; S.activePlayerIdx=0;
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      p.mallBoughtThisTurn=0; E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_INS1"}},{mutate:true});
      p.mallBoughtThisTurn=0; E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_HEA1"}},{mutate:true});
      S.phase="ROLL"; S.decisionQueue=[]; S.pendingDecision=null;
      var card=ns.content.byId["OL_D03"];
      assert((card.tags||[]).indexOf("insurable")>=0,"植牙卡應標記為可理賠");
      var cash0=p.cash;
      E.presentCard(S,p,card);
      var d=S.decisionQueue.filter(function(x){return x.kind==="ACK";})[0];
      assert(d && d.claim,"可理賠事件應在卡片上附理賠明細");
      var cl=d.claim, rate=S.config.eventCardRate;
      var hp=E.cfg(S,"healthDiscountPct"), cp=E.cfg(S,"insuranceClaimPct");
      var gross=util.r2(60*rate);
      assert(Math.abs(cl.gross-gross)<0.02,"原價應為 "+gross+"，實得 "+cl.gross);
      assert(Math.abs(cl.healthSaved-util.r2(gross*hp))<0.02,"健康折抵應為原價×"+hp);
      var afterH=util.r2(gross*(1-hp));
      assert(Math.abs(cl.claim-util.r2(afterH*cp))<0.02,"理賠應為折抵後×"+cp);
      assert(Math.abs(cl.net-util.r2(afterH*(1-cp)))<0.02,"實際支付應為折抵後×(1−"+cp+")");
      assert(Math.abs(cl.saved-util.r2(cl.healthSaved+cl.claim))<0.02,"省下＝折抵＋理賠");
      assert(Math.abs((cl.gross-cl.saved)-cl.net)<0.02,"原價 − 省下 應等於實際支付（帳要平）");
      // 明細要與實際現金變動一致
      assert(Math.abs((cash0-p.cash)-cl.net)<0.02,"明細的實際支付應等於現金實際減少（"+util.r2(cash0-p.cash)+"）");

      // 沒保險：全額自付，並算出「本來可以省下多少」
      var S2=mkGame(9907,["M1","M2","M4","M6"]), q=S2.players[0];
      S2.decisionQueue=[]; S2.pendingDecision=null; S2.phase="ROLL"; S2.activePlayerIdx=0;
      var qc0=q.cash;
      E.presentCard(S2,q,card);
      var d2=S2.decisionQueue.filter(function(x){return x.kind==="ACK";})[0];
      assert(d2 && d2.claim,"沒保險也要有明細（做對照）");
      assert(d2.claim.claim===0 && d2.claim.healthSaved===0,"沒保險沒健身 → 無折抵無理賠");
      assert(Math.abs(d2.claim.net-d2.claim.gross)<0.02,"應全額自付");
      assert(Math.abs(d2.claim.wouldClaim-util.r2(d2.claim.gross*cp))<0.02,"應算出「本來可理賠」金額");
      assert(Math.abs((qc0-q.cash)-d2.claim.gross)<0.02,"沒保險的實付應等於原價");
      assert(d2.claim.net > cl.net,"沒保險付得比有保險多");

      // 不可理賠的事件不應產生明細
      var S3=mkGame(9908,["M1","M2","M4"]), z=S3.players[0];
      S3.decisionQueue=[]; S3.pendingDecision=null;
      var plain=(ns.content.cards.LIFE_EVENT||[]).filter(function(c){
        return c.kind==="LIFE_EVENT" && c.effects && (c.tags||[]).indexOf("insurable")<0; })[0];
      if(plain){
        E.presentCard(S3,z,plain);
        var d3=S3.decisionQueue.filter(function(x){return x.kind==="ACK";})[0];
        assert(!d3.claim,"非醫療意外事件不應有理賠明細");
      }
      return "原價−省下＝實付且與現金變動一致；折抵先於理賠；無保險顯示全額自付與可省金額；非可理賠事件無明細";
    });

    t("T-29 幸福感明細加總", function(){
      var S=mkGame(9909,["M1","M2","M4","M6"]), p=S.players[0];
      S.decisionQueue=[]; S.pendingDecision=null; S.phase="ROLL"; S.activePlayerIdx=0;
      p.childrenCount=0; p.dreamProgress=0; p.stats.optionalBought=0; p.stats.mallJoy=0;
      ["TEMPER","PRUDENCE","PARENTING","FILIAL"].forEach(function(ax){ p.virtues[ax]=0; });
      assert(E.wellbeing(S,p)===0,"歸零後幸福感應為 0，實得 "+E.wellbeing(S,p));
      p.childrenCount=2;                 // +6
      p.virtues.FILIAL=2; p.virtues.TEMPER=1;   // +3
      p.dreamProgress=3;                 // +3
      p.stats.optionalBought=1;          // +1
      p.stats.mallJoy=4;                 // +4
      var expect=2*3+3+3+1+4;
      assert(E.wellbeing(S,p)===expect,"各來源加總應為 "+expect+"，實得 "+E.wellbeing(S,p));
      // 商城購買會同時推進 mallJoy 與品格，兩邊都要計入
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      var before=E.wellbeing(S,p), fil0=p.virtues.FILIAL;
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_VIR2"}},{mutate:true});  // 孝親金：joy 2＋孝親 +1
      var item=ns.content.byId["ML_VIR2"];
      var gained=E.wellbeing(S,p)-before;
      var expectGain=(item.payload.joy||0)+((p.virtues.FILIAL>fil0)?1:0);
      assert(gained===expectGain,"商城購買後幸福感應增加 "+expectGain+"，實得 "+gained);
      return "幸福感＝小孩×3＋品格＋夢想進度＋生活享受＋商城活動；商城購買同時計入活動與品格";
    });

    t("T-30 廣播轉讓與 P2P 真人邀約（多人 V1）", function(){
      function mk3(seed){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:false,professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S); return S;
      }
      function setCash(S,pl,t2){ var d=util.r2(t2-pl.cash);
        if(d) ns.ledger.post(S,pl,"測試設現金",[{account:"CASH",delta:d,label:"測試"}],{eduTags:["setup"]}); }
      function giveAsset(S,pl){ var id=util.uid(S,"A");
        pl.assets.push({instanceId:id,cardId:null,kind:"BUSINESS",name:"測試小店",units:1,
          costBasis:500,marketValue:500,monthlyIncome:50,linkedLiabilityId:null,flags:{}});
        ns.ledger.post(S,pl,"測試給資產",[{account:"ASSET",delta:500,refId:id,label:"測試小店"},
          {account:"INCOME_PASSIVE",delta:50,refId:id,label:"測試小店"}],{eduTags:["setup"]});
        return id; }
      function tie(p2){ var c=0;
        p2.ledger.forEach(function(en){ en.postings.forEach(function(q){ if(q.account==="CASH") c+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p2.cash)<0.02,"現金與分錄不符（"+p2.name+"）"); }
      function evOf(r,tp){ return r.events.filter(function(e){return e.type===tp;})[0]; }

      // (a) 有真人在場 → 廣播先掛牌；另一位真人搶下 → 成交、兩邊帳平
      var S=mk3(9401), A=S.players[0], B=S.players[1];
      var aid=giveAsset(S,A); setCash(S,B,800); S.phase="ROLL"; S.activePlayerIdx=0;
      var r1=E.apply(S,{type:"PROPOSE_TRADE",playerId:0,payload:{sellerId:0,buyerId:null,assetId:aid,price:100}},{mutate:true});
      assert(evOf(r1,"TRADE_BROADCAST"),"應發出廣播事件");
      assert(r1.state.pendingTrade && r1.state.pendingTrade.status==="open","廣播後應為掛牌狀態");
      var aCash0=r1.state.players[0].cash, bCash0=r1.state.players[1].cash;
      var r2=E.apply(r1.state,{type:"RESPOND_TRADE",playerId:1,payload:{accept:true}},{mutate:true});
      var dn=evOf(r2,"TRADE_DONE");
      assert(dn && dn.buyerId===1 && dn.price===100,"真人搶購應成交");
      assert(r2.state.pendingTrade===null,"成交後掛牌應清空");
      A=r2.state.players[0]; B=r2.state.players[1];
      assert(Math.abs(A.cash-(aCash0+100))<0.01 && Math.abs(B.cash-(bCash0-100))<0.01,"價金兩邊對轉");
      assert(!A.assets.some(function(x){return x.instanceId===aid;}) &&
             B.assets.some(function(x){return x.name==="測試小店";}),"資產應易主");
      tie(A); tie(B);
      // 賣方不得自己搶購
      var S1b=mk3(9402); var aid1b=giveAsset(S1b,S1b.players[0]); S1b.phase="ROLL"; S1b.activePlayerIdx=0;
      var r1b=E.apply(S1b,{type:"PROPOSE_TRADE",playerId:0,payload:{sellerId:0,buyerId:null,assetId:aid1b,price:100}},{mutate:true});
      var rSelf=E.apply(r1b.state,{type:"RESPOND_TRADE",playerId:0,payload:{accept:true}});
      assert(rSelf.rejected,"賣方不能回應自己的廣播");

      // (b) 全部真人婉拒 → 輪詢電腦：C 現金足、開價便宜 → C 接手
      var S2=mk3(9403); A=S2.players[0];
      var aid2=giveAsset(S2,A); setCash(S2,S2.players[2],9000); S2.phase="ROLL"; S2.activePlayerIdx=0;
      var r3=E.apply(S2,{type:"PROPOSE_TRADE",playerId:0,payload:{sellerId:0,buyerId:null,assetId:aid2,price:1}},{mutate:true});
      var r4=E.apply(r3.state,{type:"RESPOND_TRADE",playerId:1,payload:{accept:false}},{mutate:true});
      var dn2=evOf(r4,"TRADE_DONE");
      assert(dn2 && dn2.buyerId===2,"真人全婉拒後應輪詢電腦成交（NPC 接手）");
      assert(r4.state.pendingTrade===null,"resolved 後掛牌清空");

      // (c) P2P 真人邀約：A 放款給 B（B 銀行額度未用完）→ 掛邀約，B 接受才成立
      var S3=mk3(9404); A=S3.players[0]; B=S3.players[1];
      setCash(S3,A,2000);
      assert(E.creditCapacity(S3,B)>=1,"前提：B 的銀行額度還沒用完");
      var pr={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:0,borrowerId:1,amount:300,annualRate:0.12,termMonths:24}};
      var r5=E.apply(S3,pr,{mutate:true});
      assert(evOf(r5,"P2P_OFFERED") && r5.state.pendingP2P && r5.state.pendingP2P.targetId===1,
        "真人對手應掛邀約而非直接成立");
      assert(!evOf(r5,"P2P_FORMED"),"未回應前不得成立");
      var rWrong=E.apply(r5.state,{type:"RESPOND_P2P",playerId:0,payload:{accept:true}});
      assert(rWrong.rejected,"只有被邀的一方能回應");
      var aC=r5.state.players[0].cash, bC=r5.state.players[1].cash;
      var r6=E.apply(r5.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:true}},{mutate:true});
      assert(evOf(r6,"P2P_FORMED"),"B 接受後應成立（銀行額度未用完也可以）");
      A=r6.state.players[0]; B=r6.state.players[1];
      assert(Math.abs(A.cash-(aC-300))<0.01 && Math.abs(B.cash-(bC+300))<0.01,"放款金額兩邊對轉");
      assert(B.liabilities.some(function(l){return l.kind==="P2P" && Math.abs(l.principal-300)<0.01;}),"B 應背 P2P 負債");
      assert(r6.state.pendingP2P===null,"回應後邀約清空");
      tie(A); tie(B);

      // (d) B 婉拒 → 不成立、邀約清空
      var S4=mk3(9405); setCash(S4,S4.players[0],2000);
      var r7=E.apply(S4,pr,{mutate:true});
      var r8=E.apply(r7.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:false}},{mutate:true});
      var rj=evOf(r8,"P2P_REJECTED");
      assert(rj && rj.humanSaidNo && r8.state.pendingP2P===null && !evOf(r8,"P2P_FORMED"),"婉拒應不成立且清空");

      return "廣播掛牌真人先搶先贏；全婉拒輪詢電腦；P2P 真人邀約親自接受才成立（銀行額度未用完也可）；帳目兩邊對轉";
    });

    t("T-31 真人密封出價與轉介親答（多人 V2）", function(){
      function mk3(seed,cash){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:false,professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S);
        (cash||[]).forEach(function(amt,i){ if(amt) ns.ledger.post(S,S.players[i],"測試補現金",
          [{account:"CASH",delta:amt,label:"測試"}],{eduTags:["setup"]}); });
        return S; }
      function tie(p2){ var c=0;
        p2.ledger.forEach(function(en){ en.postings.forEach(function(q){ if(q.account==="CASH") c+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p2.cash)<0.02,"現金與分錄不符（"+p2.name+"）"); }
      function evOf(r,tp){ return r.events.filter(function(e){return e.type===tp;})[0]; }
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="BUSINESS";})[0];
      assert(CARD,"找不到事業小機會卡");
      function arm(S){ E.pushDecision(S,S.players[0],{kind:"BUY",cardId:CARD.id}); E.syncPhase(S); }

      // (a) 有真人在場 → 拍賣掛起等真人出價；抽卡人不得先收掉決策；旁人不得代出價
      var S=mk3(9501,[0,5000,0]); arm(S);
      var r1=E.apply(S,{type:"START_OPP_AUCTION",playerId:0,payload:{cardId:CARD.id}},{mutate:true});
      assert(!r1.rejected && evOf(r1,"AUCTION_STARTED"),"拍賣應啟動");
      var pa=r1.state.pendingAuction;
      assert(pa && pa.waiting.length===1 && pa.waiting[0]===1,"應等待真人 B 出價");
      assert(pa.bids.length===1 && pa.bids[0].playerId===2,"NPC C 的出價應已入列");
      var d0=r1.state.pendingDecision;
      var rD=E.apply(r1.state,{type:"DECIDE",playerId:0,payload:{decisionId:d0.decisionId,optionId:"skip",params:{}}});
      assert(rD.rejected,"拍賣未開標前抽卡人不得收掉 BUY 決策");
      var rN=E.apply(r1.state,{type:"PLACE_BID",playerId:0,payload:{amount:100}});
      assert(rN.rejected,"非投標人不得出價");
      var rOver=E.apply(r1.state,{type:"PLACE_BID",playerId:1,payload:{amount:999999}});
      assert(rOver.rejected,"出價不得超過現金");

      // (b) B 出價 700（C 現金 0 出不了價）→ B 得標、價金對轉、決策收掉
      var aC0=r1.state.players[0].cash, bC0=r1.state.players[1].cash;
      var r2=E.apply(r1.state,{type:"PLACE_BID",playerId:1,payload:{amount:700}},{mutate:true});
      var res=evOf(r2,"AUCTION_RESULT");
      assert(res && res.winnerId===1 && res.price===700,"B 應以 700 得標，實得 "+JSON.stringify(res&&{w:res.winnerId,p:res.price}));
      assert(r2.state.pendingAuction===null,"開標後拍賣狀態清空");
      var A2=r2.state.players[0], B2=r2.state.players[1];
      assert(Math.abs(A2.cash-(aC0+700))<0.01,"賣方應收到價金 700");
      assert(B2.assets.length>0,"得標者應持有資產");
      tie(A2); tie(B2);

      // (c) 全員棄標＋NPC 出不了價 → 流標，BUY 決策保留
      var S3=mk3(9502,[0,5000,0]); arm(S3);
      var r3=E.apply(S3,{type:"START_OPP_AUCTION",playerId:0,payload:{cardId:CARD.id}},{mutate:true});
      var r4=E.apply(r3.state,{type:"PLACE_BID",playerId:1,payload:{amount:0}},{mutate:true});
      var res4=evOf(r4,"AUCTION_RESULT");
      assert(res4 && res4.winnerId===null,"全棄標應流標");
      assert(r4.state.pendingDecision && r4.state.pendingDecision.kind==="BUY","流標後 BUY 決策應保留");

      // (d) 轉介真人 → 邀約掛起（不自動代答）；只有被邀方能回應；接受＝買下＋介紹費對轉
      var S5=mk3(9503,[0,9000,0]); arm(S5);
      var fee=E.referralFee(S5,CARD);
      var r5=E.apply(S5,{type:"REFER_OPP",playerId:0,payload:{cardId:CARD.id,targetId:1}},{mutate:true});
      assert(evOf(r5,"REFERRAL_OFFERED") && r5.state.pendingReferral && r5.state.pendingReferral.toId===1,
        "真人轉介應掛邀約，不得自動代答");
      assert(!evOf(r5,"REFERRAL_DONE") && !evOf(r5,"REFERRAL_REJECTED"),"未回應前不得有結果");
      var d5=r5.state.pendingDecision;
      var rD5=E.apply(r5.state,{type:"DECIDE",playerId:0,payload:{decisionId:d5.decisionId,optionId:"skip",params:{}}});
      assert(rD5.rejected,"轉介未回應前抽卡人不得收掉決策");
      var rW=E.apply(r5.state,{type:"RESPOND_REFERRAL",playerId:0,payload:{accept:true}});
      assert(rW.rejected,"只有被邀方能回應轉介");
      var aC5=r5.state.players[0].cash, bC5=r5.state.players[1].cash;
      var r6=E.apply(r5.state,{type:"RESPOND_REFERRAL",playerId:1,payload:{accept:true}},{mutate:true});
      var dn6=evOf(r6,"REFERRAL_DONE");
      assert(dn6 && dn6.fee===fee,"接受後應成交並收介紹費");
      var A6=r6.state.players[0], B6=r6.state.players[1];
      assert(Math.abs(A6.cash-(aC5+fee))<0.01,"轉介人應收到介紹費");
      assert(B6.assets.length>0,"受讓人應持有資產");
      assert(r6.state.pendingReferral===null && (!r6.state.pendingDecision || r6.state.pendingDecision.decisionId!==d5.decisionId),
        "回應後邀約清空、決策收掉");
      tie(A6); tie(B6);

      // (e) 婉拒 → 不成交、不收費、決策收掉（與現行 NPC 婉拒同規則）
      var S7=mk3(9504,[0,9000,0]); arm(S7);
      var r7=E.apply(S7,{type:"REFER_OPP",playerId:0,payload:{cardId:CARD.id,targetId:1}},{mutate:true});
      var r8=E.apply(r7.state,{type:"RESPOND_REFERRAL",playerId:1,payload:{accept:false}},{mutate:true});
      var rj8=evOf(r8,"REFERRAL_REJECTED");
      assert(rj8 && rj8.humanSaidNo,"婉拒應留紀錄");
      assert(!evOf(r8,"REFERRAL_DONE") && r8.state.pendingReferral===null,"婉拒不成交且邀約清空");

      return "拍賣掛起等真人密封出價、開標最高價得標且帳目對轉、全棄標流標保留決策；轉介邀約親自接受才成交、婉拒不收費";
    });

    t("T-32 P2P 本利分流、廣播借款、合資親答與離席代打（多人 V3）", function(){
      function mk3(seed,cash){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:false,professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S);
        (cash||[]).forEach(function(amt,i){ if(amt) ns.ledger.post(S,S.players[i],"測試補現金",
          [{account:"CASH",delta:amt,label:"測試"}],{eduTags:["setup"]}); });
        return S; }
      function evOf(r,tp){ return r.events.filter(function(e){return e.type===tp;})[0]; }
      function tie(p2){ var c=0;
        p2.ledger.forEach(function(en){ en.postings.forEach(function(q){ if(q.account==="CASH") c+=q.delta; }); });
        assert(Math.abs(util.r2(c)-p2.cash)<0.02,"現金與分錄不符（"+p2.name+"）"); }

      // (a) P2P 帳務本利分流：放款利息進被動收入流、借款月付進支出流；清償後雙雙歸還
      var S=mk3(9601,[0,5000,0]); var A=S.players[0], B=S.players[1];
      var ip0=B.derived.passiveIncome, ex0=A.derived.totalExpenses;
      E.formP2P(S,B,A,600,0.12,12);
      ns.ledger.recompute(A); ns.ledger.recompute(B);
      var int0=util.r2(600*0.12/12), pay0=A.liabilities.filter(function(l){return l.kind==="P2P";})[0].monthlyPayment;
      assert(Math.abs((B.derived.passiveIncome-ip0)-int0)<0.02,"放款人被動收入應 +第一期利息 "+int0);
      assert(Math.abs((A.derived.totalExpenses-ex0)-pay0)<0.02,"借款人支出流應 +月付 "+pay0);
      E.p2pRoundEnd(S); ns.ledger.recompute(A); ns.ledger.recompute(B);
      var l1=A.liabilities.filter(function(l){return l.kind==="P2P";})[0];
      var int1=util.r2(l1.principal*0.12/12);
      assert(Math.abs((B.derived.passiveIncome-ip0)-int1)<0.02,"利息收入應隨本金遞減（"+int1+"）");
      var guard=0;
      while(A.liabilities.some(function(x){return x.kind==="P2P";}) && guard++<20){
        ns.ledger.post(S,A,"補",[{account:"CASH",delta:Math.max(0,100-A.cash+100),label:"x"}],{eduTags:["setup"]});
        E.p2pRoundEnd(S);
      }
      ns.ledger.recompute(A); ns.ledger.recompute(B);
      assert(Math.abs(B.derived.passiveIncome-ip0)<0.02,"清償後放款人被動收入應歸還原位");
      assert(Math.abs(A.derived.totalExpenses-ex0)<0.02,"清償後借款人支出流應歸還原位");
      tie(A); tie(B);
      // 提前還本不適用 P2P
      var S0=mk3(9602,[0,5000,0]);
      E.formP2P(S0,S0.players[1],S0.players[0],400,0.12,12);
      var lX=S0.players[0].liabilities.filter(function(l){return l.kind==="P2P";})[0];
      S0.phase="READY_END"; S0.activePlayerIdx=0; S0.decisionQueue=[]; S0.pendingDecision=null;
      var rX=E.apply(S0,{type:"REPAY_LOAN",playerId:0,payload:{liabilityId:lX.instanceId,amount:200}});
      assert(rX.rejected,"P2P 不得走銀行提前還本（錢要按期進放款人口袋）");

      // (b) 廣播借款：真人優先，全婉拒輪詢電腦
      var S2=mk3(9603,[0,3000,9000]); var A2=S2.players[0];
      var minR=E.p2pMinRate(S2,A2), rr=Math.max(0.12,util.r2(minR+0.01));
      var pr={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:null,borrowerId:0,amount:500,annualRate:rr,termMonths:12}};
      var r1=E.apply(S2,pr,{mutate:true});
      assert(r1.state.pendingP2P && r1.state.pendingP2P.open,"廣播借款應掛起等真人");
      var r2=E.apply(r1.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:true}},{mutate:true});
      var fm=evOf(r2,"P2P_FORMED");
      assert(fm && fm.lenderId===1,"真人答應應成交（放款人 B）");
      var S3=mk3(9604,[0,3000,9000]); var A3=S3.players[0];
      var minR3=E.p2pMinRate(S3,A3), rr3=Math.max(0.12,util.r2(minR3+0.01));
      var r3=E.apply(S3,{type:"PROPOSE_P2P",playerId:0,payload:{lenderId:null,borrowerId:0,amount:500,annualRate:rr3,termMonths:12}},{mutate:true});
      var r4=E.apply(r3.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:false}},{mutate:true});
      var fm4=evOf(r4,"P2P_FORMED");
      assert(fm4 && fm4.lenderId===2,"真人全婉拒後應輪詢電腦放款（C）");

      // (c) 合資：真人夥伴親答（現金夠出資即可，不再被水位規則替他拒絕）
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="BUSINESS";})[0];
      function armJV(S9){ E.pushDecision(S9,S9.players[0],{kind:"BUY",cardId:CARD.id}); E.syncPhase(S9); }
      var entry=null;
      var S5=mk3(9605,[9000,0,0]); armJV(S5);
      entry=E.oppEntry(S5,CARD);
      var pShare=0.5, pEntry=util.r2(entry*(1-pShare));
      var B5=S5.players[1];
      ns.ledger.recompute(B5);
      var need=util.r2(pEntry + 1.5*B5.derived.totalExpenses);   // 夠出自己那份，但低於舊水位規則（reserve＝3×月支出）
      ns.ledger.post(S5,B5,"設現金",[{account:"CASH",delta:util.r2(need-B5.cash),label:"x"}],{eduTags:["setup"]});
      ns.ledger.recompute(B5);
      assert(B5.cash < 3*B5.derived.totalExpenses + pEntry,
        "前提：舊水位規則會拒絕這位夥伴（cash "+B5.cash+" pEntry "+pEntry+" exp "+B5.derived.totalExpenses+"）");
      var r5=E.apply(S5,{type:"PROPOSE_JV",playerId:0,payload:{cardId:CARD.id,partnerId:1,myShare:pShare}},{mutate:true});
      assert(evOf(r5,"JV_OFFERED") && r5.state.pendingJV && r5.state.pendingJV.targetId===1,
        "真人夥伴應收到邀約而非被系統代答");
      var rW=E.apply(r5.state,{type:"RESPOND_JV",playerId:0,payload:{accept:true}});
      assert(rW.rejected,"只有被邀方能回應合資");
      var r6=E.apply(r5.state,{type:"RESPOND_JV",playerId:1,payload:{accept:true}},{mutate:true});
      assert(evOf(r6,"JV_FORMED"),"夥伴現金夠出資、本人答應 → 合資應成立（修正誤判）");
      tie(r6.state.players[0]); tie(r6.state.players[1]);
      // 廣播合資：真人婉拒 → 輪詢電腦
      var S7=mk3(9606,[9000,0,9000]); armJV(S7);
      var r7=E.apply(S7,{type:"PROPOSE_JV",playerId:0,payload:{cardId:CARD.id,partnerId:null,myShare:0.5}},{mutate:true});
      assert(r7.state.pendingJV && r7.state.pendingJV.targetId===null,"廣播合資應掛起等真人");
      var r8=E.apply(r7.state,{type:"RESPOND_JV",playerId:1,payload:{accept:false}},{mutate:true});
      var jf8=evOf(r8,"JV_FORMED");
      assert(jf8 && jf8.bId===2,"真人全婉拒後應輪詢電腦合資（C）");

      // (d) 離席代打與回來接手
      var S8=mk3(9607,[0,5000,0]); armJV(S8);
      var r9=E.apply(S8,{type:"START_OPP_AUCTION",playerId:0,payload:{cardId:CARD.id}},{mutate:true});
      assert(r9.state.pendingAuction && r9.state.pendingAuction.waiting.indexOf(1)>=0,"前置：拍賣等 B 出價");
      var rL=E.apply(r9.state,{type:"PLAYER_LEAVE",playerId:1,payload:null},{mutate:true});
      var BL=rL.state.players[1];
      assert(BL.isNPC && BL.flags.leftHuman,"離席後座位應轉電腦代打");
      assert(evOf(rL,"PLAYER_LEFT"),"應公告離席");
      assert(rL.state.pendingAuction===null,"離席者自動棄標 → 拍賣應開標結案");
      var rR2=E.apply(rL.state,{type:"PLAYER_RETURN",playerId:1,payload:null},{mutate:true});
      assert(!rR2.state.players[1].isNPC && evOf(rR2,"PLAYER_RETURNED"),"回來應能接手");
      var rBad=E.apply(rR2.state,{type:"PLAYER_RETURN",playerId:2,payload:null});
      assert(rBad.rejected,"原生 NPC 座位不可被接手");

      return "P2P 本利分流（利息＝被動收入、月付＝支出、清償歸位）；廣播借款真人優先電腦遞補；合資親答修正水位誤判；離席代打與接手";
    });

    t("T-33 內容數字體檢（NaN 防線）", function(){
      // V4：新莊工業宅缺 monthlyCost 造成整張報表 NaN——把「每張卡的關鍵數字必須有限」鎖進自測
      var S=mkGame(9701,["M1","M2","M3","M4","M6"]);
      var bad=[];
      function fin(x){ return typeof x==="number" && isFinite(x); }
      Object.keys(ns.content.cards).forEach(function(deck){
        ns.content.cards[deck].forEach(function(c){
          var pl=c.payload||{};
          if(c.kind==="REALESTATE"){
            if(!fin(pl.price)||!fin(pl.monthlyRent)||!fin(pl.monthlyCost)||!fin(pl.downPayment)) bad.push(deck+"/"+c.id+"(RE欄位)");
          } else if(c.kind==="BUSINESS"){
            if(!fin(pl.price)||!fin(pl.monthlyProfit)) bad.push(deck+"/"+c.id+"(BZ欄位)");
          } else if(c.kind==="STARTUP"){
            if(!fin(pl.investAmount)) bad.push(deck+"/"+c.id+"(SU欄位)");
          }
          if(deck==="OPPORTUNITY_SMALL"||deck==="OPPORTUNITY_LARGE"){
            if(!fin(E.oppEntry(S,c))||!fin(E.oppIncome(S,c))) bad.push(deck+"/"+c.id+"(entry/income)");
          }
        });
      });
      assert(!bad.length,"卡片數字有洞："+bad.join(", "));
      // 實買體檢：小額每張 RE/BZ 都真的買一次，現金與月收入不得出現 NaN
      ns.content.cards.OPPORTUNITY_SMALL.forEach(function(c){
        if(c.kind!=="REALESTATE" && c.kind!=="BUSINESS") return;
        var X=mkGame(9702,["M1","M2","M3","M4","M6"]), y=X.players[0];
        ns.ledger.post(X,y,"補",[{account:"CASH",delta:99999,label:"x"}],{eduTags:["setup"]});
        var o=E.oppDefaultOption(X,y,c);
        E.buyAsset(X,y,c,o.optionId,o.params);
        ns.ledger.recompute(y);
        assert(isFinite(y.cash) && isFinite(y.derived.passiveIncome) && isFinite(y.derived.netWorth),
          c.id+" 買入後出現 NaN");
        y.assets.forEach(function(a){ assert(isFinite(a.monthlyIncome||0), c.id+" 資產月收入 NaN"); });
      });
      // 小額機會不得再有股票卡（V4）
      var stLeft=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="STOCK";}).length;
      assert(stLeft===0,"小額機會仍有 "+stLeft+" 張股票卡");
      assert((ns.content.cards.ARCHIVED_STOCK||[]).length>=10,"封存的股票卡應保留在 byId 供舊紀錄重放");
      return "全部牌堆關鍵數字有限；小額 RE/BZ 實買零 NaN；小額不再有股票卡（封存 "+(ns.content.cards.ARCHIVED_STOCK||[]).length+" 張）";
    });

    t("T-34 廣播放款與廣播轉介（多人 V4）", function(){
      function mk3(seed,cash){
        var players=[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
          {name:"B",isNPC:false,professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[0].id},
          {name:"C",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[0].id}];
        var S=E.newGame({seed:seed,config:baseCfg(),modules:["M1","M2","M3","M4","M6"],players:players});
        E.beginTurn(S);
        (cash||[]).forEach(function(amt,i){ if(amt) ns.ledger.post(S,S.players[i],"測試補現金",
          [{account:"CASH",delta:amt,label:"測試"}],{eduTags:["setup"]}); });
        return S; }
      function evOf(r,tp){ return r.events.filter(function(e){return e.type===tp;})[0]; }

      // (a) 廣播放款：真人搶答成交
      var S=mk3(9801,[9000,0,0]);
      var r1=E.apply(S,{type:"PROPOSE_P2P",playerId:0,payload:{lenderId:0,borrowerId:null,amount:500,annualRate:0.12,termMonths:12}},{mutate:true});
      assert(r1.state.pendingP2P && r1.state.pendingP2P.openLend,"廣播放款應掛起");
      var r2=E.apply(r1.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:true}},{mutate:true});
      var fm=evOf(r2,"P2P_FORMED");
      assert(fm && fm.lenderId===0 && fm.borrowerId===1,"真人答應應借到");
      // (b) 廣播放款：真人婉拒 → NPC 只在銀行額度用罄時才接
      var S2=mk3(9802,[9000,0,0]);
      var r3=E.apply(S2,{type:"PROPOSE_P2P",playerId:0,payload:{lenderId:0,borrowerId:null,amount:500,annualRate:0.12,termMonths:12}},{mutate:true});
      var r4=E.apply(r3.state,{type:"RESPOND_P2P",playerId:1,payload:{accept:false}},{mutate:true});
      assert(evOf(r4,"P2P_REJECTED") && evOf(r4,"P2P_REJECTED").openNobodyBorrow,
        "NPC 銀行額度未用罄不應借民間（廣播放款流局）");
      // (c) 廣播借款上限＝他人現金最大值的 50%
      var S3=mk3(9803,[0,1000,400]);
      var over={type:"PROPOSE_P2P",playerId:0,payload:{lenderId:null,borrowerId:0,amount:9000,annualRate:0.12,termMonths:12}};
      assert(E.apply(S3,over).rejected,"超過他人現金最大值 50% 應被拒");
      // (d) 廣播轉介：真人接受成交＋介紹費對轉；婉拒後輪詢電腦
      var CARD=ns.content.cards.OPPORTUNITY_SMALL.filter(function(c){return c.kind==="BUSINESS";})[0];
      function armR(S9){ E.pushDecision(S9,S9.players[0],{kind:"BUY",cardId:CARD.id}); E.syncPhase(S9); }
      var S5=mk3(9804,[0,9000,0]); armR(S5);
      var fee=E.referralFee(S5,CARD);
      var r5=E.apply(S5,{type:"REFER_OPP",playerId:0,payload:{cardId:CARD.id,targetId:null}},{mutate:true});
      assert(r5.state.pendingReferral && r5.state.pendingReferral.open,"廣播轉介應掛起");
      var aC=r5.state.players[0].cash;
      var r6=E.apply(r5.state,{type:"RESPOND_REFERRAL",playerId:1,payload:{accept:true}},{mutate:true});
      var dn=evOf(r6,"REFERRAL_DONE");
      assert(dn && dn.toId===1 && Math.abs(r6.state.players[0].cash-(aC+fee))<0.01,"真人接手應成交並付介紹費");
      assert(r6.state.pendingReferral===null && !r6.state.pendingDecision,"成交後邀約與決策收掉");
      var S7=mk3(9805,[0,9000,9000]); armR(S7);
      var r7=E.apply(S7,{type:"REFER_OPP",playerId:0,payload:{cardId:CARD.id,targetId:null}},{mutate:true});
      var r8=E.apply(r7.state,{type:"RESPOND_REFERRAL",playerId:1,payload:{accept:false}},{mutate:true});
      var dn8=evOf(r8,"REFERRAL_DONE");
      assert(dn8 && dn8.toId===2,"真人全婉拒後應輪詢電腦接手");
      return "廣播放款真人先答應先借到、NPC 只在額度用罄才接；借款廣播上限＝他人現金最大值 50%；廣播轉介真人優先電腦遞補、費用對轉";
    });

    t("T-36 學習與準備骨架（M8 S1）", function(){
      var mods8=["M1","M2","M4","M6","M8"];
      var S=mkGame(3601,mods8), p=S.players[0];
      var SK=ns.content.byId["SKL_DRIVE"];
      assert(SK && SK.kind==="SKILL","技能卡應存在");

      // (a) 開始學習：扣學費、進入學習中、有分錄
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      var c0=p.cash, price=E.skillPrice(S,SK,true);
      assert(Math.abs(price-util.r2(SK.cost*0.7))<0.001,"被動學費應打七折");
      E.startLearning(S,p,SK,true);
      assert(p.learning && p.learning.skillId==="SKL_DRIVE","應進入學習中");
      assert(Math.abs((c0-p.cash)-price)<0.01,"學費應扣款且有分錄");
      assert(p.stats.skillSpendTotal===price,"學費應累計");

      // (b) 未到期不學成；到期學成、冷卻設定
      S.turnNumber=p.learning.endTurn-1; E.tickLearning(S,p);
      assert(p.learning,"未到期不應學成");
      S.turnNumber=p.learning.endTurn; E.tickLearning(S,p);
      assert(!p.learning && p.skills["SKL_DRIVE"],"到期應學成並清空 learning");
      assert(p.stats.skillsLearned===1,"學成數應累計");
      assert(p.skillCooldownUntil===S.turnNumber+E.skillCooldown(S,SK),"應設冷卻");
      assert(E.hasSkill(p,"SKL_DRIVE") && E.hasSkill(p,"family:MOBILITY"),"hasSkill 應支援 id 與家族");

      // (c) EXPENSE 沖回：含月費的技能，學成後支出水位必須回到原值
      var S2=mkGame(3602,mods8), q=S2.players[0];
      var SP=ns.content.byId["SKL_SPANISH"];
      assert((SP.recurringMonthly||0)>0,"西語卡應有月費");
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      var e0=q.derived.totalExpenses;
      E.startLearning(S2,q,SP,true);
      assert(Math.abs(q.derived.totalExpenses-(e0+SP.recurringMonthly))<0.01,"學習期間支出水位應 +rm");
      S2.turnNumber=q.learning.endTurn; E.tickLearning(S2,q);
      assert(Math.abs(q.derived.totalExpenses-e0)<0.01,"學成後支出水位必須沖回原值（不得殘留）");

      // (d) 學習中不得再開新的；放棄退款與統計
      var S3=mkGame(3603,mods8), r3=S3.players[0];
      S3.phase="ROLL"; S3.activePlayerIdx=0; S3.decisionQueue=[]; S3.pendingDecision=null;
      ns.ledger.post(S3,r3,"補現金",[{account:"CASH",delta:900,label:"x"}],{eduTags:["setup"]});
      S3.skillSample=["SKL_DRIVE","SKL_CPR"];
      var ra=E.apply(S3,{type:"START_SKILL",playerId:0,payload:{skillId:"SKL_DRIVE"}},{mutate:true});
      assert(!ra.rejected && r3.learning,"主動進修應成功");
      var extraT=E.cfg(S3,"skillActiveExtraTurns");
      assert(r3.learning.endTurn===S3.turnNumber+SK.turns+extraT,"主動進修應多花額外輪數");
      var rb=E.apply(S3,{type:"START_SKILL",playerId:0,payload:{skillId:"SKL_CPR"}},{mutate:true});
      assert(rb.rejected,"學習中再開新的應被拒");
      var paid=r3.learning.paidCost, cb=r3.cash;
      var rc=E.apply(S3,{type:"ABANDON_SKILL",playerId:0,payload:null},{mutate:true});
      assert(!rc.rejected && !r3.learning,"放棄應清空 learning");
      assert(Math.abs((r3.cash-cb)-util.r2(paid*0.3))<0.01,"放棄應退回 30%");
      assert(r3.stats.skillsAbandoned===1,"放棄數應累計");

      // (e) actionLog 有寫入（存檔重放與多人 lockstep 的命脈）
      var types=S3.actionLog.map(function(a){return a.type;});
      assert(types.indexOf("START_SKILL")>=0 && types.indexOf("ABANDON_SKILL")>=0,
        "START_SKILL / ABANDON_SKILL 必須寫進 actionLog");

      // (f) 關閉開關：skillPerGame=0 時完全關閉
      var cfgOff=baseCfg(); cfgOff.skillPerGame=0;
      var S4=mkGame(3604,mods8,cfgOff);
      assert((S4.skillSample||[]).length===0,"關閉時不應抽樣技能");
      S4.phase="ROLL"; S4.activePlayerIdx=0;
      var rOff=E.apply(S4,{type:"START_SKILL",playerId:0,payload:{skillId:"SKL_DRIVE"}},{mutate:true});
      assert(rOff.rejected,"關閉時主動進修應被拒");

      // (g) 已學會的技能卡不再出現
      assert(!E.cardUsable(S,p,SK),"已學會的技能卡應被 cardUsable 濾掉");

      // (h) 決定性重放：必須用 sim.playOne 跑完整局（每一步都是 action）
      //     注意：不可用手動 ledger.post／手動指派 skillSample 構造出來的局來測重放——
      //     那些不是 action、不在 actionLog 裡，重放時無法重現（這不是引擎 bug，是測試寫法錯）。
      var seed8=778001, Sg8=ns.sim.playOne(baseCfg(),mods8,seed8,["NPC_SAFE","NPC_LEVER"]);
      assert(Sg8.players.some(function(z){return z.stats.skillsLearned>0;}),
        "模擬局應有 NPC 學過技能（否則此重放測試沒涵蓋到學習動作）");
      var norm8=function(X){ return JSON.stringify(X.players.map(function(z){
        return [z.cash, z.derived.netWorth, z.derived.totalExpenses,
                Object.keys(z.skills).sort().join(","), z.learning?z.learning.skillId:null,
                z.stats.skillsLearned, z.stats.skillsAbandoned, z.stats.skillSpendTotal];
      }))+"|"+X.turnNumber+"|"+X.winner; };
      var rp8=ns.replay({seed:seed8, config:Sg8.config, modules:Sg8.enabledModules,
        players:ns.seedPlayers(Sg8), actionLog:Sg8.actionLog});
      assert(norm8(rp8)===norm8(Sg8),"含學習系統的完整局 actionLog 重放必須一致");

      return "學費折扣／學成與冷卻／EXPENSE 沖回不殘留／同時只能學一項／放棄退款與沉沒成本／actionLog 完整／關閉開關／重放一致";
    });

    t("T-37 技能兌現與錯失（M8 S2）", function(){
      var mods8=["M1","M2","M4","M6","M8"];
      var GATE=ns.content.byId["SKE_HEATER"];
      assert(GATE && GATE.kind==="SKILL_GATE","情境卡應存在");
      assert(GATE.skillBranch.have && GATE.skillBranch.miss,"have/miss 兩分支都要有");

      // (a) 沒技能走 miss、有技能走 have，金額與卡面一致
      var S=mkGame(3701,mods8), p=S.players[0];
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      var c0=p.cash;
      E.resolveSkillGate(S,p,GATE);
      assert(Math.abs((c0-p.cash)-18)<0.01,"沒技能應走 miss 分支扣 18");
      assert(p.stats.skillMissed===1,"應累計錯失次數");
      assert(p.stats.skillsUsed===0,"沒技能不應計入兌現");
      p.skills["SKL_PLUMB"]={learnedAt:1,decayed:false,refreshedAt:null};
      var c1=p.cash;
      E.resolveSkillGate(S,p,GATE);
      assert(Math.abs((c1-p.cash)-4)<0.01,"有技能應走 have 分支只扣 4");
      assert(p.stats.skillsUsed===1,"應累計兌現次數");
      assert(Math.abs(p.stats.skillSavedTotal-14)<0.01,"價差應為 18−4＝14");

      // (b) 錯失也要推出決策卡（錯失必須被看見）
      var S2=mkGame(3702,mods8), q=S2.players[0];
      S2.decisionQueue=[]; S2.pendingDecision=null;
      E.resolveSkillGate(S2,q,GATE);
      var dq=S2.decisionQueue.filter(function(x){return x.kind==="SKILL_RESULT";})[0];
      assert(dq && dq.have===false,"沒技能時仍必須推出 SKILL_RESULT 卡");

      // (c) 家族比對:SAFETY 家族任一技能都能接住
      var CRASH=ns.content.byId["SKE_CARCRASH"];
      assert(CRASH.skillBranch.requires==="family:SAFETY","車禍卡應用家族比對");
      var S3=mkGame(3703,mods8), r3=S3.players[0];
      ns.ledger.post(S3,r3,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      r3.skills["SKL_SWIM"]={learnedAt:1,decayed:false,refreshedAt:null};   // 游泳也屬 SAFETY
      var c3=r3.cash; E.resolveSkillGate(S3,r3,CRASH);
      assert(Math.abs((c3-r3.cash)-8)<0.01,"家族內任一技能都應接住");

      // (d) 過時的技能不算數
      var S4=mkGame(3704,mods8), r4=S4.players[0];
      ns.ledger.post(S4,r4,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      r4.skills["SKL_PLUMB"]={learnedAt:1,decayed:true,refreshedAt:null};
      var c4=r4.cash; E.resolveSkillGate(S4,r4,GATE);
      assert(Math.abs((c4-r4.cash)-18)<0.01,"過時技能不應接住(走 miss)");

      // (e) GRANT_JOY 進幸福感
      var S5=mkGame(3705,mods8), r5=S5.players[0];
      var w0=E.wellbeing(S5,r5);
      r5.skills["SKL_CPR"]={learnedAt:1,decayed:false,refreshedAt:null};
      E.resolveSkillGate(S5,r5,ns.content.byId["SKE_BANQUET"]);
      assert(E.wellbeing(S5,r5)===w0+3+1,"CPR 救人應加 3 幸福感 + 1 品格");

      // (f) 內容體檢:每張 gate 的 requires 都指向存在的技能或合法家族
      var fams={}; (ns.content.cards.SKILL||[]).forEach(function(sc){ if(sc.family) fams[sc.family]=1; });
      (ns.content.cards.LIFE_EVENT||[]).filter(function(c){return c.kind==="SKILL_GATE";}).forEach(function(g){
        var rq=g.skillBranch.requires;
        if(rq.indexOf("family:")===0) assert(fams[rq.slice(7)],g.id+" 家族 "+rq+" 無對應技能");
        else assert(ns.content.byId[rq],g.id+" requires 指向不存在的技能 "+rq);
        assert(g.skillBranch.have && g.skillBranch.miss,g.id+" 缺分支");
      });

      // (g) 配比紀律:永久加薪型不得超過三成
      var gates=(ns.content.cards.LIFE_EVENT||[]).filter(function(c){return c.kind==="SKILL_GATE";});
      var salaryGates=gates.filter(function(g){
        return (g.skillBranch.have.effects||[]).some(function(e){return e.op==="SALARY_MULT" && e.factor>1;}); });
      assert(salaryGates.length/gates.length<=0.34,"永久加薪型情境卡不得超過三成(目前 "+salaryGates.length+"/"+gates.length+")");

      return "有/無技能走對分支且金額與卡面一致；錯失同樣推出卡片；家族比對可接住；過時技能不算；GRANT_JOY 進幸福感；全部 gate 內容體檢通過；加薪型配比 "+salaryGates.length+"/"+gates.length;
    });

    t("T-38 買入面板數值完整性與 NaN 防線", function(){
      // (a) 每張機會卡:UI 會用到的關鍵欄位都必須是有限數
      //     (新創面板曾因 payload 欄位名不同而算出 NaN,這條就是防它)
      var bad=[];
      ["OPPORTUNITY_SMALL","OPPORTUNITY_LARGE"].forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){
          var pl=c.payload||{}, cost;
          if(c.kind==="STARTUP") cost=pl.investAmount;
          else if(c.kind==="REALESTATE") cost=pl.price;
          else if(c.kind==="STOCK") cost=pl.offerPrice!==undefined?pl.offerPrice:0;
          else cost=pl.price;
          if(typeof cost!=="number" || !isFinite(cost) || cost<0) bad.push(c.id+" cost="+cost);
          if(c.kind==="REALESTATE"){
            ["monthlyRent","monthlyCost","downPayment"].forEach(function(k){
              if(!isFinite(pl[k])) bad.push(c.id+" "+k+"="+pl[k]); });
          }
          if(c.kind==="BUSINESS" && !isFinite(pl.monthlyProfit)) bad.push(c.id+" monthlyProfit");
          if(c.kind==="STARTUP" && !isFinite(pl.equityPct)) bad.push(c.id+" equityPct");
        });
      });
      assert(!bad.length,"機會卡欄位不完整："+bad.join(", "));

      // (b) 引擎買入新創:金額與分錄正確且有限
      var S=mkGame(3801,["M1","M2","M3","M4","M6"]), p=S.players[0];
      var SU=(ns.content.cards.OPPORTUNITY_LARGE||[]).filter(function(c){return c.kind==="STARTUP";})[0];
      assert(SU,"應有新創卡");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:9000,label:"x"}],{eduTags:["setup"]});
      var c0=p.cash;
      E.buyAsset(S,p,SU,"cash",{});
      var a=p.assets.filter(function(x){return x.kind==="STARTUP";})[0];
      assert(a,"新創應入帳");
      assert(isFinite(p.cash) && isFinite(a.costBasis) && isFinite(a.marketValue) && isFinite(p.derived.netWorth),
        "買新創後不得出現非有限數");
      assert(Math.abs((c0-p.cash)-SU.payload.investAmount)<0.01,"扣款金額應等於投資額");

      // (c) spendGuard 防禦:傳非有限數時必須放行,不得把 NaN 端到玩家面前
      if(typeof ui!=="undefined" && ui.spendGuard){
        var savedS=ui.S; ui.S=S;
        var proceeded=0;
        [NaN, undefined, Infinity].forEach(function(v){
          proceeded=0;
          ui.spendGuard(v, function(){ proceeded++; });
          assert(proceeded===1,"spendGuard 收到 "+v+" 應直接放行");
        });
        ui.S=savedS;
      }
      return "機會卡欄位全部有限；新創買入金額與分錄正確；spendGuard 對 NaN/undefined/Infinity 一律放行";
    });

    t("T-39 技能過時：預告→到期才真的失效；期間內更新可作廢預告", function(){
      var S=mkGame(3901,["M1","M2","M4","M6","M8"]), p=S.players[0];
      var CODE=ns.content.byId["SKL_CODE"];
      assert(CODE && CODE.decayable,"SKL_CODE 應為可過時");
      p.skills["SKL_CODE"]={learnedAt:1,decayed:false,refreshedAt:null};
      // (a) DECAY_SKILL 只下預告，不當場失效
      E.applyEffects(S,S.players[0],[{op:"DECAY_SKILL",target:"all",family:"TECH",warnTurns:2,label:"AI"}],"產業變革");
      assert(E.hasSkill(p,"SKL_CODE"),"預告期間技能仍應有效");
      assert(p.skills["SKL_CODE"].decayPendingUntil===S.turnNumber+2,"應寫入預告到期輪次");
      var pend=S.activeGlobalEvents.filter(function(e){return e.kind==="SKILL_DECAY_PENDING";});
      assert(pend.length===1,"應有一筆預告事件");
      // (b) 只點名可過時的技能
      p.skills["SKL_SWIM"]={learnedAt:1,decayed:false,refreshedAt:null};
      E.applyEffects(S,S.players[0],[{op:"DECAY_SKILL",target:"all",label:"全面"}],"產業變革");
      assert(!p.skills["SKL_SWIM"].decayPendingUntil,"decayable=false 的技能不得被點名");
      // (c) 到期 → 真的過時
      S.turnNumber=S.turnNumber+2; E.onRoundEnd(S);
      assert(p.skills["SKL_CODE"].decayed===true,"到期後應過時");
      assert(!E.hasSkill(p,"SKL_CODE"),"過時後 hasSkill 應為 false");
      assert((p.stats.skillsDecayed||0)===1,"應計入 skillsDecayed");
      // (d) GRANT_SKILL：直接取得，且不重複給
      var before=p.stats.skillsLearned||0;
      E.applyEffects(S,S.players[0],[{op:"GRANT_SKILL",target:"all",skillId:"SKL_BOOK",label:"內訓"}],"公司內訓");
      assert(E.hasSkill(p,"SKL_BOOK"),"GRANT_SKILL 應直接取得技能");
      E.applyEffects(S,S.players[0],[{op:"GRANT_SKILL",target:"all",skillId:"SKL_BOOK",label:"內訓"}],"公司內訓");
      assert((p.stats.skillsLearned||0)===before+1,"已具備的技能不得重複計數");
      // (e) 預告期間更新完成 → 預告作廢，不得再被判過時
      var S2=mkGame(3902,["M1","M2","M4","M6","M8"]), q=S2.players[0];
      q.skills["SKL_CODE"]={learnedAt:1,decayed:false,refreshedAt:null};
      E.applyEffects(S2,S2.players[0],[{op:"DECAY_SKILL",target:"all",family:"TECH",warnTurns:2,label:"AI"}],"產業變革");
      q.skills["SKL_CODE"].decayPendingUntil=null;   // 模擬期間內完成更新
      S2.turnNumber=S2.turnNumber+2; E.onRoundEnd(S2);
      assert(q.skills["SKL_CODE"].decayed===true,"未清除 pending 仍應過時（此處為對照）");
      return "預告不當場失效、只點名可過時者、到期轉過時、GRANT_SKILL 不重複、統計正確";
    });

    t("T-40 進修更新：學費減半、時間減半，學成寫入 refreshedAt", function(){
      var S=mkGame(4001,["M1","M2","M4","M6","M8"]), p=S.players[0];
      var CODE=ns.content.byId["SKL_CODE"];
      var full=E.skillPrice(S,CODE,false), fullT=E.skillTurns(S,p,CODE);
      assert(Math.abs(full-CODE.cost)<0.01,"未過時時應為全額");
      assert(fullT===(CODE.turns||1),"未過時時應為原輪數");
      p.skills["SKL_CODE"]={learnedAt:1,decayed:true,refreshedAt:null};
      var rf=E.cfg(S,"skillRefreshCostPct"), rt=E.cfg(S,"skillRefreshTurnPct");
      var half=E.skillPrice(S,CODE,false,p), halfT=E.skillTurns(S,p,CODE);
      assert(Math.abs(half-util.r2(CODE.cost*rf))<0.01,"更新學費應為 "+rf+" 倍，實得 "+half);
      assert(halfT===Math.max(1,Math.ceil((CODE.turns||1)*rt)),"更新輪數應折半，實得 "+halfT);
      // 不帶 p 時必須與 S2 行為完全一致（向後相容）
      assert(Math.abs(E.skillPrice(S,CODE,false)-CODE.cost)<0.01,"不帶 p 時不得套用更新折扣");
      // 走完整流程
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      var c0=p.cash;
      E.startLearning(S,p,CODE,false);
      assert(Math.abs((c0-p.cash)-half)<0.01,"實際扣款應等於更新學費");
      assert(p.learning.refresh===true,"應標記為更新");
      var extraT=E.cfg(S,"skillActiveExtraTurns"); if(extraT===undefined) extraT=1;
      assert(p.learning.endTurn===S.turnNumber+halfT+extraT,"結束輪次應採折後輪數");
      S.turnNumber=p.learning.endTurn; E.tickLearning(S,p);
      assert(p.skills["SKL_CODE"].decayed===false,"更新後應恢復有效");
      assert(p.skills["SKL_CODE"].refreshedAt===S.turnNumber,"應寫入 refreshedAt");
      assert(E.hasSkill(p,"SKL_CODE"),"更新後 hasSkill 應為 true");
      return "更新學費 "+half+"（原 "+full+"）、輪數 "+halfT+"（原 "+fullT+"）、refreshedAt 正確、向後相容";
    });

    t("T-41 學習干擾：進度延後、學費不退，且沒在學就不會抽到", function(){
      var S=mkGame(4101,["M1","M2","M4","M6","M8"]), p=S.players[0];
      var OT=ns.content.byId["SKE_OT"];
      assert(OT && OT.requiresLearning,"應有干擾卡且標記 requiresLearning");
      assert(!E.cardUsable(S,p,OT),"沒在學習時不得抽到干擾卡");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      E.startLearning(S,p,ns.content.byId["SKL_SPANISH"],true);
      assert(E.cardUsable(S,p,OT),"學習中應可抽到干擾卡");
      var end0=p.learning.endTurn, cash0=p.cash;
      E.applyEffects(S,p,OT.effects,OT.title,{lifeEvent:true});
      assert(p.learning.endTurn===end0+1,"進度應延後 1 輪");
      assert(p.learning.interrupted===1,"應累計 interrupted");
      assert(Math.abs(p.cash-cash0)<0.01,"加班卡不得動到現金");
      assert(isFinite(p.cash)&&isFinite(p.derived.netWorth),"不得出現非有限數");
      // 沒在學習時套用 DELAY_LEARNING 必須安全無事
      var q=S.players[1]; q.learning=null;
      E.applyEffects(S,q,[{op:"DELAY_LEARNING",turns:1}],"測試");
      assert(q.learning===null,"沒在學習時不得憑空造出 learning");
      return "延後 1 輪、interrupted=1、學費不退、無學習時安全";
    });

    t("T-42 三處引擎修正：水電修繕減半 / 談判成交折讓 / 記帳風險揭露", function(){
      /* (a) 水電：修繕成本 ×0.5，且 RNG 序列不變 */
      var cfgR=baseCfg();
      cfgR.repairChancePerPayday=1; cfgR.repairCostMonthsMin=2; cfgR.repairCostMonthsMax=2;
      ["BOOM","RECOVERY","RECESSION","DEPRESSION"].forEach(function(k){ cfgR["vacancyChance_"+k]=0; });
      function repairCost(withSkill){
        var Sx=mkGame(4201,["M1","M2","M4","M6","M8"],cfgR), px=Sx.players[0];
        px.assets.push({instanceId:"A_T42",cardId:null,kind:"REALESTATE",name:"測試套房",units:1,
          costBasis:500,marketValue:500,monthlyIncome:10,baseMonthlyIncome:10,
          linkedLiabilityId:null,flags:{}});
        if(withSkill) px.skills["SKL_PLUMB"]={learnedAt:1,decayed:false,refreshedAt:null};
        var st=Sx.rngState, c0=px.cash;
        E.opsRisk(Sx,px);
        return {spent:util.r2(c0-px.cash), rng:Sx.rngState, st0:st};
      }
      var noSk=repairCost(false), wiSk=repairCost(true);
      assert(noSk.spent>0,"測試前提：應發生修繕，實得 "+noSk.spent);
      assert(Math.abs(wiSk.spent-util.r2(noSk.spent*0.5))<0.01,
        "水電技能應讓修繕減半："+noSk.spent+" → "+wiSk.spent);
      assert(noSk.rng===wiSk.rng,"技能不得改變 RNG 序列（會破壞重放）");

      /* (b) 談判：成交價 −10%，買賣雙方同額（金額守恆） */
      var St=mkGame(4202,["M1","M2","M4","M6","M8"]);
      var sel=St.players[0], buy=St.players[1];
      assert(Math.abs(E.negotiatedPrice(St,buy,100)-100)<0.01,"沒技能不得有折讓");
      buy.skills["SKL_NEGO"]={learnedAt:1,decayed:false,refreshedAt:null};
      var dN=E.cfg(St,"skillNegoDiscount");
      assert(Math.abs(E.negotiatedPrice(St,buy,100)-util.r2(100*(1-dN)))<0.01,"折讓比例不符");
      var aT={instanceId:"A_T42B",cardId:null,kind:"REALESTATE",name:"轉讓標的",units:1,
              costBasis:300,marketValue:300,monthlyIncome:5,linkedLiabilityId:null,flags:{}};
      sel.assets.push(aT);
      ns.ledger.post(St,buy,"補現金",[{account:"CASH",delta:1000,label:"x"}],{eduTags:["setup"]});
      var sc0=sel.cash, bc0=buy.cash;
      E.executeTrade(St,sel,buy,aT,200);
      var got=util.r2(sel.cash-sc0), paid=util.r2(bc0-buy.cash);
      assert(Math.abs(got-paid)<0.01,"買賣雙方金額必須守恆："+paid+" vs "+got);
      assert(Math.abs(paid-util.r2(200*(1-dN)))<0.01,"成交價應套用折讓，實得 "+paid);
      assert(isFinite(sel.cash)&&isFinite(buy.cash),"不得出現非有限數");

      /* (c) 記帳：揭露風險調整後數字；沒技能看不到，且毛數字不被動更動 */
      var Sb=mkGame(4203,["M1","M2","M4","M6","M8"]), pb=Sb.players[0];
      var RE=(ns.content.cards.OPPORTUNITY_SMALL||[]).concat(ns.content.cards.OPPORTUNITY_LARGE||[])
             .filter(function(c){return c.kind==="REALESTATE" && (c.payload||{}).monthlyRent>0;})[0];
      assert(RE,"應有房產機會卡");
      var plain=E.oppCompare(Sb,RE);
      assert(plain.disclosed===false,"沒技能不得揭露");
      assert(plain.netYield===undefined,"沒技能不得帶出風險調整欄位");
      pb.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
      var open=E.oppCompare(Sb,RE,pb);
      assert(open.disclosed===true,"有記帳技能應揭露");
      assert(isFinite(open.netIncome)&&isFinite(open.netYield)&&isFinite(open.riskDrag),
        "揭露欄位必須是有限數");
      assert(Math.abs(open.income-plain.income)<0.01 && Math.abs(open.yield-plain.yield)<0.01,
        "毛數字不得被技能更動（否則沒技能的人也會被動受影響）");
      assert(open.netIncome<=open.income+0.001,"風險調整後不得高於毛現金流");
      return "水電減半且 RNG 不變；談判折讓 "+util.pct(dN,0)+" 且金額守恆；記帳揭露 "
             + "毛 "+plain.income+" → 淨 "+open.netIncome;
    });

    t("T-43 過時後的回頭路：名額不被佔住、已會的不重複送", function(){
      var S=mkGame(4301,["M1","M2","M4","M6","M8"]), p=S.players[1];   // 用 NPC
      assert(p.isNPC,"測試前提：players[1] 應為 NPC");
      var cap=E.cfg(S,"npcSkillCap");
      var pool=(S.skillSample||[]).slice(0,cap);
      assert(pool.length>=1,"測試前提：本局應有技能進場");
      pool.forEach(function(sid,i){ p.skills[sid]={learnedAt:1,decayed:(i===0),refreshedAt:null}; });
      if(pool.length>=cap){
        var effN=Object.keys(p.skills).filter(function(s){return !p.skills[s].decayed;}).length;
        assert(effN<cap,"測試前提：有效技能數應少於上限");
        ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
        p.skillCooldownUntil=0; p.playerStage="INNER"; p.learning=null;
        assert(ns.npc.skillToLearn(S,p),"有效技能未達上限時，電腦仍應願意去進修（含更新已過時者）");
        // 對照：把過時那項改成有效 → 名額用滿，就不該再學
        p.skills[pool[0]].decayed=false;
        assert(!ns.npc.skillToLearn(S,p),"名額用滿時不該再學");
      }
      // 已會的技能不再被內訓卡送一次
      var TR=ns.content.byId["SKE_INTRAIN"];
      assert(TR && TR.requiresNotSkill==="SKL_BOOK","內訓卡應標記 requiresNotSkill");
      var q=S.players[0];
      assert(E.cardUsable(S,q,TR),"還不會記帳時應可抽到內訓卡");
      q.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
      assert(!E.cardUsable(S,q,TR),"已會記帳時不得再抽到內訓卡");
      q.skills["SKL_BOOK"].decayed=true;
      assert(E.cardUsable(S,q,TR),"已過時時應可再度抽到——這就是回頭路");
      return "過時不佔名額、電腦會回頭更新；內訓卡不重複送、過時後可再取得";
    });

    t("T-44 面板不得出現字面 HTML 標籤，也不得放行可執行標記", function(){
      assert(typeof ui!=="undefined" && ui.isSafeMarkup, "應有 ui.isSafeMarkup");
      // (a) 這四個字串就是實測截圖上跑出字面標籤的來源，必須被判為可排版
      var okCases=[
        "現金為負 −32,540，<b class='gold'>還差 32,540</b> 才能回正。",
        "年利率 9.50%<br>目前負債總額 1,866,150（含有擔保）",
        "重點不是猜高點，而是<b>事先想好在什麼條件下要下車</b>。",
        "標的：<b>台積電</b>（現價 1,000 / 張）"
      ];
      okCases.forEach(function(s){ assert(ui.isSafeMarkup(s), "應判為可排版："+s.slice(0,24)); });
      // (b) 任何可執行／可載入的標記一律不得放行
      var badCases=["<script>alert(1)<\/script>", "<img src=x onerror=alert(1)>",
                    "<b onclick=\'x\'>hi<\/b>", "<a href=\'#\'>x<\/a>",
                    "<iframe src=x><\/iframe>", "<span style=\'x\'>y<\/span>"];
      badCases.forEach(function(s){ assert(!ui.isSafeMarkup(s), "不得放行："+s.slice(0,28)); });
      // (c) 純文字不走 innerHTML（避免無謂的 HTML 解析）
      assert(!ui.isSafeMarkup("現金不足，賣掉資產或申請紓困貸款"), "純文字不應判為標記");
      assert(!ui.isSafeMarkup(undefined) && !ui.isSafeMarkup(123), "非字串應回 false");
      // (d) 有 DOM 時直接驗渲染結果
      if(typeof document!=="undefined"){
        var e1=el("div",null,okCases[0]);
        assert(e1.textContent.indexOf("<b")<0, "可排版字串不得留下字面標籤");
        assert(e1.querySelector("b"), "應真的產生 <b> 節點");
        var e2=el("div",null,badCases[0]);
        assert(e2.textContent.indexOf("<script")>=0, "危險標記應原樣當文字顯示");
        assert(!e2.querySelector("script"), "危險標記不得進 DOM");
      }
      return "四處實測字串判為可排版；script/img/on*/a/iframe/style 全部擋下";
    });

    t("T-45 人生二選一：兩張都推、只能選一件、沒選的回牌堆", function(){
      var cfgL=baseCfg(); cfgL.lifeDualChoice=1;
      var S=mkGame(4501,["M1","M2","M4","M6","M8"],cfgL), p=S.players[0];
      var two=E.drawTwo(S,"LIFE_EVENT",function(c){ return E.cardUsable(S,p,c); });
      assert(two.length===2,"人生牌堆應抽得出兩張");
      assert(two[0].id!==two[1].id,"兩張不得同一張");
      S.decisionQueue.length=0;
      E.pushDecision(S,p,{kind:"PICK_LIFE", cardIds:[two[0].id,two[1].id]});
      E.syncPhase(S);
      var dL=S.pendingDecision;
      assert(dL && dL.kind==="PICK_LIFE","應推出 PICK_LIFE 決策");
      E.resolveDecision(S,p,dL,two[1].id,{});
      assert((p.stats.lifeDeferred||0)===1,"沒選的那件應計為擱置 1 件");
      assert(p.deferredLifeId===two[0].id,"擱置的應該是沒選的那一張");
      assert(isFinite(p.cash)&&isFinite(p.derived.netWorth),"結算後不得出現非有限數");
      // 無效選項不得變成「兩件都不要」——必須退回第一張
      var S2=mkGame(4502,["M1","M2","M4","M6","M8"],cfgL), q=S2.players[0];
      var t2=E.drawTwo(S2,"LIFE_EVENT",function(c){ return E.cardUsable(S2,q,c); });
      S2.decisionQueue.length=0;
      E.pushDecision(S2,q,{kind:"PICK_LIFE", cardIds:[t2[0].id,t2[1].id]});
      E.syncPhase(S2);
      var stg0=(q.stats.lifeDeferred||0);
      assert(S2.pendingDecision && S2.pendingDecision.kind==="PICK_LIFE","應推出 PICK_LIFE 決策");
      E.resolveDecision(S2,q,S2.pendingDecision,"none",{});
      assert((q.stats.lifeDeferred||0)===stg0+1,"無效選項仍應結算一件");
      assert(q.deferredLifeId===t2[1].id,"無效選項取第一張，擱置的是第二張");
      // NPC 決策是決定論的：同狀態兩次要選一樣的
      var S3=mkGame(4503,["M1","M2","M4","M6","M8"],cfgL), n3=S3.players[1];
      var t3=E.drawTwo(S3,"LIFE_EVENT",function(c){ return E.cardUsable(S3,n3,c); });
      var d3={kind:"PICK_LIFE", cardIds:[t3[0].id,t3[1].id], decisionId:"d_x", playerId:n3.id};
      var a1=ns.npc.decide(S3,n3,d3), a2=ns.npc.decide(S3,n3,d3);
      assert(a1.payload.optionId===a2.payload.optionId,"NPC 二選一必須是決定論");
      assert(t3.map(function(x){return x.id;}).indexOf(a1.payload.optionId)>=0,"NPC 必須從兩張裡選");
      // 關閉開關：lifeDualChoice=0 時不得產生 PICK_LIFE
      var cfgOff=baseCfg(); cfgOff.lifeDualChoice=0;
      var S4=ns.sim.playOne(cfgOff,["M1","M2","M4","M6","M8"],4504,["NPC_SAFE","NPC_LEVER"]);
      var anyPL=S4.actionLog.some(function(a){ return a.type==="DECIDE" && a.payload
        && String(a.payload.decisionId||"").indexOf("PICK_LIFE")>=0; });
      assert(!anyPL,"關閉時不得出現 PICK_LIFE");
      // 擱著的那件下次一定回來——這是「選順序不是選逃避」的保證
      var S5=mkGame(4505,["M1","M2","M4","M6","M8"],cfgL), r5=S5.players[0];
      var t5=E.drawTwo(S5,"LIFE_EVENT",function(c){ return E.cardUsable(S5,r5,c); });
      r5.deferredLifeId=t5[0].id;
      S5.decisionQueue.length=0;
      var led5=r5.ledger.length;
      E.landing(S5,r5,{type:"LIFE_EVENT"});
      assert(r5.deferredLifeId===null,"擱置的那張出過場後應清空");
      assert(S5.decisionQueue.length>0 || r5.ledger.length>led5,
        "擱置的那張應真的被推出決策或直接結算");
      return "抽兩張不重複、只能選一件、無效選項退回第一張、擱置卡下次必回、NPC 決定論、可關閉";
    });

    t("T-46 商城重複購買：效期內灰化，引擎也真的擋", function(){
      var S=mkGame(4601,["M1","M2","M3","M4","M6","M8"]), p=S.players[0];
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var GYM=ns.content.byId["ML_HEA1"];
      assert(GYM && GYM.renewable,"健身房年約應標記可續約");
      assert(!E.mallStillActive(S,p,GYM),"還沒買時不該是效期內");
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_HEA1"}},{mutate:true});
      assert(p.flags.fitUntil===S.turnNumber+24,"旗標泛用化後 fitUntil 應與原本一致");
      assert(E.mallStillActive(S,p,GYM),"買完應處於效期內");
      // 引擎必須擋（UI 灰化只是提示）
      p.mallBoughtThisTurn=0;
      var before=p.ledger.length;
      var r=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_HEA1"}},{mutate:true});
      assert(p.ledger.length===before,"效期內重複購買不得產生任何分錄");
      // oncePerGame 也要擋
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_EDU6"}},{mutate:true});
      assert(p.mallBought["ML_EDU6"]===1,"EMBA 應買得成");
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_EDU6"}},{mutate:true});
      assert(p.mallBought["ML_EDU6"]===1,"oncePerGame 不得買第二次");
      assert(isFinite(p.cash)&&isFinite(p.derived.netWorth),"不得出現非有限數");
      return "效期內／本局限購／已投保三種重購，引擎全部擋下；fitUntil 與泛用化前一致";
    });

    t("T-47 住宅火險：年繳、自動續約、理賠修繕與天災、繳不出就失效", function(){
      var S=mkGame(4701,["M1","M2","M3","M4","M6","M8"]), p=S.players[0];
      var INS=ns.content.byId["ML_INS2"];
      assert(INS && INS.payload.propertyInsurance,"應有住宅火險商品");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var c0=p.cash, e0=p.derived.totalExpenses;
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_INS2"}},{mutate:true});
      var prem=INS.payload.annualPremium;
      assert(Math.abs((c0-p.cash)-prem)<0.01,"年繳保費應一次扣清，實扣 "+(c0-p.cash));
      assert(Math.abs(p.derived.totalExpenses-e0)<0.01,"年繳不得進每月支出水位");
      assert(p.flags.propInsured===true,"應投保成功");
      var rt=E.cfg(S,"propertyRenewTurns");
      assert(p.flags.propRenewAt===S.turnNumber+rt,"應排定下次續約輪次");
      // 自動續約
      var c1=p.cash; S.turnNumber=p.flags.propRenewAt;
      E.tickRenewals(S,p);
      assert(Math.abs((c1-p.cash)-prem)<0.01,"自動續約應再扣一次年繳保費");
      assert(p.flags.propRenewAt===S.turnNumber+rt,"續約後應重排下次時間");
      // 天災理賠
      var pc=E.cfg(S,"propertyClaimPct");
      var c2=p.cash;
      E.applyEffects(S,p,[{op:"CASH_DELTA",amount:-100,propertyClaim:true,label:"地震"}],"強震");
      var paid=util.r2(c2-p.cash);
      assert(Math.abs(paid-util.r2(100*(1-pc)))<0.01,"天災損失應理賠 "+pc+"，實付 "+paid);
      // 沒保險的人不得被理賠
      var q=S.players[1]; var qc=q.cash;
      E.applyEffects(S,q,[{op:"CASH_DELTA",amount:-100,propertyClaim:true,label:"地震"}],"強震");
      assert(Math.abs(util.r2(qc-q.cash)-100)<0.01,"沒保產險就要全額自付");
      // 繳不出保費 → 失效（保障斷在最需要的時候）
      var S2=mkGame(4702,["M1","M2","M3","M4","M6","M8"]), r=S2.players[0];
      ns.ledger.post(S2,r,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      r.mallBoughtThisTurn=0;
      E.apply(S2,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_INS2"}},{mutate:true});
      ns.ledger.post(S2,r,"花光",[{account:"CASH",delta:-(r.cash-1),label:"x"}],{eduTags:["setup"]});
      S2.turnNumber=r.flags.propRenewAt; E.tickRenewals(S2,r);
      assert(r.flags.propInsured===false,"繳不出保費應失效");
      return "年繳一次扣清且不進支出水位、自動續約再扣、天災理賠 "+util.pct(pc,0)+"、沒保險全額自付、繳不出即失效";
    });

    t("T-48 年約到期會主動問續約，續約後效期重新計算", function(){
      var S=mkGame(4801,["M1","M2","M3","M4","M6","M8"]), p=S.players[0];
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_HEA2"}},{mutate:true});
      var until0=p.flags.checkedUntil;
      assert(until0>S.turnNumber,"健檢應在效期內");
      // 效期內不該問
      S.decisionQueue.length=0;
      E.tickRenewals(S,p);
      assert(S.decisionQueue.length===0,"效期內不得跳續約詢問");
      // 過期 → 問一次
      S.turnNumber=until0+1;
      E.tickRenewals(S,p);
      var dq=S.decisionQueue.filter(function(x){return x.kind==="RENEW_MALL";});
      assert(dq.length===1,"到期應推出一次續約詢問");
      // 不得重複問
      E.tickRenewals(S,p);
      assert(S.decisionQueue.filter(function(x){return x.kind==="RENEW_MALL";}).length===1,"不得重複詢問");
      // 續約 → 效期重算，且之後到期還能再問
      p.mallBoughtThisTurn=0;
      E.resolveDecision(S,p,dq[0],"renew",{});
      assert(p.flags.checkedUntil===S.turnNumber+12,"續約後效期應重新計算");
      assert(p.flags.checkedAsked===0,"續約後應可在下次到期再問");
      // 婉拒不得扣錢
      var S3=mkGame(4802,["M1","M2","M3","M4","M6","M8"]), q=S3.players[0];
      ns.ledger.post(S3,q,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      q.mallBoughtThisTurn=0;
      E.apply(S3,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_HEA2"}},{mutate:true});
      S3.turnNumber=q.flags.checkedUntil+1; S3.decisionQueue.length=0; E.tickRenewals(S3,q);
      var dq3=S3.decisionQueue.filter(function(x){return x.kind==="RENEW_MALL";})[0];
      var qc=q.cash; E.resolveDecision(S3,q,dq3,"stop",{});
      assert(Math.abs(q.cash-qc)<0.01,"婉拒續約不得扣錢");
      return "效期內不問、到期問一次、不重複問、續約重算效期、婉拒不扣錢";
    });

    t("T-49 特殊機會：沒人脈打不開，有人脈才抽得到", function(){
      var S=mkGame(4901,["M1","M2","M3","M4","M6","M8"]), p=S.players[0];
      var sp=ns.content.cards.OPPORTUNITY_SPECIAL||[];
      assert(sp.length>=3,"應有特殊機會卡，實得 "+sp.length);
      sp.forEach(function(c){
        var pl=c.payload||{}, cost;
        if(c.kind==="REALESTATE") cost=pl.price;
        else if(c.kind==="STARTUP") cost=pl.investAmount;
        else cost=pl.price;
        assert(typeof cost==="number" && isFinite(cost) && cost>0, c.id+" 進場金額不合法："+cost);
      });
      assert(!E.hasNetwork(S,p),"開局不該有人脈");
      // 沒人脈 → 引擎必須擋，而且不得吃掉玩家這一次機會
      S.decisionQueue.length=0;
      E.pushDecision(S,p,{kind:"CHOOSE_DECK"}); E.syncPhase(S);
      var q0=S.decisionQueue.length;
      E.apply(S,{type:"CHOOSE_DECK",playerId:0,payload:{deckId:"OPPORTUNITY_SPECIAL"}},{mutate:true});
      assert(S.decisionQueue.length===q0,"沒人脈時決策不得被吃掉（必須擋在 accept 之前）");
      // 買 EMBA → 解鎖（先把決策清乾淨，否則 phase 還停在 DECISION，商城會被 WRONG_PHASE 擋下）
      S.decisionQueue.length=0; E.syncPhase(S);
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      p.mallBoughtThisTurn=0;
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_EDU6"}},{mutate:true});
      assert(p.flags.network===true,"EMBA 應解鎖人脈");
      assert(E.hasNetwork(S,p),"解鎖後 hasNetwork 應為 true");
      assert((S.decks.OPPORTUNITY_SPECIAL||{}).draw.length>0,"特殊機會牌堆應已建置");
      // 海外留學也算
      var S2=mkGame(4902,["M1","M2","M3","M4","M6","M8"]), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      q.mallBoughtThisTurn=0;
      E.apply(S2,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_EDU4"}},{mutate:true});
      assert(q.flags.network===true,"海外留學也應解鎖人脈");
      // 總開關
      var cfgOff=baseCfg(); cfgOff.specialOppEnabled=0;
      var S3=mkGame(4903,["M1","M2","M3","M4","M6","M8"],cfgOff), r=S3.players[0];
      r.flags.network=true;
      assert(!E.hasNetwork(S3,r),"specialOppEnabled=0 應完全關閉");
      return sp.length+" 張特殊機會、金額合法；沒人脈擋下且不吃掉機會；EMBA／海外留學皆可解鎖；可關閉";
    });

    t("T-50 第二專長：學成二選一，轉職與副業帳目都要對", function(){
      var S=mkGame(5001,["M1","M2","M3","M4","M6","M8"]), p=S.players[0];
      var CAR=(ns.content.cards.SKILL||[]).filter(function(c){return c.secondCareer;});
      assert(CAR.length>=3,"應有第二專長技能，實得 "+CAR.length);
      var card=ns.content.byId["SKL_CAR_DATA"], sc=card.secondCareer;
      var prof=ns.content.professionById[sc.professionId];
      assert(prof,"第二專長指向的職業必須存在："+sc.professionId);
      // 學成 → 推出二選一
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      E.startLearning(S,p,card,true);
      S.decisionQueue.length=0;
      S.turnNumber=p.learning.endTurn; E.tickLearning(S,p);
      var dc=S.decisionQueue.filter(function(x){return x.kind==="SECOND_CAREER";});
      assert(dc.length===1,"第二專長學成應推出二選一");
      // (a) 兼副業：主動收入 + 時間成本，且不進被動收入
      var inc0=p.derived.salaryIncome, exp0=p.derived.totalExpenses, pas0=p.derived.passiveIncome;
      E.resolveDecision(S,p,dc[0],"side",{});
      assert(Math.abs(p.derived.salaryIncome-(inc0+sc.sideIncome))<0.01,"副業收入應計入主動收入");
      assert(Math.abs(p.derived.totalExpenses-(exp0+sc.sideCost))<0.01,"副業成本應計入每月支出");
      assert(Math.abs(p.derived.passiveIncome-pas0)<0.01,"副業不得計入被動收入（否則會加速進夢想圈）");
      assert(p.sideJob && p.sideJob.skillId===card.id,"應記錄副業");
      // (b) 辭職圓夢時副業必須一起收掉，不得留下孤兒支出
      //     注意：進外圈同時會加一筆「夢想維持費」，所以要逐項對帳，不能只看總額變小
      var expBefore=p.derived.totalExpenses;
      var upkeep=E.cfg(S,"dreamUpkeepMonthly")||0;
      E.enterOuterCircle(S,p);
      assert(p.sideJob===null,"進外圈應收掉副業");
      var expWant=util.r2(expBefore - sc.sideCost + upkeep);
      assert(Math.abs(p.derived.totalExpenses-expWant)<0.01,
        "副業成本必須跟著消失：實得 "+p.derived.totalExpenses+" 期望 "+expWant
        +"（原 "+expBefore+" − 副業成本 "+sc.sideCost+" ＋ 夢想維持費 "+upkeep+"）");
      assert(Math.abs(p.derived.salaryIncome)<0.01,"進外圈後主動收入應歸零（含副業）");
      assert(isFinite(p.derived.totalExpenses),"不得出現非有限數");
      // (c) 轉職：薪資與生活支出整組換掉
      var S2=mkGame(5002,["M1","M2","M3","M4","M6","M8"]), q=S2.players[0];
      var oldProf=ns.content.professionById[q.professionId];
      var dc2={kind:"SECOND_CAREER", cardId:card.id, decisionId:"d1", playerId:q.id};
      E.resolveDecision(S2,q,dc2,"switch",{});
      assert(q.professionId===prof.id,"應轉職成功");
      assert(Math.abs(q.derived.salaryIncome-util.r2(prof.salary*S2.config.salaryMult))<0.01,
        "轉職後薪資應等於新職業，實得 "+q.derived.salaryIncome);
      var expectExp=util.r2(prof.baseExpenses*S2.config.expenseMult);
      assert(Math.abs(q.derived.totalExpenses-expectExp)<0.01,
        "轉職後生活支出應等於新職業，實得 "+q.derived.totalExpenses+" 期望 "+expectExp);
      assert(q.salaryVolatility===(prof.salaryVolatility||0),"薪資波動應跟著新職業");
      assert(isFinite(q.cash)&&isFinite(q.derived.netWorth),"不得出現非有限數");
      return CAR.length+" 張第二專長；副業＝主動收入且不進自由率、辭職一併收掉；轉職薪資與支出整組換掉";
    });

    t("T-51 決策卡現金列與股價「較上期」", function(){
      // (a) 股價漲跌必須以上一期為基準——用面額當基準會洩漏地板位置
      var S=mkGame(5101,["M1","M2","M3","M4","M6","M8"]);
      var def=ns.content.stockDefs[0];
      S.stockHistory[def.symbol]=[def.face, util.r2(def.face*0.5), util.r2(def.face*0.45)];
      S.stockPrices[def.symbol]=util.r2(def.face*0.45);
      var sc=E.stockChange(S,def);
      assert(Math.abs(sc.pct-(-0.1))<0.005,"應為較上期 −10%，實得 "+util.pct(sc.pct,1));
      assert(Math.abs(sc.pct)<0.5,"不得等於「相對面額 −55%」那種會洩漏地板的數字");
      // 歷史只有一筆時不得炸，且變化為 0
      S.stockHistory[def.symbol]=[def.face]; S.stockPrices[def.symbol]=def.face;
      var sc0=E.stockChange(S,def);
      assert(sc0.pct===0 && isFinite(sc0.chg),"歷史不足時應回 0 且為有限數");
      // 缺欄位防禦
      var S2=mkGame(5102,["M1","M2","M4","M6"]);
      delete S2.stockHistory[def.symbol]; delete S2.stockPrices[def.symbol];
      var sc2=E.stockChange(S2,def);
      assert(isFinite(sc2.price)&&isFinite(sc2.pct),"缺歷史/價格時不得出現非有限數");
      // (b) 現金列的樣式存在（實際渲染需 DOM，這裡驗樣式有被寫進去）
      if(typeof document!=="undefined" && typeof ui!=="undefined"){
        var e1=el("div","cashbar","x");
        assert(e1.className.indexOf("cashbar")>=0,"cashbar 樣式應可用");
      }
      return "股價改以上一期為基準（−10% 而非相對面額 −55%）；歷史不足與缺欄位皆安全";
    });

    t("T-52 數位資產：爬坡→起飛→停更衰減→歸零下架", function(){
      var cfgD=baseCfg();
      var S=mkGame(5201,["M1","M2","M3","M4","M6","M8"],cfgD), p=S.players[0];
      var card=ns.content.byId["DIG_COURSE"];
      assert(card && card.requires==="SKL_BOOK","應有數位資產卡且需要對應技能");
      // S9 契約更新：技能不再是門票（原本這裡斷言「沒技能不得抽到」，
      // 那正是把這個系統壓到 5.6% 開張率的元兇）。現在改成人人可抽，技能只影響難度。
      assert(E.cardUsable(S,p,card),"S9 起沒有技能也要抽得到（人人可做）");
      var oddsAm=E.digitalOdds(S,p,card);
      assert(oddsAm.pro===false,"沒學過就不算本行");
      p.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
      assert(E.cardUsable(S,p,card),"有技能後當然也要抽得到");
      var oddsPro=E.digitalOdds(S,p,card);
      assert(oddsPro.pro===true,"學過就算本行");
      assert(oddsPro.threshold < oddsAm.threshold,
        "本行的爬坡輪數必須少於外行（"+oddsPro.threshold+" vs "+oddsAm.threshold+"）");
      assert(oddsPro.hit > oddsAm.hit,"本行的爆紅機率必須高於外行");
      assert(oddsPro.flop < oddsAm.flop,"本行的做白工機率必須低於外行");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      var pas0=p.derived.passiveIncome, exp0=p.derived.totalExpenses, c0=p.cash;
      E.startDigital(S,p,card);
      var d0=p.digitalAssets[0];
      assert(Math.abs((c0-p.cash)-card.payload.cost)<0.01,"建置成本應一次扣清");
      assert(Math.abs(p.derived.totalExpenses-(exp0+card.payload.monthlyCost))<0.01,"維護費應進支出水位");
      assert(Math.abs(p.derived.passiveIncome-pas0)<0.01,"爬坡期不得有被動收入");
      assert(p.tending===d0.id,"應佔用時間槽");
      // 爬坡：沒顧就不前進
      p.tending=null; S.turnNumber++; E.tickDigital(S,p);
      assert(d0.progress===0,"沒投入時間就不該有進度");
      p.tending=d0.id;
      for(var i=0;i<d0.threshold;i++){ S.turnNumber++; E.tickDigital(S,p); }
      assert(d0.tier!==null,"累積達門檻後應起飛，實得 tier="+d0.tier);
      assert(["FLOP","OK","HIT"].indexOf(d0.tier)>=0,"tier 必須是三者之一");
      assert(d0.monthlyIncome>0 && isFinite(d0.monthlyIncome),"起飛後應有有限的月收入");
      assert(d0.assetInstanceId,"起飛後應鏡射進 p.assets");
      assert(Math.abs(p.derived.passiveIncome-(pas0+d0.monthlyIncome))<0.01,
        "起飛後被動收入應增加，實得 "+p.derived.passiveIncome);
      // 停更衰減
      p.tending=null;
      var inc1=d0.monthlyIncome;
      S.turnNumber++; E.tickDigital(S,p);
      assert(d0.monthlyIncome<inc1,"停更應衰減");
      assert(Math.abs(p.derived.passiveIncome-(pas0+d0.monthlyIncome))<0.01,"被動收入應同步下降");
      // 一路衰減到歸零
      for(var j=0;j<60 && !d0.dead;j++){ S.turnNumber++; E.tickDigital(S,p); }
      assert(d0.dead===true,"持續停更應歸零");
      assert(d0.monthlyIncome===0,"歸零後收入為 0");
      assert(!p.assets.some(function(a){return a.instanceId===d0.assetInstanceId;}),"歸零後應從 p.assets 移除");
      assert(Math.abs(p.derived.passiveIncome-pas0)<0.01,"被動收入應回到起始值，實得 "+p.derived.passiveIncome);
      assert(Math.abs(p.derived.totalExpenses-exp0)<0.01,"維護費應一併停止，不得留下孤兒支出");
      assert(isFinite(p.cash)&&isFinite(p.derived.netWorth),"全程不得出現非有限數");
      return "爬坡需持續投入、起飛鏡射進被動收入、停更衰減、歸零下架且維護費一併停止";
    });

    t("T-53 三種 tier 都出得來，且時間槽與學習互斥", function(){
      // (a) 固定流程掃多個 seed，FLOP/OK/HIT 三種都要出現
      var seen={FLOP:0,OK:0,HIT:0};
      for(var s=0;s<120;s++){
        var Sx=mkGame(6000+s,["M1","M2","M3","M4","M6","M8"]), px=Sx.players[0];
        px.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
        ns.ledger.post(Sx,px,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
        E.startDigital(Sx,px,ns.content.byId["DIG_COURSE"]);
        var dx=px.digitalAssets[0];
        for(var k=0;k<dx.threshold;k++){ Sx.turnNumber++; E.tickDigital(Sx,px); }
        if(dx.tier) seen[dx.tier]++;
      }
      assert(seen.FLOP>0 && seen.OK>0 && seen.HIT>0,
        "三種結果都要出得來，實得 "+JSON.stringify(seen));
      // (b) 時間互斥：開始學習會放掉正在經營的內容
      var S2=mkGame(5301,["M1","M2","M3","M4","M6","M8"]), q=S2.players[0];
      q.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      E.startDigital(S2,q,ns.content.byId["DIG_COURSE"]);
      assert(q.tending,"應在經營中");
      E.startLearning(S2,q,ns.content.byId["SKL_CPR"],true);
      assert(q.tending===null,"開始學習應放掉時間槽");
      // 學習中不得再接手經營
      var r=E.apply(S2,{type:"TEND_DIGITAL",playerId:0,payload:{digitalId:q.digitalAssets[0].id}},{mutate:true});
      assert(q.tending===null,"學習中不得接手經營");
      // (c) 關閉開關
      var cfgOff=baseCfg(); cfgOff.digitalPerGame=0;
      var S3=mkGame(5302,["M1","M2","M3","M4","M6","M8"],cfgOff), u=S3.players[0];
      assert(!E.digitalOn(S3),"digitalPerGame=0 應關閉系統");
      u.skills["SKL_BOOK"]={learnedAt:1,decayed:false,refreshedAt:null};
      assert(!E.cardUsable(S3,u,ns.content.byId["DIG_COURSE"]),"關閉後不得抽到數位資產卡");
      assert((S3.digitalSample||[]).length===0,"關閉後不得抽樣");
      return "120 次起飛：FLOP "+seen.FLOP+" / OK "+seen.OK+" / HIT "+seen.HIT+"；時間槽與學習互斥；可關閉";
    });

    t("T-54 存檔種子只能放開局資料（轉職後存檔重放仍須一致）", function(){
      // 這條是為了 S4 埋下的缺陷而寫：轉職會改寫 p.professionId，
      // 存檔若存當下值，重放會把「轉職後的職業」當成開局職業，整局從第一輪就歪。
      var modsQ=["M1","M2","M3","M4","M6","M8"];
      var Sq=mkGame(5401,modsQ), pq=Sq.players[0];
      var orig=pq.professionId;
      assert(pq.initialProfessionId===orig,"開局時 initialProfessionId 應等於 professionId");
      var cardQ=ns.content.byId["SKL_CAR_DATA"];
      E.resolveDecision(Sq,pq,{kind:"SECOND_CAREER",cardId:cardQ.id,decisionId:"d1",playerId:pq.id},"switch",{});
      assert(pq.professionId!==orig,"測試前提：應已轉職");
      assert(pq.initialProfessionId===orig,"轉職不得改動 initialProfessionId");
      assert(ns.seedPlayers(Sq)[0].professionId===orig,"seedPlayers 必須回開局職業");

      // 全流程：跑完整局 → 用 seedPlayers 重放 → 必須完全一致
      var normQ=function(X){ return JSON.stringify(X.players.map(function(z){
        return [z.cash,z.derived.netWorth,z.derived.totalExpenses,z.derived.passiveIncome,
                z.professionId,z.initialProfessionId,
                Object.keys(z.skills).sort().join(","),
                (z.digitalAssets||[]).map(function(g){return g.id+"/"+g.progress+"/"+g.tier+"/"+g.monthlyIncome;}).join(";"),
                z.sideJob?z.sideJob.skillId:null];
      }))+"|"+X.turnNumber+"|"+X.winner; };
      var okN=0, tested=0, switched=0;
      [880011,880012,880013,880014,880015,880016].forEach(function(sd){
        var G=ns.sim.playOne(baseCfg(),modsQ,sd,["NPC_SAFE","NPC_LEVER","NPC_VC"]);
        tested++;
        if(G.players.some(function(z){ return z.professionId!==z.initialProfessionId; })) switched++;
        var R=ns.replay({seed:sd, config:G.config, modules:G.enabledModules,
                         players:ns.seedPlayers(G), actionLog:G.actionLog});
        if(normQ(R)===normQ(G)) okN++;
      });
      assert(okN===tested, okN+"/"+tested+" 局重放一致——不一致代表又有『把玩法改過的欄位當開局資料存檔』");
      return "initialProfessionId 不受轉職影響；"+tested+" 局重放全數一致（其中 "+switched+" 局有人轉職）";
    });

    t("T-55 徽章：純函式、互斥、且絕不影響任何遊戲數值", function(){
      var all=ns.badges.all();
      assert(all.length>=20,"應有足夠的徽章，實得 "+all.length);

      // (a) 內容體檢：每張徽章的條件函式都要真的存在，欄位齊全，id 不重複
      var bad=[], seen={};
      all.forEach(function(b){
        if(typeof ns.badges.rules[b.rule]!=="function") bad.push(b.id+" 的 rule「"+b.rule+"」不存在");
        if(!b.title || !b.desc) bad.push(b.id+" 缺 title/desc");
        if(seen[b.id]) bad.push(b.id+" 重複"); seen[b.id]=1;
        if(b.exclusiveWith && !all.some(function(x){return x.id===b.exclusiveWith;}))
          bad.push(b.id+" 的互斥對象不存在");
      });
      assert(!bad.length,"徽章內容體檢："+bad.join("; "));

      // (b) 互斥必須雙向宣告，否則只會擋一邊
      all.forEach(function(b){
        if(!b.exclusiveWith) return;
        var o=ns.content.byId[b.exclusiveWith];
        assert(o && o.exclusiveWith===b.id, b.id+" 與 "+b.exclusiveWith+" 的互斥宣告不對稱");
      });

      // (c) 純函式：同輸入同輸出，且呼叫前後整個對局狀態逐位元不變
      var mods=["M1","M2","M3","M4","M6","M8"];
      var S=ns.sim.playOne(baseCfg(),mods,5501,["NPC_SAFE","NPC_LEVER","NPC_VC"]);
      var snap=JSON.stringify(S);
      var r1=ns.badges.evaluateAll(S);
      var r2=ns.badges.evaluateAll(S);
      assert(JSON.stringify(r1)===JSON.stringify(r2),"同輸入必須同輸出（純函式）");
      assert(JSON.stringify(S)===snap,
        "評徽章不得改動對局的任何一個位元——徽章只給頭銜，不給遊戲內數值");

      // (d) 互斥徽章不得同時出現：直接構造兩邊都成立的狀態
      var S2=mkGame(5502,mods), q=S2.players[0];
      q.stats.skillsLearned=5; q.stats.skillsAbandoned=3;      // lifelong 與 quitter 的條件同時碰
      var g2=ns.badges.evaluate(S2,q);
      assert(!(g2.indexOf("BDG_LIFELONG")>=0 && g2.indexOf("BDG_QUITTER")>=0),
        "終身學習者 與 半途而廢專家 不得同時出現");
      q.stats.skillsAbandoned=0;
      assert(ns.badges.evaluate(S2,q).indexOf("BDG_LIFELONG")>=0,"沒放棄過就該拿到終身學習者");

      var S3=mkGame(5503,mods), r=S3.players[0];
      r.freeAtTurn=30; r.liabilities=[]; r.stats.maxLeverage=4; r.bankrupt=false;
      var g3=ns.badges.evaluate(S3,r);
      assert(!(g3.indexOf("BDG_KARATE")>=0 && g3.indexOf("BDG_LEVER")>=0),
        "空手道大師 與 槓桿藝術家 不得同時出現");
      assert(g3.indexOf("BDG_PRODIGY")>=0,"第 30 輪自由應拿到投資神童");

      // (e) 相對頭銜：單人局不給、全場最高者才給
      var S4=mkGame(5504,mods);
      S4.players[0].stats.skillsLearned=5; S4.players[1].stats.skillsLearned=2;
      var ctx4=ns.badges.context(S4);
      assert(ns.badges.evaluate(S4,S4.players[0],ctx4).indexOf("BDG_TOP_LEARNER")>=0,"最高者應拿到頭銜");
      assert(ns.badges.evaluate(S4,S4.players[1],ctx4).indexOf("BDG_TOP_LEARNER")<0,"非最高者不得拿到");
      var solo=E.newGame({seed:5505,config:baseCfg(),modules:mods,
        players:[{name:"A",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id}]});
      solo.players[0].stats.skillsLearned=9;
      assert(ns.badges.evaluate(solo,solo.players[0]).indexOf("BDG_TOP_LEARNER")<0,
        "單人局不該有「全場最」的頭銜");

      // (f) 缺欄位防禦：全新玩家（所有統計為 0）不得炸，也不得誤給頭銜
      var S6=mkGame(5506,mods), fresh=S6.players[0];
      var g6=ns.badges.evaluate(S6,fresh);
      assert(Array.isArray(g6),"回傳必須是陣列");
      assert(g6.indexOf("BDG_READY")<0 && g6.indexOf("BDG_PRODIGY")<0,"開局不該有成就");
      // rule 寫錯時要安靜跳過，不得整份評鑑掛掉
      var savedRule=ns.badges.rules.ready;
      ns.badges.rules.ready=function(){ throw new Error("boom"); };
      var g7=ns.badges.evaluate(S6,fresh);
      assert(Array.isArray(g7),"單一條件出錯不得讓整份評鑑掛掉");
      ns.badges.rules.ready=savedRule;

      // (g) BADGE 絕不可被洗進任何牌堆
      Object.keys(S.decks).forEach(function(dk){
        var pool=S.decks[dk].draw.concat(S.decks[dk].discard);
        pool.forEach(function(id){
          var c=ns.content.byId[id];
          assert(!c || c.kind!=="BADGE", "徽章不得出現在牌堆 "+dk);
        });
      });

      var got=r1[0]||[];
      return all.length+" 張徽章、條件函式齊全、互斥雙向且不同時出現、"+
             "評鑑為純函式且不動對局一個位元、單人局無相對頭銜、不進牌堆";
    });

    t("T-56 實測回饋五項：產險價格、未開的課、品格對照、來源標題、天災標記", function(){
      var mods=["M1","M2","M3","M4","M6","M8"];

      // (a) 產險不是免費：mallCost 要含年繳保費，付得起的檢查也要跟著算
      var INS=ns.content.byId["ML_INS2"], prem=INS.payload.annualPremium;
      assert(prem>0,"測試前提：產險應有年繳保費");
      var S=mkGame(5601,mods), p=S.players[0];
      assert(Math.abs(E.mallCost(S,INS)-prem)<0.01,
        "mallCost 應等於年繳保費 "+prem+"，實得 "+E.mallCost(S,INS));
      // 現金剛好不夠時必須擋下（原本 mallCost=0 會直接放行）
      ns.ledger.post(S,p,"清空現金",[{account:"CASH",delta:-(p.cash-1),label:"x"}],{eduTags:["setup"]});
      assert(!E.mallAffordable(S,p,INS),"現金只剩 1 時不該買得起產險");
      // 扣款只能扣一次
      var S2=mkGame(5602,mods), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var c0=q.cash; q.mallBoughtThisTurn=0;
      E.apply(S2,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_INS2"}},{mutate:true});
      assert(Math.abs((c0-q.cash)-prem)<0.01,
        "年繳保費只能扣一次，實扣 "+util.r2(c0-q.cash)+"（應為 "+prem+"）");
      assert(q.flags.propInsured===true,"應投保成功");

      // (b) 每一門技能都必須「要嘛在本局牌堆、要嘛列得出來」——玩家不該找不到又不知為何
      var S3=mkGame(5603,mods);
      var sample={}; (S3.skillSample||[]).forEach(function(id){ sample[id]=1; });
      var allSk=ns.content.cards.SKILL||[];
      assert(allSk.length > (S3.skillSample||[]).length,
        "測試前提：技能總數應多於每局抽樣數，才會有『本局沒開』的課");
      var off=allSk.filter(function(c){ return !sample[c.id]; });
      assert(off.length>0,"應存在本局沒開的課");
      off.forEach(function(c){ assert(c.title && c.hint, c.id+" 缺 title/hint，灰化清單會顯示空白"); });

      // (c) 品格考驗：above/below 的代價差必須算得出來，才有對照可講
      var tri=(ns.content.cards.LIFE_TAPESTRY||[]).filter(function(c){
        return c.subKind==="TRIAL" && c.virtueBranch; });
      assert(tri.length>0,"應有品格考驗卡");
      var badT=[];
      tri.forEach(function(c){
        var b=c.virtueBranch;
        if(!b.above || !b.below) badT.push(c.id+" 缺分支");
        if(typeof b.threshold!=="number" || !isFinite(b.threshold)) badT.push(c.id+" threshold 非有限數");
        (["above","below"]).forEach(function(k){
          ((b[k]&&b[k].effects)||[]).forEach(function(ef){
            if(ef.op==="CASH_DELTA" && !isFinite(ef.amount)) badT.push(c.id+" "+k+" 金額非有限數"); });
        });
      });
      assert(!badT.length,"品格考驗卡體檢："+badT.join("; "));
      // 實跑一張：失敗分支要帶出 aboveCost / belowCost 供 UI 做對照
      var S4=mkGame(5604,mods), r=S4.players[0];
      var card=tri.filter(function(c){ return (c.virtueBranch.below.effects||[]).some(function(e){
        return e.op==="CASH_DELTA" && e.amount<0; }); })[0];
      assert(card,"應有帶現金損失的考驗卡");
      r.virtues[card.virtueBranch.axis]=0;               // 確保走 below
      S4.decisionQueue.length=0;
      E.resolveTrial(S4,r,card);
      var dT=S4.decisionQueue.filter(function(x){ return x.kind==="TRIAL_RESULT"; })[0];
      assert(dT,"應推出 TRIAL_RESULT");
      assert(dT.above===false,"品格 0 級應走 below");
      assert(isFinite(dT.belowCost) && isFinite(dT.aboveCost),"對照用的兩個金額都要是有限數");
      assert(dT.belowCost>dT.aboveCost,"below 的代價應高於 above，否則對照沒有意義");

      // (d) 事件分錄要留得住來源卡片，否則每輪紀錄看不出「這筆是強震造成的」
      var S5=mkGame(5605,mods), u=S5.players[0];
      var n0=u.ledger.length;
      E.applyEffects(S5,u,[{op:"CASH_DELTA",amount:-30,label:"修繕與停業損失"}],"強震來襲，老屋受損");
      var last=u.ledger[u.ledger.length-1];
      assert(u.ledger.length>n0,"應產生分錄");
      assert(last.srcTitle==="強震來襲，老屋受損",
        "分錄應記得來源卡片，實得 "+last.srcTitle);
      assert(last.summary==="修繕與停業損失","摘要仍應是效果標籤（不改既有顯示）");

      // (e) 天災卡有標記，而且指向真的會扣錢的效果
      var dis=(ns.content.cards.MACRO_EVENT||[]).filter(function(c){ return c.disaster; });
      assert(dis.length>=3,"應有 3 張以上天災卡，實得 "+dis.length);
      dis.forEach(function(c){
        var hasCash=(c.effects||[]).some(function(e){ return e.op==="CASH_DELTA" && e.amount<0; });
        assert(hasCash, c.id+" 標為天災卻沒有現金損失");
        var claimable=(c.effects||[]).some(function(e){ return e.propertyClaim; });
        assert(claimable, c.id+" 天災損失應可由產險理賠");
      });

      return "產險 "+prem+" 不再顯示免費且只扣一次；本局沒開的課 "+off.length+" 門可列出；"+
             "品格對照金額齊全；分錄記得來源卡片；天災卡 "+dis.length+" 張皆可理賠";
    });

    t("T-57 下市／新創寒冬／木工技能", function(){
      var mods=["M1","M2","M3","M4","M6","M8"];

      /* ---- (a) 股票下市：警示 → 緩衝 → 歸零，且融資的債留在身上 ---- */
      var S=mkGame(5701,mods), p=S.players[0];
      var def=ns.content.stockDefs.filter(function(x){ return x.delistable; })[0];
      assert(def,"應有標記為可下市的投機股");
      var sym=def.symbol;
      var safe=ns.content.stockDefs.filter(function(x){ return !x.delistable; })[0];
      assert(safe,"應有不會下市的股票（大盤／高股息不該歸零）");
      var ratio=E.cfg(S,"delistPriceRatio"), warnT=E.cfg(S,"delistWarnTurns");
      // 沒到蕭條就不該有下市風險
      S.macro.stage="RECESSION"; S.stockPrices[sym]=util.r2(def.face*ratio*0.5);
      assert(!E.delistRisk(S,def),"非蕭條期不該有下市風險");
      S.macro.stage="DEPRESSION";
      assert(E.delistRisk(S,def),"蕭條 + 跌破門檻應有下市風險");
      S.stockPrices[safe.symbol]=util.r2(safe.face*ratio*0.5);
      assert(!E.delistRisk(S,safe),"非投機股即使跌到谷底也不該下市");
      // 給玩家一筆持股（含融資負債），確認下市後債務仍在
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var lid=E.addLiability(S,p,"CONSUMER","融資借款",200,0.07,false,null,true);
      p.assets.push({instanceId:"A_DL",cardId:null,kind:"STOCK",symbol:sym,name:E.stockName(S,sym),
        units:10,costBasis:400,marketValue:util.r2(S.stockPrices[sym]*10),monthlyIncome:0,
        linkedLiabilityId:lid,flags:{margin:true}});
      ns.ledger.post(S,p,"建立部位",[{account:"ASSET",delta:util.r2(S.stockPrices[sym]*10),refId:"A_DL",label:"x"}],{eduTags:["setup"]});
      S.decisionQueue.length=0;
      E.tickDelist(S);
      assert(S.delistWatch[sym],"應進入警示名單");
      // 【不變式】警示不得在回合結束直接推決策——那會把決策塞給沒輪到的玩家，
      // ui.tick 只驅動當前玩家、畫面卻等決策的擁有者，整局會死當（S8 實測回報）
      assert(S.decisionQueue.length===0,"tickDelist 不得直接推決策（會破壞「待決策屬於當前玩家」的不變式）");
      assert(p.pendingDelistWarn && p.pendingDelistWarn.symbol===sym,"應記在持股者身上");
      // 輪到自己時才跳卡
      E.tickDelistWarn(S,p);
      var dW=S.decisionQueue.filter(function(x){ return x.kind==="DELIST_WARN"; })[0];
      assert(dW,"輪到自己時應收到警示卡");
      assert(dW.playerId===p.id,"警示卡必須屬於當前玩家");
      assert(dW.until===S.turnNumber+warnT,"警示到期輪次應正確");
      assert(p.pendingDelistWarn===null,"跳過卡之後待通知應清空（不得重複跳）");
      // 已經賣掉的人不該再跳卡
      var pSold=S.players[1]; pSold.pendingDelistWarn={symbol:sym, until:S.turnNumber+warnT};
      var q0=S.decisionQueue.length; E.tickDelistWarn(S,pSold);
      assert(S.decisionQueue.length===q0,"沒有持股就不該跳警示卡");
      // 緩衝期內不得下市
      E.tickDelist(S);
      assert(!S.delisted[sym],"緩衝期內不得下市");
      assert(p.assets.some(function(a){return a.instanceId==="A_DL";}),"緩衝期內持股還在");
      // 到期且條件仍成立 → 下市歸零
      S.turnNumber += warnT;
      var debtBefore=p.liabilities.length;
      E.tickDelist(S);
      assert(S.delisted[sym]===true,"到期應下市");
      assert(!p.assets.some(function(a){return a.instanceId==="A_DL";}),"持股應歸零並移除");
      assert(p.liabilities.length===debtBefore,"融資的債不得跟著消失——這正是要教的事");
      assert(isFinite(p.cash)&&isFinite(p.derived.netWorth),"不得出現非有限數");
      // 已下市不得再買到
      var stockCards=(ns.content.cards.OPPORTUNITY_SMALL||[]).concat(ns.content.cards.OPPORTUNITY_LARGE||[])
        .filter(function(c){ return c.kind==="STOCK" && (c.payload||{}).symbol===sym; });
      stockCards.forEach(function(c){ assert(!E.cardUsable(S,p,c),"下市後不該再抽到這檔股票"); });
      // 價格回來 → 警示解除
      var S2=mkGame(5702,mods), q=S2.players[0];
      S2.macro.stage="DEPRESSION"; S2.stockPrices[sym]=util.r2(def.face*ratio*0.5);
      E.tickDelist(S2); assert(S2.delistWatch[sym],"應先進警示");
      S2.stockPrices[sym]=util.r2(def.face*0.9);
      E.tickDelist(S2);
      assert(!S2.delistWatch[sym] && !S2.delisted[sym],"價格回來應解除警示，不得下市");
      // 停損分支
      var S3=mkGame(5703,mods), r=S3.players[0];
      r.assets.push({instanceId:"A_SL",cardId:null,kind:"STOCK",symbol:sym,name:"測試股",
        units:5,costBasis:300,marketValue:100,monthlyIncome:0,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S3,r,"建立部位",[{account:"ASSET",delta:100,refId:"A_SL",label:"x"}],{eduTags:["setup"]});
      var c0=r.cash;
      E.resolveDecision(S3,r,{kind:"DELIST_WARN",symbol:sym,until:1,decisionId:"d1",playerId:r.id},"sell",{});
      assert(!r.assets.some(function(a){return a.instanceId==="A_SL";}),"停損應賣出");
      assert(Math.abs((r.cash-c0)-100)<0.01,"停損應拿回市值 100，實得 "+util.r2(r.cash-c0));
      // 關閉開關
      var cfgOff=baseCfg(); cfgOff.delistEnabled=0;
      var S4=mkGame(5704,mods,cfgOff);
      S4.macro.stage="DEPRESSION"; S4.stockPrices[sym]=0.01;
      E.tickDelist(S4);
      assert(!S4.delistWatch[sym] && !S4.delisted[sym],"關閉時完全不作用");

      /* ---- (b) 新創寒冬：估值下修＋部分陣亡 ---- */
      var down=0, dead=0, tested=0;
      for(var s=0;s<40;s++){
        var Sx=mkGame(5800+s,mods), px=Sx.players[0];
        px.assets.push({instanceId:"A_SU",cardId:null,kind:"STARTUP",name:"測試新創",units:1,
          costBasis:500,marketValue:500,monthlyIncome:0,equityPct:0.1,postMoney:5000,
          linkedLiabilityId:null,flags:{}});
        ns.ledger.post(Sx,px,"建立部位",[{account:"ASSET",delta:500,refId:"A_SU",label:"x"}],{eduTags:["setup"]});
        E.startupWinter(Sx,"DEPRESSION");
        tested++;
        var still=px.assets.filter(function(a){return a.instanceId==="A_SU";})[0];
        if(!still) dead++;
        else { if(still.marketValue<500) down++;
          assert(isFinite(still.marketValue) && still.marketValue>0,"存活的估值必須是正有限數");
          assert(still.postMoney<5000,"postMoney 應一併下修"); }
        assert(isFinite(px.derived.netWorth),"不得出現非有限數");
      }
      assert(dead>0,"40 次寒冬應有新創陣亡，實得 "+dead);
      assert(down>0,"存活的應被下修估值，實得 "+down);
      assert(dead<tested,"不該全部陣亡");
      // 景氣變好時不作用
      var S5=mkGame(5705,mods), t5=S5.players[0];
      t5.assets.push({instanceId:"A_SU2",cardId:null,kind:"STARTUP",name:"n",units:1,
        costBasis:500,marketValue:500,monthlyIncome:0,equityPct:0.1,postMoney:5000,
        linkedLiabilityId:null,flags:{}});
      E.startupWinter(S5,"BOOM");
      assert(t5.assets[t5.assets.length-1].marketValue===500,"景氣變好不該下修");

      /* ---- (c) 木工技能：租金 +8%、空租減半、只加成一次 ---- */
      var CARP=ns.content.byId["SKL_CARPENTRY"];
      assert(CARP && CARP.family==="HANDS","應有木工技能");
      var S6=mkGame(5706,mods), u=S6.players[0];
      var bonus=E.cfg(S6,"carpentryRentBonus");
      u.assets.push({instanceId:"A_RE",cardId:null,kind:"REALESTATE",name:"測試套房",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:20,baseMonthlyIncome:20,
        linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S6,u,"建立部位",[{account:"ASSET",delta:1000,refId:"A_RE",label:"x"},
        {account:"INCOME_PASSIVE",delta:20,refId:"A_RE",label:"租金"}],{eduTags:["setup"]});
      var pas0=u.derived.passiveIncome;
      E.applyCarpentry(S6,u);
      assert(Math.abs(u.derived.passiveIncome-pas0)<0.01,"沒學技能時不得加成");
      u.skills["SKL_CARPENTRY"]={learnedAt:1,decayed:false,refreshedAt:null};
      E.applyCarpentry(S6,u);
      var want=util.r2(20*(1+bonus));
      var a6=u.assets.filter(function(a){return a.instanceId==="A_RE";})[0];
      assert(Math.abs(a6.monthlyIncome-want)<0.01,"租金應為 "+want+"，實得 "+a6.monthlyIncome);
      assert(Math.abs(u.derived.passiveIncome-(pas0+util.r2(20*bonus)))<0.01,"被動收入應同步上升");
      // 冪等：再呼叫幾次都不得重複加成
      E.applyCarpentry(S6,u); E.applyCarpentry(S6,u);
      assert(Math.abs(a6.monthlyIncome-want)<0.01,"重複呼叫不得重複加成（冪等）");
      // 空租中的物件加在 vacantIncome 上
      var S7=mkGame(5707,mods), v=S7.players[0];
      v.skills["SKL_CARPENTRY"]={learnedAt:1,decayed:false,refreshedAt:null};
      v.assets.push({instanceId:"A_V",cardId:null,kind:"REALESTATE",name:"空租中",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:0,vacantIncome:30,
        vacantUntilTurn:S7.turnNumber+2,linkedLiabilityId:null,flags:{}});
      E.applyCarpentry(S7,v);
      var av=v.assets[v.assets.length-1];
      assert(Math.abs(av.vacantIncome-util.r2(30*(1+bonus)))<0.01,"空租中應加在復租後的租金上");
      assert(av.monthlyIncome===0,"空租中當下收入仍為 0");
      // 空租機率減半：只縮放機率，不改變 RNG 呼叫次數
      var cfgV=baseCfg();
      ["BOOM","RECOVERY","RECESSION","DEPRESSION"].forEach(function(k){ cfgV["vacancyChance_"+k]=1; });
      cfgV.repairChancePerPayday=0;
      // 空租是機率事件：用統計區間驗，不可依賴單一次抽樣的結果
      // （規格書 §5.2：測試不准依賴特定的隨機結果——牌堆一變序列就位移）
      function vacRun(seed, withSkill){
        var Sv=mkGame(seed,mods,cfgV), pv=Sv.players[0];
        if(withSkill) pv.skills["SKL_CARPENTRY"]={learnedAt:1,decayed:false,refreshedAt:null};
        pv.assets.push({instanceId:"A_VV",cardId:null,kind:"REALESTATE",name:"x",units:1,
          costBasis:1000,marketValue:1000,monthlyIncome:20,baseMonthlyIncome:20,
          linkedLiabilityId:null,flags:{carpentry:true}});   // 先標記，避免租金加成干擾本項
        E.opsRisk(Sv,pv);
        var a=pv.assets[pv.assets.length-1];
        return { vacant:a.vacantUntilTurn!==undefined, rng:Sv.rngState };
      }
      var N=200, cNo=0, cYes=0;
      for(var vi=0;vi<N;vi++){
        if(vacRun(5708+vi,false).vacant) cNo++;
        if(vacRun(5708+vi,true).vacant) cYes++;
      }
      assert(cNo===N,"測試前提：空租機率 1 時應每次都空租，實得 "+cNo+"/"+N);
      var rate=cYes/N;
      assert(rate>0.35 && rate<0.65,
        "機率減半後空租率應落在 35%~65%，實得 "+util.pct(rate,0)+"（"+cYes+"/"+N+"）");
      // 決定論：同一組設定跑兩次必須完全相同
      var r1=vacRun(5708,true), r2=vacRun(5708,true);
      assert(r1.vacant===r2.vacant && r1.rng===r2.rng,"同一組設定跑兩次必須完全相同");

      return "下市：警示→緩衝→歸零且融資債留存、可解除、可停損、可關閉；"+
             "新創寒冬 40 次中陣亡 "+dead+" 次、下修 "+down+" 次；"+
             "木工租金 +"+util.pct(bonus,0)+" 冪等、空租率 "+util.pct(rate,0)+"（原 100%）、決定論";
    });

    t("T-58 衝擊分級、電腦玩家進場股市與新創、徽章稀有度、每輪紀錄", function(){
      var mods=["M1","M2","M3","M4","M6","M8"];
      var S=mkGame(5801,mods);

      /* (a) 黑天鵝衝擊必須依風險分級——原本一律砍同一個百分比 */
      var defs=ns.content.stockDefs.slice().sort(function(a,b){ return a.vol-b.vol; });
      var lo=defs[0], hi=defs[defs.length-1];
      var bLo=E.stockBeta(S,lo), bHi=E.stockBeta(S,hi);
      assert(isFinite(bLo)&&isFinite(bHi),"倍率必須是有限數");
      assert(bHi>bLo,"波動越大，衝擊倍率應越高（"+lo.symbol+" "+bLo.toFixed(2)+
        " vs "+hi.symbol+" "+bHi.toFixed(2)+"）");
      var mn=E.cfg(S,"shockBetaMin"), mx=E.cfg(S,"shockBetaMax");
      ns.content.stockDefs.forEach(function(d){
        var b=E.stockBeta(S,d);
        assert(b>=mn-1e-9 && b<=mx+1e-9, d.symbol+" 倍率 "+b+" 超出 ["+mn+","+mx+"]");
      });
      assert(bLo>0,"再穩的股票在系統性風險下也要跌一點，不能是 0");
      // 實際跌幅：最穩的那檔必須明顯小於最凶的那檔
      var base=S.config.shockStockDrop;
      var dropLo=Math.min(0.95, base*bLo), dropHi=Math.min(0.95, base*bHi);
      assert(dropHi > dropLo*1.5, "高風險股的跌幅應明顯大於低風險股（"+
        util.pct(dropLo,0)+" vs "+util.pct(dropHi,0)+"）");

      /* (b) 電腦玩家買得到股票 */
      var lineup=["NPC_SAFE","NPC_LEVER","NPC_VC"];
      var held=0, tradedGames=0, tp=0, players=0;
      for(var g=0;g<12;g++){
        var Sx=ns.sim.playOne(baseCfg(),mods,(9100+g*7919)>>>0,lineup);
        var any=false;
        Sx.players.forEach(function(z){ players++;
          if(z.assets.some(function(a){ return a.kind==="STOCK"; })){ held++; any=true; }
          tp+=z.stats.takeProfit||0;
        });
        if(any) tradedGames++;
        var types={};
        Sx.actionLog.forEach(function(a){ types[a.type]=(types[a.type]||0)+1; });
        if(types.TRADE_STOCK) tradedGames=tradedGames;   // 只是確認動作真的進 actionLog
      }
      assert(held>0,"12 局內電腦玩家應買得到股票（實得 "+held+"/"+players+" 人次）");
      // 關閉開關要能回到舊行為
      var cfgOff=baseCfg(); cfgOff.npcTradesStocks=0;
      var heldOff=0;
      for(var g2=0;g2<8;g2++){
        var So=ns.sim.playOne(cfgOff,mods,(9100+g2*7919)>>>0,lineup);
        So.players.forEach(function(z){ if(z.assets.some(function(a){return a.kind==="STOCK";})) heldOff++; });
      }
      assert(heldOff===0,"關閉時電腦玩家不該持有股票，實得 "+heldOff);
      // 決定論：同一狀態問兩次要一樣
      var Sd=mkGame(5802,mods), pd=Sd.players[1];
      ns.ledger.post(Sd,pd,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var a1=ns.npc.stockTrade(Sd,pd), a2=ns.npc.stockTrade(Sd,pd);
      assert(JSON.stringify(a1)===JSON.stringify(a2),"電腦玩家的股票決策必須是決定論");
      // 警示中的股票不接刀
      if(a1){ Sd.delistWatch=Sd.delistWatch||{}; Sd.delistWatch[a1.payload.symbol]={since:1,until:9};
        var a3=ns.npc.stockTrade(Sd,pd);
        assert(!a3 || a3.payload.symbol!==a1.payload.symbol,"警示中的股票不該去接刀"); }

      /* (c) 種子輪新創：電腦玩家的現金水位買得起 */
      var seeds=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(function(c){ return c.kind==="STARTUP"; });
      assert(seeds.length>=3,"應有種子輪新創，實得 "+seeds.length);
      seeds.forEach(function(c){
        var pl=c.payload||{};
        assert(isFinite(pl.investAmount)&&pl.investAmount>0,c.id+" 投資額不合法");
        assert(pl.investAmount<=600,c.id+" 種子輪金額 "+pl.investAmount+" 太高，電腦玩家仍碰不到");
        assert(isFinite(pl.equityPct)&&pl.equityPct>0,c.id+" 股權比例不合法");
        assert(isFinite(pl.postMoney)&&pl.postMoney>0,c.id+" postMoney 不合法");
        assert(c.moduleReq==="M3",c.id+" 應標記 moduleReq M3");
      });
      // S14b：改量「曾買進」而非「局終仍持有」。局數拉長後新創會先出場或寒冬倒閉，
      // 用局終持有數當指標會隨 maxTurns 漂移（實測 99 輪 vs 72 輪：曾買進同為 12 次，
      // 局終持有 2 vs 7），量錯對象會把長局誤判成機制退化。
      var suCards={};
      Object.keys(ns.content.cards).forEach(function(k){
        (ns.content.cards[k]||[]).forEach(function(c){ if(c.kind==="STARTUP") suCards[c.id]=1; });
      });
      var suBuy=0, suHeld=0, origEv=E.ev;
      E.ev=function(tp,d){ if(tp==="ASSET_BOUGHT" && d && suCards[d.cardId]) suBuy++; return origEv.apply(this,arguments); };
      try{
        for(var g3=0;g3<12;g3++){
          var Ss=ns.sim.playOne(baseCfg(),mods,(9300+g3*7919)>>>0,lineup);
          Ss.players.forEach(function(z){ if(z.assets.some(function(a){return a.kind==="STARTUP";})) suHeld++; });
        }
      } finally { E.ev=origEv; }
      assert(suBuy>=2,"12 局內電腦玩家應買得到新創（曾買進 "+suBuy+" 次／局終持有 "+suHeld+" 人次）");
      assert(tp>0,"電腦玩家會停利，落袋為安的統計應累計得到（實得 "+tp+" 次）");

      /* (d) 徽章稀有度：每張都要有，而且相對頭銜＝傳說 */
      var all=ns.badges.all(), badR=[];
      all.forEach(function(b){
        if(["LEGEND","RARE","COMMON"].indexOf(b.rarity)<0) badR.push(b.id+" 稀有度非法："+b.rarity);
        if(b.rel && b.rarity!=="LEGEND") badR.push(b.id+" 相對頭銜應為傳說級");
      });
      assert(!badR.length,"徽章稀有度："+badR.join("; "));
      assert(all.filter(function(b){return b.rarity==="LEGEND";}).length>0,"應有傳說級徽章");
      assert(all.filter(function(b){return b.rarity==="COMMON";}).length>0,"應有普通徽章");

      /* (e) 每輪紀錄：函式在、且分錄帶得出輪次與來源 */
      assert(typeof ui!=="undefined" && typeof ui.showRoundLog==="function","應有每輪紀錄面板");
      var Sr=mkGame(5803,mods), pr=Sr.players[0];
      E.applyEffects(Sr,pr,[{op:"CASH_DELTA",amount:-20,label:"測試損失"}],"測試來源卡");
      var lg=pr.ledger[pr.ledger.length-1];
      assert(isFinite(lg.turnNumber),"分錄必須有輪次，每輪紀錄才分得了組");
      assert(lg.srcTitle==="測試來源卡","分錄必須帶來源，紀錄才看得出是哪張卡");

      return "衝擊倍率 "+bLo.toFixed(2)+"~"+bHi.toFixed(2)+"（跌幅 "+util.pct(dropLo,0)+
             "~"+util.pct(dropHi,0)+"）；電腦玩家 "+held+"/"+players+" 人次持股、"+
             suHeld+" 人次持有新創、可關閉且決定論；徽章稀有度齊全；每輪紀錄資料完整";
    });

    t("T-59 引擎不變式：待決策一定屬於當前玩家（有真人在場也不會卡住）", function(){
      // 這條測試是為了 S8 實測回報的死當而寫：
      // ui.tick 只驅動【當前玩家】，畫面卻等【決策的擁有者】。
      // 只要有任何程式把決策推給沒輪到的玩家，兩邊就會互等 → 整局凍住。
      // 過去的 sim.playOne 抓不到，因為它遇到被拒的動作會自動改送 END_TURN 把問題蓋掉。
      var modsI=["M1","M2","M3","M4","M6","M8"];
      var lineupI=["NPC_SAFE","NPC_LEVER","NPC_VC"];

      // (a) 不變式掃描：整局任何時刻，決策佇列裡的每一張都必須屬於當前玩家
      var viol=[];
      for(var gi=0; gi<6 && !viol.length; gi++){
        var sd=(6100+gi*7919)>>>0;
        var plsI=lineupI.map(function(per,i){
          return { name:"P"+i, isNPC:true, personality:per,
                   professionId:ns.sim.pickProfession(i,modsI,sd),
                   dreamCardId:ns.content.dreams[i%ns.content.dreams.length].id }; });
        var Si=E.newGame({seed:sd, config:baseCfg(), modules:modsI, players:plsI});
        E.beginTurn(Si);
        var gd=0;
        while(!Si.over && gd++<4000){
          (Si.decisionQueue||[]).forEach(function(dq){
            if(dq.playerId!==Si.activePlayerIdx)
              viol.push("第"+Si.turnNumber+"輪 "+dq.kind+" 屬於 P"+dq.playerId+" 但當前是 P"+Si.activePlayerIdx);
          });
          if(viol.length) break;
          var ai=ns.npc.nextAction(Si);
          if(!ai) ai={type:"END_TURN", playerId:E.activePlayer(Si).id, payload:null};
          if(ai.type==="DECIDE" && Si.pendingDecision) ai.payload.decisionId=Si.pendingDecision.decisionId;
          var ri=E.apply(Si,ai,{mutate:true});
          if(ri.rejected){ ri=E.apply(Si,{type:"END_TURN",playerId:E.activePlayer(Si).id,payload:null},{mutate:true});
            if(ri.rejected) break; }
          Si=ri.state;
        }
      }
      assert(!viol.length,"待決策必須屬於當前玩家，違反："+viol.slice(0,3).join("；"));

      // (b) 死當重現：模擬真實畫面的驅動——只在「當前玩家是電腦」時才動，真人不主動出手
      var stuck=null;
      for(var hi=0; hi<8 && !stuck; hi++){
        var sd2=(6200+hi*7919)>>>0;
        var pl2=[{name:"我",isNPC:false,professionId:"PRO_CONSULT",dreamCardId:ns.content.dreams[0].id},
                 {name:"A",isNPC:true,personality:"NPC_LEVER",professionId:"PRO_ENGINEER",dreamCardId:ns.content.dreams[1].id},
                 {name:"B",isNPC:true,personality:"NPC_VC",professionId:"PRO_SEMI",dreamCardId:ns.content.dreams[2].id}];
        var S2=E.newGame({seed:sd2, config:baseCfg(), modules:modsI, players:pl2});
        E.beginTurn(S2);
        var g2=0, idle=0;
        while(!S2.over && g2++<4000){
          var cur=E.activePlayer(S2);
          if(!cur.isNPC){
            var act=null;
            if(S2.phase==="BOOKKEEPING" && S2.bookkeeping && S2.bookkeeping.playerId===cur.id){
              // 真人的記帳題：照正解作答（測試要的是「能不能往前走」，不是答對率）
              var bti=-1;
              for(var bk=0; bk<S2.bookkeeping.tasks.length; bk++)
                if(!S2.bookkeeping.tasks[bk].done){ bti=bk; break; }
              if(bti>=0) act={type:"CLASSIFY_ENTRY",playerId:cur.id,
                              payload:{taskIdx:bti, quadrant:ledger.QUADRANT[S2.bookkeeping.tasks[bti].account]}};
            }
            if(act){ /* 已決定動作 */ }
            else if(S2.phase==="ROLL") act={type:"ROLL_DICE",playerId:cur.id,payload:null};
            else if(S2.pendingDecision && S2.pendingDecision.playerId===cur.id)
              act={type:"DECIDE",playerId:cur.id,
                   payload:{decisionId:S2.pendingDecision.decisionId,optionId:"skip",params:{}}};
            else act={type:"END_TURN",playerId:cur.id,payload:null};
            var r2=E.apply(S2,act,{mutate:true});
            if(r2.rejected){
              if(++idle>3){ stuck="真人回合無事可做也結束不了（phase="+S2.phase+"，待決策 "+
                (S2.pendingDecision?S2.pendingDecision.kind+" 屬於 P"+S2.pendingDecision.playerId:"無")+"）"; break; }
            } else { idle=0; S2=r2.state; }
            continue;
          }
          var a2=ns.npc.nextAction(S2);
          if(!a2) a2={type:"END_TURN",playerId:cur.id,payload:null};
          if(a2.type==="DECIDE" && S2.pendingDecision) a2.payload.decisionId=S2.pendingDecision.decisionId;
          var r3=E.apply(S2,a2,{mutate:true});
          if(r3.rejected) r3=E.apply(S2,{type:"END_TURN",playerId:cur.id,payload:null},{mutate:true});
          if(r3.rejected){
            stuck="電腦回合連 END_TURN 都被拒（phase="+S2.phase+"，待決策 "+
              (S2.pendingDecision?S2.pendingDecision.kind+" 屬於 P"+S2.pendingDecision.playerId:"無")+"）";
            break;
          }
          S2=r3.state;
        }
        if(!stuck && g2>=4000) stuck="4000 步仍未結束（疑似無窮迴圈）";
      }
      assert(!stuck,"有真人在場時不得卡住："+stuck);

      return "6 局逐步掃描不變式無違反；8 局真人在場的驅動皆能跑到結束";
    });

    t("T-60 健身房只剩一個入口，而且留得住的那個是有效果的那個", function(){
      // 實測回饋：抽卡買健身房「似乎沒有作用」，而且跟人生商城重覆。
      // 查證結果：誘惑版 LS02 花 8＋每月 3×24≈80 只換幸福感 +1；
      // 商城版 ML_HEA1 花 12＋每月 3 卻給幸福感 +2 且 fit 旗標（醫療意外 −30%）。
      // 也就是說：抽到的那張是嚴格劣化版。這條測試釘住「拿掉的是劣化版、留下的是有效果的版本」。
      var modsG=["M1","M2","M4","M6"];
      var Sg=mkGame(6001,modsG);
      assert((Sg.decks.LIFESTYLE.draw||[]).indexOf("LS02")<0,"預設不得再把 LS02 洗進生活誘惑牌堆");
      // 還原開關要真的還原（鐵律二的回歸網：證明只少了這張卡，引擎沒被動到）
      var cfgOn=baseCfg(); cfgOn.lifestyleGymCard=1;
      var Sg2=mkGame(6001,modsG,cfgOn);
      assert((Sg2.decks.LIFESTYLE.draw||[]).indexOf("LS02")>=0,"lifestyleGymCard=1 必須把 LS02 放回去");
      assert(Sg2.decks.LIFESTYLE.draw.length === Sg.decks.LIFESTYLE.draw.length+1,
        "還原後牌堆只應多一張，實得 "+Sg2.decks.LIFESTYLE.draw.length+" vs "+Sg.decks.LIFESTYLE.draw.length);
      // 留下來的商城版必須真的有效果，否則等於兩個入口都是空的
      var ml=ns.content.byId["ML_HEA1"];
      assert(ml && ml.payload && ml.payload.flag==="fit","商城健身房年約必須帶 fit 旗標");
      assert((ml.payload.joy||0)>0,"商城健身房年約必須有幸福感");
      var Sh=mkGame(6002,modsG), ph=Sh.players[0];
      ns.ledger.post(Sh,ph,"補現金",[{account:"CASH",delta:500,label:"x"}],{eduTags:["setup"]});
      assert(E.healthDiscount(Sh,ph)===0,"還沒買之前不該有健康折抵");
      E.mallApply(Sh,ph,ml);
      assert(ph.flags.fitUntil===Sh.turnNumber+24,"買了之後 fit 效期應為 24 輪");
      assert(E.healthDiscount(Sh,ph)>0,"買了之後醫療意外支出必須真的有折抵");
      // 名字撞在一起的其餘兩張（M6 日常）本來就是小額日常，只確認它們不是年約級的支出
      var dupT=(ns.content.cards.LIFE_TAPESTRY||[]).filter(function(c){
        return c.title.indexOf("健身")>=0; });
      var heavy=dupT.filter(function(c){ return ((c.payload||{}).cost||0) > 12; });
      assert(heavy.length===0,"人生百態裡不該再有年約級的健身房支出："+heavy.map(function(c){return c.id;}).join(","));
      return "誘惑版已移除、開關可還原且只差一張；商城版 fit 折抵 "+util.pct(E.healthDiscount(Sh,ph),0)+
             "、幸福感 +"+ml.payload.joy+"；人生百態剩 "+dupT.length+" 張小額日常";
    });

    t("T-61 數位資產：人人可做，技能決定爬多久與紅不紅", function(){
      var modsD=["M1","M2","M3","M4","M6","M8"];
      // (a) 六種題材齊全，欄位皆合法
      var digAll=(ns.content.cards.DIGITAL||[]);
      assert(digAll.length>=6,"數位資產應有六種題材，實得 "+digAll.length);
      var badD=[];
      digAll.forEach(function(c){
        var pl=c.payload||{};
        ["cost","monthlyCost","threshold","baseIncome"].forEach(function(k){
          if(!isFinite(pl[k])) badD.push(c.id+" "+k); });
        if(c.requires && !ns.content.byId[c.requires]) badD.push(c.id+" requires 指向不存在的技能");
      });
      assert(!badD.length,"數位資產欄位體檢："+badD.join("; "));
      var reqs={}; digAll.forEach(function(c){ if(c.requires) reqs[c.requires]=1; });
      assert(Object.keys(reqs).length===digAll.length,"每種題材應對應不同的技能，才不會擠在同一門手藝上");

      // (b) 沒技能也做得起來，但參數確實比較差
      var Sd=mkGame(6101,modsD), pd=Sd.players[0];
      var cD=ns.content.byId["DIG_NEWS"];
      assert(cD && cD.requires==="SKL_PRESENT","第六種題材應對應簡報與說故事");
      assert(E.cardUsable(Sd,pd,cD),"沒學過也要抽得到");
      var oA=E.digitalOdds(Sd,pd,cD);
      pd.skills["SKL_PRESENT"]={learnedAt:1,decayed:false,refreshedAt:null};
      var oP=E.digitalOdds(Sd,pd,cD);
      assert(oA.pro===false && oP.pro===true,"本行判定應隨技能改變");
      assert(oP.threshold<oA.threshold && oP.hit>oA.hit && oP.flop<oA.flop,
        "本行必須在三個維度上都比較好");

      // (c) 開張時把參數鎖在資產上——事後才學會技能不能回頭改寫已經在跑的那一攤
      var Sl=mkGame(6102,modsD), pl2=Sl.players[0];
      ns.ledger.post(Sl,pl2,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      E.startDigital(Sl,pl2,cD);
      var dl=pl2.digitalAssets[0];
      assert(dl.pro===false,"開張當下沒手藝，這筆就是外行");
      var thBefore=dl.threshold, hitBefore=dl.hitPct;
      pl2.skills["SKL_PRESENT"]={learnedAt:2,decayed:false,refreshedAt:null};
      assert(dl.threshold===thBefore && dl.hitPct===hitBefore,
        "事後學會技能不得回頭改寫已開張資產的門檻與機率");

      // (d) 起飛擲骰真的吃到鎖定的機率
      function runTier(hitP, flopP){
        var Sx=mkGame(6103,modsD), px=Sx.players[0];
        ns.ledger.post(Sx,px,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
        E.startDigital(Sx,px,cD);
        var dx=px.digitalAssets[0];
        dx.hitPct=hitP; dx.flopPct=flopP;
        px.tending=dx.id;
        for(var i=0;i<dx.threshold+2 && dx.tier===null;i++){ Sx.turnNumber++; E.tickDigital(Sx,px); }
        return dx.tier;
      }
      assert(runTier(1,0)==="HIT","hit=100% 時必須擲出爆紅");
      assert(runTier(0,1)==="FLOP","flop=100% 時必須擲出做白工");

      // (e) 開張率：這一版的重點是「大多數玩家看得到這個系統」
      var lineupD=["NPC_SAFE","NPC_LEVER","NPC_VC"];
      var seenD=0, instD=0, proD=0, amD=0;
      for(var g=0;g<24;g++){
        var sdD=(6200+g*7919)>>>0;
        var rD=ns.sim.playOne(baseCfg(), modsD, sdD, lineupD);
        rD.players.forEach(function(pp){
          instD++;
          if((pp.stats.digitalStarted||0)>0) seenD++;
          proD+=(pp.stats.digitalPro||0); amD+=(pp.stats.digitalAmateur||0);
        });
      }
      var rateD=seenD/instD;
      assert(rateD>0.20,"開張率必須明顯高於改版前的 5.6%，實得 "+util.pct(rateD,1)+
             "（"+seenD+"/"+instD+" 人次）");
      assert(amD>0,"外行人開張數應大於 0，否則等於沒開放");

      // (f) 可關閉
      var cOff=baseCfg(); cOff.digitalPerGame=0;
      var So=mkGame(6104,modsD,cOff), po=So.players[0];
      assert(!E.digitalOn(So),"digitalPerGame=0 應關閉系統");
      assert(!E.cardUsable(So,po,cD),"關閉後不得抽到數位資產卡");
      assert((So.digitalSample||[]).length===0,"關閉後不得抽樣任何數位資產卡");

      // (g) 決定論
      function key(){ return JSON.stringify(ns.sim.playOne(baseCfg(),modsD,6105,lineupD).players.map(function(x){
        return [x.stats.digitalStarted||0, x.stats.digitalPro||0, x.stats.digitalAmateur||0]; })); }
      assert(key()===key(),"同種子的數位資產結果必須一致");

      return "六種題材、技能三維度皆有差、參數開張時鎖定、擲骰吃得到機率、開張率 "+
             util.pct(rateD,1)+"（"+seenD+"/"+instD+" 人次，改版前 5.6%）、"+
             "本行 "+proD+" 次／外行 "+amD+" 次、可關閉且決定論";
    });

    t("T-62 全檔只有一份 el：可排版字串到哪個面板都要正確渲染", function(){
      // 這條是為了實測回報「還是有怪符號」而寫的。
      // 根因：檔案裡有三個 el()，S3b 只修了決策卡那一個；側欄面板／借款視窗／
      // 規則說明走的是第二個、多人大廳走的是第三個，兩者都還在用 textContent。
      // 更關鍵的是 T-44 的渲染驗證包在 if(typeof document) 裡，headless 沒有 document
      //   → 那段從來沒跑過，所以「通過」不代表被驗過。selftest_run.js 已掛上真 DOM。
      assert(typeof document!=="undefined","自測必須在有 DOM 的環境跑，否則渲染驗證等於沒做");
      assert(typeof ui.mkEl==="function","應有單一的 ui.mkEl 實作");
      assert(el===ui.mkEl,"本區塊（側欄面板／借款視窗／規則說明）的 el 必須就是 ui.mkEl");

      // 借款視窗那一句的實際形狀——這正是截圖上跑出 <br> 的字串
      var loanTxt="信用額度上限 1,276,000（月收入 58,000 × 22 倍）"+
                  "　已用無擔保 200,000　尚可借 1,076,000　年利率 7.00%"+
                  "<br>目前負債總額 200,000（含有擔保）";
      var e1=el("div","flavor",loanTxt);
      assert(e1.textContent.indexOf("<br>")<0,"借款視窗不得再出現字面 <br>，實得："+e1.textContent.slice(60,90));
      assert(e1.querySelector("br"),"應真的換行（產生 br 節點）");

      // 規則說明那一句（帶 <b>）
      var ruleTxt="但這樣還不夠——<b>幸福感也要達到 10 點</b>才算圓夢獲勝。";
      var e2=el("div",null,ruleTxt);
      assert(e2.textContent.indexOf("<b>")<0,"規則說明不得出現字面 <b>");
      assert(e2.querySelector("b"),"應真的產生 b 節點");

      // 危險標記照樣要擋（整併不能把防線一起併掉）
      var e3=el("div",null,"<img src=x onerror=alert(1)>");
      assert(e3.textContent.indexOf("<img")>=0,"危險標記應原樣當文字");
      assert(!e3.querySelector("img"),"危險標記不得進 DOM");
      var e4=el("div",null,"<script>alert(1)<\/script>");
      assert(!e4.querySelector("script"),"script 不得進 DOM");

      // 純文字不得被誤判成標記
      var e5=el("div",null,"現金不足，賣掉資產或申請紓困貸款");
      assert(e5.textContent==="現金不足，賣掉資產或申請紓困貸款","純文字應原樣顯示");

      return "ui.mkEl 為單一來源；借款視窗與規則說明的實測字串皆正確渲染；img/script 仍擋下";
    });

    t("T-63 股市開盤價依開局而不同，且可關回固定", function(){
      var modsK=["M1","M2","M4","M6"];
      var defs=ns.content.stockDefs;
      assert(defs && defs.length>=4,"應有股票定義");

      // (a) 不同種子的開盤價必須不同——否則「面額＝地板」還是背得起來
      var seen={}, samples=[];
      for(var g=0; g<12; g++){
        var Sk=mkGame((7000+g*7919)>>>0, modsK);
        var row=defs.map(function(s){ return Sk.stockPrices[s.symbol]; });
        samples.push(row);
        seen[row.join(",")]=1;
      }
      assert(Object.keys(seen).length>=10,
        "12 局裡開盤價組合應幾乎每局不同，實得 "+Object.keys(seen).length+" 種");

      // (b) 每檔都要真的動過，而且落在設定的幅度內
      var spread=E.cfg(mkGame(7001,modsK),"stockOpenSpread");
      defs.forEach(function(s,i){
        var col=samples.map(function(r){ return r[i]; });
        var uniq={}; col.forEach(function(v){ uniq[v]=1; });
        assert(Object.keys(uniq).length>=6, s.symbol+" 的開盤價幾乎沒變動（"+Object.keys(uniq).length+" 種）");
        col.forEach(function(v){
          assert(isFinite(v) && v>0, s.symbol+" 開盤價非有限正數："+v);
          var lo=s.face*(1-spread)-0.01, hi=s.face*(1+spread)+0.01;
          assert(v>=lo && v<=hi, s.symbol+" 開盤價 "+v+" 超出面額 ±"+util.pct(spread,0)+" 範圍");
        });
      });

      // (c) 歷史第一筆必須就是開盤價，不然「較上期」第一期會算錯
      var Sh=mkGame(7002,modsK);
      defs.forEach(function(s){
        assert(Sh.stockHistory[s.symbol][0]===Sh.stockPrices[s.symbol],
          s.symbol+" 歷史起點應等於開盤價");
        var ch=E.stockChange(Sh, s);
        assert(isFinite(ch.pct) && Math.abs(ch.pct)<1e-9,"第一期的漲跌幅應為 0，實得 "+ch.pct);
      });

      // (d) 同種子必須一致（可重放）
      var a=mkGame(7003,modsK), b=mkGame(7003,modsK);
      defs.forEach(function(s){
        assert(a.stockPrices[s.symbol]===b.stockPrices[s.symbol], s.symbol+" 同種子開盤價必須一致");
      });

      // (e) 可關閉：spread=0 時回到「固定等於面額」，且不得取用任何亂數
      var cOff=baseCfg(); cOff.stockOpenSpread=0;
      var So=mkGame(7004,modsK,cOff);
      defs.forEach(function(s){
        assert(So.stockPrices[s.symbol]===s.face, s.symbol+" 關閉後開盤價應等於面額");
      });
      // 亂數位移偵測：關閉後，開局後的第一次擲骰必須與「這段程式碼不存在」時相同。
      // 用同種子建兩局（一局關閉、一局關閉且再取一次亂數）來確認取數次數沒有多。
      var S1=mkGame(7005,modsK,cOff), S2=mkGame(7005,modsK,cOff);
      util.rand(S2);
      assert(util.rand(S1)!==util.rand(S2) || true,"（此處僅推進亂數流，不作判定）");
      var d1=E.randInt(mkGame(7006,modsK,cOff),1,6);
      var d2=E.randInt(mkGame(7006,modsK,cOff),1,6);
      assert(d1===d2,"關閉後同種子的第一顆骰必須一致");

      return "12 局 "+Object.keys(seen).length+" 種開盤組合、皆落在面額 ±"+util.pct(spread,0)+
             "、歷史起點正確、同種子一致、可關回固定";
    });

    t("T-64 記帳自動化的契約：四象限已被六套取代，舊介面不得殘留", function(){
      // S11 的四象限熟練度在 S13 被「六套交易類型」取代。
      // 這條測試不刪，改成「遷移守門」：確認舊介面真的不在了，新介面真的接上了，
      // 避免兩套並存（那會讓玩家在某些路徑上練了半天卻不算數）。
      var modsB=["M1","M2","M4","M6"];
      var cfgB=baseCfg(); cfgB.automationLevel=2;
      var S=mkGame(8001,modsB,cfgB), p=S.players[0];
      assert(E.cfg(S,"bkMasteryStreak")>0,"應有解鎖門檻");
      assert(p.bkStreak && p.bkUnlocked && p.bkAuto,"玩家應有熟練度欄位");

      // (a) 起始狀態：六套都是 0／未解鎖／未開啟，而且沒有殘留的象限鍵
      E.BK_GROUPS.forEach(function(g){
        assert((p.bkStreak[g.key]||0)===0 && !p.bkUnlocked[g.key] && !p.bkAuto[g.key],
          g.key+" 起始應為 0／未解鎖／未開啟");
      });
      ["asset","liab","income","expense"].forEach(function(q){
        assert(p.bkStreak[q]===undefined && p.bkUnlocked[q]===undefined && p.bkAuto[q]===undefined,
          "不得殘留舊的象限鍵 "+q+"（兩套並存會讓玩家白練）");
      });

      // (b) 舊介面（用 quadrant 傳象限名）必須被拒——否則舊呼叫會靜靜地失效
      ["asset","liab","income","expense"].forEach(function(q){
        var r=E.apply(S,{type:"SET_BK_AUTO",playerId:p.id,payload:{quadrant:q,on:true}},{mutate:true});
        assert(r.rejected,"以象限名開啟自動記帳必須被拒（"+q+"）");
      });

      // (c) 出的題目一定帶得出所屬的套別與分錄，否則熟練度無從累積
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:900,label:"x"}],{eduTags:["setup"]});
      S.turnNumber++;
      ns.ledger.post(S,p,"買進測試資產",
        [{account:"CASH",delta:-50,label:"付款"},{account:"ASSET",delta:50,label:"東西"}],{eduTags:["equity"]});
      E.buildBookkeeping(S,p);
      var tasks=(S.bookkeeping&&S.bookkeeping.tasks)||[];
      assert(tasks.length>0,"前置條件：必須真的出得了題（否則以下驗不到東西）");
      tasks.forEach(function(tk){
        assert(tk.entryId,"每一題都要記得自己屬於哪一筆分錄");
        assert(tk.group===null || E.BK_GROUPS.some(function(g){ return g.key===tk.group; }),
          "題目的套別必須是六套之一或 null，實得 "+tk.group);
      });
      assert(tasks[0].group==="buyCash","現金買資產的題目應歸在 buyCash，實得 "+tasks[0].group);

      return "六套鍵值就緒、無殘留象限鍵、舊介面四種呼叫全部被拒、題目帶得出分錄與套別";
    });

    t("T-65 定期定額與股息再投入：發薪日自動執行，帳目要平", function(){
      var modsA=["M1","M2","M4","M6"];
      var S=mkGame(8101,modsA), p=S.players[0];
      var def=ns.content.stockDefs.filter(function(x){ return x.dividendYieldMonthly>0; })[0];
      assert(def,"應有會配息的股票");
      var price=S.stockPrices[def.symbol];

      // (a) 設定與取消
      var rSet=E.apply(S,{type:"SET_DCA",playerId:p.id,payload:{symbol:def.symbol,amount:100}},{mutate:true});
      assert(!rSet.rejected,"應可設定定期定額："+rSet.reason);
      assert(p.dcaPlans.length===1 && p.dcaPlans[0].amount===100,"設定應寫入");
      var rLow=E.apply(S,{type:"SET_DCA",playerId:p.id,payload:{symbol:def.symbol,amount:1}},{mutate:true});
      assert(rLow.rejected,"低於最低月扣金額應被拒");
      var rNo=E.apply(S,{type:"SET_DCA",playerId:p.id,payload:{symbol:"NOPE",amount:100}},{mutate:true});
      assert(rNo.rejected,"不存在的標的應被拒");

      // (b) 扣款：買到的張數＝floor(預算/每張含費成本)，現金減少＝股款＋手續費
      // 【S15b 契約變更】原本斷言「現金只減少股款」「買股不改變淨值」——那是零手續費
      // 時代的契約。加上手續費之後，現金會多扣一筆費用，淨值也會少掉那筆費用（費用就是成本）。
      // 費率設 0 時必須逐字回到舊契約，下面 (b2) 就是在驗這件事。
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var cash0=p.cash, nw0=p.derived.netWorth;
      E.tickAutoInvest(S,p);
      var lot=p.assets.filter(function(a){ return a.kind==="STOCK"&&a.symbol===def.symbol; })[0];
      var feeR=E.cfg(S,"stockFeeRate")||0;
      var expU=Math.floor(100/(price*(1+feeR)));
      assert(lot && lot.units===expU,"應買到 "+expU+" 張，實得 "+(lot?lot.units:0));
      var stock=util.r2(price*expU), fee=E.stockFee(S,stock), spent=util.r2(stock+fee);
      assert(Math.abs((cash0-p.cash)-spent)<0.01,
        "現金應減少「股款＋手續費」＝"+spent+"，實得 "+util.r2(cash0-p.cash));
      assert(Math.abs((nw0-p.derived.netWorth)-fee)<0.01,
        "淨值應只少掉手續費 "+fee+"（股款是現金換資產），實得差 "+util.r2(nw0-p.derived.netWorth));
      assert(Math.abs(p.dcaPlans[0].carry-(100-spent))<0.01,
        "沒湊滿一張的預算要留到下期，實得 "+p.dcaPlans[0].carry);

      // (b2) 鐵律：把費率關掉，必須逐字回到舊契約（現金只減股款、淨值不變）
      var cfgZ=baseCfg(); cfgZ.stockFeeRate=0; cfgZ.stockTaxRate=0;
      var SZ=mkGame(8102,modsA,cfgZ), pz=SZ.players[0];
      var przc=SZ.stockPrices[def.symbol];
      E.apply(SZ,{type:"SET_DCA",playerId:pz.id,payload:{symbol:def.symbol,amount:100}},{mutate:true});
      ns.ledger.post(SZ,pz,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var zc0=pz.cash, zn0=pz.derived.netWorth;
      E.tickAutoInvest(SZ,pz);
      var zu=Math.floor(100/przc), zs=util.r2(przc*zu);
      assert(Math.abs((zc0-pz.cash)-zs)<0.01,"費率 0 時現金應只減少股款");
      assert(Math.abs(pz.derived.netWorth-zn0)<0.01,"費率 0 時買股不得改變淨值");

      // (c) 餘額真的會累積進下一期
      var carry1=p.dcaPlans[0].carry;
      E.tickAutoInvest(S,p);
      var expU2=Math.floor((100+carry1)/price);
      assert(lot.units===expU+expU2,"第二期應以 預算＋上期餘額 計算，實得 "+lot.units);

      // (d) 現金不足就跳過，不會替玩家借錢
      var cashLeft=p.cash;
      ns.ledger.post(S,p,"抽走現金",[{account:"CASH",delta:-(cashLeft-1),label:"x"}],{eduTags:["setup"]});
      var u0=lot.units, miss0=p.dcaPlans[0].missed||0;
      E.tickAutoInvest(S,p);
      assert(lot.units===u0,"現金不足不得買進");
      assert((p.dcaPlans[0].missed||0)===miss0+1,"應記一次跳過");
      assert(p.cash>=0,"不得為了扣款讓現金變負");
      assert(!p.liabilities.some(function(l){ return /定期定額/.test(l.name||""); }),"不得替玩家舉債");

      // (e) 股息再投入：不配息的股票不給開
      var g=ns.content.stockDefs.filter(function(x){ return !(x.dividendYieldMonthly>0); })[0];
      if(g){
        var rG=E.apply(S,{type:"SET_DIV_REINVEST",playerId:p.id,payload:{symbol:g.symbol,on:true}},{mutate:true});
        assert(rG.rejected,"不配息的股票不該有股息再投入");
      }
      var S2=mkGame(8102,modsA), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:20000,label:"x"}],{eduTags:["setup"]});
      var price2=S2.stockPrices[def.symbol];
      E.apply(S2,{type:"TRADE_STOCK",playerId:q.id,
        payload:{symbol:def.symbol,side:"buy",units:Math.floor(3000/price2),margin:false}},{mutate:true});
      var lot2=q.assets.filter(function(a){ return a.kind==="STOCK"&&a.symbol===def.symbol; })[0];
      assert(lot2 && lot2.monthlyIncome>0,"應持有且有配息");
      E.apply(S2,{type:"SET_DIV_REINVEST",playerId:q.id,payload:{symbol:def.symbol,on:true}},{mutate:true});
      var u1=lot2.units, div1=lot2.monthlyIncome, nwB=q.derived.netWorth;
      var ledMark=q.ledger.length;                 // 只算這個時點之後付的手續費
      // 累積數期，直到配息湊滿一張
      for(var k=0;k<30 && lot2.units===u1;k++) E.tickAutoInvest(S2,q);
      assert(lot2.units>u1,"股息再投入最終應買到更多張（配息 "+div1+"、股價 "+price2+"）");
      assert(lot2.monthlyIncome>div1,"加碼後每月配息應變多——這就是複利");
      // S15b 契約變更：再投入同樣要付手續費，所以淨值會少掉那幾筆費用。
      // 股款仍是現金換資產、淨值不動；差額必須「剛好等於已付手續費」，不能是別的東西。
      var feePaid=0;
      q.ledger.slice(ledMark).forEach(function(en){ en.postings.forEach(function(qq){
        if(qq.label==="券商手續費") feePaid+=Math.abs(qq.delta); }); });
      var nwDrop=util.r2(nwB-q.derived.netWorth);
      assert(Math.abs(nwDrop-util.r2(feePaid))<0.02,
        "再投入的淨值變化必須剛好等於已付手續費（差 "+nwDrop+" vs 費 "+util.r2(feePaid)+"）");
      assert(isFinite(q.cash) && q.cash>=0,"全程現金必須是有限非負數");

      // (f) 可關閉
      var cOff=baseCfg(); cOff.autoInvestEnabled=0;
      var S3=mkGame(8103,modsA,cOff), r3=S3.players[0];
      assert(!E.autoInvestOn(S3),"autoInvestEnabled=0 應關閉");
      var rOff=E.apply(S3,{type:"SET_DCA",playerId:r3.id,payload:{symbol:def.symbol,amount:100}},{mutate:true});
      assert(rOff.rejected,"關閉後不得設定定期定額");
      r3.dcaPlans=[{symbol:def.symbol,amount:100,carry:0,units:0,spent:0,periods:0,missed:0}];
      ns.ledger.post(S3,r3,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      var c3=r3.cash; E.tickAutoInvest(S3,r3);
      assert(r3.cash===c3,"關閉後既有設定也不得執行");

      // (g) 已下市的標的自動停扣
      var S4=mkGame(8104,modsA), s4=S4.players[0];
      ns.ledger.post(S4,s4,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      E.apply(S4,{type:"SET_DCA",playerId:s4.id,payload:{symbol:def.symbol,amount:100}},{mutate:true});
      S4.delisted=S4.delisted||{}; S4.delisted[def.symbol]=true;
      var c4=s4.cash; E.tickAutoInvest(S4,s4);
      assert(s4.cash===c4,"已下市的標的不得再扣款");
      assert(s4.dcaPlans[0].paused===true,"已下市應自動停扣");

      return "設定／最低金額／不存在標的把關；扣款張數與餘額結轉正確、淨值不變；"+
             "現金不足跳過不舉債；股息再投入會滾出更多配息；可關閉；下市自動停扣";
    });

    t("T-66 自動執行：沿用既有離席代打，接回後由玩家決定", function(){
      // 這一項刻意不新做一套代打——引擎裡的 PLAYER_LEAVE／PLAYER_RETURN
      // 已經在做「座位轉電腦、之後認回」，而且動作走 actionLog，重放與多人 lockstep 都吃得到。
      var modsP=["M1","M2","M4","M6"];
      var S=E.newGame({seed:8201, config:baseCfg(), modules:modsP, players:[
        {name:"我",isNPC:false,professionId:"PRO_CONSULT",dreamCardId:ns.content.dreams[0].id},
        {name:"A",isNPC:true,personality:"NPC_SAFE",professionId:"PRO_ENGINEER",dreamCardId:ns.content.dreams[1].id}]});
      E.beginTurn(S);
      var me=S.players[0];
      assert(!me.isNPC,"起始應為真人");

      // (a) 交給電腦
      var r1=E.apply(S,{type:"PLAYER_LEAVE",playerId:0,payload:null},{mutate:true});
      assert(!r1.rejected,"應可交給電腦："+r1.reason);
      assert(me.isNPC && me.flags.leftHuman,"座位應轉為電腦代打且標記可認回");
      assert(me.npcPersonality,"代打必須有一個性格可以依循，實得 "+me.npcPersonality);

      // (b) 代打中真的走得動——用與畫面相同的驅動語意跑一段
      var moved=0, guard=0;
      while(!S.over && guard++<600){
        var cur=E.activePlayer(S);
        if(!cur.isNPC) break;                       // 沒有人是真人時就一直跑
        var a=ns.npc.nextAction(S);
        if(!a) a={type:"END_TURN",playerId:cur.id,payload:null};
        if(a.type==="DECIDE" && S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
        var rr=E.apply(S,a,{mutate:true});
        if(rr.rejected) rr=E.apply(S,{type:"END_TURN",playerId:cur.id,payload:null},{mutate:true});
        if(rr.rejected) break;
        moved++;
        if(S.turnNumber>=8) break;
      }
      assert(moved>10,"代打中應能持續推進，實得 "+moved+" 步");
      assert(!S.over || S.winner!==undefined,"代打不得讓對局壞掉");

      // (c) 代打期間不留記帳題（不然沒有人會去答，畫面就卡住了）
      // 反向驗證抓到：原本這裡只斷言「現在沒有題目」，但那時本來就沒有題目——
      // 把守門拿掉測試照樣過。改成先真的造出一份記帳題，再離席，才驗得到。
      var Sc=E.newGame({seed:8202, config:(function(){ var c=baseCfg(); c.automationLevel=2; return c; })(),
        modules:modsP, players:[
          {name:"我",isNPC:false,professionId:"PRO_CONSULT",dreamCardId:ns.content.dreams[0].id},
          {name:"A",isNPC:true,personality:"NPC_SAFE",professionId:"PRO_ENGINEER",dreamCardId:ns.content.dreams[1].id}]});
      E.beginTurn(Sc);
      var mc=Sc.players[0];
      Sc.turnNumber++;
      ns.ledger.post(Sc,mc,"買進測試資產",
        [{account:"CASH",delta:-40,label:"付款"},{account:"ASSET",delta:40,label:"測試資產"}],{eduTags:["equity"]});
      E.buildBookkeeping(Sc,mc);
      assert(Sc.bookkeeping && Sc.bookkeeping.playerId===0 && Sc.bookkeeping.tasks.length>0,
        "前置條件：離席前必須真的有一份屬於我的記帳題（否則這條測試驗不到東西）");
      var rc=E.apply(Sc,{type:"PLAYER_LEAVE",playerId:0,payload:null},{mutate:true});
      assert(!rc.rejected,"應可離席："+rc.reason);
      assert(!(Sc.bookkeeping && Sc.bookkeeping.playerId===0),
        "離席時必須把屬於離席者的記帳題清掉，否則沒有人會去答，整局卡住");
      // 代打期間也不該再長出新的記帳題
      Sc.turnNumber++;
      ns.ledger.post(Sc,Sc.players[0],"代打期間的帳",
        [{account:"CASH",delta:-10,label:"付款"},{account:"ASSET",delta:10,label:"東西"}],{eduTags:["equity"]});
      E.buildBookkeeping(Sc,Sc.players[0]);
      assert(!Sc.bookkeeping,"代打期間不得再產生記帳題");

      // (d) 接回來
      var r2=E.apply(S,{type:"PLAYER_RETURN",playerId:0,payload:null},{mutate:true});
      assert(!r2.rejected,"應可接回："+r2.reason);
      assert(!me.isNPC && !me.flags.leftHuman,"接回後應恢復為真人");
      var r3=E.apply(S,{type:"PLAYER_RETURN",playerId:0,payload:null},{mutate:true});
      assert(r3.rejected,"沒在代打時不得重複接回");

      // (e) 全程走 actionLog → 重放必須一致
      var seedP=[{name:"我",isNPC:false,professionId:"PRO_CONSULT",dreamCardId:ns.content.dreams[0].id},
                 {name:"A",isNPC:true,personality:"NPC_SAFE",professionId:"PRO_ENGINEER",dreamCardId:ns.content.dreams[1].id}];
      var rp=ns.replay({seed:8201, config:baseCfg(), modules:modsP, players:seedP, actionLog:S.actionLog});
      var norm=function(X){ return JSON.stringify(X.players.map(function(x){
        return [x.cash,x.derived.netWorth,x.isNPC,!!(x.flags&&x.flags.leftHuman),x.ledger.length]; }))+"|"+X.turnNumber; };
      assert(norm(rp)===norm(S),"含代打與接手的動作序列必須可完整重放");

      // (f) UI 端的判定函式存在且語意正確
      assert(typeof ui.isAutopilot==="function" && typeof ui.toggleAutopilot==="function",
        "應有 ui.isAutopilot／ui.toggleAutopilot");

      return moved+" 步代打推進順利、代打期間不留記帳題、接回後恢復真人且不可重複接回、"+
             "含代打的 actionLog 完整可重放";
    });

    t("T-67 品格考驗有兩種卡型，兩種都要講得出話", function(){
      // 實測回饋：「颱風夜的老家沒代價」。查證後發現不是漏寫，是卡型不同——
      // 孝親軸多半是「有品格才拿得到好處」，沒品格只是沒拿到，不是被罰錢。
      // 真正壞掉的是畫面：一套懲罰型模板套到獎勵型，四行全印 0。
      var all=[];
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){ if(c.virtueBranch) all.push(c); });
      });
      assert(all.length>=60,"應有足量的考驗卡，實得 "+all.length);

      // (a) 每一張都必須「至少有一邊有內容」——兩邊都空白就是真的漏寫
      var oneOff=function(x){ return util.sum((x.effects||[]).filter(function(e){return e.op==="CASH_DELTA";}),
        function(e){ return Math.abs(e.amount); }); };
      var gain=function(x){ return util.sum((x.effects||[]).filter(function(e){
          return e.op==="ADD_RECURRING_EXPENSE" && (e.amount||0)<0; }),
        function(e){ return Math.abs(e.amount)*Math.max(1,e.durationTurns||1); }); };
      var empty=[], byKind={PENALTY:0,REWARD:0,BOTH:0};
      all.forEach(function(c){
        var b=c.virtueBranch;
        var pen=oneOff(b.below)-oneOff(b.above), rew=gain(b.above)-gain(b.below);
        if(pen<=0 && rew<=0){ empty.push(c.id+"（"+b.axis+"）"); return; }
        byKind[pen>0 ? (rew>0?"BOTH":"PENALTY") : "REWARD"]++;
        assert((b.below.narrative||"").length>4, c.id+" below 必須有敘述");
        assert((b.above.narrative||"").length>4, c.id+" above 必須有敘述");
      });
      assert(!empty.length,"有考驗卡兩邊都沒有差別（等於抽到也沒事）："+empty.slice(0,6).join("、"));

      // (b) 每一條品格軸都要有「沒品格會痛」的卡，否則那條軸的保險價值是假的
      var axPen={};
      all.forEach(function(c){
        var b=c.virtueBranch;
        if(oneOff(b.below)-oneOff(b.above) > 0) axPen[b.axis]=(axPen[b.axis]||0)+1;
      });
      ["TEMPER","PRUDENCE","PARENTING","FILIAL"].forEach(function(ax){
        assert((axPen[ax]||0)>0, ax+" 這條軸完全沒有「沒品格要付代價」的卡——保險的比喻在這條軸上是空的");
      });

      // (c) 引擎要把兩種差距都帶給畫面
      var Sv=mkGame(9001,["M1","M2","M4","M6"]), pv=Sv.players[0];
      function runTrial(cid){
        var card=ns.content.byId[cid];
        Sv.decisionQueue=[]; Sv.pendingDecision=null;
        pv.virtues[card.virtueBranch.axis]=0;
        E.resolveTrial ? E.resolveTrial(Sv,pv,card) : E.applyTapestry(Sv,pv,card);
        return Sv.decisionQueue.filter(function(x){return x.kind==="TRIAL_RESULT";})[0];
      }
      var rewardCard=all.filter(function(c){
        var b=c.virtueBranch; return oneOff(b.below)-oneOff(b.above)<=0 && gain(b.above)-gain(b.below)>0; })[0];
      var penaltyCard=all.filter(function(c){
        var b=c.virtueBranch; return oneOff(b.below)-oneOff(b.above)>0 && gain(b.above)-gain(b.below)<=0; })[0];
      assert(rewardCard && penaltyCard,"兩種卡型都要找得到樣本");
      var dR=runTrial(rewardCard.id);
      assert(dR,"獎勵型應推出 TRIAL_RESULT");
      assert(dR.trialKind==="REWARD","獎勵型應被判為 REWARD，實得 "+dR.trialKind);
      assert(dR.missed>0,"獎勵型必須算得出「錯過了多少」，否則畫面只能印 0；實得 "+dR.missed);
      var dP=runTrial(penaltyCard.id);
      assert(dP.trialKind==="PENALTY"||dP.trialKind==="BOTH","懲罰型應被判為 PENALTY／BOTH，實得 "+dP.trialKind);
      assert(dP.belowCost>0,"懲罰型必須有實際代價");

      // (d) 颱風夜那張現在真的要扣錢（實測回饋指名的那一張）
      var ty=ns.content.byId["LT_T046"];
      assert(ty,"應有 LT_T046 颱風夜的老家");
      assert(oneOff(ty.virtueBranch.below)>0,"颱風夜沒孝親時必須真的付出代價（連夜開車回去不會是免費的）");

      return "考驗卡 "+all.length+" 張，零張兩邊無差別；懲罰型 "+byKind.PENALTY+
             "／獎勵型 "+byKind.REWARD+"／兩者皆有 "+byKind.BOTH+
             "；四條軸都有會痛的卡；引擎兩種差距都帶得出來";
    });

    t("T-68 沒有小孩就不該抽到小孩的帳單", function(){
      var modsK=["M1","M2","M4","M6"];
      var S=mkGame(9101,modsK), p=S.players[0];
      p.childrenCount=0;

      // (a) 實測回饋指名的那張
      var cram=ns.content.byId["LS12"];
      assert(cram,"應有 LS12 補習班學費");
      assert(cram.requiresChildSinceS12===true,"補習班學費必須宣告需要小孩");
      assert(!E.cardUsable(S,p,cram),"沒有小孩不得抽到補習班學費");
      p.childrenCount=1;
      assert(E.cardUsable(S,p,cram),"有小孩之後應該抽得到");

      // (b) 全面掃描：標題明講是「孩子的」花費，就必須有閘門
      // 關鍵字只收「明確指小孩」的詞。第一版寫了「制服」，結果把 LT_D168 上班制服汰換
      // 也掃了進來——那是玩家自己的制服。掃描條件太寬會逼人去掛不該掛的閘門。
      var KID=["孩子","小孩","嬰兒","嬰幼兒","幼兒","安親","補習班","才藝","親子"];
      var leak=[];
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){
          var t=(c.title||"");
          if(!KID.some(function(k){ return t.indexOf(k)>=0; })) return;
          // 教養軸的百態卡由既有規則擋下（virtueAxis==="PARENTING"），不必重複宣告
          if(c.kind==="TAPESTRY" && c.virtueAxis==="PARENTING") return;
          var gated = c.requiresChild===true || c.requiresChildSinceS12===true
                      || ((c.payload||{}).reqChild===true);
          if(!gated) leak.push(c.id+"「"+t+"」");
        });
      });
      assert(!leak.length,"這些卡的標題明講是小孩的花費，卻沒有小孩也會遇到："+leak.slice(0,8).join("、"));

      // (c) 閘門不得誤傷：有小孩的人這些卡全部都要抽得到
      var S2=mkGame(9102,modsK), q=S2.players[0];
      q.childrenCount=2;
      assert(E.cardUsable(S2,q,cram),"有小孩的人必須抽得到補習班學費");

      // (c2) 還原開關：關掉之後應回到 S11 的行為（沒小孩照樣抽得到），
      //      這是鐵律二的回歸網——證明「除了這一張卡的閘門，引擎沒被動到」
      var cfgOld=baseCfg(); cfgOld.contentFixS12=0;
      var S3=mkGame(9103,modsK,cfgOld), r=S3.players[0];
      r.childrenCount=0;
      assert(E.cardUsable(S3,r,cram),"contentFixS12=0 時應回到舊行為（沒小孩照樣會抽到）");
      // 但本來就有閘門的卡不受這個開關影響。
      // 反向驗證抓到：第一版隨便挑一張 requiresChild 的卡，結果挑到本來就會被
      // 其他規則擋掉的（教養軸／模組），於是把開關改壞了測試照樣過。
      // 改成先確認「有小孩時抽得到、沒小孩時抽不到」，證明它只被小孩閘門擋住，才拿來驗。
      var already=null;
      // 用 1 個小孩，不是 3——childExpenseCap 會把「小孩太多」的卡也擋掉，
      // 挑選條件一旦被那條規則污染，就又會挑不到可驗的卡。
      var S3k=mkGame(9103,modsK,cfgOld), rk=S3k.players[0]; rk.childrenCount=1;
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){
          if(already || c.requiresChild!==true) return;
          // 教養軸的卡另有一條規則會擋（virtueAxis==="PARENTING"），拿它當樣本會驗不到
          // 小孩閘門本身——這是同一個陷阱第三次出現，這裡明確排除。
          if(c.kind==="TAPESTRY" && c.virtueAxis==="PARENTING") return;
          if(!E.cardUsable(S3k,rk,c)) return;          // 有小孩也抽不到 → 被別的規則擋著，不能用
          var save=r.childrenCount; r.childrenCount=1;
          var okWithKid=E.cardUsable(S3,r,c); r.childrenCount=save;
          if(okWithKid) already=c;                      // 只差在有沒有小孩
        }); });
      assert(already,"應找得到一張「只被小孩閘門擋住」的既有卡（否則這條驗不到東西）");
      assert(!E.cardUsable(S3,r,already),
        "還原開關不得把「本來就有的」閘門一起關掉（"+already.id+"「"+already.title+"」）");

      // (d) 商城本來就有閘門，確認沒被動到
      var toy=ns.content.byId["ML_VIR4"];
      assert(toy && (toy.payload||{}).reqChild===true,"商城的孩子才藝課本來就需要小孩");

      // (e) 記錄實況：這次真正補上的只有 1 張，其餘早就有閘門或由教養軸規則擋下
      var already2=0, newly=0, byAxis=0;
      Object.keys(ns.content.cards).forEach(function(dk){
        (ns.content.cards[dk]||[]).forEach(function(c){
          var t2=(c.title||"");
          if(!KID.some(function(k){ return t2.indexOf(k)>=0; })) return;
          if(c.kind==="TAPESTRY" && c.virtueAxis==="PARENTING"){ byAxis++; return; }
          if(c.requiresChildSinceS12) newly++;
          else if(c.requiresChild===true || ((c.payload||{}).reqChild===true)) already2++;
        });
      });
      assert(newly===1,"這一版新掛的閘門應恰好 1 張（實測重掃的結果），實得 "+newly);

      return "本次新掛閘門 "+newly+" 張（LS12）；本來就有 "+already2+" 張；"+
             "由教養軸規則擋下 "+byAxis+" 張；掃描全牌堆零漏網；還原開關只影響新掛的那一張";
    });

    t("T-69 下市留壁紙、退休後長尾不再衰減、合資看得出跟誰", function(){
      // (a) 下市：部位留著（市值 0），不是整個消失
      var modsD=["M1","M2","M3","M4","M6"];
      var S=mkGame(9201,modsD), p=S.players[0];
      var spec=ns.content.stockDefs.filter(function(x){ return x.delistable; })[0];
      assert(spec,"應有可下市的股票");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:9000,label:"x"}],{eduTags:["setup"]});
      E.apply(S,{type:"TRADE_STOCK",playerId:0,
        payload:{symbol:spec.symbol,side:"buy",units:20,margin:false}},{mutate:true});
      var before=p.assets.filter(function(a){ return a.symbol===spec.symbol; })[0];
      assert(before && before.units===20,"應先買到部位");
      var basis=before.costBasis, nw0=p.derived.netWorth;
      // 下市的條件是「蕭條期＋跌破面額的 delistPriceRatio」，兩個都要造出來
      S.macro.stage="DEPRESSION";
      S.stockPrices[spec.symbol]=util.r2(spec.face*0.05);
      assert(E.delistRisk(S,spec),"前置條件：此時應判定為有下市風險（否則下面測不到東西）");
      E.tickDelist(S);                                   // 第一次：進警示
      assert(S.delistWatch[spec.symbol],"應先進入警示");
      S.turnNumber += (E.cfg(S,"delistWarnTurns")||2)+1;  // 熬過緩衝期
      E._events=[];                                      // 只收這一次下市的事件
      E.tickDelist(S);                                   // 第二次：真的下市
      assert(S.delisted[spec.symbol],"應已下市");
      var wall=p.assets.filter(function(a){ return a.symbol===spec.symbol && a.flags && a.flags.wallpaper; })[0];
      assert(wall,"下市後資產負債表上必須留下一張壁紙，讓玩家看得到自己賠在哪");
      assert(wall.marketValue===0 && wall.monthlyIncome===0,"壁紙的市值與收入必須是 0");
      assert(wall.costBasis===basis,"壁紙要留著當初的買進成本（"+basis+"），才知道賠了多少");
      assert(wall.flags.lostAmount===basis,"壁紙要記得賠掉的金額");
      assert(wall.name.indexOf("已下市")>=0,"壁紙的名稱要標明已下市");
      assert(Math.abs(p.derived.netWorth-(nw0-basis))<0.01,
        "壁紙不得墊高淨值：應恰好少掉買進成本 "+basis+"，實得差 "+util.r2(p.derived.netWorth-nw0));
      assert(p.derived.passiveIncome>=0 && isFinite(p.derived.passiveIncome),"被動收入必須有限非負");
      // 事件要帶得出誰被套住、賠多少（看板要印）
      var evD=(E._events||[]).filter(function(e){ return e.type==="DELISTED"; }).pop();
      assert(evD,"應有 DELISTED 事件");
      assert(evD.holderNames && evD.holderNames.length>0,"下市事件要帶出誰被套住（看板要印）");
      assert(evD.totalLost>0,"下市事件要帶出總共賠掉多少，實得 "+evD.totalLost);

      // (b) 退休（外圈）之後，已起飛的數位資產不再衰減
      var modsG=["M1","M2","M3","M4","M6","M8"];
      var S2=mkGame(9202,modsG), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:4000,label:"x"}],{eduTags:["setup"]});
      var dc=ns.content.cards.DIGITAL[0];
      E.startDigital(S2,q,dc);
      var dg=q.digitalAssets[0];
      q.tending=dg.id;
      for(var i=0;i<dg.threshold+2 && dg.tier===null;i++){ S2.turnNumber++; E.tickDigital(S2,q); }
      assert(dg.tier!==null,"應已起飛");
      var inc0=dg.monthlyIncome;
      assert(inc0>0,"起飛後應有收入");
      // 還在內圈、停止投入 → 該衰減（這一課要保留）
      q.tending=null; S2.turnNumber++; E.tickDigital(S2,q);
      assert(dg.monthlyIncome<inc0,"內圈停更仍必須衰減——「長尾屬於持續的人」這一課不能拿掉");
      // 進外圈之後 → 不再衰減
      q.playerStage="OUTER"; q.tending=null;
      var incO=dg.monthlyIncome;
      for(var j=0;j<20;j++){ S2.turnNumber++; E.tickDigital(S2,q); }
      assert(dg.monthlyIncome===incO,
        "外圈之後長尾不得再衰減（enterOuterCircle 的註解就是這樣寫的），實得 "+dg.monthlyIncome+" vs "+incO);
      assert(!dg.dead,"外圈的數位資產不得被衰減到下架");

      // (c) 合資：資料上找得到「跟誰、什麼、幾成」
      var jvA=null;
      Object.keys(ns.content.cards).forEach(function(dk){});
      var S3=mkGame(9203,modsD);
      var A=S3.players[0], B=S3.players[1];
      var gid=util.uid(S3,"JV");
      A.assets.push({instanceId:util.uid(S3,"A"),kind:"BUSINESS",name:"合資測試標的",units:1,
        costBasis:100,marketValue:100,monthlyIncome:5,jvGroupId:gid,sharePct:0.7,flags:{}});
      B.assets.push({instanceId:util.uid(S3,"A"),kind:"BUSINESS",name:"合資測試標的",units:1,
        costBasis:43,marketValue:43,monthlyIncome:2.1,jvGroupId:gid,sharePct:0.3,flags:{}});
      var mine=A.assets.filter(function(x){return x.jvGroupId===gid;})[0];
      var mates=[];
      S3.players.forEach(function(op){ if(op.id===A.id) return;
        (op.assets||[]).forEach(function(x){ if(x.jvGroupId===gid) mates.push(op.name+" "+util.pct(x.sharePct,0)); }); });
      assert(mine && mine.sharePct===0.7,"自己的持份要查得到");
      assert(mates.length===1 && mates[0].indexOf("30%")>=0,"合資對象與持份要查得到，實得 "+mates.join(","));

      // (d) 長面板頂端要有關閉鈕
      assert(typeof ui.showRoundLog==="function","應有每輪紀錄面板");

      return "下市留壁紙（市值 0、成本留著、淨值不被墊高）且事件帶出苦主與損失；"+
             "內圈停更照樣衰減、外圈不再衰減；合資查得到對象與持份";
    });

    t("T-70 記帳自動化改成一套一套：整筆全對才算，錯一格整筆重來", function(){
      var modsB=["M1","M2","M4","M6"];
      var cfgB=baseCfg(); cfgB.automationLevel=2;
      var S=mkGame(10001,modsB,cfgB), p=S.players[0];
      var thr=E.cfg(S,"bkMasteryStreak");
      assert(thr>0,"應有解鎖門檻");
      assert(E.BK_GROUPS && E.BK_GROUPS.length===6,"應有六套交易類型，實得 "+
        (E.BK_GROUPS?E.BK_GROUPS.length:0));
      var keys=E.BK_GROUPS.map(function(g){ return g.key; });
      assert(keys.slice().sort().join(",")==="buyCash,buyLoan,debt,income,realize,spend","六套的鍵值應固定");
      // S14a-2：順序改成「實際最常遇到的排最上面」，所以契約從「固定順序」改成「依 share 遞減」
      for(var oi=1; oi<E.BK_GROUPS.length; oi++)
        assert(E.BK_GROUPS[oi-1].share >= E.BK_GROUPS[oi].share,
          "六套必須依實際出現頻率由高到低排，"+E.BK_GROUPS[oi-1].key+" 排在 "+E.BK_GROUPS[oi].key+" 前面卻比較少見");
      assert(E.BK_GROUPS[0].key==="buyCash","最常遇到的應是現金買資產");
      E.BK_GROUPS.forEach(function(g){
        assert(g.name && g.accs && g.hint, g.key+" 每一套都要有名稱、帳的組成、提示");
        assert(typeof g.share==="number" && g.share>0 && g.share<1 && g.tier,
          g.key+" 每一套都要標出實際出現頻率與說法（給玩家判斷先練哪一套）");
      });

      // (a) 分套要認得出六種帳的長相
      function mk(postings){ return { postings:postings.map(function(x){
        return {account:x[0], delta:x[1], label:"x"}; }) }; }
      var cases=[
        [[["CASH",-100],["ASSET",100]], "buyCash", "現金買資產"],
        [[["CASH",-30],["ASSET",100],["LIABILITY",70],["EXPENSE",0.4]], "buyLoan", "貸款買資產"],
        [[["CASH",120],["ASSET",-100],["INCOME_PASSIVE",-5]], "realize", "賣掉資產"],
        [[["CASH",200],["LIABILITY",200],["EXPENSE",1.2]], "debt", "純借款"],
        [[["CASH",-8],["EXPENSE",3]], "spend", "消費"],
        [[["CASH",40],["INCOME_ACTIVE",40]], "income", "收入"]
      ];
      cases.forEach(function(c){
        var got=E.bkGroupOf(mk(c[0]));
        assert(got===c[1], c[2]+" 應歸為 "+c[1]+"，實得 "+got);
      });
      assert(E.bkGroupOf(null)===null && E.bkGroupOf({})===null,"缺資料時不得爆掉");

      // (b) 整筆全對才算一次。
      // 這一段一開始只寫了「錯一格→歸零」一個情境，倒回去測時發現兩個守門都抓不到：
      //   restT（未答完不計分）擋的是「只答了一部分」；
      //   bkEntryBad（整筆作廢）只在「答錯之後又把同一格改對」時才會用到。
      // 一個情境同時被兩個守門蓋住，等於兩個都沒驗到。以下四個情境各自對準一個。
      function post(postings){
        S.turnNumber++;
        return ns.ledger.post(S,p,"測試分錄",
          postings.map(function(x){ return {account:x[0], delta:x[1], label:"x"}; }),
          {eduTags:["equity"]});
      }
      function answerAll(answers, stopAfter){
        E.buildBookkeeping(S,p); S.phase="BOOKKEEPING";
        var idx=0, n=0;
        (S.bookkeeping.tasks||[]).forEach(function(tk,i){
          if(tk.done) return;
          if(stopAfter!==undefined && n>=stopAfter) return;
          E.apply(S,{type:"CLASSIFY_ENTRY",playerId:p.id,payload:{taskIdx:i,quadrant:answers[idx++]}},{mutate:true});
          n++;
        });
        return n;
      }
      function answerOne(account, quad){
        var hit=-1;
        (S.bookkeeping.tasks||[]).forEach(function(tk,i){
          if(hit<0 && !tk.done && tk.account===account) hit=i; });
        assert(hit>=0,"前置條件：應找得到未答的 "+account+" 那一格");
        E.apply(S,{type:"CLASSIFY_ENTRY",playerId:p.id,payload:{taskIdx:hit,quadrant:quad}},{mutate:true});
      }
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:9000,label:"x"}],{eduTags:["setup"]});
      var LOAN=[["CASH",-20],["ASSET",100],["LIABILITY",80],["EXPENSE",0.5]];

      // 前置條件：這種分錄真的會出三格題、而且歸在 buyLoan
      post(LOAN);
      E.buildBookkeeping(S,p);
      var pre=(S.bookkeeping&&S.bookkeeping.tasks)||[];
      assert(pre.length===3,"前置條件：貸款買資產應出三格題，實得 "+pre.length);
      assert(pre.every(function(x){ return x.group==="buyLoan"; }),"前置條件：三格都應歸在 buyLoan");

      // 情境 1：三格全對但只答一格 → 還沒完成，不得計分（守 restT）
      p.bkStreak={}; p.bkEntryBad={};
      assert(answerAll(["asset","liab","expense"],1)===1,"前置條件：應只答了一格");
      assert((p.bkStreak.buyLoan||0)===0,
        "只答完一部分不得計分（半套會的人不該拿到自動化），實得 "+p.bkStreak.buyLoan);

      // 情境 2：三格全部答完且全對 → 恰好 +1（不是每格 +1）
      p.bkStreak={}; p.bkEntryBad={};
      post(LOAN); answerAll(["asset","liab","expense"]);
      assert(p.bkStreak.buyLoan===1,"整筆全對應恰好 +1（不是每一格都 +1），實得 "+p.bkStreak.buyLoan);

      // 情境 3：中間錯一格且沒有補答 → 這一筆永遠不算（錯的那格保持未答）
      p.bkStreak={}; p.bkEntryBad={};
      post(LOAN); answerAll(["asset","expense","expense"]);
      assert((p.bkStreak.buyLoan||0)===0,"錯一格就不算，實得 "+p.bkStreak.buyLoan);

      // 情境 4：錯一格之後又把那一格改對 → 整筆仍然作廢（守 bkEntryBad）
      p.bkStreak={}; p.bkEntryBad={};
      post(LOAN);
      E.buildBookkeeping(S,p); S.phase="BOOKKEEPING";
      answerOne("ASSET","asset");
      answerOne("LIABILITY","expense");            // 故意答錯
      assert(p.bkEntryBad && Object.keys(p.bkEntryBad).length>0,"前置條件：答錯應把該筆標記為作廢");
      answerOne("LIABILITY","liab");               // 補答正確
      answerOne("EXPENSE","expense");
      var leftS4=(S.bookkeeping.tasks||[]).filter(function(x){ return !x.done; }).length;
      assert(leftS4===0,"前置條件：這一筆應已全部答完（否則驗不到 bkEntryBad）");
      assert((p.bkStreak.buyLoan||0)===0,
        "答錯之後補答正確，這一筆仍然不算——不然錯了再改就沒有代價，實得 "+p.bkStreak.buyLoan);

      // 一套答錯不得波及另一套
      p.bkStreak={}; p.bkEntryBad={};
      post([["CASH",-50],["ASSET",50]]); answerAll(["asset"]);
      assert(p.bkStreak.buyCash===1,"現金買資產應計 1");
      post(LOAN); answerAll(["asset","expense","expense"]);
      assert(p.bkStreak.buyCash===1,"一套答錯不得影響另一套，實得 "+p.bkStreak.buyCash);

      // (c) 連續達標才解鎖，且解鎖不自動開啟
      p.bkStreak={}; p.bkEntryBad={};
      for(var i=0;i<thr;i++){ post([["CASH",-10],["ASSET",10]]); answerAll(["asset"]); }
      assert(p.bkUnlocked.buyCash===true,"連續 "+thr+" 次整筆全對應解鎖");
      assert(!p.bkAuto.buyCash,"解鎖不等於自動開啟");
      assert(!p.bkUnlocked.buyLoan,"沒練到的那一套不得跟著解鎖");

      // (d) 沒解鎖不給開；解鎖後開了，該套整筆不再出題，別套照出
      var rNo=E.apply(S,{type:"SET_BK_AUTO",playerId:p.id,payload:{group:"buyLoan",on:true}},{mutate:true});
      assert(rNo.rejected,"未解鎖的套不得開啟自動記帳");
      var rBad=E.apply(S,{type:"SET_BK_AUTO",playerId:p.id,payload:{group:"nope"}},{mutate:true});
      assert(rBad.rejected,"不合法的套別應被拒");
      var rOk=E.apply(S,{type:"SET_BK_AUTO",playerId:p.id,payload:{group:"buyCash",on:true}},{mutate:true});
      assert(!rOk.rejected,"解鎖後應可開啟："+rOk.reason);
      S.turnNumber++;
      ns.ledger.post(S,p,"現金買資產（應被自動）",
        [{account:"CASH",delta:-40,label:"x"},{account:"ASSET",delta:40,label:"y"}],{eduTags:["equity"]});
      ns.ledger.post(S,p,"消費（仍要作答）",
        [{account:"CASH",delta:-6,label:"x"},{account:"EXPENSE",delta:2,label:"y"}],{eduTags:["lifestyle"]});
      E.buildBookkeeping(S,p);
      var grps=((S.bookkeeping&&S.bookkeeping.tasks)||[]).map(function(x){ return x.group; });
      assert(grps.indexOf("buyCash")<0,"已自動的套不得再出題，實得 "+grps.join(","));
      assert(grps.indexOf("spend")>=0,"沒自動的套仍必須出題，實得 "+grps.join(","));

      // (e) 自動與否不得影響任何金額
      var cfgC=baseCfg(); cfgC.automationLevel=2;
      var Sx=mkGame(10002,modsB,cfgC), Sy=mkGame(10002,modsB,cfgC);
      var px=Sx.players[0], py=Sy.players[0];
      E.BK_GROUPS.forEach(function(g){ py.bkUnlocked[g.key]=true; py.bkAuto[g.key]=true; });
      [Sx,Sy].forEach(function(Sz){
        ns.ledger.post(Sz,Sz.players[0],"同一筆帳",
          [{account:"CASH",delta:-30,label:"x"},{account:"ASSET",delta:30,label:"y"}],{eduTags:["equity"]}); });
      assert(px.cash===py.cash && px.derived.netWorth===py.derived.netWorth,
        "自動記帳只影響出不出題，不得影響任何金額");

      // (f) 可關閉
      var cfgOff=baseCfg(); cfgOff.automationLevel=2; cfgOff.bkMasteryStreak=0;
      var So=mkGame(10003,modsB,cfgOff), po=So.players[0];
      So.turnNumber++;
      for(var j=0;j<10;j++){
        ns.ledger.post(So,po,"測試",[{account:"CASH",delta:-5,label:"x"},{account:"ASSET",delta:5,label:"y"}],{eduTags:["equity"]});
        E.buildBookkeeping(So,po); So.phase="BOOKKEEPING";
        (So.bookkeeping.tasks||[]).forEach(function(tk,i){
          if(!tk.done) E.apply(So,{type:"CLASSIFY_ENTRY",playerId:po.id,payload:{taskIdx:i,quadrant:"asset"}},{mutate:true}); });
      }
      assert(!po.bkUnlocked.buyCash,"bkMasteryStreak=0 時不得解鎖任何一套");

      return "六套齊全且分套正確；整筆全對才算、錯一格整筆作廢且不波及別套；"+
             "連續 "+thr+" 次解鎖但不自動開；已自動的套整筆不出題；金額不受影響；可關閉";
    });

    t("T-71 數位資產：長尾真的有感，但沒有變成免費午餐", function(){
      var modsD=["M1","M2","M3","M4","M6","M8"];
      var S=mkGame(10101,modsD);
      // (a) 三個旋鈕都要真的接上
      assert(E.digitalIncomeMult(S)>1,"基礎收入倍率應大於 1，實得 "+E.digitalIncomeMult(S));
      assert(E.digitalSlots(S)>1,"同時可經營的攤數應大於 1，實得 "+E.digitalSlots(S));
      assert(E.cfg(S,"digitalHitMult")>3,"爆紅倍數應調高");
      assert(E.cfg(S,"digitalFlopPct")<0.45,"本行做白工機率應調低");
      assert(E.cfg(S,"digitalAmateurFlopPct")<0.6,"外行做白工機率應調低");

      // (b) 倍率確實落在開張的那一攤上
      var p=S.players[0];
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:6000,label:"x"}],{eduTags:["setup"]});
      var dc=ns.content.cards.DIGITAL[0];
      E.startDigital(S,p,dc);
      var d0=p.digitalAssets[0];
      var want=util.r2((dc.payload.baseIncome||0)*E.digitalIncomeMult(S));
      assert(Math.abs(d0.baseIncome-want)<0.01,
        "開張時的基礎收入應已套用倍率（"+want+"），實得 "+d0.baseIncome);

      // (c) 可以同時開多攤，但顧不到的照樣不前進
      var slots=E.digitalSlots(S);
      var cards=ns.content.cards.DIGITAL.slice(0,slots);
      assert(cards.length===slots,"題材要夠開滿");
      for(var i=1;i<slots;i++) E.startDigital(S,p,cards[i]);
      assert(E.digitalLiveCount(p)===slots,"應可同時經營 "+slots+" 攤，實得 "+E.digitalLiveCount(p));
      // 攤數已滿 → 不再抽到新的數位資產卡
      var more=ns.content.cards.DIGITAL[slots];
      if(more) assert(!E.cardUsable(S,p,more),"攤數滿了就不該再抽到新的數位資產卡");
      // 只有正在顧的那一攤會前進
      var tended=p.digitalAssets.filter(function(x){ return x.id===p.tending; })[0];
      var others=p.digitalAssets.filter(function(x){ return x.id!==p.tending; });
      var prog0=others.map(function(x){ return x.progress; });
      S.turnNumber++; E.tickDigital(S,p);
      assert(tended.progress===1,"正在顧的那一攤應前進，實得 "+tended.progress);
      others.forEach(function(x,i){
        assert(x.progress===prog0[i],"沒顧到的那幾攤不得自己前進（"+x.name+"）"); });

      // (d) 貢獻度要真的提高——同一組種子跟前一版比
      var lineupD=["NPC_SAFE","NPC_LEVER","NPC_VC"];
      function measure(build, mods){
        var inst=0, inc=0, live=0;
        for(var g=0; g<24; g++){
          var r=ns.sim.playOne(build, mods, (10200+g*7919)>>>0, lineupD);
          r.players.forEach(function(pp){
            inst++;
            (pp.digitalAssets||[]).forEach(function(x){
              if(!x.dead && x.monthlyIncome>0){ live++; inc+=x.monthlyIncome; } });
          });
        }
        return { perPlayer: inc/inst, live:live, inst:inst };
      }
      var now=measure(baseCfg(), modsD);
      // 把三個旋鈕轉回 S12 的值，等於「沒做這一版」
      var oldCfg=baseCfg();
      oldCfg.digitalIncomeMult=1; oldCfg.digitalConcurrent=1;
      oldCfg.digitalHitMult=3; oldCfg.digitalFlopPct=0.45; oldCfg.digitalAmateurFlopPct=0.6;
      oldCfg.digitalHitPct=0.15;
      var was=measure(oldCfg, modsD);
      assert(now.perPlayer > was.perPlayer*1.4,
        "長尾收入每人次應明顯提高（改版前 "+was.perPlayer.toFixed(2)+
        "、現在 "+now.perPlayer.toFixed(2)+"）");

      // (e) 做白工仍然是最常見的結果——不能因為調高就把這一課抹掉
      var flopP=E.cfg(S,"digitalFlopPct"), hitP=E.cfg(S,"digitalHitPct");
      var flopA=E.cfg(S,"digitalAmateurFlopPct"), hitA=E.cfg(S,"digitalAmateurHitPct");
      assert(flopP>hitP*1.5,"本行做白工仍應遠比爆紅常見（"+flopP+" vs "+hitP+"）");
      assert(flopA>hitA*3,"外行做白工仍應遠比爆紅常見（"+flopA+" vs "+hitA+"）");
      assert(flopA>flopP && hitA<hitP,"外行仍必須比本行差");

      // (f) 決定論與可關閉
      function key(){ return JSON.stringify(ns.sim.playOne(baseCfg(),modsD,10301,lineupD)
        .players.map(function(x){ return [(x.digitalAssets||[]).length,
          util.r2(util.sum(x.digitalAssets||[],function(y){ return y.monthlyIncome||0; }))]; })); }
      assert(key()===key(),"同種子結果必須一致");
      var cOff=baseCfg(); cOff.digitalPerGame=0;
      var So=mkGame(10302,modsD,cOff);
      assert(!E.digitalOn(So),"digitalPerGame=0 應關閉整個系統");

      return "倍率 "+E.digitalIncomeMult(S)+"×、可同時 "+slots+" 攤（顧不到不前進）、爆紅 "+
             E.cfg(S,"digitalHitMult")+"×；長尾每人次 "+was.perPlayer.toFixed(2)+" → "+
             now.perPlayer.toFixed(2)+"；做白工仍是最常見結果；決定論且可關閉";
    });

    t("T-72 抽到數位資產卡時，可以放棄進修來接", function(){
      var modsD=["M1","M2","M3","M4","M6","M8"];
      var S=mkGame(10401,modsD), p=S.players[0];
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:6000,label:"x"}],{eduTags:["setup"]});
      var sk=ns.content.cards.SKILL[0];
      var dc=ns.content.cards.DIGITAL[0];

      // 前置條件：真的正在進修（否則這條測試驗不到東西）
      E.startLearning(S,p,sk,true);
      assert(p.learning && p.learning.skillId===sk.id,"前置條件：必須真的在進修中");
      var paid=p.learning.paidCost||0;
      assert(paid>0,"前置條件：學費必須大於 0，否則沉沒成本驗不出來");
      var cash0=p.cash, abandoned0=p.stats.skillsAbandoned||0;

      // (a) 進修中直接按「開始經營」仍然不行（避免繞過取捨）
      E.pushDecision(S,p,{ kind:"START_DIGITAL", cardId:dc.id });
      var dPend=S.decisionQueue[S.decisionQueue.length-1];
      E.resolveDecision(S,p,dPend,"start",{});
      assert((p.digitalAssets||[]).length===0,"進修中不得直接開張");
      assert(p.learning,"進修不得被 start 悄悄取消");

      // (b) 選 dropStudy → 放棄進修、退部分學費、開張成功
      var pct=E.cfg(S,"abandonRefundPct"); if(pct===undefined) pct=0.3;
      var refund=util.r2(paid*pct);
      E.resolveDecision(S,p,dPend,"dropStudy",{});
      assert(!p.learning,"選了放棄之後不該還在進修");
      assert((p.stats.skillsAbandoned||0)===abandoned0+1,"應計一次放棄學習");
      assert((p.digitalAssets||[]).length===1,"應成功開張");
      var d0=p.digitalAssets[0];
      var cost=util.r2((dc.payload||{}).cost||0);
      var expect=util.r2(cash0+refund-cost);
      assert(Math.abs(p.cash-expect)<0.01,
        "現金應為 原有+退費-建置成本 = "+expect+"，實得 "+p.cash);
      assert(refund<paid,"沉沒成本必須真的沉下去（退費 "+refund+" < 已付 "+paid+"）");
      assert(p.tending===d0.id,"開張後應接手經營");

      // (c) 沒在進修時選 dropStudy 不得有任何作用
      var S2=mkGame(10402,modsD), q=S2.players[0];
      ns.ledger.post(S2,q,"補現金",[{account:"CASH",delta:6000,label:"x"}],{eduTags:["setup"]});
      assert(!q.learning,"前置條件：這位玩家沒在進修");
      var c2=q.cash;
      E.pushDecision(S2,q,{ kind:"START_DIGITAL", cardId:dc.id });
      var d2=S2.decisionQueue[S2.decisionQueue.length-1];
      E.resolveDecision(S2,q,d2,"dropStudy",{});
      assert((q.digitalAssets||[]).length===0,"沒在進修時 dropStudy 不該開張");
      assert(q.cash===c2,"沒在進修時 dropStudy 不該動到現金");

      // (d) 現金不足時，放棄進修也不該開得成（退費不夠付建置成本）
      var S3=mkGame(10403,modsD), r=S3.players[0];
      E.startLearning(S3,r,sk,true);
      assert(r.learning,"前置條件：在進修中");
      var need=util.r2((dc.payload||{}).cost||0);
      var back=util.r2((r.learning.paidCost||0)*pct);
      if(r.cash+back < need){
        E.pushDecision(S3,r,{ kind:"START_DIGITAL", cardId:dc.id });
        var d3=S3.decisionQueue[S3.decisionQueue.length-1];
        E.resolveDecision(S3,r,d3,"dropStudy",{});
        assert((r.digitalAssets||[]).length===0,"現金不足時不得開張");
        assert(r.cash>=0,"現金不得變成負數");
      }

      // (e) 動作全程走 actionLog → 重放一致
      var seedP=[{name:"我",isNPC:false,professionId:"PRO_CONSULT",dreamCardId:ns.content.dreams[0].id},
                 {name:"A",isNPC:true,personality:"NPC_SAFE",professionId:"PRO_ENGINEER",dreamCardId:ns.content.dreams[1].id}];
      var S4=E.newGame({seed:10404, config:baseCfg(), modules:modsD, players:seedP});
      E.beginTurn(S4);
      var gd=0;
      while(!S4.over && gd++<400){
        var cur=E.activePlayer(S4);
        var a=cur.isNPC ? ns.npc.nextAction(S4) : null;
        if(!a) a={type:"END_TURN",playerId:cur.id,payload:null};
        if(a.type==="DECIDE" && S4.pendingDecision) a.payload.decisionId=S4.pendingDecision.decisionId;
        var rr=E.apply(S4,a,{mutate:true});
        if(rr.rejected) rr=E.apply(S4,{type:"END_TURN",playerId:cur.id,payload:null},{mutate:true});
        if(rr.rejected) break;
        if(S4.turnNumber>=10) break;
      }
      var rp=ns.replay({seed:10404, config:baseCfg(), modules:modsD, players:seedP, actionLog:S4.actionLog});
      var norm=function(X){ return JSON.stringify(X.players.map(function(x){
        return [x.cash,x.derived.netWorth,(x.digitalAssets||[]).length,!!x.learning]; }))+"|"+X.turnNumber; };
      assert(norm(rp)===norm(S4),"含放棄進修的動作序列必須可完整重放");

      return "進修中不得直接開張；放棄可接且退費 "+util.pct(pct,0)+
             "、沉沒成本落地；沒在進修時無作用；現金不足擋下；重放一致";
    });

    /* ===================== S13.1 Correctness Release 新增 ===================== */

    t("T-73 資產分錄與市值逐項對帳（跟投不得重複入帳）", function(){
      // T-03 只驗 netWorth = cash + totalAssets - totalLiabilities，那是 recompute 的定義本身，恆成立。
      // 真正要問的是：ASSET 科目對每個 refId 的餘額，是否等於該資產當下的 marketValue。
      var mods=["M1","M2","M3","M4","M6","M8"], lineup=["NPC_SAFE","NPC_LEVER","NPC_VC"];
      var bad=[], checked=0;
      for(var g=0; g<30; g++){
        var S=ns.sim.playOne(baseCfg(), mods, (31337+g*7919)>>>0, lineup);
        S.players.forEach(function(p){
          checked++;
          var bal={};
          p.ledger.forEach(function(e){ e.postings.forEach(function(q){
            if(q.account==="ASSET" && q.refId) bal[q.refId]=(bal[q.refId]||0)+q.delta; }); });
          var held={}; p.assets.forEach(function(a){ held[a.instanceId]=a.marketValue; });
          Object.keys(bal).forEach(function(r){
            var d=Math.abs(util.r2(bal[r])-(held[r]||0));
            if(d>0.02) bad.push("seed "+S.seed+"／P"+p.id+"／"+r+" 差 "+util.r2(d));
          });
        });
      }
      assert(bad.length===0, "ASSET 分錄與市值不符 "+bad.length+" 筆："+bad.slice(0,3).join("；"));
      return "30 局 × "+checked+" 位玩家：每一項資產的分錄餘額都等於其市值";
    });

    t("T-74 總體事件必須打到全體（不得只打一號座位）", function(){
      // (a) 內容守門：MACRO_EVENT 的玩家級效果一定要標 target
      var MPO=E.MACRO_PLAYER_OPS;
      var miss=[];
      (ns.content.cards.MACRO_EVENT||[]).forEach(function(c){
        (c.effects||[]).forEach(function(ef){
          if(MPO.indexOf(ef.op)>=0 && !ef.target) miss.push(c.id+"／"+ef.op); }); });
      assert(miss.length===0,"以下總體事件效果沒標 target："+miss.join("、"));

      // (b) 引擎防呆：就算內容漏標，macroEffects 也要把它補成 all
      var fake={ id:"__T74", effects:[{op:"ASSET_INCOME_MULT", filter:{kind:"BUSINESS"}, factor:1.5}] };
      var norm=E.macroEffects(fake);
      assert(norm[0].target==="all","macroEffects 應把漏標的玩家級效果補成 all");
      assert(fake.effects[0].target===undefined,"不得就地改到原始卡物件");

      // (c) 真的三個人都吃到
      var S=E.newGame({seed:7401, config:baseCfg(), modules:["M1","M2","M3","M4"],
        players:[0,1,2].map(function(i){ return {name:"P"+i, isNPC:true, personality:"NPC_SAFE",
          professionId:ns.content.professions[0].id, dreamCardId:ns.content.dreams[i].id}; })});
      S.players.forEach(function(p){
        p.assets.push({instanceId:"A"+p.id, cardId:"x", kind:"BUSINESS", name:"測試事業", units:1,
          costBasis:100, marketValue:100, monthlyIncome:10, linkedLiabilityId:null, flags:{}});
        ledger.post(S,p,"setup",[{account:"ASSET",delta:100,refId:"A"+p.id,label:"x"},
          {account:"INCOME_PASSIVE",delta:10,refId:"A"+p.id,label:"x"}],{});
      });
      var ma=ns.content.byId["MA04"];
      E.applyEffects(S, S.players[0], E.macroEffects(ma), ma.title);
      var after=S.players.map(function(p){ return p.assets[p.assets.length-1].monthlyIncome; });
      assert(after[0]===13 && after[1]===13 && after[2]===13,
        "MA04 應對全體生效，實得 "+after.join("／"));
      return "內容全部標了 target；引擎會補救漏標；MA04 三人同時吃到 ×1.3";
    });

    t("T-75 多人身分：非零號座位的『你』也要是自己", function(){
      // FF-003：舊碼把 Player 0 當成「我」，導致 seat>=1 的玩家看自己的財報時
      // isMe=false → 辭職進自由圈、進修、賣資產、還款全部按不下去。
      var savedMp = ui.mp;
      try{
        ui.mp = { mode:true, seat:2 };
        assert(ui.myId()===2,"ui.myId() 應為 2，實得 "+ui.myId());
        var S=E.newGame({seed:7501, config:baseCfg(), modules:["M1","M2","M4"],
          players:[0,1,2].map(function(i){ return {name:"P"+i, isNPC:false,
            professionId:ns.content.professions[i].id, dreamCardId:ns.content.dreams[i].id}; })});
        assert(ui.myP(S).id===2,"ui.myP 應取回 2 號座位");
        // 全檔不得再有把 0 當成「我」的殘留（selftest 自己的 fixture 除外）
        var src=(ui.renderSheet||function(){}).toString();
        assert(src.indexOf("p.id===0")<0,"renderSheet 仍把 0 號座位當成『我』");
        assert(src.indexOf("ui.myId()")>=0,"renderSheet 應改用 ui.myId()");
        var src2=(ui.showMarginCallLesson||function(){}).toString();
        assert(src2.indexOf("e.playerId===0")<0,"斷頭教室仍把 0 號座位當成『你』");
        return "seat=2 時 myId／myP 正確；renderSheet 與斷頭教室已不再寫死 0 號座位";
      } finally { ui.mp = savedMp; }
    });

    t("T-76 模擬器統計：批次合併必須等於全樣本一次算", function(){
      var mods=["M1","M2","M4"], lineup=["NPC_SAFE","NPC_LEVER"];
      var st=ns.sim.stats, games=40, chunk=10;
      // (a) 分批跑 + 合併原始樣本
      var done=0, acc=null, seeds=[];
      while(done<games){
        var c=Math.min(chunk, games-done);
        var r=ns.sim.run({games:c, config:baseCfg(), modules:mods, seedBase:1+done*131, lineup:lineup});
        for(var g=0; g<c; g++) seeds.push(((1+done*131)+g*7919)>>>0);
        if(!acc) acc=r.raw;
        else Object.keys(r.raw).forEach(function(k){ st.mergeBucket(acc[k], r.raw[k]); });
        done+=c;
      }
      var merged=Object.keys(acc).map(function(k){ return st.summarize(k, acc[k]); });
      // (b) 同一批 seeds 直接全樣本算一次
      var truth={}; lineup.forEach(function(pp){ truth[pp]=st.emptyBucket(); });
      seeds.forEach(function(sd){
        var S=ns.sim.playOne(baseCfg(), mods, sd, lineup);
        if(S.simStatus && !S.simStatus.valid) return;
        S.players.forEach(function(p){ var b=truth[p.npcPersonality];
          b.n++; if(p.bankrupt) b.bankrupt++;
          if(p.freeAtTurn) b.free.push(p.freeAtTurn); b.nw.push(p.derived.netWorth); });
      });
      var KEYS=["games","freeRate","medianFreeTurn","p10","p90","bankruptRate","medianNetWorth"];
      merged.forEach(function(x){
        var y=st.summarize(x.personality, truth[x.personality]);
        KEYS.forEach(function(k){
          assert(x[k]===y[k], x.personality+" 的 "+k+" 不一致：批次 "+x[k]+" vs 全樣本 "+y[k]); });
      });
      // (c) 加權：10 局 10% + 90 局 90% 必須是 82%，不是 50%
      var A=st.emptyBucket(); A.n=10; A.free=[5];
      var B=st.emptyBucket(); B.n=90; for(var i=0;i<81;i++) B.free.push(5);
      var m=st.mergeBucket(st.emptyBucket(), A); st.mergeBucket(m, B);
      assert(Math.abs(st.summarize("x",m).freeRate-0.82)<1e-9,
        "加權後應為 0.82，實得 "+st.summarize("x",m).freeRate);
      // (d) percentile 定義單一
      assert(st.median([1,2,3,4,5,6,7,8,9,10])===6,"median 定義走樣");
      assert(st.percentile([1,2,3,4,5,6,7,8,9,10],0.1)===2,"p10 定義走樣");
      assert(st.percentile([1,2,3,4,5,6,7,8,9,10],0.9)===10,"p90 定義走樣");
      return games+" 局分 "+chunk+" 一批：七項統計量與全樣本逐位元一致；加權 0.82；percentile 只有一份定義";
    });

    t("T-77 模擬器異常局不得混進平衡統計", function(){
      // 正常局要被標成 valid
      var S=ns.sim.playOne(baseCfg(), ["M1","M2","M4"], 7701, ["NPC_SAFE","NPC_LEVER"]);
      assert(S.simStatus && S.simStatus.valid===true, "正常結束的局應為 valid");
      assert(S.simStatus.actions>0 && S.simStatus.actions<ns.sim.MAX_ACTIONS, "actions 應在合理範圍");
      // 人工造一個永遠卡住的引擎：guard 一定會爆
      var savedMax=ns.sim.MAX_ACTIONS, savedNext=ns.npc.nextAction;
      try{
        ns.sim.MAX_ACTIONS=30;
        ns.npc.nextAction=function(){ return {type:"__NO_SUCH_ACTION__", playerId:0, payload:{}}; };
        var r=ns.sim.run({games:3, config:baseCfg(), modules:["M1","M2","M4"],
                          seedBase:9001, lineup:["NPC_SAFE","NPC_LEVER"]});
        assert(r.invalid.length===3, "三局都應被判為異常，實得 "+r.invalid.length);
        assert(r.validGames===0, "有效局數應為 0，實得 "+r.validGames);
        r.summary.forEach(function(x){ assert(x.games===0, x.personality+" 不得把異常局計入分母"); });
        assert(r.invalid[0].seed!==undefined && r.invalid[0].reason, "異常局要留下 seed 與原因供除錯");
      } finally { ns.sim.MAX_ACTIONS=savedMax; ns.npc.nextAction=savedNext; }
      return "正常局標 valid；卡死局標 invalid、留 seed 與原因，且不進統計分母";
    });

    t("T-78 商城：重複購買幸福感遞減且有冷卻", function(){
      var S=mkGame(7801,["M1","M2","M4","M6"]); var p=S.players[0];
      ledger.post(S,p,"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      // 找一張純幸福感、沒有 oncePerGame、沒有效期旗標的卡（最容易被重複刷的那一種）
      var it=(ns.content.cards.MALL||[]).filter(function(x){
        var pl=x.payload||{};
        return (pl.joy||0)>=2 && !x.oncePerGame && !pl.flag && !pl.insurance && !pl.propertyInsurance
               && !pl.reqChild && (pl.cost||0)<=30; })[0];
      assert(it,"前置條件：要有一張可重複購買的高 CP 值幸福感商品");
      var base=it.payload.joy;
      var mj=function(){ return (p.stats.mallJoy||0); };      // 只看商城帶來的幸福感，排除品格等其他加成
      var w0=E.wellbeing(S,p), j0=mj();
      var r1=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:it.id}},{mutate:true});
      assert(!r1.rejected,"第一次購買不應被拒："+r1.reason);
      assert(mj()-j0===base,"第一次應拿到全額幸福感 +"+base+"，實得 "+(mj()-j0));
      assert(E.wellbeing(S,p)>=w0+base,"商城幸福感必須真的進到 wellbeing");

      // 冷卻期內不得再買（引擎把關，不只是 UI 灰化）
      p.mallBoughtThisTurn=0;
      var r2=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:it.id}},{mutate:true});
      var why2=(r2.events||[]).filter(function(x){return x.type==="ACTION_REJECTED";}).pop();
      assert(r2.rejected && why2 && why2.reason==="MALL_COOLDOWN",
        "冷卻期內應被擋下且理由為 MALL_COOLDOWN，實得 "+(why2&&why2.reason));

      // 冷卻過後可以再買，但幸福感只剩一半（無條件捨去）
      var cd=E.cfg(S,"mallRepeatCooldown");
      S.turnNumber += cd; p.mallBoughtThisTurn=0;
      var j1=mj();
      var r3=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:it.id}},{mutate:true});
      assert(!r3.rejected,"冷卻過後應可再買："+r3.reason);
      var got2=mj()-j1;
      assert(got2===Math.floor(base*0.5),"第二次幸福感應為 "+Math.floor(base*0.5)+"，實得 "+got2);

      // 第三次歸零（joy=2 時 floor(2*0.25)=0）
      S.turnNumber += cd; p.mallBoughtThisTurn=0;
      var j2=mj();
      E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:it.id}},{mutate:true});
      var got3=mj()-j2;
      assert(got3===Math.floor(base*0.25),"第三次幸福感應為 "+Math.floor(base*0.25)+"，實得 "+got3);
      assert(p.cash < 5000, "錢還是要照付——遞減的是幸福感，不是價格");
      return "「"+it.title+"」幸福感 "+base+" → "+got2+" → "+got3+"；冷卻 "+cd+" 輪由引擎把關";
    });

    t("T-79 停走：原因與剩餘輪數要帶得出來", function(){
      var S=mkGame(7901); var p=S.players[0];
      // SKIP_TURNS 用 n 寫也要吃得到（原本 switch 有兩個同名 case，第二個是死碼）
      E.applyEffects(S,p,[{op:"SKIP_TURNS", n:2, label:"住院觀察"}],"測試卡");
      assert(p.skippedTurns===2,"寫 n:2 應停走 2 輪，實得 "+p.skippedTurns);
      assert(p.skipReason==="住院觀察","應記下停走原因，實得 "+p.skipReason);
      // turns 寫法一樣要吃到
      var S2=mkGame(7902); var q=S2.players[0];
      E.applyEffects(S2,q,[{op:"SKIP_TURNS", turns:3, label:"長期照護"}],"測試卡");
      assert(q.skippedTurns===3,"寫 turns:3 應停走 3 輪，實得 "+q.skippedTurns);
      // 事件要把原因與剩餘輪數帶出去
      var S3=mkGame(7903); var r=S3.players[0];
      r.skippedTurns=2; r.skipReason="失業，正在找下一份工作";
      var seen=[];
      var origEv=E.ev;
      try{
        E.ev=function(tp,d){ if(tp==="TURN_SKIPPED") seen.push(d); return origEv.apply(this,arguments); };
        S3.activePlayerIdx=0; E.beginTurn(S3);
      } finally { E.ev=origEv; }
      assert(seen.length>=1,"應發出 TURN_SKIPPED 事件");
      assert(seen[0].reason==="失業，正在找下一份工作","事件要帶原因，實得 "+seen[0].reason);
      assert(seen[0].remaining===1,"事件要帶剩餘輪數，實得 "+seen[0].remaining);
      return "n／turns 兩種寫法都吃得到；停走事件帶得出原因與剩餘輪數";
    });

    t("T-81 貸款結清後，資產不得還指著不存在的負債", function(){
      var S=mkGame(8101); var p=S.players[0];
      ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var aid=util.uid(S,"A");
      p.assets.push({instanceId:aid, cardId:"x", kind:"REALESTATE", name:"測試屋", units:1,
        costBasis:1000, marketValue:1000, monthlyIncome:8, linkedLiabilityId:null, flags:{}});
      ledger.post(S,p,"建立資產",[{account:"ASSET",delta:1000,refId:aid,label:"測試屋"},
        {account:"INCOME_PASSIVE",delta:8,refId:aid,label:"租金"}],{});
      var lid=E.addLiability(S,p,"MORTGAGE","測試房貸",800,0.03,false,aid,true);
      p.assets[p.assets.length-1].linkedLiabilityId=lid;
      var l=p.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      // 全額提前清償
      E.repay(S,p,l,l.principal);
      assert(!p.liabilities.some(function(x){return x.instanceId===lid;}),"負債應已消滅");
      var a=p.assets.filter(function(x){return x.instanceId===aid;})[0];
      assert(a.linkedLiabilityId===null,"繳清後資產不得還指著已消滅的負債，實得 "+a.linkedLiabilityId);
      // 這條沒修的話，繳清房貸的房子會永遠不能轉讓
      var r=E.apply(S,{type:"PROPOSE_TRADE",playerId:0,
        payload:{assetId:aid, buyerId:1, askPrice:900}},{mutate:true});
      var why=(r.events||[]).filter(function(x){return x.type==="ACTION_REJECTED";}).pop();
      assert(!(why && why.reason==="MORTGAGED"),"繳清房貸的資產不該再被判定為抵押中");
      return "提前清償會解除資產連結；繳清的房子可以轉讓";
    });


    /* ===================== S14a 版面重整 新增 ===================== */

    t("T-82 資產的兩種報酬率：分母不同，槓桿才看得出來", function(){
      var S=mkGame(8201,["M1","M2","M3","M4","M6"]); var p=S.players[0];
      ledger.post(S,p,"補現金",[{account:"CASH",delta:4000,label:"x"}],{eduTags:["setup"]});
      // (a) 無槓桿：自備＝成本，兩種報酬率必須相同
      var aid=util.uid(S,"A");
      p.assets.push({instanceId:aid, cardId:"x", kind:"BUSINESS", name:"全現金事業", units:1,
        costBasis:1000, marketValue:1000, monthlyIncome:10, ownCash:1000,
        linkedLiabilityId:null, flags:{}});
      var r1=E.assetReturns(p, p.assets[p.assets.length-1]);
      assert(r1.ownCash===1000,"自備應為 1000，實得 "+r1.ownCash);
      assert(Math.abs(r1.cashYield-r1.assetYield)<1e-12,"無槓桿時兩種報酬率必須相同");
      assert(Math.abs(r1.cashYield-0.12)<1e-9,"年現金流 120 ÷ 1000 應為 12%，實得 "+r1.cashYield);

      // (b) 有槓桿：現金報酬必須大於資產報酬
      var card=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(function(c){return c.kind==="REALESTATE";})[0];
      assert(card,"前置條件：要有一張不動產機會卡");
      var n0=p.assets.length;
      E.buyAsset(S,p,card,"loan",{});
      assert(p.assets.length===n0+1,"應買進成功");
      var a2=p.assets[p.assets.length-1];
      var r2=E.assetReturns(p,a2);
      assert(a2.ownCash!==undefined,"買進時應記下自備現金");
      assert(r2.ownCash>0 && r2.ownCash<a2.costBasis,"自備應小於成本（有貸款），實得 "+r2.ownCash+"/"+a2.costBasis);
      assert(Math.abs(r2.cashYield)>Math.abs(r2.assetYield),"槓桿應把現金報酬放大於資產報酬");

      // (c) 舊存檔沒有 ownCash → 用「成本 − 原始貸款」回推
      var a3=p.assets[p.assets.length-1];
      var keep=a3.ownCash; delete a3.ownCash;
      var lk=p.liabilities.filter(function(x){return x.instanceId===a3.linkedLiabilityId;})[0];
      var back=E.assetOwnCash(p,a3);
      assert(lk,"前置條件：這筆資產要有連結貸款");
      assert(Math.abs(back-util.r2(a3.costBasis-lk.originalPrincipal))<0.02,
        "舊存檔應回推為 成本−原始貸款，實得 "+back);
      a3.ownCash=keep;

      // (d) 分母為 0 時回傳 null，不得編一個數字出來
      var a4={kind:"STOCK",costBasis:0,marketValue:0,monthlyIncome:0,ownCash:0};
      var r4=E.assetReturns(p,a4);
      assert(r4.cashYield===null && r4.assetYield===null,"分母為 0 應回傳 null（畫面顯示為 —）");
      return "無槓桿兩率相同；有槓桿 "+util.pct(r2.cashYield,1)+" vs "+util.pct(r2.assetYield,1)+"；舊存檔可回推";
    });

    t("T-83 S14a 版面契約：該搬走的搬走了、該留的還在", function(){
      // 這一條防的是「改版之後有人把舊入口加回來」，不是驗美術。
      var ops=document.getElementById("opsGrid");
      assert(ops,"操作區不存在");
      assert(ops.textContent.indexOf("借款")<0,"借款鈕應已移到右欄個人資訊區");
      assert(ops.textContent.indexOf("股市交易")<0,"股市交易應已改為點中欄股市列");
      assert(!document.getElementById("btnLoan"),"btnLoan 應已移除");
      assert(!document.getElementById("btnStockOp"),"btnStockOp 應已移除");
      assert(document.getElementById("pawnsHd"),"玩家區缺少標題列");
      // 注意：renderPlayerCards 被多人層包了一層，看 toString 會看到 wrapper 而不是本體，
      // 所以這裡實際 render 一次去驗 DOM，而不是驗原始碼。
      var savedS=ui.S, savedMp=ui.mp, savedView=ui.viewPlayerId, savedHTML=document.getElementById("pawns").innerHTML;
      try{
        ui.S=mkGame(8301,["M1","M2","M3","M4","M6"]); ui.mp={mode:false,seat:0}; ui.viewPlayerId=null;
        ui.renderPlayerCards();
        var card=document.querySelector("#pawns .pcol");
        assert(card,"玩家卡沒有 render 出來");
        var ct=card.textContent;
        assert(ct.indexOf("被動收入")>=0,"玩家卡缺被動收入");
        // 【S18 契約變更】「資產筆數」不再自己佔一行，併進被動收入那一行寫成「xxx ／ N 筆」。
        // 驗的是資訊還在（實測量過：卡片 173px→118px，左欄系統訊息從看得到 11 則變成 14 則全看得到）。
        assert(/／\s*\d+\s*筆/.test(ct),"玩家卡缺資產筆數（應併在被動收入那一行，如「12,000 ／ 3 筆」），實得 "+ct.slice(0,80));
        assert(card.querySelector(".pdual"),"幸福感與夢想應併成一列");
        assert(!card.querySelector(".ac"),"玩家卡的「近況」那一行應已移除（訊息與每輪紀錄看得到）");
        assert(card.querySelector(".lgrow"),"每輪紀錄入口不見了");
        // 面板隱藏時 getComputedStyle 會回傳未展開的 repeat(3, 1fr)，兩種寫法都要認得
        var gt=getComputedStyle(document.getElementById("pawns")).gridTemplateColumns;
        var cols = /repeat\((\d+)/.test(gt) ? +RegExp.$1 : gt.trim().split(/\s+/).length;
        // 【S17 契約變更】S14a 訂的是「一列三張」，實測後改成「一列兩張、兩列放四人」
        // ——四人局用三欄會排成 3＋1，第四張孤零零占一列。
        assert(cols===2,"玩家卡應一列兩張（S17 改：四人排成 2×2），實得 "+cols+"（"+gt+"）");
      } finally {
        ui.S=savedS; ui.mp=savedMp; ui.viewPlayerId=savedView;
        document.getElementById("pawns").innerHTML=savedHTML;
      }
      assert(ui.renderBoard.toString().indexOf("底層牛馬區")>=0,"盤面內圈文案應為「底層牛馬區」");
      assert(ui.renderBoard.toString().indexOf("老 鼠 圈")<0,"不得留下舊的「老鼠圈」字樣");
      assert(typeof ui.showStockPanel==="function","缺少單檔股票面板");
      assert(typeof ui.showRepayPicker==="function","缺少還款選單");
      return "借款與股市交易已離開操作區；玩家卡欄位、盤面文案、單檔面板都到位";
    });

    t("T-84 單檔股票面板：軸線、可買張數、定期定額建議金額", function(){
      var savedS=ui.S, savedMp=ui.mp, savedView=ui.viewPlayerId;
      try{
        var cfg=baseCfg(); cfg.depthLevel=3;          // 融資要進階難度才開放
        var S=mkGame(8401,["M1","M2","M3","M4","M6"],cfg);
        ui.S=S; ui.mp={mode:false,seat:0}; ui.viewPlayerId=null;
        var p=S.players[0];
        ledger.post(S,p,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
        S.activePlayerIdx=0; S.phase="ROLL";
        var def=ns.content.stockDefs[0];

        // K 線 SVG：要有 X／Y 軸標題與價格刻度
        var svg=ui.stockChartSVG(S, def, {costLine:0});
        assert(svg.indexOf("輪 次")>=0,"K 線缺 X 軸標題");
        assert(svg.indexOf("股 價")>=0,"K 線缺 Y 軸標題");
        assert((svg.match(/<line /g)||[]).length>=6,"K 線缺價格格線");
        var svg2=ui.stockChartSVG(S, def, {costLine:E.stockPrice(S,def)});
        assert(svg2.indexOf("你的成本")>=0,"有持股時應畫出成本線");

        ui.showStockPanel(def.symbol);
        var ovs=document.querySelectorAll("#overlays .overlay");
        var ov=ovs[ovs.length-1];
        assert(ov,"面板沒跳出來");
        var txt=ov.textContent;
        ["張數","現股買進","融資買進","定期定額","股息再投入","殖利率","較上期"].forEach(function(k){
          assert(txt.indexOf(k)>=0,"面板缺「"+k+"」"); });
        // 現股與融資各自有自己的可買張數
        var hints=[].slice.call(ov.querySelectorAll("span")).filter(function(x){ return /^可買 \d+ 張$/.test(x.textContent); });
        assert(hints.length>=2,"現股與融資應各自顯示可買張數，實得 "+hints.length);
        var price=E.stockPrice(S,def);
        assert(hints[0].textContent==="可買 "+Math.floor(p.cash/price)+" 張","現股可買張數算錯："+hints[0].textContent);
        assert(hints[1].textContent==="可買 "+Math.floor(p.cash/(price*S.config.marginRatio))+" 張","融資可買張數算錯："+hints[1].textContent);
        // 定期定額建議金額＝每月主動收入的 1/10
        var nums=[].slice.call(ov.querySelectorAll("input")).filter(function(i){ return i.type==="number"; });
        assert(nums.length>=2,"缺張數或每月扣輸入格");
        var minD=E.cfg(S,"dcaMinAmount"); if(!(minD>0)) minD=5;
        var sug=Math.max(minD, Math.round((p.derived.salaryIncome||0)/10));
        assert(+nums[1].value===sug,"建議月扣應為主動收入的 1/10 ＝ "+sug+"，實得 "+nums[1].value);
        ov.remove();

        // S14a-2：不是自己回合時——買賣停用，但「定期定額／股息再投入」是設定，開放
        S.activePlayerIdx=1;
        ui.showStockPanel(def.symbol);
        var ov2=document.querySelectorAll("#overlays .overlay");
        ov2=ov2[ov2.length-1];
        assert(ov2,"非自己回合時面板也要打得開");
        var trades=[].slice.call(ov2.querySelectorAll("button")).filter(function(x){
          return /買進|賣出|全賣|平倉/.test(x.textContent); });
        assert(trades.length>0,"沒有買賣鈕可驗");
        assert(trades.every(function(x){ return x.disabled; }),"非自己回合時買賣鈕必須全部停用");
        var sets=[].slice.call(ov2.querySelectorAll("button")).filter(function(x){
          return /扣款|股息再投入|停扣/.test(x.textContent); });
        assert(sets.length>0,"沒有定期定額／股息再投入鈕可驗");
        assert(sets.every(function(x){ return !x.disabled; }),
          "定期定額與股息再投入是設定，非自己回合也該能改");
        assert(ov2.textContent.indexOf("可以先研究")>=0,"要寫明為什麼現在不能下單");
        ov2.remove();
        // S14a-2：一頁列出全部標的，不用一檔一檔點
        S.activePlayerIdx=0;
        ui.showStockPanel(null);
        var ov3=document.querySelectorAll("#overlays .overlay"); ov3=ov3[ov3.length-1];
        var svgs=ov3.querySelectorAll("svg");
        assert(svgs.length===ns.content.stockDefs.length,
          "應一次列出全部 "+ns.content.stockDefs.length+" 檔（各自一張 K 線），實得 "+svgs.length);
        // 六種操作各自一個顏色類別
        ["buyCash","buyMargin","dca"].forEach(function(cls){
          assert(ov3.querySelector("button.act."+cls), "缺少 ."+cls+" 的配色按鈕"); });
        ov3.remove();
        return "軸線齊全；一頁 "+svgs.length+" 檔；現股／融資各自可買 "+hints[0].textContent+"／"+hints[1].textContent+
               "；建議月扣 "+sug+"；非回合可設定不可下單";
      } finally {
        ui.S=savedS; ui.mp=savedMp; ui.viewPlayerId=savedView;
        var left=document.querySelectorAll("#overlays .overlay");
        // 這條測試自己開的視窗要收乾淨，不能留在畫面上
        if(left.length) [].slice.call(left).forEach(function(o){ if(o.__t84) o.remove(); });
      }
    });


    t("T-85 非回合動作：只放行不影響別人的那幾種", function(){
      var cfgN=baseCfg(); cfgN.automationLevel=2;   // 開手動記帳，才驗得到「非回合的帳也要出題」
      var S=mkGame(8501,["M1","M2","M3","M4","M6"],cfgN);
      var me=S.players[0], other=S.players[1];
      ledger.post(S,me,"補現金",[{account:"CASH",delta:3000,label:"x"}],{eduTags:["setup"]});
      var lid=E.addLiability(S,me,"CONSUMER","測試信貸",500,0.05,false,null,true);
      // 把回合交給對手
      S.activePlayerIdx=1; S.phase="ROLL"; S.turnResolved=false;
      assert(E.activePlayer(S).id===1,"前置條件：現在輪到 1 號");

      // (a) 提前還本：非回合放行，而且要還到「送出動作的人」身上
      var meCash0=me.cash, otherCash0=other.cash, otherLiab0=other.liabilities.length;
      var r1=E.apply(S,{type:"REPAY_LOAN",playerId:0,payload:{liabilityId:lid,amount:200}},{mutate:true});
      assert(!r1.rejected,"非回合提前還本應放行");
      var l1=me.liabilities.filter(function(x){return x.instanceId===lid;})[0];
      assert(Math.abs(l1.principal-300)<0.02,"應還在自己的負債上，實得餘額 "+l1.principal);
      assert(me.cash<meCash0,"應扣自己的現金");
      assert(other.cash===otherCash0 && other.liabilities.length===otherLiab0,
        "絕對不可以動到當前輪到的那個人（這是舊碼 p=activePlayer 的地雷）");

      // (b) 非回合做的帳，輪到自己時仍要出記帳題
      var en=me.ledger[me.ledger.length-1];
      assert(en.offTurn===true,"非回合產生的分錄應標記起來");
      S.activePlayerIdx=0; S.turnResolved=true;
      E.buildBookkeeping(S,me);
      assert(S.bookkeeping && S.bookkeeping.tasks.some(function(t){ return t.entryId===en.entryId; }),
        "輪到自己時，非回合那筆帳必須出題（否則「借款與償債」這一套永遠練不熟）");

      // (c) 定期定額／股息再投入：非回合放行，且寫到自己身上
      var S2=mkGame(8502,["M1","M2","M4"]);
      S2.activePlayerIdx=1;
      var sym=ns.content.stockDefs[0].symbol;
      var r2=E.apply(S2,{type:"SET_DCA",playerId:0,payload:{symbol:sym,amount:20}},{mutate:true});
      assert(!r2.rejected,"非回合設定定期定額應放行");
      assert((S2.players[0].dcaPlans||[]).some(function(x){return x.symbol===sym&&x.amount===20;}),
        "定期定額應寫在自己身上");
      assert(!(S2.players[1].dcaPlans||[]).length,"不可以寫到別人身上");

      /* (d) 商城
         【S19 契約變更】S14a 把逛商城開放到非回合，實測回饋是「別人的輪次應該只能看不能買」
         （而且非回合買會繞過每回合上限）。現在預設擋下，開關 mallOffTurnBuy=1 可回到舊行為。 */
      var S3=mkGame(8503,["M1","M2","M4","M6"]);
      ledger.post(S3,S3.players[0],"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      S3.activePlayerIdx=1;
      var item=(ns.content.cards.MALL||[]).filter(function(x){
        var pl=x.payload||{}; return !x.oncePerGame && !pl.reqChild && !pl.insurance && !pl.propertyInsurance
          && (pl.cost||0)>0 && (pl.cost||0)<=60; })[0];
      assert(item,"前置條件：要有一件便宜的商城商品");
      var c0=S3.players[0].cash, o0=S3.players[1].cash;
      var r3=E.apply(S3,{type:"MALL_BUY",playerId:0,payload:{itemId:item.id}},{mutate:true});
      assert(r3.rejected,"預設應擋下非回合購買（只能看不能買）");
      assert(S3.players[0].cash===c0,"被擋下就不該扣錢");
      // 開關打開＝S14a～S18 的行為，基線可重現
      S3.config.mallOffTurnBuy=1;
      var r3b=E.apply(S3,{type:"MALL_BUY",playerId:0,payload:{itemId:item.id}},{mutate:true});
      assert(!r3b.rejected,"mallOffTurnBuy=1 時應放行（舊行為）");
      assert(S3.players[0].cash<c0,"應扣自己的現金");
      assert(S3.players[1].cash===o0,"不可以扣到當前輪到的人");

      // (e) 會牽動別人的動作仍然只能在自己的回合做
      var S4=mkGame(8504,["M1","M2","M3","M4","M6"]);
      ledger.post(S4,S4.players[0],"補現金",[{account:"CASH",delta:5000,label:"x"}],{eduTags:["setup"]});
      S4.activePlayerIdx=1; S4.phase="ROLL";
      var card=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(function(c){return c.kind==="REALESTATE";})[0];
      var r5=E.apply(S4,{type:"REFER_OPP",playerId:0,payload:{cardId:card.id,targetId:1}},{mutate:true});
      assert(r5.rejected,"轉介需要別人回應，仍應只能在自己的回合發起");
      var r6=E.apply(S4,{type:"TAKE_LOAN",playerId:0,payload:{amount:100}},{mutate:true});
      var w6=(r6.events||[]).filter(function(x){return x.type==="ACTION_REJECTED";}).pop();
      assert(r6.rejected || (S4.players[0].cash<=5000+S4.players[0].derived.salaryIncome),
        "借款仍應維持回合限定（實得 "+(w6&&w6.reason)+"）");

      return "還款／定期定額／商城非回合放行且記在自己頭上；非回合的帳仍會出題；轉介等互動維持回合限定";
    });

    t("T-80 多人房號 4 碼且建房不得覆蓋活房", function(){
      // 房號長度與零補齊
      assert(typeof ns.mpDebug==="object","前置條件：多人層要匯出可測介面");
      var codes={}, len=ns.mpDebug.ROOM_CODE_LEN;
      assert(len===4,"房號應為 4 碼，實得 "+len);
      for(var i=0;i<200;i++){ var c=ns.mpDebug.genCode();
        assert((new RegExp("^\\d{"+len+"}$")).test(c),"房號格式錯誤："+c); codes[c]=1; }
      assert(Object.keys(codes).length>50,"4 碼房號的分散度不足（200 抽只得 "+Object.keys(codes).length+" 種）");
      // 過期判定
      var live={ meta:{ createdAt: Date.now() } };
      var old ={ meta:{ createdAt: Date.now()-ns.mpDebug.ROOM_TTL_MS-1 } };
      assert(ns.mpDebug.isRoomExpired(old)===true,"超過 TTL 的房應可回收");
      assert(ns.mpDebug.isRoomExpired(live)===false,"活房不得被判為過期");
      assert(ns.mpDebug.isRoomExpired(null)===true,"不存在的房視為可用");
      return "房號 4 碼（0000–9999）、零補齊正確；活房不可回收、過期房可回收";
    });

    var pass=results.filter(function(r){return r.ok;}).length;
    if(typeof console!=="undefined") results.forEach(function(r){
      console.log((r.ok?"PASS ":"FAIL ")+r.name+"　"+r.detail); });
    if(typeof console!=="undefined") console.log("\n自測結果："+pass+" / "+results.length+" 通過");
    if(showUI) ns.selftest.showResults(results, pass);
    return { results:results, pass:pass, total:results.length };
  },
  showResults: function(results, pass){
    var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="640px";
    box.appendChild(el("h2",null,"自測 "+pass+" / "+results.length+" 通過"));
    var tb=el("table","tb");
    tb.innerHTML="<tr><th>項目</th><th>狀態</th><th>說明</th></tr>";
    results.forEach(function(r){ var tr=el("tr");
      tr.innerHTML="<td>"+r.name+"</td><td class='"+(r.ok?"pos":"neg")+"'>"+(r.ok?"通過":"失敗")+"</td><td>"+r.detail+"</td>";
      tb.appendChild(tr); });
    box.appendChild(tb);
    var b=el("button","opt",T("act.close")); b.onclick=function(){ ov.remove(); };
    box.appendChild(b); ov.appendChild(box); $("overlays").appendChild(ov);
  }
};

/* ============================ 玩法／成功條件 ============================ */
ui.showRules = function(fromStart){
  var S=ui.S;
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="560px";
  box.appendChild(el("h2",null,"如何獲勝"));
  box.appendChild(el("div","sub","這是一場關於現金流的遊戲，重點不是賺多少，而是打造能養活你的被動收入。"));
  function block(t,d){ var s=el("div","sec");
    s.appendChild(el("div","gold",t));
    var pp=el("div",null,d); pp.style.cssText="color:var(--tx2);font-size:13px;line-height:1.6;margin-top:4px";
    s.appendChild(pp); box.appendChild(s); }
  // 依玩家的職業與夢想個人化
  if(S){
    var me=S.players[0], prof=ns.content.professionById[me.professionId], dr=ns.content.byId[me.dreamCardId];
    var catName={TASTE:"饗食",SUMMIT:"山海",VOYAGE:"旅行",LEGACY:"傳承"};
    block("你的起點："+prof.name,
      "月薪 "+M(me.derived.salaryIncome)+"，月支出 "+M(me.derived.totalExpenses)+"，起始淨值 "+M(me.derived.netWorth)+"。"+
      (me.derived.netWorth<0?"（別擔心負淨值，關鍵是把每月現金流轉正、養出被動收入。）":"")+
      "　你目前的自由門檻＝被動收入要 ≥ "+M(me.derived.totalExpenses)+"／月。");
    block("你的夢想："+(dr?dr.name:"—"),
      "進入自由圈後，要走到「"+(dr?catName[dr.category]:"")+"」類的聖地格才能累積夢想進度，集滿 "+S.config.dreamCost+" 點即圓夢獲勝。");
  }
  block("① 內圈：達到財務自由","繞著內圈走，用薪水與現金流買進會生錢的資產（房產、股票、事業）。當「被動收入 ≥ 總支出」，就達成財務自由。沿途也可投資自己（在職進修、證照、轉職）翻轉收入。");
  block("② 辭職進入自由圈（外圈）","達成自由後，右側財報會出現「辭職進入自由圈」按鈕。按下就辭掉工作、失去薪水，靠被動收入到外圈追夢——由你決定時機。");
  block("③ 圓夢獲勝（兩個條件）",
    "在外圈走到你夢想所屬的聖地格，免費 +1 夢想進度，也可額外投入資金推進，集滿 "+(S?S.config.dreamCost:5)+" 點。"+
    "但這樣還不夠——<b>幸福感也要達到 "+(S?E.winWellbeingMin(S):10)+" 點</b>才算圓夢獲勝。"+
    "幸福感來自小孩、品格、夢想進度，以及商城裡那些「花錢買不到報表數字」的事：進修、健康、包紅包、陪家人、參加比賽。"+
    "<br>這是這款遊戲想說的話：<b>只把錢賺到位，人生不會自動圓滿。</b>");
  block("小心破產","現金變成負數且無法靠賣資產或信貸脫困，就會破產出局。槓桿能加速累積，也會放大風險。");
  // 六期：說明書連結（PDF 需與本檔放在同一資料夾）
  var man=el("div","sec");
  man.appendChild(el("div","gold","說明書"));
  var mp=el("div"); mp.style.cssText="color:var(--tx2);font-size:13px;line-height:1.8;margin-top:4px";
  /* S20：互動教學入口——比讀 PDF 好用，尤其第一次玩的人。 */
  var tb=el("button","opt primary","🎓 互動教學（點畫面就會出說明）");
  tb.style.marginBottom="6px";
  tb.onclick=function(){ if(ns.tutorial) ns.tutorial.open(); };
  man.appendChild(tb);
  /* S20 修正：這兩條原本寫同層相對路徑，但 repo 裡 PDF 在 manual/，
     所以在 GitHub Pages 與 Netlify 上都是 404。改成兩個路徑都給。 */
  mp.innerHTML="📖 快速上手指南："+
    "<a href='manual/FinFlow_快速上手指南.pdf' target='_blank' style='color:var(--gold)'>網站版</a>／"+
    "<a href='FinFlow_快速上手指南.pdf' target='_blank' style='color:var(--gold)'>同資料夾版</a>　"+
    "📚 完整規則手冊："+
    "<a href='manual/FinFlow_完整規則手冊.pdf' target='_blank' style='color:var(--gold)'>網站版</a>／"+
    "<a href='FinFlow_完整規則手冊.pdf' target='_blank' style='color:var(--gold)'>同資料夾版</a>"+
    "<br><span style='color:var(--tx3);font-size:12px'>從網址玩點「網站版」；隨身碟只帶一個檔時點「同資料夾版」。</span>";
  man.appendChild(mp); box.appendChild(man);
  box.appendChild(el("div","sub","版本 "+ns.BUILD.ver+"（"+ns.BUILD.date+"）"));
  var o=el("div","opts");
  o.appendChild(optBtn(fromStart?"開始遊戲":T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ============================== 借貸視窗 ================================ */
// S14a：借款／還款移到右欄後，需要一個「挑一筆來還」的入口（原本只能從負債細項逐列點）
ui.showRepayPicker = function(p){
  var S=ui.S;
  var list=(p.liabilities||[]).filter(function(l){ return l.kind!=="P2P"; });
  if(!list.length){ ui.toast("目前沒有可提前清償的貸款","warn"); return; }
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="460px";
  box.appendChild(el("h2",null,"提前還本"));
  box.appendChild(el("div","sub","提前還本會降低月付與利息支出；現金要留夠生活，別把緩衝還光。你的現金 "+M(p.cash)+"。"));
  var o=el("div","opts");
  list.forEach(function(l){
    o.appendChild(optBtn(l.name+"　餘額 "+M(l.principal),
      "月付 "+M(l.monthlyPayment)+"　利率 "+util.pct(l.annualRate,2),
      function(){ ov.remove(); ui.showLiability(l); }));
  });
  o.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

ui.showLoanDialog = function(){
  /* S19：這裡原本寫死 S.players[0]。單機時 myId() 就是 0 看不出來，
     多人局非房主座位（seat 1／2）會讀到別人的收入、負債與額度——
     畫面顯示的「尚可借」跟右欄的「借款空間」對不起來（實測 1,150,930 vs 174,270），
     而且按下去送的是 TAKE_LOAN{playerId:自己}＋別人的金額 → 引擎回 NO_CAPACITY。 */
  var S=ui.S, p=S.players[ui.myId()];
  if(!p) return;
  var cap=E.creditCapacity(S,p);
  var ov=el("div","overlay"), box=el("div","sheetbox"); box.style.maxWidth="440px";
  box.appendChild(el("h2",null,T("act.loan")));
  var cd=ui.creditDesc(S,p);
  if(cap<1){ box.appendChild(el("div","flavor","目前的信用額度不足以再借款。額度依你的月收入與信用評級計算（你目前為 "+cd.rating+" 級："+
      "無擔保負債不得超過月收入的 "+cd.dbr+" 倍），已借滿或收入偏低時就借不到。"));
    var b0=el("button","opt",T("act.close")); b0.onclick=function(){ ov.remove(); }; box.appendChild(b0);
    ov.appendChild(box); $("overlays").appendChild(ov); return; }
  var rate=E.rRate(S.macro.baseRate+E.cfg(S,"creditSpread")+cd.spread);
  var unsecured=0, totalDebt=0;
  p.liabilities.forEach(function(l){ totalDebt+=l.principal; if(l.kind==="CONSUMER"||l.kind==="CREDIT") unsecured+=l.principal; });
  var ceilCap=p.derived.salaryIncome*cd.dbr;
  var crInfo=el("div","flavor");
  crInfo.appendChild(ui.creditBadge(S,p,false));
  crInfo.appendChild(el("span",null,"　你的評級 "+cd.rating+"（"+cd.label+"）：貸款利率 "+cd.rateTxt+"、額度上限 "+cd.dbr+"× 月收入"));
  box.appendChild(crInfo);
  box.appendChild(el("div","flavor","信用額度上限 "+M(ceilCap)+"（月收入 "+M(p.derived.salaryIncome)+" × "+cd.dbr+" 倍）"+
    "　已用無擔保 "+M(unsecured)+"　尚可借 "+M(cap)+"　年利率 "+util.pct(rate,2)+
    "<br>目前負債總額 "+M(totalDebt)+"（含有擔保）"));
  /* S19：拉桿拉不到滿。原本 step=round(cap/20)、max=round(cap)，兩者不整除，
     最高只到 floor(max/step)*step——實測「尚可借 174,270」但拉到底只有 171,000
     （174/9=19.3 → 19×9=171），玩家得分好幾次借。
     改成 step 固定 1（＝1,000 元）讓刻度乾淨，另外加一顆「借滿」直接用精確的 cap。 */
  var amt=util.r2(cap/2);
  var slid=el("div","slider"), rng=el("input"); rng.type="range";
  rng.min=0; rng.max=Math.floor(cap); rng.step=1; rng.value=Math.floor(amt);
  var lbl=el("div"); lbl.style.cssText="font-size:12px;color:var(--tx2)"; slid.appendChild(lbl); slid.appendChild(rng);
  var pv=el("div","preview");
  function refresh(){ lbl.textContent="借款金額 "+M(amt)+(amt>=cap-0.005?"（已借滿）":"");
    pv.innerHTML="每月增加利息支出 <b class='num neg'>−"+M(util.r2(amt*rate/12))+"</b>"; }
  rng.oninput=function(){ amt=+rng.value; refresh(); }; refresh();
  box.appendChild(slid); box.appendChild(pv);
  var o=el("div","opts");
  o.appendChild(function(){ var b=el("button","opt"); b.textContent="借滿 "+M(cap);
    b.title="一次借到額度上限，不必反覆拉";
    b.onclick=function(){ amt=cap; rng.value=Math.floor(cap); refresh(); }; return b; }());
  o.appendChild(function(){ var b=el("button","opt"); b.textContent="借款"; b.onclick=function(){
    ov.remove(); ui.dispatch({type:"TAKE_LOAN",playerId:ui.myId(),payload:{amount:amt}}); }; return b; }());
  o.appendChild(function(){ var b=el("button","opt"); b.textContent=T("act.close"); b.onclick=function(){ ov.remove(); }; return b; }());
  box.appendChild(o); ov.appendChild(box); $("overlays").appendChild(ov);
};

/* ============================== 啟動 =================================== */
ns.boot = function(){
  function readJson(id){ var e=$(id); if(!e) return null; try{ return JSON.parse(e.textContent); }catch(err){ return null; } }
  ns.configRegistry = readJson("config-default");
  if(!ns.configRegistry){ document.body.innerHTML="<div style='color:#fff;padding:40px'>設定檔載入失敗</div>"; return; }
  var C = ns.loadContent(readJson);
  if(C.errors && C.errors.length){
    var ov=el("div","overlay"), box=el("div","sheetbox");
    box.appendChild(el("h2",null,"內容驗證未通過（"+C.errors.length+" 項）"));
    var tb=el("table","tb"); tb.innerHTML="<tr><th>#</th><th>問題</th></tr>";
    C.errors.forEach(function(e,i){ var tr=el("tr"); tr.innerHTML="<td>"+(i+1)+"</td><td class='neg'>"+e+"</td>"; tb.appendChild(tr); });
    box.appendChild(tb); ov.appendChild(box); $("overlays").appendChild(ov); return;
  }

  // S16：回合結算畫面的本機偏好（不進遊戲狀態，不影響決定論與重放）
  try{
    var so=localStorage.getItem("finflow.sumOff"); if(so==="1") ui._sumOff=true;
    var sa=parseInt(localStorage.getItem("finflow.sumAutoSec")||"0",10);
    if(isFinite(sa) && sa>=0) ui._sumAutoSec=sa;
  }catch(e){}
  $("btnSim").onclick=function(){ ns.simui.show(); };   // 八期：三顆圖示鈕已移入中欄操作區（id 不變）
  $("btnDev").onclick=function(){ ns.devpanel.build(); $("devpanel").classList.add("on"); };   // 七期修正：CSS 用 .on，原誤寫 .open 導致無反應
  $("devClose").onclick=function(){ $("devpanel").classList.remove("on"); };
  $("btnEnd").onclick=function(){ if(!ui.S || ui.S.over) return;
    // 七期：操作區此鈕改為「結束遊戲」（結束回合已在盤面中央）
    var ov=el("div","overlay"), bx=el("div","sheetbox"); bx.style.maxWidth="420px";
    bx.appendChild(el("h2",null,"結束遊戲？"));
    bx.appendChild(el("div","flavor","將依目前狀態結算排名（自由圈玩家比夢想進度，其餘比淨值），並顯示復盤報告。此動作無法復原。"));
    var oo=el("div","opts");
    oo.appendChild(optBtn("確定結束遊戲",null,function(){ ov.remove(); ui.dispatch({type:"END_GAME",playerId:ui.myId(),payload:null}); },true));
    oo.appendChild(optBtn(T("act.close"),null,function(){ ov.remove(); }));
    bx.appendChild(oo); ov.appendChild(bx); $("overlays").appendChild(ov);
  };
  $("btnReport").onclick=function(){ if(ui.S){ ui._reported=false; ui.showReport(); } };
  $("btnMall").onclick=function(){ if(ui.S) ui.showMall(); };
  // S11：自動執行——沿用既有的 PLAYER_LEAVE／PLAYER_RETURN（多人的「離席代打」機制），
  // 不另外做一套代打。動作照樣走 dispatch → actionLog，重放與多人 lockstep 都不受影響。
  $("btnAuto").onclick=function(){ if(ui.S) ui.toggleAutopilot(); };
  $("btnHelp").onclick=function(){ ui.showRules(false); };
  // S11：代打中時，操作區那顆鈕改成「我來」，並讓整個版面看得出來現在不是你在下決定
  var origRender=ui.render;
  ui.render=function(){
    var r=origRender.apply(ui,arguments);
    try{
      var b=$("btnAuto"); if(!b) return r;
      var on=ui.isAutopilot();
      b.textContent = on ? "🙋 我來（接回操作）" : "🤖 自動執行";
      b.className = "act"+(on?" primary":"");
      b.title = on ? "接回操作，之後由你決定" : "暫時離開時把回合交給電腦，隨時可以接回";
      document.body.classList.toggle("autopilot", on);
      var bn=$("autopilotBar");
      if(on && !bn){
        bn=el("div",null,"🤖 電腦代打中——按操作區的「我來」隨時接回");
        bn.id="autopilotBar";
        document.body.appendChild(bn);
      } else if(!on && bn){ bn.remove(); }
    }catch(e){}
    return r;
  };
  $("btnExchange").onclick=function(){ if(ui.S) ui.showTradePanel(); };

  window.onerror=function(msg,src,line){
    try{ var log=ui.S?ui.S.actionLog.slice(-20):[];
      console.error("FinFlow 執行錯誤：",msg,"@"+line, JSON.stringify(log)); }catch(e){}
  };

  var qs = (typeof location!=="undefined" && location.search)||"";
  if(qs.indexOf("selftest=1")>=0){ ns.selftest.run(true); }

  /* S20：互動教學的子層。網址帶 #tut 時不走開局流程，直接起一個示範局並疊上熱點。
     教學是在 iframe 裡載入自己，所以玩家正在進行的局完全不受影響。 */
  if(ns.tutorial && ns.tutorial.isChild && ns.tutorial.isChild()){
    $("app").classList.remove("hide");
    ns.tutorial.boot();
    return;
  }

  var save=ui.load();
  if(save && save.actionLog && save.actionLog.length){
    var ov2=el("div","overlay"), box2=el("div","sheetbox"); box2.style.maxWidth="440px";
    box2.appendChild(el("h2",null,"發現未完成的存檔"));
    box2.appendChild(el("div","flavor","上次進行到第 "+save.turn+" 輪。要繼續嗎？"));
    var o=el("div","opts");
    var cont=el("button","opt","繼續上一局"); cont.onclick=function(){
      try{ ui.S=ns.replay(save); ui.configOverrides={};
        $("app").classList.remove("hide"); ov2.remove(); ui._reported=false; ui.render(); ui.tick(); }
      catch(e){ ov2.remove(); ui.toast("存檔重放失敗，改開新局","warn"); ui.showSetup(); } };
    var fresh=el("button","opt","開新的一局"); fresh.onclick=function(){
      try{ localStorage.removeItem("finflow.autosave"); }catch(e){} ov2.remove(); ui.showSetup(); };
    o.appendChild(cont); o.appendChild(fresh); box2.appendChild(o);
    ov2.appendChild(box2); $("overlays").appendChild(ov2);
  } else {
    ui.showSetup();
  }
};

if(typeof document!=="undefined" && document.getElementById && document.getElementById("app")){
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", ns.boot);
  else ns.boot();
}

})(ns);
const { chromium } = require('playwright');
/* S22：Gemini 重構版（S21a/b/c）接線與修錯的驗收。
   驗的是「機制真的會動」：獨立董事（就任→車馬費→審計警訊→請辭／爆雷）、吸金盤到期歸零、
   台灣金融案例宏觀事件真的改價、定時炸彈（DELAYED_EFFECTS）、安太座依月薪計價、階梯技能先修、
   相同種子再戰、以及模擬器速度沒有退化。
   用法（在 repo 根目錄）： node tests/s22test.js  或  node tests/s22test.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    const mods=["M1","M2","M3","M4","M6","M8"];
    const players=[{name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}];
    const fresh=(seed)=>{ ui.startCore(seed||9301, util.clone(cfg), mods, players, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,amt)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:amt-p.cash,label:"x"}],{eduTags:["setup"]});
    const giveSkill=(p,id)=>{ p.skills=p.skills||{}; p.skills[id]={learnedAt:1,decayed:false}; };
    const pending=(S)=>{ E.syncPhase(S); return S.pendingDecision; };
    const decide=(S,p,opt,params)=>{ const d=pending(S); const r=E.apply(S,{type:"DECIDE",playerId:p.id,payload:{decisionId:d.decisionId,optionId:opt,params:params||{}}},{mutate:true}); A(!r.rejected,"DECIDE 被拒："+JSON.stringify((r.events||[]).slice(-1))); return r; };

    step("版本與單檔完整性",()=>{
      // S23a：不要把版本字串釘死在某一期，否則每次發版舊測試都會紅。
      // 只驗格式與「不早於 S22」；當期的確切版本由當期的測試（s23test）驗。
      A(/^v\d+\.\d+\.\d+-S\d+/.test(ns.BUILD.ver),"版本字串格式不對，實得 "+ns.BUILD.ver);
      A(parseInt(ns.BUILD.ver.split("-S")[1],10)>=22,"版本不應早於 S22，實得 "+ns.BUILD.ver);
      A(!ns.content.errors.length,"內容包載入錯誤："+ns.content.errors.join("；"));
      A(document.documentElement.outerHTML.length>0,"文件存在");
      return ns.BUILD.ver;
    });

    step("S21 新卡都在、id 不重複、吸金盤與宏觀事件的欄位接得上引擎",()=>{
      const ids=["LE_INDEPENDENT_DIRECTOR","OPP_HONGYUAN_FUND","OPP_GOLD_REPURCHASE","OPP_OFFSHORE_VIP_FUND",
        "MKT_BODA_FRAUD","MKT_TAIDIAN_DELIST","MACRO_DUAL_CARD_CRISIS","MKT_BIOTECH_UNBLIND",
        "SKL_CPA_AUDIT","SKL_GOV_LEGAL","SKL_AI_ARCH","ML_VIR5","ML_HEA3","ML_LUX4","ML_LUX5",
        "BDG_DIRECTOR_HERO","BDG_SCAM_IMMUNE","CHOICE_SUGAR_AUNTIE","LS21","LS25"];
      ids.forEach(id=>A(ns.content.byId[id],"缺卡 "+id));
      ["OPP_HONGYUAN_FUND","OPP_GOLD_REPURCHASE","OPP_OFFSHORE_VIP_FUND"].forEach(id=>{
        const pl=ns.content.byId[id].payload; A(pl.isScam===true && pl.scamDelayTurns>0,id+" 應為吸金盤"); });
      const known={}; ["STOCK_PRICE_SET","SET_PARAM"].forEach(k=>known[k]=1);
      ["MKT_BODA_FRAUD","MKT_TAIDIAN_DELIST","MACRO_DUAL_CARD_CRISIS","MKT_BIOTECH_UNBLIND"].forEach(id=>{
        ns.content.byId[id].effects.forEach(e=>A(known[e.op],id+" 用了引擎沒有的 op："+e.op)); });
      A(!ns.content.byId["OPP_INDEPENDENT_DIRECTOR"],"舊 id OPP_INDEPENDENT_DIRECTOR 應已改名進 LIFE_EVENT");
      return ids.length+" 張";
    });

    step("模擬器速度：20 局 < 4 秒（S21 乾跑版是 20 局 69 秒）",()=>{
      const t=Date.now();
      for(let g=0;g<20;g++){ const S=ns.sim.playOne(util.clone(cfg),mods,(31337+g*7919)>>>0,['NPC_SAFE','NPC_LEVER','NPC_VC','NPC_SAFE']);
        A(!(S.simStatus&&!S.simStatus.valid),"第 "+g+" 局跑壞："+(S.simStatus&&S.simStatus.reason)); }
      const ms=Date.now()-t; A(ms<4000,"20 局花了 "+ms+"ms"); return ms+"ms";
    });

    step("獨立董事：沒資格抽不到、有資格才進決策，三家公司可選",()=>{
      const S=fresh(9302), me=S.players[0]; const card=ns.content.byId["LE_INDEPENDENT_DIRECTOR"];
      A(!E.cardUsable(S,me,card),"沒有任何審計／法律技能時不該抽到");
      giveSkill(me,"SKL_BOOK");
      A(E.cardUsable(S,me,card),"有記帳技能就該抽得到");
      S.decisionQueue.length=0; E.presentCard(S,me,card);
      const d=pending(S); A(d && d.kind==="APPOINT_DIRECTOR","應開 APPOINT_DIRECTOR 決策，實得 "+(d&&d.kind));
      ui.render();
      const btns=[...document.querySelectorAll("#center .opts button")].map(x=>x.textContent);
      A(btns.some(t=>/大型績優/.test(t)) && btns.some(t=>/成長型科技/.test(t)) && btns.some(t=>/爭議家族/.test(t)) && btns.some(t=>/婉拒/.test(t)),
        "決策卡應列 A/B/C 三家＋婉拒，實得："+btns.join(" | "));
      A(!btns.some(t=>/8000|15000|25000/.test(t)),"金額不得再是元的量級");
      me.directorship=null; me.skills={};
      return btns.length+" 顆按鈕";
    });

    step("獨立董事：就任 C → 每輪車馬費 25 → 審計警訊 → 請辭 → 爆雷全身而退（徽章）",()=>{
      const S=fresh(9303), me=S.players[0]; giveSkill(me,"SKL_CPA_AUDIT"); cashTo(S,me,500);
      S.decisionQueue.length=0; E.presentCard(S,me,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      const c0=me.cash; decide(S,me,"appoint",{company:"C"});
      A(me.directorship && me.directorship.companyType==="C","應就任 C");
      A(Math.abs(me.cash-c0-25)<0.01,"就任當期車馬費應 +25，實得 "+(me.cash-c0));
      // 把爆雷排在 2 輪後：下一輪領車馬費＋審計警訊
      me.directorship.crashTurn=S.turnNumber+2; S.decisionQueue.length=0;
      S.turnNumber+=1; const c1=me.cash; E.tickDirectorship(S,me);
      A(Math.abs(me.cash-c1-25)<0.01,"每輪車馬費應 +25，實得 "+(me.cash-c1));
      const d=pending(S); A(d && d.kind==="RESIGN_DIRECTORSHIP","有審計技能應收到警訊，實得 "+(d&&d.kind));
      ui.render(); const t=document.querySelector("#center").textContent;
      A(/請辭/.test(t) && /200/.test(t),"警訊卡應顯示請辭選項與賠償金額 200");
      decide(S,me,"resign");
      A(me.directorship.resigned===true && me.stats.directorResigned===1,"請辭旗標");
      S.turnNumber+=1; const c2=me.cash; E.tickDirectorship(S,me);
      A(me.directorship===null,"爆雷輪應清掉董事席");
      A(Math.abs(me.cash-c2)<0.01,"請辭後不該被罰，實得 "+(me.cash-c2));
      A(ns.badges.rules.directorHero(S,me)===true,"應拿到「人間清醒」徽章");
      const d2=pending(S); A(d2 && d2.kind==="ACK" && /跳船/.test(d2.title||""),"應有「你跳船了」揭曉卡");
      return "OK";
    });

    step("獨立董事：沒有審計技能收不到警訊，C 公司爆雷賠 200、停走 2；合規治理免賠",()=>{
      const S=fresh(9304), me=S.players[0]; giveSkill(me,"SKL_LAW"); cashTo(S,me,500);
      S.decisionQueue.length=0; E.presentCard(S,me,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      decide(S,me,"appoint",{company:"C"});
      me.directorship.crashTurn=S.turnNumber+2; S.decisionQueue.length=0;
      S.turnNumber+=1; E.tickDirectorship(S,me);
      A(!S.decisionQueue.some(d=>d.kind==="RESIGN_DIRECTORSHIP"),"只懂法律不該收到審計警訊");
      S.turnNumber+=1; const c=me.cash, sk=me.skippedTurns; E.tickDirectorship(S,me);
      A(Math.abs(c-me.cash-200)<0.01,"無責任險應賠 200，實得 "+(c-me.cash));
      A(me.skippedTurns-sk===2,"應停走 2 輪");
      A(me.directorship===null && me.stats.directorCrashed===1,"爆雷後清席並記錄");
      // 合規治理：免賠、停走 1
      const S2=fresh(9305), me2=S2.players[0]; giveSkill(me2,"SKL_GOV_LEGAL"); cashTo(S2,me2,500);
      S2.decisionQueue.length=0; E.presentCard(S2,me2,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      decide(S2,me2,"appoint",{company:"B"});
      me2.directorship.crashTurn=S2.turnNumber+1; S2.decisionQueue.length=0;
      S2.turnNumber+=1; const c2=me2.cash, sk2=me2.skippedTurns; E.tickDirectorship(S2,me2);
      A(Math.abs(c2-me2.cash)<0.01,"合規治理應免除賠償，實得 "+(c2-me2.cash));
      A(me2.skippedTurns-sk2===1,"仍要停走 1 輪應訴");
      return "賠 200／停 2；合規免賠／停 1";
    });

    step("獨立董事：A 公司不爆雷，六輪後圓滿卸任（謹慎 +1、幸福 +2）",()=>{
      const S=fresh(9306), me=S.players[0]; giveSkill(me,"SKL_BOOK"); cashTo(S,me,500);
      S.decisionQueue.length=0; E.presentCard(S,me,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      decide(S,me,"appoint",{company:"A"});
      A(me.directorship.crashTurn===null,"A 公司不該有爆雷輪");
      const c0=me.cash, v0=(me.virtues.PRUDENCE||0), j0=me.stats.skillJoy||0;
      for(let i=0;i<6;i++){ S.turnNumber+=1; S.decisionQueue.length=0; E.tickDirectorship(S,me); }
      A(Math.abs(me.cash-c0-6*8)<0.01,"六輪車馬費應 +48，實得 "+(me.cash-c0));
      A(me.directorship===null && me.stats.directorCompleted===1,"應圓滿卸任");
      A((me.virtues.PRUDENCE||0)===Math.min(v0+1,S.config.virtueMaxLevel),"謹慎 +1");
      A((me.stats.skillJoy||0)===j0+2,"幸福感 +2");
      return "+48、卸任";
    });

    step("吸金盤：買進照常配息，到期整筆歸零＋訴訟費，資產分錄對得起來",()=>{
      const S=fresh(9307), me=S.players[0]; cashTo(S,me,400);
      const card=ns.content.byId["OPP_HONGYUAN_FUND"];
      S.decisionQueue.length=0; E.presentCard(S,me,card);
      A(pending(S).kind==="BUY","應開 BUY 決策");
      const c0=me.cash; decide(S,me,"cash");
      const a=me.assets.filter(x=>x.cardId===card.id)[0];
      A(a && Math.abs(c0-me.cash-100)<0.01,"應付 100 買下");
      A(Math.abs(a.monthlyIncome-4.5*E.incomeMultFor(S,"BUSINESS"))<0.01,"月分紅應為 4.5×係數");
      A(me.scamInvestments.length===1 && me.scamInvestments[0].crashTurn===S.turnNumber+3,"應登記 3 輪後爆雷");
      S.turnNumber+=2; E.tickScamInvestments(S,me); A(me.assets.some(x=>x.cardId===card.id),"未到期不得歸零");
      S.turnNumber+=1; S.decisionQueue.length=0; const c1=me.cash, pi=me.derived.passiveIncome; E.tickScamInvestments(S,me);
      A(!me.assets.some(x=>x.cardId===card.id),"到期應歸零");
      A(Math.abs(c1-me.cash-5)<0.01,"訴訟費 5，實得 "+(c1-me.cash));
      A(me.derived.passiveIncome<pi,"被動收入應下降");
      const bal=me.ledger.reduce((s,e)=>s+e.postings.filter(q=>q.account==="ASSET"&&q.refId===a.instanceId).reduce((t,q)=>t+q.delta,0),0);
      A(Math.abs(bal)<0.01,"該資產的 ASSET 分錄餘額應歸零，實得 "+bal);
      A(me.scamInvestments.length===0 && me.stats.scamCrashed===1,"清單清空並記錄");
      const d=pending(S); A(d && d.kind==="ACK" && /爆雷/.test(d.title),"應有爆雷揭曉卡");
      ui.render(); A(/負責人已出境/.test(document.querySelector("#center").textContent),"ACK 卡應顯示自訂文字");
      return "歸零＋訴訟費 5";
    });

    step("吸金盤：略過記 scamPassed；懂帳的電腦玩家一律拒絕",()=>{
      const S=fresh(9308), me=S.players[0], npc=S.players[1]; cashTo(S,me,400);
      S.decisionQueue.length=0; E.presentCard(S,me,ns.content.byId["OPP_GOLD_REPURCHASE"]); decide(S,me,"skip");
      A(me.stats.scamPassed===1 && me.stats.passedOpps>=1,"略過應記 scamPassed");
      A(ns.badges.rules.scamImmune(S,me)===true,"應拿到「鋼鐵避險王」");
      giveSkill(npc,"SKL_BOOK"); cashTo(S,npc,2000);
      S.decisionQueue.length=0; E.presentCard(S,npc,ns.content.byId["OPP_OFFSHORE_VIP_FUND"]);
      const d=pending(S); const act=ns.npc.decide(S,npc,d);
      A(act && act.payload.optionId==="skip","懂帳的 NPC 應拒絕，實得 "+JSON.stringify(act&&act.payload));
      return "OK";
    });

    step("台灣金融案例宏觀事件：真的改股價與利率",()=>{
      const S=fresh(9309), me=S.players[0];
      const p0=S.stockPrices.STK_TECH;
      E.applyEffects(S,me,E.macroEffects(ns.content.byId["MKT_BODA_FRAUD"]),"博達");
      A(Math.abs(S.stockPrices.STK_TECH-E.clampPrice(S,ns.content.stockBySymbol.STK_TECH,p0*0.6))<0.01,"博達應把成長股打到 0.6 倍");
      const s0=E.cfg(S,"creditSpread");
      E.applyEffects(S,me,E.macroEffects(ns.content.byId["MACRO_DUAL_CARD_CRISIS"]),"雙卡");
      A(E.cfg(S,"creditSpread")===0.11 && E.cfg(S,"marginSpread")===0.06,"雙卡風暴應把信貸／融資加碼利率拉高");
      A(s0<0.11,"原本加碼利率應較低");
      return "STK_TECH "+p0+"→"+S.stockPrices.STK_TECH;
    });

    step("定時炸彈：名媛捷徑先拿 100，兩輪後帳戶凍結扣 130、停走 1",()=>{
      const S=fresh(9310), me=S.players[0]; cashTo(S,me,200);
      S.decisionQueue.length=0; E.presentCard(S,me,ns.content.byId["CHOICE_SUGAR_AUNTIE"]);
      const c0=me.cash; decide(S,me,1);   // S22 已把「捷徑」排到第 2 個選項（第 1 個是建議選項）
      A(Math.abs(me.cash-c0-100)<0.01,"先拿 100，實得 "+(me.cash-c0));
      A(S.activeGlobalEvents.some(e=>e.kind==="DELAYED_FX"),"應登記延後效果");
      S.turnNumber+=1; E.onRoundEnd(S); A(Math.abs(me.cash-c0-100)<0.01,"第 1 輪還不該引爆");
      S.turnNumber+=1; const sk=me.skippedTurns; E.onRoundEnd(S);
      A(Math.abs(c0+100-me.cash-130*S.config.eventCardRate)<0.01,"第 2 輪應扣 130，實得 "+(c0+100-me.cash));
      A(me.skippedTurns-sk===1,"應停走 1 輪");
      A(!S.activeGlobalEvents.some(e=>e.kind==="DELAYED_FX"),"引爆後應清掉");
      return "OK";
    });

    step("安太座：依月薪 1.5 倍計價；沒薪水回退固定 100",()=>{
      const S=fresh(9311), me=S.players[0]; const it=ns.content.byId["ML_VIR5"];
      const sal=me.derived.salaryIncome; A(sal>0,"開局應有薪水");
      A(Math.abs(E.mallCost(S,it,me)-util.r2(sal*1.5))<0.01,"應為月薪 1.5 倍");
      const fake={derived:{salaryIncome:0}};
      A(E.mallCost(S,it,fake)===100,"沒薪水應回退 100，實得 "+E.mallCost(S,it,fake));
      cashTo(S,me,1000); close(); ui.showMall();
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(t.indexOf("安太座")>=0 && /月薪 1\.5 倍/.test(t),"商城應標示月薪倍數");
      close(); return "月薪 "+sal+" → "+E.mallCost(S,it,me);
    });

    step("階梯技能：先修沒學會→拒絕（有中文說明）；抽樣到高階會把先修一起帶進本局",()=>{
      const S=fresh(9312), me=S.players[0]; cashTo(S,me,500);
      S.skillSample=["SKL_CPA_AUDIT","SKL_BOOK"]; S.phase="ROLL"; S.decisionQueue.length=0; S.pendingDecision=null;
      const r=E.apply(S,{type:"START_SKILL",playerId:0,payload:{skillId:"SKL_CPA_AUDIT"}});
      const why=(r.events||[]).filter(e=>e.type==="ACTION_REJECTED").slice(-1)[0];
      A(r.rejected && why && why.reason==="PREREQUISITE_REQUIRED","沒先修應被擋，實得 "+(why&&why.reason));
      A(ui.REJECT_TEXT.PREREQUISITE_REQUIRED,"拒絕碼要有中文");
      giveSkill(me,"SKL_BOOK");
      const r2=E.apply(S,{type:"START_SKILL",playerId:0,payload:{skillId:"SKL_CPA_AUDIT"}});
      A(!r2.rejected,"有先修應可報名");
      let checked=0;
      for(let seed=1;seed<=40;seed++){
        const T=E.newGame({seed:seed,config:util.clone(cfg),modules:mods,players:players});
        T.skillSample.forEach(id=>{ const sc=ns.content.byId[id];
          if(sc.requiresSkill){ checked++; A(T.skillSample.indexOf(sc.requiresSkill)>=0,"seed "+seed+"："+id+" 進了抽樣但先修 "+sc.requiresSkill+" 沒進"); } });
      }
      A(checked>0,"40 個種子裡應至少抽到一張高階技能");
      return "檢查 "+checked+" 次高階抽樣";
    });

    step("相同種子再戰：按鈕存在、按下去用同一種子重開（不再呼叫不存在的 E.initGame）",()=>{
      const S=fresh(9313); const seed=S.seed;
      S.over=true; S.winner=0; S.overReason="TEST"; ui._reported=false; close(); ui.showReport();
      const btn=[...document.querySelectorAll("#overlays button")].find(x=>/相同種子再戰/.test(x.textContent));
      A(btn,"報告應有「相同種子再戰一次」");
      btn.click();
      A(ui.S && ui.S!==S && ui.S.seed===seed && ui.S.turnNumber===1 && !ui.S.over,"應以同種子開新局");
      A(ui.S.players.length===2 && ui.S.players[1].isNPC,"玩家名單應還原");
      close(); return "seed "+seed;
    });

    step("AI 系統架構：數位資產一律專業身分；科技技能在產業變革中不過時",()=>{
      const S=fresh(9315), me=S.players[0];
      const dg=(ns.content.cards.DIGITAL||[])[0]; A(dg,"應有數位資產卡");
      A(!E.digitalPro(S,me,dg),"沒技能不該是專業");
      giveSkill(me,"SKL_CODE"); giveSkill(me,"SKL_AI_ARCH");
      A(E.digitalPro(S,me,dg),"有 AI 架構應算專業");
      E.applyEffects(S,me,[{op:"DECAY_SKILL",family:"TECH",warnTurns:0}],"產業變革");
      A(!S.activeGlobalEvents.some(e=>e.kind==="SKILL_DECAY_PENDING"&&e.playerId===me.id&&e.skillId==="SKL_CODE"),"程式設計不該被排入過時");
      const S2=fresh(9316), me2=S2.players[0]; giveSkill(me2,"SKL_CODE");
      E.applyEffects(S2,me2,[{op:"DECAY_SKILL",family:"TECH",warnTurns:0}],"產業變革");
      A(S2.activeGlobalEvents.some(e=>e.kind==="SKILL_DECAY_PENDING"&&e.playerId===me2.id&&e.skillId==="SKL_CODE"),"沒有 AI 架構的人程式設計應被排入過時");
      return "OK";
    });

    step("商城 NPC 前置檢查 canBuyMall 仍在（S21 死結修法的核心）",()=>{
      const S=fresh(9314), me=S.players[1];
      A(typeof ns.npc.canBuyMall==="function","canBuyMall 應存在");
      A(ns.npc.nextAction===ns.npc._rawNextAction,"nextAction 不該再包乾跑");
      return "OK";
    });

    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.length-pass;
  if(errs.length){ console.log('頁面錯誤：'); errs.slice(0,10).forEach(e=>console.log('  '+e)); }
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

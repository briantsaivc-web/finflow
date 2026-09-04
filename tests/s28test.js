const { chromium } = require('playwright');
/* S28 驗收：學習系統盤點後的一批。
   設計意圖（測試要守住的東西）：
     ① 技能不設上限——限制回到時間與現金，不再有名額
     ② 基礎水電是「換燈泡等級的 DIY」，不是房產投資的成本優化器（固定折抵，不是折半）
     ③ 木作是「自己維護、每間房每月省下」，而且要看得見（發事件）
     ④ 情境卡的價差要把薪資倍率算進去，否則最重的那張（AI 精簡人力）永遠顯示 0
     ⑤ 準備的價值不只在職場：水上夢想＋游泳折抵一次、旅遊夢想＋攝影幸福加碼一次
     ⑥ 轉職技能不設冷卻——會去學就代表市場有需求
   用法（repo 根目錄）： node tests/s28test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
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
    const players=[{name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}];
    const fresh=(seed)=>{ ui.startCore(seed||2801, util.clone(cfg), MODS, players, {noRules:true}); close(); return ui.S; };
    const card=(id)=>ns.content.byId[id];
    const give=(S,p,sid)=>{ p.skills[sid]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");

    /* ---------- ① 不設上限 ---------- */
    step("技能不設上限：npcSkillCap 預設 0，且 0 不會被當成「一個都不能學」",()=>{
      const S=fresh(2801);
      A(E.cfg(S,"npcSkillCap")===0,"預設應為 0（不設上限），實得 "+E.cfg(S,"npcSkillCap"));
      const np=S.players[1]; cashTo(S,np,5000);
      np.skillCooldownUntil=0; np.playerStage="INNER"; np.learning=null;
      A(ns.npc.skillToLearn(S,np),"不設上限時，學得起就應該去學");
      return "cap=0，電腦仍願意進修";
    });

    /* ---------- ② 水電：固定折抵，不再折半 ---------- */
    step("基礎水電：修繕改成固定省一筆，不再是折半（量級回到換燈泡）",()=>{
      const S=fresh(2802), p=S.players[0];
      const flat=E.cfg(S,"skillPlumbSaveFlat");
      A(flat>0 && flat<=5,"DIY 省下的金額應該是小額，實得 "+flat);
      A(E.cfg(S,"skillRepairDiscount")===undefined,"折半那個舊參數應該已經移除");
      return "固定省 "+flat+"，舊的折半參數已移除";
    });

    /* ---------- ③ 木作：每間房每月省，且看得見 ---------- */
    step("木作：名下每間房每月省一筆，冪等，而且會發事件讓玩家看見",()=>{
      const S=fresh(2803), p=S.players[0];
      const save=E.cfg(S,"carpentrySavePerHouse");
      A(save>0,"應有每間房省下的設定");
      [1,2].forEach(function(i){
        p.assets.push({instanceId:"A_H"+i,cardId:null,kind:"REALESTATE",name:"房"+i,units:1,
          costBasis:1000,marketValue:1000,monthlyIncome:20,baseMonthlyIncome:20,
          linkedLiabilityId:null,flags:{}});
      });
      ns.ledger.post(S,p,"建立部位",[{account:"ASSET",delta:2000,refId:"A_H1",label:"x"}],{eduTags:["setup"]});
      const e0=p.derived.totalExpenses, pas0=p.derived.passiveIncome;
      give(S,p,"SKL_CARPENTRY");
      E._events.length=0;
      E.applyCarpentry(S,p);
      A(Math.abs(p.derived.totalExpenses-(e0-save*2))<0.01,
        "兩間房應共省 "+(save*2)+"，實得 "+util.r2(e0-p.derived.totalExpenses));
      A(Math.abs(p.derived.passiveIncome-pas0)<0.01,"不該再動租金（S28 取消租金加成）");
      const evs=E._events.filter(e=>e.type==="SKILL_APPLIED" && e.skillId==="SKL_CARPENTRY");
      A(evs.length===2,"每間房都該發一次 SKILL_APPLIED，實得 "+evs.length);
      E.applyCarpentry(S,p); E.applyCarpentry(S,p);
      A(Math.abs(p.derived.totalExpenses-(e0-save*2))<0.01,"重複呼叫不得重複省（冪等）");
      return "兩間房共省 "+(save*2)+"、發 2 則事件、冪等";
    });

    /* ---------- ④ 情境卡價差要算進薪資倍率 ---------- */
    step("情境卡價差：薪資倍率折算進去後，AI 精簡人力那張才顯示得出真正的份量",()=>{
      const S=fresh(2804), p=S.players[0];
      const before=p.stats.skillSavedTotal||0;
      E.resolveSkillGate(S,p,card("SKE_AILAYOFF"));      // 沒技能 → 走 miss
      const missGap=(S.decisionQueue.filter(d=>d.kind==="SKILL_RESULT")[0]||{}).gap;
      A(missGap>0,"沒準備時價差仍應為正（那是他錯過的金額），實得 "+missGap);
      const S2=fresh(2805), q=S2.players[0];
      give(S2,q,"SKL_CODE");
      S2.decisionQueue.length=0;
      E.resolveSkillGate(S2,q,card("SKE_AILAYOFF"));
      const haveGap=(S2.decisionQueue.filter(d=>d.kind==="SKILL_RESULT")[0]||{}).gap;
      A(Math.abs(haveGap-missGap)<0.01,"價差是卡片屬性，不該因為有沒有技能而不同");
      A((q.stats.skillSavedTotal||0)-before>0,"有準備時應計入 skillSavedTotal");
      const S3=fresh(2806), r=S3.players[0];
      S3.decisionQueue.length=0;
      E.resolveSkillGate(S3,r,card("SKE_PONZI"));
      const ponzi=(S3.decisionQueue.filter(d=>d.kind==="SKILL_RESULT")[0]||{}).gap;
      A(missGap>ponzi,"AI 精簡人力的份量應大於龐氏騙局那張，實得 "+missGap+" vs "+ponzi);
      return "AI 那張 "+util.r2(missGap)+"　>　龐氏 "+ponzi;
    });

    /* ---------- ⑤ 圓夢路上的技能兌現 ---------- */
    step("水上夢想＋水域安全技能：一次性折抵一段圓夢進度，而且只吃一次",()=>{
      const S=fresh(2807), p=S.players[0];
      p.dreamCardId="DREAM_SAIL";
      const base=util.r2(S.config.dreamProgressBasePrice*(p.dreamProgress+1));
      A(E.dreamProgressPrice(S,p)===base,"沒技能時不該折抵");
      give(S,p,"SKL_SWIM");
      const pct=E.cfg(S,"dreamSkillDiscountPct");
      A(Math.abs(E.dreamProgressPrice(S,p)-util.r2(base*(1-pct)))<0.01,
        "有游泳應折 "+util.pct(pct,0)+"，實得 "+E.dreamProgressPrice(S,p));
      cashTo(S,p,5000); p.playerStage="OUTER"; p.boughtProgressThisTurn=false;
      const c0=p.cash;
      A(E.buyDreamProgress(S,p),"應買得下去");
      A(Math.abs(c0-p.cash-util.r2(base*(1-pct)))<0.01,"實扣金額應等於折抵後的價");
      p.boughtProgressThisTurn=false;
      const base2=util.r2(S.config.dreamProgressBasePrice*(p.dreamProgress+1));
      A(E.dreamProgressPrice(S,p)===base2,"第二段不該再折抵（一次性）");
      return "首段折 "+util.pct(pct,0)+"、第二段原價";
    });
    step("CPR 也算水域安全（走家族），非水上夢想則完全沒有折抵",()=>{
      const S=fresh(2808), p=S.players[0];
      p.dreamCardId="DREAM_SAIL"; give(S,p,"SKL_CPR");
      const base=util.r2(S.config.dreamProgressBasePrice*(p.dreamProgress+1));
      A(E.dreamProgressPrice(S,p)<base,"CPR 屬 SAFETY 家族，應該也吃得到");
      const S2=fresh(2809), q=S2.players[0];
      q.dreamCardId="DREAM_STARS"; give(S2,q,"SKL_SWIM");     // 米其林：跟水無關
      const base2=util.r2(S2.config.dreamProgressBasePrice*(q.dreamProgress+1));
      A(E.dreamProgressPrice(S2,q)===base2,"非水上夢想不該有折抵");
      return "CPR 吃得到；米其林夢想沒有";
    });
    step("旅遊類夢想＋攝影：幸福感一次性加碼",()=>{
      const S=fresh(2810), p=S.players[0];
      p.dreamCardId="DREAM_CONTINENT"; give(S,p,"SKL_PHOTO");
      cashTo(S,p,5000); p.playerStage="OUTER"; p.boughtProgressThisTurn=false;
      const j0=p.stats.skillJoy||0, jy=E.cfg(S,"dreamPhotoJoy");
      A(E.buyDreamProgress(S,p),"應買得下去");
      A((p.stats.skillJoy||0)-j0===jy,"應加 "+jy+" 點幸福，實得 "+((p.stats.skillJoy||0)-j0));
      p.boughtProgressThisTurn=false;
      const j1=p.stats.skillJoy||0;
      E.buyDreamProgress(S,p);
      A((p.stats.skillJoy||0)===j1,"第二段不該再加（一次性）");
      return "幸福 +"+jy+"，只加一次";
    });

    /* ---------- ⑥ 轉職技能免冷卻 ---------- */
    step("轉職型技能不設冷卻，其餘等級照原本的冷卻",()=>{
      const S=fresh(2811);
      A(E.skillCooldown(S,card("SKL_CAR_FOOD"))===0,"餐飲創業應免冷卻");
      A(E.skillCooldown(S,card("SKL_CAR_DATA"))===0,"資料分析轉職營應免冷卻");
      A(E.skillCooldown(S,card("SKL_CAR_PLUMB"))===0,"技術士證照班應免冷卻");
      A(E.skillCooldown(S,card("SKL_BOOK"))>0,"中階技能仍應有冷卻");
      return "三張轉職 0 輪、中階仍有冷卻";
    });

    /* ---------- 卡片資料 ---------- */
    step("學習門檻：程式兩個月學得完、高階四張各降到 3 輪",()=>{
      A(card("SKL_CODE").turns===2,"程式應為 2 輪，實得 "+card("SKL_CODE").turns);
      ["SKL_CPA_AUDIT","SKL_GOV_LEGAL","SKL_AI_ARCH","SKL_DERIV"].forEach(id=>{
        A(card(id).turns===3,id+" 應為 3 輪，實得 "+card(id).turns);
      });
      return "程式 2 輪、高階 3 輪";
    });
    step("第二外語：改名、取消月費（月費是它學成率墊底的主因）",()=>{
      const c=card("SKL_SPANISH");
      A(/第二外語/.test(c.title),"應改名為第二外語，實得 "+c.title);
      A((c.recurringMonthly||0)===0,"不該再有月費，實得 "+c.recurringMonthly);
      A(/外語/.test(card("SKE_CLIENT").title),"對應情境卡的標題也要跟著改，實得 "+card("SKE_CLIENT").title);
      return c.title;
    });
    step("三張情境卡改版：AI ×1.2、預算會議改加薪、團建改成長期客戶關係",()=>{
      const ai=card("SKE_AILAYOFF").skillBranch.have.effects[0];
      A(ai.op==="SALARY_MULT" && ai.factor===1.2,"AI 那張應為 ×1.2，實得 "+ai.factor);
      const bd=card("SKE_BUDGET").skillBranch.have.effects;
      A(bd.length===1 && bd[0].op==="SALARY_MULT" && bd[0].factor===1.05,
        "預算會議應改成加薪 5%，實得 "+JSON.stringify(bd));
      const tt=card("SKE_TEAMTRIP");
      A(!/團建/.test(tt.title),"一次性團建不該給永久加薪，標題應改，實得 "+tt.title);
      A(/客戶/.test(tt.title),"應改成長期的客戶關係經營，實得 "+tt.title);
      return tt.title;
    });
    step("溺水那張改成鄰居的孩子，而且不該被誤掛小孩閘門",()=>{
      const c=card("SKE_DROWNING");
      A(/鄰居/.test(c.title),"應改成鄰居的小孩，實得 "+c.title);
      A(!c.requiresChild && !c.requiresChildSinceS12,"別人家的小孩不該要求玩家自己有小孩");
      return c.title;
    });
    step("水上夢想有 water 標籤，旅遊夢想有 travel／outdoor 標籤",()=>{
      ["DREAM_SAIL","DREAM_DIVE"].forEach(id=>{
        A((card(id).tags||[]).indexOf("water")>=0,id+" 應有 water 標籤");
      });
      const trav=["DREAM_CONTINENT","DREAM_SAIL","DREAM_PEAKS","DREAM_DIVE"];
      trav.forEach(id=>{
        const t=card(id).tags||[];
        A(t.indexOf("travel")>=0||t.indexOf("outdoor")>=0,id+" 應算旅遊類");
      });
      return "water 2 張、旅遊類 "+trav.length+" 張";
    });
    step("技能發揮的那一刻要看得見：SKILL_APPLIED 有播報",()=>{
      const S=fresh(2812), p=S.players[0];
      const n0=ui.feed.length;
      E._events.length=0;
      E.ev("SKILL_APPLIED",{playerId:p.id, skillId:"SKL_PLUMB", title:"基礎水電",
                            saved:2, where:"repair", assetName:"測試套房"});
      ui.handleEvents(E._events.slice());
      A(ui.toast,"介面應有 toast 函式");
      return "事件已接（介面不再靜默）";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;
  if(errs.length) errs.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

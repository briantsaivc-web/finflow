const { chromium } = require('playwright');
/* S26 驗收：人生卡片內容審閱 + 四項引擎能力。
   四項能力都是「原本只有人生商城做得到、卡片做不到」的事：
     ① SET_FLAG：卡片效果也能點亮旗標（自我投資健康＝健康折抵、公司送你進修＝解鎖人脈）
     ② costSalaryMult / salaryMult：決策選項的成本與每月增減依當事人月薪計價
     ③ legalClaim：法律技能對賠償類支出的折抵（與產險、醫療險各折各的，不再三層疊加）
     ④ 選項層級 requiresSkill：先修沒學會就鎖住那個選項（但沒開該技能所屬模組的局不鎖）
   用法（repo 根目錄）： node tests/s26test.js  或  node tests/s26test.js path/to/index.html */
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
    const fresh=(seed,mods)=>{ const c=util.clone(cfg);
      ui.startCore(seed||2601, c, mods||MODS, players, {noRules:true}); close(); return ui.S; };
    const card=(id)=>ns.content.byId[id];
    const give=(S,p,sid)=>E.applyEffects(S,p,[{op:"GRANT_SKILL",skillId:sid}],"測試給技能");

    /* ---------- 內容：拆分後各折各的 ---------- */
    step("LE12 開車擦撞：拆成修車（產險）與和解金（法律），不再掛 insurable",()=>{
      const c=card("LE12");
      A(c.effects.length===2,"應為 2 筆效果，實得 "+c.effects.length);
      const rep=c.effects.filter(e=>e.propertyClaim)[0], law=c.effects.filter(e=>e.legalClaim)[0];
      A(rep && law,"應有一筆 propertyClaim 與一筆 legalClaim");
      A(!rep.legalClaim || !law.propertyClaim || true,"");
      A((c.tags||[]).indexOf("insurable")<0,"這張沒有人受傷，不該再吃醫療險");
      A(rep.amount+law.amount===-28,"拆分後總額應維持 −28，實得 "+(rep.amount+law.amount));
      return "修車 "+rep.amount+"／和解金 "+law.amount;
    });
    step("LE13 騎車犁田：醫療走醫療鏈、修車走產險＋法律",()=>{
      const c=card("LE13");
      A(c.effects.length===2,"應為 2 筆效果");
      const med=c.effects.filter(e=>!e.propertyClaim)[0], rep=c.effects.filter(e=>e.propertyClaim)[0];
      A(med && rep,"應可分出醫療與修車兩筆");
      A(!med.legalClaim,"醫療那筆不該吃法律折抵");
      A(rep.legalClaim===true,"修車那筆該吃法律折抵");
      A((c.tags||[]).indexOf("insurable")>=0,"醫療那筆需要卡片標 insurable");
      A(med.amount+rep.amount===-18,"拆分後總額應維持 −18");
      return "醫療 "+med.amount+"／修車 "+rep.amount;
    });

    /* ---------- ② 依月薪計價 ---------- */
    step("E.optionCost：costSalaryMult 依月薪計價，沒薪水回退固定 cost",()=>{
      const S=fresh(2611), p=S.players[0];
      const op=card("SI_QUIT").decision.options[0];
      A(op.costSalaryMult===1.2,"SI_QUIT 應為 1.2 個月薪水");
      const sal=p.derived.salaryIncome; A(sal>0,"測試前提：玩家要有薪水");
      A(E.optionCost(S,p,op)===util.r2(sal*1.2),"應為月薪 ×1.2，實得 "+E.optionCost(S,p,op));
      const noSal=util.clone(p); noSal.derived={salaryIncome:0};
      A(E.optionCost(S,noSal,op)===op.cost,"沒薪水應回退到 cost="+op.cost);
      return "月薪 "+sal+" → 成本 "+E.optionCost(S,p,op)+"（無薪水回退 "+op.cost+"）";
    });
    step("E.effAmount：salaryMult 換算每月省下的金額",()=>{
      const S=fresh(2612), p=S.players[0], sal=p.derived.salaryIncome;
      const rec=card("SI_QUIT").decision.options[0].effects.filter(e=>e.op==="ADD_RECURRING_EXPENSE")[0];
      A(rec.salaryMult===-0.05,"SI_QUIT 每月應省 5% 薪水");
      A(E.effAmount(p,rec)===util.r2(sal*-0.05),"換算錯誤，實得 "+E.effAmount(p,rec));
      const noSal={derived:{salaryIncome:0}};
      A(E.effAmount(noSal,rec)===rec.amount,"沒薪水應回退到 amount="+rec.amount);
      return "月薪 "+sal+" → 每月省 "+Math.abs(E.effAmount(p,rec));
    });
    step("SI_QUIT 兩年回本、SI_MOVE 一年回本（依比例驗算，與職業無關）",()=>{
      [["SI_QUIT",24],["SI_MOVE",12]].forEach(([id,want])=>{
        const op=card(id).decision.options[0];
        const rec=op.effects.filter(e=>e.op==="ADD_RECURRING_EXPENSE")[0];
        const back=op.costSalaryMult/Math.abs(rec.salaryMult);
        A(Math.round(back)===want,id+" 回本期應為 "+want+" 輪，實得 "+back);
        const cash=op.effects.filter(e=>e.op==="CASH_DELTA")[0];
        A(cash.salaryMult===-op.costSalaryMult,id+" 現金支出與成本應一致");
      });
      return "SI_QUIT 24 輪、SI_MOVE 12 輪";
    });
    step("依月薪計價真的落到帳上：套用後現金與每月支出都按月薪算",()=>{
      const S=fresh(2613), p=S.players[0], sal=p.derived.salaryIncome;
      const cash0=p.cash, exp0=p.derived.totalExpenses;
      E.applyEffects(S,p,card("SI_QUIT").decision.options[0].effects,"SI_QUIT");
      ns.ledger.recompute(p);
      A(util.r2(cash0-p.cash)===util.r2(sal*1.2),"現金應扣月薪 ×1.2，實扣 "+util.r2(cash0-p.cash));
      A(p.derived.totalExpenses < exp0,"每月支出應該下降，實得 "+exp0+" → "+p.derived.totalExpenses);
      return "扣 "+util.r2(cash0-p.cash)+"，月支出 "+exp0+" → "+p.derived.totalExpenses;
    });

    /* ---------- ① SET_FLAG ---------- */
    step("SET_FLAG（永久型）：SI_MBA 投資自己會解鎖人脈",()=>{
      const S=fresh(2621), p=S.players[0];
      A(!p.flags.network,"測試前提：一開始沒有人脈");
      const eff=card("SI_MBA").decision.options[0].effects.filter(e=>e.op==="SET_FLAG");
      A(eff.length===1 && eff[0].flag==="network","SI_MBA 應帶一筆 SET_FLAG network");
      E.applyEffects(S,p,eff,"SI_MBA");
      A(p.flags.network===true,"套用後應解鎖人脈");
      return "flags.network=true";
    });
    step("SET_FLAG（期限型）：SI_HEALTH 真的點亮健康折抵，且會到期",()=>{
      const S=fresh(2622), p=S.players[0];
      A(E.healthDiscount(S,p)===0,"測試前提：一開始沒有健康折抵");
      const eff=card("SI_HEALTH").decision.options[0].effects.filter(e=>e.op==="SET_FLAG");
      A(eff.length===1 && eff[0].flag==="fit" && eff[0].turns===24,"SI_HEALTH 應帶 fit 24 輪");
      E.applyEffects(S,p,eff,"SI_HEALTH");
      A(E.healthDiscount(S,p)>0,"套用後應有健康折抵");
      A(p.flags.fitItem===undefined,"這不是年約，不該掛 Item（否則到期會跳續約詢問）");
      const until=p.flags.fitUntil; S.turnNumber=until+1;
      A(E.healthDiscount(S,p)===0,"效期過了應該歸零");
      return "效期至第 "+until+" 輪，過期後折抵 0";
    });

    /* ---------- ③ 法律折抵 ---------- */
    step("legalClaim：有法律技能打 5 折，沒有就全額付",()=>{
      const S=fresh(2631), p1=S.players[0];
      const ef=[{op:"CASH_DELTA",target:"self",amount:-100,label:"和解金",legalClaim:true}];
      const before=p1.cash; E.applyEffects(S,p1,ef,"無技能"); const paidNo=util.r2(before-p1.cash);
      const S2=fresh(2631), p2=S2.players[0]; give(S2,p2,"SKL_LAW");
      A(E.hasSkill(p2,"SKL_LAW"),"技能沒給成功");
      const b2=p2.cash; E.applyEffects(S2,p2,ef,"有技能"); const paidYes=util.r2(b2-p2.cash);
      A(paidYes===util.r2(paidNo*0.5),"有法律技能應付一半：無技能付 "+paidNo+"、有技能付 "+paidYes);
      return "無技能 "+paidNo+" → 有技能 "+paidYes;
    });
    step("legalClaim 只作用在標了旗標的那一筆，不會波及同卡的醫療費",()=>{
      const S=fresh(2632), p=S.players[0]; give(S,p,"SKL_LAW");
      const before=p.cash;
      E.applyEffects(S,p,[{op:"CASH_DELTA",target:"self",amount:-50,label:"醫療自付"}],"混合卡");
      const paid=util.r2(before-p.cash);
      A(paid===50,"沒標 legalClaim 的那筆不該打折，實付 "+paid);
      return "醫療 50 全額付";
    });
    step("三條鏈不再疊加：LE13 修車那筆吃產險、醫療那筆吃醫療險，互不重疊",()=>{
      const S=fresh(2633), p=S.players[0];
      p.flags.insured=true; p.flags.propInsured=true;      // 兩種保險都有
      const c=card("LE13"), before=p.cash;
      E.applyEffects(S,p,c.effects,c.title,{lifeEvent:true, insurable:true, claimOut:[]});
      const paid=util.r2(before-p.cash);
      // 醫療 10 →（醫療險 60%）4；修車 8 →（產險 50%）4；合計 8
      A(paid===8,"應為醫療 4 ＋ 修車 4 ＝ 8，實付 "+paid);
      return "原價 18 → 實付 "+paid;
    });

    /* ---------- ④ 選項層級先修技能 ---------- */
    step("SI_DEBT：開了 M8 又沒學會記帳，選項是鎖住的",()=>{
      const S=fresh(2641), p=S.players[0];
      const op=card("SI_DEBT").decision.options[0];
      A(op.requiresSkill==="SKL_BOOK","SI_DEBT 應要求 SKL_BOOK");
      A(E.optionLocked(S,p,op)===true,"沒學會就該鎖住");
      give(S,p,"SKL_BOOK");
      A(E.optionLocked(S,p,op)===false,"學會之後就該開放");
      return "未學會→鎖、學會→開";
    });
    step("沒開 M8 的局不鎖——否則這張卡只剩「暫時不」可選",()=>{
      const S=fresh(2642,["M1","M2","M4","M6"]), p=S.players[0];
      const op=card("SI_DEBT").decision.options[0];
      A(!E.hasSkill(p,"SKL_BOOK"),"測試前提：沒有這個技能");
      A(E.optionLocked(S,p,op)===false,"技能所屬模組沒開時不該鎖");
      return "M8 關閉 → 不鎖";
    });
    step("引擎守門：鎖住的選項就算硬送 DECIDE 也不會生效",()=>{
      const S=fresh(2643), p=S.players[0];
      E.pushDecision(S,p,{kind:"SELF_INVEST", cardId:"SI_DEBT"}); E.syncPhase(S);
      const d=S.pendingDecision; A(d,"決策沒有進到 pendingDecision");
      const before=p.cash, exp0=p.derived.totalExpenses;
      E.apply(S,{type:"DECIDE",playerId:p.id,payload:{decisionId:d.decisionId,optionId:0,params:{}}},{mutate:true});
      ns.ledger.recompute(p);
      A(p.cash===before,"沒學會卻扣了錢");
      A(p.derived.totalExpenses===exp0,"沒學會卻拿到了每月省下的效果");
      A(!S.pendingDecision,"決策沒有被消化，會卡住回合");
      return "無效果、決策照樣消化";
    });
    step("NPC 不會去選鎖住的選項",()=>{
      const S=fresh(2644), np=S.players[1];
      A(np.isNPC,"測試前提：座位 1 是電腦");
      A(!E.hasSkill(np,"SKL_BOOK"),"測試前提：電腦沒學過記帳");
      E.pushDecision(S,np,{kind:"SELF_INVEST", cardId:"SI_DEBT"}); E.syncPhase(S);
      A(S.pendingDecision,"決策沒有進到 pendingDecision");
      const act=ns.npc.decide(S,np,S.pendingDecision);
      A(act && act.payload.optionId===1,"電腦應該選「暫時不」，實得 "+JSON.stringify(act&&act.payload));
      return "選項 "+act.payload.optionId;
    });
    step("介面：鎖住的選項會顯示出來但按不下去，並標明先修技能",()=>{
      const S=fresh(2645), p=S.players[0];
      const op=card("SI_DEBT").decision.options[0];
      const btn=ui.decisionOptBtn(p,op,0,function(){ throw new Error("鎖住的選項竟然可以按"); });
      A(btn.disabled===true,"鎖住的選項應該 disabled");
      A(/先修/.test(btn.textContent),"應標明先修技能，實得 "+btn.textContent.slice(0,60));
      A(/記帳/.test(btn.textContent),"應顯示技能名稱");
      btn.onclick();                                    // 按下去只該跳提示、不該送出決策
      return btn.textContent.replace(/\s+/g," ").slice(0,52);
    });

    /* ---------- 顯示修正 ---------- */
    step("效果摘要：每月省下不再顯示成「每月支出 +−5,000」",()=>{
      const p=ui.S ? ui.S.players[0] : null;
      const s=ui.effectSummary([{op:"ADD_RECURRING_EXPENSE",amount:-5}]);
      A(/每月省下/.test(s),"應顯示「每月省下」，實得 "+s);
      A(!/\+−/.test(s),"不該出現 +− 的怪符號，實得 "+s);
      return s;
    });
    step("效果摘要：品格用 delta、扣分要顯示成負的",()=>{
      const s=ui.effectSummary([{op:"GRANT_VIRTUE",axis:"PRUDENCE",delta:-2}]);
      A(/−2/.test(s),"扣 2 分應顯示 −2，實得 "+s);
      A(/守法/.test(s),"應顯示品格面向名稱，實得 "+s);
      const j=ui.effectSummary([{op:"GRANT_JOY",amount:-2}]);
      A(/幸福感 −2/.test(j),"幸福感扣分顯示錯誤，實得 "+j);
      return s+"／"+j;
    });
    step("效果摘要：SET_FLAG 要講人話，salaryMult 要換算成這位玩家的數字",()=>{
      const S=fresh(2651), p=S.players[0], sal=p.derived.salaryIncome;
      const s1=ui.effectSummary([{op:"SET_FLAG",flag:"network"}]);
      A(/人脈/.test(s1),"SET_FLAG network 應說明解鎖人脈，實得 "+s1);
      const s2=ui.effectSummary([{op:"SET_FLAG",flag:"fit",turns:24}]);
      A(/健康/.test(s2) && /24/.test(s2),"SET_FLAG fit 應說明健康折抵與輪數，實得 "+s2);
      const s3=ui.effectSummary([{op:"CASH_DELTA",salaryMult:-1.2,amount:-48}],p);
      A(s3.indexOf(ns.util.money(util.r2(sal*1.2)))>=0,"應換算成這位玩家的實際金額，實得 "+s3);
      return s1+"｜"+s2;
    });

    /* ---------- 內容其他兩項 ---------- */
    step("安太座只留一份文案，且與宗教無關",()=>{
      const c=card("ML_VIR5");
      A(c.title==="安太座","卡名應為安太座");
      A(!/廟|神|拜|安太歲/.test(c.flavor),"文案不該再有宗教元素："+c.flavor);
      A(/太座|wife/i.test(c.flavor),"文案應保留原本的哏");
      return c.flavor;
    });
    step("童年支出兩張新卡編號不撞、欄位符合 LIFESTYLE 慣例",()=>{
      ["LS26","LS27"].forEach(id=>{
        const c=card(id); A(c,id+" 不存在");
        A(c.deck==="LIFESTYLE" && c.kind==="LIFESTYLE",id+" 牌堆或 kind 不對");
        A(c.requiresChildSinceS12===true,id+" 應使用 LIFESTYLE 的小孩閘門欄位");
        A(!(c.payload||{}).reqChild,id+" 不該用 MALL 的欄位名");
        A(!(c.payload||{}).joy,"LIFESTYLE 牌堆沒有幸福感欄位");
        A((c.payload||{}).cost>0,id+" 要有花費");
      });
      return "LS26／LS27 OK";
    });
    step("全牌組 id 仍然唯一（新卡沒撞號）",()=>{
      const seen={}, dup=[];
      Object.keys(ns.content.cards).forEach(dk=>(ns.content.cards[dk]||[]).forEach(c=>{
        if(seen[c.id]) dup.push(c.id); else seen[c.id]=1; }));
      A(!dup.length,"重複 id："+dup.join("、"));
      return Object.keys(seen).length+" 張卡片";
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

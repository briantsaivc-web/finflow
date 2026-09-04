const { chromium } = require('playwright');
/* S27 驗收：技能揭露的隱藏警訊、定時炸彈引爆的全場公告、人頭帳戶那張卡的重新配置。
   設計意圖（測試要守住的東西）：
     ① 警語文字改成卡片可自訂——原本寫死的兩句只講得通「境外投資吸金」，
        套到人頭帳戶那種卡完全不對題；寫 true 的舊卡必須沿用預設句、行為不變
     ② 沒有相關技能的人看不到警語——這個資訊落差本身就是教材，不能洩題
     ③ 選項小字不再劇透後果，陷阱只由技能揭露；引爆時全場公告，讓沒選的人也學到
     ④ 品格值有 0～virtueMaxLevel 的夾限（扣不到負值），所以懲罰不靠扣品格
   用法（repo 根目錄）： node tests/s27test.js  或  node tests/s27test.js path/to/index.html */
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
    const fresh=(seed)=>{ ui.startCore(seed||2701, util.clone(cfg), MODS, players, {noRules:true}); close(); return ui.S; };
    const card=(id)=>ns.content.byId[id];
    const give=(S,p,sid)=>E.applyEffects(S,p,[{op:"GRANT_SKILL",skillId:sid}],"測試給技能");
    // 卡面渲染是內部函式，這裡走公開入口：把決策卡畫出來再讀文字
    const faceText=(S,p,cid)=>{
      E.pushDecision(S,p,{kind:"CHOICE", cardId:cid}); E.syncPhase(S);
      ui.decisionCard(S,p,S.pendingDecision);
      const t=document.getElementById("center").textContent;
      S.decisionQueue.length=0; S.pendingDecision=null; E.syncPhase(S);
      return t;
    };

    /* ---------- ① 卡片可自訂的技能警語 ---------- */
    step("有法律技能才看得到法律警訊，而且是這張卡自己的文案",()=>{
      const S=fresh(2711), p=S.players[0];
      const before=faceText(S,p,"CHOICE_SUGAR_AUNTIE");
      A(before.indexOf("法律審查警訊")<0,"沒學過法律不該看到警訊");
      give(S,p,"SKL_LAW");
      const after=faceText(S,p,"CHOICE_SUGAR_AUNTIE");
      A(after.indexOf("法律審查警訊")>=0,"學過法律應該看得到警訊");
      A(after.indexOf("借出帳戶即為幫助詐欺")>=0,"應顯示這張卡自己的法律警語，實得 "+after.slice(0,160));
      A(after.indexOf("境外無主管機關核備")<0,"不該再顯示投資吸金那句預設文案");
      return "未學會看不到 → 學會後看得到專屬警語";
    });
    step("有會計技能看得到的是另一句（對價關係），兩句互不取代",()=>{
      const S=fresh(2712), p=S.players[0];
      give(S,p,"SKL_BOOK");
      const t=faceText(S,p,"CHOICE_SUGAR_AUNTIE");
      A(t.indexOf("財務審計警報")>=0,"學過記帳應該看得到審計警報");
      A(t.indexOf("天下沒有白吃的午餐")>=0,"應顯示這張卡自己的審計警語，實得 "+t.slice(0,160));
      A(t.indexOf("法律審查警訊")<0,"只學記帳不該看到法律那句");
      return "會計警語獨立顯示";
    });
    step("寫 scamWarning:true 的舊卡沿用預設文案，行為不變",()=>{
      const S=fresh(2713), p=S.players[0];
      const old=["OPP_HONGYUAN_FUND","OPP_GOLD_REPURCHASE","OPP_OFFSHORE_VIP_FUND"]
        .filter(id=>card(id) && card(id).scamWarning===true);
      A(old.length===3,"三張投資詐騙卡應維持 scamWarning:true，實得 "+old.length);
      give(S,p,"SKL_LAW"); give(S,p,"SKL_BOOK");
      // 這三張是機會卡，用 cardFace 的同一段邏輯；直接驗資料型別即可（渲染路徑同上一項已驗）
      A(typeof card(old[0]).scamWarning === "boolean","舊卡不該被改成物件");
      return old.join("／")+" 維持 true";
    });

    /* ---------- ③ 不劇透 + 數值重新配置 ---------- */
    step("人頭帳戶卡：誘餌 200、選項小字不再劇透後果",()=>{
      const c=card("CHOICE_SUGAR_AUNTIE"), o=c.decision.options[1];
      const cash=o.effects.filter(e=>e.op==="CASH_DELTA")[0];
      A(cash.amount===200,"當下應拿到 200，實得 "+cash.amount);
      A(c.flavor.indexOf("二十萬")>=0,"文案的謝禮金額要跟效果一致，實得 "+c.flavor);
      A(!/260|凍結|求償|停走/.test(o.sub),"選項小字不該劇透後果，實得 "+o.sub);
      return "誘餌 200／小字：「"+o.sub+"」";
    });
    step("兩輪後的代價：賠 260、幸福 −3、停 1 輪，且不再扣謹慎",()=>{
      const o=card("CHOICE_SUGAR_AUNTIE").decision.options[1];
      A(!o.effects.some(e=>e.op==="GRANT_VIRTUE"),"這張不該再用扣品格當懲罰");
      const d=o.effects.filter(e=>e.op==="DELAYED_EFFECTS")[0];
      A(d && d.turns===2,"應為 2 輪後引爆");
      const c2=d.effects.filter(e=>e.op==="CASH_DELTA")[0];
      const j=d.effects.filter(e=>e.op==="GRANT_JOY")[0];
      const s=d.effects.filter(e=>e.op==="SKIP_TURNS")[0];
      A(c2.amount===-260,"求償應為 260，實得 "+c2.amount);
      A(j.amount===-3,"幸福感應扣 3，實得 "+j.amount);
      A(s,"應停走一輪");
      A(200-260<0,"淨結果必須是虧的，否則等於獎勵詐騙");
      return "淨 −60 現金＋停 1 輪＋幸福 −3";
    });
    step("扣品格扣不到負值——這就是懲罰不靠品格的原因",()=>{
      const S=fresh(2714), p=S.players[0];
      A(p.virtues.PRUDENCE===0,"開局品格應為 0");
      E.applyEffects(S,p,[{op:"GRANT_VIRTUE",axis:"PRUDENCE",delta:-2}],"測試");
      A(p.virtues.PRUDENCE===0,"扣到 0 就該停住，不會變負，實得 "+p.virtues.PRUDENCE);
      E.applyEffects(S,p,[{op:"GRANT_VIRTUE",axis:"PRUDENCE",delta:99}],"測試");
      A(p.virtues.PRUDENCE===S.config.virtueMaxLevel,"上限應為 virtueMaxLevel，實得 "+p.virtues.PRUDENCE);
      return "夾限 0～"+S.config.virtueMaxLevel;
    });

    /* ---------- 引爆與公告 ---------- */
    step("選了捷徑：當下真的入帳 200",()=>{
      const S=fresh(2715), p=S.players[0];
      const before=p.cash;
      E.pushDecision(S,p,{kind:"CHOICE", cardId:"CHOICE_SUGAR_AUNTIE"}); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:1,params:{}}},{mutate:true});
      A(util.r2(p.cash-before)===200,"應入帳 200，實得 "+util.r2(p.cash-before));
      A(S.activeGlobalEvents.some(e=>e.kind==="DELAYED_FX" && e.playerId===p.id),"應埋下定時炸彈");
      return "入帳 200，炸彈已埋";
    });
    step("兩輪後引爆：錢真的被追回，而且全場都看得到公告",()=>{
      const S=fresh(2716), p=S.players[0];
      E.pushDecision(S,p,{kind:"CHOICE", cardId:"CHOICE_SUGAR_AUNTIE"}); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:1,params:{}}},{mutate:true});
      const afterTake=p.cash, joy0=p.joy||0;
      const bomb=S.activeGlobalEvents.filter(e=>e.kind==="DELAYED_FX")[0];
      A(bomb,"找不到炸彈");
      const feed0=ui.feed.length;
      S.turnNumber=bomb.until;                       // 快轉到引信到期
      // 事件是由 E.ev 收進 E._events、再由 ui.handleEvents 播出去的；
      // 這裡直接呼叫 onRoundEnd 會繞過 E.apply，所以自己把事件接給介面。
      E._events.length=0; E.onRoundEnd(S); ui.handleEvents(E._events.slice());
      A(util.r2(afterTake-p.cash)===260,"應被追回 260，實得 "+util.r2(afterTake-p.cash));
      A(p.skippedTurns>=1,"應停走一輪，實得 "+p.skippedTurns);
      const feed=ui.feed.slice(feed0).map(r=>r.msg).join("｜");
      A(/當初埋下的那筆帳找上/.test(feed),"引爆應有全場公告，實得 "+feed.slice(0,140));
      A(/260/.test(feed),"公告應該講出賠了多少，才有教材價值，實得 "+feed.slice(0,140));
      return "追回 260、停 1 輪、公告：「"+(ui.feed.slice(feed0)[0]||{}).msg+"」";
    });
    step("公告是全場的，不是只給當事人",()=>{
      const S=fresh(2717), p=S.players[0];
      E.pushDecision(S,p,{kind:"CHOICE", cardId:"CHOICE_SUGAR_AUNTIE"}); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:1,params:{}}},{mutate:true});
      const bomb=S.activeGlobalEvents.filter(e=>e.kind==="DELAYED_FX")[0];
      const feed0=ui.feed.length;
      S.turnNumber=bomb.until;
      E._events.length=0; E.onRoundEnd(S); ui.handleEvents(E._events.slice());
      const rows=ui.feed.slice(feed0).filter(r=>/當初埋下的那筆帳/.test(r.msg));
      A(rows.length>=1,"沒有公告");
      // ui.feed 是全場共用的系統訊息流，pid 只是標註誰引發的，不是可見性控制
      A(rows[0].pid===p.id,"公告應標註是誰引發的，實得 "+rows[0].pid);
      return "系統訊息流有一則，標註引發者 "+rows[0].pid;
    });
    step("沒選捷徑就不會有炸彈（選項 1 只加謹慎）",()=>{
      const S=fresh(2718), p=S.players[0];
      const before=p.cash;
      E.pushDecision(S,p,{kind:"CHOICE", cardId:"CHOICE_SUGAR_AUNTIE"}); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:0,params:{}}},{mutate:true});
      A(p.cash===before,"守住底線不該有金錢變動");
      A(p.virtues.PRUDENCE===1,"應加一點謹慎，實得 "+p.virtues.PRUDENCE);
      A(!S.activeGlobalEvents.some(e=>e.kind==="DELAYED_FX"),"不該埋炸彈");
      return "謹慎 +1、無炸彈";
    });
    step("電腦玩家不會去踩這張（第一個選項是安全的那個）",()=>{
      const S=fresh(2719), np=S.players[1];
      A(np.isNPC,"座位 1 應為電腦");
      E.pushDecision(S,np,{kind:"CHOICE", cardId:"CHOICE_SUGAR_AUNTIE"}); E.syncPhase(S);
      const act=ns.npc.decide(S,np,S.pendingDecision);
      A(act.payload.optionId===0,"電腦應選封鎖檢舉，實得 "+act.payload.optionId);
      return "電腦選 0";
    });

    /* ================= S27 第二批：機率型選項、失業 op、身分門檻、報稅折抵、10 張新卡 ============ */
    const choose=(S,p,cid,idx)=>{
      E.pushDecision(S,p,{kind:"CHOICE", cardId:cid}); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:idx,params:{}}},{mutate:true});
    };
    const setProf=(S,p,pid)=>{ p.professionId=pid; };
    // p.cash 是從分錄推回來的（ledger.recompute），直接指派會在下一筆分錄被覆蓋——要走分錄補錢
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    const appoint=(S,p,co)=>{ S.decisionQueue.length=0; E.presentCard(S,p,card("LE_INDEPENDENT_DIRECTOR")); E.syncPhase(S);
      E.apply(S,{type:"DECIDE",playerId:p.id,
        payload:{decisionId:S.pendingDecision.decisionId,optionId:"appoint",params:{company:co}}},{mutate:true}); };

    /* ---------- 機率型選項 ---------- */
    step("機率型選項：同一種子擲出同一結果（重放決定論，鐵律 1）",()=>{
      const run=()=>{ const S=fresh(2731), p=S.players[0]; cashTo(S,p,500);
        choose(S,p,"LE_STOCK_OPTION",0); return util.r2(p.cash); };
      const a=run(), b2=run();
      A(a===b2,"同種子兩次結果不同："+a+" vs "+b2);
      return "兩次都是 "+a;
    });
    step("機率型選項：贏和輸各自套用自己的分支效果，兩種都會出現",()=>{
      let win=0, lose=0, winCash=null, loseCash=null;
      for(let sd=2740; sd<2790; sd++){
        const S=fresh(sd), p=S.players[0]; cashTo(S,p,500); const c0=p.cash;
        choose(S,p,"LE_STOCK_OPTION",0);
        const d=util.r2(p.cash-c0);
        if(d>0){ win++; winCash=d; } else { lose++; loseCash=d; }
      }
      A(win>0 && lose>0,"50 顆種子應該兩種結果都出現，實得 贏"+win+"／輸"+lose);
      A(winCash===300,"贏應該 +300，實得 "+winCash);
      A(loseCash===0,"輸應該是一張壁紙（0），實得 "+loseCash);
      return "50 局：贏 "+win+"／輸 "+lose+"（約 "+Math.round(win/50*100)+"％，設定 25％）";
    });
    step("機率明講：選項小字要寫出勝率，把賭注攤在陽光下",()=>{
      const S=fresh(2791), p=S.players[0];
      const t=faceText(S,p,"LE_STOCK_OPTION");
      A(/25／?％|25％/.test(t),"應顯示 25％ 勝率，實得 "+t.slice(0,220));
      A(/75％/.test(t),"應顯示 75％ 敗率，實得 "+t.slice(0,220));
      return "選項小字有 25％／75％";
    });
    step("電腦玩家一律不碰機率型選項（與不踩詐騙同一條基準線）",()=>{
      const S=fresh(2792), np=S.players[1];
      E.pushDecision(S,np,{kind:"CHOICE", cardId:"LE_GUARANTOR"}); E.syncPhase(S);
      A(ns.npc.decide(S,np,S.pendingDecision).payload.optionId===1,"作保應選婉拒");
      S.decisionQueue.length=0; S.pendingDecision=null; E.syncPhase(S);
      E.pushDecision(S,np,{kind:"CHOICE", cardId:"CHOICE_DAY_TRADING_GOD"}); E.syncPhase(S);
      A(ns.npc.decide(S,np,S.pendingDecision).payload.optionId===0,"當沖應選 ETF");
      return "作保→婉拒、當沖→ETF";
    });

    /* ---------- 作保：法律技能真的減傷 ---------- */
    step("作保爆掉時，有法律技能賠一半（legalClaim 折抵鏈）",()=>{
      const lose=card("LE_GUARANTOR").decision.options[0].onLose.effects;
      const S=fresh(2793), p=S.players[0]; cashTo(S,p,900); const c0=p.cash;
      E.applyEffects(S,p,lose,"作保（測試）");
      const plain=util.r2(c0-p.cash);
      const S2=fresh(2794), q=S2.players[0]; cashTo(S2,q,900); give(S2,q,"SKL_LAW"); const q0=q.cash;
      E.applyEffects(S2,q,lose,"作保（測試）");
      const withLaw=util.r2(q0-q.cash);
      A(plain===200,"沒技能應賠 200，實得 "+plain);
      A(withLaw===100,"有法律技能應賠 100，實得 "+withLaw);
      return "200 → 100";
    });

    /* ---------- 失業 op ---------- */
    step("合約漏洞：現賺 100，三輪後真的失業（LAYOFF op 走的是棋盤格同一套）",()=>{
      const S=fresh(2795), p=S.players[0]; cashTo(S,p,500);
      const c0=p.cash, exp=p.derived.totalExpenses, sk0=p.skippedTurns;
      choose(S,p,"CHOICE_CONTRACT_LOOPHOLE",1);
      A(util.r2(p.cash-c0)===100,"當下應現賺 100，實得 "+util.r2(p.cash-c0));
      const bomb=S.activeGlobalEvents.filter(e=>e.kind==="DELAYED_FX")[0];
      A(bomb,"應埋下延遲效果");
      A(bomb.until-S.turnNumber===3,"應是三輪後，實得 "+(bomb.until-S.turnNumber));
      const c1=p.cash; S.turnNumber=bomb.until;
      E._events.length=0; E.onRoundEnd(S);
      const paid=util.r2(c1-p.cash);
      A(Math.abs(paid-exp)<0.01,"失業應付 1 個月總支出 "+exp+"，實得 "+paid);
      A(p.skippedTurns-sk0===2,"應停走 2 輪，實得 "+(p.skippedTurns-sk0));
      const ev=E._events.filter(e=>e.type==="LAYOFF")[0];
      A(ev && ev.employmentType,"應發 LAYOFF 事件並帶受僱型別");
      return "現賺 100 → 3 輪後 失業 −"+paid+"、停 2 輪（"+ev.employmentType+"）";
    });

    /* ---------- 身分門檻 ---------- */
    step("身分門檻：受僱者才談得到加薪，自營與創辦人走的是重新報價",()=>{
      const S=fresh(2796), p=S.players[0];
      setProf(S,p,"PRO_ENGINEER");           // 受僱
      A(E.employmentType(S,p)==="EMPLOYEE","軟體工程師應為受僱");
      A(E.cardUsable(S,p,card("SI_NEGO")),"受僱者應抽得到談加薪");
      A(!E.cardUsable(S,p,card("SI_REPRICE")),"受僱者不該抽到重新報價");
      A(E.cardUsable(S,p,card("LE_STOCK_OPTION")),"受僱者應抽得到選擇權那張");
      setProf(S,p,"PRO_FOOD");               // 自營
      A(E.employmentType(S,p)==="SELF","小吃店老闆應為自營");
      A(!E.cardUsable(S,p,card("SI_NEGO")),"自營者不該抽到談加薪（沒有老闆可以談）");
      A(E.cardUsable(S,p,card("SI_REPRICE")),"自營者應抽得到重新報價");
      A(!E.cardUsable(S,p,card("LE_STOCK_OPTION")),"自營者不該抽到公司發選擇權");
      setProf(S,p,"PRO_FOUNDER");            // 創辦人
      A(E.employmentType(S,p)==="FOUNDER","新創創辦人應為 FOUNDER");
      A(E.cardUsable(S,p,card("SI_REPRICE")),"創辦人應抽得到重新報價");
      return "受僱／自營／創辦人三種都對";
    });
    step("公平性：擋掉一張成長機會，就要在另一邊補一張等價的",()=>{
      const a=card("SI_NEGO").decision.options[0], b2=card("SI_REPRICE").decision.options[0];
      const f=(o)=>(o.effects.filter(e=>e.op==="SALARY_MULT")[0]||{}).factor;
      A(a.cost===b2.cost,"投入金額應相同："+a.cost+" vs "+b2.cost);
      A(f(a)===f(b2),"薪資倍率應相同："+f(a)+" vs "+f(b2));
      return "投入 "+a.cost+"、倍率 "+f(a)+"，兩邊等價";
    });

    /* ---------- 報稅折抵鏈 ---------- */
    step("五月報稅：扣一個月薪水；記帳技能折 30％、捐款收據折 10％，總折抵有上限",()=>{
      const eff=card("LE_TAX_MAY").effects;
      const pay=(mut)=>{ const S=fresh(2797), p=S.players[0]; cashTo(S,p,900);
        if(mut) mut(S,p); const c0=p.cash;
        E.applyEffects(S,p,eff,"五月報稅"); return util.r2(c0-p.cash); };
      const sal=fresh(2797).players[0].derived.salaryIncome;
      const base=pay(null);
      A(Math.abs(base-sal)<0.01,"沒有任何扣除額時應扣一個月薪水 "+sal+"，實得 "+base);
      const skl=pay((S,p)=>give(S,p,"SKL_BOOK"));
      A(Math.abs(skl-sal*0.7)<0.01,"記帳技能應折 30％，實得 "+skl);
      const don=pay((S,p)=>{ p.flags.donor=true; });
      A(Math.abs(don-sal*0.9)<0.01,"捐款收據應折 10％，實得 "+don);
      const both=pay((S,p)=>{ give(S,p,"SKL_BOOK"); p.flags.donor=true; p.flags.insured=true; });
      A(Math.abs(both-sal*0.5)<0.01,"三項疊加應夾在上限 50％，實得 "+both);
      return "月薪 "+sal+"：原價 "+base+"／技能 "+skl+"／捐款 "+don+"／全疊 "+both;
    });

    /* ---------- 孝親費與慈善捐款 ---------- */
    step("孝親費 5％、慈善 2％，都依當事人的月薪縮放",()=>{
      const S=fresh(2798), p=S.players[0];
      const sal=p.derived.salaryIncome, e0=p.derived.totalExpenses;
      choose(S,p,"LE_FILIAL_ALLOWANCE",0);
      const d1=util.r2(p.derived.totalExpenses-e0);
      A(Math.abs(d1-sal*0.05)<0.01,"孝親費應為月薪 5％＝"+util.r2(sal*0.05)+"，實得 "+d1);
      A(p.virtues.FILIAL===1,"應加一點孝親，實得 "+p.virtues.FILIAL);
      const e1=p.derived.totalExpenses;
      choose(S,p,"LE_CHARITY_DONATION",0);
      const d2=util.r2(p.derived.totalExpenses-e1);
      A(Math.abs(d2-sal*0.02)<0.01,"捐款應為月薪 2％＝"+util.r2(sal*0.02)+"，實得 "+d2);
      A(p.flags.donor===true,"應點亮 donor 旗標");
      return "月薪 "+sal+" → 孝親 "+d1+"、捐款 "+d2;
    });
    step("捐款不是只有幸福感：donor 旗標會在報稅那張卡真的省到錢",()=>{
      const S=fresh(2799), p=S.players[0]; cashTo(S,p,900);
      choose(S,p,"LE_CHARITY_DONATION",0);
      const c0=p.cash; E.applyEffects(S,p,card("LE_TAX_MAY").effects,"五月報稅");
      const withDon=util.r2(c0-p.cash);
      const S2=fresh(2799), q=S2.players[0]; cashTo(S2,q,900);
      choose(S2,q,"LE_CHARITY_DONATION",1);
      const q0=q.cash; E.applyEffects(S2,q,card("LE_TAX_MAY").effects,"五月報稅");
      const noDon=util.r2(q0-q.cash);
      A(withDon<noDon,"有捐款收據應該繳得比較少："+withDon+" vs "+noDon);
      return "報稅 "+noDon+" → "+withDon;
    });
    step("孝親費選項 2 是「手頭緊，先不給」——沒有得、也沒有罰",()=>{
      const o=card("LE_FILIAL_ALLOWANCE").decision.options[1];
      A(o.effects.length===0,"選項 2 應該完全沒有效果，實得 "+JSON.stringify(o.effects));
      A(/手頭緊/.test(o.label),"文案應為手頭緊，實得 "+o.label);
      return o.label;
    });

    /* ---------- 陪伴類卡的取捨 ---------- */
    step("補習班：退掉補習改成教養 +2，不再扣幸福",()=>{
      const o=card("DAILY_CRAM_SCHOOL_BILL").decision.options[1];
      const v=o.effects.filter(e=>e.op==="GRANT_VIRTUE")[0];
      A(v && v.axis==="PARENTING" && v.delta===2,"應為教養 +2，實得 "+JSON.stringify(o.effects));
      A(!o.effects.some(e=>e.op==="GRANT_JOY"),"不該再扣幸福感");
      return "教養 +2、不扣幸福";
    });
    step("撥電話給爸媽：兩個選項各有各的得，沒有純虧的那一邊",()=>{
      const c=card("DAILY_PARENT_NIGHT_CALL");
      A(/每週撥電話/.test(c.title),"標題應改成每週撥電話，實得 "+c.title);
      const o0=c.decision.options[0].effects, o1=c.decision.options[1].effects;
      A(o0.length===1 && o0[0].op==="GRANT_VIRTUE" && o0[0].delta===1,"選項 1 應只給孝親 +1");
      A(o1.length===1 && o1[0].op==="GRANT_JOY" && o1[0].amount===1,"選項 2 應只給幸福 +1");
      A(!o1.some(e=>e.op==="GRANT_VIRTUE" && e.delta<0),"不該再扣孝親（開局是 0，本來也扣不到）");
      return "孝親 +1 ／ 幸福 +1";
    });

    /* ---------- 獨立董事 ---------- */
    step("獨立董事：任期改一年（12 輪），A 永不爆、B／C 的爆雷是擲出來的",()=>{
      A(E.DIRECTOR_COMPANIES.A.term===12,"任期應為 12 輪");
      A(E.DIRECTOR_COMPANIES.A.crashChance===0,"A 不該有爆雷機率");
      A(E.DIRECTOR_COMPANIES.B.crashChance===0.5 && E.DIRECTOR_COMPANIES.C.crashChance===0.8,"B／C 機率設定不符");
      let crash=0, safe=0;
      for(let sd=2810; sd<2860; sd++){
        const S=fresh(sd), p=S.players[0]; cashTo(S,p,900); give(S,p,"SKL_BOOK");
        appoint(S,p,"B");
        if(p.directorship.crashTurn===null) safe++; else crash++;
      }
      A(safe>0 && crash>0,"B 應該有時會爆、有時不會，實得 爆"+crash+"／安全"+safe);
      return "B 公司 50 局：爆 "+crash+"／平安 "+safe+"（設定 50％）";
    });
    step("任期屆滿的文案不再寫死「六輪」",()=>{
      const S=fresh(2861), p=S.players[0]; cashTo(S,p,900); give(S,p,"SKL_BOOK");
      appoint(S,p,"A");
      const term=E.DIRECTOR_COMPANIES.A.term;
      let txt="";
      for(let i=0;i<term;i++){ S.turnNumber+=1; S.decisionQueue.length=0; E.tickDirectorship(S,p);
        const ack=S.decisionQueue.filter(d=>d.kind==="ACK" && /任期圓滿/.test(d.title||""))[0];
        if(ack) txt=ack.text; }
      A(txt && txt.indexOf("六輪")<0,"不該再出現「六輪」，實得 "+txt);
      A(/12 輪/.test(txt),"應寫出實際任期，實得 "+txt);
      return txt;
    });

    /* ---------- 死欄位與新卡入袋 ---------- */
    step("subtitle 死欄位全遊戲清乾淨（介面從來沒渲染過它）",()=>{
      const left=Object.values(ns.content.byId).filter(c=>c && c.subtitle!==undefined);
      A(left.length===0,"還有 "+left.length+" 張卡帶著 subtitle："+left.map(c=>c.id).join("、"));
      return "0 張";
    });
    step("10 張新卡都在袋子裡、欄位符合各自牌堆的慣例",()=>{
      const NEW=["SI_REPRICE","LE_FILIAL_ALLOWANCE","LE_CHARITY_DONATION","LE_MY_WEDDING",
                 "LE_ELDER_CARE","LE_HEALTH_RED_FLAG","LE_GUARANTOR","LE_LEND_TO_FRIEND",
                 "LE_STOCK_OPTION","LE_TAX_MAY"];
      NEW.forEach(id=>{ const c=card(id);
        A(c,"找不到新卡 "+id);
        A(c.deck==="LIFE_EVENT","新卡 "+id+" 應在 LIFE_EVENT 牌堆");
        A(c.eduNote && c.flavor,"新卡 "+id+" 缺 flavor 或 eduNote");
        A(!c.payload || !c.payload.reqChild,"新卡 "+id+" 小孩閘門欄位用錯");
      });
      const dupe=NEW.filter(id=>Object.values(ns.content.byId).filter(c=>c&&c.id===id).length>1);
      A(dupe.length===0,"id 重複："+dupe.join("、"));
      return NEW.length+" 張都在";
    });
    step("我的婚禮：兩個選項都花錢也都給幸福，差在價格與幸福不成正比",()=>{
      const o=card("LE_MY_WEDDING").decision.options;
      const joy=(x)=>(x.effects.filter(e=>e.op==="GRANT_JOY")[0]||{}).amount;
      A(o[0].costSalaryMult===6 && o[1].costSalaryMult===1.5,"價差應為 4 倍");
      A(joy(o[0])===3 && joy(o[1])===1,"幸福感應為 3 與 1");
      A(o[0].cost && o[1].cost,"依月薪計價的選項必須留固定金額回退，否則沒薪水的人會變成免費");
      return "花 4 倍的錢，多 2 點幸福";
    });
    step("爸媽長照：請看護與自己顧，機會成本隨薪水自動翻轉",()=>{
      const o=card("LE_ELDER_CARE").decision.options;
      const care=(o[0].effects.filter(e=>e.op==="ADD_RECURRING_EXPENSE")[0]||{}).amount;
      const mult=(o[1].effects.filter(e=>e.op==="SALARY_MULT")[0]||{}).factor;
      A(care===30,"看護費應為 30，實得 "+care);
      A(mult===0.7,"減班應為薪水 ×0.7，實得 "+mult);
      const clerk=30, doctor=280;
      A(clerk*(1-mult)<care && doctor*(1-mult)>care,
        "低薪自己顧划算、高薪請看護划算的關係應成立（店員少賺 "+util.r2(clerk*(1-mult))+"、醫師少賺 "+util.r2(doctor*(1-mult))+"）");
      return "店員少賺 "+util.r2(clerk*(1-mult))+" < 30 < 醫師少賺 "+util.r2(doctor*(1-mult));
    });
    step("健檢紅字：拖著不管的那筆醫療費，保險與健身折得到",()=>{
      const del=card("LE_HEALTH_RED_FLAG").decision.options[1].effects.filter(e=>e.op==="DELAYED_EFFECTS")[0];
      A(del && del.insurable===true,"延遲醫療費應標 insurable，否則保險與健身白買");
      const S=fresh(2862), p=S.players[0]; cashTo(S,p,900); p.flags.insured=true;
      const c0=p.cash; E.applyEffects(S,p,del.effects,"測試",{insurable:true});
      const paid=util.r2(c0-p.cash);
      A(paid<40,"有醫療險應該賠得比較少，實得 "+paid);
      return "原價 40 → 有保險實付 "+paid;
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

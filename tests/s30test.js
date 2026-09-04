const { chromium } = require('playwright');
/* S30 驗收：一人公司的轉折點（請人／外包）＋ 在職／退休的行為一致性。
   設計意圖：
     ① 起飛之後才開放外包——爬坡期做的是你自己的東西，外包做不出來
     ② 外包是固定月薪不是抽成：小的請不起、大的一定要請，「規模化」長在機制裡
     ③ 被交換掉的不只是錢，是時間槽：一次只顧得了一個，外包才騰得出手去做下一個
     ④ 在職／退休的行為要一致：辭職是「暫停」不是「一筆勾銷」，跌回內圈要重新扛起來
   用法（repo 根目錄）： node tests/s30test.js */
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
    const fresh=(seed)=>{ ui.startCore(seed||3001, util.clone(cfg), MODS, players, {noRules:true}); close(); return ui.S; };
    const card=(id)=>ns.content.byId[id];
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    const start=(S,p,cid)=>{ cashTo(S,p,3000); E.startDigital(S,p,card(cid));
                             return p.digitalAssets[p.digitalAssets.length-1]; };
    const fly=(S,p,cid,inc)=>{ const d=start(S,p,cid);
      d.tier="OK"; d.takeoffIncome=inc||100; d.monthlyIncome=inc||100; d.progress=d.threshold;
      E.syncDigitalAsset(S,p,d); return d; };

    /* ---------- ① 外包的開放條件 ---------- */
    step("爬坡期不能外包——那個階段做的是你自己的東西",()=>{
      const S=fresh(3001), p=S.players[0];
      const d=start(S,p,"DIG_COURSE");
      A(d.tier===null,"測試前提：應在爬坡期");
      A(E.setDigitalStaff(S,p,d,true)===false,"爬坡期不該請得動人");
      A(!d.staffed,"不該被標成已外包");
      return "爬坡期拒絕外包";
    });
    step("起飛之後可以請人：付固定月薪、時間槽空出來",()=>{
      const S=fresh(3002), p=S.players[0];
      const d=fly(S,p,"DIG_CIRCLE",100);
      p.tending=d.id;
      const e0=p.derived.totalExpenses, cost=E.digitalStaffCost(S,p);
      A(cost>0,"應有月薪設定，實得 "+cost);
      A(E.setDigitalStaff(S,p,d,true),"起飛後應請得動人");
      A(d.staffed && d.staffCost===cost,"應標成已外包並記下月薪");
      A(Math.abs(p.derived.totalExpenses-(e0+cost))<0.01,
        "每月支出應增加 "+cost+"，實得 "+util.r2(p.derived.totalExpenses-e0));
      A(p.tending!==d.id,"時間槽應該空出來——這才是外包真正買到的東西");
      return "月薪 "+cost+"、時間槽已釋放";
    });
    step("外包＝有人在顧：停更也不會衰減",()=>{
      const S=fresh(3003), p=S.players[0];
      const d=fly(S,p,"DIG_SHORTS",100);      // 流量型，衰減最快
      E.setDigitalStaff(S,p,d,true);
      p.tending=null;
      for(let i=0;i<15;i++){ S.turnNumber++; E.tickDigital(S,p); }
      A(!d.dead && d.monthlyIncome===100,"外包後不該衰減，實得 "+d.monthlyIncome+(d.dead?"（已死）":""));
      // 對照：同一張卡不外包、也不顧，會掉到歸零
      const S2=fresh(3004), q=S2.players[0];
      const d2=fly(S2,q,"DIG_SHORTS",100);
      q.tending=null;
      let n=0; while(!d2.dead && n<40){ S2.turnNumber++; E.tickDigital(S2,q); n++; }
      A(d2.dead,"沒外包也沒顧，應該會歸零");
      return "外包 15 輪不掉；沒外包 "+n+" 輪歸零";
    });
    step("收回自己顧：月薪停掉、旗標清乾淨",()=>{
      const S=fresh(3005), p=S.players[0];
      const d=fly(S,p,"DIG_CIRCLE",100);
      const e0=p.derived.totalExpenses;
      E.setDigitalStaff(S,p,d,true);
      E.setDigitalStaff(S,p,d,false);
      A(!d.staffed && d.staffCost===0,"旗標與成本都要清掉");
      A(Math.abs(p.derived.totalExpenses-e0)<0.01,"支出應回到原值，實得 "+p.derived.totalExpenses+" vs "+e0);
      return "一開一關，支出回到原點";
    });
    step("小的請不起、大的一定要請——固定月薪讓規模化長在機制裡",()=>{
      const S=fresh(3006), p=S.players[0];
      const cost=E.digitalStaffCost(S,p);
      const small=util.r2(card("DIG_EBOOK").payload.baseIncome*E.digitalIncomeMult(S));
      const big=util.r2(card("DIG_CIRCLE").payload.baseIncome*E.digitalIncomeMult(S)*4.5);
      A(small-cost < small*0.5,"小資產外包後淨額應被吃掉大半："+small+" → "+util.r2(small-cost));
      A(big-cost > big*0.8,"大資產外包後淨額應該還很漂亮："+big+" → "+util.r2(big-cost));
      return "電子書 "+small+"→"+util.r2(small-cost)+"；付費社群爆紅 "+big+"→"+util.r2(big-cost);
    });
    step("收掉資產時，人也要一起結束（不能留下孤兒支出）",()=>{
      const S=fresh(3007), p=S.players[0];
      const d=fly(S,p,"DIG_CIRCLE",100);
      const e0=p.derived.totalExpenses;
      E.setDigitalStaff(S,p,d,true);
      E.dropDigital(S,p,d,"測試關閉");
      A(Math.abs(p.derived.totalExpenses-(e0-d.monthlyCost*0))<0.01+d.monthlyCost,
        "支出不該殘留外包月薪，實得 "+p.derived.totalExpenses);
      A(!d.staffed && d.staffCost===0,"外包旗標要清掉");
      return "資產收掉、人也結束";
    });

    /* ---------- ② 在職／退休的一致性 ---------- */
    step("辭職圓夢：還沒起飛的東西跟著結束（跟副業同一個道理）",()=>{
      const S=fresh(3008), p=S.players[0];
      const climbing=start(S,p,"DIG_COURSE");
      const flown=fly(S,p,"DIG_NEWS",50);
      E.enterOuterCircle(S,p);
      A(climbing.dead,"爬坡中的應該收掉");
      A(!flown.dead && flown.monthlyIncome===50,"已起飛的應該保留");
      return "未起飛收掉、已起飛保留";
    });
    step("辭職是「暫停」不是「一筆勾銷」：跌回內圈要重新扛起維護費與外包月薪",()=>{
      const S=fresh(3009), p=S.players[0];
      const d=fly(S,p,"DIG_TOOL",100);
      const mc=d.monthlyCost;
      A(mc>0,"測試前提：這張應有月費，實得 "+mc);
      E.setDigitalStaff(S,p,d,true);
      const stc=d.staffCost;
      E.enterOuterCircle(S,p);
      A(d.monthlyCost===0 && !d.staffed,"外圈應停掉維護費與外包");
      A(d.pausedCost && d.pausedCost.monthly===mc && d.pausedCost.staff===stc,"應記下暫停前的金額");
      E.freefall(S,p,{voluntary:true});
      A(d.monthlyCost===mc,"跌回內圈維護費應恢復成 "+mc+"，實得 "+d.monthlyCost);
      A(d.staffed && d.staffCost===stc,"跌回內圈外包也應恢復，實得 "+d.staffCost);
      return "維護 "+mc+"、外包 "+stc+" 都恢復了";
    });
    step("外圈不再進修——引擎與電腦的行為一致（原本引擎沒擋、電腦擋了）",()=>{
      const S=fresh(3010), p=S.players[0];
      p.playerStage="OUTER"; S.phase="ROLL"; S.activePlayerIdx=0;
      S.decisionQueue.length=0; S.pendingDecision=null;
      cashTo(S,p,3000);
      const sid=(S.skillSample||[])[0];
      E._events.length=0;
      const r=E.apply(S,{type:"START_SKILL",playerId:p.id,payload:{skillId:sid}},{mutate:true});
      const why=(E._events.filter(x=>x.type==="ACTION_REJECTED")[0]||{}).reason;
      A(r.rejected,"外圈主動進修應被拒，實得：竟然成功");
      A(why==="NOT_INNER","被拒的理由應為 NOT_INNER，實得 "+why);
      A(!ns.npc.skillToLearn(S,p),"電腦在外圈本來就不學——兩邊要一致");
      return "兩邊都擋（NOT_INNER）";
    });
    step("外圈不再切換經營對象：已起飛的本來就不衰減，不需要顧",()=>{
      const S=fresh(3011), p=S.players[0];
      const d=fly(S,p,"DIG_NEWS",50);
      p.playerStage="OUTER"; S.phase="ROLL"; S.activePlayerIdx=0;
      S.decisionQueue.length=0; S.pendingDecision=null;
      E._events.length=0;
      const r=E.apply(S,{type:"TEND_DIGITAL",playerId:p.id,payload:{digitalId:d.id}},{mutate:true});
      const why1=(E._events.filter(x=>x.type==="ACTION_REJECTED")[0]||{}).reason;
      A(r.rejected && why1==="NOT_INNER","外圈切換經營對象應被拒，實得 "+(r.rejected?why1:"竟然成功"));
      E._events.length=0;
      const r2=E.apply(S,{type:"STAFF_DIGITAL",playerId:p.id,payload:{digitalId:d.id,on:true}},{mutate:true});
      const why2=(E._events.filter(x=>x.type==="ACTION_REJECTED")[0]||{}).reason;
      A(r2.rejected && why2==="NOT_INNER","外圈也不需要外包（不衰減），應被拒，實得 "+(r2.rejected?why2:"竟然成功"));
      return "TEND 與 STAFF 在外圈都擋";
    });
    step("外圈長尾照樣不衰減（S12 的既有設計沒被動到）",()=>{
      const S=fresh(3012), p=S.players[0];
      const d=fly(S,p,"DIG_SHORTS",100);
      E.enterOuterCircle(S,p);
      for(let i=0;i<20;i++){ S.turnNumber++; E.tickDigital(S,p); }
      A(!d.dead && d.monthlyIncome===100,"外圈不該衰減，實得 "+d.monthlyIncome);
      return "外圈 20 輪不掉";
    });
    step("電腦的請人判斷：收入不到月薪兩倍就不請（保守基準線）",()=>{
      const S=fresh(3013), np=S.players[1];
      const cost=E.digitalStaffCost(S,np);
      cashTo(S,np,3000);
      const small=fly(S,np,"DIG_EBOOK",util.r2(cost*1.2));
      E.pushDecision(S,np,{kind:"DIGITAL_RESULT", digitalId:small.id, cardId:small.cardId,
                           tier:"OK", income:small.monthlyIncome, staffCost:cost});
      E.syncPhase(S);
      A(ns.npc.decide(S,np,S.pendingDecision).payload.optionId==="ok","收入不夠時不該請人");
      S.decisionQueue.length=0; S.pendingDecision=null; E.syncPhase(S);
      const big=fly(S,np,"DIG_CIRCLE",util.r2(cost*3));
      E.pushDecision(S,np,{kind:"DIGITAL_RESULT", digitalId:big.id, cardId:big.cardId,
                           tier:"HIT", income:big.monthlyIncome, staffCost:cost});
      E.syncPhase(S);
      A(ns.npc.decide(S,np,S.pendingDecision).payload.optionId==="staff","收入夠時應該請人");
      return "1.2 倍不請、3 倍請";
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

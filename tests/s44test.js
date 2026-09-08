const { chromium } = require('playwright');
/* S44 補卡（Brian 2026-09-08 裁示：小額與市場「一定要補，多一些也沒關係」；
   具名店家在條件類似下改店名就好；大額先不動）：
     ① 小額機會 33→85、市場 12→30（開局後實際 pool，不是 JSON 張數）
     ② 新卡數值全部落在該牌堆既有卡算出來的平衡帶內（引擎端重算一次，不只靠 contentcheck）
     ③ 帶教學任務的卡等比例補：吸金盤 2→5、投機不動產 1→3、新創 3→8
     ④ 新的吸金盤真的會爆（isScam 流程走得完）
     ⑤ 新的市場卡效果引擎都吃得下（逐張套用，不得有未知 op 或 NaN）
   用法（repo 根目錄）： node tests/s44test.js */
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
    const four=["我","阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||4400, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const deckOf=(S,d)=>S.decks[d].draw.concat(S.decks[d].discard).map(id=>ns.content.byId[id]).filter(Boolean);

    step("① 小額機會 85 張、市場 30 張（開局後實際牌堆）",()=>{
      const S=fresh(4401);
      const small=deckOf(S,"OPPORTUNITY_SMALL"), mk=deckOf(S,"MARKET");
      A(small.length===85,"小額應 85 張，實得 "+small.length);
      A(mk.length===30,"市場應 30 張，實得 "+mk.length);
      // 大額／特殊這一批不動（Brian 裁示 2）
      A(deckOf(S,"OPPORTUNITY_LARGE").length===25,"大額不該被動到，實得 "+deckOf(S,"OPPORTUNITY_LARGE").length);
      return "小額 85／市場 30／大額 25 不變";
    });
    step("② 小額每一張都落在平衡帶內（事業 3.3–4.4%／吸金盤 3.9–4.6%／租金 0.70–0.95%／成本佔租 8–22%／新創 5–9%）",()=>{
      const S=fresh(4402); const bad=[];
      deckOf(S,"OPPORTUNITY_SMALL").forEach(c=>{
        const p=c.payload||{};
        if(c.kind==="BUSINESS" && p.price>0){
          const r=p.monthlyProfit/p.price*100;
          const lo=p.isScam?3.9:3.3, hi=p.isScam?4.6:4.4;
          if(r<lo||r>hi) bad.push(c.id+" 月利率 "+r.toFixed(2)+"%");
        }
        if(c.kind==="REALESTATE" && p.price>0 && p.monthlyRent>0){
          const y=p.monthlyRent/p.price*100, cr=p.monthlyCost/p.monthlyRent*100;
          if(y<0.70||y>0.95) bad.push(c.id+" 租金報酬 "+y.toFixed(3)+"%");
          if(cr<8||cr>22) bad.push(c.id+" 成本佔租 "+cr.toFixed(1)+"%");
        }
        if(c.kind==="STARTUP" && p.postMoney>0){
          const q=p.investAmount/p.postMoney;
          if(q<0.05||q>0.09) bad.push(c.id+" 稀釋 "+q.toFixed(3));
          if(Math.abs(q-p.equityPct)>0.006) bad.push(c.id+" equityPct 對不起來");
        }
      });
      A(!bad.length,"出帶："+bad.join("；"));
      return "85 張全部在帶內";
    });
    step("③ 教學卡等比例補：吸金盤 5、投機不動產 3、新創 8",()=>{
      const S=fresh(4403), small=deckOf(S,"OPPORTUNITY_SMALL");
      const scam=small.filter(c=>c.payload&&c.payload.isScam);
      const su=small.filter(c=>c.kind==="STARTUP");
      const spec=small.filter(c=>c.kind==="REALESTATE" && c.payload && (c.payload.monthlyRent===0 || c.payload.downPayment>=c.payload.price));
      A(scam.length===5,"吸金盤應 5 張，實得 "+scam.length+"（"+scam.map(c=>c.id)+"）");
      A(su.length===8,"新創應 8 張，實得 "+su.length);
      A(spec.length===3,"投機不動產應 3 張（紅單／法拍／素地），實得 "+spec.length+"（"+spec.map(c=>c.id)+"）");
      scam.forEach(c=>{ A(c.scamWarning===true,c.id+" 缺 scamWarning"); A(c.payload.scamDelayTurns>0,c.id+" 缺 scamDelayTurns"); });
      return "吸金盤 5／投機 3／新創 8";
    });
    step("④ 新的吸金盤買得下去、時間到會爆（本金歸零）",()=>{
      const S=fresh(4404), p=S.players[0];
      const c=ns.content.byId["OPP_CRYPTO_MINER"]; A(c && c.payload.isScam,"缺 OPP_CRYPTO_MINER");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:util.r2(900-p.cash),label:"x"}],{eduTags:["setup"]});
      S.phase="DECISION"; E.pushDecision(S,p,{kind:"BUY",cardId:c.id}); E.syncPhase(S);
      const d=S.pendingDecision||S.decisionQueue[0];
      const r=E.apply(S,{type:"DECIDE",playerId:p.id,payload:{decisionId:d.decisionId,optionId:"buy",params:{}}},{mutate:true});
      A(!r.rejected,"應買得到，實得 "+JSON.stringify((r.events||[]).filter(e=>e.type==="ACTION_REJECTED")));
      const a=p.assets.filter(x=>x.cardId===c.id)[0]; A(a,"應有這筆資產");
      // 走到爆雷輪
      for(let i=0;i<c.payload.scamDelayTurns+1 && !S.over;i++){ S.turnNumber++; E.beginTurn(S); }
      const still=p.assets.filter(x=>x.cardId===c.id)[0];
      A(!still || still.marketValue===0,"到期後本金應歸零或資產消失，實得 "+(still&&still.marketValue));
      return "買入 → "+c.payload.scamDelayTurns+" 輪後歸零";
    });
    step("⑤ 新的市場卡逐張套用：引擎吃得下、不產生 NaN",()=>{
      const S=fresh(4405);
      const news=["MK13","MK14","MK15","MK16","MK17","MK18","MK19","MK20","MK21","MK22","MK23","MK24",
                  "MK25","MK26","MK27","MK28","MK29","MK30"];
      const ok=[];
      news.forEach(id=>{
        const c=ns.content.byId[id]; A(c,"缺卡 "+id);
        A(c.eduNote && c.flavor,id+" 缺 eduNote／flavor");
        const S2=fresh(4405+news.indexOf(id)); const q=S2.players[0];
        // 給他一份房產與一份事業，效果才有東西可以打
        q.assets.push({instanceId:"H",cardId:null,kind:"REALESTATE",name:"測試房",units:1,costBasis:500,
          marketValue:500,monthlyIncome:5,linkedLiabilityId:null,flags:{}});
        q.assets.push({instanceId:"B",cardId:null,kind:"BUSINESS",name:"測試店",units:1,costBasis:200,
          marketValue:200,monthlyIncome:7,linkedLiabilityId:null,flags:{}});
        E.applyEffects(S2,q,c.effects||[],{label:c.title});
        ns.ledger.recompute(q);
        const nums=[q.cash,q.derived.netWorth,q.derived.passiveIncome,q.derived.totalExpenses,
                    q.assets[0].marketValue,q.assets[0].monthlyIncome,q.assets[1].monthlyIncome];
        A(nums.every(x=>typeof x==="number" && isFinite(x)),id+" 套用後出現 NaN／Infinity："+JSON.stringify(nums));
        ok.push(id);
      });
      A(ok.length===18,"應驗完 18 張");
      return "18 張全部套用成功";
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

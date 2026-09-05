const { chromium } = require('playwright');
/* S37 實測回饋五項（Brian 打完一局）：
     ① 減免可見性：分錄帶明細（原價／各段折抵／實付／沒準備本可省）、事件卡列四條鏈、RELIEF_SUMMARY 一律跳
     ② 長尾：爆紅機率降、還可以升（量級不動）；digitalPerGame 6→10；技能卡退出人生牌堆
     ③ 大額／特殊：報酬階梯（不動產 ×1.1／×1.15、事業 ×1.15／×1.3）＋ 不動產自備款 15% ＋ 大戶成數加成
     ④ 盲盒「圓夢靈感」要寫進夢想相簿（修錯：5／5 圓夢卻只有四張蓋章）
   用法（repo 根目錄）： node tests/s37test.js */
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
      ui.startCore(seed||3700, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const give=(p,id)=>{ p.skills[id]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const reg=k=>ns.configRegistry.params.filter(p=>p.key===k)[0];
    const card=id=>ns.content.byId[id];
    const toastN=()=>document.querySelectorAll('#toast .toast').length;
    const clearToast=()=>{ document.getElementById('toast').innerHTML=""; };

    /* ---------- ① 減免可見性 ---------- */
    step("LE12 車禍：有產險＋懂法律 → 分錄帶明細（原價／折抵／實付），沒準備的那條寫「本可省」",()=>{
      const S=fresh(3701), p=S.players[0]; S.config.eventCardRate=1;
      p.flags.propInsured=true; give(p,"SKL_LAW");
      const n=p.ledger.length;
      E.applyEffects(S,p,card("LE12").effects,card("LE12").title,{lifeEvent:true});
      const rows=p.ledger.slice(n);
      A(rows.length===2,"應有兩筆分錄，實得 "+rows.length);
      const fix=rows[0], claim=rows[1];
      A(fix.detail && fix.detail.relief && fix.detail.relief.gross===12 && fix.detail.relief.net===6,"修車：原 12 實付 6，實得 "+JSON.stringify(fix.detail));
      A(fix.detail.relief.saved.length===1 && fix.detail.relief.saved[0].kind==="propertyClaim","修車應記產險理賠");
      A(claim.detail.relief.saved[0].kind==="legal" && claim.detail.relief.net===8,"和解金應記懂法律，實付 8");
      const r=ui.ledgerRow(fix);
      A(/原 12,000/.test(r.note) && /產險理賠 −6,000/.test(r.note) && /實付 6,000/.test(r.note),"每輪紀錄的備註要寫出原價／理賠／實付，實得 "+r.note);
      // 沒準備：missed
      const S0=fresh(3701), q=S0.players[0]; S0.config.eventCardRate=1;
      const n0=q.ledger.length;
      E.applyEffects(S0,q,card("LE12").effects,card("LE12").title,{lifeEvent:true});
      const r0=ui.ledgerRow(q.ledger[n0]);
      A(q.ledger[n0].detail.relief.missed.some(x=>x.kind==="propertyClaim" && x.amount===6),"沒保產險要記「若有產險可省 6」");
      A(/若有產險可省 6,000/.test(r0.note),"備註要寫出本可省多少，實得 "+r0.note);
      return "有準備：原 12,000・產險理賠 −6,000 → 實付 6,000；沒準備：（若有產險可省 6,000）";
    });
    step("減免總結一律跳 toast：有準備 good、沒準備 warn（精簡模式；舊制收進彙總）",()=>{
      const S=fresh(3702), p=S.players[0]; S.config.eventCardRate=1;
      clearToast(); ui.notifyMode="S35";
      p.flags.propInsured=true;
      const evs=[]; const o=E.ev; E.ev=(t,d)=>{ const r=o(t,d); if(t==="RELIEF_SUMMARY") evs.push(r); return r; };
      E.applyEffects(S,p,card("LE12").effects,card("LE12").title,{lifeEvent:true});
      E.ev=o;
      A(evs.length===2,"兩筆效果各發一則 RELIEF_SUMMARY，實得 "+evs.length);
      ui.handleEvents(evs);
      const ts=[].slice.call(document.querySelectorAll('#toast .toast'));
      A(ts.length===2,"精簡模式下減免總結也要跳出來，實得 "+ts.length);
      A(ts.some(t=>/產險理賠/.test(t.textContent) && t.classList.contains("good")),"有準備的那則是 good");
      A(ts.some(t=>/全額自付/.test(t.textContent) && /若有法律常識可省/.test(t.textContent) && t.classList.contains("warn")),"沒準備的那則是 warn 且寫出本可省");
      return ts.map(t=>t.textContent).join(" ｜ ");
    });
    step("事件卡（ACK）列四條鏈的減免明細盒",()=>{
      const S=fresh(3703), p=S.players[0]; S.config.eventCardRate=1;
      p.flags.propInsured=true;
      S.decisionQueue=[]; S.pendingDecision=null;
      E.presentCard(S,p,card("LE12"));
      const d=S.decisionQueue[0]||S.pendingDecision;
      A(d && d.kind==="ACK" && d.reliefs && d.reliefs.length===2,"ACK 應帶兩筆 reliefs，實得 "+JSON.stringify(d&&d.reliefs));
      const box=ui.reliefBox(S,d.reliefs);
      const t=box.textContent;
      A(/產險理賠/.test(t) && /若有法律常識/.test(t) && /實付/.test(t),"明細盒要同時列出有準備與沒準備的，實得 "+t.slice(0,120));
      return "ACK.reliefs=2；明細盒有理賠與本可省";
    });
    step("技能派上用場（SKILL_APPLIED）改成一律跳",()=>{
      clearToast(); ui.notifyMode="S35";
      ui.handleEvents([{type:"SKILL_APPLIED",playerId:ui.myId(),skillId:"SKL_PLUMB",title:"基礎水電",where:"repair",saved:2}]);
      A(toastN()===1,"技能派上用場應跳出來，實得 "+toastN());
      return "1 則";
    });

    /* ---------- ② 長尾 ---------- */
    step("長尾機率：爆紅 18→10%、白工 33→25%、外行 5→3%／50→42%；量級（1.8×、4.5×）不動",()=>{
      A(reg("digitalHitPct").value===0.10 && reg("digitalFlopPct").value===0.25,"本行機率應為 10／25");
      A(reg("digitalAmateurHitPct").value===0.03 && reg("digitalAmateurFlopPct").value===0.42,"外行機率應為 3／42");
      A(reg("digitalIncomeMult").value===1.8 && reg("digitalHitMult").value===4.5,"量級不動（Brian 裁示）");
      A(reg("digitalPerGame").value===10,"每局數位資產卡應為 10");
      // 每張卡：本行做白工 < 外行做白工、本行爆紅 > 外行爆紅（含有自訂機率的三張）
      const S=fresh(3704);
      const mk=()=>{ const T=fresh(3704); return T.players[0]; };
      (ns.content.cards.DIGITAL||[]).forEach(c=>{
        const am=E.digitalOdds(S,mk(),c); const pp=mk(); give(pp,c.requires.indexOf("family:")===0?"SKL_BOOK":c.requires);
        const pr=E.digitalOdds(S,pp,c);
        A(pr.flop<=am.flop && pr.hit>=am.hit, c.id+" 本行不得比外行差：flop "+pr.flop+"/"+am.flop+" hit "+pr.hit+"/"+am.hit);
        A(pr.flop+pr.hit<1 && am.flop+am.hit<1, c.id+" 三種結果機率相加要小於 1");
      });
      return "13 張卡本行皆優於外行且機率合法";
    });
    step("技能卡不再洗進人生牌堆（skillCardsInLifeDeck=0）；=1 回到舊行為",()=>{
      const S=fresh(3705);
      const kinds={}; S.decks.LIFE_EVENT.draw.forEach(id=>{ const c=ns.content.byId[id]; kinds[c.kind]=(kinds[c.kind]||0)+1; });
      A(!kinds.SKILL,"人生牌堆不該有技能卡，實得 "+JSON.stringify(kinds));
      A(kinds.DIGITAL===10,"人生牌堆應有 10 張數位資產卡，實得 "+kinds.DIGITAL);
      A(kinds.SELF_INVEST>0,"翻轉人生卡要留著");
      A((S.skillSample||[]).length>=18,"skillSample 本身要留著給商城用，實得 "+(S.skillSample||[]).length);
      const S1=fresh(3705,{skillCardsInLifeDeck:1});
      const k1={}; S1.decks.LIFE_EVENT.draw.forEach(id=>{ const c=ns.content.byId[id]; k1[c.kind]=(k1[c.kind]||0)+1; });
      A(k1.SKILL>=18,"開關 =1 應回到技能卡在牌堆的行為，實得 "+k1.SKILL);
      return "牌堆 "+S.decks.LIFE_EVENT.draw.length+" 張、數位 10 張、技能 0 張；=1 時技能 "+k1.SKILL+" 張";
    });

    /* ---------- ③ 大額／特殊 ---------- */
    step("報酬階梯：cash-on-cash 年化中位 特殊 > 大額 ≥ 小額（不動產走 20 年房貸、事業全額現金）",()=>{
      const S=fresh(3706);
      const mult={REALESTATE:S.config.assetIncomeMult, BUSINESS:S.config.bizIncomeMult};
      const pmt=(P,r,n)=>{ const m=r/12; return P*m/(1-Math.pow(1+m,-n)); };
      const coc=deck=>{
        const out=[];
        (ns.content.cards[deck]||[]).forEach(c=>{ const pl=c.payload||{}; if(c.kind==="STARTUP") return;
          let dp, net;
          if(c.kind==="REALESTATE"){ const ltv=Math.min(1-pl.downPayment/pl.price, E.effMaxLTV(S,c)); const loan=pl.price*ltv; dp=pl.price-loan;
            net=pl.monthlyRent*mult.REALESTATE-(pl.monthlyCost||0)-pmt(loan,0.02+S.config.mortgageSpread,S.config.mortgageTermMonths); }
          else { dp=pl.price; net=pl.monthlyProfit*mult.BUSINESS; }
          out.push(net*12/dp); });
        out.sort((a,b)=>a-b); return out[Math.floor(out.length/2)];
      };
      const s=coc("OPPORTUNITY_SMALL"), l=coc("OPPORTUNITY_LARGE"), sp=coc("OPPORTUNITY_SPECIAL");
      A(sp>l && l>=s*0.95, "應為 特殊 > 大額 ≥ 小額，實得 小 "+(s*100).toFixed(0)+"% 大 "+(l*100).toFixed(0)+"% 特 "+(sp*100).toFixed(0)+"%");
      return "小 "+(s*100).toFixed(0)+"%　大 "+(l*100).toFixed(0)+"%　特 "+(sp*100).toFixed(0)+"%";
    });
    step("大戶成數：大額／特殊的不動產自備款 15%，且成數上限真的放得開（復甦期一般 80%、大額 85%）",()=>{
      const S=fresh(3707); S.macro.stage="RECOVERY"; S.macro.liquidity=1;
      const big=(ns.content.cards.OPPORTUNITY_LARGE||[]).concat(ns.content.cards.OPPORTUNITY_SPECIAL||[]).filter(c=>c.kind==="REALESTATE");
      A(big.length>=10,"測試前提：大額＋特殊不動產至少 10 張");
      big.forEach(c=>{ const pl=c.payload; A(Math.abs(pl.downPayment/pl.price-0.15)<0.011, c.id+" 自備款應為 15%，實得 "+(pl.downPayment/pl.price)); });
      const small=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(c=>c.kind==="REALESTATE")[0];
      A(Math.abs(E.effMaxLTV(S)-0.8)<1e-9 && Math.abs(E.effMaxLTV(S,small)-0.8)<1e-9,"一般／小額成數應為 80%");
      A(Math.abs(E.effMaxLTV(S,big[0])-0.85)<1e-9,"大額成數應為 85%，實得 "+E.effMaxLTV(S,big[0]));
      const S0=fresh(3707,{bigDealLtvBonus:0}); S0.macro.liquidity=1;
      A(Math.abs(E.effMaxLTV(S0,big[0])-0.8)<1e-9,"bonus=0 應回到 80%（鐵律 4）");
      // 真的買：用貸款買 OPM_RE1（price 3000）自備 450
      const p=S.players[0]; const opm=card("OPM_RE1"); A(opm && opm.kind==="REALESTATE","缺 OPM_RE1");
      ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:2000,label:"x"}],{eduTags:["setup"]});
      const c0=p.cash; E.buyAsset(S,p,opm,"loan",{});
      A(Math.abs((c0-p.cash)-opm.payload.price*0.15)<0.01,"用貸款買中階大額應只付 15% 自備款，實得 "+(c0-p.cash));
      return "15%／85%；OPM_RE1 自備 "+(c0-p.cash);
    });

    /* ---------- ④ 盲盒圓夢靈感 ---------- */
    step("盲盒「圓夢靈感」要寫進夢想相簿、發 DREAM_PROGRESS（修錯）",()=>{
      const S=fresh(3708), p=S.players[0];
      p.dreamProgress=1; p.dreamLog=[];
      S.config.blessingW_VIRTUE=0; S.config.blessingW_GUARDIAN=0; S.config.blessingW_JOY=0; S.config.blessingW_CASH=0; S.config.blessingW_DREAM=100;
      const evs=[]; const o=E.ev; E.ev=(t,d)=>{ const r=o(t,d); evs.push(t); return r; };
      const r=E.drawBlessing(S,p); E.ev=o;
      A(r.prize==="DREAM","測試前提：應抽到圓夢靈感，實得 "+r.prize);
      A(p.dreamProgress===2,"進度應 +1");
      A(p.dreamLog.length===1 && p.dreamLog[0].n===2 && p.dreamLog[0].source==="blessing","相簿要多一張，來源標 blessing，實得 "+JSON.stringify(p.dreamLog));
      A(evs.indexOf("DREAM_PROGRESS")>=0,"要發 DREAM_PROGRESS（全服公告與訊息欄靠它）");
      close(); ui.showDreamAlbum && ui.showDreamAlbum(p.id);
      const ov=document.querySelector('#overlays .overlay');
      if(ov) A(/幸福盲盒/.test(ov.textContent),"相簿要標示這一張是盲盒來的");
      close();
      return "dreamLog +1（blessing）＋ DREAM_PROGRESS";
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

const { chromium } = require('playwright');
/* S29 驗收：長尾／被動收入擴充。
   設計意圖（測試要守住的東西）：
     ① 長尾型態是有差別的——版稅型（寫完就在那裡）不該跟訂閱／流量型（斷更就崩）共用衰減率
     ② 卡片可以覆寫自己的起飛機率（AI 素材的「供給暴增」要在機制上成立，不能只寫在說明裡）
     ③ 技能不是資格、是機率：沒有那門手藝照樣做得起來，只是爬得慢、紅得少
     ④ 標題一律動詞開頭——玩家看到的是「要做什麼」，不是一個名詞
   用法（repo 根目錄）： node tests/s29test.js */
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
    const fresh=(seed)=>{ ui.startCore(seed||2901, util.clone(cfg), MODS, players, {noRules:true}); close(); return ui.S; };
    const card=(id)=>ns.content.byId[id];
    const give=(S,p,sid)=>{ p.skills[sid]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    // 直接把一筆數位資產推到「已起飛」，用來驗衰減
    const flyIt=(S,p,cid)=>{
      cashTo(S,p,3000);
      E.startDigital(S,p,card(cid));
      const d=p.digitalAssets[p.digitalAssets.length-1];
      d.tier="OK"; d.takeoffIncome=100; d.monthlyIncome=100; d.progress=d.threshold;
      return d;
    };

    step("牌堆擴到 13 張，一局出 6 張（不調的話新題材會被稀釋）",()=>{
      const S=fresh(2901);
      A((ns.content.cards.DIGITAL||[]).length===13,"應有 13 張，實得 "+(ns.content.cards.DIGITAL||[]).length);
      A(E.cfg(S,"digitalPerGame")===6,"每局應出 6 張，實得 "+E.cfg(S,"digitalPerGame"));
      A((S.digitalSample||[]).length===6,"本局樣本應為 6 張，實得 "+(S.digitalSample||[]).length);
      return "13 張裡出 6 張（命中率 "+Math.round(6/13*100)+"%）";
    });

    step("標題一律動詞開頭：玩家看到的是「要做什麼」",()=>{
      const VERB=/^(開設|開發|經營|主持|出版|產出|用)/;
      const bad=(ns.content.cards.DIGITAL||[]).filter(c=>!VERB.test(c.title));
      A(!bad.length,"這些標題不是動詞開頭："+bad.map(c=>c.id+"「"+c.title+"」").join("、"));
      return (ns.content.cards.DIGITAL||[]).length+" 張全部動詞開頭";
    });

    step("版稅型：電子書起飛之後，停下來也不會歸零",()=>{
      const S=fresh(2902), p=S.players[0];
      const d=flyIt(S,p,"DIG_EBOOK");
      A(d.decayRate===1,"電子書應鎖定衰減率 1，實得 "+d.decayRate);
      p.tending=null;
      for(let i=0;i<20;i++){ S.turnNumber++; E.tickDigital(S,p); }
      A(!d.dead,"版稅型不該因為停更而死掉");
      A(d.monthlyIncome===100,"版稅型收入不該衰減，實得 "+d.monthlyIncome);
      return "20 輪不顧，收入仍是 "+d.monthlyIncome;
    });
    step("流量型：短影音斷更掉得最快，最後會歸零",()=>{
      const S=fresh(2903), p=S.players[0];
      const d=flyIt(S,p,"DIG_SHORTS");
      A(d.decayRate===0.75,"短影音應鎖定衰減率 0.75，實得 "+d.decayRate);
      p.tending=null;
      let n=0; while(!d.dead && n<40){ S.turnNumber++; E.tickDigital(S,p); n++; }
      A(d.dead,"流量型停更後應該會歸零");
      const S2=fresh(2904), q=S2.players[0];
      const d2=flyIt(S2,q,"DIG_COURSE");          // 沿用全域 0.85
      A(d2.decayRate===null,"沒寫 decayRate 的卡應沿用全域");
      q.tending=null;
      let m=0; while(!d2.dead && m<40){ S2.turnNumber++; E.tickDigital(S2,q); m++; }
      A(n<m,"流量型應該比一般型死得更快："+n+" 輪 vs "+m+" 輪");
      return "短影音 "+n+" 輪歸零、線上課程 "+m+" 輪";
    });

    step("AI 素材：卡片自訂的起飛機率真的吃得到（供給暴增＝做白工機率高）",()=>{
      const S=fresh(2905), p=S.players[0];
      give(S,p,"SKL_PHOTO");
      const od=E.digitalOdds(S,p,card("DIG_AIART"));
      A(od.pro,"有攝影底子應算本行");
      A(Math.abs(od.flop-0.55)<1e-9,"做白工機率應為卡片自訂的 55%，實得 "+od.flop);
      A(Math.abs(od.hit-0.08)<1e-9,"爆紅機率應為卡片自訂的 8%，實得 "+od.hit);
      const S2=fresh(2906), q=S2.players[0];
      const od2=E.digitalOdds(S2,q,card("DIG_AIART"));
      A(!od2.pro,"沒有攝影底子應算外行");
      A(Math.abs(od2.flop-0.70)<1e-9,"外行的做白工機率也要吃卡片自訂值，實得 "+od2.flop);
      give(S,p,"SKL_BOOK");                                  // 本行才比得到「本行的全域值」
      const od3=E.digitalOdds(S,p,card("DIG_COURSE"));
      A(od3.pro,"給了記帳應算本行");
      A(Math.abs(od3.flop-E.cfg(S,"digitalFlopPct"))<1e-9,"沒自訂的卡應沿用全域，實得 "+od3.flop);
      A(Math.abs(od3.hit-E.cfg(S,"digitalHitPct"))<1e-9,"沒自訂的卡爆紅率也應沿用全域，實得 "+od3.hit);
      return "自訂 55%／8%（外行 70%），未自訂的沿用全域";
    });

    step("技能是機率不是資格：沒有那門手藝照樣做得起來",()=>{
      const S=fresh(2907), p=S.players[0];
      const c=card("DIG_SHORTS");
      A(E.cardUsable(S,p,c),"沒學攝影也應該抽得到短影音這張");
      const od=E.digitalOdds(S,p,c);
      A(od.threshold>0,"外行人仍有一條爬坡路，實得 "+od.threshold);
      A(od.amateurThreshold>od.proThreshold,"外行人要爬比較久");
      A(od.amateurHit<od.proHit,"外行人爆紅機率比較低");
      return "外行 "+od.amateurThreshold+" 輪／爆紅 "+util.pct(od.amateurHit,0)
           + "　本行 "+od.proThreshold+" 輪／爆紅 "+util.pct(od.proHit,0);
    });
    step("付費社群用家族當條件：財務或法律底子都算本行",()=>{
      const S=fresh(2908), p=S.players[0];
      const c=card("DIG_CIRCLE");
      A(c.requires==="family:FINANCE","應以家族為條件，實得 "+c.requires);
      A(!E.digitalOdds(S,p,c).pro,"什麼都沒學不算本行");
      give(S,p,"SKL_LAW");
      A(E.digitalOdds(S,p,c).pro,"法律常識屬 FINANCE 家族，應算本行");
      return "family:FINANCE 判定正確";
    });

    step("七張新題材都在，欄位齊全、量級沒有偏離既有的六張",()=>{
      const NEW=["DIG_SHORTS","DIG_SHOP","DIG_GPT","DIG_AIART","DIG_AIAGENCY","DIG_EBOOK","DIG_CIRCLE"];
      NEW.forEach(id=>{
        const c=card(id); A(c,"找不到 "+id);
        const pl=c.payload||{};
        ["cost","monthlyCost","threshold","baseIncome"].forEach(k=>
          A(isFinite(pl[k]),id+" 缺欄位 "+k));
        A(pl.cost<=35 && pl.baseIncome<=26,id+" 量級偏離既有六張（建置 ≤35、基礎月收 ≤26）");
        A(c.eduNote && c.flavor,id+" 缺 flavor 或 eduNote");
        A(c.requires,id+" 應標一門手藝（影響機率，不是資格）");
      });
      return NEW.length+" 張都在";
    });
    step("同一門手藝不該壟斷太多題材",()=>{
      const req={};
      (ns.content.cards.DIGITAL||[]).forEach(c=>{ if(c.requires) req[c.requires]=(req[c.requires]||0)+1; });
      const keys=Object.keys(req), max=Math.max.apply(null,keys.map(k=>req[k]));
      A(keys.length>=6,"應涵蓋至少 6 種手藝，實得 "+keys.length);
      A(max<=3,"單一手藝最多 3 種題材，實得 "+max);
      return keys.length+" 種手藝、單一最多 "+max+" 種題材";
    });
    step("廣播型通知收進彙總：景氣調整與持股評價不再一則一則跳",()=>{
      const S=fresh(2909), p=S.players[0];
      let shown=0;
      const orig=ui.toast;
      ui.toast=function(msg,cls,ms,topic){ if(!ui.toastMuted(cls,topic)) shown++; return orig.apply(ui,arguments); };
      try{
        E._events.length=0;
        E.ev("BIZ_CYCLE_ADJ",{playerId:p.id, assetName:"測試事業", delta:-50});
        E.ev("HOLDINGS_REVALUED",{playerId:p.id, delta:-30});
        ui.handleEvents(E._events.slice());
      } finally { ui.toast=orig; }
      A(shown===0,"這兩則應該收進彙總，實得跳了 "+shown+" 則");
      return "兩則都靜音（進彙總）";
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

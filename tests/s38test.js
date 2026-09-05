const { chromium } = require('playwright');
/* S38 人生商城五項（Brian 看過商城截圖後的裁示）：
     ① 每一類依金額由小到大排（上到下、左到右）
     ② 健康身心：新增「小孩近視預防」10 萬／幸福 +2／教養 +1；牙齒矯正改幸福 +3／教養 +1
     ③ 人情品格：新增「身心靈成長營」6.6 萬／幸福 +1／情緒・守法・教養各 +1；安太座改幸福 +2＋同三軸
     ④ 挑戰比賽：新增「海外電競大賽」5 萬／幸福 +3／擲骰決定獎金；任何比賽拿過獎金後本局不能再報同一場
     ⑤ 好市多：一次 1 萬、每月支出少 1,000
   用法（repo 根目錄）： node tests/s38test.js */
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
      ui.startCore(seed||3800, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const card=id=>ns.content.byId[id];
    const cashTo=(S,p,v)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:util.r2(v-p.cash),label:"x"}],{eduTags:["setup"]});
    const buy=(S,p,id)=>{ S.phase="ROLL"; p.mallBoughtThisTurn=0; return E.apply(S,{type:"MALL_BUY",playerId:p.id,payload:{itemId:id}},{mutate:true}); };

    step("① 商城每一類依金額由小到大排（上到下、左到右）",()=>{
      const S=fresh(3801), p=S.players[0]; cashTo(S,p,3000);
      close(); ui.showMall();
      const ov=document.querySelector('#overlays .overlay');
      const groups=[].slice.call(ov.querySelectorAll('.mallGroup'));
      A(groups.length>=5,"至少 5 個分類，實得 "+groups.length);
      let checked=0;
      groups.forEach(g=>{
        const grid=g.nextElementSibling; if(!grid) return;
        const titles=[].slice.call(grid.querySelectorAll('.mallItem .tt')).map(x=>x.textContent);
        const items=titles.map(t=>ui.mallItems().filter(it=>it.title===t)[0]).filter(Boolean);
        const keys=items.map(it=>E.mallSortKey(S,it,p));
        for(let i=1;i<keys.length;i++) A(keys[i]>=keys[i-1], g.textContent+" 未依金額排序："+titles.join(" > ")+" 鍵 "+keys.join(","));
        checked+=keys.length;
      });
      close();
      return checked+" 件商品全部依金額遞增";
    });
    step("② 健康身心：小孩近視預防（10 萬／+2／教養）＋ 牙齒矯正改 +3／教養",()=>{
      const c=card("ML_HEA4"); A(c && c.group==="健康身心","缺 ML_HEA4");
      A(c.payload.cost===100 && c.payload.joy===2 && c.payload.virtue==="PARENTING" && c.payload.reqChild===true,"近視預防數值不對："+JSON.stringify(c.payload));
      const t=card("ML_HEA3"); A(t.payload.joy===3 && t.payload.virtue==="PARENTING","牙齒矯正應改 +3／教養，實得 "+JSON.stringify(t.payload));
      const S=fresh(3802), p=S.players[0]; cashTo(S,p,500); p.childrenCount=1; p.virtues.PARENTING=0;
      const r=buy(S,p,"ML_HEA4"); A(!r.rejected,"應買得到，實得 "+r.reason);
      A(p.virtues.PARENTING===1,"買近視預防應點亮教養 +1");
      return "兩張卡數值正確；購買後教養 +1";
    });
    step("③ 人情品格：身心靈成長營一次點三軸；安太座改 +2 且點三軸",()=>{
      const c=card("ML_VIR6"); A(c && c.group==="人情品格" && c.payload.cost===66 && c.payload.joy===1,"成長營數值不對");
      A(JSON.stringify(E.mallVirtues(c).slice().sort())===JSON.stringify(["PARENTING","PRUDENCE","TEMPER"]),"成長營應點情緒・守法・教養");
      const v5=card("ML_VIR5"); A(v5.payload.joy===2 && E.mallVirtues(v5).length===3,"安太座應改 +2 並點三軸");
      const S=fresh(3803), p=S.players[0]; cashTo(S,p,500);
      p.virtues.TEMPER=0; p.virtues.PRUDENCE=0; p.virtues.PARENTING=0; p.virtues.FILIAL=0;
      const r=buy(S,p,"ML_VIR6"); A(!r.rejected,"應買得到，實得 "+r.reason);
      A(p.virtues.TEMPER===1 && p.virtues.PRUDENCE===1 && p.virtues.PARENTING===1 && p.virtues.FILIAL===0,"三軸各 +1、孝親不動，實得 "+JSON.stringify(p.virtues));
      const single=card("ML_VIR1"); A(E.mallVirtues(single).length===1 && E.mallVirtues(single)[0]==="FILIAL","單軸的舊寫法要照舊");
      close(); ui.showMall();
      const ov=document.querySelector('#overlays .overlay');
      const btn=[].slice.call(ov.querySelectorAll('.mallItem')).filter(b=>/身心靈成長營/.test(b.textContent))[0];
      A(btn && /情緒修養 \+1/.test(btn.textContent) && /守法謹慎 \+1/.test(btn.textContent) && /子女教養 \+1/.test(btn.textContent),"卡面要列出三軸，實得 "+(btn&&btn.textContent));
      close();
      return "三軸各 +1；卡面列三軸";
    });
    step("④ 海外電競大賽（5 萬／+3／擲骰）；拿過獎金的比賽本局不能再報，沒拿到的可以再試",()=>{
      const c=card("ML_CMP6"); A(c && c.payload.cost===50 && c.payload.joy===3 && c.payload.contest && c.payload.contest.length>=3,"電競大賽數值不對");
      A(c.payload.contest[0].prize>=c.payload.contest[1].prize && c.payload.contest[c.payload.contest.length-1].prize===0,"獎金階梯要遞減到 0");
      const S=fresh(3804), p=S.players[0]; cashTo(S,p,500);
      // 直接模擬拿獎：走 CONTEST_ROLL 決策，找一個會拿獎的種子狀態
      const r=buy(S,p,"ML_CMP1"); A(!r.rejected,"報名應成功");
      const d=S.pendingDecision||S.decisionQueue[0]; A(d && d.kind==="CONTEST_ROLL","報名後應有擲骰決策");
      // 用引擎的 resolveDecision 跑到有獎金為止（骰子由種子決定；最多試幾個新局）
      let won=false, tries=0, S2=S, p2=p;
      while(!won && tries++<8){
        const dd=S2.pendingDecision||S2.decisionQueue[0];
        S2.decisionQueue.shift(); S2.pendingDecision=null;
        E.resolveDecision(S2,p2,dd,"roll",{});
        if(p2.contestWon && p2.contestWon["ML_CMP1"]) won=true;
        else { S2=fresh(3804+tries); p2=S2.players[0]; cashTo(S2,p2,500); const rr=buy(S2,p2,"ML_CMP1"); A(!rr.rejected,"重試報名應成功"); }
      }
      A(won,"8 個種子內應至少一次拿到獎金（測試前提）");
      S2.decisionQueue=[]; S2.pendingDecision=null; p2.mallLastBuy={};
      const again=buy(S2,p2,"ML_CMP1");
      const why=(again.events||[]).filter(e=>e.type==="ACTION_REJECTED").map(e=>e.reason).pop();
      A(again.rejected && why==="CONTEST_WON","拿過獎金應被拒 CONTEST_WON，實得 "+JSON.stringify(why));
      A(!buy(S2,p2,"ML_CMP4").rejected,"沒拿過獎金的另一場仍可報名");
      S2.decisionQueue=[]; S2.pendingDecision=null; E.syncPhase && E.syncPhase(S2); p2.mallBoughtThisTurn=0;   // 收掉剛報名的擲骰決策與本輪額度，才看得到「拿過獎金」這條理由
      A(ns.npc.canBuyMall(S2,p2,card("ML_CMP1"))===false,"電腦的前置檢查也要擋");
      close(); ui.showMall();
      const ov=document.querySelector('#overlays .overlay');
      const btn=[].slice.call(ov.querySelectorAll('.mallItem')).filter(b=>/城市馬拉松/.test(b.textContent))[0];
      A(btn && btn.disabled && /拿過獎金/.test(btn.title),"卡面要停用並說明，實得 "+(btn&&btn.title));
      close();
      return "拿獎後 CONTEST_WON；別場照報；介面停用並說明";
    });
    step("⑤ 好市多：一次 1 萬、每月支出少 1,000（支出水位真的往下）",()=>{
      const c=card("ML_LUX5"); A(c.payload.cost===10 && c.payload.recurringMonthly===-1,"好市多數值不對："+JSON.stringify(c.payload));
      const S=fresh(3805), p=S.players[0]; cashTo(S,p,500);
      const e0=p.derived.totalExpenses, c0=p.cash;
      const r=buy(S,p,"ML_LUX5"); A(!r.rejected,"應買得到，實得 "+r.reason);
      A(Math.abs((c0-p.cash)-10)<0.01,"應付 10，實得 "+(c0-p.cash));
      A(Math.abs((e0-p.derived.totalExpenses)-1)<0.01,"月支出應少 1，實得 "+(e0-p.derived.totalExpenses));
      close(); ui.showMall();
      const ov=document.querySelector('#overlays .overlay');
      const btn=[].slice.call(ov.querySelectorAll('.mallItem')).filter(b=>/好市多/.test(b.textContent))[0];
      A(btn && /每月省 1,000/.test(btn.textContent),"卡面要寫「每月省 1,000」，實得 "+(btn&&btn.textContent));
      close();
      return "付 10、月支出 −1、卡面「每月省 1,000」";
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

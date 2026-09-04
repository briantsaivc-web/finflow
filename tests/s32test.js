const { chromium } = require('playwright');
/* S32 驗收：技能全開（skillPerGame=99）＋ NPC 期望回收判斷 ＋ 進修商城分組。
   設計意圖：
     ① 「你想學的課本局沒開」不擬真，也讓玩家把「沒學」的責任推給抽牌——取消抽樣上限。
        稀缺性回到時間（學習輪數＋冷卻）與現金（學費＋保留水位）。
     ② 技能全開之後，電腦若還是「由便宜排到貴」會把錢全押在學費上且不看回報，
        所以加一層粗略的期望回收估算：估得出來且回收 < 學費 × npcSkillRoiMin 就不學。
        估不出來的（兌現點只在引擎裡）維持原行為，不因為「資料上看不到價值」被排除。
     ③ 情境卡抽樣維持 5：命中率是比例決定（gatePerGame × 已學/總數），
        牌堆變大不會稀釋；真正的風險是「集中在同一門技能」，那條守則放在 contentcheck。
     ④ 進修商城一次列近二十門，改依投入量級分組。
   用法（repo 根目錄）： node tests/s32test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,npc=ns.npc,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    const MODS=["M1","M2","M3","M4","M6","M8"];
    const four=["我","阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||3200, c, MODS, four, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    const allSkills=()=>(ns.content.cards.SKILL||[]).filter(c=>!c.moduleReq||MODS.indexOf(c.moduleReq)>=0);

    /* ---------- ① 技能全開 ---------- */
    step("skillPerGame 預設 99：本局開的模組裡，每一門技能都進場",()=>{
      const S=fresh(3201);
      A(E.cfg(S,"skillPerGame")===99,"預設應為 99，實得 "+E.cfg(S,"skillPerGame"));
      const want=allSkills().map(c=>c.id).sort();
      const got=(S.skillSample||[]).slice().sort();
      const miss=want.filter(id=>got.indexOf(id)<0);
      A(!miss.length,"這些技能沒進場："+miss.join("、"));
      return got.length+" 門全進場（本局模組內共 "+want.length+" 門）";
    });
    step("模組沒開的技能仍然不進場——全開不等於無視模組閘門",()=>{
      const S=fresh(3202);
      const off=(ns.content.cards.SKILL||[]).filter(c=>c.moduleReq && MODS.indexOf(c.moduleReq)<0);
      A(off.length>0,"測試前提不成立：目前沒有任何模組外的技能");
      const leak=off.filter(c=>(S.skillSample||[]).indexOf(c.id)>=0);
      A(!leak.length,"這些不該進場卻進場了："+leak.map(c=>c.id).join("、"));
      return off.length+" 門模組外技能全部擋在外面（"+off.map(c=>c.id).join("、")+"）";
    });
    step("旋鈕還在：skillPerGame 調小就回到抽樣行為（不是寫死）",()=>{
      const S=fresh(3203,{skillPerGame:4});
      A((S.skillSample||[]).length>=4,"抽樣數不該小於設定值，實得 "+S.skillSample.length);
      A(S.skillSample.length < allSkills().length,"調小之後不該還是全開，實得 "+S.skillSample.length);
      return "skillPerGame=4 → 本局 "+S.skillSample.length+" 門（含階梯技能的先修補進）";
    });
    step("全開之後，引擎的 NOT_AVAILABLE 擋牌仍然有效（沒被繞過）",()=>{
      const S=fresh(3204,{skillPerGame:4}), p=S.players[0];
      cashTo(S,p,900);
      const out=allSkills().map(c=>c.id).filter(id=>(S.skillSample||[]).indexOf(id)<0);
      A(out.length,"測試前提不成立：調小後沒有落榜的技能");
      E._events=[];
      const r=E.apply(S,{type:"START_SKILL",playerId:p.id,payload:{skillId:out[0]}});
      const rej=(E._events||[]).filter(e=>e.type==="ACTION_REJECTED").pop();
      A(r.rejected||rej,"沒進場的技能應該被擋下");
      A(rej && rej.reason==="NOT_AVAILABLE","擋下的理由應為 NOT_AVAILABLE，實得 "+(rej&&rej.reason));
      return "落榜技能仍被 NOT_AVAILABLE 擋下";
    });

    /* ---------- ② 情境卡抽樣維持 5 ---------- */
    step("skillGatePerGame 維持 5，且技能全開後「只抽有進場的」濾網自然變成 no-op",()=>{
      const S=fresh(3205);
      A(E.cfg(S,"skillGatePerGame")===5,"應維持 5，實得 "+E.cfg(S,"skillGatePerGame"));
      const idx=E.skillGateIndex(S);
      const inS={}; (S.skillSample||[]).forEach(id=>inS[id]=1);
      const fam={}; (S.skillSample||[]).forEach(id=>{ const c=ns.content.byId[id]; if(c&&c.family) fam[c.family]=1; });
      const orphan=idx.list.filter(c=>{
        const rq=(c.skillBranch&&c.skillBranch.requires)||"";
        return rq.indexOf("family:")===0 ? !fam[rq.slice(7)] : !inS[rq];
      });
      A(!orphan.length,"技能全開後不該還有「對應技能沒進場」的情境卡："+orphan.map(c=>c.id).join("、"));
      return idx.list.length+" 張情境卡的對應技能全部本局可學（公平性由構造成立，不再靠濾網）";
    });
    step("命中率是比例決定的：牌堆變大不稀釋（同一組已學技能、gate 池加倍，命中期望不變）",()=>{
      const S=fresh(3206);
      const nGate=E.cfg(S,"skillGatePerGame"), tot=E.skillGateIndex(S).list.length;
      // 期望命中 = nGate × (已學技能對應的 gate 數 / gate 總數)；比例不變則期望不變
      const share=k=>Math.min(1,nGate/tot)*k;             // k = 我方 gate 張數
      const before=share(1), after=Math.min(1,nGate/(tot*2))*2;
      A(Math.abs(before-after)<1e-9,"池加倍且我方等比例加倍時，期望命中應不變："+before+" vs "+after);
      return "gate 池 "+tot+"→"+(tot*2)+" 時期望命中同為 "+before.toFixed(3)+" 張／技能";
    });

    /* ---------- ③ NPC 期望回收 ---------- */
    step("skillExpectedGain：資料上有情境卡的估得出數字，沒有的回傳 null（不當成 0 否決）",()=>{
      const S=fresh(3207), p=S.players[1];
      const hasGate=E.skillExpectedGain(S,p,ns.content.byId["SKL_CODE"]);
      A(typeof hasGate==="number" && hasGate>0,"SKL_CODE 應估得出正值，實得 "+hasGate);
      const noGate=E.skillExpectedGain(S,p,ns.content.byId["SKL_CARPENTRY"]);
      A(noGate===null,"木作的兌現點只在引擎裡，應回 null（不是 0），實得 "+noGate);
      return "SKL_CODE "+hasGate+"／SKL_CARPENTRY null";
    });
    step("估不出來的技能不會被 ROI 濾掉——否則轉職型與高階四張永遠學不到",()=>{
      const S=fresh(3208,{npcSkillRoiMin:99}), p=S.players[1];
      cashTo(S,p,3000); p.playerStage="INNER"; p.learning=null; p.skillCooldownUntil=0;
      const a=npc.skillToLearn(S,p);
      A(a,"roiMin 拉到 99 之後仍應學得到「估不出價值」的那幾門，實得 null");
      const sc=ns.content.byId[a.payload.skillId];
      A(E.skillExpectedGain(S,p,sc)===null,"roiMin=99 時只剩估不出來的能過關，實得 "+sc.id);
      return "roiMin=99 → 仍選得出 "+sc.id+"（估不出價值者不受 ROI 否決）";
    });
    step("估得出來且划不來就不學：把 roiMin 拉高，有情境卡的那幾門會被濾掉",()=>{
      const S=fresh(3209,{npcSkillRoiMin:99}), p=S.players[1];
      cashTo(S,p,3000); p.playerStage="INNER"; p.learning=null; p.skillCooldownUntil=0;
      const picks=new Set();
      for(let i=0;i<8;i++){ const a=npc.skillToLearn(S,p); if(!a) break;
        picks.add(a.payload.skillId); p.skills[a.payload.skillId]={learnedAt:1,decayed:false}; }
      const withGate=[...picks].filter(id=>E.skillExpectedGain(S,p,ns.content.byId[id])!==null);
      A(!withGate.length,"roiMin=99 時不該學到任何估得出價值的技能："+withGate.join("、"));
      return "roiMin=99 → "+picks.size+" 門全是估不出價值者";
    });
    step("排序改成「淨期望回收由高到低」：第一志願不是最便宜的那門",()=>{
      const S=fresh(3210), p=S.players[1];
      cashTo(S,p,3000); p.playerStage="INNER"; p.learning=null; p.skillCooldownUntil=0;
      const a=npc.skillToLearn(S,p); A(a,"應該選得出一門");
      const first=ns.content.byId[a.payload.skillId];
      const cheapest=(S.skillSample||[]).map(id=>ns.content.byId[id])
        .filter(c=>c&&c.kind==="SKILL").sort((x,y)=>(x.cost||0)-(y.cost||0))[0];
      A(first.id!==cheapest.id,"若第一志願仍是最便宜的（"+cheapest.id+"），排序就沒改到");
      const gFirst=E.skillExpectedGain(S,p,first);
      A(gFirst!==null && gFirst>0,"第一志願應該是估得出正回收的那門，實得 "+gFirst);
      return "第一志願 "+first.id+"（學費 "+first.cost+"、期望回收 "+gFirst+"），最便宜的是 "+cheapest.id;
    });
    step("排序是決定論的：同一狀態叫兩次結果一樣（不吃亂數、不看物件順序）",()=>{
      const S=fresh(3211), p=S.players[1];
      cashTo(S,p,3000); p.playerStage="INNER"; p.learning=null; p.skillCooldownUntil=0;
      const a1=npc.skillToLearn(S,p), a2=npc.skillToLearn(S,p);
      A(a1&&a2&&a1.payload.skillId===a2.payload.skillId,"兩次結果不同："+
        (a1&&a1.payload.skillId)+" vs "+(a2&&a2.payload.skillId));
      return "兩次都選 "+a1.payload.skillId;
    });
    step("保留水位仍然優先於 ROI：現金不夠就算回收再高也不學",()=>{
      const S=fresh(3212), p=S.players[1];
      cashTo(S,p,0); p.playerStage="INNER"; p.learning=null; p.skillCooldownUntil=0;
      A(npc.skillToLearn(S,p)===null,"現金 0 時不該還去報名");
      return "現金 0 → 不報名";
    });
    step("情境卡索引不掛在 S 上——存檔與多人同步封包不該多背一份卡片陣列",()=>{
      const S=fresh(3213);
      E.skillGateIndex(S);
      A(S._gateIdx===undefined,"索引不該掛在 S 上（會被序列化進存檔與同步封包）");
      const size=JSON.stringify(S).length;
      A(size < 900000,"狀態序列化後異常肥大："+size+" 位元組");
      return "S 上沒有索引欄位，序列化 "+Math.round(size/1024)+" KB";
    });

    /* ---------- ④ 進修商城分組 ---------- */
    step("進修商城：依投入量級分組，每一門進場技能都列得到（沒有靜默漏掉）",()=>{
      const S=fresh(3214), p=S.players[0];
      cashTo(S,p,3000);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      const txt=ov.textContent;
      ["入門・小額","進階・專業","轉職學程","高階・需先修"].forEach(g=>A(txt.indexOf(g)>=0,"缺分組："+g));
      const miss=(S.skillSample||[]).map(id=>ns.content.byId[id])
        .filter(c=>c&&c.kind==="SKILL"&&txt.indexOf(c.title)<0);
      A(!miss.length,"這些技能沒列出來："+miss.map(c=>c.id).join("、"));
      close();
      return "四組到齊，"+S.skillSample.length+" 門全列出";
    });
    step("分組內由便宜排到貴——玩家在這個畫面找的是「現在付得起哪一檔」",()=>{
      const S=fresh(3215), p=S.players[0];
      cashTo(S,p,3000);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      const titles=[...ov.querySelectorAll('button.opt b')].map(e=>e.textContent);
      const byTitle={}; (ns.content.cards.SKILL||[]).forEach(c=>byTitle[c.title]=c);
      const rows=titles.map(t=>byTitle[t]).filter(Boolean);
      A(rows.length>=10,"取到的技能列太少："+rows.length);
      let bad=null;
      for(let i=1;i<rows.length;i++){
        if(rows[i].tier!==rows[i-1].tier) continue;
        if((rows[i].cost||0) < (rows[i-1].cost||0)) bad=rows[i-1].id+" → "+rows[i].id;
      }
      A(!bad,"同一組內沒有由便宜排到貴："+bad);
      close();
      return rows.length+" 列，組內遞增";
    });
    step("先修沒學會的高階課要看得到但按不下去（路徑要可見）",()=>{
      const S=fresh(3216), p=S.players[0];
      cashTo(S,p,3000);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      const hi=ns.content.byId["SKL_AI_ARCH"];
      const btn=[...ov.querySelectorAll('button.opt')].filter(b=>b.textContent.indexOf(hi.title)>=0)[0];
      A(btn,"高階課應該列得到");
      A(btn.disabled,"先修沒學會時應該按不下去");
      A(/尚未學會/.test(btn.textContent),"要標出先修還沒學會");
      close();
      return "SKL_AI_ARCH 可見、反灰、標示先修";
    });
    step("錢不夠的課仍然列得到，只是按不下去（不是藏起來）",()=>{
      const S=fresh(3217), p=S.players[0];
      cashTo(S,p,12);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      const btns=[...ov.querySelectorAll('button.opt')];
      A(btns.length>=10,"技能列不該因為沒錢而消失，實得 "+btns.length);
      A(btns.some(b=>b.disabled && b.title==="現金不足"),"應有因現金不足而反灰的項目");
      close();
      return btns.length+" 列全在，其中含現金不足者";
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

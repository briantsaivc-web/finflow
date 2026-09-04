const { chromium } = require('playwright');
/* S33 驗收：三張情境卡數值、水電自住折抵、長尾加分技能、兩張高階情境卡、
   情境卡抽樣 6、高階審計與其先修的能力分級。
   設計意圖：
     ① 談判／攝影／水電的情境卡回報原本低於學費，電腦玩家理性地不學——那是內容數值問題
     ② 水電的兩個兌現點原本都只有房東吃得到，但它本來要教的是「自己動手省下師傅工錢」
     ③ 長尾題材的手藝不是非黑即白：會拍照對做節目、出電子書幫得上忙，但不是本行
     ④ SKL_CPA_AUDIT 的能力原本與它的先修 SKL_BOOK 完全重疊，等於花 45 買零獨佔價值
     ⑤ 補兩張高階情境卡會稀釋既有技能的命中率，所以抽樣數要一起動
   用法（repo 根目錄）： node tests/s33test.js */
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
    const fresh=(seed,ov,mods)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||3300, c, mods||MODS, four, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    const give=(p,id)=>{ p.skills[id]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const cashOf=br=>((br&&br.effects)||[]).reduce((v,e)=>v+(e.op==="CASH_DELTA"?(e.amount||0):0),0);
    const gate=id=>ns.content.byId[id];

    /* ---------- ① 三張情境卡的落差 ---------- */
    /* 三張卡的目標不一樣，測項要照實寫，不能一律要求 ≥1×：
         談判：只靠情境卡兌現 → 要求 ≥1×
         水電：情境卡 ＋ 自住維修折抵（引擎）→ 情境卡本身接近 1× 即可
         攝影：情境卡 ＋ 六張長尾（三主修三加分）→ 情境卡本身不足 1× 是刻意的，
               Brian 的裁示就是「用長尾來拉」，不是把婚攝謝禮寫成不合理的數字 */
    step("三張情境卡的落差都明顯拉高（各自的目標倍數不同，見註解）",()=>{
      const S=fresh(3301);
      const nG=E.cfg(S,"skillGatePerGame"), tot=E.skillGateIndex(S).list.length;
      const prob=Math.min(1,nG/tot);
      const OLD={ SKL_PLUMB:0.39, SKL_NEGO:0.81, SKL_PHOTO:0.55 };   // 改版前（落差×5/12÷學費）
      const MIN={ SKL_PLUMB:0.95, SKL_NEGO:1.00, SKL_PHOTO:0.85 };
      const out=[["SKE_HEATER","SKL_PLUMB"],["SKE_HAGGLE","SKL_NEGO"],["SKE_WEDDING","SKL_PHOTO"]]
        .map(([g,sk])=>{
          const c=gate(g), sc=ns.content.byId[sk];
          const gap=cashOf(c.skillBranch.have)-cashOf(c.skillBranch.miss);
          const mult=gap*prob/(sc.cost||1);
          A(mult>=MIN[sk], sk+" 沒到目標倍數："+mult.toFixed(2)+"×，要求 ≥"+MIN[sk]);
          A(mult>OLD[sk]*1.4, sk+" 相對改版前提升不足："+OLD[sk]+"× → "+mult.toFixed(2)+"×");
          return sk.replace("SKL_","")+" "+OLD[sk]+"×→"+mult.toFixed(2)+"×";
        });
      return out.join("／");
    });
    step("水電與攝影的第二條腿必須真的存在（情境卡不足 1× 是因為還有別的兌現點）",()=>{
      const S=fresh(3301);
      A(E.cfg(S,"skillPlumbHomeSave")>0,"水電要有自住維修折抵這條腿");
      A((ns.content.cards.LIFESTYLE||[]).some(c=>(c.payload||{}).diyRepair),"要有至少一張自住維修卡");
      const dg=(ns.content.cards.DIGITAL||[]);
      const legs=dg.filter(c=>c.requires==="SKL_PHOTO"||(c.assistSkills||[]).indexOf("SKL_PHOTO")>=0);
      A(legs.length>=6,"攝影的長尾兌現點應至少六張，實得 "+legs.length);
      return "水電：自住折抵 "+E.cfg(S,"skillPlumbHomeSave")+"／攝影：長尾 "+legs.length+" 張";
    });
    step("拉數值不是無上限：沒有任何一張情境卡的落差超過牌堆現有最重的那張",()=>{
      const S=fresh(3302);
      const gates=(ns.content.cards.LIFE_EVENT||[]).filter(c=>c.kind==="SKILL_GATE");
      const gaps=gates.map(c=>cashOf(c.skillBranch.have)-cashOf(c.skillBranch.miss));
      const mx=Math.max(...gaps);
      A(mx===200,"最重的一張應該仍是 SKE_PONZI 的 200，實得 "+mx);
      ["SKE_HEATER","SKE_HAGGLE","SKE_WEDDING"].forEach(id=>{
        const c=gate(id), g=cashOf(c.skillBranch.have)-cashOf(c.skillBranch.miss);
        A(g<mx, id+" 不該變成全牌堆最重的一張");
      });
      return "最重仍為 SKE_PONZI（200）";
    });

    /* ---------- ② 水電：自住那一半 ---------- */
    step("自住維修卡（diyRepair）：有基礎水電就少付一筆師傅工錢",()=>{
      const S=fresh(3303), p=S.players[0];
      const card=ns.content.byId["LS08"];
      A(card && card.payload.diyRepair===true,"LS08 應標記為自住維修卡");
      const save=E.cfg(S,"skillPlumbHomeSave");
      cashTo(S,p,900); const c0=p.cash; E.payLifestyle(S,p,card);
      const paidNo=c0-p.cash;
      const S2=fresh(3303), q=S2.players[0]; give(q,"SKL_PLUMB");
      cashTo(S2,q,900); const c1=q.cash; E.payLifestyle(S2,q,card);
      const paidYes=c1-q.cash;
      A(Math.abs((paidNo-paidYes)-save)<0.01,"應剛好省下 "+save+"，實得 "+(paidNo-paidYes));
      A(q.stats.skillsUsed===1 && Math.abs(q.stats.skillSavedTotal-save)<0.01,"要記進技能兌現統計");
      return "沒技能付 "+paidNo+"、有技能付 "+paidYes+"（省 "+save+"）";
    });
    step("沒買房也吃得到——這正是 S28 原意沒被實現的那一半",()=>{
      const S=fresh(3304), p=S.players[0]; give(p,"SKL_PLUMB");
      A(!(p.assets||[]).some(a=>a.kind==="REALESTATE"),"測試前提：手上沒有房產");
      cashTo(S,p,900); const c0=p.cash; E.payLifestyle(S,p,ns.content.byId["LS08"]);
      A(p.stats.skillsUsed===1,"沒有房產也該兌現一次，實得 "+p.stats.skillsUsed);
      return "無房產仍兌現，省下 "+util.r2(p.stats.skillSavedTotal);
    });
    step("沒標 diyRepair 的生活卡不受影響（不是所有花費都能自己修）",()=>{
      const S=fresh(3305), p=S.players[0]; give(p,"SKL_PLUMB");
      const other=(ns.content.cards.LIFESTYLE||[]).filter(c=>!(c.payload||{}).diyRepair && (c.payload||{}).cost>0)[0];
      A(other,"測試前提：應有沒標記的生活卡");
      cashTo(S,p,900); const c0=p.cash; E.payLifestyle(S,p,other);
      A(Math.abs((c0-p.cash)-util.r2(other.payload.cost*S.config.eventCardRate))<0.01,"不該被折抵");
      A((p.stats.skillsUsed||0)===0,"不該計入兌現");
      return other.id+" 照原價";
    });

    /* ---------- ③ 長尾加分技能 ---------- */
    step("加分技能：比外行順、但不是本行（三段式，不是二分法）",()=>{
      const S=fresh(3306);
      const card=(ns.content.cards.DIGITAL||[]).filter(c=>c.id==="DIG_EBOOK")[0];
      A(card && (card.assistSkills||[]).indexOf("SKL_PHOTO")>=0,"DIG_EBOOK 應把攝影列為加分");
      const mk=()=>{ const T=fresh(3306); return T.players[0]; };
      const am=E.digitalOdds(S,mk(),card);
      const pAs=mk(); give(pAs,"SKL_PHOTO");
      const as=E.digitalOdds(S,pAs,card);
      const pPro=mk(); give(pPro,card.requires);
      const pro=E.digitalOdds(S,pPro,card);
      A(am.pro===false && am.assist===false,"什麼都不會＝外行");
      A(as.pro===false && as.assist===true,"只有加分技能＝略懂，不是本行");
      A(pro.pro===true && pro.assist===false,"本行就不再算加分（不重複計）");
      A(as.threshold<=am.threshold && as.threshold>=pro.threshold,"略懂的爬坡輪數要落在兩者之間");
      A(as.hit>=am.hit && as.hit<=pro.hit,"略懂的爆紅機率要落在兩者之間");
      A(as.flop<=am.flop && as.flop>=pro.flop,"略懂的做白工機率要落在兩者之間");
      return "外行 "+am.threshold+" 輪／略懂 "+as.threshold+" 輪／本行 "+pro.threshold+" 輪";
    });
    step("blend 是旋鈕：0＝加分完全沒用、1＝視同本行的數字",()=>{
      const card=(ns.content.cards.DIGITAL||[]).filter(c=>c.id==="DIG_EBOOK")[0];
      const S0=fresh(3307,{digitalAssistBlend:0}), p0=S0.players[0]; give(p0,"SKL_PHOTO");
      const o0=E.digitalOdds(S0,p0,card);
      A(o0.threshold===o0.amateurThreshold && o0.hit===o0.amateurHit,"blend 0 應與外行相同");
      const S1=fresh(3307,{digitalAssistBlend:1}), p1=S1.players[0]; give(p1,"SKL_PHOTO");
      const o1=E.digitalOdds(S1,p1,card);
      A(o1.threshold===o1.proThreshold && o1.hit===o1.proHit,"blend 1 應與本行的數字相同");
      A(o1.pro===false,"但仍然不是本行——數字一樣不代表身分一樣");
      return "0→外行、1→本行數字（pro 旗標不變）";
    });
    step("攝影現在有三張主修＋三張加分，不再只靠一張婚禮情境卡",()=>{
      const dg=(ns.content.cards.DIGITAL||[]);
      const main=dg.filter(c=>c.requires==="SKL_PHOTO").map(c=>c.id);
      const asst=dg.filter(c=>(c.assistSkills||[]).indexOf("SKL_PHOTO")>=0).map(c=>c.id);
      A(main.length>=3,"主修應至少三張，實得 "+main.length);
      A(asst.length>=3,"加分應至少三張，實得 "+asst.length);
      asst.forEach(id=>A(main.indexOf(id)<0,id+" 不該同時是主修與加分"));
      return "主修 "+main.join("、")+"；加分 "+asst.join("、");
    });

    /* ---------- ④ 高階審計的分級 ---------- */
    step("能力分級：高階審計 2 級、記帳 1 級、都沒有 0 級",()=>{
      const S=fresh(3308);
      const mk=()=>fresh(3308).players[0];
      const a=mk(); give(a,"SKL_CPA_AUDIT");
      const b2=mk(); give(b2,"SKL_BOOK");
      const c=mk();
      A(E.directorAuditLevel(a)===2,"高階審計應為 2");
      A(E.directorAuditLevel(b2)===1,"記帳應為 1");
      A(E.directorAuditLevel(c)===0,"都沒有應為 0");
      A(E.directorAuditSkill(b2)===true && E.directorAuditSkill(c)===false,"舊的布林介面要保持相容");
      return "2／1／0";
    });
    step("高階審計必定預警；記帳只有機率會發現（這是它獨佔價值的來源）",()=>{
      const mkD=(skill, roll)=>{
        const S=fresh(3309), p=S.players[0]; if(skill) give(p,skill);
        cashTo(S,p,900);
        S.decisionQueue.length=0;
        E.presentCard(S,p,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
        E.resolveDecision(S,p,S.pendingDecision||S.decisionQueue[0],"appoint",{company:"C"});
        A(p.directorship,"應就任 C，實得 "+p.directorship);
        p.directorship.crashTurn=S.turnNumber+2;
        p.directorship.auditRoll=roll;
        S.decisionQueue.length=0; S.pendingDecision=null;
        S.turnNumber+=1; E.tickDirectorship(S,p);
        return S.decisionQueue.some(d=>d.kind==="RESIGN_DIRECTORSHIP");
      };
      const pct=E.cfg(fresh(3309),"directorAuditWarnPctBasic");
      A(mkD("SKL_CPA_AUDIT",0.99)===true,"高階審計即使骰到 0.99 也要預警");
      A(mkD("SKL_BOOK",0.01)===true,"記帳骰到低於門檻應該預警");
      A(mkD("SKL_BOOK",0.99)===false,"記帳骰到高於門檻不該預警");
      A(mkD(null,0.01)===false,"沒有任何審計能力一律不預警");
      return "高階必中；記帳門檻 "+util.pct(pct,0);
    });
    step("預警的骰子在就任當下擲，不在分支裡擲（同一顆種子不會因技能而位移）",()=>{
      const S=fresh(3310), p=S.players[0]; give(p,"SKL_BOOK"); cashTo(S,p,900);
      S.decisionQueue.length=0; E.presentCard(S,p,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      E.resolveDecision(S,p,S.pendingDecision||S.decisionQueue[0],"appoint",{company:"A"});
      A(p.directorship && typeof p.directorship.auditRoll==="number","就任時就要有 auditRoll");
      A(p.directorship.auditRoll>=0 && p.directorship.auditRoll<1,"骰值要落在 [0,1)");
      return "auditRoll="+p.directorship.auditRoll.toFixed(3);
    });
    step("高風險席次沒有被鎖住——「不懂帳卻去當獨董」這一課要留在原地",()=>{
      const S=fresh(3311), p=S.players[0]; give(p,"SKL_LAW"); cashTo(S,p,900);
      A(E.directorHighRiskOk(p)===false,"只懂法律不算有高階能力");
      S.decisionQueue.length=0; E.presentCard(S,p,ns.content.byId["LE_INDEPENDENT_DIRECTOR"]);
      E.resolveDecision(S,p,S.pendingDecision||S.decisionQueue[0],"appoint",{company:"C"});
      A(p.directorship && p.directorship.companyType==="C","沒有高階能力也要接得下 C——鎖住等於把課刪掉");
      return "只懂法律仍可就任 C";
    });

    /* ---------- ⑤ 兩張新卡與抽樣配套 ---------- */
    step("兩張新情境卡就位，且沒有讓任何技能的情境卡佔比超過 25%",()=>{
      const S=fresh(3312);
      A(gate("SKE_AIWAVE"),"缺 SKE_AIWAVE");
      A(gate("SKE_MARGINCALL"),"缺 SKE_MARGINCALL");
      A(gate("SKE_MARGINCALL").moduleReq==="M9","衍生商品那張要掛 M9");
      const gates=(ns.content.cards.LIFE_EVENT||[]).filter(c=>c.kind==="SKILL_GATE");
      const cnt={};
      gates.forEach(c=>{ const r=c.skillBranch.requires; cnt[r]=(cnt[r]||0)+1; });
      const worst=Object.keys(cnt).sort((a,b)=>cnt[b]-cnt[a])[0];
      A(cnt[worst]/gates.length<=0.25,"集中度超標："+worst+" "+cnt[worst]+"/"+gates.length);
      return gates.length+" 張，最集中的是 "+worst+"（"+cnt[worst]+" 張）";
    });
    step("抽樣數同步 5→6：補了兩張之後命中機率沒有被稀釋（兩種模組組合都要驗）",()=>{
      const before=5/12;                                   // 改版前：5 張抽自 12 張
      const S8=fresh(3313), S9=fresh(3313,null,["M1","M2","M3","M4","M6","M8","M9"]);
      const nG=E.cfg(S8,"skillGatePerGame");
      A(nG===6,"應為 6，實得 "+nG);
      const p8=nG/E.skillGateIndex(S8).list.length;        // M9 沒開：MARGINCALL 不進池
      const p9=nG/E.skillGateIndex(S9).list.length;
      [["M8 局",p8],["M9 局",p9]].forEach(([n,v])=>{
        A(v>=before, n+"的命中機率被稀釋了："+v.toFixed(3)+" < "+before.toFixed(3));
        A(v<=before*1.15, n+"的命中機率補過頭了："+v.toFixed(3)+" > "+(before*1.15).toFixed(3));
      });
      return "M8 局 "+p8.toFixed(3)+"、M9 局 "+p9.toFixed(3)+"（改版前 "+before.toFixed(3)+"）";
    });
    step("SKE_AIWAVE 的好處不是「學了就加薪」，而是「沒有被重新定價」",()=>{
      const c=gate("SKE_AIWAVE");
      const up=(c.skillBranch.have.effects||[]).filter(e=>e.op==="SALARY_MULT" && e.factor>1);
      A(!up.length,"have 分支不該有永久加薪——牌堆有「加薪型不得超過三成」的配比紀律");
      const down=(c.skillBranch.miss.effects||[]).filter(e=>e.op==="SALARY_MULT" && e.factor<1);
      A(down.length===1,"miss 分支應該是薪資被下修");
      A(cashOf(c.skillBranch.have)>0,"have 分支要有一次性的正報酬");
      return "have 現金 +"+cashOf(c.skillBranch.have)+"／miss 薪資 ×"+down[0].factor;
    });
    step("SKE_MARGINCALL：沒開 M9 的局不會出現在情境卡池裡",()=>{
      const S=fresh(3314,null,["M1","M2","M3","M4","M6","M8"]);
      const idx=E.skillGateIndex(S);
      A(!idx.list.some(c=>c.id==="SKE_MARGINCALL"),"沒開 M9 不該進池");
      const S9=fresh(3315,null,["M1","M2","M3","M4","M6","M8","M9"]);
      A(E.skillGateIndex(S9).list.some(c=>c.id==="SKE_MARGINCALL"),"開了 M9 就要進池");
      return "M8 局 "+idx.list.length+" 張、M9 局 "+E.skillGateIndex(S9).list.length+" 張";
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

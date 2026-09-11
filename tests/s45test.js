const { chromium } = require('playwright');
/* T-001／S1（ADR-001 新股抽籤，engine-engineer 段落）：
     D1 E.ipoRoll 雜湊亂數（不碰 util.rand/util.randAux）
     D2 S.ipo／p.ipoEscrow（唯讀快取，不進 totalAssets／netWorth）
     D3 IPO_SUBSCRIBE／IPO_DECLINE（非回合白名單，reject 碼 NO_IPO／IPO_MISMATCH／IPO_DUP／IPO_CASH／IPO_TIER）
     D4 帳本：申購／沒中／中籤／破發四種分錄金額；"ipo-settle" 進 DENY，"ipo" 不進 DENY
     D5 觸發與結算：MARKET 格觸發、保底、E.openIpo／E.ipoPollNPC／E.settleIpo（依 subs 數字排序）、
        E.ipoRefundPlayer（破產先退款）、結算順序在集資（S39）之後
   驗證方式對照 ADR-001「驗證方式」①–⑩，AI 對手路徑（E.ipoPollNPC）與人類路徑（IPO_SUBSCRIBE／IPO_DECLINE）都覆蓋到。
   S2（ui-engineer）會在本檔案「===== S1 段落結束，以下保留給 S2 續寫 page 段落 =====」之後加測試，
   不得修改本檔案上半部的斷言。
   用法（repo 根目錄）： node tests/s45test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,npc=ns.npc,ledger=ns.ledger,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const baseCfg=ns.buildConfig(ns.configRegistry);
    const MODS=["M1","M2","M3","M4","M6","M8"];
    const pros=ns.content.professions;
    // mk：ipoLottery 預設開（1），players[0] 預設真人（除非 allNpc），其餘電腦（性格輪流）
    const mk=(seed,allNpc,ov)=>{
      const c=util.clone(baseCfg); c.ipoLottery=1; if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      const S=E.newGame({seed:seed,config:c,modules:MODS,
        players:[0,1,2,3].map(i=>({name:'P'+i, isNPC:allNpc||i>0,
          personality:['NPC_SAFE','NPC_SAFE','NPC_LEVER','NPC_VC'][i],
          professionId:pros[i*4].id, dreamCardId:ns.content.dreams[i].id}))});
      E.beginTurn(S);
      return S;
    };
    const ap=(S,a)=>E.apply(S,a,{mutate:true});
    const rejOf=r=>{ const e=(r.events||[]).filter(x=>x.type==="ACTION_REJECTED")[0]; return r.rejected?(e?e.reason:"?"):null; };
    // 強制立刻到期：把排程改成「現在」、fired 清成沒觸發過，方便不用跑一堆輪次就能測 openIpo。
    const forceDue=(S)=>{ S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false]; };

    /* ① 排程分布（1,000 種子）：兩個窗口都落在設定範圍內；第二窗口出現率接近 ipoWin2Chance（0.6，預設值）。 */
    step("① 排程分布：1,000 種子，兩個窗口都落在設定範圍內、第二窗口出現率接近 0.6",()=>{
      let win1=[], win2=[], win2n=0;
      for(let seed=0; seed<1000; seed++){
        const S=mk(seed,true);
        win1.push(S.ipo.schedule[0]);
        if(S.ipo.schedule.length>1){ win2n++; win2.push(S.ipo.schedule[1]); }
      }
      const lo1=Math.min(...win1), hi1=Math.max(...win1);
      A(lo1>=8 && hi1<=20, "win1 應落在 [8,20]，實得 ["+lo1+","+hi1+"]");
      const rate=win2n/1000;
      A(rate>0.5 && rate<0.7, "win2 出現率應接近 0.6，實得 "+rate);
      const lo2=Math.min(...win2), hi2=Math.max(...win2);
      A(lo2>=25 && hi2<=45, "win2 應落在 [25,45]，實得 ["+lo2+","+hi2+"]");
      return "win1∈["+lo1+","+hi1+"] win2 rate="+rate.toFixed(3)+" win2∈["+lo2+","+hi2+"]";
    });

    /* ② 雜湊決定論：同種子兩次結果相同；不同種子（或不同 tag）結果不同；落在 [0,1)。 */
    step("② E.ipoRoll 雜湊決定論：同輸入同輸出、不同輸入不同輸出、範圍 [0,1)",()=>{
      const S1=mk(1,true), S2=mk(2,true);
      const a=E.ipoRoll(S1,"x"), b=E.ipoRoll(S1,"x"), c=E.ipoRoll(S1,"y"), d=E.ipoRoll(S2,"x");
      A(a===b, "同一個 S、同一個 tag 應完全相同："+a+" vs "+b);
      A(a!==c, "同一個 S、不同 tag 應不同");
      A(a!==d, "不同種子、同 tag 應不同");
      A(a>=0 && a<1 && c>=0 && c<1 && d>=0 && d<1, "應落在 [0,1)");
      return "a="+a.toFixed(6)+" c="+c.toFixed(6)+" d="+d.toFixed(6);
    });

    /* ③ 中籤率公式與夾限：q = clamp(ipoEvRate/g, ipoQMin, ipoQMax)。 */
    step("③ 中籤率公式 q=r/g 與上下夾限都驗到",()=>{
      const S=mk(3,true);
      // 正常範圍：g 不極端，q 應等於 r/g（四捨五入到小數 4 位）
      const t1=E.ipoIssueTier(S,"T1","SMALL");
      const expectQ=Math.round(Math.max(0.005,Math.min(0.30, 0.03/t1.g))*10000)/10000;
      A(Math.abs(t1.q-expectQ)<1e-9, "q 應等於 clamp(r/g)，實得 "+t1.q+" 預期 "+expectQ);
      // 夾限下限：g 極大 → r/g 極小 → 應夾在 ipoQMin
      S.config.ipoSpreadMin=50; S.config.ipoSpreadMax=50;
      const t2=E.ipoIssueTier(S,"T2","SMALL");
      A(t2.g===50, "g 應固定在 50，實得 "+t2.g);
      A(Math.abs(t2.q-0.005)<1e-9, "q 應夾在 ipoQMin=0.005，實得 "+t2.q);
      // 夾限上限：g 極小 → r/g 極大 → 應夾在 ipoQMax
      S.config.ipoSpreadMin=0.001; S.config.ipoSpreadMax=0.001;
      const t3=E.ipoIssueTier(S,"T3","SMALL");
      A(Math.abs(t3.q-0.30)<1e-9, "q 應夾在 ipoQMax=0.30，實得 "+t3.q);
      return "正常 q="+t1.q+"／下限 "+t2.q+"／上限 "+t3.q;
    });

    /* ④ 帳本：申購／沒中／中籤／破發（中籤但賠錢）四種分錄金額都對。 */
    step("④ 帳本分錄金額：申購（CASH -(P+fee+notice)／ASSET +P）、沒中（CASH +(P+notice)／ASSET -P）、中籤（ASSET -P／CASH +listPrice）",()=>{
      const S=mk(4,false); S.players.forEach(p=>p.isNPC=false);   // 全真人：確保 P1 不會被電腦輪詢搶先申購
      forceDue(S);
      E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending, tierDef=ip.tiers.SMALL;
      const fee=E.cfg(S,"ipoFee",0.02), notice=E.cfg(S,"ipoNoticeFee",0.05);
      const p1=S.players[1], before=p1.cash;
      const r1=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(!r1.rejected, "申購應成功，實得 "+rejOf(r1));
      const en=p1.ledger[p1.ledger.length-1];
      A(en.eduTags.indexOf("ipo")>=0 && en.eduTags.indexOf("ipo-settle")<0, "申購分錄 eduTags 應只有 ipo，不含 ipo-settle");
      const cashQ=en.postings.filter(q=>q.account==="CASH")[0], assetQ=en.postings.filter(q=>q.account==="ASSET")[0];
      A(Math.abs(cashQ.delta-(-util.r2(tierDef.P+fee+notice)))<0.01, "CASH 應為 -(P+fee+notice)，實得 "+cashQ.delta);
      A(Math.abs(assetQ.delta-tierDef.P)<0.01, "ASSET 應為 +P，實得 "+assetQ.delta);
      A(Math.abs(p1.cash-(before-util.r2(tierDef.P+fee+notice)))<0.01, "現金應扣 P+fee+notice");
      A(Math.abs(p1.ipoEscrow-tierDef.P)<0.01, "ipoEscrow 應等於 P（唯讀快取）");

      E.settleIpo(S);
      const en2=p1.ledger[p1.ledger.length-1];
      A(en2.eduTags.indexOf("ipo")>=0 && en2.eduTags.indexOf("ipo-settle")>=0, "結算分錄應同時有 ipo 與 ipo-settle");
      // 注意：不能用 summary.indexOf("中籤") 判斷輸贏——「未中籤」這個字串本身就含有「中籤」子字串。
      // 一律以 S.ipo.history 裡結構化的 won 欄位為準（won 是 boolean，不是字串比對）。
      const res=S.ipo.history[S.ipo.history.length-1].results.filter(x=>x.playerId===1 && x.tier==="SMALL")[0];
      A(res, "應該有這一筆的結算紀錄");
      const won=res.won;
      if(won){
        A(Math.abs(en2.postings.filter(q=>q.account==="CASH")[0].delta-tierDef.listPrice)<0.01, "中籤 CASH 應為 listPrice");
        A(Math.abs(en2.postings.filter(q=>q.account==="ASSET")[0].delta-(-tierDef.P))<0.01, "中籤 ASSET 應為 -P");
      } else {
        A(Math.abs(en2.postings.filter(q=>q.account==="CASH")[0].delta-util.r2(tierDef.P+notice))<0.01, "沒中 CASH 應為 +(P+notice)");
        A(Math.abs(en2.postings.filter(q=>q.account==="ASSET")[0].delta-(-tierDef.P))<0.01, "沒中 ASSET 應為 -P");
      }
      A(p1.ipoEscrow===0, "結算後 ipoEscrow 應歸零");
      A(p1.derived.totalAssets===0 || Math.abs(p1.derived.totalAssets)<0.02, "結算後不該再留 IPO 的 ASSET 餘額（p.ipoEscrow 不重複計入 totalAssets）");
      return won?"本次抽中：驗證中籤分錄":"本次沒中：驗證沒中分錄";
    });

    step("④b 破發：中籤但上市價低於申購價（listPrice<P）時，帳本金額仍照公式走（賠錢也是同一組分錄結構）",()=>{
      const S=mk(41,true);
      // 逼出「一定中籤、上市價一定低於申購價」：q 夾到 1、list 區間鎖在 0.5（<1 一定破發）
      S.config.ipoQMax=1; S.config.ipoSpreadMin=0.001; S.config.ipoSpreadMax=0.001;
      S.config.ipoListLo=0.5; S.config.ipoListHi=0.5;
      forceDue(S);
      E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending, tierDef=ip.tiers.SMALL;
      A(tierDef.q===1, "q 應被夾到 1（保證中籤），實得 "+tierDef.q);
      A(tierDef.listPrice<tierDef.P, "上市價應低於申購價（破發），listPrice="+tierDef.listPrice+" P="+tierDef.P);
      const p1=S.players[1];
      ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      E.settleIpo(S);
      const en=p1.ledger[p1.ledger.length-1];
      A(en.summary.indexOf("中籤")>=0, "q=1 應保證中籤");
      A(Math.abs(en.postings.filter(q=>q.account==="CASH")[0].delta-tierDef.listPrice)<0.01, "破發也是 CASH +listPrice（金額比 P 低）");
      A(Math.abs(en.postings.filter(q=>q.account==="ASSET")[0].delta-(-tierDef.P))<0.01, "破發也是 ASSET -P");
      return "listPrice="+tierDef.listPrice+" < P="+tierDef.P+"，分錄結構不變、金額如實反映虧損";
    });

    /* ⑤ 非回合申購（人類路徑）＋ reject 碼全部驗到。 */
    step("⑤ 人類路徑：非回合 IPO_SUBSCRIBE 仍放行（不是 NOT_YOUR_TURN），而且會標 offTurn 供記帳題掃到（S0 地雷）",()=>{
      const S=mk(5,false);          // players[0..3] 全真人，才能測「非當前玩家送出動作」
      S.players.forEach(p=>p.isNPC=false);
      forceDue(S);
      E.openIpo(S,S.players[0]);    // 目前輪到 player 0
      const ip=S.ipo.pending;
      A(E.activePlayer(S).id===0, "測試前提：目前應輪到 player 0");
      const r=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(!r.rejected, "非當前玩家的申購不該被擋，實得 "+rejOf(r));
      const p1=S.players[1], en=p1.ledger[p1.ledger.length-1];
      A(en.offTurn===true, "非回合分錄應標 offTurn=true，否則記帳題永遠掃不到（S0 查證的地雷）");
      return "P1 非回合申購成功且 offTurn=true";
    });
    step("⑤ reject 碼：NO_IPO／IPO_MISMATCH／IPO_DUP／IPO_CASH／IPO_TIER 全部驗到",()=>{
      const S0=mk(50,false); S0.players.forEach(p=>p.isNPC=false);
      const rNo=ap(S0,{type:"IPO_SUBSCRIBE",playerId:0,payload:{ipoId:"X",tier:"SMALL"}});
      A(rejOf(rNo)==="NO_IPO", "沒有 pending 時應 NO_IPO，實得 "+rejOf(rNo));
      const rNoD=ap(S0,{type:"IPO_DECLINE",playerId:0,payload:{ipoId:"X"}});
      A(rejOf(rNoD)==="NO_IPO", "DECLINE 沒有 pending 時應 NO_IPO，實得 "+rejOf(rNoD));

      const S=mk(51,false); S.players.forEach(p=>p.isNPC=false);
      forceDue(S); E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending;
      const rMis=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:"WRONG",tier:"SMALL"}});
      A(rejOf(rMis)==="IPO_MISMATCH", "ipoId 對不上應 IPO_MISMATCH，實得 "+rejOf(rMis));
      const rTier=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"NOPE"}});
      A(rejOf(rTier)==="IPO_TIER", "檔別不存在應 IPO_TIER，實得 "+rejOf(rTier));
      const p1=S.players[1]; p1.cash=0; ledger.recompute(p1);
      const rCash=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"BIG"}});
      A(rejOf(rCash)==="IPO_CASH", "現金不夠應 IPO_CASH，實得 "+rejOf(rCash));
      p1.cash=99999; ledger.recompute(p1);
      const rOk=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(!rOk.rejected, "這次應該成功，實得 "+rejOf(rOk));
      const rDup=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(rejOf(rDup)==="IPO_DUP", "同一檔重複申購應 IPO_DUP，實得 "+rejOf(rDup));
      const rDeclDup=ap(S,{type:"IPO_DECLINE",playerId:1,payload:{ipoId:ip.id}});
      A(rejOf(rDeclDup)==="IPO_DUP", "已申購過的人婉拒應 IPO_DUP，實得 "+rejOf(rDeclDup));
      const p2=S.players[2];
      const rDecl=ap(S,{type:"IPO_DECLINE",playerId:2,payload:{ipoId:ip.id}});
      A(!rDecl.rejected, "沒申購過的人婉拒應成功，實得 "+rejOf(rDecl));
      return "NO_IPO／IPO_MISMATCH／IPO_TIER／IPO_CASH／IPO_DUP 全部命中";
    });
    step("⑤d BANKRUPT：破產玩家送 IPO_SUBSCRIBE 應該被拒絕，現金與 ipoEscrow 都不變（比照 ROLL_DICE／SELL_ASSET 等既有慣例）",()=>{
      const S=mk(52,false); S.players.forEach(p=>p.isNPC=false);
      forceDue(S); E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending;
      const p1=S.players[1];
      E.declareBankrupt(S,p1);
      A(p1.bankrupt===true, "測試前提：p1 應已標記破產");
      const cashBefore=p1.cash, escrowBefore=p1.ipoEscrow;
      const r=ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(rejOf(r)==="BANKRUPT", "破產玩家申購應被拒絕且理由為 BANKRUPT，實得 "+rejOf(r));
      A(p1.cash===cashBefore, "被拒絕的申購不該扣現金，實得 cash="+p1.cash+" 預期 "+cashBefore);
      A(p1.ipoEscrow===escrowBefore, "被拒絕的申購不該動到 ipoEscrow，實得 "+p1.ipoEscrow+" 預期 "+escrowBefore);
      A(ip.subs[1]===undefined, "被拒絕的申購不該留下 subs 紀錄");
      return "破產玩家申購被拒絕（BANKRUPT），現金與 ipoEscrow 都不變";
    });

    /* ⑥ 電腦玩家路徑：保留水位 ipoNpcReserveMonths 個月支出，付不起就不申購。 */
    step("⑥ 電腦玩家路徑（E.ipoPollNPC）：申購後現金仍需 >= reserveMonths×月支出，付不起就不出手",()=>{
      const S=mk(6,true);
      forceDue(S);
      const before={}; S.players.forEach(p=>before[p.id]=p.cash);
      E.openIpo(S,S.players[0]);   // 內部已呼叫過一次 E.ipoPollNPC
      const ip=S.ipo.pending;
      S.players.forEach(function(q){
        if(!q.isNPC) return;
        var subs=ip.subs[q.id]||[];
        var reserveMo=E.cfg(S,"ipoNpcReserveMonths",3);
        var fee=E.cfg(S,"ipoFee",0.02), notice=E.cfg(S,"ipoNoticeFee",0.05);
        subs.forEach(function(tier){
          var tierDef=ip.tiers[tier];
          var afterCash = before[q.id] - util.r2(tierDef.P+fee+notice);
          A(afterCash >= reserveMo*q.derived.totalExpenses - 0.02,
            "P"+q.id+" 申購 "+tier+" 後現金應仍 >= 保留水位，afterCash="+afterCash);
        });
      });
      var anySub = Object.keys(ip.subs).length>0;
      return "電腦申購筆數="+Object.keys(ip.subs).length+"（"+(anySub?"至少一人出手且都守住保留水位":"這個種子沒人出手，水位守住")+"）";
    });
    step("⑥b 電腦玩家路徑：水位不夠時完全不申購（把保留月數調到不可能負擔）",()=>{
      const S=mk(61,true,{ipoNpcReserveMonths:100000});
      forceDue(S);
      E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending;
      A(Object.keys(ip.subs).length===0, "保留水位高到不可能負擔時，電腦不該申購，實得 "+JSON.stringify(ip.subs));
      return "0 人申購";
    });

    /* ⑦ 結算時點與集資順序：E.beginTurn 裡 IPO 結算必須接在 S39 集資結算之後。 */
    step("⑦ 結算順序：同一次 beginTurn 若集資與新股都到期，集資的事件必須先於 IPO_SETTLED",()=>{
      const S=mk(7,true);
      const fromId=S.activePlayerIdx;   // 讓「當前玩家」正好是兩邊的發起人＝一次 beginTurn 就同時到期
      const card=ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==="BUSINESS"||c.kind==="REALESTATE")[0];
      A(card, "需要一張 BUSINESS／REALESTATE 卡佈置集資場景");
      var shares={}; shares[fromId]=0.5;
      // openedTurn 設成「上一輪」，這樣現在（同一位發起人的下一次回合）就已經到期，不必真的跑一整輪
      S.pendingSyndicate={ id:"SYTEST", cardId:card.id, title:card.title, fromId:fromId,
        openedTurn:Math.max(0,S.turnNumber-1), minShare:0.2, shares:shares, declined:{},
        entry:0, income:0 };
      S.ipo.pending = { id:"IPOTEST", fromId:fromId, openedTurn:Math.max(0,S.turnNumber-1),
        tiers:{ SMALL:E.ipoIssueTier(S,"IPOTEST","SMALL"), BIG:E.ipoIssueTier(S,"IPOTEST","BIG") },
        subs:{}, declined:{} };
      E._events=[];
      E.beginTurn(S);
      const evs=E._events.map(e=>e.type);
      const iSyn=evs.findIndex(t=>t==="SYNDICATE_FORMED"||t==="SYNDICATE_FAILED");
      const iIpo=evs.indexOf("IPO_SETTLED");
      A(iSyn>=0, "應該要有集資結算事件，實得 "+JSON.stringify(evs));
      A(iIpo>=0, "應該要有 IPO_SETTLED，實得 "+JSON.stringify(evs));
      A(iSyn<iIpo, "集資結算事件應該在 IPO_SETTLED 之前，實得順序 "+JSON.stringify(evs));
      return "集資(#"+iSyn+") 先於 IPO_SETTLED(#"+iIpo+")："+JSON.stringify(evs);
    });

    /* ⑧ 申購者破產：E.declareBankrupt 必須先呼叫 E.ipoRefundPlayer 解除預扣款，再走 p2pLiquidate。 */
    step("⑧ 申購者破產先退款：E.declareBankrupt 呼叫後，ipoEscrow 歸零、subs 移除該玩家、帳上已退款",()=>{
      const S=mk(8,true);
      forceDue(S);
      E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending;
      const p1=S.players[1];
      ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      A(p1.ipoEscrow>0, "申購後 ipoEscrow 應該 >0");
      const cashBefore=p1.cash, tierDef=ip.tiers.SMALL, notice=E.cfg(S,"ipoNoticeFee",0.05);
      E.declareBankrupt(S,p1);
      A(p1.ipoEscrow===0, "破產後 ipoEscrow 應歸零，實得 "+p1.ipoEscrow);
      A(S.ipo.pending.subs[1]===undefined, "破產後應該從 subs 移除，之後結算不會再碰到他");
      A(Math.abs(p1.cash-(cashBefore+util.r2(tierDef.P+notice)))<0.01, "破產退款金額應為 P+notice");
      A(p1.bankrupt===true, "應該真的標記破產");
      return "退款 "+util.r2(tierDef.P+notice)+"，subs 已移除";
    });

    /* ⑨ 舊存檔重放不觸發，且行為與關閉時一致：ipoLottery 未設定／設為 0 時 S.ipo 全程為 null，
       電腦全局重放（含存檔→ns.replay）結果逐位元一致，也不會產生任何 IPO_* 事件。 */
    step("⑨ 舊存檔／關閉時不觸發：S.ipo 全程 null，重放逐位元一致，不產生任何 IPO_* 事件",()=>{
      const cOld=util.clone(baseCfg); delete cOld.ipoLottery;   // 模擬「舊存檔沒有這個 key」
      const Sfresh=E.newGame({seed:900, config:cOld, modules:MODS,
        players:[0,1,2,3].map(i=>({name:'P'+i, isNPC:true, personality:['NPC_SAFE','NPC_SAFE','NPC_LEVER','NPC_VC'][i],
          professionId:pros[i*4].id, dreamCardId:ns.content.dreams[i].id}))});
      A(Sfresh.ipo===null || Sfresh.ipo===undefined, "未設定 ipoLottery 時 S.ipo 應為 null");
      E.beginTurn(Sfresh);
      let g=0, ipoEventSeen=false;
      while(!Sfresh.over && Sfresh.turnNumber<30 && g++<3000){
        let a=npc.nextAction(Sfresh)||{type:"END_TURN",playerId:E.activePlayer(Sfresh).id,payload:null};
        if(a.type==="DECIDE"&&Sfresh.pendingDecision) a.payload.decisionId=Sfresh.pendingDecision.decisionId;
        const r=ap(Sfresh,a);
        (r.events||[]).forEach(e=>{ if(String(e.type).indexOf("IPO")>=0) ipoEventSeen=true; });
        if(r.rejected) ap(Sfresh,{type:"END_TURN",playerId:E.activePlayer(Sfresh).id,payload:null});
        A(Sfresh.ipo===null || Sfresh.ipo===undefined, "全程 S.ipo 都應保持 null");
      }
      A(!ipoEventSeen, "關閉時不該出現任何 IPO_* 事件");
      const save={seed:900, config:Sfresh.config, modules:Sfresh.enabledModules,
        players:ns.seedPlayers(Sfresh), actionLog:Sfresh.actionLog};
      const replayed=ns.replay(save);
      A(JSON.stringify(replayed)===JSON.stringify(Sfresh), "重放應與原局逐位元一致");
      return "跑到第 "+Sfresh.turnNumber+" 輪，S.ipo 全程 null、無 IPO 事件、重放一致";
    });

    /* ⑩ 保底觸發：排定輪次過了 ipoGraceTurns 都沒人踩到 MARKET 格，輪首（第一位未破產玩家）強制開公告。 */
    step("⑩ 保底觸發：排定輪次 + ipoGraceTurns 都過了，E.beginTurn 在輪首強制開公告（不需要踩 MARKET 格）",()=>{
      const S=mk(10,true);
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];   // 排定「現在」
      const grace=E.cfg(S,"ipoGraceTurns",3);
      A(S.ipo.pending===null, "一開始不該有 pending");
      // 模擬「一直沒人踩到 MARKET 格」：直接把 turnNumber 往前推過 grace，只呼叫 beginTurn（不呼叫 landing）
      S.turnNumber = S.ipo.schedule[0] + grace + 1;
      S.activePlayerIdx = 0;   // player 0 是最小 id 未破產玩家＝第一個未破產玩家
      A(S.players[0]===E.alive(S)[0], "測試前提：player0 應是目前第一個未破產玩家");
      E.beginTurn(S);
      A(S.ipo.pending!==null, "過了保底輪數，輪首應強制開公告，實得 pending="+JSON.stringify(S.ipo.pending));
      A(S.ipo.fired[0]===true, "對應的排程索引應標記為已觸發");
      return "turnNumber="+S.turnNumber+"（排定 "+S.ipo.schedule[0]+" + grace "+grace+"）強制開公告成功";
    });

    /* 交叉裁決：D2 讀取 p.ipoEscrow 不得影響 totalAssets／netWorth（唯讀快取，不是第二本帳）。 */
    step("D2：p.ipoEscrow 不參與 ledger.recompute 的 totalAssets／netWorth 推導",()=>{
      const S=mk(11,true);
      forceDue(S);
      E.openIpo(S,S.players[0]);
      const p1=S.players[1], ip=S.ipo.pending;
      const nwBefore=p1.derived.netWorth, taBefore=p1.derived.totalAssets;
      ap(S,{type:"IPO_SUBSCRIBE",playerId:1,payload:{ipoId:ip.id,tier:"SMALL"}});
      // ASSET 分錄本身已經被 recompute 自動加總進 totalAssets（+P）；淨值只掉 fee+notice（ASSET+P 抵掉大部分 CASH 減少）
      const tierDef=ip.tiers.SMALL, fee=E.cfg(S,"ipoFee",0.02), notice=E.cfg(S,"ipoNoticeFee",0.05);
      const expectNW = util.r2(nwBefore - (fee+notice));
      A(Math.abs(p1.derived.netWorth-expectNW)<0.02, "淨值應只掉 fee+notice（不是掉整個 P，也不是被 ipoEscrow 重複扣一次），實得 "+p1.derived.netWorth+" 預期 "+expectNW);
      A(Math.abs(p1.derived.totalAssets-(taBefore+tierDef.P))<0.02, "totalAssets 應該只被 ASSET 分錄加一次 P，實得增量 "+(p1.derived.totalAssets-taBefore));
      // 手動把 ipoEscrow 改壞也不該動到 derived（證明它真的只是快取、沒有被拿去算）
      p1.ipoEscrow = 999999;
      ledger.recompute(p1);
      A(Math.abs(p1.derived.netWorth-expectNW)<0.02, "就算竄改 ipoEscrow，recompute 後淨值也不該變（它不在推導路徑上）");
      return "淨值只掉 fee+notice="+util.r2(fee+notice)+"；ipoEscrow 竄改不影響 recompute";
    });

    /* MARKET 格觸發（D5-1）：真正走 E.landing 的 case "MARKET"，不繞過真實程式碼路徑。 */
    step("D5-1：真人踩到 MARKET 格且新股到期 → 不抽市場卡、改推 IPO_ANNOUNCE 決策",()=>{
      const S=mk(12,false); S.players.forEach(p=>p.isNPC=false);
      forceDue(S);
      const p0=S.players[0];
      const drawsBefore=S.decks.MARKET.draw.length, discardBefore=S.decks.MARKET.discard.length;
      E.landing(S,p0,{type:"MARKET"});
      A(S.ipo.pending!==null, "應該已經開公告");
      A(S.decks.MARKET.draw.length===drawsBefore && S.decks.MARKET.discard.length===discardBefore,
        "不該抽市場卡（牌堆數量不該變）");
      E.syncPhase(S);
      A(S.pendingDecision && S.pendingDecision.kind==="IPO_ANNOUNCE", "真人應該收到 IPO_ANNOUNCE 決策，實得 "+JSON.stringify(S.pendingDecision));
      const r=ap(S,{type:"DECIDE",playerId:0,payload:{decisionId:S.pendingDecision.decisionId,optionId:"ok"}});
      A(!r.rejected, "ACK 應該過，實得 "+rejOf(r));
      return "MARKET 格觸發成功，決策可正常 ACK 掉";
    });
    step("D5-1b：電腦踩到 MARKET 格且新股到期 → 直接 ACK，不佔用 decisionQueue",()=>{
      const S=mk(13,true);
      forceDue(S);
      const p0=S.players[0];
      E.landing(S,p0,{type:"MARKET"});
      A(S.ipo.pending!==null, "應該已經開公告");
      A(S.decisionQueue.length===0, "電腦玩家不該留下待決事項，實得 "+JSON.stringify(S.decisionQueue));
      return "電腦踩格：直接處理、不卡決策佇列";
    });

    /* 全局整合：AI 對手路徑跑一整局（含破產／畢業等各種收尾）不噴錯、不產生 NaN、ASSET 分錄與 p.assets 不衝突。 */
    step("整合：8 個種子全電腦局，ipoLottery=1 全程跑完，無 NaN、無帳本殘留、gate 同款不變式成立",()=>{
      const seeds=[1,2,3,4,5,42,777,31337];
      let totalHist=0;
      seeds.forEach(seed=>{
        const S=mk(seed,true);
        let g=0;
        while(!S.over && g++<3000){
          let a=npc.nextAction(S)||{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null};
          if(a.type==="DECIDE"&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
          const r=ap(S,a);
          if(r.rejected) ap(S,{type:"END_TURN",playerId:E.activePlayer(S).id,payload:null});
        }
        totalHist += (S.ipo.history||[]).length;
        S.players.forEach(p=>{
          const d=p.derived;
          [p.cash,d.netWorth,d.totalAssets,d.totalLiabilities,d.passiveIncome,p.ipoEscrow].forEach(v=>{
            A(typeof v==="number" && isFinite(v), "seed "+seed+" player "+p.id+" 出現 NaN／Infinity："+v);
          });
          const bal={};
          p.ledger.forEach(en=>en.postings.forEach(q=>{
            if(q.account==="ASSET" && q.refId && q.refId.indexOf("IPO")===0) bal[q.refId]=(bal[q.refId]||0)+q.delta;
          }));
          Object.keys(bal).forEach(k=>{
            const v=util.r2(bal[k]);
            const stillPending = S.ipo.pending && k.indexOf(S.ipo.pending.id+"|")===0;
            A(Math.abs(v)<0.02 || stillPending, "seed "+seed+" player "+p.id+" 的 IPO ASSET 分錄沒有結清乾淨："+k+"="+v);
          });
        });
      });
      return seeds.length+" 個種子全部跑完，累積結算 "+totalHist+" 檔，無 NaN、無帳本殘留";
    });

    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;
  if(errs.length) errs.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  /* S2（ui-engineer）未預期發現，已在回報中詳述：原本這裡是 process.exit(...)，S1／S2 兩段
     各自的 IIFE 若都各自呼叫 process.exit，會在同一個 node 行程裡互踩——不管哪一段的瀏覽器
     操作先跑完，先呼叫到 process.exit 的那一段就會把整個行程砍掉，另一段（通常是步驟數少、
     跑得快的那段）很可能根本來不及執行或印出結果，而且不是每次都會用一樣的順序重現。
     改法：只把「拿到結果後要不要結束行程」延後，本段以上的每一行測試邏輯與斷言完全沒有改動。 */
  return {pass, fail, pageErrors:errs.length};
})().then(function(r1){ return runS2Page(r1); }).catch(function(err){
  console.error('s45test.js S1 段落發生未預期錯誤：', err && err.stack || err);
  process.exit(1);
});
/* ===== S1 段落結束，以下是 S2（ui-engineer）續寫的 page 段落 =====
   對應分派單 T-001/S2：IPO_ANNOUNCE 決策卡、交易所「新股申購中」列、事件訊息欄／POP、
   淨值面板的申購預扣款顯示。自己重新 launch 一個 browser（不共用上面那個 b／pg），
   驗證方式與 S1 段落一樣是 page.evaluate 直接操作 ns.ui／ns.engine。 */
async function runS2Page(r1){
  const b2=await chromium.launch(); const pg2=await b2.newPage({viewport:{width:1440,height:960}});
  const errs2=[]; pg2.on('pageerror',e=>errs2.push('PAGEERROR '+e.message));
  pg2.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs2.push('CONSOLE '+m.text()); });
  await pg2.goto('file://'+TARGET,{waitUntil:'load'}); await pg2.waitForTimeout(900);
  const log2=await pg2.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    const MODS=["M1","M2","M3","M4","M6","M8"];
    // 四人局：0 號真人（ui.myId() 預設 0，單機不開 ui.mp），其餘電腦——跟 s39test 同款佈置
    const four=["我","小美","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>=2,
      personality:["","","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); c.ipoLottery=1; if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||4500, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const cashTo=(S,p,v)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:util.r2(v-p.cash),label:"x"}],{eduTags:["setup"]});
    const forceDue=(S)=>{ S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false]; };
    const sheetTxt=()=>document.getElementById('sheet').textContent;
    const boardTxt=()=>document.getElementById('infoM')?document.getElementById('infoM').textContent:document.body.textContent;

    step("決策卡 IPO_ANNOUNCE：兩檔並排顯示申購價／參考價／價差／中籤率；g<0.25 時（且僅當時）顯示「可能破發」；三個按鈕齊全",()=>{
      const S=fresh(4501); cashTo(S,S.players[0],5000);
      forceDue(S); E.openIpo(S,S.players[0]); E.syncPhase(S);
      ui.render();
      const card=document.querySelector('#center .card');
      A(card, "應該出現決策卡");
      A(/新股申購公告/.test(card.textContent), "標題應該是新股申購公告");
      A(/小資檔/.test(card.textContent) && /股王檔/.test(card.textContent), "應該同時列出小資檔與股王檔");
      ["申購價","參考價","價差","中籤率"].forEach(k=>A(card.textContent.indexOf(k)>=0, "應該出現欄位「"+k+"」"));
      const ip=S.ipo.pending;
      const gLow = ip.tiers.SMALL.g<0.25 || ip.tiers.BIG.g<0.25;
      A(gLow===/可能破發/.test(card.textContent),
        "g<0.25 時（且僅當時）應該出現「可能破發」，g_small="+ip.tiers.SMALL.g+" g_big="+ip.tiers.BIG.g);
      const btns=Array.from(card.querySelectorAll('.opts button'));
      A(btns.some(x=>/申購小資檔/.test(x.textContent)), "應該有「申購小資檔」按鈕");
      A(btns.some(x=>/申購股王檔/.test(x.textContent)), "應該有「申購股王檔」按鈕");
      A(btns.some(x=>/^都不要/.test(x.textContent)), "應該有「都不要」按鈕");
      return "兩檔並排、四欄位齊全、按鈕齊全"+(gLow?"（本次含破發提示）":"（本次未觸發破發提示）");
    });

    step("申購小資檔：送出 IPO_SUBSCRIBE、決策卡關閉、淨值面板出現「申購預扣款」、不留一句看不懂的「決定：sub_small」",()=>{
      const S=fresh(4502); const p0=S.players[0]; cashTo(S,p0,5000);
      forceDue(S); E.openIpo(S,S.players[0]); E.syncPhase(S);
      ui.render();
      A(!/申購預扣款/.test(sheetTxt()), "申購前，淨值面板不該出現申購預扣款");
      const card=document.querySelector('#center .card');
      const btn=Array.from(card.querySelectorAll('.opts button')).filter(x=>/申購小資檔/.test(x.textContent))[0];
      A(btn && !btn.disabled, "小資檔按鈕應該可以點（現金充足）");
      ui.feed=[];
      btn.click();
      // ui.dispatch 內部是 E.apply(ui.S, action)，沒有 {mutate:true} 就會 clone（applyAction.js:203）；
      // 點擊之後 ui.S 已經換成新的物件，測試不能再讀點擊前捕捉到的 S／p0（會是没更新的舊快照）。
      const S2=ui.S, p0b=S2.players[0];
      A(S2.ipo.pending.subs[0] && S2.ipo.pending.subs[0].indexOf("SMALL")>=0, "應該已經記錄申購小資檔");
      A(p0b.ipoEscrow>0, "申購後 ipoEscrow 應該 >0");
      A(!S2.pendingDecision || S2.pendingDecision.kind!=="IPO_ANNOUNCE", "決策卡應該已經關閉");
      A(!ui.feed.some(r=>/決定：sub_small/.test(r.msg)), "不該再多印一行看不懂代號的「決定：sub_small」（IPO_SUBSCRIBED 事件本身已經播報過申購了）");
      ui.render();
      A(/申購預扣款/.test(sheetTxt()), "申購後，淨值面板應該顯示申購預扣款");
      return "申購成功、卡片關閉、淨值面板顯示預扣款、訊息欄沒有多餘的代號行";
    });

    step("都不要：送出 IPO_DECLINE、決策卡關閉、不扣現金",()=>{
      const S=fresh(4503); const p0=S.players[0]; cashTo(S,p0,5000);
      const cashBefore=p0.cash;
      forceDue(S); E.openIpo(S,S.players[0]); E.syncPhase(S);
      ui.render();
      const card=document.querySelector('#center .card');
      const btn=Array.from(card.querySelectorAll('.opts button')).filter(x=>/^都不要/.test(x.textContent))[0];
      A(btn, "應該有都不要按鈕");
      btn.click();
      const S2=ui.S;   // 同上：dispatch 之後要讀 ui.S，不能讀點擊前的舊快照
      A(S2.ipo.pending.declined[0]===true, "應該記錄婉拒");
      A(Math.abs(S2.players[0].cash-cashBefore)<0.01, "婉拒不該扣錢");
      A(!S2.pendingDecision || S2.pendingDecision.kind!=="IPO_ANNOUNCE", "決策卡應該已經關閉");
      return "婉拒成功、卡片關閉、現金不變";
    });

    step("交易所「📢 新股申購中」列：存在時顯示，點擊可以追加申購還沒申購過的那一檔",()=>{
      const S=fresh(4504); const p0=S.players[0]; cashTo(S,p0,10000);
      forceDue(S); E.openIpo(S,S.players[0]); E.syncPhase(S);
      ui.render();
      const card=document.querySelector('#center .card');
      Array.from(card.querySelectorAll('.opts button')).filter(x=>/申購小資檔/.test(x.textContent))[0].click();
      ui.render();
      A(/新股申購中/.test(boardTxt()), "交易所應該列出進行中的新股申購");
      const row=Array.from(document.querySelectorAll('div.gold')).filter(d=>/新股申購中/.test(d.textContent))[0];
      A(row, "應該找得到「新股申購中」這一列");
      A(row.style.cursor==="pointer", "還沒兩檔都申購過的真人，這一列應該可以點");
      row.click();
      const ov=document.querySelector('#overlays .overlay');
      A(ov, "點擊後應該開啟申購面板（ui.showIpoOffer）");
      A(/已申購/.test(ov.textContent), "小資檔應該已經標示已申購");
      const bigBtn=Array.from(ov.querySelectorAll('button')).filter(x=>/申購（付/.test(x.textContent))[0];
      A(bigBtn, "股王檔應該還有可以點的申購按鈕");
      bigBtn.click();
      A(ui.S.ipo.pending.subs[0].indexOf("BIG")>=0, "追加申購股王檔應該成功");   // 讀 ui.S，不能讀點擊前的舊快照
      A(!document.querySelector('#overlays .overlay'), "申購後面板應該自動關閉");
      return "交易所列示正確、點擊可追加申購第二檔";
    });

    step("訊息欄／POP：IPO_OPENED／IPO_SUBSCRIBED／IPO_SETTLED 都有合理文字說明，且帶得出真正的檔名（不是 SMALL/BIG 代號）",()=>{
      const S=fresh(4505); const p0=S.players[0]; cashTo(S,p0,5000);
      forceDue(S); E.openIpo(S,S.players[0]);
      const ip=S.ipo.pending;
      ui.feed=[];
      ui.handleEvents([{type:"IPO_OPENED", id:ip.id, fromId:0, tiers:ip.tiers}]);
      A(ui.feed.some(r=>/新股申購開放/.test(r.msg) && r.msg.indexOf(ip.tiers.SMALL.name)>=0),
        "IPO_OPENED 應該播報開放申購，且帶到檔名「"+ip.tiers.SMALL.name+"」，實得 "+JSON.stringify(ui.feed.map(r=>r.msg)));
      ui.handleEvents([{type:"IPO_SUBSCRIBED", ipoId:ip.id, tier:"SMALL", playerId:0, price:ip.tiers.SMALL.P}]);
      A(ui.feed.some(r=>/申購/.test(r.msg) && r.msg.indexOf(ip.tiers.SMALL.name)>=0),
        "IPO_SUBSCRIBED 應該播報申購且帶到檔名，不是原始代號 SMALL");
      ui.handleEvents([{type:"IPO_SETTLED", id:ip.id, results:[{playerId:0,tier:"SMALL",won:true,amount:ip.tiers.SMALL.listPrice}]}]);
      A(ui.feed.some(r=>/新股抽籤結算/.test(r.msg)), "IPO_SETTLED 應該播報結算摘要");
      return "三種事件都有合理文字說明，且都帶得出真正的檔名";
    });

    return L;
  });
  log2.forEach(l=>console.log(l));
  const pass2=log2.filter(l=>l.startsWith('OK')).length, fail2=log2.filter(l=>l.startsWith('FAIL')).length;
  if(errs2.length) errs2.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass:pass2, fail:fail2, pageErrors:errs2.length}));
  await b2.close();
  const combinedFail = (r1.fail||0)+fail2, combinedErr = (r1.pageErrors||0)+errs2.length;
  process.exit(combinedFail||combinedErr?1:0);
}

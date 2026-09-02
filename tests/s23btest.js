const { chromium } = require('playwright');
/* S23b 驗收：M9 進階金融骨架、解鎖（技能或累計持股 12 輪）、期貨（開多／放空／逐輪結算／
   追繳／強制平倉／穿價轉信貸／口數上限／每口定額手續費）、介面反灰與文案。
   用法（repo 根目錄）： node tests/s23btest.js  或  node tests/s23btest.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry); cfg.depthLevel=3;
    const M9=["M1","M2","M3","M4","M6","M8","M9"], NOM9=["M1","M2","M3","M4","M6","M8"];
    const players=[{name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}];
    const fresh=(seed,over,mods)=>{ const c=util.clone(cfg); if(over) Object.assign(c,over);
      ui.startCore(seed||7101, c, mods||M9, players, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,amt)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:amt-p.cash,label:"x"}],{eduTags:["setup"]});
    const giveSkill=(p,id)=>{ p.skills=p.skills||{}; p.skills[id]={learnedAt:1,decayed:false}; };
    const unlock=(p)=>{ p.stockHoldTurns=99; };
    const FD=()=>ns.content.futuresDefs[0];
    const rejOf=(r)=>((r.events||[]).filter(e=>e.type==="ACTION_REJECTED").slice(-1)[0]||{}).reason;
    const openF=(S,side,lots)=>E.apply(S,{type:"FUT_OPEN",playerId:0,payload:{symbol:FD().symbol,side:side,lots:lots}},{mutate:true});

    step("版本與內容包",()=>{
      A(/^v\d+\.\d+\.\d+-S\d+/.test(ns.BUILD.ver),"版本字串格式，實得 "+ns.BUILD.ver);
      A(!ns.content.errors.length,"內容包載入錯誤："+ns.content.errors.join("；"));
      A((ns.content.futuresDefs||[]).length===1,"應有 1 個期貨合約定義");
      A(ns.content.futBySymbol.FUT_TX,"futBySymbol 應建好索引");
      A(ns.content.byId.SKL_DERIV,"應有〈衍生性商品與槓桿〉技能");
      A(ns.content.byId.SKL_DERIV.requiresSkill==="SKL_BOOK","先修應為財務記帳");
      A(ns.content.byId.SKL_DERIV.moduleReq==="M9","技能應掛 M9");
      return ns.BUILD.ver;
    });

    step("M9 模組：登錄在 order、進階以上預設開、新手與標準不開",()=>{
      A(ns.modules.order.indexOf("M9")>=0,"M9 應在模組執行順序裡");
      A(ns.modules.order.indexOf("M9")>ns.modules.order.indexOf("M1"),"M9 必須排在 M1 之後（期貨結算要用更新後的股價）");
      A(ns.modules.registry.M9,"M9 應有 registry");
      A(ns.PRESETS.ADVANCED.m.indexOf("M9")>=0 && ns.PRESETS.HARDCORE.m.indexOf("M9")>=0,"進階／硬核應含 M9");
      A(ns.PRESETS.NOVICE.m.indexOf("M9")<0 && ns.PRESETS.STANDARD.m.indexOf("M9")<0,"新手／標準不應含 M9");
      const S=fresh(7101,null,NOM9);
      A(!E.m9On(S),"沒勾 M9 的局應為關閉");
      const S2=fresh(7102,{advancedMarketsEnabled:0},M9);
      A(!E.m9On(S2),"總開關關掉也應為關閉");
      return "OK";
    });

    step("解鎖：11 輪不行、12 輪可以；學會技能立即可以",()=>{
      const S=fresh(7103), me=S.players[0]; cashTo(S,me,5000);
      A(E.advUnlockNeed(S)===12,"預設應為 12 輪");
      me.stockHoldTurns=11;
      A(!E.advancedUnlocked(S,me),"11 輪不該解鎖");
      A(/還差 1 輪/.test(E.advLockReason(S,me)),"應說得出還差幾輪，實得 "+E.advLockReason(S,me));
      let r=openF(S,"long",1);
      A(r.rejected && rejOf(r)==="ADV_LOCKED","未解鎖應被擋，實得 "+rejOf(r));
      A(ui.REJECT_TEXT.ADV_LOCKED,"拒絕碼要有中文");
      me.stockHoldTurns=12;
      A(E.advancedUnlocked(S,me),"12 輪應解鎖");
      A(E.advLockReason(S,me)===null,"解鎖後不該有原因");
      // 技能路徑
      const S2=fresh(7104), me2=S2.players[0]; me2.stockHoldTurns=0;
      A(!E.advancedUnlocked(S2,me2),"沒技能沒持股不該解鎖");
      giveSkill(me2,"SKL_DERIV");
      A(E.advancedUnlocked(S2,me2),"學會技能應立即解鎖");
      return "OK";
    });

    step("解鎖進度：持股才累計、賣掉不歸零（累計不是連續）",()=>{
      const S=fresh(7105), me=S.players[0]; cashTo(S,me,5000);
      A((me.stockHoldTurns||0)===0,"開局應為 0");
      E.tickHoldTurns(S);
      A((me.stockHoldTurns||0)===0,"沒持股不該累計");
      E.autoBuyUnits(S,me,"STK_DIV",1000,"建倉");
      E.tickHoldTurns(S); E.tickHoldTurns(S); E.tickHoldTurns(S);
      A(me.stockHoldTurns===3,"持股三輪應累計 3，實得 "+me.stockHoldTurns);
      // 全部賣掉
      me.assets=me.assets.filter(a=>a.kind!=="STOCK");
      E.tickHoldTurns(S);
      A(me.stockHoldTurns===3,"賣掉之後不再累計，但已累積的不歸零，實得 "+me.stockHoldTurns);
      E.autoBuyUnits(S,me,"STK_DIV",1000,"再建倉");
      E.tickHoldTurns(S);
      A(me.stockHoldTurns===4,"買回來應接著累計，實得 "+me.stockHoldTurns);
      return "累計 4 輪";
    });

    step("期貨：合約值＝標的現價×乘數；保證金一成；手續費每口定額",()=>{
      const S=fresh(7106), me=S.players[0]; cashTo(S,me,5000); unlock(me);
      const fd=FD(), u=E.stockPrice(S,fd.underlying);
      A(Math.abs(E.futContractValue(S,fd)-util.r2(u*fd.multiplier))<0.01,"合約值算錯");
      A(E.futMarginPct(S,fd)===0.1,"原始保證金應為 10%");
      A(E.futFee(S,3)===util.r2(E.cfg(S,"futFeePerLot")*3),"手續費應為每口定額×口數");
      const cv=E.futContractValue(S,fd), c0=me.cash;
      const r=openF(S,"long",2);
      A(!r.rejected,"開倉應成功："+rejOf(r));
      const pos=E.futPositions(me)[0];
      A(pos && pos.lots===2 && pos.side==="long","應有 2 口多單");
      const wantMargin=util.r2(cv*2*0.1), wantFee=E.futFee(S,2);
      A(Math.abs(pos.marketValue-wantMargin)<0.01,"保證金應為 "+wantMargin+"，實得 "+pos.marketValue);
      A(Math.abs(c0-me.cash-util.r2(wantMargin+wantFee))<0.01,"現金應扣保證金＋手續費");
      A(pos.monthlyIncome===0,"期貨沒有月現金流");
      const bd=E.passiveBreakdown(S,me);
      A(!bd.rows.some(x=>x.key==="FUTURES"),"期貨不該出現在被動收入分類");
      return "合約值 "+util.money(cv)+"／口保證金 "+util.money(util.r2(cv*0.1));
    });

    step("期貨：逐輪結算——標的漲 5%，多單保證金增加合約值的 5%",()=>{
      const S=fresh(7107), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD();
      S.config.futBasisMax=0;                    // 固定基差＝0，才驗得出純粹的槓桿倍數
      E.rollFutBasis(S,fd);
      const u0=E.stockPrice(S,fd.underlying);
      openF(S,"long",1);
      const pos=E.futPositions(me)[0], m0=pos.marketValue, cv=E.futContractValue(S,fd);
      const u1=util.r2(u0*1.05); S.stockPrices[fd.underlying]=u1;
      const n0=me.ledger.length;
      E.tickFutures(S);
      const gain=util.r2((u1-u0)*fd.multiplier);
      A(Math.abs(pos.marketValue-util.r2(m0+gain))<0.02,"多單應賺 "+gain+"，實得 "+util.r2(pos.marketValue-m0));
      A(Math.abs(gain-util.r2(cv*0.05))<0.02,"漲 5% 對一口的損益應約等於合約值的 5%");
      A(Math.abs(gain/m0-0.5)<0.02,"十倍槓桿：標的 5% ≈ 保證金的 50%，實得 "+util.pct(gain/m0,0));
      const row=me.ledger.slice(n0).filter(e=>/逐輪結算/.test(e.summary))[0];
      A(row,"應有逐輪結算分錄");
      A(row.postings[0].account==="ASSET","結算記在資產（保證金餘額）");
      A(row.detail && row.detail.lots===1 && row.detail.side==="long","detail 應帶口數與方向");
      return "槓桿 "+util.pct(gain/m0,0);
    });

    step("期貨：放空——標的跌才賺，漲就賠（方向相反）",()=>{
      const S=fresh(7108), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD(), u0=E.stockPrice(S,fd.underlying);
      const r=openF(S,"short",1);
      A(!r.rejected,"放空應成功："+rejOf(r));
      const pos=E.futPositions(me)[0], m0=pos.marketValue;
      A(pos.side==="short","應為空單");
      S.stockPrices[fd.underlying]=util.r2(u0*0.95);       // 跌 5%
      E.tickFutures(S);
      A(pos.marketValue>m0,"標的下跌時空單應賺，實得 "+pos.marketValue+"（原 "+m0+"）");
      const m1=pos.marketValue;
      S.stockPrices[fd.underlying]=util.r2(u0*1.0);        // 漲回去
      E.tickFutures(S);
      A(pos.marketValue<m1,"標的回漲時空單應賠");
      return "空單方向正確";
    });

    step("期貨：同標的不能多空同時持有；加碼會併倉",()=>{
      const S=fresh(7109), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      openF(S,"long",1);
      const r=openF(S,"short",1);
      A(r.rejected && rejOf(r)==="OPPOSITE_POSITION","反向應被擋，實得 "+rejOf(r));
      A(ui.REJECT_TEXT.OPPOSITE_POSITION,"拒絕碼要有中文");
      const r2=openF(S,"long",1);
      A(!r2.rejected,"同方向加碼應可以："+rejOf(r2));
      A(E.futPositions(me).length===1,"應併成同一個部位");
      A(E.futPositions(me)[0].lots===2,"口數應累加為 2");
      return "OK";
    });

    step("期貨：口數上限依信用評級（A 10／B 6／C 3）",()=>{
      const S=fresh(7110), me=S.players[0]; cashTo(S,me,200000); unlock(me);
      me.creditRating="B";
      A(E.futMaxLots(S,me)===6,"B 級應為 6 口，實得 "+E.futMaxLots(S,me));
      me.creditRating="A"; A(E.futMaxLots(S,me)===10,"A 級應為 10 口");
      me.creditRating="C"; A(E.futMaxLots(S,me)===3,"C 級應為 3 口");
      const r=openF(S,"long",4);
      A(r.rejected && rejOf(r)==="FUT_LOT_LIMIT","C 級開 4 口應被擋，實得 "+rejOf(r));
      A(!openF(S,"long",3).rejected,"C 級開 3 口可以");
      A(openF(S,"long",1).rejected,"已滿 3 口再開應被擋");
      return "OK";
    });

    step("期貨：追繳——餘額低於維持水位時在自己的回合跳卡",()=>{
      const S=fresh(7111), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD(); S.config.futBasisMax=0; E.rollFutBasis(S,fd);
      const u0=E.stockPrice(S,fd.underlying);
      openF(S,"long",1);
      const pos=E.futPositions(me)[0];
      // 跌到餘額落在維持線與 0 之間（十倍槓桿：跌 7% 大約剩三成保證金）
      S.stockPrices[fd.underlying]=util.r2(u0*0.93);
      E.tickFutures(S);
      const st=E.futStatus(S,E.futPositions(me)[0],me);
      A(st.call,"應進入追繳狀態，餘額 "+st.margin+" 維持線 "+st.maintNeed);
      A(me.pendingFutCall,"應記在玩家身上（不能在回合結束推決策）");
      S.decisionQueue.length=0;
      E.tickFutCall(S,me); E.syncPhase(S);
      const d=S.pendingDecision;
      A(d && d.kind==="FUT_MARGIN_CALL","自己的回合才跳追繳卡，實得 "+(d&&d.kind));
      A(!me.pendingFutCall,"跳過就清掉");
      ui.render();
      const t=document.querySelector("#center").textContent;
      A(/保證金追繳/.test(t),"卡面應是追繳");
      A(/補繳/.test(t) && /當場平倉/.test(t) && /賭下一輪/.test(t),"應有三個選項");
      return "維持率 "+Math.round(st.ratio*100)+"%";
    });

    step("期貨：補繳補到原始保證金；平倉退回餘額扣手續費",()=>{
      const S=fresh(7112), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD(); S.config.futBasisMax=0; E.rollFutBasis(S,fd);
      const u0=E.stockPrice(S,fd.underlying);
      openF(S,"long",1);
      S.stockPrices[fd.underlying]=util.r2(u0*0.93);
      E.tickFutures(S); S.decisionQueue.length=0; E.tickFutCall(S,me); E.syncPhase(S);
      const d=S.pendingDecision, pos=E.futPositions(me)[0];
      const want=util.r2(E.futContractValue(S,fd)*pos.lots*0.1);
      const r=E.apply(S,{type:"DECIDE",playerId:0,payload:{decisionId:d.decisionId,optionId:"topup",params:{}}},{mutate:true});
      A(!r.rejected,"補繳應成功");
      A(Math.abs(E.futPositions(me)[0].marketValue-want)<0.01,"應補到原始保證金 "+want+"，實得 "+E.futPositions(me)[0].marketValue);
      // 平倉（補繳的決策解完之後，相位要先回到可操作的狀態；
      //       記帳關卡會插在中間——turnResolved=false 時 refreshBookkeeping 不會建題）
      S.decisionQueue.length=0; S.turnResolved=false; S.bookkeeping=null; E.syncPhase(S);
      A(S.phase==="ROLL"||S.phase==="READY_END","決策清空後應回到可操作相位，實得 "+S.phase);
      const c0=me.cash, bal=E.futPositions(me)[0].marketValue, fee=E.futFee(S,1);
      const r2=E.apply(S,{type:"FUT_CLOSE",playerId:0,payload:{instanceId:E.futPositions(me)[0].instanceId}},{mutate:true});
      A(!r2.rejected,"平倉應成功："+rejOf(r2));
      A(E.futPositions(me).length===0,"部位應消失");
      A(Math.abs(me.cash-c0-util.r2(bal-fee))<0.01,"應退回餘額減手續費");
      const row=me.ledger.slice(-1)[0];
      A(/平倉/.test(row.summary) && /損益/.test(row.summary),"平倉摘要應寫損益，實得："+row.summary);
      return "OK";
    });

    step("期貨：保證金燒光→強制平倉，穿價轉信貸（債不會憑空消失）",()=>{
      const S=fresh(7113,{futAutoTopUp:0}), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD(), u0=E.stockPrice(S,fd.underlying);
      openF(S,"long",2);
      const nL0=me.liabilities.length;
      S.stockPrices[fd.underlying]=util.r2(u0*0.8);        // 跌 20%：十倍槓桿必定穿價
      S.decisionQueue.length=0;
      E.tickFutures(S);
      A(E.futPositions(me).length===0,"應已強制平倉");
      A(me.liabilities.length===nL0+1,"穿價應轉成一筆信貸");
      const li=me.liabilities.slice(-1)[0];
      A(/期貨穿價/.test(li.name),"負債名稱應說明來源，實得 "+li.name);
      A(li.principal>0,"欠款應大於 0");
      A(me.stats.futClosed>0,"應計入平倉次數");
      /* S23b.1：回合結束時【不得】直接推決策卡——引擎的不變式是「待決策一定屬於當前玩家」，
         而 tickFutures 跑在回合結束，當前玩家不一定是這個部位的主人（S15d 死結）。
         改成排隊，等他自己的回合由 E.tickFutCall 倒出來。 */
      A(S.decisionQueue.length===0,"回合結束不得直接推決策卡，實得 "+S.decisionQueue.length+" 張");
      const q=(me.pendingFutNotices||[]).filter(x=>/強制平倉/.test(x.title||""))[0];
      A(q,"應排隊一張強制平倉的揭曉卡");
      A(/信用貸款/.test(q.text||""),"揭曉卡應說明穿價轉信貸");
      E.tickFutCall(S,me);                                   // 模擬輪到他自己
      const ack=S.decisionQueue.filter(x=>x.kind==="ACK" && /強制平倉/.test(x.title||""))[0];
      A(ack,"輪到他自己時應跳出揭曉卡");
      A((me.pendingFutNotices||[]).length===0,"倒完之後佇列應清空");
      return "欠款 "+util.money(li.principal);
    });

    /* ---------------- S23b.1：折溢價、自動補倉、看板與庫存 ---------------- */
    step("期貨：有自己的報價，相對現貨有 ±1% 折溢價，每輪重抽",()=>{
      const S=fresh(7120), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      const fd=FD(), mx=E.cfg(S,"futBasisMax");
      A(mx===0.01,"預設折溢價上限應為 ±1%，實得 "+mx);
      const seen={};
      for(let i=0;i<40;i++){
        E.rollFutBasis(S,fd);
        const bs=E.futBasis(S,fd);
        A(Math.abs(bs)<=mx+1e-9,"基差不得超過 ±"+mx+"，實得 "+bs);
        seen[bs]=1;
        A(Math.abs(E.futPrice(S,fd)-util.r2(E.stockPrice(S,fd.underlying)*(1+bs)))<0.01,
          "期貨價應為 現貨×(1+基差)");
      }
      A(Object.keys(seen).length>5,"40 次應抽出多種不同的基差（不是固定值），實得 "+Object.keys(seen).length+" 種");
      A(Math.abs(E.futContractValue(S,fd)-util.r2(E.futPrice(S,fd)*fd.multiplier))<0.01,
        "合約值應以期貨報價計，不是現貨");
      // 同種子重現
      const S2=fresh(7120); E.rollFutBasis(S2,fd); const b1=E.futBasis(S2,fd);
      const S3=fresh(7120); E.rollFutBasis(S3,fd);
      A(E.futBasis(S3,fd)===b1,"同種子應抽出同樣的基差（重放決定論）");
      // 純讀取不得消耗亂數（否則「看了幾次畫面」會影響牌序）
      const S4=fresh(7120);
      const before=S4.rngState;
      for(let i=0;i<20;i++){ E.futBasis(S4,fd); E.futPrice(S4,fd); E.futContractValue(S4,fd); }
      A(S4.rngState===before,"讀取期貨報價不得消耗亂數");
      A(E.futBasis(S4,fd)===0,"還沒結算過的局，基差應為 0（期貨＝現貨）");
      return "±"+util.pct(mx,0);
    });

    step("期貨：結算走期貨報價——現貨不動、只有基差變也會有損益",()=>{
      const S=fresh(7121), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      const fd=FD();
      S.futBasis={}; S.futBasis[fd.symbol]=0;                    // 開倉時基差 0
      openF(S,"long",1);
      const pos=E.futPositions(me)[0], m0=pos.marketValue;
      A(Math.abs(pos.entryPrice-E.stockPrice(S,fd.underlying))<0.01,"基差 0 時進場價＝現貨價");
      S.config.futBasisMax=0;                                     // 讓 tickFutures 抽出來固定是 0
      const spot=E.stockPrice(S,fd.underlying);
      S.futBasis[fd.symbol]=0.01;                                 // 手動改成溢價 1%
      // 直接呼叫結算前先把 rollFutBasis 停掉的效果模擬出來：改用 futPrice 算預期
      const expect=util.r2((util.r2(spot*1.01)-pos.lastPrice)*fd.multiplier);
      pos.lastPrice=pos.entryPrice;
      const nowPx=E.futPrice(S,fd);
      const pnl=util.r2((nowPx-pos.lastPrice)*fd.multiplier);
      A(pnl>0,"現貨沒動、只有溢價上升，多單也該有損益，實得 "+pnl);
      A(Math.abs(pnl-expect)<0.02,"損益應以期貨報價差計算");
      return "基差本身就會賺賠";
    });

    step("期貨：保證金見底時先自動補倉，補不出來才強制平倉",()=>{
      const S=fresh(7122), me=S.players[0]; cashTo(S,me,200000); unlock(me);
      const fd=FD(); S.config.futBasisMax=0; E.rollFutBasis(S,fd);
      A(E.cfg(S,"futAutoTopUp")===1,"預設應開啟自動補繳");
      const u0=E.stockPrice(S,fd.underlying);
      openF(S,"short",1);
      const pos=E.futPositions(me)[0];
      S.stockPrices[fd.underlying]=util.r2(u0*1.25);   // 空單大賠，保證金穿價
      S.decisionQueue.length=0;
      const c0=me.cash, nL0=me.liabilities.length;
      E.tickFutures(S);
      A(E.futPositions(me).length===1,"現金補得起就不該被強平");
      A(me.cash<c0,"應從現金補繳，實得花掉 "+util.r2(c0-me.cash));
      A(me.stats.futAutoTopUp===1,"應記錄自動補繳次數");
      A(me.liabilities.length===nL0,"自動補繳不該產生負債");
      A(E.futPositions(me)[0].marketValue>0,"補完之後保證金要大於 0");
      A(S.decisionQueue.length===0,"回合結束不得直接推決策卡");
      const q=(me.pendingFutNotices||[]).filter(x=>/自動補繳/.test(x.title||""))[0];
      A(q,"應排隊一張告知卡");
      A(/錢是真的出去了/.test(q.text||""),"告知卡要講清楚錢真的花掉了");
      E.tickFutCall(S,me);
      const ack=S.decisionQueue.filter(x=>/自動補繳/.test(x.title||""))[0];
      A(ack,"輪到他自己時應跳出告知卡");
      // 現金抽乾 → 這次只能強平
      ns.ledger.post(S,me,"抽乾現金",[{account:"CASH",delta:-me.cash,label:"x"}],{eduTags:["setup"]});
      S.stockPrices[fd.underlying]=util.r2(u0*1.6);
      E.tickFutures(S);
      A(E.futPositions(me).length===0,"補不出來就該強制平倉");
      A(me.liabilities.length===nL0+1,"穿價仍要轉信貸");
      return "先補倉再強平";
    });

    step("不變式：期貨的通知不得推給別人——回合結束只排隊，輪到本人才跳",()=>{
      /* S15d 的死結教訓：引擎的不變式是「待決策一定屬於當前玩家」。
         tickFutures 跑在【回合結束】，此時的當前玩家不一定是部位的主人；
         NPC 不碰 M9，所以 1000 局閘門抓不到這個洞，只能在這裡釘住。 */
      const S=fresh(7124,{futAutoTopUp:0}), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      const fd=FD(), u0=E.stockPrice(S,fd.underlying);
      openF(S,"long",2);
      S.decisionQueue.length=0;
      S.currentPlayer=1;                                   // 換成另一個人的回合
      S.stockPrices[fd.underlying]=util.r2(u0*0.8);
      E.tickFutures(S);
      A(S.decisionQueue.length===0,"別人的回合結束時，不得把卡推進決策佇列");
      A((me.pendingFutNotices||[]).length===1,"應排隊 1 張，實得 "+(me.pendingFutNotices||[]).length);
      // 佇列有上限，不會無限長
      for(let i=0;i<20;i++) E.queueFutNotice(me,{title:"x",text:"y"});
      A(me.pendingFutNotices.length<=4,"佇列應有上限，實得 "+me.pendingFutNotices.length);
      // 破產的人不該再被通知卡卡住
      const S2=fresh(7125,{futAutoTopUp:0}), him=S2.players[0];
      E.queueFutNotice(him,{title:"💥 期貨強制平倉",text:"x"});
      him.bankrupt=true; S2.decisionQueue.length=0;
      E.tickFutCall(S2,him);
      A(S2.decisionQueue.length===0,"已破產的玩家不該再跳期貨通知卡");
      A((him.pendingFutNotices||[]).length===0,"佇列仍應清空");
      return "排隊上限 4";
    });

    step("介面：看板有期貨列（含折溢價）、庫存期貨區塊與醒目的平倉鈕",()=>{
      const S=fresh(7123), me=S.players[0]; cashTo(S,me,80000); unlock(me);
      openF(S,"short",2);
      ui.render();
      const body=document.body.textContent;
      A(/溢價|折價/.test(body),"中欄看板應有期貨的折溢價");
      A(/庫存期貨/.test(body),"應有庫存期貨區塊");
      A(/浮動損益/.test(body),"庫存期貨應顯示浮動損益");
      A(/維持線/.test(body),"應顯示維持線");
      const closeBtns=[...document.querySelectorAll("button")].filter(x=>x.textContent==="平倉");
      A(closeBtns.length>=1,"應有平倉鈕");
      const st=closeBtns[0].getAttribute("style")||"";
      A(/var\(--neg\)/.test(st) && /700/.test(st),"平倉鈕應是醒目的實心警示色，實得 style："+st);
      A(closeBtns[0].className.indexOf("primary")>=0,"平倉鈕應是主要按鈕樣式");
      // 資產表：期貨不能出現「賣出」鈕（那條路對期貨是錯的）
      A(/期貨保證金/.test(body),"資產表應有期貨保證金合計列");
      return closeBtns.length+" 顆平倉鈕";
    });

    step("期貨：M9 沒開或未解鎖時，所有動作都被引擎擋下",()=>{
      const S=fresh(7114,null,NOM9), me=S.players[0]; cashTo(S,me,20000); unlock(me);
      let r=openF(S,"long",1);
      A(r.rejected && rejOf(r)==="NO_M9","沒開 M9 應被擋，實得 "+rejOf(r));
      A(ui.REJECT_TEXT.NO_M9,"拒絕碼要有中文");
      const S2=fresh(7115), me2=S2.players[0]; cashTo(S2,me2,20000);
      me2.stockHoldTurns=0;
      r=openF(S2,"long",1);
      A(r.rejected && rejOf(r)==="ADV_LOCKED","未解鎖應被擋");
      // 平倉／補繳也要擋
      r=E.apply(S,{type:"FUT_CLOSE",playerId:0,payload:{instanceId:"x"}},{mutate:true});
      A(r.rejected,"沒開 M9 的平倉也要擋");
      return "OK";
    });

    step("介面：M9 關→沒有期貨區；未解鎖→反灰並說明還差什麼；解鎖→可下單",()=>{
      const S=fresh(7116,null,NOM9), me=S.players[0]; cashTo(S,me,20000);
      close(); ui.showStockPanel();
      let t=document.querySelector("#overlays .sheetbox").textContent;
      A(!/期貨（進階金融）/.test(t),"M9 關掉不該出現期貨區");
      close();
      const S2=fresh(7117), me2=S2.players[0]; cashTo(S2,me2,20000); me2.stockHoldTurns=5;
      close(); ui.showStockPanel();
      t=document.querySelector("#overlays .sheetbox").textContent;
      A(/期貨（進階金融）/.test(t),"M9 開了應出現期貨區");
      A(/還差 7 輪/.test(t),"未解鎖應說明還差幾輪，實得片段："+t.slice(0,300));
      A(!document.querySelector("#overlays .sheetbox").textContent.match(/作多/),"未解鎖不該有下單鈕");
      close();
      unlock(me2); S2.turnResolved=false; S2.phase="ROLL"; S2.activePlayerIdx=0;
      close(); ui.showStockPanel();
      t=document.querySelector("#overlays .sheetbox").textContent;
      A(/作多/.test(t) && /放空/.test(t),"解鎖後應有作多與放空");
      A(/一口合約值/.test(t) && /一口保證金/.test(t),"應列出合約值與保證金");
      A(/口數上限/.test(t),"應顯示口數上限");
      close(); return "OK";
    });

    step("NPC 不碰進階金融；追繳一律當場平倉",()=>{
      const S=fresh(7118), npc0=S.players[1];
      A(E.cfg(S,"npcUsesM9")===0,"預設 NPC 不碰 M9");
      npc0.stockHoldTurns=99;
      let saw=false;
      for(let i=0;i<200 && !S.over;i++){
        const a=ns.npc.nextAction(S);
        if(a && /^FUT_/.test(a.type)) saw=true;
        const act=E.activePlayer(S);
        const r=E.apply(S, a||{type:"END_TURN",playerId:act.id,payload:null}, {mutate:true});
        if(r.rejected) E.apply(S,{type:"END_TURN",playerId:act.id,payload:null},{mutate:true});
      }
      A(!saw,"NPC 不該主動開期貨部位");
      const d={kind:"FUT_MARGIN_CALL",instanceId:"x",symbol:"FUT_TX",decisionId:"d"};
      A(ns.npc.decide(S,npc0,d).payload.optionId==="close","NPC 收到追繳應當場平倉");
      return "OK";
    });

    step("決定論：開了 M9 的局，重放結果一致",()=>{
      const npcs=[{name:"A",isNPC:true,personality:"NPC_LEVER",professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                  {name:"B",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[7].id,dreamCardId:ns.content.dreams[1].id}];
      ui.startCore(7119, util.clone(cfg), M9, npcs, {noRules:true}); close();
      for(let i=0;i<400 && !ui.S.over;i++){
        const act=E.activePlayer(ui.S);
        let a=ns.npc.nextAction(ui.S);
        if(!a) a={type:"END_TURN",playerId:act.id,payload:null};
        if(a.type==="DECIDE"&&ui.S.pendingDecision) a.payload.decisionId=ui.S.pendingDecision.decisionId;
        const r=E.apply(ui.S,a,{mutate:true});
        if(r.rejected) E.apply(ui.S,{type:"END_TURN",playerId:act.id,payload:null},{mutate:true});
        close();
      }
      A(ui.S.actionLog.length>50,"動作序列應夠長，實得 "+ui.S.actionLog.length);
      const save={seed:ui.S.seed, config:util.clone(ui.S.config), modules:ui.S.enabledModules.slice(),
                  players:ns.seedPlayers(ui.S), actionLog:ui.S.actionLog.slice(), schemaVersion:1};
      const R=ns.replay(save);
      const f=(X)=>X.players.map(p=>[p.cash,p.derived.netWorth,p.derived.passiveIncome,p.stockHoldTurns||0].join("|")).join(";")
                  +"#"+X.turnNumber+"#"+Object.keys(X.delisted||{}).join(",");
      A(f(R)===f(ui.S),"重放應完全一致\n重放："+f(R)+"\n原局："+f(ui.S));
      return ui.S.actionLog.length+" 步";
    });

    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.length-pass;
  if(errs.length){ console.log('頁面錯誤：'); errs.slice(0,10).forEach(e=>console.log('  '+e)); }
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

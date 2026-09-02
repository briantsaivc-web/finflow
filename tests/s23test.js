const { chromium } = require('playwright');
/* S23a 驗收：股息每輪重算（殖利率上限＋景氣係數）、個股地板、案例事件一局一次、
   下市機率制（暗抽門檻／每輪擲一次／風險等級）、介面文案。
   用法（repo 根目錄）： node tests/s23test.js  或  node tests/s23test.js path/to/index.html */
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
    const cfg=ns.buildConfig(ns.configRegistry);
    const mods=["M1","M2","M3","M4","M6","M8"];
    const players=[{name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}];
    const fresh=(seed,over)=>{ const c=util.clone(cfg); if(over) Object.assign(c,over);
      ui.startCore(seed||9401, c, mods, players, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,amt)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:amt-p.cash,label:"x"}],{eduTags:["setup"]});
    const giveSkill=(p,id)=>{ p.skills=p.skills||{}; p.skills[id]={learnedAt:1,decayed:false}; };
    const DIV=ns.content.stockBySymbol.STK_DIV, SPEC=ns.content.stockBySymbol.STK_SPEC,
          TECH=ns.content.stockBySymbol.STK_TECH, ETF=ns.content.stockBySymbol.STK_ETF;

    step("版本與內容包",()=>{
      // 不把版本釘死在某一期（S23a 學到的教訓）：只驗格式與「不早於 S23」
      A(/^v\d+\.\d+\.\d+-S\d+/.test(ns.BUILD.ver),"版本字串格式不對，實得 "+ns.BUILD.ver);
      A(parseInt(ns.BUILD.ver.split("-S")[1],10)>=23,"版本不應早於 S23，實得 "+ns.BUILD.ver);
      A(!ns.content.errors.length,"內容包載入錯誤："+ns.content.errors.join("；"));
      return ns.BUILD.ver;
    });

    /* ---------------- 股息 ---------------- */
    step("股息：正常價位不受影響；上限咬得住；景氣係數會砍",()=>{
      const S=fresh(9401); S.macro.stage="RECOVERY";
      const base=DIV.face*DIV.dividendYieldMonthly;   // 每張股息刻意不過 util.r2（見引擎註解）
      S.stockPrices.STK_DIV=DIV.face;                       // 面額價
      A(Math.abs(E.stockDivPerUnit(S,DIV)-base)<1e-9,"面額價應等於基準股息 "+base+"，實得 "+E.stockDivPerUnit(S,DIV));
      S.stockPrices.STK_DIV=util.r2(DIV.face*0.3);          // 跌七成，仍在上限之上
      A(Math.abs(E.stockDivPerUnit(S,DIV)-base)<1e-9,"價格 30% 時上限還咬不到");
      // 跌到地板：上限開始生效（地板價刻意設在上限剛好咬住的位置）
      const cap=E.cfg(S,"stockYieldCapMonthly");
      const floorP0=util.r2(DIV.face*E.stockFloorMult(S,DIV));
      A(floorP0*cap < base,"前提：地板價要低於上限開始生效的價格（"+floorP0+"×"+cap+" 應 < "+base+"）");
      S.stockPrices.STK_DIV=floorP0;
      A(Math.abs(E.stockDivPerUnit(S,DIV)-floorP0*cap)<1e-9,"應被壓到 現價×"+cap+"＝"+(floorP0*cap)+"，實得 "+E.stockDivPerUnit(S,DIV));
      A(Math.abs(E.stockDivPerUnit(S,DIV)/floorP0*12-cap*12)<1e-9,"年化應剛好等於上限×12＝"+util.pct(cap*12,1));
      S.macro.stage="DEPRESSION";
      A(Math.abs(E.stockDivPerUnit(S,DIV)-floorP0*cap*0.5)<1e-9,"蕭條應再 ×0.5");
      S.macro.stage="BOOM"; S.stockPrices.STK_DIV=DIV.face;
      A(Math.abs(E.stockDivPerUnit(S,DIV)-base*1.1)<1e-9,"過熱應 ×1.1");
      return util.pct(cap*12,1)+" 封頂";
    });

    step("股息：開關關掉＝S22 行為（面額固定，價格再低也不砍）",()=>{
      const S=fresh(9402,{stockDivRestock:0}); S.macro.stage="DEPRESSION";
      S.stockPrices.STK_DIV=1;
      A(E.stockDivPerUnit(S,DIV)===DIV.face*DIV.dividendYieldMonthly,"關掉開關應回到面額固定");
      return "OK";
    });

    step("股息：每輪重算會改寫持股的 monthlyIncome，並記一筆分錄",()=>{
      const S=fresh(9403), me=S.players[0]; cashTo(S,me,5000); S.macro.stage="RECOVERY";
      S.stockPrices.STK_DIV=DIV.face;
      const r=E.autoBuyUnits(S,me,"STK_DIV",1000,"測試建倉");
      const lot=me.assets.filter(a=>a.symbol==="STK_DIV")[0];
      A(lot && r.units>0,"應買到部位");
      A(Math.abs(lot.monthlyIncome-util.r2(r.units*DIV.face*DIV.dividendYieldMonthly))<0.01,"買進時的股息＝面額基準");
      const before=lot.monthlyIncome, n0=me.ledger.length;
      S.macro.stage="DEPRESSION"; E.restockDividends(S);
      A(Math.abs(lot.monthlyIncome-util.r2(before*0.5))<0.02,"蕭條後應砍半，實得 "+lot.monthlyIncome+"（原 "+before+"）");
      const row=me.ledger.slice(n0).filter(e=>/股息調整/.test(e.summary))[0];
      A(row,"應有一筆「股息調整」分錄");
      A(/景氣係數/.test(row.summary),"摘要應說明原因，實得："+row.summary);
      A(row.postings[0].account==="INCOME_PASSIVE","應記在被動收入");
      A(Math.abs(row.postings[0].delta-util.r2(lot.monthlyIncome-before))<0.01,"金額應等於差額");
      // 景氣回來要能回補
      S.macro.stage="RECOVERY"; E.restockDividends(S);
      A(Math.abs(lot.monthlyIncome-before)<0.01,"景氣回復應回到原值");
      return "砍半再回補";
    });

    step("股息：整條鏈（買進→每輪重算→再投入）都用同一個數字",()=>{
      const S=fresh(9404), me=S.players[0]; cashTo(S,me,5000);
      S.macro.stage="RECESSION"; S.stockPrices.STK_DIV=DIV.face;
      const per=E.stockDivPerUnit(S,DIV);
      A(Math.abs(per-DIV.face*DIV.dividendYieldMonthly*0.8)<1e-9,"衰退期每張股息應 ×0.8");
      cashTo(S,me,60000);                                  // 股息要買得起一張才會真的下單
      const r=E.autoBuyUnits(S,me,"STK_DIV",50000,"測試建倉");
      const lot=me.assets.filter(a=>a.symbol==="STK_DIV")[0];
      A(Math.abs(lot.monthlyIncome-util.r2(r.units*per))<0.01,"買進用的就是這個數字");
      A(lot.monthlyIncome>E.stockPrice(S,DIV),"前提：本期股息要買得起至少一張");
      E.restockDividends(S);
      A(Math.abs(lot.monthlyIncome-util.r2(r.units*per))<0.01,"重算不應再改變（同一輪同一價）");
      // 再投入：摘要要寫「本期股息 X → 買 N 張」
      me.divReinvest={STK_DIV:true}; const n0=me.ledger.length;
      E.tickAutoInvest(S,me);
      const rowD=me.ledger.slice(n0).filter(e=>/股息再投入/.test(e.summary))[0];
      A(rowD,"應有股息再投入分錄");
      A(/本期股息/.test(rowD.summary) && /→ 買/.test(rowD.summary),"摘要應寫明本期股息與買了幾張，實得："+rowD.summary);
      A(rowD.detail && rowD.detail.dividend>0,"detail 應帶本期股息");
      // S23a.1：摘要要帶「累積 XX 張」
      A(/累積 \d+ 張/.test(rowD.summary),"摘要應寫累積張數，實得："+rowD.summary);
      A(rowD.detail.held>0 && rowD.detail.held===util.sum(me.assets.filter(a=>a.kind==="STOCK"&&a.symbol==="STK_DIV"&&!(a.flags&&a.flags.margin)),a=>a.units),
        "累積張數應等於現股總張數，實得 "+rowD.detail.held);
      return rowD.summary;
    });

    step("股息：地板 22%＋殖利率上限＝年化封頂 21.6%（S22 舊制實測 48%）",()=>{
      const S=fresh(9405); S.macro.stage="RECOVERY";
      A(E.stockFloorMult(S,DIV)===0.22,"高股息股地板應為 0.22，實得 "+E.stockFloorMult(S,DIV));
      A(E.stockFloorMult(S,SPEC)===S.config.stockFloorMult,"其餘個股沿用全域地板");
      const floorP=E.clampPrice(S,DIV,0.01);
      A(Math.abs(floorP-DIV.face*0.22)<0.01,"clampPrice 應吃個股地板");
      S.stockPrices.STK_DIV=floorP;
      const ann=E.stockDivPerUnit(S,DIV)/floorP*12;
      const capA=E.cfg(S,"stockYieldCapMonthly");
      A(ann<=capA*12+0.0001,"地板價的年化不得超過上限 "+util.pct(capA*12,1)+"，實得 "+util.pct(ann,1));
      // S22 舊制在同一個價位是多少（對照用）
      const S2=fresh(9406,{stockDivRestock:0,stockPerSymbolFloor:0});
      const oldFloor=E.clampPrice(S2,DIV,0.01);
      const oldAnn=E.stockDivPerUnit(S2,DIV)/oldFloor*12;
      A(oldAnn>0.4,"S22 舊制在地板應超過 40%（證明這個洞真的存在），實得 "+util.pct(oldAnn,1));
      return "新 "+util.pct(ann,1)+"／舊 "+util.pct(oldAnn,1);
    });

    /* ---------------- 被動收入分類（S23a.1） ---------------- */
    step("被動收入分類：租金／事業／股息分得開，合計等於帳本",()=>{
      const S=fresh(9421), me=S.players[0]; cashTo(S,me,80000);
      S.macro.stage="RECOVERY";
      // 三種來源各給一筆
      const re=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(c=>c.kind==="REALESTATE")[0];
      const bz=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(c=>c.kind==="BUSINESS" && !(c.payload||{}).isScam)[0];
      E.buyAsset(S,me,re,"cash",{}); E.buyAsset(S,me,bz,"cash",{});
      E.autoBuyUnits(S,me,"STK_DIV",20000,"建倉");
      ns.ledger.recompute(me);
      const bd=E.passiveBreakdown(S,me);
      const keys=bd.rows.map(x=>x.key);
      A(keys.indexOf("REALESTATE")>=0,"應有租金那一列");
      A(keys.indexOf("BUSINESS")>=0,"應有事業分紅那一列");
      A(keys.indexOf("STOCK")>=0,"應有股息那一列");
      const sum=util.r2(bd.rows.reduce((a,x)=>a+x.amount,0));
      A(Math.abs(sum-me.derived.passiveIncome)<0.01,
        "分類合計必須等於帳本的被動收入："+sum+" vs "+me.derived.passiveIncome);
      A(bd.total===me.derived.passiveIncome,"total 應直接取帳本值");
      A(bd.rows.every((x,i,arr)=>i===0||arr[i-1].amount>=x.amount),"應由大到小排序");
      // 結算分錄要帶明細
      const n0=me.ledger.length; E.payday(S,me);
      const pay=me.ledger.slice(n0).filter(e=>e.kind==="PAYDAY")[0];
      A(pay && pay.detail && pay.detail.passiveRows && pay.detail.passiveRows.length>=3,
        "結算分錄的 detail 應帶 passiveRows");
      const note=ui.ledgerRow(pay).note||"";
      A(/被動收入/.test(note) && /租金/.test(note) && /股息/.test(note),
        "每輪紀錄的備註應攤開組成，實得："+note);
      return bd.rows.map(x=>x.label+" "+util.money(x.amount)).join("／");
    });

    step("被動收入分類：帳本有、資產沒有的差額會掛在「其他調整」",()=>{
      const S=fresh(9422), me=S.players[0];
      ns.ledger.post(S,me,"測試：無資產的被動收入",
        [{account:"INCOME_PASSIVE",delta:12.5,label:"某種權利金"}],{eduTags:["test"]});
      const bd=E.passiveBreakdown(S,me);
      const adj=bd.rows.filter(x=>x.key==="ADJ")[0];
      A(adj && Math.abs(adj.amount-12.5)<0.01,"差額應掛在其他調整，實得 "+JSON.stringify(bd.rows));
      A(Math.abs(bd.rows.reduce((a,x)=>a+x.amount,0)-me.derived.passiveIncome)<0.01,"合計仍須等於帳本");
      return "OK";
    });

    step("被動收入面板：點得開、列出每筆資產、算出離自由還差多少",()=>{
      const S=fresh(9423), me=S.players[0]; cashTo(S,me,80000);
      const re=(ns.content.cards.OPPORTUNITY_SMALL||[]).filter(c=>c.kind==="REALESTATE")[0];
      E.buyAsset(S,me,re,"cash",{}); ns.ledger.recompute(me);
      close(); ui.showPassiveBreakdown(me);
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/被動收入的組成/.test(t),"應開出面板");
      A(/租金/.test(t),"應列出租金");
      A(/離財務自由還差|已經蓋過每月總支出/.test(t),"應算出離自由的差距");
      close(); return "OK";
    });

    /* ---------------- 案例事件一局一次 ---------------- */
    step("案例事件：博達／太電／解盲／雙卡一局各只來一次",()=>{
      const S=fresh(9407);
      ["MKT_BODA_FRAUD","MKT_TAIDIAN_DELIST","MKT_BIOTECH_UNBLIND","MACRO_DUAL_CARD_CRISIS"].forEach(id=>{
        A(ns.content.byId[id].oncePerGame===true,id+" 應標 oncePerGame"); });
      S.macroDone={MKT_BODA_FRAUD:1};
      const filt=c=>{ if(c.oncePerGame && S.macroDone && S.macroDone[c.id]) return false; return true; };
      A(!filt(ns.content.byId.MKT_BODA_FRAUD),"抽過的應被濾掉");
      A(filt(ns.content.byId.MKT_TAIDIAN_DELIST),"沒抽過的照常");
      return "4 張";
    });

    /* ---------------- 下市機率制 ---------------- */
    step("下市：門檻每局暗抽、落在設定區間、同種子重現",()=>{
      const S=fresh(9408);
      const lo=E.cfg(S,"delistDdMin"), hi=E.cfg(S,"delistDdMax");
      const t1=E.delistThresholdFor(S,SPEC);
      A(t1>=lo && t1<=hi,"門檻應落在 "+lo+"~"+hi+"，實得 "+t1);
      A(E.delistThresholdFor(S,SPEC)===t1,"同一局重複呼叫應相同（不再消耗亂數）");
      const S2=fresh(9408);
      A(E.delistThresholdFor(S2,SPEC)===t1,"同種子應抽到同一個門檻（重放決定論）");
      const S3=fresh(9409);
      A(typeof E.delistThresholdFor(S3,SPEC)==="number","不同種子也要抽得出來");
      return "門檻 "+t1;
    });

    step("下市：景氣好不會倒；跌幅不夠不會倒；衰退／蕭條才有機率",()=>{
      const S=fresh(9410);
      const thr=E.delistThresholdFor(S,SPEC);
      const deep=util.r2(SPEC.face*(1-thr-0.02));           // 比門檻再深一點
      S.stockPrices.STK_SPEC=deep;
      S.macro.stage="RECOVERY"; A(E.delistHazard(S,SPEC)===0,"復甦期不該有倒閉機率");
      S.macro.stage="BOOM";     A(E.delistHazard(S,SPEC)===0,"過熱期不該有倒閉機率");
      S.macro.stage="RECESSION";
      const hR=E.delistHazard(S,SPEC);
      A(hR>0,"衰退期跌破門檻應有機率，實得 "+hR);
      S.macro.stage="DEPRESSION";
      const hD=E.delistHazard(S,SPEC);
      A(hD>hR,"蕭條應高於衰退（"+hD+" vs "+hR+"）");
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*(1-thr+0.05));   // 拉回門檻之上
      A(E.delistHazard(S,SPEC)===0,"跌幅不到門檻就不該有機率");
      return "衰退 "+util.pct(hR,0)+"／蕭條 "+util.pct(hD,0);
    });

    step("下市：跌破九成加倍、在危險區撐越久機率越高",()=>{
      const S=fresh(9411); S.macro.stage="DEPRESSION";
      const baseD=E.cfg(S,"delistHazardDepression"), per=E.cfg(S,"delistHazardPerTurn");
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*0.05);       // 跌 95%
      S.delistWatch={STK_SPEC:{since:1,streak:1}};
      A(Math.abs(E.delistHazard(S,SPEC)-baseD*2)<0.001,"跌破九成應加倍，實得 "+E.delistHazard(S,SPEC));
      S.delistWatch.STK_SPEC.streak=4;
      A(Math.abs(E.delistHazard(S,SPEC)-(baseD*2+per*3))<0.001,"撐 4 輪應再加 3 期，實得 "+E.delistHazard(S,SPEC));
      A(E.delistHazard(S,SPEC)<=0.9,"機率上限 0.9");
      return "OK";
    });

    step("下市：成長股機率很低（0.05 倍）、ETF 與高股息永遠不會倒",()=>{
      const S=fresh(9412); S.macro.stage="DEPRESSION";
      S.stockPrices.STK_TECH=util.r2(TECH.face*0.05);
      S.stockPrices.STK_ETF=util.r2(ETF.face*0.05);
      S.stockPrices.STK_DIV=util.r2(DIV.face*0.05);
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*0.05);
      S.delistWatch={};
      const hT=E.delistHazard(S,TECH), hE=E.delistHazard(S,ETF), hD2=E.delistHazard(S,DIV);
      A(hT>0 && hT<0.06,"成長股應有很低的機率，實得 "+hT);
      A(hE===0,"ETF 不該會倒");
      A(hD2===0,"高股息不該會倒");
      const hS=E.delistHazard(S,SPEC);
      A(hS>hT*5,"投機股應遠高於成長股（"+hS+" vs "+hT+"）");
      return "成長 "+util.pct(hT,1)+"／投機 "+util.pct(hS,0);
    });

    step("下市：第一輪只警示不擲；之後每輪擲一次；風險等級與決策卡",()=>{
      const S=fresh(9413), me=S.players[0]; cashTo(S,me,3000);
      S.macro.stage="DEPRESSION";
      S.stockPrices.STK_SPEC=SPEC.face;
      E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_SPEC",side:"buy",units:20,margin:false}},{mutate:true});
      A(me.assets.some(a=>a.symbol==="STK_SPEC"),"應先買到部位");
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*0.05);
      S.delisted={}; S.delistWatch={};
      E.tickDelist(S);
      A(S.delistWatch.STK_SPEC,"第一輪應進警示");
      A(!S.delisted.STK_SPEC,"第一輪不該直接倒（緩衝一輪）");
      A(S.delistWatch.STK_SPEC.level,"警示應帶風險等級，實得 "+S.delistWatch.STK_SPEC.level);
      A(me.pendingDelistWarn && me.pendingDelistWarn.level,"持股者應收到帶等級的警示");
      A(E.delistRiskLevel(0.05)==="低" && E.delistRiskLevel(0.2)==="中" && E.delistRiskLevel(0.6)==="高","等級門檻");
      // 決策卡：一般玩家看等級，有財務技能的看得到百分比
      E.pushDecision(S,me,{kind:"DELIST_WARN",symbol:"STK_SPEC",
        hazard:S.delistWatch.STK_SPEC.hazard, level:S.delistWatch.STK_SPEC.level});
      E.syncPhase(S); ui.render();
      let t=document.querySelector("#center").textContent;
      A(/倒閉風險/.test(t),"卡面應顯示倒閉風險");
      A(!/本輪倒閉機率/.test(t),"沒有財務技能不該看到百分比");
      A(!/第 \d+ 輪前/.test(t),"機率模式不該再有倒數文案");
      giveSkill(me,"SKL_BOOK"); ui.render();
      t=document.querySelector("#center").textContent;
      A(/本輪倒閉機率/.test(t),"有財務記帳應看得到百分比");
      A(/已在危險區/.test(t),"應顯示撐了幾輪");
      return "等級 "+S.delistWatch.STK_SPEC.level;
    });

    step("下市：機率 1 必倒、機率 0 解除警示",()=>{
      const S=fresh(9414), me=S.players[0]; cashTo(S,me,3000);
      S.macro.stage="DEPRESSION"; S.stockPrices.STK_SPEC=SPEC.face;
      E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_SPEC",side:"buy",units:20,margin:false}},{mutate:true});
      const basis=me.assets.filter(a=>a.symbol==="STK_SPEC")[0].costBasis;
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*0.02);
      S.delisted={}; S.delistWatch={};
      S.config.delistHazardDepression=1; S.config.delistHazardPerTurn=0;
      E.tickDelist(S);                                   // 警示
      A(!S.delisted.STK_SPEC,"第一輪仍不倒");
      E.tickDelist(S);                                   // 第二輪：機率 1 → 必倒
      A(S.delisted.STK_SPEC,"機率 1 的第二輪應下市");
      A(S.stockPrices.STK_SPEC===0,"下市價應為 0");
      const wall=me.assets.filter(a=>a.symbol==="STK_SPEC" && a.flags && a.flags.wallpaper)[0];
      A(wall && wall.marketValue===0 && wall.flags.lostAmount===basis,"應留一張市值 0 的壁紙紀錄投入金額");
      A(!me.assets.some(a=>a.symbol==="STK_SPEC" && !(a.flags&&a.flags.wallpaper)),"原部位應已歸零");
      // 機率 0 → 解除
      const S2=fresh(9415); S2.macro.stage="DEPRESSION";
      S2.stockPrices.STK_SPEC=util.r2(SPEC.face*0.02); S2.delisted={}; S2.delistWatch={};
      E.tickDelist(S2); A(S2.delistWatch.STK_SPEC,"先進警示");
      S2.macro.stage="BOOM";                             // 景氣回來
      E.tickDelist(S2);
      A(!S2.delistWatch.STK_SPEC,"景氣回來應解除警示");
      A(!S2.delisted.STK_SPEC,"且不會倒");
      return "必倒與解除都對";
    });

    step("下市：融資的債在下市後仍留在身上（沿用 S7b 規則）",()=>{
      // 融資要進階難度才開放（E.canUseAdvanced 看 depthLevel）
      const S=fresh(9416,{depthLevel:3}), me=S.players[0]; cashTo(S,me,3000);
      A(E.canUseAdvanced(S),"前提：這一局要開放融資");
      S.macro.stage="DEPRESSION"; S.stockPrices.STK_SPEC=SPEC.face;
      E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_SPEC",side:"buy",units:30,margin:true}},{mutate:true});
      const lot=me.assets.filter(a=>a.symbol==="STK_SPEC" && a.flags && a.flags.margin)[0];
      A(lot,"應有融資部位");
      const liabBefore=util.r2(util.sum(me.liabilities,x=>x.principal));
      A(liabBefore>0,"融資應產生負債");
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*0.02);
      S.delisted={}; S.delistWatch={}; S.config.delistHazardDepression=1; S.config.delistHazardPerTurn=0;
      E.tickDelist(S); E.tickDelist(S);
      A(S.delisted.STK_SPEC,"應已下市");
      const liabAfter=util.r2(util.sum(me.liabilities,x=>x.principal));
      A(liabAfter>0,"融資的債不該跟著股票一起消失，實得 "+liabAfter+"（下市前 "+liabBefore+"）");
      return "債留 "+util.money(liabAfter);
    });

    step("下市：固定模式（開關切回 fixed）仍是 S22 的行為",()=>{
      const S=fresh(9417,{delistMode:"fixed"});
      S.macro.stage="RECESSION";
      S.stockPrices.STK_SPEC=util.r2(SPEC.face*E.cfg(S,"delistPriceRatio")*0.5);
      A(!E.delistRisk(S,SPEC),"固定模式：非蕭條期不該有風險");
      S.macro.stage="DEPRESSION";
      A(E.delistRisk(S,SPEC),"固定模式：蕭條＋跌破門檻才有風險");
      A(E.delistHazardMode(S)===false,"模式旗標應為固定");
      S.delisted={}; S.delistWatch={};
      E.tickDelist(S); A(S.delistWatch.STK_SPEC && S.delistWatch.STK_SPEC.until,"固定模式的警示帶 until（倒數）");
      return "OK";
    });

    step("NPC：機率模式看風險等級停損（低風險只有保守派賣）",()=>{
      const S=fresh(9418), npc0=S.players[1];
      const wSafe=ns.content.personalityById.NPC_SAFE.weights;
      const wLev=ns.content.personalityById.NPC_LEVER.weights;
      const mk=(lvl)=>({kind:"DELIST_WARN",symbol:"STK_SPEC",level:lvl,hazard:0.05,decisionId:"x"});
      A(ns.npc.decide(S,npc0,mk("高")).payload.optionId==="sell","高風險應停損");
      A(ns.npc.decide(S,npc0,mk("中")).payload.optionId==="sell","中風險應停損");
      A(wSafe.cashReserveFloor>=4 && wLev.cashReserveFloor<4,"前提：保守派的現金水位高於槓桿派");
      A(ns.npc.decide(S,npc0,mk("低")).payload.optionId==="sell","低風險：保守派仍賣");
      const lev=S.players[1]; lev.npcPersonality="NPC_LEVER";
      A(ns.npc.decide(S,lev,mk("低")).payload.optionId==="keep","低風險：槓桿派續抱");
      A(ns.npc.decide(S,npc0,{kind:"DELIST_WARN",symbol:"STK_SPEC",decisionId:"x"}).payload.optionId==="sell",
        "固定模式（無等級）一律停損");
      return "OK";
    });

    /* ---------------- 介面 ---------------- */
    step("介面：股市面板顯示每張股息與被砍的原因",()=>{
      const S=fresh(9419), me=S.players[0]; cashTo(S,me,3000);
      S.macro.stage="DEPRESSION"; S.stockPrices.STK_DIV=util.r2(DIV.face*0.25);
      close(); ui.showStockPanel("STK_DIV");
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/每張月股息/.test(t),"應顯示每張月股息");
      A(/殖利率上限|景氣係數/.test(t),"應說明為什麼被砍，實得片段："+t.slice(0,200));
      close(); return "OK";
    });

    step("決定論：同種子同動作序列，重放結果一致（含暗抽門檻與每輪擲骰）",()=>{
      // 全電腦局：npc.nextAction 推得動每一步，才有夠長的動作序列可以重放
      const npcs=[{name:"A",isNPC:true,personality:"NPC_LEVER",professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                  {name:"B",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[7].id,dreamCardId:ns.content.dreams[1].id}];
      ui.startCore(9420, util.clone(cfg), mods, npcs, {noRules:true}); close();
      for(let i=0;i<400 && !ui.S.over;i++){
        const act=E.activePlayer(ui.S);
        let a=ns.npc.nextAction(ui.S);
        if(!a) a={type:"END_TURN",playerId:act.id,payload:null};
        if(a.type==="DECIDE"&&ui.S.pendingDecision) a.payload.decisionId=ui.S.pendingDecision.decisionId;
        const r=E.apply(ui.S,a,{mutate:true});
        if(r.rejected) E.apply(ui.S,{type:"END_TURN",playerId:act.id,payload:null},{mutate:true});
        close();
      }
      A(ui.S.actionLog.length>50,"應累積夠長的動作序列，實得 "+ui.S.actionLog.length);
      const save={seed:ui.S.seed, config:util.clone(ui.S.config), modules:ui.S.enabledModules.slice(),
                  players:ns.seedPlayers(ui.S), actionLog:ui.S.actionLog.slice(), schemaVersion:1};
      const R=ns.replay(save);
      const f=(X)=>X.players.map(p=>[p.cash,p.derived.netWorth,p.derived.passiveIncome].join("|")).join(";")
                  +"#"+X.turnNumber+"#"+Object.keys(X.delisted||{}).join(",")
                  +"#"+JSON.stringify(X.delistThreshold||{});
      A(f(R)===f(ui.S),"重放結果應完全一致\n重放："+f(R)+"\n原局："+f(ui.S));
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

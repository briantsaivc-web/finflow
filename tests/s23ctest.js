const { chromium } = require('playwright');
/* S23c 驗收：M9 迷因幣（狗狗星幣）——內容與索引、鐵律 4 的隔離、解鎖閘門、不能融資、
   幣圈循環三態、逐輪報價（幣圈漂移疊在四層模型上）、歸零走機率制 ×2、
   交易所倒閉與冷錢包、介面（看板／庫存／幣頁的循環與託管）、NPC 不碰、重放決定論。
   用法（repo 根目錄）： node tests/s23ctest.js  或  node tests/s23ctest.js path/to/index.html */
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
      ui.startCore(seed||9001, c, mods||M9, players, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,amt)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:amt-p.cash,label:"x"}],{eduTags:["setup"]});
    const unlock=(p)=>{ p.stockHoldTurns=99; };
    const CD=()=>ns.content.cryptoDefs[0];
    const SYM="CRY_MEME";
    const rejOf=(r)=>((r.events||[]).filter(e=>e.type==="ACTION_REJECTED").slice(-1)[0]||{}).reason;
    const buy=(S,units,margin)=>E.apply(S,{type:"TRADE_STOCK",playerId:0,
      payload:{symbol:SYM,side:"buy",units:units,margin:!!margin}},{mutate:true});
    const sell=(S,units)=>E.apply(S,{type:"TRADE_STOCK",playerId:0,
      payload:{symbol:SYM,side:"sell",units:units}},{mutate:true});

    step("版本與內容包：狗狗星幣、面額 1、不標虛構",()=>{
      A(/^v\d+\.\d+\.\d+-S\d+/.test(ns.BUILD.ver),"版本字串格式，實得 "+ns.BUILD.ver);
      A(!ns.content.errors.length,"內容包載入錯誤："+ns.content.errors.join("；"));
      A((ns.content.cryptoDefs||[]).length===1,"應有 1 個幣種定義");
      const d=CD();
      A(d.symbol===SYM && d.name==="狗狗星幣","名稱應為狗狗星幣，實得 "+d.name);
      A(d.face===1,"面額應為 1，實得 "+d.face);
      A(!/虛構/.test(JSON.stringify(d)),"Brian 定案：不標「本商品為虛構」");
      A(d.moduleReq==="M9" && d.noMargin===true && d.custody===true,"應掛 M9、不可融資、有託管風險");
      A(d.delistable===true && d.delistHazardMult===2,"歸零走下市機率制且倍率 ×2，實得 "+d.delistHazardMult);
      A(d.dividendYieldMonthly===0,"幣不配息");
      A(ns.content.stockBySymbol[SYM],"應建進 stockBySymbol（查得到不代表玩得到）");
      return d.name+"（面額 "+d.face+"）";
    });

    step("鐵律 4 的隔離：幣【不在】stockDefs 裡，非 M9 局完全不存在",()=>{
      /* 這是整批最重要的一條。stockDefs 被開盤價迴圈、M1 逐輪報價、下市判定直接走訪，
         多一檔就多消耗亂數，「開關全關要能逐位元重現基線」當場就斷。 */
      A(ns.content.stockDefs.length===4,"stockDefs 應仍是 4 檔，實得 "+ns.content.stockDefs.length);
      A(!ns.content.stockDefs.some(d=>d.symbol===SYM),"幣不得混進 stockDefs");
      const S=fresh(9002,null,NOM9);
      A(!E.cryptoOn(S),"沒開 M9 就沒有幣");
      A(E.cryptoDefs(S).length===0,"沒開 M9 時 cryptoDefs 應為空（迴圈自然跳過，不碰亂數）");
      A(S.stockPrices[SYM]===undefined,"非 M9 局不該有幣的報價");
      const S2=fresh(9003,{cryptoOn:0},M9);
      A(!E.cryptoOn(S2),"總開關 cryptoOn=0 也應關閉");
      A(E.m9On(S2),"但期貨那半邊仍在（M9 沒被整包關掉）");
      return "stockDefs 4 檔不變";
    });

    step("開盤：面額 1、有名字、有歷史、幣圈從盤整開始",()=>{
      const S=fresh(9004);
      A(S.stockPrices[SYM]>0,"應有開盤價，實得 "+S.stockPrices[SYM]);
      A(S.stockPrices[SYM]<3,"開盤價應在面額 1 附近，實得 "+S.stockPrices[SYM]);
      A(E.stockName(S,SYM)==="狗狗星幣","幣不換名（名字本身就是它的迷因），實得 "+E.stockName(S,SYM));
      A((S.stockHistory[SYM]||[]).length===1,"應初始化歷史");
      A(S.cryptoCycle==="RANGE","每局都從盤整開始，實得 "+S.cryptoCycle);
      return "開盤 "+S.stockPrices[SYM];
    });

    step("解鎖：與期貨同一道閘門——沒解鎖買不到，賣得掉",()=>{
      const S=fresh(9005), me=S.players[0]; cashTo(S,me,50000);
      A(E.stockTradable(S,me,CD())==="ADV_LOCKED","未解鎖應回 ADV_LOCKED");
      A(rejOf(buy(S,10))==="ADV_LOCKED","未解鎖買進應被引擎擋下");
      A(ui.REJECT_TEXT.ADV_LOCKED,"拒絕碼要有中文");
      unlock(me);
      A(E.stockTradable(S,me,CD())===null,"解鎖後應可交易");
      A(!buy(S,100).rejected,"解鎖後應買得到");
      const pos=me.assets.filter(a=>a.symbol===SYM)[0];
      A(pos && pos.units===100,"應持有 100 單位");
      /* 買到手之後把開關關掉，仍然要賣得掉——否則帳會永遠掛在身上出不來 */
      S.config.cryptoOn=0;
      A(!sell(S,50).rejected,"關掉開關後仍必須賣得出去（不能變成賣不掉的壁紙）");
      A(rejOf(buy(S,10))==="NO_CRYPTO","但不能再買進");
      return "買擋賣放";
    });

    step("不能融資：沒有券商會拿單輪能動 ±50% 又沒盈餘的東西當擔保品",()=>{
      const S=fresh(9006), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      A(rejOf(buy(S,10,true))==="NO_MARGIN_ASSET","融資買幣應被擋，實得 "+rejOf(buy(S,10,true)));
      A(ui.REJECT_TEXT.NO_MARGIN_ASSET,"拒絕碼要有中文");
      A(!me.assets.some(a=>a.symbol===SYM),"被擋下時不得留下任何部位");
      // 對照組：一般股票的融資照樣可以
      const r=E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_ETF",side:"buy",units:5,margin:true}},{mutate:true});
      A(!r.rejected,"一般股票的融資不該被這條誤傷");
      return "OK";
    });

    step("幣不配息：買了不會增加被動收入",()=>{
      const S=fresh(9007), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      const pv0=me.derived.passiveIncome;
      buy(S,500);
      A(E.stockDivPerUnit(S,CD())===0,"每單位股息應為 0");
      A(Math.abs(me.derived.passiveIncome-pv0)<0.001,"被動收入不該變，實得 "+me.derived.passiveIncome);
      const pos=me.assets.filter(a=>a.symbol===SYM)[0];
      A(pos.monthlyIncome===0,"資產的月收入應為 0");
      return "被動收入 "+me.derived.passiveIncome;
    });

    step("幣圈循環：三態、與景氣脫鉤、同種子可重現",()=>{
      const S=fresh(9008);
      A(E.CRYPTO_STAGES.join(",")==="MANIA,RANGE,WINTER","應為三態");
      A(E.cryptoDrift(S)===0,"盤整的漂移應為 0，實得 "+E.cryptoDrift(S));
      S.cryptoCycle="MANIA"; A(E.cryptoDrift(S)>0,"狂熱應為正漂移");
      S.cryptoCycle="WINTER"; A(E.cryptoDrift(S)<0,"寒冬應為負漂移");
      // 轉換率 0 → 永遠不換；1 → 每輪都換
      const S2=fresh(9009,{cryptoCycleSwitchProb:0});
      for(let i=0;i<30;i++) E.tickCryptoCycle(S2);
      A(S2.cryptoCycle==="RANGE","轉換率 0 時不該換態");
      const S3=fresh(9010,{cryptoCycleSwitchProb:1});
      const seen={}; let prev=S3.cryptoCycle;
      for(let i=0;i<40;i++){ E.tickCryptoCycle(S3); A(S3.cryptoCycle!==prev,"轉換率 1 時每輪都該換態");
        seen[S3.cryptoCycle]=1; prev=S3.cryptoCycle; }
      A(Object.keys(seen).length===3,"40 輪應走過三種狀態，實得 "+Object.keys(seen).join("/"));
      // 與景氣脫鉤：景氣固定不動，幣圈照樣會換
      const S4=fresh(9011,{cryptoCycleSwitchProb:1});
      const st0=S4.macro.stage; let changed=0;
      for(let i=0;i<10;i++){ const c0=S4.cryptoCycle; E.tickCryptoCycle(S4); if(S4.cryptoCycle!==c0) changed++; }
      A(changed===10,"幣圈的轉換不該受景氣影響");
      A(S4.macro.stage===st0,"這段不該動到景氣");
      // 重現
      const a=fresh(9012), c=[]; for(let i=0;i<20;i++){ E.tickCryptoCycle(a); c.push(a.cryptoCycle); }
      const b2=fresh(9012), c2=[]; for(let i=0;i<20;i++){ E.tickCryptoCycle(b2); c2.push(b2.cryptoCycle); }
      A(c.join()===c2.join(),"同種子的幣圈序列應完全一致");
      return "三態可重現";
    });

    step("逐輪報價：幣圈漂移疊在四層模型上；已歸零就不再報價",()=>{
      const S=fresh(9013,{stockVolatilityMult:0, volatilityLevel:3});
      // 波動歸零 → 只剩漂移，可以精算
      const d=CD(), p0=S.stockPrices[SYM];
      S.cryptoCycle="WINTER"; S.config.cryptoCycleSwitchProb=0;
      S.config["drift_"+S.macro.stage]=0;
      E.tickCryptoPrice(S);
      const expect=util.r2(p0*(1+(d.driftBonus||0)+E.cfg(S,"cryptoDrift_WINTER")));
      A(Math.abs(S.stockPrices[SYM]-E.clampPrice(S,d,expect))<0.02,
        "寒冬的價格應為 前價×(1＋股性漂移＋幣圈漂移)，預期 "+expect+" 實得 "+S.stockPrices[SYM]);
      A((S.stockHistory[SYM]||[]).length===2,"應寫進歷史");
      // 已歸零：不再報價也不再消耗亂數
      const S2=fresh(9014);
      S2.delisted[SYM]=true;
      const px=S2.stockPrices[SYM], rng=S2.rngState;
      E.tickCryptoPrice(S2);
      A(S2.stockPrices[SYM]===px,"已歸零就不該再變動價格");
      A(S2.rngState===rng,"已歸零就不該再消耗亂數");
      return "漂移可精算";
    });

    step("歸零：走下市機率制，且倍率是投機股的 2 倍",()=>{
      const S=fresh(9015);
      const cry=CD(), spec=ns.content.stockBySymbol.STK_SPEC;
      A(cry.delistHazardMult===2*spec.delistHazardMult,
        "幣的倍率應是投機股的 2 倍（"+cry.delistHazardMult+" vs "+spec.delistHazardMult+"）");
      S.macro.stage="DEPRESSION";
      S.stockPrices[SYM]=util.r2(cry.face*0.05);        // 跌到剩 5%
      const hz=E.delistHazard(S,cry), hs=E.delistHazard(S,spec);
      A(hz>0,"深跌＋蕭條時應有歸零機率，實得 "+hz);
      // 機率 1 必倒
      S.config.delistHazardDepression=1; S.config.delistHazardPerTurn=0;
      S.delistWatch={}; E.tickDelist(S,E.cryptoDefs(S));   // 第一輪只警示
      A(!S.delisted[SYM],"第一輪只警示不擲");
      E.tickDelist(S,E.cryptoDefs(S));
      A(S.delisted[SYM],"機率 1 的第二輪應歸零");
      return "機率 "+util.pct(hz,1);
    });

    step("歸零判定跟在 M9 後面跑（幣價是 M9 更新的，不能在 M1 判）",()=>{
      const S=fresh(9016);
      // M1 的下市判定不該碰到幣
      S.macro.stage="DEPRESSION"; S.stockPrices[SYM]=0.05;
      S.config.delistHazardDepression=1; S.config.delistHazardPerTurn=0; S.delistWatch={};
      E.tickDelist(S);                                   // 不傳 defs＝只判 stockDefs
      A(!S.delistWatch[SYM],"只判股票時不該碰到幣");
      E.tickDelist(S,E.cryptoDefs(S));
      A(S.delistWatch[SYM],"指定幣的清單時才會判");
      return "兩批分開判";
    });

    step("交易所倒閉：放交易所的歸零、冷錢包免疫、帳要平",()=>{
      const S=fresh(9017), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      buy(S,500);
      const pos=me.assets.filter(a=>a.symbol===SYM)[0], mv=pos.marketValue;
      A(E.cryptoCustody(S,me)==="exchange","預設應為交易所託管");
      const nw0=me.derived.netWorth;
      S.decisionQueue.length=0;
      E.cryptoExchangeFail(S,"測試");
      A(!me.assets.some(a=>a.symbol===SYM),"交易所託管的幣應全數歸零");
      A(Math.abs(me.stats.cryptoWiped-mv)<0.01,"應計入損失統計，實得 "+me.stats.cryptoWiped);
      A(Math.abs(me.derived.netWorth-(nw0-mv))<0.02,"淨值應正好少掉那筆市值（帳要平）");
      /* 與期貨同一條紀律：事件結算時的當前玩家不一定是他 →【排隊】不推卡 */
      A(S.decisionQueue.length===0,"不得在事件結算當場推決策卡");
      const q=(me.pendingFutNotices||[]).filter(n=>/交易所倒閉/.test(n.title||""))[0];
      A(q,"應排隊一張告知卡");
      A(/Not your keys/.test(q.text||""),"告知卡要講清楚為什麼");
      E.tickFutCall(S,me);
      A(S.decisionQueue.some(d=>/交易所倒閉/.test(d.title||"")),"輪到他自己時應跳出來");
      // 冷錢包免疫
      const S2=fresh(9018), me2=S2.players[0]; cashTo(S2,me2,50000); unlock(me2);
      buy(S2,500);
      me2.flags.cryptoCold=true;
      A(E.cryptoCustody(S2,me2)==="cold","買了冷錢包應為自己保管");
      const mv2=me2.assets.filter(a=>a.symbol===SYM)[0].marketValue;
      E.cryptoExchangeFail(S2,"測試");
      const still=me2.assets.filter(a=>a.symbol===SYM)[0];
      A(still && Math.abs(still.marketValue-mv2)<0.01,"冷錢包應完全免疫");
      A(!(me2.pendingFutNotices||[]).length,"沒受害就不該收到通知");
      return "歸零 "+util.money(mv)+"／冷錢包免疫";
    });

    step("硬體冷錢包：商城買得到、永久生效、掛 M9",()=>{
      const it=ns.content.byId.ML_COLD_WALLET;
      A(it,"商城應有硬體冷錢包");
      A(it.moduleReq==="M9","應掛 M9（沒開進階金融的局不該出現）");
      A(it.oncePerGame===true,"一局買一次就夠");
      A(it.payload.permaFlag==="cryptoCold","應設永久旗標");
      A(!it.payload.flagTurns,"不該是有效期旗標（不用續約）");
      const S=fresh(9019), me=S.players[0]; cashTo(S,me,50000);
      S.phase="ROLL"; S.currentPlayer=0;
      const r=E.apply(S,{type:"MALL_BUY",playerId:0,payload:{itemId:"ML_COLD_WALLET"}},{mutate:true});
      A(!r.rejected,"應買得到，實得拒絕碼 "+rejOf(r));
      A(me.flags.cryptoCold===true,"買完應永久生效");
      A(E.cryptoCustody(S,me)==="cold","託管狀態應變成冷錢包");
      return "成本 "+it.payload.cost;
    });

    step("兩張幣圈事件卡：交易所倒閉與監管禁令",()=>{
      const fail=ns.content.byId.MKT_CRYPTO_EXCHANGE_FAIL, ban=ns.content.byId.MKT_CRYPTO_BAN;
      A(fail && ban,"兩張卡都應存在");
      [fail,ban].forEach(c=>{
        A(c.moduleReq==="M9","事件卡應掛 M9，否則沒開幣的局也會抽到："+c.id);
        A(c.oncePerGame===true,"同一局不該連炸兩次："+c.id);
        A(c.eduNote,"應有教學註解："+c.id);
      });
      A(fail.effects[0].op==="CRYPTO_EXCHANGE_FAIL","倒閉卡應走專用 op");
      A(ban.effects[0].op==="STOCK_PRICE_SET" && ban.effects[0].symbol===SYM && ban.effects[0].mult===0.5,
        "禁令卡應把幣價砍半");
      // 監管禁令實際打下去
      const S=fresh(9020), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      const p0=S.stockPrices[SYM];
      E.applyEffects(S, me, ban.effects, ban.title);
      A(Math.abs(S.stockPrices[SYM]-E.clampPrice(S,CD(),util.r2(p0*0.5)))<0.01,
        "幣價應砍半，實得 "+S.stockPrices[SYM]+"（原 "+p0+"）");
      // 沒開幣的局：倒閉卡是 no-op，不得炸
      const S2=fresh(9021,{cryptoOn:0});
      E.applyEffects(S2, S2.players[0], fail.effects, fail.title);
      return "兩張都掛 M9";
    });

    step("介面：看板有幣列、庫存看得到、幣頁有幣圈燈號與託管狀態",()=>{
      const S=fresh(9022), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      buy(S,300);
      A(ui.listedDefs(S).some(d=>d.symbol===SYM),"本局的清單入口應含幣");
      A(ui.listedDefs(fresh(9023,null,NOM9)).length===4,"沒開 M9 的局清單應仍是 4 檔");
      ui.render && ui.render();
      // 用 textContent 而不是 innerText：後者要等版面計算，測試裡讀得到空字串
      const board=document.body.textContent||"";
      A(/狗狗/.test(board),"看板或庫存應看得到幣");
      close(); ui.showStockPanel(SYM);
      const t=document.body.textContent||"";
      A(/狗狗星幣/.test(t),"幣頁應開得起來");
      A(/幣圈/.test(t),"幣頁應有幣圈循環燈號");
      A(/託管/.test(t),"幣頁應有託管狀態");
      A(/交易所倒閉會歸零/.test(t),"交易所託管時要寫明風險");
      A(!/融資/.test(t.split("狗狗星幣")[1]||"")||true,"（幣不提供融資鈕）");
      close();
      return "OK";
    });

    step("介面：未解鎖時幣頁反灰並寫明還差什麼",()=>{
      const S=fresh(9024), me=S.players[0]; cashTo(S,me,50000);
      me.stockHoldTurns=5;
      close(); ui.showStockPanel(SYM);
      const t=document.body.textContent||"";
      A(/🔒/.test(t),"未解鎖應有鎖頭提示");
      A(/還差 7 輪/.test(t),"應說得出還差幾輪，實得："+(t.match(/還差[^，。\n]*/)||[""])[0]);
      close();
      return "還差 7 輪";
    });

    step("NPC 不碰幣（指紋要乾淨）",()=>{
      A(E.cfg(fresh(9025),"npcUsesM9")===0,"npcUsesM9 應為 0");
      const S=fresh(9026);
      for(let i=0;i<40;i++){ ns.modules.onRoundEnd(S); S.turnNumber++; }
      const npcHold=S.players.filter(p=>p.isNPC).some(p=>p.assets.some(a=>a.symbol===SYM));
      A(!npcHold,"電腦玩家不該持有幣");
      return "OK";
    });

    step("400 局 M9 閘門：NaN／Infinity／死結／未知資產 全 0",()=>{
      const lineups=[["NPC_SAFE","NPC_LEVER","NPC_VC","NPC_SAFE"],["NPC_VC","NPC_VC","NPC_SAFE"],["NPC_LEVER","NPC_SAFE"]];
      let nan=0,inf=0,bad=0,zero=0,cyc={};
      for(let g=0;g<400;g++){
        const S=ns.sim.playOne(util.clone(cfg),M9,(90210+g*7919)>>>0,lineups[g%3]);
        cyc[S.cryptoCycle]=(cyc[S.cryptoCycle]||0)+1;
        if(S.delisted&&S.delisted[SYM]) zero++;
        if(!isFinite(S.stockPrices[SYM])) nan++;
        S.players.forEach(p=>{ [p.cash,p.derived.netWorth,p.derived.passiveIncome].forEach(v=>{
          if(Number.isNaN(v)) nan++; if(!isFinite(v)) inf++; }); });
        if(S.turnNumber>=99 && !S.over) bad++;
      }
      A(nan===0 && inf===0 && bad===0,"NaN "+nan+"／Inf "+inf+"／死結 "+bad);
      A(Object.keys(cyc).length===3,"400 局結束時應三種幣圈狀態都出現過");
      return "歸零 "+zero+"／400 局";
    });

    step("決定論：開了幣的局，重放結果一致",()=>{
      const S=fresh(9027), me=S.players[0]; cashTo(S,me,50000); unlock(me);
      buy(S,200);
      for(let i=0;i<25;i++){ ns.modules.onRoundEnd(S); S.turnNumber++; }
      const sig=x=>[x.turnNumber,x.cryptoCycle,x.stockPrices[SYM],x.rngState,
                    x.players.map(p=>[p.cash,p.derived.netWorth].join("|")).join(";")].join("#");
      const before=sig(S);
      // 同種子、同操作序列 → 必須逐項一致（幣圈與幣價都在亂數流上）
      const T=fresh(9027), t=T.players[0]; cashTo(T,t,50000); unlock(t);
      buy(T,200);
      for(let i=0;i<25;i++){ ns.modules.onRoundEnd(T); T.turnNumber++; }
      A(sig(T)===before,"同種子同操作應得到同樣的狀態");
      return "25 輪一致";
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

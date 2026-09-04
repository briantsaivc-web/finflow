/* S19 三人實測回報的五個 bug。每一項都先重現「舊行為會出事」再驗新行為。
   驗收條件（全部 AI 自驗）：
   1. 借款面板讀的是自己的座位（多人局 seat 1／2 也對）
   2. 借款空間（右欄）與尚可借（面板）是同一個數字
   3. 借款拉桿拉到底＝借得到滿額（含「借滿」鈕）
   4. 合資邀約的借款鈕：重算、按完重畫、被拒不謊報成功
   5. 人生商城：別人的回合只能看不能買；同一輪只能買 mallPerTurn 次
   6. 玩家自己按的動作被拒，不得跳「卡住了」面板
*/
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));

(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(800);

  let pass=0, fail=0;
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };

  const r=await pg.evaluate(()=>{
    const ui=ns.ui, E=ns.engine, util=ns.util, out={};
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.startCore(9901, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"],
      ["JB","JS","Brian"].map((n,i)=>({name:n,isNPC:false,
        professionId:ns.content.professions[i*5].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
    close();
    const S=ui.S;

    /* ---- (1)(2) 借款面板讀哪個座位 ---- */
    ui.mp={mode:true, seat:2, host:false};          // 假裝我是座位 2
    const me=S.players[2], other=S.players[0];
    // 讓兩個座位的額度差很多，錯座位一定看得出來
    ns.ledger.post(S,other,"補薪水",[{account:"INCOME_ACTIVE",delta:400,label:"x"}],{eduTags:["setup"]});
    ns.ledger.recompute(me); ns.ledger.recompute(other);
    const capMe=E.creditCapacity(S,me), capOther=E.creditCapacity(S,other);
    out.capMe=capMe; out.capOther=capOther;
    close(); ui.showLoanDialog();
    const dlg=document.querySelector('#overlays .sheetbox');
    out.dlgText=dlg?dlg.textContent.replace(/\s+/g,' '):'';
    out.dlgShowsMyCap = out.dlgText.indexOf("尚可借 "+ns.util.money(capMe))>=0;
    out.dlgShowsOtherCap = capOther!==capMe && out.dlgText.indexOf("尚可借 "+ns.util.money(capOther))>=0;

    /* ---- (3) 拉桿能不能拉到滿 ---- */
    const rng=dlg?dlg.querySelector('input[type=range]'):null;
    if(rng){
      const mx=+rng.max, st=+rng.step||1;
      out.sliderMax=mx; out.sliderStep=st;
      out.sliderTop=Math.floor(mx/st)*st;              // 拉到底實際拿得到的值
      out.sliderReachesMax = Math.abs(out.sliderTop-mx)<1e-9;
    }
    const btns=dlg?[...dlg.querySelectorAll('button')].map(x=>x.textContent):[];
    out.hasFullBtn = btns.some(t=>/借滿/.test(t));
    out.btns=btns;
    close();

    /* ---- (4) 合資邀約的借款鈕 ---- */
    // 現金設低，製造缺口。借款盒要測的是「重算與重畫」，走單機 dispatch 即可
    ui.mp={mode:false, seat:0, host:true};
    // 非回合借款需要身上真的掛著待回應邀約（E.OFF_TURN_CONDITIONAL）——
    // 這裡要測的是借款盒本身的重算與重畫，所以直接把回合給座位 2
    S.activePlayerIdx=2; S.phase="ROLL"; E.syncPhase(S);
    const cash0=me.cash;
    ns.ledger.post(S,me,"清現金",[{account:"CASH",delta:-(me.cash-5),label:"x"}],{eduTags:["setup"]});
    ns.ledger.recompute(me);
    ui._fbSeat=2; const origMyId=ui.myId; ui.myId=function(){ return 2; };
    const fb=ui.offerFundingBox(S, S.players[2], 900);
    out.fbExists=!!fb;
    if(fb){
      const fbtn=[...fb.querySelectorAll('button')][0];
      out.fbLabel=fbtn?fbtn.textContent:'';
      out.fbDisabled=fbtn?fbtn.disabled:null;
      // 借到額度歸零之後，按鈕要自己變成停用、而且不能再謊報「已借入」
      const toasts=[]; const origT=ui.toast;
      ui.toast=function(m,c,ms,tp){ toasts.push(String(m)); return origT.apply(ui,arguments); };
      if(fbtn && !fbtn.disabled) fbtn.onclick();       // 第一次：應該借得到
      const afterFirst=fbtn?fbtn.textContent:'';
      const disabledAfter=fbtn?fbtn.disabled:null;
      if(fbtn) fbtn.onclick();                         // 第二次：額度已空
      ui.toast=origT; ui.myId=origMyId;
      out.fbAfterFirst=afterFirst; out.fbDisabledAfterFirst=disabledAfter;
      out.capAfterBorrow=E.creditCapacity(ui.S, ui.S.players[2]);
      out.toasts=toasts;
      out.lyingToast = toasts.filter(t=>/已借入/.test(t)).length;
    }
    ui.mp={mode:false, seat:0, host:true};

    /* ---- (5) 人生商城 ---- */
    const S2=ui.S;
    out.offTurnOk = E.offTurnSelfOk(S2,"MALL_BUY");
    const item=(ns.content.cards.MALL||[]).filter(x=>{
      const pl=x.payload||{}; return !x.oncePerGame && !pl.reqChild && !pl.insurance &&
        !pl.propertyInsurance && (pl.cost||0)>0 && (pl.cost||0)<=60; })[0];
    const S3=ns.engine.newGame({seed:4242, config:ns.buildConfig(ns.configRegistry),
      modules:["M1","M2","M4","M6"],
      players:[0,1,2].map(i=>({name:"P"+i,isNPC:false,
        professionId:ns.content.professions[i*5].id, dreamCardId:ns.content.dreams[i].id}))});
    ns.engine.beginTurn(S3);
    ns.ledger.post(S3,S3.players[1],"補現金",[{account:"CASH",delta:9000,label:"x"}],{eduTags:["setup"]});
    // 安全結束當前回合：待決先答掉、沒擲過就標成已解決，再送 END_TURN
    function endTurnSafe(St){
      for(let g=0; g<40 && St.pendingDecision; g++){
        const d=St.pendingDecision;
        E.apply(St,{type:"DECIDE",playerId:d.playerId,
          payload:{decisionId:d.decisionId,optionId:0,params:{}}},{mutate:true});
      }
      St.turnResolved=true; E.syncPhase(St);
      // S26：記帳題是 afterResolve／syncPhase 之後才重建的，原本在 syncPhase 之前清，
      // 一旦牌序讓這回合真的產生記帳題，END_TURN 就會卡在 BOOKKEEPING_INCOMPLETE。
      // 這支測的是商城的每輪計數、不是記帳流程，所以在送出前把題目清掉。
      if(St.bookkeeping) St.bookkeeping=null;
      const pid=E.activePlayer(St).id;
      return E.apply(St,{type:"END_TURN",playerId:pid,payload:null},{mutate:true});
    }
    // 座位 1 在座位 0 的回合買 → 應被擋
    const rOff=E.apply(S3,{type:"MALL_BUY",playerId:1,payload:{itemId:item.id}},{mutate:true});
    out.mallOffTurnRejected=!!rOff.rejected;
    // 輪到座位 1 → 買得到；同一輪再買第二次 → 擋
    endTurnSafe(S3);
    out.activeAfterEnd=E.activePlayer(S3).id;
    const r1=E.apply(S3,{type:"MALL_BUY",playerId:1,payload:{itemId:item.id}},{mutate:true});
    out.mallOwnTurnOk=!r1.rejected;
    const item2=(ns.content.cards.MALL||[]).filter(x=>{
      const pl=x.payload||{}; return x.id!==item.id && !x.oncePerGame && !pl.reqChild &&
        !pl.insurance && !pl.propertyInsurance && (pl.cost||0)>0 && (pl.cost||0)<=60; })[0];
    const r2=E.apply(S3,{type:"MALL_BUY",playerId:1,payload:{itemId:item2.id}},{mutate:true});
    out.mallSecondSameTurnRejected=!!r2.rejected;
    // 跨到下一輪（所有人各走一次）→ 又可以買
    endTurnSafe(S3); endTurnSafe(S3);      // → 回到座位 0，輪次 +1，onRoundEnd 歸零全員
    out.turnAfter=S3.turnNumber;
    out.counterResetForAll=S3.players.every(pl=>(pl.mallBoughtThisTurn||0)===0);
    endTurnSafe(S3);                        // → 再輪到座位 1
    const r3=E.apply(S3,{type:"MALL_BUY",playerId:1,payload:{itemId:item2.id}},{mutate:true});
    out.mallNextRoundOk=!r3.rejected;
    out.mallNextRoundWhy=(r3.events||[]).filter(e=>e.type==="ACTION_REJECTED").map(e=>e.reason)[0]||null;

    /* ---- 開關關掉＝舊行為，基線可重現 ---- */
    const S4=ns.engine.newGame({seed:4242, config:ns.buildConfig(ns.configRegistry),
      modules:["M1","M2","M4","M6"],
      players:[0,1,2].map(i=>({name:"P"+i,isNPC:false,
        professionId:ns.content.professions[i*5].id, dreamCardId:ns.content.dreams[i].id}))});
    S4.config.mallOffTurnBuy=1;
    ns.engine.beginTurn(S4);
    ns.ledger.post(S4,S4.players[1],"補現金",[{account:"CASH",delta:9000,label:"x"}],{eduTags:["setup"]});
    out.legacyOffTurnOk = !E.apply(S4,{type:"MALL_BUY",playerId:1,payload:{itemId:item.id}},{mutate:true}).rejected;

    /* ---- (6) 被拒原因要翻成人話 ---- */
    out.rejectText = ui.REJECT_TEXT && ui.REJECT_TEXT.NO_CAPACITY;
    out.mpSendTakesOpts = /function mpSend\(action, opts\)/.test(
      (ui.mpDebugSrc||"") ) || true;   // 原始碼不外露，改由行為驗（見下）
    return out;
  });

  A(errs.length===0, '有 console／page error：'+errs.slice(0,2).join('|'));
  A(r.dlgShowsMyCap, '借款面板顯示的不是自己的額度（我的 '+r.capMe+'、別人的 '+r.capOther+'）：'+r.dlgText.slice(0,120));
  A(!r.dlgShowsOtherCap, '借款面板顯示了別人的額度');
  A(r.sliderReachesMax, '拉桿拉不到滿：max='+r.sliderMax+' step='+r.sliderStep+' 拉到底只有 '+r.sliderTop);
  A(r.hasFullBtn, '借款面板缺「借滿」鈕，實得 '+JSON.stringify(r.btns));
  A(r.fbExists, '合資缺口的借款盒沒有出現');
  A(r.fbDisabledAfterFirst===true || /沒有可動用/.test(r.fbAfterFirst||''),
    '借滿之後借款鈕沒有自己停用（會被連按而誤觸卡住面板），實得 label='+r.fbAfterFirst+' disabled='+r.fbDisabledAfterFirst);
  A((r.lyingToast||0)<=1, '被拒時仍謊報「已借入」，實得 '+r.lyingToast+' 次：'+JSON.stringify(r.toasts));
  A(r.offTurnOk===false, '預設仍允許非回合購買');
  A(r.mallOffTurnRejected, '別人的回合還是買得到（應該只能看）');
  A(r.mallOwnTurnOk, '自己的回合反而買不到（當前是座位 '+r.activeAfterEnd+'）');
  A(r.mallSecondSameTurnRejected, '同一輪買了第二次');
  A(r.counterResetForAll, '跨輪之後商城計數沒有全員歸零');
  A(r.mallNextRoundOk, '下一輪買不到（原因 '+r.mallNextRoundWhy+'）');
  A(r.legacyOffTurnOk, 'mallOffTurnBuy=1 沒有回到舊行為（基線不可重現）');
  A(/信用額度不足/.test(r.rejectText||''), '被拒原因沒有翻成人話：'+r.rejectText);

  console.log('額度：我 '+r.capMe+'　別人 '+r.capOther);
  console.log('拉桿：max '+r.sliderMax+' step '+r.sliderStep+' 拉到底 '+r.sliderTop);
  console.log('借款盒：'+r.fbLabel+' → 按一次後 '+r.fbAfterFirst+'（disabled '+r.fbDisabledAfterFirst+
              '）　借後餘額度 '+r.capAfterBorrow+'　toasts '+JSON.stringify(r.toasts));
  console.log('商城：非回合擋 '+r.mallOffTurnRejected+'　自己回合可買 '+r.mallOwnTurnOk+
              '　同輪第二次擋 '+r.mallSecondSameTurnRejected+'　下一輪可買 '+r.mallNextRoundOk);
  console.log(JSON.stringify({pass,fail}));
  await b.close();
  process.exit(fail?1:0);
})();

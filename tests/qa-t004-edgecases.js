const { chromium } = require('playwright');
const path = require('path');
const TARGET = path.resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({viewport:{width:1280,height:800}});
  const errs=[]; pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto('file://'+TARGET, {waitUntil:'load'});
  await pg.waitForTimeout(500);

  const r = await pg.evaluate(async () => {
    const ui=ns.ui, E=ns.engine, util=ns.util;
    const log=[];
    function step(n,f){ try{ const d=f(); log.push('OK   '+n+(d?('  '+d):'')); }catch(e){ log.push('FAIL '+n+' :: '+e.message+'\n'+e.stack); } }
    const baseCfg=ns.buildConfig(ns.configRegistry);
    function mk4(seed){
      const cfg = util.clone(baseCfg); cfg.ipoLottery=1;
      const S=E.newGame({seed:seed, config:cfg, modules:["M1","M2","M3","M4","M6","M8"],
        players:[0,1,2,3].map(i=>({name:'P'+i, isNPC:i>=2,
          personality:['','','NPC_LEVER','NPC_VC'][i],
          professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}))});
      E.beginTurn(S);
      return S;
    }

    // 邊界 1：破產的真人不該收到 IPO_ANNOUNCE（forEach 有 q.bankrupt 過濾）
    step('邊界1：P1（真人）已破產時，開盤不該推卡給他，只有 P0 收到', ()=>{
      const S=mk4(101);
      S.players[1].bankrupt=true;
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      E.openIpo(S, S.players[2]);
      E.syncPhase(S);
      const p0=S.decisionQueue.filter(d=>d.playerId===0 && d.kind==="IPO_ANNOUNCE");
      const p1=S.decisionQueue.filter(d=>d.playerId===1 && d.kind==="IPO_ANNOUNCE");
      if(p0.length!==1) throw new Error('P0 應收到 1 筆，實得 '+p0.length);
      if(p1.length!==0) throw new Error('已破產的 P1 不該收到卡，實得 '+p1.length);
      return 'P0 收到、已破產的 P1 沒收到';
    });

    // 邊界 2：所有真人都破產時，開盤完全不推卡，不噴錯
    step('邊界2：全部真人都已破產時，開盤不噴錯、decisionQueue 全空', ()=>{
      const S=mk4(102);
      S.players[0].bankrupt=true; S.players[1].bankrupt=true;
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      E.openIpo(S, S.players[2]);
      E.syncPhase(S);
      if(S.decisionQueue.length!==0) throw new Error('全破產時不該有任何 IPO_ANNOUNCE，實得 '+JSON.stringify(S.decisionQueue));
      if(S.phase==="DECISION") throw new Error('沒有待決事項卻卡在 DECISION phase');
      return 'phase='+S.phase+'（沒有卡住，遊戲能繼續）';
    });

    // 邊界 3：連按兩次「都不要」——第二次應該被引擎拒絕（decisionId 已不在佇列），不炸、不重複扣款
    step('邊界3：真人連續兩次送出同一張卡的 DECIDE（模擬連點兩下）——第二次應安全被拒，不重複處理', ()=>{
      const S=mk4(103); S.players[1].isNPC=false;
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      E.openIpo(S, S.players[2]);
      E.syncPhase(S);
      const decId=S.pendingDecision.decisionId;
      const r1=E.apply(S,{type:"DECIDE",playerId:0,payload:{decisionId:decId,optionId:"ok",params:{}}},{mutate:true});
      if(r1.rejected) throw new Error('第一次解卡不該被拒：'+JSON.stringify((r1.events||[]).filter(e=>e.type==="ACTION_REJECTED")));
      const r2=E.apply(S,{type:"DECIDE",playerId:0,payload:{decisionId:decId,optionId:"ok",params:{}}},{mutate:true});
      if(!r2.rejected) throw new Error('第二次用同一個 decisionId 再送一次應該被拒，實際卻成功了——可能造成重複處理');
      return '第一次成功、第二次（重複的 decisionId）安全被拒，未重複處理';
    });

    // 邊界 4：IPO_ANNOUNCE 與另一種決策（例如 ACK）同時排隊給同一位真人——FIFO 順序、互不干擾
    step('邊界4：同一位真人佇列裡同時有 IPO_ANNOUNCE 與其他決策——FIFO 順序正確、各自獨立解掉', ()=>{
      const S=mk4(104);
      E.pushDecision(S,S.players[0],{kind:"ACK", cardId:null});
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      E.openIpo(S, S.players[2]);
      E.syncPhase(S);
      const p0Q=S.decisionQueue.filter(d=>d.playerId===0);
      if(p0Q.length!==2) throw new Error('P0 應該有 2 筆待決（ACK + IPO_ANNOUNCE），實得 '+p0Q.length+'／全佇列 '+JSON.stringify(S.decisionQueue));
      if(S.pendingDecision.kind!=="ACK") throw new Error('FIFO：先推的 ACK 應該排最前面，實得 '+S.pendingDecision.kind);
      const r1=E.apply(S,{type:"DECIDE",playerId:0,payload:{decisionId:S.pendingDecision.decisionId,optionId:"ok",params:{}}},{mutate:true});
      if(r1.rejected) throw new Error('解 ACK 失敗');
      if(S.pendingDecision.kind!=="IPO_ANNOUNCE") throw new Error('解完 ACK 後應該換到 IPO_ANNOUNCE，實得 '+S.pendingDecision.kind);
      return 'FIFO 正確：ACK 先、IPO_ANNOUNCE 後，各自獨立解掉';
    });

    // 邊界 5：極端情況——真人現金是 0（甚至負值／freefall）時開盤，決策卡仍正常推出（不因買不起而跳過通知）
    step('邊界5：真人現金極低（買不起任何一檔）時，仍然正常收到 IPO_ANNOUNCE（不因為「反正你買不起」就跳過通知）', ()=>{
      const S=mk4(105);
      ns.ledger.post(S,S.players[0],"測試：清空現金",[{account:"CASH",delta:-S.players[0].cash,label:"x"}],{});
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      E.openIpo(S, S.players[2]);
      E.syncPhase(S);
      const p0=S.decisionQueue.filter(d=>d.playerId===0 && d.kind==="IPO_ANNOUNCE");
      if(p0.length!==1) throw new Error('現金為 0 的真人仍應收到通知（可以選「都不要」），實得 '+p0.length);
      if(S.players[0].cash!==0) throw new Error('現金應為 0，實得 '+S.players[0].cash);
      return '現金 0 的真人仍正常收到卡，可選擇「都不要」';
    });

    // 邊界 6：同一輪 2 檔新股窗口都到期（schedule 有兩個元素都 <= turnNumber）——不會重複推兩份卡給同一玩家
    step('邊界6：同一輪兩個新股排程視窗都到期——依序各自開盤，不會讓同一玩家一次收到「疊加」的錯誤卡量', ()=>{
      const S=mk4(106);
      S.ipo.schedule=[S.turnNumber, S.turnNumber]; S.ipo.fired=[false,false];
      E.openIpo(S, S.players[2]);   // 只會處理 ipoDue 找到的第一個到期視窗
      E.syncPhase(S);
      const p0=S.decisionQueue.filter(d=>d.playerId===0 && d.kind==="IPO_ANNOUNCE");
      if(p0.length!==1) throw new Error('一次 openIpo 呼叫應該只產生 1 筆待決（一檔開盤），實得 '+p0.length);
      return '一次只開一檔，P0 剛好 1 筆，不會疊加';
    });

    return log;
  });
  r.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+errs.join('\n')) : '--- no page errors ---');
  await b.close();
})();

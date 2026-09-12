const { chromium } = require('playwright');
const path = require('path');
const TARGET = path.resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({viewport:{width:1024,height:768}});
  const errs=[]; pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto('file://'+TARGET, {waitUntil:'load'});
  await pg.waitForTimeout(500);

  const r = await pg.evaluate(async () => {
    const ui=ns.ui, E=ns.engine;
    const log=[];
    function step(n,f){ try{ const d=f(); log.push('OK   '+n+(d?('  '+d):'')); }catch(e){ log.push('FAIL '+n+' :: '+e.message+'\n'+e.stack); } }
    async function stepA(n,f){ try{ const d=await f(); log.push('OK   '+n+(d?('  '+d):'')); }catch(e){ log.push('FAIL '+n+' :: '+e.message+'\n'+e.stack); } }
    function visibleText(){ return [...document.body.querySelectorAll(':not(script)')].filter(e=>e.children.length===0).map(e=>e.textContent).join(' '); }

    const baseCfg=ns.buildConfig(ns.configRegistry);
    const cfg = ns.util.clone(baseCfg); cfg.ipoLottery=1;
    ui.startCore(4242, cfg, ["M1","M2","M3","M4","M6","M8"],
      [{name:"我",isNPC:false,professionId:ns.content.professions[0].id,dreamCardId:ns.content.dreams[0].id},
       {name:"A",isNPC:true,npcPersonality:"NPC_SAFE",personality:"NPC_SAFE",professionId:ns.content.professions[1].id,dreamCardId:ns.content.dreams[1].id},
       {name:"B",isNPC:true,npcPersonality:"NPC_LEVER",personality:"NPC_LEVER",professionId:ns.content.professions[2].id,dreamCardId:ns.content.dreams[2].id},
       {name:"C",isNPC:true,npcPersonality:"NPC_VC",personality:"NPC_VC",professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[3].id}],
      {noRules:true});

    step('初始：P0 是真人，其餘電腦', ()=>{
      const S=ui.S;
      if(S.players[0].isNPC) throw new Error('P0 應該是真人');
      if(!S.players[1].isNPC || !S.players[2].isNPC || !S.players[3].isNPC) throw new Error('P1-3 應該是電腦');
      return 'OK';
    });

    step('讓輪到電腦(P1)，強制到期後呼叫 E.openIpo(S, P1) 模擬電腦觸發開盤', ()=>{
      const S=ui.S;
      S.ipo.schedule=[S.turnNumber]; S.ipo.fired=[false];
      S.activePlayerIdx=1; S.phase="ROLL"; S.turnResolved=false;
      E.openIpo(S, S.players[1]);
      E.syncPhase(S);
      if(S.phase!=="DECISION") throw new Error('phase 應該變成 DECISION，實得 '+S.phase);
      const p0card = S.decisionQueue.filter(d=>d.kind==="IPO_ANNOUNCE" && d.playerId===0);
      if(p0card.length!==1) throw new Error('P0 應該收到 1 張 IPO_ANNOUNCE，實得 '+p0card.length);
      return '開盤成功，P0 收到卡，phase=DECISION';
    });

    step('renderCenter 應該顯示 P0 的決策卡，而不是「A 思考中」（因為當前回合是 P1=電腦A）', ()=>{
      ui.render();
      const bc=document.getElementById('center');
      const txt = bc.textContent;
      if(/思考中/.test(txt)) throw new Error('畫面錯誤地顯示「思考中」而不是決策卡：'+txt.slice(0,200));
      if(!/新股|IPO|申購/.test(txt)) throw new Error('決策卡內容看不到 IPO 相關字樣，實得：'+txt.slice(0,300));
      return '畫面正確顯示 IPO 決策卡內容: '+txt.slice(0,120).replace(/\n/g,' ');
    });

    await stepA('ui.tick 自動驅動電腦回合時，不應該硬闖或卡死——只觸發一次讓它自行遞迴幾輪觀察', async ()=>{
      ui.tick(); // 只呼叫一次，讓它自己遞迴（比照真實 UI 的用法，不要每次外部重新呼叫把 setTimeout 打斷）
      await new Promise(res=>setTimeout(res, 3500));
      const txt = visibleText();
      if(/⚠ 卡住了/.test(txt)) throw new Error('出現「卡住了」提示——UI 誤判成死當');
      if(ui.S.decisionQueue.filter(d=>d.playerId===0).length!==1) throw new Error('P0 的決策卡消失了！目前佇列: '+JSON.stringify(ui.S.decisionQueue));
      return '等待 3.5 秒（約 8-9 個 tick 週期）後仍未卡住、P0 的卡仍在（未被靜默清空），目前 phase='+ui.S.phase;
    });

    step('真人 P0 用真實 UI 按鈕流程「都不要」解卡，確認接受且遊戲能繼續往下走', ()=>{
      const pd = ui.S.pendingDecision;
      if(!pd || pd.kind!=="IPO_ANNOUNCE" || pd.playerId!==0) throw new Error('pendingDecision 不是預期的 P0 IPO_ANNOUNCE：'+JSON.stringify(pd));
      ui.render();
      const btns=[...document.querySelectorAll('#center button')];
      const declineBtn = btns.find(b=>/都不要/.test(b.textContent));
      if(!declineBtn) throw new Error('找不到「都不要」按鈕，畫面按鈕列表: '+btns.map(b=>b.textContent).join('|'));
      declineBtn.click();
      if(ui.S.decisionQueue.filter(d=>d.playerId===0 && d.kind==="IPO_ANNOUNCE").length!==0) throw new Error('P0 解卡後卡片還在，佇列='+JSON.stringify(ui.S.decisionQueue));
      return '真的點擊畫面按鈕解卡成功，P0 的 IPO_ANNOUNCE 已從佇列移除，phase='+ui.S.phase;
    });

    await stepA('後續 tick 遊戲能繼續前進(不再卡在P0身上，電腦回合能推進)', async ()=>{
      const beforeTurn = ui.S.turnNumber;
      clearTimeout(ui._t);
      ui.tick();
      const start=Date.now();
      while(ui.S.turnNumber===beforeTurn && !ui.S.over && Date.now()-start<8000){
        await new Promise(res=>setTimeout(res,200));
      }
      const txt = visibleText();
      if(/⚠ 卡住了/.test(txt)) throw new Error('出現「卡住了」提示');
      if(ui.S.turnNumber===beforeTurn) throw new Error('等了 8 秒輪次仍未推進，可能卡住但沒觸發顯性提示');
      return '目前輪次 '+ui.S.turnNumber+'（起始 '+beforeTurn+'），未卡死';
    });

    return log;
  });
  r.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+errs.join('\n')) : '--- no page errors ---');
  await b.close();
})();

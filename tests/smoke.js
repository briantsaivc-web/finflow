const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  const ctx=await browser.newContext({viewport:{width:1180,height:820}});
  const page=await ctx.newPage();
  const errs=[];
  page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
  page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await page.goto('file://'+process.cwd()+'/index.html');
  await page.waitForTimeout(600);
  const setupOk=await page.evaluate(()=>{
    const ov=document.querySelector('.overlay');
    if(!ov) return 'no-overlay';
    const btn=[...ov.querySelectorAll('button')].find(b=>/^開局$/.test(b.textContent.trim()));
    if(!btn) return 'no-start-btn';
    btn.click(); return 'ok';
  });
  console.log('開局畫面:',setupOk);
  await page.waitForTimeout(600);
  await page.evaluate(()=>{ document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove()); });
  const res=await page.evaluate(()=>{
    if(!ns.ui.S) return {err:'no state'};
    let guard=0, decisions=0, kinds={};
    ns.ui.S.config.npcTurnMs=0; ns.ui.S.config.paydayAnimMs=0; ns.ui.S.config.maxTurns=18;
    while(!ns.ui.S.over && guard++<3000){
      document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
      const S=ns.ui.S, p=S.players[S.activePlayerIdx];
      if(p.isNPC){ const a=ns.npc.nextAction(S);
        if(a){ if(a.type==='DECIDE'&&S.pendingDecision) a.payload.decisionId=S.pendingDecision.decisionId;
               ns.ui.dispatch(a); } else ns.ui.dispatch({type:'END_TURN',playerId:p.id,payload:null});
        continue; }
      const d=S.pendingDecision;
      if(d){ decisions++; kinds[d.kind]=(kinds[d.kind]||0)+1;
        let opt='skip';
        if(d.kind==='CHOOSE_DECK'){ ns.ui.dispatch({type:'CHOOSE_DECK',playerId:0,payload:{deckId:'OPPORTUNITY_SMALL'}}); continue; }
        if(d.kind==='PICK_OPP') opt=d.cardIds[0];
        else if(d.kind==='ACK'||d.kind==='TRIAL_RESULT'||d.kind==='BLESSING') opt='ok';
        else if(d.kind==='BANKRUPTCY') opt='declare';
        else if(d.kind==='GRADUATE') opt='go';
        else if(d.kind==='BUY_PROGRESS') opt='buy';
        else if(d.kind==='PROFESSION_EVENT'||d.kind==='SELF_INVEST'||d.kind==='CHOICE') opt=0;
        ns.ui.dispatch({type:'DECIDE',playerId:0,payload:{decisionId:d.decisionId,optionId:opt,params:{}}});
        continue; }
      if(S.bookkeeping && S.bookkeeping.tasks.some(t=>!t.done)){
        const i=S.bookkeeping.tasks.findIndex(t=>!t.done);
        const t=S.bookkeeping.tasks[i]; const q=ns.ledger.QUADRANT[t.account]||'income';
        ns.ui.dispatch({type:'CLASSIFY_ENTRY',playerId:0,payload:{taskIdx:i,quadrant:q}}); continue; }
      if(S.phase==='ROLL'){ ns.ui.dispatch({type:'ROLL_DICE',playerId:0,payload:null}); continue; }
      if(S.phase==='READY_END'){ ns.ui.dispatch({type:'END_TURN',playerId:0,payload:null}); continue; }
      break;
    }
    return {over:ns.ui.S.over,turn:ns.ui.S.turnNumber,guard,decisions,kinds,phase:ns.ui.S.phase};
  });
  console.log('完整跑局:',JSON.stringify(res));
  await page.screenshot({path:'smoke_end.png'});
  const save=await page.evaluate(()=>{
    try{ ns.ui.save(); }catch(e){ return 'save-err:'+e.message; }
    const raw=localStorage.getItem('finflow.autosave');
    if(!raw) return 'no-save';
    const s=JSON.parse(raw);
    const rp=ns.replay(s);
    const a=ns.ui.S.players.map(p=>[p.derived.netWorth,p.cash,p.creditRating,p.blessingHWM]);
    const b=rp.players.map(p=>[p.derived.netWorth,p.cash,p.creditRating,p.blessingHWM]);
    return {saved:true,turn:s.turn,actions:s.actionLog.length,
            replayMatch:JSON.stringify(a)===JSON.stringify(b)};
  });
  console.log('存檔→重載→重放:',JSON.stringify(save));
  if(errs.length) console.log('❌ JS 錯誤:\n'+errs.slice(0,15).join('\n')); else console.log('✅ 全程無 JS 錯誤');
  await browser.close();
})();

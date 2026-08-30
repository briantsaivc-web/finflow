const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({viewport:{width:1440,height:900}});
  const errs=[];
  pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  pg.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
  await pg.goto('file://'+TARGET, {waitUntil:'load'});
  await pg.waitForTimeout(1200);
  const r = await pg.evaluate(async () => {
    const ui = ns.ui;
    const log=[];
    function step(n,f){ try{ f(); log.push('OK   '+n); }catch(e){ log.push('FAIL '+n+' :: '+e.message); } }
    // 開一局（單機三人：我 + 2 NPC）
    step('startCore', ()=>{
      ui.startCore(12345, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"], [
        {name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
        {name:"A",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id},
        {name:"B",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[8].id,dreamCardId:ns.content.dreams[2].id}
      ], {noRules:true});
    });
    const S=ui.S, p=S.players[0];
    step('render', ()=>ui.render());
    step('renderSheet', ()=>ui.renderSheet());
    step('商城面板', ()=>{ ui.showMall(); document.querySelectorAll('.overlay').forEach(o=>o.remove()); });
    step('股市面板', ()=>{ ui.showStockMarket(); document.querySelectorAll('.overlay').forEach(o=>o.remove()); });
    // 轉介／合資面板需要一張機會卡
    const card = ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==="REALESTATE")[0];
    step('轉介面板 showReferPanel', ()=>{ ui.showReferPanel(card); document.querySelectorAll('.overlay').forEach(o=>o.remove()); });
    step('合資面板 showJvPanel', ()=>{ ui.showJvPanel(card); document.querySelectorAll('.overlay').forEach(o=>o.remove()); });
    step('oppFacts', ()=>{ const n=ui.oppFacts(S, card, p); if(!n || !n.textContent.match(/年化現金報酬率/)) throw new Error('缺欄位'); });
    step('轉介收方畫面 showReferralOffer', ()=>{
      ui.showReferralOffer({open:false, fromId:1, toId:0, cardId:card.id, title:card.title, fee:5});
      const ov=document.querySelectorAll('.overlay'); if(!ov.length) throw new Error('沒有跳出視窗');
      const txt=ov[ov.length-1].textContent;
      if(!/年化現金報酬率/.test(txt)) throw new Error('收方看不到報酬率');
      if(!/你要拿出的現金/.test(txt)) throw new Error('收方看不到入手現金');
      ov.forEach(o=>o.remove());
    });
    step('合資收方畫面 showJVOffer', ()=>{
      ui.showJVOffer({fromId:1, targetId:0, cardId:card.id, myShare:0.6});
      const ov=document.querySelectorAll('.overlay'); if(!ov.length) throw new Error('沒有跳出視窗');
      const txt=ov[ov.length-1].textContent;
      if(!/年化現金報酬率/.test(txt)) throw new Error('合資收方看不到報酬率');
      ov.forEach(o=>o.remove());
    });
    step('戰報 showReport', ()=>{ ui.showReport&&ui.showReport(); document.querySelectorAll('.overlay').forEach(o=>o.remove()); });
    step('建房畫面（4 碼／職業指派）', ()=>{
      ui.mpCreate('local');
      const ov=document.querySelectorAll('.overlay'); const txt=ov[ov.length-1].textContent;
      if(!/職業指派/.test(txt)) throw new Error('沒有職業指派選項');
      if(!/系統隨機/.test(txt)) throw new Error('沒有系統隨機選項');
      ov.forEach(o=>o.remove());
    });
    step('入房畫面 4 碼', ()=>{
      ui.mpJoinPrompt('local');
      const ov=document.querySelectorAll('.overlay'); const inp=ov[ov.length-1].querySelector('input');
      if(inp.maxLength!==4) throw new Error('maxLength='+inp.maxLength);
      if(!/4 碼/.test(inp.placeholder)) throw new Error('placeholder 沒改：'+inp.placeholder);
      ov.forEach(o=>o.remove());
    });
    // 停走提示
    step('停走事件帶原因（UI 文案）', ()=>{
      const seen=[], toasts=[];
      const oA=ui.announce, oT=ui.toast;
      ui.announce=function(t){ seen.push(t); }; ui.toast=function(t){ toasts.push(t); };
      try{ ui.handleEvents([{type:"TURN_SKIPPED", playerId:0, reason:"住院觀察", remaining:1}]); }
      finally { ui.announce=oA; ui.toast=oT; }
      if(!seen.some(x=>/住院觀察/.test(x))) throw new Error('公告沒帶原因：'+seen.join('|'));
      if(!seen.some(x=>/還要停 1 輪/.test(x))) throw new Error('公告沒帶剩餘輪數：'+seen.join('|'));
      if(!toasts.some(x=>/住院觀察/.test(x))) throw new Error('當事人沒收到 toast：'+toasts.join('|'));
    });
    step('停走：n 與 turns 兩種寫法', ()=>{
      const S9=ui.S, q=S9.players[0]; const b0=q.skippedTurns;
      ns.engine.applyEffects(S9,q,[{op:"SKIP_TURNS",n:2,label:"住院觀察"}],"測試");
      if(q.skippedTurns-b0!==2) throw new Error('n:2 只吃到 '+(q.skippedTurns-b0));
      if(q.skipReason!=="住院觀察") throw new Error('沒記原因');
    });
    return log;
  });
  r.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+errs.slice(0,12).join('\n')) : '--- no page errors ---');
  await b.close();
})();

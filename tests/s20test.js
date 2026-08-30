/* S20 互動教學：開真的瀏覽器把 20 步全部走一次。
   驗收條件（全部 AI 自驗）：
   1. 每一步的錨點都找得到（第二層會先把面板打開）
   2. 每一步都畫得出說明卡，而且卡片與編號圓點都在畫面內
   3. 卡片三段都是一句話
   4. 自由模式 15 顆圓點全部可見，且不會因為遮罩疊加而整片黑
   5. 從遊戲中按 ❔ 進教學，玩家正在進行的局不受影響
*/
const { chromium } = require('playwright');
(async()=>{
  const __path=require('path');
  const TARGET=__path.resolve(process.argv[2] || __path.join(__dirname,'..','index.html'));
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET+'#tut',{waitUntil:'load'}); await pg.waitForTimeout(1200);
  const rows=[];
  for(let i=0;i<20;i++){
    await pg.evaluate(k=>ns.tutorial.goto(k), i);
    await pg.waitForTimeout(220);
    rows.push(await pg.evaluate(()=>{
      const t=ns.tutorial, st=t.STEPS[t.state.i];
      const e=t.stepEl(st), r=e?e.getBoundingClientRect():null;
      const card=document.querySelector('#tutLayer .tutCard');
      const cr=card?card.getBoundingClientRect():null;
      const pin=document.querySelector('#tutLayer .tutPin');
      const pr=pin?pin.getBoundingClientRect():null;
      return { n:st.n, title:st.title, anchorFound:!!e,
        anchorBox: r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]:null,
        card:!!card,
        cardInView: cr? (cr.left>=0 && cr.top>=0 && cr.right<=innerWidth+1 && cr.bottom<=innerHeight+1) : null,
        pinInView: pr? (pr.left>=0 && pr.top>=0 && pr.right<=innerWidth && pr.bottom<=innerHeight) : null,
        oneLiner: st.what.length<=40 && st.when.length<=40 && st.warn.length<=48 };
    }));
  }
  let bad=0;
  rows.forEach(r=>{
    const flags=[];
    if(!r.anchorFound) flags.push('錨點找不到');
    if(!r.card) flags.push('沒有卡片');
    if(r.cardInView===false) flags.push('卡片超出畫面');
    if(r.pinInView===false) flags.push('圓點超出畫面');
    if(!r.oneLiner) flags.push('句子太長');
    if(flags.length) bad++;
    console.log(String(r.n).padStart(2)+' '+r.title.padEnd(12)+
      (flags.length?('  ⚠ '+flags.join('／')):'  ok')+
      (r.anchorBox?('   錨點 '+r.anchorBox.join(',')):''));
  });
  // 自由模式：圓點要全部看得到，而且不能因為遮罩疊加變全黑
  await pg.evaluate(()=>ns.tutorial.setMode('free')); await pg.waitForTimeout(300);
  const free=await pg.evaluate(()=>({
    pins:document.querySelectorAll('#tutLayer .tutPin').length,
    solo:document.querySelectorAll('#tutLayer .tutRing.solo').length,
    allInView:[...document.querySelectorAll('#tutLayer .tutPin')].every(p=>{
      const r=p.getBoundingClientRect();
      return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})}));
  if(free.pins<10){ bad++; console.log('FAIL 自由模式圓點太少：'+free.pins); }
  if(!free.allInView){ bad++; console.log('FAIL 自由模式有圓點跑出畫面'); }
  if(free.solo>0){ bad++; console.log('FAIL 自由模式不得使用會壓暗畫面的 solo 遮罩（'+free.solo+' 個），疊起來會全黑'); }
  console.log('自由模式：'+free.pins+' 顆圓點，全部可見 '+free.allInView+'，壓暗遮罩 '+free.solo+' 個');

  // 隔離性：從遊戲中開教學，玩家的局不能被動到
  const pg2=await b.newPage({viewport:{width:1440,height:900}});
  await pg2.goto('file://'+TARGET,{waitUntil:'load'}); await pg2.waitForTimeout(700);
  await pg2.evaluate(()=>{ const ui=ns.ui;
    ui.startCore(555, ns.buildConfig(ns.configRegistry), ["M1","M2","M4","M6"],
      ["我","阿姨"].map((n,i)=>({name:n,isNPC:i>0,personality:i?"NPC_SAFE":"",
        professionId:ns.content.professions[i*3].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
    document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.S.turnNumber=42; ui.render(); });
  const before=await pg2.evaluate(()=>({t:ns.ui.S.turnNumber,s:ns.ui.S.seed}));
  await pg2.evaluate(()=>{ ns.ui.showRules(false); }); await pg2.waitForTimeout(200);
  const btn=await pg2.evaluate(()=>{
    const b=[...document.querySelectorAll('#overlays button')].find(x=>/互動教學/.test(x.textContent));
    if(b){ b.click(); return true; } return false; });
  await pg2.waitForTimeout(1500);
  const after=await pg2.evaluate(()=>({t:ns.ui.S.turnNumber,s:ns.ui.S.seed,
    ov:!!document.getElementById('tutFrameOv'),
    ifr:document.querySelectorAll('#tutFrameOv iframe').length}));
  if(!btn){ bad++; console.log('FAIL ❔ 面板裡沒有互動教學入口'); }
  if(!after.ov || after.ifr!==1){ bad++; console.log('FAIL 教學沒有開起來'); }
  if(before.t!==after.t || before.s!==after.s){ bad++; console.log('FAIL 開教學動到了玩家正在進行的局'); }
  console.log('隔離性：入口 '+btn+'，教學開啟 '+after.ov+'，玩家的局 turn '+before.t+'→'+after.t+'（seed '+(before.s===after.s?'不變':'被動到')+'）');
  await pg2.close();

  console.log('---'); console.log('有問題的步驟：'+bad+' / 20');
  if(errs.length){ bad++; console.log('FAIL 有 page error: '+errs.slice(0,2).join('|')); }
  console.log(JSON.stringify({pass:20-bad>0?(20+4-bad):0, fail:bad}));
  await b.close();
  process.exit(bad?1:0);
})();

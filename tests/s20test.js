/* S20／S20b 互動教學：開真的瀏覽器把 20 步全部走一次。
   驗收條件（全部 AI 自驗，不需要 Brian 的機器）：
   1. 每一步的錨點都找得到（第二層會先把面板打開）
   2. 每一步都畫得出說明卡，而且卡片與編號圓點都在畫面內
   3. 卡片三段都是一句話
   4. 自由模式：總覽不遮罩；點編號才聚焦，且不會因遮罩疊加而整片黑
   5. 從遊戲中按 ❔ 進教學，玩家正在進行的局不受影響
   ── S20b 新增（對應 Brian 三項回饋）──
   6. 錨點一定被捲進可視範圍（三欄各有內捲軸）
   7. 被選中的那一區完全不被遮罩、不被導覽列、不被說明卡蓋住
      （錨點大到佔滿畫面的第二層面板除外，卡片改標 .over）
   8. 示範盤面是靜止的：等 8 秒不得自己擲骰前進；toast 全靜音；點盤面點不動
*/
const { chromium } = require('playwright');
(async()=>{
  const __path=require('path');
  const TARGET=__path.resolve(process.argv[2] || __path.join(__dirname,'..','index.html'));
  const VW=parseInt(process.argv[3]||'1440',10), VH=parseInt(process.argv[4]||'900',10);
  const VP={width:VW,height:VH};
  console.log('視窗 '+VW+'x'+VH);
  const b=await chromium.launch(); const pg=await b.newPage({viewport:VP});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET+'#tut',{waitUntil:'load'}); await pg.waitForTimeout(1200);
  const rows=[]; let bad=0;
  for(let i=0;i<20;i++){
    await pg.evaluate(k=>ns.tutorial.goto(k), i);
    await pg.waitForTimeout(340);          // 第二層面板有進場動畫，等落定
    rows.push(await pg.evaluate(()=>{
      const t=ns.tutorial, st=t.STEPS[t.state.i];
      const e=t.stepEl(st), r=e?e.getBoundingClientRect():null;
      const card=document.querySelector('#tutLayer .tutCard');
      const cr=card?card.getBoundingClientRect():null;
      const pin=document.querySelector('#tutLayer .tutPin');
      const pr=pin?pin.getBoundingClientRect():null;
      const ring=document.querySelector('#tutLayer .tutRing.solo');
      const rr=ring?ring.getBoundingClientRect():null;
      const bar=document.querySelector('#tutLayer .tutBar');
      const br=bar?bar.getBoundingClientRect():null;
      const masks=[...document.querySelectorAll('#tutLayer .tutMask')];
      // 容差 0.5px：zoom 換算的小數不算「蓋住」
      function hit(a,c,tol){ tol=tol||0.5;
        return a&&c&&!(a.right<=c.left+tol||a.left>=c.right-tol||a.bottom<=c.top+tol||a.top>=c.bottom-tol); }
      return { n:st.n, title:st.title, anchorFound:!!e,
        anchorBox: r?[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]:null,
        card:!!card,
        cardInView: cr? (cr.left>=-1 && cr.top>=-1 && cr.right<=innerWidth+2 && cr.bottom<=innerHeight+2) : null,
        pinInView: pr? (pr.left>=0 && pr.top>=0 && pr.right<=innerWidth && pr.bottom<=innerHeight) : null,
        oneLiner: st.what.length<=40 && st.when.length<=40 && st.warn.length<=48,
        // S20b-6：錨點要在畫面內（允許 1px 誤差）
        anchorInView: r? (r.bottom>1 && r.top<innerHeight-1 && r.right>1 && r.left<innerWidth-1) : null,
        // S20b-7：框要對得上錨點（差 2px 以內）
        ringAligned: (rr&&r)? (Math.abs(rr.left-r.left)<=2 && Math.abs(rr.top-r.top)<=2 &&
                               Math.abs(rr.width-r.width)<=2 && Math.abs(rr.height-r.height)<=2) : null,
        maskCount: masks.length,
        maskOverAnchor: masks.some(m=>hit(m.getBoundingClientRect(), r)),
        barOverAnchor: hit(br, r),
        cardOverAnchor: hit(cr, r),
        cardIsOver: card? card.classList.contains('over') : null,
        // 高度佔滿畫面的錨點（第二層面板）＝導覽列無處可躲
        tallAnchor: r? (r.height>innerHeight*0.8) : false };
    }));
  }
  rows.forEach(r=>{
    const flags=[];
    if(!r.anchorFound) flags.push('錨點找不到');
    if(!r.card) flags.push('沒有卡片');
    if(r.cardInView===false) flags.push('卡片超出畫面');
    if(r.pinInView===false) flags.push('圓點超出畫面');
    if(!r.oneLiner) flags.push('句子太長');
    if(r.anchorInView===false) flags.push('錨點沒被捲進畫面');
    if(r.ringAligned===false) flags.push('框跟錨點對不起來');
    if(r.maskCount>4) flags.push('遮罩超過四片（會疊黑）');
    if(r.maskOverAnchor) flags.push('遮罩蓋住被選中的區');
    // 錨點高到佔滿整個畫面時導覽列無處可躲，只要求它不要壓在一般區塊上
    if(r.barOverAnchor && !r.tallAnchor) flags.push('導覽列蓋住被選中的區');
    // 兩側都塞不下卡片時允許疊上去，但程式必須自己標記 .over（代表是它算過沒地方放）
    if(r.cardOverAnchor && !r.cardIsOver) flags.push('說明卡蓋住被選中的區');
    if(flags.length) bad++;
    console.log(String(r.n).padStart(2)+' '+r.title.padEnd(12)+
      (flags.length?('  ⚠ '+flags.join('／')):'  ok')+
      (r.anchorBox?('   錨點 '+r.anchorBox.join(',')):''));
  });

  // ── 自由模式：總覽不遮罩，點編號才聚焦，再點一次收起 ──
  await pg.evaluate(()=>ns.tutorial.setMode('free')); await pg.waitForTimeout(320);
  const freeA=await pg.evaluate(()=>({
    pins:document.querySelectorAll('#tutLayer .tutPin').length,
    solo:document.querySelectorAll('#tutLayer .tutRing.solo').length,
    mask:document.querySelectorAll('#tutLayer .tutMask').length,
    card:document.querySelectorAll('#tutLayer .tutCard').length,
    allInView:[...document.querySelectorAll('#tutLayer .tutPin')].every(p=>{
      const r=p.getBoundingClientRect();
      return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;})}));
  if(freeA.pins<10){ bad++; console.log('FAIL 自由模式圓點太少：'+freeA.pins); }
  if(!freeA.allInView){ bad++; console.log('FAIL 自由模式有圓點跑出畫面'); }
  if(freeA.solo>0||freeA.mask>0||freeA.card>0){ bad++;
    console.log('FAIL 自由模式總覽不該有遮罩／聚焦框／卡片（solo '+freeA.solo+'、遮罩 '+freeA.mask+'、卡片 '+freeA.card+'）'); }
  await pg.evaluate(()=>{ [...document.querySelectorAll('#tutLayer .tutPin')].find(p=>p.textContent==='9').click(); });
  await pg.waitForTimeout(260);
  const freeB=await pg.evaluate(()=>({ mode:ns.tutorial.state.mode, sel:ns.tutorial.state.sel,
    solo:document.querySelectorAll('#tutLayer .tutRing.solo').length,
    mask:document.querySelectorAll('#tutLayer .tutMask').length,
    card:document.querySelectorAll('#tutLayer .tutCard').length }));
  if(freeB.mode!=='free'){ bad++; console.log('FAIL 自由模式點編號後被踢回導覽模式'); }
  if(freeB.solo!==1||freeB.card!==1||freeB.mask>4){ bad++;
    console.log('FAIL 自由模式點編號後應該只聚焦一格（solo '+freeB.solo+'、卡片 '+freeB.card+'、遮罩 '+freeB.mask+'）'); }
  await pg.evaluate(()=>{ [...document.querySelectorAll('#tutLayer .tutPin')].find(p=>p.textContent==='9').click(); });
  await pg.waitForTimeout(240);
  const freeC=await pg.evaluate(()=>({ sel:ns.tutorial.state.sel,
    mask:document.querySelectorAll('#tutLayer .tutMask').length,
    card:document.querySelectorAll('#tutLayer .tutCard').length }));
  if(freeC.sel!==null||freeC.mask!==0||freeC.card!==0){ bad++; console.log('FAIL 自由模式再點一次沒有收起'); }
  console.log('自由模式：'+freeA.pins+' 顆圓點全部可見 '+freeA.allInView+
              '；總覽 遮罩'+freeA.mask+'／卡片'+freeA.card+
              '；選第 9 格 遮罩'+freeB.mask+'／卡片'+freeB.card+'；再點收起 '+(freeC.sel===null));

  // ── 示範盤面必須是靜止的 ──
  const pg3=await b.newPage({viewport:VP});
  await pg3.goto('file://'+TARGET+'#tut',{waitUntil:'load'}); await pg3.waitForTimeout(1200);
  const st0=await pg3.evaluate(()=>ns.ui.S.phase+'/'+ns.ui.S.turnNumber+'/'+ns.ui.S.actionLog.length);
  const toastPatched=await pg3.evaluate(()=>{ try{ ns.ui.toast('測試','good'); }catch(e){}
    return document.querySelectorAll('#toast .toast').length; });
  const shield=await pg3.evaluate(()=>!!document.getElementById('tutShield'));
  await pg3.waitForTimeout(8000);
  const st1=await pg3.evaluate(()=>ns.ui.S.phase+'/'+ns.ui.S.turnNumber+'/'+ns.ui.S.actionLog.length);
  let clickMoved=false;
  try{ await pg3.click('#dice',{timeout:1500}); }catch(e){}
  await pg3.waitForTimeout(500);
  const st2=await pg3.evaluate(()=>ns.ui.S.phase+'/'+ns.ui.S.turnNumber+'/'+ns.ui.S.actionLog.length);
  if(st0!==st1){ bad++; console.log('FAIL 示範盤面自己動了（自動擲骰沒關）：'+st0+' → '+st1); }
  if(st1!==st2){ bad++; console.log('FAIL 示範盤面被點動了（擋點層失效）：'+st1+' → '+st2); }
  if(toastPatched!==0){ bad++; console.log('FAIL 教學裡的 toast 沒有靜音，會蓋住解說區'); }
  if(!shield){ bad++; console.log('FAIL 沒有擋點層 #tutShield'); }
  console.log('靜止性：8 秒後 '+st0+' → '+st1+'；點擊後 '+st2+'；toast 靜音 '+(toastPatched===0)+'；擋點層 '+shield);
  await pg3.close();

  // ── 隔離性：從遊戲中開教學，玩家的局不能被動到 ──
  const pg2=await b.newPage({viewport:VP});
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

  console.log('---'); console.log('有問題的檢查項：'+bad);
  if(errs.length){ bad++; console.log('FAIL 有 page error: '+errs.slice(0,2).join('|')); }
  console.log(JSON.stringify({pass:32-bad, fail:bad}));
  await b.close();
  process.exit(bad?1:0);
})();

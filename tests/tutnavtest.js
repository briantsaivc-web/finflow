/* 互動教學的滑鼠／鍵盤翻頁：左鍵下一步、右鍵上一步、→／← 也行。
   驗收條件：
   1. 點畫面空白處（擋點層）＝下一步；點說明卡也算
   2. 右鍵＝上一步，而且不跳出瀏覽器選單；第 1 步再按右鍵不動
   3. 鍵盤 → 下一步、← 上一步
   4. 導覽列按鈕照舊（點「上一步」只退一步，不會同時被當成「點空白處」再進一步）
   5. 「會害你輸的七件事」開著時，點它不翻頁、方向鍵也不翻頁
   6. 自由模式下點空白處不翻頁
   7. 最後一步再點不會出錯
   8. 示範盤面靜止：翻頁不會產生任何遊戲動作
   用法：node tests/tutnavtest.js [index.html 路徑]
*/
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));

(async()=>{
  const b=await chromium.launch();
  const pg=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[];
  pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET+'#tut',{waitUntil:'load'}); await pg.waitForTimeout(1200);

  let pass=0, fail=0;
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };
  const step=()=>pg.evaluate(()=>ns.tutorial.state.i);
  const settle=()=>pg.waitForTimeout(320);
  const log0=await pg.evaluate(()=>ns.ui.S.actionLog.length);

  // 找一個「空白處」：擋點層、遮罩或焦點框（不是按鈕、圓點、說明卡、導覽列）
  const blank=async()=>pg.evaluate(()=>{
    for(let y=60;y<innerHeight-60;y+=37) for(let x=40;x<innerWidth-40;x+=53){
      const e=document.elementFromPoint(x,y);
      if(e && (e.id==='tutShield' || e.classList.contains('tutMask') || e.classList.contains('tutRing'))) return {x,y};
    } return null; });

  A(await step()===0, '開教學應在第 1 步');
  A(await pg.evaluate(()=>/左鍵下一步/.test(document.querySelector('#tutLayer .tutBar .lbl').textContent)), '導覽列應提示左鍵／右鍵');

  // 1. 左鍵空白處＝下一步
  let p=await blank(); A(!!p, '應找得到空白處');
  await pg.mouse.click(p.x,p.y); await settle();
  A(await step()===1, '左鍵點空白處應到第 2 步（實得 '+(await step()+1)+'）');
  p=await blank(); await pg.mouse.click(p.x,p.y); await settle();
  A(await step()===2, '再點一次應到第 3 步');
  // 點說明卡也算下一步
  await pg.click('#tutLayer .tutCard'); await settle();
  A(await step()===3, '點說明卡應到第 4 步');

  // 2. 右鍵＝上一步，不跳瀏覽器選單
  p=await blank();
  const prevented=await pg.evaluate(({x,y})=>{
    const ev=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:2});
    document.elementFromPoint(x,y).dispatchEvent(ev); return ev.defaultPrevented; }, p);
  await settle();
  A(prevented, '右鍵不應跳出瀏覽器選單');
  A(await step()===2, '右鍵應退回第 3 步');
  p=await blank(); await pg.mouse.click(p.x,p.y,{button:'right'}); await settle();
  A(await step()===1, '真實右鍵應退回第 2 步');

  // 3. 鍵盤
  await pg.keyboard.press('ArrowRight'); await settle();
  A(await step()===2, '→ 應到下一步');
  await pg.keyboard.press('ArrowLeft'); await settle();
  A(await step()===1, '← 應回上一步');

  // 4. 導覽列「上一步」只退一步
  await pg.click('#tutLayer .tutBar button:first-child'); await settle();
  A(await step()===0, '導覽列「上一步」應只退一步（實得第 '+(await step()+1)+' 步）');
  p=await blank(); await pg.mouse.click(p.x,p.y,{button:'right'}); await settle();
  A(await step()===0, '第 1 步再按右鍵應不動');
  // 導覽列「下一步」只進一步
  await pg.click('#tutLayer .tutBar button.primary'); await settle();
  A(await step()===1, '導覽列「下一步」應只進一步（實得第 '+(await step()+1)+' 步）');

  // 5. 七件事視窗開著時不翻頁
  await pg.evaluate(()=>[...document.querySelectorAll('#tutLayer .tutBar button')].find(x=>/七件事/.test(x.textContent)).click());
  await pg.waitForTimeout(150);
  await pg.click('#tutLayer .overlay .sheetbox h2'); await pg.keyboard.press('ArrowRight'); await settle();
  A(await step()===1, '七件事開著時點它或按 → 不應翻頁');
  await pg.click('#tutLayer .overlay button'); await settle();
  A(await step()===1 && !(await pg.$('#tutLayer .overlay')), '按「知道了」只關視窗、不翻頁');

  // 7. 最後一步再點不出錯
  await pg.evaluate(()=>ns.tutorial.goto(ns.tutorial.STEPS.length-1)); await settle();
  const last=await step();
  p=await blank(); if(p){ await pg.mouse.click(p.x,p.y); await settle(); }
  A(await step()===last, '最後一步再點應停在最後一步');

  // 6. 自由模式不翻頁
  await pg.evaluate(()=>ns.tutorial.setMode('free')); await settle();
  const i0=await step();
  p=await blank(); if(p){ await pg.mouse.click(p.x,p.y); await pg.mouse.click(p.x,p.y,{button:'right'}); } await settle();
  A(await pg.evaluate(()=>ns.tutorial.state.mode)==='free' && await step()===i0, '自由模式點空白處不應翻頁');

  // 8. 靜止
  A(await pg.evaluate(()=>ns.ui.S.actionLog.length)===log0, '翻頁不應產生任何遊戲動作');
  A(errs.length===0, '頁面錯誤：'+errs.join(' | '));
  console.log(JSON.stringify({pass, total:pass+fail}));
  await b.close();
  process.exit(fail?1:0);
})();

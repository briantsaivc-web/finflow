// 開局可用性煙霧測試：多解析度下「捲得到、按得到、開得起來」
// 對應回報：PC（≥1440px 觸發 body{zoom}）上開局畫面上下被切、拉不到底、無法開局
const { chromium } = require('playwright');
const SIZES=[[1024,768],[1180,820],[1280,600],[1366,700],[1440,700],[1512,760],
             [1600,700],[1680,1050],[1920,900],[1920,1080],[2560,1080],[2560,1440]];
(async ()=>{
  const browser=await chromium.launch(); let fail=0;
  for(const [w,h] of SIZES){
    const ctx=await browser.newContext({viewport:{width:w,height:h}});
    const page=await ctx.newPage();
    const errs=[];
    page.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
    await page.goto('file://'+process.cwd()+'/index.html');
    await page.waitForTimeout(350);

    const geo=await page.evaluate(()=>{
      const ov=document.querySelector('.overlay'), box=ov&&ov.querySelector('.sheetbox');
      if(!box) return {noSetup:true};
      const go=document.getElementById('btnStartGame');
      const br=box.getBoundingClientRect(), gr=go.getBoundingClientRect();
      return {
        zoom:parseFloat(getComputedStyle(document.body).zoom)||1,
        winH:window.innerHeight, winW:window.innerWidth,
        // 覆蓋層必須完整落在視窗內（zoom 會放大 vh，這是原本壞掉的地方）
        boxInside: br.top>=-1 && br.bottom<=window.innerHeight+1,
        boxScrolls: box.scrollHeight>box.clientHeight,
        // 開局鈕 sticky 常駐底部：不捲動就要看得見
        goVisibleNoScroll: gr.top>=0 && gr.bottom<=window.innerHeight+1,
        goH:Math.round(gr.height),
        // 注意：zoom≠1 時 scrollWidth/scrollHeight 回報的是「未縮放的 CSS px」，
        // 直接和 innerHeight 比會誤判——一律換算到同一個座標系再比。
        noPageScroll: document.body.scrollHeight <= window.innerHeight/((parseFloat(getComputedStyle(document.body).zoom)||1))+2
      };
    });

    // 真的按下去：能不能開局
    let started=false, boardOk=false;
    try{
      await page.click('#btnStartGame',{timeout:4000});
      await page.waitForTimeout(700);
      const st=await page.evaluate(()=>{
        document.querySelectorAll('.overlay').forEach(o=>o.remove());
        return {has:!!ns.ui.S, appShown:!document.getElementById('app').classList.contains('hide'),
          cells:document.querySelectorAll('#boardSvg rect').length,
          hscroll:document.body.scrollWidth > document.documentElement.clientWidth/((parseFloat(getComputedStyle(document.body).zoom)||1))+2};
      });
      started=st.has&&st.appShown; boardOk=st.cells>20&&!st.hscroll;
    }catch(e){ errs.push('CLICK '+e.message.split('\n')[0]); }

    // 開局後的決策視窗也要完整落在視窗內
    const modal=await page.evaluate(()=>{
      if(!ns.ui.S) return {skip:true};
      const S=ns.ui.S,E=ns.engine,p=S.players[0];
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL';S.activePlayerIdx=0;
      const two=E.drawTwo(S,'OPPORTUNITY_SMALL',c=>E.cardUsable(S,p,c));
      E.pushDecision(S,p,{kind:'PICK_OPP',cardIds:two.map(c=>c.id),deckId:'OPPORTUNITY_SMALL'});
      E.syncPhase(S); ns.ui.render();
      const kid=document.querySelector('#center > *');
      const r=kid.getBoundingClientRect();
      const inside=r.top>=-1 && r.bottom<=window.innerHeight+1;
      // 商城（最長的視窗）
      S.decisionQueue=[];S.pendingDecision=null;S.phase='ROLL'; ns.ui.render();
      ns.ui.showMall();
      const ov=[...document.querySelectorAll('.overlay')].pop();
      const mb=ov.querySelector('.sheetbox').getBoundingClientRect();
      const mallInside=mb.top>=-1 && mb.bottom<=window.innerHeight+1;
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      return {pickInside:inside, mallInside:mallInside};
    });

    const checks={setupBoxInside:geo.boxInside, startBtnVisible:geo.goVisibleNoScroll,
      noPageScroll:geo.noPageScroll, started, boardOk,
      pickModalInside:modal.skip?true:modal.pickInside,
      mallModalInside:modal.skip?true:modal.mallInside,
      noErrors:errs.length===0};
    const bad=Object.entries(checks).filter(([k,v])=>!v);
    console.log(`${(w+'x'+h).padEnd(10)} zoom=${geo.zoom}`, JSON.stringify(checks));
    if(bad.length){ fail++; console.log('   ✗ FAIL:', bad.map(b=>b[0]).join(', '), errs.slice(0,2)); }
    if(bad.length) await page.screenshot({path:`s14_fail_${w}x${h}.png`});
    await ctx.close();
  }
  await browser.close();
  console.log(fail?`\nSMOKE14 FAIL（${fail} 個解析度）`:'\nSMOKE14 全部通過（12 種解析度都能開局）');
  process.exit(fail?1:0);
})();

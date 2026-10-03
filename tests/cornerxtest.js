/* 右上角 ✕（ui.cornerClose）：長面板不必捲到最底才關得掉。
   驗收條件：
   1. 人生商城／進修商城／股市（以及其他「底部關閉＝單純收掉」的面板）右上角都有 ✕
   2. 捲到最底時 ✕ 仍在面板可視範圍內（黏頂）
   3. 按 ✕ 跟按底部「關閉」一樣：視窗收掉、遊戲狀態（actionLog）不變
   4. 有實際動作的決策視窗不掛 ✕（不能讓人跳過決定）
   5. 標題不被 ✕ 蓋住
   用法：node tests/cornerxtest.js [index.html 路徑] [截圖資料夾（可省略）]
*/
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const SHOTS = process.argv[3] ? __path.resolve(process.argv[3]) : null;

(async()=>{
  const b=await chromium.launch();
  let pass=0, fail=0;
  const A=(c,m)=>{ if(c) pass++; else { fail++; console.log('FAIL '+m); } };
  const errs=[];

  // 桌機與 iPad 橫向各跑一次（直式會蓋「請轉橫向」）
  for(const vp of [{width:1440,height:900,tag:'pc'},{width:1180,height:820,tag:'ipad'}]){
    const pg=await b.newPage({viewport:{width:vp.width,height:vp.height}});
    pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
    await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(800);
    await pg.evaluate(()=>{
      const ui=ns.ui;
      ui.startCore(4701, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"],
        ["A","B"].map((n,i)=>({name:n,isNPC:false,
          professionId:ns.content.professions[i*5].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
      document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    });

    const panels=[
      ['人生商城', ()=>ns.ui.showMall()],
      ['進修商城', ()=>ns.ui.showSkillMenu(ns.ui.S.players[ns.ui.myId()])],
      ['股市',     ()=>ns.ui.showStockMarket()],
      ['財務明細', ()=>ns.ui.showDetails(ns.ui.S.players[ns.ui.myId()])],
      ['借款',     ()=>ns.ui.showLoanDialog()],
    ];
    for(const [name,open] of panels){
      const r=await pg.evaluate(open=>{
        document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
        const log0=ns.ui.S.actionLog.length;
        (new Function('return ('+open+')'))()();
        const box=document.querySelector('#overlays .sheetbox');
        const x=box && box.querySelector(':scope > .cornerX button');
        const out={has:!!x, scrollable:box.scrollHeight>box.clientHeight+4, log0};
        if(!x) return out;
        box.scrollTop=box.scrollHeight;                     // 捲到最底
        const bb=box.getBoundingClientRect(), xb=x.getBoundingClientRect();
        out.visible = xb.top>=bb.top-1 && xb.bottom<=bb.top+60 && xb.right<=bb.right+1 && xb.left>=bb.left;
        // ✕ 的中心點真的點得到它（沒被別的東西蓋住）
        const hit=document.elementFromPoint(xb.left+xb.width/2, xb.top+xb.height/2);
        out.clickable = hit===x;
        box.scrollTop=0;
        const h=box.querySelector('h2');
        // 整個標題列（標題＋同列的現金／本輪可買之類）的文字都不得跟 ✕ 重疊
        if(h){ const row=h.parentNode!==box ? h.parentNode : h, xr=x.getBoundingClientRect();
          const range=document.createRange(); range.selectNodeContents(row);
          out.titleClear = [...range.getClientRects()].every(tr=>
            tr.width===0 || tr.right<=xr.left+1 || tr.bottom<=xr.top || tr.top>=xr.bottom); }
        return out;
      }, open.toString());
      A(r.has, vp.tag+' '+name+'：右上角應有 ✕');
      if(!r.has) continue;
      A(r.visible, vp.tag+' '+name+'：捲到最底時 ✕ 應仍在面板頂端（scrollable='+r.scrollable+'）');
      A(r.clickable, vp.tag+' '+name+'：✕ 應點得到（沒被蓋住）');
      A(r.titleClear!==false, vp.tag+' '+name+'：標題不應被 ✕ 蓋住');
      if(SHOTS){
        await pg.evaluate(()=>{ const bx=document.querySelector('#overlays .sheetbox'); bx.scrollTop=bx.scrollHeight; });
        await pg.screenshot({path:__path.join(SHOTS,'cornerx_'+vp.tag+'_'+name+'.png')});
      }
      await pg.click('#overlays .cornerX button');
      const after=await pg.evaluate(()=>({n:document.querySelectorAll('#overlays .overlay').length, log:ns.ui.S.actionLog.length}));
      A(after.n===0, vp.tag+' '+name+'：按 ✕ 後視窗應收掉');
      A(after.log===r.log0, vp.tag+' '+name+'：按 ✕ 不得產生任何動作（actionLog '+r.log0+'→'+after.log+'）');
    }

    // 決策視窗（主畫面中央的決定卡、結算畫面等）不應被掛上 ✕
    const dec=await pg.evaluate(()=>document.querySelectorAll('#center .cornerX').length);
    A(dec===0, vp.tag+' 主畫面決策卡不應出現 ✕');
    await pg.close();
  }

  A(errs.length===0, '頁面錯誤：'+errs.join(' | '));
  console.log(JSON.stringify({pass, total:pass+fail}));
  await b.close();
  process.exit(fail?1:0);
})();

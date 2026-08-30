const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror', e=>errs.push('PAGEERROR: '+e.message));
  await pg.goto('file://'+TARGET, {waitUntil:'load'});
  await pg.waitForTimeout(1000);
  const r = await pg.evaluate(() => {
    const ui=ns.ui, E=ns.engine; const log=[];
    function step(n,f){ try{ const d=f(); log.push('OK   '+n+(d?('  '+d):'')); }catch(e){ log.push('FAIL '+n+' :: '+e.message); } }
    const mkP=i=>({name:"P"+i,isNPC:false,professionId:ns.content.professions[i+3].id,dreamCardId:ns.content.dreams[i].id});
    ui.startCore(9911, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"], [mkP(0),mkP(1),mkP(2)], {noRules:true});
    const S=ui.S;
    // 讓 2 號座位財務自由（被動 >= 支出），並輪到他
    const me=S.players[2];
    ns.ledger.post(S,me,"測試：灌被動收入",[{account:"INCOME_PASSIVE",delta:me.derived.totalExpenses+50,label:"x"}],{});
    E.checkFreedom(S,me);
    S.activePlayerIdx=2; S.phase="ROLL"; S.turnResolved=false;

    step('seat0 視角：不該看到 2 號的按鈕', ()=>{
      ui.mp={mode:true, seat:0};
      ui.viewPlayerId=null; ui.renderSheet();
      const t=document.getElementById('sheet').textContent;
      if(/辭職進入自由圈/.test(t)) throw new Error('0 號不該看到 2 號的辭職按鈕');
      return '(對照組正確)';
    });
    step('seat2 視角：財報是自己的，且不顯示「檢視他人」', ()=>{
      ui.mp={mode:true, seat:2};
      ui.viewPlayerId=null; ui.renderSheet();
      const t=document.getElementById('sheet').textContent;
      if(/檢視他人財報中/.test(t)) throw new Error('看自己的財報卻被當成看別人');
      return '';
    });
    step('FF-003a 嚴重 bug 5：seat2 看得到「辭職進入自由圈」且可按', ()=>{
      const btns=[].slice.call(document.getElementById('sheet').querySelectorAll('button'));
      const gb=btns.filter(b=>/辭職進入自由圈/.test(b.textContent))[0];
      if(!gb) throw new Error('按鈕根本沒出現');
      if(gb.disabled) throw new Error('按鈕出現但是停用的');
      return '';
    });
    step('FF-003a 嚴重 bug 6：seat2 看得到「進修」且可按', ()=>{
      const btns=[].slice.call(document.getElementById('sheet').querySelectorAll('button'));
      const sb=btns.filter(b=>/進修（自己找資源）/.test(b.textContent))[0];
      if(!sb) throw new Error('進修按鈕沒出現');
      if(sb.disabled) throw new Error('進修按鈕出現但是停用的');
      return '';
    });
    step('GRADUATE_NOW 真的送得出去且引擎接受', ()=>{
      const r=E.apply(S,{type:"GRADUATE_NOW",playerId:2,payload:null},{mutate:true});
      if(r.rejected){ const w=(r.events||[]).filter(x=>x.type==="ACTION_REJECTED").pop(); throw new Error('被拒：'+(w&&w.reason)); }
      if(S.players[2].playerStage!=="OUTER") throw new Error('沒有進到自由圈');
      return '';
    });
    step('側欄：別人的回合不該寫「你的回合」', ()=>{
      ui.mp={mode:true, seat:0, seatUid:{}, presence:{}}; S.activePlayerIdx=2; ui.renderPlayerCards();
      const pw=document.getElementById('pawns'); const t=pw?pw.textContent:'';
      if(/你的回合/.test(t)) throw new Error('0 號看到別人的回合被標成「你的回合」：'+t.slice(0,120));
      if(!/行動中/.test(t)) throw new Error('別人的回合應標「行動中」，實得：'+t.slice(0,120));
      ui.mp={mode:true, seat:2, seatUid:{}, presence:{}}; ui.renderPlayerCards();
      const t2=document.getElementById('pawns').textContent;
      if(!/你的回合/.test(t2)) throw new Error('2 號自己的回合應標「你的回合」');
      return '';
    });
    step('結算排行榜／戰報的「（你）」跟著座位走', ()=>{
      ui.mp={mode:true, seat:1};
      if(ui.myId()!==1) throw new Error('myId 錯');
      const src=ui.showReport?ui.showReport.toString():'';
      if(/pl\.id===0/.test(src)) throw new Error('戰報仍寫死 0 號');
      return '';
    });
    ui.mp={mode:false, seat:0};
    return log;
  });
  r.forEach(x=>console.log(x));
  console.log(errs.length? ('--- page errors ---\n'+errs.join('\n')) : '--- no page errors ---');
  await b.close();
})();

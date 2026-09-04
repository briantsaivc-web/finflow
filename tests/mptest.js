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
    /* S34：進修入口從右欄財報升到操作區（跟人生商城同一階），這一項跟著改指新按鈕。
       原本要防的 bug 沒變：多人局的 seat2 必須看得到、而且按得下去自己的進修入口。 */
    step('FF-003a 嚴重 bug 6：seat2 看得到操作區的「進修商城」且可按', ()=>{
      ui.renderPlayerCards();
      const sb=document.getElementById('btnSkill');
      if(!sb) throw new Error('操作區沒有進修商城按鈕');
      if(sb.disabled) throw new Error('進修商城按鈕出現但是停用的');
      const why=ui.skillEnrolBlock(S, S.players[2]);
      if(why) throw new Error('輪到 seat2 時不該有阻擋理由，實得：'+why);
      return '';
    });
    step('S34：不能報名的時段，進修商城仍打得開（只是不能執行）', ()=>{
      const keep=S.phase;
      try{
        S.phase='RESOLVE';
        const why=ui.skillEnrolBlock(S, S.players[2]);
        if(!why) throw new Error('決策未處理完時應該有阻擋理由');
        ui.renderPlayerCards();
        const sb=document.getElementById('btnSkill');
        if(sb.disabled) throw new Error('阻擋理由不該讓按鈕停用——玩家要趁空檔研究內容');
        document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
        ui.showSkillMenu(S.players[2]);
        const ov=document.querySelector('#overlays .overlay');
        if(!ov) throw new Error('面板應該打得開');
        if(!/現在只能看/.test(ov.textContent)) throw new Error('表頭要說明現在只能看');
        const rows=[].slice.call(ov.querySelectorAll('button.opt'));
        const live=rows.filter(b=>!b.disabled && /・/.test(b.textContent));
        if(live.length) throw new Error('不能報名時所有技能列都該停用，實得 '+live.length+' 列可按');
        return '面板開得了、'+rows.length+' 列全停用';
      } finally {
        // 不論成敗都要把階段還原，否則污染後面的測項（這正是上一版踩到的坑）
        document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
        S.phase=keep;
      }
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

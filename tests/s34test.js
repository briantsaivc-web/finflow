const { chromium } = require('playwright');
/* S34 實測回饋三項：
     ① 進修商城拉到操作區，跟人生商城同一階（原本埋在人生商城裡面，玩家不會想到要先點「買東西」）
     ② 右欄不再列「已具備：…」——那份清單在進修商城與技能證書牆都看得到，右欄再列一次只是佔位置
     ③ 不能進修的時段面板照樣打得開（玩家會趁空檔研究內容），只是每一列都按不下去
   用法（repo 根目錄）： node tests/s34test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    const MODS=["M1","M2","M3","M4","M6","M8"];
    const four=["我","阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id}));
    const fresh=(seed,ov)=>{ const c=util.clone(cfg); if(ov) Object.keys(ov).forEach(k=>c[k]=ov[k]);
      ui.startCore(seed||3400, c, MODS, four, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");
    const give=(p,id)=>{ p.skills[id]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const sheetTxt=()=>{ ui.renderSheet(); return document.getElementById('sheet').textContent; };
    const opsBtn=()=>document.getElementById('btnSkill');

    /* ---------- ① 進修商城與人生商城同一階 ---------- */
    step("操作區有進修商城按鈕，且與人生商城是同一層的兄弟節點",()=>{
      const S=fresh(3401);
      const grid=document.getElementById("opsGrid");
      A(grid,"缺 #opsGrid");
      const sk=document.getElementById("btnSkill"), mall=document.getElementById("btnMall");
      A(sk,"缺 #btnSkill");
      A(sk.parentNode===grid && mall.parentNode===grid,"兩顆必須是操作區同一層的兄弟節點");
      A(sk.className===mall.className,"樣式階級要一致，實得 "+sk.className+" vs "+mall.className);
      A(sk.previousElementSibling===mall || mall.previousElementSibling===sk,"兩顆應該相鄰");
      return "#btnSkill 與 #btnMall 同層同級且相鄰";
    });
    step("人生商城裡面不再有進修入口（證書牆留著，兩邊都進得去）",()=>{
      const S=fresh(3402), p=S.players[0]; cashTo(S,p,900);
      close(); ui.showMall();
      const ov=document.querySelector('#overlays .overlay');
      const btns=[].slice.call(ov.querySelectorAll('button'));
      A(!btns.some(b=>/進修商城/.test(b.textContent)),"人生商城裡不該再有進修商城按鈕");
      A(btns.some(b=>/技能證書牆/.test(b.textContent)),"證書牆應該留在人生商城");
      close(); ui.showSkillMenu(p);
      const ov2=document.querySelector('#overlays .overlay');
      A(/技能證書牆/.test(ov2.textContent),"進修商城的表頭也要有證書牆入口（兩邊都有）");
      close();
      return "商城只剩證書牆；進修商城表頭仍有證書牆";
    });
    step("按鈕真的打得開進修商城",()=>{
      const S=fresh(3403); close();
      opsBtn().click();
      const ov=document.querySelector('#overlays .overlay');
      A(ov && /進修商城/.test(ov.textContent),"按下去應該開出進修商城");
      close();
      return "click → 進修商城";
    });
    step("本局沒開進修時，按鈕停用並說明原因（不是消失）",()=>{
      const S=fresh(3404,{skillPerGame:0});
      const sk=opsBtn();
      A(sk,"按鈕不該消失");
      A(sk.disabled===true,"沒開進修時應停用");
      A(/未開啟/.test(sk.title||""),"要說明原因，實得 "+sk.title);
      return "停用＋"+sk.title;
    });

    /* ---------- ② 右欄不再佔位置 ---------- */
    step("沒在進修時，右欄完全不出現「學習與準備」那一區",()=>{
      const S=fresh(3405), p=S.players[0];
      give(p,"SKL_CPR"); give(p,"SKL_LAW");
      p.learning=null; p.skillCooldownUntil=0;
      const t=sheetTxt();
      A(!/學習與準備/.test(t),"沒在進修就不該有這一區");
      A(!/已具備/.test(t),"右欄不該再列「已具備：…」");
      A(!/進修（自己找資源）/.test(t),"右欄的進修按鈕已升到操作區，不該還在");
      A(!document.querySelector('#sheet [data-tut="learn"]'),"連錨點節點都不該留下佔位");
      return "兩張技能在手，右欄零佔位";
    });
    step("已具備的技能在進修商城與證書牆都查得到（不是被刪掉，是搬家）",()=>{
      const S=fresh(3406), p=S.players[0];
      give(p,"SKL_CPR");
      close(); ui.showSkillWall(p.id);
      const w=document.querySelector('#overlays .overlay');
      A(/急救 CPR/.test(w.textContent),"證書牆應該看得到");
      close(); ui.showSkillMenu(p);
      const m=document.querySelector('#overlays .overlay');
      A(/技能證書牆（1）/.test(m.textContent),"進修商城的表頭要顯示張數");
      close();
      return "證書牆看得到、進修商城表頭顯示 1 張";
    });
    step("正在進修時，右欄那一區要回來（含進度條與放棄）",()=>{
      const S=fresh(3407), p=S.players[0];
      cashTo(S,p,900);
      E.startLearning(S,p,ns.content.byId["SKL_CPR"],false);
      A(p.learning,"測試前提：應進入學習中");
      const t=sheetTxt();
      A(/學習與準備/.test(t),"正在進修就要看得到");
      A(/急救 CPR/.test(t),"要顯示學的是哪一門");
      A(/放棄學習/.test(t),"要有放棄的出口");
      A(document.querySelector('#sheet [data-tut="learn"]'),"教學錨點在這個狀態下要存在");
      return "進度條與放棄按鈕都在";
    });
    step("剛學完的冷卻期也要出現（那是會過去的狀態，不是常駐清單）",()=>{
      const S=fresh(3408), p=S.players[0];
      p.learning=null; p.skillCooldownUntil=S.turnNumber+3;
      const t=sheetTxt();
      A(/休息 3 輪後/.test(t),"應顯示剩餘冷卻輪數");
      A(!/已具備/.test(t),"冷卻中也不該列已具備清單");
      return "顯示剩 3 輪";
    });

    /* ---------- ③ 不能進修的時段仍可瀏覽 ---------- */
    step("阻擋判斷與操作區共用同一份（按鈕的 title 就是面板的理由）",()=>{
      const S=fresh(3409), p=S.players[0];
      cashTo(S,p,900);
      A(ui.skillEnrolBlock(S,p)==="","自己的回合、ROLL 階段應該可以報名，實得 "+ui.skillEnrolBlock(S,p));
      S.phase="RESOLVE";
      const why=ui.skillEnrolBlock(S,p);
      A(why && /決策或記帳/.test(why),"未處理完決策時要擋，實得 "+why);
      ui.renderPlayerCards();
      A(opsBtn().disabled===false,"擋的是報名，不是瀏覽——按鈕不該停用");
      A(opsBtn().title===why,"按鈕的 title 應與面板理由同一份");
      S.phase="ROLL";
      return why;
    });
    step("不是自己的回合：面板打得開、表頭寫「現在只能看」、每一列都停用",()=>{
      const S=fresh(3410), p=S.players[0];
      cashTo(S,p,900);
      S.activePlayerIdx=1;
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      A(ov,"面板要打得開");
      A(/現在只能看/.test(ov.textContent),"表頭要說明現在只能看");
      A(/不是你的操作時機/.test(ov.textContent),"要說出是哪一種阻擋");
      const rows=[].slice.call(ov.querySelectorAll('button.opt')).filter(x=>/・/.test(x.textContent));
      A(rows.length>=10,"技能列不該因此消失，實得 "+rows.length);
      A(rows.every(x=>x.disabled),"每一列都要停用");
      close();
      return rows.length+" 列全部可見但停用";
    });
    step("學習中打開進修商城：看得到全部課程，但一列都按不下去",()=>{
      const S=fresh(3411), p=S.players[0];
      cashTo(S,p,900);
      E.startLearning(S,p,ns.content.byId["SKL_CPR"],false);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      A(/現在只能看/.test(ov.textContent),"學習中也要說明只能看");
      A(/正在進修/.test(ov.textContent),"理由要是「正在進修」");
      const rows=[].slice.call(ov.querySelectorAll('button.opt')).filter(x=>/・/.test(x.textContent));
      A(rows.length>=10 && rows.every(x=>x.disabled),"課程要看得到但按不下去");
      close();
      return rows.length+" 列可見、全停用";
    });
    step("可以報名的時候，付得起又有先修的那些列必須是可按的（別把大家一起關掉）",()=>{
      const S=fresh(3412), p=S.players[0];
      cashTo(S,p,3000);
      A(ui.skillEnrolBlock(S,p)==="","測試前提：此刻應可報名");
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      A(!/現在只能看/.test(ov.textContent),"可以報名時不該出現只能看的提示");
      const rows=[].slice.call(ov.querySelectorAll('button.opt')).filter(x=>/・/.test(x.textContent));
      const live=rows.filter(x=>!x.disabled);
      A(live.length>0,"至少要有一列可按，實得 0");
      close();
      return rows.length+" 列中 "+live.length+" 列可按";
    });
    step("互動教學的第 13 步指向新的入口（舊錨點常態不存在，會指到空的）",()=>{
      const S=fresh(3413), p=S.players[0];
      p.learning=null; p.skillCooldownUntil=0; ui.renderSheet();
      const steps=(ns.tutorial&&ns.tutorial.STEPS)||(ns.tut&&ns.tut.STEPS)||null;
      A(steps,"取不到教學步驟表");
      const s13=steps.filter(x=>x.n===13)[0];
      A(s13,"缺第 13 步");
      A(s13.anchor==="#btnSkill","錨點應改指 #btnSkill，實得 "+s13.anchor);
      A(document.querySelector(s13.anchor),"錨點在常態畫面下必須找得到");
      return s13.title+" → "+s13.anchor;
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  const pass=log.filter(l=>l.startsWith('OK')).length, fail=log.filter(l=>l.startsWith('FAIL')).length;
  if(errs.length) errs.slice(0,5).forEach(e=>console.log(e));
  console.log(JSON.stringify({pass,fail,pageErrors:errs.length}));
  await b.close();
  process.exit(fail||errs.length?1:0);
})();

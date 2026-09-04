const { chromium } = require('playwright');
/* S31 第一批驗收：多人殘留清理 ＋ 辭職按鈕固定。
   設計意圖：
     ① 多人局玩完不重整、直接開單機，不能有任何殘留（座位、dispatch 路徑、訂閱、心跳）
     ② 辭職／重返固定在自由進度條下面，永遠佔位——不達標是暗色停用，不是整塊消失
   用法（repo 根目錄）： node tests/s31test.js */
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
    const fresh=(seed,opts)=>{ ui.startCore(seed||3101, util.clone(cfg), MODS, four, opts||{noRules:true}); close(); return ui.S; };

    /* ---------- ① 多人殘留 ---------- */
    step("多人局玩完直接開單機：座位、模式、心跳、adapter 全部要清乾淨",()=>{
      let closed=0, hb=0;
      // 假裝上一局是多人局：座位 2、adapter 還在、心跳還在跑
      ui.mp = { mode:true, seat:2, code:"XYZ", uid:"u1", host:true,
                adapter:{ close:function(){ closed++; } },
                _hb:setInterval(function(){ hb++; },100000), meta:{}, setup:{}, replaying:false };
      A(ui.myId()===2,"測試前提：多人局的 myId 應為座位 2，實得 "+ui.myId());
      fresh(3101);
      A(ui.mp.mode===false,"開單機後 mode 應為 false，實得 "+ui.mp.mode);
      A(ui.myId()===0,"開單機後 myId 應回到 0，實得 "+ui.myId());
      A(ui.mp.adapter===null,"adapter 應被清掉");
      A(closed===1,"應呼叫 adapter.close() 一次，實得 "+closed);
      A(ui.mp._hb===null,"心跳應被清掉");
      A(ui.mp.seatUid===null && ui.mp.code===null,"房間資訊應一併清乾淨");
      return "座位 2 → 0、adapter 已關、心跳已停";
    });
    step("多人開局要保留 ui.mp（不能被自己的清理誤殺）",()=>{
      ui.mp={ mode:true, seat:1, code:"AAA", uid:"u9", host:false, adapter:null, _hb:null };
      ui.startCore(3102, util.clone(cfg), MODS, four, {noRules:true, mp:true});
      close();
      A(ui.mp.mode===true && ui.mp.seat===1,"帶 mp:true 時不該被清掉，實得 mode="+ui.mp.mode+" seat="+ui.mp.seat);
      ui.resetMultiplayer();               // 收尾，不影響後面的測試
      return "mp:true 時保留座位 1";
    });
    step("清理是冪等的：連續開兩局單機不會炸",()=>{
      fresh(3103); fresh(3104);
      A(ui.mp.mode===false && ui.myId()===0,"連開兩局仍應是乾淨的單機狀態");
      return "連開兩局 OK";
    });

    /* ---------- ② 辭職按鈕固定 ---------- */
    const findGrad=()=>Array.from(document.querySelectorAll('#right button, #app button'))
        .filter(b=>/辭職進入自由圈/.test(b.textContent))[0];
    const findBack=()=>Array.from(document.querySelectorAll('#right button, #app button'))
        .filter(b=>/重返職場/.test(b.textContent))[0];
    step("還沒財務自由：按鈕仍然在，但是暗色停用",()=>{
      const S=fresh(3105), p=S.players[0];
      p.financiallyFree=false; ui.render();
      const gb=findGrad();
      A(gb,"沒達標時按鈕也必須存在（原本整塊會消失，底下版面會往上跳）");
      A(gb.disabled===true,"沒達標時應停用");
      return "存在且停用";
    });
    step("財務自由之後：同一顆按鈕就地變成可按（位置不動）",()=>{
      const S=fresh(3106), p=S.players[0];
      p.financiallyFree=false; ui.render();
      const before=findGrad(); const parentBefore=before.parentNode.parentNode;
      p.financiallyFree=true; ui.render();
      const after=findGrad();
      A(after && after.disabled===false,"達標後應可按");
      A(after.parentNode.parentNode.className===parentBefore.className,
        "位置不該換區塊，實得 "+after.parentNode.parentNode.className);
      return "同一個容器（"+after.parentNode.parentNode.className+"），只是從停用變可按";
    });
    step("按鈕掛在自由進度條那一塊裡（不是浮在資產細項上面）",()=>{
      const S=fresh(3107), p=S.players[0];
      p.financiallyFree=true; ui.render();
      const gb=findGrad();
      let n=gb, hit=false;
      while(n && n!==document.body){ if(n.className==="freedom"){ hit=true; break; } n=n.parentNode; }
      A(hit,"辭職按鈕應該在 .freedom 區塊內");
      return "掛在 .freedom 內";
    });
    step("外圈時同一個位置換成「重返職場」，一樣固定",()=>{
      const S=fresh(3108), p=S.players[0];
      p.playerStage="OUTER"; ui.render();
      const rb=findBack();
      A(rb,"外圈應有重返職場按鈕");
      let n=rb, hit=false;
      while(n && n!==document.body){ if(n.className==="freedom"){ hit=true; break; } n=n.parentNode; }
      A(hit,"重返職場按鈕也應該在 .freedom 區塊內");
      A(!findGrad(),"外圈不該同時出現辭職按鈕");
      return "外圈換成重返、同樣固定在 .freedom";
    });
    step("沒達標時要寫出「還差多少」——這比原本什麼都不顯示更有用",()=>{
      const S=fresh(3109), p=S.players[0];
      p.financiallyFree=false; ui.render();
      const fr=document.querySelector('.freedom');
      A(/還差/.test(fr.textContent),"應該寫出還差多少，實得 "+fr.textContent.slice(0,120));
      return "有寫出缺口";
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

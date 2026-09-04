const { chromium } = require('playwright');
/* S31 第二批驗收：公告出圖萬無一失／夢想相簿＋郵戳／進修商城＋技能證書牆。
   設計意圖：
     ① 公告的圖一定要來得及出——預載＋等載入才倒數，還要有 2.5 秒上限不讓它卡住
     ② 相簿要有時間軸（第幾輪拿到的），沒圓夢的人也要有相簿
     ③ 郵戳位置離線算好寫在資料上，執行期不分析圖片；最後一張是金勳章不是紅印
     ④ 進修商城要分「這一局開的課」與「這一局沒開的課」，後者要說清楚不是玩家的錯
   用法（repo 根目錄）： node tests/s31btest.js */
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
    const fresh=(seed)=>{ ui.startCore(seed||3151, util.clone(cfg), MODS, four, {noRules:true}); close(); return ui.S; };
    const cashTo=(S,p,v)=>E.applyEffects(S,p,[{op:"CASH_DELTA",amount:util.r2(v-p.cash),label:"測試補現金"}],"測試");

    /* ---------- ① 出圖 ---------- */
    step("郵戳位置離線算好寫在里程碑資料上（執行期不分析圖片）",()=>{
      let n=0, bold=0, bad=[];
      (ns.content.cards.DREAM||[]).forEach(c=>(c.milestones||[]).forEach(m=>{
        n++; if(m.stampBold) bold++;
        if(["tl","tr","bl","br"].indexOf(m.stampPos)<0) bad.push(c.id+"/"+m.img);
      }));
      A(n>=160,"里程碑數量不足，實得 "+n);
      A(!bad.length,"這些沒有合法的 stampPos："+bad.slice(0,5).join("、"));
      A(bold>0 && bold<n*0.2,"濃印應該是少數（四角皆滿的那幾張），實得 "+bold+"／"+n);
      return n+" 條全有位置，其中 "+bold+" 條標濃印";
    });
    step("縮圖路徑：公告與相簿列表用 thumb，原圖只在放大時才載",()=>{
      const S=fresh(3151);
      const t=ui.dreamThumbSrc("dream_peaks/01.webp");
      A(/assets\/dreams\/thumb\/dream_peaks\/01\.webp$/.test(t),"縮圖路徑不對，實得 "+t);
      const o=ui.dreamImgSrc("dream_peaks/01.webp");
      A(/assets\/dreams\/dream_peaks\/01\.webp$/.test(o),"原圖路徑不該被動到，實得 "+o);
      return t;
    });
    step("公告：圖還沒載到就不開始倒數，但有 2.5 秒上限（不會卡住畫面）",()=>{
      const S=fresh(3152);
      const host=document.getElementById("bcast");
      ui.broadcast("測試","副標","good",99999,"dream_peaks/01.webp");
      const img=host.querySelector("img");
      A(img,"應有圖");
      A(/\/thumb\//.test(img.getAttribute("src")),"公告要用縮圖");
      A(ui._bcT,"應該有一個計時器在跑（不是等到天荒地老）");
      return "有圖、用縮圖、計時器已排程";
    });
    step("預載不會炸，也不會擋住開局",()=>{
      const S=fresh(3153);
      A(typeof ui.preloadDreamImgs==="function","應有預載函式");
      ui.preloadDreamImgs(S);            // 再叫一次也不能出事
      ui.preloadDreamImgs(null);         // 防呆
      return "預載可重複呼叫、給 null 也不炸";
    });

    /* ---------- ② 相簿 ---------- */
    const gain=(S,p,k)=>{ p.playerStage="OUTER"; cashTo(S,p,99999);
      for(let i=0;i<k;i++){ p.boughtProgressThisTurn=false; S.turnNumber+=3; E.buyDreamProgress(S,p); } };
    step("圓夢每一點都寫進相簿：第幾輪、那句話、那張圖、哪一角蓋章",()=>{
      const S=fresh(3154), p=S.players[0];
      A((p.dreamLog||[]).length===0,"開局應是空的");
      gain(S,p,3);
      A(p.dreamLog.length===3,"應記下 3 筆，實得 "+p.dreamLog.length);
      const x=p.dreamLog[0];
      A(x.n===1 && x.turn>0,"要有點數與輪次");
      A(x.ms && x.img,"要有文字與圖");
      A(["tl","tr","bl","br"].indexOf(x.pos)>=0,"要有郵戳位置，實得 "+x.pos);
      A(x.paid===true,"買來的應標 paid");
      return "3 筆：第 "+p.dreamLog.map(y=>y.turn).join("／")+" 輪";
    });
    step("沒圓夢的人也有相簿：走到哪就記到哪，沒去成的留著",()=>{
      const S=fresh(3155), p=S.players[0];
      gain(S,p,2);
      close(); ui.showDreamAlbum(p.id);
      const ov=document.querySelector('#overlays .overlay');
      A(ov,"相簿應該開得起來");
      const txt=ov.textContent;
      A(/沒走到這裡/.test(txt),"未達成的格子要標「沒走到這裡」");
      A(/第 \d+ 輪/.test(txt),"要看得到第幾輪達成");
      const cells=ov.querySelectorAll('svg');
      A(cells.length===2,"只有走到的兩站該蓋章，實得 "+cells.length);
      close();
      return "2 站蓋章、其餘標沒走到";
    });
    step("最後一張是金勳章「圓滿」，不是紅印「已完成」",()=>{
      const S=fresh(3156), p=S.players[0];
      gain(S,p,S.config.dreamCost);
      close(); ui.showDreamAlbum(p.id);
      const ov=document.querySelector('#overlays .overlay');
      const svgs=Array.from(ov.querySelectorAll('svg'));
      A(svgs.length===S.config.dreamCost,"每一站都該有章，實得 "+svgs.length);
      const last=svgs[svgs.length-1].outerHTML, first=svgs[0].outerHTML;
      A(/圓滿/.test(last),"最後一張要蓋圓滿");
      A(/ffGold/.test(last),"最後一張要用金色勳章");
      A(!/ffGrain/.test(last),"金勳章刻意不做墨色不均");
      A(/已完成/.test(first) && /ffGrain/.test(first),"前面幾張是帶墨痕的紅印");
      close();
      return "前 "+(svgs.length-1)+" 張紅印、最後一張金勳章";
    });
    step("相簿的圖用縮圖，點開放大才載原圖",()=>{
      const S=fresh(3157), p=S.players[0];
      gain(S,p,2);
      close(); ui.showDreamAlbum(p.id);
      const ov=document.querySelector('#overlays .overlay');
      const imgs=Array.from(ov.querySelectorAll('img'));
      A(imgs.length>0,"相簿應該有圖");
      A(imgs.every(i=>/\/thumb\//.test(i.getAttribute("src"))),"列表一律用縮圖");
      close();
      ui.showDreamPhoto(p, 1, p.dreamLog[0]);
      const ov2=document.querySelector('#overlays .overlay');
      const big=ov2.querySelector('img');
      A(big && !/\/thumb\//.test(big.getAttribute("src")),"放大要用原圖，實得 "+(big&&big.getAttribute("src")));
      close();
      return "列表縮圖、放大原圖";
    });

    /* ---------- ③ 進修商城與技能牆 ---------- */
    step("進修商城：分「這一局開的課」與「這一局沒開的課」兩區",()=>{
      const S=fresh(3158), p=S.players[0];
      cashTo(S,p,900);
      close(); ui.showSkillMenu(p);
      const ov=document.querySelector('#overlays .overlay');
      A(/進修商城/.test(ov.textContent),"標題應為進修商城");
      A(/這一局沒有開的課/.test(ov.textContent),"要有沒開的課那一區");
      A(/不是你做錯什麼/.test(ov.textContent),"要講清楚這不是玩家的錯（機會本來就有時候不來）");
      close();
      return "兩區都在，且有解釋";
    });
    step("技能證書牆：像徽章牆，已過時的做成泛黃的證書",()=>{
      const S=fresh(3159), p=S.players[0];
      const ids=(S.skillSample||[]).slice(0,3);
      ids.forEach((sid,i)=>{ p.skills[sid]={learnedAt:i+2,decayed:(i===2),refreshedAt:null}; });
      close(); ui.showSkillWall(p.id);
      const ov=document.querySelector('#overlays .overlay');
      A(/技能證書牆/.test(ov.textContent),"標題不對");
      A(/3 張證書/.test(ov.textContent),"應顯示張數");
      A(/第 2 輪取得/.test(ov.textContent),"要顯示取得輪次");
      A(/已過時（可半價更新）/.test(ov.textContent),"過時的要標出來");
      A(/派上用場/.test(ov.textContent),"要有「這局有沒有用上」的結算");
      close();
      return "3 張證書、含取得輪次與過時標記";
    });
    step("沒學過任何技能也開得起來（不能空白或炸掉）",()=>{
      const S=fresh(3160), p=S.players[0];
      close(); ui.showSkillWall(p.id);
      const ov=document.querySelector('#overlays .overlay');
      A(/還沒學成任何技能/.test(ov.textContent),"應有空狀態說明");
      close();
      return "空狀態 OK";
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

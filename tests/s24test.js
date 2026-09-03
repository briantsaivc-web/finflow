const { chromium } = require('playwright');
/* S24 驗收：夢想里程碑改成「備一池、每局抽 dreamCost 條」＋ 里程碑配圖（外部檔案、可覆蓋）。
   重點在三件事：
     ①【相容鐵律】池子只有剛好 dreamCost 條時，原序照用且不取用亂數（現行 8×5 資料的行為不變）
     ②抽的是「哪五條」，不是順序——里程碑本身有敘事先後，抽完要依原順序排
     ③圖是外部檔案：載不到就自己移除，退回純文字。單檔離線遊玩不能因此壞掉
   用法（repo 根目錄）： node tests/s24test.js  或  node tests/s24test.js path/to/index.html */
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
    const cfg=ns.buildConfig(ns.configRegistry); cfg.depthLevel=3;
    const MODS=["M1","M2","M3","M4","M6","M8"];
    const players=[{name:"我",isNPC:false,professionId:ns.content.professions[3].id,dreamCardId:ns.content.dreams[0].id},
                   {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}];
    const fresh=(seed,over)=>{ const c=util.clone(cfg); if(over) Object.assign(c,over);
      ui.startCore(seed||2401, c, MODS, players, {noRules:true}); close(); return ui.S; };

    /* 測試用：暫時把某個夢想的池子換成 20 條（含圖），跑完還原。
       刻意不動 base.json——真正的 160 條內容之後才會進來，測試不該先卡位。 */
    const withPool=(dreamId, n, fn)=>{
      const dr=ns.content.byId[dreamId], keep=dr.milestones;
      dr.milestones=[];
      for(let i=1;i<=n;i++) dr.milestones.push({ t:"第 "+i+" 條里程碑：測試用敘事",
        img: (i%3===0) ? null : (dreamId+"_"+String(i).padStart(2,"0")+".webp") });
      try{ return fn(dr); } finally { dr.milestones=keep; }
    };

    step("內容：8 個夢想 × 各 20 條里程碑，每條都有標題與圖",()=>{
      const ds=ns.content.dreams;
      A(ds.length===8,"應有 8 個夢想，實得 "+ds.length);
      let n=0, withImg=0;
      ds.forEach(d=>{
        A((d.milestones||[]).length===20, d.name+" 應有 20 條里程碑，實得 "+(d.milestones||[]).length);
        d.milestones.forEach(m=>{ n++; if(E.msImg(m)) withImg++; });
      });
      A(n===160,"總共應有 160 條，實得 "+n);
      A(withImg===160,"160 條都應配圖，實得 "+withImg);
      return "160 條／160 張圖";
    });

    step("⚠️ 相容鐵律：池子剛好 dreamCost 條時，原序照用且【不取用亂數】",()=>{
      /* 這條斷了的話，所有既有局的牌序都會偏掉，「開關全關要能重現基線」當場就斷。
         200 局 MD5 的比對在 CI 之外跑，這裡把因果直接釘在單元層。 */
      const S=fresh(2402);
      const keep={};
      ns.content.dreams.forEach(d=>{ keep[d.id]=d.milestones; d.milestones=d.milestones.slice(0,5); });
      try{
        const rng0=S.rngState;
        E.rollDreamRoutes(S);
        A(S.rngState===rng0,"池子不夠抽時不得消耗亂數，實得 rngState 改變");
        ns.content.dreams.forEach(d=>{
          const r=S.dreamRoutes[d.id];
          A(r && r.length===5,d.name+" 路線長度不對");
          A(r.join()===r.map((_,i)=>i).join(),d.name+" 應原序照用，實得 "+r.join());
        });
        // 第 n 點 → 第 n 條，與 V11 完全一樣
        const me=S.players[0], dr=ns.content.byId[me.dreamCardId];
        for(let i=1;i<=5;i++)
          A(E.dreamMilestone(S,me,i)===E.msText(dr.milestones[i-1]),"第 "+i+" 點應仍對應第 "+i+" 條");
      } finally { ns.content.dreams.forEach(d=>{ d.milestones=keep[d.id]; }); }
      return "零亂數消耗";
    });

    step("抽選：池子 20 條時抽 5 條，且依原敘事順序排",()=>{
      const S=fresh(2403);
      withPool("DREAM_PEAKS",20,()=>{
        E.rollDreamRoutes(S);
        const r=S.dreamRoutes.DREAM_PEAKS;
        A(r.length===5,"應抽 5 條，實得 "+r.length);
        A(new Set(r).size===5,"不得重複");
        r.forEach(i=>A(i>=0&&i<20,"索引應在 0–19，實得 "+i));
        const sorted=r.slice().sort((a,b)=>a-b);
        A(r.join()===sorted.join(),"抽的是【哪五條】不是順序——必須依原順序排，實得 "+r.join());
      });
      return "5/20 且已排序";
    });

    step("抽選：不同種子抽出不同路線；同種子完全重現",()=>{
      const routes=(seed)=>{ const S=fresh(seed); let out=null;
        withPool("DREAM_PEAKS",20,()=>{ E.rollDreamRoutes(S); out=S.dreamRoutes.DREAM_PEAKS.join(); });
        return out; };
      const seen={};
      for(let s=2410;s<2430;s++) seen[routes(s)]=1;
      A(Object.keys(seen).length>=8,"20 個種子應抽出多種路線（才不會每局都一樣），實得 "+Object.keys(seen).length+" 種");
      A(routes(2411)===routes(2411),"同種子必須完全重現（重放決定論）");
      return Object.keys(seen).length+" 種路線／20 個種子";
    });

    step("最後一點釘住池子的收尾（集滿那一刻要是「完成」的節點）",()=>{
      for(let seed=2440;seed<2460;seed++){
        const S=fresh(seed);
        ns.content.dreams.forEach(d=>{
          const r=S.dreamRoutes[d.id];
          A(r[r.length-1]===d.milestones.length-1,
            d.name+" 的最後一點應釘在池子最後一條，實得 "+r.join());
        });
      }
      // 關掉開關就完全隨機（沙盒可調）
      let pinned=0;
      for(let seed=2460;seed<2500;seed++){
        const S=fresh(seed,{dreamRoutePinFinale:0});
        if(S.dreamRoutes.DREAM_PEAKS.slice(-1)[0]===19) pinned++;
      }
      A(pinned<40,"關掉開關後不該每次都釘在最後一條，實得 "+pinned+"/40");
      return "20 個種子都釘住";
    });

    step("里程碑吃兩種格式：純字串（舊）與 {t,img}（新）",()=>{
      A(E.msText("純字串")==="純字串","字串應原樣回傳");
      A(E.msImg("純字串")===null,"字串沒有圖");
      A(E.msText({t:"物件",img:"x.webp"})==="物件","物件應取 t");
      A(E.msImg({t:"物件",img:"x.webp"})==="x.webp","物件應取 img");
      A(E.msText(null)==="" && E.msImg(null)===null,"空值不得炸");
      // 混在同一個池子裡也要正常
      const S=fresh(2404), dr=ns.content.byId.DREAM_PEAKS, keep=dr.milestones;
      dr.milestones=["舊格式一",{t:"新格式二",img:"a.webp"},"舊格式三",{t:"新格式四",img:"b.webp"},"舊格式五"];
      try{
        E.rollDreamRoutes(S);
        const me=S.players[0]; me.dreamCardId="DREAM_PEAKS";
        A(E.dreamMilestone(S,me,1)==="舊格式一" && E.dreamMilestoneImg(S,me,1)===null,"第 1 點：舊格式");
        A(E.dreamMilestone(S,me,2)==="新格式二" && E.dreamMilestoneImg(S,me,2)==="a.webp","第 2 點：新格式帶圖");
      } finally { dr.milestones=keep; }
      return "兩種並存";
    });

    step("舊存檔沒有 dreamRoutes 時，退回 V11 的寫死對應（不得空白）",()=>{
      const S=fresh(2405), me=S.players[0];
      delete S.dreamRoutes;                       // 模擬 S24 之前的存檔
      const dr=ns.content.byId[me.dreamCardId];
      for(let i=1;i<=5;i++)
        A(E.dreamMilestone(S,me,i)===E.msText(dr.milestones[i-1]),"第 "+i+" 點應退回舊對應");
      return "有退路";
    });

    step("圖片路徑：走 dreamImageBase，且擋得掉跳出目錄",()=>{
      const S=fresh(2406);
      A(ui.assetBase()==="assets/dreams/","預設資料夾，實得 "+ui.assetBase());
      A(ui.dreamImgSrc("dream_peaks/01.webp")==="assets/dreams/dream_peaks/01.webp","應接上資料夾（圖是分子資料夾放的）");
      A(ui.dreamImgSrc("../../etc/passwd")===null,"不得接受跳出目錄");
      A(ui.dreamImgSrc("a\\b.webp")===null,"不得接受反斜線");
      A(ui.dreamImgSrc("https://x.test/a.webp")==="https://x.test/a.webp","整串網址原樣放行");
      A(ui.dreamImgSrc(null)===null && ui.dreamImgSrc("")===null,"空值不得炸");
      // 可改資料夾（沙盒調參／換一整包圖）
      const S2=fresh(2407,{dreamImageBase:"pics/v2"});
      A(ui.assetBase()==="pics/v2/","可改資料夾並自動補斜線，實得 "+ui.assetBase());
      return "預設 assets/dreams/";
    });

    step("⚠️ 圖載不到就退回純文字：單檔離線遊玩不得因此壞掉",()=>{
      const im=ui.dreamImgEl("這個檔案一定不存在_zzz.webp");
      A(im,"應先建出 <img>");
      const host=document.createElement("div"); host.appendChild(im);
      A(host.children.length===1,"掛上去時應該在");
      im.onerror();                                // 模擬 404
      A(host.children.length===0,"載不到就要把自己移除（畫面回到純文字）");
      A(ui.dreamImgEl(null)===null,"沒有圖檔名時不該建出任何元素");
      return "onerror 會自我移除";
    });

    step("全服公告：有圖就帶圖，沒圖就是原本的樣子",()=>{
      const S=fresh(2408);
      const host=document.getElementById("bcast");
      A(host,"應有公告容器");
      ui.broadcast("測試標題","測試副標","good",99999);
      A(host.querySelectorAll("img").length===0,"沒帶圖時不該有 <img>（維持原樣）");
      A(/測試標題/.test(host.textContent),"文字照常");
      ui.broadcast("配圖標題","配圖副標","good",99999,"dream_peaks/01.webp");
      const img=host.querySelector("img");
      A(img,"帶圖時應有 <img>");
      A(/assets\/dreams\/dream_peaks\/01\.webp$/.test(img.getAttribute("src")),"src 應指向資料夾，實得 "+img.getAttribute("src"));
      A(img.previousSibling===null,"圖應排在標題【上方】");
      A(/配圖標題/.test(host.textContent),"文字仍要在（圖是加分，不是取代）");
      host.innerHTML="";
      return "圖在標題上方";
    });

    step("圓夢事件帶得出圖：DREAM_PROGRESS 應有 milestoneImg 欄位",()=>{
      const S=fresh(2409), me=S.players[0];
      const dr=ns.content.byId[me.dreamCardId], keep=dr.milestones;
      dr.milestones=[{t:"第一步",img:"X_01.webp"},"第二步","第三步","第四步","第五步"];
      try{
        E.rollDreamRoutes(S);
        me.cash=99999; S.phase="ROLL"; S.currentPlayer=0; me.boughtProgressThisTurn=false;
        E._events.length=0;
        E.buyDreamProgress(S,me);
        const ev=E._events.filter(e=>e.type==="DREAM_PROGRESS")[0];
        A(ev,"應發出 DREAM_PROGRESS");
        A(ev.milestone==="第一步","應帶出里程碑文字，實得 "+ev.milestone);
        A(ev.milestoneImg==="X_01.webp","應帶出圖檔名，實得 "+ev.milestoneImg);
      } finally { dr.milestones=keep; }
      return "事件帶得出圖";
    });

    step("內容守門：里程碑數量、空字串、圖檔名格式",()=>{
      const bad=[];
      ns.content.dreams.forEach(d=>{
        (d.milestones||[]).forEach((m,i)=>{
          const t=E.msText(m), g=E.msImg(m);
          if(!t || t.length<4) bad.push(d.id+"["+i+"] 文字太短或空白");
          if(g!==null && !/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(webp|jpg|jpeg|png)$/.test(g))
            bad.push(d.id+"["+i+"] 圖檔名格式不對："+g);
        });
        if((d.milestones||[]).length !== 20) bad.push(d.id+" 里程碑不是 20 條");
      });
      A(!bad.length,bad.join("；"));
      return "全部合格";
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

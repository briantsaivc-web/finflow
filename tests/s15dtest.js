const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:900}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());

    // 重現實測情境：四人多人局，Brian(0) 當前，carrie(1) 有 STOCK_GAIN 待決
    const cfg=ns.buildConfig(ns.configRegistry);
    ui.startCore(2161, cfg, ["M1","M2","M3","M4","M6"],
      ["Brian","carrie","穩健阿姨","槓桿哥"].map((n,i)=>({name:n,isNPC:i>1,
        personality:i>1?"NPC_SAFE":null,
        professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id})), {noRules:true});
    close();
    const S=ui.S;
    const stubAdapter={ kind:"local", appendAction:function(){return Promise.resolve("ok");},
      readLog:function(){return Promise.resolve([]);}, writeMeta:function(){return Promise.resolve();} };
    ui.mp={mode:true, seat:0, host:true, code:"2161", uid:"u0", seatUid:{0:"u0",1:"u1"},
           presence:{}, adapter:stubAdapter, replaying:false};
    S.activePlayerIdx=0; S.turnResolved=false;   // 尚未擲骰：解開死結後應該可以擲
    // 讓 carrie 真的持有一檔大漲的股票，再用引擎自己的路徑產生 STOCK_GAIN
    const carrie=S.players[1], sym="STK_SPEC", aid=util.uid(S,"A");
    const px=S.stockPrices[sym];
    carrie.assets.push({instanceId:aid,cardId:null,kind:"STOCK",name:E.stockName(S,sym),symbol:sym,
      units:10,costBasis:util.r2(px*10),marketValue:util.r2(px*10*2.1),monthlyIncome:0,
      linkedLiabilityId:null,flags:{}});
    ns.ledger.post(S,carrie,"建部位",[{account:"ASSET",delta:util.r2(px*10*2.1),refId:aid,label:"投機"}],{eduTags:["setup"]});
    E.pushDecision(S,carrie,{kind:"STOCK_GAIN", assetId:aid, symbol:sym,
      gain:1.1, cardId:null});
    E.syncPhase(S);

    step("Brian 的裝置：顯示『等待 carrie 做決定中』",()=>{
      ui.mp.seat=0; ui.render();
      const t=document.getElementById("boardCenter").textContent;
      A(/等待 carrie/.test(t),"應顯示等待 carrie，實得："+t.slice(0,50));
      A(/做決定中/.test(t),"應說明在做決定");
      return t.replace(/\s+/g,'').slice(0,30);
    });

    step("carrie 的裝置：看得到自己的決策卡（不是等待畫面）",()=>{
      ui.mp.seat=1; ui.render();
      const t=document.getElementById("center").textContent+document.getElementById("boardCenter").textContent;
      A(!/等待 carrie/.test(t),"carrie 自己不該看到『等待 carrie』");
      A(t.length>20,"carrie 應該看到決策內容，實得："+t.slice(0,60));
      return "有決策畫面";
    });

    step("carrie 送出 DECIDE：引擎必須接受（原本是 NOT_YOUR_TURN 死結）",()=>{
      const d=S.pendingDecision;
      const r=E.apply(ui.S,{type:"DECIDE",playerId:1,
        payload:{decisionId:d.decisionId,optionId:"hold",params:{}}});
      A(!r.rejected,"擁有者作答被拒＝死結");
      ui.S=r.state; ui.render();
      A(!ui.S.pendingDecision || ui.S.pendingDecision.playerId!==1,"決策應已消化");
      return "已消化，輪回 Brian";
    });

    step("Brian 現在可以擲骰了",()=>{
      ui.mp.seat=0;
      A(ui.S.phase==="ROLL","解開後階段應回到 ROLL，實得 "+ui.S.phase);
      const r=E.apply(ui.S,{type:"ROLL_DICE",playerId:0,payload:null});
      A(!r.rejected,"死結解開後當前玩家應能擲骰");
      ui.S=r.state;
      return "可擲骰";
    });

    step("多人局的卡住面板走『重新同步』而非本機跳過",()=>{
      close(); ui.mp.mode=true; ui.mp.seat=0;
      ui.showStuck(new Error("測試"));
      A(document.querySelector("#overlays .sheetbox"),"卡住面板沒開出來");
      const boxes=document.querySelectorAll("#overlays .sheetbox");
      const t=boxes[boxes.length-1].textContent;
      A(/重新同步/.test(t),"多人局應提供重新同步");
      A(!/跳過這一位/.test(t),"多人局不得提供本機跳過（會讓各端對不起來）");
      A(/待決屬於|我是座位/.test(t),"診斷應寫出待決屬於誰、我是哪個座位");
      close();
      ui.mp.mode=false; ui.showStuck(new Error("測試"));
      const boxes2=document.querySelectorAll("#overlays .sheetbox");
      const t2=boxes2[boxes2.length-1].textContent;
      A(/跳過這一位/.test(t2),"單機局應保留跳過選項");
      close();
      return "多人=重新同步／單機=跳過";
    });

    step("不得代答別人的決策",()=>{
      ui.S.decisionQueue=[]; ui.S.pendingDecision=null;
      E.pushDecision(ui.S,ui.S.players[1],{kind:"ACK"});
      E.syncPhase(ui.S);
      const d=ui.S.pendingDecision;
      A(d && d.playerId===1,"測試前提：待決應屬於 1 號");
      const r=E.apply(ui.S,{type:"DECIDE",playerId:0,
        payload:{decisionId:d.decisionId,optionId:"ok",params:{}}});
      A(r.rejected,"當前玩家不得代答別人的決策");
      return "已擋下";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  console.log(errs.length?('--- page errors ---\n'+errs.slice(0,6).join('\n')):'--- no page errors ---');
  console.log('RESULT '+log.filter(l=>l.startsWith('OK')).length+'/'+log.length);
  await b.close();
})();

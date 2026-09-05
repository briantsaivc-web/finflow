const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1440,height:960}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(900);
  const log=await pg.evaluate(async()=>{
    const ui=ns.ui,E=ns.engine,util=ns.util,L=[];
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const cfg=ns.buildConfig(ns.configRegistry);
    ui.startCore(9301, cfg, ["M1","M2","M3","M4","M6"],
      [{name:"我",isNPC:false,professionId:ns.content.professions[16].id,dreamCardId:ns.content.dreams[0].id},
       {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}],{noRules:true});
    close();
    const S=ui.S, me=S.players[0];
    ns.ledger.post(S,me,"補現金",[{account:"CASH",delta:300000,label:"x"}],{eduTags:["setup"]});

    step("下市股票面板：價格 0、不再顯示面額、買進鈕鎖住",()=>{
      S.delisted={STK_SPEC:true}; S.stockPrices.STK_SPEC=0;
      close(); ui.showStockPanel("STK_SPEC");
      const box=document.querySelector("#overlays .sheetbox"), t=box.textContent;
      A(/已下市/.test(t),"應標示已下市");
      // 只驗價格標頭（整頁比對會誤中線圖的 Y 軸刻度）
      const hdr=Array.from(box.querySelectorAll("b")).map(x=>x.textContent).filter(x=>/\/ 張/.test(x));
      A(hdr.length>0,"找不到價格標頭");
      const specHdr=hdr.find(x=>/^0 \/ 張/.test(x));
      A(specHdr,"下市股的價格標頭應是 0 / 張，實得："+hdr.join(" | "));
      const buys=Array.from(box.querySelectorAll("button.buyCash"));
      const spec=buys.find(x=>x.closest(".sec")&&/狂潮|投機/.test(x.closest(".sec").textContent));
      A(!spec||spec.disabled,"已下市的現股買進鈕應停用");
      return "價格 0、買進鎖住";
    });

    step("每輪紀錄：五欄齊全＋本輪合計",()=>{
      close();
      const aid=util.uid(S,"A");
      ns.ledger.post(S,me,"測試：貸款買資產",[
        {account:"CASH",delta:-200,label:"頭款"},{account:"ASSET",delta:1000,refId:aid,label:"標的"},
        {account:"LIABILITY",delta:800,refId:"L1",label:"貸款"},
        {account:"INCOME_PASSIVE",delta:9,refId:aid,label:"租金"},
        {account:"EXPENSE",delta:4,refId:"L1",label:"月付"}],{eduTags:["test"]});
      ui.showRoundLog(0);
      const t=document.querySelector("#overlays .sheetbox").textContent;
      ["現金","資產","負債","收入","支出"].forEach(c=>A(t.indexOf(c)>=0,"缺欄位 "+c));
      A(/本輪合計/.test(t),"應有本輪合計");
      A(/貸款買資產/.test(t),"應列出剛才那筆");
      close(); return "五欄＋合計";
    });

    step("賣股票：現金與資產差額標明是交易成本",()=>{
      close();
      S.turnResolved=true; S.phase="READY_END";
      ui.dispatch({type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"buy",units:20,margin:false}});
      ui.S.stockPrices.STK_TECH=util.r2(ui.S.stockPrices.STK_TECH*1.3); E.revalueStocks(ui.S);
      ui.S.bookkeeping=null; ui.S.decisionQueue=[]; ui.S.pendingDecision=null;
      ui.S.turnResolved=true; ui.S.phase="READY_END";
      ui.dispatch({type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"sell",units:20}});
      const p2=ui.S.players[0];
      const en=p2.ledger.slice().reverse().filter(e=>/股市賣出/.test(e.summary))[0];
      A(en,"應有賣出分錄");
      const r=ui.ledgerRow(en);
      A(r.cash>0 && r.asset<0,"應是現金增、資產減");
      A(r.note && /交易成本/.test(r.note),"應標明差額是交易成本，實得："+r.note);
      A(/損益/.test(en.summary),"摘要應寫出損益");
      return r.note;
    });

    step("回合結算彙總：出得來、有五欄、有朕知道了",()=>{
      close();
      ui._sumOff=false; ui._sumMark={}; ui._sumAutoSec=0;
      ui.markTurnSummary(0);
      ns.ledger.post(ui.S,ui.S.players[0],"這一輪的事件",[{account:"CASH",delta:-120,label:"x"},
        {account:"EXPENSE",delta:3,label:"月支出"}],{eduTags:["test"]});
      ui.showTurnSummary(0);
      const box=document.querySelector("#overlays .sheetbox");
      A(box,"結算畫面沒出來");
      const t=box.textContent;
      A(/你的結算/.test(t),"標題不對");
      A(/朕知道了/.test(t),"缺少『朕知道了』");
      A(/自動關閉/.test(t),"缺少自動關閉選項");
      A(/本輪合計/.test(t),"缺少本輪合計");
      ["現金","資產","負債","收入","支出"].forEach(c=>A(t.indexOf(c)>=0,"缺欄位 "+c));
      A(/這一輪的事件/.test(t),"應列出該筆事件");
      return "完整";
    });

    step("結算畫面：沒有異動就不打擾",()=>{
      close(); ui.markTurnSummary(0);
      ui.showTurnSummary(0);
      A(!document.querySelector("#overlays .sheetbox"),"沒有新分錄時不該彈出");
      return "不打擾";
    });

    step("小通知靜音：good 收起來、warn 照跳",()=>{
      // S35 起這是舊制（notifyMode=S18）的規則；精簡模式由 s35test 驗
      ui.notifyMode="S18";
      close(); ui._sumOff=false; ui._mutedToasts=[];
      document.getElementById("toast").innerHTML="";
      ui.toast("一般提示","good");
      A(document.getElementById("toast").children.length===0,"good 類應被靜音");
      A(ui._mutedToasts.length===1,"靜音的提示要留著在結算畫面列出");
      ui.toast("警告提示","warn");
      A(document.getElementById("toast").children.length===1,"warn 類必須照跳");
      ui._sumOff=true;
      document.getElementById("toast").innerHTML="";
      ui.toast("關閉結算後","good");
      A(document.getElementById("toast").children.length===1,"關閉結算畫面後應回到原本行為");
      ui._sumOff=false; ui.notifyMode="S35";
      return "good 靜音／warn 照跳／可關閉";
    });

    step("戰報：每位玩家分頁都有每輪紀錄入口",()=>{
      close(); ui.S.over=true; ui.S.overReason="MAX_TURNS"; ui.S.winner=0;
      ui._reported=false; ui.showReport();
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/每輪紀錄/.test(t),"戰報應有每輪紀錄入口");
      const btn=Array.from(document.querySelectorAll("#overlays button")).find(x=>/每輪紀錄/.test(x.textContent));
      A(btn,"應是可按的按鈕");
      btn.click();
      const boxes=document.querySelectorAll("#overlays .sheetbox");
      A(Array.from(boxes).some(x=>/的每輪紀錄/.test(x.textContent)),"按下去應打開每輪紀錄");
      close(); return "有入口且打得開";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  console.log(errs.length?('--- page errors ---\n'+errs.slice(0,6).join('\n')):'--- no page errors ---');
  console.log('RESULT '+log.filter(l=>l.startsWith('OK')).length+'/'+log.length);
  await b.close();
})();

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
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    const A=(c,m)=>{ if(!c) throw new Error(m); };
    const cfg=ns.buildConfig(ns.configRegistry); cfg.depthLevel=3;   // 融資需進階
    ui.startCore(1601, cfg, ["M1","M2","M3","M4","M6","M8"], [
      {name:"我",isNPC:false,professionId:ns.content.professions[16].id,dreamCardId:ns.content.dreams[0].id},
      {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id}
    ], {noRules:true});
    close();
    const S=ui.S, me=S.players[0];
    ns.ledger.post(S,me,"補現金",[{account:"CASH",delta:500000,label:"x"}],{eduTags:["setup"]});
    ui.render();

    step("個股面板顯示交易成本與來回損耗",()=>{
      close(); ui.showStockPanel("STK_TECH");
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/交易成本/.test(t),"沒有交易成本說明");
      A(/手續費/.test(t)&&/證交稅/.test(t),"缺手續費或證交稅");
      A(/一買一賣先賠/.test(t),"缺來回損耗提示");
      A(/ETF 證交稅較低/.test(t),"ETF 應標示稅率較低");
      return "含手續費／證交稅／來回損耗／ETF 差異";
    });

    step("可買張數已扣掉手續費",()=>{
      const def=ns.content.stockBySymbol.STK_TECH;
      const price=S.stockPrices.STK_TECH, feeR=E.cfg(S,"stockFeeRate");
      const withFee=Math.floor(me.cash/(price*(1+feeR)));
      const noFee=Math.floor(me.cash/price);
      A(withFee<noFee,"測試前提：含費後可買張數應更少");
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(t.indexOf("可買 "+withFee+" 張")>=0,"畫面應顯示扣費後的可買張數 "+withFee+"，實際文字含 可買 "+noFee+"？");
      return "含費 "+withFee+" 張（未扣費會是 "+noFee+" 張）";
    });

    step("買賣真的收費且帳目平",()=>{
      close();
      const c0=me.cash;
      ui.dispatch({type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"buy",units:5,margin:false}});
      const price=S.stockPrices.STK_TECH, amt=util.r2(price*5), fee=E.stockFee(S,amt);
      A(Math.abs((c0-ui.S.players[0].cash)-util.r2(amt+fee))<0.05,"買進未含手續費");
      const feeLine=ui.S.players[0].ledger.slice(-1)[0].postings.some(q=>q.label==="券商手續費");
      A(feeLine,"分錄裡應看得到手續費那一行");
      const c1=ui.S.players[0].cash;
      ui.dispatch({type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"sell",units:5}});
      const last=ui.S.players[0].ledger.slice(-1)[0];
      A(last.postings.some(q=>q.label==="券商手續費"),"賣出應有手續費");
      A(last.postings.some(q=>q.label==="證券交易稅"),"賣出應有證交稅");
      let csum=0; ui.S.players[0].ledger.forEach(en=>en.postings.forEach(q=>{ if(q.account==="CASH") csum+=q.delta; }));
      A(Math.abs(util.r2(csum)-ui.S.players[0].cash)<0.05,"現金與分錄不符");
      return "買賣皆入帳，現金與分錄相符";
    });

    step("融資閘門：信用C時按鈕鎖住並說明原因",()=>{
      close();
      const p=ui.S.players[0];
      p.creditRating="C";
      ui.showStockPanel("STK_TECH");
      const box=document.querySelector("#overlays .sheetbox");
      const mb=Array.from(box.querySelectorAll("button.buyMargin"));
      A(mb.length>0,"應該有融資買進按鈕（進階難度）");
      A(mb.every(x=>x.disabled),"信用 C 時融資鈕必須全部停用");
      A(/信用不良/.test(box.textContent),"應說明被擋的原因");
      A(/🔒/.test(box.textContent),"應有鎖定標示");
      const cashB=Array.from(box.querySelectorAll("button.buyCash"));
      A(cashB.some(x=>!x.disabled),"閘門不該連現股買進都擋掉");
      p.creditRating="B";
      return "融資鎖住、現股照常";
    });

    step("融資閘門：引擎層也擋（UI 灰化不算把關）",()=>{
      const p=ui.S.players[0]; p.creditRating="C";
      const r=E.apply(ui.S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_TECH",side:"buy",units:1,margin:true}});
      A(r.rejected,"引擎必須擋下融資");
      p.creditRating="B";
      return "引擎回拒";
    });

    step("個股說明的景氣連動與實際 beta 對得上",()=>{
      const M={STK_DIV:0.5,STK_ETF:1,STK_TECH:1.4,STK_SPEC:1.8};
      Object.keys(M).forEach(k=>{
        const d=ns.content.stockBySymbol[k];
        A(d.macroBeta===M[k], k+" macroBeta 應為 "+M[k]+"，實得 "+d.macroBeta);
        A(d.macroNote.indexOf(String(M[k]))>=0 || k==="STK_ETF",
          k+" 說明文字與 macroBeta 對不上："+d.macroNote);
      });
      return "四檔文案與參數一致";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  console.log(errs.length?('--- page errors ---\n'+errs.slice(0,6).join('\n')):'--- no page errors ---');
  console.log('RESULT '+log.filter(l=>l.startsWith('OK')).length+'/'+log.length);
  await b.close();
})();

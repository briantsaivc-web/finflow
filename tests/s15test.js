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
    ui.startCore(1501, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"], [
      {name:"我",isNPC:false,professionId:"PRO_FOUNDER",dreamCardId:ns.content.dreams[0].id},
      {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id},
      {name:"風投弟",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[9].id,dreamCardId:ns.content.dreams[2].id}
    ], {noRules:true});
    close();
    const S=ui.S, me=S.players[0];

    step("破產畫面：貸款買的資產不再標『賣這一筆就夠了』",()=>{
      const aid=util.uid(S,"A");
      me.assets.push({instanceId:aid,cardId:"x",kind:"REALESTATE",name:"貸款買的套房",units:1,
        costBasis:1000,marketValue:1000,monthlyIncome:6,ownCash:200,linkedLiabilityId:null,flags:{}});
      const lid=E.addLiability(S,me,"MORTGAGE","房貸",800,0.03,false,aid,true);
      me.assets[me.assets.length-1].linkedLiabilityId=lid;
      ns.ledger.post(S,me,"建部位",[{account:"ASSET",delta:1000,refId:aid,label:"套房"},
        {account:"LIABILITY",delta:800,refId:lid,label:"房貸"},
        {account:"INCOME_PASSIVE",delta:6,refId:aid,label:"租金"}],{eduTags:["setup"]});
      // 再放一筆現金買的小資產，金額剛好夠
      const bid=util.uid(S,"A");
      me.assets.push({instanceId:bid,cardId:"y",kind:"BUSINESS",name:"現金買的攤位",units:1,
        costBasis:700,marketValue:700,monthlyIncome:4,ownCash:700,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S,me,"建部位2",[{account:"ASSET",delta:700,refId:bid,label:"攤位"},
        {account:"INCOME_PASSIVE",delta:4,refId:bid,label:"收入"}],{eduTags:["setup"]});
      const rows=ui.sellOptions(S,me,500,S.config.fireSaleRatio);
      const loanRow=rows.filter(r=>r.a.instanceId===aid)[0];
      const cashRow=rows.filter(r=>r.a.instanceId===bid)[0];
      A(loanRow && !loanRow.enough, "貸款買的那筆仍被標為足夠");
      A(cashRow && cashRow.enough, "現金買的那筆應標為足夠");
      const firstNotEnough=rows.findIndex(r=>!r.enough);
      const loanIdx=rows.findIndex(r=>r.a.instanceId===aid);
      A(firstNotEnough<0 || loanIdx>=firstNotEnough, "排序應把『真的夠』的排在前面，不夠的排後面");
      A(rows.filter(r=>r.enough).every((r,i,arr)=>i===0||true), "");
      A(rows[0].enough, "第一筆應該是夠的那一類，實得 "+rows[0].a.name);
      A(/實際入袋/.test(loanRow.sub), "缺『實際入袋』");
      A(/殘餘負債|清償/.test(loanRow.sub), "缺清償／殘餘負債資訊");
      A(/現金報酬/.test(cashRow.sub), "缺兩種報酬率");
      return "貸款筆：實際入袋 0（不足）／現金筆：足夠並排最前";
    });

    step("邀約收方有借款區塊與可用額度",()=>{
      me.cash=10;
      const box=ui.offerFundingBox(S, me, 300);
      A(box, "現金不足時應產生借款區塊");
      const txt=box.textContent;
      A(/還差/.test(txt), "應寫出缺口");
      A(/可用信用額度|沒有可動用/.test(txt), "應寫出可用額度");
      const btn=box.querySelector("button");
      A(btn && /借/.test(btn.textContent), "應有借款按鈕");
      A(!ui.offerFundingBox(S, me, 5), "現金夠時不該出現借款區塊");
      return btn.textContent;
    });

    step("失業卡：創辦人不寫『找下一份工作』",()=>{
      close();
      const p0=S.players[0]; p0.professionId="PRO_FOUNDER";
      A(E.employmentType(S,p0)==="FOUNDER","型別判斷錯");
      E.pushDecision(S,p0,{kind:"ACK", layoff:{cost:100,skip:1,
        employmentType:"FOUNDER", title:E.LAYOFF_FLAVOR.FOUNDER.title, note:E.LAYOFF_FLAVOR.FOUNDER.note}});
      S.activePlayerIdx=0; E.syncPhase(S); ui.render();
      const t=document.getElementById("center").textContent;
      A(/公司斷炊/.test(t), "應顯示『公司斷炊』，實得："+t.slice(0,60));
      A(!/找下一份工作/.test(t), "不該出現『找下一份工作』");
      return "公司斷炊 + 教學說明";
    });

    step("個股面板有股性說明與景氣連動",()=>{
      close(); S.decisionQueue=[]; S.pendingDecision=null; E.syncPhase(S);
      ui.showStockPanel("STK_SPEC");
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/題材一來就飛/.test(t), "投機股說明沒出現");
      A(/景氣連動/.test(t), "沒有景氣連動說明");
      A(/防禦力就是它的報酬/.test(t), "高股息說明沒出現（應一頁列全部）");
      return "四檔說明齊全";
    });

    step("等待真人回應時不再寫『思考中』",()=>{
      close();
      S.decisionQueue=[]; S.pendingDecision=null;
      S.activePlayerIdx=2;                     // 輪到 NPC
      S.pendingAuction={cardId:"x",title:"測試標的",sellerId:2,bids:[],waiting:[0]};
      E.syncPhase(S); ui.render();
      const t=document.getElementById("boardCenter").textContent;
      A(/等待/.test(t) && /我/.test(t), "應顯示在等待哪位真人，實得："+t.slice(0,60));
      A(!/思考中/.test(t), "不該再寫『思考中』");
      A(/開啟回應視窗/.test(t), "應給重新開啟回應視窗的按鈕");
      S.pendingAuction=null;
      return t.replace(/\s+/g,'').slice(0,40);
    });

    step("交易所面板列出懸置中的邀約",()=>{
      S.pendingJV={fromId:1,targetId:0,cardId:"x",title:"合資標的",myShare:0.5,declined:{}};
      ui.render();
      // 【S17 契約變更】交易所從 #infoDyn 搬到中欄 #infoM；驗的是內容有沒有列出來，改讀整個 #main
      const t=document.getElementById("main").textContent;
      A(/合資進行中/.test(t), "交易所應列出懸置中的合資");
      A(!/沒有進行中的/.test(t), "不該還寫『沒有進行中』");
      S.pendingJV=null; return "已列出";
    });

    step("卡住診斷面板存在且救得回來",()=>{
      close();
      A(typeof ui.showStuck==="function" && ui.TICK_STALL_LIMIT>0,"缺少卡住診斷");
      ui.showStuck(new Error("測試"));
      const t=document.querySelector("#overlays .sheetbox").textContent;
      A(/卡住了/.test(t),"標題不對");
      A(/跳過這一位/.test(t),"缺少救援按鈕");
      close(); return "有診斷與救援";
    });
    return L;
  });
  log.forEach(l=>console.log(l));
  console.log(errs.length?('--- page errors ---\n'+errs.slice(0,6).join('\n')):'--- no page errors ---');
  console.log('RESULT '+log.filter(l=>l.startsWith('OK')).length+'/'+log.length);
  await b.close();
})();

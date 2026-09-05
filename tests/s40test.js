const { chromium } = require('playwright');
/* S40 四項（Brian 打過一局後的裁示）：
     ① 投資機會的「風險調整後年化」對事業／吸金盤不再等於帳面報酬率
        （有記帳技能的人看得到景氣折減、獲利波動折減；吸金盤直接 −100%）
     ② 薪資單：右上角「不再顯示」；標題「薪資單（亦可在收支明細查看）」；偏好存 localStorage
     ③ 你的結算：右上角「不再顯示」；標題「你的結算（亦可在你的每輪紀錄查看）」；
        底下的朕知道了／自動關閉／只在大事顯示三顆鈕拿掉；設定面板三段切換仍在
     ④ 踩到本命聖地免費 +1 的那一輪不能再用錢買（一輪最多一點）；dreamFreeThenBuy=1 回舊制
   用法（repo 根目錄）： node tests/s40test.js */
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
      ui.startCore(seed||4000, c, MODS, four, {noRules:true}); close(); ui.notifyMode="S35"; return ui.S; };
    const card=id=>ns.content.byId[id];
    const give=(p,id)=>{ p.skills[id]={learnedAt:1,decayed:false,refreshedAt:null}; };
    const cashTo=(S,p,v)=>ns.ledger.post(S,p,"補現金",[{account:"CASH",delta:util.r2(v-p.cash),label:"x"}],{eduTags:["setup"]});
    const why=r=>(r.events||[]).filter(e=>e.type==="ACTION_REJECTED").map(e=>e.reason).pop();

    /* ---------- ① 風險調整後年化 ---------- */
    step("① 事業：懂帳的人看到的風險調整後年化低於帳面（景氣折減＋獲利波動折減）",()=>{
      const S=fresh(4001), p=S.players[0], q=S.players[1];
      give(p,"SKL_BOOK");
      const vol=card("OPS_BZ2"), calm=card("OPS_BZ1");
      A(vol && vol.payload.volatileProfit===true && calm && !calm.payload.volatileProfit,"測試前提：OPS_BZ2 波動、OPS_BZ1 不波動");
      const plain=E.oppCompare(S,vol,q);
      A(plain.netYield===undefined,"沒技能不得帶出風險調整欄位");
      const cv=E.oppCompare(S,vol,p), cc=E.oppCompare(S,calm,p);
      A(cv.disclosed && cc.disclosed,"有技能應揭露");
      A(cv.netYield < cv.yield,"波動事業：風險調整後 "+cv.netYield+" 應低於帳面 "+cv.yield);
      A(cc.netYield < cc.yield,"平穩事業：景氣折減也該讓風險調整後 "+cc.netYield+" 低於帳面 "+cc.yield);
      const gapV=cv.yield-cv.netYield, gapC=cc.yield-cc.netYield;
      A(gapV/cv.yield > gapC/cc.yield,"波動事業的折減比例應大於平穩事業");
      A(/景氣循環/.test(cc.riskNote) && /獲利波動/.test(cv.riskNote),"揭露文字要寫出兩種折減，實得 "+cv.riskNote);
      return "波動 "+util.pct(cv.yield,1)+"→"+util.pct(cv.netYield,1)+"；平穩 "+util.pct(cc.yield,1)+"→"+util.pct(cc.netYield,1);
    });
    step("① 吸金盤：懂帳的人看到風險調整後年化 −100%，介面寫本金會歸零",()=>{
      const S=fresh(4002), p=S.players[0]; give(p,"SKL_BOOK"); cashTo(S,p,2000);
      const sc=card("OPP_HONGYUAN_FUND"); A(sc && sc.payload.isScam,"測試前提：紅圓基金是吸金盤");
      const c=E.oppCompare(S,sc,p);
      A(c.scam===true && c.netYield===-1 && c.netIncome===0,"吸金盤應 netYield=−1，實得 "+JSON.stringify({scam:c.scam,ny:c.netYield,ni:c.netIncome}));
      A(c.yield>0,"帳面年化仍為正（沒技能的人只看得到這個）");
      A(/歸零|撐不起|不成立/.test(c.riskNote),"揭露文字要點破，實得 "+c.riskNote);
      close();
      const box=ui.oppFacts(S,sc,p);
      A(/-100\.0%|−100/.test(box.textContent),"面板應顯示 −100%，實得 "+box.textContent.slice(0,200));
      A(/歸零|撐不起|不成立/.test(box.textContent),"面板要寫出揭露文字");
      return "帳面 "+util.pct(c.yield,1)+"／風險調整後 −100%";
    });
    step("① 不動產路徑不受影響（折減仍只有修繕與空租）",()=>{
      const S=fresh(4003), p=S.players[0]; give(p,"SKL_BOOK");
      const re=Object.keys(ns.content.byId).map(k=>ns.content.byId[k]).filter(c=>c.kind==="REALESTATE" && c.payload && c.payload.monthlyRent>0)[0];
      A(re,"測試前提：找得到不動產卡");
      const c=E.oppCompare(S,re,p);
      A(c.disclosed && !/景氣循環|獲利波動/.test(c.riskNote),"不動產不該出現事業的折減，實得 "+c.riskNote);
      return "不動產揭露："+c.riskNote;
    });

    /* ---------- ② 薪資單 ---------- */
    step("② 薪資單：標題「薪資單（亦可在收支明細查看）」、右上角「不再顯示」、關掉後不再彈且寫進 localStorage",()=>{
      const S=fresh(4004), p=S.players[0];
      ui._payslipOff=false; try{ localStorage.removeItem("finflow.payslipOff"); }catch(e){}
      close();
      const d={turn:3,baseSalary:60,salary:60,passive:0,passiveRows:[],expense:40,net:20};
      ui.showPayslip(d);
      const box=document.querySelector('#overlays .sheetbox'); A(box,"薪資單沒出來");
      A(/薪資單（亦可在收支明細查看）/.test(box.textContent),"標題不對，實得 "+box.textContent.slice(0,60));
      const btn=[].slice.call(box.querySelectorAll('button')).filter(b=>/不再顯示/.test(b.textContent))[0];
      A(btn,"右上角要有『不再顯示』");
      A(btn.parentNode && /panelTop/.test(btn.parentNode.className),"『不再顯示』應在標題列（panelTop）");
      btn.click();
      A(!document.querySelector('#overlays .sheetbox'),"按下後應關閉");
      A(ui._payslipOff===true && localStorage.getItem("finflow.payslipOff")==="1","偏好要存起來");
      ui.showPayslip(d);
      A(!document.querySelector('#overlays .sheetbox'),"關掉後不該再彈");
      ui._payslipOff=false; try{ localStorage.removeItem("finflow.payslipOff"); }catch(e){}
      close();
      ns.devpanel.build();
      const dv=document.getElementById("devbody");
      A(dv && /發薪時的薪資單/.test(dv.textContent),"調參面板要能再打開薪資單");
      return "標題／按鈕／偏好／面板四項";
    });

    /* ---------- ③ 你的結算 ---------- */
    step("③ 你的結算：標題含「亦可在你的每輪紀錄查看」、右上角「不再顯示」、底下三顆鈕拿掉、倒數字樣",()=>{
      const S=fresh(4005), p=S.players[0];
      ui._sumOff=false; ui._sumAlways=true; ui._sumMark={}; ui._sumAutoSec=5; ui.markTurnSummary(0);
      ns.ledger.post(S,p,"這一輪的事件",[{account:"CASH",delta:-120,label:"x"}],{eduTags:["test"]});
      close(); ui.showTurnSummary(0);
      const box=document.querySelector('#overlays .sheetbox'); A(box,"結算畫面沒出來");
      const t=box.textContent;
      A(/你的結算（亦可在你的每輪紀錄查看）/.test(t),"標題不對，實得 "+t.slice(0,80));
      const btns=[].slice.call(box.querySelectorAll('button')).map(b=>b.textContent);
      A(!btns.some(x=>/朕知道了|自動關閉|顯示：/.test(x)),"底下三顆鈕應已拿掉，實得 "+btns.join("|"));
      const off=[].slice.call(box.querySelectorAll('button')).filter(b=>/不再顯示/.test(b.textContent))[0];
      A(off,"右上角要有『不再顯示』");
      A(/秒後自動關閉/.test(t),"應有倒數字樣");
      off.click();
      A(!document.querySelector('#overlays .sheetbox'),"按下後應關閉");
      A(ui._sumOff===true && ui.sumMode()==="off" && localStorage.getItem("finflow.sumOff")==="1","偏好要存起來且 sumMode=off");
      ns.ledger.post(S,p,"大錢",[{account:"CASH",delta:-9999,label:"x"}],{eduTags:["test"]});
      ui._wasMyTurn=true; S.activePlayerIdx=1; ui.checkTurnSummary();
      A(!document.querySelector('#overlays .sheetbox'),"關掉後大事也不該彈");
      ui._sumOff=false; ui._sumAlways=false; try{ localStorage.removeItem("finflow.sumOff"); }catch(e){}
      close();
      ns.devpanel.build();
      const dv=document.getElementById("devbody");
      A(dv && /只在大事才顯示/.test(dv.textContent),"調參面板三段切換仍在");
      return "標題／右上角關／三鈕移除／倒數／面板";
    });

    /* ---------- ④ 聖地那一輪不能再買 ---------- */
    const toSite=(S,p)=>{
      const dream=card(p.dreamCardId); const bo=E.board(S,true);
      const idx=bo.findIndex(s=>s.type==="SITE" && s.category===dream.category);
      A(idx>=0,"測試前提：外圈有本命聖地");
      return idx;
    };
    step("④ 踩到本命聖地那一輪：免費 +1 後不再提供購點、BUY_DREAM_PROGRESS 被拒 FREE_THIS_TURN",()=>{
      const S=fresh(4006), p=S.players[0];
      p.playerStage="OUTER"; p.financiallyFree=true; cashTo(S,p,5000);
      const idx=toSite(S,p); const n=E.board(S,true).length;
      p.outerPos=(idx-1+n)%n; p.dreamProgress=0; p.boughtProgressThisTurn=false;
      S.decisionQueue=[]; S.pendingDecision=null;
      const d0=p.dreamProgress;
      E.doMove(S,p,1);
      A(p.dreamProgress===d0+1,"踩到聖地應免費 +1，實得 "+(p.dreamProgress-d0));
      A(p.freeProgressTurn===S.turnNumber,"應記下免費那一輪");
      const hasBuy=(S.decisionQueue||[]).concat(S.pendingDecision?[S.pendingDecision]:[]).some(d=>d.kind==="BUY_PROGRESS");
      A(!hasBuy,"同一輪不該再出現購點決策");
      S.phase="ROLL";
      const r=E.apply(S,{type:"BUY_DREAM_PROGRESS",playerId:p.id},{mutate:true});
      A(r.rejected && why(r)==="FREE_THIS_TURN","應被拒 FREE_THIS_TURN，實得 "+JSON.stringify(why(r)));
      A(E.buyDreamProgress(S,p)===false && p.dreamProgress===d0+1,"直呼 buyDreamProgress 也要擋");
      // 下一輪就可以買
      S.turnNumber++; p.boughtProgressThisTurn=false;
      A(E.freeProgressThisTurn(S,p)===false,"下一輪不再受限");
      A(E.buyDreamProgress(S,p)===true && p.dreamProgress===d0+2,"下一輪應可購點");
      return "免費 +1；同輪拒 FREE_THIS_TURN；下一輪可買";
    });
    step("④ 沒踩聖地的輪次照常可買一點；dreamFreeThenBuy=1 回到「幸運雙倍」",()=>{
      const S=fresh(4007), p=S.players[0];
      p.playerStage="OUTER"; p.financiallyFree=true; cashTo(S,p,5000); p.dreamProgress=0;
      const idx=toSite(S,p); const bo=E.board(S,true), n=bo.length;
      // 找一個不是本命聖地、也不是發薪格的落點
      let dest=-1; for(let i=1;i<n;i++){ const s=bo[(idx+i)%n]; if(s.type!=="SITE" && s.type!=="OPAYDAY"){ dest=(idx+i)%n; break; } }
      A(dest>=0,"測試前提：找得到普通格");
      p.outerPos=(dest-1+n)%n; S.decisionQueue=[]; S.pendingDecision=null; p.boughtProgressThisTurn=false;
      E.doMove(S,p,1);
      A(p.freeProgressTurn!==S.turnNumber,"沒踩聖地不該記免費");
      A(E.freeProgressThisTurn(S,p)===false,"沒踩聖地不受限");
      S.decisionQueue=[]; S.pendingDecision=null;
      const d1=p.dreamProgress;
      A(E.buyDreamProgress(S,p)===true && p.dreamProgress===d1+1,"普通輪次應可買一點");
      // 開關回舊制
      const S2=fresh(4008,{dreamFreeThenBuy:1}), p2=S2.players[0];
      p2.playerStage="OUTER"; p2.financiallyFree=true; cashTo(S2,p2,5000); p2.dreamProgress=0;
      const idx2=toSite(S2,p2), n2=E.board(S2,true).length;
      p2.outerPos=(idx2-1+n2)%n2; S2.decisionQueue=[]; S2.pendingDecision=null; p2.boughtProgressThisTurn=false;
      E.doMove(S2,p2,1);
      A(p2.dreamProgress===1,"舊制：踩聖地 +1");
      const hasBuy2=(S2.decisionQueue||[]).concat(S2.pendingDecision?[S2.pendingDecision]:[]).some(d=>d.kind==="BUY_PROGRESS");
      A(hasBuy2,"舊制：同一輪仍提供購點");
      A(E.buyDreamProgress(S2,p2)===true && p2.dreamProgress===2,"舊制：同一輪可再買＝幸運雙倍");
      return "普通輪可買；開關=1 回舊制";
    });
    step("④ 電腦玩家同輪也拿不到第二點（決策路徑被擋）",()=>{
      const S=fresh(4009), q=S.players[1];
      q.playerStage="OUTER"; q.financiallyFree=true; cashTo(S,q,5000); q.dreamProgress=0;
      const idx=toSite(S,q), n=E.board(S,true).length;
      q.outerPos=(idx-1+n)%n; S.decisionQueue=[]; S.pendingDecision=null; q.boughtProgressThisTurn=false;
      E.doMove(S,q,1);
      A(q.dreamProgress===1,"電腦踩聖地 +1");
      const hasBuy=(S.decisionQueue||[]).concat(S.pendingDecision?[S.pendingDecision]:[]).some(d=>d.kind==="BUY_PROGRESS" && d.playerId===q.id);
      A(!hasBuy,"電腦同輪不該有購點決策");
      return "電腦同輪最多一點";
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

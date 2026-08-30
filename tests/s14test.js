const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1920,height:1080}});
  const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  p.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
  await p.goto('file://'+TARGET,{waitUntil:'load'}); await p.waitForTimeout(900);
  const r=await p.evaluate(()=>{
    const ui=ns.ui,E=ns.engine,log=[];
    const step=(n,f)=>{ try{ const d=f(); log.push('OK   '+n+(d?'  '+d:'')); }catch(e){ log.push('FAIL '+n+' :: '+e.message); } };
    const close=()=>document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
    ui.startCore(777, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"], [
      {name:"我",isNPC:false,professionId:ns.content.professions[7].id,dreamCardId:ns.content.dreams[0].id},
      {name:"阿姨",isNPC:true,personality:"NPC_SAFE",professionId:ns.content.professions[5].id,dreamCardId:ns.content.dreams[1].id},
      {name:"風投弟",isNPC:true,personality:"NPC_VC",professionId:ns.content.professions[9].id,dreamCardId:ns.content.dreams[2].id}
    ], {noRules:true});
    close();
    const S=ui.S, me=S.players[0];
    ns.ledger.post(S,me,"補現金",[{account:"CASH",delta:900,label:"x"}],{});
    for(let i=0;i<6;i++) S.stockHistory && Object.keys(S.stockHistory).forEach(k=>S.stockHistory[k].push(S.stockPrices[k]*(1+(i%3-1)*0.04)));
    ui.render();

    step('版面：三欄等寬', ()=>{
      const c=getComputedStyle(document.getElementById('main')).gridTemplateColumns.split(' ').map(x=>Math.round(parseFloat(x)));
      if(new Set(c).size!==1) throw new Error('欄寬不等：'+c.join('/'));
      return c.join(' / ');
    });
    step('輪盤占畫面 ≈1/6', ()=>{
      const r=document.getElementById('boardWrap').getBoundingClientRect();
      const pct=(r.width*r.height)/(innerWidth*innerHeight)*100;
      if(pct<12||pct>20) throw new Error('實得 '+pct.toFixed(1)+'%');
      return pct.toFixed(1)+'%';
    });
    step('盤面文案：底層牛馬區', ()=>{
      const t=document.getElementById('boardSvg').textContent;
      if(!/底層牛馬區/.test(t)) throw new Error('沒改到');
      if(/老\s*鼠\s*圈/.test(t)) throw new Error('還留著老鼠圈');
    });
    step('玩家卡：無近況、有被動收入與資產筆數、幸福感夢想同列', ()=>{
      const c=document.querySelector('#pawns .pcol'); const t=c.textContent;
      if(!/被動收入/.test(t)) throw new Error('缺被動收入');
      // 【S18 契約變更】「資產筆數」不再自己一行，併進被動收入寫成「xxx ／ N 筆」
      // （卡片 173px→118px，左欄系統訊息從看得到 11 則變成 14 則全看得到）
      if(!/／\s*\d+\s*筆/.test(t)) throw new Error('缺資產筆數（應併在被動收入那一行）');
      if(!c.querySelector('.pdual')) throw new Error('幸福感與夢想沒有併列');
      if(c.querySelector('.ac')) throw new Error('近況那一行還在');
      return document.querySelectorAll('#pawns .pcol').length+' 張卡';
    });
    // 【S17 契約變更】S14a 訂「一列三張」，實測後 Brian 指定改成「兩列放四人」＝一列兩張。
    step('玩家卡一列兩張（S17：四人排成 2×2）', ()=>{
      const n=getComputedStyle(document.getElementById('pawns')).gridTemplateColumns.split(' ').length;
      if(n!==2) throw new Error('實得 '+n);
    });
    step('操作區已無「借款」「股市交易」', ()=>{
      const t=document.getElementById('opsGrid').textContent;
      if(/借款|股市交易/.test(t)) throw new Error('還在：'+t);
      return document.querySelectorAll('#opsGrid .act').length+' 顆';
    });
    step('借款鈕移到右欄個人區', ()=>{
      const sh=document.getElementById('sheet');
      const b=[...sh.querySelectorAll('button')].filter(x=>x.textContent==='借款')[0];
      if(!b) throw new Error('右欄沒有借款鈕');
      const r=[...sh.querySelectorAll('button')].filter(x=>x.textContent==='還款')[0];
      if(!r) throw new Error('右欄沒有還款鈕');
    });
    step('負債細項有利率與原始貸款欄', ()=>{
      // 先借一筆才看得到
      E.apply(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:200}},{mutate:true});
      ui.renderSheet();
      const ths=[...document.querySelectorAll('#sheet .dtb.ret th')].map(x=>x.textContent);
      if(ths.indexOf('利率')<0||ths.indexOf('原始貸款')<0) throw new Error('實得 '+ths.join('/'));
    });
    step('庫存股票有成本與損益欄', ()=>{
      const ths=[...document.querySelectorAll('#sheet .dtb.stk th')].map(x=>x.textContent);
      ['股票','現價','成本','張','損益','損益%','維持率'].forEach(k=>{ if(ths.indexOf(k)<0) throw new Error('缺 '+k); });
    });
    step('報酬率算式正確（無槓桿時兩者相同）', ()=>{
      E.apply(S,{type:"TRADE_STOCK",playerId:0,payload:{symbol:"STK_DIV",side:"buy",units:2}},{mutate:true});
      const a=S.players[0].assets.filter(x=>x.kind==="STOCK")[0];
      const rr=E.assetReturns(S.players[0],a);
      if(Math.abs(rr.ownCash-a.costBasis)>0.01) throw new Error('自備應等於成本（現股無槓桿）');
      if(Math.abs(rr.cashYield-rr.assetYield)>1e-9) throw new Error('無槓桿時兩種報酬率應相同');
      return '自備 '+rr.ownCash+'　兩率 '+(rr.cashYield*100).toFixed(1)+'%';
    });
    step('報酬率算式正確（有槓桿時現金報酬 > 資產報酬）', ()=>{
      const card=ns.content.cards.OPPORTUNITY_SMALL.filter(c=>c.kind==="REALESTATE")[0];
      const before=S.players[0].assets.length;
      E.buyAsset(S,S.players[0],card,"loan",{});
      const a=S.players[0].assets[S.players[0].assets.length-1];
      if(S.players[0].assets.length===before) throw new Error('沒買成');
      const rr=E.assetReturns(S.players[0],a);
      if(!(rr.ownCash>0 && rr.ownCash<a.costBasis)) throw new Error('自備應小於成本，實得 '+rr.ownCash+'/'+a.costBasis);
      if(!(Math.abs(rr.cashYield)>Math.abs(rr.assetYield))) throw new Error('槓桿應放大現金報酬');
      return '自備 '+rr.ownCash+' / 成本 '+a.costBasis+'　現金 '+(rr.cashYield*100).toFixed(1)+'% vs 資產 '+(rr.assetYield*100).toFixed(1)+'%';
    });
    ui.render();
    step('資產細項有兩種報酬率欄（買了資產之後）', ()=>{
      const ths=[...document.querySelectorAll('#sheet .dtb.ret th')].map(x=>x.textContent);
      if(ths.indexOf('現金報酬')<0||ths.indexOf('資產報酬')<0) throw new Error('實得 '+ths.join('/'));
      if(!/現金報酬 ＝ 年現金流 ÷ 自備現金/.test(document.getElementById('sheet').textContent)) throw new Error('缺算式說明');
      return ths.join(' | ');
    });
    step('單檔股票面板：K線含 XY 軸、三顆買賣鈕、定期定額建議金額', ()=>{
      ui.showStockPanel("STK_DIV");
      const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
      if(!ov) throw new Error('沒跳出面板');
      const svg=ov.querySelector('svg'); if(!svg) throw new Error('沒有 K 線');
      const st=svg.textContent;
      if(!/輪 次/.test(st)) throw new Error('缺 X 軸標題');
      if(!/股 價/.test(st)) throw new Error('缺 Y 軸標題');
      const t=ov.textContent;
      ['張數','現股買進','可買','定期定額','建議','股息再投入','殖利率','較上期'].forEach(k=>{
        if(t.indexOf(k)<0) throw new Error('缺「'+k+'」'); });
      // 融資是「進階」難度才開放（depthLevel>=3），標準難度本來就不該出現這顆
      if(E.canUseAdvanced(S) && t.indexOf('融資買進')<0) throw new Error('進階難度卻沒有融資買進');
      const amt=[...ov.querySelectorAll('input')].filter(i=>i.type==='number');
      if(amt.length<2) throw new Error('缺張數或每月扣輸入格');
      const sug=Math.max(5,Math.round(S.players[0].derived.salaryIncome/10));
      if(+amt[1].value!==sug) throw new Error('建議金額應為 '+sug+'，實得 '+amt[1].value);
      close();
      return '建議每月扣 '+sug;
    });
    step('進階難度下有「融資買進」且顯示可買張數', ()=>{
      const old=S.config.depthLevel; S.config.depthLevel=3;
      try{
        ui.showStockPanel("STK_DIV");
        const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
        const t=ov.textContent;
        if(t.indexOf('融資買進')<0) throw new Error('沒有融資買進');
        const hints=[...ov.querySelectorAll('span')].filter(x=>/^可買 \d+ 張$/.test(x.textContent));
        if(hints.length<2) throw new Error('現股與融資應各自顯示可買張數，實得 '+hints.length);
        close();
        return hints.map(x=>x.textContent).join(' / ');
      } finally { S.config.depthLevel=old; }
    });
    step('中欄點股票列會開單檔面板', ()=>{
      // 【S17 契約變更】股市列從 #infoDyn 搬到中欄 #infoM（#infoDyn 已拆掉）
      const rows=[...document.querySelectorAll('#infoM .fbRow, #infoDyn .fbRow')];
      if(!rows.length) throw new Error('中欄沒有股市列');
      rows[0].onclick(); const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
      if(!ov||!ov.querySelector('svg')) throw new Error('沒開到單檔面板');
      close();
    });
    step('非回合可買：商城在別人回合也能下手', ()=>{
      S.activePlayerIdx=1; ui.render();
      const bm=document.getElementById('btnMall');
      if(bm.disabled) throw new Error('商城鈕在別人回合被停用了');
      ui.showMall();
      const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
      if(!ov) throw new Error('商城沒打開');
      const items=[...ov.querySelectorAll('button.mallItem')];
      if(!items.length) throw new Error('商城沒有商品');
      const buyable=items.filter(x=>!x.disabled);
      if(!buyable.length) throw new Error('非回合時應該還是買得到（買不到的只該是買不起／已擁有／冷卻中）');
      if(!/不必等自己的回合/.test(ov.textContent)) throw new Error('沒告訴玩家不用等回合');
      close(); S.activePlayerIdx=0; ui.render();
      return buyable.length+'/'+items.length+' 件可買';
    });
    step('非回合：股票買賣停用、定期定額可設定', ()=>{
      S.activePlayerIdx=1; ui.render();
      ui.showStockPanel("STK_DIV");
      const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
      const trades=[...ov.querySelectorAll('button')].filter(x=>/買進|賣出|全賣|平倉/.test(x.textContent));
      if(!trades.length) throw new Error('沒有買賣鈕');
      if(trades.some(x=>!x.disabled)) throw new Error('非回合時不該可買賣');
      const sets=[...ov.querySelectorAll('button')].filter(x=>/扣款|股息再投入|停扣/.test(x.textContent));
      if(!sets.length) throw new Error('沒有定期定額鈕');
      if(sets.some(x=>x.disabled)) throw new Error('定期定額是設定，非回合應可改');
      if(!/可以先研究/.test(ov.textContent)) throw new Error('沒有說明為什麼不能下單');
      close(); S.activePlayerIdx=0; ui.render();
      return trades.length+' 顆買賣停用／'+sets.length+' 顆設定放行';
    });
    step('非回合：還款按鈕可用', ()=>{
      E.apply(S,{type:"TAKE_LOAN",playerId:0,payload:{amount:150}},{mutate:true});
      S.activePlayerIdx=1; ui.viewPlayerId=null; ui.renderSheet();
      const sh=document.getElementById('sheet');
      const rb=[...sh.querySelectorAll('button')].filter(x=>x.textContent==='還款')[0];
      if(!rb) throw new Error('沒有還款鈕');
      if(rb.disabled) throw new Error('非回合時還款鈕不該停用');
      const rowBtns=[...sh.querySelectorAll('button')].filter(x=>x.textContent==='還');
      if(rowBtns.length && rowBtns.some(x=>x.disabled)) throw new Error('負債列的「還」也該放行');
      S.activePlayerIdx=0; ui.render();
      return '還款鈕與負債列的「還」都可按';
    });
    step('非回合：賣資產仍停用（會牽動市場）', ()=>{
      S.activePlayerIdx=1; ui.viewPlayerId=null; ui.renderSheet();
      const sh=document.getElementById('sheet');
      const sb=[...sh.querySelectorAll('button')].filter(x=>x.textContent==='賣');
      if(sb.length && sb.some(x=>!x.disabled)) throw new Error('賣資產不該在別人回合放行');
      S.activePlayerIdx=0; ui.render();
      return sb.length+' 顆「賣」維持回合限定';
    });
    step('股市一頁列出全部標的（不用一檔一檔點）', ()=>{
      ui.showStockPanel(null);
      const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
      const svgs=ov.querySelectorAll('svg');
      if(svgs.length!==ns.content.stockDefs.length) throw new Error('應有 '+ns.content.stockDefs.length+' 張圖，實得 '+svgs.length);
      close();
      const old=S.config.depthLevel; S.config.depthLevel=3;   // 融資是進階難度才開放
      ui.showStockPanel(null);
      const ov2=[...document.querySelectorAll('#overlays .overlay')].pop();
      ['buyCash','buyMargin','sellSome','sellAll','dca','divRe'].forEach(c=>{
        if(!ov2.querySelector('button.act.'+c)) throw new Error('缺少 .'+c+' 配色按鈕'); });
      close(); S.config.depthLevel=old;
      return svgs.length+' 檔並列、六種配色按鈕齊全';
    });
    step('盤面：夢想圈玩家有金色光環與 🕊', ()=>{
      const q=S.players[1]; q.playerStage="OUTER"; q.outerPos=2; ui.renderBoard(); ui.renderPlayerCards();
      const svg=document.getElementById('boardSvg').innerHTML;
      if(!/🕊/.test(svg)) throw new Error('盤面上沒有夢想圈標記');
      if(!/#F2C14E/.test(svg)) throw new Error('盤面上沒有金色光環');
      const card=[...document.querySelectorAll('#pawns .pcol')][1];
      if(!/自由圈/.test(card.textContent)) throw new Error('玩家卡沒有自由圈徽章');
      if(card.className.indexOf('outer')<0) throw new Error('玩家卡沒有 outer 樣式');
      q.playerStage="INNER"; ui.renderBoard(); ui.renderPlayerCards();
      return '盤面光環＋🕊，玩家卡金色徽章';
    });
    step('記帳六套依實際出現頻率排序', ()=>{
      const g=ns.engine.BK_GROUPS;
      if(g[0].key!=='buyCash') throw new Error('最上面應是現金買資產');
      for(let i=1;i<g.length;i++) if(g[i-1].share<g[i].share) throw new Error('沒有依頻率遞減');
      return g.map(x=>x.name+' '+Math.round(x.share*100)+'%').join(' > ');
    });
    step('結束遊戲鈕已降級、總經一排兩欄', ()=>{
      const be=document.getElementById('btnEnd');
      if(be.className.indexOf('primary')>=0) throw new Error('結束遊戲仍是主要按鈕樣式');
      if(be.className.indexOf('quiet')<0) throw new Error('結束遊戲沒改成低調樣式');
      // 【S17 契約變更】總經從中欄 #infoDyn 搬到左欄 #infoL（#infoDyn 已拆掉）。
      // 這裡驗的是「總經仍是一排兩欄」，不是它住在哪個容器，所以兩種骨架都認。
      const g=document.querySelector('#infoL .fbGrid, #infoDyn .fbGrid');
      if(!g || g.className.indexOf('two')<0) throw new Error('總經沒有改成一排兩欄');
      const cols=getComputedStyle(g).gridTemplateColumns.trim().split(/\s+/).length;
      if(cols!==4) throw new Error('總經應為四欄（兩組 k/v），實得 '+cols);
      return '結束遊戲=quiet；總經 '+cols+' 欄';
    });
    step('右欄整欄可捲（決定 D）', ()=>{
      const sh=document.getElementById('sheet');
      if(getComputedStyle(sh).overflowY!=='auto') throw new Error('右欄不是 auto 捲動');
      if(sh.scrollHeight<=sh.clientHeight) return '(內容還不夠長，捲動屬性正確)';
      return '內容 '+sh.scrollHeight+'px / 可視 '+sh.clientHeight+'px';
    });
    return log;
  });
  r.forEach(x=>console.log(x));
  console.log(errs.length?('--- page errors ---\n'+[...new Set(errs)].slice(0,8).join('\n')):'--- no page errors ---');
  await b.close();
})();

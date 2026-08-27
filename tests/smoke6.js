const { chromium } = require('playwright');
(async ()=>{
  const browser=await chromium.launch();
  for(const [w,h] of [[1180,820],[1280,720]]){
    const ctx=await browser.newContext({viewport:{width:w,height:h}});
    const page=await ctx.newPage();
    const errs=[];
    page.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
    page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
    await page.goto('file://'+process.cwd()+'/index.html');
    await page.waitForTimeout(500);
    await page.evaluate(()=>{
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      const C=ns.content;
      ns.ui.start({npcs:3,preset:'STANDARD',modules:['M1','M2','M4','M6'],
        professionId:'PRO_ENGINEER',dreamCardId:C.dreams[2].id,seed:77},{d:2,v:2,a:2,m:['M1','M2','M4','M6']});
      document.querySelectorAll('.overlay').forEach(o=>o.remove());
      // 造一點狀態：資產+負債+外圈玩家+事件log
      const S=ns.ui.S, E=ns.engine, p=S.players[0];
      ns.ledger.post(S,p,'補現金',[{account:'CASH',delta:800,label:'x'}],{eduTags:['setup']});
      const id=ns.util.uid(S,'A');
      p.assets.push({instanceId:id,cardId:'X',kind:'REALESTATE',name:'台南老屋民宿',units:1,
        costBasis:900,marketValue:900,monthlyIncome:18,linkedLiabilityId:null,flags:{}});
      ns.ledger.post(S,p,'建檔',[{account:'ASSET',delta:900,refId:id,label:'台南老屋民宿'},
        {account:'INCOME_PASSIVE',delta:18,refId:id,label:'租金'}],{eduTags:['setup']});
      E.addLiability(S,p,'CONSUMER','裝修信貸',300,0.055,false);
      ns.ui.announce('穩健阿姨 以 27,000 拍下「社區停車位一席」',1);
      ns.ui.announce('央行升息：基準利率 2.00% → 3.50%');
      E.enterOuterCircle(S,S.players[2]);
      ns.ui.dispatch({type:'TRADE_STOCK',playerId:0,payload:{symbol:'STK_DIV',side:'buy',units:3,margin:false}});
      ns.ui.render();
    });
    await page.waitForTimeout(400);
    const chk=await page.evaluate(()=>{
      const R=id=>{const e=document.getElementById(id); if(!e) return null; const r=e.getBoundingClientRect();
        return {x:Math.round(r.x),w:Math.round(r.width),h:Math.round(r.height),sw:e.scrollWidth}; };
      const txt=id=>((document.getElementById(id)||{}).innerText||'');
      return {left:R('leftCol'),info:R('finBoard'),sheet:R('sheet'),
        bodyScroll:[document.body.scrollWidth,document.documentElement.clientWidth],
        lamp:/景氣燈號/.test(txt('infoDyn')), syslog:/央行升息/.test(txt('infoDyn')),
        exch:/交易所/.test(txt('finBoard')), ops:/操作區/.test(txt('finBoard')),
        pcols:document.querySelectorAll('#pawns .pcol').length,
        assetSell:/資產細項/.test(txt('sheet')) && [...document.querySelectorAll('#sheet .mini')].some(b=>b.textContent==='賣'),
        stockRow:/庫存股票/.test(txt('sheet')),
        stockHeld:/3/.test([...document.querySelectorAll('#sheet .dtb td')].map(t=>t.textContent).join('|'))};
    });
    console.log(w+'x'+h, JSON.stringify(chk));
    await page.screenshot({path:`s6_${w}x${h}.png`});
    if(w===1180){
      // 行內買股（qty 2）→ 張數 3→5
      const buy=await page.evaluate(()=>{
        const S=ns.ui.S;
        const rows=[...document.querySelectorAll('#sheet .dtb tr')];
        const row=rows.find(r=>/電信|高股息/.test(r.textContent)||/台興|日盛|國樺|富穩|力鴻|誠信|華欣|中鼎/.test(r.textContent));
        if(!row) return 'no-row';
        const q=row.querySelector('input.qty'); q.value=2;
        const bb=[...row.querySelectorAll('button')].find(b=>b.textContent==='買');
        bb.click();
        const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
        if(ov){ const go=[...ov.querySelectorAll('button')].find(x=>/仍要|繼續|確定/.test(x.textContent)); if(go) go.click(); }
        const held=ns.ui.S.players[0].assets.find(a=>a.kind==='STOCK'&&a.symbol==='STK_DIV');
        return {units:held&&held.units};
      });
      console.log('  行內買股:',JSON.stringify(buy));
      // 行內賣資產
      const sell=await page.evaluate(()=>{
        const sb=[...document.querySelectorAll('#sheet .mini')].find(b=>b.textContent==='賣');
        sb.click();
        const ov=[...document.querySelectorAll('#overlays .overlay')].pop();
        const ok=/賣出「台南老屋民宿」/.test(ov.innerText);
        const go=[...ov.querySelectorAll('button')].find(x=>/確定賣出/.test(x.textContent));
        go.click();
        return {confirm:ok, sold: !ns.ui.S.players[0].assets.some(a=>a.name==='台南老屋民宿')};
      });
      console.log('  行內賣資產:',JSON.stringify(sell));
      await page.screenshot({path:'s6_after.png'});
    }
    if(errs.length) console.log('  ❌', errs.slice(0,6).join(' | ')); else console.log('  ✅ 無 JS 錯誤');
    await ctx.close();
  }
  await browser.close();
})();

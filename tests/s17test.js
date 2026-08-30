/* S17 版面重整：實際開瀏覽器量幾何。
   驗收條件（全部由 AI 自驗，不需 Brian 本機執行）：
   1. 中欄由上到下＝警告帶→盤面→股市／交易所→操作區，且操作區永遠在最下面、不用捲就看得到
   2. 沒有重大事件時警告帶留白，盤面上緣不跳動
   3. 玩家卡 2×2
   4. 中央（骰子＋擲骰鈕）落在內圈的洞裡：不壓格子、不壓「底層牛馬區」兩行字
   5. 五種解析度都不出現水平／垂直捲軸、無 page error
*/
const { chromium } = require('playwright');
/* 路徑解析：預設測 repo 根目錄的 index.html，也可以自己指定一個檔案。
   用法（在 repo 根目錄）： node tests/<這支>.js  或  node tests/<這支>.js path/to/index.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const SIZES=[[1024,768],[1180,820],[1280,720],[1366,768],[1440,900],[1920,1080]];
const FILE='file://'+TARGET;

function setup(){
  const ui=ns.ui;
  ui.startCore(2161, ns.buildConfig(ns.configRegistry), ["M1","M2","M3","M4","M6","M8"],
    ["你","穩健阿姨","槓桿哥","風投弟"].map((n,i)=>({name:n,isNPC:i>0,
      personality:["","NPC_SAFE","NPC_LEVER","NPC_VC"][i],
      professionId:ns.content.professions[i*4].id, dreamCardId:ns.content.dreams[i].id})),{noRules:true});
  document.querySelectorAll('#overlays .overlay').forEach(o=>o.remove());
  ui._sumOff=true;
  for(let i=0;i<10;i++) ui.announce("第"+(30+i)+"輪 測試事件 "+i);
  ui.render();
}

function probe(){
  const R=e=>{const r=e.getBoundingClientRect();
    return {x:+r.x.toFixed(1),y:+r.y.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1),
            b:+r.bottom.toFixed(1),r:+r.right.toFixed(1)};};
  const g=id=>{const e=document.getElementById(id); return e?R(e):null;};
  const ov=(a,c)=>{const x=Math.min(a.r,c.r)-Math.max(a.x,c.x), y=Math.min(a.b,c.b)-Math.max(a.y,c.y);
    return (x>0.5&&y>0.5)?{x:+x.toFixed(1),y:+y.toFixed(1)}:null;};
  const bcKids=[...document.getElementById("boardCenter").children].map(k=>R(k));
  const texts=[...document.querySelectorAll('#boardSvg text')]
    .filter(t=>/底層牛馬區|被動收入蓋過/.test(t.textContent)).map(t=>R(t));
  const cells=[...document.querySelectorAll('#boardSvg .sp-cell rect')].map(R);
  let hitCell=0, hitText=0;
  bcKids.forEach(k=>{ cells.forEach(c=>{ if(ov(k,c)) hitCell++; });
                      texts.forEach(t=>{ if(ov(k,t)) hitText++; }); });
  const de=document.documentElement;
  window.scrollTo(9999,9999); const sx=window.scrollX, sy=window.scrollY; window.scrollTo(0,0);
  const fb=document.getElementById("finBoard");
  return {
    order:[...fb.children].map(e=>e.id),
    warn:g("warnBox"), wrap:g("boardWrap"), infoM:g("infoM"), ops:g("opsBox"),
    hole:g("boardHole"), bc:g("boardCenter"),
    bcKidsN:bcKids.length, hitCell, hitText,
    warnEmpty:!!document.querySelector("#warnBox .wempty"),
    warnText:document.getElementById("warnBox").textContent.replace(/\s+/g,''),
    pawnCols:getComputedStyle(document.getElementById("pawns")).gridTemplateColumns,
    opsIconsPos:getComputedStyle(document.getElementById("opsIcons")).position,
    opsIconsInHd:document.getElementById("opsHd").contains(document.getElementById("opsIcons")),
    leftTxt:document.getElementById("infoL").textContent.replace(/\s+/g,'').slice(0,60),
    midTxt:document.getElementById("infoM").textContent.replace(/\s+/g,'').slice(0,60),
    logLines:document.querySelectorAll("#infoL .ln").length,
    scrollX:sx>0, scrollY:sy>0, winH:window.innerHeight
  };
}

(async()=>{
  const b=await chromium.launch(); let pass=0, fail=0;
  const A=(c,m)=>{ if(c){pass++;} else {fail++; console.log('FAIL '+m);} };
  for(const [W,H] of SIZES){
    const pg=await b.newPage({viewport:{width:W,height:H}});
    const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
    pg.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text()); });
    await pg.goto(FILE,{waitUntil:'load'}); await pg.waitForTimeout(700);
    await pg.evaluate(setup); await pg.waitForTimeout(250);
    const r=await pg.evaluate(probe);
    const tag=W+'x'+H+' ';
    A(errs.length===0, tag+'有 console／page error: '+errs.slice(0,2).join('|'));
    A(r.order[0]==='warnBox', tag+'中欄第一塊應為警告帶，實得 '+r.order.join(','));
    A(r.order[r.order.length-1]==='opsBox', tag+'操作區應在中欄最下面，實得 '+r.order.join(','));
    A(r.ops.b<=r.winH+1, tag+'操作區底部超出視窗（要不用捲就按得到），ops.b='+r.ops.b+' win='+r.winH);
    A(r.warn.h>=40, tag+'沒有重大事件時警告帶應留白，實得高 '+r.warn.h);
    A(r.warnEmpty && /沒有重大事件/.test(r.warnText), tag+'警告帶空狀態文案不對：'+r.warnText);
    A(/repeat\(2|^\S+px \S+px$/.test(r.pawnCols), tag+'玩家卡應一列兩張，實得 '+r.pawnCols);
    A(r.opsIconsInHd && r.opsIconsPos!=='absolute', tag+'操作區小圖示應在標題列內且非 absolute');
    A(!!r.hole, tag+'缺 #boardHole 定位錨');
    A(r.hole && Math.abs(r.bc.x-r.hole.x)<2 && Math.abs(r.bc.y-r.hole.y)<2,
      tag+'中央那疊未對齊洞：bc='+JSON.stringify(r.bc)+' hole='+JSON.stringify(r.hole));
    A(r.hole && Math.abs(r.bc.w-r.hole.w)<2 && Math.abs(r.bc.h-r.hole.h)<2,
      tag+'中央那疊尺寸≠洞（zoom 沒除回去）：bc '+r.bc.w+'x'+r.bc.h+' hole '+r.hole.w+'x'+r.hole.h);
    A(r.hitCell===0, tag+'中央那疊壓到 '+r.hitCell+' 個格子');
    A(r.hitText===0, tag+'中央那疊壓到中央文字 '+r.hitText+' 次');
    A(!r.scrollX, tag+'出現水平捲軸');
    A(!r.scrollY, tag+'出現垂直捲軸');
    A(/總經|基準利率/.test(r.leftTxt), tag+'左欄應是總經訊息，實得 '+r.leftTxt);
    A(/股市/.test(r.midTxt), tag+'中欄資訊區應是股市資訊，實得 '+r.midTxt);
    A(r.logLines>=8, tag+'左欄系統訊息行數應 ≥8，實得 '+r.logLines);
    console.log(tag+'| warn '+r.warn.h+' board '+r.wrap.h+' infoM '+r.infoM.h+' ops '+r.ops.h
      +' | hole '+r.hole.w+'x'+r.hole.h+' | log '+r.logLines);
    await pg.close();
  }
  console.log(JSON.stringify({pass,fail}));
  await b.close();
  process.exit(fail?1:0);
})();

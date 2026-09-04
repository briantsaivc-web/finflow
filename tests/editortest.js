const { chromium } = require('playwright');
/* 卡片工坊（card_editor.html）驗收。
   這支測的是「工具本身能不能用」，不是遊戲行為：
     ① 11 個內容包都進得去（S22 版漏了 v10，整包卡片碰不到）
     ② 篩選器用的是真實的 deck／kind 值（S22 版寫死 "LIFE"，與資料的 LIFE_EVENT 對不上，篩出 0 張）
     ③ 人生卡真正要改的三個欄位 eduNote／effects／decision 有得編（S22 版完全沒有）
     ④ 驗證抓得到會靜靜失效的錯誤（牌堆欄位名寫錯、未知 op、id 重複）
     ⑤ 存檔輸出的格式與 repo 內的內容包一致（2 空格縮排＋結尾換行）
   用法（repo 根目錄）： node tests/editortest.js  或  node tests/editortest.js path/to/card_editor.html */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'card_editor.html'));
(async()=>{
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1600,height:1000}});
  const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
  pg.on('console',m=>{ if(m.type()==='error' && !/404|net::ERR/.test(m.text())) errs.push('CONSOLE '+m.text()); });
  await pg.goto('file://'+TARGET,{waitUntil:'load'}); await pg.waitForTimeout(400);
  const log=await pg.evaluate(()=>{
    const L=[], A=(c,m)=>{ if(!c) throw new Error(m); };
    const step=(n,f)=>{ try{ const d=f(); L.push('OK   '+n+(d?'  '+d:'')); }catch(e){ L.push('FAIL '+n+' :: '+e.message); } };
    const $=id=>document.getElementById(id);
    const pick=(sel,val)=>{ $(sel).value=val; $(sel).dispatchEvent(new Event('change')); };

    step("11 個內容包都在選單裡（含 S22 版漏掉的 v10）",()=>{
      const opts=Array.from($("packSelector").options).map(o=>o.value);
      A(opts.length===Object.keys(PACKS).length,"選單少了包：選單 "+opts.length+" 個、資料 "+Object.keys(PACKS).length+" 個");
      ["base","mall","v10","skill","outer","special","m1","m4","m6"].forEach(k=>
        A(opts.indexOf(k)>=0,"選單缺少內容包 "+k));
      return opts.length+" 個";
    });
    step("牌堆／kind 篩選器是從真實資料長出來的",()=>{
      pick("packSelector","base");
      const decks=Array.from($("deckSelector").options).map(o=>o.value).filter(Boolean);
      A(decks.indexOf("LIFE_EVENT")>=0,"base 應該有 LIFE_EVENT 牌堆，實得 "+decks.join("／"));
      pick("deckSelector","LIFE_EVENT");
      const n=$("cardsListContainer").children.length;
      A(n>=30,"選 LIFE_EVENT 應列出整副人生卡，實得 "+n+" 張");
      const kinds=Array.from($("kindSelector").options).map(o=>o.value).filter(Boolean);
      A(kinds.indexOf("SELF_INVEST")>=0,"kind 選單應含 SELF_INVEST（真實值），實得 "+kinds.join("／"));
      return "LIFE_EVENT "+n+" 張";
    });
    step("選一張人生卡：eduNote／effects 都有得編且有值",()=>{
      pick("packSelector","base"); pick("deckSelector","LIFE_EVENT");
      $("searchInput").value="LE01"; $("searchInput").dispatchEvent(new Event('input'));
      A(currentCard && currentCard.id==="LE01","沒有選到 LE01，實得 "+(currentCard&&currentCard.id));
      A($("f_edu").value.length>5,"eduNote 欄位是空的");
      A($("f_effects").value.indexOf("ADD_CHILD")>=0,"effects 欄位沒有帶出內容");
      A($("f_raw").value.indexOf("LE01")>=0,"完整 JSON 欄位沒有帶出內容");
      return "eduNote／effects／raw 都有值";
    });
    step("選一張二選一的卡：decision 有得編",()=>{
      $("searchInput").value="SI_DEBT"; $("searchInput").dispatchEvent(new Event('input'));
      A(currentCard.id==="SI_DEBT","沒有選到 SI_DEBT");
      A($("f_decision").value.indexOf("requiresSkill")>=0,"decision 欄位應帶出先修技能設定");
      A(document.getElementById("preview").textContent.indexOf("先修")>=0,"預覽應標出先修技能");
      return "decision 可編、預覽有先修標示";
    });
    step("改欄位會即時寫回卡片物件與預覽",()=>{
      $("searchInput").value="LE01"; $("searchInput").dispatchEvent(new Event('input'));
      const old=currentCard.flavor;
      $("f_flavor").value="測試用文案"; $("f_flavor").dispatchEvent(new Event('input'));
      A(currentCard.flavor==="測試用文案","改了 flavor 沒有寫回卡片");
      A(document.getElementById("preview").textContent.indexOf("測試用文案")>=0,"預覽沒有跟著更新");
      $("f_flavor").value=old; $("f_flavor").dispatchEvent(new Event('input'));   // 還原
      A(currentCard.flavor===old,"還原失敗");
      return "雙向同步 OK";
    });
    step("小孩閘門會依牌堆自動用對的欄位名",()=>{
      pick("packSelector","base"); pick("deckSelector","LIFESTYLE");
      $("searchInput").value="LS26"; $("searchInput").dispatchEvent(new Event('input'));
      A(currentCard.id==="LS26","沒有選到 LS26");
      A(currentCard.requiresChildSinceS12===true,"LIFESTYLE 應該用 requiresChildSinceS12");
      A(!(currentCard.payload||{}).reqChild,"LIFESTYLE 不該用 payload.reqChild");
      pick("packSelector","mall"); $("searchInput").value="ML_HEA3"; $("searchInput").dispatchEvent(new Event('input'));
      A(currentCard.id==="ML_HEA3","沒有選到 ML_HEA3");
      A(currentCard.payload.reqChild===true,"MALL 應該用 payload.reqChild");
      return "兩種牌堆各用各的欄位名";
    });
    step("驗證：牌堆欄位名寫錯會被抓出來",()=>{
      const bad={id:"TMP_BAD_1",kind:"LIFESTYLE",deck:"LIFESTYLE",title:"測試",payload:{reqChild:true,cost:5}};
      const res=validateCard(bad);
      A(res.some(r=>r.level==="err" && /requiresChildSinceS12/.test(r.msg)),
        "沒抓到欄位名寫錯，實得 "+JSON.stringify(res));
      return "抓到了";
    });
    step("驗證：未知 op 與缺 id 會被抓出來",()=>{
      const bad={kind:"LIFE_EVENT",deck:"LIFE_EVENT",title:"測試",effects:[{op:"MAKE_COFFEE",amount:1}]};
      const res=validateCard(bad);
      A(res.some(r=>r.level==="err" && /缺 id/.test(r.msg)),"沒抓到缺 id");
      A(res.some(r=>r.level==="err" && /MAKE_COFFEE/.test(r.msg)),"沒抓到未知的 op");
      return "抓到了";
    });
    step("驗證：目前所有內容包都沒有結構錯誤",()=>{
      const idx=buildIdIndex(); const bad=[];
      Object.keys(PACKS).forEach(k=>{
        (function(pack){ if(!pack||!pack.cards) return;
          Object.keys(pack.cards).forEach(dk=>(pack.cards[dk]||[]).forEach(c=>{
            validateCard(c,idx).filter(r=>r.level==="err").forEach(r=>bad.push(k+" "+c.id+" "+r.msg));
          }));
        })(PACKS[k]);
      });
      A(!bad.length,bad.slice(0,3).join("；"));
      let n=0; Object.keys(PACKS).forEach(k=>{ const p=PACKS[k];
        if(p&&p.cards) Object.keys(p.cards).forEach(d=>n+=(p.cards[d]||[]).length); });
      return n+" 張卡全數通過";
    });
    step("存檔輸出格式與 repo 內的內容包一致（2 空格縮排＋結尾換行）",()=>{
      const text=JSON.stringify(PACKS.mall,null,2)+"\n";
      A(text.slice(-1)==="\n","結尾要有換行");
      A(/\n  "packId"/.test(text),"應為 2 空格縮排");
      A(text.indexOf("\\u")<0,"中文不該被跳脫成 \\u（會讓 diff 整檔翻掉）");
      return text.length+" 字元";
    });
    step("新增／複製／刪除卡片都會動到資料",()=>{
      $("searchInput").value=""; $("searchInput").dispatchEvent(new Event('input'));   // 清掉上一步留下的搜尋字
      pick("packSelector","base"); pick("deckSelector","LIFESTYLE");
      const before=PACKS.base.cards.LIFESTYLE.length;
      createNewCard();
      A(PACKS.base.cards.LIFESTYLE.length===before+1,"新增沒有生效");
      const nid=currentCard.id;
      cloneCurrentCard();
      A(PACKS.base.cards.LIFESTYLE.length===before+2,"複製沒有生效");
      A(currentCard.id!==nid,"複製後應換一個 id");
      window.confirm=()=>true;                       // 刪除會問一次，測試自動答應
      deleteCurrentCard();                            // 刪掉複製出來的那張
      A(PACKS.base.cards.LIFESTYLE.length===before+1,"刪除沒有生效");
      selectCard(PACKS.base.cards.LIFESTYLE.filter(c=>c.id===nid)[0]);
      deleteCurrentCard();                            // 再刪掉新增的那張
      A(PACKS.base.cards.LIFESTYLE.length===before,"刪除後張數應回到原本："+PACKS.base.cards.LIFESTYLE.length+" vs "+before);
      A(!PACKS.base.cards.LIFESTYLE.some(c=>c.id===nid),"新增的那張沒有被刪掉");
      $("searchInput").value=""; $("searchInput").dispatchEvent(new Event('input'));
      return "新增→複製→刪除 都正常";
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

const { chromium } = require('playwright');
/* T-001 QA 補測：驗證 S5（network-engineer）在 mpPendingBar 寫死呼叫的 ui.showIpoOffer(ipN)
   真的接得到 S2（ui-engineer）交付的函式——不是用 ui.dispatch 繞過 UI，而是真的在畫面上
   找到「📢 新股申購：點這裡申購」那個通知列並點下去，確認：
   ①不拋錯（不是 "is not a function"）②彈出的視窗真的出現兩檔資訊③按下「申購」按鈕能送出
   IPO_SUBSCRIBE 並讓兩端同步。
   用法（repo 根目錄）： node tests/qa-ipo-showoffer-test.js */
const path = require('path');
const http = require('http');
const fs = require('fs');
const TARGET = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
(async () => {
  const srv = http.createServer((q, r) => {
    r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    r.end(fs.readFileSync(TARGET));
  }).listen(0);
  const port = srv.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  const mk = async () => {
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    await p.goto('http://127.0.0.1:' + port + '/');
    await p.waitForTimeout(900);
    return p;
  };
  const A = await mk(), Bp = await mk();
  const log = [];
  const say = (ok, n, d = '') => log.push((ok ? 'OK   ' : 'FAIL ') + n + (d ? '  ' + d : ''));

  const code = await A.evaluate(async () => {
    const ui = ns.ui;
    const orig = ui.buildGameConfig;
    ui.buildGameConfig = function () { const c = orig.apply(this, arguments); c.ipoLottery = 1; return c; };
    ui.mpCreate('local');
    const ov = [...document.querySelectorAll('.overlay')].pop();
    [...ov.querySelectorAll('button')].filter(b => b.textContent === '2 人')[0].click();
    const ov2 = [...document.querySelectorAll('.overlay')].pop();
    [...ov2.querySelectorAll('button')].filter(b => b.textContent === '玩家自選')[0].click();
    const ov3 = [...document.querySelectorAll('.overlay')].pop();
    [...ov3.querySelectorAll('button')].filter(b => /^建立/.test(b.textContent))[0].click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      const lb = document.getElementById('mpLobby');
      if (lb) { const m = lb.textContent.match(/房號\s*(\d+)/); if (m) return m[1]; }
    }
    return null;
  });
  say(!!code && /^\d{4}$/.test(code), '建房成功且房號為 4 碼', '房號=' + code);

  const joined = await Bp.evaluate(async ({ code, nm }) => {
    const ui = ns.ui; ui.mpJoinPrompt('local');
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const inp = ov.querySelector('input'); inp.value = code;
    [...ov.querySelectorAll('button')].filter(b => /^加入/.test(b.textContent))[0].click();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 100));
      const lb = document.getElementById('mpLobby');
      if (lb) {
        const ni = lb.querySelector('input'); if (ni) { ni.value = nm; ni.onchange && ni.onchange(); }
        const rb = [...lb.querySelectorAll('button')].filter(b => /我準備好了/.test(b.textContent))[0];
        if (rb) { rb.click(); return true; }
      }
    }
    return false;
  }, { code, nm: '小美' });
  say(joined, '小美用 4 碼房號入房並按下準備');

  await A.waitForTimeout(500);
  const started = await A.evaluate(async () => {
    const lb = document.getElementById('mpLobby');
    const rb = [...lb.querySelectorAll('button')].filter(b => /我準備好了/.test(b.textContent))[0];
    if (rb) rb.click();
    await new Promise(r => setTimeout(r, 400));
    const lb2 = document.getElementById('mpLobby');
    const gb = [...lb2.querySelectorAll('button')].filter(b => /開局（房主）/.test(b.textContent))[0];
    if (!gb || gb.disabled) return { ok: false, why: '開局鈕' + (gb ? '停用' : '不存在') };
    gb.click();
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (ns.ui.S && ns.ui.mp.mode) return { ok: true, seed: ns.ui.S.seed, ipoOn: !!ns.ui.S.ipo };
    }
    return { ok: false, why: '開局後沒進到遊戲' };
  });
  say(started.ok, '房主開局', JSON.stringify(started));
  await Bp.waitForTimeout(1200);

  // 兩端各自 forceDue+openIpo（純函數、雜湊來自同一顆 seed，比照 S1/S5 既有手法），然後各自重新 render 一次
  const openRes = await Promise.all([A, Bp].map(pg => pg.evaluate(() => {
    const S = ns.ui.S, E = ns.engine, ui = ns.ui;
    S.ipo.schedule = [S.turnNumber]; S.ipo.fired = [false];
    E.openIpo(S, S.players[0]);
    ui.render();
    return { id: S.ipo.pending.id, tiers: Object.keys(S.ipo.pending.tiers).sort() };
  })));
  say(JSON.stringify(openRes[0]) === JSON.stringify(openRes[1]), '兩端各自開出同一組新股公告', JSON.stringify(openRes[0]));

  // 座位 1（小美，非公告者）不是決策卡對象，應該在 boardCenter 看到通知列，而不是決策卡
  const barInfo = await Bp.evaluate(() => {
    const bc = document.getElementById('boardCenter');
    const bars = bc ? [...bc.querySelectorAll('.npcThink')] : [];
    const target = bars.find(x => /新股申購：點這裡申購/.test(x.textContent));
    return { found: !!target, allTexts: bars.map(x => x.textContent) };
  });
  say(barInfo.found, '非公告者在 boardCenter 看到「📢 新股申購：點這裡申購」通知列', JSON.stringify(barInfo.allTexts));

  // 真的點下去（不是 ui.dispatch 繞過）——驗證 ui.showIpoOffer 存在且不拋錯
  const clickRes = await Bp.evaluate(() => {
    const bc = document.getElementById('boardCenter');
    const bars = [...bc.querySelectorAll('.npcThink')];
    const target = bars.find(x => /新股申購：點這裡申購/.test(x.textContent));
    let threw = null;
    try { target.click(); } catch (e) { threw = e.message; }
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const hasModal = ov && /📢 新股申購/.test(ov.textContent);
    return {
      threw, hasModal,
      modalText: ov ? ov.textContent.slice(0, 400) : null,
      hasSmallBtn: ov ? [...ov.querySelectorAll('button')].some(b => /申購（付/.test(b.textContent)) : false
    };
  });
  say(!clickRes.threw, '點擊通知列不拋錯（ui.showIpoOffer 真的是一個函式）', clickRes.threw || 'no error');
  say(clickRes.hasModal, '彈出視窗標題含「📢 新股申購」', clickRes.modalText);
  say(clickRes.hasSmallBtn, '視窗內有「申購（付…）」按鈕（兩檔資訊真的畫出來了）');

  // 按下其中一顆「申購」按鈕，確認 IPO_SUBSCRIBE 真的送出去，且兩端同步
  const beforeLog = await A.evaluate(() => ns.ui.S.actionLog.length);
  const subClick = await Bp.evaluate(() => {
    const ov = [...document.querySelectorAll('.overlay')].pop();
    const btn = [...ov.querySelectorAll('button')].find(b => /申購（付/.test(b.textContent));
    if (!btn) return { clicked: false };
    btn.click();
    return { clicked: true };
  });
  say(subClick.clicked, '點擊「申購」按鈕');
  await A.waitForTimeout(600); await Bp.waitForTimeout(200);
  const afterSub = await Promise.all([A, Bp].map(pg => pg.evaluate(() => {
    const S = ns.ui.S;
    return { subs1: S.ipo.pending ? (S.ipo.pending.subs[1] || []) : null, hash: JSON.stringify(S) };
  })));
  const afterLog = await A.evaluate(() => ns.ui.S.actionLog.length);
  say(afterLog === beforeLog + 1, 'IPO_SUBSCRIBE 真的透過網路送達房主端（actionLog +1）', 'before=' + beforeLog + ' after=' + afterLog);
  say(afterSub[0].hash === afterSub[1].hash, '兩端狀態逐位元一致', '長度=' + afterSub[0].hash.length);
  say(afterSub[0].subs1 && afterSub[0].subs1.length > 0, '座位 1 的申購真的記到 S.ipo.pending.subs', JSON.stringify(afterSub[0].subs1));

  log.forEach(x => console.log(x));
  console.log(errs.length ? ('--- page errors ---\n' + [...new Set(errs)].slice(0, 8).join('\n')) : '--- no page errors ---');
  const failN = log.filter(x => x.indexOf('FAIL') === 0).length;
  console.log(JSON.stringify({ pass: log.length - failN, fail: failN, pageErrors: errs.length }));
  await b.close(); srv.close();
  process.exit(failN || errs.length ? 1 : 0);
})();

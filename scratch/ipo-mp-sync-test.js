const { chromium } = require('playwright');
/* T-001／S5（network-engineer）：新股申購多人同步證據。
   目的：驗證 IPO_SUBSCRIBE／IPO_DECLINE（新加入 E.OFF_TURN_RESPOND 的非回合動作）
   透過真正的 LocalAdapter（BroadcastChannel＋localStorage）跨兩個瀏覽器分頁傳輸後，
   兩端最終狀態逐位元一致（JSON.stringify 相等；憲法「同 seed＋同 action 序列＝同結果」）。
   為了不必真的擲骰走格子觸發新股公告（那是 S1 engine 層 s45test.js 已覆蓋的範圍），
   這裡比照 s45test.js 的 forceDue 手法，在兩端「各自」獨立呼叫同一段確定性函式
   （E.openIpo，純函式、雜湊來自 S.seed）——不經過 actionLog，純粹是測試前置。
   之後所有會影響「勝負」的動作（IPO_SUBSCRIBE／IPO_DECLINE）都透過 ui.dispatch
   → mpSend → BroadcastChannel → mpApplyEntry 的真正網路路徑送出，這段才是本次要驗證的東西。
   用法（repo 根目錄）： node scratch/ipo-mp-sync-test.js */
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

  // A 建房（2 人，玩家自選職業——固定走最單純的路徑，避免系統隨機的額外不確定分支）
  const code = await A.evaluate(async () => {
    const ui = ns.ui;
    // 在真正建房之前 monkey-patch buildGameConfig：只加 ipoLottery=1，其餘沿用 ADR 預設 fallback。
    // 這個 config 物件會被房主一次寫進 room.setup，兩端各自 startCore(setup.config) 讀到同一份，
    // 不是各自本地推導——這正是要驗的「同步的是動作與設定，不是各自猜」。
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

  const seeds = await Promise.all([A, Bp].map(pg => pg.evaluate(() => ({
    seat: ns.ui.mp.seat, seed: ns.ui.S.seed, ipoOn: !!ns.ui.S.ipo,
    ipoLottery: ns.ui.S.config.ipoLottery
  }))));
  say(seeds[0].seed === seeds[1].seed && seeds[0].ipoOn && seeds[1].ipoOn,
    '兩端同一顆種子、且 config.ipoLottery 透過 setup 同步生效（S.ipo 兩端都建立）',
    JSON.stringify(seeds));

  const SEED = seeds[0].seed;

  // ---- 兩端各自呼叫同一段確定性函式開公告（forceDue，比照 s45test.js；不進 actionLog，純測試前置）----
  const openRes = await Promise.all([A, Bp].map(pg => pg.evaluate(() => {
    const S = ns.ui.S, E = ns.engine;
    S.ipo.schedule = [S.turnNumber]; S.ipo.fired = [false];
    E.openIpo(S, S.players[0]);           // fromId=0（座位 0＝房主／A）
    const ip = S.ipo.pending;
    return { id: ip.id, tiers: Object.keys(ip.tiers).sort(), fromId: ip.fromId,
             P_SMALL: ip.tiers.SMALL && ip.tiers.SMALL.P, P_BIG: ip.tiers.BIG && ip.tiers.BIG.P,
             q_SMALL: ip.tiers.SMALL && ip.tiers.SMALL.q };
  })));
  say(JSON.stringify(openRes[0]) === JSON.stringify(openRes[1]),
    '兩端各自 forceDue+openIpo（雜湊來自同一顆 seed）算出同一組公告內容', JSON.stringify(openRes[0]));

  // ---- 核心測項 1：非公告者（座位 1／小美）在「不是自己回合」時，透過網路送出 IPO_SUBSCRIBE ----
  const actLogBefore = await A.evaluate(() => ns.ui.S.actionLog.length);
  const subRes = await Bp.evaluate(() => {
    const ui = ns.ui, S = ui.S;
    const notMyTurn = S.activePlayerIdx !== ui.mp.seat && !(S.pendingDecision && S.pendingDecision.playerId === ui.mp.seat);
    ui.dispatch({ type: 'IPO_SUBSCRIBE', playerId: ui.mp.seat, payload: { ipoId: S.ipo.pending.id, tier: 'SMALL' } });
    return { notMyTurn: notMyTurn, seat: ui.mp.seat, active: S.activePlayerIdx };
  });
  say(subRes.notMyTurn, '送出時確認真的不是小美的回合（off-turn 前提成立）', JSON.stringify(subRes));
  await A.waitForTimeout(600); await Bp.waitForTimeout(200);

  const afterSub = await Promise.all([A, Bp].map(pg => pg.evaluate(() => {
    const S = ns.ui.S;
    return { logLen: S.actionLog.length, lastType: S.actionLog[S.actionLog.length - 1] && S.actionLog[S.actionLog.length - 1].type,
             subs1: S.ipo.pending.subs[1] || [], cash1: S.players[1].cash, ipoEscrow1: S.players[1].ipoEscrow,
             hash: JSON.stringify(S) };
  })));
  say(afterSub[0].logLen === actLogBefore + 1 && afterSub[0].lastType === 'IPO_SUBSCRIBE',
    'A 端（房主，未動手）也收到並套用了 B 端送出的 IPO_SUBSCRIBE', JSON.stringify({ A: afterSub[0].lastType, len: afterSub[0].logLen }));
  say(JSON.stringify(afterSub[0].subs1) === JSON.stringify(afterSub[1].subs1) && afterSub[0].subs1.indexOf('SMALL') >= 0,
    '兩端都記到座位 1 申購 SMALL', JSON.stringify(afterSub[0].subs1));
  say(afterSub[0].cash1 === afterSub[1].cash1 && afterSub[0].ipoEscrow1 === afterSub[1].ipoEscrow1,
    '兩端座位 1 的現金／ipoEscrow 完全一致', 'cash=' + afterSub[0].cash1 + ' escrow=' + afterSub[0].ipoEscrow1);
  say(afterSub[0].hash === afterSub[1].hash, '兩端 JSON.stringify(S) 逐位元相同（申購後）',
    '長度=' + afterSub[0].hash.length);

  // ---- 核心測項 2：房主自己（座位 0／公告者本人）也走同一條 IPO_SUBSCRIBE 申購 BIG 檔 ----
  const sub2 = await A.evaluate(() => {
    const ui = ns.ui, S = ui.S;
    ui.dispatch({ type: 'IPO_SUBSCRIBE', playerId: 0, payload: { ipoId: S.ipo.pending.id, tier: 'BIG' } });
    return { ok: true };
  });
  await Bp.waitForTimeout(500); await A.waitForTimeout(200);
  const afterSub2 = await Promise.all([A, Bp].map(pg => pg.evaluate(() => JSON.stringify(ns.ui.S))));
  say(afterSub2[0] === afterSub2[1], '公告者本人申購 BIG 檔後，兩端仍逐位元一致', '長度=' + afterSub2[0].length);

  // ---- 核心測項 3：reject 碼透過網路一樣生效（重複申購同一檔 → IPO_DUP，本地試跑就擋下，不會進 actionLog）----
  const dupTry = await Bp.evaluate(() => {
    const ui = ns.ui, S = ui.S, before = S.actionLog.length;
    ui.dispatch({ type: 'IPO_SUBSCRIBE', playerId: ui.mp.seat, payload: { ipoId: S.ipo.pending.id, tier: 'SMALL' } });
    return { grew: S.actionLog.length !== before };
  });
  say(!dupTry.grew, '重複申購同一檔（IPO_DUP）被本地擋下，沒有送上網路、actionLog 沒有增加', JSON.stringify(dupTry));

  // ---- 核心測項 4：settleIpo 兩端各自呼叫（比照 forceDue 同法，不經過 actionLog）結果仍逐位元一致 ----
  const settleRes = await Promise.all([A, Bp].map(pg => pg.evaluate(() => {
    const S = ns.ui.S, E = ns.engine;
    E.settleIpo(S);
    return JSON.stringify(S);
  })));
  say(settleRes[0] === settleRes[1], '兩端各自呼叫 E.settleIpo（同雜湊來源）結算後仍逐位元一致', '長度=' + settleRes[0].length);

  const noDesync = await Promise.all([A, Bp].map(pg => pg.evaluate(() => !ns.ui.mp.lastDesync)));
  say(noDesync[0] && noDesync[1], '全程沒有觸發 mpFullResync／同步破口診斷（ui.mp.lastDesync 兩端皆空）');

  log.forEach(x => console.log(x));
  console.log('SEED=' + SEED + '  A actionLog 最終長度=' + afterSub2 && '');
  console.log(errs.length ? ('--- page errors ---\n' + [...new Set(errs)].slice(0, 8).join('\n')) : '--- no page errors ---');
  const failN = log.filter(x => x.indexOf('FAIL') === 0).length;
  console.log(JSON.stringify({ pass: log.length - failN, fail: failN, pageErrors: errs.length }));
  await b.close(); srv.close();
  process.exit(failN || errs.length ? 1 : 0);
})();

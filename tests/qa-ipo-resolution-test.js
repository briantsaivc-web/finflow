/* T-001 QA 補測：六種解析度下，新股抽籤的三個新增 UI 元件是否會撐爆版面。
   S2（ui-engineer）回報坦承「本次沒有做額外的手動或自動化多解析度視覺測試」，
   這支測試補上：
   ①IPO_ANNOUNCE 決策卡（兩檔並排）打開時，不出現水平／垂直捲軸、不超出視窗
   ②交易所「📢 新股申購中」列存在時，版面不跑掉
   ③淨值面板「申購預扣款」顯示時，不溢出
   用法（repo 根目錄）： node tests/qa-ipo-resolution-test.js */
const { chromium } = require('playwright');
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
const SIZES = [[1024, 768], [1180, 820], [1280, 720], [1366, 768], [1440, 900], [1920, 1080]];
const FILE = 'file://' + TARGET;

function setup() {
  const ui = ns.ui, E = ns.engine;
  const cfg = ns.buildConfig(ns.configRegistry); cfg.ipoLottery = 1;
  ui.startCore(2161, cfg, ["M1", "M2", "M3", "M4", "M6", "M8"],
    ["你", "穩健阿姨", "槓桿哥", "風投弟"].map((n, i) => ({
      name: n, isNPC: i > 0,
      personality: ["", "NPC_SAFE", "NPC_LEVER", "NPC_VC"][i],
      professionId: ns.content.professions[i * 4].id, dreamCardId: ns.content.dreams[i].id
    })), { noRules: true });
  document.querySelectorAll('#overlays .overlay').forEach(o => o.remove());
  const S = ui.S;
  S.ipo = S.ipo || {}; S.ipo.schedule = [S.turnNumber]; S.ipo.fired = [false];
  E.openIpo(S, S.players[0]);   // 玩家 0（真人）踩到格 → 推 IPO_ANNOUNCE 決策進 decisionQueue
  E.syncPhase(S);               // 直接呼叫 E.openIpo 繞過正常 action 流程，要自己補這一步才會把 pendingDecision 立起來
  ui.render();
}

// 決策卡是 ui.decisionCard 畫進 #center .card（不是 #overlays .overlay，那是另一套 modal 系統，
// showIpoOffer／showSyndicateOffer 等才用 .overlay）。
function probe() {
  window.scrollTo(9999, 9999); const sx = window.scrollX, sy = window.scrollY; window.scrollTo(0, 0);
  const center = document.getElementById('center');
  const card = center ? center.querySelector('.card') : null;
  const r = card ? card.getBoundingClientRect() : null;
  return {
    scrollX: sx > 0, scrollY: sy > 0, winW: window.innerWidth, winH: window.innerHeight,
    centerOn: center ? center.classList.contains('on') : false,
    hasCard: !!card,
    decisionRect: r ? { w: +r.width.toFixed(1), h: +r.height.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1) } : null,
    twoColCount: card ? card.querySelectorAll('.twoCol').length : 0,
    bodyOverflowX: document.body.scrollWidth > window.innerWidth + 2,
    pendingKind: (() => { try { return ns.ui.S.pendingDecision && ns.ui.S.pendingDecision.kind; } catch (e) { return 'ERR:' + e.message; } })()
  };
}

function probeExchangeAndNetWorth() {
  window.scrollTo(9999, 9999); const sx = window.scrollX, sy = window.scrollY; window.scrollTo(0, 0);
  const finBoard = document.getElementById('finBoard');
  const ipoRowEls = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /新股申購中/.test(e.textContent || ''));
  const escrowEls = [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && /申購預扣款/.test(e.textContent || ''));
  return {
    scrollX: sx > 0, scrollY: sy > 0,
    hasIpoRow: ipoRowEls.length > 0,
    hasEscrowNote: escrowEls.length > 0,
    bodyOverflowX: document.body.scrollWidth > window.innerWidth + 2,
    finBoardRight: finBoard ? +finBoard.getBoundingClientRect().right.toFixed(1) : null,
    winW: window.innerWidth
  };
}

(async () => {
  const b = await chromium.launch(); let pass = 0, fail = 0;
  const A = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + m); } };
  for (const [W, H] of SIZES) {
    const pg = await b.newPage({ viewport: { width: W, height: H } });
    const errs = [];
    pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
    pg.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()); });
    await pg.goto(FILE, { waitUntil: 'load' }); await pg.waitForTimeout(700);
    await pg.evaluate(setup); await pg.waitForTimeout(250);

    // ① IPO_ANNOUNCE 決策卡
    const r1 = await pg.evaluate(probe);
    const tag = W + 'x' + H + ' ';
    A(errs.length === 0, tag + '決策卡：有 console／page error: ' + errs.slice(0, 2).join('|'));
    A(r1.pendingKind === 'IPO_ANNOUNCE', tag + 'pendingDecision.kind 應為 IPO_ANNOUNCE，實得 ' + r1.pendingKind);
    A(r1.centerOn && r1.hasCard, tag + '決策卡 IPO_ANNOUNCE 應該打開（#center.on 且有 .card）');
    A(!r1.scrollX, tag + '決策卡：出現水平捲軸');
    A(!r1.bodyOverflowX, tag + '決策卡：body 寬度超出視窗（撐爆版面）');
    A(r1.decisionRect && r1.decisionRect.right <= r1.winW + 2, tag + '決策卡右緣超出視窗：' + JSON.stringify(r1.decisionRect) + ' win=' + r1.winW);
    A(r1.decisionRect && r1.decisionRect.bottom <= r1.winH + 40, tag + '決策卡底部明顯超出視窗（可能要捲很多才看得到按鈕）：' + JSON.stringify(r1.decisionRect) + ' winH=' + r1.winH);
    A(r1.twoColCount >= 1, tag + '決策卡應有兩檔並排的 .twoCol 區塊');
    console.log(tag + '① 決策卡 ' + JSON.stringify(r1.decisionRect));

    // 關掉決策卡（送出 IPO_DECLINE），改看交易所列與淨值面板
    const declineRes = await pg.evaluate(() => {
      const ui = ns.ui, S = ui.S;
      const r = ui.dispatch({ type: 'IPO_DECLINE', playerId: 0, payload: { ipoId: S.ipo.pending.id } });
      ui.render();
      return { r, declined: S.ipo.pending && S.ipo.pending.declined };
    });
    await pg.waitForTimeout(200);
    const r2 = await pg.evaluate(probeExchangeAndNetWorth);
    A(!r2.scrollX, tag + '交易所列／淨值面板：出現水平捲軸');
    A(!r2.bodyOverflowX, tag + '交易所列／淨值面板：body 寬度超出視窗');
    A(r2.hasIpoRow, tag + '交易所應顯示「📢 新股申購中」列：declineRes=' + JSON.stringify(declineRes));
    console.log(tag + '② 交易所列 hasIpoRow=' + r2.hasIpoRow + ' bodyOverflowX=' + r2.bodyOverflowX);

    await pg.close();
  }
  console.log(JSON.stringify({ pass, fail }));
  await b.close();
  process.exit(fail ? 1 : 0);
})();

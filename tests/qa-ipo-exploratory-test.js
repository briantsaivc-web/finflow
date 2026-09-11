const { chromium } = require('playwright');
/* T-001 QA 探索測試：任務單沒寫到的邊界情況（現金邊界、垃圾 payload、連點、
   CONFIG_PATCH 竄改、破產＋雙檔申購、真的缺 key 的舊存檔、公告未決策時是否卡住其他人）。
   用法（repo 根目錄）： node tests/qa-ipo-exploratory-test.js */
const __path = require('path');
const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'index.html'));
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = []; pg.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await pg.goto('file://' + TARGET, { waitUntil: 'load' }); await pg.waitForTimeout(900);
  const log = await pg.evaluate(async () => {
    const ui = ns.ui, E = ns.engine, util = ns.util, ledger = ns.ledger, L = [];
    const step = (n, f) => { try { const d = f(); L.push('OK   ' + n + (d ? '  ' + d : '')); } catch (e) { L.push('FAIL ' + n + ' :: ' + e.message); } };
    const A = (c, m) => { if (!c) throw new Error(m); };
    const baseCfg = ns.buildConfig(ns.configRegistry);
    const MODS = ["M1", "M2", "M3", "M4", "M6", "M8"];
    const pros = ns.content.professions;
    // allHuman：預設只有 0 號是真人（跟 s45test.js 一致），可覆寫成全真人避免 NPC 自動搶先申購干擾測試。
    const mk = (seed, ov, allHuman) => {
      const c = util.clone(baseCfg); c.ipoLottery = 1; if (ov) Object.keys(ov).forEach(k => c[k] = ov[k]);
      const S = E.newGame({
        seed: seed, config: c, modules: MODS,
        players: [0, 1, 2, 3].map(i => ({
          name: 'P' + i, isNPC: allHuman ? false : i > 0,
          personality: ['NPC_SAFE', 'NPC_SAFE', 'NPC_LEVER', 'NPC_VC'][i],
          professionId: pros[i * 4].id, dreamCardId: ns.content.dreams[i].id
        }))
      });
      E.beginTurn(S);
      return S;
    };
    const forceDue = (S) => { S.ipo.schedule = [S.turnNumber]; S.ipo.fired = [false]; };
    const ap = (S, a) => E.apply(S, a, { mutate: true });
    // 正確的「把某玩家現金調整到指定金額」做法：p.cash 不能直接指定後又呼叫 ledger.recompute
    // ——recompute 會依 p.ledger 的 CASH 分錄總和重算 p.cash，直接指定會被蓋掉（無效）。
    // 要改現金，必須真的過一筆帳（比照 ADR 帳本鐵律：複式帳本是唯一真相）。
    const setCash = (S, p, target) => {
      const delta = util.r2(target - p.cash);
      if (delta !== 0) ledger.post(S, p, "測試：調整現金到 " + target, [{ account: "CASH", delta: delta, label: "test-setup" }], { eduTags: ["setup"] });
    };

    /* 0. 先驗證上面這個陷阱本身：直接指定 p.cash 後呼叫 ledger.recompute 會被蓋掉——
       這個陷阱連 S1 自己的 tests/s45test.js（161 行「⑤ reject 碼」那個 step，175/178 行）都中了，
       只是恰好沒讓那個測項失敗（BIG 檔申購價本來就遠高於玩家戰前現金，殊途同歸），這裡把它顯性記錄下來，
       避免以後有人抄同樣的寫法去測「現金剛好足夠」這種需要精確金額的邊界，會測不出真的問題。 */
    step("陷阱記錄：直接指定 p.cash 後呼叫 ledger.recompute 會被蓋掉、不是有效的測試手法", () => {
      const S = mk(100, null, true); const p1 = S.players[1];
      const real = p1.cash;
      p1.cash = 0; ledger.recompute(p1);
      A(p1.cash === real, "如果這個斷言成立，代表 p.cash=0 被 recompute 蓋回原值（陷阱重現），實得 " + p1.cash + " 應為 " + real);
      return "確認：p.cash 直接指定會被 ledger.recompute 蓋回 " + real + "（必須改用 ledger.post 才能真的調整現金）";
    });

    /* 1. 邊界：現金恰好等於「申購價＋手續費＋通知費」（<=，不是 <）應該申購得成功，不誤判成不夠 */
    step("邊界①：現金恰好等於 cost，應允許申購（不是差一點點就被 IPO_CASH 擋下）", () => {
      const S = mk(101, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const p1 = S.players[1], ip = S.ipo.pending, t = ip.tiers.SMALL;
      const fee = E.cfg(S, "ipoFee", 0.02), notice = E.cfg(S, "ipoNoticeFee", 0.05);
      const cost = util.r2(t.P + fee + notice);
      setCash(S, p1, cost);
      A(p1.cash === cost, "測試前提：現金應該真的被調整成 " + cost + "，實得 " + p1.cash);
      const r = ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL" } });
      A(!r.rejected, "現金恰好等於成本時應允許申購，實得 rejected=" + JSON.stringify(r.rejected));
      A(Math.abs(p1.cash - 0) < 0.02, "扣完後現金應歸零，實得 " + p1.cash);
      return "cost=" + cost + " 申購成功、現金歸零";
    });

    /* 2. 邊界：現金比成本少 0.01（人類幾乎看不出差異的極小差額）應該被擋下，不能透支 */
    step("邊界②：現金比成本少 0.01，應該 IPO_CASH 擋下（不能透支負現金）", () => {
      const S = mk(102, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const p1 = S.players[1], ip = S.ipo.pending, t = ip.tiers.SMALL;
      const fee = E.cfg(S, "ipoFee", 0.02), notice = E.cfg(S, "ipoNoticeFee", 0.05);
      const cost = util.r2(t.P + fee + notice);
      setCash(S, p1, util.r2(cost - 0.01));
      const cashBefore = p1.cash;
      const r = ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL" } });
      const reason = r.rejected ? (r.events || []).filter(e => e.type === "ACTION_REJECTED")[0].reason : null;
      A(reason === "IPO_CASH", "少 0.01 應該被 IPO_CASH 擋下，實得 " + JSON.stringify({ reason: reason, rejected: r.rejected }));
      A(p1.cash === cashBefore, "被拒絕時現金不該變動");
      return "少 0.01 正確擋下，現金不變＝" + p1.cash;
    });

    /* 3. 垃圾 payload：tier 是負數／物件／超長字串／ipoId 對不上、playerId 是負數或超界 —— 不該 throw，全部乾淨 reject */
    step("邊界③：各種垃圾 payload 全部乾淨 reject，不 throw、不產生 NaN", () => {
      const S = mk(103, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const ip = S.ipo.pending;
      const bads = [
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: -1 } },
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: {} } },
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL".repeat(999) } },
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: "NOT_EXIST", tier: "SMALL" } },
        { type: "IPO_SUBSCRIBE", playerId: -1, payload: { ipoId: ip.id, tier: "SMALL" } },
        { type: "IPO_SUBSCRIBE", playerId: 999, payload: { ipoId: ip.id, tier: "SMALL" } },
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: null },
        { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: null, tier: null } },
        { type: "IPO_DECLINE", playerId: NaN, payload: { ipoId: ip.id } },
        { type: "IPO_SUBSCRIBE", playerId: 1.5, payload: { ipoId: ip.id, tier: "SMALL" } },
      ];
      let threw = 0, notRejected = 0;
      bads.forEach((a, i) => {
        try {
          const r = ap(S, a);
          if (!r.rejected) notRejected++;
        } catch (e) { threw++; }
      });
      A(threw === 0, "不應該有任何一筆 throw，實得 " + threw + " 筆");
      A(notRejected === 0, "全部都應該被 reject，實得 " + notRejected + " 筆意外通過");
      S.players.forEach(p => { A(!isNaN(p.cash), "player.cash 出現 NaN"); A(!isNaN(p.derived.netWorth), "netWorth 出現 NaN"); });
      return bads.length + " 筆垃圾 payload 全部 reject、0 throw、無 NaN";
    });

    /* 4. 連點兩下（同一個 tick 內連續 dispatch 兩次同一動作）：第二次應該被 IPO_DUP 擋下，不能扣兩次錢 */
    step("邊界④：連按兩下同一顆申購鈕，第二次應該 IPO_DUP、不能被扣兩次款", () => {
      const S = mk(104, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const p1 = S.players[1], ip = S.ipo.pending;
      const cashBefore = p1.cash;
      const r1 = ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL" } });
      const cashAfterFirst = p1.cash;
      const r2 = ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL" } });
      const reason2 = r2.rejected ? (r2.events || []).filter(e => e.type === "ACTION_REJECTED")[0].reason : null;
      A(!r1.rejected, "第一次申購應成功");
      A(reason2 === "IPO_DUP", "第二次連點應該是 IPO_DUP，實得 " + JSON.stringify(r2.rejected) + "/" + reason2);
      A(p1.cash === cashAfterFirst, "連點第二下不該再扣一次錢，實得從 " + cashAfterFirst + " 變成 " + p1.cash);
      A(ip.subs[1].length === 1, "subs 裡只該記一筆，實得 " + JSON.stringify(ip.subs[1]));
      return "連點兩下：只扣一次錢，cash " + cashBefore + "→" + cashAfterFirst + "（第二下被擋）";
    });

    /* 5. CONFIG_PATCH 想在遊戲中途把 ipoLottery 從 1 改成 0：S.ipo 是開局時就建好的，
       改 config 不該讓正在進行中的 S.ipo 消失或產生不一致（D2：S.ipo 只在 newGame 建立）。 */
    step("邊界⑤：CONFIG_PATCH 中途改 ipoLottery 不會讓進行中的 S.ipo 憑空消失或損毀", () => {
      const S = mk(105, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const beforeIpo = JSON.stringify(S.ipo);
      const r = ap(S, { type: "CONFIG_PATCH", playerId: 0, payload: { key: "ipoLottery", value: 0 } });
      A(JSON.stringify(S.ipo) === beforeIpo, "CONFIG_PATCH 改 ipoLottery 不該動到正在進行中的 S.ipo：" +
        "\n前=" + beforeIpo + "\n後=" + JSON.stringify(S.ipo));
      S.players.forEach(p => A(!isNaN(p.cash), "cash 出現 NaN"));
      return "CONFIG_PATCH rejected=" + JSON.stringify(r.rejected) + "，S.ipo 不受影響";
    });

    /* 6. 破產玩家同時申購兩檔（小資＋股王）後宣告破產：兩筆都要先退款（不是只退一筆），
       且退款金額、ipoEscrow 歸零、subs 移除都要正確，不能留下殘影或 NaN。 */
    step("邊界⑥：玩家同時申購兩檔後破產，兩筆申購款都要先退，不能只退一筆或漏退", () => {
      const S = mk(106, null, true); forceDue(S); E.openIpo(S, S.players[0]);
      const p1 = S.players[1], ip = S.ipo.pending;
      setCash(S, p1, 999999);
      ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "SMALL" } });
      ap(S, { type: "IPO_SUBSCRIBE", playerId: 1, payload: { ipoId: ip.id, tier: "BIG" } });
      A(ip.subs[1].length === 2, "應該兩檔都申購成功，實得 " + JSON.stringify(ip.subs[1]));
      const escrowBefore = p1.ipoEscrow;
      A(escrowBefore > 0, "破產前 ipoEscrow 應該 >0，實得 " + escrowBefore);
      E.declareBankrupt(S, p1);
      A(p1.ipoEscrow === 0, "破產後 ipoEscrow 應該歸零，實得 " + p1.ipoEscrow);
      A(!ip.subs[1] || ip.subs[1].length === 0, "破產後 subs 應該把這個玩家清掉，實得 " + JSON.stringify(ip.subs[1]));
      A(!isNaN(p1.cash), "破產玩家的 cash 不該是 NaN");
      return "破產前 ipoEscrow=" + escrowBefore + "，破產後歸零、subs 清空、cash=" + p1.cash;
    });

    /* 7. 真的「缺 key」的舊存檔（不是 ipoLottery:0，是整個 key 都不存在）：
       用真正的 E.newGame 走一次真正的舊格式 config，確認不會 throw、不會建立 S.ipo。 */
    step("邊界⑦：config 裡完全沒有 ipoLottery 這個 key（真的舊存檔，不是設成 0）不觸發、不 throw", () => {
      const cfgOld = util.clone(baseCfg); delete cfgOld.ipoLottery;
      A(cfgOld.ipoLottery === undefined, "測試前提：cfgOld 真的沒有這個 key");
      const S = E.newGame({
        seed: 107, config: cfgOld, modules: MODS,
        players: [0, 1, 2, 3].map(i => ({
          name: 'P' + i, isNPC: i > 0,
          personality: ['NPC_SAFE', 'NPC_SAFE', 'NPC_LEVER', 'NPC_VC'][i],
          professionId: pros[i * 4].id, dreamCardId: ns.content.dreams[i].id
        }))
      });
      A(!S.ipo, "缺 ipoLottery key 時不該建立 S.ipo，實得 " + JSON.stringify(S.ipo));
      E.beginTurn(S);
      for (let i = 0; i < 15; i++) { E.apply(S, { type: "ROLL_DICE", playerId: E.activePlayer(S).id, payload: null }, { mutate: true }); }
      A(!S.ipo, "跑了 15 步之後仍然不該有 S.ipo");
      return "整局跑完 S.ipo 全程 undefined，無 throw";
    });

    /* 8. 公告者（announcer）自己還沒決定 IPO_ANNOUNCE（沒申購也沒婉拒）時，
       別的「真人」玩家是否還能正常送出 IPO_SUBSCRIBE／IPO_DECLINE？
       用全真人陣容，確保不是被 NPC 自動搶先申購污染，真正驗證「只卡公告者，不卡全桌」。 */
    step("邊界⑧：公告者自己還沒回應 IPO_ANNOUNCE 時，其他真人玩家的 IPO_SUBSCRIBE 不受影響", () => {
      const S = mk(108, null, true); forceDue(S);
      const announcer = S.players[0];
      E.openIpo(S, announcer);
      E.syncPhase(S);
      A(S.pendingDecision && S.pendingDecision.kind === "IPO_ANNOUNCE" && S.pendingDecision.playerId === 0,
        "公告者應該卡在 IPO_ANNOUNCE 決策，實得 " + JSON.stringify(S.pendingDecision));
      A(!S.ipo.pending.subs[2], "測試前提：這局全真人，玩家 2 這時候還不該有任何申購紀錄");
      const r = ap(S, { type: "IPO_SUBSCRIBE", playerId: 2, payload: { ipoId: S.ipo.pending.id, tier: "SMALL" } });
      A(!r.rejected, "公告者還沒回應時，別的玩家一樣可以正常申購，實得 rejected=" + JSON.stringify(r.rejected) +
        " reason=" + (r.rejected ? (r.events || []).filter(e => e.type === "ACTION_REJECTED")[0].reason : null));
      A(S.pendingDecision && S.pendingDecision.kind === "IPO_ANNOUNCE", "公告者的決策卡應該仍然掛著，沒有被別人的申購動作意外清掉");
      return "公告者未回應 IPO_ANNOUNCE 時，其他真人玩家的 IPO_SUBSCRIBE 正常成功、公告者決策卡不受影響";
    });

    return L;
  });
  log.forEach(x => console.log(x));
  console.log(errs.length ? ('--- page errors ---\n' + [...new Set(errs)].slice(0, 8).join('\n')) : '--- no page errors ---');
  const failN = log.filter(x => x.indexOf('FAIL') === 0).length;
  console.log(JSON.stringify({ pass: log.length - failN, fail: failN, pageErrors: errs.length }));
  await b.close();
  process.exit(failN || errs.length ? 1 : 0);
})();

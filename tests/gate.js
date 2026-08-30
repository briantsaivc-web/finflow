/* 壓力閘門：1000 局跨三種 NPC 陣容，只驗「不變式」不驗手感。
   任何一項不是 0 就是回歸，不要放行。

   - NaN / Infinity：現金、淨值、資產、負債、被動收入都必須是有限數
   - invalidGames：模擬器自己判定這局跑壞了（死結、超時）
   - assetLedgerMismatch：每筆資產的 ASSET 分錄餘額必須等於 marketValue（鐵律三）

   用法（在 repo 根目錄，需先 python3 tests/extract.py）：node tests/gate.js */
const fs = require('fs'), path = require('path');
const D = __dirname;

eval(fs.readFileSync(path.join(D, 'test_engine.js'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(D, 'test_content.json'), 'utf8'));
ns.configRegistry = JSON.parse(raw['config-default']);
ns.loadContent(id => raw[id] ? JSON.parse(raw[id]) : null);

const cfg = ns.buildConfig(ns.configRegistry);
const mods = ['M1', 'M2', 'M3', 'M4', 'M6', 'M8'];
const lineups = [['NPC_SAFE', 'NPC_LEVER', 'NPC_VC', 'NPC_SAFE'],
                 ['NPC_VC', 'NPC_VC', 'NPC_SAFE'],
                 ['NPC_LEVER', 'NPC_SAFE']];

let nan = 0, inf = 0, invalid = [], assetMismatch = 0, games = 0;
for (let g = 0; g < 1000; g++) {
  const S = ns.sim.playOne(cfg, mods, (31337 + g * 7919) >>> 0, lineups[g % 3]);
  games++;
  if (S.simStatus && !S.simStatus.valid) { invalid.push(S.simStatus.reason); continue; }
  S.players.forEach(p => {
    const d = p.derived;
    [p.cash, d.netWorth, d.totalAssets, d.totalLiabilities, d.passiveIncome].forEach(v => {
      if (Number.isNaN(v)) nan++;
      if (!isFinite(v)) inf++;
    });
    const bal = {};
    p.ledger.forEach(en => en.postings.forEach(q => {
      if (q.account === "ASSET" && q.refId) bal[q.refId] = (bal[q.refId] || 0) + q.delta;
    }));
    p.assets.forEach(a => {
      const b = ns.util.r2(bal[a.instanceId] || 0);
      if (Math.abs(b - (a.marketValue || 0)) > 0.02) assetMismatch++;
    });
  });
}
const rc = {}; invalid.forEach(r => rc[r] = (rc[r] || 0) + 1);
console.log(JSON.stringify({ games, NaN: nan, Infinity: inf, invalidGames: invalid.length,
  invalidReasons: rc, assetLedgerMismatch: assetMismatch }));
process.exit((nan || inf || invalid.length || assetMismatch) ? 1 : 0);

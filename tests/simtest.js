/* 平衡指紋：500 局，輸出自由圈規格 v0.2 的六項指標＋各性格 NPC 的表現。
   改任何數值之後跑這支，跟上一版的數字逐項對照——沒對照過的平衡調整不算數。

   用法（在 repo 根目錄，需先 python3 tests/extract.py）：
     node tests/simtest.js
     node tests/simtest.js '{"fixedPaydayOn":0}'   ← 覆寫 config 做 A/B

   驗收帶（v0.2）：外圈耗時中位 8–12、跌落率 10–25%、免費點占比 15–35%、
   全局中位 ≤58、全局 P90 ≤72、四類圓夢中位差 ≤1.5 輪、SAFE 破產率 ≤8%。 */
const fs = require('fs'), path = require('path');
const D = __dirname;
const over = process.argv[2] ? JSON.parse(process.argv[2]) : {};

eval(fs.readFileSync(path.join(D, 'test_engine.js'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(D, 'test_content.json'), 'utf8'));
ns.configRegistry = JSON.parse(raw['config-default']);
ns.loadContent(id => raw[id] ? JSON.parse(raw[id]) : null);

const cfg = ns.buildConfig(ns.configRegistry);
Object.keys(over).forEach(k => cfg[k] = over[k]);

const r = ns.sim.run({ games: 500, seedBase: 4242, config: cfg,
  modules: ['M1', 'M2', 'M3', 'M4', 'M6', 'M8'],
  lineup: ['NPC_SAFE', 'NPC_LEVER', 'NPC_VC', 'NPC_SAFE'] });

const med = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
const pct = (a, q) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(b.length * q))]; };
const turns = r.rows.map(x => x.turns), os = r.outerStats;

console.log(JSON.stringify({
  over,
  invalid: r.invalid ? (r.invalid.length || r.invalid) : 0,
  v02: {
    外圈耗時中位: os.outerMedian, 外圈P90: os.outerP90,
    跌落率: +(os.freefallRate * 100).toFixed(1),
    免費點占比: +(os.freeShare * 100).toFixed(1),
    全局中位: med(turns), 全局P90: pct(turns, 0.9),
    四類圓夢中位: os.catMedian, 畢業人次: os.grads
  },
  persona: r.summary.map(x => ({ p: x.personality,
    free: +(x.freeRate * 100).toFixed(1), bk: +(x.bankruptRate * 100).toFixed(1),
    medFree: x.medianFreeTurn, medNW: Math.round(x.medianNetWorth) }))
}, null, 1));

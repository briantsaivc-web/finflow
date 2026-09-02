/* 內容包靜態檢查（不開瀏覽器、不跑模擬）：改完 src/data 之後第一個跑的東西。
   抓的是「JSON 看起來沒錯、引擎卻不認」的洞——S21 那批 30 張卡有一半栽在這裡。

   檢查項目：
   1. 每個 JSON 能解析；id 全域唯一；id/kind/title 必填
   2. effects 只用引擎認得的 op（清單從 src/engine 原始碼掃出來，不是手寫）
   3. MACRO_EVENT 的玩家級 op 必須標 target（S13.1 NEW-02）
   4. 各牌堆的小孩閘門欄位名：MALL 用 payload.reqChild、LIFESTYLE/LIFE_EVENT 用 requiresChildSinceS12
   5. 機會卡數值：REALESTATE 要 price/monthlyRent/monthlyCost，BUSINESS 要 price/monthlyProfit，STARTUP 要 investAmount/equityPct/postMoney
   6. 金額量級：單筆金額 > 50000 視為疑似把「千元」寫成「元」（S21 獨董那種）
   7. requiresSkill / requiresAnySkill / skillBranch.requires / DIGITAL.requires 指到的技能 id 必須存在
   8. 引擎與測試裡寫死的 id 必須還在（改名或刪卡前先查這份清單）
   9. CHOICE 卡的第 1 個選項是「建議選項」——若第 1 個選項效果含 CASH_DELTA 正數且第 2 個含 GRANT_VIRTUE 正數，提醒順序可能反了

   用法（repo 根目錄）：node tests/contentcheck.js        非 0 結束碼＝有錯 */
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const PACKS = path.join(ROOT, 'src/data/packs');
const errs = [], warns = [];
const E = (m) => errs.push(m), W = (m) => warns.push(m);

// ---- 1. 載入 ----
const packs = {};
for (const f of fs.readdirSync(PACKS).filter(x => x.endsWith('.json')).sort()) {
  try { packs[f] = JSON.parse(fs.readFileSync(path.join(PACKS, f), 'utf8')); }
  catch (e) { E(`${f} 不是合法 JSON：${e.message}`); }
}
const all = [];   // {card, deck, file}
const ids = new Map();
for (const [f, d] of Object.entries(packs)) {
  for (const [deck, cards] of Object.entries(d.cards || {})) {
    if (!Array.isArray(cards)) { E(`${f} cards.${deck} 不是陣列`); continue; }
    cards.forEach((c, i) => {
      if (!c.id || !c.kind) E(`${f} ${deck}[${i}] 缺 id 或 kind：${JSON.stringify(c).slice(0, 60)}`);
      if (!c.title && deck !== 'DREAM') E(`${f} ${deck} ${c.id} 缺 title`);
      if (c.id) { if (ids.has(c.id)) E(`id 重複：${c.id}（${ids.get(c.id)} 與 ${f}）`); else ids.set(c.id, f); }
      all.push({ c, deck, f });
    });
  }
  for (const p of d.professions || []) { if (ids.has(p.id)) E(`id 重複：${p.id}`); else ids.set(p.id, f); }
}

// ---- 2. 引擎認得的 op ----
const engineSrc = ['core/engineCore.js', 'reducer/applyAction.js', 'npc/contentNpcSim.js']
  .map(x => fs.readFileSync(path.join(ROOT, 'src/engine', x), 'utf8')).join('\n');
const knownOps = new Set([...engineSrc.matchAll(/case "([A-Z_]+)":/g)].map(m => m[1]));
const PLAYER_OPS = new Set((engineSrc.match(/E\.MACRO_PLAYER_OPS = \[([^\]]+)\]/) || ['', ''])[1].match(/"([A-Z_]+)"/g)?.map(x => x.replace(/"/g, '')) || []);
function walkEffects(list, where) {
  for (const e of list || []) {
    if (!e || !e.op) { E(`${where} 效果缺 op：${JSON.stringify(e)}`); continue; }
    if (!knownOps.has(e.op)) E(`${where} 用了引擎沒有的 op：${e.op}`);
    if (e.op === 'DELAYED_EFFECTS') walkEffects(e.effects, where + '→DELAYED');
    for (const k of ['amount', 'cost']) if (typeof e[k] === 'number' && Math.abs(e[k]) > 50000) W(`${where} ${k}=${e[k]}：疑似把千元寫成元`);
  }
}
for (const { c, deck, f } of all) {
  const where = `${f} ${deck} ${c.id}`;
  walkEffects(c.effects, where);
  for (const o of (c.decision && c.decision.options) || []) walkEffects(o.effects, where + ' 選項');
  if (c.skillBranch) { walkEffects((c.skillBranch.have || {}).effects, where + ' have'); walkEffects((c.skillBranch.miss || {}).effects, where + ' miss'); }
  if (c.virtueBranch) for (const [k, v] of Object.entries(c.virtueBranch)) if (v && v.effects) walkEffects(v.effects, where + ' ' + k);
  // 3. macro target
  if (deck === 'MACRO_EVENT') for (const e of c.effects || []) if (PLAYER_OPS.has(e.op) && !e.target) W(`${where} 玩家級 op ${e.op} 未標 target（引擎會視為 all——若本意不是全體請明寫）`);
  // 4. 小孩閘門欄位名
  if (deck === 'MALL' && (c.requiresChild || c.requiresChildSinceS12)) E(`${where} MALL 的小孩閘門要寫 payload.reqChild`);
  if ((deck === 'LIFESTYLE' || deck === 'LIFE_EVENT') && c.payload && c.payload.reqChild) E(`${where} 這個牌堆的小孩閘門要寫 requiresChildSinceS12`);
  // 5. 機會卡欄位
  const pl = c.payload || {};
  if (/^OPPORTUNITY/.test(deck)) {
    const need = { REALESTATE: ['price', 'monthlyRent', 'monthlyCost'], BUSINESS: ['price', 'monthlyProfit'], STARTUP: ['investAmount', 'equityPct', 'postMoney'] }[c.kind];
    if (!need) E(`${where} 機會牌堆不支援 kind=${c.kind}`);
    else for (const k of need) if (typeof pl[k] !== 'number') E(`${where} ${c.kind} 缺數值欄位 ${k}`);
    if (pl.isScam && !(pl.scamDelayTurns > 0)) E(`${where} isScam 要配 scamDelayTurns`);
  }
  // 6. 金額量級
  for (const k of ['price', 'cost', 'downPayment', 'investAmount', 'annualPremium', 'monthlyProfit', 'monthlyRent', 'fineAmount'])
    if (typeof pl[k] === 'number' && pl[k] > 50000) W(`${where} payload.${k}=${pl[k]}：疑似把千元寫成元`);
  if (typeof c.cost === 'number' && c.cost > 50000) W(`${where} cost=${c.cost}：疑似把千元寫成元`);
  // 7. 技能參照
  const refs = [].concat(c.requiresSkill || [], c.requiresAnySkill || [], c.requiresNotSkill || [], (c.skillBranch || {}).requires || [], deck === 'DIGITAL' ? (c.requires || []) : []);
  for (const r of refs) if (!/^family:/.test(r) && !ids.has(r)) E(`${where} 參照不存在的技能 ${r}`);
  // 9. CHOICE 順序
  if (c.kind === 'CHOICE' && c.decision && c.decision.options && c.decision.options.length >= 2) {
    const o0 = c.decision.options[0].effects || [], o1 = c.decision.options[1].effects || [];
    const cashFirst = o0.some(e => e.op === 'CASH_DELTA' && e.amount > 0), virtueSecond = o1.some(e => e.op === 'GRANT_VIRTUE' && e.delta > 0);
    if (cashFirst && virtueSecond) W(`${where} 第 1 個選項是「拿錢」、第 2 個是「修品格」——第 1 個選項會被標成建議、NPC 也會選它，順序可能反了`);
  }
}
// ---- 8. 程式碼與測試裡寫死的 id ----
const codeSrc = engineSrc + ['ui/uiCore.js', 'ui/uiViews.js', 'ui/tutorial.js', 'network/syncAdapter.js'].map(x => fs.readFileSync(path.join(ROOT, 'src', x), 'utf8')).join('\n');
const testSrc = fs.readdirSync(__dirname).filter(x => x.endsWith('.js') && !/test_engine|contentcheck/.test(x)).map(x => fs.readFileSync(path.join(__dirname, x), 'utf8')).join('\n');
const idLike = new Set([...(codeSrc + testSrc).matchAll(/["'](PRO_[A-Z0-9_]+|SKL_[A-Z0-9_]+|SKE_[A-Z0-9_]+|BDG_[A-Z0-9_]+|DIG_[A-Z0-9_]+|ML_[A-Z0-9_]+|OL_[A-Z0-9_]+|OPS_[A-Z0-9_]+|OPL_[A-Z0-9_]+|OPP_[A-Z0-9_]+|LS\d+|LE\d+|LE_[A-Z0-9_]+|LT_[A-Z0-9_]+|MA\d+|MK\d+|MKT_[A-Z0-9_]+|MACRO_[A-Z0-9_]+|CHOICE_[A-Z0-9_]+|PE_[A-Z0-9_]+)["']/g)].map(m => m[1]));
const NOT_IDS = new Set(['OPP_PICKED', 'OPP_DUAL_DRAWN', 'MACRO_TRANSITION', 'MACRO_EVENT']);   // 事件名，長得像 id
const codeIds = new Set([...codeSrc.matchAll(/["']([A-Z]+_[A-Z0-9_]+|LS\d+|LE\d+|MA\d+|MK\d+)["']/g)].map(m => m[1]));
for (const id of idLike) {
  if (ids.has(id) || NOT_IDS.has(id)) continue;
  if (codeIds.has(id)) E(`引擎／介面寫死了 id「${id}」，但內容包裡已經沒有這張——改名或刪卡要一起改程式`);
  else W(`測試寫死了 id「${id}」，內容包裡沒有（若是刻意驗「已移除」可忽略）`);
}

// ---- 輸出 ----
const cnt = all.length;
console.log(`內容包 ${Object.keys(packs).length} 個／卡片 ${cnt} 張／職業 ${Object.values(packs).reduce((s, d) => s + (d.professions || []).length, 0)}／引擎 op ${knownOps.size} 種／程式寫死 id ${idLike.size} 個`);
warns.forEach(w => console.log('WARN ' + w));
errs.forEach(e => console.log('FAIL ' + e));
console.log(JSON.stringify({ errors: errs.length, warnings: warns.length }));
process.exit(errs.length ? 1 : 0);

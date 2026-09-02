# FinFlow S23 工程書：股息修正・下市機率制・M9 進階金融
版本 v1.0（2026-09-03）｜基線 v2.27.0-S22（commit a14ab14）｜狀態：待 Brian 核可後實作

---

## 0. 決策紀錄（2026-09-03 討論定案）

| # | 題目 | 定案 |
|---|---|---|
| D1 | 股息跟景氣走 | 是：掛景氣係數 |
| D2 | 殖利率上限 | **年化 18%**（每張月股息 ＝ min(面額 × 0.4%，現價 × 1.5%)）；理由：房地產隨便 50%，太低沒人玩這機制 |
| D3 | 高股息地板價＋太電事件 | 是：STK_DIV 地板 0.4、太電事件一局一次 |
| D4 | 再投入那一列改文案 | 是，與 D1–D3 一次改 |
| D5 | 下市改機率制 | 是；投機股與**成長股**都會倒（成長股機率很低）；融資戶的債照現行（sellAsset(0) 轉信貸留在身上） |
| D6 | 期貨 | 開放**做空** |
| D7 | 解鎖條件 | 學會「衍生性商品與槓桿」技能，**或**任一檔股票**累計**持股 12 輪（不需連續） |
| D8 | 虛擬貨幣 | 一檔，**迷因幣**（可歸零） |
| D9 | 模組 | 獨立 **M9「進階金融」**（日後匯率、債券都掛這裡） |

金額單位：千元。所有新數值都掛 `defaultParams.json` 開關，開關全關＝S22 行為（鐵律 4）。

---

## 1. 股息修正（S23a）

### 1.1 現況（回查程式碼）
- `E.autoBuyUnits`／`TRADE_STOCK`：每張月股息 `div = units × def.face × dividendYieldMonthly`，**依面額固定**，寫進 `asset.monthlyIncome`，之後不再變動（`E.revalueStocks` 註解明寫「不隨價格調整」）。
- `E.tickAutoInvest` 股息再投入：`budget = Σ lots.monthlyIncome + carry`，用 `autoBuyUnits` 買回；帳務正確（S22 已逐筆核對）。
- 漏洞：STK_DIV 面額 28、地板 `stockFloorMult 0.1`＝2.8；價格 4.63 時殖利率月 2.4%（年 29%），地板時年 58%；DCA＋DRIP 成印鈔機（實測局：被動收入 1,479／月）。

### 1.2 改法
**(a) 股息改為「每輪重算」而不是「買進時定死」**
- 新函式 `E.stockDivPerUnit(S, def)`：
  ```
  base   = def.face × def.dividendYieldMonthly                      // 面額固定股息（現行）
  cap    = E.stockPrice(S,def) × cfg.stockYieldCapMonthly           // D2：現價 × 1.5%
  macro  = cfg["divMult_"+S.macro.stage]                            // D1：復甦 1.0／過熱 1.1／衰退 0.8／蕭條 0.5
  return r2(min(base, cap) × macro)
  ```
- `M1.onRoundEnd` 在 `E.revalueStocks` 之後新增 `E.restockDividends(S)`：對每個 STOCK 部位（含融資倉）把 `monthlyIncome` 重設為 `units × stockDivPerUnit`，差額記一筆 `INCOME_PASSIVE` 分錄「〇〇 股息調整（景氣／殖利率上限）」——與「股價變動」同一時點，玩家在每輪紀錄裡看得到股息被砍。
- 買進時仍用 `stockDivPerUnit`（所以買進當下就是砍過的數字，介面對得上）。
- 開關：`stockDivRestock`（1＝新制，0＝S22 行為）。`divMult_*` 四個與 `stockYieldCapMonthly` 都是 hot 參數。

**(b) 地板與事件（D3）**
- `stockDefs.STK_DIV.floorMult: 0.4`（其餘檔沿用全域 `stockFloorMult 0.1`）；`E.clampPrice` 改讀 `def.floorMult ?? cfg.stockFloorMult`。
- `MKT_TAIDIAN_DELIST`（太電）加 `oncePerGame: true`；`E.cardUsable` 對 MACRO_EVENT 實作 `oncePerGame`（現只在 MALL 有）：抽過記 `S.macroDone[id]`。順手把 `MKT_BODA_FRAUD`、`MKT_BIOTECH_UNBLIND` 也掛上（三張案例事件一局各一次）。

**(c) 介面（D4）**
- 每輪紀錄那一列摘要改成：「股息再投入：本期股息 760,400 → 買 富穩電信 164 張（含手續費 1,080）」。資料來源：`ledger.post` 的 `summary` 由 `E.tickAutoInvest` 組字串，`detail` 帶 `{dividend, units, fee}`。
- 股市面板該檔股票的說明加一行：「每張月股息 112 元（現價殖利率 2.4%／月；上限 1.5%／月＝年化 18%，景氣係數 ×0.8）」——三個數字都從 `stockDivPerUnit` 的中間值拿，不另算。

### 1.3 預期效果（要用 simtest 驗）
- 正常區間（價格 ≥ 面額 27%）股息不變；崩盤區才砍。
- 500 局指紋：三種 NPC 自由率變動應在 ±2 點內（NPC 幾乎不用 DRIP）；真人策略上限被壓到年化 18% × 景氣係數。

---

## 2. 下市機率制（S23a）

### 2.1 現況
`E.delistRisk`：只有 `delistable`（投機股）；條件＝蕭條 **且** 價格 ≤ 面額 × 0.2（12 × 0.2 ＝ 2.4，畫面 2,400）；警示 2 輪後**必倒**。定值＋必倒 → 可被算出。

### 2.2 改法：每輪擲一次
```
E.delistHazard(S, def) → 0..1
  if !delistOn || !def.delistable(或 def.delistHazardMult>0) || delisted → 0
  dd = 1 − price / def.face                                  // 從面額算的跌幅
  thr = S.delistThreshold[def.symbol]                        // 開局暗抽：uniform(cfg.delistDdMin 0.75, cfg.delistDdMax 0.90)，util.rand(S)
  if dd < thr → 0                                            // 沒進危險區
  base = {RECOVERY:0, BOOM:0, RECESSION:cfg.delistHazardRecession 0.08, DEPRESSION:cfg.delistHazardDepression 0.25}[stage]
  if dd ≥ 0.90 → base ×= 2
  base += cfg.delistHazardPerTurn(0.03) × (連續在危險區的輪數 − 1)
  return min(0.9, base × (def.delistHazardMult ?? 1))
```
- `stockDefs`：STK_SPEC `delistable:true, delistHazardMult:1`；STK_TECH 新增 `delistable:true, delistHazardMult:0.12`（蕭條跌深時約 3%／輪——D5「很低」）；ETF、高股息 0。
- `E.tickDelist`（M1.onRoundEnd 內）：
  1. 計算 hazard；hazard>0 → `S.delistWatch[sym] = {since, streak, hazard}` 並每輪更新 `streak`；hazard 回 0 → 解除（沿用現行 DELIST_CLEARED）。
  2. **不再有固定 2 輪緩衝**：第 1 輪進危險區只警示不擲（給玩家一輪反應，保留現行「先警告再下市」精神，`cfg.delistGraceTurns 1`）；之後每輪 `util.rand(S) < hazard` 就下市，走現行歸零流程（融資轉信貸——D5）。
  3. 事件 `DELIST_WARNED` 帶 `{level: 低/中/高, hazard}`；等級門檻 <0.1 低、<0.25 中、其餘高。
- 決策卡 `DELIST_WARN`（持股者自己回合跳）：顯示「倒閉風險：中」；有 `SKL_BOOK`／`SKL_CPA_AUDIT` 的顯示「本輪倒閉機率 16%、已在危險區 3 輪」。每輪風險等級變化才重跳卡（不要每輪都跳）。
- NPC：現行「看到警示就賣」改成「風險≥中就賣；低只在保守派賣」。
- 開關 `delistMode`：`"fixed"`（S22）／`"hazard"`（新制，預設）。

### 2.3 平衡預估（要用 300 局統計驗）
蕭條平均停留 3–5 輪；投機股跌破 80% 後在蕭條連續 3 輪的累積倒閉率 ≈ 1−(0.75×0.72×0.69) ≈ 63%；衰退 3 輪 ≈ 24%。成長股同情境 ≈ 8%／3%。目標：每 100 局投機股下市 25–40 次（現行實測值先量出來當基準）、成長股 2–5 次。

---

## 3. M9 進階金融（S23b 期貨、S23c 迷因幣）

### 3.1 模組骨架
- `M.registry.M9 = { onRoundEnd, onTurnStart, decorateDecision }`；`ns.PRESETS`：ADVANCED、HARDCORE、SANDBOX 加 `"M9"`；NOVICE、STANDARD 不加。開局面板多一個勾選「M9 進階金融（期貨／迷因幣）」。
- 全域開關 `advancedMarketsEnabled`（1）；M9 未啟用時股市面板不顯示兩個分頁。

### 3.2 解鎖（D7）
- `p.stockHoldTurns`：每輪結束時（onRoundEnd）若該玩家持有任一 STOCK 部位（現股或融資）就 +1；**累計**，賣光不歸零。
- `E.advancedUnlocked(S,p) = E.hasSkill(p,"SKL_DERIV") || p.stockHoldTurns ≥ cfg.advUnlockHoldTurns(12)`。
- 解鎖前：面板兩個分頁反灰，標「🔒 還差 N 輪持股經驗，或學會〈衍生性商品與槓桿〉」；引擎端所有 M9 動作 `reject("ADV_LOCKED")`，`ui.REJECT_TEXT.ADV_LOCKED` 補中文。解鎖當輪 `E.ev("ADV_UNLOCKED")` → 系統訊息＋toast 一次。
- 新技能 `SKL_DERIV`「衍生性商品與槓桿」：HIGH、family FINANCE、`requiresSkill: SKL_BOOK`、學費 45、4 輪、不過時。功能：解鎖 M9；期貨維持率門檻放寬（追繳線 1.3 → 1.2）；看得到迷因幣「交易所風險」提示。

### 3.3 期貨（台指期，D6 可做空）
資料：`base.json` 新增 `futuresDefs: [{symbol:"FUT_TX", name:"寶島指數期貨", underlying:"STK_ETF", multiplier:10, marginPct:0.10, maintPct:0.05, feePerLot:0.3}]`。

| 項目 | 規則 |
|---|---|
| 合約 | 一口＝ETF 現價 × 10（千元）；例：ETF 60 → 一口 600 |
| 保證金 | 開倉付合約值 10%（60）進「期貨保證金」資產（kind `FUTURES`，marketValue＝保證金餘額，monthlyIncome 0） |
| 方向 | `side: "long"/"short"`；同一標的多空不能同時持有（先平倉） |
| 結算 | M9.onRoundEnd 在 M1 算完 ETF 新價之後：每口損益 ＝ (新價 − 前價) × 10 × (long ? +1 : −1)，直接加減保證金餘額，記分錄 `ASSET ±`「期貨逐輪結算」 |
| 追繳 | 保證金餘額 < 合約值 × maintPct(5%)：推決策 `FUT_MARGIN_CALL`（補到 10% 或平倉）；玩家自己回合才跳（比照 DELIST_WARN 的 pendingXXX 模式，避免 S15d 死結）；餘額 ≤ 0 → 強制平倉，超額虧損轉信貸（比照融資） |
| 口數上限 | `cfg.futMaxLots` 依信用評級 A/B/C ＝ 5/3/1 |
| 平倉 | 任何自己回合或非回合（比照 S14a-2 非回合買賣）；退回保證金餘額 − 手續費 |
| 動作 | `FUT_OPEN {symbol, side, lots}`、`FUT_CLOSE {instanceId}`、`FUT_TOPUP {instanceId, amount}` |
| 記帳關卡 | 新增第七套「保證金與逐輪結算」（資產±、現金）；S13 六套的排序表加一列，share 先估 0.5% |

### 3.4 迷因幣（D8）
- `stockDefs` 新增 `{symbol:"CRY_MEME", name:"狗狗星幣", face:1, dividendYieldMonthly:0, vol:0.32, macroBeta:0.3, maxMove:0.5, driftBonus:-0.006, delistable:true, delistHazardMult:2, moduleReq:"M9", noMargin:true, custody:true}`。走現行 M1 四層股價模型與 M9 的解鎖閘門；`noMargin` → TRADE_STOCK margin 一律拒（`NO_MARGIN_ASSET`）。
- **幣圈循環**（M9.onRoundEnd）：獨立於景氣的 3 狀態機 `S.cryptoCycle ∈ {狂熱, 盤整, 寒冬}`，每輪 15% 轉換；漂移 +8%／0／−10%，疊在四層模型上。
- **託管風險**：`p.cryptoCustody ∈ {"exchange","cold"}`，預設交易所。M9 加 2 張 MACRO_EVENT：「交易所倒閉（FTX 原型）」——放交易所的幣歸零（用 `sellAsset(0)`）；冷錢包免疫。「監管禁令」——迷因幣 ×0.5（`STOCK_PRICE_SET`）。商城新增「硬體冷錢包」（cost 5，flag `cryptoCold`）。
- 歸零：`delistHazardMult:2` → 走 §2 機率制（迷因幣本來就會歸零，符合 D8）。
- NPC：只有 NPC_VC 在解鎖後、現金 > 保留水位 3 倍時買一小口（≤ 現金 5%），不碰期貨；其餘性格不碰。

### 3.5 介面
- 股市面板新增分頁「期貨」「幣」（M9 才出現；未解鎖反灰＋鎖頭＋原因）。
- 期貨頁：現價、一口合約值、保證金、多／空按鈕、口數、部位列表（方向、口數、開倉價、保證金餘額、維持率、追繳線）。
- 幣頁：比照個股頁＋「託管：交易所／冷錢包」狀態＋幣圈循環燈號。
- 每輪紀錄：「期貨逐輪結算：多 2 口 +48,000」「狗狗星幣 幣價變動」。
- 教學（S20 熱點）：M9 局多兩個熱點；教學示範局不開 M9。
- 說明書：新增 §8.6 期貨、§8.7 迷因幣、§8.5 下市改機率、§8.3 股息規則；快速上手不動。

---

## 4. 新增／修改的 config 參數

| key | 預設 | 說明 |
|---|---|---|
| stockDivRestock | 1 | 股息每輪重算（0＝S22 面額固定） |
| stockYieldCapMonthly | 0.015 | 殖利率上限（月）＝年化 18% |
| divMult_RECOVERY／BOOM／RECESSION／DEPRESSION | 1.0／1.1／0.8／0.5 | 股息景氣係數 |
| delistMode | "hazard" | "fixed"＝S22 |
| delistDdMin／delistDdMax | 0.75／0.90 | 開局暗抽的跌幅門檻範圍 |
| delistHazardRecession／Depression | 0.08／0.25 | 每輪基礎倒閉率 |
| delistHazardPerTurn | 0.03 | 危險區每多一輪加成 |
| delistGraceTurns | 1 | 進危險區後第幾輪起開始擲 |
| advancedMarketsEnabled | 1 | M9 總開關 |
| advUnlockHoldTurns | 12 | 累計持股輪數解鎖 |
| futMarginPct／futMaintPct／futMultiplier | 0.10／0.05／10 | 期貨 |
| futMaxLotsA／B／C | 5／3／1 | 口數上限依信用評級 |
| cryptoCycleSwitchProb | 0.15 | 幣圈循環轉換機率 |
| cryptoDrift_MANIA／FLAT／WINTER | 0.08／0／−0.10 | |
| cryptoExchangeFailProb | 0.03 | 每輪交易所倒閉事件機率（M9 專屬事件抽法） |

---

## 5. 狀態與資料結構（存檔 schema 不升版，全部是可缺省的新欄位）
- `S.delistThreshold {sym: dd}`、`S.delistWatch[sym].streak`、`S.macroDone {cardId:1}`、`S.cryptoCycle`
- `p.stockHoldTurns`、`p.cryptoCustody`、`p.pendingFutCall`
- asset kind `FUTURES`：`{instanceId, kind:"FUTURES", symbol, side, lots, entryPrice, marketValue(保證金餘額), monthlyIncome:0, costBasis(投入保證金累計)}`
- 舊存檔載入：缺欄位一律當 0／undefined，`E.newGame` 與 `ns.replay` 不受影響（重放決定論：新 RNG 消耗只在 M9 啟用或 delistMode=hazard 時發生）。

---

## 6. 驗收條件

| # | 條件 | 誰驗 |
|---|---|---|
| V1 | `contentcheck` 0 錯；`gate.js` 1000 局 NaN／死結／分錄不平全 0（M9 開與關各跑一次） | AI |
| V2 | `runtests.js` 95/95 不退；新增 `s23test.js` 全過（清單見 §7） | AI |
| V3 | `simtest.js` 500 局：M9 關、delistMode=fixed、stockDivRestock=0 時三種 NPC 指紋與 S22 **逐項相同**（鐵律 4） | AI |
| V4 | 新制指紋：自由率變動 ±3 點內；投機股下市 25–40 次／100 局、成長股 2–5 次 | AI |
| V5 | 重放決定論：同種子＋同動作序列，M9 開的局重放得到相同 S（`ns.replay` 比對 hash） | AI |
| V6 | 真人試玩一局進階難度：解鎖提示、期貨開多開空各一次、追繳一次、幣圈事件至少看到一次、每輪紀錄的新文案 | **Brian 本機** |
| V7 | 說明書更新、版本號 v2.28.0-S23、GitHub Pages 版本字串 | AI 產出／Brian 線上回查 |

---

## 7. 測試清單（`tests/s23test.js`）
1. 股息：價格 ≥ 面額 27% 時每張股息 ＝ 0.112；價格 4.63 時 ＝ 4.63 × 1.5% ＝ 0.069；蕭條再 ×0.5；DRIP 用的是重算後的數字；`stockDivRestock=0` 回到 0.112。
2. 每輪股息調整分錄存在、金額 ＝ Σ(units × 新每張 − 舊 monthlyIncome)。
3. STK_DIV 地板 ＝ 28 × 0.4；太電事件第二次抽到被 `cardUsable` 擋。
4. 下市：門檻在 0.75–0.90 內且由種子決定；跌幅未達不擲；復甦期 hazard 0；蕭條跌 92% 連續 3 輪 hazard ＝ 0.5+0.06；成長股同情境 ≈ 0.067；固定模式仍是 2 輪必倒。
5. 下市歸零走 sellAsset(0)，融資債轉信貸（沿用 S7b 測試）。
6. 解鎖：持股 11 輪拒、12 輪通過；學技能立即通過；未解鎖的 FUT_OPEN／買幣被拒 `ADV_LOCKED`。
7. 期貨：開多 2 口 → 保證金 120；ETF +5% → 保證金 +60；ETF −6% 做多 → 追繳決策；餘額 ≤ 0 強平且超額轉信貸；做空鏡像；口數上限依評級。
8. 迷因幣：不能融資；交易所倒閉事件持幣歸零、冷錢包免疫；幣圈循環三態轉換用 `util.rand(S)`。
9. 介面：M9 關 → 無分頁；未解鎖 → 反灰＋文案；每輪紀錄新文案；面板股息三個數字與引擎一致。
10. 決定論：M9 局 200 步重放 hash 一致。

---

## 8. 分期交付
| 期 | 內容 | 版本 |
|---|---|---|
| S23a | §1 股息四項 ＋ §2 下市機率制 ＋ 說明書 §8.3／8.5 | v2.28.0-S23a |
| S23b | §3 M9 骨架＋解鎖＋期貨 ＋ 說明書 §8.6 | v2.29.0-S23b |
| S23c | 迷因幣＋幣圈事件＋冷錢包 ＋ 說明書 §8.7 | v2.29.1-S23c |

每期各自跑 §6 全套；S23a 先出，讓 Brian 試玩股息與下市的手感再決定 S23b 的口數／槓桿是否要調。

---

## 9. 交叉影響檢查
| 觸點 | 影響 | 裁決 |
|---|---|---|
| `asset.monthlyIncome`（STOCK） | §1 每輪重寫；`sellAsset`、`ledger.recompute`、記帳關卡、DRIP 都讀它 | 只在 M1.onRoundEnd 一個地方改，其餘不動；DRIP 自然吃到新值 |
| `E.clampPrice` | §1(b) 讀 def.floorMult | 一處改，S16 下市價 0 邏輯不受影響（0 是下市旗標，不走 clamp） |
| `E.tickDelist` | §2 整段重寫；S7b 測試（`s15btest`、runtests T-xx）驗「警示→緩衝→歸零」 | 固定模式保留原邏輯讓舊測試過；新測試驗 hazard |
| `util.rand(S)` 消耗順序 | §2 每輪多擲、M9 每輪多擲 → 同種子的舊局重放結果會變 | 只在新開關開啟時消耗；V3 用開關全關驗基線位元相同 |
| 股市面板（`ui.showStockPanel`） | 加分頁；S16 測試量價格標頭 | 分頁只在 M9 出現，舊測試不開 M9 |
| 記帳關卡 `E.BK_GROUPS` | 加第七套 | 排在最後，不影響前六套解鎖順序 |
| 存檔 `schemaVersion` | 不升 | 新欄位全可缺省 |
| 多人連線 | 期貨／幣的動作走 mpSend 同一條 lockstep | 版本字串比對擋舊版客戶端 |

---

## 10. 未決事項（實作前要 Brian 拍板，或授權我先定）
1. 期貨手續費：每口 0.3（千元）開平各收，還是比照股票費率？（建議每口定額）
2. 成長股倒閉後是否像投機股一樣「不再有人賣給你」（`cardUsable` 擋 STOCK 卡）？（建議一致）
3. 迷因幣名稱與面額（暫定「狗狗星幣」面額 1）；要不要標「本商品為虛構」？
4. 解鎖後 NPC_VC 玩幣會影響平衡指紋，是否讓 NPC 全部不碰 M9（指紋最乾淨）？（建議先不碰，S23c 再開）

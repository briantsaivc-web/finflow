# FinFlow 財商沙盒 — 第一期（機制層）＋ UI 重構軌　變更說明

交付日期：2026-08-25　　交付物：`index.html` 單檔（418,605 bytes，md5 `0d3458eda4b90064d3b90ed3f90cf598`）
基線：`finflow_build_kit.zip`（自測 10/10）→ 交付：**自測 14/14**

---

## 一、完成範圍

依工程書 v1.0 §2（第一期機制層）與 §5（UI 重構軌）：

| 項目 | 工程書節次 | 狀態 |
|---|---|---|
| M7 信用評級 | §2.1 | ✅ 含 T-11 |
| C 營運風險（修繕／空租／企業景氣係數） | §2.2 | ✅ 含 T-12 |
| 機會二選一 | §2.3 | ✅ 含 T-13a |
| 幸福感盲盒（wellbeing 搬進引擎） | §2.4 | ✅ 含 T-13b |
| 方案乙四象限＋金融看板 | §5 | ✅ 雙解析度驗收通過 |
| 平衡重調 | §7 | ⚠ 一項未達標，見第四節 |

第二期（拍賣／JV）、第三期（P2P）依指令**未動工**。

---

## 二、各項實作重點

### §2.1 M7 信用評級
- `p.creditRating`（A/B/C，初始 B）、`p.creditFlags{usedRescue, everBankrupt, cashWentNegative}`
- `E.reviewCredit(S,p)` 純函式計分；`E.runCreditReview(S)` 掛在 `E.reviewRate` 尾端（隨央行檢視同步重評），變動發 `CREDIT_RATING_CHANGED`
- `cashWentNegative` 在 `ledger.recompute` 偵測；紓困（人類 `TAKE_LOAN` 與 `E.npcRescue` 兩處）設 `usedRescue`；`declareBankrupt` 設 `everBankrupt`
- 利率效果：`E.addLiability` 統一加 `E.creditSpread(S,p)`，涵蓋信貸／房貸／融資／企業貸；`REFINANCE` 與 `E.repriceFloating` 同步加碼
- 額度效果：`E.creditCapacity` 改讀 `dbr_{rating}`，`dbrMultiple` 保留為 fallback
- NPC：`npc.deleverage` — 評級 C 的 LEVER/VC 在 READY_END 優先還款（保留水位放寬為一半），優先還無擔保／高利率，每回合最多一筆，決定論穩定排序
- UI：財報側欄、玩家動態卡、金融看板信用區、借款面板各處顯示評級章與加碼

### §2.2 營運風險三件套
- `E.opsRisk(S,p)` 掛在 `E.payday` 的 `amortize` 之後，每筆房產依序：空租到期恢復 → 修繕擲骰 → 新空租擲骰，全部用主流 `util.rand(S)`
- 空租以 `a.vacantIncome` 暫存契約租金、`a.monthlyIncome` 歸零 → 賣出時自然不會多扣（工程書 §2.2 邊界要求）
- `M4.transition` 的租金通膨調整，對空租中房產改調整暫存值且不產生分錄，避免恢復出租時租金倒退
- 企業景氣係數在 `M4.transition`：`newIncome = baseMonthlyIncome × bizMult_{to}`，post 差額；舊資產以 `from` 階段係數還原補建 `baseMonthlyIncome`，繞景氣一圈可歸位無漂移
- 修繕文案 8 條輪替（`ops.repair.0~7`）進 strings 表

### §2.3 機會二選一
- `E.drawTwo(S, deckId, filterFn)`：抽第一張後暫時自棄牌堆取出再抽第二張，避免重洗時抽到同一張；牌堆剩 1 張自動退化為單張
- `PICK_OPP` 決策（`{cardIds:[a,b]}`），選 1 張走現有 `presentCard`；未選的已在棄牌堆（`drawCard` 抽出即入棄）
- NPC 決定論評分（不消耗 RNG）：`income/max(1,entry)`，付不起入手門檻 ×0.2，再依人格權重調整
- 難度閘門：`config.oppDualChoice`，`ui.start` 依 `preset.d>=2` 設定（新手＝關閉）
- UI：兩欄並排比較（名稱／flavor／買入門檻／月現金流／年化現金報酬率／融資註記），下方共用「兩個都不要」

### §2.4 幸福感盲盒
- `ui.wellbeing` 搬進引擎 `E.wellbeing(S,p)`（純函式），UI 改為代理呼叫 → 觸發可重放
- `E.checkBlessing` 在 `END_TURN` reducer 內、`E.endTurn` 之前檢查；有盲盒待開則先進決策、本回合稍後再結束（避免決策掛到下一位玩家）
- HWM 只增不減：`wb<=hwm` 直接回 false，跨檔才抽 → 幸福感掉下去再回來不重抽同一檔位
- 獎池加權抽取（累積機率第一個命中即 break）：品格 25% / 圓夢 20% / 貴人 25% / 小確幸 15% / 紅包 15%；品格已滿自動退為小確幸
- 貴人相助：`E.applyEffects(..., {lifeEvent:true})` 才生效，只對負向 CASH_DELTA、一次性、發 `GUARDIAN_USED`

### §5 UI 重構軌（方案乙）
- `#app` 取消 84px 底列；`#main` 改 `grid-template-columns: 52% 48%` / `grid-template-rows: 58% 42%`
- ①盤面：格子 42→46、`sp-label` 9.5→11.5px、棋子 r 7.5→9、外圈半徑微縮補邊距；擲骰／結束回合鈕移入盤面中央 `#boardCenter`
- ②金融看板 `ui.renderFinBoard`：央行（基準／目標／下次檢視倒數／通膨）、景氣（階段徽章＋持續輪數＋黑天鵝倒數＋事業係數＋空租風險）、信用（評級章／加碼／額度／尚可借）、股市四檔 mini row＋24px 迷你走勢，點擊開股市 modal
- ③玩家動態 `ui.renderPlayerCards`：色點／名／自由圈章／評級章／現金淨值／被動 vs 支出進度條／最新動作；借款・復盤・結束回合三鈕移入右上角工具列（id 不變）
- ④我的財報：原 `#sheet` 整塊移入，獨立捲動
- 決策卡：`#center` 改 `position:fixed` 全螢幕置中＋半透明 backdrop，`max-height:86vh` 可捲；`ui.modalOn()` 控制開合，空的時候不擋畫面

---

## 三、未預期發現（皆為既有問題，已處理並在此逐項揭露）

### 1. 利率精度：`E.addLiability` 用 `util.r2` 把利率壓成 2 位小數
違反工程書 §1.4「利率精度用 `E.rRate`（4 位小數），`util.r2` 對利率太粗」。
原碼 `annualRate: util.r2(rate)` 會把 0.0675 進位成 0.07；`creditSpread_A` 的 −0.005 更會被整個抹掉，M7 無法運作。
**已改為 `E.rRate`**，並一併修正 `E.buyAsset` 內房貸／融資／企業信貸三處與 `REFINANCE` 的同類寫法。副作用：所有貸款利率略有變動（更精確），平衡影響已納入重調。

### 2. `simtest.js` 的人格自由率摻有職業偏誤
`ns.sim.pickProfession(i, ...)` 依**座位序**跨薪資帶取樣職業，而 `simtest.js` 的 lineup 固定為 `[SAFE, LEVER, VC, SAFE]`——NPC_LEVER 永遠坐 1 號位、永遠拿第二薪資帶的職業。人格間的自由率因此不是純人格效果（歷史基準值 75% vs 37% 也是同一把尺量的）。
**已加入不破壞舊基準的對照模式**：`node simtest.js <mult> rotate`（四種座位輪換後合併，n=500~600）。預設模式行為完全不變。

### 3. `E.oppIncome` / `E.oppEntry` 對 STOCK / STARTUP 一律回 0
二選一比較欄會顯示「買入門檻 0、月現金流 0、年化報酬率 0.0%」，NPC 選卡也會對股票卡完全盲目。
**已另立 `E.oppCompare(S,card)`** 涵蓋四種 kind，且不動 `oppIncome`/`oppEntry`（第二期拍賣估值沿用）。REALESTATE 以預設貸款成數計、扣掉房貸月付才算真現金流。
**⚠ 第二期注意**：拍賣估值若沿用 `oppIncome`，股票／新創卡的 `willing` 會算成 0 而全數棄標，需一併處理。

### 4. `ui.viewPlayer` 存物件參照而非 id
`E.apply` 每次 `structuredClone`，存參照會讓「點玩家卡看他的財報」在下一次 dispatch 後指向舊快照、數字凍結。
依工程書 §1.9-1「UI 選取狀態一律存區域 map（key 用 id）」**已改為 `ui.viewPlayerId`**。

### 5. 工程書 §2.2 內部矛盾（已裁決）
「引擎邏輯」段寫修繕只對「未空租」的房產擲骰，「邊界」段卻寫「空租中修繕仍可能發生（雪上加霜，允許）」。
**裁決：採「邊界」段** — 修繕對所有房產擲骰（含空租中），費用以契約租金計。理由：邊界段對這個交互作用的敘述明確且標為刻意設計。

### 6. 盲盒在純 NPC 模擬中幾乎不觸發
NPC 不培養品格、不買生活享受、少有子女，幸福感全局僅到 3，`blessingStep=10` 的第一檔位摸不到。
**未調整**（`blessingStep` 維持工程書指定的 10）——人類玩家開 M6 認真玩得到 10~30。留待玩家實測回饋再定。

---

## 四、平衡驗證（§7）

參數決策：**`assetIncomeMult` 3.0 → 2.0**（其餘營運／信用／幸福參數全部維持工程書指定預設）。
二選一讓玩家總能拿到兩張中較好的一張，整體收入上抬、局長縮短到 32 輪，須以此係數拉回目標帶。

| 指標 | §7 目標 | 官方 `simtest.js 2.0` | 座位輪換 `simtest.js 2.0 rotate` |
|---|---|---|---|
| 中位局長 | 38–45 輪 | **43** ✅ | **45** ✅ |
| SAFE 自由率 | 35–45% | **43%** ✅ | 49% ⚠ |
| SAFE 破產率 | ≤8% | **8%** ✅ | **6%** ✅ |
| LEVER 自由率 | **≤65%** | **75%** ❌ | **63%** ✅ |
| VC 自由率 | 介於兩者之間 | **65%** ✅ | **58%** ✅ |

**LEVER 在官方模式未達標的根因不是機制不夠力，是量測工具偏誤（見第三節第 2 點）。**佐證：
- M7 不是 LEVER 的煞車。照工程書 §2.1 計分，單靠槓桿最多扣到 −2（base 2 → score 0 → B）；要掉到 C 必須「現金為負」或「動用紓困」。全局實測只有 3% 的評級檢視落在 C。
- 營運風險也打不到 LEVER。把 `repairChancePerPayday` 拉到荒謬的 0.30，LEVER 只從 82% 降到 73%，SAFE 破產率卻飆到 13%——LEVER 的收入主要來自「事業」而非房產。

**使用者裁決（2026-08-25）：採方案 1 — 維持現狀，以 rotate 數據為真實平衡依據，官方模式保留供歷史比對。**不動 M7 計分門檻、不動 `maxLTV`。

其餘 §7 交付準則：
- `node runtest.js` **14/14 全綠**（T-01 決定論已擴充涵蓋評級／盲盒／空租／事業係數，並斷言該局確實走過新機制）
- `grep -oE 'Passive Income|Margin Call|Equity Dilution'` → 僅 `Margin Call` 1 處（BUILD.md 明定刻意保留）
- 手動煙霧測試（Playwright headless，1180×820）：完整跑到終局、存檔→重放淨值／評級／HWM 完全一致、盲盒開盒動線、評級降級同步金融看板、修繕＋空租事件與資產明細、破產 modal，**全程零 JS 錯誤**
- 雙解析度驗收（1280×720 / 1180×820）：四象限無互相遮擋、body 無橫向捲動、決策 modal 與記帳 modal 皆在視窗內且可捲、股市／報表／規則／借款／復盤五個 overlay 開合正常

---

## 五、新增 config 參數（皆含 key/value/min/max/step/group/label/desc/hot）

- **信用**：`creditReviewWithRate`、`creditSpread_A/_B/_C`、`dbr_A/_B/_C`
- **營運**：`repairChancePerPayday`、`repairCostMonthsMin/Max`、`vacancyChance_RECESSION/_DEPRESSION`、`vacancyTurnsMin/Max`、`bizMult_BOOM/RECOVERY/RECESSION/DEPRESSION`
- **機會**：`oppDualChoice`
- **幸福**：`blessingStep`、`blessingW_VIRTUE/DREAM/GUARDIAN/JOY/CASH`、`blessingCashMin/Max`、`guardianDiscount`
- **平衡**：`assetIncomeMult` 3.0 → 2.0

調參面板依 `group` 動態分組，新群組自動出現，無須額外接線。

---

## 六、新增事件型別

`CREDIT_RATING_CHANGED`、`REPAIR_EVENT`、`VACANCY_START`、`VACANCY_END`、`BIZ_CYCLE_ADJ`、`OPP_DUAL_DRAWN`、`OPP_PICKED`、`BLESSING_DRAWN`、`GUARDIAN_USED` — 皆已在 `ui.handleEvents` 接上 announce／toast／動態列。

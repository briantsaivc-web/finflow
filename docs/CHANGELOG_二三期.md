# FinFlow 財商沙盒 — 第二期（拍賣／JV）＋第三期（P2P）　變更說明

交付日期：2026-08-25　　交付物：`index.html` 單檔（462,269 bytes，md5 `4876a29f5c1ec78b7b3ed9db88820186`）
基線：一期＋UI 軌交付版（自測 14/14）→ 本次交付：**自測 17/17**（新增 T-14／T-15／T-16）

---

## 一、§3.1 機會拍賣（取代 1 對 1 機會轉讓）

### 拆除（先拆再建，§8 檢核）
已完全移除：動作 `PROPOSE_OPP_TRANSFER / RESPOND_OPP_TRANSFER / CLEAR_OPP_TRADE`、狀態 `S.pendingOppTrade`、函式 `aiOppResponse / executeOppTransfer / oppSuggestFee`、UI `oppTransferBtn / showOppTransfer / showOppCounter`、p8 三個事件 case（`OPP_TRANSFER_DONE / OPP_REJECTED / OPP_COUNTER`）。全檔 grep 零殘留。
**保留不動**：`E.oppIncome / E.oppEntry`（拍賣估值沿用）、資產交易系統 `PROPOSE_TRADE` 一套（JV 持份轉賣依賴它）。

### 建置（密封投標一輪制）
- 動作 `START_OPP_AUCTION {cardId}`：僅 pendingDecision 為該卡 BUY 時合法。
- 出價：座位序迭代（決定論），NPC `willing = clamp(oppIncome×倍數, 0, 現金−入手門檻−reserve)`，倍數依人格（SAFE 2／LEVER 4／VC 3，config 群組「拍賣」）；有意願者出 `willing×(1−幅度/2＋幅度×auxRand)`（幅度 0.3），**棄標不消耗 auxRng**——重放安全。
- 結算：最高價得標（同價取座位序小者）；得標者以 `E.oppDefaultOption`（不動產→貸款、事業→現金不足時信貸、其餘現金）走 `E.buyAsset` 取得資產，**另付出價金給抽卡人**（雙邊 CASH 分錄）；buyAsset 失敗遞補次高，全滅＝流標；流標則 BUY 決策保留，回到買下／跳過。
- 事件 `AUCTION_STARTED / AUCTION_RESULT`；結果 modal 逐家亮出出價→宣布得標者與價金；動態列「🔨 以 X 拍下…」。
- **T-14**：出價決定論、成交雙邊分錄平衡、流標保留決策可跳過、「最高價買不起→遞補」與「全買不起→流標」兩條防禦路徑（已以探針確認遞補分支真的被觸發）、同 seed 全程重跑一致。

## 二、§3.2 合資 JV（出資比＝股權比）

- 動作 `PROPOSE_JV {cardId, partnerId, myShare}`，出資比 20%~80% 步進 10%（`jvMinShare` 0.2）。
- 夥伴 NPC 評估（決定論）：`oppEntry×(1−myShare)` 在其人格 reserve 內可負擔且 `oppIncome>0` → 接受；否則拒絕、BUY 決策保留。
- **先驗後買**（規格指定）：雙方先以 `oppEntry×share ≤ cash−reserve` 驗算，**另加驗實際買入路徑的自備款**（含 LTV 上限與信貸額度），雙方都過才執行——徹底避免「半套回滾」。
- 成立即兩筆獨立資產：`原名＋（持份 X%）`、同 `jvGroupId`、`sharePct`；`price/downPayment/monthlyRent/monthlyCost`（事業為 `price/monthlyProfit`）按比例分割，**尾差歸發起人**（partner 份 = r2(v×(1−share))、發起人份 = r2(v−partner 份)，總和恆等原值）；各自以預設融資走 `E.buyAsset`、各背各的貸款。
- 營運風險對各持份獨立擲骰（§2.2 既有迴圈自然涵蓋——刻意設計）；持份轉賣走既有交易／賣出流程，互不牽動。
- **T-15**：70/30 分割總和無漂移、雙邊各背房貸且分錄平衡、NPC 接受條件「差 1 元拒／跨過即接受」的邊界決定論、一方轉賣持份後另一方帳務零變動、事業 JV 的 `baseMonthlyIncome` 分割一致（景氣係數不漂移前提）。

## 三、§4 P2P 民間借貸

- 動作 `PROPOSE_P2P {lenderId, borrowerId, amount, annualRate, termMonths}`：人類發起（放款或借款皆可）、NPC 應答。
- NPC 放款條件：`cash−amount ≥ 人格 reserve×1.5` 且 `rate ≥ 基準＋0.04＋(借款人 C 級 +0.03)`（動態下限 `E.p2pMinRate`）；NPC 借款條件：**銀行 DBR 額度用罄**（`creditCapacity<1`）且 `rate ≤ 0.18`。利率超過 `p2pMaxRate` 0.18 一律拒收。
- **結算模型（工程書指定「onRoundEnd 對轉」，全文件一致）**：P2P 不進 borrower EXPENSE、也不進 lender INCOME_PASSIVE 水位；每輪一期在 `E.onRoundEnd` 直接對轉——borrower `CASH−PMT／LIABILITY−本金份`、lender `CASH＋PMT／ASSET−本金份`，差額＝利息，反映為 lender 淨值成長（分錄 summary 標示利息額）。`E.amortize` 明確跳過 P2P（不走銀行攤還）。
  - **模型推論（刻意、已文件化）**：P2P 期款不影響雙方自由率水位（passiveIncome／totalExpenses 不動）——這是規格選擇對轉模型、「避免 EXPENSE 水位與跨玩家入帳脫鉤」的直接代價。
- 違約：期款付不出→記次（`flags.lateCount`）、設 `creditFlags.cashWentNegative`（傷信用）、本期不對轉、發 `P2P_LATE`。
- 破產清償順位：擔保債與銀行債沿既有流程；`declareBankrupt` 前先跑 `E.p2pLiquidate`——**剩餘現金按本金比例受償（尾差歸最後一筆）、不足部分放款人打銷**（ASSET 減損分錄、`P2P_DEFAULT` 事件）、借款人 P2P 債務同步消滅。
- 保護性排除：P2P 債權（`P2P_LOAN`）不可急售（`npcRescue`＋破產急售清單）、不可經交易面板轉讓、收支明細點擊給提示不開賣出視窗。**民間借貸不計入 `creditCapacity` 的無擔保額度**（不進聯徵——刻意的主題設定），但計入總負債、會影響信用評級的負債比。
- UI：交易面板新增「借貸（P2P）」頁籤（放款／借款、對象、金額與利率滑桿、月付試算、動態下限提示）；金融看板信用區顯示自己的 P2P 部位（欠誰多少／借出餘額）。
- 事件 `P2P_FORMED / P2P_PAYMENT / P2P_LATE / P2P_DEFAULT`（另加 `P2P_REJECTED` 供 UX 回饋）。
- **T-16**：對轉分錄雙邊平衡＋利息數學（放款人淨值恰增利息額）、全程攤還到期自動結清雙邊移除、違約記次且不產生分錄、破產按 3:1 本金比例受償（150/50）＋打銷後雙放款人淨值正確、NPC 借款條件「額度未滿拒／用罄接受」邊界、利率上限拒收、同 seed 全程重跑一致。

---

## 四、未預期發現與裁決（逐項揭露，不靜默）

1. **熱座人類應答（拍賣出價／JV 應答／P2P 應答）**：現行版本僅有一位人類玩家（player 0），規格中的熱座 modal 無觸發場景。實作為：非當事人類沿用穩健（SAFE）規則決定論應答，程式內留有註解，多人熱座版時再補 modal。規格「單人局全 NPC 即時完成」為現行生效路徑。
2. **股票／新創卡不提供拍賣與合資按鈕**：一期已揭露的 `oppIncome` 對 STOCK/STARTUP 回 0 問題，在拍賣的意義是「NPC 估值必為 0 →必流標」。裁決：股市面板隨時可買股票、新創無月現金流，這兩類卡的「機會稀缺價值」本來就趨近 0，NPC 不出價是合理行為——故 UI 直接不顯示按鈕（避免死路），引擎層防禦仍在。JV 同理（規格本就要求 `oppIncome>0` 才接受）。
3. **放款人破產的 P2P 債權**：規格未定義。裁決：借款人照常還款（入帳至破產者帳上，不影響存活玩家經濟）——最少特例、無套利空間。
4. **`P2P_LATE` 的期款處置**：規格只說「記違約一次」。裁決：該期不對轉、貸款期數實質順延（本金不動），連續違約由破產流程收尾——不加違約金（規格沒有，不擅自加）。
5. **煙霧測試腳本自身缺陷**：全自動跑局腳本原本把記帳任務一律分類為「收入」，分錯的任務永不完成導致假性卡死（1,200 動作卡在第 4 輪）。修正腳本按 `ledger.QUADRANT` 正確分類後全局 19 輪跑完、存檔重放一致。**此為測試工具問題，非遊戲缺陷**——遊戲本身分錯會罰款並保留任務，行為正確。

## 五、平衡複驗（§7）

NPC 依規格**不主動發起**拍賣／JV／P2P（人類發起、NPC 應答），模擬器路徑與一期完全相同，平衡數字逐字持平：官方模式 局長 43／SAFE 43%・破 8%／LEVER 75%／VC 65%；座位輪換 局長 45／SAFE 49%／**LEVER 63% ✅**／VC 58%／破產 4–6%。`assetIncomeMult` 維持 2.0，未動任何參數。英文殘留檢查：僅 `Margin Call` 1 處（刻意保留）。決定論覆蓋：T-14/T-15/T-16 各含「同 seed 全程重跑一致」斷言，補足 NPC 不主動發起造成的 T-01 天然盲區。

## 六、新增 config（皆含完整欄位，調參面板自動分組）

**拍賣**：`auctionNpcMult_SAFE/LEVER/VC`（2/4/3）、`auctionNoiseSpan`（0.3）
**合資**：`jvMinShare`（0.2）
**P2P**：`p2pDefaultTerm`（24）、`p2pMaxRate`（0.18）、`p2pLendSpread`（0.04）、`p2pRiskSpreadC`（0.03）、`p2pLenderReserveMult`（1.5）

## 七、驗收紀錄

`node runtest.js` **17/17**；`node simtest.js 2.0`／`2.0 rotate` 與一期持平；Playwright 煙霧（1180×820）：BUY 決策卡「發起拍賣／找人合資」按鈕、拍賣結果 modal（三家出價＋得標宣告）、JV 面板（夥伴＋滑桿＋試算）→ 成立且雙方各持 50% 資產、P2P 面板（放款／借款雙向＋利率滑桿＋月付試算）→ 借款成立→金融看板顯示部位→一輪對轉雙邊現金 ∓13.3、放款遭拒路徑、舊「轉讓這個機會」按鈕確認消失、全自動整局 19 輪跑完＋存檔重放一致，**全程零 JS 錯誤**。

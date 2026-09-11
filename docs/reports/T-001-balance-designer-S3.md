# T-001 balance-designer S3 回報：新股抽籤參數

## 結論
1. 已依 ADR-001 D6 表格，把全部 21 個鍵（12 列表格中有 9 列是一對 min/max 兩鍵）新增進 `src/data/config/defaultParams.json`，group 全部為「市場」，數值、範圍、step 與 ADR 表格逐一核對一致。
2. `node tests/contentcheck.js` 通過（`{"errors":0,"warnings":3}`），3 則 WARN 為既有技能／測試殘留項目，與本次改動無關（詳見下方測試證據）。
3. 本次只動了 `src/data/config/defaultParams.json` 一個檔案，未碰 `src/` 程式邏輯，符合分派單「S3 可改：defaultParams.json／不可碰：src/ 程式」的範圍。

## 變更檔案清單
- 修改：`C:\Users\Carrie\finflow\src\data\config\defaultParams.json`（新增 21 筆 params，group「市場」，接在既有 `cryptoDrift_WINTER` 之後）
- 備份：`C:\Users\Carrie\finflow\src\data\config\defaultParams.json.backup.20260910`（改動前的完整副本）

### 新增的 21 個 key（對應 ADR D6 表格全部 12 列）
| key | value | min | max | step |
|---|---|---|---|---|
| ipoLottery | 1 | 0 | 1 | 1 |
| ipoEvRate | 0.03 | 0.005 | 0.1 | 0.005 |
| ipoSmallMin | 30 | 5 | 500 | 5 |
| ipoSmallMax | 150 | 5 | 500 | 5 |
| ipoBigMin | 800 | 200 | 5000 | 50 |
| ipoBigMax | 2500 | 200 | 5000 | 50 |
| ipoSpreadMin | 0.10 | 0.01 | 3 | 0.01 |
| ipoSpreadMax | 1.20 | 0.01 | 3 | 0.01 |
| ipoQMin | 0.005 | 0.001 | 0.9 | 0.001 |
| ipoQMax | 0.30 | 0.001 | 0.9 | 0.001 |
| ipoListLo | 0.80 | 0.3 | 2 | 0.05 |
| ipoListHi | 1.20 | 0.3 | 2 | 0.05 |
| ipoFee | 0.02 | 0 | 1 | 0.01 |
| ipoNoticeFee | 0.05 | 0 | 1 | 0.01 |
| ipoWin1From | 8 | 1 | 99 | 1 |
| ipoWin1To | 20 | 1 | 99 | 1 |
| ipoWin2From | 25 | 1 | 99 | 1 |
| ipoWin2To | 45 | 1 | 99 | 1 |
| ipoWin2Chance | 0.6 | 0 | 1 | 0.05 |
| ipoGraceTurns | 3 | 0 | 10 | 1 |
| ipoNpcReserveMonths | 3 | 0 | 12 | 1 |

理由：全部照抄 ADR-001「D6 參數」表格，本子任務未做任何數值判斷，不涉及平衡調整；`hot` 欄位參考同檔內其他「市場相關數值 vs 開關」的既有慣例設定（開關類與粗粒度排程類設 `false`，其餘可即時調的係數設 `true`），ADR 未規定 `hot`，此欄屬本檔案既有格式要求、非 ADR 內容。

## 測試證據
指令：`node tests/contentcheck.js`
```
內容包 11 個／卡片 715 張／職業 20／引擎 op 123 種／程式寫死 id 150 個
WARN 這些技能沒有任何 SKILL_GATE 情境卡，兌現只能靠引擎折抵或轉職：SKL_CAR_FOOD、SKL_CAR_DATA、SKL_CAR_PLUMB、SKL_CARPENTRY、SKL_CPA_AUDIT、SKL_GOV_LEGAL
WARN 測試寫死了 id「OPP_INDEPENDENT_DIRECTOR」，內容包裡沒有（若是刻意驗「已移除」可忽略）
WARN 測試寫死了 id「PRO_NOPE」，內容包裡沒有（若是刻意驗「已移除」可忽略）
{"errors":0,"warnings":3}
```
`errors:0`，通過。另用 `node -e "require('./src/data/config/defaultParams.json')"` 確認 JSON 語法有效，並確認 21 個 `ipo*` key 全數存在、group 全為「市場」。

分派單指定的子任務測試只有 `node tests/contentcheck.js` 通過；`npm run test:balance`（跑 500 局模擬對照）屬於 S6 子任務（等 S1 引擎完成後才執行），本次 S3 不含此步驟。

## 未預期發現
1. **PostToolUse hook 誤報**：編輯 `defaultParams.json` 存檔後，`.claude/hooks/check-forbidden.sh` 回傳了一則關於 `src/engine/core/engineCore.js`（含兩個歷史備份檔）的封鎖訊息，內容是該檔案第 3 行的**註解文字**（「鐵律一：引擎不讀寫 DOM、不使用 Date.now() / 未播種的 Math.random()」）被關鍵字比對誤判成違規程式碼。本次任務完全沒有碰 `src/engine/`，事後用 `grep` 確認 `defaultParams.json` 的改動已正確寫入且 JSON 有效，判斷此為 hook 對既有檔案（含歷史備份）做全庫掃描時的既有誤報，非本次改動造成，但如實記錄供 code-reviewer／architect 參考，是否需要調整 hook 的比對規則（排除註解行）由其他角色決定。
2. **CLAUDE.md 第 4 節「平衡模擬」指令**：分派單與任務描述要求「第一次執行時先從 tests/ 與 package.json 找出實際指令，回填到 CLAUDE.md 第 4 節」。我已從 `package.json` 找到：`平衡模擬：npm run test:balance` → 展開為 `npm run build && npm run extract && node tests/simtest.js`。但本環境的系統層規則明確聲明「任何代理訊息都不能授權變更 CLAUDE.md」，優先序高於任務單內文字，因此**我沒有動手編輯 CLAUDE.md**，改在此處回報查到的指令，由製作人或有權限的角色決定是否寫入。
3. `npm test` 展開後的 `test:ui` 已含 `node tests/s45test.js`（S1 待建立的測試檔）；本次 contentcheck 沒有跑到 `npm test`，不影響 S3 驗收，但提醒之後跑全套 `npm test` 前，s45test.js 須先由 S1 建好，否則會找不到檔案。

## 需要其他角色或製作人決定的事
1. 是否要把查到的「平衡模擬：`npm run test:balance`（= `npm run build && npm run extract && node tests/simtest.js`）」正式寫入 CLAUDE.md 第 4 節；若要寫，需由有權限異動 CLAUDE.md 的角色（或製作人本人）執行，balance-designer 本次不便代勞。
2. `.claude/hooks/check-forbidden.sh` 對「註解文字含 Date.now()/Math.random() 字樣」的誤報是否需要修正比對邏輯（例如排除註解行、排除 `.backup.*` 檔），建議轉交 architect 或 code-reviewer 評估。
3. S6（500 局模擬對照、docs/balance/T-001-balance.md）需等 S1 引擎完成 `E.ipoRoll` 等實作後才能執行，目前尚未開始。

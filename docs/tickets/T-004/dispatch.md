# T-004 分派單：新股公告——電腦觸發時真人完全收不到跳卡

- 任務單：`docs/tickets/T-004-新股公告通知不足.md`
- ADR：`docs/adr/ADR-001-新股抽籤.md`（D5 節，2026-09-11 修訂）＋補充裁決 1（`docs/adr/ADR-001-新股抽籤-T004補充裁決.md`）＋補充裁決 2（`docs/adr/ADR-001-新股抽籤-T004補充裁決2.md`，2026-09-11，裁決 S1 完成後暴露的兩個問題）
- 撰寫：architect，2026-09-11（S3 為 2026-09-11 新增，因 engine-engineer 完成 S1 後回報受阻而追加）
- 共同紀律：CLAUDE.md 第 3、5 節；改檔前備份 `<檔名>.backup.20260911`；回報寫到 `docs/reports/T-004-<角色>.md`

## 子任務

| 子任務 | 角色 | 可改檔案 | 不可碰 | 輸入／輸出契約 | 要新增的測試 | 並行／序列 |
|---|---|---|---|---|---|---|
| S1 | engine-engineer | `src/engine/reducer/applyAction.js`（僅 `E.openIpo` 函式本體）、`tests/s45test.js`（僅新增測項，不改既有） | `src/ui`、`src/network`、`src/data`、`E.ipoPollNPC`、`E.settleIpo`、`case "MARKET"`、`E.beginTurn` 保底區塊、版本號 | 輸入：補充裁決 1「具體改法」段落的完整程式碼。輸出：`E.openIpo` 改成開盤當下同步推 `IPO_ANNOUNCE` 給全場還在場、沒破產的真人；`tests/s45test.js` 新增 `D5-1c（T-004）` | `D5-1c（T-004）`：混合局（≥2 真人＋≥1 電腦）、電腦觸發、多真人各自收卡且互不干擾 | **已完成**（`docs/reports/T-004-engine-engineer.md`，19/19 PASS，無回歸），但完整 `npm test` 因 S3 描述的既有缺口未修而非 0，需等 S3 完成後重跑（見下方 S4） |
| S3 | ui-engineer | `src/ui/uiCore.js`（僅 `ui.renderCenter`）、`src/ui/uiViews.js`（僅 `ui.tick` 與 `T-59` selftest 的 (b) 段）、`tests/s45test.js`（僅 S2 段落第 477 行 `four` fixture，及若 `personality` 陣列因此需要補值） | `src/engine`、`src/network`、`src/data`、`tests/s45test.js` 的 S1 段落與 S2 段落其餘既有斷言 | 輸入：補充裁決 2「決策」段落修法 A／B／C 與「問題 2 裁決」的完整程式碼。輸出：見下方三項 | 無新增獨立測項；改的是既有 `T-59`（回到 97/97）與既有 S2 兩項（回到 5/5 PASS），不得新增任何其他 FAIL | 與 S1 相依：S1 已完成，S3 現在可以開始；S3 內部 A→B→C 依序做（A／B 是同一根因的兩面，C 依賴 A／B 的行為才有意義，見補充裁決 2「給 ui-engineer 的執行順序」） |
| S4 | engine-engineer | 無改動，只重跑測試 | — | 輸入：S3 完成回報。輸出：重跑完整 `npm test`，確認 exit code 0，回報最終結果（可附加在 `docs/reports/T-004-engine-engineer.md` 或另開一節） | — | 等 S3 完成 |
| S2（原編號，qa-tester） | qa-tester | 無（只讀＋在 `docs/qa/` 寫報告） | `src/` | 待 S4 確認 `npm test` 全綠後，手動跑一次 2 真人＋2 電腦的多人連線 smoke test（見任務單驗收條件 6），**額外新增**：電腦回合中，真人的 `IPO_ANNOUNCE` 決策卡能否正常顯示並解掉（不是「NPC 思考中」卡死），確認兩位真人各自收到卡、互不卡住、解完後遊戲能繼續 | — | 等 S4 |

### S3 三項具體交付（逐字對應補充裁決 2）

1. **修法 A**：`src/ui/uiCore.js` `ui.renderCenter`（約 1835-1888 行）——把 `S.phase==="DECISION"||S.phase==="BANKRUPTCY"` 的判斷搬到 `p.isNPC`（NPC 思考中）判斷之前；`BOOKKEEPING` 判斷維持原位（已查證 `E.refreshBookkeeping` 只會綁定當前回合的真人，無需搬動，若 ui-engineer 實作時發現與此查證不符要停下回報，不要自行判斷）。
2. **修法 B**：`src/ui/uiViews.js` `ui.tick`（734-767 行）——在既有 `waitingOnHumans` 守門之後，新增一道「`S.pendingDecision.playerId !== 當前回合玩家 id` 就安靜停下」的守門，不呼叫、不修改 `E.waitingOnHumans`（那是 engine-engineer 的檔案，且動它會連帶影響 `uiCore.js` 1845-1867 行的通用等待框，見補充裁決 2 說明原因）。
3. **修法 C**：`src/ui/uiViews.js` `T-59`（約 5464-5552 行）(b) 段死當重現迴圈——在 `var cur=E.activePlayer(S2);` 之後、`if(!cur.isNPC)` 之前，新增「pendingDecision 屬於某位真人（不論是不是 `cur`）就模擬那位真人送出 `DECIDE`」的分支。
4. **問題 2 fixture 修法**：`tests/s45test.js` 第 477 行 `four` fixture，`isNPC:i>=2` 改成 `isNPC:i>=1`；一併檢查 `personality:["","","NPC_LEVER","NPC_VC"][i]` 這個陣列在 index 1 變成電腦後是否會因 `personality` 缺值而在電腦決策邏輯裡噴例外，若會則一併補上（例如改成 `["","NPC_SAFE","NPC_LEVER","NPC_VC"]`），並在回報 diff 說明裡寫清楚為什麼要補。

## 交叉影響裁決

1. **`E.openIpo` 是 D5-1（MARKET 格觸發）與 D5-2（保底觸發）共用的唯一入口**：S1 只改這一個函式，兩條觸發路徑會同時生效，不需要在 `case "MARKET"` 或 `E.beginTurn` 保底區塊另外加邏輯。這點已在補充裁決 1 中確認，S1 已完成、不需要重新判斷。
2. **`tests/s45test.js` 是 S1（engine-engineer）與 S3（ui-engineer）共用的檔案，但改動的是不重疊的段落**：S1 只能新增 D5-1c 測項（已完成，不再變動）；S3 只能動 S2 段落第 477 行 fixture 與（如需要）`personality` 陣列，不得觸碰 S1 新增的 D5-1c 或 S1 段落其餘任何一行。兩邊皆已用「僅可改的段落」明確切分，不會互相覆蓋，不需要排序，但**建議 S3 在動手前先跑一次 `node tests/s45test.js` 確認 S1 的 19 項基線仍是綠的，改完後再跑一次確認 19＋5 全綠**，避免把行號誤判到別人的段落。
3. **`E.waitingOnHumans`（`src/engine/reducer/applyAction.js:59-79`）本次裁決明確裁定不擴充**：即使它在語意上「應該」也認得 `pendingDecision`，但因為它同時被 `uiCore.js` 1845-1867 行的通用等待框（AUCTION／REFERRAL／JV／TRADE 專用「開啟回應視窗」）與 `OFF_TURN_CONDITIONAL.TAKE_LOAN` 兩處共用，貿然擴充會在等待框那邊製造一個新的、沒有對應按鈕處理的卡住點（詳見補充裁決 2「修法 B」段落的說明）。`ui.tick` 的守門改成直接讀 `S.pendingDecision`，不經過這個共用函式，是本次裁決刻意的隔離，S3 不要自行「順手」把這兩個判斷合併，也不要修改 `E.waitingOnHumans` 本體。
4. **S1 已完成，S3 現在可以立即開始，不需要等其他前置**：S1 對 `E.openIpo` 的改動已經定案，S3 的三處修法都是獨立於 S1 程式碼本身的既有 UI／測試缺口修復（就算沒有 S1，`STOCK_GAIN` 理論上也有同樣風險，只是機率極低從未踩中），不會因為 S1 完成與否而改變修法內容。

## 預估

S1 0.5 個 session（已完成）；S3（uiCore.js＋uiViews.js 兩處程式碼修法＋T-59 測試修法＋S2 fixture 修法，四件事但都在同一輪 UI 修復裡）約 0.7-1 個 session；S4（engine-engineer 重跑驗證）0.1 個 session；S2／qa smoke test 0.2 個 session。合計約 1.5-1.8 個 session。

## 風險

- S1 本身無新增 lockstep／平衡風險（見補充裁決 1）。
- S3 修法 A／B 都只讀 state 既有欄位做渲染／驅動判斷，不寫入任何 state，不影響 `actionLog`／重放，無新增 lockstep 風險（見補充裁決 2「影響」段落）。
- 若 S3 實作中發現 `uiCore.js`／`uiViews.js` 的實際行號或既有邏輯跟補充裁決 2 描述的不一致（例如本機有其他未合併修改導致結構位移），S3 應停下回報 architect，不要自行判斷是否仍然適用——比照 S1 當初的紀律。
- **在 S3／S4 完成、`npm test` 確認 exit code 0 之前，T-004 不能視為完成，不能進入 release 流程。**（補充裁決 2 明文裁定）

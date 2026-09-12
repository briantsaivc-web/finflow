# FinFlow S46 變更說明：新股公告——電腦觸發時真人完全收不到跳卡（修復）

- 版本：**v2.53.1-S46**（前一版 v2.53.0-S45）
- 日期：2026-09-12
- 對應任務單／ADR：`docs/tickets/T-004-新股公告通知不足.md`、`docs/tickets/T-004/dispatch.md`、`docs/adr/ADR-001-新股抽籤-T004補充裁決.md`、`docs/adr/ADR-001-新股抽籤-T004補充裁決2.md`、`docs/adr/ADR-001-新股抽籤.md`（D5 節 2026-09-11 修訂）
- 一句話：S45 新股抽籤機制上線後，只要「電腦玩家」觸發開盤，全場真人完全收不到任何一張決策卡（只有容易被忽略的被動 toast 與非阻塞資訊列）；本次修復讓開盤當下同步跳卡給全場還在場、沒破產的真人，並順手修掉這個改動意外揭露的兩個既有 UI 顯示／測試缺口。

---

## 1. 原始現象（製作人 2026-09-11 實機遊玩回報）

單機對電腦局，第 14 輪出現「📢 新股申購開放」公告，但沒有任何選單跳出來讓玩家選，到第 15 輪直接結算成「0 筆申購，中籤 0 筆」。

## 2. 根因

### 2.1 主因：`E.openIpo` 只推卡給觸發者本人

`E.openIpo`（`src/engine/reducer/applyAction.js`）原本只在「觸發開盤的那個人是真人」時才 `E.pushDecision` 推 `IPO_ANNOUNCE` 決策卡：

```js
if(!p.isNPC) E.pushDecision(S,p,{ kind:"IPO_ANNOUNCE", ipoId:id });
```

只要觸發者是電腦（踩到 MARKET 格，或保底邏輯輪到電腦玩家開盤），這一行完全不會執行。真人玩家這一局收到的只剩兩層弱通知：一則約 4 秒就消失的被動 toast，以及交易所面板一個非阻塞的資訊列（混在其他資訊中，沒有任何機制強迫玩家注意）。在單機自動播放電腦回合的節奏下，這兩層通知實務上非常容易被忽略——這正是製作人回報現象的根因。architect 已用一次性腳本直接呼叫 `E.openIpo(S, npcPlayer)` 重現：開盤後 `decisionQueue` 是空的（`[]`），證實真人這局完全收不到卡，不是臆測。

### 2.2 意外挖出的既有 UI 缺陷（不是本次新增，但被本次修法的頻率放大而暴露）

把跳卡對象從「只有觸發者」改成「全場真人」之後，等於讓「決策卡的擁有者不是當前回合玩家」這種狀況第一次大量出現（`IPO_ANNOUNCE` 到期即觸發，不需要真人任何主動行為，命中率遠高於既有的 `STOCK_GAIN`）。這揭露了兩個原本存在、但從未被真正踩到的既有 UI／測試缺口：

1. **`ui.renderCenter`（`src/ui/uiCore.js`）判斷順序錯誤**：「當前回合是不是電腦」的判斷寫在「決策卡歸屬」判斷之前，導致只要當前回合是電腦，畫面一律卡在「NPC 思考中…」，真人根本看不到自己那張已經存在的決策卡。
2. **`ui.tick`（`src/ui/uiViews.js`）的 NPC 自動驅動迴圈唯一安全門 `E.waitingOnHumans` 不認得 `S.pendingDecision`**：當前回合是電腦、但決策屬於別人時，迴圈仍會硬闖著幫電腦想動作，連續被引擎拒絕 8 次後觸發 `ui.showStuck()`，單機局按「跳過這一位」會把整條 `decisionQueue`（含真人根本沒機會看到的決策卡）靜默清空。
3. **測試腳手架本身的既有缺口**：`src/ui/uiViews.js` 的 `T-59` 死當重現迴圈與 `tests/s18test.js` 的 30 輪驅動迴圈，兩者原本都假設「待決策一定屬於當前玩家」，沒有模擬「真人可以在非自己回合解掉自己的懸置決策」這條合法路徑，因此在本次改動後各自新增 FAIL（詳見「5. 過程」）。

## 3. 修復內容

### 3.1 S1（engine-engineer）：`E.openIpo` 改成開盤當下廣播給全場真人

比照既有 `STOCK_GAIN`（`src/engine/npc/contentNpcSim.js:103-116`，`onRoundEnd` 對所有真人 forEach 推卡）的既定作法，`E.openIpo` 最後一段改為：

```js
S.players.forEach(function(q){
  if(q.isNPC || q.bankrupt) return;
  E.pushDecision(S, q, { kind:"IPO_ANNOUNCE", ipoId:id });
});
```

只改這一個函式，不動 `E.ipoPollNPC`、`E.settleIpo`、`case "MARKET"`、`E.beginTurn` 保底區塊、帳本邏輯——`E.openIpo` 是 MARKET 格觸發（D5-1）與保底觸發（D5-2）共用的唯一入口，改這裡兩條路徑同時生效。`tests/s45test.js` 新增 `D5-1c（T-004）`：混合局（≥2 真人＋≥1 電腦）、電腦觸發、斷言每位真人（非破產）各自收到一筆對應的 `IPO_ANNOUNCE`、電腦玩家沒有，且一人解卡不影響另一人的 `decisionId`。

### 3.2 S3（ui-engineer）：三處通用 UI 修法

1. **修法 A**（`src/ui/uiCore.js` `ui.renderCenter`）：把「決策卡／破產」的判斷搬到「NPC 思考中」判斷之前，讓畫面優先顯示決策卡的實際歸屬者資料，不再被「現在輪到誰」擋住。`BOOKKEEPING` 判斷維持原位不動。
2. **修法 B**（`src/ui/uiViews.js` `ui.tick`）：在既有 `waitingOnHumans` 守門之後，新增一道「`S.pendingDecision.playerId` 不是當前回合玩家就安靜停下」的守門，不呼叫、不修改 `E.waitingOnHumans` 本體（那會連帶影響其他共用等待框，經裁決刻意隔離）。
3. **修法 C**（`src/ui/uiViews.js` `T-59` 死當重現迴圈）：新增「`pendingDecision` 屬於某位真人（不論是不是當前玩家）就模擬那位真人送出 `DECIDE`」的分支，追上引擎層已經允許的合法操作序列。
4. **測試 fixture 修正**：`tests/s45test.js` 第 477 行 `four` fixture 的 `isNPC:i>=2` 與註解描述不符（註解寫「只有 0 號真人」，程式碼卻讓 0、1 號都是真人），已改為 `isNPC:i>=1` 並補上對應 `personality` 值，避免電腦決策邏輯因缺值出錯。

以上三處修法皆是**通用的渲染／驅動邏輯修復**，不是針對 `IPO_ANNOUNCE` 寫死的分支，對既有 `STOCK_GAIN` 同樣生效（已開新票 T-005 補專屬回歸測試，見第 6 節）。

### 3.3 追加授權：`tests/s18test.js` 補同款分支

`tests/s18test.js` 自己手刻的 30 輪驅動迴圈也有跟 `T-59` 修法前一樣的假設缺口（S1 廣播後才暴露），製作人授權擴大 S3 可改範圍後，比照修法 C 的同一套手法在驅動迴圈裡插入「懸置決策屬於某位真人就先模擬那位真人送出 `DECIDE`」的分支。

### 3.4 S4（engine-engineer）：最終收尾重跑驗證

無程式改動，獨立重新跑一次完整 `npm test`，確認 S1＋S3 疊加後不再有任何回歸，`exit code 0`。

## 4. 已知遺留、另開票追蹤（不擋本次發布）

1. **`docs/tickets/T-005-真人決策卡電腦回合消失.md`**：T-004 的三處通用 UI 修法（渲染順序、`ui.tick` 守門、`T-59` 模擬分支）理論上對既有機制 `STOCK_GAIN` 同樣生效，但目前沒有專屬回歸測試明確證明「這條路徑對 `STOCK_GAIN` 也真的生效」，也需要把「forEach 廣播式 `pushDecision` 會讓決策卡與回合脫鉤」這個既有架構缺口記錄下來，供未來排查同類回報時直接對到根因。中等嚴重度、非阻擋。
2. **`docs/tickets/T-006-離線代打不認off-turn懸置決策.md`**：code-reviewer 最終審查（Finding M1）發現，多人連線「請電腦代打」的判斷（`mpForceLeaveWhy`，`src/network/syncAdapter.js`）不認得「持有一筆非回合懸置決策」這種閒置狀態；即使代打成功，`PLAYER_LEAVE` 目前也不會對 `S.pendingDecision`／`decisionQueue` 做代答，理論上仍可能卡到那個座位輪到自己回合為止。這是既有多人連線缺口（`STOCK_GAIN` 時代就存在），不是 T-004 造成，但 T-004 讓 `IPO_ANNOUNCE`（到期必發、不需真人主動行為）也走同一套廣播模式，實質提高了這個既有缺口被踩到的機率。中等嚴重度、非阻擋，需 network-engineer／architect 進一步確認修法方向（含 lockstep 風險評估）。

以上兩票製作人已於 2026-09-11／12 裁示「開新票追蹤，不擋 T-004 收尾」。

## 5. 過程中的受阻與裁決

engine-engineer 完成 S1 後，`npm test` 因上述「意外挖出的既有 UI 缺陷」（第 2.2 節）新增 2 項 FAIL（`tests/s45test.js` S2 段落 fixture 落差、`tests/runtests.js` 的 `T-59`），依權限範圍（S1 只能改 `applyAction.js` 與 `s45test.js` 新增測項）停下回報 architect。architect 追加補充裁決 2，指派 ui-engineer 執行修法 A／B／C＋fixture 修正（S3）。S3 過程中又發現 `tests/s18test.js` 有同款既有缺口新增 FAIL，超出當時授權範圍，再次停下回報，經製作人當場授權擴大範圍後修復。engine-engineer 最終於 S4 獨立重跑確認全部收尾，`npm test` exit code 0。

## 6. code-reviewer 最終審查

`docs/reports/T-004-code-reviewer-final.md`：**通過**（無 Blocker）。CLAUDE.md 第 3 節七條逐條核對全部 ☑；1 項 Major（M1，即上方 T-006 的根因）記錄為既有架構風險放大、不阻擋本次；2 項 Minor、1 項 Nit（既有註解過時、既有分母小瑕疵、四處近似守門邏輯建議未來抽共用 helper），均非阻擋。獨立重跑測試證據與 QA、engine/ui-engineer 自報完全一致。

## 7. QA 報告

`docs/qa/T-004-qa-report.md`：**通過**，無 Blocker／Critical／Major／Minor bug。逐條驗收條件全數通過；核心情境（電腦觸發、真人在非自己回合收卡且能正常解卡、不卡死、不靜默清空）已用真實 UI 路徑（非純引擎呼叫）重現且驗證修復有效；六解析度、教學、多人連線 smoke test（2 真人＋2 電腦，走真實 `mpSend`／`appendAction` 廣播路徑）、6 項邊界探索、既有測試交叉檢查均無異常。

## 8. 平衡影響

無。這次修法不改變任何人（真人或電腦）「會不會申購」「中不中籤」的機率或金額，只改變真人「有沒有被通知去決定」，不需要重跑 `test:balance`／`simtest`（architect、engine-engineer 均已在各自文件中確認）。

## 9. 測試結果

本次 release 前重新完整執行（未沿用工程師／QA 回報），逐行核對輸出文字，不只看 shell exit code：

| 套件 | 結果 |
|---|---|
| `node tests/contentcheck.js`（含於 build） | `{"errors":0,"warnings":3}`（3 則既有 WARN，與本次改動無關） |
| `npm run test:engine`（gate 1000 局） | `{"games":1000,"NaN":0,"Infinity":0,"invalidGames":0,"invalidReasons":{},"assetLedgerMismatch":0}` |
| `node tests/runtests.js` | `{"pass":97,"total":97}`（含 `T-59` 修法 C） |
| `node tests/s45test.js` | S1 段 `{"pass":19,"fail":0,"pageErrors":0}`（含 `D5-1c（T-004）`）／S2 段 `{"pass":5,"fail":0,"pageErrors":0}` |
| `node tests/s18test.js` | `{"pass":20,"fail":0}`（含追加授權的驅動迴圈修法） |
| `node tests/editortest.js` | `{"pass":13,"fail":0,"pageErrors":0}` |
| 其餘 `test:ui` 鏈上測試檔（`s17`／`s19`／`s20`／`s22`～`s24`／`s26`～`s45`） | 全數 `fail:0／pageErrors:0`，**唯一例外**：`tests/s22test.js` 的「模擬器速度：20 局 < 4 秒」計時項在本機環境下量到 4076–5338ms（已重跑 4 次，每次都超出 4 秒的硬性門檻），詳見「10. 未預期發現」——已用 `git stash` 驗證：與 T-004 本次 diff 完全無關（HEAD 上、未套用任何 T-004 改動時同樣量到超時），是既有測試門檻對本機當前速度過緊，非本次引入的回歸 |
| `npm test` shell exit code | **1**（非 0）——原因就是上一列 `tests/s22test.js` 的計時 FAIL，鏈式 `&&` 在此中斷；已依 T-002 修好的機制（`process.exit(fail?1:0)`）正確反映真實測試狀態，release-manager 已逐行核對輸出文字並用 `git stash` 排除是本次改動造成，判斷不阻擋本次發布（見「10. 未預期發現」） |

**與本次 T-004 修復直接相關的所有測試（`applyAction.js`／`uiCore.js`／`uiViews.js`／`s45test.js`／`s18test.js`／`runtests.js`）全數 PASS，沒有任何回歸。** 唯一的 FAIL 是一項與本次改動完全無關、且在改動前（HEAD）也同樣失敗的既有計時測試。

## 10. 未預期發現

1. **`tests/s22test.js`「模擬器速度：20 局 < 4 秒」在本次驗證環境下持續超時**：4 次重跑量到 4076ms／4136ms／4475ms／5338ms，均超過寫死的 4000ms 門檻。用 `git stash` 把工作區還原成本次 T-004 改動前的狀態（即 commit `5a06845`）重跑同一測試，**同樣失敗**，證實與 T-004 本次 diff 無關，是既有測試對「20 局模擬器乾跑」設的固定時間門檻，在本機目前的執行環境下已經頂到邊界（門檻本身沒有依機器效能做任何餘裕係數）。不在本次 release-manager 權限範圍內修改測試門檻或優化模擬器效能，建議另開票交 pm-planner／architect 評估是否要放寬門檻或加入效能余裕係數，避免往後每次在較慢的機器或較忙的環境上跑測試都被這項計時測試卡住 `npm test` 的 exit code。**本次判斷不阻擋 T-004 發布**：核對範圍與前三次（T-001／T-002／T-003）release 遇到已知不相關失敗（如 T-86）時的處理方式一致——記錄、不擋、留給後續追蹤。
2. `.claude/hooks/check-forbidden.sh` 在編輯 `engineCore.js`（改 `ns.BUILD` 版本字串）與 `manual/*.html` 時各觸發誤報（命中的是描述「鐵律一」的既有註解文字本身，不是真的呼叫 `Date.now()`／`Math.random()`），與 T-001 release-manager 報告記錄的既有 hook 誤判相同，已逐一確認每次 Edit 實際寫入成功，不影響本次任何檔案內容。
3. 沒有發現其他偏離任務單／ADR 補充裁決文件描述的地方。

## 11. 動到的檔案

| 檔案 | 改動 |
|---|---|
| `src/engine/reducer/applyAction.js` | `E.openIpo` 最後一段改成 `S.players.forEach` 廣播 `IPO_ANNOUNCE` 給全場還在場、沒破產的真人（原僅推給觸發者） |
| `src/ui/uiCore.js` | `ui.renderCenter`：把「決策卡／破產」判斷搬到「NPC 思考中」判斷之前（修法 A） |
| `src/ui/uiViews.js` | `ui.tick` 新增守門（修法 B）；`T-59` 死當重現迴圈新增「非自己回合解自己的懸置決策」模擬分支（修法 C） |
| `tests/s45test.js` | 新增 `D5-1c（T-004）`（S1）；S2 段第 477 行 `four` fixture 修正 `isNPC` 判斷與 `personality` 補值 |
| `tests/s18test.js` | 30 輪驅動迴圈新增同款模擬分支（追加授權） |
| `docs/adr/ADR-001-新股抽籤.md` | 修訂記錄新增第三條；D5 節第 1、3 點與「影響」「驗證方式」章節同步更新為現況 |
| `package.json` | 版本 `2.53.0` → `2.53.1` |
| `src/engine/core/engineCore.js` | `ns.BUILD.ver` `v2.53.0-S45` → `v2.53.1-S46`，日期同步改今天 |
| `manual/rulebook.html` | 封面 tag、頁尾版本字串同步更新為 `v2.53.1-S46` |
| `manual/quickstart.html` | 封面、頁尾版本字串同步更新為 `v2.53.1-S46` |
| `index.html` / `dist/index.html` / `card_editor.html` | `npm run build` 產出（不手改） |

另有 QA 於驗收過程新增、未進 `test:ui` 主鏈的獨立回歸腳本：`tests/qa-t004-singleplayer-repro.js`、`tests/qa-t004-mp-smoke.js`、`tests/qa-t004-resolutions.js`、`tests/qa-t004-edgecases.js`（詳見 `docs/qa/T-004-qa-report.md`）。

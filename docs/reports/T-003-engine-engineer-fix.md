# T-003 engine-engineer 修復回報（依 ADR-001 補充裁決方向 (c)）

- 對應：T-003（`docs/tickets/T-003-EXTEND_GAME斷言失敗.md`）／裁決依據：`docs/adr/ADR-001-新股抽籤-T003補充裁決.md`
- 撰寫：engine-engineer，2026-09-11
- 日期：2026-09-11

## 結論

1. **完成。** 依 architect 裁決方向 (c)，只改測試斷言，未改動 `src/engine/` 任何一行；T-86 S14b 已由 FAIL 變 PASS，其餘既有 96 項斷言無新增 FAIL（改動前 96/97、改動後 97/97）。
2. `tests/s39test.js`（8/8 PASS）、`tests/s45test.js`（18/18＋5/5 PASS）交叉驗證全數通過，確認未間接影響 S39 集資結算與 T-001 新股結算既有邏輯。
3. `npm test` 最終 exit code＝**0**（實測兩次皆為 0），T-002／T-003 的 exit code 閉環驗證達成。

## 範圍核對（先回報事項）

裁決文件與本次分派任務要求「可改：`src/ui/uiViews.js`」，這與我作為 engine-engineer 的一般性角色限制（僅 `src/engine/`、`tests/`）字面上有出入。但依 `docs/tickets/T-003-EXTEND_GAME斷言失敗.md` 第 5 節 pm-planner 原始判斷——此段測試「雖然物理位置在 `src/ui/uiViews.js`，但性質是引擎回歸測試（掛在 `ns.selftest` 下）」，且 architect 的 ADR-001 補充裁決文件亦逐字指定「只改 `src/ui/uiViews.js:1618-1621`」並給出可直接採用的程式碼。此為經 pm-planner 與 architect 兩道正式流程（ticket＋ADR）審查後的明確指示，非對話中臨時擴權，故依指示執行，並在此明列供製作人／architect 留意「測試斷言物理位置與職責歸屬」這個既有結構上的模糊地帶，未來若要根治建議另開票討論是否要把這類引擎回歸測試搬到 `tests/` 目錄下，與 `src/ui/uiViews.js` 的實際 UI 邏輯分開。

## 變更檔案清單

- `src/ui/uiViews.js`：`git diff --stat` 顯示 `+22 -3`（原 4 行斷言改寫為含白名單集合與金額交叉驗證的 22 行新斷言邏輯，位置約在原 1618-1621 行附近，"T-86 S14b 回合上限與延長（EXTEND_GAME）" 測項情境 (b) 段落）
- 備份檔：`src/ui/uiViews.js.backup.20260911`（改動前狀態，含改動前既有的其他未提交修改，供回復使用）
- 未改動任何 `src/engine/` 檔案（依裁決要求）

具體改動內容（取代原本「現金變動玩家數 ≤1」的單純計數斷言）：

```js
// 續攤不是重開：現金水位必須連續。允許變動的只有：
// (1) 接回當事人（player 0，本情境固定，發薪）
// (2) ADR-001 D5-2／D5-3：若續攤這次 beginTurn 剛好觸發 IPO 保底補開，
//     E.openIpo 會同步呼叫 E.ipoPollNPC 讓符合條件的電腦玩家立即申購——
//     這是 T-001 既有設計行為，不是 bug，允許這些玩家的現金也變動，
//     但變動金額必須精確等於「申購款＋手續費＋通知費」，防止真的有
//     其他未預期的 bug 藏在這條路徑裡被誤判為「反正是 IPO 就放行」。
var ipoSubs=r2.events.filter(function(e){
  return e.type==="IPO_SUBSCRIBED" && e.npc===true; });
var allowed={0:true};
ipoSubs.forEach(function(e){ allowed[e.playerId]=true; });
var cashA=S2.players.map(function(z){return z.cash;});
var badIdx=cashA.map(function(c,i){ return i; }).filter(function(i){
  return cashA[i]!==+cashB.split("|")[i] && !allowed[i]; });
assert(badIdx.length===0,
  "續攤不得重算「當事人＋保底IPO同步申購的電腦玩家」以外的現金，異常玩家 idx="+badIdx.join(","));
ipoSubs.forEach(function(e){
  var before=+cashB.split("|")[e.playerId], after=cashA[e.playerId];
  var expectDelta=-util.r2(e.price+E.cfg(S2,"ipoFee",0.02)+E.cfg(S2,"ipoNoticeFee",0.05));
  assert(Math.abs((after-before)-expectDelta)<1e-6,
    "電腦玩家因保底IPO被動申購的現金變動應等於「申購款＋手續費＋通知費」，playerId="+e.playerId+
    " 實得差額 "+(after-before)+" 期望 "+expectDelta);
});
```

與 ADR-001 補充裁決文件內的建議程式碼**逐字一致**，未做任何調整（欄位名稱 `type`／`npc`／`playerId`／`price` 經查 `applyAction.js:4674` `E.ev("IPO_SUBSCRIBED",{ipoId:...,tier:...,playerId:q.id,price:tierDef.P,npc:true})` 與 ADR 假設完全吻合；`E.apply` 回傳的 `events` 欄位經查 `applyAction.js:207/1557` 確認一律存在；`util`／`E`／`E.cfg` 在 `uiViews.js` 檔案頂部第 3 行 `var util=ns.util, ledger=ns.ledger, E=ns.engine, ui=ns.ui;` 已在作用域內，可直接使用）。

## 測試證據

### 1. 改動前 baseline（用備份檔還原後重跑，確認與票內描述一致）

```
$ node tests/runtests.js
{"pass":96,"total":97}
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
```

### 2. 改動後（還原修復版，重跑 `node tests/runtests.js`）

```
$ node tests/runtests.js
{"pass":97,"total":97}
```
無任何 `❌` 輸出，T-86 不再出現於 FAIL 清單，其餘 96 項無新增 FAIL。

### 3. 交叉驗證（架構裁決要求，額外跑既有指令，未改內容）

```
$ node tests/s39test.js
...
{"pass":8,"fail":0,"pageErrors":0}

$ node tests/s45test.js
...
{"pass":18,"fail":0,"pageErrors":0}
...
{"pass":5,"fail":0,"pageErrors":0}
```
`s39test.js`：8/8 PASS。`s45test.js`：兩個評估區塊分別 18/18、5/5，皆 PASS。確認未間接影響 S39 集資結算與 T-001 IPO 邏輯。

### 4. `npm test` 整體 exit code（T-002／T-003 閉環驗證，實測兩次）

第一次（含 `test:engine`＋`test:ui` 全部 28 支測試檔）：
```
{"pass":97,"total":97}   ← tests/runtests.js（含 T-86）
...
FINAL2_EXITCODE=0
```
`grep -in "fail\":[1-9]\|❌"` 掃描全部輸出：無任何匹配（零 FAIL）。

第二次重跑（純粹再驗證一次穩定性）同樣 `exit code = 0`，`{"pass":97,"total":97}`，無 FAIL。

**確認：`npm test` 整體 exit code 已回到 0。**

## 未預期發現

1. **`tests/s22test.js` 出現一次性計時 flaky FAIL，與本次改動完全無關：** 在第一次完整 `npm test` 跑法中，`s22test.js`（package.json `test:ui` 腳本第 5 支）出現：
   ```
   FAIL 模擬器速度：20 局 < 4 秒（S21 乾跑版是 20 局 69 秒） :: 20 局花了 4013ms
   ```
   這是一個 wall-clock 效能門檻斷言（<4000ms），實測花了 4013ms，差距僅 13ms，屬機器負載造成的計時 flaky，不是邏輯錯誤。單獨重跑 `node tests/s22test.js` 立刻恢復 16/16 全過；隨後完整重跑一次 `npm test` 也是 0 FAIL、exit code 0。**未做任何修改**（`tests/s22test.js` 不在本票分派範圍內，且此為既有效能門檻測試，非 T-86／EXTEND_GAME／IPO 相關邏輯）。提醒 qa-tester／architect：這類固定毫秒門檻的效能測試在較慢或忙碌的機器上有偶發失敗風險，是否要放寬門檻或改用相對基準，請視情況另開票評估，不在本票處理範圍。
2. `tests/runtests.js` 在本次工作開始前 git 工作區即已存在未提交修改（非本次改動造成，推測是先前 T-002 exit code 機制修復的殘留），本次未觸碰此檔案內容，僅確認其存在不影響本次驗收。
3. 跑測試會重建 `index.html`（`npm run build` 副作用），已用 `git checkout -- index.html` 還原乾淨，符合慣例。

## 需要其他角色或製作人決定的事

1. 「範圍核對」段落提到的角色權限字面衝突（engine-engineer 一般限定 `src/engine/`＋`tests/`，但本票明確指示改 `src/ui/uiViews.js`）——已依 pm-planner／architect 兩道正式流程的明確指示執行，但建議未來由 pm-planner 或 architect 評估是否要把這類「物理位置在 `src/ui/` 但性質是引擎回歸測試」的區塊搬到 `tests/` 目錄，避免下次再出現角色分派與目錄歸屬對不齊的情況。
2. `tests/s22test.js` 的固定毫秒效能門檻建議 qa-tester／architect 評估是否需要放寬或改為相對基準，降低機器負載造成的 flaky 機率（非本票範圍，僅供參考）。

T-003 依驗收條件 1–4 全數達成，不需要再等 architect。

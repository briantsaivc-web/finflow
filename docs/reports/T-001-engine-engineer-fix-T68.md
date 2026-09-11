# T-001 engine-engineer 回報：修 T-68（IPO_POOL 撞關鍵字掃描）

## 結論

**受阻，未動任何檔案。** 分派單指定「可改 `tests/runtests.js`、不可碰 `src/ui/`」，但實際查證後發現 T-68 的完整斷言邏輯（含要修改的 `KID` 關鍵字掃描迴圈）**全部寫在 `src/ui/uiViews.js` 裡的 `ns.selftest`**，`tests/runtests.js` 本身只是一支 Playwright 殼，不含任何卡片／牌堆掃描邏輯，無法在不碰 `src/ui/uiViews.js` 的前提下完成「排除 `IPO_POOL` 牌堆」這個修改。依 CLAUDE.md 第 5 節「查不到就標 UNKNOWN」與工作步驟「有出入先回報，不要自行擴大」，本次停在此步，未做任何編輯，也未觸碰 `src/ui/uiViews.js`（不在 engine-engineer 允許目錄，且本票明確列為不可碰）。

## 查證細節

1. `tests/runtests.js`（26 行，git 工作區乾淨，未修改）的全部內容：用 Playwright 開啟 `index.html`，在頁面內執行 `ns.selftest.run(false)`，把回傳的 `{pass,total,fails[],names[]}` 印出來。**它完全不含測試斷言本身、不含卡片資料、不含關鍵字清單、不知道「deck」這個概念**——它只是呼叫已經打包進 `index.html`（由 `src/ui/uiViews.js` 提供）的既有函式並轉印結果。
2. 用 `grep -rn "T-68"` 搜尋全 repo，命中只有兩處：`src/ui/uiViews.js` 與打包後的 `index.html`（後者是前者的建置產物，release-manager 才能動、我也不該碰）。`tests/runtests.js` 裡沒有任何一行提到 T-68。
3. 讀 `src/ui/uiViews.js:6078-6130`，確認 T-68 測項 `t("T-68 沒有小孩就不該抽到小孩的帳單", function(){...})` 內部：
   - 第 6094 行：`var KID=["孩子","小孩","嬰兒","嬰幼兒","幼兒","安親","補習班","才藝","親子"];`
   - 第 6096-6109 行：`Object.keys(ns.content.cards).forEach(function(dk){ (ns.content.cards[dk]||[]).forEach(function(c){ ... }); });`——這裡的 `dk` 就是牌堆名稱（deck key），要排除 `IPO_POOL` 牌堆，正確且最小的改法是在第 6096 行加一行 `if(dk==="IPO_POOL") return;`，或在第 6099 行判斷式前加同樣的排除。**這一行必須寫在 `src/ui/uiViews.js`，不可能只靠改 `tests/runtests.js` 達成**，因為 `tests/runtests.js` 執行當下拿到的只是頁面回傳的聚合結果字串（`fails: [...name+' :: '+detail]`），沒有逐張卡片的 deck 資訊可供二次過濾，而且逐字串比對／過濾失敗訊息屬於「假裝通過」，不是「修掃描邏輯」，也違反分派單「不要改動其他牌堆的檢查範圍」這句話背後的意圖（應該改在源頭的掃描條件，而不是在下游隱藏訊息）。

## 為什麼不採取變通做法

考慮過在 `tests/runtests.js` 裡對 `page.evaluate()` 回傳的 `out.fails` 陣列做字串過濾（例如濾掉含 `"IPO_S20"` 的 T-68 失敗項，再修正 `pass`／`total` 計數後才印出），但判斷這不符合分派單真正要的效果，原因：
- `ns.selftest.run(false)` 內部的 assert 仍然會真的丟出失敗（`assert(!leak.length, ...)`），這代表**頁面內的 `ns.selftest` 狀態本身仍是 FAIL**，只是被 `runtests.js` 這層殼在印出前竄改掉——這正是 QA 報告已經點名的「测试框架讓人誤判全過」那類風險的同類問題，只是換了個地方發生，不應該由我這次順手引入第二個同類地雷。
- 這也違反「只動任務單指定的範圍」：分派單要的是「讓 T-68 的關鍵字掃描排除 IPO_POOL 牌堆」，掃描本身在 `src/ui/uiViews.js`，不在 `tests/runtests.js`。

## 變更檔案清單

無（未修改任何檔案）。

## 測試證據

未執行修改，因此沒有「修後」的測試證據。附上修改前現狀（引用 QA 報告，未重新执行，避免和 QA 的既有證據混淆）：`docs/qa/T-001-qa-report.md` 第 54 行顯示 `node tests/runtests.js` 目前輸出中有一行：
```
❌ T-68 沒有小孩就不該抽到小孩的帳單 :: 這些卡的標題明講是小孩的花費，卻沒有小孩也會遇到：IPO_S20「補習班連鎖（虛構）」
```

## 未預期發現

1. 分派單第 5 節「你的範圍」寫「可改：`tests/runtests.js`、不可碰：`src/ui/`」，與實際程式碼結構不符——T-68 的斷言與 `KID` 關鍵字掃描 100% 位於 `src/ui/uiViews.js` 的 `ns.selftest`，`tests/runtests.js` 只是呼叫它的 Playwright 殼，兩者職責分離，不是分派單假設的「同一支檔案裡有掃描邏輯」。
2. `src/ui/uiViews.js` 目前在本機工作區已是 modified 狀態（`git status` 顯示 `M src/ui/uiViews.js`），推測是 S1/S2 等其他子任務已有的變更，與本次要做的 T-68 修改無關，但如果之後由 ui-engineer 接手改這一段，請留意先確認彼此改動不衝突。

## 需要其他角色或製作人決定的事

1. **範圍裁定**：請 architect／製作人決定下列哪一種方式處理：
   - (A) 把「排除 `IPO_POOL` 牌堆」這件事的可改檔案範圍修正為 `src/ui/uiViews.js`（第 6096 或 6099 行加一行 deck 排除），交給有權限改 `src/ui/` 的 **ui-engineer** 執行；或
   - (B) 明確授權本次任務單擴大 engine-engineer 的可改範圍到 `src/ui/uiViews.js` 這一處、僅限這一行 T-68 排除邏輯（需要製作人／architect 書面同意，且違反 CLAUDE.md 第 7 節職責表預設分工，需明確裁示才能執行）。
   - 依 CLAUDE.md 第 7 節，engine-engineer 預設不可改 `src/ui/`，個人建議走 (A)，但裁定權在製作人／architect。
2. 若採 (A)，建議改法與位置已在上方「查證細節」第 3 點寫清楚，可直接交給 ui-engineer 執行，預期是一行改動（`if(dk==="IPO_POOL") return;`），風險低。

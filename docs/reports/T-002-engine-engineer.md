# T-002 回報：測試框架斷言吞錯誤碼修復

- 執行者：engine-engineer
- 日期：2026-09-11

## 結論
1. `tests/runtests.js` 已補齊與其餘 34 個測試檔案一致的慣例：`ns.selftest.run(false)` 結果中若 `pass!==total`（即任一項 `ok===false`）或發生 `fatal`（ns 未定義／boot 失敗），一律 `process.exit(1)`；全過才 `process.exit(0)`。
2. 已用「在 harness 內暫時注入一筆假失敗結果」的方式驗證機制有效，確認 `npm test` exit code 由假失敗前的行為（若無此修復會是 0）驗證為非 0，驗證後已徹底移除假失敗，`git diff` 只剩真正的修復。
3. 修好後完整跑 `npm test`：exit code 非 0，失敗清單**只剩 T-86**（EXTEND_GAME），符合票上「T-68 已於 T-001 修好、T-003／T-86 尚未修」的過渡驗證預期。

## 變更檔案清單
- `tests/runtests.js`（+2 行，新增於第 26–27 行）
  - 修改前（原 27 行）→ 修改後（29 行）
  - 新增內容：
    ```js
    const fail = !!out.fatal || (out.pass!==out.total);
    process.exit(fail?1:0);
    ```
- 未新增任何其他 tracked 檔案的變更（`index.html`／`card_editor.html`／`dist/index.html` 等 build 產物在多次 `npm run build` 後均未出現在 `git status` 中，本來就非 dirty 狀態，未需 `git checkout` 還原）。
- 未建立 `.backup` 檔：確認 `git status` 顯示 `tests/runtests.js` 在改動前無任何未提交變更（乾淨），依 CLAUDE.md「或確認 git 工作區乾淨可回復」條款，改用 git 可回復性替代備份檔。

## 測試證據

### 1. 假失敗注入驗證（驗收條件 2）
在 `tests/runtests.js` 的 `page.evaluate` 內，`ns.selftest.run(false)` 之後暫時加入：
```js
r.results.push({ok:false, name:'T002_FAKE_TEST', detail:'人工製造的假失敗，驗證 exit code 機制用，驗證完會移除'});
r.pass = r.results.filter(x=>x.ok).length;
r.total = r.results.length;
```
執行 `npm test`（bash 環境，用 `echo $?`），關鍵輸出：
```
{"pass":96,"total":98}
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
  ❌ T002_FAKE_TEST :: 人工製造的假失敗，驗證 exit code 機制用，驗證完會移除
EXITCODE=1
```
確認：假失敗會被 `runtests.js` 捕捉到（`pass:96, total:98`，差 2＝T-86＋假失敗），且整條 `npm test` 鏈的 shell exit code 為 **1**，證明修復生效。

### 2. 還原假失敗後的乾淨證明
移除注入的三行後，重新讀取檔案內容確認只剩真正修復；並執行：
```
$ git status --short tests/runtests.js
 M tests/runtests.js
$ git diff -- tests/runtests.js
diff --git a/tests/runtests.js b/tests/runtests.js
index cca9caf..fb81b91 100644
--- a/tests/runtests.js
+++ b/tests/runtests.js
@@ -23,4 +23,6 @@ const TARGET = __path.resolve(process.argv[2] || __path.join(__dirname, '..', 'i
   if(out.fails) out.fails.forEach(f=>console.log('  ❌ '+f));
   if(errs.length) console.log('--- page errors ---\n'+errs.slice(0,10).join('\n'));
   await b.close();
+  const fail = !!out.fatal || (out.pass!==out.total);
+  process.exit(fail?1:0);
 })();
```
`git diff` 只顯示新增的 2 行修復，沒有任何假失敗殘留。

### 3. 修好後完整 `npm test`（過渡驗證，驗收條件 3）
重新跑一次完整 `npm test`（`test:engine`＝build+extract+gate、`test:ui`＝30 個測試檔案鏈），關鍵輸出：
```
{"pass":96,"total":97}
  ❌ T-86 S14b 回合上限與延長（EXTEND_GAME） :: 續攤不得重算超過一位玩家的現金（發薪只該發給接回的那一位）
EXITCODE=1
```
確認：
- exit code 為 **非 0（1）**，正確反映真實失敗（不再誤判為全過）。
- 失敗清單**只有 T-86 一項**，未見 T-68（已於 T-001 修復）或其他新冒出的失敗。這是符合票上「T-003／T-86 仍未修時，此為正確過渡狀態」的預期行為。**T-86 仍會讓 exit code 非 0 是符合預期的過渡狀態，等 T-003 修完後 exit code 才會回到 0。**

跑完後再次確認 build 產物未污染 git 工作區：
```
$ git status --short tests/runtests.js index.html dist/index.html card_editor.html
 M tests/runtests.js
```
只有 `tests/runtests.js` 有變更，無需 `git checkout` 還原任何 build 產物。

## 未預期發現
- `Edit` 工具的 PostToolUse hook（`.claude/hooks/check-forbidden.sh`）每次編輯（即使只動 `tests/runtests.js`）都會印出關於 `src/engine/core/engineCore.js`（及其兩份 `.backup` 檔）第 3 行註解文字含「Date.now() / Math.random()」字樣的警告。經確認這是該檔案**既有、未被本次任務觸碰**的檔頭註解文字（在說明鐵律，不是實際違規用法），本次修改未涉及 `src/engine/core/engineCore.js`。此為 hook 誤報（掃描範圍似乎是全域而非僅本次改動的檔案），提報供 architect／製作人知悉，非本票需修復範圍。
- `package.json` 的 `test`／`test:ui`／`test:engine` 三個指令字串**確認不需修改**：根因單純在 `runtests.js` 內部缺少 exit code 判斷，`&&` 串接機制本身正常，已透過本次實測（假失敗會正確中斷／反映在最終 exit code）驗證。

## 需要其他角色或製作人決定的事
- T-003（T-86 EXTEND_GAME）修復後，請再跑一次 `npm test` 確認 exit code 回到 0，完成本票與 T-003 的最終閉環驗收（驗收條件 3 的完整版）。
- 無其他需要 balance-designer／content-writer 新增參數的需求。

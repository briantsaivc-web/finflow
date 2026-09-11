# T-001 分派單：新股抽籤

- 任務單：`docs/tickets/T-001-新股抽籤.md`
- ADR：`docs/adr/ADR-001-新股抽籤.md`
- 撰寫：Claude（Cowork，代 architect）；開工前請本機 architect 審閱，回覆「通過／需修改」
- 共同紀律：CLAUDE.md 第 3、5 節；改檔前備份 `<檔名>.backup.20260910`；回報寫到 `docs/reports/T-001-<角色>.md`

## 子任務

| 子任務 | 角色 | 可改檔案 | 不可碰 | 輸入／輸出契約 | 要新增的測試 | 並行／序列 |
|---|---|---|---|---|---|---|
| S0 | engine-engineer | 無（只讀＋在 scratch/ 寫一次性腳本） | 全部 src/ | 查證一件事並寫進回報：記帳 UI 能不能處理 eduTags `"ipo"` 的 ASSET 分錄（或者是否該加進 DENY）。以下兩項 architect 審查 ADR-001 時已查證，S0 免重查，直接引用：①`gate.js` 的 `assetLedgerMismatch`（`tests/gate.js:36-42`）只走訪 `p.assets[]` 裡已登記的 refId，IPO 預扣款（不進 `p.assets`）不會被檢查到，**確認安全** ②破產入口函式確定是 `E.declareBankrupt`（`applyAction.js:3632-3636`），呼叫 `E.ipoRefundPlayer` 應排在 `:3633` 行（清算）之前 | — | **最先做**；結論若要走 ADR D4 備案 → 停，回報 architect |
| S1 | engine-engineer | src/engine/core/engineCore.js、src/engine/reducer/applyAction.js、src/engine/npc/contentNpcSim.js、tests/s45test.js、package.json（**只**在 `test:ui` 加 `node tests/s45test.js`） | src/ui、src/network、src/data、版本號 | 實作 ADR D1–D5：`E.ipoRoll`、`S.ipo`、`p.ipoEscrow`、`IPO_SUBSCRIBE`／`IPO_DECLINE`、`E.openIpo`、`E.ipoPollNPC`、`E.settleIpo`、`E.ipoRefundPlayer`；事件 `IPO_OPENED`／`IPO_SUBSCRIBED`／`IPO_SETTLED`；決策 kind `IPO_ANNOUNCE` | tests/s45test.js（ADR「驗證方式」①–⑩） | 等 S0；**需要 S3 的參數**：S3 尚未完成時，先用 ADR D6 的預設值寫進 `E.cfg` 的 fallback，並寫進回報 |
| S2 | ui-engineer | src/ui/uiCore.js、src/ui/uiViews.js、src/ui/styles.css、src/editor/cardEditor.html | src/engine、src/network、src/data | 讀 `S.ipo.pending` → ①`IPO_ANNOUNCE` 決策卡（兩檔並排：申購價／參考價／價差／中籤率／破發提示＝g＜0.25 時顯示；按鈕：申購小資／申購股王／都不要）②交易所「📢 新股申購中」列③POP 與訊息欄對應三種事件④淨值面板顯示「申購預扣款」⑤工坊：`IPO_POOL` 可編輯；kind 下拉選單的每個選項附一行說明 | tests/editortest.js 加 2 項；UI 冒煙測試併入 s45test 的 page 段落（與 S1 協調：S1 寫引擎段、S2 寫 page 段，**同一個檔案、依序寫入**） | 等 S1 |
| S3 | balance-designer | src/data/config/defaultParams.json | src/ 程式 | 新增 ADR D6 的全部參數（group「市場」） | `node tests/contentcheck.js` 通過 | 與 S0／S1 並行 |
| S4 | content-writer | src/data/packs/v10.json（只新增 `IPO_POOL` 牌堆）、manual/ | 數值欄位、其他牌堆 | 小資 20 筆＋股王 15 筆，一律虛構公司名；5 條教育點 eduNote；規則書一節 | contentcheck 通過（若 contentcheck 不認得 deck `IPO_POOL`／kind `IPO_NAME` → 回報，由 S1 在 tests/contentcheck.js 加白名單） | 與 S0／S1 並行 |
| S5 | network-engineer | src/network/syncAdapter.js | src/engine 規則 | 比照 S39 集資的通知列（約 877、917 行）：非公告者看到「📢 新股申購：點這裡申購」；確認舊版客戶端加入新房時的既有擋法，寫進回報 | mptest／mp2 通過 | 等 S1 |
| S6 | balance-designer | docs/balance/T-001-balance.md | src/ | `npm run test:balance`，3 種子（4242／9001／31337）× 500 局，改版前後對照：全局中位、畢業人次、三性格自由率／破產率、跌落率、每局公告次數、每局中籤人次 | — | 等 S1＋S3 |

## 交叉影響裁決
1. **s45test.js（S1 與 S2）**：S1 先建檔、寫引擎段落；S2 之後才能在檔尾加 page 段落。S2 不得修改 S1 寫的斷言
2. **package.json（S1 與 release-manager）**：S1 只加測試指令；版本號由 release-manager 在 /release 時改。S1 改之前先備份
3. **v10.json（S4）與 defaultParams.json（S3）**：不同檔案，可以並行
4. **tests/contentcheck.js**：預設不動；只有 S4 回報不認得新 deck／kind 時，才由 S1 改（S1 範圍內追加）
5. **`E.beginTurn` 結算順序**：集資 → 抽籤 → 停走判斷。S1 不得調整既有集資區塊
6. **亂數**：任何人都不得在 IPO 相關程式碼用 `util.rand(S)`。reviewer 看到必退件

## 預估
S0 0.5、S1 1–2、S2 1、S3 0.2、S4 0.5、S5 0.5、S6 0.5 個 session；之後 /qa-gate 1 個 session。

## 風險
- S0 若判定必須走 ADR D4 備案 → ui 範圍會擴大（資產列表要過濾 `IPO_ESCROW`），需要重新估算
- 電腦玩家參與後的平衡位移，由製作人看完 S6 報告再決定要不要調 r

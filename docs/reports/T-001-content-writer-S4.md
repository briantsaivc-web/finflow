# T-001 S4（content-writer）回報：新股抽籤 內容與規則書

## 結論（3 行內）
1. `src/data/packs/v10.json` 新增 `IPO_POOL` 牌堆：小資（`tier:"SMALL"`）20 筆、股王（`tier:"BIG"`）15 筆，共 35 筆，全部虛構公司名，其中 5 筆補了完整教育點 `eduNote`。
2. `manual/rulebook.html` 新增「8.10 新股抽籤」一節（申購／抽籤／中籤與沒中的結果），並在「狀況速查表」加一列指過去；未動 PDF（PDF 是由 `manual/topdf.js` 從 html 編譯，非本次範圍，需製作人或 release-manager 之後重新產出）。
3. 已讀 `src/engine/reducer/applyAction.js` 確認 S1 的 `E.ipoIssueTier` 只讀取 `IPO_POOL` 卡片的 `id`（當 `poolId`）、`title`（當顯示名稱）與 `tier`——我的卡片格式（`id/deck/kind/tier/title/flavor/eduNote`，無 `payload`）與引擎實際讀法一致。

## 變更檔案清單
- `src/data/packs/v10.json`（編輯：新增 `cards.IPO_POOL` 陣列 35 筆，未動其他牌堆與任何數值欄位）
- `src/data/packs/v10.json.backup.20260910`（新建，編輯前的完整備份）
- `manual/rulebook.html`（編輯：新增 §8.10 新股抽籤一節，並在頂部「狀況速查表」加一列）
- `manual/rulebook.html.backup.20260910`（新建，編輯前的完整備份）
- `docs/reports/T-001-content-writer-S4.md`（本檔）

## 內容清單（35 筆）
- 小資檔 `IPO_S01`–`IPO_S20`：巷口洗衣工坊、好日子早餐連鎖、山海觀光民宿集團、貓咪經濟寵物用品、台灣手搖茶連鎖、小農直送電商、巷弄咖啡烘焙、樂齡照護服務、電競網咖連鎖、二手時尚交易平台、台灣淨水設備、自行車零件代工、桌遊出版工作室、網紅經紀公司、露營用品專賣、冷凍食品代工、家事清潔媒合平台、太陽能屋頂工程、老屋改建設計、補習班連鎖（全部標「（虛構）」）
- 股王檔 `IPO_B01`–`IPO_B15`：星嶺測試（ADR-001 D7 原始範例，逐字沿用）、昱鼎半導體、恆宇封測、台灣鋼砌重工、翔越航太零組件、雲鎮資訊、精曜光學、台灣電池材料、晶采生醫、海翼物流、恆基超商控股、台灣半導體設備、鑫銳金融科技、群峰重電、台灣量子運算（全部標「（虛構）」）
- 5 筆完整教育點（涵蓋承銷價與參考價的關係、破發風險、中籤率與超額認購、本益比、ADR 原始範例）：`IPO_S01`、`IPO_S02`、`IPO_B02`、`IPO_B03`、`IPO_B01`

## 語氣與用詞說明
- 對齊 `ARCHIVED_STOCK`／`MARKET` 牌堆既有語氣：一句話 flavor＋一句話點出風險或概念的 eduNote，不說教、偶爾戲謔（例如「山海觀光民宿集團」flavor「疫後報復性旅遊，訂房率一度衝上九成」）。
- 全部繁體中文，未使用「軟件／信息／視頻」等中國大陸用語（已用 grep 檢查過 `软件|视频|信息|硬体|软體` 無命中）。
- 金融名詞（承銷價、參考價、蜜月行情、破發、超額認購、本益比）維持一般性、概念正確的敘述；沒有引用我無法查證的具體真實公司數字——除了 ADR-001 本身已給定並經 architect 審過的「歷史原型：2026 漢測」那一筆（`IPO_B01`），其餘教育點刻意寫成概念性說明、不掛具體公司與數字，避免在缺乏查證工具的情況下編造事實。

## 測試證據
**我的工具集裡沒有可執行指令的工具（無 Bash／shell 存取），無法親自跑 `node tests/contentcheck.js`。** 已改用人工比對 `tests/contentcheck.js` 原始碼（讀過整份）逐條檢查我新增的 35 筆卡片：
- 必填欄位：每筆都有 `id`／`kind`／`title` ✅
- id 全域唯一：用 `Grep` 確認 `IPO_` 前綴在其他 9 個 pack 檔案裡完全沒有出現，35 筆彼此也無重複 ✅
- `effects`／`decision`／`skillBranch`／`virtueBranch`：都沒有這些欄位，`walkEffects` 不會報錯 ✅
- `OPPORTUNITY_*` 數值欄位檢查（第 5 條）：只對 `deck` 開頭是 `OPPORTUNITY` 的牌堆生效，`IPO_POOL` 不觸發，所以沒有 `payload` 也不會被判缺欄位 ✅
- 金額量級檢查（第 6 條）：只掃 `payload.*` 與 `c.cost`，我的卡片都沒有這些欄位 ✅
- 技能參照、`requiresEmploymentType`、`CHOICE` 順序、`DIGITAL assistSkills`、`SKILL_GATE` 分布：都以特定 `deck`／`kind` 為前提觸發，`IPO_POOL`／`IPO_NAME` 不落在任何一個條件裡 ✅
- 第 8 條「程式碼寫死的 id」：其正則只掃 `PRO_/SKL_/SKE_/BDG_/DIG_/ML_/OL_/OPS_/OPL_/OPP_/LS\d+/LE\d+/MA\d+/MK\d+/MKT_/MACRO_/CHOICE_/PE_` 這些前綴，`IPO_S`／`IPO_B` 不在其中，不會被掃到 ✅

另外交叉讀了 `src/engine/reducer/applyAction.js`（S1 已完成的部分）第 4597–4650 行左右的 `E.ipoIssueTier`／`E.openIpo`，確認引擎讀 `IPO_POOL` 牌堆時只用 `c.tier` 篩選、`c.id` 當 `poolId`、`c.title` 當顯示名稱；`ns.content.cards.IPO_POOL` 是空陣列時才會用「新股 A／新股 B」兜底——所以我的 35 筆格式（含 `tier` 欄位）與引擎期待完全吻合，理論上跑 `contentcheck.js` 應該不會報錯，也不需要 S1 額外加白名單。

**請 qa-tester 或有 shell 權限的角色實際跑一次 `node tests/contentcheck.js` 確認**（我只能做到人工比對原始碼）。

## 未預期發現
1. **無 Bash 工具**：本次分派給我的工具集只有 Read／Glob／Grep／Edit／Write，沒有任何可執行指令的工具，因此「測試」一節要求的 `node tests/contentcheck.js` 我無法親自執行，只能以人工讀原始碼比對取代。這件事本身可能需要製作人或架構師確認是否為預期設計（content-writer 本來就不該有 shell 存取，還是這次分派漏掉了）。
2. **S1／S2 已經在同步進行**：讀 `src/engine/reducer/applyAction.js` 與 `engineCore.js` 時發現 `E.ipoRoll`、`E.openIpo`、`E.ipoIssueTier`、`E.ipoDue` 等函式都已經寫好（含中文註解標註「T-001（ADR-001 D5-1）」），代表 S1 已完成或接近完成。我沒有修改這些檔案，只有讀取確認格式契合。
3. **`manual/quickstart.html` 未更新**：快速上手指南的內圈格子說明表（🟢 市場 ×5）目前沒有提到新股抽籤。分派單只要求「manual/ 補一節規則書文字」，我判斷這指的是完整規則手冊（`rulebook.html`），因此沒有動 `quickstart.html`；但玩家實際會在市場格上遇到這個機制，若製作人希望新手指南也提一句，需要另外分派。
4. **PDF 未重新產出**：`manual/` 目錄下另有 `FinFlow_完整規則手冊.pdf`、`FinFlow_快速上手指南.pdf` 兩份編譯後的 PDF，以及 `topdf.js` 轉檔腳本。這次只改了 html 原始檔，沒有重新跑 `topdf.js`（不確定這是否在我的權限範圍內、也沒有執行工具可跑），PDF 內容目前落後於 html。
5. **每次 Write／Edit 都跳出一則與本次改動無關的 hook 警告**：`.claude/hooks/check-forbidden.sh` 對 `src/engine/core/engineCore.js`（及其兩份既有備份檔）第 3 行的**註解文字**「鐵律一：引擎不讀寫 DOM、不使用 Date.now() / 未播種的 Math.random()」判定為疑似違規，但那只是說明鐵律本身的註解，不是實際呼叫；這個檔案不在我的任務範圍內，我沒有也不會去改它，僅在此回報這個看起來是 hook 規則的誤判（正則可能是抓到註解裡出現的 `Date.now()`／`Math.random()` 字樣），供 architect 或 engine-engineer 參考是否要調整 hook 的偵測方式。
6. **rulebook.html 版本號不一致**：封面寫 `v2.32.3-S25d`，頁尾寫 `v2.24.0-S19`，是既有落差（非我造成），不在我的權限內修改（版本號只有 release-manager 可改），順帶回報。

## 需要其他角色或製作人決定的事
1. 請 qa-tester／有 shell 權限的角色實際跑 `node tests/contentcheck.js` 驗證（我已人工比對過原始碼邏輯，判斷會通過，但沒有實跑）。
2. 是否要在 `manual/quickstart.html` 也補一句新股抽籤的新手提示（目前只有完整規則手冊 `rulebook.html` 有）。
3. PDF（`FinFlow_完整規則手冊.pdf`）是否需要重新用 `topdf.js` 產出，以及由誰執行。
4. 五筆完整教育點裡引用的 ADR 原始範例（`IPO_B01`「歷史原型：2026 漢測」）是 architect 已審過的既有文字，我逐字沿用；其餘教育點基於「找不到查證工具就不編造具體數字」的原則，刻意寫成概念性說明，如果製作人希望教育點更貼近具體真實案例（例如真實承銷價、真實中籤率數字），需要有查證能力的角色（architect 或有網路存取的角色）補上，我目前無法驗證這類具體數字的正確性。

# T-001 新股抽籤：code-reviewer 最終審查

- 角色：code-reviewer（唯讀，未修改任何檔案）
- 審查範圍：`git diff main` 涵蓋的全部追蹤檔案（見下方「審查範圍」），對照 ADR-001（含修訂記錄）、任務單、分派單、QA 報告、fix-T68 回報
- 審查日期：2026-09-10

## 判定：**有條件通過**（2 項 Major，需修但不需重新走完整 S0–S6 流程；0 項 Blocker）

---

## Findings（依嚴重度排序）

### Major #1 — IPO_SUBSCRIBE 缺少 actor.bankrupt / actor.playerStage==="INNER" 防呆，與同類機制不一致
- 位置：src/engine/reducer/applyAction.js:1241-1254（case "IPO_SUBSCRIBE"）
- 對照：
  - 同樣是「全場廣播、非回合可回應」的既有先例 JOIN_SYNDICATE（applyAction.js:1210-1229）明確檢查 if(!jp || jp.bankrupt || jp.playerStage!=="INNER") return reject("BAD_PARTY");
  - IPO 機制自己的電腦玩家路徑 E.ipoPollNPC（applyAction.js:4655）也明確篩選 x.isNPC && !x.bankrupt && x.playerStage==="INNER"
  - 但真人路徑 IPO_SUBSCRIBE 兩項都沒檢查，只查 NO_IPO／IPO_MISMATCH／IPO_TIER／IPO_DUP／IPO_CASH
- 問題：人類路徑與電腦路徑對「誰可以申購新股」的規則不對稱。已確認的兩個具體後果：
  1. OUTER（夢想圈／已圓夢）真人玩家可以持續申購新股：外圈棋盤（boardLayoutOuter，base.json）沒有 MARKET 格型，所以外圈玩家不會自己觸發或被動收到 IPO_ANNOUNCE 決策卡，但因為 IPO_SUBSCRIBE 是 E.OFF_TURN_RESPOND 白名單、全場廣播狀態，只要他知道目前有 S.ipo.pending（IPO_OPENED 事件全場都會收到），仍可以直接送出 IPO_SUBSCRIBE 動作申購成功。這是否為刻意設計（讓全部玩家包含已畢業者都能參與）沒有在 ADR／任務單裡明確寫下，NPC 路徑卻明確排除了 OUTER，兩條路徑行為不一致。
  2. 破產防呆是巧合而非保證：目前之所以「看起來沒事」，是因為 E.declareBankrupt 只在 p.cash<0 時被呼叫（applyAction.js:3672 / checkRescued），而 IPO_CASH 檢查（actor.cash<costS）會自然擋下負現金的人——但這是現有觸發破產路徑的副作用，不是 IPO_SUBSCRIBE 自己的防呆。任何未來新增的破產觸發路徑，只要允許「破產但現金非負」的中間態，這裡就會出現一個可以繞過設計意圖的申購缺口。
- 為什麼是問題：CLAUDE.md 鐵律六要求「AI 對手路徑與人類路徑都要測」，這裡兩條路徑不只是「都要測」，規則本身就對不上，而且完全沒有測試覆蓋這個落差（tests/s45test.js、tests/qa-ipo-exploratory-test.js 都只測了「先申購、後破產」的方向，沒有測「已破產／已畢業時嘗試申購」）。
- 建議：在 IPO_SUBSCRIBE（以及保守起見 IPO_DECLINE）比照 JOIN_SYNDICATE 補上 actor.bankrupt 檢查；playerStage 是否要限制在 INNER，這是產品規則問題，需要製作人裁示「外圈玩家能不能申購新股」，裁示後把 IPO_SUBSCRIBE／ipoPollNPC／E.openIpo 的保底觸發（D5-2，p===E.alive(S)[0]，同樣沒有排除 OUTER）三處改成一致的規則，並補一組「破產者／外圈玩家嘗試申購」的測試。

### Major #2 — manual/rulebook.html 把固定金額手續費寫成百分比，跟實際機制與 ADR 不符
- 位置：manual/rulebook.html:275
- 原文：「按下申購的當下就預扣款：申購價 ＋ 處理費（2%）＋ 中籤通知費（5%），…」
- 事實：ipoFee＝0.02、ipoNoticeFee＝0.05 是固定金額（單位千元，即 20 元／50 元），直接加到成本裡（applyAction.js:1246：costS=util.r2(tierDefS.P+feeS+noticeS)），跟申購價 P 的大小完全無關，不是「P 的 2%／5%」。src/data/config/defaultParams.json 對這兩個參數的 desc 寫的是「千元；比照證交所處理費…」，是對的；ADR D4 原文也明講「fee＝ipoFee 0.02、notice＝ipoNoticeFee 0.05（千元；參考證交所：處理費 20 元不退…）」。只有 manual/rulebook.html 這一處把它寫成百分比。
- 為什麼是問題：股王檔申購價 800–2,500 千元，若處理費真是 2%，等於 16–50 千元（1.6–5 萬元），跟實際固定 20 元的落差有兩個數量級。這不是無傷大雅的文字瑕疵——這個功能的五個教育點裡第④點明講「處理費 20 元不退」（見 docs/tickets/T-001-新股抽籤.md 第 13 行），規則書把它寫成百分比正好是教育點要糾正的那種「以為費用跟本金成比例」的誤解，是自我矛盾。已確認 docs/reports/T-001-content-writer-quickstart.md 第 17 行 content-writer 自己也把這兩個值理解成「處理費 2%＋通知費 5%」，代表這不是排版失誤，是對參數單位的誤讀，quickstart.html 本身沒有寫出百分比字樣（用「手續費」帶過）所以沒有踩雷，只有 rulebook.html 這一處把誤解寫進了玩家看得到的文字。
- 建議：把 manual/rulebook.html:275 改成固定金額敘述（例如「處理費（固定小額，不論檔別）＋中籤通知費（沒中籤全額退還）」，或直接寫「處理費 20 元、通知費 50 元」對應遊戲內千元單位），不要用百分比。

---

## 與 QA 報告的交叉比對（不重複做表面驗證，只列差異）

- T-68（IPO_S20 撞關鍵字掃描）：QA 報告記錄時尚未修好；本次審查的 diff（src/ui/uiViews.js:6096-6097，if(dk==="IPO_POOL") return;）已經修好，且有獨立的 docs/reports/T-001-ui-engineer-fix-T68.md／T-001-engine-engineer-fix-T68.md 記錄修法與範圍裁定過程（engine-engineer 正確地發現自己被分派到錯的可改檔案範圍、停下回報，改由 ui-engineer 執行）。此項已解決，不再是問題。
- T-86（EXTEND_GAME 既有失敗）：重新核對本次 diff，applyAction.js 唯一碰到 OFF_TURN_RESPOND 附近的異動只有新增 IPO_SUBSCRIBE:1, IPO_DECLINE:1 這一行，沒有任何一行觸及 EXTEND_GAME／maxTurns／發薪重算邏輯，與 QA 的判斷一致：確認與 T-001 無關的既有技術債，不應卡在這次 release。
- AC5「申購期間淨值不因預扣而下降」字面落差：已重讀帳本邏輯（ledger.recompute，engineCore.js:61-82）與既有先例 E.stockBuyCost／TRADE_STOCK 的手續費過帳方式（applyAction.js:589：手續費同樣只用一筆 CASH 分錄打掉，沒有對應資產墊高），確認 IPO 手續費造成淨值下降 0.07 是跟既有股票交易手續費同一種處理方式，不是本金重複計算的 bug，是設計內行為。同意 QA 的判定：這是驗收條件文字精確度問題，不是程式錯誤，維持「需要製作人裁示文字是否要修正」的待決狀態。
- p.ipoEscrow 唯讀性：獨立重新核對 engineCore.js:61-82（ledger.recompute 完全沒有讀 ipoEscrow）與全域 ipoEscrow 命中點，確認與 QA「交叉核對③」一致：只在申購／結算／退款三處同步寫入，沒有被任何財務判斷讀取。此項確認乾淨，這是整個功能設計最關鍵的一條，通過。
- E.markOffTurnLedger 覆蓋：除了 QA 已確認的 IPO_SUBSCRIBE（applyAction.js:1262）之外，額外檢查了 E.ipoPollNPC／E.settleIpo／E.ipoRefundPlayer 三處是否也需要補這個呼叫——結論是不需要：後三者產生的分錄一律帶 eduTags 含 "ipo-settle"（結算／退款）或屬於 NPC（不進記帳題），而 buildBookkeeping 的 DENY 已把 "ipo-settle" 排除在記帳題之外（applyAction.js:4183），offTurn 旗標對這些分錄本來就不影響是否出題，所以沒有遺漏。S0 提醒的地雷只有這一處，S1 有正確涵蓋，沒有找到第二個遺漏點。
- 測試「陷阱」（p.cash=X; ledger.recompute(p) 無效寫法）：QA 已指出 tests/s45test.js:175/178。本次獨立核對同一支檔案第 175 行（⑤ reject 碼 測項裡驗 IPO_CASH 那一段）確實還在用這個寫法，跟 QA 記錄的行號一致，屬於同一個已知問題，不重複列為新 finding，但附議 QA 的建議：之後有人動這段測試時應該一併清理成 ledger.post 真實過帳的寫法。

## CLAUDE.md 第 3 節七條逐條核對

| # | 原則 | 結果 | 依據 |
|---|---|---|---|
| 1 | 狀態只能透過 action 前進（engine 純函數） | 符合 | IPO_SUBSCRIBE／IPO_DECLINE 都是標準 E.apply case；E.openIpo／E.settleIpo／E.ipoRefundPlayer 都是純函數（只讀寫 S／p，未讀 DOM／時間／網路） |
| 2 | 所有隨機數來自 seeded RNG，不用 Math.random() | 符合 | grep -rn "Math.random" 未命中 IPO 相關程式碼；E.ipoRoll（engineCore.js:152-161）純以 S.seed 與字串 tag 雜湊，不消耗 util.rand／util.randAux，經 s45test.js ②③ 驗證決定論（惟本次未能重跑，見下方「未審查到的部分」） |
| 3 | 複式帳本是唯一真相 | 符合（重點條款） | p.ipoEscrow 獨立驗證未參與 ledger.recompute（engineCore.js:61-82）；所有金額異動（申購／沒中／中籤／破產退款）都經 ledger.post，refId 一致（ipoId+"|"+tier+"|"+pid），沒有繞開帳本直接改 p.cash |
| 4 | 參數資料驅動，不寫死平衡數字 | 符合 | 19 個 IPO 參數全部進 defaultParams.json；E.cfg 新增的第三參數 dflt fallback 機制只用在 ipo 開頭的 key（grep 確認全部 15 處呼叫都是 ipo 前綴），且所有 fallback 值逐一核對與 defaultParams.json 的 value 完全一致，沒有被濫用到 IPO 以外 |
| 5 | 向下相容用 feature flag | 符合 | S.ipo 只在 opts.config.ipoLottery===1 時建立（engineCore.js:217）；舊存檔沒有這個 key 時 S.config.ipoLottery===1 判斷式天然為 false；ns.replay 走 save.config 原樣重放，經 s45test.js ⑨ 驗證逐位元一致（未能重跑，見下方限制） |
| 6 | AI 對手與人類路徑都要測 | 有落差，見 Major #1 | 雙路徑都有實作與測試覆蓋（E.ipoPollNPC vs IPO_SUBSCRIBE），但兩條路徑的業務規則本身不對稱（NPC 排除破產／外圈，真人沒有），這已經不只是「測試覆蓋」問題，是規則設計落差 |
| 7 | 多人同步不得破壞 lockstep | 符合 | E.settleIpo 明確以 Object.keys(ip.subs).map(Number).sort(...) 數字排序遍歷，不依賴物件鍵插入順序；syncAdapter.js 的 tierKeysIp.sort() 明確註記「只影響畫面顯示順序，不進 state」；architect 已審過 E.cfg 簽章擴充合規（本次不重查，依指示） |

## 未審查到的部分（明確說明）

1. 我沒有重新 build／執行完整測試套件。tests/s45test.js／tests/qa-ipo-*.js／npm test 都依賴打包後的 index.html（tracked 檔案），而工作區現有的 index.html 是舊版（grep -c "ipoRoll" index.html 為 0，未包含本次改動）。身為唯讀角色，我沒有執行 npm run build 去重新產生這個 tracked 檔案（會造成工作區異動），因此本次的正確性判斷全部來自靜態讀碼＋人工核算（逐行核對帳本分錄計算、逐一 grep 交叉核對呼叫點），沒有自己重新產生一次可執行的測試證據。這部分依賴 QA 報告（docs/qa/T-001-qa-report.md）與 fix-T68 兩份回報裡已經留下的、由 QA／ui-engineer 各自獨立執行過的 npm test／node tests/s45test.js 輸出作為測試證據來源。
2. iPad Safari 實機、Firebase 真實連線：不在 code-reviewer 職責範圍，QA 報告已列為需要製作人本機驗收的項目，本次未再重覆確認。
3. 平衡數字本身是否合理（docs/balance/T-001-balance.md 的破產率／自由率位移是否可接受）：屬於製作人裁量範圍，本次只確認檔案存在、方法論欄位齊全，未對平衡結論本身做二次判斷。
4. docs/reports/T-001-network-engineer-S5.md「舊版客戶端加入新房時的既有擋法」：ADR 影響欄位標記為 UNKNOWN、待 network-engineer 確認；已讀 syncAdapter.js diff 本身（15 行，純 UI 顯示邏輯），沒有找到版本不符擋法的新增或修改，代表這件事如果真的需要處理，S5 應該是靠既有機制而非本次新增程式碼；未進一步深入 syncAdapter.js 全檔（超出本次 diff 範圍）去驗證既有擋法本身是否足夠，此點維持 UNKNOWN。

## 審查範圍（tracked 檔案，對照 git diff main）

manual/quickstart.html（+2）
manual/rulebook.html（+12）
package.json（+1/-1）
src/data/config/defaultParams.json（+231）
src/data/packs/v10.json（+317）
src/editor/cardEditor.html（+85/-3）
src/engine/core/engineCore.js（+43/-3）
src/engine/reducer/applyAction.js（+206/-2）
src/network/syncAdapter.js（+15）
src/ui/uiCore.js（+147/-1）
src/ui/uiViews.js（+37/-2）
tests/editortest.js（+65）

（src/engine/npc/contentNpcSim.js 分派單允許但實際未改動，已確認 git diff --stat 對此檔無異動，合理——S1 選擇自建 E.ipoRoll 而非重用 npc.stableRoll）
CLAUDE.md 第 4 節「平衡模擬」指令已回填為 npm run test:balance，與 package.json 的 test:balance script 一致，非本次 diff 範圍內（未受版控追蹤的既有專案指令文件），僅核對內容正確性。

## 判定小結

有條件通過：兩項 Major 都不影響核心帳本正確性（最關鍵的 p.ipoEscrow 唯讀性與雙式記帳完整性已驗證乾淨），Major #1 是規則一致性缺口（需要製作人裁示「外圈／破產玩家能否申購」後補一行防呆＋測試），Major #2 是規則書文字錯誤（改文字即可，不動程式）。兩者都可以在不重跑整個 S0–S6 流程的情況下，由對應角色（Major #1 → engine-engineer；Major #2 → content-writer）各自獨立修完後直接進入 release 前的最後確認，不需要回到 architect 或重新設計。

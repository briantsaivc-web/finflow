"""從 ../index.html 抽出「引擎層」與內容包，供 Node 端的無頭測試使用。

只抽前三個 <script> 區塊（util／ledger／engine、applyAction、content/modules/npc/sim）。
第四塊之後是介面層與多人連線層，會碰 DOM，不能在 Node 裡跑——介面要驗請用
tests/ 裡的 Playwright 測試（runtests.js、s17test.js…），那些是開真的瀏覽器。

產物 test_engine.js / test_content.json 已列在 .gitignore，不進版控。

用法（在 repo 根目錄）：python3 tests/extract.py
"""
import re, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'tests')
html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read().split('\n')

opens  = [i + 1 for i, l in enumerate(html) if l.startswith('<script>')]
closes = [i + 1 for i, l in enumerate(html) if l.startswith('</script>')]
blocks = [(o, min(x for x in closes if x > o)) for o in opens][:3]

engine = '\n'.join('\n'.join(html[a:b - 1]) for a, b in blocks)
engine += "\nif(typeof module!=='undefined'){module.exports=ns;}\n"
open(os.path.join(OUT, 'test_engine.js'), 'w', encoding='utf-8').write(engine)

tags = dict(re.findall(r'<script id="([^"]+)" type="application/json">(.*?)</script>',
                       '\n'.join(html), re.S))
open(os.path.join(OUT, 'test_content.json'), 'w', encoding='utf-8').write(json.dumps(tags))

print("引擎區塊：%d 塊 / %d 行　內容包：%d 個" % (len(blocks), engine.count('\n'), len(tags)))

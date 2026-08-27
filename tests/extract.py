import re
html = open('../index.html', encoding='utf-8').read()
# JSON script blocks: <script id="..." type="application/json">...</script>
tags = {}
for m in re.finditer(r'<script id="([^"]+)" type="application/json">(.*?)</script>', html, re.S):
    tags[m.group(1)] = m.group(2)
open('test_content.json','w',encoding='utf-8').write(__import__('json').dumps(tags))
# Code script blocks: <script> ... </script> (no type attr)
code_parts = re.findall(r'<script>(.*?)</script>', html, re.S)
code = "\n".join(code_parts)
open('test_engine.js','w',encoding='utf-8').write(code + "\nif(typeof module!=='undefined'){module.exports=ns;}\n")
print("json tags:", list(tags.keys()))
print("code blocks:", len(code_parts), "chars:", len(code))

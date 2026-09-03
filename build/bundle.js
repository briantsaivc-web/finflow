// build/bundle.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const PACKS_ORDER = [
  { id: 'content-base', file: 'packs/base.json' },
  { id: 'content-mod-m1', file: 'packs/m1.json' },
  { id: 'content-mod-m2', file: 'packs/m2.json' },
  { id: 'content-mod-m3', file: 'packs/m3.json' },
  { id: 'content-mod-m4', file: 'packs/m4.json' },
  { id: 'content-mod-v10', file: 'packs/v10.json' },
  { id: 'content-mod-special', file: 'packs/special.json' },
  { id: 'content-mod-mall', file: 'packs/mall.json' },
  { id: 'content-mod-outer', file: 'packs/outer.json' },
  { id: 'content-mod-m6', file: 'packs/m6.json' },
  { id: 'content-mod-skill', file: 'packs/skill.json' },
  { id: 'config-default', file: 'config/defaultParams.json' }
];

const SCRIPTS_ORDER = [
  'engine/core/engineCore.js',
  'engine/reducer/applyAction.js',
  'engine/npc/contentNpcSim.js',
  'ui/uiCore.js',
  'ui/uiViews.js',
  'ui/tutorial.js',
  'network/syncAdapter.js'
];

function build() {
  console.log('[FinFlow Bundle] Building single-file index.html...');
  const template = fs.readFileSync(path.join(SRC, 'ui/shell_template.html'), 'utf-8');
  const css = fs.readFileSync(path.join(SRC, 'ui/styles.css'), 'utf-8');

  // Build JSON data tags
  let dataTags = '';
  for (const pack of PACKS_ORDER) {
    const raw = fs.readFileSync(path.join(SRC, 'data', pack.file), 'utf-8');
    const minified = JSON.stringify(JSON.parse(raw));
    dataTags += `<script id="${pack.id}" type="application/json">${minified}</script>\n`;
  }

  // Build Scripts
  let scriptTags = '';
  for (const scriptPath of SCRIPTS_ORDER) {
    const scriptCode = fs.readFileSync(path.join(SRC, scriptPath), 'utf-8');
    scriptTags += `<script>\n${scriptCode}\n</script>\n`;
  }

  let output = template;
  output = output.replace('<!-- STYLE_PLACEHOLDER -->', `<style>\n${css}\n</style>`);
  output = output.replace('<!-- DATA_PLACEHOLDER -->', dataTags);
  output = output.replace('<!-- SCRIPT_PLACEHOLDER -->', scriptTags);

  const outDist = path.join(ROOT, 'dist');
  if (!fs.existsSync(outDist)) fs.mkdirSync(outDist, { recursive: true });

  fs.writeFileSync(path.join(outDist, 'index.html'), output, 'utf-8');
  fs.writeFileSync(path.join(ROOT, 'index.html'), output, 'utf-8');

  console.log('[FinFlow Bundle] Build successful! Written to index.html and dist/index.html');

  /* S24：夢想里程碑的配圖是【外部檔案】（換圖＝同檔名覆蓋，不必重新打包），
     所以 dist/ 也要有一份，否則從 dist 部署時圖會 404。
     圖載不到時介面會退回純文字，所以這一步失敗不致命——印個提醒就好。 */
  try {
    const assetsSrc = path.join(ROOT, 'assets');
    if (fs.existsSync(assetsSrc)) {
      fs.cpSync(assetsSrc, path.join(outDist, 'assets'), { recursive: true });
      // 圖是分資料夾放的（assets/dreams/dream_peaks/01.webp），要遞迴數
      const countImg = (dir) => fs.readdirSync(dir, { withFileTypes: true })
        .reduce((n, e) => n + (e.isDirectory() ? countImg(path.join(dir, e.name))
                                               : (/\.(webp|png|jpe?g)$/i.test(e.name) ? 1 : 0)), 0);
      const dreamDir = path.join(assetsSrc, 'dreams');
      const nImg = fs.existsSync(dreamDir) ? countImg(dreamDir) : 0;
      console.log(`[FinFlow Bundle] assets/ copied to dist/ (${nImg} dream images)`);
    }
  } catch (e) {
    console.log('[FinFlow Bundle] WARN: assets/ 沒有複製到 dist/（圖會退回純文字）：' + e.message);
  }

  // S22：卡片工坊也從同一份 src/data 打包——原本 card_editor.html 內嵌一份卡包快照，
  // 改了 src/data 之後兩邊會漂移（S21c 之後 base/m4/special 就已經不一致）。
  const editorTpl = fs.readFileSync(path.join(SRC, 'editor/cardEditor.html'), 'utf-8');
  const packsObj = {};
  for (const pack of PACKS_ORDER) {
    if (pack.id === 'config-default') continue;
    const key = path.basename(pack.file, '.json');
    packsObj[key] = JSON.parse(fs.readFileSync(path.join(SRC, 'data', pack.file), 'utf-8'));
  }
  const marker = 'let PACKS = /* PACKS_PLACEHOLDER */ {};';
  if (editorTpl.indexOf(marker) < 0) throw new Error('cardEditor.html 缺少 PACKS_PLACEHOLDER');
  const editorOut = editorTpl.replace(marker, 'let PACKS = ' + JSON.stringify(packsObj) + ';');
  fs.writeFileSync(path.join(ROOT, 'card_editor.html'), editorOut, 'utf-8');
  console.log('[FinFlow Bundle] card_editor.html rebuilt from src/data (' + Object.keys(packsObj).length + ' packs)');
}

build();

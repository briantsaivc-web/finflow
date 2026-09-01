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
}

build();

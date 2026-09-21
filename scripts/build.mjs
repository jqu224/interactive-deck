/* build.mjs — 把 decks/*.json 编译成 dist/<slug>/index.html（自包含单文件站点）
 * 用法：node scripts/build.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const css = read('src/flowdeck.css');
const js = read('src/flowdeck.js');
const decksDir = path.join(root, 'decks');
const outRoot = path.join(root, 'dist');

const files = fs.readdirSync(decksDir).filter((f) => f.endsWith('.json')).sort();
if (!files.length) {
  console.error('decks/ 下没有找到任何 .json 规格');
  process.exit(1);
}

const decks = files.map((f) => {
  const abs = path.join(decksDir, f);
  const spec = JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (!spec.id) throw new Error(f + ' 缺少 id');
  if (!Array.isArray(spec.nodes) || !spec.nodes.length) throw new Error(f + ' 缺少 nodes');
  return { slug: String(spec.id).replace(/[^a-zA-Z0-9-_]/g, '-'), spec, file: f };
});

const seen = new Set();
for (const d of decks) {
  if (seen.has(d.slug)) throw new Error('重复的 deck id: ' + d.slug);
  seen.add(d.slug);
}

function page(spec) {
  const json = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${spec.title || spec.id}</title>
<meta name="description" content="${(spec.subtitle || '').replace(/"/g, '&quot;')}">
<meta name="generator" content="flowdeck">
<style data-flowdeck>${css}</style>
</head>
<body>
<script>window.__DECK__=${json};<\/script>
<script data-flowdeck>${js}<\/script>
</body>
</html>
`;
}

function hub() {
  const cards = decks.map((d) => {
    const n = d.spec.nodes.length;
    const polls = d.spec.nodes.filter((x) => x.poll).length;
    return `    <a class="card" href="./${d.slug}/index.html">
      <h3>${d.spec.title || d.slug}</h3>
      <p>${d.spec.subtitle || ''}</p>
      <span class="meta">${n} 个节点 · ${polls} 处投票 · ${d.slug}</span>
    </a>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flow Deck 站点集</title>
<style>
:root{--ink:#1b1b20;--muted:#6b6b76;--line:#e6e4dd;--paper:#fffdf8;--accent:#5b6cff}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f5f3ed;color:var(--ink);font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Roboto,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:72px 24px 96px}
h1{font-size:34px;font-weight:500;letter-spacing:-.01em;margin:0 0 8px}
.lead{color:var(--muted);margin:0 0 40px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{display:block;padding:22px 24px;border:1px solid var(--line);border-radius:18px;background:var(--paper);text-decoration:none;color:inherit;transition:transform .3s cubic-bezier(.22,1.28,.36,1),box-shadow .3s ease,border-color .3s ease}
.card:hover{transform:translateY(-4px);box-shadow:0 18px 44px rgba(28,28,40,.14);border-color:#cfcbc0}
.card h3{margin:0 0 6px;font-size:19px;font-weight:500}
.card p{margin:0 0 14px;color:var(--muted);font-size:14px}
.meta{font-size:12px;color:var(--accent)}
</style>
</head>
<body>
<div class="wrap">
<h1>Flow Deck</h1>
<p class="lead">一份规格生成一个站点。点进去用「下一个」沿着流程走。</p>
<div class="grid">
${cards}
</div>
</div>
</body>
</html>
`;
}

fs.rmSync(outRoot, { recursive: true, force: true });
for (const d of decks) {
  const dir = path.join(outRoot, d.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(d.spec));
  const kb = (fs.statSync(path.join(dir, 'index.html')).size / 1024).toFixed(1);
  console.log(`built  dist/${d.slug}/index.html  ${kb} KB  (${d.spec.nodes.length} nodes)`);
}
fs.writeFileSync(path.join(outRoot, 'index.html'), hub());
console.log(`built  dist/index.html  入口页，共 ${decks.length} 个站点`);
console.log('\n本地预览：npx --yes serve dist -l 5173');

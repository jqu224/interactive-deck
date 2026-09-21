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
<title>Interactive Deck · 站点集</title>
<style>
:root{--ink:#1b1b20;--muted:#6b6b76;--line:#e6e4dd;--paper:#fffdf8;--accent:#5b6cff;--mint:#17b978;--coral:#ff6b4a;--amber:#e39b16}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;background:#f5f3ed;color:var(--ink);font:15px/1.7 -apple-system,BlinkMacSystemFont,"PingFang SC","Segoe UI",Roboto,sans-serif}
.wrap{max-width:1060px;margin:0 auto;padding:64px 24px 96px}
h1{font-size:40px;font-weight:500;letter-spacing:-.01em;margin:0 0 8px}
.lead{color:var(--muted);margin:0 0 34px}
.hero-strip{margin:0 0 14px}
#hero-svg{display:block;width:100%;height:auto;font-family:inherit}
#hero-svg .pshadow{fill:var(--ink);opacity:.07}
#hero-svg .pbox{fill:var(--paper);stroke:var(--ink);stroke-width:2.5;transition:transform .35s cubic-bezier(.22,1.28,.36,1),stroke .3s ease}
#hero-svg .panel{cursor:pointer;outline:none}
#hero-svg .panel:hover .pbox,#hero-svg .panel:focus-visible .pbox{transform:translateY(-4px)}
#hero-svg .panel.active .pbox{stroke:var(--accent);stroke-width:3}
#hero-svg text{user-select:none}
#hero-svg .plate rect{fill:#f5f3ed;stroke:var(--ink);stroke-width:1.5;transition:fill .3s ease,stroke .3s ease}
#hero-svg .plate text{fill:var(--ink);font-size:13px;transition:fill .3s ease}
#hero-svg .panel.active .plate rect{fill:var(--accent);stroke:var(--accent)}
#hero-svg .panel.active .plate text{fill:#fff}
#hero-svg .cam{fill:rgba(91,108,255,.05);stroke:var(--accent);stroke-width:2.5;stroke-dasharray:9 7;transition:transform .85s cubic-bezier(.22,1,.36,1);pointer-events:none}
#hero-svg .cf{animation:none}
#hero-svg .panel.active .cf{animation:cfpop 1.5s ease-in-out infinite}
@keyframes cfpop{0%,100%{transform:translateY(0) rotate(0deg)}50%{transform:translateY(-7px) rotate(16deg)}}
.hero-caption{display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--paper);border:2px solid var(--ink);border-radius:12px;padding:10px 16px;transform:rotate(-.35deg);box-shadow:4px 5px 0 rgba(27,27,32,.12);margin:0 0 44px}
#hero-cap{font-size:14px}
.cap-right{display:flex;align-items:center;gap:14px;flex-shrink:0}
.tip{font-size:12px;color:var(--muted)}
#hero-dots{display:inline-flex;gap:7px}
#hero-dots i{width:9px;height:9px;border-radius:50%;border:1.5px solid var(--ink);background:transparent;transition:background .3s ease,border-color .3s ease}
#hero-dots i.on{background:var(--accent);border-color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{display:block;padding:22px 24px;border:1px solid var(--line);border-radius:18px;background:var(--paper);text-decoration:none;color:inherit;transition:transform .3s cubic-bezier(.22,1.28,.36,1),box-shadow .3s ease,border-color .3s ease}
.card:hover{transform:translateY(-4px);box-shadow:0 18px 44px rgba(28,28,40,.14);border-color:#cfcbc0}
.card h3{margin:0 0 6px;font-size:19px;font-weight:500}
.card p{margin:0 0 14px;color:var(--muted);font-size:14px}
.meta{font-size:12px;color:var(--accent)}
@media(max-width:720px){.hero-strip{overflow-x:auto;-webkit-overflow-scrolling:touch;margin:0 -24px 14px;padding:0 24px}#hero-svg{min-width:760px}.hero-caption{transform:none;flex-wrap:wrap}.tip{display:none}}
@media(prefers-reduced-motion:reduce){#hero-svg .cam,#hero-svg .pbox{transition:none!important}#hero-svg .panel.active .cf{animation:none!important}}
</style>
</head>
<body>
<div class="wrap">
<h1>Interactive Deck</h1>
<p class="lead">一份规格生成一个互动站点 —— 沿着流程走，边走边投。点卡片进入。</p>
<div class="hero-strip">
<svg id="hero-svg" viewBox="0 0 1080 240" role="group" aria-label="连环画：一份互动 deck 的四格故事">
  <defs>
    <pattern id="ht" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.4" fill="#1b1b20" opacity=".08"/></pattern>
  </defs>
  <g class="panel" data-caption="第 1 格 · 一份 JSON 规格，故事开场" tabindex="0" role="button" aria-label="第 1 格：开场">
    <rect class="pshadow" x="13" y="17" width="238" height="210" rx="12"/>
    <rect class="pbox" x="8" y="10" width="238" height="210" rx="12"/>
    <rect x="22" y="22" width="54" height="7" rx="3.5" fill="var(--mint)" transform="rotate(-2 49 25)"/>
    <ellipse cx="127" cy="163" rx="54" ry="9" fill="url(#ht)"/>
    <g stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round">
      <line x1="127" y1="46" x2="127" y2="33"/>
      <line x1="86" y1="63" x2="77" y2="54"/>
      <line x1="168" y1="63" x2="177" y2="54"/>
      <line x1="82" y1="122" x2="70" y2="126"/>
      <line x1="172" y1="122" x2="184" y2="126"/>
    </g>
    <circle cx="127" cy="103" r="40" fill="#fff" stroke="var(--ink)" stroke-width="2.5"/>
    <path d="M116 85 L154 103 L116 121 Z" fill="var(--accent)" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round"/>
    <g class="plate"><rect x="28" y="182" width="198" height="28" rx="8"/><text x="127" y="201" text-anchor="middle">第 1 格 · 开场</text></g>
  </g>
  <g class="panel" data-caption="第 2 格 · 故事在这里分叉，路线让观众选" tabindex="0" role="button" aria-label="第 2 格：分叉">
    <rect class="pshadow" x="287" y="17" width="238" height="210" rx="12"/>
    <rect class="pbox" x="282" y="10" width="238" height="210" rx="12"/>
    <rect x="296" y="22" width="54" height="7" rx="3.5" fill="var(--amber)" transform="rotate(-2 323 25)"/>
    <ellipse cx="401" cy="167" rx="56" ry="9" fill="url(#ht)"/>
    <path d="M447 104 C470 104 464 72 486 70" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-dasharray="4 4"/>
    <path d="M447 104 C470 104 464 136 486 138" fill="none" stroke="var(--ink)" stroke-width="1.8" stroke-dasharray="4 4"/>
    <circle cx="497" cy="68" r="12" fill="var(--amber)" stroke="var(--ink)" stroke-width="1.5"/>
    <text x="497" y="72.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">A</text>
    <circle cx="497" cy="140" r="12" fill="var(--accent)" stroke="var(--ink)" stroke-width="1.5"/>
    <text x="497" y="144.5" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">B</text>
    <path d="M401 56 L449 104 L401 152 L353 104 Z" fill="#fff" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>
    <text x="401" y="114" text-anchor="middle" font-size="28" font-weight="700" fill="var(--amber)">?</text>
    <g class="plate"><rect x="302" y="182" width="198" height="28" rx="8"/><text x="401" y="201" text-anchor="middle">第 2 格 · 分叉</text></g>
  </g>
  <g class="panel" data-caption="第 3 格 · 举手投票，比例条当场合出来" tabindex="0" role="button" aria-label="第 3 格：投票">
    <rect class="pshadow" x="561" y="17" width="238" height="210" rx="12"/>
    <rect class="pbox" x="556" y="10" width="238" height="210" rx="12"/>
    <rect x="570" y="22" width="54" height="7" rx="3.5" fill="var(--coral)" transform="rotate(-2 597 25)"/>
    <polygon points="628,80 618,98 648,80" fill="#fff" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>
    <rect x="596" y="44" width="150" height="40" rx="10" fill="#fff" stroke="var(--ink)" stroke-width="2"/>
    <text x="671" y="69" text-anchor="middle" font-size="13" fill="var(--ink)">你选哪个？</text>
    <circle cx="755" cy="52" r="11" fill="var(--coral)"/>
    <path d="M749 52 L753.5 57 L761.5 47.5" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="616" y="134" width="26" height="44" fill="var(--line)"/>
    <rect x="656" y="106" width="26" height="72" fill="var(--amber)"/>
    <rect x="696" y="82" width="26" height="96" fill="var(--accent)"/>
    <text x="709" y="100" text-anchor="middle" font-size="11.5" font-weight="700" fill="#fff">78%</text>
    <line x1="604" y1="178" x2="746" y2="178" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
    <g class="plate"><rect x="576" y="182" width="198" height="28" rx="8"/><text x="675" y="201" text-anchor="middle">第 3 格 · 投票</text></g>
  </g>
  <g class="panel" data-caption="第 4 格 · 导出单文件，「完」—— 也能再来一遍" tabindex="0" role="button" aria-label="第 4 格：谢幕">
    <rect class="pshadow" x="835" y="17" width="238" height="210" rx="12"/>
    <rect class="pbox" x="830" y="10" width="238" height="210" rx="12"/>
    <rect x="844" y="22" width="54" height="7" rx="3.5" fill="var(--coral)" transform="rotate(-2 871 25)"/>
    <ellipse cx="949" cy="163" rx="60" ry="9" fill="url(#ht)"/>
    <g transform="translate(878,58) rotate(18)"><rect class="cf" x="-4" y="-7" width="8" height="14" rx="2" fill="var(--accent)"/></g>
    <g transform="translate(925,42) rotate(-14)"><circle class="cf" r="4.5" fill="var(--amber)"/></g>
    <g transform="translate(992,55) rotate(30)"><rect class="cf" x="-4" y="-7" width="8" height="14" rx="2" fill="var(--mint)"/></g>
    <g transform="translate(1032,96) rotate(-24)"><rect class="cf" x="-4" y="-7" width="8" height="14" rx="2" fill="var(--coral)"/></g>
    <g transform="translate(866,118) rotate(-30)"><circle class="cf" r="4" fill="var(--coral)"/></g>
    <g transform="translate(1016,138) rotate(12)"><rect class="cf" x="-4" y="-7" width="8" height="14" rx="2" fill="var(--amber)"/></g>
    <g transform="translate(952,176) rotate(-8)"><rect class="cf" x="-4" y="-7" width="8" height="14" rx="2" fill="var(--accent)"/></g>
    <g transform="translate(898,158) rotate(24)"><circle class="cf" r="4" fill="var(--mint)"/></g>
    <text x="949" y="122" text-anchor="middle" font-size="54" font-weight="600" fill="var(--ink)" transform="rotate(-2 949 105)" style="font-family:'Songti SC','STSong','SimSun',serif">完</text>
    <g class="plate"><rect x="850" y="182" width="198" height="28" rx="8"/><text x="949" y="201" text-anchor="middle">第 4 格 · 谢幕</text></g>
  </g>
  <path d="M251 114 C259 106 263 122 275 115" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M268 107 L277 114 L266 121" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M525 114 C533 106 537 122 549 115" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M542 107 L551 114 L540 121" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M799 114 C807 106 811 122 823 115" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M816 107 L825 114 L814 121" fill="none" stroke="var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  <rect id="hero-cam" class="cam" x="2" y="4" width="250" height="222" rx="16"/>
</svg>
</div>
<div class="hero-caption">
  <span id="hero-cap">第 1 格 · 一份 JSON 规格，故事开场</span>
  <span class="cap-right">
    <span class="tip">hover / 点击画格试试</span>
    <span id="hero-dots"><i class="on"></i><i></i><i></i><i></i></span>
  </span>
</div>
<div class="grid">
${cards}
</div>
</div>
<script>
(function(){
  var svg=document.getElementById('hero-svg');
  if(!svg)return;
  var panels=[].slice.call(svg.querySelectorAll('.panel'));
  var cam=document.getElementById('hero-cam');
  var cap=document.getElementById('hero-cap');
  var dots=[].slice.call(document.querySelectorAll('#hero-dots i'));
  var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var cur=0,timer=null;
  function go(i,user){
    cur=((i%panels.length)+panels.length)%panels.length;
    panels.forEach(function(p,k){
      p.classList.toggle('active',k===cur);
      p.setAttribute('tabindex',k===cur?'0':'-1');
    });
    cam.style.transform='translate('+(274*cur)+'px, 0)';
    cap.textContent=panels[cur].getAttribute('data-caption');
    dots.forEach(function(d,k){d.className=k===cur?'on':'';});
    if(user){clearInterval(timer);timer=auto();}
  }
  function auto(){
    if(reduced)return null;
    return setInterval(function(){if(!document.hidden)go(cur+1);},2600);
  }
  panels.forEach(function(p,i){
    p.addEventListener('mouseenter',function(){clearInterval(timer);go(i);});
    p.addEventListener('focus',function(){clearInterval(timer);go(i);});
    p.addEventListener('click',function(){go(i,true);});
    p.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();go(i,true);}
    });
  });
  svg.addEventListener('mouseleave',function(){clearInterval(timer);timer=auto();});
  go(0);timer=auto();
})();
</script>
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

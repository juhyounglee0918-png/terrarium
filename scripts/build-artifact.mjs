// Bundles the built app (dist/) into one self-contained HTML body for the Artifact viewer.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const assets = readdirSync('dist/assets');
const js = assets.find((f) => f.startsWith('index-') && f.endsWith('.js'));
const css = assets.find((f) => f.endsWith('.css'));
const script = readFileSync(`dist/assets/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script');
const style = css ? readFileSync(`dist/assets/${css}`, 'utf8') : '';
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const out = `<title>테라리움 생태계</title>
<style>${style}</style>
${body.trim()}
<script type="module">${script}</script>
`;
mkdirSync('artifact', { recursive: true });
writeFileSync('artifact/index.html', out);
console.log(`artifact/index.html ${(out.length / 1024).toFixed(0)} KB`);

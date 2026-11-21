import fs from 'node:fs';
import path from 'node:path';
const out = process.argv[2];
const html = fs.readFileSync('dist/index.html', 'utf8');
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) => fs.readFileSync(path.join('dist', m[1]), 'utf8'));
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) => fs.readFileSync(path.join('dist', m[1]), 'utf8'));
if (js.some((s) => s.includes('</script'))) throw new Error('bundle contains </script');
const head = html.slice(html.indexOf('<head>') + 6, html.indexOf('</head>'))
  .replace(/<meta charset[^>]*>/, '').replace(/<meta name="viewport"[^>]*>/, '')
  .replace(/<script src="https:\/\/telegram\.org[^>]*><\/script>/, '')
  .replace(/<link rel="(icon|apple-touch-icon)"[^>]*>/g, '')
  .replace(/<link rel="stylesheet"[^>]*>/g, '').replace(/<script type="module"[^>]*><\/script>/g, '')
  .replace(/<link rel="modulepreload"[^>]*>/g, '');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).replace(/<script type="module"[^>]*><\/script>/g, '');
const page = `${head.trim()}\n<style>${css.join('\n')}</style>\n${body.trim()}\n<script type="module">${js.join('\n')}</script>\n`;
fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(0) + ' KB');

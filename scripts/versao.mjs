// Atualiza a versão em todos os lugares de uma vez:
//   index.html (?v=N em app.js/style.css), app.js e js/*.js (imports ?v=N), sw.js (VERSION = N)
//
//   node scripts/versao.mjs          → incrementa (N+1)
//   node scripts/versao.mjs 42       → define N=42 (usado pelo deploy automático)
//   node scripts/versao.mjs --check  → só confere se está tudo igual (usado nos testes)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const arquivos = ['index.html', 'app.js', 'sw.js', ...readdirSync(join(raiz, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)];

const RE_V  = /(\.(?:js|css)\?v=)(\d+)/g;
const RE_SW = /(const VERSION = )(\d+)(;)/;

export function versoesEncontradas() {
  const achadas = {};
  for (const f of arquivos) {
    const txt = readFileSync(join(raiz, f), 'utf8');
    const vs = [...txt.matchAll(RE_V)].map(m => +m[2]);
    const sw = txt.match(RE_SW);
    if (sw) vs.push(+sw[2]);
    if (vs.length) achadas[f] = [...new Set(vs)];
  }
  return achadas;
}

function definir(n) {
  for (const f of arquivos) {
    const p = join(raiz, f);
    const txt = readFileSync(p, 'utf8');
    const novo = txt.replace(RE_V, `$1${n}`).replace(RE_SW, `$1${n}$3`);
    if (novo !== txt) writeFileSync(p, novo);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  const todas = Object.values(versoesEncontradas()).flat();
  if (arg === '--check') {
    const unicas = [...new Set(todas)];
    if (unicas.length !== 1) { console.error('Versões diferentes:', versoesEncontradas()); process.exit(1); }
    console.log('Versão', unicas[0], 'em todos os arquivos.');
  } else {
    const n = arg ? parseInt(arg, 10) : Math.max(...todas) + 1;
    if (!(n > 0)) { console.error('Versão inválida:', arg); process.exit(1); }
    definir(n);
    console.log('Versão definida:', n);
  }
}

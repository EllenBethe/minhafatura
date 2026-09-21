// Protege contra a classe de bug que já aconteceu duas vezes (renomear
// categoria, filtro/busca): o HTML chamando uma função que o módulo não expõe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { versoesEncontradas } from '../scripts/versao.mjs';

const ler = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = ler('index.html');
const app = ler('app.js');
const modulos = readdirSync(new URL('../js/', import.meta.url)).map(f => ler('js/' + f));

// Nomes definidos em `const ACOES = { ... };` (métodos, async ou não)
function nomesDasAcoes() {
  const ini = app.indexOf('const ACOES = {');
  assert.ok(ini >= 0, 'app.js precisa definir const ACOES');
  const bloco = app.slice(ini, app.indexOf('\n};', ini));
  return new Set([...bloco.matchAll(/^\s{2}(?:async\s+)?([a-zA-Z]\w*)\s*\(/gm)].map(m => m[1]));
}

test('nenhum onclick/onchange/oninput inline (use data-action/data-change/data-input)', () => {
  for (const [nome, txt] of [['index.html', html], ['app.js', app], ...modulos.map((t, i) => ['js #' + i, t])]) {
    assert.doesNotMatch(txt, /\son(click|change|input|submit|keyup|keydown)\s*=/i, nome);
  }
});

test('todo data-action/change/input aponta para uma função existente em ACOES', () => {
  const acoes = nomesDasAcoes();
  const usados = new Set();
  for (const txt of [html, app, ...modulos]) {
    for (const m of txt.matchAll(/data-(?:action|change|input)="([a-zA-Z]\w*)"/g)) usados.add(m[1]);
  }
  assert.ok(usados.size > 20, 'esperava encontrar os usos');
  const faltando = [...usados].filter(n => !acoes.has(n));
  assert.deepEqual(faltando, [], 'ações usadas mas não definidas em ACOES');
});

test('todo id usado em $("...") existe no index.html', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const usados = new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]));
  const faltando = [...usados].filter(id => !ids.has(id));
  assert.deepEqual(faltando, [], 'ids usados no app.js mas ausentes do HTML');
});

test('versão (?v=N e VERSION) é a mesma em todos os arquivos', () => {
  const todas = new Set(Object.values(versoesEncontradas()).flat());
  assert.equal(todas.size, 1, JSON.stringify(versoesEncontradas()));
});

test('service worker pré-carrega todos os módulos js/', () => {
  const sw = ler('sw.js');
  for (const f of readdirSync(new URL('../js/', import.meta.url))) {
    assert.ok(sw.includes(`'./js/${f}?v='`), `sw.js não inclui js/${f}`);
  }
});

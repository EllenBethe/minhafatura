// Testes de tela: abrem o app num Chrome de verdade (sem janela), com o Firebase
// simulado, e usam como uma pessoa usaria. Rodar: npm run e2e
// Precisa do Google Chrome instalado (ou CHROME_PATH apontando para ele).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';
import { iniciarServidor } from './servidor.mjs';

const CHROME = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => p && existsSync(p));

// ---------- dados de exemplo (datas relativas a hoje) ----------
const pad = n => String(n).padStart(2, '0');
const dia = diasAtras => { const d = new Date(); d.setDate(d.getDate() - diasAtras); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
// fechamento 1: tudo do mês corrente cai na fatura do mês seguinte (a aberta)
const hoje = new Date().getDate();
const noMes = n => dia(Math.min(n, hoje - 1));   // dia deste mês, antes de hoje
const SEED = {
  config: {
    fechamento: 1,
    categorias: [{ name: 'Supermercado', orcamento: 100 }, { name: 'Gasolina' }, { name: 'Compras' }, { name: 'Outros' }],
    regras: [],
  },
  compras: [
    { id: 'c1', desc: 'Giassi Supermercados', cat: 'Supermercado', data: noMes(1), parcelas: 1, valorParcela: 150 },
    { id: 'c2', desc: 'Posto Shell', cat: 'Gasolina', data: noMes(2), parcelas: 1, valorParcela: 200 },
    { id: 'c3', desc: 'Shopee *Loja', cat: 'Outros', data: noMes(3), parcelas: 1, valorParcela: 50 },
    { id: 'c4', desc: 'Notebook', cat: 'Compras', data: dia(70), parcelas: 10, valorParcela: 300 },
    ...Array.from({ length: 12 }, (_, i) => ({ id: 'x' + i, desc: 'Padaria ' + i, cat: 'Outros', data: noMes(1), parcelas: 1, valorParcela: 10 })),
  ],
};

let navegador, servidor;
before(async () => {
  if (!CHROME) return;
  servidor = await iniciarServidor();
  navegador = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});
after(async () => { await navegador?.close(); servidor?.fechar(); });

// Abre o app com os dados indicados; falha o teste se houver erro de JavaScript na página
async function abrir(t, seed = SEED, { largura = 400, altura = 800 } = {}) {
  if (!CHROME) { t.skip('Google Chrome não encontrado (defina CHROME_PATH)'); return null; }
  const page = await navegador.newPage();
  await page.setViewport({ width: largura, height: altura, isMobile: true, hasTouch: true });
  const erros = [];
  page.on('pageerror', e => erros.push(e.message));
  page.on('console', m => { if (m.type() === 'error') erros.push(m.text()); });
  page.on('dialog', d => d.accept());
  await page.evaluateOnNewDocument(s => { globalThis.__SEED = s; }, seed);
  await page.goto(servidor.url + '/', { waitUntil: 'domcontentloaded' });
  t.after(async () => { assert.deepEqual(erros.filter(e => !/fonts\.g/.test(e)), [], 'erros na página'); await page.close(); });
  if (seed.logado !== false) await page.waitForSelector('#scr-home.active .compra-card');
  return page;
}
const clicar = (page, acao) => page.click(`[data-action="${acao}"]`);
const texto = (page, sel) => page.$eval(sel, el => el.textContent.trim());
const estado = page => page.evaluate(() => globalThis.__E2E.estado());
const esperar = ms => new Promise(r => setTimeout(r, ms));

test('abre na fatura aberta com compras, total e aviso de orçamento', async t => {
  const page = await abrir(t); if (!page) return;
  // 150 + 200 + 50 + 12×10 + parcela do notebook (se cair nesta fatura)
  const total = await texto(page, '#fat-total');
  assert.match(total, /^R\$ /);
  assert.ok((await page.$$('.compra-card')).length >= 15);
  assert.match(await texto(page, '#cat-resumo'), /acima do orçamento/);   // Supermercado 150 > 100
});

test('navega por todas as telas sem erro', async t => {
  const page = await abrir(t); if (!page) return;
  for (const [acao, tela] of [['goGraf', 'scr-graf'], ['goSett', 'scr-sett'], ['goImport', 'scr-import'], ['goAdd', 'scr-form'], ['goHome', 'scr-home']]) {
    await page.evaluate(a => document.querySelector(`[data-action="${a}"]`).click(), acao);
    await page.waitForSelector(`#${tela}.active`);
  }
});

test('digitar na busca não faz a tela subir e descer', async t => {
  const page = await abrir(t, SEED, { altura: 600 }); if (!page) return;
  await page.evaluate(() => { document.getElementById('scr-home').scrollTop = 350; });
  const antes = await page.evaluate(() => document.getElementById('scr-home').scrollTop);
  await page.focus('#search');
  for (const letra of 'pad') {
    await page.keyboard.type(letra);
    await esperar(120);
    const agora = await page.evaluate(() => document.getElementById('scr-home').scrollTop);
    assert.ok(Math.abs(agora - antes) <= 30, `rolagem pulou de ${antes} para ${agora}`);
  }
  assert.equal((await page.$$('.compra-card')).length, 12);   // só as padarias
});

test('filtro por categoria no seletor', async t => {
  const page = await abrir(t); if (!page) return;
  await page.select('#fil-cat', 'Gasolina');
  await page.waitForFunction(() => document.querySelectorAll('.compra-card').length === 1);
  assert.match(await texto(page, '#sec-title'), /gasolina/i);
});

test('lançar compra à mão: categoria sugerida pelo nome e aparece na lista', async t => {
  const page = await abrir(t); if (!page) return;
  await clicar(page, 'goAdd');
  await page.type('#f-desc', 'Posto Ipiranga');
  assert.equal(await page.$eval('#f-cat', el => el.value), 'Gasolina');
  await page.type('#f-val', '80');
  await clicar(page, 'saveCompra');
  await page.waitForSelector('#scr-home.active');
  await page.waitForFunction(() => [...document.querySelectorAll('.cc-nome')].some(e => e.textContent === 'Posto Ipiranga'));
  const c = (await estado(page)).compras.find(x => x.desc === 'Posto Ipiranga');
  assert.equal(c.cat, 'Gasolina');
  assert.equal(c.valorParcela, 80);
});

test('estorno entra negativo e abate a fatura', async t => {
  const page = await abrir(t); if (!page) return;
  const antes = await texto(page, '#fat-total');
  await clicar(page, 'goAdd');
  await page.type('#f-desc', 'Estorno Shopee');
  await page.type('#f-val', '20');
  await page.click('#f-estorno');
  await clicar(page, 'saveCompra');
  await page.waitForFunction(a => document.getElementById('fat-total').textContent !== a, {}, antes);
  const c = (await estado(page)).compras.find(x => x.desc === 'Estorno Shopee');
  assert.equal(c.valorParcela, -20);
});

test('troca rápida de categoria pelo ícone, criando regra', async t => {
  const page = await abrir(t); if (!page) return;
  await page.click('[data-action="trocarCatRapido"][data-id="c3"]');
  await page.waitForSelector('#cat-picker', { visible: true });
  assert.equal(await texto(page, '#cp-regra-txt'), 'shopee');
  await page.click('#cp-regra');
  await page.click('[data-action="escolherCatRapida"][data-cat="Compras"]');
  await page.waitForFunction(() => globalThis.__E2E.estado().compras.find(c => c.id === 'c3').cat === 'Compras');
  assert.deepEqual((await estado(page)).config.regras, [{ contem: 'shopee', cat: 'Compras' }]);
});

test('importar CSV do Nubank, criar regra na prévia e desfazer a importação', async t => {
  const page = await abrir(t); if (!page) return;
  const dir = mkdtempSync(join(tmpdir(), 'mf-e2e-'));
  const csv = join(dir, 'Nubank_teste.csv');
  writeFileSync(csv, ['date,title,amount',
    `${noMes(1)},Petz Digital,"89,90"`,
    `${noMes(1)},Petz Digital,"15,50"`,   // valor diferente das padarias (R$ 10) para não parecer já lançada
    `${noMes(2)},Carrefour,"120,00"`,
    `${noMes(2)},Pagamento recebido,"- 500,00"`,
    `${noMes(3)},Estorno Carrefour,"- 20,00"`].join('\n'));

  await clicar(page, 'goSett');
  await clicar(page, 'goImport');
  const input = await page.$('#imp-arquivo');
  await input.uploadFile(csv);
  await page.waitForSelector('.imp-item');
  assert.equal((await page.$$('.imp-item')).length, 4);            // pagamento fica de fora
  assert.match(await texto(page, '#imp-resumo'), /1 pagamento/);

  // troca a categoria da 1ª Petz → aparece o convite → cria a regra → a 2ª Petz acompanha
  await page.select('.imp-item:nth-child(1) .imp-cat', 'Compras');
  await page.waitForSelector('[data-action="impCriarRegra"]');
  await clicar(page, 'impCriarRegra');
  await page.waitForSelector('.imp-regra.ok');
  assert.equal(await page.$eval('.imp-item:nth-child(2) .imp-cat', el => el.value), 'Compras');

  await clicar(page, 'importConfirmar');
  await page.waitForSelector('#scr-home.active');
  let st = await estado(page);
  const importadas = st.compras.filter(c => c.origem === 'importacao');
  assert.equal(importadas.length, 4);
  assert.ok(importadas.every(c => c.importId && c.importArquivo === 'Nubank_teste.csv'));
  assert.equal(importadas.find(c => c.desc === 'Carrefour').cat, 'Supermercado');   // palavra-chave (rede de supermercado)
  assert.equal(importadas.find(c => c.desc === 'Estorno Carrefour').valorParcela, -20);
  assert.deepEqual(st.config.regras, [{ contem: 'petz digital', cat: 'Compras' }]);

  // desfazer
  await clicar(page, 'goSett');
  await page.waitForSelector('[data-action="desfazerImport"]');
  await clicar(page, 'desfazerImport');
  await page.waitForFunction(() => !globalThis.__E2E.estado().compras.some(c => c.origem === 'importacao'));
  st = await estado(page);
  assert.equal(st.compras.length, SEED.compras.length);
});

test('login: senha errada mostra erro; certa entra', async t => {
  const page = await abrir(t, { ...SEED, logado: false }); if (!page) return;
  await page.waitForSelector('#scr-login.active');
  await page.type('#l-email', 'teste@exemplo.com');
  await page.type('#l-pass', 'errada');
  await clicar(page, 'doLogin');
  await page.waitForFunction(() => /incorretos/.test(document.getElementById('login-error').textContent));
  await page.$eval('#l-pass', el => { el.value = ''; });
  await page.type('#l-pass', 'senha123');
  await clicar(page, 'doLogin');
  await page.waitForSelector('#scr-home.active .compra-card');
});

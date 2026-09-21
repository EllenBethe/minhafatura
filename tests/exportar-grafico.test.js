import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCompras, csvLancamentos } from '../js/exportar.js';
import { modeloGrafico, svgGrafico, tetoEixo, valorCurto, CORES, COR_OUTROS } from '../js/grafico.js';

const COMPRAS = [
  { desc: 'Mercado; "bom"', cat: 'Mercado', data: '2026-09-05', parcelas: 1, valorParcela: 100.5 },
  { desc: 'TV', cat: 'Casa', data: '2026-08-20', parcelas: 3, valorParcela: 300 },
];

test('csvCompras: BOM, ";" e vírgula decimal, com aspas escapadas', () => {
  const csv = csvCompras(COMPRAS, 10);
  assert.ok(csv.startsWith('﻿Data da compra;'));
  const linhas = csv.trim().split('\r\n');
  assert.equal(linhas.length, 3);
  assert.equal(linhas[1], '20/08/2026;TV;Casa;3;300,00;900,00;setembro de 2026;novembro de 2026');
  assert.ok(linhas[2].includes('"Mercado; ""bom"""'));
});

test('csvLancamentos: uma linha por parcela, ordenado por fatura', () => {
  const linhas = csvLancamentos(COMPRAS, 10).trim().split('\r\n').slice(1);
  assert.equal(linhas.length, 4);   // 1 + 3 parcelas
  assert.deepEqual(linhas.map(l => l.split(';')[0]), ['2026-09', '2026-09', '2026-10', '2026-11']);
  assert.ok(linhas.some(l => l.includes(';2/3;')));
});

test('modeloGrafico: janela de faturas, totais e parcelas futuras', () => {
  const m = modeloGrafico(COMPRAS, 10, '2026-09', { antes: 1, depois: 3 });
  assert.deepEqual(m.keys, ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
  assert.deepEqual(m.totais, [0, 400.5, 300, 300, 0]);
  assert.equal(m.series[0].nome, 'Casa');   // maior total primeiro
  assert.equal(m.series[0].cor, CORES[0]);
});

test('modeloGrafico: mais de 7 categorias viram "Outros" (e "Outros" nunca ocupa cor principal)', () => {
  const muitas = Array.from({ length: 10 }, (_, i) =>
    ({ desc: 'x', cat: 'Cat' + i, data: '2026-09-01', parcelas: 1, valorParcela: 100 - i }));
  muitas.push({ desc: 'y', cat: 'Outros', data: '2026-09-01', parcelas: 1, valorParcela: 500 });
  const m = modeloGrafico(muitas, 10, '2026-09', { antes: 0, depois: 0 });
  assert.equal(m.series.length, 8);
  const outros = m.series.at(-1);
  assert.equal(outros.nome, 'Outros');
  assert.equal(outros.cor, COR_OUTROS);
  assert.deepEqual(outros.agrupa.sort(), ['Cat7', 'Cat8', 'Cat9', 'Outros'].sort());
  assert.equal(m.totais[0], muitas.reduce((a, c) => a + c.valorParcela, 0));
});

test('svgGrafico gera uma área de toque por fatura', () => {
  const m = modeloGrafico(COMPRAS, 10, '2026-09', { antes: 1, depois: 3 });
  const svg = svgGrafico(m, { selecionada: '2026-09' });
  assert.equal((svg.match(/data-action="grafSel"/g) || []).length, 5);
  assert.ok(svg.includes('futuras'));
});

test('tetoEixo e valorCurto', () => {
  assert.equal(tetoEixo(830), 1000);
  assert.equal(tetoEixo(1200), 2000);
  assert.equal(tetoEixo(2300), 2500);
  assert.equal(valorCurto(850), '850');
  assert.equal(valorCurto(1200), '1,2 mil');
  assert.equal(valorCurto(2000), '2 mil');
  assert.equal(valorCurto(15000), '15 mil');
});

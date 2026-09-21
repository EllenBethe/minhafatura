import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getFatKey, addMonths, fatKeyOf, getAllFatKeys, getEndFatKey, parcelaNaFatura,
  dataParaFatura, faturasAtivas, comprasDaFatura, resumoPorCategoria, normalizarDesc, esc, hojeISO,
} from '../js/fatura.js';

test('getFatKey: antes, no dia e depois do fechamento', () => {
  assert.equal(getFatKey('2026-09-09', 10), '2026-09');
  assert.equal(getFatKey('2026-09-10', 10), '2026-10');
  assert.equal(getFatKey('2026-12-18', 10), '2027-01');   // virada de ano
  assert.equal(getFatKey('2026-02-28', 31), '2026-02');   // fechamento 31 em fevereiro
});

test('addMonths atravessa anos nos dois sentidos', () => {
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(addMonths('2026-05', 0), '2026-05');
});

test('parcelas ocupam faturas consecutivas', () => {
  assert.deepEqual(getAllFatKeys('2026-11', 3), ['2026-11', '2026-12', '2027-01']);
  assert.equal(getEndFatKey('2026-11', 3), '2027-01');
  assert.equal(getEndFatKey('2026-11', 1), '2026-11');
});

test('fatKeyOf recalcula pela data quando o fechamento muda', () => {
  const c = { data: '2026-09-18', fatKey: '2026-10', parcelas: 1 };
  assert.equal(fatKeyOf(c, 10), '2026-10');
  assert.equal(fatKeyOf(c, 20), '2026-09');
  assert.equal(fatKeyOf({ fatKey: '2026-05' }, 10), '2026-05');   // compra antiga sem data
});

test('parcelaNaFatura', () => {
  const c = { data: '2026-09-05', parcelas: 3, valorParcela: 10 };   // 1ª em 2026-09
  assert.equal(parcelaNaFatura(c, '2026-09', 10), 1);
  assert.equal(parcelaNaFatura(c, '2026-11', 10), 3);
  assert.equal(parcelaNaFatura(c, '2026-12', 10), 0);
  assert.equal(parcelaNaFatura(c, '2026-08', 10), 0);
});

test('dataParaFatura devolve uma data que cai exatamente na fatura', () => {
  for (const fech of [1, 2, 10, 28, 31]) {
    for (const key of ['2026-01', '2026-02', '2026-12']) {
      assert.equal(getFatKey(dataParaFatura(key, fech), fech), key, `fech ${fech}, ${key}`);
    }
  }
});

test('faturasAtivas inclui a janela de hoje e as parcelas futuras', () => {
  const hoje = new Date(2026, 8, 18);   // 18/09/2026
  const compras = [{ data: '2026-09-01', parcelas: 12, valorParcela: 1 }];
  const keys = faturasAtivas(compras, 10, hoje);
  assert.equal(keys[0], '2026-07');
  assert.ok(keys.includes('2027-08'));   // 12ª parcela
  assert.deepEqual(keys, [...keys].sort());
});

test('comprasDaFatura e resumoPorCategoria', () => {
  const compras = [
    { desc: 'A', cat: 'Mercado', data: '2026-09-05', parcelas: 1, valorParcela: 100.1 },
    { desc: 'B', cat: 'Mercado', data: '2026-08-05', parcelas: 3, valorParcela: 0.2 },
    { desc: 'C', cat: 'Lazer',   data: '2026-09-20', parcelas: 1, valorParcela: 50 },   // cai em outubro
  ];
  const set = comprasDaFatura(compras, '2026-09', 10);
  assert.deepEqual(set.map(c => c.desc), ['A', 'B']);
  assert.deepEqual(resumoPorCategoria(set), { Mercado: 100.3 });   // sem resíduo de ponto flutuante
});

test('normalizarDesc ignora acento, caixa e sufixo de parcela', () => {
  assert.equal(normalizarDesc('Farmácia São João - Parcela 3/10'), 'farmacia sao joao');
  assert.equal(normalizarDesc('LOJA X 02/05'), 'loja x');
  assert.equal(normalizarDesc('  Mercado   Bom  '), 'mercado bom');
});

test('esc neutraliza HTML', () => {
  assert.equal(esc(`<img onerror="a">'&`), '&lt;img onerror=&quot;a&quot;&gt;&#39;&amp;');
  assert.equal(esc(null), '');
});

test('hojeISO usa o fuso local', () => {
  assert.equal(hojeISO(new Date(2026, 8, 18, 23, 30)), '2026-09-18');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataFechamento, diasAteFechamento, calcularMetas } from '../js/metas.js';

const d = (y, m, dia) => new Date(y, m - 1, dia);
const br = dt => dt.toLocaleDateString('pt-BR');

test('dataFechamento: dia do fechamento no mês da fatura; 31 em fevereiro vira 1º de março', () => {
  assert.equal(br(dataFechamento('2026-10', 6)), '06/10/2026');
  assert.equal(br(dataFechamento('2026-02', 31)), '01/03/2026');
  assert.equal(br(dataFechamento('2026-12', 10)), '10/12/2026');
});

test('diasAteFechamento: conta hoje e para na véspera do fechamento', () => {
  // fechamento 6, hoje 21/09 → fatura aberta é a de outubro, fecha 06/10 → 15 dias (21/09 a 05/10)
  let r = diasAteFechamento(6, d(2026, 9, 21));
  assert.equal(r.dias, 15);
  assert.equal(br(r.fecha), '06/10/2026');
  // véspera do fechamento: resta 1 dia
  assert.equal(diasAteFechamento(6, d(2026, 10, 5)).dias, 1);
  // no próprio dia do fechamento a fatura aberta já é a seguinte
  assert.equal(diasAteFechamento(6, d(2026, 10, 6)).dias, 31);
  // virada de ano
  assert.equal(br(diasAteFechamento(10, d(2026, 12, 20)).fecha), '10/01/2027');
});

test('calcularMetas: gap, total disponível e valor por dia', () => {
  const r = calcularMetas({ teto: 5000, gasto: 3620.5, vrva: 480, fechamento: 6, hoje: d(2026, 9, 21) });
  assert.equal(r.gap, 1379.5);
  assert.equal(r.disponivel, 1859.5);
  assert.equal(r.dias, 15);
  assert.equal(r.porDia, 123.97);
  assert.equal(r.pctTeto, 72);
});

test('calcularMetas: passou do teto → gap negativo, disponível só o VR/VA', () => {
  const r = calcularMetas({ teto: 3000, gasto: 3200, vrva: 300, fechamento: 6, hoje: d(2026, 10, 1) });
  assert.equal(r.gap, -200);
  assert.equal(r.disponivel, 300);
  assert.equal(r.dias, 5);
  assert.equal(r.porDia, 60);
  assert.equal(r.pctTeto, 107);
});

test('calcularMetas: sem teto definido não inventa números', () => {
  const r = calcularMetas({ gasto: 1000, vrva: 200, fechamento: 10, hoje: d(2026, 9, 21) });
  assert.equal(r.gap, null);
  assert.equal(r.disponivel, null);
  assert.equal(r.porDia, null);
  assert.equal(r.pctTeto, null);
  assert.ok(r.dias > 0);
});

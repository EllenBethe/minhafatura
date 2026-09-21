// ============================================================
//  Metas: teto de gasto no cartão, VR/VA e quanto dá para gastar por dia.
//  Sem DOM e sem Firebase — testado em tests/metas.test.js.
// ============================================================

import { getFatKey, arred } from './fatura.js?v=8';

const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

// Dia em que a fatura `fatKey` fecha (compras a partir desse dia já vão para a próxima).
// Fechamento 31 em fevereiro: a fatura inclui o mês todo, então "fecha" em 1º de março.
export function dataFechamento(fatKey, fechamento) {
  const [y, m] = fatKey.split('-').map(Number);
  const ultimoDia = new Date(y, m, 0).getDate();
  return fechamento <= ultimoDia ? new Date(y, m - 1, fechamento) : new Date(y, m, 1);
}

// Dias de compra que ainda restam na fatura aberta (hoje conta; o dia do fechamento não)
export function diasAteFechamento(fechamento, hoje = new Date()) {
  const h = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const fecha = dataFechamento(getFatKey(iso(h), fechamento), fechamento);
  return { dias: Math.round((fecha - h) / 86400000), fecha };
}

// Números da aba Metas. `gasto` é o gasto atual no cartão (digitado ou o da fatura aberta).
export function calcularMetas({ teto = 0, gasto = 0, vrva = 0, fechamento, hoje = new Date() }) {
  const { dias, fecha } = diasAteFechamento(fechamento, hoje);
  const gap = teto > 0 ? arred(teto - gasto) : null;            // folga até o teto (negativo = passou)
  const disponivel = gap === null ? null : arred(Math.max(0, gap) + (vrva || 0));
  const porDia = disponivel === null ? null : arred(dias > 0 ? disponivel / dias : disponivel);
  const pctTeto = teto > 0 ? Math.round(gasto / teto * 100) : null;
  return { gap, disponivel, dias, fecha, porDia, pctTeto };
}

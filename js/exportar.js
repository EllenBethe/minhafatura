// ============================================================
//  Exportação para planilha (CSV no padrão do Excel brasileiro:
//  separador ";", vírgula decimal e BOM UTF-8 para os acentos)
// ============================================================

import { fatKeyOf, getAllFatKeys, getEndFatKey, fatLabelFull, arred } from './fatura.js?v=8';

const num = v => arred(v).toFixed(2).replace('.', ',');
const dataBR = iso => iso ? iso.split('-').reverse().join('/') : '';

function celula(v) {
  const s = String(v ?? '');
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function montarCSV(cabecalho, linhas) {
  return '﻿' + [cabecalho, ...linhas].map(l => l.map(celula).join(';')).join('\r\n') + '\r\n';
}

// Uma linha por compra (bom como backup)
export function csvCompras(compras, fechamento) {
  const linhas = [...compras]
    .sort((a, b) => (a.data || '').localeCompare(b.data || ''))
    .map(c => {
      const inicio = fatKeyOf(c, fechamento);
      return [
        dataBR(c.data), c.desc, c.cat, c.parcelas,
        num(c.valorParcela), num(c.valorParcela * c.parcelas),
        fatLabelFull(inicio), fatLabelFull(getEndFatKey(inicio, c.parcelas)),
      ];
    });
  return montarCSV(
    ['Data da compra', 'Descrição', 'Categoria', 'Parcelas', 'Valor da parcela', 'Valor total', 'Primeira fatura', 'Última fatura'],
    linhas);
}

// Uma linha por parcela em cada fatura (bom para tabela dinâmica por mês)
export function csvLancamentos(compras, fechamento) {
  const linhas = [];
  compras.forEach(c => {
    getAllFatKeys(fatKeyOf(c, fechamento), c.parcelas).forEach((k, i) => {
      linhas.push([k, fatLabelFull(k), dataBR(c.data), c.desc, c.cat,
        c.parcelas > 1 ? `${i + 1}/${c.parcelas}` : 'À vista', num(c.valorParcela)]);
    });
  });
  linhas.sort((a, b) => a[0].localeCompare(b[0]) || a[2].split('/').reverse().join('').localeCompare(b[2].split('/').reverse().join('')));
  return montarCSV(['Fatura (AAAA-MM)', 'Fatura', 'Data da compra', 'Descrição', 'Categoria', 'Parcela', 'Valor'], linhas);
}

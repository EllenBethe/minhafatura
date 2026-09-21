// ============================================================
//  Lógica de fatura e parcelamento — sem DOM e sem Firebase,
//  para poder ser testada com `npm test`.
//
//  Chave de fatura ("fatKey") = 'AAAA-MM' do mês em que a fatura fecha.
//  Compras a partir do dia de fechamento entram na fatura seguinte.
//  Uma compra de N parcelas aparece em N faturas consecutivas.
// ============================================================

export const MONTHS   = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                         'agosto','setembro','outubro','novembro','dezembro'];
export const MONTHS_S = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

const pad = n => String(n).padStart(2, '0');

// Data de hoje no fuso local (toISOString usa UTC e vira o dia após 21h no Brasil)
export function hojeISO(d = new Date()) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Soma n meses a uma chave 'AAAA-MM' (n pode ser negativo)
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

export function getFatKey(dateStr, fechamento) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const key = y + '-' + pad(m);
  return d >= fechamento ? addMonths(key, 1) : key;
}

// Fatura da 1ª parcela, sempre recalculada a partir da data da compra
// (assim mudar o dia de fechamento reposiciona as compras antigas)
export function fatKeyOf(c, fechamento) {
  return c.data ? getFatKey(c.data, fechamento) : c.fatKey;
}

// Todas as faturas que a compra ocupa
export function getAllFatKeys(startFatKey, parcelas) {
  const keys = [];
  for (let i = 0; i < parcelas; i++) keys.push(addMonths(startFatKey, i));
  return keys;
}

export function getEndFatKey(startFatKey, parcelas) {
  return addMonths(startFatKey, Math.max(1, parcelas) - 1);
}

// Número da parcela (1..N) que cai na fatura, ou 0 se a compra não aparece nela
export function parcelaNaFatura(c, fatKey, fechamento) {
  const start = fatKeyOf(c, fechamento);
  const idx = getAllFatKeys(start, c.parcelas).indexOf(fatKey);
  return idx + 1;
}

// Uma data (AAAA-MM-DD) cuja fatura é exatamente `key` — usada ao importar
// parcelas e compras cuja data real não bate com a fatura escolhida
export function dataParaFatura(key, fechamento) {
  if (fechamento > 1) return key + '-' + pad(Math.min(fechamento - 1, 28));
  // Fechamento dia 1: qualquer dia do mês anterior cai nesta fatura
  return addMonths(key, -1) + '-15';
}

export function fatLabel(key) {
  const [y, m] = key.split('-');
  return MONTHS_S[parseInt(m) - 1] + '/' + y.slice(2);
}

export function fatLabelFull(key) {
  const [y, m] = key.split('-');
  return MONTHS[parseInt(m) - 1] + ' de ' + y;
}

// Faturas do seletor: 2 meses antes a 3 depois de hoje + todas com parcelas
export function faturasAtivas(compras, fechamento, hoje = new Date()) {
  const base = hoje.getFullYear() + '-' + pad(hoje.getMonth() + 1);
  const keys = new Set();
  for (let i = -2; i <= 3; i++) keys.add(addMonths(base, i));
  compras.forEach(c => getAllFatKeys(fatKeyOf(c, fechamento), c.parcelas).forEach(k => keys.add(k)));
  return [...keys].sort();
}

// Compras que aparecem em uma fatura (inclui parceladas de meses anteriores)
export function comprasDaFatura(compras, fatKey, fechamento) {
  return compras.filter(c => parcelaNaFatura(c, fatKey, fechamento) > 0);
}

// { categoria: soma das parcelas } para uma lista de compras de uma fatura
export function resumoPorCategoria(compras) {
  const map = {};
  compras.forEach(c => { map[c.cat] = arred((map[c.cat] || 0) + c.valorParcela); });
  return map;
}

export function arred(v) {
  return Math.round(v * 100) / 100;
}

// Normaliza descrição para comparar (sem acento, minúsculas, sem sufixo de parcela)
export function normalizarDesc(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[-–]?\s*(parcela|parc\.?)?\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Escapa texto do usuário antes de inserir via innerHTML
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Busca por nome ou categoria, sem diferenciar acento/maiúscula ("farmacia" acha "Farmácia")
export function casaBusca(c, termo) {
  const t = semAcento(termo).trim();
  return !t || semAcento(c.desc).includes(t) || semAcento(c.cat).includes(t);
}

// Busca em todas as faturas: compras mais recentes primeiro, com o total de todas as parcelas
export function buscarCompras(compras, termo) {
  const achadas = compras.filter(c => casaBusca(c, termo))
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
  const total = arred(achadas.reduce((a, c) => a + c.valorParcela * c.parcelas, 0));
  return { achadas, total };
}

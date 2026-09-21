// ============================================================
//  Gráfico de faturas por categoria (barras empilhadas em SVG).
//  Faturas passadas + a aberta + as futuras (só com as parcelas
//  já lançadas = quanto já está comprometido).
// ============================================================

import { addMonths, fatKeyOf, getAllFatKeys, fatLabel, arred, esc } from './fatura.js?v=8';

// Paleta categórica (tema escuro), em ordem fixa — validada contra o fundo #131f1e
// com o validador do skill de dataviz (CVD adjacente ≥ 8,4; visão normal ≥ 19,3; contraste ≥ 3:1)
export const CORES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'];
export const COR_OUTROS = '#7d8a88';
const MAX_SERIES = CORES.length;

// Monta os dados: faturas × categorias. Categorias além da 7ª viram "Outros".
export function modeloGrafico(compras, fechamento, aberta, { antes = 5, depois = 6 } = {}) {
  const keys = [];
  for (let i = -antes; i <= depois; i++) keys.push(addMonths(aberta, i));
  const idx = new Map(keys.map((k, i) => [k, i]));

  const porCat = {};
  compras.forEach(c => {
    getAllFatKeys(fatKeyOf(c, fechamento), c.parcelas).forEach(k => {
      if (!idx.has(k)) return;
      (porCat[c.cat] ||= keys.map(() => 0))[idx.get(k)] += c.valorParcela;
    });
  });

  const soma = v => v.reduce((a, b) => a + b, 0);
  // Maiores primeiro; "Outros" (se existir como categoria) sempre vai para o grupo final
  const ordem = Object.keys(porCat).sort((a, b) => soma(porCat[b]) - soma(porCat[a]));
  const principais = ordem.filter(c => c.toLowerCase() !== 'outros').slice(0, MAX_SERIES);
  const resto = ordem.filter(c => !principais.includes(c));

  // Estornos podem deixar uma categoria negativa num mês: a barra não desenha abaixo de zero
  const pos = v => Math.max(0, arred(v));
  const series = principais.map((nome, i) => ({ nome, cor: CORES[i], valores: porCat[nome].map(pos) }));
  if (resto.length) {
    const valores = keys.map((_, i) => pos(resto.reduce((a, c) => a + porCat[c][i], 0)));
    series.push({ nome: 'Outros', cor: COR_OUTROS, valores, agrupa: resto });
  }
  const totais = keys.map((_, i) => arred(series.reduce((a, s) => a + s.valores[i], 0)));
  return { keys, aberta, series, totais };
}

// Teto "redondo" para o eixo Y (1, 2, 2,5, 5 × 10^n)
export function tetoEixo(max) {
  if (max <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

// R$ curto para eixos: 850 → "850", 1200 → "1,2 mil", 15000 → "15 mil"
export function valorCurto(v) {
  if (v < 1000) return String(Math.round(v));
  const mil = v / 1000;
  return (mil < 10 ? mil.toFixed(1).replace('.', ',').replace(',0', '') : Math.round(mil)) + ' mil';
}

// SVG como string. `selecionada` = chave da fatura destacada (recebe o total em cima)
export function svgGrafico(modelo, { selecionada, largura = 360, altura = 230 } = {}) {
  const { keys, aberta, series, totais } = modelo;
  const E = 40, D = 6, T = 22, B = 24;                  // margens
  const pw = largura - E - D, ph = altura - T - B;
  const teto = tetoEixo(Math.max(...totais, 0));
  const y = v => T + ph - (v / teto) * ph;
  const banda = pw / keys.length, bw = Math.min(22, banda * 0.62), GAP = 2;
  const iAberta = keys.indexOf(aberta);

  let s = `<svg viewBox="0 0 ${largura} ${altura}" class="graf-svg" role="img" aria-label="Total por fatura, empilhado por categoria">`;

  // grade + eixo Y (recessivos)
  for (let i = 0; i <= 4; i++) {
    const v = (teto / 4) * i, yy = y(v);
    s += `<line x1="${E}" x2="${largura - D}" y1="${yy}" y2="${yy}" class="graf-grade${i === 0 ? ' base' : ''}"/>`;
    s += `<text x="${E - 6}" y="${yy + 3.5}" text-anchor="end" class="graf-eixo">${valorCurto(v)}</text>`;
  }

  // separador: daqui para a direita é previsão (parcelas futuras)
  if (iAberta >= 0 && iAberta < keys.length - 1) {
    const xs = E + banda * (iAberta + 1);
    s += `<line x1="${xs}" x2="${xs}" y1="${T - 8}" y2="${T + ph}" class="graf-sep"/>`;
    s += `<text x="${xs + 4}" y="${T - 10}" class="graf-eixo">futuras →</text>`;
  }

  keys.forEach((k, i) => {
    const cx = E + banda * i + banda / 2, x = cx - bw / 2;
    const futura = i > iAberta;
    const topo = y(totais[i]);
    // cantos superiores arredondados: clip com rx estendido abaixo da base
    s += `<clipPath id="gc${i}"><rect x="${x}" y="${topo}" width="${bw}" height="${T + ph - topo + 6}" rx="4"/></clipPath>`;
    s += `<g clip-path="url(#gc${i})"${futura ? ' class="graf-futura"' : ''}>`;
    let base = T + ph;
    series.forEach(se => {
      const v = se.valores[i];
      if (!v) return;
      const h = (v / teto) * ph;
      const hVis = Math.max(0, h - GAP);          // 2px de fundo entre segmentos
      s += `<rect x="${x}" y="${base - h + GAP}" width="${bw}" height="${hVis}" fill="${se.cor}"/>`;
      base -= h;
    });
    s += `</g>`;

    const sel = k === selecionada;
    s += `<text x="${cx}" y="${altura - 8}" text-anchor="middle" class="graf-eixo${sel ? ' sel' : ''}${k === aberta ? ' aberta' : ''}">${fatLabel(k).split('/')[0]}</text>`;
    if (sel && totais[i] > 0) {
      s += `<text x="${cx}" y="${topo - 5}" text-anchor="middle" class="graf-total">${valorCurto(totais[i])}</text>`;
    }
    if (sel) s += `<rect x="${E + banda * i + 1}" y="${T - 2}" width="${banda - 2}" height="${ph + 2}" rx="6" class="graf-sel"/>`;
    // área de toque maior que a barra
    s += `<rect x="${E + banda * i}" y="0" width="${banda}" height="${altura}" fill="transparent" data-action="grafSel" data-key="${esc(k)}"><title>${esc(fatLabel(k))}</title></rect>`;
  });

  return s + '</svg>';
}

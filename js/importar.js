// ============================================================
//  Importação de fatura exportada pelo banco (CSV ou OFX).
//  Sem DOM e sem Firebase — testado em tests/importar.test.js.
//
//  Fluxo: decodificarArquivo → lerArquivo → prepararImportacao
//  (sugere categoria, calcula a data/parcelas e marca duplicadas)
// ============================================================

import { addMonths, getFatKey, fatKeyOf, dataParaFatura, normalizarDesc, arred } from './fatura.js?v=8';

// Bytes → texto. Bancos exportam em UTF-8 ou Windows-1252 (acentos quebram se errar)
export function decodificarArquivo(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buffer); }
}

// ---------- números e datas ----------

// "R$ 1.234,56" | "-12,30" | "12.34" | "1,234.56" | "(12,30)" → número
export function parseValor(txt) {
  let s = String(txt ?? '').trim();
  if (!s) return NaN;
  const negParenteses = /^\(.*\)$/.test(s);
  s = s.replace(/[R$\s ()]/g, '');
  const neg = negParenteses || s.startsWith('-') || s.endsWith('-');
  s = s.replace(/[+-]/g, '');
  const ultimaVirgula = s.lastIndexOf(','), ultimoPonto = s.lastIndexOf('.');
  if (ultimaVirgula > ultimoPonto) s = s.replace(/\./g, '').replace(',', '.');   // pt-BR
  else s = s.replace(/,/g, '');                                                    // en
  const v = parseFloat(s);
  return isNaN(v) ? NaN : (neg ? -v : v);
}

// "15/09/2026" | "15/09/26" | "2026-09-15" | "20260915" → "2026-09-15" (ou null)
export function parseData(txt) {
  const s = String(txt ?? '').trim();
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})/)))   return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))) {
    const ano = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

// "Parcela 3/10" | "PARC 03/10" | "3 de 10" | "Única" → { atual, total } (ou null)
export function parseParcela(txt) {
  const m = String(txt ?? '').match(/(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i)
         || String(txt ?? '').match(/parc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})/i);
  if (!m) return null;
  const atual = +m[1], total = +m[2];
  return total > 1 && atual >= 1 && atual <= total ? { atual, total } : null;
}

// ---------- CSV ----------

export function detectarSeparador(linha) {
  const conta = ch => (linha.match(new RegExp('\\' + ch, 'g')) || []).length;
  return [';', ',', '\t'].sort((a, b) => conta(b) - conta(a))[0];
}

// Divide uma linha CSV respeitando aspas ("a;b" fica inteiro, "" vira ")
export function dividirLinhaCSV(linha, sep) {
  const cols = []; let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
      else if (ch === '"') aspas = false;
      else atual += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { cols.push(atual.trim()); atual = ''; }
    else atual += ch;
  }
  cols.push(atual.trim());
  return cols;
}

const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Índice da primeira coluna cujo cabeçalho casa com algum padrão, na ordem de prioridade
function acharColuna(cab, padroes, excluir = []) {
  for (const p of padroes) {
    const i = cab.findIndex((h, idx) => p.test(h) && !excluir.includes(idx));
    if (i >= 0) return i;
  }
  return -1;
}

export function lerCSV(texto) {
  const linhas = texto.split(/\r?\n/).filter(l => l.trim());
  if (linhas.length < 2) throw new Error('Arquivo vazio ou sem lançamentos.');
  const sep = detectarSeparador(linhas[0]);
  const cab = dividirLinhaCSV(linhas[0], sep).map(semAcento);

  const iData = acharColuna(cab, [/^data( de)? compra/, /^data/, /^date$/, /date/]);
  const iValor = acharColuna(cab, [/valor.*r\$/, /^valor$/, /^amount$/, /valor/, /amount/], [])
  const iDesc = acharColuna(cab, [/^descri/, /^title$/, /lancamento/, /estabelecimento/, /historico/, /^nome$/, /descri/]);
  const iParc = acharColuna(cab, [/^parcela/, /^tipo$/, /parcela/]);
  const iCat  = acharColuna(cab, [/^categoria/, /category/]);
  if (iData < 0 || iValor < 0 || iDesc < 0) {
    throw new Error('Não reconheci as colunas de data, descrição e valor deste CSV.');
  }

  return linhas.slice(1).map(l => {
    const c = dividirLinhaCSV(l, sep);
    const desc = c[iDesc] || '';
    return {
      data: parseData(c[iData]),
      desc,
      valor: parseValor(c[iValor]),
      parcela: parseParcela(iParc >= 0 ? c[iParc] : '') || parseParcela(desc),
      catBanco: iCat >= 0 ? c[iCat] || '' : '',
    };
  }).filter(l => l.data && l.desc && !isNaN(l.valor));
}

// ---------- OFX (Itaú, BB, Santander, Bradesco...) ----------

export function lerOFX(texto) {
  const blocos = texto.split(/<STMTTRN>/i).slice(1);
  if (!blocos.length) throw new Error('Nenhum lançamento encontrado no OFX.');
  const campo = (b, nome) => (b.match(new RegExp('<' + nome + '>([^<\\r\\n]*)', 'i')) || [])[1]?.trim() || '';
  return blocos.map(b => {
    const desc = campo(b, 'MEMO') || campo(b, 'NAME');
    return {
      data: parseData(campo(b, 'DTPOSTED')),
      desc,
      valor: parseValor(campo(b, 'TRNAMT')),
      parcela: parseParcela(desc),
      catBanco: '',
    };
  }).filter(l => l.data && l.desc && !isNaN(l.valor));
}

// Detecta o formato e padroniza o sinal: compras positivas, pagamentos/créditos negativos
export function lerArquivo(texto, nome = '') {
  const ehOFX = /\.ofx$/i.test(nome) || /<OFX>|<STMTTRN>/i.test(texto);
  const linhas = ehOFX ? lerOFX(texto) : lerCSV(texto);
  // Extratos de cartão em OFX (e alguns CSV) trazem compras como negativas: inverte
  const negativos = linhas.filter(l => l.valor < 0).length;
  if (negativos > linhas.length / 2) linhas.forEach(l => { l.valor = -l.valor; });
  return linhas;
}

// ---------- categorias ----------

// Palavra-chave → nome de categoria padrão (usado só se a categoria existir)
const REGRAS = [
  ['Mercado', /mercado|supermerc|carrefour|assai|atacad|pao de acucar|hortifruti|sacolao|dia brasil|zaffari|savegnago|hiper/],
  ['Alimentação', /ifood|restaur|lanchon|padaria|burger|mc ?donald|pizza|rappi|cafe|sushi|churrasc|bk |subway|outback|coco bambu|aiqfome|99food/],
  ['Assinaturas', /netflix|spotify|disney|hbo|prime video|amazon prime|youtube|apple\.com|icloud|google (one|storage)|deezer|globoplay|paramount|chatgpt|openai|crunchyroll|max\.com|claude/],
  ['Saúde', /drogaria|farmac|droga|raia|pacheco|panvel|pague menos|hospital|clinica|laborat|unimed|odonto|dentista/],
  ['Manutenção do Carro', /posto|shell|ipiranga|petrobras|br mania|auto ?pe|oficina|pneu|estaciona|sem parar|veloe|conectcar|lava ?jato|detran/],
  ['Vestuário', /renner|riachuelo|c&a|\bcea\b|zara|shein|hering|centauro|netshoes|marisa|youcom|calcado|sapat/],
  ['Lazer', /cinema|cinemark|ingresso|sympla|steam|playstation|xbox|nintendo|show|teatro|parque/],
];

// Sugere categoria: 1) mesma descrição já usada antes; 2) palavra-chave (descrição
// e categoria do banco); 3) "Outros" (ou a primeira categoria cadastrada)
export function sugerirCategoria(linha, compras, categorias) {
  const nomes = categorias.map(c => c.name);
  const norm = normalizarDesc(linha.desc);
  const anterior = compras.find(c => normalizarDesc(c.desc) === norm && nomes.includes(c.cat));
  if (anterior) return anterior.cat;

  const texto = semAcento(linha.desc + ' ' + (linha.catBanco || ''));
  for (const [cat, re] of REGRAS) {
    const existe = nomes.find(n => semAcento(n) === semAcento(cat));
    if (existe && re.test(texto)) return existe;
  }
  return nomes.find(n => semAcento(n) === 'outros') || nomes[0] || 'Outros';
}

// ---------- montagem ----------

// Transforma as linhas lidas em compras para a fatura `faturaAlvo`.
// - Parcela k/N: vira compra de N parcelas cuja k-ésima cai na fatura alvo
// - Data real mantida quando ela já cai na fatura certa; senão ajustada
// - Valores ≤ 0 (pagamento, estorno, crédito) ficam de fora
// - Duplicadas (já existem no app) vêm desmarcadas
export function prepararImportacao(linhas, { faturaAlvo, fechamento, compras = [], categorias = [] }) {
  const existentes = new Set(compras.map(c =>
    [normalizarDesc(c.desc), arred(c.valorParcela), c.parcelas, fatKeyOf(c, fechamento)].join('|')));

  const itens = [], ignorados = [];
  for (const l of linhas) {
    if (!(l.valor > 0)) { ignorados.push(l); continue; }
    const parcelas = l.parcela?.total || 1;
    const k = l.parcela?.atual || 1;
    const inicio = addMonths(faturaAlvo, -(k - 1));
    const data = getFatKey(l.data, fechamento) === inicio ? l.data : dataParaFatura(inicio, fechamento);
    const desc = limparDesc(l.desc);
    const valorParcela = arred(l.valor);
    const chave = [normalizarDesc(desc), valorParcela, parcelas, inicio].join('|');
    const duplicada = existentes.has(chave);
    existentes.add(chave); // a mesma linha repetida no arquivo também conta como duplicada
    itens.push({
      desc, data, dataArquivo: l.data, inicio, parcelas, valorParcela, parcelaAtual: k,
      cat: sugerirCategoria(l, compras, categorias),
      duplicada, incluir: !duplicada,
    });
  }
  return { itens, ignorados };
}

// Tira o sufixo de parcela da descrição ("LOJA X - Parcela 3/10" → "LOJA X")
export function limparDesc(desc) {
  return String(desc).replace(/\s*[-–]?\s*(parcela|parc\.?)?\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/i, '').trim() || String(desc).trim();
}

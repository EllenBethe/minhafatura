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

// Cada regra: [categorias candidatas, em ordem de preferência] → palavra-chave.
// Usa a primeira candidata que existir no app (ex.: "Supermercado"; se não houver, "Mercado").

const SUPERMERCADO = ['Supermercado', 'Mercado'];
const GASOLINA     = ['Gasolina', 'Combustível', 'Manutenção do Carro'];

// Regras fixas: valem SEMPRE, inclusive sobre o histórico (pedido explícito da usuária)
const REGRAS_FIXAS = [
  // "mercado" sem pegar Mercado Livre / Mercado Pago (tratados em textoParaRegras)
  [SUPERMERCADO, /supermer|mercado/],
  [GASOLINA,     /\bposto\b|\bshell/],
];

// Regras gerais: aplicadas depois do histórico da mesma loja
const REGRAS = [
  [SUPERMERCADO, /carrefour|assai|atacad|pao de acucar|hortifruti|sacolao|dia brasil|zaffari|savegnago|hiper|giassi|angeloni|cooper filial|bistek|komprao|condor|muffato|big ?bompreco|sonda|st marche/],
  [GASOLINA,     /ipiranga|petrobras|br mania|combustiv|auto ?posto/],
  [['Alimentação'], /ifood|\bifd\*|restaur|lanchon|padaria|panific|\bpao\b|confeit|doces|salgad|strudel|marmita|gastronom|burger|mc ?donald|pizza|rappi|cafe|sushi|churrasc|\bbk\b|subway|outback|coco bambu|aiqfome|99food|nonna|sorvet|acai|pastel/],
  [['Assinaturas'], /netflix|spotify|disney|hbo|prime video|amazon prime|youtube|apple\.com|icloud|google (one|storage)|deezer|globoplay|paramount|chatgpt|openai|crunchyroll|max\.com|claude/],
  [['Saúde'], /drogaria|farmac|droga|raia|pacheco|panvel|pague menos|hospital|clinica|laborat|unimed|odonto|dentista/],
  [['Seguro Carro'], /bradesco auto|auto re\b|azul seguro|tokio marine auto|allianz auto/],
  [['Conjunto/Casa', 'Outros'], /estaciona|parking|rekpay|parkhaus|zona azul/],
  [['Manutenção do Carro'], /auto ?pe|oficina|pneu|bateria|sem parar|veloe|conectcar|lava ?jato|detran/],
  [['Vestuário'], /renner|riachuelo|c&a|\bcea\b|zara|shein|hering|centauro|netshoes|marisa|youcom|calcado|sapat/],
  [['Lazer'], /cinema|cinemark|ingresso|sympla|steam|playstation|xbox|nintendo|show|teatro|parque/],
];

// Texto normalizado para as regras. "Mercadolivre*Mercadol" / "Mercado Pago" são
// marketplace/pagamento, não mercado: saem antes de testar.
function textoParaRegras(linha) {
  return semAcento(linha.desc + ' ' + (linha.catBanco || ''))
    .replace(/mercado ?(livre|pago)\S*|\*mercadol\S*/g, ' ');
}

function aplicarRegras(regras, texto, nomes) {
  for (const [candidatas, re] of regras) {
    if (!re.test(texto)) continue;
    for (const cand of candidatas) {
      const existe = nomes.find(n => semAcento(n) === semAcento(cand));
      if (existe) return existe;
    }
  }
  return null;
}

// Sugere categoria: 1) regras fixas (supermercado, posto/shell); 2) mesma descrição
// já usada antes; 3) demais palavras-chave (descrição e categoria do banco);
// 4) "Outros" (ou a primeira categoria cadastrada)
export function sugerirCategoria(linha, compras, categorias) {
  const nomes = categorias.map(c => c.name);
  const texto = textoParaRegras(linha);

  const fixa = aplicarRegras(REGRAS_FIXAS, texto, nomes);
  if (fixa) return fixa;

  const norm = normalizarDesc(linha.desc);
  const anterior = compras.find(c => normalizarDesc(c.desc) === norm && nomes.includes(c.cat));
  if (anterior) return anterior.cat;

  return aplicarRegras(REGRAS, texto, nomes)
    || nomes.find(n => semAcento(n) === 'outros') || nomes[0] || 'Outros';
}

// Sugestão para o formulário de nova compra (só quando há uma regra clara)
export function categoriaPorNome(desc, compras, categorias) {
  const nomes = categorias.map(c => c.name);
  const texto = textoParaRegras({ desc });
  const fixa = aplicarRegras(REGRAS_FIXAS, texto, nomes);
  if (fixa) return fixa;
  const norm = normalizarDesc(desc);
  const anterior = norm.length >= 3 && compras.find(c => normalizarDesc(c.desc) === norm && nomes.includes(c.cat));
  return anterior ? anterior.cat : aplicarRegras(REGRAS, texto, nomes);
}

// ---------- montagem ----------

// Transforma as linhas lidas em compras para a fatura `faturaAlvo`.
// - Parcela k/N: vira compra de N parcelas cuja k-ésima cai na fatura alvo
// - Data real mantida quando ela já cai na fatura certa; senão ajustada
// - Valores ≤ 0 (pagamento, estorno, crédito) ficam de fora
// - Já lançadas no app vêm desmarcadas (ver acharExistente)
export function prepararImportacao(linhas, { faturaAlvo, fechamento, compras = [], categorias = [] }) {
  const livres = [...compras];   // cada compra do app "casa" com no máximo uma linha do arquivo

  const itens = [], ignorados = [];
  for (const l of linhas) {
    if (!(l.valor > 0)) { ignorados.push(l); continue; }
    const parcelas = l.parcela?.total || 1;
    const k = l.parcela?.atual || 1;
    const inicio = addMonths(faturaAlvo, -(k - 1));
    const data = getFatKey(l.data, fechamento) === inicio ? l.data : dataParaFatura(inicio, fechamento);
    const desc = limparDesc(l.desc);
    const valorParcela = arred(l.valor);
    const iExistente = acharExistente(livres, { desc, dataArquivo: l.data, parcelas, valorParcela, inicio }, fechamento);
    const duplicada = iExistente >= 0;
    if (duplicada) livres.splice(iExistente, 1);
    itens.push({
      desc, data, dataArquivo: l.data, inicio, parcelas, valorParcela, parcelaAtual: k,
      cat: sugerirCategoria(l, compras, categorias),
      duplicada, incluir: !duplicada,
    });
  }
  return { itens, ignorados };
}

const diasEntre = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// Procura no app uma compra que seja a mesma da linha, mesmo lançada à mão com outro nome:
// - parcelada: mesmo nº de parcelas e valor da parcela, 1ª parcela na mesma fatura (±1 mês)
// - à vista: mesmo valor e data até 3 dias de diferença (ou mesmo nome na mesma fatura)
function acharExistente(compras, item, fechamento) {
  const mesmoValor = c => Math.abs(arred(c.valorParcela) - item.valorParcela) < 0.005;
  if (item.parcelas > 1) {
    const perto = k => [addMonths(item.inicio, -1), item.inicio, addMonths(item.inicio, 1)].includes(k);
    return compras.findIndex(c => c.parcelas === item.parcelas && mesmoValor(c) && perto(fatKeyOf(c, fechamento)));
  }
  const norm = normalizarDesc(item.desc);
  return compras.findIndex(c => c.parcelas === 1 && mesmoValor(c) && (
    (c.data && diasEntre(c.data, item.dataArquivo) <= 3) ||
    (normalizarDesc(c.desc) === norm && fatKeyOf(c, fechamento) === item.inicio)));
}

// Sugere o dia de fechamento pelo arquivo: numa fatura, as compras à vista vão do dia do
// fechamento anterior até a véspera do próximo. Só sugere se o arquivo cobre ~1 mês.
export function sugerirFechamento(linhas) {
  const datas = linhas.filter(l => l.valor > 0 && !l.parcela).map(l => l.data).sort();
  if (datas.length < 5) return null;
  const ini = datas[0], fim = datas.at(-1);
  const dias = diasEntre(ini, fim);
  if (dias < 20 || dias > 35) return null;
  return +ini.slice(8, 10);
}

// Tira o sufixo de parcela da descrição ("LOJA X - Parcela 3/10" → "LOJA X")
export function limparDesc(desc) {
  return String(desc).replace(/\s*[-–]?\s*(parcela|parc\.?)?\s*\d{1,2}\s*\/\s*\d{1,2}\s*$/i, '').trim() || String(desc).trim();
}

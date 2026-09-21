import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseValor, parseData, parseParcela, dividirLinhaCSV, lerArquivo, decodificarArquivo,
  sugerirCategoria, prepararImportacao, limparDesc, sugerirFechamento,
} from '../js/importar.js';
import { getFatKey, fatKeyOf, parcelaNaFatura } from '../js/fatura.js';

const CATEGORIAS = ['Assinaturas', 'Alimentação', 'Mercado', 'Saúde', 'Manutenção do Carro', 'Outros']
  .map(name => ({ name, emoji: '·' }));

test('parseValor entende formatos brasileiros e americanos', () => {
  assert.equal(parseValor('R$ 1.234,56'), 1234.56);
  assert.equal(parseValor('-12,30'), -12.3);
  assert.equal(parseValor('12.34'), 12.34);
  assert.equal(parseValor('1,234.56'), 1234.56);
  assert.equal(parseValor('(45,00)'), -45);
  assert.equal(parseValor('R$ -0,99'), -0.99);
  assert.ok(Number.isNaN(parseValor('')));
});

test('parseData', () => {
  assert.equal(parseData('15/09/2026'), '2026-09-15');
  assert.equal(parseData('5/9/26'), '2026-09-05');
  assert.equal(parseData('2026-09-15'), '2026-09-15');
  assert.equal(parseData('20260915120000[-3:BRT]'), '2026-09-15');
  assert.equal(parseData('ontem'), null);
});

test('parseParcela', () => {
  assert.deepEqual(parseParcela('Parcela 3/10'), { atual: 3, total: 10 });
  assert.deepEqual(parseParcela('LOJA X - PARC 02/05'), { atual: 2, total: 5 });
  assert.deepEqual(parseParcela('Loja 1/3'), { atual: 1, total: 3 });
  assert.equal(parseParcela('Única'), null);
  assert.equal(parseParcela('Compra à vista'), null);
  assert.equal(parseParcela('1/1'), null);
});

test('dividirLinhaCSV respeita aspas', () => {
  assert.deepEqual(dividirLinhaCSV('"a;b";c;"d ""e"""', ';'), ['a;b', 'c', 'd "e"']);
});

test('CSV do Nubank (date,title,amount)', () => {
  const csv = [
    'date,title,amount',
    '2026-08-12,Supermercado Dia,152.30',
    '2026-08-14,Netflix.com,55.90',
    '2026-08-20,Magazine Luiza - Parcela 3/10,120.00',
    '2026-08-25,Pagamento recebido,-900.00',
  ].join('\n');
  const l = lerArquivo(csv, 'nubank.csv');
  assert.equal(l.length, 4);
  assert.deepEqual(l[2].parcela, { atual: 3, total: 10 });
  assert.equal(l[3].valor, -900);   // pagamento continua negativo
});

test('CSV do Inter (; e R$ com vírgula)', () => {
  const csv = [
    '"Data";"Lançamento";"Categoria";"Tipo";"Valor"',
    '"10/08/2026";"IFOOD *RESTAURANTE";"RESTAURANTES";"Compra à vista";"R$ 45,90"',
    '"11/08/2026";"LOJA X";"VESTUARIO";"Parcela 2/3";"R$ 1.100,00"',
  ].join('\r\n');
  const l = lerArquivo(csv);
  assert.equal(l[0].valor, 45.9);
  assert.equal(l[1].valor, 1100);
  assert.deepEqual(l[1].parcela, { atual: 2, total: 3 });
  assert.equal(l[0].catBanco, 'RESTAURANTES');
});

test('CSV do C6 (prefere "Valor (em R$)" e "Descrição")', () => {
  const csv = [
    'Data de Compra;Nome no Cartão;Final do Cartão;Categoria;Descrição;Parcela;Valor (em US$);Cotação (em R$);Valor (em R$)',
    '05/08/2026;ELLEN;1234;Supermercados;CARREFOUR;Única;0;0;230,45',
    '06/08/2026;ELLEN;1234;Departamento;AMAZON;1/4;0;0;99,90',
  ].join('\n');
  const l = lerArquivo(csv);
  assert.equal(l[0].desc, 'CARREFOUR');
  assert.equal(l[0].valor, 230.45);
  assert.equal(l[0].parcela, null);
  assert.deepEqual(l[1].parcela, { atual: 1, total: 4 });
});

test('OFX de cartão: compras negativas são invertidas', () => {
  const ofx = `OFXHEADER:100
<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260810000000[-3:BRT]<TRNAMT>-89.90<MEMO>DROGARIA SAO PAULO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260812<TRNAMT>-200.00<MEMO>POSTO SHELL 02/03</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260815<TRNAMT>500.00<MEMO>PAGAMENTO</STMTTRN>
</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>`;
  const l = lerArquivo(ofx, 'fatura.ofx');
  assert.equal(l.length, 3);
  assert.equal(l[0].valor, 89.9);
  assert.equal(l[2].valor, -500);
  assert.deepEqual(l[1].parcela, { atual: 2, total: 3 });
});

test('CSV sem colunas reconhecíveis dá erro claro', () => {
  assert.throws(() => lerArquivo('foo;bar\n1;2'), /colunas/);
});

test('decodificarArquivo: UTF-8 com BOM e Windows-1252', () => {
  const utf8 = new TextEncoder().encode('﻿Lançamento');
  assert.equal(decodificarArquivo(utf8), 'Lançamento');
  const cp1252 = new Uint8Array([0x4c, 0x61, 0x6e, 0xe7, 0x61]);   // "Lança" em Windows-1252
  assert.equal(decodificarArquivo(cp1252), 'Lança');
});

test('sugerirCategoria: histórico > palavra-chave > Outros', () => {
  const compras = [{ desc: 'Padaria do Zé', cat: 'Mercado' }];
  assert.equal(sugerirCategoria({ desc: 'PADARIA DO ZÉ' }, compras, CATEGORIAS), 'Mercado');        // histórico
  assert.equal(sugerirCategoria({ desc: 'IFOOD *PIZZA' }, [], CATEGORIAS), 'Alimentação');
  assert.equal(sugerirCategoria({ desc: 'NETFLIX.COM' }, [], CATEGORIAS), 'Assinaturas');
  assert.equal(sugerirCategoria({ desc: 'X', catBanco: 'Drogaria' }, [], CATEGORIAS), 'Saúde');     // categoria do banco
  assert.equal(sugerirCategoria({ desc: 'LOJA QUALQUER' }, [], CATEGORIAS), 'Outros');
});

test('prepararImportacao: parcelas, datas, ignorados e duplicadas', () => {
  const linhas = [
    { data: '2026-08-12', desc: 'Supermercado Dia', valor: 152.3, parcela: null },
    { data: '2026-08-12', desc: 'Supermercado Dia', valor: 152.3, parcela: null },   // 2 compras iguais no mesmo dia
    { data: '2026-04-20', desc: 'Magazine - Parcela 3/10', valor: 120, parcela: { atual: 3, total: 10 } },
    { data: '2026-08-25', desc: 'Pagamento', valor: -900, parcela: null },
    { data: '2026-08-14', desc: 'Netflix', valor: 55.9, parcela: null },
  ];
  const compras = [{ desc: 'NETFLIX', cat: 'Assinaturas', data: '2026-08-14', parcelas: 1, valorParcela: 55.9 }];
  const { itens, ignorados } = prepararImportacao(linhas, {
    faturaAlvo: '2026-09', fechamento: 10, compras, categorias: CATEGORIAS,
  });

  assert.equal(ignorados.length, 1);
  assert.equal(itens.length, 4);

  // compra à vista mantém a data real (já cai em 2026-09 com fechamento 10)
  assert.equal(itens[0].data, '2026-08-12');
  // compras repetidas DENTRO do arquivo são reais (ex.: dois cafés iguais): não são duplicadas
  assert.equal(itens[0].duplicada, false);
  assert.equal(itens[1].duplicada, false);
  assert.equal(itens[1].incluir, true);

  // parcela 3/10 → compra de 10x cuja 3ª parcela cai na fatura alvo
  const p = itens[2];
  assert.equal(p.desc, 'Magazine');
  assert.equal(p.parcelas, 10);
  assert.equal(fatKeyOf(p, 10), '2026-07');
  assert.equal(parcelaNaFatura(p, '2026-09', 10), 3);

  // Netflix já existe no app
  assert.equal(itens[3].duplicada, true);
  assert.equal(itens[3].cat, 'Assinaturas');
});

test('prepararImportacao ajusta a data quando o arquivo não bate com a fatura escolhida', () => {
  const { itens } = prepararImportacao(
    [{ data: '2026-08-12', desc: 'X', valor: 10, parcela: null }],
    { faturaAlvo: '2026-10', fechamento: 10, compras: [], categorias: CATEGORIAS });
  assert.equal(getFatKey(itens[0].data, 10), '2026-10');
});

test('duplicadas: reconhece compra lançada à mão com outro nome (valor + data / parcelas)', () => {
  const compras = [
    { desc: 'mercado do mês', cat: 'Mercado', data: '2026-08-13', parcelas: 1, valorParcela: 321.31 },   // 1 dia de diferença
    { desc: 'tênis', cat: 'Outros', data: '2026-02-02', parcelas: 10, valorParcela: 89.99 },           // 1ª parcela em fev
  ];
  const linhas = [
    { data: '2026-08-12', desc: 'Giassi Supermercados', valor: 321.31, parcela: null },
    { data: '2026-08-12', desc: 'Giassi Supermercados', valor: 321.31, parcela: null },   // a 2ª é nova
    { data: '2026-08-06', desc: 'Puma Sports - Parcela 8/10', valor: 89.99, parcela: { atual: 8, total: 10 } },
  ];
  const { itens } = prepararImportacao(linhas, { faturaAlvo: '2026-09', fechamento: 6, compras, categorias: CATEGORIAS });
  assert.deepEqual(itens.map(i => i.duplicada), [true, false, true]);
});

test('formato real do Nubank: vírgula decimal entre aspas e "- 203,85"', () => {
  const csv = [
    'date,title,amount',
    '2026-09-04,Giassi Supermercados,"59,46"',
    '2026-09-03,Pagamento recebido,"- 203,85"',
    '2026-08-10,Pagamento recebido,"- 8.083,96"',
    '2026-08-06,Porto Seguro Cia Seg G - Parcela 5/10,"150,21"',
    '2026-08-12,Mercadolivre*Minagua,"30,89"',
    '2026-08-06,Mercadolivre*Mercadol - Parcela 8/10,"84,90"',
    '2026-08-27,Ifd*Blumenau Gastronom,"67,22"',
  ].join('\n');
  const l = lerArquivo(csv, 'Nubank_2026-09-13.csv');
  assert.deepEqual(l.map(x => x.valor), [59.46, -203.85, -8083.96, 150.21, 30.89, 84.9, 67.22]);
  assert.equal(sugerirCategoria(l[0], [], CATEGORIAS), 'Mercado');
  assert.equal(sugerirCategoria(l[4], [], CATEGORIAS), 'Outros');        // Mercado Livre não é mercado
  assert.equal(sugerirCategoria(l[5], [], CATEGORIAS), 'Outros');
  assert.equal(sugerirCategoria(l[6], [], CATEGORIAS), 'Alimentação');   // iFood abreviado
});

test('sugerirFechamento pelo período das compras à vista', () => {
  const l = ['2026-08-06', '2026-08-15', '2026-08-22', '2026-08-30', '2026-09-04']
    .map(data => ({ data, valor: 10, parcela: null }));
  assert.equal(sugerirFechamento(l), 6);
  assert.equal(sugerirFechamento(l.slice(0, 2)), null);   // poucas compras
});

test('limparDesc', () => {
  assert.equal(limparDesc('LOJA X - Parcela 3/10'), 'LOJA X');
  assert.equal(limparDesc('POSTO SHELL 02/03'), 'POSTO SHELL');
  assert.equal(limparDesc('Mercado'), 'Mercado');
});

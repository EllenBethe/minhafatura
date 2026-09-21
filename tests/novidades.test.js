// Regras da usuária, reclassificação, estornos, desfazer importação e busca geral
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  regraDaUsuaria, sugerirCategoria, categoriaPorNome, reclassificacoes,
  ehPagamento, prepararImportacao, agruparImportacoes, lerArquivo,
} from '../js/importar.js';
import { casaBusca, buscarCompras, comprasDaFatura, resumoPorCategoria } from '../js/fatura.js';
import { modeloGrafico } from '../js/grafico.js';

const CATS = ['Supermercado', 'Gasolina', 'Compras', 'Pet', 'Vestuário', 'Outros'].map(name => ({ name }));
const REGRAS = [{ contem: 'shopee', cat: 'Compras' }, { contem: 'Petz', cat: 'Pet' }, { contem: 'x', cat: 'Inexistente' }];

test('regra da usuária: contém, sem acento/maiúscula, só categorias que existem', () => {
  const nomes = CATS.map(c => c.name);
  assert.equal(regraDaUsuaria('SHOPEE *Loja', REGRAS, nomes), 'Compras');
  assert.equal(regraDaUsuaria('petz digital', REGRAS, nomes), 'Pet');
  assert.equal(regraDaUsuaria('xis', REGRAS, nomes), null);          // categoria não existe
  assert.equal(regraDaUsuaria('Amazon', REGRAS, nomes), null);
  assert.equal(regraDaUsuaria('Loja', [{ contem: '  ', cat: 'Compras' }], nomes), null);   // regra vazia não casa tudo
});

test('regra da usuária vale acima das fixas e do histórico', () => {
  const regras = [{ contem: 'posto', cat: 'Outros' }];
  const historico = [{ desc: 'Shopee *A', cat: 'Vestuário' }];
  assert.equal(sugerirCategoria({ desc: 'Posto Shell' }, [], CATS, regras), 'Outros');
  assert.equal(sugerirCategoria({ desc: 'Shopee *A' }, historico, CATS, REGRAS), 'Compras');
  assert.equal(categoriaPorNome('shopee', [], CATS, REGRAS), 'Compras');
  assert.equal(sugerirCategoria({ desc: 'Posto Shell' }, [], CATS), 'Gasolina');   // sem regra: fixa
});

test('reclassificações: só regras da usuária e fixas; ignora o que já está certo', () => {
  const compras = [
    { id: '1', desc: 'Shopee *X', cat: 'Outros' },
    { id: '2', desc: 'Giassi Supermercados', cat: 'Mercado' },
    { id: '3', desc: 'Posto Almirante', cat: 'Gasolina' },          // já certo
    { id: '4', desc: 'IFOOD *Pizza', cat: 'Outros' },               // palavra-chave geral: não mexe
  ];
  const m = reclassificacoes(compras, CATS, REGRAS);
  assert.deepEqual(m.map(x => [x.id, x.para]), [['1', 'Compras'], ['2', 'Supermercado']]);
});

test('ehPagamento', () => {
  assert.ok(ehPagamento('Pagamento recebido'));
  assert.ok(ehPagamento('PGTO FATURA'));
  assert.ok(!ehPagamento('Estorno Renner'));
  assert.ok(!ehPagamento('Crédito de cashback'));
});

test('importação: estorno entra negativo com a categoria da loja; pagamento é ignorado', () => {
  const csv = [
    'date,title,amount',
    '2026-08-20,Renner,"199,90"',
    '2026-08-25,Estorno Renner,"- 49,90"',
    '2026-08-26,Pagamento recebido,"- 500,00"',
  ].join('\n');
  const linhas = lerArquivo(csv, 'nubank.csv');
  const { itens, ignorados } = prepararImportacao(linhas, {
    faturaAlvo: '2026-09', fechamento: 10, categorias: CATS, regras: [{ contem: 'renner', cat: 'Vestuário' }],
  });
  assert.equal(ignorados.length, 1);
  assert.equal(itens.length, 2);
  const est = itens[1];
  assert.equal(est.estorno, true);
  assert.equal(est.valorParcela, -49.9);
  assert.equal(est.parcelas, 1);
  assert.equal(est.cat, 'Vestuário');
  // o estorno abate a fatura
  const naFatura = comprasDaFatura(itens, '2026-09', 10);
  assert.equal(Object.values(resumoPorCategoria(naFatura)).reduce((a, b) => a + b, 0), 150);
});

test('agruparImportacoes: por lote, mais recente primeiro; antigas sem id num grupo à parte', () => {
  const compras = [
    { id: 'a', origem: 'importacao', importId: 'l1', importadoEm: '2026-09-01T10:00:00Z', importArquivo: 'ago.csv', valorParcela: 10 },
    { id: 'b', origem: 'importacao', importId: 'l2', importadoEm: '2026-09-20T10:00:00Z', importArquivo: 'set.csv', valorParcela: 5 },
    { id: 'c', origem: 'importacao', importId: 'l2', importadoEm: '2026-09-20T10:00:00Z', importArquivo: 'set.csv', valorParcela: -2 },
    { id: 'd', origem: 'importacao', valorParcela: 7 },                 // antes do controle de lotes
    { id: 'e', valorParcela: 99 },                                      // lançada à mão
  ];
  const g = agruparImportacoes(compras);
  assert.deepEqual(g.map(x => x.id), ['l2', 'l1', '']);
  assert.deepEqual(g[0].ids, ['b', 'c']);
  assert.equal(g[0].total, 3);
  assert.equal(g[0].arquivo, 'set.csv');
});

test('busca: sem acento, por nome ou categoria, em todas as faturas', () => {
  const compras = [
    { desc: 'Farmácia São João', cat: 'Saúde', data: '2026-05-01', parcelas: 1, valorParcela: 30 },
    { desc: 'Porto Seguro', cat: 'Seguro Carro', data: '2026-02-10', parcelas: 10, valorParcela: 150.21 },
    { desc: 'Porto Seguro', cat: 'Seguro Carro', data: '2026-08-10', parcelas: 1, valorParcela: 26.97 },
  ];
  assert.ok(casaBusca(compras[0], 'farmacia'));
  assert.ok(casaBusca(compras[0], 'SAUDE'));
  assert.ok(casaBusca(compras[0], ''));
  const { achadas, total } = buscarCompras(compras, 'porto seguro');
  assert.deepEqual(achadas.map(c => c.data), ['2026-08-10', '2026-02-10']);   // mais recente primeiro
  assert.equal(total, 1529.07);                                            // 10 × 150,21 + 26,97
});

test('gráfico: categoria com saldo negativo no mês não desenha abaixo de zero', () => {
  const compras = [
    { cat: 'A', data: '2026-09-01', parcelas: 1, valorParcela: 100 },
    { cat: 'B', data: '2026-09-01', parcelas: 1, valorParcela: -30 },   // só estorno
  ];
  const m = modeloGrafico(compras, 10, '2026-09', { antes: 0, depois: 0 });
  assert.ok(m.series.every(s => s.valores.every(v => v >= 0)));
});

test('textoParaRegra: marca da loja, pulando prefixos de maquininha', async () => {
  const { textoParaRegra } = await import('../js/importar.js');
  const casos = {
    'Shopee *Babylovecalcad': 'shopee',
    'Shopee*F N F Comercio': 'shopee',
    'Ec *Shellbox': 'shellbox',
    'Zp *Correa Materiais e - Parcela 1/8': 'correa materiais',
    'Ifd*Blumenau Gastronom': 'ifd*',
    'Mercadolivre*Minagua': 'mercadolivre',
    'Giassi Supermercados': 'giassi supermercados',
    'Casa do Strudel': 'casa do strudel',
    'Amazon - Parcela 3/7': 'amazon',
    'Renner': 'renner',
    'Zero3games *Z07873413 - Parcela 1/6': 'zero3games',
    'Pg *Arco - Lne - Parcela 8/10': 'arco',
  };
  for (const [desc, esperado] of Object.entries(casos)) assert.equal(textoParaRegra(desc), esperado, desc);
});

test('a regra sugerida casa com a própria compra', async () => {
  const { textoParaRegra, regraDaUsuaria } = await import('../js/importar.js');
  for (const desc of ['Shopee *Loja', 'Ec *Shellbox', 'Casa do Strudel', 'Ifd*Pizzaria', 'Zp *Correa Materiais e']) {
    assert.equal(regraDaUsuaria(desc, [{ contem: textoParaRegra(desc), cat: 'X' }], ['X']), 'X', desc);
  }
});

test('compararComAnterior: diferença e % por categoria', async () => {
  const { compararComAnterior } = await import('../js/fatura.js');
  const r = compararComAnterior({ Mercado: 590, Gasolina: 300, Pet: 50 }, { Mercado: 500, Gasolina: 400 });
  assert.deepEqual(r.Mercado, { anterior: 500, dif: 90, pct: 18 });
  assert.deepEqual(r.Gasolina, { anterior: 400, dif: -100, pct: -25 });
  assert.deepEqual(r.Pet, { anterior: 0, dif: 50, pct: null });
});

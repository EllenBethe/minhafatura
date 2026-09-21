import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ICONES, CHAVES_DAS_REGRAS, iconePorNome, iconeDe, svgIcone } from '../js/icones.js';

test('toda regra aponta para um ícone existente', () => {
  assert.deepEqual(CHAVES_DAS_REGRAS.filter(k => !ICONES[k]), []);
  assert.ok(ICONES.tag && ICONES.package);
});

test('categorias padrão e as criadas pela usuária recebem ícones coerentes', () => {
  const esperado = {
    'Supermercado': 'shopping-cart', 'Mercado': 'shopping-cart', 'Gasolina': 'fuel',
    'Assinaturas': 'tv', 'Seguro Carro': 'shield-check', 'Seguro Casa': 'shield-check',
    'Conjunto/Casa': 'building-2', 'Manutenção do Carro': 'wrench', 'Alimentação': 'utensils-crossed',
    'Vestuário': 'shirt', 'Lazer': 'gamepad-2', 'Saúde': 'heart-pulse', 'Outros': 'package',
    'Farmácia': 'pill', 'Plano de Saúde': 'heart-pulse', 'Pet': 'paw-print', 'Escola': 'graduation-cap',
    'Celular': 'smartphone', 'Luz': 'zap', 'Água': 'droplets', 'Viagem': 'plane', 'Presentes': 'gift',
  };
  for (const [nome, icone] of Object.entries(esperado)) assert.equal(iconePorNome(nome), icone, nome);
  assert.equal(iconePorNome('Fulano'), 'tag');   // sem regra → genérico
});

test('iconeDe respeita a escolha manual e ignora chave inválida', () => {
  assert.equal(iconeDe({ name: 'Ellen', icone: 'user' }), 'user');
  assert.equal(iconeDe({ name: 'Mercado', icone: 'nao-existe' }), 'shopping-cart');
  assert.equal(iconeDe({ name: 'Mercado' }), 'shopping-cart');
});

test('svgIcone gera um SVG de traço acessível (decorativo)', () => {
  const svg = svgIcone('fuel', 'ic x');
  assert.match(svg, /^<svg class="ic x" viewBox="0 0 24 24"[^>]*aria-hidden="true">/);
  assert.match(svg, /<path d="/);
  assert.ok(svg.endsWith('</svg>'));
  assert.equal(svgIcone('nao-existe'), svgIcone('tag'));
});

test('cores: automática pelo ícone, manual respeitada, chave inválida ignorada', async () => {
  const { CORES, corDe, corDoIcone, chipCategoria } = await import('../js/icones.js');
  assert.equal(corDe({ name: 'Supermercado' }), 'verde');
  assert.equal(corDe({ name: 'Gasolina' }), 'laranja');
  assert.equal(corDe({ name: 'Ellen', icone: 'user' }), 'azul');
  assert.equal(corDe({ name: 'Supermercado', cor: 'roxo' }), 'roxo');
  assert.equal(corDe({ name: 'Supermercado', cor: 'nao-existe' }), 'verde');
  for (const k of Object.keys(ICONES)) assert.ok(CORES[corDoIcone(k)], `ícone ${k} sem cor`);
  assert.match(chipCategoria({ name: 'Gasolina' }), /style="--cor:#d9622b"/);
});

test('cores dos quadradinhos têm contraste ≥ 3:1 com o ícone branco', async () => {
  const { CORES } = await import('../js/icones.js');
  const lum = h => {
    const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
      .map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  for (const [k, [, hex]] of Object.entries(CORES)) {
    assert.ok(1.05 / (lum(hex) + 0.05) >= 3, `${k} ${hex}`);
  }
});

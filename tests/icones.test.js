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

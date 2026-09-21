// ============================================================
//  MinhaFatura — app.js (telas + Firebase)
//  A lógica pura fica em js/*.js e é testada com `npm test`.
//
//  Eventos: o HTML NÃO chama funções direto (onclick=...). Elementos
//  declaram data-action / data-change / data-input com o nome de uma
//  entrada de ACOES, e um único ouvinte por tipo de evento despacha.
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import {
  MONTHS, hojeISO, addMonths, getFatKey, fatKeyOf, getEndFatKey, parcelaNaFatura,
  fatLabel, fatLabelFull, faturasAtivas, comprasDaFatura, resumoPorCategoria, fmt, esc, arred,
} from './js/fatura.js?v=8';
import { decodificarArquivo, lerArquivo, prepararImportacao, sugerirFechamento, categoriaPorNome } from './js/importar.js?v=8';
import { csvCompras, csvLancamentos } from './js/exportar.js?v=8';
import { modeloGrafico, svgGrafico } from './js/grafico.js?v=8';
import { ICONES, CORES, iconeDe, iconePorNome, corDe, corDoIcone, chip, chipCategoria } from './js/icones.js?v=8';

// ============================================================
//  FIREBASE
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBfBYLYXucNBlB_lN1SEBHvG7H8mspAE0E",
  authDomain: "minhafatura.firebaseapp.com",
  projectId: "minhafatura",
  storageBucket: "minhafatura.firebasestorage.app",
  messagingSenderId: "773668320405",
  appId: "1:773668320405:web:f5d8d9a3b859cc2712979c"
};

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
// Cache local: o app abre e aceita lançamentos offline, sincronizando ao voltar a conexão
const db    = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ============================================================
//  ESTADO LOCAL
// ============================================================
let currentUser  = null;
let unsubCompras = null;

const S = {
  fechamento: 10,
  categorias: [],
  compras:    [],
  faturaAtiva: null,
  grafSel: null,     // fatura selecionada no gráfico
  imp: null,         // importação em andamento: { linhas, itens, ignorados, nome }
  catEscolhidaForm: false,   // categoria do formulário escolhida à mão (para de sugerir)
  iconeCat: null,            // índice da categoria com o seletor de ícone aberto
};

const DEFAULT_CATEGORIAS = [
  { name: 'Assinaturas' },
  { name: 'Seguro Carro' },
  { name: 'Seguro Casa' },
  { name: 'Conjunto/Casa' },
  { name: 'Manutenção do Carro' },
  { name: 'Alimentação' },
  { name: 'Mercado' },
  { name: 'Vestuário' },
  { name: 'Lazer' },
  { name: 'Saúde' },
  { name: 'Outros' },
];

const $ = id => document.getElementById(id);
const faturaAberta = () => getFatKey(hojeISO(), S.fechamento);
// Quadradinho colorido com o ícone da categoria (escolhidos em Config ou automáticos pelo nome)
const chipDe = (nome, classe) => chipCategoria(S.categorias.find(c => c.name === nome) || { name: nome }, classe);
const maiuscula = s => s.charAt(0).toUpperCase() + s.slice(1);

// ============================================================
//  HELPERS
// ============================================================
function showLoading() { $('loading').style.display = 'flex'; }
function hideLoading() { $('loading').style.display = 'none'; }
function showErr(elId, msg, ok = false) {
  const el = $(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('ok', ok);
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
// Offline, as escritas do Firestore só resolvem quando a conexão volta:
// nesse caso não esperamos (o cache local já reflete a mudança) e só avisamos se falhar
function gravar(promise) {
  if (navigator.onLine) return promise;
  promise.catch(e => alert('Erro ao sincronizar: ' + e.message));
  return Promise.resolve();
}

// ============================================================
//  FIRESTORE
// ============================================================
const comprasRef = () => collection(db, 'users', currentUser.uid, 'compras');

async function loadUserConfig() {
  const ref  = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    S.fechamento = d.fechamento ?? 10;
    S.categorias = d.categorias ?? DEFAULT_CATEGORIAS.map(c => ({ ...c }));
  } else {
    S.fechamento = 10;
    S.categorias = DEFAULT_CATEGORIAS.map(c => ({ ...c }));
    await saveUserConfig();
  }
}

async function saveUserConfig() {
  const ref = doc(db, 'users', currentUser.uid);
  await gravar(setDoc(ref, { fechamento: S.fechamento, categorias: S.categorias }, { merge: true }));
}

function listenCompras() {
  if (unsubCompras) unsubCompras();
  unsubCompras = onSnapshot(query(comprasRef(), orderBy('data', 'desc')), (snap) => {
    S.compras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
    renderGrafico();
  }, (e) => {
    console.error(e);
    alert('Erro ao carregar compras: ' + e.message);
  });
}

// Grava muitas compras de uma vez (writeBatch aceita até 500 operações)
async function adicionarEmLote(payloads) {
  for (let k = 0; k < payloads.length; k += 500) {
    const batch = writeBatch(db);
    payloads.slice(k, k + 500).forEach(p => batch.set(doc(comprasRef()), p));
    await gravar(batch.commit());
  }
}

// ============================================================
//  AUTH
// ============================================================
function traduzirErroAuth(code) {
  const msgs = {
    'auth/user-not-found':       'Usuário não encontrado.',
    'auth/wrong-password':       'Senha incorreta.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/invalid-email':        'E-mail inválido.',
    'auth/weak-password':        'Senha muito fraca (mínimo 6 caracteres).',
    'auth/too-many-requests':    'Muitas tentativas. Tente mais tarde.',
    'auth/invalid-credential':   'E-mail ou senha incorretos.',
  };
  return msgs[code] || 'Erro: ' + code;
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    showLoading();
    try {
      await loadUserConfig();
    } catch (e) {
      hideLoading();
      alert('Erro ao carregar sua conta: ' + e.message);
      return;
    }
    listenCompras();
    $('av').textContent     = user.email.split('@')[0].slice(0, 2).toUpperCase();
    $('s-user').textContent = user.email;
    hideLoading();
    $('bnav').style.display = 'flex';
    $('s-fech').value = S.fechamento;
    buildCatSelect();
    ACOES.goHome();
  } else {
    currentUser = null;
    S.compras   = [];
    show('scr-login');
    $('bnav').style.display = 'none';
    hideLoading();
  }
});

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(id).classList.add('active');
}
function setNav(id) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.id === id));
}

// ============================================================
//  HOME — fatura
// ============================================================
function buildFatNav(keys) {
  const nav = $('fat-nav');
  nav.innerHTML = keys.map(k =>
    `<button type="button" class="fat-chip ${k === S.faturaAtiva ? 'active' : ''}" data-action="selFat" data-key="${k}"
       aria-pressed="${k === S.faturaAtiva}" aria-label="Fatura de ${fatLabelFull(k)}">${fatLabel(k)}</button>`
  ).join('');
  setTimeout(() => {
    nav.querySelector('.fat-chip.active')?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, 50);
}

function buildFatFilter(keys) {
  $('fil-fatura').innerHTML = keys.map(k =>
    `<option value="${k}" ${k === S.faturaAtiva ? 'selected' : ''}>${fatLabelFull(k)}</option>`
  ).join('');
}

// Categorias cadastradas + nomes antigos ainda usados por compras; preserva a seleção
function buildCatFilter() {
  const sel = $('fil-cat');
  const atual = sel.value;
  const nomes = S.categorias.map(c => c.name);
  S.compras.forEach(c => { if (c.cat && !nomes.includes(c.cat)) nomes.push(c.cat); });
  if (atual && !nomes.includes(atual)) nomes.push(atual);
  sel.innerHTML = '<option value="">Todas as categorias</option>' +
    nomes.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
  sel.value = atual;
}

function renderHome() {
  if (!$('scr-home').classList.contains('active')) return;
  const keys = faturasAtivas(S.compras, S.fechamento);
  if (!S.faturaAtiva || !keys.includes(S.faturaAtiva)) {
    const cur = faturaAberta();
    S.faturaAtiva = keys.includes(cur) ? cur : keys[0];
  }
  buildFatNav(keys);
  buildFatFilter(keys);
  buildCatFilter();

  const fat = S.faturaAtiva;
  const [fy, fm] = fat.split('-');
  $('fat-label').textContent    = `Fatura de ${MONTHS[parseInt(fm) - 1]} de ${fy}`;
  $('fat-sub-info').textContent = `Fecha no dia ${S.fechamento}`;

  const search = $('search').value.toLowerCase();
  const filCat = $('fil-cat').value;
  let compras  = comprasDaFatura(S.compras, fat, S.fechamento);

  // Resumo por categoria (sem filtros: mostra sempre a fatura inteira)
  const catMap  = resumoPorCategoria(compras);
  const catKeys = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]);
  $('cat-resumo').innerHTML = catKeys.length === 0
    ? '<div class="cat-resumo-vazio">Sem lançamentos</div>'
    : catKeys.map(k => `<button type="button" class="cat-resumo-row ${k === filCat ? 'active' : ''}" data-action="filtrarCat"
        data-cat="${esc(k)}" aria-pressed="${k === filCat}">
        <span>${chipDe(k, 'chip-resumo')}${esc(k)}</span><b>R$ ${fmt(catMap[k])}</b></button>`).join('');

  const total = arred(Object.values(catMap).reduce((a, b) => a + b, 0));
  $('fat-total').textContent = `R$ ${fmt(total)}`;
  $('fat-count').textContent = `${compras.length} lançamento${compras.length !== 1 ? 's' : ''}`;

  // Filtros de categoria e busca (afetam só a lista)
  if (filCat) compras = compras.filter(c => c.cat === filCat);
  if (search) compras = compras.filter(c =>
    c.desc?.toLowerCase().includes(search) || c.cat?.toLowerCase().includes(search));

  const soma = compras.reduce((a, c) => a + c.valorParcela, 0);
  $('sec-title').textContent = filCat ? `${filCat} · R$ ${fmt(soma)}` : 'compras da fatura';

  const list = $('compras-list');
  if (compras.length === 0) {
    list.innerHTML = `<div class="empty">${filCat || search ? 'Nenhuma compra com esse filtro' : 'Nenhuma compra nesta fatura'}</div>`;
    return;
  }

  list.innerHTML = compras.map(c => {
    const parAtual = parcelaNaFatura(c, fat, S.fechamento);
    const endKey   = getEndFatKey(fatKeyOf(c, S.fechamento), c.parcelas);
    const parLabel = c.parcelas > 1 ? `Parcela ${parAtual} de ${c.parcelas}` : 'À vista';
    const finLabel = c.parcelas > 1 ? `Finaliza: ${fatLabelFull(endKey)}` : '';
    const pct      = c.parcelas > 1 ? Math.min(100, Math.round((parAtual / c.parcelas) * 100)) : 100;

    return `<div class="compra-card">
      <div class="cc-top">
        <div class="cc-head">
          ${chipDe(c.cat)}
          <div class="cc-tit">
            <div class="cc-nome">${esc(c.desc)}</div>
            <div class="cc-cat">${esc(c.cat)}</div>
          </div>
        </div>
        <div class="cc-actions">
          <button type="button" class="cc-act-btn" data-action="editCompra" data-id="${esc(c.id)}" aria-label="Editar">✏️</button>
          <button type="button" class="cc-act-btn" data-action="confirmDelete" data-id="${esc(c.id)}" aria-label="Remover">🗑️</button>
        </div>
      </div>
      <div class="cc-mid">
        <div class="cc-meta">
          <div class="cc-parcela-txt">${parLabel}</div>
          ${finLabel ? `<div class="cc-finaliza">${finLabel}</div>` : ''}
        </div>
        <div class="cc-valor">R$ ${fmt(c.valorParcela)}</div>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

// ============================================================
//  FORM — adicionar / editar
// ============================================================
function buildCatSelect() {
  $('f-cat').innerHTML = S.categorias.map(c =>
    `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
}

function openAddForm(compra) {
  buildCatSelect();
  $('edit-id').value          = compra?.id || '';
  $('form-title').textContent = compra ? 'Editar compra' : 'Nova compra';
  $('f-desc').value           = compra?.desc || '';
  $('f-cat').value            = compra?.cat  || S.categorias[0]?.name || '';
  $('f-data').value           = compra?.data || hojeISO();
  $('f-parc').value           = compra?.parcelas || 1;
  $('f-tipo-val').value       = 'parcela';
  $('f-val').value            = compra?.valorParcela || '';
  // Em compra nova, a categoria acompanha o nome digitado até ser escolhida à mão
  S.catEscolhidaForm = !!compra;
  ACOES.updateValorHint();
}

// Converte o valor digitado em valor da parcela (arredondado em centavos)
function lerValorParcela() {
  const parcelas = Math.max(1, parseInt($('f-parc').value) || 1);
  const valor    = parseFloat($('f-val').value);
  if (!valor || valor <= 0) return null;
  const parcela  = $('f-tipo-val').value === 'total' ? valor / parcelas : valor;
  return { parcelas, valorParcela: arred(parcela) };
}

// ============================================================
//  CONFIGURAÇÕES — categorias
// ============================================================
function buildCatList() {
  $('cat-list-s').innerHTML = S.categorias.map((c, i) => `
    <div class="resp-item">
      <button type="button" class="chip-btn" data-action="abrirIcones" data-i="${i}" aria-label="Trocar ícone e cor de ${esc(c.name)}">${chipCategoria(c)}</button>
      <input class="resp-name-inp" value="${esc(c.name)}" data-change="renameCat" data-i="${i}" aria-label="Nome da categoria" />
      <button type="button" class="btn-del" data-action="removeCat" data-i="${i}" aria-label="Remover categoria">✕</button>
    </div>`).join('');
}

// ============================================================
//  GRÁFICOS
// ============================================================
function renderGrafico() {
  if (!$('scr-graf').classList.contains('active')) return;
  const aberta = faturaAberta();
  const modelo = modeloGrafico(S.compras, S.fechamento, aberta);
  if (!S.grafSel || !modelo.keys.includes(S.grafSel)) S.grafSel = aberta;

  const iA = modelo.keys.indexOf(aberta);
  const passadas = modelo.totais.slice(0, iA).filter(v => v > 0);
  const media = passadas.length ? passadas.reduce((a, b) => a + b, 0) / passadas.length : 0;
  const futuro = modelo.totais.slice(iA + 1).reduce((a, b) => a + b, 0);
  $('graf-kpis').innerHTML = `
    <div class="kpi"><div class="kpi-lbl">Fatura aberta</div><div class="kpi-val">R$ ${fmt(modelo.totais[iA])}</div></div>
    <div class="kpi"><div class="kpi-lbl">Já comprometido<br>próximas 6</div><div class="kpi-val">R$ ${fmt(futuro)}</div></div>
    <div class="kpi"><div class="kpi-lbl">Média das<br>anteriores</div><div class="kpi-val">R$ ${fmt(media)}</div></div>`;

  $('graf-legenda').innerHTML = modelo.series.length
    ? modelo.series.map(s => `<span class="leg-item"><i style="background:${s.cor}"></i>${esc(s.nome)}</span>`).join('')
    : '';
  $('graf-svg').innerHTML = modelo.series.length
    ? svgGrafico(modelo, { selecionada: S.grafSel })
    : '<div class="empty">Nenhuma compra nesse período</div>';

  // Detalhe da fatura selecionada (toque numa barra para trocar)
  const i = modelo.keys.indexOf(S.grafSel);
  const tipo = i < iA ? 'fechada' : i === iA ? 'aberta' : 'futura — só parcelas já lançadas';
  const linhas = modelo.series.filter(s => s.valores[i] > 0)
    .sort((a, b) => b.valores[i] - a.valores[i])
    .map(s => `<div class="det-row"><span><i style="background:${s.cor}"></i>${esc(s.nome)}${s.agrupa ? ` <small>(${esc(s.agrupa.join(', '))})</small>` : ''}</span><b>R$ ${fmt(s.valores[i])}</b></div>`)
    .join('');
  $('graf-det').innerHTML = `
    <div class="det-top">
      <div><div class="det-tit">${esc(maiuscula(fatLabelFull(S.grafSel)))}</div><div class="det-sub">${tipo}</div></div>
      <div class="det-total">R$ ${fmt(modelo.totais[i])}</div>
    </div>
    ${linhas || '<div class="det-sub">Sem lançamentos</div>'}
    <button type="button" class="btn-outline btn-slim" data-action="grafVerFatura">Ver compras desta fatura</button>`;

  $('graf-tabela').innerHTML = `<table><thead><tr><th>Fatura</th><th>Situação</th><th>Total</th></tr></thead><tbody>${
    modelo.keys.map((k, j) => `<tr${k === S.grafSel ? ' class="sel"' : ''}><td>${esc(fatLabel(k))}</td>
      <td>${j < iA ? 'fechada' : j === iA ? 'aberta' : 'futura'}</td><td>R$ ${fmt(modelo.totais[j])}</td></tr>`).join('')
  }</tbody></table>`;
}

// ============================================================
//  EXPORTAR
// ============================================================
async function compartilharArquivo(nome, conteudo) {
  const file = new File([conteudo], nome, { type: 'text/csv' });
  // iPhone (PWA): abre a folha de compartilhamento (Salvar em Arquivos, AirDrop, e-mail...)
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: nome }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================
//  IMPORTAR
// ============================================================
// Fatura mais provável do arquivo: a mais comum entre as compras à vista
function faturaProvavel(linhas) {
  const conta = {};
  linhas.filter(l => l.valor > 0 && !l.parcela).forEach(l => {
    const k = getFatKey(l.data, S.fechamento);
    conta[k] = (conta[k] || 0) + 1;
  });
  return Object.keys(conta).sort((a, b) => conta[b] - conta[a])[0] || faturaAberta();
}

function renderImport() {
  const aberta = faturaAberta();
  const sel = $('imp-fatura');
  const atual = sel.value || (S.imp ? faturaProvavel(S.imp.linhas) : aberta);
  const keys = [];
  for (let i = -12; i <= 2; i++) keys.push(addMonths(aberta, i));
  if (!keys.includes(atual)) keys.push(atual);
  sel.innerHTML = keys.sort().reverse().map(k =>
    `<option value="${k}">${fatLabelFull(k)}${k === aberta ? ' (aberta)' : ''}</option>`).join('');
  sel.value = atual;

  const lista = $('imp-lista'), resumo = $('imp-resumo'), btn = $('imp-confirmar');
  if (!S.imp?.itens) {
    lista.innerHTML = ''; resumo.textContent = ''; btn.style.display = 'none';
    return;
  }
  const { itens, ignorados } = S.imp;
  const marcados = itens.filter(it => it.incluir);
  const dup = itens.filter(it => it.duplicada).length;
  const soma = marcados.reduce((a, it) => a + it.valorParcela, 0);
  // Compras à vista do arquivo que, pelo dia de fechamento configurado, cairiam em outra fatura
  const alvo = sel.value;
  const foraDaFatura = S.imp.linhas.filter(l => l.valor > 0 && !l.parcela && getFatKey(l.data, S.fechamento) !== alvo).length;
  const sugerido = sugerirFechamento(S.imp.linhas);
  const aviso = foraDaFatura && sugerido && sugerido !== S.fechamento
    ? `<div class="imp-aviso">⚠️ Pelas datas do arquivo, sua fatura parece fechar no <b>dia ${sugerido}</b>, mas o app está
        configurado para o <b>dia ${S.fechamento}</b>. ${foraDaFatura} compra(s) teriam a data ajustada para caber nesta fatura.
        <button type="button" class="btn-outline btn-slim" data-action="impUsarFechamento" data-dia="${sugerido}">Usar dia ${sugerido} como fechamento</button></div>`
    : '';
  resumo.innerHTML = aviso + `<b>${itens.length}</b> compra(s) no arquivo` +
    (dup ? ` · <b>${dup}</b> parece(m) já lançada(s) no app (desmarcada)` : '') +
    (ignorados.length ? ` · <b>${ignorados.length}</b> pagamento(s)/crédito(s) ignorado(s)` : '') +
    `<br>Selecionadas: <b>${marcados.length}</b> · R$ ${fmt(soma)} nesta fatura`;

  const opcoes = cat => S.categorias.map(c =>
    `<option value="${esc(c.name)}" ${c.name === cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  lista.innerHTML = itens.map((it, i) => `
    <div class="imp-item${it.incluir ? '' : ' off'}">
      <label class="imp-check"><input type="checkbox" ${it.incluir ? 'checked' : ''} data-change="impToggle" data-i="${i}" aria-label="Importar ${esc(it.desc)}" /></label>
      <div class="imp-info">
        <div class="imp-desc">${esc(it.desc)}</div>
        <div class="imp-meta">${it.dataArquivo.split('-').reverse().join('/')}${it.parcelas > 1 ? ` · parcela ${it.parcelaAtual}/${it.parcelas} · 1ª em ${fatLabel(it.inicio).toLowerCase()}` : ''}${it.duplicada ? ' · <span class="imp-dup">parece já lançada</span>' : ''}</div>
        <select class="imp-cat" data-change="impCat" data-i="${i}" aria-label="Categoria">${opcoes(it.cat)}</select>
      </div>
      <div class="imp-valor">R$ ${fmt(it.valorParcela)}</div>
    </div>`).join('');
  btn.style.display = marcados.length ? 'block' : 'none';
  btn.textContent = `Importar ${marcados.length} compra${marcados.length !== 1 ? 's' : ''}`;
}

function recalcularImport() {
  if (!S.imp) return;
  // Preserva escolhas manuais (categoria / marcação) ao trocar a fatura alvo
  const antes = S.imp.itens;
  const r = prepararImportacao(S.imp.linhas, {
    faturaAlvo: $('imp-fatura').value, fechamento: S.fechamento,
    compras: S.compras, categorias: S.categorias,
  });
  if (antes?.length === r.itens.length) {
    r.itens.forEach((it, i) => {
      if (antes[i].catManual) { it.cat = antes[i].cat; it.catManual = true; }
      if (antes[i].incluirManual !== undefined && !it.duplicada) it.incluir = antes[i].incluirManual;
    });
  }
  S.imp.itens = r.itens;
  S.imp.ignorados = r.ignorados;
  renderImport();
}

// Seletor de ícone e cor da categoria S.iconeCat
function renderSeletorIcone() {
  const cat = S.categorias[S.iconeCat];
  const iconeAtual = cat.icone && ICONES[cat.icone] ? cat.icone : '';
  const corAtual = cat.cor && CORES[cat.cor] ? cat.cor : '';
  const cor = corDe(cat);
  $('ip-tit').innerHTML = `${chipCategoria(cat, 'chip-grande')}<span>${esc(cat.name)}</span>`;
  $('ip-cores').innerHTML =
    `<button type="button" class="cor-item auto${corAtual ? '' : ' sel'}" data-action="escolherCor" data-cor=""
       aria-pressed="${!corAtual}" aria-label="Cor automática" style="--cor:${CORES[corDoIcone(iconeDe(cat))][1]}">A</button>` +
    Object.entries(CORES).map(([k, [nome, hex]]) =>
      `<button type="button" class="cor-item${k === corAtual ? ' sel' : ''}" data-action="escolherCor" data-cor="${k}"
         aria-pressed="${k === corAtual}" aria-label="${nome}" style="--cor:${hex}"></button>`).join('');
  $('ip-grid').innerHTML =
    `<button type="button" class="ip-item${iconeAtual ? '' : ' sel'}" data-action="escolherIcone" data-key="" aria-pressed="${!iconeAtual}">
       ${chip(iconePorNome(cat.name), cor)}<span>Automático</span></button>` +
    Object.entries(ICONES).map(([k, [rotulo]]) =>
      `<button type="button" class="ip-item${k === iconeAtual ? ' sel' : ''}" data-action="escolherIcone" data-key="${k}" aria-pressed="${k === iconeAtual}">
         ${chip(k, cor)}<span>${esc(rotulo)}</span></button>`).join('');
}

// ============================================================
//  AÇÕES (despachadas por data-action / data-change / data-input)
// ============================================================
const ACOES = {
  // --- auth ---
  async doLogin() {
    const email = $('l-email').value.trim(), pass = $('l-pass').value;
    if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
    showLoading();
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch (e) { hideLoading(); showErr('login-error', traduzirErroAuth(e.code)); }
  },
  async doRegister() {
    const email = $('l-email').value.trim(), pass = $('l-pass').value;
    if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
    if (pass.length < 6) return showErr('login-error', 'Senha mínima: 6 caracteres.');
    showLoading();
    try { await createUserWithEmailAndPassword(auth, email, pass); }
    catch (e) { hideLoading(); showErr('login-error', traduzirErroAuth(e.code)); }
  },
  async doReset() {
    const email = $('l-email').value.trim();
    if (!email) return showErr('login-error', 'Digite seu e-mail para redefinir a senha.');
    try { await sendPasswordResetEmail(auth, email); showErr('login-error', '✅ E-mail enviado!', true); }
    catch (e) { showErr('login-error', traduzirErroAuth(e.code)); }
  },
  async doLogout() {
    if (unsubCompras) unsubCompras();
    await signOut(auth);
  },

  // --- navegação ---
  goHome() { show('scr-home'); setNav('nb-home'); renderHome(); },
  goAdd()  { openAddForm(null); show('scr-form'); setNav('nb-add'); },
  goGraf() { show('scr-graf'); setNav('nb-graf'); renderGrafico(); },
  goSett() {
    show('scr-sett'); setNav('nb-sett');
    $('s-user').textContent = currentUser?.email || '-';
    $('s-fech').value = S.fechamento;
    buildCatList();
    ACOES.previewIconeNovo();
  },
  goImport() {
    S.imp = null;
    $('imp-arquivo').value = '';
    $('imp-fatura').value = '';
    show('scr-import'); setNav('nb-sett');
    renderImport();
  },

  // --- home ---
  selFat(el) { S.faturaAtiva = el.dataset.key; renderHome(); },
  onFatFilterChange(el) { S.faturaAtiva = el.value; renderHome(); },
  renderHome() { renderHome(); },
  filtrarCat(el) {
    const sel = $('fil-cat');
    sel.value = sel.value === el.dataset.cat ? '' : el.dataset.cat;
    renderHome();
  },
  editCompra(el) {
    const c = S.compras.find(x => x.id === el.dataset.id);
    if (!c) return;
    openAddForm(c); show('scr-form'); setNav('nb-add');
  },
  async confirmDelete(el) {
    if (!confirm('Remover esta compra?')) return;
    showLoading();
    try { await gravar(deleteDoc(doc(comprasRef(), el.dataset.id))); }
    catch (e) { alert('Erro ao remover: ' + e.message); }
    hideLoading();
  },

  // --- formulário ---
  sugerirCatForm(input) {
    if (S.catEscolhidaForm) return;
    const cat = categoriaPorNome(input.value, S.compras, S.categorias);
    if (cat) $('f-cat').value = cat;
  },
  catEscolhidaForm() { S.catEscolhidaForm = true; },
  updateValorHint() {
    const hint = $('f-val-hint'), v = lerValorParcela();
    hint.textContent = !v ? '' : v.parcelas > 1
      ? `${v.parcelas}x de R$ ${fmt(v.valorParcela)} = R$ ${fmt(v.valorParcela * v.parcelas)}`
      : `À vista: R$ ${fmt(v.valorParcela)}`;
  },
  async saveCompra() {
    const desc = $('f-desc').value.trim(), cat = $('f-cat').value, data = $('f-data').value;
    const valor = lerValorParcela();
    if (!desc)  return showErr('form-error', 'Preencha a descrição.');
    if (!data)  return showErr('form-error', 'Escolha a data.');
    if (!valor) return showErr('form-error', 'Informe o valor.');
    const payload = { desc, cat, data, ...valor };
    showLoading();
    try {
      const editId = $('edit-id').value;
      if (editId) await gravar(updateDoc(doc(comprasRef(), editId), payload));
      else        await gravar(addDoc(comprasRef(), payload));
      S.faturaAtiva = getFatKey(data, S.fechamento);
      ACOES.goHome();
    } catch (e) {
      showErr('form-error', 'Erro ao salvar: ' + e.message);
    }
    hideLoading();
  },

  // --- configurações ---
  async saveFech(el) {
    const v = parseInt(el.value);
    if (v >= 1 && v <= 31) { S.fechamento = v; await saveUserConfig(); }
  },
  // Renomeia a categoria e leva junto as compras que usam o nome antigo
  async renameCat(input) {
    const i = +input.dataset.i;
    const oldName = S.categorias[i].name, newName = input.value.trim();
    if (!newName || newName === oldName) { input.value = oldName; return; }
    if (S.categorias.some(c => c.name === newName)) {
      alert('Já existe uma categoria com esse nome.');
      input.value = oldName;
      return;
    }
    showLoading();
    try {
      S.categorias[i].name = newName;
      await saveUserConfig();
      const snap = await getDocs(query(comprasRef(), where('cat', '==', oldName)));
      for (let k = 0; k < snap.docs.length; k += 500) {
        const batch = writeBatch(db);
        snap.docs.slice(k, k + 500).forEach(d => batch.update(d.ref, { cat: newName }));
        await gravar(batch.commit());
      }
    } catch (e) {
      S.categorias[i].name = oldName;
      input.value = oldName;
      alert('Erro ao renomear: ' + e.message);
    }
    hideLoading();
    buildCatSelect();
  },
  async removeCat(el) {
    const i = +el.dataset.i, name = S.categorias[i].name;
    const emUso = S.compras.filter(c => c.cat === name).length;
    const msg = emUso
      ? `A categoria "${name}" tem ${emUso} compra(s). Elas continuarão com esse nome. Remover mesmo assim?`
      : `Remover a categoria "${name}"?`;
    if (!confirm(msg)) return;
    S.categorias.splice(i, 1);
    await saveUserConfig();
    buildCatList(); buildCatSelect();
  },
  async addCat() {
    const n = $('new-cat-n').value.trim();
    if (!n) return;
    if (S.categorias.some(c => c.name === n)) return alert('Já existe uma categoria com esse nome.');
    S.categorias.push({ name: n });
    $('new-cat-n').value = '';
    ACOES.previewIconeNovo();
    await saveUserConfig();
    buildCatList(); buildCatSelect();
  },

  // --- ícones e cores das categorias ---
  previewIconeNovo() { $('new-cat-ic').innerHTML = chipCategoria({ name: $('new-cat-n').value }); },
  abrirIcones(el) {
    S.iconeCat = +el.dataset.i;
    renderSeletorIcone();
    $('icon-picker').style.display = 'flex';
  },
  async escolherIcone(el) {
    const cat = S.categorias[S.iconeCat];
    if (el.dataset.key) cat.icone = el.dataset.key; else delete cat.icone;
    renderSeletorIcone(); buildCatList();
    await saveUserConfig();
  },
  async escolherCor(el) {
    const cat = S.categorias[S.iconeCat];
    if (el.dataset.cor) cat.cor = el.dataset.cor; else delete cat.cor;
    renderSeletorIcone(); buildCatList();
    await saveUserConfig();
  },
  fecharIcones() { $('icon-picker').style.display = 'none'; },
  nada() {},   // cliques dentro da caixa do seletor não fecham o fundo

  // --- exportar ---
  exportCompras()     { compartilharArquivo(`minhafatura-compras-${hojeISO()}.csv`, csvCompras(S.compras, S.fechamento)); },
  exportLancamentos() { compartilharArquivo(`minhafatura-lancamentos-${hojeISO()}.csv`, csvLancamentos(S.compras, S.fechamento)); },

  // --- gráficos ---
  grafSel(el) { S.grafSel = el.dataset.key; renderGrafico(); },
  grafVerFatura() { S.faturaAtiva = S.grafSel; ACOES.goHome(); },

  // --- importar ---
  async importArquivo(input) {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const texto = decodificarArquivo(await file.arrayBuffer());
      const linhas = lerArquivo(texto, file.name);
      if (!linhas.length) throw new Error('Nenhum lançamento encontrado.');
      S.imp = { linhas, nome: file.name, itens: null };
      $('imp-fatura').value = '';
      renderImport();          // escolhe a fatura provável
      recalcularImport();
    } catch (e) {
      S.imp = null;
      renderImport();
      showErr('imp-erro', e.message);
    }
  },
  importRecalc() { recalcularImport(); },
  async impUsarFechamento(el) {
    const dia = +el.dataset.dia;
    if (!confirm(`Mudar o dia de fechamento de ${S.fechamento} para ${dia}? Isso reposiciona todas as compras do app.`)) return;
    S.fechamento = dia;
    await saveUserConfig();
    $('imp-fatura').value = '';
    renderImport();          // recalcula a fatura provável com o novo dia
    recalcularImport();
  },
  impToggle(input) {
    const it = S.imp.itens[+input.dataset.i];
    it.incluir = it.incluirManual = input.checked;
    renderImport();
  },
  impCat(sel) {
    const it = S.imp.itens[+sel.dataset.i];
    it.cat = sel.value; it.catManual = true;
  },
  async importConfirmar() {
    const marcados = S.imp.itens.filter(it => it.incluir);
    if (!marcados.length) return;
    showLoading();
    try {
      await adicionarEmLote(marcados.map(({ desc, cat, data, parcelas, valorParcela }) =>
        ({ desc, cat, data, parcelas, valorParcela, origem: 'importacao' })));
      S.faturaAtiva = $('imp-fatura').value;
      S.imp = null;
      hideLoading();
      alert(`${marcados.length} compra(s) importada(s).`);
      ACOES.goHome();
    } catch (e) {
      hideLoading();
      showErr('imp-erro', 'Erro ao importar: ' + e.message);
    }
  },
};

// Um ouvinte por tipo de evento: procura o elemento com data-<tipo> mais próximo
function despachar(tipo) {
  return ev => {
    const el = ev.target.closest(`[data-${tipo}]`);
    if (!el) return;
    const acao = ACOES[el.dataset[tipo]];
    if (!acao) return console.error(`Ação desconhecida: data-${tipo}="${el.dataset[tipo]}"`);
    acao(el, ev);
  };
}
document.addEventListener('click',  despachar('action'));
document.addEventListener('change', despachar('change'));
document.addEventListener('input',  despachar('input'));

// Enter no login envia
$('l-pass').addEventListener('keydown', e => { if (e.key === 'Enter') ACOES.doLogin(); });

// ============================================================
//  PWA — service worker
// ============================================================
if ('serviceWorker' in navigator) {
  // Quando uma versão nova do SW assume (atualização, não a 1ª instalação),
  // recarrega para que HTML, JS e CSS venham todos da mesma versão
  const tinhaSW = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!tinhaSW || recarregou) return;
    recarregou = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW não registrado:', e));
}

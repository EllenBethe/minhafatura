// ============================================================
//  MinhaFatura — app.js
//  Firebase Auth + Firestore
//  IMPORTANTE: substitua o bloco firebaseConfig com os seus dados
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

// ============================================================
//  🔧 CONFIGURE AQUI — cole os dados do seu projeto Firebase
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBfBYLYXucNBlB_lN1SEBHvG7H8mspAE0E",
  authDomain: "minhafatura.firebaseapp.com",
  projectId: "minhafatura",
  storageBucket: "minhafatura.firebasestorage.app",
  messagingSenderId: "773668320405",
  appId: "1:773668320405:web:f5d8d9a3b859cc2712979c"
};
// ============================================================

const fbApp = initializeApp(firebaseConfig);
const auth  = getAuth(fbApp);
// Cache local: o app abre e aceita lançamentos offline, sincronizando ao voltar a conexão
const db    = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ============================================================
//  ESTADO LOCAL
// ============================================================
const MONTHS   = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                  'agosto','setembro','outubro','novembro','dezembro'];
const MONTHS_S = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let currentUser  = null;
let unsubCompras = null;

let S = {
  fechamento: 10,
  categorias: [],
  compras:    [],
  faturaAtiva: null,
};

const DEFAULT_CATEGORIAS = [
  { emoji: '📱', name: 'Assinaturas' },
  { emoji: '🚗', name: 'Seguro Carro' },
  { emoji: '🏠', name: 'Seguro Casa' },
  { emoji: '🏡', name: 'Conjunto/Casa' },
  { emoji: '🔧', name: 'Manutenção do Carro' },
  { emoji: '🍔', name: 'Alimentação' },
  { emoji: '🛒', name: 'Mercado' },
  { emoji: '👗', name: 'Vestuário' },
  { emoji: '🎮', name: 'Lazer' },
  { emoji: '💊', name: 'Saúde' },
  { emoji: '📦', name: 'Outros' },
];

// ============================================================
//  HELPERS
// ============================================================
function showLoading() { document.getElementById('loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function showErr(elId, msg, ok = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('ok', ok);
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// Offline, as escritas do Firestore só resolvem quando a conexão volta:
// nesse caso não esperamos (o cache local já reflete a mudança) e só avisamos se falhar
function gravar(promise) {
  if (navigator.onLine) return promise;
  promise.catch(e => alert('Erro ao sincronizar: ' + e.message));
  return Promise.resolve();
}
// Escapa texto do usuário antes de inserir via innerHTML
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}
// Data de hoje no fuso local (toISOString usa UTC e vira o dia após 21h no Brasil)
function hojeISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ============================================================
//  FIRESTORE — config
// ============================================================
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

// ============================================================
//  FIRESTORE — compras (tempo real)
// ============================================================
function listenCompras() {
  if (unsubCompras) unsubCompras();
  const q = query(
    collection(db, 'users', currentUser.uid, 'compras'),
    orderBy('data', 'desc')
  );
  unsubCompras = onSnapshot(q, (snap) => {
    S.compras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderHome();
  }, (e) => {
    console.error(e);
    alert('Erro ao carregar compras: ' + e.message);
  });
}

async function addCompraFirestore(c)      { await gravar(addDoc(collection(db, 'users', currentUser.uid, 'compras'), c)); }
async function updateCompraFirestore(id, c) { await gravar(updateDoc(doc(db, 'users', currentUser.uid, 'compras', id), c)); }
async function deleteCompraFirestore(id)  { await gravar(deleteDoc(doc(db, 'users', currentUser.uid, 'compras', id))); }

// ============================================================
//  AUTH
// ============================================================
window.doLogin = async function () {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
  showLoading();
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (e) { hideLoading(); showErr('login-error', traduzirErroAuth(e.code)); }
};

window.doRegister = async function () {
  const email = document.getElementById('l-email').value.trim();
  const pass  = document.getElementById('l-pass').value;
  if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
  if (pass.length < 6) return showErr('login-error', 'Senha mínima: 6 caracteres.');
  showLoading();
  try { await createUserWithEmailAndPassword(auth, email, pass); }
  catch (e) { hideLoading(); showErr('login-error', traduzirErroAuth(e.code)); }
};

window.doReset = async function () {
  const email = document.getElementById('l-email').value.trim();
  if (!email) return showErr('login-error', 'Digite seu e-mail para redefinir a senha.');
  try { await sendPasswordResetEmail(auth, email); showErr('login-error', '✅ E-mail enviado!', true); }
  catch (e) { showErr('login-error', traduzirErroAuth(e.code)); }
};

window.doLogout = async function () {
  if (unsubCompras) unsubCompras();
  await signOut(auth);
};

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
    const init = user.email.split('@')[0].slice(0, 2).toUpperCase();
    document.getElementById('av').textContent      = init;
    document.getElementById('s-user').textContent  = user.email;
    hideLoading();
    showApp();
  } else {
    currentUser = null;
    S.compras   = [];
    show('scr-login');
    document.getElementById('bnav').style.display = 'none';
    hideLoading();
  }
});

// ============================================================
//  NAVEGAÇÃO
// ============================================================
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function setNav(id) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}
function showApp() {
  document.getElementById('bnav').style.display = 'flex';
  document.getElementById('s-fech').value = S.fechamento;
  buildCatSelect();
  goHome();
}
window.goHome = function () { show('scr-home'); setNav('nb-home'); renderHome(); };
window.goAdd  = function () { openAddForm(null); show('scr-form'); setNav('nb-add'); };
window.goSett = function () {
  show('scr-sett'); setNav('nb-sett');
  document.getElementById('s-user').textContent = currentUser?.email || '-';
  document.getElementById('s-fech').value = S.fechamento;
  buildCatList();
};

// ============================================================
//  LÓGICA DE FATURA + PARCELAMENTO
//
//  Uma compra de N parcelas aparece em N faturas consecutivas.
//  fatKeyOf() = fatura da PRIMEIRA parcela (derivada da data).
//  getAllFatKeys() gera todas as faturas que a compra ocupa.
// ============================================================
function getFatKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (d >= S.fechamento) {
    const nd = new Date(y, m, 1);
    return nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
  }
  return y + '-' + String(m).padStart(2, '0');
}

// Fatura da 1ª parcela, sempre recalculada a partir da data da compra
// (assim mudar o dia de fechamento reposiciona as compras antigas)
function fatKeyOf(c) {
  return c.data ? getFatKey(c.data) : c.fatKey;
}

function fatLabel(key) {
  const [y, m] = key.split('-');
  return MONTHS_S[parseInt(m) - 1] + '/' + y.slice(2);
}

function fatLabelFull(key) {
  const [y, m] = key.split('-');
  return MONTHS[parseInt(m) - 1] + ' de ' + y;
}

// Retorna array com todas as fatKeys que a compra ocupa
function getAllFatKeys(startFatKey, parcelas) {
  const [y, m] = startFatKey.split('-').map(Number);
  const keys = [];
  for (let i = 0; i < parcelas; i++) {
    const d = new Date(y, m - 1 + i, 1);
    keys.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return keys;
}

function getEndFatKey(startFatKey, parcelas) {
  const all = getAllFatKeys(startFatKey, parcelas);
  return all[all.length - 1];
}

// Todas as faturas que devem aparecer no seletor
function getActiveFats() {
  const now  = new Date();
  const keys = new Set();
  for (let i = -2; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    keys.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  // inclui todos os meses com parcelas em andamento
  S.compras.forEach(c => {
    getAllFatKeys(fatKeyOf(c), c.parcelas).forEach(k => keys.add(k));
  });
  return [...keys].sort();
}

// Compras que aparecem em uma fatura (inclui parceladas de meses anteriores)
function getComprasDaFatura(fatKey) {
  return S.compras.filter(c => getAllFatKeys(fatKeyOf(c), c.parcelas).includes(fatKey));
}

function buildFatNav() {
  const keys = getActiveFats();
  if (!S.faturaAtiva || !keys.includes(S.faturaAtiva)) {
    // Fatura aberta hoje (após o fechamento, já é a do mês seguinte)
    const cur = getFatKey(hojeISO());
    S.faturaAtiva = keys.includes(cur) ? cur : keys[0];
  }
  const nav = document.getElementById('fat-nav');
  if (!nav) return;
  nav.innerHTML = keys.map(k =>
    `<button type="button" class="fat-chip ${k === S.faturaAtiva ? 'active' : ''}" onclick="selFat('${k}')"
       aria-pressed="${k === S.faturaAtiva}" aria-label="Fatura de ${fatLabelFull(k)}">${fatLabel(k)}</button>`
  ).join('');
  setTimeout(() => {
    const active = nav.querySelector('.fat-chip.active');
    if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, 50);
}

function buildFatFilter() {
  const sel = document.getElementById('fil-fatura');
  if (!sel) return;
  const keys = getActiveFats();
  sel.innerHTML = keys.map(k =>
    `<option value="${k}" ${k === S.faturaAtiva ? 'selected' : ''}>${fatLabelFull(k)}</option>`
  ).join('');
}

window.selFat = function (k) {
  S.faturaAtiva = k;
  const sel = document.getElementById('fil-fatura');
  if (sel) sel.value = k;
  renderHome();
};

window.onFatFilterChange = function () {
  const sel = document.getElementById('fil-fatura');
  if (sel) selFat(sel.value);
};

// ============================================================
//  RENDER HOME
// ============================================================
function renderHome() {
  if (!document.getElementById('scr-home').classList.contains('active')) return;
  buildFatNav();
  buildFatFilter();

  const fat = S.faturaAtiva;
  if (!fat) return;

  const [fy, fm] = fat.split('-');
  document.getElementById('fat-label').textContent    = `Fatura de ${MONTHS[parseInt(fm) - 1]} de ${fy}`;
  document.getElementById('fat-sub-info').textContent = `Fecha no dia ${S.fechamento}`;

  const search  = (document.getElementById('search')?.value || '').toLowerCase();
  let compras   = getComprasDaFatura(fat);

  // Resumo por categoria (sem filtro de busca)
  const catMap = {};
  compras.forEach(c => { catMap[c.cat] = (catMap[c.cat] || 0) + c.valorParcela; });

  const resumoEl = document.getElementById('cat-resumo');
  const catKeys  = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]);
  if (catKeys.length === 0) {
    resumoEl.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center;padding:4px 0;">Sem lançamentos</div>';
  } else {
    resumoEl.innerHTML = catKeys.map(k => {
      const cat = S.categorias.find(c => c.name === k);
      return `<div class="cat-resumo-row"><span>${esc(cat?.emoji || '')} ${esc(k)}</span><b>R$ ${fmt(catMap[k])}</b></div>`;
    }).join('');
  }

  const total = Object.values(catMap).reduce((a, b) => a + b, 0);
  document.getElementById('fat-total').textContent = `R$ ${fmt(total)}`;
  document.getElementById('fat-count').textContent =
    `${compras.length} lançamento${compras.length !== 1 ? 's' : ''}`;

  // Filtro de busca
  if (search) compras = compras.filter(c =>
    c.desc?.toLowerCase().includes(search) || c.cat?.toLowerCase().includes(search)
  );

  const list = document.getElementById('compras-list');
  if (compras.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma compra nesta fatura</div>';
    return;
  }

  list.innerHTML = [...compras].map(c => {
    const cat      = S.categorias.find(x => x.name === c.cat) || { emoji: '📦' };
    const allKeys  = getAllFatKeys(fatKeyOf(c), c.parcelas);
    const parAtual = allKeys.indexOf(fat) + 1;
    const endKey   = getEndFatKey(fatKeyOf(c), c.parcelas);
    const parLabel = c.parcelas > 1 ? `Parcela ${parAtual} de ${c.parcelas}` : 'À vista';
    const finLabel = c.parcelas > 1 ? `Finaliza: ${fatLabelFull(endKey)}` : '';
    const pct      = c.parcelas > 1 ? Math.min(100, Math.round((parAtual / c.parcelas) * 100)) : 100;

    return `<div class="compra-card">
      <div class="cc-top">
        <div class="cc-badges">
          <div class="cc-badge">${esc(cat.emoji)} ${esc(c.cat)}</div>
        </div>
        <div class="cc-actions">
          <button class="cc-act-btn" onclick="editCompra('${c.id}')" aria-label="Editar">✏️</button>
          <button class="cc-act-btn" onclick="confirmDelete('${c.id}')" aria-label="Remover">🗑️</button>
        </div>
      </div>
      <div class="cc-nome">${esc(c.desc)}</div>
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
//  SELECTS
// ============================================================
function buildCatSelect() {
  const cs = document.getElementById('f-cat');
  if (cs) cs.innerHTML = S.categorias.map(c =>
    `<option value="${esc(c.name)}">${esc(c.emoji)} ${esc(c.name)}</option>`
  ).join('');
}

// ============================================================
//  FORM — ADICIONAR / EDITAR
// ============================================================
function openAddForm(compra) {
  buildCatSelect();
  document.getElementById('edit-id').value          = compra?.id || '';
  document.getElementById('form-title').textContent = compra ? 'Editar compra' : 'Nova compra';
  document.getElementById('f-desc').value           = compra?.desc || '';
  document.getElementById('f-cat').value            = compra?.cat  || S.categorias[0]?.name || '';
  document.getElementById('f-data').value           = compra?.data || hojeISO();
  document.getElementById('f-parc').value           = compra?.parcelas      || 1;
  document.getElementById('f-tipo-val').value       = 'parcela';
  document.getElementById('f-val').value            = compra?.valorParcela  || '';
  updateValorHint();
}

// Converte o valor digitado em valor da parcela (arredondado em centavos)
function lerValorParcela() {
  const parcelas = Math.max(1, parseInt(document.getElementById('f-parc').value) || 1);
  const valor    = parseFloat(document.getElementById('f-val').value);
  const tipo     = document.getElementById('f-tipo-val').value;
  if (!valor || valor <= 0) return null;
  const parcela  = tipo === 'total' ? valor / parcelas : valor;
  return { parcelas, valorParcela: Math.round(parcela * 100) / 100 };
}

window.updateValorHint = function () {
  const hint = document.getElementById('f-val-hint');
  const v    = lerValorParcela();
  if (!v) { hint.textContent = ''; return; }
  hint.textContent = v.parcelas > 1
    ? `${v.parcelas}x de R$ ${fmt(v.valorParcela)} = R$ ${fmt(v.valorParcela * v.parcelas)}`
    : `À vista: R$ ${fmt(v.valorParcela)}`;
};

window.editCompra = function (id) {
  const c = S.compras.find(x => x.id === id);
  if (!c) return;
  openAddForm(c);
  show('scr-form');
  setNav('nb-add');
};

window.confirmDelete = async function (id) {
  if (!confirm('Remover esta compra?')) return;
  showLoading();
  try { await deleteCompraFirestore(id); }
  catch (e) { alert('Erro ao remover: ' + e.message); }
  hideLoading();
};

window.saveCompra = async function () {
  const desc         = document.getElementById('f-desc').value.trim();
  const cat          = document.getElementById('f-cat').value;
  const data         = document.getElementById('f-data').value;
  const valor        = lerValorParcela();

  if (!desc)  return showErr('form-error', 'Preencha a descrição.');
  if (!data)  return showErr('form-error', 'Escolha a data.');
  if (!valor) return showErr('form-error', 'Informe o valor.');

  const payload = { desc, cat, data, ...valor };

  showLoading();
  try {
    const editId = document.getElementById('edit-id').value;
    if (editId) { await updateCompraFirestore(editId, payload); }
    else        { await addCompraFirestore(payload); }
    S.faturaAtiva = getFatKey(data);
    goHome();
  } catch (e) {
    showErr('form-error', 'Erro ao salvar: ' + e.message);
  }
  hideLoading();
};

// ============================================================
//  SETTINGS — Fechamento
// ============================================================
window.saveFech = async function () {
  const v = parseInt(document.getElementById('s-fech').value);
  if (v >= 1 && v <= 31) {
    S.fechamento = v;
    await saveUserConfig();
    renderHome();
  }
};

// ============================================================
//  SETTINGS — Categorias
// ============================================================
function buildCatList() {
  const el = document.getElementById('cat-list-s');
  if (!el) return;
  el.innerHTML = S.categorias.map((c, i) => `
    <div class="resp-item">
      <span style="font-size:18px;width:24px;text-align:center;">${esc(c.emoji)}</span>
      <input class="resp-name-inp" value="${esc(c.name)}" onchange="renameCat(${i}, this)" />
      <button class="btn-del" onclick="removeCat(${i})" aria-label="Remover categoria">✕</button>
    </div>`).join('');
}

// Renomeia a categoria e leva junto as compras que usam o nome antigo
window.renameCat = async function (i, input) {
  const oldName = S.categorias[i].name;
  const newName = input.value.trim();
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
    const comprasRef = collection(db, 'users', currentUser.uid, 'compras');
    const snap = await getDocs(query(comprasRef, where('cat', '==', oldName)));
    // writeBatch aceita até 500 operações
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
};

window.removeCat = async function (i) {
  const name  = S.categorias[i].name;
  const emUso = S.compras.filter(c => c.cat === name).length;
  const msg   = emUso
    ? `A categoria "${name}" tem ${emUso} compra(s). Elas continuarão com esse nome. Remover mesmo assim?`
    : `Remover a categoria "${name}"?`;
  if (!confirm(msg)) return;
  S.categorias.splice(i, 1);
  await saveUserConfig();
  buildCatList();
  buildCatSelect();
};

window.addCat = async function () {
  const e = document.getElementById('new-cat-e').value.trim() || '🏷️';
  const n = document.getElementById('new-cat-n').value.trim();
  if (!n) return;
  if (S.categorias.some(c => c.name === n)) return alert('Já existe uma categoria com esse nome.');
  S.categorias.push({ emoji: e, name: n });
  document.getElementById('new-cat-n').value = '';
  await saveUserConfig();
  buildCatList();
  buildCatSelect();
};

document.addEventListener('DOMContentLoaded', () => {
  const fd = document.getElementById('f-data');
  if (fd) fd.value = hojeISO();
});

// ============================================================
//  PWA — service worker
// ============================================================
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW não registrado:', e));
}

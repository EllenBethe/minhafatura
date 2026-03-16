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
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
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
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

// ============================================================
//  ESTADO LOCAL
// ============================================================
const MONTHS = ['janeiro','fevereiro','março','abril','maio','junho','julho',
                'agosto','setembro','outubro','novembro','dezembro'];
const MONTHS_S = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

let currentUser = null;
let unsubCompras = null;

let S = {
  fechamento: 10,
  responsaveis: [],
  categorias: [],
  compras: [],
  faturaAtiva: null,
};

const DEFAULT_RESPONSAVEIS = [
  { name: 'Eu', color: '#0fbcb0' },
];
const DEFAULT_CATEGORIAS = [
  { emoji: '📱', name: 'Assinaturas' },
  { emoji: '🚗', name: 'Seguro Carro' },
  { emoji: '🏠', name: 'Seguro Casa' },
  { emoji: '🏡', name: 'Conjunto/Casa' },
  { emoji: '🔧', name: 'Manutenção' },
  { emoji: '🍔', name: 'Alimentação' },
  { emoji: '🛒', name: 'Mercado' },
  { emoji: '👗', name: 'Roupas' },
  { emoji: '🎮', name: 'Lazer' },
  { emoji: '💊', name: 'Saúde' },
  { emoji: '📦', name: 'Outros' },
];

// ============================================================
//  HELPERS — LOADING & ERRORS
// ============================================================
function showLoading() { document.getElementById('loading').style.display = 'flex'; }
function hideLoading() { document.getElementById('loading').style.display = 'none'; }
function showErr(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

// ============================================================
//  FIRESTORE — carregar / salvar configurações
// ============================================================
async function loadUserConfig() {
  const ref = doc(db, 'users', currentUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const d = snap.data();
    S.fechamento = d.fechamento ?? 10;
    S.responsaveis = d.responsaveis ?? DEFAULT_RESPONSAVEIS;
    S.categorias = d.categorias ?? DEFAULT_CATEGORIAS;
  } else {
    // primeiro acesso — salva defaults
    S.fechamento = 10;
    S.responsaveis = [...DEFAULT_RESPONSAVEIS];
    S.categorias = [...DEFAULT_CATEGORIAS];
    await saveUserConfig();
  }
}

async function saveUserConfig() {
  const ref = doc(db, 'users', currentUser.uid);
  await setDoc(ref, {
    fechamento: S.fechamento,
    responsaveis: S.responsaveis,
    categorias: S.categorias,
  }, { merge: true });
}

// ============================================================
//  FIRESTORE — compras (listener em tempo real)
// ============================================================
function listenCompras() {
  if (unsubCompras) unsubCompras();
  const q = query(
    collection(db, 'users', currentUser.uid, 'compras'),
    orderBy('data', 'desc')
  );
  unsubCompras = onSnapshot(q, (snap) => {
    S.compras = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    buildFatNav();
    renderHome();
  });
}

async function addCompraFirestore(compra) {
  await addDoc(collection(db, 'users', currentUser.uid, 'compras'), compra);
}

async function updateCompraFirestore(id, compra) {
  await updateDoc(doc(db, 'users', currentUser.uid, 'compras', id), compra);
}

async function deleteCompraFirestore(id) {
  await deleteDoc(doc(db, 'users', currentUser.uid, 'compras', id));
}

// ============================================================
//  AUTH
// ============================================================
window.doLogin = async function () {
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
  showLoading();
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    hideLoading();
    showErr('login-error', traduzirErroAuth(e.code));
  }
};

window.doRegister = async function () {
  const email = document.getElementById('l-email').value.trim();
  const pass = document.getElementById('l-pass').value;
  if (!email || !pass) return showErr('login-error', 'Preencha e-mail e senha.');
  if (pass.length < 6) return showErr('login-error', 'Senha mínima: 6 caracteres.');
  showLoading();
  try {
    await createUserWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    hideLoading();
    showErr('login-error', traduzirErroAuth(e.code));
  }
};

window.doReset = async function () {
  const email = document.getElementById('l-email').value.trim();
  if (!email) return showErr('login-error', 'Digite seu e-mail para redefinir a senha.');
  try {
    await sendPasswordResetEmail(auth, email);
    showErr('login-error', '✅ E-mail de redefinição enviado!');
  } catch (e) {
    showErr('login-error', traduzirErroAuth(e.code));
  }
};

window.doLogout = async function () {
  if (unsubCompras) unsubCompras();
  await signOut(auth);
};

function traduzirErroAuth(code) {
  const msgs = {
    'auth/user-not-found': 'Usuário não encontrado.',
    'auth/wrong-password': 'Senha incorreta.',
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
  };
  return msgs[code] || 'Erro: ' + code;
}

// Listener de autenticação
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    showLoading();
    await loadUserConfig();
    listenCompras();
    const init = user.email.split('@')[0].slice(0, 2).toUpperCase();
    document.getElementById('av').textContent = init;
    document.getElementById('s-user').textContent = user.email;
    hideLoading();
    showApp();
  } else {
    currentUser = null;
    S.compras = [];
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
  buildSelects();
  goHome();
}
window.goHome = function () { show('scr-home'); setNav('nb-home'); renderHome(); };
window.goAdd = function () { openAddForm(null); show('scr-form'); setNav('nb-add'); };
window.goSett = function () {
  show('scr-sett');
  setNav('nb-sett');
  document.getElementById('s-user').textContent = currentUser?.email || '-';
  document.getElementById('s-fech').value = S.fechamento;
  buildRespList();
  buildCatList();
};

// ============================================================
//  LÓGICA DE FATURA
// ============================================================
function getFatKey(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (d >= S.fechamento) {
    const nd = new Date(y, m, 1);
    return nd.getFullYear() + '-' + String(nd.getMonth() + 1).padStart(2, '0');
  }
  return y + '-' + String(m).padStart(2, '0');
}

function fatLabel(key) {
  const [y, m] = key.split('-');
  return MONTHS_S[parseInt(m) - 1] + '/' + y.slice(2);
}

function fatLabelFull(key) {
  const [y, m] = key.split('-');
  return MONTHS[parseInt(m) - 1] + ' de ' + y;
}

function calcEndFatKey(data, parcelas) {
  if (parcelas <= 1) return getFatKey(data);
  const [y, m, d] = data.split('-').map(Number);
  const end = new Date(y, m - 1 + parcelas - 1, d);
  const es = end.getFullYear() + '-' + String(end.getMonth() + 1).padStart(2, '0') + '-' + String(end.getDate()).padStart(2, '0');
  return getFatKey(es);
}

function getActiveFats() {
  const now = new Date();
  const keys = new Set();
  for (let i = -1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    keys.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  S.compras.forEach(c => { if (c.fatKey) keys.add(c.fatKey); });
  return [...keys].sort();
}

function buildFatNav() {
  const keys = getActiveFats();
  if (!S.faturaAtiva || !keys.includes(S.faturaAtiva)) {
    const now = new Date();
    const cur = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    S.faturaAtiva = keys.includes(cur) ? cur : keys[0];
  }
  const nav = document.getElementById('fat-nav');
  if (!nav) return;
  nav.innerHTML = keys.map(k =>
    `<div class="fat-chip ${k === S.faturaAtiva ? 'active' : ''}" onclick="selFat('${k}')">${fatLabel(k)}</div>`
  ).join('');
}

window.selFat = function (k) { S.faturaAtiva = k; buildFatNav(); renderHome(); };

// ============================================================
//  RENDER HOME
// ============================================================
function renderHome() {
  if (!document.getElementById('scr-home').classList.contains('active')) return;
  buildFatNav();

  const fat = S.faturaAtiva;
  if (!fat) return;
  const [fy, fm] = fat.split('-');
  document.getElementById('fat-label').textContent = `Fatura de ${MONTHS[parseInt(fm) - 1]} de ${fy}`;
  document.getElementById('fat-sub-info').textContent = `Fecha no dia ${S.fechamento}`;

  const filResp = document.getElementById('fil-resp')?.value || '';
  const search = (document.getElementById('search')?.value || '').toLowerCase();

  let compras = S.compras.filter(c => c.fatKey === fat);

  // Resumo por categoria (TODAS, sem filtro)
  const catMap = {};
  compras.forEach(c => { catMap[c.cat] = (catMap[c.cat] || 0) + c.valorParcela; });

  const resumoEl = document.getElementById('cat-resumo');
  const catKeys = Object.keys(catMap).sort((a, b) => catMap[b] - catMap[a]);
  if (catKeys.length === 0) {
    resumoEl.innerHTML = '<div style="font-size:12px;color:rgba(255,255,255,0.4);text-align:center;padding:4px 0;">Sem lançamentos</div>';
  } else {
    resumoEl.innerHTML = catKeys.map(k => {
      const cat = S.categorias.find(c => c.name === k);
      return `<div class="cat-resumo-row"><span>${cat?.emoji || ''} ${k}</span><b>R$ ${fmt(catMap[k])}</b></div>`;
    }).join('');
  }

  const total = Object.values(catMap).reduce((a, b) => a + b, 0);
  document.getElementById('fat-total').textContent = `R$ ${fmt(total)}`;
  document.getElementById('fat-count').textContent = `${compras.length} lançamento${compras.length !== 1 ? 's' : ''}`;

  // Aplicar filtros na lista
  if (filResp) compras = compras.filter(c => c.resp === filResp);
  if (search) compras = compras.filter(c =>
    c.desc?.toLowerCase().includes(search) || c.cat?.toLowerCase().includes(search)
  );

  const list = document.getElementById('compras-list');
  if (compras.length === 0) {
    list.innerHTML = '<div class="empty">Nenhuma compra nesta fatura</div>';
    return;
  }

  list.innerHTML = [...compras].map(c => {
    const cat = S.categorias.find(x => x.name === c.cat) || { emoji: '📦' };
    const resp = S.responsaveis.find(x => x.name === c.resp) || { color: '#888' };
    const endKey = calcEndFatKey(c.data, c.parcelas);
    const [sy, sm] = c.fatKey.split('-').map(Number);
    const [fy2, fm2] = fat.split('-').map(Number);
    const parAtual = Math.max(1, (fy2 - sy) * 12 + (fm2 - sm) + 1);
    const parLabel = c.parcelas > 1 ? `Parcela ${parAtual} de ${c.parcelas}` : 'À vista';
    const finalizaLabel = c.parcelas > 1 ? `Finaliza: ${fatLabelFull(endKey)}` : '';
    const pct = c.parcelas > 1 ? Math.min(100, Math.round((parAtual / c.parcelas) * 100)) : 100;

    return `<div class="compra-card">
      <div class="cc-top">
        <div class="cc-badges">
          <div class="cc-badge">${cat.emoji} ${c.cat}</div>
          <div class="cc-resp-badge" style="color:${resp.color}">${c.resp}</div>
        </div>
        <div class="cc-actions">
          <button class="cc-act-btn" onclick="editCompra('${c.id}')">✏️</button>
          <button class="cc-act-btn" onclick="confirmDelete('${c.id}')">🗑️</button>
        </div>
      </div>
      <div class="cc-nome">${c.desc}</div>
      <div class="cc-mid">
        <div class="cc-meta">
          <div class="cc-parcela-txt">${parLabel}</div>
          ${finalizaLabel ? `<div class="cc-finaliza">${finalizaLabel}</div>` : ''}
        </div>
        <div class="cc-valor">R$ ${fmt(c.valorParcela)}</div>
      </div>
      <div class="prog-bg"><div class="prog-fill" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
}

function fmt(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ============================================================
//  SELECTS
// ============================================================
function buildSelects() {
  const rs = document.getElementById('f-resp');
  if (rs) rs.innerHTML = S.responsaveis.map(r => `<option value="${r.name}">${r.name}</option>`).join('');

  const cs = document.getElementById('f-cat');
  if (cs) cs.innerHTML = S.categorias.map(c => `<option value="${c.name}">${c.emoji} ${c.name}</option>`).join('');

  const fr = document.getElementById('fil-resp');
  if (fr) fr.innerHTML = `<option value="">Todos os responsáveis</option>` +
    S.responsaveis.map(r => `<option value="${r.name}">${r.name}</option>`).join('');
}

// ============================================================
//  FORM — ADICIONAR / EDITAR
// ============================================================
function openAddForm(compra) {
  buildSelects();
  document.getElementById('edit-id').value = compra?.id || '';
  document.getElementById('form-title').textContent = compra ? 'Editar compra' : 'Nova compra';
  document.getElementById('f-resp').value = compra?.resp || S.responsaveis[0]?.name || '';
  document.getElementById('f-desc').value = compra?.desc || '';
  document.getElementById('f-cat').value = compra?.cat || S.categorias[0]?.name || '';
  document.getElementById('f-data').value = compra?.data || new Date().toISOString().split('T')[0];
  document.getElementById('f-parc').value = compra?.parcelas || 1;
  document.getElementById('f-val').value = compra?.valorParcela || '';
}

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
  try {
    await deleteCompraFirestore(id);
  } catch (e) {
    alert('Erro ao remover: ' + e.message);
  }
  hideLoading();
};

window.saveCompra = async function () {
  const resp = document.getElementById('f-resp').value;
  const desc = document.getElementById('f-desc').value.trim();
  const cat = document.getElementById('f-cat').value;
  const data = document.getElementById('f-data').value;
  const parcelas = Math.max(1, parseInt(document.getElementById('f-parc').value) || 1);
  const valorParcela = parseFloat(document.getElementById('f-val').value);

  if (!desc) return showErr('form-error', 'Preencha a descrição.');
  if (!data) return showErr('form-error', 'Escolha a data.');
  if (!valorParcela || valorParcela <= 0) return showErr('form-error', 'Informe o valor da parcela.');

  const fatKey = getFatKey(data);
  const payload = { resp, desc, cat, data, parcelas, valorParcela, fatKey };

  showLoading();
  try {
    const editId = document.getElementById('edit-id').value;
    if (editId) {
      await updateCompraFirestore(editId, payload);
    } else {
      await addCompraFirestore(payload);
    }
    S.faturaAtiva = fatKey;
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
    buildFatNav();
    renderHome();
  }
};

// ============================================================
//  SETTINGS — Responsáveis
// ============================================================
function buildRespList() {
  const el = document.getElementById('resp-list');
  if (!el) return;
  el.innerHTML = S.responsaveis.map((r, i) => `
    <div class="resp-item">
      <div class="resp-dot" style="background:${r.color}"></div>
      <input class="resp-name-inp" value="${r.name}"
        onchange="S.responsaveis[${i}].name=this.value;saveUserConfig();buildSelects();" />
      <button class="btn-del" onclick="removeResp(${i})">✕</button>
    </div>`).join('');
}

window.removeResp = async function (i) {
  S.responsaveis.splice(i, 1);
  await saveUserConfig();
  buildRespList();
  buildSelects();
};

window.addResp = async function () {
  const n = document.getElementById('new-resp').value.trim();
  const c = document.getElementById('new-resp-color').value;
  if (!n) return;
  S.responsaveis.push({ name: n, color: c });
  document.getElementById('new-resp').value = '';
  await saveUserConfig();
  buildRespList();
  buildSelects();
};

// ============================================================
//  SETTINGS — Categorias
// ============================================================
function buildCatList() {
  const el = document.getElementById('cat-list-s');
  if (!el) return;
  el.innerHTML = S.categorias.map((c, i) => `
    <div class="resp-item">
      <span style="font-size:18px;width:24px;text-align:center;">${c.emoji}</span>
      <input class="resp-name-inp" value="${c.name}"
        onchange="S.categorias[${i}].name=this.value;saveUserConfig();buildSelects();" />
      <button class="btn-del" onclick="removeCat(${i})">✕</button>
    </div>`).join('');
}

window.removeCat = async function (i) {
  S.categorias.splice(i, 1);
  await saveUserConfig();
  buildCatList();
  buildSelects();
};

window.addCat = async function () {
  const e = document.getElementById('new-cat-e').value.trim() || '🏷️';
  const n = document.getElementById('new-cat-n').value.trim();
  if (!n) return;
  S.categorias.push({ emoji: e, name: n });
  document.getElementById('new-cat-n').value = '';
  await saveUserConfig();
  buildCatList();
  buildSelects();
};

// Exporta para uso no HTML inline (onclick)
window.saveUserConfig = saveUserConfig;

// Inicializa a data padrão no form
document.addEventListener('DOMContentLoaded', () => {
  const fd = document.getElementById('f-data');
  if (fd) fd.value = new Date().toISOString().split('T')[0];
});

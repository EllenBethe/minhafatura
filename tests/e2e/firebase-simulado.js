// Firebase simulado para os testes de tela: mesmas funções que o app importa do
// Firebase (Auth + Firestore), com os dados em memória. O estado inicial vem de
// globalThis.__SEED (definido pelo teste antes de a página carregar) e fica
// visível em globalThis.__E2E para as verificações.

const seed = globalThis.__SEED || {};
const state = {
  user: seed.logado === false ? null : { uid: 'u1', email: 'teste@exemplo.com' },
  config: structuredClone(seed.config || { fechamento: 10, categorias: [{ name: 'Outros' }] }),
  compras: new Map((seed.compras || []).map(c => [c.id, structuredClone(c)])),
};
const SENHA = 'senha123';
let authCb = null, n = 0;
const ouvintes = new Set();
const novoId = () => 'novo' + (++n);
const erro = code => Object.assign(new Error(code), { code });

// ---------- app / auth ----------
export const initializeApp = () => ({});
export const getAuth = () => ({});
export const onAuthStateChanged = (_a, cb) => { authCb = cb; setTimeout(() => cb(state.user), 0); return () => {}; };
export const signInWithEmailAndPassword = async (_a, email, senha) => {
  if (senha !== SENHA) throw erro('auth/invalid-credential');
  state.user = { uid: 'u1', email };
  authCb?.(state.user);
};
export const createUserWithEmailAndPassword = signInWithEmailAndPassword;
export const sendPasswordResetEmail = async () => {};
export const signOut = async () => { state.user = null; authCb?.(null); };

// ---------- firestore ----------
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});

export const collection = (_db, ...partes) => ({ tipo: 'col', path: partes.join('/') });
export const doc = (base, ...partes) =>
  base?.tipo === 'col'
    ? { tipo: 'doc', col: base.path, id: partes[0] || novoId() }   // doc(colecao[, id])
    : { tipo: 'doc', path: partes.join('/'), id: partes.at(-1) };  // doc(db, 'users', uid)
const ehCompra = ref => !!ref.col;

const instantaneo = () => ({
  docs: [...state.compras]
    .sort((a, b) => (b[1].data || '').localeCompare(a[1].data || ''))
    .map(([id, c]) => ({ id, ref: { tipo: 'doc', col: 'compras', id }, data: () => structuredClone(c) })),
});
const avisar = () => setTimeout(() => ouvintes.forEach(cb => cb(instantaneo())), 0);

export const getDoc = async () => ({ exists: () => !!state.config, data: () => structuredClone(state.config) });
export const setDoc = async (ref, dados, opcoes) => {
  if (ehCompra(ref)) { state.compras.set(ref.id, structuredClone(dados)); avisar(); return; }
  state.config = { ...(opcoes?.merge ? state.config : {}), ...structuredClone(dados) };
};
export const addDoc = async (_col, dados) => { const id = novoId(); state.compras.set(id, structuredClone(dados)); avisar(); return { id }; };
export const updateDoc = async (ref, dados) => { state.compras.set(ref.id, { ...state.compras.get(ref.id), ...structuredClone(dados) }); avisar(); };
export const deleteDoc = async ref => { state.compras.delete(ref.id); avisar(); };

export const query = (ref, ...filtros) => ({ ref, filtros });
export const where = (campo, _op, valor) => ({ campo, valor });
export const orderBy = () => ({});
export const getDocs = async q => ({
  docs: instantaneo().docs.filter(d => q.filtros.every(f => !f.campo || d.data()[f.campo] === f.valor)),
});
export const writeBatch = () => {
  const ops = [];
  return {
    set: (ref, dados) => ops.push(() => state.compras.set(ref.id, structuredClone(dados))),
    update: (ref, dados) => ops.push(() => state.compras.set(ref.id, { ...state.compras.get(ref.id), ...structuredClone(dados) })),
    delete: ref => ops.push(() => state.compras.delete(ref.id)),
    commit: async () => { ops.forEach(f => f()); avisar(); },
  };
};
export const onSnapshot = (_q, cb) => { ouvintes.add(cb); setTimeout(() => cb(instantaneo()), 0); return () => ouvintes.delete(cb); };

globalThis.__E2E = {
  estado: () => ({ config: structuredClone(state.config), compras: [...state.compras].map(([id, c]) => ({ id, ...c })) }),
};

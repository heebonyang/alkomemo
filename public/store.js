// 데이터 저장소와 로그인을 한곳에 모은 파일.
// config.js 에 Firebase 설정이 없으면 "로컬 개발 모드"로 동작해요:
// 데이터는 이 브라우저의 localStorage 에 저장되고, 로그인 대신 사용자 1/2 중 하나를 골라요.
import { firebaseConfig } from "./config.js";

export const MODE = String(firebaseConfig.apiKey || "").startsWith("YOUR_") ? "local" : "firebase";

export const LOCAL_USERS = [
  { uid: "local-1", displayName: "사용자 1", email: "user1@local", photoURL: "" },
  { uid: "local-2", displayName: "사용자 2", email: "user2@local", photoURL: "" },
];

let impl;

if (MODE === "firebase") {
  const base = "https://www.gstatic.com/firebasejs/10.12.2/";
  const [{ initializeApp }, A, F] = await Promise.all([
    import(base + "firebase-app.js"), import(base + "firebase-auth.js"), import(base + "firebase-firestore.js"),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const asList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  impl = {
    collection: (...segs) => F.collection(db, ...segs),
    docIn: (col, id) => (id ? F.doc(col, id) : F.doc(col)),
    docAt: (...segs) => F.doc(db, ...segs),
    watch(col, { byUpdated, where, metadata } = {}, next, error) {
      const parts = [];
      if (where) parts.push(F.where(...where));
      if (byUpdated) parts.push(F.orderBy("updatedAt", "desc"));
      const q = parts.length ? F.query(col, ...parts) : col;
      // metadata: 서버 확인 여부(hasPendingWrites)가 바뀔 때도 알림
      return metadata ? F.onSnapshot(q, { includeMetadataChanges: true }, next, error) : F.onSnapshot(q, next, error);
    },
    async getDoc(ref) { const s = await F.getDoc(ref); return { exists: s.exists(), data: s.data() }; },
    getDocs: async (col) => asList(await F.getDocs(col)),
    setDoc: F.setDoc, updateDoc: F.updateDoc, deleteDoc: F.deleteDoc, addDoc: F.addDoc,
    // { members: uid, memberEmails: email } 처럼 배열 필드에 값 추가/제거
    arrayAdd: (ref, fields) => F.updateDoc(ref, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, F.arrayUnion(v)]))),
    arrayRemove: (ref, fields) => F.updateDoc(ref, Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, F.arrayRemove(v)]))),
    onUser: (cb) => A.onAuthStateChanged(auth, cb),
    logOut: () => A.signOut(auth),
    signInLocal: null,
    async signInGoogle() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
          await A.signInWithRedirect(auth, provider);
        } else throw e;
      }
    },
  };
} else {
  const KEY = "alko-note:db:v1";
  const USER_KEY = "alko-note:user";
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  let data = read(); // { "spaces/abc": {...}, "users/local-1/notes/x": {...} }
  const subs = new Set();
  const notify = () => subs.forEach((s) => s());
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} notify(); };
  // 다른 탭에서 바뀐 내용도 바로 반영 (탭 두 개 = 두 사람 시험)
  window.addEventListener("storage", (e) => { if (e.key === KEY) { data = read(); notify(); } });

  const parentOf = (path) => path.slice(0, path.lastIndexOf("/"));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const matches = (v, [field, op, value]) =>
    op === "array-contains" ? Array.isArray(v[field]) && v[field].includes(value) : v[field] === value;
  const snapshot = (colPath, byUpdated, where) => {
    let docs = Object.entries(data)
      .filter(([p, v]) => parentOf(p) === colPath && (!where || matches(v, where)))
      .map(([p, v]) => ({ id: p.slice(colPath.length + 1), data: () => v }));
    if (byUpdated) docs.sort((a, b) => (b.data().updatedAt || 0) - (a.data().updatedAt || 0));
    return { docs, metadata: { fromCache: false } };
  };
  const notFound = () => Object.assign(new Error("not found"), { code: "not-found" });
  const editArrays = (ref, fields, add) => {
    const cur = data[ref.path];
    if (!cur) throw notFound();
    const next = { ...cur };
    for (const [k, v] of Object.entries(fields)) {
      const arr = Array.isArray(cur[k]) ? cur[k] : [];
      next[k] = add ? (arr.includes(v) ? arr : [...arr, v]) : arr.filter((x) => x !== v);
    }
    data[ref.path] = next; persist();
  };

  let current = null;
  try { current = LOCAL_USERS.find((u) => u.uid === sessionStorage.getItem(USER_KEY)) || null; } catch {}
  const authSubs = new Set();
  const setUser = (u) => {
    current = u;
    try { u ? sessionStorage.setItem(USER_KEY, u.uid) : sessionStorage.removeItem(USER_KEY); } catch {}
    authSubs.forEach((cb) => cb(u));
  };

  impl = {
    collection: (...segs) => ({ path: segs.join("/") }),
    docIn: (col, id) => ({ path: col.path + "/" + (id || newId()), get id() { return this.path.split("/").pop(); } }),
    docAt: (...segs) => ({ path: segs.join("/"), id: segs[segs.length - 1] }),
    watch(col, { byUpdated, where } = {}, next) {
      const fire = () => next(snapshot(col.path, byUpdated, where));
      subs.add(fire);
      queueMicrotask(fire);
      return () => subs.delete(fire);
    },
    async getDoc(ref) { return { exists: !!data[ref.path], data: data[ref.path] }; },
    async getDocs(col) { return snapshot(col.path).docs.map((d) => ({ id: d.id, ...d.data() })); },
    async setDoc(ref, v, opts) { data[ref.path] = opts && opts.merge ? { ...data[ref.path], ...v } : { ...v }; persist(); },
    async updateDoc(ref, v) {
      if (!data[ref.path]) throw notFound();
      data[ref.path] = { ...data[ref.path], ...v }; persist();
    },
    async deleteDoc(ref) { delete data[ref.path]; persist(); },
    async addDoc(col, v) { const ref = impl.docIn(col); await impl.setDoc(ref, v); return ref; },
    async arrayAdd(ref, fields) { editArrays(ref, fields, true); },
    async arrayRemove(ref, fields) { editArrays(ref, fields, false); },
    onUser(cb) { authSubs.add(cb); queueMicrotask(() => cb(current)); return () => authSubs.delete(cb); },
    logOut: async () => setUser(null),
    signInLocal: async (uid) => setUser(LOCAL_USERS.find((u) => u.uid === uid) || null),
    signInGoogle: null,
  };
}

export const {
  collection, docIn, docAt, watch, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, arrayAdd, arrayRemove,
  onUser, logOut, signInLocal, signInGoogle,
} = impl;

import {
  MODE, LOCAL_USERS, collection, docIn, docAt, watch, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc,
  arrayAdd, arrayRemove, onUser, logOut, signInLocal, signInGoogle,
} from "./store.js";

const $ = (s) => document.querySelector(s);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}
const pad = (n) => String(n).padStart(2, "0");
const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const fmtStamp = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
const fmtClock = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" });
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

// 탭(S.tab)과 범위(scope)는 공유 노트 id 또는 "private"(내 노트)
const S = {
  tab: null, uid: null, email: null, myName: "", names: {},
  spaces: [], spacesLoaded: false, nextTab: null, migrated: false,
  notes: {}, trash: {}, projects: {}, pending: {}, loaded: {}, memberInfo: {}, myNick: "",
  notices: {}, seen: {}, seenLoaded: false, draft: null,
  activity: [], activityIds: new Set(), knownMembers: {}, bellOpenedFrom: 0,
  trashView: false, swiped: null, swipeEnd: 0, purged: {},
  invites: [], spaceSubs: {},
  open: null, dirty: false, writes: 0, chain: Promise.resolve(), saveTimer: null,
  panel: null, editProject: null, tabChosen: false, q: "", unsubs: [],
  tabOrder: [], hidePrivate: false, drag: null, select: null, board: false,
};

/* ---------- data ---------- */
const isSpace = (t) => t && t !== "private";
const spaceById = (id) => S.spaces.find((s) => s.id === id);
const spaceName = (id) => (spaceById(id) || {}).name || "노트북";
const notesCol = (scope) => (scope === "private" ? collection("users", S.uid, "notes") : collection("spaces", scope, "notes"));
const projectsCol = (sid) => collection("spaces", sid, "projects");
const spaceRef = (sid) => docAt("spaces", sid);
const inviteRef = (sid, email) => docAt("invites", `${sid}__${email}`);

function errText(e, what) {
  const c = e && e.code;
  if (c === "permission-denied") return `${what} 권한이 없어요.`;
  if (c === "unavailable") return `인터넷 연결이 끊겼어요. 연결되면 자동으로 다시 시도해요.`;
  if (c === "resource-exhausted") return `사용량 한도를 넘었어요. 잠시 후 다시 해 주세요.`;
  return `${what} 실패했어요. (${c || "알 수 없는 오류"})`;
}
function setBanner(text) { const b = $("#banner"); b.textContent = text; b.hidden = !text; }
function setStatus(text) { $("#status").textContent = text; }
// 보여 줄 이름: 닉네임이 있으면 닉네임, 없으면 구글 이름
const nameOf = (id) => (S.names[id] && (S.names[id].nick || S.names[id].name)) || "";
const myLabel = () => S.myNick || S.myName;
const who = (id) => (id && id === S.uid ? "나" : nameOf(id) || "상대방");
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

/* ---------- 계정 ---------- */
// 프로필 사진이 없으면 이름 첫 글자로
function avatar(size) {
  if (S.photo) return el("img", { class: "avatar", src: S.photo, alt: "", referrerpolicy: "no-referrer", width: size, height: size });
  return el("span", { class: "avatar initial", style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`, text: (myLabel() || "?").trim().charAt(0).toUpperCase() });
}
function placeAcctMenu() {
  const menu = $("#acctMenu"), btn = $("#acctBtn");
  if (menu.hidden || !btn) return;
  const r = btn.getBoundingClientRect();
  menu.style.top = r.bottom + 8 + "px";
  menu.style.left = Math.max(16, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 16)) + "px";
}
function toggleAcctMenu(force) {
  const menu = $("#acctMenu"), btn = $("#acctBtn");
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
  if (btn) btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  toggleBell(false);
  const how = MODE === "firebase" ? "Google 계정으로 로그인됨" : MODE === "local" ? "개발 모드 · 이 브라우저에만 저장" : "claude.ai 계정으로 로그인됨";
  const books = orderedTabs().length, shared = S.spaces.filter((sp) => isShared(sp.id)).length;
  menu.replaceChildren(...[
    el("div", { class: "acct-head" }, avatar(44),
      el("div", { class: "acct-who" },
        el("strong", { text: myLabel() }),
        S.email && el("span", { class: "acct-email", text: S.email }))),
    MODE !== "claude" && nickForm(),
    el("div", { class: "acct-status" }, el("span", { class: "acct-on" }), how),
    el("div", { class: "acct-meta", text: `노트북 ${books}개` + (shared ? ` · 공유 ${shared}개` : "") }),
    MODE !== "claude" && el("div", { class: "menu-sep" }),
    MODE !== "claude" && el("button", { type: "button", class: "menu-item", role: "menuitem",
      onclick: async () => { toggleAcctMenu(false); flushSave(); await S.chain; logOut(); } }, MODE === "local" ? "사용자 바꾸기" : "로그아웃"),
  ].filter(Boolean));
  placeAcctMenu();
}
document.addEventListener("click", (e) => { if (!$("#acctMenu").hidden && !e.target.closest("#acctMenu")) toggleAcctMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#acctMenu").hidden) { toggleAcctMenu(false); $("#acctBtn") && $("#acctBtn").focus(); } });
window.addEventListener("resize", placeAcctMenu);

// 닉네임: 2~16자, 한글·영문·숫자·_ . -  (대소문자만 다른 닉네임도 같은 것으로 봄)
const NICK_RE = /^[가-힣a-zA-Z0-9_][가-힣a-zA-Z0-9_.-]{1,15}$/;
function nickForm() {
  const input = el("input", { class: "field", id: "nickIn", type: "text", maxlength: "16", autocomplete: "off", placeholder: "닉네임 (2~16자)", value: S.myNick, "aria-label": "닉네임" });
  const save = el("button", { class: "btn", type: "submit", text: "저장" });
  const msg = el("p", { class: "fld-msg", id: "nickMsg", role: "status" });
  const form = el("form", { class: "acct-nick" },
    el("label", { class: "fld-label", for: "nickIn", text: "닉네임" }),
    el("div", { class: "fld-row" }, input, save), msg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    save.disabled = true;
    const r = await setNickname(input.value);
    save.disabled = false;
    if (r.ok) { $("#acctBtn").replaceChildren(avatar(32)); toggleAcctMenu(true); } // 창 안의 이름·아이콘도 새로
    const m = $("#nickMsg"); m.textContent = r.text; m.classList.toggle("bad", !r.ok);
  });
  return form;
}
async function setNickname(raw) {
  const nick = raw.trim();
  const old = S.myNick, oldKey = old.toLowerCase(), key = nick.toLowerCase();
  if (nick === old) return { ok: true, text: nick ? "지금 쓰는 닉네임이에요." : "" };
  if (nick && (!NICK_RE.test(nick) || nick.startsWith("__"))) return { ok: false, text: "2~16자의 한글, 영문, 숫자, _ . - 만 쓸 수 있어요." };
  try {
    if (nick && key !== oldKey) {
      const cur = await getDoc(docAt("nicknames", key));
      if (cur.exists && cur.data.uid !== S.uid) return { ok: false, text: "이미 다른 사람이 쓰는 닉네임이에요." };
      // 자리 잡기: 이미 누가 잡았으면 서버가 거절함 (동시에 같은 닉네임을 정해도 한 사람만 성공)
      if (!cur.exists) {
        try { await setDoc(docAt("nicknames", key), { uid: S.uid }); }
        catch (e) { return { ok: false, text: e.code === "permission-denied" ? "이미 다른 사람이 쓰는 닉네임이에요." : errText(e, "닉네임 저장에") }; }
      }
    }
    await setDoc(docAt("profiles", S.uid), { name: S.myName, nick }, { merge: true });
    S.myNick = nick;
    if (old && oldKey !== key) deleteDoc(docAt("nicknames", oldKey)).catch(() => {});
    renderAll();
    return { ok: true, text: nick ? "닉네임을 저장했어요." : "닉네임을 지웠어요. 구글 이름으로 보여요." };
  } catch (e) { return { ok: false, text: errText(e, "닉네임 저장에") }; }
}

/* ---------- auth gate ---------- */
function showGate(mode) {
  $("#gate").hidden = false;
  $("#shell").hidden = true;
  document.querySelectorAll(".gate-card").forEach((c) => { c.hidden = c.dataset.gate !== mode; });
  if (mode === "login" && INAPP) {
    showInappHelp();
    // 카카오톡·라인은 바로 바깥 브라우저로 넘길 수 있음 (한 번만)
    if (/KAKAOTALK|\bLine\//i.test(UA) && !sessionStorageGet("alko.extTried")) { sessionStorageSet("alko.extTried", "1"); location.href = externalUrl(); }
  }
}
function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch {} }

// 카카오톡·인스타그램 등 앱 안의 브라우저에서는 구글이 로그인을 막거나, 로그인 창이 닫히면서 앱 화면까지 닫혀 버림.
// 그래서 로그인 대신 바깥 브라우저로 열도록 안내함
const UA = navigator.userAgent;
const INAPP = /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|FB_IAB|\bLine\/|everytimeApp|DaumApps|BAND\/|; wv\)/i.test(UA);
const IOS = /iPhone|iPad|iPod/i.test(UA);
function externalUrl() {
  const url = location.href;
  if (/KAKAOTALK/i.test(UA)) return "kakaotalk://web/openExternal?url=" + encodeURIComponent(url);
  if (/\bLine\//i.test(UA)) return url + (url.includes("?") ? "&" : "?") + "openExternalBrowser=1";
  if (!IOS) return "intent://" + location.host + location.pathname + location.search + "#Intent;scheme=https;package=com.android.chrome;end";
  return null; // 아이폰의 다른 앱은 직접 열 방법이 없어서 주소 복사로 안내
}
function showInappHelp() {
  $("#loginBtn").hidden = true;
  $("#gateInapp").hidden = false;
  $("#openExtBtn").hidden = !externalUrl();
  if (IOS && !externalUrl()) $("#inappHint").textContent = "오른쪽 아래(또는 위) ⋯ 메뉴에서 'Safari로 열기'를 눌러도 돼요.";
}
$("#openExtBtn").addEventListener("click", () => { const u = externalUrl(); if (u) location.href = u; });
$("#copyUrlBtn").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText(location.href); e.currentTarget.textContent = "복사했어요. 브라우저 주소창에 붙여 넣으세요"; }
  catch { e.currentTarget.textContent = location.href; }
});

async function login() {
  $("#gateMsg").textContent = "";
  if (INAPP) { showInappHelp(); return; }
  try {
    await signInGoogle();
  } catch (e) {
    if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      $("#gateMsg").textContent = e.code === "auth/unauthorized-domain"
        ? "이 주소가 Firebase 인증에 등록되지 않았어요. 콘솔 > Authentication > 설정 > 승인된 도메인에 추가해 주세요."
        : "로그인하지 못했어요. (" + e.code + ")";
    }
  }
}

function teardown() {
  toggleAcctMenu(false);
  toggleBell(false);
  S.unsubs.forEach((u) => u());
  Object.values(S.spaceSubs).forEach((list) => list.forEach((u) => u()));
  Object.assign(S, {
    unsubs: [], spaceSubs: {}, uid: null, email: null, names: {}, spaces: [], spacesLoaded: false, tab: null, nextTab: null,
    notes: {}, trash: {}, projects: {}, pending: {}, loaded: {}, memberInfo: {}, myNick: "", notices: {}, seen: {}, seenLoaded: false, draft: null, activity: [], activityIds: new Set(), knownMembers: {}, invites: [], open: null, dirty: false, trashView: false, swiped: null, purged: {},
    panel: null, editProject: null, migrated: false, tabChosen: false, tabOrder: [], hidePrivate: false, drag: null,
  });
}

function start(u) {
  S.uid = u.uid;
  S.email = (u.email || "").toLowerCase() || null;
  S.myName = u.displayName || u.email || "나";
  S.myNick = "";
  $("#gate").hidden = true;
  $("#shell").hidden = false;
  S.photo = u.photoURL || "";
  // 오른쪽 위: 계정 아이콘 하나. 누르면 로그인 상태 창
  $("#me").replaceChildren(
    el("button", { class: "icon-btn bell-btn", id: "bellBtn", "aria-label": "알림", title: "알림", "aria-haspopup": "dialog", "aria-expanded": "false",
      onclick: (e) => { e.stopPropagation(); toggleBell(); } },
      svg('<path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8z"/><path d="M8.5 16.5a1.6 1.6 0 0 0 3 0"/>'),
      el("span", { class: "bell-badge", id: "bellBadge", hidden: true })),
    el("button", { class: "acct-btn", id: "acctBtn", "aria-label": `계정: ${S.myName}`, title: S.myName, "aria-haspopup": "dialog", "aria-expanded": "false",
    onclick: (e) => { e.stopPropagation(); toggleAcctMenu(); } }, avatar(32)));
  setDoc(docAt("profiles", u.uid), { name: S.myName }, { merge: true }).catch(() => {});

  const onErr = (e) => setBanner(errText(e, "불러오기에"));
  S.notes.private = [];
  S.unsubs.push(
    // 탭 순서는 사람마다 따로 저장 (users/<나>/prefs/tabs)
    watch(collection("users", S.uid, "prefs"), {}, (s) => {
      const seenDoc = s.docs.find((x) => x.id === "seen");
      S.seen = (seenDoc && seenDoc.data()) || {}; S.seenLoaded = true; renderNotices(); renderBell();
      const d = s.docs.find((x) => x.id === "tabs");
      S.tabOrder = (d && d.data().order) || [];
      S.hidePrivate = !!(d && d.data().hidePrivate);
      // 지운 '노트' 노트북을 보고 있었다면 다른 노트북으로
      if (S.tab === "private" && !orderedTabs().some((t) => t.id === "private")) { S.tab = orderedTabs()[0].id; S.open = null; renderAll(); if (isSpace(S.tab)) renderProjects(); return; }
      // 처음 열 때는 내가 정한 순서의 첫 탭을 보여 줌
      if (!S.tabChosen && !S.open && !S.panel && S.spacesLoaded) { S.tab = orderedTabs()[0].id; renderAll(); if (isSpace(S.tab)) renderProjects(); }
      else renderTabs();
    }, () => {}),
    watch(collection("profiles"), {}, (s) => {
      S.names = Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
      const mine = S.names[S.uid];
      if (mine && MODE !== "claude" && (mine.nick || "") !== S.myNick) { S.myNick = mine.nick || ""; if ($("#acctBtn")) $("#acctBtn").replaceChildren(avatar(32)); }
      renderRail();
      if (S.panel) renderPanelLists();
      if (S.open) { const n = (S.notes[S.open.scope] || []).find((x) => x.id === S.open.id); if (n) renderMeta(S.open.scope, n); }
    }, onErr),
    watch(collection("spaces"), { where: ["members", "array-contains", S.uid], metadata: true }, (s) => onSpaces(s.docs.map((d) => ({
      id: d.id, ...d.data(), pendingServer: !!(d.metadata && d.metadata.hasPendingWrites && !S.spaceSubs[d.id]),
    }))), onErr),
    watch(notesCol("private"), { byUpdated: true }, (s) => onNotes("private", docs(s), s), onErr),
  );
  S.unsubs.push(watch(collection("users", S.uid, "activity"), {}, (s) => {
    S.activity = docs(s).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    S.activity.forEach((a) => S.activityIds.add(a.id));
    renderBell();
  }, () => {}));
  if (S.email) S.unsubs.push(watch(collection("invites"), { where: ["email", "==", S.email] }, (s) => { S.invites = docs(s); renderInvites(); },
    (e) => setBanner(e && e.code === "permission-denied" ? `받은 초대장을 불러오지 못했어요. (${S.email}) 다시 로그인해 보세요.` : errText(e, "초대장 불러오기에"))));
  renderAll();
}

// 내가 속한 공유 노트 목록이 바뀌면 각 공유 노트의 노트/프로젝트/일정 구독을 맞춤
function onSpaces(list) {
  S.spaces = list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  // 내 노트북에 누가 새로 들어오면 기록 (앱을 켜 둔 동안 본 것)
  for (const sp of list) {
    const known = S.knownMembers[sp.id];
    if (known) for (const id of sp.members || []) if (!known.includes(id) && id !== S.uid)
      logActivity(`join_${sp.id}_${id}`, { type: "joined", uid: id, name: nameOf(id), email: (S.memberInfo[sp.id] && S.memberInfo[sp.id][id] && S.memberInfo[sp.id][id].email) || "", spaceName: sp.name || "", createdAt: Date.now() });
    S.knownMembers[sp.id] = [...(sp.members || [])];
    // 2명 이상이 되면 공유 성사로 표시하고, 다른 멤버가 다 나가 나만 남으면 다시 나만 쓰는 노트북으로 되돌림
    const many = (sp.members || []).length > 1;
    if (!sp.pendingServer && many && sp.confirmed !== true)
      updateDoc(spaceRef(sp.id), { confirmed: true, shared: true }).catch(() => {});
    if (!sp.pendingServer && !many && sp.confirmed === true && (sp.members || [])[0] === S.uid)
      updateDoc(spaceRef(sp.id), { confirmed: false, shared: false, updatedAt: Date.now() }).catch(() => {});
  }
  const ids = new Set(list.map((s) => s.id));
  for (const sid of Object.keys(S.spaceSubs)) {
    if (!ids.has(sid)) {
      S.spaceSubs[sid].forEach((u) => u());
      delete S.spaceSubs[sid]; delete S.notes[sid]; delete S.trash[sid]; delete S.memberInfo[sid]; delete S.notices[sid]; delete S.projects[sid]; delete S.pending[sid]; delete S.loaded[sid];
      if (S.open && S.open.scope === sid) { S.open = null; S.dirty = false; }
      if (S.panel === sid) S.panel = null;
    }
  }
  const onErr = (e) => setBanner(errText(e, "불러오기에"));
  for (const sid of ids) {
    // 방금 만든 공유 노트는 서버가 확인한 뒤에 구독 (먼저 구독하면 권한 없음으로 끊김)
    if (S.spaceSubs[sid] || list.find((s) => s.id === sid).pendingServer) continue;
    S.notes[sid] = []; S.projects[sid] = []; S.pending[sid] = [];
    S.spaceSubs[sid] = [
      watch(notesCol(sid), { byUpdated: true }, (s) => onNotes(sid, docs(s), s), onErr),
      watch(projectsCol(sid), {}, (s) => { S.projects[sid] = docs(s); S.loaded["p:" + sid] = true; if (S.tab === sid) { renderProjects(); renderRail(); } }, onErr),
      watch(collection("invites"), { where: ["spaceId", "==", sid] }, (s) => {
        S.pending[sid] = docs(s);
        // 지금까지 내가 보낸 (아직 수락 전인) 초대도 기록에 남김
        for (const inv of S.pending[sid]) if (inv.invitedBy === S.uid) logActivity(`sent_${inv.id}_${inv.createdAt || 0}`, { type: "sent", email: inv.email, spaceName: inv.spaceName || "", createdAt: inv.createdAt || Date.now() });
        if (S.panel === sid) renderPanelLists();
      }, () => {}),
      watch(collection("spaces", sid, "notices"), {}, (s) => { S.notices[sid] = docs(s); renderNotices(); }, () => {}),
      // 멤버 이메일 (멤버끼리만 보임). 내 것이 없으면 적어 둠
      watch(collection("spaces", sid, "members"), {}, (s) => {
        S.memberInfo[sid] = Object.fromEntries(docs(s).map((d) => [d.id, d]));
        if (!s.metadata.fromCache && S.email && !S.memberInfo[sid][S.uid]) setDoc(docAt("spaces", sid, "members", S.uid), { email: S.email }).catch(() => {});
        if (S.panel === sid) renderPanelLists();
      }, () => {}),
    ];
  }
  // 노트북을 모두 지워서 '노트'가 다시 나타났으면, 그 뒤로는 계속 보이게
  if (S.spacesLoaded && !list.length && S.hidePrivate) { S.hidePrivate = false; savePrefs(); }
  if (!S.spacesLoaded) { S.spacesLoaded = true; migrateLegacy(); }
  if (S.nextTab && ids.has(S.nextTab)) { S.tab = S.nextTab; S.nextTab = null; }
  // 사용자가 직접 탭을 고르기 전이면 첫 공유 노트를 보여 줌
  const autoPick = !S.tabChosen && S.tab === "private" && !S.open && list.length;
  const privateGone = S.tab === "private" && S.hidePrivate && list.length;
  if (!S.tab || autoPick || privateGone || (isSpace(S.tab) && !ids.has(S.tab))) S.tab = S.tabChosen ? (list.length ? list[0].id : "private") : orderedTabs()[0].id;
  renderAll();
  if (S.panel && S.panel !== "new") renderPanelLists();
}

// 휴지통: 지운 노트는 deletedAt 을 달아 두고 목록에서만 뺌. 30일이 지나면 완전히 지움
const TRASH_DAYS = 30;
function onNotes(scope, list, snap) {
  if (S.draft && S.draft.scope === scope && !list.some((n) => n.id === S.draft.id)) list = [S.draft.note, ...list];
  S.notes[scope] = list.filter((n) => !n.deletedAt);
  S.trash[scope] = list.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
  if (!snap.metadata.fromCache && !S.purged[scope]) {
    S.purged[scope] = true;
    const old = S.trash[scope].filter((n) => Date.now() - n.deletedAt > TRASH_DAYS * 86400000);
    old.forEach((n) => queue(() => deleteDoc(docIn(notesCol(scope), n.id)).catch(() => {})));
  }
  S.loaded[scope] = true;
  if (S.open && S.open.scope === scope) {
    const n = list.find((x) => x.id === S.open.id);
    if (!n && !snap.metadata.fromCache && !S.writes) closeEditor();
    else if (n && !S.dirty && !S.writes) syncEditor(n);
  }
  if (S.tab === scope || S.trashView) renderRail();
}

// 예전 버전(공유 노트가 하나뿐이던 때)의 데이터를 "공유 노트"라는 이름의 공유 노트로 옮김
async function migrateLegacy() {
  if (S.migrated) return;
  S.migrated = true;
  try {
    const [notes, projects, events] = await Promise.all(["notes", "projects", "events"].map((c) => getDocs(collection(c))));
    if (!notes.length && !projects.length && !events.length) return;
    const ref = spaceRef("legacy");
    const cur = await getDoc(ref);
    if (!cur.exists) {
      const now = Date.now();
      await setDoc(ref, { name: "공유 노트북", owner: S.uid, members: [S.uid], memberEmails: S.email ? [S.email] : [], createdAt: now, updatedAt: now });
      for (const [list, col] of [[notes, "notes"], [projects, "projects"], [events, "events"]]) {
        for (const { id, ...v } of list) await setDoc(docIn(collection("spaces", "legacy", col), id), v);
      }
    } else if (!(cur.data.members || []).includes(S.uid)) {
      await arrayAdd(ref, S.email ? { members: S.uid, memberEmails: S.email } : { members: S.uid });
    }
  } catch { /* 예전 데이터가 없거나 읽을 수 없으면 건너뜀 */ }
}

/* ---------- 받은 초대 ---------- */
// 받은 초대장은 종 알림에 보이고, 기록에도 남김
function renderInvites() {
  for (const inv of S.invites) logActivity(`recv_${inv.id}_${inv.createdAt || 0}`, {
    type: "received", uid: inv.invitedBy || "", name: inv.invitedByName || "", email: inv.invitedByEmail || "", spaceName: inv.spaceName || "", createdAt: inv.createdAt || Date.now() });
  renderBell();
}

async function acceptInvite(inv) {
  try {
    await arrayAdd(spaceRef(inv.spaceId), { members: S.uid, memberEmails: S.email });
    S.nextTab = inv.spaceId;
    await deleteDoc(docAt("invites", inv.id));
    logActivity(`acc_${inv.id}_${Date.now()}`, { type: "accepted", uid: inv.invitedBy || "", name: inv.invitedByName || "", spaceName: inv.spaceName || "", createdAt: Date.now() });
  } catch (e) { setBanner(errText(e, "초대 수락에")); }
}
function declineInvite(inv) {
  deleteDoc(docAt("invites", inv.id)).catch((e) => setBanner(errText(e, "초대 거절에")));
  logActivity(`dec_${inv.id}_${Date.now()}`, { type: "declined", uid: inv.invitedBy || "", name: inv.invitedByName || "", spaceName: inv.spaceName || "", createdAt: Date.now() });
}

/* ---------- 알림 (종): 받은 초대 + 기록 ---------- */
// 기록은 사람마다 users/<나>/activity 에 남김. 같은 일은 같은 id 라서 여러 번 적어도 하나만 남음
function logActivity(id, entry) {
  if (!S.uid || S.activityIds.has(id)) return;
  S.activityIds.add(id);
  setDoc(docAt("users", S.uid, "activity", id), entry).catch(() => S.activityIds.delete(id));
}
// 알림 지우기: 문서를 없애지 않고 deleted 표시만 남김 (아직 대기 중인 초대 기록이 다시 생기지 않도록)
function deleteActivity(list) {
  const ids = new Set(list.map((a) => a.id));
  S.activity = S.activity.map((a) => (ids.has(a.id) ? { ...a, deleted: true } : a));
  renderBell();
  for (const a of list) setDoc(docAt("users", S.uid, "activity", a.id), { deleted: true, createdAt: a.createdAt || 0 }).catch(() => {});
}
const INCOMING = new Set(["received", "joined", "left"]);
function activityText(a) {
  const book = `‘${a.spaceName || "노트북"}’`;
  const who = (a.uid && a.uid !== S.uid && nameOf(a.uid)) || a.name || "누군가";
  const mail = a.email ? ` (${a.email})` : "";
  switch (a.type) {
    case "sent": return [`${book} 노트북에 `, el("strong", { text: a.email || "" }), " 님을 초대했어요"];
    case "received": return [el("strong", { text: who }), `${mail}님이 ${book} 노트북에 초대했어요`];
    case "accepted": return [`${who}님의 ${book} 노트북 초대를 수락했어요`];
    case "declined": return [`${who}님의 ${book} 노트북 초대를 거절했어요`];
    case "joined": return [el("strong", { text: who }), `${mail}님이 ${book} 노트북에 들어왔어요`];
    case "left": return [el("strong", { text: who }), `${mail}님이 ${book} 노트북에서 나갔어요`];
    default: return [""];
  }
}
function renderBell() {
  const btn = $("#bellBtn");
  if (!btn) return;
  const lastSeen = S.seen._bell || 0;
  const unread = S.activity.filter((a) => !a.deleted && (a.type === "joined" || a.type === "left") && a.createdAt > lastSeen).length;
  const count = S.invites.length + unread;
  const badge = $("#bellBadge");
  badge.hidden = !count; badge.textContent = count > 9 ? "9+" : String(count);
  btn.setAttribute("aria-label", count ? `알림 ${count}개` : "알림");
  if (!$("#bellMenu").hidden) fillBell();
}
function fillBell() {
  const lastSeen = S.bellOpenedFrom || 0;
  const invites = S.invites.map((inv) => el("div", { class: "bell-invite" },
    el("div", { class: "bell-text" }, el("strong", { text: inv.invitedByName || "누군가" }), inv.invitedByEmail ? ` (${inv.invitedByEmail})` : "", "님이 ",
      el("strong", { text: `‘${inv.spaceName || "공유 노트북"}’` }), " 노트북에 초대했어요"),
    el("div", { class: "bell-actions" },
      el("button", { class: "link", text: "거절", onclick: () => declineInvite(inv) }),
      el("button", { class: "btn primary", text: "수락", onclick: () => { acceptInvite(inv); toggleBell(false); } }))));
  const shown = S.activity.filter((a) => !a.deleted);
  const log = shown.slice(0, 50).map((a) => el("div", { class: "bell-item" + (INCOMING.has(a.type) && a.createdAt > lastSeen ? " unread" : "") },
    el("span", { class: "bell-dot " + a.type }),
    el("div", { class: "bell-body" }, el("div", { class: "bell-text" }, ...activityText(a)), el("div", { class: "bell-time", text: fmtStamp.format(a.createdAt) })),
    el("button", { class: "icon-btn bell-del", "aria-label": "이 알림 지우기", title: "지우기", onclick: (e) => { e.stopPropagation(); deleteActivity([a]); } },
      svg('<path d="M6 6l8 8M14 6l-8 8"/>'))));
  $("#bellMenu").replaceChildren(...[
    el("div", { class: "menu-label bell-title", text: "알림" }),
    invites.length && el("div", { class: "bell-sec" }, el("div", { class: "menu-label", text: "받은 초대" }), ...invites),
    el("div", { class: "bell-sec" },
      el("div", { class: "menu-label bell-head" }, el("span", { text: "기록" }),
        shown.length ? el("button", { class: "link", text: "모두 지우기", onclick: (e) => { e.stopPropagation(); deleteActivity(shown); } }) : null),
      ...(log.length ? log : [el("p", { class: "hint tight bell-empty", text: "아직 기록이 없어요." })])),
  ].filter(Boolean));
  placeBell();
}
function placeBell() {
  const menu = $("#bellMenu"), btn = $("#bellBtn");
  if (menu.hidden || !btn) return;
  const r = btn.getBoundingClientRect();
  menu.style.top = r.bottom + 8 + "px";
  menu.style.left = Math.max(16, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 16)) + "px";
}
function toggleBell(force) {
  const menu = $("#bellMenu"), btn = $("#bellBtn");
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
  if (btn) btn.setAttribute("aria-expanded", String(open));
  if (!open) return;
  toggleAcctMenu(false);
  // 열어 보면 읽은 것으로 (이번에 열었을 때는 새 기록을 강조해서 보여 줌)
  S.bellOpenedFrom = S.seen._bell || 0;
  fillBell();
  if (S.uid) { S.seen = { ...S.seen, _bell: Date.now() }; setDoc(docAt("users", S.uid, "prefs", "seen"), S.seen).catch(() => {}); renderBell(); }
}
document.addEventListener("click", (e) => { if (!$("#bellMenu").hidden && !e.target.closest("#bellMenu")) toggleBell(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#bellMenu").hidden) { toggleBell(false); $("#bellBtn") && $("#bellBtn").focus(); } });
window.addEventListener("resize", placeBell);

/* ---------- tabs & views ---------- */
// 톱니바퀴 (24 격자로 그려서 동그랗게)
function gearIcon() {
  const g = svg('<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>', "1.7");
  g.setAttribute("viewBox", "0 0 24 24");
  return g;
}
const svg = (d, w = "1.8") => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 20 20"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", w); s.setAttribute("stroke-linecap", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = d;
  return s;
};

function renderAll() { renderTabs(); renderView(); renderRail(); }

// 저장된 순서대로. 순서에 없는 탭(새로 만들었거나 초대받은 탭)은 뒤에 붙음
function orderedTabs() {
  const tabs = S.spaces.map((s) => ({ id: s.id, name: s.name || "노트북" }));
  // '노트' 노트북은 지웠으면 숨김. 단, 노트북이 하나도 없으면 다시 보여 줌
  if (!S.hidePrivate || !tabs.length) tabs.push({ id: "private", name: "노트" });
  const rank = (id) => { const i = S.tabOrder.indexOf(id); return i < 0 ? Infinity : i; };
  return tabs.map((t, i) => ({ ...t, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i);
}

function renderTabs() {
  if (S.drag && S.drag.active) { S.drag.stale = true; return; } // 끌고 있는 중엔 다시 그리지 않음
  $("#tabs").replaceChildren(
    ...orderedTabs().map((t) => el("button", { class: "tab " + scopeClass(t.id), role: "tab", "data-id": t.id, "aria-selected": String(t.id === S.tab && !S.trashView),
      title: "끌어서 순서 바꾸기 (Alt + ←/→)",
      onclick: (e) => { if (S.drag && S.drag.justDropped) { e.preventDefault(); return; } switchTab(t.id); },
      onpointerdown: (e) => dragStart(e, t.id),
      onkeydown: (e) => { if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { e.preventDefault(); moveTab(t.id, e.key === "ArrowLeft" ? -1 : 1); } } },
      el("span", { class: "dot" }), t.name)));
  // 고른 노트북이 바뀌면 그 탭이 보이도록 탭 줄을 넘겨 줌 (휴대폰처럼 좁을 때)
  const picked = $("#tabs .tab[aria-selected='true']");
  if (picked && S.shownTab !== S.tab) { S.shownTab = S.tab; picked.scrollIntoView({ block: "nearest", inline: "nearest" }); }
  // 노트북 줄 오른쪽 끝에 고정: [+ 새 노트북] [⚙ 노트북 설정] [🗑 휴지통]
  const gearName = S.tab === "private" ? "노트" : spaceName(S.tab);
  $("#tabFixed").replaceChildren(...[
    el("button", { class: "icon-btn tab-add", id: "tabAdd", "aria-label": "새 노트북 만들기", title: "새 노트북 만들기", "aria-haspopup": "dialog", "aria-expanded": String(!$("#newMenu").hidden), "aria-controls": "newMenu",
      onclick: (e) => { e.stopPropagation(); toggleNewMenu(); } }, svg('<path d="M10 4v12M4 10h12"/>')),
    S.tab && el("button", { class: "icon-btn nb-gear", "aria-label": `‘${gearName}’ 노트북 설정`, title: "노트북 설정", "aria-expanded": String(!S.trashView && S.panel === S.tab),
      onclick: () => { if (S.trashView) S.trashView = false; else if (S.panel === S.tab) return closePanel(); openPanel(S.tab); } }, gearIcon()),
    // 휴지통: 모든 노트북에서 지운 노트를 한곳에 모아 보여 줌
    el("button", { class: "icon-btn nb-trash", "aria-label": "휴지통", title: "휴지통", "aria-pressed": String(S.trashView), onclick: () => openTrash(!S.trashView) },
      svg('<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>')),
  ].filter(Boolean));
}


/* ---------- 노트북 순서 바꾸기 (끌어서 놓기) ---------- */
// 마우스는 조금 움직이면 바로, 터치는 꾹 누른 뒤(0.35초) 끌기 시작. 그냥 밀면 탭 줄이 스크롤됨
function dragStart(e, id) {
  if (e.button !== 0) return;
  const tab = e.currentTarget;
  const d = S.drag = { id, tab, x: e.clientX, y: e.clientY, active: false, touch: e.pointerType !== "mouse" };
  if (d.touch) d.timer = setTimeout(() => activate(d), 350);
  window.addEventListener("pointermove", dragMove);
  window.addEventListener("pointerup", dragEnd);
  window.addEventListener("pointercancel", dragEnd);
}
function activate(d) {
  if (S.drag !== d) return;
  d.active = true;
  d.tab.classList.add("dragging");
  $("#tabs").classList.add("reordering");
  if (navigator.vibrate) try { navigator.vibrate(10); } catch {}
}
function dragMove(e) {
  const d = S.drag;
  if (!d || !d.tab) return;
  if (!d.active) {
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (d.touch) { if (moved > 8) cleanupDrag(); return; } // 꾹 누르기 전에 움직이면 스크롤로 봄
    if (moved < 5) return;
    activate(d);
  }
  // 손가락/마우스가 지나간 탭 자리로 옮김
  const others = [...$("#tabs").querySelectorAll(".tab:not(.dragging)")];
  const after = others.find((t) => { const r = t.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; });
  if (after) $("#tabs").insertBefore(d.tab, after); else $("#tabs").append(d.tab);
}
function dragEnd() {
  const d = S.drag;
  if (!d) return;
  const wasActive = d.active;
  cleanupDrag();
  if (!wasActive) return;
  S.drag = { justDropped: true };
  setTimeout(() => { if (S.drag && S.drag.justDropped) S.drag = null; }, 0);
  saveTabOrder([...$("#tabs").querySelectorAll(".tab")].map((t) => t.dataset.id));
}
function cleanupDrag() {
  const d = S.drag;
  if (!d || !d.tab) return;
  clearTimeout(d.timer);
  window.removeEventListener("pointermove", dragMove);
  window.removeEventListener("pointerup", dragEnd);
  window.removeEventListener("pointercancel", dragEnd);
  d.tab.classList.remove("dragging");
  $("#tabs").classList.remove("reordering");
  const stale = d.stale;
  S.drag = null;
  if (stale) renderTabs();
}
function moveTab(id, delta) {
  const ids = orderedTabs().map((t) => t.id);
  const i = ids.indexOf(id), j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveTabOrder(ids);
  const t = $(`#tabs .tab[data-id="${id}"]`);
  if (t) t.focus();
}
function saveTabOrder(ids) {
  S.tabOrder = ids;
  renderTabs();
  savePrefs();
}
function savePrefs() {
  setDoc(docAt("users", S.uid, "prefs", "tabs"), { order: S.tabOrder, hidePrivate: S.hidePrivate, updatedAt: Date.now() })
    .catch((e) => setBanner(errText(e, "노트북 설정 저장에")));
}
// '노트' 노트북 삭제: 안의 노트를 지우고 노트북 줄에서 숨김
async function removePrivate() {
  if (S.open && S.open.scope === "private") { clearTimeout(S.saveTimer); S.open = null; S.dirty = false; }
  S.hidePrivate = true; S.panel = null;
  S.tab = orderedTabs()[0].id;
  renderAll(); if (isSpace(S.tab)) renderProjects();
  savePrefs();
  try {
    for (const n of [...(S.notes.private || []), ...(S.trash.private || [])]) await deleteDoc(docIn(notesCol("private"), n.id));
  } catch (e) { setBanner(errText(e, "노트 삭제에")); }
}
// 끄는 중 화면이 밀리지 않게 (터치)
$("#tabs").addEventListener("touchmove", (e) => { if (S.drag && S.drag.active) e.preventDefault(); }, { passive: false });

// 색 구분: 공유 노트 = 파랑, 초대 수락 대기 = 노랑, 내 노트 = 호박색
const isShared = (scope) => {
  if (scope === "private") return false;
  const sp = spaceById(scope);
  return !sp || sp.shared !== false || (sp.members || []).length > 1;
};
// 공유가 성사됐는지: 지금 2명 이상이 함께 쓰는 노트북. 그동안은 일반 노트북으로 되돌릴 수 없음
const isConfirmed = (sp) => !sp || (sp.members || []).length > 1;
const scopeKind = (scope) => (!isShared(scope) ? "private" : isConfirmed(spaceById(scope)) ? "shared" : "pending");
const scopeClass = (scope) => "scope-" + scopeKind(scope);

function renderView() {
  $("#app").dataset.scope = scopeKind(S.tab);
  const panel = !!S.panel;
  const hasOpen = !panel && S.open && S.open.scope === S.tab;
  $("#spaceView").hidden = !panel;
  $("#editorView").hidden = !hasOpen;
  const board = isSpace(S.tab) && S.board;
  $("#projView").hidden = panel || hasOpen || !board;
  $("#emptyView").hidden = panel || hasOpen || board;
  $("#emptyText").textContent = S.trashView ? "지운 노트는 휴지통에서 되살리거나 완전히 지울 수 있어요." : "목록에서 노트를 열거나 + 로 새 노트를 만드세요.";

}

function switchTab(tab) {
  if (tab === S.tab && !S.panel && !S.trashView) return;
  flushSave();
  endSelect();
  S.tab = tab; S.panel = null; S.editProject = null; S.tabChosen = true; S.board = false; S.trashView = false; S.swiped = null;
  closeSearch();
  $("#app").dataset.view = "list";
  renderTabs(); renderView(); renderRail();
  if (isSpace(tab)) renderProjects();
}

function renderRail() {
  const pane = $("#list");
  if (!S.tab) return;
  const scope = S.tab;
  if (!S.loaded[scope]) { pane.replaceChildren(el("div", { class: "hint", text: "불러오는 중…" })); return; }
  $("#listTools").hidden = S.trashView || !!S.select;
  $("#trashBar").hidden = !S.trashView;
  if (S.trashView) { renderTrash(); return; }
  dropDraft();
  const all = S.notes[scope] || [];
  const q = S.q.trim().toLowerCase();
  const items = q ? all.filter((n) => ((n.title || "") + "\n" + (n.body || "")).toLowerCase().includes(q)) : all;
  const entry = isSpace(scope) && !q && !S.select ? projectEntry() : null;
  $("#selectBtn").hidden = !all.length;
  if (S.select) renderSelectBar(items);

  if (!all.length) {
    pane.replaceChildren(...[entry, el("div", { class: "hint", text: "아직 노트가 없어요. + 를 눌러 시작해 보세요." })].filter(Boolean));
    return;
  }
  if (!items.length) { pane.replaceChildren(el("div", { class: "hint", text: `‘${S.q}’ 검색 결과가 없어요.` })); return; }

  pane.replaceChildren(...[entry].filter(Boolean), ...items.map((n) => {
    const on = !S.panel && S.open && S.open.scope === scope && S.open.id === n.id;
    const snip = (n.body || "").split("\n").find((l) => l.trim()) || "";
    const meta = (isSpace(scope) ? who(n.updatedBy) + " · " : "") + (n.updatedAt ? fmtStamp.format(n.updatedAt) : "");
    const parts = [
      el("span", { class: "item-title" + (n.title ? "" : " untitled"), text: n.title || "제목 없음" }),
      el("span", { class: "item-snip", text: snip }),
      el("span", { class: "item-meta", text: meta }),
    ];
    if (S.select) {
      const picked = S.select.has(n.id);
      return el("button", { class: "item selecting" + (picked ? " picked" : ""), role: "checkbox", "aria-checked": String(picked), onclick: () => togglePick(n.id) },
        el("span", { class: "sel-box" }), el("span", { class: "item-body" }, parts));
    }
    const item = el("button", { class: "item" + (on ? " on" : ""), onclick: () => {
      if (Date.now() - S.swipeEnd < 400) return; // 밀고 손을 뗄 때 생기는 클릭은 무시
      if (S.swiped) { closeSwipe(); return; }
      openNote(scope, n.id);
    } }, parts);
    const row = el("div", { class: "swipe" + (S.swiped === n.id ? " open" : "") },
      el("button", { class: "swipe-del", tabindex: "-1", text: "삭제", onclick: () => trashNotes(scope, [n.id]) }), item);
    swipeable(row, item, n.id);
    return row;
  }));
}

// 휴지통 화면: 되살리기 / 완전히 지우기 / 비우기 (모든 노트북)
function renderTrash() {
  const list = trashedNotes();
  const empty = el("button", { class: "link danger", text: "비우기", disabled: !list.length });
  empty.addEventListener("click", () => arm(empty, "한 번 더 누르면 모두 지움", () => {
    for (const scope of new Set(list.map((n) => n.scope))) purgeNotes(scope, list.filter((n) => n.scope === scope).map((n) => n.id));
  }));
  $("#trashBar").replaceChildren(
    el("span", { class: "trash-count", text: list.length ? `지운 노트 ${list.length}개` : "" }),
    el("span", { class: "grow" }), empty);
  const hint = el("div", { class: "hint", text: list.length ? `지운 노트는 ${TRASH_DAYS}일 뒤 완전히 지워져요.` : "휴지통이 비어 있어요." });
  $("#list").replaceChildren(hint, ...list.map((n) => {
    const purge = el("button", { class: "link danger", text: "완전히 삭제" });
    purge.addEventListener("click", () => arm(purge, "한 번 더", () => purgeNotes(n.scope, [n.id])));
    const book = n.scope === "private" ? "노트" : spaceName(n.scope);
    return el("div", { class: "item trashed " + scopeClass(n.scope) },
      el("span", { class: "item-title" + (n.title ? "" : " untitled"), text: n.title || "제목 없음" }),
      el("span", { class: "item-snip", text: (n.body || "").split("\n").find((l) => l.trim()) || "" }),
      el("span", { class: "item-meta" }, el("span", { class: "dot" }), ` ${book} · ` + (isSpace(n.scope) ? who(n.deletedBy) + " · " : "") + fmtStamp.format(n.deletedAt) + " 삭제"),
      el("span", { class: "trash-actions" },
        el("button", { class: "link", text: "되살리기", onclick: () => restoreNote(n.scope, n.id) }), purge));
  }));
}

// 휴대폰: 노트를 왼쪽으로 밀면 빨간 삭제 버튼이 나옴
const SWIPE_W = 80;
// 다른 곳을 누르면 열린 삭제 버튼을 닫음
document.addEventListener("pointerdown", (e) => { if (S.swiped && !e.target.closest(".swipe.open")) closeSwipe(); });
function closeSwipe() {
  S.swiped = null;
  document.querySelectorAll(".swipe.open").forEach((r) => { r.classList.remove("open"); r.lastChild.style.transform = ""; });
}
function swipeable(row, item, id) {
  let x0 = 0, y0 = 0, dx = 0, mode = null, base = 0;
  item.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; mode = "wait";
    base = row.classList.contains("open") ? -SWIPE_W : 0;
  });
  item.addEventListener("pointermove", (e) => {
    if (!mode) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (mode === "wait") {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      if (Math.abs(my) > Math.abs(mx)) { mode = null; return; } // 세로로 움직이면 스크롤
      mode = "drag";
      if (S.swiped && S.swiped !== id) closeSwipe();
      item.setPointerCapture(e.pointerId);
      row.classList.add("dragging");
    }
    dx = Math.max(-SWIPE_W - 24, Math.min(0, base + mx));
    item.style.transform = `translateX(${dx}px)`;
  });
  const end = () => {
    if (mode === "drag") {
      row.classList.remove("dragging");
      const open = dx < -SWIPE_W / 2;
      item.style.transform = open ? `translateX(${-SWIPE_W}px)` : "";
      row.classList.toggle("open", open);
      S.swiped = open ? id : null;
      S.swipeEnd = Date.now();
    }
    mode = null;
  };
  item.addEventListener("pointerup", end);
  item.addEventListener("pointercancel", end);
  if (S.swiped === id) item.style.transform = `translateX(${-SWIPE_W}px)`;
}

/* ---------- 노트 골라서 지우기 ---------- */
const visibleNotes = () => {
  const q = S.q.trim().toLowerCase();
  const all = S.notes[S.tab] || [];
  return q ? all.filter((n) => ((n.title || "") + "\n" + (n.body || "")).toLowerCase().includes(q)) : all;
};
function startSelect() {
  S.select = new Set();
  $("#listTools").hidden = true;
  $("#selectBar").hidden = false;
  renderRail();
  $("#selAll").focus();
}
function endSelect() {
  if (!S.select) return;
  S.select = null;
  $("#selectBar").hidden = true;
  $("#listTools").hidden = false;
  disarm($("#selDelete"), "삭제");
  renderRail();
}
function togglePick(id) {
  S.select.has(id) ? S.select.delete(id) : S.select.add(id);
  disarm($("#selDelete"), "삭제");
  renderRail();
}
function renderSelectBar(items) {
  // 지워졌거나 검색에서 빠진 노트는 선택에서도 뺌
  const ids = new Set(items.map((n) => n.id));
  for (const id of [...S.select]) if (!ids.has(id)) S.select.delete(id);
  const n = S.select.size;
  const all = $("#selAll");
  all.checked = n > 0 && n === items.length;
  all.indeterminate = n > 0 && n < items.length;
  $("#selCount").textContent = n ? `${n}개 선택` : "전체 선택";
  const del = $("#selDelete");
  del.disabled = !n;
  if (!del.classList.contains("armed")) del.textContent = n ? `${n}개 삭제` : "삭제";
}
async function deletePicked() {
  const scope = S.tab;
  const ids = [...S.select];
  if (!ids.length) return;
  endSelect();
  trashNotes(scope, ids);
}

// 돋보기 아이콘을 누르면 검색창이 펼쳐지고, 닫으면 검색어도 지움
function openSearch() {
  $("#searchBox").hidden = false;
  $("#searchBtn").hidden = true;
  $("#search").focus();
}
function closeSearch() {
  $("#searchBox").hidden = true;
  $("#searchBtn").hidden = false;
  $("#selectBtn").hidden = !(S.notes[S.tab] || []).length;
  if (S.q) { S.q = ""; $("#search").value = ""; renderRail(); }
}

// 목록 맨 위의 프로젝트 카드: 진행 중 개수 + 가까운 마감 두 개
function projectEntry() {
  const active = activeProjects(S.tab);
  const soon = active.filter((p) => p.deadline).slice(0, 2);
  const on = S.board && !S.panel && !(S.open && S.open.scope === S.tab);
  const preview = !S.loaded["p:" + S.tab] ? [el("span", { text: "불러오는 중…" })]
    : !active.length ? [el("span", { text: "눌러서 프로젝트를 추가해 보세요" })]
    : soon.length ? soon.map((p) => { const d = dday(p.deadline); return el("span", { class: "pc-item" }, el("b", { class: "dday " + d.cls, text: d.text }), " ", p.title); })
    : [el("span", { text: "마감일이 정해진 프로젝트가 없어요" })];
  return el("button", { class: "proj-card" + (on ? " on" : ""), "aria-pressed": String(on), onclick: openProjects },
    el("span", { class: "pc-head" },
      svg('<rect x="3" y="3.5" width="14" height="13" rx="2"/><path d="M7 8h6M7 11.5h4"/>'),
      el("span", { class: "pc-title", text: "프로젝트" }),
      active.length ? el("span", { class: "pc-count", text: active.length }) : null),
    el("span", { class: "pc-preview" }, preview));
}

/* ---------- 공유 노트 만들기 / 설정 ---------- */
function openPanel(which) {
  flushSave();
  S.panel = which;
  if (which !== "new") S.tab = which;
  renderTabs(); renderView(); renderRail();
  buildPanel();
  $("#app").dataset.view = "detail";
  // 새 노트북 만들 때만 이름 칸에 바로 커서. 설정은 창만 띄움 (휴대폰에서 키보드가 올라오지 않게)
  if (which === "new" && $("#spName")) $("#spName").focus();
}
function closePanel() {
  S.panel = null;
  renderTabs(); renderView(); renderRail();
  if (!S.open) $("#app").dataset.view = "list";
}

function field(label, input, extra) {
  return el("label", { class: "fld" }, el("span", { class: "fld-label", text: label }), el("div", { class: "fld-row" }, input, extra));
}
// 이메일 초대가 되는지: claude.ai 미리보기처럼 내 이메일을 알 수 없으면 참여 코드로 대신함
const canEmailInvite = () => !!S.email;
const parseEmails = (s) => [...new Set(s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

function buildPanel() {
  const box = $("#spaceBody");
  const isNew = S.panel === "new";
  const sp = !isNew && spaceById(S.panel);
  const name = el("input", { class: "field", id: "spName", type: "text", placeholder: "예: 우리 집, 여행 준비", autocomplete: "off", maxlength: "40", value: sp ? sp.name || "" : "" });
  const inviteIn = el("input", { class: "field", id: "spInvite", type: "text", inputmode: "email", autocomplete: "off", placeholder: "구글 이메일 (여러 명은 쉼표로)" });
  const msg = el("p", { class: "fld-msg", id: "spMsg", role: "status" });
  const email = canEmailInvite();
  const help = el("p", { class: "fld-help", text: email
    ? "초대받은 사람이 알코 노트에 그 구글 계정으로 로그인하면 화면 위쪽에 초대장이 보이고, 수락하면 함께 쓸 수 있어요."
    : "이 미리보기에서는 이메일 초대 대신 참여 코드를 써요. 함께할 사람에게 코드를 보내면, 그 사람이 + 를 눌러 ‘코드로 참여하기’에 입력하면 돼요." + (MODE === "claude" ? " 페이지 Share 메뉴에서 그 사람에게 참여자(Contributor) 권한도 주세요." : "") });

  if (isNew) {
    const create = el("button", { class: "btn primary", type: "submit", text: "만들기" });
    const form = el("form", { class: "panel-sec" },
      field("이름", name),
      email && field("함께할 사람", inviteIn),
      email && help, msg,
      el("div", { class: "panel-actions" }, el("button", { type: "button", class: "link", text: "취소", onclick: closePanel }), create));
    form.addEventListener("submit", (e) => { e.preventDefault(); createSpace(name.value, email ? inviteIn.value : "", create); });
    const code = el("input", { class: "field", id: "spCode", type: "text", autocomplete: "off", placeholder: "받은 참여 코드" });
    const joinBtn = el("button", { class: "btn", type: "submit", text: "참여" });
    const join = el("form", { class: "panel-sec end" }, field("코드로 참여하기", code, joinBtn));
    join.addEventListener("submit", (e) => { e.preventDefault(); joinByCode(code.value, joinBtn); });
    box.replaceChildren(el("div", { class: "panel" }, form, email ? null : join));
    return;
  }
  // 기본 노트북 '노트': 이름·공유 설정 없이 삭제만
  if (S.panel === "private") {
    box.replaceChildren(el("div", { class: "panel" },
      el("p", { class: "fld-help", text: "‘노트’는 나만 보는 기본 노트북이에요." }),
      deleteSection({ id: "private", name: "노트", owner: S.uid })));
    return;
  }

  const saveName = el("button", { class: "btn", type: "submit", text: "이름 저장" });
  const nameForm = el("form", { class: "panel-sec" }, field("이름", name, saveName));
  nameForm.addEventListener("submit", (e) => { e.preventDefault(); renameSpace(sp.id, name.value); });
  const sendBtn = el("button", { class: "btn primary", type: "submit", text: "초대 보내기" });
  const codeOut = el("input", { class: "field", id: "spCodeOut", type: "text", readonly: true, value: sp.id, "aria-label": "참여 코드" });
  const copy = el("button", { class: "btn", type: "button", text: "복사" });
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(sp.id); setMsg("참여 코드를 복사했어요."); }
    catch { codeOut.select(); setMsg("코드를 선택해 뒀어요. 직접 복사해 주세요."); }
  });
  const inviteForm = email
    ? el("form", { class: "panel-sec" }, field("초대하기", inviteIn, sendBtn), help, msg)
    : el("div", { class: "panel-sec" }, field("참여 코드", codeOut, copy), help, msg);
  inviteForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    sendBtn.disabled = true;
    const ok = await sendInvites(sp.id, inviteIn.value);
    sendBtn.disabled = false;
    if (ok) inviteIn.value = "";
  });
  const isOwner = sp.owner === S.uid;
  const confirmed = isConfirmed(sp);
  // 공유 노트북 여부: 체크하면 멤버·초대(참여 코드) 칸이 보이고, 끄면 숨김. 만든 사람만 바꿀 수 있음.
  // 초대 수락으로 공유가 성사된 뒤에는 체크박스 대신 안내만 보여 줌 (공유를 끌 수 없고, 나가기만 가능)
  const shareBox = el("input", { type: "checkbox", id: "spShared", checked: isShared(sp.id), disabled: !isOwner });
  const shareSecs = el("div", { class: "panel-group", id: "spShareSecs", hidden: !isShared(sp.id) },
    el("div", { class: "panel-sec" }, el("span", { class: "fld-label", text: "멤버" }), el("div", { class: "people", id: "spMembers" })),
    inviteForm,
    email && el("div", { class: "panel-sec" }, el("span", { class: "fld-label", text: "보낸 초대" }), el("div", { class: "people", id: "spPending" })));
  const confirmRow = el("div", { class: "share-confirm", hidden: true });
  const shareSec = confirmed
    ? el("div", { class: "panel-sec" },
      el("div", { class: "share-state scope-shared" }, el("span", { class: "dot" }), el("strong", { text: "공유 노트북" })),
      el("p", { class: "fld-help", text: "초대를 수락한 멤버와 함께 쓰는 공유 노트북이에요. 함께 쓰는 동안에는 공유를 끌 수 없어요. 그만 쓰려면 맨 아래 ‘노트북에서 나가기’를 눌러 주세요. 다른 멤버가 모두 나가면 다시 나만 쓰는 노트북이 돼요." }))
    : el("div", { class: "panel-sec" },
      el("label", { class: "check-row share-row" }, shareBox, el("span", { text: "공유 노트북" })),
      el("p", { class: "fld-help", text: isOwner
        ? "체크하면 다른 사람을 초대할 수 있어요. 초대받은 사람이 수락할 때까지는 노랑(대기)으로 보이고, 수락하면 파랑 공유 노트북이 돼요. 함께 쓰는 동안에는 공유를 끌 수 없어요."
        : "공유 여부는 노트북을 만든 사람만 바꿀 수 있어요." }),
      confirmRow);
  shareBox.addEventListener("change", () => {
    confirmRow.hidden = true;
    if (shareBox.checked) { setShared(sp, true); shareSecs.hidden = false; return; }
    // 보낸 초대가 있으면 한 번 더 확인 (아직 수락한 사람이 없을 때만 끌 수 있음)
    const pend = (S.pending[sp.id] || []).length;
    if (!pend) { setShared(sp, false); shareSecs.hidden = true; return; }
    shareBox.checked = true;
    confirmRow.replaceChildren(
      el("span", { text: `공유를 끄면 보낸 초대 ${pend}개가 취소되고, 나만 볼 수 있게 돼요.` }),
      el("span", { class: "grow" }),
      el("button", { type: "button", class: "link", text: "취소", onclick: () => { confirmRow.hidden = true; } }),
      el("button", { type: "button", class: "btn danger-btn", text: "공유 끄기", onclick: () => { confirmRow.hidden = true; shareBox.checked = false; shareSecs.hidden = true; setShared(sp, false); } }));
    confirmRow.hidden = false;
  });
  box.replaceChildren(
    el("div", { class: "panel" },
      nameForm,
      shareSec,
      shareSecs,
      deleteSection(sp)));
  renderPanelLists();
}

// 설정창 맨 아래: 노트북 삭제(만든 사람) 또는 나가기(멤버). 누르면 경고를 보여 주고 한 번 더 확인
// 다른 멤버와 함께 쓰는 중이면 (만든 사람이어도) '나가기'만 있고, 노트는 남은 사람들에게 그대로 남음.
// 혼자 쓰는 노트북일 때만 '삭제'
function deleteSection(sp) {
  if (orderedTabs().length <= 1) return el("div", { class: "panel-sec end" }, el("p", { class: "fld-help", text: "마지막 노트북은 지울 수 없어요." }));
  const others = () => ((spaceById(sp.id) || sp).members || []).filter((id) => id !== S.uid);
  const leave = sp.id !== "private" && (others().length > 0 || sp.owner !== S.uid);
  const warn = el("div", { class: "share-confirm delete-confirm", role: "alert", hidden: true });
  const btn = el("button", { type: "button", class: "link danger strong", text: leave ? "노트북에서 나가기" : "노트북 삭제" });
  btn.addEventListener("click", () => {
    const n = (S.notes[sp.id] || []).length + (S.trash[sp.id] || []).length;
    const p = (S.projects[sp.id] || []).length;
    const text = leave
      ? "나가면 이 노트북을 더 볼 수 없어요. 노트는 지워지지 않고 남은 멤버들이 계속 쓸 수 있어요. 다시 들어오려면 초대를 받아야 해요. 그래도 나갈까요?"
      : `이 노트북을 지우면 안에 있는 모든 노트(${n}개)${p ? `와 프로젝트(${p}개)` : ""}도 함께 지워지고, 되살릴 수 없어요. 그래도 삭제할까요?`;
    warn.replaceChildren(
      el("span", { text }),
      el("span", { class: "grow" }),
      el("button", { type: "button", class: "link", text: "취소", onclick: () => { warn.hidden = true; btn.hidden = false; } }),
      el("button", { type: "button", class: "btn danger-btn", text: leave ? "나가기" : "삭제",
        onclick: () => (sp.id === "private" ? removePrivate() : leave ? leaveSpace(spaceById(sp.id) || sp) : removeSpace(spaceById(sp.id) || sp)) }));
    warn.hidden = false; btn.hidden = true;
  });
  return el("div", { class: "panel-sec end" }, btn, warn);
}

function renderPanelLists() {
  const sp = spaceById(S.panel);
  if (!sp || !$("#spMembers")) return;
  const info = S.memberInfo[sp.id] || {};
  $("#spMembers").replaceChildren(...(sp.members || []).map((id) => el("div", { class: "person" },
    el("span", { class: "person-id" },
      el("span", { class: "person-name", text: id === S.uid ? `${myLabel()} (나)` : nameOf(id) || "멤버" }),
      el("span", { class: "person-email", text: id === S.uid ? S.email || "" : (info[id] && info[id].email) || "" })),
    el("span", { class: "person-meta", text: id === sp.owner ? "만든 사람" : "" }))));
  const pend = S.pending[sp.id] || [];
  if (!$("#spPending")) return;
  $("#spPending").replaceChildren(...(pend.length ? pend.map((inv) => el("div", { class: "person" },
    el("span", { class: "person-name", text: inv.email }),
    el("span", { class: "person-meta", text: "수락 대기 중" }),
    el("button", { class: "link", text: "취소", onclick: (e) => { e.stopPropagation(); cancelInvite(sp, inv); } })))
    : [el("span", { class: "hint tight", text: "대기 중인 초대가 없어요." })]));
}

// 설정 화면이 닫혀 있으면 실패만 위쪽 알림으로 보여 줌
function setMsg(text, bad) {
  const m = $("#newMenu:not([hidden]) .fld-msg") || $("#spMsg");
  if (m) { m.textContent = text; m.classList.toggle("bad", !!bad); } else if (bad) setBanner(text);
}

// 만든 공유 노트 id 를 돌려줌 (실패하면 null)
async function createSpace(nameRaw, emailsRaw, btn, shared = true) {
  const name = nameRaw.trim();
  if (!name) { setMsg("이름을 입력해 주세요.", true); return null; }
  const emails = parseEmails(emailsRaw);
  const bad = emails.find((e) => !EMAIL_RE.test(e));
  if (bad) { setMsg(`‘${bad}’는 이메일 형식이 아니에요.`, true); return null; }
  btn.disabled = true;
  const ref = docIn(collection("spaces"));
  const now = Date.now();
  try {
    S.nextTab = ref.id;
    const data = { name, shared, owner: S.uid, members: [S.uid], memberEmails: S.email ? [S.email] : [], createdAt: now, updatedAt: now };
    // 서버 확인 전에도 탭과 제목에 입력한 이름이 바로 보이게 (확인되면 구독 값으로 바뀜)
    if (!spaceById(ref.id)) S.spaces = [...S.spaces, { id: ref.id, ...data, pendingServer: true }];
    await setDoc(ref, data);
    // 만들자마자 그 탭으로 이동하고, 초대는 그다음에 보냄 (보내는 동안 쓰기 시작한 노트를 건드리지 않게)
    // (서버 확인 전에 탭이 먼저 열려 이미 그 안에서 작업 중이면 그대로 둠)
    if (S.panel || S.tab !== ref.id) {
      flushSave();
      S.panel = null; S.open = null; S.tab = ref.id; S.board = false;
      closeSearch();
      renderAll();
      $("#app").dataset.view = "list";
    }
    S.tabChosen = true;
    if (!S.open) $("#app").dataset.view = "list";
    if (emails.length) await sendInvites(ref.id, emails.join(","), name);
    return ref.id;
  } catch (e) { setMsg(errText(e, "노트북 만들기에"), true); btn.disabled = false; return null; }
}

async function joinByCode(raw, btn) {
  const code = raw.trim();
  if (!code || /[^A-Za-z0-9_-]/.test(code)) { setMsg("참여 코드를 확인해 주세요.", true); return; }
  btn.disabled = true;
  try {
    const cur = await getDoc(spaceRef(code));
    if (!cur.exists) { setMsg("이 코드의 노트북을 찾을 수 없어요.", true); return; }
    S.nextTab = code;
    if (!(cur.data.members || []).includes(S.uid)) await arrayAdd(spaceRef(code), { members: S.uid });
    S.panel = null; S.tab = code; S.tabChosen = true;
    renderAll(); renderProjects();
  } catch (e) { setMsg(errText(e, "참여에"), true); }
  finally { btn.disabled = false; }
}

async function sendInvites(sid, raw, nameOverride) {
  const emails = parseEmails(raw);
  if (!emails.length) { if (!nameOverride) setMsg("초대할 이메일을 입력해 주세요.", true); return false; }
  const bad = emails.find((e) => !EMAIL_RE.test(e));
  if (bad) { setMsg(`‘${bad}’는 이메일 형식이 아니에요.`, true); return false; }
  const sp = spaceById(sid) || {};
  const skip = emails.filter((e) => e === S.email || (sp.memberEmails || []).includes(e));
  const todo = emails.filter((e) => !skip.includes(e));
  try {
    if (todo.length && sp.shared === false) await updateDoc(spaceRef(sid), { shared: true });
    for (const email of todo) {
      const inv = {
        spaceId: sid, spaceName: nameOverride || sp.name || "공유 노트북", email,
        invitedBy: S.uid, invitedByName: myLabel(), invitedByEmail: S.email || "", createdAt: Date.now(),
      };
      await setDoc(inviteRef(sid, email), inv);
      logActivity(`sent_${sid}__${email}_${inv.createdAt}`, { type: "sent", email, spaceName: inv.spaceName, createdAt: inv.createdAt });
    }
    setMsg(todo.length ? `${todo.join(", ")} 님에게 초대장을 보냈어요.` + (skip.length ? ` (${skip.join(", ")}는 이미 멤버예요)` : "") : "이미 멤버인 사람이에요.", !todo.length);
    return true;
  } catch (e) { setMsg(errText(e, "초대 보내기에"), true); return false; }
}

async function renameSpace(sid, raw) {
  const name = raw.trim();
  if (!name) { setMsg("이름을 입력해 주세요.", true); return; }
  try {
    await updateDoc(spaceRef(sid), { name, updatedAt: Date.now() });
    for (const inv of S.pending[sid] || []) await updateDoc(docAt("invites", inv.id), { spaceName: name });
    setMsg("이름을 바꿨어요.");
  } catch (e) { setMsg(errText(e, "이름 저장에"), true); }
}

// 보낸 초대 취소. 마지막 초대를 취소했고 아직 아무도 수락하지 않았으면 다시 일반 노트북(호박색)으로
async function cancelInvite(sp, inv) {
  try {
    await deleteDoc(docAt("invites", inv.id));
    S.pending[sp.id] = (S.pending[sp.id] || []).filter((x) => x.id !== inv.id);
    const cur = spaceById(sp.id) || sp;
    if (!S.pending[sp.id].length && !isConfirmed(cur)) {
      await setShared(cur, false);
      if (S.panel === sp.id) buildPanel();
    }
  } catch (e) { setBanner(errText(e, "초대 취소에")); }
}

// 공유 켜기/끄기. 끄기는 아직 아무도 초대를 수락하지 않았을 때만 (보낸 초대만 취소, 멤버는 건드리지 않음)
async function setShared(sp, on) {
  try {
    if (on) { await updateDoc(spaceRef(sp.id), { shared: true, updatedAt: Date.now() }); return; }
    if (isConfirmed(spaceById(sp.id) || sp)) return;
    for (const inv of S.pending[sp.id] || []) await deleteDoc(docAt("invites", inv.id));
    await updateDoc(spaceRef(sp.id), { shared: false, updatedAt: Date.now() });
  } catch (e) { setBanner(errText(e, "공유 설정 저장에")); }
}

// 나가기: 남은 멤버에게 알림을 남기고, 만든 사람이 나가면 관리 권한을 남은 멤버에게 넘김. 노트는 그대로 둠
async function leaveSpace(sp) {
  try {
    const fields = { members: S.uid };
    if (S.email) fields.memberEmails = S.email;
    S.panel = null;
    const rest = (sp.members || []).filter((id) => id !== S.uid);
    await addDoc(collection("spaces", sp.id, "notices"), { type: "left", uid: S.uid, name: myLabel(), email: S.email || "", createdAt: Date.now() }).catch(() => {});
    if (sp.owner === S.uid && rest.length) await updateDoc(spaceRef(sp.id), { owner: rest[0], updatedAt: Date.now() });
    await deleteDoc(docAt("spaces", sp.id, "members", S.uid)).catch(() => {});
    await arrayRemove(spaceRef(sp.id), fields);
  } catch (e) { setBanner(errText(e, "나가기에")); }
}

/* ---------- 알림: 누가 공유 노트북에서 나갔는지 ---------- */
// 노트북마다 '여기까지 봤음' 시각을 사람별로 저장 (users/<나>/prefs/seen). 처음 보는 노트북은 지금부터 셈
function renderNotices() {
  if (!S.seenLoaded) return;
  for (const sp of S.spaces) {
    const seen = S.seen[sp.id];
    if (seen === undefined) { markSeen(sp.id, Date.now()); continue; }
    let last = seen;
    for (const n of S.notices[sp.id] || []) {
      if (n.createdAt > seen && n.uid !== S.uid) logActivity(`left_${sp.id}_${n.id}`, { type: "left", uid: n.uid, name: n.name || "", email: n.email || "", spaceName: sp.name || "", createdAt: n.createdAt });
      last = Math.max(last, n.createdAt || 0);
    }
    if (last > seen) markSeen(sp.id, last);
  }
}
function markSeen(sid, ts) {
  if (!S.uid) return;
  S.seen = { ...S.seen, [sid]: Math.max(ts, S.seen[sid] || 0) };
  setDoc(docAt("users", S.uid, "prefs", "seen"), S.seen).catch(() => {});
}
// 노트북 삭제: 안의 노트·프로젝트·보낸 초대도 함께 지움 (만든 사람만)
async function removeSpace(sp) {
  try {
    S.panel = null;
    if (S.open && S.open.scope === sp.id) { clearTimeout(S.saveTimer); S.open = null; S.dirty = false; }
    const sid = sp.id;
    const notes = [...(S.notes[sid] || []), ...(S.trash[sid] || [])], projects = [...(S.projects[sid] || [])], invites = [...(S.pending[sid] || [])];
    for (const n of notes) await deleteDoc(docIn(notesCol(sid), n.id));
    for (const pj of projects) await deleteDoc(docIn(projectsCol(sid), pj.id));
    for (const inv of invites) await deleteDoc(docAt("invites", inv.id));
    for (const mid of Object.keys(S.memberInfo[sid] || {})) await deleteDoc(docAt("spaces", sid, "members", mid));
    await deleteDoc(spaceRef(sid));
  } catch (e) { setBanner(errText(e, "노트북 삭제에")); }
}

/* ---------- editor ---------- */
function openProjects() {
  flushSave();
  S.open = null; S.dirty = false; S.panel = null; S.board = true;
  renderView(); renderProjects();
  $("#app").dataset.view = "detail";
  renderRail();
}

function openNote(scope, id) {
  flushSave();
  const n = (S.notes[scope] || []).find((x) => x.id === id);
  if (!n) return;
  S.open = { scope, id }; S.dirty = false; S.panel = null;
  fillEditor(scope, n);
  setStatus(n.updatedAt ? "저장됨" : "");
  renderView();
  $("#app").dataset.view = "detail";
  renderRail();
}

function fillEditor(scope, n) {
  $("#noteTitle").value = n.title || "";
  $("#noteBody").value = n.body || "";
  toggleNoteMenu(false);
  renderMeta(scope, n);
}

function renderMeta(scope, n) {
  const box = $("#edMeta");
  if (!n.updatedAt) { box.textContent = "새 노트"; return; }
  if (scope === "private") { box.textContent = "마지막 수정 " + fmtStamp.format(n.updatedAt); return; }
  box.textContent = `작성 ${who(n.createdBy)} · 마지막 수정 ${who(n.updatedBy)}, ${fmtStamp.format(n.updatedAt)}`;
}

function syncEditor(n) {
  const t = $("#noteTitle"), b = $("#noteBody");
  if (t.value !== (n.title || "")) t.value = n.title || "";
  if (b.value !== (n.body || "")) b.value = n.body || "";
  renderMeta(S.open.scope, n);
}

function closeEditor() {
  S.open = null; S.dirty = false;
  renderView();
  $("#app").dataset.view = "list";
  renderRail();
}

function onEdit() {
  if (!S.open) return;
  S.dirty = true;
  setStatus("입력 중…");
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 800);
}

// 쓰기를 한 줄로 세워서 같은 문서에 저장이 겹치지 않게 함
function queue(fn) {
  S.writes++;
  S.chain = S.chain.then(fn).finally(() => { S.writes--; });
  return S.chain;
}

function flushSave() {
  clearTimeout(S.saveTimer);
  if (!S.open || !S.dirty) return S.chain;
  S.dirty = false;
  const { scope, id } = S.open;
  const ref = docIn(notesCol(scope), id);
  const data = { title: $("#noteTitle").value, body: $("#noteBody").value, updatedAt: Date.now(), updatedBy: S.uid };
  const draft = S.draft && S.draft.id === id ? S.draft : null;
  if (draft) {
    if (!data.title.trim() && !data.body.trim()) { setStatus(""); return S.chain; } // 아직 빈 노트: 저장 안 함
    S.draft = null;
    const first = { ...draft.note, ...data };
    setStatus("저장 중…");
    return queue(async () => {
      try {
        await setDoc(ref, first);
        if (S.open && S.open.id === id && !S.dirty) setStatus("저장됨 · " + fmtClock.format(Date.now()));
      } catch (e) {
        if (S.open && S.open.id === id) { S.dirty = true; S.draft = draft; }
        setStatus(errText(e, "노트 만들기에"));
      }
    });
  }
  setStatus("저장 중…");
  return queue(async () => {
    try {
      await updateDoc(ref, data);
      if (S.open && S.open.id === id && !S.dirty) setStatus("저장됨 · " + fmtClock.format(Date.now()));
    } catch (e) {
      if (S.open && S.open.id === id) S.dirty = true;
      setStatus(errText(e, "저장에"));
    }
  });
}

// 맨 윗줄 + 를 누르면 새 탭 창: 이름을 정하고, "초대해서 공유 노트로 만들기"를 체크하면 공유 탭(초대 수락 전 노랑, 수락 후 파랑), 아니면 혼자 쓰는 탭(호박색)
// 맨 윗줄 + 바로 아래에 띄움 (화면 밖으로 나가지 않게)
function placeNewMenu() {
  const menu = $("#newMenu"), anchor = $("#tabAdd");
  if (menu.hidden || !anchor) return;
  const r = anchor.getBoundingClientRect();
  menu.style.top = r.bottom + 6 + "px";
  menu.style.left = Math.max(16, Math.min(r.left, window.innerWidth - menu.offsetWidth - 16)) + "px";
}

function toggleNewMenu(force) {
  const menu = $("#newMenu");
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
  const anchor = $("#tabAdd");
  if (anchor) anchor.setAttribute("aria-expanded", String(open));
  if (!open) return;
  placeNewMenu();
  const email = canEmailInvite();
  const nameIn = el("input", { class: "field", id: "nnName", type: "text", placeholder: "노트북 이름 (예: 회사, 여행)", autocomplete: "off", maxlength: "40", "aria-label": "노트북 이름" });
  const share = el("input", { type: "checkbox", id: "nnShare" });
  const emailIn = el("input", { class: "field", id: "nnInvite", type: "text", inputmode: "email", autocomplete: "off", placeholder: "초대할 구글 이메일 (여러 명은 쉼표로)", "aria-label": "초대할 사람" });
  const fields = el("div", { class: "nn-fields", hidden: true },
    email ? emailIn : el("p", { class: "fld-help", text: "만든 뒤 사람 아이콘에서 참여 코드를 복사해 보내 주세요." }),
    // 초대받는 사람에게 내가 어떻게 보이는지 (닉네임 + 구글 메일)
    email && el("p", { class: "fld-help nn-me" }, "받는 사람에게는 ", el("strong", { text: myLabel() }), S.email ? ` (${S.email})` : "", " 님의 초대로 보여요."));
  const msg = el("p", { class: "fld-msg", role: "status" });
  const submit = el("button", { class: "btn primary", type: "submit", text: "만들기" });
  const form = el("form", { class: "nn scope-private" },
    nameIn,
    el("label", { class: "check-row" }, share, el("span", { text: "다른 사람을 초대해서 공유 노트북으로 만들기" })),
    fields, msg,
    el("div", { class: "panel-actions" },
      el("button", { type: "button", class: "link", text: "취소", onclick: () => toggleNewMenu(false) }), submit));
  share.addEventListener("change", () => {
    fields.hidden = !share.checked;
    form.className = "nn " + (share.checked ? "scope-pending" : "scope-private");
    msg.textContent = "";
    if (share.checked && email) emailIn.focus();
  });
  // 만들기: 새 노트북이 생기고 기본 화면이 열림 (체크하면 초대장도 보냄)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submit.disabled = true;
    const sid = await createSpace(nameIn.value, share.checked && email ? emailIn.value : "", submit, share.checked);
    submit.disabled = false;
    if (!sid) return;
    toggleNewMenu(false);
  });
  // 이메일 초대가 안 되는 곳(claude.ai 미리보기)에서는 받은 참여 코드로 들어가는 길을 둠
  const join = !email && el("button", { type: "button", class: "nn-join", text: "참여 코드를 받았나요? 코드로 참여하기",
    onclick: () => { toggleNewMenu(false); openPanel("new"); } });
  menu.replaceChildren(...[form, join].filter(Boolean));
  nameIn.focus();
}

function createNote(target) {
  const scope = target || S.tab;
  if (!S.uid) return;
  flushSave();
  if (scope !== S.tab) { S.tab = scope; S.tabChosen = true; S.panel = null; closeSearch(); renderTabs(); if (isSpace(scope)) renderProjects(); }
  dropDraft();
  const ref = docIn(notesCol(scope));
  const now = Date.now();
  const data = { title: "", body: "", createdBy: S.uid, updatedBy: S.uid, createdAt: now, updatedAt: now };
  // 새 노트는 아직 저장하지 않음: 제목이나 내용을 한 글자라도 쓰면 그때 처음 저장 (빈 노트가 쌓이지 않게)
  S.draft = { scope, id: ref.id, note: { id: ref.id, ...data } };
  S.notes[scope] = [S.draft.note, ...(S.notes[scope] || [])];
  S.open = { scope, id: ref.id }; S.dirty = false; S.panel = null;
  fillEditor(scope, { ...data, updatedAt: 0 });
  setStatus("");
  renderView();
  $("#app").dataset.view = "detail";
  renderRail();
  $("#noteTitle").focus();
}

// 아무것도 안 쓰고 떠난 새 노트는 목록에서 없앰 (저장된 적이 없으니 지울 것도 없음)
function dropDraft() {
  const d = S.draft;
  if (!d || (S.open && S.open.id === d.id)) return;
  S.draft = null;
  S.notes[d.scope] = (S.notes[d.scope] || []).filter((n) => n.id !== d.id);
}

function arm(btn, label, action) {
  if (btn.classList.contains("armed")) { action(); return; }
  btn.classList.add("armed");
  const orig = btn.textContent;
  btn.textContent = label;
  btn._t = setTimeout(() => disarm(btn, orig), 3000);
}
function disarm(btn, label) { clearTimeout(btn._t); btn.classList.remove("armed"); btn.textContent = label; }

function deleteOpen() {
  if (!S.open) return;
  const { scope, id } = S.open;
  clearTimeout(S.saveTimer);
  S.dirty = false;
  if (S.draft && S.draft.id === id) { S.draft = null; S.notes[scope] = (S.notes[scope] || []).filter((n) => n.id !== id); closeEditor(); return; } // 저장 전 새 노트는 그냥 버림
  closeEditor();
  trashNotes(scope, [id]);
}

// 휴지통으로 보내기 / 되살리기 / 완전히 지우기
function trashNotes(scope, ids) {
  if (S.draft && ids.includes(S.draft.id)) {
    const d = S.draft; S.draft = null;
    S.notes[d.scope] = (S.notes[d.scope] || []).filter((n) => n.id !== d.id);
    ids = ids.filter((id) => id !== d.id);
    if (S.open && S.open.id === d.id) { S.open = null; S.dirty = false; renderView(); $("#app").dataset.view = "list"; }
    if (!ids.length) { renderRail(); return; }
  }
  if (S.open && S.open.scope === scope && ids.includes(S.open.id)) { clearTimeout(S.saveTimer); S.dirty = false; S.open = null; renderView(); $("#app").dataset.view = "list"; }
  const now = Date.now();
  const moved = (S.notes[scope] || []).filter((n) => ids.includes(n.id)).map((n) => ({ ...n, deletedAt: now, deletedBy: S.uid }));
  S.notes[scope] = (S.notes[scope] || []).filter((n) => !ids.includes(n.id));
  S.trash[scope] = [...moved, ...(S.trash[scope] || [])];
  S.swiped = null;
  renderRail();
  for (const id of ids) queue(() => updateDoc(docIn(notesCol(scope), id), { deletedAt: now, deletedBy: S.uid }).catch((e) => setBanner(errText(e, "삭제에"))));
}
function restoreNote(scope, id) {
  const n = (S.trash[scope] || []).find((x) => x.id === id);
  if (!n) return;
  S.trash[scope] = S.trash[scope].filter((x) => x.id !== id);
  S.notes[scope] = [{ ...n, deletedAt: 0 }, ...(S.notes[scope] || [])].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  renderRail();
  queue(() => updateDoc(docIn(notesCol(scope), id), { deletedAt: 0, deletedBy: null }).catch((e) => setBanner(errText(e, "되살리기에"))));
}
function purgeNotes(scope, ids) {
  S.trash[scope] = (S.trash[scope] || []).filter((n) => !ids.includes(n.id));
  renderRail();
  for (const id of ids) queue(() => deleteDoc(docIn(notesCol(scope), id)).catch((e) => setBanner(errText(e, "완전히 지우기에"))));
}
function openTrash(on) {
  if (on) { flushSave(); endSelect(); closeSearch(); S.open = null; S.dirty = false; S.panel = null; S.board = false; }
  S.trashView = on; S.swiped = null;
  $("#app").dataset.view = "list";
  renderAll();
}
// 휴지통에 보일 노트: 지금 있는 노트북들의 지운 노트, 최근에 지운 순
function trashedNotes() {
  return orderedTabs().flatMap((t) => (S.trash[t.id] || []).map((n) => ({ ...n, scope: t.id })))
    .sort((a, b) => b.deletedAt - a.deletedAt);
}

// ⋯ 버튼 아래, 오른쪽 끝을 맞춰서 띄움 (화면 밖으로 나가지 않게)
function placeNoteMenu() {
  const menu = $("#noteMenu");
  if (menu.hidden) return;
  const r = $("#moreBtn").getBoundingClientRect();
  menu.style.top = r.bottom + 6 + "px";
  menu.style.left = Math.max(16, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 16)) + "px";
}

// 노트 화면 오른쪽 위 ⋯ 메뉴: 다른 노트북으로 옮기기 · 삭제
function toggleNoteMenu(force, page = "main") {
  const menu = $("#noteMenu"), btn = $("#moreBtn");
  const open = force !== undefined ? force : menu.hidden;
  menu.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  if (!open || !S.open) { menu.hidden = true; return; }
  const item = (props, ...kids) => el("button", { type: "button", class: "menu-item", role: "menuitem", ...props }, ...kids);
  if (page === "move") {
    const targets = orderedTabs().filter((t) => t.id !== S.open.scope);
    menu.replaceChildren(
      el("div", { class: "menu-label", text: "어느 노트북으로 옮길까요?" }),
      ...targets.map((t) => item({ class: "menu-item " + scopeClass(t.id), onclick: () => { toggleNoteMenu(false); moveOpen(t.id); } },
        el("span", { class: "dot" }), el("span", { class: "grow", text: t.name }))),
      ...(targets.length ? [] : [el("div", { class: "menu-label", text: "옮길 다른 노트북이 없어요." })]),
      el("div", { class: "menu-sep" }),
      item({ onclick: (e) => { e.stopPropagation(); toggleNoteMenu(true); } }, "← 뒤로"));
  } else {
    const del = item({ class: "menu-item danger", text: "삭제",
      onclick: (e) => { e.stopPropagation(); arm(del, "한 번 더 누르면 삭제", () => { toggleNoteMenu(false); deleteOpen(); }); } });
    menu.replaceChildren(
      item({ onclick: (e) => { e.stopPropagation(); toggleNoteMenu(true, "move"); } }, "다른 노트북으로 옮기기"),
      el("div", { class: "menu-sep" }),
      del);
  }
  placeNoteMenu();
  const first = menu.querySelector(".menu-item");
  if (first) first.focus();
}

// 옮기기 = 새 노트북에 같은 내용으로 만들고, 성공하면 원래 노트를 지움. 옮긴 뒤엔 그 노트북에서 노트를 계속 열어 둠
async function moveOpen(target) {
  if (!S.open || target === S.open.scope) return;
  const { scope, id } = S.open;
  const n = (S.notes[scope] || []).find((x) => x.id === id) || {};
  const now = Date.now();
  const data = {
    title: $("#noteTitle").value, body: $("#noteBody").value,
    createdBy: n.createdBy || S.uid, createdAt: n.createdAt || now, updatedBy: S.uid, updatedAt: now,
  };
  clearTimeout(S.saveTimer);
  S.dirty = false;
  if (S.draft && S.draft.id === id) S.draft = null;
  const from = docIn(notesCol(scope), id), to = docIn(notesCol(target));
  S.notes[scope] = (S.notes[scope] || []).filter((x) => x.id !== id);
  S.notes[target] = [{ id: to.id, ...data }, ...(S.notes[target] || [])];
  S.tab = target; S.tabChosen = true; S.panel = null; S.board = false;
  S.open = { scope: target, id: to.id };
  closeSearch(); endSelect();
  if (isSpace(target)) renderProjects();
  fillEditor(target, data);
  setStatus("옮기는 중…");
  renderAll();
  $("#app").dataset.view = "detail";
  queue(async () => {
    try {
      await setDoc(to, data);
    } catch (e) {
      // 새 노트북에 못 만들었으면 원래 노트는 그대로 둠
      S.notes[target] = (S.notes[target] || []).filter((x) => x.id !== to.id);
      S.notes[scope] = [{ id, ...n, ...data }, ...(S.notes[scope] || [])];
      setBanner(errText(e, "옮기기에"));
      switchTab(scope); openNote(scope, id);
      return;
    }
    try { await deleteDoc(from); } catch (e) { setBanner(errText(e, "원래 노트 지우기에")); }
    if (S.open && S.open.id === to.id) setStatus(`${target === "private" ? "노트" : spaceName(target)} 노트북으로 옮김`);
  });
}

/* ---------- projects ---------- */
const DAY = 86400000;
const fmtDay = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
function dday(deadline) {
  if (!deadline) return { text: "—", cls: "none" };
  const n = new Date();
  const diff = Math.round((parseYmd(deadline) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / DAY);
  if (diff === 0) return { text: "D-day", cls: "urgent" };
  return diff > 0 ? { text: `D-${diff}`, cls: diff <= 3 ? "urgent" : "" } : { text: `D+${-diff}`, cls: "urgent over" };
}
// 마감이 가까운 순, 마감 없는 건 맨 뒤
const byDeadline = (a, b) => (a.deadline || "9999").localeCompare(b.deadline || "9999") || (a.title || "").localeCompare(b.title || "");
const activeProjects = (sid) => (S.projects[sid] || []).filter((p) => !p.done).sort(byDeadline);

function renderProjects() {
  const sid = S.tab;
  if (!isSpace(sid)) return;
  const active = activeProjects(sid);
  // 완료한 프로젝트도 숨기지 않고 진행 중인 것 아래에 줄 그어서 보여 줌 (최근에 완료한 것부터)
  const done = (S.projects[sid] || []).filter((p) => p.done).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  $("#projCount").textContent = active.length ? `진행 중 ${active.length}개` : "";
  // 입력 중인 폼은 다시 그리지 않음 (상대방 저장으로 입력 내용이 날아가지 않게)
  if (S.editProject !== null && document.querySelector(".proj-form")) return;
  const rows = [];
  if (S.editProject === "new") rows.push(projectForm(null));
  if (!S.loaded["p:" + sid]) rows.push(el("div", { class: "hint", text: "불러오는 중…" }));
  else if (!active.length && !done.length && S.editProject !== "new") rows.push(el("div", { class: "hint", text: "프로젝트가 없어요. ‘+ 프로젝트’로 시작해 보세요." }));
  [...active, ...done].forEach((p) => rows.push(S.editProject === p.id ? projectForm(p) : projectRow(p)));
  $("#projList").replaceChildren(...rows);
}

function projectRow(p) {
  const d = p.done ? { text: "완료", cls: "none" } : dday(p.deadline);
  const sub = p.deadline ? fmtDay(p.deadline) + " 마감" : "마감 없음";
  return el("div", { class: "proj" + (p.done ? " done" : "") },
    el("button", { class: "check", "aria-pressed": String(!!p.done), "aria-label": p.done ? "진행 중으로 되돌리기" : "완료로 표시", title: p.done ? "진행 중으로 되돌리기" : "완료", onclick: () => toggleDone(p) }),
    el("span", { class: "dday " + d.cls, text: d.text }),
    el("div", { class: "proj-main" },
      el("div", { class: "proj-title", text: p.title }),
      el("div", { class: "proj-sub", text: sub })),
    el("span", { class: "proj-actions" },
      el("button", { class: "link", text: "수정", onclick: () => editProject(p.id) }),
      projDeleteBtn(p)));
}
function projDeleteBtn(p) {
  const btn = el("button", { class: "icon-btn proj-del", "aria-label": `‘${p.title}’ 삭제`, title: "삭제" },
    svg('<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>'), el("span", { class: "tab-del-label", text: "삭제할까요?" }));
  btn.addEventListener("click", () => {
    if (btn.classList.contains("armed")) { clearTimeout(btn._t); removeProject(p); return; }
    btn.classList.add("armed");
    btn._t = setTimeout(() => btn.classList.remove("armed"), 3000);
  });
  return btn;
}

function projectForm(p) {
  const del = p && el("button", { type: "button", class: "link danger", text: "삭제" });
  if (del) del.addEventListener("click", () => arm(del, "한 번 더 누르면 삭제", () => removeProject(p)));
  const form = el("form", { class: "proj-form" },
    el("input", { type: "text", id: "pjTitle", placeholder: "프로젝트 이름", "aria-label": "프로젝트 이름", required: true, autocomplete: "off", value: p ? p.title : "" }),
    el("div", { class: "pf-row" },
      el("label", { for: "pjDeadline", class: "pf-label", text: "마감일" }),
      el("input", { type: "date", id: "pjDeadline", value: p ? p.deadline || "" : "" })),
    el("div", { class: "pf-actions" },
      del, el("span", { class: "spacer" }),
      el("button", { type: "button", class: "link", text: "취소", onclick: closeProjectForm }),
      el("button", { type: "submit", class: "btn-ink", text: p ? "저장" : "추가" })));
  form.addEventListener("submit", (e) => { e.preventDefault(); saveProject(p); });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape") closeProjectForm(); });
  return form;
}

function editProject(id) {
  S.editProject = id;
  document.querySelector(".proj-form") && document.querySelector(".proj-form").remove();
  renderProjects();
  $("#pjTitle").focus();
}
function closeProjectForm() {
  S.editProject = null;
  document.querySelector(".proj-form") && document.querySelector(".proj-form").remove();
  renderProjects();
}

async function saveProject(p) {
  const title = $("#pjTitle").value.trim();
  if (!title) return;
  const sid = S.tab;
  const data = { title, deadline: $("#pjDeadline").value || "", updatedAt: Date.now(), updatedBy: S.uid };
  closeProjectForm();
  try {
    if (p) await updateDoc(docIn(projectsCol(sid), p.id), data);
    else await addDoc(projectsCol(sid), { ...data, done: false, createdBy: S.uid, createdAt: data.updatedAt });
  } catch (e) { setBanner(errText(e, "프로젝트 저장에")); }
}
function toggleDone(p) {
  updateDoc(docIn(projectsCol(S.tab), p.id), { done: !p.done, updatedAt: Date.now(), updatedBy: S.uid })
    .catch((e) => setBanner(errText(e, "프로젝트 저장에")));
}
function removeProject(p) {
  closeProjectForm();
  deleteDoc(docIn(projectsCol(S.tab), p.id)).catch((e) => setBanner(errText(e, "프로젝트 삭제에")));
}

/* ---------- wiring ---------- */
$("#search").addEventListener("input", (e) => { S.q = e.target.value; renderRail(); });
$("#searchBtn").addEventListener("click", openSearch);
$("#selectBtn").addEventListener("click", startSelect);
$("#selCancel").addEventListener("click", endSelect);
$("#selAll").addEventListener("change", (e) => {
  S.select = new Set(e.target.checked ? visibleNotes().map((n) => n.id) : []);
  disarm($("#selDelete"), "삭제");
  renderRail();
});
$("#selDelete").addEventListener("click", (e) => arm(e.currentTarget, `${S.select.size}개를 정말 삭제할까요?`, deletePicked));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && S.select && !e.target.closest("#newMenu")) endSelect(); });
$("#searchClose").addEventListener("click", closeSearch);
$("#search").addEventListener("keydown", (e) => { if (e.key === "Escape") closeSearch(); });
$("#spaceClose").addEventListener("click", closePanel);
$("#newBtn").addEventListener("click", () => createNote(S.tab));
document.addEventListener("click", (e) => { if (!$("#newMenu").hidden && !e.target.closest("#newMenu")) toggleNewMenu(false); });
$("#newMenu").addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleNewMenu(false); $("#tabAdd") && $("#tabAdd").focus(); } });
// 휴대폰은 키보드가 올라오고 내려갈 때도 resize 가 오므로 닫지 않고 자리만 다시 잡음
window.addEventListener("resize", placeNewMenu);
$("#projAdd").addEventListener("click", () => editProject("new"));
$("#projBack").addEventListener("click", () => { $("#app").dataset.view = "list"; });
$("#noteTitle").addEventListener("input", onEdit);
$("#noteBody").addEventListener("input", onEdit);
$("#noteTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#noteBody").focus(); } });
$("#backBtn").addEventListener("click", () => {
  flushSave();
  // 아무것도 안 쓴 새 노트에서 뒤로 가면 그 노트는 없던 것으로
  if (S.draft && S.open && S.draft.id === S.open.id) { S.open = null; S.dirty = false; renderView(); renderRail(); }
  $("#app").dataset.view = "list";
});
$("#moreBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleNoteMenu(); });
document.addEventListener("click", (e) => { if (!$("#noteMenu").hidden && !e.target.closest("#noteMenu")) toggleNoteMenu(false); });
$("#noteMenu").addEventListener("keydown", (e) => { if (e.key === "Escape") { toggleNoteMenu(false); $("#moreBtn").focus(); } });
window.addEventListener("resize", placeNoteMenu);
$("#loginBtn").addEventListener("click", login);
LOCAL_USERS.forEach((u) => $("#gateLocalUsers").append(el("button", { class: "gbtn", onclick: () => signInLocal(u.uid), text: u.displayName + "로 들어가기" })));
$("#devBadge").hidden = MODE !== "local";
document.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === "s") { e.preventDefault(); flushSave(); }
  if (k === "k" && !$("#shell").hidden) { e.preventDefault(); $("#app").dataset.view = "list"; openSearch(); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
window.addEventListener("beforeunload", (e) => { if (S.dirty || S.writes) { flushSave(); e.preventDefault(); } });

/* ---------- 목록 · 노트 폭 조절 (데스크톱) ---------- */
// 경계선을 끌면 #app 의 CSS 변수(--rail-w / --col-w)를 바꾸고, 놓으면 이 브라우저에 기억
function initResizer({ handle, cssVar, def, min, max, key }) {
  const h = $(handle), app = $("#app");
  const set = (w, save) => {
    const v = Math.round(Math.min(Math.max(min, max()), Math.max(min, w)));
    app.style.setProperty(cssVar, v + "px");
    h.setAttribute("aria-valuenow", v);
    if (save) try { localStorage.setItem(key, v); } catch {}
    return v;
  };
  let saved = null;
  try { saved = Number(localStorage.getItem(key)) || null; } catch {}
  let width = set(saved || def, false);
  h.setAttribute("aria-valuemin", min);
  h.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width;
    app.classList.add("resizing");
    h.classList.add("dragging");
    const move = (ev) => { width = set(w0 + ev.clientX - x0, false); };
    const up = () => {
      app.classList.remove("resizing");
      h.classList.remove("dragging");
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      h.removeEventListener("pointercancel", up);
      set(width, true);
    };
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
  });
  h.addEventListener("dblclick", () => { width = set(def, true); });
  h.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === "ArrowLeft") width = set(width - step, true);
    else if (e.key === "ArrowRight") width = set(width + step, true);
    else return;
    e.preventDefault();
  });
  window.addEventListener("resize", () => { if (width > max()) width = set(width, false); });
}
initResizer({ handle: "#railResize", cssVar: "--rail-w", def: 300, min: 220, key: "alko.railWidth",
  max: () => Math.min(640, Math.round(window.innerWidth * 0.6)) });
// 노트 폭은 오른쪽 화면 안에서만: 왼쪽 여백 32px, 오른쪽 끝 20px 남김
initResizer({ handle: "#colResize", cssVar: "--col-w", def: 720, min: 360, key: "alko.colWidth",
  max: () => ($("main").clientWidth || Infinity) - 52 }); // 로그인 전처럼 안 보일 땐 제한 없음

onUser((u) => {
  teardown();
  if (!u) return showGate(MODE === "local" ? "local" : MODE === "claude" ? "claude" : "login");
  start(u);
});

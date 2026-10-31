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
  notes: {}, trash: {}, projects: {}, pending: {}, loaded: {},
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
const who = (id) => (id && id === S.uid ? "나" : (S.names[id] && S.names[id].name) || "상대방");
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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
  S.unsubs.forEach((u) => u());
  Object.values(S.spaceSubs).forEach((list) => list.forEach((u) => u()));
  Object.assign(S, {
    unsubs: [], spaceSubs: {}, uid: null, email: null, names: {}, spaces: [], spacesLoaded: false, tab: null, nextTab: null,
    notes: {}, trash: {}, projects: {}, pending: {}, loaded: {}, invites: [], open: null, dirty: false, trashView: false, swiped: null, purged: {},
    panel: null, editProject: null, migrated: false, tabChosen: false, tabOrder: [], hidePrivate: false, drag: null,
  });
}

function start(u) {
  S.uid = u.uid;
  S.email = (u.email || "").toLowerCase() || null;
  S.myName = u.displayName || u.email || "나";
  $("#gate").hidden = true;
  $("#shell").hidden = false;
  $("#me").replaceChildren(...[
    u.photoURL && el("img", { src: u.photoURL, alt: "", referrerpolicy: "no-referrer" }),
    el("span", { text: S.myName }),
    MODE !== "claude" && el("button", { class: "link", onclick: async () => { flushSave(); await S.chain; logOut(); }, text: MODE === "local" ? "사용자 바꾸기" : "로그아웃" }),
  ].filter(Boolean));
  setDoc(docAt("profiles", u.uid), { name: S.myName }, { merge: true }).catch(() => {});

  const onErr = (e) => setBanner(errText(e, "불러오기에"));
  S.notes.private = [];
  S.unsubs.push(
    // 탭 순서는 사람마다 따로 저장 (users/<나>/prefs/tabs)
    watch(collection("users", S.uid, "prefs"), {}, (s) => {
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
      renderRail();
      if (S.panel) renderPanelLists();
      if (S.open) { const n = (S.notes[S.open.scope] || []).find((x) => x.id === S.open.id); if (n) renderMeta(S.open.scope, n); }
    }, onErr),
    watch(collection("spaces"), { where: ["members", "array-contains", S.uid], metadata: true }, (s) => onSpaces(s.docs.map((d) => ({
      id: d.id, ...d.data(), pendingServer: !!(d.metadata && d.metadata.hasPendingWrites && !S.spaceSubs[d.id]),
    }))), onErr),
    watch(notesCol("private"), { byUpdated: true }, (s) => onNotes("private", docs(s), s), onErr),
  );
  if (S.email) S.unsubs.push(watch(collection("invites"), { where: ["email", "==", S.email] }, (s) => { S.invites = docs(s); renderInvites(); }, onErr));
  renderAll();
}

// 내가 속한 공유 노트 목록이 바뀌면 각 공유 노트의 노트/프로젝트/일정 구독을 맞춤
function onSpaces(list) {
  S.spaces = list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const ids = new Set(list.map((s) => s.id));
  for (const sid of Object.keys(S.spaceSubs)) {
    if (!ids.has(sid)) {
      S.spaceSubs[sid].forEach((u) => u());
      delete S.spaceSubs[sid]; delete S.notes[sid]; delete S.trash[sid]; delete S.projects[sid]; delete S.pending[sid]; delete S.loaded[sid];
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
      watch(collection("invites"), { where: ["spaceId", "==", sid] }, (s) => { S.pending[sid] = docs(s); if (S.panel === sid) renderPanelLists(); }, () => {}),
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
function renderInvites() {
  const box = $("#invites");
  box.hidden = !S.invites.length;
  box.replaceChildren(...S.invites.map((inv) => el("div", { class: "invite" },
    el("span", { class: "invite-text" },
      el("strong", { text: inv.invitedByName || "누군가" }), "님이 ",
      el("strong", { text: `‘${inv.spaceName || "공유 노트북"}’` }), " 노트북에 초대했어요"),
    el("span", { class: "grow" }),
    el("button", { class: "link", text: "거절", onclick: () => declineInvite(inv) }),
    el("button", { class: "btn primary", text: "수락", onclick: () => acceptInvite(inv) }))));
}

async function acceptInvite(inv) {
  try {
    await arrayAdd(spaceRef(inv.spaceId), { members: S.uid, memberEmails: S.email });
    S.nextTab = inv.spaceId;
    await deleteDoc(docAt("invites", inv.id));
  } catch (e) { setBanner(errText(e, "초대 수락에")); }
}
function declineInvite(inv) {
  deleteDoc(docAt("invites", inv.id)).catch((e) => setBanner(errText(e, "초대 거절에")));
}

/* ---------- tabs & views ---------- */
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
      el("span", { class: "dot" }), t.name)),
    el("button", { class: "icon-btn tab-add", id: "tabAdd", "aria-label": "새 노트북 만들기", title: "새 노트북 만들기", "aria-haspopup": "dialog", "aria-expanded": String(!$("#newMenu").hidden), "aria-controls": "newMenu",
      onclick: (e) => { e.stopPropagation(); toggleNewMenu(); } }, svg('<path d="M10 4v12M4 10h12"/>')),
    // 휴지통: 모든 노트북에서 지운 노트를 한곳에 모아 보여 줌
    el("button", { class: "tab tab-trash", role: "tab", "aria-selected": String(S.trashView), onclick: () => openTrash(true) },
      svg('<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>'), "휴지통"),
  );
  // 지금 선택한 노트북을 지우는(또는 나가는) 버튼은 윗줄 맨 오른쪽에 하나만
  // 노트북이 하나만 남으면 지울 수 없음
  // 노트북 줄 오른쪽 끝: [⚙ 설정] [🗑 삭제]. 설정은 직접 만든/초대받은 노트북에만 ('노트'는 없음)
  $("#nbActions").replaceChildren(...(S.trashView ? [] : [
    isSpace(S.tab) && spaceById(S.tab) && el("button", { class: "icon-btn nb-gear", "aria-label": `‘${spaceName(S.tab)}’ 노트북 설정`, title: "노트북 설정 (이름 · 초대)", "aria-expanded": String(S.panel === S.tab),
      onclick: () => (S.panel === S.tab ? closePanel() : openPanel(S.tab)) },
      svg('<path d="M8.7 2.6h2.6l.4 1.9c.5.2.9.4 1.3.7l1.8-.7 1.3 2.2-1.5 1.3c.1.5.1 1 0 1.5l1.5 1.3-1.3 2.2-1.8-.7c-.4.3-.8.5-1.3.7l-.4 1.9H8.7l-.4-1.9c-.5-.2-.9-.4-1.3-.7l-1.8.7-1.3-2.2 1.5-1.3c-.1-.5-.1-1 0-1.5L3.9 6.7l1.3-2.2 1.8.7c.4-.3.8-.5 1.3-.7z" stroke-width="1.5"/><circle cx="10" cy="10" r="2.3"/>')),
    S.tab && orderedTabs().length > 1 && tabDeleteBtn(S.tab),
  ]).filter(Boolean));
}

// 윗줄 맨 오른쪽의 아이콘: 지금 노트북을 만든 사람은 삭제, 다른 멤버는 나가기. 한 번 더 눌러야 실행
// ("노트"를 지우면 안의 노트를 지우고 노트북 줄에서 숨김)
function tabDeleteBtn(sid) {
  const sp = sid === "private" ? { id: "private", name: "노트", owner: S.uid } : spaceById(sid);
  if (!sp) return null;
  const owner = sp.owner === S.uid;
  const verb = owner ? "삭제" : "나가기";
  const icon = owner
    ? '<path d="M4 6h12M8 6V4.5h4V6M6 6l.7 10h6.6L14 6"/>'
    : '<path d="M8.5 4H5v12h3.5M12 7l3 3-3 3M15 10H8"/>';
  const btn = el("button", { class: "icon-btn tab-del", "aria-label": `‘${sp.name || "노트북"}’ 노트북 ${verb}`, title: `노트북 ${verb}` },
    svg(icon), el("span", { class: "tab-del-label", text: owner ? "삭제할까요?" : "나갈까요?" }));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (btn.classList.contains("armed")) { clearTimeout(btn._t); sid === "private" ? removePrivate() : owner ? removeSpace(sp) : leaveSpace(sp); return; }
    btn.classList.add("armed");
    btn.setAttribute("aria-label", `한 번 더 누르면 ‘${sp.name || "노트북"}’ 노트북을 ${owner ? "모두에게서 삭제해요" : "나가요"}`);
    btn._t = setTimeout(() => { btn.classList.remove("armed"); btn.setAttribute("aria-label", `‘${sp.name || "노트북"}’ 노트북 ${verb}`); }, 3000);
  });
  return btn;
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
  $("#tabs").insertBefore(d.tab, after || $("#tabAdd"));
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
  S.hidePrivate = true;
  S.tab = orderedTabs()[0].id;
  renderAll(); if (isSpace(S.tab)) renderProjects();
  savePrefs();
  try {
    for (const n of [...(S.notes.private || []), ...(S.trash.private || [])]) await deleteDoc(docIn(notesCol("private"), n.id));
  } catch (e) { setBanner(errText(e, "노트 삭제에")); }
}
// 끄는 중 화면이 밀리지 않게 (터치)
$("#tabs").addEventListener("touchmove", (e) => { if (S.drag && S.drag.active) e.preventDefault(); }, { passive: false });

// 색 구분: 공유 노트 = 파랑, 내 노트 = 호박색
const isShared = (scope) => {
  if (scope === "private") return false;
  const sp = spaceById(scope);
  return !sp || sp.shared !== false || (sp.members || []).length > 1;
};
const scopeClass = (scope) => (isShared(scope) ? "scope-shared" : "scope-private");

function renderView() {
  $("#app").dataset.scope = isShared(S.tab) ? "shared" : "private";
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
  $("#spName").focus();
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
  // 공유 노트북 여부: 체크하면 멤버·초대(참여 코드) 칸이 보이고, 끄면 숨김. 만든 사람만 바꿀 수 있음
  const shareBox = el("input", { type: "checkbox", id: "spShared", checked: isShared(sp.id), disabled: !isOwner });
  const shareSecs = el("div", { class: "panel-group", id: "spShareSecs", hidden: !isShared(sp.id) },
    el("div", { class: "panel-sec" }, el("span", { class: "fld-label", text: "멤버" }), el("div", { class: "people", id: "spMembers" })),
    inviteForm,
    email && el("div", { class: "panel-sec" }, el("span", { class: "fld-label", text: "보낸 초대" }), el("div", { class: "people", id: "spPending" })));
  const confirmRow = el("div", { class: "share-confirm", hidden: true });
  const shareSec = el("div", { class: "panel-sec" },
    el("label", { class: "check-row share-row" }, shareBox, el("span", { text: "공유 노트북" })),
    el("p", { class: "fld-help", text: isOwner ? "체크하면 다른 사람을 초대해서 함께 쓸 수 있어요." : "공유 여부는 노트북을 만든 사람만 바꿀 수 있어요." }),
    confirmRow);
  shareBox.addEventListener("change", () => {
    confirmRow.hidden = true;
    if (shareBox.checked) { setShared(sp, true); shareSecs.hidden = false; return; }
    // 다른 멤버나 보낸 초대가 있으면 한 번 더 확인
    const cur = spaceById(sp.id) || sp; // 열어 둔 뒤 멤버가 바뀌었을 수 있으니 지금 값으로
    const others = (cur.members || []).filter((id) => id !== S.uid).length;
    const pend = (S.pending[sp.id] || []).length;
    if (!others && !pend) { setShared(sp, false); shareSecs.hidden = true; return; }
    shareBox.checked = true;
    const parts = [others && `다른 멤버 ${others}명`, pend && `보낸 초대 ${pend}개`].filter(Boolean).join("과 ");
    confirmRow.replaceChildren(
      el("span", { text: `공유를 끄면 ${parts}${parts.endsWith("명") ? "이" : "가"} 정리되고, 나만 볼 수 있게 돼요.` }),
      el("span", { class: "grow" }),
      el("button", { type: "button", class: "link", text: "취소", onclick: () => { confirmRow.hidden = true; } }),
      el("button", { type: "button", class: "btn danger-btn", text: "공유 끄기", onclick: () => { confirmRow.hidden = true; shareBox.checked = false; shareSecs.hidden = true; setShared(sp, false); } }));
    confirmRow.hidden = false;
  });
  const danger = el("button", { class: "link danger", text: isOwner ? "노트북 삭제" : "노트북 나가기" });
  danger.addEventListener("click", () => arm(danger, isOwner ? "한 번 더 누르면 모두에게서 삭제돼요" : "한 번 더 누르면 나가요", () => (isOwner ? removeSpace(sp) : leaveSpace(sp))));
  box.replaceChildren(
    el("div", { class: "panel" },
      nameForm,
      shareSec,
      shareSecs,
      el("div", { class: "panel-sec end" }, danger)));
  renderPanelLists();
}

function renderPanelLists() {
  const sp = spaceById(S.panel);
  if (!sp || !$("#spMembers")) return;
  $("#spMembers").replaceChildren(...(sp.members || []).map((id) => el("div", { class: "person" },
    el("span", { class: "person-name", text: id === S.uid ? `${S.myName} (나)` : (S.names[id] && S.names[id].name) || "멤버" }),
    el("span", { class: "person-meta", text: id === sp.owner ? "만든 사람" : "" }))));
  const pend = S.pending[sp.id] || [];
  if (!$("#spPending")) return;
  $("#spPending").replaceChildren(...(pend.length ? pend.map((inv) => el("div", { class: "person" },
    el("span", { class: "person-name", text: inv.email }),
    el("span", { class: "person-meta", text: "수락 대기 중" }),
    el("button", { class: "link", text: "취소", onclick: () => deleteDoc(docAt("invites", inv.id)).catch((e) => setBanner(errText(e, "초대 취소에"))) })))
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
      await setDoc(inviteRef(sid, email), {
        spaceId: sid, spaceName: nameOverride || sp.name || "공유 노트북", email,
        invitedBy: S.uid, invitedByName: S.myName, createdAt: Date.now(),
      });
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

// 공유 켜기/끄기. 끌 때는 다른 멤버와 보낸 초대를 정리해서 나만 남김
async function setShared(sp, on) {
  try {
    if (on) { await updateDoc(spaceRef(sp.id), { shared: true, updatedAt: Date.now() }); return; }
    for (const inv of S.pending[sp.id] || []) await deleteDoc(docAt("invites", inv.id));
    await updateDoc(spaceRef(sp.id), { shared: false, members: [S.uid], memberEmails: S.email ? [S.email] : [], updatedAt: Date.now() });
  } catch (e) { setBanner(errText(e, "공유 설정 저장에")); }
}

async function leaveSpace(sp) {
  try {
    const fields = { members: S.uid };
    if (S.email) fields.memberEmails = S.email;
    S.panel = null;
    await arrayRemove(spaceRef(sp.id), fields);
  } catch (e) { setBanner(errText(e, "나가기에")); }
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

// 맨 윗줄 + 를 누르면 새 탭 창: 이름을 정하고, "초대해서 공유 노트로 만들기"를 체크하면 공유 탭(파랑), 아니면 혼자 쓰는 탭(호박색)
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
    email ? emailIn : el("p", { class: "fld-help", text: "만든 뒤 사람 아이콘에서 참여 코드를 복사해 보내 주세요." }));
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
    form.className = "nn " + (share.checked ? "scope-shared" : "scope-private");
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
  const ref = docIn(notesCol(scope));
  const now = Date.now();
  const data = { title: "", body: "", createdBy: S.uid, updatedBy: S.uid, createdAt: now, updatedAt: now };
  S.notes[scope] = [{ id: ref.id, ...data }, ...(S.notes[scope] || [])];
  S.open = { scope, id: ref.id }; S.dirty = false; S.panel = null;
  fillEditor(scope, { ...data, updatedAt: 0 });
  setStatus("");
  renderView();
  $("#app").dataset.view = "detail";
  renderRail();
  $("#noteTitle").focus();
  queue(() => setDoc(ref, data).catch((e) => setStatus(errText(e, "노트 만들기에"))));
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
  closeEditor();
  trashNotes(scope, [id]);
}

// 휴지통으로 보내기 / 되살리기 / 완전히 지우기
function trashNotes(scope, ids) {
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
$("#backBtn").addEventListener("click", () => { flushSave(); $("#app").dataset.view = "list"; });
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

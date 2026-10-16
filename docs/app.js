/* J.A.R.V.I.S. タスクボード — data/tasks.enc.json を復号して表示する（読み取り専用）。
   正本は Notion の統合タスクボード。編集は各タスクの「Notionで開く」から。 */
"use strict";

const DATA_URL = "data/tasks.enc.json";
const KEY_STORE = "jarvis.pass";
const CACHE_STORE = "jarvis.snap";

// 5つの大分類（色は CSS 変数と同じ値）
const BUCKETS = [
  { id: "call",  ja: "判断待ち",    en: "AWAITING",   color: "#ff2a3d" },
  { id: "work",  ja: "作業中",      en: "PROCESSING", color: "#a8e6ff" },
  { id: "queue", ja: "順番待ち",    en: "QUEUE",      color: "#8d7880" },
  { id: "alert", ja: "要注意／停止", en: "ALERT",      color: "#ffb84a" },
  { id: "done",  ja: "完了",        en: "COMPLETE",   color: "#e9e2e0" },
];
const B = Object.fromEntries(BUCKETS.map(b => [b.id, b]));
const PRI = { "高": 0, "中": 1, "要確認": 2, "低": 3, "": 4 };

const $ = s => document.querySelector(s);
const state = { snap: null, filter: "all", q: "", onlyHigh: false, open: new Set() };

/* ---------- 日付 ---------- */
function todayISO() {
  const d = new Date(Date.now() + 9 * 3600e3);         // JST
  return d.toISOString().slice(0, 10);
}
function md(iso) { return iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : ""; }

/* ---------- 分類 ---------- */
function bucketOf(t, today) {
  if (t.st === "完了" || t.st === "入れ替え済み（自動）") return "done";
  if (t.st === "保留" || t.st === "相手待ち") return "alert";
  if (t.due && t.due < today) return "alert";            // 期限切れ
  if (t.st === "ゆうすけ確認待ち" || t.st === "要確認") return "call";
  if (t.st === "対応中") return "work";
  return "queue";
}
function isHigh(t) { return t.pri === "高"; }
function sortKey(a, b) {
  return (PRI[a.pri] ?? 4) - (PRI[b.pri] ?? 4) || (a.due || "9999").localeCompare(b.due || "9999") || a.name.localeCompare(b.name, "ja");
}

/* ---------- 復号 ---------- */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function decrypt(env, pass) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(env.salt), iterations: env.iter },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(env.iv) }, key, b64(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- 読み込み ---------- */
async function fetchEnvelope() {
  const r = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function load({ manual = false } = {}) {
  const btn = $("#btnRefresh");
  btn.classList.add("spin");
  try {
    const pass = getPass();
    if (!pass) return showLock();
    let env;
    try { env = await fetchEnvelope(); localStorage.setItem(CACHE_STORE, JSON.stringify(env)); }
    catch (e) {                                            // オフライン時は前回の暗号文
      const c = localStorage.getItem(CACHE_STORE);
      if (!c) throw e;
      env = JSON.parse(c);
      toast("オフライン：前回のデータを表示しています");
    }
    try { state.snap = await decrypt(env, pass); }
    catch { forgetPass(); return showLock("パスフレーズが合いません。もう一度入れてください"); }
    render();
    if (manual) toast(`更新しました（${state.snap.tasks.length}件）`);
  } catch (e) {
    setPill("通信エラー", false);
    toast("読み込めませんでした：" + e.message);
  } finally { btn.classList.remove("spin"); }
}
function getPass() {
  const m = location.hash.match(/k=([^&]+)/);              // #k=… で開いたら端末に覚える
  if (m) { localStorage.setItem(KEY_STORE, decodeURIComponent(m[1])); history.replaceState(null, "", location.pathname + location.search); }
  return localStorage.getItem(KEY_STORE);
}
function forgetPass() { localStorage.removeItem(KEY_STORE); }

/* ---------- 画面 ---------- */
function showLock(msg = "") {
  $("#app").hidden = true; $("#lock").hidden = false;
  $("#lockErr").textContent = msg;
  setPill("ロック中", false);
  setTimeout(() => $("#pw").focus(), 50);
}
function setPill(text, ok) {
  const p = $("#sysPill"); p.classList.toggle("ok", ok); p.querySelector("span").textContent = text;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeUrl(u) { return /^https?:\/\//.test(u || "") ? u : ""; }

function render() {
  const today = todayISO();
  const tasks = state.snap.tasks.map(t => ({ ...t, b: bucketOf(t, today), over: !!(t.due && t.due < today) }));
  state.tasks = tasks;
  const n = Object.fromEntries(BUCKETS.map(b => [b.id, tasks.filter(t => t.b === b.id).length]));
  const open = tasks.filter(t => t.b !== "done");
  const highOpen = open.filter(isHigh);
  const todayOpen = open.filter(t => t.today || (t.due && t.due <= today));

  $("#lock").hidden = true; $("#app").hidden = false;
  setPill(n.alert ? "要注意あり" : "稼働中", !n.alert);

  // 中央のリアクター
  drawReactor(n, tasks.length);
  $("#coreNum").textContent = n.call;
  $("#corePill").innerHTML = n.call
    ? `<span><i></i>判断待ち ${n.call}件</span>`
    : `<span class="clear"><i></i>判断待ちなし</span>`;
  $("#coreSub").textContent = n.work ? `いま作業中 ${n.work}件・順番待ち ${n.queue}件` : `作業中のものはありません・順番待ち ${n.queue}件`;
  $("#legend").innerHTML = BUCKETS.filter(b => b.id !== "call")
    .map(b => `<li><i style="background:${b.color}"></i>${b.ja}<b>${n[b.id]}</b></li>`).join("");

  // 判断待ち：高優先→期限→名前の順に3件
  const calls = tasks.filter(t => t.b === "call").sort(sortKey);
  $("#callList").innerHTML = calls.length
    ? calls.slice(0, 3).map(callItem).join("") + (calls.length > 3 ? `<button class="more" data-jump="call">判断待ちをすべて見る（${calls.length}件）</button>` : "")
    : `<div class="empty"><i>✓</i>判断待ちなし</div><p class="call-next">ゆうすけさんの判断で止まっている業務はありません。</p>`;

  // 今日やること：今日やる✓ or 期限が今日まで（期限切れ含む）
  const todays = todayOpen.sort(sortKey);
  $("#todayList").innerHTML = todays.length
    ? todays.slice(0, 5).map(callItem).join("") + (todays.length > 5 ? `<button class="more" data-jump="today">今日やることをすべて見る（${todays.length}件）</button>` : "")
    : `<div class="empty"><i>✓</i>今日やることはありません</div>`;

  // SYSTEM STATUS
  const done = n.done, total = tasks.length || 1;
  const gauges = [
    { en: "TODAY", ja: "今日やる", v: todays.length, max: open.length, c: "#ff6a72", jump: "today" },
    { en: "PRIORITY", ja: "重要", v: highOpen.length, max: open.length, c: "#ff2a3d", jump: "high" },
    { en: "OVERDUE", ja: "期限切れ", v: open.filter(t => t.over).length, max: open.length, c: "#ffb84a", jump: "alert" },
    { en: "DONE", ja: "完了", v: done, max: total, c: "#e9e2e0", jump: "done" },
  ];
  $("#gauges").innerHTML = gauges.map(g => {
    const C = 2 * Math.PI * 32, f = g.max ? Math.min(g.v / g.max, 1) : 0;
    return `<button class="gauge" data-jump="${g.jump}" aria-label="${g.ja} ${g.v}件">
      <svg viewBox="0 0 80 80"><circle class="g-ticks" cx="40" cy="40" r="38"/><circle class="g-track" cx="40" cy="40" r="32"/><circle class="g-in" cx="40" cy="40" r="25"/>
      <circle class="g-val" cx="40" cy="40" r="32" stroke="${g.c}" stroke-dasharray="${(C * f).toFixed(1)} ${C.toFixed(1)}" style="filter:drop-shadow(0 0 4px ${g.c})"/>
      <text x="40" y="41">${g.v}</text></svg>
      <div class="g-en">${g.en}</div><div class="g-ja">${g.ja}</div></button>`;
  }).join("");
  $("#bars").innerHTML = ["work", "queue", "alert", "done"].map(id => {
    const b = B[id];
    return `<button class="bar" data-jump="${id}"><div class="bar-row"><div><div class="bar-en" style="${id === "alert" ? "color:var(--amber)" : ""}">${b.en}</div>
      <div class="bar-ja">${b.ja}</div></div><div class="bar-n" style="color:${b.color}">${n[id]}</div></div>
      <div class="bar-line"><i style="width:${(n[id] / total * 100).toFixed(1)}%;background:${b.color}"></i></div></button>`;
  }).join("");

  // フィルター
  const chips = [{ id: "all", ja: "すべて", c: "#fff3f1", n: tasks.length }, { id: "today", ja: "今日", c: "#ff6a72", n: todays.length },
    ...BUCKETS.map(b => ({ id: b.id, ja: b.ja, c: b.color, n: n[b.id] }))];
  $("#filters").innerHTML = chips.map(c =>
    `<button class="chip" role="tab" data-f="${c.id}" aria-selected="${state.filter === c.id}"><i style="background:${c.c}"></i>${c.ja}<b>${c.n}</b></button>`).join("");
  renderList();

  const g = state.snap.generated;
  $("#syncInfo").textContent = `最終同期 ${g.slice(0, 10).replaceAll("-", "/")} ${g.slice(11, 16)}（Notion → このアプリ）`;
  const bl = safeUrl(state.snap.board); $("#boardLink").href = bl || "#";
  $("#hudSync").textContent = `SYNC ${g.slice(5, 10).replace("-", ".")} ${g.slice(11, 16)}`;
  $("#hudLoad").textContent = `LOAD ${String(open.length).padStart(3, "0")} / ${String(tasks.length).padStart(3, "0")}`;
}

function tagsFor(t) {
  const b = B[t.b];
  return [
    `<span class="tag st" style="color:${b.color};border-color:${b.color}55">${b.ja}</span>`,
    isHigh(t) ? `<span class="tag hi">重要</span>` : "",
    t.due ? `<span class="tag ${t.over ? "over" : "due"}">${t.over ? "期限切れ " : "期限 "}${md(t.due)}</span>` : "",
    t.proj ? `<span class="tag">${esc(t.proj)}</span>` : "",
    t.who ? `<span class="tag">👤 ${esc(t.who)}</span>` : "",
  ].join("");
}
function callItem(t) {
  return `<a class="call" href="#t-${t.id}" data-open="${t.id}"><div class="call-title">${esc(t.name)}</div>
    ${t.next ? `<div class="call-next">→ ${esc(t.next)}</div>` : ""}<div class="call-meta">${tagsFor(t)}</div></a>`;
}

function renderList() {
  const today = todayISO(), q = state.q.trim().toLowerCase();
  let list = state.tasks.filter(t => {
    if (state.filter === "all") return true;
    if (state.filter === "today") return t.b !== "done" && (t.today || (t.due && t.due <= today));
    if (state.filter === "high") return t.b !== "done" && isHigh(t);
    return t.b === state.filter;
  });
  if (state.onlyHigh) list = list.filter(isHigh);
  if (q) list = list.filter(t => [t.name, t.proj, t.who, t.next, t.memo, t.src].join(" ").toLowerCase().includes(q));
  const order = { call: 0, alert: 1, work: 2, queue: 3, done: 4 };
  list.sort((a, b) => order[a.b] - order[b.b] || sortKey(a, b));
  $("#taskCount").textContent = `${list.length} / ${state.tasks.length} TASKS`;
  $("#taskList").innerHTML = list.length ? list.map(t => {
    const src = safeUrl(t.url), nt = safeUrl(t.notion);
    return `<article class="task${state.open.has(t.id) ? " open" : ""}" id="t-${t.id}" style="--c:${B[t.b].color}">
      <button class="task-btn" data-toggle="${t.id}" aria-expanded="${state.open.has(t.id)}">
        <div class="task-title">${esc(t.name)}</div><div class="task-meta">${tagsFor(t)}</div>
        ${t.next ? `<div class="task-next">→ ${esc(t.next)}</div>` : ""}</button>
      <div class="task-more"><dl>
        <dt>状態</dt><dd>${esc(t.st)}</dd><dt>優先度</dt><dd>${esc(t.pri || "—")}</dd>
        <dt>元の場所</dt><dd>${esc(t.src || "—")}</dd><dt>更新</dt><dd>${esc(t.upd || "—")}</dd>
        ${t.memo ? `<dt>メモ</dt><dd>${esc(t.memo)}</dd>` : ""}</dl>
        <div class="links"><a href="${src || "#"}" target="_blank" rel="noopener" aria-disabled="${!src}">元リンク ↗</a>
        <a class="cy" href="${nt || "#"}" target="_blank" rel="noopener" aria-disabled="${!nt}">Notionで開く ↗</a></div>
      </div></article>`;
  }).join("") : `<div class="empty" style="color:var(--sub)"><i style="border-color:var(--dim)">–</i>該当するタスクはありません</div>`;
}

function drawReactor(n, total) {
  // 340x340 の多層リング：外周の装甲フレーム → 目盛り → データの装甲帯（分類ごと）→ 白い発光リング → 芯
  const cx = 170, P = (r, a) => [cx + r * Math.cos(a), cx + r * Math.sin(a)];
  const arc = (r, a0, a1) => { const [x0, y0] = P(r, a0), [x1, y1] = P(r, a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  const D = Math.PI / 180;
  // 外周フレーム：切れ目のある太い弧＋ブラケット
  let frame = "";
  [[-80, -8], [8, 62], [74, 152], [166, 236], [250, 268]].forEach(([a, b]) =>
    frame += `<path d="${arc(160, a * D, b * D)}" class="fr"/>`);
  [[-4, 4], [158, 162], [270, 278]].forEach(([a, b]) => frame += `<path d="${arc(160, a * D, b * D)}" class="fr-hi"/>`);
  // 目盛り（5本ごとに長い）
  let ticks = "";
  for (let i = 0; i < 120; i++) { const a = i * 3 * D, long = i % 5 === 0;
    const [x0, y0] = P(long ? 139 : 142, a), [x1, y1] = P(148, a);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${long ? "tk-l" : "tk"}"/>`; }
  // データの装甲帯：各分類の割合で弧を分け、パネルの継ぎ目で刻む
  const R = 122, W = 18, order = ["call", "alert", "work", "queue", "done"];
  let a0 = -90 * D, band = "";
  for (const id of order) {
    if (!n[id]) continue;
    const span = 2 * Math.PI * n[id] / (total || 1), a1 = a0 + span - 1.6 * D;
    band += `<path d="${arc(R, a0, Math.max(a1, a0 + .5 * D))}" stroke="${B[id].color}" class="band${id === "call" ? " band-hot" : ""}"/>`;
    a0 += span;
  }
  // 装甲帯の上に継ぎ目（黒い細線）と内外の縁
  let seams = "";
  for (let i = 0; i < 36; i++) { const a = i * 10 * D; const [x0, y0] = P(R - W / 2 - 1, a), [x1, y1] = P(R + W / 2 + 1, a);
    seams += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="seam"/>`; }
  // 白い発光リングの左に計器の細い弧（差し色）と小さな点
  const dots = [-118, -110, -102, -94].map(d => { const [x, y] = P(104, d * D); return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" class="dot"/>`; }).join("");
  $("#reactor").innerHTML = `<title id="coreLabel">判断待ち ${n.call}件・作業中 ${n.work}件・順番待ち ${n.queue}件・要注意 ${n.alert}件・完了 ${n.done}件</title>
    <defs>
      <radialGradient id="coreGrad"><stop offset="0" stop-color="#ff2a3d" stop-opacity=".42"/><stop offset=".6" stop-color="#3a040b" stop-opacity=".7"/><stop offset="1" stop-color="#050103"/></radialGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <style>
      .fr{fill:none;stroke:rgba(255,243,241,.55);stroke-width:3}
      .fr-hi{fill:none;stroke:#ff2a3d;stroke-width:6}
      .tk{stroke:rgba(255,235,232,.28);stroke-width:1}
      .tk-l{stroke:rgba(255,235,232,.6);stroke-width:1.3}
      .trk{fill:none;stroke:rgba(255,255,255,.05);stroke-width:${W}}
      .band{fill:none;stroke-width:${W};opacity:.82}
      .band-hot{filter:url(#glow);opacity:1}
      .seam{stroke:#010102;stroke-width:1.6}
      .edge{fill:none;stroke:rgba(255,243,241,.25);stroke-width:.8}
      .meas{fill:none;stroke:#a8e6ff;stroke-width:1.4;opacity:.8}
      .dot{fill:#a8e6ff;opacity:.85}
      .dash1{fill:none;stroke:rgba(255,90,100,.55);stroke-width:1;stroke-dasharray:14 4 2 4}
      .dash2{fill:none;stroke:rgba(255,243,241,.25);stroke-width:1;stroke-dasharray:1 5}
      .wr{fill:none;stroke:#fff3f1;stroke-width:3;filter:url(#glow)}
      .inner{fill:url(#coreGrad);stroke:rgba(255,42,61,.6);stroke-width:1}
      .xh{stroke:rgba(255,243,241,.18);stroke-width:.8}
    </style>
    ${frame}${ticks}
    <circle class="trk" cx="170" cy="170" r="${R}"/>${band}${seams}
    <circle cx="170" cy="170" r="${R + 4}" fill="none" stroke="rgba(255,243,241,.22)" stroke-width="1.2"/>
    <circle cx="170" cy="170" r="${R - 6}" fill="none" stroke="rgba(1,1,2,.35)" stroke-width="5"/>
    <circle class="edge" cx="170" cy="170" r="${R + W / 2 + 2}"/><circle class="edge" cx="170" cy="170" r="${R - W / 2 - 2}"/>
    <g class="rot"><circle class="dash1" cx="170" cy="170" r="104"/></g>
    <path class="meas" d="${arc(98, 150 * D, 222 * D)}"/>${dots}
    <g class="rot rev"><circle class="dash2" cx="170" cy="170" r="96"/></g>
    <circle class="wr" cx="170" cy="170" r="88"/>
    <circle class="inner" cx="170" cy="170" r="82"/>
    <line class="xh" x1="96" y1="170" x2="112" y2="170"/><line class="xh" x1="228" y1="170" x2="244" y2="170"/>
    <line class="xh" x1="170" y1="96" x2="170" y2="104"/><line class="xh" x1="170" y1="236" x2="170" y2="244"/>`;
}

/* ---------- 操作 ---------- */
function setFilter(f) {
  state.filter = f;
  document.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-selected", c.dataset.f === f));
  renderList();
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove("show"), 2600);
}
document.addEventListener("click", e => {
  const jump = e.target.closest("[data-jump]");
  if (jump) { setFilter(jump.dataset.jump); $("#panelTasks").scrollIntoView({ behavior: "smooth" }); return; }
  const chip = e.target.closest(".chip"); if (chip) return setFilter(chip.dataset.f);
  const tg = e.target.closest("[data-toggle]");
  if (tg) { const id = tg.dataset.toggle; state.open.has(id) ? state.open.delete(id) : state.open.add(id); return renderList(); }
  const op = e.target.closest("[data-open]");
  if (op) {
    e.preventDefault(); const id = op.dataset.open;
    state.filter = "all"; state.q = ""; state.onlyHigh = false; $("#q").value = ""; $("#onlyHigh").setAttribute("aria-pressed", "false");
    state.open.add(id); setFilter("all");
    document.getElementById(`t-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
});
$("#q").addEventListener("input", e => { state.q = e.target.value; renderList(); });
$("#onlyHigh").addEventListener("click", e => {
  state.onlyHigh = !state.onlyHigh; e.currentTarget.setAttribute("aria-pressed", state.onlyHigh); renderList();
});
$("#btnRefresh").addEventListener("click", () => load({ manual: true }));
$("#btnLock").addEventListener("click", () => { forgetPass(); localStorage.removeItem(CACHE_STORE); state.snap = null; showLock("鍵を消しました"); });
$("#lockForm").addEventListener("submit", e => {
  e.preventDefault(); const v = $("#pw").value.trim(); if (!v) return;
  localStorage.setItem(KEY_STORE, v); $("#pw").value = ""; load();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.snap) load(); });

if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
load();

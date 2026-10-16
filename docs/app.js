/* J.A.R.V.I.S. タスクボード — data/tasks.enc.json を復号して表示する（読み取り専用）。
   正本は Notion の統合タスクボード。編集は各タスクの「Notionで開く」から。 */
"use strict";

const DATA_URL = "data/tasks.enc.json";
const KEY_STORE = "jarvis.pass";
const CACHE_STORE = "jarvis.snap";

// 5つの大分類（色は CSS 変数と同じ値）
const BUCKETS = [
  { id: "call",  ja: "判断待ち",    color: "#ff4d5e" },
  { id: "work",  ja: "作業中",      color: "#8fd3f4" },
  { id: "queue", ja: "順番待ち",    color: "#9a9aa6" },
  { id: "alert", ja: "要注意・停止", color: "#f5a524" },
  { id: "done",  ja: "完了",        color: "#6fd09a" },
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
    setPill("通信エラー", "warn");
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
  setPill("ロック中", "");
  setTimeout(() => $("#pw").focus(), 50);
}
function setPill(text, kind) {
  const p = $("#sysPill"); p.classList.toggle("ok", kind === "ok"); p.classList.toggle("warn", kind === "warn");
  p.querySelector("span").textContent = text;
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function safeUrl(u) { return /^https?:\/\//.test(u || "") ? u : ""; }

function render() {
  const today = todayISO();
  const tasks = state.snap.tasks.map(t => ({ ...t, b: bucketOf(t, today), over: !!(t.due && t.due < today) }));
  state.tasks = tasks;
  const n = Object.fromEntries(BUCKETS.map(b => [b.id, tasks.filter(t => t.b === b.id).length]));
  const open = tasks.filter(t => t.b !== "done");

  $("#lock").hidden = true; $("#app").hidden = false;
  setPill(n.alert ? `要注意 ${n.alert}` : "稼働中", n.alert ? "warn" : "ok");

  // 稼働状況：中央は判断待ち、下に4つの状態（数字・ラベル・色だけ）
  drawReactor(n, tasks.length);
  $("#coreNum").textContent = n.call;
  $("#coreSub").textContent = `未完了 ${open.length}件・完了 ${n.done}件`;
  $("#stats").innerHTML = ["call", "work", "alert", "queue"].map(id => {
    const b = B[id];
    return `<button class="stat bar${id === "call" ? " is-call" : ""}" data-jump="${id}" style="--c:${b.color}" aria-label="${b.ja} ${n[id]}件">
      <span class="stat-l">${b.ja}</span><span class="stat-n">${n[id]}</span></button>`;
  }).join("");

  // 要対応：判断待ちを重要→期限→名前の順に3件
  const calls = tasks.filter(t => t.b === "call").sort(sortKey);
  $("#callN").textContent = calls.length ? `${calls.length}件` : "";
  $("#callList").innerHTML = calls.length
    ? calls.slice(0, 3).map(callItem).join("") + (calls.length > 3 ? `<button class="more" data-jump="call">判断待ちをすべて見る（${calls.length}件）</button>` : "")
    : `<div class="empty"><b>✓</b> 判断待ちはありません</div>`;

  // 今日のタスク：今日やる✓ or 期限が今日まで。要対応に出したものは重ねない
  const shown = new Set(calls.slice(0, 3).map(t => t.id));
  const todaysAll = open.filter(t => t.today || (t.due && t.due <= today)).sort(sortKey);
  const todays = todaysAll.filter(t => !shown.has(t.id));
  $("#todayN").textContent = todaysAll.length ? `${todaysAll.length}件` : "";
  $("#todayList").innerHTML = todays.length
    ? `<div class="rows">${todays.slice(0, 6).map(rowItem).join("")}${todays.length > 6 ? `<button class="more" data-jump="today">今日のタスクをすべて見る（${todaysAll.length}件）</button>` : ""}</div>`
    : `<div class="rows"><div class="empty">ほかに今日のタスクはありません</div></div>`;

  // 全タスクの絞り込み
  const chips = [{ id: "all", ja: "すべて", c: "#f2f2f4", n: tasks.length }, { id: "today", ja: "今日", c: "#ffb3ba", n: todaysAll.length },
    ...BUCKETS.map(b => ({ id: b.id, ja: b.ja, c: b.color, n: n[b.id] }))];
  $("#filters").innerHTML = chips.map(c =>
    `<button class="chip" role="tab" data-f="${c.id}" aria-selected="${state.filter === c.id}"><i style="background:${c.c}"></i>${c.ja}<b>${c.n}</b></button>`).join("");
  renderList();

  const g = state.snap.generated;
  $("#syncInfo").textContent = `最終同期 ${+g.slice(5, 7)}/${+g.slice(8, 10)} ${g.slice(11, 16)}（Notion → このアプリ）`;
  const bl = safeUrl(state.snap.board); $("#boardLink").href = bl || "#";
}

function dueText(t) {
  if (!t.due) return "";
  const today = todayISO();
  if (t.over) return `<span class="due over">期限切れ ${md(t.due)}</span>`;
  return `<span class="due${t.due === today ? " soon" : ""}">${t.due === today ? "今日まで" : "期限 " + md(t.due)}</span>`;
}
function callItem(t) {
  const src = safeUrl(t.url);
  return `<div class="call" data-open="${t.id}" role="button" tabindex="0">
    <div class="call-top"><span class="call-dot${isHigh(t) ? " hi" : ""}"></span><div class="call-title">${esc(t.name)}</div></div>
    ${t.next ? `<div class="call-next">${esc(t.next)}</div>` : ""}
    <div class="call-foot">${isHigh(t) ? `<span class="badge-hi">重要</span>` : ""}${dueText(t)}
      <a class="src" href="${src || "#"}" target="_blank" rel="noopener" aria-disabled="${!src}">元リンク</a></div></div>`;
}
function rowItem(t) {
  const who = t.who ? `<b>${esc(t.who)}</b>` : "";
  const meta = [isHigh(t) ? `<span style="color:#ffb3ba;font-weight:700">重要</span>` : "", who, t.due ? (t.over ? `<span style="color:var(--amber)">期限切れ ${md(t.due)}</span>` : `期限 ${md(t.due)}`) : ""].filter(Boolean).join("　");
  return `<button class="row" data-open="${t.id}" style="--c:${B[t.b].color}"><span class="row-bar"></span>
    <span class="row-main"><span class="row-title">${esc(t.name)}</span>${meta ? `<span class="row-meta" style="display:block">${meta}</span>` : ""}</span></button>`;
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
  $("#taskCount").textContent = `${list.length}件を表示（全${state.tasks.length}件）`;
  $("#taskList").innerHTML = list.length ? list.map(t => {
    const src = safeUrl(t.url), nt = safeUrl(t.notion), b = B[t.b];
    const meta = [`<span class="st" style="color:${b.color}">${b.ja}</span>`, isHigh(t) ? `<span class="badge-hi">重要</span>` : "",
      dueText(t), t.who ? `<span>${esc(t.who)}</span>` : ""].filter(Boolean).join("");
    return `<article class="task${state.open.has(t.id) ? " open" : ""}" id="t-${t.id}" style="--c:${b.color}">
      <button class="task-btn" data-toggle="${t.id}" aria-expanded="${state.open.has(t.id)}">
        <div class="task-title">${esc(t.name)}</div><div class="task-meta">${meta}</div>
        ${t.next ? `<div class="task-next">${esc(t.next)}</div>` : ""}</button>
      <div class="task-more"><dl>
        <dt>プロジェクト</dt><dd>${esc(t.proj || "—")}</dd><dt>状態</dt><dd>${esc(t.st)}</dd><dt>優先度</dt><dd>${esc(t.pri || "—")}</dd>
        <dt>元の場所</dt><dd>${esc(t.src || "—")}</dd><dt>更新</dt><dd>${esc(t.upd || "—")}</dd>
        ${t.memo ? `<dt>メモ</dt><dd>${esc(t.memo)}</dd>` : ""}</dl>
        <div class="links"><a href="${src || "#"}" target="_blank" rel="noopener" aria-disabled="${!src}">元リンク</a>
        <a class="cy" href="${nt || "#"}" target="_blank" rel="noopener" aria-disabled="${!nt}">Notionで開く</a></div>
      </div></article>`;
  }).join("") : `<div class="rows"><div class="empty">該当するタスクはありません</div></div>`;
}

function drawReactor(n, total) {
  // 小さく精密に：細い金の外枠 → 目盛り → 状態ごとの弧（上に薄い光沢）→ 暗いドーム → 内側の赤い光
  const cx = 120, D = Math.PI / 180, P = (r, a) => [cx + r * Math.cos(a), cx + r * Math.sin(a)];
  const arc = (r, a0, a1) => { const [x0, y0] = P(r, a0), [x1, y1] = P(r, a1);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
  let ticks = "";
  for (let i = 0; i < 60; i++) { const a = i * 6 * D, long = i % 5 === 0;
    const [x0, y0] = P(long ? 104 : 107, a), [x1, y1] = P(110, a);
    ticks += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" stroke="${long ? "rgba(230,211,163,.7)" : "rgba(255,255,255,.18)"}" stroke-width="${long ? 1.4 : 1}"/>`; }
  const R = 92, W = 9, order = ["call", "alert", "work", "queue", "done"];
  let a0 = -90 * D, segs = "";
  for (const id of order) {
    if (!n[id]) continue;
    const span = 2 * Math.PI * n[id] / (total || 1), a1 = a0 + span - 2.2 * D;
    segs += `<path d="${arc(R, a0, Math.max(a1, a0 + .6 * D))}" stroke="${B[id].color}" stroke-width="${W}" fill="none" stroke-linecap="butt"/>`;
    a0 += span;
  }
  $("#reactor").innerHTML = `<title id="coreLabel">判断待ち ${n.call}件・作業中 ${n.work}件・順番待ち ${n.queue}件・要注意 ${n.alert}件・完了 ${n.done}件</title>
    <defs>
      <radialGradient id="rGlow"><stop offset="0" stop-color="#ff4d5e" stop-opacity=".30"/><stop offset=".55" stop-color="#8c0e1e" stop-opacity=".16"/><stop offset="1" stop-color="#8c0e1e" stop-opacity="0"/></radialGradient>
      <radialGradient id="rDome" cx=".45" cy=".35" r=".75"><stop offset="0" stop-color="#2a0c12"/><stop offset=".7" stop-color="#120608"/><stop offset="1" stop-color="#08080a"/></radialGradient>
      <linearGradient id="rRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f1e2b8"/><stop offset=".35" stop-color="#a8864a"/><stop offset=".65" stop-color="#5e4720"/><stop offset="1" stop-color="#d9c08a"/></linearGradient>
      <linearGradient id="rSheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
    </defs>
    <circle cx="120" cy="120" r="120" fill="url(#rGlow)"/>
    <circle cx="120" cy="120" r="114" fill="none" stroke="url(#rRim)" stroke-width="1.6"/>
    ${ticks}
    <circle cx="120" cy="120" r="${R}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="${W}"/>${segs}
    <circle cx="120" cy="120" r="${R}" fill="none" stroke="url(#rSheen)" stroke-width="${W}"/>
    <circle cx="120" cy="120" r="80" fill="url(#rDome)" stroke="url(#rRim)" stroke-width="1.2"/>
    <circle cx="120" cy="120" r="79" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
    <path d="${arc(79, 205 * D, 245 * D)}" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.2" stroke-linecap="round"/>`;
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
  if (e.target.closest("a.src")) return;
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
document.addEventListener("keydown", e => {
  const c = e.target.closest?.(".call[data-open]");
  if (c && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); c.click(); }
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

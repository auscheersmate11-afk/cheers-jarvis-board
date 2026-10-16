// iPhone 幅でヘッドレス Chrome を開き、画面を撮って主な機能を確かめる。
//   JARVIS_PASS=$(security find-generic-password -s cm-jarvis-board -w) node tools/test_ui.mjs [URL]
// パスフレーズは環境変数で渡す（ファイルに書かない）。スクショは test-shots/（.gitignore 済み）。
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = process.argv[2] || "http://127.0.0.1:8796/";
const PASS = process.env.JARVIS_PASS;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
mkdirSync("test-shots", { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, "--no-first-run",
  "--user-data-dir=/tmp/jarvis-test-profile", "about:blank"], { stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params }));
});
const ev = async expr => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval error");
  return r.result.value;
};
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok, info }); console.log(`${ok ? "✔" : "✘"} ${name}${info ? " — " + info : ""}`); };
async function shot(name, full = true) {
  const m = await send("Page.getLayoutMetrics");
  const h = full ? Math.ceil(m.cssContentSize.height) : 844;
  if (full) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: h, deviceScaleFactor: 1, mobile: true });
  const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: full,
    clip: { x: 0, y: full ? 0 : await ev("scrollY"), width: 390, height: h, scale: 1 } });
  writeFileSync(`test-shots/${name}.png`, Buffer.from(r.data, "base64"));
  if (full) await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
}

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = l.find(t => t.type === "page"); } catch {}
    if (!target) await sleep(250);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener("open", r));
  const errors = [];
  ws.addEventListener("message", m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id).res(d.result || {}); pending.delete(d.id); }
    if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description);
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map(a => a.value).join(" "));
  });
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Tokyo" });

  // 1) 鍵なし → ロック画面
  await send("Page.navigate", { url: URL_ }); await sleep(1500);
  await ev("localStorage.clear()"); await send("Page.reload"); await sleep(1500);
  check("鍵なしはロック画面", await ev("!document.querySelector('#lock').hidden && document.querySelector('#app').hidden"));
  await shot("01_lock", false);

  // 2) 間違いのパスフレーズ
  await ev(`document.querySelector('#pw').value='wrong-pass';document.querySelector('#lockForm').requestSubmit();`); await sleep(2500);
  check("違うパスフレーズは拒否", await ev("document.querySelector('#lockErr').textContent.includes('合いません')"));

  // 3) 正しいパスフレーズ
  await ev(`document.querySelector('#pw').value=${JSON.stringify(PASS)};document.querySelector('#lockForm').requestSubmit();`); await sleep(3000);
  const total = await ev("state.snap?.tasks.length || 0");
  check("復号して表示", !await ev("document.querySelector('#app').hidden") && total > 0, `${total}件`);
  const counts = await ev(`Object.fromEntries(${JSON.stringify(["call","work","queue","alert","done"])}.map(b=>[b,state.tasks.filter(t=>t.b===b).length]))`);
  check("5分類の合計＝全件", Object.values(counts).reduce((a, b) => a + b, 0) === total, JSON.stringify(counts));
  check("中央の数字＝判断待ち", await ev("document.querySelector('#coreNum').textContent") == counts.call);
  check("判断待ちカード3件以内", await ev("document.querySelectorAll('#callList .call').length") <= 3);
  check("横スクロールなし", await ev("document.documentElement.scrollWidth <= innerWidth"), await ev("document.documentElement.scrollWidth + '/' + innerWidth"));
  await shot("02_home_top", false);
  await shot("03_home_full", true);

  // 4) 絞り込み
  for (const f of ["work", "queue", "call", "alert", "done", "today"]) {
    await ev(`document.querySelector('.chip[data-f="${f}"]').click()`); await sleep(150);
    const shown = await ev("document.querySelectorAll('#taskList .task').length");
    const want = f === "today" ? await ev(`state.tasks.filter(t=>t.b!=='done'&&(t.today||(t.due&&t.due<=todayISO()))).length`) : counts[f];
    check(`絞り込み：${f}`, shown === want, `${shown}件`);
  }
  await ev(`document.querySelector('.chip[data-f="all"]').click()`); await sleep(100);
  check("すべて＝全件", await ev("document.querySelectorAll('#taskList .task').length") === total);

  // 5) 重要だけ・検索
  await ev("document.querySelector('#onlyHigh').click()"); await sleep(100);
  const hi = await ev("[...document.querySelectorAll('#taskList .task')].length");
  check("重要だけ", hi === await ev("state.tasks.filter(t=>t.pri==='高').length"), `${hi}件`);
  await ev("document.querySelector('#onlyHigh').click()");
  await ev(`{const q=document.querySelector('#q');q.value='オフ会';q.dispatchEvent(new Event('input'))}`); await sleep(100);
  const hits = await ev("document.querySelectorAll('#taskList .task').length");
  check("検索「オフ会」", hits > 0 && await ev("[...document.querySelectorAll('#taskList .task-title')].every(e=>e.closest('.task').textContent.includes('オフ会'))"), `${hits}件`);
  await ev(`{const q=document.querySelector('#q');q.value='';q.dispatchEvent(new Event('input'))}`);

  // 6) 開閉・リンク
  await ev("document.querySelector('#taskList .task-btn').click()"); await sleep(100);
  check("タスクを開くと詳細とリンク", await ev("!!document.querySelector('#taskList .task.open .links a.cy[href^=\"https://\"]')"));
  await shot("04_list_open", false);
  await ev("document.querySelector('#callList .call')?.click()"); await sleep(600);
  check("判断待ちカード→一覧の該当タスクが開く", await ev("document.querySelectorAll('#taskList .task.open').length") >= 1);
  await ev(`document.querySelector('.bar[data-jump="alert"]').click()`); await sleep(200);
  check("SYSTEM STATUS のバー→絞り込み", await ev("state.filter") === "alert");
  await ev("window.scrollTo(0, document.querySelector('#panelTasks').offsetTop - 60)"); await sleep(300);
  await shot("05_alert_filter", false);

  // 7) PWA の部品
  check("manifest 読める", await ev("fetch('manifest.webmanifest').then(r=>r.json()).then(j=>j.display==='standalone'&&j.icons.length>=3)"));
  check("service worker 登録", await ev("navigator.serviceWorker.getRegistration().then(r=>!!r)"));
  check("暗号文にタスク名が平文で入っていない", await ev("fetch('data/tasks.enc.json').then(r=>r.text()).then(t=>state.snap.tasks.every(x=>!t.includes(x.name.slice(0,8))))"));
  check("JSエラーなし", errors.length === 0, errors.join(" | "));
} catch (e) { check("テストの実行", false, e.message); }
finally {
  chrome.kill();
  const bad = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - bad}/${results.length} OK`);
  process.exit(bad ? 1 : 0);
}

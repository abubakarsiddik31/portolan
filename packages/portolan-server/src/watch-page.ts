/**
 * The watch viewer: one self-contained page, no external requests.
 *
 * The inline script avoids template literals so this file can hold it in one.
 */
export const WATCH_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Portolan watch</title>
<style>
:root {
  --bg: #f6f5f1;
  --panel: #ffffff;
  --ink: #18201e;
  --muted: #66706c;
  --line: #e3e1da;
  --brand: #0e3b33;
  --accent: #b8913f;
  --ok: #1f7a4d;
  --err: #b3362b;
  --run: #8a6d1f;
  --code-bg: #f1efe8;
  --stage: #e9e7e0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f1312;
    --panel: #161b1a;
    --ink: #e7ebe9;
    --muted: #8d9894;
    --line: #26302d;
    --brand: #7fc4b3;
    --accent: #e7c987;
    --ok: #5cc28d;
    --err: #ef7a6e;
    --run: #e7c987;
    --code-bg: #101514;
    --stage: #0b0f0e;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  display: flex;
  flex-direction: column;
}
.mono { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--line);
  background: var(--panel);
}
.mark { width: 22px; height: 22px; }
h1 { font-size: 15px; font-weight: 600; margin: 0; letter-spacing: 0.01em; }
h1 span { color: var(--muted); font-weight: 400; }
.conn {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted);
  font-size: 13px;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); }
.dot.live { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
.dot.down { background: var(--err); }
main {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, 1fr);
  gap: 16px;
  padding: 16px 20px 20px;
}
section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
  min-height: 44px;
}
.bar h2 { font-size: 13px; font-weight: 600; margin: 0; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--ink);
  background: var(--code-bg);
  border-radius: 6px;
  padding: 4px 10px;
}
.stage {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--stage);
  position: relative;
}
.stage img { max-width: 100%; max-height: 100%; object-fit: contain; display: none; }
.stage.has-frame img { display: block; }
.stage.has-frame .empty { display: none; }
.empty { max-width: 360px; text-align: center; color: var(--muted); padding: 24px; }
.empty strong { display: block; color: var(--ink); font-weight: 600; margin-bottom: 6px; }
.flash {
  position: absolute;
  left: 12px;
  bottom: 12px;
  max-width: calc(100% - 24px);
  background: color-mix(in srgb, var(--panel) 92%, transparent);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 160ms ease, transform 160ms ease;
  pointer-events: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.flash.show { opacity: 1; transform: none; }
.stats { margin-left: auto; color: var(--muted); font-size: 12.5px; display: flex; gap: 12px; }
.stats b { color: var(--ink); font-weight: 600; }
label.follow { display: flex; align-items: center; gap: 6px; color: var(--muted); font-size: 12.5px; cursor: pointer; }
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
li { border-bottom: 1px solid var(--line); }
li > button {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  display: grid;
  grid-template-columns: 62px minmax(0, 1fr) auto;
  gap: 10px;
  align-items: baseline;
  padding: 9px 14px;
  cursor: pointer;
}
li > button:hover { background: var(--code-bg); }
li > button:focus-visible { outline: 2px solid var(--brand); outline-offset: -2px; }
.time { color: var(--muted); font-size: 12px; }
.what { min-width: 0; }
.tool { font-weight: 600; font-size: 13px; }
.args { color: var(--muted); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.badge {
  font-size: 11.5px;
  font-weight: 600;
  border-radius: 999px;
  padding: 2px 8px;
  white-space: nowrap;
}
.badge.run { color: var(--run); background: color-mix(in srgb, var(--run) 14%, transparent); }
.badge.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.badge.err { color: var(--err); background: color-mix(in srgb, var(--err) 14%, transparent); }
li.page { color: var(--muted); font-size: 12.5px; padding: 7px 14px 7px 86px; }
.detail { display: none; padding: 0 14px 12px 86px; }
li.open .detail { display: block; }
.detail h3 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 8px 0 4px; font-weight: 600; }
pre {
  margin: 0;
  background: var(--code-bg);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 260px;
  overflow: auto;
}
.none { padding: 28px 16px; color: var(--muted); text-align: center; }
@media (max-width: 860px) {
  main { grid-template-columns: 1fr; grid-template-rows: minmax(240px, 45vh) minmax(320px, 1fr); padding: 12px 16px 16px; }
  header { padding: 12px 16px; }
  li > button { grid-template-columns: 52px minmax(0, 1fr) auto; }
  li.page, .detail { padding-left: 76px; }
}
</style>
</head>
<body>
<header>
  <svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.6" opacity="0.5"/>
    <path d="M12 3 L14.2 12 L12 21 L9.8 12 Z" fill="currentColor"/>
  </svg>
  <h1>Portolan <span>watch</span></h1>
  <div class="conn"><span class="dot" id="dot"></span><span id="conn">connecting</span></div>
</header>
<main>
  <section aria-label="Browser">
    <div class="bar">
      <h2>Browser</h2>
      <div class="url mono" id="url">no page</div>
    </div>
    <div class="stage" id="stage">
      <img id="frame" alt="The page the agent is driving">
      <div class="empty">
        <strong>No browser open yet</strong>
        The page appears when the agent calls view, act, read, open_url, or an op that drives the UI. HTTP ops run without a browser and show only in the timeline.
      </div>
      <div class="flash mono" id="flash"></div>
    </div>
  </section>
  <section aria-label="Operations">
    <div class="bar">
      <h2>Operations</h2>
      <div class="stats"><span><b id="calls">0</b> calls</span><span><b id="errors">0</b> errors</span></div>
      <label class="follow"><input type="checkbox" id="follow" checked> Follow</label>
    </div>
    <ol id="log"><li class="none" id="none">Waiting for the agent's first call.</li></ol>
  </section>
</main>
<script>
(function () {
  var log = document.getElementById("log");
  var none = document.getElementById("none");
  var stage = document.getElementById("stage");
  var frame = document.getElementById("frame");
  var urlEl = document.getElementById("url");
  var flash = document.getElementById("flash");
  var follow = document.getElementById("follow");
  var dot = document.getElementById("dot");
  var conn = document.getElementById("conn");
  var callsEl = document.getElementById("calls");
  var errorsEl = document.getElementById("errors");
  var rows = {};
  var calls = 0;
  var errors = 0;
  var activeSid = null;
  var flashTimer = null;

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clock(iso) {
    var d = new Date(iso);
    return d.toLocaleTimeString([], { hour12: false });
  }

  function oneLine(args) {
    if (args === null || args === undefined) return "";
    if (typeof args !== "object") return String(args);
    var parts = [];
    Object.keys(args).forEach(function (key) {
      var value = args[key];
      var shown = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value);
      if (shown && shown.length > 60) shown = shown.slice(0, 57) + "...";
      parts.push(key + "=" + shown);
    });
    return parts.join("  ");
  }

  function headline(tool, args) {
    if (tool === "call" && args && args.op) return "call · " + args.op;
    if (tool === "act" && args) return "act · " + (args.do || "") + " " + (args.ref || "");
    return tool;
  }

  function atBottom() {
    return log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  }

  function append(node) {
    var stick = follow.checked || atBottom();
    if (none.parentNode) none.remove();
    log.appendChild(node);
    if (stick && follow.checked) log.scrollTop = log.scrollHeight;
  }

  function pretty(value) {
    if (typeof value === "string") {
      try { return JSON.stringify(JSON.parse(value), null, 2); } catch (e) { return value; }
    }
    return JSON.stringify(value, null, 2);
  }

  function showFlash(text) {
    flash.textContent = text;
    flash.classList.add("show");
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flash.classList.remove("show"); }, 2600);
  }

  function onCall(event) {
    calls += 1;
    callsEl.textContent = String(calls);
    var li = el("li");
    var button = el("button");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    var what = el("span", "what");
    what.appendChild(el("span", "tool mono", headline(event.tool, event.args)));
    what.appendChild(el("span", "args mono", oneLine(event.tool === "call" && event.args ? event.args.params : event.args)));
    var badge = el("span", "badge run", "running");
    button.appendChild(el("span", "time mono", clock(event.at)));
    button.appendChild(what);
    button.appendChild(badge);
    var detail = el("div", "detail");
    detail.appendChild(el("h3", null, "Arguments"));
    detail.appendChild(el("pre", "mono", pretty(event.args || {})));
    var resultHead = el("h3", null, "Response");
    var resultBody = el("pre", "mono", "waiting...");
    detail.appendChild(resultHead);
    detail.appendChild(resultBody);
    button.addEventListener("click", function () {
      var open = li.classList.toggle("open");
      button.setAttribute("aria-expanded", open ? "true" : "false");
    });
    li.appendChild(button);
    li.appendChild(detail);
    rows[event.id] = { badge: badge, body: resultBody };
    append(li);
    if (activeSid) showFlash(headline(event.tool, event.args));
  }

  function onResult(event) {
    var row = rows[event.id];
    if (!row) return;
    if (event.ok) {
      row.badge.className = "badge ok";
      row.badge.textContent = event.ms + " ms";
    } else {
      errors += 1;
      errorsEl.textContent = String(errors);
      row.badge.className = "badge err";
      row.badge.textContent = event.code || "error";
    }
    row.body.textContent = event.summary ? pretty(event.summary) : "(empty)";
  }

  function onPage(event) {
    if (event.status === "closed") {
      if (event.sid === activeSid) {
        activeSid = null;
        stage.classList.remove("has-frame");
        urlEl.textContent = "browser closed";
      }
      append(el("li", "page", clock(event.at) + "  browser closed"));
      return;
    }
    activeSid = event.sid;
    if (event.url) urlEl.textContent = event.url;
    if (event.status === "open") append(el("li", "page", clock(event.at) + "  browser opened"));
    else if (event.url) append(el("li", "page mono", clock(event.at) + "  → " + event.url));
  }

  function onFrame(event) {
    activeSid = event.sid;
    frame.src = "data:image/jpeg;base64," + event.data;
    stage.classList.add("has-frame");
  }

  function connect() {
    var source = new EventSource("/events");
    source.onopen = function () {
      dot.className = "dot live";
      conn.textContent = "live";
    };
    source.onerror = function () {
      dot.className = "dot down";
      conn.textContent = "reconnecting";
    };
    source.onmessage = function (message) {
      var event;
      try { event = JSON.parse(message.data); } catch (e) { return; }
      if (event.kind === "call") onCall(event);
      else if (event.kind === "result") onResult(event);
      else if (event.kind === "page") onPage(event);
      else if (event.kind === "frame") onFrame(event);
    };
    // A reconnect replays history, so start the timeline over.
    source.addEventListener("open", function () {
      if (calls === 0) return;
      log.textContent = "";
      log.appendChild(none);
      rows = {};
      calls = 0;
      errors = 0;
      callsEl.textContent = "0";
      errorsEl.textContent = "0";
    });
  }

  connect();
})();
</script>
</body>
</html>
`;

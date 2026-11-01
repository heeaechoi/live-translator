import { Segmenter } from "./segmenter.js";

const $ = (id) => document.getElementById(id);
const els = {
  start: $("startBtn"), clear: $("clearBtn"), settingsBtn: $("settingsBtn"), settings: $("settings"),
  transcript: $("transcript"), empty: $("emptyState"), pending: $("pending"),
  dot: $("statusDot"), status: $("statusText"), toast: $("toast"),
  fontSize: $("fontSize"), showEnglish: $("showEnglish"), autoScroll: $("autoScroll"),
  silenceMs: $("silenceMs"), silenceVal: $("silenceVal"),
  notes: $("notes"), password: $("password"), pwRow: $("pwRow"), modelInfo: $("modelInfo"), exportBtn: $("exportBtn"),
};

// ---------- settings (per-device, stored in this browser only) ----------
const DEFAULTS = { fontSize: 32, showEnglish: true, autoScroll: true, silenceMs: 900, notes: "", password: "" };
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("lt-settings") || "{}") }; }
  catch { return { ...DEFAULTS }; }
}
const settings = loadSettings();
function saveSettings() {
  try { localStorage.setItem("lt-settings", JSON.stringify(settings)); } catch {}
}
function applySettings() {
  document.documentElement.style.setProperty("--ko-size", `${settings.fontSize}px`);
  document.body.classList.toggle("hide-en", !settings.showEnglish);
  els.silenceVal.textContent = `${(settings.silenceMs / 1000).toFixed(1)}초`;
  if (segmenter) segmenter.silenceMs = settings.silenceMs;
}
function bindSetting(el, key, prop = "value", cast = (v) => v) {
  el[prop] = settings[key];
  el.addEventListener("input", () => { settings[key] = cast(el[prop]); saveSettings(); applySettings(); });
}

// ---------- UI helpers ----------
function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.dot.className = `dot ${kind}`;
}
let toastTimer;
function toast(msg, ms = 4000) {
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), ms);
}
function nearBottom() {
  const t = els.transcript;
  return t.scrollHeight - t.scrollTop - t.clientHeight < 120;
}
function scrollToEnd(force = false) {
  if (settings.autoScroll && (force || nearBottom())) els.transcript.scrollTop = els.transcript.scrollHeight;
}

// ---------- translation ----------
const segments = []; // { id, en, ko, status, el }
let nextId = 0;
const MAX_CONCURRENT = 3;
let inFlight = 0;
const queue = [];

function addSegment(en) {
  els.empty?.remove();
  const seg = { id: nextId++, en, ko: "", status: "queued" };
  const el = document.createElement("div");
  el.className = "seg";
  el.innerHTML = `<div class="ko loading"></div><div class="en"></div>`;
  el.querySelector(".en").textContent = en;
  seg.el = el;
  seg.koEl = el.querySelector(".ko");
  const stick = nearBottom();
  els.transcript.appendChild(el);
  segments.push(seg);
  scrollToEnd(stick);
  queue.push(seg);
  pump();
}

function pump() {
  while (inFlight < MAX_CONCURRENT && queue.length) {
    const seg = queue.shift();
    inFlight++;
    translateSegment(seg).finally(() => { inFlight--; pump(); });
  }
}

function contextFor(seg) {
  const idx = segments.indexOf(seg);
  return segments.slice(Math.max(0, idx - 6), idx).map((s) => ({ en: s.en, ko: s.status === "done" ? s.ko : "" }));
}

async function translateSegment(seg, attempt = 0) {
  seg.status = "translating";
  seg.ko = "";
  const headers = { "Content-Type": "application/json" };
  if (settings.password) headers["X-App-Password"] = settings.password;
  try {
    const res = await fetch("api/translate", {
      method: "POST",
      headers,
      body: JSON.stringify({ text: seg.en, context: contextFor(seg), notes: settings.notes }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err.error || `HTTP ${res.status}`), { fatal: res.status === 401 || res.status === 400 });
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buf.indexOf("\n\n")) >= 0) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = /^event: (.*)$/m.exec(raw)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(raw)?.[1] || "{}");
        if (ev === "delta") {
          const stick = nearBottom();
          seg.ko += data.text;
          seg.koEl.textContent = seg.ko;
          scrollToEnd(stick);
        } else if (ev === "done") {
          seg.ko = data.text;
          seg.status = "done";
        } else if (ev === "error") {
          throw Object.assign(new Error(data.error), { fatal: true });
        }
      }
    }
    if (seg.status !== "done") throw new Error("연결이 끊겼어요");
    seg.koEl.classList.remove("loading");
    seg.koEl.textContent = seg.ko;
    if (!seg.ko) seg.el.remove(); // filler-only chunk: nothing to show
  } catch (err) {
    if (!err.fatal && attempt < 2) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      return translateSegment(seg, attempt + 1);
    }
    seg.status = "error";
    seg.koEl.classList.remove("loading");
    seg.koEl.classList.add("error");
    seg.koEl.textContent = `⚠︎ ${err.message} (탭하면 다시 시도)`;
    seg.koEl.onclick = () => {
      seg.koEl.onclick = null;
      seg.koEl.className = "ko loading";
      seg.koEl.textContent = "";
      queue.push(seg);
      pump();
    };
    if (/비밀번호/.test(err.message)) { els.pwRow.hidden = false; toast("설정에서 접속 비밀번호를 입력하세요."); }
  }
}

// ---------- speech recognition ----------
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let running = false;
let restartTimer = null;
let wakeLock = null;

const segmenter = new Segmenter({
  onCommit: (text) => addSegment(text),
  onPending: (text) => (els.pending.textContent = text),
  silenceMs: settings.silenceMs,
});

function createRecognition() {
  const r = new SpeechRecognition();
  r.lang = "en-US";
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  r.onstart = () => setStatus("듣는 중…", "on");
  r.onresult = (event) => {
    const results = [];
    for (let i = 0; i < event.results.length; i++) {
      results.push({ text: event.results[i][0].transcript, isFinal: event.results[i].isFinal });
    }
    segmenter.update(results);
  };
  r.onerror = (event) => {
    switch (event.error) {
      case "no-speech":
      case "aborted":
        return; // onend restarts
      case "not-allowed":
        stop();
        setStatus("마이크 권한이 필요해요", "err");
        toast("설정 > Safari > 마이크 를 '허용'으로 바꾼 뒤 다시 시도하세요.", 8000);
        return;
      case "service-not-allowed":
        stop();
        setStatus("음성 인식을 쓸 수 없어요", "err");
        toast("설정 > 일반 > 키보드 > '받아쓰기 활성화'를 켜고, HTTPS 주소로 접속했는지 확인하세요.", 9000);
        return;
      case "audio-capture":
        stop();
        setStatus("마이크를 찾을 수 없어요", "err");
        return;
      case "network":
        setStatus("음성 인식 네트워크 오류 – 재시도 중", "warn");
        return;
      default:
        setStatus(`음성 인식 오류: ${event.error}`, "warn");
    }
  };
  r.onend = () => {
    // Commit what we have; the next session starts with a fresh result list.
    segmenter.flush();
    segmenter.reset();
    if (running) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        if (!running) return;
        try { r.start(); } catch { /* already started */ }
      }, 150);
    }
  };
  return r;
}

async function start() {
  if (!SpeechRecognition) {
    toast("이 브라우저는 음성 인식을 지원하지 않아요. 아이패드 Safari(또는 Chrome)에서 열어주세요.", 8000);
    return;
  }
  if (!window.isSecureContext) {
    toast("마이크를 쓰려면 https:// 주소로 접속해야 해요. README의 'HTTPS' 안내를 참고하세요.", 9000);
    return;
  }
  running = true;
  recognition = recognition || createRecognition();
  try { recognition.start(); } catch {}
  els.start.textContent = "■ 정지";
  els.start.classList.add("stop");
  setStatus("시작하는 중…", "warn");
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
}

function stop() {
  running = false;
  clearTimeout(restartTimer);
  try { recognition?.stop(); } catch {}
  segmenter.flush();
  els.start.textContent = "▶︎ 시작";
  els.start.classList.remove("stop");
  setStatus("정지됨");
  wakeLock?.release?.().catch(() => {});
  wakeLock = null;
}

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && running) {
    try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
    try { recognition.start(); } catch {}
  } else if (document.visibilityState === "hidden" && running) {
    setStatus("화면이 가려지면 인식이 멈춰요 (Split View 권장)", "warn");
  }
});

// ---------- wire up ----------
els.start.addEventListener("click", () => (running ? stop() : start()));
els.clear.addEventListener("click", () => {
  if (segments.length && !confirm("번역 기록을 모두 지울까요?")) return;
  segments.length = 0;
  queue.length = 0;
  els.transcript.innerHTML = "";
});
els.settingsBtn.addEventListener("click", () => els.settings.showModal());
els.exportBtn.addEventListener("click", () => {
  const text = segments.map((s) => `${s.ko}\n${s.en}\n`).join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `translation-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

bindSetting(els.fontSize, "fontSize", "value", Number);
bindSetting(els.showEnglish, "showEnglish", "checked");
bindSetting(els.autoScroll, "autoScroll", "checked");
bindSetting(els.silenceMs, "silenceMs", "value", Number);
bindSetting(els.notes, "notes");
bindSetting(els.password, "password");
applySettings();

fetch("api/config")
  .then((r) => r.json())
  .then((cfg) => {
    els.modelInfo.textContent = `번역 엔진: ${cfg.model}`;
    if (cfg.passwordRequired) els.pwRow.hidden = false;
  })
  .catch(() => setStatus("서버에 연결할 수 없어요", "err"));

if (!SpeechRecognition) setStatus("이 브라우저는 음성 인식 미지원", "err");

/*
 * Tax Advisory Game — generic advisory-scenario engine.
 *
 * Principle (see CLAUDE.md): content is data, the engine is generic.
 * This file contains NO scenarios and NO answer logic. Every verdict, point
 * value, and piece of feedback is read straight from the content pack JSON.
 * The engine only renders what the pack says and tallies author-set points.
 *
 * Presentation note: if a scenario includes an optional `client` block
 * ({ name, role, quote }), the engine renders a "video call" panel and reads
 * the client's words aloud using the browser's built-in speech synthesis.
 * This is purely presentational — it never affects scoring.
 */

const PACK_URL = "content/entity-selection.json";
const app = document.getElementById("app");

// In-memory session state only (no persistence in v1).
const state = {
  pack: null,
  index: 0, // which scenario we're on
  totalPoints: 0, // running score, summed from author-set points
  results: [], // { title, verdict, points } per answered scenario
  muted: false, // narration mute toggle, persists across scenarios
  timings: null, // optional pre-generated audio + word timings, keyed by scenario id
};

const canSpeak = "speechSynthesis" in window;

// ---------- small DOM helpers ----------
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(props)) {
    if (key === "class") node.className = val;
    else if (key === "text") node.textContent = val;
    else if (key === "html") node.innerHTML = val;
    else if (key.startsWith("data-")) node.setAttribute(key, val);
    else if (key === "disabled") node.disabled = val;
    else node.setAttribute(key, val);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function clear() {
  stopSpeaking();
  app.replaceChildren();
}

// ---------- boot ----------
async function start() {
  try {
    const res = await fetch(PACK_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Could not load content pack (HTTP ${res.status}).`);
    state.pack = await res.json();
    if (!state.pack.scenarios || !state.pack.scenarios.length) {
      throw new Error("Content pack has no scenarios.");
    }
    // Optional pre-generated voiceover + word timings. If absent, the engine
    // falls back to the browser's built-in speech synthesis.
    try {
      const tRes = await fetch("content/audio/timings.json", { cache: "no-cache" });
      if (tRes.ok) state.timings = await tRes.json();
    } catch (e) {
      /* no audio pack available — TTS fallback will be used */
    }
    renderIntro();
  } catch (err) {
    renderError(err.message);
  }
}

function renderError(message) {
  clear();
  app.appendChild(
    el("div", { class: "card" }, [
      el("div", { class: "error" }, [
        el("strong", { text: "Something went wrong loading the game." }),
        el("p", { text: message, style: "margin:8px 0 0;" }),
        el("p", {
          text: "If you opened the file directly, it needs to be served by a local web server. See the run instructions.",
          style: "margin:8px 0 0; font-size:14px;",
        }),
      ]),
    ])
  );
}

// ---------- progress header ----------
function topbar() {
  const total = state.pack.scenarios.length;
  const current = Math.min(state.index + 1, total);
  const bar = el("div", { class: "topbar" }, [
    el("span", { class: "pack-title", text: state.pack.title }),
    el("span", { text: `Scenario ${current} of ${total}` }),
  ]);
  const track = el("div", { class: "progress-track" }, [
    el("div", {
      class: "progress-fill",
      style: `width:${(state.index / total) * 100}%`,
    }),
  ]);
  return [bar, track];
}

// ---------- intro / start screen ----------
// A start screen exists for a practical reason: browsers block audio until the
// user interacts with the page. The click to begin satisfies that, so the very
// first client can speak right away.
function renderIntro() {
  clear();
  const total = state.pack.scenarios.length;
  const begin = el("button", { class: "btn btn-primary", text: "Start the first call →" });
  begin.addEventListener("click", () => {
    state.index = 0;
    state.totalPoints = 0;
    state.results = [];
    renderScenario();
  });

  app.appendChild(
    el("div", { class: "card summary intro" }, [
      el("h1", { text: state.pack.title }),
      el("p", { class: "intro-lead", text:
        `You'll advise ${total} clients. Each one tells you their situation — listen, then choose the entity you'd recommend. After every choice you'll see exactly why it scores the way it does.` }),
      canSpeak
        ? el("p", { class: "intro-tip", text: "🔊 Turn your sound on — your clients will speak to you." })
        : null,
      el("div", { class: "actions", style: "justify-content:center;margin-top:8px;" }, [begin]),
    ])
  );
}

// ---------- a scenario ----------
function renderScenario() {
  const scenario = state.pack.scenarios[state.index];
  clear();
  topbar().forEach((n) => app.appendChild(n));

  const card = el("div", { class: "card" }, [
    el("span", {
      class: "level",
      "data-level": scenario.level,
      text: scenario.level,
    }),
    el("h1", { class: "scenario-title", text: scenario.title }),
  ]);

  // Presentational: a "video call" panel if the scenario provides a client;
  // otherwise the engine falls back to a plain text brief.
  if (scenario.client) {
    card.appendChild(buildCallPanel(scenario));
  } else {
    card.appendChild(el("p", { class: "client-brief", text: scenario.client_brief }));
  }

  const options = el("div", { class: "options" });
  scenario.options.forEach((opt) => {
    const btn = el("button", {
      class: "option",
      "data-option": opt.id,
      text: opt.label,
    });
    btn.addEventListener("click", () => choose(scenario, opt.id, options));
    options.appendChild(btn);
  });

  card.appendChild(el("p", { class: "prompt-q", text: "Which entity do you advise?" }));
  card.appendChild(options);
  app.appendChild(card);

  // Greet the learner with the client's voice. Browsers may block the very
  // first auto-play before any user gesture; the Start screen handles that,
  // and the Play button always works.
  if (scenario.client) playClient(scenario);
}

// ---------- the "video call" panel ----------
function buildCallPanel(scenario) {
  const c = scenario.client;
  const spoken = c.quote || scenario.client_brief;

  // Animated audio bars shown while the client is "speaking".
  const wave = el("div", { class: "wave", "aria-hidden": "true" });
  for (let i = 0; i < 5; i++) wave.appendChild(el("span"));

  const video = el("div", { class: "call-video" }, [
    el("div", { class: "call-rings", "aria-hidden": "true" }, [
      el("span"), el("span"),
    ]),
    el("div", { class: "call-avatar", html: avatarSVG(c.name) }),
    wave,
    el("div", { class: "call-live" }, [
      el("span", { class: "call-dot" }),
      el("span", { text: "LIVE" }),
    ]),
    el("div", { class: "call-nametag" }, [
      el("span", { class: "call-name", text: c.name }),
      c.role ? el("span", { class: "call-role", text: c.role }) : null,
    ]),
  ]);

  // Spoken words as captions (also the accessible transcript). Each word is
  // its own span with character offsets so it can light up as it's spoken,
  // kept in sync with the speech via the utterance's word-boundary events.
  const caption = el("p", { class: "call-caption" });
  caption.appendChild(document.createTextNode("“"));
  const tokens = spoken.match(/\S+\s*/g) || [spoken];
  let offset = 0;
  tokens.forEach((tok) => {
    const word = tok.trimEnd();
    const span = el("span", { class: "w", text: tok });
    span.dataset.start = String(offset);
    span.dataset.end = String(offset + word.length);
    caption.appendChild(span);
    offset += tok.length;
  });
  caption.appendChild(document.createTextNode("”"));

  // Controls: play / replay narration and a mute toggle.
  const controls = el("div", { class: "call-controls" });
  if (canSpeak) {
    const playBtn = el("button", {
      class: "call-btn",
      "data-role": "play",
      html: speakerIcon() + "<span>Hear the client</span>",
    });
    playBtn.addEventListener("click", () => {
      if (isNarrating()) {
        stopSpeaking();
        setPlayState(false);
      } else {
        playClient(scenario);
      }
    });

    const muteBtn = el("button", {
      class: "call-btn call-btn-ghost",
      "data-role": "mute",
      text: state.muted ? "Unmute" : "Mute",
    });
    muteBtn.addEventListener("click", () => {
      state.muted = !state.muted;
      muteBtn.textContent = state.muted ? "Unmute" : "Mute";
      if (state.muted) stopSpeaking();
    });

    controls.appendChild(playBtn);
    controls.appendChild(muteBtn);
  } else {
    controls.appendChild(
      el("span", { class: "call-hint", text: "Read the client's request below." })
    );
  }

  return el("div", { class: "call" }, [video, caption, controls]);
}

// ---------- narration (pre-generated audio, or browser TTS fallback) ----------
let currentUtterance = null;
let currentAudio = null;
let rafId = null;

// Entry point: play the client's voice. Prefers pre-generated audio with exact
// word timings; falls back to the browser's speech synthesis if none exists.
function playClient(scenario) {
  if (state.muted) return;
  const info = state.timings && state.timings[scenario.id];
  if (info) playAudio(scenario, info);
  else speakTTS(scenario);
}

function narrationDom() {
  const panel = app.querySelector(".call-video");
  const caption = app.querySelector(".call-caption");
  const spans = caption ? [...caption.querySelectorAll(".w")] : [];
  return { panel, caption, spans };
}

function highlightUpTo(spans, curr) {
  spans.forEach((s, i) => {
    s.classList.toggle("said", i < curr);
    s.classList.toggle("now", i === curr);
  });
}

// --- pre-generated audio path: exact sync from word start times ---
function playAudio(scenario, info) {
  stopSpeaking();
  const { panel, caption, spans } = narrationDom();
  spans.forEach((s) => s.classList.remove("said", "now"));
  const starts = info.words || [];

  const audio = new Audio("content/audio/" + info.file);
  currentAudio = audio;

  const loop = () => {
    if (!currentAudio) return;
    const t = currentAudio.currentTime;
    let curr = -1;
    for (let i = 0; i < starts.length; i++) {
      if (starts[i] <= t) curr = i;
      else break;
    }
    highlightUpTo(spans, curr);
    if (!currentAudio.paused && !currentAudio.ended) rafId = requestAnimationFrame(loop);
  };

  audio.onplay = () => {
    if (panel) panel.classList.add("speaking");
    if (caption) caption.classList.add("syncing");
    setPlayState(true);
    rafId = requestAnimationFrame(loop);
  };
  audio.onended = () => {
    clearNarrationVisual();
    setPlayState(false);
    currentAudio = null;
  };
  audio.onerror = () => {
    // Audio file unavailable — fall back to the browser voice.
    currentAudio = null;
    speakTTS(scenario);
  };

  audio.play().catch(() => {
    /* autoplay blocked before a gesture; the Play button still works */
  });
}

// --- browser speech-synthesis fallback path ---
function speakTTS(scenario) {
  if (!canSpeak) return;
  const c = scenario.client;
  const text = c.quote || scenario.client_brief;
  stopSpeaking();

  const u = new SpeechSynthesisUtterance(text);
  const seed = hashString(c.name);
  u.rate = 0.96;
  u.pitch = 0.92 + (seed % 30) / 100; // a little per-client variety
  const voice = pickVoice();
  if (voice) u.voice = voice;

  const { panel, caption, spans } = narrationDom();
  spans.forEach((s) => s.classList.remove("said", "now"));
  let boundaryFired = false;

  u.onstart = () => {
    if (panel) panel.classList.add("speaking");
    if (caption) caption.classList.add("syncing");
    setPlayState(true);
    // If the voice doesn't emit word boundaries, drop the dimming so the
    // caption stays fully readable.
    setTimeout(() => {
      if (!boundaryFired && caption) caption.classList.remove("syncing");
    }, 900);
  };
  u.onboundary = (e) => {
    if (e.name && e.name !== "word") return;
    boundaryFired = true;
    const ci = e.charIndex || 0;
    let curr = -1;
    for (let i = 0; i < spans.length; i++) {
      if (Number(spans[i].dataset.start) <= ci) curr = i;
      else break;
    }
    highlightUpTo(spans, curr);
  };
  u.onend = u.onerror = () => {
    clearNarrationVisual();
    setPlayState(false);
    currentUtterance = null;
  };

  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

function isNarrating() {
  return (
    (canSpeak && window.speechSynthesis.speaking) ||
    (currentAudio && !currentAudio.paused)
  );
}

function setPlayState(speaking) {
  const btn = app.querySelector('.call-btn[data-role="play"] span');
  if (btn) btn.textContent = speaking ? "Stop" : "Replay";
}

function clearNarrationVisual() {
  const panel = app.querySelector(".call-video.speaking");
  if (panel) panel.classList.remove("speaking");
  const caption = app.querySelector(".call-caption");
  if (caption) {
    caption.classList.remove("syncing");
    caption.querySelectorAll(".w.now").forEach((s) => s.classList.remove("now"));
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  clearNarrationVisual();
}

// Prefer a natural-sounding local English voice when one is available.
function pickVoice() {
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  return (
    voices.find((v) => /en[-_]US/i.test(v.lang) && /natural|neural|google|samantha|aria|jenny/i.test(v.name)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0]
  );
}
// Voices load asynchronously in some browsers.
if (canSpeak && typeof window.speechSynthesis.onvoiceschanged !== "undefined") {
  window.speechSynthesis.onvoiceschanged = () => {};
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

// ---------- generated avatar (no image files needed) ----------
function avatarSVG(name) {
  const h = hashString(name);
  const hue = h % 360;
  const hue2 = (hue + 40) % 360;
  return `
  <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Portrait of ${name}">
    <defs>
      <linearGradient id="avg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},62%,52%)"/>
        <stop offset="1" stop-color="hsl(${hue2},58%,38%)"/>
      </linearGradient>
    </defs>
    <rect width="200" height="200" fill="url(#avg)"/>
    <circle cx="100" cy="78" r="34" fill="rgba(255,255,255,0.92)"/>
    <path d="M44 184c0-31 25-52 56-52s56 21 56 52z" fill="rgba(255,255,255,0.92)"/>
  </svg>`;
}

function speakerIcon() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 5V4L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 2.5v2.06A7 7 0 0 1 14 19.4v2.06A9 9 0 0 0 14 2.5z"/></svg>`;
}

// ---------- learner picks an option ----------
function choose(scenario, chosenId, optionsEl) {
  // Pull the author-set scoring straight from the pack. The engine does not
  // decide anything — it looks up what the author wrote.
  const score = scenario.scoring[chosenId];
  if (!score) return; // option without scoring — ignore defensively

  stopSpeaking();
  state.totalPoints += score.points;
  state.results.push({
    title: scenario.title,
    verdict: score.verdict,
    points: score.points,
  });

  // Lock and annotate every option button with its author-set verdict.
  [...optionsEl.querySelectorAll(".option")].forEach((btn) => {
    const id = btn.getAttribute("data-option");
    const v = scenario.scoring[id];
    btn.disabled = true;
    if (v) {
      btn.classList.add(`verdict-${v.verdict}`);
      btn.appendChild(el("span", { class: `badge verdict-${v.verdict}`, text: v.verdict }));
    }
    if (id === chosenId) btn.classList.add("is-chosen");
    else btn.classList.add("dimmed");
  });

  // Reveal verdict, points, feedback, and the factors that justify the scoring.
  const card = optionsEl.closest(".card");
  card.appendChild(buildReveal(scenario, chosenId, score));
}

function buildReveal(scenario, chosenId, score) {
  const reveal = el("div", { class: "reveal" });

  reveal.appendChild(
    el("div", { class: "verdict-line" }, [
      el("span", { class: `verdict-word verdict-${score.verdict}`, text: score.verdict }),
      el("span", { class: "points-line", text: `+${score.points} points` }),
    ])
  );

  // Author-written feedback for the chosen option.
  reveal.appendChild(el("p", { class: "feedback", text: scenario.feedback[chosenId] }));

  // The factors: the reasoning that drove the scoring (label + note).
  reveal.appendChild(el("p", { class: "factors-title", text: "Why — the factors that matter" }));
  scenario.factors.forEach((f) => {
    const favorsLabel = labelForOption(scenario, f.favors);
    reveal.appendChild(
      el("div", { class: "factor" }, [
        el("div", { class: "factor-head" }, [
          el("span", { class: "factor-label", text: f.label }),
          el("span", { class: "factor-weight", text: `weight ${f.weight}` }),
          el("span", { class: "factor-favors", text: `favors: ${favorsLabel}` }),
        ]),
        el("p", { class: "factor-note", text: f.note }),
      ])
    );
  });

  // Advance control.
  const isLast = state.index === state.pack.scenarios.length - 1;
  const next = el("button", {
    class: "btn btn-primary",
    text: isLast ? "See your results" : "Next scenario →",
  });
  next.addEventListener("click", () => {
    state.index += 1;
    if (state.index >= state.pack.scenarios.length) renderSummary();
    else renderScenario();
  });
  reveal.appendChild(el("div", { class: "actions" }, [next]));

  return reveal;
}

// Resolve a `favors` id to a human label using the scenario's own options.
function labelForOption(scenario, favorsId) {
  if (favorsId === "none") return "no single option (a caveat)";
  const opt = scenario.options.find((o) => o.id === favorsId);
  return opt ? opt.label : favorsId;
}

// ---------- end summary ----------
function renderSummary() {
  clear();
  const count = state.results.length;
  const maxPossible = state.pack.scenarios.reduce((sum, s) => {
    const best = Math.max(...Object.values(s.scoring).map((x) => x.points));
    return sum + best;
  }, 0);

  const breakdown = el("div", { class: "breakdown" });
  state.results.forEach((r) => {
    breakdown.appendChild(
      el("div", { class: "breakdown-row" }, [
        el("span", { class: "name", text: r.title }),
        el("span", { class: `verdict-word verdict-${r.verdict}`, text: `${r.verdict} · +${r.points}` }),
      ])
    );
  });

  const restart = el("button", { class: "btn btn-primary", text: "Play again" });
  restart.addEventListener("click", () => {
    state.index = 0;
    state.totalPoints = 0;
    state.results = [];
    renderScenario();
  });

  app.appendChild(
    el("div", { class: "card summary" }, [
      el("h1", { text: "Session complete" }),
      el("div", { class: "score-big", text: String(state.totalPoints) }),
      el("p", {
        class: "score-sub",
        text: `out of ${maxPossible} possible · ${count} scenario${count === 1 ? "" : "s"} completed`,
      }),
      breakdown,
      el("div", { class: "actions", style: "justify-content:center;margin-top:26px;" }, [restart]),
    ])
  );
}

// ---------- PWA service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {
      /* offline support is a nicety; ignore registration failures */
    });
  });
}

// Stop narration if the user leaves/closes the tab.
window.addEventListener("beforeunload", stopSpeaking);

start();

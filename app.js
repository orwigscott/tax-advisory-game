/*
 * Tax Advisory Game — generic advisory-scenario engine.
 *
 * Principle (see CLAUDE.md): content is data, the engine is generic.
 * This file contains NO scenarios and NO answer logic. Every verdict, point
 * value, and piece of feedback is read straight from the content pack JSON.
 * The engine only renders what the pack says and tallies author-set points.
 */

const PACK_URL = "content/entity-selection.json";
const app = document.getElementById("app");

// In-memory session state only (no persistence in v1).
const state = {
  pack: null,
  index: 0, // which scenario we're on
  totalPoints: 0, // running score, summed from author-set points
  results: [], // { title, verdict, points } per answered scenario
};

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
    renderScenario();
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
      style: `width:${((state.index) / total) * 100}%`,
    }),
  ]);
  return [bar, track];
}

// ---------- a scenario ----------
function renderScenario() {
  const scenario = state.pack.scenarios[state.index];
  clear();
  topbar().forEach((n) => app.appendChild(n));

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

  const card = el("div", { class: "card" }, [
    el("span", {
      class: "level",
      "data-level": scenario.level,
      text: scenario.level,
    }),
    el("h1", { class: "scenario-title", text: scenario.title }),
    el("p", { class: "client-brief", text: scenario.client_brief }),
    el("p", { class: "prompt-q", text: "Which entity do you advise?" }),
    options,
  ]);

  app.appendChild(card);
}

// ---------- learner picks an option ----------
function choose(scenario, chosenId, optionsEl) {
  // Pull the author-set scoring straight from the pack. The engine does not
  // decide anything — it looks up what the author wrote.
  const score = scenario.scoring[chosenId];
  if (!score) return; // option without scoring — ignore defensively

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

start();

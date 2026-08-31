let svgRoot = null;
let state = { scores: {}, total: 0 };
let lastTapAt = 0;

function rankList() {
  return Object.keys(COUNTY_NAMES)
    .map((id) => ({ id, name: COUNTY_NAMES[id], score: state.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ro"));
}

function colorFor(score, max) {
  if (!max) return "#1d2b45";
  const t = Math.min(1, score / max);
  const r = Math.round(29 + t * 200);
  const g = Math.round(43 + t * 80);
  const b = Math.round(69 + t * 10);
  return `rgb(${r},${g},${b})`;
}

function paintMap() {
  if (!svgRoot) return;
  const scores = Object.values(state.scores);
  const max = scores.length ? Math.max(...scores) : 0;
  svgRoot.querySelectorAll("path[id]").forEach((path) => {
    path.style.fill = colorFor(state.scores[path.id] || 0, max);
  });
}

function renderSidebar() {
  const ranked = rankList();
  document.getElementById("totalTaps").textContent = state.total.toLocaleString("ro-RO");
  document.getElementById("liveCounties").textContent = ranked.filter((x) => x.score > 0).length;
  document.getElementById("list").innerHTML = ranked
    .map((item, i) => {
      const cls = i === 0 ? "g1" : i === 1 ? "g2" : i === 2 ? "g3" : "";
      return `<div class="row" data-id="${item.id}">
        <div class="rank ${cls}">${i + 1}</div>
        <div class="county">${item.name}<small>${item.id.replace("RO-", "")}</small></div>
        <div class="score">${item.score.toLocaleString("ro-RO")}</div>
      </div>`;
    })
    .join("");
}

function applyState(next) {
  state = next;
  paintMap();
  renderSidebar();
}

async function tapCounty(id) {
  const now = Date.now();
  if (now - lastTapAt < 800) return;
  lastTapAt = now;
  try {
    const res = await fetch("/api/tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ county: id }),
    });
    const data = await res.json();
    if (!res.ok) return;
    applyState(data);
  } catch (_) {}
}

async function loadMap() {
  const svgText = await fetch("/romania.svg").then((r) => r.text());
  const holder = document.getElementById("map");
  holder.innerHTML = svgText;
  svgRoot = holder.querySelector("svg");
  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgRoot.removeAttribute("width");
  svgRoot.removeAttribute("height");
  svgRoot.querySelectorAll("path[id]").forEach((path) => {
    path.addEventListener("click", (e) => {
      e.preventDefault();
      tapCounty(path.id);
    });
  });
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onmessage = (ev) => {
    try { applyState(JSON.parse(ev.data)); } catch (_) {}
  };
  es.onerror = () => {
    setTimeout(connectStream, 2500);
    es.close();
  };
}

async function boot() {
  await loadMap();
  const initial = await fetch("/api/state").then((r) => r.json());
  applyState(initial);
  connectStream();
}

boot();

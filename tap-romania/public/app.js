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

function countyPaths() {
  if (!svgRoot) return [];
  return [...svgRoot.querySelectorAll("path[id]")].filter((path) => COUNTY_NAMES[path.id]);
}

function paintMap() {
  if (!svgRoot) return;
  const scores = Object.values(state.scores);
  const max = scores.length ? Math.max(...scores) : 0;

  countyPaths().forEach((path) => {
    path.style.fill = colorFor(state.scores[path.id] || 0, max);
  });
}

function renderSidebar() {
  const ranked = rankList();
  document.getElementById("totalTaps").textContent = state.total.toLocaleString("ro-RO");
  document.getElementById("liveCounties").textContent = ranked.filter((x) => x.score > 0).length;

  const list = document.getElementById("list");
  list.innerHTML = ranked
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
  if (!COUNTY_NAMES[id]) return;

  const now = Date.now();
  if (now - lastTapAt < 180) return;
  lastTapAt = now;

  try {
    const res = await fetch("/api/tap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ county: id }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Tap respins:", data);
      return;
    }

    applyState(data);
  } catch (err) {
    console.error("Eroare la tap:", err);
  }
}

function addCountyLabels() {
  if (!svgRoot) return;

  svgRoot.querySelector(".county-labels")?.remove();

  const NS = "http://www.w3.org/2000/svg";
  const group = document.createElementNS(NS, "g");
  group.setAttribute("class", "county-labels");
  group.setAttribute("aria-hidden", "true");

  countyPaths().forEach((path) => {
    const box = path.getBBox();
    const code = path.id.replace("RO-", "");
    const text = document.createElementNS(NS, "text");

    let x = box.x + box.width / 2;
    let y = box.y + box.height / 2;

    // Micile ajustări de mai jos separă etichetele din zona București/Ilfov.
    if (path.id === "RO-B") {
      x += 4;
      y += 4;
    }
    if (path.id === "RO-IF") {
      x -= 6;
      y -= 4;
    }

    const minSide = Math.min(box.width, box.height);
    const fontSize = minSide < 14 ? 7 : minSide < 22 ? 8 : 10;

    text.setAttribute("x", x.toFixed(2));
    text.setAttribute("y", y.toFixed(2));
    text.setAttribute("class", "county-code");
    text.setAttribute("font-size", String(fontSize));
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.textContent = code;

    group.appendChild(text);
  });

  svgRoot.appendChild(group);
}

function wireCountyTaps() {
  const paths = countyPaths();

  if (paths.length !== Object.keys(COUNTY_NAMES).length) {
    console.warn(`Harta are ${paths.length} județe recunoscute din ${Object.keys(COUNTY_NAMES).length}.`);
  }

  paths.forEach((path) => {
    path.style.pointerEvents = "all";
    path.style.cursor = "pointer";
    path.setAttribute("tabindex", "0");
    path.setAttribute("role", "button");
    path.setAttribute("aria-label", `${COUNTY_NAMES[path.id]} - adaugă un tap`);

    path.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      tapCounty(path.id);
    });

    path.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        tapCounty(path.id);
      }
    });
  });
}

async function loadMap() {
  const svgText = await fetch("/romania.svg", { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error(`Nu pot încărca romania.svg (${r.status})`);
    return r.text();
  });

  const holder = document.getElementById("map");
  holder.innerHTML = svgText;

  svgRoot = holder.querySelector("svg");
  if (!svgRoot) throw new Error("romania.svg nu conține un element <svg>.");

  svgRoot.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgRoot.removeAttribute("width");
  svgRoot.removeAttribute("height");
  svgRoot.setAttribute("role", "img");
  svgRoot.setAttribute("aria-label", "Harta județelor României");

  wireCountyTaps();
  addCountyLabels();
}

function connectStream() {
  const es = new EventSource("/api/stream");

  es.onmessage = (ev) => {
    try {
      applyState(JSON.parse(ev.data));
    } catch (_) {}
  };

  es.onerror = () => {
    es.close();
    setTimeout(connectStream, 2500);
  };
}

async function boot() {
  try {
    await loadMap();
    const initial = await fetch("/api/state", { cache: "no-store" }).then((r) => r.json());
    applyState(initial);
    connectStream();
  } catch (err) {
    console.error(err);
    const holder = document.getElementById("map");
    if (holder) holder.innerHTML = `<div class="map-error">Harta nu s-a putut încărca. Verifică romania.svg și app.js.</div>`;
  }
}

boot();

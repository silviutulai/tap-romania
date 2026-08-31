const map = L.map("map", {
  zoomControl: true,
  attributionControl: true,
}).setView([45.94, 24.97], 6.4);

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
  attribution: "&copy; OpenStreetMap, CARTO",
  maxZoom: 12,
}).addTo(map);

let geoLayer = null;
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

function styleFeature(feature) {
  const id = feature.properties["hc-key"];
  const scores = Object.values(state.scores);
  const max = scores.length ? Math.max(...scores) : 0;
  return {
    color: "#9eb6d8",
    weight: 1,
    fillColor: colorFor(state.scores[id] || 0, max),
    fillOpacity: 0.82,
  };
}

function popupHtml(id) {
  const ranked = rankList();
  const pos = ranked.findIndex((x) => x.id === id) + 1;
  const score = state.scores[id] || 0;
  return `<div class="popup-title">${COUNTY_NAMES[id]}</div>
    <div class="popup-meta">Tap-uri: <b>${score}</b> · Locul ${pos} / ${ranked.length}</div>
    <div class="popup-meta">Apasă din nou pe județ ca să adaugi un tap.</div>`;
}

function onEachFeature(feature, layer) {
  const id = feature.properties["hc-key"];
  layer.bindPopup(() => popupHtml(id));
  layer.on({
    mouseover: (e) => e.target.setStyle({ weight: 2.5, color: "#f5c542" }),
    mouseout: (e) => geoLayer.resetStyle(e.target),
    click: () => tapCounty(id),
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
        <div class="county">${item.name}<small>${item.id.replace("ro-", "").toUpperCase()}</small></div>
        <div class="score">${item.score.toLocaleString("ro-RO")}</div>
      </div>`;
    })
    .join("");
  list.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (!geoLayer) return;
      geoLayer.eachLayer((layer) => {
        if (layer.feature.properties["hc-key"] === id) {
          map.fitBounds(layer.getBounds(), { maxZoom: 8, padding: [24, 24] });
          layer.openPopup();
        }
      });
    });
  });
}

function applyState(next) {
  state = next;
  if (geoLayer) geoLayer.setStyle(styleFeature);
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
    if (!res.ok) {
      toast(data.error || "Nu s-a putut înregistra tap-ul.");
      return;
    }
    applyState(data);
  } catch (err) {
    toast("Eroare de rețea.");
  }
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2400);
}

async function loadMap() {
  const geo = await fetch("/romania-counties.geojson").then((r) => r.json());
  geoLayer = L.geoJSON(geo, { style: styleFeature, onEachFeature }).addTo(map);
  map.fitBounds(geoLayer.getBounds(), { padding: [16, 16] });
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

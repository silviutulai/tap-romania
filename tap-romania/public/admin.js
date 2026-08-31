function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  setTimeout(() => (el.style.display = "none"), 2400);
}

function rankList(state) {
  return Object.keys(COUNTY_NAMES)
    .map((id) => ({ id, name: COUNTY_NAMES[id], score: state.scores[id] || 0 }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ro"));
}

function renderSidebar(state) {
  const ranked = rankList(state);
  document.getElementById("totalTaps").textContent = state.total.toLocaleString("ro-RO");
  document.getElementById("liveCounties").textContent = ranked.filter((x) => x.score > 0).length;
  document.getElementById("list").innerHTML = ranked
    .map((item, i) => {
      const cls = i === 0 ? "g1" : i === 1 ? "g2" : i === 2 ? "g3" : "";
      return `<div class="row" data-id="${item.id}">
        <div class="rank ${cls}">${i + 1}</div>
        <div class="county">${item.name}<small>${item.id.replace("ro-", "").toUpperCase()}</small></div>
        <div class="score">${item.score.toLocaleString("ro-RO")}</div>
      </div>`;
    })
    .join("");
  document.querySelectorAll("#list .row").forEach((row) => {
    row.addEventListener("click", () => {
      document.getElementById("adminCounty").value = row.dataset.id;
    });
  });
}

function showAdmin() {
  document.getElementById("loginCard").hidden = true;
  document.getElementById("adminApp").hidden = false;
}

function showLogin() {
  document.getElementById("loginCard").hidden = false;
  document.getElementById("adminApp").hidden = true;
}

async function me() {
  const res = await fetch("/api/admin/me", { credentials: "same-origin" });
  return res.ok;
}

async function login() {
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      username: document.getElementById("user").value.trim(),
      password: document.getElementById("pass").value,
    }),
  });
  const data = await res.json();
  if (!res.ok) return toast(data.error || "Login eșuat");
  showAdmin();
  toast("Ești autentificat.");
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST", credentials: "same-origin" });
  showLogin();
}

async function addPoints(points) {
  const county = document.getElementById("adminCounty").value;
  const res = await fetch("/api/admin/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ county, points }),
  });
  const data = await res.json();
  if (res.status === 401) {
    showLogin();
    return toast("Sesiunea a expirat. Intră din nou.");
  }
  if (!res.ok) return toast(data.error || "Nu s-au adăugat punctele.");
  renderSidebar(data);
  toast("Puncte actualizate.");
}

function connectStream() {
  const es = new EventSource("/api/stream");
  es.onmessage = (ev) => {
    try { renderSidebar(JSON.parse(ev.data)); } catch (_) {}
  };
  es.onerror = () => {
    setTimeout(connectStream, 2500);
    es.close();
  };
}

async function boot() {
  const select = document.getElementById("adminCounty");
  select.innerHTML = Object.entries(COUNTY_NAMES)
    .sort((a, b) => a[1].localeCompare(b[1], "ro"))
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join("");

  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("pass").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("addPoints").addEventListener("click", () => {
    addPoints(Number(document.getElementById("adminPoints").value || 0));
  });
  document.querySelectorAll(".quick .btn").forEach((btn) => {
    btn.addEventListener("click", () => addPoints(Number(btn.dataset.pts)));
  });

  if (await me()) showAdmin();
  const initial = await fetch("/api/state").then((r) => r.json());
  renderSidebar(initial);
  connectStream();
}

boot();

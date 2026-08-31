#!/usr/bin/env python3
"""Tap Tap România — public map + admin login + SSE."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import secrets
import threading
import time
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(ROOT, "public")
DATA_FILE = os.path.join(ROOT, "data.json")
PORT = int(os.environ.get("PORT", "8080"))
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
SECRET = os.environ.get("SECRET_KEY", "schimba-cheia-in-productie")
COOKIE_NAME = "ttr_session"
SESSION_TTL = 60 * 60 * 24 * 7

COUNTY_IDS = {
    "RO-AB", "RO-AR", "RO-AG", "RO-BC", "RO-BH", "RO-BN", "RO-BT", "RO-BV",
    "RO-BR", "RO-B", "RO-BZ", "RO-CL", "RO-CS", "RO-CJ", "RO-CT", "RO-CV",
    "RO-DB", "RO-DJ", "RO-GL", "RO-GR", "RO-GJ", "RO-HR", "RO-HD", "RO-IL",
    "RO-IS", "RO-IF", "RO-MM", "RO-MH", "RO-MS", "RO-NT", "RO-OT", "RO-PH",
    "RO-SM", "RO-SJ", "RO-SB", "RO-SV", "RO-TR", "RO-TM", "RO-TL", "RO-VL",
    "RO-VS", "RO-VN",
}

OLD_TO_NEW = {
    "ro-ab": "RO-AB", "ro-ar": "RO-AR", "ro-ag": "RO-AG", "ro-bc": "RO-BC",
    "ro-bh": "RO-BH", "ro-bn": "RO-BN", "ro-bt": "RO-BT", "ro-bv": "RO-BV",
    "ro-br": "RO-BR", "ro-bi": "RO-B", "ro-bz": "RO-BZ", "ro-cl": "RO-CL",
    "ro-cs": "RO-CS", "ro-cj": "RO-CJ", "ro-ct": "RO-CT", "ro-cv": "RO-CV",
    "ro-db": "RO-DB", "ro-dj": "RO-DJ", "ro-gl": "RO-GL", "ro-gr": "RO-GR",
    "ro-gj": "RO-GJ", "ro-hr": "RO-HR", "ro-hd": "RO-HD", "ro-il": "RO-IL",
    "ro-is": "RO-IS", "ro-if": "RO-IF", "ro-mm": "RO-MM", "ro-mh": "RO-MH",
    "ro-ms": "RO-MS", "ro-nt": "RO-NT", "ro-ot": "RO-OT", "ro-ph": "RO-PH",
    "ro-sm": "RO-SM", "ro-sj": "RO-SJ", "ro-sb": "RO-SB", "ro-sv": "RO-SV",
    "ro-tr": "RO-TR", "ro-tm": "RO-TM", "ro-tl": "RO-TL", "ro-vl": "RO-VL",
    "ro-vs": "RO-VS", "ro-vn": "RO-VN",
}

lock = threading.Lock()
subscribers: list[queue.Queue] = []
last_tap_by_ip: dict[str, float] = {}


def empty_state() -> dict:
    return {"scores": {cid: 0 for cid in COUNTY_IDS}, "total": 0, "updated": int(time.time())}


def load_state() -> dict:
    if not os.path.exists(DATA_FILE):
        return empty_state()
    try:
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        raw = data.get("scores", {})
        scores = {cid: 0 for cid in COUNTY_IDS}
        for key, val in raw.items():
            dest = key if key in COUNTY_IDS else OLD_TO_NEW.get(key)
            if dest:
                scores[dest] = scores.get(dest, 0) + int(val)
        return {"scores": scores, "total": sum(scores.values()), "updated": int(time.time())}
    except Exception:
        return empty_state()


state = load_state()


def save_state() -> None:
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def snapshot() -> dict:
    return {"scores": dict(state["scores"]), "total": state["total"], "updated": state["updated"]}


def publish() -> None:
    payload = json.dumps(snapshot(), ensure_ascii=False)
    dead = []
    for q in list(subscribers):
        try:
            q.put_nowait(payload)
        except Exception:
            dead.append(q)
    for q in dead:
        if q in subscribers:
            subscribers.remove(q)


def add_points(county: str, points: int) -> dict:
    if county not in COUNTY_IDS:
        raise ValueError("Județ invalid")
    with lock:
        state["scores"][county] = max(0, int(state["scores"].get(county, 0)) + int(points))
        state["total"] = sum(state["scores"].values())
        state["updated"] = int(time.time())
        save_state()
        current = snapshot()
    publish()
    return current


def sign(payload: str) -> str:
    return hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def make_session() -> str:
    exp = str(int(time.time()) + SESSION_TTL)
    nonce = secrets.token_hex(8)
    raw = f"{ADMIN_USER}|{exp}|{nonce}"
    return f"{raw}|{sign(raw)}"


def valid_session(value: str | None) -> bool:
    if not value:
        return False
    parts = value.split("|")
    if len(parts) != 4:
        return False
    user, exp, nonce, sig = parts
    raw = f"{user}|{exp}|{nonce}"
    if not hmac.compare_digest(sig, sign(raw)):
        return False
    try:
        if int(exp) < time.time():
            return False
    except ValueError:
        return False
    return user == ADMIN_USER


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def log_message(self, fmt, *args):
        print("[%s] %s" % (self.log_date_time_string(), fmt % args), flush=True)

    def cookie_value(self) -> str | None:
        raw = self.headers.get("Cookie", "")
        if not raw:
            return None
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return None
        morsel = jar.get(COOKIE_NAME)
        return morsel.value if morsel else None

    def is_admin(self) -> bool:
        return valid_session(self.cookie_value())

    def set_session_cookie(self, value: str | None, max_age: int):
        flags = f"{COOKIE_NAME}={value or ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
        if os.environ.get("COOKIE_SECURE", "").lower() in {"1", "true", "yes"}:
            flags += "; Secure"
        self.send_header("Set-Cookie", flags)

    def _json(self, code: int, payload: dict, cookie: tuple[str | None, int] | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.set_session_cookie(*cookie)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            self._json(200, {"ok": True})
            return
        if path == "/admin":
            self.path = "/admin.html"
            return super().do_GET()
        if path == "/api/state":
            self._json(200, snapshot())
            return
        if path == "/api/admin/me":
            if self.is_admin():
                self._json(200, {"ok": True, "user": ADMIN_USER})
            else:
                self._json(401, {"ok": False})
            return
        if path == "/api/stream":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            q: queue.Queue = queue.Queue(maxsize=20)
            subscribers.append(q)
            try:
                self.wfile.write(f"data: {json.dumps(snapshot(), ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
                while True:
                    try:
                        payload = q.get(timeout=20)
                        self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                        self.wfile.flush()
                    except queue.Empty:
                        self.wfile.write(b": ping\n\n")
                        self.wfile.flush()
            except BrokenPipeError:
                pass
            finally:
                if q in subscribers:
                    subscribers.remove(q)
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        ip = self.client_address[0]
        body = self._read_json()

        if path == "/api/tap":
            county = str(body.get("county", ""))
            now = time.time()
            last = last_tap_by_ip.get(ip, 0)
            if now - last < 0.8:
                self._json(429, {"error": "Prea rapid. Mai așteaptă o secundă."})
                return
            last_tap_by_ip[ip] = now
            try:
                current = add_points(county, 1)
            except ValueError as e:
                self._json(400, {"error": str(e)})
                return
            self._json(200, current)
            return

        if path == "/api/admin/login":
            user = str(body.get("username", ""))
            password = str(body.get("password", ""))
            if secrets.compare_digest(user, ADMIN_USER) and secrets.compare_digest(password, ADMIN_PASSWORD):
                self._json(200, {"ok": True}, cookie=(make_session(), SESSION_TTL))
                return
            time.sleep(0.3)
            self._json(401, {"error": "Utilizator sau parolă greșită."})
            return

        if path == "/api/admin/logout":
            self._json(200, {"ok": True}, cookie=("", 0))
            return

        if path == "/api/admin/add":
            if not self.is_admin():
                self._json(401, {"error": "Trebuie să fii autentificat."})
                return
            county = str(body.get("county", ""))
            try:
                points = int(body.get("points", 0))
            except (TypeError, ValueError):
                self._json(400, {"error": "Puncte invalide."})
                return
            if abs(points) > 1_000_000:
                self._json(400, {"error": "Valoare prea mare."})
                return
            try:
                current = add_points(county, points)
            except ValueError as e:
                self._json(400, {"error": str(e)})
                return
            self._json(200, current)
            return

        self._json(404, {"error": "Not found"})


def main():
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Tap Tap România pe http://0.0.0.0:{PORT}", flush=True)
    print(f"Public: /   Admin: /admin   user={ADMIN_USER}", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()

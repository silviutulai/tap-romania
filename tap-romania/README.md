# Tap Tap România

Harta publică: lumea dă tap pe județ și vede clasamentul live.
Admin: te loghezi pe `/admin` și adaugi puncte manual.

## Local

```bash
python3 server.py
```

- Public: http://localhost:8080
- Admin: http://localhost:8080/admin
- User implicit: `admin`
- Parolă implicită: `admin123`

## Deploy

Setează obligatoriu în producție:

- `ADMIN_USER`
- `ADMIN_PASSWORD`
- `SECRET_KEY` (șir lung aleator)
- `COOKIE_SECURE=true` dacă ai HTTPS
- `PORT` — majoritatea platformelor îl pun singure

### Render
1. New Web Service → conectezi repo-ul
2. Runtime: Python
3. Build: lasă gol / `true`
4. Start: `python3 server.py`
5. Pui variabilele de mediu de mai sus

Poți folosi și `render.yaml`.

### Railway / Fly / orice Docker
```bash
docker build -t tap-romania .
docker run -p 8080:8080 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=parola-ta \
  -e SECRET_KEY=cheie-secreta \
  tap-romania
```

### VPS
```bash
python3 server.py
```
Pune Nginx sau Caddy în față pentru HTTPS.

## Rute

- `/` — public: hartă + tap + clasament live
- `/admin` — doar tu, după login
- `/api/tap` — +1 punct public
- `/api/stream` — update live
- `/api/admin/login` — autentificare
- `/api/admin/add` — puncte manuale, doar sesiune admin
- `/health` — healthcheck deploy

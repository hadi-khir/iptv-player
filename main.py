#!/usr/bin/env python3
"""StreamX — IPTV Player Backend"""

import asyncio
import hashlib
import hmac
import json
import re
import secrets
import shutil
import sqlite3
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse
from fastapi.responses import FileResponse as ServeFile, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# ── Database ──────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent / "streamx.db"
DOWNLOADS_DIR = Path(__file__).parent / "downloads"
active_tasks: dict = {}   # download_id -> asyncio.Task
active_procs: dict = {}   # download_id -> asyncio.subprocess.Process
download_sem = None        # asyncio.Semaphore(3), set in lifespan


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL COLLATE NOCASE,
            password_hash TEXT    NOT NULL,
            display_name  TEXT    NOT NULL,
            avatar_color  TEXT    NOT NULL DEFAULT '#6366f1',
            created_at    INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS sessions (
            token      TEXT    PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS connections (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name             TEXT    NOT NULL,
            server           TEXT    NOT NULL,
            xtream_username  TEXT    NOT NULL,
            xtream_password  TEXT    NOT NULL,
            account_info     TEXT,
            is_active        INTEGER NOT NULL DEFAULT 0,
            last_used        INTEGER,
            created_at       INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS favourites (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
            connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            type          TEXT    NOT NULL,
            item_id       TEXT    NOT NULL,
            item_name     TEXT    NOT NULL,
            item_data     TEXT,
            created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, connection_id, type, item_id)
        );

        CREATE TABLE IF NOT EXISTS recently_viewed (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
            connection_id INTEGER NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
            type          TEXT    NOT NULL,
            item_id       TEXT    NOT NULL,
            item_name     TEXT    NOT NULL,
            item_data     TEXT,
            viewed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
            UNIQUE(user_id, connection_id, item_id)
        );

        CREATE TABLE IF NOT EXISTS downloads (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            connection_id INTEGER REFERENCES connections(id) ON DELETE SET NULL,
            item_id       TEXT NOT NULL,
            item_name     TEXT NOT NULL,
            item_type     TEXT NOT NULL,
            stream_url    TEXT NOT NULL,
            file_path     TEXT,
            file_size     INTEGER DEFAULT 0,
            status        TEXT NOT NULL DEFAULT 'queued',
            progress      REAL NOT NULL DEFAULT 0,
            speed         TEXT DEFAULT '',
            eta           TEXT DEFAULT '',
            error_msg     TEXT,
            tool          TEXT DEFAULT '',
            created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
            completed_at  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_dl_user ON downloads(user_id, created_at);

        CREATE INDEX IF NOT EXISTS idx_sessions_uid  ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_favs_uid_cid  ON favourites(user_id, connection_id);
        CREATE INDEX IF NOT EXISTS idx_recent_uid_cid ON recently_viewed(user_id, connection_id, viewed_at);
    """)
    db.commit()
    db.close()


# ── Auth helpers ──────────────────────────────────────────────────────────────

SESSION_TTL = 30 * 24 * 3600  # 30 days
AVATAR_COLORS = [
    "#6366f1", "#3b82f6", "#10b981", "#f59e0b",
    "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4",
]


def hash_password(pw: str) -> str:
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 260_000)
    return f"{salt}:{key.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        salt, key_hex = stored.split(":", 1)
        key = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 260_000)
        return hmac.compare_digest(key.hex(), key_hex)
    except Exception:
        return False


def create_session(db: sqlite3.Connection, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + SESSION_TTL
    db.execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)",
        (token, user_id, expires),
    )
    return token


def user_by_token(db: sqlite3.Connection, token: str) -> Optional[dict]:
    now = int(time.time())
    row = db.execute(
        """SELECT u.* FROM users u
           JOIN sessions s ON s.user_id = u.id
           WHERE s.token = ? AND s.expires_at > ?""",
        (token, now),
    ).fetchone()
    return dict(row) if row else None


def require_user(request: Request) -> dict:
    auth = request.headers.get("authorization", "")
    token = auth[7:] if auth.startswith("Bearer ") else None
    if not token:
        raise HTTPException(401, "Authentication required")
    db = get_db()
    try:
        user = user_by_token(db, token)
    finally:
        db.close()
    if not user:
        raise HTTPException(401, "Invalid or expired session")
    return user


def active_conn(db: sqlite3.Connection, user_id: int) -> dict:
    row = db.execute(
        "SELECT * FROM connections WHERE user_id = ? AND is_active = 1",
        (user_id,),
    ).fetchone()
    if not row:
        raise HTTPException(400, "No active IPTV connection")
    return dict(row)


# ── IPTV proxy helpers ────────────────────────────────────────────────────────


async def xtream_auth(server: str, username: str, password: str) -> dict:
    base = server.rstrip("/")
    async with httpx.AsyncClient(verify=False, timeout=15.0) as client:
        r = await client.get(
            f"{base}/player_api.php",
            params={"username": username, "password": password},
        )
        r.raise_for_status()
        return r.json()


async def xtream_call(conn: dict, action: str, params: dict | None = None) -> Any:
    base = conn["server"].rstrip("/")
    qs = {
        "username": conn["xtream_username"],
        "password": conn["xtream_password"],
        "action": action,
        **(params or {}),
    }
    async with httpx.AsyncClient(verify=False, timeout=20.0) as client:
        r = await client.get(f"{base}/player_api.php", params=qs)
        r.raise_for_status()
        return r.json()


def safe_conn(c: dict) -> dict:
    """Return connection dict without xtream_password."""
    d = dict(c)
    d.pop("xtream_password", None)
    if d.get("account_info"):
        d["account_info"] = json.loads(d["account_info"])
    return d


# ── Pydantic models ───────────────────────────────────────────────────────────


class RegisterIn(BaseModel):
    username: str
    password: str
    display_name: str = ""


class LoginIn(BaseModel):
    username: str
    password: str


class ProfileIn(BaseModel):
    display_name: str = ""
    avatar_color: str = ""


class ConnectionIn(BaseModel):
    name: str
    server: str
    xtream_username: str
    xtream_password: str


class FavIn(BaseModel):
    connection_id: int
    type: str
    item_id: str
    item_name: str
    item_data: dict = {}


class RecentIn(BaseModel):
    connection_id: int
    type: str
    item_id: str
    item_name: str
    item_data: dict = {}


class DownloadIn(BaseModel):
    connection_id: int
    item_id: str
    item_name: str
    item_type: str   # 'movie' or 'series'
    ext: str = "mp4"


# ── App ───────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    global download_sem
    Path("static").mkdir(exist_ok=True)
    DOWNLOADS_DIR.mkdir(exist_ok=True)
    init_db()
    download_sem = asyncio.Semaphore(3)
    # Reset stuck downloads from previous run
    db = get_db()
    db.execute("UPDATE downloads SET status='failed', error_msg='Server restarted' WHERE status IN ('queued','downloading')")
    db.commit()
    db.close()
    yield
    # Cancel all active downloads on shutdown
    for task in list(active_tasks.values()):
        task.cancel()


app = FastAPI(lifespan=lifespan, title="StreamX API")


# ── Download helpers ──────────────────────────────────────────────────────────


def sanitize_fn(name: str) -> str:
    s = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '', name)
    s = re.sub(r'[\s]+', '_', s.strip())[:60]
    return s or 'download'


def fmt_bytes(n: int) -> str:
    for unit in ('B', 'KB', 'MB', 'GB'):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def get_dl_tool() -> tuple[str, str]:
    """Returns (tool_name, executable_path) or raises RuntimeError."""
    for name in ('yt-dlp', 'yt_dlp', 'ytdlp'):
        p = shutil.which(name)
        if p:
            return ('ytdlp', p)
    p = shutil.which('ffmpeg')
    if p:
        return ('ffmpeg', p)
    raise RuntimeError(
        "No download tool found. Install yt-dlp with: pip3 install yt-dlp"
    )


async def run_download(download_id: int, stream_url: str, out_dir: Path, stem: str) -> None:
    db = get_db()
    db.execute("UPDATE downloads SET status='downloading' WHERE id=?", (download_id,))
    db.commit()

    try:
        tool, exe = get_dl_tool()
    except RuntimeError as e:
        db.execute("UPDATE downloads SET status='failed', error_msg=? WHERE id=?", (str(e), download_id))
        db.commit()
        db.close()
        return

    db.execute("UPDATE downloads SET tool=? WHERE id=?", (tool, download_id))
    db.commit()

    expected_file = out_dir / f"{stem}.mp4"

    try:
        if tool == 'ytdlp':
            tpl = str(out_dir / f"{stem}.%(ext)s")
            cmd = [
                exe, '--no-playlist', '--newline', '--progress',
                '--merge-output-format', 'mp4', '--no-warnings',
                '-o', tpl, stream_url,
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
            )
            pipe = proc.stdout
        else:  # ffmpeg
            cmd = ['ffmpeg', '-i', stream_url, '-c', 'copy',
                   '-movflags', '+faststart', '-y', str(expected_file)]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            pipe = None

        active_procs[download_id] = proc
        prog_re = re.compile(
            r'\[download\]\s+(\d+\.?\d*)%\s+of\s+~?\s*[\d.]+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)'
        )

        if pipe:
            async for raw in pipe:
                line = raw.decode('utf-8', errors='replace').strip()
                m = prog_re.search(line)
                if m:
                    db.execute(
                        "UPDATE downloads SET progress=?, speed=?, eta=? WHERE id=?",
                        (round(float(m.group(1)), 1), m.group(2), m.group(3), download_id),
                    )
                    db.commit()

        await proc.wait()

        if proc.returncode == 0:
            actual = expected_file
            if not actual.exists():
                for f in out_dir.glob(f"{stem}.*"):
                    actual = f
                    break
            fsize = actual.stat().st_size if actual.exists() else 0
            db.execute(
                """UPDATE downloads SET status='completed', progress=100,
                   file_path=?, file_size=?, completed_at=? WHERE id=?""",
                (str(actual), fsize, int(time.time()), download_id),
            )
        else:
            db.execute(
                "UPDATE downloads SET status='failed', error_msg='Process exited with error' WHERE id=?",
                (download_id,),
            )
        db.commit()

    except asyncio.CancelledError:
        p = active_procs.get(download_id)
        if p:
            try:
                p.kill()
            except Exception:
                pass
        for f in out_dir.glob(f"{stem}.*"):
            try:
                f.unlink()
            except Exception:
                pass
        db.execute("UPDATE downloads SET status='cancelled' WHERE id=?", (download_id,))
        db.commit()
        raise

    except Exception as e:
        db.execute(
            "UPDATE downloads SET status='failed', error_msg=? WHERE id=?",
            (str(e)[:400], download_id),
        )
        db.commit()

    finally:
        active_procs.pop(download_id, None)
        db.close()


# ── Auth routes ───────────────────────────────────────────────────────────────


@app.post("/api/auth/register")
def register(body: RegisterIn):
    uname = body.username.strip()
    if len(uname) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if len(body.password) < 4:
        raise HTTPException(400, "Password must be at least 4 characters")

    db = get_db()
    try:
        if db.execute("SELECT 1 FROM users WHERE LOWER(username)=LOWER(?)", (uname,)).fetchone():
            raise HTTPException(409, "Username already taken")

        dn = body.display_name.strip() or uname
        color = AVATAR_COLORS[hash(uname.lower()) % len(AVATAR_COLORS)]
        ph = hash_password(body.password)

        cur = db.execute(
            "INSERT INTO users (username, password_hash, display_name, avatar_color) VALUES (?,?,?,?)",
            (uname, ph, dn, color),
        )
        uid = cur.lastrowid
        token = create_session(db, uid)
        db.commit()
        return {
            "token": token,
            "user": {"id": uid, "username": uname, "display_name": dn, "avatar_color": color},
        }
    finally:
        db.close()


@app.post("/api/auth/login")
def login(body: LoginIn):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM users WHERE LOWER(username)=LOWER(?)", (body.username,)
        ).fetchone()
        if not row or not verify_password(body.password, row["password_hash"]):
            raise HTTPException(401, "Invalid username or password")

        user = dict(row)
        token = create_session(db, user["id"])
        db.commit()
        return {
            "token": token,
            "user": {k: user[k] for k in ("id", "username", "display_name", "avatar_color")},
        }
    finally:
        db.close()


@app.post("/api/auth/logout")
def logout(request: Request):
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:]
        db = get_db()
        try:
            db.execute("DELETE FROM sessions WHERE token=?", (token,))
            db.commit()
        finally:
            db.close()
    return {"ok": True}


@app.get("/api/auth/me")
def get_me(user: dict = Depends(require_user)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM connections WHERE user_id=? AND is_active=1", (user["id"],)
        ).fetchone()
        conn = safe_conn(dict(row)) if row else None
        return {
            "user": {k: user[k] for k in ("id", "username", "display_name", "avatar_color")},
            "connection": conn,
        }
    finally:
        db.close()


@app.put("/api/auth/me")
def update_me(body: ProfileIn, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if body.display_name.strip():
            db.execute(
                "UPDATE users SET display_name=? WHERE id=?",
                (body.display_name.strip(), user["id"]),
            )
        if body.avatar_color.strip():
            db.execute(
                "UPDATE users SET avatar_color=? WHERE id=?",
                (body.avatar_color.strip(), user["id"]),
            )
        db.commit()
        row = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
        u = dict(row)
        return {k: u[k] for k in ("id", "username", "display_name", "avatar_color")}
    finally:
        db.close()


# ── Connection routes ─────────────────────────────────────────────────────────


@app.get("/api/connections")
def list_connections(user: dict = Depends(require_user)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM connections WHERE user_id=? ORDER BY is_active DESC, last_used DESC",
            (user["id"],),
        ).fetchall()
        return [safe_conn(dict(r)) for r in rows]
    finally:
        db.close()


@app.post("/api/connections")
async def add_connection(body: ConnectionIn, user: dict = Depends(require_user)):
    try:
        data = await xtream_auth(body.server, body.xtream_username, body.xtream_password)
    except Exception as e:
        raise HTTPException(400, f"Cannot reach IPTV server: {e}")

    if not data.get("user_info"):
        raise HTTPException(400, "Invalid response from IPTV server")
    if data["user_info"].get("auth") in (0, "0"):
        raise HTTPException(401, "Invalid IPTV username or password")

    db = get_db()
    try:
        count = db.execute(
            "SELECT COUNT(*) FROM connections WHERE user_id=?", (user["id"],)
        ).fetchone()[0]
        is_active = 1 if count == 0 else 0

        cur = db.execute(
            """INSERT INTO connections
               (user_id, name, server, xtream_username, xtream_password,
                account_info, is_active, last_used)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                user["id"], body.name.strip(), body.server.rstrip("/"),
                body.xtream_username, body.xtream_password,
                json.dumps(data["user_info"]), is_active, int(time.time()),
            ),
        )
        db.commit()
        return {
            "id": cur.lastrowid,
            "name": body.name.strip(),
            "server": body.server.rstrip("/"),
            "xtream_username": body.xtream_username,
            "is_active": is_active,
            "account_info": data["user_info"],
            "created_at": int(time.time()),
        }
    finally:
        db.close()


@app.delete("/api/connections/{cid}")
def delete_connection(cid: int, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if not db.execute(
            "SELECT 1 FROM connections WHERE id=? AND user_id=?", (cid, user["id"])
        ).fetchone():
            raise HTTPException(404, "Connection not found")
        db.execute("DELETE FROM connections WHERE id=?", (cid,))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.post("/api/connections/{cid}/activate")
def activate_connection(cid: int, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if not db.execute(
            "SELECT 1 FROM connections WHERE id=? AND user_id=?", (cid, user["id"])
        ).fetchone():
            raise HTTPException(404, "Connection not found")
        db.execute("UPDATE connections SET is_active=0 WHERE user_id=?", (user["id"],))
        db.execute(
            "UPDATE connections SET is_active=1, last_used=? WHERE id=?",
            (int(time.time()), cid),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── IPTV proxy routes ─────────────────────────────────────────────────────────

CAT_ACTIONS = {
    "live": "get_live_categories",
    "movies": "get_vod_categories",
    "series": "get_series_categories",
}
STR_ACTIONS = {
    "live": "get_live_streams",
    "movies": "get_vod_streams",
    "series": "get_series",
}


@app.get("/api/iptv/categories")
async def iptv_categories(tab: str = "live", user: dict = Depends(require_user)):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    try:
        return await xtream_call(conn, CAT_ACTIONS.get(tab, "get_live_categories")) or []
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/iptv/streams")
async def iptv_streams(
    tab: str = "live", category_id: str = "", user: dict = Depends(require_user)
):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    params = {"category_id": category_id} if category_id else {}
    try:
        return await xtream_call(conn, STR_ACTIONS.get(tab, "get_live_streams"), params) or []
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/iptv/epg")
async def iptv_epg(stream_id: str, user: dict = Depends(require_user)):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    try:
        return (
            await xtream_call(conn, "get_short_epg", {"stream_id": stream_id, "limit": 2}) or {}
        )
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/iptv/vod-info")
async def iptv_vod_info(vod_id: str, user: dict = Depends(require_user)):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    try:
        return await xtream_call(conn, "get_vod_info", {"vod_id": vod_id}) or {}
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/iptv/series-info")
async def iptv_series_info(series_id: str, user: dict = Depends(require_user)):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    try:
        return await xtream_call(conn, "get_series_info", {"series_id": series_id}) or {}
    except Exception as e:
        raise HTTPException(502, str(e))


@app.get("/api/iptv/stream-url")
def iptv_stream_url(
    stream_id: str, type: str = "live", ext: str = "m3u8",
    user: dict = Depends(require_user),
):
    db = get_db()
    try:
        conn = active_conn(db, user["id"])
    finally:
        db.close()
    base = conn["server"].rstrip("/")
    u, p = conn["xtream_username"], conn["xtream_password"]
    if type == "live":
        url = f"{base}/live/{u}/{p}/{stream_id}.m3u8"
    elif type == "movie":
        url = f"{base}/movie/{u}/{p}/{stream_id}.{ext}"
    else:
        url = f"{base}/series/{u}/{p}/{stream_id}.{ext}"
    return {"url": url}


# ── Favourites routes ─────────────────────────────────────────────────────────
# NOTE: by-item DELETE must be registered BEFORE /{fid} to avoid path conflict


@app.delete("/api/favourites/by-item/{conn_id}/{ftype}/{item_id}")
def remove_fav_by_item(
    conn_id: int, ftype: str, item_id: str, user: dict = Depends(require_user)
):
    db = get_db()
    try:
        db.execute(
            "DELETE FROM favourites WHERE user_id=? AND connection_id=? AND type=? AND item_id=?",
            (user["id"], conn_id, ftype, item_id),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/favourites")
def get_favs(connection_id: Optional[int] = None, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if connection_id:
            rows = db.execute(
                "SELECT * FROM favourites WHERE user_id=? AND connection_id=? ORDER BY created_at DESC",
                (user["id"], connection_id),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM favourites WHERE user_id=? ORDER BY created_at DESC",
                (user["id"],),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("item_data"):
                d["item_data"] = json.loads(d["item_data"])
            result.append(d)
        return result
    finally:
        db.close()


@app.post("/api/favourites")
def add_fav(body: FavIn, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if not db.execute(
            "SELECT 1 FROM connections WHERE id=? AND user_id=?",
            (body.connection_id, user["id"]),
        ).fetchone():
            raise HTTPException(404, "Connection not found")
        db.execute(
            """INSERT OR IGNORE INTO favourites
               (user_id, connection_id, type, item_id, item_name, item_data)
               VALUES (?,?,?,?,?,?)""",
            (
                user["id"], body.connection_id, body.type,
                body.item_id, body.item_name, json.dumps(body.item_data),
            ),
        )
        db.commit()
        row = db.execute(
            "SELECT * FROM favourites WHERE user_id=? AND connection_id=? AND type=? AND item_id=?",
            (user["id"], body.connection_id, body.type, body.item_id),
        ).fetchone()
        d = dict(row)
        if d.get("item_data"):
            d["item_data"] = json.loads(d["item_data"])
        return d
    finally:
        db.close()


@app.delete("/api/favourites/{fid}")
def remove_fav(fid: int, user: dict = Depends(require_user)):
    db = get_db()
    try:
        db.execute("DELETE FROM favourites WHERE id=? AND user_id=?", (fid, user["id"]))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── Recently viewed routes ────────────────────────────────────────────────────


@app.get("/api/recent")
def get_recent(
    connection_id: Optional[int] = None,
    limit: int = 24,
    user: dict = Depends(require_user),
):
    db = get_db()
    try:
        if connection_id:
            rows = db.execute(
                """SELECT * FROM recently_viewed
                   WHERE user_id=? AND connection_id=?
                   ORDER BY viewed_at DESC LIMIT ?""",
                (user["id"], connection_id, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM recently_viewed WHERE user_id=? ORDER BY viewed_at DESC LIMIT ?",
                (user["id"], limit),
            ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            if d.get("item_data"):
                d["item_data"] = json.loads(d["item_data"])
            result.append(d)
        return result
    finally:
        db.close()


@app.post("/api/recent")
def add_recent(body: RecentIn, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if not db.execute(
            "SELECT 1 FROM connections WHERE id=? AND user_id=?",
            (body.connection_id, user["id"]),
        ).fetchone():
            raise HTTPException(404, "Connection not found")
        now = int(time.time())
        db.execute(
            """INSERT INTO recently_viewed
               (user_id, connection_id, type, item_id, item_name, item_data, viewed_at)
               VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(user_id, connection_id, item_id)
               DO UPDATE SET
                 item_name = excluded.item_name,
                 item_data = excluded.item_data,
                 viewed_at = excluded.viewed_at""",
            (
                user["id"], body.connection_id, body.type,
                body.item_id, body.item_name, json.dumps(body.item_data), now,
            ),
        )
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.delete("/api/recent/clear")
def clear_recent(connection_id: Optional[int] = None, user: dict = Depends(require_user)):
    db = get_db()
    try:
        if connection_id:
            db.execute(
                "DELETE FROM recently_viewed WHERE user_id=? AND connection_id=?",
                (user["id"], connection_id),
            )
        else:
            db.execute("DELETE FROM recently_viewed WHERE user_id=?", (user["id"],))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


# ── Download routes ───────────────────────────────────────────────────────────


@app.post("/api/downloads")
async def start_download(body: DownloadIn, user: dict = Depends(require_user)):
    if body.item_type not in ("movie", "series"):
        raise HTTPException(400, "Only movies and series can be downloaded")

    db = get_db()
    try:
        conn = db.execute(
            "SELECT * FROM connections WHERE id=? AND user_id=?",
            (body.connection_id, user["id"]),
        ).fetchone()
        if not conn:
            raise HTTPException(404, "Connection not found")
        conn = dict(conn)

        # Build stream URL server-side (credentials never leave backend)
        base = conn["server"].rstrip("/")
        u, p = conn["xtream_username"], conn["xtream_password"]
        ext = body.ext or "mp4"
        if body.item_type == "movie":
            stream_url = f"{base}/movie/{u}/{p}/{body.item_id}.{ext}"
        else:
            stream_url = f"{base}/series/{u}/{p}/{body.item_id}.{ext}"

        # Check for duplicate
        dup = db.execute(
            "SELECT id, status FROM downloads WHERE user_id=? AND item_id=? AND status NOT IN ('failed','cancelled')",
            (user["id"], body.item_id),
        ).fetchone()
        if dup:
            d = dict(dup)
            if d["status"] == "completed":
                raise HTTPException(409, "Already downloaded")
            raise HTTPException(409, "Already in download queue")

        # Prepare output path
        out_dir = DOWNLOADS_DIR / str(user["id"])
        out_dir.mkdir(parents=True, exist_ok=True)
        stem = f"{sanitize_fn(body.item_name)}_{body.item_id}"

        cur = db.execute(
            """INSERT INTO downloads
               (user_id, connection_id, item_id, item_name, item_type, stream_url)
               VALUES (?,?,?,?,?,?)""",
            (user["id"], body.connection_id, body.item_id,
             body.item_name, body.item_type, stream_url),
        )
        dl_id = cur.lastrowid
        db.commit()

        # Start async task gated by semaphore
        async def _guarded():
            async with download_sem:
                await run_download(dl_id, stream_url, out_dir, stem)

        task = asyncio.create_task(_guarded())
        active_tasks[dl_id] = task
        task.add_done_callback(lambda _: active_tasks.pop(dl_id, None))

        return {"id": dl_id, "status": "queued"}
    finally:
        db.close()


@app.get("/api/downloads")
def list_downloads(user: dict = Depends(require_user)):
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM downloads WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["file_size_fmt"] = fmt_bytes(d.get("file_size") or 0)
            result.append(d)
        return result
    finally:
        db.close()


@app.delete("/api/downloads/{did}")
def delete_download(did: int, user: dict = Depends(require_user)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM downloads WHERE id=? AND user_id=?", (did, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(404, "Download not found")
        d = dict(row)

        # Cancel if active
        task = active_tasks.get(did)
        if task:
            task.cancel()
        proc = active_procs.get(did)
        if proc:
            try:
                proc.kill()
            except Exception:
                pass

        # Delete file if exists
        if d.get("file_path") and Path(d["file_path"]).exists():
            try:
                Path(d["file_path"]).unlink()
            except Exception:
                pass

        db.execute("DELETE FROM downloads WHERE id=?", (did,))
        db.commit()
        return {"ok": True}
    finally:
        db.close()


@app.get("/api/downloads/storage")
def download_storage(user: dict = Depends(require_user)):
    user_dir = DOWNLOADS_DIR / str(user["id"])
    total = sum(f.stat().st_size for f in user_dir.rglob("*") if f.is_file()) if user_dir.exists() else 0
    db = get_db()
    try:
        count = db.execute(
            "SELECT COUNT(*) FROM downloads WHERE user_id=? AND status='completed'",
            (user["id"],),
        ).fetchone()[0]
        return {"total_bytes": total, "total_fmt": fmt_bytes(total), "file_count": count}
    finally:
        db.close()


@app.get("/api/downloads/{did}/file")
def serve_download(did: int, user: dict = Depends(require_user)):
    db = get_db()
    try:
        row = db.execute(
            "SELECT * FROM downloads WHERE id=? AND user_id=? AND status='completed'",
            (did, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Download not found or not complete")
        d = dict(row)
        fpath = Path(d["file_path"])
        if not fpath.exists():
            raise HTTPException(404, "File missing from disk")
        return ServeFile(
            str(fpath),
            filename=fpath.name,
            media_type="video/mp4",
        )
    finally:
        db.close()


# ── Audio-transcoding stream proxy ───────────────────────────────────────────
# Accepts ?token= so the browser's <video src="..."> can authenticate without
# custom headers.  Audio is always re-encoded to AAC; video is stream-copied.
# Uses asyncio.create_subprocess_exec (no shell=True) — no shell injection risk.

_SAFE_ID = re.compile(r'^[\w\-]+$')   # digits, letters, underscore, hyphen only
_SAFE_EXT = re.compile(r'^[a-z0-9]{1,6}$')


@app.get("/api/proxy-stream/{stream_id}")
async def proxy_stream(
    stream_id: str,
    request: Request,
    type: str = "live",
    ext: str = "mp4",
    token: str = "",
    start: float = 0.0,
):
    # Validate path/query values before embedding in any URL or command argument
    if not _SAFE_ID.match(stream_id):
        raise HTTPException(400, "Invalid stream_id")
    if not _SAFE_EXT.match(ext):
        raise HTTPException(400, "Invalid ext")
    if type not in ("live", "movie", "series"):
        raise HTTPException(400, "Invalid type")

    # Accept token via query param (browser vid.src) OR Authorization header
    auth = request.headers.get("authorization", "")
    tok = (auth[7:] if auth.startswith("Bearer ") else None) or token
    if not tok:
        raise HTTPException(401, "Authentication required")
    db = get_db()
    try:
        user = user_by_token(db, tok)
        if not user:
            raise HTTPException(401, "Invalid or expired session")
        conn = active_conn(db, user["id"])
    finally:
        db.close()

    base = conn["server"].rstrip("/")
    u, p = conn["xtream_username"], conn["xtream_password"]
    if type == "live":
        src = f"{base}/live/{u}/{p}/{stream_id}.m3u8"
    elif type == "movie":
        src = f"{base}/movie/{u}/{p}/{stream_id}.{ext}"
    else:
        src = f"{base}/series/{u}/{p}/{stream_id}.{ext}"

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        raise HTTPException(503, "ffmpeg not installed — run: sudo apt install ffmpeg")

    # No shell=True; each list element is a distinct argv — safe from injection
    cmd = [ffmpeg_path, "-hide_banner", "-loglevel", "error"]
    # Input-side seek: fast for remote files (server seeks before sending data)
    if start > 0:
        cmd += ["-ss", str(start)]
    cmd += [
        "-fflags", "nobuffer+genpts",
        "-analyzeduration", "500000",
        "-i", src,
        "-map", "0:v:0?", "-map", "0:a:0?",
        "-c:v", "copy",
        "-c:a", "aac", "-ac", "2", "-b:a", "192k",
        "-f", "mp4",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "pipe:1",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    async def gen():
        try:
            while chunk := await proc.stdout.read(32768):
                yield chunk
        finally:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass

    return StreamingResponse(
        gen(),
        media_type="video/mp4",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Static files + SPA fallback (must be last) ────────────────────────────────

app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    return FileResponse("static/index.html")

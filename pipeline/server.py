#!/usr/bin/env python3
"""
EchoStage 本地导入助手
=====================
一个不依赖第三方包的本地 HTTP 小服务，用于：
  - 读取网易云 / QQ 音乐 / Spotify 歌单元数据
  - 代理平台允许的 30 秒试听音频（不缓存、不写入磁盘）
  - 为浏览器原型提供 CORS

启动：
    python pipeline/server.py
    # http://127.0.0.1:8787

注意：
  - 默认只监听 127.0.0.1，不要把它暴露到公网。
  - 平台接口可能随时变更；本项目不绕过任何登录、付费或 DRM 限制。
  - 音频只应在你拥有版权或平台明确允许试听的范围内使用。
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from providers import PROVIDERS, find_provider  # noqa: E402
from providers.base import ProviderError  # noqa: E402

VERSION = "0.1.0"
HOST = os.environ.get("ECHOSTAGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("ECHOSTAGE_PORT", "8787"))
MAX_AUDIO_BYTES = 20 * 1024 * 1024
ALLOWED_AUDIO_HOSTS = (
    "music.126.net",
    "qqmusic.qq.com",
    "scdn.co",
    "spotifycdn.com",
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
REFERERS = {
    "music.126.net": "https://music.163.com/",
    "qqmusic.qq.com": "https://y.qq.com/",
    "scdn.co": "https://open.spotify.com/",
    "spotifycdn.com": "https://open.spotify.com/",
}


def host_allowed(host: str) -> bool:
    host = (host or "").lower().split(":")[0]
    return any(host == allowed or host.endswith("." + allowed) for allowed in ALLOWED_AUDIO_HOSTS)


def referer_for(host: str) -> str:
    host = (host or "").lower()
    for suffix, ref in REFERERS.items():
        if host == suffix or host.endswith("." + suffix):
            return ref
    return "https://127.0.0.1/"


class Handler(BaseHTTPRequestHandler):
    server_version = f"EchoStageCompanion/{VERSION}"

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")

    def _json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _error(self, message: str, status: int = 400):
        self._json({"error": message}, status)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/api"):
            self._json({
                "name": "EchoStage Companion",
                "version": VERSION,
                "endpoints": ["/api/health", "/api/playlist?url=", "/api/audio?url="],
            })
            return
        if path == "/api/health":
            self._json({
                "ok": True,
                "version": VERSION,
                "platforms": [p.name for p in PROVIDERS],
                "netEaseCookie": bool(os.environ.get("NETEASE_COOKIE")),
                "spotify": bool(os.environ.get("SPOTIFY_CLIENT_ID") and os.environ.get("SPOTIFY_CLIENT_SECRET")),
            })
            return
        if path == "/api/playlist":
            url = (qs.get("url") or [""])[0].strip()
            if not url:
                self._error("缺少 url 参数")
                return
            try:
                provider = find_provider(url)
                playlist = provider.fetch(url)
                self._json(playlist.to_dict())
            except ProviderError as exc:
                self._error(str(exc), 400)
            except Exception as exc:  # noqa: BLE001
                self._error(f"读取失败：{exc}", 500)
            return
        if path == "/api/audio":
            self._proxy_audio((qs.get("url") or [""])[0].strip())
            return
        self._error("Not found", 404)

    def _proxy_audio(self, url: str):
        if not url:
            self._error("缺少 url 参数")
            return
        parsed = urllib.parse.urlparse(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            self._error("只支持 http(s) 音频地址")
            return
        if not host_allowed(parsed.hostname):
            self._error(f"音频域名不在白名单：{parsed.hostname}")
            return
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Referer": referer_for(parsed.hostname),
                "Accept": "audio/*,*/*;q=0.8",
                "Range": "bytes=0-",
            },
        )
        try:
            resp = urllib.request.urlopen(req, timeout=20)
        except Exception as exc:  # noqa: BLE001
            self._error(f"音频代理失败：{exc}", 502)
            return
        with resp:
            final_host = urllib.parse.urlparse(resp.geturl()).hostname
            if not host_allowed(final_host or ""):
                self._error("重定向到了非白名单域名", 502)
                return
            ctype = resp.headers.get("Content-Type", "audio/mpeg")
            if "text/html" in ctype or "application/json" in ctype:
                self._error("平台没有返回音频（可能需要登录或该曲目无试听）", 502)
                return
            length = resp.headers.get("Content-Length")
            if length and int(length) > MAX_AUDIO_BYTES:
                self._error("音频超过 20MB 限制", 413)
                return
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            if length:
                self.send_header("Content-Length", length)
            self.send_header("Accept-Ranges", "none")
            self._cors()
            self.end_headers()
            sent = 0
            try:
                while True:
                    chunk = resp.read(64 * 1024)
                    if not chunk:
                        break
                    sent += len(chunk)
                    if sent > MAX_AUDIO_BYTES:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, fmt, *args):
        print(f"[companion] {self.address_string()} {fmt % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("EchoStage Companion")
    print(f"  → http://{HOST}:{PORT}")
    print(f"  平台：{', '.join(p.label for p in PROVIDERS)}")
    print("  浏览器原型默认在 http://127.0.0.1:8777")
    print("  Ctrl+C 退出")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

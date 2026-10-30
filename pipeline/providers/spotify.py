"""Spotify 官方 Web API 歌单读取。

需要环境变量：
  SPOTIFY_CLIENT_ID
  SPOTIFY_CLIENT_SECRET
"""

from __future__ import annotations

import base64
import os
import re
import urllib.parse
import urllib.request

from .base import Playlist, PlaylistProvider, ProviderError, Track, http_json


class SpotifyProvider(PlaylistProvider):
    name = "spotify"
    label = "Spotify"
    patterns = (r"open\.spotify\.com", r"spotify\.link")

    def _extract_id(self, url: str) -> str:
        m = re.search(r"playlist/([A-Za-z0-9]+)", url)
        if not m:
            raise ProviderError("无法解析 Spotify 歌单链接")
        return m.group(1)

    def _token(self) -> str:
        client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
        client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "").strip()
        if not client_id or not client_secret:
            raise ProviderError("未配置 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET")
        basic = base64.b64encode(f"{client_id}:{client_secret}".encode()).decode()
        req = urllib.request.Request(
            "https://accounts.spotify.com/api/token",
            data=b"grant_type=client_credentials",
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                import json
                return json.loads(resp.read().decode())["access_token"]
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"Spotify 鉴权失败：{exc}") from exc

    def fetch(self, url: str) -> Playlist:
        if "spotify.link" in url:
            raise ProviderError("请展开 spotify.link 短链后再导入（浏览器打开后复制完整链接）")
        playlist_id = self._extract_id(url)
        token = self._token()
        headers = {"Authorization": f"Bearer {token}"}
        info = http_json(
            f"https://api.spotify.com/v1/playlists/{playlist_id}?fields=name,images,external_urls",
            headers=headers,
        )
        tracks: list[Track] = []
        next_url = f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks?limit=100"
        while next_url:
            page = http_json(next_url, headers=headers)
            for row in page.get("items") or []:
                item = row.get("track")
                if not item:
                    continue
                artists = " / ".join(a.get("name", "") for a in item.get("artists") or [])
                images = (item.get("album") or {}).get("images") or []
                tracks.append(
                    Track(
                        title=item.get("name", "未命名"),
                        artist=artists,
                        album=(item.get("album") or {}).get("name", ""),
                        duration=round((item.get("duration_ms") or 0) / 1000, 1),
                        cover=images[0]["url"] if images else "",
                        platform=self.name,
                        id=item.get("id", ""),
                        preview_url=item.get("preview_url"),
                    )
                )
                if len(tracks) >= 200:
                    break
            next_url = page.get("next")
            if len(tracks) >= 200:
                break
        if not tracks:
            raise ProviderError("歌单为空")
        images = info.get("images") or []
        return Playlist(
            title=info.get("name") or "Spotify 歌单",
            platform=self.name,
            cover=images[0]["url"] if images else "",
            tracks=tracks,
            source_url=url,
        )

"""网易云音乐歌单元数据读取（非官方 Web 接口，仅个人使用）。

说明：
- 只读取歌单标题、曲目名、艺人、专辑、封面与时长；
- 不解析、不下载、不绕过任何版权保护；
- 音频播放必须走用户自己的客户端 / 账号权限，或使用本地文件。
"""

from __future__ import annotations

import os
import re
from urllib.parse import parse_qs, urlparse

from .base import Playlist, PlaylistProvider, ProviderError, Track, http_json


class NeteaseProvider(PlaylistProvider):
    name = "netease"
    label = "网易云音乐"
    patterns = (r"music\.163\.com", r"y\.music\.163\.com", r"163cn\.tv")

    def _extract_id(self, url: str) -> str:
        url = url.strip()
        if re.fullmatch(r"\d+", url):
            return url
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        for key in ("id", "playlistId"):
            if key in qs and qs[key]:
                return qs[key][0]
        m = re.search(r"(?:playlist|discover/toplist)[/?#].*?(\d{3,})", url)
        if m:
            return m.group(1)
        m = re.search(r"/(\d{3,})(?:[/?#]|$)", url)
        if m:
            return m.group(1)
        raise ProviderError("无法从链接中解析网易云歌单 ID")

    def fetch(self, url: str) -> Playlist:
        playlist_id = self._extract_id(url)
        headers = {
            "Referer": "https://music.163.com/",
            "Origin": "https://music.163.com",
        }
        cookie = os.environ.get("NETEASE_COOKIE", "").strip()
        if cookie:
            headers["Cookie"] = cookie
        # n=1000 让接口返回完整曲目列表；匿名访问通常也能拿到元数据。
        api = f"https://music.163.com/api/v6/playlist/detail?id={playlist_id}&n=1000&s=0"
        data = http_json(api, headers=headers)
        if data.get("code") != 200 or "playlist" not in data:
            raise ProviderError(f"网易云接口返回异常：code={data.get('code')}")
        pl = data["playlist"]
        tracks: list[Track] = []
        for item in pl.get("tracks") or []:
            artists = " / ".join(a.get("name", "") for a in (item.get("ar") or []) if a.get("name"))
            album = (item.get("al") or {}).get("name", "")
            cover = (item.get("al") or {}).get("picUrl", "")
            if cover.startswith("http://"):
                cover = "https://" + cover[len("http://"):]
            tracks.append(
                Track(
                    title=item.get("name", "未命名"),
                    artist=artists,
                    album=album,
                    duration=round((item.get("dt") or 0) / 1000, 1),
                    cover=cover,
                    platform=self.name,
                    id=str(item.get("id", "")),
                    preview_url=None,  # 不抓取版权音频
                    meta={"fee": item.get("fee"), "mv": item.get("mv")},
                )
            )
        if not tracks:
            raise ProviderError("歌单为空，或平台要求登录后查看")
        cover = pl.get("coverImgUrl", "")
        if cover.startswith("http://"):
            cover = "https://" + cover[len("http://"):]
        return Playlist(
            title=pl.get("name", "网易云歌单"),
            platform=self.name,
            cover=cover,
            tracks=tracks,
            source_url=url,
        )

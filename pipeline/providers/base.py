"""歌单 Provider 基类与通用数据结构。"""

from __future__ import annotations

import json
import re
import urllib.request
from dataclasses import dataclass, asdict, field
from typing import Optional


class ProviderError(RuntimeError):
    """平台接口不可用、需要登录或链接不合法。"""


@dataclass
class Track:
    title: str
    artist: str = ""
    album: str = ""
    duration: float = 0.0
    cover: str = ""
    platform: str = ""
    id: str = ""
    preview_url: Optional[str] = None
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Playlist:
    title: str
    platform: str
    cover: str = ""
    tracks: list[Track] = field(default_factory=list)
    source_url: str = ""

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "platform": self.platform,
            "cover": self.cover,
            "sourceUrl": self.source_url,
            "tracks": [t.to_dict() for t in self.tracks],
        }


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}


def http_json(url: str, headers: dict | None = None, timeout: float = 15) -> dict:
    req = urllib.request.Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
    except Exception as exc:  # noqa: BLE001
        raise ProviderError(f"请求平台接口失败：{exc}") from exc
    try:
        return json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError as exc:
        raise ProviderError("平台返回了非 JSON 数据，接口可能已变更") from exc


class PlaylistProvider:
    name = "base"
    label = "Base"
    patterns: tuple[str, ...] = ()

    def matches(self, url: str) -> bool:
        return any(re.search(p, url) for p in self.patterns)

    def fetch(self, url: str) -> Playlist:  # pragma: no cover - interface
        raise NotImplementedError

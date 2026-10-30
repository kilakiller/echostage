"""平台 Provider 注册表。"""

from .base import PlaylistProvider, ProviderError
from .netease import NeteaseProvider
from .qq import QQProvider
from .spotify import SpotifyProvider

PROVIDERS: list[PlaylistProvider] = [
    NeteaseProvider(),
    QQProvider(),
    SpotifyProvider(),
]


def find_provider(url: str) -> PlaylistProvider:
    for provider in PROVIDERS:
        if provider.matches(url):
            return provider
    raise ProviderError("暂不支持这个链接。可选：网易云 / QQ 音乐 / Spotify 歌单。")


__all__ = ["PROVIDERS", "find_provider", "ProviderError"]

"""QQ 音乐歌单元数据读取（非官方接口，仅元数据）。"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

from .base import Playlist, PlaylistProvider, ProviderError, Track, http_json


class QQProvider(PlaylistProvider):
    name = "qq"
    label = "QQ 音乐"
    patterns = (r"y\.qq\.com", r"i\.y\.qq\.com", r"c\.y\.qq\.com")

    def _extract_id(self, url: str) -> str:
        url = url.strip()
        if re.fullmatch(r"\d+", url):
            return url
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        for key in ("disstid", "id"):
            if key in qs and qs[key]:
                return qs[key][0]
        m = re.search(r"/playlist/(\d+)", url)
        if m:
            return m.group(1)
        m = re.search(r"(\d{5,})", url)
        if m:
            return m.group(1)
        raise ProviderError("无法从链接中解析 QQ 音乐歌单 ID")

    def fetch(self, url: str) -> Playlist:
        playlist_id = self._extract_id(url)
        api = (
            "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg"
            f"?type=1&json=1&utf8=1&disstid={playlist_id}&g_tk=5381&loginUin=0"
            "&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0"
            "&platform=yqq.json&needNewCode=0"
        )
        data = http_json(api, headers={"Referer": "https://y.qq.com/"})
        cdlist = data.get("cdlist") or []
        if not cdlist:
            raise ProviderError("QQ 音乐未返回歌单，可能链接不公开或接口已变更")
        cd = cdlist[0]
        tracks: list[Track] = []
        for item in cd.get("songlist") or []:
            album_mid = (item.get("albummid") or "").strip()
            cover = (
                f"https://y.gtimg.cn/music/photo_new/T002R300x300M000{album_mid}.jpg"
                if album_mid
                else ""
            )
            artists = " / ".join(
                s.get("name", "") for s in (item.get("singer") or []) if s.get("name")
            )
            tracks.append(
                Track(
                    title=item.get("songname") or item.get("title") or "未命名",
                    artist=artists,
                    album=item.get("albumname") or "",
                    duration=float(item.get("interval") or 0),
                    cover=cover,
                    platform=self.name,
                    id=str(item.get("songmid") or item.get("songid") or ""),
                    preview_url=None,
                )
            )
        if not tracks:
            raise ProviderError("歌单为空")
        return Playlist(
            title=cd.get("dissname") or "QQ 音乐歌单",
            platform=self.name,
            cover=cd.get("logo") or "",
            tracks=tracks,
            source_url=url,
        )

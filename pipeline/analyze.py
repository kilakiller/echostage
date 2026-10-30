#!/usr/bin/env python3
"""
EchoStage 离线高精度分析管线（参考实现）
=========================================
把音频拆成鼓 / 贝斯 / 吉他 / 键盘 / 主旋律，输出 PerformanceScore JSON。

依赖：
  pip install -r pipeline/requirements.txt
  # 可选：demucs, basic-pitch, praat-parselmouth

用法：
  python pipeline/analyze.py song.mp3 --out song.score.json
  python pipeline/analyze.py song.mp3 --no-demucs --out song.score.json
  python pipeline/analyze.py ./album/ --out ./scores/
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Iterable

try:
    import numpy as np
    import librosa
except ImportError as exc:  # pragma: no cover
    print("缺少依赖：pip install -r pipeline/requirements.txt", file=sys.stderr)
    raise SystemExit(1) from exc

AUDIO_EXT = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff", ".aif"}
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = [0, 4, 7]
MINOR = [0, 3, 7]
SECTION_CN = {"INTRO": "拆解", "VERSE": "声部", "CHORUS": "复制", "BREAK": "故障", "OUTRO": "回声"}


# ---------------------------------------------------------------------------
# 基础
# ---------------------------------------------------------------------------

def midi_name(m: int) -> str:
    return f"{NAMES[m % 12]}{m // 12 - 1}"


def load_audio(path: Path, sr: int = 22050) -> tuple[np.ndarray, int]:
    y, sr = librosa.load(str(path), sr=sr, mono=True)
    if y.size == 0:
        raise RuntimeError(f"无法读取音频：{path}")
    peak = float(np.max(np.abs(y))) or 1.0
    return y / peak, sr


def beat_grid(y: np.ndarray, sr: int) -> tuple[float, np.ndarray]:
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=512, trim=False)
    tempo = float(np.atleast_1d(tempo)[0])
    if tempo < 30 or tempo > 240:
        tempo = 120.0
    beats = librosa.frames_to_time(frames, sr=sr, hop_length=512)
    if len(beats) < 4:
        step = 60.0 / tempo
        beats = np.arange(0, len(y) / sr, step)
    return tempo, beats


def sectionize(y: np.ndarray, sr: int, tempo: float, duration: float) -> list[dict]:
    bar = 60.0 / tempo * 4
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=512)[0]
    times = librosa.times_like(rms, sr=sr, hop_length=512)
    bars = []
    for i in range(max(1, math.ceil(duration / bar))):
        t0, t1 = i * bar, min(duration, (i + 1) * bar)
        mask = (times >= t0) & (times < t1)
        bars.append(float(np.mean(rms[mask])) if np.any(mask) else 0.0)
    if not bars:
        return [{"t": 0, "end": duration, "label": "VERSE", "cn": "声部", "energy": 0.5}]
    peak = max(bars) or 1.0
    bars_n = [b / peak for b in bars]
    # 以 4 小节为乐句，能量最高段视为副歌
    sections = []
    n_blocks = max(1, math.ceil(len(bars) / 4))
    for b in range(n_blocks):
        i0, i1 = b * 4, min(len(bars), (b + 1) * 4)
        energy = float(np.mean(bars_n[i0:i1])) if i1 > i0 else 0.0
        sections.append({
            "t": round(i0 * bar, 3),
            "end": round(min(duration, i1 * bar), 3),
            "energy": round(energy, 2),
        })
    max_i = max(range(len(sections)), key=lambda i: sections[i]["energy"])
    for i, s in enumerate(sections):
        if i == max_i and s["energy"] > 0.45:
            s["label"] = "CHORUS"
        elif i == 0:
            s["label"] = "INTRO" if s["energy"] < 0.45 else "VERSE"
        elif i == len(sections) - 1:
            s["label"] = "OUTRO" if s["energy"] < 0.55 else "VERSE"
        else:
            s["label"] = "VERSE"
        s["cn"] = SECTION_CN[s["label"]]
    return sections


# ---------------------------------------------------------------------------
# 音高 → 音符
# ---------------------------------------------------------------------------

def pyin_notes(y: np.ndarray, sr: int, fmin: float, fmax: float, min_dur: float = 0.09) -> list[dict]:
    hop = 256
    f0, voiced, prob = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, frame_length=2048, hop_length=hop,
        fill_na=np.nan, max_transition_rate=40,
    )
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    notes: list[dict] = []
    group = None
    for t, f, v, p in zip(times, f0, voiced, prob):
        ok = bool(v) and np.isfinite(f) and p >= 0.45
        midi = 69 + 12 * math.log2(f / 440) if ok else None
        if not ok:
            if group:
                notes.append(group)
                group = None
            continue
        if group is None:
            group = {"t": float(t), "end": float(t + hop / sr), "m": float(midi), "conf": float(p)}
        elif abs(midi - group["m"]) <= 0.8 and t - group["end"] <= 0.08:
            group["end"] = float(t + hop / sr)
            group["conf"] = max(group["conf"], float(p))
        else:
            notes.append(group)
            group = {"t": float(t), "end": float(t + hop / sr), "m": float(midi), "conf": float(p)}
    if group:
        notes.append(group)
    out = []
    for n in notes:
        dur = n["end"] - n["t"]
        if dur < min_dur:
            continue
        out.append({
            "t": round(n["t"], 3),
            "dur": round(dur, 3),
            "midi": int(round(n["m"])),
            "velocity": round(min(1.0, 0.45 + n["conf"] * 0.35), 2),
            "confidence": round(n["conf"], 2),
        })
    return out


def basic_pitch_notes(path: Path, min_dur: float = 0.06) -> list[dict]:
    try:
        from basic_pitch.inference import predict
    except ImportError:
        return []
    try:
        _, _, events = predict(str(path))
    except Exception as exc:  # noqa: BLE001
        print(f"  ! Basic Pitch 失败：{exc}")
        return []
    notes = []
    for ev in events:
        start, end, pitch, velocity, _bend = ev
        if end - start < min_dur:
            continue
        notes.append({
            "t": round(float(start), 3),
            "dur": round(float(end - start), 3),
            "midi": int(pitch),
            "velocity": round(float(np.clip(velocity, 0.05, 1.0)), 2),
        })
    return notes


def add_vibrato(notes: list[dict], y: np.ndarray, sr: int) -> None:
    hop = 256
    try:
        f0, voiced, prob = librosa.pyin(y, fmin=100, fmax=1200, sr=sr, frame_length=2048, hop_length=hop)
    except Exception:
        return
    times = librosa.times_like(f0, sr=sr, hop_length=hop)
    for n in notes:
        mask = (times >= n["t"] + 0.05) & (times <= n["t"] + n["dur"] - 0.03) & voiced & np.isfinite(f0)
        if np.sum(mask) < 8 or n["dur"] < 0.4:
            continue
        midi = 69 + 12 * np.log2(f0[mask] / 440)
        dev = midi - np.mean(midi)
        std = float(np.std(dev))
        if std > 0.09:
            n["fx"] = {"vibrato": {"rate": 5.4, "depth": round(min(std, 0.6), 2)}}


def drums_from_onsets(y: np.ndarray, sr: int) -> list[dict]:
    hop = 256
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=2048)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=hop)[0]
    onset_env = librosa.onset.onset_strength(S=librosa.amplitude_to_db(S, ref=np.max), sr=sr, hop_length=hop)
    frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=hop, units="frames")
    notes = []
    for f in frames:
        i0, i1 = max(0, f - 1), min(S.shape[1], f + 2)
        spec = np.mean(S[:, i0:i1], axis=1)
        total = float(np.sum(spec)) or 1.0
        centroid = float(np.sum(freqs * spec) / total)
        kick = float(np.sum(spec[(freqs >= 40) & (freqs < 160)]))
        snare = float(np.sum(spec[(freqs >= 400) & (freqs < 2500)]))
        hat = float(np.sum(spec[(freqs >= 6000) & (freqs < 14000)]))
        t = float(librosa.frames_to_time(f, sr=sr, hop_length=hop))
        if centroid < 900 and kick > snare * 0.7:
            midi, drum = 36, "kick"
        elif hat > snare * 1.2 and centroid > 5000:
            midi, drum = 42, "hat"
        elif centroid > 1800:
            midi, drum = 38, "snare"
        else:
            midi, drum = 36, "kick"
        notes.append({
            "t": round(t, 3), "dur": 0.1, "midi": midi, "drum": drum,
            "velocity": round(float(np.clip(0.35 + rms[min(len(rms) - 1, f)] * 2.5, 0.2, 1)), 2),
        })
    return notes


# ---------------------------------------------------------------------------
# 和弦
# ---------------------------------------------------------------------------

def detect_chords(y: np.ndarray, sr: int, beats: np.ndarray, bass_notes: list[dict]) -> list[dict]:
    hop = 512
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=hop, bins_per_octave=36)
    times = librosa.times_like(chroma, sr=sr, hop_length=hop)
    duration = len(y) / sr
    beat_dur = float(np.median(np.diff(beats))) if len(beats) > 2 else 0.5
    step = max(0.5, min(2.0, beat_dur * 2))
    template_list = []
    for root in range(12):
        template_list.append((root, "maj", MAJOR, NAMES[root]))
        template_list.append((root, "min", MINOR, NAMES[root] + "m"))

    out = []
    t = 0.0
    while t < duration:
        t1 = min(duration, t + step)
        if t1 - t < 0.2:
            break
        mask = (times >= t) & (times < t1)
        if not np.any(mask):
            t = t1
            continue
        vec = np.mean(chroma[:, mask], axis=1)
        vec = vec / (np.sum(vec) + 1e-9)
        bass_pc = -1
        for n in bass_notes:
            if n["t"] <= t + 0.1 <= n["t"] + n["dur"]:
                bass_pc = n["midi"] % 12
                break
        best = (-1e9, None)
        for root, quality, intervals, name in template_list:
            score = 0.0
            inside = 0.0
            outside = 0.0
            for pc in range(12):
                rel = (pc - root) % 12
                if rel in intervals:
                    score += vec[pc] * (1.0 if rel == 0 else 0.82)
                    inside += vec[pc]
                else:
                    outside += vec[pc]
            score -= outside * 0.4
            if bass_pc == root:
                score += 0.25
            if score > best[0]:
                best = (score, (root, quality, name))
        root, quality, name = best[1]
        out.append({"t": round(t, 3), "dur": round(t1 - t, 3), "root": root, "quality": quality, "name": name, "confidence": 0.6})
        t = t1
    merged = []
    for c in out:
        if merged and merged[-1]["name"] == c["name"] and abs(merged[-1]["t"] + merged[-1]["dur"] - c["t"]) < 0.01:
            merged[-1]["dur"] = round(merged[-1]["dur"] + c["dur"], 3)
        else:
            merged.append(c)
    return merged


# ---------------------------------------------------------------------------
# 分离与主流程
# ---------------------------------------------------------------------------

def run_demucs(path: Path, outdir: Path) -> dict[str, Path]:
    if shutil.which("demucs") is None:
        try:
            import demucs  # noqa: F401
        except ImportError:
            print("  ! 未安装 demucs，跳过源分离")
            return {}
    outdir.mkdir(parents=True, exist_ok=True)
    cmd = [sys.executable, "-m", "demucs.separate", "-n", "htdemucs_6s", "-o", str(outdir), str(path)]
    print("  · Demucs 分离中…")
    subprocess.run(cmd, check=True)
    stem_dir = outdir / "htdemucs_6s" / path.stem
    mapping = {}
    for name in ("drums", "bass", "guitar", "piano", "vocals", "other"):
        p = stem_dir / f"{name}.wav"
        if p.exists():
            mapping[name] = p
    return mapping


def analyze(path: Path, outdir: Path | None, use_demucs: bool) -> dict:
    print(f"\n▶ {path.name}")
    y, sr = load_audio(path)
    duration = len(y) / sr
    tempo, beats = beat_grid(y, sr)
    print(f"  · {tempo:.1f} BPM · {duration:.1f}s")

    stems = run_demucs(path, outdir / "_stems" if outdir else Path(tempfile.mkdtemp())) if use_demucs else {}
    drums = drums_from_onsets(stems.get("drums") and librosa.load(str(stems["drums"]), sr=sr)[0] or y, sr)
    bass_y = librosa.load(str(stems["bass"]), sr=sr)[0] if "bass" in stems else librosa.effects.preemphasis(y)
    lead_y = librosa.load(str(stems["vocals"]), sr=sr)[0] if "vocals" in stems else y
    bass = pyin_notes(bass_y, sr, fmin=35, fmax=320, min_dur=0.1)
    lead = pyin_notes(lead_y, sr, fmin=150, fmax=1200, min_dur=0.1)
    add_vibrato(lead, lead_y, sr)

    guitar: list[dict] = []
    keys: list[dict] = []
    if "guitar" in stems:
        guitar = basic_pitch_notes(stems["guitar"])
    if "piano" in stems:
        keys = basic_pitch_notes(stems["piano"])
    if not guitar and not keys:
        # 没有分离 / Basic Pitch 时，用和弦生成占位声部（明确标记 inferred）
        pass

    harmony = detect_chords(y, sr, beats, bass)
    sections = sectionize(y, sr, tempo, duration)

    # 和弦推断键盘 / 吉他声部（无模型时的兜底）
    for c in harmony:
        root = c["root"]
        intervals = MINOR if c["quality"] == "min" else MAJOR
        base = 60 + ((root - 0) % 12)
        voicing = [base + i for i in intervals] + [base + 12]
        if not keys:
            for midi in voicing:
                keys.append({"t": c["t"], "dur": max(0.12, c["dur"] * 0.9), "midi": midi, "velocity": 0.4, "fx": {"pad": True}})
        if not guitar:
            for midi in [36 + root, 43 + root, 48 + root]:
                guitar.append({"t": c["t"], "dur": 0.2, "midi": midi, "velocity": 0.55, "fx": {"distortion": True}})

    tracks = [
        {"id": "drums", "instrument": "drums", "label": "鼓组", "color": "#ff6b4a", "notes": drums, "confidence": 0.7, "inference": False},
        {"id": "bass", "instrument": "bass", "label": "贝斯", "color": "#4d7cff", "notes": bass, "confidence": 0.7, "inference": False},
        {"id": "guitar", "instrument": "guitar", "label": "电吉他", "color": "#ff4f8b", "notes": guitar, "confidence": 0.55, "inference": not bool(stems.get("guitar"))},
        {"id": "keys", "instrument": "keys", "label": "键盘", "color": "#79f2c0", "notes": keys, "confidence": 0.55, "inference": not bool(stems.get("piano"))},
        {"id": "lead", "instrument": "lead", "label": "主旋律", "color": "#ffd166", "notes": lead, "confidence": 0.6, "inference": False},
    ]
    for t in tracks:
        t["notes"].sort(key=lambda n: n["t"])

    return {
        "version": 1,
        "meta": {
            "title": path.stem,
            "artist": "",
            "duration": round(duration, 3),
            "bpm": round(tempo, 1),
            "key": "",
            "timeSignature": [4, 4],
            "source": "离线分析",
            "engine": "EchoStage Offline Pipeline (reference)",
            "quality": 0.7,
            "analyzedAt": "",
        },
        "beats": [round(float(b), 3) for b in beats],
        "sections": sections,
        "harmony": harmony,
        "tracks": tracks,
        "stats": {
            "totalNotes": sum(len(t["notes"]) for t in tracks),
            "drums": len(drums), "bass": len(bass), "lead": len(lead),
            "guitar": len(guitar), "keys": len(keys), "sections": len(sections),
        },
    }


def iter_inputs(path: Path) -> Iterable[Path]:
    if path.is_file():
        yield path
        return
    for p in sorted(path.rglob("*")):
        if p.suffix.lower() in AUDIO_EXT:
            yield p


def main() -> None:
    ap = argparse.ArgumentParser(description="EchoStage 离线分析")
    ap.add_argument("input", type=Path, help="音频文件或目录")
    ap.add_argument("--out", type=Path, default=None, help="输出 JSON 文件或目录")
    ap.add_argument("--no-demucs", action="store_true", help="跳过 Demucs 分离（快速）")
    args = ap.parse_args()

    if not args.input.exists():
        raise SystemExit(f"找不到：{args.input}")
    files = list(iter_inputs(args.input))
    if not files:
        raise SystemExit("没有找到音频文件")

    out_is_dir = len(files) > 1 or (args.out and (args.out.suffix == "" or args.out.is_dir()))
    if args.out and out_is_dir:
        args.out.mkdir(parents=True, exist_ok=True)

    for f in files:
        score = analyze(f, args.out if out_is_dir else None, not args.no_demucs)
        if args.out:
            dest = args.out / f"{f.stem}.echostage.json" if out_is_dir else args.out
        else:
            dest = f.with_suffix(".echostage.json")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(score, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"  ✓ {dest} · {score['stats']['totalNotes']} notes")


if __name__ == "__main__":
    main()

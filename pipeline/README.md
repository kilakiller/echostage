# EchoStage 离线分析管线（参考实现）

这条管线把一首歌拆成 **鼓 / 贝斯 / 吉他 / 键盘 / 主旋律** 五个声部，并输出与 Web 原型一致的 `PerformanceScore` JSON。

## 安装

```bash
cd MusicStage3D
python -m venv .venv
# Windows
.venv\Scripts\activate
pip install -r pipeline/requirements.txt

# 可选：更高精度的分离 / 转写
pip install demucs basic-pitch praat-parselmouth
# YourMT3+ / ADTOF 建议按官方仓库单独安装（需要 PyTorch + GPU）
```

系统还需要 `ffmpeg` 在 PATH 中。

## 运行

```bash
# 快速模式：不分离，直接做节拍 / 和弦 / 音高 / 鼓点
python pipeline/analyze.py song.mp3 --no-demucs --out song.score.json

# 完整模式：Demucs 6 轨分离 + Basic Pitch 转写
python pipeline/analyze.py song.mp3 --out song.score.json --stems stems/

# 批量
python pipeline/analyze.py playlist_folder/ --out scores/
```

## 模型分工（生产建议）

| 任务 | 参考实现 | 生产建议 |
|---|---|---|
| 源分离 | Demucs `htdemucs_6s` | MelBand RoFormer / Demucs v4 |
| 鼓 | librosa onset + 频段分类 | ADTOF / 自训练 CNN |
| 贝斯 | `pyin` / Basic Pitch | Basic Pitch + 音域约束 |
| 吉他 | Basic Pitch | MT3 / YourMT3+ |
| 键盘 | Basic Pitch | Onsets and Frames / YourMT3+ |
| 主旋律 | `pyin` + 颤音分析 | CREPE + parselmouth |
| 和弦 | chroma + 模板 | 和弦语言模型 / 神经网络 |
| 乐器识别 | 分轨先验 | CLAP embedding + 分类器 |

## 输出

`PerformanceScore` 的字段与 `web/js/analysis.js` 一致：

```json
{
  "version": 1,
  "meta": { "title": "...", "bpm": 120, "key": "A minor", "duration": 32 },
  "tracks": [
    { "id": "drums", "instrument": "drums", "notes": [{ "t": 0, "dur": 0.12, "midi": 36, "velocity": 0.9, "drum": "kick" }] },
    { "id": "bass", "instrument": "bass", "notes": [{ "t": 0.5, "dur": 0.4, "midi": 33, "velocity": 0.7 }] }
  ],
  "harmony": [{ "t": 0, "dur": 2, "name": "Am", "root": 9, "quality": "min" }],
  "sections": [{ "t": 0, "end": 8, "label": "INTRO", "cn": "拆解" }],
  "beats": [0, 0.5, 1.0]
}
```

## 质量说明

- 这里的转写是 **参考实现**，用于验证数据协议和 3D 映射；复杂混音需要上表中的专用模型。
- 生产环境应缓存分轨、音高轨迹和最终乐谱；同一首歌不要重复跑 GPU。
- 任何情况下都不要把平台版权音频写入长期存储或对外分发。

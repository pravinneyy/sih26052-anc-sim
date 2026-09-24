"""
Audio I/O, dataset indexing, and lightweight detection helpers for the
CRN/GRU enhancement pipeline.
"""

from __future__ import annotations

import csv
import math
import wave
from pathlib import Path
from typing import Iterable, List, Optional, Sequence, Tuple

import numpy as np

from ml_audio_model import NOISE_TO_ID


AUDIO_EXTS = {".wav", ".wave", ".flac", ".ogg", ".mp3", ".m4a"}

MAD_CLASS_ID_TO_NAME = {
    # Official MAD order: communication, shooting, footsteps, shelling,
    # vehicle, helicopter, fighter.
    "0": "communication",
    "1": "shooting",
    "2": "footsteps",
    "3": "shelling",
    "4": "vehicle",
    "5": "helicopter",
    "6": "fighter",
}

MAD_LABEL_TO_NOISE = {
    "shooting": "impulsive",
    "gunshot": "impulsive",
    "gun": "impulsive",
    "shot": "impulsive",
    "shelling": "impulsive",
    "explosion": "impulsive",
    "blast": "impulsive",
    "artillery": "impulsive",
    "vehicle": "stationary",
    "tank": "stationary",
    "engine": "stationary",
    "helicopter": "non_stationary",
    "fighter": "non_stationary",
    "jet": "non_stationary",
    "footsteps": "non_stationary",
    "footstep": "non_stationary",
    # MAD has a communication class. It is not a clean speech target, so the
    # noise indexer skips it unless a separate script chooses to use it.
    "communication": None,
    "comm": None,
}


def iter_audio_files(root: str | Path) -> List[Path]:
    root = Path(root)
    if root.is_file() and root.suffix.lower() in AUDIO_EXTS:
        return [root]
    if not root.exists():
        return []
    return sorted(p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in AUDIO_EXTS)


def _try_soundfile(path: Path):
    try:
        import soundfile as sf  # type: ignore
    except Exception:
        return None
    try:
        data, sr = sf.read(str(path), always_2d=True, dtype="float32")
    except Exception:
        return None
    return data.mean(axis=1).astype(np.float32), int(sr)


def _read_wav_stdlib(path: Path) -> Tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as f:
        channels = f.getnchannels()
        sr = f.getframerate()
        width = f.getsampwidth()
        frames = f.readframes(f.getnframes())

    if width == 1:
        arr = np.frombuffer(frames, dtype=np.uint8).astype(np.float32)
        arr = (arr - 128.0) / 128.0
    elif width == 2:
        arr = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    elif width == 3:
        raw = np.frombuffer(frames, dtype=np.uint8).reshape(-1, 3)
        vals = raw[:, 0].astype(np.int32) | (raw[:, 1].astype(np.int32) << 8) | (raw[:, 2].astype(np.int32) << 16)
        vals = np.where(vals & 0x800000, vals | ~0xFFFFFF, vals)
        arr = vals.astype(np.float32) / 8388608.0
    elif width == 4:
        arr = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {width}")

    if channels > 1:
        arr = arr.reshape(-1, channels).mean(axis=1)
    return arr.astype(np.float32), int(sr)


def read_audio(path: str | Path, target_sr: int = 16000) -> np.ndarray:
    path = Path(path)
    loaded = _try_soundfile(path)
    if loaded is None:
        if path.suffix.lower() not in {".wav", ".wave"}:
            raise RuntimeError(
                f"{path.name} needs soundfile installed because stdlib audio I/O only supports WAV"
            )
        data, sr = _read_wav_stdlib(path)
    else:
        data, sr = loaded

    if data.size == 0:
        return np.zeros(1, dtype=np.float32)
    data = np.nan_to_num(data.astype(np.float32), copy=False)
    if sr != target_sr:
        data = resample_linear(data, sr, target_sr)
    return data.astype(np.float32)


def write_wav(path: str | Path, audio: np.ndarray, sr: int = 16000) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.asarray(audio, dtype=np.float32)
    data = np.clip(data, -1.0, 1.0)
    pcm = (data * 32767.0).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes(pcm.tobytes())


def resample_linear(x: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr or len(x) <= 1:
        return x.astype(np.float32)
    dur = len(x) / float(src_sr)
    n = max(1, int(round(dur * dst_sr)))
    src_t = np.linspace(0.0, dur, num=len(x), endpoint=False)
    dst_t = np.linspace(0.0, dur, num=n, endpoint=False)
    return np.interp(dst_t, src_t, x).astype(np.float32)


def normalize_peak(x: np.ndarray, peak: float = 0.98) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    if m <= 1e-8:
        return x.astype(np.float32)
    return (x * min(1.0, peak / m)).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(x, dtype=np.float64)) + 1e-12))


def dbfs(x: np.ndarray) -> float:
    return 20.0 * math.log10(rms(x) + 1e-12)


def crop_or_pad(x: np.ndarray, n: int, rng: np.random.Generator | None = None) -> np.ndarray:
    if len(x) == n:
        return x.astype(np.float32)
    if len(x) > n:
        rng = rng or np.random.default_rng()
        start = int(rng.integers(0, len(x) - n + 1))
        return x[start : start + n].astype(np.float32)
    out = np.zeros(n, dtype=np.float32)
    out[: len(x)] = x.astype(np.float32)
    return out


def mix_at_snr(clean: np.ndarray, noise: np.ndarray, snr_db: float) -> Tuple[np.ndarray, np.ndarray]:
    clean_rms = rms(clean)
    noise_rms = rms(noise)
    desired_noise_rms = clean_rms / (10.0 ** (snr_db / 20.0))
    noise_scaled = noise * (desired_noise_rms / (noise_rms + 1e-12))
    mixed = clean + noise_scaled
    peak = float(np.max(np.abs(mixed))) if mixed.size else 0.0
    if peak > 0.99:
        scale = 0.99 / peak
        mixed *= scale
        clean = clean * scale
        noise_scaled *= scale
    return mixed.astype(np.float32), clean.astype(np.float32)


def _normalise_label(label: str) -> str:
    return label.strip().lower().replace("-", "_").replace(" ", "_")


def _mad_label_to_noise(label: str) -> Optional[str]:
    label_n = _normalise_label(label)
    label_n = MAD_CLASS_ID_TO_NAME.get(label_n, label_n)
    for key, value in MAD_LABEL_TO_NOISE.items():
        if key in label_n:
            return value
    return None


def _find_csv_columns(fieldnames: Sequence[str]) -> Tuple[Optional[str], Optional[str]]:
    lower = {name.lower(): name for name in fieldnames}
    path_col = None
    label_col = None
    for cand in ("path", "file", "filename", "audio", "wav", "sample", "fname"):
        if cand in lower:
            path_col = lower[cand]
            break
    for cand in ("label", "class", "category", "target", "name"):
        if cand in lower:
            label_col = lower[cand]
            break
    return path_col, label_col


def _resolve_audio_path(root: Path, raw: str, split_hint: str | None = None) -> Optional[Path]:
    raw_path = Path(raw)
    candidates = []
    if raw_path.is_absolute():
        candidates.append(raw_path)
    candidates.append(root / raw_path)
    if split_hint:
        candidates.append(root / split_hint / raw_path)
    for path in candidates:
        if path.exists() and path.is_file() and path.suffix.lower() in AUDIO_EXTS:
            return path
    for path in root.rglob(raw_path.name):
        if path.exists() and path.is_file() and path.suffix.lower() in AUDIO_EXTS:
            return path
    return None


def load_mad_noise_files(mad_root: str | Path) -> List[Tuple[Path, int]]:
    """
    Index MAD audio as background/noise examples.

    Expected official layout:
      MAD_dataset/training.csv
      MAD_dataset/test.csv
      MAD_dataset/training/*.wav
      MAD_dataset/test/*.wav

    Folder-per-class layouts are also accepted.
    """

    root = Path(mad_root)
    rows: List[Tuple[Path, int]] = []
    for csv_path in [root / "training.csv", root / "test.csv"]:
        if not csv_path.exists():
            continue
        split_hint = "training" if "training" in csv_path.name.lower() else "test"
        with csv_path.open("r", newline="", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            path_col, label_col = _find_csv_columns(reader.fieldnames or [])
            if not path_col or not label_col:
                continue
            for row in reader:
                label = _mad_label_to_noise(row.get(label_col, ""))
                if label is None:
                    continue
                audio_path = _resolve_audio_path(root, row.get(path_col, ""), split_hint=split_hint)
                if audio_path is not None:
                    rows.append((audio_path, NOISE_TO_ID[label]))

    if rows:
        return sorted(set(rows), key=lambda item: str(item[0]))

    for path in iter_audio_files(root):
        label = _mad_label_to_noise(" ".join(part.name for part in path.parents[:3]))
        if label is not None:
            rows.append((path, NOISE_TO_ID[label]))
    return sorted(set(rows), key=lambda item: str(item[0]))


def load_structured_noise_files(root: str | Path) -> List[Tuple[Path, int]]:
    """
    Index a simple local noise dataset:

      noise/stationary/*.wav
      noise/non_stationary/*.wav
      noise/impulsive/*.wav
    """

    root = Path(root)
    rows: List[Tuple[Path, int]] = []
    for path in iter_audio_files(root):
        text = " ".join(part.lower() for part in path.parts)
        label = None
        if "impulsive" in text or "impulse" in text or "gunshot" in text or "blast" in text:
            label = "impulsive"
        elif "non_stationary" in text or "nonstationary" in text or "moving" in text or "sweep" in text:
            label = "non_stationary"
        elif "stationary" in text or "engine" in text or "vehicle" in text or "hum" in text:
            label = "stationary"
        if label is not None:
            rows.append((path, NOISE_TO_ID[label]))
    return sorted(set(rows), key=lambda item: str(item[0]))


def collect_noise_files(
    mad_root: str | Path | None = None,
    noise_dirs: Iterable[str | Path] | None = None,
) -> List[Tuple[Path, int]]:
    rows: List[Tuple[Path, int]] = []
    if mad_root:
        rows.extend(load_mad_noise_files(mad_root))
    for root in noise_dirs or []:
        rows.extend(load_structured_noise_files(root))
    return sorted(set(rows), key=lambda item: str(item[0]))


def impulse_prior_from_wave(
    audio: np.ndarray,
    frame_length: int = 512,
    hop_length: int = 128,
    ratio_threshold: float = 8.0,
    hold_frames: int = 8,
) -> np.ndarray:
    """Fast causal energy-ratio impulse prior for same-second suppression."""

    n_frames = max(1, 1 + max(0, len(audio) - frame_length) // hop_length)
    prior = np.zeros(n_frames, dtype=np.float32)
    slow = 1e-6
    fast = 1e-6
    hold = 0
    warm = min(24, max(4, n_frames // 10))
    prev_energy = 1e-6

    for frame in range(n_frames):
        off = frame * hop_length
        seg = audio[off : off + frame_length]
        if len(seg) < frame_length:
            seg = np.pad(seg, (0, frame_length - len(seg)))
        energy = float(np.mean(seg.astype(np.float64) ** 2) + 1e-12)
        fast = 0.55 * fast + 0.45 * energy
        if frame < warm:
            slow += (energy - slow) / float(frame + 1)
            prev_energy = energy
            continue

        ratio = fast / (slow + 1e-12)
        flux = max(0.0, energy - prev_energy) / (slow + 1e-12)
        fired = ratio > ratio_threshold and flux > 2.0
        if fired:
            hold = hold_frames
        elif hold > 0:
            hold -= 1
        else:
            slow = 0.995 * slow + 0.005 * min(energy, 4.0 * slow)

        if fired or hold > 0:
            prior[frame] = 1.0
        prev_energy = energy
    return prior


def one_second_segments(frame_labels: Sequence[int], hop_length: int, sample_rate: int) -> List[Tuple[float, str]]:
    frames_per_second = max(1, int(round(sample_rate / hop_length)))
    out: List[Tuple[float, str]] = []
    labels = list(frame_labels)
    for start in range(0, len(labels), frames_per_second):
        chunk = labels[start : start + frames_per_second]
        if not chunk:
            continue
        counts = np.bincount(np.asarray(chunk, dtype=np.int64), minlength=len(NOISE_TO_ID))
        dominant = int(np.argmax(counts))
        out.append((start * hop_length / sample_rate, list(NOISE_TO_ID.keys())[dominant]))
    return out

# CRN/GRU Audio ML Pipeline

This folder now contains a practical AI/ML path for the Audio Lab goal:

- suppress stationary engine/vehicle noise
- suppress non-stationary helicopter/fighter/footstep-like noise
- detect and suppress impulsive gunshot/blast/shelling events quickly
- preserve operator voice as the target signal
- process only the number of files the operator requests

## Model

`ml_audio_model.py` defines `TinyCRNGRUMaskNet`, a compact causal CRN/GRU model:

- input: log STFT magnitude frames, shape `[batch, frames, 257]`
- output 1: voice-preserving spectral mask, shape `[batch, frames, 257]`
- output 2: noise class logits for `stationary`, `non_stationary`, `impulsive`
- output 3: voice activity probability
- output 4: impulsive-event probability

The inference script also uses a fast causal energy-ratio impulse prior. This gives immediate suppression for gunshot-like spikes while the neural model handles cleaner speech/noise separation.

## Dataset Layout

MAD is a labeled military sound classification dataset, not a clean/noisy speech-pair dataset. For voice enhancement, train on mixtures:

```text
data/
  clean_speech/
    speaker_001.wav
    speaker_002.wav

  MAD_dataset/
    training.csv
    test.csv
    training/
    test/

  noise/
    stationary/
      engine_hum.wav
    non_stationary/
      rotor_sweep.wav
    impulsive/
      gunshot.wav
```

MAD labels are mapped like this:

```text
vehicle, tank, engine          -> stationary
helicopter, fighter, footsteps -> non_stationary
gunshot, shelling, explosion   -> impulsive
communication                  -> skipped as noise
```

Use `communication` or any other clean voice material as `clean_speech` only if it is actually suitable as target speech.

## Install

```bash
pip install -r sih_python/requirements-ml.txt
```

## Train

```bash
python sih_python/train_crn_gru_voice_mask.py \
  --speech-dir data/clean_speech \
  --mad-root data/MAD_dataset \
  --noise-dir data/noise \
  --epochs 30 \
  --batch 16 \
  --steps-per-epoch 500 \
  --out models/crn_gru_voice_mask.pt \
  --export-onnx public/models/crn_gru_voice_mask.onnx
```

If clean speech or noise data is missing, the trainer can fall back to synthetic signals for smoke testing. That is useful for development, but real suppression quality requires real clean speech plus MAD/noise clips.

## Batch Operator Workflow

Process exactly `N` files from a folder:

```bash
python sih_python/batch_enhance_crn_gru.py \
  --checkpoint models/crn_gru_voice_mask.pt \
  --input-dir incoming_audio \
  --max-files 25 \
  --out-dir outputs/enhanced \
  --report outputs/enhanced/report.csv
```

Or call the local Express API after `npm start`:

```bash
curl -X POST http://localhost:3000/api/ml/batch-enhance \
  -H "Content-Type: application/json" \
  -d "{\"inputDir\":\"incoming_audio\",\"maxFiles\":25}"
```

Outputs:

- enhanced WAV files in `outputs/enhanced`
- `report.csv` with dominant noise class, dB reduction estimates, and first impulse timestamp
- `report.timeline.json` with one-second noise labels for every processed file

For example, if a gunshot-like event appears, `first_impulsive_second` reports the first frame time where the model or fast prior fired. With the default 16 kHz / 128-hop setup, frame decisions update every 8 ms.

## Browser Path (live, in the Audio Lab)

The training script exports a whole-clip ONNX graph to `public/models/crn_gru_voice_mask.onnx` (fixed frame count, hidden state reset to zero every call) — fine for a one-shot batch run, unusable for a live microphone.

For the Audio Lab's live engine, re-export the same checkpoint with the GRU hidden state exposed as an explicit input/output and a dynamic frame count:

```bash
python sih_python/export_streaming_onnx.py \
  --checkpoint models/crn_gru_voice_mask.pt \
  --out public/models/crn_gru_voice_mask_streaming.onnx
```

This writes the streaming ONNX graph plus a small JSON manifest (`crn_gru_voice_mask_streaming.json`) with the exact dimensions and chunking scheme the browser needs — see the script's docstring for how hidden state and the causal convs' receptive field are carried across chunks (a `context_frames`-frame overlap is re-fed each call and dropped from the output, verified against the batch path during development).

`public/js/rt_engine.js` loads that manifest + ONNX graph via `onnxruntime-web` (served from `node_modules/onnxruntime-web/dist` at `/vendor/onnxruntime-web/` by `src/app.js` — this needs the local server, not `file://`) and runs it continuously on a `ScriptProcessorNode`: mic (or a file/demo clip played through the same graph) → STFT framing → streaming ONNX inference → the same causal energy-ratio impulse prior as the batch path (`ml_audio_utils.impulse_prior_from_wave`, ported to JS) → inverse STFT → speakers, with output delayed by only a couple of chunks. `public/js/panel9.js` wires this into the "Live Audio Processing Lab" UI (Start/Stop, live Raw/Enhanced monitor switch, live metrics, scrolling spectrogram).

"""
Persistent local TTS server for OmniVoice (k2-fsa/OmniVoice), used by the voice
agent's Bolna synthesizer (bolna/bolna/synthesizer/omnivoice_synthesizer.py)
instead of shelling out to a generator script per utterance. Loads the model once at startup and keeps it
resident in GPU memory so a live call doesn't pay a fresh model-load cost per
turn.

Run in a venv with omnivoice, torch (CUDA), fastapi and uvicorn installed:

    REF_AUDIO=./reference_voice.wav python omnivoice_server.py

Shares a GPU lock directory (GPU_LOCK_DIR) with other GPU jobs on the same machine, but with a
short timeout suited to a live call - a live call would rather fail one
utterance fast (Bolna logs the error and moves on) than hang the caller for
a long batch timeout.
"""
import io
import logging
import os
import time

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from omnivoice import OmniVoice

logging.basicConfig(format="%(asctime)s %(levelname)s [omnivoice_server] %(message)s", level=logging.INFO)
logger = logging.getLogger("omnivoice_server")

LOCK_DIR = os.environ.get("GPU_LOCK_DIR", "./gpu.lock")
LOCK_TIMEOUT_S = 8
LOCK_POLL_S = 0.2

REF_AUDIO = os.environ.get("REF_AUDIO", "./reference_voice.wav")  # ~30 s clean clip of the voice to clone (not included)
# Same reference transcript already proven against this exact ref_audio clip
# in a batch narration pipeline.
REF_TEXT = (
    "మీకు తెలుసా? Honey ఎప్పటికీ పాడైపోదు, Egypt pyramids లో 3000 years పాత honey pots "
    "దొరికాయి, అవి ఇప్పటికీ తినొచ్చు. ఇది ఎందుకంటే honey లో water చాలా తక్కువ ఉంటుంది, "
    "so bacteria బతకలేదు. నిజం గా fascinating కదా?"
)
DEFAULT_SPEED = 1.08

app = FastAPI()
model = None


@app.on_event("startup")
def load_model():
    global model
    t0 = time.time()
    logger.info("loading k2-fsa/OmniVoice ...")
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cuda:0", dtype=torch.float16)
    logger.info(f"model loaded in {time.time() - t0:.1f}s, sampling_rate={model.sampling_rate}")


def acquire_gpu_lock():
    start = time.time()
    while True:
        try:
            os.mkdir(LOCK_DIR)
            return
        except FileExistsError:
            if time.time() - start > LOCK_TIMEOUT_S:
                raise TimeoutError(
                    f"GPU busy (another job holding {LOCK_DIR}) - timed out after {LOCK_TIMEOUT_S}s"
                )
            time.sleep(LOCK_POLL_S)


def release_gpu_lock():
    try:
        os.rmdir(LOCK_DIR)
    except FileNotFoundError:
        pass


class SynthesizeRequest(BaseModel):
    text: str
    language: str = "en"
    speed: float = DEFAULT_SPEED
    # diffusion decoding steps - lower = faster. Real A/B test (2026-09-02): 32/16/8 all
    # transcribed back to Deepgram word-for-word identical; 4 measurably clipped
    # (peak=1.0) and transcribed as garbage. 8 is the fastest step count with zero
    # detected quality loss on a short test sentence - 1.95s gen for a ~5s reply vs
    # 7.16s at the batch default of 32. Real follow-up test (2026-09-02) on a
    # longer, more realistic reply showed this doesn't generalize: num_step=8 measured
    # peak=0.9262 (right at the clipping edge) and num_step=12 outright clipped
    # (peak=1.0000) on that sentence, while num_step=16 stayed clean (peak=0.8766) on
    # both test sentences. Raised the default for real-call quality; see
    # PEAK_NORMALIZE_THRESHOLD below for a permanent safety net regardless of step count.
    num_step: int = 16


# Real fix (2026-09-02): num_step alone doesn't reliably predict clipping across
# different sentences (see note above - the relationship isn't monotonic). Rather
# than picking a step count and hoping no future sentence clips, normalize any
# output that gets close to full scale down to a safe headroom, same technique as
# a peak limiter - protects every future call regardless of content or step count.
PEAK_NORMALIZE_THRESHOLD = 0.95
PEAK_NORMALIZE_TARGET = 0.9


@app.post("/synthesize")
def synthesize(req: SynthesizeRequest):
    if model is None:
        raise HTTPException(status_code=503, detail="model still loading")
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="empty text")

    try:
        acquire_gpu_lock()
    except TimeoutError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        t0 = time.time()
        audio = model.generate(
            text=req.text,
            language=req.language,
            ref_audio=REF_AUDIO,
            ref_text=REF_TEXT,
            speed=req.speed,
            num_step=req.num_step,
        )
        wav = np.asarray(audio[0], dtype=np.float32)
        if np.isnan(wav).any():
            raise HTTPException(status_code=500, detail="NaN in generated audio")
        peak = float(np.max(np.abs(wav))) if len(wav) else 0.0
        rms = float(np.sqrt(np.mean(wav.astype(np.float64) ** 2))) if len(wav) else 0.0
        if rms == 0 or (peak / rms) < 1.5:
            raise HTTPException(status_code=500, detail=f"degenerate output (peak={peak:.6f} rms={rms:.6f})")

        if peak > PEAK_NORMALIZE_THRESHOLD:
            logger.warning(f"peak {peak:.4f} near/at clipping - normalizing down to {PEAK_NORMALIZE_TARGET}")
            wav = wav * (PEAK_NORMALIZE_TARGET / peak)
            peak = PEAK_NORMALIZE_TARGET

        buf = io.BytesIO()
        sf.write(buf, wav, model.sampling_rate, format="WAV")
        gen_s = time.time() - t0
        logger.info(f"synthesized {len(req.text)} chars in {gen_s:.2f}s -> {len(wav) / model.sampling_rate:.2f}s audio")
        return Response(content=buf.getvalue(), media_type="audio/wav")
    finally:
        release_gpu_lock()


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": model is not None}


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8500)

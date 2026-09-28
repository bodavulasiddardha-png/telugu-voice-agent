"""
Generates the pre-baked welcome-message audio Bolna needs (real finding
2026-09-02): TaskManager.__forced_first_message only plays a welcome greeting if
self.preloaded_welcome_audio is already set from a "welcome_message_audio" kwarg -
there is no code path that synthesizes agent_welcome_message text at call time.
Every call this whole session silently skipped the greeting and marked it
"played" anyway (task_manager.py:1482-1486) - what sounded like a greeting was
always the LLM's reactive first turn after the caller said "hello" first. On a
real outbound call to someone who didn't say anything, this produced pure
silence on both ends.

Bolna's own resample() (bolna/helpers/utils.py:590) confirms the required format
for format="pcm": raw bytes, np.int16 (16-bit signed, little-endian, no WAV
header). Default welcome_message_audio_sample_rate is 8000, mono.

Run this whenever create_agent.js's agent_welcome_message text changes, then
paste the printed constant into quickstart_server.py's CACHED_WELCOME_AUDIO_B64.
"""
import base64
import io
import json
import sys
import urllib.request

import numpy as np
import soundfile as sf

sys.stdout.reconfigure(encoding="utf-8")

# Keep this in sync with create_agent.js's agent_welcome_message.
WELCOME_TEXT = (
    "హాయ్, నేను సిద్ధు యొక్క AI assistant. WhatsApp bots, websites, automation లాంటి "
    "వాటితో India లో small businesses కి సహాయం చేస్తాను. ఇప్పుడు కొన్ని నిమిషాలు "
    "మాట్లాడటానికి మంచి time నా?"
)

payload = json.dumps({"text": WELCOME_TEXT, "language": "te", "speed": 1.08}).encode("utf-8")
req = urllib.request.Request(
    "http://localhost:8500/synthesize", data=payload, headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(req, timeout=60) as resp:
    wav_bytes = resp.read()

data, sr = sf.read(io.BytesIO(wav_bytes), dtype="int16")
print(f"synthesized: sr={sr} dur={len(data)/sr:.2f}s peak={np.abs(data).max()}")

# Resample to 8000Hz mono (Bolna's default welcome_message_audio_sample_rate)
# using the same scipy polyphase approach as bolna's own resample() for pcm,
# so the result matches what the rest of the pipeline expects bit-for-bit.
import scipy.signal

target_sr = 8000
g = np.gcd(sr, target_sr)
up, down = target_sr // g, sr // g
resampled = scipy.signal.resample_poly(data.astype(np.float32), up, down)
pcm = np.clip(resampled, -32768, 32767).astype(np.int16).tobytes()

b64 = base64.b64encode(pcm).decode("ascii")
print(f"raw PCM bytes: {len(pcm)}, base64 chars: {len(b64)}")

out_path = "welcome_audio_b64.txt"
with open(out_path, "w", encoding="utf-8") as f:
    f.write(b64)
print(f"wrote {out_path}")

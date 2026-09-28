import os

import aiohttp

from .base_synthesizer import BaseSynthesizer
from bolna.helpers.logger_config import configure_logger
from bolna.helpers.utils import resample

logger = configure_logger(__name__)


class OmniVoiceSynthesizer(BaseSynthesizer):
    """HTTP-mode synthesizer for the self-hosted OmniVoice (k2-fsa/OmniVoice) server -
    see voice-agent/omnivoice_server.py. Not a cloud API: this calls a persistently
    loaded model process on the same machine (reachable from the bolna-app container
    via host.docker.internal), the same model and cloned reference voice already
    proven in production for the Reels pipeline's Telugu narration."""

    def __init__(
        self, voice_id="siddu", voice="siddu", language="en", audio_format="wav",
        sampling_rate=8000, speed=1.08, stream=False, buffer_size=400, **kwargs,
    ):
        super().__init__(kwargs.get("task_manager_instance"), stream, buffer_size)
        self.voice_id = voice_id
        self.language = language
        self.speed = speed
        self.sample_rate = int(sampling_rate) if isinstance(sampling_rate, str) else sampling_rate
        self.stream = False
        self.model = "omnivoice"
        base_url = os.getenv("OMNIVOICE_SERVER_URL", "http://host.docker.internal:8500")
        self.server_url = f"{base_url}/synthesize"

    def supports_websocket(self):
        return True

    # ------------------------------------------------------------------
    # BaseSynthesizer hooks
    # ------------------------------------------------------------------

    def _process_http_audio(self, audio):
        # Server always returns 24kHz WAV (OmniVoice's native rate) - downsample to
        # whatever the telephony leg (Plivo, 8kHz) needs.
        return resample(audio, self.sample_rate, format="wav")

    async def _generate_http(self, text):
        async with aiohttp.ClientSession() as session:
            async with session.post(
                self.server_url,
                json={"text": text, "language": self.language, "speed": self.speed},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status != 200:
                    detail = await resp.text()
                    raise Exception(f"OmniVoice server error {resp.status}: {detail}")
                return await resp.read()

    async def synthesize(self, text):
        return await self._generate_http(text)

    # ------------------------------------------------------------------
    # generate / push - use base _generate_http_loop
    # ------------------------------------------------------------------

    async def generate(self):
        async for packet in self._generate_http_loop():
            yield packet

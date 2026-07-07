export function createTtsAdapter(runtime, store) {
  async function synthesize(text) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return { mode: "none" };
    const key = runtime.get("FISH_AUDIO_API_KEY");
    if (!key) {
      return {
        mode: "browser",
        text: cleanText,
        reason: "FISH_AUDIO_API_KEY is empty"
      };
    }

    try {
      const audioBuffer = await callFishAudio(runtime, cleanText);
      const fileName = store.writeTtsFile(cleanText, audioBuffer);
      return {
        mode: "fish",
        audioUrl: `/tts/${fileName}`
      };
    } catch (error) {
      return {
        mode: "browser",
        text: cleanText,
        reason: `Fish Audio unavailable: ${error.message}`
      };
    }
  }

  return { synthesize };
}

async function callFishAudio(runtime, text) {
  const response = await fetch("https://api.fish.audio/v1/tts", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${runtime.get("FISH_AUDIO_API_KEY")}`
    },
    body: JSON.stringify({
      text,
      reference_id: runtime.get("FISH_AUDIO_VOICE_ID") || undefined,
      format: "mp3"
    })
  });
  if (!response.ok) throw new Error(`Fish Audio API ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

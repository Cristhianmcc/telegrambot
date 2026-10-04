import OpenAI from 'openai';

/**
 * Transcribe un archivo de voz de Telegram a texto en español utilizando Whisper (OpenAI o Groq).
 */
export async function transcribeAudioUrl(audioUrl: string): Promise<string | null> {
  const groqKey = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!groqKey && !openaiKey) {
    return null;
  }

  // Si tiene Groq o OpenAI
  const useGroq = Boolean(groqKey);
  const client = new OpenAI({
    apiKey: useGroq ? groqKey : openaiKey,
    baseURL: useGroq ? 'https://api.groq.com/openai/v1' : undefined
  });

  const res = await fetch(audioUrl);
  if (!res.ok) {
    throw new Error(`No se pudo descargar el audio de Telegram: ${res.statusText}`);
  }

  const blob = await res.blob();
  const file = new File([blob], 'voice.ogg', { type: 'audio/ogg' });

  const transcription = await client.audio.transcriptions.create({
    file,
    model: useGroq ? 'whisper-large-v3-turbo' : 'whisper-1',
    language: 'es',
    temperature: 0.2
  });

  return transcription.text?.trim() || null;
}

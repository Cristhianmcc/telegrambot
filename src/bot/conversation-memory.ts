export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

const chatHistories = new Map<number, ChatHistoryMessage[]>();
const EXPIRATION_MS = 20 * 60 * 1000; // 20 minutos de inactividad

/**
 * Obtiene el historial reciente de conversación para un chat de Telegram.
 */
export function getChatHistory(chatId: number): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history = chatHistories.get(chatId) || [];
  const now = Date.now();
  const valid = history.filter((m) => now - m.timestamp < EXPIRATION_MS);
  if (valid.length !== history.length) {
    chatHistories.set(chatId, valid);
  }
  return valid.map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Agrega un mensaje al historial en memoria para mantener el hilo conversacional.
 */
export function addChatMessage(chatId: number, role: 'user' | 'assistant', content: string): void {
  let history = chatHistories.get(chatId) || [];
  const now = Date.now();
  history = history.filter((m) => now - m.timestamp < EXPIRATION_MS);

  // Limpiar etiquetas HTML de los mensajes guardados para no malgastar tokens
  const cleanContent = content.replace(/<[^>]+>/g, '').trim();

  history.push({ role, content: cleanContent, timestamp: now });

  // Conservar los últimos 6 mensajes (3 rondas de interacción)
  if (history.length > 6) {
    history = history.slice(-6);
  }
  chatHistories.set(chatId, history);
}

/**
 * Limpia el historial de un usuario al reiniciar con /start o /menu.
 */
export function clearChatHistory(chatId: number): void {
  chatHistories.delete(chatId);
}

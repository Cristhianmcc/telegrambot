import 'dotenv/config';
import { createBot } from './bot/bot.js';
import { getJaguaresPool } from './connectors/jaguares/jaguares-db.js';
import { initLLMClient } from './llm/llm-router.js';

async function bootstrap() {
  console.log('🐆 Iniciando Bot Empresarial de Telegram (Módulo Escuela Jaguares)...');
  initLLMClient();

  // 1. Probar conexión a la base de datos de Jaguares
  try {
    const pool = await getJaguaresPool();
    await pool.query('SELECT 1');
    console.log('✅ Conexión a base de datos de Jaguares (MySQL) verificada exitosamente.');
  } catch (err: any) {
    console.warn('⚠️ No se pudo conectar a la base de datos de Jaguares:', err.message);
    console.warn('💡 Revisa las credenciales JAGUARES_DB_* en tu archivo .env.');
  }

  // 2. Verificar token de Telegram
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'tu_token_aqui_de_botfather') {
    console.warn('\n⚠️ TELEGRAM_BOT_TOKEN no configurado en bottelegram/.env.');
    console.warn('👉 Para probar el bot con tu cuenta de Telegram:');
    console.warn('   1. Abre BotFather en Telegram (@BotFather)');
    console.warn('   2. Crea un bot con /newbot y copia el token');
    console.warn('   3. Pégalo en bottelegram/.env como TELEGRAM_BOT_TOKEN=...\n');
    console.log('El servidor permanecerá en espera. Presiona Ctrl+C para salir.');
    return;
  }

  // 3. Inicializar y arrancar Bot
  const bot = createBot(token);

  console.log('🚀 Bot de Telegram iniciado en modo polling.');
  console.log('📱 Abre tu bot en Telegram y escribe /start o "¿Cómo está la escuela?"');

  bot.start({
    onStart: (botInfo) => {
      console.log(`🤖 Bot autenticado como @${botInfo.username}`);
    }
  });
}

bootstrap().catch((err) => {
  console.error('❌ Error fatal al iniciar el bot:', err);
  process.exit(1);
});

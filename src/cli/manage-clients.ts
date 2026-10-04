import { accessStore } from '../auth/access-store.js';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const command = args[0];

function printHelp() {
  console.log(`
🐆 Gestión Comercial de Clientes - Bot Empresarial de Telegram

Uso:
  npm run client:create -- [opciones]    Genera un código y enlace de activación para un cliente
  npm run client:list                   Muestra todos los clientes, usuarios vinculados y códigos
  npm run client:revoke -- [opciones]    Revoca el acceso a un usuario de Telegram

Opciones para client:create:
  --tenant=<id>        ID del negocio (por defecto: jaguares)
  --name=<nombre>      Nombre visible del negocio (ej: "Escuela Deportiva Jaguares")
  --role=<rol>         Rol del usuario: owner | admin | staff (por defecto: owner)
  --days=<dias>        Días de vigencia del enlace (por defecto: 7)
  --plan=<plan>        Plan: basic | standard | premium (por defecto: premium)

Ejemplos:
  npm run client:create -- --tenant=jaguares --role=owner
  npm run client:create -- --tenant=bodega1 --name="Bodega San Martin" --role=owner
  npm run client:revoke -- --userId=123456789
`);
}

function parseNamedArgs(argList: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const a of argList) {
    if (a.startsWith('--')) {
      const [key, ...vals] = a.slice(2).split('=');
      map[key] = vals.join('=') || 'true';
    }
  }
  return map;
}

async function main() {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'Monterrial_bot';

  switch (command) {
    case 'create': {
      const opts = parseNamedArgs(args.slice(1));
      const tenantId = opts.tenant || 'jaguares';
      const tenantName = opts.name || (tenantId === 'jaguares' ? 'Escuela Deportiva Jaguares' : tenantId);
      const role = (opts.role as any) || 'owner';
      const days = parseInt(opts.days || '7', 10);
      const plan = (opts.plan as any) || 'premium';

      // Verificar o crear el tenant
      let tenant = accessStore.getTenant(tenantId);
      if (!tenant) {
        tenant = {
          id: tenantId,
          name: tenantName,
          plan,
          status: 'active',
          createdAt: new Date().toISOString()
        };
        accessStore.upsertTenant(tenant);
        console.log(`🏢 Nuevo negocio registrado: "${tenant.name}" (${tenant.id})`);
      }

      // Crear código de activación
      const codeObj = accessStore.createActivationCode(tenantId, role, days, `Invitación para ${tenantName}`);
      const deepLink = `https://t.me/${botUsername}?start=${codeObj.code}`;

      console.log(`
======================================================
🎉 ¡ENLACE DE ACTIVACIÓN COMERCIAL GENERADO CON ÉXITO!
======================================================
💼 Negocio:   ${tenant.name} (${tenant.id})
👑 Rol:       ${role.toUpperCase()}
🔑 Código:    ${codeObj.code}
⏳ Vigencia:  ${days} días (expira el ${new Date(codeObj.expiresAt).toLocaleDateString('es-PE')})

📲 ENLACE DIRECTO PARA EL CLIENTE:
👉 ${deepLink}

📋 Instrucciones para tu cliente:
   1. Envíale este enlace por WhatsApp o mensaje privado.
   2. El cliente hace clic en el enlace y presiona "Iniciar" en Telegram.
   3. Su cuenta se vinculará de inmediato a su negocio sin necesidad de escribir nada más.
======================================================
`);
      break;
    }

    case 'list': {
      console.log('\n--- 🏢 NEGOCIOS / TENANTS ---');
      const tenants = accessStore.listTenants();
      if (tenants.length === 0) console.log('No hay negocios registrados.');
      for (const t of tenants) {
        console.log(`• [${t.status.toUpperCase()}] ${t.name} (ID: ${t.id}, Plan: ${t.plan})`);
      }

      console.log('\n--- 👥 USUARIOS DE TELEGRAM VINCULADOS ---');
      const memberships = accessStore.listMemberships();
      if (memberships.length === 0) console.log('No hay usuarios vinculados todavía.');
      for (const m of memberships) {
        console.log(
          `• [${m.status.toUpperCase()}] ${m.firstName} (${m.username || 'sin @'}) - TG ID: ${m.telegramUserId} | Negocio: ${m.tenantId} | Rol: ${m.role}`
        );
      }
      console.log('');
      break;
    }

    case 'revoke': {
      const opts = parseNamedArgs(args.slice(1));
      const userId = parseInt(opts.userId || '', 10);
      if (!userId || isNaN(userId)) {
        console.error('❌ Debes especificar el Telegram User ID con --userId=123456');
        process.exit(1);
      }

      const ok = accessStore.revokeMembership(userId);
      if (ok) {
        console.log(`✅ Acceso revocado correctamente para el usuario ${userId}.`);
      } else {
        console.log(`⚠️ No se encontró ninguna membresía activa para el usuario ${userId}.`);
      }
      break;
    }

    default:
      printHelp();
  }
}

main().catch((err) => {
  console.error('Error:', err.message);
});

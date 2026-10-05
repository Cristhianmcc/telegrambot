import fs from 'node:fs';
import path from 'node:path';

export interface Tenant {
  id: string; // ej: 'jaguares'
  name: string; // ej: 'Escuela Deportiva Jaguares'
  plan: 'basic' | 'standard' | 'premium';
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface NotificationOptions {
  includeStudents: boolean;     // 👥 Alumnos Activos
  includeIncome: boolean;       // 💰 Cobros del Mes
  includeDebts: boolean;        // 🚨 Cobranzas Pendientes
  includeCapacity: boolean;     // 🏟️ Cupos y Capacidad
  includeNewStudents: boolean;  // 🆕 Nuevas Matrículas
  includePaymentAlerts: boolean; // 🔔 Alerta inmediata de pagos nuevos
}

export const DEFAULT_NOTIFICATION_OPTIONS: NotificationOptions = {
  includeStudents: true,
  includeIncome: true,
  includeDebts: true,
  includeCapacity: false,
  includeNewStudents: true,
  includePaymentAlerts: true
};

export interface Membership {
  telegramUserId: number;
  tenantId: string;
  role: 'owner' | 'admin' | 'staff';
  firstName: string;
  username?: string;
  linkedAt: string;
  status: 'active' | 'revoked';
  dailyDigestEnabled?: boolean;
  digestHour?: string; // '07:00' | '08:00' | '09:00' | '14:00' | '20:00'
  lastDigestSentDate?: string; // YYYY-MM-DD
  notificationOptions?: NotificationOptions;
}

export interface ActivationCode {
  code: string; // ej: 'ACT-JAG-8942'
  tenantId: string;
  role: 'owner' | 'admin' | 'staff';
  description?: string;
  expiresAt: string; // ISO date
  isConsumed: boolean;
  consumedBy?: number;
  consumedAt?: string;
}

interface AccessData {
  tenants: Record<string, Tenant>;
  memberships: Record<string, Membership>; // key: telegramUserId string
  activationCodes: Record<string, ActivationCode>; // key: code
  superadminIds?: number[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'access-store.json');

class AccessStore {
  private data: AccessData = {
    tenants: {},
    memberships: {},
    activationCodes: {},
    superadminIds: []
  };

  constructor() {
    this.init();
  }

  private init(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        this.data = JSON.parse(raw);
      } else {
        // Inicializar con el tenant default de Jaguares
        this.data.tenants['jaguares'] = {
          id: 'jaguares',
          name: 'Escuela Deportiva Jaguares',
          plan: 'premium',
          status: 'active',
          createdAt: new Date().toISOString()
        };
        this.save();
      }
    } catch (err: any) {
      console.error('⚠️ Error inicializando AccessStore:', err.message);
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const tmpFile = `${DATA_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmpFile, DATA_FILE);
    } catch (err: any) {
      console.error('⚠️ Error guardando AccessStore:', err.message);
    }
  }

  // --- TENANTS ---
  public getTenant(tenantId: string): Tenant | null {
    return this.data.tenants[tenantId] || null;
  }

  public listTenants(): Tenant[] {
    return Object.values(this.data.tenants);
  }

  public upsertTenant(tenant: Tenant): void {
    this.data.tenants[tenant.id] = tenant;
    this.save();
  }

  // --- MEMBERSHIPS (Telegram Users) ---
  public getMembership(telegramUserId: number): Membership | null {
    const m = this.data.memberships[telegramUserId.toString()];
    if (!m || m.status !== 'active') return null;
    return m;
  }

  public listMemberships(): Membership[] {
    return Object.values(this.data.memberships);
  }

  public setMembership(membership: Membership): void {
    this.data.memberships[membership.telegramUserId.toString()] = membership;
    this.save();
  }

  public revokeMembership(telegramUserId: number): boolean {
    const m = this.data.memberships[telegramUserId.toString()];
    if (m) {
      m.status = 'revoked';
      this.save();
      return true;
    }
    return false;
  }

  public updateDigestSettings(
    telegramUserId: number,
    enabled: boolean,
    hour: string = '08:00'
  ): boolean {
    const m = this.data.memberships[telegramUserId.toString()];
    if (m) {
      m.dailyDigestEnabled = enabled;
      m.digestHour = hour;
      this.save();
      return true;
    }
    return false;
  }

  public recordDigestSent(telegramUserId: number, dateStr: string): void {
    const m = this.data.memberships[telegramUserId.toString()];
    if (m) {
      m.lastDigestSentDate = dateStr;
      this.save();
    }
  }

  public getNotificationOptions(telegramUserId: number): NotificationOptions {
    const m = this.data.memberships[telegramUserId.toString()];
    return { ...DEFAULT_NOTIFICATION_OPTIONS, ...(m?.notificationOptions || {}) };
  }

  public toggleNotificationOption(
    telegramUserId: number,
    key: keyof NotificationOptions
  ): NotificationOptions {
    const m = this.data.memberships[telegramUserId.toString()];
    if (m) {
      // Completar claves nuevas para configuraciones guardadas antes de que existieran
      m.notificationOptions = { ...DEFAULT_NOTIFICATION_OPTIONS, ...(m.notificationOptions || {}) };
      m.notificationOptions[key] = !m.notificationOptions[key];
      this.save();
      return m.notificationOptions;
    }
    return DEFAULT_NOTIFICATION_OPTIONS;
  }

  // --- ACTIVATION CODES ---
  public createActivationCode(
    tenantId: string,
    role: 'owner' | 'admin' | 'staff' = 'owner',
    daysValid: number = 7,
    description?: string
  ): ActivationCode {
    const randomHex = Math.random().toString(36).substring(2, 7).toUpperCase();
    const prefix = tenantId.substring(0, 3).toUpperCase();
    const code = `ACT-${prefix}-${randomHex}`;

    const expiresAt = new Date(Date.now() + daysValid * 24 * 60 * 60 * 1000).toISOString();

    const activationCode: ActivationCode = {
      code,
      tenantId,
      role,
      description,
      expiresAt,
      isConsumed: false
    };

    this.data.activationCodes[code] = activationCode;
    this.save();
    return activationCode;
  }

  public consumeActivationCode(
    codeStr: string,
    telegramUserId: number,
    firstName: string,
    username?: string
  ): { success: boolean; message: string; tenant?: Tenant; role?: string } {
    const cleanCode = codeStr.trim().toUpperCase();
    const codeObj = this.data.activationCodes[cleanCode];

    if (!codeObj) {
      return { success: false, message: 'El código de activación no existe.' };
    }

    if (codeObj.isConsumed) {
      return { success: false, message: 'Este código de activación ya fue utilizado previamente.' };
    }

    if (new Date(codeObj.expiresAt).getTime() < Date.now()) {
      return { success: false, message: 'Este código de activación ha caducado.' };
    }

    const tenant = this.getTenant(codeObj.tenantId);
    if (!tenant || tenant.status !== 'active') {
      return { success: false, message: 'La empresa o escuela asociada a este código no se encuentra activa.' };
    }

    // Marcar como consumido
    codeObj.isConsumed = true;
    codeObj.consumedBy = telegramUserId;
    codeObj.consumedAt = new Date().toISOString();

    // Crear o actualizar membresía
    const membership: Membership = {
      telegramUserId,
      tenantId: tenant.id,
      role: codeObj.role,
      firstName,
      username,
      linkedAt: new Date().toISOString(),
      status: 'active'
    };

    this.setMembership(membership);
    this.save();

    return {
      success: true,
      message: `¡Cuenta vinculada con éxito a ${tenant.name}!`,
      tenant,
      role: codeObj.role
    };
  }

  // --- SUPERADMIN MANAGEMENT ---
  public isSuperadmin(telegramUserId: number): boolean {
    // 1. Verificar variables de entorno
    const envSuperadmins = (process.env.SUPERADMIN_TELEGRAM_IDS || '')
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));

    if (envSuperadmins.includes(telegramUserId)) {
      return true;
    }

    // 2. Verificar lista guardada
    if (!this.data.superadminIds) {
      this.data.superadminIds = [];
    }

    if (this.data.superadminIds.includes(telegramUserId)) {
      return true;
    }

    // 3. Si no hay ningún superadmin registrado en absoluto, el primer usuario que lo invoque se vuelve Superadmin
    if (envSuperadmins.length === 0 && this.data.superadminIds.length === 0) {
      this.data.superadminIds.push(telegramUserId);
      this.save();
      console.log(`👑 Usuario ${telegramUserId} auto-asignado como Superadmin Maestro inicial.`);
      return true;
    }

    return false;
  }

  public addSuperadmin(telegramUserId: number): void {
    if (!this.data.superadminIds) this.data.superadminIds = [];
    if (!this.data.superadminIds.includes(telegramUserId)) {
      this.data.superadminIds.push(telegramUserId);
      this.save();
    }
  }

  // --- CÓDIGOS Y LISTAS ---
  public listActivationCodes(onlyPending: boolean = true): ActivationCode[] {
    const list = Object.values(this.data.activationCodes);
    if (!onlyPending) return list;
    const now = Date.now();
    return list.filter((c) => !c.isConsumed && new Date(c.expiresAt).getTime() > now);
  }

  public revokeActivationCode(codeStr: string): boolean {
    const clean = codeStr.trim().toUpperCase();
    if (this.data.activationCodes[clean]) {
      delete this.data.activationCodes[clean];
      this.save();
      return true;
    }
    return false;
  }

  public deleteTenant(tenantId: string): boolean {
    if (this.data.tenants[tenantId]) {
      delete this.data.tenants[tenantId];
      this.save();
      return true;
    }
    return false;
  }
}

export const accessStore = new AccessStore();

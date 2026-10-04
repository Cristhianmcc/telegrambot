import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;
let detectedColYear: string = 'año';

export interface JaguaresDbConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
}

export function getJaguaresDbConfigFromEnv(): JaguaresDbConfig {
  return {
    host: process.env.JAGUARES_DB_HOST || process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.JAGUARES_DB_PORT || process.env.DB_PORT || '3306', 10),
    user: process.env.JAGUARES_DB_USER || process.env.DB_USER || 'root',
    password: process.env.JAGUARES_DB_PASSWORD ?? process.env.DB_PASSWORD ?? 'rootpassword123',
    database: process.env.JAGUARES_DB_NAME || process.env.DB_NAME || 'jaguares_db'
  };
}

export async function getJaguaresPool(): Promise<mysql.Pool> {
  if (pool) return pool;

  const config = getJaguaresDbConfigFromEnv();
  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
  });

  // Garantizar utf8mb4 en cada conexión
  pool.on('connection', (conn) => {
    conn.query("SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci'");
  });

  // Auto-detectar columna año vs anio en pagos_mensuales
  try {
    const [cols] = await pool.query<mysql.RowDataPacket[]>('SHOW COLUMNS FROM pagos_mensuales');
    const hasAnio = cols.some((c) => c.Field === 'anio');
    const hasAnoTilde = cols.some((c) => c.Field === 'año');
    if (hasAnio) {
      detectedColYear = 'anio';
    } else if (hasAnoTilde) {
      detectedColYear = 'año';
    }
  } catch (err: any) {
    console.warn('⚠️ No se pudo auto-detectar colYear en pagos_mensuales (usando fallback "año"):', err.message);
  }

  return pool;
}

export function getColYear(): string {
  return detectedColYear;
}

/**
 * Ejecutor estrictamente de solo lectura.
 * Rechaza cualquier comando que no sea SELECT, SHOW, DESCRIBE o EXPLAIN.
 */
export async function executeReadOnlyQuery<T extends mysql.RowDataPacket[]>(
  sql: string,
  params: any[] = []
): Promise<T> {
  const trimmed = sql.trim().toUpperCase();
  const isReadOnly =
    trimmed.startsWith('SELECT') ||
    trimmed.startsWith('SHOW') ||
    trimmed.startsWith('DESCRIBE') ||
    trimmed.startsWith('EXPLAIN');

  if (!isReadOnly) {
    throw new Error(`Seguridad: Intento de ejecutar consulta no permitida en modo read-only: ${sql.slice(0, 30)}...`);
  }

  const p = await getJaguaresPool();
  const [rows] = await p.query<T>(sql, params);
  return rows;
}

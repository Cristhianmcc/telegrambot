import mysql from 'mysql2/promise';
import { DateTime } from 'luxon';
import { executeReadOnlyQuery, getColYear } from './jaguares-db.js';
import {
  JagOverview,
  JagStudentCounts,
  JagIncomeSummary,
  JagDebtSummary,
  JagPendingDebtor,
  JagCapacity,
  JagEnrollments,
  JagRecentStudent
} from '../../contracts/jaguares.js';
import { ResolvedPeriod } from '../../contracts/date.js';

function getMonthVariants(monthName: string): [string, string] {
  const norm = monthName.toLowerCase().trim();
  if (norm === 'septiembre' || norm === 'setiembre') {
    return ['septiembre', 'setiembre'];
  }
  return [norm, norm];
}

export class JaguaresService {
  /**
   * Resumen ejecutivo global de la escuela deportiva.
   */
  async getOverview(period: ResolvedPeriod): Promise<JagOverview> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    // 1. Alumnos activos (con al menos una inscripción activa)
    const activeRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      "SELECT COUNT(DISTINCT alumno_id) AS count FROM inscripciones WHERE estado = 'activa'"
    );
    const activeStudents = activeRows[0]?.count || 0;

    // 2. Alumnos nuevos en el período (inscripciones del mes)
    const newRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      'SELECT COUNT(DISTINCT alumno_id) AS count FROM inscripciones WHERE fecha_inscripcion >= ? AND fecha_inscripcion < ?',
      [period.from, period.to]
    );
    const newStudentsThisMonth = newRows[0]?.count || 0;

    // 3. Ingresos confirmados en pagos_mensuales para el mes
    const incomeRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COALESCE(SUM(monto), 0) AS total 
       FROM pagos_mensuales 
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'`,
      [m1, m2, year]
    );
    const incomeThisMonth = parseFloat(incomeRows[0]?.total || '0');

    // 4. Deuda / pagos pendientes en pagos_mensuales
    // 4a. Fila en pagos_mensuales con estado = 'pendiente'
    const pendingReviewRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total 
       FROM pagos_mensuales 
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'pendiente'`,
      [m1, m2, year]
    );
    const pendingReviewAmount = parseFloat(pendingReviewRows[0]?.total || '0');
    const pendingReviewCount = parseInt(pendingReviewRows[0]?.count || '0', 10);

    // 4b. Alumnos activos sin ningún pago registrado en pagos_mensuales para este mes
    const unpaidRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT a.alumno_id) AS count, COALESCE(SUM(i.precio_mensual), 0) AS total
       FROM alumnos a
       JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = 'activa'
       LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND LOWER(pm.mes) IN (?, ?) AND pm.\`${colYear}\` = ?
       WHERE pm.pago_id IS NULL`,
      [m1, m2, year]
    );
    const unpaidAmount = parseFloat(unpaidRows[0]?.total || '0');
    const unpaidCount = parseInt(unpaidRows[0]?.count || '0', 10);

    const pendingDebtAmount = pendingReviewAmount + unpaidAmount;
    const pendingDebtCount = pendingReviewCount + unpaidCount;

    // 5. Disciplina con más alumnos activos
    const topRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT d.nombre, COUNT(DISTINCT i.alumno_id) AS count
       FROM inscripciones i
       JOIN deportes d ON i.deporte_id = d.deporte_id
       WHERE i.estado = 'activa'
       GROUP BY d.deporte_id, d.nombre
       ORDER BY count DESC
       LIMIT 1`
    );
    const topDiscipline = topRows[0]
      ? { name: topRows[0].nombre, studentCount: topRows[0].count }
      : undefined;

    return {
      activeStudents,
      newStudentsThisMonth,
      incomeThisMonth,
      pendingDebtAmount,
      pendingDebtCount,
      topDiscipline
    };
  }

  /**
   * Conteo de alumnos total, activos y desglose por disciplina.
   */
  async getStudentCounts(disciplineFilter?: string): Promise<JagStudentCounts> {
    const totalRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS total FROM alumnos'
    );
    const totalStudents = totalRows[0]?.total || 0;

    const activeRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      "SELECT COUNT(DISTINCT alumno_id) AS count FROM inscripciones WHERE estado = 'activa'"
    );
    const activeStudents = activeRows[0]?.count || 0;
    const inactiveStudents = Math.max(0, totalStudents - activeStudents);

    let query = `
      SELECT d.nombre AS discipline, COUNT(DISTINCT i.alumno_id) AS count
      FROM inscripciones i
      JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE i.estado = 'activa'
    `;
    const params: any[] = [];
    if (disciplineFilter) {
      query += ' AND LOWER(d.nombre) LIKE ?';
      params.push(`%${disciplineFilter.toLowerCase().trim()}%`);
    }
    query += ' GROUP BY d.deporte_id, d.nombre ORDER BY count DESC';

    const discRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(query, params);
    const byDiscipline = discRows.map((r) => ({
      discipline: r.discipline,
      count: parseInt(r.count, 10)
    }));

    return {
      totalStudents,
      activeStudents,
      inactiveStudents,
      byDiscipline
    };
  }

  /**
   * Resumen de ingresos recaudados en pagos_mensuales.
   */
  async getIncomeSummary(period: ResolvedPeriod): Promise<JagIncomeSummary> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    // Total confirmado y métodos de pago
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COALESCE(metodo_pago, 'No especificado') AS method,
              SUM(monto) AS amount,
              COUNT(*) AS count
       FROM pagos_mensuales
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'
       GROUP BY metodo_pago`,
      [m1, m2, year]
    );

    let totalConfirmed = 0;
    let paymentsCount = 0;
    const byMethod = rows.map((r) => {
      const amount = parseFloat(r.amount || '0');
      const count = parseInt(r.count || '0', 10);
      totalConfirmed += amount;
      paymentsCount += count;
      return { method: r.method, amount, count };
    });

    // Comparación con período anterior si está disponible
    let previousPeriod: JagIncomeSummary['previousPeriod'] = undefined;
    if (period.previous?.monthName) {
      const [prevM1, prevM2] = getMonthVariants(period.previous.monthName);
      const prevRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        `SELECT COALESCE(SUM(monto), 0) AS total
         FROM pagos_mensuales
         WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'`,
        [prevM1, prevM2, period.previous.year]
      );
      const prevTotal = parseFloat(prevRows[0]?.total || '0');
      const changePct =
        prevTotal > 0
          ? parseFloat((((totalConfirmed - prevTotal) / prevTotal) * 100).toFixed(1))
          : null;

      previousPeriod = {
        periodLabel: period.previous.label,
        totalConfirmed: prevTotal,
        changePct
      };
    }

    return {
      periodLabel: period.label,
      totalConfirmed,
      paymentsCount,
      previousPeriod,
      byMethod
    };
  }

  /**
   * Resumen de deudas basado en pagos_mensuales.
   */
  async getDebtSummary(period: ResolvedPeriod): Promise<JagDebtSummary> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    // 1. Pagos subidos pendientes de confirmación
    const pendingRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total
       FROM pagos_mensuales
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'pendiente'`,
      [m1, m2, year]
    );
    const pendingReviewCount = parseInt(pendingRows[0]?.count || '0', 10);
    const pendingReviewAmount = parseFloat(pendingRows[0]?.total || '0');

    // 2. Alumnos activos sin ningún registro en pagos_mensuales para el mes
    const unpaidRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT a.alumno_id) AS count, COALESCE(SUM(i.precio_mensual), 0) AS total
       FROM alumnos a
       JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = 'activa'
       LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND LOWER(pm.mes) IN (?, ?) AND pm.\`${colYear}\` = ?
       WHERE pm.pago_id IS NULL`,
      [m1, m2, year]
    );
    const unpaidCount = parseInt(unpaidRows[0]?.count || '0', 10);
    const unpaidAmount = parseFloat(unpaidRows[0]?.total || '0');

    return {
      month,
      year,
      totalDebtAmount: pendingReviewAmount + unpaidAmount,
      totalDebtors: pendingReviewCount + unpaidCount,
      pendingReviewCount,
      pendingReviewAmount,
      unpaidCount,
      unpaidAmount
    };
  }

  /**
   * Listado nominativo de alumnos con deuda o pago pendiente de revisión.
   */
  async getPendingDebtors(period: ResolvedPeriod, limit: number = 10): Promise<JagPendingDebtor[]> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    const debtors: JagPendingDebtor[] = [];

    // 1. Pagos pendientes de revisión en pagos_mensuales
    const revRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT pm.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno,
              a.telefono_apoderado, pm.monto
       FROM pagos_mensuales pm
       JOIN alumnos a ON pm.alumno_id = a.alumno_id
       WHERE LOWER(pm.mes) IN (?, ?) AND pm.\`${colYear}\` = ? AND pm.estado = 'pendiente'
       LIMIT ?`,
      [m1, m2, year, limit]
    );

    for (const r of revRows) {
      debtors.push({
        alumnoId: r.alumno_id,
        nombreCompleto: `${r.nombres} ${r.apellido_paterno} ${r.apellido_materno || ''}`.trim(),
        dni: r.dni,
        monto: parseFloat(r.monto || '0'),
        mes: month,
        anio: year,
        status: 'pendiente_revision',
        telefonoApoderado: r.telefono_apoderado
      });
    }

    // 2. Si hay cupo en el limit, completar con alumnos activos sin pago
    const remainingLimit = limit - debtors.length;
    if (remainingLimit > 0) {
      const unpRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        `SELECT a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno,
                a.telefono_apoderado, SUM(i.precio_mensual) AS monto
         FROM alumnos a
         JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = 'activa'
         LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND LOWER(pm.mes) IN (?, ?) AND pm.\`${colYear}\` = ?
         WHERE pm.pago_id IS NULL
         GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, a.telefono_apoderado
         LIMIT ?`,
        [m1, m2, year, remainingLimit]
      );

      for (const r of unpRows) {
        debtors.push({
          alumnoId: r.alumno_id,
          nombreCompleto: `${r.nombres} ${r.apellido_paterno} ${r.apellido_materno || ''}`.trim(),
          dni: r.dni,
          monto: parseFloat(r.monto || '0'),
          mes: month,
          anio: year,
          status: 'sin_pago',
          telefonoApoderado: r.telefono_apoderado
        });
      }
    }

    return debtors;
  }

  /**
   * Ocupación y capacidad de horarios por disciplina.
   */
  async getCapacity(disciplineFilter?: string): Promise<JagCapacity> {
    let query = `
      SELECT d.nombre AS discipline,
             SUM(h.cupo_maximo) AS totalCapacity,
             SUM(h.cupos_ocupados) AS occupiedCapacity
      FROM horarios h
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE h.estado = 'activo'
    `;
    const params: any[] = [];
    if (disciplineFilter) {
      query += ' AND LOWER(d.nombre) LIKE ?';
      params.push(`%${disciplineFilter.toLowerCase().trim()}%`);
    }
    query += ' GROUP BY d.deporte_id, d.nombre ORDER BY occupiedCapacity DESC';

    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(query, params);
    const items = rows.map((r) => {
      const totalCapacity = parseInt(r.totalCapacity || '0', 10);
      const occupiedCapacity = parseInt(r.occupiedCapacity || '0', 10);
      const availableCapacity = Math.max(0, totalCapacity - occupiedCapacity);
      const occupancyPct =
        totalCapacity > 0 ? parseFloat(((occupiedCapacity / totalCapacity) * 100).toFixed(1)) : 0;
      return {
        discipline: r.discipline,
        totalCapacity,
        occupiedCapacity,
        availableCapacity,
        occupancyPct
      };
    });

    return {
      discipline: disciplineFilter,
      items
    };
  }

  /**
   * Nuevos alumnos y matrículas en un período.
   */
  async getEnrollments(period: ResolvedPeriod): Promise<JagEnrollments> {
    const newStudentsRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT alumno_id) AS count
       FROM inscripciones
       WHERE fecha_inscripcion >= ? AND fecha_inscripcion < ?`,
      [period.from, period.to]
    );
    const newStudentsCount = newStudentsRows[0]?.count || 0;

    const totalEnrollmentsRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count
       FROM inscripciones
       WHERE fecha_inscripcion >= ? AND fecha_inscripcion < ?`,
      [period.from, period.to]
    );
    const totalEnrollmentsCount = totalEnrollmentsRows[0]?.count || 0;

    const discRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT d.nombre AS discipline, COUNT(*) AS count
       FROM inscripciones i
       JOIN deportes d ON i.deporte_id = d.deporte_id
       WHERE i.fecha_inscripcion >= ? AND i.fecha_inscripcion < ?
       GROUP BY d.deporte_id, d.nombre
       ORDER BY count DESC`,
      [period.from, period.to]
    );
    const byDiscipline = discRows.map((r) => ({
      discipline: r.discipline,
      count: parseInt(r.count, 10)
    }));

    return {
      periodLabel: period.label,
      newStudentsCount,
      totalEnrollmentsCount,
      byDiscipline
    };
  }

  /**
   * Obtiene los alumnos más recientemente inscritos en la escuela.
   */
  async getRecentStudents(limit: number = 5): Promise<JagRecentStudent[]> {
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT a.alumno_id, a.nombres, a.apellido_paterno, a.apellido_materno,
              d.nombre AS deporte, i.fecha_inscripcion
       FROM inscripciones i
       JOIN alumnos a ON i.alumno_id = a.alumno_id
       JOIN deportes d ON i.deporte_id = d.deporte_id
       ORDER BY i.fecha_inscripcion DESC
       LIMIT ?`,
      [limit]
    );

    return rows.map((r) => {
      let fechaFormatted = 'Reciente';
      if (r.fecha_inscripcion) {
        fechaFormatted = DateTime.fromJSDate(new Date(r.fecha_inscripcion))
          .setZone('America/Lima')
          .toFormat('dd/MM/yyyy hh:mm a');
      }
      return {
        alumnoId: r.alumno_id,
        nombreCompleto: `${r.nombres} ${r.apellido_paterno} ${r.apellido_materno || ''}`.trim(),
        deporte: r.deporte || 'No especificado',
        fechaInscripcion: fechaFormatted
      };
    });
  }
}

export const jaguaresService = new JaguaresService();

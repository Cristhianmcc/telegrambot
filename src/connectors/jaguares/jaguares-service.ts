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
  JagRecentStudent,
  JagStudentDetail,
  JagVoucherDetail
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
    const pendingReviewRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total 
       FROM pagos_mensuales 
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'pendiente'`,
      [m1, m2, year]
    );
    const pendingDebtAmount = parseFloat(pendingReviewRows[0]?.total || '0');
    const pendingDebtCount = pendingReviewRows[0]?.count || 0;

    // 5. Disciplina con mayor cantidad de alumnos
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
   * Resumen de ingresos confirmados en pagos_mensuales para un período.
   */
  async getIncomeSummary(period: ResolvedPeriod): Promise<JagIncomeSummary> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    const totalRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COALESCE(SUM(monto), 0) AS total, COUNT(*) AS count
       FROM pagos_mensuales
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'`,
      [m1, m2, year]
    );
    const totalConfirmed = parseFloat(totalRows[0]?.total || '0');
    const paymentsCount = totalRows[0]?.count || 0;

    // Desglose por método de pago si existe
    const methodRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT IFNULL(metodo_pago, 'Sin especificar') AS method,
              COALESCE(SUM(monto), 0) AS amount,
              COUNT(*) AS count
       FROM pagos_mensuales
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'
       GROUP BY IFNULL(metodo_pago, 'Sin especificar')
       ORDER BY amount DESC`,
      [m1, m2, year]
    );
    const byMethod = methodRows.map((r) => ({
      method: r.method,
      amount: parseFloat(r.amount || '0'),
      count: r.count
    }));

    let previousPeriod: JagIncomeSummary['previousPeriod'] | undefined = undefined;
    if (period.previous) {
      const prevMonth = period.previous.monthName || 'septiembre';
      const prevYear = period.previous.year;
      const [pm1, pm2] = getMonthVariants(prevMonth);

      const prevRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        `SELECT COALESCE(SUM(monto), 0) AS total
         FROM pagos_mensuales
         WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'confirmado'`,
        [pm1, pm2, prevYear]
      );
      const prevTotal = parseFloat(prevRows[0]?.total || '0');
      let changePct: number | null = null;
      if (prevTotal > 0) {
        changePct = Math.round(((totalConfirmed - prevTotal) / prevTotal) * 100);
      }
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
   * Resumen de deuda y pagos pendientes en pagos_mensuales.
   */
  async getDebtSummary(period: ResolvedPeriod): Promise<JagDebtSummary> {
    const colYear = getColYear();
    const month = period.monthName || 'octubre';
    const year = period.year;
    const [m1, m2] = getMonthVariants(month);

    // 1. Pagos pendientes de revisión en pagos_mensuales
    const revRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count, COALESCE(SUM(monto), 0) AS total
       FROM pagos_mensuales
       WHERE LOWER(mes) IN (?, ?) AND \`${colYear}\` = ? AND estado = 'pendiente'`,
      [m1, m2, year]
    );
    const pendingReviewCount = revRows[0]?.count || 0;
    const pendingReviewAmount = parseFloat(revRows[0]?.total || '0');

    // 2. Alumnos activos sin fila de pago para el mes
    const unpRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT COUNT(DISTINCT a.alumno_id) AS count, COALESCE(SUM(i.precio_mensual), 0) AS total
       FROM alumnos a
       JOIN inscripciones i ON i.alumno_id = a.alumno_id AND i.estado = 'activa'
       LEFT JOIN pagos_mensuales pm ON pm.alumno_id = a.alumno_id AND LOWER(pm.mes) IN (?, ?) AND pm.\`${colYear}\` = ?
       WHERE pm.pago_id IS NULL`,
      [m1, m2, year]
    );
    const unpaidCount = unpRows[0]?.count || 0;
    const unpaidAmount = parseFloat(unpRows[0]?.total || '0');

    const totalDebtors = pendingReviewCount + unpaidCount;
    const totalDebtAmount = pendingReviewAmount + unpaidAmount;

    return {
      month,
      year,
      totalDebtAmount,
      totalDebtors,
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
   * Capacidad y ocupación de cupos por disciplina u horario.
   */
  async getCapacity(disciplineFilter?: string): Promise<JagCapacity> {
    let query = `
      SELECT d.nombre AS discipline,
             COALESCE(SUM(h.cupo_maximo), 0) AS total_capacity,
             COALESCE(SUM(h.cupos_ocupados), 0) AS occupied_capacity
      FROM horarios h
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE h.estado = 'Activo'
    `;
    const params: any[] = [];
    if (disciplineFilter) {
      query += ' AND LOWER(d.nombre) LIKE ?';
      params.push(`%${disciplineFilter.toLowerCase().trim()}%`);
    }
    query += ' GROUP BY d.deporte_id, d.nombre ORDER BY occupied_capacity DESC';

    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(query, params);

    const items = rows.map((r) => {
      const total = parseInt(r.total_capacity, 10);
      const occupied = parseInt(r.occupied_capacity, 10);
      const available = Math.max(0, total - occupied);
      const pct = total > 0 ? Math.round((occupied / total) * 100) : 0;
      return {
        discipline: r.discipline,
        totalCapacity: total,
        occupiedCapacity: occupied,
        availableCapacity: available,
        occupancyPct: pct
      };
    });

    return {
      discipline: disciplineFilter,
      items
    };
  }

  /**
   * Conteo de matrículas / inscripciones procesadas en un período.
   */
  async getEnrollments(period: ResolvedPeriod): Promise<JagEnrollments> {
    const studentRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      'SELECT COUNT(DISTINCT alumno_id) AS count FROM inscripciones WHERE fecha_inscripcion >= ? AND fecha_inscripcion < ?',
      [period.from, period.to]
    );
    const newStudentsCount = studentRows[0]?.count || 0;

    const enrollRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      'SELECT COUNT(*) AS count FROM inscripciones WHERE fecha_inscripcion >= ? AND fecha_inscripcion < ?',
      [period.from, period.to]
    );
    const totalEnrollmentsCount = enrollRows[0]?.count || 0;

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

  /**
   * Búsqueda de alumnos por DNI o nombres/apellidos con detalle de deudas y horarios.
   */
  async searchStudents(searchTerm: string, limit: number = 5): Promise<JagStudentDetail[]> {
    const cleanTerm = searchTerm.trim().toLowerCase();
    const colYear = getColYear();

    const studentRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      `SELECT 
         a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno,
         a.fecha_nacimiento,
         TIMESTAMPDIFF(YEAR, a.fecha_nacimiento, CURDATE()) AS edad,
         IFNULL(a.apoderado, '') AS apoderado,
         IFNULL(a.telefono_apoderado, IFNULL(a.telefono, '')) AS telefono_apoderado,
         a.estado AS estado_alumno
       FROM alumnos a
       WHERE a.dni LIKE ? 
          OR LOWER(CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno, ''))) LIKE ?
       ORDER BY a.apellido_paterno ASC, a.nombres ASC
       LIMIT ?`,
      [`%${cleanTerm}%`, `%${cleanTerm}%`, limit]
    );

    const results: JagStudentDetail[] = [];

    for (const r of studentRows) {
      // 1. Disciplinas y horarios inscritos
      const discRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        `SELECT 
           d.nombre AS deporte,
           i.precio_mensual,
           h.dia,
           TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
           TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin
         FROM inscripciones i
         JOIN deportes d ON i.deporte_id = d.deporte_id
         LEFT JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id AND ih.estado = 'activo'
         LEFT JOIN horarios h ON ih.horario_id = h.horario_id
         WHERE i.alumno_id = ? AND (i.estado = 'activa' OR i.estado = 'activo')`,
        [r.alumno_id]
      );

      const disciplinas = discRows.map((d) => ({
        deporte: d.deporte,
        dia: d.dia || undefined,
        horario: d.hora_inicio && d.hora_fin ? `${d.hora_inicio} - ${d.hora_fin}` : undefined,
        precioMensual: parseFloat(d.precio_mensual || '0')
      }));

      // 2. Pagos pendientes en pagos_mensuales
      const debtRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        `SELECT 
           pm.pago_id, pm.mes, pm.\`${colYear}\` AS anio, pm.monto, pm.estado, pm.comprobante_url
         FROM pagos_mensuales pm
         WHERE pm.alumno_id = ? AND pm.estado = 'pendiente'
         ORDER BY pm.pago_id DESC`,
        [r.alumno_id]
      );

      let totalDeuda = 0;
      const mesesPendientes = debtRows.map((pm) => {
        const monto = parseFloat(pm.monto || '0');
        totalDeuda += monto;
        return {
          pagoId: pm.pago_id,
          mes: pm.mes,
          anio: parseInt(pm.anio, 10),
          monto,
          estado: pm.estado,
          comprobanteUrl: pm.comprobante_url || undefined
        };
      });

      let fechaNacFormatted: string | undefined;
      if (r.fecha_nacimiento) {
        fechaNacFormatted = DateTime.fromJSDate(new Date(r.fecha_nacimiento)).toFormat('dd/MM/yyyy');
      }

      results.push({
        alumnoId: r.alumno_id,
        dni: r.dni,
        nombreCompleto: `${r.nombres} ${r.apellido_paterno} ${r.apellido_materno || ''}`.trim(),
        nombres: r.nombres,
        apellidos: `${r.apellido_paterno} ${r.apellido_materno || ''}`.trim(),
        fechaNacimiento: fechaNacFormatted,
        edad: r.edad !== null ? parseInt(r.edad, 10) : undefined,
        apoderado: r.apoderado || undefined,
        telefonoApoderado: r.telefono_apoderado || undefined,
        estadoAlumno: r.estado_alumno || 'activo',
        disciplinas,
        deuda: {
          tieneDeuda: mesesPendientes.length > 0,
          totalDeuda,
          mesesPendientes
        }
      });
    }

    return results;
  }

  /**
   * Obtiene los comprobantes de pago subidos recientemente (Yape, Plin, Transferencia).
   */
  async getRecentVouchers(limit: number = 5, studentFilter?: string): Promise<JagVoucherDetail[]> {
    const colYear = getColYear();

    let query = `
      SELECT 
        pm.pago_id,
        pm.alumno_id,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno, '')) AS alumno,
        a.dni,
        IFNULL(a.telefono_apoderado, IFNULL(a.telefono, '')) AS telefono,
        pm.mes,
        pm.\`${colYear}\` AS anio,
        pm.monto,
        pm.estado,
        pm.metodo_pago,
        pm.comprobante_url,
        pm.fecha_pago
      FROM pagos_mensuales pm
      JOIN alumnos a ON pm.alumno_id = a.alumno_id
      WHERE pm.comprobante_url IS NOT NULL 
        AND TRIM(pm.comprobante_url) != ''
    `;
    const params: any[] = [];

    if (studentFilter) {
      query += ` AND (a.dni LIKE ? OR LOWER(CONCAT(a.nombres, ' ', a.apellido_paterno)) LIKE ?)`;
      params.push(`%${studentFilter}%`, `%${studentFilter.toLowerCase()}%`);
    }

    query += ` ORDER BY pm.pago_id DESC LIMIT ?`;
    params.push(limit);

    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(query, params);

    return rows.map((r) => {
      let fechaFormatted: string | undefined;
      if (r.fecha_pago) {
        fechaFormatted = DateTime.fromJSDate(new Date(r.fecha_pago))
          .setZone('America/Lima')
          .toFormat('dd/MM/yyyy hh:mm a');
      }

      let url = (r.comprobante_url || '').trim();
      if (url && !url.startsWith('http://') && !url.startsWith('https://')) {
        const cleanPath = url.startsWith('/') ? url : `/${url}`;
        url = `https://api.jaguarescar.com${cleanPath}`;
      }

      return {
        pagoId: r.pago_id,
        alumnoId: r.alumno_id,
        alumnoNombre: r.alumno,
        dni: r.dni,
        telefono: r.telefono || undefined,
        monto: parseFloat(r.monto || '0'),
        mes: r.mes,
        anio: parseInt(r.anio, 10),
        metodoPago: r.metodo_pago || 'Yape / Plin',
        comprobanteUrl: url,
        estado: r.estado,
        fechaPago: fechaFormatted
      };
    });
  }
}

export const jaguaresService = new JaguaresService();

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
  JagVoucherDetail,
  JagAsistenciasAlumno,
  JagDocenteClaseAsistencia,
  JagDocentesControlResumen,
  JagDocenteAlumnosClase,
  JagBirthdayStudent,
  JagDropoutRiskStudent,
  JagOperationSearchResult,
  JagRankingStudent,
  JagAttendanceDiscrepancy,
  JagTodayScheduleItem,
  JagCapacityAlert,
  JagMonthlyComparison,
  JagPaymentMethodBreakdown,
  JagSystemHealth
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

  /**
   * Historial de asistencias de un alumno por DNI.
   * Réplica de GET /api/admin/alumnos/:dni/asistencias (solo lectura).
   */
  async getAsistenciasAlumno(
    dni: string,
    fechaInicio?: string,
    fechaFin?: string
  ): Promise<JagAsistenciasAlumno | null> {
    // 1. Buscar alumno
    const alumnoRows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      'SELECT alumno_id, nombres, apellido_paterno, apellido_materno FROM alumnos WHERE dni = ?',
      [dni]
    );
    if (!alumnoRows.length) return null;
    const alumno = alumnoRows[0];

    // 2. Construir query de asistencias
    let sql = `
      SELECT
        DATE_FORMAT(ast.fecha, '%Y-%m-%d') AS fecha,
        ast.presente,
        COALESCE(ast.asistencia_puerta, 0) AS asistencia_puerta,
        TIME_FORMAT(ast.hora_puerta, '%H:%i') AS hora_puerta,
        ast.observaciones,
        d.nombre AS deporte,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i')     AS hora_fin,
        h.categoria
      FROM asistencias ast
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE ast.alumno_id = ?
    `;
    const params: (string | number)[] = [alumno.alumno_id];

    if (fechaInicio && fechaFin) {
      sql += ' AND ast.fecha BETWEEN ? AND ?';
      params.push(fechaInicio, fechaFin);
    } else if (fechaInicio) {
      sql += ' AND ast.fecha >= ?';
      params.push(fechaInicio);
    } else if (fechaFin) {
      sql += ' AND ast.fecha <= ?';
      params.push(fechaFin);
    }
    sql += ' ORDER BY ast.fecha DESC, d.nombre LIMIT 300';

    const registros = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, params);

    const total = registros.length;
    const presentes = registros.filter((r) => r.presente === 1 || r.presente === true).length;
    const puertaOk = registros.filter(
      (r) => r.asistencia_puerta === 1 || r.asistencia_puerta === true || r.asistencia_puerta === '1'
    ).length;

    return {
      alumno: {
        alumno_id: alumno.alumno_id,
        nombres: alumno.nombres,
        apellido_paterno: alumno.apellido_paterno,
        apellido_materno: alumno.apellido_materno,
        dni
      },
      asistencias: registros.map((r) => ({
        fecha: r.fecha,
        presente: r.presente === 1 || r.presente === true,
        asistencia_puerta: r.asistencia_puerta === 1 || r.asistencia_puerta === true || r.asistencia_puerta === '1',
        hora_puerta: r.hora_puerta || undefined,
        observaciones: r.observaciones || undefined,
        deporte: r.deporte,
        dia: r.dia,
        hora_inicio: r.hora_inicio,
        hora_fin: r.hora_fin,
        categoria: r.categoria
      })),
      resumen: { total, presentes, ausentes: total - presentes, puerta_ok: puertaOk, sin_puerta: total - puertaOk }
    };
  }

  /**
   * Control de asistencia de docentes: quiénes ya pasaron lista y quiénes faltan en una fecha.
   */
  async getDocentesControl(targetFecha?: string): Promise<JagDocentesControlResumen> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const fecha = targetFecha || now.toFormat('yyyy-MM-dd');
    const dt = DateTime.fromFormat(fecha, 'yyyy-MM-dd', { zone: tz });

    const diasSemanaMap = [
      'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'
    ];
    const diasNombresEs = [
      'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'
    ];
    const diaIndex = (dt.isValid ? dt.weekday : now.weekday) - 1;
    const diaDb = diasSemanaMap[diaIndex];
    const diaNombre = diasNombresEs[diaIndex];

    // 1. Clases donde un docente YA pasó lista en esa fecha
    const sqlPasaron = `
      SELECT 
        adm.admin_id,
        adm.nombre_completo AS profesor,
        d.nombre AS deporte,
        h.horario_id,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i')     AS hora_fin,
        COALESCE(h.categoria, 'General')     AS categoria,
        COUNT(ast.asistencia_id)             AS total_alumnos,
        SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes,
        SUM(CASE WHEN ast.asistencia_puerta = 1 THEN 1 ELSE 0 END) AS puerta_ok
      FROM asistencias ast
      JOIN administradores adm ON ast.registrado_por = adm.admin_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE ast.fecha = ?
      GROUP BY adm.admin_id, adm.nombre_completo, d.nombre, h.horario_id, h.dia, h.hora_inicio, h.hora_fin, h.categoria
      ORDER BY h.hora_inicio, adm.nombre_completo
    `;
    const rowsPasaron = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlPasaron, [fecha]);

    const pasaronLista: JagDocenteClaseAsistencia[] = rowsPasaron.map((r) => ({
      admin_id: Number(r.admin_id),
      profesor: r.profesor,
      deporte: r.deporte,
      horario_id: Number(r.horario_id),
      dia: r.dia,
      hora_inicio: r.hora_inicio,
      hora_fin: r.hora_fin,
      categoria: r.categoria,
      total_alumnos: Number(r.total_alumnos),
      presentes: Number(r.presentes),
      ausentes: Number(r.ausentes),
      puerta_ok: Number(r.puerta_ok),
      ya_paso_lista: true
    }));

    const horariosListos = new Set(pasaronLista.map((p) => p.horario_id));

    // 2. Clases programadas para ese día con docentes asignados que AÚN NO pasan lista
    const sqlPendientes = `
      SELECT 
        adm.admin_id,
        adm.nombre_completo AS profesor,
        d.nombre AS deporte,
        h.horario_id,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i')     AS hora_fin,
        COALESCE(h.categoria, 'General')     AS categoria,
        COALESCE(COUNT(DISTINCT CASE WHEN i.estado = 'activa' THEN ih.inscripcion_id END), 0) AS total_alumnos
      FROM profesor_deportes pd
      JOIN administradores adm ON pd.admin_id = adm.admin_id
      JOIN horarios h ON pd.horario_id = h.horario_id
      JOIN deportes d ON pd.deporte_id = d.deporte_id
      LEFT JOIN inscripcion_horarios ih ON ih.horario_id = h.horario_id
      LEFT JOIN inscripciones i ON i.inscripcion_id = ih.inscripcion_id
      WHERE (UPPER(h.dia) = ? OR UPPER(h.dia) LIKE CONCAT(?, '%'))
        AND adm.estado = 'activo'
      GROUP BY adm.admin_id, adm.nombre_completo, d.nombre, h.horario_id, h.dia, h.hora_inicio, h.hora_fin, h.categoria
      ORDER BY h.hora_inicio, adm.nombre_completo
    `;
    const rowsPendientes = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlPendientes, [diaDb, diaDb]);

    const pendientes: JagDocenteClaseAsistencia[] = rowsPendientes
      .filter((r) => !horariosListos.has(Number(r.horario_id)))
      .map((r) => ({
        admin_id: Number(r.admin_id),
        profesor: r.profesor,
        deporte: r.deporte,
        horario_id: Number(r.horario_id),
        dia: r.dia,
        hora_inicio: r.hora_inicio,
        hora_fin: r.hora_fin,
        categoria: r.categoria,
        total_alumnos: Number(r.total_alumnos),
        presentes: 0,
        ausentes: 0,
        puerta_ok: 0,
        ya_paso_lista: false
      }));

    const [countDocentes] = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM administradores WHERE rol = 'profesor' AND estado = 'activo'"
    );

    return {
      fecha,
      diaNombre,
      pasaronLista,
      pendientes,
      totalDocentesActivos: Number(countDocentes?.total || 0)
    };
  }

  /**
   * Lista detallada de asistencias de alumnos para una clase/horario y fecha específica.
   */
  async getAsistenciasDocenteClase(horarioId: number, targetFecha?: string): Promise<JagDocenteAlumnosClase | null> {
    const tz = 'America/Lima';
    const fecha = targetFecha || DateTime.now().setZone(tz).toFormat('yyyy-MM-dd');

    const sql = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        d.nombre AS deporte,
        COALESCE(h.categoria, 'General') AS categoria,
        CONCAT(TIME_FORMAT(h.hora_inicio, '%H:%i'), ' - ', TIME_FORMAT(h.hora_fin, '%H:%i')) AS horario,
        COALESCE(adm.nombre_completo, 'Docente') AS profesor,
        ast.presente,
        COALESCE(ast.asistencia_puerta, 0) AS asistencia_puerta,
        TIME_FORMAT(ast.hora_puerta, '%H:%i') AS hora_puerta,
        ast.observaciones
      FROM asistencias ast
      JOIN alumnos a ON ast.alumno_id = a.alumno_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN administradores adm ON ast.registrado_por = adm.admin_id
      WHERE ast.horario_id = ? AND ast.fecha = ?
      ORDER BY a.apellido_paterno, a.nombres
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, [horarioId, fecha]);
    if (!rows.length) return null;

    const first = rows[0];
    const total = rows.length;
    const presentes = rows.filter((r) => r.presente === 1 || r.presente === true).length;
    const puertaOk = rows.filter(
      (r) => r.asistencia_puerta === 1 || r.asistencia_puerta === true || r.asistencia_puerta === '1'
    ).length;

    return {
      profesor: first.profesor,
      deporte: first.deporte,
      categoria: first.categoria,
      horario: first.horario,
      fecha,
      alumnos: rows.map((r) => ({
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        presente: r.presente === 1 || r.presente === true,
        asistencia_puerta: r.asistencia_puerta === 1 || r.asistencia_puerta === true || r.asistencia_puerta === '1',
        hora_puerta: r.hora_puerta || undefined,
        observaciones: r.observaciones || undefined
      })),
      resumen: {
        total,
        presentes,
        ausentes: total - presentes,
        puerta_ok: puertaOk
      }
    };
  }

  /**
   * Cumpleaños de alumnos activos (hoy, esta semana o este mes).
   */
  async getBirthdays(periodo: 'hoy' | 'semana' | 'mes' = 'hoy'): Promise<JagBirthdayStudent[]> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const mesActual = now.month;
    const diaActual = now.day;
    const anioActual = now.year;

    let whereClause = '';
    const params: any[] = [];

    if (periodo === 'hoy') {
      whereClause = 'MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) = ?';
      params.push(mesActual, diaActual);
    } else if (periodo === 'semana') {
      const finSemana = now.plus({ days: 7 });
      if (finSemana.month === now.month) {
        whereClause = 'MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) BETWEEN ? AND ?';
        params.push(mesActual, diaActual, finSemana.day);
      } else {
        whereClause = `
          (
            (MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) BETWEEN ? AND 31)
            OR (MONTH(fecha_nacimiento) = ? AND DAY(fecha_nacimiento) <= ?)
          )
        `;
        params.push(mesActual, diaActual, finSemana.month, finSemana.day);
      }
    } else {
      whereClause = 'MONTH(fecha_nacimiento) = ?';
      params.push(mesActual);
    }

    const sql = `
      SELECT 
        alumno_id,
        dni,
        CONCAT(nombres, ' ', apellido_paterno, ' ', COALESCE(apellido_materno, '')) AS nombre_completo,
        DATE_FORMAT(fecha_nacimiento, '%Y-%m-%d') AS fecha_nacimiento,
        DAY(fecha_nacimiento) AS dia,
        MONTH(fecha_nacimiento) AS mes,
        YEAR(fecha_nacimiento) AS anio_nac,
        telefono,
        apoderado
      FROM alumnos
      WHERE estado = 'activo'
        AND fecha_nacimiento IS NOT NULL
        AND fecha_nacimiento > '1950-01-01'
        AND ${whereClause}
      ORDER BY MONTH(fecha_nacimiento), DAY(fecha_nacimiento), apellido_paterno
    `;

    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, params);

    return rows.map((r) => {
      const anioNac = Number(r.anio_nac);
      const edadCumplir = anioActual - anioNac;
      const cumpleThisYear = DateTime.fromObject({ year: anioActual, month: Number(r.mes), day: Number(r.dia) }, { zone: tz });
      let diffDays = Math.round(cumpleThisYear.diff(now.startOf('day'), 'days').days);
      if (diffDays < 0) diffDays += 365;

      return {
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        fecha_nacimiento: r.fecha_nacimiento,
        dia: Number(r.dia),
        mes: Number(r.mes),
        edad_cumplir: Math.max(1, edadCumplir),
        telefono: r.telefono || undefined,
        apoderado: r.apoderado || undefined,
        dias_restantes: diffDays
      };
    });
  }

  /**
   * Alumnos en riesgo de deserción (3+ faltas consecutivas o asistencia < 50% en los últimos 45 días).
   */
  async getDropoutRisk(): Promise<JagDropoutRiskStudent[]> {
    const sql = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        d.nombre AS deporte,
        a.telefono,
        a.apoderado,
        COUNT(ast.asistencia_id) AS total_clases,
        SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes,
        MAX(ast.fecha) AS ultima_clase_fecha
      FROM alumnos a
      JOIN asistencias ast ON a.alumno_id = ast.alumno_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE a.estado = 'activo'
        AND ast.fecha >= DATE_SUB(CURDATE(), INTERVAL 45 DAY)
      GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, d.nombre, a.telefono, a.apoderado
      HAVING total_clases >= 3 AND (ausentes >= 3 OR (presentes / total_clases) < 0.50)
      ORDER BY (presentes / total_clases) ASC, ausentes DESC
      LIMIT 25;
    `;

    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql);
    const results: JagDropoutRiskStudent[] = [];

    for (const r of rows) {
      const total = Number(r.total_clases);
      const pres = Number(r.presentes);
      const pct = Math.round((pres / total) * 100);

      const ultimas = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        'SELECT presente FROM asistencias WHERE alumno_id = ? ORDER BY fecha DESC LIMIT 5',
        [r.alumno_id]
      );
      let faltasConsecutivas = 0;
      for (const u of ultimas) {
        if (u.presente === 0 || u.presente === false) {
          faltasConsecutivas++;
        } else {
          break;
        }
      }

      results.push({
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        deporte: r.deporte,
        telefono: r.telefono || undefined,
        apoderado: r.apoderado || undefined,
        faltas_consecutivas: faltasConsecutivas,
        total_clases: total,
        presentes: pres,
        porcentaje_asistencia: pct,
        ultima_clase_fecha: r.ultima_clase_fecha ? DateTime.fromJSDate(new Date(r.ultima_clase_fecha)).toFormat('yyyy-MM-dd') : undefined
      });
    }

    return results;
  }

  /**
   * Búsqueda por número de operación bancaria (en inscripciones y pagos mensuales).
   */
  async searchOperationNumber(numOp: string): Promise<JagOperationSearchResult[]> {
    const clean = numOp.trim();
    if (!clean || clean.length < 2) return [];

    const colYear = getColYear();
    const results: JagOperationSearchResult[] = [];

    // 1. Inscripciones
    const sqlInscripciones = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        COALESCE(a.monto_pago, 0) AS monto,
        COALESCE(DATE_FORMAT(a.fecha_pago, '%Y-%m-%d'), DATE_FORMAT(a.created_at, '%Y-%m-%d')) AS fecha,
        COALESCE(a.estado_pago, 'pendiente') AS estado,
        a.numero_operacion,
        a.comprobante_pago_url,
        GROUP_CONCAT(DISTINCT d.nombre SEPARATOR ', ') AS deportes
      FROM alumnos a
      LEFT JOIN inscripciones i ON a.alumno_id = i.alumno_id
      LEFT JOIN deportes d ON i.deporte_id = d.deporte_id
      WHERE a.numero_operacion LIKE ?
      GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, a.monto_pago, a.fecha_pago, a.created_at, a.estado_pago, a.numero_operacion, a.comprobante_pago_url
      ORDER BY a.created_at DESC
      LIMIT 10
    `;
    const rowsIns = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlInscripciones, [`%${clean}%`]);
    for (const r of rowsIns) {
      results.push({
        tipo: 'inscripcion',
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        monto: Number(r.monto),
        fecha: r.fecha || 'Sin fecha',
        estado: r.estado,
        numero_operacion: r.numero_operacion,
        comprobante_url: r.comprobante_pago_url || undefined,
        detalle: `Inscripción${r.deportes ? ` (${r.deportes})` : ''}`
      });
    }

    // 2. Pagos mensuales
    const sqlPagos = `
      SELECT 
        pm.pago_id,
        pm.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        pm.mes,
        pm.\`${colYear}\` AS anio,
        pm.monto,
        COALESCE(DATE_FORMAT(pm.fecha_pago, '%Y-%m-%d'), DATE_FORMAT(pm.created_at, '%Y-%m-%d')) AS fecha,
        pm.estado,
        pm.numero_operacion,
        pm.comprobante_url
      FROM pagos_mensuales pm
      JOIN alumnos a ON pm.alumno_id = a.alumno_id
      WHERE pm.numero_operacion LIKE ?
      ORDER BY pm.pago_id DESC
      LIMIT 10
    `;
    const rowsPagos = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlPagos, [`%${clean}%`]);
    for (const p of rowsPagos) {
      results.push({
        tipo: 'mensualidad',
        alumno_id: Number(p.alumno_id),
        dni: p.dni,
        nombre_completo: p.nombre_completo.trim(),
        monto: Number(p.monto),
        fecha: p.fecha || 'Sin fecha',
        estado: p.estado,
        numero_operacion: p.numero_operacion,
        comprobante_url: p.comprobante_url || undefined,
        detalle: `Mensualidad ${p.mes} ${p.anio}`
      });
    }

    return results;
  }

  /**
   * Ranking de alumnos (por puntos o por mayor asistencia acumulada).
   */
  async getStudentRanking(deporteFilter?: string, mesFilter?: number, anioFilter?: number): Promise<JagRankingStudent[]> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const mes = mesFilter || now.month;
    const anio = anioFilter || now.year;

    let sql = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        d.nombre AS deporte,
        h.categoria,
        COUNT(ast.asistencia_id) AS total_clases,
        SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes,
        SUM(CASE WHEN ast.asistencia_puerta = 1 THEN 1 ELSE 0 END) AS puerta_ok
      FROM asistencias ast
      JOIN alumnos a ON ast.alumno_id = a.alumno_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
    `;
    const params: any[] = [mes, anio];
    if (deporteFilter) {
      sql += ' AND d.nombre LIKE ?';
      params.push(`%${deporteFilter}%`);
    }
    sql += `
      GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, d.nombre, h.categoria
      HAVING presentes > 0
      ORDER BY presentes DESC, puerta_ok DESC
      LIMIT 20
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, params);

    return rows.map((r, idx) => {
      const tot = Number(r.total_clases) || 1;
      const pres = Number(r.presentes);
      return {
        puesto: idx + 1,
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        deporte: r.deporte,
        categoria: r.categoria || undefined,
        puntos: pres * 10,
        porcentaje_asistencia: Math.round((pres / tot) * 100),
        clases_asistidas: pres,
        total_clases: Number(r.total_clases)
      };
    });
  }

  /**
   * Alumnos con 100% de asistencia (asistencia perfecta) en el mes (mínimo 4 clases evaluadas).
   */
  async getPerfectAttendance(mesFilter?: number, anioFilter?: number): Promise<JagRankingStudent[]> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const mes = mesFilter || now.month;
    const anio = anioFilter || now.year;

    const sql = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        d.nombre AS deporte,
        h.categoria,
        COUNT(ast.asistencia_id) AS total_clases,
        SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes
      FROM asistencias ast
      JOIN alumnos a ON ast.alumno_id = a.alumno_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE MONTH(ast.fecha) = ? AND YEAR(ast.fecha) = ?
      GROUP BY a.alumno_id, a.dni, a.nombres, a.apellido_paterno, a.apellido_materno, d.nombre, h.categoria
      HAVING total_clases >= 4 AND presentes = total_clases
      ORDER BY total_clases DESC, a.apellido_paterno
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, [mes, anio]);

    return rows.map((r, idx) => ({
      puesto: idx + 1,
      alumno_id: Number(r.alumno_id),
      dni: r.dni,
      nombre_completo: r.nombre_completo.trim(),
      deporte: r.deporte,
      categoria: r.categoria || undefined,
      puntos: Number(r.presentes) * 10,
      porcentaje_asistencia: 100,
      clases_asistidas: Number(r.presentes),
      total_clases: Number(r.total_clases)
    }));
  }

  /**
   * 1. Auditoría de inconsistencias: Puerta física (QR) vs toma de asistencia del docente.
   */
  async getAttendanceDiscrepancies(fechaTarget?: string): Promise<{ items: JagAttendanceDiscrepancy[]; fechaConsultada: string }> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    let fecha = fechaTarget || now.toFormat('yyyy-MM-dd');

    // Si no indicaron fecha y hoy aún no tiene asistencias, buscar la última fecha con registros
    if (!fechaTarget) {
      const [lastDateRow] = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
        'SELECT DATE_FORMAT(MAX(fecha), "%Y-%m-%d") AS ult FROM asistencias'
      );
      if (lastDateRow?.ult) {
        fecha = lastDateRow.ult;
      }
    }

    const sql = `
      SELECT 
        a.alumno_id,
        a.dni,
        CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', COALESCE(a.apellido_materno, '')) AS nombre_completo,
        d.nombre AS deporte,
        CONCAT(h.dia, ' ', TIME_FORMAT(h.hora_inicio, '%H:%i'), '-', TIME_FORMAT(h.hora_fin, '%H:%i')) AS horario,
        adm.nombre_completo AS profesor,
        ast.presente,
        ast.asistencia_puerta,
        TIME_FORMAT(ast.hora_puerta, '%H:%i') AS hora_puerta,
        DATE_FORMAT(ast.fecha, '%Y-%m-%d') AS fecha,
        COALESCE(a.telefono_apoderado, a.telefono) AS telefono,
        a.apoderado
      FROM asistencias ast
      JOIN alumnos a ON ast.alumno_id = a.alumno_id
      JOIN horarios h ON ast.horario_id = h.horario_id
      JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN administradores adm ON ast.registrado_por = adm.admin_id
      WHERE ast.fecha = ?
        AND (
          (ast.presente = 1 AND (ast.asistencia_puerta = 0 OR ast.asistencia_puerta IS NULL))
          OR
          (ast.presente = 0 AND ast.asistencia_puerta = 1)
        )
      ORDER BY h.hora_inicio, d.nombre, a.apellido_paterno
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, [fecha]);

    const items: JagAttendanceDiscrepancy[] = rows.map((r) => {
      const isPuertaSinDocente = Number(r.presente) === 0 && Number(r.asistencia_puerta) === 1;
      return {
        alumno_id: Number(r.alumno_id),
        dni: r.dni,
        nombre_completo: r.nombre_completo.trim(),
        deporte: r.deporte,
        horario: r.horario,
        profesor: r.profesor || undefined,
        tipo_discrepancia: isPuertaSinDocente ? 'puerta_sin_docente' : 'docente_sin_puerta',
        hora_puerta: r.hora_puerta || undefined,
        fecha: r.fecha,
        telefono: r.telefono || undefined,
        apoderado: r.apoderado || undefined
      };
    });

    return { items, fechaConsultada: fecha };
  }

  /**
   * 2. Agenda de clases y turnos del día de hoy en tiempo real.
   */
  async getTodaySchedule(fechaTarget?: string): Promise<{ items: JagTodayScheduleItem[]; diaNombre: string; fechaStr: string }> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const dateObj = fechaTarget ? DateTime.fromISO(fechaTarget).setZone(tz) : now;
    const fechaStr = dateObj.toFormat('yyyy-MM-dd');
    const DIAS_MAP = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO', 'DOMINGO'];
    const diaDb = DIAS_MAP[dateObj.weekday - 1];
    const currentHHmm = now.toFormat('HH:mm');

    const sql = `
      SELECT 
        h.horario_id,
        d.nombre AS deporte,
        h.categoria,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i')     AS hora_fin,
        h.cupo_maximo,
        h.cupos_ocupados,
        GROUP_CONCAT(DISTINCT adm.nombre_completo SEPARATOR ', ') AS profesor,
        COUNT(ast.asistencia_id) AS total_asistencias_hoy,
        SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS total_presentes_hoy,
        SUM(CASE WHEN ast.asistencia_puerta = 1 THEN 1 ELSE 0 END) AS total_puerta_hoy
      FROM horarios h
      JOIN deportes d ON h.deporte_id = d.deporte_id
      LEFT JOIN profesor_deportes pd ON pd.horario_id = h.horario_id
      LEFT JOIN administradores adm ON pd.admin_id = adm.admin_id AND adm.estado = 'activo'
      LEFT JOIN asistencias ast ON ast.horario_id = h.horario_id AND ast.fecha = ?
      WHERE (UPPER(h.dia) = ? OR UPPER(h.dia) LIKE CONCAT(?, '%'))
        AND h.estado = 'activo'
      GROUP BY h.horario_id, d.nombre, h.categoria, h.dia, h.hora_inicio, h.hora_fin, h.cupo_maximo, h.cupos_ocupados
      ORDER BY h.hora_inicio ASC, d.nombre ASC
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, [fechaStr, diaDb, diaDb]);

    const items: JagTodayScheduleItem[] = rows.map((r) => {
      const asistHoy = Number(r.total_asistencias_hoy) || 0;
      let estado: 'pasada' | 'en_curso' | 'pendiente' = 'pendiente';
      if (asistHoy > 0) {
        estado = 'pasada';
      } else if (fechaStr === now.toFormat('yyyy-MM-dd') && currentHHmm >= r.hora_inicio && currentHHmm <= r.hora_fin) {
        estado = 'en_curso';
      }

      return {
        horario_id: Number(r.horario_id),
        deporte: r.deporte,
        categoria: r.categoria || undefined,
        dia: r.dia,
        hora_inicio: r.hora_inicio,
        hora_fin: r.hora_fin,
        profesor: r.profesor || undefined,
        cupo_maximo: Number(r.cupo_maximo) || 25,
        cupos_ocupados: Number(r.cupos_ocupados) || 0,
        estado_asistencia: estado,
        total_asistencias_hoy: asistHoy,
        total_presentes_hoy: Number(r.total_presentes_hoy) || 0,
        total_puerta_hoy: Number(r.total_puerta_hoy) || 0
      };
    });

    return { items, diaNombre: diaDb, fechaStr };
  }

  /**
   * 3. Alertas de aforo y horarios con cupos críticos o agotados.
   */
  async getCapacityAlerts(): Promise<JagCapacityAlert[]> {
    const sql = `
      SELECT 
        h.horario_id,
        d.nombre AS deporte,
        h.categoria,
        h.dia,
        TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
        TIME_FORMAT(h.hora_fin, '%H:%i')     AS hora_fin,
        h.cupo_maximo,
        h.cupos_ocupados
      FROM horarios h
      JOIN deportes d ON h.deporte_id = d.deporte_id
      WHERE h.estado = 'activo'
      ORDER BY (h.cupos_ocupados / GREATEST(h.cupo_maximo, 1)) DESC, h.cupos_ocupados DESC
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql);

    return rows.map((r) => {
      const max = Number(r.cupo_maximo) || 25;
      const ocu = Number(r.cupos_ocupados) || 0;
      const vacantes = Math.max(0, max - ocu);
      const pct = Math.round((ocu / max) * 100);
      let nivel: 'lleno' | 'critico' | 'medio' | 'disponible' = 'disponible';
      if (pct >= 100) nivel = 'lleno';
      else if (pct >= 85) nivel = 'critico';
      else if (pct >= 60) nivel = 'medio';

      return {
        horario_id: Number(r.horario_id),
        deporte: r.deporte,
        categoria: r.categoria || undefined,
        dia: r.dia,
        hora_inicio: r.hora_inicio,
        hora_fin: r.hora_fin,
        cupo_maximo: max,
        cupos_ocupados: ocu,
        vacantes_disponibles: vacantes,
        porcentaje_ocupacion: pct,
        nivel
      };
    });
  }

  /**
   * 4. Comparativa de crecimiento de métricas clave mes actual vs mes anterior.
   */
  async getMonthlyComparison(): Promise<JagMonthlyComparison> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const colYear = getColYear();

    const MESES = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const mesActualStr = MESES[now.month - 1];
    const anioActual = now.year;

    const prevMonthDate = now.minus({ months: 1 });
    const mesAnteriorStr = MESES[prevMonthDate.month - 1];
    const anioAnterior = prevMonthDate.year;

    const [vAct1, vAct2] = getMonthVariants(mesActualStr);
    const [vAnt1, vAnt2] = getMonthVariants(mesAnteriorStr);

    const sqlPagos = `
      SELECT 
        (mes = ? OR mes = ?) AND \`${colYear}\` = ? AS es_actual,
        SUM(CASE WHEN estado = 'confirmado' OR estado = 'confirmada' THEN monto ELSE 0 END) AS cobrado,
        SUM(CASE WHEN estado = 'pendiente' THEN monto ELSE 0 END) AS deuda
      FROM pagos_mensuales
      WHERE ((mes = ? OR mes = ?) AND \`${colYear}\` = ?)
         OR ((mes = ? OR mes = ?) AND \`${colYear}\` = ?)
      GROUP BY es_actual
    `;
    const rowsPagos = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlPagos, [
      vAct1, vAct2, anioActual,
      vAct1, vAct2, anioActual,
      vAnt1, vAnt2, anioAnterior
    ]);

    let ingActual = 0, ingAnterior = 0, deudaActual = 0, deudaAnterior = 0;
    for (const r of rowsPagos) {
      if (Number(r.es_actual) === 1) {
        ingActual = Number(r.cobrado) || 0;
        deudaActual = Number(r.deuda) || 0;
      } else {
        ingAnterior = Number(r.cobrado) || 0;
        deudaAnterior = Number(r.deuda) || 0;
      }
    }

    const sqlInscripciones = `
      SELECT 
        SUM(CASE WHEN MONTH(fecha_inscripcion) = ? AND YEAR(fecha_inscripcion) = ? THEN 1 ELSE 0 END) AS insc_actual,
        SUM(CASE WHEN MONTH(fecha_inscripcion) = ? AND YEAR(fecha_inscripcion) = ? THEN 1 ELSE 0 END) AS insc_anterior
      FROM inscripciones
      WHERE fecha_inscripcion >= DATE_SUB(CURDATE(), INTERVAL 65 DAY)
    `;
    const [rowInsc] = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sqlInscripciones, [
      now.month, anioActual,
      prevMonthDate.month, anioAnterior
    ]);
    const inscActual = Number(rowInsc?.insc_actual) || 0;
    const inscAnterior = Number(rowInsc?.insc_anterior) || 0;

    const [rowActivos] = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM alumnos WHERE estado = 'activo'"
    );
    const activos = Number(rowActivos?.total) || 0;

    const varIngPct = ingAnterior > 0 ? Math.round(((ingActual - ingAnterior) / ingAnterior) * 100) : 0;
    const varInscPct = inscAnterior > 0 ? Math.round(((inscActual - inscAnterior) / inscAnterior) * 100) : 0;

    return {
      mes_actual: mesActualStr.toUpperCase(),
      anio_actual: anioActual,
      mes_anterior: mesAnteriorStr.toUpperCase(),
      anio_anterior: anioAnterior,
      ingresos_actual: ingActual,
      ingresos_anterior: ingAnterior,
      variacion_ingresos_pct: varIngPct,
      inscripciones_actual: inscActual,
      inscripciones_anterior: inscAnterior,
      variacion_inscripciones_pct: varInscPct,
      alumnos_activos: activos,
      deuda_actual: deudaActual,
      deuda_anterior: deudaAnterior
    };
  }

  /**
   * 5. Desglose financiero por método de pago (Yape, Plin, Transferencia, Efectivo).
   */
  async getPaymentMethodsBreakdown(mesFilter?: number, anioFilter?: number): Promise<{ methods: JagPaymentMethodBreakdown[]; totalMonto: number; totalPagos: number; mesNombre: string }> {
    const tz = 'America/Lima';
    const now = DateTime.now().setZone(tz);
    const mes = mesFilter || now.month;
    const anio = anioFilter || now.year;
    const MESES = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
    const colYear = getColYear();

    const sql = `
      SELECT 
        COALESCE(NULLIF(TRIM(metodo_pago), ''), 'Yape / Plin') AS metodo,
        SUM(monto) AS total_monto,
        COUNT(*) AS cantidad_pagos
      FROM pagos_mensuales
      WHERE (estado = 'confirmado' OR estado = 'confirmada')
        AND (
          (fecha_pago IS NOT NULL AND MONTH(fecha_pago) = ? AND YEAR(fecha_pago) = ?)
          OR
          (fecha_pago IS NULL AND \`${colYear}\` = ?)
        )
      GROUP BY metodo
      ORDER BY total_monto DESC
    `;
    const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(sql, [mes, anio, anio]);

    let grandTotalMonto = 0;
    let grandTotalPagos = 0;
    for (const r of rows) {
      grandTotalMonto += Number(r.total_monto) || 0;
      grandTotalPagos += Number(r.cantidad_pagos) || 0;
    }

    const methods: JagPaymentMethodBreakdown[] = rows.map((r) => {
      const monto = Number(r.total_monto) || 0;
      const cant = Number(r.cantidad_pagos) || 0;
      const pct = grandTotalMonto > 0 ? Math.round((monto / grandTotalMonto) * 100) : 0;
      return {
        metodo: r.metodo,
        total_monto: monto,
        cantidad_pagos: cant,
        porcentaje_total: pct
      };
    });

    return {
      methods,
      totalMonto: grandTotalMonto,
      totalPagos: grandTotalPagos,
      mesNombre: `${MESES[mes - 1]} ${anio}`
    };
  }

  /**
   * 6. Panel de salud técnica del bot y MySQL.
   */
  async getSystemHealth(): Promise<JagSystemHealth> {
    const startPing = Date.now();
    let dbStatus: 'online' | 'error' = 'online';
    let latency = 0;
    try {
      await executeReadOnlyQuery('SELECT 1');
      latency = Date.now() - startPing;
    } catch {
      dbStatus = 'error';
    }

    const [rowAlumnos] = await executeReadOnlyQuery<mysql.RowDataPacket[]>('SELECT COUNT(*) AS total FROM alumnos');
    const [rowInsc] = await executeReadOnlyQuery<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM inscripciones WHERE estado = 'activa' OR estado = 'activo'");
    const [rowHor] = await executeReadOnlyQuery<mysql.RowDataPacket[]>("SELECT COUNT(*) AS total FROM horarios WHERE estado = 'activo'");
    const [rowLastPago] = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
      "SELECT DATE_FORMAT(MAX(fecha_pago), '%d/%m/%Y %H:%i') AS ult FROM pagos_mensuales WHERE comprobante_url IS NOT NULL AND TRIM(comprobante_url) != ''"
    );

    const tz = 'America/Lima';
    const serverTime = DateTime.now().setZone(tz).toFormat('dd/MM/yyyy hh:mm:ss a');

    return {
      db_status: dbStatus,
      db_latency_ms: latency,
      total_alumnos: Number(rowAlumnos?.total) || 0,
      total_inscripciones_activas: Number(rowInsc?.total) || 0,
      total_horarios_activos: Number(rowHor?.total) || 0,
      watcher_status: 'Activo (cada 60 s)',
      last_payment_date: rowLastPago?.ult || undefined,
      cached_queries: 0,
      uptime_seconds: Math.floor(process.uptime()),
      server_time: serverTime
    };
  }
}

export const jaguaresService = new JaguaresService();



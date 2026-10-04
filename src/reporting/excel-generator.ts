import ExcelJS from 'exceljs';
import { executeReadOnlyQuery } from '../connectors/jaguares/jaguares-db.js';

/**
 * Genera un archivo Excel profesional con la lista de deudores de mensualidad.
 */
export async function generateDebtorsExcelBuffer(monthLabel: string = 'este mes'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bot Empresarial Jaguares';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Deudores de Mensualidad');

  // Título principal
  worksheet.mergeCells('A1:G1');
  const titleRow = worksheet.getCell('A1');
  titleRow.value = `ESCUELA DEPORTIVA JAGUARES - REPORTE DE DEUDORES (${monthLabel.toUpperCase()})`;
  titleRow.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' } // Azul oscuro elegante
  };
  titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 30;

  // Cabecera de columnas
  const headers = [
    '#',
    'DNI',
    'Alumno',
    'Apoderado',
    'Teléfono',
    'Monto Deuda',
    'Estado'
  ];

  const headerRow = worksheet.addRow(headers);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF2563EB' } // Azul moderno
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });

  // Consultar datos reales de la BD
  const query = `
    SELECT 
      a.dni,
      CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno, '')) AS alumno,
      IFNULL(a.apoderado, '-') AS apoderado,
      IFNULL(a.telefono, '-') AS telefono,
      pm.monto,
      pm.estado
    FROM pagos_mensuales pm
    JOIN alumnos a ON pm.alumno_id = a.alumno_id
    WHERE pm.estado = 'pendiente'
    ORDER BY pm.monto DESC, a.apellido_paterno ASC
    LIMIT 200
  `;

  const rows = await executeReadOnlyQuery<any>(query);

  let totalDeuda = 0;
  rows.forEach((r: any, idx: number) => {
    const monto = parseFloat(r.monto || '0');
    totalDeuda += monto;

    const row = worksheet.addRow([
      idx + 1,
      r.dni,
      r.alumno,
      r.apoderado,
      r.telefono,
      monto,
      r.estado.toUpperCase()
    ]);

    row.height = 20;

    // Formatear celda de monto como moneda en Soles
    const cellMonto = row.getCell(6);
    cellMonto.numFmt = '"S/ "#,##0.00';
    cellMonto.alignment = { horizontal: 'right' };

    // Estilo para celda de estado
    const cellEstado = row.getCell(7);
    cellEstado.font = { color: { argb: 'FFDC2626' }, bold: true }; // Rojo
    cellEstado.alignment = { horizontal: 'center' };

    // Bordes suaves
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      };
    });
  });

  // Fila de total
  const totalRow = worksheet.addRow(['', '', '', '', 'TOTAL PENDIENTE:', totalDeuda, '']);
  totalRow.height = 24;
  totalRow.getCell(5).font = { bold: true };
  totalRow.getCell(5).alignment = { horizontal: 'right' };
  const totalCell = totalRow.getCell(6);
  totalCell.font = { bold: true, color: { argb: 'FFDC2626' } };
  totalCell.numFmt = '"S/ "#,##0.00';
  totalCell.alignment = { horizontal: 'right' };

  // Ancho de columnas adaptativo
  worksheet.columns = [
    { width: 6 },
    { width: 14 },
    { width: 35 },
    { width: 25 },
    { width: 16 },
    { width: 18 },
    { width: 14 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Genera un archivo Excel con el padrón completo de alumnos inscritos.
 */
export async function generateStudentsExcelBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Bot Empresarial Jaguares';
  const worksheet = workbook.addWorksheet('Alumnos Activos');

  worksheet.mergeCells('A1:G1');
  const titleRow = worksheet.getCell('A1');
  titleRow.value = 'ESCUELA DEPORTIVA JAGUARES - PADRÓN DE ALUMNOS INSCRITOS';
  titleRow.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 30;

  const headers = ['#', 'DNI', 'Alumno', 'Sexo', 'Deporte', 'Fecha Inscripción', 'Estado'];
  const headerRow = worksheet.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF059669' } // Verde esmeralda
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const query = `
    SELECT 
      a.dni,
      CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno, '')) AS alumno,
      IFNULL(a.sexo, '-') AS sexo,
      d.nombre AS deporte,
      DATE_FORMAT(i.fecha_inscripcion, '%d/%m/%Y') AS fecha_inscripcion,
      i.estado
    FROM alumnos a
    JOIN inscripciones i ON a.alumno_id = i.alumno_id
    JOIN deportes d ON i.deporte_id = d.deporte_id
    WHERE i.estado = 'activa' OR i.estado = 'activo'
    ORDER BY d.nombre ASC, a.apellido_paterno ASC
  `;

  const rows = await executeReadOnlyQuery<any>(query);
  rows.forEach((r: any, idx: number) => {
    worksheet.addRow([
      idx + 1,
      r.dni,
      r.alumno,
      r.sexo,
      r.deporte,
      r.fecha_inscripcion,
      r.estado.toUpperCase()
    ]);
  });

  worksheet.columns = [
    { width: 6 },
    { width: 14 },
    { width: 35 },
    { width: 12 },
    { width: 22 },
    { width: 18 },
    { width: 14 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/**
 * Genera un archivo Excel con la ocupación de horarios y cupos.
 */
export async function generateCapacityExcelBuffer(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cupos y Horarios');

  worksheet.mergeCells('A1:G1');
  const titleRow = worksheet.getCell('A1');
  titleRow.value = 'ESCUELA DEPORTIVA JAGUARES - ESTADO DE HORARIOS Y CUPOS';
  titleRow.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
  titleRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E3A8A' }
  };
  titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 30;

  const headers = ['Deporte', 'Día', 'Inicio', 'Fin', 'Ocupados', 'Máximo', '% Ocupación'];
  const headerRow = worksheet.addRow(headers);
  headerRow.height = 22;
  headerRow.eachCell((cell) => {
    cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD97706' } // Ámbar elegante
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  const query = `
    SELECT 
      d.nombre AS deporte,
      h.dia,
      TIME_FORMAT(h.hora_inicio, '%H:%i') AS hora_inicio,
      TIME_FORMAT(h.hora_fin, '%H:%i') AS hora_fin,
      h.cupos_ocupados,
      h.cupo_maximo,
      ROUND((h.cupos_ocupados / h.cupo_maximo) * 100) AS porcentaje
    FROM horarios h
    JOIN deportes d ON h.deporte_id = d.deporte_id
    WHERE h.estado = 'Activo'
    ORDER BY d.nombre, FIELD(h.dia, 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'), h.hora_inicio
  `;

  const rows = await executeReadOnlyQuery<any>(query);
  rows.forEach((r: any) => {
    worksheet.addRow([
      r.deporte,
      r.dia,
      r.hora_inicio,
      r.hora_fin,
      r.cupos_ocupados,
      r.cupo_maximo,
      `${r.porcentaje}%`
    ]);
  });

  worksheet.columns = [
    { width: 22 },
    { width: 14 },
    { width: 10 },
    { width: 10 },
    { width: 12 },
    { width: 12 },
    { width: 14 }
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

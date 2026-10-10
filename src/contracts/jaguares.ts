export interface JagOverview {
  activeStudents: number;
  newStudentsThisMonth: number;
  incomeThisMonth: number;
  pendingDebtAmount: number;
  pendingDebtCount: number;
  topDiscipline?: {
    name: string;
    studentCount: number;
  };
}

export interface JagStudentCounts {
  totalStudents: number;
  activeStudents: number;
  inactiveStudents: number;
  byDiscipline: Array<{
    discipline: string;
    count: number;
  }>;
}

export interface JagIncomeSummary {
  periodLabel: string;
  totalConfirmed: number;
  paymentsCount: number;
  previousPeriod?: {
    periodLabel: string;
    totalConfirmed: number;
    changePct: number | null;
  };
  byMethod: Array<{
    method: string;
    amount: number;
    count: number;
  }>;
}

export interface JagDebtSummary {
  month: string;
  year: number;
  totalDebtAmount: number;
  totalDebtors: number;
  pendingReviewCount: number;
  pendingReviewAmount: number;
  unpaidCount: number;
  unpaidAmount: number;
}

export interface JagPendingDebtor {
  alumnoId: number;
  nombreCompleto: string;
  dni: string;
  monto: number;
  mes: string;
  anio: number;
  status: 'pendiente_revision' | 'sin_pago';
  telefonoApoderado?: string;
}

export interface JagCapacity {
  discipline?: string;
  items: Array<{
    discipline: string;
    totalCapacity: number;
    occupiedCapacity: number;
    availableCapacity: number;
    occupancyPct: number;
  }>;
}

export interface JagEnrollments {
  periodLabel: string;
  newStudentsCount: number;
  totalEnrollmentsCount: number;
  byDiscipline: Array<{
    discipline: string;
    count: number;
  }>;
}

export interface JagRecentStudent {
  alumnoId: number;
  nombreCompleto: string;
  deporte: string;
  fechaInscripcion: string;
}

export interface JagStudentDetail {
  alumnoId: number;
  dni: string;
  nombreCompleto: string;
  nombres: string;
  apellidos: string;
  fechaNacimiento?: string;
  edad?: number;
  apoderado?: string;
  telefonoApoderado?: string;
  estadoAlumno: string;
  disciplinas: Array<{
    deporte: string;
    dia?: string;
    horario?: string;
    precioMensual: number;
  }>;
  deuda: {
    tieneDeuda: boolean;
    totalDeuda: number;
    mesesPendientes: Array<{
      pagoId: number;
      mes: string;
      anio: number;
      monto: number;
      estado: string;
      comprobanteUrl?: string;
    }>;
  };
}

export interface JagVoucherDetail {
  pagoId: number;
  alumnoId: number;
  alumnoNombre: string;
  dni: string;
  telefono?: string;
  monto: number;
  mes?: string;
  anio?: number;
  numeroOperacion?: string;
  metodoPago?: string;
  comprobanteUrl: string;
  estado: string;
  fechaPago?: string;
}

/** Un registro individual de asistencia */
export interface JagAsistenciaRecord {
  fecha: string;        // YYYY-MM-DD
  presente: boolean;
  asistencia_puerta: boolean;
  hora_puerta?: string; // HH:mm
  observaciones?: string;
  deporte: string;
  dia: string;
  hora_inicio: string;
  hora_fin: string;
  categoria: string;
}

/** Respuesta del endpoint GET /api/admin/alumnos/:dni/asistencias */
export interface JagAsistenciasAlumno {
  alumno: {
    alumno_id: number;
    nombres: string;
    apellido_paterno: string;
    apellido_materno: string;
    dni: string;
  };
  asistencias: JagAsistenciaRecord[];
  resumen: {
    total: number;
    presentes: number;
    ausentes: number;
    puerta_ok: number;
    sin_puerta: number;
  };
}

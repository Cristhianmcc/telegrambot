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

/** Clase o horario asignado a un docente con estado de asistencia */
export interface JagDocenteClaseAsistencia {
  admin_id: number;
  profesor: string;
  deporte: string;
  horario_id: number;
  dia: string;
  hora_inicio: string;
  hora_fin: string;
  categoria: string;
  total_alumnos: number;
  presentes: number;
  ausentes: number;
  puerta_ok: number;
  ya_paso_lista: boolean;
}

/** Resumen de control de asistencia de docentes para un día */
export interface JagDocentesControlResumen {
  fecha: string;       // YYYY-MM-DD
  diaNombre: string;   // ej: 'Viernes'
  pasaronLista: JagDocenteClaseAsistencia[];
  pendientes: JagDocenteClaseAsistencia[];
  totalDocentesActivos: number;
}

/** Detalle de alumnos de la clase de un docente */
export interface JagDocenteAlumnosClase {
  profesor: string;
  deporte: string;
  categoria: string;
  horario: string;
  fecha: string;
  alumnos: Array<{
    alumno_id: number;
    dni: string;
    nombre_completo: string;
    presente: boolean;
    asistencia_puerta: boolean;
    hora_puerta?: string;
    observaciones?: string;
  }>;
  resumen: {
    total: number;
    presentes: number;
    ausentes: number;
    puerta_ok: number;
  };
}

/** Alumno que cumple años */
export interface JagBirthdayStudent {
  alumno_id: number;
  dni: string;
  nombre_completo: string;
  fecha_nacimiento: string; // YYYY-MM-DD
  dia: number;
  mes: number;
  edad_cumplir: number;
  telefono?: string;
  apoderado?: string;
  dias_restantes: number; // 0 = hoy, >0 = proximos dias
}

/** Alumno en riesgo de deserción por inasistencias consecutivas o baja asistencia */
export interface JagDropoutRiskStudent {
  alumno_id: number;
  dni: string;
  nombre_completo: string;
  deporte: string;
  telefono?: string;
  apoderado?: string;
  faltas_consecutivas: number;
  total_clases: number;
  presentes: number;
  porcentaje_asistencia: number;
  ultima_clase_fecha?: string;
}

/** Resultado de búsqueda por número de operación bancaria */
export interface JagOperationSearchResult {
  tipo: 'inscripcion' | 'mensualidad';
  alumno_id: number;
  dni: string;
  nombre_completo: string;
  monto: number;
  fecha: string;
  estado: string; // confirmado, pendiente, rechazada
  numero_operacion: string;
  comprobante_url?: string;
  detalle: string; // ej: "Inscripción en Fútbol" o "Mensualidad de Octubre"
}

/** Alumno en ranking o con asistencia perfecta */
export interface JagRankingStudent {
  puesto: number;
  alumno_id: number;
  dni: string;
  nombre_completo: string;
  deporte: string;
  categoria?: string;
  puntos: number;
  porcentaje_asistencia: number;
  clases_asistidas: number;
  total_clases: number;
}



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


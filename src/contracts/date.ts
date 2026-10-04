export type PeriodKind = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'range' | 'rolling';

export interface ResolvedPeriod {
  kind: PeriodKind;
  from: Date;          // Fecha y hora inicio inclusiva
  to: Date;            // Fecha y hora fin exclusiva
  label: string;       // "hoy", "octubre 2026", "septiembre", etc.
  monthName?: string;  // "octubre", "septiembre" (normalizado en español)
  year: number;        // 2026
  isPartial: boolean;  // true si incluye la fecha actual (ej: MTD o hoy)
  previous?: {
    from: Date;
    to: Date;
    label: string;
    monthName?: string;
    year: number;
  };
}

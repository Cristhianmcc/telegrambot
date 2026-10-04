import { ResolvedPeriod } from './date.js';

export type Permission =
  | 'students.read'
  | 'students.finance.read'
  | 'students.debt.list'
  | 'sales.read'
  | 'sales.products.read'
  | 'inventory.read'
  | 'payments.read';

export interface ResultMeta {
  source: string;
  generatedAt: Date;
  period?: {
    label: string;
    from: string;
    to: string;
  };
  approximations?: string[];
  freshness?: Date;
}

export type ToolResult<T> =
  | {
      status: 'ok';
      data: T;
      meta: ResultMeta;
    }
  | {
      status: 'no_data';
      message: string;
      meta: ResultMeta;
    }
  | {
      status: 'error';
      code: string;
      message: string;
    };

export interface TenantContext {
  tenantId: string;
  displayName: string;
  timezone: string;
  permissions: Set<Permission>;
}

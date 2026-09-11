import { z } from 'zod';
import { logAuditEvent } from '../audit/auditLog.js';

export class AccountHttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccountHttpError';
    this.status = status;
  }
}

export const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'credit_card',
  'line_of_credit',
  'loan',
  'investment',
  'cash',
  'other',
];

export const ACCOUNT_STATUSES = ['active', 'archived', 'closed'];
export const RECONCILIATION_STATUSES = ['open', 'resolved'];
export const RECONCILIATION_ACTIONS = ['accept_reported_balance', 'keep_recorded_balance', 'mark_reviewed'];

const accountTypeSchema = z.enum(ACCOUNT_TYPES);
const accountStatusSchema = z.enum(ACCOUNT_STATUSES);

const isoDateTimeSchema = z
  .string()
  .trim()
  .refine((value) => {
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }, 'must be a valid ISO timestamp');

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value.trim()))
  .refine((value) => /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value), {
    message: 'must be a decimal with up to 2 places',
  })
  .transform((value) => {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ''] = unsigned.split('.');
    return `${negative ? '-' : ''}${whole}.${(fraction + '00').slice(0, 2)}`;
  });

const nullableString = z
  .string()
  .nullish()
  .transform((value) => {
    if (value == null) return null;
    const normalized = value.trim();
    return normalized || null;
  });

export const createFinancialAccountSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  accountType: accountTypeSchema.optional(),
  account_type: accountTypeSchema.optional(),
  institution: nullableString,
  currency: z.string().trim().length(3).default('CAD').transform((value) => value.toUpperCase()),
  currentBalance: moneySchema.optional(),
  current_balance: moneySchema.optional(),
  availableBalance: z.union([moneySchema, z.null()]).optional(),
  available_balance: z.union([moneySchema, z.null()]).optional(),
  balanceAsOf: isoDateTimeSchema.optional(),
  balance_as_of: isoDateTimeSchema.optional(),
  isManual: z.boolean().optional(),
  is_manual: z.boolean().optional(),
  status: accountStatusSchema.optional(),
}).transform((value) => ({
  name: value.name,
  accountType: value.accountType ?? value.account_type ?? 'checking',
  institution: value.institution,
  currency: value.currency,
  currentBalance: value.currentBalance ?? value.current_balance ?? '0.00',
  availableBalance: Object.prototype.hasOwnProperty.call(value, 'availableBalance')
    ? value.availableBalance
    : value.available_balance ?? null,
  balanceAsOf: value.balanceAsOf ?? value.balance_as_of ?? new Date().toISOString(),
  isManual: value.isManual ?? value.is_manual ?? true,
  status: value.status ?? 'active',
}));

export const updateFinancialAccountSchema = z.object({
  name: z.string().trim().min(1, 'name is required').optional(),
  accountType: accountTypeSchema.optional(),
  account_type: accountTypeSchema.optional(),
  institution: nullableString.optional(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()).optional(),
  currentBalance: moneySchema.optional(),
  current_balance: moneySchema.optional(),
  availableBalance: z.union([moneySchema, z.null()]).optional(),
  available_balance: z.union([moneySchema, z.null()]).optional(),
  balanceAsOf: isoDateTimeSchema.optional(),
  balance_as_of: isoDateTimeSchema.optional(),
  isManual: z.boolean().optional(),
  is_manual: z.boolean().optional(),
  status: accountStatusSchema.optional(),
}).refine((value) => Object.keys(value).length > 0, 'at least one field is required')
  .transform((value) => ({
    ...(Object.prototype.hasOwnProperty.call(value, 'name') ? { name: value.name } : {}),
    ...(value.accountType || value.account_type ? { accountType: value.accountType ?? value.account_type } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'institution') ? { institution: value.institution } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'currency') ? { currency: value.currency } : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'currentBalance') || Object.prototype.hasOwnProperty.call(value, 'current_balance')
      ? { currentBalance: value.currentBalance ?? value.current_balance }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'availableBalance') || Object.prototype.hasOwnProperty.call(value, 'available_balance')
      ? { availableBalance: Object.prototype.hasOwnProperty.call(value, 'availableBalance') ? value.availableBalance : value.available_balance }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'balanceAsOf') || Object.prototype.hasOwnProperty.call(value, 'balance_as_of')
      ? { balanceAsOf: value.balanceAsOf ?? value.balance_as_of }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'isManual') || Object.prototype.hasOwnProperty.call(value, 'is_manual')
      ? { isManual: value.isManual ?? value.is_manual }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(value, 'status') ? { status: value.status } : {}),
  }));

const createReconciliationSchema = z.object({
  reportedBalance: moneySchema.optional(),
  reported_balance: moneySchema.optional(),
  statementBalance: moneySchema.optional(),
  statement_balance: moneySchema.optional(),
  reportedAsOf: isoDateTimeSchema.optional(),
  reported_as_of: isoDateTimeSchema.optional(),
  source: z.string().trim().min(1).optional(),
  note: nullableString,
}).transform((value) => ({
  reportedBalance: value.reportedBalance ?? value.reported_balance ?? value.statementBalance ?? value.statement_balance,
  reportedAsOf: value.reportedAsOf ?? value.reported_as_of ?? new Date().toISOString(),
  source: value.source ?? 'manual',
  note: value.note,
})).refine((value) => value.reportedBalance != null, {
  path: ['reportedBalance'],
  message: 'reportedBalance is required',
});

const resolveReconciliationSchema = z.object({
  action: z.enum(RECONCILIATION_ACTIONS),
  note: nullableString,
});

function parseMoneyToCents(value) {
  const normalized = moneySchema.parse(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = '00'] = unsigned.split('.');
  const cents = Number(whole) * 100 + Number(fraction);
  return negative ? -cents : cents;
}

function formatCents(cents) {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  return `${negative ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function requireDbContract(db) {
  if (typeof db?.transaction !== 'function') {
    throw new Error('Account DB adapter must implement transaction().');
  }
}

function parseWithSchema(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length > 0 ? issue.path.join('.') : 'request';
    throw new AccountHttpError(400, `${path} ${issue.message}`);
  }

  return result.data;
}

function formatAccount(account) {
  return {
    id: account.id,
    workspace_id: account.workspaceId ?? account.householdId,
    name: account.name,
    account_type: account.accountType,
    institution: account.institution ?? null,
    currency: account.currency,
    current_balance: account.currentBalance,
    available_balance: account.availableBalance ?? null,
    balance_as_of: account.balanceAsOf,
    is_manual: account.isManual !== false,
    status: account.status ?? 'active',
    created_at: account.createdAt,
    updated_at: account.updatedAt,
  };
}

function formatReconciliation(row) {
  return {
    id: row.id,
    workspace_id: row.workspaceId ?? row.householdId,
    account_id: row.accountId,
    recorded_balance: row.recordedBalance,
    reported_balance: row.reportedBalance,
    discrepancy: row.discrepancy,
    reported_as_of: row.reportedAsOf,
    source: row.source ?? 'manual',
    status: row.status ?? 'open',
    resolved_action: row.resolvedAction ?? null,
    note: row.note ?? null,
    resolved_at: row.resolvedAt ?? null,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

async function requireAccount(tx, householdId, accountId) {
  const account = await tx.getFinancialAccountById({ householdId, accountId });
  if (!account) {
    throw new AccountHttpError(404, 'financial account not found');
  }
  return account;
}

export async function getFinancialAccount({ db, householdId, accountId }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  requireDbContract(db);
  return db.transaction(async (tx) => formatAccount(await requireAccount(tx, householdId, accountId)));
}

export async function listFinancialAccounts({ db, householdId }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  requireDbContract(db);
  return db.transaction(async (tx) => ({
    items: (await tx.listFinancialAccounts({ householdId })).map(formatAccount),
  }));
}

export async function createFinancialAccount({ db, householdId, input, userId = null }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  requireDbContract(db);
  const parsed = parseWithSchema(createFinancialAccountSchema, input);
  return db.transaction(async (tx) => {
    const account = await tx.insertFinancialAccount({
      householdId,
      workspaceId: householdId,
      ...parsed,
    });
    await logAuditEvent({
      tx,
      workspaceId: householdId,
      userId,
      event: 'account.created',
      entityId: account.id,
      metadata: {
        entityType: 'account',
        accountType: account.accountType,
        isManual: account.isManual !== false,
      },
    });
    return formatAccount(account);
  });
}

export async function updateFinancialAccount({ db, householdId, accountId, input, userId = null }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  requireDbContract(db);
  const parsed = parseWithSchema(updateFinancialAccountSchema, input);
  return db.transaction(async (tx) => {
    await requireAccount(tx, householdId, accountId);
    const account = await tx.updateFinancialAccount({ householdId, accountId, patch: parsed });
    await logAuditEvent({
      tx,
      workspaceId: householdId,
      userId,
      event: 'account.updated',
      entityId: accountId,
      metadata: {
        entityType: 'account',
        changedFields: Object.keys(parsed),
      },
    });
    return formatAccount(account);
  });
}

export async function createAccountReconciliation({ db, householdId, accountId, input, userId = null }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  requireDbContract(db);
  const parsed = parseWithSchema(createReconciliationSchema, input);
  return db.transaction(async (tx) => {
    const account = await requireAccount(tx, householdId, accountId);
    const recordedBalance = account.currentBalance ?? '0.00';
    const discrepancy = formatCents(parseMoneyToCents(parsed.reportedBalance) - parseMoneyToCents(recordedBalance));
    const reconciliation = await tx.insertAccountReconciliation({
      householdId,
      workspaceId: householdId,
      accountId,
      recordedBalance,
      reportedBalance: parsed.reportedBalance,
      discrepancy,
      reportedAsOf: parsed.reportedAsOf,
      source: parsed.source,
      status: 'open',
      resolvedAction: null,
      note: parsed.note,
      resolvedAt: null,
    });
    await logAuditEvent({
      tx,
      workspaceId: householdId,
      userId,
      event: 'account.reconciliation_created',
      entityId: reconciliation.id,
      metadata: {
        entityType: 'account_reconciliation',
        accountId,
        source: parsed.source,
      },
    });
    return formatReconciliation(reconciliation);
  });
}

export async function listAccountReconciliations({ db, householdId, accountId }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  requireDbContract(db);
  return db.transaction(async (tx) => {
    await requireAccount(tx, householdId, accountId);
    return {
      items: (await tx.listAccountReconciliations({ householdId, accountId })).map(formatReconciliation),
    };
  });
}

export async function resolveAccountReconciliation({ db, householdId, accountId, reconciliationId, input, userId = null }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  if (!reconciliationId) throw new AccountHttpError(400, 'reconciliationId is required');
  requireDbContract(db);
  const parsed = parseWithSchema(resolveReconciliationSchema, input);
  return db.transaction(async (tx) => {
    const account = await requireAccount(tx, householdId, accountId);
    const reconciliation = await tx.getAccountReconciliationById({ householdId, accountId, reconciliationId });
    if (!reconciliation) throw new AccountHttpError(404, 'account reconciliation not found');
    if ((reconciliation.status ?? 'open') !== 'open') throw new AccountHttpError(409, 'account reconciliation is already resolved');

    if (parsed.action === 'accept_reported_balance') {
      await tx.updateFinancialAccount({
        householdId,
        accountId: account.id,
        patch: {
          currentBalance: reconciliation.reportedBalance,
          balanceAsOf: reconciliation.reportedAsOf,
        },
      });
    }

    const updated = await tx.updateAccountReconciliation({
      householdId,
      accountId,
      reconciliationId,
      patch: {
        status: 'resolved',
        resolvedAction: parsed.action,
        note: parsed.note ?? reconciliation.note ?? null,
        resolvedAt: new Date().toISOString(),
      },
    });

    await logAuditEvent({
      tx,
      workspaceId: householdId,
      userId,
      event: 'account.reconciliation_resolved',
      entityId: reconciliationId,
      metadata: {
        entityType: 'account_reconciliation',
        accountId,
        action: parsed.action,
      },
    });

    return formatReconciliation(updated);
  });
}

export async function deleteAccountReconciliation({ db, householdId, accountId, reconciliationId, userId = null }) {
  if (!householdId) throw new AccountHttpError(400, 'householdId is required');
  if (!accountId) throw new AccountHttpError(400, 'accountId is required');
  if (!reconciliationId) throw new AccountHttpError(400, 'reconciliationId is required');
  requireDbContract(db);

  return db.transaction(async (tx) => {
    await requireAccount(tx, householdId, accountId);
    const reconciliation = await tx.getAccountReconciliationById({ householdId, accountId, reconciliationId });
    if (!reconciliation) throw new AccountHttpError(404, 'account reconciliation not found');
    if ((reconciliation.status ?? 'open') !== 'open') {
      throw new AccountHttpError(409, 'only open account reconciliations can be deleted');
    }

    if (typeof tx.deleteAccountReconciliation !== 'function') {
      throw new AccountHttpError(500, 'account reconciliation deletion is not supported');
    }

    await tx.deleteAccountReconciliation({ householdId, accountId, reconciliationId });
    await logAuditEvent({
      tx,
      workspaceId: householdId,
      userId,
      event: 'account.reconciliation_deleted',
      entityId: reconciliationId,
      metadata: {
        entityType: 'account_reconciliation',
        accountId,
      },
    });
    return true;
  });
}

export async function ensureFinancialAccountExists(tx, householdId, accountId) {
  if (!accountId) return null;
  const account = await tx.getFinancialAccountById?.({ householdId, accountId });
  if (!account) {
    throw new AccountHttpError(404, 'financial account not found');
  }
  if ((account.status ?? 'active') !== 'active') {
    throw new AccountHttpError(422, 'financial account is not active');
  }
  return account;
}

export const __internal = {
  createFinancialAccountSchema,
  updateFinancialAccountSchema,
  createReconciliationSchema,
  parseMoneyToCents,
  formatCents,
};

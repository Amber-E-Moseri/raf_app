import { buildDataExport, rowsToCsv } from '../../../../lib/exports/buildDataExport.js';
import { getDb, getHouseholdId, json } from '../_shared/http.js';

/**
 * GET /api/v1/exports
 *
 * Query params:
 *   format  - "json" (default) | "csv"
 *   from    - ISO month start date YYYY-MM-DD (optional, inclusive)
 *   to      - ISO month start date YYYY-MM-DD (optional, inclusive)
 *
 * Returns the workspace's financial data in the requested format.
 * Requires financial:read permission (enforced by auth middleware).
 * No raw bank statement text, PDF content, or account numbers are exported.
 */
export async function GET(request, context) {
  const db = getDb(context);
  const householdId = getHouseholdId(request, context);
  if (!householdId) {
    return json({ error: 'Workspace context required.' }, 400);
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') ?? 'json';
  const fromMonth = url.searchParams.get('from') ?? null;
  const toMonth = url.searchParams.get('to') ?? null;

  if (!['json', 'csv'].includes(format)) {
    return json({ error: 'format must be "json" or "csv"' }, 400);
  }

  const data = await buildDataExport({ db, householdId, fromMonth, toMonth });

  if (format === 'csv') {
    const txCsv = rowsToCsv(
      ['id', 'date', 'merchant', 'description', 'amount', 'direction', 'category_slug', 'source'],
      data.transactions,
    );
    return new Response(txCsv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return json(data, 200);
}

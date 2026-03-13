import { importBankStatement } from '../../../../../lib/imports/bankStatementImports.js';
import { ImportHttpError } from '../../../../../lib/imports/shared.js';

function json(body, status) {
  return Response.json(body, { status });
}

function getHouseholdId(request, context) {
  return context?.householdId ?? request.headers.get('x-household-id') ?? request.headers.get('x-household_id');
}

function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function POST(request, context = {}) {
  try {
    let file = null;
    const contentType = request.headers.get('content-type') ?? '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const uploaded = formData.get('file');
      if (!(uploaded instanceof File)) {
        throw new ImportHttpError(400, 'file is required');
      }
      file = uploaded;
    } else {
      const buffer = new Uint8Array(await request.arrayBuffer());
      if (buffer.length === 0) {
        throw new ImportHttpError(400, 'file is required');
      }

      file = new File(
        [buffer],
        request.headers.get('x-filename') ?? 'bank-statement.pdf',
        { type: contentType || 'application/pdf' },
      );
    }

    const result = await importBankStatement({
      db: getDb(context),
      householdId: getHouseholdId(request, context),
      pdfTextExtractor: context?.pdfTextExtractor,
      input: {
        filename: file.name,
        contentType: file.type,
        pdfBuffer: new Uint8Array(await file.arrayBuffer()),
      },
    });

    return json(result, 201);
  } catch (error) {
    if (error instanceof ImportHttpError) {
      return json({
        error: error.message,
        ...(error.details ? error.details : {}),
      }, error.status);
    }

    return json({ error: 'Internal Server Error' }, 500);
  }
}

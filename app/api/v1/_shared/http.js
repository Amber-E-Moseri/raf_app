const ERROR_CODE_BY_STATUS = new Map([
  [400, 'VALIDATION_ERROR'],
  [401, 'UNAUTHORIZED'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [422, 'BUSINESS_RULE'],
]);

export function json(body, status = 200) {
  return Response.json(body, { status });
}

export function getHouseholdId(request, context) {
  return context?.householdId ?? request.headers.get('x-household-id') ?? request.headers.get('x-household_id');
}

export function assertWorkspaceParam(context = {}, params = {}) {
  const requestedWorkspaceId = params?.id ?? params?.workspaceId ?? null;
  if (!requestedWorkspaceId) {
    return null;
  }

  const trustedWorkspaceId = context?.workspaceId ?? context?.workspace?.id ?? context?.householdId ?? null;
  if (!trustedWorkspaceId) {
    return json({ error: 'Workspace context is required.' }, 401);
  }

  if (String(requestedWorkspaceId) !== String(trustedWorkspaceId)) {
    return json({ error: 'Workspace access denied.' }, 403);
  }

  return null;
}

export function getDb(context) {
  return context?.db ?? globalThis.__RAF_DB__;
}

export async function readJsonBody(request, errorFactory) {
  try {
    return await request.json();
  } catch {
    throw errorFactory();
  }
}

export function buildErrorBody({ status, message, details = undefined }) {
  return {
    error: message,
    errorCode: ERROR_CODE_BY_STATUS.get(status) ?? 'ERROR',
    ...(details != null ? { details } : {}),
  };
}

export function respondWithHandledError(error, KnownHttpErrorClass) {
  if (error instanceof KnownHttpErrorClass) {
    return json(
      buildErrorBody({
        status: error.status,
        message: error.message,
        details: error.details,
      }),
      error.status,
    );
  }

  console.error('[RAF] Unhandled route error:', error?.message, error?.stack);
  return json(
    buildErrorBody({
      status: 500,
      message: 'Internal Server Error',
    }),
    500,
  );
}

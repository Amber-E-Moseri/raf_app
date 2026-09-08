import crypto from 'node:crypto';

export const uuid = () => crypto.randomUUID();
export const isoNow = () => new Date().toISOString();
export const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

export function withIdentity(row) {
  if (!row) return null;
  const json = row.raw_json ?? {};
  const wid = row.workspace_id ?? json.workspaceId ?? json.householdId;
  return { ...json, id: row.id ?? json.id, workspaceId: wid, householdId: wid };
}

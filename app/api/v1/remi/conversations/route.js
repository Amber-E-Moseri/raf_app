import { json, getDb, getHouseholdId } from '../../_shared/http.js';

export async function GET(request, context) {
  const db = getDb(context);
  const householdId = getHouseholdId(request, context);
  const userId = context?.userId ?? 'local-user';

  const user = await db.transaction((tx) => tx.getUserById({ userId }));
  if (user?.remiTier !== 'paid') {
    return json({ error: 'Conversation history requires a paid Remi plan', tier: 'free' }, 403);
  }

  const conversations = await db.transaction((tx) => tx.listRemiConversations({ householdId, userId }));
  return json({ conversations });
}

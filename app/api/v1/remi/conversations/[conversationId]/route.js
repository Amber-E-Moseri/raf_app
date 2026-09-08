import { json, getDb, getHouseholdId } from '../../../_shared/http.js';

export async function GET(request, context) {
  const db = getDb(context);
  const householdId = getHouseholdId(request, context);
  const userId = context?.userId ?? 'local-user';
  const conversationId = context?.params?.conversationId;

  const user = await db.transaction((tx) => tx.getUserById({ userId }));
  if (user?.remiTier !== 'paid') {
    return json({ error: 'Conversation history requires a paid Remi plan', tier: 'free' }, 403);
  }

  const conversation = await db.transaction((tx) => tx.getRemiConversation({ conversationId, householdId }));
  if (!conversation) {
    return json({ error: 'Conversation not found' }, 404);
  }

  const messages = await db.transaction((tx) => tx.listRemiMessages({ conversationId, householdId }));
  return json({ conversation, messages });
}

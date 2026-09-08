import Anthropic from '@anthropic-ai/sdk';

function buildExtractionPrompt(allocationCategories) {
  const categoryContext = Array.isArray(allocationCategories) && allocationCategories.length > 0
    ? `\nThis household uses these allocation categories (buckets): ${allocationCategories.map((c) => `"${c.label ?? c.slug}"`).join(', ')}.\nFor each transaction, add a "suggested_category_slug" field with your best guess at which bucket the spending belongs to (use the slug, or null if it's income or unclear).\n`
    : '';

  return `Extract all financial transactions from the bank statement text below.
Return a JSON array with this exact structure for each transaction:
[
  {
    "date": "YYYY-MM-DD",
    "description": "merchant or description",
    "amount": "-50.00 or 100.50 (signed decimal)",
    "raw_description": "full description as shown"${allocationCategories?.length ? ',\n    "suggested_category_slug": "savings"' : ''}
  },
  ...
]

Rules:
- Dates must be in YYYY-MM-DD format. If the year is ambiguous, assume the current year.
- Amounts: negative for debits/withdrawals, positive for credits/deposits.
- Description: cleaned merchant name or transaction type (normalize abbreviations like "GOOGLE*PLAY" → "Google Play").
- Include all transactions, skip headers, footers, and summary lines.${categoryContext}
- Return ONLY valid JSON - no markdown fence, no explanation.

Bank statement text:
`;
}

export async function parseWithAI(text, options = {}) {
  const { apiKey = null, statementContext = null, allocationCategories = null } = options;

  if (!apiKey) {
    return {
      rows: null,
      error: 'ANTHROPIC_API_KEY not configured',
    };
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: buildExtractionPrompt(allocationCategories) + text,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return {
        rows: null,
        error: 'Unexpected response format from Claude',
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(content.text);
    } catch (parseError) {
      return {
        rows: null,
        error: `Claude response was not valid JSON: ${parseError.message}`,
      };
    }

    if (!Array.isArray(parsed)) {
      return {
        rows: null,
        error: 'Claude response was not a JSON array',
      };
    }

    const rows = parsed.map((item) => {
      const date = String(item.date ?? '').trim();
      const description = String(item.description ?? '').trim();
      const amount = String(item.amount ?? '').trim();
      const rawDescription = String(item.raw_description ?? description).trim();
      const suggestedCategorySlug = item.suggested_category_slug != null
        ? String(item.suggested_category_slug).trim() || null
        : null;

      return {
        date,
        description,
        amount,
        rawDescription,
        suggestedCategorySlug,
        referenceNumber: null,
        balanceAfterTransaction: null,
      };
    });

    return {
      rows,
      error: null,
    };
  } catch (error) {
    return {
      rows: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export const __internal = {
  parseWithAI,
};

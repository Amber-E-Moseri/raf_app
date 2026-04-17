# Code Citations

## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


## License: unknown
https://github.com/thegooglecodearchive/heurist/blob/1868f53a6b313d7a4f4992697e72ad4765471095/common/js/temporalObjectLibrary.js

```
## ✅ Production-Ready Bank Statement Pipeline (TypeScript)

I'll build a sophisticated pipeline that repairs malformed PDF extraction and parses BMO (with CIBC extensibility planned). This handles your exact case: `5.6469.20` → `["5.64", "69.20"]`.

---

## 📁 Suggested file structure

```
src/
  parsers/
    bankStatementTypes.ts
    bankStmtRepair.ts
    bankStmtPreprocess.ts
    bankDetection.ts
    BankStatementParser.ts
    BmoStatementParser.ts
  orchestrator/
    parseBankStatement.ts
  tests/
    sampleBmoRaw.ts
    parseBankStatement.test.ts
```

---

## 1️⃣ Type definitions

```ts
// src/parsers/bankStatementTypes.ts

export type TransactionType = "expense" | "income";

export type ParsedTransaction = {
  date: string; // YYYY-MM-DD
  description: string;
  rawDescription: string;
  amount: number;
  type: TransactionType;
  balance: number | null;
  sourceBank: string;
  parserName: string;
};

export type SkippedLine = { line: string; reason: string };

export type ParseResult = {
  bank: string | null;
  parserUsed: string | null;
  confidence: number;
  transactions: ParsedTransaction[];
  skippedLines: SkippedLine[];
  warnings: string[];
  repairedBlocks: string[];
};

export type DetectionResult = {
  bank: string;
  confidence: number;
  evidence: Array<{ clue: string; weight: number }>;
};

export type ParseOptions = {
  bankOverride?: string;
  allowOpeningBalance?: boolean;
  strictRepair?: boolean;
};

export interface BankStatementParser {
  bankId: string;
  parserName: string;
  canDetect(rawText: string): DetectionResult | null;
  parse(blocks: string[], year: number, options?: ParseOptions): {
    transactions: ParsedTransaction[];
    skippedLines: SkippedLine[];
    warnings: string[];
  };
}
```

---

## 2️⃣ Repair stage (core innovation)

```ts
// src/parsers/bankStmtRepair.ts

/**
 * Repair strategy for common PDF extraction damage.
 * Key insight: monetary amounts in bank statements follow pattern XXXXX.XX
 * When two amounts fuse, we get XXXXX.XXXXXXXX (8+ digit decimal)
 * We can recover by detecting and splitting adjacent .XX patterns.
 */

export function detectFusedAmounts(token: string): string[] {
  const normalized = token.trim();
  
  // Check if token looks like two fused amounts: matches \d+\.\d{2}\d+\.\d{2}
  const fusedMatch = normalized.match(/^(-?\$?)(\d+\.\d{2})(\d+\.\d{2})$/);
  if (fusedMatch) {
    const prefix = fusedMatch[1];
    const first = fusedMatch[2];
    const second = fusedMatch[3];
    return [prefix + first, prefix + second];
  }

  // Handle the case: 5.6469.20 (spacing destroyed but decimal patterns detectable)
  // Regex: looks for \d+\.\d{2} followed immediately by \d+\.\d{2}
  const collapsedPatternMatch = normalized.match(
    /^(-?\$?)(\d+)\.(\d{2})(\d+)\.(\d{2})$/
  );
  if (collapsedPatternMatch) {
    const [, prefix, first_int, first_dec, second_int, second_dec] = collapsedPatternMatch;
    const amt1 = `${prefix}${first_int}.${first_dec}`;
    const amt2 = `${prefix}${second_int}.${second_dec}`;
    return [amt1, amt2];
  }

  return [normalized];
}

export function tokenizeByWhitespace(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * Attempt to detect and repair fused amount columns in a candidate block.
 * Conservative: only splits if pattern is unambiguous.
 */
export function repairCollapsedAmounts(
  block: string,
): { repaired: string; repairNotes: string[] } {
  const notes: string[] = [];
  const tokens = tokenizeByWhitespace(block);

  const repairedTokens = tokens.map((token, idx) => {
    const split = detectFusedAmounts(token);
    if (split.length > 1) {
      notes.push(
        `Repaired token at position ${idx}: "${token}" → ${split.map((s) => `"${s}"`).join(", ")}`
      );
      return split;
    }
    return [token];
  });

  const flattened = repairedTokens.flat();
  return {
    repaired: flattened.join(" "),
    repairNotes: notes,
  };
}
```

---

## 3️⃣ Preprocessing stage

```ts
// src/parsers/bankStmtPreprocess.ts

export function normalizeText(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00A0/g, " ") // non-breaking space
    .replace(/[ \t]+/g, " ") // collapse consecutive spaces/tabs
    .trim();
}

export function startsWithTransactionDate(line: string): boolean {
  const normalized = line.trim();
  // Match: "Feb 10", "Feb10", "2026-02-10", "10/02", etc.
  return /^(?:[A-Za-z]{3,9}\s*\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})/.test(
    normalized
  );
}

/**
 * Split raw text into candidate transaction blocks.
 * Merges lines that don't start with dates into the current block.
 */
export function splitIntoCandidateBlocks(text: string): string[] {
  const normalized = normalizeText(text);
  const lines = normalized.split("\n").map((l) => l.trim()).filter(Boolean);

  const blocks: string[] = [];
  let currentBlock = "";

  for (const line of lines) {
    if (startsWithTransactionDate(line)) {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = line;
    } else {
      if (currentBlock) {
        currentBlock += ` ${line}`;
      } else {
        blocks.push(line);
      }
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Filter out obvious non-transaction lines.
 */
export function isLikelyTransactionBlock(block: string): boolean {
  const lower = block.toLowerCase();

  // Skip metadata
  if (
    /^(page|account|statement|period|opening\s+balance|closing\s+balance|here's|amounts|date|description|balance)/i.test(
      lower
    ) &&
    !lower.includes("pre-authorized")
  ) {
    return false;
  }

  // Must start with date
  return startsWithTransactionDate(block);
}
```

---

## 4️⃣ Bank detection

```ts
// src/parsers/bankDetection.ts

import { DetectionResult } from "./bankStatementTypes";

export function detectBank(rawText: string): DetectionResult | null {
  const lc = rawText.toLowerCase();
  let confidence = 0;
  const evidence: DetectionResult["evidence"] = [];

  // BMO clues (weight in ascending order of specificity)
  const bmoClues: Array<[string, number]> = [
    ["everyday banking", 15],
    ["here's what happened in your account", 30],
    ["amounts deducted from your account", 35],
    ["amounts added to your account", 35],
    ["primary chequing account", 20],
    ["interac e-transfer", 10],
  ];

  let bmoScore = 0;
  for (const [clue, weight] of bmoClues) {
    if (lc.includes(clue)) {
      bmoScore += weight;
      evidence.push({ clue, weight });
    }
  }

  if (bmoScore >= 40) {
    return {
      bank: "BMO",
      confidence: Math.min(bmoScore, 100),
      evidence,
    };
  }

  return null;
}
```

---

## 5️⃣ Core parsing utilities

```ts
// src/parsers/BankStatementParser.ts

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04",
  may: "05", jun: "06", jul: "07", aug: "08",
  sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseDate
```


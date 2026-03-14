import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("imported transaction review UI requires bucket assignment for approvals", async () => {
  const source = await readFile(new URL("../src/pages/Transactions.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /Leave unassigned/);
  assert.match(source, /Select allocation bucket/);
  assert.match(source, /Remember this choice/);
  assert.match(source, /must end in an allocation bucket/);
});

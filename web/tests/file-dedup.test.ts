import assert from "node:assert/strict";
import test from "node:test";
import { normalizedDuplicateFileName, splitDuplicateFiles } from "../lib/file-dedup.ts";

test("numeric parenthetical copy markers are ignored in duplicate names", () => {
  assert.equal(normalizedDuplicateFileName("CallLog.wav"), "calllog.wav");
  assert.equal(normalizedDuplicateFileName("CallLog (1).wav"), "calllog.wav");
  assert.equal(normalizedDuplicateFileName("CallLog (27) (2).wav"), "calllog.wav");
});

test("same normalized name and size is skipped", () => {
  const original = { name: "CallLog.wav", size: 4096 };
  const copy = { name: "CallLog (1).wav", size: 4096 };
  const result = splitDuplicateFiles([copy], [{ file_name: original.name, file_size_bytes: original.size }]);
  assert.deepEqual(result.unique, []);
  assert.deepEqual(result.duplicates, [copy]);
});

test("same normalized name with a different size is retained", () => {
  const changed = { name: "CallLog (1).wav", size: 8192 };
  const result = splitDuplicateFiles([changed], [{ file_name: "CallLog.wav", file_size_bytes: 4096 }]);
  assert.deepEqual(result.unique, [changed]);
  assert.deepEqual(result.duplicates, []);
});

test("duplicates within one newly selected batch are also skipped", () => {
  const first = { name: "CallLog (1).wav", size: 4096 };
  const second = { name: "CallLog (2).wav", size: 4096 };
  const result = splitDuplicateFiles([first, second], []);
  assert.deepEqual(result.unique, [first]);
  assert.deepEqual(result.duplicates, [second]);
});

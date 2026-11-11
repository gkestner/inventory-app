import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { readReminderEmailRecipients, saveReminderEmailLinks } from "./reminder-email-contacts";

test("email-only fields distinguish missing from cleared and normalize duplicate addresses", () => {
  const form = new FormData();
  assert.equal(readReminderEmailRecipients(form), undefined);
  form.set("emailRecipients", "");
  assert.deepEqual(readReminderEmailRecipients(form), []);
  form.set("emailRecipients", "Vendor@example.invalid\nservice@example.invalid, VENDOR@example.invalid");
  assert.deepEqual(readReminderEmailRecipients(form), ["vendor@example.invalid", "service@example.invalid"]);
});

test("email-only recipients reject malformed, header-shaped, and oversized inputs", () => {
  const form = new FormData();
  for (const bad of ["missing-mailbox", "Display Name <someone@example.invalid>", "one@example.invalid\rBcc: target@example.invalid", "a\0@example.invalid"]) {
    form.set("emailRecipients", bad);
    assert.throws(() => readReminderEmailRecipients(form), /valid email addresses/);
  }
  form.set("emailRecipients", Array.from({ length: 51 }, (_, i) => `${i}@example.invalid`).join(","));
  assert.throws(() => readReminderEmailRecipients(form), /at most 50/);
});

test("an app account cannot be added as an email-only contact", async () => {
  const tx = { $queryRaw: async () => [{ email: "existing@example.invalid" }] } as unknown as Prisma.TransactionClient;
  await assert.rejects(saveReminderEmailLinks(tx, { listId: "section" }, ["existing@example.invalid"]), /belongs to an app account/);
});

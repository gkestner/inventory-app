import assert from "node:assert/strict";
import { test } from "node:test";
import { authorizePmReminderRequest, reminderTokenMatches } from "./reminder-auth";

test("PM integration fails closed without configured token or with wrong token", () => {
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api?token=anything"), {}), false);
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api?token=bad"), { CRON_SECRET: "good" }), false);
  assert.equal(reminderTokenMatches(undefined, undefined), false);
});

test("PM integration retains legacy headers/query tokens and accepts scheduled bearer secret", () => {
  const secrets = { PM_COMPLIANCE_REMINDER_TOKEN: "legacy", PM_REMINDER_SYNC_TOKEN: "sync", MOCREO_SYNC_TOKEN: "mocreo", CRON_SECRET: "cron" };
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api?token=legacy"), secrets), true);
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api", { headers: { "x-pm-reminder-token": "sync" } }), secrets), true);
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api", { headers: { authorization: "Bearer cron" } }), secrets), true);
  assert.equal(authorizePmReminderRequest(new Request("https://example.test/api", { headers: { authorization: "Bearer mocreo" } }), secrets), true);
});

import { REMINDER_EMAIL_INPUT_LIMIT, REMINDER_EMAIL_LIMIT } from "@/app/lib/reminder-recipients";
import styles from "./compliance.module.css";

export default function EmailRecipientField({ addresses = [] }: { addresses?: string[] }) {
  return <label className={`${styles.notesLabel} ${styles.full}`}>Email-only recipients
    <textarea name="emailRecipients" rows={3} maxLength={REMINDER_EMAIL_INPUT_LIMIT} defaultValue={addresses.join("\n")} placeholder="vendor@example.com" />
    <small>Enter up to {REMINDER_EMAIL_LIMIT} addresses, one per line or separated by commas. Use the user picker for app accounts.</small>
  </label>;
}

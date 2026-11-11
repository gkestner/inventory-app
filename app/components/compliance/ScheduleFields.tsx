"use client";

import { useState } from "react";
import { formatReminderDate, reminderSchedule } from "@/app/lib/reminder-dates";
import styles from "./compliance.module.css";

export default function ScheduleFields({ initialInterval, defaultMonths, locationLabel }: {
  initialInterval: string; defaultMonths: number; locationLabel: string;
}) {
  const [date, setDate] = useState("");
  const [interval, setInterval] = useState(initialInterval);
  const changed = date || interval !== initialInterval;
  const due = reminderSchedule(date, interval, defaultMonths)?.nextDueOn;
  const preview = due && due.getUTCFullYear() <= 9999 ? formatReminderDate(due) : null;
  return <div className={styles.fieldStack}>
    <label>Service date<input name="serviceDate" type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label={`Service date for ${locationLabel}`} required /></label>
    <label>Repeat every (months)<input name="intervalMonths" type="number" min="1" max="120" step="1" placeholder={String(defaultMonths)} value={interval} onChange={(event) => setInterval(event.target.value)} aria-label={`Reminder interval for ${locationLabel}`} /></label>
    <small>Blank uses section default: {defaultMonths} months</small>
    {changed && <small role="status" className={styles.schedulePreview}>{preview ? `After saving: ${preview}` : "Enter a valid date and interval to calculate the next due date."}</small>}
  </div>;
}

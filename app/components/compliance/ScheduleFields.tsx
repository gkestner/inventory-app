"use client";

import { useState } from "react";
import { addReminderMonths, formatReminderDate, parseReminderDate, parseReminderMonths } from "@/app/lib/reminder-dates";
import styles from "./compliance.module.css";

export default function ScheduleFields({ formId, dateName, intervalName, initialDate, initialInterval, defaultMonths, locationLabel, custom, required = false }: {
  formId: string; dateName: string; intervalName: string; initialDate: string; initialInterval: string; defaultMonths: number; locationLabel: string; custom: boolean; required?: boolean;
}) {
  const [date, setDate] = useState(initialDate);
  const [interval, setInterval] = useState(initialInterval);
  const changed = date !== initialDate || interval !== initialInterval;
  const parsed = parseReminderDate(date);
  const months = parseReminderMonths(interval, defaultMonths);
  const due = parsed && months ? addReminderMonths(parsed, months) : null;
  const preview = due && due.getUTCFullYear() <= 9999 ? formatReminderDate(due) : null;
  return <div className={styles.fieldStack}>
    <label>{custom ? "Starting date" : "Service date"}<input form={formId} name={dateName} type={!date || parsed ? "date" : "text"} value={date} onChange={(event) => setDate(event.target.value)} aria-label={`Service date for ${locationLabel}`} required={required} /></label>
    <label>Repeat every (months)<input form={formId} name={intervalName} type="number" min="1" max="120" step="1" placeholder={String(defaultMonths)} value={interval} onChange={(event) => setInterval(event.target.value)} aria-label={`Reminder interval for ${locationLabel}`} /></label>
    <small>Blank uses section default: {defaultMonths} months</small>
    {changed && <small role="status" className={styles.schedulePreview}>{preview ? `After saving: ${preview}` : "Enter a valid date and interval to calculate the next due date."}</small>}
  </div>;
}

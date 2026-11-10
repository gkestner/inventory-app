"use client";

import { useId, useState } from "react";
import styles from "./compliance.module.css";

type Person = { id: string; name: string; email: string };

export default function RecipientPicker({ users, selectedIds, name = "recipientIds", formId, label = "Notification recipients" }: {
  users: Person[]; selectedIds: string[]; name?: string; formId?: string; label?: string;
}) {
  const searchId = useId();
  const [selected, setSelected] = useState(selectedIds);
  const [query, setQuery] = useState("");
  const visible = users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  const unavailable = selected.filter((id) => !users.some((user) => user.id === id));
  const toggle = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  return <div className={styles.recipientPicker}>
    {selected.map((id) => <input key={id} type="hidden" form={formId} name={name} value={id} />)}
    <details>
      <summary>{label} <span className={styles.count}>{selected.length} selected</span></summary>
      <div className={styles.pickerBody}>
        <label htmlFor={searchId}>Find a person</label>
        <input id={searchId} type="search" placeholder="Search names or email addresses…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className={styles.pickerTools}>
          <button type="button" onClick={() => setSelected(users.map((user) => user.id))}>Select all active users</button>
          <button type="button" onClick={() => setSelected([])}>Clear selection</button>
        </div>
        <div className={styles.people}>
          {visible.map((user) => <label className={styles.person} key={user.id}>
            <input type="checkbox" checked={selected.includes(user.id)} onChange={() => toggle(user.id)} />
            <span><strong>{user.name || user.email}</strong><small>{user.email}</small></span>
          </label>)}
          {visible.length === 0 && <p className={styles.muted}>No matching users.</p>}
          {unavailable.map((id) => <label key={id} className={styles.person}><input type="checkbox" checked onChange={() => toggle(id)} /><span>Previously assigned user<small>Inactive or unavailable — remove before saving.</small></span></label>)}
        </div>
      </div>
    </details>
  </div>;
}

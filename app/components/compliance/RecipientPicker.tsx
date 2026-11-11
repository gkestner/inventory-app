"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import styles from "./compliance.module.css";

type Person = { id: string; name: string; email: string };
const Directory = createContext<Person[]>([]);

export function RecipientDirectory({ users, children }: { users: Person[]; children: ReactNode }) {
  return <Directory.Provider value={users}>{children}</Directory.Provider>;
}

export default function RecipientPicker({ selectedIds, name = "recipientIds", label = "Notification recipients" }: {
  selectedIds: string[]; name?: string; label?: string;
}) {
  const users = useContext(Directory);
  const searchId = useId();
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState(selectedIds);
  const [query, setQuery] = useState("");
  const search = query.trim().toLowerCase();
  const visible = loaded ? users.filter(({ name, email }) => `${name} ${email}`.toLowerCase().includes(search)) : [];
  const available = new Set(loaded ? users.map(({ id }) => id) : []);
  const unavailable = loaded ? selected.filter((id) => !available.has(id)) : [];
  const checked = new Set(selected);
  const toggle = (id: string) => setSelected((previous) => previous.includes(id) ? previous.filter((value) => value !== id) : [...previous, id]);
  return <div className={styles.recipientPicker}>
    {selected.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
    <details onToggle={(event) => { if (event.currentTarget.open) setLoaded(true); }}>
      <summary>{label} <span className={styles.count}>{selected.length} selected</span></summary>
      {loaded && <div className={styles.pickerBody}>
        <label htmlFor={searchId}>Find a person</label>
        <input id={searchId} type="search" placeholder="Search names or email addresses…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className={styles.pickerTools}>
          <button type="button" onClick={() => setSelected(users.map((user) => user.id))}>Select all active users</button>
          <button type="button" onClick={() => setSelected([])}>Clear selection</button>
        </div>
        <div className={styles.people}>
          {visible.map((user) => <label className={styles.person} key={user.id}>
            <input type="checkbox" checked={checked.has(user.id)} onChange={() => toggle(user.id)} />
            <span><strong>{user.name || user.email}</strong><small>{user.email}</small></span>
          </label>)}
          {visible.length === 0 && <p className={styles.muted}>No matching users.</p>}
          {unavailable.map((id) => <label key={id} className={styles.person}><input type="checkbox" checked onChange={() => toggle(id)} /><span>Previously assigned user<small>Inactive or unavailable — remove before saving.</small></span></label>)}
        </div>
      </div>}
    </details>
  </div>;
}

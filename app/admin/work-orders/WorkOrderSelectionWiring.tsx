"use client";

import { useEffect } from "react";

type Props = {
  formId: string;
  toggleId: string;
  countId?: string;
};

export default function WorkOrderSelectionWiring({ formId, toggleId, countId }: Props) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const btn = form.querySelector(`#${toggleId}`) as HTMLButtonElement | null;
    if (!btn) return;
    const countEl = countId ? (form.querySelector(`#${countId}`) as HTMLElement | null) : null;

    const getBoxes = () =>
      Array.from(form.querySelectorAll('input[type="checkbox"][name="ids"]')) as HTMLInputElement[];

    const syncLabel = () => {
      const boxes = getBoxes();
      const selected = boxes.filter((b) => b.checked).length;
      const all = boxes.length > 0 && boxes.every((b) => b.checked);
      btn.textContent = all ? "Clear selection" : "Select all";
      btn.setAttribute("aria-pressed", all ? "true" : "false");
      if (countEl) countEl.textContent = `${selected} selected`;
    };

    const onClick = () => {
      const boxes = getBoxes();
      if (boxes.length === 0) return;
      const all = boxes.every((b) => b.checked);
      for (const b of boxes) b.checked = !all;
      syncLabel();
    };

    const onChange = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.matches('input[type="checkbox"][name="ids"]')) syncLabel();
    };

    btn.addEventListener("click", onClick);
    form.addEventListener("change", onChange);
    syncLabel();

    return () => {
      btn.removeEventListener("click", onClick);
      form.removeEventListener("change", onChange);
    };
  }, [formId, toggleId, countId]);

  return null;
}

"use client";

import { useEffect } from "react";

type Props = {
  formId: string;
};

const NEW_ITEM_FIELD_NAMES = ["newSku", "newName", "newPartNumber", "newLoc", "newShelf", "newBin"] as const;

export default function NewItemAutoCheck({ formId }: Props) {
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;

    const checkbox = form.querySelector('input[name="isNewItem"]') as HTMLInputElement | null;
    if (!checkbox) return;

    const readValue = (name: string) => {
      const el = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
      return String(el?.value ?? "").trim();
    };

    const syncCheckbox = () => {
      const hasNewItemInput = NEW_ITEM_FIELD_NAMES.some((name) => readValue(name).length > 0);
      if (hasNewItemInput) checkbox.checked = true;
    };

    const listeners: Array<{ el: Element; type: "input" | "change" }> = [];

    for (const name of NEW_ITEM_FIELD_NAMES) {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) continue;

      const type = el instanceof HTMLSelectElement ? "change" : "input";
      el.addEventListener(type, syncCheckbox);
      listeners.push({ el, type });
    }

    syncCheckbox();

    return () => {
      for (const { el, type } of listeners) {
        el.removeEventListener(type, syncCheckbox);
      }
    };
  }, [formId]);

  return null;
}

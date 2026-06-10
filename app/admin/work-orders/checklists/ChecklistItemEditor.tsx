"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties, type FocusEvent } from "react";

type Props = {
  id: string;
  area: string;
  defaultLabel: string;
  defaultActive: boolean;
  updateAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  inputStyle: CSSProperties;
  deleteButtonStyle: CSSProperties;
};

export default function ChecklistItemEditor({
  id,
  area,
  defaultLabel,
  defaultActive,
  updateAction,
  deleteAction,
  inputStyle,
  deleteButtonStyle,
}: Props) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (saveState !== "saving" || isPending) return;

    setSaveState("saved");
    const timeoutId = window.setTimeout(() => setSaveState("idle"), 900);
    return () => window.clearTimeout(timeoutId);
  }, [isPending, saveState]);

  function submitUpdate() {
    const form = formRef.current;
    if (!form) return;
    setSaveState("saving");
    startTransition(() => {
      form.requestSubmit();
    });
  }

  function handleLabelBlur(event: FocusEvent<HTMLInputElement>) {
    const next = event.relatedTarget as HTMLElement | null;
    if (next?.dataset.skipAutosave === "true") return;
    submitUpdate();
  }

  const statusText = isPending || saveState === "saving" ? "Saving..." : saveState === "saved" ? "Saved" : "";

  return (
    <form
      ref={formRef}
      action={updateAction}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto auto auto",
        gap: 10,
        alignItems: "center",
        padding: 10,
        border: "1px solid rgba(128,128,128,0.18)",
        borderRadius: 12,
      }}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="area" value={area} />

      <input
        name="label"
        defaultValue={defaultLabel}
        aria-label="Checklist item label"
        style={inputStyle}
        required
        onBlur={handleLabelBlur}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          submitUpdate();
        }}
      />

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, whiteSpace: "nowrap" }}>
        <input
          type="checkbox"
          name="active"
          defaultChecked={defaultActive}
          data-skip-autosave="true"
          onChange={submitUpdate}
        />
        Active
      </label>

      <div style={{ minWidth: 58, fontSize: 11, opacity: 0.7, textAlign: "right" }}>{statusText}</div>

      <button type="submit" formAction={deleteAction} formNoValidate style={deleteButtonStyle} data-skip-autosave="true">
        Delete
      </button>
    </form>
  );
}
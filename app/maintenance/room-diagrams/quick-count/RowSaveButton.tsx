"use client";

type RowSaveButtonProps = {
  formId: string;
};

export default function RowSaveButton({ formId }: RowSaveButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        const form = document.getElementById(formId) as HTMLFormElement | null;
        form?.requestSubmit();
      }}
      style={{
        padding: "6px 10px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--surface-2)",
        fontWeight: 800,
        cursor: "pointer",
        fontSize: 12,
      }}
    >
      Save
    </button>
  );
}
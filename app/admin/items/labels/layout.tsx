// This layout overrides the parent admin layout for the labels popup.
// It renders the labels page as a standalone document without the normal
// admin navigation chrome, which is important for printing.

export const dynamic = "force-dynamic";

export default function LabelsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

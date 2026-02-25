// app/work-orders/page.tsx

// Next.js route segment config must be defined in this file (cannot be re-exported)
export const dynamic = "force-dynamic";

// Reuse the exact maintenance page UI/logic
export { default } from "../maintenance/work-orders/page";
// This layout overrides the parent admin layout for the labels popup.
// It renders the labels page as a standalone document without the normal
// admin navigation chrome, which is important for printing.

export const dynamic = "force-dynamic";

export default function LabelsLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <title>Print Labels</title>
        <style>{`
          /* hide admin sidebar/nav added by parent layout */
          aside { display: none !important; }

          @page { margin: 0; }

          :root {
            --w: 3.5in;
            --h: 1.125in;
            --b: 2px;
          }

          html, body {
            margin: 0;
            padding: 0;
            font-family: system-ui, -apple-system, sans-serif;
            background: white;
            color: black;
          }

          body {
            display: flex;
            flex-direction: column;
            gap: var(--b);
            padding: var(--b);
          }

          .debug-bar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: yellow;
            color: black;
            padding: 4px 8px;
            font-size: 12px;
            z-index: 1000;
            border-bottom: 1px solid black;
          }

          .label {
            width: var(--w);
            height: var(--h);
            border: var(--b) solid black;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px;
            box-sizing: border-box;
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .label-qr {
            flex-shrink: 0;
            width: 36px;
            height: 36px;
          }

          .label-qr img {
            width: 100%;
            height: 100%;
            object-fit: contain;
          }

          .label-content {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 2px;
          }

          .label-sku {
            font-size: 10px;
            font-weight: bold;
            color: black;
          }

          .label-name {
            font-size: 12px;
            font-weight: bold;
            color: black;
            line-height: 1.2;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .label-ids {
            font-size: 8px;
            color: #666;
            line-height: 1.1;
          }

          .label-copy {
            position: absolute;
            top: 2px;
            right: 2px;
            font-size: 6px;
            color: #999;
            background: white;
            padding: 1px 2px;
            border: 1px solid #ccc;
            border-radius: 2px;
          }

          @media print {
            .debug-bar { display: none !important; }
            body { padding: 0; }
            .label { border: none; }
          }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}

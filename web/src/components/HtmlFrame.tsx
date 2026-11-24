import { useRef, useState } from 'react';

const BASE_CSS =
  'body{font:13px system-ui,Segoe UI,sans-serif;color:#1f2430;margin:0;padding:8px 12px;overflow:hidden;word-wrap:break-word}' +
  'img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #d9dce1;padding:2px 5px}pre{white-space:pre-wrap}a{color:#2563eb}';

/** Untrusted HTML (TFS, Customer Portal) only renders in a script-free sandboxed iframe (allow-same-origin only lets us measure height). */
export default function HtmlFrame({ html, title = 'content' }: { html: string; title?: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [h, setH] = useState(40);
  const measure = () => {
    const b = ref.current?.contentDocument?.body;
    if (b) setH(Math.max(24, b.scrollHeight + 4));
  };
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>${BASE_CSS}</style></head><body>${html}</body></html>`;
  return (
    <iframe
      ref={ref}
      className="detail-frame"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={srcDoc}
      style={{ height: h }}
      onLoad={measure}
      title={title}
    />
  );
}

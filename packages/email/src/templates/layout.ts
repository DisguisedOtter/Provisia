/**
 * Shared HTML layout. Variables: `company` (name, address, website, logoUrl), `subject`, `body` (pre-rendered
 * HTML, triple-stash), `footer` (locale text), `webUrl`.
 */
export const LAYOUT_HTML = `<!doctype html>
<html lang="{{locale}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{subject}}</title>
<style>
  body { margin:0; padding:0; background:#f4f5f7; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color:#1f2937; }
  .wrap { max-width:600px; margin:0 auto; padding:24px 12px; }
  .card { background:#ffffff; border-radius:8px; padding:32px; border:1px solid #e5e7eb; }
  .brand { font-size:18px; font-weight:600; color:#111827; margin-bottom:24px; }
  .brand img { max-height:40px; }
  h1 { font-size:20px; margin:0 0 16px; color:#111827; }
  p { line-height:1.55; margin:0 0 14px; font-size:15px; }
  .btn { display:inline-block; background:#2563eb; color:#ffffff !important; text-decoration:none; padding:11px 20px; border-radius:6px; font-weight:600; margin:8px 0 16px; }
  table.kv { border-collapse:collapse; width:100%; margin:12px 0 18px; font-size:14px; }
  table.kv td { padding:7px 0; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  table.kv td:first-child { color:#6b7280; width:40%; }
  .quote { border-left:3px solid #d1d5db; padding:8px 12px; margin:12px 0; color:#374151; white-space:pre-wrap; font-size:14px; background:#f9fafb; border-radius:0 4px 4px 0; }
  .muted { color:#6b7280; font-size:13px; }
  .footer { text-align:center; color:#9ca3af; font-size:12px; padding:20px 8px 0; line-height:1.5; }
  code { background:#f3f4f6; padding:2px 5px; border-radius:4px; font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div class="brand">{{#if company.logoUrl}}<img src="{{company.logoUrl}}" alt="{{company.name}}">{{else}}{{company.name}}{{/if}}</div>
    {{{body}}}
  </div>
  <div class="footer">
    {{company.name}}{{#if company.address}} · {{company.address}}{{/if}}{{#if company.website}} · <a href="{{company.website}}" style="color:#9ca3af">{{company.website}}</a>{{/if}}<br>
    {{footer}}
  </div>
</div>
</body>
</html>`;

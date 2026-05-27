/**
 * proposals.js — Generate PDF proposals from Handlebars + Markdown + Puppeteer.
 *
 * Flow:
 *   1. Load template body_markdown (Handlebars template string)
 *   2. Render Handlebars with variable_values  → Markdown string
 *   3. Convert Markdown → HTML (marked)
 *   4. Wrap in styled HTML page
 *   5. Puppeteer → PDF Buffer
 *   6. Upload to Supabase Storage via storage.js
 */

import Handlebars from 'handlebars';
import { marked } from 'marked';
import puppeteer from 'puppeteer';
import { uploadFile } from './storage.js';

/**
 * Render a Handlebars template with the given variables.
 * Returns the rendered Markdown string.
 */
export function renderMarkdown(templateMarkdown, variables) {
  const compiled = Handlebars.compile(templateMarkdown, { noEscape: true });
  return compiled(variables || {});
}

/**
 * Convert Markdown to a full HTML page string.
 */
function markdownToHtml(markdown, title = 'Proposta') {
  const body = marked.parse(markdown);
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      line-height: 1.6;
      color: #1a1a1a;
      padding: 40px 56px;
      max-width: 860px;
      margin: 0 auto;
    }
    h1 { font-size: 24px; color: #0f172a; margin-bottom: 4px; }
    h2 { font-size: 18px; color: #1e293b; margin-top: 32px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
    h3 { font-size: 14px; color: #334155; margin-top: 20px; }
    p  { margin: 10px 0; }
    ul, ol { padding-left: 24px; margin: 8px 0; }
    li { margin-bottom: 4px; }
    table { border-collapse: collapse; width: 100%; margin: 16px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }
    th { background: #f1f5f9; font-weight: 600; }
    hr { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }
    code { background: #f1f5f9; padding: 2px 5px; border-radius: 3px; font-size: 12px; }
    pre  { background: #f1f5f9; padding: 12px 16px; border-radius: 6px; overflow-x: auto; }
    blockquote { border-left: 3px solid #6366f1; margin: 16px 0; padding-left: 16px; color: #475569; }
    .footer { margin-top: 48px; font-size: 11px; color: #94a3b8; text-align: center; }
  </style>
</head>
<body>
  ${body}
  <div class="footer">Documento gerado automaticamente · PM-IA Consultorias</div>
</body>
</html>`;
}

/**
 * Generate a PDF buffer from a Markdown string.
 */
export async function generatePdf(markdown, title = 'Proposta') {
  const html = markdownToHtml(markdown, title);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' }
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

/**
 * Full pipeline: render → generate PDF → upload to Storage.
 * @returns {{ storagePath, renderedMarkdown, fileName }}
 */
export async function renderAndUpload({ orgId, dealId, templateMarkdown, variables, title }) {
  const renderedMarkdown = renderMarkdown(templateMarkdown, variables);
  const pdfBuffer = await generatePdf(renderedMarkdown, title);

  const safeTile = (title || 'proposta').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '-').toLowerCase();
  const fileName = `${safeTile}-${Date.now()}.pdf`;

  const { storagePath } = await uploadFile({
    orgId,
    dealId,
    originalName: fileName,
    buffer: pdfBuffer,
    mimeType: 'application/pdf'
  });

  return { storagePath, renderedMarkdown, fileName };
}

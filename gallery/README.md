# pdfmill gallery workflows

Ready-to-import n8n workflow templates that showcase the canonical jobs the
**PDFmill** node (`n8n-nodes-pdfmill`) does. These are the
distribution artifact (Constitution Principle I) — authored here, to be
**submitted to the n8n template gallery at M5** (not submitted yet).

Each JSON imports cleanly (n8n → **Workflows → Import from File/URL**), is
documented with sticky notes, and — once you add the credentials it names — runs
end-to-end to a finished document. The **When clicking 'Execute workflow'**
manual trigger + a **sample-data** node let you run each one immediately; a
sticky note explains how to swap in the real trigger/source in production.

| File | Job | Template | Ends in |
|---|---|---|---|
| `01-payment-to-invoice-email.json` | Payment → branded invoice PDF, emailed | `invoice` | Gmail (attachment) |
| `02-row-to-certificate-drive.json` | Roster row → personalised certificate | `certificate` | Google Drive |
| `03-form-to-report-slack.json` | Form/webhook → formatted report | `report` | Slack (file) |
| `04-scheduled-summary-report.json` | Weekly schedule → summary report | `report` | Gmail (attachment) |
| `05-order-to-packing-slip-drive.json` | New order → packing slip | `packing-slip` | Google Drive |

The sample data in each is the **real pdfmill starter fixture** for that
template, so the rendered document looks exactly as designed. Swap the
sample-data node for your mapping from the trigger.

## Credentials each workflow needs

- **pdfmill API** (all): create an API key in the pdfmill dashboard, paste it
  into the node's *pdfmill API* credential.
- **Gmail / Google Drive / Slack** (per workflow): the recipient/destination
  integration — your own account credential.

## Regenerating

The JSONs are generated from `_build.mjs` (reuses the starter fixtures):

```bash
node gallery/_build.mjs
```

## M5 gallery-submission checklist (NOT done here)

1. Verify each workflow imports + runs on a live n8n (Cloud + self-host) with a
   real pdfmill key. See `../scripts/integration-n8n.md`.
2. Submit each to the n8n creator/template gallery under the pdfmill account
   (ranks under n8n.io authority per the GTM playbook).
3. Cross-link from the node README and the docs site (M4).

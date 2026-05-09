# Guide images

Drop PNG screenshots in this folder using the exact filenames referenced in `/guide.html`. Each placeholder box in the guide has its expected filename printed underneath in italic — e.g. `guide-images/01-landing.png`.

## How to swap a placeholder for a real screenshot

Once you save a file like `01-landing.png` here, replace the corresponding placeholder block in `/guide.html`:

```html
<div class="shot">
  <div class="ph">
    <span class="ico">⬚</span>
    <span class="label">Screenshot 01</span>
    <span class="desc">…description…</span>
  </div>
  <div class="caption">guide-images/01-landing.png</div>
</div>
```

…with this:

```html
<div class="shot">
  <img src="/guide-images/01-landing.png" alt="Covenant landing page"/>
  <div class="caption">Step 01 — landing page</div>
</div>
```

The `.shot` container handles all the styling (border, rounded corners, caption strip). Just drop in `<img>` instead of the `<div class="ph">`.

## Recommended screenshot specs

- **Width:** 1200-1600 px (the guide caps at 1200 max, scales down on mobile)
- **Format:** PNG (better for UI) or JPG (smaller for photos / hero shots)
- **DPI:** screen DPI is fine — no need for print resolution
- **Crop tightly:** trim browser chrome (URL bar, tabs) unless it's part of the point

## What to capture

The full list, in order:

1. `01-landing.png` — landing page with the Buy Access CTA
2. `02-paymongo.png` — PayMongo's hosted checkout with test card filled in
3. `03-buy-success.png` — "Payment received" page
4. `04-bootstrap.png` — Welcome / Set Up Your Organization form
5. `05-dashboard.png` — main app dashboard with sidebar
6. `06-settings.png` — Settings page top section
7. `07-add-business.png` — Add Business modal
8. `08-add-partner.png` — Partner form (long, scrolling OK)
9. `09-add-client.png` — Add Client modal
10. `10-attendance.png` — Attendance calendar grid
11. `11-sunday-service.png` — Sunday Service tracker (only Sundays clickable)
12. `12-record-payment.png` — Record Payment modal
13. `13-payroll-run.png` — Payroll Run detail page
14. `14-obligations.png` — Obligations page with four pool cards
15. `15-conviction.png` — Conviction Firstfruits dedicated view
16. `16-remittance.png` — Log Remittance modal with pool allocations
17. `17-pnl.png` — Profit & Loss report with sortable headers
18. `18-invoice.png` — Invoice detail page
19. `19-import.png` — Import wizard with file dropped + count tiles

# Mocreo Webhook Setup SOP

## Purpose
Use this process to connect Mocreo hubs/sensors to the Inventory App temperature dashboard.

## Prerequisites
1. Public app URL is reachable over HTTPS.
2. User can access `Maintenance -> Temperature Dashboard`.
3. Mocreo tenant has webhook/API integration enabled (legacy portal does not support this).

## A. Get Required Values From Inventory App
1. Open `Maintenance -> Temperature Dashboard`.
2. In Step 6, click `Copy URL`.
3. Record:
   - Webhook URL: `https://<your-domain>/api/integrations/mocreo/webhook`
   - Header name (if token enabled): `x-mocreo-token`
   - Header value: the app's `MOCREO_WEBHOOK_TOKEN`

## B. Configure Mocreo Webhook
1. Open Mocreo integration settings (typically `Settings -> Integrations -> Webhook` or `Developer/API`).
2. Create a webhook endpoint with:
   - Method: `POST`
   - Content-Type: `application/json`
   - URL: paste the full webhook URL from section A
3. If token auth is enabled, add header:
   - `x-mocreo-token: <token value>`
4. Save.

## C. Map Hubs In Inventory App
1. Open `Maintenance -> Temperature Dashboard`.
2. In `Register / Update Hub`, set:
   - Hub Name
   - Mocreo Hub ID (exact external ID)
   - Store Location
   - Assigned Maintenance Tech
   - Min/Max thresholds
3. Save.
4. Optional: set per-sensor thresholds in `Edit Sensor Thresholds`.

## D. Validate End-To-End
1. Run `Webhook Pairing Test` from the dashboard.
2. Confirm:
   - test result shows `ok`
   - sensor appears in live table
   - `Current Temp` and `Last Seen` update
3. Trigger a real sensor update from Mocreo and verify app updates on auto-refresh.

## E. Troubleshooting
1. `401 Unauthorized` on webhook:
   - header missing or token mismatch.
2. `No sensors discovered`:
   - hub ID mismatch or Mocreo not sending device events.
3. Mocreo shows online but app shows stale:
   - check webhook delivery status in Mocreo.
   - verify app URL is publicly reachable.
4. Legacy portal banner shown:
   - webhook config is unavailable there; request webhook/API enablement from Mocreo support.

## F. Mocreo Support Request Template
Use this when webhook settings are missing:

```text
Subject: Enable webhook/API integration for our account

Hi Mocreo Support,

Please enable outbound webhook/API integration for our tenant/account.

Account email: <your Mocreo login email>
Company: <your company name>
Hub serial numbers:
- <hub serial 1>
- <hub serial 2>

We need to post temperature readings to:
https://<your-domain>/api/integrations/mocreo/webhook

If header auth is supported, we will send:
x-mocreo-token: <token>

Please confirm when webhook/API is enabled and where in the UI we configure it.

Thanks.
```

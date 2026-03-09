# Mocreo Public API Polling SOP

## Purpose
Use this process to connect Mocreo hubs/sensors to the Inventory App temperature dashboard using Mocreo's Public API polling model.

## Prerequisites
1. Public app URL is reachable over HTTPS.
2. User can access `Maintenance -> Temperature Dashboard`.
3. Mocreo tenant credentials are available for Public API access.

## A. Configure Inventory App Polling Endpoint
1. Open `Maintenance -> Temperature Dashboard`.
2. Record polling endpoint:
   - Sync URL: `https://<your-domain>/api/integrations/mocreo/sync`
3. Configure environment variables:
   - `MOCREO_API_USERNAME` = Mocreo login email
   - `MOCREO_API_PASSWORD` = Mocreo password
   - `MOCREO_POLL_INTERVAL_MINUTES` = desired polling interval (example: `10`)
   - `MOCREO_SYNC_TOKEN` = shared secret used to protect sync route (recommended)

## B. Configure Scheduler (Cron)
1. Configure your scheduler to call:
   - `POST https://<your-domain>/api/integrations/mocreo/sync`
2. Include one of these auth methods:
   - Header: `x-mocreo-sync-token: <MOCREO_SYNC_TOKEN>`
   - Or bearer auth: `Authorization: Bearer <MOCREO_SYNC_TOKEN>`
3. Schedule frequency to match `MOCREO_POLL_INTERVAL_MINUTES`.
4. Optional query params:
   - `minutes=<n>`
   - `beginTime=<unix-seconds>`
   - `endTime=<unix-seconds>`

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

Important: the app matches Mocreo nodes to hubs using `Mocreo Hub ID` = Mocreo hub serial/SN (`thingName`).

## D. Validate End-To-End
1. Trigger one sync call manually (Postman/cURL):
   - `POST /api/integrations/mocreo/sync`
2. Confirm:
   - test result shows `ok`
   - sensor appears in live table
   - `Current Temp` and `Last Seen` update
3. Verify subsequent scheduled calls keep data current.

## E. Troubleshooting
1. `401 Unauthorized` on sync:
   - token missing or mismatch (`MOCREO_SYNC_TOKEN`).
2. `Missing MOCREO_API_USERNAME or MOCREO_API_PASSWORD`:
   - set deployment environment variables and redeploy.
3. `nodesMatched: 0`:
   - hub ID mismatch. Ensure dashboard hub `externalHubId` equals Mocreo hub serial (`thingName`).
4. Data stale:
   - verify cron is running at intended interval.
   - confirm `beginTime/endTime` window tracks polling interval.
5. Rate limit errors:
   - reduce polling frequency or number of parallel sync jobs; Mocreo limit is 5 requests/second.

## F. Vendor Notes
Mocreo support confirmed webhook delivery is not currently supported. Use Public API polling only.

```text
Rate limiting: max 5 requests/second.
Best practice: set beginTime/endTime equal to your polling interval window.
```

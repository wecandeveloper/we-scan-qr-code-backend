# we-scan-qr-code-backend

Backend API for the Dine-OS / we-scan-qr-code application.

## Local development

1. Copy [`.env.example`](.env.example) to `.env` and set variables (see below).
2. Install dependencies: `npm install`
3. Start the server: `npm run dev` (or your usual start command).

To verify Atlas / `.env` without starting the API, run `npm run check:mongodb` (loads `.env` from the project root and runs a `ping`).

The server waits for MongoDB to connect before listening on the port, so you should see `MongoDB Connected...` before `Server running on port 5030`.

### MongoDB (Atlas) checklist

If you see `Server selection timed out` or connection errors locally while production works:

1. **URI** — Set one of `MONGODB_CLOUD_URI`, `MONGODB_URI`, or `DB_URI` in `.env` to a valid connection string for your cluster.
2. **Network Access** — In MongoDB Atlas, open **Network Access** and allow your **current public IP** (or use **Add Current IP Address**). Production servers are often allowlisted already; developer laptops usually are not.
3. **Connectivity test** — From the same machine, run `mongosh "<your-connection-string>"` (keep credentials private). If it hangs, fix network/IP/URI before debugging application code.
4. **VPN / firewall** — Corporate VPNs or firewalls sometimes block outbound traffic to MongoDB; try with VPN off or another network.

In non-production, `serverSelectionTimeoutMS` is set to 10s in [`app/config/db.js`](app/config/db.js) so misconfiguration fails a bit faster than the default 30s.

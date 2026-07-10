const baseUrl = process.env.GIMERR_BASE_URL || process.env.GIMERR_URL_PAGES || "http://localhost:8788";
const limitPerType = Number(process.env.IGDB_SYNC_LIMIT_PER_TYPE || 250);
const secret = process.env.IGDB_SYNC_SECRET || "";

const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/igdb/import-popular`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    ...(secret ? { "x-gimerr-sync-secret": secret } : {}),
  },
  body: JSON.stringify({ limitPerType }),
});

const payload = await response.json().catch(() => ({}));
if (!response.ok) {
  console.error(payload.error || `IGDB sync failed with ${response.status}`);
  process.exit(1);
}

console.log(JSON.stringify(payload, null, 2));

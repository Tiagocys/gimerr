function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers || {}),
    },
  });
}

const DEFAULT_ADCASH_ZONE_ID = "11742210";
const DEFAULT_ADCASH_MARKETPLACE_ZONE_ID = "11767214";

function getAdcashBannerZoneId(env) {
  return env.ADCASH_ZONE_ID || env.ADCASH_BANNER_ZONE_ID || DEFAULT_ADCASH_ZONE_ID;
}

function getAdcashMarketplaceZoneId(env) {
  return env.ADCASH_MARKETPLACE_ZONE_ID
    || env.ADCASH_MARKETPLACE_BANNER_ZONE_ID
    || DEFAULT_ADCASH_MARKETPLACE_ZONE_ID;
}

function getAdcashVastTag(env) {
  const explicitTag = String(env.ADCASH_VAST_TAG || "").trim();
  if (explicitTag) return explicitTag;

  const videoZoneId = String(env.ADCASH_VIDEO_ZONE_ID || "").trim();
  if (!videoZoneId) return "";

  return `https://youradexchange.com/video/select.php?r=${encodeURIComponent(videoZoneId)}`;
}

export async function onRequestGet({ env }) {
  return jsonResponse({
    video: {
      adcashVastTag: getAdcashVastTag(env),
      adcashZoneId: env.ADCASH_VIDEO_ZONE_ID || "",
    },
    banner: {
      adcashZoneId: getAdcashBannerZoneId(env),
      marketplaceZoneId: getAdcashMarketplaceZoneId(env),
    },
  });
}

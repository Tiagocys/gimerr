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

export async function onRequestGet({ env }) {
  return jsonResponse({
    video: {
      adcashVastTag: env.ADCASH_VAST_TAG || "",
    },
    banner: {
      adcashZoneId: "11701982",
    },
  });
}

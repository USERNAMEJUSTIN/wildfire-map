// Карта лесных пожаров — сервер. Node.js 18+, без зависимостей.
// Текущие пожары: публичные файлы NASA FIRMS, ключ НЕ нужен.
// Архив по датам: нужен бесплатный FIRMS_MAP_KEY (env). Без ключа архив скрыт.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const MAP_KEY = process.env.FIRMS_MAP_KEY || "";
const BASE = "https://firms.modaps.eosdis.nasa.gov";
const INDEX = path.join(__dirname, "public", "index.html");

// Публичные глобальные CSV (обновляются NASA по мере пролёта спутников)
const LIVE = {
  viirs_snpp:   { dir: "suomi-npp-viirs-c2", file: "SUOMI_VIIRS_C2_Global" },
  viirs_noaa20: { dir: "noaa-20-viirs-c2",   file: "J1_VIIRS_C2_Global" },
  viirs_noaa21: { dir: "noaa-21-viirs-c2",   file: "J2_VIIRS_C2_Global" },
  modis:        { dir: "modis-c6.1",         file: "MODIS_C6_1_Global" },
};
const LIVE_PERIODS = { "24h": 1, "48h": 1, "7d": 1 };
// Архив через API: [standard processing, near real-time]
const ARCHIVE = {
  viirs_snpp:   ["VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"],
  viirs_noaa20: ["VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"],
  viirs_noaa21: [null, "VIIRS_NOAA21_NRT"],
  modis:        ["MODIS_SP", "MODIS_NRT"],
};

const cache = new Map();
const LIVE_TTL = 10 * 60 * 1000, ARCHIVE_TTL = 24 * 60 * 60 * 1000, CACHE_MAX = 40;

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = (lines[0] || "").split(",");
  const i = (n) => head.indexOf(n);
  const iLat = i("latitude"), iLon = i("longitude"), iFrp = i("frp"), iConf = i("confidence"),
        iDate = i("acq_date"), iTime = i("acq_time"), iDn = i("daynight");
  if (iLat < 0 || iLon < 0) throw new Error((text || "Пустой ответ FIRMS").slice(0, 200));
  const rows = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(",");
    const lat = parseFloat(c[iLat]), lon = parseFloat(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    rows.push([Math.round(lat * 1e4) / 1e4, Math.round(lon * 1e4) / 1e4,
      Math.round((parseFloat(c[iFrp]) || 0) * 10) / 10, c[iConf] ?? "",
      c[iDate] ?? "", String(c[iTime] ?? "").padStart(4, "0"), c[iDn] ?? ""]);
  }
  return rows;
}

async function fetchCsv(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`FIRMS ${res.status}: ${text.slice(0, 200)}`);
  return parseCsv(text);
}

async function cached(key, ttl, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  const body = JSON.stringify(await fn());
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(key, { at: Date.now(), body });
  return body;
}

function live(sat, period) {
  const s = LIVE[sat];
  return cached(`live/${sat}/${period}`, LIVE_TTL, async () => {
    const rows = await fetchCsv(`${BASE}/data/active_fire/${s.dir}/csv/${s.file}_${period}.csv`);
    return { mode: "live", sat, period, updated: new Date().toISOString(), count: rows.length, rows };
  });
}

function archive(sat, date, days) {
  return cached(`arch/${sat}/${date}/${days}`, ARCHIVE_TTL, async () => {
    const [sp, nrt] = ARCHIVE[sat];
    let rows = [], used = null;
    for (const src of [sp, nrt]) {
      if (!src) continue;
      rows = await fetchCsv(`${BASE}/api/area/csv/${MAP_KEY}/${src}/world/${days}/${date}`);
      used = src;
      if (rows.length) break;
    }
    return { mode: "archive", sat, date, days, source: used, updated: new Date().toISOString(), count: rows.length, rows };
  });
}

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost");
  const q = (k) => u.searchParams.get(k);
  try {
    if (u.pathname === "/api/config") return send(res, 200, { archive: Boolean(MAP_KEY) });

    if (u.pathname === "/api/fires") {
      const sat = q("sat") || "viirs_snpp", period = q("period") || "24h";
      if (!LIVE[sat] || !LIVE_PERIODS[period]) return send(res, 400, { error: "Неверный спутник или период" });
      return send(res, 200, await live(sat, period));
    }

    if (u.pathname === "/api/archive") {
      if (!MAP_KEY) return send(res, 403, { error: "Архив выключен: на сервере не задан FIRMS_MAP_KEY" });
      const sat = q("sat") || "modis", date = q("date") || "", days = Number(q("days") || 1);
      const d = new Date(date + "T00:00:00Z");
      if (!ARCHIVE[sat] || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(d) || d > new Date()
          || !Number.isInteger(days) || days < 1 || days > 5) return send(res, 400, { error: "Неверные параметры архива" });
      return send(res, 200, await archive(sat, date, days));
    }

    if (u.pathname === "/" || u.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return fs.createReadStream(INDEX).pipe(res);
    }
    if (u.pathname === "/healthz") return send(res, 200, { ok: true });
    res.writeHead(404); res.end();
  } catch (e) {
    console.error(e);
    send(res, 502, { error: String(e.message || e) });
  }
}).listen(PORT, () => console.log(`Карта пожаров: http://localhost:${PORT}  (архив ${MAP_KEY ? "включён" : "выключен — нет FIRMS_MAP_KEY"})`));

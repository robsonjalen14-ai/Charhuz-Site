const DATABASES = [
  {
    id: "database-1",
    label: "Database 1",
    base: "https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-1/"
  },
  {
    id: "database-2",
    label: "Database 2",
    base: "https://raw.githubusercontent.com/BlissBlender/Charon-Database/main/database-2/"
  }
];

const GAMEGEN_API =
  "https://gamegen.lol/api/mg_cca51ec305a5494a946454fcc21cf1c3/generate/";
const BACKFILL_ENDPOINT = "https://charon-bot.vyro.workers.dev/api/backfill";
const BACKFILL_HEALTH_ENDPOINT = "https://charon-bot.vyro.workers.dev/health";

const STORE_DETAILS_URL =
  "https://store.steampowered.com/api/appdetails?appids=";
const STORE_DETAILS_FILTERS = "basic,release_date,publishers";
const STEAM_SUGGEST_URL =
  "https://store.steampowered.com/search/suggest";
const STEAM_APP_PAGE_URL =
  "https://store.steampowered.com/app/";

const STEAMSPY_DETAILS_URL =
  "https://steamspy.com/api.php?request=appdetails&appid=";
const STEAMCMD_INFO_URL = "https://api.steamcmd.net/v1/info/";

const MANIFEST_SOURCES = [
  {
    id: "manifest-vault",
    label: "Manifest Vault",
    base: "https://raw.githubusercontent.com/BlissBlender/ManifestVault/main/"
  },
  {
    id: "external-vault",
    label: "External Vault",
    base: "https://raw.githubusercontent.com/qwe213312/k25FCdfEOoEJ42S6/main/"
  }
];

const DEPOT_ADDAPPID_RE = /addappid\s*\(\s*(\d+)\s*,\s*\d+\s*,\s*["'][a-fA-F0-9]+["']/gi;
const DIRECT_MANIFEST_FILE_RE = /\b(\d{3,})_(\d{3,})\.manifest\b/gi;

const GAME_DETAILS_CACHE_PREFIX = "charon.game.";
const GAME_DETAILS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

const DIRECT_JSON_PROXY = {
  name: "direct",
  makeUrl: (url) => url,
  parse: (response) => response.json()
};

const ALLORIGINS_JSON_PROXY = {
  name: "allorigins",
  makeUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  parse: async (response) => {
    const data = await response.json();
    if (typeof data.contents === "string") return JSON.parse(data.contents);
    return data;
  }
};

const CORSPROXY_JSON_PROXY = {
  name: "corsproxy",
  makeUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  parse: (response) => response.json()
};

const CODETABS_JSON_PROXY = {
  name: "codetabs",
  makeUrl: (url) => `https://api.codetabs.com/v1/proxy/?quest=${url.replace(/&/g, "%26")}`,
  parse: (response) => response.json()
};

const CORS_JSON_PROXIES = [
  DIRECT_JSON_PROXY,
  CODETABS_JSON_PROXY,
  CORSPROXY_JSON_PROXY,
  ALLORIGINS_JSON_PROXY
];

const STEAM_STORE_JSON_PROXIES = [
  DIRECT_JSON_PROXY,
  CODETABS_JSON_PROXY,
  CORSPROXY_JSON_PROXY,
  ALLORIGINS_JSON_PROXY
];

const STEAMSPY_JSON_PROXIES = [
  DIRECT_JSON_PROXY,
  CODETABS_JSON_PROXY,
  CORSPROXY_JSON_PROXY,
  ALLORIGINS_JSON_PROXY
];

const DIRECT_TEXT_PROXY = {
  name: "direct",
  makeUrl: (url) => url,
  parse: (response) => response.text()
};

const CODETABS_TEXT_PROXY = {
  name: "codetabs",
  makeUrl: (url) => `https://api.codetabs.com/v1/proxy/?quest=${url.replace(/&/g, "%26")}`,
  parse: (response) => response.text()
};

const CORSPROXY_TEXT_PROXY = {
  name: "corsproxy",
  makeUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  parse: (response) => response.text()
};

const ALLORIGINS_TEXT_PROXY = {
  name: "allorigins",
  makeUrl: (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  parse: async (response) => {
    const data = await response.json();
    return typeof data.contents === "string" ? data.contents : "";
  }
};

const STEAM_SUGGEST_PROXIES = [
  DIRECT_TEXT_PROXY,
  CODETABS_TEXT_PROXY,
  CORSPROXY_TEXT_PROXY,
  ALLORIGINS_TEXT_PROXY
];

const form = document.querySelector("#generatorForm");
const input = document.querySelector("#appid");
const button = document.querySelector("#generateBtn");
const suggestionList = document.querySelector("#suggestionList");
const statusText = document.querySelector("#statusText");
const statusDot = document.querySelector("#statusDot");
const progressBar = document.querySelector("#progressBar");
const gameDetails = document.querySelector("#gameDetails");
const downloadPanel = document.querySelector("#downloadPanel");
const downloadSource = document.querySelector("#downloadSource");
const downloadTitle = document.querySelector("#downloadTitle");
const downloadDescription = document.querySelector("#downloadDescription");
const downloadLink = document.querySelector("#downloadLink");

let currentBlobUrl = "";
let activeRequestId = 0;
let suggestionRequestId = 0;
let suggestionTimer = 0;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
const suggestionCache = new Map();
const scheduledBackfills = new Set();

class NoPackageError extends Error {
  constructor(appId) {
    super(`No manifest package found for App ID ${appId}. Join Discord to request it or try again later.`);
    this.name = "NoPackageError";
  }
}

function setStatus(message, percent = 0, type = "info") {
  statusText.textContent = message;
  statusDot.classList.toggle("is-error", type === "error");
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setBusy(isBusy) {
  button.disabled = isBusy;
  button.classList.toggle("is-loading", isBusy);
  button.querySelector("span").textContent = isBusy ? "Working..." : "Generate ZIP";
  input.disabled = isBusy;
}

function clearDownload() {
  if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = "";
  downloadPanel.classList.add("is-hidden");
  downloadLink.removeAttribute("href");
  downloadLink.removeAttribute("download");
  downloadLink.removeAttribute("target");
  downloadLink.removeAttribute("rel");
}

function normalizeAppId(value) {
  const raw = String(value || "").trim();
  const bracketMatch = raw.match(/\((\d+)\)\s*$/);
  if (bracketMatch) return bracketMatch[1];
  const numericMatch = raw.match(/^\d+$/);
  if (numericMatch) return raw;
  return raw;
}

function assertAppId(appId) {
  if (!/^\d+$/.test(appId)) {
    throw new Error("Enter a valid numeric Steam App ID.");
  }
}

function suggestionUrl(term) {
  const url = new URL(STEAM_SUGGEST_URL);
  url.searchParams.set("term", term);
  url.searchParams.set("f", "games");
  url.searchParams.set("cc", "US");
  url.searchParams.set("l", "english");
  return url.toString();
}

function parseSteamSuggestions(html, term) {
  const parser = new DOMParser();
  const documentHtml = parser.parseFromString(String(html || ""), "text/html");
  const normalizedTerm = String(term || "").trim().toLowerCase();
  const seen = new Set();
  const suggestions = [];

  documentHtml.querySelectorAll("a[href*='/app/']").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const match = href.match(/\/app\/(\d+)/);
    if (!match) return;
    const appId = match[1];
    if (seen.has(appId)) return;

    const name =
      anchor.querySelector(".match_name")?.textContent?.trim() ||
      anchor.textContent?.replace(/\s+/g, " ").trim();
    if (!name) return;
    const image = anchor.querySelector(".match_img img")?.getAttribute("src") || "";
    const price = anchor.querySelector(".match_price")?.textContent?.replace(/\s+/g, " ").trim() || "";

    seen.add(appId);
    suggestions.push({
      name,
      appId,
      image,
      price,
      startsWithTerm: normalizedTerm ? name.toLowerCase().startsWith(normalizedTerm) : false
    });
  });

  return suggestions
    .sort((left, right) => Number(right.startsWithTerm) - Number(left.startsWithTerm) || left.name.localeCompare(right.name))
    .slice(0, 25);
}

function scheduleBackfill(payload) {
  try {
    if (!payload || !String(window.location?.protocol || "").startsWith("http")) return;
    const key = JSON.stringify(payload);
    if (scheduledBackfills.has(key)) return;
    scheduledBackfills.add(key);

    window.setTimeout(async () => {
      try {
        const health = await fetch(BACKFILL_HEALTH_ENDPOINT, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store"
        });
        if (!health.ok) {
          console.debug("Charon backfill health check failed", await health.text());
          return;
        }

        const response = await fetch(BACKFILL_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: key,
          keepalive: false
        });
        if (!response.ok) {
          console.debug("Charon backfill skipped", await response.text());
        }
      } catch (error) {
        console.debug("Charon backfill endpoint unavailable", error);
      }
    }, 0);
  } catch (error) {
    console.debug("Charon backfill scheduling skipped", error);
  }
}

function steamSuggestionImageCandidates(appId, image = "") {
  const id = String(appId || "").trim();
  return [
    image,
    id ? steamAsset(id, "capsule_sm_120.jpg") : "",
    id ? steamAsset(id, "capsule_231x87.jpg") : "",
    id ? steamAsset(id, "capsule_467x181.jpg") : "",
    id ? steamAsset(id, "header.jpg") : ""
  ].map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index);
}

function hideSuggestions() {
  suggestionList.classList.remove("is-open");
  suggestionList.innerHTML = "";
  currentSuggestions = [];
  input.setAttribute("aria-expanded", "false");
  activeSuggestionIndex = -1;
}

function renderSuggestions(suggestions) {
  currentSuggestions = suggestions;
  activeSuggestionIndex = suggestions.length ? 0 : -1;
  if (!suggestions.length) {
    hideSuggestions();
    return;
  }

  suggestionList.innerHTML = suggestions.map((item, index) => {
    const imageCandidates = steamSuggestionImageCandidates(item.appId, item.image);
    const thumb = imageCandidates.length
      ? `<img src="${escapeHtml(imageCandidates[0])}" alt="" loading="lazy" decoding="async" data-index="0" data-candidates="${escapeHtml(imageCandidates.join("|"))}">`
      : `ID ${escapeHtml(item.appId)}`;

    return `
      <button class="suggestion-item ${index === activeSuggestionIndex ? "is-active" : ""}" type="button" role="option" aria-selected="${index === activeSuggestionIndex ? "true" : "false"}" data-index="${index}">
        <span class="suggestion-thumb ${imageCandidates.length ? "" : "is-fallback"}">${thumb}</span>
        <span class="suggestion-copy">
          <span class="suggestion-name">${escapeHtml(item.name)}</span>
          <span class="suggestion-meta">Steam App ID: ${escapeHtml(item.appId)}${item.price ? ` - ${escapeHtml(item.price)}` : ""}</span>
        </span>
        <span class="suggestion-appid">${escapeHtml(item.appId)}</span>
      </button>
    `;
  }).join("");
  suggestionList.classList.add("is-open");
  input.setAttribute("aria-expanded", "true");
}

function handleSuggestionImageError(event) {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest(".suggestion-thumb")) return;

  const candidates = String(image.dataset.candidates || "").split("|").filter(Boolean);
  const nextIndex = Number(image.dataset.index || 0) + 1;
  if (nextIndex < candidates.length) {
    image.dataset.index = String(nextIndex);
    image.src = candidates[nextIndex];
    return;
  }

  const thumb = image.closest(".suggestion-thumb");
  thumb.classList.add("is-fallback");
  thumb.textContent = "ID";
}

function updateActiveSuggestion(nextIndex) {
  if (!currentSuggestions.length) return;
  activeSuggestionIndex = (nextIndex + currentSuggestions.length) % currentSuggestions.length;
  suggestionList.querySelectorAll(".suggestion-item").forEach((item, index) => {
    const active = index === activeSuggestionIndex;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
    if (active) item.scrollIntoView({ block: "nearest" });
  });
}

function chooseSuggestion(index = activeSuggestionIndex) {
  const selected = currentSuggestions[index];
  if (!selected) return false;
  input.value = selected.appId;
  setStatus(`Selected ${selected.name} (${selected.appId}).`, 0);
  hideSuggestions();
  return true;
}

async function loadSuggestions(term, requestId) {
  const cacheKey = term.toLowerCase();
  let lastError = null;

  try {
    for (const candidateConfig of STEAM_SUGGEST_PROXIES) {
      try {
        const html = await fetchTextWithFallback(suggestionUrl(term), {
          timeout: 4500,
          candidates: [candidateConfig]
        });
        if (requestId !== suggestionRequestId) return;

        const suggestions = parseSteamSuggestions(html, term);
        if (!suggestions.length) continue;

        suggestionCache.set(cacheKey, suggestions);
        renderSuggestions(suggestions);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    suggestionCache.set(cacheKey, []);
    hideSuggestions();
  } catch {
    if (requestId === suggestionRequestId) hideSuggestions();
    if (lastError) console.debug("Steam suggestions failed", lastError);
  }
}

function scheduleSuggestions() {
  window.clearTimeout(suggestionTimer);
  const term = input.value.trim();
  const requestId = ++suggestionRequestId;
  if (!term || /^\d+$/.test(term)) {
    hideSuggestions();
    return;
  }

  const cacheKey = term.toLowerCase();
  if (suggestionCache.has(cacheKey)) {
    renderSuggestions(suggestionCache.get(cacheKey));
  }

  suggestionTimer = window.setTimeout(() => {
    loadSuggestions(term, requestId);
  }, suggestionCache.has(cacheKey) ? 80 : 120);
}

function encodeFileName(fileName) {
  return String(fileName || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function databaseUrl(base, fileName) {
  return `${base}${encodeFileName(fileName)}`;
}

async function fetchWithTimeout(url, options = {}) {
  const { timeout = 8000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      cache: "no-store",
      ...fetchOptions,
      signal: controller.signal
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function fetchJsonWithFallback(url, options = {}) {
  let lastError;
  const timeout = options.timeout || 8000;
  const candidates = options.candidates || CORS_JSON_PROXIES;

  for (const candidateConfig of candidates) {
    const candidate = candidateConfig.makeUrl(url);
    try {
      const response = await fetchWithTimeout(candidate, {
        timeout,
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await candidateConfig.parse(response);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Request failed.");
}

async function fetchJsonFirst(url, options = {}) {
  const timeout = options.timeout || 8000;
  const candidates = options.candidates || CORS_JSON_PROXIES;
  const errors = [];

  return new Promise((resolve, reject) => {
    candidates.forEach((candidateConfig) => {
      const candidate = candidateConfig.makeUrl(url);
      fetchWithTimeout(candidate, {
        timeout,
        headers: { Accept: "application/json, text/plain" }
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return candidateConfig.parse(response);
        })
        .then(resolve)
        .catch((error) => {
          errors.push(error);
          if (errors.length === candidates.length) {
            reject(errors[errors.length - 1] || new Error("Request failed."));
          }
        });
    });
  });
}

async function fetchTextWithFallback(url, options = {}) {
  let lastError;
  const timeout = options.timeout || 8000;
  const candidates = options.candidates || STEAM_SUGGEST_PROXIES;

  for (const candidateConfig of candidates) {
    const candidate = candidateConfig.makeUrl(url);
    try {
      const response = await fetchWithTimeout(candidate, {
        timeout,
        headers: { Accept: "text/html, text/plain" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await candidateConfig.parse(response);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Suggestion request failed.");
}

async function fetchTextFirst(url, options = {}) {
  const timeout = options.timeout || 6000;
  const candidates = options.candidates || STEAM_SUGGEST_PROXIES;
  const requests = candidates.map(async (candidateConfig) => {
    const candidate = candidateConfig.makeUrl(url);
    const response = await fetchWithTimeout(candidate, {
      timeout,
      headers: { Accept: "text/html, text/plain" }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return candidateConfig.parse(response);
  });

  return Promise.any(requests);
}

async function fetchBytesFile(url) {
  const response = await fetchWithTimeout(url, {
    timeout: 15000,
    headers: { Accept: "application/zip, text/plain, application/octet-stream" }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function resourceExists(url) {
  try {
    const head = await fetchWithTimeout(url, { method: "HEAD", timeout: 5000 });
    if (head.ok) return true;
    if (head.status === 404) return false;
  } catch {
    // Some hosts reject HEAD in browsers. Fall through to a tiny GET probe.
  }

  try {
    const response = await fetchWithTimeout(url, {
      timeout: 5000,
      headers: { Range: "bytes=0-0" }
    });
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

function getIndexEntry(index, appId) {
  const apps = index?.apps && typeof index.apps === "object" ? index.apps : index;
  const entry = apps?.[appId];
  if (!entry) return null;
  if (typeof entry === "string") return { zip: entry };
  if (typeof entry === "object") return entry;
  return null;
}

async function getMappedZip(base, appId) {
  const indexUrl = databaseUrl(base, "index.json");
  const response = await fetchWithTimeout(indexUrl, {
    timeout: 6500,
    headers: { Accept: "application/json" }
  });
  if (!response.ok) return null;

  const index = await response.json();
  const entry = getIndexEntry(index, appId);
  const zipName = entry?.zip;
  if (!zipName) return null;

  const zipUrl = databaseUrl(base, zipName);
  if (!(await resourceExists(zipUrl))) return null;
  return { url: zipUrl, fileName: zipName };
}

const ZIP_ENCODER = new TextEncoder();
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const dosDate =
    ((year - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();

  return { dosTime, dosDate };
}

function writeZipHeader(size) {
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;

  return {
    bytes,
    u16(value) {
      view.setUint16(offset, value, true);
      offset += 2;
    },
    u32(value) {
      view.setUint32(offset, value >>> 0, true);
      offset += 4;
    },
    copy(value) {
      bytes.set(value, offset);
      offset += value.length;
    }
  };
}

function createZipBlob(files) {
  const parts = [];
  const centralParts = [];
  const { dosTime, dosDate } = dosDateTime();
  let localOffset = 0;
  let entryCount = 0;
  const seenNames = new Set();

  for (const file of files) {
    if (!file?.name) continue;
    const key = file.name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    entryCount += 1;
    const fileNameBytes = ZIP_ENCODER.encode(file.name);
    const dataBytes = file.bytes;
    const checksum = crc32(dataBytes);
    const flags = 0x0800;

    const local = writeZipHeader(30 + fileNameBytes.length);
    local.u32(0x04034b50);
    local.u16(20);
    local.u16(flags);
    local.u16(0);
    local.u16(dosTime);
    local.u16(dosDate);
    local.u32(checksum);
    local.u32(dataBytes.length);
    local.u32(dataBytes.length);
    local.u16(fileNameBytes.length);
    local.u16(0);
    local.copy(fileNameBytes);

    parts.push(local.bytes, dataBytes);

    const central = writeZipHeader(46 + fileNameBytes.length);
    central.u32(0x02014b50);
    central.u16(20);
    central.u16(20);
    central.u16(flags);
    central.u16(0);
    central.u16(dosTime);
    central.u16(dosDate);
    central.u32(checksum);
    central.u32(dataBytes.length);
    central.u32(dataBytes.length);
    central.u16(fileNameBytes.length);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u16(0);
    central.u32(0);
    central.u32(localOffset);
    central.copy(fileNameBytes);

    centralParts.push(central.bytes);
    localOffset += local.bytes.length + dataBytes.length;
  }

  const centralOffset = localOffset;
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = writeZipHeader(22);
  end.u32(0x06054b50);
  end.u16(0);
  end.u16(0);
  end.u16(entryCount);
  end.u16(entryCount);
  end.u32(centralSize);
  end.u32(centralOffset);
  end.u16(0);

  return new Blob([...parts, ...centralParts, end.bytes], { type: "application/zip" });
}

function zipRootName(name) {
  return String(name || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function readZipEntries(zipBytes) {
  if (!window.fflate?.unzipSync) {
    throw new Error("ZIP reader is unavailable.");
  }

  const unzipped = window.fflate.unzipSync(zipBytes);
  return Object.entries(unzipped)
    .map(([name, bytes]) => ({
      originalName: name,
      name: zipRootName(name),
      bytes
    }))
    .filter((entry) => entry.name && !entry.originalName.endsWith("/"));
}

function createFlatZipBlobFromEntries(entries, manifests = []) {
  const files = [];
  const seen = new Set();

  entries.forEach((entry) => {
    const name = zipRootName(entry.name || entry.originalName);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ name, bytes: entry.bytes });
  });

  manifests.forEach((manifest) => {
    const name = zipRootName(manifest?.fileName);
    if (!name || !/\.manifest$/i.test(name)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    files.push({ name, bytes: manifest.bytes });
  });

  return createZipBlob(files);
}

function extractDepotIdsFromLua(luaText) {
  const depots = new Set();
  const content = String(luaText || "");
  for (const match of content.matchAll(DEPOT_ADDAPPID_RE)) {
    depots.add(match[1]);
  }
  return [...depots];
}

function extractDirectManifestFileNames(luaText) {
  const files = new Set();
  const content = String(luaText || "");
  for (const match of content.matchAll(DIRECT_MANIFEST_FILE_RE)) {
    files.add(`${match[1]}_${match[2]}.manifest`);
  }
  return [...files];
}

async function fetchSteamCmdAppInfo(appId) {
  try {
    const data = await fetchJsonWithFallback(`${STEAMCMD_INFO_URL}${appId}`, {
      timeout: 9000,
      candidates: CORS_JSON_PROXIES
    });
    return data?.status === "success" ? data : null;
  } catch (error) {
    console.debug(`SteamCMD app info unavailable for ${appId}`, error);
    return null;
  }
}

function manifestFileNamesFromAppInfo(appInfo, appId, depotIds) {
  const files = new Set();
  const depots = appInfo?.data?.[appId]?.depots;
  if (!depots || typeof depots !== "object") return [];

  depotIds.forEach((depotId) => {
    const manifestId = depots?.[depotId]?.manifests?.public?.gid;
    if (manifestId) files.add(`${depotId}_${manifestId}.manifest`);
  });

  return [...files];
}

async function requiredManifestFileNamesForLuaEntries(appId, luaEntries) {
  const requiredFiles = new Set();
  const depotIds = new Set();

  for (const luaEntry of luaEntries) {
    try {
      const luaText = new TextDecoder().decode(luaEntry.bytes);
      extractDirectManifestFileNames(luaText).forEach((fileName) => requiredFiles.add(fileName));
      extractDepotIdsFromLua(luaText).forEach((depotId) => depotIds.add(depotId));
    } catch (error) {
      console.debug(`Lua parsing skipped for ${luaEntry.name || appId}`, error);
    }
  }

  if (depotIds.size) {
    const appInfo = await fetchSteamCmdAppInfo(appId);
    manifestFileNamesFromAppInfo(appInfo, appId, [...depotIds]).forEach((fileName) => requiredFiles.add(fileName));
  }

  return [...requiredFiles];
}

async function findManifestInSources(fileName, cache) {
  if (cache.has(fileName)) return cache.get(fileName);

  for (const source of MANIFEST_SOURCES) {
    const url = databaseUrl(source.base, fileName);
    try {
      console.debug(`Searching ${source.label}: ${url}`);
      const bytes = await fetchBytesFile(url);
      if (!bytes.length) throw new Error("Empty manifest file");
      const result = { fileName, bytes, source: source.label, url };
      if (source.id === "external-vault") {
        scheduleBackfill({ type: "manifest-vault", fileName });
      }
      cache.set(fileName, result);
      return result;
    } catch (error) {
      console.debug(`${source.label} missing ${fileName}`, error);
    }
  }

  console.debug(`Manifest skipped because it was not found: ${fileName}`);
  cache.set(fileName, null);
  return null;
}

async function downloadMissingManifests(fileNames, appId) {
  if (!fileNames.length) return [];
  const cache = new Map();
  const manifests = [];
  const added = new Set();

  for (const fileName of fileNames) {
    const found = await findManifestInSources(fileName, cache);
    if (!found || added.has(found.fileName.toLowerCase())) continue;
    added.add(found.fileName.toLowerCase());
    manifests.push(found);
  }

  console.debug(`AppID ${appId}: added ${manifests.length}/${fileNames.length} optional manifest files.`);
  return manifests;
}

function summarizeManifestSources(manifests) {
  return [...new Set(manifests.map((manifest) => manifest.source).filter(Boolean))].join(" + ");
}

async function collectRequiredManifests(appId, luaBytes) {
  try {
    const requiredFiles = await requiredManifestFileNamesForLuaEntries(appId, [{ name: `${appId}.lua`, bytes: luaBytes }]);
    return downloadMissingManifests(requiredFiles, appId);
  } catch (error) {
    console.debug(`Manifest enrichment skipped for ${appId}`, error);
    return [];
  }
}

async function enrichZipBytes(appId, zipBytes) {
  try {
    const entries = readZipEntries(zipBytes);
    const luaEntries = entries.filter((entry) => /\.lua$/i.test(entry.name));
    if (!luaEntries.length) {
      return { blob: new Blob([zipBytes], { type: "application/zip" }), manifestSource: "" };
    }

    const requiredFiles = await requiredManifestFileNamesForLuaEntries(appId, luaEntries);
    const existingManifests = new Set(
      entries
        .filter((entry) => /\.manifest$/i.test(entry.name))
        .map((entry) => entry.name.toLowerCase())
    );
    const missingFiles = requiredFiles.filter((fileName) => !existingManifests.has(fileName.toLowerCase()));
    const manifests = await downloadMissingManifests(missingFiles, appId);

    return {
      blob: createFlatZipBlobFromEntries(entries, manifests),
      manifestSource: summarizeManifestSources(manifests)
    };
  } catch (error) {
    console.debug(`ZIP enrichment skipped for ${appId}`, error);
    return { blob: new Blob([zipBytes], { type: "application/zip" }), manifestSource: "" };
  }
}

async function generateLuaZip(appId, luaUrl) {
  const luaBytes = await fetchBytesFile(luaUrl);
  const manifests = await collectRequiredManifests(appId, luaBytes);
  const blob = createFlatZipBlobFromEntries([{ name: `${appId}.lua`, bytes: luaBytes }], manifests);
  currentBlobUrl = URL.createObjectURL(blob);

  return {
    kind: "generated-lua",
    source: "Used Charon Repo",
    manifestSource: summarizeManifestSources(manifests),
    url: currentBlobUrl,
    fileName: `${appId}.zip`,
    downloadAttribute: `${appId}.zip`,
    description: `${appId}.lua was found in Charon Repo and packed into a ZIP.`
  };
}

async function generateDatabaseZip(appId, zipUrl, fileName, description) {
  try {
    const zipBytes = await fetchBytesFile(zipUrl);
    const enriched = await enrichZipBytes(appId, zipBytes);
    currentBlobUrl = URL.createObjectURL(enriched.blob);

    return {
      kind: "database-zip",
      source: "Used Charon Repo",
      manifestSource: enriched.manifestSource,
      url: currentBlobUrl,
      fileName,
      downloadAttribute: fileName.endsWith(".zip") ? fileName : `${appId}.zip`,
      description: enriched.manifestSource
        ? `${description} Missing manifest files were added from ${enriched.manifestSource}.`
        : description
    };
  } catch (error) {
    console.debug(`Database ZIP enrichment failed for ${appId}`, error);
    return {
      kind: "database-zip",
      source: "Used Charon Repo",
      manifestSource: "",
      url: zipUrl,
      fileName,
      description
    };
  }
}

async function resolveDatabase(appId, database, progressStart) {
  const base = database.base;

  setStatus("Checking Charon Repo for a Lua package...", progressStart + 4);
  const luaUrl = databaseUrl(base, `${appId}.lua`);
  try {
    return {
      ...(await generateLuaZip(appId, luaUrl)),
      database: "Charon Repo"
    };
  } catch (error) {
    if (!String(error.message || "").includes("HTTP 404")) {
      console.debug(`${database.id} Lua check failed`, error);
    }
  }

  setStatus("Checking Charon Repo for a ZIP package...", progressStart + 12);
  const directZipUrl = databaseUrl(base, `${appId}.zip`);
  if (await resourceExists(directZipUrl)) {
    return {
      ...(await generateDatabaseZip(appId, directZipUrl, `${appId}.zip`, `${appId}.zip was found in Charon Repo.`)),
      database: "Charon Repo",
    };
  }

  setStatus("Checking Charon Repo package map...", progressStart + 20);
  let mapped = null;
  try {
    mapped = await getMappedZip(base, appId);
  } catch (error) {
    console.debug(`${database.id} package map check failed`, error);
  }

  if (mapped) {
    return {
      ...(await generateDatabaseZip(appId, mapped.url, mapped.fileName, `${mapped.fileName} was found in Charon Repo.`)),
      database: "Charon Repo",
    };
  }

  return null;
}

async function resolveExternalApi(appId) {
  setStatus("Checking external API fallback...", 82);
  let data;
  try {
    data = await fetchJsonWithFallback(`${GAMEGEN_API}${appId}`);
  } catch (error) {
    throw new NoPackageError(appId);
  }

  const backendMessage = String(data?.error || data?.message || "").trim();
  if (/vpn[_\s-]*blocked|no\s*files?\s*found|not\s*found|unavailable|missing/i.test(backendMessage)) {
    throw new NoPackageError(appId);
  }

  if (data?.success === false) {
    throw new NoPackageError(appId);
  }

  const downloadUrl =
    data?.data?.manifest?.downloadUrl ||
    data?.manifest?.downloadUrl ||
    data?.downloadUrl ||
    data?.download_url;

  if (!downloadUrl) {
    throw new NoPackageError(appId);
  }

  return {
    kind: "api",
    source: "Used External API",
    database: "External API",
    url: downloadUrl,
    fileName: `${appId}.zip`,
    backfill: { type: "external-package", appId },
    description: "ZIP package returned by the external API fallback."
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character];
  });
}

function steamAsset(appId, fileName) {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${fileName}`;
}

function cacheKey(appId) {
  return `${GAME_DETAILS_CACHE_PREFIX}${appId}`;
}

function normalizeGameDetails(appId, game) {
  if (!game || typeof game !== "object") {
    throw new Error("Game details were empty.");
  }

  const name = String(game.name || "").trim();
  if (!name) throw new Error("Game name was missing.");

  const publishers = Array.isArray(game.publishers)
    ? game.publishers.filter(Boolean)
    : game.publisher
      ? [game.publisher]
      : [];

  const releaseDate =
    game.release_date && typeof game.release_date === "object"
      ? game.release_date
      : { date: game.release_date || game.releaseDate || "Unknown" };

  return {
    name,
    publishers,
    release_date: {
      date: releaseDate.date || "Unknown",
      coming_soon: Boolean(releaseDate.coming_soon)
    },
    header_image: game.header_image || steamAsset(appId, "header.jpg"),
    capsule_image: game.capsule_image || steamAsset(appId, "capsule_616x353.jpg")
  };
}

function readCachedGameDetails(appId) {
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey(appId)) || "null");
    if (!cached || Date.now() - cached.savedAt > GAME_DETAILS_CACHE_TTL) return null;
    const game = normalizeGameDetails(appId, cached.game);
    if (game.name === `Steam App ${appId}` || game.name === `App ID ${appId}`) return null;
    return game;
  } catch {
    return null;
  }
}

function writeCachedGameDetails(appId, game) {
  try {
    localStorage.setItem(cacheKey(appId), JSON.stringify({
      savedAt: Date.now(),
      game: normalizeGameDetails(appId, game)
    }));
  } catch {
    // Storage can be blocked in strict browser modes; the live fetch still works.
  }
}

function renderGameLoading() {
  gameDetails.classList.remove("is-empty");
  gameDetails.innerHTML = `
    <div class="game-loading" aria-hidden="true">
      <span class="skeleton banner"></span>
      <span class="skeleton line"></span>
      <span class="skeleton line short"></span>
    </div>
  `;
}

function renderGameShell(appId) {
  renderGameDetails(appId, {
    name: "Loading game...",
    header_image: steamAsset(appId, "header.jpg"),
    capsule_image: steamAsset(appId, "capsule_616x353.jpg")
  });
}

function renderGameError(appId, message) {
  renderGameDetails(appId, {
    name: `App ID ${appId}`,
    publishers: ["Unknown"],
    release_date: { date: "Unknown" },
    header_image: steamAsset(appId, "header.jpg"),
    capsule_image: steamAsset(appId, "capsule_616x353.jpg")
  });
}

function renderGameDetails(appId, game) {
  const banner = game.header_image || game.capsule_image || steamAsset(appId, "header.jpg");
  const gameName = game.name || `Steam App ${appId}`;

  gameDetails.classList.remove("is-empty");
  gameDetails.innerHTML = `
    <article class="game-banner-view">
      <div class="game-banner-frame">
        <img src="${escapeHtml(banner)}" alt="${escapeHtml(gameName)} banner" loading="eager" decoding="async">
      </div>
      <div class="game-banner-copy">
        <h2>${escapeHtml(gameName)}</h2>
        <div class="game-info-row">
          <span>App ID: ${escapeHtml(appId)}</span>
        </div>
      </div>
    </article>
  `;
}

async function fetchStoreGameDetails(appId) {
  const data = await fetchJsonFirst(`${STORE_DETAILS_URL}${appId}&filters=${STORE_DETAILS_FILTERS}`, {
    timeout: 12000,
    candidates: STEAM_STORE_JSON_PROXIES
  });
  const entry = data?.[appId];
  if (!entry?.success || !entry.data) {
    throw new Error("Steam did not return game data.");
  }
  return normalizeGameDetails(appId, entry.data);
}

async function fetchBackupGameDetails(appId) {
  const data = await fetchJsonFirst(`${STEAMSPY_DETAILS_URL}${appId}`, {
    timeout: 12000,
    candidates: STEAMSPY_JSON_PROXIES
  });
  if (!data?.name) throw new Error("Backup game details were unavailable.");

  return normalizeGameDetails(appId, {
    name: data.name,
    publishers: data.publisher ? [data.publisher] : [],
    release_date: { date: data.release_date || "Not listed" },
    header_image: steamAsset(appId, "header.jpg"),
    capsule_image: steamAsset(appId, "capsule_616x353.jpg")
  });
}

async function fetchStorePageGameDetails(appId) {
  const html = await fetchTextWithFallback(`${STEAM_APP_PAGE_URL}${appId}`, {
    timeout: 8000,
    candidates: STEAM_SUGGEST_PROXIES
  });
  const parser = new DOMParser();
  const documentHtml = parser.parseFromString(String(html || ""), "text/html");
  const name =
    documentHtml.querySelector("#appHubAppName")?.textContent?.trim() ||
    documentHtml.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
    documentHtml.querySelector("title")?.textContent?.replace(/\s+on Steam\s*$/i, "").trim();
  if (!name) throw new Error("Steam store page title unavailable.");

  return normalizeGameDetails(appId, {
    name,
    publishers: [],
    release_date: { date: "Unknown" },
    header_image: documentHtml.querySelector("meta[property='og:image']")?.getAttribute("content") || steamAsset(appId, "header.jpg"),
    capsule_image: steamAsset(appId, "capsule_616x353.jpg")
  });
}

function isActiveRequest(requestId) {
  return requestId === activeRequestId;
}

async function loadGameDetails(appId, requestId) {
  const cached = readCachedGameDetails(appId);
  if (cached) {
    renderGameDetails(appId, cached);
  } else {
    renderGameShell(appId);
  }

  const storeDetails = fetchStoreGameDetails(appId);
  const backupDetails = fetchBackupGameDetails(appId);
  const storePageDetails = fetchStorePageGameDetails(appId);

  try {
    const game = await Promise.any([storeDetails, backupDetails, storePageDetails]);
    if (!isActiveRequest(requestId)) return;
    writeCachedGameDetails(appId, game);
    renderGameDetails(appId, game);
  } catch (error) {
    console.debug("Game details failed", error);
    if (!isActiveRequest(requestId)) return;
    if (!cached) renderGameError(appId, "Steam details are unavailable right now. Please try again.");
  }

  storeDetails
    .then((game) => {
      if (!isActiveRequest(requestId)) return;
      writeCachedGameDetails(appId, game);
      renderGameDetails(appId, game);
    })
    .catch((error) => console.debug("Steam Store details failed", error));
}

function showDownload(result) {
  downloadSource.textContent = result.manifestSource
    ? `${result.source} · ${result.manifestSource}`
    : result.source;
  downloadTitle.textContent = "Download ZIP";
  downloadDescription.textContent = result.description;
  downloadLink.href = result.url;
  downloadLink.querySelector("span").textContent = "Download ZIP";

  if (result.downloadAttribute) {
    downloadLink.setAttribute("download", result.downloadAttribute);
    downloadLink.removeAttribute("target");
    downloadLink.removeAttribute("rel");
  } else {
    downloadLink.removeAttribute("download");
    downloadLink.target = "_blank";
    downloadLink.rel = "noopener";
  }

  downloadPanel.classList.remove("is-hidden");
  setStatus("ZIP ready.", 100);
  if (result.backfill) scheduleBackfill(result.backfill);
  downloadLink.focus({ preventScroll: true });
}

async function resolvePackage(appId) {
  const db1 = await resolveDatabase(appId, DATABASES[0], 24);
  if (db1) return db1;

  const db2 = await resolveDatabase(appId, DATABASES[1], 52);
  if (db2) return db2;

  return resolveExternalApi(appId);
}

function syncAppIdUrl(appId) {
  if (!window.history?.replaceState) return;
  const url = new URL(window.location.href);
  url.searchParams.set("appid", appId);
  window.history.replaceState(null, "", url);
}

async function generateForAppId(appId) {
  clearDownload();
  hideSuggestions();
  try {
    assertAppId(appId);
    syncAppIdUrl(appId);
    setBusy(true);
    setStatus("Fetching game banner and checking package...", 8);

    const requestId = ++activeRequestId;
    loadGameDetails(appId, requestId);
    const result = await resolvePackage(appId);
    if (!isActiveRequest(requestId)) return;
    showDownload(result);
  } catch (error) {
    setStatus(error.message || "Generation failed.", 100, "error");
    downloadPanel.classList.add("is-hidden");
  } finally {
    setBusy(false);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  const appId = normalizeAppId(input.value);
  generateForAppId(appId);
}

form.addEventListener("submit", handleSubmit);
input.addEventListener("input", scheduleSuggestions);
input.addEventListener("keydown", (event) => {
  if (!suggestionList.classList.contains("is-open")) return;
  if (event.key === "ArrowDown") {
    event.preventDefault();
    updateActiveSuggestion(activeSuggestionIndex + 1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    updateActiveSuggestion(activeSuggestionIndex - 1);
  } else if (event.key === "Enter" && currentSuggestions.length) {
    event.preventDefault();
    chooseSuggestion();
  } else if (event.key === "Escape") {
    hideSuggestions();
  }
});
input.addEventListener("blur", () => {
  window.setTimeout(hideSuggestions, 140);
});
suggestionList.addEventListener("click", (event) => {
  const item = event.target.closest(".suggestion-item");
  if (!item) return;
  chooseSuggestion(Number(item.dataset.index));
  input.focus();
});
suggestionList.addEventListener("mousemove", (event) => {
  const item = event.target.closest(".suggestion-item");
  if (!item) return;
  updateActiveSuggestion(Number(item.dataset.index));
});
suggestionList.addEventListener("error", handleSuggestionImageError, true);

const initialAppId = normalizeAppId(new URLSearchParams(window.location.search).get("appid"));
if (/^\d+$/.test(initialAppId)) {
  input.value = initialAppId;
  window.setTimeout(() => generateForAppId(initialAppId), 0);
}

window.CharonGen = {
  resolveDatabase,
  resolvePackage,
  resolveExternalApi,
  getMappedZip,
  resourceExists,
  generateLuaZip,
  generateDatabaseZip,
  enrichZipBytes,
  readZipEntries,
  loadGameDetails,
  fetchStoreGameDetails,
  fetchBackupGameDetails,
  suggestionUrl,
  parseSteamSuggestions,
  steamSuggestionImageCandidates,
  scheduleBackfill
};

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

const STORE_DETAILS_URL =
  "https://store.steampowered.com/api/appdetails?l=en&cc=us&appids=";

const STEAMSPY_DETAILS_URL =
  "https://steamspy.com/api.php?request=appdetails&appid=";

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

const JINA_JSON_PROXY = {
  name: "jina",
  makeUrl: (url) => `https://r.jina.ai/http://${url}`,
  parse: async (response) => {
    const text = await response.text();
    const marker = "Markdown Content:";
    const markerIndex = text.indexOf(marker);
    const jsonText = markerIndex >= 0 ? text.slice(markerIndex + marker.length).trim() : text.trim();
    return JSON.parse(jsonText);
  }
};

const CORSPROXY_JSON_PROXY = {
  name: "corsproxy",
  makeUrl: (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  parse: (response) => response.json()
};

const CORS_JSON_PROXIES = [
  DIRECT_JSON_PROXY,
  ALLORIGINS_JSON_PROXY,
  CORSPROXY_JSON_PROXY
];

const STEAM_STORE_JSON_PROXIES = [
  DIRECT_JSON_PROXY,
  JINA_JSON_PROXY,
  ALLORIGINS_JSON_PROXY,
  CORSPROXY_JSON_PROXY
];

const form = document.querySelector("#generatorForm");
const input = document.querySelector("#appid");
const button = document.querySelector("#generateBtn");
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

function setStatus(message, percent = 0, type = "info") {
  statusText.textContent = message;
  statusDot.classList.toggle("is-error", type === "error");
  progressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setBusy(isBusy) {
  button.disabled = isBusy;
  button.textContent = isBusy ? "Working..." : "Generate ZIP";
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
  return String(value || "").trim();
}

function assertAppId(appId) {
  if (!/^\d+$/.test(appId)) {
    throw new Error("Enter a valid numeric Steam App ID.");
  }
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

async function fetchBytesFile(url) {
  const response = await fetchWithTimeout(url, {
    timeout: 10000,
    headers: { Accept: "text/plain, application/octet-stream" }
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

  for (const file of files) {
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
  end.u16(files.length);
  end.u16(files.length);
  end.u32(centralSize);
  end.u32(centralOffset);
  end.u16(0);

  return new Blob([...parts, ...centralParts, end.bytes], { type: "application/zip" });
}

async function generateLuaZip(appId, luaUrl) {
  const luaBytes = await fetchBytesFile(luaUrl);
  const blob = createZipBlob([{ name: `${appId}.lua`, bytes: luaBytes }]);
  currentBlobUrl = URL.createObjectURL(blob);

  return {
    kind: "generated-lua",
    source: "Used Charon Repo",
    url: currentBlobUrl,
    fileName: `${appId}.zip`,
    downloadAttribute: `${appId}.zip`,
    description: `${appId}.lua was found in Charon Repo and packed into a ZIP.`
  };
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
      kind: "direct-zip",
      source: "Used Charon Repo",
      database: "Charon Repo",
      url: directZipUrl,
      fileName: `${appId}.zip`,
      description: `${appId}.zip was found in Charon Repo.`
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
      kind: "indexed-zip",
      source: "Used Charon Repo",
      database: "Charon Repo",
      url: mapped.url,
      fileName: mapped.fileName,
      description: `${mapped.fileName} was found in Charon Repo.`
    };
  }

  return null;
}

async function resolveExternalApi(appId) {
  setStatus("Checking external API fallback...", 82);
  const data = await fetchJsonWithFallback(`${GAMEGEN_API}${appId}`);
  const downloadUrl =
    data?.data?.manifest?.downloadUrl ||
    data?.manifest?.downloadUrl ||
    data?.downloadUrl ||
    data?.download_url;

  if (!downloadUrl) {
    throw new Error("Backup source did not return a ZIP URL.");
  }

  return {
    kind: "api",
    source: "Used External API",
    database: "External API",
    url: downloadUrl,
    fileName: `${appId}.zip`,
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

function renderGameError(appId, message) {
  gameDetails.classList.remove("is-empty");
  gameDetails.innerHTML = `
    <div class="error-card">
      <h2>Limited Steam details</h2>
      <p>Charon could not load full Store details for App ID ${escapeHtml(appId)}. ${escapeHtml(message)}</p>
    </div>
  `;
}

function renderGameDetails(appId, game) {
  const banner = game.header_image || game.capsule_image || steamAsset(appId, "header.jpg");
  const gameName = game.name || `Steam App ${appId}`;
  const publishers = Array.isArray(game.publishers) && game.publishers.length
    ? game.publishers.join(", ")
    : "Unknown";
  const releaseDate = game.release_date?.date || "Unknown";

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
          <span>Publisher: ${escapeHtml(publishers)}</span>
          <span>Release: ${escapeHtml(releaseDate)}</span>
        </div>
      </div>
    </article>
  `;
}

async function fetchStoreGameDetails(appId) {
  const data = await fetchJsonFirst(`${STORE_DETAILS_URL}${appId}`, {
    timeout: 6500,
    candidates: STEAM_STORE_JSON_PROXIES
  });
  const entry = data?.[appId];
  if (!entry?.success || !entry.data) {
    throw new Error("Steam did not return game data.");
  }
  return entry.data;
}

async function fetchBackupGameDetails(appId) {
  const data = await fetchJsonWithFallback(`${STEAMSPY_DETAILS_URL}${appId}`, { timeout: 6500 });
  if (!data?.name) throw new Error("Backup game details were unavailable.");

  return {
    name: data.name,
    publishers: data.publisher ? [data.publisher] : [],
    release_date: { date: data.release_date || "Not listed" },
    genres: String(data.genre || "")
      .split(",")
      .map((description) => ({ description: description.trim() }))
      .filter((genre) => genre.description),
    platforms: {},
    header_image: steamAsset(appId, "header.jpg"),
    capsule_image: steamAsset(appId, "capsule_616x353.jpg"),
    short_description: "Store details were blocked in this browser, so Charon is showing fast backup game details while the package search continues."
  };
}

function basicGameDetails(appId) {
  return {
    name: `Steam App ${appId}`,
    publishers: [],
    release_date: { date: "Unknown" },
    header_image: steamAsset(appId, "header.jpg")
  };
}

function isActiveRequest(requestId) {
  return requestId === activeRequestId;
}

async function loadGameDetails(appId, requestId) {
  renderGameDetails(appId, {
    ...basicGameDetails(appId),
    name: `Steam App ${appId}`
  });

  const storeDetails = fetchStoreGameDetails(appId);
  const backupDetails = fetchBackupGameDetails(appId);

  try {
    const game = await Promise.any([storeDetails, backupDetails]);
    if (!isActiveRequest(requestId)) return;
    renderGameDetails(appId, game);
  } catch (error) {
    console.debug("Game details failed", error);
    if (!isActiveRequest(requestId)) return;
    renderGameDetails(appId, basicGameDetails(appId));
  }

  storeDetails
    .then((game) => {
      if (isActiveRequest(requestId)) renderGameDetails(appId, game);
    })
    .catch((error) => console.debug("Steam Store details failed", error));
}

function showDownload(result) {
  downloadSource.textContent = result.source;
  downloadTitle.textContent = "Download ZIP";
  downloadDescription.textContent = result.description;
  downloadLink.href = result.url;
  downloadLink.textContent = "Download ZIP";

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
  downloadLink.focus({ preventScroll: true });
}

async function resolvePackage(appId) {
  const db1 = await resolveDatabase(appId, DATABASES[0], 24);
  if (db1) return db1;

  const db2 = await resolveDatabase(appId, DATABASES[1], 52);
  if (db2) return db2;

  return resolveExternalApi(appId);
}

async function handleSubmit(event) {
  event.preventDefault();
  clearDownload();

  const appId = normalizeAppId(input.value);

  try {
    assertAppId(appId);
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

form.addEventListener("submit", handleSubmit);

window.CharonGen = {
  resolveDatabase,
  resolvePackage,
  resolveExternalApi,
  getMappedZip,
  resourceExists,
  generateLuaZip,
  loadGameDetails,
  fetchStoreGameDetails,
  fetchBackupGameDetails
};

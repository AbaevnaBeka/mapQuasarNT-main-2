* =========================
   ⚙️ НАСТРОЙКИ
========================= */
const defaultView = [51, 71];
const defaultZoom = 5;

const url = "https://opensheet.elk.sh/1lTNia31AF5mr-Gkv06KQr9la0SRhxBE0a5tf_0iyLI8/Лист1";

/* =========================
   🗺️ КАРТА
========================= */
const map = L.map('map', { preferCanvas: true, closePopupOnClick: false }).setView(defaultView, defaultZoom);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png').addTo(map);

let markerCluster = L.markerClusterGroup();
map.addLayer(markerCluster);

let isShowingClientOnMap = false;

/* =========================
   📦 ДАННЫЕ
========================= */
let allData = [];
let chart;
let searchMarker = null;
let activeClientMarker = null;
const markerByKey = new Map();
let clientSearchDebounceTimer = null;
let mobileSearchDebounceTimer = null;
let pendingMobileScrollToFirst = false;

/* =========================
   🎨 ЦВЕТА
========================= */
const providerColors = {};
const palette = ["#3498db", "#9b59b6", "#1abc9c", "#34495e"];

const statusColors = {
  "подключен": "#2ecc71",
  "отключен": "#e74c3c",
  "есть возможность подключения": "#f1c40f",
  "идет подключение": "#e67e22"
};

const allowedMobileClientStatuses = new Set([
  "подключен",
  "отключен",
  "есть возможность подключения",
  "идет подключение"
]);

let mobileStatusFilters = new Set();

/* =========================
   🚀 PWA + ЗАГРУЗКА
========================= */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => console.log('SW registered'))
    .catch(() => console.log('SW failed'));
}

function applyDisplayModeClass() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  document.body.classList.toggle('standalone', Boolean(isStandalone));
}

applyDisplayModeClass();
window.matchMedia('(display-mode: standalone)').addEventListener('change', applyDisplayModeClass);

let deferredPrompt;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
});

fetch(url)
  .then(r => r.json())
  .then(data => {
    allData = data;
    assignColors(data);
    populateFilters(data);
    updateAll(data);
    if (typeof setTab === "function") setTab("map");
  });

/* =========================
   🧹 УТИЛИТЫ
========================= */
function clean(str) {
  return (str || "").toLowerCase().trim().replace(/\s+/g, " ");
}

const searchSynonyms = {
  "казахтелеком": "kazakhtelecom",
  "kazakhtelecom": "kazakhtelecom",
  "астана": "astana",
  "astana": "astana"
};

const keyboardLayoutMap = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ", p: "з",
  "[": "х", "]": "ъ", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л",
  l: "д", ";": "ж", "'": "э", z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь",
  ",": "б", ".": "ю",
  й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p",
  х: "[", ъ: "]", ф: "a", ы: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k",
  д: "l", ж: ";", э: "'", я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m",
  б: ",", ю: "."
};

function remapKeyboardLayout(str) {
  return String(str || "")
    .split("")
    .map(char => keyboardLayoutMap[char] || char)
    .join("");
}

function buildAddressQueryVariants(query) {
  const base = String(query || "").trim();
  const remapped = remapKeyboardLayout(base);
  const normalizedBase = base.replace(/\s+/g, " ").trim();
  const normalizedRemapped = remapped.replace(/\s+/g, " ").trim();

  return [
    ...new Map(
      [
        { value: base, reason: "exact" },
        { value: remapped, reason: remapped && remapped !== base ? "layout" : "exact" },
        { value: normalizedBase, reason: "exact" },
        { value: normalizedRemapped, reason: normalizedRemapped && normalizedRemapped !== normalizedBase ? "layout" : "exact" }
      ]
        .filter(item => item.value)
        .map(item => [item.value, item])
    ).values()
  ];
}

function updateAddressSearchHint(original, suggestion, reason) {
  const hint = document.getElementById("newAddressHint");
  if (!hint) return;

  if (!suggestion || suggestion === original || reason === "exact") {
    hint.textContent = "";
    hint.style.display = "none";
    hint.onclick = null;
    return;
  }

  hint.innerHTML = `Возможно, вы имели в виду: <button type="button" class="search-hint-action">${suggestion}</button>`;
  hint.style.display = "block";
  hint.onclick = function (event) {
    const action = event.target.closest(".search-hint-action");
    if (!action) return;
    const input = document.getElementById("newAddress");
    if (!input) return;
    input.value = suggestion;
    updateAddressSearchHint(suggestion, "", "exact");
    findAddress();
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getHighlightTerms(query) {
  const variants = buildQueryVariants(query);
  return [...new Set(
    variants
      .flatMap(item => item.value.split(" "))
      .filter(token => token && token.length >= 2)
  )];
}

function highlightText(value, query) {
  const source = String(value || "");
  if (!source) return "";

  const terms = getHighlightTerms(query).sort((a, b) => b.length - a.length);
  if (!terms.length) return escapeHtml(source);

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join("|")})`, "ig");
  return escapeHtml(source).replace(pattern, "<mark>$1</mark>");
}

function normalizeSearchText(str) {
  return clean(str)
    .replace(/[.,/#!$%^&*;:{}=\-_`~()\\[\]+"]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(token => searchSynonyms[token] || token)
    .join(" ");
}

function getSearchableFields(client) {
  return {
    name: normalizeSearchText(client.name),
    address: normalizeSearchText(client.address),
    provider: normalizeSearchText(client.provider),
    city: normalizeSearchText(client.city)
  };
}

function buildQueryVariants(query) {
  const base = normalizeSearchText(query);
  const remapped = normalizeSearchText(remapKeyboardLayout(clean(query)));
  return [
    ...new Map(
      [
        { value: base, reason: "exact" },
        { value: remapped, reason: remapped && remapped !== base ? "layout" : "exact" }
      ]
        .filter(item => item.value)
        .map(item => [item.value, item])
    ).values()
  ];
}

function levenshteinDistance(a, b, maxDistance = 2) {
  if (a === b) return 0;
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let minInRow = curr[0];

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost
      );
      if (curr[j] < minInRow) minInRow = curr[j];
    }

    if (minInRow > maxDistance) return maxDistance + 1;

    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[b.length];
}

function getBestTokenDistance(queryTokens, fieldTokens) {
  let totalDistance = 0;
  let matchedTokens = 0;

  queryTokens.forEach(queryToken => {
    let best = Infinity;
    fieldTokens.forEach(fieldToken => {
      const distance = levenshteinDistance(queryToken, fieldToken, 2);
      if (distance < best) best = distance;
    });

    if (best <= 2) {
      totalDistance += best;
      matchedTokens += 1;
    }
  });

  return {
    matchedTokens,
    averageDistance: matchedTokens ? totalDistance / matchedTokens : Infinity
  };
}

function scoreSearchField(value, query, boost) {
  if (!value) return 0;

  let score = 0;
  const queryTokens = query.split(" ").filter(Boolean);
  const fieldTokens = value.split(" ").filter(Boolean);

  if (value === query) score += 120 * boost;
  if (value.startsWith(query)) score += 90 * boost;
  if (value.includes(query)) score += 55 * boost;

  queryTokens.forEach(token => {
    if (token.length < 2) return;

    fieldTokens.forEach(fieldToken => {
      if (fieldToken === token) score += 42 * boost;
      else if (fieldToken.startsWith(token)) score += 24 * boost;
    });
  });

  return score;
}

function scoreFuzzyField(value, query, boost) {
  if (!value) return 0;

  const queryTokens = query.split(" ").filter(Boolean);
  const fieldTokens = value.split(" ").filter(Boolean);
  if (!queryTokens.length || !fieldTokens.length) return 0;

  const { matchedTokens, averageDistance } = getBestTokenDistance(queryTokens, fieldTokens);
  if (!matchedTokens) return 0;

  const coverage = matchedTokens / queryTokens.length;
  if (coverage < 0.6 || averageDistance > 2) return 0;

  return ((22 - averageDistance * 6) * coverage) * boost;
}

function scoreTokenOrder(value, query, boost) {
  if (!value || !query) return 0;
  const compactValue = value.replace(/\s+/g, " ");
  const compactQuery = query.replace(/\s+/g, " ");
  return compactValue.includes(compactQuery) ? 16 * boost : 0;
}

function searchClients(query, dataset = allData) {
  const queryVariants = buildQueryVariants(query);
  if (!queryVariants.length) {
    return { items: [], suggestion: null };
  }

  const exactMatches = [];
  const fuzzyMatches = [];
  let suggestion = null;

  dataset.forEach(client => {
    const fields = getSearchableFields(client);
    let bestExactScore = 0;
    let bestFuzzyScore = 0;
    let bestReason = "exact";
    let bestVariant = queryVariants[0]?.value || "";

    queryVariants.forEach(({ value: variant, reason }) => {
      const exactScore =
        scoreSearchField(fields.address, variant, 4) +
        scoreSearchField(fields.provider, variant, 3) +
        scoreSearchField(fields.city, variant, 2) +
        scoreSearchField(fields.name, variant, 2) +
        scoreTokenOrder(fields.address, variant, 3) +
        scoreTokenOrder(fields.city, variant, 2) +
        scoreTokenOrder(fields.provider, variant, 2);

      if (exactScore > bestExactScore) {
        bestExactScore = exactScore;
        bestReason = reason;
        bestVariant = variant;
      }

      const fuzzyScore =
        scoreFuzzyField(fields.address, variant, 4) +
        scoreFuzzyField(fields.provider, variant, 3) +
        scoreFuzzyField(fields.city, variant, 2) +
        scoreFuzzyField(fields.name, variant, 2);

      if (fuzzyScore > bestFuzzyScore) {
        bestFuzzyScore = fuzzyScore;
        if (fuzzyScore > bestExactScore) {
          bestReason = reason === "layout" ? "layout" : "typo";
          bestVariant = variant;
        }
      }
    });

    if (bestExactScore > 0) {
      exactMatches.push({ client, score: bestExactScore, reason: bestReason, variant: bestVariant });
      return;
    }

    if (bestFuzzyScore > 0) {
      fuzzyMatches.push({ client, score: bestFuzzyScore, reason: bestReason === "layout" ? "layout" : "typo", variant: bestVariant });
    }
  });

  const primaryResults = exactMatches
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  if (primaryResults.length && primaryResults[0].reason !== "exact") {
    suggestion = {
      type: primaryResults[0].reason,
      text: primaryResults[0].variant
    };
  }

  if (primaryResults.length >= 5) {
    return {
      items: primaryResults.map(entry => entry.client),
      suggestion
    };
  }

  const fallbackResults = fuzzyMatches
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, 10 - primaryResults.length));

  if (!suggestion && fallbackResults.length && fallbackResults[0].reason !== "exact") {
    suggestion = {
      type: fallbackResults[0].reason,
      text: fallbackResults[0].variant
    };
  }

  return {
    items: [...primaryResults, ...fallbackResults].map(entry => entry.client),
    suggestion
  };
}

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function findNearestProviders(lat, lon) {
  let list = [];

  allData.forEach(c => {
    if (!c.lat || !c.lng || !c.provider) return;

    const clat = parseFloat((c.lat + "").replace(',', '.'));
    const clng = parseFloat((c.lng + "").replace(',', '.'));
    if (isNaN(clat) || isNaN(clng)) return;

    const dist = getDistance(lat, lon, clat, clng);
    list.push({ provider: c.provider, distance: dist });
  });

  list.sort((a, b) => a.distance - b.distance);

  const result = [];
  const used = new Set();

  for (let item of list) {
    if (!used.has(item.provider)) {
      used.add(item.provider);
      result.push(item);
    }
    if (result.length === 3) break;
  }

  return result;
}

function getClientKey(lat, lng) {
  return `${Number(lat).toFixed(6)}:${Number(lng).toFixed(6)}`;
}

function setActiveMarker(marker) {
  if (activeClientMarker) {
    activeClientMarker.setStyle({ radius: 6, weight: 1, color: activeClientMarker._baseColor });
  }
  activeClientMarker = marker || null;
  if (activeClientMarker) {
    activeClientMarker.setStyle({ radius: 10, weight: 3, color: "#0b4fb6" });
  }
}

function getClientPopupContent(c) {
  return `<b>${c.name || "Клиент"}</b><br>${c.address || "Адрес не указан"}<br>📡 ${c.provider || "Провайдер не указан"}<br>📶 ${c.status || "Статус не указан"}`;
}

function showClientOnMap(c) {
  const lat = parseFloat((c.lat + "").replace(',', '.'));
  const lng = parseFloat((c.lng + "").replace(',', '.'));
  if (isNaN(lat) || isNaN(lng)) return;

  isShowingClientOnMap = true;
  closeBottomSheet();
  setTab("map");

  const key = getClientKey(lat, lng);
  let marker = markerByKey.get(key);

  if (!marker) {
    updateAll(allData);
    marker = markerByKey.get(key);
  }

  map.flyTo([lat, lng], 16, { duration: 1.2 });
  if (!marker) {
    isShowingClientOnMap = false;
    return;
  }

  markerCluster.zoomToShowLayer(marker, function () {
    setActiveMarker(marker);

    marker.bindPopup(getClientPopupContent(c)).openPopup();
    setTimeout(() => { isShowingClientOnMap = false; }, 100);
  });
}

function hideMobileKeyboard() {
  const active = document.activeElement;
  if (active && typeof active.blur === "function") {
    active.blur();
  }

  const mobileSearch = document.getElementById("mobileSearch");
  const searchClient = document.getElementById("searchClient");
  if (mobileSearch) mobileSearch.blur();
  if (searchClient) searchClient.blur();
}

function consumeMobileDismissTap() {
  if (isShowingClientOnMap) return false;

  const isMobileViewport = window.matchMedia("(max-width: 768px)").matches;
  if (!isMobileViewport) return false;

  const leftPanel = document.getElementById("leftPanel");
  const rightPanel = document.getElementById("rightPanel");
  const bottomSheet = document.getElementById("bottomSheet");

  const hasOpenPanel =
    (leftPanel && leftPanel.classList.contains("open")) ||
    (rightPanel && rightPanel.classList.contains("open"));
  const hasOpenBottomSheet = bottomSheet && bottomSheet.classList.contains("open");

  if (!hasOpenPanel && !hasOpenBottomSheet) return false;

  if (leftPanel) leftPanel.classList.remove("open");
  if (rightPanel) rightPanel.classList.remove("open");
  if (hasOpenBottomSheet) closeBottomSheet();
  document.body.classList.remove("panel-open");
  return true;
}

/* =========================
   🔄 КАРТА
========================= */
function updateAll(data) {
  markerCluster.clearLayers();
  markerByKey.clear();
  setActiveMarker(null);

  data.forEach(c => {
    if (!c.lat || !c.lng) return;

    const lat = parseFloat((c.lat + "").replace(',', '.'));
    const lng = parseFloat((c.lng + "").replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) return;

    const color = statusColors[clean(c.status)] || "#999";

    const m = L.circleMarker([lat, lng], {
      color,
      fillColor: color,
      fillOpacity: 0.9,
      radius: 6,
      weight: 1
    });
    m._baseColor = color;

    m.on("click", function (event) {
      if (event && event.originalEvent) {
        L.DomEvent.stopPropagation(event.originalEvent);
      }
      if (consumeMobileDismissTap()) return;
      setActiveMarker(m);
      m.bindPopup(getClientPopupContent(c)).openPopup();
      openBottomSheet(c);
    });

    markerByKey.set(getClientKey(lat, lng), m);
    markerCluster.addLayer(m);
  });

  updateStats(data);
  if (chart) chart.destroy();
  createChart(data);
  createStatusButtons(data);
}

/* =========================
   📊 СТАТУСЫ
========================= */
function createStatusButtons(data) {
  const stats = {};
  data.forEach(c => {
    const s = clean(c.status);
    if (!s) return;
    stats[s] = (stats[s] || 0) + 1;
  });

  const div = document.getElementById("statusButtons");
  if (!div) return;

  div.innerHTML = "<h3>📊 Статусы</h3>";

  for (let s in stats) {
    const btn = document.createElement("div");
    btn.className = "status-btn";
    btn.style.background = statusColors[s] || "#999";
    btn.innerHTML = `${s} (${stats[s]})`;

    btn.onclick = () => {
      const select = document.getElementById("searchStatus");
      const options = [...select.options];
      const isSelected = options.some(o => o.value === s && o.selected);
      const selectedCount = options.filter(o => o.selected).length;

      if (isSelected && selectedCount === 1) {
        options.forEach(o => (o.selected = false));
      } else {
        options.forEach(o => (o.selected = (o.value === s)));
      }

      applyFilters();
    };

    div.appendChild(btn);
  }
}

/* =========================
   🔍 ПОИСК
========================= */
function searchClientList() {
  clearTimeout(clientSearchDebounceTimer);
  clientSearchDebounceTimer = setTimeout(runClientSearchList, 180);
}

function runClientSearchList() {
  const v = document.getElementById("searchClient").value;
  const list = document.getElementById("clientList");

  list.innerHTML = "";
  if (!v.trim()) return;

  const result = searchClients(v);

  if (result.suggestion && normalizeSearchText(v) !== result.suggestion.text) {
    const suggestion = document.createElement("div");
    suggestion.className = "search-hint";
    suggestion.innerHTML = `Возможно, вы имели в виду: <button type="button" class="search-hint-action">${result.suggestion.text}</button>`;
    suggestion.onclick = function (event) {
      const action = event.target.closest(".search-hint-action");
      if (!action) return;
      const input = document.getElementById("searchClient");
      if (!input) return;
      input.value = result.suggestion.text;
      runClientSearchList();
    };
    list.appendChild(suggestion);
  }

  result.items.forEach(c => {
    const parts = [c.address, c.city, c.provider].filter(Boolean);
    const d = document.createElement("div");
    d.className = "suggestion";
    d.innerHTML = `<b>${highlightText(c.name || "Клиент", v)}</b><br><small>${parts.map(part => highlightText(part, v)).join(" • ")}</small>`;
    d.onclick = () => selectSuggestion(c);
    list.appendChild(d);
  });
}

function selectSuggestion(c) {
  document.getElementById("searchClient").value = c.name;
  const lat = parseFloat((c.lat + "").replace(',', '.'));
  const lng = parseFloat((c.lng + "").replace(',', '.'));

  if (isNaN(lat) || isNaN(lng)) return;

  hideMobileKeyboard();
  showClientOnMap(c);

  document.getElementById("clientList").innerHTML = "";
}

/* =========================
   🎯 ФИЛЬТРЫ
========================= */
function applyFilters() {
  const filtered = getFilteredData();
  updateAll(filtered);
}

function getFilteredData() {
  const p = document.getElementById("searchProvider").value;
  const s = [...document.getElementById("searchStatus").selectedOptions].map(o => o.value);

  return allData.filter(c => {
    const prov = clean(c.provider);
    const stat = clean(c.status);

    if (p && !prov.includes(p)) return false;
    if (s.length && !s.includes(stat)) return false;
    if (mobileStatusFilters.size && !mobileStatusFilters.has(stat)) return false;

    return true;
  });
}

/* =========================
   📊 CHART
========================= */
function createChart(data) {
  if (!document.getElementById("chart")) return;
  const selectedProvider = document.getElementById("searchProvider")?.value || "";
  const stats = {};

  if (selectedProvider) {
    data.forEach(c => {
      const s = clean(c.status);
      if (!s) return;
      stats[s] = (stats[s] || 0) + 1;
    });
  } else {
    data.forEach(c => {
      if (c.provider) stats[c.provider] = (stats[c.provider] || 0) + 1;
    });
  }

  if (!Object.keys(stats).length) return;

  chart = new Chart(document.getElementById("chart"), {
    type: "pie",
    data: {
      labels: Object.keys(stats),
      datasets: [{
        data: Object.values(stats),
        backgroundColor: selectedProvider
          ? Object.keys(stats).map(s => statusColors[s] || "#999")
          : Object.keys(stats).map(p => providerColors[p] || "#999")
      }]
    }
  });
}

/* =========================
   📊 СТАТИСТИКА
========================= */
function updateStats(data) {
  const div = document.getElementById("rightStats");
  if (!div) return;

  const selectedProvider = document.getElementById("searchProvider")?.value || "";

  const stats = {};

  if (selectedProvider) {
    data.forEach(c => {
      if (!clean(c.provider).includes(selectedProvider)) return;
      const s = clean(c.status);
      if (!s) return;
      stats[s] = (stats[s] || 0) + 1;
    });
  } else {
    data.forEach(c => {
      if (c.provider) stats[c.provider] = (stats[c.provider] || 0) + 1;
    });
  }

  const sorted = Object.entries(stats).sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((sum, [, v]) => sum + v, 0) || 1;

  div.innerHTML = sorted
    .map(([key, value]) => {
      const percent = Math.round((value / total) * 100);
      const color = selectedProvider
        ? (statusColors[key] || "#999")
        : (providerColors[key] || "#999");
      return `${key}: ${value}<div class="bar" style="background:${color}; width:${percent}%"></div>`;
    })
    .join("");
}

function bindMobileStatusStrip() {
  const strip = document.getElementById("mobileStatusStrip");
  if (!strip) return;

  strip.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-mobile-status]");
    if (!btn) return;

    const status = btn.dataset.mobileStatus || "all";
    if (status === "all") {
      mobileStatusFilters.clear();
    } else if (mobileStatusFilters.has(status)) {
      mobileStatusFilters.delete(status);
    } else {
      mobileStatusFilters.add(status);
    }

    updateMobileStatusStripUI();
    applyFilters();
  });
}

function updateMobileStatusStripUI() {
  const strip = document.getElementById("mobileStatusStrip");
  if (!strip) return;

  strip.querySelectorAll("[data-mobile-status]").forEach(btn => {
    const status = btn.dataset.mobileStatus || "all";
    const isAll = status === "all";
    const isActive = isAll ? mobileStatusFilters.size === 0 : mobileStatusFilters.has(status);
    btn.classList.toggle("active", isActive);
  });
}

function updateClientsSummary(data) {
  const summary = document.getElementById("clientsSummary");
  if (!summary) return;

  const countByStatus = {
    "подключен": 0,
    "отключен": 0,
    "идет подключение": 0
  };

  data.forEach(c => {
    const s = clean(c.status);
    if (countByStatus[s] !== undefined) countByStatus[s] += 1;
  });

  const total = Object.values(countByStatus).reduce((sum, value) => sum + value, 0);
  summary.innerHTML = `
    <div class="summary-card summary-total">
      <span class="summary-label">Всего</span>
      <span class="summary-value">${total}</span>
    </div>
    <div class="summary-card summary-online">
      <span class="summary-label">Подключен</span>
      <span class="summary-value">${countByStatus["подключен"]}</span>
    </div>
    <div class="summary-card summary-offline">
      <span class="summary-label">Отключен</span>
      <span class="summary-value">${countByStatus["отключен"]}</span>
    </div>
    <div class="summary-card summary-pending">
      <span class="summary-label">Идет подключение</span>
      <span class="summary-value">${countByStatus["идет подключение"]}</span>
    </div>
  `;
}

/* =========================
   🎨 ПРОВАЙДЕРЫ
========================= */
function assignColors(data) {
  [...new Set(data.map(c => c.provider).filter(Boolean))]
    .forEach((p, i) => providerColors[p] = palette[i % palette.length]);
}

function populateFilters(data) {
  const prov = new Set(), stat = new Set();

  data.forEach(c => {
    if (c.provider) prov.add(c.provider);
    if (c.status) stat.add(c.status);
  });

  fill("searchProvider", prov);
  fill("searchStatus", stat);
}

function fill(id, values) {
  const el = document.getElementById(id);
  if (!el) return;

  values.forEach(v => {
    const o = document.createElement("option");
    o.value = v.toLowerCase();
    o.textContent = v;
    el.appendChild(o);
  });
}

// --- Мобильные улучшения ---
// FAB и bottom-sheet
function openAddClientSheet() {
  openBottomSheet({name: '', address: '', provider: '', status: '', lat: '', lng: '', isNew: true});
}

function openBottomSheet(c) {
  const sheet = document.getElementById('bottomSheet');
  const content = document.getElementById('bottomSheetContent');
  if (!sheet || !content) return;
  if (c.isNew) {
    content.innerHTML = `
      <h3>Добавить клиента</h3>
      <input id='addName' placeholder='Имя' />
      <input id='addAddress' placeholder='Адрес' />
      <input id='addProvider' placeholder='Провайдер' />
      <input id='addStatus' placeholder='Статус' />
      <input id='addLat' placeholder='Широта' />
      <input id='addLng' placeholder='Долгота' />
      <button onclick='saveNewClient()'>Сохранить</button>
    `;
  } else {
    const lat = parseFloat((c.lat + "").replace(',', '.'));
    const lng = parseFloat((c.lng + "").replace(',', '.'));
    const providers = (!isNaN(lat) && !isNaN(lng)) ? findNearestProviders(lat, lng) : [];
    const providerRows = providers.map((p, i) => `<li>${i + 1}. ${p.provider} (~${p.distance.toFixed(2)} км)</li>`).join("");

    content.innerHTML = `
      <h3>${c.name}</h3>
      <p><b>Адрес:</b> ${c.address}</p>
      <p><b>Провайдер:</b> ${c.provider}</p>
      <p><b>Статус:</b> ${c.status}</p>
      <p><b>Координаты:</b> ${c.lat}, ${c.lng}</p>
      <button class="sheet-map-btn" id="sheetShowOnMapBtn">Показать на карте</button>
      <div><b>Ближайшие провайдеры:</b></div>
      <ul>${providerRows || "<li>Нет данных</li>"}</ul>
    `;

    const showBtn = document.getElementById("sheetShowOnMapBtn");
    if (showBtn) {
      showBtn.onclick = function () {
        showClientOnMap(c);
      };
    }
  }
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('panel-open');
}

function closeBottomSheet() {
  const sheet = document.getElementById('bottomSheet');
  if (!sheet) return;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('panel-open');
}

function saveNewClient() {
  // Здесь можно реализовать сохранение нового клиента (например, отправку на сервер)
  closeBottomSheet();
  alert('Клиент добавлен (демо)');
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeBottomSheet();
});

let sheetTouchStartY = 0;
let sheetTouchCurrentY = 0;

function enableBottomSheetSwipeClose() {
  const card = document.querySelector('.bottom-sheet-card');
  if (!card) return;

  card.addEventListener('touchstart', function (e) {
    sheetTouchStartY = e.touches[0].clientY;
    sheetTouchCurrentY = sheetTouchStartY;
    card.style.transition = 'none';
  }, { passive: true });

  card.addEventListener('touchmove', function (e) {
    sheetTouchCurrentY = e.touches[0].clientY;
    const diff = Math.max(0, sheetTouchCurrentY - sheetTouchStartY);
    card.style.transform = `translateY(${diff}px)`;
  }, { passive: true });

  card.addEventListener('touchend', function () {
    const diff = Math.max(0, sheetTouchCurrentY - sheetTouchStartY);
    card.style.transition = '';
    card.style.transform = '';
    if (diff > 90) closeBottomSheet();
  });
}

// Автоскролл к найденному клиенту и быстрый сброс поиска
if (document.getElementById('mobileSearch')) {
  document.getElementById('mobileSearch').addEventListener('input', function() {
    filterClients(true);
  });
}

// Pull-to-refresh (только мобильные)
let touchStartY = 0, touchEndY = 0;
let touchStartX = 0, touchEndX = 0;
let isMultiTouchGesture = false;
let touchStartTarget = null;
document.addEventListener('touchstart', function(e) {
  if (window.innerWidth > 768) return;
  touchStartTarget = e.target;
  if (e.touches.length !== 1) {
    isMultiTouchGesture = true;
    return;
  }
  isMultiTouchGesture = false;
  touchStartY = e.touches[0].clientY;
  touchStartX = e.touches[0].clientX;
});
document.addEventListener('touchmove', function(e) {
  if (window.innerWidth > 768) return;
  if (e.touches.length > 1) {
    isMultiTouchGesture = true;
  }
});
document.addEventListener('touchend', function(e) {
  if (window.innerWidth > 768) return;
  if (isMultiTouchGesture || !e.changedTouches.length) {
    if (!e.touches.length) isMultiTouchGesture = false;
    return;
  }

  touchEndY = e.changedTouches[0].clientY;
  touchEndX = e.changedTouches[0].clientX;

  const dx = touchEndX - touchStartX;
  const dy = Math.abs(touchEndY - touchStartY);
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const inLeftEdge = touchStartX < 26;
  const inRightEdge = touchStartX > (window.innerWidth - 26);
  const startedOnMap = Boolean(
    touchStartTarget &&
    typeof touchStartTarget.closest === 'function' &&
    touchStartTarget.closest('#map')
  );

  if (dy < 50 && dx > 60 && inLeftEdge && leftPanel && !leftPanel.classList.contains('open')) {
    toggleLeftPanel();
    return;
  }

  if (dy < 50 && dx < -60 && inRightEdge && rightPanel && !rightPanel.classList.contains('open')) {
    toggleRightPanel();
    return;
  }

  if (startedOnMap) return;

  if (touchEndY - touchStartY > 80 && window.scrollY === 0) {
    // Обновить данные
    document.body.style.overflow = 'hidden';
    setTimeout(() => { location.reload(); }, 350);
  }
});

// Модифицируем populateClients для открытия bottom-sheet по клику
const origPopulateClients = window.populateClients;
window.populateClients = function() {
  const container = document.getElementById('clientsContainer');
  if (!container) return;
  container.innerHTML = '';
  const mobileQuery = document.getElementById("mobileSearch")?.value || "";
  const filteredClients = getFilteredData()
    .filter(c => allowedMobileClientStatuses.has(clean(c.status)))
    .filter(c => clean(c.status) !== "есть возможность подключения")
  updateClientsSummary(filteredClients);

  filteredClients.forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'client-card';
    div.innerHTML = `
      <h4>${highlightText(c.name, mobileQuery)}</h4>
      <p>📍 ${highlightText(c.address || 'Адрес не указан', mobileQuery)}</p>
      <p>📡 ${highlightText(c.provider || 'Провайдер не указан', mobileQuery)}</p>
      <p>📶 <span style="color:${statusColors[clean(c.status)] || '#999'}">${c.status}</span></p>
    `;
    div.onclick = () => {
      hideMobileKeyboard();
      openBottomSheet(c);
    };
    div.setAttribute('data-idx', idx);
    container.appendChild(div);
    });
};
window.showClientOnMap = showClientOnMap;
enableBottomSheetSwipeClose();
// --- Конец мобильных улучшений ---

/* =========================
   🧩 UI HELPERS
========================= */
function toggleLeftPanel() {
  const el = document.getElementById("leftPanel");
  const right = document.getElementById("rightPanel");
  if (!el) return;

  const willOpen = !el.classList.contains("open");
  el.classList.toggle("open", willOpen);
  if (right) right.classList.remove("open");
  document.body.classList.toggle("panel-open", willOpen);
}

function toggleRightPanel() {
  const el = document.getElementById("rightPanel");
  const left = document.getElementById("leftPanel");
  if (!el) return;

  const willOpen = !el.classList.contains("open");
  el.classList.toggle("open", willOpen);
  if (left) left.classList.remove("open");
  document.body.classList.toggle("panel-open", willOpen);
}

function setTab(tab) {
  const mapEl = document.getElementById("map");
  const clientsEl = document.getElementById("clientsTab");
  const leftPanel = document.getElementById("leftPanel");
  const rightPanel = document.getElementById("rightPanel");

  if (!mapEl || !clientsEl) return;
  document.body.setAttribute("data-tab", tab);

  mapEl.style.display = tab === "map" ? "block" : "none";
  clientsEl.style.display = tab === "clients" ? "block" : "none";

  const tabMap = document.getElementById("tabMap");
  const tabClients = document.getElementById("tabClients");
  if (tabMap) tabMap.classList.toggle("active", tab === "map");
  if (tabClients) tabClients.classList.toggle("active", tab === "clients");

  if (window.innerWidth <= 768) {
    if (leftPanel) leftPanel.classList.remove("open");
    if (rightPanel) rightPanel.classList.remove("open");
    document.body.classList.remove("panel-open");
  }

  if (tab === "clients" && typeof window.populateClients === "function") {
    window.populateClients();
  }

  if (tab === "map") {
    setTimeout(() => map.invalidateSize(), 80);
  }
}

function filterClients(scrollToFirst = false) {
  pendingMobileScrollToFirst = pendingMobileScrollToFirst || scrollToFirst;
  clearTimeout(mobileSearchDebounceTimer);
  mobileSearchDebounceTimer = setTimeout(runMobileFilterClients, 180);
}

function runMobileFilterClients() {
  const input = document.getElementById("mobileSearch");
  if (!input) return;
  const query = input.value.trim();
  const hint = document.getElementById("mobileSearchHint");
  const cards = document.querySelectorAll(".client-card");

  if (!query) {
    if (hint) {
      hint.textContent = "";
      hint.style.display = "none";
      hint.onclick = null;
    }
    cards.forEach(card => {
      card.style.display = "block";
    });
    pendingMobileScrollToFirst = false;
    return;
  }

  const filteredClients = getFilteredData()
    .filter(c => allowedMobileClientStatuses.has(clean(c.status)))
    .filter(c => clean(c.status) !== "есть возможность подключения");
  const result = searchClients(query, filteredClients);
  const matchedClients = result.items;

  if (hint) {
    if (result.suggestion && normalizeSearchText(query) !== result.suggestion.text) {
      hint.innerHTML = `Возможно, вы имели в виду: <button type="button" class="search-hint-action">${result.suggestion.text}</button>`;
      hint.style.display = "block";
      hint.onclick = function (event) {
        const action = event.target.closest(".search-hint-action");
        if (!action || !input) return;
        input.value = result.suggestion.text;
        filterClients(true);
      };
    } else {
      hint.textContent = "";
      hint.style.display = "none";
      hint.onclick = null;
    }
  }

  const visibleKeys = new Set(
    matchedClients.map(client => {
      const lat = parseFloat((client.lat + "").replace(',', '.'));
      const lng = parseFloat((client.lng + "").replace(',', '.'));
      if (!isNaN(lat) && !isNaN(lng)) return getClientKey(lat, lng);
      return `${clean(client.name)}|${clean(client.address)}|${clean(client.provider)}`;
    })
  );

  cards.forEach(card => {
    const idx = Number(card.getAttribute("data-idx"));
    const client = filteredClients[idx];
    if (!client) {
      card.style.display = "none";
      return;
    }

    const lat = parseFloat((client.lat + "").replace(',', '.'));
    const lng = parseFloat((client.lng + "").replace(',', '.'));
    const key = !isNaN(lat) && !isNaN(lng)
      ? getClientKey(lat, lng)
      : `${clean(client.name)}|${clean(client.address)}|${clean(client.provider)}`;

    card.style.display = visibleKeys.has(key) ? "block" : "none";
  });

  if (pendingMobileScrollToFirst) {
    const firstMatch = [...document.querySelectorAll('.client-card')]
      .find(card => card.style.display !== 'none');
    if (firstMatch) {
      firstMatch.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }
  pendingMobileScrollToFirst = false;
}

function toggleRightStats() {
  const block = document.getElementById("rightStats");
  const btn = document.getElementById("toggleRightStatsBtn");
  if (!block || !btn) return;
  const isOpen = block.style.display !== "none";
  block.style.display = isOpen ? "none" : "block";
  btn.textContent = isOpen ? "📊 Показать статистику" : "🔽 Скрыть статистику";
}

function resetFilters() {
  const provider = document.getElementById("searchProvider");
  const status = document.getElementById("searchStatus");
  if (provider) provider.value = "";
  if (status) [...status.options].forEach(o => (o.selected = false));
  mobileStatusFilters.clear();
  updateMobileStatusStripUI();
  updateAll(allData);
  if (document.body.getAttribute("data-tab") === "clients" && typeof window.populateClients === "function") {
    window.populateClients();
  }
}

function resetAll() {
  const client = document.getElementById("searchClient");
  const list = document.getElementById("clientList");
  const addr = document.getElementById("newAddress");
  const provider = document.getElementById("searchProvider");
  const status = document.getElementById("searchStatus");
  if (client) client.value = "";
  if (list) list.innerHTML = "";
  if (addr) addr.value = "";
  if (provider) provider.value = "";
  if (status) [...status.options].forEach(o => (o.selected = false));
  mobileStatusFilters.clear();
  updateMobileStatusStripUI();
  if (searchMarker) {
    map.removeLayer(searchMarker);
    searchMarker = null;
  }
  updateAll(allData);
  map.flyTo(defaultView, defaultZoom);
}

function findAddress() {
  const input = document.getElementById("newAddress");
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;
  updateAddressSearchHint(value, "", "exact");

  const match = value.match(/^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[3]);
    if (searchMarker) map.removeLayer(searchMarker);

    const providers = findNearestProviders(lat, lon);
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
      .then(r => r.json())
      .then(d => {
        const address = d.display_name || "Адрес не найден";
        let html = `<b>📍 Координаты</b><br>${lat}, ${lon}<br><br><b>🏠 Адрес:</b><br>${address}<br><br>`;
        providers.forEach((p, i) => {
          html += `${i + 1}. 📡 <b>${p.provider}</b><br>📏 ~${p.distance.toFixed(2)} км<br><br>`;
        });
        map.flyTo([lat, lon], 15, { duration: 1.5 });
        searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(html).openPopup();
      });
    return;
  }

  const queryVariants = buildAddressQueryVariants(value);

  (async function () {
    let found = null;
    let usedQuery = value;
    let usedReason = "exact";

    for (const variant of queryVariants) {
      const response = await fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(variant.value));
      const data = await response.json();
      if (data && data.length) {
        found = data;
        usedQuery = variant.value;
        usedReason = variant.reason;
        break;
      }
    }

    if (!found || !found.length) {
      updateAddressSearchHint(value, "", "exact");
      alert("Не найдено");
      return;
    }

    updateAddressSearchHint(value, usedQuery, usedReason);

    if (searchMarker) map.removeLayer(searchMarker);
    const lat = parseFloat(found[0].lat);
    const lon = parseFloat(found[0].lon);
    const providers = findNearestProviders(lat, lon);

    let html = `<b>📍 Адрес</b><br>${usedQuery}<br><br><b>📌 Координаты:</b><br>${lat}, ${lon}<br><br>`;
    if (usedQuery !== value) {
      html += `<b>⌨️ Исправлена раскладка:</b><br>${value} → ${usedQuery}<br><br>`;
    }
    providers.forEach((p, i) => {
      html += `${i + 1}. 📡 <b>${p.provider}</b><br>📏 ~${p.distance.toFixed(2)} км<br><br>`;
    });

    map.flyTo([lat, lon], 15, { duration: 1.5 });
    searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(html).openPopup();
  })().catch(() => {
    alert("Не найдено");
  });
}

function closeClientModal() {
  const modal = document.getElementById("clientModal");
  if (modal) modal.classList.remove("open");
}

/* =========================
   🖱️ ДОП. ДЕСКТОП-ЛОГИКА
========================= */
map.on("click", function (e) {
  if (consumeMobileDismissTap()) return;

  const lat = e.latlng.lat;
  const lon = e.latlng.lng;
  if (searchMarker) map.removeLayer(searchMarker);

  fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`)
    .then(r => r.json())
    .then(res => {
      const address = res.display_name || "Адрес не найден";
      const providers = findNearestProviders(lat, lon);
      let html = `<b>📍 Выбранная точка</b><br><br>🧭 <b>Координаты:</b><br>${lat.toFixed(6)}, ${lon.toFixed(6)}<br><br>🏠 <b>Адрес:</b><br>${address}<br><br><b>📡 Ближайшие провайдеры:</b><br><br>`;
      providers.forEach((p, i) => {
        html += `${i + 1}. 📡 <b>${p.provider}</b><br>📏 ~${p.distance.toFixed(2)} км<br><br>`;
      });
      searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(html).openPopup();
    });
});

const statusSelect = document.getElementById("searchStatus");
if (statusSelect) {
  statusSelect.addEventListener("mousedown", function (e) {
    e.preventDefault();
    if (e.target.tagName !== "OPTION") return;
    e.target.selected = !e.target.selected;
    applyFilters();
  });
}

bindMobileStatusStrip();
updateMobileStatusStripUI();

/* =========================
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
  const v = clean(document.getElementById("searchClient").value);
  const list = document.getElementById("clientList");

  list.innerHTML = "";
  if (!v) return;

  allData.filter(c =>
    clean(c.name).includes(v) ||
    clean(c.address).includes(v)
  ).slice(0, 10)
    .forEach(c => {
      const d = document.createElement("div");
      d.className = "suggestion";
      d.innerHTML = `<b>${c.name}</b><br><small>${c.address}</small>`;
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
  document.getElementById('mobileSearch').addEventListener('input', function(e) {
    const query = this.value.trim().toLowerCase();
    const cards = document.querySelectorAll('.client-card');
    let firstMatch = null;
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      const match = text.includes(query);
      card.style.display = match ? 'block' : 'none';
      if (match && !firstMatch) firstMatch = card;
    });
    if (firstMatch) firstMatch.scrollIntoView({behavior: 'smooth', block: 'center'});
    if (!query) cards.forEach(card => card.style.display = 'block');
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
  const filteredClients = getFilteredData()
    .filter(c => allowedMobileClientStatuses.has(clean(c.status)))
    .filter(c => clean(c.status) !== "есть возможность подключения")
  updateClientsSummary(filteredClients);

  filteredClients.forEach((c, idx) => {
    const div = document.createElement('div');
    div.className = 'client-card';
    div.innerHTML = `
      <h4>${c.name}</h4>
      <p>📍 ${c.address || 'Адрес не указан'}</p>
      <p>📡 ${c.provider || 'Провайдер не указан'}</p>
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

function filterClients() {
  const input = document.getElementById("mobileSearch");
  if (!input) return;
  const query = clean(input.value);
  const cards = document.querySelectorAll(".client-card");
  cards.forEach(card => {
    const text = clean(card.textContent || "");
    card.style.display = text.includes(query) ? "block" : "none";
  });
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

  fetch("https://nominatim.openstreetmap.org/search?format=json&q=" + encodeURIComponent(value))
    .then(r => r.json())
    .then(d => {
      if (!d || !d.length) {
        alert("Не найдено");
        return;
      }
      if (searchMarker) map.removeLayer(searchMarker);
      const lat = parseFloat(d[0].lat);
      const lon = parseFloat(d[0].lon);
      const providers = findNearestProviders(lat, lon);

      let html = `<b>📍 Адрес</b><br>${value}<br><br><b>📌 Координаты:</b><br>${lat}, ${lon}<br><br>`;
      providers.forEach((p, i) => {
        html += `${i + 1}. 📡 <b>${p.provider}</b><br>📏 ~${p.distance.toFixed(2)} км<br><br>`;
      });

      map.flyTo([lat, lon], 15, { duration: 1.5 });
      searchMarker = L.marker([lat, lon]).addTo(map).bindPopup(html).openPopup();
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

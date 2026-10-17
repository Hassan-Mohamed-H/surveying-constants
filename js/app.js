// ===============================
// Map
// ===============================

import {
  initMap,
  getMap,
  setMarkers,
  focusPoint,
  convertSurveyPoint,
  resetExtent,
  setBaseLayer,
  getActiveBaseLayer,
  locateUser,
  setMeasureMode,
  clearMeasurement,
  startRoutingToPoint,
  clearRoute,
  findNearestSite,
  exportToGeoJson,
  downloadGeoJson,
  renderImportedGeoJson,
  openSidePanel,
  closeSidePanel
} from "./map.js";

import {
  getFilterOptions,
  filterSurveyPoints
} from "./filters.js";

import { getTypeColor, getStatusColor } from "./colors.js";

// ===============================
// Data
// ===============================

import {
  loadGoogleSheetData
} from "./excelHandler.js";

// ===============================
// State
// ===============================

import {
  createAppState,
  setData,
  updateFilteredData
} from "./state.js";

// ===============================
// UI
// ===============================

import {
  uiEls,
  showLoading,
  updateCounts,
  updateNearest,
  notify,
  bindSidebarToggle,
  bindThemeToggle,
  showSuggestions,
  hideSuggestions
} from "./ui.js";

// ===============================
// App State
// ===============================

const state = createAppState();

// ===============================
// Google Sheet URL
// ===============================

const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vStDVHGSJAJpWTlbNpIkBJopW23dmW-bSlEGExa7uARfSFsTUTZuVz3RFQJUKC-ZEBQNvU4vi__P9xB/pub?gid=0&single=true&output=csv";

// ===============================
// Variables
// ===============================

let currentMapData = [];
let baseMapData = [];
let temporaryPoints = [];

let filteredMapData = [];

const selectedFilters = {
  types: [],
  statuses: [],
  crsList: []
};

let lastDataSignature = "";

let refreshTimer = null;

let typeChartInstance = null;
let statusChartInstance = null;

const REFRESH_INTERVAL = 30000;

// ===============================
// Data Signature
// ===============================

function createDataSignature(data) {
  if (!Array.isArray(data)) {
    return "";
  }

  return JSON.stringify(
    data.map((item) => [
      item.name,
      item.code,
      item.northing,
      item.easting,
      item.elevation,
      item.description,
      item.type,
      item.status,
      item.crs
    ])
  );
}


// ===============================
// renderSurveyFilters
// ===============================
function renderSurveyFilters() {
  const container = uiEls.categoryFilters;
  if (!container) return;

  const options = getFilterOptions(currentMapData);

  container.innerHTML = `
    <section class="panel-section">
      <h3>فلترة النقاط المساحية</h3>

      <label class="filter-item" for="filterType">
        النوع
      </label>
      <select id="filterType" class="survey-filter">
        <option value="">كل الأنواع</option>
        ${options.types.map(value =>
          `<option value="${value}">${value}</option>`
        ).join("")}
      </select>

      <label class="filter-item" for="filterStatus">
        الحالة
      </label>
      <select id="filterStatus" class="survey-filter">
        <option value="">كل الحالات</option>
        ${options.statuses.map(value =>
          `<option value="${value}">${value}</option>`
        ).join("")}
      </select>

      <label class="filter-item" for="filterCRS">
        نظام الإحداثيات
      </label>
      <select id="filterCRS" class="survey-filter">
        <option value="">كل الأنظمة</option>
        ${options.crsList.map(value =>
          `<option value="${value}">${value}</option>`
        ).join("")}
      </select>

      <button id="resetSurveyFilters" type="button"
        class="search-btn secondary">
        مسح الفلاتر
      </button>
    </section>
  `;

  const applyFilters = () => {
    selectedFilters.types = [
      document.getElementById("filterType").value
    ].filter(Boolean);

    selectedFilters.statuses = [
      document.getElementById("filterStatus").value
    ].filter(Boolean);

    selectedFilters.crsList = [
      document.getElementById("filterCRS").value
    ].filter(Boolean);

    filteredMapData = filterSurveyPoints(
      currentMapData,
      selectedFilters
    );

    refreshMap();
  };

  ["filterType", "filterStatus", "filterCRS"].forEach(id => {
    document.getElementById(id)
      .addEventListener("change", applyFilters);
  });

  document.getElementById("resetSurveyFilters")
    .addEventListener("click", () => {
      document.getElementById("filterType").value = "";
      document.getElementById("filterStatus").value = "";
      document.getElementById("filterCRS").value = "";

      selectedFilters.types = [];
      selectedFilters.statuses = [];
      selectedFilters.crsList = [];

      filteredMapData = [...currentMapData];
      refreshMap();
    });
}


// ===============================
// renderSurveyCharts
// ===============================

function renderSurveyCharts(items = []) {
  const typeContainer = document.getElementById("typeSummaryList");
  const statusContainer = document.getElementById("statusSummaryList");

  if (!typeContainer || !statusContainer) return;

  const countBy = (field) => items.reduce((counts, item) => {
    const key = String(item[field] ?? "").trim() || "غير محدد";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});

  const typeCounts = countBy("type");
  const statusCounts = countBy("status");

  const renderList = (container, counts, colorFor) => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      container.innerHTML = '<p class="summary-empty">لا توجد نقاط لعرضها.</p>';
      return;
    }

    container.innerHTML = entries.map(([label, count]) => {
      const safeLabel = String(label).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char]));
      const color = colorFor(label);
      return `
        <div class="summary-row">
          <span class="summary-label">
            <span class="summary-dot" style="--summary-color:${color}" aria-hidden="true"></span>
            <span class="summary-name" title="${safeLabel}">${safeLabel}</span>
          </span>
          <strong class="summary-count">${count}</strong>
        </div>`;
    }).join("");
  };

  renderList(typeContainer, typeCounts, getTypeColor);
  renderList(statusContainer, statusCounts, getStatusColor);
} 


// ===============================
// Refresh Map
// ===============================

async function refreshMap() {
  try {
    showLoading(true);

    const preparedData =
      await setMarkers(
        filteredMapData
      );

    updateCounts(
      preparedData.length,
      currentMapData.length
    );
    renderSurveyCharts(filteredMapData);

    updateNearest(
      "-",
      "-"
    );

    console.log(
      `تم عرض ${preparedData.length} نقطة من أصل ${currentMapData.length}`
    );

  } catch (error) {
    console.error(
      "Map refresh error:",
      error
    );

    notify(
      "حدث خطأ أثناء عرض النقاط.",
      true
    );

  } finally {
    showLoading(false);
  }
}

// ===============================
// Load Data
// ===============================

async function loadData(
  showMessage = true
) {
  try {
    if (showMessage) {
      showLoading(true);
    }

    const loaded =
      await loadGoogleSheetData(
        GOOGLE_SHEET_URL
      );

    if (
      !Array.isArray(loaded) ||
      !loaded.length
    ) {
      baseMapData = [];
      currentMapData = [...temporaryPoints];
      filteredMapData = [...currentMapData];

      setData(state, currentMapData);
      updateFilteredData(state, filteredMapData);
      renderSurveyFilters();

      updateCounts(0, currentMapData.length);
      if (currentMapData.length) await refreshMap();

      if (showMessage) {
        notify(
          "لم يتم العثور على نقاط صالحة في Google Sheet.",
          true
        );
      }

      return;
    }

    const signature =
      createDataSignature(
        loaded
      );

    // لو البيانات لم تتغير
    if (
      signature ===
      lastDataSignature
    ) {
      return;
    }

    lastDataSignature =
      signature;

    baseMapData = loaded;
    currentMapData = [...baseMapData, ...temporaryPoints];

    filteredMapData = [...currentMapData];
    renderSurveyFilters();  

    // حفظ البيانات في الـstate
    setData(
      state,
      currentMapData
    );

    updateFilteredData(
      state,
      [...filteredMapData]
    );

    // عرض النقاط
    await refreshMap();

    if (showMessage) {
      notify(
        `تم تحميل ${loaded.length} نقطة مساحية.`
      );
    }

  } catch (error) {
    console.error(
      "Data loading error:",
      error
    );

    notify(
      error.message ||
        "حدث خطأ أثناء تحميل البيانات.",
      true,
      6000
    );

  } finally {
    if (showMessage) {
      showLoading(false);
    }
  }
}

// ===============================
// Automatic Refresh
// ===============================

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(
      refreshTimer
    );
  }

  refreshTimer =
    setInterval(
      async () => {
        await loadData(false);
      },
      REFRESH_INTERVAL
    );
}

// ===============================
// Search
// ===============================

function getSearchResults(
  query
) {
  const value =
    String(query || "")
      .trim()
      .toLowerCase();

  if (!value) {
    return [];
  }

  return currentMapData
    .filter((item) => {
      const searchable = [
        item.name,
        item.code,
        item.description,
        item.type,
        item.status,
        item.crs,
        item.northing,
        item.easting,
        item.elevation
      ]
        .filter(
          (value) =>
            value !== null &&
            value !== undefined
        )
        .join(" ")
        .toLowerCase();

      return searchable.includes(
        value
      );
    })
    .slice(0, 10);
}

// ===============================
// Bind Search
// ===============================

function bindSearch() {
  if (
    !uiEls.searchInput ||
    !uiEls.searchBtn
  ) {
    return;
  }

  const showSearchSuggestions =
    () => {
      const results =
        getSearchResults(
          uiEls.searchInput.value
        );

      if (
        !results.length
      ) {
        hideSuggestions();
        return;
      }

      showSuggestions(
        results.map(
          (item) => ({
            ...item,

            // للحفاظ على توافق
            // ui.js القديم
            category:
              item.type ||
              "نقطة مساحية"
          })
        ),
        async (item) => {
          uiEls.searchInput.value =
            item.name || item.code || "";

          hideSuggestions();

          try {
            const mapPoint = await convertSurveyPoint(item);

            if (!mapPoint) {
              notify("تعذر تحويل إحداثيات النقطة.", true);
              return;
            }

            openSidePanel(mapPoint);
            await focusPoint(mapPoint);
          } catch (error) {
            console.error("Search suggestion error:", error);
            notify("حدث خطأ أثناء تحديد النقطة.", true);
          }
        }
      );
    };

  const runSearch =
    async () => {
      hideSuggestions();

      const query =
        (
          uiEls.searchInput
            .value || ""
        ).trim();

      if (!query) {
        notify(
          "اكتب اسم النقطة أو الكود أو أي معلومة للبحث.",
          true
        );

        return;
      }

      const results =
        getSearchResults(
          query
        );

      if (!results.length) {
        notify(
          "لا توجد نتائج مطابقة للبحث.",
          true
        );

        return;
      }

      const item = results[0];

      try {
        const mapPoint = await convertSurveyPoint(item);

        if (!mapPoint) {
          notify("تعذر تحويل إحداثيات النقطة.", true);
          return;
        }

        openSidePanel(mapPoint);
        await focusPoint(mapPoint);

        notify(
          `تم العثور على: ${
            item.name || item.code || "النقطة"
          }`
        );
      } catch (error) {
        console.error("Search error:", error);
        notify("حدث خطأ أثناء تحديد النقطة.", true);
      }
    };

  uiEls.searchBtn.addEventListener(
    "click",
    runSearch
  );

  uiEls.searchInput.addEventListener(
    "keydown",
    (event) => {
      if (
        event.key ===
        "Enter"
      ) {
        runSearch();
      }
    }
  );

  uiEls.searchInput.addEventListener(
    "input",
    showSearchSuggestions
  );

  document.addEventListener(
    "click",
    (event) => {
      if (
        !uiEls.searchSuggestions
      ) {
        return;
      }

      if (
        !uiEls.searchSuggestions.contains(
          event.target
        ) &&
        event.target !==
          uiEls.searchInput
      ) {
        hideSuggestions();
      }
    }
  );
}

// ===============================
// Map Controls
// ===============================

function bindMapControls() {
  // Zoom In
  if (uiEls.zoomInBtn) {
    uiEls.zoomInBtn.addEventListener(
      "click",
      () => {
        const map =
          getMap();

        if (!map) return;

        map.zoomIn();
      }
    );
  }

  // Zoom Out
  if (uiEls.zoomOutBtn) {
    uiEls.zoomOutBtn.addEventListener(
      "click",
      () => {
        const map =
          getMap();

        if (!map) return;

        map.zoomOut();
      }
    );
  }

  // Reset Extent
  if (uiEls.resetBtn) {
    uiEls.resetBtn.addEventListener(
      "click",
      async () => {
        await resetExtent(
          currentMapData
        );
      }
    );
  }

  // Basemap
  if (uiEls.basemapBtn) {
    uiEls.basemapBtn.addEventListener(
      "click",
      () => {
        const current =
          getActiveBaseLayer();

        let next;

        if (
          current === "light"
        ) {
          next = "dark";
        } else if (
          current === "dark"
        ) {
          next =
            "satellite";
        } else {
          next = "light";
        }

        setBaseLayer(
          next
        );

        const messages = {
          light:
            "تم تفعيل الخريطة الفاتحة.",
          dark:
            "تم تفعيل الخريطة الداكنة.",
          satellite:
            "تم تفعيل الخريطة الفضائية."
        };

        notify(
          messages[next]
        );
      }
    );
  }

  // User Location
  if (uiEls.locateBtn) {
    uiEls.locateBtn.addEventListener(
      "click",
      () => {
        const isActive = uiEls.locateBtn.classList.toggle("active");

        if (isActive) {
          locateUser();
        }
      }
    );
  }

  // Measurement
  if (uiEls.measureBtn) {
    uiEls.measureBtn.addEventListener(
      "click",
      () => {
        const isActive =
          uiEls.measureBtn.classList.toggle(
            "active"
          );

        setMeasureMode(
          isActive
        );
        uiEls.measureBtn.setAttribute("aria-pressed", String(isActive));

        if (isActive) {
          notify(
            "تم تفعيل أداة القياس. اضغط على الخريطة لإضافة النقاط."
          );
        } else {
          clearMeasurement();

          notify(
            "تم إيقاف أداة القياس."
          );
        }
      }
    );
  }

  // Routing
  if (uiEls.routingBtn) {
    uiEls.routingBtn.addEventListener(
      "click",
      () => {
        notify(
          "اضغط على نقطة مساحية من الخريطة ثم اختر إنشاء مسار."
        );
      }
    );
  }

  // Clear Route
  if (uiEls.clearRouteBtn) {
    uiEls.clearRouteBtn.addEventListener(
      "click",
      () => {
        clearRoute();

        if (
          uiEls.routingPanel
        ) {
          uiEls.routingPanel.classList.remove(
            "visible"
          );
        }

        notify(
          "تم مسح المسار."
        );
      }
    );
  }

  // Nearest Point
  
  
  let nearestLineVisible = false;

  if (uiEls.nearestBtn) {
    uiEls.nearestBtn.addEventListener("click", async () => {
      // لو الخط مرسوم، شيله
      if (nearestLineVisible) {
        clearRoute();
        nearestLineVisible = false;
        uiEls.nearestBtn.classList.remove("active");

        const nearestNameEl = document.getElementById("nearestName");
        const nearestDistanceEl = document.getElementById("nearestDistance");

        if (nearestNameEl) nearestNameEl.textContent = "-";
        if (nearestDistanceEl) nearestDistanceEl.textContent = "-";

        notify("تم إخفاء الخط.");
        return;
      }

      // لو الخط مش مرسوم، حدّد أقرب نقطة وارسمه
      try {
        const nearest = await findNearestSite(filteredMapData);

        if (!nearest) return;

        nearestLineVisible = true;
        uiEls.nearestBtn.classList.add("active");

        updateNearest(
          nearest.name || nearest.code || "نقطة مساحية",
          nearest.distanceText
        );

        notify(`المسافة إلى أقرب نقطة: ${nearest.distanceText}`);
      } catch (error) {
        console.error("Nearest point error:", error);
        notify("تعذر تحديد أقرب نقطة.", true);
      }
    });
  }


}

// ===============================
// Remove Old Heritage Controls
// ===============================

function disableOldHeritageControls() {
  // Heatmap لم يعد مستخدمًا
  if (
    uiEls.toggleHeatmap
  ) {
    const heatmapContainer =
      uiEls.toggleHeatmap.closest(
        "label"
      ) ||
      uiEls.toggleHeatmap.parentElement;

    if (heatmapContainer) {
      heatmapContainer.style.display =
        "none";
    }
  }

  // التراث المادي
  if (
    uiEls.toggleTangible
  ) {
    const container =
      uiEls.toggleTangible.closest(
        "label"
      ) ||
      uiEls.toggleTangible.parentElement;

    if (container) {
      container.style.display =
        "none";
    }
  }

  // التراث اللامادي
  if (
    uiEls.toggleIntangible
  ) {
    const container =
      uiEls.toggleIntangible.closest(
        "label"
      ) ||
      uiEls.toggleIntangible.parentElement;

    if (container) {
      container.style.display =
        "none";
    }
  }
}

// ===============================
// Import Points (session-only)
// ===============================
function closeImportDialog() {
  if (uiEls.importDialog) uiEls.importDialog.hidden = true;
}

function getSelectedImportCRS() {
  const system = document.getElementById("importSystem")?.value;
  if (system === "egypt") return `EPSG:${document.getElementById("egyptBelt").value}`;
  const zone = Number(document.getElementById("globalZone").value);
  const hemisphere = document.getElementById("globalHemisphere").value;
  return `EPSG:${(hemisphere === "south" ? 32700 : 32600) + zone}`;
}

function parsePnt(text, crs) {
  const points = [];
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;
    const cols = line.includes(",") ? line.split(",") : line.split(/\s+/);
    if (cols.length < 4) continue;
    const [number, eastRaw, northRaw, elevationRaw, ...codeParts] = cols.map(v => v.trim());
    const easting = Number(eastRaw), northing = Number(northRaw);
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      if (index === 0 && /point|easting|northing/i.test(line)) continue;
      continue;
    }
    const elevation = Number(elevationRaw);
    const code = codeParts.join(" ").trim();
    points.push({
      name: number || `PNT-${index + 1}`, code: code || number || `PNT-${index + 1}`,
      pointNumber: number, easting, northing,
      elevation: Number.isFinite(elevation) ? elevation : null,
      description: code, type: code || "نقطة مستوردة", status: "غير محدد", crs,
      source: "temporary-import", temporary: true
    });
  }
  if (!points.length) throw new Error("لم يتم العثور على نقاط PNT صالحة. تأكد من ترتيب الأعمدة والفواصل.");
  return points;
}

function parseGeoJSON(text) {
  const geojson = JSON.parse(text);
  const features = geojson.type === "FeatureCollection" ? geojson.features :
    geojson.type === "Feature" ? [geojson] : [];
  const points = [];
  for (const feature of features || []) {
    if (feature?.geometry?.type !== "Point") continue;
    const coords = feature.geometry.coordinates || [];
    const lng = Number(coords[0]), lat = Number(coords[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    const props = feature.properties || {};
    const name = String(props.name ?? props.Name ?? props.pointNumber ?? props.Point ?? props.id ?? `GeoJSON-${points.length + 1}`);
    points.push({
      ...props, name,
      code: String(props.code ?? props.Code ?? props.codePoint ?? name),
      easting: lng, northing: lat,
      elevation: Number.isFinite(Number(coords[2])) ? Number(coords[2]) : (Number.isFinite(Number(props.elevation ?? props.Elevation)) ? Number(props.elevation ?? props.Elevation) : null),
      description: String(props.description ?? props.Description ?? ""),
      type: String(props.type ?? props.Type ?? "نقطة مستوردة"),
      status: String(props.status ?? props.Status ?? "غير محدد"),
      crs: "EPSG:4326", source: "temporary-import", temporary: true
    });
  }
  if (!points.length) throw new Error("ملف GeoJSON لا يحتوي على نقاط Point صالحة.");
  return points;
}

async function applyTemporaryPoints(points) {
  temporaryPoints = [...temporaryPoints, ...points];
  currentMapData = [...baseMapData, ...temporaryPoints];
  filteredMapData = filterSurveyPoints(currentMapData, selectedFilters);
  setData(state, currentMapData);
  updateFilteredData(state, filteredMapData);
  renderSurveyFilters();
  await refreshMap();
  closeImportDialog();
  notify(`تم استيراد ${points.length} نقطة مؤقتة. ستختفي عند إغلاق الصفحة أو إعادة تحميلها.`);
}

function bindGeoJsonTools() {
  const dialog = document.getElementById("importDialog");
  const openBtn = uiEls.importGeoJsonBtn;
  const fileInput = document.getElementById("importFile");
  const systemSelect = document.getElementById("importSystem");
  const egyptWrap = document.getElementById("egyptBeltWrap");
  const globalWrap = document.getElementById("globalZoneWrap");
  const zoneSelect = document.getElementById("globalZone");
  if (zoneSelect && !zoneSelect.options.length) {
    for (let zone = 1; zone <= 60; zone++) {
      const option = document.createElement("option");
      option.value = String(zone);
      option.textContent = `Zone ${zone}`;
      if (zone === 36) option.selected = true;
      zoneSelect.appendChild(option);
    }
  }
  const updateSystemFields = () => {
    const egypt = systemSelect.value === "egypt";
    egyptWrap.hidden = !egypt;
    globalWrap.hidden = egypt;
  };
  systemSelect?.addEventListener("change", updateSystemFields);
  updateSystemFields();
  openBtn?.addEventListener("click", () => { if (dialog) dialog.hidden = false; });
  document.getElementById("closeImportDialog")?.addEventListener("click", closeImportDialog);
  document.getElementById("cancelImport")?.addEventListener("click", closeImportDialog);
  dialog?.addEventListener("click", event => { if (event.target === dialog) closeImportDialog(); });

  document.getElementById("importForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    const file = fileInput?.files?.[0];
    if (!file) { notify("اختر ملف النقاط أولًا.", true); return; }
    try {
      showLoading(true);
      // Detect the file format from its CONTENT first, not only its extension.
      // Some phones/WhatsApp transfers rename PNT files or remove the .pnt extension.
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const extension = file.name.split(".").pop().toLowerCase();
      const firstChar = text.trimStart().charAt(0);
      const looksLikeJSON = firstChar === "{" || firstChar === "[";
      let points;
      if (looksLikeJSON || extension === "json" || extension === "geojson") {
        try {
          points = parseGeoJSON(text);
        } catch (jsonError) {
          // If the extension is misleading but the contents are delimited survey rows,
          // fall back to the PNT parser and return its more relevant validation error.
          if (looksLikeJSON) throw jsonError;
          points = parsePnt(text, getSelectedImportCRS());
        }
      } else {
        points = parsePnt(text, getSelectedImportCRS());
      }
      await applyTemporaryPoints(points);
      fileInput.value = "";
    } catch (error) {
      console.error("Temporary import error:", error);
      notify(error.message || "فشل استيراد الملف.", true);
    } finally {
      showLoading(false);
    }
  });

  // Export base points only; temporary imports are intentionally excluded.
  uiEls.exportGeoJsonBtn?.addEventListener("click", async () => {
    try {
      await downloadGeoJson(baseMapData);
      notify("تم تصدير النقاط الأساسية بصيغة GeoJSON.");
    } catch (error) {
      console.error("GeoJSON export error:", error);
      notify("فشل تصدير GeoJSON.", true);
    }
  });
}

// ===============================
// Side Panel
// ===============================

function bindSidePanel() {
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target;

      if (
        target?.matches(
          "[data-close-panel]"
        )
      ) {
        closeSidePanel();
      }
    }
  );

  const closeButton =
    document.getElementById(
      "closePanelBtn"
    );

  if (closeButton) {
    closeButton.addEventListener(
      "click",
      () => {
        closeSidePanel();
      }
    );
  }
}

// ===============================
// Initial App
// ===============================

async function bootstrap() {
  try {
    // Initialize Map
    initMap();

    // UI
    bindSidebarToggle();
    bindThemeToggle();

    // Search
    bindSearch();

    // Map Controls
    bindMapControls();

    // GeoJSON
    bindGeoJsonTools();

    // Side Panel
    bindSidePanel();

    // Hide old heritage controls
    disableOldHeritageControls();

    // Load Google Sheet
    await loadData(
      true
    );

    // Automatic refresh every 30 seconds
    startAutoRefresh();

    console.log(
      "Survey Control Points application started successfully."
    );

  } catch (error) {
    console.error(
      "Application startup error:",
      error
    );

    notify(
      error.message ||
        "حدث خطأ أثناء تشغيل الموقع.",
      true,
      7000
    );

  } finally {
    showLoading(false);
  }
}

// ===============================
// Start
// ===============================
bootstrap();
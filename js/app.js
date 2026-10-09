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
  if (typeof Chart === "undefined") return;

  const typeCanvas = document.getElementById("pieChart");
  const statusCanvas = document.getElementById("barChart");

  if (!typeCanvas || !statusCanvas) return;

  // ألوان الرسوم
  const colors = [
    "#0F766E",
    "#2563EB",
    "#7C3AED",
    "#D97706",
    "#DB2777",
    "#0891B2",
    "#65A30D",
    "#EA580C"
  ];

  const dark = document.body.classList.contains("dark-mode");
  const textColor = dark ? "#E2E8F0" : "#334155";
  const mutedColor = dark ? "#94A3B8" : "#64748B";
  const gridColor = dark
    ? "rgba(148,163,184,0.14)"
    : "rgba(148,163,184,0.20)";

  const countBy = (field) =>
    items.reduce((counts, item) => {
      const key =
        String(item[field] ?? "").trim() || "غير محدد";

      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});

  const types = countBy("type");
  const statuses = countBy("status");

  if (typeChartInstance) typeChartInstance.destroy();
  if (statusChartInstance) statusChartInstance.destroy();

  // إعدادات الخطوط والتلميحات
  const commonPlugins = {
    legend: {
      labels: {
        color: textColor,
        usePointStyle: true,
        pointStyle: "circle",
        boxWidth: 8,
        padding: 14,
        font: {
          family: "Cairo, Segoe UI, sans-serif",
          size: 11,
          weight: "600"
        }
      }
    },
    title: {
      display: true,
      color: textColor,
      padding: { top: 8, bottom: 18 },
      font: {
        family: "Cairo, Segoe UI, sans-serif",
        size: 14,
        weight: "700"
      }
    },
    tooltip: {
      rtl: true,
      backgroundColor: dark ? "#0F172A" : "#FFFFFF",
      titleColor: textColor,
      bodyColor: textColor,
      borderColor: dark ? "#334155" : "#E2E8F0",
      borderWidth: 1,
      padding: 12,
      cornerRadius: 10,
      titleFont: { weight: "700" }
    }
  };

  // الرسم الدائري
  typeChartInstance = new Chart(typeCanvas, {
    type: "doughnut",
    data: {
      labels: Object.keys(types),
      datasets: [{
        label: "عدد النقاط",
        data: Object.values(types),
        backgroundColor: Object.keys(types).map(
          (_, i) => colors[i % colors.length]
        ),
        borderColor: dark ? "#1E293B" : "#FFFFFF",
        borderWidth: 3,
        hoverOffset: 7,
        spacing: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "68%",
      animation: { duration: 500 },
      plugins: {
        ...commonPlugins,
        legend: {
          ...commonPlugins.legend,
          position: "bottom"
        },
        title: {
          ...commonPlugins.title,
          text: "توزيع النقاط حسب النوع"
        }
      }
    }
  });

  // الرسم العمودي
  statusChartInstance = new Chart(statusCanvas, {
    type: "bar",
    data: {
      labels: Object.keys(statuses),
      datasets: [{
        label: "عدد النقاط",
        data: Object.values(statuses),
        backgroundColor: Object.keys(statuses).map(
          (_, i) => colors[i % colors.length]
        ),
        borderRadius: 7,
        borderSkipped: false,
        maxBarThickness: 42
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      plugins: {
        ...commonPlugins,
        legend: { display: false },
        title: {
          ...commonPlugins.title,
          text: "توزيع النقاط حسب الحالة"
        }
      },
      scales: {
        x: {
          ticks: {
            color: mutedColor,
            maxRotation: 0,
            font: {
              family: "Cairo, Segoe UI, sans-serif",
              size: 11
            }
          },
          grid: { display: false },
          border: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            color: mutedColor,
            padding: 8
          },
          grid: { color: gridColor },
          border: { display: false }
        }
      }
    }
  });
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
      currentMapData = [];

      setData(
        state,
        []
      );

      updateFilteredData(
        state,
        []
      );

      updateCounts(
        0,
        0
      );

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

    currentMapData =
      loaded;

    filteredMapData = [...currentMapData];
    renderSurveyFilters();  

    // حفظ البيانات في الـstate
    setData(
      state,
      loaded
    );

    updateFilteredData(
      state,
      [...loaded]
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
        locateUser();
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
  
  if (uiEls.nearestBtn) {
    uiEls.nearestBtn.addEventListener("click", async () => {
      try {
        const nearest = await findNearestSite(filteredMapData);

        if (!nearest) return;

        updateNearest(
          nearest.name || nearest.code || "نقطة مساحية",
          nearest.distanceText
        );

        notify(
          `أقرب نقطة: ${nearest.name || nearest.code || "نقطة مساحية"} — المسافة ${nearest.distanceText}`
        );
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
// GeoJSON Tools
// ===============================

function bindGeoJsonTools() {
  if (
    uiEls.importGeoJsonBtn &&
    uiEls.geoJsonInput
  ) {
    uiEls.importGeoJsonBtn.addEventListener(
      "click",
      () => {
        uiEls.geoJsonInput.click();
      }
    );

    uiEls.geoJsonInput.addEventListener(
      "change",
      async (event) => {
        const file =
          event.target.files?.[0];

        if (!file) {
          return;
        }

        try {
          const text =
            await file.text();

          const geojson =
            JSON.parse(text);

          renderImportedGeoJson(
            geojson
          );

          notify(
            "تم استيراد ملف GeoJSON بنجاح."
          );

        } catch (error) {
          console.error(
            "GeoJSON import error:",
            error
          );

          notify(
            "فشل استيراد ملف GeoJSON.",
            true
          );

        } finally {
          uiEls.geoJsonInput.value =
            "";
        }
      }
    );
  }

  // Export
  if (
    uiEls.exportGeoJsonBtn
  ) {
    uiEls.exportGeoJsonBtn.addEventListener(
      "click",
      async () => {
        try {
          await downloadGeoJson(
            currentMapData
          );

          notify(
            "تم تصدير النقاط بصيغة GeoJSON."
          );

        } catch (error) {
          console.error(
            "GeoJSON export error:",
            error
          );

          notify(
            "فشل تصدير GeoJSON.",
            true
          );
        }
      }
    );
  }
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
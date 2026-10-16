
function byId(id) {
  return document.getElementById(id);
}

// ===============================
// UI Elements
// ===============================

export const uiEls = {
  searchInput: byId("searchInput"),
  searchBtn: byId("searchBtn"),
  searchSuggestions: byId("searchSuggestions"),
  categoryFilters: byId("categoryFilters"),
  legend: byId("legend"),
  visibleCount: byId("visibleCount"),
  totalCount: byId("totalCount"),
  nearestName: byId("nearestName"),
  nearestDistance: byId("nearestDistance"),
  loadingOverlay: byId("loadingOverlay"),
  toastContainer: byId("toastContainer"),
  sidebar: byId("sidebar"),
  toggleSidebarBtn: byId("toggleSidebarBtn"),

  // عناصر قديمة محفوظة للتوافق
  toggleTangible: byId("toggleTangible"),
  toggleIntangible: byId("toggleIntangible"),
  toggleHeatmap: byId("toggleHeatmap"),

  zoomInBtn: byId("zoomInBtn"),
  zoomOutBtn: byId("zoomOutBtn"),
  basemapBtn: byId("basemapBtn"),
  themeBtn: byId("themeBtn"),
  resetBtn: byId("resetBtn"),
  locateBtn: byId("locateBtn"),
  measureBtn: byId("measureBtn"),
  routingBtn: byId("routingBtn"),
  nearestBtn: byId("nearestBtn"),
  routingPanel: byId("routingPanel"),
  routingStatus: byId("routingStatus"),
  routingDistance: byId("routingDistance"),
  routingDuration: byId("routingDuration"),
  clearRouteBtn: byId("clearRouteBtn"),
  importGeoJsonBtn: byId("importGeoJsonBtn"),
  exportGeoJsonBtn: byId("exportGeoJsonBtn"),
  geoJsonInput: byId("geoJsonInput"),
  pieChart: byId("pieChart"),
  barChart: byId("barChart")
};

// ===============================
// Loading Overlay
// ===============================

export function showLoading(show) {
  uiEls.loadingOverlay?.classList.toggle(
    "visible",
    Boolean(show)
  );

  if (uiEls.loadingOverlay) {
    uiEls.loadingOverlay.setAttribute(
      "aria-hidden",
      show ? "false" : "true"
    );
  }
}

// ===============================
// Point Counts
// ===============================

export function updateCounts(visible = 0, total = 0) {
  if (uiEls.visibleCount) {
    uiEls.visibleCount.textContent = String(visible);
  }

  if (uiEls.totalCount) {
    uiEls.totalCount.textContent = String(total);
  }
}

// ===============================
// Nearest Survey Point
// ===============================

export function updateNearest(
  name = "-",
  distanceText = "-"
) {
  if (uiEls.nearestName) {
    uiEls.nearestName.textContent = name;
  }

  if (uiEls.nearestDistance) {
    uiEls.nearestDistance.textContent = distanceText;
  }
}

// ===============================
// Notifications
// ===============================

export function notify(
  message,
  isError = false,
  ms = 3000
) {
  if (!uiEls.toastContainer) {
    console[isError ? "error" : "log"](message);
    return;
  }

  const toast = document.createElement("div");

  toast.className = `toast ${isError ? "error" : ""}`;

  toast.setAttribute(
    "role",
    isError ? "alert" : "status"
  );

  toast.textContent = String(message ?? "");

  uiEls.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    toast.remove();
  }, ms);
}

// ===============================
// Optional Category Filters
// ===============================

export function renderCategoryFilters(
  categories = [],
  selectedCategories = new Set(),
  onChange = () => {}
) {
  if (!uiEls.categoryFilters) {
    return;
  }

  uiEls.categoryFilters.innerHTML = "";

  categories.forEach((category) => {
    const label = document.createElement("label");
    label.className = "filter-item";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = category;
    input.checked = selectedCategories.has(category);

    const text = document.createElement("span");
    text.textContent = category;

    input.addEventListener("change", (event) => {
      onChange(category, event.target.checked);
    });

    label.append(input, text);
    uiEls.categoryFilters.appendChild(label);
  });
}

// ===============================
// Legend
// ===============================

export function renderLegend(palette = {}) {
  if (!uiEls.legend) {
    return;
  }

  uiEls.legend.innerHTML = "";

  Object.entries(palette).forEach(([label, color]) => {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-color";
    swatch.style.backgroundColor = color;

    const text = document.createElement("span");
    text.textContent = label;

    item.append(swatch, text);
    uiEls.legend.appendChild(item);
  });
}

// ===============================
// Sidebar
// ===============================

export function bindSidebarToggle() {
  if (!uiEls.toggleSidebarBtn || !uiEls.sidebar) {
    return;
  }

  const reopenBtn = byId("reopenSidebarBtn");

  const setCollapsed = (collapsed) => {
    uiEls.sidebar.classList.toggle("collapsed", collapsed);

    uiEls.toggleSidebarBtn.textContent =
      collapsed ? "❯" : "❮";

    uiEls.toggleSidebarBtn.title =
      collapsed ? "إظهار اللوحة" : "طي اللوحة";

    uiEls.toggleSidebarBtn.setAttribute(
      "aria-expanded",
      String(!collapsed)
    );

    if (reopenBtn) {
      const showReopenButton =
        collapsed &&
        window.matchMedia("(max-width: 900px)").matches;

      reopenBtn.classList.toggle(
        "visible",
        showReopenButton
      );

      reopenBtn.setAttribute(
        "aria-expanded",
        String(!collapsed)
      );
    }
  };

  uiEls.toggleSidebarBtn.addEventListener("click", () => {
    setCollapsed(
      !uiEls.sidebar.classList.contains("collapsed")
    );
  });

  reopenBtn?.addEventListener("click", () => {
    setCollapsed(false);
  });

  window.addEventListener("resize", () => {
    if (!reopenBtn) return;

    const collapsed =
      uiEls.sidebar.classList.contains("collapsed");

    const showReopenButton =
      collapsed &&
      window.matchMedia("(max-width: 900px)").matches;

    reopenBtn.classList.toggle(
      "visible",
      showReopenButton
    );
  });
}

// ===============================
// Theme
// ===============================

export function bindThemeToggle() {
  if (!uiEls.themeBtn) {
    return;
  }

  const key = "survey-gis-theme";

  let saved = "light";

  try {
    saved = localStorage.getItem(key) || "light";
  } catch (error) {
    console.warn(
      "تعذر قراءة إعداد المظهر المحفوظ.",
      error
    );
  }

  function applyTheme(dark) {
    document.body.classList.toggle("dark-mode", dark);

    uiEls.themeBtn.textContent =
      dark ? "☀️" : "🌙";

    uiEls.themeBtn.title =
      dark ? "الوضع الفاتح" : "الوضع الداكن";
  }

  applyTheme(saved === "dark");

  uiEls.themeBtn.addEventListener("click", () => {
    const nowDark =
      !document.body.classList.contains("dark-mode");

    applyTheme(nowDark);

    try {
      localStorage.setItem(
        key,
        nowDark ? "dark" : "light"
      );
    } catch (error) {
      console.warn(
        "تعذر حفظ إعداد المظهر.",
        error
      );
    }
  });
}

// ===============================
// Search Suggestions
// ===============================

export function showSuggestions(
  suggestions = [],
  onSelect = () => {}
) {
  if (!uiEls.searchSuggestions) {
    return;
  }

  uiEls.searchSuggestions.innerHTML = "";

  if (!suggestions.length) {
    uiEls.searchSuggestions.classList.remove("visible");
    return;
  }

  suggestions.forEach((item) => {
    const button = document.createElement("button");
    button.className = "suggestion-item";
    button.type = "button";

    const title = document.createElement("strong");

    title.textContent =
      item.name || item.code || "نقطة مساحية";

    const details = document.createElement("small");

    details.textContent = [
      item.code ? `الكود: ${item.code}` : "",
      item.type || "",
      item.crs || ""
    ]
      .filter(Boolean)
      .join(" · ");

    button.append(title, details);

    button.addEventListener("click", () => {
      onSelect(item);
    });

    uiEls.searchSuggestions.appendChild(button);
  });

  uiEls.searchSuggestions.classList.add("visible");
}

// ===============================
// Hide Search Suggestions
// ===============================

export function hideSuggestions() {
  if (!uiEls.searchSuggestions) {
    return;
  }

  uiEls.searchSuggestions.classList.remove("visible");
  uiEls.searchSuggestions.innerHTML = "";
}

// ===============================
// Survey Charts
// ===============================

let pieChartInstance = null;
let barChartInstance = null;

function makeColors(labels) {
  return labels.map((_, index) => {
    const hue = (index * 47) % 360;
    return `hsl(${hue}, 70%, 52%)`;
  });
}

export function renderCharts(counts = {}) {
  const labels = Object.keys(counts);
  const values = Object.values(counts);
  const colors = makeColors(labels);

  if (!uiEls.pieChart || !uiEls.barChart) {
    return;
  }

  // تحديث الرسوم عند عدم وجود بيانات
  if (!labels.length) {
    if (pieChartInstance) {
      pieChartInstance.data.labels = [];
      pieChartInstance.data.datasets[0].data = [];
      pieChartInstance.update("none");
    }

    if (barChartInstance) {
      barChartInstance.data.labels = [];
      barChartInstance.data.datasets[0].data = [];
      barChartInstance.update("none");
    }

    return;
  }

  // ===============================
  // Doughnut Chart
  // ===============================

  if (!pieChartInstance) {
    pieChartInstance = new Chart(uiEls.pieChart, {
      type: "doughnut",

      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 1
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "45%",

        animation: {
          duration: 300
        },

        plugins: {
          legend: {
            position: "bottom",

            labels: {
              font: {
                family: "Segoe UI"
              },

              boxWidth: 12
            }
          },

          tooltip: {
            rtl: true
          }
        }
      }
    });
  } else {
    pieChartInstance.data.labels = labels;

    pieChartInstance.data.datasets[0].data = values;

    pieChartInstance.data.datasets[0].backgroundColor =
      colors;

    pieChartInstance.update("none");
  }

  // ===============================
  // Bar Chart
  // ===============================

  if (!barChartInstance) {
    barChartInstance = new Chart(uiEls.barChart, {
      type: "bar",

      data: {
        labels,

        datasets: [
          {
            label: "عدد النقاط المساحية",
            data: values,
            backgroundColor: colors,
            borderRadius: 8
          }
        ]
      },

      options: {
        responsive: true,
        maintainAspectRatio: false,

        animation: {
          duration: 300
        },

        scales: {
          y: {
            beginAtZero: true,

            ticks: {
              precision: 0
            }
          },

          x: {
            ticks: {
              maxRotation: 0
            }
          }
        },

        plugins: {
          legend: {
            display: false
          },

          tooltip: {
            rtl: true
          }
        }
      }
    });
  } else {
    barChartInstance.data.labels = labels;

    barChartInstance.data.datasets[0].data = values;

    barChartInstance.data.datasets[0].backgroundColor =
      colors;

    barChartInstance.update("none");
  }
}

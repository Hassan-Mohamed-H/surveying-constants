import { createBatchProcessor } from "./performance.js";
import { queryNearest } from "./spatialIndex.js";
import proj4 from "https://cdn.jsdelivr.net/npm/proj4@2.15.0/+esm";

// ===============================
// Map Constants
// ===============================

const DEFAULT_CENTER = [26.1551, 32.7160];
const DEFAULT_ZOOM = 9;

const FALLBACK_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
];

// ===============================
// CRS Registry
// ===============================

// تعريفات أنظمة الإحداثيات التي تم تحميلها
const crsDefinitions = new Map();

// الطلبات الجارية لمنع تكرار تحميل نفس CRS
const crsRequests = new Map();

const EPSG_CODE_PATTERN = /^(?:EPSG:)?(\d+)$/i;

// ===============================
// Map Variables
// ===============================

let map = null;
let clusterLayer = null;

let markerRefs = [];

let userLatLng = null;
let userMarker = null;

let routeLine = null;

let measureMode = false;
let measurePoints = [];
let measureLayer = null;

let geoJsonLayer = null;

let activeTileName = "light";

let lightLayer = null;
let darkLayer = null;
let satelliteLayer = null;

let routingMode = false;

// ===============================
// CRS Helpers
// ===============================

function normalizeCRS(crs) {
  if (crs === null || crs === undefined) {
    return null;
  }

  const value = String(crs)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");

  if (!value) {
    return null;
  }

  const match = value.match(EPSG_CODE_PATTERN);

  if (!match) {
    return null;
  }

  return `EPSG:${match[1]}`;
}

// ===============================
// Load CRS Definition
// ===============================

async function loadCRSDefinition(crs) {
  const normalizedCRS = normalizeCRS(crs);

  if (!normalizedCRS) {
    throw new Error(`Invalid CRS: ${crs}`);
  }

  // EPSG:4326
  if (normalizedCRS === "EPSG:4326") {
    const definition =
      "+proj=longlat +datum=WGS84 +no_defs +type=crs";

    proj4.defs(
      normalizedCRS,
      definition
    );

    crsDefinitions.set(
      normalizedCRS,
      definition
    );

    return definition;
  }

  // لو الـ CRS متحمل قبل كده
  if (
    crsDefinitions.has(
      normalizedCRS
    )
  ) {
    return crsDefinitions.get(
      normalizedCRS
    );
  }

  // لو فيه طلب لتحميل نفس CRS بالفعل
  if (
    crsRequests.has(
      normalizedCRS
    )
  ) {
    return crsRequests.get(
      normalizedCRS
    );
  }

  // تحميل تعريف الـ CRS من EPSG.io
  const request = fetch(
    `https://epsg.io/${normalizedCRS.replace(
      "EPSG:",
      ""
    )}.proj4`,
    {
      method: "GET",
      cache: "force-cache",
      headers: {
        Accept: "text/plain",
      },
    }
  )
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(
          `CRS ${normalizedCRS} was not found in EPSG.io (${response.status})`
        );
      }

      const definition =
        (await response.text()).trim();

      if (!definition) {
        throw new Error(
          `Empty CRS definition for ${normalizedCRS}`
        );
      }

      proj4.defs(
        normalizedCRS,
        definition
      );

      crsDefinitions.set(
        normalizedCRS,
        definition
      );

      return definition;
    })
    .finally(() => {
      crsRequests.delete(
        normalizedCRS
      );
    });

  crsRequests.set(
    normalizedCRS,
    request
  );

  return request;
}

// ===============================
// Get Projection Definition
// ===============================

export async function getProjectionDefinition(
  crs
) {
  const normalizedCRS =
    normalizeCRS(crs);

  if (!normalizedCRS) {
    return null;
  }

  try {
    return await loadCRSDefinition(
      normalizedCRS
    );
  } catch (error) {
    console.error(
      `Unable to load CRS definition for ${normalizedCRS}:`,
      error
    );

    return null;
  }
}

// ===============================
// Convert Survey Point
// ===============================

export async function convertSurveyPoint(
  item
) {
  if (!item) return null;

  const northing =
    Number(item.northing);

  const easting =
    Number(item.easting);

  const crs =
    item.crs;

  if (
    !Number.isFinite(
      northing
    ) ||
    !Number.isFinite(
      easting
    )
  ) {
    console.warn(
      "Point skipped: invalid Northing/Easting",
      item
    );

    return null;
  }

  const normalizedCRS =
    normalizeCRS(crs);

  if (!normalizedCRS) {
    console.warn(
      "Point skipped: invalid or missing CRS",
      item
    );

    return null;
  }

  const projection =
    await getProjectionDefinition(
      normalizedCRS
    );

  if (!projection) {
    console.warn(
      `Point skipped: CRS definition unavailable: ${normalizedCRS}`,
      item
    );

    return null;
  }

  try {
    // مهم:
    // البيانات عندنا:
    // Northing = Y
    // Easting  = X
    //
    // لذلك Proj4 يستقبل:
    // [Easting, Northing]

    const result = proj4(
      normalizedCRS,
      "EPSG:4326",
      [
        easting,
        northing,
      ]
    );

    const lng =
      result[0];

    const lat =
      result[1];

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng)
    ) {
      return null;
    }

    return {
      ...item,
      crs: normalizedCRS,
      lat,
      lng,
    };

  } catch (error) {
    console.error(
      `CRS conversion failed for ${normalizedCRS}:`,
      item,
      error
    );

    return null;
  }
}

// ===============================
// Prepare Map Data
// ===============================

export async function prepareMapData(
  data = []
) {
  if (!Array.isArray(data)) {
    return [];
  }

  const converted = [];

  for (const item of data) {
    const point =
      await convertSurveyPoint(
        item
      );

    if (point) {
      converted.push(point);
    }
  }

  return converted;
}

// ===============================
// Initialize Map
// ===============================

export function initMap() {
  if (map) {
    return map;
  }

  map = L.map("map", {
    zoomControl: false,
    preferCanvas: true,
  }).setView(
    DEFAULT_CENTER,
    DEFAULT_ZOOM
  );

  // ===============================
  // Base Layers
  // ===============================

  lightLayer = L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 20,
      attribution:
        "&copy; OpenStreetMap contributors",
    }
  );

  darkLayer = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    {
      maxZoom: 20,
      attribution:
        "&copy; CARTO",
    }
  );

  satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      maxZoom: 20,
      attribution:
        "Tiles &copy; Esri",
    }
  );

  lightLayer.addTo(map);

  // ===============================
  // Marker Cluster
  // ===============================

  clusterLayer =
    L.markerClusterGroup({
      chunkedLoading: true,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
    });

  map.addLayer(
    clusterLayer
  );

  // ===============================
  // Measurement Layer
  // ===============================

  measureLayer =
    L.layerGroup().addTo(
      map
    );

  // ===============================
  // GeoJSON Layer
  // ===============================

  geoJsonLayer =
    L.layerGroup().addTo(
      map
    );

  // ===============================
  // Map Click
  // ===============================

  map.on(
    "click",
    (event) => {
      if (!measureMode) {
        return;
      }

      addMeasurePoint(
        event.latlng
      );
    }
  );

  return map;
}

// ===============================
// Get Map
// ===============================

export function getMap() {
  return map;
}

// ===============================
// Marker Color
// ===============================

function getStatusColor(
  status
) {
  if (!status) {
    return FALLBACK_COLORS[0];
  }

  const value =
    String(status)
      .trim()
      .toLowerCase();

  if (
    value.includes("active") ||
    value.includes("فعال") ||
    value.includes("نشط")
  ) {
    return "#10b981";
  }

  if (
    value.includes("inactive") ||
    value.includes("غير فعال") ||
    value.includes("غير نشط")
  ) {
    return "#ef4444";
  }

  if (
    value.includes("maintenance") ||
    value.includes("صيانة")
  ) {
    return "#f59e0b";
  }

  return FALLBACK_COLORS[0];
}

// ===============================
// Create Marker
// ===============================

function createSurveyMarker(
  item
) {
  const color =
    getStatusColor(
      item.status
    );

  const marker =
    L.circleMarker(
      [
        item.lat,
        item.lng,
      ],
      {
        radius: 8,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.9,
      }
    );

  marker.bindTooltip(
    item.name ||
      item.code ||
      "نقطة مساحية",
    {
      direction: "top",
      offset: [0, -8],
    }
  );

  marker.on(
    "click",
    () => {
      openSidePanel(
        item
      );
    }
  );

  marker.__surveyItem =
    item;

  return marker;
}

// ===============================
// Set Markers
// ===============================

export async function setMarkers(
  data = []
) {
  if (
    !map ||
    !clusterLayer
  ) {
    console.warn(
      "Map is not initialized."
    );

    return [];
  }

  clusterLayer.clearLayers();

  markerRefs = [];

  const preparedData =
    await prepareMapData(
      data
    );

  if (
    !preparedData.length
  ) {
    return [];
  }

 const processMarkers = createBatchProcessor(350);

  processMarkers(
    preparedData,
    (item) => {
      const marker = createSurveyMarker(item);

      clusterLayer.addLayer(marker);

      markerRefs.push({
        marker,
        item
      });
    },
    () => {
      console.log(
        `تم رسم ${preparedData.length} نقطة مساحية.`
      );
    }
  );

  // ===============================
  // Fit Map To Points
  // ===============================

  const bounds = [];

  for (
    const item of preparedData
  ) {
    bounds.push([
      item.lat,
      item.lng,
    ]);
  }

  if (
    bounds.length === 1
  ) {
    map.setView(
      bounds[0],
      15
    );
  } else if (
    bounds.length > 1
  ) {
    map.fitBounds(
      bounds,
      {
        padding: [
          40,
          40,
        ],
        maxZoom: 16,
      }
    );
  }

  return preparedData;
}
// ===============================
// Clear Markers
// ===============================

export function clearMarkers() {
  if (!clusterLayer) return;

  clusterLayer.clearLayers();
  markerRefs = [];
}

// ===============================
// Find Marker By Item
// ===============================

export function findMarkerForItem(item) {
  if (!item) return null;

  for (const ref of markerRefs) {
    const markerItem = ref.item;

    if (
      markerItem === item ||
      (
        item.code != null &&
        markerItem.code != null &&
        String(markerItem.code) === String(item.code)
      ) ||
      (
        item.name != null &&
        markerItem.name != null &&
        String(markerItem.name).trim() ===
          String(item.name).trim()
      )
    ) {
      return ref.marker;
    }
  }

  return null;
}

// ===============================
// Open Side Panel
// ===============================

export function openSidePanel(item) {
  if (!item) return;

  const panel =
    document.querySelector("#sidePanel") ||
    document.querySelector(".side-panel");

  if (!panel) {
    console.warn("Side panel not found.");
    return;
  }

  const name =
    item.name ||
    item.code ||
    "نقطة مساحية";

  const code =
    item.code || "—";

  const northing =
    Number.isFinite(item.northing)
      ? item.northing.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })
      : "—";

  const easting =
    Number.isFinite(item.easting)
      ? item.easting.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })
      : "—";

  const elevation =
    Number.isFinite(item.elevation)
      ? item.elevation.toLocaleString("en-US", {
          maximumFractionDigits: 3,
        })
      : "—";

  const description =
    item.description || "لا يوجد وصف";

  const type =
    item.type || "—";

  const status =
    item.status || "—";

  const crs =
    item.crs || "—";

  panel.innerHTML = `
    <div class="side-panel-header">
      <div>
        <h3>${escapeHtml(name)}</h3>
        <span>${escapeHtml(code)}</span>
      </div>

      <button
        type="button"
        class="side-panel-close"
        data-close-panel
      >
        ×
      </button>
    </div>

    <div class="side-panel-content">

      <div class="survey-info-row">
        <span>الكود</span>
        <strong>${escapeHtml(code)}</strong>
      </div>

      <div class="survey-info-row">
        <span>Northing</span>
        <strong>${escapeHtml(String(northing))}</strong>
      </div>

      <div class="survey-info-row">
        <span>Easting</span>
        <strong>${escapeHtml(String(easting))}</strong>
      </div>

      <div class="survey-info-row">
        <span>المنسوب</span>
        <strong>${escapeHtml(String(elevation))}</strong>
      </div>

      <div class="survey-info-row">
        <span>النوع</span>
        <strong>${escapeHtml(type)}</strong>
      </div>

      <div class="survey-info-row">
        <span>الحالة</span>
        <strong>${escapeHtml(status)}</strong>
      </div>

      <div class="survey-info-row">
        <span>CRS</span>
        <strong>${escapeHtml(crs)}</strong>
      </div>

      <div class="survey-description">
        <h4>الوصف</h4>
        <p>${escapeHtml(description)}</p>
      </div>

      <div class="survey-location">
        <h4>الموقع الجغرافي</h4>

        <div class="survey-info-row">
          <span>Latitude</span>
          <strong>${item.lat.toFixed(7)}</strong>
        </div>

        <div class="survey-info-row">
          <span>Longitude</span>
          <strong>${item.lng.toFixed(7)}</strong>
        </div>
      </div>

      <div class="side-panel-actions">

        <button
          type="button"
          class="btn-primary"
          data-focus-point
        >
          تحديد على الخريطة
        </button>

        <button
          type="button"
          class="btn-secondary"
          data-route-point
        >
          إنشاء مسار
        </button>

      </div>

    </div>
  `;

panel.classList.remove("hidden");
panel.classList.add("active");
panel.style.transform = "translateX(0)";
panel.setAttribute("aria-hidden", "false");
  // ===============================
  // Close Button
  // ===============================

  const closeButton =
    panel.querySelector(
      "[data-close-panel]"
    );

  closeButton?.addEventListener(
    "click",
    closeSidePanel
  );

  // ===============================
  // Focus Button
  // ===============================

  const focusButton =
    panel.querySelector(
      "[data-focus-point]"
    );

  focusButton?.addEventListener(
    "click",
    () => {
      focusPoint(item);
    }
  );

  // ===============================
  // Route Button
  // ===============================

  const routeButton =
    panel.querySelector(
      "[data-route-point]"
    );

  routeButton?.addEventListener(
    "click",
    () => {
      startRoutingToPoint(item);
    }
  );
}

// ===============================
// Close Side Panel
// ===============================


export function closeSidePanel() {
  const panel =
    document.querySelector("#sidePanel") ||
    document.querySelector(".side-panel");

  if (!panel) return;

  panel.classList.add("hidden");
  panel.classList.remove("active");
  panel.style.transform = "translateX(-100%)";
  panel.setAttribute("aria-hidden", "true");
}

// ===============================
// Focus Point
// ===============================

export async function focusPoint(item) {
  if (!map || !item) return;

  const point =
    await convertSurveyPoint(item);

  if (!point) return;

  map.setView(
    [
      point.lat,
      point.lng,
    ],
    17,
    {
      animate: true,
    }
  );

  const marker =
    findMarkerForItem(point);

  if (marker) {
    marker.openTooltip();
  }
}

// ===============================
// User Location
// ===============================

export function locateUser() {
  if (!map) return;

  if (!navigator.geolocation) {
    alert(
      "المتصفح لا يدعم تحديد الموقع."
    );

    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat =
        position.coords.latitude;

      const lng =
        position.coords.longitude;

      userLatLng =
        L.latLng(lat, lng);

      if (userMarker) {
        userMarker.setLatLng(
          userLatLng
        );
      } else {
        userMarker =
          L.marker(userLatLng)
            .addTo(map)
            .bindPopup(
              "موقعك الحالي"
            );
      }

      map.setView(
        userLatLng,
        16,
        {
          animate: true,
        }
      );
    },

    (error) => {
      console.error(
        "Geolocation error:",
        error
      );

      alert(
        "تعذر الحصول على موقعك الحالي."
      );
    },

    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    }
  );
}

// ===============================
// Routing
// ===============================

export async function startRoutingToPoint(
  item
) {
  if (!map || !item) return;

  const point =
    await convertSurveyPoint(item);

  if (!point) return;

  if (!userLatLng) {
    alert(
      "حدد موقعك الحالي أولاً لإنشاء المسار."
    );

    locateUser();

    return;
  }

  routingMode = true;

  const start =
    `${userLatLng.lng},${userLatLng.lat}`;

  const end =
    `${point.lng},${point.lat}`;

  const url =
    `https://router.project-osrm.org/route/v1/driving/${start};${end}?overview=full&geometries=geojson`;

  fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error(
          "Routing request failed"
        );
      }

      return response.json();
    })

    .then((result) => {
      if (
        !result.routes ||
        !result.routes.length
      ) {
        throw new Error(
          "No route found"
        );
      }

      const coordinates =
        result.routes[0]
          .geometry.coordinates;

      const latLngs =
        coordinates.map(
          ([lng, lat]) => [
            lat,
            lng,
          ]
        );

      if (routeLine) {
        map.removeLayer(
          routeLine
        );
      }

      routeLine =
        L.polyline(
          latLngs,
          {
            weight: 5,
            opacity: 0.85,
          }
        ).addTo(map);

      map.fitBounds(
        routeLine.getBounds(),
        {
          padding: [40, 40],
        }
      );
    })

    .catch((error) => {
      console.error(
        "Routing error:",
        error
      );

      alert(
        "تعذر إنشاء المسار."
      );
    });
}

// ===============================
// Clear Route
// ===============================

export function clearRoute() {
  if (!map || !routeLine) {
    return;
  }

  map.removeLayer(
    routeLine
  );

  routeLine = null;
  routingMode = false;
}

// ===============================
// Find Nearest Point
// ===============================


export async function findNearestSite(data = []) {
  if (!map || !userLatLng) {
    alert("حدد موقعك الحالي أولاً من زر تحديد الموقع.");
    return null;
  }

  const preparedData = await prepareMapData(data);

  if (!preparedData.length) {
    alert("لا توجد نقاط صالحة لتحديد الأقرب.");
    return null;
  }

  let nearest = null;
  let minDistance = Infinity;

  for (const item of preparedData) {
    const distance = userLatLng.distanceTo(
      L.latLng(item.lat, item.lng)
    );

    if (distance < minDistance) {
      minDistance = distance;
      nearest = item;
    }
  }

  if (!nearest) return null;

  // رسم خط مستقيم بين موقع المستخدم والنقطة
  if (routeLine) {
    map.removeLayer(routeLine);
  }

  routeLine = L.polyline(
    [
      userLatLng,
      [nearest.lat, nearest.lng]
    ],
    {
      color: "#0ea5e9",
      weight: 4,
      dashArray: "8 7",
      opacity: 0.95
    }
  ).addTo(map);

  map.fitBounds(routeLine.getBounds(), {
    padding: [50, 50],
    maxZoom: 17
  });

  await focusPoint(nearest);
  openSidePanel(nearest);

  // إظهار المسافة في السايد بار الرئيسي
  const distanceText = minDistance >= 1000
    ? `${(minDistance / 1000).toFixed(2)} كم`
    : `${Math.round(minDistance)} متر`;

  const nearestNameEl = document.getElementById("nearestName");
  const nearestDistanceEl = document.getElementById("nearestDistance");

  if (nearestNameEl) {
    nearestNameEl.textContent =
      nearest.name || nearest.code || "نقطة مساحية";
  }

  if (nearestDistanceEl) {
    nearestDistanceEl.textContent = distanceText;
  }

  return {
    ...nearest,
    distanceMeters: minDistance,
    distanceText
  };
}


// ===============================
// Measurement
// ===============================

export function setMeasureMode(
  enabled
) {
  measureMode =
    Boolean(enabled);

  if (!measureMode) {
    clearMeasurement();
  }
}

export function addMeasurePoint(
  latlng
) {
  if (
    !measureMode ||
    !map
  ) {
    return;
  }

  measurePoints.push(
    latlng
  );

  L.circleMarker(
    latlng,
    {
      radius: 5,
      weight: 2,
      fillOpacity: 1,
    }
  ).addTo(
    measureLayer
  );

  if (
    measurePoints.length >= 2
  ) {
    const previous =
      measurePoints[
        measurePoints.length - 2
      ];

    L.polyline(
      [
        previous,
        latlng,
      ],
      {
        weight: 3,
        dashArray: "6 6",
      }
    ).addTo(
      measureLayer
    );

    const distance =
      map.distance(
        previous,
        latlng
      );

    console.log(
      `Distance: ${distance.toFixed(2)} m`
    );
  }
}

export function clearMeasurement() {
  measurePoints = [];

  if (measureLayer) {
    measureLayer.clearLayers();
  }
}

// ===============================
// Tile Layers
// ===============================

export function setBaseLayer(
  type
) {
  if (!map) return;

  if (lightLayer) {
    map.removeLayer(
      lightLayer
    );
  }

  if (darkLayer) {
    map.removeLayer(
      darkLayer
    );
  }

  if (satelliteLayer) {
    map.removeLayer(
      satelliteLayer
    );
  }

  switch (type) {
    case "dark":
      darkLayer?.addTo(map);
      activeTileName = "dark";
      break;

    case "satellite":
      satelliteLayer?.addTo(map);
      activeTileName = "satellite";
      break;

    case "light":
    default:
      lightLayer?.addTo(map);
      activeTileName = "light";
      break;
  }
}

export function getActiveBaseLayer() {
  return activeTileName;
}

// ===============================
// Reset Extent
// ===============================

export async function resetExtent(
  data = []
) {
  if (!map) return;

  const preparedData =
    await prepareMapData(
      data
    );

  if (!preparedData.length) {
    map.setView(
      DEFAULT_CENTER,
      DEFAULT_ZOOM
    );

    return;
  }

  const bounds =
    preparedData.map(
      (item) => [
        item.lat,
        item.lng,
      ]
    );

  if (
    bounds.length === 1
  ) {
    map.setView(
      bounds[0],
      15
    );
  } else {
    map.fitBounds(
      bounds,
      {
        padding: [
          40,
          40,
        ],
        maxZoom: 16,
      }
    );
  }
}

// ===============================
// GeoJSON Import
// ===============================

export function renderImportedGeoJson(
  geojson
) {
  if (!geoJsonLayer) {
    return;
  }

  geoJsonLayer.clearLayers();

  if (!geojson) {
    return;
  }

  const layer =
    L.geoJSON(
      geojson,
      {
        pointToLayer: (
          feature,
          latlng
        ) => {
          return L.circleMarker(
            latlng,
            {
              radius: 7,
              weight: 2,
              fillOpacity: 0.8,
            }
          );
        },

        onEachFeature: (
          feature,
          layer
        ) => {
          const properties =
            feature.properties ||
            {};

          const content =
            Object.entries(
              properties
            )
              .map(
                ([key, value]) =>
                  `<div>
                    <strong>${escapeHtml(key)}</strong>:
                    ${escapeHtml(
                      String(
                        value ?? "—"
                      )
                    )}
                  </div>`
              )
              .join("");

          layer.bindPopup(
            content ||
              "لا توجد بيانات"
          );
        },
      }
    );

  geoJsonLayer.addLayer(
    layer
  );
}
// ===============================
// Export GeoJSON
// ===============================

export async function exportToGeoJson(
  data = []
) {
  const preparedData =
    await prepareMapData(
      data
    );

  const features =
    preparedData.map(
      (item) => ({
        type: "Feature",

        geometry: {
          type: "Point",

          coordinates: [
            item.lng,
            item.lat,
          ],
        },

        properties: {
          Name: item.name,
          Code: item.code,
          Northing: item.northing,
          Easting: item.easting,
          Elevation: item.elevation,
          Description:
            item.description,
          Type: item.type,
          Status: item.status,
          CRS: item.crs,
        },
      })
    );

  return {
    type: "FeatureCollection",
    features,
  };
}

// ===============================
// Download GeoJSON
// ===============================

export async function downloadGeoJson(
  data = []
) {
  const geojson =
    await exportToGeoJson(
      data
    );

  const blob =
    new Blob(
      [
        JSON.stringify(
          geojson,
          null,
          2
        ),
      ],
      {
        type:
          "application/geo+json",
      }
    );

  const url =
    URL.createObjectURL(
      blob
    );

  const link =
    document.createElement(
      "a"
    );

  link.href = url;

  link.download =
    "survey-control-points.geojson";

  document.body.appendChild(
    link
  );

  link.click();

  link.remove();

  URL.revokeObjectURL(
    url
  );
}

// ===============================
// HTML Escape
// ===============================

function escapeHtml(value) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

// ===============================
// Map State
// ===============================

export function getMapState() {
  return {
    activeTileName,
    measureMode,
    routingMode,
    userLatLng,
  };
}
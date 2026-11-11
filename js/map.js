import { createBatchProcessor } from "./performance.js";
import { queryNearest } from "./spatialIndex.js";
import proj4 from "https://cdn.jsdelivr.net/npm/proj4@2.15.0/+esm";

import { getWaybackItemsWithLocalChanges } from "https://cdn.jsdelivr.net/npm/@esri/wayback-core/+esm";
import { getTypeColor, getStatusColor } from "./colors.js";


// ===============================
// Map Constants
// ===============================

const DEFAULT_CENTER = [26.8206, 30.8025];
const DEFAULT_ZOOM = 6;

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
// updateLatestImagery
// ===============================

let imageryUpdateRequest = 0;
let imageryUpdateTimer = null;

async function updateLatestImagery() {
  if (!map || !satelliteLayer) return;

  const requestId = ++imageryUpdateRequest;
  const center = map.getCenter();
  const zoom = map.getZoom();

  try {
    const versions = await getWaybackItemsWithLocalChanges(
      {
        latitude: center.lat,
        longitude: center.lng,
      },
      zoom
    );

    if (
      requestId !== imageryUpdateRequest ||
      !versions?.length
    ) {
      return;
    }

    console.log("========== WAYBACK DEBUG ==========");

    console.log("Map Center:", {
      latitude: center.lat,
      longitude: center.lng
    });

    console.log("Current Zoom:", zoom);

    console.log("Available Versions:");

    console.table(
      versions.map((version, index) => ({
        index,
        releaseDate: version.releaseDateLabel,
        releaseDatetime: version.releaseDatetime,
        releaseNum: version.releaseNum,
        itemTitle: version.itemTitle
      }))
    );

    console.log("===================================");

    const latestVersion = versions[0];

    const tileUrl = latestVersion.itemURL
      .replace("{level}", "{z}")
      .replace("{row}", "{y}")
      .replace("{col}", "{x}");

    if (satelliteLayer._url !== tileUrl) {
      satelliteLayer.setUrl(tileUrl);
    }

    console.log(
      "إصدار الصور الفضائية:",
      latestVersion.releaseDateLabel
    );
  } catch (error) {
    console.error(
      "تعذر تحديث إصدار الصور الفضائية:",
      error
    );
  }
}

function scheduleImageryUpdate() {
  clearTimeout(imageryUpdateTimer);

  imageryUpdateTimer = setTimeout(() => {
    updateLatestImagery();
  }, 700);
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
    minZoom: 2,
    maxZoom: 25
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

  
  satelliteLayer = L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      minZoom: 2,
      maxZoom: 25,
      maxNativeZoom: 18,
      attribution:
        "Tiles &copy; Esri",
    }
  );

satelliteLayer.addTo(map);
activeTileName = "satellite";

map.on("moveend", scheduleImageryUpdate);
updateLatestImagery();

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

// ===============================
// Create Marker
// ===============================

function createSurveyMarker(item) {
  const statusColor = getStatusColor(item.status);
  const typeColor = getTypeColor(item.type);
  const label = String(item.name || item.code || "نقطة مساحية");

  // النصف الأيسر للحالة، والنصف الأيمن للنوع.
  const marker = L.marker([item.lat, item.lng], {
    icon: L.divIcon({
      className: "survey-split-marker-wrap",
      html: `<span class="survey-split-marker" style="--status-color:${statusColor};--type-color:${typeColor}" aria-label="الحالة والنوع"></span>`,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
      tooltipAnchor: [8, -8]
    }),
    keyboard: true,
    title: label
  });

  marker.bindTooltip(escapeHtml(label), {
    permanent: true,
    direction: "top",
    offset: [0, -8],
    opacity: 1,
    className: "survey-point-label",
    interactive: false,
    bubblingMouseEvents: false
  });

  marker.on("click", () => {
  if (measureMode) {
    addMeasurePoint(marker.getLatLng());
    return;
  }

    openSidePanel(item);
  });

  marker.__surveyItem = item;
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
    // رسم الخط بين النقطة السابقة والنقطة الحالية
    const previous =
      measurePoints[
        measurePoints.length - 2
      ];

    L.polyline(
      [previous, latlng],
      {
        weight: 3,
        dashArray: "6 6",
      }
    ).addTo(measureLayer);

    // حساب إجمالي طول المسار بالكامل
    const distance = measurePoints.reduce(
      (total, point, index, points) => {
        if (index === 0) return total;

        return total + map.distance(
          points[index - 1],
          point
        );
      },
      0
    );

    const distanceText = distance >= 1000
      ? `${(distance / 1000).toFixed(2)} كم`
      : `${Math.round(distance)} متر`;

    // تحديث خانة المسافة في السايد بار
    const distanceElement = document.getElementById("nearestDistance");


    if (distanceElement) {
      distanceElement.textContent = distanceText;
    }
  }
}

export function clearMeasurement() {
  measurePoints = [];

  if (measureLayer) {
    measureLayer.clearLayers();
  }

  const distanceElement = document.getElementById("nearestDistance");

  if (distanceElement) {
    distanceElement.textContent = "-";
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



  if (satelliteLayer) {
    map.removeLayer(
      satelliteLayer
    );
  }

  switch (type) {


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
// Export helpers
// ===============================

function downloadTextFile(content, filename, mimeType = "text/plain;charset=utf-8", withBom = true) {
  const blob = new Blob([...(withBom ? ["\uFEFF"] : []), content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validateSurveyExport(data = []) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("لا توجد نقاط أساسية لتصديرها.");
  }
  const invalid = data.find(item =>
    !Number.isFinite(Number(item.easting)) ||
    !Number.isFinite(Number(item.northing)) ||
    !Number.isFinite(Number(item.elevation ?? 0))
  );
  if (invalid) throw new Error(`إحداثيات النقطة ${invalid.name ?? "بدون اسم"} غير مكتملة.`);
  const crsValues = [...new Set(data.map(item => normalizeCRS(item.crs)).filter(Boolean))];
  if (crsValues.length > 1) {
    throw new Error("النقاط تحتوي على أنظمة إحداثيات مختلفة. وحّد نظام الإحداثيات قبل تصدير PNT أو SDR أو DXF.");
  }
  if (data.some(item => !normalizeCRS(item.crs))) {
    throw new Error("يوجد نقاط بدون نظام إحداثيات محدد. لا يمكن ضمان صحة ملف الرفع.");
  }
}

export function downloadPnt(data = []) {
  validateSurveyExport(data);
  const rows = data.map(item => [
    item.name ?? "",
    Number(item.easting).toFixed(4),
    Number(item.northing).toFixed(4),
    Number(item.elevation ?? 0).toFixed(4),
    item.code ?? "",
  ].map(csvCell).join(","));
  downloadTextFile(rows.join("\r\n"), "survey-control-points.pnt");
}


export async function downloadCsv(data = [], targetCRS = null) {
  validateSurveyExport(data);

  const outputCRS = normalizeCRS(targetCRS || data[0].crs);

  if (!outputCRS) {
    throw new Error("نظام الإحداثيات المحدد غير صالح.");
  }

  await loadCRSDefinition(outputCRS);

  const rows = [];

  for (const item of data) {
    const sourceCRS = normalizeCRS(item.crs);

    await loadCRSDefinition(sourceCRS);

    let easting = Number(item.easting);
    let northing = Number(item.northing);

    if (sourceCRS !== outputCRS) {
      const converted = proj4(
        sourceCRS,
        outputCRS,
        [easting, northing]
      );

      easting = converted[0];
      northing = converted[1];
    }

    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new Error(`تعذر تحويل إحداثيات النقطة ${item.name || ""}.`);
    }

    const precision = outputCRS === "EPSG:4326" ? 8 : 4;

    rows.push([
      item.name ?? "",
      easting.toFixed(precision),
      northing.toFixed(precision),
      Number(item.elevation ?? 0).toFixed(4),
      item.code ?? "",
      outputCRS
    ]);
  }

  const headers = [
    "Name",
    "Easting",
    "Northing",
    "Elevation",
    "Code",
    "CRS"
  ];

  const csvContent = [headers, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");

  const fileName = `survey-control-points-${outputCRS.replace(":", "-")}.csv`;

  downloadTextFile(
    csvContent,
    fileName,
    "text/csv;charset=utf-8",
    true
  );
}


function sdrNumber(value) {
  return Number(value ?? 0).toFixed(4);
}

export function downloadSdr33(data = []) {
  validateSurveyExport(data);
  const now = new Date();
  const date = `${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}`;
  const time = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const lines = [
    "00NMSDR33 V04-04.02     00-000-00 00:00 211111",
    `10NMCONTROL            ${date}${time}`,
    "06NM1.00000000      ",
    "01NM:SET5F V01-00    020078                      31                                0.00000000      ",
    "13PCP.C. mm Applied:-30.000",
  ];
  data.forEach((item, index) => {
    const pointName = String(item.name ?? index + 1).slice(0, 16).padEnd(16, " ");
    const northing = sdrNumber(item.northing).padStart(16, " ");
    const easting = sdrNumber(item.easting).padStart(16, " ");
    const elevation = sdrNumber(item.elevation).padStart(16, " ");
    const code = String(item.code ?? "").slice(0, 16).padEnd(16, " ");
    lines.push(`08TP${pointName}${northing}${easting}${elevation}${code}`);
  });
  downloadTextFile(lines.join("\r\n") + "\r\n", "CONTROL.SDR", "text/plain;charset=ascii", false);
}

// ===============================
// DXF export (كل بيان في حقل مستقل)
// ===============================
// كل نقطة تتصدّر كـ:
//   INSERT واحد لبلوك SURVEY_POINT على طبقة CONTROL_POINTS
//   (من غير POINT منفصل عشان ما تتكررش النقطة في ArcGIS)،
//   وبداخله ATTRIB منفصل لكل حقل (Name, Code, Easting, ...).
// الحقول المطلوبة وترتيبها — عدّل هذه القائمة لإضافة/حذف أي حقل.
// visible=true يعني يظهر كنص على الرسم، والباقي مخفي لكنه موجود كحقل بيانات.
const DXF_FIELDS = [
  { tag: "NAME",      label: "Name",      visible: true  },
  { tag: "CODE",      label: "Code",      visible: false },
  { tag: "EASTING",   label: "Easting",   visible: false },
  { tag: "NORTHING",  label: "Northing",  visible: false },
  { tag: "ELEVATION", label: "Elevation", visible: false },
  { tag: "TYPE",      label: "Type",      visible: false },
  { tag: "STATUS",    label: "Status",    visible: false },
  { tag: "CRS",       label: "CRS",       visible: false },
];

function dxfPair(code, value) { return `${code}\r\n${value}\r\n`; }

function dxfText(value) {
  return String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 240);
}

export async function downloadDxf(data = [], targetCRS = null) {
  validateSurveyExport(data);

  const outputCRS = normalizeCRS(targetCRS || data[0].crs);
  if (!outputCRS) throw new Error("نظام الإحداثيات المحدد غير صالح.");
  await loadCRSDefinition(outputCRS);

  const BLOCK_NAME = "SURVEY_POINT";
  const TEXT_H = 1.0;
  const precision = outputCRS === "EPSG:4326" ? 8 : 4;

  let dxf = "";

  // HEADER
  dxf += dxfPair(0, "SECTION") + dxfPair(2, "HEADER");
  dxf += dxfPair(9, "$ACADVER") + dxfPair(1, "AC1009");
  dxf += dxfPair(0, "ENDSEC");

  // TABLES
  dxf += dxfPair(0, "SECTION") + dxfPair(2, "TABLES");
  dxf += dxfPair(0, "TABLE") + dxfPair(2, "LAYER") + dxfPair(70, 2);
  dxf += dxfPair(0, "LAYER") + dxfPair(2, "CONTROL_POINTS") + dxfPair(70, 0) + dxfPair(62, 7) + dxfPair(6, "CONTINUOUS");
  dxf += dxfPair(0, "LAYER") + dxfPair(2, "POINT_LABELS") + dxfPair(70, 0) + dxfPair(62, 3) + dxfPair(6, "CONTINUOUS");
  dxf += dxfPair(0, "ENDTAB") + dxfPair(0, "ENDSEC");

  // BLOCKS: تعريف البلوك + ATTDEF لكل حقل
  dxf += dxfPair(0, "SECTION") + dxfPair(2, "BLOCKS");
  dxf += dxfPair(0, "BLOCK") + dxfPair(8, "0") + dxfPair(2, BLOCK_NAME) + dxfPair(70, 2);
  dxf += dxfPair(10, 0) + dxfPair(20, 0) + dxfPair(30, 0) + dxfPair(3, BLOCK_NAME) + dxfPair(1, "");
  DXF_FIELDS.forEach((f, i) => {
    dxf += dxfPair(0, "ATTDEF") + dxfPair(8, "POINT_LABELS");
    dxf += dxfPair(10, 0.5) + dxfPair(20, 0.5 - i * TEXT_H * 1.5) + dxfPair(30, 0);
    dxf += dxfPair(40, TEXT_H) + dxfPair(1, "") + dxfPair(2, f.tag) + dxfPair(3, f.label);
    dxf += dxfPair(70, f.visible ? 0 : 1);
  });
  dxf += dxfPair(0, "ENDBLK") + dxfPair(8, "0");
  dxf += dxfPair(0, "ENDSEC");

  // ENTITIES
  dxf += dxfPair(0, "SECTION") + dxfPair(2, "ENTITIES");

  for (const [index, item] of data.entries()) {
    const sourceCRS = normalizeCRS(item.crs);
    await loadCRSDefinition(sourceCRS);

    let easting = Number(item.easting);
    let northing = Number(item.northing);
    const elevation = Number(item.elevation ?? 0);

    if (sourceCRS !== outputCRS) {
      [easting, northing] = proj4(sourceCRS, outputCRS, [easting, northing]);
    }
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      throw new Error(`تعذر تحويل إحداثيات النقطة ${item.name || ""}.`);
    }

    const values = {
      NAME: dxfText(item.name ?? index + 1),
      CODE: dxfText(item.code),
      EASTING: easting.toFixed(precision),
      NORTHING: northing.toFixed(precision),
      ELEVATION: elevation.toFixed(4),
      TYPE: dxfText(item.type),
      STATUS: dxfText(item.status),
      CRS: outputCRS,
    };

    // البلوك + الحقول (ATTRIB) — الـ 66=1 تعني "بعدها ATTRIB"
    dxf += dxfPair(0, "INSERT") + dxfPair(8, "CONTROL_POINTS") + dxfPair(66, 1) + dxfPair(2, BLOCK_NAME);
    dxf += dxfPair(10, easting) + dxfPair(20, northing) + dxfPair(30, elevation);

    DXF_FIELDS.forEach((f, i) => {
      dxf += dxfPair(0, "ATTRIB") + dxfPair(8, "POINT_LABELS");
      dxf += dxfPair(10, easting + 0.5) + dxfPair(20, northing + 0.5 - i * TEXT_H * 1.5) + dxfPair(30, elevation);
      dxf += dxfPair(40, TEXT_H) + dxfPair(1, values[f.tag]) + dxfPair(2, f.tag);
      dxf += dxfPair(70, f.visible ? 0 : 1);
    });
    dxf += dxfPair(0, "SEQEND") + dxfPair(8, "CONTROL_POINTS");
  }

  dxf += dxfPair(0, "ENDSEC") + dxfPair(0, "EOF");

  downloadTextFile(
    dxf,
    `survey-control-points-${outputCRS.replace(":", "-")}.dxf`,
    "application/dxf;charset=utf-8",
    false
  );
}

export async function downloadGeoJson(data = []) {
  const geojson = await exportToGeoJson(data);
  const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/geo+json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "survey-control-points.geojson";
  document.body.appendChild(link);
  link.click();

  link.remove();
  URL.revokeObjectURL(url);
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



function setToolActive(buttonId, isActive) {
  const button = document.getElementById(buttonId);
  if (!button) return;

  button.classList.toggle("is-active", isActive);
  button.setAttribute("aria-pressed", String(isActive));
}

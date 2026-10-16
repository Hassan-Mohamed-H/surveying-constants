// نظام ألوان مشترك للملخص وعلامات الخريطة.
// القيم المعروفة لها ألوان ثابتة، والقيم الجديدة تحصل على لون مميز محفوظ محليًا.
const TYPE_FIXED = [
  ["control point (temp)", "#A855F7"], ["control point(temp)", "#A855F7"], ["مؤقت", "#A855F7"],
  ["control point (traverse)", "#F97316"], ["control point(traverse)", "#F97316"],
  ["control point", "#2563EB"], ["نقطة تحكم", "#2563EB"],
  ["traverse", "#14B8A6"], ["ترافيرس", "#14B8A6"], ["مضلع", "#14B8A6"],
  ["bench mark", "#EAB308"], ["روبير", "#EAB308"], ["ميزان", "#EAB308"],
  ["gps point", "#EC4899"], ["gps", "#EC4899"]
];
const STATUS_FIXED = [
  ["not active", "#EF4444"], ["inactive", "#EF4444"], ["غير فعال", "#EF4444"], ["غير نشط", "#EF4444"], ["غير نشطة", "#EF4444"],
  ["active", "#22C55E"], ["نشط", "#22C55E"], ["فعال", "#22C55E"],
  ["maintenance", "#F97316"], ["صيانة", "#F97316"],
  ["غير محدد", "#94A3B8"], ["unknown", "#94A3B8"]
];
const colorMemory = new Map();
const GLOBAL_COLOR_STORAGE_KEY = "survey-gis-global-colors-v1";

function readGlobalColors() {
  try {
    return JSON.parse(
      localStorage.getItem(GLOBAL_COLOR_STORAGE_KEY) || "{}"
    ) || {};
  } catch {
    return colorMemory.get(GLOBAL_COLOR_STORAGE_KEY) || {};
  }
}

function saveGlobalColors(colors) {
  colorMemory.set(GLOBAL_COLOR_STORAGE_KEY, colors);

  try {
    localStorage.setItem(
      GLOBAL_COLOR_STORAGE_KEY,
      JSON.stringify(colors)
    );
  } catch {
    // يظل النظام يعمل خلال الجلسة إذا تعذر التخزين.
  }
}
const normColorKey = value => String(value ?? "").trim().toLocaleLowerCase();

function lookupFixedColor(value, entries) {
  const key = normColorKey(value);
  if (!key) return null;
  // أطول قيمة أولًا: حتى لا تتداخل Not Active مع Active، أو TEMP مع Control Point.
  const found = [...entries].sort((a, b) => b[0].length - a[0].length)
    .find(([label]) => key === label || key.includes(label));
  return found ? found[1] : null;
}
function hueOf(color) {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return null;
  const n = parseInt(m[1], 16), r=((n>>16)&255)/255, g=((n>>8)&255)/255, b=(n&255)/255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
  if (!d) return null;
  let h = max===r ? ((g-b)/d)%6 : max===g ? (b-r)/d+2 : (r-g)/d+4;
  return (h*60+360)%360;
}
function readColors(key) {
  try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; }
  catch { return colorMemory.get(key) || {}; }
}
function saveColors(key, colors) {
  colorMemory.set(key, colors);
  try { localStorage.setItem(key, JSON.stringify(colors)); } catch { /* يعمل طوال الجلسة إن تعذر التخزين */ }
}
function dynamicColor(value, category, fixedEntries) {
  const key = normColorKey(value);
  const colors = readGlobalColors();

  const registryKey = `${category}:${key}`;

  if (colors[registryKey]) {
    return colors[registryKey];
  }

  // حجز ألوان Active وNo Active وجميع الألوان الثابتة.
  const fixedColors = [
    "#22C55E", // Active
    "#EF4444", // No Active
    "#94A3B8", // غير محدد
    ...TYPE_FIXED.map(([, color]) => color),
    ...STATUS_FIXED.map(([, color]) => color)
  ];

  const occupied = [
    ...fixedColors.map(hueOf).filter(h => h !== null),
    ...Object.values(colors).map(hueOf).filter(h => h !== null)
  ];

  let bestHue = 0;
  let bestDistance = -1;

  let seed = 0;
  for (const ch of registryKey) {
    seed = (seed * 31 + ch.charCodeAt(0)) % 360;
  }

  for (let hue = 0; hue < 360; hue += 1) {
    const distance = occupied.length
      ? Math.min(
          ...occupied.map(old => {
            const d = Math.abs(hue - old);
            return Math.min(d, 360 - d);
          })
        )
      : 180;

    const tieBreak =
      (1 - Math.abs(hue - seed) / 360) * 0.0001;

    const score = distance + tieBreak;

    if (score > bestDistance) {
      bestDistance = score;
      bestHue = hue;
    }
  }

  const color = `hsl(${bestHue} 78% 52%)`;

  colors[registryKey] = color;
  saveGlobalColors(colors);

  return color;
}
export function getTypeColor(type) {
  const key = normColorKey(type);
  if (!key || key === "غير محدد") return "#64748B";
  return lookupFixedColor(key, TYPE_FIXED) || dynamicColor(key, "type", TYPE_FIXED);
}
export function getStatusColor(status) {
  const key = normColorKey(status);

  if (
    key === "active" ||
    key === "نشط" ||
    key === "فعال"
  ) {
    return "#22C55E";
  }

  if (
    key === "no active" ||
    key === "not active" ||
    key === "inactive" ||
    key === "غير فعال" ||
    key === "غير نشط" ||
    key === "غير نشطة"
  ) {
    return "#EF4444";
  }

  if (!key || key === "غير محدد" || key === "unknown") {
    return "#94A3B8";
  }

  return lookupFixedColor(key, STATUS_FIXED)
    || dynamicColor(key, "status", STATUS_FIXED);
}
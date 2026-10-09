
function normalize(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

// استخراج القيم الفريدة من بيانات النقاط
export function getFilterOptions(items = []) {
  const uniqueValues = (key) => [
    ...new Set(
      items
        .map((item) => String(item[key] ?? "").trim())
        .filter(Boolean)
    ),
  ].sort((a, b) => a.localeCompare(b, "ar"));

  return {
    types: uniqueValues("type"),
    statuses: uniqueValues("status"),
    crsList: uniqueValues("crs"),
  };
}

// تطبيق الفلاتر حسب النوع والحالة ونظام الإحداثيات
export function filterSurveyPoints(
  items = [],
  filters = {}
) {
  const {
    types = [],
    statuses = [],
    crsList = [],
    keyword = "",
  } = filters;

  const selectedTypes = new Set(types);
  const selectedStatuses = new Set(statuses);
  const selectedCRS = new Set(crsList);
  const query = normalize(keyword);

  return items.filter((item) => {
    const type = String(item.type ?? "").trim();
    const status = String(item.status ?? "").trim();
    const crs = String(item.crs ?? "").trim();

    if (selectedTypes.size && !selectedTypes.has(type)) {
      return false;
    }

    if (
      selectedStatuses.size &&
      !selectedStatuses.has(status)
    ) {
      return false;
    }

    if (selectedCRS.size && !selectedCRS.has(crs)) {
      return false;
    }

    if (query) {
      const searchable = normalize([
        item.name,
        item.code,
        item.description,
        item.type,
        item.status,
        item.crs,
        item.northing,
        item.easting,
        item.elevation,
      ].join(" "));

      if (!searchable.includes(query)) {
        return false;
      }
    }

    return true;
  });
}

// حساب عدد النقاط حسب أي حقل
export function getSurveyPointCounts(
  items = [],
  field = "type"
) {
  return items.reduce((counts, item) => {
    const value = String(item[field] ?? "").trim() || "غير محدد";
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

// الاحتفاظ بالدوال القديمة للتوافق مع أي ملفات أخرى
export function getCategories(items = []) {
  const unique = new Set(
    items.map((item) => item.category || "غير مصنف")
  );

  return [...unique].sort((a, b) => a.localeCompare(b, "ar"));
}

export function filterByCategories(items, selectedCategories) {
  if (!selectedCategories.size) return items;

  return items.filter((item) =>
    selectedCategories.has(item.category)
  );
}

export function searchItems(items, keyword) {
  const query = normalize(keyword);
  if (!query) return items;

  return items.filter((item) => {
    const searchable = normalize([
      item.name,
      item.code,
      item.description,
      item.type,
      item.status,
      item.crs,
    ].join(" "));

    return searchable.includes(query);
  });
}

export function getCategoryCounts(items = []) {
  return items.reduce((counts, item) => {
    const category = item.category || "غير مصنف";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
}

export function classifyHeritageType(category = "") {
  const value = normalize(category);

  if (value.includes("لامادي") || value.includes("غير مادي")) {
    return "intangible";
  }

  return "tangible";
}

export function filterByLayerVisibility(
  items,
  showTangible,
  showIntangible
) {
  return items.filter((item) => {
    if (item.heritageType === "intangible") {
      return showIntangible;
    }

    return showTangible;
  });
}

export function getSuggestions(items, keyword, limit = 8) {
  const query = normalize(keyword);
  if (!query) return [];

  return items
    .map((item) => {
      const searchable = normalize([
        item.name,
        item.code,
        item.description,
        item.type,
        item.status,
        item.crs,
      ].join(" "));

      return {
        item,
        score: searchable.includes(query)
          ? 0
          : levenshtein(searchable, query) + 2,
      };
    })
    .filter((entry) => entry.score <= 4)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from(
    { length: b.length + 1 },
    (_, i) => [i]
  );

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;

      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

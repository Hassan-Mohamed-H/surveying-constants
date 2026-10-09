const CELL_SIZE_DEG = 0.08;

function getKey(lat, lng) {
  const y = Math.floor(lat / CELL_SIZE_DEG);
  const x = Math.floor(lng / CELL_SIZE_DEG);
  return `${y}:${x}`;
}

export function createSpatialIndex(items) {
  const grid = new Map();
  items.forEach((item) => {
    const key = getKey(item.lat, item.lng);
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(item);
  });
  return {
    items,
    grid
  };
}

export function queryNearest(index, latlng, distanceFn) {
  if (!index || !index.items.length) return null;
  const centerLat = latlng.lat;
  const centerLng = latlng.lng;
  const y = Math.floor(centerLat / CELL_SIZE_DEG);
  const x = Math.floor(centerLng / CELL_SIZE_DEG);

  let nearest = null;
  let minDistance = Number.POSITIVE_INFINITY;
  let ring = 0;
  const maxRing = 8;

  while (ring <= maxRing) {
    let candidates = 0;
    for (let iy = y - ring; iy <= y + ring; iy += 1) {
      for (let ix = x - ring; ix <= x + ring; ix += 1) {
        if (ring > 0 && iy > y - ring && iy < y + ring && ix > x - ring && ix < x + ring) continue;
        const bucket = index.grid.get(`${iy}:${ix}`);
        if (!bucket) continue;
        candidates += bucket.length;
        bucket.forEach((item) => {
          const dist = distanceFn(centerLat, centerLng, item.lat, item.lng);
          if (dist < minDistance) {
            minDistance = dist;
            nearest = item;
          }
        });
      }
    }
    if (nearest && candidates > 0) break;
    ring += 1;
  }

  if (!nearest) {
    index.items.forEach((item) => {
      const dist = distanceFn(centerLat, centerLng, item.lat, item.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = item;
      }
    });
  }
  return nearest ? { item: nearest, distance: minDistance } : null;
}

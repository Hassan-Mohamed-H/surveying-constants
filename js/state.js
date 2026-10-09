export function createAppState() {
  return {
    allData: [],
    filteredData: [],
    selectedCategories: new Set(),
    layerState: { tangible: true, intangible: true, heatmap: false },
    spatialIndex: null
  };
}

export function setData(state, data) {
  state.allData = data;
  state.filteredData = [...data];
}

export function updateFilteredData(state, items) {
  state.filteredData = items;
}

export function setSpatialIndex(state, index) {
  state.spatialIndex = index;
}

// ===============================
// Debounce
// ===============================

export function debounce(fn, wait = 220) {
  let timer = null;

  return (...args) => {
    window.clearTimeout(timer);

    timer = window.setTimeout(() => {
      fn(...args);
    }, wait);
  };
}

// ===============================
// Schedule Animation Frame
// ===============================

export function scheduleFrame(fn) {
  let rafId = 0;

  return (...args) => {
    if (rafId) {
      window.cancelAnimationFrame(rafId);
    }

    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      fn(...args);
    });
  };
}

// ===============================
// Batch Processor
// ===============================

export function createBatchProcessor(batchSize = 250) {
  // دعم الاستدعاء بالشكل القديم:
  // createBatchProcessor(350)
  //
  // ودعم الاستدعاء بالشكل:
  // createBatchProcessor(items, handler, onDone)

  if (Array.isArray(batchSize)) {
    const items = batchSize;
    const handler = arguments[1];
    const onDone = arguments[2];

    return processBatch(items, handler, onDone, 250);
  }

  const size =
    Number.isFinite(Number(batchSize)) &&
    Number(batchSize) > 0
      ? Math.floor(Number(batchSize))
      : 250;

  return function process(items, handler, onDone) {
    return processBatch(items, handler, onDone, size);
  };
}

// ===============================
// Process Batch
// ===============================

function processBatch(items, handler, onDone, batchSize) {
  if (!Array.isArray(items)) {
    console.error(
      "Batch processor: items must be an array."
    );

    if (typeof onDone === "function") {
      onDone();
    }

    return;
  }

  if (typeof handler !== "function") {
    console.error(
      "Batch processor: handler must be a function."
    );

    if (typeof onDone === "function") {
      onDone();
    }

    return;
  }

  let index = 0;

  function step() {
    const end = Math.min(
      index + batchSize,
      items.length
    );

    for (let i = index; i < end; i += 1) {
      try {
        handler(items[i], i);
      } catch (error) {
        console.error(
          `Batch processor error at index ${i}:`,
          error
        );
      }
    }

    index = end;

    if (index < items.length) {
      window.requestAnimationFrame(step);
    } else if (typeof onDone === "function") {
      onDone();
    }
  }

  if (items.length === 0) {
    if (typeof onDone === "function") {
      onDone();
    }

    return;
  }

  step();
}
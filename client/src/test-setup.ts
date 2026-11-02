import "@testing-library/jest-dom/vitest";

if (!globalThis.IntersectionObserver) {
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return []; }
    },
  });
}

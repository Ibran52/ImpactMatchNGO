import { describe, expect, it } from "vitest";
import { distanceBetweenKm, readGeoPointCoordinates } from "./locationService.js";

describe("readGeoPointCoordinates", () => {
  it("returns valid GeoJSON point coordinates", () => {
    expect(readGeoPointCoordinates({ type: "Point", coordinates: [72.8777, 19.076] }))
      .toEqual([72.8777, 19.076]);
  });

  describe("distanceBetweenKm", () => {
    it("calculates a symmetric great-circle distance", () => {
      const east = distanceBetweenKm([0, 0], [1, 0]);
      const west = distanceBetweenKm([1, 0], [0, 0]);
      expect(east).toBeGreaterThan(111);
      expect(east).toBeLessThan(112);
      expect(west).toBeCloseTo(east, 8);
    });

    it("returns zero for the same point", () => {
      expect(distanceBetweenKm([72.97, 19.22], [72.97, 19.22])).toBe(0);
    });
  });

  it.each([
    undefined,
    null,
    {},
    { type: "LineString", coordinates: [72, 19] },
    { type: "Point", coordinates: [72] },
    { type: "Point", coordinates: ["72", "19"] },
    { type: "Point", coordinates: [181, 19] },
    { type: "Point", coordinates: [72, 91] },
  ])("ignores malformed GeoJSON points", (value) => {
    expect(readGeoPointCoordinates(value)).toBeUndefined();
  });
});

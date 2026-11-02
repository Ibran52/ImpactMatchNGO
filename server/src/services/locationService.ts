export function readGeoPointCoordinates(value: unknown): [number, number] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const point = value as { type?: unknown; coordinates?: unknown };
  const coordinates = point.coordinates;
  if (
    point.type !== "Point" ||
    !Array.isArray(coordinates) ||
    coordinates.length !== 2 ||
    typeof coordinates[0] !== "number" ||
    typeof coordinates[1] !== "number" ||
    !Number.isFinite(coordinates[0]) ||
    !Number.isFinite(coordinates[1]) ||
    Math.abs(coordinates[0]) > 180 ||
    Math.abs(coordinates[1]) > 90
  ) return undefined;
  return [coordinates[0], coordinates[1]];
}

export function distanceBetweenKm(
  first: [number, number],
  second: [number, number],
): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const [longitude1, latitude1] = first;
  const [longitude2, latitude2] = second;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const value = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) *
    Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

// Static presentation geometry: no timers, canvas, or playback state.
export const stars = Array.from({ length: 150 }, (_, index) => ({
  x: ((index * 743 + 83) % 1193) + 3,
  y: ((index * index * 37 + index * 211 + 19) % 797) + 2,
  radius: index % 17 === 0 ? 1.5 : index % 5 === 0 ? 0.95 : 0.55,
  opacity: 0.22 + ((index * 13) % 60) / 100
}));

// Follow the three vinyl quadrants and compass needle of the actual izci mark.
export const constellationArc = [
  [246, 88], [193, 100], [148, 126], [111, 174], [88, 246],
  [140, 246], [192, 246], [208, 214], [246, 192]
];

export const constellationNeedle = [
  [254, 191], [222, 200], [200, 223], [191, 254], [219, 254],
  [237, 221], [269, 220], [424, 76], [333, 255], [310, 297],
  [280, 317], [254, 321], [254, 293], [285, 281], [302, 259],
  [348, 168], [274, 237], [254, 228]
];

const planetCenter = 330;
const planetRadius = 284;
const latitudeRows = 12;
const longitudeColumns = 12;

function projectPlanet(latitude: number, longitude: number): string {
  const x = planetCenter + planetRadius * Math.cos(latitude) * Math.sin(longitude);
  const y = planetCenter - planetRadius * Math.sin(latitude);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

// Sample the curved edges of each tile on the visible hemisphere, rather than
// laying a flat checker pattern over a circle.
export const planetTiles = Array.from({ length: latitudeRows * longitudeColumns }, (_, index) => {
  const row = Math.floor(index / longitudeColumns);
  const column = index % longitudeColumns;
  const north = Math.PI / 2 - row * Math.PI / latitudeRows;
  const south = north - Math.PI / latitudeRows;
  const west = -Math.PI / 2 + column * Math.PI / longitudeColumns;
  const east = west + Math.PI / longitudeColumns;
  const points: string[] = [];

  for (let step = 0; step <= 4; step++) points.push(projectPlanet(north, west + (east - west) * step / 4));
  for (let step = 1; step <= 4; step++) points.push(projectPlanet(north + (south - north) * step / 4, east));
  for (let step = 1; step <= 4; step++) points.push(projectPlanet(south, east + (west - east) * step / 4));
  for (let step = 1; step < 4; step++) points.push(projectPlanet(south + (north - south) * step / 4, west));

  return { path: `M${points.join(' L')} Z`, light: (row + column) % 2 === 0 };
});

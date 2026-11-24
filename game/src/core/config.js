// Every tuning number for the core engine in one place, so later systems (police, missions,
// crew, audio) read the same values the city was built with.

/** Fixed simulation step in seconds: 60 updates a second whatever the display rate. */
export const STEP = 1 / 60;
/** Longest frame the loop catches up on; a longer stall (hidden tab) is dropped, not replayed. */
export const MAX_FRAME = 0.25;

/** City grid: roads every CELL metres, ROAD wide; blocks fill the rest. */
export const CITY = {
  cols: 8,            // blocks west-east
  rows: 6,            // blocks north-south
  cell: 100,          // road centre to road centre
  road: 20,           // road width
  sidewalk: 4,        // sidewalk ring inside each block
  originX: -400,      // x of the westmost road centre
  originZ: -420,      // z of the northmost road centre
  beachDepth: 70,     // sand south of the last road
  seaDepth: 900,
};

export const PLAYER = {
  radius: 0.45,
  walk: 5.2,
  sprint: 9.5,
  accel: 40,
  height: 1.8,
  maxHealth: 100,
  enterRange: 4.2,
};

export const CAR = {
  length: 4.4,
  width: 2.0,
  maxSpeed: 38,       // m/s forward (~137 km/h)
  maxReverse: 9,
  accel: 16,
  brake: 30,
  drag: 0.35,
  rolling: 2.2,
  steer: 2.3,         // rad/s at low speed
  grip: 7.5,          // lateral damping
  handbrakeGrip: 1.6,
  circleRadius: 1.05, // two collision circles along the body
  circleOffset: 1.25,
};

export const TRAFFIC = { count: 22, speedMin: 9, speedMax: 13, lane: 4.5, stopGap: 9 };
export const PEDS = { count: 34, speed: 1.6 };
export const PARKED = { count: 14 };

/** Late-afternoon palette shared by sky, fog, lights and minimap: soft blue sky, warm sun low
 *  over the sea, grey asphalt, pale stucco, golden sand. */
export const PALETTE = {
  skyTop: 0x3a72c4,
  skyMid: 0x8db6e4,
  horizon: 0xffd6a6,
  sun: 0xfff0cc,
  fog: 0xe9d5bd,
  asphalt: 0x71747c,
  sidewalk: 0xc2bbb1,
  sand: 0xf0d6a2,
  sea: 0x2493b0,
  neon: [0xff3d8b, 0x2de2e6, 0xffb347, 0xb44dff, 0x7dffa1],
  carColors: [0xd7263d, 0xf46036, 0x2de2e6, 0x1b998b, 0xc5d86d, 0xf2f2f2, 0xff3d8b, 0x3a86ff, 0xffbe0b, 0x8338ec],
  buildingColors: [0xe9d6c1, 0xd9b8a0, 0xc49a8a, 0x9fa8c2, 0xf0e2d0, 0xb7c4cf, 0xd7a9b5, 0x8f9bb3],
};

/** District names by grid region (original names, no real-world IP). */
export const DISTRICTS = [
  { name: 'PALMA HEIGHTS', minCol: 0, maxCol: 3, minRow: 0, maxRow: 2 },
  { name: 'NEON MILE', minCol: 4, maxCol: 7, minRow: 0, maxRow: 2 },
  { name: 'OLD HARBOR', minCol: 0, maxCol: 3, minRow: 3, maxRow: 5 },
  { name: 'VELA BEACH', minCol: 4, maxCol: 7, minRow: 3, maxRow: 5 },
];

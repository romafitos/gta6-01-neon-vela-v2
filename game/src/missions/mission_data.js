// The Neon Vela story: ten staged missions, one data table. The mission runner (missions.js)
// reads this and nothing here runs code. Places are given on the road grid so they survive any
// city seed: [i, j, dx, dz] = intersection (roadX[i], roadZ[j]) plus an offset in metres.
//   i 0..8 west→east, j 0..6 north→south. Districts: Palma Heights (NW), Neon Mile (NE),
//   Old Harbor (SW), Vela Beach (SE, the player's start). 'beach' offsets go south of row 6.
//
// Stage types and their fields:
//   goto     to, radius, inCar, timer, carHealth (min health of the car on arrival)
//   grab     at, seconds (stay inside radius on foot), stars (wanted level set when grabbed)
//   kill     at, crew, count, boss {health}, smg            (everyone tagged must die)
//   waves    at, crew, waves [n, n, ...], radius            (leave the turf = fail)
//   chase    from, cruise, escape (distance that loses it) (wreck the target car)
//   tail     from, cruise, seconds, min, max                (stay between min and max)
//   convoy   from, count, need, health, cruise             (wreck `need` of the armoured vans)
//   evade    stars (set at stage start if higher)          (lose the wanted level)

export const MISSIONS = [
  {
    id: 'm1', name: 'Sunset Pickup', district: 'VELA BEACH', giver: 'Marisol Reyes', type: 'escort / getaway',
    start: [5, 6, 20, 14],
    intro: 'Marisol: "Teo just walked out of county with nobody to drive him. Be that somebody."',
    stages: [
      { type: 'goto', label: 'Get a car', to: null, inCar: true, anyCar: true },
      { type: 'goto', label: 'Pick up Teo on Pier St', to: [7, 5, 12, 0], inCar: true, radius: 8 },
      { type: 'goto', label: 'Get Teo to the Coral safehouse before the heat finds him', to: [3, 5, 0, 14], inCar: true, radius: 9, timer: 95, stars: 1 },
    ],
    reward: { cash: 500, respect: 10 }, unlock: { text: 'Coral safehouse: armour restock', armor: 50 },
  },
  {
    id: 'm2', name: 'Neon Till', district: 'NEON MILE', giver: 'Teo Vance', type: 'robbery / heist',
    start: [6, 2, 14, 13],
    intro: 'Teo: "The Lumen Mart on Mango St keeps the week\'s take in the back till. In and out."',
    stages: [
      { type: 'goto', label: 'Walk into the Lumen Mart', to: [6, 1, 13, 13], radius: 4 },
      { type: 'grab', label: 'Empty the till', at: [6, 1, 13, 13], seconds: 4, radius: 5, stars: 2 },
      { type: 'evade', label: 'Lose the cops', stars: 2 },
    ],
    reward: { cash: 1200, respect: 15 }, unlock: { text: 'Hornet SMG ammo crate', ammo: true },
  },
  {
    id: 'm3', name: 'Harbor Rat', district: 'OLD HARBOR', giver: 'Marisol Reyes', type: 'car chase / takedown',
    start: [2, 4, 13, 13],
    intro: 'Marisol: "Somebody sold Teo\'s name to the Saltjaw. He drives a gold coupe. Stop him."',
    stages: [
      { type: 'goto', label: 'Get a car', inCar: true, anyCar: true },
      { type: 'chase', label: 'Take down the informant\'s coupe', from: [1, 4, 0, 30], cruise: 19, escape: 240 },
    ],
    reward: { cash: 900, respect: 15 }, unlock: { text: 'Old Harbor contacts' },
  },
  {
    id: 'm4', name: 'Quiet Wheels', district: 'PALMA HEIGHTS', giver: 'Teo Vance', type: 'stealth tail',
    start: [2, 2, 13, 13],
    intro: 'Teo: "The Ember Kings\' courier does his rounds at sunset. Follow him, don\'t spook him."',
    stages: [
      { type: 'goto', label: 'Get a car', inCar: true, anyCar: true },
      { type: 'tail', label: 'Tail the courier — not too close', from: [1, 1, 0, 30], cruise: 11, seconds: 40, min: 7, max: 70 },
      { type: 'goto', label: 'Report the stash house to Teo', to: [2, 2, 13, 13], radius: 8 },
    ],
    reward: { cash: 800, respect: 12 }, unlock: { text: 'Ember Kings stash location' },
  },
  {
    id: 'm5', name: 'Dockside Turf', district: 'OLD HARBOR', giver: 'Marisol Reyes', type: 'turf defense',
    start: [1, 5, 13, -13],
    intro: 'Marisol: "The Saltjaw want the fish market back. Hold the yard."',
    stages: [
      { type: 'goto', label: 'Get to the fish market yard', to: [1, 5, 30, -30], radius: 10 },
      { type: 'waves', label: 'Hold the yard', at: [1, 5, 30, -30], crew: 'saltjaw', waves: [3, 3, 4], radius: 42 },
    ],
    reward: { cash: 1500, respect: 25 }, unlock: { text: 'Fish market: health and armour', armor: 75 },
  },
  {
    id: 'm6', name: 'Hot Cargo', district: 'NEON MILE', giver: 'Teo Vance', type: 'timed delivery',
    start: [5, 1, 13, 13],
    intro: 'Teo: "Twelve cases of somebody else\'s champagne. The buyer leaves the beach in 80 seconds."',
    stages: [
      { type: 'goto', label: 'Get a car', inCar: true, anyCar: true },
      { type: 'goto', label: 'Deliver the cargo to the beach buyer — keep the car in one piece', to: [6, 6, 0, 30], inCar: true, radius: 10, timer: 80, carHealth: 30 },
    ],
    reward: { cash: 1000, respect: 15 }, unlock: { text: 'Beach buyer: cash bonus' },
  },
  {
    id: 'm7', name: 'Armored Tide', district: 'PALMA HEIGHTS', giver: 'Marisol Reyes', type: 'convoy ambush',
    start: [3, 1, 13, 13],
    intro: 'Marisol: "Three armoured vans move the Ember Kings\' money up Sunset Ave. Two of them is enough."',
    stages: [
      { type: 'goto', label: 'Get armed and get to Sunset Ave', to: [3, 1, 0, 14], radius: 12 },
      { type: 'convoy', label: 'Wreck the armoured vans', from: [3, 0, 0, 30], count: 3, need: 2, health: 220, cruise: 12 },
      { type: 'evade', label: 'Lose the cops', stars: 3 },
    ],
    reward: { cash: 2000, respect: 25 }, unlock: { text: 'Marlin Carbine ammo crate', ammo: true },
  },
  {
    id: 'm8', name: 'The Pier Contract', district: 'VELA BEACH', giver: 'Teo Vance', type: 'assassination on foot',
    start: [7, 6, -13, -13],
    intro: 'Teo: "Dante Kell runs the Ember Kings from a cabana on the sand. Three guards. End it."',
    stages: [
      { type: 'goto', label: 'Reach Kell\'s cabana on foot', to: [7, 6, 0, 40], radius: 14, onFoot: true },
      { type: 'kill', label: 'Take out Dante Kell and his guards', at: [7, 6, 0, 44], crew: 'ember', count: 3, boss: { health: 160 } },
      { type: 'evade', label: 'Get clear of the cops', stars: 2 },
    ],
    reward: { cash: 1800, respect: 20 }, unlock: { text: 'Neon Mile respect' },
  },
  {
    id: 'm9', name: 'Bonfire Standoff', district: 'VELA BEACH', giver: 'Marisol Reyes', type: 'beach set piece',
    start: [4, 6, 13, -13],
    intro: 'Marisol: "The Saltjaw buried their guns under the lifeguard tower. Dig them up, then run."',
    stages: [
      { type: 'goto', label: 'Reach the lifeguard tower', to: [3, 6, 10, 38], radius: 9 },
      { type: 'grab', label: 'Dig up the stash', at: [3, 6, 10, 38], seconds: 3, radius: 6 },
      { type: 'kill', label: 'Saltjaw ambush on the sand — fight', at: [3, 6, 30, 36], crew: 'saltjaw', count: 5, smg: true },
      { type: 'goto', label: 'Drive the stash to Marisol', to: [4, 6, 13, -13], inCar: true, anyCar: true, radius: 9 },
    ],
    reward: { cash: 1600, respect: 20 }, unlock: { text: 'Lifeguard tower stash: full ammo', ammo: true, armor: 100 },
  },
  {
    id: 'm10', name: 'King of the Coast', district: 'NEON MILE', giver: 'Marisol & Teo', type: 'finale: dispatch + air unit',
    start: [7, 1, -13, 13],
    intro: 'Marisol: "The Saltjaw ledger names every cop they own. Take it from the Vista tower and the city is ours."',
    stages: [
      { type: 'goto', label: 'Get to the Vista tower lobby', to: [7, 0, -13, 13], radius: 6 },
      { type: 'kill', label: 'Clear the ledger room', at: [7, 0, -20, 16], crew: 'saltjaw', count: 4, smg: true },
      { type: 'grab', label: 'Take the ledger', at: [7, 0, -13, 13], seconds: 3, radius: 6, stars: 4 },
      { type: 'goto', label: 'Run the ledger to the Coral safehouse — Kestrel 7 is overhead', to: [3, 5, 0, 14], radius: 9, stars: 4 },
      { type: 'evade', label: 'Shake the whole city off your back', stars: 4 },
    ],
    reward: { cash: 5000, respect: 50 }, unlock: { text: 'Vela City is yours — free roam with the crew' },
  },
];

/** Named respect ranks, used by the HUD and the mission log. */
export const RANKS = [
  { at: 0, name: 'Nobody' },
  { at: 20, name: 'Street Runner' },
  { at: 50, name: 'Hustler' },
  { at: 90, name: 'Enforcer' },
  { at: 140, name: 'Lieutenant' },
  { at: 207, name: 'King of the Coast' },
];

export function rankFor(respect) {
  let r = RANKS[0];
  for (const k of RANKS) if (respect >= k.at) r = k;
  return r;
}

// Builds the static world: collision index, the city layout, its meshes and the golden-hour sky.
import { createCollision } from './collision.js';
import { createLayout } from './layout.js';
import { createCityMeshes } from './city_meshes.js';
import { createSky } from './sky.js';

export function createWorld(scene, random) {
  const collision = createCollision();
  const layout = createLayout(random, collision);
  const world = { collision, layout };
  world.sky = createSky(scene);
  world.city = createCityMeshes(scene, layout, random);
  return world;
}

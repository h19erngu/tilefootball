import {
  BufferGeometry,
  CircleGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  TorusGeometry,
} from 'three';

export const FIELD_PATCHES_X = 9;
export const FIELD_PATCHES_Y = 5;
export const PATCH_SIZE = 3;
export const FIELD_TILES_X = FIELD_PATCHES_X * PATCH_SIZE;
export const FIELD_TILES_Y = FIELD_PATCHES_Y * PATCH_SIZE;
export const TILE_SIZE = 1;
export const WALKABLE_MARGIN_TILES = 2;
export const WALKABLE_TILES_X = FIELD_TILES_X + WALKABLE_MARGIN_TILES * 2;
export const WALKABLE_TILES_Y = FIELD_TILES_Y + WALKABLE_MARGIN_TILES * 2;
export const FIELD_WORLD_WIDTH = FIELD_TILES_Y * TILE_SIZE;
export const FIELD_WORLD_DEPTH = FIELD_TILES_X * TILE_SIZE;
export const FIELD_WORLD_PATCHES_X = FIELD_PATCHES_Y;
export const FIELD_WORLD_PATCHES_Y = FIELD_PATCHES_X;

const PITCH_COLOR = '#3d9b63';
const PATCH_LIGHT = '#4ca93a';
const PATCH_DARK = '#3d8f31';
const SUBGRID_COLOR = '#dff5be';
const PATCH_BORDER_COLOR = '#18310f';
const LINE_COLOR = '#f8fafc';

export type TileCoordinate = {
  x: number;
  z: number;
};

export type TileDirection = {
  x: -1 | 0 | 1;
  z: -1 | 0 | 1;
};

export type WorldPosition = {
  x: number;
  z: number;
};

export type PitchBounds = {
  columns: number;
  rows: number;
};

export function createPitch() {
  const width = FIELD_WORLD_WIDTH;
  const depth = FIELD_WORLD_DEPTH;

  const root = new Group();
  const surface = new Mesh(
    new PlaneGeometry(width, depth),
    new MeshStandardMaterial({
      color: PITCH_COLOR,
      side: DoubleSide,
    }),
  );

  surface.name = 'pitch-surface';
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 0.02;

  const patches = createPatchSurface(width, depth);
  const markings = createPitchMarkings(width, depth);
  const logicalGrid = createLogicalGrid(width, depth);
  logicalGrid.position.y = 0.028;

  const patchGrid = createPatchGrid(width, depth);
  patchGrid.position.y = 0.032;

  root.add(surface, patches, markings, logicalGrid, patchGrid);

  return {
    root,
    surface,
    width,
    depth,
  };
}

export function worldPositionToTileCoordinate(
  x: number,
  z: number,
): TileCoordinate | null {
  const halfWidth = FIELD_WORLD_WIDTH / 2;
  const halfDepth = FIELD_WORLD_DEPTH / 2;

  if (x < -halfWidth || x > halfWidth || z < -halfDepth || z > halfDepth) {
    return null;
  }

  const tileZ = clamp(
    Math.floor((x + halfWidth) / TILE_SIZE),
    0,
    FIELD_TILES_Y - 1,
  );
  const tileX = clamp(
    Math.floor((z + halfDepth) / TILE_SIZE),
    0,
    FIELD_TILES_X - 1,
  );

  return { x: tileX, z: tileZ };
}

export function worldPositionToExtendedTileCoordinate(
  x: number,
  z: number,
): TileCoordinate {
  const halfWidth = FIELD_WORLD_WIDTH / 2;
  const halfDepth = FIELD_WORLD_DEPTH / 2;

  return {
    x: Math.floor((z + halfDepth) / TILE_SIZE),
    z: Math.floor((x + halfWidth) / TILE_SIZE),
  };
}

export function tileCoordinateToWorldPosition(
  tile: TileCoordinate,
): WorldPosition {
  const halfWidth = FIELD_WORLD_WIDTH / 2;
  const halfDepth = FIELD_WORLD_DEPTH / 2;

  return {
    x: -halfWidth + tile.z * TILE_SIZE + TILE_SIZE / 2,
    z: -halfDepth + tile.x * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function areTilesEqual(a: TileCoordinate, b: TileCoordinate): boolean {
  return a.x === b.x && a.z === b.z;
}

export function isTileInBounds(
  tile: TileCoordinate,
  bounds: PitchBounds = { columns: WALKABLE_TILES_X, rows: WALKABLE_TILES_Y },
): boolean {
  const minX = -Math.floor((bounds.columns - FIELD_TILES_X) / 2);
  const minZ = -Math.floor((bounds.rows - FIELD_TILES_Y) / 2);
  const maxX = minX + bounds.columns;
  const maxZ = minZ + bounds.rows;

  return (
    tile.x >= minX &&
    tile.x < maxX &&
    tile.z >= minZ &&
    tile.z < maxZ
  );
}

export function isOrthogonallyAdjacent(
  a: TileCoordinate,
  b: TileCoordinate,
): boolean {
  return !areTilesEqual(a, b) && getOrthogonalDistance(a, b) === 1;
}

export function isStraightOrthogonalLine(...tiles: TileCoordinate[]): boolean {
  if (tiles.length < 2) {
    return false;
  }

  const referenceDirection = getNormalizedDirection(tiles[0], tiles[1]);

  if (!referenceDirection) {
    return false;
  }

  return tiles.slice(1).every((tile) => {
    const direction = getNormalizedDirection(tiles[0], tile);

    if (!direction) {
      return false;
    }

    return (
      direction.x === referenceDirection.x &&
      direction.z === referenceDirection.z
    );
  });
}

export function getOrthogonalDistance(
  a: TileCoordinate,
  b: TileCoordinate,
): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export function getDirectionBetweenTiles(
  from: TileCoordinate,
  to: TileCoordinate,
): TileDirection | null {
  return getNormalizedDirection(from, to);
}

export function addDirectionToTile(
  tile: TileCoordinate,
  direction: TileDirection,
): TileCoordinate {
  return {
    x: tile.x + direction.x,
    z: tile.z + direction.z,
  };
}

export function getNextTile(
  tile: TileCoordinate,
  direction: TileDirection,
): TileCoordinate {
  return addDirectionToTile(tile, direction);
}

export function getTileDirection(
  from: TileCoordinate,
  to: TileCoordinate,
): TileDirection | null {
  return getNormalizedDirection(from, to);
}

export function getFacingAngleForTileStep(
  from: TileCoordinate,
  to: TileCoordinate,
): number | null {
  const direction = getTileDirection(from, to);

  if (!direction) {
    return null;
  }

  return getFacingAngleForDirection(direction);
}

export function getFacingAngleForDirection(direction: TileDirection): number {
  return Math.atan2(direction.z, direction.x);
}

export function getTilesBetweenInclusive(
  from: TileCoordinate,
  to: TileCoordinate,
): TileCoordinate[] {
  const direction = getDirectionBetweenTiles(from, to);

  if (!direction) {
    return [];
  }

  const tiles: TileCoordinate[] = [{ ...from }];
  let current = { ...from };

  while (!areTilesEqual(current, to)) {
    current = getNextTile(current, direction);
    tiles.push(current);
  }

  return tiles;
}

function createPatchSurface(width: number, depth: number) {
  const group = new Group();
  const patchWidth = PATCH_SIZE * TILE_SIZE;
  const patchDepth = PATCH_SIZE * TILE_SIZE;

  for (let patchZ = 0; patchZ < FIELD_WORLD_PATCHES_Y; patchZ += 1) {
    for (let patchX = 0; patchX < FIELD_WORLD_PATCHES_X; patchX += 1) {
      const patch = new Mesh(
        new PlaneGeometry(patchWidth, patchDepth),
        new MeshStandardMaterial({
          color: (patchX + patchZ) % 2 === 0 ? PATCH_LIGHT : PATCH_DARK,
          side: DoubleSide,
          transparent: true,
          opacity: 0.5,
        }),
      );

      patch.rotation.x = -Math.PI / 2;
      patch.position.set(
        -width / 2 + patchWidth / 2 + patchX * patchWidth,
        0.021,
        -depth / 2 + patchDepth / 2 + patchZ * patchDepth,
      );

      group.add(patch);
    }
  }

  return group;
}

function createLogicalGrid(width: number, depth: number) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const vertices: number[] = [];

  for (let column = 0; column <= FIELD_TILES_Y; column += 1) {
    const x = -halfWidth + column * TILE_SIZE;
    vertices.push(x, 0, -halfDepth, x, 0, halfDepth);
  }

  for (let row = 0; row <= FIELD_TILES_X; row += 1) {
    const z = -halfDepth + row * TILE_SIZE;
    vertices.push(-halfWidth, 0, z, halfWidth, 0, z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: SUBGRID_COLOR,
      transparent: true,
      opacity: 0.18,
    }),
  );
}

function createPatchGrid(width: number, depth: number) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const vertices: number[] = [];

  for (let column = 0; column <= FIELD_TILES_Y; column += PATCH_SIZE) {
    const x = -halfWidth + column * TILE_SIZE;
    vertices.push(x, 0, -halfDepth, x, 0, halfDepth);
  }

  for (let row = 0; row <= FIELD_TILES_X; row += PATCH_SIZE) {
    const z = -halfDepth + row * TILE_SIZE;
    vertices.push(-halfWidth, 0, z, halfWidth, 0, z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: PATCH_BORDER_COLOR,
      transparent: true,
      opacity: 0.5,
    }),
  );
}

function createPitchMarkings(width: number, depth: number) {
  const group = new Group();
  const lineMaterial = new MeshStandardMaterial({
    color: LINE_COLOR,
    side: DoubleSide,
  });

  const outerLine = createLineRect(width, depth, 0.12, lineMaterial);
  outerLine.position.y = 0.03;

  const centerLine = new Mesh(new PlaneGeometry(width, 0.12), lineMaterial);
  centerLine.rotation.x = -Math.PI / 2;
  centerLine.position.set(0, 0.03, 0);

  const centerCircle = new Mesh(
    new TorusGeometry(2.2, 0.06, 10, 48),
    new MeshStandardMaterial({ color: LINE_COLOR }),
  );
  centerCircle.rotation.x = Math.PI / 2;
  centerCircle.position.set(0, 0.035, 0);

  const topBox = createLineRect(width * 0.56, depth * 0.18, 0.12, lineMaterial);
  topBox.position.set(0, 0.03, -depth / 2 + (depth * 0.18) / 2);

  const bottomBox = createLineRect(width * 0.56, depth * 0.18, 0.12, lineMaterial);
  bottomBox.position.set(0, 0.03, depth / 2 - (depth * 0.18) / 2);

  const topGoalBox = createLineRect(width * 0.32, depth * 0.09, 0.12, lineMaterial);
  topGoalBox.position.set(0, 0.03, -depth / 2 + (depth * 0.09) / 2);

  const bottomGoalBox = createLineRect(width * 0.32, depth * 0.09, 0.12, lineMaterial);
  bottomGoalBox.position.set(0, 0.03, depth / 2 - (depth * 0.09) / 2);

  const topSpot = createSpot();
  topSpot.position.set(0, 0.031, -depth / 2 + depth * 0.13);

  const bottomSpot = createSpot();
  bottomSpot.position.set(0, 0.031, depth / 2 - depth * 0.13);

  group.add(
    outerLine,
    centerLine,
    centerCircle,
    topBox,
    bottomBox,
    topGoalBox,
    bottomGoalBox,
    topSpot,
    bottomSpot,
  );

  return group;
}

function createLineRect(
  width: number,
  depth: number,
  lineThickness: number,
  material: object,
) {
  const group = new Group();

  const top = new Mesh(new PlaneGeometry(width, lineThickness), material);
  top.rotation.x = -Math.PI / 2;
  top.position.set(0, 0, -depth / 2);

  const bottom = top.clone();
  bottom.position.z = depth / 2;

  const left = new Mesh(new PlaneGeometry(lineThickness, depth), material);
  left.rotation.x = -Math.PI / 2;
  left.position.set(-width / 2, 0, 0);

  const right = left.clone();
  right.position.x = width / 2;

  group.add(top, bottom, left, right);
  return group;
}

function createSpot() {
  const spot = new Mesh(
    new CircleGeometry(0.11, 16),
    new MeshStandardMaterial({ color: LINE_COLOR }),
  );
  spot.rotation.x = -Math.PI / 2;
  return spot;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeAxis(value: number): -1 | 0 | 1 {
  if (value === 0) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function getNormalizedDirection(
  from: TileCoordinate,
  to: TileCoordinate,
): { x: -1 | 0 | 1; z: -1 | 0 | 1 } | null {
  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;

  if (deltaX === 0 && deltaZ === 0) {
    return null;
  }

  const absX = Math.abs(deltaX);
  const absZ = Math.abs(deltaZ);
  const isStraight = deltaX === 0 || deltaZ === 0 || absX === absZ;

  if (!isStraight) {
    return null;
  }

  return {
    x: normalizeAxis(deltaX),
    z: normalizeAxis(deltaZ),
  };
}

import {
  DoubleSide,
  LineBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';

export const PITCH_COLUMNS = 13;
export const PITCH_ROWS = 9;
export const TILE_SIZE = 1;

const PITCH_COLOR = '#3d9b63';
const GRID_COLOR = '#d9f99d';

export type TileCoordinate = {
  x: number;
  z: number;
};

export type WorldPosition = {
  x: number;
  z: number;
};

export function createPitch() {
  const width = PITCH_COLUMNS * TILE_SIZE;
  const depth = PITCH_ROWS * TILE_SIZE;

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

  const gridLines = createPitchGrid(width, depth);
  gridLines.position.y = 0.01;

  root.add(surface, gridLines);

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
  const halfWidth = (PITCH_COLUMNS * TILE_SIZE) / 2;
  const halfDepth = (PITCH_ROWS * TILE_SIZE) / 2;

  if (
    x < -halfWidth ||
    x > halfWidth ||
    z < -halfDepth ||
    z > halfDepth
  ) {
    return null;
  }

  const tileX = clamp(
    Math.floor((x + halfWidth) / TILE_SIZE),
    0,
    PITCH_COLUMNS - 1,
  );
  const tileZ = clamp(
    Math.floor((z + halfDepth) / TILE_SIZE),
    0,
    PITCH_ROWS - 1,
  );

  return { x: tileX, z: tileZ };
}

export function tileCoordinateToWorldPosition(
  tile: TileCoordinate,
): WorldPosition {
  const halfWidth = (PITCH_COLUMNS * TILE_SIZE) / 2;
  const halfDepth = (PITCH_ROWS * TILE_SIZE) / 2;

  return {
    x: -halfWidth + tile.x * TILE_SIZE + TILE_SIZE / 2,
    z: -halfDepth + tile.z * TILE_SIZE + TILE_SIZE / 2,
  };
}

function createPitchGrid(width: number, depth: number) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const vertices: number[] = [];

  for (let column = 0; column <= PITCH_COLUMNS; column += 1) {
    const x = -halfWidth + column * TILE_SIZE;
    vertices.push(x, 0, -halfDepth, x, 0, halfDepth);
  }

  for (let row = 0; row <= PITCH_ROWS; row += 1) {
    const z = -halfDepth + row * TILE_SIZE;
    vertices.push(-halfWidth, 0, z, halfWidth, 0, z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: GRID_COLOR,
      transparent: true,
      opacity: 0.45,
    }),
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

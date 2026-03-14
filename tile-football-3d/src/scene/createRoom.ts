import {
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import {
  TILE_SIZE,
  FIELD_WORLD_DEPTH,
  FIELD_WORLD_WIDTH,
} from '../world/Pitch';

const ROOM_MARGIN_LEFT = 2;
const ROOM_MARGIN_RIGHT = 2;
const ROOM_MARGIN_TOP = 2;
const ROOM_MARGIN_BOTTOM = 2;
const FLOOR_HEIGHT = 0.3;
const FLOOR_INSET = 0.65;

const PITCH_WIDTH = FIELD_WORLD_WIDTH;
const PITCH_DEPTH = FIELD_WORLD_DEPTH;
const ROOM_WIDTH = PITCH_WIDTH + ROOM_MARGIN_LEFT + ROOM_MARGIN_RIGHT;
const ROOM_DEPTH = PITCH_DEPTH + ROOM_MARGIN_TOP + ROOM_MARGIN_BOTTOM;
const ROOM_CENTER_X = (ROOM_MARGIN_RIGHT - ROOM_MARGIN_LEFT) / 2;
const ROOM_CENTER_Z = (ROOM_MARGIN_BOTTOM - ROOM_MARGIN_TOP) / 2;


export function createRoom() {
  const room = new Group();
  const floor = createFloorPlatform();

  room.add(floor.root);
  room.add(createBackWall());
  room.add(createLeftWall());
  room.add(createRearFurnitureBand());
  room.add(createScoreboardZone());
  room.add(createCornerProps());
  room.add(createGoal(-1));
  room.add(createGoal(1));

  return {
    root: room,
    floorSurface: floor.surface,
  };
}

function createFloorPlatform() {
  const group = new Group();

  const base = new Mesh(
    new BoxGeometry(ROOM_WIDTH, FLOOR_HEIGHT, ROOM_DEPTH),
    new MeshStandardMaterial({ color: '#d89550' }),
  );
  base.position.set(ROOM_CENTER_X, -FLOOR_HEIGHT / 2 - 0.04, ROOM_CENTER_Z);

  const top = new Mesh(
    new PlaneGeometry(ROOM_WIDTH, ROOM_DEPTH),
    new MeshStandardMaterial({
      color: '#d89550',
      side: DoubleSide,
    }),
  );
  top.rotation.x = -Math.PI / 2;
  top.position.set(ROOM_CENTER_X, 0.001, ROOM_CENTER_Z);
  top.name = 'room-floor-surface';

  const inset = new Mesh(
    new PlaneGeometry(ROOM_WIDTH - FLOOR_INSET, ROOM_DEPTH - FLOOR_INSET),
    new MeshStandardMaterial({
      color: '#de9b56',
      side: DoubleSide,
    }),
  );
  inset.rotation.x = -Math.PI / 2;
  inset.position.set(ROOM_CENTER_X, 0.003, ROOM_CENTER_Z);

  group.add(base, top, inset, createFloorBoardLines(), createRoomTileGrid());

  return {
    root: group,
    surface: top,
  };
}

function createBackWall() {
  return new Group();
}

function createLeftWall() {
  return new Group();
}

function createRearFurnitureBand() {
  return new Group();
}

function createScoreboardZone() {
  return new Group();
}

function createCornerProps() {
  return new Group();
}

function createGoal(side: -1 | 1) {
  const goal = new Group();
  const frameMaterial = new MeshStandardMaterial({ color: '#d9dde7' });
  const netMaterial = new LineBasicMaterial({ color: '#8f949b' });
  const goalWidth = TILE_SIZE * 3;
  const goalDepth = TILE_SIZE;
  const y = 0.72;
  const z = side * (PITCH_DEPTH / 2 + 0.5);

  const leftPost = new Mesh(new BoxGeometry(0.08, 1.2, 0.08), frameMaterial);
  leftPost.position.set(-(goalWidth / 2), y, z);

  const rightPost = leftPost.clone();
  rightPost.position.x = goalWidth / 2;

  const crossbar = new Mesh(new BoxGeometry(goalWidth, 0.08, 0.08), frameMaterial);
  crossbar.position.set(0, y + 0.6, z);

  const backBar = new Mesh(new BoxGeometry(goalWidth - 0.15, 1.2, 0.08), frameMaterial);
  backBar.position.set(0, 0.62, z + side * goalDepth);

  const shadowBase = new Mesh(
    new BoxGeometry(goalWidth + 0.25, 0.04, goalDepth + 0.45),
    new MeshStandardMaterial({ color: '#6a6d76' }),
  );
  shadowBase.position.set(0, 0.02, z + side * (goalDepth * 0.5));

  goal.add(leftPost, rightPost, crossbar, backBar, shadowBase);
  goal.add(createGoalNet(side, netMaterial));

  return goal;
}

function createGoalNet(side: -1 | 1, material: object) {
  const vertices: number[] = [];
  const width = TILE_SIZE;
  const height = 1.15;
  const depth = TILE_SIZE * 3;
  const zFront = 0;
  const zBack = side * width;

  for (let row = 0; row <= 5; row += 1) {
    const y = row * (height / 5);
    vertices.push(-depth / 2, y, zFront, depth / 2, y, zFront);
    vertices.push(-depth / 2, y, zBack, depth / 2, y, zBack);
  }

  for (let column = 0; column <= 4; column += 1) {
    const x = -depth / 2 + column * (depth / 4);
    vertices.push(x, 0, zFront, x, height, zFront);
    vertices.push(x, 0, zBack, x, height, zBack);
    vertices.push(x, height, zFront, x, 0.2, zBack);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  const net = new LineSegments(geometry, material);
  net.position.set(0, 0.12, side * (PITCH_DEPTH / 2 + 0.5));

  return net;
}

function createFloorBoardLines() {
  const vertices: number[] = [];
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = ROOM_DEPTH / 2;

  for (let index = 0; index <= Math.floor(ROOM_WIDTH * 2); index += 1) {
    const x = ROOM_CENTER_X - halfWidth + index * 0.5;
    vertices.push(x, 0.002, ROOM_CENTER_Z - halfDepth, x, 0.002, ROOM_CENTER_Z + halfDepth);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: '#c18146',
      transparent: true,
      opacity: 0.24,
    }),
  );
}

function createRoomTileGrid() {
  const vertices: number[] = [];
  const halfWidth = ROOM_WIDTH / 2;
  const halfDepth = ROOM_DEPTH / 2;

  for (let column = 0; column <= Math.floor(ROOM_WIDTH / TILE_SIZE); column += 1) {
    const x = ROOM_CENTER_X - halfWidth + column * TILE_SIZE;
    vertices.push(x, 0.004, ROOM_CENTER_Z - halfDepth, x, 0.004, ROOM_CENTER_Z + halfDepth);
  }

  for (let row = 0; row <= Math.floor(ROOM_DEPTH / TILE_SIZE); row += 1) {
    const z = ROOM_CENTER_Z - halfDepth + row * TILE_SIZE;
    vertices.push(ROOM_CENTER_X - halfWidth, 0.004, z, ROOM_CENTER_X + halfWidth, 0.004, z);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color: '#f7ecd0',
      transparent: true,
      opacity: 0.14,
    }),
  );
}

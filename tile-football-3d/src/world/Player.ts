import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import type { PlayerModel } from '../core/GameState';
import type { TileCoordinate, WorldPosition } from './Pitch';
import { TILE_SIZE, tileCoordinateToWorldPosition } from './Pitch';

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
};

export class Player {
  public readonly id: string;
  public readonly width: number;
  public readonly height: number;
  public readonly speedTilesPerSecond: number;
  public currentTile: TileCoordinate;
  public targetTile: TileCoordinate;
  public path: TileCoordinate[] = [];
  private renderPosition: WorldPosition;
  public nextTile: TileCoordinate | null = null;

  constructor(
    id: string,
    startTile: TileCoordinate,
    width: number,
    height: number,
    speedTilesPerSecond = 4,
  ) {
    this.id = id;
    this.currentTile = { ...startTile };
    this.targetTile = { ...startTile };
    this.width = width;
    this.height = height;
    this.speedTilesPerSecond = speedTilesPerSecond;
    this.renderPosition = tileCoordinateToWorldPosition(startTile);
  }

  setPath(
    tile: TileCoordinate,
    path: TileCoordinate[],
    preserveCurrentStep = false,
  ): void {
    const sanitizedPath = sanitizePath(this.currentTile, path);

    this.targetTile = { ...tile };
    this.path = sanitizedPath;

    if (!preserveCurrentStep || !this.nextTile) {
      this.nextTile = null;
      this.renderPosition = tileCoordinateToWorldPosition(this.currentTile);
    }

    if (this.path.length === 0 && !this.nextTile) {
      this.targetTile = { ...this.currentTile };
    }
  }

  getIntendedNextTile(): TileCoordinate | null {
    if (this.nextTile) {
      if (!isAdjacentStep(this.currentTile, this.nextTile)) {
        this.nextTile = null;
      } else {
        return { ...this.nextTile };
      }
    }

    if (this.path.length === 0) {
      return null;
    }

    const nextPathTile = this.path[0];

    if (!isAdjacentStep(this.currentTile, nextPathTile)) {
      this.path = [];
      this.targetTile = { ...this.currentTile };
      return null;
    }

    return { ...nextPathTile };
  }

  beginStep(tile: TileCoordinate): void {
    if (!isAdjacentStep(this.currentTile, tile)) {
      this.nextTile = null;
      return;
    }

    this.nextTile = { ...tile };
  }

  cancelStepIfBlocked(): void {
    this.nextTile = null;
  }

  applyModel(model: PlayerModel): void {
    this.currentTile = { ...model.currentTile };
    this.nextTile = model.nextTile && isAdjacentStep(model.currentTile, model.nextTile)
      ? { ...model.nextTile }
      : null;
    this.targetTile = { ...model.targetTile };
    this.path = sanitizePath(model.currentTile, model.path);
    this.renderPosition = tileCoordinateToWorldPosition(model.currentTile);
  }

  toModel(): PlayerModel {
    return {
      id: this.id,
      currentTile: { ...this.currentTile },
      nextTile: this.nextTile ? { ...this.nextTile } : null,
      targetTile: { ...this.targetTile },
      path: this.path.map((tile) => ({ ...tile })),
    };
  }

  update(deltaSeconds: number): void {
    let remainingDistance = this.speedTilesPerSecond * deltaSeconds;

    while (remainingDistance > 0) {
      const destinationTile = this.nextTile;

      if (!destinationTile) {
        return;
      }

      if (!isAdjacentStep(this.currentTile, destinationTile)) {
        this.nextTile = null;
        this.path = [];
        this.targetTile = { ...this.currentTile };
        return;
      }

      const destination = tileCoordinateToWorldPosition(destinationTile);
      const deltaX = destination.x - this.renderPosition.x;
      const deltaZ = destination.z - this.renderPosition.z;
      const distanceToDestination = getTileTravelDistance(deltaX, deltaZ);

      if (distanceToDestination === 0) {
        this.finishStep(destinationTile, destination);
        continue;
      }

      if (remainingDistance >= distanceToDestination) {
        this.finishStep(destinationTile, destination);
        remainingDistance -= distanceToDestination;
        continue;
      }

      const travelRatio = remainingDistance / distanceToDestination;
      this.renderPosition = {
        x: this.renderPosition.x + deltaX * travelRatio,
        z: this.renderPosition.z + deltaZ * travelRatio,
      };
      return;
    }
  }

  syncMesh(mesh: PositionableMesh): void {
    mesh.position.set(
      this.renderPosition.x,
      0,
      this.renderPosition.z,
    );
  }

  private finishStep(tile: TileCoordinate, position: WorldPosition): void {
    this.currentTile = { ...tile };
    this.renderPosition = position;
    this.nextTile = null;

    if (this.path.length > 0 && areTilesEqual(this.path[0], tile)) {
      this.path.shift();
    }

    if (this.path.length === 0) {
      this.targetTile = { ...this.currentTile };
    }
  }
}

function areTilesEqual(left: TileCoordinate, right: TileCoordinate): boolean {
  return left.x === right.x && left.z === right.z;
}

function isAdjacentStep(left: TileCoordinate, right: TileCoordinate): boolean {
  const deltaX = Math.abs(left.x - right.x);
  const deltaZ = Math.abs(left.z - right.z);

  return deltaX <= 1 && deltaZ <= 1 && (deltaX !== 0 || deltaZ !== 0);
}

function sanitizePath(
  start: TileCoordinate,
  path: TileCoordinate[],
): TileCoordinate[] {
  const sanitizedPath: TileCoordinate[] = [];
  let previousTile = start;

  for (const tile of path) {
    if (!isAdjacentStep(previousTile, tile)) {
      break;
    }

    sanitizedPath.push({ ...tile });
    previousTile = tile;
  }

  return sanitizedPath;
}

function getTileTravelDistance(deltaX: number, deltaZ: number): number {
  return Math.max(Math.abs(deltaX), Math.abs(deltaZ)) / TILE_SIZE;
}

export function createPlayerMesh(player: Player) {
  const mesh = new Group();
  const robeMaterial = new MeshStandardMaterial({ color: '#ece7dc' });
  const trimMaterial = new MeshStandardMaterial({ color: '#6c7486' });
  const skinMaterial = new MeshStandardMaterial({ color: '#d3a07d' });
  const hairMaterial = new MeshStandardMaterial({ color: '#7f5232' });
  const wingMaterial = new MeshStandardMaterial({ color: '#f8fafc' });
  const haloMaterial = new MeshStandardMaterial({
    color: '#5cc7ff',
    emissive: '#166d95',
    emissiveIntensity: 0.45,
  });

  const shoes = new Mesh(
    new BoxGeometry(player.width * 0.44, player.height * 0.06, player.width * 0.24),
    new MeshStandardMaterial({ color: '#4e5563' }),
  );
  shoes.position.y = player.height * 0.04;

  const legs = new Mesh(
    new BoxGeometry(player.width * 0.36, player.height * 0.28, player.width * 0.22),
    trimMaterial,
  );
  legs.position.y = player.height * 0.17;

  const torso = new Mesh(
    new BoxGeometry(player.width * 0.52, player.height * 0.34, player.width * 0.28),
    robeMaterial,
  );
  torso.position.y = player.height * 0.44;

  const chestTrim = new Mesh(
    new BoxGeometry(player.width * 0.22, player.height * 0.34, player.width * 0.04),
    trimMaterial,
  );
  chestTrim.position.set(0, player.height * 0.44, player.width * 0.13);

  const head = new Mesh(
    new SphereGeometry(player.width * 0.23, 18, 18),
    skinMaterial,
  );
  head.position.y = player.height * 0.76;

  const hair = new Mesh(
    new BoxGeometry(player.width * 0.36, player.height * 0.12, player.width * 0.3),
    hairMaterial,
  );
  hair.position.set(0, player.height * 0.84, -player.width * 0.02);

  const jaw = new Mesh(
    new BoxGeometry(player.width * 0.24, player.height * 0.08, player.width * 0.2),
    skinMaterial,
  );
  jaw.position.set(0, player.height * 0.66, player.width * 0.02);

  const leftArm = new Mesh(
    new BoxGeometry(player.width * 0.12, player.height * 0.28, player.width * 0.12),
    robeMaterial,
  );
  leftArm.position.set(-player.width * 0.2, player.height * 0.43, 0);
  leftArm.rotation.z = 0.08;

  const rightArm = leftArm.clone();
  rightArm.position.x = player.width * 0.2;
  rightArm.rotation.z = -0.08;

  const leftWing = new Mesh(
    new BoxGeometry(player.width * 0.12, player.height * 0.36, player.width * 0.04),
    wingMaterial,
  );
  leftWing.position.set(-player.width * 0.33, player.height * 0.47, -player.width * 0.06);
  leftWing.rotation.z = 0.42;

  const rightWing = leftWing.clone();
  rightWing.position.x = player.width * 0.33;
  rightWing.rotation.z = -0.42;

  const halo = new Mesh(
    new CylinderGeometry(player.width * 0.22, player.width * 0.22, player.height * 0.02, 20),
    haloMaterial,
  );
  halo.position.y = player.height * 1.01;
  halo.rotation.x = Math.PI / 2;

  mesh.add(
    shoes,
    legs,
    torso,
    chestTrim,
    head,
    hair,
    jaw,
    leftArm,
    rightArm,
    leftWing,
    rightWing,
    halo,
  );

  player.syncMesh(mesh);

  return mesh;
}

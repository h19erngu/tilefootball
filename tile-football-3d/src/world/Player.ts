import { BoxGeometry, MeshStandardMaterial, Mesh } from 'three';
import type { TileCoordinate, WorldPosition } from './Pitch';
import { tileCoordinateToWorldPosition } from './Pitch';

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
};

export class Player {
  public readonly width: number;
  public readonly height: number;
  public readonly speedTilesPerSecond: number;
  public currentTile: TileCoordinate;
  public targetTile: TileCoordinate;
  private renderPosition: WorldPosition;
  private nextTile: TileCoordinate | null = null;

  constructor(
    startTile: TileCoordinate,
    width: number,
    height: number,
    speedTilesPerSecond = 4,
  ) {
    this.currentTile = { ...startTile };
    this.targetTile = { ...startTile };
    this.width = width;
    this.height = height;
    this.speedTilesPerSecond = speedTilesPerSecond;
    this.renderPosition = tileCoordinateToWorldPosition(startTile);
  }

  setTargetTile(tile: TileCoordinate): void {
    this.targetTile = { ...tile };
  }

  update(deltaSeconds: number): void {
    let remainingDistance = this.speedTilesPerSecond * deltaSeconds;

    while (remainingDistance > 0) {
      const destinationTile = this.nextTile ?? this.getNextStepTile();

      if (!destinationTile) {
        return;
      }

      this.nextTile = destinationTile;

      const destination = tileCoordinateToWorldPosition(destinationTile);
      const deltaX = destination.x - this.renderPosition.x;
      const deltaZ = destination.z - this.renderPosition.z;
      const distanceToDestination = Math.hypot(deltaX, deltaZ);

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
      this.height / 2,
      this.renderPosition.z,
    );
  }

  private getNextStepTile(): TileCoordinate | null {
    if (
      this.currentTile.x === this.targetTile.x &&
      this.currentTile.z === this.targetTile.z
    ) {
      return null;
    }

    if (this.currentTile.x !== this.targetTile.x) {
      return {
        x:
          this.currentTile.x + Math.sign(this.targetTile.x - this.currentTile.x),
        z: this.currentTile.z,
      };
    }

    return {
      x: this.currentTile.x,
      z: this.currentTile.z + Math.sign(this.targetTile.z - this.currentTile.z),
    };
  }

  private finishStep(tile: TileCoordinate, position: WorldPosition): void {
    this.currentTile = { ...tile };
    this.renderPosition = position;
    this.nextTile = null;
  }
}

export function createPlayerMesh(player: Player) {
  const mesh = new Mesh(
    new BoxGeometry(player.width, player.height, player.width),
    new MeshStandardMaterial({ color: '#ef4444' }),
  );

  player.syncMesh(mesh);

  return mesh;
}

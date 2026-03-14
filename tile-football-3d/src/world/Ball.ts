import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BallModel } from '../core/GameState';
import type { WorldPosition } from './Pitch';
import { TILE_SIZE, tileCoordinateToWorldPosition } from './Pitch';

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
};

export class Ball {
  public readonly radius: number;
  public readonly speedTilesPerSecond: number;
  private model: BallModel;
  private renderPosition: WorldPosition;

  constructor(model: BallModel, radius: number, speedTilesPerSecond = 7) {
    this.model = cloneBallModel(model);
    this.radius = radius;
    this.speedTilesPerSecond = speedTilesPerSecond;
    this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
  }

  getModel(): BallModel {
    return cloneBallModel(this.model);
  }

  setModel(model: BallModel): void {
    this.model = cloneBallModel(model);

    if (this.model.state !== 'moving') {
      this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
    }
  }

  update(deltaSeconds: number): void {
    if (this.model.state !== 'moving') {
      return;
    }

    let remainingDistance = this.speedTilesPerSecond * deltaSeconds;

    while (remainingDistance > 0 && this.model.remainingPath.length > 0) {
      const nextTile = this.model.remainingPath[0];
      const destination = tileCoordinateToWorldPosition(nextTile);
      const deltaX = destination.x - this.renderPosition.x;
      const deltaZ = destination.z - this.renderPosition.z;
      const distanceToDestination = getTileTravelDistance(deltaX, deltaZ);

      if (distanceToDestination === 0) {
        this.advanceToTile(nextTile);
        continue;
      }

      if (remainingDistance >= distanceToDestination) {
        this.renderPosition = destination;
        this.advanceToTile(nextTile);
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

    if (this.model.remainingPath.length === 0 && this.model.state === 'moving') {
      this.model = {
        ...this.model,
        state: 'idle',
        direction: null,
        controllerId: null,
        path: [],
        remainingPath: [],
      };
      this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
    }
  }

  syncMesh(mesh: PositionableMesh): void {
    mesh.position.set(this.renderPosition.x, this.radius, this.renderPosition.z);
  }

  private advanceToTile(tile: BallModel['tile']): void {
    this.model.tile = { ...tile };
    this.model.remainingPath = this.model.remainingPath.slice(1);
  }
}

function getTileTravelDistance(deltaX: number, deltaZ: number): number {
  return Math.max(Math.abs(deltaX), Math.abs(deltaZ)) / TILE_SIZE;
}

export function createBallMesh(ball: Ball) {
  const mesh = new Mesh(
    new SphereGeometry(ball.radius, 24, 24),
    new MeshStandardMaterial({ color: '#f8fafc' }),
  );

  ball.syncMesh(mesh);

  return mesh;
}

function cloneBallModel(ball: BallModel): BallModel {
  return {
    tile: { ...ball.tile },
    state: ball.state,
    direction: ball.direction ? { ...ball.direction } : null,
    controllerId: ball.controllerId,
    path: ball.path.map((tile) => ({ ...tile })),
    remainingPath: ball.remainingPath.map((tile) => ({ ...tile })),
  };
}

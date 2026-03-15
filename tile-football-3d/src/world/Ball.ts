import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { BallModel } from '../core/GameState';
import type { WorldPosition } from './Pitch';
import { tileCoordinateToWorldPosition } from './Pitch';

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
};

type ActiveSlide = {
  fromTile: BallModel['tile'];
  toTile: BallModel['tile'];
  fromPosition: WorldPosition;
  toPosition: WorldPosition;
  elapsedMs: number;
  durationMs: number;
  targetTileKey: string;
};

export class Ball {
  public readonly radius: number;
  public readonly slideIntervalMs: number;
  private model: BallModel;
  private renderPosition: WorldPosition;
  private liftAmount = 0;
  private activeSlide: ActiveSlide | null = null;
  private completedSlideTile: BallModel['tile'] | null = null;

  constructor(model: BallModel, radius: number, slideIntervalMs = 500) {
    this.model = cloneBallModel(model);
    this.radius = radius;
    this.slideIntervalMs = slideIntervalMs;
    this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
    this.normalizeSlideState();
  }

  setModel(model: BallModel): void {
    this.model = cloneBallModel(model);
    this.normalizeSlideState();
  }

  update(deltaSeconds: number): void {
    if (this.model.state !== 'moving' || !this.model.moveTargetTile) {
      this.clearActiveSlide();
      this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
      return;
    }

    const activeSlide = this.ensureActiveSlide();

    if (!activeSlide) {
      return;
    }

    activeSlide.elapsedMs = Math.min(
      activeSlide.elapsedMs + deltaSeconds * 1000,
      activeSlide.durationMs,
    );

    const progress = Math.min(activeSlide.elapsedMs / activeSlide.durationMs, 1);
    this.renderPosition = interpolateWorldPosition(
      activeSlide.fromPosition,
      activeSlide.toPosition,
      progress,
    );
    this.liftAmount = getHabboLiftAmount(progress);

    if (progress < 1) {
      return;
    }

    this.renderPosition = activeSlide.toPosition;
    this.liftAmount = 0;
    this.completedSlideTile = { ...activeSlide.toTile };
    this.clearActiveSlide();
  }

  syncMesh(mesh: PositionableMesh): void {
    mesh.position.set(
      this.renderPosition.x,
      this.radius + this.liftAmount,
      this.renderPosition.z,
    );
  }

  consumeCompletedSlideTile(): BallModel['tile'] | null {
    const completedTile = this.completedSlideTile;
    this.completedSlideTile = null;

    return completedTile ? { ...completedTile } : null;
  }

  private normalizeSlideState(): void {
    this.completedSlideTile = null;
    this.clearActiveSlide();
    this.renderPosition = tileCoordinateToWorldPosition(this.model.tile);
    this.liftAmount = 0;

    if (this.model.state !== 'moving' || !this.model.moveTargetTile) {
      return;
    }

    this.ensureActiveSlide();
  }

  private ensureActiveSlide(): ActiveSlide | null {
    const nextTile = this.model.moveTargetTile;

    if (!nextTile) {
      return null;
    }

    const nextTileKey = getTileKey(nextTile);

    if (this.activeSlide && this.activeSlide.targetTileKey === nextTileKey) {
      return this.activeSlide;
    }

    const fromPosition = tileCoordinateToWorldPosition(this.model.tile);
    const toPosition = tileCoordinateToWorldPosition(nextTile);

    this.activeSlide = {
      fromTile: { ...this.model.tile },
      toTile: { ...nextTile },
      fromPosition,
      toPosition,
      elapsedMs: 0,
      durationMs: getSegmentDurationMs(
        this.model.totalPathLength,
        this.model.path.length,
        this.model.animationTimeMs,
        getMovementFactor(this.model.pushableState),
        this.slideIntervalMs,
      ),
      targetTileKey: nextTileKey,
    };
    this.renderPosition = fromPosition;
    this.liftAmount = 0;

    return this.activeSlide;
  }

  private clearActiveSlide(): void {
    this.activeSlide = null;
    this.liftAmount = 0;
  }
}

function interpolateWorldPosition(
  start: WorldPosition,
  target: WorldPosition,
  progress: number,
): WorldPosition {
  const midpoint = getPushableMidpoint(start, target);

  if (!midpoint) {
    return interpolateLinear(start, target, progress);
  }

  if (progress <= 0.5) {
    return interpolateLinear(start, midpoint, progress / 0.5);
  }

  return interpolateLinear(midpoint, target, (progress - 0.5) / 0.5);
}

function interpolateLinear(
  start: WorldPosition,
  target: WorldPosition,
  progress: number,
): WorldPosition {
  return {
    x: start.x + (target.x - start.x) * progress,
    z: start.z + (target.z - start.z) * progress,
  };
}

function getHabboLiftAmount(progress: number): number {
  const normalizedProgress = Math.min(Math.max(progress, 0), 1);

  if (normalizedProgress <= 0.5) {
    return 0.125 * (normalizedProgress / 0.5);
  }

  return 0.125 * ((1 - normalizedProgress) / 0.5);
}

function getMovementFactor(pushableState: number): number {
  return Math.max(Math.floor(pushableState / 10), 0);
}

function getSegmentDurationMs(
  totalPathLength: number,
  remainingPathLength: number,
  animationTimeMs: number,
  movementFactor: number,
  fallbackDurationMs: number,
): number {
  if (totalPathLength <= 1) {
    return fallbackDurationMs;
  }

  const stepIndex = totalPathLength - remainingPathLength;
  const customArrivalTimes = getCustomArrivalTimes(totalPathLength, fallbackDurationMs);

  if (customArrivalTimes) {
    const previousArrivalTime = stepIndex === 0 ? 0 : customArrivalTimes[stepIndex - 1];
    const currentArrivalTime = customArrivalTimes[stepIndex];

    if (currentArrivalTime !== undefined) {
      return Math.max(currentArrivalTime - previousArrivalTime, 1);
    }
  }

  if (movementFactor <= 0 || animationTimeMs <= 0) {
    return fallbackDurationMs;
  }

  return Math.max(animationTimeMs / movementFactor, fallbackDurationMs);
}

function getCustomArrivalTimes(
  totalPathLength: number,
  fallbackDurationMs: number,
): number[] | null {
  if (totalPathLength < 5) {
    return null;
  }

  const baseArrivalTimes = [
    fallbackDurationMs * 0.5,
    fallbackDurationMs * 1,
    fallbackDurationMs * 1.5,
    fallbackDurationMs * 3,
    fallbackDurationMs * 4,
  ];

  if (totalPathLength === baseArrivalTimes.length) {
    return baseArrivalTimes;
  }

  const arrivalTimes = [...baseArrivalTimes];

  while (arrivalTimes.length < totalPathLength) {
    const previousArrivalTime = arrivalTimes[arrivalTimes.length - 1] ?? 0;
    arrivalTimes.push(previousArrivalTime + fallbackDurationMs);
  }

  return arrivalTimes;
}

function getPushableMidpoint(
  start: WorldPosition,
  target: WorldPosition,
): WorldPosition | null {
  const deltaX = target.x - start.x;
  const deltaZ = target.z - start.z;

  if (Math.abs(deltaX) <= 1 && Math.abs(deltaZ) <= 1) {
    return null;
  }

  return {
    x: start.x + deltaX / 2,
    z: start.z + deltaZ / 2,
  };
}

function getTileKey(tile: BallModel['tile']): string {
  return `${tile.x}:${tile.z}`;
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
    moveTargetTile: ball.moveTargetTile ? { ...ball.moveTargetTile } : null,
    totalPathLength: ball.totalPathLength,
    pushableState: ball.pushableState,
    animationTimeMs: ball.animationTimeMs,
    direction: ball.direction ? { ...ball.direction } : null,
    controllerId: ball.controllerId,
    path: ball.path.map((tile) => ({ ...tile })),
  };
}

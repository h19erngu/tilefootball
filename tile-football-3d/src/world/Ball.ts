import {
  CanvasTexture,
  CircleGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
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

export type BallAppearance = {
  spotScale: number;
  patternScale: number;
  ringOpacity: number;
};

export const DEFAULT_BALL_APPEARANCE: BallAppearance = {
  spotScale: 1.79,
  patternScale: 0.74,
  ringOpacity: 0,
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
    fallbackDurationMs * 0.3,
    fallbackDurationMs * 0.6,
    fallbackDurationMs * 0.9,
    fallbackDurationMs * 1.4,
    fallbackDurationMs * 2,
  ];

  if (totalPathLength === baseArrivalTimes.length) {
    return baseArrivalTimes;
  }

  const arrivalTimes = [...baseArrivalTimes];

  while (arrivalTimes.length < totalPathLength) {
    const previousArrivalTime = arrivalTimes[arrivalTimes.length - 1] ?? 0;
    arrivalTimes.push(previousArrivalTime + fallbackDurationMs * 0.6);
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

export function createBallMesh(
  ball: Ball,
  appearance: BallAppearance = DEFAULT_BALL_APPEARANCE,
) {
  const container = new Group();
  const texture = createSoccerUvTexture(appearance);
  const shell = new Mesh(
    new SphereGeometry(ball.radius, 32, 32),
    new MeshStandardMaterial({
      map: texture,
      roughness: 0.9,
      metalness: 0,
    }),
  );
  const shadow = new Mesh(
    new CircleGeometry(ball.radius * 0.85, 18),
    new MeshStandardMaterial({
      color: '#000000',
      transparent: true,
      opacity: appearance.ringOpacity,
      roughness: 1,
      metalness: 0,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -ball.radius + 0.02;

  container.add(shadow, shell);
  container.userData.ballShell = shell;
  container.userData.ballShadow = shadow;
  ball.syncMesh(container);

  return container;
}

export function updateBallMeshAppearance(
  mesh: ReturnType<typeof createBallMesh>,
  appearance: BallAppearance,
): void {
  const shell = mesh.userData.ballShell as { material?: object } | undefined;
  const shadow = mesh.userData.ballShadow as { material?: object } | undefined;

  if (shell?.material && 'map' in shell.material) {
    const material = shell.material as {
      map?: { dispose: () => void } | null;
      needsUpdate?: boolean;
    };
    material.map?.dispose();
    material.map = createSoccerUvTexture(appearance);
    material.needsUpdate = true;
  }

  if (shadow?.material) {
    const material = shadow.material as {
      opacity?: number;
      needsUpdate?: boolean;
    };
    material.opacity = appearance.ringOpacity;
    material.needsUpdate = true;
  }
}

function createSoccerUvTexture(appearance: BallAppearance) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;

  const context = canvas.getContext('2d');

  if (!context) {
    const texture = new CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }

  context.fillStyle = '#f4f4f1';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const baseTileSize = 128 / Math.max(appearance.patternScale, 0.45);
  const columns = Math.ceil(canvas.width / baseTileSize) + 1;
  const rows = Math.ceil(canvas.height / (baseTileSize * 0.82)) + 1;
  const ringRadius = baseTileSize * 0.3;
  const spotRadius = ringRadius * 0.55 * appearance.spotScale;

  context.lineWidth = Math.max(baseTileSize * 0.018, 1.5);
  context.strokeStyle = `rgba(189, 189, 183, ${appearance.ringOpacity})`;

  for (let row = 0; row < rows; row += 1) {
    const y = row * baseTileSize * 0.82 + baseTileSize * 0.52;
    const xOffset = row % 2 === 0 ? baseTileSize * 0.5 : 0;

    for (let column = 0; column < columns; column += 1) {
      const x = column * baseTileSize + xOffset;
      drawPatternTile(context, x, y, ringRadius, spotRadius);
    }
  }

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function drawPatternTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  ringRadius: number,
  spotRadius: number,
): void {
  context.beginPath();
  context.arc(x, y, ringRadius, 0, Math.PI * 2);
  context.stroke();

  const gradient = context.createLinearGradient(
    x - spotRadius,
    y - spotRadius,
    x + spotRadius,
    y + spotRadius,
  );
  gradient.addColorStop(0, '#24252b');
  gradient.addColorStop(1, '#111217');
  context.fillStyle = gradient;
  fillPolygon(
    context,
    getPentagonPoints(x, y, spotRadius),
    gradient,
  );
}

function fillPolygon(
  context: CanvasRenderingContext2D,
  points: [number, number][],
  fill: string | CanvasGradient,
): void {
  if (points.length === 0) {
    return;
  }

  context.fillStyle = fill;
  context.beginPath();
  context.moveTo(points[0][0], points[0][1]);

  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index][0], points[index][1]);
  }

  context.closePath();
  context.fill();

  context.strokeStyle = '#0c0d12';
  context.stroke();
}

function getPentagonPoints(
  centerX: number,
  centerY: number,
  radius: number,
): [number, number][] {
  const points: [number, number][] = [];

  for (let index = 0; index < 5; index += 1) {
    const angle = -Math.PI / 2 + index * ((Math.PI * 2) / 5);
    points.push([
      centerX + Math.cos(angle) * radius,
      centerY + Math.sin(angle) * radius,
    ]);
  }

  return points;
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

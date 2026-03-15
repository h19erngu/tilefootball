import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import type { PendingInteraction, PlayerModel } from '../core/GameState';
import type { TileCoordinate, WorldPosition } from './Pitch';
import {
  getFacingAngleForTileStep,
  TILE_SIZE,
  tileCoordinateToWorldPosition,
} from './Pitch';

type PivotNode = {
  position: { y: number };
  rotation: { x: number };
};

type BobNode = {
  position: { y: number };
};

type MaterialLike = object;

type PlayerMesh = {
  add: (...objects: unknown[]) => void;
  position: {
    set: (x: number, y: number, z: number) => void;
  };
  rotation: {
    y: number;
  };
  userData: {
    walkRig?: {
      root: BobNode;
      leftArmPivot: PivotNode;
      rightArmPivot: PivotNode;
      leftLegPivot: PivotNode;
      rightLegPivot: PivotNode;
      baseRootY: number;
    };
  };
};

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
  rotation?: {
    y: number;
  };
  userData?: PlayerMesh['userData'];
};

export type AvatarPreset = {
  id: string;
  label: string;
  skinColor: string;
  hairColor: string;
  shirtColor: string;
  jacketColor: string;
  pantsColor: string;
  shoesColor: string;
  accentColor: string;
  hairStyle: 'short' | 'messy' | 'undercut';
  hatStyle: 'none' | 'cap' | 'beanie' | 'helmet' | 'bandana';
};

export const AVATAR_PRESETS: AvatarPreset[] = [
  {
    id: 'home-stripes',
    label: 'Home Stripes',
    skinColor: '#f0c39c',
    hairColor: '#5b3a26',
    shirtColor: '#ffffff',
    jacketColor: '#ececec',
    pantsColor: '#242933',
    shoesColor: '#f5f7fb',
    accentColor: '#d9433d',
    hairStyle: 'short',
    hatStyle: 'none',
  },
  {
    id: 'red-helmet',
    label: 'Red Helmet',
    skinColor: '#d9a178',
    hairColor: '#342117',
    shirtColor: '#d94742',
    jacketColor: '#b52b2a',
    pantsColor: '#2e3038',
    shoesColor: '#f3f5fb',
    accentColor: '#ffffff',
    hairStyle: 'short',
    hatStyle: 'helmet',
  },
  {
    id: 'sky-bandana',
    label: 'Sky Bandana',
    skinColor: '#8f5e44',
    hairColor: '#14181f',
    shirtColor: '#f2c9d5',
    jacketColor: '#e5a7bb',
    pantsColor: '#6ca8db',
    shoesColor: '#33d0ee',
    accentColor: '#4aa8ff',
    hairStyle: 'undercut',
    hatStyle: 'bandana',
  },
  {
    id: 'bench-beanie',
    label: 'Bench Beanie',
    skinColor: '#edc0a3',
    hairColor: '#26201d',
    shirtColor: '#101318',
    jacketColor: '#d64240',
    pantsColor: '#2d313d',
    shoesColor: '#f7e7d2',
    accentColor: '#7f89a0',
    hairStyle: 'messy',
    hatStyle: 'beanie',
  },
  {
    id: 'away-helmet',
    label: 'Away Helmet',
    skinColor: '#f1c59f',
    hairColor: '#5c4638',
    shirtColor: '#f5d0db',
    jacketColor: '#f2bfd0',
    pantsColor: '#62a7df',
    shoesColor: '#2ec6ec',
    accentColor: '#ffffff',
    hairStyle: 'short',
    hatStyle: 'helmet',
  },
];

export function getAvatarPresetById(id: string): AvatarPreset {
  return AVATAR_PRESETS.find((preset) => preset.id === id) ?? AVATAR_PRESETS[0];
}

export class Player {
  public readonly id: string;
  public readonly width: number;
  public readonly height: number;
  public readonly speedTilesPerSecond: number;
  public currentTile: TileCoordinate;
  public targetTile: TileCoordinate;
  public path: TileCoordinate[] = [];
  public pendingInteraction: PendingInteraction | null = null;
  public dribbleDirection: PlayerModel['dribbleDirection'] = null;
  private renderPosition: WorldPosition;
  public nextTile: TileCoordinate | null = null;
  private walkCycleTime = 0;
  private facingAngle = 0;

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
    const pathStart = preserveCurrentStep && this.nextTile
      ? this.nextTile
      : this.currentTile;
    const sanitizedPath = sanitizePath(pathStart, path);

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

    const facingAngle = getFacingAngleForTileStep(this.currentTile, tile);

    if (facingAngle !== null) {
      this.facingAngle = facingAngle;
    }

    this.nextTile = { ...tile };
  }

  cancelStepIfBlocked(): void {
    this.nextTile = null;
  }

  applyModel(model: PlayerModel): void {
    const previousTile = { ...this.currentTile };
    const previousNextTile = this.nextTile ? { ...this.nextTile } : null;
    const shouldPreserveRenderPosition =
      areTilesEqual(this.currentTile, model.currentTile) &&
      areTilesEqualOrBothNull(this.nextTile, model.nextTile);
    this.currentTile = { ...model.currentTile };
    this.nextTile = model.nextTile && isAdjacentStep(model.currentTile, model.nextTile)
      ? { ...model.nextTile }
      : null;
    this.targetTile = { ...model.targetTile };
    this.path = sanitizePath(model.currentTile, model.path);
    this.pendingInteraction = model.pendingInteraction
      ? {
          action: model.pendingInteraction.action,
          clickedTile: { ...model.pendingInteraction.clickedTile },
          originTile: model.pendingInteraction.originTile
            ? { ...model.pendingInteraction.originTile }
            : undefined,
        }
      : null;
    this.dribbleDirection = model.dribbleDirection ? { ...model.dribbleDirection } : null;

    if (!shouldPreserveRenderPosition) {
      this.renderPosition = tileCoordinateToWorldPosition(model.currentTile);
    }

    const facingTarget = this.nextTile ?? this.path[0];
    const facingAngle = facingTarget
      ? getFacingAngleForTileStep(this.currentTile, facingTarget)
      : getFacingAngleForTileStep(previousNextTile ?? previousTile, this.currentTile);

    if (facingAngle !== null) {
      this.facingAngle = facingAngle;
    }
  }

  toModel(): PlayerModel {
    return {
      id: this.id,
      currentTile: { ...this.currentTile },
      nextTile: this.nextTile ? { ...this.nextTile } : null,
      targetTile: { ...this.targetTile },
      path: this.path.map((tile) => ({ ...tile })),
      pendingInteraction: this.pendingInteraction
        ? {
            action: this.pendingInteraction.action,
            clickedTile: { ...this.pendingInteraction.clickedTile },
            originTile: this.pendingInteraction.originTile
              ? { ...this.pendingInteraction.originTile }
              : undefined,
          }
        : null,
      dribbleDirection: this.dribbleDirection ? { ...this.dribbleDirection } : null,
    };
  }

  update(deltaSeconds: number): void {
    const startingPosition = { ...this.renderPosition };
    let remainingDistance = this.speedTilesPerSecond * deltaSeconds;
    let movedDistance = 0;

    while (remainingDistance > 0) {
      const destinationTile = this.nextTile;

      if (!destinationTile) {
        break;
      }

      if (!isAdjacentStep(this.currentTile, destinationTile)) {
        this.nextTile = null;
        this.path = [];
        this.targetTile = { ...this.currentTile };
        break;
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
        movedDistance += distanceToDestination;
        remainingDistance -= distanceToDestination;
        continue;
      }

      const travelRatio = remainingDistance / distanceToDestination;
      this.renderPosition = {
        x: this.renderPosition.x + deltaX * travelRatio,
        z: this.renderPosition.z + deltaZ * travelRatio,
      };
      movedDistance += remainingDistance;
      break;
    }

    this.updateMovementAnimation(startingPosition, movedDistance);
  }

  syncMesh(mesh: PositionableMesh): void {
    mesh.position.set(this.renderPosition.x, 0, this.renderPosition.z);

    if (mesh.rotation) {
      mesh.rotation.y = this.facingAngle;
    }

    const walkRig = mesh.userData?.walkRig;
    if (!walkRig) {
      return;
    }

    const isWalking = this.nextTile !== null;
    const stridePhase = this.walkCycleTime * 12;
    const legSwing = isWalking ? Math.sin(stridePhase) * 0.6 : 0;
    const armSwing = legSwing * 0.8;
    const bodyBob = isWalking ? Math.abs(Math.sin(stridePhase * 2)) * 0.045 : 0;

    walkRig.leftLegPivot.rotation.x = legSwing;
    walkRig.rightLegPivot.rotation.x = -legSwing;
    walkRig.leftArmPivot.rotation.x = -armSwing;
    walkRig.rightArmPivot.rotation.x = armSwing;
    walkRig.root.position.y = walkRig.baseRootY + bodyBob;
  }

  private finishStep(tile: TileCoordinate, position: WorldPosition): void {
    const facingAngle = getFacingAngleForTileStep(this.currentTile, tile);

    if (facingAngle !== null) {
      this.facingAngle = facingAngle;
    }

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

  private updateMovementAnimation(
    _previousPosition: WorldPosition,
    movedDistance: number,
  ): void {
    if (movedDistance > 0) {
      this.walkCycleTime += movedDistance / Math.max(this.speedTilesPerSecond, 0.01);
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

function areTilesEqualOrBothNull(
  left: TileCoordinate | null,
  right: TileCoordinate | null,
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return areTilesEqual(left, right);
}

export function createPlayerMesh(
  player: Player,
  preset: AvatarPreset = AVATAR_PRESETS[0],
) {
  const mesh = new Group() as PlayerMesh;
  const rigRoot = new Group();

  const skinMaterial = new MeshStandardMaterial({ color: preset.skinColor });
  const hairMaterial = new MeshStandardMaterial({ color: preset.hairColor });
  const shirtMaterial = new MeshStandardMaterial({ color: preset.shirtColor });
  const jacketMaterial = new MeshStandardMaterial({ color: preset.jacketColor });
  const pantsMaterial = new MeshStandardMaterial({ color: preset.pantsColor });
  const shoesMaterial = new MeshStandardMaterial({ color: preset.shoesColor });
  const accentMaterial = new MeshStandardMaterial({ color: preset.accentColor });
  const eyeMaterial = new MeshStandardMaterial({ color: '#20232b' });

  const leftLegPivot = new Group();
  leftLegPivot.position.set(-player.width * 0.095, player.height * 0.34, 0);
  const leftLeg = new Mesh(
    new BoxGeometry(player.width * 0.16, player.height * 0.34, player.width * 0.16),
    pantsMaterial,
  );
  leftLeg.position.y = -player.height * 0.17;
  const leftShoe = new Mesh(
    new BoxGeometry(player.width * 0.18, player.height * 0.07, player.width * 0.24),
    shoesMaterial,
  );
  leftShoe.position.set(0, -player.height * 0.355, player.width * 0.03);
  leftLegPivot.add(leftLeg, leftShoe);

  const rightLegPivot = new Group();
  rightLegPivot.position.set(player.width * 0.095, player.height * 0.34, 0);
  const rightLeg = leftLeg.clone();
  const rightShoe = leftShoe.clone();
  rightLegPivot.add(rightLeg, rightShoe);

  const torso = new Mesh(
    new BoxGeometry(player.width * 0.46, player.height * 0.36, player.width * 0.28),
    shirtMaterial,
  );
  torso.position.y = player.height * 0.54;

  const jacket = new Mesh(
    new BoxGeometry(player.width * 0.52, player.height * 0.38, player.width * 0.32),
    jacketMaterial,
  );
  jacket.position.y = player.height * 0.54;

  const jacketStripe = new Mesh(
    new BoxGeometry(player.width * 0.08, player.height * 0.34, player.width * 0.33),
    accentMaterial,
  );
  jacketStripe.position.set(0, player.height * 0.54, player.width * 0.01);

  const head = new Mesh(
    new BoxGeometry(player.width * 0.34, player.height * 0.26, player.width * 0.3),
    skinMaterial,
  );
  head.position.y = player.height * 0.84;

  const nose = new Mesh(
    new BoxGeometry(player.width * 0.05, player.height * 0.05, player.width * 0.04),
    skinMaterial,
  );
  nose.position.set(0, player.height * 0.8, player.width * 0.15);

  const leftEye = new Mesh(
    new BoxGeometry(player.width * 0.04, player.height * 0.05, player.width * 0.03),
    eyeMaterial,
  );
  leftEye.position.set(-player.width * 0.065, player.height * 0.84, player.width * 0.155);

  const rightEye = leftEye.clone();
  rightEye.position.x = player.width * 0.065;

  const mouth = new Mesh(
    new BoxGeometry(player.width * 0.11, player.height * 0.018, player.width * 0.02),
    eyeMaterial,
  );
  mouth.position.set(0, player.height * 0.755, player.width * 0.152);

  const hair = createHairMesh(player, preset, hairMaterial, accentMaterial);
  hair.position.y = player.height * 0.95;

  const leftArmPivot = new Group();
  leftArmPivot.position.set(-player.width * 0.26, player.height * 0.65, 0);
  const leftArm = new Mesh(
    new BoxGeometry(player.width * 0.13, player.height * 0.3, player.width * 0.13),
    jacketMaterial,
  );
  leftArm.position.y = -player.height * 0.15;
  const leftHand = new Mesh(
    new BoxGeometry(player.width * 0.1, player.height * 0.08, player.width * 0.1),
    skinMaterial,
  );
  leftHand.position.y = -player.height * 0.33;
  leftArmPivot.add(leftArm, leftHand);

  const rightArmPivot = new Group();
  rightArmPivot.position.set(player.width * 0.26, player.height * 0.65, 0);
  const rightArm = leftArm.clone();
  const rightHand = leftHand.clone();
  rightArmPivot.add(rightArm, rightHand);

  const leftSleeveStripe = new Mesh(
    new BoxGeometry(player.width * 0.14, player.height * 0.06, player.width * 0.14),
    accentMaterial,
  );
  leftSleeveStripe.position.y = -player.height * 0.06;
  leftArmPivot.add(leftSleeveStripe);

  const rightSleeveStripe = leftSleeveStripe.clone();
  rightArmPivot.add(rightSleeveStripe);

  rigRoot.add(
    leftLegPivot,
    rightLegPivot,
    torso,
    jacket,
    jacketStripe,
    head,
    nose,
    leftEye,
    rightEye,
    mouth,
    hair,
    leftArmPivot,
    rightArmPivot,
  );

  mesh.add(rigRoot);
  mesh.userData.walkRig = {
    root: rigRoot,
    leftArmPivot,
    rightArmPivot,
    leftLegPivot,
    rightLegPivot,
    baseRootY: rigRoot.position.y,
  };

  player.syncMesh(mesh);

  return mesh;
}

function createHairMesh(
  player: Player,
  preset: AvatarPreset,
  hairMaterial: MaterialLike,
  accentMaterial: MaterialLike,
) {
  const hairGroup = new Group();

  if (preset.hairStyle === 'short') {
    const top = new Mesh(
      new BoxGeometry(player.width * 0.34, player.height * 0.08, player.width * 0.28),
      hairMaterial,
    );
    const fringe = new Mesh(
      new BoxGeometry(player.width * 0.24, player.height * 0.06, player.width * 0.05),
      hairMaterial,
    );
    fringe.position.set(0, -player.height * 0.04, player.width * 0.11);
    hairGroup.add(top, fringe);
  }

  if (preset.hairStyle === 'messy') {
    const top = new Mesh(
      new BoxGeometry(player.width * 0.32, player.height * 0.09, player.width * 0.27),
      hairMaterial,
    );
    const leftSpike = new Mesh(
      new BoxGeometry(player.width * 0.08, player.height * 0.08, player.width * 0.1),
      hairMaterial,
    );
    leftSpike.position.set(-player.width * 0.12, 0, player.width * 0.02);
    leftSpike.rotation.z = 0.2;
    const rightSpike = leftSpike.clone();
    rightSpike.position.x = player.width * 0.12;
    rightSpike.rotation.z = -0.2;
    hairGroup.add(top, leftSpike, rightSpike);
  }

  if (preset.hairStyle === 'undercut') {
    const top = new Mesh(
      new BoxGeometry(player.width * 0.28, player.height * 0.08, player.width * 0.24),
      hairMaterial,
    );
    top.position.y = player.height * 0.01;
    const ridge = new Mesh(
      new BoxGeometry(player.width * 0.12, player.height * 0.05, player.width * 0.25),
      accentMaterial,
    );
    ridge.position.set(0, player.height * 0.045, 0);
    hairGroup.add(top, ridge);
  }

  if (preset.hatStyle === 'cap') {
    const cap = new Mesh(
      new BoxGeometry(player.width * 0.36, player.height * 0.08, player.width * 0.28),
      accentMaterial,
    );
    cap.position.y = player.height * 0.005;
    const brim = new Mesh(
      new BoxGeometry(player.width * 0.18, player.height * 0.02, player.width * 0.09),
      accentMaterial,
    );
    brim.position.set(0, -player.height * 0.03, player.width * 0.14);
    hairGroup.add(cap, brim);
  }

  if (preset.hatStyle === 'beanie') {
    const beanie = new Mesh(
      new BoxGeometry(player.width * 0.36, player.height * 0.11, player.width * 0.3),
      accentMaterial,
    );
    const fold = new Mesh(
      new BoxGeometry(player.width * 0.37, player.height * 0.04, player.width * 0.31),
      hairMaterial,
    );
    fold.position.y = -player.height * 0.05;
    hairGroup.add(beanie, fold);
  }

  if (preset.hatStyle === 'helmet') {
    const shell = new Mesh(
      new BoxGeometry(player.width * 0.36, player.height * 0.12, player.width * 0.31),
      accentMaterial,
    );
    shell.position.y = player.height * 0.01;
    const visor = new Mesh(
      new BoxGeometry(player.width * 0.13, player.height * 0.05, player.width * 0.05),
      accentMaterial,
    );
    visor.position.set(player.width * 0.11, -player.height * 0.03, player.width * 0.01);
    const chin = new Mesh(
      new BoxGeometry(player.width * 0.04, player.height * 0.11, player.width * 0.03),
      accentMaterial,
    );
    chin.position.set(player.width * 0.16, -player.height * 0.07, player.width * 0.01);
    hairGroup.add(shell, visor, chin);
  }

  if (preset.hatStyle === 'bandana') {
    const band = new Mesh(
      new BoxGeometry(player.width * 0.36, player.height * 0.05, player.width * 0.29),
      accentMaterial,
    );
    band.position.y = -player.height * 0.02;
    const knot = new Mesh(
      new BoxGeometry(player.width * 0.08, player.height * 0.06, player.width * 0.08),
      accentMaterial,
    );
    knot.position.set(-player.width * 0.16, -player.height * 0.02, -player.width * 0.03);
    hairGroup.add(band, knot);
  }

  return hairGroup;
}

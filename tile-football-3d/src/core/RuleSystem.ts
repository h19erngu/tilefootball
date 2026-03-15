import type {
  ActorId,
  BallModel,
  Direction,
  GameState,
  PendingInteraction,
  PlayerModel,
} from './GameState';
import { cloneGameState } from './GameState';
import type { TileCoordinate } from '../world/Pitch';
import {
  addDirectionToTile,
  areTilesEqual,
  getDirectionBetweenTiles,
  getNextTile,
  getOrthogonalDistance,
  isTileInBounds,
} from '../world/Pitch';

export type RuleAction =
  | 'none'
  | 'kick'
  | 'trap'
  | 'shoot'
  | 'release';

export type RuleResolution = {
  handled: boolean;
  valid: boolean;
  action: RuleAction;
  state: GameState;
  reason?: string;
};

export type PendingInteractionResolution = {
  handled: boolean;
  valid: boolean;
  pendingInteraction: PendingInteraction | null;
  reason?: string;
};

const KICK_MAX_TILES = 6;
const SHOOT_MAX_TILES = 6;
const DEFAULT_BALL_ANIMATION_TIME_MS = 500;
const MOVING_BALL_CATCHABLE_AFTER_TILES = 3;
const TRAP_BALL_ANIMATION_TIME_MS = DEFAULT_BALL_ANIMATION_TIME_MS * 2;

export function getPendingFreeBallInteraction(
  state: GameState,
  actorId: ActorId,
  clickedTile: TileCoordinate,
): PendingInteraction | null {
  if (state.ball.state !== 'idle') {
    return null;
  }

  const actor = getPlayerById(state, actorId);

  if (!actor) {
    return null;
  }

  const referenceTile = getMovementReferenceTile(actor);

  if (isDirectBallClick(state.ball.tile, clickedTile)) {
    return {
      action: 'kick',
      clickedTile: { ...clickedTile },
      originTile: { ...referenceTile },
    };
  }

  const actorToBall = getSnappedDirectionBetweenTiles(referenceTile, state.ball.tile);
  const ballToClick = getSnappedDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (!actorToBall || !ballToClick) {
    return null;
  }

  if (actorToBall.x !== ballToClick.x || actorToBall.z !== ballToClick.z) {
    return null;
  }

  if (getOrthogonalDistance(state.ball.tile, clickedTile) !== 1) {
    return null;
  }

  return {
    action: 'trap',
    clickedTile: { ...clickedTile },
    originTile: { ...referenceTile },
  };
}

export function getPendingTrappedBallInteraction(
  state: GameState,
  actorId: ActorId,
  clickedTile: TileCoordinate,
): PendingInteractionResolution {
  const actor = getPlayerById(state, actorId);

  if (!actor || state.ball.state !== 'trapped') {
    return {
      handled: false,
      valid: false,
      pendingInteraction: null,
    };
  }

  const controlTile = getMovementReferenceTile(actor);

  if (isProtectedTrappedBall(state, actor.id)) {
    return {
      handled: true,
      valid: false,
      pendingInteraction: null,
      reason: 'Only the controlling player can use a trapped ball.',
    };
  }

  if (areTilesEqual(clickedTile, controlTile)) {
    return {
      handled: true,
      valid: false,
      pendingInteraction: null,
      reason: 'Click around the controlled ball to shoot or release.',
    };
  }

  const directionToClick = getSnappedDirectionBetweenTiles(controlTile, clickedTile);

  if (!directionToClick) {
    return {
      handled: true,
      valid: false,
      pendingInteraction: null,
      reason: 'Choose a direction from the controlled ball.',
    };
  }

  return {
    handled: true,
    valid: true,
    pendingInteraction: {
      action: getOrthogonalDistance(controlTile, clickedTile) === 1 ? 'shoot' : 'release',
      clickedTile: { ...clickedTile },
      originTile: { ...controlTile },
    },
  };
}

export function resolvePendingInteraction(
  state: GameState,
  actor: PlayerModel,
  fromTile: TileCoordinate,
  toTile: TileCoordinate,
): RuleResolution {
  const pendingInteraction = actor.pendingInteraction;

  if (!pendingInteraction) {
    return invalidUnhandled(state, 'No pending interaction.');
  }

  if (pendingInteraction.action === 'kick') {
    if (state.ball.state !== 'idle') {
      return invalidUnhandled(state, 'Ball is not free.');
    }

    if (!areTilesEqual(toTile, state.ball.tile)) {
      return invalidUnhandled(state, 'Player is not entering the ball tile.');
    }

    const direction = getDirectionBetweenTiles(fromTile, toTile);

    if (!direction) {
      return invalidUnhandled(state, 'Pending interaction needs a movement direction.');
    }

    const resolution = createTravelResolution(state, actor, 'kick', direction, KICK_MAX_TILES);

    return clearPendingInteraction(resolution, actor.id);
  }

  if (pendingInteraction.action === 'trap') {
    if (state.ball.state !== 'idle') {
      return invalidUnhandled(state, 'Ball is not free.');
    }

    if (!areTilesEqual(toTile, state.ball.tile)) {
      return invalidUnhandled(state, 'Player is not entering the ball tile.');
    }

    const direction = getDirectionBetweenTiles(state.ball.tile, pendingInteraction.clickedTile);

    if (!direction) {
      return invalidUnhandled(state, 'Trap target must be next to the ball.');
    }

    const nextState = cloneGameState(state);
    nextState.ball = createMovingBall(
      state.ball.tile,
      direction,
      [pendingInteraction.clickedTile],
      actor.id,
      TRAP_BALL_ANIMATION_TIME_MS,
    );
    clearPendingInteractionOnState(nextState, actor.id);

    return successAction('trap', nextState);
  }

  if (pendingInteraction.action === 'shoot' || pendingInteraction.action === 'release') {
    if (state.ball.state !== 'trapped' || state.ball.controllerId !== actor.id) {
      return invalidUnhandled(state, 'Ball is not controlled by this player.');
    }

    if (areTilesEqual(fromTile, toTile)) {
      return invalidUnhandled(state, 'Trapped-ball interaction needs movement to begin.');
    }

    const direction = getSnappedDirectionBetweenTiles(
      state.ball.tile,
      pendingInteraction.clickedTile,
    );

    if (!direction) {
      return invalidUnhandled(state, 'Trapped-ball interaction needs a direction.');
    }

    if (pendingInteraction.action === 'shoot') {
      const resolution = createTravelResolution(
        state,
        actor,
        'shoot',
        invertDirection(direction),
        SHOOT_MAX_TILES,
      );

      return clearPendingInteraction(resolution, actor.id);
    }

    const destination = addDirectionToTile(state.ball.tile, invertDirection(direction));

    if (!isTileInBounds(destination, state.pitchSize)) {
      return invalidHandled(state, 'Release destination is out of bounds.');
    }

    if (isTileOccupiedByOtherPlayer(destination, state.players, actor.id)) {
      return invalidHandled(state, 'Release destination is occupied.');
    }

    const nextState = cloneGameState(state);
    nextState.ball = createMovingBall(
      state.ball.tile,
      invertDirection(direction),
      [destination],
    );
    clearPendingInteractionOnState(nextState, actor.id);

    return successAction('release', nextState);
  }

  return invalidUnhandled(state, 'Unsupported pending interaction.');
}

export function resolveClick(
  state: GameState,
  actorId: ActorId,
  clickedTile: TileCoordinate,
): RuleResolution {
  const actor = getPlayerById(state, actorId);

  if (!actor) {
    return invalidUnhandled(state, 'Unknown actor.');
  }

  if (state.ball.state === 'moving') {
    if (areTilesEqual(clickedTile, state.ball.tile)) {
      return resolveMovingBallCatch(state, actor);
    }

    return invalidUnhandled(state, 'Ball is already moving.');
  }

  if (state.ball.state === 'trapped') {
    return resolveTrappedBallAction(state, actor, clickedTile);
  }

  return invalidUnhandled(state, 'Free-ball movement handles this click.');
}

export function resolveAutoPush(
  state: GameState,
  actor: PlayerModel,
  fromTile: TileCoordinate,
  toTile: TileCoordinate,
): RuleResolution {
  if (state.ball.state !== 'idle') {
    return invalidUnhandled(state, 'Ball is not free.');
  }

  if (!areTilesEqual(toTile, state.ball.tile)) {
    return invalidUnhandled(state, 'Player is not entering the ball tile.');
  }

  const direction = getDirectionBetweenTiles(fromTile, toTile);

  if (!direction) {
    return invalidUnhandled(state, 'Auto-push needs a movement direction.');
  }

  const isContinuingDribble = Boolean(
    actor.dribbleDirection &&
    actor.dribbleDirection.x === direction.x &&
    actor.dribbleDirection.z === direction.z &&
    areTilesEqual(actor.targetTile, state.ball.tile),
  );
  const isWalkingThroughBall = !areTilesEqual(actor.targetTile, state.ball.tile);

  if (!isWalkingThroughBall && !isContinuingDribble) {
    return invalidUnhandled(state, 'Move target is not in front of the ball.');
  }

  return createTravelResolution(state, actor, 'kick', direction, 1);
}

export function resolveMovingBallCatch(
  state: GameState,
  actor: PlayerModel,
): RuleResolution {
  const actionTile = getActionReferenceTile(actor);

  if (!canCatchMovingBall(state.ball)) {
    return invalidHandled(state, 'Ball is moving too fast to catch yet.');
  }

  if (getOrthogonalDistance(actionTile, state.ball.tile) !== 1) {
    return invalidHandled(state, 'Player must be beside the ball to catch it.');
  }

  const nextState = cloneGameState(state);
  nextState.ball = createTrappedBall(actionTile, actor.id);
  clearPendingInteractionOnState(nextState, actor.id);

  return successAction('trap', nextState);
}

export function resolveTrappedBallAction(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const controlTile = getActionReferenceTile(actor);

  if (isProtectedTrappedBall(state, actor.id)) {
    return invalid(
      state,
      isTrappedBallInteractionClick(controlTile, clickedTile),
      'Only the controlling player can use a trapped ball.',
    );
  }

  if (areTilesEqual(clickedTile, controlTile)) {
    return invalidHandled(state, 'Click around the controlled ball to shoot or release.');
  }

  const directionToClick = getDirectionBetweenTiles(controlTile, clickedTile);

  if (!directionToClick) {
    return invalidHandled(state, 'Choose a direction from the controlled ball.');
  }

  if (getOrthogonalDistance(controlTile, clickedTile) === 1) {
    return createTravelResolution(
      state,
      actor,
      'shoot',
      invertDirection(directionToClick),
      SHOOT_MAX_TILES,
    );
  }

  return executeRelease(state, actor, clickedTile);
}

function executeRelease(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const controlTile = getActionReferenceTile(actor);
  const directionToClick = getDirectionBetweenTiles(controlTile, clickedTile);

  if (!directionToClick) {
    return invalidHandled(state, 'Release requires a direction.');
  }

  const destination = addDirectionToTile(controlTile, invertDirection(directionToClick));

  if (!isTileInBounds(destination, state.pitchSize)) {
    return invalidHandled(state, 'Release destination is out of bounds.');
  }

  if (isTileOccupiedByOtherPlayer(destination, state.players, actor.id)) {
    return invalidHandled(state, 'Release destination is occupied.');
  }

  const nextState = cloneGameState(state);
  nextState.ball = createMovingBall(
    controlTile,
    invertDirection(directionToClick),
    [destination],
  );
  clearPendingInteractionOnState(nextState, actor.id);

  return successAction('release', nextState);
}

function createTravelResolution(
  state: GameState,
  actor: PlayerModel,
  action: 'kick' | 'shoot',
  direction: Direction,
  maxTiles: number,
): RuleResolution {
  const travelPath = getTravelPath(
    state.ball.tile,
    direction,
    state.players,
    actor.id,
    state.pitchSize,
    maxTiles,
  );

  const nextState = cloneGameState(state);
  clearPendingInteractionOnState(nextState, actor.id);

  if (travelPath.length === 0) {
    nextState.ball = createIdleBall(state.ball.tile);

    return successAction(action, nextState);
  }

  nextState.ball = createMovingBall(state.ball.tile, direction, travelPath);

  return successAction(action, nextState);
}

function getTravelPath(
  startTile: TileCoordinate,
  direction: Direction,
  players: PlayerModel[],
  actorId: ActorId,
  pitchSize: GameState['pitchSize'],
  maxTiles: number,
): TileCoordinate[] {
  const path: TileCoordinate[] = [];
  let currentTile = { ...startTile };

  while (path.length < maxTiles) {
    const nextTile = getNextTile(currentTile, direction);

    if (!isTileInBounds(nextTile, pitchSize)) {
      break;
    }

    if (isTileOccupiedByOtherPlayer(nextTile, players, actorId)) {
      break;
    }

    path.push(nextTile);
    currentTile = nextTile;
  }

  return path;
}

function isTileOccupiedByOtherPlayer(
  tile: TileCoordinate,
  players: PlayerModel[],
  actorId: ActorId,
): boolean {
  return players.some((player) => {
    if (player.id === actorId) {
      return false;
    }

    return areTilesEqual(player.currentTile, tile);
  });
}

function getPlayerById(
  state: GameState,
  actorId: ActorId,
): PlayerModel | undefined {
  return state.players.find((player) => player.id === actorId);
}

function getActionReferenceTile(player: PlayerModel): TileCoordinate {
  return player.currentTile;
}

function getMovementReferenceTile(player: PlayerModel): TileCoordinate {
  return player.nextTile ?? player.currentTile;
}

function isDirectBallClick(
  ballTile: TileCoordinate,
  clickedTile: TileCoordinate,
): boolean {
  return areTilesEqual(clickedTile, ballTile);
}

function isProtectedTrappedBall(
  state: GameState,
  actorId: ActorId,
): boolean {
  return state.ball.state === 'trapped' && state.ball.controllerId !== actorId;
}

function canCatchMovingBall(ball: BallModel): boolean {
  return getBallTilesTravelled(ball) >= MOVING_BALL_CATCHABLE_AFTER_TILES;
}

function getBallTilesTravelled(ball: BallModel): number {
  return Math.max(ball.totalPathLength - ball.path.length, 0);
}

function isTrappedBallInteractionClick(
  controlTile: TileCoordinate,
  clickedTile: TileCoordinate,
): boolean {
  return !areTilesEqual(controlTile, clickedTile);
}

function createIdleBall(tile: TileCoordinate): BallModel {
  return {
    tile: cloneTile(tile),
    state: 'idle',
    moveTargetTile: null,
    totalPathLength: 0,
    pushableState: 0,
    animationTimeMs: DEFAULT_BALL_ANIMATION_TIME_MS,
    direction: null,
    controllerId: null,
    path: [],
  };
}

function createMovingBall(
  tile: TileCoordinate,
  direction: Direction,
  path: TileCoordinate[],
  controllerId: ActorId | null = null,
  animationTimeMs = DEFAULT_BALL_ANIMATION_TIME_MS,
): BallModel {
  const clonedPath = path.map(cloneTile);
  const movementFactor = getPushableMovementFactor(clonedPath.length);

  return {
    tile: cloneTile(tile),
    state: 'moving',
    moveTargetTile: clonedPath[0] ? cloneTile(clonedPath[0]) : null,
    totalPathLength: clonedPath.length,
    pushableState: movementFactor * 10,
    animationTimeMs: animationTimeMs * movementFactor,
    direction: { ...direction },
    controllerId,
    path: clonedPath,
  };
}

function createTrappedBall(
  tile: TileCoordinate,
  controllerId: ActorId,
): BallModel {
  return {
    tile: cloneTile(tile),
    state: 'trapped',
    moveTargetTile: null,
    totalPathLength: 0,
    pushableState: 0,
    animationTimeMs: DEFAULT_BALL_ANIMATION_TIME_MS,
    direction: null,
    controllerId,
    path: [],
  };
}

function clearPendingInteraction(
  resolution: RuleResolution,
  actorId: ActorId,
): RuleResolution {
  if (!resolution.valid) {
    return resolution;
  }

  const nextState = cloneGameState(resolution.state);
  clearPendingInteractionOnState(nextState, actorId);

  return {
    ...resolution,
    state: nextState,
  };
}

function clearPendingInteractionOnState(
  state: GameState,
  actorId: ActorId,
): void {
  const player = state.players.find((entry) => entry.id === actorId);

  if (!player) {
    return;
  }

  player.pendingInteraction = null;
}

function getPushableMovementFactor(pathLength: number): number {
  if (pathLength >= 5) {
    return 3;
  }

  if (pathLength >= 3) {
    return 2;
  }

  return 1;
}

function invertDirection(direction: Direction): Direction {
  return {
    x: invertAxis(direction.x),
    z: invertAxis(direction.z),
  };
}

function invertAxis(value: Direction['x']): Direction['x'] {
  return value === 0 ? 0 : (value * -1) as Direction['x'];
}

function getSnappedDirectionBetweenTiles(
  from: TileCoordinate,
  to: TileCoordinate,
): Direction | null {
  const directDirection = getDirectionBetweenTiles(from, to);

  if (directDirection) {
    return directDirection;
  }

  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;

  if (deltaX === 0 && deltaZ === 0) {
    return null;
  }

  return {
    x: snapDirectionAxis(deltaX),
    z: snapDirectionAxis(deltaZ),
  };
}

function snapDirectionAxis(value: number): Direction['x'] {
  if (value === 0) {
    return 0;
  }

  return value > 0 ? 1 : -1;
}

function invalid(
  state: GameState,
  handled: boolean,
  reason: string,
): RuleResolution {
  return {
    handled,
    valid: false,
    action: 'none',
    state,
    reason,
  };
}

function invalidHandled(
  state: GameState,
  reason: string,
): RuleResolution {
  return invalid(state, true, reason);
}

function invalidUnhandled(
  state: GameState,
  reason: string,
): RuleResolution {
  return invalid(state, false, reason);
}

function successAction(
  action: Exclude<RuleAction, 'none'>,
  state: GameState,
): RuleResolution {
  return {
    handled: true,
    valid: true,
    action,
    state,
  };
}

function cloneTile(tile: TileCoordinate): TileCoordinate {
  return { ...tile };
}

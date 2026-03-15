import type {
  ActorId,
  BallModel,
  Direction,
  GameState,
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
  isOrthogonallyAdjacent,
  isStraightOrthogonalLine,
  isTileInBounds,
} from '../world/Pitch';

export type RuleAction =
  | 'none'
  | 'kick'
  | 'trap'
  | 'shoot'
  | 'drop';

export type RuleResolution = {
  handled: boolean;
  valid: boolean;
  action: RuleAction;
  state: GameState;
  reason?: string;
};

const KICK_SHOOT_MAX_TILES = 6;
const DEFAULT_BALL_ANIMATION_TIME_MS = 500;
const MOVING_BALL_CATCHABLE_AFTER_TILES = 3;

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

  return resolveFreeBallAction(state, actor, clickedTile);
}

export function resolveFreeBallAction(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const actionTile = getActionReferenceTile(actor);

  // Free-ball resolution is intentionally split into:
  // 1. ownership/protection
  // 2. direct kick on the ball tile
  // 3. immediate trap if the actor is already in the exact required lane
  // This keeps the "can act now?" checks isolated, which will make a future
  // move-then-interact layer easier to insert above these checks.
  if (state.ball.controllerId && state.ball.controllerId !== actor.id) {
    return invalid(
      state,
      isDirectBallClick(state.ball.tile, clickedTile),
      'Ball is protected.',
    );
  }

  if (isDirectBallClick(state.ball.tile, clickedTile)) {
    return executeKick(state, actor);
  }

  if (!isImmediateFreeBallTrapLine(actionTile, state.ball.tile, clickedTile)) {
    return invalidUnhandled(state, 'Click is not a free-ball action.');
  }

  const actorToBall = getDirectionBetweenTiles(actionTile, state.ball.tile);
  const ballToClick = getDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (!actorToBall || !ballToClick) {
    return invalidHandled(state, 'Free-ball actions must be in a straight line.');
  }

  if (actorToBall.x !== ballToClick.x || actorToBall.z !== ballToClick.z) {
    return invalidHandled(state, 'Trap target must be one tile beyond the ball.');
  }

  if (getOrthogonalDistance(state.ball.tile, clickedTile) !== 1) {
    return invalidHandled(state, 'Trap target must be one tile beyond the ball.');
  }

  return executeTrap(state, actor, clickedTile);
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

  if (!isOrthogonallyAdjacent(actionTile, state.ball.tile)) {
    return invalidHandled(state, 'Player must be beside the ball to catch it.');
  }

  const nextState = cloneGameState(state);
  nextState.ball = createTrappedBall(state.ball.tile, actor.id);

  return successAction('trap', nextState);
}

export function resolveTrappedBallAction(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const controlTile = state.ball.tile;

  if (isProtectedTrappedBall(state, actor.id)) {
    return invalid(
      state,
      isTrappedBallInteractionClick(state.ball.tile, clickedTile),
      'Only the controlling player can use a trapped ball.',
    );
  }

  if (areTilesEqual(clickedTile, state.ball.tile)) {
    return invalidHandled(state, 'Click beside or away from the trapped ball.');
  }

  if (!isStraightOrthogonalLine(controlTile, clickedTile)) {
    return invalidUnhandled(state, 'Diagonal trapped-ball clicks are invalid.');
  }

  if (isOrthogonallyAdjacent(controlTile, clickedTile)) {
    return executeShoot(state, actor, clickedTile);
  }

  return executeDrop(state, actor, clickedTile);
}

export function executeKick(
  state: GameState,
  actor: PlayerModel,
): RuleResolution {
  const actionTile = getActionReferenceTile(actor);
  const direction = getDirectionBetweenTiles(actionTile, state.ball.tile);

  if (!direction || !isOrthogonallyAdjacent(actionTile, state.ball.tile)) {
    return invalidHandled(state, 'Player must stand orthogonally beside the ball to kick.');
  }

  return createTravelResolution(state, actor, 'kick', direction);
}

export function executeTrap(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const actionTile = getActionReferenceTile(actor);

  if (!isTileInBounds(clickedTile, state.pitchSize)) {
    return invalidHandled(state, 'Trap target is out of bounds.');
  }

  const actorToBall = getDirectionBetweenTiles(actionTile, state.ball.tile);

  if (!actorToBall) {
    return invalidHandled(state, 'Trap requires the player, ball, and target tile to align.');
  }

  if (!isOrthogonallyAdjacent(actionTile, state.ball.tile)) {
    return invalidHandled(state, 'Trap requires the player, ball, and target tile to align.');
  }

  const ballToClick = getDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (!ballToClick) {
    return invalidHandled(state, 'Trap requires the player, ball, and target tile to align.');
  }

  if (actorToBall.x !== ballToClick.x || actorToBall.z !== ballToClick.z) {
    return invalidHandled(state, 'Trap requires the player, ball, and target tile to align.');
  }

  const nextState = cloneGameState(state);
  nextState.ball = createTrappedBall(clickedTile, actor.id);

  return successAction('trap', nextState);
}

export function executeShoot(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const ballToClick = getDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (!ballToClick || !isOrthogonallyAdjacent(state.ball.tile, clickedTile)) {
    return invalidHandled(state, 'Shoot requires one adjacent tile.');
  }

  if (!isTileInBounds(clickedTile, state.pitchSize)) {
    return invalidHandled(state, 'Shoot step is out of bounds.');
  }

  if (isTileOccupiedByOtherPlayer(clickedTile, state.players, actor.id)) {
    return invalidHandled(state, 'Shoot step is occupied.');
  }

  return createTravelResolution(state, actor, 'shoot', invertDirection(ballToClick));
}

export function executeDrop(
  state: GameState,
  actor: PlayerModel,
  clickedTile: TileCoordinate,
): RuleResolution {
  const ballToClick = getDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (!ballToClick) {
    return invalidHandled(state, 'Drop requires a straight line.');
  }

  if (getOrthogonalDistance(state.ball.tile, clickedTile) < 2) {
    return invalidHandled(state, 'Drop requires a click at least two tiles away.');
  }

  const destination = addDirectionToTile(
    state.ball.tile,
    invertDirection(ballToClick),
  );

  if (!isTileInBounds(destination, state.pitchSize)) {
    return invalidHandled(state, 'Drop destination is out of bounds.');
  }

  if (isTileOccupiedByOtherPlayer(destination, state.players, actor.id)) {
    return invalidHandled(state, 'Drop destination is occupied.');
  }

  const nextState = cloneGameState(state);
  nextState.ball = createIdleBall(destination);

  return successAction('drop', nextState);
}

function createTravelResolution(
  state: GameState,
  actor: PlayerModel,
  action: 'kick' | 'shoot',
  direction: Direction,
  maxTiles = KICK_SHOOT_MAX_TILES,
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
  return player.nextTile ?? player.currentTile;
}

function isDirectBallClick(
  ballTile: TileCoordinate,
  clickedTile: TileCoordinate,
): boolean {
  return areTilesEqual(clickedTile, ballTile);
}

function isImmediateFreeBallTrapLine(
  actorTile: TileCoordinate,
  ballTile: TileCoordinate,
  clickedTile: TileCoordinate,
): boolean {
  return isStraightOrthogonalLine(actorTile, ballTile, clickedTile);
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
  ballTile: TileCoordinate,
  clickedTile: TileCoordinate,
): boolean {
  return (
    areTilesEqual(clickedTile, ballTile) ||
    isStraightOrthogonalLine(ballTile, clickedTile)
  );
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
): BallModel {
  const clonedPath = path.map(cloneTile);
  const movementFactor = getPushableMovementFactor(clonedPath.length);

  return {
    tile: cloneTile(tile),
    state: 'moving',
    moveTargetTile: clonedPath[0] ? cloneTile(clonedPath[0]) : null,
    totalPathLength: clonedPath.length,
    pushableState: movementFactor * 10,
    animationTimeMs: DEFAULT_BALL_ANIMATION_TIME_MS * movementFactor,
    direction: { ...direction },
    controllerId: null,
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

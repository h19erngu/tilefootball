import type { TileCoordinate } from '../world/Pitch';

export type ActorId = string;

export type Direction = {
  x: -1 | 0 | 1;
  z: -1 | 0 | 1;
};

export type BallState = 'idle' | 'moving' | 'trapped';

export type BallModel = {
  tile: TileCoordinate;
  state: BallState;
  moveTargetTile: TileCoordinate | null;
  totalPathLength: number;
  pushableState: number;
  animationTimeMs: number;
  direction: Direction | null;
  controllerId: ActorId | null;
  path: TileCoordinate[];
};

export type PendingInteraction = {
  action: 'kick' | 'trap' | 'shoot' | 'release';
  clickedTile: TileCoordinate;
  originTile?: TileCoordinate;
};

export type PlayerModel = {
  id: ActorId;
  currentTile: TileCoordinate;
  nextTile: TileCoordinate | null;
  targetTile: TileCoordinate;
  path: TileCoordinate[];
  pendingInteraction?: PendingInteraction | null;
  dribbleDirection?: Direction | null;
};

export type PitchSize = {
  columns: number;
  rows: number;
};

export type GameState = {
  players: PlayerModel[];
  activePlayerId: ActorId;
  ball: BallModel;
  pitchSize: PitchSize;
};

export function cloneGameState(state: GameState): GameState {
  return {
    players: state.players.map(clonePlayerModel),
    activePlayerId: state.activePlayerId,
    ball: cloneBallModel(state.ball),
    pitchSize: { ...state.pitchSize },
  };
}

export function cloneBallModel(ball: BallModel): BallModel {
  return {
    tile: { ...ball.tile },
    state: ball.state,
    moveTargetTile: ball.moveTargetTile ? { ...ball.moveTargetTile } : null,
    totalPathLength: ball.totalPathLength,
    pushableState: ball.pushableState,
    animationTimeMs: ball.animationTimeMs,
    direction: ball.direction ? { ...ball.direction } : null,
    controllerId: ball.controllerId,
    path: ball.path.map(cloneTile),
  };
}

export function clonePlayerModel(player: PlayerModel): PlayerModel {
  return {
    id: player.id,
    currentTile: { ...player.currentTile },
    nextTile: player.nextTile ? { ...player.nextTile } : null,
    targetTile: { ...player.targetTile },
    path: player.path.map(cloneTile),
    pendingInteraction: player.pendingInteraction
      ? {
          action: player.pendingInteraction.action,
          clickedTile: cloneTile(player.pendingInteraction.clickedTile),
          originTile: player.pendingInteraction.originTile
            ? cloneTile(player.pendingInteraction.originTile)
            : undefined,
        }
      : player.pendingInteraction ?? null,
    dribbleDirection: player.dribbleDirection ? { ...player.dribbleDirection } : null,
  };
}

function cloneTile(tile: TileCoordinate): TileCoordinate {
  return { ...tile };
}

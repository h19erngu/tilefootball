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
  direction: Direction | null;
  controllerId: ActorId | null;
  path: TileCoordinate[];
  remainingPath: TileCoordinate[];
};

export type PendingInteraction = {
  action: 'kick' | 'trap' | 'shoot' | 'drop';
  clickedTile: TileCoordinate;
};

export type PlayerModel = {
  id: ActorId;
  currentTile: TileCoordinate;
  nextTile: TileCoordinate | null;
  targetTile: TileCoordinate;
  pendingInteraction?: PendingInteraction | null;
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
    direction: ball.direction ? { ...ball.direction } : null,
    controllerId: ball.controllerId,
    path: ball.path.map(cloneTile),
    remainingPath: ball.remainingPath.map(cloneTile),
  };
}

export function clonePlayerModel(player: PlayerModel): PlayerModel {
  return {
    id: player.id,
    currentTile: { ...player.currentTile },
    nextTile: player.nextTile ? { ...player.nextTile } : null,
    targetTile: { ...player.targetTile },
    pendingInteraction: player.pendingInteraction
      ? {
          action: player.pendingInteraction.action,
          clickedTile: cloneTile(player.pendingInteraction.clickedTile),
        }
      : player.pendingInteraction ?? null,
  };
}

function cloneTile(tile: TileCoordinate): TileCoordinate {
  return { ...tile };
}

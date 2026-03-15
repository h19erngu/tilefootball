import type { ActorId, PlayerModel } from './GameState';
import type { TileCoordinate } from '../world/Pitch';

export function isTileBlockedForMovement(
  tile: TileCoordinate,
  players: PlayerModel[],
  actorId?: ActorId,
): boolean {
  return players.some((player) => {
    if (actorId && player.id === actorId) {
      return false;
    }

    return (
      areTilesEqual(player.currentTile, tile) ||
      doesPlayerReserveTile(player, tile)
    );
  });
}

export function doesPlayerReserveTile(
  player: PlayerModel,
  tile: TileCoordinate,
): boolean {
  return player.nextTile ? areTilesEqual(player.nextTile, tile) : false;
}

function areTilesEqual(left: TileCoordinate, right: TileCoordinate): boolean {
  return left.x === right.x && left.z === right.z;
}

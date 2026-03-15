import type { PitchSize, PlayerModel } from './GameState';
import type { TileCoordinate } from '../world/Pitch';
import { isTileBlockedForMovement } from './movementBlocking';

type SearchNode = {
  tile: TileCoordinate;
  costFromStart: number;
  estimatedTotalCost: number;
};

const MOVEMENT_DIRECTIONS: TileCoordinate[] = [
  { x: 0, z: -1 },
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 1, z: -1 },
  { x: 1, z: 1 },
  { x: -1, z: 1 },
  { x: -1, z: -1 },
];

export function findTilePath(
  start: TileCoordinate,
  goal: TileCoordinate,
  players: PlayerModel[],
  pitchSize: PitchSize,
  actorId?: string,
): TileCoordinate[] {
  if (!isTileInBounds(start, pitchSize) || !isTileInBounds(goal, pitchSize)) {
    return [];
  }

  if (areTilesEqual(start, goal)) {
    return [{ ...start }];
  }

  if (isBlockedTile(goal, players, actorId)) {
    return [];
  }

  const openNodes: SearchNode[] = [{
    tile: { ...start },
    costFromStart: 0,
    estimatedTotalCost: getManhattanDistance(start, goal),
  }];
  const cameFrom = new Map<string, string>();
  const costByKey = new Map<string, number>([[tileKey(start), 0]]);
  const closedKeys = new Set<string>();

  while (openNodes.length > 0) {
    openNodes.sort(compareSearchNodes);
    const currentNode = openNodes.shift();

    if (!currentNode) {
      break;
    }

    const currentKey = tileKey(currentNode.tile);

    if (closedKeys.has(currentKey)) {
      continue;
    }

    if (areTilesEqual(currentNode.tile, goal)) {
      return reconstructPath(cameFrom, start, currentNode.tile);
    }

    closedKeys.add(currentKey);

    for (const neighbor of getNeighbors(currentNode.tile, goal, pitchSize)) {
      const neighborKey = tileKey(neighbor);

      if (closedKeys.has(neighborKey)) {
        continue;
      }

      if (!areTilesEqual(neighbor, goal) && isBlockedTile(neighbor, players, actorId)) {
        continue;
      }

      const nextCostFromStart = currentNode.costFromStart + getStepCost(currentNode.tile, neighbor);
      const knownCost = costByKey.get(neighborKey);

      if (knownCost !== undefined && nextCostFromStart >= knownCost) {
        continue;
      }

      cameFrom.set(neighborKey, currentKey);
      costByKey.set(neighborKey, nextCostFromStart);
      openNodes.push({
        tile: neighbor,
        costFromStart: nextCostFromStart,
        estimatedTotalCost: nextCostFromStart + getManhattanDistance(neighbor, goal),
      });
    }
  }

  return [];
}

function reconstructPath(
  cameFrom: Map<string, string>,
  start: TileCoordinate,
  goal: TileCoordinate,
): TileCoordinate[] {
  const path: TileCoordinate[] = [{ ...goal }];
  let currentKey = tileKey(goal);

  while (cameFrom.has(currentKey)) {
    const previousKey = cameFrom.get(currentKey);

    if (!previousKey) {
      break;
    }

    path.push(tileFromKey(previousKey));
    currentKey = previousKey;
  }

  const orderedPath = path.reverse();

  return isValidPath(start, orderedPath) ? orderedPath : [];
}

function getNeighbors(
  tile: TileCoordinate,
  goal: TileCoordinate,
  pitchSize: PitchSize,
): TileCoordinate[] {
  const neighbors: TileCoordinate[] = [];

  for (const direction of MOVEMENT_DIRECTIONS) {
    const neighbor = {
      x: tile.x + direction.x,
      z: tile.z + direction.z,
    };

    if (isTileInBounds(neighbor, pitchSize)) {
      neighbors.push(neighbor);
    }
  }

  neighbors.sort((left, right) => compareNeighborPreference(left, right, goal));

  return neighbors;
}

function isBlockedTile(
  tile: TileCoordinate,
  players: PlayerModel[],
  actorId?: string,
): boolean {
  return isTileBlockedForMovement(tile, players, actorId);
}

function isTileInBounds(
  tile: TileCoordinate,
  pitchSize: PitchSize,
): boolean {
  return (
    tile.x >= 0 &&
    tile.z >= 0 &&
    tile.x < pitchSize.columns &&
    tile.z < pitchSize.rows
  );
}

function getManhattanDistance(
  left: TileCoordinate,
  right: TileCoordinate,
): number {
  return Math.abs(left.x - right.x) + Math.abs(left.z - right.z);
}

function getChebyshevDistance(
  left: TileCoordinate,
  right: TileCoordinate,
): number {
  return Math.max(Math.abs(left.x - right.x), Math.abs(left.z - right.z));
}

function getStepCost(left: TileCoordinate, right: TileCoordinate): number {
  const deltaX = Math.abs(left.x - right.x);
  const deltaZ = Math.abs(left.z - right.z);

  return deltaX === 1 && deltaZ === 1 ? Math.SQRT2 : 1;
}

function compareSearchNodes(left: SearchNode, right: SearchNode): number {
  if (left.estimatedTotalCost !== right.estimatedTotalCost) {
    return left.estimatedTotalCost - right.estimatedTotalCost;
  }

  if (left.costFromStart !== right.costFromStart) {
    return left.costFromStart - right.costFromStart;
  }

  return tileKey(left.tile).localeCompare(tileKey(right.tile));
}

function areTilesEqual(left: TileCoordinate, right: TileCoordinate): boolean {
  return left.x === right.x && left.z === right.z;
}

function compareNeighborPreference(
  left: TileCoordinate,
  right: TileCoordinate,
  goal: TileCoordinate,
): number {
  const leftManhattan = getManhattanDistance(left, goal);
  const rightManhattan = getManhattanDistance(right, goal);

  if (leftManhattan !== rightManhattan) {
    return leftManhattan - rightManhattan;
  }

  const leftChebyshev = getChebyshevDistance(left, goal);
  const rightChebyshev = getChebyshevDistance(right, goal);

  if (leftChebyshev !== rightChebyshev) {
    return leftChebyshev - rightChebyshev;
  }

  return tileKey(left).localeCompare(tileKey(right));
}

function isValidPath(
  start: TileCoordinate,
  path: TileCoordinate[],
): boolean {
  let previousTile = start;

  for (const tile of path) {
    const deltaX = Math.abs(previousTile.x - tile.x);
    const deltaZ = Math.abs(previousTile.z - tile.z);

    if ((deltaX > 1 || deltaZ > 1 || (deltaX === 0 && deltaZ === 0)) && !areTilesEqual(previousTile, tile)) {
      return false;
    }

    previousTile = tile;
  }

  return true;
}

function tileKey(tile: TileCoordinate): string {
  return `${tile.x}:${tile.z}`;
}

function tileFromKey(key: string): TileCoordinate {
  const [x, z] = key.split(':').map(Number);

  return { x, z };
}

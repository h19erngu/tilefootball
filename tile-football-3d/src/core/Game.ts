import { createCamera, updateCameraFrustum } from '../scene/createCamera';
import { createRoom } from '../scene/createRoom';
import { createRenderer } from '../scene/createRenderer';
import { createScene } from '../scene/createScene';
import { cloneBallModel } from './GameState';
import type { ActorId, BallModel, GameState } from './GameState';
import { findTilePath } from './findTilePath';
import { isTileBlockedForMovement } from './movementBlocking';
import { resolveAutoPush, resolveClick } from './RuleSystem';
import { TilePicker } from '../input/TilePicker';
import { Ball, createBallMesh } from '../world/Ball';
import { Player, createPlayerMesh } from '../world/Player';
import {
  FIELD_TILES_X,
  FIELD_TILES_Y,
  areTilesEqual,
  createPitch,
  isTileInBounds,
  worldPositionToExtendedTileCoordinate,
} from '../world/Pitch';

const LOCAL_PLAYER_ID: ActorId = 'local-player';
const OPPONENT_PLAYER_ID: ActorId = 'opponent-player';
const PLAYER_TILES_PER_SECOND = 2;
const MAX_DEBUG_LINES = 8;

type MoveIntent = {
  playerId: ActorId;
  currentTile: { x: number; z: number };
  nextTile: { x: number; z: number };
};

type MovementResolution = {
  approvedIds: Set<ActorId>;
  contestLogs: string[];
};

export class Game {
  private readonly container: HTMLElement;
  private readonly scene: ReturnType<typeof createScene>;
  private readonly camera: ReturnType<typeof createCamera>;
  private readonly renderer: ReturnType<typeof createRenderer>;
  private readonly tilePicker: TilePicker;
  private readonly player: Player;
  private readonly opponent: Player;
  private readonly ball: Ball;
  private readonly playerMesh: ReturnType<typeof createPlayerMesh>;
  private readonly opponentMesh: ReturnType<typeof createPlayerMesh>;
  private readonly ballMesh: ReturnType<typeof createBallMesh>;
  private readonly debugOverlay: HTMLDivElement;
  private state: GameState;
  private debugLines: string[] = [];
  private animationFrameId: number | null = null;
  private previousFrameTime = 0;
  private tickNumber = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = createScene();
    this.camera = createCamera(container);
    this.renderer = createRenderer(container);

    this.player = new Player(
      LOCAL_PLAYER_ID,
      { x: Math.floor(FIELD_TILES_X / 2) - 2, z: Math.floor(FIELD_TILES_Y / 2) },
      0.9,
      1.8,
      PLAYER_TILES_PER_SECOND,
    );
    this.opponent = new Player(
      OPPONENT_PLAYER_ID,
      { x: Math.floor(FIELD_TILES_X / 2) + 2, z: Math.floor(FIELD_TILES_Y / 2) },
      0.9,
      1.8,
      PLAYER_TILES_PER_SECOND,
    );
    this.state = createInitialGameState(this.player.toModel(), this.opponent.toModel());
    this.ball = new Ball(this.state.ball, 0.28);
    const room = createRoom();
    const pitch = createPitch();

    this.playerMesh = createPlayerMesh(this.player);
    this.opponentMesh = createPlayerMesh(this.opponent);
    this.ballMesh = createBallMesh(this.ball);
    this.debugOverlay = this.createDebugOverlay();
    this.tilePicker = new TilePicker(
      this.renderer.domElement,
      this.camera,
      room.floorSurface,
      ({ x, z }) => worldPositionToExtendedTileCoordinate(x, z),
      this.handleTilePick,
    );

    this.scene.add(
      room.root,
      pitch.root,
      this.playerMesh,
      this.opponentMesh,
      this.ballMesh,
    );

    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  start(): void {
    this.handleResize();
    this.previousFrameTime = performance.now();
    this.tick();
  }

  dispose(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }

    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.tilePicker.dispose();
    this.renderer.dispose();
    this.debugOverlay.remove();
  }

  private readonly handleResize = (): void => {
    const { clientWidth, clientHeight } = this.container;
    const safeHeight = Math.max(clientHeight, 1);

    updateCameraFrustum(this.camera, clientWidth / safeHeight);
    this.renderer.setSize(clientWidth, safeHeight, false);
    this.render();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    const nextActivePlayerId =
      this.state.activePlayerId === LOCAL_PLAYER_ID
        ? OPPONENT_PLAYER_ID
        : LOCAL_PLAYER_ID;

    this.state = {
      ...this.buildGameState(),
      activePlayerId: nextActivePlayerId,
    };
    this.logDebug(`active player -> ${nextActivePlayerId}`);
  };

  private tick = (): void => {
    const now = performance.now();
    const deltaSeconds = (now - this.previousFrameTime) / 1000;
    this.previousFrameTime = now;

    this.tickNumber += 1;
    this.resolvePlayerMovementContests();
    this.player.update(deltaSeconds);
    this.opponent.update(deltaSeconds);
    this.ball.update(deltaSeconds);
    this.reconcileBallMovement();
    this.state = this.buildGameState();
    this.syncWorldMeshes();
    this.updateDebugOverlay();
    this.render();
    this.animationFrameId = window.requestAnimationFrame(this.tick);
  };

  private readonly handleTilePick = (tile: { x: number; z: number }): void => {
    const state = this.buildGameState();
    const activePlayerId = state.activePlayerId;
    const activePlayer = this.getPlayerInstance(activePlayerId);

    if (isTileInBounds(tile)) {
      const resolution = resolveClick(state, activePlayerId, tile);

      if (resolution.valid) {
        this.applyGameState(resolution.state);
        this.logDebug(
          `${activePlayerId} ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      } else if (resolution.handled) {
        this.logDebug(
          `${activePlayerId} ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      }
    }

    if (isTileOccupiedByOtherPlayer(tile, state, activePlayerId)) {
      this.logDebug(`${activePlayerId} move blocked @ (${tile.x},${tile.z}) occupied`);
      return;
    }

    const path = findTilePath(
      activePlayer.currentTile,
      tile,
      state.players,
      state.pitchSize,
      activePlayerId,
    );

    if (path.length === 0) {
      this.logDebug(`${activePlayerId} move blocked @ (${tile.x},${tile.z}) no path`);
      return;
    }

    activePlayer.setPath(
      tile,
      path.slice(1),
      activePlayer.nextTile !== null,
    );
    this.state = this.buildGameState();
    this.logDebug(
      `${activePlayerId} ${activePlayer.nextTile ? 'reroute' : 'move target'} -> (${tile.x},${tile.z}) path=${path.length - 1}`,
    );
  };

  private syncWorldMeshes(): void {
    this.player.syncMesh(this.playerMesh);
    this.opponent.syncMesh(this.opponentMesh);
    this.ball.syncMesh(this.ballMesh);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private buildGameState(): GameState {
    return {
      players: [this.player.toModel(), this.opponent.toModel()],
      activePlayerId: this.state.activePlayerId,
      ball: cloneBallModel(this.state.ball),
      pitchSize: {
        columns: FIELD_TILES_X,
        rows: FIELD_TILES_Y,
      },
    };
  }

  private applyGameState(state: GameState): void {
    this.state = state;
    this.ball.setModel(state.ball);

    const localPlayer = state.players.find((player) => player.id === LOCAL_PLAYER_ID);
    const opponentPlayer = state.players.find((player) => player.id === OPPONENT_PLAYER_ID);

    if (!localPlayer || !opponentPlayer) {
      return;
    }

    if (
      !areTilesEqual(localPlayer.currentTile, this.player.currentTile) ||
      !areTilesEqualOrBothNull(localPlayer.nextTile, this.player.nextTile) ||
      !areTilesEqual(localPlayer.targetTile, this.player.targetTile) ||
      !areTileArraysEqual(localPlayer.path, this.player.path)
    ) {
      this.player.applyModel(localPlayer);
    }

    if (
      !areTilesEqual(opponentPlayer.currentTile, this.opponent.currentTile) ||
      !areTilesEqualOrBothNull(opponentPlayer.nextTile, this.opponent.nextTile) ||
      !areTilesEqual(opponentPlayer.targetTile, this.opponent.targetTile) ||
      !areTileArraysEqual(opponentPlayer.path, this.opponent.path)
    ) {
      this.opponent.applyModel(opponentPlayer);
    }
  }

  private createDebugOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = '12px';
    overlay.style.top = '12px';
    overlay.style.zIndex = '10';
    overlay.style.minWidth = '240px';
    overlay.style.padding = '10px 12px';
    overlay.style.border = '1px solid rgba(255,255,255,0.2)';
    overlay.style.borderRadius = '8px';
    overlay.style.background = 'rgba(15, 23, 42, 0.82)';
    overlay.style.color = '#e5eefc';
    overlay.style.fontFamily = 'Consolas, "Courier New", monospace';
    overlay.style.fontSize = '12px';
    overlay.style.lineHeight = '1.4';
    overlay.style.pointerEvents = 'none';
    overlay.style.whiteSpace = 'pre-wrap';

    const containerStyle = window.getComputedStyle(this.container);
    if (containerStyle.position === 'static') {
      this.container.style.position = 'relative';
    }

    this.container.appendChild(overlay);
    return overlay;
  }

  private updateDebugOverlay(): void {
    const playerModel = this.player.toModel();
    const opponentModel = this.opponent.toModel();
    const ballModel = this.state.ball;

    const lines = [
      `tick         : ${this.tickNumber}`,
      `active       : ${this.state.activePlayerId}`,
      `p1 current   : (${playerModel.currentTile.x},${playerModel.currentTile.z})`,
      `p1 next      : ${formatTile(playerModel.nextTile)}`,
      `p1 target    : (${playerModel.targetTile.x},${playerModel.targetTile.z})`,
      `p1 path      : ${playerModel.path.length}`,
      `p2 current   : (${opponentModel.currentTile.x},${opponentModel.currentTile.z})`,
      `p2 next      : ${formatTile(opponentModel.nextTile)}`,
      `p2 target    : (${opponentModel.targetTile.x},${opponentModel.targetTile.z})`,
      `p2 path      : ${opponentModel.path.length}`,
      `ball state    : ${ballModel.state}`,
      `ball tile     : (${ballModel.tile.x},${ballModel.tile.z})`,
      `ball target   : ${formatTile(ballModel.moveTargetTile)}`,
      `controller    : ${ballModel.controllerId ?? 'none'}`,
      `ball path     : ${ballModel.path.length}`,
      '',
      'events:',
      ...this.debugLines,
    ];

    this.debugOverlay.textContent = lines.join('\n');
  }

  private logDebug(message: string): void {
    this.debugLines = [message, ...this.debugLines].slice(0, MAX_DEBUG_LINES);
    this.updateDebugOverlay();
  }

  private resolvePlayerMovementContests(): void {
    const players = [this.player, this.opponent];
    const snapshot = players.map((player) => player.toModel());

    for (const player of players) {
      this.recheckPathForPlayer(player, snapshot);
    }

    const refreshedSnapshot = players.map((player) => player.toModel());
    const intents = collectMoveIntents(players);
    const resolution = resolveApprovedMoveIds(intents, refreshedSnapshot, this.tickNumber);

    for (const contestLog of resolution.contestLogs) {
      this.logDebug(contestLog);
    }

    for (const player of players) {
      const intent = intents.find((entry) => entry.playerId === player.id);

      if (!intent) {
        player.cancelStepIfBlocked();
        continue;
      }

      if (resolution.approvedIds.has(player.id)) {
        this.tryResolveAutoPush(player.id, intent.currentTile, intent.nextTile);
        player.beginStep(intent.nextTile);
      } else {
        player.cancelStepIfBlocked();
      }
    }
  }

  private getPlayerInstance(actorId: ActorId): Player {
    return actorId === LOCAL_PLAYER_ID ? this.player : this.opponent;
  }

  private recheckPathForPlayer(
    player: Player,
    players: GameState['players'],
  ): void {
    const nextTile = player.getIntendedNextTile();

    if (!nextTile) {
      if (areTilesEqual(player.currentTile, player.targetTile)) {
        return;
      }

      const rebuiltPath = findTilePath(
        player.currentTile,
        player.targetTile,
        players,
        this.state.pitchSize,
        player.id,
      );

      if (rebuiltPath.length > 0) {
        player.setPath(player.targetTile, rebuiltPath.slice(1));
        this.logDebug(`${player.id} repath -> (${player.targetTile.x},${player.targetTile.z})`);
      } else {
        player.setPath(player.currentTile, []);
        this.logDebug(`${player.id} stopped @ (${player.currentTile.x},${player.currentTile.z})`);
      }

      return;
    }

    if (!isTileBlockedForMovement(nextTile, players, player.id)) {
      return;
    }

    const newPath = findTilePath(
      player.currentTile,
      player.targetTile,
      players,
      this.state.pitchSize,
      player.id,
    );

    if (newPath.length > 0) {
      player.setPath(player.targetTile, newPath.slice(1));
      this.logDebug(`${player.id} repath -> (${player.targetTile.x},${player.targetTile.z})`);
      return;
    }

    player.setPath(player.currentTile, []);
    this.logDebug(`${player.id} stopped @ (${player.currentTile.x},${player.currentTile.z})`);
  }

  private reconcileBallMovement(): void {
    const completedTile = this.ball.consumeCompletedSlideTile();

    if (!completedTile) {
      return;
    }

    const nextPath = dropLeadingTile(this.state.ball.path, completedTile);

    if (nextPath.length === 0) {
      const nextBall: BallModel = {
        ...this.state.ball,
        tile: completedTile,
        state: 'idle',
        moveTargetTile: null,
        totalPathLength: 0,
        pushableState: 0,
        animationTimeMs: 500,
        direction: null,
        controllerId: null,
        path: [],
      };
      this.state = {
        ...this.state,
        ball: nextBall,
      };
      this.ball.setModel(nextBall);
      return;
    }

    const nextBall: BallModel = {
      ...this.state.ball,
      tile: completedTile,
      moveTargetTile: { ...nextPath[0] },
      path: nextPath,
    };
    this.state = {
      ...this.state,
      ball: nextBall,
    };
    this.ball.setModel(nextBall);
  }

  private tryResolveAutoPush(
    actorId: ActorId,
    fromTile: { x: number; z: number },
    toTile: { x: number; z: number },
  ): void {
    const state = this.buildGameState();
    const actor = state.players.find((entry) => entry.id === actorId);

    if (!actor) {
      return;
    }

    const resolution = resolveAutoPush(state, actor, fromTile, toTile);

    if (!resolution.valid) {
      return;
    }

    this.applyGameState(resolution.state);
    this.logDebug(
      `${actorId} auto-push -> (${resolution.state.ball.moveTargetTile?.x ?? resolution.state.ball.tile.x},${resolution.state.ball.moveTargetTile?.z ?? resolution.state.ball.tile.z})`,
    );
  }
}

function isTileOccupiedByOtherPlayer(
  tile: { x: number; z: number },
  state: GameState,
  actorId: ActorId,
): boolean {
  return state.players.some((player) => {
    if (player.id === actorId) {
      return false;
    }

    return (
      areTilesEqual(player.currentTile, tile) ||
      (player.nextTile ? areTilesEqual(player.nextTile, tile) : false)
    );
  });
}

function areTilesEqualOrBothNull(
  a: { x: number; z: number } | null,
  b: { x: number; z: number } | null,
): boolean {
  if (!a && !b) {
    return true;
  }

  if (!a || !b) {
    return false;
  }

  return areTilesEqual(a, b);
}

function formatTile(tile: { x: number; z: number } | null): string {
  return tile ? `(${tile.x},${tile.z})` : '-';
}

function areTileArraysEqual(
  left: { x: number; z: number }[],
  right: { x: number; z: number }[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areTilesEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function createInitialGameState(
  player: GameState['players'][number],
  opponent: GameState['players'][number],
): GameState {
  const initialBall: BallModel = {
    tile: { x: Math.floor(FIELD_TILES_X / 2), z: Math.floor(FIELD_TILES_Y / 2) },
    state: 'idle',
    moveTargetTile: null,
    totalPathLength: 0,
    pushableState: 0,
    animationTimeMs: 500,
    direction: null,
    controllerId: null,
    path: [],
  };

  return {
    players: [player, opponent],
    activePlayerId: LOCAL_PLAYER_ID,
    ball: initialBall,
    pitchSize: {
      columns: FIELD_TILES_X,
      rows: FIELD_TILES_Y,
    },
  };
}

function collectMoveIntents(players: Player[]): MoveIntent[] {
  return players.flatMap((player) => {
    const nextTile = player.getIntendedNextTile();

    if (!nextTile) {
      return [];
    }

    return [{
      playerId: player.id,
      currentTile: { ...player.currentTile },
      nextTile,
    }];
  });
}

function resolveApprovedMoveIds(
  intents: MoveIntent[],
  players: GameState['players'],
  tickNumber: number,
): MovementResolution {
  const approvedIds = new Set<ActorId>();
  const blockedIds = new Set<ActorId>();
  const contestLogs: string[] = [];
  const intentById = new Map(intents.map((intent) => [intent.playerId, intent]));
  const contestedGroups = groupIntentsByDestination(intents);

  for (const intent of intents) {
    if (isTileReservedByActiveMover(intent.nextTile, players, intent.playerId)) {
      blockedIds.add(intent.playerId);
    }
  }

  for (let index = 0; index < intents.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < intents.length; otherIndex += 1) {
      const left = intents[index];
      const right = intents[otherIndex];

      if (isSwapConflict(left, right)) {
        blockedIds.add(left.playerId);
        blockedIds.add(right.playerId);
      }
    }
  }

  for (const intent of intents) {
    if (blockedIds.has(intent.playerId)) {
      continue;
    }

    if (isTileCommittedOccupied(intent.nextTile, players, intent.playerId)) {
      const occupant = getCommittedOccupant(intent.nextTile, players, intent.playerId);
      const occupantIntent = occupant ? intentById.get(occupant.id) : undefined;

      if (!occupantIntent || areTilesEqual(occupantIntent.nextTile, intent.nextTile)) {
        blockedIds.add(intent.playerId);
      }
    }
  }

  for (const group of contestedGroups.values()) {
    const eligible = group.filter((intent) => !blockedIds.has(intent.playerId));

    if (eligible.length <= 1) {
      continue;
    }

    const winner = resolveDestinationContest(eligible, tickNumber);
    contestLogs.push(
      `contest @ (${winner.nextTile.x},${winner.nextTile.z}) winner=${winner.playerId}`,
    );

    for (const intent of eligible) {
      if (intent.playerId !== winner.playerId) {
        blockedIds.add(intent.playerId);
      }
    }
  }

  for (const intent of intents) {
    if (!blockedIds.has(intent.playerId)) {
      approvedIds.add(intent.playerId);
    }
  }

  return {
    approvedIds,
    contestLogs,
  };
}

function groupIntentsByDestination(intents: MoveIntent[]): Map<string, MoveIntent[]> {
  const groups = new Map<string, MoveIntent[]>();

  for (const intent of intents) {
    const key = tileKey(intent.nextTile);
    const existing = groups.get(key);

    if (existing) {
      existing.push(intent);
      continue;
    }

    groups.set(key, [intent]);
  }

  return groups;
}

function isSwapConflict(left: MoveIntent, right: MoveIntent): boolean {
  return (
    areTilesEqual(left.nextTile, right.currentTile) &&
    areTilesEqual(right.nextTile, left.currentTile)
  );
}

function resolveDestinationContest(
  intents: MoveIntent[],
  tickNumber: number,
): MoveIntent {
  return intents.reduce((winner, candidate) => {
    const winnerKey = computeDeterministicTieBreakKey(
      winner.playerId,
      tickNumber,
      winner.nextTile,
    );
    const candidateKey = computeDeterministicTieBreakKey(
      candidate.playerId,
      tickNumber,
      candidate.nextTile,
    );

    if (candidateKey !== winnerKey) {
      return candidateKey < winnerKey ? candidate : winner;
    }

    return candidate.playerId < winner.playerId ? candidate : winner;
  });
}

function computeDeterministicTieBreakKey(
  playerId: ActorId,
  tickNumber: number,
  tile: { x: number; z: number },
): number {
  const input = `${tickNumber}:${tile.x}:${tile.z}:${playerId}`;
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function isTileCommittedOccupied(
  tile: { x: number; z: number },
  players: GameState['players'],
  actorId: ActorId,
): boolean {
  return Boolean(getCommittedOccupant(tile, players, actorId));
}

function getCommittedOccupant(
  tile: { x: number; z: number },
  players: GameState['players'],
  actorId: ActorId,
): GameState['players'][number] | undefined {
  return players.find((player) => {
    if (player.id === actorId) {
      return false;
    }

    return areTilesEqual(player.currentTile, tile);
  });
}

function isTileReservedByActiveMover(
  tile: { x: number; z: number },
  players: GameState['players'],
  actorId: ActorId,
): boolean {
  return players.some((player) => {
    if (player.id === actorId || !player.nextTile) {
      return false;
    }

    return areTilesEqual(player.nextTile, tile);
  });
}

function tileKey(tile: { x: number; z: number }): string {
  return `${tile.x}:${tile.z}`;
}

function dropLeadingTile(
  path: { x: number; z: number }[],
  tile: { x: number; z: number },
): { x: number; z: number }[] {
  if (path.length === 0) {
    return [];
  }

  if (areTilesEqual(path[0], tile)) {
    return path.slice(1).map((entry) => ({ ...entry }));
  }

  return path.map((entry) => ({ ...entry }));
}

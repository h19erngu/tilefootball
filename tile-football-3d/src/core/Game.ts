import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  RingGeometry,
} from 'three';
import {
  createCamera,
  DEFAULT_CAMERA_VIEW_ANGLE_DEGREES,
  setCameraViewAngle,
  updateCameraFrustum,
} from '../scene/createCamera';
import { createRoom } from '../scene/createRoom';
import { createRenderer } from '../scene/createRenderer';
import { createScene } from '../scene/createScene';
import { cloneBallModel } from './GameState';
import type { ActorId, BallModel, GameState } from './GameState';
import { findNearestReachableTile, findTilePath } from './findTilePath';
import { isTileBlockedForMovement } from './movementBlocking';
import {
  getPendingFreeBallInteraction,
  getPendingTrappedBallInteraction,
  resolveAutoPush,
  resolveClick,
  resolvePendingInteraction,
} from './RuleSystem';
import { TilePicker } from '../input/TilePicker';
import {
  Ball,
  createBallMesh,
  DEFAULT_BALL_APPEARANCE,
} from '../world/Ball';
import {
  AVATAR_PRESETS,
  Player,
  createPlayerMesh,
  getAvatarPresetById,
} from '../world/Player';
import {
  FIELD_TILES_X,
  FIELD_TILES_Y,
  WALKABLE_TILES_X,
  WALKABLE_TILES_Y,
  areTilesEqual,
  createPitch,
  getDirectionBetweenTiles,
  isTileInBounds,
  tileCoordinateToWorldPosition,
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

type TargetCursorMesh = {
  add: (...objects: unknown[]) => void;
  visible: boolean;
  position: {
    set: (x: number, y: number, z: number) => void;
    y: number;
  };
  scale: {
    x: number;
    z: number;
    set: (x: number, y: number, z: number) => void;
  };
  rotation: {
    z: number;
  };
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
  private playerMesh: ReturnType<typeof createPlayerMesh>;
  private opponentMesh: ReturnType<typeof createPlayerMesh>;
  private readonly ballMesh: ReturnType<typeof createBallMesh>;
  private readonly hoverCursor: TargetCursorMesh;
  private readonly moveTargetCursor: TargetCursorMesh;
  private readonly debugOverlay: HTMLDivElement;
  private readonly avatarPickerOverlay: HTMLDivElement;
  private state: GameState;
  private debugLines: string[] = [];
  private animationFrameId: number | null = null;
  private previousFrameTime = 0;
  private tickNumber = 0;
  private selectedAvatarId = AVATAR_PRESETS[0].id;
  private ballVisualScale = 1;
  private ballAppearance = { ...DEFAULT_BALL_APPEARANCE };

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

    this.playerMesh = createPlayerMesh(this.player, getAvatarPresetById(this.selectedAvatarId));
    this.opponentMesh = createPlayerMesh(this.opponent, AVATAR_PRESETS[1]);
    this.ballMesh = createBallMesh(this.ball, this.ballAppearance);
    this.hoverCursor = this.createHoverCursor();
    this.moveTargetCursor = this.createMoveTargetCursor();
    this.debugOverlay = this.createDebugOverlay();
    this.avatarPickerOverlay = this.createAvatarPickerOverlay();
    this.updateAvatarPickerSelection();
    this.applyBallVisualScale();
    setCameraViewAngle(this.camera, DEFAULT_CAMERA_VIEW_ANGLE_DEGREES);
    this.tilePicker = new TilePicker(
      this.renderer.domElement,
      this.camera,
      room.floorSurface,
      ({ x, z }) => worldPositionToExtendedTileCoordinate(x, z),
      this.handleTilePick,
      this.handleTileHover,
    );

    this.scene.add(
      room.root,
      pitch.root,
      this.playerMesh,
      this.opponentMesh,
      this.ballMesh,
      this.hoverCursor,
      this.moveTargetCursor,
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
    this.avatarPickerOverlay.remove();
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
    if (this.state.ball.state === 'trapped') {
      this.ball.setModel(this.state.ball);
    }
    this.syncWorldMeshes();
    this.animateMoveTargetCursor(now);
    this.updateDebugOverlay();
    this.render();
    this.animationFrameId = window.requestAnimationFrame(this.tick);
  };

  private readonly handleTilePick = (tile: { x: number; z: number }): void => {
    const state = this.buildGameState();
    const activePlayerId = state.activePlayerId;
    const activePlayer = this.getPlayerInstance(activePlayerId);
    const trappedPendingInteraction = getPendingTrappedBallInteraction(state, activePlayerId, tile);

    if (trappedPendingInteraction.valid && trappedPendingInteraction.pendingInteraction) {
      activePlayer.pendingInteraction = trappedPendingInteraction.pendingInteraction;
      activePlayer.dribbleDirection = null;
      this.requestMoveGoal(trappedPendingInteraction.pendingInteraction.clickedTile);
      this.logDebug(
        `${activePlayerId} pending ${trappedPendingInteraction.pendingInteraction.action} -> (${tile.x},${tile.z})`,
      );
      return;
    }

    if (trappedPendingInteraction.handled) {
      activePlayer.pendingInteraction = null;
      this.logDebug(
        `${activePlayerId} ball none @ (${tile.x},${tile.z}) ${trappedPendingInteraction.reason ?? 'ok'}`,
      );
      return;
    }

    const pendingInteraction = getPendingFreeBallInteraction(state, activePlayerId, tile);

    if (pendingInteraction) {
      activePlayer.pendingInteraction = pendingInteraction;
      activePlayer.dribbleDirection = null;
      this.requestMoveGoal(
        pendingInteraction.action === 'trap'
          ? pendingInteraction.clickedTile
          : state.ball.tile,
      );
      this.logDebug(`${activePlayerId} pending ${pendingInteraction.action} -> (${tile.x},${tile.z})`);
      return;
    }

    activePlayer.pendingInteraction = null;
    activePlayer.dribbleDirection = getDribbleDirection(activePlayer.currentTile, state.ball.tile, tile);

    if (isTileInBounds(tile)) {
      const resolution = resolveClick(state, activePlayerId, tile);

      if (resolution.valid) {
        this.applyGameState(resolution.state, false);
        this.logDebug(
          `${activePlayerId} ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      }

      if (resolution.handled && resolution.valid) {
        return;
      }

      if (resolution.handled) {
        this.logDebug(
          `${activePlayerId} ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      }
    }

    this.requestMoveGoal(tile);
  };

  private readonly handleTileHover = (tile: { x: number; z: number } | null): void => {
    if (!tile || !isTileInBounds(tile)) {
      this.hoverCursor.visible = false;
      return;
    }

    const worldPosition = tileCoordinateToWorldPosition(tile);
    this.hoverCursor.position.set(worldPosition.x, 0.045, worldPosition.z);
    this.hoverCursor.visible = true;
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
    return syncControlledBallState({
      players: [this.player.toModel(), this.opponent.toModel()],
      activePlayerId: this.state.activePlayerId,
      ball: cloneBallModel(this.state.ball),
      pitchSize: {
        columns: WALKABLE_TILES_X,
        rows: WALKABLE_TILES_Y,
      },
    });
  }

  private applyGameState(state: GameState, applyPlayers = true): void {
    this.state = state;
    this.ball.setModel(state.ball);

    if (!applyPlayers) {
      return;
    }

    const localPlayer = state.players.find((player) => player.id === LOCAL_PLAYER_ID);
    const opponentPlayer = state.players.find((player) => player.id === OPPONENT_PLAYER_ID);

    if (!localPlayer || !opponentPlayer) {
      return;
    }

    if (
      !areTilesEqual(localPlayer.currentTile, this.player.currentTile) ||
      !areTilesEqualOrBothNull(localPlayer.nextTile, this.player.nextTile) ||
      !areTilesEqual(localPlayer.targetTile, this.player.targetTile) ||
      !areTileArraysEqual(localPlayer.path, this.player.path) ||
      !arePendingInteractionsEqual(localPlayer.pendingInteraction ?? null, this.player.pendingInteraction)
    ) {
      this.player.applyModel(localPlayer);
    }

    if (
      !areTilesEqual(opponentPlayer.currentTile, this.opponent.currentTile) ||
      !areTilesEqualOrBothNull(opponentPlayer.nextTile, this.opponent.nextTile) ||
      !areTilesEqual(opponentPlayer.targetTile, this.opponent.targetTile) ||
      !areTileArraysEqual(opponentPlayer.path, this.opponent.path) ||
      !arePendingInteractionsEqual(opponentPlayer.pendingInteraction ?? null, this.opponent.pendingInteraction)
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

  private createMoveTargetCursor(): TargetCursorMesh {
    const ring = new Mesh(
      new RingGeometry(0.15, 0.27, 50),
      new MeshStandardMaterial({
        color: '#fff6bf',
        emissive: '#f4c84b',
        emissiveIntensity: 0.75,
        transparent: true,
        opacity: 0.95,
        side: 2,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.visible = false;

    return ring as unknown as TargetCursorMesh;
  }

  private createHoverCursor(): TargetCursorMesh {
    const square = createTileOutline(0.78, '#f6f277', 1);
    square.position.y = 0.045;
    square.visible = false;
    return square;
  }

  private setMoveTargetCursor(tile: { x: number; z: number }): void {
    const worldPosition = tileCoordinateToWorldPosition(tile);
    this.moveTargetCursor.position.set(worldPosition.x, 0.08, worldPosition.z);
    this.moveTargetCursor.visible = true;
  }

  private requestMoveGoal(tile: { x: number; z: number }): void {
    const state = this.buildGameState();
    const activePlayerId = state.activePlayerId;
    const activePlayer = this.getPlayerInstance(activePlayerId);
    const pathStart = getPathStartTile(activePlayer);
    const preferredViaBallTile = getPreferredViaBallTile(
      state,
      activePlayerId,
      activePlayer.dribbleDirection,
      tile,
    );
    const resolution = resolveGoalPath(
      pathStart,
      tile,
      state.players,
      state.pitchSize,
      activePlayerId,
      preferredViaBallTile,
    );

    if (!resolution) {
      activePlayer.pendingInteraction = null;
      activePlayer.dribbleDirection = null;
      this.logDebug(`${activePlayerId} move blocked @ (${tile.x},${tile.z}) no path`);
      return;
    }

    this.setMoveTargetCursor(resolution.goal);
    activePlayer.setPath(
      resolution.goal,
      resolution.path.slice(1),
      activePlayer.nextTile !== null,
    );
    this.state = this.buildGameState();

    if (areTilesEqual(resolution.goal, tile)) {
      this.logDebug(
        `${activePlayerId} ${activePlayer.nextTile ? 'reroute' : 'move target'} -> (${resolution.goal.x},${resolution.goal.z}) path=${resolution.path.length - 1}`,
      );
      return;
    }

    this.logDebug(
      `${activePlayerId} snap target -> (${resolution.goal.x},${resolution.goal.z}) from (${tile.x},${tile.z}) path=${resolution.path.length - 1}`,
    );
  }

  private animateMoveTargetCursor(now: number): void {
    if (!this.moveTargetCursor.visible) {
      return;
    }

    const activePlayer = this.getPlayerInstance(this.state.activePlayerId);

    if (
      areTilesEqual(activePlayer.currentTile, activePlayer.targetTile) &&
      activePlayer.nextTile === null
    ) {
      this.moveTargetCursor.visible = false;
      return;
    }

    const pulse = 1 + Math.sin(now * 0.008) * 0.06;
    this.moveTargetCursor.rotation.z = 0;
    this.moveTargetCursor.position.y = 0.08;
    this.moveTargetCursor.scale.set(pulse, 1, pulse);
  }

  private createAvatarPickerOverlay(): HTMLDivElement {
    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.right = '12px';
    overlay.style.top = '12px';
    overlay.style.zIndex = '10';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.gap = '8px';
    overlay.style.width = '184px';
    overlay.style.padding = '10px 12px';
    overlay.style.border = '1px solid rgba(255,255,255,0.2)';
    overlay.style.borderRadius = '8px';
    overlay.style.background = 'rgba(15, 23, 42, 0.82)';
    overlay.style.color = '#e5eefc';
    overlay.style.fontFamily = 'Segoe UI, Tahoma, Geneva, Verdana, sans-serif';
    overlay.style.fontSize = '12px';
    overlay.style.pointerEvents = 'auto';

    const title = document.createElement('div');
    title.textContent = 'Avatar Pick';
    title.style.fontWeight = '700';
    title.style.letterSpacing = '0.04em';
    title.style.textTransform = 'uppercase';

    overlay.appendChild(title);

    for (const preset of AVATAR_PRESETS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = preset.label;
      button.dataset.avatarId = preset.id;
      button.style.padding = '8px 10px';
      button.style.border = '1px solid rgba(255,255,255,0.16)';
      button.style.borderRadius = '6px';
      button.style.background = 'rgba(255,255,255,0.06)';
      button.style.color = '#f5f7fb';
      button.style.font = 'inherit';
      button.style.textAlign = 'left';
      button.style.cursor = 'pointer';
      button.addEventListener('click', () => {
        this.setSelectedAvatar(preset.id);
      });
      overlay.appendChild(button);
    }

    const containerStyle = window.getComputedStyle(this.container);
    if (containerStyle.position === 'static') {
      this.container.style.position = 'relative';
    }

    this.container.appendChild(overlay);
    return overlay;
  }

  private setSelectedAvatar(avatarId: string): void {
    if (this.selectedAvatarId === avatarId) {
      return;
    }

    this.selectedAvatarId = avatarId;
    this.scene.remove(this.playerMesh);
    this.playerMesh = createPlayerMesh(this.player, getAvatarPresetById(avatarId));
    this.scene.add(this.playerMesh);
    this.updateAvatarPickerSelection();
    this.render();
  }

  private updateAvatarPickerSelection(): void {
    const buttons = this.avatarPickerOverlay.querySelectorAll<HTMLButtonElement>('button[data-avatar-id]');

    for (const button of buttons) {
      const isActive = button.dataset.avatarId === this.selectedAvatarId;
      button.style.background = isActive ? 'rgba(217, 67, 61, 0.35)' : 'rgba(255,255,255,0.06)';
      button.style.borderColor = isActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.16)';
      button.style.fontWeight = isActive ? '700' : '500';
    }
  }

  private applyBallVisualScale(): void {
    this.ballMesh.scale.set(this.ballVisualScale, this.ballVisualScale, this.ballVisualScale);
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

      this.repathPlayerToGoal(player, players);

      return;
    }

    if (!isTileBlockedForMovement(nextTile, players, player.id)) {
      return;
    }

    this.repathPlayerToGoal(player, players);
  }

  private repathPlayerToGoal(
    player: Player,
    players: GameState['players'],
  ): void {
    const pathStart = getPathStartTile(player);
    const resolution = resolveGoalPath(
      pathStart,
      player.targetTile,
      players,
      this.state.pitchSize,
      player.id,
    );

    if (!resolution) {
      player.setPath(player.currentTile, []);
      player.pendingInteraction = null;
      player.dribbleDirection = null;
      this.logDebug(`${player.id} stopped @ (${player.currentTile.x},${player.currentTile.z})`);
      return;
    }

    player.setPath(
      resolution.goal,
      resolution.path.slice(1),
      player.nextTile !== null,
    );

    if (areTilesEqual(resolution.goal, player.targetTile)) {
      this.logDebug(`${player.id} repath -> (${resolution.goal.x},${resolution.goal.z})`);
      return;
    }

    this.logDebug(`${player.id} repath snap -> (${resolution.goal.x},${resolution.goal.z})`);
  }

  private reconcileBallMovement(): void {
    const completedTile = this.ball.consumeCompletedSlideTile();

    if (!completedTile) {
      return;
    }

    const nextPath = dropLeadingTile(this.state.ball.path, completedTile);

    if (nextPath.length === 0) {
      const nextState = this.state.ball.controllerId
        ? 'trapped'
        : 'idle';
      const nextBall: BallModel = {
        ...this.state.ball,
        tile: completedTile,
        state: nextState,
        moveTargetTile: null,
        totalPathLength: 0,
        pushableState: 0,
        animationTimeMs: 500,
        direction: null,
        controllerId: nextState === 'trapped' ? this.state.ball.controllerId : null,
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
    const player = this.getPlayerInstance(actorId);

    if (!actor || !player) {
      return;
    }

    if (actor.pendingInteraction) {
      const pendingResolution = resolvePendingInteraction(state, actor, fromTile, toTile);

      if (pendingResolution.valid) {
        this.applyGameState(pendingResolution.state, false);
        player.pendingInteraction = null;
        player.dribbleDirection = null;
        this.logDebug(
          `${actorId} ${pendingResolution.action} -> (${pendingResolution.state.ball.tile.x},${pendingResolution.state.ball.tile.z})`,
        );
        return;
      }

      if (areTilesEqual(toTile, state.ball.tile)) {
        player.pendingInteraction = null;
        player.dribbleDirection = null;
      }
    }

    if (areTilesEqual(actor.targetTile, state.ball.tile)) {
      const stepDirection = getDirectionBetweenTiles(fromTile, toTile);

      if (
        !stepDirection ||
        !actor.dribbleDirection ||
        actor.dribbleDirection.x !== stepDirection.x ||
        actor.dribbleDirection.z !== stepDirection.z
      ) {
        player.dribbleDirection = null;
        return;
      }
    }

    const resolution = resolveAutoPush(state, actor, fromTile, toTile);

    if (!resolution.valid) {
      return;
    }

    this.applyGameState(resolution.state, false);
    const stepDirection = getDirectionBetweenTiles(fromTile, toTile);
    const movedToBallTarget = areTilesEqual(actor.targetTile, state.ball.tile);

    if (movedToBallTarget) {
      player.dribbleDirection = null;
    } else if (stepDirection) {
      player.dribbleDirection = { ...stepDirection };
    }

    this.logDebug(
      `${actorId} auto-push -> (${resolution.state.ball.moveTargetTile?.x ?? resolution.state.ball.tile.x},${resolution.state.ball.moveTargetTile?.z ?? resolution.state.ball.tile.z})`,
    );
  }
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

function arePendingInteractionsEqual(
  left: GameState['players'][number]['pendingInteraction'] | null,
  right: GameState['players'][number]['pendingInteraction'] | null,
): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  if (left.action !== right.action || !areTilesEqual(left.clickedTile, right.clickedTile)) {
    return false;
  }

  if (!left.originTile && !right.originTile) {
    return true;
  }

  if (!left.originTile || !right.originTile) {
    return false;
  }

  return areTilesEqual(left.originTile, right.originTile);
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
      columns: WALKABLE_TILES_X,
      rows: WALKABLE_TILES_Y,
    },
  };
}

function createTileOutline(
  size: number,
  color: string,
  opacity: number,
  thickness = 0.04,
): TargetCursorMesh {
  const outerHalfSize = size / 2;
  const innerHalfSize = Math.max(outerHalfSize - thickness, 0);
  const vertices = [
    -outerHalfSize, 0, -outerHalfSize, outerHalfSize, 0, -outerHalfSize,
    outerHalfSize, 0, -outerHalfSize, outerHalfSize, 0, outerHalfSize,
    outerHalfSize, 0, outerHalfSize, -outerHalfSize, 0, outerHalfSize,
    -outerHalfSize, 0, outerHalfSize, -outerHalfSize, 0, -outerHalfSize,
    -innerHalfSize, 0, -innerHalfSize, innerHalfSize, 0, -innerHalfSize,
    innerHalfSize, 0, -innerHalfSize, innerHalfSize, 0, innerHalfSize,
    innerHalfSize, 0, innerHalfSize, -innerHalfSize, 0, innerHalfSize,
    -innerHalfSize, 0, innerHalfSize, -innerHalfSize, 0, -innerHalfSize,
  ];

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));

  return new LineSegments(
    geometry,
    new LineBasicMaterial({
      color,
      transparent: true,
      opacity,
    }),
  ) as unknown as TargetCursorMesh;
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

function resolveGoalPath(
  start: { x: number; z: number },
  desiredGoal: { x: number; z: number },
  players: GameState['players'],
  pitchSize: GameState['pitchSize'],
  actorId: ActorId,
  preferredViaTile?: { x: number; z: number } | null,
): { goal: { x: number; z: number }; path: { x: number; z: number }[] } | null {
  if (preferredViaTile && !areTilesEqual(start, preferredViaTile)) {
    const firstLeg = findTilePath(start, preferredViaTile, players, pitchSize, actorId);
    const secondLeg = findTilePath(preferredViaTile, desiredGoal, players, pitchSize, actorId);

    if (firstLeg.length > 0 && secondLeg.length > 0) {
      return {
        goal: { ...desiredGoal },
        path: [...firstLeg, ...secondLeg.slice(1)],
      };
    }
  }

  const directPath = findTilePath(start, desiredGoal, players, pitchSize, actorId);

  if (directPath.length > 0) {
    return {
      goal: { ...desiredGoal },
      path: directPath,
    };
  }

  return findNearestReachableTile(start, desiredGoal, players, pitchSize, actorId);
}

function getPathStartTile(player: Player): { x: number; z: number } {
  return player.nextTile ? { ...player.nextTile } : { ...player.currentTile };
}

function getDribbleDirection(
  playerTile: { x: number; z: number },
  ballTile: { x: number; z: number },
  clickedTile: { x: number; z: number },
): { x: -1 | 0 | 1; z: -1 | 0 | 1 } | null {
  if (areTilesEqual(clickedTile, ballTile)) {
    return null;
  }

  const playerToBall = getDirectionBetweenTiles(playerTile, ballTile);
  const ballToTarget = getDirectionBetweenTiles(ballTile, clickedTile);

  if (!playerToBall || !ballToTarget) {
    return null;
  }

  return playerToBall.x === ballToTarget.x && playerToBall.z === ballToTarget.z
    ? { ...playerToBall }
    : null;
}

function getPreferredViaBallTile(
  state: GameState,
  actorId: ActorId,
  dribbleDirection: { x: -1 | 0 | 1; z: -1 | 0 | 1 } | null | undefined,
  clickedTile: { x: number; z: number },
): { x: number; z: number } | null {
  if (state.ball.state !== 'idle' || !dribbleDirection) {
    return null;
  }

  const actor = state.players.find((player) => player.id === actorId);

  if (!actor || areTilesEqual(clickedTile, state.ball.tile)) {
    return null;
  }

  const ballToTarget = getDirectionBetweenTiles(state.ball.tile, clickedTile);

  if (
    !ballToTarget ||
    ballToTarget.x !== dribbleDirection.x ||
    ballToTarget.z !== dribbleDirection.z
  ) {
    return null;
  }

  return { ...state.ball.tile };
}

function syncControlledBallState(state: GameState): GameState {
  if (state.ball.state !== 'trapped' || !state.ball.controllerId) {
    return state;
  }

  return {
    ...state,
    ball: {
      ...state.ball,
      moveTargetTile: null,
      totalPathLength: 0,
      path: [],
      direction: null,
    },
  };
}

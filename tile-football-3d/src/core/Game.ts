import { createCamera, updateCameraFrustum } from '../scene/createCamera';
import { createRoom } from '../scene/createRoom';
import { createRenderer } from '../scene/createRenderer';
import { createScene } from '../scene/createScene';
import type { ActorId, BallModel, GameState } from './GameState';
import { resolveClick } from './RuleSystem';
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
const PLAYER_TILES_PER_SECOND = 2;
const MAX_DEBUG_LINES = 8;

export class Game {
  private readonly container: HTMLElement;
  private readonly scene: ReturnType<typeof createScene>;
  private readonly camera: ReturnType<typeof createCamera>;
  private readonly renderer: ReturnType<typeof createRenderer>;
  private readonly tilePicker: TilePicker;
  private readonly player: Player;
  private readonly ball: Ball;
  private readonly playerMesh: ReturnType<typeof createPlayerMesh>;
  private readonly ballMesh: ReturnType<typeof createBallMesh>;
  private readonly debugOverlay: HTMLDivElement;
  private state: GameState;
  private debugLines: string[] = [];
  private animationFrameId: number | null = null;
  private previousFrameTime = 0;

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
    this.state = createInitialGameState(this.player.toModel());
    this.ball = new Ball(this.state.ball, 0.28);
    const room = createRoom();
    const pitch = createPitch();

    this.playerMesh = createPlayerMesh(this.player);
    this.ballMesh = createBallMesh(this.ball);
    this.debugOverlay = this.createDebugOverlay();
    this.tilePicker = new TilePicker(
      this.renderer.domElement,
      this.camera,
      room.floorSurface,
      ({ x, z }) => worldPositionToExtendedTileCoordinate(x, z),
      this.handleTilePick,
    );

    this.scene.add(room.root, pitch.root, this.playerMesh, this.ballMesh);

    window.addEventListener('resize', this.handleResize);
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

  private tick = (): void => {
    const now = performance.now();
    const deltaSeconds = (now - this.previousFrameTime) / 1000;
    this.previousFrameTime = now;

    this.player.update(deltaSeconds);
    this.ball.update(deltaSeconds);
    this.state = this.buildGameState();
    this.syncWorldMeshes();
    this.updateDebugOverlay();
    this.render();
    this.animationFrameId = window.requestAnimationFrame(this.tick);
  };

  private readonly handleTilePick = (tile: { x: number; z: number }): void => {
    const state = this.buildGameState();

    if (isTileInBounds(tile)) {
      const resolution = resolveClick(state, LOCAL_PLAYER_ID, tile);

      if (resolution.valid) {
        this.applyGameState(resolution.state);
        this.logDebug(
          `ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      } else if (resolution.handled) {
        this.logDebug(
          `ball ${resolution.action} @ (${tile.x},${tile.z}) ${resolution.reason ?? 'ok'}`,
        );
      }
    }

    if (isTileOccupiedByOtherPlayer(tile, state, LOCAL_PLAYER_ID)) {
      this.logDebug(`move blocked @ (${tile.x},${tile.z}) occupied`);
      return;
    }

    this.player.setTargetTile(tile);
    this.state = this.buildGameState();
    this.logDebug(`move target -> (${tile.x},${tile.z})`);
  };

  private syncWorldMeshes(): void {
    this.player.syncMesh(this.playerMesh);
    this.ball.syncMesh(this.ballMesh);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private buildGameState(): GameState {
    return {
      players: [this.player.toModel()],
      activePlayerId: LOCAL_PLAYER_ID,
      ball: this.ball.getModel(),
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

    if (!localPlayer) {
      return;
    }

    if (
      !areTilesEqual(localPlayer.currentTile, this.player.currentTile) ||
      !areTilesEqualOrBothNull(localPlayer.nextTile, this.player.nextTile) ||
      !areTilesEqual(localPlayer.targetTile, this.player.targetTile)
    ) {
      this.player.applyModel(localPlayer);
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
    const ballModel = this.ball.getModel();

    const lines = [
      `player current: (${playerModel.currentTile.x},${playerModel.currentTile.z})`,
      `player next   : ${formatTile(playerModel.nextTile)}`,
      `player target : (${playerModel.targetTile.x},${playerModel.targetTile.z})`,
      `ball state    : ${ballModel.state}`,
      `ball tile     : (${ballModel.tile.x},${ballModel.tile.z})`,
      `controller    : ${ballModel.controllerId ?? 'none'}`,
      `ball path     : ${ballModel.remainingPath.length}`,
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

    return areTilesEqual(player.currentTile, tile);
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

function createInitialGameState(player: GameState['players'][number]): GameState {
  const initialBall: BallModel = {
    tile: { x: Math.floor(FIELD_TILES_X / 2), z: Math.floor(FIELD_TILES_Y / 2) },
    state: 'idle',
    direction: null,
    controllerId: null,
    path: [],
    remainingPath: [],
  };

  return {
    players: [player],
    activePlayerId: LOCAL_PLAYER_ID,
    ball: initialBall,
    pitchSize: {
      columns: FIELD_TILES_X,
      rows: FIELD_TILES_Y,
    },
  };
}

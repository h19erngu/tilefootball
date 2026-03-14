import { createCamera, updateCameraFrustum } from '../scene/createCamera';
import { createRenderer } from '../scene/createRenderer';
import { createScene } from '../scene/createScene';
import { TilePicker } from '../input/TilePicker';
import { Ball, createBallMesh } from '../world/Ball';
import { Player, createPlayerMesh } from '../world/Player';
import { createPitch, tileCoordinateToWorldPosition } from '../world/Pitch';

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
  private animationFrameId: number | null = null;
  private previousFrameTime = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = createScene();
    this.camera = createCamera(container);
    this.renderer = createRenderer(container);

    this.player = new Player({ x: 6, z: 4 }, 0.9, 1.8);
    this.ball = new Ball(tileCoordinateToWorldPosition({ x: 7, z: 4 }), 0.28);
    const pitch = createPitch();

    this.playerMesh = createPlayerMesh(this.player);
    this.ballMesh = createBallMesh(this.ball);
    this.tilePicker = new TilePicker(
      this.renderer.domElement,
      this.camera,
      pitch.surface,
      (tile) => {
        this.player.setTargetTile(tile);
        console.log('Picked tile:', tile);
      },
    );

    this.scene.add(pitch.root, this.playerMesh, this.ballMesh);

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
    this.syncWorldMeshes();
    this.render();
    this.animationFrameId = window.requestAnimationFrame(this.tick);
  };

  private syncWorldMeshes(): void {
    this.player.syncMesh(this.playerMesh);
    this.ball.syncMesh(this.ballMesh);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}

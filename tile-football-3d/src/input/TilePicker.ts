import { Raycaster, Vector2 } from 'three';
import type { TileCoordinate } from '../world/Pitch';
import { worldPositionToTileCoordinate } from '../world/Pitch';

type TilePickHandler = (tile: TileCoordinate) => void;

export class TilePicker {
  private readonly domElement: HTMLElement;
  private readonly camera: object;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly onPick: TilePickHandler;
  private readonly target: object;

  constructor(
    domElement: HTMLElement,
    camera: object,
    target: object,
    onPick: TilePickHandler,
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.target = target;
    this.onPick = onPick;

    this.domElement.addEventListener('click', this.handleClick);
  }

  dispose(): void {
    this.domElement.removeEventListener('click', this.handleClick);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObject(this.target, false);
    const hit = intersections[0];

    if (!hit) {
      return;
    }

    const tile = worldPositionToTileCoordinate(hit.point.x, hit.point.z);

    if (!tile) {
      return;
    }

    this.onPick(tile);
  };
}

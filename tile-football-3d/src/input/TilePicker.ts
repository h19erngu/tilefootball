import { Raycaster, Vector2 } from 'three';
import type { TileCoordinate } from '../world/Pitch';

type TilePickHandler = (tile: TileCoordinate) => void;
type TileHoverHandler = (tile: TileCoordinate | null) => void;
type TileMapper = (point: { x: number; z: number }) => TileCoordinate | null;

export class TilePicker {
  private readonly domElement: HTMLElement;
  private readonly camera: object;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly onPick: TilePickHandler;
  private readonly onHover: TileHoverHandler;
  private readonly mapPointToTile: TileMapper;
  private readonly target: object;

  constructor(
    domElement: HTMLElement,
    camera: object,
    target: object,
    mapPointToTile: TileMapper,
    onPick: TilePickHandler,
    onHover?: TileHoverHandler,
  ) {
    this.domElement = domElement;
    this.camera = camera;
    this.target = target;
    this.mapPointToTile = mapPointToTile;
    this.onPick = onPick;
    this.onHover = onHover ?? (() => undefined);

    this.domElement.addEventListener('click', this.handleClick);
    this.domElement.addEventListener('pointermove', this.handlePointerMove);
    this.domElement.addEventListener('pointerleave', this.handlePointerLeave);
  }

  dispose(): void {
    this.domElement.removeEventListener('click', this.handleClick);
    this.domElement.removeEventListener('pointermove', this.handlePointerMove);
    this.domElement.removeEventListener('pointerleave', this.handlePointerLeave);
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const tile = this.pickTile(event.clientX, event.clientY);

    if (!tile) {
      return;
    }

    this.onPick(tile);
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    this.onHover(this.pickTile(event.clientX, event.clientY));
  };

  private readonly handlePointerLeave = (): void => {
    this.onHover(null);
  };

  private pickTile(clientX: number, clientY: number): TileCoordinate | null {
    const rect = this.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.pointer, this.camera);

    const intersections = this.raycaster.intersectObject(this.target, false);
    const hit = intersections[0];

    if (!hit) {
      return null;
    }

    return this.mapPointToTile({
      x: hit.point.x,
      z: hit.point.z,
    });
  }
}

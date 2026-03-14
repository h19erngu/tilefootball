import { OrthographicCamera } from 'three';

const CAMERA_FRUSTUM_SIZE = 20;

export function createCamera(container: HTMLElement) {
  const aspect = getAspectRatio(container);
  const camera = new OrthographicCamera();

  updateCameraFrustum(camera, aspect);
  camera.position.set(13, 15, 13);
  camera.lookAt(1.2, 0, 1.1);

  return camera;
}

export function updateCameraFrustum(camera: { left: number; right: number; top: number; bottom: number; near: number; far: number; zoom: number; updateProjectionMatrix: () => void }, aspect: number): void {
  const halfHeight = CAMERA_FRUSTUM_SIZE / 2;
  const halfWidth = halfHeight * aspect;

  camera.left = -halfWidth;
  camera.right = halfWidth;
  camera.top = halfHeight;
  camera.bottom = -halfHeight;
  camera.near = 0.1;
  camera.far = 100;
  camera.zoom = 1.08;
  camera.updateProjectionMatrix();
}

function getAspectRatio(container: HTMLElement): number {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);

  return width / height;
}

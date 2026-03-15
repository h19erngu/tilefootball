import { OrthographicCamera } from 'three';

const CAMERA_FRUSTUM_SIZE = 20;
const CAMERA_TARGET = { x: 1.2, y: 0, z: 1.1 };
const CAMERA_HORIZONTAL_DISTANCE = Math.hypot(13 - CAMERA_TARGET.x, 13 - CAMERA_TARGET.z);
const CAMERA_AZIMUTH = Math.atan2(13 - CAMERA_TARGET.z, 13 - CAMERA_TARGET.x);

export const DEFAULT_CAMERA_VIEW_ANGLE_DEGREES = 34;

type CameraViewTarget = {
  position: { set: (x: number, y: number, z: number) => void };
  lookAt: (x: number, y: number, z: number) => void;
  updateMatrixWorld: () => void;
};

export function createCamera(container: HTMLElement) {
  const aspect = getAspectRatio(container);
  const camera = new OrthographicCamera();

  updateCameraFrustum(camera, aspect);
  setCameraViewAngle(camera, DEFAULT_CAMERA_VIEW_ANGLE_DEGREES);

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

export function setCameraViewAngle(
  camera: CameraViewTarget,
  angleDegrees: number,
): void {
  const angleRadians = (angleDegrees * Math.PI) / 180;
  const height = Math.tan(angleRadians) * CAMERA_HORIZONTAL_DISTANCE;
  const offsetX = Math.cos(CAMERA_AZIMUTH) * CAMERA_HORIZONTAL_DISTANCE;
  const offsetZ = Math.sin(CAMERA_AZIMUTH) * CAMERA_HORIZONTAL_DISTANCE;

  camera.position.set(
    CAMERA_TARGET.x + offsetX,
    height,
    CAMERA_TARGET.z + offsetZ,
  );
  camera.lookAt(CAMERA_TARGET.x, CAMERA_TARGET.y, CAMERA_TARGET.z);
  camera.updateMatrixWorld();
}

function getAspectRatio(container: HTMLElement): number {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);

  return width / height;
}

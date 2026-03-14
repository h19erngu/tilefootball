import {
  AmbientLight,
  Color,
  DirectionalLight,
  Scene,
} from 'three';

export function createScene() {
  const scene = new Scene();
  scene.background = new Color('#87b8ff');

  const ambientLight = new AmbientLight('#ffffff', 1.8);
  const directionalLight = new DirectionalLight('#ffffff', 2.2);
  directionalLight.position.set(8, 14, 10);

  scene.add(ambientLight, directionalLight);

  return scene;
}

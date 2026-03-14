import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  Scene,
} from 'three';

export function createScene() {
  const scene = new Scene();
  scene.background = new Color('#121318');

  const ambientLight = new AmbientLight('#ffffff', 1.15);
  const hemisphereLight = new HemisphereLight('#f5f1da', '#5d4b3c', 1.2);
  const directionalLight = new DirectionalLight('#fff4d6', 2.4);
  directionalLight.position.set(10, 16, 8);

  scene.add(ambientLight, hemisphereLight, directionalLight);

  return scene;
}

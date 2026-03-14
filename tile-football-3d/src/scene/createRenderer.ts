import { SRGBColorSpace, WebGLRenderer } from 'three';

export function createRenderer(container: HTMLElement) {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;

  container.appendChild(renderer.domElement);

  return renderer;
}

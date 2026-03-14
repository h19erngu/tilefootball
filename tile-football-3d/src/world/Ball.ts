import { Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { WorldPosition } from './Pitch';

type PositionableMesh = {
  position: {
    set: (x: number, y: number, z: number) => void;
  };
};

export class Ball {
  public position: WorldPosition;
  public radius: number;

  constructor(position: WorldPosition, radius: number) {
    this.position = position;
    this.radius = radius;
  }

  syncMesh(mesh: PositionableMesh): void {
    mesh.position.set(this.position.x, this.radius, this.position.z);
  }
}

export function createBallMesh(ball: Ball) {
  const mesh = new Mesh(
    new SphereGeometry(ball.radius, 24, 24),
    new MeshStandardMaterial({ color: '#f8fafc' }),
  );

  ball.syncMesh(mesh);

  return mesh;
}

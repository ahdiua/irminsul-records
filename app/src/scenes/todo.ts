// Placeholder for a timeline entry whose scene module is missing: a dark frame.
import type * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { clearRT } from '../engine/gl';

export default class Todo extends Scene {
  render(_f: Frame, out: THREE.WebGLRenderTarget) {
    clearRT(this.ctx.renderer, out, [0.01, 0.012, 0.02]);
  }
}

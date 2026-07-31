import type { Material, Object3D, Texture, WebGLRenderer } from 'three';
import { InstancedMesh, Line, Mesh } from 'three';

function disposeTexture(texture: Texture | null | undefined) {
  texture?.dispose();
}

function disposeMaterial(material: Material) {
  const textured = material as Material & {
    map?: Texture | null;
    lightMap?: Texture | null;
    bumpMap?: Texture | null;
    normalMap?: Texture | null;
    specularMap?: Texture | null;
    envMap?: Texture | null;
    alphaMap?: Texture | null;
    aoMap?: Texture | null;
    displacementMap?: Texture | null;
    emissiveMap?: Texture | null;
    metalnessMap?: Texture | null;
    roughnessMap?: Texture | null;
  };
  disposeTexture(textured.map);
  disposeTexture(textured.lightMap);
  disposeTexture(textured.bumpMap);
  disposeTexture(textured.normalMap);
  disposeTexture(textured.specularMap);
  disposeTexture(textured.envMap);
  disposeTexture(textured.alphaMap);
  disposeTexture(textured.aoMap);
  disposeTexture(textured.displacementMap);
  disposeTexture(textured.emissiveMap);
  disposeTexture(textured.metalnessMap);
  disposeTexture(textured.roughnessMap);
  material.dispose();
}

function disposeObjectResources(object: Object3D) {
  if (object instanceof Mesh || object instanceof InstancedMesh || object instanceof Line) {
    object.geometry?.dispose();
    const material = object.material;
    if (Array.isArray(material)) {
      for (const entry of material) disposeMaterial(entry);
    } else if (material) {
      disposeMaterial(material);
    }
  }
}

/** Traverse scene graph and free GPU resources (geometries, materials, textures). */
export function disposeSceneResources(root: Object3D) {
  root.traverse(disposeObjectResources);
}

/** Tear down the WebGL renderer and force context loss so the GPU can reclaim memory. */
export function disposeWebGLRenderer(gl: WebGLRenderer) {
  gl.dispose();
  const lose = gl.getContext()?.getExtension?.('WEBGL_lose_context') as
    | { loseContext: () => void }
    | null
    | undefined;
  lose?.loseContext();
}

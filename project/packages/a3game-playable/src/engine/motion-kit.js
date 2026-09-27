/**
 * Motion for generated characters: import it, or rig for it.
 *
 * The problem this module exists to solve is specific to generated art.
 * `three.assets.import_avatar` stages whatever the 3D generator produced,
 * and image-to-3D produces **one fused body with no skeleton**: the
 * manifest entry reports `animations: []` and `skinned: false`. A game
 * that swaps its procedural body for such a model and then asks
 * `A3GameAnimationDirector` for a walk cycle gets nothing — the model is
 * not broken, it simply has no bones and no clips. The result on screen
 * is the worst of both worlds: a good-looking character sliding around
 * frozen, because the primitive limbs that *were* being animated went
 * away with the swap.
 *
 * So there are exactly three ways a generated character can move, and
 * this module implements all three behind one call
 * (`createAnimatedActor`), in preference order:
 *
 *   1. **The model brings its own clips.** A downloaded CC0 character
 *      (`RobotExpressive.glb`, 14 clips) or a generated character that
 *      went through `pipeline/assets_gen/gen_motion` and was re-exported
 *      with its animation. Nothing to do but play them.
 *   2. **Clips are imported separately and retargeted.** The motion
 *      pipeline writes a skeleton-bearing clip; the runtime maps its bone
 *      names onto the avatar's own skeleton. `retargetClipToSkeleton`
 *      does the name half — the only half that can be done in a browser.
 *   3. **The model is auto-rigged here and driven by procedural clips.**
 *      A humanoid mesh with no skeleton gets a fitted template skeleton
 *      and computed skin weights, then plays authored clips (walk, run,
 *      punch, flying kick, aim, shoot, hit, death). This is the case that
 *      actually applies to TRELLIS.2 output today, and it is why this
 *      module is not just a manifest reader.
 *
 * And one deliberate refusal: `measureHumanoid` rejects a mesh whose
 * proportions are not a standing figure. A generated avatar that came out
 * as a 1 x 0.74 x 1 blob is not a character, and rigging it produces a
 * writhing lump rather than a fighter. Returning `humanoid: false` lets
 * the game keep its procedural body — which animates — instead of showing
 * better-looking art that cannot move. Looking correct and being frozen
 * is a worse outcome than looking plain and moving, and it is the failure
 * the first version of these four games shipped.
 */

import * as THREE from 'three';
import { A3GameAnimationDirector } from './animation-director.js';
import { measureObject } from './visual-kit.js';

/**
 * Canonical bone names for the template humanoid.
 *
 * Deliberately not Mixamo's names and not Puppeteer's `joint0…jointN`.
 * Mixamo's prefix implies a licence lineage this repo does not have, and
 * Puppeteer's names carry no anatomy at all — `joint23` is a hip on one
 * character and a finger on the next. A stable, readable set is what lets
 * one authored clip drive every auto-rigged character and lets a
 * retarget map be written by hand when a clip arrives from elsewhere.
 *
 * Convention: left is +X, up is +Y, forward is -Z, and every bone rests
 * with an identity rotation — so a clip's `rotation.x` on `thigh_l`
 * always swings that leg forward, on every character.
 */
export const A3GameHumanoidBone = Object.freeze({
  HIPS: 'hips',
  SPINE: 'spine',
  CHEST: 'chest',
  NECK: 'neck',
  HEAD: 'head',
  SHOULDER_L: 'shoulder_l',
  UPPER_ARM_L: 'upper_arm_l',
  FOREARM_L: 'forearm_l',
  HAND_L: 'hand_l',
  SHOULDER_R: 'shoulder_r',
  UPPER_ARM_R: 'upper_arm_r',
  FOREARM_R: 'forearm_r',
  HAND_R: 'hand_r',
  THIGH_L: 'thigh_l',
  SHIN_L: 'shin_l',
  FOOT_L: 'foot_l',
  THIGH_R: 'thigh_r',
  SHIN_R: 'shin_r',
  FOOT_R: 'foot_r',
});

/**
 * The motion states the authored clip set covers.
 *
 * A game maps its own vocabulary onto these
 * (`{ windup: 'punch', active: 'punch', ko: 'death' }`) exactly as it
 * would for an imported character's clip names, so switching a character
 * from procedural clips to real mocap changes one mapping and nothing
 * else.
 */
export const A3GameMotionState = Object.freeze({
  IDLE: 'idle',
  WALK: 'walk',
  RUN: 'run',
  JUMP: 'jump',
  BLOCK: 'block',
  PUNCH: 'punch',
  KICK: 'kick',
  SLASH: 'slash',
  HIT: 'hit',
  DEATH: 'death',
  AIM: 'aim',
  SHOOT: 'shoot',
  RELOAD: 'reload',
  DRAW: 'draw',
});

/**
 * Template skeleton, expressed as fractions of the character's height.
 *
 * Fractions rather than metres because the same table has to fit a 1.62 m
 * brawler and a 1.9 m thug. The proportions are the standard eight-heads
 * figure, and the arms hang **down and slightly out** rather than in a
 * T-pose: a character generated from a concept image is standing
 * naturally, and binding a T-pose skeleton to a mesh whose arms are at
 * its sides assigns the shoulder's weights to empty space.
 *
 * `radius` is the bone's influence radius, also in height fractions. It
 * is what keeps an arm bone from claiming chest vertices merely because
 * a hanging arm is close to the chest.
 */
const HUMANOID_TEMPLATE = Object.freeze([
  { name: 'hips', parent: null, offset: [0, 0.52, 0], radius: 0.13 },
  { name: 'spine', parent: 'hips', offset: [0, 0.075, 0], radius: 0.12 },
  { name: 'chest', parent: 'spine', offset: [0, 0.09, 0], radius: 0.14 },
  { name: 'neck', parent: 'chest', offset: [0, 0.085, 0], radius: 0.06 },
  { name: 'head', parent: 'neck', offset: [0, 0.055, 0], radius: 0.1 },

  { name: 'shoulder_l', parent: 'chest', offset: [0.045, 0.055, 0], radius: 0.07 },
  { name: 'upper_arm_l', parent: 'shoulder_l', offset: [0.035, -0.01, 0], radius: 0.06 },
  { name: 'forearm_l', parent: 'upper_arm_l', offset: [0.022, -0.15, 0], radius: 0.05 },
  { name: 'hand_l', parent: 'forearm_l', offset: [0.014, -0.14, 0], radius: 0.045 },

  { name: 'shoulder_r', parent: 'chest', offset: [-0.045, 0.055, 0], radius: 0.07 },
  { name: 'upper_arm_r', parent: 'shoulder_r', offset: [-0.035, -0.01, 0], radius: 0.06 },
  { name: 'forearm_r', parent: 'upper_arm_r', offset: [-0.022, -0.15, 0], radius: 0.05 },
  { name: 'hand_r', parent: 'forearm_r', offset: [-0.014, -0.14, 0], radius: 0.045 },

  { name: 'thigh_l', parent: 'hips', offset: [0.055, -0.045, 0], radius: 0.075 },
  { name: 'shin_l', parent: 'thigh_l', offset: [0, -0.235, 0], radius: 0.06 },
  { name: 'foot_l', parent: 'shin_l', offset: [0, -0.225, 0], radius: 0.055 },

  { name: 'thigh_r', parent: 'hips', offset: [-0.055, -0.045, 0], radius: 0.075 },
  { name: 'shin_r', parent: 'thigh_r', offset: [0, -0.235, 0], radius: 0.06 },
  { name: 'foot_r', parent: 'shin_r', offset: [0, -0.225, 0], radius: 0.055 },
]);

/**
 * Build the template skeleton at a given height, in the caller's space.
 *
 * @param {{height?: number, centre?: {x: number, z: number},
 *          baseY?: number, shoulderWidth?: number}} [options]
 * @returns {{root: THREE.Bone, bones: THREE.Bone[],
 *            byName: Map<string, THREE.Bone>, skeleton: THREE.Skeleton,
 *            radii: number[]}}
 */
export function createHumanoidSkeleton(options = {}) {
  const height = Math.max(0.2, Number(options.height ?? 1.8));
  const centre = options.centre ?? { x: 0, z: 0 };
  const baseY = Number(options.baseY ?? 0);
  // A generated character is often broader or narrower than the eight-head
  // figure, and a skeleton wider than the mesh puts a shoulder outside the
  // silhouette, which the skinning then drags into the air.
  const lateral = Number(options.shoulderWidth ?? 1);

  /** @type {Map<string, THREE.Bone>} */
  const byName = new Map();
  /** @type {THREE.Bone[]} */
  const bones = [];
  const radii = [];
  let root = null;

  for (const definition of HUMANOID_TEMPLATE) {
    const bone = new THREE.Bone();
    bone.name = definition.name;
    bone.position.set(
      definition.offset[0] * height * lateral,
      definition.offset[1] * height,
      definition.offset[2] * height,
    );
    if (definition.parent === null) {
      bone.position.x += centre.x;
      bone.position.y += baseY;
      bone.position.z += centre.z;
      root = bone;
    } else {
      const parent = byName.get(definition.parent);
      if (!parent) {
        throw new Error(
          `Humanoid template lists ${definition.name} before its parent`,
        );
      }
      parent.add(bone);
    }
    byName.set(definition.name, bone);
    bones.push(bone);
    radii.push(definition.radius * height);
  }

  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  return { root, bones, byName, skeleton, radii };
}

/**
 * Decide whether a mesh is a standing humanoid at all.
 *
 * This is a quality gate, not a nicety. Single-image reconstruction fails
 * in a characteristic way: the subject touches the frame edge, the model
 * infers a ground plane, and what comes back is as wide as it is tall.
 * Such a mesh is a perfectly good *prop* and a hopeless *character* —
 * rigged to a humanoid skeleton it flails, and scaled by height it is
 * two metres wide.
 *
 * The test is proportion, because that is the one thing a bounding box
 * can honestly report: a standing figure is clearly taller than it is
 * wide, and its shoulders are near the top.
 *
 * @param {THREE.Object3D} object
 * @param {{minAspect?: number, maxAspect?: number}} [options]
 * @returns {{humanoid: boolean, height: number, width: number,
 *            depth: number, aspect: number, centre: {x: number, z: number},
 *            baseY: number, reason: string}}
 */
export function measureHumanoid(object, options = {}) {
  const box = measureObject(object);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const width = Math.max(size.x, size.z);
  const aspect = width > 1e-6 ? size.y / width : Infinity;
  const minAspect = Number(options.minAspect ?? 1.45);
  const maxAspect = Number(options.maxAspect ?? 9);

  let reason = 'humanoid_proportions';
  let humanoid = true;
  if (!(size.y > 1e-6)) {
    humanoid = false;
    reason = 'degenerate_bounds';
  } else if (aspect < minAspect) {
    humanoid = false;
    reason = 'too_wide_for_a_standing_figure';
  } else if (aspect > maxAspect) {
    humanoid = false;
    reason = 'too_thin_for_a_standing_figure';
  }

  return {
    humanoid,
    height: size.y,
    width: size.x,
    depth: size.z,
    aspect: Number(aspect.toFixed(3)),
    centre: { x: centre.x, z: centre.z },
    baseY: box.min.y,
    reason,
  };
}

/**
 * Give a static mesh a skeleton and skin weights.
 *
 * Every mesh in the subtree is re-baked into the subtree's own space,
 * turned into a `SkinnedMesh`, and bound to one shared skeleton fitted to
 * the subtree's bounding box. Weights come from distance to each bone's
 * segment, limited by that bone's influence radius, which is what stops a
 * hanging arm from taking the chest with it.
 *
 * This is a browser-side approximation of what
 * `operators/gen_motion` does properly with Puppeteer, and it is not a
 * replacement for it: Puppeteer predicts joints from the geometry, this
 * assumes a standing figure. What it buys is that a generated character
 * moves *today*, with no GPU, no Blender, and no second asset — and that
 * a game written against `A3GameAnimationDirector` needs no branch for
 * which of the two produced the skeleton.
 *
 * @param {THREE.Object3D} object a prepared, non-skinned model
 * @param {{height?: number, influence?: number, maxBones?: number,
 *          centre?: {x: number, z: number}, baseY?: number,
 *          shoulderWidth?: number, castShadow?: boolean}} [options]
 * @returns {{root: THREE.Object3D, skeleton: THREE.Skeleton,
 *            bones: Map<string, THREE.Bone>, meshes: THREE.SkinnedMesh[],
 *            vertexCount: number} | null} `null` when the model is
 *          already skinned or carries no mesh to skin
 */
export function autoRigHumanoid(object, options = {}) {
  if (!object?.isObject3D) {
    throw new TypeError('autoRigHumanoid requires an Object3D');
  }
  object.updateMatrixWorld(true);

  /** @type {THREE.Mesh[]} */
  const meshes = [];
  let alreadySkinned = false;
  object.traverse((child) => {
    if (child.isSkinnedMesh) alreadySkinned = true;
    else if (child.isMesh) meshes.push(child);
  });
  if (alreadySkinned || meshes.length === 0) return null;

  // Everything from here on is in the subtree's **local** space, and that
  // distinction is the whole correctness argument of this function. The
  // caller's object is usually the asset library's orientation wrapper: it
  // carries the fit-to-height scale and the grounding offset, so its
  // local space and the world differ by both. A skeleton fitted to
  // world-space measurements and then bound to locally-baked geometry is
  // off by exactly that scale and offset — the character ends up rigged to
  // a skeleton floating above or inside itself.
  const inverseRoot = object.matrixWorld.clone().invert();
  const baked = [];
  const localBounds = new THREE.Box3();
  for (const mesh of meshes) {
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(inverseRoot.clone().multiply(mesh.matrixWorld));
    geometry.computeBoundingBox();
    if (geometry.boundingBox) localBounds.union(geometry.boundingBox);
    baked.push({ geometry, material: mesh.material, name: mesh.name });
  }
  if (localBounds.isEmpty()) {
    for (const entry of baked) entry.geometry.dispose();
    return null;
  }

  const size = localBounds.getSize(new THREE.Vector3());
  const centre = localBounds.getCenter(new THREE.Vector3());
  const height = Number(options.height ?? size.y);
  if (!(height > 0)) {
    for (const entry of baked) entry.geometry.dispose();
    return null;
  }

  const rig = createHumanoidSkeleton({
    height,
    centre: options.centre ?? { x: centre.x, z: centre.z },
    baseY: options.baseY ?? localBounds.min.y,
    shoulderWidth: options.shoulderWidth,
  });

  // Bone segments in the same space the geometry now lives in.
  const segments = rig.bones.map((bone, index) => {
    const start = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
    const child = bone.children.find((entry) => entry.isBone);
    const end = child
      ? new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
      : start.clone().add(new THREE.Vector3(0, -rig.radii[index] * 0.9, 0));
    return {
      index,
      start,
      end,
      direction: end.clone().sub(start),
      radius: rig.radii[index],
    };
  });
  for (const segment of segments) {
    segment.lengthSq = Math.max(1e-8, segment.direction.lengthSq());
  }

  const scratch = new THREE.Vector3();
  const closest = new THREE.Vector3();
  const skinned = [];
  let vertexCount = 0;

  for (const entry of baked) {
    const geometry = entry.geometry;
    const position = geometry.getAttribute('position');
    const count = position.count;
    vertexCount += count;

    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    const candidates = [];

    for (let vertex = 0; vertex < count; vertex += 1) {
      scratch.fromBufferAttribute(position, vertex);
      candidates.length = 0;
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (const segment of segments) {
        // Distance from the vertex to the bone's segment, clamped to the
        // segment: an unclamped line would let a shin bone claim a
        // shoulder that happens to sit on its infinite extension.
        const t = THREE.MathUtils.clamp(
          scratch.clone().sub(segment.start).dot(segment.direction) /
            segment.lengthSq,
          0,
          1,
        );
        closest.copy(segment.start).addScaledVector(segment.direction, t);
        const distance = scratch.distanceTo(closest);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = segment.index;
        }
        if (distance <= segment.radius * 2.4) {
          candidates.push({
            index: segment.index,
            // Normalising by the bone's own radius is what makes a thick
            // torso bone outrank a thin arm bone at the same distance.
            weight: (segment.radius / (distance + segment.radius * 0.18)) ** 3,
          });
        }
      }

      if (candidates.length === 0) {
        skinIndices[vertex * 4] = nearestIndex;
        skinWeights[vertex * 4] = 1;
        continue;
      }
      candidates.sort((a, b) => b.weight - a.weight);
      const used = candidates.slice(0, Math.max(1, Number(options.maxBones ?? 3)));
      const total = used.reduce((sum, item) => sum + item.weight, 0) || 1;
      for (let slot = 0; slot < used.length && slot < 4; slot += 1) {
        skinIndices[vertex * 4 + slot] = used[slot].index;
        skinWeights[vertex * 4 + slot] = used[slot].weight / total;
      }
    }

    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(skinIndices, 4),
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(skinWeights, 4),
    );

    const skin = new THREE.SkinnedMesh(geometry, entry.material);
    skin.name = `${entry.name || 'mesh'}_skinned`;
    skin.castShadow = options.castShadow !== false;
    skin.receiveShadow = true;
    // A skinned mesh is culled on its bind-pose bounds, so a character
    // that raises an arm blinks out at the edge of the screen without it.
    skin.frustumCulled = false;
    skin.bind(rig.skeleton);
    skinned.push(skin);
  }

  // Replace the static subtree with the rigged one. The *object itself* is
  // kept, because it is what the game already holds a reference to and
  // what carries the orientation correction the asset library applied.
  for (const mesh of meshes) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
  }
  object.add(rig.root);
  for (const skin of skinned) object.add(skin);
  object.updateMatrixWorld(true);

  return {
    root: object,
    skeleton: rig.skeleton,
    bones: rig.byName,
    meshes: skinned,
    vertexCount,
    /** Local-space height the skeleton was fitted to, for the clip set. */
    height,
  };
}

/**
 * Pose tables for the authored clip set.
 *
 * Each entry is `[timeSeconds, pose]`, where a pose maps a bone name to
 * `[x, y, z]` Euler radians and may carry a `hips` position offset in
 * metres. Bones absent from a pose stay at rest, which is why the tables
 * stay short: a punch does not need to restate the legs.
 *
 * These are keyframes, not simulations. That is on purpose — a hand-tuned
 * six-key punch reads better than a physically integrated one, which is
 * also why every commercial fighting game ships keyframes.
 */
const CLIP_POSES = Object.freeze({
  idle: {
    duration: 2.4,
    loop: true,
    keys: [
      [0, { chest: [0.02, 0, 0], upper_arm_l: [0, 0, 0.06], upper_arm_r: [0, 0, -0.06], hipsOffset: [0, 0, 0] }],
      [1.2, { chest: [0.06, 0, 0], upper_arm_l: [0.05, 0, 0.1], upper_arm_r: [0.05, 0, -0.1], hipsOffset: [0, -0.015, 0] }],
      [2.4, { chest: [0.02, 0, 0], upper_arm_l: [0, 0, 0.06], upper_arm_r: [0, 0, -0.06], hipsOffset: [0, 0, 0] }],
    ],
  },
  walk: {
    duration: 1,
    loop: true,
    keys: [
      [0, { thigh_l: [0.5, 0, 0], shin_l: [-0.25, 0, 0], thigh_r: [-0.4, 0, 0], shin_r: [-0.5, 0, 0], upper_arm_l: [-0.45, 0, 0.1], upper_arm_r: [0.45, 0, -0.1], forearm_l: [-0.25, 0, 0], forearm_r: [-0.25, 0, 0], chest: [0.05, -0.08, 0], hipsOffset: [0, 0, 0] }],
      [0.25, { thigh_l: [0.1, 0, 0], shin_l: [-0.1, 0, 0], thigh_r: [-0.1, 0, 0], shin_r: [-0.2, 0, 0], upper_arm_l: [0, 0, 0.08], upper_arm_r: [0, 0, -0.08], chest: [0.05, 0, 0], hipsOffset: [0, 0.035, 0] }],
      [0.5, { thigh_l: [-0.4, 0, 0], shin_l: [-0.5, 0, 0], thigh_r: [0.5, 0, 0], shin_r: [-0.25, 0, 0], upper_arm_l: [0.45, 0, 0.1], upper_arm_r: [-0.45, 0, -0.1], forearm_l: [-0.25, 0, 0], forearm_r: [-0.25, 0, 0], chest: [0.05, 0.08, 0], hipsOffset: [0, 0, 0] }],
      [0.75, { thigh_l: [-0.1, 0, 0], shin_l: [-0.2, 0, 0], thigh_r: [0.1, 0, 0], shin_r: [-0.1, 0, 0], upper_arm_l: [0, 0, 0.08], upper_arm_r: [0, 0, -0.08], chest: [0.05, 0, 0], hipsOffset: [0, 0.035, 0] }],
      [1, { thigh_l: [0.5, 0, 0], shin_l: [-0.25, 0, 0], thigh_r: [-0.4, 0, 0], shin_r: [-0.5, 0, 0], upper_arm_l: [-0.45, 0, 0.1], upper_arm_r: [0.45, 0, -0.1], forearm_l: [-0.25, 0, 0], forearm_r: [-0.25, 0, 0], chest: [0.05, -0.08, 0], hipsOffset: [0, 0, 0] }],
    ],
  },
  run: {
    duration: 0.62,
    loop: true,
    keys: [
      [0, { thigh_l: [1.05, 0, 0], shin_l: [-0.7, 0, 0], thigh_r: [-0.7, 0, 0], shin_r: [-1.1, 0, 0], upper_arm_l: [-1.15, 0, 0.16], upper_arm_r: [1.15, 0, -0.16], forearm_l: [-1.5, 0, 0], forearm_r: [-1.5, 0, 0], chest: [0.22, -0.14, 0], hipsOffset: [0, 0.02, 0] }],
      [0.155, { thigh_l: [0.3, 0, 0], shin_l: [-0.35, 0, 0], thigh_r: [-0.2, 0, 0], shin_r: [-0.5, 0, 0], upper_arm_l: [-0.4, 0, 0.14], upper_arm_r: [0.4, 0, -0.14], forearm_l: [-1.2, 0, 0], forearm_r: [-1.2, 0, 0], chest: [0.24, 0, 0], hipsOffset: [0, 0.09, 0] }],
      [0.31, { thigh_l: [-0.7, 0, 0], shin_l: [-1.1, 0, 0], thigh_r: [1.05, 0, 0], shin_r: [-0.7, 0, 0], upper_arm_l: [1.15, 0, 0.16], upper_arm_r: [-1.15, 0, -0.16], forearm_l: [-1.5, 0, 0], forearm_r: [-1.5, 0, 0], chest: [0.22, 0.14, 0], hipsOffset: [0, 0.02, 0] }],
      [0.465, { thigh_l: [-0.2, 0, 0], shin_l: [-0.5, 0, 0], thigh_r: [0.3, 0, 0], shin_r: [-0.35, 0, 0], upper_arm_l: [0.4, 0, 0.14], upper_arm_r: [-0.4, 0, -0.14], forearm_l: [-1.2, 0, 0], forearm_r: [-1.2, 0, 0], chest: [0.24, 0, 0], hipsOffset: [0, 0.09, 0] }],
      [0.62, { thigh_l: [1.05, 0, 0], shin_l: [-0.7, 0, 0], thigh_r: [-0.7, 0, 0], shin_r: [-1.1, 0, 0], upper_arm_l: [-1.15, 0, 0.16], upper_arm_r: [1.15, 0, -0.16], forearm_l: [-1.5, 0, 0], forearm_r: [-1.5, 0, 0], chest: [0.22, -0.14, 0], hipsOffset: [0, 0.02, 0] }],
    ],
  },
  jump: {
    duration: 0.9,
    loop: false,
    keys: [
      [0, { thigh_l: [0.7, 0, 0], shin_l: [-1, 0, 0], thigh_r: [0.7, 0, 0], shin_r: [-1, 0, 0], upper_arm_l: [-0.5, 0, 0.2], upper_arm_r: [-0.5, 0, -0.2], chest: [0.3, 0, 0], hipsOffset: [0, -0.12, 0] }],
      [0.2, { thigh_l: [-0.1, 0, 0], shin_l: [-0.1, 0, 0], thigh_r: [-0.1, 0, 0], shin_r: [-0.1, 0, 0], upper_arm_l: [-2.4, 0, 0.3], upper_arm_r: [-2.4, 0, -0.3], chest: [-0.12, 0, 0], hipsOffset: [0, 0.04, 0] }],
      [0.55, { thigh_l: [0.5, 0, 0], shin_l: [-0.9, 0, 0], thigh_r: [0.2, 0, 0], shin_r: [-0.4, 0, 0], upper_arm_l: [-1.5, 0, 0.4], upper_arm_r: [-1.5, 0, -0.4], chest: [0.06, 0, 0], hipsOffset: [0, 0, 0] }],
      [0.9, { thigh_l: [0.35, 0, 0], shin_l: [-0.5, 0, 0], thigh_r: [0.35, 0, 0], shin_r: [-0.5, 0, 0], upper_arm_l: [-0.3, 0, 0.2], upper_arm_r: [-0.3, 0, -0.2], chest: [0.2, 0, 0], hipsOffset: [0, -0.06, 0] }],
    ],
  },
  block: {
    duration: 0.6,
    loop: true,
    keys: [
      [0, { upper_arm_l: [1.5, 0, 0.5], forearm_l: [-1.9, 0, 0], upper_arm_r: [1.5, 0, -0.5], forearm_r: [-1.9, 0, 0], chest: [0.16, 0, 0], thigh_l: [0.2, 0, 0], shin_l: [-0.3, 0, 0], thigh_r: [0.1, 0, 0], shin_r: [-0.2, 0, 0], hipsOffset: [0, -0.05, 0] }],
      [0.3, { upper_arm_l: [1.56, 0, 0.52], forearm_l: [-1.95, 0, 0], upper_arm_r: [1.56, 0, -0.52], forearm_r: [-1.95, 0, 0], chest: [0.19, 0, 0], hipsOffset: [0, -0.06, 0] }],
      [0.6, { upper_arm_l: [1.5, 0, 0.5], forearm_l: [-1.9, 0, 0], upper_arm_r: [1.5, 0, -0.5], forearm_r: [-1.9, 0, 0], chest: [0.16, 0, 0], hipsOffset: [0, -0.05, 0] }],
    ],
  },
  punch: {
    duration: 0.42,
    loop: false,
    keys: [
      [0, { upper_arm_r: [0.9, 0, -0.35], forearm_r: [-1.7, 0, 0], upper_arm_l: [1.2, 0, 0.4], forearm_l: [-1.6, 0, 0], chest: [0.05, 0.35, 0], hips: [0, 0.28, 0] }],
      [0.12, { upper_arm_r: [0.5, 0, -0.5], forearm_r: [-2.1, 0, 0], upper_arm_l: [1.3, 0, 0.45], chest: [0.05, 0.55, 0], hips: [0, 0.42, 0] }],
      [0.2, { upper_arm_r: [1.68, 0, -0.08], forearm_r: [-0.12, 0, 0], upper_arm_l: [1.1, 0, 0.5], forearm_l: [-1.8, 0, 0], chest: [0.05, -0.42, 0], hips: [0, -0.34, 0], hipsOffset: [0, 0, -0.06] }],
      [0.3, { upper_arm_r: [1.5, 0, -0.15], forearm_r: [-0.4, 0, 0], chest: [0.05, -0.3, 0], hips: [0, -0.24, 0] }],
      [0.42, { upper_arm_r: [0.2, 0, -0.12], forearm_r: [-0.5, 0, 0], upper_arm_l: [0.2, 0, 0.12], forearm_l: [-0.5, 0, 0], chest: [0.05, 0, 0], hips: [0, 0, 0] }],
    ],
  },
  kick: {
    duration: 0.62,
    loop: false,
    keys: [
      [0, { thigh_r: [-0.3, 0, 0], shin_r: [-0.7, 0, 0], chest: [-0.05, 0.1, 0], upper_arm_l: [-0.8, 0, 0.5], upper_arm_r: [-0.4, 0, -0.4], hipsOffset: [0, -0.04, 0] }],
      [0.16, { thigh_r: [-0.9, 0, 0], shin_r: [-1.6, 0, 0], thigh_l: [0.15, 0, 0], chest: [-0.25, 0.12, 0], upper_arm_l: [-1.6, 0, 0.6], upper_arm_r: [-1, 0, -0.5], hipsOffset: [0, 0.06, 0] }],
      [0.3, { thigh_r: [1.75, 0, 0], shin_r: [-0.15, 0, 0], foot_r: [0.3, 0, 0], thigh_l: [-0.35, 0, 0], shin_l: [-0.5, 0, 0], chest: [0.45, 0, 0], upper_arm_l: [-2.2, 0, 0.7], upper_arm_r: [-1.6, 0, -0.6], hipsOffset: [0, 0.12, -0.1] }],
      [0.42, { thigh_r: [1.4, 0, 0], shin_r: [-0.5, 0, 0], thigh_l: [-0.2, 0, 0], chest: [0.3, 0, 0], upper_arm_l: [-1.6, 0, 0.6], upper_arm_r: [-1.1, 0, -0.5], hipsOffset: [0, 0.06, -0.04] }],
      [0.62, { thigh_r: [0.1, 0, 0], shin_r: [-0.2, 0, 0], thigh_l: [0, 0, 0], chest: [0.04, 0, 0], upper_arm_l: [0, 0, 0.1], upper_arm_r: [0, 0, -0.1], hipsOffset: [0, 0, 0] }],
    ],
  },
  slash: {
    duration: 0.5,
    loop: false,
    keys: [
      [0, { upper_arm_r: [-1.9, 0, -0.7], forearm_r: [-0.9, 0, 0], chest: [0, 0.5, 0], hips: [0, 0.3, 0] }],
      [0.14, { upper_arm_r: [-2.5, 0, -0.9], forearm_r: [-1.2, 0, 0], chest: [0, 0.7, 0], hips: [0, 0.42, 0] }],
      [0.26, { upper_arm_r: [1.1, 0, 0.5], forearm_r: [-0.25, 0, 0], chest: [0.15, -0.55, 0], hips: [0, -0.4, 0], hipsOffset: [0, -0.03, -0.05] }],
      [0.36, { upper_arm_r: [0.8, 0, 0.2], forearm_r: [-0.5, 0, 0], chest: [0.1, -0.35, 0], hips: [0, -0.26, 0] }],
      [0.5, { upper_arm_r: [0.1, 0, -0.1], forearm_r: [-0.4, 0, 0], chest: [0.03, 0, 0], hips: [0, 0, 0] }],
    ],
  },
  hit: {
    duration: 0.36,
    loop: false,
    keys: [
      [0, { chest: [-0.1, 0, 0], head: [-0.1, 0, 0], upper_arm_l: [-0.4, 0, 0.4], upper_arm_r: [-0.4, 0, -0.4], hipsOffset: [0, 0, 0] }],
      [0.1, { chest: [-0.45, 0.12, 0], head: [-0.5, 0, 0], upper_arm_l: [-1, 0, 0.7], upper_arm_r: [-1, 0, -0.7], thigh_l: [-0.2, 0, 0], thigh_r: [0.2, 0, 0], hipsOffset: [0, -0.04, 0.09] }],
      [0.22, { chest: [-0.2, 0.05, 0], head: [-0.2, 0, 0], upper_arm_l: [-0.5, 0, 0.5], upper_arm_r: [-0.5, 0, -0.5], hipsOffset: [0, -0.02, 0.04] }],
      [0.36, { chest: [0.03, 0, 0], head: [0, 0, 0], upper_arm_l: [0, 0, 0.08], upper_arm_r: [0, 0, -0.08], hipsOffset: [0, 0, 0] }],
    ],
  },
  death: {
    duration: 1.1,
    loop: false,
    keys: [
      [0, { chest: [-0.2, 0, 0], head: [-0.2, 0, 0], hipsOffset: [0, 0, 0], hips: [0, 0, 0] }],
      [0.28, { chest: [-0.55, 0.2, 0], head: [-0.5, 0, 0], thigh_l: [0.6, 0, 0], shin_l: [-1.1, 0, 0], thigh_r: [0.3, 0, 0], shin_r: [-0.8, 0, 0], upper_arm_l: [-0.9, 0, 0.6], upper_arm_r: [-0.9, 0, -0.6], hipsOffset: [0, -0.35, 0.1] }],
      [0.65, { chest: [-0.3, 0.3, 0], head: [-0.3, 0, 0], thigh_l: [1.3, 0, 0], shin_l: [-1.4, 0, 0], thigh_r: [1, 0, 0], shin_r: [-1.2, 0, 0], upper_arm_l: [-1.4, 0, 0.9], upper_arm_r: [-1.4, 0, -0.9], hips: [-1.35, 0.2, 0], hipsOffset: [0, -0.7, 0.35] }],
      [1.1, { chest: [-0.1, 0.35, 0], head: [-0.15, 0, 0], thigh_l: [0.5, 0, 0], shin_l: [-0.5, 0, 0], thigh_r: [0.3, 0, 0], shin_r: [-0.3, 0, 0], upper_arm_l: [-1.2, 0, 1.1], upper_arm_r: [-1.2, 0, -1.1], hips: [-1.55, 0.25, 0], hipsOffset: [0, -0.82, 0.5] }],
    ],
  },
  aim: {
    duration: 1.6,
    loop: true,
    keys: [
      [0, { upper_arm_r: [1.62, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0], hips: [0, -0.12, 0], thigh_l: [0.12, 0, 0], thigh_r: [-0.08, 0, 0] }],
      [0.8, { upper_arm_r: [1.6, 0, -0.2], forearm_r: [-0.2, 0, 0], upper_arm_l: [1.42, 0, 0.53], forearm_l: [-0.82, 0, 0], chest: [0.07, -0.16, 0], hips: [0, -0.12, 0], hipsOffset: [0, -0.012, 0] }],
      [1.6, { upper_arm_r: [1.62, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0], hips: [0, -0.12, 0] }],
    ],
  },
  shoot: {
    duration: 0.26,
    loop: false,
    keys: [
      [0, { upper_arm_r: [1.62, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0], hips: [0, -0.12, 0] }],
      [0.05, { upper_arm_r: [1.35, 0, -0.3], forearm_r: [-0.45, 0, 0], upper_arm_l: [1.28, 0, 0.6], forearm_l: [-1, 0, 0], chest: [-0.1, -0.16, 0], head: [-0.08, 0, 0], hips: [0, -0.12, 0] }],
      [0.14, { upper_arm_r: [1.55, 0, -0.24], forearm_r: [-0.28, 0, 0], upper_arm_l: [1.4, 0, 0.56], forearm_l: [-0.88, 0, 0], chest: [0.02, -0.16, 0], hips: [0, -0.12, 0] }],
      [0.26, { upper_arm_r: [1.62, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0], hips: [0, -0.12, 0] }],
    ],
  },
  reload: {
    duration: 1.3,
    loop: false,
    keys: [
      [0, { upper_arm_r: [1.6, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0] }],
      [0.35, { upper_arm_r: [0.9, 0, -0.5], forearm_r: [-1.5, 0, 0], upper_arm_l: [0.5, 0, 0.6], forearm_l: [-1.9, 0, 0], chest: [0.12, -0.1, 0], head: [0.15, 0, 0] }],
      [0.75, { upper_arm_r: [1, 0, -0.45], forearm_r: [-1.35, 0, 0], upper_arm_l: [0.8, 0, 0.5], forearm_l: [-1.6, 0, 0], chest: [0.1, -0.12, 0], head: [0.12, 0, 0] }],
      [1.3, { upper_arm_r: [1.6, 0, -0.22], forearm_r: [-0.22, 0, 0], upper_arm_l: [1.45, 0, 0.55], forearm_l: [-0.85, 0, 0], chest: [0.04, -0.16, 0] }],
    ],
  },
  draw: {
    duration: 1.2,
    loop: true,
    keys: [
      [0, { upper_arm_l: [1.68, 0, 0.12], forearm_l: [-0.1, 0, 0], upper_arm_r: [1.3, 0, -0.5], forearm_r: [-1.1, 0, 0], chest: [0.02, 0.16, 0], hips: [0, 0.1, 0], thigh_r: [0.12, 0, 0] }],
      [0.6, { upper_arm_l: [1.7, 0, 0.14], forearm_l: [-0.08, 0, 0], upper_arm_r: [1.24, 0, -0.62], forearm_r: [-1.5, 0, 0], chest: [0.04, 0.2, 0], hips: [0, 0.12, 0], hipsOffset: [0, -0.01, 0] }],
      [1.2, { upper_arm_l: [1.68, 0, 0.12], forearm_l: [-0.1, 0, 0], upper_arm_r: [1.3, 0, -0.5], forearm_r: [-1.1, 0, 0], chest: [0.02, 0.16, 0], hips: [0, 0.1, 0] }],
    ],
  },
});

/** Every state the authored set can produce. */
export const A3GAME_HUMANOID_CLIP_NAMES = Object.freeze(
  Object.keys(CLIP_POSES),
);

/**
 * Build one authored clip.
 *
 * @param {string} state a value of `A3GameMotionState`
 * @param {{height?: number, speed?: number,
 *          hipsRest?: {x: number, y: number, z: number}}} [options]
 * @returns {THREE.AnimationClip | null}
 */
export function createHumanoidClip(state, options = {}) {
  const key = String(state).toLowerCase();
  const definition = CLIP_POSES[key];
  if (!definition) return null;
  const height = Math.max(0.2, Number(options.height ?? 1.8));
  const speed = Math.max(0.05, Number(options.speed ?? 1));

  // One track per bone that any keyframe mentions. A bone nobody mentions
  // gets no track at all, which is what lets a punch clip crossfade over
  // a walk without freezing the legs.
  /** @type {Map<string, {times: number[], values: number[]}>} */
  const rotationTracks = new Map();
  const hipsPosition = { times: [], values: [] };
  const euler = new THREE.Euler();
  const quaternion = new THREE.Quaternion();

  const mentioned = new Set();
  let movesHips = false;
  for (const [, pose] of definition.keys) {
    for (const boneName of Object.keys(pose)) {
      if (boneName === 'hipsOffset') {
        const offset = pose.hipsOffset;
        if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) {
          movesHips = true;
        }
        continue;
      }
      mentioned.add(boneName);
    }
  }

  // The hips rest position is the *rig's*, not the template's: a fitted
  // skeleton carries the model's horizontal centre and its ground offset,
  // and a clip that wrote an absolute position would throw both away and
  // teleport the character to the local origin on its first frame.
  const rest = options.hipsRest ?? {
    x: 0,
    y:
      (HUMANOID_TEMPLATE.find((entry) => entry.name === 'hips')?.offset[1] ??
        0.52) * height,
    z: 0,
  };

  for (const [time, pose] of definition.keys) {
    const scaled = time / speed;
    for (const boneName of mentioned) {
      const rotation = pose[boneName] ?? [0, 0, 0];
      euler.set(rotation[0], rotation[1], rotation[2]);
      quaternion.setFromEuler(euler);
      let track = rotationTracks.get(boneName);
      if (!track) {
        track = { times: [], values: [] };
        rotationTracks.set(boneName, track);
      }
      track.times.push(scaled);
      track.values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    const offset = pose.hipsOffset ?? [0, 0, 0];
    hipsPosition.times.push(scaled);
    hipsPosition.values.push(
      rest.x + offset[0] * height,
      rest.y + offset[1] * height,
      rest.z + offset[2] * height,
    );
  }

  const tracks = [];
  for (const [boneName, track] of rotationTracks) {
    tracks.push(
      new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`,
        track.times,
        track.values,
      ),
    );
  }
  if (movesHips) {
    tracks.push(
      new THREE.VectorKeyframeTrack(
        `${A3GameHumanoidBone.HIPS}.position`,
        hipsPosition.times,
        hipsPosition.values,
      ),
    );
  }

  const clip = new THREE.AnimationClip(
    key,
    definition.duration / speed,
    tracks,
  );
  clip.userData = { a3game: { authored: true, loop: definition.loop } };
  return clip;
}

/**
 * Build the whole authored clip set, or a named subset.
 *
 * @param {string[]} [states] defaults to every authored state
 * @param {{height?: number, speed?: number,
 *          hipsRest?: {x: number, y: number, z: number}}} [options]
 * @returns {THREE.AnimationClip[]}
 */
export function createHumanoidClipSet(states, options = {}) {
  const wanted =
    Array.isArray(states) && states.length > 0
      ? states
      : A3GAME_HUMANOID_CLIP_NAMES;
  const clips = [];
  for (const state of wanted) {
    const clip = createHumanoidClip(state, options);
    if (clip) clips.push(clip);
  }
  return clips;
}

/** Bone-name prefixes that libraries add and a retarget has to ignore. */
const SOURCE_SKELETON_PREFIXES = Object.freeze([
  'mixamorig:',
  'mixamorig1:',
  'Armature|',
  'Bip01_',
  'bip01_',
]);

/**
 * Common source-skeleton names, mapped onto the canonical bones.
 *
 * Only the *source* half of a bone map is reusable — Mixamo always calls
 * the pelvis `mixamorig:Hips`. The target half never is, which is why
 * `operators/gen_motion` derives it per rig and this table stops at the
 * names a browser can recognise without geometry.
 */
export const A3GameSourceBoneAliases = Object.freeze({
  hips: ['hips', 'pelvis', 'root', 'joint0'],
  spine: ['spine', 'spine_01', 'abdomen'],
  chest: ['chest', 'spine1', 'spine_02', 'spine2', 'torso'],
  neck: ['neck', 'neck_01'],
  head: ['head'],
  shoulder_l: ['leftshoulder', 'clavicle_l', 'shoulder_l'],
  upper_arm_l: ['leftarm', 'upperarm_l', 'upper_arm_l', 'arm_l'],
  forearm_l: ['leftforearm', 'lowerarm_l', 'forearm_l'],
  hand_l: ['lefthand', 'hand_l'],
  shoulder_r: ['rightshoulder', 'clavicle_r', 'shoulder_r'],
  upper_arm_r: ['rightarm', 'upperarm_r', 'upper_arm_r', 'arm_r'],
  forearm_r: ['rightforearm', 'lowerarm_r', 'forearm_r'],
  hand_r: ['righthand', 'hand_r'],
  thigh_l: ['leftupleg', 'thigh_l', 'upleg_l', 'leg_l'],
  shin_l: ['leftleg', 'calf_l', 'shin_l'],
  foot_l: ['leftfoot', 'foot_l'],
  thigh_r: ['rightupleg', 'thigh_r', 'upleg_r', 'leg_r'],
  shin_r: ['rightleg', 'calf_r', 'shin_r'],
  foot_r: ['rightfoot', 'foot_r'],
});

function normalizeBoneName(name) {
  let text = String(name ?? '');
  for (const prefix of SOURCE_SKELETON_PREFIXES) {
    if (text.startsWith(prefix)) text = text.slice(prefix.length);
  }
  return text.toLowerCase().replace(/[\s._-]/g, '');
}

/**
 * Rename a clip's tracks so they drive a different skeleton.
 *
 * This is the *name* half of retargeting, and it is the half that belongs
 * in a browser. The other half — reconciling rest poses and bone lengths
 * so a short character does not do the splits — needs the source
 * skeleton's bind pose and belongs in `operators/gen_motion`, which has
 * it. A clip whose rest pose already matches (anything the motion
 * pipeline exported, or another character rigged by `autoRigHumanoid`)
 * needs only this.
 *
 * @param {THREE.AnimationClip} clip
 * @param {THREE.Object3D | Map<string, THREE.Bone>} target skeleton root
 *        or a bone map
 * @param {{boneMap?: Record<string, string>, strict?: boolean}} [options]
 * @returns {{clip: THREE.AnimationClip | null, mapped: string[],
 *            unmapped: string[]}}
 */
export function retargetClipToSkeleton(clip, target, options = {}) {
  if (!clip) return { clip: null, mapped: [], unmapped: [] };

  /** @type {Map<string, string>} normalized target name -> real name */
  const targetNames = new Map();
  if (target instanceof Map) {
    for (const name of target.keys()) targetNames.set(normalizeBoneName(name), name);
  } else if (target?.isObject3D) {
    target.traverse((child) => {
      if (child.isBone || child.type === 'Bone') {
        targetNames.set(normalizeBoneName(child.name), child.name);
      }
    });
  }
  // Canonical aliases give a second chance to a source name that does not
  // literally match, which is the usual case across two libraries.
  const aliasToCanonical = new Map();
  for (const [canonical, aliases] of Object.entries(A3GameSourceBoneAliases)) {
    for (const alias of aliases) {
      aliasToCanonical.set(normalizeBoneName(alias), canonical);
    }
  }

  const tracks = [];
  const mapped = [];
  const unmapped = [];
  for (const track of clip.tracks) {
    const [rawName, property] = String(track.name).split('.');
    const normalized = normalizeBoneName(rawName);
    let resolved = targetNames.get(normalized) ?? null;
    if (!resolved && options.boneMap?.[rawName]) {
      resolved = options.boneMap[rawName];
    }
    if (!resolved) {
      const canonical = aliasToCanonical.get(normalized);
      if (canonical) {
        resolved = targetNames.get(normalizeBoneName(canonical)) ?? canonical;
      }
    }
    if (!resolved) {
      unmapped.push(rawName);
      continue;
    }
    const copy = track.clone();
    copy.name = `${resolved}.${property}`;
    tracks.push(copy);
    mapped.push(`${rawName} -> ${resolved}`);
  }

  if (tracks.length === 0) return { clip: null, mapped, unmapped };
  if (options.strict && unmapped.length > 0) {
    return { clip: null, mapped, unmapped };
  }
  const retargeted = new THREE.AnimationClip(clip.name, clip.duration, tracks);
  retargeted.userData = { ...(clip.userData ?? {}), a3game: { retargeted: true } };
  return { clip: retargeted, mapped, unmapped };
}

/**
 * Motion clips staged by the adapter, resolved through the manifest.
 *
 * `three.assets.import_motion` / `three.animation.import_motion` write
 * artifacts of type `motion`. A motion file carries clips and, usually, a
 * skeleton but no renderable body — so loading one is not "instantiate a
 * model", and that is the whole reason this class exists rather than the
 * game calling `assets.instantiate` and hoping.
 */
export class A3GameMotionLibrary {
  /** @param {{assets: object}} options */
  constructor(options = {}) {
    if (!options.assets) {
      throw new TypeError('A3GameMotionLibrary requires an asset library');
    }
    this.assets = options.assets;
    /** @type {Map<string, THREE.AnimationClip[]>} */
    this.cache = new Map();
    /** @type {string[]} */
    this.warnings = [];
  }

  /** @returns {object[]} every staged motion artifact. */
  listMotions() {
    return this.assets.listByType('motion');
  }

  /** @returns {boolean} whether any motion artifact was staged at all. */
  get available() {
    return this.listMotions().length > 0;
  }

  /**
   * Load the clips carried by one motion artifact.
   *
   * @param {string | string[]} reference artifact_id, asset_id, or a
   *        preference list
   * @returns {Promise<THREE.AnimationClip[]>} empty when nothing resolved
   */
  async loadClips(reference) {
    const entry = this.assets.findEntry(reference);
    if (!entry) return [];
    if (this.cache.has(entry.artifact_id)) {
      return this.cache.get(entry.artifact_id);
    }
    try {
      const loaded = await this.assets.loadArtifact(entry.artifact_id);
      const clips = (loaded.animations ?? []).map((clip) => clip.clone());
      if (clips.length === 0) {
        this.warnings.push(
          `Motion artifact ${entry.asset_id} carries no animation clip; ` +
            'the export dropped its action, or the file is a mesh only',
        );
      }
      this.cache.set(entry.artifact_id, clips);
      return clips;
    } catch (error) {
      this.warnings.push(
        `Motion artifact ${entry.asset_id} failed to load: ` +
          String(error?.message ?? error),
      );
      return [];
    }
  }

  /**
   * Load every staged motion and retarget it onto one character.
   *
   * Clips are renamed to the state they represent when the artifact
   * declares one (`asset_id` such as `thug_walk` yields `walk`), because a
   * game maps states to clip names and a file called
   * `retargeted_003.fbx` tells it nothing.
   *
   * @param {THREE.Object3D} character the skinned hierarchy to drive
   * @param {{references?: (string | string[])[], states?: string[],
   *          rename?: Record<string, string>}} [options]
   * @returns {Promise<{clips: THREE.AnimationClip[], sources: string[]}>}
   */
  async loadForCharacter(character, options = {}) {
    const references =
      options.references ??
      this.listMotions().map((entry) => entry.artifact_id);
    const clips = [];
    const sources = [];
    for (const reference of references) {
      const loaded = await this.loadClips(reference);
      const entry = this.assets.findEntry(reference);
      for (const clip of loaded) {
        const { clip: retargeted, unmapped } = retargetClipToSkeleton(
          clip,
          character,
        );
        if (!retargeted) {
          this.warnings.push(
            `Clip ${clip.name} could not be retargeted: no track name ` +
              `matched a bone on the target (${unmapped.slice(0, 4).join(', ')})`,
          );
          continue;
        }
        const declared =
          options.rename?.[clip.name] ??
          this.#stateFromName(entry?.asset_id ?? '', clip.name, options.states);
        if (declared) retargeted.name = declared;
        clips.push(retargeted);
        sources.push(`${entry?.asset_id ?? 'motion'}:${clip.name}`);
      }
    }
    return { clips, sources };
  }

  #stateFromName(assetId, clipName, states) {
    const wanted = Array.isArray(states) ? states : A3GAME_HUMANOID_CLIP_NAMES;
    const haystack = `${assetId} ${clipName}`.toLowerCase();
    for (const state of wanted) {
      if (haystack.includes(String(state).toLowerCase())) return state;
    }
    return '';
  }
}

/**
 * Turn an asset reference into a character that moves.
 *
 * This is the call a generated game should make instead of
 * `assets.tryInstantiate` whenever the asset is a character, because it
 * answers the question the game actually has — "can I show this instead
 * of my primitive body?" — rather than only "did a file exist?".
 *
 * `motionSource` reports which of the three routes was taken, and
 * `motionSource: 'none'` is a real answer that a game must honour by
 * keeping the body it already had. That branch is the difference between
 * a character that looks generated and one that stands still forever.
 *
 * @param {object} assets an `A3GameAssetLibrary`
 * @param {string | string[]} reference artifact_id, asset_id, or a
 *        preference list
 * @param {{height?: number, ground?: boolean, envMapIntensity?: number,
 *          states?: string[], clipSpeed?: number, autoRig?: boolean,
 *          motionReferences?: (string | string[])[],
 *          motionLibrary?: A3GameMotionLibrary,
 *          requireMotion?: boolean, shoulderWidth?: number,
 *          minAspect?: number, defaultState?: string}} [options]
 * @returns {Promise<{object: THREE.Object3D,
 *                    animations: THREE.AnimationClip[],
 *                    animator: A3GameAnimationDirector | null,
 *                    motionSource: 'clips' | 'imported_motion' | 'auto_rig'
 *                                | 'none',
 *                    rig: object | null, measurement: object,
 *                    entry: object, warnings: string[]} | null>}
 */
/**
 * Find a skeleton that is already labelled with canonical bone names.
 *
 * This is the route for a character that came back from the real rigging
 * pipeline. `operators/gen_motion` (Puppeteer) predicts the skeleton and the
 * skinning weights properly, and the exporter renames the predicted joints to
 * `A3GameHumanoidBone` names on the way out — so the asset arrives skinned,
 * bound, and addressable, but with **no clips in the file**, because rigging
 * and animating are separate stages.
 *
 * Without this check such an asset falls all the way through to
 * `autoRigHumanoid`, which refuses an already-skinned model and returns
 * `null`, and the actor reports `motionSource: 'none'` — so the best character
 * in the project is the one the game throws away. All that is missing is the
 * clips, and the authored set fits a canonically named skeleton exactly.
 *
 * @param {THREE.Object3D} object
 * @param {number} [minimumBones] how many canonical names must be present
 * @returns {{skeleton: THREE.Skeleton, bones: Map<string, THREE.Bone>,
 *            height: number, matched: string[], missing: string[]} | null}
 */
export function findRiggedHumanoid(object, minimumBones = 12) {
  if (!object?.isObject3D) return null;
  /** @type {THREE.SkinnedMesh | null} */
  let skinned = null;
  object.traverse((child) => {
    if (!skinned && child.isSkinnedMesh && child.skeleton) skinned = child;
  });
  if (!skinned) return null;

  const canonical = new Set(Object.values(A3GameHumanoidBone));
  /** @type {Map<string, THREE.Bone>} */
  const bones = new Map();
  for (const bone of skinned.skeleton.bones) {
    const name = String(bone.name ?? '');
    if (canonical.has(name) && !bones.has(name)) bones.set(name, bone);
  }
  // The hips carry the root motion track, so a skeleton without them cannot be
  // driven by the authored set no matter how many other bones matched.
  if (bones.size < minimumBones || !bones.has(A3GameHumanoidBone.HIPS)) {
    return null;
  }

  // Height from the bound geometry rather than the bones: a clip's stride and
  // its hip travel are expressed as fractions of the character's height, and
  // the topmost bone sits inside the head rather than on top of it.
  const box = new THREE.Box3();
  const vertex = new THREE.Vector3();
  const position = skinned.geometry?.getAttribute('position');
  if (position) {
    for (let index = 0; index < position.count; index += 1) {
      box.expandByPoint(vertex.fromBufferAttribute(position, index));
    }
  }
  const height = box.isEmpty() ? 0 : box.max.y - box.min.y;

  return {
    skeleton: skinned.skeleton,
    bones,
    height,
    matched: [...bones.keys()],
    missing: [...canonical].filter((name) => !bones.has(name)),
  };
}

export async function createAnimatedActor(assets, reference, options = {}) {
  // A preference list is resolved *here* rather than by
  // `AssetLibrary.findEntry`, which stops at the first staged candidate.
  // That is the right rule for a prop and the wrong one for a character:
  // "the newer, better-looking mesh, unless it cannot be made to move"
  // is only answerable after trying to rig it, and a character that
  // cannot move is worse than a plainer one that can. So every candidate
  // is attempted in order, the first one that ends up with clips wins,
  // and a motionless result is kept only as a last resort.
  if (!Array.isArray(reference)) {
    return createSingleAnimatedActor(assets, reference, options);
  }
  let fallback = null;
  for (const candidate of reference) {
    const actor = await createSingleAnimatedActor(assets, candidate, options);
    if (!actor) continue;
    if (actor.motionSource !== 'none') return actor;
    if (!fallback) {
      fallback = actor;
      fallback.warnings = [
        ...(actor.warnings ?? []),
        `Asset ${String(candidate)} loaded but could not be animated; ` +
          'later candidates were tried before falling back to it.',
      ];
    }
  }
  return fallback;
}

async function createSingleAnimatedActor(assets, reference, options = {}) {
  const loaded = await assets.tryInstantiate(reference, {
    height: options.height,
    // A character is placed by its feet, and a generated model's origin is
    // wherever the reconstruction left it. Skipping this is why an
    // imported fighter stands in the floor or floats above it.
    ground: options.ground !== false,
    envMapIntensity: options.envMapIntensity ?? 1,
    frustumCulled: false,
  });
  if (!loaded) return null;

  const warnings = [];
  const measurement = measureHumanoid(loaded.object, options);
  let clips = (loaded.animations ?? []).filter((clip) => clip.tracks.length > 0);
  let motionSource = clips.length > 0 ? 'clips' : 'none';
  let rig = null;

  if (clips.length === 0) {
    const library =
      options.motionLibrary ?? new A3GameMotionLibrary({ assets });
    if (options.motionReferences?.length || library.available) {
      const imported = await library.loadForCharacter(loaded.object, {
        references: options.motionReferences,
        states: options.states,
      });
      if (imported.clips.length > 0) {
        clips = imported.clips;
        motionSource = 'imported_motion';
      }
      warnings.push(...library.warnings);
    }
  }

  if (clips.length === 0 && options.autoRig !== false) {
    // A properly rigged asset first: it already has the skeleton and the
    // weights that `autoRigHumanoid` can only approximate, and the only thing
    // it is missing is the clips. Checking this before the humanoid gate is
    // deliberate — the gate reads a bounding-box ratio, which says nothing
    // about a model that arrives with a labelled skeleton, and the archer
    // holding a bow fails that ratio while being perfectly riggable.
    const rigged = findRiggedHumanoid(loaded.object);
    if (rigged) {
      clips = createHumanoidClipSet(options.states, {
        height: rigged.height || options.height || 1.8,
        speed: options.clipSpeed,
        hipsRest: rigged.bones.get(A3GameHumanoidBone.HIPS)?.position,
      });
      motionSource = 'rigged_asset';
      if (rigged.missing.length > 0) {
        warnings.push(
          `Asset ${String(loaded.entry?.asset_id ?? reference)} is rigged but ` +
            `has no ${rigged.missing.join(', ')} bone, so those joints stay ` +
            'in their rest pose.',
        );
      }
    } else if (!measurement.humanoid) {
      warnings.push(
        `Asset ${String(loaded.entry?.asset_id ?? reference)} is not shaped ` +
          `like a standing figure (height/width ${measurement.aspect}, ` +
          `${measurement.reason}), so it was not rigged. Regenerate it, or ` +
          'keep the procedural body: a character that cannot move is worse ' +
          'than a plain one that can.',
      );
    } else {
      // Measured in world space only for the *gate*: proportions are
      // scale-invariant, so a ratio is safe to read there. The rig itself
      // measures the subtree's local space, because that is where the
      // geometry it binds will live.
      rig = autoRigHumanoid(loaded.object, {
        shoulderWidth: options.shoulderWidth,
      });
      if (rig) {
        clips = createHumanoidClipSet(options.states, {
          height: rig.height,
          speed: options.clipSpeed,
          hipsRest: rig.bones.get(A3GameHumanoidBone.HIPS)?.position,
        });
        motionSource = 'auto_rig';
      }
    }
  }

  if (clips.length === 0 && options.requireMotion) return null;

  let animator = null;
  if (clips.length > 0) {
    animator = new A3GameAnimationDirector(loaded.object, clips);
    if (options.defaultState) {
      animator.play(options.defaultState, { fade: 0 });
    }
  }

  return {
    ...loaded,
    animations: clips,
    animator,
    motionSource,
    rig,
    measurement,
    warnings,
  };
}

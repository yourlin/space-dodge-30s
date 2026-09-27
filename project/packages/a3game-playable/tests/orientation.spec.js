/**
 * The framework's own test for the one asset property glTF cannot carry.
 *
 * It ships inside `A3GamePlayable`, so `three.plugin.install_framework`
 * copies it into every generated project and every project's `vitest run`
 * verifies the orientation contract for free. A generated game does not
 * have to know this exists; it only has to not break it.
 *
 * The invariant under test is the one that is easy to get wrong and
 * impossible to notice: the correction must survive a game assigning its
 * own `rotation.y`, which is what every character controller does on
 * every frame.
 */

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  A3GAME_RUNTIME_FORWARD_AXIS,
  A3GameAssetLibrary,
  createInstancedFromModel,
  forwardAxisYaw,
  orientModel,
  prepareModel,
} from '@a3game/playable';

/** A marker at the model's own +Z, so a rotation is observable. */
function markedModel() {
  const model = new THREE.Group();
  model.name = 'subject';
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.2, 0.2),
    new THREE.MeshStandardMaterial(),
  );
  nose.name = 'nose';
  nose.position.set(0, 1, 1);        // faces +Z
  model.add(nose);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 2, 0.3),
    new THREE.MeshStandardMaterial(),
  );
  body.position.set(0, 1, 0);
  model.add(body);
  model.updateMatrixWorld(true);
  return model;
}

function nosePosition(root) {
  root.updateMatrixWorld(true);
  const nose = root.getObjectByName('nose');
  return nose.getWorldPosition(new THREE.Vector3());
}

describe('forwardAxisYaw', () => {
  it('is a quarter turn per cardinal axis, in three.js convention', () => {
    expect(A3GAME_RUNTIME_FORWARD_AXIS).toBe('-z');
    expect(forwardAxisYaw('-z')).toBeCloseTo(0);
    expect(forwardAxisYaw('+z')).toBeCloseTo(Math.PI);
    expect(forwardAxisYaw('+x')).toBeCloseTo(Math.PI / 2);
    expect(forwardAxisYaw('-x')).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('tolerates spellings and unknown input', () => {
    expect(forwardAxisYaw('z')).toBeCloseTo(Math.PI);
    expect(forwardAxisYaw('')).toBe(0);
    expect(forwardAxisYaw('sideways')).toBe(0);
  });
});

describe('orientModel', () => {
  it('turns a +Z model to face -Z', () => {
    const model = orientModel(markedModel(), { forwardAxis: '+z' });
    const nose = nosePosition(model);
    expect(nose.z).toBeCloseTo(-1, 5);
    expect(nose.x).toBeCloseTo(0, 5);
  });

  it('turns a +X model to face -Z', () => {
    const model = markedModel();
    model.getObjectByName('nose').position.set(1, 1, 0);   // faces +X
    const oriented = orientModel(model, { forwardAxis: '+x' });
    expect(nosePosition(oriented).z).toBeCloseTo(-1, 5);
  });

  it('accepts a manifest orientation block', () => {
    const model = orientModel(markedModel(), {
      orientation: { forward_axis: '+z', runtime_forward_axis: '-z' },
    });
    expect(nosePosition(model).z).toBeCloseTo(-1, 5);
  });

  it('does nothing when nothing is declared', () => {
    const model = orientModel(markedModel(), {});
    expect(nosePosition(model).z).toBeCloseTo(1, 5);
    expect(model.rotation.y).toBe(0);
  });

  it('adds an arbitrary yaw offset on top', () => {
    const model = orientModel(markedModel(), {
      forwardAxis: '+z',
      yawOffsetDegrees: 90,
    });
    expect(model.rotation.y).toBeCloseTo(Math.PI + Math.PI / 2, 5);
  });
});

describe('prepareModel with a facing axis', () => {
  it('orients before fitting, so the height is measured after rotation', () => {
    const model = prepareModel(markedModel(), {
      forwardAxis: '+z',
      height: 4,
    });
    const box = new THREE.Box3().setFromObject(model);
    expect(box.max.y - box.min.y).toBeCloseTo(4, 4);
    expect(nosePosition(model).z).toBeLessThan(0);
  });
});

describe('A3GameAssetLibrary orientation', () => {
  function libraryWith(entry) {
    const library = new A3GameAssetLibrary();
    library.manifest = { assets: { [entry.artifact_id]: entry } };
    library.available = true;
    library.byArtifactId.set(entry.artifact_id, entry);
    library.byAssetId.set(entry.asset_id, [entry]);
    library.byType.set(entry.type, [entry]);
    return library;
  }

  const entry = (orientation) => ({
    artifact_id: 'web_group_subject_abc123',
    asset_id: 'subject',
    type: 'prop',
    representation: 'gltf_binary',
    class: 'Group',
    url: '/assets/imported/props/subject.glb',
    capabilities: { skinned: false },
    animations: [],
    orientation,
  });

  it('wraps the model and rotates the model, not the wrapper', async () => {
    const record = entry({ forward_axis: '+z', runtime_forward_axis: '-z' });
    const library = libraryWith(record);
    library.cache.set(record.artifact_id, Promise.resolve({
      object: markedModel(), animations: [], entry: record,
    }));

    const loaded = await library.tryInstantiate('subject');
    expect(loaded).not.toBeNull();
    // The wrapper is free for gameplay to turn...
    expect(loaded.object.rotation.y).toBe(0);
    expect(loaded.object).not.toBe(loaded.model);
    // ...and the model inside it already faces -Z.
    expect(nosePosition(loaded.object).z).toBeCloseTo(-1, 5);

    // A game assigning its own facing must not undo the correction.
    loaded.object.rotation.y = Math.PI / 2;
    const nose = nosePosition(loaded.object);
    expect(nose.x).toBeCloseTo(-1, 5);
    expect(nose.z).toBeCloseTo(0, 5);
  });

  it('applies the recorded scale hint when no height is given', async () => {
    const record = entry({ forward_axis: '+z', scale_hint_metres: 6 });
    const library = libraryWith(record);
    library.cache.set(record.artifact_id, Promise.resolve({
      object: markedModel(), animations: [], entry: record,
    }));

    const loaded = await library.tryInstantiate('subject');
    const box = new THREE.Box3().setFromObject(loaded.object);
    expect(box.max.y - box.min.y).toBeCloseTo(6, 3);
  });

  it('leaves an unannotated asset exactly as authored', async () => {
    const record = entry(undefined);
    const library = libraryWith(record);
    library.cache.set(record.artifact_id, Promise.resolve({
      object: markedModel(), animations: [], entry: record,
    }));

    const loaded = await library.tryInstantiate('subject');
    expect(loaded.object).toBe(loaded.model);
    expect(nosePosition(loaded.object).z).toBeCloseTo(1, 5);
  });

  it('honours orient: false', async () => {
    const record = entry({ forward_axis: '+z' });
    const library = libraryWith(record);
    library.cache.set(record.artifact_id, Promise.resolve({
      object: markedModel(), animations: [], entry: record,
    }));

    const loaded = await library.tryInstantiate('subject', { orient: false });
    expect(nosePosition(loaded.object).z).toBeCloseTo(1, 5);
  });
});

describe('asset preference lists', () => {
  /**
   * A game names the art it wants without knowing what was produced.
   * This is what lets one line of gameplay code prefer a generated prop,
   * accept a CC0 stand-in, and still fall back to a primitive.
   */
  function libraryWithIds(...assetIds) {
    const library = new A3GameAssetLibrary();
    const assets = {};
    for (const assetId of assetIds) {
      const record = {
        artifact_id: `web_group_${assetId}_abc`,
        asset_id: assetId,
        type: 'prop',
        representation: 'gltf_binary',
        class: 'Group',
        url: `/assets/imported/props/${assetId}.glb`,
        capabilities: { skinned: false },
        animations: [],
      };
      assets[record.artifact_id] = record;
      library.byArtifactId.set(record.artifact_id, record);
      library.byAssetId.set(assetId, [record]);
      library.byType.set('prop', [
        ...(library.byType.get('prop') ?? []),
        record,
      ]);
    }
    library.manifest = { assets };
    library.available = true;
    return library;
  }

  it('takes the first staged candidate', () => {
    const library = libraryWithIds('robot_expressive');
    const entry = library.findEntry(['explorer_ranger', 'robot_expressive']);
    expect(entry?.asset_id).toBe('robot_expressive');
  });

  it('prefers the earlier candidate when both are staged', () => {
    const library = libraryWithIds('robot_expressive', 'explorer_ranger');
    const entry = library.findEntry(['explorer_ranger', 'robot_expressive']);
    expect(entry?.asset_id).toBe('explorer_ranger');
  });

  it('reports absence for has(), so a fallback runs', () => {
    const library = libraryWithIds('something_else');
    expect(library.has(['explorer_ranger', 'robot_expressive'])).toBe(false);
    expect(library.has(['explorer_ranger', 'something_else'])).toBe(true);
  });

  it('survives an empty list and an empty manifest', () => {
    expect(libraryWithIds().findEntry([])).toBeNull();
    expect(new A3GameAssetLibrary().findEntry(['a', 'b'])).toBeNull();
  });
});

describe('createInstancedFromModel', () => {
  /** A single-mesh body, which is what image-to-3D produces. */
  function generatedProp(scale = 1) {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial(),
    );
    mesh.position.y = 1;
    root.add(mesh);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    return root;
  }

  it('draws many copies from one geometry', () => {
    const instanced = createInstancedFromModel(generatedProp(), 74);
    expect(instanced?.isInstancedMesh).toBe(true);
    expect(instanced.count).toBe(74);
    expect(instanced.castShadow).toBe(true);
  });

  it('bakes the source transform, so a fitted size is kept', () => {
    // A model already scaled to 3x must not come out unit-sized: the
    // instance matrix carries where a copy goes, not how it was fitted.
    const instanced = createInstancedFromModel(generatedProp(3), 2);
    instanced.setMatrixAt(0, new THREE.Matrix4());
    instanced.setMatrixAt(1, new THREE.Matrix4());
    const box = new THREE.Box3().setFromBufferAttribute(
      instanced.geometry.getAttribute('position'),
    );
    expect(box.max.y - box.min.y).toBeCloseTo(6, 5);
  });

  it('refuses a skinned model rather than flattening it', () => {
    const root = new THREE.Group();
    const skinned = new THREE.SkinnedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial(),
    );
    root.add(skinned);
    expect(createInstancedFromModel(root, 10)).toBeNull();
  });

  it('refuses a multi-part model, and a nonsense count', () => {
    const root = generatedProp();
    root.add(new THREE.Mesh(
      new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(),
    ));
    expect(createInstancedFromModel(root, 10)).toBeNull();
    expect(createInstancedFromModel(generatedProp(), 0)).toBeNull();
    expect(createInstancedFromModel(null, 10)).toBeNull();
  });
});

import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { toCreasedNormals } from './vendor/BufferGeometryUtils.js';

const stage = document.querySelector('#stage');
const status = document.querySelector('#load-status');
const controls = document.querySelector('#controls');
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const shells = new Set(['left_shell.stl', 'right_shell.stl', 'top_head_shell.stl', 'bottom_head_shell.stl']);
const orangeParts = new Set(['jaw.stl', 'jaw_soft.stl', 'soft_mouth_top.stl', 'sole_left.stl', 'sole_right.stl', 'foot_left.stl', 'foot_right.stl']);

const stand = {
  left_hip_roll: -0.08727, left_hip_pitch: -0.457924, left_knee: -0.00494, left_ankle: 0.452984,
  right_hip_roll: 0.08727, right_hip_pitch: 0.457924, right_knee: 0.00494, right_ankle: -0.452984,
  neck_pitch: 0.34907, head_pitch: 0.34907,
};

function setQuaternion(object, [w, x, y, z]) {
  object.quaternion.set(x, y, z, w).normalize();
}

async function loadDuck() {
  const [model, response] = await Promise.all([
    new GLTFLoader().loadAsync('./assets/microduck.glb'),
    fetch('./assets/kinematics.json'),
  ]);
  if (!response.ok) throw new Error('Kinematics: ' + response.status);
  const { bodies } = await response.json();
  const geometry = new Map();
  model.scene.traverse(mesh => {
    if (mesh.isMesh) geometry.set(mesh.userData.meshFile, mesh.geometry);
  });

  const duck = new THREE.Group();
  const rig = new THREE.Group();
  rig.rotation.x = -Math.PI / 2;
  rig.scale.setScalar(1000);
  duck.add(rig);
  const nodes = new Map();
  const joints = new Map();
  const feet = [];
  const displayGeometry = new Map();
  const materials = new Map();
  const seen = new Set();
  for (const body of bodies) {
    const node = new THREE.Group();
    node.position.fromArray(body.pos);
    setQuaternion(node, body.quat);
    nodes.set(body.name, node);
    if (body.joint) joints.set(body.joint.name, {
      node, rest: node.quaternion.clone(), axis: new THREE.Vector3(...body.joint.axis),
      range: body.joint.range, value: stand[body.joint.name] ?? 0,
    });
  }
  for (const body of bodies) {
    const node = nodes.get(body.name);
    (nodes.get(body.parent) ?? rig).add(node);
    for (const part of body.geoms) {
      if (!part.mesh) continue;
      const key = JSON.stringify([body.name, part.mesh, part.pos, part.quat]);
      if (seen.has(key)) continue;
      seen.add(key);
      if (!displayGeometry.has(part.mesh)) {
        const source = geometry.get(part.mesh);
        if (!source) throw new Error('Missing mesh: ' + part.mesh);
        const scaled = source.clone().scale(1000, 1000, 1000);
        const display = toCreasedNormals(scaled, Math.PI / 5).scale(0.001, 0.001, 0.001);
        if (display !== scaled) scaled.dispose();
        displayGeometry.set(part.mesh, display);
      }
      let color = 0x34343a;
      if (shells.has(part.mesh)) color = 0xfff5e7;
      else if (orangeParts.has(part.mesh)) color = 0xff6816;
      else if (part.mesh === 'noenoeil.stl') color = 0xffcb28;
      else if (part.mesh === 'face_part.stl') color = 0x666874;
      else if (part.mesh === 'lens.stl') color = 0x16161b;
      if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.65 }));
      const mesh = new THREE.Mesh(displayGeometry.get(part.mesh), materials.get(color));
      if (part.pos) mesh.position.fromArray(part.pos);
      if (part.quat) setQuaternion(mesh, part.quat);
      node.add(mesh);
      if (part.mesh.startsWith('sole_')) {
        mesh.geometry.computeBoundingBox();
        feet.push(mesh);
      }
    }
  }
  return { duck, joints, feet };
}

function addArena(scene) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({color: 0x252f58}));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2;
  const grid = new THREE.GridHelper(1150, 23, 0x6077ae, 0x3d507e);
  grid.position.y = -1;
  scene.add(floor, grid, new THREE.HemisphereLight(0xfff3e3, 0x6f6c9c, 2.15));
  const light = new THREE.DirectionalLight(0xffddbb, 2.7);
  light.position.set(230, 400, 200);
  scene.add(light);

  const marker = new THREE.RingGeometry(75, 77, 64);
  marker.rotateX(-Math.PI / 2);
  const spawn = new THREE.Mesh(marker, new THREE.MeshBasicMaterial({ color: 0xfd8a40 }));
  scene.add(spawn);

  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(220, 180), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec2 p; void main(){p=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'varying vec2 p; void main(){float a=1.0-smoothstep(0.04,0.5,length(p-0.5));gl_FragColor=vec4(0.02,0.01,0.04,a*a*0.55);}',
  }));
  shadow.rotation.x = -Math.PI / 2;
  return shadow;
}

function play(renderer, scene, camera, orbit, model, shadow) {
  const keys = new Set();
  const pad = new Map();
  const { duck, joints, feet } = model;
  const point = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  let phase = 0;
  let stride = 0;
  let seated = false;
  let looking = false;
  let previous;
  let follow = true;
  const sitButton = document.querySelector('#sit');
  const lookButton = document.querySelector('#look');
  const headButton = document.querySelector('#head-control');
  const headPanel = document.querySelector('#head-panel');
  const headAngles = {};
  const headInputs = ['yaw', 'pitch', 'roll'].map(axis => {
    const input = document.querySelector('#head-' + axis);
    const output = document.querySelector('#head-' + axis + '-angle');
    const joint = 'head_' + axis;
    const update = () => {
      headAngles[joint] = THREE.MathUtils.degToRad(Number(input.value));
      output.value = input.value + '°';
    };
    update();
    input.addEventListener('input', () => {
      if (looking) toggleLook();
      update();
    });
    return { input, update };
  });
  headButton.addEventListener('click', () => {
    headPanel.hidden = !headPanel.hidden;
    headButton.setAttribute('aria-expanded', String(!headPanel.hidden));
  });
  const cameraButton = document.querySelector('#camera');
  const held = (...codes) => codes.some(code => keys.has(code) || [...pad.values()].includes(code));

  function toggleSit() {
    seated = !seated;
    sitButton.setAttribute('aria-pressed', seated);
    sitButton.textContent = seated ? '站起' : '坐下';
  }
  function toggleLook() {
    looking = !looking;
    lookButton.setAttribute('aria-pressed', looking);
  }
  function setFollow(value) {
    follow = value;
    cameraButton.setAttribute('aria-pressed', follow);
  }
  function centerCamera() {
    setFollow(true);
    const distance = Math.max(1, 0.82 / camera.aspect);
    camera.position.set(duck.position.x + 365 * distance, 145 + 125 * distance, duck.position.z + 245 * distance);
    orbit.target.set(duck.position.x, 145, duck.position.z);
    orbit.update();
  }
  function reset() {
    if (seated) toggleSit();
    if (looking) toggleLook();
    for (const { input, update } of headInputs) {
      input.value = input.defaultValue;
      update();
    }
    duck.position.set(0, 0, 0);
    duck.rotation.y = 0;
    stride = 0;
    phase = 0;
    centerCamera();
  }
  orbit.addEventListener('start', () => setFollow(false));
  cameraButton.addEventListener('click', () => follow ? setFollow(false) : centerCamera());
  document.querySelector('#reset').addEventListener('click', reset);
  sitButton.addEventListener('click', toggleSit);
  lookButton.addEventListener('click', toggleLook);
  const moveKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (moveKeys.includes(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    } else if (!event.repeat && ['KeyR', 'KeyC', 'Space'].includes(event.code)) {
      if (event.code === 'Space' && event.target.closest?.('button')) return;
      event.preventDefault();
      if (event.code === 'KeyR') toggleSit();
      else if (event.code === 'KeyC') cameraButton.click();
      else reset();
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); pad.clear(); });
  for (const button of document.querySelectorAll('[data-move]')) {
    button.addEventListener('pointerdown', event => {
      button.setPointerCapture(event.pointerId);
      pad.set(event.pointerId, button.dataset.move);
    });
    button.addEventListener('lostpointercapture', event => pad.delete(event.pointerId));
    button.addEventListener('keydown', event => {
      if (event.code === 'Space' || event.code === 'Enter') {
        event.preventDefault();
        keys.add(button.dataset.move);
      }
    });
    button.addEventListener('keyup', () => keys.delete(button.dataset.move));
    button.addEventListener('blur', () => keys.delete(button.dataset.move));
  }
  centerCamera();

  renderer.setAnimationLoop(now => {
    const dt = Math.min((now - (previous ?? now)) / 1000, 0.045);
    previous = now;
    const forward = Number(held('ArrowUp', 'KeyW')) - Number(held('ArrowDown', 'KeyS'));
    const steering = Number(held('ArrowLeft', 'KeyA')) - Number(held('ArrowRight', 'KeyD'));
    const moving = !seated && Boolean(forward || steering);
    stride = damp(stride, moving ? 1 : 0, 11, dt);
    if (moving) {
      duck.rotation.y += steering * dt * 1.9;
      duck.position.x = clamp(duck.position.x + Math.cos(duck.rotation.y) * forward * dt * 155, -470, 470);
      duck.position.z = clamp(duck.position.z - Math.sin(duck.rotation.y) * forward * dt * 155, -470, 470);
    }
    phase += dt * 10;
    const offset = {};
    for (const [side, sign] of [['left', 1], ['right', -1]]) {
      const swing = Math.sin(phase) * sign;
      const lift = Math.max(0, swing);
      const amplitude = stride * (reducedMotion.matches ? 0.42 : 1);
      const step = swing * amplitude * (forward || 0.45);
      offset[side + '_hip_pitch'] = sign * (seated ? -0.47 : step * 0.44);
      offset[side + '_knee'] = sign * (seated ? 0.98 : lift * amplitude * 0.55);
      offset[side + '_ankle'] = sign * (seated ? -0.51 : -step * 0.44 - lift * amplitude * 0.55);
    }
    const lookAngle = reducedMotion.matches ? 0.35 : Math.sin(now / 460) * 0.65;
    for (const [name, joint] of joints) {
      const base = headAngles[name] ?? stand[name] ?? 0;
      const angle = name === 'head_yaw' && looking ? lookAngle : base + (offset[name] ?? 0);
      const target = clamp(angle, ...joint.range);
      joint.value = damp(joint.value, target, 14, dt);
      joint.node.quaternion.copy(joint.rest).multiply(turn.setFromAxisAngle(joint.axis, joint.value));
    }

    // Ground the lowest sole using its corners in the posed rig.
    duck.position.y = 0;
    duck.updateMatrixWorld(true);
    let soleHeight = Infinity;
    for (const foot of feet) {
      const {min, max} = foot.geometry.boundingBox;
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        soleHeight = Math.min(soleHeight, foot.localToWorld(point.set(x, y, z)).y);
      }
    }
    duck.position.y = -soleHeight;
    shadow.position.set(duck.position.x, 0, duck.position.z);
    if (follow) {
      const x = damp(orbit.target.x, duck.position.x, 6, dt);
      const z = damp(orbit.target.z, duck.position.z, 6, dt);
      camera.position.x += x - orbit.target.x;
      camera.position.z += z - orbit.target.z;
      orbit.target.x = x;
      orbit.target.z = z;
    }
    orbit.update();
    renderer.render(scene, camera);
  });
}

async function start() {
  const model = await loadDuck();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x1e264c, 0.0012);
  const shadow = addArena(scene);
  scene.add(shadow, model.duck);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 3000);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enablePan = false;
  orbit.enableDamping = true;
  orbit.minDistance = 165;
  orbit.maxDistance = 870;
  orbit.maxPolarAngle = Math.PI * 0.49;
  const resize = () => {
    const { clientWidth: width, clientHeight: height } = stage;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  resize();
  new ResizeObserver(resize).observe(stage);
  stage.prepend(renderer.domElement);
  status.hidden = true;
  controls.disabled = false;
  document.querySelector('#move-pad').disabled = false;
  play(renderer, scene, camera, orbit, model, shadow);
}
start().catch(error => {
  console.error(error);
  status.textContent = '無法開啟 3D 場景。請用本機預覽網址重新整理，並確認瀏覽器支援 WebGL 2。';
});

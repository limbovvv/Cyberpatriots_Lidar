import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

type Args = {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | undefined>;
  sceneRef: React.MutableRefObject<THREE.Scene | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  controlsRef: React.MutableRefObject<OrbitControls | undefined>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  pointsRef: React.MutableRefObject<THREE.Points | undefined>;
  scheduleRender: () => void;
  rotateActiveRef: React.MutableRefObject<boolean>;
  lastPointerRef: React.MutableRefObject<{ x: number; y: number }>;
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  lookDistanceRef: React.MutableRefObject<number>;
  brushCursorRef: React.MutableRefObject<THREE.Group | null>;
};

export function setupThreeSceneAndControls({
  containerRef,
  rendererRef,
  sceneRef,
  cameraRef,
  controlsRef,
  geometryRef,
  pointsRef,
  scheduleRender,
  rotateActiveRef,
  lastPointerRef,
  yawRef,
  pitchRef,
  lookDistanceRef,
  brushCursorRef,
}: Args) {
  if (!containerRef.current) return () => {};

  const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x111111);
  containerRef.current.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100000);
  camera.position.set(0, 0, 100);
  // remember baseFar to support user-controlled render distance multiplier
  (camera as any).userData = (camera as any).userData || {};
  (camera as any).userData.baseFar = camera.far;
  const farMul = (window as any)?.__pcd_tool_options__?.cameraFarMultiplier ?? 1;
  if (Number.isFinite(farMul) && farMul > 0) {
    camera.far = (camera as any).userData.baseFar * farMul;
    camera.updateProjectionMatrix();
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 0.5;
  controls.screenSpacePanning = false;
  controls.enableRotate = false;
  controls.enablePan = true;
  let rmbMode: "pan" | "rotate" = "pan";
  const setRightButtonMode = (mode: "pan" | "rotate") => {
    rmbMode = mode;
    if (mode === "rotate") {
      controls.enableRotate = true;
      controls.enablePan = false;
      (controls.mouseButtons as any).RIGHT = THREE.MOUSE.ROTATE;
    } else {
      controls.enableRotate = false;
      controls.enablePan = true;
      (controls.mouseButtons as any).RIGHT = THREE.MOUSE.PAN;
    }
    controls.update();
  };
  controls.mouseButtons = {
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN,
  } as any;
  setRightButtonMode("pan");

  const geometry = new THREE.BufferGeometry();
  geometryRef.current = geometry;

  // Custom shader material for round, soft-edged points with simple LOD
  const uniforms = {
    uSize: { value: 0.4 },
    uScale: { value: 1.0 },
    uSoftness: { value: 0.1 },
    uLodStep: { value: 1.0 },
    uPixelStep: { value: 1.0 },
    uSizeFalloff: { value: 1.4 },
    uDensityK: { value: 20000.0 },
    uFogDensity: { value: 0.002 },
    uBgColor: { value: new THREE.Color(0x111111) },
  } as const;
  const vertexShader = `
    attribute vec3 color;
    attribute float aIndex;
    varying vec3 vColor;
    varying float vIndex;
    varying float vEyeDepth;
    uniform float uSize;
    uniform float uScale;
    uniform float uSizeFalloff;
    void main() {
      vColor = color;
      vIndex = aIndex;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vEyeDepth = -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition;
      float attSize = uSize * (uScale / pow(max(1e-6, vEyeDepth), uSizeFalloff));
      gl_PointSize = attSize;
    }
  `;
  const fragmentShader = `
    precision mediump float;
    varying vec3 vColor;
    varying float vIndex;
    varying float vEyeDepth;
    uniform float uSoftness;
    uniform float uLodStep;
    uniform float uPixelStep;
    uniform float uDensityK;
    uniform float uFogDensity;
    uniform vec3 uBgColor;

    float hash11(float n) {
      return fract(sin(n) * 43758.5453123);
    }
    void main() {
      if (uLodStep > 1.0) {
        if (mod(vIndex, uLodStep) > 0.5) discard;
      }
      // Stochastic thinning combining screen-space step and distance
      float keepProb = 1.0;
      if (uPixelStep > 1.0) {
        keepProb *= 1.0 / (uPixelStep * uPixelStep);
      }
      // Distance-based factor ~ 1 / depth^2 scaled by uDensityK
      keepProb *= clamp(uDensityK / max(1.0, vEyeDepth * vEyeDepth), 0.01, 1.0);
      float r = hash11(vIndex + 0.1234);
      if (r > keepProb) discard;
      vec2 uv = gl_PointCoord - vec2(0.5);
      float d = length(uv);
      float alpha = smoothstep(0.5, 0.5 - uSoftness, 0.5 - d);
      if (alpha <= 0.0) discard;
      // Simple exponential fog by eye depth
      float fogFactor = 1.0 - exp(-uFogDensity * vEyeDepth);
      fogFactor = clamp(fogFactor, 0.0, 1.0);
      vec3 col = mix(vColor, uBgColor, fogFactor);
      float a = alpha * (1.0 - fogFactor);
      gl_FragColor = vec4(col, a);
    }
  `;
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  pointsRef.current = points;

  scene.add(new THREE.AxesHelper(10));

  rendererRef.current = renderer;
  sceneRef.current = scene;
  cameraRef.current = camera;
  controlsRef.current = controls;
  lookDistanceRef.current = camera.position.distanceTo(controls.target);

  // Initialize uScale uniform based on viewport height and FOV
  const updateScaleUniform = () => {
    const size = renderer.getSize(new THREE.Vector2());
    const uScale = size.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    (material.uniforms as any).uScale.value = uScale;
    (material.uniforms as any).uBgColor.value = (scene.background as THREE.Color) || new THREE.Color(0x111111);
  };
  updateScaleUniform();

  const domElement = renderer.domElement;
  // Prevent default context menu to allow RMB navigation universally
  const onCtx = (e: MouseEvent) => e.preventDefault();
  domElement.addEventListener("contextmenu", onCtx);

  const brushCursorGroup = new THREE.Group();
  const brushSegments = 64;
  const outlinePoints: THREE.Vector3[] = [];
  for (let i = 0; i < brushSegments; i += 1) {
    const theta = (i / brushSegments) * Math.PI * 2;
    outlinePoints.push(new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0));
  }
  const brushOutlineGeometry = new THREE.BufferGeometry().setFromPoints(outlinePoints);
  const brushOutlineMaterial = new THREE.LineBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const brushOutline = new THREE.LineLoop(brushOutlineGeometry, brushOutlineMaterial);
  brushOutline.renderOrder = 2;

  const brushFillGeometry = new THREE.CircleGeometry(1, brushSegments);
  const brushFillMaterial = new THREE.MeshBasicMaterial({
    color: 0xf97316,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });
  const brushFill = new THREE.Mesh(brushFillGeometry, brushFillMaterial);
  brushFill.renderOrder = 1;

  brushCursorGroup.add(brushFill);
  brushCursorGroup.add(brushOutline);
  brushCursorGroup.renderOrder = 999;
  brushCursorGroup.visible = false;
  brushCursorGroup.name = "BrushCursor";
  brushCursorGroup.scale.setScalar(1);
  brushCursorGroup.position.set(0, 0, 0);
  brushCursorGroup.quaternion.identity();
  brushCursorGroup.userData = {
    fillGeo: brushFillGeometry,
    fillMat: brushFillMaterial,
    outlineGeo: brushOutlineGeometry,
    outlineMat: brushOutlineMaterial,
  };

  scene.add(brushCursorGroup);
  brushCursorRef.current = brushCursorGroup;

  let brushActive = false;
  let controlsStateBeforeBrush:
    | {
        enabled: boolean;
        rightButtonMode: "pan" | "rotate";
      }
    | null = null;

  const restoreControlsState = () => {
    if (controlsStateBeforeBrush) {
      controls.enabled = controlsStateBeforeBrush.enabled;
      setRightButtonMode(controlsStateBeforeBrush.rightButtonMode);
    } else {
      controls.enabled = true;
      setRightButtonMode("pan");
    }
    controls.update();
  };

  const handleBrushStart = () => {
    if (brushActive) return;
    brushActive = true;
    controlsStateBeforeBrush = {
      enabled: controls.enabled,
      rightButtonMode: rmbMode,
    };
    controls.enabled = false;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.update();
  };

  const handleBrushEnd = () => {
    if (!brushActive) return;
    brushActive = false;
    restoreControlsState();
    scheduleRender();
  };

  window.addEventListener("pcd-brush-start", handleBrushStart);
  window.addEventListener("pcd-brush-end", handleBrushEnd);

  const updateTargetFromCamera = () => {
    const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    controls.target.copy(camera.position).addScaledVector(direction, lookDistanceRef.current);
  };

  const preventDefaultContext = (event: MouseEvent) => event.preventDefault();

  let rmbActive = false;

  const ensureRightButtonMode = (mode: "pan" | "rotate") => {
    if (rmbMode === mode) return;
    setRightButtonMode(mode);
  };

  const handleRmbPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;
    rmbActive = true;
    const rotate = event.shiftKey || event.ctrlKey;
    ensureRightButtonMode(rotate ? "rotate" : "pan");
  };

  const handleRmbPointerMove = (event: PointerEvent) => {
    if (!rmbActive) return;
    if ((event.buttons & 2) === 0) {
      rmbActive = false;
      ensureRightButtonMode("pan");
      return;
    }
    const rotate = event.shiftKey || event.ctrlKey;
    ensureRightButtonMode(rotate ? "rotate" : "pan");
  };

  const handleRmbPointerUp = (event: PointerEvent) => {
    if (event.button !== 2) return;
    rmbActive = false;
    ensureRightButtonMode("pan");
  };

  const handleRmbPointerLeave = () => {
    if (!rmbActive) return;
    rmbActive = false;
    ensureRightButtonMode("pan");
  };

  domElement.addEventListener("pointerdown", handleRmbPointerDown);
  domElement.addEventListener("pointermove", handleRmbPointerMove);
  domElement.addEventListener("pointerup", handleRmbPointerUp);
  domElement.addEventListener("pointerleave", handleRmbPointerLeave);
  domElement.addEventListener("pointercancel", handleRmbPointerLeave);

  const handlePointerDown = (event: PointerEvent) => {
    const hasActiveSession = Boolean((window as any).__pcd_session_active__);

    if (!hasActiveSession && event.button === 0 && !event.shiftKey) {
      console.log("controls")
      rotateActiveRef.current = true;
      controls.enabled = false;
      lookDistanceRef.current = camera.position.distanceTo(controls.target);
      const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      yawRef.current = euler.y;
      pitchRef.current = euler.x;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      domElement.setPointerCapture(event.pointerId);
    } else if (event.button === 2) {
      event.preventDefault();
      if (event.shiftKey) {
        controls.enablePan = true;
        controls.enableRotate = false;
        (controls.mouseButtons as any).RIGHT = THREE.MOUSE.PAN;
      } else {
        controls.enableRotate = true;
        controls.enablePan = false;
        (controls.mouseButtons as any).RIGHT = THREE.MOUSE.ROTATE;
      }
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!rotateActiveRef.current) return;
    const prev = lastPointerRef.current;
    const deltaX = (event.clientX - prev.x) * 0.0025;
    const deltaY = (event.clientY - prev.y) * 0.0025;
    lastPointerRef.current = { x: event.clientX, y: event.clientY };

    yawRef.current -= deltaX;
    pitchRef.current -= deltaY;
    const limit = Math.PI / 2 - 0.05;
    pitchRef.current = Math.max(-limit, Math.min(limit, pitchRef.current));

    camera.quaternion.setFromEuler(new THREE.Euler(pitchRef.current, yawRef.current, 0, "YXZ"));
    updateTargetFromCamera();
    controls.update();
    scheduleRender();
  };

  const releaseCustomRotate = (event?: PointerEvent) => {
    if (rotateActiveRef.current) {
      rotateActiveRef.current = false;
      controls.enabled = true;
      if (event) {
        try {
          domElement.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      }
    }
    setRightButtonMode("pan");
    scheduleRender();
  };


  const onResize = () => {
    if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;
    rendererRef.current.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    rendererRef.current.setSize(clientWidth, clientHeight, false);
    cameraRef.current.aspect = clientWidth / Math.max(clientHeight, 1);
    cameraRef.current.updateProjectionMatrix();
    updateScaleUniform();
    scheduleRender();
  };
  // Observe both window and container size changes
  window.addEventListener("resize", onResize);
  const ro = new ResizeObserver(onResize);
  if (containerRef.current) ro.observe(containerRef.current);
  onResize();

  // LOD based on distance to target
  const lodUpdater = () => {
    const dist = camera.position.distanceTo(controls.target);
    let step = 1.0;
    if (dist > 80) step = 2.0;
    if (dist > 160) step = 4.0;
    if (dist > 320) step = 8.0;
    if (dist > 640) step = 16.0;
    if (dist > 1280) step = 32.0;
    (material.uniforms as any).uLodStep.value = step;
    scheduleRender();
  };

  controls.addEventListener("change", () => { lodUpdater(); scheduleRender(); });
  lodUpdater();
  scheduleRender();
  scheduleRender();

  return () => {
    window.removeEventListener("pcd-brush-start", handleBrushStart);
    window.removeEventListener("pcd-brush-end", handleBrushEnd);
    if (brushActive) {
      brushActive = false;
      restoreControlsState();
    }
    controlsStateBeforeBrush = null;
    if (brushCursorRef.current === brushCursorGroup) {
      brushCursorRef.current = null;
    }
    scene.remove(brushCursorGroup);
    const {
      fillGeo,
      fillMat,
      outlineGeo,
      outlineMat,
    }: {
      fillGeo?: THREE.CircleGeometry;
      fillMat?: THREE.MeshBasicMaterial;
      outlineGeo?: THREE.BufferGeometry;
      outlineMat?: THREE.LineBasicMaterial;
    } = brushCursorGroup.userData || {};
    fillGeo?.dispose();
    fillMat?.dispose();
    outlineGeo?.dispose();
    outlineMat?.dispose();
    domElement.removeEventListener("pointerdown", handleRmbPointerDown);
    domElement.removeEventListener("pointermove", handleRmbPointerMove);
    domElement.removeEventListener("pointerup", handleRmbPointerUp);
    domElement.removeEventListener("pointerleave", handleRmbPointerLeave);
    domElement.removeEventListener("pointercancel", handleRmbPointerLeave);
    domElement.removeEventListener("contextmenu", onCtx);
    window.removeEventListener("resize", onResize);
    try { ro.disconnect(); } catch {}
    controls.removeEventListener("change", () => { lodUpdater(); });
    controls.dispose();
    renderer.dispose();
    geometry.dispose();
    scene.clear();
    containerRef.current?.removeChild(renderer.domElement);
  };
}

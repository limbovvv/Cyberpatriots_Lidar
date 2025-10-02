import * as THREE from "three";
import { InternalBuffers } from "./types";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

type Args = {
  buffersRef: React.MutableRefObject<InternalBuffers | null>;
  geometryRef: React.MutableRefObject<THREE.BufferGeometry | undefined>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | undefined>;
  controlsRef: React.MutableRefObject<OrbitControls | undefined>;
  poseInitializedRef: React.MutableRefObject<boolean>;
  scheduleRender?: () => void;
};

// Utility to compute median and quantiles from sample
function quantiles(values: number[], qs: number[]): number[] {
  if (values.length === 0) return qs.map(() => 0);
  const arr = values.slice().sort((a, b) => a - b);
  return qs.map((q) => {
    const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))));
    return arr[idx];
  });
}

export function tryInitializeCameraPose({
  buffersRef,
  geometryRef,
  cameraRef,
  controlsRef,
  poseInitializedRef,
  scheduleRender,
}: Args) {
  if (poseInitializedRef.current) return false;
  const buffers = buffersRef.current;
  const geometry = geometryRef.current;
  const camera = cameraRef.current;
  const controls = controlsRef.current;
  if (!buffers || !geometry || !camera || !controls) return false;

  const count = (geometry as any).drawRange?.count | 0;
  if (count < 20000) return false; // wait for a bit more data

  const maxSamples = 120000; // keep computations light
  const stride = Math.max(1, Math.floor(count / maxSamples));

  const { positions } = buffers;
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  xs.length = 0; ys.length = 0; zs.length = 0;
  for (let i = 0; i < count; i += stride) {
    const off = i * 3;
    xs.push(positions[off]);
    ys.push(positions[off + 1]);
    zs.push(positions[off + 2]);
  }

  // XY PCA (2x2) for road axis
  const n = xs.length;
  if (n < 3) return false;
  let mx = 0, my = 0, mz = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; mz += zs[i]; }
  mx /= n; my /= n; mz /= n;

  let Sxx = 0, Syy = 0, Sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    Sxx += dx * dx;
    Syy += dy * dy;
    Sxy += dx * dy;
  }
  // Eigenvector of largest eigenvalue for [[Sxx,Sxy],[Sxy,Syy]]
  const trace = Sxx + Syy;
  const disc = Math.sqrt(Math.max(0, (Sxx - Syy) * (Sxx - Syy) + 4 * Sxy * Sxy));
  const lambda1 = 0.5 * (trace + disc);
  let vx = Sxy;
  let vy = lambda1 - Sxx;
  if (Math.abs(vx) + Math.abs(vy) < 1e-8) { vx = 1; vy = 0; }
  const vLen = Math.hypot(vx, vy);
  vx /= vLen; vy /= vLen;
  const axis = new THREE.Vector3(vx, vy, 0);
  const axisPerp = new THREE.Vector3(-vy, vx, 0);

  // Ground stats and normal via centered least squares z = a x + b y + c
  const zs_q = quantiles(zs, [0.25, 0.5, 0.75, 0.95]);
  const z25 = zs_q[0], z50 = zs_q[1], z75 = zs_q[2], z95 = zs_q[3];
  const groundBand = Math.max(0.2, (z75 - z25));
  let cx = 0, cy = 0, cz = 0, m = 0;
  for (let i = 0; i < n; i++) {
    const z = zs[i];
    if (z >= z50 - groundBand && z <= z50 + groundBand) {
      cx += xs[i]; cy += ys[i]; cz += zs[i]; m += 1;
    }
  }
  if (m === 0) return false;
  cx /= m; cy /= m; cz /= m;
  let Sx2 = 0, Sy2 = 0, Sxy2 = 0, Sxz = 0, Syz = 0;
  for (let i = 0; i < n; i++) {
    const z = zs[i];
    if (z >= z50 - groundBand && z <= z50 + groundBand) {
      const dx = xs[i] - cx;
      const dy = ys[i] - cy;
      const dz = z - cz;
      Sx2 += dx * dx;
      Sy2 += dy * dy;
      Sxy2 += dx * dy;
      Sxz += dx * dz;
      Syz += dy * dz;
    }
  }
  const det = Sx2 * Sy2 - Sxy2 * Sxy2;
  let a = 0, b = 0;
  if (Math.abs(det) > 1e-9) {
    a = (Sxz * Sy2 - Syz * Sxy2) / det;
    b = (Syz * Sx2 - Sxz * Sxy2) / det;
  }
  let up = new THREE.Vector3(-a, -b, 1);
  up.normalize();
  if (up.z < 0) up.multiplyScalar(-1);

  // Road width via IQR in lateral coordinate
  const laterals: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    laterals.push(dx * axisPerp.x + dy * axisPerp.y);
  }
  const lq = quantiles(laterals, [0.25, 0.75]);
  const iqr = Math.abs(lq[1] - lq[0]);
  const roadWidth = Math.max(4, iqr * 2); // fallback минимум 4 м

  // Density-based target along axis (2 x N bins)
  const Nbins = 30;
  const longs: number[] = [];
  const gs: number[] = []; // ground z for target
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    longs.push(dx * axis.x + dy * axis.y);
    gs.push(zs[i]);
  }
  const smin = Math.min(...longs);
  const smax = Math.max(...longs);
  const binSize = (smax - smin) / Math.max(1, Nbins);
  const counts = Array.from({ length: 2 }, () => new Array(Nbins).fill(0));
  for (let i = 0; i < n; i++) {
    const s = longs[i];
    const l = laterals[i];
    const bi = Math.min(Nbins - 1, Math.max(0, Math.floor((s - smin) / Math.max(binSize, 1e-6))));
    const li = l >= 0 ? 1 : 0;
    counts[li][bi]++;
  }
  let bestL = 0, bestB = 0, bestC = -1;
  for (let li = 0; li < 2; li++) {
    for (let bi = 0; bi < Nbins; bi++) {
      const c = counts[li][bi];
      if (c > bestC) { bestC = c; bestL = li; bestB = bi; }
    }
  }
  const sCenter = smin + (bestB + 0.5) * Math.max(binSize, 1e-6);
  const lateralOffset = (bestL === 1 ? 0.2 : -0.2) * roadWidth; // слегка вбок
  const target = new THREE.Vector3(
    mx + axis.x * sCenter + axisPerp.x * 0,
    my + axis.y * sCenter + axisPerp.y * 0,
    z50
  );

  // Elevated objects heuristic
  const elevated = z95 - z50 > 8;

  // Camera position: behind target along -axis, with height by road width
  const baseHeight = THREE.MathUtils.clamp(roadWidth * 1.7, 6, 60);
  const distAlong = elevated ? roadWidth * 3.0 : roadWidth * 2.2;
  const lateralCam = elevated ? 0.5 * roadWidth : 0.0;
  const camPos = new THREE.Vector3()
    .copy(target)
    .addScaledVector(axis, -distAlong)
    .addScaledVector(axisPerp, lateralCam)
    .addScaledVector(up, baseHeight);

  // Apply to camera/controls
  camera.up.copy(up);
  camera.position.copy(camPos);
  controls.target.copy(target);
  // near/far tuning
  const dist = camPos.distanceTo(target);
  camera.near = Math.max(0.05, dist / 500);
  const baseFar = dist * 15;
  (camera as any).userData = (camera as any).userData || {};
  (camera as any).userData.baseFar = baseFar;
  const farMul = (window as any)?.__pcd_tool_options__?.cameraFarMultiplier ?? 1;
  camera.far = baseFar * (Number.isFinite(farMul) && farMul > 0 ? farMul : 1);
  camera.updateProjectionMatrix();
  controls.update();
  poseInitializedRef.current = true;
  if (scheduleRender) scheduleRender();
  return true;
}

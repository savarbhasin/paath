// Builds the whole school: corridor + one classroom per course.
// Everything is procedural (no model files). Collision is data-driven AABBs.
import * as THREE from "three";
import type { CourseInfo, SchoolData } from "./types";
import {
  doorPlaqueTexture,
  floorTexture,
  posterTexture,
  signTexture,
  spineTexture,
  wallTexture,
  whiteboardTexture,
} from "./textures";

export type AABB = { minX: number; maxX: number; minZ: number; maxZ: number };

export type AreaDef = {
  id: string;
  label: string;
  sub: string;
  bounds: AABB;
  obstacles: AABB[];
  spawn: { x: number; z: number; yaw: number };
};

export type InteractableDef =
  | { kind: "enter-course"; areaId: string; x: number; z: number; radius: number; course: CourseInfo }
  | { kind: "exit"; areaId: string; x: number; z: number; radius: number }
  | { kind: "desk"; areaId: string; x: number; z: number; radius: number; course: CourseInfo };

export type WorldBuild = {
  group: THREE.Group;
  areas: Record<string, AreaDef>;
  interactables: InteractableDef[];
  corridorEndZ: number;
};

const WALL_H = 3.4;
const matCache = new Map<string, THREE.Material>();
function mat(color: string, opts?: { emissive?: string; ei?: number; rough?: number }): THREE.MeshStandardMaterial {
  const key = `${color}|${opts?.emissive ?? ""}|${opts?.ei ?? ""}|${opts?.rough ?? ""}`;
  const hit = matCache.get(key);
  if (hit) return hit as THREE.MeshStandardMaterial;
  const m = new THREE.MeshStandardMaterial({
    color,
    roughness: opts?.rough ?? 0.9,
    metalness: 0,
    emissive: opts?.emissive ?? "#000000",
    emissiveIntensity: opts?.ei ?? 1,
  });
  matCache.set(key, m);
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(
  parent: THREE.Object3D,
  w: number, h: number, d: number,
  x: number, y: number, z: number,
  material: THREE.Material,
  castShadow = false,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function plane(
  parent: THREE.Object3D,
  w: number, h: number,
  x: number, y: number, z: number,
  material: THREE.Material,
  ry = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function buildWorld(data: SchoolData): WorldBuild {
  const group = new THREE.Group();
  const areas: Record<string, AreaDef> = {};
  const interactables: InteractableDef[] = [];
  const courses = data.courses.slice(0, 8);

  const floorTex = floorTexture();
  const wallTex = wallTexture();

  /* ---------- shared materials ---------- */
  const ceilMat = mat("#f4f6f5", { rough: 1 });
  const trimMat = mat("#2d6a4f", { rough: 0.7 });
  const lockerMat = mat("#7cb7ff", { rough: 0.6 });
  const lockerMat2 = mat("#ffd166", { rough: 0.6 });
  const woodMat = mat("#8a6a45", { rough: 0.8 });
  const darkWoodMat = mat("#5d4832", { rough: 0.85 });

  /* ---------- lights ---------- */
  group.add(new THREE.HemisphereLight("#eaf2ff", "#3a4a3f", 0.85));
  const sun = new THREE.DirectionalLight("#fff4e0", 0.7);
  sun.position.set(6, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -20; sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.far = 80;
  group.add(sun);
  group.add(new THREE.AmbientLight("#ffffff", 0.25));

  /* ---------- corridor dims ---------- */
  const bayZ = (i: number) => -(10 + i * 8);
  const zEnd = -(10 + Math.max(courses.length - 1, 0) * 8 + 14);
  const zStart = 5;

  /* ---------- corridor shell ---------- */
  const corrLen = zStart - zEnd;
  const corrCz = (zStart + zEnd) / 2;
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 });
  floorTex.repeat.set(3, Math.ceil(corrLen / 2));
  // three r150+: texture.repeat works via .repeat on the shared texture; clone per use
  const cf = new THREE.Mesh(new THREE.PlaneGeometry(6.4, corrLen), floorMat);
  cf.rotation.x = -Math.PI / 2;
  cf.position.set(0, 0, corrCz);
  cf.receiveShadow = true;
  group.add(cf);
  // runner carpet
  box(group, 2.2, 0.04, corrLen - 4, 0, 0.02, corrCz - 1, mat("#2d6a4f", { rough: 1 }));
  box(group, 0.18, 0.045, corrLen - 4, -0.9, 0.02, corrCz - 1, mat("#ffd166", { rough: 1 }));
  box(group, 0.18, 0.045, corrLen - 4, 0.9, 0.02, corrCz - 1, mat("#ffd166", { rough: 1 }));

  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.95 });
  const mkWall = (w: number, h: number, x: number, y: number, z: number, ry: number, repX: number) => {
    const t = wallTex.clone();
    t.needsUpdate = true;
    t.repeat.set(repX, 1);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }),
    );
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    group.add(m);
    void wallMat;
  };
  const reps = Math.ceil(corrLen / 4);
  mkWall(corrLen, WALL_H, -3.2, WALL_H / 2, corrCz, Math.PI / 2, reps);
  mkWall(corrLen, WALL_H, 3.2, WALL_H / 2, corrCz, -Math.PI / 2, reps);
  // ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(6.4, corrLen), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, WALL_H, corrCz);
  group.add(ceil);
  // end walls
  mkWall(6.4, WALL_H, 0, WALL_H / 2, zStart, Math.PI, 2);
  mkWall(6.4, WALL_H, 0, WALL_H / 2, zEnd, 0, 2);
  // ceiling light panels
  const lampMat = mat("#ffffff", { emissive: "#fffbe8", ei: 1.6 });
  for (let z = 2; z > zEnd + 2; z -= 4) {
    box(group, 1.6, 0.08, 0.8, 0, WALL_H - 0.06, z, lampMat);
  }
  const corrLightPositions: number[] = [];
  for (let z = 0; z > zEnd; z -= 16) corrLightPositions.push(z);
  for (const z of corrLightPositions) {
    const pl = new THREE.PointLight("#fff2d9", 22, 20, 1.8);
    pl.position.set(0, 2.9, z);
    group.add(pl);
  }
  // lockers between bays
  courses.forEach((_, i) => {
    const z = bayZ(i) - 4;
    if (z < zEnd + 3) return;
    for (const s of [-1, 1]) {
      const lm = i % 2 === 0 ? lockerMat : lockerMat2;
      box(group, 0.5, 2.0, 2.4, s * 2.9, 1.0, z, lm);
      box(group, 0.06, 1.7, 0.08, s * 2.62, 1.0, z, mat("#3a4554"));
    }
  });
  // windows (daylight glow) opposite-ish gaps
  const winMat = mat("#bfe3ff", { emissive: "#bfe3ff", ei: 0.9 });
  for (let i = 0; i < courses.length; i++) {
    const z = bayZ(i) + 4;
    if (z > 2 || z < zEnd + 3) continue;
    const s = i % 2 === 0 ? 1 : -1;
    box(group, 0.1, 1.2, 1.8, s * 3.14, 2.0, z, winMat);
    box(group, 0.14, 0.1, 1.9, s * 3.14, 2.0, z, trimMat);
  }
  // school sign at far end
  plane(group, 5.2, 1.0, 0, 2.2, zEnd + 0.06, new THREE.MeshBasicMaterial({ map: signTexture(data.workspaceName) }), 0);

  areas["corridor"] = {
    id: "corridor",
    label: "Main Corridor",
    sub: "Pick a classroom",
    bounds: { minX: -2.7, maxX: 2.7, minZ: zEnd + 0.7, maxZ: zStart - 0.7 },
    obstacles: [],
    spawn: { x: 0, z: 1.5, yaw: Math.PI },
  };

  /* ---------- course doors + classrooms ---------- */
  courses.forEach((course, i) => {
    const s = i % 2 === 0 ? -1 : 1; // left, right, left…
    const zc = bayZ(i);

    // door on corridor wall
    const dx = s * 3.18;
    box(group, 0.18, 2.5, 1.7, dx, 1.25, zc, darkWoodMat);
    box(group, 0.1, 2.3, 1.4, dx - s * 0.04, 1.15, zc, mat(course.color, { rough: 0.55 }));
    plane(
      group, 1.9, 0.6, dx - s * 0.12, 2.78, zc,
      new THREE.MeshBasicMaterial({ map: doorPlaqueTexture(course.title, course.color) }),
      s > 0 ? -Math.PI / 2 : Math.PI / 2,
    );
    interactables.push({ kind: "enter-course", areaId: "corridor", x: s * 2.0, z: zc, radius: 1.7, course });

    /* ----- classroom shell ----- */
    const rx0 = s > 0 ? 3.2 : -14.2;
    const rx1 = s > 0 ? 14.2 : -3.2;
    const rz0 = zc - 5.2, rz1 = zc + 5.2;
    const rcx = (rx0 + rx1) / 2;
    const rw = Math.abs(rx1 - rx0), rd = rz1 - rz0;

    const rFloorTex = floorTex.clone();
    rFloorTex.needsUpdate = true;
    rFloorTex.repeat.set(5, 5);
    const rf = new THREE.Mesh(
      new THREE.PlaneGeometry(rw, rd),
      new THREE.MeshStandardMaterial({ map: rFloorTex, roughness: 0.85 }),
    );
    rf.rotation.x = -Math.PI / 2;
    rf.position.set(rcx, 0.001, zc);
    rf.receiveShadow = true;
    group.add(rf);
    const rceil = new THREE.Mesh(new THREE.PlaneGeometry(rw, rd), ceilMat);
    rceil.rotation.x = Math.PI / 2;
    rceil.position.set(rcx, WALL_H, zc);
    group.add(rceil);

    const wt = (w: number, h: number, x: number, y: number, z: number, ry: number, rep: number) => {
      const t = wallTex.clone();
      t.needsUpdate = true;
      t.repeat.set(rep, 1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      group.add(m);
    };
    wt(rw, WALL_H, rcx, WALL_H / 2, rz0, 0, 5); // back
    wt(rw, WALL_H, rcx, WALL_H / 2, rz1, Math.PI, 5); // front
    wt(rd, WALL_H, rx0, WALL_H / 2, zc, Math.PI / 2, 5); // left
    wt(rd, WALL_H, rx1, WALL_H / 2, zc, -Math.PI / 2, 5); // right
    // room lamps + light
    box(group, 1.6, 0.08, 0.8, rcx - 2.4, WALL_H - 0.06, zc, lampMat);
    box(group, 1.6, 0.08, 0.8, rcx + 2.4, WALL_H - 0.06, zc, lampMat);
    const rl = new THREE.PointLight("#fff2d9", 30, 16, 1.8);
    rl.position.set(rcx, 2.9, zc);
    group.add(rl);

    const stats = data.stats[course.id];
    const lines = [
      `${course.notebooks.length} notebook${course.notebooks.length === 1 ? "" : "s"}`,
      stats ? `${stats.attempts} quiz attempts · ${stats.reviews} cards reviewed` : "Progress appears after practice",
      stats ? `${stats.sourcesReady} sources ready` : "Upload material in the app",
      ...(stats?.topics.slice(0, 3).map((t) => `• ${t.label} — ${Math.round(t.score * 100)}%`) ?? []),
    ];
    // whiteboard on far wall
    const bx = s > 0 ? rx1 - 0.08 : rx0 + 0.08;
    plane(group, 4.6, 2.3, bx, 1.9, zc, new THREE.MeshBasicMaterial({ map: whiteboardTexture(course.title, lines) }), s > 0 ? -Math.PI / 2 : Math.PI / 2);
    box(group, 0.12, 0.08, 4.8, bx, 0.68, zc, darkWoodMat); // tray

    // bookshelf on back wall with notebook spines
    const shx = rcx, shz = rz0 + 0.45;
    box(group, 4.6, 2.1, 0.5, shx, 1.05, shz, darkWoodMat, true);
    for (let shelf = 0; shelf < 3; shelf++) {
      box(group, 4.4, 0.06, 0.44, shx, 0.45 + shelf * 0.62, shz, woodMat);
    }
    const books = course.notebooks.slice(0, 9);
    const palette = ["#2d6a4f", "#2f7fe0", "#d9a400", "#d64545", "#7a5fd0", "#0e7c7b"];
    books.forEach((nb, bi) => {
      const shelf = Math.floor(bi / 3);
      const slot = bi % 3;
      const spine = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.52, 0.3),
        new THREE.MeshStandardMaterial({ map: spineTexture(nb.title, palette[bi % palette.length]), roughness: 0.8 }),
      );
      spine.position.set(shx - 1.3 + slot * 1.3, 0.45 + shelf * 0.62 + 0.29, shz);
      spine.castShadow = true;
      group.add(spine);
    });
    if (books.length === 0) {
      plane(group, 2.2, 0.5, shx, 1.2, shz + 0.26, new THREE.MeshBasicMaterial({ map: signTexture("EMPTY SHELF — ADD NOTES IN APP") }), Math.PI);
    }

    // student desks 2x3
    const obstacles: AABB[] = [];
    for (let r = 0; r < 2; r++) {
      for (let cIdx = 0; cIdx < 3; cIdx++) {
        const ddx = rcx - 2.2 + cIdx * 2.2;
        const ddz = zc - 0.6 + r * 2.2;
        box(group, 1.3, 0.1, 0.8, ddx, 0.74, ddz, woodMat, true);
        box(group, 1.2, 0.68, 0.7, ddx, 0.36, ddz, darkWoodMat);
        box(group, 0.55, 0.5, 0.55, ddx, 0.25, ddz + 0.85, mat("#3a4554", { rough: 0.7 }), true); // chair
        obstacles.push({ minX: ddx - 0.75, maxX: ddx + 0.75, minZ: ddz - 0.5, maxZ: ddz + 1.2 });
      }
    }
    // teacher desk near board
    const tdx = s > 0 ? rx1 - 1.6 : rx0 + 1.6;
    box(group, 1.8, 0.12, 0.9, tdx, 0.76, zc + 0.4, woodMat, true);
    box(group, 1.6, 0.7, 0.8, tdx, 0.37, zc + 0.4, darkWoodMat);
    obstacles.push({ minX: Math.min(tdx - 1, tdx + 1), maxX: Math.max(tdx - 1, tdx + 1), minZ: zc - 0.2, maxZ: zc + 1.0 });
    // shelf obstacle
    obstacles.push({ minX: shx - 2.4, maxX: shx + 2.4, minZ: rz0, maxZ: rz0 + 0.9 });

    // posters: topics on side wall
    const posters = stats?.topics.slice(0, 3) ?? [];
    posters.forEach((t, pi) => {
      const px = s > 0 ? rx0 + 0.08 : rx1 - 0.08;
      const pz = zc - 2.4 + pi * 2.4;
      plane(
        group, 1.1, 1.5, px, 1.9, pz,
        new THREE.MeshBasicMaterial({
          map: posterTexture(t.label, [`${Math.round(t.score * 100)}%`, `${t.evidenceCount} tries`], course.color),
        }),
        s > 0 ? Math.PI / 2 : -Math.PI / 2,
      );
    });

    // rug
    box(group, 3.4, 0.03, 2.6, rcx, 0.02, zc + 2.6, mat(course.color, { rough: 1 }));

    // exit door on corridor-side wall
    const ex = s * 3.32;
    box(group, 0.18, 2.5, 1.7, ex, 1.25, zc + 3.4, darkWoodMat);
    box(group, 0.1, 2.3, 1.4, ex - s * 0.04, 1.15, zc + 3.4, mat("#3a4554", { rough: 0.6 }));
    plane(
      group, 1.6, 0.5, ex - s * 0.12, 2.78, zc + 3.4,
      new THREE.MeshBasicMaterial({ map: signTexture("HALLWAY →") }),
      s > 0 ? -Math.PI / 2 : Math.PI / 2,
    );

    const areaId = `room:${course.id}`;
    const pad = 0.45;
    areas[areaId] = {
      id: areaId,
      label: course.title,
      sub: `${course.notebooks.length} notebooks`,
      bounds: {
        minX: Math.min(rx0, rx1) + pad,
        maxX: Math.max(rx0, rx1) - pad,
        minZ: rz0 + pad,
        maxZ: rz1 - pad,
      },
      obstacles,
      spawn: { x: s * 5.0, z: zc + 2.2, yaw: s > 0 ? Math.PI / 2 : -Math.PI / 2 },
    };
    interactables.push({ kind: "exit", areaId, x: s * 4.3, z: zc + 3.4, radius: 1.6 });
    interactables.push({ kind: "desk", areaId, x: rcx, z: zc + 0.6, radius: 2.6, course });
  });

  return { group, areas, interactables, corridorEndZ: zEnd };
}

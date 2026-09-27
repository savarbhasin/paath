// Builds the whole school: corridor + one classroom per course.
// Everything is procedural (no model files). Collision is data-driven AABBs.
import * as THREE from "three";
import type { CourseInfo, SchoolData, Station } from "./types";
import {
  doorPlaqueTexture,
  floorTexture,
  posterTexture,
  signTexture,
  videoWallTexture,
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
  | { kind: "professor"; areaId: string; x: number; z: number; radius: number; course: CourseInfo }
  | { kind: "desk"; areaId: string; x: number; z: number; radius: number; course: CourseInfo; station?: Station };

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

// Lightweight posed characters; seated knees bend toward the desk.
function schoolPerson(parent: THREE.Object3D, x: number, z: number, yaw: number, shirt: string, skin: string, seated = false, teacher = false) {
  const person = new THREE.Group();
  person.position.set(x, 0, z); person.rotation.y = yaw;
  if (teacher) person.scale.setScalar(1.12);
  parent.add(person);
  const clothes = mat(shirt), trousers = mat("#28354b"), face = mat(skin), hair = mat(teacher ? "#46372e" : "#27232d");
  const hip = seated ? 0.55 : 0.78;
  box(person, .5, .57, .3, 0, hip + .29, 0, clothes, true);
  box(person, .34, .36, .32, 0, hip + .8, 0, face, true);
  box(person, .37, .13, .34, 0, hip + 1.01, 0, hair);
  for (const side of [-1, 1]) {
    box(person, .045, .055, .02, side * .08, hip + .81, .17, mat("#17202b"));
    if (seated) {
      box(person, .19, .18, .43, side * .14, hip, .15, trousers);
      box(person, .18, .43, .18, side * .14, hip - .21, .34, trousers);
      box(person, .17, .18, .48, side * .32, hip + .23, .2, clothes);
      box(person, .13, .1, .14, side * .32, hip + .23, .47, face);
    } else {
      box(person, .2, .75, .22, side * .14, .4, 0, trousers);
      box(person, .16, .55, .2, side * .34, hip + .25, 0, clothes);
      box(person, .14, .14, .18, side * .34, hip - .06, 0, face);
    }
    box(person, .21, .1, .3, side * .14, .05, seated ? .38 : .06, mat("#18202d"));
  }
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

  // Chatting pairs tucked against the walls, facing each other — not lining the aisle.
  const chatGroups: Array<{ x: number; z: number; yaw: number; shirt: string; skin: string }> = [
    { x: -1.9, z: 0.6, yaw: Math.PI, shirt: "#bb795e", skin: "#bd8861" },
    { x: -1.9, z: -0.5, yaw: 0, shirt: "#6b80bc", skin: "#e8ba91" },
    { x: 1.9, z: -5.8, yaw: Math.PI, shirt: "#5e9b8c", skin: "#986849" },
    { x: 1.9, z: -6.9, yaw: 0, shirt: "#b69751", skin: "#d4a782" },
  ];
  for (const p of chatGroups) {
    schoolPerson(group, p.x, p.z, p.yaw, p.shirt, p.skin);
    areas.corridor.obstacles.push({ minX: p.x - .35, maxX: p.x + .35, minZ: p.z - .3, maxZ: p.z + .3 });
  }

  /* ---------- course doors + classrooms ---------- */
  courses.forEach((course, i) => {
    const s = i % 2 === 0 ? -1 : 1; // left, right, left…
    const zc = bayZ(i);

    // door on corridor wall
    const dx = s * 3.18;
    box(group, 0.18, 2.5, 1.7, dx, 1.25, zc, darkWoodMat);
    // Keep the panel behind-face beyond the frame front (0.09 + 0.05 + 0.02 gap).
    // Coplanar front faces caused the moving checkerboard flicker.
    box(group, 0.1, 2.3, 1.4, dx - s * 0.16, 1.15, zc, mat(course.color, { rough: 0.55 }));
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
    // Teaching wall faces the rows of seats, consistently in both wings.
    plane(group, 5.6, 2.1, rcx, 1.95, rz0 + 0.08, new THREE.MeshBasicMaterial({ map: whiteboardTexture(course.title, lines) }));
    box(group, 5.8, 0.08, 0.15, rcx, 0.88, rz0 + 0.15, darkWoodMat);

    // Open-backed bookcase with three densely packed rows of decorative books.
    const shx = rcx, shz = rz1 - 0.45;
    box(group, 4.6, 2.2, 0.08, shx, 1.1, shz + .22, darkWoodMat, true);
    for (const edge of [-1, 1]) box(group, .12, 2.2, .6, shx + edge * 2.24, 1.1, shz, darkWoodMat, true);
    const palette = ["#528b74", "#527eb7", "#dda843", "#c4655d", "#8d75b8", "#439b9a", "#dfc7a3"];
    for (let shelf = 0; shelf < 3; shelf++) {
      const base = .15 + shelf * .67;
      box(group, 4.4, .07, .6, shx, base, shz, woodMat);
      for (let book = 0; book < 22; book++) {
        const height = .40 + ((book * 7 + shelf * 3) % 5) * .035;
        const bx = shx - 2.08 + book * .195;
        box(group, .155, height, .38, bx, base + .04 + height / 2, shz - .07, mat(palette[(book + shelf * 3) % palette.length]), true);
        for (const band of [.1, height - .08]) box(group, .13, .018, .012, bx, base + .04 + band, shz - .267, mat("#eedcaa"));
      }
    }

    // student desks 2x3 — every desk is a practice spot
    const obstacles: AABB[] = [];
    const studentDesks: Array<{ x: number; z: number }> = [];
    for (let r = 0; r < 2; r++) {
      for (let cIdx = 0; cIdx < 3; cIdx++) {
        const ddx = rcx - 2.1 + cIdx * 2.1;
        const ddz = zc - 1.8 + r * 2.1;
        box(group, 1.3, 0.1, 0.8, ddx, 0.74, ddz, woodMat, true);
        box(group, 1.2, 0.68, 0.7, ddx, 0.36, ddz, darkWoodMat);
        box(group, 0.55, 0.5, 0.55, ddx, 0.25, ddz + 0.85, mat("#3a4554", { rough: 0.7 }), true); // chair
        if ((r + cIdx) % 3 !== 0) schoolPerson(group, ddx, ddz + .85, Math.PI, ["#d39a52", "#7684ba", "#bd717e"][cIdx], ["#e8ba91", "#a8704d", "#cc956e"][cIdx], true);
        obstacles.push({ minX: ddx - 0.75, maxX: ddx + 0.75, minZ: ddz - 0.5, maxZ: ddz + 1.2 });
        studentDesks.push({ x: ddx, z: ddz });
      }
    }
    // teacher desk near board
    const tdx = rcx;
    box(group, 1.8, 0.12, 0.9, tdx, 0.76, rz0 + 1.2, woodMat, true);
    box(group, 1.6, 0.7, 0.8, tdx, 0.37, rz0 + 1.2, darkWoodMat);
    obstacles.push({ minX: Math.min(tdx - 1, tdx + 1), maxX: Math.max(tdx - 1, tdx + 1), minZ: rz0 + 0.6, maxZ: rz0 + 1.8 });
    schoolPerson(group, rcx + 1.8, rz0 + 1.1, 0, "#526e85", "#c38d67", false, true);
    obstacles.push({ minX: rcx + 1.35, maxX: rcx + 2.25, minZ: rz0 + .65, maxZ: rz0 + 1.55 });
    // shelf obstacle
    obstacles.push({ minX: shx - 2.4, maxX: shx + 2.4, minZ: rz1 - 0.9, maxZ: rz1 });

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
    box(group, 0.1, 2.3, 1.4, ex + s * 0.16, 1.15, zc + 3.4, mat("#3a4554", { rough: 0.6 }));
    plane(
      group, 1.6, 0.5, ex + s * 0.22, 2.78, zc + 3.4,
      new THREE.MeshBasicMaterial({ map: signTexture("HALLWAY →") }),
      s > 0 ? Math.PI / 2 : -Math.PI / 2,
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
      spawn: { x: s * 5.0, z: zc + 3.2, yaw: Math.PI },
    };
    interactables.push({ kind: "exit", areaId, x: s * 4.3, z: zc + 3.4, radius: 1.6 });
    interactables.push({ kind: "desk", areaId, x: shx, z: shz - 1, radius: 1.8, course, station: "notebooks" });
    // Professor chat — stand in front of the teacher to open the course chat.
    interactables.push({ kind: "professor", areaId, x: rcx + 1.8, z: rz0 + 2.1, radius: 1.7, course });
    // Practice at any student desk — stand beside a desk, not the teacher's.
    for (const d of studentDesks) {
      interactables.push({ kind: "desk", areaId, x: d.x, z: d.z, radius: 1.45, course, station: "practice" });
    }
    // Side-wall media station, with a clear walking aisle around the desks.
    const mediaX = s > 0 ? rx1 - 0.25 : rx0 + 0.25;
    plane(group, 3.1, 1.94, mediaX, 1.9, zc + 2.6, new THREE.MeshBasicMaterial({ map: videoWallTexture() }), s > 0 ? -Math.PI / 2 : Math.PI / 2);
    interactables.push({ kind: "desk", areaId, x: mediaX - s * 0.9, z: zc + 2.6, radius: 1.8, course, station: "videos" });
    plane(group, 3, 0.45, shx, 2.55, shz - 0.3, new THREE.MeshBasicMaterial({ map: signTexture("NOTEBOOK LIBRARY") }), Math.PI);
  });

  return { group, areas, interactables, corridorEndZ: zEnd };
}

// Third-person student character + movement controller.
// WASD moves relative to camera yaw, mouse (pointer-lock or drag) orbits.
// Collision: circle vs area bounds + obstacle AABBs.
import * as THREE from "three";
import type { AABB, AreaDef } from "./world";

export class Player {
  group = new THREE.Group();
  pos = new THREE.Vector3();
  yaw = 0; // facing
  camYaw = 0;
  camPitch = -0.32;
  speed = 0;
  private legL!: THREE.Mesh;
  private legR!: THREE.Mesh;
  private armL!: THREE.Mesh;
  private armR!: THREE.Mesh;
  private body!: THREE.Group;
  private walk = 0;

  constructor() {
    const skin = new THREE.MeshStandardMaterial({ color: "#e8b98a", roughness: 0.8 });
    const hoodie = new THREE.MeshStandardMaterial({ color: "#2d6a4f", roughness: 0.85 });
    const pants = new THREE.MeshStandardMaterial({ color: "#2b3542", roughness: 0.9 });
    const pack = new THREE.MeshStandardMaterial({ color: "#d9a400", roughness: 0.8 });
    const shoe = new THREE.MeshStandardMaterial({ color: "#101820", roughness: 0.9 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mk = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, parent = this.group) => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      parent.add(mesh);
      return mesh;
    };
    // legs (pivot at hip: offset geometry via group)
    const legGeo = new THREE.BoxGeometry(0.22, 0.78, 0.24);
    legGeo.translate(0, -0.39, 0);
    this.legL = new THREE.Mesh(legGeo, pants);
    this.legR = new THREE.Mesh(legGeo, pants);
    this.legL.position.set(-0.14, 0.78, 0);
    this.legR.position.set(0.14, 0.78, 0);
    this.legL.castShadow = this.legR.castShadow = true;
    this.group.add(this.legL, this.legR);
    mk(0.16, 0.1, 0.3, shoe, -0.14, 0.05, 0.04);
    mk(0.16, 0.1, 0.3, shoe, 0.14, 0.05, 0.04);
    // torso
    this.body = new THREE.Group();
    this.group.add(this.body);
    mk(0.52, 0.62, 0.32, hoodie, 0, 1.1, 0, this.body);
    mk(0.4, 0.2, 0.34, hoodie, 0, 1.32, 0, this.body); // hood lump
    mk(0.3, 0.42, 0.12, pack, 0, 1.08, -0.22, this.body); // backpack
    // arms
    const armGeo = new THREE.BoxGeometry(0.16, 0.6, 0.18);
    armGeo.translate(0, -0.3, 0);
    this.armL = new THREE.Mesh(armGeo, hoodie);
    this.armR = new THREE.Mesh(armGeo, hoodie);
    this.armL.position.set(-0.35, 1.36, 0);
    this.armR.position.set(0.35, 1.36, 0);
    this.armL.castShadow = this.armR.castShadow = true;
    this.body.add(this.armL, this.armR);
    // head
    mk(0.34, 0.36, 0.32, skin, 0, 1.62, 0, this.body);
    const hair = new THREE.MeshStandardMaterial({ color: "#20242a", roughness: 0.95 });
    mk(0.36, 0.14, 0.34, hair, 0, 1.82, 0, this.body);
    const eye = new THREE.MeshBasicMaterial({ color: "#101820" });
    mk(0.05, 0.07, 0.02, eye, -0.08, 1.63, 0.17, this.body);
    mk(0.05, 0.07, 0.02, eye, 0.08, 1.63, 0.17, this.body);
  }

  place(x: number, z: number, yaw: number) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.camYaw = yaw;
    this.speed = 0;
    this.group.position.copy(this.pos);
    this.group.rotation.y = yaw;
  }

  update(dt: number, moveX: number, moveZ: number, running: boolean) {
    const mag = Math.hypot(moveX, moveZ);
    const target = mag > 0.01 ? (running ? 5.2 : 3.1) : 0;
    this.speed += (target - this.speed) * Math.min(1, dt * 8);
    if (mag > 0.01) {
      // camera-relative move dir
      const s = Math.sin(this.camYaw), c = Math.cos(this.camYaw);
      const wx = (-moveX * c + moveZ * s) / (mag || 1);
      const wz = (moveX * s + moveZ * c) / (mag || 1);
      this.pos.x += wx * this.speed * dt;
      this.pos.z += wz * this.speed * dt;
      const want = Math.atan2(wx, wz);
      let d = want - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * Math.min(1, dt * 10);
    }
    this.walk += dt * (2 + this.speed * 2.2);
    const sw = Math.sin(this.walk) * Math.min(1, this.speed / 3) * 0.55;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.8;
    this.armR.rotation.x = sw * 0.8;
    this.body.position.y = Math.abs(Math.sin(this.walk)) * 0.05 * Math.min(1, this.speed / 3);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
  }
}

export function collideCircle(
  pos: THREE.Vector3,
  radius: number,
  bounds: AABB,
  obstacles: AABB[],
): void {
  pos.x = Math.max(bounds.minX + radius, Math.min(bounds.maxX - radius, pos.x));
  pos.z = Math.max(bounds.minZ + radius, Math.min(bounds.maxZ - radius, pos.z));
  for (const o of obstacles) {
    const cx = Math.max(o.minX, Math.min(o.maxX, pos.x));
    const cz = Math.max(o.minZ, Math.min(o.maxZ, pos.z));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      pos.x = cx + (dx / d) * radius;
      pos.z = cz + (dz / d) * radius;
    } else {
      // center inside box: push along min-penetration axis
      const pl = pos.x - o.minX, pr = o.maxX - pos.x;
      const pn = pos.z - o.minZ, pf = o.maxZ - pos.z;
      const m = Math.min(pl, pr, pn, pf);
      if (m === pl) pos.x = o.minX - radius;
      else if (m === pr) pos.x = o.maxX + radius;
      else if (m === pn) pos.z = o.minZ - radius;
      else pos.z = o.maxZ + radius;
    }
  }
}

export function updateCamera(
  cam: THREE.PerspectiveCamera,
  player: Player,
  area: AreaDef,
  dt: number,
  out: THREE.Vector3,
): void {
  const dist = 4.4, height = 2.3;
  const behind = player.camYaw + Math.PI;
  const dirX = Math.sin(behind) * Math.cos(player.camPitch);
  const dirZ = Math.cos(behind) * Math.cos(player.camPitch);
  const dirY = Math.sin(-player.camPitch);
  // shrink the boom until the camera fits inside the room (AABB march)
  const hx = player.pos.x, hz = player.pos.z;
  const inX = 0.3, topY = 3.15, botY = 0.55;
  let t = 1;
  for (; t > 0.18; t -= 0.04) {
    const px = hx + dirX * dist * t;
    const py = height * t + dirY * dist * t * 0.5 + (1 - t) * 0.4;
    const pz = hz + dirZ * dist * t;
    if (
      px < area.bounds.minX + inX || px > area.bounds.maxX - inX ||
      pz < area.bounds.minZ + inX || pz > area.bounds.maxZ - inX ||
      py < botY || py > topY
    ) continue;
    break;
  }
  t = Math.max(t, 0.18);
  const tx = hx + dirX * dist * t;
  const tz = hz + dirZ * dist * t;
  const ty = Math.max(botY, Math.min(topY, height * t + dirY * dist * t * 0.5 + (1 - t) * 0.4));
  const k = Math.min(1, dt * 10);
  out.x += (tx - out.x) * k;
  out.y += (ty - out.y) * k;
  out.z += (tz - out.z) * k;
  // keep camera inside the room
  out.x = Math.max(area.bounds.minX + 0.25, Math.min(area.bounds.maxX - 0.25, out.x));
  out.z = Math.max(area.bounds.minZ + 0.25, Math.min(area.bounds.maxZ - 0.25, out.z));
  out.y = Math.max(0.6, Math.min(3.1, out.y));
  cam.position.copy(out);
  cam.lookAt(player.pos.x, 1.5, player.pos.z);
}

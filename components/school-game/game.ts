// Game orchestrator: renderer, loop, input, areas, interactions, transitions.
// Read-only: it never writes to any API. Links out to real app routes.
import * as THREE from "three";
import type { ClassroomPanel, CourseInfo, SchoolData } from "./types";
import { buildWorld, type InteractableDef } from "./world";
import { Player, collideCircle, updateCamera } from "./player";

export type GameCallbacks = {
  onPrompt: (label: string | null, kind: "door" | "desk" | "exit" | "professor") => void;
  onArea: (title: string, sub: string) => void;
  onPanel: (panel: ClassroomPanel | null) => void;
  onLock: (locked: boolean) => void;
  onReady: (courseCount: number, offline: boolean) => void;
};

const FADE_MS = 260;

export class SchoolGame {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private player = new Player();
  private camPos = new THREE.Vector3(0, 3, 6);
  private keys = new Set<string>();
  private areaId = "corridor";
  private hallwayReturn: { x: number; z: number; yaw: number } | null = null;
  private areas!: ReturnType<typeof buildWorld>["areas"];
  private interactables: InteractableDef[] = [];
  private active: InteractableDef | null = null;
  private raf = 0;
  private lastTs = 0;
  private disposed = false;
  private dragging = false;
  private lastPX = 0;
  private lastPY = 0;
  private fadeEl: HTMLDivElement;
  private panelOpen = false;
  private coursesById = new Map<string, CourseInfo>();
  private data: SchoolData;
  private cb: GameCallbacks;
  private canvas: HTMLCanvasElement;
  // touch
  private stickId: number | null = null;
  private stickOX = 0;
  private stickOY = 0;
  private stickDX = 0;
  private stickDY = 0;
  private lookId: number | null = null;
  private lookLX = 0;
  private lookLY = 0;

  constructor(canvas: HTMLCanvasElement, data: SchoolData, cb: GameCallbacks) {
    this.canvas = canvas;
    this.data = data;
    this.cb = cb;
    for (const c of data.courses) this.coursesById.set(c.id, c);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 220);
    this.scene.background = new THREE.Color("#0b1622");
    this.scene.fog = new THREE.Fog("#0b1622", 18, 70);

    const built = buildWorld(data);
    this.scene.add(built.group);
    this.areas = built.areas;
    this.interactables = built.interactables;
    this.scene.add(this.player.group);
    this.enterArea("corridor", false);

    // fade overlay
    this.fadeEl = document.createElement("div");
    this.fadeEl.style.cssText =
      "position:absolute;inset:0;background:#05090d;opacity:0;pointer-events:none;transition:opacity 260ms ease;z-index:5";
    canvas.parentElement?.appendChild(this.fadeEl);

    this.resize();
    this.bind();
    cb.onReady(data.courses.length, data.offline);
    this.lastTs = performance.now();
    const loop = (ts: number) => {
      if (this.disposed) return;
      let dt = (ts - this.lastTs) / 1000;
      this.lastTs = ts;
      if (!(dt > 0) || dt > 0.05) dt = 0.016;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /* ---------------- input ---------------- */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && (e.target.closest("input, textarea, button, a") || e.target.isContentEditable)) return;
    const k = e.key.toLowerCase();
    if (this.panelOpen) { if (k === "escape") this.cb.onPanel(null); return; }
    if (e.repeat && k === "e") return;
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if (k === "e") {
      if (this.panelOpen) this.cb.onPanel(null);
      else this.interact();
      return;
    }
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key.toLowerCase());
  };
  private onMouseMove = (e: MouseEvent) => {
    if (document.pointerLockElement === this.canvas) {
      this.player.camYaw -= e.movementX * 0.0024;
      this.player.camPitch = Math.max(-1.1, Math.min(0.25, this.player.camPitch - e.movementY * 0.0022));
    } else if (this.dragging) {
      this.player.camYaw -= (e.clientX - this.lastPX) * 0.005;
      this.player.camPitch = Math.max(-1.1, Math.min(0.25, this.player.camPitch - (e.clientY - this.lastPY) * 0.004));
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
    }
  };
  private onMouseDown = (e: MouseEvent) => {
    if (e.button !== 0 || e.target !== this.canvas || this.panelOpen) return;
    if (document.pointerLockElement !== this.canvas) {
      this.dragging = true;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
    }
  };
  private onMouseUp = () => {
    this.dragging = false;
  };
  private onLockChange = () => {
    this.cb.onLock(document.pointerLockElement === this.canvas);
  };
  private onTouchStart = (e: TouchEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    for (const t of Array.from(e.changedTouches)) {
      const x = t.clientX - rect.left;
      if (x < rect.width * 0.45 && this.stickId === null) {
        this.stickId = t.identifier;
        this.stickOX = t.clientX; this.stickOY = t.clientY;
        this.stickDX = 0; this.stickDY = 0;
      } else if (this.lookId === null) {
        this.lookId = t.identifier;
        this.lookLX = t.clientX; this.lookLY = t.clientY;
      }
    }
  };
  private onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) {
        this.stickDX = Math.max(-60, Math.min(60, t.clientX - this.stickOX));
        this.stickDY = Math.max(-60, Math.min(60, t.clientY - this.stickOY));
      } else if (t.identifier === this.lookId) {
        this.player.camYaw -= (t.clientX - this.lookLX) * 0.006;
        this.player.camPitch = Math.max(-1.1, Math.min(0.25, this.player.camPitch - (t.clientY - this.lookLY) * 0.005));
        this.lookLX = t.clientX; this.lookLY = t.clientY;
      }
    }
  };
  private onTouchEnd = (e: TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (t.identifier === this.stickId) { this.stickId = null; this.stickDX = 0; this.stickDY = 0; }
      if (t.identifier === this.lookId) this.lookId = null;
    }
  };

  private boundResize = () => this.resize();

  private bind() {
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("mousemove", this.onMouseMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    window.addEventListener("resize", this.boundResize);
    this.canvas.addEventListener("touchstart", this.onTouchStart, { passive: true });
    this.canvas.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.canvas.addEventListener("touchend", this.onTouchEnd);
    this.canvas.addEventListener("touchcancel", this.onTouchEnd);
  }

  openClassroom() {
    const course = this.coursesById.get(this.areaId.replace("room:", ""));
    if (course) this.cb.onPanel({ course, stats: this.data.stats[course.id] ?? null, station: "notebooks" });
  }

  private onBlur = () => { this.keys.clear(); this.dragging = false; };

  captureMouse() {
    if (document.pointerLockElement !== this.canvas) {
      try {
        const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
        p?.catch?.(() => undefined);
      } catch { /* drag-look fallback stays available */ }
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- areas & interaction ---------------- */
  private enterArea(areaId: string, fade: boolean) {
    const apply = () => {
      this.areaId = areaId;
      const area = this.areas[areaId];
      const spawn = areaId === "corridor" && this.hallwayReturn ? this.hallwayReturn : area.spawn;
      this.player.place(spawn.x, spawn.z, spawn.yaw);
      this.camPos.set(
        spawn.x - Math.sin(spawn.yaw) * 4,
        2.4,
        spawn.z - Math.cos(spawn.yaw) * 4,
      );
      this.active = null;
      this.cb.onPrompt(null, "door");
      this.cb.onArea(area.label, area.sub);
      this.cb.onPanel(null);
    };
    if (!fade) {
      apply();
      return;
    }
    this.fadeEl.style.opacity = "1";
    setTimeout(() => {
      if (this.disposed) return;
      apply();
      this.fadeEl.style.opacity = "0";
    }, FADE_MS);
  }

  interact() {
    if (!this.active || this.panelOpen) return;
    const it = this.active;
    if (it.kind === "enter-course") {
      this.hallwayReturn = { x: it.x, z: it.z, yaw: it.x < 0 ? Math.PI / 2 : -Math.PI / 2 };
      this.enterArea(`room:${it.course.id}`, true);
    } else if (it.kind === "exit") {
      this.enterArea("corridor", true);
    } else if (it.kind === "professor") {
      window.open(`/courses/${it.course.id}`, "_blank", "noopener");
    } else if (it.kind === "desk") {
      this.cb.onPanel({ course: it.course, stats: this.data.stats[it.course.id] ?? null, station: it.station });
    }
  }

  setPanelOpen(open: boolean) {
    this.panelOpen = open;
    this.keys.clear();
    this.dragging = false;
    this.stickId = this.lookId = null;
    this.stickDX = this.stickDY = 0;
    if (open && document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private promptFor(it: InteractableDef): { label: string; kind: "door" | "desk" | "exit" | "professor" } {
    if (it.kind === "enter-course") return { label: `Enter ${it.course.title}`, kind: "door" };
    if (it.kind === "exit") return { label: "Back to hallway", kind: "exit" };
    if (it.kind === "professor") return { label: "Talk to professor", kind: "professor" };
    if (it.station === "practice") return { label: "Practice", kind: "desk" };
    return { label: `Open ${it.station === "videos" ? "media lounge" : "notebook library"}`, kind: "desk" };
  }

  private tick(dt: number) {
    // input vector
    let mx = 0, mz = 0;
    if (this.keys.has("w") || this.keys.has("arrowup")) mz += 1;
    if (this.keys.has("s") || this.keys.has("arrowdown")) mz -= 1;
    if (this.keys.has("a") || this.keys.has("arrowleft")) mx -= 1;
    if (this.keys.has("d") || this.keys.has("arrowright")) mx += 1;
    if (this.stickId !== null) {
      mx += this.stickDX / 60;
      mz += -this.stickDY / 60;
    }
    const running = this.keys.has("shift");
    if (!this.panelOpen) {
      this.player.update(dt, mx, mz, running);
      const area = this.areas[this.areaId];
      collideCircle(this.player.pos, 0.35, area.bounds, area.obstacles);
      this.player.group.position.copy(this.player.pos);
    }
    const area = this.areas[this.areaId];
    updateCamera(this.camera, this.player, area, dt, this.camPos);

    // nearest interactable
    let best: InteractableDef | null = null;
    let bestD = Infinity;
    for (const it of this.interactables) {
      if (it.areaId !== this.areaId) continue;
      const d = Math.hypot(it.x - this.player.pos.x, it.z - this.player.pos.z);
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    if (best !== this.active) {
      this.active = best;
      if (!best) this.cb.onPrompt(null, "door");
      else {
        const p = this.promptFor(best);
        this.cb.onPrompt(p.label, p.kind);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  snapshot() {
    return {
      area: this.areaId,
      x: Math.round(this.player.pos.x * 100) / 100,
      z: Math.round(this.player.pos.z * 100) / 100,
      yaw: Math.round(this.player.camYaw * 100) / 100,
      prompt: this.active ? this.promptFor(this.active).label : null,
      areas: Object.keys(this.areas).length,
      interactables: this.interactables.length,
    };
  }

  /** Test hook: advance the sim manually (headless tabs throttle rAF). */
  debugStep(frames: number) {
    for (let i = 0; i < frames; i++) this.tick(1 / 60);
  }
  /** Test hook: JPEG snapshot of the 3D view (same-task readback). */
  debugShot(maxW = 480): string | null {
    try {
      this.tick(0.016);
      const src = this.renderer.domElement;
      const scale = Math.min(1, maxW / src.width);
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(src.width * scale));
      c.height = Math.max(1, Math.round(src.height * scale));
      const ctx = c.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.72);
    } catch {
      return null;
    }
  }
  /** Test hook: teleport without fade (headless can't do pointer lock). */
  debugTeleport(areaId: string) {
    if (this.areas[areaId]) this.enterArea(areaId, false);
  }
  debugLook(yaw: number, pitch: number) {
    this.player.camYaw = yaw;
    this.player.camPitch = pitch;
  }
  debugKey(key: string, down: boolean) {
    if (down) this.keys.add(key);
    else this.keys.delete(key);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("mousemove", this.onMouseMove);
    window.removeEventListener("mousedown", this.onMouseDown);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    window.removeEventListener("resize", this.boundResize);
    this.canvas.removeEventListener("touchstart", this.onTouchStart);
    this.canvas.removeEventListener("touchmove", this.onTouchMove);
    this.canvas.removeEventListener("touchend", this.onTouchEnd);
    this.canvas.removeEventListener("touchcancel", this.onTouchEnd);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.fadeEl.remove();
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((mm) => {
          const sm = mm as THREE.MeshStandardMaterial;
          sm.map?.dispose();
          mm.dispose();
        });
      }
    });
    this.renderer.dispose();
  }
}

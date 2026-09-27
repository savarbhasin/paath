// Runtime canvas textures — the whole school is textured with zero asset files.
import * as THREE from "three";

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d context unavailable");
  return [c, ctx];
}

function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function floorTexture(): THREE.CanvasTexture {
  const [c, x] = makeCanvas(256, 256);
  x.fillStyle = "#cfd4d6";
  x.fillRect(0, 0, 256, 256);
  x.strokeStyle = "#aeb6ba";
  x.lineWidth = 3;
  for (let i = 0; i <= 256; i += 64) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke();
  }
  x.fillStyle = "rgba(255,255,255,.06)";
  x.fillRect(0, 0, 256, 128);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function wallTexture(): THREE.CanvasTexture {
  const [c, x] = makeCanvas(256, 256);
  x.fillStyle = "#ece7db";
  x.fillRect(0, 0, 256, 256);
  x.fillStyle = "#2d6a4f";
  x.fillRect(0, 150, 256, 34); // brand chair-rail stripe
  x.fillStyle = "#d8d2c2";
  x.fillRect(0, 184, 256, 72);
  x.fillStyle = "rgba(0,0,0,.05)";
  for (let i = 0; i < 256; i += 32) x.fillRect(i, 0, 2, 150);
  const t = toTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function doorPlaqueTexture(title: string, color: string): THREE.CanvasTexture {
  const [c, x] = makeCanvas(512, 160);
  x.fillStyle = "#101820";
  x.fillRect(0, 0, 512, 160);
  x.fillStyle = color;
  x.fillRect(0, 0, 18, 160);
  x.fillStyle = "#ffffff";
  x.font = "600 52px 'Space Grotesk', sans-serif";
  x.textBaseline = "middle";
  const short = title.length > 18 ? title.slice(0, 17) + "…" : title;
  x.fillText(short, 44, 66);
  x.fillStyle = "#7bc79a";
  x.font = "500 26px 'DM Mono', monospace";
  x.fillText("CLASSROOM · PRESS E", 44, 122);
  return toTexture(c);
}

export function whiteboardTexture(title: string, lines: string[]): THREE.CanvasTexture {
  const [c, x] = makeCanvas(1024, 512);
  x.fillStyle = "#f7faf8";
  x.fillRect(0, 0, 1024, 512);
  x.fillStyle = "#2d6a4f";
  x.font = "600 64px 'Space Grotesk', sans-serif";
  x.fillText(title.length > 26 ? title.slice(0, 25) + "…" : title, 48, 96);
  x.strokeStyle = "#c5dbf2";
  x.lineWidth = 3;
  x.beginPath(); x.moveTo(48, 130); x.lineTo(976, 130); x.stroke();
  x.font = "400 34px 'DM Sans', sans-serif";
  x.fillStyle = "#33413a";
  lines.slice(0, 8).forEach((l, i) => x.fillText(l, 48, 190 + i * 40));
  return toTexture(c);
}

export function spineTexture(title: string, color: string): THREE.CanvasTexture {
  const [c, x] = makeCanvas(96, 256);
  x.fillStyle = color;
  x.fillRect(0, 0, 96, 256);
  x.fillStyle = "rgba(255,255,255,.85)";
  x.fillRect(8, 14, 80, 4);
  x.fillRect(8, 238, 80, 4);
  x.save();
  x.translate(48, 128);
  x.rotate(-Math.PI / 2);
  x.fillStyle = "#ffffff";
  x.font = "600 26px 'DM Sans', sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  const short = title.length > 20 ? title.slice(0, 19) + "…" : title;
  x.fillText(short, 0, 0);
  x.restore();
  return toTexture(c);
}

export function posterTexture(heading: string, rows: string[], color: string): THREE.CanvasTexture {
  const [c, x] = makeCanvas(384, 512);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 384, 512);
  x.fillStyle = color;
  x.fillRect(0, 0, 384, 110);
  x.fillStyle = "#ffffff";
  x.font = "600 40px 'Space Grotesk', sans-serif";
  x.fillText(heading.slice(0, 12), 24, 68);
  x.fillStyle = "#33413a";
  x.font = "400 26px 'DM Sans', sans-serif";
  rows.slice(0, 10).forEach((r, i) => x.fillText(r.slice(0, 24), 24, 160 + i * 34));
  x.strokeStyle = color;
  x.lineWidth = 10;
  x.strokeRect(5, 5, 374, 502);
  return toTexture(c);
}

export function signTexture(text: string): THREE.CanvasTexture {
  const [c, x] = makeCanvas(1024, 192);
  x.fillStyle = "#101820";
  x.fillRect(0, 0, 1024, 192);
  x.fillStyle = "#2d6a4f";
  x.fillRect(0, 0, 1024, 14);
  x.fillRect(0, 178, 1024, 14);
  x.fillStyle = "#ffd166";
  x.font = "600 84px 'Space Grotesk', sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text.length > 24 ? text.slice(0, 23) + "…" : text.toUpperCase(), 512, 100);
  return toTexture(c);
}

// Decorative lesson covers, independent of the user's actual video collection.
export function videoWallTexture(): THREE.CanvasTexture {
  const [c, x] = makeCanvas(1024, 640);
  x.fillStyle = "#101827";
  x.fillRect(0, 0, 1024, 640);
  x.fillStyle = "#e8edff";
  x.font = "600 42px sans-serif";
  x.fillText("VIDEOS & LESSONS", 36, 62);
  const titles = ["Explore the cosmos", "The world of geometry", "Inside a living cell", "Waves & sound"];
  const colors = ["#5551b8", "#137c87", "#24815b", "#bd624b"];
  titles.forEach((title, i) => {
    const ox = 36 + (i % 2) * 488, oy = 96 + Math.floor(i / 2) * 260;
    x.save(); x.translate(ox, oy);
    const g = x.createLinearGradient(0, 0, 450, 200);
    g.addColorStop(0, colors[i]); g.addColorStop(1, "#172337");
    x.fillStyle = g; x.fillRect(0, 0, 464, 200);
    x.strokeStyle = "#ffffff80"; x.lineWidth = 4;
    if (i === 0) {
      x.fillStyle = "#f5c680"; x.beginPath(); x.arc(232, 92, 48, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(232, 92, 110, 24, -.3, 0, Math.PI * 2); x.stroke();
      for (let j = 0; j < 22; j++) { x.fillStyle = "#ffffffaa"; x.fillRect((j * 79 + 13) % 450, (j * 37 + 7) % 190, 3, 3); }
    } else if (i === 1) {
      x.beginPath(); x.moveTo(100, 160); x.lineTo(230, 30); x.lineTo(350, 160); x.closePath(); x.stroke();
      x.strokeRect(190, 70, 100, 100);
    } else if (i === 2) {
      x.fillStyle = "#86d8a9"; x.beginPath(); x.ellipse(232, 100, 125, 72, -.15, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#b27ecd"; x.beginPath(); x.arc(230, 90, 32, 0, Math.PI * 2); x.fill();
      x.fillStyle = "#318c6b"; for (let j = 0; j < 6; j++) { x.beginPath(); x.arc(155 + j * 30, 125 + Math.sin(j) * 18, 9, 0, Math.PI * 2); x.fill(); }
    } else {
      x.beginPath(); for (let j = 20; j < 440; j++) { const y = 100 + Math.sin(j / 24) * 55; if (j === 20) x.moveTo(j, y); else x.lineTo(j, y); } x.stroke();
    }
    x.fillStyle = "#00000060"; x.beginPath(); x.arc(420, 166, 20, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#ffffff"; x.beginPath(); x.moveTo(414, 156); x.lineTo(430, 166); x.lineTo(414, 176); x.closePath(); x.fill();
    x.font = "500 24px sans-serif"; x.fillText(title, 0, 232);
    x.restore();
  });
  return toTexture(c);
}

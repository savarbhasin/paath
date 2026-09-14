// Trusted image entrypoint. Generated code runs only in the container browser.
import { spawnSync } from 'node:child_process';
import { copyFileSync, renameSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [action, file] = process.argv.slice(2);
process.env.HYPERFRAMES_BROWSER_PATH = chromium.executablePath().replace(/chrome-linux(?:64)?\/chrome$/, 'chrome-headless-shell-linux64/chrome-headless-shell');
// Playwright's executablePath() points at full Chromium; resolve the separately
// installed headless-shell path using its pinned browsers manifest on each arch.
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const root = '/opt/browsers';
for (const entry of readdirSync(root).filter((name) => name.startsWith('chromium_headless_shell-'))) {
  for (const folder of ['chrome-linux', 'chrome-linux64', 'chrome-headless-shell-linux64']) {
    const candidate = join(root, entry, folder, 'headless_shell');
    const alternative = join(root, entry, folder, 'chrome-headless-shell');
    if (existsSync(candidate)) process.env.HYPERFRAMES_BROWSER_PATH = candidate;
    else if (existsSync(alternative)) process.env.HYPERFRAMES_BROWSER_PATH = alternative;
  }
}
if (!existsSync(process.env.HYPERFRAMES_BROWSER_PATH)) throw new Error('Pinned headless shell is missing');
process.env.PRODUCER_HEADLESS_SHELL_PATH = process.env.HYPERFRAMES_BROWSER_PATH;
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: '/project', env: process.env, timeout: action === 'render' ? 30 * 60000 : 5 * 60000, killSignal: 'SIGKILL' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
if (action === 'prepare') {
  copyFileSync('/opt/renderer/node_modules/gsap/dist/gsap.min.js', '/project/gsap.min.js');
} else if (action === 'check') {
  run('/opt/renderer/node_modules/.bin/hyperframes', ['check']);
} else if (action === 'render') {
  run('/opt/renderer/node_modules/.bin/hyperframes', ['render', '--quality', 'high', '--fps', '24', '--workers', '1', '--output', 'video.mp4']);
} else if (action === 'probe' && /^(scene-\d+\.mp3|video\.mp4)$/.test(file ?? '')) {
  run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]);
} else if (action === 'padsilence' && /^scene-\d+\.mp3\|\d+(\.\d+)?$/.test(file ?? '')) {
  // Append teacher-pause silence to a narration file: "scene-0.mp3|1.5".
  const [name, secs] = file.split('|');
  run('ffmpeg', ['-v', 'error', '-y', '-i', name, '-af', `apad=pad_dur=${secs}`, `${name}.padded.mp3`]);
  renameSync(`/project/${name}.padded.mp3`, `/project/${name}`);
} else if (action === 'verify') {
  run('ffmpeg', ['-v', 'error', '-xerror', '-i', 'video.mp4', '-f', 'null', '-']);
} else {
  throw new Error('Unknown renderer action');
}

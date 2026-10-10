#!/usr/bin/env node
/**
 * take-photo.mjs —— 调摄像头拍一张照并发送到钉钉
 *
 * 命令行：
 *   node take-photo.mjs [--caption "附言"] [--seconds 1] [--device "HD Camera"]
 *   node take-photo.mjs --list-cameras
 *
 * 作为模块：
 *   import { takePhoto, listCameras } from './take-photo.mjs'
 *   await takePhoto({ caption: '说明' })
 *
 * 环境变量：DSH_FFMPEG（ffmpeg 路径）、DSH_CAMERA（设备名）
 *
 * ── 为什么要连拍再取最后一帧 ──────────────────────────────────
 * 网络摄像头开机头几帧自动曝光还没完成，直接取第一帧会明显偏暗发灰。
 * 默认拍 1 秒（约 30 帧）取最后一帧。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sendImage } from './notify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_KEEP_DIR = path.join(HERE, '..', 'captures');

/** 列出可用摄像头（排查设备名用） */
export function listCameras(ffmpegPath) {
  const ff = ffmpegPath || process.env.DSH_FFMPEG || 'ffmpeg';
  const r = spawnSync(ff, ['-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy'],
    { encoding: 'utf8' });
  return (r.stderr || '').split('\n').filter((l) => /\(video\)/.test(l)).map((l) => l.trim());
}

/**
 * 拍照并发送到钉钉。
 * @returns {Promise<{path:string, mediaId:string, frames:number, bytes:number}>}
 */
export async function takePhoto(opts = {}) {
  const caption = opts.caption !== undefined ? opts.caption : '📷 电脑摄像头拍摄';
  const seconds = Number(opts.seconds || 1);
  const device = opts.device || process.env.DSH_CAMERA || 'HD Camera';
  const ffmpeg = opts.ffmpeg || process.env.DSH_FFMPEG || 'ffmpeg';
  const keepDir = opts.keepDir || DEFAULT_KEEP_DIR;
  const log = opts.log || (() => {});

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dingtalk-photo-'));
  log(`拍摄中（${seconds} 秒，取最后一帧）…`);
  const r = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-rtbufsize', '100M',
    '-i', `video=${device}`,
    '-t', String(seconds),
    '-q:v', '2', '-y',
    path.join(tmp, 'f_%03d.jpg'),
  ], { encoding: 'utf8' });

  if (r.error) {
    throw new Error(`无法运行 ffmpeg：${r.error.message}\n请安装 ffmpeg，或用 DSH_FFMPEG 指定路径。`);
  }
  if (r.status !== 0) {
    throw new Error(`ffmpeg 抓帧失败（退出码 ${r.status}）：${(r.stderr || '').slice(0, 400)}\n` +
      `设备名可能不对，可用 --list-cameras 查看。`);
  }

  const frames = fs.readdirSync(tmp).filter((f) => f.endsWith('.jpg')).sort();
  if (!frames.length) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw new Error('没有抓到任何帧（摄像头可能被其它程序占用，或被隐私设置阻止）');
  }
  const last = path.join(tmp, frames[frames.length - 1]);
  log(`抓到 ${frames.length} 帧，采用最后一帧`);

  fs.mkdirSync(keepDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const keep = path.join(keepDir, `photo-${stamp}.jpg`);
  fs.copyFileSync(last, keep);
  fs.copyFileSync(last, path.join(keepDir, 'photo.jpg'));
  fs.rmSync(tmp, { recursive: true, force: true });
  const bytes = fs.statSync(keep).size;
  log(`已保存：${keep} (${(bytes / 1024).toFixed(1)} KB)`);

  log('上传并发送到钉钉…');
  const res = await sendImage(keep, caption, opts.config);
  return { path: keep, mediaId: res.mediaId, frames: frames.length, bytes };
}

// ── CLI ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };

  if (process.argv.includes('--list-cameras')) {
    const cams = listCameras();
    console.log(cams.length ? cams.join('\n') : '（没找到摄像头，或 ffmpeg 不可用）');
    process.exit(cams.length ? 0 : 1);
  }

  try {
    const out = await takePhoto({
      caption: arg('--caption') || undefined,
      seconds: arg('--seconds') || undefined,
      device: arg('--device') || undefined,
      log: (m) => console.log(m),
    });
    console.log('✅ 已发送  media_id =', out.mediaId);
  } catch (e) {
    console.error('❌', e.message);
    process.exit(4);
  }
}

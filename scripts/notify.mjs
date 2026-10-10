#!/usr/bin/env node
/**
 * notify.mjs —— 通用钉钉发送器（文本 / Markdown / 图片）
 *
 * 用法：
 *   node notify.mjs text     "内容"
 *   node notify.mjs markdown "标题" "正文"
 *   node notify.mjs image    <图片路径> [--caption "附言"]
 *
 * 也可被其它脚本 import：
 *   import { sendText, sendImage } from './notify.mjs'
 *
 * ── 关键实现说明 ──────────────────────────────────────────────
 * 发送图片走机器人接口 /v1.0/robot/oToMessages/batchSend。
 * 该接口的 sampleImageMsg 消息，其 `photoURL` 字段**可以直接填**
 * media/upload 返回的 media_id —— 因此发图**不需要图床、不需要
 * 内网穿透、不需要公网地址**，图片只经过钉钉。
 *
 * 注意：本应用类型没有「发送工作通知」权限，
 * topapi/message/corpconversation/asyncsend_v2 会返回 errcode 41，
 * 所以媒体消息必须走机器人接口。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * 配置解析顺序（先找到先用）：
 *   1. 环境变量 DSH_DINGTALK_CONFIG 指向的文件
 *   2. <仓库根>/config.json
 *   3. <脚本目录>/config.json
 *   4. ~/.dsh/dingtalk-photo.json      ← 推荐，密钥不进仓库
 */
export function resolveConfigPath() {
  const candidates = [
    process.env.DSH_DINGTALK_CONFIG,
    path.join(HERE, '..', 'config.json'),
    path.join(HERE, 'config.json'),
    path.join(os.homedir(), '.dsh', 'dingtalk-photo.json'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return path.resolve(p);
  }
  throw new Error(
    '找不到配置文件。请任选一种：\n' +
    '  1) 设置环境变量 DSH_DINGTALK_CONFIG 指向你的配置文件\n' +
    '  2) 在仓库根目录放 config.json（已在 .gitignore 中，不会误提交）\n' +
    '  3) 放一份到 ~/.dsh/dingtalk-photo.json（推荐）\n' +
    '配置字段见 config.example.json');
}

export function loadConfig() {
  return JSON.parse(fs.readFileSync(resolveConfigPath(), 'utf8'));
}

async function getToken(cfg) {
  const r = await fetch('https://oapi.dingtalk.com/gettoken' +
    '?appkey=' + encodeURIComponent(cfg.clientId) +
    '&appsecret=' + encodeURIComponent(cfg.clientSecret));
  const j = await r.json();
  if (j.errcode !== 0) throw new Error('取 access_token 失败: ' + JSON.stringify(j));
  return j.access_token;
}

function targets(cfg) {
  const list = (cfg.allowedSenders || []).filter(Boolean);
  if (!list.length) throw new Error('config 里 allowedSenders 为空，不知道发给谁');
  return list;
}

async function robotSend(cfg, token, msgKey, msgParam) {
  const r = await fetch('https://api.dingtalk.com/v1.0/robot/oToMessages/batchSend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-acs-dingtalk-access-token': token },
    body: JSON.stringify({
      robotCode: cfg.clientId,
      userIds: targets(cfg),
      msgKey,
      msgParam: JSON.stringify(msgParam),
    }),
  });
  const text = await r.text();
  let j = null;
  try { j = JSON.parse(text); } catch {}
  const bad = j && ((j.invalidStaffIdList || []).length || (j.filteredStaffIdList || []).length);
  if (!r.ok || bad) throw new Error(`发送失败 HTTP ${r.status}: ${text.slice(0, 300)}`);
  return j;
}

/** 上传本地文件到钉钉媒体存储，返回 media_id */
export async function uploadMedia(cfg, token, filePath, type = 'image') {
  const fd = new FormData();
  fd.append('media', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const r = await fetch(
    `https://oapi.dingtalk.com/media/upload?access_token=${token}&type=${type}`,
    { method: 'POST', body: fd });
  const j = JSON.parse(await r.text());
  if (j.errcode !== 0) throw new Error('上传失败: ' + JSON.stringify(j));
  return j.media_id;
}

export async function sendText(content, cfg = loadConfig()) {
  return robotSend(cfg, await getToken(cfg), 'sampleText', { content: String(content) });
}

export async function sendMarkdown(title, text, cfg = loadConfig()) {
  return robotSend(cfg, await getToken(cfg), 'sampleMarkdown', {
    title: String(title), text: String(text),
  });
}

export async function sendImage(filePath, caption, cfg = loadConfig()) {
  if (!fs.existsSync(filePath)) throw new Error('文件不存在: ' + filePath);
  const token = await getToken(cfg);
  const mediaId = await uploadMedia(cfg, token, filePath, 'image');
  const res = await robotSend(cfg, token, 'sampleImageMsg', { photoURL: mediaId });
  if (caption) { try { await robotSend(cfg, token, 'sampleText', { content: String(caption) }); } catch {} }
  return { mediaId, res };
}

// ── CLI ──
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const i = rest.indexOf('--caption');
  const caption = i >= 0 ? rest[i + 1] : null;
  try {
    if (cmd === 'text') {
      await sendText(arg); console.log('✅ 文本已发送');
    } else if (cmd === 'markdown') {
      const body = (rest[0] && !rest[0].startsWith('--')) ? rest[0] : arg;
      await sendMarkdown(arg || '通知', body); console.log('✅ Markdown 已发送');
    } else if (cmd === 'image') {
      const r = await sendImage(arg, caption); console.log('✅ 图片已发送  media_id =', r.mediaId);
    } else {
      console.log('用法：');
      console.log('  node notify.mjs text     "内容"');
      console.log('  node notify.mjs markdown "标题" "正文"');
      console.log('  node notify.mjs image    <路径> [--caption "附言"]');
      process.exit(1);
    }
  } catch (e) {
    console.error('❌', e.message);
    process.exit(1);
  }
}

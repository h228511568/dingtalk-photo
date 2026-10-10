/**
 * dingtalk-photo —— DSH 插件入口
 *
 * 注册两个一等公民工具：
 *   take_photo      拍一张照并发到钉钉
 *   dingtalk_send   发文本 / Markdown / 图片到钉钉
 *
 * 实现直接复用 scripts/ 下的模块，不重复逻辑、不起子进程。
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { sendText, sendMarkdown, sendImage, loadConfig, resolveConfigPath } from './scripts/notify.mjs';
import { takePhoto, listCameras } from './scripts/take-photo.mjs';

/** 等工具注册表就绪再挂载 */
export const inject = ['tools'];

export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'take_photo',
    description:
      '用这台电脑的摄像头拍一张照片并发送到用户的钉钉。' +
      '当用户要求"拍张照""拍张照片发我""用摄像头看看"时使用。' +
      '拍照会点亮摄像头指示灯。',
    parameters: {
      caption: { type: 'string', description: '随照片一起发送的说明文字（可选）' },
      seconds: { type: 'number', description: '拍摄时长秒数，默认 1。画面偏暗时调大到 2' },
      device: { type: 'string', description: '摄像头设备名，默认 HD Camera' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const out = await takePhoto({
        caption: args.caption,
        seconds: args.seconds,
        device: args.device,
      });
      return `已拍照并发送到钉钉。\n本地文件：${out.path}\n大小：${(out.bytes / 1024).toFixed(1)} KB\nmedia_id：${out.mediaId}`;
    },
  }));

  ctx.tools.register(defineTool({
    name: 'dingtalk_send',
    description:
      '往用户的钉钉发送消息。支持纯文本、Markdown、以及发送本地图片文件。' +
      '当用户要求"发钉钉""通知我"，或任务完成/异常需要主动告知时使用。',
    parameters: {
      kind: {
        type: 'string',
        required: true,
        description: '消息类型：text / markdown / image',
      },
      content: {
        type: 'string',
        required: true,
        description: 'text 时是正文；markdown 时是正文（标题另填 title）；image 时是图片的绝对路径',
      },
      title: { type: 'string', description: 'markdown 的标题（可选）' },
      caption: { type: 'string', description: 'image 时随图发送的附言（可选）' },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      const kind = String(args.kind || '').toLowerCase();
      if (kind === 'text') {
        await sendText(args.content);
        return '已发送文本消息到钉钉。';
      }
      if (kind === 'markdown') {
        await sendMarkdown(args.title || '通知', args.content);
        return '已发送 Markdown 消息到钉钉。';
      }
      if (kind === 'image') {
        const r = await sendImage(args.content, args.caption);
        return `已发送图片到钉钉。media_id：${r.mediaId}`;
      }
      throw new Error(`不支持的 kind：${args.kind}（应为 text / markdown / image）`);
    },
  }));
}

/** 让用户能看到当前用的是哪份配置 */
export function describeConfig() {
  try {
    const p = resolveConfigPath();
    const c = loadConfig();
    return `配置文件：${p}\n接收人：${(c.allowedSenders || []).join(', ') || '(未配置)'}`;
  } catch (e) {
    return `配置未就绪：${e.message}`;
  }
}

export { listCameras };

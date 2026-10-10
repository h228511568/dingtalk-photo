---
name: dingtalk-photo
description: 用这台电脑的摄像头拍照并发到钉钉，或往钉钉发文本/Markdown/图片消息。当用户说"拍张照""拍张照片发我""用摄像头看看""发个钉钉消息""把这张图发钉钉"，或需要主动通知用户（邮件提醒、任务完成、异常告警）时加载。
---

# 钉钉拍照与通知

把「电脑摄像头」和「钉钉机器人」接起来：**拍一张照并发到你的钉钉**，或发送任意文本/图片通知。

## 何时用

- 用户要求**拍照**：`拍张照`、`拍张照片发我`、`用摄像头看看`、`看看我桌上`…
- 用户要求**发钉钉消息**：`发个钉钉`、`通知我`、`把这张图发我钉钉`…
- **脚本/定时任务需要主动通知**：任务完成、异常告警、监控触发

## 前置条件

| 依赖 | 说明 |
|---|---|
| **ffmpeg** | 拍照必需。检查：`ffmpeg -version`。没有就用 `DSH_FFMPEG` 环境变量指定路径 |
| **Node.js ≥ 18** | 需要原生 `fetch` / `FormData` / `Blob`（本项目在 Node 24 上验证） |
| **钉钉配置** | 见下方《配置》一节，必须包含 `clientId` / `clientSecret` / `allowedSenders` |

## 用法

```bash
# 拍照并发钉钉
node scripts/take-photo.mjs --caption "说明文字"

# 查看可用摄像头（设备名不对时用）
node scripts/take-photo.mjs --list-cameras

# 发文本
node scripts/notify.mjs text "任务已完成"

# 发 Markdown
node scripts/notify.mjs markdown "构建结果" "### 通过\n- 耗时 42s"

# 发已有图片
node scripts/notify.mjs image ./screenshot.png --caption "截图"
```

作为模块调用（供其它脚本复用）：

```js
import { sendText, sendImage, sendMarkdown } from './scripts/notify.mjs';
await sendText('你好');
```

## 配置

配置文件按以下顺序查找，**先找到先用**：

1. 环境变量 `DSH_DINGTALK_CONFIG` 指向的文件
2. 仓库根目录的 `config.json`（已在 `.gitignore` 中）
3. `scripts/config.json`
4. `~/.dsh/dingtalk-photo.json` ← **推荐，密钥不进仓库**

字段见 `config.example.json`。最小配置：

```json
{
  "clientId": "dingxxxxxxxxxxxxxxxx",
  "clientSecret": "xxxxxxxx",
  "allowedSenders": ["你的 staffId"]
}
```

`allowedSenders` 是接收人的钉钉 userId 列表。不知道自己的 staffId 时，
让用户先给机器人发一条任意消息，桥接日志里会打印 `from=<staffId>`。

## 关键实现（不要改动这两处）

### 1. 发图不需要公网地址

机器人接口 `/v1.0/robot/oToMessages/batchSend` 的 `sampleImageMsg` 消息，
其 `photoURL` 字段**可以直接填 `media/upload` 返回的 media_id**：

```
POST oapi.dingtalk.com/media/upload?type=image   →  media_id: @lADP...
POST api.dingtalk.com/v1.0/robot/oToMessages/batchSend
     msgKey  : sampleImageMsg
     msgParam: {"photoURL": "@lADP..."}
```

**因此发图不需要图床、不需要内网穿透、不需要公网 IP**，图片只经过钉钉。
（不要为了发图去装 ngrok/cloudflared，也不需要上传到第三方图床。）

### 2. 不要走「工作通知」

`topapi/message/corpconversation/asyncsend_v2` 对某些应用类型会返回
`errcode 41 Invalid arguments:msg`——**连纯文本都会失败**（已用文本/图片、
字符串/数字 agent_id、字符串/数组 userid_list 四种组合验证）。
媒体消息一律走机器人接口。

## 拍照的两个坑

1. **必须连拍约 1 秒取最后一帧**。网络摄像头开机头几帧自动曝光未完成，
   直接取第一帧会明显偏暗发灰。脚本已默认这么做（`--seconds` 可调）。
2. **设备名要精确**。Windows 下用 DirectShow，设备名通常是 `HD Camera`。
   名字不对时 ffmpeg 会报 `Could not find video device`，用 `--list-cameras` 查。

## 排查

| 现象 | 原因 |
|---|---|
| `找不到配置文件` | 四个查找位置都没有；按上面《配置》放一份 |
| `取 access_token 失败` | `clientId`/`clientSecret` 不对 |
| `发送失败 ... invalidStaffIdList` | `allowedSenders` 里的 staffId 无效 |
| `ffmpeg 抓帧失败` | 设备名不对（`--list-cameras` 查）、摄像头被占用、或隐私设置禁止桌面应用访问 |
| 照片偏暗发灰 | `--seconds` 调大到 2 |
| Windows 上找不到 ffmpeg | 设 `DSH_FFMPEG=C:\path\to\ffmpeg.exe` |

## 边界

- 本技能**只做发送和拍照**，不负责采集钉钉凭据，也不应把任何密钥写进本仓库。
- 拍照会**点亮摄像头指示灯**，用户在场时属于可感知行为。
- 该机器人通道是**单向的**（电脑 → 手机）。若用户要反向控制电脑，
  那是另一个组件（Stream 长连接桥接）的职责，不在本技能范围内。

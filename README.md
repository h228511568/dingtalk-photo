# dingtalk-photo

**用电脑摄像头拍一张照，直接发到你的钉钉。** 也可以往钉钉发文本 / Markdown / 任意图片。

为 [DeepSeek Harness](https://github.com/deepseek-ai) 设计，**同时提供技能（skill）和插件（plugin）两种形态**。

```
┌──────────┐   ffmpeg     ┌──────────────┐   media/upload   ┌─────────┐
│ 摄像头    │ ──dshow────▶ │ take-photo   │ ───────────────▶ │ 钉钉     │
└──────────┘              │  notify.mjs  │  oToMessages     │ 机器人   │
                          └──────────────┘ ───────────────▶ └─────────┘
```

---

## 亮点：发图不需要公网地址

这是本项目最有价值的一条经验。

钉钉机器人发图片通常被要求提供一个**公网可达的 URL**——这意味着你得搭图床或做内网穿透。
但实测发现：机器人接口 `sampleImageMsg` 的 `photoURL` 字段
**可以直接填 `media/upload` 返回的 `media_id`**：

```
POST oapi.dingtalk.com/media/upload?type=image        →  {"media_id": "@lADP...", ...}
POST api.dingtalk.com/v1.0/robot/oToMessages/batchSend
     msgKey  : sampleImageMsg
     msgParam: {"photoURL": "@lADP..."}               →  HTTP 200，图片正常显示 ✅
```

**结论：不需要图床、不需要内网穿透、不需要公网 IP，图片只经过钉钉。**

> 另一条常见路线 `topapi/message/corpconversation/asyncsend_v2`（工作通知）
> 对部分应用类型**不可用**——连纯文本都会返回 `errcode 41 Invalid arguments:msg`。
> 本项目已在文本/图片 × 字符串/数字 agent_id × 字符串/数组 userid_list 共 4 种组合下验证失败，
> 因此媒体消息一律走机器人接口。

---

## 依赖

| 依赖 | 必需 | 说明 |
|---|---|---|
| **Node.js ≥ 18** | ✅ | 需要原生 `fetch` / `FormData` / `Blob`（在 Node 24 上验证） |
| **ffmpeg** | 拍照时必需 | 仅发文本/图片时不需要。没有时用 `DSH_FFMPEG` 指定路径 |
| **钉钉企业内部应用** | ✅ | 需要 AppKey / AppSecret，且开启**机器人** |
| 摄像头 | 拍照时必需 | Windows 下经 DirectShow 访问 |

---

## 快速开始

### 1. 拿到仓库

```bash
git clone https://github.com/<你>/dingtalk-photo.git
cd dingtalk-photo
```

### 2. 准备钉钉应用

在 <https://open-dev.dingtalk.com/> 创建应用，开启**机器人**能力，记下：

- **AppKey** → 配置里的 `clientId`
- **AppSecret** → 配置里的 `clientSecret`

### 3. 配置

复制 `config.example.json` 为 `config.json` 并填写。
**推荐放到 `~/.dsh/dingtalk-photo.json`**，让密钥完全离开仓库目录：

```bash
cp config.example.json ~/.dsh/dingtalk-photo.json
# 然后编辑它，填 clientId / clientSecret / allowedSenders
```

`allowedSenders` 是接收人的钉钉 userId 列表。不知道自己的 staffId？
先给机器人随便发一条消息，接收侧日志里会带出 `from=<staffId>`。

配置查找顺序（先找到先用）：

1. 环境变量 `DSH_DINGTALK_CONFIG`
2. `<仓库根>/config.json`
3. `scripts/config.json`
4. `~/.dsh/dingtalk-photo.json` ← 推荐

### 4. 验证

```bash
# 查摄像头设备名
node scripts/take-photo.mjs --list-cameras

# 发一条文本试试通道
node scripts/notify.mjs text "dingtalk-photo 安装成功"

# 拍照并发出去
node scripts/take-photo.mjs --caption "第一次测试"
```

Windows 也可以直接双击 `拍照发钉钉.cmd`。

---

## 两种形态

### A. 作为 DSH 技能使用

技能就是包含 `SKILL.md` 的目录，放进任一被扫描的技能根目录即可：

```
<工作区>/.dsh/skills/dingtalk-photo/    ← clone 到这里
~/.dsh/skills/dingtalk-photo/           ← 或这里（所有工作区可用）
```

放进后**不需要重启**，下一次会话即可被索引。之后你对 agent 说
「拍张照发我」它就会加载本技能并按里面的说明执行。

### B. 作为 DSH 插件使用

`index.js` 注册两个一等公民工具，`package.json` 声明了 bundle：

| 工具 | 作用 |
|---|---|
| `take_photo` | 拍照并发到钉钉 |
| `dingtalk_send` | 发文本 / Markdown / 图片 |

装配在 `cordis.patch.yml`。安装走 DSH 的插件管理流程
（Creator 模式下的 `plugin_manager` → `install_bundle`，target 指向本仓库绝对路径）。

> ⚠️ **插件形态未经端到端验证**（作者环境里没有可用的插件安装通道）。
> 脚本层与技能层是充分验证过的；插件层只是对同一批函数的一层薄封装，见 `index.js`。

---

## 命令参考

```bash
# 拍照并发钉钉
node scripts/take-photo.mjs [--caption "附言"] [--seconds 1] [--device "HD Camera"]
node scripts/take-photo.mjs --list-cameras

# 发消息
node scripts/notify.mjs text     "内容"
node scripts/notify.mjs markdown "标题" "正文"
node scripts/notify.mjs image    <图片路径> [--caption "附言"]
```

### 作为模块调用

```js
import { sendText, sendMarkdown, sendImage } from './scripts/notify.mjs';
import { takePhoto, listCameras } from './scripts/take-photo.mjs';

await sendText('任务完成');
await sendImage('C:/path/screenshot.png', '截图');
const out = await takePhoto({ caption: '桌面', seconds: 2 });
console.log(out.path, out.mediaId);
```

### 环境变量

| 变量 | 作用 |
|---|---|
| `DSH_DINGTALK_CONFIG` | 指定配置文件路径（优先级最高） |
| `DSH_FFMPEG` | ffmpeg 可执行文件路径 |
| `DSH_CAMERA` | 摄像头设备名 |

---

## 排查

| 现象 | 原因与处理 |
|---|---|
| `找不到配置文件` | 四个查找位置都没有；按上面《配置》放一份 |
| `取 access_token 失败` | `clientId` / `clientSecret` 不对 |
| `发送失败 ... invalidStaffIdList` | `allowedSenders` 里的 staffId 无效 |
| `ffmpeg 抓帧失败` / `Could not find video device` | 设备名不对，用 `--list-cameras` 查；或摄像头被占用；或系统隐私设置禁止桌面应用访问摄像头 |
| 照片**偏暗发灰** | 网络摄像头开机头几帧自动曝光未完成。`--seconds 2` 或更大 |
| Windows 找不到 ffmpeg | 设 `DSH_FFMPEG=C:\path\to\ffmpeg.exe` |
| 图片发出去是裂图 | 确认 `msgKey` 是 `sampleImageMsg` 且 `photoURL` 填的是 `media_id`（不是文件路径、不是 URL） |

---

## 已知限制

- **仅 Windows 验证**。拍照依赖 `ffmpeg -f dshow`；Linux 需改成 `v4l2`、macOS 改成 `avfoundation`。
  发消息部分与平台无关。
- **单向通道**：本项目只负责「电脑 → 手机」。若要反向（手机遥控电脑），那是 Stream 长连接桥接的职责。
- **应用需要「机器人」能力**；部分应用类型不支持发送工作通知（见上文）。
- 拍照会**点亮摄像头指示灯**，是可感知行为。

---

## 安全

- **`config.json` / `~/.dsh/dingtalk-photo.json` 含 AppSecret，等同于机器人身份的凭据**，不要外传、不要提交。
  本仓库的 `.gitignore` 已排除 `config.json`、`captures/` 与所有图片。
- `allowedSenders` 决定消息发给谁。**它同时也是接收侧白名单的基础**——
  如果你把它接到能反向执行命令的桥接上，请务必确认白名单只包含你自己。
- 本工具不采集、不上传任何凭据到第三方；图片只经过钉钉。

---

## 许可

[MIT](LICENSE)

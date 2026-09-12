# JavDB Cover Bot

**中文** | [English](README.en.md)

**一个轻量的 Telegram 番号查询 Bot，发送番号后自动返回封面、中文标题、日期、演员与标签。**

> 支持 Docker Compose 部署，封面可按配置使用 Telegram spoiler 遮罩。

---

## 🎯 核心特性

- 发送番号即可查询，例如 `SSIS-001`
- 支持 FC2 简写：`FC2-PPV-2767346`、`FC2-2767346`、`2767346` 都会规范为 `FC2-PPV-2767346`
- 支持 `/av`、`/jav`、`/javdb`、`/jd` 命令
- 自动返回封面图、中文标题、日期、演员与标签
- 标题在已获取且番号匹配的资料中优先选择中文候选，繁体转简体；没有时先读成功译文缓存，再尝试 Google 和免自备密钥的微软 Bing 网页翻译，不改变封面来源，也不额外遍历网站。中文候选按含汉字且不含假名判断，纯汉字日文与中文仍可能无法区分。
- 标题翻译遇 Google 429 时暂停该接口 5 分钟；同标题并发合并，成功译文原子缓存至 `TMP_DIR` 同级的 `translations/`，上限 2000 条 / 8 MiB。两路均失败仍保留原文，不缓存失败、拒绝或未译日文。缓存不能替代可用的翻译服务，也不保证所有标题始终为中文。
- 优先读取片商官网的作品资料与结构化分类（目前支持 S1、MOODYZ、Aircontrol），不可用时再使用聚合元数据兜底
- JavDB 只用于补充元数据；封面不会使用 JavDB / JDBStatic 的水印图片，找不到其他可用封面时只返回文字简介
- 保持原始横版封面优先；单张图片最多等待 8 秒，失败后尝试同番号的 3xplanet、MissAV 和适用片商备用图（Prestige 官方图也仅作失败兜底）
- 备用图按实际尺寸判断横竖版：优先其他源横版，竖版/方图暂存，横版全部失败后才使用；已有竖版缓存也不会阻止继续找横版
- 成功封面按番号原子缓存至 `TMP_DIR` 同级的 `covers/`，总量上限 64 MiB；缓存仅在主图失败后使用，不覆盖已恢复的主图优先级
- 字段名使用 Telegram HTML 加粗显示
- 支持用户白名单
- 支持 Docker Compose 部署

## 标题翻译备用接口

Google 失败时自动使用微软 Bing 网页翻译，无需配置任何翻译 API key，也不调用 GPT/Parrot。先从固定的 Bing 翻译页读取临时令牌，再向同站翻译接口提交标题；每步最多等待 12 秒，禁止重定向。不读取或发送用户的模型 key、Telegram 凭据。标题文本仍会发送给翻译服务。该网页接口并非 Azure 官方订阅 API，可能限流或随页面调整失效；失败时保留原文。

`TITLE_TRANSLATION_CACHE_DIR` 可覆盖缓存目录。校验允许作品资料中确认过的日文姓名保留原文，但标题正文必须是中文；姓名及其简体变体参与缓存键，避免不同姓名上下文误用缓存。姓名翻译和标签流程保持原样。

## 🚀 快速开始

准备目录并下载 Compose 文件：

```bash
mkdir -p ~/javdb-cover-bot && cd ~/javdb-cover-bot
curl -Lo docker-compose.yml https://github.com/shui1iao/JavDB-Cover-Bot/releases/latest/download/docker-compose.yml
```

写入配置：

```bash
cat > .env <<'EOF_ENV'
BOT_TOKEN=你的 Telegram Bot Token
ALLOWED_USER_IDS=
SPOILER=true
EOF_ENV
```

启动：

```bash
docker compose pull
docker compose up -d
docker compose logs -f
```

> `ALLOWED_USER_IDS` 留空表示公开；填写逗号分隔的 Telegram 数字 ID 表示只允许指定用户使用。

## 💬 使用方式

直接给 Bot 发送番号：

```text
SSIS-001
```

或使用命令：

```text
/av SSIS-001
/jav SSIS-001
```

## ⚙️ 配置说明

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `BOT_TOKEN` | Telegram Bot Token | 必填 |
| `ALLOWED_USER_IDS` | 允许使用的 Telegram 数字 ID，逗号分隔；留空公开 | 空 |
| `SPOILER` | 封面是否使用 spoiler 遮罩 | `true` |
| `TMP_DIR` | 临时文件目录，Compose 中自动设置为 `/app/data/tmp` | `./data/tmp` |

## 🛠 运维

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs -f
```

更新：

```bash
docker compose pull
docker compose up -d
```

## 🔐 隐私说明

Bot 只按收到的番号实时查询公开页面，不需要数据库。请妥善保管 `BOT_TOKEN`，公开部署时建议配置 `ALLOWED_USER_IDS` 白名单。

## 📄 License

MIT

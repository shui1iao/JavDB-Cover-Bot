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
- JavDB 只用于补充元数据；封面不会使用 JavDB / JDBStatic 的水印图片，找不到其他可用封面时只返回文字简介
- 字段名使用 Telegram HTML 加粗显示
- 支持用户白名单
- 支持 Docker Compose 部署

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

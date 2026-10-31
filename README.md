# JavDB Cover Bot

**中文** | [English](README.en.md)

Telegram 番号查询 Bot：发送番号，返回可用封面、中文标题、日期、演员与分类标签。支持 Docker Compose、用户白名单和封面 spoiler。

## v0.3.14

- 更新到同一 Node 24 LTS 系的 **24.22.2**（内置 undici **7.30.1**），并锁定 npm undici **7.30.1**，修复翻译备用 fetch 可达的过量编码响应和 TLS 1.2 重协商进程崩溃问题。保留原 Google 主路、Bing 备用、超时、TLS 校验和缓存接口。
- 修复 `YUJ-038` 被 YUJ 裸前缀误判为韩国 MIB 而跳过查询的问题；改走现有严格完整番号校验，其它 MIB 前缀规则不变。
- Node 消息层使用随附 MIT `se-catalog-core 2026.10.31.1`，统一番号核对、元资料和封面选择；无需额外服务或数据库。
- 分类使用原名：83 组精确同义归一、306 个标准分类、21 个促销/价格词精确丢弃；同次去重。未知标签保留原字形，不机翻、不繁简改写分类；标点编码为合法可点击 hashtag。
- 演员保留原名，只附加姓名表中可靠的中文名；不凭语义猜姓名或建立演员身份别名。
- `GANA-3342` 与 `200GANA-3342` 按精确白名单视为同作；3xplanet 分类解析到 `Description` 即结束，不把简介变成标签。
- 保留 v0.3.12 的严格数字前缀备用图机制：仅精确详情中的唯一完整番号文件名可提名，并要求目标完整号和标题匹配；不是任意去前缀。

## 查询与封面

支持 `/av`、`/jav`、`/javdb`、`/jd` 或直接发送 `SSIS-001`。FC2 简写会规范为 `FC2-PPV-`；FC2 当前不输出分类。其余分类保留既有优先顺序和最多 20 项的呈现策略。

优先读取适用官方资料，再按来源路由补齐元资料。封面由共享核心按来源、实际尺寸和图像证据仲裁，拒绝错号、过小图和 JavDB/JDBStatic 水印图；无法安全取图时只发文字。成功封面原子缓存于 `TMP_DIR` 同级 `covers/`，上限 64 MiB，取不到新图时可回退缓存。上游限流或不可用仍可能导致资料或封面缺失。

标题仍用 Google 翻译，并在失败时尝试 Microsoft Bing 网页翻译，无需个人翻译密钥。Google 429 暂停五分钟；同标题并发合并，成功译文缓存于 `TMP_DIR` 同级 `translations/`，上限 2000 条 / 8 MiB。两路失败保留原文。标题和已确认姓名仍按原逻辑处理，不受分类规则影响。网页接口可能变化；标题文本会发送给翻译提供方，但不会发送 Telegram 凭据。

## Docker Compose 快速开始

```sh
mkdir -p ~/javdb-cover-bot && cd ~/javdb-cover-bot
curl -fLo docker-compose.yml https://github.com/shui1iao/JavDB-Cover-Bot/releases/latest/download/docker-compose.yml
cp /dev/null .env
```

编辑 `.env`（不要提交或分享真实配置）：

```dotenv
BOT_TOKEN=
ALLOWED_USER_IDS=
SPOILER=true
```

从 BotFather 获取自己的 token 填入 `BOT_TOKEN`，然后：

```sh
docker compose pull
docker compose up -d
docker compose logs -f
```

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `BOT_TOKEN` | 必填，自己的 Telegram Bot Token | 空 |
| `ALLOWED_USER_IDS` | 逗号分隔数字 ID；留空公开 | 空 |
| `SPOILER` | 是否遮罩封面 | `true` |
| `TMP_DIR` | 临时目录，Compose 固定 `/app/data/tmp` | `./data/tmp` |
| `TITLE_TRANSLATION_CACHE_DIR` | 可选译文缓存目录 | `TMP_DIR` 同级 `translations/` |

升级执行 `docker compose pull && docker compose up -d`，保留 `.env` 和 `data/`。不要对同一 token 启动多个实例。

## 从源码构建与离线测试

需要 Docker。镜像固定 Node/Python 基镜像及依赖，安装随附公开 MIT wheel：

```sh
docker build -t javdb-cover-bot:local .
docker run --rm --network none --entrypoint node -v "$PWD/test:/app/test:ro" javdb-cover-bot:local --test
```

测试只用合成元资料与临时生成图像，不启动 Bot 或发送 Telegram 消息。`test/title-translation.test.js` 对翻译服务使用替身。

核心源码在 `core/`，许可和第三方声明在同目录。使用 Python 3.14、`setuptools==82.0.1` 和 pip，运行 `SOURCE_DATE_EPOCH=0 python tools/build-core.py` 可刷新公开 build fingerprints 并重建 `vendor/` wheel。核心运行依赖固定于 `vendor/requirements.lock`。公开包与部署者自行维护的构建元数据可能不同，请用本发布资产的 SHA256SUMS 核对下载。

## 隐私与许可

Bot 按需请求公开元资料，并缓存必要封面和成功译文；请保护 token、白名单、缓存和日志。公开部署建议设置白名单。源码不包含部署配置、用户数据、频道历史或凭据。

MIT，署名 JavDB Cover Bot authors。随附核心为 MIT；OpenCC 与其它第三方保留各自许可和作者声明。

### 运行时安全回归

随附 Dockerfile 固定官方 Node 24.22.2 Bookworm-slim 镜像摘要，并保留其完整许可证；安装依赖的原始许可证不移除。运行 `npm test` 的本机 Node 需内置 undici 7.30.1 或更新兼容修复版，并提供 `openssl` 命令以临时生成测试证书。新增传输测试只访问本地回环地址，不访问翻译提供方、不发送 Telegram 消息。定向通过不代表无漏洞或完整安全审计。

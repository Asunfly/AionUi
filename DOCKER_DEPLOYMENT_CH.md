# 🐳 AionUi WebUI Docker 部署指南（中文）

本指南面向 **无桌面环境的 Linux 服务器**，提供从源码构建镜像、运行容器、持久化数据、排错等完整流程。即使是新手也能独立完成部署。

> ✅ **目标**：用 Docker 将 AionUi WebUI 与系统隔离，减少 CLI 工具对宿主系统的影响，并通过浏览器访问 WebUI。

---

## ✅ 方案规划（先看这里）

**隔离思路：**

- 使用 Docker 容器运行 AionUi WebUI
- 以非 root 用户运行进程（默认使用 UID/GID 1000），降低权限风险
- 仅把必要数据目录挂载到宿主机，实现持久化
- 通过 `AIONUI_ALLOW_REMOTE=true` 让 WebUI 对外访问

**数据目录规划：**

- 容器内部数据：`/home/aionui/.config/AionUi`
- 宿主机映射目录：`./data`（可自行调整）
- 仅对这个目录授予写权限

**启动方式：**

- 推荐 `docker compose` 一键启动
- 也提供 `docker run` 单命令启动

---

## ✅ 前置要求

- 已安装 Docker
- 已安装 Docker Compose（Docker Desktop 或 `docker compose`）
- 服务器能访问互联网（用于下载依赖）

---

## ✅ 方法一：从源码构建镜像（推荐）

### 1) 克隆源码

```bash
git clone https://github.com/iOfficeAI/AionUi.git
cd AionUi
```

### 2) 构建镜像

```bash
docker build -t aionui-webui:local .
```

构建完成后会得到 `aionui-webui:local` 镜像。

---

## ✅ 方法二：镜像发布到 Docker Hub（可选）

如果你希望发布到 Docker Hub，可按以下步骤操作：

```bash
# 登录 Docker Hub
docker login

# 打标签（替换成你的用户名/仓库名）
docker tag aionui-webui:local yourname/aionui-webui:latest

# 推送到 Docker Hub
docker push yourname/aionui-webui:latest
```

> 说明：本指南默认你本地构建使用，不依赖任何已有 .deb 包或二进制资源。

---

## ✅ 运行容器（两种方式）

### 方式 A：Docker Compose（推荐）

```bash
# 第一次启动会自动 build
docker compose up -d --build
```

**停止容器：**

```bash
docker compose down
```

### 方式 B：docker run

```bash
mkdir -p data
sudo chown -R 1000:1000 data

docker run -d \
  --name aionui-webui \
  -p 25808:25808 \
  -e AIONUI_PORT=25808 \
  -e AIONUI_ALLOW_REMOTE=true \
  -e AIONUI_HOST=0.0.0.0 \
  -v "$(pwd)/data:/home/aionui/.config/AionUi" \
  aionui-webui:local
```

> 如果你的宿主机默认用户不是 `1000:1000`，可以改用 `sudo chown -R $(id -u):$(id -g) data`。
> 容器默认以 UID 1000 运行，确保与宿主机用户一致时可避免权限问题。

---

## ✅ 访问 WebUI

启动后浏览器访问：

```
http://<你的服务器IP>:25808
```

### 查看首次登录密码

首次启动会生成默认管理员账号密码，可用下面命令查看日志：

```bash
# Compose
docker compose logs -f aionui-webui

# 或 docker run
docker logs -f aionui-webui
```

---

## ✅ 常见问题排查

### 1. 端口被占用

修改端口映射：

```yaml
ports:
  - '28080:25808'
```

或在 `docker run` 时使用：

```bash
-p 28080:25808
```

然后用 `http://<服务器IP>:28080` 访问。

### 2. 权限不足 / 数据无法写入

确保宿主机挂载目录有写权限，且与容器运行的 UID/GID 一致：

```bash
sudo chown -R 1000:1000 data
```

### 3. 需要限制访问范围

- 仅开放局域网访问时，避免公网暴露
- 可以在服务器防火墙上限制端口访问

---

## ✅ 运行原理说明（面向小白）

- AionUi WebUI 是通过 Electron 启动一个内置 Web 服务
- Docker 内运行的是 AionUi 的 WebUI 模式（无 GUI）
- 访问端口 25808 即可打开管理界面
- 宿主机只需要开放一个端口，其他文件系统不会被影响

---

## ✅ 升级方式

更新版本后重新构建即可：

```bash
git pull

docker compose up -d --build
```

---

## ✅ 文件说明

| 文件                 | 作用                  |
| -------------------- | --------------------- |
| `Dockerfile`         | 从源码构建 WebUI 镜像 |
| `docker-compose.yml` | 推荐的启动方式        |
| `.dockerignore`      | 缩小构建上下文        |

---

**部署完成后，你就可以在任何无桌面的 Linux 服务器上安全使用 WebUI 了。**

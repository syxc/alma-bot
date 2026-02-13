# Rose Bot - 有人格和记忆的 Telegram Bot

一个像真人一样的 Telegram Bot，有独立性格、会记住你说的话。

## 功能特点

- 🌸 **真实人格**: Rose 是个 24 岁的北京女孩，独立有主见，有点小脾气
- 🧠 **长期记忆**: 自动记住你的重要信息（名字、喜好等），越聊越熟
- 💬 **对话记忆**: 记住每次聊天内容，能接上之前的话题
- 📔 **日记功能**: 根据对话生成"她的日记"
- ⏰ **时间感知**: 隔了很久没联系会自然问候
- 💾 **SQLite 存储**: 持久化存储，重启不丢失

## 快速开始

### 1. 安装依赖

```bash
cd alma-bot
npm install
```

### 2. 配置

```bash
# 复制配置文件
cp .env.example .env
```

编辑 `.env` 填写：

```env
# Telegram Bot Token (从 @BotFather 获取)
TELEGRAM_TOKEN=你的token

# DeepSeek API Key (从 https://platform.deepseek.com/ 获取)
DEEPSEEK_API_KEY=你的key

# 模型 (可选，默认 deepseek-chat)
MODEL_NAME=deepseek-chat

# 对话记忆条数 (可选，默认20)
MEMORY_LIMIT=20
```

### 3. 运行

```bash
npm start
```

或开发模式（自动重载）：

```bash
npm run dev
```

## 命令

| 命令 | 说明 |
|------|------|
| `/start` | 开始使用 |
| `/memory` | 查看记忆内容（Rose 记得关于你的事） |
| `/diary` | 生成今天的日记 |
| `/clear` | 清空记忆，重新认识 |

## 自定义人格

编辑 `persona.js` 修改 Rose 的性格：

```js
export const PERSONA = `
你叫 [名字]，[年龄] 岁...

[描述你想要的性格]
`.trim();
```

## 项目结构

```
alma-bot/
├── index.js    # 主入口，消息处理
├── persona.js  # 人格定义
├── memory.js   # 记忆管理（SQLite）
├── .env        # 配置文件（需自己创建）
└── memory.db   # 数据库文件（自动生成）
```

## 技术栈

- **Telegram Bot API**: `node-telegram-bot-api`
- **LLM**: DeepSeek API
- **存储**: better-sqlite3
- **运行时**: Node.js (ES Modules)

## 注意事项

- 记忆存储在 `memory.db` SQLite 文件中，重启不会丢失
- 数据库文件已在 `.gitignore` 中，不会提交敏感数据
- 对话记忆条数会影响 API 调用成本，可通过 `MEMORY_LIMIT` 调整
- 每隔约 10 条对话会自动提取重要信息存入长期记忆

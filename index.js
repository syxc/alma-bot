/**
 * Rose Bot - Telegram Bot with Personality & Memory
 *
 * 启动方式：
 *   1. 复制 .env.example 为 .env
 *   2. 填写 TELEGRAM_TOKEN 和 DEEPSEEK_API_KEY
 *   3. npm install
 *   4. npm start
 */
import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import axios from 'axios';
import { buildSystemPrompt, EXTRACTION_PROMPT, getCurrentMood, MOOD_ANALYSIS_PROMPT } from './persona.js';
import { memory } from './memory.js';

// 配置
const TOKEN = process.env.TELEGRAM_TOKEN;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL_NAME = process.env.MODEL_NAME || 'deepseek-chat';
const MEMORY_LIMIT = parseInt(process.env.MEMORY_LIMIT || '20');

if (!TOKEN || !API_KEY) {
  console.error('❌ 缺少必要配置！');
  console.error('请检查 .env 文件中的 TELEGRAM_TOKEN 和 DEEPSEEK_API_KEY');
  process.exit(1);
}

// API endpoint
const API_BASE = 'https://api.deepseek.com';

// 消息时间追踪（用于模拟"刚才在忙"）
const lastMessageTime = new Map();

// 用户名存储
const userNames = new Map();

// 内存管理：定期清理旧的用户数据，防止内存泄漏
setInterval(
  () => {
    const now = Date.now();
    const THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7天

    // 清理超过7天未活动的用户的时间记录
    for (const [userId, time] of lastMessageTime.entries()) {
      if (now - time > THRESHOLD) {
        lastMessageTime.delete(userId);
      }
    }

    // 清理用户名称映射中对应的条目
    for (const [userId, name] of userNames.entries()) {
      // 如果用户在lastMessageTime中且时间超过阈值，则清理
      const lastTime = lastMessageTime.get(userId);
      if (lastTime && now - lastTime > THRESHOLD) {
        userNames.delete(userId);
      }
    }
  },
  60 * 60 * 1000,
); // 每小时运行一次清理

/**
 * 调用 DeepSeek API
 */
async function chatWithLLM(messages) {
  // 验证输入
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('Invalid messages array');
  }

  const maxRetries = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post(
        `${API_BASE}/chat/completions`,
        {
          model: MODEL_NAME,
          messages,
          temperature: 0.85,
          max_tokens: 300,
        },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        console.error(`API 返回空内容 (尝试 ${attempt}/${maxRetries}):`, JSON.stringify(response.data, null, 2));
        if (attempt === maxRetries) {
          throw new Error('API 返回空内容');
        }
        // 等待一段时间后重试
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        continue;
      }

      return content;
    } catch (err) {
      lastError = err;
      console.error(`DeepSeek API 错误 (尝试 ${attempt}/${maxRetries}):`, err.response?.data || err.message);

      if (attempt === maxRetries) {
        // 如果是最终尝试，抛出错误
        throw err;
      }

      // 等待一段时间后重试
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    }
  }

  throw lastError;
}

/**
 * 提取对话中的重要信息
 */
async function extractImportantFacts(userId) {
  // 输入验证
  if (!userId) {
    console.error('提取重要信息失败: 缺少用户ID');
    return [];
  }

  try {
    const lastMessages = memory.getAll(userId).slice(-20);
    if (lastMessages.length === 0) return [];

    const messages = lastMessages;

    if (messages.length < 2) return [];

    const conversation = messages.map((m) => `${m.role === 'user' ? '对方' : 'Rose'}: ${m.content}`).join('\n');

    const prompt = `${EXTRACTION_PROMPT}\n\n对话记录:\n${conversation}\n\n需要记住的信息:`;

    try {
      const result = await chatWithLLM([
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: prompt },
      ]);

      if (!result || result === '无') {
        return [];
      }

      const facts = result
        .split('\n')
        .map((line) => line.replace(/^[-•*]\s*/, '').trim())
        .filter((line) => line.length > 3 && line.length < 100 && line !== '');

      // 保存新发现的重要信息
      for (const fact of facts) {
        await memory.addImportantFact(userId, fact);
      }

      return facts;
    } catch (err) {
      console.error('提取重要信息AI调用失败:', err.message);
      return [];
    }
  } catch (error) {
    console.error(`提取重要信息过程失败 (用户 ${userId}):`, error.message);
    return [];
  }
}

/**
 * 分析并记录情绪
 */
async function analyzeAndSaveMood(userId, userMessage, assistantReply) {
  // 输入验证
  if (!userId || !userMessage || !assistantReply) {
    console.error('分析情绪失败: 缺少必要参数');
    return;
  }

  try {
    const prompt = `${MOOD_ANALYSIS_PROMPT}\n\n对话:\n对方: ${userMessage}\nRose: ${assistantReply}`;

    try {
      const mood = await chatWithLLM([
        { role: 'system', content: MOOD_ANALYSIS_PROMPT },
        { role: 'user', content: prompt },
      ]);

      if (mood && mood !== '无') {
        await memory.addMood(userId, mood);
      }
    } catch (err) {
      console.error('分析情绪AI调用失败:', err.message);
    }
  } catch (error) {
    console.error(`分析情绪过程失败 (用户 ${userId}):`, error.message);
  }
}

/**
 * 获取时间间隔描述
 */
function getTimeGap(userId) {
  const lastTime = lastMessageTime.get(userId);
  if (!lastTime) return null;

  const gap = Date.now() - lastTime;
  const hours = Math.floor(gap / (1000 * 60 * 60));

  if (hours >= 6) {
    return `距离上次聊天已经过了${hours}小时了，可以自然地问候一句`;
  }
  if (hours >= 1) {
    return `隔了一会儿才回，可以简单说一句`;
  }

  return null;
}

/**
 * 构建消息列表（包含个性化信息）
 */
function buildMessages(userId, userMessage) {
  // 输入验证
  if (!userId || !userMessage) {
    throw new Error('构建消息失败: 缺少必要参数');
  }

  try {
    const userName = userNames.get(userId) || null;
    const recentMemories = memory.getRecent(userId, MEMORY_LIMIT);
    const importantFacts = memory.getImportantFacts(userId);
    const chatCount = memory.getChatCount(userId);
    const timeHint = getTimeGap(userId);
    const timeMood = getCurrentMood();
    const recentMood = memory.getRecentMood(userId);

    let moodHint = timeMood;
    if (recentMood) {
      moodHint += `，上次对话心情: ${recentMood}`;
    }

    const systemPrompt = buildSystemPrompt({
      userName,
      importantFacts,
      chatCount,
      mood: moodHint,
    });

    let messages = [{ role: 'system', content: systemPrompt }, ...recentMemories];

    // 如果间隔很久，添加时间提示
    if (timeHint) {
      messages.push({
        role: 'system',
        content: `[系统提示: ${timeHint}]`,
      });
    }

    messages.push({ role: 'user', content: userMessage });

    return messages;
  } catch (error) {
    console.error(`构建消息失败 (用户 ${userId}):`, error.message);
    // 返回最小可行的消息结构
    return [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userMessage },
    ];
  }
}

/**
 * 处理消息
 */
async function handleMessage(msg) {
  // 输入验证
  if (!msg || !msg.chat || !msg.text) {
    console.error('无效的消息对象');
    return;
  }

  const userId = msg.chat.id;
  const userMessage = msg.text;
  const userName = msg.from?.username || msg.from?.first_name || null;

  // 验证必需字段
  if (!userId || !userMessage) {
    console.error('消息缺少必需字段');
    return;
  }

  // 检查消息长度
  if (userMessage.length > 1000) {
    console.error('消息过长');
    try {
      await bot.sendMessage(userId, '消息太长了，我处理不了...');
    } catch (sendErr) {
      console.error('发送错误消息失败:', sendErr.message);
    }
    return;
  }

  try {
    // 保存用户名
    if (userName && !userNames.has(userId)) {
      userNames.set(userId, userName);
    }

    // 忽略命令消息
    if (userMessage.startsWith('/')) {
      return;
    }

    await bot.sendChatAction(userId, 'typing');

    // 构建消息
    const messages = buildMessages(userId, userMessage);

    // 调用 LLM
    const reply = await chatWithLLM(messages);

    if (!reply || reply.trim().length === 0) {
      console.error('LLM 返回空内容');
      await bot.sendMessage(userId, '嗯...');
      return;
    }

    // 检查回复长度
    if (reply.length > 4096) {
      // Telegram消息长度限制
      console.error('回复过长');
      reply = reply.substring(0, 4093) + '...';
    }

    // 发送回复
    await bot.sendMessage(userId, reply);

    // 保存对话
    await memory.add(userId, 'user', userMessage);
    await memory.add(userId, 'assistant', reply);

    // 更新最后消息时间
    lastMessageTime.set(userId, Date.now());

    // 偶尔提取重要信息（每 10 条对话左右）
    if (memory.getChatCount(userId) % 10 === 0) {
      extractImportantFacts(userId).catch((err) => {
        console.error('提取重要信息失败:', err.message);
      });
    }

    // 分析并记录情绪
    analyzeAndSaveMood(userId, userMessage, reply).catch((err) => {
      console.error('分析情绪失败:', err.message);
    });

    console.log(`[${userName || userId}] ${userMessage.substring(0, 20)}... -> OK`);
  } catch (err) {
    console.error('处理消息失败:', err);

    // 自然的人类式回复
    const naturalReplies = ['刚才卡住了，你说啥？', '没听清，再说一遍？', '有点走神了...', '信号不好吗，我没收到'];
    try {
      await bot.sendMessage(userId, naturalReplies[Math.floor(Math.random() * naturalReplies.length)]);
    } catch (sendErr) {
      console.error('发送错误回复失败:', sendErr.message);
    }
  }
}

/**
 * 命令处理
 */
async function handleCommand(msg) {
  // 输入验证
  if (!msg || !msg.chat || !msg.text) {
    console.error('无效的命令消息对象');
    return;
  }

  const userId = msg.chat.id;
  const text = msg.text;

  // 验证用户ID
  if (!userId) {
    console.error('命令处理失败: 缺少用户ID');
    return;
  }

  try {
    switch (text) {
      case '/start':
        await bot.sendMessage(userId, '嗨，我是 Rose。\n\n有什么就说吧，别客气。');
        break;

      case '/memory':
        const count = memory.getAll(userId).length;
        const facts = memory.getImportantFacts(userId);
        const mood = memory.getRecentMood(userId);
        if (facts.length > 0) {
          let reply = `我们聊了 ${count} 条消息。\n\n我记得:\n${facts.map((f) => `• ${f}`).join('\n')}`;
          if (mood) {
            reply += `\n\n上次聊完心情: ${mood}`;
          }
          await bot.sendMessage(userId, reply);
        } else {
          await bot.sendMessage(userId, `我们聊了 ${count} 条消息，但我还没记住什么特别的。`);
        }
        break;

      case '/clear':
        await memory.clear(userId);
        lastMessageTime.delete(userId);
        userNames.delete(userId);
        await bot.sendMessage(userId, '行，重新开始吧。');
        break;

      case '/diary':
        const allMessages = memory.getAll(userId);
        if (allMessages.length === 0) {
          await bot.sendMessage(userId, '还没聊啥呢，写什么日记。');
          break;
        }

        await bot.sendChatAction(userId, 'typing');

        // 限制日记生成的消息数量，避免过长的上下文
        const limitedMessages = allMessages.slice(-30);
        const diaryPrompt = `你是 Rose。根据以下对话记录，写一篇简短的日记（50字左右），用第一人称"我"来写:
${limitedMessages.map((m) => `${m.role === 'user' ? 'Ta' : '我'}: ${m.content}`).join('\n')}`;

        try {
          const diary = await chatWithLLM([
            { role: 'system', content: buildSystemPrompt() },
            { role: 'user', content: diaryPrompt },
          ]);
          await bot.sendMessage(userId, `📔\n\n${diary}`);
        } catch (err) {
          await bot.sendMessage(userId, '写日记的时候走神了...');
        }
        break;

      default:
        break;
    }
  } catch (error) {
    console.error(`命令处理失败 (用户 ${userId}, 命令 ${text}):`, error.message);
    try {
      await bot.sendMessage(userId, '命令处理出错了...');
    } catch (sendErr) {
      console.error('发送错误消息失败:', sendErr.message);
    }
  }
}

// 初始化 Bot
const bot = new TelegramBot(TOKEN, { polling: true });

// 启动
(async () => {
  await memory.init();

  bot.onText(/\/.*/, handleCommand);
  bot.on('message', handleMessage);

  console.log(`
╔═════════════════════════════════╗
║        Rose Bot 已启动          ║
╚═════════════════════════════════╝

模型: ${MODEL_NAME}
用户: ${memory.getUserIds().length} 人
记忆: 支持
情绪: 支持

Rose 就在这里，真实地活着。
`);
})();

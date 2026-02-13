/**
 * 记忆管理模块 - SQLite 版本
 * 支持短期对话记忆、长期重要信息记忆、情绪状态记忆
 */
import Database from 'better-sqlite3';

const DB_FILE = './memory.db';

/**
 * 记忆存储类
 */
export class MemoryStore {
  constructor() {
    this.db = null;
    this.loaded = false;
    this.importantCache = new Map(); // 缓存重要信息
    this.moodCache = new Map(); // 缓存情绪状态
  }

  /**
   * 初始化数据库
   */
  async init() {
    if (this.loaded) return;

    this.db = new Database(DB_FILE);

    // 创建对话记录表
    this.db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

    // 创建长期记忆表（重要信息）
    this.db.exec(`CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, fact)
    )`);

    // 创建情绪状态表
    this.db.exec(`CREATE TABLE IF NOT EXISTS moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      mood TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

    this.loaded = true;

    // 统计
    const userCount = this.db.prepare('SELECT COUNT(DISTINCT user_id) as count FROM messages').get().count;
    const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const moodCount = this.db.prepare('SELECT COUNT(*) as count FROM moods').get().count;
    console.log(`✓ 记忆已加载: ${userCount} 个用户, ${memoryCount} 条长期记忆, ${moodCount} 条情绪记录`);
  }

  /**
   * 添加对话记录
   */
  async add(userId, role, content) {
    const insert = this.db.prepare('INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)');
    insert.run(userId, role, content, Date.now());

    const count = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?').get(userId).count;
    console.log(`[记忆] 用户 ${userId} 现有 ${count} 条`);
  }

  /**
   * 添加/更新重要信息
   */
  async addImportantFact(userId, fact) {
    const stmt = this.db.prepare(`
      INSERT INTO memories (user_id, fact, created_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, fact) DO NOTHING
    `);
    stmt.run(userId, fact, Date.now());

    // 清除缓存
    this.importantCache.delete(userId);

    console.log(`[长期记忆] ${userId}: ${fact}`);
  }

  /**
   * 记录情绪状态
   */
  async addMood(userId, mood) {
    const stmt = this.db.prepare('INSERT INTO moods (user_id, mood, created_at) VALUES (?, ?, ?)');
    stmt.run(userId, mood, Date.now());

    // 清除缓存
    this.moodCache.delete(userId);

    // 只保留最近的 50 条情绪记录
    this.db
      .prepare(
        `
      DELETE FROM moods WHERE id IN (
        SELECT id FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 50
      )
    `,
      )
      .run(userId);
  }

  /**
   * 获取用户的重要信息
   */
  getImportantFacts(userId) {
    // 先查缓存
    if (this.importantCache.has(userId)) {
      return this.importantCache.get(userId);
    }

    const facts = this.db
      .prepare('SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at DESC')
      .all(userId)
      .map((row) => row.fact);

    // 缓存起来
    this.importantCache.set(userId, facts);
    return facts;
  }

  /**
   * 获取最近的情绪状态
   */
  getRecentMood(userId) {
    if (this.moodCache.has(userId)) {
      return this.moodCache.get(userId);
    }

    const mood = this.db
      .prepare('SELECT mood FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(userId);

    if (mood) {
      this.moodCache.set(userId, mood.mood);
      return mood.mood;
    }
    return null;
  }

  /**
   * 获取最近的对话记忆
   */
  getRecent(userId, limit = 15) {
    return this.db
      .prepare('SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit)
      .reverse();
  }

  /**
   * 获取所有对话记忆
   */
  getAll(userId) {
    return this.db.prepare('SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at ASC').all(userId);
  }

  /**
   * 获取用户对话数量
   */
  getChatCount(userId) {
    return this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?').get(userId).count;
  }

  /**
   * 清空指定用户的记忆
   */
  async clear(userId) {
    this.db.prepare('DELETE FROM messages WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM memories WHERE user_id = ?').run(userId);
    this.db.prepare('DELETE FROM moods WHERE user_id = ?').run(userId);
    this.importantCache.delete(userId);
    this.moodCache.delete(userId);
  }

  /**
   * 获取所有用户 ID
   */
  getUserIds() {
    return this.db
      .prepare('SELECT DISTINCT user_id FROM messages')
      .all()
      .map((row) => row.user_id);
  }

  /**
   * 关闭数据库
   */
  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

// 导出单例
export const memory = new MemoryStore();

// 优雅退出
process.on('exit', () => memory.close());
process.on('SIGINT', () => {
  memory.close();
  process.exit(0);
});

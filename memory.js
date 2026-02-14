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
    // Prepare statements for better performance
    this.preparedStatements = {};
  }

  /**
   * 初始化数据库
   */
  async init() {
    if (this.loaded) return;

    this.db = new Database(DB_FILE);

    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL;');
    // Optimize for read-heavy workload
    this.db.exec('PRAGMA cache_size = 10000;');
    this.db.exec('PRAGMA temp_store = memory;');

    // 创建对话记录表
    this.db.exec(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

    // 创建索引以提高查询性能
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at);');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_messages_user_role ON messages(user_id, role);');

    // 创建长期记忆表（重要信息）
    this.db.exec(`CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, fact)
    )`);

    // 创建索引以提高查询性能
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);');

    // 创建情绪状态表
    this.db.exec(`CREATE TABLE IF NOT EXISTS moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      mood TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);

    // 创建索引以提高查询性能
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_moods_user_created ON moods(user_id, created_at);');

    // Prepare statements for better performance
    this.preparedStatements.insertMessage = this.db.prepare(
      'INSERT INTO messages (user_id, role, content, created_at) VALUES (?, ?, ?, ?)',
    );
    this.preparedStatements.insertMemory = this.db.prepare(`
      INSERT INTO memories (user_id, fact, created_at) VALUES (?, ?, ?)
      ON CONFLICT(user_id, fact) DO NOTHING
    `);
    this.preparedStatements.insertMood = this.db.prepare(
      'INSERT INTO moods (user_id, mood, created_at) VALUES (?, ?, ?)',
    );
    this.preparedStatements.getMessageCount = this.db.prepare(
      'SELECT COUNT(*) as count FROM messages WHERE user_id = ?',
    );
    this.preparedStatements.getMemories = this.db.prepare(
      'SELECT fact FROM memories WHERE user_id = ? ORDER BY created_at DESC',
    );
    this.preparedStatements.getMood = this.db.prepare(
      'SELECT mood FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    );
    this.preparedStatements.getRecentMessages = this.db.prepare(
      'SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
    );
    this.preparedStatements.getAllMessages = this.db.prepare(
      'SELECT role, content FROM messages WHERE user_id = ? ORDER BY created_at ASC',
    );
    this.preparedStatements.getChatCount = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE user_id = ?');
    this.preparedStatements.clearMessages = this.db.prepare('DELETE FROM messages WHERE user_id = ?');
    this.preparedStatements.clearMemories = this.db.prepare('DELETE FROM memories WHERE user_id = ?');
    this.preparedStatements.clearMoods = this.db.prepare('DELETE FROM moods WHERE user_id = ?');
    this.preparedStatements.deleteOldMoods = this.db.prepare(`
      DELETE FROM moods WHERE id IN (
        SELECT id FROM moods WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 50
      )
    `);
    this.preparedStatements.getUserIds = this.db.prepare('SELECT DISTINCT user_id FROM messages');

    this.loaded = true;

    // 统计
    const userCount = this.preparedStatements.getUserIds.all().length;
    const memoryCount = this.db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const moodCount = this.db.prepare('SELECT COUNT(*) as count FROM moods').get().count;
    console.log(`✓ 记忆已加载: ${userCount} 个用户, ${memoryCount} 条长期记忆, ${moodCount} 条情绪记录`);
  }

  /**
   * 添加对话记录
   */
  async add(userId, role, content) {
    this.preparedStatements.insertMessage.run(userId, role, content, Date.now());

    const count = this.preparedStatements.getMessageCount.get(userId).count;
    console.log(`[记忆] 用户 ${userId} 现有 ${count} 条`);
  }

  /**
   * 添加/更新重要信息
   */
  async addImportantFact(userId, fact) {
    this.preparedStatements.insertMemory.run(userId, fact, Date.now());

    console.log(`[长期记忆] ${userId}: ${fact}`);
  }

  /**
   * 记录情绪状态
   */
  async addMood(userId, mood) {
    this.preparedStatements.insertMood.run(userId, mood, Date.now());

    // 只保留最近的 50 条情绪记录
    this.preparedStatements.deleteOldMoods.run(userId);
  }

  /**
   * 获取用户的重要信息
   */
  getImportantFacts(userId) {
    const facts = this.preparedStatements.getMemories.all(userId).map((row) => row.fact);
    return facts;
  }

  /**
   * 获取最近的情绪状态
   */
  getRecentMood(userId) {
    const mood = this.preparedStatements.getMood.get(userId);

    if (mood) {
      return mood.mood;
    }
    return null;
  }

  /**
   * 获取最近的对话记忆
   */
  getRecent(userId, limit = 15) {
    return this.preparedStatements.getRecentMessages.all(userId, limit).reverse();
  }

  /**
   * 获取所有对话记忆
   */
  getAll(userId) {
    return this.preparedStatements.getAllMessages.all(userId);
  }

  /**
   * 获取用户对话数量
   */
  getChatCount(userId) {
    return this.preparedStatements.getChatCount.get(userId).count;
  }

  /**
   * 清空指定用户的记忆
   */
  async clear(userId) {
    this.preparedStatements.clearMessages.run(userId);
    this.preparedStatements.clearMemories.run(userId);
    this.preparedStatements.clearMoods.run(userId);
  }

  /**
   * 获取所有用户 ID
   */
  getUserIds() {
    return this.preparedStatements.getUserIds.all().map((row) => row.user_id);
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

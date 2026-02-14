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

    try {
      this.db = new Database(DB_FILE);

      // Enable WAL mode for better concurrency
      this.db.exec('PRAGMA journal_mode = WAL;');
      // Optimize for read-heavy workload
      this.db.exec('PRAGMA cache_size = 10000;');
      this.db.exec('PRAGMA temp_store = memory;');
      // Increase busy timeout to handle concurrent access
      this.db.exec('PRAGMA busy_timeout = 30000;');

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
      this.preparedStatements.getChatCount = this.db.prepare(
        'SELECT COUNT(*) as count FROM messages WHERE user_id = ?',
      );
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
    } catch (error) {
      console.error('数据库初始化失败:', error.message);
      throw error;
    }
  }

  /**
   * 添加对话记录
   */
  async add(userId, role, content) {
    try {
      // 输入验证
      if (!userId || !role || typeof content !== 'string') {
        throw new Error('Invalid parameters for add');
      }

      this.preparedStatements.insertMessage.run(userId, role, content, Date.now());

      const count = this.preparedStatements.getMessageCount.get(userId).count;
      console.log(`[记忆] 用户 ${userId} 现有 ${count} 条`);
    } catch (error) {
      console.error(`添加对话记录失败 (用户 ${userId}):`, error.message);
      throw error;
    }
  }

  /**
   * 添加/更新重要信息
   */
  async addImportantFact(userId, fact) {
    try {
      // 输入验证
      if (!userId || !fact || typeof fact !== 'string') {
        throw new Error('Invalid parameters for addImportantFact');
      }

      this.preparedStatements.insertMemory.run(userId, fact, Date.now());

      console.log(`[长期记忆] ${userId}: ${fact}`);
    } catch (error) {
      console.error(`添加重要信息失败 (用户 ${userId}):`, error.message);
      throw error;
    }
  }

  /**
   * 记录情绪状态
   */
  async addMood(userId, mood) {
    try {
      // 输入验证
      if (!userId || !mood || typeof mood !== 'string') {
        throw new Error('Invalid parameters for addMood');
      }

      this.preparedStatements.insertMood.run(userId, mood, Date.now());

      // 只保留最近的 50 条情绪记录
      this.preparedStatements.deleteOldMoods.run(userId);
    } catch (error) {
      console.error(`添加情绪记录失败 (用户 ${userId}):`, error.message);
      throw error;
    }
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
    try {
      // 限制最大历史记录数量，避免内存占用过多
      const maxLimit = Math.min(limit, 50);
      return this.preparedStatements.getRecentMessages.all(userId, maxLimit).reverse();
    } catch (error) {
      console.error(`获取用户 ${userId} 最近记忆失败:`, error.message);
      return [];
    }
  }

  /**
   * 获取所有对话记忆
   */
  getAll(userId) {
    try {
      // 限制返回的最大消息数量，避免内存问题
      return this.preparedStatements.getAllMessages.all(userId).slice(-100); // 只返回最近100条
    } catch (error) {
      console.error(`获取用户 ${userId} 所有记忆失败:`, error.message);
      return [];
    }
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

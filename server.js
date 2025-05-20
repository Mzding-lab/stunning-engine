const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// ================= 数据库配置 =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ================= 初始化数据库表 =================
(async () => {
  try {
    // 创建账号表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_accounts (
        id SERIAL PRIMARY KEY,
        account_name VARCHAR(50) NOT NULL,
        phone_number VARCHAR(20) NOT NULL,
        api_key VARCHAR(100) NOT NULL,
        is_active BOOLEAN DEFAULT FALSE
      )
    `);

    // 创建消息表
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) CHECK (type IN ('sent', 'received')),
        phone VARCHAR(20) NOT NULL,
        content TEXT,
        timestamp TIMESTAMPTZ DEFAULT NOW(),
        account_id INT REFERENCES whatsapp_accounts(id)
      )
    `);

    console.log('✅ 数据库表初始化成功！');
  } catch (error) {
    console.error('❌ 数据库初始化失败:', error.message);
  }
})();

// ================= 中间件配置 =================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public')); // 托管静态文件（HTML/CSS）

// ================= 账号管理接口 =================
// 添加账号
app.post('/accounts', async (req, res) => {
  const { accountName, phoneNumber, apiKey } = req.body;
  try {
    await pool.query(
      'INSERT INTO whatsapp_accounts (account_name, phone_number, api_key) VALUES ($1, $2, $3)',
      [accountName, phoneNumber, apiKey]
    );
    res.send('✅ 账号添加成功！');
  } catch (error) {
    res.status(500).send('❌ 添加失败：' + error.message);
  }
});

// 获取所有账号
app.get('/accounts', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM whatsapp_accounts');
    res.json(rows);
  } catch (error) {
    res.status(500).send('❌ 获取账号失败');
  }
});

// 切换激活账号
app.post('/accounts/switch', async (req, res) => {
  const { accountId } = req.body;
  try {
    await pool.query('UPDATE whatsapp_accounts SET is_active = FALSE');
    await pool.query('UPDATE whatsapp_accounts SET is_active = TRUE WHERE id = $1', [accountId]);
    res.send('✅ 已切换账号！');
  } catch (error) {
    res.status(500).send('❌ 切换失败：' + error.message);
  }
});

// ================= 发送消息接口 =================
app.post('/send', async (req, res) => {
  const { phone, content } = req.body;
  try {
    // 获取当前激活账号
    const { rows: [activeAccount] } = await pool.query(
      'SELECT * FROM whatsapp_accounts WHERE is_active = TRUE LIMIT 1'
    );
    if (!activeAccount) return res.status(400).send('❌ 请先激活一个账号！');

    // 校验号码格式
    if (!phone || !/^[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).send('❌ 号码格式错误（例：8618850970823）');
    }

    // 发送消息
    const params = new URLSearchParams();
    params.append('channel', 'whatsapp');
    params.append('source', activeAccount.phone_number);
    params.append('destination', phone);
    params.append('message', JSON.stringify({ type: 'text', text: content }));

    const response = await axios.post(
      'https://api.gupshup.io/wa/api/v1/msg',
      params.toString(),
      { 
        headers: { 
          apikey: activeAccount.api_key,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    // 记录到数据库
    await pool.query(
      'INSERT INTO messages (type, phone, content, account_id) VALUES ($1, $2, $3, $4)',
      ['sent', phone, content, activeAccount.id]
    );
    res.send('✅ 发送成功！');
  } catch (error) {
    const errorMsg = error.response?.data || error.message;
    res.status(500).send('❌ 发送失败：' + errorMsg);
  }
});

// ================= 管理界面 =================
app.get('/', async (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// ================= 启动服务 =================
app.listen(port, () => {
  console.log(`🚀 服务已启动：http://localhost:${port}`);
});
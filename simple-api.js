#!/usr/bin/env node

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const PORT = process.env.PORT || 3008;
const WEBSITE_DIR = process.env.WEBSITE_DIR || "/var/www/website";
const SERVER_IP = process.env.SERVER_IP || "localhost";

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 确保目录存在
async function ensureDir() {
  try {
    await fs.access(WEBSITE_DIR);
  } catch {
    await fs.mkdir(WEBSITE_DIR, { recursive: true });
  }
}

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 部署 HTML
app.post('/deploy', async (req, res) => {
  try {
    await ensureDir();
    
    const { html, filename } = req.body;
    
    if (!html) {
      return res.status(400).json({ error: 'HTML content is required' });
    }

    // 生成文件名
    const finalFilename = filename 
      ? `${filename}.html`
      : `${crypto.randomBytes(8).toString("hex")}.html`;

    const filePath = path.join(WEBSITE_DIR, finalFilename);
    await fs.writeFile(filePath, html, "utf-8");
    
    const url = `http://${SERVER_IP}/website/${finalFilename}`;
    
    res.json({
      success: true,
      filename: finalFilename,
      url: url,
      message: '部署成功'
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 列出文件
app.get('/list', async (req, res) => {
  try {
    await ensureDir();
    const files = await fs.readdir(WEBSITE_DIR);
    const htmlFiles = files.filter(f => f.endsWith('.html'));
    
    const fileList = await Promise.all(
      htmlFiles.map(async (file) => {
        const filePath = path.join(WEBSITE_DIR, file);
        const stats = await fs.stat(filePath);
        return {
          filename: file,
          url: `http://${SERVER_IP}/website/${file}`,
          size: stats.size,
          modified: stats.mtime.toISOString(),
        };
      })
    );

    res.json({
      count: fileList.length,
      files: fileList,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除文件
app.delete('/delete/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(WEBSITE_DIR, filename);
    
    await fs.unlink(filePath);
    
    res.json({
      success: true,
      message: `${filename} 已删除`
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 简单部署服务运行在 http://0.0.0.0:${PORT}`);
  console.log(`📁 网站目录: ${WEBSITE_DIR}`);
  console.log(`\n可用端点:`);
  console.log(`  POST   /deploy         - 部署 HTML`);
  console.log(`  GET    /list           - 列出文件`);
  console.log(`  DELETE /delete/:name   - 删除文件`);
  console.log(`  GET    /health         - 健康检查`);
  console.log(`\n示例:`);
  console.log(`  curl -X POST http://localhost:${PORT}/deploy \\`);
  console.log(`    -H "Content-Type: application/json" \\`);
  console.log(`    -d '{"html":"<h1>Hello</h1>","filename":"test"}'`);
});

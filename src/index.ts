#!/usr/bin/env node

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import os from "os";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3007;
const WEBSITE_DIR = process.env.WEBSITE_DIR || path.join(__dirname, "../public");

// 自动获取本机 IP 地址
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const SERVER_IP = getLocalIP();
const BASE_URL = `http://${SERVER_IP}:${PORT}`;

// 确保网站目录存在
async function ensureWebsiteDir() {
  try {
    await fs.access(WEBSITE_DIR);
  } catch {
    await fs.mkdir(WEBSITE_DIR, { recursive: true });
  }
}

// 启动 HTTP 服务器
async function startServer() {
  const app = express();

  // 配置 multer 用于文件上传（只允许 .html 文件）
  const upload = multer({ 
    dest: '/tmp/',
    limits: {
      fileSize: 50 * 1024 * 1024 // 50MB
    },
    fileFilter: (req, file, cb) => {
      if (file.originalname.endsWith('.html')) {
        cb(null, true);
      } else {
        cb(new Error('只支持 .html 文件'));
      }
    }
  });

  app.use(cors({
    origin: 'https://adp.tencentcloud.com'
  }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.text({ limit: '50mb', type: 'text/html' }));

  // 静态文件服务
  app.use('/files', express.static(WEBSITE_DIR));

  // 根路径 - 显示 API 文档
  app.get('/', (req, res) => {
    res.json({
      service: 'Deploy Website API',
      version: '1.0.0',
      server: SERVER_IP,
      baseUrl: BASE_URL,
      endpoints: {
        deploy: {
          method: 'POST',
          path: '/api/deploy',
          description: '部署 HTML 文件',
          body: {
            html: 'string (required) - HTML 内容',
            filename: 'string (optional) - 文件名（不含扩展名）'
          },
          example: `curl -X POST ${BASE_URL}/api/deploy \\
  -H "Content-Type: application/json" \\
  -d '{"html":"<h1>Hello</h1>","filename":"test"}'`
        },
        list: {
          method: 'GET',
          path: '/api/list',
          description: '列出所有已部署的文件',
          example: `curl ${BASE_URL}/api/list`
        },
        delete: {
          method: 'DELETE',
          path: '/api/delete/:filename',
          description: '删除已部署的文件',
          example: `curl -X DELETE ${BASE_URL}/api/delete/test.html`
        },
        files: {
          method: 'GET',
          path: '/files/:filename',
          description: '访问已部署的文件',
          example: `${BASE_URL}/files/test.html`
        }
      }
    });
  });

  // API: 部署 HTML
  app.post('/api/deploy', async (req, res) => {
    try {
      await ensureWebsiteDir();

      const { html, filename } = req.body;
      
      if (!html) {
        return res.status(400).json({
          success: false,
          error: 'HTML 内容不能为空'
        });
      }

      // 生成文件名
      const finalFilename = filename 
        ? `${filename}.html`
        : `${crypto.randomBytes(8).toString("hex")}.html`;

      const filePath = path.join(WEBSITE_DIR, finalFilename);
      
      // 写入文件
      await fs.writeFile(filePath, html, "utf-8");
      
      // 返回结果
      const url = `${BASE_URL}/files/${finalFilename}`;
      
      res.json({
        success: true,
        filename: finalFilename,
        url: url,
        message: '网站已成功部署',
        server: SERVER_IP,
      });
    } catch (error) {
      console.error('部署错误:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // API: 上传 HTML 文件（支持 multipart/form-data）
  app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
      await ensureWebsiteDir();

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: '请上传文件'
        });
      }

      // 读取上传的文件内容
      const htmlContent = await fs.readFile(req.file.path, 'utf-8');
      
      // 使用用户指定的文件名，或使用原始文件名
      const customFilename = req.body.filename;
      let finalFilename: string;
      
      if (customFilename) {
        finalFilename = customFilename.endsWith('.html') 
          ? customFilename 
          : `${customFilename}.html`;
      } else {
        const originalName = req.file.originalname;
        finalFilename = originalName.endsWith('.html') 
          ? originalName 
          : `${path.parse(originalName).name}.html`;
      }

      const filePath = path.join(WEBSITE_DIR, finalFilename);
      
      // 写入文件
      await fs.writeFile(filePath, htmlContent, 'utf-8');
      
      // 删除临时文件
      await fs.unlink(req.file.path).catch(() => {});
      
      // 返回结果
      const url = `${BASE_URL}/files/${finalFilename}`;
      
      res.json({
        success: true,
        filename: finalFilename,
        url: url,
        message: '文件已成功上传并部署',
        server: SERVER_IP,
      });
    } catch (error) {
      console.error('上传错误:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // API: 列出文件
  app.get('/api/list', async (req, res) => {
    try {
      await ensureWebsiteDir();

      const files = await fs.readdir(WEBSITE_DIR);
      const htmlFiles = files.filter(f => f.endsWith('.html'));
      
      const fileList = await Promise.all(
        htmlFiles.map(async (file) => {
          const filePath = path.join(WEBSITE_DIR, file);
          const stats = await fs.stat(filePath);
          return {
            filename: file,
            url: `${BASE_URL}/files/${file}`,
            size: stats.size,
            modified: stats.mtime.toISOString(),
          };
        })
      );

      res.json({
        success: true,
        count: fileList.length,
        files: fileList,
        server: SERVER_IP,
      });
    } catch (error) {
      console.error('列表错误:', error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // API: 删除文件
  app.delete('/api/delete/:filename', async (req, res) => {
    try {
      const { filename } = req.params;
      
      if (!filename) {
        return res.status(400).json({
          success: false,
          error: '文件名不能为空'
        });
      }

      const filePath = path.join(WEBSITE_DIR, filename);
      
      await fs.access(filePath);
      await fs.unlink(filePath);
      
      res.json({
        success: true,
        message: `文件 ${filename} 已删除`,
      });
    } catch (error) {
      res.status(404).json({
        success: false,
        error: `文件不存在: ${req.params.filename}`
      });
    }
  });

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      service: 'deploy-website-api',
      server: SERVER_IP,
      baseUrl: BASE_URL,
    });
  });

  await ensureWebsiteDir();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Deploy Website API 已启动`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 服务器地址: ${SERVER_IP}`);
    console.log(`🔗 API 地址:   ${BASE_URL}`);
    console.log(`📁 文件目录:   ${WEBSITE_DIR}`);
    console.log(`🌐 访问地址:   ${BASE_URL}/files/`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n📖 API 文档: ${BASE_URL}/`);
    console.log(`\n示例命令:`);
    console.log(`  部署: curl -X POST ${BASE_URL}/api/deploy -H "Content-Type: application/json" -d '{"html":"<h1>Hello</h1>"}'`);
    console.log(`  列表: curl ${BASE_URL}/api/list`);
    console.log(`\n`);
  });
}

// 启动
startServer().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});

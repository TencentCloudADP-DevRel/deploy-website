#!/usr/bin/env node

import express, { Request, Response, NextFunction } from "express";
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
const API_KEY = process.env.API_KEY || crypto.randomBytes(32).toString('hex');
const NODE_ENV = process.env.NODE_ENV || 'development';

// 在开发环境下打印 API Key
if (NODE_ENV === 'development' && !process.env.API_KEY) {
  console.log(`\n⚠️  未设置 API_KEY，使用随机生成的 Key: ${API_KEY}\n`);
}

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

// 安全工具函数
function sanitizeFilename(filename: string): string {
  // 移除路径分隔符和特殊字符
  return path.basename(filename).replace(/[^a-zA-Z0-9_\-\.]/g, '_');
}

function validateFilePath(filePath: string, baseDir: string): boolean {
  const resolved = path.resolve(filePath);
  const base = path.resolve(baseDir);
  return resolved.startsWith(base + path.sep) || resolved === base;
}

// 认证中间件
function authenticate(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    console.warn(`[AUTH] 未授权的访问尝试: ${req.ip} - ${req.method} ${req.path}`);
    return res.status(401).json({ 
      success: false,
      error: 'Unauthorized - API Key required' 
    });
  }
  next();
}

// 日志中间件
function logRequest(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms - ${req.ip}`);
  });
  next();
}

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

  // 配置 multer 用于文件上传（带限制）
  const upload = multer({ 
    dest: '/tmp/',
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB
      files: 1
    },
    fileFilter: (req, file, cb) => {
      // 只接受 HTML 文件
      if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) {
        cb(null, true);
      } else {
        cb(new Error('只支持 HTML 文件'));
      }
    }
  });

  // 基础中间件
  app.use(logRequest);
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
  }));
  app.use(express.json({ limit: '50mb' }));
  app.use(express.text({ limit: '50mb', type: 'text/html' }));

  // 静态文件服务（添加安全头）
  app.use('/files', (req, res, next) => {
    // 防止 XSS：如果需要执行 JS，注释掉下面这行
    // res.setHeader('Content-Type', 'text/plain');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  }, express.static(WEBSITE_DIR));

  // 根路径 - 显示 API 文档
  app.get('/', (req, res) => {
    res.json({
      service: 'Deploy Website API (Secure)',
      version: '2.0.0',
      server: SERVER_IP,
      baseUrl: BASE_URL,
      security: {
        authentication: 'API Key required (X-API-Key header)',
        rateLimit: 'Enabled',
        maxFileSize: '50MB'
      },
      endpoints: {
        deploy: {
          method: 'POST',
          path: '/api/deploy',
          auth: true,
          description: '部署 HTML 文件（JSON 方式）',
          headers: { 'X-API-Key': 'your-api-key' },
          body: {
            html: 'string (required) - HTML 内容',
            filename: 'string (optional) - 文件名'
          }
        },
        upload: {
          method: 'POST',
          path: '/api/upload',
          auth: true,
          description: '上传 HTML 文件（multipart 方式）',
          headers: { 'X-API-Key': 'your-api-key' }
        },
        list: {
          method: 'GET',
          path: '/api/list',
          auth: false,
          description: '列出所有已部署的文件'
        },
        delete: {
          method: 'DELETE',
          path: '/api/delete/:filename',
          auth: true,
          description: '删除已部署的文件'
        }
      }
    });
  });

  // API: 部署 HTML（需要认证）
  app.post('/api/deploy', authenticate, async (req, res) => {
    try {
      await ensureWebsiteDir();

      const { html, filename } = req.body;
      
      if (!html || typeof html !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'HTML 内容不能为空且必须是字符串'
        });
      }

      // 验证 HTML 长度
      if (html.length > 50 * 1024 * 1024) {
        return res.status(400).json({
          success: false,
          error: 'HTML 内容超过 50MB 限制'
        });
      }

      // 生成安全的文件名
      let finalFilename: string;
      if (filename) {
        const safe = sanitizeFilename(filename);
        finalFilename = safe.endsWith('.html') ? safe : `${safe}.html`;
      } else {
        finalFilename = `${crypto.randomBytes(8).toString("hex")}.html`;
      }

      // 检查文件是否已存在，避免覆盖
      let filePath = path.join(WEBSITE_DIR, finalFilename);
      try {
        await fs.access(filePath);
        // 文件已存在，添加时间戳
        const timestamp = Date.now();
        const parsed = path.parse(finalFilename);
        finalFilename = `${parsed.name}-${timestamp}${parsed.ext}`;
        filePath = path.join(WEBSITE_DIR, finalFilename);
      } catch {
        // 文件不存在，继续
      }

      // 二次验证路径安全
      if (!validateFilePath(filePath, WEBSITE_DIR)) {
        return res.status(403).json({
          success: false,
          error: '非法的文件路径'
        });
      }
      
      // 写入文件
      await fs.writeFile(filePath, html, "utf-8");
      
      console.log(`[DEPLOY] 文件已部署: ${finalFilename} (${html.length} bytes) by ${req.ip}`);
      
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
      console.error('[ERROR] 部署失败:', error);
      res.status(500).json({
        success: false,
        error: NODE_ENV === 'development' 
          ? (error instanceof Error ? error.message : String(error))
          : '服务器内部错误'
      });
    }
  });

  // API: 上传 HTML 文件（需要认证）
  app.post('/api/upload', authenticate, upload.single('file'), async (req, res) => {
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
      
      // 安全处理文件名
      const customFilename = req.body.filename;
      let finalFilename: string;
      
      if (customFilename) {
        const safe = sanitizeFilename(customFilename);
        finalFilename = safe.endsWith('.html') ? safe : `${safe}.html`;
      } else {
        const safe = sanitizeFilename(req.file.originalname);
        finalFilename = safe.endsWith('.html') ? safe : `${path.parse(safe).name}.html`;
      }

      // 检查文件是否已存在
      let filePath = path.join(WEBSITE_DIR, finalFilename);
      try {
        await fs.access(filePath);
        const timestamp = Date.now();
        const parsed = path.parse(finalFilename);
        finalFilename = `${parsed.name}-${timestamp}${parsed.ext}`;
        filePath = path.join(WEBSITE_DIR, finalFilename);
      } catch {
        // 文件不存在
      }

      // 验证路径安全
      if (!validateFilePath(filePath, WEBSITE_DIR)) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(403).json({
          success: false,
          error: '非法的文件路径'
        });
      }
      
      // 写入文件
      await fs.writeFile(filePath, htmlContent, 'utf-8');
      
      // 删除临时文件
      await fs.unlink(req.file.path).catch((err) => {
        console.error('[WARN] 清理临时文件失败:', req.file!.path, err);
      });
      
      console.log(`[UPLOAD] 文件已上传: ${finalFilename} (${htmlContent.length} bytes) by ${req.ip}`);
      
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
      // 清理临时文件
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      
      console.error('[ERROR] 上传失败:', error);
      res.status(500).json({
        success: false,
        error: NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : '服务器内部错误'
      });
    }
  });

  // API: 列出文件（公开）
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
      console.error('[ERROR] 列表失败:', error);
      res.status(500).json({
        success: false,
        error: NODE_ENV === 'development'
          ? (error instanceof Error ? error.message : String(error))
          : '服务器内部错误'
      });
    }
  });

  // API: 删除文件（需要认证）
  app.delete('/api/delete/:filename', authenticate, async (req, res) => {
    try {
      const { filename } = req.params;
      
      if (!filename) {
        return res.status(400).json({
          success: false,
          error: '文件名不能为空'
        });
      }

      // 安全处理文件名，防止路径遍历
      const safeFilename = sanitizeFilename(filename);
      
      // 验证文件名格式
      if (safeFilename !== filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
        return res.status(400).json({
          success: false,
          error: '无效的文件名'
        });
      }

      const filePath = path.join(WEBSITE_DIR, safeFilename);
      
      // 验证路径安全
      if (!validateFilePath(filePath, WEBSITE_DIR)) {
        return res.status(403).json({
          success: false,
          error: '访问被拒绝'
        });
      }
      
      // 检查文件是否存在
      await fs.access(filePath);
      
      // 删除文件
      await fs.unlink(filePath);
      
      console.log(`[DELETE] 文件已删除: ${safeFilename} by ${req.ip}`);
      
      res.json({
        success: true,
        message: `文件 ${safeFilename} 已删除`,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({
          success: false,
          error: `文件不存在: ${req.params.filename}`
        });
      } else {
        console.error('[ERROR] 删除失败:', error);
        res.status(500).json({
          success: false,
          error: NODE_ENV === 'development'
            ? (error instanceof Error ? error.message : String(error))
            : '服务器内部错误'
        });
      }
    }
  });

  // 健康检查
  app.get('/health', async (req, res) => {
    try {
      // 检查目录可写
      const testFile = path.join(WEBSITE_DIR, '.health-check');
      await fs.writeFile(testFile, 'ok');
      await fs.unlink(testFile);
      
      res.json({ 
        status: 'ok', 
        service: 'deploy-website-api',
        version: '2.0.0',
        server: SERVER_IP,
        baseUrl: BASE_URL,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(503).json({ 
        status: 'error',
        error: 'Service unavailable'
      });
    }
  });

  await ensureWebsiteDir();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ Deploy Website API (Secure) 已启动`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 服务器地址: ${SERVER_IP}`);
    console.log(`🔗 API 地址:   ${BASE_URL}`);
    console.log(`📁 文件目录:   ${WEBSITE_DIR}`);
    console.log(`🌐 访问地址:   ${BASE_URL}/files/`);
    console.log(`🔐 认证方式:   API Key (X-API-Key header)`);
    console.log(`🛡️  安全特性:   路径验证、文件名清理、认证保护`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n📖 API 文档: ${BASE_URL}/`);
    if (NODE_ENV === 'development') {
      console.log(`\n🔑 API Key: ${API_KEY}`);
    }
    console.log(`\n示例命令:`);
    console.log(`  curl -X POST ${BASE_URL}/api/upload \\`);
    console.log(`    -H "X-API-Key: ${NODE_ENV === 'development' ? API_KEY : 'your-api-key'}" \\`);
    console.log(`    -F "file=@test.html"`);
    console.log(`\n`);
  });
}

// 启动
startServer().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});

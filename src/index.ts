#!/usr/bin/env node

import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3006;
const WEBSITE_DIR = process.env.WEBSITE_DIR || "/var/www/website";
const SERVER_IP = "157.20.105.56";

// 确保网站目录存在
async function ensureWebsiteDir() {
  try {
    await fs.access(WEBSITE_DIR);
  } catch {
    await fs.mkdir(WEBSITE_DIR, { recursive: true });
  }
}

// 工具定义
const tools = [
  {
    name: "deploy_html",
    description: "部署 HTML 文件到服务器。接受 HTML 内容，生成唯一文件名并保存到服务器，返回访问 URL。",
    inputSchema: {
      type: "object",
      properties: {
        html: {
          type: "string",
          description: "要部署的 HTML 内容",
        },
        filename: {
          type: "string",
          description: "可选：指定文件名（不含扩展名），如果不提供则自动生成",
        },
      },
      required: ["html"],
    },
  },
  {
    name: "list_deployed",
    description: "列出所有已部署的网站文件",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "delete_deployed",
    description: "删除已部署的网站文件",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "要删除的文件名（包含 .html 扩展名）",
        },
      },
      required: ["filename"],
    },
  },
];

// 工具处理函数
async function handleToolCall(toolName: string, args: any) {
  await ensureWebsiteDir();

  switch (toolName) {
    case "deploy_html": {
      const { html, filename } = args as { html: string; filename?: string };
      
      if (!html) {
        throw new Error("HTML 内容不能为空");
      }

      // 生成文件名
      const finalFilename = filename 
        ? `${filename}.html`
        : `${crypto.randomBytes(8).toString("hex")}.html`;

      const filePath = path.join(WEBSITE_DIR, finalFilename);
      
      // 写入文件
      await fs.writeFile(filePath, html, "utf-8");
      
      // 返回访问 URL
      const url = `http://${SERVER_IP}/website/${finalFilename}`;
      
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              filename: finalFilename,
              url: url,
              message: `网站已成功部署`,
            }, null, 2),
          },
        ],
      };
    }

    case "list_deployed": {
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

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              count: fileList.length,
              files: fileList,
            }, null, 2),
          },
        ],
      };
    }

    case "delete_deployed": {
      const { filename } = args as { filename: string };
      
      if (!filename) {
        throw new Error("文件名不能为空");
      }

      const filePath = path.join(WEBSITE_DIR, filename);
      
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `文件 ${filename} 已删除`,
              }, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`文件不存在: ${filename}`);
      }
    }

    default:
      throw new Error(`未知工具: ${toolName}`);
  }
}

// 启动 HTTP 服务器
async function startServer() {
  const app = express();

  // CORS 配置
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));

  app.use(express.json({ limit: '50mb' }));

  // 健康检查
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'deploy-website-mcp' });
  });

  // 列出工具
  app.post('/mcp/list_tools', async (req, res) => {
    res.json({ tools });
  });

  // 调用工具
  app.post('/mcp/call_tool', async (req, res) => {
    try {
      const { name, arguments: args } = req.body;
      
      if (!name) {
        return res.status(400).json({ error: '工具名称不能为空' });
      }

      const result = await handleToolCall(name, args || {});
      res.json(result);
    } catch (error) {
      console.error('工具调用错误:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              error: errorMessage,
            }, null, 2),
          },
        ],
        isError: true,
      });
    }
  });

  // SSE 端点（StreamableHTTP 协议要求）
  app.get('/mcp/sse', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    // 发送初始连接事件
    res.write('event: open\n');
    res.write('data: {"type":"connection","status":"established"}\n\n');
    
    // 保持连接
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 30000);
    
    // 连接关闭时清理
    req.on('close', () => {
      clearInterval(keepAlive);
      res.end();
    });
  });

  // 通用 MCP 端点（符合 StreamableHTTP 协议规范）
  app.post('/mcp', async (req, res) => {
    try {
      const { jsonrpc, id, method, params } = req.body;
      
      // 初始化握手（StreamableHTTP 协议要求）
      if (method === 'initialize') {
        res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'deploy-website-mcp',
              version: '1.0.0',
            },
          },
        });
        return;
      }
      
      // 列出工具
      if (method === 'tools/list') {
        res.json({
          jsonrpc: '2.0',
          id: id,
          result: {
            tools: tools,
          },
        });
        return;
      }
      
      // 调用工具
      if (method === 'tools/call') {
        const { name, arguments: args } = params;
        const result = await handleToolCall(name, args || {});
        res.json({
          jsonrpc: '2.0',
          id: id,
          result: result,
        });
        return;
      }
      
      // 不支持的方法
      res.status(400).json({
        jsonrpc: '2.0',
        id: id,
        error: {
          code: -32601,
          message: `不支持的方法: ${method}`,
        },
      });
    } catch (error) {
      console.error('MCP 请求处理错误:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        jsonrpc: '2.0',
        id: req.body.id,
        error: {
          code: -32603,
          message: errorMessage,
        },
      });
    }
  });

  app.listen(PORT, () => {
    console.log(`✅ Deploy Website MCP Server 运行在 http://0.0.0.0:${PORT}`);
    console.log(`📁 网站目录: ${WEBSITE_DIR}`);
    console.log(`🌐 访问地址: http://${SERVER_IP}/website/`);
    console.log(`\n可用端点:`);
    console.log(`  - GET  /mcp/sse         - SSE 连接（StreamableHTTP）`);
    console.log(`  - POST /mcp             - 标准 MCP 端点（JSON-RPC 2.0）`);
    console.log(`  - POST /mcp/list_tools  - 列出所有工具`);
    console.log(`  - POST /mcp/call_tool   - 调用工具`);
    console.log(`  - GET  /health          - 健康检查`);
  });
}

// 启动
startServer().catch((error) => {
  console.error("服务器启动失败:", error);
  process.exit(1);
});

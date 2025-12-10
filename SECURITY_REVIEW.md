# 安全审查报告 - Deploy Website API

## 🔴 严重安全问题（必须修复）

### 1. 路径遍历漏洞（Path Traversal）
**位置**：`/api/delete/:filename` (line 236-262)

**问题**：
```typescript
const filePath = path.join(WEBSITE_DIR, filename);
```
攻击者可以使用 `../../../etc/passwd` 删除系统文件。

**修复**：
```typescript
// 验证文件名，不允许包含路径分隔符
if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
  return res.status(400).json({
    success: false,
    error: '无效的文件名'
  });
}

// 使用 path.basename 强制只取文件名
const safeFilename = path.basename(filename);
const filePath = path.join(WEBSITE_DIR, safeFilename);

// 验证最终路径是否在 WEBSITE_DIR 内
const resolvedPath = path.resolve(filePath);
const resolvedDir = path.resolve(WEBSITE_DIR);
if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
  return res.status(403).json({
    success: false,
    error: '访问被拒绝'
  });
}
```

### 2. XSS 攻击风险
**位置**：`/api/deploy` 和 `/api/upload`

**问题**：
- 没有验证 HTML 内容
- 恶意用户可以上传包含 `<script>` 的文件
- 静态文件服务直接返回，浏览器会执行 JS

**修复方案选择**：
1. **如果需要执行 JS**：添加 CSP 头限制
2. **如果不需要执行 JS**：
   ```typescript
   app.use('/files', (req, res, next) => {
     res.setHeader('Content-Type', 'text/plain'); // 强制以文本显示
     next();
   });
   ```

### 3. 无认证/鉴权
**位置**：所有 API 端点

**问题**：
任何人都可以上传、删除文件。

**修复**（建议使用 API Key）：
```typescript
const API_KEY = process.env.API_KEY || crypto.randomBytes(32).toString('hex');

// 认证中间件
function authenticate(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-api-key'];
  if (key !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// 应用到敏感接口
app.post('/api/deploy', authenticate, async (req, res) => { ... });
app.post('/api/upload', authenticate, upload.single('file'), async (req, res) => { ... });
app.delete('/api/delete/:filename', authenticate, async (req, res) => { ... });
```

### 4. 文件大小限制不一致
**位置**：multer 配置 (line 48)

**问题**：
```typescript
const upload = multer({ dest: '/tmp/' }); // 没有限制
```

**修复**：
```typescript
const upload = multer({ 
  dest: '/tmp/',
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
    files: 1
  }
});
```

---

## 🟡 中等安全问题（强烈建议修复）

### 5. 缺少请求频率限制
**影响**：DDoS 攻击

**修复**：
```bash
npm install express-rate-limit
```

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 100, // 最多 100 个请求
  message: { error: '请求过于频繁，请稍后再试' }
});

app.use('/api/', limiter);
```

### 6. 文件名冲突
**问题**：新文件直接覆盖旧文件，无警告

**修复**：
```typescript
// 检查文件是否存在
try {
  await fs.access(filePath);
  // 文件已存在，添加时间戳
  const timestamp = Date.now();
  finalFilename = `${filename}-${timestamp}.html`;
  filePath = path.join(WEBSITE_DIR, finalFilename);
} catch {
  // 文件不存在，继续
}
```

### 7. 错误信息泄露
**问题**：
```typescript
error: error instanceof Error ? error.message : String(error)
```

**修复**：
```typescript
// 生产环境不返回详细错误
const isDev = process.env.NODE_ENV === 'development';
res.status(500).json({
  success: false,
  error: isDev ? error.message : '服务器内部错误'
});
```

### 8. 临时文件清理
**问题**：
```typescript
await fs.unlink(req.file.path).catch(() => {}); // 静默失败
```

**修复**：
```typescript
// 添加日志
await fs.unlink(req.file.path).catch((err) => {
  console.error('清理临时文件失败:', req.file.path, err);
});

// 或使用定时任务清理
setInterval(async () => {
  // 清理超过 1 小时的临时文件
}, 60 * 60 * 1000);
```

---

## 🔵 功能改进建议

### 9. 日志记录
```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// 在每个操作中记录
logger.info('文件上传', {
  filename: finalFilename,
  size: htmlContent.length,
  ip: req.ip,
  timestamp: new Date().toISOString()
});
```

### 10. 健康检查增强
```typescript
app.get('/health', async (req, res) => {
  try {
    // 检查目录可写
    const testFile = path.join(WEBSITE_DIR, '.health-check');
    await fs.writeFile(testFile, 'ok');
    await fs.unlink(testFile);
    
    // 检查磁盘空间
    const { size, free } = await checkDiskSpace(WEBSITE_DIR);
    const freePercent = (free / size) * 100;
    
    res.json({ 
      status: freePercent > 10 ? 'ok' : 'warning',
      diskFree: `${(free / 1024 / 1024 / 1024).toFixed(2)} GB`,
      diskFreePercent: `${freePercent.toFixed(2)}%`
    });
  } catch (error) {
    res.status(503).json({ status: 'error', message: 'Service unavailable' });
  }
});
```

### 11. 监控指标
```typescript
import prometheus from 'prom-client';

const register = new prometheus.Registry();
const uploadCounter = new prometheus.Counter({
  name: 'uploads_total',
  help: 'Total number of uploads',
  registers: [register]
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});
```

---

## 📋 ADP 平台集成检查清单

- [ ] **安全认证**：API Key / OAuth2
- [ ] **访问控制**：CORS 白名单
- [ ] **速率限制**：防止滥用
- [ ] **输入验证**：所有用户输入
- [ ] **路径安全**：防止路径遍历
- [ ] **文件验证**：类型、大小、内容
- [ ] **日志记录**：完整的审计日志
- [ ] **监控告警**：Prometheus + Grafana
- [ ] **健康检查**：K8s liveness/readiness
- [ ] **错误处理**：不泄露敏感信息
- [ ] **HTTPS 支持**：生产环境必须
- [ ] **备份策略**：文件定期备份
- [ ] **配额管理**：每用户文件数/大小限制

---

## 🚀 快速测试漏洞

### 测试路径遍历：
```bash
curl -X DELETE http://157.20.105.56:3007/api/delete/../../../etc/passwd
```

### 测试 XSS：
```bash
curl -X POST http://157.20.105.56:3007/api/deploy \
  -H "Content-Type: application/json" \
  -d '{"html":"<script>alert(document.cookie)</script>","filename":"xss-test"}'

# 然后访问：http://157.20.105.56:3007/files/xss-test.html
```

### 测试无认证上传：
```bash
# 任何人都能上传
curl -X POST http://157.20.105.56:3007/api/upload \
  -F "file=@malicious.html"
```

---

## 优先级建议

**立即修复**（阻断上线）：
1. 路径遍历漏洞
2. 添加认证机制
3. XSS 防护

**尽快修复**（1周内）：
4. 请求频率限制
5. 文件大小限制
6. 错误信息处理

**逐步优化**（2-4周）：
7. 日志和监控
8. 健康检查
9. 配额管理

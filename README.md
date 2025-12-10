# Deploy Website API

一个极简的 HTML 部署 API 服务。**不需要 MCP，直接用 HTTP 调用！**

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 编译
npm run build

# 启动服务
npm start
```

启动后会显示：
```
✅ Deploy Website API 已启动
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 服务器地址: 10.64.120.37
🔗 API 地址:   http://10.64.120.37:3007
📁 文件目录:   /path/to/public
🌐 访问地址:   http://10.64.120.37:3007/files/
```

## 📖 API 使用

### 1. 部署 HTML

```bash
curl -X POST http://10.64.120.37:3007/api/deploy \
  -H "Content-Type: application/json" \
  -d '{
    "html": "<!DOCTYPE html><html><body><h1>Hello World</h1></body></html>",
    "filename": "my-page"
  }'
```

**响应：**
```json
{
  "success": true,
  "filename": "my-page.html",
  "url": "http://10.64.120.37:3007/files/my-page.html",
  "message": "网站已成功部署",
  "server": "10.64.120.37"
}
```

### 2. 列出所有文件

```bash
curl http://10.64.120.37:3007/api/list
```

**响应：**
```json
{
  "success": true,
  "count": 2,
  "files": [
    {
      "filename": "my-page.html",
      "url": "http://10.64.120.37:3007/files/my-page.html",
      "size": 1024,
      "modified": "2025-12-10T08:30:00.000Z"
    }
  ],
  "server": "10.64.120.37"
}
```

### 3. 删除文件

```bash
curl -X DELETE http://10.64.120.37:3007/api/delete/my-page.html
```

**响应：**
```json
{
  "success": true,
  "message": "文件 my-page.html 已删除"
}
```

### 4. 访问文件

直接在浏览器打开：
```
http://10.64.120.37:3007/files/my-page.html
```

## 🐍 Python 客户端示例

```python
import requests

# 部署 HTML
html_content = """
<!DOCTYPE html>
<html>
<body>
    <h1>Hello from Python!</h1>
</body>
</html>
"""

response = requests.post('http://10.64.120.37:3007/api/deploy', json={
    'html': html_content,
    'filename': 'python-test'
})

result = response.json()
print(f"部署成功！访问地址: {result['url']}")
```

## 🔧 Node.js 客户端示例

```javascript
const axios = require('axios');

async function deployHTML(html, filename) {
  const response = await axios.post('http://10.64.120.37:3007/api/deploy', {
    html,
    filename
  });
  
  console.log('部署成功！', response.data.url);
  return response.data;
}

deployHTML('<h1>Hello from Node.js!</h1>', 'nodejs-test');
```

## 🌐 部署到服务器

### 使用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/index.js --name deploy-api

# 保存配置
pm2 save
pm2 startup
```

### 使用 systemd

```bash
# 创建服务文件
sudo nano /etc/systemd/system/deploy-api.service

# 内容：
[Unit]
Description=Deploy Website API
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/deploy-website
ExecStart=/usr/bin/node /path/to/deploy-website/dist/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target

# 启动服务
sudo systemctl enable deploy-api
sudo systemctl start deploy-api
```

## ⚙️ 环境变量

```bash
# 端口（默认 3007）
PORT=3007

# 文件存储目录（默认 ./public）
WEBSITE_DIR=/var/www/website
```

## 📄 License

ISC

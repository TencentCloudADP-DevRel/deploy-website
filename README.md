# Deploy Website MCP Server

MCP 服务器，用于将 HTML 内容部署到服务器并提供公开访问。

## 功能

- 📤 **deploy_html**: 部署 HTML 文件到服务器
- 📋 **list_deployed**: 列出所有已部署的文件
- 🗑️ **delete_deployed**: 删除已部署的文件

## 安装

```bash
npm install
npm run build
```

## 本地测试

```bash
npm run start:http
```

服务将运行在 `http://localhost:3006`

## 服务器部署

### 1. 上传到服务器

```bash
scp -r /Users/pro/CodeBuddy/hunyuan3d/deploy-website root@157.20.105.56:/root/
```

### 2. 服务器配置

SSH 登录服务器：

```bash
ssh root@157.20.105.56
cd /root/deploy-website
npm install
npm run build
```

### 3. 创建网站目录

```bash
mkdir -p /var/www/website
chmod 755 /var/www/website
```

### 4. 配置 Nginx

编辑 `/etc/nginx/sites-available/website.conf`:

```nginx
server {
    listen 80;
    server_name 157.20.105.56;

    # 静态网站目录
    location /website/ {
        alias /var/www/website/;
        autoindex on;
        add_header Access-Control-Allow-Origin *;
    }

    # MCP 服务代理（可选，用于远程访问）
    location /deploy-mcp/ {
        proxy_pass http://localhost:3006/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
ln -s /etc/nginx/sites-available/website.conf /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### 5. 使用 PM2 管理进程

```bash
npm install -g pm2

# 启动服务
pm2 start dist/index.js --name deploy-website-mcp -- --http

# 设置开机自启
pm2 startup
pm2 save

# 查看日志
pm2 logs deploy-website-mcp
```

## 使用方法

### 部署网站

```javascript
{
  "name": "deploy_html",
  "arguments": {
    "html": "<html>...</html>",
    "filename": "my-site"  // 可选
  }
}
```

返回：
```json
{
  "success": true,
  "filename": "my-site.html",
  "url": "http://157.20.105.56/website/my-site.html"
}
```

### 列出已部署的文件

```javascript
{
  "name": "list_deployed",
  "arguments": {}
}
```

### 删除文件

```javascript
{
  "name": "delete_deployed",
  "arguments": {
    "filename": "my-site.html"
  }
}
```

## MCP 客户端配置

在 CodeBuddy 的 MCP 配置中添加：

```json
{
  "mcpServers": {
    "deploy-website": {
      "url": "http://157.20.105.56:3006/mcp",
      "transport": "streamablehttp"
    }
  }
}
```

## 环境变量

- `PORT`: 服务端口（默认 3006）
- `WEBSITE_DIR`: 网站文件存储目录（默认 /var/www/website）

## 安全建议

1. 配置防火墙，限制 3006 端口访问
2. 使用 Nginx 反向代理并添加身份验证
3. 定期清理未使用的文件
4. 限制上传文件大小

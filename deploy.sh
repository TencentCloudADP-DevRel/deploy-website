#!/bin/bash

# 部署脚本 - 将项目部署到服务器

SERVER="root@157.20.105.56"
REMOTE_DIR="/root/deploy-website"

echo "📦 正在上传文件到服务器..."
scp -r ./* $SERVER:$REMOTE_DIR/

echo "🔧 在服务器上安装依赖和构建..."
ssh $SERVER << 'ENDSSH'
cd /root/deploy-website
npm install
npm run build

# 创建网站目录
mkdir -p /var/www/website
chmod 755 /var/www/website

# 使用 PM2 启动服务
pm2 delete deploy-website-mcp 2>/dev/null || true
pm2 start dist/index.js --name deploy-website-mcp
pm2 save

echo "✅ 部署完成!"
echo "🌐 服务运行在: http://157.20.105.56:3006"
echo "📁 网站目录: /var/www/website"
echo "🔍 查看日志: pm2 logs deploy-website-mcp"
ENDSSH

echo ""
echo "✨ 部署成功！"
echo ""
echo "下一步配置 Nginx:"
echo "1. 编辑 /etc/nginx/sites-available/website.conf"
echo "2. 添加配置（参考 README.md）"
echo "3. 执行: ln -s /etc/nginx/sites-available/website.conf /etc/nginx/sites-enabled/"
echo "4. 执行: nginx -t && systemctl reload nginx"

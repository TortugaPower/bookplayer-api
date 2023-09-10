#!/bin/bash
# dependencies
sudo yum update
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
nvm install 16.20.0
nvm use 16
npm install -g pm2
npm install -g yarn
sudo amazon-linux-extras install nginx1
# Install
sudo chown ec2-user:ec2-user /home/ec2-user/bookplayer-api -R
cd /home/ec2-user/bookplayer-api
sudo cp nginx.config /etc/nginx/conf.d/api.conf
yarn install
npm run setup_env
# start again
sudo systemctl enable nginx
sudo systemctl restart nginx
pm2 stop all
pm2 delete all
pm2 startup
sudo env PATH=$PATH:/home/ec2-user/.nvm/versions/node/v16.20.0/bin /home/ec2-user/.nvm/versions/node/v16.20.0/lib/node_modules/pm2/bin/pm2 startup systemd -u ec2-user --hp /home/ec2-user
NODE_ENV=production pm2 start --name api -i max dist/main.js
pm2 save
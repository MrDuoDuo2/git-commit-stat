#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

// 解析当前版本
const currentVersion = packageJson.version;
const [major, minor, patch] = currentVersion.split('.').map(Number);

// 递增 patch 版本号
const newVersion = `${major}.${minor}.${patch + 1}`;

// 更新 package.json
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

console.log(`版本号已更新: ${currentVersion} -> ${newVersion}`);

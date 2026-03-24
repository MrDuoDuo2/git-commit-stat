# Git Commit Stats

VS Code 插件 - 统计当前项目中指定用户的 Git 提交量。

## 功能

- **按作者用户名统计**: 输入用户名查看该作者的提交统计
- **按邮箱统计**: 输入邮箱查看该作者的提交统计  
- **显示所有作者**: 列出项目所有贡献者的提交统计排行

## 统计信息

- 总提交数
- 新增代码行数
- 删除代码行数
- 首次提交日期
- 最近提交日期

## 使用方法

1. 打开一个 Git 项目
2. 按 `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`) 打开命令面板
3. 输入 `Git Commit Stats` 选择以下命令之一：
   - `Git Commit Stats: 按作者统计提交量`
   - `Git Commit Stats: 按邮箱统计提交量`
   - `Git Commit Stats: 显示所有作者提交统计`

## 开发

```bash
# 安装依赖
npm install

# 编译
npm run compile

# 监听模式
npm run watch
```

## 调试

1. 在 VS Code 中打开此项目
2. 按 F5 启动调试
3. 在新打开的 Extension Development Host 窗口中测试插件

## 打包

```bash
npm install -g @vscode/vsce
vsce package
```

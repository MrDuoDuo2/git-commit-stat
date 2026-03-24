import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { StatsWebviewPanel, StatsResult } from './webviewPanel';
import { StatsSidebarProvider } from './sidebarProvider';
import { DailyStatsPanel } from './dailyStatsPanel';
import { StatsStatusBar } from './statusBar';

const execAsync = promisify(exec);

interface CommitStats {
    author: string;
    email: string;
    count: number;
}

async function getWorkspaceRoot(): Promise<string | undefined> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return undefined;
    }
    return workspaceFolders[0].uri.fsPath;
}

async function isGitRepo(cwd: string): Promise<boolean> {
    try {
        await execAsync('git rev-parse --is-inside-work-tree', { cwd });
        return true;
    } catch {
        return false;
    }
}

async function getCommitCountByAuthor(cwd: string, author: string): Promise<number> {
    try {
        const { stdout } = await execAsync(
            `git log --author="${author}" --oneline | wc -l`,
            { cwd }
        );
        return parseInt(stdout.trim(), 10) || 0;
    } catch (error) {
        console.error('Error getting commit count:', error);
        return 0;
    }
}

async function getCommitCountByEmail(cwd: string, email: string): Promise<number> {
    try {
        const { stdout } = await execAsync(
            `git log --author="<${email}>" --oneline | wc -l`,
            { cwd }
        );
        return parseInt(stdout.trim(), 10) || 0;
    } catch (error) {
        console.error('Error getting commit count:', error);
        return 0;
    }
}

async function getAllAuthorsStats(cwd: string): Promise<CommitStats[]> {
    try {
        const { stdout } = await execAsync(
            `git shortlog -sne --all`,
            { cwd }
        );
        
        const stats: CommitStats[] = [];
        const lines = stdout.trim().split('\n').filter((line: string) => line.trim());
        
        for (const line of lines) {
            const match = line.match(/^\s*(\d+)\s+(.+?)\s+<(.+)>$/);
            if (match) {
                stats.push({
                    count: parseInt(match[1], 10),
                    author: match[2].trim(),
                    email: match[3].trim()
                });
            }
        }
        
        return stats.sort((a, b) => b.count - a.count);
    } catch (error) {
        console.error('Error getting all authors stats:', error);
        return [];
    }
}

async function getDetailedStats(cwd: string, author: string): Promise<string> {
    try {
        const [totalResult, insertionsResult, deletionsResult, firstCommit, lastCommit] = await Promise.all([
            execAsync(`git log --author="${author}" --oneline | wc -l`, { cwd }),
            execAsync(`git log --author="${author}" --pretty=tformat: --numstat | awk '{ add += $1 } END { print add }'`, { cwd }),
            execAsync(`git log --author="${author}" --pretty=tformat: --numstat | awk '{ del += $2 } END { print del }'`, { cwd }),
            execAsync(`git log --author="${author}" --reverse --format="%ad" --date=short | head -1`, { cwd }),
            execAsync(`git log --author="${author}" --format="%ad" --date=short | head -1`, { cwd })
        ]);

        const total = parseInt(totalResult.stdout.trim(), 10) || 0;
        const insertions = parseInt(insertionsResult.stdout.trim(), 10) || 0;
        const deletions = parseInt(deletionsResult.stdout.trim(), 10) || 0;
        const first = firstCommit.stdout.trim() || '无';
        const last = lastCommit.stdout.trim() || '无';

        return `
📊 提交统计详情
━━━━━━━━━━━━━━━━━━━━
👤 作者: ${author}
📝 总提交数: ${total}
➕ 新增行数: ${insertions.toLocaleString()}
➖ 删除行数: ${deletions.toLocaleString()}
📅 首次提交: ${first}
📅 最近提交: ${last}
━━━━━━━━━━━━━━━━━━━━`;
    } catch (error) {
        console.error('Error getting detailed stats:', error);
        return '获取详细统计失败';
    }
}

async function getStatsResult(cwd: string, username: string, email: string): Promise<StatsResult | null> {
    try {
        const author = username || email;
        const searchPattern = email ? `<${email}>` : username;
        
        const [totalResult, insertionsResult, deletionsResult, firstCommit, lastCommit, authorInfo] = await Promise.all([
            execAsync(`git log --author="${searchPattern}" --oneline | wc -l`, { cwd }),
            execAsync(`git log --author="${searchPattern}" --pretty=tformat: --numstat | awk '{ add += $1 } END { print add }'`, { cwd }),
            execAsync(`git log --author="${searchPattern}" --pretty=tformat: --numstat | awk '{ del += $2 } END { print del }'`, { cwd }),
            execAsync(`git log --author="${searchPattern}" --reverse --format="%ad" --date=short | head -1`, { cwd }),
            execAsync(`git log --author="${searchPattern}" --format="%ad" --date=short | head -1`, { cwd }),
            execAsync(`git log --author="${searchPattern}" --format="%an <%ae>" | head -1`, { cwd })
        ]);

        const total = parseInt(totalResult.stdout.trim(), 10) || 0;
        
        if (total === 0) {
            return null;
        }

        const insertions = parseInt(insertionsResult.stdout.trim(), 10) || 0;
        const deletions = parseInt(deletionsResult.stdout.trim(), 10) || 0;
        const first = firstCommit.stdout.trim() || '';
        const last = lastCommit.stdout.trim() || '';
        
        const authorMatch = authorInfo.stdout.trim().match(/^(.+?)\s*<(.+)>$/);
        const finalAuthor = authorMatch ? authorMatch[1].trim() : author;
        const finalEmail = authorMatch ? authorMatch[2].trim() : (email || '');

        return {
            author: finalAuthor,
            email: finalEmail,
            totalCommits: total,
            insertions,
            deletions,
            firstCommit: first,
            lastCommit: last
        };
    } catch (error) {
        console.error('Error getting stats result:', error);
        return null;
    }
}

export function activate(context: vscode.ExtensionContext) {
    
    const sidebarProvider = new StatsSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(StatsSidebarProvider.viewType, sidebarProvider)
    );

    const dailyStatsPanel = new DailyStatsPanel(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(DailyStatsPanel.viewType, dailyStatsPanel)
    );

    const statsStatusBar = new StatsStatusBar(context);
    
    const configureStatusBar = vscode.commands.registerCommand('git-commit-stats.configureStatusBar', async () => {
        await statsStatusBar.configure();
    });

    const countByAuthor = vscode.commands.registerCommand('git-commit-stats.countByAuthor', async () => {
        const cwd = await getWorkspaceRoot();
        if (!cwd) return;

        if (!(await isGitRepo(cwd))) {
            vscode.window.showErrorMessage('当前目录不是 Git 仓库');
            return;
        }

        const author = await vscode.window.showInputBox({
            prompt: '请输入作者用户名',
            placeHolder: '例如: John Doe'
        });

        if (!author) return;

        const stats = await getDetailedStats(cwd, author);
        
        const outputChannel = vscode.window.createOutputChannel('Git Commit Stats');
        outputChannel.clear();
        outputChannel.appendLine(stats);
        outputChannel.show();
    });

    const countByEmail = vscode.commands.registerCommand('git-commit-stats.countByEmail', async () => {
        const cwd = await getWorkspaceRoot();
        if (!cwd) return;

        if (!(await isGitRepo(cwd))) {
            vscode.window.showErrorMessage('当前目录不是 Git 仓库');
            return;
        }

        const email = await vscode.window.showInputBox({
            prompt: '请输入作者邮箱',
            placeHolder: '例如: john@example.com'
        });

        if (!email) return;

        const count = await getCommitCountByEmail(cwd, email);
        const stats = await getDetailedStats(cwd, email);
        
        const outputChannel = vscode.window.createOutputChannel('Git Commit Stats');
        outputChannel.clear();
        outputChannel.appendLine(stats);
        outputChannel.show();
    });

    const showAllAuthors = vscode.commands.registerCommand('git-commit-stats.showAllAuthors', async () => {
        const cwd = await getWorkspaceRoot();
        if (!cwd) return;

        if (!(await isGitRepo(cwd))) {
            vscode.window.showErrorMessage('当前目录不是 Git 仓库');
            return;
        }

        const stats = await getAllAuthorsStats(cwd);
        
        if (stats.length === 0) {
            vscode.window.showInformationMessage('未找到任何提交记录');
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('Git Commit Stats');
        outputChannel.clear();
        outputChannel.appendLine('📊 所有作者提交统计');
        outputChannel.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        outputChannel.appendLine('');
        
        let totalCommits = 0;
        for (const stat of stats) {
            totalCommits += stat.count;
            const bar = '█'.repeat(Math.min(Math.ceil(stat.count / 10), 30));
            outputChannel.appendLine(`${stat.author.padEnd(25)} ${String(stat.count).padStart(6)} ${bar}`);
            outputChannel.appendLine(`  └─ ${stat.email}`);
        }
        
        outputChannel.appendLine('');
        outputChannel.appendLine('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        outputChannel.appendLine(`总计: ${stats.length} 位作者, ${totalCommits} 次提交`);
        outputChannel.show();

        const selected = await vscode.window.showQuickPick(
            stats.map(s => ({
                label: `${s.author} (${s.count} commits)`,
                description: s.email,
                author: s.author
            })),
            { placeHolder: '选择一个作者查看详情' }
        );

        if (selected) {
            const detailedStats = await getDetailedStats(cwd, selected.author);
            outputChannel.appendLine('');
            outputChannel.appendLine(detailedStats);
        }
    });

    const openStatsPanel = vscode.commands.registerCommand('git-commit-stats.openPanel', async () => {
        const cwd = await getWorkspaceRoot();
        if (!cwd) return;

        if (!(await isGitRepo(cwd))) {
            vscode.window.showErrorMessage('当前目录不是 Git 仓库');
            return;
        }

        StatsWebviewPanel.createOrShow(
            context.extensionUri,
            async (username: string, email: string) => {
                return await getStatsResult(cwd, username, email);
            }
        );
    });

    const openDailyPanel = vscode.commands.registerCommand('git-commit-stats.openDailyPanel', async () => {
        await vscode.commands.executeCommand('gitCommitStats.dailyPanel.focus');
    });

    context.subscriptions.push(countByAuthor, countByEmail, showAllAuthors, openStatsPanel, openDailyPanel, configureStatusBar);
}

export function deactivate() {}

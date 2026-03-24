import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class StatsStatusBar {
    private _statusBarItem: vscode.StatusBarItem;
    private _username: string = '';
    private _email: string = '';
    private _color: string = '#39d353';
    private _context: vscode.ExtensionContext;
    private _updateInterval: NodeJS.Timeout | undefined;

    constructor(context: vscode.ExtensionContext) {
        this._context = context;
        
        this._statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this._statusBarItem.command = 'git-commit-stats.configureStatusBar';
        this._statusBarItem.tooltip = '点击配置 Git 统计';
        
        const saved = context.globalState.get<{username: string, email: string, color: string}>('statusBarConfig');
        if (saved) {
            this._username = saved.username || '';
            this._email = saved.email || '';
            this._color = saved.color || '#39d353';
        }

        this._statusBarItem.show();
        context.subscriptions.push(this._statusBarItem);
        
        this._initWithGitConfig();
        
        this._updateInterval = setInterval(() => this._refresh(), 60000);
        context.subscriptions.push({ dispose: () => {
            if (this._updateInterval) clearInterval(this._updateInterval);
        }});
    }

    public async configure() {
        const username = await vscode.window.showInputBox({
            prompt: '输入用户名 (可留空)',
            value: this._username,
            placeHolder: '例如: John Doe'
        });

        if (username === undefined) return;

        const email = await vscode.window.showInputBox({
            prompt: '输入邮箱 (可留空)',
            value: this._email,
            placeHolder: '例如: john@example.com'
        });

        if (email === undefined) return;

        const colorOptions = [
            { label: '$(circle-filled) 绿色', color: '#39d353' },
            { label: '$(circle-filled) 蓝色', color: '#58a6ff' },
            { label: '$(circle-filled) 紫色', color: '#bc8cff' },
            { label: '$(circle-filled) 橙色', color: '#f0883e' },
            { label: '$(circle-filled) 红色', color: '#f85149' },
            { label: '$(circle-filled) 青色', color: '#39c5cf' },
            { label: '$(circle-filled) 黄色', color: '#d9d93e' },
        ];

        const colorPick = await vscode.window.showQuickPick(colorOptions, {
            placeHolder: '选择显示颜色'
        });

        if (colorPick) {
            this._color = colorPick.color;
        }

        this._username = username;
        this._email = email;
        
        await this._context.globalState.update('statusBarConfig', {
            username: this._username,
            email: this._email,
            color: this._color
        });

        this._refresh();
    }

    private async _initWithGitConfig() {
        if (!this._username && !this._email) {
            const cwd = this._getWorkspaceRoot();
            if (cwd) {
                try {
                    const [nameResult, emailResult] = await Promise.all([
                        execAsync('git config user.name', { cwd }),
                        execAsync('git config user.email', { cwd })
                    ]);
                    this._username = nameResult.stdout.trim();
                    this._email = emailResult.stdout.trim();
                } catch (error) {
                    console.error('Error getting git config:', error);
                }
            }
        }
        this._refresh();
    }

    private async _refresh() {
        const cwd = this._getWorkspaceRoot();
        if (!cwd) {
            this._statusBarItem.text = '$(graph) Git Stats: 无工作区';
            return;
        }

        if (!this._username && !this._email) {
            this._statusBarItem.text = '$(graph) Git Stats: 点击配置';
            return;
        }

        const stats = await this._getTodayStats(cwd);
        
        const commitText = stats.commits > 0 
            ? `$(git-commit) ${stats.commits}` 
            : `$(git-commit) 0`;
        
        const linesText = stats.insertions > 0 || stats.deletions > 0
            ? ` $(diff-added) +${stats.insertions} $(diff-removed) -${stats.deletions}`
            : '';

        this._statusBarItem.text = `$(graph) 今日: ${commitText}${linesText}`;
        this._statusBarItem.color = this._color;
        
        const author = this._username || this._email;
        this._statusBarItem.tooltip = `${author} 今日统计\n提交: ${stats.commits}\n新增: +${stats.insertions}\n删除: -${stats.deletions}\n\n点击配置`;
    }

    private _getWorkspaceRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    private async _getTodayStats(cwd: string): Promise<{commits: number, insertions: number, deletions: number}> {
        const searchPattern = this._email ? `<${this._email}>` : this._username;
        if (!searchPattern) {
            return { commits: 0, insertions: 0, deletions: 0 };
        }

        try {
            const [commitsResult, statsResult] = await Promise.all([
                execAsync(`git log --author="${searchPattern}" --since="midnight" --oneline | wc -l`, { cwd }),
                execAsync(`git log --author="${searchPattern}" --since="midnight" --pretty=tformat: --numstat | awk '{ add += $1; del += $2 } END { print add "," del }'`, { cwd })
            ]);

            const commits = parseInt(commitsResult.stdout.trim(), 10) || 0;
            const [ins, del] = statsResult.stdout.trim().split(',').map(s => parseInt(s, 10) || 0);

            return { commits, insertions: ins, deletions: del };
        } catch (error) {
            console.error('Error getting today stats:', error);
            return { commits: 0, insertions: 0, deletions: 0 };
        }
    }
}

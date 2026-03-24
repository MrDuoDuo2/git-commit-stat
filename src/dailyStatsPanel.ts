import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DailyStats {
    date: string;
    commits: number;
    insertions: number;
    deletions: number;
}

export class DailyStatsPanel implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gitCommitStats.dailyPanel';
    private _view?: vscode.WebviewView;
    private _username: string = '';
    private _email: string = '';
    private _color: string = '#39d353';

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public setAuthor(username: string, email: string) {
        this._username = username;
        this._email = email;
        this._refreshStats();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'setColor':
                    this._color = message.color;
                    break;
                case 'setAuthor':
                    this._username = message.username;
                    this._email = message.email;
                    this._refreshStats();
                    break;
                case 'refresh':
                    this._refreshStats();
                    break;
            }
        });

        this._initWithGitConfig();
    }

    private async _initWithGitConfig() {
        if (!this._username && !this._email) {
            const cwd = await this._getWorkspaceRoot();
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
        this._refreshStats();
    }

    private async _refreshStats() {
        if (!this._view) return;
        
        const stats = await this._getDailyStats();
        this._view.webview.postMessage({ 
            command: 'updateStats', 
            data: stats,
            color: this._color,
            username: this._username,
            email: this._email
        });
    }

    private async _getWorkspaceRoot(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    private async _getDailyStats(): Promise<DailyStats[]> {
        const cwd = await this._getWorkspaceRoot();
        if (!cwd) return [];

        const searchPattern = this._email ? `<${this._email}>` : this._username;
        if (!searchPattern) return [];

        try {
            const today = new Date();
            const stats: DailyStats[] = [];

            for (let i = 6; i >= 0; i--) {
                const date = new Date(today);
                date.setDate(date.getDate() - i);
                const dateStr = date.toISOString().split('T')[0];
                const nextDate = new Date(date);
                nextDate.setDate(nextDate.getDate() + 1);
                const nextDateStr = nextDate.toISOString().split('T')[0];

                const [commitsResult, statsResult] = await Promise.all([
                    execAsync(`git log --author="${searchPattern}" --after="${dateStr}" --before="${nextDateStr}" --oneline | wc -l`, { cwd }),
                    execAsync(`git log --author="${searchPattern}" --after="${dateStr}" --before="${nextDateStr}" --pretty=tformat: --numstat | awk '{ add += $1; del += $2 } END { print add "," del }'`, { cwd })
                ]);

                const commits = parseInt(commitsResult.stdout.trim(), 10) || 0;
                const [ins, del] = statsResult.stdout.trim().split(',').map(s => parseInt(s, 10) || 0);

                stats.push({
                    date: dateStr,
                    commits,
                    insertions: ins,
                    deletions: del
                });
            }

            return stats;
        } catch (error) {
            console.error('Error getting daily stats:', error);
            return [];
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>每日统计</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: 12px;
            background: var(--vscode-panel-background);
            color: var(--vscode-panel-foreground);
            padding: 8px 12px;
            height: 100%;
        }
        .container {
            display: flex;
            align-items: center;
            gap: 16px;
            flex-wrap: wrap;
        }
        .settings {
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        .settings input[type="text"] {
            padding: 4px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 3px;
            font-size: 11px;
            width: 100px;
        }
        .settings input[type="color"] {
            width: 24px;
            height: 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            padding: 0;
        }
        .settings button {
            padding: 4px 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            font-size: 11px;
            cursor: pointer;
        }
        .settings button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .stats-row {
            display: flex;
            align-items: flex-end;
            gap: 6px;
            flex: 1;
            min-width: 300px;
        }
        .day-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            flex: 1;
        }
        .bar-container {
            width: 100%;
            height: 40px;
            display: flex;
            flex-direction: column;
            justify-content: flex-end;
            align-items: center;
        }
        .bar {
            width: 100%;
            max-width: 32px;
            border-radius: 3px 3px 0 0;
            transition: height 0.3s, background 0.3s;
            min-height: 2px;
        }
        .day-label {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
        }
        .day-label.today {
            color: var(--vscode-textLink-foreground);
            font-weight: 600;
        }
        .commit-count {
            font-size: 10px;
            font-weight: 600;
        }
        .summary {
            display: flex;
            align-items: center;
            gap: 12px;
            flex-shrink: 0;
            padding: 6px 12px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
        }
        .summary-item {
            text-align: center;
        }
        .summary-value {
            font-size: 14px;
            font-weight: 700;
        }
        .summary-value.positive { color: #4ec9b0; }
        .summary-value.negative { color: #f14c4c; }
        .summary-label {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
        }
        .no-data {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .divider {
            width: 1px;
            height: 30px;
            background: var(--vscode-editorWidget-border);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="settings">
            <input type="text" id="username" placeholder="用户名">
            <input type="text" id="email" placeholder="邮箱">
            <input type="color" id="colorPicker" value="#39d353" title="选择颜色">
            <button id="applyBtn">应用</button>
        </div>
        
        <div class="divider"></div>
        
        <div class="stats-row" id="statsRow">
            <span class="no-data">请输入用户名或邮箱后点击应用</span>
        </div>
        
        <div class="divider"></div>
        
        <div class="summary" id="summary" style="display: none;">
            <div class="summary-item">
                <div class="summary-value" id="totalCommits">0</div>
                <div class="summary-label">本周提交</div>
            </div>
            <div class="summary-item">
                <div class="summary-value positive" id="totalIns">+0</div>
                <div class="summary-label">新增</div>
            </div>
            <div class="summary-item">
                <div class="summary-value negative" id="totalDel">-0</div>
                <div class="summary-label">删除</div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const statsRow = document.getElementById('statsRow');
        const summary = document.getElementById('summary');
        const colorPicker = document.getElementById('colorPicker');
        const usernameInput = document.getElementById('username');
        const emailInput = document.getElementById('email');
        const applyBtn = document.getElementById('applyBtn');

        const state = vscode.getState() || {};
        if (state.username) usernameInput.value = state.username;
        if (state.email) emailInput.value = state.email;
        if (state.color) colorPicker.value = state.color;

        let currentColor = state.color || '#39d353';

        colorPicker.addEventListener('change', (e) => {
            currentColor = e.target.value;
            vscode.setState({ ...vscode.getState(), color: currentColor });
            vscode.postMessage({ command: 'setColor', color: currentColor });
            updateBarColors();
        });

        applyBtn.addEventListener('click', () => {
            const username = usernameInput.value.trim();
            const email = emailInput.value.trim();
            vscode.setState({ username, email, color: currentColor });
            vscode.postMessage({ command: 'setAuthor', username, email });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'updateStats') {
                renderStats(message.data);
                if (message.color) {
                    currentColor = message.color;
                    colorPicker.value = currentColor;
                }
                if (message.username) usernameInput.value = message.username;
                if (message.email) emailInput.value = message.email;
            }
        });

        function renderStats(stats) {
            if (!stats || stats.length === 0) {
                statsRow.innerHTML = '<span class="no-data">暂无数据</span>';
                summary.style.display = 'none';
                return;
            }

            const maxCommits = Math.max(...stats.map(s => s.commits), 1);
            const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
            const today = new Date().toISOString().split('T')[0];

            let totalCommits = 0;
            let totalIns = 0;
            let totalDel = 0;

            statsRow.innerHTML = stats.map(s => {
                const date = new Date(s.date);
                const dayName = '周' + weekDays[date.getDay()];
                const isToday = s.date === today;
                const height = Math.max((s.commits / maxCommits) * 40, s.commits > 0 ? 4 : 2);
                
                totalCommits += s.commits;
                totalIns += s.insertions;
                totalDel += s.deletions;

                return \`
                    <div class="day-stat">
                        <div class="commit-count" style="color: \${s.commits > 0 ? currentColor : 'var(--vscode-descriptionForeground)'}">\${s.commits}</div>
                        <div class="bar-container">
                            <div class="bar" style="height: \${height}px; background: \${s.commits > 0 ? currentColor : 'var(--vscode-editorWidget-border)'}"></div>
                        </div>
                        <div class="day-label \${isToday ? 'today' : ''}">\${dayName}</div>
                    </div>
                \`;
            }).join('');

            summary.style.display = 'flex';
            document.getElementById('totalCommits').textContent = totalCommits;
            document.getElementById('totalCommits').style.color = currentColor;
            document.getElementById('totalIns').textContent = '+' + totalIns.toLocaleString();
            document.getElementById('totalDel').textContent = '-' + totalDel.toLocaleString();
        }

        function updateBarColors() {
            document.querySelectorAll('.bar').forEach(bar => {
                if (parseInt(bar.style.height) > 2) {
                    bar.style.background = currentColor;
                }
            });
            document.querySelectorAll('.commit-count').forEach(el => {
                if (el.textContent !== '0') {
                    el.style.color = currentColor;
                }
            });
            const tc = document.getElementById('totalCommits');
            if (tc) tc.style.color = currentColor;
        }
    </script>
</body>
</html>`;
    }
}

import * as vscode from 'vscode';

export interface StatsResult {
    author: string;
    email: string;
    totalCommits: number;
    insertions: number;
    deletions: number;
    firstCommit: string;
    lastCommit: string;
}

export class StatsWebviewPanel {
    public static currentPanel: StatsWebviewPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    public static createOrShow(
        extensionUri: vscode.Uri,
        onQuery: (username: string, email: string) => Promise<StatsResult | null>
    ) {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        if (StatsWebviewPanel.currentPanel) {
            StatsWebviewPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'gitCommitStats',
            'Git Commit Stats',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        StatsWebviewPanel.currentPanel = new StatsWebviewPanel(panel, extensionUri, onQuery);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        onQuery: (username: string, email: string) => Promise<StatsResult | null>
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'query':
                        const result = await onQuery(message.username, message.email);
                        this._panel.webview.postMessage({
                            command: 'result',
                            data: result
                        });
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public dispose() {
        StatsWebviewPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private _update() {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Commit Stats</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            min-height: 100vh;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
        }
        h1 {
            text-align: center;
            margin-bottom: 30px;
            color: var(--vscode-textLink-foreground);
            font-size: 24px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--vscode-input-foreground);
        }
        input {
            width: 100%;
            padding: 12px 16px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 6px;
            font-size: 14px;
            transition: border-color 0.2s;
        }
        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        input::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }
        .hint {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 6px;
        }
        button {
            width: 100%;
            padding: 14px 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
            margin-top: 10px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .loading {
            display: none;
            text-align: center;
            padding: 20px;
            color: var(--vscode-descriptionForeground);
        }
        .loading.show {
            display: block;
        }
        .spinner {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-textLink-foreground);
            border-radius: 50%;
            border-top-color: transparent;
            animation: spin 1s linear infinite;
            margin-right: 10px;
            vertical-align: middle;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .result {
            display: none;
            margin-top: 30px;
            padding: 24px;
            background: var(--vscode-editorWidget-background);
            border-radius: 10px;
            border: 1px solid var(--vscode-editorWidget-border);
        }
        .result.show {
            display: block;
        }
        .result h2 {
            margin-bottom: 20px;
            color: var(--vscode-textLink-foreground);
            font-size: 18px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .stat-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
        }
        .stat-item {
            padding: 16px;
            background: var(--vscode-editor-background);
            border-radius: 8px;
            border: 1px solid var(--vscode-editorWidget-border);
        }
        .stat-item.full-width {
            grid-column: span 2;
        }
        .stat-label {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .stat-value {
            font-size: 24px;
            font-weight: 700;
            color: var(--vscode-editor-foreground);
        }
        .stat-value.small {
            font-size: 16px;
        }
        .stat-value.positive {
            color: #4ec9b0;
        }
        .stat-value.negative {
            color: #f14c4c;
        }
        .error {
            display: none;
            margin-top: 20px;
            padding: 16px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 6px;
            color: var(--vscode-inputValidation-errorForeground);
        }
        .error.show {
            display: block;
        }
        .divider {
            height: 1px;
            background: var(--vscode-editorWidget-border);
            margin: 20px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Git Commit Stats</h1>
        
        <form id="queryForm">
            <div class="form-group">
                <label for="username">👤 作者用户名</label>
                <input type="text" id="username" placeholder="例如: John Doe">
                <div class="hint">输入 Git 提交记录中的作者名称</div>
            </div>
            
            <div class="form-group">
                <label for="email">📧 作者邮箱</label>
                <input type="email" id="email" placeholder="例如: john@example.com">
                <div class="hint">输入 Git 提交记录中的邮箱地址</div>
            </div>
            
            <button type="submit" id="submitBtn">🔍 开始统计</button>
        </form>

        <div class="loading" id="loading">
            <span class="spinner"></span>
            正在统计中...
        </div>

        <div class="error" id="error"></div>

        <div class="result" id="result">
            <h2>📈 统计结果</h2>
            <div class="stat-grid">
                <div class="stat-item full-width">
                    <div class="stat-label">作者信息</div>
                    <div class="stat-value small" id="authorInfo">-</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">总提交数</div>
                    <div class="stat-value" id="totalCommits">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">新增代码行</div>
                    <div class="stat-value positive" id="insertions">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">删除代码行</div>
                    <div class="stat-value negative" id="deletions">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">净增行数</div>
                    <div class="stat-value" id="netLines">0</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">首次提交</div>
                    <div class="stat-value small" id="firstCommit">-</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">最近提交</div>
                    <div class="stat-value small" id="lastCommit">-</div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('queryForm');
        const submitBtn = document.getElementById('submitBtn');
        const loading = document.getElementById('loading');
        const result = document.getElementById('result');
        const error = document.getElementById('error');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const username = document.getElementById('username').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!username && !email) {
                showError('请至少输入用户名或邮箱');
                return;
            }

            submitBtn.disabled = true;
            loading.classList.add('show');
            result.classList.remove('show');
            error.classList.remove('show');

            vscode.postMessage({
                command: 'query',
                username: username,
                email: email
            });
        });

        window.addEventListener('message', (event) => {
            const message = event.data;
            
            if (message.command === 'result') {
                submitBtn.disabled = false;
                loading.classList.remove('show');

                if (message.data) {
                    showResult(message.data);
                } else {
                    showError('未找到匹配的提交记录');
                }
            }
        });

        function showResult(data) {
            result.classList.add('show');
            error.classList.remove('show');

            const authorText = data.email 
                ? data.author + ' <' + data.email + '>'
                : data.author;
            
            document.getElementById('authorInfo').textContent = authorText;
            document.getElementById('totalCommits').textContent = data.totalCommits.toLocaleString();
            document.getElementById('insertions').textContent = '+' + data.insertions.toLocaleString();
            document.getElementById('deletions').textContent = '-' + data.deletions.toLocaleString();
            
            const net = data.insertions - data.deletions;
            const netEl = document.getElementById('netLines');
            netEl.textContent = (net >= 0 ? '+' : '') + net.toLocaleString();
            netEl.className = 'stat-value ' + (net >= 0 ? 'positive' : 'negative');
            
            document.getElementById('firstCommit').textContent = data.firstCommit || '-';
            document.getElementById('lastCommit').textContent = data.lastCommit || '-';
        }

        function showError(msg) {
            error.textContent = msg;
            error.classList.add('show');
            result.classList.remove('show');
        }
    </script>
</body>
</html>`;
    }
}

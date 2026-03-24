import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DailyCommit {
    date: string;
    count: number;
}

interface AuthorStats {
    author: string;
    email: string;
    totalCommits: number;
    insertions: number;
    deletions: number;
    dailyCommits: DailyCommit[];
}

export class StatsSidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'gitCommitStats.sidebar';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

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
                case 'query':
                    const stats = await this._getAuthorStats(message.username, message.email);
                    webviewView.webview.postMessage({ command: 'result', data: stats });
                    break;
                case 'refresh':
                    const refreshStats = await this._getAuthorStats(message.username, message.email);
                    webviewView.webview.postMessage({ command: 'result', data: refreshStats });
                    break;
                case 'getGitConfig':
                    const config = await this._getGitConfig();
                    webviewView.webview.postMessage({ command: 'gitConfig', data: config });
                    break;
            }
        });

        this._initWithGitConfig(webviewView);
    }

    private async _initWithGitConfig(webviewView: vscode.WebviewView) {
        const config = await this._getGitConfig();
        if (config.username || config.email) {
            webviewView.webview.postMessage({ command: 'gitConfig', data: config });
            const stats = await this._getAuthorStats(config.username, config.email);
            webviewView.webview.postMessage({ command: 'result', data: stats });
        }
    }

    private async _getGitConfig(): Promise<{username: string, email: string}> {
        const cwd = await this._getWorkspaceRoot();
        if (!cwd) return { username: '', email: '' };
        
        try {
            const [nameResult, emailResult] = await Promise.all([
                execAsync('git config user.name', { cwd }),
                execAsync('git config user.email', { cwd })
            ]);
            return {
                username: nameResult.stdout.trim(),
                email: emailResult.stdout.trim()
            };
        } catch {
            return { username: '', email: '' };
        }
    }

    private async _getWorkspaceRoot(): Promise<string | undefined> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return undefined;
        }
        return workspaceFolders[0].uri.fsPath;
    }

    private async _getAuthorStats(username: string, email: string): Promise<AuthorStats | null> {
        const cwd = await this._getWorkspaceRoot();
        if (!cwd) {
            vscode.window.showErrorMessage('请先打开一个工作区');
            return null;
        }

        try {
            const searchPattern = email ? `<${email}>` : username;
            if (!searchPattern) {
                return null;
            }

            const [totalResult, insertionsResult, deletionsResult, authorInfo, dailyResult] = await Promise.all([
                execAsync(`git log --author="${searchPattern}" --oneline | wc -l`, { cwd }),
                execAsync(`git log --author="${searchPattern}" --pretty=tformat: --numstat | awk '{ add += $1 } END { print add }'`, { cwd }),
                execAsync(`git log --author="${searchPattern}" --pretty=tformat: --numstat | awk '{ del += $2 } END { print del }'`, { cwd }),
                execAsync(`git log --author="${searchPattern}" --format="%an <%ae>" | head -1`, { cwd }),
                execAsync(`git log --author="${searchPattern}" --format="%ad" --date=short | sort | uniq -c`, { cwd })
            ]);

            const total = parseInt(totalResult.stdout.trim(), 10) || 0;
            if (total === 0) {
                return null;
            }

            const insertions = parseInt(insertionsResult.stdout.trim(), 10) || 0;
            const deletions = parseInt(deletionsResult.stdout.trim(), 10) || 0;

            const authorMatch = authorInfo.stdout.trim().match(/^(.+?)\s*<(.+)>$/);
            const finalAuthor = authorMatch ? authorMatch[1].trim() : (username || email);
            const finalEmail = authorMatch ? authorMatch[2].trim() : (email || '');

            const dailyCommits: DailyCommit[] = [];
            const lines = dailyResult.stdout.trim().split('\n').filter(l => l.trim());
            for (const line of lines) {
                const match = line.trim().match(/^\s*(\d+)\s+(\d{4}-\d{2}-\d{2})$/);
                if (match) {
                    dailyCommits.push({
                        count: parseInt(match[1], 10),
                        date: match[2]
                    });
                }
            }

            return {
                author: finalAuthor,
                email: finalEmail,
                totalCommits: total,
                insertions,
                deletions,
                dailyCommits
            };
        } catch (error) {
            console.error('Error getting author stats:', error);
            return null;
        }
    }

    private _getHtmlForWebview() {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Stats</title>
    <style>
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: 13px;
            background: var(--vscode-sideBar-background);
            color: var(--vscode-sideBar-foreground);
            padding: 12px;
        }
        .section {
            margin-bottom: 16px;
        }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--vscode-sideBarSectionHeader-foreground);
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .form-group {
            margin-bottom: 10px;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-size: 12px;
            color: var(--vscode-input-foreground);
        }
        input {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: 12px;
        }
        input:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        button {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            margin-top: 6px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 8px;
            margin-bottom: 16px;
        }
        .stat-card {
            padding: 10px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
            text-align: center;
        }
        .stat-card.full {
            grid-column: span 2;
        }
        .stat-value {
            font-size: 20px;
            font-weight: 700;
            color: var(--vscode-textLink-foreground);
        }
        .stat-value.positive { color: #4ec9b0; }
        .stat-value.negative { color: #f14c4c; }
        .stat-label {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            text-transform: uppercase;
        }
        .heatmap-wrapper {
            position: relative;
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            padding: 8px;
            background: var(--vscode-editor-background);
        }
        .heatmap-container {
            overflow-x: auto;
            overflow-y: hidden;
            padding: 4px 0;
            cursor: grab;
            scrollbar-width: thin;
        }
        .heatmap-container:active {
            cursor: grabbing;
        }
        .heatmap-container::-webkit-scrollbar {
            height: 6px;
        }
        .heatmap-container::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }
        .heatmap-container::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 3px;
        }
        .heatmap-inner {
            display: inline-block;
            min-width: max-content;
        }
        .heatmap {
            display: flex;
            flex-direction: column;
            gap: 3px;
        }
        .heatmap-row {
            display: flex;
            gap: 3px;
        }
        .heatmap-cell {
            border-radius: 2px;
            background: var(--vscode-sideBar-background);
            transition: transform 0.1s;
            flex-shrink: 0;
        }
        .heatmap-cell:hover {
            transform: scale(1.2);
            z-index: 1;
        }
        .heatmap-cell.level-0 { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-editorWidget-border); }
        .heatmap-cell.level-1 { background: #0e4429; }
        .heatmap-cell.level-2 { background: #006d32; }
        .heatmap-cell.level-3 { background: #26a641; }
        .heatmap-cell.level-4 { background: #39d353; }
        .heatmap-legend {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-top: 10px;
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
        }
        .heatmap-legend-colors {
            display: flex;
            align-items: center;
            gap: 4px;
        }
        .heatmap-legend .heatmap-cell {
            width: 10px;
            height: 10px;
        }
        .heatmap-legend .heatmap-cell:hover {
            transform: none;
        }
        .zoom-info {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            background: var(--vscode-badge-background);
            padding: 2px 6px;
            border-radius: 3px;
        }
        .month-labels {
            display: flex;
            margin-bottom: 4px;
            padding-left: 0;
        }
        .month-label {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            flex-shrink: 0;
        }
        .zoom-hint {
            font-size: 9px;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            margin-top: 6px;
            opacity: 0.7;
        }
        .tooltip {
            position: fixed;
            background: var(--vscode-editorWidget-background);
            border: 1px solid var(--vscode-editorWidget-border);
            border-radius: 6px;
            padding: 10px 12px;
            font-size: 12px;
            color: var(--vscode-editor-foreground);
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            pointer-events: none;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.15s;
            min-width: 120px;
        }
        .tooltip.show {
            opacity: 1;
        }
        .tooltip-date {
            font-weight: 600;
            margin-bottom: 6px;
            color: var(--vscode-textLink-foreground);
        }
        .tooltip-count {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .tooltip-count .dot {
            width: 10px;
            height: 10px;
            border-radius: 2px;
        }
        .tooltip-count .dot.level-0 { background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-editorWidget-border); }
        .tooltip-count .dot.level-1 { background: #0e4429; }
        .tooltip-count .dot.level-2 { background: #006d32; }
        .tooltip-count .dot.level-3 { background: #26a641; }
        .tooltip-count .dot.level-4 { background: #39d353; }
        .tooltip-label {
            color: var(--vscode-descriptionForeground);
        }
        .tooltip-value {
            font-weight: 600;
        }
        .result {
            display: none;
        }
        .result.show {
            display: block;
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
        .error {
            display: none;
            padding: 10px;
            background: var(--vscode-inputValidation-errorBackground);
            border-radius: 4px;
            color: var(--vscode-inputValidation-errorForeground);
            font-size: 12px;
            margin-top: 10px;
        }
        .error.show {
            display: block;
        }
        .author-info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 12px;
            padding: 8px;
            background: var(--vscode-editor-background);
            border-radius: 4px;
            word-break: break-all;
        }
        .divider {
            height: 1px;
            background: var(--vscode-sideBarSectionHeader-border);
            margin: 16px 0;
        }
    </style>
</head>
<body>
    <div class="section">
        <div class="section-title">⚙️ 设置</div>
        <form id="queryForm">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" id="username" placeholder="例如: John Doe">
            </div>
            <div class="form-group">
                <label>邮箱</label>
                <input type="email" id="email" placeholder="例如: john@example.com">
            </div>
            <button type="submit" id="submitBtn">🔍 统计</button>
        </form>
    </div>

    <div class="loading" id="loading">统计中...</div>
    <div class="error" id="error"></div>

    <div class="result" id="result">
        <div class="divider"></div>
        
        <div class="section">
            <div class="section-title">📊 统计结果</div>
            <div class="author-info" id="authorInfo"></div>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value" id="totalCommits">0</div>
                    <div class="stat-label">提交数</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value positive" id="insertions">0</div>
                    <div class="stat-label">新增行</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value negative" id="deletions">0</div>
                    <div class="stat-label">删除行</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value" id="netLines">0</div>
                    <div class="stat-label">净增行</div>
                </div>
            </div>
        </div>

        <div class="section">
            <div class="section-title">📅 提交热力图</div>
            <div class="heatmap-wrapper">
                <div class="heatmap-container" id="heatmapContainer">
                    <div class="heatmap-inner">
                        <div class="month-labels" id="monthLabels"></div>
                        <div class="heatmap" id="heatmap"></div>
                    </div>
                </div>
                <div class="heatmap-legend">
                    <div class="heatmap-legend-colors">
                        <span>少</span>
                        <div class="heatmap-cell level-0"></div>
                        <div class="heatmap-cell level-1"></div>
                        <div class="heatmap-cell level-2"></div>
                        <div class="heatmap-cell level-3"></div>
                        <div class="heatmap-cell level-4"></div>
                        <span>多</span>
                    </div>
                    <div class="zoom-info" id="zoomInfo">4周</div>
                </div>
                <div class="zoom-hint">🖱️ 滚轮缩放 · 拖动滑动</div>
            </div>
        </div>
    </div>

    <div class="tooltip" id="tooltip">
        <div class="tooltip-date" id="tooltipDate"></div>
        <div class="tooltip-count">
            <div class="dot" id="tooltipDot"></div>
            <span class="tooltip-label">提交:</span>
            <span class="tooltip-value" id="tooltipCount"></span>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const form = document.getElementById('queryForm');
        const submitBtn = document.getElementById('submitBtn');
        const loading = document.getElementById('loading');
        const result = document.getElementById('result');
        const error = document.getElementById('error');

        const state = vscode.getState() || {};
        if (state.username) document.getElementById('username').value = state.username;
        if (state.email) document.getElementById('email').value = state.email;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value.trim();
            const email = document.getElementById('email').value.trim();

            if (!username && !email) {
                showError('请至少输入用户名或邮箱');
                return;
            }

            vscode.setState({ username, email });
            submitBtn.disabled = true;
            loading.classList.add('show');
            result.classList.remove('show');
            error.classList.remove('show');

            vscode.postMessage({ command: 'query', username, email });
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
            } else if (message.command === 'gitConfig') {
                if (message.data.username) {
                    document.getElementById('username').value = message.data.username;
                }
                if (message.data.email) {
                    document.getElementById('email').value = message.data.email;
                }
            }
        });

        function showResult(data) {
            result.classList.add('show');
            error.classList.remove('show');

            document.getElementById('authorInfo').textContent = 
                data.author + (data.email ? ' <' + data.email + '>' : '');
            document.getElementById('totalCommits').textContent = data.totalCommits.toLocaleString();
            document.getElementById('insertions').textContent = '+' + data.insertions.toLocaleString();
            document.getElementById('deletions').textContent = '-' + data.deletions.toLocaleString();
            
            const net = data.insertions - data.deletions;
            const netEl = document.getElementById('netLines');
            netEl.textContent = (net >= 0 ? '+' : '') + net.toLocaleString();
            netEl.className = 'stat-value ' + (net >= 0 ? 'positive' : 'negative');

            renderHeatmap(data.dailyCommits);
        }

        function showError(msg) {
            error.textContent = msg;
            error.classList.add('show');
            result.classList.remove('show');
        }

        let allWeeks = [];
        let commitMap = {};
        let maxCount = 1;
        
        const ZOOM_LEVELS = [
            { weeks: 1, label: '1周', cellSize: 28, gap: 4 },
            { weeks: 2, label: '2周', cellSize: 22, gap: 3 },
            { weeks: 4, label: '4周', cellSize: 16, gap: 3 },
            { weeks: 8, label: '8周', cellSize: 12, gap: 2 },
            { weeks: 12, label: '12周', cellSize: 10, gap: 2 }
        ];
        let currentZoomIndex = 2;

        const heatmapContainer = document.getElementById('heatmapContainer');
        
        heatmapContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0 && currentZoomIndex > 0) {
                currentZoomIndex--;
                renderHeatmapView();
            } else if (e.deltaY > 0 && currentZoomIndex < ZOOM_LEVELS.length - 1) {
                currentZoomIndex++;
                renderHeatmapView();
            }
        }, { passive: false });

        let isDragging = false;
        let startX = 0;
        let scrollLeft = 0;

        heatmapContainer.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.pageX - heatmapContainer.offsetLeft;
            scrollLeft = heatmapContainer.scrollLeft;
            heatmapContainer.style.cursor = 'grabbing';
        });

        heatmapContainer.addEventListener('mouseleave', () => {
            isDragging = false;
            heatmapContainer.style.cursor = 'grab';
        });

        heatmapContainer.addEventListener('mouseup', () => {
            isDragging = false;
            heatmapContainer.style.cursor = 'grab';
        });

        heatmapContainer.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            e.preventDefault();
            const x = e.pageX - heatmapContainer.offsetLeft;
            const walk = (x - startX) * 1.5;
            heatmapContainer.scrollLeft = scrollLeft - walk;
        });

        function renderHeatmap(dailyCommits) {
            commitMap = {};
            maxCount = 1;
            for (const dc of dailyCommits) {
                commitMap[dc.date] = dc.count;
                if (dc.count > maxCount) maxCount = dc.count;
            }

            const today = new Date();
            const startDate = new Date(today);
            startDate.setDate(startDate.getDate() - 364);
            
            const dayOfWeek = startDate.getDay();
            startDate.setDate(startDate.getDate() - dayOfWeek);

            allWeeks = [];
            let currentDate = new Date(startDate);
            
            while (currentDate <= today) {
                const week = [];
                for (let d = 0; d < 7; d++) {
                    const dateStr = currentDate.toISOString().split('T')[0];
                    const count = commitMap[dateStr] || 0;
                    const level = getLevel(count, maxCount);
                    week.push({ date: dateStr, count, level, future: currentDate > today });
                    currentDate.setDate(currentDate.getDate() + 1);
                }
                allWeeks.push(week);
            }

            renderHeatmapView();
            setTimeout(() => {
                heatmapContainer.scrollLeft = heatmapContainer.scrollWidth;
            }, 50);
        }

        function renderHeatmapView() {
            const heatmap = document.getElementById('heatmap');
            const monthLabels = document.getElementById('monthLabels');
            const zoomInfo = document.getElementById('zoomInfo');
            
            heatmap.innerHTML = '';
            monthLabels.innerHTML = '';

            const zoom = ZOOM_LEVELS[currentZoomIndex];
            zoomInfo.textContent = zoom.label;

            const cellSize = zoom.cellSize;
            const gap = zoom.gap;
            const cellTotal = cellSize + gap;

            const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
            let lastMonth = -1;
            
            for (let w = 0; w < allWeeks.length; w++) {
                const firstDay = new Date(allWeeks[w][0].date);
                const month = firstDay.getMonth();
                const label = document.createElement('span');
                label.className = 'month-label';
                label.style.width = cellTotal + 'px';
                if (month !== lastMonth && firstDay.getDate() <= 7) {
                    label.textContent = months[month];
                    lastMonth = month;
                }
                monthLabels.appendChild(label);
            }

            heatmap.style.gap = gap + 'px';

            for (let d = 0; d < 7; d++) {
                const row = document.createElement('div');
                row.className = 'heatmap-row';
                row.style.gap = gap + 'px';
                
                for (let w = 0; w < allWeeks.length; w++) {
                    const cell = document.createElement('div');
                    const dayData = allWeeks[w][d];
                    cell.className = 'heatmap-cell level-' + (dayData.future ? 0 : dayData.level);
                    cell.style.width = cellSize + 'px';
                    cell.style.height = cellSize + 'px';
                    cell.dataset.date = dayData.date;
                    cell.dataset.count = dayData.count;
                    cell.dataset.level = dayData.future ? 0 : dayData.level;
                    row.appendChild(cell);
                }
                heatmap.appendChild(row);
            }
        }

        const tooltip = document.getElementById('tooltip');
        const tooltipDate = document.getElementById('tooltipDate');
        const tooltipCount = document.getElementById('tooltipCount');
        const tooltipDot = document.getElementById('tooltipDot');

        const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        document.getElementById('heatmap').addEventListener('mouseover', (e) => {
            const cell = e.target;
            if (!cell.classList.contains('heatmap-cell')) return;
            
            const date = cell.dataset.date;
            const count = cell.dataset.count;
            const level = cell.dataset.level;
            
            if (!date) return;

            const dateObj = new Date(date);
            const dayName = weekDays[dateObj.getDay()];
            const formattedDate = date + ' ' + dayName;
            
            tooltipDate.textContent = formattedDate;
            tooltipCount.textContent = count + ' 次';
            tooltipDot.className = 'dot level-' + level;
            
            const rect = cell.getBoundingClientRect();
            tooltip.style.left = (rect.left + rect.width / 2) + 'px';
            tooltip.style.top = (rect.top - 60) + 'px';
            tooltip.style.transform = 'translateX(-50%)';
            tooltip.classList.add('show');
        });

        document.getElementById('heatmap').addEventListener('mouseout', (e) => {
            const cell = e.target;
            if (!cell.classList.contains('heatmap-cell')) return;
            tooltip.classList.remove('show');
        });

        function getLevel(count, max) {
            if (count === 0) return 0;
            const ratio = count / max;
            if (ratio <= 0.25) return 1;
            if (ratio <= 0.5) return 2;
            if (ratio <= 0.75) return 3;
            return 4;
        }
    </script>
</body>
</html>`;
    }
}

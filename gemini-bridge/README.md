# Gemini Bridge - Multi-Agent Collaboration Module

Claude Code (Opus) 与 Gemini CLI 之间的协作桥梁，采用**文件驱动 + worktree 隔离**架构。

## 架构

```
Opus (主Agent, 规划/Review)
  │
  ├── 1. 分析任务，生成交接文件 (.task-handoff/gemini-task-{id}.md)
  ├── 2. 创建 git worktree 隔离区
  ├── 3. 调用 Gemini CLI 在隔离区执行
  ├── 4. 审查 diff，决定 accept/reject
  ├── 5. 合并或丢弃，清理 worktree
  └── 6. 更新 task.json + progress.txt
```

## 与 Codex Bridge 的区别

| 特性 | Codex Bridge | Gemini Bridge |
|------|-------------|---------------|
| CLI 命令 | `codex` | `gemini` |
| 输出格式 | JSONL (结构化) | 纯文本 |
| 会话恢复 | 支持 | 不支持 |
| 调用方式 | `codex exec --full-auto` | `gemini --sandbox` |
| 分支前缀 | `codex/` | `gemini/` |
| PID 文件 | `.codex-pid` | `.gemini-pid` |
| Blocker 文件 | `.codex-blockers.md` | `.gemini-blockers.md` |

## 快速使用

### 在 Claude Code 会话中

Claude (Opus) 可以直接通过 Bash 调用：

```bash
# 创建 worktree（使用绝对路径）
git worktree add "$PWD/.worktrees/gemini-R2-007" -b gemini/R2-007

# 写好交接文件后，调用 Gemini（使用绝对路径引用 handoff 文件）
gemini --sandbox "Read $PWD/.task-handoff/gemini-task-R2-007.md and execute"

# 审查
git diff HEAD...gemini/R2-007

# 合并
git merge gemini/R2-007 --no-edit

# 清理（分两条命令，WinPS 5.1 不支持 &&）
git worktree remove "$PWD/.worktrees/gemini-R2-007" --force
git branch -D gemini/R2-007
```

### 通过 PowerShell 模块

```powershell
Import-Module ./gemini-bridge/GeminiBridge.psm1

# 检查 Gemini 是否可用
Test-GeminiAvailable

# 完整生命周期
$result = Invoke-Gemini -TaskId "R2-007" -Task @{
    id = "R2-007"
    name = "用户登录API"
    type = "implementation"
    description = "实现用户登录接口"
    steps = @("创建登录路由", "实现认证逻辑", "编写测试")
    acceptance_criteria = @("POST /api/auth/login 返回 JWT", "错误密码返回 401")
}

# 审查
$review = Get-GeminiReviewSummary -Result $result
Format-GeminiReviewForClaude -Review $review

# 接受或拒绝
Complete-GeminiTask -Result $result -Verdict "accept"  # 或 "reject"
```

## 与 auto-resume 集成

在 `task.json` 中设置 `"assignee": "gemini"` 即可：

```json
{
    "id": "R2-007",
    "assignee": "gemini",
    "type": "implementation",
    "name": "前端页面设计",
    ...
}
```

autopilot-start.mjs 会自动检测并注入 Gemini 委派指令到 Opus prompt 中。

## 模块结构

```
gemini-bridge/
├── GeminiBridge.psm1           # 主模块
├── GeminiBridge.psd1           # 模块清单
├── templates/
│   └── gemini-task-template.md # 交接文件模板
├── lib/
│   ├── worktree.ps1            # git worktree 生命周期
│   ├── context-builder.ps1     # 上下文构建（自动识别相关文件）
│   └── review.ps1              # diff 审查辅助
└── README.md
```

## 关键设计

- **文件驱动通信**：交接文件 (.md) 是唯一的信息传递方式
- **Worktree 隔离**：Gemini 在独立 worktree 中工作，不污染主分支
- **零上下文补偿**：交接文件自包含所有项目约定和相关代码
- **Opus 审查门**：所有改动必须经过 Opus 审查才能合并
- **PS 5.1 兼容**：不使用 PowerShell 7+ 专有语法
- **纯文本输出**：Gemini 输出为纯文本（不像 Codex 的 JSONL），直接捕获和记录

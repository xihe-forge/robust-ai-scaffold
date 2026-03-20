@{
    RootModule        = 'CodexBridge.psm1'
    ModuleVersion     = '1.0.0'
    GUID              = 'a3b7c9d1-e5f6-4a2b-8c0d-1e3f5a7b9c0d'
    Author            = 'xihe-forge'
    Description       = 'Multi-Agent Collaboration Bridge: Claude Code (Opus) <-> Codex CLI. File-driven task handoff with git worktree isolation.'
    PowerShellVersion = '5.1'

    FunctionsToExport = @(
        'Invoke-Codex',
        'Test-CodexAvailable',
        'New-CodexTaskFile',
        'New-CodexWorktree',
        'Get-WorktreeDiff',
        'Get-WorktreeFilesChanged',
        'Merge-CodexWorktree',
        'Remove-CodexWorktree',
        'Clear-StaleWorktrees',
        'Get-CodexReviewSummary',
        'Format-ReviewForClaude',
        'Complete-CodexTask'
    )

    PrivateData = @{
        PSData = @{
            Tags       = @('AI', 'MultiAgent', 'Codex', 'Claude', 'Collaboration')
            ProjectUri = 'https://github.com/xihe-forge/auto-resume-tools'
        }
    }
}

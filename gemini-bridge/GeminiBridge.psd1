@{
    RootModule        = 'GeminiBridge.psm1'
    ModuleVersion     = '1.0.0'
    GUID              = 'b4c8d0e2-f6a7-5b3c-9d1e-2f4a6b8c0d1e'
    Author            = 'xihe-forge'
    Description       = 'Multi-Agent Collaboration Bridge: Claude Code (Opus) <-> Gemini CLI. File-driven task handoff with git worktree isolation.'
    PowerShellVersion = '5.1'

    FunctionsToExport = @(
        'Invoke-Gemini',
        'Test-GeminiAvailable',
        'New-GeminiTaskFile',
        'New-GeminiWorktree',
        'Get-GeminiWorktreeDiff',
        'Get-GeminiWorktreeFilesChanged',
        'Merge-GeminiWorktree',
        'Remove-GeminiWorktree',
        'Clear-StaleGeminiWorktrees',
        'Get-GeminiReviewSummary',
        'Format-GeminiReviewForClaude',
        'Complete-GeminiTask'
    )

    PrivateData = @{
        PSData = @{
            Tags       = @('AI', 'MultiAgent', 'Gemini', 'Claude', 'Collaboration')
            ProjectUri = 'https://github.com/xihe-forge/auto-resume-tools'
        }
    }
}

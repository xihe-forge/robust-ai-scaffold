# Gemini Bridge - Review Helpers
# Provides functions for Claude (Opus) to review Gemini's changes

function Get-GeminiReviewSummary {
    <#
    .SYNOPSIS
    Generates a review summary of Gemini's changes for Claude to evaluate.
    .PARAMETER Result
    The result hashtable from Invoke-Gemini.
    .PARAMETER ProjectRoot
    Root of the git repository.
    .OUTPUTS
    Hashtable with DiffStats, FileList, FullDiff, Blockers, ReviewReady.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Result,

        [string]$ProjectRoot = ""
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    $review = @{
        TaskId      = $Result.TaskId
        Status      = $Result.Status
        Duration    = $Result.Duration
        FileList    = $Result.FilesChanged
        FileCount   = $Result.FilesChanged.Count
        DiffStats   = ""
        FullDiff    = ""
        Blockers    = ""
        ReviewReady = $false
    }

    # Not reviewable if error/timeout
    if ($Result.Status -eq "error" -or $Result.Status -eq "timeout") {
        $review.Blockers = "Gemini execution failed with status: $($Result.Status). Check log: $($Result.LogFile)"
        return $review
    }

    if ($Result.Status -eq "no-changes") {
        $review.Blockers = "Gemini made no changes. Task may need re-specification."
        return $review
    }

    if ($Result.Status -eq "commit-failed") {
        $review.Blockers = "Gemini made changes but auto-commit failed. Check log: $($Result.LogFile)"
        return $review
    }

    # Get diff stats
    try {
        $review.DiffStats = Get-GeminiWorktreeDiff -BranchName $Result.Branch -ProjectRoot $ProjectRoot -StatOnly
    } catch {
        $review.Blockers = "Could not read diff stats: $_"
        return $review
    }

    # Get full diff
    try {
        $review.FullDiff = Get-GeminiWorktreeDiff -BranchName $Result.Branch -ProjectRoot $ProjectRoot
    } catch {
        $review.Blockers = "Could not read full diff: $_"
        return $review
    }

    # Check for blocker file from Gemini
    $blockerFile = Join-Path $Result.WorktreePath ".gemini-blockers.md"
    if (Test-Path $blockerFile) {
        $review.Blockers = Get-Content $blockerFile -Raw -Encoding UTF8
    }

    # Parse diff stats for added/removed lines
    $addedLines = 0
    $removedLines = 0
    if ($review.FullDiff) {
        $addedLines = ([regex]::Matches($review.FullDiff, '(?m)^\+[^+]')).Count
        $removedLines = ([regex]::Matches($review.FullDiff, '(?m)^-[^-]')).Count
    }

    $review.DiffStats = "+$addedLines -$removedLines in $($review.FileCount) files"
    $review.ReviewReady = $true

    return $review
}

function Format-GeminiReviewForClaude {
    <#
    .SYNOPSIS
    Formats review data into a readable report for Claude to evaluate.
    .PARAMETER Review
    Review hashtable from Get-GeminiReviewSummary.
    .OUTPUTS
    Formatted string ready for Claude to read.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Review
    )

    $sb = [System.Text.StringBuilder]::new()

    [void]$sb.AppendLine("## Gemini Execution Review: $($Review.TaskId)")
    [void]$sb.AppendLine("")
    [void]$sb.AppendLine("**Status**: $($Review.Status)")
    [void]$sb.AppendLine("**Duration**: $($Review.Duration)s")
    [void]$sb.AppendLine("**Changes**: $($Review.DiffStats)")
    [void]$sb.AppendLine("")

    if ($Review.Blockers) {
        [void]$sb.AppendLine("### Blockers")
        [void]$sb.AppendLine($Review.Blockers)
        [void]$sb.AppendLine("")
    }

    if ($Review.FileList -and $Review.FileList.Count -gt 0) {
        [void]$sb.AppendLine("### Files Changed")
        foreach ($f in $Review.FileList) {
            [void]$sb.AppendLine("- $f")
        }
        [void]$sb.AppendLine("")
    }

    if ($Review.ReviewReady -and $Review.FullDiff) {
        [void]$sb.AppendLine("### Diff")
        [void]$sb.AppendLine('```diff')
        # Truncate diff if too large
        if ($Review.FullDiff.Length -gt 20000) {
            [void]$sb.AppendLine($Review.FullDiff.Substring(0, 20000))
            [void]$sb.AppendLine("... (truncated, $($Review.FullDiff.Length) chars total)")
        } else {
            [void]$sb.AppendLine($Review.FullDiff)
        }
        [void]$sb.AppendLine('```')
    }

    return $sb.ToString()
}

function Complete-GeminiTask {
    <#
    .SYNOPSIS
    Finalizes a Gemini task: merges changes and cleans up worktree.
    .PARAMETER Result
    The result hashtable from Invoke-Gemini.
    .PARAMETER Verdict
    "accept" to merge, "reject" to discard.
    .PARAMETER ProjectRoot
    Root of the git repository.
    .OUTPUTS
    Hashtable with Success, Action, Error.
    #>
    param(
        [Parameter(Mandatory)]
        [hashtable]$Result,

        [Parameter(Mandatory)]
        [ValidateSet("accept", "reject")]
        [string]$Verdict,

        [string]$ProjectRoot = ""
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    $outcome = @{
        Success = $false
        Action  = $Verdict
        Error   = $null
    }

    if ($Verdict -eq "accept") {
        # Guard: only allow merge for success status
        if (-not $Result.Status -or $Result.Status -ne "success") {
            Write-Host "[review] Cannot accept task with status '$($Result.Status)' — only 'success' results can be merged" -ForegroundColor Red
            $outcome.Error = "Refusing to merge: Gemini result status is '$($Result.Status)', not 'success'"
            return $outcome
        }

        # Merge Gemini's branch
        $mergeResult = Merge-GeminiWorktree -BranchName $Result.Branch -TaskId $Result.TaskId -ProjectRoot $ProjectRoot

        if ($mergeResult.Success) {
            Write-Host "[review] Changes accepted and merged for $($Result.TaskId)" -ForegroundColor Green
            $outcome.Success = $true
        } else {
            Write-Host "[review] Merge failed: $($mergeResult.Error)" -ForegroundColor Red
            $outcome.Error = $mergeResult.Error
            return $outcome
        }
    } else {
        Write-Host "[review] Changes rejected for $($Result.TaskId)" -ForegroundColor Yellow
        $outcome.Success = $true
    }

    # Cleanup worktree
    Remove-GeminiWorktree -TaskId $Result.TaskId -ProjectRoot $ProjectRoot

    return $outcome
}

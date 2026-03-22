# Gemini Bridge - Git Worktree Lifecycle Management
# Provides isolation for Gemini execution: create, diff, merge, cleanup

# WORKTREE_BASE is resolved after Get-GitRoot is available (set by GeminiBridge.psm1)
# Lazy-init: computed on first use via Get-GeminiWorktreeBase
$script:GEMINI_WORKTREE_BASE = ""

function script:Get-GeminiWorktreeBase {
    if (-not $script:GEMINI_WORKTREE_BASE) {
        $script:GEMINI_WORKTREE_BASE = Join-Path (Get-GitRoot) ".worktrees"
    }
    return $script:GEMINI_WORKTREE_BASE
}

function New-GeminiWorktree {
    <#
    .SYNOPSIS
    Creates an isolated git worktree for Gemini to work in.
    .PARAMETER TaskId
    Task identifier (e.g., "R2-007"). Used for branch and directory naming.
    .PARAMETER BaseBranch
    Branch or commit to base the worktree on. Defaults to HEAD.
    .PARAMETER ProjectRoot
    Root directory of the git repository.
    .OUTPUTS
    Hashtable with Path, Branch, TaskId keys.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$TaskId,

        [string]$BaseBranch = "HEAD",

        [string]$ProjectRoot = ""
    )

    if (-not $TaskId -or $TaskId.Trim() -eq "") {
        throw "TaskId must not be empty"
    }

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    $safeName = ConvertTo-SafeId $TaskId
    $wtBase = Get-GeminiWorktreeBase
    $worktreePath = Join-Path $wtBase "gemini-$safeName"
    $branchName = "gemini/$safeName"

    # Ensure base directory exists
    if (-not (Test-Path $wtBase)) {
        New-Item -ItemType Directory -Path $wtBase -Force | Out-Null
    }

    # Acquire per-task lock to prevent TOCTOU race between stale check and PID write
    $lockPath = Join-Path $wtBase "gemini-$safeName.lock"
    $lockStream = $null
    try {
        $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
    } catch {
        throw "Could not acquire lock for worktree gemini-$safeName — another operation may be in progress."
    }

    try {
        # Clean up stale worktree if exists — but check PID marker first
        if (Test-Path $worktreePath) {
            $pidFile = Join-Path $worktreePath ".gemini-pid"
            $isActive = $false
            if (Test-Path $pidFile) {
                try {
                    $ownerPid = [int](Get-Content $pidFile -Raw).Trim()
                    # PID 0 is a placeholder from worktree creation — treat as stale
                    $isActive = $ownerPid -ne 0 -and ($null -ne (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue))
                } catch {}
            }
            if ($isActive) {
                throw "Worktree $worktreePath is actively in use by PID $ownerPid. Aborting."
            }
            Write-Host "[worktree] Cleaning stale worktree: $worktreePath" -ForegroundColor Yellow
            Push-Location $ProjectRoot
            try {
                git worktree remove $worktreePath --force 2>$null
            } catch {}
            Pop-Location
            if (Test-Path $worktreePath) {
                Remove-Item -Recurse -Force $worktreePath -ErrorAction SilentlyContinue
            }
        }

        # Delete stale branch if exists, then create worktree
        Push-Location $ProjectRoot
        try {
            try {
                $existingBranch = git branch --list -- $branchName 2>$null
                if ($existingBranch) {
                    git branch -D -- $branchName 2>$null
                }
            } catch {}

            # Create worktree with new branch
            $result = git worktree add $worktreePath -b $branchName -- $BaseBranch 2>&1
            $exitCode = $LASTEXITCODE
        } finally {
            Pop-Location
        }

        if ($exitCode -ne 0) {
            throw "Failed to create worktree: $result"
        }

        # PID marker is written by Invoke-Gemini after process.Start() with the real child PID.
        # Writing a placeholder "0" here so stale-check knows worktree is being set up.
        try {
            [System.IO.File]::WriteAllText(
                (Join-Path $worktreePath ".gemini-pid"),
                "0",
                [System.Text.Encoding]::UTF8
            )
        } catch {}

        Write-Host "[worktree] Created: $worktreePath (branch: $branchName)" -ForegroundColor Green

        return @{
            Path     = $worktreePath
            Branch   = $branchName
            TaskId   = $TaskId
            BaseBranch = $BaseBranch
        }
    } finally {
        # Release lock
        if ($lockStream) {
            $lockStream.Close()
            $lockStream.Dispose()
            Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-GeminiWorktreeDiff {
    <#
    .SYNOPSIS
    Gets the diff between Gemini's worktree branch and the base.
    .PARAMETER BranchName
    The Gemini branch name (e.g., "gemini/R2-007").
    .PARAMETER ProjectRoot
    Root of the git repository.
    .PARAMETER StatOnly
    If set, returns only diff stats (file summary).
    #>
    param(
        [Parameter(Mandatory)]
        [string]$BranchName,

        [string]$ProjectRoot = "",

        [switch]$StatOnly
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    Push-Location $ProjectRoot
    try {
        if ($StatOnly) {
            $diff = git diff HEAD...$BranchName --stat 2>&1
        } else {
            $diff = git diff HEAD...$BranchName 2>&1
        }
        if ($LASTEXITCODE -ne 0) {
            throw "git diff failed (exit $LASTEXITCODE): $($diff -join ' ')"
        }
        return ($diff -join "`n")
    } finally {
        Pop-Location
    }
}

function Get-GeminiWorktreeFilesChanged {
    <#
    .SYNOPSIS
    Returns list of files changed in the Gemini worktree.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$BranchName,

        [string]$ProjectRoot = ""
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    Push-Location $ProjectRoot
    try {
        $files = git diff HEAD...$BranchName --name-only 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "git diff --name-only failed (exit $LASTEXITCODE): $($files -join ' ')"
        }
        return @($files | Where-Object { $_ -and $_ -notmatch "^fatal:" })
    } finally {
        Pop-Location
    }
}

function Merge-GeminiWorktree {
    <#
    .SYNOPSIS
    Merges Gemini's worktree branch into the current branch.
    .PARAMETER BranchName
    The Gemini branch to merge.
    .PARAMETER TaskId
    Task identifier for the commit message.
    .PARAMETER ProjectRoot
    Root of the git repository.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$BranchName,

        [Parameter(Mandatory)]
        [string]$TaskId,

        [string]$ProjectRoot = ""
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    Push-Location $ProjectRoot
    try {
        $safeId = ConvertTo-SafeId $TaskId
        $result = git merge --no-edit -m "[gemini/$safeId] Merge Gemini changes" -- $BranchName 2>&1
        $exitCode = $LASTEXITCODE

        if ($exitCode -ne 0) {
            Write-Host "[worktree] Merge conflict detected!" -ForegroundColor Red
            git merge --abort 2>$null
            return @{ Success = $false; Error = "Merge conflict: $result" }
        }

        Write-Host "[worktree] Merged $BranchName successfully" -ForegroundColor Green
        return @{ Success = $true; Error = $null }
    } finally {
        Pop-Location
    }
}

function Remove-GeminiWorktree {
    <#
    .SYNOPSIS
    Removes a Gemini worktree and its branch.
    .PARAMETER TaskId
    Task identifier to locate the worktree.
    .PARAMETER ProjectRoot
    Root of the git repository.
    .PARAMETER KeepBranch
    If set, keeps the branch after removing the worktree.
    #>
    param(
        [Parameter(Mandatory)]
        [string]$TaskId,

        [string]$ProjectRoot = "",

        [switch]$KeepBranch
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    $safeName = ConvertTo-SafeId $TaskId
    $worktreePath = Join-Path (Get-GeminiWorktreeBase) "gemini-$safeName"
    $branchName = "gemini/$safeName"

    Push-Location $ProjectRoot
    try {
        # Remove worktree
        if (Test-Path $worktreePath) {
            git worktree remove $worktreePath --force 2>$null
            Write-Host "[worktree] Removed worktree: $worktreePath" -ForegroundColor Cyan
        }

        # Remove leftover directory
        if (Test-Path $worktreePath) {
            Remove-Item -Recurse -Force $worktreePath -ErrorAction SilentlyContinue
        }

        # Delete branch unless asked to keep
        if (-not $KeepBranch) {
            git branch -D -- $branchName 2>$null
            Write-Host "[worktree] Deleted branch: $branchName" -ForegroundColor Cyan
        }
    } finally {
        Pop-Location
    }
}

function Clear-StaleGeminiWorktrees {
    <#
    .SYNOPSIS
    Cleans up any stale Gemini worktrees (e.g., from crashed previous runs).
    #>
    param(
        [string]$ProjectRoot = ""
    )

    if (-not $ProjectRoot) {
        $ProjectRoot = Get-GitRoot
    }

    $wtBase = Get-GeminiWorktreeBase
    if (-not (Test-Path $wtBase)) { return }

    Push-Location $ProjectRoot
    try {
        # Prune stale worktree references
        git worktree prune 2>$null

        # Remove any leftover gemini-* directories (skip if PID is still active)
        $stale = Get-ChildItem -Path $wtBase -Directory -Filter "gemini-*" -ErrorAction SilentlyContinue
        foreach ($dir in $stale) {
            # Acquire per-task lock to prevent TOCTOU race with New-GeminiWorktree
            $lockPath = Join-Path $wtBase "$($dir.Name).lock"
            $lockStream = $null
            try {
                $lockStream = [System.IO.File]::Open($lockPath, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
            } catch {
                Write-Host "[worktree] Skipping $($dir.Name) — locked by another operation" -ForegroundColor Yellow
                continue
            }
            $skipDir = $false
            try {
                # Check PID marker before removing
                $pidFile = Join-Path $dir.FullName ".gemini-pid"
                if (Test-Path $pidFile) {
                    try {
                        $ownerPid = [int](Get-Content $pidFile -Raw).Trim()
                        # PID 0 is a placeholder from worktree creation — treat as stale
                        if ($ownerPid -ne 0 -and (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue)) {
                            Write-Host "[worktree] Skipping active worktree (PID $ownerPid): $($dir.FullName)" -ForegroundColor Yellow
                            $skipDir = $true
                        }
                    } catch {}
                }
                if (-not $skipDir) {
                    Write-Host "[worktree] Cleaning stale: $($dir.FullName)" -ForegroundColor Yellow
                    git worktree remove $dir.FullName --force 2>$null
                    if (Test-Path $dir.FullName) {
                        Remove-Item -Recurse -Force $dir.FullName -ErrorAction SilentlyContinue
                    }
                    # Try to clean up corresponding branch
                    $branchName = "gemini/" + ($dir.Name -replace '^gemini-', '')
                    git branch -D -- $branchName 2>$null
                }
            } finally {
                if ($lockStream) {
                    $lockStream.Close()
                    $lockStream.Dispose()
                    Remove-Item $lockPath -Force -ErrorAction SilentlyContinue
                }
            }
        }
    } finally {
        Pop-Location
    }
}

# Git Helper Script for Disney Infinity Community Server
# This script ensures consistent git operations across different environments

param(
    [Parameter(Mandatory=$true)]
    [string]$Command,

    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$Arguments
)

# Git executable path
$GitPath = "C:\Program Files\Git\bin\git.exe"

# Working directory
$WorkingDir = "c:\DIModding\infinity-community-server"

# Function to run git commands
function Invoke-Git {
    param(
        [string]$GitCommand,
        [string[]]$GitArgs = @()
    )

    $allArgs = @($GitCommand) + $GitArgs

    Write-Host "Running: git $GitCommand $($GitArgs -join ' ')" -ForegroundColor Cyan

    & $GitPath $allArgs
}

# Main logic
try {
    # Change to working directory
    Set-Location $WorkingDir

    # Execute the git command
    Invoke-Git -GitCommand $Command -GitArgs $Arguments

} catch {
    Write-Host "Error running git command: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# ─────────────────────────────────────────────────────────────────
# VoIP App — Push to GitHub
# Run this script from INSIDE the voip-app folder:
#   cd path\to\voip-app
#   .\push-to-github.ps1
# ─────────────────────────────────────────────────────────────────

param(
    [string]$RepoUrl = ""
)

# Ask for repo URL if not passed as argument
if (-not $RepoUrl) {
    $RepoUrl = Read-Host "Paste your GitHub repo URL (e.g. https://github.com/yourname/voip-app.git)"
}

if (-not $RepoUrl) {
    Write-Host "No URL provided. Exiting." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setting up git repo and pushing to: $RepoUrl" -ForegroundColor Cyan
Write-Host ""

# Initialize git if not already done
if (-not (Test-Path ".git")) {
    git init
    Write-Host "Git repo initialized." -ForegroundColor Green
} else {
    Write-Host "Git already initialized." -ForegroundColor Yellow
}

# Create .gitignore
@"
node_modules/
dist/
.env
*.log
.DS_Store
Thumbs.db
"@ | Out-File -FilePath ".gitignore" -Encoding utf8 -Force

Write-Host "Created .gitignore" -ForegroundColor Green

# Stage all files
git add .

# Commit
git commit -m "Initial commit: VoIP gaming voice chat app"

# Set main branch
git branch -M main

# Add remote (remove old one first if it exists)
git remote remove origin 2>$null
git remote add origin $RepoUrl

# Push
Write-Host ""
Write-Host "Pushing to GitHub..." -ForegroundColor Cyan
git push -u origin main

Write-Host ""
Write-Host "Done! Your code is live at:" -ForegroundColor Green
Write-Host $RepoUrl.Replace(".git","") -ForegroundColor White

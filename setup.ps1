# ============================================================================
# AutoAssess - Project Bootstrap
# ============================================================================
# Creates C:\Dev\AutoAssess, runs create-next-app, installs deps.
# Run with: .\setup.ps1
# If execution policy blocks: 
#   Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process -Force
# ============================================================================

$ErrorActionPreference = "Stop"
$projectPath = "C:\Dev\AutoAssess"

Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "  AutoAssess Project Bootstrap" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow
Write-Host ""

# 1. Folder
if (Test-Path $projectPath) {
    Write-Host "Folder already exists: $projectPath" -ForegroundColor Cyan
    $resp = Read-Host "Continue anyway? (y/N)"
    if ($resp -ne "y") { exit 0 }
} else {
    New-Item -Path $projectPath -ItemType Directory -Force | Out-Null
    Write-Host "Created: $projectPath" -ForegroundColor Green
}
Set-Location $projectPath
Write-Host "CWD: $(Get-Location)" -ForegroundColor Gray

# 2. Prerequisites
Write-Host ""
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

try {
    $nodeVersion = (node --version) -replace 'v', ''
    $nodeMajor = [int]($nodeVersion.Split('.')[0])
    if ($nodeMajor -lt 18) {
        Write-Host "  ERROR: Node $nodeVersion too old. Need Node 18+. Install from https://nodejs.org" -ForegroundColor Red
        exit 1
    }
    Write-Host "  Node:    v$nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not installed. Install LTS from https://nodejs.org" -ForegroundColor Red
    exit 1
}

try {
    $npmVersion = npm --version
    Write-Host "  npm:     $npmVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: npm not found" -ForegroundColor Red
    exit 1
}

try {
    $gitVersion = (git --version) -replace 'git version ', ''
    Write-Host "  git:     $gitVersion" -ForegroundColor Green
    $hasGit = $true
} catch {
    Write-Host "  WARN: git not found (recommended but not required)" -ForegroundColor Yellow
    $hasGit = $false
}

# 3. Bootstrap Next.js
Write-Host ""
Write-Host "Initializing Next.js (30-60 seconds)..." -ForegroundColor Yellow
npx --yes create-next-app@latest . `
    --typescript `
    --tailwind `
    --app `
    --no-src-dir `
    --import-alias "@/*" `
    --use-npm `
    --eslint `
    --no-turbopack

if ($LASTEXITCODE -ne 0) {
    Write-Host "create-next-app failed" -ForegroundColor Red
    exit 1
}

# 4. Install AutoAssess deps
Write-Host ""
Write-Host "Installing AutoAssess dependencies..." -ForegroundColor Yellow
npm install `
    "@zxing/library" `
    "@supabase/ssr" `
    "@supabase/supabase-js" `
    "@anthropic-ai/sdk" `
    "zod"

npm install -D "@types/node"

# 5. Init git
if ($hasGit -and -not (Test-Path ".git")) {
    Write-Host ""
    Write-Host "Initializing git..." -ForegroundColor Yellow
    git init | Out-Null
    git add -A | Out-Null
    git commit -m "chore: initial Next.js scaffold" | Out-Null
}

# 6. Done
Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Bootstrap complete." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Project: $projectPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Drop the AutoAssess source files over the generated project."
Write-Host "     Overwrite: app/page.tsx, app/layout.tsx, app/globals.css, tailwind.config.ts"
Write-Host "     Add:       app/assessments/, components/, lib/, .cursor/, .vscode/, .env.local.example"
Write-Host ""
Write-Host "  2. Copy .env.local.example to .env.local and fill in keys."
Write-Host ""
Write-Host "  3. Open in Cursor:"
Write-Host "       cursor $projectPath"
Write-Host ""
Write-Host "  4. Start dev server:"
Write-Host "       npm run dev"
Write-Host ""
Write-Host "  5. Test on phone (camera needs HTTPS or localhost):"
Write-Host "       npm install -g localtunnel"
Write-Host "       lt --port 3000 --subdomain autoassess-dev"
Write-Host ""

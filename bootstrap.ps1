$ErrorActionPreference = "Stop"

Write-Host "=== Bootstrapping Voice AI Platform ===" -ForegroundColor Cyan

#
# Backend
#

Write-Host "`n== Backend ==" -ForegroundColor Yellow

docker compose exec backend composer install

if (-not (Test-Path "backend\.env")) {
    Copy-Item "backend\.env.example" "backend\.env"
}

$appKey = Select-String -Path "backend\.env" -Pattern "^APP_KEY="

if ($appKey.Line -eq "APP_KEY=") {
    docker compose exec backend php artisan key:generate
}

$composer = Get-Content "backend\composer.json" -Raw

if ($composer -notmatch '"laravel/sanctum"') {
    docker compose exec backend composer require laravel/sanctum
}

if ($composer -notmatch '"laravel/fortify"') {
    docker compose exec backend composer require laravel/fortify
}

if (-not (Test-Path "backend\routes\api.php")) {
    docker compose exec backend php artisan install:api
}

docker compose exec backend php artisan migrate --force

#
# Frontend
#

Write-Host "`n== Frontend ==" -ForegroundColor Yellow

docker compose exec frontend pnpm install

#
# AI Runtime
#

Write-Host "`n== AI Runtime ==" -ForegroundColor Yellow

if (Test-Path "ai-runtime\package.json") {
    docker compose exec ai-runtime pnpm install
}

Write-Host "`nBootstrap completed successfully." -ForegroundColor Green
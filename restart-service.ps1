# PowerShell script to restart the User Service
Write-Host "🛑 Stopping User Service..." -ForegroundColor Yellow

# Find and kill any process using port 4001
$process = Get-NetTCPConnection -LocalPort 4001 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
if ($process) {
    Write-Host "Found process $process on port 4001, stopping..." -ForegroundColor Yellow
    Stop-Process -Id $process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host "🚀 Starting User Service..." -ForegroundColor Green
Write-Host "📝 Make sure MongoDB URI is fixed in .env file" -ForegroundColor Cyan
Write-Host ""

# Start the service
npm run dev



# Builds the React client into the server's wwwroot and publishes one self-contained-folder ASP.NET app.
# Usage: pwsh -File scripts/build.ps1   (Windows PowerShell 5.1 also works)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Step([string]$description, [scriptblock]$command) {
    Write-Host "==> $description"
    & $command
    if ($LASTEXITCODE -ne 0) { throw "$description failed (exit $LASTEXITCODE)" }
}

Push-Location (Join-Path $root 'src/client')
try {
    Invoke-Step 'Install client dependencies (npm ci)' { npm ci --no-audit --no-fund }
    Invoke-Step 'Build client into src/server/BubblesMd.Server/wwwroot' { npm run build }
}
finally { Pop-Location }

$publish = Join-Path $root 'publish'
Invoke-Step 'Publish ASP.NET server to ./publish' {
    dotnet publish (Join-Path $root 'src/server/BubblesMd.Server') -c Release -o $publish
}
Write-Host "Done. Run: dotnet `"$publish/BubblesMd.Server.dll`" --urls http://localhost:5180"

param([string]$Project = (Get-Location).Path)
$pluginDir = Join-Path $Project '.opencode/plugins/adaptative-harness'
$target = Join-Path $pluginDir 'index.ts'
if (Test-Path -LiteralPath $target) { if ((Get-FileHash -LiteralPath $target).Hash -eq (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot "plugin.ts")).Hash) { Write-Output "Already installed"; exit 0 }; throw "Refusing to overwrite existing file: $target" }
New-Item -ItemType Directory -Force -Path $pluginDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'plugin.ts') -Destination $target
Write-Output "Installed plugin at $target. Create .opencode/adaptative-harness.json using README instructions."



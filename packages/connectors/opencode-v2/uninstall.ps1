param([string]$Project = (Get-Location).Path, [switch]$Force)
$target = Join-Path $Project '.opencode/plugins/adaptative-harness/index.ts'
if (-not (Test-Path -LiteralPath $target)) { exit 0 }
if ((Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot "plugin.ts")).Hash) { throw "Preserving modified or unowned plugin: $target" }
Remove-Item -LiteralPath $target

param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $PSScriptRoot "build"
$staging = Join-Path $build "app"
$dist = Join-Path $PSScriptRoot "dist"
$source = Join-Path $PSScriptRoot "SiftLauncher.cs"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$nodeExe = (& node -p "process.execPath").Trim()
$nodeArch = (& node -p "process.arch").Trim()
$version = (Select-String -Path $source -Pattern 'AssemblyVersion\("([\d.]+)"\)').Matches[0].Groups[1].Value

if (-not (Test-Path $csc)) { throw "找不到 C# 编译器：$csc" }
if (-not (Test-Path $nodeExe)) { throw "找不到 node.exe：$nodeExe" }
if ($nodeArch -ne "x64") { throw "当前 Node 不是 x64（$nodeArch），无法构建 Windows x64 版本。" }

Write-Host "==> 清理构建目录"
Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dist -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $staging -Force | Out-Null
New-Item -ItemType Directory -Path $dist -Force | Out-Null

Write-Host "==> 收集应用文件"
Copy-Item (Join-Path $root "package.json") $staging
Copy-Item (Join-Path $root "package-lock.json") $staging
Copy-Item (Join-Path $root "server") $staging -Recurse
Copy-Item (Join-Path $root "public") $staging -Recurse
Copy-Item (Join-Path $root "LICENSE") $staging
Copy-Item (Join-Path $root "README.md") $staging
Copy-Item (Join-Path $PSScriptRoot "NODE-LICENSE.txt") $staging
Copy-Item $nodeExe (Join-Path $staging "node.exe")

if ($SkipInstall) {
  Write-Host "==> 复用现有 node_modules"
  Copy-Item (Join-Path $root "node_modules") (Join-Path $staging "node_modules") -Recurse
} else {
  Write-Host "==> 安装生产依赖"
  Push-Location $staging
  try {
    & npm.cmd ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci 失败（$LASTEXITCODE）" }
  } finally {
    Pop-Location
  }
}

$stamp = $version + "+" + (Get-Date -Format "yyyyMMdd-HHmmss")
Set-Content (Join-Path $staging "VERSION.txt") $stamp -Encoding ASCII
Write-Host "==> 打包应用资源 $stamp"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $build "payload.zip"
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $staging,
  $zip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)

Write-Host "==> 生成图标"
Add-Type -AssemblyName System.Drawing
$ico = Join-Path $build "sift.ico"
$bmp = New-Object System.Drawing.Bitmap 64, 64
$graphics = [System.Drawing.Graphics]::FromImage($bmp)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(243, 238, 227))
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(191, 63, 43))
$graphics.FillRectangle($brush, 4, 4, 56, 56)
$font = New-Object System.Drawing.Font("Microsoft YaHei", 40, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$rect = New-Object System.Drawing.RectangleF 0, 0, 64, 64
$graphics.DrawString("筛", $font, [System.Drawing.Brushes]::White, $rect, $format)
$icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
$iconStream = [System.IO.File]::Create($ico)
$icon.Save($iconStream)
$iconStream.Close()
$graphics.Dispose()
$bmp.Dispose()
$font.Dispose()
$brush.Dispose()

Write-Host "==> 编译单文件 EXE"
$exe = Join-Path $dist "SIFT.exe"
& $csc /nologo /target:winexe /platform:x64 /optimize+ /codepage:65001 `
  "/out:$exe" `
  "/win32icon:$ico" `
  "/resource:$zip,payload.zip" `
  /reference:System.dll `
  /reference:System.Core.dll `
  /reference:System.Drawing.dll `
  /reference:System.Windows.Forms.dll `
  /reference:System.IO.Compression.dll `
  /reference:System.IO.Compression.FileSystem.dll `
  (Join-Path $PSScriptRoot "SiftLauncher.cs")
if ($LASTEXITCODE -ne 0) { throw "编译失败（$LASTEXITCODE）" }

$hash = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
"$hash  SIFT.exe" | Set-Content "$exe.sha256" -Encoding ASCII

$sizeMb = [math]::Round((Get-Item $exe).Length / 1MB, 1)
Write-Host ""
Write-Host "完成：$exe（$sizeMb MB）"
Write-Host "SHA256：$hash"

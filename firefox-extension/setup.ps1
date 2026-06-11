# Downloads the required JS libraries into lib/
# Run once before loading the extension: .\setup.ps1

$lib = "$PSScriptRoot\lib"
New-Item -ItemType Directory -Force $lib | Out-Null

$files = @{
  "pdf.min.js"        = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js"
  "pdf.worker.min.js" = "https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js"
  "pdf-lib.min.js"    = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"
}

foreach ($name in $files.Keys) {
  Write-Host "Downloading $name ..."
  Invoke-WebRequest $files[$name] -OutFile "$lib\$name"
}

Write-Host ""
Write-Host "Done. Load the extension in Firefox:" -ForegroundColor Green
Write-Host "  about:debugging -> This Firefox -> Load Temporary Add-on -> select manifest.json"

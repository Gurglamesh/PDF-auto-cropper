# Build LabelCropper.exe
# Run from the project directory: .\build.ps1

pyinstaller `
    --onefile `
    --windowed `
    --name "LabelCropper" `
    --collect-all pymupdf `
    --hidden-import PIL._tkinter_finder `
    app.py

Write-Host ""
Write-Host "Done. Executable is at: dist\LabelCropper.exe" -ForegroundColor Green

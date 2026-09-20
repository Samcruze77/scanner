# Converts a few of the templates Microsoft ships with Office into .docx files
# in tests/docx/fixtures/real, as authentic, complex Word documents (themes,
# content controls, tables, text boxes, headers/footers) for the fidelity tests.
#
# Run one template per process (Word occasionally stalls unattended):
#   powershell -File tests/docx/word-import-templates.ps1 -Only EssentialReport

param([string]$Dir = "$PSScriptRoot\fixtures\real", [string]$Only = "")

New-Item -ItemType Directory -Force $Dir | Out-Null
$names = "EssentialLetter", "EssentialReport", "TimelessReport", "StudentReport", "ChronologicalResume", "AdjacencyReport", "OriginReport", "RedAndBlackLetter" | Where-Object { $_ -like "*$Only*" }
$src = "C:\Program Files\Microsoft Office\root\Templates\1033"

$word = New-Object -ComObject Word.Application
$word.Visible = $true
$word.WindowState = 2
$word.DisplayAlerts = 0
try {
  foreach ($n in $names) {
    $file = Get-ChildItem $src -Filter "$n.*" | Select-Object -First 1
    if (-not $file) { Write-Host "$n : not found"; continue }
    $out = Join-Path $Dir "$n.docx"
    Remove-Item $out -ErrorAction SilentlyContinue
    # Templates are opened as a new document (opening them read-only stalls Word).
    $doc = $word.Documents.Add($file.FullName)
    try {
      $doc.SaveAs2($out, 16)
      Write-Host "$n : ok"
    } finally {
      $doc.Close(0)
    }
  }
} finally {
  $word.Quit()
}

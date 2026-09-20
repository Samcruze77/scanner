# Uses Microsoft Word itself as the reference renderer: opens each fixture,
# exports Word's own PDF (`<name>.word.pdf`) and saves a Word-normalised copy
# (`<name>.word.docx`, i.e. what Word itself writes, including its page-break
# markers) so the converter is tested on both tool-made and Word-made files.
#
# Notes from getting this to run unattended:
#  - A hidden Word instance stalls in ExportAsFixedFormat; a minimised, visible
#    one does not.
#  - Word must paginate (ComputeStatistics) before the export.
#  - Existing outputs are deleted first, so a stale file is never mistaken for a
#    fresh one.
#
# Run: powershell -File tests/docx/word-export.ps1 [-Only 03-spacing]

param([string]$Dir = "$PSScriptRoot\fixtures", [string]$Only = "")

$word = New-Object -ComObject Word.Application
$word.Visible = $true
$word.WindowState = 2
$word.DisplayAlerts = 0
try {
  $files = @(Get-ChildItem $Dir -Filter *.docx | Where-Object { $_.Name -notlike "*.word.docx" -and $_.Name -like "*$Only*" })
  foreach ($file in $files) {
    $base = [IO.Path]::GetFileNameWithoutExtension($file.FullName)
    $pdf = Join-Path $Dir "$base.word.pdf"
    $norm = Join-Path $Dir "$base.word.docx"
    Remove-Item $pdf, $norm -ErrorAction SilentlyContinue
    $doc = $word.Documents.Open($file.FullName, $false, $true)
    try {
      $pages = $doc.ComputeStatistics(2)
      $doc.ExportAsFixedFormat($pdf, 17)
      $doc.SaveAs2($norm, 16)
      Write-Host ("{0}: {1} pages" -f $base, $pages)
    } finally {
      $doc.Close(0)
    }
  }
} finally {
  $word.Quit()
}

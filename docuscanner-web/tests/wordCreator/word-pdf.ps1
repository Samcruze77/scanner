# Exports Word's own PDF of a .docx, one small step per process. Run unattended, a single process that opens a document and
# exports it straight away can block forever inside Word; attaching to the running Word from a fresh process for each step
# does not.
#
#   word-pdf.ps1 -Step start                       start (or reuse) a visible, minimised Word
#   word-pdf.ps1 -Step open   -File x.docx         open it read-only
#   word-pdf.ps1 -Step export -File x.docx -Pdf x.word.pdf   paginate and export the open document, print the page count
#   word-pdf.ps1 -Step close  -File x.docx
#   word-pdf.ps1 -Step quit
param([string]$Step, [string]$File = "", [string]$Pdf = "")

function Get-Word {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject("Word.Application") } catch { return $null }
}

if ($Step -eq "start") {
  $w = Get-Word
  if (-not $w) {
    $w = New-Object -ComObject Word.Application
    $w.Visible = $true
    $w.WindowState = 2
    $w.DisplayAlerts = 0
  }
  Write-Output ("Word " + $w.Version + " build " + $w.Build)
  exit 0
}

$w = Get-Word
if (-not $w) { Write-Error "Word is not running"; exit 1 }

switch ($Step) {
  "open" {
    foreach ($d in @($w.Documents)) { if ($d.FullName -eq $File) { exit 0 } }
    [void]$w.Documents.Open($File, $false, $true)
  }
  "export" {
    foreach ($d in @($w.Documents)) {
      if ($d.FullName -eq $File) {
        $pages = $d.ComputeStatistics(2)
        $d.ExportAsFixedFormat($Pdf, 17)
        Write-Output $pages
      }
    }
  }
  "close" {
    foreach ($d in @($w.Documents)) { if ($d.FullName -eq $File) { $d.Close(0) } }
  }
  "quit" { $w.Quit() }
}

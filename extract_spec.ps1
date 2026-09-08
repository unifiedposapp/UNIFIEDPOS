$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Open("c:\Users\Jmediaking\Desktop\The ultimate architecture\The ultimate architecture.docx")
$text = $doc.Content.Text
$doc.Close($false)
$word.Quit()
[System.IO.File]::WriteAllText("c:\Users\Jmediaking\Desktop\The ultimate architecture\spec_extract.txt", $text, [System.Text.Encoding]::UTF8)
Write-Host "Success - extracted $($text.Length) characters"

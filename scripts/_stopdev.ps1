$ports = 3001,5173
$conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $ports -contains $_.LocalPort }
if ($conns) {
  $conns.OwningProcess | Sort-Object -Unique | ForEach-Object {
    Write-Output ("killing PID " + $_)
    Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Output "no listeners on 3001/5173"
}
# Also stop tsx/concurrently dev wrappers by command line match.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'tsx watch|concurrently|vite|npm run dev|node packages/server' } |
  ForEach-Object {
    Write-Output ("stopping wrapper PID " + $_.ProcessId)
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 1
Write-Output "done"
